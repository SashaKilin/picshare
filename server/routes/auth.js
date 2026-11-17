const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const db = require('../db');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, username: user.username },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// 1. Регистрация (Email + Пароль) - без кодов подтверждения
router.post('/register', async (req, res) => {
  try {
    let { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Заполните все поля' });
    }

    username = username.trim();
    email = email.trim().toLowerCase();

    if (username.length < 3) {
      return res.status(400).json({ error: 'Имя пользователя должно содержать не менее 3 символов' });
    }

    if (!/^[a-zA-Z0-9_а-яА-ЯёЁ-]+$/.test(username)) {
      return res.status(400).json({ error: 'Имя пользователя может содержать только буквы, цифры, дефис и подчеркивание' });
    }

    if (!email.includes('@') || !email.includes('.')) {
      return res.status(400).json({ error: 'Введите корректный email адрес' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });
    }

    // Проверка уникальности email
    const existingEmail = await db.get('SELECT id FROM users WHERE email = ?', [email]);
    if (existingEmail) {
      return res.status(400).json({ error: 'Пользователь с таким email уже зарегистрирован' });
    }

    // Проверка уникальности username
    const existingUser = await db.get('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [username]);
    if (existingUser) {
      return res.status(400).json({ error: 'Это имя пользователя уже занято' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const defaultAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(username)}`;

    const result = await db.run(
      'INSERT INTO users (username, email, password_hash, avatar) VALUES (?, ?, ?, ?) RETURNING id',
      [username, email, passwordHash, defaultAvatar]
    );

    const newUserId = result.lastInsertRowid;
    const newUser = {
      id: newUserId,
      username,
      email,
      avatar: defaultAvatar,
      created_at: new Date().toISOString(),
    };

    const token = generateToken(newUser);

    return res.status(201).json({
      message: 'Регистрация успешна',
      token,
      user: newUser,
    });
  } catch (err) {
    console.error('Ошибка при регистрации:', err);
    return res.status(500).json({ error: 'Ошибка сервера при регистрации' });
  }
});

// 2. Вход (Email/Логин + Пароль)
router.post('/login', async (req, res) => {
  try {
    let { login, password } = req.body;

    if (!login || !password) {
      return res.status(400).json({ error: 'Введите email/логин и пароль' });
    }

    login = login.trim();

    // Ищем пользователя по email или логину
    const user = await db.get(
      'SELECT * FROM users WHERE LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)',
      [login, login]
    );

    if (!user || !user.password_hash) {
      return res.status(400).json({ error: 'Неверный логин или пароль' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Неверный логин или пароль' });
    }

    const safeUser = {
      id: user.id,
      username: user.username,
      email: user.email,
      avatar: user.avatar,
      created_at: user.created_at,
    };

    const token = generateToken(safeUser);

    return res.json({
      message: 'Успешный вход',
      token,
      user: safeUser,
    });
  } catch (err) {
    console.error('Ошибка при входе:', err);
    return res.status(500).json({ error: 'Ошибка сервера при входе' });
  }
});

// 3. Авторизация через Google
router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({ error: 'Отсутствует Google токен' });
    }

    let googlePayload;

    if (process.env.GOOGLE_CLIENT_ID) {
      try {
        const ticket = await googleClient.verifyIdToken({
          idToken: credential,
          audience: process.env.GOOGLE_CLIENT_ID,
        });
        googlePayload = ticket.getPayload();
      } catch (err) {
        console.error('Ошибка верификации Google токена:', err);
        return res.status(400).json({ error: 'Недействительный токен Google' });
      }
    } else {
      try {
        const parts = credential.split('.');
        if (parts.length === 3) {
          googlePayload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
        }
      } catch (e) {
        return res.status(400).json({ error: 'Не удалось прочитать Google токен' });
      }
    }

    if (!googlePayload || !googlePayload.email) {
      return res.status(400).json({ error: 'Не удалось получить данные аккаунта Google' });
    }

    const googleId = googlePayload.sub;
    const email = googlePayload.email.toLowerCase();
    const name = googlePayload.name || email.split('@')[0];
    const picture = googlePayload.picture || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(email)}`;

    let user = await db.get('SELECT * FROM users WHERE google_id = ? OR LOWER(email) = LOWER(?)', [googleId, email]);

    if (user) {
      if (!user.google_id || !user.avatar) {
        await db.run('UPDATE users SET google_id = COALESCE(google_id, ?), avatar = COALESCE(avatar, ?) WHERE id = ?', [googleId, picture, user.id]);
        user = await db.get('SELECT * FROM users WHERE id = ?', [user.id]);
      }
    } else {
      let usernameCandidate = name.replace(/[^a-zA-Z0-9_а-яА-ЯёЁ-]/g, '_');
      if (usernameCandidate.length < 3) usernameCandidate = 'user_' + Math.floor(1000 + Math.random() * 9000);

      let finalUsername = usernameCandidate;
      let counter = 1;
      while (await db.get('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [finalUsername])) {
        finalUsername = `${usernameCandidate}_${counter++}`;
      }

      const result = await db.run(
        'INSERT INTO users (username, email, google_id, avatar) VALUES (?, ?, ?, ?) RETURNING id',
        [finalUsername, email, googleId, picture]
      );

      user = {
        id: result.lastInsertRowid,
        username: finalUsername,
        email,
        google_id: googleId,
        avatar: picture,
        created_at: new Date().toISOString(),
      };
    }

    const safeUser = {
      id: user.id,
      username: user.username,
      email: user.email,
      avatar: user.avatar,
      created_at: user.created_at,
    };

    const token = generateToken(safeUser);

    return res.json({
      message: 'Успешный вход через Google',
      token,
      user: safeUser,
    });
  } catch (err) {
    console.error('Ошибка при входе через Google:', err);
    return res.status(500).json({ error: 'Ошибка сервера при обработке Google авторизации' });
  }
});

// 4. Получить текущего пользователя
router.get('/me', requireAuth, (req, res) => {
  return res.json({ user: req.user });
});

// 5. Обновить профиль
router.put('/profile', requireAuth, async (req, res) => {
  try {
    const { username, avatar } = req.body;
    const updates = [];
    const params = [];

    if (username && username.trim() !== req.user.username) {
      const cleanUsername = username.trim();
      if (cleanUsername.length < 3) {
        return res.status(400).json({ error: 'Имя пользователя должно содержать не менее 3 символов' });
      }
      const existing = await db.get('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?', [cleanUsername, req.user.id]);
      if (existing) {
        return res.status(400).json({ error: 'Это имя пользователя уже занято' });
      }
      updates.push('username = ?');
      params.push(cleanUsername);
    }

    if (avatar && avatar.trim()) {
      updates.push('avatar = ?');
      params.push(avatar.trim());
    }

    if (updates.length > 0) {
      params.push(req.user.id);
      await db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    const updatedUser = await db.get('SELECT id, username, email, avatar, created_at FROM users WHERE id = ?', [req.user.id]);
    return res.json({ user: updatedUser });
  } catch (err) {
    console.error('Ошибка обновления профиля:', err);
    return res.status(500).json({ error: 'Не удалось обновить профиль' });
  }
});

module.exports = router;
