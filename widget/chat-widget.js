/**
 * AI ChatAssist - Visitor Chat Widget
 * Vanilla JavaScript WebSocket-based chat widget
 * Loaded dynamically via loader.js with website-specific configuration
 */

(function() {
  'use strict';

  // Get configuration from loader (set by loader.js)
  var globalConfig = window._aichatassist || {};
  
  // Widget configuration - populated from global config
  const CONFIG = {
    websiteId: globalConfig.websiteId || null,
    widgetKey: globalConfig.widgetKey || null,
    sessionId: null,
    wsUrl: globalConfig.wsUrl || 'ws://localhost:8000',
    apiUrl: globalConfig.apiUrl || 'http://localhost:8000',
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
  
  // Validate required config
  if (!CONFIG.websiteId || !CONFIG.widgetKey) {
    console.error('[ChatWidget] Missing required configuration: websiteId or widgetKey');
    return;
  }

  // WebSocket connection
  let ws = null;
  let reconnectTimeout = null;
  let isConnecting = false;
  let toastTimeout = null;

  // Presence WebSocket (online/offline + agent avatars)
  let presenceWs = null;
  let presencePingInterval = null;
  let presenceOnline = true;
  let activeAgentAvatarUrl = null;

  function getFullAssetUrl(url) {
    if (!url || typeof url !== 'string') return null;
    return url.startsWith('http') ? url : `${CONFIG.apiUrl}${url}`;
  }

  function setHeaderIcon(urlOrNull) {
    const iconInner = document.getElementById('chatassist-header-icon-inner');
    if (!iconInner) return;

    const url = getFullAssetUrl(urlOrNull);
    if (!url) {
      iconInner.innerHTML = `<div class="chatassist-header-avatar-placeholder">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
      </div>`;
      return;
    }

    iconInner.innerHTML = `<img class="chatassist-header-avatar" src="${url}" alt="Icon">`;
  }

  function refreshHeaderIcon() {
    if (activeAgentAvatarUrl) {
      setHeaderIcon(activeAgentAvatarUrl);
      return;
    }
    if (CONFIG.headerIconUrl) {
      setHeaderIcon(CONFIG.headerIconUrl);
      return;
    }
    setHeaderIcon(null);
  }

  /**
   * Generate a unique session ID (UUID v4)
   */
  function generateSessionId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Get or create session ID
   */
  function getSessionId() {
    let sessionId = localStorage.getItem('ai_chatassist_session_id');
    if (!sessionId) {
      sessionId = generateSessionId();
      localStorage.setItem('ai_chatassist_session_id', sessionId);
    }
    return sessionId;
  }

  /**
   * Initialize WebSocket connection
   */
  function connectWebSocket() {
    if (isConnecting || (ws && ws.readyState === WebSocket.OPEN)) {
      return;
    }

    isConnecting = true;
    const wsEndpoint = `${CONFIG.wsUrl}/ws/chat/${CONFIG.websiteId}/${CONFIG.sessionId}`;
    
    console.log('[ChatWidget] Connecting to:', wsEndpoint);
    
    try {
      ws = new WebSocket(wsEndpoint);

      ws.onopen = function() {
        console.log('[ChatWidget] WebSocket connected');
        isConnecting = false;
        hideToast();
        
        // Clear any pending reconnect
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
          reconnectTimeout = null;
        }
      };

      ws.onmessage = function(event) {
        console.log('[ChatWidget] Message received:', event.data);
        const data = JSON.parse(event.data);
        handleIncomingMessage(data);
      };

      ws.onerror = function(error) {
        console.error('[ChatWidget] WebSocket error:', error);
        isConnecting = false;
      };

      ws.onclose = function() {
        console.log('[ChatWidget] WebSocket closed');
        isConnecting = false;
        ws = null;
        
        // Attempt to reconnect after 3 seconds
        showToast('Connection lost. Reconnecting...');
        reconnectTimeout = setTimeout(connectWebSocket, 3000);
      };
    } catch (error) {
      console.error('[ChatWidget] Failed to create WebSocket:', error);
      isConnecting = false;
    }
  }

  /**
   * Send message to WebSocket
   */
  function sendMessage(message, meta) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error('[ChatWidget] WebSocket not connected');
      showToast('Not connected. Please wait...');
      connectWebSocket();
      return false;
    }

    const payload = {
      message: message
    };

    if (meta && typeof meta === 'object') {
      if (meta.visitor_name) payload.visitor_name = meta.visitor_name;
      if (meta.visitor_email) payload.visitor_email = meta.visitor_email;
    }

    ws.send(JSON.stringify(payload));
    console.log('[ChatWidget] Message sent:', payload);
    return true;
  }

  /**
   * Handle incoming WebSocket messages
   */
  function handleIncomingMessage(data) {
    if (data.type === 'history' && Array.isArray(data.messages)) {
      // Render full history (on initial connect)
      const messagesContainer = document.getElementById('chatassist-messages');
      if (!messagesContainer) return;

      // Clear existing UI messages (welcome/toasts are not part of history)
      messagesContainer.innerHTML = '';

      data.messages.forEach((m) => {
        const senderType = m.sender_type || m.sender || 'system';
        if (senderType === 'visitor') {
          appendMessage('visitor', m.content);
        } else if (senderType === 'agent') {
          appendMessage('agent', m.content);
        } else if (senderType === 'ai') {
          appendMessage('ai', m.content);
        } else if (senderType === 'system') {
          showSystemMessage(m.content);
        } else {
          // Fallback
          showSystemMessage(m.content);
        }
      });

      return;
    }

    if (data.type === 'ai') {
      // AI response
      appendMessage('ai', data.message);
    } else if (data.type === 'agent') {
      // Agent message
      appendMessage('agent', data.message);
      
      // Update agent avatar if provided
      if (data.agent_avatar) {
        updateAgentAvatar(data.agent_avatar);
      }
    } else if (data.type === 'agent_joined') {
      // Agent joined notification
      showSystemMessage('A support agent has joined the chat');
      
      // Update agent avatar if provided
      if (data.agent_avatar) {
        updateAgentAvatar(data.agent_avatar);
      }
    } else if (data.message) {
      // Generic message format
      const sender = data.sender || 'ai';
      appendMessage(sender, data.message);
    }
  }

  /**
   * Update agent avatar in header
   */
  function updateAgentAvatar(avatarUrl) {
    activeAgentAvatarUrl = avatarUrl;
    CONFIG.agentAvatar = avatarUrl;
    refreshHeaderIcon();
  }

  /**
   * Format timestamp
   */
  function formatTimestamp(date) {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    const displayMinutes = minutes < 10 ? '0' + minutes : minutes;
    return `${displayHours}:${displayMinutes} ${ampm}`;
  }

  /**
   * Append message to chat window
   */
  function appendMessage(sender, content) {
    const messagesContainer = document.getElementById('chatassist-messages');
    if (!messagesContainer) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = `chatassist-message chatassist-message-${sender}`;
    
    const bubble = document.createElement('div');
    bubble.className = 'chatassist-message-bubble';
    bubble.textContent = content;
    
    const timestamp = document.createElement('div');
    timestamp.className = 'chatassist-message-timestamp';
    timestamp.textContent = formatTimestamp(new Date());
    
    messageDiv.appendChild(bubble);
    messageDiv.appendChild(timestamp);
    messagesContainer.appendChild(messageDiv);
    
    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  /**
   * Show system message
   */
  function showSystemMessage(content) {
    const messagesContainer = document.getElementById('chatassist-messages');
    if (!messagesContainer) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = 'chatassist-message chatassist-message-system';
    messageDiv.textContent = content;
    
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  /**
   * Show a small toast notification (outside the transcript).
   */
  function showToast(message) {
    const container = document.getElementById('chatassist-toast-container');
    if (!container) return;

    container.textContent = message;
    container.style.display = 'block';
    container.classList.add('chatassist-toast-visible');

    if (toastTimeout) {
      clearTimeout(toastTimeout);
      toastTimeout = null;
    }

    toastTimeout = setTimeout(() => {
      hideToast();
    }, 3000);
  }

  function hideToast() {
    const container = document.getElementById('chatassist-toast-container');
    if (!container) return;
    container.classList.remove('chatassist-toast-visible');
    container.style.display = 'none';
  }

  /**
   * Handle user message submission
   */
  function handleUserMessage() {
    const input = document.getElementById('chatassist-input');
    if (!input) return;

    const message = input.value.trim();
    if (!message) return;

    // Display user message immediately
    appendMessage('visitor', message);

    // Clear input
    input.value = '';

    // If offline, require contact email and include contact fields.
    const contactNameInput = document.getElementById('chatassist-contact-name');
    const contactEmailInput = document.getElementById('chatassist-contact-email');
    let meta = undefined;

    if (!presenceOnline) {
      const visitor_name = contactNameInput ? String(contactNameInput.value || '').trim() : '';
      const visitor_email = contactEmailInput ? String(contactEmailInput.value || '').trim() : '';
      if (!visitor_email) {
        showToast('Please enter your email so we can contact you.');
        return;
      }
      meta = { visitor_name, visitor_email };
      try {
        if (visitor_name) localStorage.setItem(`ai_chatassist_contact_name_${CONFIG.websiteId}`, visitor_name);
        if (visitor_email) localStorage.setItem(`ai_chatassist_contact_email_${CONFIG.websiteId}`, visitor_email);
      } catch (e) {
        // ignore
      }
    }

    // Send to backend
    sendMessage(message, meta);
  }

  /**
   * Create chat widget UI
   */
  function createWidget() {
    // Create main container
    const container = document.createElement('div');
    container.id = 'chatassist-widget';
    
    // Placeholder; actual icon is set after config/presence loads
    const avatarHTML = `<div class="chatassist-header-avatar-placeholder">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
        <circle cx="12" cy="7" r="4"></circle>
      </svg>
    </div>`;
    
    container.innerHTML = `
      <div id="chatassist-bubble">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
        <div id="chatassist-bubble-text">${CONFIG.bubbleText}</div>
      </div>
      <div id="chatassist-window" style="display: none;">
        <div id="chatassist-header">
          <div class="chatassist-header-content">
            <div id="chatassist-header-icon" class="chatassist-header-avatars">
              <div id="chatassist-header-icon-inner">${avatarHTML}</div>
              <span id="chatassist-presence-badge" class="chatassist-presence-badge" aria-hidden="true"></span>
            </div>
            <div class="chatassist-header-info">
              <span class="chatassist-header-title">${CONFIG.headerTitle}</span>
              <div class="chatassist-online-status">
                <span class="chatassist-online-text">${CONFIG.onlineStatusText}</span>
              </div>
            </div>
          </div>
          <button id="chatassist-close">&times;</button>
        </div>
        <div id="chatassist-messages"></div>
        <div id="chatassist-footer">
          <div id="chatassist-contact-form" style="display:none;">
            <input type="text" id="chatassist-contact-name" placeholder="Your name (optional)" />
            <input type="email" id="chatassist-contact-email" placeholder="Your email" />
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

    // Event listeners
    const bubble = document.getElementById('chatassist-bubble');
    const window = document.getElementById('chatassist-window');
    const closeBtn = document.getElementById('chatassist-close');
    const input = document.getElementById('chatassist-input');
    const sendBtn = document.getElementById('chatassist-send');
    const contactNameInput = document.getElementById('chatassist-contact-name');
    const contactEmailInput = document.getElementById('chatassist-contact-email');

    // Prefill contact fields from localStorage (if any)
    try {
      const storedName = localStorage.getItem(`ai_chatassist_contact_name_${CONFIG.websiteId}`);
      const storedEmail = localStorage.getItem(`ai_chatassist_contact_email_${CONFIG.websiteId}`);
      if (contactNameInput && storedName) contactNameInput.value = storedName;
      if (contactEmailInput && storedEmail) contactEmailInput.value = storedEmail;
    } catch (e) {
      // ignore
    }

    bubble.addEventListener('click', function() {
      bubble.style.display = 'none';
      window.style.display = 'flex';
      input.focus();
    });

    closeBtn.addEventListener('click', function() {
      window.style.display = 'none';
      bubble.style.display = 'flex';
    });

    sendBtn.addEventListener('click', handleUserMessage);

    input.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        handleUserMessage();
      }
    });

    // Initialize icon once DOM exists
    refreshHeaderIcon();
  }

  function updateContactFormVisibility() {
    const formEl = document.getElementById('chatassist-contact-form');
    if (!formEl) return;
    formEl.style.display = presenceOnline ? 'none' : 'flex';
  }

  function connectPresenceWebSocket() {
    if (presenceWs && presenceWs.readyState === WebSocket.OPEN) return;

    const wsEndpoint = `${CONFIG.wsUrl}/ws/presence/${CONFIG.websiteId}`;
    try {
      presenceWs = new WebSocket(wsEndpoint);

      presenceWs.onopen = function() {
        // Ping frequently to keep presence extremely fresh (local dev).
        if (presencePingInterval) clearInterval(presencePingInterval);
        presencePingInterval = setInterval(() => {
          try {
            if (presenceWs && presenceWs.readyState === WebSocket.OPEN) {
              presenceWs.send('ping');
            }
          } catch (e) {
            // ignore
          }
        }, 1000);

        // Trigger immediate refresh
        presenceWs.send('ping');
      };

      presenceWs.onmessage = function(event) {
        try {
          const data = JSON.parse(event.data);
          if (data && data.type === 'presence') {
            applyPresence(data);
          }
        } catch (e) {
          // ignore
        }
      };

      presenceWs.onclose = function() {
        if (presencePingInterval) {
          clearInterval(presencePingInterval);
          presencePingInterval = null;
        }
        presenceWs = null;
      };
    } catch (e) {
      // ignore
    }
  }

  function applyPresence(presence) {
    const titleEl = document.querySelector('.chatassist-header-title');
    const statusTextEl = document.querySelector('.chatassist-online-text');
    const badgeEl = document.getElementById('chatassist-presence-badge');

    if (!titleEl || !statusTextEl) return;

    const count = (typeof presence.available_agents_count === 'number')
      ? presence.available_agents_count
      : (Array.isArray(presence.agents) ? presence.agents.length : 0);

    const online = count > 0;
    presenceOnline = online;
    updateContactFormVisibility();

    // Badge: green + count, or red with no number
    if (badgeEl) {
      badgeEl.style.display = 'flex';
      if (online) {
        badgeEl.classList.remove('chatassist-presence-badge-offline');
        badgeEl.textContent = String(count);
      } else {
        badgeEl.classList.add('chatassist-presence-badge-offline');
        badgeEl.textContent = '';
      }
    }

    if (!online) {
      titleEl.textContent = 'Send us a message';
      statusTextEl.textContent = 'Happy to answer you later';

      refreshHeaderIcon();
      return;
    }

    titleEl.textContent = CONFIG.headerTitle;
    statusTextEl.textContent = CONFIG.onlineStatusText;

    refreshHeaderIcon();
  }

  /**
   * Check if system is initialized
   * Returns: true if initialized, false if needs setup
   */
  async function checkSystemStatus() {
    try {
      const response = await fetch(`${CONFIG.apiUrl}/auth/setup/status`);
      if (response.ok) {
        const data = await response.json();
        // needs_setup: true means system is NOT initialized
        return !data.needs_setup;
      }
      // If endpoint fails, assume system needs setup
      return false;
    } catch (error) {
      console.error('[ChatWidget] Failed to check system status:', error);
      return false;
    }
  }

  /**
   * Fetch widget configuration from backend
   * Returns: true if config loaded, false if using defaults, null if website doesn't exist
   */
  async function fetchWidgetConfig() {
    try {
      const response = await fetch(`${CONFIG.apiUrl}/websites/${CONFIG.websiteId}/widget-config`);
      
      if (response.ok) {
        const config = await response.json();
        
        // Apply fetched configuration with fallbacks to defaults
        CONFIG.theme = config.theme || CONFIG.theme;
        CONFIG.position = config.position || CONFIG.position;
        CONFIG.welcomeMessage = config.welcome_message || CONFIG.welcomeMessage;
        CONFIG.primaryColor = config.primary_color || CONFIG.primaryColor;
        CONFIG.headerTitle = config.header_title || CONFIG.headerTitle;
        CONFIG.onlineStatusText = config.online_status_text || CONFIG.onlineStatusText;
        CONFIG.bubbleText = config.bubble_text || CONFIG.bubbleText;
        CONFIG.headerIconUrl = config.header_icon_url || CONFIG.headerIconUrl;
        if (config.show_emoji_picker !== undefined) {
          CONFIG.showEmojiPicker = !!config.show_emoji_picker;
        }
        if (config.show_attachments !== undefined) {
          CONFIG.showAttachments = !!config.show_attachments;
        }
        CONFIG.brandingText = config.branding_text || CONFIG.brandingText;
        // Note: agentAvatar would come from agent's profile dynamically
        
        console.log('[ChatWidget] Configuration loaded from backend:', config);
        refreshHeaderIcon();
        return true;
      } else if (response.status === 404) {
        console.error('[ChatWidget] Website not found (404). Widget cannot be initialized.');
        return null; // Website doesn't exist
      } else {
        console.warn('[ChatWidget] Failed to fetch config (HTTP ' + response.status + '), using defaults');
        return false; // Use defaults
      }
    } catch (error) {
      console.error('[ChatWidget] Failed to fetch config:', error);
      return null; // Treat network errors as fatal
    }
  }

  /**
   * Apply configuration to widget styling
   */
  function applyConfiguration() {
    const container = document.getElementById('chatassist-widget');
    const bubble = document.getElementById('chatassist-bubble');
    const header = document.getElementById('chatassist-header');
    const sendBtn = document.getElementById('chatassist-send');
    
    if (!container) return;

    // Apply position class - clear any existing position
    container.className = 'chatassist-position-' + CONFIG.position.replace('bottom-', 'b-').replace('top-', 't-').replace('left', 'l').replace('right', 'r');
    
    // Apply position inline styles as fallback
    container.style.bottom = '';
    container.style.top = '';
    container.style.left = '';
    container.style.right = '';
    
    if (CONFIG.position === 'bottom-right') {
      container.style.bottom = '20px';
      container.style.right = '20px';
    } else if (CONFIG.position === 'bottom-left') {
      container.style.bottom = '20px';
      container.style.left = '20px';
    } else if (CONFIG.position === 'top-right') {
      container.style.top = '20px';
      container.style.right = '20px';
    } else if (CONFIG.position === 'top-left') {
      container.style.top = '20px';
      container.style.left = '20px';
    }

    // Apply theme/primary color
    if (bubble) {
      bubble.style.background = CONFIG.primaryColor;
    }
    if (header) {
      header.style.background = CONFIG.primaryColor;
    }
    if (sendBtn) {
      sendBtn.style.background = CONFIG.primaryColor;
      sendBtn.style.borderColor = CONFIG.primaryColor;
    }
    
    // Apply theme class for additional styling
    if (CONFIG.theme === 'light') {
      container.classList.add('chatassist-theme-light');
    } else {
      container.classList.add('chatassist-theme-dark');
    }
    
    console.log('[ChatWidget] Applied configuration - Position:', CONFIG.position, 'Color:', CONFIG.primaryColor);
  }

  /**
   * Initialize the chat widget
   */
  async function init() {
    console.log('[ChatWidget] Initializing with config:', CONFIG);
    
    // Configuration already set by loader.js, just validate
    if (!CONFIG.websiteId) {
      console.error('[ChatWidget] Missing websiteId in configuration');
      return;
    }
    
    // Initialize session ID
    CONFIG.sessionId = getSessionId();
    console.log('[ChatWidget] Session ID:', CONFIG.sessionId);

    // STEP 1: Check if system is initialized
    const systemInitialized = await checkSystemStatus();
    if (!systemInitialized) {
      console.warn('[ChatWidget] System not initialized. Widget will not be loaded.');
      console.warn('[ChatWidget] Please complete onboarding first at the admin dashboard.');
      return;
    }

    // STEP 2: Fetch widget configuration from backend
    // This validates that the website exists
    const configResult = await fetchWidgetConfig();
    
    // If website doesn't exist (404 or network error), don't load widget
    if (configResult === null) {
      console.error('[ChatWidget] Website validation failed. Widget will not be loaded.');
      console.error('[ChatWidget] Please ensure:');
      console.error('[ChatWidget]   1. The system is initialized (complete onboarding)');
      console.error('[ChatWidget]   2. A website with ID ' + CONFIG.websiteId + ' exists in the dashboard');
      console.error('[ChatWidget]   3. The website ID in the embed code is correct');
      return;
    }

    // STEP 3: Create UI only after all validations pass
    createWidget();
    
    // Apply configuration styling (either fetched or defaults)
    applyConfiguration();
    
    // Show welcome message after UI is ready
    if (CONFIG.welcomeMessage) {
      setTimeout(() => showSystemMessage(CONFIG.welcomeMessage), 500);
    }

    // Connect WebSocket
    connectWebSocket();

    // Connect presence WebSocket
    connectPresenceWebSocket();
  }

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
