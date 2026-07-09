// ========== 前端介面與動態渲染 (UI) ==========

window.render = function() {
  const p = window.state.game.player;
  const sceneData = window.state.world.scenes[window.state.game.scene] || { title: window.state.game.scene };

  window.selectors.sceneTitle.textContent = sceneData.title;

  window.renderSidebar();

  if (window.state.game.history.length === 0) {
    window.renderQuickActions(sceneData.choices || []);
  } else {
    const lastEntry = window.state.game.history[window.state.game.history.length - 1];
    window.renderQuickActions(lastEntry?.result?.suggested_options || []);
  }

  // 更新最後渲染的數值快照，為下次補間動畫做準備
  window.state.lastStats = {
    '生命': p.hp || 0,
    '靈力': p.sp || 0,
    '業力': p.threat || 0,
    ...(p.abilities ? Object.fromEntries(Object.entries(p.abilities).map(([n, v]) => [n, typeof v === 'object' ? v.val : v])) : {})
  };
};

window.renderSidebar = function() {
  const p = window.state.game.player;
  const sceneData = window.state.world.scenes[window.state.game.scene] || { title: window.state.game.scene };

  window.renderExpandedView(p, sceneData.title);
  window.renderCollapsedView(p);

  window.attachSidebarListeners();
};

window.renderExpandedView = function(p, sceneTitle) {
  window.selectors.sidebarExpanded.innerHTML = `
    <div class="sidebar-header">
      <div class="logo">
        <span class="logo-text">TIANYAN</span>
        <span class="logo-sub">天機錄 ${window.SETTINGS.VERSION}</span>
      </div>
    </div>

    <div class="stats-group">
      ${window.renderStatItemHTML('生命', p.hp || 0, '#ef4444')}
      ${window.renderStatItemHTML('靈力', p.sp || 0, '#3b82f6')}
      ${window.renderStatItemHTML('業力', p.threat || 0, '#a855f7')}
      ${p.abilities ? Object.entries(p.abilities).map(([name, value]) => window.renderStatItemHTML(name, value, '#E2B87E')).join('') : ''}
    </div>

    <div class="action-menu">
      <button id="btn-settings-exp" class="icon-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>
        <span>冥想配置</span>
      </button>
      <button id="export-save-exp" class="icon-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
        <span>匯出命錄</span>
      </button>
      <button id="import-save-exp" class="icon-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        <span>讀取因果</span>
      </button>
      <button id="clear-game-exp" class="icon-btn danger">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
        <span>重塑乾坤</span>
      </button>
    </div>

    <div class="location-badge">
      <span class="label">當前坐標</span>
      <span class="value">${sceneTitle}</span>
    </div>
  `;
};

window.renderCollapsedView = function(p) {
  const stats = [
    { label: '生命', value: p.hp || 0, color: '#ef4444' },
    { label: '靈力', value: p.sp || 0, color: '#3b82f6' },
    { label: '業力', value: p.threat || 0, color: '#a855f7' },
    ...(p.abilities ? Object.entries(p.abilities).map(([k, v]) => ({
      label: k.slice(0, 2),
      value: typeof v === 'object' ? `${v.val}/${v.max}` : v,
      color: '#E2B87E'
    })) : [])
  ];

  window.selectors.sidebarCollapsed.innerHTML = `
    <div class="collapsed-block">
      <div class="collapsed-stats desktop-only">
        ${stats.map(s => `
          <div class="stat-dot-wrapper">
            <div class="stat-dot" style="background: ${s.color}; box-shadow: 0 0 8px ${s.color};"></div>
            <div class="dot-tooltip">${s.label}: ${s.label === '解析度' ? s.value + '%' : s.value}</div>
          </div>
        `).join('')}
      </div>

      <div class="stat-orb mobile-only" id="mobile-orb">
        <div class="orb-content">
          ${stats.map((s, i) => {
            const displayVal = s.label === '解析度' ? `${s.value}%` : s.value;
            const hasChanged = window.state.lastStats[s.label] !== s.value;
            return `
              <div class="orb-stat-slide ${i === 0 ? 'active' : ''}" style="--stat-color: ${s.color}" data-label="${s.label}">
                <span class="orb-label">${s.label}</span>
                <span class="orb-value">${window.createOdometerHTML(displayVal, hasChanged)}</span>
              </div>
            `;
          }).join('')}
        </div>
        <div class="orb-ring"></div>
      </div>

      <div class="collapsed-actions">
        <button id="btn-settings-col" class="circle-btn" title="冥想配置"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg></button>
        <button id="export-save-col" class="circle-btn" title="匯出命錄"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg></button>
        <button id="import-save-col" class="circle-btn" title="讀取因果"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></button>
        <button id="clear-game-col" class="circle-btn danger" title="重塑乾坤"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>
      </div>
    </div>
  `;

  setTimeout(() => {
    const strips = document.querySelectorAll('.orb-stat-slide .odo-strip.animate-me');
    strips.forEach(strip => {
      const val = strip.dataset.value;
      strip.style.transform = `translateY(-${val * 1.5}em)`;
    });
  }, 50);

  window.startOrbCycling();
};

