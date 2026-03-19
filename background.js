/**
 * MemoryBridge - Background Service Worker
 *
 * ============================================================
 * PRIVACY & DATA STORAGE NOTICE
 * ============================================================
 * This extension stores the following data LOCALLY in IndexedDB
 * on this device only. No data is ever sent to external servers
 * except as described below.
 *
 * What is stored:
 *   - Chat messages (role + text content) from Claude, Gemini, ChatGPT
 *   - AI-generated or locally-generated summaries of those conversations
 *   - Timestamps and platform identifiers
 *   - A running "global memory" summary string
 *
 * What is NOT stored:
 *   - Messages containing "password", "ssn", or "credit card" (filtered)
 *   - Any authentication tokens or session cookies
 *   - Browsing history outside of the three supported AI platforms
 *
 * Optional network request:
 *   - If the user provides an Anthropic API key, conversation messages
 *     are sent to api.anthropic.com for summarization only.
 *     The API key is stored in chrome.storage.local and never logged.
 *
 * All other data remains 100% on-device.
 * ============================================================
 */

import MemoryDB from './memory/db.js';

const db = new MemoryDB();

// ── Sensitive content filter ──────────────────────────────────────────────────

const SENSITIVE_PATTERNS = [
  /password/i,
  /\bssn\b/i,
  /social security/i,
  /credit card/i,
  /\bcvv\b/i,
  /\bpin\b\s*[:=]/i,
];

function containsSensitiveContent(text) {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(text));
}

function filterMessages(messages) {
  return messages.filter(
    (msg) => !containsSensitiveContent(typeof msg.content === 'string' ? msg.content : '')
  );
}

// ── Summarization ─────────────────────────────────────────────────────────────

async function getApiKey() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['anthropicApiKey'], (result) => {
      resolve(result.anthropicApiKey || null);
    });
  });
}

function localSummarize(messages) {
  // Simple fallback: take first sentence of every 3rd user message
  const userMessages = messages.filter((m) => m.role === 'user');
  const picked = userMessages.filter((_, i) => i % 3 === 0).slice(0, 5);
  return picked
    .map((m) => {
      const text = typeof m.content === 'string' ? m.content : '';
      const sentence = text.split(/[.!?]/)[0].trim();
      return sentence.length > 10 ? sentence : null;
    })
    .filter(Boolean)
    .join('. ');
}

async function summarizeConversation(messages) {
  const apiKey = await getApiKey();

  if (apiKey) {
    try {
      const textMessages = messages.map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: typeof m.content === 'string' ? m.content : '',
      }));

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          messages: [
            {
              role: 'user',
              content: `Please compress the following conversation into a 3-5 sentence memory summary. Capture: what the user was working on, key decisions made, preferences expressed, and any important facts mentioned. Be concise and third-person neutral.\n\nConversation:\n${textMessages
                .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
                .join('\n\n')}`,
            },
          ],
        }),
      });

      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const data = await response.json();
      return data.content?.[0]?.text || localSummarize(messages);
    } catch (err) {
      console.warn('[MemoryBridge] API summarization failed, using local fallback:', err);
      return localSummarize(messages);
    }
  }

  return localSummarize(messages);
}

// ── Core conversation handling ────────────────────────────────────────────────

async function receiveConversation(platform, messages) {
  try {
    const filtered = filterMessages(messages);
    if (filtered.length === 0) return;

    const conversationId = await db.saveConversation(platform, filtered);

    if (filtered.length >= 6) {
      const summary = await summarizeConversation(filtered);
      if (summary) {
        const topics = extractTopics(filtered);
        await db.updateSummary(conversationId, summary, topics);
      }
    }
  } catch (err) {
    console.error('[MemoryBridge] Failed to save conversation:', err);
    setBadgeError();
  }
}

function extractTopics(messages) {
  // Simple keyword extraction from user messages
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'it', 'i', 'you', 'we', 'this', 'that',
    'was', 'are', 'be', 'have', 'has', 'do', 'did', 'will', 'can', 'my',
    'your', 'me', 'how', 'what', 'when', 'why', 'where', 'who',
  ]);

  const wordCount = {};
  messages
    .filter((m) => m.role === 'user')
    .forEach((m) => {
      const words = (m.content || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 3 && !stopWords.has(w));
      words.forEach((w) => {
        wordCount[w] = (wordCount[w] || 0) + 1;
      });
    });

  return Object.entries(wordCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);
}

// ── Memory prompt builder ─────────────────────────────────────────────────────

const PLATFORM_LABELS = {
  claude: 'Claude',
  gemini: 'Gemini',
  chatgpt: 'ChatGPT',
};

function formatTimeAgo(date) {
  const d = date instanceof Date ? date : new Date(date);
  const diff = Date.now() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'just now';
}

function formatDateShort(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

async function buildMemoryPrompt() {
  try {
    const summaries = await db.getRecentSummaries(10);
    if (summaries.length === 0) return null;

    const validSummaries = summaries.filter((s) => s.summary && s.summary.trim().length > 0);
    if (validSummaries.length === 0) return null;

    const lines = validSummaries.map((s) => {
      const label = PLATFORM_LABELS[s.platform] || s.platform;
      const date = formatDateShort(s.timestamp);
      return `[${date} - ${label}]: ${s.summary.trim()}`;
    });

    return `## Your Memory (from previous conversations)\n${lines.join('\n')}`;
  } catch (err) {
    console.error('[MemoryBridge] Failed to build memory prompt:', err);
    return null;
  }
}

// ── Badge helpers ─────────────────────────────────────────────────────────────

function setBadgeError() {
  chrome.action.setBadgeText({ text: '!' });
  chrome.action.setBadgeBackgroundColor({ color: '#e53e3e' });
}

function clearBadge() {
  chrome.action.setBadgeText({ text: '' });
}

// ── Message listener ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, platform, messages } = message;

  if (type === 'SAVE_CONVERSATION') {
    receiveConversation(platform, messages || [])
      .then(() => {
        clearBadge();
        sendResponse({ success: true });
      })
      .catch((err) => {
        console.error('[MemoryBridge] SAVE_CONVERSATION error:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // keep channel open for async response
  }

  if (type === 'GET_MEMORY') {
    buildMemoryPrompt()
      .then((prompt) => sendResponse({ success: true, prompt }))
      .catch((err) => {
        console.error('[MemoryBridge] GET_MEMORY error:', err);
        sendResponse({ success: false, prompt: null });
      });
    return true;
  }

  if (type === 'CLEAR_MEMORY') {
    db.clearAll()
      .then(() => {
        clearBadge();
        sendResponse({ success: true });
      })
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (type === 'EXPORT_MEMORY') {
    db.exportAll()
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (type === 'GET_STATS') {
    Promise.all([db.getConversationCount(), db.getRecentSummaries(1)])
      .then(([count, recent]) => {
        const last = recent[0] || null;
        sendResponse({
          success: true,
          count,
          lastPlatform: last ? last.platform : null,
          lastTimestamp: last ? last.timestamp : null,
        });
      })
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});
