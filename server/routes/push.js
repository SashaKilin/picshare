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
    const { subscription, clientType: explicitType } = req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'Не указана подписка' });
    }

    // Определяем тип клиента: android_app, mobile_web или desktop_web
    const ua = (req.headers['user-agent'] || '').toLowerCase();
    const isMobile = /android|iphone|ipad|ipod|mobile/i.test(ua);
    const clientType = explicitType || (isMobile ? 'mobile_web' : 'desktop_web');

    await pushService.saveSubscription(req.user.id, subscription, clientType);
    return res.json({ success: true, message: 'Push-подписка успешно сохранена', clientType });
  } catch (err) {
    console.error('Ошибка сохранения push-подписки:', err);
    return res.status(500).json({ error: 'Не удалось сохранить подписку' });
  }
});

// Установить статус включения уведомлений в мобильном приложении
router.post('/app-status', requireAuth, async (req, res) => {
  try {
    const { enabled } = req.body;
    await pushService.setAppNotificationsEnabled(req.user.id, Boolean(enabled));
    return res.json({ success: true, appNotificationsEnabled: Boolean(enabled) });
  } catch (err) {
    console.error('Ошибка app-status:', err);
    return res.status(500).json({ error: 'Не удалось обновить статус' });
  }
});

// Получить текущий статус уведомлений пользователя
router.get('/status', requireAuth, async (req, res) => {
  try {
    const user = await require('../db').get('SELECT app_notifications_enabled FROM users WHERE id = ?', [req.user.id]);
    return res.json({ 
      appNotificationsEnabled: Boolean(user && (user.app_notifications_enabled === 1 || user.app_notifications_enabled === true))
    });
  } catch (err) {
    return res.status(500).json({ error: 'Не удалось получить статус' });
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
