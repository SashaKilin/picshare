const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const db = require('../db');

let isInitialized = false;

function initFirebase() {
  if (isInitialized) return true;

  try {
    // 1. Проверяем переменную окружения FIREBASE_SERVICE_ACCOUNT (строка JSON или путь к файлу)
    const envConfig = process.env.FIREBASE_SERVICE_ACCOUNT;
    const localFile = path.join(__dirname, '..', 'firebase-service-account.json');

    let serviceAccount = null;

    if (envConfig) {
      try {
        serviceAccount = JSON.parse(envConfig);
      } catch (e) {
        if (fs.existsSync(envConfig)) {
          serviceAccount = JSON.parse(fs.readFileSync(envConfig, 'utf8'));
        }
      }
    } else if (fs.existsSync(localFile)) {
      serviceAccount = JSON.parse(fs.readFileSync(localFile, 'utf8'));
    }

    if (serviceAccount && serviceAccount.project_id) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      isInitialized = true;
      console.log(`🔥 Firebase Admin SDK успешно подключен к проекту: ${serviceAccount.project_id}`);
      return true;
    } else {
      console.log('ℹ️ Firebase Admin SDK ожидает файл firebase-service-account.json или переменную FIREBASE_SERVICE_ACCOUNT');
      return false;
    }
  } catch (err) {
    console.warn('Предупреждение при инициализации Firebase Admin:', err.message);
    return false;
  }
}

// Запускаем проверку при старте
initFirebase();

const fcmService = {
  isConfigured() {
    return initFirebase();
  },

  async saveToken(userId, token, deviceName = 'Android') {
    if (!userId || !token) return;

    await db.run(`
      INSERT INTO fcm_tokens (user_id, token, device_name, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(token) DO UPDATE SET 
        user_id = excluded.user_id,
        device_name = excluded.device_name,
        updated_at = CURRENT_TIMESTAMP
    `, [Number(userId), token, deviceName]);

    return true;
  },

  async removeToken(token) {
    if (!token) return;
    await db.run('DELETE FROM fcm_tokens WHERE token = ?', [token]);
  },

  async sendToUser(userId, { title, body, data = {} }) {
    if (!userId) return;

    try {
      if (!initFirebase()) {
        return; // Firebase еще не настроен
      }

      const rows = await db.all('SELECT id, token FROM fcm_tokens WHERE user_id = ?', [Number(userId)]);
      if (!rows || rows.length === 0) return;

      const tokens = rows.map(r => r.token);

      // Преобразуем все значения в data в строки (требование FCM)
      const sanitizedData = {};
      for (const [k, v] of Object.entries(data)) {
        sanitizedData[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
      }

      const message = {
        tokens,
        notification: {
          title: title || 'PicShare',
          body: body || ''
        },
        data: sanitizedData,
        android: {
          priority: 'high',
          notification: {
            channelId: 'picshare_channel',
            priority: 'high',
            defaultSound: true,
            defaultVibrateTimings: true,
            clickAction: 'FCM_PLUGIN_ACTIVITY',
            icon: 'ic_launcher'
          }
        }
      };

      const response = await admin.messaging().sendEachForMulticast(message);
      
      // Удаляем токены, ставшие недействительными (пользователь удалил приложение и т.д.)
      if (response.failureCount > 0) {
        response.responses.forEach(async (resp, idx) => {
          if (!resp.success) {
            const errCode = resp.error?.code;
            if (
              errCode === 'messaging/invalid-registration-token' ||
              errCode === 'messaging/registration-token-not-registered'
            ) {
              const deadToken = tokens[idx];
              await db.run('DELETE FROM fcm_tokens WHERE token = ?', [deadToken]);
            }
          }
        });
      }
    } catch (err) {
      console.warn('Ошибка отправки FCM уведомления:', err.message);
    }
  }
};

module.exports = fcmService;
