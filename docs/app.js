/**
 * ボーダーナビ - メインスクリプト (Vanilla JS)
 * ビルド不要・高速動作・オフライン/ローカル対応
 */

(function () {
  'use strict';

  // ==========================================================================
  // 定数定義 & アプリケーション状態 (State)
  // ==========================================================================
  const RATE_PRESETS = {
    4: [
      { value: '25', label: '25.0玉交換 (等価 / 4.00円)', balls: 25.0, yen: 4.00 },
      { value: '27.5', label: '27.5玉交換 (3.64円)', balls: 27.5, yen: 3.636 },
      { value: '28', label: '28.0玉交換 (3.57円)', balls: 28.0, yen: 3.571 },
      { value: 'custom', label: 'カスタム（直接指定）' }
    ],
    1: [
      { value: '100', label: '100.0玉交換 (等価 / 1.00円)', balls: 100.0, yen: 1.00 },
      { value: '110', label: '110.0玉交換 (0.91円)', balls: 110.0, yen: 0.909 },
      { value: '112', label: '112.0玉交換 (0.89円)', balls: 112.0, yen: 0.893 },
      { value: 'custom', label: 'カスタム（直接指定）' }
    ]
  };

  const state = {
    machines: [],
    favorites: new Set(),
    theme: 'light',
    searchQuery: '',
    selectedCategory: 'all',
    onlyFavorites: false,
    sortKey: 'border_asc',
    viewMode: 'card',
    // 交換率設定 (初期値: 4パチ 28玉交換)
    ratePreset: '28',
    customBalls: 28.0,
    customYen: 3.57,
    holdRatio: 70, // 0 - 100 %
    rentalRate: 4, // 4 or 1 円パチンコ
    // モーダル & 表示制限
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
    updateRatePresetOptions(state.rentalRate);
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
  // 計算ロジック & レート連動
  // ==========================================================================

  /**
   * レートに応じた交換率セレクトボックスの選択肢を更新
   */
  function updateRatePresetOptions(newRentalRate) {
    const oldRental = state.rentalRate;
    state.rentalRate = newRentalRate;

    // 選択値の自動変換 (4円 ⇔ 1円)
    if (oldRental !== newRentalRate) {
      if (state.ratePreset !== 'custom') {
        if (newRentalRate === 1) {
          // 4円から1円へ (4倍)
          if (state.ratePreset === '25') state.ratePreset = '100';
          else if (state.ratePreset === '27.5') state.ratePreset = '110';
          else if (state.ratePreset === '28') state.ratePreset = '112';
          else state.ratePreset = '112';
        } else {
          // 1円から4円へ (1/4倍)
          if (state.ratePreset === '100') state.ratePreset = '25';
          else if (state.ratePreset === '110') state.ratePreset = '27.5';
          else if (state.ratePreset === '112') state.ratePreset = '28';
          else state.ratePreset = '28';
        }
      }

      // カスタム入力欄の連動
      if (newRentalRate === 1) {
        if (els.customBalls) els.customBalls.placeholder = '112.0';
        if (els.customYen) els.customYen.placeholder = '0.89';
        state.customBalls = 112.0;
        state.customYen = 0.89;
      } else {
        if (els.customBalls) els.customBalls.placeholder = '28.0';
        if (els.customYen) els.customYen.placeholder = '3.57';
        state.customBalls = 28.0;
        state.customYen = 3.57;
      }
      if (els.customBalls && els.customBalls.value) els.customBalls.value = state.customBalls.toFixed(1);
      if (els.customYen && els.customYen.value) els.customYen.value = state.customYen.toFixed(2);
    }

    // セレクトボックスのオプション再構築
    const options = RATE_PRESETS[newRentalRate] || RATE_PRESETS[4];
    els.ratePreset.innerHTML = '';
    options.forEach(opt => {
      const optionEl = document.createElement('option');
      optionEl.value = opt.value;
      optionEl.textContent = opt.label;
      if (opt.value === state.ratePreset) {
        optionEl.selected = true;
      }
      els.ratePreset.appendChild(optionEl);
    });

    els.customRateGroup.classList.toggle('hidden', state.ratePreset !== 'custom');
  }

  /**
   * 現在の交換率情報 (玉数, 1玉あたり円, 換金効率) を取得
   */
  function getCurrentRateInfo() {
    const rental = state.rentalRate; // 4 or 1

    let balls = rental === 1 ? 112.0 : 28.0;
    let yenPerBall = rental === 1 ? 0.893 : 3.571;

    if (state.ratePreset === 'custom') {
      balls = state.customBalls > 0 ? state.customBalls : (rental === 1 ? 112.0 : 28.0);
      yenPerBall = state.customYen > 0 ? state.customYen : (100.0 / balls);
    } else {
      balls = parseFloat(state.ratePreset);
      yenPerBall = 100.0 / balls;
    }

    return {
      balls: balls,
      yen: yenPerBall,
      efficiency: (rental === 1 ? 100.0 : 25.0) / balls
    };
  }

  /**
   * 等価ボーダーから現在の設定に応じた合成ボーダーを計算
   * @param {number} equalBorder - 4円等価ボーダー (回/千円)
   * @returns {number} 計算後のボーダー (回/千円)
   */
  function calculateBorder(equalBorder) {
    if (!equalBorder || isNaN(equalBorder)) return 0;

    const rateInfo = getCurrentRateInfo();
    const holdRatio = state.holdRatio / 100; // 0.0 - 1.0

    // 合成換金効率: 持ち玉部分は等価(1.0)、現金部分は換金率比
    const compositeEfficiency = holdRatio + (1.0 - holdRatio) * rateInfo.efficiency;

    // 千円あたりのボーダー回転数
    let calculated = (equalBorder * (state.rentalRate === 1 ? 4.0 : 1.0)) / compositeEfficiency;

    return Math.round(calculated * 10) / 10;
  }

  /**
   * 特定の玉数での完全現金ボーダーを計算 (ミニテーブル用)
   */
  function calculateCashBorderForBalls(equalBorder, targetBalls) {
    if (!equalBorder || isNaN(equalBorder)) return '-';
    const baseBalls = state.rentalRate === 1 ? 100.0 : 25.0;
    const efficiency = baseBalls / targetBalls;
    const calculated = (equalBorder * (state.rentalRate === 1 ? 4.0 : 1.0)) / efficiency;
    return (Math.round(calculated * 10) / 10).toFixed(1);
  }

  // 現在の設定サマリー文字列を更新
  function updateSettingSummary() {
    const rateInfo = getCurrentRateInfo();
    const rentalText = state.rentalRate === 1 ? '1パチ' : '4パチ';
    const isEquivalent = (state.rentalRate === 4 && Math.abs(rateInfo.balls - 25.0) < 0.1) ||
                         (state.rentalRate === 1 && Math.abs(rateInfo.balls - 100.0) < 0.1);
    
    let rateText = `${rateInfo.balls.toFixed(1)}玉 (${rateInfo.yen.toFixed(2)}円)`;
    if (isEquivalent) {
      rateText = `等価 (${rateInfo.balls.toFixed(0)}玉 / ${rateInfo.yen.toFixed(2)}円)`;
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
      const baseEqual = (machine.border_equal || 0) * (state.rentalRate === 1 ? 4.0 : 1.0);
      const calcBorder = calculateBorder(machine.border_equal);
      const isFav = state.favorites.has(machine.id);
      const diff = Math.round((calcBorder - baseEqual) * 10) / 10;
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
              <div>等価: <span class="equal-border-val">${baseEqual.toFixed(1)}</span></div>
              <span class="diff-badge ${diffClass}">${diffSign}</span>
            </div>
          </div>

          <!-- 各換金率での目安ミニテーブル (25/27.5/28玉 または 100/110/112玉) -->
          <div class="rate-mini-table">
            <div class="rate-mini-item">
              <span class="rate-lbl">${state.rentalRate === 1 ? '100玉(等価)' : '25玉(等価)'}</span>
              <span class="rate-val">${calculateCashBorderForBalls(machine.border_equal, state.rentalRate === 1 ? 100 : 25)}</span>
            </div>
            <div class="rate-mini-item">
              <span class="rate-lbl">${state.rentalRate === 1 ? '110玉' : '27.5玉'}</span>
              <span class="rate-val">${calculateCashBorderForBalls(machine.border_equal, state.rentalRate === 1 ? 110 : 27.5)}</span>
            </div>
            <div class="rate-mini-item">
              <span class="rate-lbl">${state.rentalRate === 1 ? '112玉' : '28玉'}</span>
              <span class="rate-val">${calculateCashBorderForBalls(machine.border_equal, state.rentalRate === 1 ? 112 : 28)}</span>
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
        <td>${((machine.border_equal || 0) * (state.rentalRate === 1 ? 4.0 : 1.0)).toFixed(1)} <small>回</small></td>
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
    const equalVal = (machine.border_equal || 0) * (state.rentalRate === 1 ? 4.0 : 1.0);
    els.modalEqualBorder.textContent = equalVal.toFixed(1);
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
        if (!els.customBalls.value) {
          els.customBalls.value = (state.rentalRate === 1 ? 112.0 : 28.0).toFixed(1);
          els.customYen.value = (state.rentalRate === 1 ? 0.89 : 3.57).toFixed(2);
        }
      } else {
        els.customRateGroup.classList.add('hidden');
      }
      render();
    });

    // カスタム玉数入力 (100円あたりの玉数)
    els.customBalls.addEventListener('input', (e) => {
      const balls = parseFloat(e.target.value);
      if (balls > 0) {
        state.customBalls = balls;
        state.customYen = Math.round((100.0 / balls) * 100) / 100;
        els.customYen.value = state.customYen.toFixed(2);
        render();
      }
    });

    // カスタム円入力 (1玉あたりの換金金額)
    els.customYen.addEventListener('input', (e) => {
      const yen = parseFloat(e.target.value);
      if (yen > 0) {
        state.customYen = yen;
        state.customBalls = Math.round((100.0 / yen) * 10) / 10;
        els.customBalls.value = state.customBalls.toFixed(1);
        render();
      }
    });

    // 貸玉レートセグメント (4円 ⇔ 1円)
    els.rentalBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        els.rentalBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const rental = parseInt(btn.dataset.rental, 10);
        updateRatePresetOptions(rental);
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
