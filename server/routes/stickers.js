const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const isCloudinaryConfigured = Boolean(
  process.env.CLOUDINARY_URL || 
  (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET)
);

const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'sticker-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }
});

// 1. Получить мои установленные стикерпаки с самими стикерами
router.get('/my', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    // Проверяем, установлены ли у пользователя какие-либо паки.
    // Если пользователь новый (0 паков), автоматически подключаем официальные паки
    const countRow = await db.get(`SELECT COUNT(*) as count FROM user_sticker_packs WHERE user_id = ?`, [userId]);
    if (Number(countRow?.count || 0) === 0) {
      const officialPacks = await db.all(`SELECT id FROM sticker_packs WHERE is_official IS TRUE`);
      for (const p of officialPacks) {
        try {
          await db.run(`INSERT INTO user_sticker_packs (user_id, pack_id) VALUES (?, ?)`, [userId, p.id]);
        } catch (e) {}
      }
    }

    const packs = await db.all(`
      SELECT 
        p.id,
        p.creator_id,
        p.name,
        p.title,
        p.cover_url,
        p.is_official,
        p.created_at,
        u.username AS creator_username
      FROM user_sticker_packs usp
      JOIN sticker_packs p ON p.id = usp.pack_id
      LEFT JOIN users u ON u.id = p.creator_id
      WHERE usp.user_id = ?
      ORDER BY usp.installed_at ASC, p.id ASC
    `, [userId]);

    // Для каждого пака загружаем список стикеров
    const result = [];
    for (const pack of packs) {
      const stickers = await db.all(`
        SELECT id, pack_id, file_url, emoji, position
        FROM stickers
        WHERE pack_id = ?
        ORDER BY position ASC, id ASC
      `, [pack.id]);

      result.push({
        ...pack,
        is_mine: Number(pack.creator_id) === Number(userId),
        stickers: stickers || []
      });
    }

    return res.json({ packs: result });
  } catch (err) {
    console.error('Ошибка получения моих стикеров:', err);
    return res.status(500).json({ error: 'Не удалось получить стикерпаки' });
  }
});

// 2. Магазин стикерпаков (каталог всех общедоступных стикерпаков)
router.get('/store', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const allPacks = await db.all(`
      SELECT 
        p.id,
        p.creator_id,
        p.name,
        p.title,
        p.cover_url,
        p.is_official,
        p.created_at,
        u.username AS creator_username,
        u.avatar AS creator_avatar,
        (SELECT COUNT(*) FROM stickers WHERE pack_id = p.id) AS stickers_count,
        (SELECT 1 FROM user_sticker_packs WHERE user_id = ? AND pack_id = p.id LIMIT 1) AS is_installed
      FROM sticker_packs p
      LEFT JOIN users u ON u.id = p.creator_id
      ORDER BY p.is_official DESC, p.created_at DESC
    `, [userId]);

    const result = [];
    for (const pack of allPacks) {
      // Превью первых 5 стикеров из пака
      const samples = await db.all(`
        SELECT id, file_url, emoji
        FROM stickers
        WHERE pack_id = ?
        ORDER BY position ASC, id ASC
        LIMIT 5
      `, [pack.id]);

      result.push({
        ...pack,
        is_installed: Boolean(pack.is_installed),
        is_mine: Number(pack.creator_id) === Number(userId),
        stickers_count: Number(pack.stickers_count || 0),
        samples: samples || []
      });
    }

    return res.json({ packs: result });
  } catch (err) {
    console.error('Ошибка загрузки магазина стикеров:', err);
    return res.status(500).json({ error: 'Не удалось загрузить магазин стикеров' });
  }
});

