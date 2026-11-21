/**
 * ボーダーナビ - メインスクリプト (Vanilla JS)
 * ビルド不要・高速動作・オフライン/ローカル対応
 */

(function () {
  'use strict';

  // ==========================================================================
  // アプリケーション状態 (State)
  // ==========================================================================
  const state = {
    machines: [],
    favorites: new Set(),
    theme: 'light',
    searchQuery: '',
    selectedCategory: 'all',
    onlyFavorites: false,
    sortKey: 'border_asc',
    viewMode: 'card',
    // 交換率設定
    ratePreset: '3.57',
    customRateYen: 3.57,
    holdRatio: 70, // 0 - 100 %
    rentalRate: 4, // 4 or 1 円パチンコ
    // モーダル
    currentSimMachine: null,
    displayLimit: 60,
  };

  // ==========================================================================
  // DOM要素キャッシュ
  // ==========================================================================
  const els = {
    themeToggle: document.getElementById('themeToggle'),
    themeIcon: document.querySelector('.theme-icon'),
    dataTimestamp: document.getElementById('dataTimestamp'),
    itemCount: document.getElementById('itemCount'),
    // 計算パネル
    ratePreset: document.getElementById('ratePreset'),
    customRateGroup: document.getElementById('customRateGroup'),
    customBalls: document.getElementById('customBalls'),
    customYen: document.getElementById('customYen'),
    rentalSegment: document.getElementById('rentalSegment'),
    rentalBtns: document.querySelectorAll('#rentalSegment .segment-btn'),
    holdRatioSlider: document.getElementById('holdRatioSlider'),
    holdRatioValue: document.getElementById('holdRatioValue'),
    ratioPresets: document.querySelectorAll('.ratio-presets .preset-pill'),
    currentSettingSummary: document.getElementById('currentSettingSummary'),
    // フィルター & 検索
    searchInput: document.getElementById('searchInput'),
    clearSearchBtn: document.getElementById('clearSearchBtn'),
    filterChips: document.querySelectorAll('.filter-chip'),
    sortSelect: document.getElementById('sortSelect'),
    viewModeBtns: document.querySelectorAll('#viewMode .segment-btn'),
    // リストコンテナ
    cardContainer: document.getElementById('cardContainer'),
    tableContainer: document.getElementById('tableContainer'),
    tableBody: document.getElementById('tableBody'),
    emptyState: document.getElementById('emptyState'),
    resetFilterBtn: document.getElementById('resetFilterBtn'),
    // モーダル
    simModal: document.getElementById('simModal'),
    closeModalBtn: document.getElementById('closeModalBtn'),
    modalMachineName: document.getElementById('modalMachineName'),
    modalSpecInfo: document.getElementById('modalSpecInfo'),
    modalTargetBorder: document.getElementById('modalTargetBorder'),
    modalEqualBorder: document.getElementById('modalEqualBorder'),
    actualRotationInput: document.getElementById('actualRotationInput'),
    simDiffVal: document.getElementById('simDiffVal'),
    simEvalDesc: document.getElementById('simEvalDesc'),
    modalDetailLink: document.getElementById('modalDetailLink'),
  };

  // ==========================================================================
  // 初期化
  // ==========================================================================
  function init() {
    loadPreferences();
    setupEventListeners();
    fetchBordersData();
  }

  // ローカル設定の読み込み (Theme, Favorites)
  function loadPreferences() {
    try {
      const savedTheme = localStorage.getItem('border_nav_theme');
      if (savedTheme) {
        state.theme = savedTheme;
      } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        state.theme = 'dark';
      }
      applyTheme(state.theme);

      const savedFavs = localStorage.getItem('border_nav_favs');
      if (savedFavs) {
        state.favorites = new Set(JSON.parse(savedFavs));
      }
    } catch (e) {
      console.warn('LocalStorage error:', e);
    }
  }

  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    if (els.themeIcon) {
      els.themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
    }
    try {
      localStorage.setItem('border_nav_theme', theme);
    } catch (e) {}
  }

  // ==========================================================================
  // データ取得
  // ==========================================================================
  async function fetchBordersData() {
    const urls = [
      './data/borders.json',
      '../data/borders.json',
      'data/borders.json'
    ];

    let loaded = false;
    for (const url of urls) {
      try {
        const res = await fetch(`${url}?t=${Date.now()}`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            state.machines = data;
            loaded = true;
            updateDataMeta();
            render();
            break;
          }
        }
      } catch (err) {
        // 次のパスを試行
      }
    }

    if (!loaded) {
      els.dataTimestamp.textContent = 'データ取得失敗';
      els.emptyState.classList.remove('hidden');
      els.emptyState.querySelector('h3').textContent = 'データファイルを読み込めませんでした';
      els.emptyState.querySelector('p').textContent = 'data/borders.json が正しく配置されているかご確認ください。';
    }
  }

  function updateDataMeta() {
    els.itemCount.textContent = `${state.machines.length} 機種 登録`;
    const dates = state.machines.map(m => m.updated_at).filter(Boolean);
    if (dates.length > 0) {
      const latest = dates.sort().reverse()[0];
      els.dataTimestamp.textContent = `最終更新: ${latest}`;
    } else {
      els.dataTimestamp.textContent = `データ読み込み完了`;
    }
  }

  // ==========================================================================
  // 計算ロジック
  // ==========================================================================

  /**
   * 現在選択中の交換率 (円/玉) を取得
   */
  function getCurrentRateYen() {
    if (state.ratePreset === 'custom') {
      return state.customRateYen > 0 ? state.customRateYen : 3.57;
    }
    return parseFloat(state.ratePreset) || 3.57;
  }

  /**
   * 等価ボーダーから現在の設定に応じた合成ボーダーを計算
   * @param {number} equalBorder - 等価ボーダー (回/千円)
   * @returns {number} 計算後のボーダー (回/千円)
   */
  function calculateBorder(equalBorder) {
    if (!equalBorder || isNaN(equalBorder)) return 0;

    const rateYen = getCurrentRateYen();
    const holdRatio = state.holdRatio / 100; // 0.0 - 1.0

    // 換金率係数 (等価4.0円に対する換金率比)
    const exchangeFactor = rateYen / 4.0;

    // 合成換金効率: 持ち玉部分は等価(係数1.0)、現金投資部分は (交換率 / 4.0)
    const compositeEfficiency = holdRatio + (1.0 - holdRatio) * exchangeFactor;

    // 4円等価時のボーダー回転数に対する合成ボーダー
    let calculated = equalBorder / compositeEfficiency;

    // 1円パチンコの場合 (千円で1000玉貸出 = 4円パチの4倍回転)
    if (state.rentalRate === 1) {
      calculated = calculated * 4.0;
    }

    return Math.round(calculated * 10) / 10;
  }

  // 現在の設定サマリー文字列を更新
  function updateSettingSummary() {
    const rateYen = getCurrentRateYen();
    const balls = Math.round((1000 / rateYen) * 10) / 10;
    const rentalText = state.rentalRate === 1 ? '1パチ' : '4パチ';
    
    let rateText = `${balls}玉 (${rateYen.toFixed(2)}円)`;
    if (Math.abs(rateYen - 4.0) < 0.01) {
      rateText = '等価 (4.00円)';
    }

    els.currentSettingSummary.textContent = `${rentalText} | ${rateText} / 持ち玉 ${state.holdRatio}%`;
  }

  // ==========================================================================
  // フィルタ・ソート・レンダリング
  // ==========================================================================
  function getFilteredAndSortedMachines() {
    let list = [...state.machines];

    // 1. お気に入りフィルター
    if (state.onlyFavorites) {
      list = list.filter(m => state.favorites.has(m.id));
    }

    // 2. カテゴリフィルター
    if (state.selectedCategory !== 'all') {
      list = list.filter(m => {
        if (state.selectedCategory === 'P機') return m.category === 'P機' || (m.type && m.type.includes('P機'));
        if (state.selectedCategory === 'e機') return m.category === 'e機' || (m.type && m.type.includes('スマパチ'));
        if (state.selectedCategory === '羽根モノ') return m.category === '羽根モノ' || (m.type && m.type.includes('羽根'));
        return true;
      });
    }

    // 3. 検索キーワードフィルター
    if (state.searchQuery.trim() !== '') {
      const q = state.searchQuery.toLowerCase().trim();
      list = list.filter(m => {
        const name = (m.name || '').toLowerCase();
        const maker = (m.maker || '').toLowerCase();
        const type = (m.type || '').toLowerCase();
        const notes = (m.notes || '').toLowerCase();
        return name.includes(q) || maker.includes(q) || type.includes(q) || notes.includes(q);
      });
    }

    // 4. ソート
    list.sort((a, b) => {
      const calcA = calculateBorder(a.border_equal);
      const calcB = calculateBorder(b.border_equal);

      switch (state.sortKey) {
        case 'border_asc':
          return calcA - calcB;
        case 'border_desc':
          return calcB - calcA;
        case 'release_desc':
          return (b.release_date || '').localeCompare(a.release_date || '');
        case 'name_asc':
          return (a.name || '').localeCompare(b.name || '', 'ja');
        default:
          return 0;
      }
    });

    return list;
  }

  function render() {
    updateSettingSummary();
    const allFiltered = getFilteredAndSortedMachines();
    const totalCount = allFiltered.length;

    if (els.itemCount) {
      els.itemCount.textContent = `表示中: ${Math.min(state.displayLimit, totalCount)} / ${totalCount} 件 (全${state.machines.length}件)`;
    }

    if (totalCount === 0) {
      els.cardContainer.classList.add('hidden');
      els.tableContainer.classList.add('hidden');
      els.emptyState.classList.remove('hidden');
      return;
    }

    els.emptyState.classList.add('hidden');
    const displayList = allFiltered.slice(0, state.displayLimit);

    if (state.viewMode === 'card') {
      els.cardContainer.classList.remove('hidden');
      els.tableContainer.classList.add('hidden');
      renderCards(displayList, totalCount);
    } else {
      els.cardContainer.classList.add('hidden');
      els.tableContainer.classList.remove('hidden');
      renderTable(displayList, totalCount);
    }
  }

  // カード表示のレンダリング
  function renderCards(machines, totalCount) {
    els.cardContainer.innerHTML = '';
    const fragment = document.createDocumentFragment();

    machines.forEach(machine => {
      const calcBorder = calculateBorder(machine.border_equal);
      const isFav = state.favorites.has(machine.id);
      const diff = Math.round((calcBorder - machine.border_equal) * 10) / 10;
      const diffSign = diff > 0 ? `+${diff.toFixed(1)}` : (diff === 0 ? '±0.0' : diff.toFixed(1));
      const diffClass = diff > 0 ? 'plus' : 'even';

      // カテゴリタグ判定
      let tagClass = 'tag-p';
      let tagText = machine.category || 'P機';
      if (tagText.includes('e') || (machine.type && machine.type.includes('スマパチ'))) {
        tagClass = 'tag-e';
        tagText = 'スマパチ';
      } else if (tagText.includes('羽根')) {
        tagClass = 'tag-hane';
        tagText = '羽根モノ';
      }

      const card = document.createElement('article');
      card.className = 'machine-card';
      card.innerHTML = `
        <div>
          <div class="card-top">
            <div class="card-tags">
              <span class="tag-badge ${tagClass}">${escapeHtml(tagText)}</span>
              <span class="tag-badge tag-maker">${escapeHtml(machine.maker || 'メーカー不明')}</span>
              ${machine.release_date ? `<span class="tag-badge tag-maker">${escapeHtml(machine.release_date)}導入</span>` : ''}
            </div>
            <button class="fav-star-btn ${isFav ? 'is-fav' : ''}" data-id="${machine.id}" title="${isFav ? 'お気に入り解除' : 'お気に入り登録'}">
              ★
            </button>
          </div>

          <h3 class="machine-name">${escapeHtml(machine.name)}</h3>
          <p class="machine-spec">${escapeHtml(machine.type || '')}</p>

          <div class="card-border-highlight">
            <div class="border-main-block">
              <span class="border-label">設定条件ボーダー</span>
              <div class="border-value-box">
                <span class="border-large-number">${calcBorder.toFixed(1)}</span>
                <span class="border-unit">回/千円</span>
              </div>
            </div>
            <div class="border-sub-block">
              <div>等価: <span class="equal-border-val">${(machine.border_equal || 0).toFixed(1)}</span></div>
              <span class="diff-badge ${diffClass}">${diffSign}</span>
            </div>
          </div>

          <!-- 各換金率での目安ミニテーブル -->
          <div class="rate-mini-table">
            <div class="rate-mini-item">
              <span class="rate-lbl">等価</span>
              <span class="rate-val">${machine.borders && machine.borders['4.00'] ? machine.borders['4.00'] : (machine.border_equal || '-')}</span>
            </div>
            <div class="rate-mini-item">
              <span class="rate-lbl">28玉</span>
              <span class="rate-val">${machine.borders && machine.borders['3.57'] ? machine.borders['3.57'] : '-'}</span>
            </div>
            <div class="rate-mini-item">
              <span class="rate-lbl">30玉</span>
              <span class="rate-val">${machine.borders && machine.borders['3.33'] ? machine.borders['3.33'] : '-'}</span>
            </div>
            <div class="rate-mini-item">
              <span class="rate-lbl">33玉</span>
              <span class="rate-val">${machine.borders && machine.borders['3.03'] ? machine.borders['3.03'] : '-'}</span>
            </div>
            <div class="rate-mini-item">
              <span class="rate-lbl">40玉</span>
              <span class="rate-val">${machine.borders && machine.borders['2.50'] ? machine.borders['2.50'] : '-'}</span>
            </div>
          </div>
        </div>

        <div class="card-bottom">
          <button class="btn-sim" data-id="${machine.id}" title="実測回転数から簡易判定">
            期待値シミュ
          </button>
          <a href="${escapeHtml(machine.detail_url || '#')}" target="_blank" rel="noopener noreferrer" class="btn-detail">
            詳細・解析 ↗
          </a>
        </div>
      `;

      fragment.appendChild(card);
    });

    els.cardContainer.appendChild(fragment);

    // さらに表示ボタン
    if (machines.length < totalCount) {
      const moreCard = document.createElement('div');
      moreCard.style.gridColumn = '1 / -1';
      moreCard.style.textAlign = 'center';
      moreCard.style.padding = '1.5rem';
      moreCard.innerHTML = `
        <button id="loadMoreBtn" class="btn-primary" style="padding: 0.8rem 2rem;">
          さらに表示する (残り ${totalCount - machines.length} 件)
        </button>
      `;
      els.cardContainer.appendChild(moreCard);
      document.getElementById('loadMoreBtn').addEventListener('click', () => {
        state.displayLimit += 60;
        render();
      });
    }
  }

  // テーブル表示のレンダリング
  function renderTable(machines, totalCount) {
    els.tableBody.innerHTML = '';
    const fragment = document.createDocumentFragment();

    machines.forEach(machine => {
      const calcBorder = calculateBorder(machine.border_equal);
      const isFav = state.favorites.has(machine.id);

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="td-fav">
          <button class="fav-star-btn ${isFav ? 'is-fav' : ''}" data-id="${machine.id}">★</button>
        </td>
        <td>
          <div style="font-weight: 700;">${escapeHtml(machine.name)}</div>
          <small style="color: var(--text-muted);">${escapeHtml(machine.maker || '')}</small>
        </td>
        <td>${escapeHtml(machine.type || '')}</td>
        <td><span class="calc-val">${calcBorder.toFixed(1)}</span> <small>回/千円</small></td>
        <td>${(machine.border_equal || 0).toFixed(1)} <small>回</small></td>
        <td>${escapeHtml(machine.release_date || '-')}</td>
        <td>
          <a href="${escapeHtml(machine.detail_url || '#')}" target="_blank" rel="noopener noreferrer" class="btn-detail" style="display:inline-block; padding:0.3rem 0.6rem;">
            詳細 ↗
          </a>
        </td>
      `;
      fragment.appendChild(tr);
    });

    els.tableBody.appendChild(fragment);

    // テーブル用のさらに表示ボタン
    if (machines.length < totalCount) {
      const moreTr = document.createElement('tr');
      moreTr.innerHTML = `
        <td colspan="7" style="text-align: center; padding: 1.25rem;">
          <button id="loadMoreTableBtn" class="btn-primary" style="padding: 0.6rem 1.5rem;">
            さらに表示する (残り ${totalCount - machines.length} 件)
          </button>
        </td>
      `;
      els.tableBody.appendChild(moreTr);
      document.getElementById('loadMoreTableBtn').addEventListener('click', () => {
        state.displayLimit += 60;
        render();
      });
    }
  }

  // ==========================================================================
  // モーダル (期待値クイックシミュレータ)
  // ==========================================================================
  function openSimModal(machineId) {
    const machine = state.machines.find(m => m.id === machineId);
    if (!machine) return;

    state.currentSimMachine = machine;
    const targetBorder = calculateBorder(machine.border_equal);

    els.modalMachineName.textContent = machine.name;
    els.modalSpecInfo.textContent = `${machine.maker} | ${machine.type}`;
    els.modalTargetBorder.textContent = targetBorder.toFixed(1);
    els.modalEqualBorder.textContent = (machine.border_equal || 0).toFixed(1);
    els.modalDetailLink.href = machine.detail_url || '#';

    els.actualRotationInput.value = '';
    els.simDiffVal.textContent = '--';
    els.simDiffVal.className = 'diff-val';
    els.simEvalDesc.textContent = '実測の回転数を入力すると、ボーダーに対する期待値水準を判定します。';

    els.simModal.classList.remove('hidden');
    els.actualRotationInput.focus();
  }

  function updateSimulation() {
    if (!state.currentSimMachine) return;
    const targetBorder = calculateBorder(state.currentSimMachine.border_equal);
    const actual = parseFloat(els.actualRotationInput.value);

    if (isNaN(actual) || actual <= 0) {
      els.simDiffVal.textContent = '--';
      els.simDiffVal.className = 'diff-val';
      els.simEvalDesc.textContent = '実測の回転数を入力すると、ボーダーに対する期待値水準を判定します。';
      return;
    }

    const diff = Math.round((actual - targetBorder) * 10) / 10;
    const sign = diff > 0 ? `+${diff.toFixed(1)}` : (diff === 0 ? '±0.0' : diff.toFixed(1));

    els.simDiffVal.textContent = `${sign} 回/千円`;

    if (diff >= 3.0) {
      els.simDiffVal.className = 'diff-val positive';
      els.simEvalDesc.textContent = '🎉 【超優秀台】日当期待値+2万円以上が狙える非常に強い回転数水準です。';
    } else if (diff >= 1.5) {
      els.simDiffVal.className = 'diff-val positive';
      els.simEvalDesc.textContent = '👍 【優秀台】時給1,000円〜1,500円前後のプラス期待値が見込めるプラス調整台です。';
    } else if (diff >= 0) {
      els.simDiffVal.className = 'diff-val positive';
      els.simEvalDesc.textContent = '⚖️ 【ボーダー付近】トントン〜微プラス水準です。出玉削りや止め打ち精度に注意。';
    } else {
      els.simDiffVal.className = 'diff-val negative';
      els.simEvalDesc.textContent = '⚠️ 【マイナス台】回すほど損失が出る水準です。台移動を推奨します。';
    }
  }

  function closeSimModal() {
    els.simModal.classList.add('hidden');
    state.currentSimMachine = null;
  }

  // ==========================================================================
  // イベントリスナー設定
  // ==========================================================================
  function setupEventListeners() {
    // テーマ切り替え
    els.themeToggle.addEventListener('click', () => {
      applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    });

    // 交換率プリセット変更
    els.ratePreset.addEventListener('change', (e) => {
      state.ratePreset = e.target.value;
      if (state.ratePreset === 'custom') {
        els.customRateGroup.classList.remove('hidden');
      } else {
        els.customRateGroup.classList.add('hidden');
      }
      render();
    });

    // カスタム玉数入力
    els.customBalls.addEventListener('input', (e) => {
      const balls = parseFloat(e.target.value);
      if (balls > 0) {
        state.customRateYen = Math.round((1000 / balls) * 100) / 100;
        els.customYen.value = state.customRateYen.toFixed(2);
        render();
      }
    });

    // カスタム円入力
    els.customYen.addEventListener('input', (e) => {
      const yen = parseFloat(e.target.value);
      if (yen > 0) {
        state.customRateYen = yen;
        els.customBalls.value = (Math.round((1000 / yen) * 10) / 10).toFixed(1);
        render();
      }
    });

    // 貸玉レートセグメント
    els.rentalBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        els.rentalBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.rentalRate = parseInt(btn.dataset.rental, 10);
        render();
      });
    });

    // 持ち玉比率スライダー
    els.holdRatioSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      state.holdRatio = val;
      els.holdRatioValue.textContent = `${val}%`;

      // プリセットピルのアクティブ状態同期
      els.ratioPresets.forEach(pill => {
        pill.classList.toggle('active', parseInt(pill.dataset.ratio, 10) === val);
      });

      render();
    });

    // 持ち玉比率プリセットピル
    els.ratioPresets.forEach(pill => {
      pill.addEventListener('click', () => {
        const val = parseInt(pill.dataset.ratio, 10);
        state.holdRatio = val;
        els.holdRatioSlider.value = val;
        els.holdRatioValue.textContent = `${val}%`;
        els.ratioPresets.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        render();
      });
    });

    // 検索入力
    els.searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      state.displayLimit = 60;
      els.clearSearchBtn.classList.toggle('hidden', state.searchQuery === '');
      render();
    });

    els.clearSearchBtn.addEventListener('click', () => {
      state.searchQuery = '';
      state.displayLimit = 60;
      els.searchInput.value = '';
      els.clearSearchBtn.classList.add('hidden');
      render();
      els.searchInput.focus();
    });

    // カテゴリフィルター
    els.filterChips.forEach(chip => {
      chip.addEventListener('click', () => {
        state.displayLimit = 60;
        const filterType = chip.dataset.filterType;
        const val = chip.dataset.val;

        if (filterType === 'fav') {
          state.onlyFavorites = !state.onlyFavorites;
          chip.classList.toggle('active', state.onlyFavorites);
        } else {
          state.selectedCategory = val;
          els.filterChips.forEach(c => {
            if (c.dataset.filterType === 'category') c.classList.remove('active');
          });
          chip.classList.add('active');
        }
        render();
      });
    });

    // ソート順
    els.sortSelect.addEventListener('change', (e) => {
      state.sortKey = e.target.value;
      state.displayLimit = 60;
      render();
    });

    // ビュー切り替え (カード / テーブル)
    els.viewModeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        els.viewModeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.viewMode = btn.dataset.view;
        render();
      });
    });

    // 条件リセットボタン
    els.resetFilterBtn.addEventListener('click', () => {
      state.searchQuery = '';
      state.selectedCategory = 'all';
      state.onlyFavorites = false;
      els.searchInput.value = '';
      els.clearSearchBtn.classList.add('hidden');
      els.filterChips.forEach(c => {
        if (c.dataset.filterType === 'category') {
          c.classList.toggle('active', c.dataset.val === 'all');
        } else if (c.dataset.filterType === 'fav') {
          c.classList.remove('active');
        }
      });
      render();
    });

    // お気に入りクリック & シミュレーションボタン委任 (カード・テーブル共通)
    document.addEventListener('click', (e) => {
      // お気に入り
      const favBtn = e.target.closest('.fav-star-btn');
      if (favBtn) {
        const id = favBtn.dataset.id;
        if (state.favorites.has(id)) {
          state.favorites.delete(id);
        } else {
          state.favorites.add(id);
        }
        try {
          localStorage.setItem('border_nav_favs', JSON.stringify([...state.favorites]));
        } catch (err) {}
        render();
        return;
      }

      // シミュレーションモーダル呼び出し
      const simBtn = e.target.closest('.btn-sim');
      if (simBtn) {
        openSimModal(simBtn.dataset.id);
        return;
      }
    });

    // モーダル操作
    els.closeModalBtn.addEventListener('click', closeSimModal);
    els.simModal.addEventListener('click', (e) => {
      if (e.target === els.simModal) closeSimModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !els.simModal.classList.contains('hidden')) {
        closeSimModal();
      }
    });
    els.actualRotationInput.addEventListener('input', updateSimulation);
  }

  // ==========================================================================
  // ユーティリティ
  // ==========================================================================
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // 起動実行
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
