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
    apiUrl: null
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
   * Initialize the chat widget
   */
  function init() {
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
    
    console.log('[ChatWidget] Initializing with config:', CONFIG);

    // Create UI
    createWidget();

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
