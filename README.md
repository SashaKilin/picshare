# 🖼️ PicShare — Приватный обмен картинками с друзьями

Современное веб-приложение для обмена изображениями, фотографиями, артами и мемами со взаимными друзьями в режиме реального времени.

---

## ☁️ Деплой на Render.com (Бесплатно и без потери данных)

На бесплатном тарифе Render файловая система стирается при перезапуске сервера. Чтобы ваш сайт работал **вечно, стабильно и 100% бесплатно**, мы подготовили универсальную архитектуру:
- **База данных**: облачный PostgreSQL от **[Neon.tech](https://neon.tech)** (бесплатно навсегда).
- **Хранилище картинок**: облачный CDN **[Cloudinary](https://cloudinary.com)** (бесплатно 25 ГБ навсегда).
- **Сервер и сайт**: бесплатный Web Service на **[Render.com](https://render.com)**.

---

### Шаг 1. Бесплатная база данных на Neon.tech (1 минута)
1. Зарегистрируйтесь на **[neon.tech](https://neon.tech)** (можно через GitHub или Google).
2. Создайте новый проект (любое имя, например `picshare`).
3. На главной странице проекта скопируйте строку подключения **Connection string** (вида `postgresql://user:pass@ep-xyz.neon.tech/neondb?sslmode=require`).
   *Это и есть ваш `DATABASE_URL`!*

---

### Шаг 2. Бесплатное хранилище картинок на Cloudinary (1 минута)
1. Зарегистрируйтесь на **[cloudinary.com](https://cloudinary.com)** (бесплатный тариф Free tier).
2. На панели Dashboard скопируйте:
   - **Cloud Name**
   - **API Key**
   - **API Secret**

---

### Шаг 3. Загрузка кода на GitHub
В папке проекта в терминале выполните:
```bash
git init
git add .
git commit -m "Initial commit for PicShare"
git branch -M main
git remote add origin https://github.com/ВАШ_ЛОГИН/picshare.git
git push -u origin main
```

---

### Шаг 4. Деплой на Render.com
1. Войдите на **[render.com](https://render.com)** и нажмите **New +** > **Web Service**.
2. Выберите ваш репозиторий с GitHub.
3. Укажите параметры:
   - **Name**: `picshare` (или любое другое)
   - **Region**: Frankfurt (или любой ближайший)
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm run build`
   - **Start Command**: `npm start`
   - **Plan**: `Free`
4. В разделе **Environment Variables** (Переменные окружения) добавьте:
   - `NODE_ENV` = `production`
   - `DATABASE_URL` = вставьте строку из Neon.tech (Шаг 1)
   - `CLOUDINARY_CLOUD_NAME` = скопируйте из Cloudinary (Шаг 2)
   - `CLOUDINARY_API_KEY` = скопируйте из Cloudinary
   - `CLOUDINARY_API_SECRET` = скопируйте из Cloudinary
   - `JWT_SECRET` = любой длинный случайный набор букв и цифр
5. Нажмите **Create Web Service**.

Через 2 минуты ваш сайт откроется по адресу `https://picshare-xxx.onrender.com`!

---

## 💻 Локальный запуск на компьютере

Если вы запускаете сайт на своем ПК:
- База данных автоматически работает на локальном **SQLite** (ничего настраивать не нужно).
- Картинки сохраняются локально в папку `server/uploads/`.

Просто запустите файл **`start.bat`** двойным кликом или выполните:
```bash
npm run dev:server
npm run dev:client
```
И откройте в браузере: `http://localhost:5173`.
