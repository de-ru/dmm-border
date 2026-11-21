#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DMMぱちタウン (p-town.dmm.com) ボーダーデータ取得スクリプト
--------------------------------------------------------------------------
【運用方針: ローカル全件取得 + 自動更新で1ページ新着マージ】
1. 差分マージ方式:
   - 既存の data/borders.json を読み込み、ID/機種名で保持
   - 新規取得した機種データを既存データと統合 (新台は先頭に追加、既存台は更新)
   - 既存の過去機種データは絶対に消失しない
2. 実行モード:
   - incremental (デフォルト): 1ページ目の新着台のみを取得して既存データにマージ (GitHub Actions向け)
   - full (または --all): 全ページ (約103ページ) を取得して一括構築 (ローカル実行向け)
3. 堅牢なフェイルセーフ:
   - ネットワーク遮断や403等のエラー時でも、既存データを100%保護
   - --allow-fail 指定時は、CI上で落ちずに既存データを維持して終了
--------------------------------------------------------------------------
"""

import os
import sys
import json
import time
import re
import argparse
import http.cookiejar
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple, Union

try:
    import requests
except ImportError:
    requests = None

# パス設定
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_PATH = BASE_DIR / "data" / "borders.json"
DOCS_DATA_PATH = BASE_DIR / "docs" / "data" / "borders.json"
BACKUP_PATH = BASE_DIR / "data" / "borders.backup.json"

# エンドポイント
TOP_PAGE_URL = "https://p-town.dmm.com/machine_borders"
API_BASE_URL = "https://p-town.dmm.com/ajax/machines/borders"

COMMON_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
    "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": "https://p-town.dmm.com/machine_borders",
}


class HeaderPreservingRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new_req = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new_req:
            for k, v in COMMON_HEADERS.items():
                new_req.add_header(k, v)
        return new_req


class P舍Client:
    def __init__(self):
        self.use_requests = requests is not None
        if self.use_requests:
            self.session = requests.Session()
            self.session.headers.update(COMMON_HEADERS)
        else:
            self.cookie_jar = http.cookiejar.CookieJar()
            self.opener = urllib.request.build_opener(
                urllib.request.HTTPCookieProcessor(self.cookie_jar),
                HeaderPreservingRedirectHandler(),
            )

    def init_session(self) -> bool:
        """トップページを訪問してCookieを確立"""
        top_headers = dict(COMMON_HEADERS)
        top_headers["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
        top_headers["Sec-Fetch-Dest"] = "document"
        top_headers["Sec-Fetch-Mode"] = "navigate"
        top_headers["Sec-Fetch-Site"] = "none"

        try:
            if self.use_requests:
                resp = self.session.get(TOP_PAGE_URL, headers=top_headers, timeout=15)
                return resp.status_code == 200
            else:
                req = urllib.request.Request(TOP_PAGE_URL, headers=top_headers)
                with self.opener.open(req, timeout=15) as resp:
                    return resp.status == 200
        except Exception as e:
            print(f"[WARN] セッション初期化時に警告 (処理を続行します): {e}", file=sys.stderr)
            return False

    def get_json(self, url: str) -> Dict[str, Any]:
        if self.use_requests:
            resp = self.session.get(url, timeout=15)
            resp.raise_for_status()
            return resp.json()
        else:
            req = urllib.request.Request(url, headers=COMMON_HEADERS)
            with self.opener.open(req, timeout=15) as resp:
                content = resp.read().decode("utf-8")
                return json.loads(content)


def parse_border_value(raw_text: Optional[str]) -> Tuple[Union[float, str], Optional[float], Dict[str, float]]:
    if not raw_text or not isinstance(raw_text, str):
        return ("情報なし", None, {})

    text = raw_text.strip()
    borders_dict: Dict[str, float] = {}

    patterns = {
        "4.00": [
            r"4\.0円[^\d\n]*?[…\:\s](\d+\.?\d*)\s*回転?",
            r"●4\.0円[^\n]*\n+(\d+\.?\d*)\s*回転?",
            r"4\.0円[^\d\n]*?(\d+\.?\d*)\s*回転?",
            r"25[個玉][^\d\n]*?[…\:\s](\d+\.?\d*)\s*回転?",
        ],
        "3.57": [
            r"3\.57円[^\d\n]*?[…\:\s](\d+\.?\d*)\s*回転?",
            r"3\.5円[^\d\n]*?[…\:\s](\d+\.?\d*)\s*回転?",
            r"28[個玉][^\d\n]*?[…\:\s](\d+\.?\d*)\s*回転?",
        ],
        "3.33": [
            r"3\.33円[^\d\n]*?[…\:\s](\d+\.?\d*)\s*回転?",
            r"3\.3円[^\d\n]*?[…\:\s](\d+\.?\d*)\s*回転?",
            r"30[個玉][^\d\n]*?[…\:\s](\d+\.?\d*)\s*回転?",
        ],
        "3.03": [
            r"3\.03円[^\d\n]*?[…\:\s](\d+\.?\d*)\s*回転?",
            r"3\.0円[^\d\n]*?[…\:\s](\d+\.?\d*)\s*回転?",
            r"33[個玉][^\d\n]*?[…\:\s](\d+\.?\d*)\s*回転?",
        ],
        "2.50": [
            r"2\.50?円[^\d\n]*?[…\:\s](\d+\.?\d*)\s*回転?",
            r"40[個玉][^\d\n]*?[…\:\s](\d+\.?\d*)\s*回転?",
        ],
    }

    for rate_key, regex_list in patterns.items():
        for pat in regex_list:
            m = re.search(pat, text)
            if m:
                try:
                    val = float(m.group(1))
                    if 3.0 <= val <= 50.0:
                        borders_dict[rate_key] = val
                        break
                except ValueError:
                    continue

    if "4.00" in borders_dict:
        val = borders_dict["4.00"]
        return (val, val, borders_dict)

    m_set1 = re.search(r"設定1[^\d\n]*?[…\:\s](\d+\.?\d*)\s*回転?", text)
    if m_set1:
        try:
            val = float(m_set1.group(1))
            borders_dict["4.00"] = val
            return (val, val, borders_dict)
        except ValueError:
            pass

    m_single = re.search(r"(\d{1,2}\.\d)\s*回転", text)
    if m_single:
        try:
            val = float(m_single.group(1))
            borders_dict["4.00"] = val
            return (val, val, borders_dict)
        except ValueError:
            pass

    return (text, None, borders_dict)


def determine_category_and_type(name: str, desc: str) -> Tuple[str, str]:
    category = "P機"
    spec_type = "パチンコ"

    if name.startswith("e") or "スマパチ" in name or "スマパチ" in desc:
        category = "e機"
        spec_type = "スマパチ"
    elif "羽根" in name or "ハネモノ" in name or "羽根" in desc:
        category = "羽根モノ"
        spec_type = "羽根モノ"
    elif "甘デジ" in name or "99" in name or "Sweet" in name or "sweet" in name or "甘" in desc:
        spec_type = "甘デジ"
    elif "ライトミドル" in desc or "199" in desc:
        spec_type = "ライトミドル"
    elif "ミドル" in desc or "319" in desc:
        spec_type = "ミドル"

    return category, spec_type


def load_existing_data() -> List[Dict[str, Any]]:
    if not DATA_PATH.exists():
        return []
    try:
        with open(DATA_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except Exception as e:
        print(f"[WARN] 既存データの読み込みに失敗しました: {e}", file=sys.stderr)
        return []


def create_backup(existing_data: List[Dict[str, Any]]) -> bool:
    if not existing_data:
        return False
    try:
        BACKUP_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(BACKUP_PATH, "w", encoding="utf-8") as f:
            json.dump(existing_data, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"[WARN] バックアップ作成失敗: {e}", file=sys.stderr)
        return False


def save_atomic(data: List[Dict[str, Any]]) -> bool:
    tmp_path = DATA_PATH.with_suffix(".tmp")
    docs_tmp_path = DOCS_DATA_PATH.with_suffix(".tmp")

    try:
        DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
        DOCS_DATA_PATH.parent.mkdir(parents=True, exist_ok=True)

        json_bytes = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")

        with open(tmp_path, "wb") as f:
            f.write(json_bytes)
        os.replace(tmp_path, DATA_PATH)

        with open(docs_tmp_path, "wb") as f:
            f.write(json_bytes)
        os.replace(docs_tmp_path, DOCS_DATA_PATH)

        return True
    except Exception as e:
        print(f"[ERROR] ファイル保存エラー: {e}", file=sys.stderr)
        if tmp_path.exists():
            tmp_path.unlink()
        if docs_tmp_path.exists():
            docs_tmp_path.unlink()
        return False


def merge_items(existing_list: List[Dict[str, Any]], new_items: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], int, int]:
    """
    既存データと新規データをマージする
    - 新着機種（未登録）: リストの先頭に追加
    - 既存機種: 最新のボーダー情報に更新
    - 取得されなかった過去機種: そのまま100%保持
    Returns:
        (merged_list, added_count, updated_count)
    """
    # 既存データのマップ化（キー: id）
    existing_map: Dict[str, Dict[str, Any]] = {}
    for item in existing_list:
        if isinstance(item, dict) and "id" in item:
            existing_map[item["id"]] = item

    added_items: List[Dict[str, Any]] = []
    updated_count = 0

    # 新規アイテムをチェック
    for item in new_items:
        m_id = item["id"]
        if m_id in existing_map:
            # 既存台の更新
            existing_map[m_id].update(item)
            updated_count += 1
        else:
            # 新着台（新規追加）
            added_items.append(item)
            existing_map[m_id] = item

    # 新規追加されたアイテムを先頭に、既存リストをマージ
    merged_list = added_items + [item for item in existing_list if item["id"] not in {a["id"] for a in added_items}]

    return merged_list, len(added_items), updated_count


def scrape_borders(
    mode: str = "incremental",
    max_pages: Optional[int] = None,
    delay_seconds: float = 1.0,
    allow_fail: bool = False,
    dry_run: bool = False
) -> List[Dict[str, Any]]:
    """
    ボーダーデータを取得してマージ保存する
    - mode="incremental": 1ページ目 (新着) のみ取得し既存データとマージ
    - mode="full": 全ページ取得して既存データとマージ
    """
    print("=" * 60)
    print(f"DMMぱちタウン ボーダーデータ収集・更新 (モード: {mode})")
    print("=" * 60)

    existing_data = load_existing_data()
    print(f"[INFO] 既存データ件数: {len(existing_data)} 件")
    if existing_data and not dry_run:
        create_backup(existing_data)

    client = P舍Client()
    client.init_session()

    # モードに応じた取得ページ数決定
    if mode == "incremental":
        target_max_pages = max_pages if max_pages is not None else 1
    else:
        target_max_pages = max_pages  # Noneなら全ページ

    fetched_items: List[Dict[str, Any]] = []
    seen_ids = set()
    today_str = datetime.now().strftime("%Y-%m-%d")

    page = 1
    total_pages = 1

    try:
        while True:
            if target_max_pages and page > target_max_pages:
                break

            target_url = API_BASE_URL if page == 1 else f"{API_BASE_URL}?page={page}"
            print(f"[INFO] ページ {page} を取得中... ({target_url})")
            
            data = client.get_json(target_url)
            items = data.get("data", [])
            total_pages = data.get("last_page", total_pages)

            if not items:
                break

            for raw in items:
                machine_id = str(raw.get("id"))
                name = raw.get("name", "").strip()
                if not name or machine_id in seen_ids:
                    continue
                seen_ids.add(machine_id)

                maker_info = raw.get("maker") or {}
                maker_name = maker_info.get("name", "") if isinstance(maker_info, dict) else ""
                border_info = raw.get("border") or {}
                border_raw = border_info.get("border", "") if isinstance(border_info, dict) else ""

                border_val, border_equal, borders_map = parse_border_value(border_raw)
                detail_url = f"https://p-town.dmm.com/machines/{machine_id}" if machine_id else ""
                category, spec_type = determine_category_and_type(name, raw.get("description", ""))

                release_date = ""
                intro_date = raw.get("introduction_date")
                if intro_date and isinstance(intro_date, str) and len(intro_date) >= 7:
                    release_date = intro_date[:7]

                formatted_item: Dict[str, Any] = {
                    "id": f"ptown-{machine_id}",
                    "name": name,
                    "maker": maker_name,
                    "border": border_val,
                    "border_equal": border_equal if border_equal is not None else (border_val if isinstance(border_val, (int, float)) else 18.0),
                    "borders": borders_map,
                    "border_raw": border_raw,
                    "url": detail_url,
                    "detail_url": detail_url,
                    "category": category,
                    "type": spec_type,
                    "release_date": release_date,
                    "notes": (border_raw.replace("\r\n", " ").replace("\n", " ").strip())[:120] if border_raw else "",
                    "updated_at": today_str,
                }
                fetched_items.append(formatted_item)

            print(f"[INFO] ページ {page}/{total_pages} 取得完了 (今回取得累計: {len(fetched_items)} 件)")

            if page >= total_pages:
                break

            page += 1
            if delay_seconds > 0:
                time.sleep(delay_seconds)

    except Exception as e:
        print(f"[ERROR] データ取得中にエラーが発生しました: {e}", file=sys.stderr)
        if allow_fail:
            print("[INFO] --allow-fail が指定されているため、既存データを維持して正常終了します。")
            return existing_data
        else:
            print("【安全装置発動】既存データを保護するため処理を中断します。", file=sys.stderr)
            if not dry_run:
                sys.exit(1)
            return existing_data

    if len(fetched_items) == 0:
        if allow_fail:
            print("[INFO] 取得件数が0件のため、既存データを維持して終了します。")
            return existing_data
        else:
            print("[ERROR] 取得件数が0件です。既存データを保護します。", file=sys.stderr)
            if not dry_run:
                sys.exit(1)
            return existing_data

    # 既存データとマージ
    final_list, added_count, updated_count = merge_items(existing_data, fetched_items)

    print("-" * 60)
    print(f"マージ完了: 新着追加 {added_count} 件 / 既存更新 {updated_count} 件 / 総保持件数 {len(final_list)} 件")
    print("-" * 60)

    if dry_run:
        print("[INFO] dry-run モードのため保存をスキップします。")
    else:
        success = save_atomic(final_list)
        if success:
            print(f"[SUCCESS] {DATA_PATH} および {DOCS_DATA_PATH} を正常更新しました。")
        else:
            print("[ERROR] ファイル保存に失敗しました。", file=sys.stderr)
            sys.exit(1)

    return final_list


def main():
    parser = argparse.ArgumentParser(description="DMMぱちタウンのボーダー情報を取得・マージします")
    parser.add_argument(
        "--mode",
        choices=["incremental", "full"],
        default="incremental",
        help="実行モード: incremental (新着1ページをマージ) または full (全件取得マージ)"
    )
    parser.add_argument("--max-pages", type=int, default=None, help="取得する最大ページ数 (省略時はモード既定)")
    parser.add_argument("--delay", type=float, default=1.0, help="ページ間待機秒数 (デフォルト: 1.0秒)")
    parser.add_argument("--allow-fail", action="store_true", help="通信エラー時も既存データを保護してexit 0で終了 (CI用)")
    parser.add_argument("--dry-run", action="store_true", help="書き込みを行わないテスト実行")
    args = parser.parse_args()

    scrape_borders(
        mode=args.mode,
        max_pages=args.max_pages,
        delay_seconds=args.delay,
        allow_fail=args.allow_fail,
        dry_run=args.dry_run
    )


if __name__ == "__main__":
    main()
