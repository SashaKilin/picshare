const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// 1. Получить список всех групп, в которых состоит текущий пользователь
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const groups = await db.all(`
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
      JOIN group_members gm ON gm.group_id = g.id
      WHERE gm.user_id = ?
      ORDER BY g.created_at DESC
    `, [userId, userId]);

    return res.json({ groups });
  } catch (err) {
    console.error('Ошибка получения списка групп:', err);
    return res.status(500).json({ error: 'Не удалось загрузить группы' });
  }
});

// 2. Создать новую группу
router.post('/', requireAuth, async (req, res) => {
  try {
    const creatorId = req.user.id;
    const { name, description, avatar, memberIds } = req.body;

    const trimmedName = (name || '').trim();
    if (!trimmedName || trimmedName.length < 2) {
      return res.status(400).json({ error: 'Название группы должно содержать от 2 символов' });
    }

    const groupAvatar = avatar || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(trimmedName)}`;
    const groupDesc = (description || '').trim().slice(0, 500);

    // Создаем группу
    const groupResult = await db.run(`
      INSERT INTO groups (name, description, avatar, creator_id)
      VALUES (?, ?, ?, ?) RETURNING id
    `, [trimmedName, groupDesc, groupAvatar, creatorId]);

    const groupId = Number(groupResult.lastInsertRowid);

    // Добавляем создателя в участники
    await db.run(`
      INSERT INTO group_members (group_id, user_id)
      VALUES (?, ?)
    `, [groupId, creatorId]);

    // Если создатель сразу выбрал участников из своих друзей
    const validMemberIds = Array.isArray(memberIds) ? memberIds.map(Number).filter(id => id && id !== creatorId) : [];

    for (const mId of validMemberIds) {
      try {
        await db.run(`
          INSERT INTO group_members (group_id, user_id)
          VALUES (?, ?)
        `, [groupId, mId]);
      } catch (e) {
        // Игнорируем дубли
      }
    }

    const createdGroup = await db.get(`
      SELECT 
        g.id,
        g.name,
        g.description,
        g.avatar,
        g.creator_id,
        g.created_at,
        (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) AS members_count,
        1 AS is_creator
      FROM groups g
      WHERE g.id = ?
    `, [groupId]);

    // Уведомляем добавленных участников через Socket.IO
    const io = req.app.get('io');
    if (io) {
      const allMembers = await db.all('SELECT user_id FROM group_members WHERE group_id = ?', [groupId]);
      allMembers.forEach(m => {
        io.to(`user_${m.user_id}`).emit('group_created', createdGroup);
      });
    }

    return res.status(201).json({
      message: 'Группа успешно создана',
      group: createdGroup
    });
  } catch (err) {
    console.error('Ошибка создания группы:', err);
    return res.status(500).json({ error: 'Не удалось создать группу' });
  }
});

// 3. Получить информацию о группе и список участников
router.get('/:groupId', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const groupId = Number(req.params.groupId);

    // Проверяем, что пользователь состоит в группе
    const membership = await db.get(
      'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, userId]
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
        (CASE WHEN g.creator_id = ? THEN 1 ELSE 0 END) AS is_creator
      FROM groups g
      WHERE g.id = ?
    `, [userId, groupId]);

    if (!group) {
      return res.status(404).json({ error: 'Группа не найдена' });
    }

    // Список участников
    const members = await db.all(`
      SELECT 
        u.id,
        u.username,
        u.avatar,
        u.badge,
        gm.joined_at,
        (CASE WHEN u.id = ? THEN 1 ELSE 0 END) AS is_creator
      FROM group_members gm
      JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = ?
      ORDER BY (CASE WHEN u.id = ? THEN 0 ELSE 1 END), u.username ASC
    `, [group.creator_id, groupId, group.creator_id]);

    return res.json({
      group: {
        ...group,
        members_count: members.length,
        members
      }
    });
  } catch (err) {
    console.error('Ошибка загрузки данных группы:', err);
    return res.status(500).json({ error: 'Не удалось загрузить данные группы' });
  }
});