window.createOdometerHTML = function(value, animate = true) {
  const str = String(value);
  return `
    <div class="odometer">
      ${str.split('').map(char => {
        if (isNaN(parseInt(char)) || char === ' ') return `<span class="odo-static">${char}</span>`;
        const digit = parseInt(char);
        const initialTransform = animate ? '0em' : `-${digit * 1.5}em`;
        const animateClass = animate ? 'animate-me' : '';
        return `
          <div class="odo-digit">
            <div class="odo-strip ${animateClass}" style="transform: translateY(${initialTransform})" data-value="${digit}">
              ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<span>${n}</span>`).join('')}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
};

window.renderStatItemHTML = function(label, value, color) {
  const safeLabel = btoa(unescape(encodeURIComponent(label))).replace(/=/g, '');

  let displayValue = value;
  let progress = 0;
  let hasChanged = false;

  if (typeof value === 'object' && value !== null) {
    displayValue = `${value.val}/${value.max}`;
    progress = value.max > value.min ? ((value.val - value.min) / (value.max - value.min)) * 100 : 0;
    hasChanged = window.state.lastStats[label] !== value.val;
  } else {
    displayValue = label === '解析度' ? `${value}%` : value;
    progress = Math.min(100, value);
    hasChanged = window.state.lastStats[label] !== value;
  }

  const odoHTML = window.createOdometerHTML(displayValue, hasChanged);

  if (hasChanged) {
    setTimeout(() => {
      const strips = document.querySelectorAll(`#stat-item-${safeLabel} .odo-strip.animate-me`);
      strips.forEach(strip => {
        const val = strip.dataset.value;
        strip.style.transform = `translateY(-${val * 1.5}em)`;
      });
    }, 50);
  }

  return `
    <div class="stat-item" id="stat-item-${safeLabel}">
      <span class="label">${label}</span>
      <span class="value ${String(displayValue).length > 5 ? 'long' : ''}">${odoHTML}</span>
      <div class="value-bar-container">
        <div class="value-bar" id="bar-${safeLabel}" style="width: ${Math.max(0, Math.min(100, progress))}%; background: ${color}; box-shadow: 0 0 10px ${color}66;"></div>
      </div>
    </div>
  `;
};

window.renderQuickActions = function(options) {
  window.state.quickActionIndex = -1;
  window.selectors.quickActions.innerHTML = '';
  options.slice(0, 4).forEach((opt, index) => {
    const btn = document.createElement('button');
    btn.className = 'quick-btn glass';

    const displayOpt = opt.length > 5 ? opt.slice(0, 5) + '...' : opt;

    btn.innerHTML = `
      <span class="quick-index">${index + 1}</span>
      <span class="quick-text">${displayOpt}</span>
      <div class="quick-tooltip">${opt}</div>
    `;

    btn.addEventListener('click', () => {
      window.selectors.playerAction.value = opt;
      window.selectors.playerAction.focus();
    });
    window.selectors.quickActions.appendChild(btn);
  });
};

window.appendStory = function(text, type = 'narrative', timestamp = null) {
  const entry = document.createElement('div');
  entry.className = `story-entry ${type}`;
  const date = timestamp ? new Date(timestamp) : new Date();
  const timeStr = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  
  let sender = 'AI';
  if (type === 'action') sender = 'PLAYER';
  else if (type === 'system') sender = 'SYSTEM';

  // 敘事進行段落格式化與角色對話框標記，其他類型僅做字串脫殼
  const finalContent = type === 'narrative' ? window.formatNarrative(text) : window.cleanText(text);

  entry.innerHTML = `
    <div class="entry-header"><span class="sender">${sender}</span> <span class="time">${timeStr}</span></div>
    <div class="entry-content">${text ? marked.parse(finalContent) : ''}</div>`;

  const wasAtBottom = window.selectors.storyLog.scrollHeight - window.selectors.storyLog.scrollTop - window.selectors.storyLog.clientHeight < window.SETTINGS.UI.stickToBottomThresholdPx;
  window.selectors.storyLog.appendChild(entry);
  if (wasAtBottom) {
    window.selectors.storyLog.scrollTop = window.selectors.storyLog.scrollHeight;
  }
  return entry;
};

