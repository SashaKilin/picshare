const express = require('express');
const db = require('../db');
const { optionalAuth } = require('../middleware/auth');

const router = express.Router();

function getPair(idA, idB) {
  const u1 = Math.min(idA, idB);
  const u2 = Math.max(idA, idB);
  return { u1, u2 };
}

// Получить публичный профиль пользователя по ID или имени
router.get('/:idOrUsername', optionalAuth, async (req, res) => {
  try {
    const param = req.params.idOrUsername;
    let targetUser = null;

    if (/^\d+$/.test(param)) {
      targetUser = await db.get(
        'SELECT id, username, email, avatar, banner, bio, birthdate, badge, created_at FROM users WHERE id = ?', 
        [Number(param)]
      );
    }

    if (!targetUser) {
      targetUser = await db.get(
        'SELECT id, username, email, avatar, banner, bio, birthdate, badge, created_at FROM users WHERE LOWER(username) = LOWER(?)', 
        [param]
      );
    }

    if (!targetUser) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const myId = req.user?.id || null;
    const targetId = Number(targetUser.id);

    // Подсчет взаимных друзей
    const friendsCountRow = await db.get(`
      SELECT COUNT(*) as count FROM friendships 
      WHERE (user1_id = ? OR user2_id = ?) AND status = 'accepted'
    `, [targetId, targetId]);
    const friendsCount = Number(friendsCountRow?.count || 0);

    // Подсчет отправленных картинок
    const imagesCountRow = await db.get(`
      SELECT COUNT(*) as count FROM images 
      WHERE sender_id = ? AND file_url IS NOT NULL AND file_url != ''
    `, [targetId]);
    const imagesCount = Number(imagesCountRow?.count || 0);

    // Отношения с текущим пользователем
    let relationship = 'none';
    let requestId = null;
    let sharedImages = [];

    if (myId) {
      if (myId === targetId) {
        relationship = 'self';
      } else {
        const { u1, u2 } = getPair(myId, targetId);
        const rel = await db.get('SELECT * FROM friendships WHERE user1_id = ? AND user2_id = ?', [u1, u2]);

        if (rel) {
          requestId = rel.id;
          if (rel.status === 'accepted') {
            relationship = 'friends';

            // Если друзья, достаем до 8 общих недавних фотографий
            sharedImages = await db.all(`
              SELECT id, sender_id, file_url, original_name, caption, created_at 
              FROM images 
              WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
                AND file_url IS NOT NULL AND file_url != ''
              ORDER BY created_at DESC 
              LIMIT 8
            `, [myId, targetId, targetId, myId]);
          } else if (rel.status === 'pending') {
            relationship = Number(rel.action_user_id) === Number(myId) ? 'outgoing_request' : 'incoming_request';
          }
        }
      }
    }

    return res.json({
      user: {
        ...targetUser,
        friends_count: friendsCount,
        images_count: imagesCount,
        relationship,
        requestId,
        sharedImages
      }
    });
  } catch (err) {
    console.error('Ошибка получения профиля:', err);
    return res.status(500).json({ error: 'Не удалось загрузить профиль' });
  }
});

module.exports = router;
