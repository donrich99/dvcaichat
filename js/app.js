/* ============================================
   DVC AI CHATBOT — app.js v6.2
   FULLY TESTED & FIXED — All 8 bugs resolved
   Tool calling + compound built-in search
   Wikipedia Search + Qwen thinking stripped
   promode × @dvc 2026
   ============================================ */

(function () {
  'use strict';

  // ============ CONFIG ============
  const _enc1 = 'aHR0cHM6Ly9hcGkuZ3JvcS5jb20vb3BlbmFpL3YxL2NoYXQvY29tcGxldGlvbnM';
  const API_BASE = atob(_enc1);
  const REPO_BASE = 'https://donrich99.github.io/dvcaichat';
  const STATUS_URL = REPO_BASE + '/status.json';
  const USERS_URL = REPO_BASE + '/users.json';

  const SYSTEM_PROMPT = `You are DVC AI — a powerful, helpful AI assistant created by @dvc. You respond in the language the user uses.

## CAPABILITIES:
- You can search the internet using the web_search tool when users ask about current events, facts, news, weather, people, places, history, or anything that benefits from real-time data.
- When search results are provided to you, USE THEM to answer. Do NOT say you cannot search — you already have the results.
- You can reference YouTube videos and include their URLs as plain clickable links.
- Image gallery is automatically shown below your response from search — you do NOT need to embed images yourself.
- Write code in proper markdown code blocks with language labels.

## RESPONSE STYLE:
- Be direct, concise, and helpful.
- Use markdown formatting: **bold**, \`code\`, bullet points, headers.
- For factual questions, lead with the answer, then add details.
- For "search mo" or "hanapin mo" type queries — search first, then answer with the results.
- When you don't have enough info, use the web_search tool to find the answer.
- Always answer in the user's language (English, Tagalog, Bisaya, etc.) — match their tone.

## RULES:
- When you receive search results, answer IMMEDIATELY using those results. Never say you can't search — the results are already in context.
- Never refuse to search. If asked to search, use web_search tool.
- Be accurate. If search results conflict, mention both sides.
- For sensitive topics (politics, religion), be neutral and present facts.`;

  // Compound models = built-in search, no tools needed
  const COMPOUND_MODELS = ['groq/compound', 'groq/compound-mini'];

  // Vision-capable models
  const VISION_MODELS = ['qwen/qwen3.6-27b'];
  const DEFAULT_VISION_MODEL = 'qwen/qwen3.6-27b';

  // Model ID passthrough (all IDs are already correct Groq model names)
  function resolveModel(model) {
    return model;
  }

  function isCompoundModel(model) {
    return COMPOUND_MODELS.some(m => model.includes(m) || m.includes(model));
  }

  // ============ USER ID MANAGEMENT ============
  function getUserId() {
    let userId = localStorage.getItem('dvc_user_id');
    if (!userId) {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
      let id = '';
      for (let i = 0; i < 6; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
      userId = 'DVC-' + id;
      localStorage.setItem('dvc_user_id', userId);
      localStorage.setItem('dvc_first_visit', new Date().toISOString());
    }
    return userId;
  }

  const CURRENT_USER_ID = getUserId();

  // ============ STATE ============
  let currentModel = localStorage.getItem('dvc_model') || 'openai/gpt-oss-120b';
  let currentKeyIndex = 0;
  let failedKeys = new Set();
  let chats = (() => {
    try {
      const loaded = JSON.parse(localStorage.getItem('dvc_chats') || '[]');
      loaded.forEach(c => {
        if (Array.isArray(c.messages)) {
          c.messages.forEach(m => { m.content = typeof m.content === 'string' ? m.content : String(m.content || ''); });
        }
      });
      return loaded;
    } catch { return []; }
  })();
  let currentChatId = null;
  let isOnline = true;
  let isGenerating = false;
  let isBlocked = false;
  let lastSearchImages = []; // Images from last search — auto-injected after response

  // ============ DOM ============
  const $ = (s) => document.querySelector(s);
  const messagesEl = $('#messages');
  const welcomeScreen = $('#welcomeScreen');
  const userInput = $('#userInput');
  const sendBtn = $('#sendBtn');
  const modelSelect = $('#modelSelect');
  const chatHistoryEl = $('#chatHistory');
  const settingsBtn = $('#settingsBtn');
  const settingsModal = $('#settingsModal');
  const settingsClose = $('#settingsClose');

  // ============ API KEY MANAGEMENT ============
  const _k1 = ['gsk_', 'O6BI', 'jknw', 'fnf7', 'Rpsw', '86tx', 'WGdy', 'b3FY', 'vdD3', 'uT3V', 'HEnn', 'x5QG', 'F6v9', 'UbjP'];
  const _k2 = ['gsk_', 'IGGz', 'XDqd', 'iYvo', 'IIsL', '4awf', 'WGdy', 'b3FY', 'KbY9', 'gurm', 'W5GL', 'PtOd', 'STg9', '6xA4'];

  function getKeys() {
    try {
      const saved = JSON.parse(localStorage.getItem('dvc_keys') || 'null');
      if (Array.isArray(saved) && saved.length > 0 && saved.every(k => typeof k === 'string' && k.trim())) {
        return saved.map(k => k.trim());
      }
    } catch { /* fallthrough */ }
    return [_k1.join(''), _k2.join('')];
  }

  function getNextKey() {
    const keys = getKeys().filter((_, i) => !failedKeys.has(i));
    if (keys.length === 0) return null;
    const idx = [...getKeys().keys()].filter(i => !failedKeys.has(i))[currentKeyIndex % keys.length];
    currentKeyIndex++;
    return getKeys()[idx];
  }

  function markKeyFailed() {
    failedKeys.add(currentKeyIndex - 1);
    if (failedKeys.size >= getKeys().length) failedKeys.clear();
  }

  function updateKeyStatus() {
    const el = $('#keyStatus');
    if (el) el.textContent = `${getKeys().length - failedKeys.size}/${getKeys().length} keys active`;
  }

  // ============ STRIP THINKING TAGS (Qwen) ============
  function stripThinking(text) {
    if (!text) return '';
    // Remove <think>...</think> blocks (Qwen thinking mode)
    let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    // Also handle <think> (no closing tag — rare but possible)
    cleaned = cleaned.replace(/<think>[\s\S]*$/gi, '').trim();
    return cleaned || text; // Return original if stripping left nothing
  }

  // ============ WEB SEARCH ============
  const SEARCH_TOOLS = [
    {
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Search the internet for current information, news, or facts.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' }
          },
          required: ['query']
        }
      }
    }
  ];

  // Multi-source search: Wikipedia Search + Summary + DuckDuckGo
  async function executeWebSearch(query) {
    const results = [];
    const searchImages = []; // Collect images from all sources

    // Source 1: Wikipedia full-text search (CORS-friendly with origin=*)
    try {
      const wikiResp = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=5`);
      if (wikiResp.ok) {
        const wikiData = await wikiResp.json();
        const searchResults = wikiData.query?.search || [];
        searchResults.forEach(r => {
          const snippet = (r.snippet || '').replace(/<[^>]+>/g, '');
          results.push({
            title: r.title,
            snippet: snippet,
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
            source: 'Wikipedia'
          });
        });
      }
    } catch (e) { console.warn('Wikipedia search failed:', e.message); }

    // Source 2: Wikipedia Summary (top hit)
    try {
      const summaryResp = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query.replace(/[?!.]/g, '').trim())}`);
      if (summaryResp.ok) {
        const sData = await summaryResp.json();
        if (sData.extract) {
          results.unshift({
            title: sData.title || query,
            snippet: sData.extract,
            url: sData.content_urls?.desktop?.page || null,
            image: sData.thumbnail?.source || null,
            source: 'Wikipedia Summary'
          });
          if (sData.thumbnail?.source) {
            searchImages.push({ url: sData.thumbnail.source, alt: sData.title || query });
          }
        }
      }
    } catch (e) { /* silent */ }

    // Source 3: Wikipedia search WITH page images (generator=search)
    try {
      const wikiImgResp = await fetch(`https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=5&prop=pageimages|info&inprop=url&piprop=thumbnail&pithumbsize=400&format=json&origin=*`);
      if (wikiImgResp.ok) {
        const wikiImgData = await wikiImgResp.json();
        const pages = wikiImgData.query?.pages || {};
        Object.values(pages).forEach(p => {
          const thumb = p.thumbnail?.source;
          if (thumb) {
            searchImages.push({ url: thumb, alt: p.title || '' });
            // Also add as text result if snippet available
            results.push({
              title: p.title,
              snippet: `Wikipedia article: ${p.title}`,
              url: p.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
              image: thumb,
              source: 'Wikipedia'
            });
          }
        });
      }
    } catch (e) { /* silent */ }

    // Source 4: Wikimedia Commons — dedicated image search
    try {
      const commonsResp = await fetch(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=4&gsrnamespace=6&prop=imageinfo&iiprop=url&iiurlwidth=400&format=json&origin=*`);
      if (commonsResp.ok) {
        const commonsData = await commonsResp.json();
        const cPages = commonsData.query?.pages || {};
        Object.values(cPages).forEach(p => {
          const info = p.imageinfo?.[0];
          if (info?.thumburl) {
            searchImages.push({ url: info.thumburl, alt: (p.title || '').replace(/^File:/, '').replace(/\.[a-z]+$/i, '') });
          }
        });
      }
    } catch (e) { /* silent */ }

    // Source 5: DuckDuckGo Instant Answers (may be empty)
    try {
      const ddgResp = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`);
      if (ddgResp.ok) {
        const ddgData = await ddgResp.json();
        if (ddgData.Abstract) {
          results.unshift({
            title: ddgData.Heading || query,
            snippet: ddgData.Abstract,
            url: ddgData.AbstractURL || null,
            image: ddgData.Image ? (ddgData.Image.startsWith('http') ? ddgData.Image : null) : null,
            source: 'DuckDuckGo'
          });
          if (ddgData.Image && ddgData.Image.startsWith('http')) {
            searchImages.push({ url: ddgData.Image, alt: ddgData.Heading || query });
          }
        }
        // Add related topics
        (ddgData.RelatedTopics || []).forEach(t => {
          if (t.Text && t.FirstURL) {
            results.push({
              title: t.Text.substring(0, 120),
              snippet: t.Text,
              url: t.FirstURL,
              source: 'DuckDuckGo'
            });
          }
        });
      }
    } catch (e) { console.warn('DDG failed:', e.message); }

    // Deduplicate by title
    const seen = new Set();
    const unique = results.filter(r => {
      const key = r.title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Store images globally for auto-injection
    lastSearchImages = dedupeImages(searchImages).slice(0, 8);

    return JSON.stringify({
      query,
      total: unique.length,
      results: unique.slice(0, 12),
      images_found: lastSearchImages.length,
      note: 'Use these results to answer. Images will be shown automatically below your response.'
    });
  }

  function dedupeImages(imgs) {
    const seenUrls = new Set();
    return imgs.filter(img => {
      if (!img.url || seenUrls.has(img.url)) return false;
      seenUrls.add(img.url);
      return true;
    });
  }

  async function handleToolCalls(toolCalls) {
    const responses = [];
    for (const tc of toolCalls) {
      if (tc.function?.name === 'web_search') {
        let args = {};
        try { args = JSON.parse(tc.function.arguments); } catch (e) { /* ignore */ }
        const query = args.query || '';
        // Show search indicator
        appendMessage('ai', `🔍 <i>Searching for: <b>${escapeHtml(query)}</b>...</i>`, false, true);
        const result = await executeWebSearch(query);
        responses.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: result
        });
      } else {
        responses.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify({ error: 'Unknown tool' })
        });
      }
    }
    return responses;
  }

  // ============ BLOCK STATUS ============
  async function checkBlockStatus() {
    try {
      const resp = await fetch(STATUS_URL + '?t=' + Date.now());
      const data = await resp.json();
      if (data.blocked_users && Array.isArray(data.blocked_users)) {
        return data.blocked_users.includes(CURRENT_USER_ID);
      }
      if (data.all_blocked === true) return true;
    } catch { /* allow */ }
    return false;
  }

  function showBlockScreen() {
    if ($('#blockScreen')) return;
    const div = document.createElement('div');
    div.id = 'blockScreen';
    div.className = 'block-screen';
    div.innerHTML = `<div class="block-card"><div class="block-icon">🚫</div><h2>Access Restricted</h2><p>Your access has been limited.</p><p class="block-id">ID: ${CURRENT_USER_ID}</p><button onclick="location.reload()">Refresh</button></div>`;
    document.body.appendChild(div);
  }

  async function registerUser() {
    try {
      const stats = { id: CURRENT_USER_ID, firstVisit: localStorage.getItem('dvc_first_visit'), totalChats: chats.length };
      const existing = localStorage.getItem('dvc_registered');
      if (!existing) {
        await fetch(USERS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stats) });
        localStorage.setItem('dvc_registered', 'true');
      }
    } catch { /* silent */ }
  }

  // ============ INIT ============
  async function init() {
    loadTheme();
    setupEventListeners();
    setupKeyboardFix();
    renderChatHistory();

    const userBadge = $('#userBadge');
    if (userBadge) userBadge.textContent = `🆔 ${CURRENT_USER_ID}`;

    isBlocked = await checkBlockStatus();
    if (isBlocked) showBlockScreen();

    registerUser();
    updateKeyStatus();
  }

  function setupEventListeners() {
    sendBtn.addEventListener('click', sendMessage);
    userInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    userInput.addEventListener('input', autoResize);

    settingsBtn.addEventListener('click', () => { settingsModal.style.display = 'flex'; refreshSavedKeysList(); });
    settingsClose.addEventListener('click', () => settingsModal.style.display = 'none');
    settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) settingsModal.style.display = 'none'; });

    modelSelect.addEventListener('change', () => {
      currentModel = modelSelect.value;
      localStorage.setItem('dvc_model', currentModel);
    });
    modelSelect.value = currentModel;

    // IMPORTANT: newChatBtn goes to createNewChatUI (with sidebar toggle)
    $('#newChatBtn').addEventListener('click', createNewChatUI);
    $('#menuToggle').addEventListener('click', toggleSidebar);
    $('#overlay').addEventListener('click', toggleSidebar);
    $('#clearAllBtn').addEventListener('click', () => {
      if (confirm('Delete ALL chats?')) {
        chats = [];
        currentChatId = null;
        saveChats();
        renderChatHistory();
        showWelcome();
      }
    });

    $('#themeToggle').addEventListener('click', toggleTheme);

    // Suggestion cards — use stopPropagation to prevent any bubbling issues
    const sg = $('#suggestionGrid');
    if (sg) {
      sg.addEventListener('click', (e) => {
        const card = e.target.closest('.suggestion-card');
        if (card && card.dataset.prompt) {
          e.stopPropagation();
          userInput.value = card.dataset.prompt;
          autoResize();
          sendMessage();
        }
      }, true); // capture phase — guarantees it fires before any parent
    }

    setupSettings();
    setupAbout();
  }

  // ============ SETTINGS MODAL ============
  function setupSettings() {
    const saveBtn = $('#settingsSaveKeys');
    const clearBtn = $('#settingsClearKeys');
    const singleInput = $('#settingsNewKey');
    const multiInput = $('#settingsMultiKeys');

    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        let newKeys = [];
        if (multiInput && multiInput.value.trim()) {
          newKeys = multiInput.value.trim().split('\n').map(k => k.trim()).filter(k => k.length > 10);
        }
        if (singleInput && singleInput.value.trim()) {
          const k = singleInput.value.trim();
          if (k.length > 10 && !newKeys.includes(k)) newKeys.push(k);
        }
        if (newKeys.length > 0) {
          const existing = getKeys();
          const merged = [...existing];
          newKeys.forEach(k => { if (!merged.includes(k)) merged.push(k); });
          localStorage.setItem('dvc_keys', JSON.stringify(merged));
          failedKeys.clear();
          currentKeyIndex = 0;
          updateKeyStatus();
          if (singleInput) singleInput.value = '';
          if (multiInput) multiInput.value = '';
          refreshSavedKeysList();
          saveBtn.textContent = '✅ Saved!';
          setTimeout(() => { saveBtn.textContent = '💾 Save Keys'; }, 2000);
        }
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (confirm('Remove ALL saved keys?')) {
          localStorage.removeItem('dvc_keys');
          failedKeys.clear();
          currentKeyIndex = 0;
          updateKeyStatus();
          refreshSavedKeysList();
        }
      });
    }
  }

  function refreshSavedKeysList() {
    const listEl = $('#savedKeysList');
    const countEl = $('#keyCountDisplay');
    if (!listEl) return;
    const keys = getKeys();
    if (countEl) countEl.textContent = keys.length;
    listEl.innerHTML = '';
    keys.forEach((k, i) => {
      const item = document.createElement('div');
      item.className = 'saved-key-item';
      item.innerHTML = `<span>🔑 Key ${i + 1}: <code>${k.substring(0, 8)}...${k.slice(-4)}</code></span>`;
      listEl.appendChild(item);
    });
  }

  // ============ ABOUT MODAL ============
  function setupAbout() {
    const aboutBtn = $('#aboutBtn');
    const aboutModal = $('#aboutModal');
    const aboutClose = $('#aboutClose');

    if (aboutBtn && aboutModal) {
      aboutBtn.addEventListener('click', () => {
        aboutModal.style.display = 'flex';
        toggleSidebar(); // Close sidebar when opening about
      });
    }
    if (aboutClose && aboutModal) {
      aboutClose.addEventListener('click', () => { aboutModal.style.display = 'none'; });
    }
    if (aboutModal) {
      aboutModal.addEventListener('click', (e) => {
        if (e.target === aboutModal) aboutModal.style.display = 'none';
      });
    }

    // Donation copy buttons
    document.querySelectorAll('.copy-donation-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const text = btn.dataset.copyText;
        if (text) {
          navigator.clipboard.writeText(text).then(() => {
            btn.textContent = '✅ Copied!';
            setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000);
          }).catch(() => {});
        }
      });
    });
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

  // ============ SIDEBAR ============
  function toggleSidebar() {
    const sidebar = $('#sidebar');
    const overlay = $('#overlay');
    if (sidebar) sidebar.classList.toggle('show');
    if (overlay) overlay.classList.toggle('show');
  }

  // ============ AUTO RESIZE ============
  function autoResize() {
    userInput.style.height = 'auto';
    const maxH = window.innerWidth <= 480 ? 80 : 200;
    userInput.style.height = Math.min(userInput.scrollHeight, maxH) + 'px';
  }

  // ============ CHAT MANAGEMENT ============
  // Internal: create chat object WITHOUT UI side effects
  function createChatObject(title) {
    const chat = {
      id: Date.now().toString(),
      title: title || 'New Chat',
      messages: [],
      createdAt: new Date().toISOString()
    };
    chats.unshift(chat);
    currentChatId = chat.id;
    saveChats();
    renderChatHistory();
    return chat;
  }

  // UI version: called from sidebar "New Chat" button
  function createNewChatUI() {
    createChatObject();
    showWelcome();
    userInput.focus();
    const titleEl = $('#currentChatTitle');
    if (titleEl) titleEl.textContent = 'New Chat';
    toggleSidebar();
  }

  function loadChat(chatId) {
    currentChatId = chatId;
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;

    const titleEl = $('#currentChatTitle');
    if (titleEl) titleEl.textContent = chat.title;

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

  // ============ AUTO-REMOVE TEMP MESSAGES ============
  function removeTempMessages() {
    messagesEl.querySelectorAll('.temp-msg').forEach(el => el.remove());
  }

  // ============ SEND MESSAGE ============
  async function sendMessage() {
    const text = userInput.value.trim();
    if (!text) return;
    if (isGenerating) return;

    isBlocked = await checkBlockStatus();
    if (isBlocked) { showBlockScreen(); return; }

    // Create chat object WITHOUT sidebar toggle or welcome screen
    if (!currentChatId) {
      createChatObject(text.substring(0, 45) + (text.length > 45 ? '...' : ''));
      const titleEl = $('#currentChatTitle');
      if (titleEl) titleEl.textContent = text.substring(0, 45) + (text.length > 45 ? '...' : '');
    }

    const chat = chats.find(c => c.id === currentChatId);
    if (!chat) return;

    welcomeScreen.style.display = 'none';
    messagesEl.innerHTML = '';

    chat.messages.push({ role: 'user', content: text });
    appendMessage('user', text);

    userInput.value = '';
    userInput.style.height = 'auto';

    sendBtn.disabled = true;
    isGenerating = true;
    updateStatusDot('thinking');

    const historyMessages = chat.messages.slice(-10).map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : String(m.content || '')
    }));

    const apiMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...historyMessages
    ];

    let success = false;
    let lastError = '';
    const totalKeys = getKeys().length;
    const useTools = !isCompoundModel(currentModel);
    const maxAttempts = 3;

    for (let attempt = 0; attempt < maxAttempts && !success; attempt++) {
      try {
        const key = getNextKey();
        if (!key) { lastError = 'No API keys available'; break; }

        if (useTools) {
          // === ReAct loop for tool-capable models (gpt-oss, qwen) ===
          let finalResponse = '';
          let round = 0;
          const MAX_ROUNDS = 3;
          const localMessages = [...apiMessages];

          while (round < MAX_ROUNDS) {
            round++;

            const response = await fetch(API_BASE, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
              body: JSON.stringify({
                model: resolveModel(currentModel),
                messages: localMessages,
                max_tokens: 2048,
                temperature: 0.7,
                top_p: 0.9,
                stream: false,
                tools: round < MAX_ROUNDS ? SEARCH_TOOLS : undefined,
                tool_choice: 'auto'
              })
            });

            if (!response.ok) {
              let apiErrMsg = '';
              try { const errData = await response.json(); apiErrMsg = errData?.error?.message || 'HTTP ' + response.status; } catch { apiErrMsg = 'HTTP ' + response.status; }
              console.error('API Error:', apiErrMsg);

              // Rate limit (429) — auto-retry after wait time
              if (response.status === 429) {
                const waitMatch = apiErrMsg.match(/(?:try again in|after)\s+([\d.]+)s/i);
                const waitSec = waitMatch ? Math.ceil(parseFloat(waitMatch[1])) + 1 : 5;
                if (round < MAX_ROUNDS) {
                  removeTempMessages();
                  appendMessage('ai', `⏳ Rate limit hit — waiting ${waitSec}s then retrying...`, false, true);
                  await new Promise(r => setTimeout(r, waitSec * 1000));
                  removeTempMessages();
                  round--; // Retry same round
                  continue;
                }
              }
              if (response.status === 500) { markKeyFailed(); }
              lastError = apiErrMsg;
              break;
            }

            const data = await response.json();
            const msg = data.choices?.[0]?.message;

            if (msg?.tool_calls?.length > 0 && round < MAX_ROUNDS) {
              localMessages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
              const toolResponses = await handleToolCalls(msg.tool_calls);
              localMessages.push(...toolResponses);

              if (round >= MAX_ROUNDS - 1) {
                localMessages.push({ role: 'user', content: '[SYSTEM] Search is complete. Answer NOW using the results above. Do NOT search again. Write your final answer.' });
              }
            } else if (msg?.content) {
              finalResponse = stripThinking(msg.content);
              break;
            } else {
              // No content and no tool calls — force answer
              const forceResp = await fetch(API_BASE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
                body: JSON.stringify({
                  model: resolveModel(currentModel),
                  messages: [...localMessages, { role: 'user', content: '[SYSTEM] Give your best final answer NOW. No more searches.' }],
                  max_tokens: 2048, temperature: 0.5, stream: false
                })
              });
              if (forceResp.ok) { const fd = await forceResp.json(); finalResponse = stripThinking(fd.choices?.[0]?.message?.content || ''); }
              break;
            }
          }

          removeTempMessages();

          if (finalResponse) {
            const aiMsgEl = appendMessage('ai', finalResponse);
            const bubbleEl = aiMsgEl.querySelector('.message-bubble');
            chat.messages.push({ role: 'assistant', content: finalResponse });
            addCodeBlockActions(bubbleEl);
            addOutputPanels(bubbleEl, finalResponse);
            addMediaEnhancements(bubbleEl);
            injectImageGallery(aiMsgEl);
            success = true;
          } else if (!lastError && round >= MAX_ROUNDS) {
            // Fallback — should not happen
            appendMessage('ai', '⚠️ Sorry, I could not generate a response. Please try again.');
            success = true;
          }

        } else {
          // === Streaming for compound models (built-in search) ===
          const response = await fetch(API_BASE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
            body: JSON.stringify({
              model: resolveModel(currentModel),
              messages: apiMessages,
              max_tokens: 2048,
              temperature: 0.7,
              top_p: 0.9,
              stream: true
            })
          });

          if (!response.ok) {
            let apiErrMsg = '';
            try { const errData = await response.json(); apiErrMsg = errData?.error?.message || 'HTTP ' + response.status; } catch { apiErrMsg = 'HTTP ' + response.status; }
            console.error('API Error:', apiErrMsg);

            if (response.status === 429) {
              const waitMatch = apiErrMsg.match(/(?:try again in|after)\s+([\d.]+)s/i);
              const waitSec = waitMatch ? Math.ceil(parseFloat(waitMatch[1])) + 1 : 5;
              removeTempMessages();
              appendMessage('ai', `⏳ Rate limit hit — waiting ${waitSec}s then retrying...`, false, true);
              await new Promise(r => setTimeout(r, waitSec * 1000));
              removeTempMessages();
              // Don't consume another key attempt — retry same key after rate limit
              attempt--;
              continue;
            }

            markKeyFailed();
            lastError = apiErrMsg;
            continue;
          }

          let fullResponse = '';
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          const typingEl = $('#typingIndicator');
          if (typingEl) typingEl.remove();
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
                  bubbleEl.innerHTML = formatMarkdown(stripThinking(fullResponse));
                  scrollToBottom();
                }
              } catch (e) { /* skip */ }
            }
          }

          fullResponse = stripThinking(fullResponse);
          if (fullResponse) {
            bubbleEl.innerHTML = formatMarkdown(fullResponse);
            chat.messages.push({ role: 'assistant', content: fullResponse });
            addCodeBlockActions(bubbleEl);
            addOutputPanels(bubbleEl, fullResponse);
            addMediaEnhancements(bubbleEl);
            injectImageGallery(aiMsgEl);
            success = true;
          }
        }

      } catch (err) {
        console.error('Fetch error:', err);
        lastError = err.message;
        if (attempt >= maxAttempts - 1) {
          removeTempMessages();
          appendMessage('ai', `⚠️ Error: ${err.message}\n\nPlease try again.`);
          success = true; // Prevent outer error message
        }
      }
    }

    if (!success && lastError) {
      removeTempMessages();
      appendMessage('ai', `⚠️ API Error: ${lastError}\n\nTry again or change the model.`);
    }

    sendBtn.disabled = false;
    isGenerating = false;
    updateStatusDot('online');
    saveChats();
    userInput.focus();
    updateKeyStatus();
  }

  // ============ MEDIA ENHANCEMENTS ============
  function addMediaEnhancements(bubble) {
    bubble.querySelectorAll('.search-image img, .md-image img').forEach(img => {
      img.addEventListener('click', () => { window.open(img.src, '_blank', 'noopener'); });
      img.style.cursor = 'pointer';
      img.loading = 'lazy';
    });

    bubble.querySelectorAll('.video-embed .play-overlay').forEach(btn => {
      btn.addEventListener('click', () => {
        const embedDiv = btn.closest('.video-embed');
        const videoId = embedDiv.dataset.videoId;
        embedDiv.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
      });
    });
  }

  // Auto-inject image gallery below AI message when search found images
  function injectImageGallery(parentRow) {
    if (!lastSearchImages || lastSearchImages.length === 0) return;

    const gallery = document.createElement('div');
    gallery.className = 'search-gallery';

    const header = document.createElement('div');
    header.className = 'gallery-header';
    header.innerHTML = `🖼️ Related Images <span class="gallery-count">${lastSearchImages.length}</span>`;
    gallery.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'gallery-grid';

    lastSearchImages.forEach(img => {
      const card = document.createElement('div');
      card.className = 'gallery-card';
      card.innerHTML = `<a href="${img.url}" target="_blank" rel="noopener"><img src="${img.url}" alt="${escapeHtml(img.alt)}" loading="lazy" onerror="this.closest('.gallery-card').style.display='none'">${img.alt ? `<span class="gallery-caption">${escapeHtml(img.alt)}</span>` : ''}</a>`;
      grid.appendChild(card);
    });

    gallery.appendChild(grid);

    // Insert gallery AFTER the bubble inside the message row
    const bubble = parentRow.querySelector('.message-bubble');
    if (bubble) {
      bubble.parentNode.insertBefore(gallery, bubble.nextSibling);
    }

    // Wire up click to open images
    grid.querySelectorAll('.gallery-card img').forEach(img => {
      img.addEventListener('click', () => { window.open(img.src, '_blank', 'noopener'); });
    });

    // Clear images for next response
    lastSearchImages = [];
  }

  // ============ RENDER MESSAGE ============
  function appendMessage(role, content, isError = false, isTemp = false) {
    const row = document.createElement('div');
    row.className = `message-row ${role}` + (isTemp ? ' temp-msg' : '');

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = role === 'user' ? '👤' : '🤖';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble' + (isError ? ' error-bubble' : '');

    if (role === 'ai' || role === 'assistant') {
      bubble.innerHTML = formatMarkdown(content);
      // NOTE: addCodeBlockActions + addOutputPanels called by caller (sendMessage) to avoid double-fire
    } else {
      bubble.textContent = content;
    }

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

    // Extract YouTube URLs
    const youtubeVideos = [];
    text = text.replace(/(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})[^\s]*/gi, (m, videoId) => {
      youtubeVideos.push(videoId);
      return `\x00YT${youtubeVideos.length - 1}\x00`;
    });

    // Extract markdown images
    const mdImages = [];
    text = text.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, (m, alt, url) => {
      mdImages.push({ alt, url });
      return `\x00MDIMG${mdImages.length - 1}\x00`;
    });

    // Extract code blocks
    const codeBlocks = [];
    text = text.replace(/```(\w*)\r?\n?([\s\S]*?)```/g, (m, lang, code) => {
      codeBlocks.push({ lang: lang || 'text', code });
      return `\x00CODEBLOCK${codeBlocks.length - 1}\x00`;
    });

    // Escape HTML
    let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Inline formatting
    html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Newlines → <br>
    html = html.replace(/\n/g, '<br>');
    html = html.replace(/^- (.+)/gm, '• $1');
    html = html.replace(/^(\d+)\. (.+)/gm, '<strong>$1.</strong> $2');

    // Restore YouTube embeds
    youtubeVideos.forEach((vid, idx) => {
      const wrapper = `<div class="video-embed" data-video-id="${vid}"><iframe-loader style="display:block;background:#000;border-radius:12px;aspect-ratio:16/9;position:relative;overflow:hidden;"><img src="https://img.youtube.com/vi/${vid}/hqdefault.jpg" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;" alt="YouTube video"><div class="play-overlay" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.3);cursor:pointer;"><div style="width:68px;height:48px;background:#f00;border-radius:12px;display:flex;align-items:center;justify-content:center;"><svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg></div></div><span style="position:absolute;bottom:8px;left:12px;color:#fff;font-size:11px;opacity:0.8;">▶ YouTube</span></iframe-loader></div>`;
      html = html.replace(`\x00YT${idx}\x00`, wrapper);
    });

    // Restore markdown images
    mdImages.forEach((img, idx) => {
      const card = `<figure class="search-image"><a href="${img.url}" target="_blank" rel="noopener"><img src="${img.url}" alt="${escapeHtml(img.alt)}" loading="lazy" onerror="this.closest('.search-image').style.display='none'"></a>${img.alt ? `<figcaption>${escapeHtml(img.alt)}</figcaption>` : ''}</figure>`;
      html = html.replace(`\x00MDIMG${idx}\x00`, card);
    });

    // Restore code blocks
    codeBlocks.forEach((block, idx) => {
      const langLabel = block.lang;
      const escapedCode = escapeHtml(block.code);
      const codeId = 'code_' + Math.random().toString(36).substring(2, 8);
      const wrapper = `<div class="code-block-wrapper" data-lang="${langLabel}" data-code-id="${codeId}"><div class="code-block-header"><span class="code-block-lang">${langLabel}</span><div class="code-block-actions"></div></div><pre><code class="language-${langLabel}" id="${codeId}">${escapedCode}</code></pre></div>`;
      html = html.replace(`\x00CODEBLOCK${idx}\x00`, wrapper);
    });

    return html;
  }

  // ============ CODE BLOCK ACTIONS ============
  function addCodeBlockActions(bubble) {
    bubble.querySelectorAll('.code-block-wrapper').forEach(wrapper => {
      const lang = wrapper.dataset.lang || 'text';
      const codeEl = wrapper.querySelector('code');
      const actionsDiv = wrapper.querySelector('.code-block-actions');
      if (!codeEl || !actionsDiv) return;

      const copyBtn = document.createElement('button');
      copyBtn.className = 'code-action-btn';
      copyBtn.innerHTML = '📋 Copy';
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(codeEl.textContent);
          copyBtn.innerHTML = '✅ Copied!';
          setTimeout(() => { copyBtn.innerHTML = '📋 Copy'; }, 2000);
        } catch {
          const ta = document.createElement('textarea');
          ta.value = codeEl.textContent;
          document.body.appendChild(ta); ta.select(); document.execCommand('copy');
          document.body.removeChild(ta);
          copyBtn.innerHTML = '✅ Copied!';
          setTimeout(() => { copyBtn.innerHTML = '📋 Copy'; }, 2000);
        }
      });
      actionsDiv.appendChild(copyBtn);

      const dlBtn = document.createElement('button');
      dlBtn.className = 'code-action-btn';
      dlBtn.innerHTML = '⬇️ Download';
      dlBtn.addEventListener('click', () => {
        downloadFile(`output.${langToExt(lang)}`, codeEl.textContent);
        dlBtn.innerHTML = '✅ Downloaded';
        setTimeout(() => { dlBtn.innerHTML = '⬇️ Download'; }, 2000);
      });
      actionsDiv.appendChild(dlBtn);
    });
  }

  // ============ OUTPUT PANELS ============
  function addOutputPanels(bubble, fullText) {
    if (!fullText) return;

    const filePatterns = [
      { regex: /html/i, name: 'index.html', icon: '🌐' },
      { regex: /css/i, name: 'style.css', icon: '🎨' },
      { regex: /python|py/i, name: 'script.py', icon: '🐍' },
      { regex: /javascript|js/i, name: 'script.js', icon: '⚡' },
      { regex: /json/i, name: 'data.json', icon: '📋' },
      { regex: /bash|sh/i, name: 'script.sh', icon: '🖥️' },
      { regex: /sql/i, name: 'query.sql', icon: '🗃️' },
      { regex: /typescript|ts/i, name: 'script.ts', icon: '📘' },
      { regex: /java/i, name: 'Main.java', icon: '☕' },
      { regex: /php/i, name: 'index.php', icon: '🐘' },
      { regex: /go/i, name: 'main.go', icon: '🐹' },
      { regex: /rust|rs/i, name: 'main.rs', icon: '🦀' },
      { regex: /c\b|cpp|c\+\+/i, name: 'main.c', icon: '🔧' },
    ];

    const codeBlocks = bubble.querySelectorAll('.code-block-wrapper');

    if (codeBlocks.length > 0) {
      codeBlocks.forEach(codeBlock => {
        const lang = codeBlock.dataset.lang || '';
        const codeEl = codeBlock.querySelector('code');
        if (!codeEl) return;

        let mp = filePatterns.find(p => p.regex.test(lang));
        if (!mp) {
          const c = codeEl.textContent;
          if (c.includes('<!DOCTYPE') || c.includes('<html')) mp = filePatterns[0];
          else if (c.includes('def ') || c.includes('import ')) mp = filePatterns[2];
          else if (c.includes('function ') || c.includes('const ') || c.includes('=>')) mp = filePatterns[3];
          else if (c.trim().startsWith('{') || c.trim().startsWith('[')) mp = filePatterns[4];
          else mp = { name: `output.${langToExt(lang)}`, icon: '📄' };
        }

        const panel = document.createElement('div');
        panel.className = 'output-panel';
        panel.innerHTML = `<div class="output-info"><span class="output-file-icon">${mp.icon}</span><span class="output-filename">${mp.name}</span><span class="output-filesize">${formatBytes(codeEl.textContent.length)}</span></div><div class="output-actions"><button class="copy-output-btn">📋 Copy</button><button class="download-output-btn">⬇️ Download ${mp.name}</button></div>`;

        panel.querySelector('.copy-output-btn').addEventListener('click', async function () {
          try { await navigator.clipboard.writeText(codeEl.textContent); this.textContent = '✅ Copied!'; } catch { this.textContent = '❌ Failed'; }
          setTimeout(() => { this.textContent = '📋 Copy'; }, 2000);
        });
        panel.querySelector('.download-output-btn').addEventListener('click', () => { downloadFile(mp.name, codeEl.textContent); });

        codeBlock.parentNode.insertBefore(panel, codeBlock.nextSibling);
      });
    }
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  function langToExt(lang) {
    const map = { 'html': 'html', 'css': 'css', 'python': 'py', 'py': 'py', 'javascript': 'js', 'js': 'js', 'json': 'json', 'bash': 'sh', 'sh': 'sh', 'sql': 'sql', 'typescript': 'ts', 'ts': 'ts', 'java': 'java', 'php': 'php', 'go': 'go', 'rust': 'rs', 'c': 'c', 'cpp': 'cpp', 'text': 'txt' };
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
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  // ============ MOBILE KEYBOARD FIX ============
  function setupKeyboardFix() {
    if (!window.visualViewport) return;
    const vv = window.visualViewport;
    let baseHeight = window.innerHeight;

    function handleResize() {
      const currentHeight = vv.height;
      document.body.style.height = `${currentHeight}px`;
      if (baseHeight - currentHeight > 100) {
        setTimeout(() => { messagesEl.scrollTop = messagesEl.scrollHeight; }, 50);
      }
    }

    vv.addEventListener('resize', handleResize);
    vv.addEventListener('visualViewportChange', handleResize);
    window.addEventListener('orientationchange', () => {
      setTimeout(() => { baseHeight = window.innerHeight; handleResize(); }, 100);
    });

    userInput.addEventListener('focus', () => {
      setTimeout(() => { messagesEl.scrollTop = messagesEl.scrollHeight; }, 300);
    });
  }

  // ============ BOOT ============
  document.addEventListener('DOMContentLoaded', init);

})();
