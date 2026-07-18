/**
 * AI ChatAssist - Visitor Chat Widget
 * Vanilla JavaScript WebSocket-based chat widget
 * Loaded dynamically via loader.js with website-specific configuration
 */

(function () {
  'use strict';

  // Shared bot/AI avatar mascot — used for every bot message avatar in the
  // thread. Kept as one constant so future AI-handled flows reuse the same
  // icon instead of re-inlining this SVG at each call site.
  const BOT_AVATAR_SVG = '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect fill="#eff3f9" height="29" rx="4" width="34" x="7" y="15"/><path d="m11 38v-23c-2.209 0-4 1.791-4 4v21c0 2.209 1.791 4 4 4h26c2.209 0 4-1.791 4-4h-28c-1.105 0-2-.895-2-2z" fill="#cfe0f3"/><circle cx="18" cy="25" fill="#afb4c2" r="2"/><circle cx="30" cy="25" fill="#afb4c2" r="2"/><path d="m45 36h-4v-13h4c1.105 0 2 .895 2 2v9c0 1.105-.895 2-2 2z" fill="#8c94af"/><path d="m3 36h4v-13h-4c-1.105 0-2 .895-2 2v9c0 1.105.895 2 2 2z" fill="#8c94af"/><path d="m45 32h-4v4h4c1.105 0 2-.895 2-2v-4c0 1.105-.895 2-2 2z" fill="#6f7792"/><path d="m1 30v4c0 1.105.895 2 2 2h4v-4h-4c-1.105 0-2-.895-2-2z" fill="#6f7792"/><circle cx="24" cy="6" fill="#ff3b65" r="3"/><path d="m25.5 7c-1.381 0-2.5-1.119-2.5-2.5 0-.54.175-1.037.467-1.446-1.402.252-2.467 1.472-2.467 2.946 0 1.657 1.343 3 3 3 1.474 0 2.694-1.065 2.946-2.467-.409.291-.906.467-1.446.467z" fill="#d82b50" opacity=".75"/><g fill="#08105e"><path d="m21 25c0-1.654-1.346-3-3-3s-3 1.346-3 3 1.346 3 3 3 3-1.346 3-3zm-3 1c-.551 0-1-.448-1-1s.449-1 1-1 1 .449 1 1-.449 1-1 1z"/><path d="m30 22c-1.654 0-3 1.346-3 3s1.346 3 3 3 3-1.346 3-3-1.346-3-3-3zm0 4c-.551 0-1-.448-1-1s.449-1 1-1 1 .449 1 1-.449 1-1 1z"/><path d="m28.543 33.91c-2.815 1.447-6.271 1.447-9.086 0-.492-.253-1.094-.059-1.347.433s-.059 1.094.433 1.347c1.669.857 3.556 1.311 5.457 1.311s3.788-.453 5.457-1.311c.491-.253.685-.855.433-1.347s-.855-.686-1.347-.433z"/><path d="m45 22h-3v-3c0-2.757-2.243-5-5-5h-12v-4.142c1.72-.447 3-2 3-3.858 0-2.206-1.794-4-4-4s-4 1.794-4 4c0 1.858 1.28 3.411 3 3.858v4.142h-12c-2.757 0-5 2.243-5 5v3h-3c-1.654 0-3 1.346-3 3v9c0 1.654 1.346 3 3 3h3v3c0 2.757 2.243 5 5 5h26c2.757 0 5-2.243 5-5v-3h3c1.654 0 3-1.346 3-3v-9c0-1.654-1.346-3-3-3zm-23-16c0-1.103.897-2 2-2s2 .897 2 2-.897 2-2 2-2-.897-2-2zm-19 29c-.551 0-1-.448-1-1v-9c0-.551.449-1 1-1h3v11zm37 5c0 1.654-1.346 3-3 3h-26c-1.654 0-3-1.346-3-3v-21c0-1.654 1.346-3 3-3h26c1.654 0 3 1.346 3 3zm6-6c0 .552-.449 1-1 1h-3v-11h3c.551 0 1 .449 1 1z"/></g></svg>';

  // Same paper-plane glyph as #chatassist-send, reused on the contact-card
  // and offline-overlay submit buttons so every "send" affordance in the
  // widget looks like the same action.
  const SEND_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>';

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
    // Default true (preserve existing behavior) unless explicitly disabled per-website.
    showEndChatButton: globalConfig.showEndChatButton !== false,
    brandingText: globalConfig.brandingText || 'Powered by AI ChatAssist',
    popupName: globalConfig.popupName || 'Support',
    popupButtonText: globalConfig.popupButtonText || 'Reply',
    notificationSoundCollapsed: globalConfig.notificationSoundCollapsed || 'notification.mp3',
    notificationSoundOpened: globalConfig.notificationSoundOpened || 'notification.mp3'
  };

  // State
  // Shadow DOM root — set once in createWidget(). All widget DOM queries go through
  // $id() / $qs() so host-page CSS can't leak into the widget and vice-versa.
  let __shadow = null;
  function $id(id) { return __shadow ? __shadow.querySelector('#' + id) : document.getElementById(id); }
  function $qs(sel) { return __shadow ? __shadow.querySelector(sel) : document.querySelector(sel); }
  function $qsAll(sel) { return __shadow ? __shadow.querySelectorAll(sel) : document.querySelectorAll(sel); }

  let ws = null;
  let presenceWs = null;
  let isConnecting = false;
  let reconnectTimeout = null;
  // Set when the page itself is navigating away/reloading (not a real
  // connectivity drop). The browser tears down the socket as part of
  // unload, which fires ws.onclose — without this flag that looks
  // identical to a genuine disconnect and flashes "Connection lost" during
  // the normal page-swap window (more visible in production, where the
  // next page takes real time to load, than in dev's near-instant swap).
  let _pageUnloading = false;
  try {
    window.addEventListener('pagehide', function () { _pageUnloading = true; });
    window.addEventListener('beforeunload', function () { _pageUnloading = true; });
    // pagehide also fires when the page is frozen into the bfcache (back/forward
    // cache) rather than actually torn down; the browser closes the socket as part
    // of that freeze too. Without this, a bfcache-restored page (Safari/Firefox
    // back button) would be left with _pageUnloading stuck true and no reconnect
    // ever scheduled — chat silently dead until a hard reload.
    window.addEventListener('pageshow', function (e) {
      _pageUnloading = false;
      if (e.persisted && (!ws || ws.readyState !== WebSocket.OPEN) && !isConnecting) {
        connectWebSocket();
      }
    });
  } catch (e) { }
  let presencePingInterval = null;
  let presenceReconnectTimeout = null;
  let presenceReconnectAttempts = 0;
  const PRESENCE_RECONNECT_BASE_MS = 1000;
  let toastTimeout = null;

  let unreadCount = 0;
  let soundEnabled = false;
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

  // "Connecting to agent..." rotating indicator (W3). Shown in the same spot
  // as "Agent is typing" while a real human agent is expected but hasn't
  // joined yet. Never shown for bot-only informational flows (e.g. Careers'
  // sub_prompt replies), when the site/team is offline (contact form path),
  // or before the visitor has actually engaged (still looking at the
  // team-routing buttons, hasn't picked one yet).
  let _agentJoinedThisConv = false;
  let _visitorHasEngaged = false;
  // True once the backend has flagged this conversation bot_only (set on
  // history load and live the moment a bot_only branch, e.g. Careers, is
  // entered — see the 'history'/'bot_prompt' handlers). Monotonic per
  // conversation: only reset on enterStartView(), never flips back to false
  // mid-conversation since the backend itself never un-sets bot_only either.
  let _conversationBotOnly = false;
  let _waitingRotateTimer = null;
  const WAITING_FOR_AGENT_MESSAGES = [
    'Connecting you to an agent',
    'Hang tight, almost there',
    'Thanks for your patience',
  ];

  // Input reveal state machine.
  // The input container starts hidden. It is revealed after 2500ms if no
  // chatbot_pending / bot_prompt message arrives first. On bot_prompt the
  // visitor must click a button (or allow_input=true) to reveal it.
  let _inputRevealTimer = null;
  let _pingInterval = null;
  let pendingOfflineMessage = null;
  let pendingOfflineAttachments = [];
  // Deferred bot button click (when offline form intercepts a button press).
  let pendingBotButtonClick = null;
  // True when the contact overlay was triggered by a team-level offline event
  // while the website is globally online.  Prevents applyPresence() from
  // dismissing the overlay on the next presence ping.
  let _forceContactOverlay = false;
  // Set true once a leaf bot button click has been committed (automation_complete
  // received).  Used to skip the contact overlay when bot_offline arrives after
  // the visitor has already passed the IVR and input is open.
  let _leafButtonCommitted = false;
  // Set true once contact info is sent for this conversation; clears on enterStartView().
  let _contactVerifiedThisConversation = false;
  // Set true the moment the visitor touches any field in the contact overlay.
  // Prevents applyPresence() from auto-dismissing the form mid-fill when
  // agents come online. Reset each time the overlay opens.
  let _contactFormTouched = false;
  // Reference to closeWidget(), set by createWidget(). Allows outer-scope
  // functions (hideRatingOverlay, WS handlers) to minimize the widget without
  // causing a ReferenceError — closeWidget is a nested function in createWidget.
  let _closeWidgetFn = null;
  // The website's designated contact-card form (CC1), if any — used both for
  // the live-chat agent-triggered card and to extend the offline gate with
  // extra fields beyond the 3 hardcoded ones. null if none configured.
  let _contactCardForm = null;

  // ── Input-lock persistence ──────────────────────────────────────────────────
  // When automation_complete fires with allow_input=false (terminal informational
  // paths like "Check Application Status"), we persist a flag to localStorage so
  // the input stays hidden after a page reload.  Cleared when an agent joins.
  function _inputLockKey() {
    if (!CONFIG.websiteId || !CONFIG.conversationId) return null;
    return 'chatassist_input_locked_' + CONFIG.websiteId + '_' + CONFIG.conversationId;
  }
  function _setInputLocked() {
    var k = _inputLockKey();
    if (k) try { localStorage.setItem(k, '1'); } catch (e) {}
  }
  function _clearInputLocked() {
    var k = _inputLockKey();
    if (k) try { localStorage.removeItem(k); } catch (e) {}
  }
  function _isInputLocked() {
    var k = _inputLockKey();
    if (!k) return false;
    try { return localStorage.getItem(k) === '1'; } catch (e) { return false; }
  }

  let uploadingAttachmentsCount = 0;
  let draftAttachments = [];

  let agentTypingActive = false;
  let agentTypingTimer = null;
  let launcherTypingOffTimer = null;
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
  // Set when the visitor intentionally clicks "End chat" so the rating overlay
  // knows to minimise (not run afterConversationClose) on dismiss.
  let ratingTriggeredByVisitorEnd = false;
  // Set when agent resolves so the rating overlay minimises the widget after dismiss.
  let ratingTriggeredByAgentResolve = false;
  // Deferred flag: set when conversation_resolved arrives; cleared once show_rating_popup fires.
  // Safety timeout calls afterConversationClose() if show_rating_popup never arrives.
  let _awaitingRatingAfterResolve = false;
  let _resolveRatingTimeout = null;

  // --- Multi-conversation view state ---
  // viewMode: 'start' | 'list' | 'thread'
  let viewMode = 'start';
  // isReadOnlyThread: true when viewing a resolved conversation from history
  let isReadOnlyThread = false;
  // widgetShowHistory: controlled by website.show_conversation_history setting
  let widgetShowHistory = false;
  // cached resolved conversations from last fetchConversationList call
  let convListHistory = [];

  function _endChatStorageKey() {
    if (!CONFIG.websiteId || !CONFIG.sessionId) return null;
    return `aichatassist_end_chat_disabled_${CONFIG.websiteId}_${CONFIG.sessionId}`;
  }

  // --- Closed-view persistence (history disabled) ---
  // Saves the resolved conversation id so the closed view survives a page reload.
  function _closedStateKey() {
    if (!CONFIG.websiteId || !CONFIG.sessionId) return null;
    return `aichatassist_closed_conv_${CONFIG.websiteId}_${CONFIG.sessionId}`;
  }

  // --- Welcome popup dismissal (12h cooldown, per websiteId across sessions) ---
  function _welcomePopupDismissedKey() {
    if (!CONFIG.websiteId) return null;
    return `ai_chatassist_welcome_popup_dismissed_${CONFIG.websiteId}`;
  }

  function _saveWelcomePopupDismissed() {
    try {
      const k = _welcomePopupDismissedKey();
      if (k) localStorage.setItem(k, String(Date.now()));
    } catch (e) { }
  }

  // Returns true if the popup was dismissed within the last 12 hours.
  function _isWelcomePopupRecentlyDismissed() {
    try {
      const k = _welcomePopupDismissedKey();
      if (!k) return false;
      const v = localStorage.getItem(k);
      if (!v) return false;
      return (Date.now() - parseInt(v, 10)) < 12 * 60 * 60 * 1000;
    } catch (e) { return false; }
  }

  // --- Welcome popup auto-reshow cap ---
  // Without this, a visitor who never clicks the "x" gets the exact same
  // welcome popup on every single page navigation within the site (each page
  // load is a fresh widget init + WS history replay). Industry-standard
  // pattern (Intercom/Drift/Crisp-style proactive messages): show it a
  // couple of times, then back off for the same 12h window used for an
  // explicit dismissal — silence reads as "seen it", not "still nagging".
  const WELCOME_POPUP_MAX_AUTO_SHOWS = 2;
  const WELCOME_POPUP_SHOW_WINDOW_MS = 12 * 60 * 60 * 1000;

  function _welcomePopupShowCountKey() {
    if (!CONFIG.websiteId) return null;
    return `ai_chatassist_welcome_popup_shown_${CONFIG.websiteId}`;
  }

  function _recordWelcomePopupShown() {
    try {
      const k = _welcomePopupShowCountKey();
      if (!k) return;
      let state = null;
      try { state = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { state = null; }
      const now = Date.now();
      if (!state || typeof state.count !== 'number' || (now - state.firstAt) >= WELCOME_POPUP_SHOW_WINDOW_MS) {
        state = { count: 0, firstAt: now };
      }
      state.count += 1;
      localStorage.setItem(k, JSON.stringify(state));
    } catch (e) { }
  }

  // Returns true once the popup has auto-shown its cap within the current
  // 12h window (same window as the dismissal cooldown, for one consistent
  // "leave the visitor alone for a while" rule regardless of which path
  // silenced it).
  function _hasWelcomePopupShownTooManyTimes() {
    try {
      const k = _welcomePopupShowCountKey();
      if (!k) return false;
      const state = JSON.parse(localStorage.getItem(k) || 'null');
      if (!state || typeof state.count !== 'number') return false;
      if ((Date.now() - state.firstAt) >= WELCOME_POPUP_SHOW_WINDOW_MS) return false; // window expired
      return state.count >= WELCOME_POPUP_MAX_AUTO_SHOWS;
    } catch (e) { return false; }
  }

  // --- Contact verification (offline form, 12h cooldown per websiteId) ---
  function _contactVerifiedKey() {
    if (!CONFIG.websiteId) return null;
    return `ai_chatassist_contact_verified_${CONFIG.websiteId}`;
  }

  function _saveContactVerified(name, phone, email) {
    try {
      const k = _contactVerifiedKey();
      if (k) localStorage.setItem(k, JSON.stringify({ ts: Date.now(), name, phone, email: email || '' }));
    } catch (e) { }
  }

  // Returns { name, phone, email } if stored within 12h, otherwise null.
  function _loadContactVerified() {
    try {
      const k = _contactVerifiedKey();
      if (!k) return null;
      const raw = localStorage.getItem(k);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !obj.name || !obj.phone) return null;
      if ((Date.now() - obj.ts) > 12 * 60 * 60 * 1000) return null;
      return obj;
    } catch (e) { return null; }
  }

  // Checks if contact requirement can be satisfied without showing the form.
  // If yes: sends visitor_contact WS frame silently and returns true.
  // If no: returns false (caller must show form).
  function _checkAndSendContactSilently() {
    if (_contactVerifiedThisConversation) return true;
    const stored = _loadContactVerified();
    if (stored) {
      _contactVerifiedThisConversation = true;
      try {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'visitor_contact',
            visitor_name: stored.name,
            visitor_phone: stored.phone,
            visitor_email: stored.email || undefined,
          }));
        }
      } catch (e) { }
      return true;
    }
    return false;
  }

  // --- Resolved-at expiry (24h) ---
  function _resolvedAtKey() {
    if (!CONFIG.websiteId || !CONFIG.sessionId) return null;
    return `aichatassist_resolved_at_${CONFIG.websiteId}_${CONFIG.sessionId}`;
  }

  function _saveResolvedAt(isoString) {
    try {
      const k = _resolvedAtKey();
      if (k && isoString) localStorage.setItem(k, isoString);
    } catch (e) { }
  }

  function _clearResolvedAt() {
    try {
      const k = _resolvedAtKey();
      if (k) localStorage.removeItem(k);
    } catch (e) { }
  }

  // Returns true if the session's resolved conversation is older than 24 hours.
  function _isResolvedConvExpired() {
    try {
      const k = _resolvedAtKey();
      if (!k) return false;
      const v = localStorage.getItem(k);
      if (!v) return false;
      const resolvedMs = new Date(v).getTime();
      if (isNaN(resolvedMs)) return false;
      return (Date.now() - resolvedMs) > 24 * 60 * 60 * 1000;
    } catch (e) { return false; }
  }

  function _saveClosedState(convId) {
    try {
      const k = _closedStateKey();
      if (k && convId) localStorage.setItem(k, String(convId));
    } catch (e) { }
  }

  function _clearClosedState() {
    try {
      const k = _closedStateKey();
      if (k) localStorage.removeItem(k);
    } catch (e) { }
  }

  function _loadClosedState() {
    try {
      const k = _closedStateKey();
      if (!k) return null;
      const v = localStorage.getItem(k);
      return v ? parseInt(v, 10) : null;
    } catch (e) { return null; }
  }

  function setEndChatDisabled(disabled) {
    endChatDisabled = Boolean(disabled);
    const endBtn = $id('chatassist-end');
    if (endBtn) {
      // Only toggle visibility in active (non-readonly) thread mode
      const inActiveThread = viewMode === 'thread' && !isReadOnlyThread;
      endBtn.style.display = (inActiveThread && !endChatDisabled && CONFIG.showEndChatButton) ? '' : 'none';
    }
    if (endChatDisabled) {
      try { hideEndOverlay(); } catch (e) { }
    }
    try {
      const key = _endChatStorageKey();
      if (key) sessionStorage.setItem(key, endChatDisabled ? '1' : '0');
    } catch (e) { }
    try { _updateWaitingForAgentIndicator(); } catch (e) { }
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
      var _woRaw = localStorage.getItem('ai_chatassist_widget_open_' + CONFIG.websiteId);
      var _woOpen = false;
      try { var _woObj = JSON.parse(_woRaw); _woOpen = _woObj && _woObj.v === 1 && (Date.now() - _woObj.ts) < 12 * 60 * 60 * 1000; } catch (e) { _woOpen = _woRaw === '1'; }
      if (_woOpen) {
        const bubble = $id('chatassist-bubble');
        const win = $id('chatassist-window');
        if (bubble && win && win.style.display === 'none') {
          bubble.style.display = 'none';
          win.style.display = 'flex';
          win.classList.remove('chatassist-window-closing');
          setTimeout(function () { scrollToBottom(false); }, 50);
          // Re-measure input height now that the window is visible.
          setTimeout(function () { autoResizeInput(); }, 0);
        }
      }
    } catch (e) { }
  }

  function isWidgetOpen() {
    const win = $id('chatassist-window');
    return !!(win && win.style.display !== 'none');
  }

  function setUnreadCount(next) {
    unreadCount = Math.max(0, Number(next) || 0);
    const el = $id('chatassist-bubble-unread');
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
    const container = $id('chatassist-toast-container');
    if (!container) return;
    container.textContent = message;
    container.style.display = 'block';
    container.classList.add('chatassist-toast-visible');
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(hideToast, 3000);
  }

  function hideToast() {
    const container = $id('chatassist-toast-container');
    if (!container) return;
    container.classList.remove('chatassist-toast-visible');
    container.style.display = 'none';
  }

  // --- Message Popup (Smartsupp-style notification above bubble) ---

  let dotsPreviewTimer = null;
  let msgPopupTimer = null;

  // True while the collapsed dot is showing because of a real signal
  // (agent_typing or chatbot_pending) rather than the fixed fake delay below.
  let _liveDotActive = false;
  let _liveDotShownAt = 0;
  const LIVE_DOT_MIN_MS = 500;

  function showDotsPreview() {
    hideMessagePopup(true);
    const el = $id('chatassist-dots-preview');
    if (el) el.classList.add('chatassist-dots-visible');
  }

  function hideDotsPreview() {
    const el = $id('chatassist-dots-preview');
    if (el) el.classList.remove('chatassist-dots-visible');
    if (dotsPreviewTimer) {
      clearTimeout(dotsPreviewTimer);
      dotsPreviewTimer = null;
    }
    _liveDotActive = false;
  }

  // Collapsed-state counterpart to setAgentTyping(): shows the same dots
  // element the launcher badge already uses, driven by a real typing/pending
  // signal instead of guessing after the message has already arrived.
  function setLauncherTyping(isTyping) {
    if (isWidgetOpen()) return; // open thread has its own indicator
    if (isTyping) {
      _liveDotActive = true;
      _liveDotShownAt = Date.now();
      showDotsPreview();
    } else {
      hideDotsPreview();
    }
  }

  function showMessagePopup(senderName, avatarUrl, messageText) {
    hideDotsPreview();

    const popup = $id('chatassist-msg-popup');
    const nameEl = $id('chatassist-popup-name');
    const bodyEl = $id('chatassist-popup-body');
    const avatarWrap = $id('chatassist-popup-avatar-wrap');

    if (!popup) return;

    if (nameEl) nameEl.textContent = senderName || CONFIG.popupName;
    if (bodyEl) {
      var raw = unescapeMarkdown(String(messageText || ''));
      // Build a plain-text version for length check and image/file fallback detection.
      var plain = raw
        .replace(/!?\[[^\]]*\]\([^)]+\)/g, '')   // strip markdown links/images
        .replace(/\*\*\*([^*\n]*)\*\*\*/g, '$1') // bold+italic
        .replace(/\*\*([^*\n]*)\*\*/g, '$1')      // bold
        .replace(/\*([^*\n]*)\*/g, '$1')           // italic
        .replace(/\\([\\`*_[\]()/])/g, '$1')       // remaining escapes
        .trim();
      if (!plain) {
        // Content was purely images or links — show a friendly fallback.
        if (/!\[[^\]]*\]\([^)]+\)/.test(raw)) plain = '\ud83d\udcf7 Sent an image';
        else if (/\[[^\]]*\]\([^)]+\)/.test(raw)) plain = '\ud83d\udcce Sent a file';
        else plain = 'New message';
        bodyEl.textContent = plain;
      } else {
        // Truncate to the first 10 words so the preview always fits the
        // popup and shows an explicit ellipsis instead of a hard CSS clip.
        var words = plain.split(/\s+/);
        var isTruncated = words.length > 10;
        var truncatedPlain = isTruncated ? words.slice(0, 10).join(' ') : plain;
        // Truncate the markdown source proportionally to plain length so that
        // rendered output roughly matches the truncated plain-text length.
        var mdSrc = isTruncated ? raw.slice(0, raw.length * truncatedPlain.length / plain.length | 0) : raw;
        bodyEl.textContent = '';
        bodyEl.appendChild(renderInlineMarkdown(mdSrc));
        if (isTruncated) {
          bodyEl.appendChild(document.createTextNode('\u2026'));
        }
      }
    }
    if (avatarWrap) {
      const url = getFullAssetUrl(avatarUrl) || getFullAssetUrl(CONFIG.headerIconUrl);
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
        const initials = (senderName || CONFIG.popupName || 'S').trim().split(/\s+/).slice(0, 2).map(function (p) { return p[0]; }).join('').toUpperCase() || 'S';
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
    const popup = $id('chatassist-msg-popup');
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
    var isOpen = isWidgetOpen();

    if (isOpen) {
      // Widget is open: play sound immediately (visitor may be in another tab)
      // No popup/badge — the message already appears in the chat thread
      playNotificationSound('opened');
      return;
    }

    // Widget collapsed.
    bumpUnread();

    if (_liveDotActive) {
      // A real signal (agent_typing / chatbot_pending) already showed the dot —
      // just enforce a minimum visible time so it doesn't flicker on a
      // near-instant reply, instead of re-running the fake delay below.
      var remaining = Math.max(0, LIVE_DOT_MIN_MS - (Date.now() - _liveDotShownAt));
      dotsPreviewTimer = setTimeout(function () {
        hideDotsPreview();
        playNotificationSound('collapsed');
        showMessagePopup(senderName, avatarUrl, messageText);
      }, remaining);
      return;
    }

    // Fallback: no live signal preceded this message (dropped event, race) —
    // fake the dots exactly as before.
    showDotsPreview();
    dotsPreviewTimer = setTimeout(function () {
      hideDotsPreview();
      playNotificationSound('collapsed');
      showMessagePopup(senderName, avatarUrl, messageText);
    }, 1200);
  }

  function _isContactOverlayVisible() {
    const el = $id('chatassist-contact-overlay');
    return !!(el && el.classList.contains('chatassist-contact-overlay-visible'));
  }

  // True only while: a real thread is open, no agent has joined yet, the
  // conversation isn't a bot-only/terminal informational path (input locked),
  // the visitor hasn't ended the chat, and we're not showing the offline
  // contact form (no real-time agent is coming in that case either).
  function _shouldShowWaitingForAgent() {
    return viewMode === 'thread'
      && !isReadOnlyThread
      && _visitorHasEngaged
      && !_agentJoinedThisConv
      && !_conversationBotOnly
      && !_isInputLocked()
      && !endChatDisabled
      && !_forceContactOverlay
      && !_isContactOverlayVisible();
  }

  function _updateWaitingForAgentIndicator() {
    const el = $id('chatassist-typing');
    if (!el) return;
    // Never override a live "Agent is typing" — that always wins.
    if (el.dataset.mode === 'typing') return;

    if (!_shouldShowWaitingForAgent()) {
      if (_waitingRotateTimer) {
        clearInterval(_waitingRotateTimer);
        _waitingRotateTimer = null;
      }
      if (el.dataset.mode === 'waiting') {
        el.style.display = 'none';
        el.dataset.mode = '';
      }
      return;
    }

    if (el.dataset.mode === 'waiting') return; // already rotating

    const label = el.querySelector('.chatassist-typing-label');
    if (!label) return;
    el.dataset.mode = 'waiting';
    el.style.display = 'flex';
    let i = 0;
    label.textContent = WAITING_FOR_AGENT_MESSAGES[i];
    if (_waitingRotateTimer) clearInterval(_waitingRotateTimer);
    _waitingRotateTimer = setInterval(function () {
      i = (i + 1) % WAITING_FOR_AGENT_MESSAGES.length;
      label.textContent = WAITING_FOR_AGENT_MESSAGES[i];
    }, 3500);
  }

  function setAgentTyping(isTyping, name) {
    const el = $id('chatassist-typing');
    if (!el) return;
    if (isTyping) {
      if (_waitingRotateTimer) {
        clearInterval(_waitingRotateTimer);
        _waitingRotateTimer = null;
      }
      const label = el.querySelector('.chatassist-typing-label');
      if (label) label.textContent = 'Agent is typing';
      el.dataset.mode = 'typing';
      el.style.display = 'flex';
    } else {
      el.style.display = 'none';
      el.dataset.mode = '';
      _updateWaitingForAgentIndicator();
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
  let pendingRatingValue = null;

  function _ratedStorageKey() {
    if (!CONFIG.websiteId || !CONFIG.conversationId) return null;
    return `aichatassist_rated_${CONFIG.websiteId}_${CONFIG.conversationId}`;
  }

  function showRatingOverlay(conversationId) {
    if (hasRatedSession) return;
    try {
      const key = _ratedStorageKey();
      if (key && localStorage.getItem(key) === '1') { hasRatedSession = true; return; }
    } catch (e) { }

    const el = $id('chatassist-rating-overlay');
    if (!el) return;
    // If already visible, just update the conversationId without resetting the UI.
    if (el.classList.contains('chatassist-rating-overlay-visible')) {
      if (conversationId) ratingConversationId = conversationId;
      return;
    }
    ratingConversationId = conversationId || ratingConversationId || null;
    pendingRatingValue = null;
    // Reset state
    const thanks = $id('chatassist-rating-thanks');
    if (thanks) thanks.style.display = 'none';
    const emojis = el.querySelector('.chatassist-rating-emojis');
    if (emojis) emojis.style.display = 'flex';
    el.querySelectorAll('.chatassist-rating-btn').forEach(b => b.classList.remove('selected'));
    const fbSection = $id('chatassist-rating-feedback-section');
    if (fbSection) fbSection.style.display = 'none';
    const fbInput = $id('chatassist-rating-feedback');
    if (fbInput) fbInput.value = '';
    el.style.display = 'flex';
    el.classList.add('chatassist-rating-overlay-visible');
  }

  function hideRatingOverlay() {
    const el = $id('chatassist-rating-overlay');
    if (el) {
      el.classList.remove('chatassist-rating-overlay-visible');
      el.style.display = 'none';
    }
    clearTimeout(_resolveRatingTimeout);
    _awaitingRatingAfterResolve = false;
    if (ratingTriggeredByVisitorEnd || ratingTriggeredByAgentResolve) {
      // Visitor ended or agent resolved — transition to closed/list view then
      // minimize the widget so the visitor isn't forced into a new chat.
      ratingTriggeredByVisitorEnd = false;
      ratingTriggeredByAgentResolve = false;
      afterConversationClose();
      if (_closeWidgetFn) setTimeout(function () { _closeWidgetFn(false); }, 200);
    } else if (viewMode === 'thread' && !isReadOnlyThread) {
      afterConversationClose();
    }
  }

  function submitRating(ratingValue, feedback) {
    hasRatedSession = true;
    try {
      const key = _ratedStorageKey();
      if (key) localStorage.setItem(key, '1');
    } catch (e) { }

    const feedbackText = (feedback || '').trim() || null;

    // WS rejects submit_rating for RESOLVED conversations (server returns error, never saves).
    // Use WS only for live OPEN conversations; always use HTTP for read-only threads.
    const canUseWs = ws && ws.readyState === WebSocket.OPEN && !isReadOnlyThread;
    if (canUseWs) {
      try {
        ws.send(JSON.stringify({
          type: 'submit_rating',
          rating: ratingValue,
          feedback: feedbackText,
          conversation_id: ratingConversationId,
        }));
      } catch (e) { }
    } else {
      try {
        fetch((CONFIG.apiUrl || '') + '/ratings/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversation_id: ratingConversationId,
            rating: ratingValue,
            feedback: feedbackText,
            session_id: CONFIG.sessionId,
          }),
        }).catch(() => { });
      } catch (e) { }
    }

    // Show thank you & auto-close
    const thanks = $id('chatassist-rating-thanks');
    const emojis = $qs('.chatassist-rating-emojis');
    const fbSection = $id('chatassist-rating-feedback-section');
    if (thanks) thanks.style.display = 'block';
    if (emojis) emojis.style.display = 'none';
    if (fbSection) fbSection.style.display = 'none';
    setTimeout(() => hideRatingOverlay(), 1500);
  }

  // --- Audio ---

  function enableNotificationSound() {
    soundEnabled = true;
  }

  function playNotificationSound(mode) {
    if (!soundEnabled) return;
    var fileName = mode === 'opened'
      ? (CONFIG.notificationSoundOpened || '')
      : (CONFIG.notificationSoundCollapsed || '');
    if (!fileName) return;
    try {
      var baseUrl = (CONFIG.apiUrl || '').replace(/\/$/, '');
      var a = new Audio(baseUrl + '/sounds/' + fileName);
      a.volume = 1.0;
      a.play().catch(function () { });
    } catch (e) { }
  }

  function armSoundOnFirstGesture() {
    try {
      const _arm = () => enableNotificationSound();
      document.addEventListener('pointerdown', _arm, { once: true, passive: true });
      document.addEventListener('keydown', _arm, { once: true });
      document.addEventListener('touchstart', _arm, { once: true, passive: true });
      document.addEventListener('scroll', _arm, { once: true, passive: true });
      document.addEventListener('mousemove', _arm, { once: true, passive: true });
    } catch (e) { }
  }

  function showInputContainer() {
    clearTimeout(_inputRevealTimer);
    _inputRevealTimer = null;
    const inputCont = $id('chatassist-input-container');
    if (inputCont) inputCont.style.display = '';
    // Remeasure after reveal: scrollHeight was 0 while container was display:none,
    // which left the textarea at height:0px. A deferred call gets the correct value.
    setTimeout(function () { autoResizeInput(); }, 0);
  }

  // --- API & State Management ---

  async function fetchReadState() {
    // Save the conversation ID set by enterThreadView so the read-state
    // response cannot accidentally override it with a different conversation.
    const targetConvId = CONFIG.conversationId;
    try {
      const qs = `website_id=${CONFIG.websiteId}&session_id=${CONFIG.sessionId}` +
        (targetConvId ? `&conversation_id=${targetConvId}` : '');
      const response = await fetch(`${CONFIG.apiUrl}/widget/read-state?${qs}`);
      if (response.ok) {
        const data = await response.json();
        // Only update conversationId if we didn't already have one (start-view mode).
        if (!targetConvId && typeof data.conversation_id === 'number') {
          CONFIG.conversationId = data.conversation_id || 0;
        }
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
      const qs = `website_id=${CONFIG.websiteId}&session_id=${CONFIG.sessionId}` +
        (CONFIG.conversationId ? `&conversation_id=${CONFIG.conversationId}` : '');
      const response = await fetch(`${CONFIG.apiUrl}/widget/read?${qs}`, {
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

  // --- Draft Preservation (keyed by conversation_id) ---

  function _draftKey() {
    if (!CONFIG.websiteId || !CONFIG.conversationId) return null;
    return `ai_chatassist_draft_${CONFIG.websiteId}_${CONFIG.conversationId}`;
  }

  function _attachmentDraftKey() {
    if (!CONFIG.websiteId || !CONFIG.conversationId) return null;
    return `ai_chatassist_attachment_draft_${CONFIG.websiteId}_${CONFIG.conversationId}`;
  }

  function saveDraft(text) {
    try {
      const key = _draftKey();
      if (!key) return;
      if (text) localStorage.setItem(key, text);
      else localStorage.removeItem(key);
    } catch (e) { }
  }

  function loadDraft() {
    try {
      const key = _draftKey();
      return key ? (localStorage.getItem(key) || '') : '';
    } catch (e) { return ''; }
  }

  function saveDraftAttachments(attachments) {
    try {
      const key = _attachmentDraftKey();
      if (!key) return;
      if (Array.isArray(attachments) && attachments.length) {
        localStorage.setItem(key, JSON.stringify(attachments));
      } else {
        localStorage.removeItem(key);
      }
    } catch (e) { }
  }

  function loadDraftAttachments() {
    try {
      const key = _attachmentDraftKey();
      if (!key) return [];
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }

  // --- Conversation List API ---

  async function fetchConversationList() {
    try {
      const res = await fetch(
        `${CONFIG.apiUrl}/widget/conversations?website_id=${CONFIG.websiteId}&session_id=${CONFIG.sessionId}`
      );
      if (res.ok) return await res.json();
    } catch (e) {
      console.error('[ChatWidget] Failed to fetch conversation list:', e);
    }
    return { active: null, history: [], total: 0, show_conversation_history: false };
  }

  // CC1: fetch the website's contact-card form, if one is configured. Best
  // effort — a failure just means neither the live-chat card nor the offline
  // gate's extra fields are available this session, same as if none exists.
  async function _loadContactCardForm() {
    try {
      const res = await fetch(`${CONFIG.apiUrl}/websites/${CONFIG.websiteId}/forms/contact-card`);
      if (res.ok) {
        const data = await res.json();
        _contactCardForm = data || null;
      }
    } catch (e) {
      _contactCardForm = null;
    }
  }

  // The 3 hardcoded offline-gate inputs (name/phone/email) are a separate
  // markup path from the contact-card form's own fields, but a website's
  // form can still define a field literally named "name"/"phone"/"email" —
  // in that case its `required` flag should govern the matching hardcoded
  // input instead of being silently discarded (that field is excluded from
  // the extra-fields list precisely because it's assumed to *be* the
  // hardcoded one). Falls back to the historical defaults — name and phone
  // required, email optional — when no contact-card form is configured, or
  // it doesn't define that particular field.
  function _hardcodedFieldRequired(fieldName, defaultRequired) {
    const fields = (_contactCardForm && _contactCardForm.fields) || [];
    const match = fields.filter(function (f) { return f && f.name === fieldName; })[0];
    return match ? !!match.required : defaultRequired;
  }

  // Re-applies required-ness (data-required attribute + placeholder text,
  // consulted by submitContactAndSendPending's validation) to the 3
  // hardcoded fields from the freshly-fetched _contactCardForm. Safe to call
  // repeatedly — unlike enhancePhoneField, this never rebuilds the country
  // picker, only updates its placeholder if it's already been built.
  function _applyHardcodedFieldRequiredness() {
    const nameEl = $id('chatassist-contact-name');
    const phoneEl = $id('chatassist-contact-phone');
    const emailEl = $id('chatassist-contact-email');

    const nameRequired = _hardcodedFieldRequired('name', true);
    const phoneRequired = _hardcodedFieldRequired('phone', true);
    const emailRequired = _hardcodedFieldRequired('email', false);

    if (nameEl) {
      nameEl.setAttribute('data-required', nameRequired ? '1' : '0');
      nameEl.placeholder = 'Your name' + (nameRequired ? ' *' : ' (optional)');
    }
    if (emailEl) {
      emailEl.setAttribute('data-required', emailRequired ? '1' : '0');
      emailEl.placeholder = 'Your email' + (emailRequired ? ' *' : ' (optional)');
    }
    if (phoneEl) {
      phoneEl.setAttribute('data-required', phoneRequired ? '1' : '0');
      const select = phoneEl.__phoneCountrySelect;
      const lp = window.libphonenumber;
      if (select && lp) {
        _applyPhonePlaceholder(lp, phoneEl, select.value, phoneRequired);
      } else {
        phoneEl.placeholder = 'Your phone number' + (phoneRequired ? ' *' : ' (optional)');
      }
    }
  }

  // --- View Management ---

  function _closeWsCleanly() {
    if (ws) {
      ws.onclose = null;
      try { ws.close(); } catch (e) { }
      ws = null;
    }
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    isConnecting = false;
  }

  function _updateHeaderButtons() {
    const backBtn = $id('chatassist-back');
    const endBtn = $id('chatassist-end');
    if (backBtn) {
      // Show back button only when history is enabled (there is a list to go back to).
      // When history is disabled and we are in read-only (closed) mode, the back
      // button leads nowhere — hide it.
      const showBack = viewMode === 'thread' && widgetShowHistory;
      backBtn.style.display = showBack ? '' : 'none';
    }
    if (endBtn) {
      // Show end button only in active (non-readonly) thread, only once the
      // visitor has actually engaged (sent a message or committed a leaf
      // button) — same signal _shouldShowWaitingForAgent() already uses to
      // distinguish "a real conversation is happening" from "buttons just
      // rendered, nothing clicked yet". Without this a fresh, untouched chat
      // offers "End chat", and confirming it fires the same rating-popup
      // flow as a chat that actually had support in it.
      const showEnd = viewMode === 'thread' && !isReadOnlyThread && _visitorHasEngaged && !endChatDisabled && CONFIG.showEndChatButton;
      endBtn.style.display = showEnd ? '' : 'none';
    }
  }

  function _safeText(str) {
    // Safe text for DOM insertion; used in renderConvList
    return String(str || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderConvList(listData) {
    const body = $id('chatassist-conv-list-body');
    if (!body) return;
    body.innerHTML = '';

    const history = (listData && listData.history) || [];
    const active = listData && listData.active;
    const activeIsEnded = active && Boolean(active.visitor_ended);

    // "New Conversation" button — show when no active conv, or when active is ended.
    if (!active || activeIsEnded) {
      const newBtn = document.createElement('button');
      newBtn.className = 'chatassist-conv-new-btn';
      newBtn.type = 'button';
      newBtn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>' +
        '<span>New Conversation</span>';
      newBtn.addEventListener('click', startNewConversation);
      body.appendChild(newBtn);
    }

    // Non-ended active conversation: pin at top with "Active" badge.
    if (active && !activeIsEnded) {
      const conv = active;
      const activeItem = document.createElement('div');
      activeItem.className = 'chatassist-conv-item';
      activeItem.setAttribute('role', 'button');
      activeItem.setAttribute('tabindex', '0');

      const aTitleText = conv.title || conv.last_message_preview || ('Conversation ' + (conv.short_id || ('#' + conv.id)));
      const aDateText = conv.last_message_at
        ? new Date(conv.last_message_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        : (conv.created_at ? new Date(conv.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');

      const aTitleEl = document.createElement('div');
      aTitleEl.className = 'chatassist-conv-item-title';
      aTitleEl.textContent = aTitleText;

      const aMetaEl = document.createElement('div');
      aMetaEl.className = 'chatassist-conv-item-meta';

      const aDateEl = document.createElement('span');
      aDateEl.className = 'chatassist-conv-item-date';
      aDateEl.textContent = aDateText;

      const aBadgeEl = document.createElement('span');
      aBadgeEl.className = 'chatassist-conv-item-badge chatassist-conv-item-badge-active';
      aBadgeEl.textContent = 'Active';

      aMetaEl.appendChild(aDateEl);
      aMetaEl.appendChild(aBadgeEl);
      activeItem.appendChild(aTitleEl);
      activeItem.appendChild(aMetaEl);

      const resumeFn = function () { enterThreadView(conv.id, false); };
      activeItem.addEventListener('click', resumeFn);
      activeItem.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); resumeFn(); }
      });
      body.appendChild(activeItem);
    }

    // Past conversations: merge ended-active (if any) with history, sorted newest first.
    // This ensures a stale OPEN+visitor_ended conv never appears above a newer resolved one.
    const pastConvs = [];
    if (activeIsEnded) {
      pastConvs.push({ id: active.id, conv: active, badgeText: 'Ended', badgeClass: 'chatassist-conv-item-badge-ended' });
    }
    history.forEach(function (conv) {
      pastConvs.push({ id: conv.id, conv: conv, badgeText: 'Resolved', badgeClass: '' });
    });
    pastConvs.sort(function (a, b) { return b.id - a.id; });

    if (!pastConvs.length) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'chatassist-conv-list-empty';
      emptyEl.textContent = 'No past conversations';
      body.appendChild(emptyEl);
      return;
    }

    pastConvs.forEach(function (entry) {
      const conv = entry.conv;
      const item = document.createElement('div');
      item.className = 'chatassist-conv-item';
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');

      const titleText = conv.title || conv.last_message_preview || ('Conversation ' + (conv.short_id || ('#' + conv.id)));
      const dateText = conv.last_message_at
        ? new Date(conv.last_message_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        : (conv.created_at ? new Date(conv.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');

      const titleEl = document.createElement('div');
      titleEl.className = 'chatassist-conv-item-title';
      titleEl.textContent = titleText;

      const metaEl = document.createElement('div');
      metaEl.className = 'chatassist-conv-item-meta';

      const dateEl = document.createElement('span');
      dateEl.className = 'chatassist-conv-item-date';
      dateEl.textContent = dateText;

      const badgeEl = document.createElement('span');
      badgeEl.className = 'chatassist-conv-item-badge' + (entry.badgeClass ? (' ' + entry.badgeClass) : '');
      badgeEl.textContent = entry.badgeText;

      metaEl.appendChild(dateEl);
      metaEl.appendChild(badgeEl);
      item.appendChild(titleEl);
      item.appendChild(metaEl);

      const openFn = function () {
        enterThreadView(conv.id, true);
        if (_shouldShowRatingPrompt(conv)) {
          setTimeout(function () { showRatingOverlay(conv.id); }, 800);
        }
      };
      item.addEventListener('click', openFn);
      item.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFn(); }
      });
      body.appendChild(item);
    });
  }

  function enterListView(listData) {
    viewMode = 'list';
    isReadOnlyThread = false;

    _closeWsCleanly();

    const el_messages = $id('chatassist-messages');
    const el_empty = $id('chatassist-empty-state');
    const el_list = $id('chatassist-conv-list');
    const el_footer = $id('chatassist-footer');
    const el_newMsg = $id('chatassist-new-msg-indicator');

    if (el_messages) el_messages.style.display = 'none';
    if (el_empty) el_empty.style.display = 'none';
    if (el_footer) el_footer.style.display = 'none';
    if (el_newMsg) el_newMsg.style.display = 'none';
    if (el_list) el_list.style.display = 'flex';

    _updateHeaderButtons();
    renderConvList(listData);
    // Restore open/closed state from localStorage (no WS messages in list view to trigger this).
    _restoreWidgetState();
  }

  function enterStartView() {
    viewMode = 'start';
    isReadOnlyThread = false;
    ratingTriggeredByVisitorEnd = false;
    ratingTriggeredByAgentResolve = false;
    _awaitingRatingAfterResolve = false;
    clearTimeout(_resolveRatingTimeout);
    _resolveRatingTimeout = null;
    // Reset per-conversation rating state so the overlay can show for a new conversation.
    hasRatedSession = false;
    ratingConversationId = null;
    CONFIG.conversationId = 0;
    _conversationBotOnly = false;
    _contactVerifiedThisConversation = false;
    _leafButtonCommitted = false;
    pendingBotButtonClick = null;
    // Clear the welcome-popup dismissed key so the popup can appear fresh for
    // the new conversation (it was suppressed for the just-closed conversation).
    try {
      const _wpk = _welcomePopupDismissedKey();
      if (_wpk) localStorage.removeItem(_wpk);
    } catch (e) { }

    // Ensure any existing WS is closed before connecting fresh
    _closeWsCleanly();

    const el_messages = $id('chatassist-messages');
    const el_empty = $id('chatassist-empty-state');
    const el_list = $id('chatassist-conv-list');
    const el_footer = $id('chatassist-footer');

    if (el_list) el_list.style.display = 'none';
    if (el_messages) el_messages.style.display = '';
    if (el_empty) el_empty.style.display = '';
    if (el_footer) el_footer.style.display = '';

    // Clear any old messages
    if (el_messages) { el_messages.innerHTML = ''; lastAppendedDateStr = null; }
    historyQueue = null;
    isReadStateFetched = true; // no queue guard needed in start mode
    draftAttachments = [];
    renderAttachmentChips();

    // Clear input (may retain stale text if coming from a just-closed thread)
    const el_input = $id('chatassist-input');
    if (el_input) { el_input.value = ''; autoResizeInput(); }

    _updateHeaderButtons();

    // Connect with conv_id=0 so the bot can send welcome / automations fire
    connectWebSocket();
    // Restore open/closed widget state for page-reload scenarios.
    // (When a bot_prompt arrives it will call this too, but if there's no automation
    //  configured, this explicit call ensures the widget reopens if it was left open.)
    _restoreWidgetState();
  }

  async function enterThreadView(convId, readOnly) {
    viewMode = 'thread';
    isReadOnlyThread = Boolean(readOnly);
    CONFIG.conversationId = convId || 0;

    // Reset message area
    const el_messages = $id('chatassist-messages');
    const el_empty = $id('chatassist-empty-state');
    const el_list = $id('chatassist-conv-list');
    const el_footer = $id('chatassist-footer');
    const el_newMsg = $id('chatassist-new-msg-indicator');

    if (el_list) el_list.style.display = 'none';
    if (el_messages) { el_messages.style.display = ''; el_messages.innerHTML = ''; }
    if (el_empty) el_empty.style.display = '';
    if (el_newMsg) el_newMsg.style.display = 'none';

    lastAppendedDateStr = null;
    historyQueue = null;
    isReadStateFetched = false;
    hasScrolledToUnread = false;
    firstUnreadMessageId = null;
    setUnreadCount(0);

    if (isReadOnlyThread) {
      if (el_footer) el_footer.style.display = 'none';
      draftAttachments = [];
      renderAttachmentChips();
    } else {
      if (el_footer) el_footer.style.display = '';
      // Restore draft for this conversation
      const input = $id('chatassist-input');
      draftAttachments = loadDraftAttachments();
      renderAttachmentChips();
      if (input) { input.value = loadDraft(); autoResizeInput(); }
    }

    _updateHeaderButtons();

    // Disconnect current WS before starting new one
    _closeWsCleanly();

    if (!isReadOnlyThread) {
      await fetchReadState();
    } else {
      isReadStateFetched = true;
    }

    connectWebSocket();
  }

  function goBack() {
    // Persist draft before leaving
    const input = $id('chatassist-input');
    if (input && !isReadOnlyThread) saveDraft(input.value);
    if (!isReadOnlyThread) saveDraftAttachments(draftAttachments);

    _closeWsCleanly();

    if (widgetShowHistory) {
      fetchConversationList().then(function (listData) {
        convListHistory = (listData && listData.history) || [];
        enterListView(listData);
      });
    } else {
      enterStartView();
    }
  }

  async function startNewConversation() {
    // enterStartView() handles _closeWsCleanly() internally now.
    enterStartView();
  }

  // Returns true if the rating popup should be shown for a resolved conversation object
  // from the conversation list API (contains id, status, closed_by, is_rated).
  function _shouldShowRatingPrompt(conv) {
    if (!conv) return false;
    if (conv.status !== 'resolved') return false;   // OPEN or visitor_ended-OPEN: no prompt
    if (conv.closed_by === 'bot') return false;      // bot-only flow: no agent to rate
    if (conv.is_rated) return false;                 // already rated in DB
    return true;
  }

  function openHistoryThread(convId) {
    enterThreadView(convId, true);
    // Show rating prompt if this past conversation hasn't been rated yet.
    // convListHistory holds the resolved history objects returned by the last
    // fetchConversationList call — each contains is_rated and closed_by.
    var conv = convListHistory && convListHistory.find(function (c) { return c.id === convId; });
    if (_shouldShowRatingPrompt(conv)) {
      setTimeout(function () { showRatingOverlay(conv.id); }, 800);
    }
  }

  function _appendClosedBanner() {
    // Remove any existing banner first (idempotent).
    const existing = $id('chatassist-closed-banner');
    if (existing) existing.remove();

    const el_messages = $id('chatassist-messages');
    if (!el_messages) return;

    const banner = document.createElement('div');
    banner.id = 'chatassist-closed-banner';
    banner.style.cssText = [
      'display:flex', 'flex-direction:column', 'align-items:center',
      'gap:12px', 'padding:20px 16px 8px', 'text-align:center',
    ].join(';');

    const label = document.createElement('p');
    label.style.cssText = 'margin:0;font-size:13px;color:#9ca3af;';
    label.textContent = 'This conversation has ended.';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Start new chat';
    btn.style.cssText = [
      'padding:9px 22px', 'border-radius:9999px', 'border:none',
      'font-size:14px', 'font-weight:600', 'cursor:pointer',
      'color:#fff', 'background:' + (
        CONFIG.colorMode === 'gradient'
          ? 'linear-gradient(135deg,' + CONFIG.gradientStart + ' 0%,' + CONFIG.gradientEnd + ' 100%)'
          : CONFIG.primaryColor
      ),
    ].join(';');
    btn.addEventListener('click', function () {
      _clearClosedState();
      banner.remove();
      enterStartView();
    });

    banner.appendChild(label);
    banner.appendChild(btn);
    el_messages.appendChild(banner);

    try { banner.scrollIntoView({ behavior: 'smooth', block: 'end' }); } catch (e) { }
  }

  function enterClosedView(convId) {
    // Show the current messages as read-only with a "Start new chat" prompt.
    // Does NOT reconnect the WebSocket — prevents the welcome automation from
    // firing again when the conversation history feature is disabled.
    viewMode = 'thread';
    isReadOnlyThread = true;
    _closeWsCleanly();

    // Persist so the closed view survives a page reload.
    if (convId) _saveClosedState(convId);

    const el_footer = $id('chatassist-footer');
    if (el_footer) el_footer.style.display = 'none';
    _updateHeaderButtons();

    _appendClosedBanner();
  }

  function afterConversationClose() {
    const closedConvId = CONFIG.conversationId;
    CONFIG.conversationId = 0;
    if (widgetShowHistory) {
      fetchConversationList().then(function (listData) {
        if (listData && (listData.history.length > 0 || listData.active)) {
          enterListView(listData);
        } else {
          enterStartView();
        }
      }).catch(function () { enterStartView(); });
    } else {
      // History disabled: show a closed state instead of auto-reconnecting.
      // Auto-reconnecting would re-trigger the welcome automation immediately.
      enterClosedView(closedConvId);
    }
  }

  // --- WebSocket Communication ---

  function connectWebSocket() {
    if (isConnecting || (ws && ws.readyState === WebSocket.OPEN)) return;
    isConnecting = true;
    const wsEndpoint = (CONFIG.conversationId && CONFIG.conversationId > 0)
      ? `${CONFIG.wsUrl}/ws/chat/${CONFIG.websiteId}/${CONFIG.sessionId}/${CONFIG.conversationId}`
      : `${CONFIG.wsUrl}/ws/chat/${CONFIG.websiteId}/${CONFIG.sessionId}`;

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
        // Heartbeat: send ping every 15s so the server knows the visitor is still on the page.
        // Keeps the 45-second visitor_dropped debounce from firing on slow pages.
        if (_pingInterval) clearInterval(_pingInterval);
        _pingInterval = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            try { ws.send(JSON.stringify({ type: 'ping' })); } catch (_) {}
          }
        }, 15000);
        // Start the input reveal timer. If no chatbot_pending / bot_prompt
        // arrives within 2500ms the input area is revealed (no chatbot active).
        // Run even when offline: if an offline automation is configured it sends
        // chatbot_pending quickly (~200ms) which cancels this timer and manages
        // the flow itself. Without automation the timer fires and reveals the
        // input so the visitor can type, which triggers the contact overlay on send.
        clearTimeout(_inputRevealTimer);
        // Don't auto-reveal input for read-only (ended/resolved) threads.
        if (!isReadOnlyThread) {
          _inputRevealTimer = setTimeout(showInputContainer, 2500);
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
        if (_pingInterval) { clearInterval(_pingInterval); _pingInterval = null; }
        if (_pageUnloading) return; // page is navigating/reloading — expected, not a real drop
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
      if (meta.visitor_phone) payload.visitor_phone = meta.visitor_phone;
    }
    ws.send(JSON.stringify(payload));
    _visitorHasEngaged = true;

    // Visitor has resumed the conversation; allow ending again.
    if (endChatDisabled) {
      setEndChatDisabled(false);
    }
    _updateWaitingForAgentIndicator();
    _updateHeaderButtons();
    return true;
  }

  function handleIncomingMessage(data) {
    if (data.type === 'history' && Array.isArray(data.messages)) {
      // Capture regardless of the isReadStateFetched queue detour below —
      // bot_only drives the waiting-for-agent indicator, no reason to defer it.
      if (data.bot_only) _conversationBotOnly = true;

      if (!isReadStateFetched) {
        historyQueue = data;
        return;
      }

      // ── 24-hour expiry for resolved conversations ──────────────────────────
      // If the session's last resolved conv is older than 24h, discard history
      // and start a fresh session so the welcome automation fires again.
      if (data.status === 'resolved') {
        const resolvedAt = data.resolved_at || null;
        if (resolvedAt) {
          _saveResolvedAt(resolvedAt);
        }
        if (_isResolvedConvExpired()) {
          // Clear stored conversation so widget reconnects cleanly.
          _clearResolvedAt();
          _clearClosedState();
          CONFIG.conversationId = 0;
          _closeWsCleanly();
          enterStartView();
          return;
        }
        // Not expired: fall through and show read-only thread.
        isReadOnlyThread = true;
      } else {
        // Active conversation — clear any stale resolved_at for this session.
        _clearResolvedAt();
      }
      // ─────────────────────────────────────────────────────────────────────
      const container = $id('chatassist-messages');
      if (!container) return;
      container.innerHTML = '';
      lastAppendedDateStr = null;
      container.classList.add('chatassist-no-animate');
      var hasPendingBotPrompt = false;
      // Re-derive from this conversation's actual history each time rather than
      // carrying over state from a previous conversation in the same page session.
      _agentJoinedThisConv = false;
      _visitorHasEngaged = false;
      _pendingContactCards = {};
      _conversationBotOnly = Boolean(data.bot_only);
      data.messages.forEach(m => {
        const senderType = m.sender_type || m.sender || 'system';
        const actor = m.actor || senderType;
        const kind = m.kind || (actor === 'system' ? 'event' : 'chat');
        const eventType = m.event_type || null;

        // Internal timeline events: don't show to the visitor.
        if (actor === 'system' && kind === 'event' && (eventType === 'visitor_connected' || eventType === 'visitor_socket_connected' || eventType === 'visitor_left_website')) {
          return;
        }
        // Internal automation placeholder stored by show_rating_popup node — never render as text.
        if (eventType === 'rating_popup_shown') return;

        if (actor === 'visitor') {
          _visitorHasEngaged = true;
          appendMessage('visitor', m.content, m.created_at, null, m.id);
        } else if (eventType === 'contact_card') {
          // CC1: agent-triggered — sender_type is 'agent', so this must be
          // checked before the plain actor==='agent' branch below or it'd
          // render as a text bubble instead of the interactive card.
          _agentJoinedThisConv = true;
          var ccRawSource = m.raw_content || m.content;
          var ccData = null;
          try { ccData = JSON.parse(ccRawSource); } catch (e) { /* plain text fallback */ }
          var ccDisplayText = (ccData && ccData.message) ? ccData.message : m.content;
          var ccFields = (ccData && Array.isArray(ccData.fields)) ? ccData.fields : [];
          var ccFormId = ccData && ccData.form_id;
          var ccSubmitLabel = ccData && ccData.submit_label;
          if (m.sender_avatar_url) updateAgentAvatar(m.sender_avatar_url);
          if (m.sender_name) updateAgentName(m.sender_name);
          appendContactCard(ccDisplayText, m.created_at, ccFormId, ccFields, ccSubmitLabel, m.id, m.contact_card_state, { avatarUrl: m.sender_avatar_url, name: m.sender_name });
        } else if (actor === 'agent') {
          _agentJoinedThisConv = true;
          if (m.sender_avatar_url) updateAgentAvatar(m.sender_avatar_url);
          if (m.sender_name) updateAgentName(m.sender_name);
          appendMessage('agent', m.content, m.created_at, { avatarUrl: m.sender_avatar_url, name: m.sender_name }, m.id);
        } else if (eventType === 'bot_prompt_buttons') {
          // Parse enriched JSON content for buttons data.
          // Prefer raw_content (full enriched JSON) over content (display text only).
          var rawSource = m.raw_content || m.content;
          var promptData = null;
          try { promptData = JSON.parse(rawSource); } catch (e) { /* plain text fallback */ }
          var displayText = (promptData && promptData.message) ? promptData.message : m.content;
          var pButtons = (promptData && Array.isArray(promptData.buttons)) ? promptData.buttons : [];
          var pAutoId = promptData && promptData.automation_id;
          var pAllowInput = Boolean(promptData && promptData.allow_input);
          var pButtonPathPrefix = (promptData && Array.isArray(promptData.button_path_prefix)) ? promptData.button_path_prefix : [];

          // Check if visitor has already responded (any visitor message after this one).
          var currentIdx = data.messages.indexOf(m);
          var hasResponse = data.messages.slice(currentIdx + 1).some(function (s) {
            return (s.sender_type || s.sender) === 'visitor';
          });

          // A resolved/ended conversation is read-only — never resume a pending
          // prompt as clickable buttons, even if the visitor never answered it.
          if (!hasResponse && pButtons.length > 0 && !isReadOnlyThread) {
            // Pending prompt: show interactive buttons + hide input.
            appendBotPromptWithButtons(displayText, m.created_at, pButtons, pAutoId, m.id, pAllowInput, pButtonPathPrefix);
            hasPendingBotPrompt = true;
          } else {
            // Already responded: show as plain text.
            appendMessage('ai', displayText, m.created_at, null, m.id);
          }
        } else if (actor === 'bot' || (actor === 'system' && kind === 'chat') || (senderType === 'system' && (eventType === 'bot' || (eventType && eventType.startsWith('automation'))))) {
          appendMessage('ai', m.content, m.created_at, null, m.id);
        } else if (actor === 'system') {
          if (eventType === 'agent_join') {
            _agentJoinedThisConv = true;
            showJoinMessage(m.content, m.created_at);
            _clearInputLocked(); // Agent joined after suppress_waiting — unlock input
          } else if (eventType === 'visitor_left') showSystemMessage('You ended the chat.');
          else if (eventType === 'visitor_ended') showSystemMessage('You ended the chat.');
          else if (eventType === 'conversation_resolved' && m.closed_by === 'visitor') showSystemMessage('You have ended the chat.');
          else showSystemMessage(m.content);
        } else {
          appendMessage('ai', m.content, m.created_at, null, m.id);
        }
      });
      container.classList.remove('chatassist-no-animate');
      updateEmptyState();
      isAtBottom = true;
      smartScroll();
      // _visitorHasEngaged may have just flipped true while replaying history
      // (a returning visitor who already sent a message) — refresh the End
      // chat button so it isn't stuck hidden for the rest of this session.
      _updateHeaderButtons();

      // Restore widget open/minimized state from localStorage.
      // If there are history messages, restore immediately.
      // If empty (new session), we'll restore when the welcome/bot_prompt arrives.
      if (data.messages.length > 0) {
        _restoreWidgetState();
        // Reveal input unless a bot_prompt is still pending, the thread is
        // read-only, or the input was locked by automation_complete(allow_input=false).
        if (!hasPendingBotPrompt && !isReadOnlyThread) {
          if (!_isInputLocked()) {
            showInputContainer();
          } else {
            // Locked by suppress_waiting path — cancel reveal timer too.
            clearTimeout(_inputRevealTimer);
            _inputRevealTimer = null;
          }
        } else {
          // Cancel the connect-time reveal timer so it doesn't override the
          // hidden input state after a page reload with a pending button prompt.
          clearTimeout(_inputRevealTimer);
          _inputRevealTimer = null;
        }
      }
      // If 0 history messages (brand-new session): keep the _inputRevealTimer
      // running. The chatbot_pending signal (if any) will cancel it; otherwise
      // it fires after 2500ms and shows the input.

      _updateWaitingForAgentIndicator();

      // Re-inject the "Start new chat" banner if we're restoring a closed
      // conversation on reload (history disabled). The banner was wiped above
      // by container.innerHTML = '' but belongs at the bottom of the thread.
      const hasVisitorLeftMsg = data.messages.some(function (m) { return m.event_type === 'visitor_left' || m.event_type === 'visitor_ended'; });
      if ((data.status === 'resolved' || hasVisitorLeftMsg) && isReadOnlyThread && !widgetShowHistory) {
        _appendClosedBanner();
      }

      // Welcome popup re-show on return visit.
      // Conditions: open conversation, widget is minimized, visitor has NOT sent
      // any message yet, the popup was not dismissed within the last 12h, and it
      // hasn't already auto-shown its cap for this 12h window (see
      // _hasWelcomePopupShownTooManyTimes — this is what stops the exact same
      // welcome popup reappearing on every single page navigation).
      if (data.status !== 'resolved' && !isWidgetOpen() && !_isWelcomePopupRecentlyDismissed() && !_hasWelcomePopupShownTooManyTimes()) {
        var hasVisitorMsg = data.messages.some(function (m) {
          return (m.sender_type || m.sender) === 'visitor' || m.actor === 'visitor';
        });
        if (!hasVisitorMsg) {
          // Find the first bot/ai message to show in the popup.
          var firstBotMsg = null;
          for (var _wi = 0; _wi < data.messages.length; _wi++) {
            var _wm = data.messages[_wi];
            var _wactor = _wm.actor || _wm.sender_type || _wm.sender || '';
            var _wkind = _wm.kind || (_wactor === 'system' ? 'event' : 'chat');
            if (_wactor === 'bot' || _wactor === 'ai' ||
                (_wactor === 'system' && _wkind === 'chat') ||
                (_wm.event_type === 'bot_prompt_buttons')) {
              firstBotMsg = _wm;
              break;
            }
          }
          if (firstBotMsg) {
            var _popupText = firstBotMsg.content || '';
            // For bot_prompt_buttons, extract the message field from JSON content.
            if (firstBotMsg.event_type === 'bot_prompt_buttons') {
              try {
                var _pd = JSON.parse(firstBotMsg.raw_content || firstBotMsg.content);
                if (_pd && _pd.message) _popupText = _pd.message;
              } catch (e) { }
            }
            if (_popupText) {
              // Delay so the bubble finishes its entrance animation, then run
              // the same dots → sound → popup sequence as notifyNewMessage().
              var _wpText = _popupText;
              setTimeout(function () {
                if (isWidgetOpen()) return; // visitor opened widget during delay
                _recordWelcomePopupShown();
                bumpUnread();
                showDotsPreview();
                dotsPreviewTimer = setTimeout(function () {
                  hideDotsPreview();
                  playNotificationSound('collapsed');
                  showMessagePopup(null, null, _wpText);
                }, 1200);
              }, 1500);
            }
          }
        }
      }

      return;
    }

    // Server-side notification that the conversation is resolved (sent after
    // history for closed conversations). Swallow it here so it is never
    // rendered as a plain AI message via the generic fallback below.
    if (data.type === 'resolved') {
      // Banner already appended by the history handler above; nothing to do.
      return;
    }

    // Sent ahead of every bot-authored message (reply, waiting message, next
    // IVR prompt, ...) purely to drive the "typing" bubble below — it must
    // never touch input visibility itself. Whatever arrives next already
    // settles that correctly: a bot_prompt message sets it from its own
    // allow_input, and a plain bot/ai message restores it unless genuinely
    // locked (see below). Forcing it hidden here used to fight both of
    // those — most visibly, a visitor mid-reply watching the box vanish
    // out from under them the instant any bot message was about to land.
    if (data.type === 'chatbot_pending') {
      clearTimeout(_inputRevealTimer);
      _inputRevealTimer = null;
      setAgentTyping(true);
      setLauncherTyping(true);
      return;
    }

    // Backend responds with {type:'error'} when a message arrives on a resolved
    // conversation (e.g. page-view ping on reconnect). Suppress in read-only mode.
    if (data.type === 'error' && isReadOnlyThread) {
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

      // Visitor ended the chat — echo friendly message (not stored in DB).
      if (actor === 'system' && eventType === 'visitor_left') {
        const closedAt = data.created_at || (data.message_obj && data.message_obj.created_at) || null;
        appendMessage('visitor', 'You ended the chat.', closedAt, null, null);
        return;
      }

      if (actor === 'system' && kind === 'event') {
        if (eventType === 'agent_join') showJoinMessage(data.message, createdAt);
        else if (eventType !== 'conversation_resolved') showSystemMessage(data.message);
        // conversation_resolved UI transition handled by show_rating_popup from automation (2s wait + delivery).
        // Safety timeout (7s = 2s wait + 2s delivery buffer + 3s extra) in case show_rating_popup never arrives.
        if (eventType === 'conversation_resolved') {
          if (!ratingTriggeredByVisitorEnd) {
            _awaitingRatingAfterResolve = true;
            ratingTriggeredByAgentResolve = true;
            clearTimeout(_resolveRatingTimeout);
            _resolveRatingTimeout = setTimeout(function () {
              if (_awaitingRatingAfterResolve) {
                _awaitingRatingAfterResolve = false;
                ratingTriggeredByAgentResolve = false;
                afterConversationClose();
                if (_closeWidgetFn) setTimeout(function () { _closeWidgetFn(false); }, 200);
              }
            }, 7000);
          }
        }
      } else {
        // Bot/system chat message delivered as a system frame.
        appendMessage('ai', data.message, createdAt, null, dto && dto.id);
        notifyNewMessage(null, null, data.message);
        if (isWidgetOpen() && !document.hidden && isAtBottom) markRead();
        showNewMsgIndicator();
      }
      smartScroll();
      return;
    }

    // Bot-only conversation completed: resolve silently with no rating popup or
    // "support resolved" system message. Widget clears its state and navigates
    // to the conversation list / start view exactly like afterConversationClose().
    if (data.type === 'bot_conversation_complete') {
      afterConversationClose();
      return;
    }

    // Automation-driven rating popup (decoupled from conversation_resolved/visitor_ended system event).
    if (data.type === 'show_rating_popup') {
      const convId = data.conversation_id || ratingConversationId;
      if (convId) ratingConversationId = convId;
      // Clear deferred-close flag (rating popup handles navigation).
      clearTimeout(_resolveRatingTimeout);
      _awaitingRatingAfterResolve = false;
      // Ensure hideRatingOverlay() will call afterConversationClose() even when
      // the automation sent show_rating_popup without a prior conversation_resolved
      // system event (which normally sets ratingTriggeredByAgentResolve).
      if (!ratingTriggeredByVisitorEnd && !ratingTriggeredByAgentResolve) {
        ratingTriggeredByAgentResolve = true;
      }
      // Immediately transition the input to read-only so the visitor can no
      // longer type into a resolved conversation while the overlay is visible.
      isReadOnlyThread = true;
      clearTimeout(_inputRevealTimer);
      _inputRevealTimer = null;
      const _rpInputCont = $id('chatassist-input-container');
      if (_rpInputCont) _rpInputCont.style.display = 'none';
      showRatingOverlay(ratingConversationId);
      // Collapsed visitors got no heads-up before this — the overlay was armed
      // silently and only appeared once they opened the widget. Reuse the same
      // dots -> popup notification as a regular message, just with rating copy;
      // opening from it lands straight on the overlay above (already armed).
      notifyNewMessage(null, null, 'How was your chat? Tap to leave a rating.');
      return;
    }

    // Bot prompt with interactive buttons (team routing chatbot).
    if (data.type === 'bot_prompt') {
      // Clear the typing bubble the chatbot_pending marker turned on above —
      // the "reply" has now arrived.
      setAgentTyping(false);
      // Live signal the moment a bot_only branch (e.g. Careers) is entered —
      // don't wait for a reconnect/history reload to suppress the waiting
      // indicator for the rest of this session.
      if (data.bot_only) {
        _conversationBotOnly = true;
        _updateWaitingForAgentIndicator(); // hide it immediately if already showing
      }
      const createdAt = data.created_at || (data.message_obj && data.message_obj.created_at);
      const buttons = Array.isArray(data.buttons) ? data.buttons : [];
      const automationId = data.automation_id;
      const allowInput = data.allow_input === true;
      const buttonPathPrefix = Array.isArray(data.button_path_prefix) ? data.button_path_prefix : [];
      // Cancel any pending input-reveal timer — buttons control input visibility.
      clearTimeout(_inputRevealTimer);
      _inputRevealTimer = null;
      appendBotPromptWithButtons(data.message, createdAt, buttons, automationId, data.message_obj?.id, allowInput, buttonPathPrefix);
      notifyNewMessage(null, null, data.message);
      if (isWidgetOpen() && !document.hidden && isAtBottom) markRead();
      showNewMsgIndicator();
      smartScroll();
      // Restore widget state after bot prompt arrives (new sessions).
      _restoreWidgetState();
      return;
    }

    // CC1: agent-triggered contact card, live.
    if (data.type === 'contact_card') {
      setAgentTyping(false);
      const createdAt = data.created_at || (data.message_obj && data.message_obj.created_at);
      const fields = Array.isArray(data.fields) ? data.fields : [];
      if (data.agent_avatar) updateAgentAvatar(data.agent_avatar);
      if (data.agent_name) updateAgentName(data.agent_name);
      appendContactCard(data.message, createdAt, data.form_id, fields, data.submit_label, data.message_obj?.id, data.message_obj?.contact_card_state, { avatarUrl: data.agent_avatar, name: data.agent_name });
      notifyNewMessage(data.agent_name || activeAgentName, data.agent_avatar || activeAgentAvatarUrl, data.message);
      if (isWidgetOpen() && !document.hidden && isAtBottom) markRead();
      showNewMsgIndicator();
      smartScroll();
      return;
    }

    if (data.type === 'ai' || data.type === 'bot') {
      // Clear the typing bubble the chatbot_pending marker turned on above —
      // the "reply" has now arrived.
      setAgentTyping(false);
      const createdAt = data.created_at || (data.message_obj && data.message_obj.created_at);
      appendMessage('ai', data.message, createdAt, null, data.message_obj?.id);
      // chatbot_pending (sent ahead of every bot-authored message, incl. this
      // one) unconditionally hides the input box to fake a composing delay —
      // nothing un-hides it afterward except the bot_offline case below. Any
      // other bot message (e.g. the "no_agent_assigned_for" waiting message,
      // or a plain reply) left input stuck hidden with no way to recover
      // short of a reload. Restore it here unless the thread is read-only or
      // genuinely meant to stay locked (suppress_waiting/bot_only paths
      // already persist that via _setInputLocked(), checked by
      // _isInputLocked()). bot_offline has its own complete handling below
      // (including a case that intentionally keeps input hidden for the
      // contact overlay), so it's excluded here to avoid fighting that logic.
      if (
        !isReadOnlyThread
        && !_isInputLocked()
        && (!data.message_obj || data.message_obj.event_type !== 'bot_offline')
      ) {
        showInputContainer();
      }
      // If this is the offline automation bot message, collect visitor contact info.
      // If localStorage already has name + phone, send them silently to the backend
      // (so the conversation stores them) and skip the overlay. Otherwise show the
      // overlay so the visitor can provide their details.
      try {
        if (data.message_obj && data.message_obj.event_type === 'bot_offline') {
          if (_checkAndSendContactSilently()) {
            // Contact already on file — send silently and reveal input.
            showInputContainer();
          } else if (_leafButtonCommitted) {
            // Visitor already completed the IVR (automation_complete received).
            // Input is already open (or intentionally hidden for suppress_waiting
            // paths). Show the offline message as a chat bubble only — no overlay.
            showInputContainer();
          } else {
            // Visitor hasn't clicked a button yet (e.g. typed directly while
            // offline).  Collect contact details before proceeding.
            // If globally online but bot_offline fired, this is team-level offline.
            if (presenceOnline) _forceContactOverlay = true;
            showContactOverlay();
          }
        }
      } catch (e) { }
      notifyNewMessage(null, null, data.message);
      if (isWidgetOpen() && !document.hidden && isAtBottom) markRead();
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
      // Real message has landed — stop the 3s auto-off timer and the
      // launcher grace-off timer from later hiding an unrelated future dot;
      // notifyNewMessage() below consumes the live dot state itself.
      if (agentTypingTimer) {
        clearTimeout(agentTypingTimer);
        agentTypingTimer = null;
      }
      if (launcherTypingOffTimer) {
        clearTimeout(launcherTypingOffTimer);
        launcherTypingOffTimer = null;
      }
      if (data.agent_name) updateAgentName(data.agent_name);
      if (data.agent_avatar) updateAgentAvatar(data.agent_avatar);
      appendMessage('agent', data.message, data.created_at, { avatarUrl: data.agent_avatar, name: data.agent_name }, data.message_obj?.id);
      notifyNewMessage(data.agent_name || activeAgentName, data.agent_avatar || activeAgentAvatarUrl, data.message);
      if (isWidgetOpen() && !document.hidden && isAtBottom) markRead();
      showNewMsgIndicator();
      smartScroll();
    } else if (data.type === 'agent_joined') {
      _agentJoinedThisConv = true;
      setAgentTyping(false);
      _clearInputLocked(); // Agent taking over always unlocks input
      const createdAt = (data.message_obj && data.message_obj.created_at) || null;
      showJoinMessage(`${data.agent_name || 'A support agent'} joined the chat.`, createdAt);
      if (data.agent_name) updateAgentName(data.agent_name);
      if (data.agent_avatar) updateAgentAvatar(data.agent_avatar);
      showInputContainer();
      smartScroll();
    } else if (data.type === 'agent_typing') {
      const isTyping = Boolean(data.is_typing);
      if (agentTypingTimer) {
        clearTimeout(agentTypingTimer);
        agentTypingTimer = null;
      }
      if (isTyping) {
        setAgentTyping(true, data.agent_name);
        setLauncherTyping(true);
        if (launcherTypingOffTimer) {
          clearTimeout(launcherTypingOffTimer);
          launcherTypingOffTimer = null;
        }
        agentTypingTimer = setTimeout(() => {
          agentTypingTimer = null;
          setAgentTyping(false);
          setLauncherTyping(false);
        }, 3000);
      } else {
        // The in-thread indicator can clear instantly — it's live and visible,
        // no race to worry about. The launcher dot can't: the composer sends
        // is_typing:false the instant Enter is hit, a beat before the real
        // message frame lands, so hiding it here would wipe the live-dot state
        // notifyNewMessage() needs to do a clean dot->popup handoff. Give the
        // real message a grace window to arrive; only hide if nothing does
        // (agent stopped typing without sending).
        setAgentTyping(false);
        if (launcherTypingOffTimer) clearTimeout(launcherTypingOffTimer);
        launcherTypingOffTimer = setTimeout(() => {
          launcherTypingOffTimer = null;
          setLauncherTyping(false);
        }, 2000);
      }
    } else if (data.message) {
      const sender = data.sender === 'user' ? 'visitor' : (data.sender || 'ai');
      appendMessage(sender, data.message, data.created_at, null, data.message_obj?.id || data.id);
      smartScroll();
    } else if (data.type === 'automation_complete') {
      // IVR flow is done. Clear any fallback timer.
      clearTimeout(_inputRevealTimer);
      _inputRevealTimer = null;
      // allow_input=false → suppress_waiting path (e.g. Careers informational reply).
      // Persist the lock so input stays hidden after a page reload.
      // allow_input=true (or absent) → normal routing path: clear any stale lock and open input.
      if (data.allow_input !== false) {
        _clearInputLocked();
        showInputContainer();
        try { $id('chatassist-input')?.focus(); } catch (e) { }
      } else {
        _setInputLocked();
        // The reply that normally precedes this (chatbot_pending -> message)
        // now re-reveals input itself unless already locked — since the lock
        // wasn't set yet at that point, it would have shown briefly. Settle
        // it back to hidden here so this always lands in the correct final
        // state regardless of what ran before it.
        const inputCont = $id('chatassist-input-container');
        if (inputCont) inputCont.style.display = 'none';
      }
      // Mark that the visitor completed the IVR so bot_offline won't re-open
      // the contact overlay on top of an already-open input.
      _leafButtonCommitted = true;
      // Only a committed LEAF fires automation_complete (branch clicks like
      // "Careers" itself don't) — this is the right point to consider the
      // visitor "engaged", not the moment any button (incl. a branch) is clicked.
      _visitorHasEngaged = true;
      _updateWaitingForAgentIndicator();
      _updateHeaderButtons();
    } else if (data.type === 'conversation_created') {
      // Backend auto-created a conversation in response to our first message (conv_id=0 path).
      // Update our local state without reconnecting the WS.
      if (data.conversation_id) {
        CONFIG.conversationId = data.conversation_id;
        viewMode = 'thread';
        isReadOnlyThread = false;
        _updateHeaderButtons();
        _updateWaitingForAgentIndicator();
      }
    }
  }

  // --- Scrolling Logic ---

  function smartScroll() {
    const el = $id('chatassist-messages');
    if (!el) return;

    // Use multiple requestAnimationFrame to ensure the browser has actually painted
    // and layout is fully recalculated, which is critical for accurate scrollHeight.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const unreadDivider = $id('chatassist-unread-divider');

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
    const el = $id('chatassist-messages');
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
      isAtBottom = true;
    });
  }

  function handleMessagesScroll() {
    const el = $id('chatassist-messages');
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    isAtBottom = nearBottom;
    if (nearBottom) {
      if (firstUnreadMessageId) markRead();
      hideNewMsgIndicator();
    }
    // Remove unread divider once the user scrolls past it.
    const divider = $id('chatassist-unread-divider');
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
    const el = $id('chatassist-new-msg-indicator');
    if (el) {
      el.style.display = 'flex';
      el.style.opacity = '1';
    }
  }

  function hideNewMsgIndicator() {
    const el = $id('chatassist-new-msg-indicator');
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
    const iconInner = $id('chatassist-header-icon-inner');
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
    const attachBtn = $id('chatassist-attach');
    if (attachBtn) {
      attachBtn.classList.toggle('chatassist-attach-uploading', uploadingAttachmentsCount > 0);
      attachBtn.setAttribute('aria-busy', uploadingAttachmentsCount > 0 ? 'true' : 'false');
    }
    updateSendButtonState();
  }

  // Keeps the composer's send button in sync with whether there's anything
  // to send — disabled/dim while empty (handleUserMessage already no-ops on
  // empty input; this just makes that visible), and swaps in a "ready" class
  // for the icon-rotate animation once there's text or an attachment.
  function updateSendButtonState() {
    const sendBtn = $id('chatassist-send');
    if (!sendBtn) return;
    const inputEl = $id('chatassist-input');
    const hasText = !!(inputEl && inputEl.value && inputEl.value.trim().length > 0);
    const hasAttachments = draftAttachments.length > 0;
    const uploading = uploadingAttachmentsCount > 0;
    sendBtn.disabled = uploading || (!hasText && !hasAttachments);
    sendBtn.classList.toggle('chatassist-send-ready', !uploading && (hasText || hasAttachments));
  }

  function renderAttachmentChips() {
    updateSendButtonState();
    const wrap = $id('chatassist-attachments');
    if (!wrap) return;
    wrap.innerHTML = '';
    saveDraftAttachments(draftAttachments);
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
    // Only adopt the server's conversation_id if we don't have one yet (start-view).
    if (!CONFIG.conversationId && typeof data.conversation_id === 'number') {
      CONFIG.conversationId = data.conversation_id || 0;
    }
    const absoluteUrl = getFullAssetUrl(data.url) || data.url;
    return {
      id: (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : `att-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: data.filename || file.name || 'attachment',
      url: absoluteUrl,
      kind: isProbablyImageFile(file) ? 'image' : 'file',
    };
  }

  function unescapeMarkdown(str) {
    // Reverse markdown backslash escapes (e.g. \* → *, \\ → \, \_ → _)
    // Also normalise trailing whitespace inside closing delimiters (old message
    // format): "***Hello! ***" → "***Hello!***" so the renderer sees valid markup.
    return String(str || '')
      .replace(/\\([\\`*_\[\]()/])/g, '$1')
      .replace(/\*\*\*([^*\n]*[^\s*\n])\s+\*\*\*/g, '***$1***')
      .replace(/\*\*([^*\n]*[^\s*\n])\s+\*\*/g, '**$1**')
      .replace(/\*([^*\n]*[^\s*\n])\s+\*/g, '*$1*');
  }

  function renderInlineMarkdown(text) {
    const frag = document.createDocumentFragment();
    const s = String(text || '');

    const patterns = [
      { type: 'image', re: /!\[([^\]]*)\]\(([^)]+)\)/g },
      { type: 'link', re: /\[([^\]]+)\]\(([^)]+)\)/g },
      { type: 'bold_italic', re: /\*\*\*([^*\n]+)\*\*\*/g },
      { type: 'bold', re: /\*\*([^*]+)\*\*/g },
      { type: 'italic', re: /\*([^*\n]+)\*/g },
      // Bare domains like abc.com, docs.example.co.uk/path — exclude email addresses via negative lookbehind
      { type: 'bare', re: /(?<!@)\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?::\d{2,5})?(?:\/[\w\-./?%#=&+]*)?/gi },
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

      if (best.type === 'bold_italic') {
        const strong = document.createElement('strong');
        const em = document.createElement('em');
        em.textContent = String(m[1] || '');
        strong.appendChild(em);
        frag.appendChild(strong);
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
    const container = $id('chatassist-messages');
    if (!container) return;

    // Hide empty state once a message is added.
    const emptyEl = $id('chatassist-empty-state');
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
    // Agent/bot messages use markdown escaping from the composer; unescape before rendering.
    const displayContent = (sender === 'agent' || sender === 'ai') ? unescapeMarkdown(content) : content;
    renderMarkdownInto(bubble, displayContent);

    const timestamp = document.createElement('div');
    timestamp.className = 'chatassist-message-timestamp';
    timestamp.textContent = formatTimestamp(createdAtIso ? new Date(createdAtIso) : new Date());

    contentWrap.appendChild(bubble);
    contentWrap.appendChild(timestamp);

    if (sender === 'agent' || sender === 'ai') {
      const avatar = document.createElement('div');
      avatar.className = `chatassist-message-avatar chatassist-message-avatar-${sender}`;
      if (sender === 'ai') {
        avatar.innerHTML = BOT_AVATAR_SVG;
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

  function appendBotPromptWithButtons(content, createdAtIso, buttons, automationId, messageId, allowInput, buttonPathPrefix) {
    // buttonPathPrefix is the path that leads to this sub-prompt ([] for top-level).
    if (!Array.isArray(buttonPathPrefix)) buttonPathPrefix = [];
    const container = $id('chatassist-messages');
    if (!container) return;

    // Hide empty state
    const emptyEl = $id('chatassist-empty-state');
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
    avatar.innerHTML = BOT_AVATAR_SVG;

    const contentWrap = document.createElement('div');
    contentWrap.className = 'chatassist-message-content';

    const bubble = document.createElement('div');
    bubble.className = 'chatassist-message-bubble';
    renderMarkdownInto(bubble, unescapeMarkdown(content));

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
          // Offline interception: only for leaf buttons where collect_contact is
          // enabled.  Branch buttons (is_branch=true) navigate to a sub-menu and
          // must never be blocked — the team hasn't been picked yet.  Buttons with
          // collect_contact=false are informational paths (e.g. Careers replies)
          // that should never show the contact overlay.

          // All paths that decide to proceed converge here.
          function commitClick() {
            const allBtns = buttonsWrap.querySelectorAll('.chatassist-prompt-btn');
            allBtns.forEach(function (b) {
              b.disabled = true;
              b.classList.add('chatassist-prompt-btn-disabled');
            });
            btnEl.classList.add('chatassist-prompt-btn-selected');
            // Input reveal is deferred: the server sends automation_complete
            // after processing (so the reply appears before the input opens).
            // Only arm the 5-second fallback if free-text input is allowed.
            clearTimeout(_inputRevealTimer);
            if (allowInput) {
              _inputRevealTimer = setTimeout(showInputContainer, 5000);
            }
            // Optimistically append the visitor's selection as a visitor message.
            appendMessage('visitor', btn.label || 'Option ' + (idx + 1), new Date().toISOString(), null, null);
            isAtBottom = true;
            smartScroll();
            // Resolve by stable button id, not array position (AUT1) — a
            // reorder in the editor between send and click must not make a
            // stale click execute whatever button now sits at this index.
            sendBotButtonClick(automationId, [...buttonPathPrefix, btn.id]);
          }

          if (!btn.is_branch && btn.collect_contact !== false) {
            if (!presenceOnline && !_checkAndSendContactSilently()) {
              // Website definitively offline (real-time WS presence) — block immediately.
              pendingBotButtonClick = { automationId: automationId, buttonPath: [...buttonPathPrefix, btn.id], label: btn.label || 'Option ' + (idx + 1), _btnEl: btnEl, _allBtns: Array.from(buttonsWrap.querySelectorAll('.chatassist-prompt-btn')) };
              showContactOverlay();
              return;
            }
            if (presenceOnline && btn.team_id && !_checkAndSendContactSilently()) {
              // btn.team_online is a one-time snapshot baked at conversation-creation
              // time — it is stale in both directions (team may have gone offline OR
              // come online since). Always verify the specific team in real time.
              var _pendingClick = { automationId: automationId, buttonPath: [...buttonPathPrefix, btn.id], label: btn.label || 'Option ' + (idx + 1), _btnEl: btnEl, _allBtns: Array.from(buttonsWrap.querySelectorAll('.chatassist-prompt-btn')) };
              btnEl.disabled = true;
              fetch(
                CONFIG.apiUrl + '/widget/team-online?website_id=' + encodeURIComponent(CONFIG.websiteId) +
                '&team_id=' + encodeURIComponent(btn.team_id)
              )
                .then(function (r) { return r.ok ? r.json() : { online: false }; })
                .catch(function () { return { online: false }; })
                .then(function (data) {
                  btnEl.disabled = false;
                  if (data.online) {
                    commitClick();
                  } else {
                    pendingBotButtonClick = _pendingClick;
                    showContactOverlay();
                  }
                });
              return;
            }
          }

          commitClick();
        });
        buttonsWrap.appendChild(btnEl);
      });

      contentWrap.appendChild(buttonsWrap);
    }

    row.appendChild(avatar);
    row.appendChild(contentWrap);
    messageDiv.appendChild(row);
    container.appendChild(messageDiv);

    // Manage input visibility based on buttons and allow_input flag.
    if (Array.isArray(buttons) && buttons.length > 0) {
      if (allowInput) {
        // Chatbot step allows free-form input alongside buttons.
        showInputContainer();
      } else {
        // Hide input until visitor clicks a button.
        const inputCont = $id('chatassist-input-container');
        if (inputCont) inputCont.style.display = 'none';
      }
    }
  }

  // CC1: agent-triggered contact card + the offline gate's extra-fields
  // extension both render the same website_forms field shape (text/email/
  // phone/textarea/select). This renders it as an in-thread card — never a
  // blocking overlay — reusing the .chatassist-contact-form input styling
  // already built for the offline gate.
  //
  // CC1: currently-rendered cards still awaiting a fill, by message id — a
  // brand new card arriving live means the agent resent, so any of these are
  // now superseded (mirrors the server's own "newer card exists" rule,
  // applied instantly instead of waiting for a reload).
  var _pendingContactCards = {};

  function _expireContactCard(messageId) {
    var entry = _pendingContactCards[messageId];
    if (!entry) return;
    delete _pendingContactCards[messageId];
    Object.keys(entry.inputs).forEach(function (k) { entry.inputs[k].disabled = true; });
    entry.submitBtn.style.display = 'none';
    entry.statusEl.className = 'chatassist-contact-card-expired';
    entry.statusEl.textContent = 'This form has expired. Ask the agent to resend it.';
  }

  // ─── International phone support ────────────────────────────────────────
  // Lazy-loads libphonenumber-js and countries-and-timezones (both vendored
  // alongside this file) so per-country validation/formatting and default-
  // country detection stay maintainer-updated instead of hand-rolled tables.
  // Only fetched once, and only when a phone field is actually about to
  // render — most visitors never touch one. Shared by both phone entry
  // points (the offline-gate overlay and in-thread contact-card forms) so
  // they can't drift the way the avatar badges did.

  function _loadVendoredScript(filename) {
    return new Promise(function (resolve, reject) {
      try {
        var src = scriptElement && scriptElement.src ? scriptElement.src : '';
        var url = src ? src.replace(/chat-widget\.js(\?.*)?$/, filename) : null;
        if (!url) { reject(new Error('no widget script src')); return; }
        var s = document.createElement('script');
        s.src = url;
        s.async = true;
        s.onload = function () { resolve(); };
        s.onerror = function () { reject(new Error('failed to load ' + filename)); };
        document.head.appendChild(s);
      } catch (e) { reject(e); }
    });
  }

  var _phoneLibPromise = null;
  function loadPhoneNumberLib() {
    if (window.libphonenumber) return Promise.resolve(window.libphonenumber);
    if (_phoneLibPromise) return _phoneLibPromise;
    _phoneLibPromise = _loadVendoredScript('libphonenumber-min.js').then(function () { return window.libphonenumber; });
    return _phoneLibPromise;
  }

  var _tzLibPromise = null;
  function loadTimezoneCountryLib() {
    if (window.ct) return Promise.resolve(window.ct);
    if (_tzLibPromise) return _tzLibPromise;
    _tzLibPromise = _loadVendoredScript('countries-and-timezones.min.js').then(function () { return window.ct; });
    return _tzLibPromise;
  }

  function _phoneFlagEmoji(iso2) {
    if (!iso2 || iso2.length !== 2) return '';
    var base = 127397; // regional-indicator offset from the ASCII letter codepoint
    return String.fromCodePoint(iso2.charCodeAt(0) + base, iso2.charCodeAt(1) + base);
  }

  var _phoneCountryNamer = null;
  function _phoneCountryName(iso2) {
    try {
      if (!_phoneCountryNamer && typeof Intl !== 'undefined' && Intl.DisplayNames) {
        _phoneCountryNamer = new Intl.DisplayNames(['en'], { type: 'region' });
      }
      return (_phoneCountryNamer && _phoneCountryNamer.of(iso2)) || iso2;
    } catch (e) { return iso2; }
  }

  // One example national-significant-number per country (from
  // libphonenumber-js's examples.mobile.json, MIT license — see
  // LICENSE-libphonenumber-js.txt) — fed through AsYouType below to build a
  // per-country placeholder pattern like "XXXXX XXXXX" (IN) or
  // "(XXX) XXX-XXXX" (US). Inlined rather than lazy-loaded as a 4th vendored
  // file since it's tiny (~4KB) and always needed alongside the phone lib.
  var PHONE_EXAMPLE_DIGITS = {"AC":"40123","AD":"312345","AE":"501234567","AF":"701234567","AG":"2684641234","AI":"2642351234","AL":"672123456","AM":"77123456","AO":"923123456","AR":"91123456789","AS":"6847331234","AT":"664123456","AU":"412345678","AW":"5601234","AX":"412345678","AZ":"401234567","BA":"61123456","BB":"2462501234","BD":"1812345678","BE":"450001234","BF":"70123456","BG":"43012345","BH":"36001234","BI":"79561234","BJ":"0195123456","BL":"690001234","BM":"4413701234","BN":"7123456","BO":"71234567","BQ":"3181234","BR":"11961234567","BS":"2423591234","BT":"17123456","BW":"71123456","BY":"294911911","BZ":"6221234","CA":"5062345678","CC":"412345678","CD":"991234567","CF":"70012345","CG":"061234567","CH":"781234567","CI":"0123456789","CK":"71234","CL":"221234567","CM":"671234567","CN":"13123456789","CO":"3211234567","CR":"83123456","CU":"51234567","CV":"9911234","CW":"95181234","CX":"412345678","CY":"96123456","CZ":"601123456","DE":"15123456789","DJ":"77831001","DK":"34412345","DM":"7672251234","DO":"8092345678","DZ":"551234567","EC":"991234567","EE":"51234567","EG":"1001234567","EH":"650123456","ER":"7123456","ES":"612345678","ET":"911234567","FI":"412345678","FJ":"7012345","FK":"51234","FM":"3501234","FO":"211234","FR":"612345678","GA":"06031234","GB":"7400123456","GD":"4734031234","GE":"555123456","GF":"694201234","GG":"7781123456","GH":"231234567","GI":"57123456","GL":"221234","GM":"3012345","GN":"601123456","GP":"690001234","GQ":"222123456","GR":"6912345678","GT":"51234567","GU":"6713001234","GW":"955012345","GY":"6091234","HK":"51234567","HN":"91234567","HR":"921234567","HT":"34101234","HU":"201234567","ID":"812345678","IE":"850123456","IL":"502345678","IM":"7924123456","IN":"8123456789","IO":"3801234","IQ":"7912345678","IR":"9123456789","IS":"6111234","IT":"3123456789","JE":"7797712345","JM":"8762101234","JO":"790123456","JP":"9012345678","KE":"712123456","KG":"700123456","KH":"91234567","KI":"72001234","KM":"3212345","KN":"8697652917","KP":"1921234567","KR":"1020000000","KW":"50012345","KY":"3453231234","KZ":"7710009998","LA":"2023123456","LB":"71123456","LC":"7582845678","LI":"660234567","LK":"712345678","LR":"770123456","LS":"50123456","LT":"61234567","LU":"628123456","LV":"21234567","LY":"912345678","MA":"650123456","MC":"612345678","MD":"62112345","ME":"60123456","MF":"690001234","MG":"321234567","MH":"2351234","MK":"72345678","ML":"65012345","MM":"92123456","MN":"88123456","MO":"66123456","MP":"6702345678","MQ":"696201234","MR":"22123456","MS":"6644923456","MT":"96961234","MU":"52512345","MV":"7712345","MW":"991234567","MX":"2221234567","MY":"123456789","MZ":"821234567","NA":"811234567","NC":"751234","NE":"93123456","NF":"381234","NG":"8021234567","NI":"81234567","NL":"612345678","NO":"40612345","NP":"9841234567","NR":"5551234","NU":"8884012","NZ":"211234567","OM":"92123456","PA":"61234567","PE":"912345678","PF":"87123456","PG":"70123456","PH":"9051234567","PK":"3012345678","PL":"512345678","PM":"551234","PR":"7872345678","PS":"599123456","PT":"912345678","PW":"6201234","PY":"961456789","QA":"33123456","RE":"692123456","RO":"712034567","RS":"601234567","RU":"9123456789","RW":"720123456","SA":"512345678","SB":"7421234","SC":"2510123","SD":"911231234","SE":"701234567","SG":"81234567","SH":"51234","SI":"31234567","SJ":"41234567","SK":"912123456","SL":"25123456","SM":"66661212","SN":"701234567","SO":"71123456","SR":"7412345","SS":"977123456","ST":"9812345","SV":"70123456","SX":"7215205678","SY":"944567890","SZ":"76123456","TA":"8999","TC":"6492311234","TD":"63012345","TG":"90112345","TH":"812345678","TJ":"917123456","TK":"7290","TL":"77212345","TM":"66123456","TN":"20123456","TO":"7715123","TR":"5012345678","TT":"8682911234","TV":"901234","TW":"912345678","TZ":"621234567","UA":"501234567","UG":"712345678","US":"2015550123","UY":"94231234","UZ":"912345678","VA":"3123456789","VC":"7844301234","VE":"4121234567","VG":"2843001234","VI":"3406421234","VN":"912345678","VU":"5912345","WF":"821234","WS":"7212345","XK":"43201234","YE":"712345678","YT":"639012345","ZA":"711234567","ZM":"955123456","ZW":"712345678"};

  // Builds a placeholder like "XXXXX XXXXX" (IN) or "(XXX) XXX-XXXX" (US) —
  // AsYouType formats the example digits exactly the way a real typed
  // number would group/punctuate for that country, then every digit is
  // swapped for a generic "0" so it reads as a pattern, not a real number.
  function _phonePlaceholder(lp, iso) {
    try {
      var raw = PHONE_EXAMPLE_DIGITS[iso];
      if (!raw) return '';
      return new lp.AsYouType(iso).input(raw).replace(/[0-9]/g, '0');
    } catch (e) { return ''; }
  }

  function _applyPhonePlaceholder(lp, inputEl, iso, required) {
    var pattern = _phonePlaceholder(lp, iso);
    if (pattern) inputEl.placeholder = pattern + (required ? ' *' : '');
  }

  // Per-country digit cap for live typing — India should stop at 10, not
  // the generic 15-digit E.164 safety net every country was sharing before.
  // The example number's length is a reasonable proxy for "how long a real
  // number in this country is" without needing a full length-metadata table.
  var DEFAULT_PHONE_MAX_LENGTH = 15;
  function _phoneMaxLength(iso) {
    var raw = iso && PHONE_EXAMPLE_DIGITS[iso];
    return raw ? raw.length : DEFAULT_PHONE_MAX_LENGTH;
  }

  var DEFAULT_PHONE_COUNTRY = 'IN';
  // Timezone is a much stronger real-location signal than browser language
  // (a visitor in India commonly has an en-US-language browser, but their
  // OS timezone is still Asia/Kolkata) — try it first, then fall back to
  // language, then India.
  function _detectDefaultPhoneCountry(lp, ct) {
    try {
      if (ct) {
        var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        var byTz = tz && ct.getCountryForTimezone(tz);
        if (byTz && byTz.id && lp.getCountries().indexOf(byTz.id) !== -1) return byTz.id;
      }
    } catch (e) { }
    try {
      var langs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language];
      for (var i = 0; i < langs.length; i++) {
        var lang = langs[i];
        var region = null;
        try { region = new Intl.Locale(lang).maximize().region; } catch (e) {
          var m = /-([A-Z]{2})$/.exec(lang || '');
          region = m ? m[1] : null;
        }
        if (region && lp.getCountries().indexOf(region) !== -1) return region;
      }
    } catch (e) { }
    return DEFAULT_PHONE_COUNTRY;
  }

  function _phoneCountryStorageKey() {
    return 'ai_chatassist_phone_country_' + CONFIG.websiteId;
  }

  // Builds a searchable country-code combobox: a compact trigger button
  // (flag + dial code) plus a floating search+list panel — a native
  // <select> with 240+ options isn't browsable. The panel is (by the
  // caller) appended into `panelHost` — #chatassist-widget, not `wrap` —
  // and positioned with `fixed` coordinates so it isn't clipped by the
  // form's scroll container, the same way a native <select>'s dropdown
  // escapes page overflow. `panelHost` is also #chatassist-widget's own
  // `transform` (the open/close animation) making it the fixed-position
  // containing block for the panel, per spec — positionPanel() below
  // accounts for that by measuring `panelHost`, not the viewport.
  //
  // Returns the actual state-holding <select> (real change events, real
  // .value) so callers can keep treating it like a native select; the
  // visible trigger+panel just drive it programmatically. `select._uiRoot`
  // is the element callers should insert into the DOM.
  function _buildPhoneCountrySelect(lp, selectedIso, panelHost) {
    const select = document.createElement('select');
    select.className = 'chatassist-phone-country-native';
    select.setAttribute('aria-hidden', 'true');
    select.tabIndex = -1;

    const countries = lp.getCountries().slice().sort(function (a, b) {
      return _phoneCountryName(a).localeCompare(_phoneCountryName(b));
    });
    const meta = {};
    countries.forEach(function (iso) {
      const opt = document.createElement('option');
      opt.value = iso;
      select.appendChild(opt);
      meta[iso] = { name: _phoneCountryName(iso), dial: lp.getCountryCallingCode(iso) };
    });
    select.value = selectedIso;

    const wrap = document.createElement('div');
    wrap.className = 'chatassist-phone-country';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'chatassist-phone-country-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');

    const panel = document.createElement('div');
    panel.className = 'chatassist-phone-country-panel';
    panel.style.display = 'none';
    panel.setAttribute('role', 'listbox');

    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'chatassist-phone-country-search';
    search.placeholder = 'Search country or code';
    search.autocomplete = 'off';

    const list = document.createElement('div');
    list.className = 'chatassist-phone-country-list';

    function renderTrigger() {
      const m = meta[select.value];
      trigger.innerHTML = '';
      const flag = document.createElement('span');
      flag.textContent = _phoneFlagEmoji(select.value);
      const code = document.createElement('span');
      code.className = 'chatassist-phone-country-code';
      code.textContent = '+' + (m ? m.dial : '');
      trigger.appendChild(flag);
      trigger.appendChild(code);
    }

    let activeIndex = -1;

    // Moves the keyboard-highlighted option to `idx` (clamped to the current
    // list), updates its visual state, and scrolls it into view. Separate
    // from `.selected` (the country the field is actually set to) — the two
    // usually differ while arrowing around.
    function setActive(idx) {
      const opts = list.querySelectorAll('.chatassist-phone-country-option');
      if (!opts.length) { activeIndex = -1; return; }
      activeIndex = Math.max(0, Math.min(idx, opts.length - 1));
      opts.forEach(function (o, i) {
        const isActive = i === activeIndex;
        o.classList.toggle('active', isActive);
        o.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      const activeEl = opts[activeIndex];
      if (activeEl && activeEl.scrollIntoView) activeEl.scrollIntoView({ block: 'nearest' });
    }

    function renderList(filter) {
      list.innerHTML = '';
      // "+1" is how visitors think of a dial code, but m.dial is stored as
      // bare digits ("1") — include a "+"-prefixed variant in the haystack
      // so both "+1" and "1" match instead of "+1" finding nothing.
      const q = (filter || '').trim().toLowerCase();
      let shown = 0;
      countries.forEach(function (iso) {
        const m = meta[iso];
        const hay = (m.name + ' ' + iso + ' ' + m.dial + ' +' + m.dial).toLowerCase();
        if (q && hay.indexOf(q) === -1) return;
        const optIndex = shown;
        shown++;
        const opt = document.createElement('div');
        opt.className = 'chatassist-phone-country-option' + (iso === select.value ? ' selected' : '');
        opt.setAttribute('role', 'option');
        const optFlag = document.createElement('span');
        optFlag.className = 'chatassist-phone-country-option-flag';
        optFlag.textContent = _phoneFlagEmoji(iso);
        const optName = document.createElement('span');
        optName.className = 'chatassist-phone-country-option-name';
        optName.textContent = m.name;
        const optDial = document.createElement('span');
        optDial.className = 'chatassist-phone-country-option-dial';
        optDial.textContent = '+' + m.dial;
        opt.appendChild(optFlag);
        opt.appendChild(optName);
        opt.appendChild(optDial);
        opt.addEventListener('mouseenter', function () { setActive(optIndex); });
        opt.addEventListener('click', function () {
          select.value = iso;
          select.dispatchEvent(new Event('change'));
          renderTrigger();
          closePanel();
        });
        list.appendChild(opt);
      });
      if (!shown) {
        activeIndex = -1;
        const empty = document.createElement('div');
        empty.className = 'chatassist-phone-country-empty';
        empty.textContent = 'No matches';
        list.appendChild(empty);
      } else {
        // Keyboard nav always starts from the top match — lets Enter select
        // immediately after typing, without requiring an ArrowDown first.
        setActive(0);
      }
    }

    function positionPanel() {
      // NOTE: `offsetParent` is unusable here — per spec it's always null
      // for position:fixed elements, regardless of a transformed ancestor
      // establishing the actual containing block. So `panelHost` (passed
      // in by the caller, who knows exactly what the panel was appended
      // into) is measured directly instead of trying to auto-detect it.
      //
      // Flip/clamp math below is done in viewport coordinates (r, vw, vh —
      // independent of panelHost), then converted to panelHost-relative
      // units only for the final style assignment. Assumes the list is
      // already populated (renderList must run before this, in openPanel)
      // so panel.getBoundingClientRect().height reflects real content, not
      // an empty shell.
      const r = trigger.getBoundingClientRect();
      const base = panelHost ? panelHost.getBoundingClientRect() : { left: 0, top: 0 };
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const panelWidth = Math.max(r.width, 220);
      const panelHeight = panel.getBoundingClientRect().height || 260;

      const spaceBelow = vh - r.bottom;
      const openUpward = spaceBelow < panelHeight + 8 && r.top > spaceBelow;
      const top = openUpward ? Math.max(8, r.top - panelHeight - 4) : (r.bottom + 4);

      let left = r.left;
      const maxLeft = vw - panelWidth - 8;
      if (left > maxLeft) left = Math.max(8, maxLeft);

      panel.style.left = Math.round(left - base.left) + 'px';
      panel.style.top = Math.round(top - base.top) + 'px';
      panel.style.minWidth = Math.round(panelWidth) + 'px';
    }

    function onOutsideClick(e) {
      // e.target alone isn't reliable here: this listener sits on `document`,
      // outside the widget's shadow root, so any event originating *inside*
      // the shadow tree gets retargeted — e.target becomes the shadow host,
      // not the actual search input/option that was clicked. That made every
      // click inside the panel look like an "outside" click and close it
      // before the option's own click handler ever ran. composedPath() isn't
      // retargeted, so it's the reliable way to check containment across a
      // shadow boundary.
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
      if (path.indexOf(wrap) === -1 && path.indexOf(panel) === -1) closePanel();
    }
    function onReposition() { if (panel.style.display !== 'none') positionPanel(); }

    function openPanel() {
      // display must flip, and the list must be populated, before
      // positioning: positionPanel measures panel.getBoundingClientRect()
      // to decide whether to flip upward, which needs real content height
      // (an empty, display:none panel measures as ~0).
      panel.style.display = 'block';
      search.value = '';
      renderList('');
      positionPanel();
      setTimeout(function () { search.focus(); }, 0);
      document.addEventListener('mousedown', onOutsideClick, true);
      window.addEventListener('scroll', onReposition, true);
      window.addEventListener('resize', onReposition, true);
    }
    function closePanel() {
      panel.style.display = 'none';
      document.removeEventListener('mousedown', onOutsideClick, true);
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition, true);
    }

    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      if (panel.style.display === 'none') openPanel(); else closePanel();
    });
    search.addEventListener('input', function () { renderList(search.value); });
    search.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closePanel(); trigger.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIndex + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIndex - 1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const opts = list.querySelectorAll('.chatassist-phone-country-option');
        const target = opts[activeIndex] || opts[0];
        if (target) target.dispatchEvent(new Event('click'));
      }
    });

    panel.appendChild(search);
    panel.appendChild(list);
    wrap.appendChild(trigger);
    wrap.appendChild(select);
    renderTrigger();

    select._uiRoot = wrap;
    select._uiPanel = panel;
    return select;
  }

  // Inserts a country-code combobox before `inputEl` inside `wrapEl` once
  // the phone library loads (progressive enhancement — the plain digit
  // input works immediately, the combobox fades in a moment later).
  // `prefillValue`, if given, is either a legacy bare-digit number (assumed
  // India) or an E.164 "+<code><digits>" string to split back into
  // (country, national number) — e.g. from a previous visit's localStorage.
  // `required` only affects the placeholder's trailing " *" hint.
  function enhancePhoneField(wrapEl, inputEl, prefillValue, required) {
    inputEl.addEventListener('input', function () {
      // Re-read the max on every keystroke (not captured once at setup) so
      // it tracks whichever country is currently selected — before the
      // combobox exists yet, __phoneCountrySelect is undefined and this
      // falls back to the generic 15-digit E.164 cap.
      const iso = inputEl.__phoneCountrySelect && inputEl.__phoneCountrySelect.value;
      this.value = this.value.replace(/[^\d]/g, '').slice(0, _phoneMaxLength(iso));
    });
    Promise.all([loadPhoneNumberLib(), loadTimezoneCountryLib().catch(function () { return null; })]).then(function (libs) {
      const lp = libs[0];
      const ct = libs[1];
      if (!lp || inputEl.disabled) return;
      let iso = null;
      if (prefillValue && String(prefillValue).trim().charAt(0) === '+') {
        const parsed = lp.parsePhoneNumberFromString(String(prefillValue).trim());
        if (parsed) { iso = parsed.country; inputEl.value = parsed.nationalNumber; }
      }
      if (!iso) {
        try {
          const saved = localStorage.getItem(_phoneCountryStorageKey());
          if (saved && lp.getCountries().indexOf(saved) !== -1) iso = saved;
        } catch (e) { }
      }
      if (!iso) iso = _detectDefaultPhoneCountry(lp, ct);
      const maxLen = _phoneMaxLength(iso);
      if (!inputEl.value && prefillValue && String(prefillValue).trim().charAt(0) !== '+') {
        inputEl.value = String(prefillValue).replace(/\D/g, '').slice(0, maxLen);
      }
      // Whatever's already there (typed before the lib/country resolved,
      // still under the generic 15-digit cap) gets trimmed to this
      // country's actual length too.
      if (inputEl.value.length > maxLen) inputEl.value = inputEl.value.slice(0, maxLen);
      _applyPhonePlaceholder(lp, inputEl, iso, required);
      // Appended into #chatassist-widget (not bare __shadow) so the panel
      // still inherits the .chatassist-theme-dark ancestor class used by
      // the dark-mode overrides below.
      const _panelHost = $id('chatassist-widget') || __shadow;
      const select = _buildPhoneCountrySelect(lp, iso, _panelHost);
      select.addEventListener('change', function () {
        try { localStorage.setItem(_phoneCountryStorageKey(), select.value); } catch (e) { }
        _applyPhonePlaceholder(lp, inputEl, select.value, required);
        const newMax = _phoneMaxLength(select.value);
        if (inputEl.value.length > newMax) inputEl.value = inputEl.value.slice(0, newMax);
      });
      if (_panelHost) _panelHost.appendChild(select._uiPanel);
      wrapEl.insertBefore(select._uiRoot, inputEl);
      inputEl.__phoneCountrySelect = select;
    }).catch(function () {
      // Offline/blocked — the plain digit input still works, validated as a
      // bare 10-digit India number at submit time (see validatePhoneValue).
    });
  }

  // Returns an error message string, or null if `value` is a valid phone
  // number. Falls back to the legacy exact-10-digit India rule if the
  // library hasn't finished loading yet (rare — only right after the field
  // first renders).
  function validatePhoneValue(inputEl, value) {
    const select = inputEl.__phoneCountrySelect;
    const lp = window.libphonenumber;
    if (select && lp) {
      return lp.isValidPhoneNumber(value, select.value) ? null : 'Please enter a valid phone number.';
    }
    return value.replace(/\D/g, '').length === 10 ? null : 'Please enter a valid 10-digit phone number.';
  }

  // Composes the value actually sent to the backend: E.164 when the country
  // library is available, otherwise the raw digits (backend assumes India
  // for bare digit strings — see DEFAULT_PHONE_REGION in forms.py).
  function composePhoneValue(inputEl, value) {
    const select = inputEl.__phoneCountrySelect;
    const lp = window.libphonenumber;
    if (select && lp) {
      const parsed = lp.parsePhoneNumberFromString(value, select.value);
      if (parsed) return parsed.number;
    }
    return value;
  }

  function appendContactCard(content, createdAtIso, formId, fields, submitLabel, messageId, cardState, meta) {
    const container = $id('chatassist-messages');
    if (!container) return;

    const emptyEl = $id('chatassist-empty-state');
    if (emptyEl) emptyEl.style.display = 'none';

    const state = cardState || { status: 'pending' };

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

    if (state.status === 'pending') {
      // A new fillable card supersedes any still-pending ones in this session.
      Object.keys(_pendingContactCards).forEach(_expireContactCard);
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = 'chatassist-message chatassist-message-agent';

    const row = document.createElement('div');
    row.className = 'chatassist-message-row chatassist-message-row-left';

    const avatar = document.createElement('div');
    avatar.className = 'chatassist-message-avatar chatassist-message-avatar-agent';
    const avatarUrl = getFullAssetUrl(meta && meta.avatarUrl || activeAgentAvatarUrl);
    const avatarName = (meta && meta.name) || activeAgentName || 'Agent';
    if (avatarUrl) {
      avatar.innerHTML = '<img class="chatassist-message-avatar-img" src="' + avatarUrl + '" alt="' + avatarName + '">';
    } else {
      avatar.textContent = (avatarName.trim().split(/\s+/).slice(0, 2).map(function (p) { return p[0]; }).join('') || 'AG').toUpperCase();
    }

    const contentWrap = document.createElement('div');
    contentWrap.className = 'chatassist-message-content';

    const bubble = document.createElement('div');
    bubble.className = 'chatassist-message-bubble';
    renderMarkdownInto(bubble, unescapeMarkdown(content));

    const timestamp = document.createElement('div');
    timestamp.className = 'chatassist-message-timestamp';
    timestamp.textContent = formatTimestamp(createdAtIso ? new Date(createdAtIso) : new Date());

    contentWrap.appendChild(bubble);
    contentWrap.appendChild(timestamp);

    if (Array.isArray(fields) && fields.length > 0) {
      const form = document.createElement('div');
      form.className = 'chatassist-contact-form chatassist-contact-card';

      const inputs = {};
      fields.forEach(function (field) {
        var inputEl;
        var appendTarget;
        if (field.field_type === 'textarea') {
          inputEl = document.createElement('textarea');
          inputEl.rows = 2;
          appendTarget = inputEl;
        } else if (field.field_type === 'select') {
          inputEl = document.createElement('select');
          (field.options || []).forEach(function (opt) {
            const o = document.createElement('option');
            o.value = opt;
            o.textContent = opt;
            inputEl.appendChild(o);
          });
          appendTarget = inputEl;
        } else if (field.field_type === 'phone') {
          inputEl = document.createElement('input');
          inputEl.type = 'tel';
          const wrap = document.createElement('div');
          wrap.className = 'chatassist-phone-field';
          wrap.appendChild(inputEl);
          appendTarget = wrap;
        } else {
          inputEl = document.createElement('input');
          inputEl.type = field.field_type === 'email' ? 'email' : 'text';
          appendTarget = inputEl;
        }
        inputEl.placeholder = (field.label || field.name || '') + (field.required ? ' *' : '');
        var prefillValue = null;
        if (state.status === 'filled' && state.data && state.data[field.name] != null) {
          prefillValue = state.data[field.name];
          inputEl.value = prefillValue;
        }
        if (field.field_type === 'phone') {
          enhancePhoneField(appendTarget, inputEl, prefillValue, field.required);
        }
        inputs[field.name] = inputEl;
        form.appendChild(appendTarget);
      });

      const statusEl = document.createElement('div');
      statusEl.className = 'chatassist-contact-card-status';

      const submitBtn = document.createElement('button');
      submitBtn.type = 'button';
      submitBtn.className = 'chatassist-contact-card-submit';
      const submitBtnLabel = document.createElement('span');
      submitBtnLabel.className = 'chatassist-contact-card-submit-label';
      submitBtnLabel.textContent = submitLabel || 'Send';
      const submitBtnIcon = document.createElement('span');
      submitBtnIcon.className = 'chatassist-contact-card-submit-icon';
      submitBtnIcon.innerHTML = SEND_ICON_SVG;
      submitBtn.appendChild(submitBtnLabel);
      submitBtn.appendChild(submitBtnIcon);

      if (state.status === 'filled') {
        Object.keys(inputs).forEach(function (k) { inputs[k].disabled = true; });
        submitBtn.style.display = 'none';
        statusEl.textContent = 'Submitted — thank you!';
      } else if (state.status === 'expired') {
        Object.keys(inputs).forEach(function (k) { inputs[k].disabled = true; });
        submitBtn.style.display = 'none';
        statusEl.className = 'chatassist-contact-card-expired';
        statusEl.textContent = 'This form has expired. Ask the agent to resend it.';
      } else {
        _pendingContactCards[messageId] = { inputs: inputs, submitBtn: submitBtn, statusEl: statusEl };
        submitBtn.addEventListener('click', function () {
          const data = {};
          for (var i = 0; i < fields.length; i++) {
            var field = fields[i];
            var el = inputs[field.name];
            var value = (el.value || '').trim();
            if (field.required && !value) {
              statusEl.textContent = 'Please fill "' + (field.label || field.name) + '".';
              el.focus();
              return;
            }
            if (field.field_type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
              statusEl.textContent = 'Please enter a valid email address.';
              el.focus();
              return;
            }
            if (field.field_type === 'phone' && value) {
              const phoneErr = validatePhoneValue(el, value);
              if (phoneErr) {
                statusEl.textContent = phoneErr;
                el.focus();
                return;
              }
              value = composePhoneValue(el, value);
            }
            if (value) data[field.name] = value;
          }
          submitBtn.disabled = true;
          // Fires immediately on click, independent of network latency — the
          // icon slides out to the right as its own little "sent!" cue while
          // the real request is still in flight (see .chatassist-sending in
          // chat-widget.css).
          submitBtn.classList.add('chatassist-sending');
          statusEl.textContent = 'Sending…';
          fetch(CONFIG.apiUrl + '/websites/' + encodeURIComponent(CONFIG.websiteId) + '/forms/' + encodeURIComponent(formId) + '/submissions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: data, conversation_id: CONFIG.conversationId || undefined, session_id: CONFIG.sessionId, message_id: messageId }),
          })
            .then(function (r) {
              if (r.status === 409) throw new Error('expired');
              if (!r.ok) throw new Error('submit failed');
              return r.json();
            })
            .then(function () {
              delete _pendingContactCards[messageId];
              Object.keys(inputs).forEach(function (k) { inputs[k].disabled = true; });
              submitBtn.style.display = 'none';
              statusEl.textContent = 'Submitted — thank you!';
            })
            .catch(function (err) {
              if (err && err.message === 'expired') {
                _expireContactCard(messageId);
                return;
              }
              submitBtn.disabled = false;
              submitBtn.classList.remove('chatassist-sending');
              statusEl.textContent = 'Something went wrong. Please try again.';
            });
        });
      }

      form.appendChild(submitBtn);
      form.appendChild(statusEl);
      contentWrap.appendChild(form);
    }

    row.appendChild(avatar);
    row.appendChild(contentWrap);
    messageDiv.appendChild(row);
    container.appendChild(messageDiv);

    isAtBottom = true;
    smartScroll();
  }

  function sendBotButtonClick(automationId, buttonPath) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      showToast('Not connected. Please wait...');
      return;
    }
    ws.send(JSON.stringify({
      type: 'bot_button_click',
      automation_id: automationId,
      button_path: buttonPath,
    }));
    // Button click counts as a visitor action — re-enable the end button
    // in case it was hidden after a previous "End chat".
    if (endChatDisabled) {
      setEndChatDisabled(false);
    }
  }

  function showSystemMessage(content) {
    const container = $id('chatassist-messages');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'chatassist-message chatassist-message-system';
    div.textContent = content;
    container.appendChild(div);
    smartScroll();
  }

  function showJoinMessage(content, createdAtIso) {
    const container = $id('chatassist-messages');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'chatassist-message chatassist-message-join';
    div.textContent = `${content} ${formatTimestamp(createdAtIso ? new Date(createdAtIso) : new Date())}`;
    container.appendChild(div);
    smartScroll();
  }

  // --- Event Handlers ---

  function handleUserMessage() {
    const input = $id('chatassist-input');
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
      saveDraft('');
      saveDraftAttachments([]);
      draftAttachments = [];
      renderAttachmentChips();
      sendMessage(outgoing, meta);
      isAtBottom = true;
      smartScroll();
      return;
    }

    // Check if contact info is already on file (in-memory or localStorage 12h).
    if (_checkAndSendContactSilently()) {
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
      saveDraft('');
      saveDraftAttachments([]);
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

  // Show the legacy hardcoded contact overlay. If forceEmpty is true the
  // input fields will be cleared (used for offline automation prompts).
  function showContactOverlay(forceEmpty) {
    const el = $id('chatassist-contact-overlay');
    if (!el) return;

    // Show pending message preview so visitor knows their message is safe.
    const preview = $id('chatassist-contact-msg-preview');
    if (preview) {
      var _previewText = null;
      if (pendingOfflineMessage) {
        _previewText = pendingOfflineMessage.length > 120
          ? pendingOfflineMessage.slice(0, 120) + '…'
          : pendingOfflineMessage;
      } else if (pendingBotButtonClick && pendingBotButtonClick.label) {
        _previewText = pendingBotButtonClick.label;
      }
      if (_previewText) {
        preview.textContent = '“' + _previewText + '”';
        preview.style.display = 'block';
      } else {
        preview.style.display = 'none';
      }
    }

    // Always use the legacy hardcoded fields in the overlay (name, phone, email).
    // Do not replace the form markup with dynamic website forms here.
    try {
      const panel = el.querySelector('.chatassist-contact-overlay-panel');
      if (panel) {
        const titleEl = panel.querySelector('.chatassist-contact-overlay-title');
        const subtitleEl = panel.querySelector('.chatassist-contact-overlay-subtitle');
        if (titleEl) titleEl.textContent = "We'll reach out to you shortly";
        if (subtitleEl) subtitleEl.textContent = panel.querySelector('#chatassist-contact-msg-preview')?.style.display === 'block' ? subtitleEl.textContent : (subtitleEl.textContent || 'We are currently offline.\nKindly share your contact details with us and our workspace expert will get in touch with you soon!');
      }
    } catch (e) { }

    // If requested, clear the legacy input values so the visitor sees an empty form.
    try {
      if (forceEmpty) {
        const nameEl = $id('chatassist-contact-name');
        const phoneEl = $id('chatassist-contact-phone');
        const emailEl = $id('chatassist-contact-email');
        if (nameEl) nameEl.value = '';
        if (phoneEl) phoneEl.value = '';
        if (emailEl) emailEl.value = '';
      }
    } catch (e) { }

    // CC1: the offline gate's extra-fields extension. The 3 hardcoded fields
    // above are untouched — this only appends whatever additional fields the
    // website's contact-card form defines beyond ones literally *named*
    // name/email/phone (matched by name, not field_type — a differently
    // named field that happens to also be an email/phone type, e.g.
    // "emails", is its own distinct field with its own required flag, not an
    // alias for the always-optional hardcoded email input).
    try {
      const extraWrap = $id('chatassist-contact-form-extra');
      if (extraWrap) {
        extraWrap.innerHTML = '';
        // Re-fetch on every open, not just once at page load — the
        // contact-card form (required flags, field list) can change while a
        // visitor sits on the page, and this overlay can show long after init.
        _loadContactCardForm().then(function () {
          if (!extraWrap.isConnected) return;
          extraWrap.innerHTML = '';
          _applyHardcodedFieldRequiredness();
          const extraFields = ((_contactCardForm && _contactCardForm.fields) || []).filter(function (f) {
            return f && f.name !== 'name' && f.name !== 'email' && f.name !== 'phone';
          });
          extraFields.forEach(function (field) {
            var inputEl;
            var appendTarget;
            if (field.field_type === 'textarea') {
              inputEl = document.createElement('textarea');
              inputEl.rows = 2;
              appendTarget = inputEl;
            } else if (field.field_type === 'select') {
              inputEl = document.createElement('select');
              (field.options || []).forEach(function (opt) {
                const o = document.createElement('option');
                o.value = opt;
                o.textContent = opt;
                inputEl.appendChild(o);
              });
              appendTarget = inputEl;
            } else if (field.field_type === 'phone') {
              inputEl = document.createElement('input');
              inputEl.type = 'tel';
              appendTarget = document.createElement('div');
              appendTarget.className = 'chatassist-phone-field';
              appendTarget.appendChild(inputEl);
            } else {
              inputEl = document.createElement('input');
              inputEl.type = field.field_type === 'email' ? 'email' : 'text';
              appendTarget = inputEl;
            }
            inputEl.id = 'chatassist-contact-extra-' + field.name;
            inputEl.setAttribute('data-extra-field', field.name);
            inputEl.setAttribute('data-extra-field-type', field.field_type || 'text');
            inputEl.setAttribute('data-extra-required', field.required ? '1' : '');
            inputEl.placeholder = (field.label || field.name) + (field.required ? ' *' : '');
            if (field.field_type === 'phone') enhancePhoneField(appendTarget, inputEl, null, field.required);
            extraWrap.appendChild(appendTarget);
          });
        });
      }
    } catch (e) { }

    el.style.display = 'flex';
    el.classList.add('chatassist-contact-overlay-visible');
    // Reset touched state each time the form opens so applyPresence() can
    // auto-dismiss if agents come online before the visitor starts typing.
    _contactFormTouched = false;
    if (!el._touchHandlerAttached) {
      el.addEventListener('input', function () { _contactFormTouched = true; });
      el._touchHandlerAttached = true;
    }
    // Focus first input (name field)
    const firstField = $id('chatassist-contact-name');
    try { firstField && firstField.focus(); } catch (e) { }
    _updateWaitingForAgentIndicator();
  }

  function hideContactOverlay(restore) {
    const el = $id('chatassist-contact-overlay');
    if (!el) return;
    // Only act if the overlay is actually visible; prevents clearing the input
    // when applyPresence() calls hideContactOverlay(false) on every presence tick.
    const wasVisible = el.style.display !== 'none' && el.classList.contains('chatassist-contact-overlay-visible');
    el.classList.remove('chatassist-contact-overlay-visible');
    el.style.display = 'none';
    if (!wasVisible) return;
    if (restore) {
      // User explicitly dismissed the overlay — discard any deferred button click
      // so it doesn't fire unexpectedly on the next offline form submission.
      pendingBotButtonClick = null;
      _forceContactOverlay = false;
      const input = $id('chatassist-input');
      if (input && pendingOfflineMessage != null) input.value = pendingOfflineMessage;
      if (pendingOfflineAttachments && pendingOfflineAttachments.length) {
        draftAttachments = pendingOfflineAttachments.slice();
        renderAttachmentChips();
      }
    } else {
      // Clear the input after successful submit.
      const input = $id('chatassist-input');
      if (input) input.value = '';
    }
    _updateWaitingForAgentIndicator();
  }

  function showEndOverlay() {
    const el = $id('chatassist-end-overlay');
    if (el) {
      el.style.display = 'flex';
      el.classList.add('chatassist-end-overlay-visible');
    }
  }

  function hideEndOverlay() {
    const el = $id('chatassist-end-overlay');
    if (el) {
      el.classList.remove('chatassist-end-overlay-visible');
      el.style.display = 'none';
    }
  }

  function submitContactAndSendPending() {
    const nameEl = $id('chatassist-contact-name');
    const name = nameEl?.value.trim();
    const phoneEl = $id('chatassist-contact-phone');
    const phoneRaw = phoneEl?.value.trim();
    const emailEl = $id('chatassist-contact-email');
    const email = emailEl?.value.trim();

    // Required-ness follows the contact-card form's own field config when it
    // defines a field literally named name/phone/email (see
    // _applyHardcodedFieldRequiredness) — absent that attribute (form not
    // loaded yet, or no contact-card form configured), fall back to the
    // historical defaults: name and phone required, email optional.
    const nameRequired = nameEl?.getAttribute('data-required') !== '0';
    const phoneRequired = phoneEl?.getAttribute('data-required') !== '0';
    const emailRequired = emailEl?.getAttribute('data-required') === '1';

    if (nameRequired && !name) {
      showToast('Please enter your name.');
      nameEl?.focus();
      return;
    }
    if (phoneRequired && !phoneRaw) {
      showToast('Please enter your phone number.');
      phoneEl?.focus();
      return;
    }
    let phone = '';
    if (phoneRaw) {
      const phoneErr = validatePhoneValue(phoneEl, phoneRaw);
      if (phoneErr) {
        showToast(phoneErr);
        phoneEl?.focus();
        return;
      }
      phone = composePhoneValue(phoneEl, phoneRaw);
    }
    if (emailRequired && !email) {
      showToast('Please enter your email.');
      emailEl?.focus();
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast('Please enter a valid email address.');
      emailEl?.focus();
      return;
    }

    // CC1: validate + collect the offline gate's extra fields, if any are configured.
    const extraData = {};
    const extraWrap = $id('chatassist-contact-form-extra');
    if (extraWrap) {
      const extraEls = Array.from(extraWrap.querySelectorAll('[data-extra-field]'));
      for (var i = 0; i < extraEls.length; i++) {
        var extraEl = extraEls[i];
        var extraValue = (extraEl.value || '').trim();
        var extraFieldType = extraEl.getAttribute('data-extra-field-type');
        if (extraEl.getAttribute('data-extra-required') === '1' && !extraValue) {
          showToast('Please fill "' + (extraEl.placeholder || extraEl.getAttribute('data-extra-field')) + '".');
          extraEl.focus();
          return;
        }
        if (extraValue && extraFieldType === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(extraValue)) {
          showToast('Please enter a valid email address.');
          extraEl.focus();
          return;
        }
        if (extraValue && extraFieldType === 'phone') {
          var extraPhoneErr = validatePhoneValue(extraEl, extraValue);
          if (extraPhoneErr) {
            showToast(extraPhoneErr);
            extraEl.focus();
            return;
          }
          extraValue = composePhoneValue(extraEl, extraValue);
        }
        if (extraValue) extraData[extraEl.getAttribute('data-extra-field')] = extraValue;
      }
    }

    const visitorName = name;
    const visitorPhone = phone;
    const visitorEmail = email;

    const msg = pendingOfflineMessage;
    const atts = Array.isArray(pendingOfflineAttachments) ? pendingOfflineAttachments.slice() : [];
    pendingOfflineMessage = null;
    pendingOfflineAttachments = [];
    _forceContactOverlay = false;
    hideContactOverlay(false);
    try {
      if (visitorName) localStorage.setItem(`ai_chatassist_contact_name_${CONFIG.websiteId}`, visitorName);
      if (visitorPhone) localStorage.setItem(`ai_chatassist_contact_phone_${CONFIG.websiteId}`, visitorPhone);
      if (visitorEmail) localStorage.setItem(`ai_chatassist_contact_email_${CONFIG.websiteId}`, visitorEmail);
    } catch (e) { }
    // Persist to the 12h verified cache and mark in-memory for this conversation.
    _saveContactVerified(visitorName, visitorPhone, visitorEmail || '');
    _contactVerifiedThisConversation = true;

    if (msg || (atts && atts.length)) {
      const meta = { visitor_name: visitorName, visitor_phone: visitorPhone, visitor_email: visitorEmail || undefined };
      try {
        meta._client_message_id = (window.crypto && window.crypto.randomUUID)
          ? window.crypto.randomUUID()
          : `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      } catch (e) { }
      const outgoing = serializeMessageWithAttachments(msg, atts);
      appendMessage('visitor', outgoing, new Date().toISOString(), meta, null);
      sendMessage(outgoing, meta);
      smartScroll();
    } else {
      // No pending message (overlay shown via bot_offline before visitor typed).
      // Send a contact-only frame so the backend stores the visitor details.
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'visitor_contact',
          visitor_name: visitorName,
          visitor_phone: visitorPhone,
          visitor_email: visitorEmail || undefined,
        }));
      }
      // The offline automation message told the visitor they can leave additional
      // details — open the input now so they actually can.
      showInputContainer();
    }

    // CC1: submit to the same contact-card form so the extra fields (if any)
    // land in the "Form submissions" panel too. Must include name/email/phone
    // from the hardcoded fields as well — the form's own required-field
    // validation runs against its full field list, and those are typically
    // required there even though this overlay collects them separately.
    if (_contactCardForm && _contactCardForm.id) {
      // Matched by name (not field_type) to mirror the extraFields filter
      // above — a field named e.g. "emails" already has its own collected
      // value in extraData and must not be clobbered by the hardcoded
      // (always-optional) email input just because both happen to be type "email".
      const fullData = Object.assign({}, extraData);
      (_contactCardForm.fields || []).forEach(function (field) {
        if (field.name === 'name' && visitorName) fullData.name = visitorName;
        else if (field.name === 'phone' && visitorPhone) fullData.phone = visitorPhone;
        else if (field.name === 'email' && visitorEmail) fullData.email = visitorEmail;
      });
      fetch(`${CONFIG.apiUrl}/websites/${CONFIG.websiteId}/forms/${_contactCardForm.id}/submissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: fullData,
          conversation_id: CONFIG.conversationId || undefined,
          session_id: CONFIG.sessionId,
        }),
      }).catch(function () { /* best-effort — offline gate's own send already succeeded */ });
    }

    // If a bot button click was deferred waiting for contact, fire it now.
    if (pendingBotButtonClick) {
      const pbc = pendingBotButtonClick;
      pendingBotButtonClick = null;
      // Disable and highlight the deferred button now that the click is committed.
      if (pbc._allBtns) {
        pbc._allBtns.forEach(function (b) {
          b.disabled = true;
          b.classList.add('chatassist-prompt-btn-disabled');
        });
      }
      if (pbc._btnEl) pbc._btnEl.classList.add('chatassist-prompt-btn-selected');
      clearTimeout(_inputRevealTimer);
      _inputRevealTimer = setTimeout(showInputContainer, 5000);
      appendMessage('visitor', pbc.label, new Date().toISOString(), null, null);
      isAtBottom = true;
      smartScroll();
      sendBotButtonClick(pbc.automationId, pbc.buttonPath);
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
            <div class="chatassist-popup-name" id="chatassist-popup-name">${CONFIG.popupName}</div>
            <button class="chatassist-popup-close" id="chatassist-popup-close" type="button">&times;</button>
          </div>
          <div class="chatassist-popup-body" id="chatassist-popup-body"></div>
          <button class="chatassist-popup-reply" id="chatassist-popup-reply" type="button">
            <svg width="1.2em" height="1.2em" viewBox="0 0 209 209" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" fill-rule="evenodd" clip-rule="evenodd" stroke-linecap="round" stroke-linejoin="round"><path d="M177.954,104.163l-110.066,-0m110.066,-0l-138.95,69.4l28.884,-69.4l-28.884,-69.584l138.95,69.584Z" style="fill:none;fill-rule:nonzero;stroke:currentColor;stroke-width:17.38px;"></path></svg>
            ${CONFIG.popupButtonText}
          </button>
        </div>
        <div id="chatassist-bubble-pill">
          <span id="chatassist-bubble-text">${CONFIG.bubbleText}</span>
          <span class="chatassist-bubble-icon" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="currentColor" preserveAspectRatio="xMidYMid meet" width="24" height="24"><path d="M63.113,18.51v-.16C60.323,7.05,44.582,3,31.972,3S3.582,7,.792,18.5a66.22,66.22,0,0,0,0,20.46c1.18,4.74,5.05,8.63,11.36,11.41l-4,5A3.47,3.47,0,0,0,10.882,61a3.39,3.39,0,0,0,1.44-.31L26.862,54c1.79.18,3.49.27,5.07.27,11.04.04,28.41-4.04,31.18-15.43a60.33,60.33,0,0,0,0-20.33Z"></path></svg>
          </span>
          <span id="chatassist-bubble-unread" style="display:none;"></span>
          <div id="chatassist-bubble-online-dot"></div>
        </div>
      </div>
      <div id="chatassist-window" style="display: none;">
        <div id="chatassist-contact-overlay" class="chatassist-contact-overlay">
          <div class="chatassist-contact-overlay-backdrop"></div>
          <div class="chatassist-contact-overlay-panel">
            <div class="chatassist-contact-overlay-header">
              <div class="chatassist-contact-overlay-title">We'll reach out to you shortly</div>
              <button id="chatassist-contact-overlay-close" class="chatassist-contact-overlay-close">&times;</button>
            </div>
            <div class="chatassist-contact-overlay-subtitle">We are currently offline.\nKindly share your contact details with us and our workspace expert will get in touch with you soon!</div>
            <div id="chatassist-contact-msg-preview" class="chatassist-contact-msg-preview" style="display:none;"></div>
            <div class="chatassist-contact-form">
              <input type="text" id="chatassist-contact-name" placeholder="Your name *" autocomplete="name" />
              <div id="chatassist-contact-phone-wrap" class="chatassist-phone-field">
                <input type="tel" id="chatassist-contact-phone" placeholder="Your phone number *" autocomplete="tel" maxlength="15" />
              </div>
              <input type="email" id="chatassist-contact-email" placeholder="Your email (optional)" autocomplete="email" />
            </div>
            <div id="chatassist-contact-form-extra" class="chatassist-contact-form"></div>
            <div class="chatassist-contact-overlay-actions">
              <button id="chatassist-contact-overlay-submit" class="chatassist-contact-overlay-submit"><span>Send message</span>${SEND_ICON_SVG}</button>
            </div>
          </div>
        </div>
        <div id="chatassist-end-overlay" class="chatassist-end-overlay" style="display:none;">
          <div class="chatassist-end-overlay-backdrop"></div>
          <div class="chatassist-end-overlay-panel">
            <div class="chatassist-end-overlay-title">End this chat?</div>
            <div class="chatassist-end-overlay-desc">By ending this conversation you won&rsquo;t be able to continue it later.</div>
            <div class="chatassist-end-overlay-actions">
              <button id="chatassist-end-confirm" class="chatassist-end-overlay-confirm">End chat</button>
              <button id="chatassist-end-cancel" class="chatassist-end-overlay-cancel">Minimize</button>
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
            <div id="chatassist-rating-feedback-section" style="display:none;">
              <textarea id="chatassist-rating-feedback" class="chatassist-rating-feedback" placeholder="Tell us more (optional)..." rows="3"></textarea>
              <button id="chatassist-rating-submit" class="chatassist-rating-submit">Submit</button>
            </div>
            <div id="chatassist-rating-thanks" class="chatassist-rating-thanks" style="display:none;">
              Thank you for your feedback!
            </div>
          </div>
        </div>
        <div id="chatassist-header">
          <button id="chatassist-back" class="chatassist-header-btn" aria-label="Go back" style="display:none;" title="Go back">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </button>
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
            <button id="chatassist-end" class="chatassist-header-btn chatassist-end-btn" aria-label="End chat" title="End chat">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
            <button id="chatassist-minimize" class="chatassist-header-btn" aria-label="Minimize chat" title="Minimize">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
            </button>
          </div>
        </div>
        <div id="chatassist-messages"></div>
        <div id="chatassist-conv-list" class="chatassist-conv-list" style="display:none;">
          <div id="chatassist-conv-list-body" class="chatassist-conv-list-body"></div>
        </div>
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
          <div id="chatassist-input-container" style="display:none;">
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
            <textarea id="chatassist-input" placeholder="Type your message..." rows="1" autocomplete="off"></textarea>
            <button id="chatassist-send" aria-label="Send message">${SEND_ICON_SVG}</button>
            </div>
          </div>
          <div id="chatassist-branding">${CONFIG.brandingText}</div>
        </div>
      </div>
      <div id="chatassist-toast-container" style="display:none;"></div>
    `;
    // Attach a Shadow DOM so widget CSS is fully isolated from the host page.
    // The host is a plain block element; the widget's own CSS handles all positioning.
    const __host = document.createElement('div');
    __host.style.cssText = 'display:block;margin:0;padding:0;border:0;';
    document.body.appendChild(__host);
    __shadow = __host.attachShadow({ mode: 'open' });

    // Inject the widget stylesheet into the shadow root.
    try {
      const src = scriptElement && scriptElement.src ? scriptElement.src : '';
      const cssUrl = src ? src.replace(/chat-widget\.js(\?.*)?$/, 'chat-widget.css') : null;
      if (cssUrl) {
        const cssLink = document.createElement('link');
        cssLink.rel = 'stylesheet';
        cssLink.href = cssUrl;
        __shadow.appendChild(cssLink);
      }
    } catch (e) {}

    __shadow.appendChild(container);
    setTimeout(() => container.classList.add('chatassist-visible'), 100);

    // Event Listeners
    const bubble = $id('chatassist-bubble');
    const win = $id('chatassist-window');
    const input = $id('chatassist-input');

    // Expose closeWidget to outer-scope callers (hideRatingOverlay, WS handlers).
    // closeWidget is hoisted but captures win/bubble from this scope, so it must
    // be assigned here after those locals exist.
    _closeWidgetFn = closeWidget;

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
      const canFocusInput = input
        && input.offsetParent !== null
        && viewMode !== 'list'
        && !isReadOnlyThread;
      if (canFocusInput) {
        input.focus();
        autoResizeInput(); // re-measure now the window is visible
      }
      isAtBottom = true;
      hideNewMsgIndicator();
      setTimeout(function () { scrollToBottom(false); }, 50);
      if (endChatDisabled) setEndChatDisabled(true);
      // Persist open state (with timestamp for 12h TTL)
      try { localStorage.setItem('ai_chatassist_widget_open_' + CONFIG.websiteId, JSON.stringify({v:1, ts:Date.now()})); } catch (e) { }
      // Notify backend that widget was opened (triggers welcome if not yet sent)
      try {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'widget_opened' }));
        }
      } catch (e) { }
    }

    function closeWidget(restoreOverlay) {
      win.classList.add('chatassist-window-closing');
      win.addEventListener('animationend', function onEnd() {
        win.removeEventListener('animationend', onEnd);
        win.classList.remove('chatassist-window-closing');
        win.style.display = 'none';
        bubble.style.display = 'inline-flex';
      }, { once: true });
      // Persist minimized state (clear timestamp so it won't restore)
      try { localStorage.setItem('ai_chatassist_widget_open_' + CONFIG.websiteId, JSON.stringify({v:1, ts:0})); } catch (e) { }
      if (restoreOverlay) hideContactOverlay(true);
      hideEndOverlay();
    }

    bubble.addEventListener('click', openWidget);

    $id('chatassist-minimize').addEventListener('click', () => {
      closeWidget(true);
    });

    $id('chatassist-back').addEventListener('click', () => {
      goBack();
    });

    $id('chatassist-end').addEventListener('click', () => {
      showEndOverlay();
    });

    $id('chatassist-end-cancel').addEventListener('click', () => {
      hideEndOverlay();
      closeWidget(true);
    });

    $id('chatassist-new-msg-indicator').addEventListener('click', () => {
      hideNewMsgIndicator();
      scrollToBottom(true);
      markRead();
    });

    $id('chatassist-end-confirm').addEventListener('click', () => {
      hideEndOverlay();
      try {
        const ok = sendEndChat();
        if (ok) setEndChatDisabled(true);
      } catch (e) { }
      // Mark that visitor intentionally ended so the rating overlay minimises on dismiss.
      ratingTriggeredByVisitorEnd = true;

      // If visitor already rated this conversation, skip the overlay entirely.
      if (hasRatedSession) {
        ratingTriggeredByVisitorEnd = false;
        afterConversationClose();
        if (_closeWidgetFn) setTimeout(function () { _closeWidgetFn(false); }, 200);
        return;
      }

      // Let the backend automation deliver the system message + show_rating_popup
      // (via "Visitor ended chat" automation: emit_system_event → wait 2s → show_rating_popup).
      // Fallback: if backend never delivers show_rating_popup within 6s, show it ourselves.
      _awaitingRatingAfterResolve = true;
      clearTimeout(_resolveRatingTimeout);
      _resolveRatingTimeout = setTimeout(function () {
        if (_awaitingRatingAfterResolve) {
          _awaitingRatingAfterResolve = false;
          showRatingOverlay(CONFIG.conversationId || null);
        }
      }, 6000);
    });

    // Rating overlay buttons
    $id('chatassist-rating-close').addEventListener('click', () => {
      pendingRatingValue = null;
      hideRatingOverlay();
    });
    $qsAll('.chatassist-rating-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $qsAll('.chatassist-rating-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        pendingRatingValue = parseInt(btn.getAttribute('data-rating'), 10);
        // Show feedback textarea
        const fbSection = $id('chatassist-rating-feedback-section');
        if (fbSection) fbSection.style.display = 'block';
        const fbInput = $id('chatassist-rating-feedback');
        if (fbInput) { fbInput.value = ''; setTimeout(function(){ fbInput.focus(); }, 50); }
      });
    });
    $id('chatassist-rating-submit').addEventListener('click', () => {
      if (pendingRatingValue === null) return;
      const feedback = ($id('chatassist-rating-feedback').value || '').trim();
      const v = pendingRatingValue;
      pendingRatingValue = null;
      submitRating(v, feedback);
    });

    $id('chatassist-contact-overlay-close').addEventListener('click', () => hideContactOverlay(true));
    $id('chatassist-contact-overlay-submit').addEventListener('click', submitContactAndSendPending);
    $id('chatassist-send').addEventListener('click', handleUserMessage);

    // Popup notification buttons
    $id('chatassist-popup-close').addEventListener('click', function (e) {
      e.stopPropagation();
      hideMessagePopup();
      // Record dismissal time so we don't re-show the welcome popup for 12h.
      _saveWelcomePopupDismissed();
    });
    $id('chatassist-popup-reply').addEventListener('click', function (e) {
      e.stopPropagation();
      hideMessagePopup(true);
      openWidget();
    });

    if (CONFIG.showAttachments) {
      const fileInput = $id('chatassist-file');
      const attachBtn = $id('chatassist-attach');

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
      updateSendButtonState();
      // Persist draft for the current conversation so it survives navigation
      if (!isReadOnlyThread) saveDraft(input.value || '');
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

    const messagesContainer = $id('chatassist-messages');
    if (messagesContainer) {
      messagesContainer.addEventListener('scroll', handleMessagesScroll);
      // Prevent wheel events from reaching the host page when the message list
      // is already at its scroll boundary (complements overscroll-behavior:contain
      // for browsers that don't support it).
      messagesContainer.addEventListener('wheel', function(e) {
        const el = messagesContainer;
        const atTop = el.scrollTop === 0;
        const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
        // Only stop propagation when scrolling would otherwise bubble out.
        if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) {
          e.preventDefault();
        }
        e.stopPropagation();
      }, { passive: false });
    }

    // Prefill
    try {
      const name = localStorage.getItem(`ai_chatassist_contact_name_${CONFIG.websiteId}`);
      const phone = localStorage.getItem(`ai_chatassist_contact_phone_${CONFIG.websiteId}`);
      const email = localStorage.getItem(`ai_chatassist_contact_email_${CONFIG.websiteId}`);
      if (name) $id('chatassist-contact-name').value = name;
      if (email) $id('chatassist-contact-email').value = email;
      enhancePhoneField($id('chatassist-contact-phone-wrap'), $id('chatassist-contact-phone'), phone, true);
    } catch (e) { }

    refreshHeaderIcon();
    renderAttachmentChips();
    updateEmptyState();

    // Arm notification sound on first user gesture (must happen early).
    armSoundOnFirstGesture();
  }

  function autoResizeInput() {
    const input = $id('chatassist-input');
    if (!input) return;
    updateSendButtonState();
    // Bail when the chat window is hidden: scrollHeight is 0 inside display:none,
    // which would set inline height:0px and cause the cursor to render at the top
    // corner of the textarea the next time the window is opened.
    if (!isWidgetOpen()) return;
    input.style.height = 'auto';
    const maxH = 100; // max ~4 lines
    const h = input.scrollHeight;
    input.style.height = Math.min(h, maxH) + 'px';
    input.style.overflowY = h > maxH ? 'auto' : 'hidden';
  }

  function updateEmptyState() {
    const emptyEl = $id('chatassist-empty-state');
    if (!emptyEl) return;
    const container = $id('chatassist-messages');
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
    const titleEl = $qs('.chatassist-header-title');
    const statusTextEl = $qs('.chatassist-online-text');
    if (!titleEl || !statusTextEl) return;

    const count = presence.available_agents_count ?? (presence.agents?.length || 0);
    presenceOnline = count > 0;
    // Dismiss the contact overlay when the website comes back online, unless
    // the visitor has already started filling the form (closing mid-input
    // would discard their work). _forceContactOverlay is also cleared here:
    // if agents are online again, the team-level offline reason is gone.
    if (presenceOnline && !_contactFormTouched) {
      _forceContactOverlay = false;
      hideContactOverlay(false);
    }

    // Update bubble online dot
    const bubbleDot = $id('chatassist-bubble-online-dot');
    if (bubbleDot) bubbleDot.classList.toggle('chatassist-dot-online', presenceOnline);

    // Update header online dot
    const headerDot = $qs('.chatassist-online-dot');
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
      id = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
      localStorage.setItem(key, id);
    }
    return id;
  }

  function _applyThemeStyles() {
    try {
      const widget = $id('chatassist-widget');
      const pos = CONFIG.position.replace('bottom-', 'b-').replace('top-', 't-').replace('left', 'l').replace('right', 'r');
      widget.className = `chatassist-position-${pos} chatassist-theme-${CONFIG.theme}`;
      const themeBackground = CONFIG.colorMode === 'gradient'
        ? `linear-gradient(135deg, ${CONFIG.gradientStart} 0%, ${CONFIG.gradientEnd} 100%)`
        : CONFIG.primaryColor;
      const pillEl = $id('chatassist-bubble-pill');
      if (pillEl) pillEl.style.background = themeBackground;
      $id('chatassist-header').style.background = themeBackground;
      $id('chatassist-send').style.background = themeBackground;
      const replyBtn = $id('chatassist-popup-reply');
      if (replyBtn) replyBtn.style.background = themeBackground;
      const contactSubmit = $qs('.chatassist-contact-overlay-submit');
      if (contactSubmit) contactSubmit.style.background = themeBackground;
      let themeStyle = $id('chatassist-theme-style');
      if (!themeStyle) {
        themeStyle = document.createElement('style');
        themeStyle.id = 'chatassist-theme-style';
        (__shadow || document.head).appendChild(themeStyle);
      }
      themeStyle.textContent = `.chatassist-message-visitor .chatassist-message-bubble { background: ${themeBackground} !important; }
.chatassist-prompt-btn { border-color: ${CONFIG.primaryColor} !important; color: ${CONFIG.primaryColor} !important; }
.chatassist-prompt-btn:hover:not(:disabled) { background: ${CONFIG.primaryColor} !important; color: #fff !important; }
.chatassist-prompt-btn:active:not(:disabled) { background: ${CONFIG.primaryColor} !important; border-color: ${CONFIG.primaryColor} !important; color: #fff !important; }
.chatassist-prompt-btn-selected { background: ${CONFIG.primaryColor} !important; color: #fff !important; border-color: ${CONFIG.primaryColor} !important; }
.chatassist-conv-new-btn { border-color: ${CONFIG.primaryColor} !important; color: ${CONFIG.primaryColor} !important; }
.chatassist-conv-new-btn:hover { background: ${CONFIG.primaryColor} !important; color: #fff !important; }
.chatassist-contact-card-submit { background: ${CONFIG.primaryColor} !important; }`;
    } catch (e) { }
  }

  async function init() {
    CONFIG.sessionId = getSessionId();
    try {
      createWidget();

      // Restore end-chat disabled state (per session) before wiring events.
      hydrateEndChatDisabled();

      // Apply config styles immediately to avoid flicker/jump on reload.
      _applyThemeStyles();

      // Sync widget theme with host page theme changes.
      // Detects `html.dark` / `body.dark` and `prefers-color-scheme` changes and reapplies theme.
      (function setupHostThemeSync() {
        function detectHostTheme() {
          try {
            const htmlDark = document.documentElement && document.documentElement.classList && document.documentElement.classList.contains('dark');
            const bodyDark = document.body && document.body.classList && document.body.classList.contains('dark');
            const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            return (htmlDark || bodyDark || prefersDark) ? 'dark' : 'light';
          } catch (e) {
            return CONFIG.theme || 'dark';
          }
        }

        function applyHostThemeIfDifferent() {
          const hostTheme = detectHostTheme();
          if (!hostTheme) return;
          // Respect explicit dashboard setting: if the widget theme was
          // explicitly set to 'dark' or 'light' on the website config, do
          // not override it with the host page. Only apply host-page
          // syncing when the widget theme is 'auto' / 'system' / empty.
          try {
            const current = String(CONFIG.theme || '').toLowerCase();
            if (current === 'auto' || current === 'system' || current === '') {
              if (current !== hostTheme) {
                CONFIG.theme = hostTheme;
                _applyThemeStyles();
              }
            }
          } catch (e) {
            // Fallback: do nothing if anything goes wrong
          }
        }

        // Initial sync
        try { applyHostThemeIfDifferent(); } catch (e) { }

        // Observe class changes on <html> and <body>
        try {
          const mo = new MutationObserver((mutations) => {
            for (const m of mutations) {
              if (m.attributeName === 'class') { applyHostThemeIfDifferent(); break; }
            }
          });
          if (document.documentElement) mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
          if (document.body) mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        } catch (e) { }

        // Listen for prefers-color-scheme changes
        try {
          if (window.matchMedia) {
            const mm = window.matchMedia('(prefers-color-scheme: dark)');
            if (mm.addEventListener) mm.addEventListener('change', applyHostThemeIfDifferent);
            else if (mm.addListener) mm.addListener(applyHostThemeIfDifferent);
          }
        } catch (e) { }

        // Storage event (demo uses localStorage demo_dark_mode)
        try {
          window.addEventListener('storage', (e) => {
            if (!e) return;
            if (e.key === 'demo_dark_mode') applyHostThemeIfDifferent();
          });
        } catch (e) { }
      })();

      // Set popup avatar to headerIconUrl if configured.
      if (CONFIG.headerIconUrl) {
        const avatarWrap = $id('chatassist-popup-avatar-wrap');
        if (avatarWrap) {
          const url = getFullAssetUrl(CONFIG.headerIconUrl);
          if (url) {
            avatarWrap.className = 'chatassist-popup-avatar';
            avatarWrap.innerHTML = '';
            var img = document.createElement('img');
            img.src = url;
            img.alt = CONFIG.popupName;
            img.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover;';
            avatarWrap.appendChild(img);
          }
        }
      }

      // CC1: best-effort, non-blocking — don't hold up first paint on it.
      _loadContactCardForm();

      // Fetch the conversation list to decide which view to show first.
      const listData = await fetchConversationList();
      convListHistory = (listData && listData.history) || [];
      widgetShowHistory = Boolean(listData && listData.show_conversation_history);

      if (listData && listData.active) {
        if (listData.active.visitor_ended) {
          // Visitor had ended this conversation — don't auto-resume it.
          // If a more recent resolved conversation exists in history, show that instead
          // (stale OPEN+visitor_ended conv should not shadow a newer resolved one).
          const newestHistory = listData.history && listData.history[0];
          const showId = (newestHistory && newestHistory.id > listData.active.id)
            ? newestHistory.id
            : listData.active.id;
          if (!widgetShowHistory) {
            await enterThreadView(showId, true);
            // Prompt for rating on the conversation being shown (if unrated and agent-handled).
            // visitor_ended active is OPEN so _shouldShowRatingPrompt returns false for it;
            // newestHistory (resolved) is the only case where the prompt fires.
            const shownConv = (newestHistory && newestHistory.id === showId) ? newestHistory : listData.active;
            if (_shouldShowRatingPrompt(shownConv)) {
              setTimeout(function () { showRatingOverlay(shownConv.id); }, 800);
            }
          } else {
            enterListView(listData);
          }
        } else {
          // Resume the active (open) conversation directly.
          await enterThreadView(listData.active.id, false);
        }
      } else {
        // No active conversation.
        if (!widgetShowHistory) {
          // History disabled: use most recent resolved conv from API; localStorage is last resort.
          const histConv = listData && listData.history && listData.history[0];
          if (histConv) {
            await enterThreadView(histConv.id, true);
            // Prompt for rating if visitor never rated this conversation.
            if (_shouldShowRatingPrompt(histConv)) {
              setTimeout(function () { showRatingOverlay(histConv.id); }, 800);
            }
          } else if (_loadClosedState()) {
            await enterThreadView(_loadClosedState(), true);
          } else {
            enterStartView();
          }
        } else if (listData && listData.history.length > 0) {
          // History enabled and past conversations exist — show the list.
          enterListView(listData);
        } else {
          // No active conversation, no history — start fresh.
          enterStartView();
        }
      }

      armSoundOnFirstGesture();
      setupPageViewTracking();
      connectPresenceWebSocket();
    } catch (e) {
      console.error('[ChatWidget] Init failed:', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 3500));
  } else {
    setTimeout(init, 3500);
  }

})();
