const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const pushService = require('../services/pushService');

const router = express.Router();

function getPair(idA, idB) {
  const u1 = Math.min(idA, idB);
  const u2 = Math.max(idA, idB);
  return { u1, u2 };
}

// 1. Получить список взаимных друзей
router.get('/', requireAuth, async (req, res) => {
  try {
    const myId = req.user.id;

    const rows = await db.all(`
      SELECT 
        f.id AS friendship_id,
        f.updated_at AS friends_since,
        u.id,
        u.username,
        u.email,
        u.avatar,
        (
          SELECT COUNT(*) FROM images 
          WHERE (sender_id = u.id AND receiver_id = ?) 
             OR (sender_id = ? AND receiver_id = u.id)
        ) AS total_images,
        (
          SELECT created_at FROM images 
          WHERE (sender_id = u.id AND receiver_id = ?) 
             OR (sender_id = ? AND receiver_id = u.id)
          ORDER BY id DESC LIMIT 1
        ) AS last_image_at,
        (
          SELECT caption FROM images 
          WHERE (sender_id = u.id AND receiver_id = ?) 
             OR (sender_id = ? AND receiver_id = u.id)
          ORDER BY id DESC LIMIT 1
        ) AS last_caption,
        (
          SELECT file_url FROM images 
          WHERE (sender_id = u.id AND receiver_id = ?) 
             OR (sender_id = ? AND receiver_id = u.id)
          ORDER BY id DESC LIMIT 1
        ) AS last_file_url,
        (
          SELECT sender_id FROM images 
          WHERE (sender_id = u.id AND receiver_id = ?) 
             OR (sender_id = ? AND receiver_id = u.id)
          ORDER BY id DESC LIMIT 1
        ) AS last_sender_id,
        (
          SELECT is_read FROM images 
          WHERE (sender_id = u.id AND receiver_id = ?) 
             OR (sender_id = ? AND receiver_id = u.id)
          ORDER BY id DESC LIMIT 1
        ) AS last_is_read,
        (
          SELECT COUNT(*) FROM images 
          WHERE sender_id = u.id AND receiver_id = ? AND (is_read = FALSE OR is_read = 0)
        ) AS unread_count
      FROM friendships f
      JOIN users u ON (u.id = CASE WHEN f.user1_id = ? THEN f.user2_id ELSE f.user1_id END)
      WHERE (f.user1_id = ? OR f.user2_id = ?) AND f.status = 'accepted'
      ORDER BY last_image_at DESC NULLS LAST, f.updated_at DESC
    `, [myId, myId, myId, myId, myId, myId, myId, myId, myId, myId, myId, myId, myId, myId, myId, myId]);

    return res.json({ friends: rows });
  } catch (err) {
    console.error('Ошибка получения друзей:', err);
    return res.status(500).json({ error: 'Не удалось получить список друзей' });
  }
});

// 2. Получить входящие и исходящие заявки
router.get('/requests', requireAuth, async (req, res) => {
  try {
    const myId = req.user.id;

    const incoming = await db.all(`
      SELECT 
        f.id AS request_id,
        f.created_at,
        u.id,
        u.username,
        u.email,
        u.avatar
      FROM friendships f
      JOIN users u ON u.id = f.action_user_id
      WHERE (f.user1_id = ? OR f.user2_id = ?)
        AND f.status = 'pending'
        AND f.action_user_id != ?
      ORDER BY f.created_at DESC
    `, [myId, myId, myId]);

    const outgoing = await db.all(`
      SELECT 
        f.id AS request_id,
        f.created_at,
        u.id,
        u.username,
        u.email,
        u.avatar
      FROM friendships f
      JOIN users u ON (u.id = CASE WHEN f.user1_id = ? THEN f.user2_id ELSE f.user1_id END)
      WHERE (f.user1_id = ? OR f.user2_id = ?)
        AND f.status = 'pending'
        AND f.action_user_id = ?
      ORDER BY f.created_at DESC
    `, [myId, myId, myId, myId]);

    return res.json({ incoming, outgoing });
  } catch (err) {
    console.error('Ошибка получения заявок:', err);
    return res.status(500).json({ error: 'Не удалось получить заявки в друзья' });
  }
});

