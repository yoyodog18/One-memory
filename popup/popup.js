/**
 * MemoryBridge - Popup Script
 * Handles all popup UI interactions and data display.
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d)) return 'unknown';
  const diff = Date.now() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const PLATFORM_LABELS = {
  claude: 'Claude',
  gemini: 'Gemini',
  chatgpt: 'ChatGPT',
};

// ── DOM refs ──────────────────────────────────────────────────────────────────

const convCountEl = document.getElementById('conv-count');
const lastSyncEl = document.getElementById('last-sync');
const memoriesListEl = document.getElementById('memories-list');
const emptyStateEl = document.getElementById('empty-state');
const apiKeyInput = document.getElementById('api-key-input');
const toggleKeyBtn = document.getElementById('toggle-key');
const saveKeyBtn = document.getElementById('save-key');
const keyStatusEl = document.getElementById('key-status');
const exportBtn = document.getElementById('export-btn');
const clearBtn = document.getElementById('clear-btn');
const confirmDialog = document.getElementById('confirm-dialog');
const cancelClearBtn = document.getElementById('cancel-clear');
const confirmClearBtn = document.getElementById('confirm-clear');

// ── Stats ─────────────────────────────────────────────────────────────────────

async function loadStats() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
    if (response?.success) {
      convCountEl.textContent = response.count ?? 0;
      if (response.lastPlatform && response.lastTimestamp) {
        const label = PLATFORM_LABELS[response.lastPlatform] || response.lastPlatform;
        lastSyncEl.textContent = `${label} · ${timeAgo(response.lastTimestamp)}`;
      } else {
        lastSyncEl.textContent = 'never';
      }
    }
  } catch (err) {
    console.error('[MemoryBridge popup] loadStats error:', err);
  }
}

// ── Memories ──────────────────────────────────────────────────────────────────

async function loadMemories() {
  try {
    // We use GET_MEMORY to get the prompt but need raw summaries for display.
    // We'll query through the background for stats, and render a custom list.
    // Since background doesn't expose getRecentSummaries directly, we build
    // from GET_MEMORY and GET_STATS combined — but for card display we need
    // individual records. We'll request them via a new message type handled
    // by a fallback, or we re-use the export approach.

    // Use EXPORT_MEMORY to get all data, then display the last 5.
    const response = await chrome.runtime.sendMessage({ type: 'EXPORT_MEMORY' });
    if (!response?.success) return;

    const { conversations } = response.data;
    const recent = (conversations || [])
      .slice()
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 5);

    if (recent.length === 0) {
      emptyStateEl.style.display = 'block';
      return;
    }

    emptyStateEl.style.display = 'none';

    // Clear existing cards (keep empty state)
    Array.from(memoriesListEl.querySelectorAll('.memory-card')).forEach((el) => el.remove());

    recent.forEach((conv) => {
      const card = document.createElement('div');
      card.className = 'memory-card';

      const platform = conv.platform || 'unknown';
      const label = PLATFORM_LABELS[platform] || platform;
      const date = formatDate(conv.timestamp);

      const hasSummary = conv.summary && conv.summary.trim().length > 0;

      card.innerHTML = `
        <div class="memory-card-header">
          <span class="platform-badge ${platform}">${label}</span>
          <span class="memory-date">${date}</span>
        </div>
        ${
          hasSummary
            ? `<p class="memory-summary">${escapeHtml(conv.summary)}</p>`
            : `<p class="no-summary">${conv.rawMessages?.length || 0} messages — summary pending (needs 6+ messages)</p>`
        }
      `;
      memoriesListEl.appendChild(card);
    });
  } catch (err) {
    console.error('[MemoryBridge popup] loadMemories error:', err);
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── API Key ───────────────────────────────────────────────────────────────────

async function loadApiKey() {
  try {
    const result = await chrome.storage.local.get(['anthropicApiKey']);
    if (result.anthropicApiKey) {
      apiKeyInput.value = result.anthropicApiKey;
      keyStatusEl.textContent = 'Key saved';
      keyStatusEl.className = 'key-status';
    }
  } catch (err) {
    console.error('[MemoryBridge popup] loadApiKey error:', err);
  }
}

toggleKeyBtn.addEventListener('click', () => {
  if (apiKeyInput.type === 'password') {
    apiKeyInput.type = 'text';
    toggleKeyBtn.title = 'Hide key';
  } else {
    apiKeyInput.type = 'password';
    toggleKeyBtn.title = 'Show key';
  }
});

saveKeyBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  try {
    await chrome.storage.local.set({ anthropicApiKey: key || null });
    keyStatusEl.textContent = key ? 'Key saved ✓' : 'Key removed';
    keyStatusEl.className = 'key-status';
    setTimeout(() => {
      keyStatusEl.textContent = key ? 'Key saved' : '';
    }, 2500);
  } catch (err) {
    keyStatusEl.textContent = 'Error saving key';
    keyStatusEl.className = 'key-status error';
  }
});

// ── Export ────────────────────────────────────────────────────────────────────

exportBtn.addEventListener('click', async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'EXPORT_MEMORY' });
    if (!response?.success) {
      alert('Export failed. Please try again.');
      return;
    }

    const json = JSON.stringify(response.data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `memory-export-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('[MemoryBridge popup] export error:', err);
    alert('Export failed.');
  }
});

// ── Clear ─────────────────────────────────────────────────────────────────────

clearBtn.addEventListener('click', () => {
  confirmDialog.hidden = false;
});

cancelClearBtn.addEventListener('click', () => {
  confirmDialog.hidden = true;
});

confirmClearBtn.addEventListener('click', async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'CLEAR_MEMORY' });
    confirmDialog.hidden = true;
    if (response?.success) {
      await loadStats();
      await loadMemories();
    } else {
      alert('Failed to clear memory. Please try again.');
    }
  } catch (err) {
    console.error('[MemoryBridge popup] clear error:', err);
    confirmDialog.hidden = true;
    alert('Failed to clear memory.');
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  await Promise.all([loadStats(), loadMemories(), loadApiKey()]);
}

init();
