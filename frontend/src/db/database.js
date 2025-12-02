import * as SQLite from 'expo-sqlite';

const DB_NAME = 'ai_chat_mini.db';

let db = null;

async function getDb() {
  if (!db) {
    db = await SQLite.openDatabaseAsync(DB_NAME);
  }
  return db;
}

export const chatDb = {
  async init() {
    const database = await getDb();
    try {
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT,
          created_at INTEGER
        );
      `);
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id INTEGER,
          role TEXT,
          content TEXT,
          created_at INTEGER,
          parent_message_id INTEGER
        );
      `);
      // 添加 parent_message_id 列的迁移（如果列不存在）
      try {
        await database.execAsync(`
          ALTER TABLE messages ADD COLUMN parent_message_id INTEGER;
        `);
      } catch (error) {
        // 列可能已存在，忽略错误
        if (!error.message.includes('duplicate column')) {
          console.warn('Migration warning:', error.message);
        }
      }
    } catch (error) {
      console.error('Database init error:', error);
      throw error;
    }
  },

  async listSessions() {
    const database = await getDb();
    try {
      const statement = await database.prepareAsync(
        'SELECT id, title, created_at FROM sessions ORDER BY created_at DESC;'
      );
      try {
        const result = await statement.executeAsync();
        const rows = [];
        for await (const row of result) {
          rows.push({
            id: row.id,
            title: row.title,
            created_at: row.created_at,
          });
        }
        return rows;
      } finally {
        await statement.finalizeAsync();
      }
    } catch (error) {
      console.error('List sessions error:', error);
      throw error;
    }
  },

  async createSession(initialTitle = '新会话') {
    const database = await getDb();
    const now = Date.now();
    try {
      const statement = await database.prepareAsync(
        'INSERT INTO sessions (title, created_at) VALUES (?, ?);'
      );
      try {
        const result = await statement.executeAsync([initialTitle, now]);
        return {
          id: result.lastInsertRowId,
          title: initialTitle,
          created_at: now,
        };
      } finally {
        await statement.finalizeAsync();
      }
    } catch (error) {
      console.error('Create session error:', error);
      throw error;
    }
  },

  async listMessages(sessionId) {
    const database = await getDb();
    try {
      const statement = await database.prepareAsync(
        'SELECT id, role, content, created_at, parent_message_id FROM messages WHERE session_id = ? ORDER BY created_at ASC;'
      );
      try {
        const result = await statement.executeAsync([sessionId]);
        const rows = [];
        for await (const row of result) {
          rows.push({
            id: row.id,
            role: row.role,
            content: row.content,
            created_at: row.created_at,
            parent_message_id: row.parent_message_id || null,
          });
        }
        return rows;
      } finally {
        await statement.finalizeAsync();
      }
    } catch (error) {
      console.error('List messages error:', error);
      throw error;
    }
  },

  async addMessage(sessionId, role, content, parentMessageId = null) {
    const database = await getDb();
    const now = Date.now();
    try {
      const statement = await database.prepareAsync(
        'INSERT INTO messages (session_id, role, content, created_at, parent_message_id) VALUES (?, ?, ?, ?, ?);'
      );
      try {
        const result = await statement.executeAsync([sessionId, role, content, now, parentMessageId]);
        return {
          id: result.lastInsertRowId,
          session_id: sessionId,
          role,
          content,
          created_at: now,
          parent_message_id: parentMessageId,
        };
      } finally {
        await statement.finalizeAsync();
      }
    } catch (error) {
      console.error('Add message error:', error);
      throw error;
    }
  },

  // 获取同一用户消息的所有AI回复版本
  async getMessageVersions(parentMessageId) {
    const database = await getDb();
    try {
      const statement = await database.prepareAsync(
        'SELECT id, role, content, created_at FROM messages WHERE parent_message_id = ? ORDER BY created_at ASC;'
      );
      try {
        const result = await statement.executeAsync([parentMessageId]);
        const rows = [];
        for await (const row of result) {
          rows.push({
            id: row.id,
            role: row.role,
            content: row.content,
            created_at: row.created_at,
          });
        }
        return rows;
      } finally {
        await statement.finalizeAsync();
      }
    } catch (error) {
      console.error('Get message versions error:', error);
      throw error;
    }
  },

  async updateSessionTitle(sessionId, newTitle) {
    const database = await getDb();
    try {
      const statement = await database.prepareAsync(
        'UPDATE sessions SET title = ? WHERE id = ?;'
      );
      try {
        await statement.executeAsync([newTitle, sessionId]);
        return true;
      } finally {
        await statement.finalizeAsync();
      }
    } catch (error) {
      console.error('Update session title error:', error);
      throw error;
    }
  },

  async deleteSession(sessionId) {
    const database = await getDb();
    try {
      // First delete all messages in the session
      const deleteMessagesStatement = await database.prepareAsync(
        'DELETE FROM messages WHERE session_id = ?;'
      );
      try {
        await deleteMessagesStatement.executeAsync([sessionId]);
      } finally {
        await deleteMessagesStatement.finalizeAsync();
      }

      // Then delete the session
      const deleteSessionStatement = await database.prepareAsync(
        'DELETE FROM sessions WHERE id = ?;'
      );
      try {
        await deleteSessionStatement.executeAsync([sessionId]);
        return true;
      } finally {
        await deleteSessionStatement.finalizeAsync();
      }
    } catch (error) {
      console.error('Delete session error:', error);
      throw error;
    }
  },

  // 删除单条消息（及其所有以其为 parent_message_id 的关联消息）
  async deleteMessage(messageId) {
    const database = await getDb();
    try {
      // 先删除所有以该消息为父消息的记录（版本等）
      const deleteChildrenStatement = await database.prepareAsync(
        'DELETE FROM messages WHERE parent_message_id = ?;'
      );
      try {
        await deleteChildrenStatement.executeAsync([messageId]);
      } finally {
        await deleteChildrenStatement.finalizeAsync();
      }

      // 再删除该消息本身
      const deleteMessageStatement = await database.prepareAsync(
        'DELETE FROM messages WHERE id = ?;'
      );
      try {
        await deleteMessageStatement.executeAsync([messageId]);
        return true;
      } finally {
        await deleteMessageStatement.finalizeAsync();
      }
    } catch (error) {
      console.error('Delete message error:', error);
      throw error;
    }
  },
};


