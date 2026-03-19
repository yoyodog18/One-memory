/**
 * MemoryBridge - Gemini Content Script (gemini.google.com)
 * Scrapes conversations and injects memory context into new chats.
 */

(function () {
  'use strict';

  const PLATFORM = 'gemini';
  const SCRAPE_INTERVAL_MS = 30000;
  const INJECTION_DEBOUNCE_MS = 2500;

  let lastMessageCount = 0;
  let injectedThisSession = false;
  let scrapeTimer = null;

  // ── DOM Selectors ───────────────────────────────────────────────────────────
  // Gemini uses Angular-style components. These selectors target the most
  // stable available elements across recent Gemini UI versions.

  function getInputBox() {
    return (
      document.querySelector('div[role="textbox"][contenteditable="true"]') ||
      document.querySelector('rich-textarea div[contenteditable="true"]') ||
      document.querySelector('.ql-editor') ||
      document.querySelector('div[contenteditable="true"]')
    );
  }

  function scrapeMessages() {
    const messages = [];

    try {
      // User bubbles — Gemini wraps user text in .user-query or similar
      const userEls = document.querySelectorAll(
        '.user-query-bubble-with-background, .user-query, ' +
        '[class*="user-query"], [class*="userQuery"], ' +
        'user-query, .query-text'
      );
      userEls.forEach((el) => {
        const text = el.innerText?.trim();
        if (text) messages.push({ role: 'user', content: text });
      });

      // Model / assistant bubbles
      const modelEls = document.querySelectorAll(
        '.model-response-text, .response-content, ' +
        '[class*="model-response"], [class*="modelResponse"], ' +
        'model-response, .markdown-main-panel'
      );
      modelEls.forEach((el) => {
        const text = el.innerText?.trim();
        if (text) messages.push({ role: 'assistant', content: text });
      });

      // Fallback: look for conversation containers
      if (messages.length === 0) {
        const container = document.querySelector(
          '.conversation-container, [class*="conversation-container"], ' +
          'chat-history, .chat-history'
        );
        if (container) {
          const turns = container.querySelectorAll('[class*="turn"], [class*="message"]');
          turns.forEach((turn) => {
            const text = turn.innerText?.trim();
            if (!text) return;
            const isUser =
              turn.classList.toString().toLowerCase().includes('user') ||
              turn.querySelector('[class*="user"]') !== null;
            messages.push({ role: isUser ? 'user' : 'assistant', content: text });
          });
        }
      }

      // Deduplicate sequential same-role messages
      const deduped = [];
      messages.forEach((m) => {
        if (deduped.length === 0 || deduped[deduped.length - 1].role !== m.role) {
          deduped.push(m);
        }
      });

      return deduped;
    } catch (err) {
      console.debug('[MemoryBridge/Gemini] scrapeMessages error:', err);
      return [];
    }
  }

  function isNewEmptyChat() {
    try {
      const msgs = scrapeMessages();
      // Also check if we're on the home/new-chat route
      const isHome = location.pathname === '/' || location.pathname === '/app';
      return (msgs.length === 0 || isHome) && !injectedThisSession;
    } catch {
      return false;
    }
  }

  // ── Injection ───────────────────────────────────────────────────────────────

  function showToast(text) {
    try {
      const existing = document.getElementById('memorybridge-toast');
      if (existing) existing.remove();

      const toast = document.createElement('div');
      toast.id = 'memorybridge-toast';
      toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: #1a1a2e;
        color: #e2e8f0;
        padding: 10px 16px;
        border-radius: 8px;
        font-size: 13px;
        font-family: system-ui, sans-serif;
        border: 1px solid #4a5568;
        z-index: 999999;
        opacity: 1;
        transition: opacity 0.5s ease;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      `;
      toast.textContent = text;
      document.body.appendChild(toast);

      setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 600);
      }, 3000);
    } catch (err) {
      console.debug('[MemoryBridge/Gemini] toast error:', err);
    }
  }

  function injectMemory(memoryPrompt) {
    try {
      const inputBox = getInputBox();
      if (!inputBox) {
        showToast("MemoryBridge: couldn't auto-load memory. Open extension to copy manually.");
        return false;
      }

      const injectionText =
        `[MemoryBridge Context — you can delete this]\n${memoryPrompt}\n---\n`;

      inputBox.focus();
      inputBox.innerText = injectionText;

      // Gemini uses Angular + rich text editor — dispatch both input and keyup
      inputBox.dispatchEvent(new Event('input', { bubbles: true }));
      inputBox.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      inputBox.dispatchEvent(new Event('change', { bubbles: true }));

      // Place cursor at end
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(inputBox);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);

      injectedThisSession = true;
      showToast('MemoryBridge: memory loaded ✓');
      return true;
    } catch (err) {
      console.debug('[MemoryBridge/Gemini] inject error:', err);
      showToast("MemoryBridge: couldn't auto-load memory. Open extension to copy manually.");
      return false;
    }
  }

  async function tryInjectMemory() {
    if (injectedThisSession) return;
    if (!isNewEmptyChat()) return;

    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_MEMORY' });
      if (response?.success && response.prompt) {
        injectMemory(response.prompt);
      }
    } catch (err) {
      console.debug('[MemoryBridge/Gemini] tryInjectMemory error:', err);
    }
  }

  // ── Scraping loop ───────────────────────────────────────────────────────────

  function saveCurrentConversation() {
    try {
      const messages = scrapeMessages();
      if (messages.length > 0 && messages.length !== lastMessageCount) {
        lastMessageCount = messages.length;
        chrome.runtime.sendMessage({
          type: 'SAVE_CONVERSATION',
          platform: PLATFORM,
          messages,
        }).catch(() => {});
      }
    } catch (err) {
      console.debug('[MemoryBridge/Gemini] saveCurrentConversation error:', err);
    }
  }

  function startScrapeLoop() {
    if (scrapeTimer) clearInterval(scrapeTimer);
    scrapeTimer = setInterval(saveCurrentConversation, SCRAPE_INTERVAL_MS);
  }

  // ── URL change detection ────────────────────────────────────────────────────

  let currentUrl = location.href;

  function onUrlChange() {
    if (location.href === currentUrl) return;
    currentUrl = location.href;
    lastMessageCount = 0;
    injectedThisSession = false;

    setTimeout(() => {
      tryInjectMemory();
    }, INJECTION_DEBOUNCE_MS);
  }

  // ── Init ────────────────────────────────────────────────────────────────────

  function init() {
    const observer = new MutationObserver(onUrlChange);
    observer.observe(document.body, { childList: true, subtree: true });
    setInterval(onUrlChange, 1000);

    setTimeout(tryInjectMemory, INJECTION_DEBOUNCE_MS);
    startScrapeLoop();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
