const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Проверяем, настроен ли Cloudinary
const isCloudinaryConfigured = Boolean(
  process.env.CLOUDINARY_URL || 
  (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET)
);

if (isCloudinaryConfigured) {
  if (process.env.CLOUDINARY_CLOUD_NAME) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }
  console.log('☁️ Включено облачное хранилище картинок Cloudinary');
} else {
  console.log('📁 Используется локальное хранилище картинок (server/uploads)');
}

// Папка uploads для локального хранения или временных файлов multer
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
    cb(null, 'pic-' + uniqueSuffix + ext);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Разрешены только изображения (JPEG, PNG, WEBP, GIF, SVG)'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 25 * 1024 * 1024 }
});

// Проверка дружбы
async function checkAreFriends(userA, userB) {
  const u1 = Math.min(userA, userB);
  const u2 = Math.max(userA, userB);
  const row = await db.get('SELECT status FROM friendships WHERE user1_id = ? AND user2_id = ?', [u1, u2]);
  return row && row.status === 'accepted';
}

// 1. Отправить картинку другу
router.post('/send', requireAuth, upload.single('image'), async (req, res) => {
  try {
    const senderId = req.user.id;
    const receiverId = Number(req.body.receiverId);
    const caption = (req.body.caption || '').trim();

    if (!receiverId) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Не указан получатель' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Пожалуйста, выберите изображение' });
    }

    // ГЛАВНОЕ ПРАВИЛО: отправлять картинки можно ТОЛЬКО взаимным друзьям!
    const areFriends = await checkAreFriends(senderId, receiverId);
    if (!areFriends) {
      fs.unlinkSync(req.file.path);
      return res.status(403).json({
        error: 'Отправлять картинки можно только взаимным друзьям! Сначала добавьте друг друга в друзья.'
      });
    }

    let fileUrl = '';
    const originalName = req.file.originalname;
    const fileSize = req.file.size;

    // Если подключен Cloudinary — загружаем в облако, если нет — сохраняем локально
    if (isCloudinaryConfigured) {
      try {
        const uploadResult = await cloudinary.uploader.upload(req.file.path, {
          folder: 'picshare_images',
          resource_type: 'image',
        });
        fileUrl = uploadResult.secure_url;
        // Удаляем локальный временный файл
        fs.unlinkSync(req.file.path);
      } catch (cloudErr) {
        console.error('Ошибка загрузки в Cloudinary:', cloudErr);
        // Fallback на локальный файл
        fileUrl = `/uploads/${req.file.filename}`;
      }
    } else {
      fileUrl = `/uploads/${req.file.filename}`;
    }

    const result = await db.run(`
      INSERT INTO images (sender_id, receiver_id, file_url, original_name, caption, file_size) 
      VALUES (?, ?, ?, ?, ?, ?) RETURNING id
    `, [senderId, receiverId, fileUrl, originalName, caption, fileSize]);

    const newImage = {
      id: result.lastInsertRowid,
      sender_id: senderId,
      receiver_id: receiverId,
      file_url: fileUrl,
      original_name: originalName,
      caption: caption,
      file_size: fileSize,
      created_at: new Date().toISOString(),
      sender_username: req.user.username,
      sender_avatar: req.user.avatar
    };

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${receiverId}`).emit('new_image', newImage);
      io.to(`user_${senderId}`).emit('new_image', newImage);
    }

    return res.status(201).json({
      message: 'Картинка успешно отправлена!',
      image: newImage
    });
  } catch (err) {
    console.error('Ошибка отправки картинки:', err);
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
    return res.status(500).json({ error: err.message || 'Ошибка сервера при отправке картинки' });
  }
});

// 2. Получить историю картинок в диалоге с другом
router.get('/chat/:friendId', requireAuth, async (req, res) => {
  try {
    const myId = req.user.id;
    const friendId = Number(req.params.friendId);

    const areFriends = await checkAreFriends(myId, friendId);
    if (!areFriends) {
      return res.status(403).json({
        error: 'Доступ закрыт: просматривать обмен картинками можно только со взаимными друзьями'
      });
    }

    const images = await db.all(`
      SELECT 
        img.id,
        img.sender_id,
        img.receiver_id,
        img.file_url,
        img.original_name,
        img.caption,
        img.file_size,
        img.created_at,
        u.username AS sender_username,
        u.avatar AS sender_avatar
      FROM images img
      JOIN users u ON u.id = img.sender_id
      WHERE (img.sender_id = ? AND img.receiver_id = ?) 
         OR (img.sender_id = ? AND img.receiver_id = ?)
      ORDER BY img.created_at ASC
    `, [myId, friendId, friendId, myId]);

    const friend = await db.get('SELECT id, username, email, avatar FROM users WHERE id = ?', [friendId]);

    return res.json({ friend, images });
  } catch (err) {
    console.error('Ошибка получения картинок:', err);
    return res.status(500).json({ error: 'Не удалось загрузить историю картинок' });
  }
});

// 3. Удалить картинку
router.delete('/:imageId', requireAuth, async (req, res) => {
  try {
    const myId = req.user.id;
    const imageId = Number(req.params.imageId);

    const image = await db.get('SELECT * FROM images WHERE id = ?', [imageId]);
    if (!image) {
      return res.status(404).json({ error: 'Картинка не найдена' });
    }

    if (Number(image.sender_id) !== Number(myId)) {
      return res.status(403).json({ error: 'Вы можете удалять только отправленные вами картинки' });
    }

    // Удаляем файл с локального диска, если он хранился локально
    if (image.file_url.startsWith('/uploads/')) {
      const filename = path.basename(image.file_url);
      const diskPath = path.join(uploadsDir, filename);
      if (fs.existsSync(diskPath)) {
        try { fs.unlinkSync(diskPath); } catch (e) {}
      }
    }

    await db.run('DELETE FROM images WHERE id = ?', [imageId]);

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${image.receiver_id}`).emit('image_deleted', { imageId });
      io.to(`user_${image.sender_id}`).emit('image_deleted', { imageId });
    }

    return res.json({ message: 'Картинка удалена' });
  } catch (err) {
    console.error('Ошибка удаления картинки:', err);
    return res.status(500).json({ error: 'Не удалось удалить картинку' });
  }
});

// 4. Последние картинки от всех друзей
router.get('/feed', requireAuth, async (req, res) => {
  try {
    const myId = req.user.id;

    const feed = await db.all(`
      SELECT 
        img.id,
        img.sender_id,
        img.receiver_id,
        img.file_url,
        img.original_name,
        img.caption,
        img.file_size,
        img.created_at,
        u.username AS sender_username,
        u.avatar AS sender_avatar
      FROM images img
      JOIN users u ON u.id = img.sender_id
      JOIN friendships f ON (
        ((f.user1_id = img.sender_id AND f.user2_id = img.receiver_id) OR
         (f.user1_id = img.receiver_id AND f.user2_id = img.sender_id))
        AND f.status = 'accepted'
      )
      WHERE img.receiver_id = ? OR img.sender_id = ?
      ORDER BY img.created_at DESC
      LIMIT 50
    `, [myId, myId]);

    return res.json({ feed });
  } catch (err) {
    console.error('Ошибка получения ленты картинок:', err);
    return res.status(500).json({ error: 'Не удалось загрузить ленту картинок' });
  }
});

module.exports = router;
