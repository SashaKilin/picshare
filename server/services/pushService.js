const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const db = require('../db');

let publicKey = process.env.VAPID_PUBLIC_KEY;
let privateKey = process.env.VAPID_PRIVATE_KEY;
const vapidEmail = process.env.VAPID_EMAIL || 'mailto:admin@picshare.local';

const vapidFilePath = path.join(__dirname, '..', 'vapid.json');

// Если ключи не переданы в process.env, пробуем прочитать из файла
if (!publicKey || !privateKey) {
  if (fs.existsSync(vapidFilePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(vapidFilePath, 'utf8'));
      publicKey = data.publicKey;
      privateKey = data.privateKey;
    } catch (e) {}
  }
}

// Если ключей нет, генерируем их один раз и сохраняем
if (!publicKey || !privateKey) {
  const keys = webpush.generateVAPIDKeys();
  publicKey = keys.publicKey;
  privateKey = keys.privateKey;
  try {
    fs.writeFileSync(vapidFilePath, JSON.stringify({ publicKey, privateKey }, null, 2));
    console.log('🔑 Автоматически сгенерированы VAPID ключи для Web Push');
  } catch (e) {
    console.warn('Не удалось записать vapid.json, ключи будут в памяти:', e.message);
  }
}

try {
  webpush.setVapidDetails(vapidEmail, publicKey, privateKey);
  console.log('📲 Сервис Web Push успешно инициализирован');
} catch (err) {
  console.error('Ошибка инициализации Web Push:', err.message);
}

const pushService = {
  getPublicKey() {
    return publicKey;
  },

  async saveSubscription(userId, subscription, clientType = 'web') {
    if (!subscription || !subscription.endpoint || !subscription.keys) {
      throw new Error('Некорректный объект подписки push');
    }

    const { endpoint, keys } = subscription;
    const { p256dh, auth } = keys;

    await db.run(`
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, client_type)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET 
        user_id = excluded.user_id, 
        p256dh = excluded.p256dh, 
        auth = excluded.auth,
        client_type = excluded.client_type
    `, [Number(userId), endpoint, p256dh, auth, clientType]);

    return true;
  },

  async setAppNotificationsEnabled(userId, enabled) {
    if (!userId) return;
    await db.run('UPDATE users SET app_notifications_enabled = ? WHERE id = ?', [
      enabled ? 1 : 0, 
      Number(userId)
    ]);
    if (enabled) {
      // Автоматически очищаем подписки браузера с мобильного телефона, чтобы не задваивать уведомления
      await db.run("DELETE FROM push_subscriptions WHERE user_id = ? AND client_type = 'mobile_web'", [Number(userId)]);
    }
  },

  async removeSubscription(endpoint) {
    if (!endpoint) return;
    await db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
  },

  async sendPushToUser(userId, payload) {
    if (!userId) return;
    try {
      const user = await db.get('SELECT app_notifications_enabled FROM users WHERE id = ?', [Number(userId)]);
      const appEnabled = Boolean(user && (user.app_notifications_enabled === 1 || user.app_notifications_enabled === true));

      let sql = 'SELECT id, endpoint, p256dh, auth, client_type FROM push_subscriptions WHERE user_id = ?';
      const params = [Number(userId)];

      // Если у пользователя включены уведомления в установленном мобильном приложении,
      // не отправляем пуши в мобильный браузер этого же телефона!
      if (appEnabled) {
        sql += " AND (client_type IS NULL OR client_type != 'mobile_web')";
      }

      const subs = await db.all(sql, params);
      );

      if (!subs || subs.length === 0) return;

      const payloadStr = JSON.stringify(payload);

      for (const sub of subs) {
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          }
        };

        webpush.sendNotification(pushSubscription, payloadStr).catch(async (err) => {
          // Если подписка устарела (пользователь удалил сайт из браузера или сбросил права)
          if (err.statusCode === 404 || err.statusCode === 410) {
            try {
              await db.run('DELETE FROM push_subscriptions WHERE id = ?', [sub.id]);
            } catch (delErr) {}
          } else {
            console.warn(`[WebPush] Ошибка отправки пользователю ${userId}:`, err.statusCode || err.message);
          }
        });
      }
    } catch (err) {
      console.error('Ошибка sendPushToUser:', err.message);
    }
  }
};

module.exports = pushService;
