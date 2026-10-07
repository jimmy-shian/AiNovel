// ========== 前端介面與動態渲染 (UI) ==========

window.render = function() {
  const p = window.state.game.player;
  const sceneData = window.state.world.scenes[window.state.game.scene] || { title: window.state.game.scene };

  window.selectors.sceneTitle.textContent = sceneData.title;

  window.renderSidebar();

  if (window.state.game?.finished) {
    // 命運已定：鎖定輸入並清空行動建議（render 必須維持鎖定，不可被覆寫）
    window.lockActionInput('【命運已定】此局已收束。點選左上角「切換因果」換故事，或重新開始進入新局...');
  } else if (window.state.game.history.length === 0) {
    // 新版多代理劇本（有 characters）：嚴禁使用舊版 scenes[].choices 靜態選項。
    // 開局推薦卡一律由第 2-call Meta LLM 生成（群聊式 options），此處清空等待首輪推演，
    // 避免舊單人邏輯閃現與群聊推薦脫鉤。無 characters 的舊劇本才回退舊靜態選項。
    const hasCharacters = Object.keys(window.state.world?.characters || {}).length > 0;
    if (hasCharacters) {
      // 未選角鎖定態：維持 lockActionInput 的提示，不可被清空覆寫
      const locked = !!window.selectors.playerAction?.disabled;
      const hasSelected = !!window.state.game?.player?.has_selected_character;
      if (!locked && hasSelected) {
        window.renderQuickActions([]);
        if (window.selectors.quickActions) {
          window.selectors.quickActions.innerHTML = '<span style="color: #888; font-size: 0.82rem; font-style: italic;">命途推演中…首輪群像對峙與抉擇卡生成後即顯示</span>';
        }
      }
    } else {
      window.renderQuickActions(sceneData.choices || []);
    }
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
  const currentChar = window.state.world?.characters?.[p.char_id];
  const storyOptions = Object.entries(window.state.allStories || {}).map(([id, story]) => {
    return `<option value="${id}" ${id === window.state.currentStoryId ? 'selected' : ''}>${story.title}</option>`;
  }).join('');

  window.selectors.sidebarExpanded.innerHTML = `
    <div class="sidebar-header">
      <div class="logo">
        <span class="logo-text">TIANYAN</span>
        <span class="logo-sub">天機錄 ${window.SETTINGS.VERSION}</span>
      </div>
      <div class="story-selector-container">
        <label>切換因果</label>
        <div class="custom-select story-custom-select" id="story-select-container">
          <div class="select-trigger glass" id="story-select-trigger">
            <span class="selected-value">${window.state.allStories[window.state.currentStoryId]?.title || '選擇故事'}</span>
            <svg class="chevron" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </div>
          <div class="select-options glass" id="story-select-options">
            ${Object.entries(window.state.allStories || {}).map(([id, story]) => `
              <div class="option ${id === window.state.currentStoryId ? 'selected' : ''}" data-value="${id}">${story.title}</div>
            `).join('')}
          </div>
          <select id="story-select" class="hidden">
            ${storyOptions}
          </select>
        </div>
      </div>
    </div>

    <div class="stats-group">
      ${window.renderStatItemHTML('生命', p.hp || 0, '#ef4444')}
      ${window.renderStatItemHTML('靈力', p.sp || 0, '#3b82f6')}
      ${window.renderStatItemHTML('業力', p.threat || 0, '#a855f7')}
    </div>

    <div class="action-menu">
      <button id="btn-transmigrate-exp" class="icon-btn" style="border-color: rgba(224, 176, 255, 0.4); color: #e0b0ff;">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7.5" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>
        <span>魂穿化身</span>
      </button>
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

    <div class="world-tick-badge" title="多代理世界時鐘">
      <span class="tick-item">[TICK ${window.state.multiagent?.tick ?? window.state.game?.tick ?? 1}]</span>
      <span class="tick-item">[天道警戒 ${window.state.multiagent?.heaven_alert ?? 10}/100]</span>
      <span class="tick-item">[同場 ${window.getInSceneCharacters ? window.getInSceneCharacters(window.state.game.scene, p.char_id).length : 0} NPC]</span>
    </div>

    <button id="btn-theme-toggle-exp" class="icon-btn theme-toggle-btn" type="button" title="切換淺色/深色主題">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
      <span>主題 <span class="theme-toggle-label">[DARK]</span></span>
    </button>

    ${currentChar ? `
      <div class="destiny-arc-card" style="
        margin-top: 12px;
        padding: 10px 12px;
        border-radius: 10px;
        background: var(--brand-soul-soft);
        border: 1px solid var(--border);
      ">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
          <span style="font-size: 0.75rem; color: var(--brand-soul); font-weight: 700; letter-spacing: 0.05em;">【當前宿主命途】</span>
          <span style="font-size: 0.72rem; color: var(--text-secondary);">${currentChar.name} (${currentChar.title})</span>
        </div>
        <div style="font-size: 0.78rem; color: var(--brand-gold); line-height: 1.4; margin-bottom: 4px;">
          <strong>故事走向：</strong>${currentChar.agenda?.primary_goal || '於天地浩劫中求生'}
        </div>
        <div style="font-size: 0.75rem; color: var(--text-secondary); line-height: 1.3;">
          <strong>當前方針：</strong>${currentChar.agenda?.current_plan || '洞察四周危機'}
        </div>
      </div>
    ` : ''}
  `;
};

window.renderCollapsedView = function(p) {
  const stats = [
    { label: '生命', value: p.hp || 0, color: '#ef4444' },
    { label: '靈力', value: p.sp || 0, color: '#3b82f6' },
    { label: '業力', value: p.threat || 0, color: '#a855f7' }
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
        <button id="btn-theme-toggle-col" class="circle-btn" title="切換淺色/深色主題"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg></button>
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
  let numVal = 0;

  if (typeof value === 'object' && value !== null) {
    numVal = value.val;
    displayValue = `${value.val}/${value.max}`;
    progress = value.max > value.min ? ((value.val - value.min) / (value.max - value.min)) * 100 : 0;
    hasChanged = window.state.lastStats[label] !== value.val;
  } else {
    numVal = Number(value) || 0;
    displayValue = label === '解析度' ? `${value}%` : value;
    progress = Math.min(100, numVal);
    hasChanged = window.state.lastStats[label] !== value;
  }

  // 計算階位標籤 (僅針對非基礎三圍之自訂能力，或能力值顯示)
  const isBasePool = label === '生命' || label === '靈力' || label === '業力';
  const tierInfo = (!isBasePool && window.getStatTier) ? window.getStatTier(numVal) : null;
  const tierHTML = tierInfo ? `<span class="stat-tier-badge ${tierInfo.class}">${tierInfo.name}</span>` : '';

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
      <div class="label-wrapper">
        <span class="label">${label}</span>
        ${tierHTML}
      </div>
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
  const player = window.state.game?.player;

  options.slice(0, 4).forEach((opt, index) => {
    const req = window.parseOptionRequirement ? window.parseOptionRequirement(opt, player) : { eligible: true };
    const btn = document.createElement('button');
    btn.className = `quick-btn glass ${req.eligible ? '' : 'disabled-action'}`;
    btn.type = 'button';
    if (!req.eligible) {
      btn.setAttribute('aria-disabled', 'true');
    }

    // 群聊式劇情推薦卡：顯示完整選項文字 (不再截斷 6 字)，門檻/消耗標籤高亮
    const lockBadge = req.eligible ? '' : '<span class="lock-indicator" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg></span>';
    const tooltipText = req.eligible ? opt : `${opt}<br><span class="req-warning">${req.reason}</span>`;

    btn.innerHTML = `
      <span class="quick-index">${index + 1}</span>
      <span class="quick-text">${lockBadge}${opt}</span>
      <div class="quick-tooltip">${tooltipText}</div>
    `;

    btn.addEventListener('click', () => {
      if (!req.eligible) {
        // 條件不足時，在輸入框簡短提示或聚焦但不強制送出
        window.selectors.playerAction.placeholder = req.reason || '未達境界條件';
        return;
      }
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
  if (type === 'action') sender = window.state.game?.player?.name || 'PLAYER';
  else if (type === 'system') sender = 'SYSTEM';

  let renderedContent = '';
  if (text) {
    if (type === 'system' && (text.trim().startsWith('<div') || text.trim().startsWith('<span'))) {
      renderedContent = text; // 直接渲染原生 HTML (如魂穿奪舍卡片)
    } else if (type === 'narrative') {
      renderedContent = marked.parse(window.formatNarrative(text));
    } else {
      renderedContent = marked.parse(window.cleanText(text));
    }
  }

  entry.innerHTML = `
    <div class="entry-header"><span class="sender">${sender}</span> <span class="time">${timeStr}</span></div>
    <div class="entry-content">${renderedContent}</div>`;

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

window.populateModelList = function(models, selectedModel = '') {
  const container = window.selectors.modelSelectContainer;
  const optionsList = window.selectors.modelSelectOptions;
  const nativeSelect = window.selectors.modelSelect;
  const displayValue = window.selectors.modelSelectedValue;
  if (!optionsList || !nativeSelect) return;

  const currentVal = selectedModel || nativeSelect.value || localStorage.getItem(window.SETTINGS.STORAGE_KEYS.selectedModel) || 'openai/gpt-oss-120b';

  nativeSelect.innerHTML = '';
  optionsList.innerHTML = '';

  let matched = false;
  models.forEach(modelId => {
    // 原生 select option
    const opt = document.createElement('option');
    opt.value = modelId;
    opt.textContent = modelId;
    if (modelId === currentVal) {
      opt.selected = true;
      matched = true;
    }
    nativeSelect.appendChild(opt);

    // 自訂下拉清單 option
    const optionEl = document.createElement('div');
    optionEl.className = `option ${modelId === currentVal ? 'selected' : ''}`;
    optionEl.dataset.value = modelId;
    optionEl.textContent = modelId;

    optionEl.addEventListener('click', (e) => {
      e.stopPropagation();
      nativeSelect.value = modelId;
      if (displayValue) displayValue.textContent = modelId;
      localStorage.setItem(window.SETTINGS.STORAGE_KEYS.selectedModel, modelId);

      optionsList.querySelectorAll('.option').forEach(o => o.classList.remove('selected'));
      optionEl.classList.add('selected');

      container?.classList.remove('active');
      optionsList.classList.add('hidden');
    });

    optionsList.appendChild(optionEl);
  });

  if (!matched && currentVal) {
    const opt = document.createElement('option');
    opt.value = currentVal;
    opt.textContent = currentVal;
    opt.selected = true;
    nativeSelect.insertBefore(opt, nativeSelect.firstChild);

    const optionEl = document.createElement('div');
    optionEl.className = 'option selected';
    optionEl.dataset.value = currentVal;
    optionEl.textContent = currentVal;
    optionEl.addEventListener('click', (e) => {
      e.stopPropagation();
      nativeSelect.value = currentVal;
      if (displayValue) displayValue.textContent = currentVal;
      localStorage.setItem(window.SETTINGS.STORAGE_KEYS.selectedModel, currentVal);
      optionsList.querySelectorAll('.option').forEach(o => o.classList.remove('selected'));
      optionEl.classList.add('selected');
      container?.classList.remove('active');
      optionsList.classList.add('hidden');
    });
    optionsList.insertBefore(optionEl, optionsList.firstChild);
  }

  if (displayValue) {
    displayValue.textContent = nativeSelect.value || currentVal;
  }
};

window.setupCustomSelect = function() {
  const container = window.selectors.modelSelectContainer;
  const trigger = window.selectors.modelSelectTrigger;
  const optionsList = window.selectors.modelSelectOptions;
  const nativeSelect = window.selectors.modelSelect;
  const displayValue = window.selectors.modelSelectedValue;

  if (!container || !trigger || !optionsList || !nativeSelect || !displayValue) return;

  function syncOptions() {
    optionsList.innerHTML = '';
    Array.from(nativeSelect.options).forEach(opt => {
      const optionEl = document.createElement('div');
      optionEl.className = `option ${opt.selected ? 'selected' : ''}`;
      optionEl.dataset.value = opt.value;
      optionEl.textContent = opt.textContent;

      optionEl.addEventListener('click', (e) => {
        e.stopPropagation();
        nativeSelect.value = opt.value;
        displayValue.textContent = opt.textContent;

        optionsList.querySelectorAll('.option').forEach(o => o.classList.remove('selected'));
        optionEl.classList.add('selected');

        container.classList.remove('active');
        localStorage.setItem(window.SETTINGS.STORAGE_KEYS.selectedModel, opt.value);
      });

      optionsList.appendChild(optionEl);
    });

    const selectedOpt = nativeSelect.options[nativeSelect.selectedIndex];
    if (selectedOpt) displayValue.textContent = selectedOpt.textContent;
  }

  if (optionsList.children.length === 0) {
    syncOptions();
  }

  trigger.onclick = (e) => {
    e.stopPropagation();
    const isAlreadyOpen = container.classList.contains('active');

    document.querySelectorAll('.custom-select').forEach(cs => {
      if (cs !== container) {
        cs.classList.remove('active');
      }
    });

    if (isAlreadyOpen) {
      container.classList.remove('active');
    } else {
      container.classList.add('active');
    }
  };

  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) {
      container.classList.remove('active');
    }
  });
};

window.setupStoryCustomSelect = function() {
  const container = document.getElementById('story-select-container');
  const trigger = document.getElementById('story-select-trigger');
  const optionsList = document.getElementById('story-select-options');
  const nativeSelect = document.getElementById('story-select');
  const displayValue = trigger ? trigger.querySelector('.selected-value') : null;

  if (!container || !trigger || !optionsList || !nativeSelect || !displayValue) return;

  function syncOptions() {
    optionsList.innerHTML = '';
    const allStories = window.state.allStories || {};
    Object.entries(allStories).forEach(([id, story]) => {
      const isSelected = id === window.state.currentStoryId;
      const optionEl = document.createElement('div');
      optionEl.className = `option ${isSelected ? 'selected' : ''}`;
      optionEl.dataset.value = id;
      optionEl.textContent = story.title;

      optionEl.addEventListener('click', (e) => {
        e.stopPropagation();
        nativeSelect.value = id;
        displayValue.textContent = story.title;

        optionsList.querySelectorAll('.option').forEach(o => o.classList.remove('selected'));
        optionEl.classList.add('selected');

        container.classList.remove('active');

        // 觸發故事切換
        window.switchStory(id);
      });

      optionsList.appendChild(optionEl);
    });

    const currentTitle = allStories[window.state.currentStoryId]?.title;
    if (currentTitle) displayValue.textContent = currentTitle;
  }

  syncOptions();

  trigger.onclick = (e) => {
    e.stopPropagation();
    const isAlreadyOpen = container.classList.contains('active');

    // 關閉其他可能開啟的 select
    document.querySelectorAll('.custom-select').forEach(cs => {
      if (cs !== container) {
        cs.classList.remove('active');
      }
    });

    if (isAlreadyOpen) {
      container.classList.remove('active');
    } else {
      container.classList.add('active');
    }
  };

  // 點擊容器外部時關閉
  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) {
      container.classList.remove('active');
    }
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
    const payload = window.encodeSaveData
      ? window.encodeSaveData(window.state.game)
      : btoa(unescape(encodeURIComponent(JSON.stringify(window.state.game))));
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

  const openTransmigrate = () => {
    window.openTransmigrationModal();
  };

  ['exp', 'col'].forEach(suffix => {
    setupBtn(`btn-transmigrate-${suffix}`, openTransmigrate);
    setupBtn(`btn-settings-${suffix}`, openSettings);
    setupBtn(`export-save-${suffix}`, openExport);
    setupBtn(`import-save-${suffix}`, openImport);
    setupBtn(`clear-game-${suffix}`, runClear);
  });
  setupBtn('btn-theme-toggle-exp', () => window.toggleTheme && window.toggleTheme());
  setupBtn('btn-theme-toggle-col', () => window.toggleTheme && window.toggleTheme());
  try {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    document.querySelectorAll('.theme-toggle-label').forEach(el => { el.textContent = cur === 'light' ? '[LIGHT]' : '[DARK]'; });
  } catch (_) {}

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

  // 初始化故事客製化選單
  window.setupStoryCustomSelect();
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

// ========== 輸入框鎖定/解鎖機制（未選角防呆門檻） ==========
window.lockActionInput = function(placeholderText = '【命途未啟】請先在上方彈窗中選擇魂穿肉身宿主...') {
  if (window.selectors.playerAction) {
    window.selectors.playerAction.disabled = true;
    window.selectors.playerAction.placeholder = placeholderText;
  }
  const submitBtn = window.selectors.actionForm?.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.4';
    submitBtn.style.cursor = 'not-allowed';
  }
  const quickActions = window.selectors.quickActions;
  if (quickActions) {
    quickActions.innerHTML = `<span style="color: #888; font-size: 0.82rem; font-style: italic;">${placeholderText}</span>`;
  }
};

window.unlockActionInput = function() {
  if (window.selectors.playerAction) {
    window.selectors.playerAction.disabled = false;
    window.selectors.playerAction.placeholder = '在此輸入你的行動，干涉世界因果...';
  }
  const submitBtn = window.selectors.actionForm?.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.style.opacity = '1';
    submitBtn.style.cursor = 'pointer';
  }
};

// ========== 故事歡迎與介紹卡片（開局或切換故事時展示） ==========
window.renderStoryWelcomeCard = function() {
  const storyMeta = window.state.allStories?.[window.state.currentStoryId] || {};
  const storyData = window.state.world || {};
  const container = window.selectors.storyLog;
  if (!container) return;

  container.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'story-entry welcome-card-entry';
  card.innerHTML = `
    <div class="welcome-story-card glass" style="
      padding: 24px;
      border-radius: 16px;
      border: 1px solid var(--border);
      background: var(--surface);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12);
    ">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
        <span class="badge">【當前劇本世界】</span>
        <span style="font-size: 0.78rem; color: var(--text-muted);">點選左上角「切換因果」可挑選其他故事</span>
      </div>
      <h2 style="color: var(--brand-gold); font-family: var(--font-heading); font-size: 1.55rem; margin-bottom: 12px; letter-spacing: 0.05em;">
        ${storyData.title || storyMeta.title || '太古因果網'}
      </h2>
      <p style="color: var(--text-secondary); font-size: 1rem; line-height: 1.65; margin-bottom: 18px;">
        ${storyMeta.description || storyData.description || '眾生皆如籠中之雀，唯有奪舍入局者，方能扭轉因果。'}
      </p>
      <div style="border-top: 1px dashed rgba(255, 255, 255, 0.15); padding-top: 14px; display: flex; flex-wrap: wrap; gap: 14px; align-items: center;">
        <button id="btn-welcome-transmigrate" class="primary-btn" style="
          background: linear-gradient(135deg, #7c3aed, #4f46e5);
          color: #ffffff;
          padding: 10px 24px;
          border-radius: 10px;
          font-weight: 700;
          cursor: pointer;
          border: none;
          box-shadow: 0 4px 15px rgba(124, 58, 237, 0.4);
          font-size: 0.95rem;
        ">
          魂穿入局 · 挑選肉身角色
        </button>
        <span style="color: #888; font-size: 0.82rem;">（或從左側點選「魂穿化身」按鈕進入）</span>
      </div>
    </div>
  `;

  container.appendChild(card);
  const btn = card.querySelector('#btn-welcome-transmigrate');
  if (btn) {
    btn.onclick = () => window.openTransmigrationModal();
  }
};

// ========== 魂穿選角彈窗動態渲染 ==========
window.openTransmigrationModal = function(isMandatory = false) {
  const modal = window.selectors.transmigrateModal;
  const listEl = window.selectors.characterCardList;
  if (!modal || !listEl) return;

  if (isMandatory) modal.classList.add('mandatory-mode');
  else modal.classList.remove('mandatory-mode');
  // 強制選角時隱藏「暫不更換魂體」關閉鈕；非強制開啟時還原
  const footer = modal.querySelector('.modal-footer');
  if (footer) footer.style.display = isMandatory ? 'none' : '';

  const characters = window.state.world?.characters || {};
  const playableList = Object.values(characters).filter(c => c.playable);

  if (playableList.length === 0) {
    listEl.innerHTML = `<div style="grid-column: 1/-1; color: #888; text-align: center; padding: 20px;">當前劇本暫無可供魂穿的肉身宿主。</div>`;
  } else {
    listEl.innerHTML = playableList.map(c => {
      const isCurrent = window.state.game?.player?.char_id === c.id;
      return `
        <div class="character-card glass ${isCurrent ? 'current-host' : ''}" style="
          padding: 14px;
          border-radius: 10px;
          border: 1px solid ${isCurrent ? 'var(--brand-soul)' : 'var(--border)'};
          background: ${isCurrent ? 'var(--brand-soul-soft)' : 'var(--surface)'};
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          gap: 10px;
          transition: all 0.2s ease;
        ">
          <div>
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px;">
              <span style="font-weight: 700; color: var(--brand-soul); font-size: 1.05em;">${c.name}</span>
              <span class="badge">【${c.initial_scene}】</span>
            </div>
            <div style="font-size: 0.82em; color: var(--text-secondary); margin-bottom: 6px;">身份：${c.title}</div>
            <div style="font-size: 0.82em; color: var(--brand-gold); background: var(--brand-gold-soft); padding: 6px 8px; border-radius: 6px; border-left: 3px solid var(--brand-gold); margin-bottom: 6px; line-height: 1.4;">
              <strong>【命途走向】</strong>${c.agenda?.primary_goal || '於天地浩劫中求生'}
            </div>
            <div style="font-size: 0.78em; color: var(--text-secondary); margin-bottom: 8px; line-height: 1.35;">
              <strong>【破局方針】</strong>${c.agenda?.current_plan || '隨機應變'}
            </div>
            <div style="font-size: 0.8em; color: var(--text-secondary); line-height: 1.4; margin-bottom: 8px;">
              ${c.profile}
            </div>
            <div style="font-size: 0.76em; color: var(--text-muted); border-top: 1px dashed var(--border); padding-top: 6px;">
              <strong>肉身感官：</strong>${c.somatic_memory?.physical_state || '無特定感覺'}
            </div>
          </div>
          <button class="primary-btn choose-char-btn" data-char-id="${c.id}" style="
            width: 100%;
            padding: 8px;
            font-size: 0.85em;
            background: ${isCurrent ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg, #7c3aed, #4f46e5)'};
          ">
            ${isCurrent ? '當前宿主' : '奪舍魂穿'}
          </button>
        </div>
      `;
    }).join('');

    // 綁定選擇角色按鈕點擊事件
    listEl.querySelectorAll('.choose-char-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const charId = e.currentTarget.dataset.charId;
        window.executeTransmigration(charId);
      });
    });
  }

  modal.classList.remove('hidden');
};