// 3. Получить конкретный стикерпак с полным списком стикеров
router.get('/pack/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const packId = Number(req.params.id);

    const pack = await db.get(`
      SELECT 
        p.id,
        p.creator_id,
        p.name,
        p.title,
        p.cover_url,
        p.is_official,
        p.created_at,
        u.username AS creator_username,
        (SELECT 1 FROM user_sticker_packs WHERE user_id = ? AND pack_id = p.id LIMIT 1) AS is_installed
      FROM sticker_packs p
      LEFT JOIN users u ON u.id = p.creator_id
      WHERE p.id = ?
    `, [userId, packId]);

    if (!pack) {
      return res.status(404).json({ error: 'Стикерпак не найден' });
    }

    const stickers = await db.all(`
      SELECT id, pack_id, file_url, emoji, position
      FROM stickers
      WHERE pack_id = ?
      ORDER BY position ASC, id ASC
    `, [packId]);

    return res.json({
      pack: {
        ...pack,
        is_installed: Boolean(pack.is_installed),
        is_mine: Number(pack.creator_id) === Number(userId),
        stickers: stickers || []
      }
    });
  } catch (err) {
    console.error('Ошибка получения стикерпака:', err);
    return res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// 4. Создать новый стикерпак
router.post('/pack', requireAuth, upload.single('cover'), async (req, res) => {
  try {
    const userId = req.user.id;
    const { title, name } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Укажите название стикерпака' });
    }

    // Генерируем уникальный slug если не указан
    let cleanName = (name || title)
      .toLowerCase()
      .replace(/[^a-z0-9_]/gi, '_')
      .slice(0, 40) + '_' + Math.random().toString(36).substr(2, 4);

    let coverUrl = '';
    if (req.file) {
      if (isCloudinaryConfigured) {
        try {
          const upRes = await cloudinary.uploader.upload(req.file.path, {
            folder: 'picshare_stickers',
            resource_type: 'image'
          });
          coverUrl = upRes.secure_url;
          fs.unlinkSync(req.file.path);
        } catch (e) {
          coverUrl = `/uploads/${req.file.filename}`;
        }
      } else {
        coverUrl = `/uploads/${req.file.filename}`;
      }
    }

    const result = await db.run(`
      INSERT INTO sticker_packs (creator_id, name, title, cover_url, is_official)
      VALUES (?, ?, ?, ?, ?) RETURNING id
    `, [userId, cleanName, title.trim(), coverUrl || null, db.isPg ? false : 0]);

    const packId = result.lastInsertRowid;

    // Сразу добавляем созданный пак в коллекцию автора
    try {
      await db.run(`INSERT INTO user_sticker_packs (user_id, pack_id) VALUES (?, ?)`, [userId, packId]);
    } catch (e) {}

    return res.json({
      success: true,
      pack: {
        id: packId,
        creator_id: userId,
        name: cleanName,
        title: title.trim(),
        cover_url: coverUrl || null,
        is_mine: true,
        stickers: []
      }
    });
  } catch (err) {
    console.error('Ошибка создания стикерпака:', err);
    return res.status(500).json({ error: 'Не удалось создать стикерпак' });
  }
});

// 5. Добавить стикер в пак (только автор)
router.post('/pack/:id/sticker', requireAuth, upload.single('sticker'), async (req, res) => {
  try {
    const userId = req.user.id;
    const packId = Number(req.params.id);
    const { emoji, fileUrl: providedUrl } = req.body;

    const pack = await db.get(`SELECT id, creator_id, cover_url FROM sticker_packs WHERE id = ?`, [packId]);
    if (!pack) {
      return res.status(404).json({ error: 'Стикерпак не найден' });
    }

    if (Number(pack.creator_id) !== Number(userId)) {
      return res.status(403).json({ error: 'Только создатель стикерпака может добавлять стикеры' });
    }

    let finalFileUrl = providedUrl || '';

    if (req.file) {
      if (isCloudinaryConfigured) {
        try {
          const upRes = await cloudinary.uploader.upload(req.file.path, {
            folder: 'picshare_stickers',
            resource_type: 'image'
          });
          finalFileUrl = upRes.secure_url;
          fs.unlinkSync(req.file.path);
        } catch (e) {
          finalFileUrl = `/uploads/${req.file.filename}`;
        }
      } else {
        finalFileUrl = `/uploads/${req.file.filename}`;
      }
    }

    if (!finalFileUrl) {
      return res.status(400).json({ error: 'Файл стикера не предоставлен' });
    }

    const posRow = await db.get(`SELECT MAX(position) as max_pos FROM stickers WHERE pack_id = ?`, [packId]);
    const nextPos = (posRow?.max_pos !== null && posRow?.max_pos !== undefined) ? Number(posRow.max_pos) + 1 : 0;

    const result = await db.run(`
      INSERT INTO stickers (pack_id, file_url, emoji, position)
      VALUES (?, ?, ?, ?) RETURNING id
    `, [packId, finalFileUrl, (emoji || '😊').slice(0, 10), nextPos]);

    const stickerId = result.lastInsertRowid;

    // Если у пака не было обложки, устанавливаем первый стикер обложкой
    if (!pack.cover_url) {
      await db.run(`UPDATE sticker_packs SET cover_url = ? WHERE id = ?`, [finalFileUrl, packId]);
    }

    return res.json({
      success: true,
      sticker: {
        id: stickerId,
        pack_id: packId,
        file_url: finalFileUrl,
        emoji: emoji || '😊',
        position: nextPos
      }
    });
  } catch (err) {
    console.error('Ошибка добавления стикера:', err);
    return res.status(500).json({ error: 'Не удалось добавить стикер' });
  }
});