// 3. Отправить заявку в друзья
router.post('/request', requireAuth, async (req, res) => {
  try {
    const myId = req.user.id;
    const { targetUserId, query } = req.body;

    let targetUser = null;
    if (targetUserId) {
      targetUser = await db.get('SELECT id, username, email, avatar FROM users WHERE id = ?', [targetUserId]);
    } else if (query) {
      const q = query.trim().toLowerCase();
      targetUser = await db.get('SELECT id, username, email, avatar FROM users WHERE LOWER(username) = ? OR LOWER(email) = ?', [q, q]);
    }

    if (!targetUser) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    if (Number(targetUser.id) === Number(myId)) {
      return res.status(400).json({ error: 'Нельзя добавить самого себя в друзья' });
    }

    const { u1, u2 } = getPair(myId, targetUser.id);
    const existing = await db.get('SELECT * FROM friendships WHERE user1_id = ? AND user2_id = ?', [u1, u2]);

    const io = req.app.get('io');

    if (existing) {
      if (existing.status === 'accepted') {
        return res.status(400).json({ error: 'Вы уже являетесь друзьями!' });
      }

      if (existing.status === 'pending') {
        if (Number(existing.action_user_id) === Number(myId)) {
          return res.status(400).json({ error: 'Заявка уже отправлена и ожидает ответа' });
        } else {
          // Встречная заявка -> автоматически принимаем
          await db.run(`
            UPDATE friendships 
            SET status = 'accepted', action_user_id = ?, updated_at = CURRENT_TIMESTAMP 
            WHERE id = ?
          `, [myId, existing.id]);

          if (io) {
            io.to(`user_${targetUser.id}`).emit('friend_request_accepted', {
              user: req.user,
              friendshipId: existing.id
            });
            io.to(`user_${myId}`).emit('friend_request_accepted', {
              user: targetUser,
              friendshipId: existing.id
            });
          }

          return res.json({
            message: `Вы и ${targetUser.username} теперь друзья! Теперь вы можете обмениваться картинками.`,
            status: 'accepted',
            targetUser
          });
        }
      }

      await db.run(`
        UPDATE friendships 
        SET status = 'pending', action_user_id = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `, [myId, existing.id]);
    } else {
      await db.run(`
        INSERT INTO friendships (user1_id, user2_id, status, action_user_id) 
        VALUES (?, ?, 'pending', ?) RETURNING id
      `, [u1, u2, myId]);
    }

    if (io) {
      io.to(`user_${targetUser.id}`).emit('new_friend_request', {
        fromUser: req.user
      });
    }

    pushService.sendPushToUser(targetUser.id, {
      title: 'Новая заявка в друзья! 🔔',
      body: `${req.user.username} хочет добавить вас в друзья`,
      icon: req.user.avatar || '/favicon.svg',
      data: { type: 'requests' }
    });

    return res.json({
      message: `Заявка в друзья отправлена пользователю ${targetUser.username}`,
      status: 'pending',
      targetUser
    });
  } catch (err) {
    console.error('Ошибка отправки заявки:', err);
    return res.status(500).json({ error: 'Не удалось отправить заявку' });
  }
});

