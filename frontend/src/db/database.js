/**
 * SQLite 数据库操作模块
 * 
 * 功能：
 * - 管理会话（sessions）、消息（messages）、图片（images）三个核心表
 * - 支持消息多版本（通过 parent_message_id 关联）
 * - 支持消息状态管理（sending/queued/failed/sent）用于离线队列
 * - 提供数据库迁移机制，确保向后兼容
 * 
 * 表结构：
 * - sessions: id, title, created_at
 * - messages: id, session_id, role, content, created_at, parent_message_id, status, retry_count
 * - images: id, session_id, uri, created_at (外键级联删除)
 */

import * as SQLite from 'expo-sqlite';

const DB_NAME = 'ai_chat_mini.db';

// 数据库实例（单例模式）
let db = null;

// 标记是否已确保 messages 表的 status/retry_count 列存在（用于迁移）
let ensuredMessageColumns = false;

/**
 * 获取数据库实例（单例模式）
 * 首次调用时打开数据库，后续调用直接返回已打开的实例
 * @returns {Promise<SQLite.SQLiteDatabase>} 数据库实例
 */
async function getDb() {
  if (!db) {
    db = await SQLite.openDatabaseAsync(DB_NAME);
  }
  return db;
}

/**
 * 确保 messages 表包含 status 和 retry_count 列（数据库迁移）
 * 用于支持离线队列和自动重试功能
 * 如果列已存在，忽略错误（向后兼容）
 * @param {SQLite.SQLiteDatabase} database - 数据库实例
 */
async function ensureMessageColumns(database) {
  // 只执行一次迁移，避免重复操作
  if (ensuredMessageColumns) return;
  ensuredMessageColumns = true;
  
  // 添加 status 列（消息状态：sending/queued/failed/sent）
  try {
    await database.execAsync(`ALTER TABLE messages ADD COLUMN status TEXT;`);
  } catch (error) {
    // 列已存在时忽略错误（向后兼容）
    if (!error.message.includes('duplicate column')) {
      console.warn('Migration warning (status fallback):', error.message);
    }
  }
  
  // 添加 retry_count 列（重试次数，用于控制自动重试上限）
  try {
    await database.execAsync(`ALTER TABLE messages ADD COLUMN retry_count INTEGER;`);
  } catch (error) {
    // 列已存在时忽略错误（向后兼容）
    if (!error.message.includes('duplicate column')) {
      console.warn('Migration warning (retry_count fallback):', error.message);
    }
  }
}

/**
 * 数据库操作对象
 * 提供会话、消息、图片的 CRUD 操作
 */
