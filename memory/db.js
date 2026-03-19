/**
 * MemoryBridge - IndexedDB Wrapper
 *
 * DATA STORAGE SUMMARY:
 * - "conversations" store: raw chat messages (role + content), platform name,
 *   timestamp, AI-generated or locally-generated summaries, extracted topics.
 * - "globalMemory" store: a single compressed running summary of all conversations.
 *
 * All data lives exclusively in the browser's IndexedDB on this device.
 * Nothing is ever sent to a server (except optional Anthropic API calls for
 * summarization, which only occur if the user explicitly provides an API key).
 *
 * Sensitive content (messages containing "password", "ssn", "credit card")
 * is filtered out before storage in background.js.
 */

const DB_NAME = 'MemoryBridgeDB';
const DB_VERSION = 1;

class MemoryDB {
  constructor() {
    this.db = null;
  }

  async open() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains('conversations')) {
          const convStore = db.createObjectStore('conversations', {
            keyPath: 'id',
            autoIncrement: true,
          });
          convStore.createIndex('platform', 'platform', { unique: false });
          convStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        if (!db.objectStoreNames.contains('globalMemory')) {
          db.createObjectStore('globalMemory', {
            keyPath: 'id',
            autoIncrement: true,
          });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  async saveConversation(platform, messages) {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('conversations', 'readwrite');
      const store = tx.objectStore('conversations');
      const record = {
        platform,
        timestamp: new Date(),
        rawMessages: messages,
        summary: '',
        topics: [],
      };
      const request = store.add(record);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async updateSummary(conversationId, summary, topics = []) {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('conversations', 'readwrite');
      const store = tx.objectStore('conversations');
      const getReq = store.get(conversationId);
      getReq.onsuccess = () => {
        const record = getReq.result;
        if (!record) return reject(new Error('Conversation not found'));
        record.summary = summary;
        record.topics = topics;
        const putReq = store.put(record);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  async getRecentSummaries(limit = 10) {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('conversations', 'readonly');
      const store = tx.objectStore('conversations');
      const index = store.index('timestamp');
      const results = [];
      // Open cursor in descending order
      const request = index.openCursor(null, 'prev');
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && results.length < limit) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getConversationCount() {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('conversations', 'readonly');
      const store = tx.objectStore('conversations');
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getGlobalMemory() {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('globalMemory', 'readonly');
      const store = tx.objectStore('globalMemory');
      const request = store.getAll();
      request.onsuccess = () => {
        const all = request.result;
        resolve(all.length > 0 ? all[all.length - 1] : null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async updateGlobalMemory(content) {
    await this.open();
    return new Promise(async (resolve, reject) => {
      const existing = await this.getGlobalMemory();
      const tx = this.db.transaction('globalMemory', 'readwrite');
      const store = tx.objectStore('globalMemory');
      const record = {
        content,
        lastUpdatedAt: new Date(),
        createdAt: existing ? existing.createdAt : new Date(),
      };
      if (existing) {
        record.id = existing.id;
        const putReq = store.put(record);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      } else {
        const addReq = store.add(record);
        addReq.onsuccess = () => resolve();
        addReq.onerror = () => reject(addReq.error);
      }
    });
  }

  async clearAll() {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['conversations', 'globalMemory'], 'readwrite');
      tx.objectStore('conversations').clear();
      tx.objectStore('globalMemory').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async exportAll() {
    await this.open();
    const conversations = await new Promise((resolve, reject) => {
      const tx = this.db.transaction('conversations', 'readonly');
      const store = tx.objectStore('conversations');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const globalMemory = await this.getGlobalMemory();
    return {
      exportedAt: new Date().toISOString(),
      conversations,
      globalMemory,
    };
  }
}

export default MemoryDB;
