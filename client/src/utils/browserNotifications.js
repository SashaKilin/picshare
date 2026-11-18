// Утилиты для работы с Browser Web Notifications API

export function isBrowserNotificationSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotificationPermission() {
  if (!isBrowserNotificationSupported()) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

export async function requestBrowserNotificationPermission() {
  if (!isBrowserNotificationSupported()) return 'unsupported';
  try {
    const permission = await Notification.requestPermission();
    return permission;
  } catch (err) {
    console.error('Ошибка запроса разрешения на уведомления браузера:', err);
    return Notification.permission;
  }
}

export async function sendBrowserNotification({ title, body, icon, tag, onClick }) {
  if (!isBrowserNotificationSupported()) return null;
  if (Notification.permission !== 'granted') return null;

  const options = {
    body: body || '',
    icon: icon || '/favicon.svg',
    badge: '/favicon.svg',
    tag: tag || 'picshare_alert',
    renotify: true,
    silent: false,
  };

  try {
    // 1. Попытка через Service Worker (если доступен, особенно полезно на мобильных)
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg && typeof reg.showNotification === 'function') {
          await reg.showNotification(title, options);
          return null;
        }
      } catch (swErr) {
        // Fallback к обычному конструктору
      }
    }

    // 2. Стандартный веб-конструктор браузерных уведомлений
    const notification = new Notification(title, options);

    notification.onclick = (e) => {
      e.preventDefault();
      try {
        window.focus();
      } catch (err) {}
      notification.close();
      if (typeof onClick === 'function') {
        onClick();
      }
    };

    // Автоматическое закрытие через 8 секунд
    setTimeout(() => {
      try {
        notification.close();
      } catch (err) {}
    }, 8000);

    return notification;
  } catch (err) {
    console.warn('Предупреждение при показе уведомления браузера:', err);
    return null;
  }
}
