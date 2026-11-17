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

async function checkAreFriends(userA, userB) {
  const u1 = Math.min(userA, userB);
  const u2 = Math.max(userA, userB);
  const row = await db.get('SELECT status FROM friendships WHERE user1_id = ? AND user2_id = ?', [u1, u2]);
  return row && row.status === 'accepted';
}

// 1. Отправить сообщение (текст, фото или текст + фото)
router.post('/send', requireAuth, upload.single('image'), async (req, res) => {
  try {
    const senderId = req.user.id;
    const receiverId = Number(req.body.receiverId);
    const caption = (req.body.caption || '').trim();

    if (!receiverId) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Не указан получатель' });
    }

    // Должен быть либо текст сообщения, либо прикрепленная картинка
    if (!req.file && !caption) {
      return res.status(400).json({ error: 'Введите текст сообщения или прикрепите изображение' });
    }

    // Отправлять можно только взаимным друзьям!
    const areFriends = await checkAreFriends(senderId, receiverId);
    if (!areFriends) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(403).json({
        error: 'Отправлять сообщения можно только взаимным друзьям! Сначала добавьте друг друга в друзья.'
      });
    }

    let fileUrl = null;
    let originalName = null;
    let fileSize = 0;

    // Если есть прикрепленный файл
    if (req.file) {
      originalName = req.file.originalname;
      fileSize = req.file.size;

      if (isCloudinaryConfigured) {
        try {
          const uploadResult = await cloudinary.uploader.upload(req.file.path, {
            folder: 'picshare_images',
            resource_type: 'image',
          });
          fileUrl = uploadResult.secure_url;
          fs.unlinkSync(req.file.path);
        } catch (cloudErr) {
          console.error('Ошибка загрузки в Cloudinary:', cloudErr);
          fileUrl = `/uploads/${req.file.filename}`;
        }
      } else {
        fileUrl = `/uploads/${req.file.filename}`;
      }
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
      message: fileUrl ? 'Картинка отправлена!' : 'Сообщение отправлено!',
      image: newImage
    });
  } catch (err) {
    console.error('Ошибка отправки сообщения:', err);
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
    return res.status(500).json({ error: err.message || 'Ошибка сервера при отправке' });
  }
});

// 2. Получить историю диалога (и фото, и текстовые сообщения)
router.get('/chat/:friendId', requireAuth, async (req, res) => {
  try {
    const myId = req.user.id;
    const friendId = Number(req.params.friendId);

    const areFriends = await checkAreFriends(myId, friendId);
    if (!areFriends) {
      return res.status(403).json({
        error: 'Доступ закрыт: переписка доступна только со взаимными друзьями'
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
    console.error('Ошибка получения сообщений:', err);
    return res.status(500).json({ error: 'Не удалось загрузить историю сообщений' });
  }
});

// 3. Удалить сообщение или картинку
router.delete('/:imageId', requireAuth, async (req, res) => {
  try {
    const myId = req.user.id;
    const imageId = Number(req.params.imageId);

    const image = await db.get('SELECT * FROM images WHERE id = ?', [imageId]);
    if (!image) {
      return res.status(404).json({ error: 'Сообщение не найдено' });
    }

    if (Number(image.sender_id) !== Number(myId)) {
      return res.status(403).json({ error: 'Вы можете удалять только отправленные вами сообщения' });
    }

    if (image.file_url && image.file_url.startsWith('/uploads/')) {
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

    return res.json({ message: 'Удалено' });
  } catch (err) {
    console.error('Ошибка удаления:', err);
    return res.status(500).json({ error: 'Не удалось удалить' });
  }
});

// 4. Общая галерея (только фото)
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
      WHERE (img.receiver_id = ? OR img.sender_id = ?) 
        AND img.file_url IS NOT NULL 
        AND img.file_url != ''
      ORDER BY img.created_at DESC
      LIMIT 50
    `, [myId, myId]);

    return res.json({ feed });
  } catch (err) {
    console.error('Ошибка получения галереи:', err);
    return res.status(500).json({ error: 'Не удалось загрузить галерею' });
  }
});

module.exports = router;