window.showFloatingImpact = function(label, delta) {
  let container = document.getElementById('impact-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'impact-container';
    document.body.appendChild(container);
  }

  const el = document.createElement('div');
  const isPos = delta > 0;
  el.className = `floating-impact ${isPos ? 'positive' : 'negative'}`;
  el.innerHTML = `
    <div class="impact-bubble">
      <span class="impact-label">${label}</span>
      <span class="impact-value">${isPos ? '+' : ''}${delta}</span>
    </div>
  `;

  container.appendChild(el);

  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 300);
  }, window.SETTINGS.UI.floatingImpactDurationMs);

  // 觸發側邊欄呼吸/閃爍動畫
  const safeLabel = btoa(unescape(encodeURIComponent(label))).replace(/=/g, '');
  const bar = document.getElementById(`bar-${safeLabel}`);
  const item = document.getElementById(`stat-item-${safeLabel}`);
  if (bar) {
    bar.classList.remove('flash');
    void bar.offsetWidth; // trigger reflow
    bar.classList.add('flash');
  }
  if (item) {
    item.classList.remove('pulse');
    void item.offsetWidth;
    item.classList.add('pulse');
  }
};

window.setupCustomSelect = function() {
  const container = window.selectors.modelSelectContainer;
  const trigger = window.selectors.modelSelectTrigger;
  const optionsList = window.selectors.modelSelectOptions;
  const nativeSelect = window.selectors.modelSelect;
  const displayValue = window.selectors.modelSelectedValue;

  function syncOptions() {
    optionsList.innerHTML = '';
    Array.from(nativeSelect.options).forEach(opt => {
      const optionEl = document.createElement('div');
      optionEl.className = `option ${opt.value === nativeSelect.value ? 'selected' : ''}`;
      optionEl.dataset.value = opt.value;
      optionEl.textContent = opt.textContent;

      optionEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = optionEl.dataset.value;
        nativeSelect.value = val;
        displayValue.textContent = opt.textContent;

        optionsList.querySelectorAll('.option').forEach(o => o.classList.remove('selected'));
        optionEl.classList.add('selected');

        container.classList.remove('active');
        optionsList.classList.add('hidden');
      });

      optionsList.appendChild(optionEl);
    });
    displayValue.textContent = nativeSelect.options[nativeSelect.selectedIndex]?.textContent || nativeSelect.value;
  }

  syncOptions();

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isActive = container.classList.contains('active');

    document.querySelectorAll('.custom-select').forEach(cs => cs.classList.remove('active'));
    document.querySelectorAll('.select-options').forEach(so => so.classList.add('hidden'));

    if (!isActive) {
      container.classList.add('active');
      optionsList.classList.remove('hidden');
    }
  });

  document.addEventListener('click', () => {
    container.classList.remove('active');
    optionsList.classList.add('hidden');
  });
};

window.attachSidebarListeners = function() {
  const setupBtn = (id, action) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', action);
  };

  const openSettings = () => {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.remove('hidden');
  };
  const openExport = () => {
    window.state.currentSaveMode = 'export';
    window.selectors.saveModalTitle.textContent = '匯出命錄卷軸';
    window.selectors.btnConfirmSave.textContent = '烙印至神識 (複製)';
    const payload = btoa(unescape(encodeURIComponent(JSON.stringify(window.state.game))));
    window.selectors.saveCode.value = payload;
    const modal = document.getElementById('save-modal');
    if (modal) modal.classList.remove('hidden');
  };
  const openImport = () => {
    window.state.currentSaveMode = 'import';
    window.selectors.saveModalTitle.textContent = '讀取因果命錄';
    window.selectors.btnConfirmSave.textContent = '執行推演';
    window.selectors.saveCode.value = '';
    const modal = document.getElementById('save-modal');
    if (modal) modal.classList.remove('hidden');
  };
  const runClear = () => {
    if (confirm('確定要重塑乾坤（清空所有存檔）嗎？')) window.clearGame();
  };

  ['exp', 'col'].forEach(suffix => {
    setupBtn(`btn-settings-${suffix}`, openSettings);
    setupBtn(`export-save-${suffix}`, openExport);
    setupBtn(`import-save-${suffix}`, openImport);
    setupBtn(`clear-game-${suffix}`, runClear);
  });

  const orb = document.getElementById('mobile-orb');
  if (orb) {
    orb.addEventListener('click', (e) => {
      e.stopPropagation();
      const actions = orb.parentElement.querySelector('.collapsed-actions');
      if (actions) {
        actions.classList.toggle('active');
      }
    });
  }
};

window.startOrbCycling = function() {
  if (window.orbInterval) clearInterval(window.orbInterval);
  const slides = document.querySelectorAll('.orb-stat-slide');
  if (slides.length <= 1) return;

  let current = 0;
  window.orbInterval = setInterval(() => {
    const currentSlide = slides[current];
    if (currentSlide) currentSlide.classList.remove('active');
    current = (current + 1) % slides.length;
    const nextSlide = slides[current];
    if (nextSlide) nextSlide.classList.add('active');
  }, 2500);
};

window.updateQuickActionSelection = function(btns) {
  btns.forEach((btn, idx) => {
    if (idx === window.state.quickActionIndex) {
      btn.classList.add('selected');
      const fullText = btn.querySelector('.quick-tooltip').textContent;
      window.selectors.playerAction.value = fullText;
      window.selectors.playerAction.setSelectionRange(fullText.length, fullText.length);
    } else {
      btn.classList.remove('selected');
    }
  });
};
