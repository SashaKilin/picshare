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

  async saveSubscription(userId, subscription) {
    if (!subscription || !subscription.endpoint || !subscription.keys) {
      throw new Error('Некорректный объект подписки push');
    }

    const { endpoint, keys } = subscription;
    const { p256dh, auth } = keys;

    await db.run(`
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth
    `, [Number(userId), endpoint, p256dh, auth]);

    return true;
  },

  async removeSubscription(endpoint) {
    if (!endpoint) return;
    await db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
  },

  async sendPushToUser(userId, payload) {
    if (!userId) return;
    try {
      const subs = await db.all(
        'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?', 
        [Number(userId)]
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