export const chatDb = {
  /**
   * 初始化数据库：创建表结构并执行必要的迁移
   * 在应用启动时调用一次即可
   */
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
          parent_message_id INTEGER,
          status TEXT,
          retry_count INTEGER
        );
      `);
      // 常用查询字段索引
      await database.execAsync(`
        CREATE INDEX IF NOT EXISTS idx_messages_session_created
        ON messages (session_id, created_at DESC);
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
      // 添加 status 列的迁移（如果列不存在）
      try {
        await database.execAsync(`
          ALTER TABLE messages ADD COLUMN status TEXT;
        `);
      } catch (error) {
        if (!error.message.includes('duplicate column')) {
          console.warn('Migration warning (status):', error.message);
        }
      }
      // 添加 retry_count 列的迁移（如果列不存在）
      try {
        await database.execAsync(`
          ALTER TABLE messages ADD COLUMN retry_count INTEGER;
        `);
      } catch (error) {
        if (!error.message.includes('duplicate column')) {
          console.warn('Migration warning (retry_count):', error.message);
        }
      }
      // 创建 images 表
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS images (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id INTEGER NOT NULL,
          uri TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
      `);
      await database.execAsync(`
        CREATE INDEX IF NOT EXISTS idx_images_session_created
        ON images (session_id, created_at DESC);
      `);
    } catch (error) {
      console.error('Database init error:', error);
      throw error;
    }
  },

  /**
   * 列出所有会话，按创建时间倒序排列
   * @returns {Promise<Array<{id: number, title: string, created_at: number}>>}
   */
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

  /**
   * 创建新会话
   * @param {string} initialTitle - 初始标题，默认为 '新会话'
   * @returns {Promise<{id: number, title: string, created_at: number}>} 新创建的会话对象
   */
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

  /**
   * 列出指定会话的所有消息，按创建时间正序排列
   * @param {number} sessionId - 会话 ID
   * @returns {Promise<Array<{id: number, session_id: number, role: string, content: string, created_at: number, parent_message_id: number|null, status: string|null, retry_count: number}>>}
   */
  async listMessages(sessionId) {
    const database = await getDb();
    await ensureMessageColumns(database);
    try {
      const statement = await database.prepareAsync(
        'SELECT id, session_id, role, content, created_at, parent_message_id, status, retry_count FROM messages WHERE session_id = ? ORDER BY created_at ASC;'
      );
      try {
        const result = await statement.executeAsync([sessionId]);
        const rows = [];
        for await (const row of result) {
          rows.push({
            id: row.id,
            session_id: row.session_id,
            role: row.role,
            content: row.content,
            created_at: row.created_at,
            parent_message_id: row.parent_message_id || null,
            status: row.status || null,
            retry_count: typeof row.retry_count === 'number' ? row.retry_count : 0,
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

  /**
   * 添加一条消息到指定会话
   * @param {number} sessionId - 会话 ID
   * @param {string} role - 消息角色：'user' 或 'assistant'
   * @param {string} content - 消息内容
   * @param {number|null} parentMessageId - 父消息 ID（用于多版本功能），默认为 null
   * @returns {Promise<Object>} 新创建的消息对象
   */
  async addMessage(sessionId, role, content, parentMessageId = null) {
    const database = await getDb();
    await ensureMessageColumns(database);
    const now = Date.now();
    try {
      const statement = await database.prepareAsync(
        'INSERT INTO messages (session_id, role, content, created_at, parent_message_id, status, retry_count) VALUES (?, ?, ?, ?, ?, ?, ?);'
      );
      try {
        const initialStatus = role === 'user' ? 'sending' : 'sent';
        const result = await statement.executeAsync([
          sessionId,
          role,
          content,
          now,
          parentMessageId,
          initialStatus,
          0,
        ]);
        return {
          id: result.lastInsertRowId,
          session_id: sessionId,
          role,
          content,
          created_at: now,
          parent_message_id: parentMessageId,
          status: initialStatus,
          retry_count: 0,
        };
      } finally {
        await statement.finalizeAsync();
      }
    } catch (error) {
      console.error('Add message error:', error);
      throw error;
    }
  },

  /**
   * 更新单条消息的发送状态与重试次数。
   */
  async updateMessageStatus(messageId, status, retryCount = null) {
    const database = await getDb();
    await ensureMessageColumns(database);
    try {
      if (retryCount == null) {
        const statement = await database.prepareAsync(
          'UPDATE messages SET status = ? WHERE id = ?;'
        );
        try {
          await statement.executeAsync([status, messageId]);
          return true;
        } finally {
          await statement.finalizeAsync();
        }
      } else {
        const statement = await database.prepareAsync(
          'UPDATE messages SET status = ?, retry_count = ? WHERE id = ?;'
        );
        try {
          await statement.executeAsync([status, retryCount, messageId]);
          return true;
        } finally {
          await statement.finalizeAsync();
        }
      }
    } catch (error) {
      console.error('Update message status error:', error);
      throw error;
    }
  },

  /**
   * 查询所有待发送的用户消息（status = 'queued'），按时间顺序返回。
   */
  async listQueuedUserMessages() {
    const database = await getDb();
    await ensureMessageColumns(database);
    try {
      const statement = await database.prepareAsync(
        `SELECT id, session_id, role, content, created_at, parent_message_id, status, retry_count
         FROM messages
         WHERE role = 'user' AND status = 'queued'
         ORDER BY created_at ASC;`
      );
      try {
        const result = await statement.executeAsync();
        const rows = [];
        for await (const row of result) {
          rows.push({
            id: row.id,
            session_id: row.session_id,
            role: row.role,
            content: row.content,
            created_at: row.created_at,
            parent_message_id: row.parent_message_id || null,
            status: row.status || 'queued',
            retry_count: typeof row.retry_count === 'number' ? row.retry_count : 0,
          });
        }
        return rows;
      } finally {
        await statement.finalizeAsync();
      }
    } catch (error) {
      console.error('List queued user messages error:', error);
      throw error;
    }
  },

  /**
   * 获取同一用户消息的所有 AI 回复版本
   * 通过 parent_message_id 关联，支持多版本回复功能
   * @param {number} parentMessageId - 父消息（用户消息）ID
   * @returns {Promise<Array<{id: number, role: string, content: string, created_at: number}>>}
   */
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

  /**
   * 更新会话标题
   * @param {number} sessionId - 会话 ID
   * @param {string} newTitle - 新标题
   * @returns {Promise<boolean>} 是否更新成功
   */
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

  /**
   * 删除会话及其所有关联数据
   * 包括：会话本身、所有消息、所有图片记录
   * 注意：图片的本地文件需要调用方手动删除（通过返回的 images 列表）
   * @param {number} sessionId - 会话 ID
   * @returns {Promise<{success: boolean, images: Array}>} 返回成功标志和图片列表（用于删除本地文件）
   */
  async deleteSession(sessionId) {
    const database = await getDb();
    try {
      // First, get all images in the session (before deleting them)
      const images = await this.listImages(sessionId);
      
      // Delete all images from database
      const deleteImagesStatement = await database.prepareAsync(
        'DELETE FROM images WHERE session_id = ?;'
      );
      try {
        await deleteImagesStatement.executeAsync([sessionId]);
      } finally {
        await deleteImagesStatement.finalizeAsync();
      }

      // Delete all messages in the session
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
        
        // Return images list so caller can delete local files
        return { success: true, images };
      } finally {
        await deleteSessionStatement.finalizeAsync();
      }
    } catch (error) {
      console.error('Delete session error:', error);
      throw error;
    }
  },

  /**
   * 删除单条消息及其所有关联的版本消息
   * 先删除所有以该消息为父消息的记录（版本消息），再删除消息本身
   * @param {number} messageId - 消息 ID
   * @returns {Promise<boolean>} 是否删除成功
   */
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

  // ========== Images 相关方法 ==========

  /**
   * 列出指定会话的所有图片，按创建时间倒序排列
   * @param {number} sessionId - 会话 ID
   * @returns {Promise<Array<{id: number, session_id: number, uri: string, created_at: number}>>}
   */
  async listImages(sessionId) {
    const database = await getDb();
    try {
      const statement = await database.prepareAsync(
        'SELECT id, session_id, uri, created_at FROM images WHERE session_id = ? ORDER BY created_at DESC;'
      );
      try {
        const result = await statement.executeAsync([sessionId]);
        const rows = [];
        for await (const row of result) {
          rows.push({
            id: row.id,
            session_id: row.session_id,
            uri: row.uri,
            created_at: row.created_at,
          });
        }
        return rows;
      } finally {
        await statement.finalizeAsync();
      }
    } catch (error) {
      console.error('List images error:', error);
      throw error;
    }
  },

  /**
   * 列出所有图片记录，按创建时间倒序
   * @returns {Promise<Array<{id: number, session_id: number, uri: string, created_at: number}>>}
   */
  async listAllImages() {
    const database = await getDb();
    try {
      const statement = await database.prepareAsync(
        'SELECT id, session_id, uri, created_at FROM images ORDER BY created_at DESC;'
      );
      try {
        const rows = [];
        const result = await statement.executeAsync();
        for await (const row of result) {
          rows.push({
            id: row.id,
            session_id: row.session_id,
            uri: row.uri,
            created_at: row.created_at,
          });
        }
        return rows;
      } finally {
        await statement.finalizeAsync();
      }
    } catch (error) {
      console.error('List all images error:', error);
      throw error;
    }
  },

  /**
   * 添加图片记录到指定会话
   * @param {number} sessionId - 会话 ID
   * @param {string} uri - 图片本地文件 URI
   * @returns {Promise<{id: number, session_id: number, uri: string, created_at: number}>} 新创建的图片记录
   */
  async addImage(sessionId, uri) {
    const database = await getDb();
    const now = Date.now();
    try {
      const statement = await database.prepareAsync(
        'INSERT INTO images (session_id, uri, created_at) VALUES (?, ?, ?);'
      );
      try {
        const result = await statement.executeAsync([sessionId, uri, now]);
        return {
          id: result.lastInsertRowId,
          session_id: sessionId,
          uri,
          created_at: now,
        };
      } finally {
        await statement.finalizeAsync();
      }
    } catch (error) {
      console.error('Add image error:', error);
      throw error;
    }
  },

  /**
   * 删除图片记录（不删除本地文件，需要调用方手动删除）
   * @param {number} imageId - 图片 ID
   * @returns {Promise<boolean>} 是否删除成功
   */
  async deleteImage(imageId) {
    const database = await getDb();
    try {
      const statement = await database.prepareAsync(
        'DELETE FROM images WHERE id = ?;'
      );
      try {
        await statement.executeAsync([imageId]);
        return true;
      } finally {
        await statement.finalizeAsync();
      }
    } catch (error) {
      console.error('Delete image error:', error);
      throw error;
    }
  },

  /**
   * 根据 ID 获取单张图片记录
   * @param {number} imageId - 图片 ID
   * @returns {Promise<{id: number, session_id: number, uri: string, created_at: number}|null>}
   */
  async getImage(imageId) {
    const database = await getDb();
    try {
      const statement = await database.prepareAsync(
        'SELECT id, session_id, uri, created_at FROM images WHERE id = ?;'
      );
      try {
        const result = await statement.executeAsync([imageId]);
        const rows = [];
        for await (const row of result) {
          rows.push({
            id: row.id,
            session_id: row.session_id,
            uri: row.uri,
            created_at: row.created_at,
          });
        }
        return rows[0] || null;
      } finally {
        await statement.finalizeAsync();
      }
    } catch (error) {
      console.error('Get image error:', error);
      throw error;
    }
  },
};