// 4. Принять заявку
router.post('/accept', requireAuth, async (req, res) => {
  try {
    const myId = req.user.id;
    const { requestId, senderId } = req.body;

    let friendship = null;
    if (requestId) {
      friendship = await db.get('SELECT * FROM friendships WHERE id = ?', [requestId]);
    } else if (senderId) {
      const { u1, u2 } = getPair(myId, senderId);
      friendship = await db.get('SELECT * FROM friendships WHERE user1_id = ? AND user2_id = ?', [u1, u2]);
    }

    if (!friendship) {
      return res.status(404).json({ error: 'Заявка не найдена' });
    }

    if (Number(friendship.user1_id) !== Number(myId) && Number(friendship.user2_id) !== Number(myId)) {
      return res.status(403).json({ error: 'У вас нет доступа к этой заявке' });
    }

    if (friendship.status === 'accepted') {
      return res.json({ message: 'Вы уже друзья' });
    }

    await db.run(`
      UPDATE friendships 
      SET status = 'accepted', action_user_id = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `, [myId, friendship.id]);

    const otherUserId = Number(friendship.user1_id) === Number(myId) ? friendship.user2_id : friendship.user1_id;
    const otherUser = await db.get('SELECT id, username, email, avatar FROM users WHERE id = ?', [otherUserId]);

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${otherUserId}`).emit('friend_request_accepted', {
        user: req.user,
        friendshipId: friendship.id
      });
      io.to(`user_${myId}`).emit('friend_request_accepted', {
        user: otherUser,
        friendshipId: friendship.id
      });
    }

    pushService.sendPushToUser(otherUserId, {
      title: 'Заявка принята! 🎉',
      body: `${req.user.username} принял(а) вашу заявку в друзья!`,
      icon: req.user.avatar || '/favicon.svg',
      data: { type: 'friend', friend: req.user }
    });

    return res.json({
      message: `Заявка принята! Теперь вы можете обмениваться картинками с ${otherUser.username}.`,
      friend: otherUser
    });
  } catch (err) {
    console.error('Ошибка принятия заявки:', err);
    return res.status(500).json({ error: 'Не удалось принять заявку' });
  }
});

// 5. Отклонить заявку
router.post('/reject', requireAuth, async (req, res) => {
  try {
    const myId = req.user.id;
    const { requestId, senderId } = req.body;

    let friendship = null;
    if (requestId) {
      friendship = await db.get('SELECT * FROM friendships WHERE id = ?', [requestId]);
    } else if (senderId) {
      const { u1, u2 } = getPair(myId, senderId);
      friendship = await db.get('SELECT * FROM friendships WHERE user1_id = ? AND user2_id = ?', [u1, u2]);
    }

    if (!friendship) {
      return res.status(404).json({ error: 'Заявка не найдена' });
    }

    await db.run('DELETE FROM friendships WHERE id = ?', [friendship.id]);

    return res.json({ message: 'Заявка отклонена' });
  } catch (err) {
    console.error('Ошибка отклонения заявки:', err);
    return res.status(500).json({ error: 'Не удалось отклонить заявку' });
  }
});

// 6. Удалить друга
router.delete('/:friendId', requireAuth, async (req, res) => {
  try {
    const myId = req.user.id;
    const friendId = Number(req.params.friendId);

    const { u1, u2 } = getPair(myId, friendId);
    await db.run('DELETE FROM friendships WHERE user1_id = ? AND user2_id = ?', [u1, u2]);

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${friendId}`).emit('friend_removed', { friendId: myId });
    }

    return res.json({ message: 'Пользователь удален из друзей' });
  } catch (err) {
    console.error('Ошибка удаления друга:', err);
    return res.status(500).json({ error: 'Не удалось удалить друга' });
  }
});

// 7. Поиск пользователей
router.get('/search', requireAuth, async (req, res) => {
  try {
    const myId = req.user.id;
    const q = (req.query.q || '').trim();

    if (!q || q.length < 2) {
      return res.json({ users: [] });
    }

    const pattern = `%${q}%`;
    const users = await db.all(`
      SELECT id, username, email, avatar, created_at 
      FROM users 
      WHERE (LOWER(username) LIKE LOWER(?) OR LOWER(email) LIKE LOWER(?)) 
        AND id != ?
      LIMIT 20
    `, [pattern, pattern, myId]);

    const usersWithStatus = [];
    for (const user of users) {
      const { u1, u2 } = getPair(myId, user.id);
      const rel = await db.get('SELECT * FROM friendships WHERE user1_id = ? AND user2_id = ?', [u1, u2]);

      let relationship = 'none';
      let requestId = null;

      if (rel) {
        requestId = rel.id;
        if (rel.status === 'accepted') {
          relationship = 'friends';
        } else if (rel.status === 'pending') {
          relationship = Number(rel.action_user_id) === Number(myId) ? 'outgoing_request' : 'incoming_request';
        }
      }

      usersWithStatus.push({
        ...user,
        relationship,
        requestId
      });
    }

    return res.json({ users: usersWithStatus });
  } catch (err) {
    console.error('Ошибка поиска пользователей:', err);
    return res.status(500).json({ error: 'Не удалось выполнить поиск' });
  }
});

module.exports = router;
