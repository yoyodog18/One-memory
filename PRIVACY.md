# MemoryBridge Privacy Policy

*Plain-language explanation of exactly what this extension does and does not do with your data.*

---

## What Data Is Collected

MemoryBridge reads the text content of your chat conversations on:
- **claude.ai**
- **gemini.google.com**
- **chatgpt.com**

Specifically, it captures:
- The text of each message (both your messages and the AI's responses)
- Which platform the conversation happened on (Claude, Gemini, or ChatGPT)
- The date and time of the conversation
- Automatically generated summaries of conversations (see below)
- Extracted topic keywords from your messages

---

## Where Your Data Is Stored

**Everything is stored in your browser's IndexedDB — on your device only.**

- The database is named `MemoryBridgeDB`
- It contains two tables: `conversations` and `globalMemory`
- This data never leaves your device through MemoryBridge itself
- There are no MemoryBridge servers, no cloud storage, no sync

You can inspect your stored data at any time in Chrome DevTools:
`DevTools → Application → IndexedDB → MemoryBridgeDB`

---

## What Is NOT Stored

MemoryBridge actively filters out messages that appear to contain sensitive information. Any message containing the following keywords is skipped and **never stored**:

- `password`
- `ssn` (Social Security Number)
- `social security`
- `credit card`
- `cvv`
- `pin:` or `pin=`

Additionally, the extension **never** reads or stores:
- Passwords, authentication tokens, or cookies
- Browsing history outside of the three supported AI platforms
- Form data, financial transactions, or any data from other websites
- Your name, email address, or any account information from those platforms

---

## The Optional Anthropic API Call

If you choose to provide an Anthropic API key in the popup:

- When a conversation reaches 6+ messages, the raw message text is sent to `api.anthropic.com` over HTTPS
- This is used to generate a smart 3-5 sentence summary using Claude Haiku
- **Only the message text is sent** — no metadata, no account info, no browsing data
- The API key is stored in `chrome.storage.local` (on-device) and is only included as an HTTP header in that single summarization request
- The API key is never logged, printed to the console, or shared with any third party beyond Anthropic

If you do **not** provide an API key, no network requests are ever made by MemoryBridge. All summarization happens locally in your browser using a simple text extraction algorithm.

---

## Data Sharing

MemoryBridge does **not** share your data with anyone. Ever. There are no:
- Analytics or telemetry calls
- Third-party SDKs or tracking libraries
- Ad networks or data brokers
- Usage statistics sent to any server

The only external HTTP request the extension can make is the optional Anthropic API call described above.

---

## Deleting Your Data

You have full control over your data:

1. **Clear all memory**: Click the MemoryBridge extension icon → "Clear All Memory" → confirm. This wipes the entire `MemoryBridgeDB` IndexedDB database.
2. **Export your data**: Click "Export Memory" to download a JSON file of everything stored before deleting.
3. **Uninstall**: Removing the extension from Chrome automatically removes all associated storage, including IndexedDB data and any `chrome.storage.local` data (including your API key).

---

## Permissions Explained

The extension requests the following Chrome permissions:

| Permission | Why It's Needed |
|---|---|
| `storage` | To save your optional Anthropic API key in `chrome.storage.local` |
| `activeTab` | To interact with the currently active tab when needed |
| `scripting` | To run content scripts on supported AI platforms |
| `tabs` | To detect navigation between pages within supported sites |
| Host: `claude.ai` | To scrape Claude conversations and inject memory |
| Host: `gemini.google.com` | To scrape Gemini conversations and inject memory |
| Host: `chatgpt.com` | To scrape ChatGPT conversations and inject memory |

No other permissions are requested. The extension cannot access any website other than those three.

---

## Summary

| Data | Stored? | Where? | Shared? |
|---|---|---|---|
| Chat messages | Yes | Your device (IndexedDB) | No |
| Conversation summaries | Yes | Your device (IndexedDB) | No |
| Platform & timestamps | Yes | Your device (IndexedDB) | No |
| Anthropic API key | If provided | Your device (chrome.storage.local) | Anthropic only (for API calls) |
| Passwords / SSNs / credit cards | **No** — filtered | — | — |
| Browsing history | No | — | — |
| Account info / emails | No | — | — |
| Any data from other websites | No | — | — |

---

*Questions or concerns? Open an issue on the GitHub repository.*
