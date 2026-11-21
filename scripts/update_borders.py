#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ボーダーデータ自動収集・更新エントリーポイント
scripts/scrape.py を呼び出します。
"""

import sys
from pathlib import Path

# 同一ディレクトリの scrape モジュールを実行
sys.path.insert(0, str(Path(__file__).resolve().parent))
from scrape import scrape_borders

if __name__ == "__main__":
    scrape_borders()
