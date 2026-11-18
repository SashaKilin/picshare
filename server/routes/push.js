const express = require('express');
const pushService = require('../services/pushService');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Получить публичный VAPID ключ для подписки в браузере
router.get('/public-key', (req, res) => {
  const publicKey = pushService.getPublicKey();
  return res.json({ publicKey });
});

// Сохранить подписку браузера
router.post('/subscribe', requireAuth, async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'Не указана подписка' });
    }

    await pushService.saveSubscription(req.user.id, subscription);
    return res.json({ success: true, message: 'Push-подписка успешно сохранена' });
  } catch (err) {
    console.error('Ошибка сохранения push-подписки:', err);
    return res.status(500).json({ error: 'Не удалось сохранить подписку' });
  }
});

// Удалить подписку
router.post('/unsubscribe', requireAuth, async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (endpoint) {
      await pushService.removeSubscription(endpoint);
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('Ошибка отписки:', err);
    return res.status(500).json({ error: 'Не удалось отписаться' });
  }
});

// Тестовый пуш
router.post('/test', requireAuth, async (req, res) => {
  try {
    await pushService.sendPushToUser(req.user.id, {
      title: 'PicShare Web Push 🔔',
      body: 'Поздравляем! Web Push работает, даже если браузер закрыт!',
      icon: req.user.avatar || '/favicon.svg',
      data: { type: 'test' }
    });
    return res.json({ success: true, message: 'Тестовый пуш отправлен' });
  } catch (err) {
    return res.status(500).json({ error: 'Не удалось отправить тестовый пуш' });
  }
});

module.exports = router;
