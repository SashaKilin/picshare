@echo off
title PicShare
echo ===================================================
echo     PicShare - Обмен картинками с друзьями
echo ===================================================
echo.
echo [1/2] Запуск бэкенда (порт 5000)...
start "PicShare Server" cmd /k "cd server && npm start"

echo [2/2] Запуск фронтенда (порт 5173)...
start "PicShare Client" cmd /k "cd client && npm run dev"

echo.
echo Сервер и клиент запускаются!
echo Перейдите в браузере по адресу: http://localhost:5173
echo.