// 4. Редактировать группу (название, описание, фото) — ТОЛЬКО СОЗДАТЕЛЬ!
router.put('/:groupId', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const groupId = Number(req.params.groupId);
    const { name, description, avatar } = req.body;

    const group = await db.get('SELECT * FROM groups WHERE id = ?', [groupId]);
    if (!group) {
      return res.status(404).json({ error: 'Группа не найдена' });
    }

    // Только создатель может редактировать!
    if (Number(group.creator_id) !== Number(userId)) {
      return res.status(403).json({ error: 'Только создатель группы может редактировать её настройки' });
    }

    const updates = [];
    const params = [];

    if (typeof name !== 'undefined') {
      const cleanName = (name || '').trim();
      if (cleanName.length < 2) {
        return res.status(400).json({ error: 'Название группы должно быть от 2 символов' });
      }
      updates.push('name = ?');
      params.push(cleanName);
    }

    if (typeof description !== 'undefined') {
      updates.push('description = ?');
      params.push((description || '').trim().slice(0, 500));
    }

    if (typeof avatar !== 'undefined') {
      updates.push('avatar = ?');
      params.push((avatar || '').trim());
    }

    if (updates.length > 0) {
      params.push(groupId);
      await db.run(`UPDATE groups SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    const updatedGroup = await db.get('SELECT * FROM groups WHERE id = ?', [groupId]);

    // Оповещаем участников через сокет
    const io = req.app.get('io');
    if (io) {
      const allMembers = await db.all('SELECT user_id FROM group_members WHERE group_id = ?', [groupId]);
      allMembers.forEach(m => {
        io.to(`user_${m.user_id}`).emit('group_updated', updatedGroup);
      });
    }

    return res.json({
      message: 'Группа успешно обновлена',
      group: updatedGroup
    });
  } catch (err) {
    console.error('Ошибка обновления группы:', err);
    return res.status(500).json({ error: 'Не удалось обновить группу' });
  }
});

// 5. Добавить участников в группу — ТОЛЬКО СОЗДАТЕЛЬ!
router.post('/:groupId/members', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const groupId = Number(req.params.groupId);
    const { userIds, userId: singleUserId } = req.body;

    const group = await db.get('SELECT * FROM groups WHERE id = ?', [groupId]);
    if (!group) {
      return res.status(404).json({ error: 'Группа не найдена' });
    }

    // Ключевое требование: только создатель может добавлять участников!
    if (Number(group.creator_id) !== Number(userId)) {
      return res.status(403).json({ error: 'Только создатель группы может добавлять новых участников' });
    }

    const toAdd = Array.isArray(userIds) ? userIds.map(Number) : (singleUserId ? [Number(singleUserId)] : []);

    if (toAdd.length === 0) {
      return res.status(400).json({ error: 'Не выбраны пользователи для добавления' });
    }

    for (const targetId of toAdd) {
      if (!targetId) continue;
      try {
        await db.run(
          'INSERT INTO group_members (group_id, user_id) VALUES (?, ?)',
          [groupId, targetId]
        );
      } catch (e) {
        // Уже в группе
      }
    }

    // Получаем обновленный список участников
    const members = await db.all(`
      SELECT 
        u.id,
        u.username,
        u.avatar,
        u.badge,
        gm.joined_at,
        (CASE WHEN u.id = ? THEN 1 ELSE 0 END) AS is_creator
      FROM group_members gm
      JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = ?
    `, [group.creator_id, groupId]);

    const io = req.app.get('io');
    if (io) {
      members.forEach(m => {
        io.to(`user_${m.id}`).emit('group_members_updated', { groupId, members });
      });
    }

    return res.json({
      message: 'Участники добавлены в группу',
      members
    });
  } catch (err) {
    console.error('Ошибка добавления участников:', err);
    return res.status(500).json({ error: 'Не удалось добавить участников' });
  }
});

// 6. Удалить участника или выйти из группы
router.delete('/:groupId/members/:targetUserId', requireAuth, async (req, res) => {
  try {
    const currentUserId = Number(req.user.id);
    const groupId = Number(req.params.groupId);
    const targetUserId = Number(req.params.targetUserId);

    const group = await db.get('SELECT * FROM groups WHERE id = ?', [groupId]);
    if (!group) {
      return res.status(404).json({ error: 'Группа не найдена' });
    }

    const isCreator = Number(group.creator_id) === currentUserId;
    const isSelfLeaving = currentUserId === targetUserId;

    // Только создатель может удалять кого-то, либо сам пользователь может выйти
    if (!isCreator && !isSelfLeaving) {
      return res.status(403).json({ error: 'У вас нет прав на удаление этого участника' });
    }

    // Если создатель выходит сам из своей группы
    if (isSelfLeaving && isCreator) {
      // Ищем следующего участника
      const nextMember = await db.get(
        'SELECT user_id FROM group_members WHERE group_id = ? AND user_id != ? ORDER BY joined_at ASC',
        [groupId, currentUserId]
      );

      if (nextMember) {
        // Передаем права создателя следующему участнику
        await db.run('UPDATE groups SET creator_id = ? WHERE id = ?', [nextMember.user_id, groupId]);
      } else {
        // Если участников больше нет, удаляем группу целиком
        await db.run('DELETE FROM groups WHERE id = ?', [groupId]);
        return res.json({ message: 'Группа расформирована и удалена' });
      }
    }

    // Удаляем из group_members
    await db.run(
      'DELETE FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, targetUserId]
    );

    const io = req.app.get('io');
    if (io) {
      const remainingMembers = await db.all('SELECT user_id FROM group_members WHERE group_id = ?', [groupId]);
      remainingMembers.forEach(m => {
        io.to(`user_${m.user_id}`).emit('group_member_removed', { groupId, removedUserId: targetUserId });
      });
      io.to(`user_${targetUserId}`).emit('removed_from_group', { groupId });
    }

    return res.json({ message: isSelfLeaving ? 'Вы покинули группу' : 'Участник удален из группы' });
  } catch (err) {
    console.error('Ошибка удаления участника из группы:', err);
    return res.status(500).json({ error: 'Не удалось удалить участника' });
  }
});

// 7. Удалить группу целиком — ТОЛЬКО СОЗДАТЕЛЬ!
router.delete('/:groupId', requireAuth, async (req, res) => {
  try {
    const userId = Number(req.user.id);
    const groupId = Number(req.params.groupId);

    const group = await db.get('SELECT * FROM groups WHERE id = ?', [groupId]);
    if (!group) {
      return res.status(404).json({ error: 'Группа не найдена' });
    }

    if (Number(group.creator_id) !== userId) {
      return res.status(403).json({ error: 'Только создатель может удалить группу' });
    }

    const members = await db.all('SELECT user_id FROM group_members WHERE group_id = ?', [groupId]);

    await db.run('DELETE FROM groups WHERE id = ?', [groupId]);

    const io = req.app.get('io');
    if (io) {
      members.forEach(m => {
        io.to(`user_${m.user_id}`).emit('group_deleted', { groupId });
      });
    }

    return res.json({ message: 'Группа успешно удалена' });
  } catch (err) {
    console.error('Ошибка удаления группы:', err);
    return res.status(500).json({ error: 'Не удалось удалить группу' });
  }
});

module.exports = router;
