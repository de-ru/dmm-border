#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DMMぱちタウン (p-town.dmm.com) ボーダーデータ取得スクリプト
--------------------------------------------------------------------------
【概要】
- 対象: https://p-town.dmm.com/machine_borders
- 内部API (XHR): https://p-town.dmm.com/ajax/machines/borders?page={page}
- 抽出項目:
  - id: 機種ID
  - name: 機種名
  - maker: メーカー名
  - border: 基準ボーダー値 (数値化できる場合は float、できなければ元テキスト)
  - border_raw: 元のボーダーテキスト
  - border_equal: 等価ボーダー数値 (Webアプリ連携用)
  - borders: 代表換金率のマップ (Webアプリ連携用)
  - url: 機種詳細・解析ページURL (https://p-town.dmm.com/machines/{id})
  - type / category: スペックタイプ (ミドル/スマパチ/P機等)
  - updated_at: 取得日時 (YYYY-MM-DD)
【安全機能】
- ページ間待機時間 (デフォルト 2.0秒)
- 機種ID・機種名による重複排除
- 取得件数0件またはエラー発生時、既存の data/borders.json を絶対に壊さないフェイルセーフ
- 一時ファイル経由のアトミック書き込み
- docs/data/borders.json との自動同期
【403 Forbidden 対策・堅牢化設計】
1. requests.Session() による Cookie とセッションの完全維持
2. page=1 のリダイレクト (301) 回避: page=1 はパラメータなしの正規化URLへアクセス
3. urllib フォールバック時も CookieJar + ヘッダー維持型リダイレクトハンドラを適用
4. 親ページ (https://p-town.dmm.com/machine_borders) への初期アクセスで Laravel Cookie 取得
5. Sec-Ch-Ua, Sec-Fetch-*, X-Requested-With 等の完全ブラウザヘッダー送信
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

# requests があれば優先使用
try:
    import requests
except ImportError:
    requests = None

# パス設定
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_PATH = BASE_DIR / "data" / "borders.json"
DOCS_DATA_PATH = BASE_DIR / "docs" / "data" / "borders.json"
BACKUP_PATH = BASE_DIR / "data" / "borders.backup.json"

# APIエンドポイント
# エンドポイント
TOP_PAGE_URL = "https://p-town.dmm.com/machine_borders"
API_BASE_URL = "https://p-town.dmm.com/ajax/machines/borders"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

# ブラウザ完全擬態ヘッダー
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
    """301/302 リダイレクト時にもカスタムヘッダーを保持するハンドラ"""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new_req = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new_req:
            for k, v in COMMON_HEADERS.items():
                new_req.add_header(k, v)
        return new_req


class P舍Client:
    """セッションCookieとヘッダーを維持して通信を行うクライアント"""

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

    def init_session(self):
        """トップページを訪問してセッションCookie（XSRF-TOKEN / laravel_session）を確立"""
        print(f"[INFO] セッションCookieを初期化中... ({TOP_PAGE_URL})")
        top_headers = dict(COMMON_HEADERS)
        top_headers["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
        top_headers["Sec-Fetch-Dest"] = "document"
        top_headers["Sec-Fetch-Mode"] = "navigate"
        top_headers["Sec-Fetch-Site"] = "none"

        try:
            if self.use_requests:
                resp = self.session.get(TOP_PAGE_URL, headers=top_headers, timeout=15)
                resp.raise_for_status()
            else:
                req = urllib.request.Request(TOP_PAGE_URL, headers=top_headers)
                with self.opener.open(req, timeout=15) as resp:
                    resp.read()
            print("[INFO] セッションCookieの初期化に成功しました。")
        except Exception as e:
            print(f"[WARN] セッションCookie初期化時に警告 (処理は続行します): {e}", file=sys.stderr)

    def get_json(self, url: str) -> Dict[str, Any]:
        """指定URLからJSONを取得"""
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
    """
    ボーダーテキストから基準ボーダー値 (等価4.0円または設定1) を抽出する
    Returns:
        (border_val, border_equal, borders_dict)
    """
    """ボーダーテキストから基準ボーダー値 (等価4.0円または設定1) を抽出"""
    if not raw_text or not isinstance(raw_text, str):
        return ("情報なし", None, {})

    text = raw_text.strip()
    borders_dict: Dict[str, float] = {}

    # 1. 換金率別の数値を抽出 (4.0円, 3.57円/3.5円, 3.33円/3.3円, 3.03円/3.0円, 2.50円/2.5円 等)
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

    # 2. 基準ボーダーの選定
    # 4.0円がある場合
    if "4.00" in borders_dict:
        val = borders_dict["4.00"]
        return (val, val, borders_dict)

    # 設定付きパチンコの場合 (設定1を基準値とする)
    m_set1 = re.search(r"設定1[^\d\n]*?[…\:\s](\d+\.?\d*)\s*回転?", text)
    if m_set1:
        try:
            val = float(m_set1.group(1))
            borders_dict["4.00"] = val
            return (val, val, borders_dict)
        except ValueError:
            pass

    # 単一の「〇.〇回転」表記の場合
    m_single = re.search(r"(\d{1,2}\.\d)\s*回転", text)
    if m_single:
        try:
            val = float(m_single.group(1))
            borders_dict["4.00"] = val
            return (val, val, borders_dict)
        except ValueError:
            pass

    # 数値化できない場合は元テキストをそのまま保持
    return (text, None, borders_dict)


def determine_category_and_type(name: str, desc: str) -> Tuple[str, str]:
    """機種名や説明文からカテゴリ(e機/P機/羽根モノ)とスペック種別を判定"""
    """機種名や説明文からカテゴリとスペック種別を判定"""
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


def fetch_page(page: int, timeout: int = 15) -> Dict[str, Any]:
    """指定ページのAPIデータを取得"""
    url = f"{API_BASE_URL}?page={page}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json, text/plain, */*",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": "https://p-town.dmm.com/machine_borders",
        },
    )

    with urllib.request.urlopen(req, timeout=timeout) as resp:
        if resp.status != 200:
            raise RuntimeError(f"HTTP Status {resp.status} for {url}")
        content = resp.read().decode("utf-8")
        return json.loads(content)


def load_existing_data() -> List[Dict[str, Any]]:
    """既存の data/borders.json を読み込み"""
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
    """既存データのバックアップを作成"""
    if not existing_data:
        return False
    try:
        BACKUP_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(BACKUP_PATH, "w", encoding="utf-8") as f:
            json.dump(existing_data, f, ensure_ascii=False, indent=2)
        print(f"[INFO] 既存データのバックアップを作成しました: {BACKUP_PATH}")
        return True
    except Exception as e:
        print(f"[WARN] バックアップ作成失敗: {e}", file=sys.stderr)
        return False


def save_atomic(data: List[Dict[str, Any]]) -> bool:
    """アトミックに書き込みを行い、docs/data/borders.json も同期更新"""
    tmp_path = DATA_PATH.with_suffix(".tmp")
    docs_tmp_path = DOCS_DATA_PATH.with_suffix(".tmp")

    try:
        DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
        DOCS_DATA_PATH.parent.mkdir(parents=True, exist_ok=True)

        json_bytes = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")

        # data/borders.json
        with open(tmp_path, "wb") as f:
            f.write(json_bytes)
        os.replace(tmp_path, DATA_PATH)

        # docs/data/borders.json
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


def scrape_borders(max_pages: Optional[int] = None, delay_seconds: float = 2.0, dry_run: bool = False) -> List[Dict[str, Any]]:
    """
    複数ページをループ取得してデータを整形・保存する
    """
    print("=" * 60)
    print("DMMぱちタウン ボーダーデータ取得処理を開始します")
    print(f"最大ページ数: {max_pages if max_pages else '全ページ'}, ページ間待機: {delay_seconds}秒")
    print("=" * 60)

    # 1. 既存データのバックアップ
    existing_data = load_existing_data()
    if existing_data and not dry_run:
        create_backup(existing_data)

    client = P舍Client()
    client.init_session()

    collected_items: List[Dict[str, Any]] = []
    seen_ids = set()
    today_str = datetime.now().strftime("%Y-%m-%d")

    page = 1
    total_pages = 1

    try:
        while True:
            if max_pages and page > max_pages:
                print(f"[INFO] 指定最大ページ ({max_pages}) に達したためループを終了します。")
                break

            print(f"[INFO] ページ {page} を取得中... ({API_BASE_URL}?page={page})")
            data = fetch_page(page)
            # 301 リダイレクト回避: page=1 の場合はクエリなしの正規化URLを使用
            if page == 1:
                target_url = API_BASE_URL
            else:
                target_url = f"{API_BASE_URL}?page={page}"

            print(f"[INFO] ページ {page} を取得中... ({target_url})")
            data = client.get_json(target_url)

            items = data.get("data", [])
            total_pages = data.get("last_page", total_pages)
            total_count = data.get("total", 0)

            if not items:
                print(f"[INFO] ページ {page} のデータが空です。取得を終了します。")
                break

            for raw in items:
                machine_id = str(raw.get("id"))
                name = raw.get("name", "").strip()

                if not name:
                    continue

                # 重複排除
                if machine_id in seen_ids:
                    continue
                seen_ids.add(machine_id)

                maker_info = raw.get("maker") or {}
                maker_name = maker_info.get("name", "") if isinstance(maker_info, dict) else ""

                border_info = raw.get("border") or {}
                border_raw = border_info.get("border", "") if isinstance(border_info, dict) else ""

                border_val, border_equal, borders_map = parse_border_value(border_raw)

                # 詳細URL (https://p-town.dmm.com/machines/{id})
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

                collected_items.append(formatted_item)

            print(f"[INFO] ページ {page}/{total_pages} 取得完了 (現在累計: {len(collected_items)} 件)")

            if page >= total_pages:
                print("[INFO] 最終ページに到達しました。")
                break

            page += 1
            if delay_seconds > 0:
                time.sleep(delay_seconds)

    except Exception as e:
        print(f"[ERROR] 取得処理中にエラーが発生しました: {e}", file=sys.stderr)
        print("【安全装置発動】既存データを保護するため、更新を行わずに終了します。", file=sys.stderr)
        if not dry_run:
            sys.exit(1)
        return collected_items

    # 3. 安全性検証 (件数が0件の場合は絶対に上書きしない)
    if len(collected_items) == 0:
        print("[ERROR] 取得できたデータが 0 件です。", file=sys.stderr)
        print("【安全装置発動】既存の data/borders.json を破棄せず処理を中断します。", file=sys.stderr)
        if not dry_run:
            sys.exit(1)
        return []

    print("-" * 60)
    print(f"取得成功: 合計 {len(collected_items)} 件 (ユニーク)")
    print("-" * 60)

    # 4. 保存
    if dry_run:
        print("[INFO] dry-run モードのため、ファイル保存はスキップします。")
    else:
        success = save_atomic(collected_items)
        if success:
            print(f"[SUCCESS] {DATA_PATH} および {DOCS_DATA_PATH} に正常保存されました。")
        else:
            print("[ERROR] ファイル保存に失敗しました。", file=sys.stderr)
            sys.exit(1)

    return collected_items


def main():
    parser = argparse.ArgumentParser(description="DMMぱちタウンのボーダー情報を取得してJSONに保存します")
    parser.add_argument("--max-pages", type=int, default=None, help="取得する最大ページ数 (省略時は全ページ)")
    parser.add_argument("--delay", type=float, default=2.0, help="ページ間の待機秒数 (デフォルト: 2.0秒)")
    parser.add_argument("--dry-run", action="store_true", help="ファイルへの書き込みを行わず取得のみ確認")
    args = parser.parse_args()

    scrape_borders(max_pages=args.max_pages, delay_seconds=args.delay, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
