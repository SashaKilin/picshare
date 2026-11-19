const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const pushService = require('../services/pushService');

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

// 1. Отправить сообщение (текст, фото или текст + фото) — в ЛС или в Группу
router.post('/send', requireAuth, upload.single('image'), async (req, res) => {
  try {
    const senderId = req.user.id;
    const receiverId = req.body.receiverId ? Number(req.body.receiverId) : null;
    const groupId = req.body.groupId ? Number(req.body.groupId) : null;
    const caption = (req.body.caption || '').trim();
    const isSticker = req.body.isSticker === 'true' || req.body.isSticker === true;

    if (!receiverId && !groupId) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Не указан получатель или группа' });
    }

    let fileUrl = req.body.fileUrl || null;
    let originalName = isSticker ? 'sticker.webp' : null;
    let fileSize = 0;

    // Должен быть либо текст сообщения, либо прикрепленная картинка, либо стикер
    if (!req.file && !caption && !fileUrl) {
      return res.status(400).json({ error: 'Введите текст сообщения, прикрепите фото или выберите стикер' });
    }
    if (groupId) {
      // Проверяем, что отправитель состоит в группе
      const membership = await db.get(
        'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
        [groupId, senderId]
      );
      if (!membership) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(403).json({ error: 'Вы не состоите в этой группе' });
      }
      groupMembers = await db.all('SELECT user_id FROM group_members WHERE group_id = ?', [groupId]);
    } else {
      // Отправлять можно себе в «Избранное» или взаимным друзьям!
      const isSelf = Number(senderId) === Number(receiverId);
      if (!isSelf) {
        const areFriends = await checkAreFriends(senderId, receiverId);
        if (!areFriends) {
          if (req.file) fs.unlinkSync(req.file.path);
          return res.status(403).json({
            error: 'Отправлять сообщения можно только взаимным друзьям! Сначала добавьте друг друга в друзья.'
          });
        }
      }
    }

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

    const safeFileUrl = fileUrl || '';
    const safeOriginalName = originalName || '';
    const replyToId = req.body.replyToId ? Number(req.body.replyToId) : null;

    let replyToMessage = null;
    if (replyToId) {
      const ref = await db.get(`
        SELECT img.id, img.sender_id, img.caption, img.file_url, u.username as sender_username 
        FROM images img
        JOIN users u ON u.id = img.sender_id
        WHERE img.id = ?
      `, [replyToId]);

      if (ref) {
        replyToMessage = {
          id: ref.id,
          username: ref.sender_username,
          caption: ref.caption || '',
          file_url: ref.file_url || ''
        };
      }
    }

    const isSaved = Number(senderId) === Number(receiverId);
    const initialIsRead = isSaved ? (db.isPg ? true : 1) : (db.isPg ? false : 0);
    const stickerFlag = db.isPg ? (isSticker ? true : false) : (isSticker ? 1 : 0);

    const result = await db.run(`
      INSERT INTO images (sender_id, receiver_id, group_id, file_url, original_name, caption, file_size, reply_to_id, is_read, is_sticker) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
    `, [senderId, receiverId, groupId, safeFileUrl, safeOriginalName, caption, fileSize, replyToId, initialIsRead, stickerFlag]);

    const newImage = {
      id: result.lastInsertRowid,
      sender_id: senderId,
      receiver_id: receiverId,
      group_id: groupId,
      file_url: safeFileUrl,
      original_name: safeOriginalName,
      caption: caption,
      file_size: fileSize,
      reply_to_id: replyToId,
      reply_to: replyToMessage,
      is_read: initialIsRead,
      is_sticker: Boolean(isSticker),
      created_at: new Date().toISOString(),
      sender_username: req.user.username,
      sender_avatar: req.user.avatar
    };

    const io = req.app.get('io');
    if (io) {
      if (groupId) {
        groupMembers.forEach(m => {
          io.to(`user_${m.user_id}`).emit('new_image', newImage);
        });
      } else if (Number(receiverId) === Number(senderId)) {
        io.to(`user_${senderId}`).emit('new_image', newImage);
      } else {
        io.to(`user_${receiverId}`).emit('new_image', newImage);
        io.to(`user_${senderId}`).emit('new_image', newImage);
      }
    }

    // Отправка Web Push (работает даже если браузер/телефон полностью закрыты)
    const pushPayload = {
      title: groupId 
        ? `Группа: сообщение от ${req.user.username}` 
        : `Новое сообщение от ${req.user.username}`,
      body: isSticker ? 'Прислал(а) стикер 🎭' : (caption || (fileUrl ? 'Прислал(а) фото 📷' : 'Новое сообщение')),
      icon: req.user.avatar || '/favicon.svg',
      data: groupId 
        ? { type: 'group', groupId } 
        : { type: 'friend', friend: { id: senderId, username: req.user.username, avatar: req.user.avatar } }
    };

    if (groupId) {
      groupMembers.forEach(m => {
        if (Number(m.user_id) !== Number(senderId)) {
          pushService.sendPushToUser(m.user_id, pushPayload);
        }
      });
    } else if (receiverId && Number(receiverId) !== Number(senderId)) {
      pushService.sendPushToUser(receiverId, pushPayload);
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
    const isSelf = Number(myId) === Number(friendId);

    if (!isSelf) {
      const areFriends = await checkAreFriends(myId, friendId);
      if (!areFriends) {
        return res.status(403).json({
          error: 'Доступ закрыт: переписка доступна только со взаимными друзьями'
        });
      }

      // Отмечаем входящие сообщения прочитанными
      await db.run(`
        UPDATE images SET is_read = TRUE 
        WHERE sender_id = ? AND receiver_id = ? AND is_read IS NOT TRUE
      `, [friendId, myId]);

      const io = req.app.get('io');
      if (io) {
        io.to(`user_${friendId}`).emit('messages_read', { readerId: myId });
      }
    }

    const rows = await db.all(`
      SELECT 
        img.id,
        img.sender_id,
        img.receiver_id,
        img.file_url,
        img.original_name,
        img.caption,
        img.file_size,
        img.reply_to_id,
        img.is_read,
        img.is_sticker,
        img.created_at,
        u.username AS sender_username,
        u.avatar AS sender_avatar,
        rep.id AS reply_id,
        rep.caption AS reply_caption,
        rep.file_url AS reply_file_url,
        rep_u.username AS reply_username
      FROM images img
      JOIN users u ON u.id = img.sender_id
      LEFT JOIN images rep ON rep.id = img.reply_to_id
      LEFT JOIN users rep_u ON rep_u.id = rep.sender_id
      WHERE (img.sender_id = ? AND img.receiver_id = ?) 
         OR (img.sender_id = ? AND img.receiver_id = ?)
      ORDER BY img.created_at ASC
    `, [myId, friendId, friendId, myId]);

    const images = rows.map(r => ({
      id: r.id,
      sender_id: r.sender_id,
      receiver_id: r.receiver_id,
      file_url: r.file_url,
      original_name: r.original_name,
      caption: r.caption,
      file_size: r.file_size,
      reply_to_id: r.reply_to_id,
      is_sticker: Number(r.is_sticker) === 1 || r.is_sticker === true,
      is_read: Number(r.is_read) === 1 || r.is_read === true,
      is_sticker: Number(r.is_sticker) === 1 || r.is_sticker === true,
      reply_to: r.reply_id ? {
        id: r.reply_id,
        username: r.reply_username,
        caption: r.reply_caption,
        file_url: r.reply_file_url
      } : null,
      created_at: r.created_at,
      sender_username: r.sender_username,
      sender_avatar: r.sender_avatar
    }));

    let friend;
    if (isSelf) {
      friend = {
        id: myId,
        username: 'Избранное',
        email: req.user.email || '',
        avatar: null,
        isSaved: true
      };
    } else {
      friend = await db.get('SELECT id, username, email, avatar FROM users WHERE id = ?', [friendId]);
    }

    return res.json({ friend, images });
  } catch (err) {
    console.error('Ошибка получения сообщений:', err);
    return res.status(500).json({ error: 'Не удалось загрузить историю сообщений' });
  }
});