// ========== OpenDesign 基礎設施：主題 / 複製 / 通知 ==========
window.applyTheme = function(theme, persist = true) {
  const t = theme === 'light' ? 'light' : 'dark';
  try {
    document.documentElement.setAttribute('data-theme', t);
    if (persist) localStorage.setItem(window.SETTINGS.STORAGE_KEYS.theme, t);
  } catch (_) {}
  const label = document.querySelectorAll('.theme-toggle-label');
  label.forEach(el => { el.textContent = t === 'light' ? '[LIGHT]' : '[DARK]'; });
};

window.toggleTheme = function() {
  const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  window.applyTheme(cur === 'light' ? 'dark' : 'light');
};

window.showToast = function(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 2200);
};

window.copyToClipboard = async function(text, btnElement, origText) {
  let ok = false;
  try {
    if (navigator.clipboard?.writeText && text) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch (_) { ok = false; }
  if (!ok && text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (_) { ok = false; }
  }
  if (btnElement) {
    const labelEl = btnElement.querySelector('span') || btnElement;
    const prev = origText || labelEl.textContent;
    if (ok) {
      btnElement.classList.add('copied');
      if (labelEl) labelEl.textContent = '已複製';
      window.showToast('已複製到剪貼簿', 'success');
      setTimeout(() => {
        btnElement.classList.remove('copied');
        if (labelEl) labelEl.textContent = prev;
      }, 1500);
    } else {
      window.showToast('複製失敗，請手動選取複製', 'error');
    }
  } else if (ok) {
    window.showToast('已複製到剪貼簿', 'success');
  }
  return ok;
};

// 群聊式完整敘事渲染 (敘事 + 閃回/破綻/傳聞附加塊)，供歷史回放與即時渲染共用
window.renderFullNarrativeHTML = function(result) {
  if (!result) return '';
  let html = window.formatNarrative(result.narrative || '');
  if (result.flashback_fragment && window.formatSpecialBlock) html += window.formatSpecialBlock('flashback', result.flashback_fragment);
  if (result.dissonance_reaction && window.formatSpecialBlock) html += window.formatSpecialBlock('dissonance', result.dissonance_reaction);
  if (result.world_rumor && window.formatSpecialBlock) html += window.formatSpecialBlock('rumor', result.world_rumor);
  (result.rumors || []).forEach(r => { if (window.formatSpecialBlock) html += window.formatSpecialBlock('rumor', r); });
  try {
    return marked.parse(html);
  } catch (_) { return html; }
};

// 執行魂穿替換
window.executeTransmigration = async function(charId) {
  const characters = window.state.world?.characters || {};
  const targetChar = characters[charId];
  if (!targetChar) return;

  const isInitialSelection = !window.state.game?.player?.has_selected_character || window.state.game?.history?.length === 0;

  if (window.state.game) {
    window.state.game.player.char_id = charId;
    window.state.game.player.name = targetChar.name;
    window.state.game.player.has_selected_character = true;
    if (targetChar.abilities) {
      window.state.game.player.abilities = JSON.parse(JSON.stringify(targetChar.abilities));
    }
    window.state.game.player.somatic_state = targetChar.somatic_memory?.physical_state;
    window.state.game.scene = targetChar.initial_scene;
    window.state.game.dissonance = targetChar.dissonance || 0.0;
    // 新宿主重置 NPC 關係/位置，並登記起始場景造訪（結局 visited 條件用）；
    // 世界心跳 tick 不在此硬重置：先標記「神魂離體·待歸竅」(pending)，待後端
    // authoritative tick 回包後覆寫，維持魂穿不重置 tick 語義。
    window.state.game.npc_state = {};
    window.state.multiagent = {
      ...(window.state.multiagent || { tick: 1, heaven_alert: 10 }),
      pending_transmigration: charId,
      transmigration_state: '神魂離體·待歸竅',
    };
    if (window.registerSceneVisit) window.registerSceneVisit(window.state.game, targetChar.initial_scene);
  }

  // 後端多代理引擎魂穿 (authoritative)：成功以回包 tick/heaven_alert/occupants
  // 覆寫；失敗（無後端/file://）才 fallback 本地 tick=1
  try {
    const transmigrateUrl = window.CONFIG?.getMultiagentUrl
      ? window.CONFIG.getMultiagentUrl('/api/multiagent/transmigrate')
      : '/api/multiagent/transmigrate';
    const res = await fetch(transmigrateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        char_id: charId,
        story_id: window.state.currentStoryId,
        state: {
          tick: window.state.game?.world_clock?.tick,
          heaven_alert: window.state.game?.world_clock?.heaven_alert,
        }
      }),
    });
    if (res.ok) {
      const backend = await res.json();
      if (backend?.scene && window.state.world?.scenes?.[backend.scene]) {
        window.state.game.scene = backend.scene;
      }
      // 後端世界時鐘連續（魂穿不重置 tick），以 authoritative 回包覆寫
      if (backend && typeof backend.tick === 'number') {
        window.state.multiagent = {
          ...(window.state.multiagent || {}),
          tick: backend.tick,
          heaven_alert: backend.heaven_alert ?? window.state.multiagent?.heaven_alert ?? 10,
          occupants: backend.occupants || [],
        };
        window.state.game.world_clock = {
          tick: backend.tick,
          heaven_alert: backend.heaven_alert ?? window.state.multiagent.heaven_alert ?? 10,
        };
      }
      // 神魂歸竅：清除 pending 標記
      if (window.state.multiagent) {
        delete window.state.multiagent.pending_transmigration;
        window.state.multiagent.transmigration_state = '神魂歸竅';
      }
    } else {
      throw new Error(`transmigrate HTTP ${res.status}`);
    }
  } catch (_) {
    // 無後端（fetch 失敗/file:// 靜態託管）：fallback 本地新局時鐘
    window.state.multiagent = {
      ...(window.state.multiagent || {}),
      tick: 1,
      heaven_alert: 10,
      transmigration_state: '神魂歸竅·本地推演',
    };
    delete window.state.multiagent.pending_transmigration;
    window.state.game.world_clock = { tick: 1, heaven_alert: 10 };
  }

  // 關閉彈窗並解鎖行動輸入框
  window.selectors.transmigrateModal?.classList.remove('mandatory-mode');
  window.selectors.transmigrateModal?.classList.add('hidden');
  window.unlockActionInput();

  // 在故事日誌中加入魂穿破繭特效訊息
  const wakeUpHtml = `
    <div style="border-left: 3px solid var(--brand-soul); margin: 10px 0; color: var(--text-primary); background: var(--brand-soul-soft); border-radius: 4px; padding: 10px 10px 10px 12px;">
      <strong style="color: var(--brand-gold); font-size: 1.05em;">【神魂歸竅 · 魂穿奪舍】</strong><br>
      神識如穿過無量苦海，猛然墜入一具軀殼之中——<br>
      你成了「${targetChar.name}」（${targetChar.title}）。<br>
      <span style="color: var(--text-muted); font-size: 0.9em;">軀體感官：${targetChar.somatic_memory?.physical_state}</span><br>
      <span style="color: var(--text-secondary); font-size: 0.9em;">當前位置：【${targetChar.initial_scene}】</span><br>
      <span style="color: var(--brand-gold); font-size: 0.9em;">執念動機：${targetChar.agenda?.primary_goal}</span>
    </div>
  `;
  const wakeEntry = window.appendStory(wakeUpHtml, 'system');
  // 標記保留：首輪 handleAction 會清理版面，奪舍卡不可被洗掉
  if (wakeEntry && wakeEntry.setAttribute) wakeEntry.setAttribute('data-keep', '1');

  // 保存存檔並重新渲染介面
  window.saveToStorage();
  window.render();

  // 若為初次選角且歷史紀錄為空，立刻觸發首輪群像故事！
  if (isInitialSelection && window.state.game.history.length === 0) {
    const apiKey = window.selectors.apiKey?.value?.trim() || localStorage.getItem(window.SETTINGS.STORAGE_KEYS.apiKey);
    if (apiKey) {
      setTimeout(() => {
        window.handleAction(null, true);
      }, 400);
    } else {
      window.appendStory('系統：請點擊右上角「冥想配置」輸入 NVIDIA API Key 以啟動命途演繹。', 'system');
    }
  }
};


