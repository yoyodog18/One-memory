/**
 * MemoryBridge - Claude Content Script (claude.ai)
 * Scrapes conversations and injects memory context into new chats.
 */

(function () {
  'use strict';

  const PLATFORM = 'claude';
  const SCRAPE_INTERVAL_MS = 30000;
  const INJECTION_DEBOUNCE_MS = 2000;

  let lastMessageCount = 0;
  let injectedThisSession = false;
  let scrapeTimer = null;

  // ── DOM Selectors ───────────────────────────────────────────────────────────
  // Claude uses data-testid attributes and role-based structure.
  // These selectors target the most stable available elements.

  function getInputBox() {
    // Primary: contenteditable div inside the composer
    return (
      document.querySelector('div[contenteditable="true"][data-placeholder]') ||
      document.querySelector('div[contenteditable="true"].ProseMirror') ||
      document.querySelector('div[contenteditable="true"]')
    );
  }

  function scrapeMessages() {
    const messages = [];

    try {
      // User messages
      const userEls = document.querySelectorAll(
        '[data-testid="user-message"], .human-turn, [class*="humanTurn"], [class*="human-turn"]'
      );
      userEls.forEach((el) => {
        const text = el.innerText?.trim();
        if (text) messages.push({ role: 'user', content: text, _el: el });
      });

      // Assistant messages
      const assistantEls = document.querySelectorAll(
        '[data-testid="assistant-message"], .assistant-turn, [class*="assistantTurn"], [class*="assistant-turn"]'
      );
      assistantEls.forEach((el) => {
        const text = el.innerText?.trim();
        if (text) messages.push({ role: 'assistant', content: text, _el: el });
      });

      // Fallback: interleaved turn container approach
      if (messages.length === 0) {
        const turns = document.querySelectorAll(
          '[class*="ConversationItem"], [class*="conversation-item"], [class*="turn"]'
        );
        turns.forEach((turn) => {
          const isUser =
            turn.querySelector('[class*="human"], [data-testid*="user"]') !== null;
          const text = turn.innerText?.trim();
          if (text) {
            messages.push({ role: isUser ? 'user' : 'assistant', content: text });
          }
        });
      }

      // Remove the _el references before sending
      return messages.map(({ role, content }) => ({ role, content }));
    } catch (err) {
      console.debug('[MemoryBridge/Claude] scrapeMessages error:', err);
      return [];
    }
  }

  function isNewEmptyChat() {
    try {
      const msgs = scrapeMessages();
      return msgs.length === 0 && !injectedThisSession;
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
      console.debug('[MemoryBridge/Claude] toast error:', err);
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

      // Set content and dispatch events so React/ProseMirror picks it up
      inputBox.focus();
      inputBox.innerText = injectionText;

      // Dispatch native input event
      inputBox.dispatchEvent(new Event('input', { bubbles: true }));
      inputBox.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: injectionText }));
      inputBox.dispatchEvent(new Event('change', { bubbles: true }));

      // Place cursor at the end
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
      console.debug('[MemoryBridge/Claude] inject error:', err);
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
      console.debug('[MemoryBridge/Claude] tryInjectMemory error:', err);
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
      console.debug('[MemoryBridge/Claude] saveCurrentConversation error:', err);
    }
  }

  function startScrapeLoop() {
    if (scrapeTimer) clearInterval(scrapeTimer);
    scrapeTimer = setInterval(saveCurrentConversation, SCRAPE_INTERVAL_MS);
  }

  // ── URL change detection (Claude is a SPA) ──────────────────────────────────

  let currentUrl = location.href;

  function onUrlChange() {
    if (location.href === currentUrl) return;
    currentUrl = location.href;
    lastMessageCount = 0;
    injectedThisSession = false;

    // Wait for new page DOM to settle
    setTimeout(() => {
      tryInjectMemory();
    }, INJECTION_DEBOUNCE_MS);
  }

  // ── Init ────────────────────────────────────────────────────────────────────

  function init() {
    // Watch for SPA navigation
    const observer = new MutationObserver(onUrlChange);
    observer.observe(document.body, { childList: true, subtree: true });

    // Poll URL as a backup
    setInterval(onUrlChange, 1000);

    // Initial injection attempt
    setTimeout(tryInjectMemory, INJECTION_DEBOUNCE_MS);

    // Start scraping
    startScrapeLoop();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