// 2.0. Отметить сообщения в диалоге как прочитанные
router.post('/read/:friendId', requireAuth, async (req, res) => {
  try {
    const myId = req.user.id;
    const friendId = Number(req.params.friendId);
    await db.run(`
      UPDATE images SET is_read = TRUE 
      WHERE sender_id = ? AND receiver_id = ? AND is_read IS NOT TRUE
    `, [friendId, myId]);

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${friendId}`).emit('messages_read', { readerId: myId });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('Ошибка отметки о прочтении:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 2.1. Получить историю сообщений группы
router.get('/chat/group/:groupId', requireAuth, async (req, res) => {
  try {
    const myId = req.user.id;
    const groupId = Number(req.params.groupId);

    const membership = await db.get(
      'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, myId]
    );
    if (!membership) {
      return res.status(403).json({ error: 'Вы не состоите в этой группе' });
    }

    const group = await db.get(`
      SELECT 
        g.id,
        g.name,
        g.description,
        g.avatar,
        g.creator_id,
        g.created_at,
        (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) AS members_count,
        (CASE WHEN g.creator_id = ? THEN 1 ELSE 0 END) AS is_creator
      FROM groups g
      WHERE g.id = ?
    `, [myId, groupId]);

    const rows = await db.all(`
      SELECT 
        img.id,
        img.sender_id,
        img.receiver_id,
        img.group_id,
        img.file_url,
        img.original_name,
        img.caption,
        img.file_size,
        img.reply_to_id,
        img.is_sticker,
        img.created_at,
        u.username AS sender_username,
        u.avatar AS sender_avatar,
        rep.id AS reply_id,
        rep.caption AS reply_caption,
        rep.file_url AS reply_file_url,
        rep_u.username AS reply_username
      FROM images img
      JOIN users u ON u.id = img.sender_id
      LEFT JOIN images rep ON rep.id = img.reply_to_id
      LEFT JOIN users rep_u ON rep_u.id = rep.sender_id
      WHERE img.group_id = ?
      ORDER BY img.created_at ASC
    `, [groupId]);

    const images = rows.map(r => ({
      id: r.id,
      sender_id: r.sender_id,
      receiver_id: r.receiver_id,
      group_id: r.group_id,
      file_url: r.file_url,
      original_name: r.original_name,
      caption: r.caption,
      file_size: r.file_size,
      reply_to_id: r.reply_to_id,
      is_sticker: Number(r.is_sticker) === 1 || r.is_sticker === true,
      reply_to: r.reply_id ? {
        id: r.reply_id,
        username: r.reply_username,
        caption: r.reply_caption,
        file_url: r.reply_file_url
      } : null,
      created_at: r.created_at,
      sender_username: r.sender_username,
      sender_avatar: r.sender_avatar
    }));

    return res.json({ group, images });
  } catch (err) {
    console.error('Ошибка получения сообщений группы:', err);
    return res.status(500).json({ error: 'Не удалось загрузить историю сообщений группы' });
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
