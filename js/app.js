/* ============================================
   DVC AI CHATBOT — app.js v3.3
   AI API + Smart Key Switching + User Tracking
   Fully Responsive + PWA + Keyboard Fix
   promode × @dvc 2026
   ============================================ */

(function () {
  'use strict';

  // ============ CONFIG ============
  // Obfuscated API endpoints — not directly visible in source
  // Provider 1 (fast models)
  const _enc1 = 'aHR0cHM6Ly9hcGkuZ3JvcS5jb20vb3BlbmFpL3YxL2NoYXQvY29tcGxldGlvbnM';
  const API_BASE = atob(_enc1);
  // Provider 2 (deep reasoning)
  const _enc2 = 'aHR0cHM6Ly9hcGkuZGVlcHNlZWsuY29tL2NoYXQvY29tcGxldGlvbnM=';
  const API_BASE_2 = atob(_enc2);
  const REPO_BASE = 'https://donrich99.github.io/dvcaichat';
  const STATUS_URL = REPO_BASE + '/status.json';
  const USERS_URL = REPO_BASE + '/users.json';

  const SYSTEM_PROMPT = `You are DVC AI — a powerful, helpful, and friendly AI assistant created by @dvc (boss). You are built by promode. You respond in the language the user uses (English, Tagalog, Bisaya, etc.). You are smart, witty, and always give the best answers. You can write code, explain anything, help with business ideas, and much more. Be concise but thorough. Use markdown formatting when helpful. Format code blocks properly with language tags.`;

  // Obfuscated model ID mapping (display names → real API IDs)
  const MODEL_MAP = {
    'compound-x': atob('Z3JvcS9jb21wb3VuZA=='),
    'compound-m': atob('Z3JvcS9jb21wb3VuZC1taW5p')
  };

  function resolveModel(model) {
    return MODEL_MAP[model] || model;
  }

  // ============ USER ID MANAGEMENT ============
  function getUserId() {
    let userId = localStorage.getItem('dvc_user_id');
    if (!userId) {
      // Generate unique user ID: DVC-XXXXXX (6 chars)
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
      let id = '';
      for (let i = 0; i < 6; i++) {
        id += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      userId = 'DVC-' + id;
      localStorage.setItem('dvc_user_id', userId);
      localStorage.setItem('dvc_first_visit', new Date().toISOString());
    }
    return userId;
  }

  function getUserStats() {
    return {
      id: getUserId(),
      firstVisit: localStorage.getItem('dvc_first_visit') || 'unknown',
      totalChats: (JSON.parse(localStorage.getItem('dvc_chats') || '[]')).length,
      userAgent: navigator.userAgent,
      screen: `${screen.width}x${screen.height}`,
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    };
  }

  const CURRENT_USER_ID = getUserId();

  // ============ STATE ============
  let currentModel = localStorage.getItem('dvc_model') || 'openai/gpt-oss-20b';
  let currentKeyIndex = 0;
  let failedKeys = new Set();
  let chats = JSON.parse(localStorage.getItem('dvc_chats') || '[]');
  let currentChatId = null;
  let isOnline = true;
  let isGenerating = false;
  let isBlocked = false;

  // ============ UPLOAD SYSTEM STATE ============
  let pendingAttachments = []; // {type:'image'|'file', name, dataUrl, rawText, size}

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

  // Upload system DOM
  const attachBtn = $('#attachBtn');
  const fileInput = $('#fileInput');
  const attachPreview = $('#attachPreview');
  const attachPreviewItems = $('#attachPreviewItems');
  const attachClear = $('#attachClear');
  const imagePreviewModal = $('#imagePreviewModal');
  const imagePreviewImg = $('#imagePreviewImg');
  const imagePreviewClose = $('#imagePreviewClose');
  const imagePreviewSend = $('#imagePreviewSend');

  // ============ API KEY MANAGEMENT ============
  function getKeys() {
    try {
      let keys = JSON.parse(localStorage.getItem('dvc_api_keys') || '[]');
      // Auto-migrate old key storage
      if (keys.length === 0) {
        const oldKeys = JSON.parse(localStorage.getItem('dvc_legacy_keys') || '[]');
        if (oldKeys.length > 0) {
          keys = oldKeys;
          setKeys(keys);
        }
      }
      return keys;
    } catch { return []; }
  }

  function setKeys(keys) {
    localStorage.setItem('dvc_api_keys', JSON.stringify(keys));
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
    failedKeys.add(currentKeyIndex);
    if (failedKeys.size >= getKeys().length) failedKeys.clear();
    currentKeyIndex = (currentKeyIndex + 1) % getKeys().length;
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

  // ============ STATUS CHECKS ============
  async function checkOnlineStatus() {
    try {
      const res = await fetch(STATUS_URL + '?t=' + Date.now(), {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });
      if (!res.ok) return true;
      const data = await res.json();
      return data.status === 'on';
    } catch { return true; }
  }

  async function checkBlockStatus() {
    try {
      const res = await fetch(USERS_URL + '?t=' + Date.now(), {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });
      if (!res.ok) return false;
      const users = await res.json();
      const me = users.users?.find(u => u.id === CURRENT_USER_ID);
      return me ? me.blocked === true : false;
    } catch { return false; }
  }

  async function enforceStatus() {
    isOnline = await checkOnlineStatus();
    if (!isOnline) {
      offlineScreen.style.display = 'flex';
      return false;
    }
    isBlocked = await checkBlockStatus();
    if (isBlocked) {
      showBlockScreen();
      return false;
    }
    return true;
  }

  function showBlockScreen() {
    offlineScreen.style.display = 'flex';
    offlineScreen.innerHTML = `
      <div class="offline-content">
        <div class="offline-icon">⛔</div>
        <h1>You Are Blocked</h1>
        <p>Your access to DVC AI has been restricted by the administrator.</p>
        <div class="offline-footer">
          <span>Your ID: ${CURRENT_USER_ID}</span>
          <span>Contact @dvc if you think this is an error</span>
        </div>
      </div>`;
  }

  // ============ INIT ============
  async function init() {
    const ok = await enforceStatus();
    if (!ok) return;

    const keys = getKeys();

    // Setup mobile keyboard fix FIRST (works even on setup screen)
    setupKeyboardFix();

    if (keys.length === 0) {
      showSetupScreen();
      return;
    }

    // Load main chat
    modelSelect.value = currentModel;
    renderChatHistory();
    setupEventListeners();
    loadTheme();
    updateKeyStatus();
    updateUserBadge();

    if (chats.length > 0) {
      loadChat(chats[0].id);
    }

    userInput.focus();
  }

  function updateUserBadge() {
    // Show user ID in the footer
    const badgeEl = $('#userBadge');
    if (badgeEl) {
      badgeEl.textContent = `🆔 ${CURRENT_USER_ID}`;
    }
  }

  function showSetupScreen() {
    setupScreen.style.display = 'flex';
    setupScreen.style.flexDirection = 'column';
    setupScreen.style.alignItems = 'center';
    setupScreen.style.justifyContent = 'center';
    setupSetupScreen();
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
      const single = keyInput.value.trim();
      if (single) newKeys.push(single);

      const multi = multiInput.value.trim();
      if (multi) {
        const lines = multi.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        newKeys = newKeys.concat(lines);
      }

      newKeys = [...new Set(newKeys)];
      if (newKeys.length === 0) {
        alert('Please enter at least one API key!');
        return;
      }

      setKeys(newKeys);
      setupScreen.style.display = 'none';
      init(); // Re-init with keys loaded
    });

    keyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveBtn.click();
    });
  }

  // ============ SETTINGS MODAL ============
  function openSettings() {
    settingsModal.style.display = 'flex';
    updateKeyStatus();

    const listEl = $('#savedKeysList');
    listEl.innerHTML = '';
    const keys = getKeys();
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
        openSettings();
        updateKeyStatus();
      }
    });

    $('#savedKeysList').addEventListener('click', (e) => {
      const btn = e.target.closest('.key-remove');
      if (btn) {
        const idx = parseInt(btn.dataset.index);
        const keys = getKeys();
        keys.splice(idx, 1);
        setKeys(keys);
        failedKeys.clear();
        currentKeyIndex = 0;
        openSettings();
        updateKeyStatus();
      }
    });

    $('#settingsClearKeys').addEventListener('click', () => {
      if (confirm('Remove ALL API keys? You will need to re-enter them.')) {
        setKeys([]);
        closeSettings();
        showSetupScreen();
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

    $('#suggestionGrid').addEventListener('click', (e) => {
      const card = e.target.closest('.suggestion-card');
      if (card) {
        userInput.value = card.dataset.prompt;
        autoResize();
        sendMessage();
      }
    });

    setupSettings();
    setupUploadSystem();
  }

  // ============ UPLOAD SYSTEM ============
  function setupUploadSystem() {
    if (!attachBtn || !fileInput) return;

    attachBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      for (const file of files) {
        await addAttachment(file);
      }
      fileInput.value = ''; // Reset for next selection
    });

    if (attachClear) {
      attachClear.addEventListener('click', clearAttachments);
    }

    if (imagePreviewClose) {
      imagePreviewClose.addEventListener('click', () => {
        imagePreviewModal.style.display = 'none';
      });
    }

    if (imagePreviewSend) {
      imagePreviewSend.addEventListener('click', () => {
        imagePreviewModal.style.display = 'none';
        sendMessage();
      });
    }
  }

  async function addAttachment(file) {
    const isImage = file.type.startsWith('image/');
    const maxImageSize = 4 * 1024 * 1024; // 4MB for images
    const maxFileSize = 10 * 1024 * 1024; // 10MB for files

    if (isImage && file.size > maxImageSize) {
      appendMessage('ai', '⚠️ Image too large. Max size is 4MB.', true);
      return;
    }
    if (!isImage && file.size > maxFileSize) {
      appendMessage('ai', '⚠️ File too large. Max size is 10MB.', true);
      return;
    }

    const attachment = {
      type: isImage ? 'image' : 'file',
      name: file.name,
      size: file.size,
      dataUrl: null,
      rawText: null
    };

    if (isImage) {
      attachment.dataUrl = await readImageAsDataUrl(file);
    } else if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      try {
        attachment.rawText = await extractPdfText(file);
      } catch (err) {
        console.error('PDF extraction failed:', err);
        appendMessage('ai', `⚠️ Could not extract PDF text: ${err.message}`, true);
        return;
      }
    } else {
      // Text-based file
      try {
        attachment.rawText = await file.text();
      } catch (err) {
        appendMessage('ai', `⚠️ Could not read file: ${err.message}`, true);
        return;
      }
    }

    pendingAttachments.push(attachment);
    renderAttachPreview();
  }

  function readImageAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function extractPdfText(file) {
    if (!window.pdfjsLib) {
      throw new Error('PDF library not loaded');
    }
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(item => item.str).join(' ') + '\n\n';
    }
    return `[PDF FILE: ${file.name} — ${pdf.numPages} pages]\n\n${text}`;
  }

  function renderAttachPreview() {
    if (!attachPreview || !attachPreviewItems) return;
    if (pendingAttachments.length === 0) {
      attachPreview.style.display = 'none';
      return;
    }

    attachPreview.style.display = 'flex';
    attachPreviewItems.innerHTML = '';
    pendingAttachments.forEach((att, idx) => {
      const item = document.createElement('div');
      item.className = 'attach-item' + (att.type !== 'image' ? ' file-item' : '');

      if (att.type === 'image') {
        item.innerHTML = `<img src="${att.dataUrl}" alt="${att.name}">`;
      } else {
        item.innerHTML = `
          <span class="file-icon">📄</span>
          <span>${att.name.substring(0, 12)}${att.name.length > 12 ? '..' : ''}</span>
        `;
      }

      const removeBtn = document.createElement('button');
      removeBtn.className = 'attach-item-remove';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        pendingAttachments.splice(idx, 1);
        renderAttachPreview();
      });

      item.appendChild(removeBtn);
      item.addEventListener('click', (e) => {
        if (e.target === removeBtn) return;
        if (att.type === 'image') {
          showImagePreview(att.dataUrl);
        }
      });

      attachPreviewItems.appendChild(item);
    });
  }

  function clearAttachments() {
    pendingAttachments = [];
    renderAttachPreview();
  }

  function showImagePreview(dataUrl) {
    if (!imagePreviewModal || !imagePreviewImg) return;
    imagePreviewImg.src = dataUrl;
    imagePreviewModal.style.display = 'flex';
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  // ============ AUTO RESIZE ============
  function autoResize() {
    userInput.style.height = 'auto';
    const maxH = window.innerWidth <= 480 ? 80 : 200;
    userInput.style.height = Math.min(userInput.scrollHeight, maxH) + 'px';
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
    toggleSidebar();
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
    if (!text && pendingAttachments.length === 0) return;
    if (isGenerating) return;

    // Re-check block status before sending
    isBlocked = await checkBlockStatus();
    if (isBlocked) {
      showBlockScreen();
      return;
    }

    // Check keys
    if (getKeys().length === 0) {
      showSetupScreen();
      return;
    }

    if (!currentChatId) createNewChat();

    const chat = chats.find(c => c.id === currentChatId);
    if (!chat) return;

    welcomeScreen.style.display = 'none';
    messagesEl.innerHTML = '';

    // Build user message display
    let displayText = text;
    if (chat.messages.length === 0) {
      chat.title = (text || 'Uploaded file').substring(0, 45) + (text.length > 45 ? '...' : '');
      $('#currentChatTitle').textContent = chat.title;
      renderChatHistory();
    }

    // Store attachments reference for display
    const currentAttachments = [...pendingAttachments];
    clearAttachments();

    // Build multimodal API message content
    let apiUserContent;
    const hasImages = currentAttachments.some(a => a.type === 'image');
    const hasFiles = currentAttachments.some(a => a.type === 'file');

    if (hasImages || hasFiles) {
      apiUserContent = [];
      // Add text prompt if any
      if (text) {
        apiUserContent.push({ type: 'text', text: text });
      }
      // Add images
      currentAttachments.filter(a => a.type === 'image').forEach(att => {
        apiUserContent.push({
          type: 'image_url',
          image_url: { url: att.dataUrl }
        });
      });
      // Add file contents as text blocks
      currentAttachments.filter(a => a.type === 'file').forEach(att => {
        const filePrompt = `[Attached file: ${att.name}]\n\n${att.rawText}\n\n[End of file]`;
        apiUserContent.push({ type: 'text', text: filePrompt });
      });
    } else {
      apiUserContent = text;
    }

    // Store for display
    chat.messages.push({
      role: 'user',
      content: text,
      attachments: currentAttachments.length > 0 ? currentAttachments.map(a => ({
        type: a.type,
        name: a.name,
        size: a.size,
        dataUrl: a.type === 'image' ? a.dataUrl : undefined,
        rawText: a.type === 'file' ? a.rawText.substring(0, 200) + '...' : undefined
      })) : undefined
    });

    // Render user message with images/files
    appendUserMessage(text, currentAttachments);

    userInput.value = '';
    userInput.style.height = 'auto';

    const typingEl = appendTyping();
    sendBtn.disabled = true;
    isGenerating = true;
    updateStatusDot('thinking');

    // Build API messages — use multimodal content for last user message
    const historyMessages = chat.messages.slice(-20).map(m => ({
      role: m.role,
      content: m.content
    }));

    // Replace last user message with multimodal content if we had attachments
    if (currentAttachments.length > 0 && historyMessages.length > 0) {
      const lastMsg = historyMessages[historyMessages.length - 1];
      if (lastMsg.role === 'user') {
        lastMsg.content = apiUserContent;
      }
    }

    const apiMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...historyMessages
    ];

    let success = false;
    let attempts = 0;
    let lastError = '';
    const totalKeys = getKeys().length;

    // Route to correct API based on model
    const isDeepSeek = currentModel === 'deepseek-chat';
    const endpoint = isDeepSeek ? API_BASE_2 : API_BASE;

    while (!success && attempts < totalKeys) {
      try {
        const key = getNextKey();
        if (!key) break;

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
          },
          body: JSON.stringify({
            model: resolveModel(currentModel),
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
          const aiMsgEl = appendMessage('ai', '');
          const bubbleEl = aiMsgEl.querySelector('.message-bubble');

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
              } catch (e) { /* skip */ }
            }
          }

          if (fullResponse) {
            chat.messages.push({ role: 'assistant', content: fullResponse });
            // Add code block actions + output panels after stream completes
            addCodeBlockActions(bubbleEl);
            addOutputPanels(bubbleEl, fullResponse);
          }
          success = true;

        } else {
          // Capture actual API error for debugging
          let apiErrMsg = '';
          try {
            const errData = await response.json();
            apiErrMsg = errData?.error?.message || JSON.stringify(errData).substring(0, 200);
          } catch (e) { apiErrMsg = 'HTTP ' + response.status; }
          console.error('API Error [' + response.status + ']:', apiErrMsg);
          markKeyFailed();
          lastError = 'http_' + response.status + ': ' + apiErrMsg;
          attempts++;
        }

      } catch (err) {
        console.error('Fetch error:', err);
        lastError = 'Exception: ' + err.message;
        attempts++;
        if (attempts >= totalKeys) {
          typingEl.remove();
          appendMessage('ai', `⚠️ Fetch Error:\n\n${err.message}\n\nCheck console (F12) for details.`, true);
        }
      }
    }

    if (!success && attempts >= totalKeys) {
      typingEl.remove();
      appendMessage('ai', `⚠️ API Error:\n\n${lastError}\n\nTry again or add more keys in Settings.`, true);
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
      // Add code block actions + output panels
      addCodeBlockActions(bubble);
      addOutputPanels(bubble, content);
    } else {
      bubble.textContent = content;
    }

    row.appendChild(avatar);
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    scrollToBottom();
    return row;
  }

  function appendUserMessage(text, attachments = []) {
    const row = document.createElement('div');
    row.className = 'message-row user';

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = '👤';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    // Show attached images first
    const imageAttachments = attachments.filter(a => a.type === 'image');
    imageAttachments.forEach(att => {
      const img = document.createElement('img');
      img.className = 'user-image-msg';
      img.src = att.dataUrl;
      img.alt = att.name;
      bubble.appendChild(img);
    });

    // Show file tags
    const fileAttachments = attachments.filter(a => a.type === 'file');
    fileAttachments.forEach(att => {
      const tag = document.createElement('div');
      tag.className = 'file-tag';
      tag.innerHTML = `📄 ${att.name} <span style="opacity:0.6">${formatBytes(att.size)}</span>`;
      bubble.appendChild(tag);
    });

    // Text content
    if (text) {
      const textNode = document.createElement('div');
      textNode.textContent = text;
      bubble.appendChild(textNode);
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

  // ============ MARKDOWN ============
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatMarkdown(text) {
    if (!text) return '';
    let html = escapeHtml(text);

    // Code blocks with language detection
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (m, lang, code) => {
      const langLabel = lang || 'text';
      const codeId = 'code_' + Math.random().toString(36).substring(2, 8);
      return `<div class="code-block-wrapper" data-lang="${langLabel}" data-code-id="${codeId}"><div class="code-block-header"><span class="code-block-lang">${langLabel}</span><div class="code-block-actions"></div></div><pre><code class="language-${lang}" id="${codeId}">${code.trim()}</code></pre></div>`;
    });

    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/\n/g, '<br>');
    html = html.replace(/^- (.+)/gm, '• $1');
    html = html.replace(/^(\d+)\. (.+)/gm, '<strong>$1.</strong> $2');

    return html;
  }

  // ============ CODE BLOCK ACTIONS ============
  function addCodeBlockActions(bubble) {
    const wrappers = bubble.querySelectorAll('.code-block-wrapper');
    wrappers.forEach(wrapper => {
      const lang = wrapper.dataset.lang || 'text';
      const codeId = wrapper.dataset.codeId;
      const codeEl = wrapper.querySelector('code');
      const actionsDiv = wrapper.querySelector('.code-block-actions');
      if (!codeEl || !actionsDiv) return;

      // Copy button
      const copyBtn = document.createElement('button');
      copyBtn.className = 'code-action-btn';
      copyBtn.innerHTML = '📋 Copy';
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(codeEl.textContent);
          copyBtn.innerHTML = '✅ Copied!';
          copyBtn.classList.add('copied');
          setTimeout(() => {
            copyBtn.innerHTML = '📋 Copy';
            copyBtn.classList.remove('copied');
          }, 2000);
        } catch {
          // Fallback
          const ta = document.createElement('textarea');
          ta.value = codeEl.textContent;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          copyBtn.innerHTML = '✅ Copied!';
          copyBtn.classList.add('copied');
          setTimeout(() => { copyBtn.innerHTML = '📋 Copy'; copyBtn.classList.remove('copied'); }, 2000);
        }
      });
      actionsDiv.appendChild(copyBtn);

      // Download button
      const dlBtn = document.createElement('button');
      dlBtn.className = 'code-action-btn';
      dlBtn.innerHTML = '⬇️ Download';
      dlBtn.addEventListener('click', () => {
        const ext = langToExt(lang);
        const filename = `output.${ext}`;
        downloadFile(filename, codeEl.textContent);
        dlBtn.innerHTML = '✅ Downloaded';
        dlBtn.classList.add('downloaded');
        setTimeout(() => {
          dlBtn.innerHTML = '⬇️ Download';
          dlBtn.classList.remove('downloaded');
        }, 2000);
      });
      actionsDiv.appendChild(dlBtn);
    });
  }

  // ============ OUTPUT PANELS ============
  function addOutputPanels(bubble, fullText) {
    if (!fullText) return;

    // Detect common file generation patterns
    const filePatterns = [
      { regex: /```html\b/i, name: 'index.html', icon: '🌐' },
      { regex: /```css\b/i, name: 'style.css', icon: '🎨' },
      { regex: /```python|```py\b/i, name: 'script.py', icon: '🐍' },
      { regex: /```javascript|```js\b/i, name: 'script.js', icon: '⚡' },
      { regex: /```json\b/i, name: 'data.json', icon: '📋' },
      { regex: /```xml\b/i, name: 'data.xml', icon: '📄' },
      { regex: /```yaml|```yml\b/i, name: 'config.yml', icon: '⚙️' },
      { regex: /```bash|```sh\b/i, name: 'script.sh', icon: '🖥️' },
      { regex: /```sql\b/i, name: 'query.sql', icon: '🗃️' },
      { regex: /```typescript|```ts\b/i, name: 'script.ts', icon: '📘' },
      { regex: /```jsx\b/i, name: 'Component.jsx', icon: '⚛️' },
      { regex: /```tsx\b/i, name: 'Component.tsx', icon: '⚛️' },
      { regex: /```java\b/i, name: 'Main.java', icon: '☕' },
      { regex: /```php\b/i, name: 'index.php', icon: '🐘' },
      { regex: /```go\b/i, name: 'main.go', icon: '🐹' },
      { regex: /```rust|```rs\b/i, name: 'main.rs', icon: '🦀' },
    ];

    // Only show output panel for first code block
    const codeBlocks = bubble.querySelectorAll('.code-block-wrapper');
    if (codeBlocks.length === 0) return;

    const firstCodeBlock = codeBlocks[0];
    const lang = firstCodeBlock.dataset.lang || '';
    const codeEl = firstCodeBlock.querySelector('code');
    if (!codeEl) return;

    let matchedPattern = filePatterns.find(p => p.regex.test('```' + lang));
    if (!matchedPattern) {
      // Try to detect from content
      const text = codeEl.textContent;
      if (text.includes('<!DOCTYPE html') || text.includes('<html')) matchedPattern = filePatterns[0];
      else if (text.includes('def ') || text.includes('import ')) matchedPattern = filePatterns[2];
      else if (text.includes('function ') || text.includes('const ') || text.includes('=>')) matchedPattern = filePatterns[3];
      else if (text.includes('{') && text.includes('}')) matchedPattern = filePatterns[4];
      else matchedPattern = { name: 'output.txt', icon: '📄' };
    }

    const panel = document.createElement('div');
    panel.className = 'output-panel';
    panel.innerHTML = `
      <div class="output-info">
        <span class="output-file-icon">${matchedPattern.icon}</span>
        <span class="output-filename">${matchedPattern.name}</span>
        <span class="output-filesize">${formatBytes(codeEl.textContent.length)}</span>
      </div>
      <div class="output-actions">
        <button class="copy-output-btn" data-content="${btoa(encodeURIComponent(codeEl.textContent))}">📋 Copy</button>
        <button class="download-output-btn">⬇️ Download ${matchedPattern.name}</button>
      </div>
    `;

    // Wire up copy button
    panel.querySelector('.copy-output-btn').addEventListener('click', async function() {
      try {
        await navigator.clipboard.writeText(codeEl.textContent);
        this.textContent = '✅ Copied!';
        setTimeout(() => { this.textContent = '📋 Copy'; }, 2000);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = codeEl.textContent;
        document.body.appendChild(ta); ta.select(); document.execCommand('copy');
        document.body.removeChild(ta);
        this.textContent = '✅ Copied!';
        setTimeout(() => { this.textContent = '📋 Copy'; }, 2000);
      }
    });

    // Wire up download button
    panel.querySelector('.download-output-btn').addEventListener('click', () => {
      const ext = langToExt(lang);
      downloadFile(`output.${ext}`, codeEl.textContent);
    });

    // Insert after the first code block wrapper
    firstCodeBlock.parentNode.insertBefore(panel, firstCodeBlock.nextSibling);
  }

  function langToExt(lang) {
    const map = {
      'html': 'html', 'htm': 'html',
      'css': 'css',
      'python': 'py', 'py': 'py',
      'javascript': 'js', 'js': 'js',
      'json': 'json',
      'xml': 'xml',
      'yaml': 'yml', 'yml': 'yml',
      'bash': 'sh', 'sh': 'sh', 'shell': 'sh',
      'sql': 'sql',
      'typescript': 'ts', 'ts': 'ts',
      'jsx': 'jsx',
      'tsx': 'tsx',
      'java': 'java',
      'php': 'php',
      'go': 'go',
      'rust': 'rs', 'rs': 'rs',
      'c': 'c', 'cpp': 'cpp',
      'ruby': 'rb',
      'markdown': 'md', 'md': 'md',
      'text': 'txt',
    };
    return map[lang.toLowerCase()] || 'txt';
  }

  function downloadFile(filename, content) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  // ============ MOBILE KEYBOARD FIX ============
  // Uses visualViewport API to detect keyboard open/close and adjust layout
  function setupKeyboardFix() {
    if (!window.visualViewport) return;

    const vv = window.visualViewport;
    let isKeyboardOpen = false;
    let baseHeight = window.innerHeight;

    function handleResize() {
      const currentHeight = vv.height;
      const heightDiff = baseHeight - currentHeight;

      // Keyboard is open if viewport shrunk by > 100px
      isKeyboardOpen = heightDiff > 100;

      // Adjust body height to match visible area (prevents chat being hidden)
      document.body.style.height = `${currentHeight}px`;

      // Scroll messages to bottom when keyboard opens so user sees latest msg
      if (isKeyboardOpen) {
        const messagesEl = $('#messages');
        if (messagesEl) {
          setTimeout(() => {
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }, 50);
        }
      }
    }

    vv.addEventListener('resize', handleResize);
    vv.addEventListener('visualViewportChange', handleResize);
    window.addEventListener('orientationchange', () => {
      setTimeout(() => { baseHeight = window.innerHeight; handleResize(); }, 100);
    });

    // Also handle focus/blur on the input as fallback for older browsers
    const userInput = document.getElementById('userInput');
    if (userInput) {
      userInput.addEventListener('focus', () => {
        setTimeout(() => {
          const messagesEl = document.getElementById('messages');
          if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
        }, 300);
      });
    }
  }

  // ============ BOOT ============
  document.addEventListener('DOMContentLoaded', init);

})();
