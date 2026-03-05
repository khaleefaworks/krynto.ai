/**
 * AI ChatAssist - Visitor Chat Widget
 * Vanilla JavaScript WebSocket-based chat widget
 * Loaded dynamically via loader.js with website-specific configuration
 */

(function () {
  'use strict';

  // --- Configuration & State ---
  const globalConfig = window._aichatassist || {};
  const scriptElement = document.currentScript || document.querySelector('script[src*="chat-widget.js"]');

  function deriveBaseFromScriptSrc() {
    try {
      const src = scriptElement && scriptElement.src ? scriptElement.src : '';
      if (!src) return null;
      const u = new URL(src, window.location.href);
      return u.origin;
    } catch (e) {
      return null;
    }
  }

  const derivedApiBase = deriveBaseFromScriptSrc();
  const derivedWsBase = derivedApiBase
    ? (derivedApiBase.startsWith('https://')
      ? 'wss://' + derivedApiBase.slice('https://'.length)
      : derivedApiBase.startsWith('http://')
        ? 'ws://' + derivedApiBase.slice('http://'.length)
        : derivedApiBase)
    : null;

  const CONFIG = {
    websiteId: globalConfig.websiteId || (scriptElement ? scriptElement.getAttribute('data-website-id') : null) || null,
    widgetKey: globalConfig.widgetKey || null,
    sessionId: null,
    conversationId: 0,
    wsUrl: globalConfig.wsUrl || (scriptElement ? scriptElement.getAttribute('data-ws-url') : null) || derivedWsBase || '',
    apiUrl: globalConfig.apiUrl || (scriptElement ? scriptElement.getAttribute('data-api-url') : null) || derivedApiBase || '',
    theme: globalConfig.theme || 'dark',
    position: globalConfig.position || 'bottom-right',
    welcomeMessage: globalConfig.welcomeMessage || 'Hi! How can we help you today?',
    primaryColor: globalConfig.primaryColor || '#3b82f6',
    colorMode: globalConfig.colorMode || 'gradient',
    gradientStart: globalConfig.gradientStart || '#3b82f6',
    gradientEnd: globalConfig.gradientEnd || '#2563eb',
    headerTitle: globalConfig.headerTitle || 'Support Chat',
    onlineStatusText: globalConfig.onlineStatusText || 'Online',
    bubbleText: globalConfig.bubbleText || 'Chat with us',
    agentAvatar: globalConfig.agentAvatar || null,
    headerIconUrl: globalConfig.headerIconUrl || null,
    showEmojiPicker: globalConfig.showEmojiPicker || false,
    showAttachments: globalConfig.showAttachments || false,
    brandingText: globalConfig.brandingText || 'Powered by AI ChatAssist'
  };

  // State
  let ws = null;
  let presenceWs = null;
  let isConnecting = false;
  let reconnectTimeout = null;
  let presencePingInterval = null;
  let presenceReconnectTimeout = null;
  let presenceReconnectAttempts = 0;
  const PRESENCE_RECONNECT_BASE_MS = 1000;
  let toastTimeout = null;

  let unreadCount = 0;
  let soundEnabled = false;
  let notificationAudioCtx = null;
  const originalTitle = document.title;
  let firstUnreadMessageId = null;
  let historyQueue = null;
  let isReadStateFetched = false;
  let isAtBottom = true;
  let hasScrolledToUnread = false;
  let lastAppendedDateStr = null;

  let presenceOnline = true;
  let activeAgentAvatarUrl = null;
  let activeAgentName = null;
  let pendingOfflineMessage = null;
  let pendingOfflineAttachments = [];

  let uploadingAttachmentsCount = 0;
  let draftAttachments = [];

  let agentTypingActive = false;
  let agentTypingTimer = null;
  let visitorTypingActive = false;
  let visitorTypingTimer = null;

  // Pending optimistic visitor sends: client_message_id -> timestamp element
  const pendingVisitorSends = new Map();

  let pageViewTrackingInitialized = false;
  let lastTrackedUrl = null;
  let pendingPageView = null;

  // After a visitor ends the chat UI, hide the End (X) button until they send
  // another message. This prevents repeated end_chat triggers from reopen/close.
  let endChatDisabled = false;

  function _endChatStorageKey() {
    if (!CONFIG.websiteId || !CONFIG.sessionId) return null;
    return `aichatassist_end_chat_disabled_${CONFIG.websiteId}_${CONFIG.sessionId}`;
  }

  function setEndChatDisabled(disabled) {
    endChatDisabled = Boolean(disabled);
    const endBtn = document.getElementById('chatassist-end');
    if (endBtn) {
      endBtn.style.display = endChatDisabled ? 'none' : '';
    }
    if (endChatDisabled) {
      try { hideEndOverlay(); } catch (e) { }
    }
    try {
      const key = _endChatStorageKey();
      if (key) sessionStorage.setItem(key, endChatDisabled ? '1' : '0');
    } catch (e) { }
  }

  function hydrateEndChatDisabled() {
    try {
      const key = _endChatStorageKey();
      if (!key) return;
      const v = sessionStorage.getItem(key);
      if (v === '1') setEndChatDisabled(true);
    } catch (e) { }
  }

  // --- Core Logic ---

  if (!CONFIG.websiteId || !CONFIG.widgetKey) {
    console.error('[ChatWidget] Missing required configuration: websiteId or widgetKey');
    return;
  }

  // --- UI Helpers ---

  let _widgetStateRestored = false;

  function _restoreWidgetState() {
    if (_widgetStateRestored) return;
    _widgetStateRestored = true;
    try {
      const saved = localStorage.getItem('ai_chatassist_widget_open_' + CONFIG.websiteId);
      if (saved === '1') {
        const bubble = document.getElementById('chatassist-bubble');
        const win = document.getElementById('chatassist-window');
        if (bubble && win && win.style.display === 'none') {
          bubble.style.display = 'none';
          win.style.display = 'flex';
          win.classList.remove('chatassist-window-closing');
          setTimeout(function () { scrollToBottom(false); }, 50);
        }
      }
    } catch (e) { }
  }

  function isWidgetOpen() {
    const win = document.getElementById('chatassist-window');
    return !!(win && win.style.display !== 'none');
  }

  function setUnreadCount(next) {
    unreadCount = Math.max(0, Number(next) || 0);
    const el = document.getElementById('chatassist-bubble-unread');
    if (el) {
      if (unreadCount <= 0) {
        el.style.display = 'none';
        el.textContent = '';
      } else {
        el.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
        el.style.display = 'flex';
      }
    }
    document.title = unreadCount > 0 ? `(${unreadCount}) ${originalTitle}` : originalTitle;
  }

  function bumpUnread() {
    setUnreadCount(unreadCount + 1);
  }

  function showToast(message) {
    const container = document.getElementById('chatassist-toast-container');
    if (!container) return;
    container.textContent = message;
    container.style.display = 'block';
    container.classList.add('chatassist-toast-visible');
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(hideToast, 3000);
  }

  function hideToast() {
    const container = document.getElementById('chatassist-toast-container');
    if (!container) return;
    container.classList.remove('chatassist-toast-visible');
    container.style.display = 'none';
  }

  // --- Message Popup (Smartsupp-style notification above bubble) ---

  let dotsPreviewTimer = null;
  let msgPopupTimer = null;

  function showDotsPreview() {
    hideMessagePopup(true);
    const el = document.getElementById('chatassist-dots-preview');
    if (el) el.classList.add('chatassist-dots-visible');
  }

  function hideDotsPreview() {
    const el = document.getElementById('chatassist-dots-preview');
    if (el) el.classList.remove('chatassist-dots-visible');
    if (dotsPreviewTimer) {
      clearTimeout(dotsPreviewTimer);
      dotsPreviewTimer = null;
    }
  }

  function showMessagePopup(senderName, avatarUrl, messageText) {
    hideDotsPreview();

    const popup = document.getElementById('chatassist-msg-popup');
    const nameEl = document.getElementById('chatassist-popup-name');
    const bodyEl = document.getElementById('chatassist-popup-body');
    const avatarWrap = document.getElementById('chatassist-popup-avatar-wrap');

    if (!popup) return;

    if (nameEl) nameEl.textContent = senderName || 'Support';
    if (bodyEl) {
      const plain = String(messageText || '').replace(/!?\[[^\]]*\]\([^)]+\)/g, '').trim();
      const truncated = plain.slice(0, 150);
      bodyEl.textContent = truncated + (plain.length > 150 ? '\u2026' : '');
    }
    if (avatarWrap) {
      const url = getFullAssetUrl(avatarUrl);
      if (url) {
        avatarWrap.className = 'chatassist-popup-avatar';
        avatarWrap.innerHTML = '';
        const img = document.createElement('img');
        img.src = url;
        img.alt = senderName || 'Agent';
        img.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover;';
        avatarWrap.appendChild(img);
      } else {
        avatarWrap.className = 'chatassist-popup-avatar-placeholder';
        const initials = (senderName || 'S').trim().split(/\s+/).slice(0, 2).map(function (p) { return p[0]; }).join('').toUpperCase() || 'S';
        avatarWrap.innerHTML = '';
        avatarWrap.textContent = initials;
      }
    }

    popup.classList.add('chatassist-popup-visible');

    // No auto-dismiss — popup stays until visitor clicks the X button.
    if (msgPopupTimer) clearTimeout(msgPopupTimer);
    msgPopupTimer = null;
  }

  function hideMessagePopup(skipAnimation) {
    const popup = document.getElementById('chatassist-msg-popup');
    if (!popup) return;
    if (msgPopupTimer) {
      clearTimeout(msgPopupTimer);
      msgPopupTimer = null;
    }
    if (skipAnimation) {
      popup.classList.remove('chatassist-popup-visible');
      popup.style.animation = '';
      return;
    }
    popup.style.animation = 'chatassist-popup-out 0.25s ease-in forwards';
    popup.addEventListener('animationend', function onEnd() {
      popup.removeEventListener('animationend', onEnd);
      popup.classList.remove('chatassist-popup-visible');
      popup.style.animation = '';
    }, { once: true });
  }

  function notifyNewMessage(senderName, avatarUrl, messageText) {
    if (isWidgetOpen() && !document.hidden) return;
    bumpUnread();
    playNotificationSound();
    showDotsPreview();
    dotsPreviewTimer = setTimeout(function () {
      hideDotsPreview();
      showMessagePopup(senderName, avatarUrl, messageText);
    }, 1200);
  }

  function setAgentTyping(isTyping, name) {
    const el = document.getElementById('chatassist-typing');
    if (!el) return;
    if (isTyping) {
      const label = el.querySelector('.chatassist-typing-label');
      if (label) label.textContent = 'Agent is typing';
      el.style.display = 'flex';
    } else {
      el.style.display = 'none';
    }
  }

  function sendTyping(isTyping) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({ type: 'typing', is_typing: Boolean(isTyping) }));
    } catch (e) { }
  }

  function sendEndChat() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify({ type: 'end_chat' }));
      return true;
    } catch (e) {
      return false;
    }
  }

  // --- Rating ---

  let ratingConversationId = null;
  let hasRatedSession = false;

  function _ratedStorageKey() {
    if (!CONFIG.websiteId || !CONFIG.sessionId) return null;
    return `aichatassist_rated_${CONFIG.websiteId}_${CONFIG.sessionId}`;
  }

  function showRatingOverlay(conversationId) {
    if (hasRatedSession) return;
    try {
      const key = _ratedStorageKey();
      if (key && sessionStorage.getItem(key) === '1') { hasRatedSession = true; return; }
    } catch (e) { }

    ratingConversationId = conversationId || null;
    const el = document.getElementById('chatassist-rating-overlay');
    if (!el) return;
    // Reset state
    const thanks = document.getElementById('chatassist-rating-thanks');
    if (thanks) thanks.style.display = 'none';
    const emojis = el.querySelector('.chatassist-rating-emojis');
    if (emojis) emojis.style.display = 'flex';
    el.querySelectorAll('.chatassist-rating-btn').forEach(b => b.classList.remove('selected'));
    el.style.display = 'flex';
    el.classList.add('chatassist-rating-overlay-visible');
  }

  function hideRatingOverlay() {
    const el = document.getElementById('chatassist-rating-overlay');
    if (el) {
      el.classList.remove('chatassist-rating-overlay-visible');
      el.style.display = 'none';
    }
  }

  function submitRating(ratingValue) {
    hasRatedSession = true;
    try {
      const key = _ratedStorageKey();
      if (key) sessionStorage.setItem(key, '1');
    } catch (e) { }

    // Submit via WebSocket if connected
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          type: 'submit_rating',
          rating: ratingValue,
          conversation_id: ratingConversationId,
        }));
      } catch (e) { }
    } else {
      // Fallback: HTTP POST
      try {
        const apiBase = CONFIG.serverUrl.replace(/\/widget\/.*$/, '').replace(/\/ws\/.*$/, '');
        fetch(apiBase + '/ratings/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversation_id: ratingConversationId,
            rating: ratingValue,
            session_id: CONFIG.sessionId,
          }),
        }).catch(() => { });
      } catch (e) { }
    }

    // Show thank you & auto-close
    const thanks = document.getElementById('chatassist-rating-thanks');
    const emojis = document.querySelector('.chatassist-rating-emojis');
    if (thanks) thanks.style.display = 'block';
    if (emojis) emojis.style.display = 'none';
    setTimeout(() => hideRatingOverlay(), 1500);
  }

  // --- Audio ---

  function enableNotificationSound() {
    soundEnabled = true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!notificationAudioCtx) notificationAudioCtx = new AC();
      if (notificationAudioCtx.state !== 'running') {
        notificationAudioCtx.resume().catch(() => { });
      }
      if (notificationAudioCtx.state === 'running') {
        const osc = notificationAudioCtx.createOscillator();
        const gain = notificationAudioCtx.createGain();
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(notificationAudioCtx.destination);
        osc.start();
        osc.stop(notificationAudioCtx.currentTime + 0.01);
      }
    } catch (e) { }
  }

  function playNotificationSound() {
    if (!soundEnabled || !notificationAudioCtx) return;
    if (notificationAudioCtx.state !== 'running') {
      notificationAudioCtx.resume().catch(() => { });
      if (notificationAudioCtx.state !== 'running') return;
    }
    try {
      const osc = notificationAudioCtx.createOscillator();
      const gain = notificationAudioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.value = 0.04;
      osc.connect(gain);
      gain.connect(notificationAudioCtx.destination);
      osc.start();
      osc.stop(notificationAudioCtx.currentTime + 0.14);
    } catch (e) { }
  }

  function armSoundOnFirstGesture() {
    try {
      const _arm = () => enableNotificationSound();
      document.addEventListener('pointerdown', _arm, { once: true, passive: true });
      document.addEventListener('keydown', _arm, { once: true });
      document.addEventListener('touchstart', _arm, { once: true, passive: true });
    } catch (e) { }
  }

  // --- API & State Management ---

  async function fetchReadState() {
    try {
      const response = await fetch(`${CONFIG.apiUrl}/widget/read-state?website_id=${CONFIG.websiteId}&session_id=${CONFIG.sessionId}`);
      if (response.ok) {
        const data = await response.json();
        if (typeof data.conversation_id === 'number') CONFIG.conversationId = data.conversation_id || 0;
        firstUnreadMessageId = data.first_unread_message_id;
        if (typeof data.unread_count === 'number') setUnreadCount(data.unread_count);
      }
    } catch (e) {
      console.error('[ChatWidget] Failed to fetch read state:', e);
    } finally {
      isReadStateFetched = true;
      if (historyQueue) {
        handleIncomingMessage(historyQueue);
        historyQueue = null;
      }
    }
  }

  async function markRead() {
    try {
      const response = await fetch(`${CONFIG.apiUrl}/widget/read?website_id=${CONFIG.websiteId}&session_id=${CONFIG.sessionId}`, {
        method: 'POST'
      });
      if (response.ok) {
        firstUnreadMessageId = null;
        setUnreadCount(0);
      }
    } catch (e) {
      console.error('[ChatWidget] Failed to mark read:', e);
    }
  }

  // --- WebSocket Communication ---

  function connectWebSocket() {
    if (isConnecting || (ws && ws.readyState === WebSocket.OPEN)) return;
    isConnecting = true;
    const wsEndpoint = `${CONFIG.wsUrl}/ws/chat/${CONFIG.websiteId}/${CONFIG.sessionId}`;

    try {
      ws = new WebSocket(wsEndpoint);
      ws.onopen = () => {
        isConnecting = false;
        hideToast();
        if (pendingPageView) {
          ws.send(JSON.stringify(pendingPageView));
          pendingPageView = null;
        }
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
          reconnectTimeout = null;
        }
      };
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleIncomingMessage(data);
      };
      ws.onerror = () => { isConnecting = false; };
      ws.onclose = () => {
        isConnecting = false;
        ws = null;
        showToast('Connection lost. Reconnecting...');
        reconnectTimeout = setTimeout(connectWebSocket, 3000);
      };
    } catch (e) {
      isConnecting = false;
    }
  }

  function sendMessage(message, meta) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      showToast('Not connected. Please wait...');
      connectWebSocket();
      return false;
    }
    const payload = { message };
    // Client-generated id so the server can ack with canonical timestamp/id.
    try {
      const existingId = meta && typeof meta === 'object' ? meta._client_message_id : null;
      const id = existingId || ((window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`);
      payload.message_id = id;
      if (meta && typeof meta === 'object' && !meta._client_message_id) {
        meta._client_message_id = id;
      }
    } catch (e) { }
    if (meta && typeof meta === 'object') {
      if (meta.visitor_name) payload.visitor_name = meta.visitor_name;
      if (meta.visitor_email) payload.visitor_email = meta.visitor_email;
    }
    ws.send(JSON.stringify(payload));

    // Visitor has resumed the conversation; allow ending again.
    if (endChatDisabled) {
      setEndChatDisabled(false);
    }
    return true;
  }

  function handleIncomingMessage(data) {
    if (data.type === 'history' && Array.isArray(data.messages)) {
      if (!isReadStateFetched) {
        historyQueue = data;
        return;
      }
      const container = document.getElementById('chatassist-messages');
      if (!container) return;
      container.innerHTML = '';
      lastAppendedDateStr = null;
      container.classList.add('chatassist-no-animate');
      data.messages.forEach(m => {
        const senderType = m.sender_type || m.sender || 'system';
        const actor = m.actor || senderType;
        const kind = m.kind || (actor === 'system' ? 'event' : 'chat');
        const eventType = m.event_type || null;

        // Internal timeline events: don't show to the visitor.
        if (actor === 'system' && kind === 'event' && (eventType === 'visitor_connected' || eventType === 'visitor_socket_connected' || eventType === 'visitor_left_website')) {
          return;
        }

        if (actor === 'visitor') {
          appendMessage('visitor', m.content, m.created_at, null, m.id);
        } else if (actor === 'agent') {
          if (m.sender_avatar_url) updateAgentAvatar(m.sender_avatar_url);
          if (m.sender_name) updateAgentName(m.sender_name);
          appendMessage('agent', m.content, m.created_at, { avatarUrl: m.sender_avatar_url, name: m.sender_name }, m.id);
        } else if (eventType === 'bot_prompt_buttons') {
          // Parse enriched JSON content for buttons data.
          var promptData = null;
          try { promptData = JSON.parse(m.content); } catch (e) { /* plain text fallback */ }
          var displayText = (promptData && promptData.message) ? promptData.message : m.content;
          var pButtons = (promptData && Array.isArray(promptData.buttons)) ? promptData.buttons : [];
          var pAutoId = promptData && promptData.automation_id;

          // Check if visitor has already responded (any visitor message after this one).
          var currentIdx = data.messages.indexOf(m);
          var hasResponse = data.messages.slice(currentIdx + 1).some(function (s) {
            return (s.sender_type || s.sender) === 'visitor';
          });

          if (!hasResponse && pButtons.length > 0) {
            // Pending prompt: show interactive buttons + hide input.
            appendBotPromptWithButtons(displayText, m.created_at, pButtons, pAutoId, m.id);
          } else {
            // Already responded: show as plain text.
            appendMessage('ai', displayText, m.created_at, null, m.id);
          }
        } else if (actor === 'bot' || (actor === 'system' && kind === 'chat') || (senderType === 'system' && (eventType === 'bot' || (eventType && eventType.startsWith('automation'))))) {
          appendMessage('ai', m.content, m.created_at, null, m.id);
        } else if (actor === 'system') {
          if (eventType === 'agent_join') showJoinMessage(m.content, m.created_at);
          else showSystemMessage(m.content);
        } else {
          appendMessage('ai', m.content, m.created_at, null, m.id);
        }
      });
      container.classList.remove('chatassist-no-animate');
      updateEmptyState();
      isAtBottom = true;
      smartScroll();

      // Restore widget open/minimized state from localStorage.
      // If there are history messages, restore immediately.
      // If empty (new session), we'll restore when the welcome/bot_prompt arrives.
      if (data.messages.length > 0) {
        _restoreWidgetState();
      }
      return;
    }

    // Canonical system events (e.g. conversation_resolved) are delivered as
    // `type: "system"` frames with an optional `message_obj` DTO.
    // Without this handler, the generic fallback path misclassifies them as AI.
    if (data.type === 'system') {
      const dto = (data && typeof data.message_obj === 'object') ? data.message_obj : null;
      const createdAt = data.created_at || (dto && dto.created_at) || null;

      const senderType = (dto && (dto.sender_type || dto.sender)) || 'system';
      const actor = (dto && (dto.actor || senderType)) || 'system';
      const kind = (dto && (dto.kind || (actor === 'system' ? 'event' : 'chat'))) || 'event';
      const eventType = (dto && dto.event_type) || null;

      // Internal timeline events: don't show to the visitor.
      if (actor === 'system' && kind === 'event' && (eventType === 'visitor_connected' || eventType === 'visitor_socket_connected' || eventType === 'visitor_left_website')) {
        return;
      }

      if (actor === 'system' && kind === 'event') {
        if (eventType === 'agent_join') showJoinMessage(data.message, createdAt);
        else showSystemMessage(data.message);
        // When conversation is resolved by agent, show rating overlay
        if (eventType === 'conversation_resolved') {
          const convId = (dto && dto.conversation_id) || (data && data.conversation_id) || ratingConversationId;
          showRatingOverlay(convId);
        }
      } else {
        // Bot/system chat message delivered as a system frame.
        appendMessage('ai', data.message, createdAt, null, dto && dto.id);
        if (!isWidgetOpen() || document.hidden) {
          notifyNewMessage('Support', null, data.message);
        } else if (isAtBottom) {
          markRead();
        }
        showNewMsgIndicator();
      }
      smartScroll();
      return;
    }

    // Bot prompt with interactive buttons (team routing chatbot).
    if (data.type === 'bot_prompt') {
      const createdAt = data.created_at || (data.message_obj && data.message_obj.created_at);
      const buttons = Array.isArray(data.buttons) ? data.buttons : [];
      const automationId = data.automation_id;
      appendBotPromptWithButtons(data.message, createdAt, buttons, automationId, data.message_obj?.id);
      if (!isWidgetOpen() || document.hidden) {
        notifyNewMessage('Support', null, data.message);
      } else if (isAtBottom) {
        markRead();
      }
      showNewMsgIndicator();
      smartScroll();
      // Restore widget state after bot prompt arrives (new sessions).
      _restoreWidgetState();
      return;
    }

    if (data.type === 'ai' || data.type === 'bot') {
      const createdAt = data.created_at || (data.message_obj && data.message_obj.created_at);
      appendMessage('ai', data.message, createdAt, null, data.message_obj?.id);
      if (!isWidgetOpen() || document.hidden) {
        notifyNewMessage('Support', null, data.message);
      } else if (isAtBottom) {
        markRead();
      }
      showNewMsgIndicator();
      smartScroll();
    } else if (data.type === 'visitor_message_saved') {
      const clientId = data.message_id;
      const dto = data.message_obj;
      const createdAt = dto && dto.created_at;
      if (clientId && pendingVisitorSends.has(String(clientId))) {
        const tsEl = pendingVisitorSends.get(String(clientId));
        pendingVisitorSends.delete(String(clientId));
        try {
          if (tsEl && createdAt) {
            tsEl.textContent = formatTimestamp(new Date(createdAt));
          }
        } catch (e) { }
      }
    } else if (data.type === 'agent') {
      setAgentTyping(false);
      if (data.agent_name) updateAgentName(data.agent_name);
      if (data.agent_avatar) updateAgentAvatar(data.agent_avatar);
      appendMessage('agent', data.message, data.created_at, { avatarUrl: data.agent_avatar, name: data.agent_name }, data.message_obj?.id);
      if (!isWidgetOpen() || document.hidden) {
        notifyNewMessage(data.agent_name || activeAgentName, data.agent_avatar || activeAgentAvatarUrl, data.message);
      } else if (isAtBottom) {
        markRead();
      }
      showNewMsgIndicator();
      smartScroll();
    } else if (data.type === 'agent_joined') {
      setAgentTyping(false);
      const createdAt = (data.message_obj && data.message_obj.created_at) || null;
      showJoinMessage(`${data.agent_name || 'A support agent'} joined the chat.`, createdAt);
      if (data.agent_name) updateAgentName(data.agent_name);
      if (data.agent_avatar) updateAgentAvatar(data.agent_avatar);
      smartScroll();
    } else if (data.type === 'agent_typing') {
      const isTyping = Boolean(data.is_typing);
      if (agentTypingTimer) {
        clearTimeout(agentTypingTimer);
        agentTypingTimer = null;
      }
      if (isTyping) {
        setAgentTyping(true, data.agent_name);
        agentTypingTimer = setTimeout(() => {
          agentTypingTimer = null;
          setAgentTyping(false);
        }, 3000);
      } else {
        setAgentTyping(false);
      }
    } else if (data.message) {
      const sender = data.sender === 'user' ? 'visitor' : (data.sender || 'ai');
      appendMessage(sender, data.message, data.created_at, null, data.message_obj?.id || data.id);
      smartScroll();
    }
  }

  // --- Scrolling Logic ---

  function smartScroll() {
    const el = document.getElementById('chatassist-messages');
    if (!el) return;

    // Use multiple requestAnimationFrame to ensure the browser has actually painted
    // and layout is fully recalculated, which is critical for accurate scrollHeight.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const unreadDivider = document.getElementById('chatassist-unread-divider');

        // If widget is closed, we can't accurately scroll, but we mark it as "needs scroll"
        if (!isWidgetOpen()) {
          return;
        }

        if (unreadDivider && !hasScrolledToUnread) {
          hasScrolledToUnread = true;
          unreadDivider.scrollIntoView({ behavior: 'auto', block: 'center' });
          return;
        }

        if (isAtBottom) {
          el.scrollTop = el.scrollHeight;
        }
      });
    });
  }

  function scrollToBottom(smooth) {
    const el = document.getElementById('chatassist-messages');
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
      isAtBottom = true;
    });
  }

  function handleMessagesScroll() {
    const el = document.getElementById('chatassist-messages');
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    isAtBottom = nearBottom;
    if (nearBottom) {
      if (firstUnreadMessageId) markRead();
      hideNewMsgIndicator();
    }
    // Remove unread divider once the user scrolls past it.
    const divider = document.getElementById('chatassist-unread-divider');
    if (divider && el) {
      try {
        const dividerTop = divider.offsetTop;
        const scrolledPast = el.scrollTop > dividerTop;
        if (scrolledPast) {
          divider.classList.add('chatassist-unread-divider-hidden');
          setTimeout(() => { if (divider.parentNode) divider.parentNode.removeChild(divider); }, 600);
        }
      } catch (e) { }
    }
  }

  function showNewMsgIndicator() {
    if (isAtBottom || !isWidgetOpen()) return;
    const el = document.getElementById('chatassist-new-msg-indicator');
    if (el) {
      el.style.display = 'flex';
      el.style.opacity = '1';
    }
  }

  function hideNewMsgIndicator() {
    const el = document.getElementById('chatassist-new-msg-indicator');
    if (el) {
      el.style.display = 'none';
      el.style.opacity = '0';
    }
  }

  // --- UI Construction ---

  function getFullAssetUrl(url) {
    if (!url || typeof url !== 'string') return null;
    return url.startsWith('http') ? url : `${CONFIG.apiUrl}${url}`;
  }

  function setHeaderIcon(urlOrNull) {
    const iconInner = document.getElementById('chatassist-header-icon-inner');
    if (!iconInner) return;
    const url = getFullAssetUrl(urlOrNull);
    if (!url) {
      iconInner.innerHTML = `<div class="chatassist-header-avatar-placeholder"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></div>`;
      return;
    }
    iconInner.innerHTML = `<img class="chatassist-header-avatar" src="${url}" alt="Icon">`;
  }

  function refreshHeaderIcon() {
    setHeaderIcon(activeAgentAvatarUrl || CONFIG.headerIconUrl || null);
  }

  function updateAgentAvatar(url) {
    activeAgentAvatarUrl = url;
    CONFIG.agentAvatar = url;
    refreshHeaderIcon();
  }

  function updateAgentName(name) {
    if (name) activeAgentName = String(name);
  }

  function formatTimestamp(date) {
    const h = date.getHours();
    const m = date.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${m < 10 ? '0' + m : m} ${ampm}`;
  }

  function isSafeHref(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const v = raw.trim();
    if (!v) return null;
    try {
      const url = new URL(v, window.location.href);
      const protocol = (url.protocol || '').toLowerCase();
      if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:' || protocol === 'tel:') {
        return url.href;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  function normalizeBareDomainUrl(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;

    // Strip trailing punctuation that commonly follows URLs in sentences.
    const cleaned = s.replace(/[),.;:!?]+$/g, '');
    if (!cleaned) return null;

    // If it already has a scheme, keep it.
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(cleaned)) return cleaned;

    // Avoid treating emails as bare URLs.
    if (cleaned.includes('@')) return null;

    return `https://${cleaned}`;
  }

  function isProbablyImageFile(file) {
    if (!file) return false;
    try {
      if (file.type && String(file.type).startsWith('image/')) return true;
      const name = String(file.name || '').toLowerCase();
      return name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.gif') || name.endsWith('.webp');
    } catch (e) {
      return false;
    }
  }

  function attachmentToMarkdown(att) {
    if (!att || !att.url) return '';
    const rawUrl = String(att.url);
    const absoluteUrl = getFullAssetUrl(rawUrl) || rawUrl;
    const safeUrl = isSafeHref(absoluteUrl);
    if (!safeUrl) return '';

    if (att.kind === 'image') {
      const alt = String(att.name || 'image').replace(/[\[\]]/g, '').trim();
      return `![${alt || 'image'}](${safeUrl})`;
    }
    const label = String(att.name || 'attachment');
    return `[${label}](${safeUrl})`;
  }

  function serializeMessageWithAttachments(text, attachments) {
    const rawText = String(text || '').trim();
    const md = Array.isArray(attachments)
      ? attachments.map(attachmentToMarkdown).filter(Boolean)
      : [];

    if (rawText && md.length) return `${rawText}\n\n${md.join('\n')}`;
    if (rawText) return rawText;
    if (md.length) return md.join('\n');
    return '';
  }

  function setUploadingAttachmentsCount(next) {
    uploadingAttachmentsCount = Math.max(0, Number(next) || 0);
    const attachBtn = document.getElementById('chatassist-attach');
    const sendBtn = document.getElementById('chatassist-send');
    if (attachBtn) {
      attachBtn.classList.toggle('chatassist-attach-uploading', uploadingAttachmentsCount > 0);
      attachBtn.setAttribute('aria-busy', uploadingAttachmentsCount > 0 ? 'true' : 'false');
    }
    if (sendBtn) {
      sendBtn.disabled = uploadingAttachmentsCount > 0;
    }
  }

  function renderAttachmentChips() {
    const wrap = document.getElementById('chatassist-attachments');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (!draftAttachments.length) {
      wrap.style.display = 'none';
      return;
    }
    wrap.style.display = 'flex';
    draftAttachments.forEach((att) => {
      const tile = document.createElement('div');
      tile.className = 'chatassist-attachment-tile';

      const thumb = document.createElement('div');
      thumb.className = 'chatassist-attachment-thumb';

      if (att.kind === 'image' && att.url) {
        const img = document.createElement('img');
        img.src = String(getFullAssetUrl(att.url) || att.url);
        img.alt = String(att.name || 'image');
        img.loading = 'lazy';
        img.decoding = 'async';
        thumb.appendChild(img);
      } else {
        thumb.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>`;

        const ext = document.createElement('div');
        ext.className = 'chatassist-attachment-ext';
        const raw = String(att.name || 'FILE');
        const m = raw.toUpperCase().match(/\.([A-Z0-9]{1,6})$/);
        ext.textContent = m ? m[1] : 'FILE';
        tile.appendChild(ext);
      }

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'chatassist-attachment-remove';
      remove.setAttribute('aria-label', 'Remove attachment');
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        draftAttachments = draftAttachments.filter((a) => a.id !== att.id);
        renderAttachmentChips();
      });

      tile.appendChild(thumb);
      tile.appendChild(remove);
      wrap.appendChild(tile);
    });
  }

  async function uploadWidgetAttachment(file) {
    if (!file) return null;
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${CONFIG.apiUrl}/widget/attachments/upload?website_id=${CONFIG.websiteId}&session_id=${CONFIG.sessionId}`, {
      method: 'POST',
      body: form,
    });

    if (!res.ok) {
      let detail = '';
      try {
        const data = await res.json();
        detail = data && (data.detail || data.message) ? String(data.detail || data.message) : '';
      } catch (e) { }
      throw new Error(detail || `Upload failed (${res.status})`);
    }
    const data = await res.json();
    if (typeof data.conversation_id === 'number') CONFIG.conversationId = data.conversation_id || CONFIG.conversationId || 0;
    const absoluteUrl = getFullAssetUrl(data.url) || data.url;
    return {
      id: (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : `att-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: data.filename || file.name || 'attachment',
      url: absoluteUrl,
      kind: isProbablyImageFile(file) ? 'image' : 'file',
    };
  }

  function renderInlineMarkdown(text) {
    const frag = document.createDocumentFragment();
    const s = String(text || '');

    const patterns = [
      { type: 'image', re: /!\[([^\]]*)\]\(([^)]+)\)/g },
      { type: 'link', re: /\[([^\]]+)\]\(([^)]+)\)/g },
      { type: 'bold', re: /\*\*([^*]+)\*\*/g },
      { type: 'italic', re: /\*([^*\n]+)\*/g },
      // Bare domains like abc.com, docs.example.co.uk/path
      { type: 'bare', re: /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?::\d{2,5})?(?:\/[\w\-./?%#=&+]*)?/gi },
      { type: 'url', re: /https?:\/\/[^\s<]+/g },
    ];

    let i = 0;
    while (i < s.length) {
      let best = null;

      for (const p of patterns) {
        p.re.lastIndex = i;
        const m = p.re.exec(s);
        if (!m) continue;
        if (!best || m.index < best.index) best = { type: p.type, match: m, index: m.index };
      }

      if (!best) {
        frag.appendChild(document.createTextNode(s.slice(i)));
        break;
      }

      if (best.index > i) {
        frag.appendChild(document.createTextNode(s.slice(i, best.index)));
      }

      const m = best.match;
      const full = m[0] || '';

      if (best.type === 'image') {
        const alt = String(m[1] || '');
        const srcRaw = String(m[2] || '');
        const src = isSafeHref(srcRaw);
        if (src) {
          const img = document.createElement('img');
          img.src = src;
          img.alt = alt;
          img.loading = 'lazy';
          img.decoding = 'async';
          img.className = 'chatassist-md-img';
          img.style.cursor = 'zoom-in';
          img.addEventListener('click', (e) => {
            try {
              e.preventDefault();
              window.open(src, '_blank', 'noopener,noreferrer');
            } catch (err) { }
          });
          frag.appendChild(img);
        } else {
          frag.appendChild(document.createTextNode(full));
        }
        i = best.index + full.length;
        continue;
      }

      if (best.type === 'link') {
        const label = String(m[1] || '');
        const hrefRaw = String(m[2] || '');
        const href = isSafeHref(hrefRaw);
        if (href) {
          const a = document.createElement('a');
          a.href = href;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = label || href;
          frag.appendChild(a);
        } else {
          frag.appendChild(document.createTextNode(full));
        }
        i = best.index + full.length;
        continue;
      }

      if (best.type === 'bold') {
        const strong = document.createElement('strong');
        strong.textContent = String(m[1] || '');
        frag.appendChild(strong);
        i = best.index + full.length;
        continue;
      }

      if (best.type === 'italic') {
        const em = document.createElement('em');
        em.textContent = String(m[1] || '');
        frag.appendChild(em);
        i = best.index + full.length;
        continue;
      }

      if (best.type === 'url') {
        const href = isSafeHref(full);
        if (href) {
          const a = document.createElement('a');
          a.href = href;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = full;
          frag.appendChild(a);
        } else {
          frag.appendChild(document.createTextNode(full));
        }
        i = best.index + full.length;
        continue;
      }

      if (best.type === 'bare') {
        const display = String(full);
        const normalized = normalizeBareDomainUrl(display);
        const href = normalized ? isSafeHref(normalized) : null;
        if (href) {
          const a = document.createElement('a');
          a.href = href;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = display.replace(/[),.;:!?]+$/g, '');
          frag.appendChild(a);

          // If we stripped punctuation, append it back as text.
          const stripped = display.match(/[),.;:!?]+$/g);
          if (stripped && stripped[0]) {
            frag.appendChild(document.createTextNode(stripped[0]));
          }
        } else {
          frag.appendChild(document.createTextNode(display));
        }
        i = best.index + full.length;
        continue;
      }

      frag.appendChild(document.createTextNode(full));
      i = best.index + full.length;
    }

    return frag;
  }

  function renderMarkdownInto(el, content) {
    if (!el) return;
    el.textContent = '';

    const lines = String(content || '').split('\n');
    let idx = 0;

    while (idx < lines.length) {
      const line = lines[idx];
      if (String(line || '').trim() === '') {
        idx += 1;
        continue;
      }
      const isOrdered = /^\s*\d+\.\s+/.test(line);
      const isUnordered = /^\s*[-*+]\s+/.test(line);

      if (isUnordered) {
        const ul = document.createElement('ul');
        ul.className = 'chatassist-md-ul';
        while (idx < lines.length && /^\s*[-*+]\s+/.test(lines[idx])) {
          const li = document.createElement('li');
          const itemText = String(lines[idx]).replace(/^\s*[-*+]\s+/, '');
          li.appendChild(renderInlineMarkdown(itemText));
          ul.appendChild(li);
          idx += 1;
        }
        el.appendChild(ul);
        continue;
      }

      if (isOrdered) {
        const ol = document.createElement('ol');
        ol.className = 'chatassist-md-ol';
        while (idx < lines.length && /^\s*\d+\.\s+/.test(lines[idx])) {
          const li = document.createElement('li');
          const itemText = String(lines[idx]).replace(/^\s*\d+\.\s+/, '');
          li.appendChild(renderInlineMarkdown(itemText));
          ol.appendChild(li);
          idx += 1;
        }
        el.appendChild(ol);
        continue;
      }

      const p = document.createElement('div');
      p.className = 'chatassist-md-paragraph';

      // Gather lines until a list starts or a blank line is encountered.
      const chunk = [];
      while (idx < lines.length) {
        const cur = String(lines[idx] || '');
        if (cur.trim() === '') break;
        if (/^\s*\d+\.\s+/.test(cur) || /^\s*[-*+]\s+/.test(cur)) break;
        chunk.push(cur);
        idx += 1;
      }

      // Skip blank line if present.
      while (idx < lines.length && String(lines[idx] || '').trim() === '') {
        chunk.push(lines[idx]);
        idx += 1;
      }

      const rendered = chunk.filter((l) => String(l || '').trim() !== '');
      for (let i = 0; i < rendered.length; i += 1) {
        p.appendChild(renderInlineMarkdown(rendered[i]));
        if (i < rendered.length - 1) p.appendChild(document.createElement('br'));
      }

      if (!rendered.length) continue;

      el.appendChild(p);
    }
  }

  function appendMessage(sender, content, createdAtIso, meta, messageId) {
    const container = document.getElementById('chatassist-messages');
    if (!container) return;

    // Hide empty state once a message is added.
    const emptyEl = document.getElementById('chatassist-empty-state');
    if (emptyEl) emptyEl.style.display = 'none';

    // Date separator: insert when the date changes between messages.
    try {
      const msgDate = createdAtIso ? new Date(createdAtIso) : new Date();
      const dateKey = msgDate.toDateString();
      if (dateKey !== lastAppendedDateStr) {
        lastAppendedDateStr = dateKey;
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        let label = msgDate.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
        if (msgDate.toDateString() === today.toDateString()) label = 'Today';
        else if (msgDate.toDateString() === yesterday.toDateString()) label = 'Yesterday';
        const sep = document.createElement('div');
        sep.className = 'chatassist-date-separator';
        sep.innerHTML = '<span>' + label + '</span>';
        container.appendChild(sep);
      }
    } catch (e) { }

    if (firstUnreadMessageId && Number(messageId) === firstUnreadMessageId) {
      const divider = document.createElement('div');
      divider.className = 'chatassist-unread-divider';
      divider.id = 'chatassist-unread-divider';
      divider.innerHTML = '<span>Unread messages</span>';
      container.appendChild(divider);
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = `chatassist-message chatassist-message-${sender}`;

    const row = document.createElement('div');
    row.className = `chatassist-message-row ${sender === 'visitor' ? 'chatassist-message-row-right' : 'chatassist-message-row-left'}`;

    const contentWrap = document.createElement('div');
    contentWrap.className = 'chatassist-message-content';

    const bubble = document.createElement('div');
    bubble.className = 'chatassist-message-bubble';
    renderMarkdownInto(bubble, content);

    const timestamp = document.createElement('div');
    timestamp.className = 'chatassist-message-timestamp';
    timestamp.textContent = formatTimestamp(createdAtIso ? new Date(createdAtIso) : new Date());

    contentWrap.appendChild(bubble);
    contentWrap.appendChild(timestamp);

    if (sender === 'agent' || sender === 'ai') {
      const avatar = document.createElement('div');
      avatar.className = `chatassist-message-avatar chatassist-message-avatar-${sender}`;
      if (sender === 'ai') {
        avatar.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M9 16h.01" /><path d="M15 16h.01" /></svg>`;
      } else {
        const url = getFullAssetUrl(meta?.avatarUrl || activeAgentAvatarUrl);
        const name = meta?.name || activeAgentName || 'Agent';
        if (url) {
          avatar.innerHTML = `<img class="chatassist-message-avatar-img" src="${url}" alt="${name}">`;
        } else {
          avatar.textContent = (name.trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('') || 'AG').toUpperCase();
        }
      }
      row.appendChild(avatar);
    }
    row.appendChild(contentWrap);
    messageDiv.appendChild(row);
    container.appendChild(messageDiv);

    // If this is an optimistic visitor message, track it so we can reconcile
    // timestamp once the server acks with canonical created_at.
    try {
      const pendingId = meta && meta._client_message_id;
      if (sender === 'visitor' && pendingId) {
        pendingVisitorSends.set(String(pendingId), timestamp);
        messageDiv.dataset.clientMessageId = String(pendingId);
      }
    } catch (e) { }
  }

  function appendBotPromptWithButtons(content, createdAtIso, buttons, automationId, messageId) {
    const container = document.getElementById('chatassist-messages');
    if (!container) return;

    // Hide empty state
    const emptyEl = document.getElementById('chatassist-empty-state');
    if (emptyEl) emptyEl.style.display = 'none';

    // Date separator
    try {
      const msgDate = createdAtIso ? new Date(createdAtIso) : new Date();
      const dateKey = msgDate.toDateString();
      if (dateKey !== lastAppendedDateStr) {
        lastAppendedDateStr = dateKey;
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        let label = msgDate.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
        if (msgDate.toDateString() === today.toDateString()) label = 'Today';
        else if (msgDate.toDateString() === yesterday.toDateString()) label = 'Yesterday';
        const sep = document.createElement('div');
        sep.className = 'chatassist-date-separator';
        sep.innerHTML = '<span>' + label + '</span>';
        container.appendChild(sep);
      }
    } catch (e) { }

    const messageDiv = document.createElement('div');
    messageDiv.className = 'chatassist-message chatassist-message-ai';

    const row = document.createElement('div');
    row.className = 'chatassist-message-row chatassist-message-row-left';

    // Bot avatar
    const avatar = document.createElement('div');
    avatar.className = 'chatassist-message-avatar chatassist-message-avatar-ai';
    avatar.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M9 16h.01" /><path d="M15 16h.01" /></svg>';

    const contentWrap = document.createElement('div');
    contentWrap.className = 'chatassist-message-content';

    const bubble = document.createElement('div');
    bubble.className = 'chatassist-message-bubble';
    renderMarkdownInto(bubble, content);

    const timestamp = document.createElement('div');
    timestamp.className = 'chatassist-message-timestamp';
    timestamp.textContent = formatTimestamp(createdAtIso ? new Date(createdAtIso) : new Date());

    contentWrap.appendChild(bubble);
    contentWrap.appendChild(timestamp);

    // Buttons container
    if (Array.isArray(buttons) && buttons.length > 0) {
      const buttonsWrap = document.createElement('div');
      buttonsWrap.className = 'chatassist-prompt-buttons';

      buttons.forEach(function (btn, idx) {
        const btnEl = document.createElement('button');
        btnEl.className = 'chatassist-prompt-btn';
        btnEl.textContent = btn.label || 'Option ' + (idx + 1);
        btnEl.type = 'button';
        btnEl.addEventListener('click', function () {
          // Disable all buttons after click
          const allBtns = buttonsWrap.querySelectorAll('.chatassist-prompt-btn');
          allBtns.forEach(function (b) {
            b.disabled = true;
            b.classList.add('chatassist-prompt-btn-disabled');
          });
          // Highlight selected
          btnEl.classList.add('chatassist-prompt-btn-selected');

          // Show the input area now that user has made a selection
          const inputCont = document.getElementById('chatassist-input-container');
          if (inputCont) inputCont.style.display = '';
          const inputEl = document.getElementById('chatassist-input');
          if (inputEl) inputEl.focus();

          // Optimistically append the visitor's selection as a visitor message
          appendMessage('visitor', btn.label || 'Option ' + (idx + 1), new Date().toISOString(), null, null);
          isAtBottom = true;
          smartScroll();

          sendBotButtonClick(automationId, idx);
        });
        buttonsWrap.appendChild(btnEl);
      });

      contentWrap.appendChild(buttonsWrap);
    }

    row.appendChild(avatar);
    row.appendChild(contentWrap);
    messageDiv.appendChild(row);
    container.appendChild(messageDiv);

    // Hide input area until visitor selects an option
    if (Array.isArray(buttons) && buttons.length > 0) {
      const inputCont = document.getElementById('chatassist-input-container');
      if (inputCont) inputCont.style.display = 'none';
    }
  }

  function sendBotButtonClick(automationId, buttonIndex) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      showToast('Not connected. Please wait...');
      return;
    }
    ws.send(JSON.stringify({
      type: 'bot_button_click',
      automation_id: automationId,
      button_index: buttonIndex,
    }));
  }

  function showSystemMessage(content) {
    const container = document.getElementById('chatassist-messages');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'chatassist-message chatassist-message-system';
    div.textContent = content;
    container.appendChild(div);
    smartScroll();
  }

  function showJoinMessage(content, createdAtIso) {
    const container = document.getElementById('chatassist-messages');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'chatassist-message chatassist-message-join';
    div.textContent = `${content} ${formatTimestamp(createdAtIso ? new Date(createdAtIso) : new Date())}`;
    container.appendChild(div);
    smartScroll();
  }

  // --- Event Handlers ---

  function handleUserMessage() {
    const input = document.getElementById('chatassist-input');
    if (!input) return;
    const message = input.value.trim();
    if (uploadingAttachmentsCount > 0) {
      showToast('Please wait for uploads to finish...');
      return;
    }
    if (!message && !draftAttachments.length) return;

    if (visitorTypingTimer) {
      clearTimeout(visitorTypingTimer);
      visitorTypingTimer = null;
    }
    if (visitorTypingActive) {
      visitorTypingActive = false;
      sendTyping(false);
    }

    if (presenceOnline) {
      const meta = {};
      try {
        meta._client_message_id = (window.crypto && window.crypto.randomUUID)
          ? window.crypto.randomUUID()
          : `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      } catch (e) { }
      const outgoing = serializeMessageWithAttachments(message, draftAttachments);
      appendMessage('visitor', outgoing, new Date().toISOString(), meta, null);
      input.value = '';
      autoResizeInput();
      draftAttachments = [];
      renderAttachmentChips();
      sendMessage(outgoing, meta);
      isAtBottom = true;
      smartScroll();
      return;
    }

    const email = document.getElementById('chatassist-contact-email')?.value.trim();
    if (email) {
      const meta = {
        visitor_name: document.getElementById('chatassist-contact-name')?.value.trim(),
        visitor_email: email
      };
      try {
        meta._client_message_id = (window.crypto && window.crypto.randomUUID)
          ? window.crypto.randomUUID()
          : `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      } catch (e) { }
      const outgoing = serializeMessageWithAttachments(message, draftAttachments);
      appendMessage('visitor', outgoing, new Date().toISOString(), meta, null);
      input.value = '';
      autoResizeInput();
      draftAttachments = [];
      renderAttachmentChips();
      sendMessage(outgoing, meta);
      isAtBottom = true;
      smartScroll();
      return;
    }

    pendingOfflineMessage = message;
    pendingOfflineAttachments = draftAttachments.slice();
    draftAttachments = [];
    renderAttachmentChips();
    // Keep input value so the visitor can see their message is preserved.
    showContactOverlay();
  }

  function showContactOverlay() {
    const el = document.getElementById('chatassist-contact-overlay');
    if (el) {
      // Show pending message preview so visitor knows their message is safe.
      const preview = document.getElementById('chatassist-contact-msg-preview');
      if (preview) {
        if (pendingOfflineMessage) {
          const truncated = pendingOfflineMessage.length > 120
            ? pendingOfflineMessage.slice(0, 120) + '…'
            : pendingOfflineMessage;
          preview.textContent = '"' + truncated + '"';
          preview.style.display = 'block';
        } else {
          preview.style.display = 'none';
        }
      }
      el.style.display = 'flex';
      el.classList.add('chatassist-contact-overlay-visible');
      document.getElementById('chatassist-contact-name')?.focus();
    }
  }

  function hideContactOverlay(restore) {
    const el = document.getElementById('chatassist-contact-overlay');
    if (!el) return;
    // Only act if the overlay is actually visible; prevents clearing the input
    // when applyPresence() calls hideContactOverlay(false) on every presence tick.
    const wasVisible = el.style.display !== 'none' && el.classList.contains('chatassist-contact-overlay-visible');
    el.classList.remove('chatassist-contact-overlay-visible');
    el.style.display = 'none';
    if (!wasVisible) return;
    if (restore) {
      const input = document.getElementById('chatassist-input');
      if (input && pendingOfflineMessage != null) input.value = pendingOfflineMessage;
      if (pendingOfflineAttachments && pendingOfflineAttachments.length) {
        draftAttachments = pendingOfflineAttachments.slice();
        renderAttachmentChips();
      }
    } else {
      // Clear the input after successful submit.
      const input = document.getElementById('chatassist-input');
      if (input) input.value = '';
    }
  }

  function showEndOverlay() {
    const el = document.getElementById('chatassist-end-overlay');
    if (el) {
      el.style.display = 'flex';
      el.classList.add('chatassist-end-overlay-visible');
    }
  }

  function hideEndOverlay() {
    const el = document.getElementById('chatassist-end-overlay');
    if (el) {
      el.classList.remove('chatassist-end-overlay-visible');
      el.style.display = 'none';
    }
  }

  function submitContactAndSendPending() {
    const email = document.getElementById('chatassist-contact-email')?.value.trim();
    const name = document.getElementById('chatassist-contact-name')?.value.trim();
    if (!name) {
      showToast('Please enter your name.');
      document.getElementById('chatassist-contact-name')?.focus();
      return;
    }
    if (!email) {
      showToast('Please enter your email.');
      document.getElementById('chatassist-contact-email')?.focus();
      return;
    }
    const msg = pendingOfflineMessage;
    const atts = Array.isArray(pendingOfflineAttachments) ? pendingOfflineAttachments.slice() : [];
    pendingOfflineMessage = null;
    pendingOfflineAttachments = [];
    hideContactOverlay(false);
    if (name) localStorage.setItem(`ai_chatassist_contact_name_${CONFIG.websiteId}`, name);
    localStorage.setItem(`ai_chatassist_contact_email_${CONFIG.websiteId}`, email);
    if (msg || (atts && atts.length)) {
      const meta = { visitor_name: name, visitor_email: email };
      try {
        meta._client_message_id = (window.crypto && window.crypto.randomUUID)
          ? window.crypto.randomUUID()
          : `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      } catch (e) { }
      const outgoing = serializeMessageWithAttachments(msg, atts);
      appendMessage('visitor', outgoing, new Date().toISOString(), meta, null);
      sendMessage(outgoing, meta);
      smartScroll();
    }
  }

  // --- Initialization ---

  function createWidget() {
    const container = document.createElement('div');
    container.id = 'chatassist-widget';
    container.innerHTML = `
      <div id="chatassist-bubble">
        <div id="chatassist-dots-preview">
          <span></span><span></span><span></span>
        </div>
        <div id="chatassist-msg-popup">
          <div class="chatassist-popup-header">
            <div id="chatassist-popup-avatar-wrap" class="chatassist-popup-avatar-placeholder">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </div>
            <div class="chatassist-popup-name" id="chatassist-popup-name">Support</div>
            <button class="chatassist-popup-close" id="chatassist-popup-close" type="button">&times;</button>
          </div>
          <div class="chatassist-popup-body" id="chatassist-popup-body"></div>
          <button class="chatassist-popup-reply" id="chatassist-popup-reply" type="button">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            Reply
          </button>
        </div>
        <div id="chatassist-bubble-pill">
          <span id="chatassist-bubble-text">${CONFIG.bubbleText}</span>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="currentColor" preserveAspectRatio="xMidYMid meet" width="24" height="24"><path d="M63.113,18.51v-.16C60.323,7.05,44.582,3,31.972,3S3.582,7,.792,18.5a66.22,66.22,0,0,0,0,20.46c1.18,4.74,5.05,8.63,11.36,11.41l-4,5A3.47,3.47,0,0,0,10.882,61a3.39,3.39,0,0,0,1.44-.31L26.862,54c1.79.18,3.49.27,5.07.27,11.04.04,28.41-4.04,31.18-15.43a60.33,60.33,0,0,0,0-20.33Z"></path></svg>
          <span id="chatassist-bubble-unread" style="display:none;"></span>
          <div id="chatassist-bubble-online-dot"></div>
        </div>
      </div>
      <div id="chatassist-window" style="display: none;">
        <div id="chatassist-contact-overlay" class="chatassist-contact-overlay">
          <div class="chatassist-contact-overlay-backdrop"></div>
          <div class="chatassist-contact-overlay-panel">
            <div class="chatassist-contact-overlay-header">
              <div class="chatassist-contact-overlay-title">Please introduce yourself</div>
              <button id="chatassist-contact-overlay-close" class="chatassist-contact-overlay-close">&times;</button>
            </div>
            <div class="chatassist-contact-overlay-subtitle">Leave your contact info so we can get back to you.</div>
            <div id="chatassist-contact-msg-preview" class="chatassist-contact-msg-preview" style="display:none;"></div>
            <div class="chatassist-contact-form">
              <input type="text" id="chatassist-contact-name" placeholder="Your name" autocomplete="name" />
              <input type="email" id="chatassist-contact-email" placeholder="Your email" autocomplete="email" />
            </div>
            <div class="chatassist-contact-overlay-actions">
              <button id="chatassist-contact-overlay-submit" class="chatassist-contact-overlay-submit">Send message</button>
            </div>
          </div>
        </div>
        <div id="chatassist-end-overlay" class="chatassist-end-overlay" style="display:none;">
          <div class="chatassist-end-overlay-backdrop"></div>
          <div class="chatassist-end-overlay-panel">
            <div class="chatassist-end-overlay-title">End this chat?</div>
            <div class="chatassist-end-overlay-actions">
              <button id="chatassist-end-cancel" class="chatassist-end-overlay-cancel">Cancel</button>
              <button id="chatassist-end-confirm" class="chatassist-end-overlay-confirm">End chat</button>
            </div>
          </div>
        </div>
        <div id="chatassist-rating-overlay" class="chatassist-rating-overlay" style="display:none;">
          <div class="chatassist-rating-overlay-backdrop"></div>
          <div class="chatassist-rating-overlay-panel">
            <button id="chatassist-rating-close" class="chatassist-rating-close">&times;</button>
            <div class="chatassist-rating-title">How would you rate our support?</div>
            <div class="chatassist-rating-emojis">
              <button class="chatassist-rating-btn" data-rating="1" title="Good">
                <span class="chatassist-rating-emoji">&#x1F60A;</span>
              </button>
              <button class="chatassist-rating-btn" data-rating="0" title="Neutral">
                <span class="chatassist-rating-emoji">&#x1F610;</span>
              </button>
              <button class="chatassist-rating-btn" data-rating="-1" title="Bad">
                <span class="chatassist-rating-emoji">&#x1F61E;</span>
              </button>
            </div>
            <div id="chatassist-rating-thanks" class="chatassist-rating-thanks" style="display:none;">
              Thank you for your feedback!
            </div>
          </div>
        </div>
        <div id="chatassist-header">
          <div class="chatassist-header-content">
            <div id="chatassist-header-icon" class="chatassist-header-avatars">
              <div id="chatassist-header-icon-inner"></div>
            </div>
            <div class="chatassist-header-info">
              <span class="chatassist-header-title">${CONFIG.headerTitle}</span>
              <div class="chatassist-online-status"><span class="chatassist-online-dot"></span><span class="chatassist-online-text">${CONFIG.onlineStatusText}</span></div>
            </div>
          </div>
          <div class="chatassist-header-actions">
            <button id="chatassist-minimize" class="chatassist-header-btn" aria-label="Minimize chat">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
            </button>
            <button id="chatassist-end" class="chatassist-header-btn chatassist-end-btn" aria-label="End chat" title="End chat">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
        </div>
        <div id="chatassist-messages"></div>
        <div id="chatassist-empty-state" class="chatassist-empty-state">
          <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <div>Send a message to start the conversation</div>
        </div>
        <div id="chatassist-new-msg-indicator" class="chatassist-new-msg-indicator" style="display:none;">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
          <span>New message</span>
        </div>
        <div id="chatassist-footer">
          <div id="chatassist-typing" class="chatassist-typing" style="display:none;">
            <span class="chatassist-typing-label">Agent is typing</span>
            <span class="chatassist-typing-dots">
              <span></span><span></span><span></span>
            </span>
          </div>
          <div id="chatassist-input-container">
            <div id="chatassist-attachments" style="display:none;"></div>
            <div id="chatassist-input-row">
            ${CONFIG.showAttachments ? `
              <input id="chatassist-file" type="file" style="display:none;" multiple />
              <button id="chatassist-attach" class="chatassist-attach" type="button" aria-label="Attach files">
                <span class="chatassist-attach-icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21.44 11.05l-8.49 8.49a5 5 0 0 1-7.07-7.07l8.49-8.49a3.5 3.5 0 0 1 4.95 4.95l-8.49 8.49a2 2 0 0 1-2.83-2.83l8.49-8.49"/>
                  </svg>
                </span>
                <span class="chatassist-attach-spinner" aria-hidden="true"></span>
              </button>
            ` : ``}
            <textarea id="chatassist-input" placeholder="Type your message..." rows="1"></textarea>
            <button id="chatassist-send" aria-label="Send message"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg></button>
            </div>
          </div>
          <div id="chatassist-branding">${CONFIG.brandingText}</div>
        </div>
      </div>
      <div id="chatassist-toast-container" style="display:none;"></div>
    `;
    document.body.appendChild(container);
    setTimeout(() => container.classList.add('chatassist-visible'), 100);

    // Event Listeners
    const bubble = document.getElementById('chatassist-bubble');
    const win = document.getElementById('chatassist-window');
    const input = document.getElementById('chatassist-input');

    function openWidget() {
      enableNotificationSound();
      setUnreadCount(0);
      markRead();
      hideDotsPreview();
      hideMessagePopup(true);
      bubble.style.display = 'none';
      win.style.display = 'flex';
      // Re-trigger open animation
      win.classList.remove('chatassist-window-closing');
      win.style.animation = 'none';
      win.offsetHeight; // force reflow
      win.style.animation = '';
      input.focus();
      isAtBottom = true;
      hideNewMsgIndicator();
      setTimeout(function () { scrollToBottom(false); }, 50);
      if (endChatDisabled) setEndChatDisabled(true);
      // Persist open state
      try { localStorage.setItem('ai_chatassist_widget_open_' + CONFIG.websiteId, '1'); } catch (e) { }
    }

    function closeWidget(restoreOverlay) {
      win.classList.add('chatassist-window-closing');
      win.addEventListener('animationend', function onEnd() {
        win.removeEventListener('animationend', onEnd);
        win.classList.remove('chatassist-window-closing');
        win.style.display = 'none';
        bubble.style.display = 'inline-flex';
      }, { once: true });
      // Persist minimized state
      try { localStorage.setItem('ai_chatassist_widget_open_' + CONFIG.websiteId, '0'); } catch (e) { }
      if (restoreOverlay) hideContactOverlay(true);
      hideEndOverlay();
    }

    bubble.addEventListener('click', openWidget);

    document.getElementById('chatassist-minimize').addEventListener('click', () => {
      closeWidget(true);
    });

    document.getElementById('chatassist-end').addEventListener('click', () => {
      showEndOverlay();
    });

    document.getElementById('chatassist-end-cancel').addEventListener('click', () => {
      hideEndOverlay();
    });

    document.getElementById('chatassist-new-msg-indicator').addEventListener('click', () => {
      hideNewMsgIndicator();
      scrollToBottom(true);
      markRead();
    });

    document.getElementById('chatassist-end-confirm').addEventListener('click', () => {
      hideEndOverlay();
      try {
        const ok = sendEndChat();
        if (ok) setEndChatDisabled(true);
      } catch (e) { }
      // Show rating overlay instead of immediately closing
      showRatingOverlay(CONFIG.conversationId || null);
    });

    // Rating overlay buttons
    document.getElementById('chatassist-rating-close').addEventListener('click', () => {
      hideRatingOverlay();
    });
    document.querySelectorAll('.chatassist-rating-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.chatassist-rating-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        const val = parseInt(btn.getAttribute('data-rating'), 10);
        submitRating(val);
      });
    });

    document.getElementById('chatassist-contact-overlay-close').addEventListener('click', () => hideContactOverlay(true));
    document.getElementById('chatassist-contact-overlay-submit').addEventListener('click', submitContactAndSendPending);
    document.getElementById('chatassist-send').addEventListener('click', handleUserMessage);

    // Popup notification buttons
    document.getElementById('chatassist-popup-close').addEventListener('click', function (e) {
      e.stopPropagation();
      hideMessagePopup();
    });
    document.getElementById('chatassist-popup-reply').addEventListener('click', function (e) {
      e.stopPropagation();
      hideMessagePopup(true);
      openWidget();
    });

    if (CONFIG.showAttachments) {
      const fileInput = document.getElementById('chatassist-file');
      const attachBtn = document.getElementById('chatassist-attach');

      if (attachBtn && fileInput) {
        attachBtn.addEventListener('click', () => {
          try { fileInput.click(); } catch (e) { }
        });

        fileInput.addEventListener('change', async () => {
          const files = Array.from(fileInput.files || []);
          fileInput.value = '';
          if (!files.length) return;

          setUploadingAttachmentsCount(uploadingAttachmentsCount + files.length);

          const results = await Promise.allSettled(files.map(async (f) => uploadWidgetAttachment(f)));
          results.forEach((r) => {
            if (r.status === 'fulfilled' && r.value) {
              draftAttachments.push(r.value);
            } else if (r.status === 'rejected') {
              showToast(r.reason && r.reason.message ? r.reason.message : 'Upload failed');
            }
          });
          renderAttachmentChips();
          setUploadingAttachmentsCount(uploadingAttachmentsCount - files.length);
        });
      }
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        enableNotificationSound();
        handleUserMessage();
      }
    });

    input.addEventListener('input', () => {
      autoResizeInput();
      const value = input.value || '';
      const hasText = value.trim().length > 0;

      if (!hasText) {
        if (visitorTypingTimer) {
          clearTimeout(visitorTypingTimer);
          visitorTypingTimer = null;
        }
        if (visitorTypingActive) {
          visitorTypingActive = false;
          sendTyping(false);
        }
        return;
      }

      if (!visitorTypingActive) {
        visitorTypingActive = true;
        sendTyping(true);
      }

      if (visitorTypingTimer) {
        clearTimeout(visitorTypingTimer);
      }

      visitorTypingTimer = setTimeout(() => {
        visitorTypingTimer = null;
        if (visitorTypingActive) {
          visitorTypingActive = false;
          sendTyping(false);
        }
      }, 1600);
    });

    const messagesContainer = document.getElementById('chatassist-messages');
    if (messagesContainer) messagesContainer.addEventListener('scroll', handleMessagesScroll);

    // Prefill
    try {
      const name = localStorage.getItem(`ai_chatassist_contact_name_${CONFIG.websiteId}`);
      const email = localStorage.getItem(`ai_chatassist_contact_email_${CONFIG.websiteId}`);
      if (name) document.getElementById('chatassist-contact-name').value = name;
      if (email) document.getElementById('chatassist-contact-email').value = email;
    } catch (e) { }

    refreshHeaderIcon();
    renderAttachmentChips();
    updateEmptyState();

    // Arm notification sound on first user gesture (must happen early).
    armSoundOnFirstGesture();
  }

  function autoResizeInput() {
    const input = document.getElementById('chatassist-input');
    if (!input) return;
    input.style.height = 'auto';
    const maxH = 100; // max ~4 lines
    input.style.height = Math.min(input.scrollHeight, maxH) + 'px';
    input.style.overflowY = input.scrollHeight > maxH ? 'auto' : 'hidden';
  }

  function updateEmptyState() {
    const emptyEl = document.getElementById('chatassist-empty-state');
    if (!emptyEl) return;
    const container = document.getElementById('chatassist-messages');
    if (!container) return;
    // Show empty state only when there are no message elements.
    const hasMessages = container.querySelector('.chatassist-message, .chatassist-date-separator');
    emptyEl.style.display = hasMessages ? 'none' : 'flex';
  }

  function setupPageViewTracking() {
    if (pageViewTrackingInitialized) return;
    pageViewTrackingInitialized = true;
    try {
      const key = `aichatassist_last_tracked_url_${CONFIG.websiteId}_${CONFIG.sessionId}`;
      lastTrackedUrl = sessionStorage.getItem(key) || null;
    } catch (e) { }

    const sendTrack = (ref) => {
      const url = window.location.href;
      const payload = {
        type: 'page_view',
        url,
        title: document.title,
        referrer: ref || document.referrer || null,
        device_info: getDeviceInfo(),
        browser_info: getBrowserInfo(),
      };
      lastTrackedUrl = url;
      try { sessionStorage.setItem(`aichatassist_last_tracked_url_${CONFIG.websiteId}_${CONFIG.sessionId}`, url); } catch (e) { }
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
      else pendingPageView = payload;
    };

    const wrap = (obj, prop, cb) => {
      const orig = obj[prop];
      obj[prop] = function () {
        const res = orig.apply(this, arguments);
        cb();
        return res;
      };
    };

    wrap(history, 'pushState', () => sendTrack(lastTrackedUrl));
    wrap(history, 'replaceState', () => sendTrack(lastTrackedUrl));
    window.addEventListener('popstate', () => sendTrack(lastTrackedUrl));
    sendTrack(null);
  }

  function connectPresenceWebSocket() {
    if (presenceWs && presenceWs.readyState === WebSocket.OPEN) return;
    try {
      presenceWs = new WebSocket(`${CONFIG.wsUrl}/ws/presence/${CONFIG.websiteId}`);
      presenceWs.onopen = () => {
        presenceReconnectAttempts = 0;
        if (presencePingInterval) clearInterval(presencePingInterval);
        presencePingInterval = setInterval(() => {
          if (presenceWs.readyState === WebSocket.OPEN) presenceWs.send('ping');
        }, 10000); // 10s ping
        presenceWs.send('ping');
      };
      presenceWs.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.type === 'presence') applyPresence(data);
      };
      presenceWs.onclose = () => {
        if (presencePingInterval) clearInterval(presencePingInterval);
        presenceWs = null;
        if (presenceReconnectTimeout) {
          clearTimeout(presenceReconnectTimeout);
          presenceReconnectTimeout = null;
        }
        const delay = Math.min(PRESENCE_RECONNECT_BASE_MS * Math.pow(2, presenceReconnectAttempts), 30000);
        presenceReconnectAttempts += 1;
        presenceReconnectTimeout = setTimeout(() => {
          connectPresenceWebSocket();
        }, delay);
      };
    } catch (e) { }
  }

  function applyPresence(presence) {
    const titleEl = document.querySelector('.chatassist-header-title');
    const statusTextEl = document.querySelector('.chatassist-online-text');
    if (!titleEl || !statusTextEl) return;

    const count = presence.available_agents_count ?? (presence.agents?.length || 0);
    presenceOnline = count > 0;
    if (presenceOnline) hideContactOverlay(false);

    // Update bubble online dot
    const bubbleDot = document.getElementById('chatassist-bubble-online-dot');
    if (bubbleDot) bubbleDot.classList.toggle('chatassist-dot-online', presenceOnline);

    // Update header online dot
    const headerDot = document.querySelector('.chatassist-online-dot');
    if (headerDot) headerDot.style.background = presenceOnline ? '#22c55e' : '#ef4444';

    if (!presenceOnline) {
      titleEl.textContent = 'Send us a message';
      statusTextEl.textContent = 'Happy to answer you later';
      activeAgentAvatarUrl = null;
      activeAgentName = null;
    } else {
      titleEl.textContent = CONFIG.headerTitle;
      statusTextEl.textContent = CONFIG.onlineStatusText;
    }
    refreshHeaderIcon();
  }

  function getDeviceInfo() {
    const ua = navigator.userAgent;
    if (/Windows/i.test(ua)) return 'Windows';
    if (/Android/i.test(ua)) return 'Android';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
    if (/Mac/i.test(ua)) return 'macOS';
    if (/Linux/i.test(ua)) return 'Linux';
    return 'Unknown';
  }

  function getBrowserInfo() {
    const ua = navigator.userAgent;
    if (/Edg/i.test(ua)) return 'Edge';
    if (/Chrome/i.test(ua)) return 'Chrome';
    if (/Firefox/i.test(ua)) return 'Firefox';
    if (/Safari/i.test(ua)) return 'Safari';
    return 'Unknown';
  }

  function getSessionId() {
    const key = `ai_chatassist_session_id_${CONFIG.websiteId}`;
    let id = localStorage.getItem(key);
    if (!id) {
      id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
      localStorage.setItem(key, id);
    }
    return id;
  }

  async function init() {
    CONFIG.sessionId = getSessionId();
    try {
      createWidget();

      // Restore end-chat disabled state (per session) before wiring events.
      hydrateEndChatDisabled();

      // Apply config styles immediately to avoid flicker/jump on reload.
      try {
        const widget = document.getElementById('chatassist-widget');
        const pos = CONFIG.position.replace('bottom-', 'b-').replace('top-', 't-').replace('left', 'l').replace('right', 'r');
        widget.className = `chatassist-position-${pos} chatassist-theme-${CONFIG.theme}`;
        // Compute the CSS background value based on color mode
        const themeBackground = CONFIG.colorMode === 'gradient'
          ? `linear-gradient(135deg, ${CONFIG.gradientStart} 0%, ${CONFIG.gradientEnd} 100%)`
          : CONFIG.primaryColor;
        const pillEl = document.getElementById('chatassist-bubble-pill');
        if (pillEl) pillEl.style.background = themeBackground;
        document.getElementById('chatassist-header').style.background = themeBackground;
        document.getElementById('chatassist-send').style.background = themeBackground;
        // Update popup reply button color too
        const replyBtn = document.getElementById('chatassist-popup-reply');
        if (replyBtn) replyBtn.style.background = themeBackground;
        // Update visitor message bubbles and contact overlay submit
        const contactSubmit = document.querySelector('.chatassist-contact-overlay-submit');
        if (contactSubmit) contactSubmit.style.background = themeBackground;
        // Apply to visitor message CSS via a dynamic style element
        let themeStyle = document.getElementById('chatassist-theme-style');
        if (!themeStyle) {
          themeStyle = document.createElement('style');
          themeStyle.id = 'chatassist-theme-style';
          document.head.appendChild(themeStyle);
        }
        themeStyle.textContent = `.chatassist-message-visitor .chatassist-message-bubble { background: ${themeBackground} !important; }`;
      } catch (e) { }

      await fetchReadState();

      setupPageViewTracking();
      connectWebSocket();
      connectPresenceWebSocket();
    } catch (e) {
      console.error('[ChatWidget] Init failed:', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1000));
  } else {
    setTimeout(init, 1000);
  }

})();
