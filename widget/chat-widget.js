/**
 * AI ChatAssist - Visitor Chat Widget
 * Vanilla JavaScript WebSocket-based chat widget
 * Embeddable via <script> tag
 */

(function() {
  'use strict';

  // Widget configuration
  const CONFIG = {
    websiteId: null,
    sessionId: null,
    wsUrl: null,
    apiUrl: null,
    theme: 'dark',
    position: 'bottom-right',
    welcomeMessage: 'Hi! How can we help you today?',
    primaryColor: '#000000'
  };

  // WebSocket connection
  let ws = null;
  let reconnectTimeout = null;
  let isConnecting = false;

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
        showSystemMessage('Connected to support chat');
        
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
        showSystemMessage('Connection lost. Reconnecting...');
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
  function sendMessage(message) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error('[ChatWidget] WebSocket not connected');
      showSystemMessage('Not connected. Please wait...');
      connectWebSocket();
      return false;
    }

    const payload = {
      message: message
    };

    ws.send(JSON.stringify(payload));
    console.log('[ChatWidget] Message sent:', payload);
    return true;
  }

  /**
   * Handle incoming WebSocket messages
   */
  function handleIncomingMessage(data) {
    if (data.type === 'ai') {
      // AI response
      appendMessage('ai', data.message);
    } else if (data.type === 'agent') {
      // Agent message
      appendMessage('agent', data.message);
    } else if (data.type === 'agent_joined') {
      // Agent joined notification
      showSystemMessage('A support agent has joined the chat');
    } else if (data.message) {
      // Generic message format
      const sender = data.sender || 'ai';
      appendMessage(sender, data.message);
    }
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
    
    messageDiv.appendChild(bubble);
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

    // Send to backend
    sendMessage(message);
  }

  /**
   * Create chat widget UI
   */
  function createWidget() {
    // Create main container
    const container = document.createElement('div');
    container.id = 'chatassist-widget';
    container.innerHTML = `
      <div id="chatassist-bubble">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      </div>
      <div id="chatassist-window" style="display: none;">
        <div id="chatassist-header">
          <span>Support Chat</span>
          <button id="chatassist-close">&times;</button>
        </div>
        <div id="chatassist-messages"></div>
        <div id="chatassist-input-container">
          <input type="text" id="chatassist-input" placeholder="Type your message..." />
          <button id="chatassist-send">Send</button>
        </div>
      </div>
    `;

    document.body.appendChild(container);

    // Event listeners
    const bubble = document.getElementById('chatassist-bubble');
    const window = document.getElementById('chatassist-window');
    const closeBtn = document.getElementById('chatassist-close');
    const input = document.getElementById('chatassist-input');
    const sendBtn = document.getElementById('chatassist-send');

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
        
        console.log('[ChatWidget] Configuration loaded from backend:', config);
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
    // Get configuration from script tag
    const scriptTag = document.currentScript || document.querySelector('script[data-website-id]');
    
    if (!scriptTag) {
      console.error('[ChatWidget] Script tag not found. Cannot initialize.');
      return;
    }

    CONFIG.websiteId = scriptTag.getAttribute('data-website-id');
    CONFIG.wsUrl = scriptTag.getAttribute('data-ws-url') || 'ws://localhost:8000';
    CONFIG.apiUrl = scriptTag.getAttribute('data-api-url') || 'http://localhost:8000';

    if (!CONFIG.websiteId) {
      console.error('[ChatWidget] data-website-id is required');
      return;
    }

    // Get or create session ID
    CONFIG.sessionId = getSessionId();
    
    console.log('[ChatWidget] Initializing with website ID:', CONFIG.websiteId);

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
  }

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
