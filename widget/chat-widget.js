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
    wsUrl: globalConfig.wsUrl || (scriptElement ? scriptElement.getAttribute('data-ws-url') : null) || derivedWsBase || '',
    apiUrl: globalConfig.apiUrl || (scriptElement ? scriptElement.getAttribute('data-api-url') : null) || derivedApiBase || '',
    theme: globalConfig.theme || 'dark',
    position: globalConfig.position || 'bottom-right',
    welcomeMessage: globalConfig.welcomeMessage || 'Hi! How can we help you today?',
    primaryColor: globalConfig.primaryColor || '#000000',
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

  let presenceOnline = true;
  let activeAgentAvatarUrl = null;
  let activeAgentName = null;
  let pendingOfflineMessage = null;

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

  function setAgentTyping(isTyping, name) {
    const el = document.getElementById('chatassist-typing');
    if (!el) return;
    if (isTyping) {
      const label = el.querySelector('.chatassist-typing-label');
      if (label) label.textContent = `${name || 'Agent'} is typing`;
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
      // Best-effort: arm audio on first user gesture so notification beeps can work.
      // Browsers block audio until the user interacts.
      try {
        const _arm = () => enableNotificationSound();
        document.addEventListener('pointerdown', _arm, { once: true, passive: true });
        document.addEventListener('keydown', _arm, { once: true });
        document.addEventListener('touchstart', _arm, { once: true, passive: true });
      } catch (e) { }
      osc.connect(gain);
      gain.connect(notificationAudioCtx.destination);
      osc.start();
      osc.stop(notificationAudioCtx.currentTime + 0.14);
    } catch (e) { }
  }

  // --- API & State Management ---

  async function fetchReadState() {
    try {
      const response = await fetch(`${CONFIG.apiUrl}/widget/read-state?website_id=${CONFIG.websiteId}&session_id=${CONFIG.sessionId}`);
      if (response.ok) {
        const data = await response.json();
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
      data.messages.forEach(m => {
        const senderType = m.sender_type || m.sender || 'system';
        const actor = m.actor || senderType;
        const kind = m.kind || (actor === 'system' ? 'event' : 'chat');
        const eventType = m.event_type || null;

        if (actor === 'visitor') {
          appendMessage('visitor', m.content, m.created_at, null, m.id);
        } else if (actor === 'agent') {
          if (m.sender_avatar_url) updateAgentAvatar(m.sender_avatar_url);
          if (m.sender_name) updateAgentName(m.sender_name);
          appendMessage('agent', m.content, m.created_at, { avatarUrl: m.sender_avatar_url, name: m.sender_name }, m.id);
        } else if (actor === 'bot' || (actor === 'system' && kind === 'chat') || (senderType === 'system' && (eventType === 'bot' || (eventType && eventType.startsWith('automation'))))) {
          appendMessage('ai', m.content, m.created_at, null, m.id);
        } else if (actor === 'system') {
          if (eventType === 'agent_join') showJoinMessage(m.content, m.created_at);
          else showSystemMessage(m.content);
        } else {
          appendMessage('ai', m.content, m.created_at, null, m.id);
        }
      });
      smartScroll();
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

      if (actor === 'system' && kind === 'event') {
        if (eventType === 'agent_join') showJoinMessage(data.message, createdAt);
        else showSystemMessage(data.message);
      } else {
        // Bot/system chat message delivered as a system frame.
        appendMessage('ai', data.message, createdAt, null, dto && dto.id);
      }
      smartScroll();
      return;
    }

    if (data.type === 'ai' || data.type === 'bot') {
      const createdAt = data.created_at || (data.message_obj && data.message_obj.created_at);
      appendMessage('ai', data.message, createdAt, null, data.message_obj?.id);
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
        bumpUnread();
        playNotificationSound();
        showToast('New message');
      }
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

          // Auto-remove divider after 5 seconds of viewing
          setTimeout(() => {
            unreadDivider.classList.add('chatassist-unread-divider-hidden');
            setTimeout(() => {
              if (unreadDivider.parentNode) unreadDivider.parentNode.removeChild(unreadDivider);
            }, 1000);
          }, 5000);
          return;
        }

        if (isAtBottom || !unreadDivider) {
          el.scrollTop = el.scrollHeight;
        }
      });
    });
  }

  function handleMessagesScroll() {
    const el = document.getElementById('chatassist-messages');
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40; // Increased threshold for better reliability
    isAtBottom = nearBottom;
    if (nearBottom && firstUnreadMessageId) markRead();
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

  function appendMessage(sender, content, createdAtIso, meta, messageId) {
    const container = document.getElementById('chatassist-messages');
    if (!container) return;

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
    bubble.textContent = content;

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
    if (!message) return;

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
      appendMessage('visitor', message, new Date().toISOString(), meta, null);
      input.value = '';
      sendMessage(message, meta);
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
      appendMessage('visitor', message, new Date().toISOString(), meta, null);
      input.value = '';
      sendMessage(message, meta);
      smartScroll();
      return;
    }

    pendingOfflineMessage = message;
    input.value = '';
    showContactOverlay();
  }

  function showContactOverlay() {
    const el = document.getElementById('chatassist-contact-overlay');
    if (el) {
      el.style.display = 'flex';
      el.classList.add('chatassist-contact-overlay-visible');
      document.getElementById('chatassist-contact-email')?.focus();
    }
  }

  function hideContactOverlay(restore) {
    const el = document.getElementById('chatassist-contact-overlay');
    if (el) {
      el.classList.remove('chatassist-contact-overlay-visible');
      el.style.display = 'none';
      if (restore && pendingOfflineMessage) {
        const input = document.getElementById('chatassist-input');
        if (input) input.value = pendingOfflineMessage;
      }
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
    if (!email) {
      showToast('Please enter your email so we can contact you.');
      return;
    }
    const msg = pendingOfflineMessage;
    pendingOfflineMessage = null;
    hideContactOverlay(false);
    if (name) localStorage.setItem(`ai_chatassist_contact_name_${CONFIG.websiteId}`, name);
    localStorage.setItem(`ai_chatassist_contact_email_${CONFIG.websiteId}`, email);
    if (msg) {
      const meta = { visitor_name: name, visitor_email: email };
      try {
        meta._client_message_id = (window.crypto && window.crypto.randomUUID)
          ? window.crypto.randomUUID()
          : `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      } catch (e) { }
      appendMessage('visitor', msg, new Date().toISOString(), meta, null);
      sendMessage(msg, meta);
      smartScroll();
    }
  }

  // --- Initialization ---

  function createWidget() {
    const container = document.createElement('div');
    container.id = 'chatassist-widget';
    container.innerHTML = `
      <div id="chatassist-bubble">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
        <span id="chatassist-bubble-unread" style="display:none;"></span>
        <div id="chatassist-bubble-text">${CONFIG.bubbleText}</div>
      </div>
      <div id="chatassist-window" style="display: none;">
        <div id="chatassist-contact-overlay" class="chatassist-contact-overlay">
          <div class="chatassist-contact-overlay-backdrop"></div>
          <div class="chatassist-contact-overlay-panel">
            <div class="chatassist-contact-overlay-header">
              <div class="chatassist-contact-overlay-title">Please introduce yourself</div>
              <button id="chatassist-contact-overlay-close" class="chatassist-contact-overlay-close">&times;</button>
            </div>
            <div class="chatassist-contact-overlay-subtitle">We'll use your contact info only if all agents are offline and can't reply immediately.</div>
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
        <div id="chatassist-header">
          <div class="chatassist-header-content">
            <div id="chatassist-header-icon" class="chatassist-header-avatars">
              <div id="chatassist-header-icon-inner"></div>
              <span id="chatassist-presence-badge" class="chatassist-presence-badge"></span>
            </div>
            <div class="chatassist-header-info">
              <span class="chatassist-header-title">${CONFIG.headerTitle}</span>
              <div class="chatassist-online-status"><span class="chatassist-online-text">${CONFIG.onlineStatusText}</span></div>
            </div>
          </div>
          <div class="chatassist-header-actions">
            <button id="chatassist-minimize" class="chatassist-header-btn" aria-label="Minimize chat">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
            </button>
            <button id="chatassist-end" class="chatassist-header-btn" aria-label="End chat">&times;</button>
          </div>
        </div>
        <div id="chatassist-messages"></div>
        <div id="chatassist-footer">
          <div id="chatassist-typing" class="chatassist-typing" style="display:none;">
            <span class="chatassist-typing-label">Agent is typing</span>
            <span class="chatassist-typing-dots">
              <span></span><span></span><span></span>
            </span>
          </div>
          <div id="chatassist-input-container">
            <input type="text" id="chatassist-input" placeholder="Type your message..." />
            <button id="chatassist-send">Send</button>
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

    bubble.addEventListener('click', () => {
      enableNotificationSound();
      setUnreadCount(0);
      bubble.style.display = 'none';
      win.style.display = 'flex';
      input.focus();
      isAtBottom = true;
      smartScroll();
      // Ensure End button state is applied on reopen.
      if (endChatDisabled) setEndChatDisabled(true);
    });

    document.getElementById('chatassist-minimize').addEventListener('click', () => {
      win.style.display = 'none';
      bubble.style.display = 'flex';
      hideContactOverlay(true);
      hideEndOverlay();
    });

    document.getElementById('chatassist-end').addEventListener('click', () => {
      showEndOverlay();
    });

    document.getElementById('chatassist-end-cancel').addEventListener('click', () => {
      hideEndOverlay();
    });

    document.getElementById('chatassist-end-confirm').addEventListener('click', () => {
      hideEndOverlay();
      try {
        const ok = sendEndChat();
        if (ok) setEndChatDisabled(true);
      } catch (e) { }
      win.style.display = 'none';
      bubble.style.display = 'flex';
      hideContactOverlay(true);
    });

    document.getElementById('chatassist-contact-overlay-close').addEventListener('click', () => hideContactOverlay(true));
    document.getElementById('chatassist-contact-overlay-submit').addEventListener('click', submitContactAndSendPending);
    document.getElementById('chatassist-send').addEventListener('click', handleUserMessage);

    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        enableNotificationSound();
        handleUserMessage();
      }
    });

    input.addEventListener('input', () => {
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
    const badgeEl = document.getElementById('chatassist-presence-badge');
    if (!titleEl || !statusTextEl) return;

    const count = presence.available_agents_count ?? (presence.agents?.length || 0);
    presenceOnline = count > 0;
    if (presenceOnline) hideContactOverlay(false);

    if (badgeEl) {
      badgeEl.style.display = 'flex';
      badgeEl.classList.toggle('chatassist-presence-badge-offline', !presenceOnline);
      badgeEl.textContent = presenceOnline ? String(count) : '';
    }

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
        document.getElementById('chatassist-bubble').style.background = CONFIG.primaryColor;
        document.getElementById('chatassist-header').style.background = CONFIG.primaryColor;
        document.getElementById('chatassist-send').style.background = CONFIG.primaryColor;
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
