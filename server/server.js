require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

const db = require('./db');
const { JWT_SECRET } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const friendsRoutes = require('./routes/friends');
const imagesRoutes = require('./routes/images');
const usersRoutes = require('./routes/users');
const groupsRoutes = require('./routes/groups');
const pushRoutes = require('./routes/push');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 5000;

// Socket.IO
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors({
  origin: '*',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Раздача статических файлов загруженных картинок (для локального режима)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Передаем io в Express app для использования в роутах
app.set('io', io);

// Socket.IO подключение и авторизация комнат
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token) {
    return next();
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.userId = Number(payload.id);
    next();
  } catch (err) {
    next();
  }
});

io.on('connection', (socket) => {
  if (socket.userId) {
    const roomName = `user_${socket.userId}`;
    socket.join(roomName);
    console.log(`[Socket] User ${socket.userId} joined room ${roomName}`);
    io.emit('user_online', { userId: socket.userId });
  }

  socket.on('authenticate', (token) => {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      socket.userId = Number(payload.id);
      const roomName = `user_${socket.userId}`;
      socket.join(roomName);
      console.log(`[Socket Auth Event] User ${socket.userId} joined room ${roomName}`);
      io.emit('user_online', { userId: socket.userId });
      socket.emit('authenticated', { userId: socket.userId });
    } catch (err) {
      console.warn('[Socket Auth Error]:', err.message);
    }
  });

  // События индикатора набора текста ("Печатает...")
  socket.on('typing_start', async (data) => {
    if (!socket.userId) return;
    const { recipientId, groupId, username } = data || {};
    const senderUsername = username || 'Собеседник';

    if (groupId) {
      try {
        const members = await db.all('SELECT user_id FROM group_members WHERE group_id = ?', [groupId]);
        members.forEach((m) => {
          if (Number(m.user_id) !== Number(socket.userId)) {
            io.to(`user_${m.user_id}`).emit('user_typing', {
              userId: Number(socket.userId),
              username: senderUsername,
              groupId: Number(groupId)
            });
          }
        });
      } catch (err) {
        console.error('[Socket typing group error]:', err.message);
      }
    } else if (recipientId) {
      io.to(`user_${recipientId}`).emit('user_typing', {
        userId: Number(socket.userId),
        username: senderUsername,
        recipientId: Number(recipientId)
      });
    }
  });

  socket.on('typing_stop', async (data) => {
    if (!socket.userId) return;
    const { recipientId, groupId } = data || {};

    if (groupId) {
      try {
        const members = await db.all('SELECT user_id FROM group_members WHERE group_id = ?', [groupId]);
        members.forEach((m) => {
          if (Number(m.user_id) !== Number(socket.userId)) {
            io.to(`user_${m.user_id}`).emit('user_stop_typing', {
              userId: Number(socket.userId),
              groupId: Number(groupId)
            });
          }
        });
      } catch (err) {}
    } else if (recipientId) {
      io.to(`user_${recipientId}`).emit('user_stop_typing', {
        userId: Number(socket.userId),
        recipientId: Number(recipientId)
      });
    }
  });

  socket.on('disconnect', () => {
    if (socket.userId) {
      console.log(`[Socket] User ${socket.userId} disconnected`);
      io.emit('user_offline', { userId: socket.userId });
    }
  });
});

// API Роуты
app.use('/api/auth', authRoutes);
app.use('/api/friends', friendsRoutes);
app.use('/api/images', imagesRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/groups', groupsRoutes);
app.use('/api/push', pushRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    database: db.isPg ? 'PostgreSQL (Cloud)' : 'SQLite (Local)',
    imageStorage: process.env.CLOUDINARY_URL || process.env.CLOUDINARY_CLOUD_NAME ? 'Cloudinary (Cloud)' : 'Local Disk',
    googleAuthConfigured: Boolean(process.env.GOOGLE_CLIENT_ID),
    googleClientId: process.env.GOOGLE_CLIENT_ID || null
  });
});

// Раздача фронтенда в продакшене (Render.com)
const clientDistPath = path.join(__dirname, '../client/dist');
if (fs.existsSync(clientDistPath)) {
  console.log(`📦 Подключена раздача фронтенда из ${clientDistPath}`);
  app.use(express.static(clientDistPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// Запуск сервера с предварительной инициализацией БД
async function startServer() {
  try {
    await db.init();

    server.listen(PORT, () => {
      console.log(`=========================================`);
      console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
      console.log(`🗄️ База данных: ${db.isPg ? 'PostgreSQL (Cloud)' : 'SQLite (Local)'}`);
      console.log(`🖼️ Хранение картинок: ${process.env.CLOUDINARY_URL || process.env.CLOUDINARY_CLOUD_NAME ? 'Cloudinary' : 'Local Disk'}`);
      console.log(`🔑 Google Auth: ${process.env.GOOGLE_CLIENT_ID ? 'Включен' : 'Ожидает CLIENT_ID (доступна демо-кнопка)'}`);
      console.log(`=========================================`);
    });
  } catch (err) {
    console.error('Критическая ошибка запуска сервера:', err);
    process.exit(1);
  }
}

startServer();
