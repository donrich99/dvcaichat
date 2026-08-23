/* ============================================
   DVC AI CHATBOT — app.js v2.0
   Groq API + Key Rotation + Online/Offline Toggle
   promode × @dvc 2026
   ============================================ */

(function () {
  'use strict';

  // ============ CONFIG ============
  const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
  const STATUS_URL = 'https://donrich99.github.io/dvcaichat/status.json'; // Where toggle.sh writes

  const SYSTEM_PROMPT = `You are DVC AI — a powerful, helpful, and friendly AI assistant created by @dvc (boss). You are built by promode. You respond in the language the user uses (English, Tagalog, Bisaya, etc.). You are smart, witty, and always give the best answers. You can write code, explain anything, help with business ideas, and much more. Be concise but thorough. Use markdown formatting when helpful. Format code blocks properly with language tags.`;

  // ============ STATE ============
  let currentModel = localStorage.getItem('dvc_model') || 'llama-3.3-70b-versatile';
  let currentKeyIndex = 0;
  let failedKeys = new Set();
  let chats = JSON.parse(localStorage.getItem('dvc_chats') || '[]');
  let currentChatId = null;
  let isOnline = true;
  let isGenerating = false;

  // ============ DOM ============
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  const messagesEl = $('#messages');
  const welcomeScreen = $('#welcomeScreen');
  const userInput = $('#userInput');
  const sendBtn = $('#sendBtn');
  const offlineScreen = $('#offlineScreen');
  const setupScreen = $('#setupScreen');
  const modelSelect = $('#modelSelect');
  const chatHistoryEl = $('#chatHistory');
  const settingsBtn = $('#settingsBtn');
  const settingsModal = $('#settingsModal');
  const settingsClose = $('#settingsClose');

  // ============ API KEY MANAGEMENT ============
  function getKeys() {
    try {
      return JSON.parse(localStorage.getItem('dvc_groq_keys') || '[]');
    } catch {
      return [];
    }
  }

  function setKeys(keys) {
    localStorage.setItem('dvc_groq_keys', JSON.stringify(keys));
  }

  function getNextKey() {
    const keys = getKeys();
    if (keys.length === 0) return null;
    let attempts = 0;
    while (attempts < keys.length) {
      if (!failedKeys.has(currentKeyIndex)) {
        return keys[currentKeyIndex];
      }
      currentKeyIndex = (currentKeyIndex + 1) % keys.length;
      attempts++;
    }
    failedKeys.clear();
    return keys[currentKeyIndex];
  }

  function markKeyFailed() {
    const keys = getKeys();
    failedKeys.add(currentKeyIndex);
    if (failedKeys.size >= keys.length) failedKeys.clear();
    currentKeyIndex = (currentKeyIndex + 1) % keys.length;
    updateKeyStatus();
  }

  function updateKeyStatus() {
    const keys = getKeys();
    const statusEl = $('#keyStatus');
    if (statusEl) {
      statusEl.textContent = keys.length > 0
        ? `🔑 Key #${currentKeyIndex + 1} of ${keys.length}`
        : '🔑 No keys set';
    }
    const countEl = $('#keyCountDisplay');
    if (countEl) countEl.textContent = keys.length;
  }

  // ============ ONLINE/OFFLINE CHECK ============
  async function checkOnlineStatus() {
    try {
      const res = await fetch(STATUS_URL + '?t=' + Date.now(), {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });
      if (!res.ok) {
        // If status.json doesn't exist or error — default to ONLINE
        return true;
      }
      const data = await res.json();
      return data.status === 'on';
    } catch {
      // If can't reach — assume online (GitHub Pages might be slow)
      return true;
    }
  }

  async function enforceStatus() {
    isOnline = await checkOnlineStatus();
    if (!isOnline) {
      offlineScreen.style.display = 'flex';
      document.body.style.display = 'block';
    } else {
      offlineScreen.style.display = 'none';
    }
  }

  // ============ INIT ============
  async function init() {
    const keys = getKeys();

    // Check online/offline
    await enforceStatus();
    if (!isOnline) return;

    // Setup screen if no keys
    if (keys.length === 0) {
      setupScreen.style.display = 'flex';
      setupScreen.style.flexDirection = 'column';
      setupScreen.style.alignItems = 'center';
      setupScreen.style.justifyContent = 'center';
      setupSetupScreen();
      return;
    }

    // Load main chat
    modelSelect.value = currentModel;
    renderChatHistory();
    setupEventListeners();
    loadTheme();
    updateKeyStatus();

    if (chats.length > 0) {
      loadChat(chats[0].id);
    }

    userInput.focus();
  }

  // ============ SETUP SCREEN ============
  function setupSetupScreen() {
    const saveBtn = $('#setupSaveBtn');
    const keyInput = $('#setupApiKey');
    const multiInput = $('#setupMultiKeys');
    const showToggle = $('#setupShowKey');

    showToggle.addEventListener('change', () => {
      keyInput.type = showToggle.checked ? 'text' : 'password';
    });

    saveBtn.addEventListener('click', () => {
      let newKeys = [];

      // Single key
      const single = keyInput.value.trim();
      if (single) {
        newKeys.push(single);
      }

      // Multiple keys
      const multi = multiInput.value.trim();
      if (multi) {
        const lines = multi.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        newKeys = newKeys.concat(lines);
      }

      // Deduplicate
      newKeys = [...new Set(newKeys)];

      if (newKeys.length === 0) {
        alert('Please enter at least one API key!');
        return;
      }

      setKeys(newKeys);
      setupScreen.style.display = 'none';
      init(); // Re-init with keys loaded
    });

    // Enter to save
    keyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveBtn.click();
    });
  }

  // ============ SETTINGS MODAL ============
  function openSettings() {
    settingsModal.style.display = 'flex';
    const keys = getKeys();
    updateKeyStatus();

    // Show saved keys
    const listEl = $('#savedKeysList');
    listEl.innerHTML = '';
    if (keys.length === 0) {
      listEl.innerHTML = '<p style="color:var(--text-muted)">No keys saved yet.</p>';
    } else {
      keys.forEach((key, i) => {
        const item = document.createElement('div');
        item.className = 'key-item';
        item.innerHTML = `
          <span style="color:var(--text-primary)">🔑 Key #${i + 1}: ${key.substring(0, 8)}...${key.substring(key.length - 4)}</span>
          <button class="key-remove" data-index="${i}" title="Remove">✕</button>
        `;
        listEl.appendChild(item);
      });
    }
  }

  function closeSettings() {
    settingsModal.style.display = 'none';
  }

  function setupSettings() {
    settingsBtn.addEventListener('click', openSettings);
    settingsClose.addEventListener('click', closeSettings);
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) closeSettings();
    });

    // Save keys
    $('#settingsSaveKeys').addEventListener('click', () => {
      const existingKeys = getKeys();
      let newKeys = [];

      const single = $('#settingsNewKey').value.trim();
      if (single) newKeys.push(single);

      const multi = $('#settingsMultiKeys').value.trim();
      if (multi) {
        const lines = multi.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        newKeys = newKeys.concat(lines);
      }

      if (newKeys.length > 0) {
        const combined = [...new Set([...existingKeys, ...newKeys])];
        setKeys(combined);
        $('#settingsNewKey').value = '';
        $('#settingsMultiKeys').value = '';
        failedKeys.clear();
        currentKeyIndex = 0;
        openSettings(); // Refresh modal
        updateKeyStatus();
      }
    });

    // Remove keys
    $('#savedKeysList').addEventListener('click', (e) => {
      const btn = e.target.closest('.key-remove');
      if (btn) {
        const idx = parseInt(btn.dataset.index);
        const keys = getKeys();
        keys.splice(idx, 1);
        setKeys(keys);
        failedKeys.clear();
        currentKeyIndex = 0;
        openSettings(); // Refresh
        updateKeyStatus();
      }
    });

    // Clear all keys
    $('#settingsClearKeys').addEventListener('click', () => {
      if (confirm('Remove ALL API keys? You will need to re-enter them.')) {
        setKeys([]);
        closeSettings();
        setupScreen.style.display = 'flex';
        setupScreen.style.flexDirection = 'column';
        setupScreen.style.alignItems = 'center';
        setupScreen.style.justifyContent = 'center';
        setupSetupScreen();
      }
    });
  }

  // ============ EVENT LISTENERS ============
  function setupEventListeners() {
    sendBtn.addEventListener('click', sendMessage);

    userInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    userInput.addEventListener('input', autoResize);

    $('#newChatBtn').addEventListener('click', createNewChat);

    modelSelect.addEventListener('change', (e) => {
      currentModel = e.target.value;
      localStorage.setItem('dvc_model', currentModel);
    });

    $('#menuToggle').addEventListener('click', toggleSidebar);
    $('#overlay').addEventListener('click', toggleSidebar);

    $('#clearAllBtn').addEventListener('click', () => {
      if (confirm('Delete ALL chats? This cannot be undone.')) {
        chats = [];
        currentChatId = null;
        localStorage.removeItem('dvc_chats');
        renderChatHistory();
        showWelcome();
      }
    });

    $('#themeToggle').addEventListener('click', toggleTheme);

    // Suggestion cards
    $('#suggestionGrid').addEventListener('click', (e) => {
      const card = e.target.closest('.suggestion-card');
      if (card) {
        userInput.value = card.dataset.prompt;
        autoResize();
        sendMessage();
      }
    });

    setupSettings();
  }

  // ============ AUTO RESIZE ============
  function autoResize() {
    userInput.style.height = 'auto';
    userInput.style.height = Math.min(userInput.scrollHeight, 200) + 'px';
  }

  // ============ SIDEBAR ============
  function toggleSidebar() {
    const sidebar = $('#sidebar');
    const overlay = $('#overlay');
    sidebar.classList.toggle('show');
    overlay.classList.toggle('show');
  }

  // ============ THEME ============
  function loadTheme() {
    const saved = localStorage.getItem('dvc_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    $('#themeToggle').textContent = saved === 'dark' ? '🌙' : '☀️';
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('dvc_theme', next);
    $('#themeToggle').textContent = next === 'dark' ? '🌙' : '☀️';
  }

  // ============ CHAT MANAGEMENT ============
  function createNewChat() {
    const chat = {
      id: Date.now().toString(),
      title: 'New Chat',
      messages: [],
      createdAt: new Date().toISOString()
    };
    chats.unshift(chat);
    currentChatId = chat.id;
    saveChats();
    renderChatHistory();
    showWelcome();
    userInput.focus();
    $('#currentChatTitle').textContent = 'New Chat';
    toggleSidebar(); // Close on mobile
  }

  function loadChat(chatId) {
    currentChatId = chatId;
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;

    $('#currentChatTitle').textContent = chat.title;

    if (chat.messages.length === 0) {
      showWelcome();
    } else {
      messagesEl.innerHTML = '';
      welcomeScreen.style.display = 'none';
      chat.messages.forEach(msg => appendMessage(msg.role, msg.content, false));
      scrollToBottom();
    }

    renderChatHistory();
  }

  function saveChats() {
    localStorage.setItem('dvc_chats', JSON.stringify(chats));
  }

  function renderChatHistory() {
    chatHistoryEl.innerHTML = '';
    chats.forEach(chat => {
      const item = document.createElement('button');
      item.className = 'chat-history-item' + (chat.id === currentChatId ? ' active' : '');
      item.textContent = chat.title || 'Untitled Chat';
      item.addEventListener('click', () => {
        loadChat(chat.id);
        toggleSidebar();
      });
      chatHistoryEl.appendChild(item);
    });
  }

  function showWelcome() {
    messagesEl.innerHTML = '';
    messagesEl.appendChild(welcomeScreen);
    welcomeScreen.style.display = 'block';
  }

  // ============ SEND MESSAGE ============
  async function sendMessage() {
    const text = userInput.value.trim();
    if (!text || isGenerating) return;

    // Check keys
    if (getKeys().length === 0) {
      setupScreen.style.display = 'flex';
      setupScreen.style.flexDirection = 'column';
      setupScreen.style.alignItems = 'center';
      setupScreen.style.justifyContent = 'center';
      setupSetupScreen();
      return;
    }

    // Create new chat if needed
    if (!currentChatId) createNewChat();

    const chat = chats.find(c => c.id === currentChatId);
    if (!chat) return;

    // Hide welcome
    welcomeScreen.style.display = 'none';
    messagesEl.innerHTML = '';

    // Title from first message
    if (chat.messages.length === 0) {
      chat.title = text.substring(0, 45) + (text.length > 45 ? '...' : '');
      $('#currentChatTitle').textContent = chat.title;
      renderChatHistory();
    }

    // Add user message
    chat.messages.push({ role: 'user', content: text });
    appendMessage('user', text);

    userInput.value = '';
    userInput.style.height = 'auto';

    // Typing indicator
    const typingEl = appendTyping();
    sendBtn.disabled = true;
    isGenerating = true;
    updateStatusDot('thinking');

    // Build API messages
    const apiMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...chat.messages.slice(-20).map(m => ({ role: m.role, content: m.content })) // Last 20 messages for context
    ];

    let success = false;
    let attempts = 0;
    const totalKeys = getKeys().length;

    while (!success && attempts < totalKeys) {
      try {
        const key = getNextKey();
        if (!key) break;

        const response = await fetch(GROQ_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
          },
          body: JSON.stringify({
            model: currentModel,
            messages: apiMessages,
            max_tokens: 4096,
            temperature: 0.7,
            top_p: 0.9,
            stream: true
          })
        });

        if (response.ok) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let fullResponse = '';
          let buffer = '';

          typingEl.remove();
          const aiMsgEl = appendMessage('ai', '...');
          const bubbleEl = aiMsgEl.querySelector('.message-bubble');
          bubbleEl.textContent = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const data = line.slice(6).trim();
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta?.content;
                if (delta) {
                  fullResponse += delta;
                  bubbleEl.innerHTML = formatMarkdown(fullResponse);
                  scrollToBottom();
                }
              } catch (e) { /* skip bad chunks */ }
            }
          }

          if (fullResponse) {
            chat.messages.push({ role: 'assistant', content: fullResponse });
          }
          success = true;

        } else if (response.status === 429) {
          markKeyFailed();
          attempts++;
        } else {
          markKeyFailed();
          attempts++;
        }

      } catch (err) {
        attempts++;
        if (attempts >= totalKeys) {
          typingEl.remove();
          appendMessage('ai', '⚠️ Network error. Check your internet connection.', true);
        }
      }
    }

    if (!success && attempts >= totalKeys) {
      typingEl.remove();
      appendMessage('ai', '⚠️ All keys rate limited. Wait a minute or add new keys in Settings.', true);
    }

    sendBtn.disabled = false;
    isGenerating = false;
    updateStatusDot('online');
    saveChats();
    userInput.focus();
    updateKeyStatus();
  }

  // ============ RENDER MESSAGE ============
  function appendMessage(role, content, isError = false) {
    const row = document.createElement('div');
    row.className = `message-row ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = role === 'user' ? '👤' : '🤖';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble' + (isError ? ' error-bubble' : '');

    if (role === 'ai' || role === 'assistant') {
      bubble.innerHTML = formatMarkdown(content);
    } else {
      bubble.textContent = content;
    }

    row.appendChild(avatar);
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    scrollToBottom();

    return row;
  }

  function appendTyping() {
    const row = document.createElement('div');
    row.className = 'message-row ai';
    row.id = 'typingIndicator';

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = '🤖';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';

    row.appendChild(avatar);
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    scrollToBottom();
    return row;
  }

  function updateStatusDot(status) {
    const dot = $('#statusDot');
    if (dot) dot.style.background = status === 'thinking' ? 'var(--warning)' : 'var(--success)';
  }

  function scrollToBottom() {
    requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight; });
  }

  // ============ MARKDOWN FORMATTING ============
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatMarkdown(text) {
    if (!text) return '';
    let html = escapeHtml(text);

    // Code blocks
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (m, lang, code) => {
      return `<pre><code class="language-${lang}">${code.trim()}</code></pre>`;
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Line breaks (but not inside pre)
    html = html.replace(/\n/g, '<br>');

    // Lists
    html = html.replace(/^- (.+)/gm, '• $1');
    html = html.replace(/^(\d+)\. (.+)/gm, '<strong>$1.</strong> $2');

    return html;
  }

  // ============ BOOT ============
  document.addEventListener('DOMContentLoaded', init);

})();