// 6. Удалить стикер из пака (только автор)
router.delete('/sticker/:stickerId', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const stickerId = Number(req.params.stickerId);

    const sticker = await db.get(`
      SELECT s.id, s.pack_id, p.creator_id 
      FROM stickers s
      JOIN sticker_packs p ON p.id = s.pack_id
      WHERE s.id = ?
    `, [stickerId]);

    if (!sticker) {
      return res.status(404).json({ error: 'Стикер не найден' });
    }

    if (Number(sticker.creator_id) !== Number(userId)) {
      return res.status(403).json({ error: 'Вы не являетесь автором этого стикерпака' });
    }

    await db.run(`DELETE FROM stickers WHERE id = ?`, [stickerId]);
    return res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления стикера:', err);
    return res.status(500).json({ error: 'Не удалось удалить стикер' });
  }
});

// 7. Удалить стикерпак целиком (только автор)
router.delete('/pack/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const packId = Number(req.params.id);

    const pack = await db.get(`SELECT id, creator_id FROM sticker_packs WHERE id = ?`, [packId]);
    if (!pack) {
      return res.status(404).json({ error: 'Стикерпак не найден' });
    }

    if (Number(pack.creator_id) !== Number(userId)) {
      return res.status(403).json({ error: 'Вы можете удалить только свой стикерпак' });
    }

    await db.run(`DELETE FROM sticker_packs WHERE id = ?`, [packId]);
    return res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления стикерпака:', err);
    return res.status(500).json({ error: 'Не удалось удалить стикерпак' });
  }
});

// 8. Установить (добавить) стикерпак в свою коллекцию
router.post('/pack/:id/install', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const packId = Number(req.params.id);

    const pack = await db.get(`SELECT id FROM sticker_packs WHERE id = ?`, [packId]);
    if (!pack) {
      return res.status(404).json({ error: 'Стикерпак не найден' });
    }

    await db.run(`
      INSERT INTO user_sticker_packs (user_id, pack_id)
      VALUES (?, ?)
      ON CONFLICT DO NOTHING
    `, [userId, packId]);

    return res.json({ success: true, message: 'Стикерпак добавлен в коллекцию' });
  } catch (err) {
    console.error('Ошибка добавления стикерпака:', err);
    return res.status(500).json({ error: 'Не удалось добавить стикерпак' });
  }
});

// 9. Удалить стикерпак из своей коллекции
router.delete('/pack/:id/install', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const packId = Number(req.params.id);

    await db.run(`DELETE FROM user_sticker_packs WHERE user_id = ? AND pack_id = ?`, [userId, packId]);
    return res.json({ success: true, message: 'Стикерпак удален из коллекции' });
  } catch (err) {
    console.error('Ошибка удаления стикерпака:', err);
    return res.status(500).json({ error: 'Не удалось удалить стикерпак из коллекции' });
  }
});

module.exports = router;