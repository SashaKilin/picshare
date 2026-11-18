const path = require('path');
const fs = require('fs');

const isPg = Boolean(process.env.DATABASE_URL);

let sqliteDb = null;
let pgPool = null;

if (isPg) {
  const { Pool } = require('pg');
  console.log('🐘 Инициализация подключения к PostgreSQL (Cloud DB)...');
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
  });
} else {
  const { DatabaseSync } = require('node:sqlite');
  const dbPath = path.join(__dirname, 'database.sqlite');
  console.log('📁 Инициализация локальной базы SQLite:', dbPath);
  sqliteDb = new DatabaseSync(dbPath);
  sqliteDb.exec('PRAGMA journal_mode = WAL;');
  sqliteDb.exec('PRAGMA foreign_keys = ON;');
}

function toPgSql(sql) {
  let index = 1;
  return sql.replace(/\?/g, () => `$${index++}`);
}

const db = {
  isPg,

  async init() {
    if (isPg) {
      // 1. Создаем базовые таблицы
      await pgPool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username VARCHAR(255) UNIQUE NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash TEXT,
          google_id VARCHAR(255) UNIQUE,
          avatar TEXT,
          banner TEXT,
          bio TEXT,
          birthdate VARCHAR(50),
          badge VARCHAR(100),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS friendships (
          id SERIAL PRIMARY KEY,
          user1_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          user2_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          status VARCHAR(50) NOT NULL CHECK(status IN ('pending', 'accepted', 'rejected')),
          action_user_id INTEGER NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user1_id, user2_id)
        );

        CREATE TABLE IF NOT EXISTS groups (
          id SERIAL PRIMARY KEY,
          name VARCHAR(150) NOT NULL,
          description TEXT,
          avatar TEXT,
          creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS group_members (
          id SERIAL PRIMARY KEY,
          group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(group_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS images (
          id SERIAL PRIMARY KEY,
          sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          receiver_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          group_id INTEGER,
          file_url TEXT,
          original_name TEXT,
          caption TEXT,
          file_size INTEGER,
          reply_to_id INTEGER,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS push_subscriptions (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          endpoint TEXT NOT NULL UNIQUE,
          p256dh TEXT NOT NULL,
          auth TEXT NOT NULL,
          client_type VARCHAR(50) DEFAULT 'web',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS fcm_tokens (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token TEXT NOT NULL UNIQUE,
          device_name TEXT,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // 2. Накатываем миграции для уже существующих в БД таблиц
      const migrations = [
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS banner TEXT;`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS birthdate VARCHAR(50);`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS badge VARCHAR(100);`,
        `ALTER TABLE images ADD COLUMN IF NOT EXISTS reply_to_id INTEGER;`,
        `ALTER TABLE images ADD COLUMN IF NOT EXISTS group_id INTEGER;`,
        `ALTER TABLE images ALTER COLUMN receiver_id DROP NOT NULL;`,
        `ALTER TABLE images ALTER COLUMN file_url DROP NOT NULL;`,
        `ALTER TABLE images ALTER COLUMN original_name DROP NOT NULL;`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS app_notifications_enabled BOOLEAN DEFAULT FALSE;`,
        `ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS client_type VARCHAR(50) DEFAULT 'web';`
      ];

      for (const sql of migrations) {
        try {
          await pgPool.query(sql);
        } catch (e) {
          console.warn('Миграция PostgreSQL пропущена или уже применена:', sql.split(';')[0], e.message);
        }
      }

      // 3. Создаем индексы после гарантированного добавления всех колонок
      try {
        await pgPool.query(`
          CREATE INDEX IF NOT EXISTS idx_friendships_users ON friendships(user1_id, user2_id);
          CREATE INDEX IF NOT EXISTS idx_images_chat ON images(sender_id, receiver_id);
          CREATE INDEX IF NOT EXISTS idx_images_group ON images(group_id);
          CREATE INDEX IF NOT EXISTS idx_group_members ON group_members(group_id, user_id);
          CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
          CREATE INDEX IF NOT EXISTS idx_fcm_user ON fcm_tokens(user_id);
        `);
      } catch (e) {
        console.warn('Предупреждение при создании индексов PostgreSQL:', e.message);
      }

      console.log('✅ Таблицы PostgreSQL готовы (профили, чат, баннеры, группы)');
    } else {
      sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT,
          google_id TEXT UNIQUE,
          avatar TEXT,
          banner TEXT,
          bio TEXT,
          birthdate TEXT,
          badge TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS friendships (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user1_id INTEGER NOT NULL,
          user2_id INTEGER NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'rejected')),
          action_user_id INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user1_id, user2_id),
          FOREIGN KEY(user1_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY(user2_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS groups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          avatar TEXT,
          creator_id INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(creator_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS group_members (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          group_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(group_id, user_id),
          FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS images (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sender_id INTEGER NOT NULL,
          receiver_id INTEGER,
          group_id INTEGER,
          file_url TEXT,
          original_name TEXT,
          caption TEXT,
          file_size INTEGER,
          reply_to_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY(receiver_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_friendships_users ON friendships(user1_id, user2_id);
        CREATE INDEX IF NOT EXISTS idx_images_chat ON images(sender_id, receiver_id);
        CREATE INDEX IF NOT EXISTS idx_images_group ON images(group_id);
        CREATE INDEX IF NOT EXISTS idx_group_members ON group_members(group_id, user_id);

        CREATE TABLE IF NOT EXISTS push_subscriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          endpoint TEXT NOT NULL UNIQUE,
          p256dh TEXT NOT NULL,
          auth TEXT NOT NULL,
          client_type TEXT DEFAULT 'web',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

        CREATE TABLE IF NOT EXISTS fcm_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          token TEXT NOT NULL UNIQUE,
          device_name TEXT,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_fcm_user ON fcm_tokens(user_id);
      `);

      // Автоматическая миграция SQLite users (добавление banner, bio, birthdate, badge)
      try {
        const userCols = sqliteDb.prepare("PRAGMA table_info(users);").all().map(c => c.name);
        if (!userCols.includes('banner')) sqliteDb.exec("ALTER TABLE users ADD COLUMN banner TEXT;");
        if (!userCols.includes('bio')) sqliteDb.exec("ALTER TABLE users ADD COLUMN bio TEXT;");
        if (!userCols.includes('birthdate')) sqliteDb.exec("ALTER TABLE users ADD COLUMN birthdate TEXT;");
        if (!userCols.includes('badge')) sqliteDb.exec("ALTER TABLE users ADD COLUMN badge TEXT;");
        if (!userCols.includes('app_notifications_enabled')) sqliteDb.exec("ALTER TABLE users ADD COLUMN app_notifications_enabled INTEGER DEFAULT 0;");
        const pushCols = sqliteDb.prepare("PRAGMA table_info(push_subscriptions);").all().map(c => c.name);
        if (!pushCols.includes('client_type')) sqliteDb.exec("ALTER TABLE push_subscriptions ADD COLUMN client_type TEXT DEFAULT 'web';");
      } catch (err) {
        // Уже есть
      }

      // Автоматическая миграция SQLite images (снятие NOT NULL с receiver_id и добавление group_id)
      try {
        const tableInfo = sqliteDb.prepare("PRAGMA table_info(images);").all();
        const colNames = tableInfo.map(c => c.name);
        const receiverCol = tableInfo.find(c => c.name === 'receiver_id');
        const fileUrlCol = tableInfo.find(c => c.name === 'file_url');

        if (!colNames.includes('group_id') || (receiverCol && receiverCol.notnull === 1) || (fileUrlCol && fileUrlCol.notnull === 1)) {
          sqliteDb.exec(`
            CREATE TABLE IF NOT EXISTS images_v_groups (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              sender_id INTEGER NOT NULL,
              receiver_id INTEGER,
              group_id INTEGER,
              file_url TEXT,
              original_name TEXT,
              caption TEXT,
              file_size INTEGER,
              reply_to_id INTEGER,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE,
              FOREIGN KEY(receiver_id) REFERENCES users(id) ON DELETE CASCADE,
              FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE
            );
            INSERT INTO images_v_groups (id, sender_id, receiver_id, file_url, original_name, caption, file_size, reply_to_id, created_at)
            SELECT id, sender_id, receiver_id, file_url, original_name, caption, file_size, reply_to_id, created_at FROM images;
            DROP TABLE images;
            ALTER TABLE images_v_groups RENAME TO images;
            CREATE INDEX IF NOT EXISTS idx_images_chat ON images(sender_id, receiver_id);
            CREATE INDEX IF NOT EXISTS idx_images_group ON images(group_id);
          `);
        }
      } catch (migErr) {
        // Игнорируем
      }

      console.log('✅ Таблицы SQLite готовы (профили, чат, баннеры, группы)');
    }
  },

  async get(sql, params = []) {
    if (isPg) {
      const res = await pgPool.query(toPgSql(sql), params);
      return res.rows[0] || null;
    } else {
      return sqliteDb.prepare(sql).get(...params) || null;
    }
  },

  async all(sql, params = []) {
    if (isPg) {
      const res = await pgPool.query(toPgSql(sql), params);
      return res.rows;
    } else {
      return sqliteDb.prepare(sql).all(...params);
    }
  },

  async run(sql, params = []) {
    if (isPg) {
      const res = await pgPool.query(toPgSql(sql), params);
      const insertedId = res.rows && res.rows[0] ? res.rows[0].id : null;
      return { lastInsertRowid: insertedId, changes: res.rowCount };
    } else {
      const res = sqliteDb.prepare(sql).run(...params);
      return { lastInsertRowid: Number(res.lastInsertRowid), changes: res.changes };
    }
  }
};

module.exports = db;
