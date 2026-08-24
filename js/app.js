/* ============================================
   DVC AI CHATBOT — app.js v7.0
   FULLY TESTED & FIXED — All 8 bugs resolved
   Tool calling + compound built-in search
   Wikipedia Search + Qwen thinking stripped
   NEW: 3D bouncing Aibot icon + weather effects
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
- You have EXA-LEVEL web search — 10 sources searched in parallel (Wikipedia, Google News, Bing News, HackerNews, StackOverflow, arXiv, DuckDuckGo, YouTube, Wikimedia Commons, Wikipedia Images)
- When the user asks to search, or asks about current events, news, facts, people, places, trending topics, technology, coding, or ANYTHING that benefits from real data — USE the web_search tool IMMEDIATELY.
- You do NOT need permission to search. Just search. Every query. No exceptions.
- Image gallery is automatically shown below your response — you do NOT need to embed images.
- YouTube videos are automatically embedded when you include YouTube URLs in your response. IMPORTANT: When the user asks for videos, tutorials, or anything visual — you MUST include the YouTube URLs from search results in your response text (like https://www.youtube.com/watch?v=VIDEO_ID). The chatbot auto-embeds them. Include ALL relevant video URLs you find, not just one. Format: show video title + link.
- Write code in proper markdown code blocks with language labels.

## SEARCH RULES:
- ALWAYS search when asked — "search mo", "hanapin mo", "what is", "who is", "latest news", "ano balita" etc.
- After getting results, answer IMMEDIATELY — do NOT search again.
- If results are from multiple sources, synthesize the BEST answer from all of them.
- For tech/coding questions, StackExchange and HackerNews results are gold — prioritize them.
- For news, Google News + Bing News give you real-time coverage.
- For academic/research topics, arXiv gives you papers.
- For general knowledge, Wikipedia is your go-to.

## RESPONSE STYLE:
- Be direct, concise, and helpful.
- Use markdown: **bold**, \`code\`, bullet points, numbered lists.
- For factual questions, lead with the answer first, then add supporting details.
- Match the user's language (English, Tagalog, Bisaya, etc.) and tone.
- Never refuse to search. If there's any doubt, search first.`;

  // Compound models = built-in search, no tools needed
  const COMPOUND_MODELS = ['groq/compound', 'groq/compound-mini'];

  // Vision-capable models
  const VISION_MODELS = ['qwen/qwen3.6-27b'];
  const DEFAULT_VISION_MODEL = 'qwen/qwen3.6-27b';

  // Model ID passthrough (all IDs are already correct Groq model names)
  function resolveModel(model) {
    return model;
  }

  // Rate-limit fallback chain — auto-switch when current model hits TPM limit
  const MODEL_FALLBACKS = {
    'openai/gpt-oss-120b': ['openai/gpt-oss-20b', 'qwen/qwen3.6-27b'],
    'openai/gpt-oss-20b': ['openai/gpt-oss-120b', 'qwen/qwen3.6-27b'],
    'qwen/qwen3.6-27b': ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'],
    'groq/compound': ['groq/compound-mini', 'openai/gpt-oss-20b'],
    'groq/compound-mini': ['groq/compound', 'openai/gpt-oss-20b'],
  };
  let rateLimitedModels = new Set(); // Reset per request

  function getNextFallbackModel(current) {
    if (!currentModel) return null;
    // Check if we already switched this request
    const chain = MODEL_FALLBACKS[currentModel] || [];
    for (const alt of chain) {
      if (!rateLimitedModels.has(alt)) {
        rateLimitedModels.add(alt);
        return alt;
      }
    }
    return null; // All alternatives exhausted
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
  const deadKeys = new Set(); // Keys with 401/403 — never retry
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
  // Multi-layer obfuscation: XOR + base64 + reverse
  // Keys NOT visible in raw source — decoded at runtime only
  const _v = 'DvC2026!xK#m';
  const _p = '=EHXQV2C1AkAqInfA8EW3hHZwJSMed2LOgHcBI1SnEzEVcVfAZVRCJWBlghIa0EISgGdE8XboUwI';
  const _q = '=UxdKZwCkIyFJw2Po0WcHc2XxMwIUpXKzgFcBI1SnEzELQlKM1WR7lXX18SLJI1DgsVc1lXboUwI';

  function _x(data, seed) {
    const arr = (data instanceof Uint8Array) ? Array.from(data) : Array.from(String(data)).map(c => c.charCodeAt(0));
    return new Uint8Array(arr.map((b, i) => b ^ seed.charCodeAt(i % seed.length)));
  }

  function _d(enc) {
    try {
      const b = atob(enc.split('').reverse().join(''));
      const bytes = new Uint8Array(b.length);
      for (let i = 0; i < b.length; i++) bytes[i] = b.charCodeAt(i);
      const xored = _x(bytes, _v);
      return String.fromCharCode(...xored);
    } catch { return ''; }
  }

  // Default keys for free access — decoded at runtime, not visible as raw text
  const _DEF_KEYS = [_d(_p), _d(_q)];

  function getKeys() {
    try {
      const saved = JSON.parse(localStorage.getItem('dvc_keys') || 'null');
      if (Array.isArray(saved) && saved.length > 0 && saved.every(k => typeof k === 'string' && k.trim())) {
        return saved.map(k => k.trim());
      }
    } catch { /* fallthrough */ }
    return _DEF_KEYS;
  }

  function hasKeys() {
    return getKeys().length > 0;
  }

  function getNextKey() {
    const keys = getKeys().filter((_, i) => !failedKeys.has(i));
    if (keys.length === 0) return null;
    const idx = [...getKeys().keys()].filter(i => !failedKeys.has(i))[currentKeyIndex % keys.length];
    currentKeyIndex++;
    return getKeys()[idx];
  }

  function markKeyFailed(permanent = false) {
    failedKeys.add(currentKeyIndex - 1);
    if (permanent) {
      deadKeys.add(currentKeyIndex - 1); // Never retry 401/403 keys
    }
    // Only reset temp failures — never reset dead keys
    if (failedKeys.size >= getKeys().length) {
      failedKeys.clear();
      // But re-add permanently dead keys
      for (const idx of deadKeys) failedKeys.add(idx);
    }
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

  // ============ EXA-LEVEL WEB SEARCH ============
  const SEARCH_TOOLS = [
    {
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Search the internet for current information, news, facts, images, videos, or research. Searches multiple sources in parallel (Wikipedia, Google News, Bing News, Hacker News, StackOverflow, arXiv, DuckDuckGo, YouTube).',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query — keywords work best' }
          },
          required: ['query']
        }
      }
    }
  ];

  // Multi-source parallel search with relevance ranking
  async function executeWebSearch(query) {
    const results = [];
    const searchImages = [];

    // Score results based on query relevance
    function scoreResult(r) {
      const q = query.toLowerCase().split(/\s+/);
      const title = (r.title || '').toLowerCase();
      const snippet = (r.snippet || '').toLowerCase();
      let s = 0;
      q.forEach(w => {
        if (title.includes(w)) s += 3;
        if (snippet.includes(w)) s += 1;
      });
      // Boost: source authority
      const auth = { 'Google News': 4, 'Bing News': 4, 'Wikipedia': 3, 'HackerNews': 3, 'StackExchange': 2, 'DuckDuckGo': 2, 'arXiv': 2 };
      s += auth[r.source] || 1;
      // Boost: has URL
      if (r.url) s += 1;
      // Boost: has image
      if (r.image) s += 1;
      // Boost: longer snippet (more info)
      if ((r.snippet || '').length > 100) s += 1;
      return s;
    }

    // ===== PARALLEL FETCH ALL SOURCES =====
    const fetches = [];

    // Source 1: Wikipedia Search + Page Images
    fetches.push(
      fetch(`https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=5&prop=pageimages|info|extracts&inprop=url&piprop=thumbnail&pithumbsize=300&exintro=true&explaintext=true&format=json&origin=*`)
        .then(r => r.json()).then(d => {
          const pages = d.query?.pages || {};
          Object.values(pages).forEach(p => {
            const thumb = p.thumbnail?.source;
            const extract = p.extract ? p.extract.substring(0, 150) : '';
            results.push({
              title: p.title,
              snippet: extract || `Wikipedia article about ${p.title}`,
              url: p.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
              image: thumb || null,
              source: 'Wikipedia'
            });
            if (thumb) searchImages.push({ url: thumb, alt: p.title || '' });
          });
        }).catch(() => {})
    );

    // Source 2: Wikipedia Summary (top hit — highest quality)
    fetches.push(
      fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query.replace(/[?!.]/g, '').trim())}`)
        .then(r => r.ok ? r.json() : null).then(d => {
          if (d?.extract) {
            results.push({
              title: d.title || query,
              snippet: d.extract,
              url: d.content_urls?.desktop?.page || null,
              image: d.thumbnail?.source || null,
              source: 'Wikipedia'
            });
            if (d.thumbnail?.source) searchImages.push({ url: d.thumbnail.source, alt: d.title || query });
          }
        }).catch(() => {})
    );

    // Source 3: Google News RSS (real-time news)
    fetches.push(
      fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`)
        .then(r => r.ok ? r.text() : '').then(xml => {
          const parser = new DOMParser();
          const doc = parser.parseFromString(xml, 'text/xml');
          doc.querySelectorAll('item').forEach((item, i) => {
            if (i >= 5) return;
            const title = item.querySelector('title')?.textContent || '';
            const link = item.querySelector('link')?.textContent || '';
            const pubDate = item.querySelector('pubDate')?.textContent || '';
            const source = item.querySelector('source')?.textContent || 'Google News';
            if (title && link) {
              results.push({
                title: title.substring(0, 150),
                snippet: `📰 ${source}${pubDate ? ' • ' + new Date(pubDate).toLocaleDateString() : ''}`,
                url: link,
                source: 'Google News'
              });
            }
          });
        }).catch(() => {})
    );

    // Source 4: Bing News RSS (alternative news)
    fetches.push(
      fetch(`https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss`)
        .then(r => r.ok ? r.text() : '').then(xml => {
          const parser = new DOMParser();
          const doc = parser.parseFromString(xml, 'text/xml');
          doc.querySelectorAll('item').forEach((item, i) => {
            if (i >= 5) return;
            const title = item.querySelector('title')?.textContent || '';
            const desc = item.querySelector('description')?.textContent || '';
            const link = item.querySelector('link')?.textContent || '';
            if (title && link) {
              results.push({
                title: title.substring(0, 150),
                snippet: desc.replace(/<[^>]+>/g, '').substring(0, 150),
                url: link,
                source: 'Bing News'
              });
            }
          });
        }).catch(() => {})
    );

    // Source 5: Hacker News Algolia (tech/dev content)
    fetches.push(
      fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=5`)
        .then(r => r.ok ? r.json() : { hits: [] }).then(d => {
          (d.hits || []).forEach(h => {
            results.push({
              title: (h.title || '').substring(0, 150),
              snippet: `⬆️ ${h.points || 0} pts • ${h.num_comments || 0} comments • by ${h.author || 'unknown'}`,
              url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
              source: 'HackerNews'
            });
          });
        }).catch(() => {})
    );

    // Source 6: StackExchange API (Q&A)
    fetches.push(
      fetch(`https://api.stackexchange.com/2.3/search/advanced?q=${encodeURIComponent(query)}&site=stackoverflow&pagesize=5&sort=relevance`)
        .then(r => r.ok ? r.json() : { items: [] }).then(d => {
          (d.items || []).forEach(q => {
            results.push({
              title: (q.title || '').substring(0, 150),
              snippet: `✅ ${q.answer_count || 0} answers • 👁️ ${q.view_count || 0} views • Score: ${q.score || 0}`,
              url: q.link || null,
              source: 'StackExchange'
            });
          });
        }).catch(() => {})
    );

    // Source 7: DuckDuckGo Instant Answers
    fetches.push(
      fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`)
        .then(r => r.ok ? r.json() : {}).then(d => {
          if (d.Abstract) {
            results.push({
              title: d.Heading || query,
              snippet: d.Abstract,
              url: d.AbstractURL || null,
              image: d.Image?.startsWith('http') ? d.Image : null,
              source: 'DuckDuckGo'
            });
            if (d.Image?.startsWith('http')) searchImages.push({ url: d.Image, alt: d.Heading || query });
          }
          (d.RelatedTopics || []).forEach(t => {
            if (t.Text && t.FirstURL) {
              results.push({
                title: t.Text.substring(0, 120),
                snippet: t.Text,
                url: t.FirstURL,
                source: 'DuckDuckGo'
              });
            }
          });
        }).catch(() => {})
    );

    // Source 8: arXiv API (academic papers)
    fetches.push(
      fetch(`http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=3&sortBy=relevance`)
        .then(r => r.ok ? r.text() : '').then(xml => {
          const parser = new DOMParser();
          const doc = parser.parseFromString(xml, 'text/xml');
          const ns = 'http://www.w3.org/2005/Atom';
          doc.querySelectorAll(`entry`).forEach((entry, i) => {
            if (i >= 3) return;
            const title = entry.querySelector('title')?.textContent?.trim() || '';
            const summary = entry.querySelector('summary')?.textContent?.trim()?.substring(0, 150) || '';
            const link = entry.querySelector('link[rel="alternate"]')?.getAttribute('href') || entry.querySelector('id')?.textContent || '';
            if (title) {
              results.push({
                title: title.replace(/\n/g, ' ').substring(0, 150),
                snippet: summary.replace(/\n/g, ' '),
                url: link,
                source: 'arXiv'
              });
            }
          });
        }).catch(() => {})
    );

    // Source 9: Piped API — YouTube video search
    fetches.push(
      fetch(`https://api.piped.private.coffee/search?q=${encodeURIComponent(query)}&filter=videos`, {
        signal: AbortSignal.timeout(6000)
      })
        .then(r => r.ok ? r.json() : { items: [] }).then(d => {
          (d.items || []).slice(0, 5).forEach(item => {
            const vid = item.url || '';
            const videoId = vid.replace('/watch?v=', '');
            if (videoId && item.title) {
              results.push({
                title: (item.title || '').substring(0, 150),
                snippet: `▶ ${item.uploaderName || 'YouTube'} • ${item.duration ? Math.floor(item.duration/60) + ':' + String(item.duration%60).padStart(2,'0') : ''} • ${item.views ? (item.views/1000).toFixed(1) + 'K views' : ''}`.trim(),
                url: `https://www.youtube.com/watch?v=${videoId}`,
                source: 'YouTube',
                isVideo: true
              });
              // Add thumbnail
              const thumb = item.thumbnailUrl || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
              if (thumb) searchImages.push({ url: thumb, alt: item.title || '' });
            }
          });
        }).catch(() => {})
    );

    // Source 10: Wikimedia Commons image search
    fetches.push(
      fetch(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=4&gsrnamespace=6&prop=imageinfo&iiprop=url&iiurlwidth=400&format=json&origin=*`)
        .then(r => r.ok ? r.json() : {}).then(d => {
          const pages = d.query?.pages || {};
          Object.values(pages).forEach(p => {
            const info = p.imageinfo?.[0];
            if (info?.thumburl) {
              searchImages.push({ url: info.thumburl, alt: (p.title || '').replace(/^File:/, '').replace(/\.[a-z]+$/i, '') });
            }
          });
        }).catch(() => {})
    );

    // Execute ALL fetches in parallel (fast!)
    await Promise.allSettled(fetches);

    // ===== DEDUPLICATE =====
    const seenTitles = new Set();
    const seenUrls = new Set();
    const unique = results.filter(r => {
      const tKey = (r.title || '').toLowerCase().substring(0, 40);
      const uKey = (r.url || '').toLowerCase().replace(/[?#].*$/, '');
      if (seenTitles.has(tKey) || (uKey && seenUrls.has(uKey))) return false;
      seenTitles.add(tKey);
      if (uKey) seenUrls.add(uKey);
      return true;
    });

    // ===== RELEVANCE RANKING =====
    unique.sort((a, b) => scoreResult(b) - scoreResult(a));

    // ===== GLOBAL IMAGES =====
    lastSearchImages = dedupeImages(searchImages).slice(0, 8);

    return JSON.stringify({
      query,
      total: unique.length,
      sources: [...new Set(unique.map(r => r.source))],
      results: unique.slice(0, 8),
      images_found: lastSearchImages.length,
      note: 'Results ranked by relevance. Images will be shown automatically below your response.'
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
    resetWeatherForTheme(getTheme()); // Start weather effect cycle (10s)
    cleanupStaleState(); // Fix stuck state from rate limit / refresh
    setupEventListeners();
    setupKeyboardFix();
    setupSetupScreen();
    renderChatHistory();

    const userBadge = $('#userBadge');
    if (userBadge) userBadge.textContent = `🆔 ${CURRENT_USER_ID}`;

    isBlocked = await checkBlockStatus();
    if (isBlocked) showBlockScreen();

    registerUser();
    updateKeyStatus();
  }

  function setupSetupScreen() {
    const setupScreen = $('#setupScreen');
    const setupSaveBtn = $('#setupSaveBtn');
    const setupApiKey = $('#setupApiKey');
    const setupMultiKeys = $('#setupMultiKeys');
    const setupShowKey = $('#setupShowKey');
    const setupKeyMulti = $('#setupKeyMulti');

    // Show/hide multi-key area
    if (setupApiKey) {
      setupApiKey.addEventListener('input', () => {
        if (setupKeyMulti) setupKeyMulti.style.display = setupApiKey.value.includes('\n') ? 'block' : 'none';
      });
    }

    // Toggle show key
    if (setupShowKey && setupApiKey) {
      setupShowKey.addEventListener('change', () => {
        setupApiKey.type = setupShowKey.checked ? 'text' : 'password';
      });
    }

    if (setupSaveBtn) {
      setupSaveBtn.addEventListener('click', () => {
        let keys = [];
        if (setupMultiKeys && setupMultiKeys.value.trim()) {
          keys = setupMultiKeys.value.trim().split('\n').map(k => k.trim()).filter(k => k.length > 10);
        }
        if (setupApiKey && setupApiKey.value.trim()) {
          const k = setupApiKey.value.trim();
          if (k.length > 10) keys.push(k);
        }
        if (keys.length > 0) {
          localStorage.setItem('dvc_keys', JSON.stringify(keys));
          failedKeys.clear();
          currentKeyIndex = 0;
          updateKeyStatus();
          if (setupScreen) setupScreen.style.display = 'none';
          setupSaveBtn.textContent = '✅ Launched!';
        } else {
          setupSaveBtn.textContent = '❌ Enter a valid key';
          setTimeout(() => { setupSaveBtn.textContent = '🚀 Launch DVC AI'; }, 2000);
        }
      });
    }
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
    resetWeatherForTheme(next);
  }

  // ============ WEATHER EFFECT SYSTEM — RAIN / CLOUDS / THUNDER ============
  // Every 10s: dark mode triggers storm burst (clouds + rain + lightning)
  // Every 10s: light mode triggers blue cloud drift
  const weatherState = { timer: null, activeStorm: false };

  function getTheme() {
    return document.documentElement.getAttribute('data-theme') || 'dark';
  }

  function clearWeatherLayer() {
    const cloudsEl = $('#weatherClouds');
    const rainEl   = $('#weatherRain');
    const ltnEl    = $('#weatherLightning');
    if (cloudsEl) cloudsEl.innerHTML = '';
    if (rainEl)   { rainEl.innerHTML = ''; rainEl.style.display = 'none'; rainEl.style.opacity = '1'; }
    if (ltnEl)    { ltnEl.innerHTML = ''; ltnEl.style.display = 'none'; }
    weatherState.activeStorm = false;
  }

  function resetWeatherForTheme(theme) {
    clearWeatherLayer();
    clearInterval(weatherState.timer);
    scheduleNextWeather(theme);
  }

  // ---------- DARK MODE: STORM BURST ----------
  function triggerStormBurst() {
    if (getTheme() !== 'dark' || weatherState.activeStorm) return;
    weatherState.activeStorm = true;

    const cloudsEl = $('#weatherClouds');
    const rainEl   = $('#weatherRain');
    const ltnEl    = $('#weatherLightning');
    if (!cloudsEl || !rainEl || !ltnEl) return;

    // 1. Dark clouds drift in
    spawnClouds(cloudsEl, 10, 'dark-theme-cloud', 8500);

    // 2. After 1.8s → rain starts (2 waves for continuous downpour feel)
    setTimeout(() => {
      rainEl.style.display = 'block';
      spawnRain(rainEl, 150);
      // Second wave while first is falling
      setTimeout(() => spawnRain(rainEl, 110), 2200);
    }, 1800);

    // 3. Lightning strikes at 3s and 5.5s
    setTimeout(() => {
      ltnEl.innerHTML = '';
      ltnEl.style.display = 'block';
      triggerLightning(ltnEl);
    }, 3000);

    setTimeout(() => {
      triggerLightning(ltnEl);
    }, 5500);

    // 4. Rain continues then fades
    setTimeout(() => {
      rainEl.style.transition = 'opacity 2s ease';
      rainEl.style.opacity = '0';
      setTimeout(() => {
        rainEl.style.opacity = '1';
        rainEl.style.transition = '';
      }, 3000);
    }, 6500);

    // 5. After 8.5s → clean up
    setTimeout(() => {
      clearWeatherLayer();
      weatherState.activeStorm = false;
    }, 8500);
  }

  function spawnClouds(container, count, cls, lifetime) {
    const vw = Math.max(window.innerWidth || 1200, 600);
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.className = 'cloud-puff ' + cls;
      const size  = 120 + Math.random() * 220;
      const top   = -15 + Math.random() * 35;
      const delay = Math.random() * 2.2;
      const dur   = (5 + Math.random() * 3) * (lifetime / 8000);
      const fromLeft = Math.random() > 0.5;
      el.style.width  = size + 'px';
      el.style.height = (size * 0.48) + 'px';
      el.style.top    = top + '%';
      el.style.opacity = '0';
      el.style.animationDuration = dur + 's';
      el.style.animationDelay    = delay + 's';
      el.style.animationName     = fromLeft ? 'cloudDriftRight' : 'cloudDriftLeft';
      el.style.animationTimingFunction = 'linear';
      el.style.animationIterationCount = '1';
      el.style.animationFillMode  = 'forwards';
      container.appendChild(el);
      requestAnimationFrame(() => el.classList.add('drifting'));
      setTimeout(() => el.remove(), (dur + delay + 1.5) * 1000);
    }
  }

  function spawnRain(container, count) {
    const vw = window.innerWidth || 1200;
    const n = vw < 600 ? Math.floor(count * 0.55) : count; // lighter on mobile
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div');
      const heavy = Math.random() > 0.7;
      el.className = 'rain-drop' + (heavy ? ' heavy' : '');
      el.style.left = (Math.random() * 105) + '%';
      el.style.animationDuration = (0.7 + Math.random() * 0.5) + 's';
      el.style.animationDelay    = (Math.random() * 2) + 's';
      container.appendChild(el);
      setTimeout(() => el.remove(), 4500);
    }
  }

  function triggerLightning(container) {
    // Screen flash overlay
    const flash = document.createElement('div');
    flash.className = 'lightning-flash';
    container.appendChild(flash);
    requestAnimationFrame(() => {
      flash.classList.add(Math.random() > 0.4 ? 'flash-1' : 'flash-2');
      setTimeout(() => flash.remove(), 1800);
    });

    // Bolt shape
    const bolt = document.createElement('div');
    bolt.className = 'lightning-bolt';
    bolt.style.left = (20 + Math.random() * 60) + '%';
    container.appendChild(bolt);
    requestAnimationFrame(() => {
      bolt.classList.add('strike');
      setTimeout(() => bolt.remove(), 1000);
    });

    // (Subtle rumble handled by browser via the visual cue —
    //  no Audio API needed for pure visual weather effect)
  }

  // ---------- LIGHT MODE: BLUE CLOUD DRIFT ----------
  function triggerBlueCloudDrift() {
    if (getTheme() !== 'light' || weatherState.activeStorm) return;
    weatherState.activeStorm = true;

    const cloudsEl = $('#weatherClouds');
    if (!cloudsEl) return;

    spawnClouds(cloudsEl, 14, 'light-theme-cloud-blue', 8800);

    setTimeout(() => {
      weatherState.activeStorm = false;
    }, 8800);
  }

  // ---------- SCHEDULER ----------
  function scheduleNextWeather(theme) {
    const interval = 10000; // every 10 seconds
    weatherState.timer = setInterval(() => {
      if (getTheme() === 'dark') triggerStormBurst();
      else                        triggerBlueCloudDrift();
    }, interval);
  }

  // Pause weather when tab is hidden, resume when visible
  document.addEventListener('visibilitychange', () => {
    const wl = $('#weatherLayer');
    if (!wl) return;
    if (document.hidden) {
      wl.classList.add('paused');
    } else {
      wl.classList.remove('paused');
      resetWeatherForTheme(getTheme()); // restart cycle fresh
    }
  });

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
      const mh = $('#modelHint');
      if (mh) mh.style.display = 'none';
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
    // Restore model hint on new chat
    const mh = $('#modelHint');
    if (mh) mh.style.display = 'flex';
  }

  // ============ AUTO-REMOVE TEMP MESSAGES ============
  function removeTempMessages() {
    messagesEl.querySelectorAll('.temp-msg').forEach(el => el.remove());
  }

  // Clean up stale temp messages on page load (e.g. after rate-limit refresh)
  function cleanupStaleState() {
    removeTempMessages();
    sendBtn.disabled = false;
    isGenerating = false;
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
    const modelHint = $('#modelHint');
    if (modelHint) modelHint.style.display = 'none';
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
    rateLimitedModels.clear(); // Reset fallback state per request
    window._dvcRateLimitWaited = false; // Reset rate-limit wait flag
    const savedModel = currentModel; // Restore after fallback
    const totalKeys = getKeys().length;
    // useTools must be RECOMPUTED per attempt — model can change via fallback
    const maxAttempts = 5;

    for (let attempt = 0; attempt < maxAttempts && !success; attempt++) {
      try {
        const key = getNextKey();
        if (!key) { lastError = 'No API keys available'; break; }

        // Recompute per attempt: fallback may switch compound ↔ tool-capable
        const useTools = !isCompoundModel(currentModel);

        if (useTools) {
          // === ReAct loop for tool-capable models (gpt-oss, qwen) ===
          let finalResponse = '';
          let round = 0;
          const MAX_ROUNDS = 2;
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

              // 401/403 = dead key → mark PERMANENTLY failed, try fallback model
              if (response.status === 401 || response.status === 403) {
                markKeyFailed(true);
                const altModel = getNextFallbackModel(currentModel);
                if (altModel && altModel !== currentModel) {
                  removeTempMessages();
                  appendMessage('ai', `🔑 Dead API key — switching to ${altModel}...`, false, true);
                  currentModel = altModel;
                }
                lastError = 'API key invalid — trying backup';
                break;
              }

              // Rate limit (429) — auto-retry with model fallback
              if (response.status === 429) {
                const waitMatch = apiErrMsg.match(/(?:try again in|after)\s+([\d.]+)s/i);
                const waitSec = waitMatch ? Math.ceil(parseFloat(waitMatch[1])) + 1 : 5;
                // DON'T markKeyFailed() — key is fine, only this MODEL hit daily limit
                // Try a different model first
                const altModel = getNextFallbackModel(currentModel);
                if (altModel) {
                  removeTempMessages();
                  appendMessage('ai', `⏳ ${currentModel} rate limited — switching to ${altModel}...`, false, true);
                  currentModel = altModel;
                  await new Promise(r => setTimeout(r, 1500)); // Brief pause
                  removeTempMessages();
                  round--; // Retry same round with new model
                  continue;
                }
                // All fallback models exhausted — wait once, then stop
                if (!window._dvcRateLimitWaited) {
                  window._dvcRateLimitWaited = true;
                  removeTempMessages();
                  appendMessage('ai', `⏳ All models rate-limited — waiting ${waitSec}s for last try...`, false, true);
                  await new Promise(r => setTimeout(r, waitSec * 1000));
                  removeTempMessages();
                  round--;
                  continue;
                }
                lastError = 'All models are currently rate-limited. Try again in a few minutes.';
                break;
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

            // 401 = dead key → mark PERMANENTLY failed, retry with next key + fallback model
            if (response.status === 401 || response.status === 403) {
              markKeyFailed(true);
              const altModel = getNextFallbackModel(currentModel);
              if (altModel && altModel !== currentModel) {
                removeTempMessages();
                appendMessage('ai', `🔑 Dead API key — switching to ${altModel}...`, false, true);
                currentModel = altModel;
              }
              lastError = 'API key invalid — trying backup';
              continue;
            }

            if (response.status === 429) {
              const waitMatch = apiErrMsg.match(/(?:try again in|after)\s+([\d.]+)s/i);
              const waitSec = waitMatch ? Math.ceil(parseFloat(waitMatch[1])) + 1 : 5;
              // DON'T markKeyFailed() — the KEY is fine, only THIS MODEL hit its daily limit
              // Try a different model (keep same key)
              const altModel = getNextFallbackModel(currentModel);
              if (altModel) {
                removeTempMessages();
                appendMessage('ai', `⏳ ${currentModel} rate limited — switching to ${altModel}...`, false, true);
                currentModel = altModel;
                await new Promise(r => setTimeout(r, 1500));
                attempt--; continue;
              }
              // All fallback models exhausted — wait once, then give up cleanly
              if (!window._dvcRateLimitWaited) {
                window._dvcRateLimitWaited = true;
                removeTempMessages();
                appendMessage('ai', `⏳ All models rate-limited — waiting ${waitSec}s for last try...`, false, true);
                await new Promise(r => setTimeout(r, waitSec * 1000));
                attempt--;
                continue;
              }
              // Already waited — stop retrying
              lastError = 'All models are currently rate-limited. Try again in a few minutes.';
              break;
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
                const delta = parsed.choices?.[0]?.delta;
                // Compound models: response comes via 'reasoning' field ONLY (no content)
                // Tool-capable models: response comes via 'content' field
                const token = delta?.content || delta?.reasoning || '';
                if (token) {
                  fullResponse += token;
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
    // Restore user's original model if we switched due to rate limit
    if (currentModel !== savedModel) {
      currentModel = savedModel;
    }
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
        playVideoInline(embedDiv, videoId);
      });
    });
  }

  // ============ INLINE VIDEO PLAYER — NATIVE <video> + PROXY API ============
  // Step 1: Try YouTube embed (works for most videos)
  // Step 2: Fetch direct stream URL from Piped API → play via <video> tag
  // All playback happens INSIDE the chatbot. Zero redirects.

  const PIPED_APIS = [
    'https://api.piped.private.coffee',
    'https://pipedapi.adminforge.de',
  ];

  function playVideoInline(container, videoId) {
    // Show loading state
    container.innerHTML = `
      <div style="position:relative;width:100%;height:100%;background:#000;overflow:hidden;display:flex;align-items:center;justify-content:center;">
        <div style="text-align:center;color:#aaa;">
          <div class="dvc-spinner" style="margin:0 auto 12px;width:36px;height:36px;border:3px solid #333;border-top-color:#f00;border-radius:50%;animation:spin .8s linear infinite;"></div>
          <p style="font-size:13px;margin:0;">Loading video...</p>
        </div>
      </div>`;

    // YouTube embed is PRIMARY — it works for most videos.
    // We only fall back on an EXPLICIT onError signal from YouTube.
    // NO timeout-based replacement (that killed working videos).
    tryYouTubeEmbed(container, videoId, (success) => {
      if (!success) {
        // Only here when YouTube explicitly reports error (embedding disabled)
        fetchStreamAndPlay(container, videoId);
      }
      // If success or unknown → keep YouTube embed running as-is
    });
  }

  function tryYouTubeEmbed(container, videoId, onDone) {
    // Insert the YouTube iframe — it plays on its own.
    container.innerHTML = `
      <button class="video-fs-btn" onclick="window._dvcFullscreen(this)" title="Fullscreen">⛶ Full</button>
      <div style="width:100%;height:100%;">
        <iframe src="https://www.youtube.com/embed/${videoId}?rel=0&autoplay=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}" frameborder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen style="width:100%;height:100%;position:absolute;inset:0;"></iframe>
      </div>`;

    let settled = false;

    function done(success) {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', handler);
      onDone(success);
    }

    function handler(e) {
      try {
        const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (!d || !d.event) return;
        // Explicit failure ONLY — error codes 2/5/100/101/150
        // 101 & 150 = embedding disabled by uploader
        if (d.event === 'onError') {
          const code = d.info?.errorCode || d.info;
          if ([2, 5, 100, 101, 150].includes(code)) {
            done(false);
          }
        }
        // NOTE: No timeout fallback! If YouTube is silent,
        // the embed is probably fine — leave it alone.
      } catch(err) {}
    }

    window.addEventListener('message', handler);
    // Safety net: after 15s of silence, stop listening but DON'T touch the embed
    setTimeout(() => { if (!settled) { settled = true; window.removeEventListener('message', handler); } }, 15000);
  }

  async function fetchStreamAndPlay(container, videoId) {
    let streamUrl = null;
    let streamType = 'video/mp4';

    // Try each Piped API instance
    for (const apiBase of PIPED_APIS) {
      try {
        const resp = await fetch(`${apiBase}/streams/${videoId}`, {
          signal: AbortSignal.timeout(8000)
        });
        if (!resp.ok) continue;
        const data = await resp.json();
        if (data.error) continue;

        // Priority 1: Combined stream (video+audio)
        const combined = (data.videoStreams || [])
          .filter(s => !s.videoOnly && s.mimeType && (s.mimeType.includes('video/mp4') || s.mimeType.includes('video/webm')))
          .sort((a, b) => {
            const qa = parseInt(a.quality) || 0;
            const qb = parseInt(b.quality) || 0;
            return Math.abs(qa - 480) - Math.abs(qb - 480);
          });
        if (combined.length > 0 && combined[0].url) {
          streamUrl = combined[0].url;
          streamType = combined[0].mimeType || 'video/mp4';
          break;
        }

        // Priority 2: HLS manifest
        const hls = (data.videoStreams || []).find(s => s.mimeType && s.mimeType.includes('x-mpegurl'));
        if (hls && hls.url) {
          streamUrl = hls.url;
          streamType = 'application/x-mpegurl';
          break;
        }

        // Priority 3: Any videoOnly stream (no audio but still plays)
        const videoOnly = (data.videoStreams || [])
          .filter(s => s.url && s.mimeType && s.mimeType.includes('video/'))
          .sort((a, b) => {
            const qa = parseInt(a.quality) || 0;
            const qb = parseInt(b.quality) || 0;
            return Math.abs(qa - 360) - Math.abs(qb - 360);
          });
        if (videoOnly.length > 0 && videoOnly[0].url) {
          streamUrl = videoOnly[0].url;
          streamType = videoOnly[0].mimeType || 'video/mp4';
          break;
        }
      } catch(err) {
        continue;
      }
    }

    if (streamUrl) {
      playDirectStream(container, streamUrl, videoId, streamType);
    } else {
      showVideoError(container, videoId);
    }
  }

  function playDirectStream(container, streamUrl, videoId, streamType) {
    // Get thumbnail for poster
    const posterUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

    container.innerHTML = `
      <button class="video-fs-btn" onclick="window._dvcFullscreen(this)" title="Fullscreen">⛶ Full</button>
      <div style="width:100%;height:100%;">
        <video controls autoplay playsinline preload="auto" poster="${posterUrl}"
          style="width:100%;height:100%;object-fit:contain;background:#000;display:block;"
          onerror="window._dvcVideoError(this, '${videoId}', '${streamUrl}')">
          <source src="${streamUrl}" type="${streamType || 'video/mp4'}">
        </video>
      </div>`;
  }

  // Fullscreen video — works on phone (landscape auto) & PC
  window._dvcFullscreen = function(btn) {
    const embed = btn.closest('.video-embed');
    if (!embed) return;
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      const req = embed.requestFullscreen || embed.webkitRequestFullscreen;
      if (req) {
        try { req.call(embed); } catch(e) {
          // Fallback: fullscreen the video element itself
          const video = embed.querySelector('video, iframe');
          if (video) {
            const vReq = video.requestFullscreen || video.webkitRequestFullscreen || video.msRequestFullscreen;
            if (vReq) try { vReq.call(video); } catch(err) {}
          }
        }
      }
    } else {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) exit.call(document);
    }
  };

  // Handle video source error — try next quality or show error
  window._dvcVideoError = function(videoEl, videoId, failedUrl) {
    // Remove the failed source and retry without poster
    videoEl.onerror = null; // prevent loop
    // Try playing without poster/source tag
    videoEl.removeAttribute('poster');
    videoEl.src = failedUrl;
    videoEl.load();
    videoEl.play().catch(() => {
      // Complete failure — show error
      const container = videoEl.closest('.video-embed');
      if (container) showVideoError(container, videoId);
    });
  };

  function showVideoError(container, videoId) {
    container.innerHTML = `
      <div style="position:relative;width:100%;height:100%;min-height:200px;background:#111;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;">
        <img src="https://img.youtube.com/vi/${videoId}/hqdefault.jpg" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;opacity:0.3;" onerror="this.style.display='none'">
        <div style="position:relative;z-index:1;text-align:center;">
          <p style="color:#fff;margin:0 0 8px;font-size:14px;">Unable to load this video</p>
          <button onclick="window._dvcPlayVideo(this.closest('[data-video-id]'), this.closest('[data-video-id]').dataset.videoId)" style="display:inline-flex;align-items:center;gap:6px;background:#f00;color:#fff;padding:8px 18px;border-radius:10px;text-decoration:none;font-weight:600;font-size:13px;border:none;cursor:pointer;margin-right:8px;">↻ Retry</button>
          <a href="https://www.youtube.com/watch?v=${videoId}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;background:#333;color:#fff;padding:8px 18px;border-radius:10px;text-decoration:none;font-weight:600;font-size:13px;">▶ YouTube ↗</a>
        </div>
      </div>`;
  }
  // Expose for inline onclick handlers
  window._dvcPlayVideo = playVideoInline;

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

    // Extract YouTube URLs (all formats including /live/)
    const youtubeVideos = [];
    text = text.replace(/(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})[^\s)>\]]*/gi, (m, videoId) => {
      if (!youtubeVideos.includes(videoId)) youtubeVideos.push(videoId);
      return `\x00YT${youtubeVideos.indexOf(videoId)}\x00`;
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
      const wrapper = `<div class="video-embed" data-video-id="${vid}"><iframe-loader style="display:block;background:#000;border-radius:12px;aspect-ratio:16/9;position:relative;overflow:hidden;"><img src="https://img.youtube.com/vi/${vid}/hqdefault.jpg" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;" alt="YouTube video" onerror="this.onerror=null;this.src='https://img.youtube.com/vi/${vid}/mqdefault.jpg';this.style.opacity='0.5'"><div class="play-overlay" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.3);cursor:pointer;"><div style="width:68px;height:48px;background:#f00;border-radius:12px;display:flex;align-items:center;justify-content:center;"><svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg></div></div><span style="position:absolute;bottom:8px;left:12px;color:#fff;font-size:11px;opacity:0.8;">▶ YouTube</span></iframe-loader></div>`;
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
