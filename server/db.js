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
          is_read BOOLEAN DEFAULT FALSE,
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

        CREATE TABLE IF NOT EXISTS sticker_packs (
          id SERIAL PRIMARY KEY,
          creator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          name VARCHAR(255) NOT NULL UNIQUE,
          title VARCHAR(255) NOT NULL,
          cover_url TEXT,
          is_official BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS stickers (
          id SERIAL PRIMARY KEY,
          pack_id INTEGER NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
          file_url TEXT NOT NULL,
          emoji VARCHAR(20) DEFAULT '😊',
          position INTEGER DEFAULT 0,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS user_sticker_packs (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          pack_id INTEGER NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
          installed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, pack_id)
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
        `ALTER TABLE images ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE;`,
        `ALTER TABLE images ADD COLUMN IF NOT EXISTS is_sticker BOOLEAN DEFAULT FALSE;`,
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
          is_read INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY(receiver_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_friendships_users ON friendships(user1_id, user2_id);
        CREATE INDEX IF NOT EXISTS idx_images_chat ON images(sender_id, receiver_id);
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

        CREATE TABLE IF NOT EXISTS sticker_packs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          creator_id INTEGER,
          name TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          cover_url TEXT,
          is_official INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(creator_id) REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS stickers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          pack_id INTEGER NOT NULL,
          file_url TEXT NOT NULL,
          emoji TEXT DEFAULT '😊',
          position INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(pack_id) REFERENCES sticker_packs(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS user_sticker_packs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          pack_id INTEGER NOT NULL,
          installed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, pack_id),
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY(pack_id) REFERENCES sticker_packs(id) ON DELETE CASCADE
        );
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
        const imageCols = sqliteDb.prepare("PRAGMA table_info(images);").all().map(c => c.name);
        if (!imageCols.includes('is_read')) sqliteDb.exec("ALTER TABLE images ADD COLUMN is_read INTEGER DEFAULT 0;");
        if (!imageCols.includes('is_sticker')) sqliteDb.exec("ALTER TABLE images ADD COLUMN is_sticker INTEGER DEFAULT 0;");
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

      try {
        sqliteDb.exec(`
          CREATE INDEX IF NOT EXISTS idx_images_group ON images(group_id);
          CREATE INDEX IF NOT EXISTS idx_group_members ON group_members(group_id, user_id);
        `);
      } catch (idxErr) {}

      console.log('✅ Таблицы SQLite готовы (профили, чат, баннеры, группы)');
    }

    // Одноразовая очистка старых исторических непрочитанных сообщений, накопившихся до внедрения системы прочтений
    try {
      if (isPg) {
        await pgPool.query(`UPDATE images SET is_read = TRUE WHERE is_read IS NOT TRUE AND created_at < NOW() - INTERVAL '1 day'`);
      } else {
        sqliteDb.exec(`UPDATE images SET is_read = 1 WHERE (is_read = 0 OR is_read IS NULL) AND created_at < datetime('now', '-1 day')`);
      }
    } catch (cleanErr) {}

    // Инициализируем стартовые стикерпаки
    await seedDefaultStickers();
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

async function seedDefaultStickers() {
  try {
    const packsData = [
      {
        name: 'pepe_classic',
        title: 'Легендарный Пепе',
        cover_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=PepeKing',
        stickers: [
          { emoji: '😎', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=PepeCool' },
          { emoji: '❤️', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=PepeLove' },
          { emoji: '😂', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=PepeLaugh' },
          { emoji: '🔥', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=PepeFire' },
          { emoji: '👍', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=PepeLike' },
          { emoji: '🤔', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=PepeThink' },
          { emoji: '🎉', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=PepeParty' },
          { emoji: '😴', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=PepeSleep' }
        ]
      },
      {
        name: 'cute_cats',
        title: 'Крутые Котики',
        cover_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=CoolCat',
        stickers: [
          { emoji: '😻', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=CatHeart' },
          { emoji: '😺', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=CatSmile' },
          { emoji: '😹', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=CatLol' },
          { emoji: '😼', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=CatBoss' },
          { emoji: '😿', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=CatSad' },
          { emoji: '🐾', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=CatPaw' }
        ]
      },
      {
        name: 'pixel_heroes',
        title: 'Пиксельные Герои',
        cover_url: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=PixelHero',
        stickers: [
          { emoji: '👾', url: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=Invader' },
          { emoji: '⚔️', url: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=Knight' },
          { emoji: '🧙‍♂️', url: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=Wizard' },
          { emoji: '🤖', url: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=Cyborg' },
          { emoji: '💎', url: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=Diamond' },
          { emoji: '🚀', url: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=Rocket' }
        ]
      }
    ];

    for (const p of packsData) {
      let pack = await db.get(`SELECT id FROM sticker_packs WHERE name = ?`, [p.name]);
      let packId = pack ? pack.id : null;

      if (!packId) {
        if (isPg) {
          const res = await pgPool.query(
            `INSERT INTO sticker_packs (name, title, cover_url, is_official) VALUES ($1, $2, $3, $4) RETURNING id`,
            [p.name, p.title, p.cover_url, true]
          );
          packId = res.rows[0].id;
        } else {
          const res = await db.run(
            `INSERT INTO sticker_packs (name, title, cover_url, is_official) VALUES (?, ?, ?, 1)`,
            [p.name, p.title, p.cover_url]
          );
          packId = res.lastInsertRowid;
        }
      }

      if (packId) {
        const countRow = await db.get(`SELECT COUNT(*) as count FROM stickers WHERE pack_id = ?`, [packId]);
        if (Number(countRow?.count || 0) === 0) {
          for (let i = 0; i < p.stickers.length; i++) {
            await db.run(
              `INSERT INTO stickers (pack_id, file_url, emoji, position) VALUES (?, ?, ?, ?)`,
              [packId, p.stickers[i].url, p.stickers[i].emoji, i]
            );
          }
        }
      }
    }
    console.log('✅ Стартовые стикерпаки и стикеры успешно проверены и заполнены!');
  } catch (err) {
    console.error('Ошибка инициализации стартовых стикеров:', err.message);
  }
}

module.exports = db;
