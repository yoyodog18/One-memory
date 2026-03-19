# MemoryBridge

**Persistent memory across Claude, Gemini, and ChatGPT — stored entirely on your device.**

MemoryBridge is a Chrome extension that silently reads your AI conversations, stores them locally using IndexedDB, and automatically injects a memory summary into new chats — even when you switch between AI platforms. Everything lives in your browser. No servers. No accounts. No tracking.

---

## How to Load the Extension in Chrome

1. Clone or download this repository to your computer.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle in the top-right corner.
4. Click **"Load unpacked"**.
5. Select the folder containing `manifest.json` (the root of this repo).
6. MemoryBridge will appear in your extensions list. Pin it to the toolbar for easy access.

> **Note:** You'll need to reload the extension any time you edit source files.

---

## How to Add Your Anthropic API Key (Optional)

MemoryBridge can summarize your conversations using Claude Haiku. This is optional — without a key, it uses a simple local summarization fallback.

1. Get an API key from [console.anthropic.com](https://console.anthropic.com).
2. Click the MemoryBridge icon in your Chrome toolbar.
3. Paste your key in the **"Anthropic API Key"** field.
4. Click **"Save Key"**.

Your key is stored in `chrome.storage.local` — it never leaves your browser except in the encrypted HTTPS request to Anthropic's API.

---

## How the Memory System Works

```
┌─────────────────────────────────────────────────────────┐
│                    Your Browser                         │
│                                                         │
│   You chat on Claude / Gemini / ChatGPT                 │
│          │                                              │
│          ▼  (every 30s, content script scrapes DOM)     │
│   background.js receives messages                       │
│          │                                              │
│          ▼                                              │
│   IndexedDB stores raw messages + generates summary     │
│   (via Anthropic API if key provided, else local logic) │
│          │                                              │
│          ▼  (on new chat detected)                      │
│   Memory prompt injected into input box automatically   │
└─────────────────────────────────────────────────────────┘
```

### Step-by-step

1. **Scraping**: Content scripts run on claude.ai, gemini.google.com, and chatgpt.com. Every 30 seconds, they read the visible conversation from the DOM and send it to `background.js`.

2. **Storage**: `background.js` saves conversations to IndexedDB (`MemoryBridgeDB`). Conversations with 6 or more messages are summarized.

3. **Summarization**: If you've provided an Anthropic API key, the conversation is sent to Claude Haiku for a concise 3-5 sentence summary. Without a key, the extension extracts the first sentence of every third user message as a basic summary.

4. **Injection**: When you open a new chat on any of the three platforms, the extension detects an empty input box, fetches the last 10 summaries from IndexedDB, and prepends a formatted memory block like:

   ```
   [MemoryBridge Context — you can delete this]
   ## Your Memory (from previous conversations)
   [Mar 15 - Claude]: You were debugging a Supabase auth issue...
   [Mar 16 - Gemini]: You discussed pricing strategy for your SaaS...
   [Mar 17 - ChatGPT]: You worked on a landing page headline...
   ---
   ```

5. **Toast notification**: A small overlay appears in the bottom-right corner confirming memory was loaded, then fades out after 3 seconds.

---

## Known Limitations

- **DOM selectors may break**: Claude, Gemini, and ChatGPT frequently update their UI. If the DOM structure changes significantly, scraping or injection may stop working until the selectors in the content scripts are updated.
- **Mobile not supported**: Chrome extensions do not run on mobile browsers. MemoryBridge only works on desktop Chrome (or Chromium-based browsers that support Manifest V3).
- **New chats only**: Memory is injected when a new, empty chat is detected. It won't be injected mid-conversation.
- **30-second scrape delay**: The extension checks for new messages every 30 seconds. Very short conversations (ended quickly) may not be captured in time.
- **6-message threshold for summaries**: Conversations shorter than 6 messages are stored but not summarized — only the raw messages are kept.
- **Single-device only**: Memory is stored in IndexedDB on one device. There's no sync across devices. Use the Export feature if you want to back up your data.
- **API rate limits**: If you make many short conversations in quick succession with an API key set, you may encounter Anthropic rate limits.
- **Service worker lifecycle**: Chrome may suspend the background service worker when idle. This is handled automatically, but very infrequent use may result in occasional delays on first load.

---

## File Structure

```
memorybridge/
├── manifest.json          # Extension manifest (Manifest V3)
├── background.js          # Service worker — memory logic, summarization
├── memory/
│   └── db.js              # IndexedDB wrapper (MemoryDB class)
├── content/
│   ├── claude.js          # Content script for claude.ai
│   ├── gemini.js          # Content script for gemini.google.com
│   └── chatgpt.js         # Content script for chatgpt.com
├── popup/
│   ├── popup.html         # Extension popup UI
│   ├── popup.css          # Popup styles (dark mode)
│   └── popup.js           # Popup interaction logic
├── icons/                 # Extension icons (add your own PNG files)
├── README.md
└── PRIVACY.md
```

---

## Icons

The `icons/` directory needs three PNG files:
- `icon16.png` (16×16)
- `icon48.png` (48×48)
- `icon128.png` (128×128)

You can use any brain/link/memory themed icon, or generate them with any icon tool.
