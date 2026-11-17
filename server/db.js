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
      await pgPool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username VARCHAR(255) UNIQUE NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash TEXT,
          google_id VARCHAR(255) UNIQUE,
          avatar TEXT,
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

        CREATE TABLE IF NOT EXISTS images (
          id SERIAL PRIMARY KEY,
          sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          file_url TEXT,
          original_name TEXT,
          caption TEXT,
          file_size INTEGER,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_friendships_users ON friendships(user1_id, user2_id);
        CREATE INDEX IF NOT EXISTS idx_images_chat ON images(sender_id, receiver_id);
      `);

      // Снимаем ограничение NOT NULL с file_url и original_name, если таблица была создана ранее
      try {
        await pgPool.query(`
          ALTER TABLE images ALTER COLUMN file_url DROP NOT NULL;
          ALTER TABLE images ALTER COLUMN original_name DROP NOT NULL;
        `);
      } catch (e) {
        // Игнорируем, если уже nullable
      }

      console.log('✅ Таблицы PostgreSQL готовы (поддержка текста и фото)');
    } else {
      sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT,
          google_id TEXT UNIQUE,
          avatar TEXT,
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

        CREATE TABLE IF NOT EXISTS images (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sender_id INTEGER NOT NULL,
          receiver_id INTEGER NOT NULL,
          file_url TEXT,
          original_name TEXT,
          caption TEXT,
          file_size INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY(receiver_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_friendships_users ON friendships(user1_id, user2_id);
        CREATE INDEX IF NOT EXISTS idx_images_chat ON images(sender_id, receiver_id);
      `);
      console.log('✅ Таблицы SQLite готовы (поддержка текста и фото)');
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
