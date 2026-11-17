import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { getAuthToken } from '../api';

const SocketContext = createContext(null);

// Звуковое оповещение о новом сообщении (чистый Web Audio API, без внешних файлов)
function playNotificationSound() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    
    // Нота 1 (D5 - 587 Гц)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, ctx.currentTime);
    gain1.gain.setValueAtTime(0.12, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start();
    osc1.stop(ctx.currentTime + 0.2);

    // Нота 2 (A5 - 880 Гц) чуть позже
    setTimeout(() => {
      try {
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(880, ctx.currentTime);
        gain2.gain.setValueAtTime(0.15, ctx.currentTime);
        gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start();
        osc2.stop(ctx.currentTime + 0.25);
      } catch (e) {}
    }, 90);
  } catch (e) {
    // В некоторых браузерах Web Audio требует первого клика пользователя по странице
  }
}

export function SocketProvider({ children }) {
  const { user } = useAuth();
  const [socket, setSocket] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [notification, setNotification] = useState(null);
  const [unreadMap, setUnreadMap] = useState({}); // { [friendId]: count }
  const [activeFriendId, setActiveFriendId] = useState(null);

  useEffect(() => {
    if (!user) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
      }
      setUnreadMap({});
      return;
    }

    const token = getAuthToken();
    // В режиме разработки на порту 5173 подключаемся напрямую к серверу 5000 или через прокси
    const serverUrl = window.location.port === '5173' ? 'http://localhost:5000' : window.location.origin;

    const newSocket = io(serverUrl, {
      auth: { token },
      query: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });

    newSocket.on('connect', () => {
      console.log('✅ Socket.IO успешно подключен! ID:', newSocket.id);
      if (token) {
        newSocket.emit('authenticate', token);
      }
    });

    newSocket.on('user_online', ({ userId }) => {
      setOnlineUsers((prev) => new Set(prev).add(Number(userId)));
    });

    newSocket.on('user_offline', ({ userId }) => {
      setOnlineUsers((prev) => {
        const next = new Set(prev);
        next.delete(Number(userId));
        return next;
      });
    });

    newSocket.on('new_friend_request', ({ fromUser }) => {
      playNotificationSound();
      setNotification({
        type: 'friend_request',
        title: 'Новая заявка в друзья!',
        message: `${fromUser.username} хочет добавить вас в друзья`,
        user: fromUser
      });
    });

    newSocket.on('friend_request_accepted', ({ user: friend }) => {
      playNotificationSound();
      setNotification({
        type: 'friend_accepted',
        title: 'Заявка принята!',
        message: `${friend.username} теперь ваш друг! Теперь вы можете обмениваться картинками.`,
        user: friend
      });
    });

    newSocket.on('new_image', (image) => {
      const senderId = Number(image.sender_id);
      const isMe = senderId === Number(user.id);

      if (!isMe) {
        playNotificationSound();

        // Уведомление
        const isGroup = Boolean(image.group_id);
        setNotification({
          type: 'new_image',
          title: isGroup 
            ? `Новое сообщение от ${image.sender_username}!`
            : `Новая картинка от ${image.sender_username}!`,
          message: image.caption || (image.image_url ? 'Прислал(а) изображение' : 'Новое сообщение'),
          image
        });

        // Если сейчас открыт не диалог с этим другом, увеличиваем счетчик непрочитанных
        if (!isGroup && Number(activeFriendId) !== senderId) {
          setUnreadMap((prev) => ({
            ...prev,
            [senderId]: (prev[senderId] || 0) + 1
          }));
        }

        // Обновляем заголовок вкладки браузера
        if (document.hidden) {
          document.title = `(1) Новое сообщение от ${image.sender_username}!`;
        }
      }
    });

    setSocket(newSocket);

    // Сброс заголовка при возврате на вкладку
    const handleVisibility = () => {
      if (!document.hidden) {
        document.title = 'PicShare — Обмен картинками с друзьями';
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      newSocket.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [user?.id, activeFriendId]);

  const markAsRead = (friendId) => {
    if (!friendId) return;
    setUnreadMap((prev) => {
      const next = { ...prev };
      delete next[Number(friendId)];
      return next;
    });
  };

  const clearNotification = () => setNotification(null);

  return (
    <SocketContext.Provider value={{ 
      socket, 
      onlineUsers, 
      notification, 
      clearNotification,
      unreadMap,
      markAsRead,
      activeFriendId,
      setActiveFriendId
    }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
}
