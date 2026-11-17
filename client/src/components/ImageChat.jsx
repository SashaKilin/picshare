import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { api } from '../api';
import { 
  Send, 
  Image as ImageIcon, 
  Trash2, 
  Download, 
  X, 
  Smile, 
  MoreVertical, 
  UploadCloud, 
  Sparkles, 
  AlertCircle,
  FileImage,
  UserMinus,
  RefreshCw
} from 'lucide-react';
import confetti from 'canvas-confetti';

export function ImageChat({
  friend,
  onFriendRemoved,
  onOpenLightbox,
}) {
  const { user } = useAuth();
  const { socket, onlineUsers, markAsRead, setActiveFriendId } = useSocket();

  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  // Состояние загрузки новой картинки
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [caption, setCaption] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const chatContainerRef = useRef(null);
  const latestImageIdRef = useRef(0);

  // Устанавливаем текущего активного друга для сокетов
  useEffect(() => {
    if (friend?.id) {
      setActiveFriendId(Number(friend.id));
      markAsRead(Number(friend.id));
    }
    return () => {
      setActiveFriendId(null);
    };
  }, [friend?.id]);

  // Загрузка истории картинок при смене друга
  useEffect(() => {
    if (!friend?.id) return;

    let mounted = true;
    setLoading(true);
    setError('');

    api.getChatImages(friend.id)
      .then((data) => {
        if (mounted) {
          const loadedImages = data.images || [];
          setImages(loadedImages);
          if (loadedImages.length > 0) {
            latestImageIdRef.current = Math.max(...loadedImages.map((i) => i.id));
          }
          setLoading(false);
          scrollToBottom();
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err.message || 'Не удалось загрузить историю картинок');
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [friend?.id]);

  // 1. Мгновенное обновление через Socket.IO в реальном времени
  useEffect(() => {
    if (!socket || !friend?.id) return;

    const handleNewImage = (newImg) => {
      const sId = Number(newImg.sender_id);
      const rId = Number(newImg.receiver_id);
      const fId = Number(friend.id);
      const myId = Number(user.id);

      if ((sId === fId && rId === myId) || (sId === myId && rId === fId)) {
        setImages((prev) => {
          if (prev.some((img) => img.id === newImg.id)) return prev;
          latestImageIdRef.current = Math.max(latestImageIdRef.current, newImg.id);
          return [...prev, newImg];
        });
        scrollToBottom();
      }
    };

    const handleDeletedImage = ({ imageId }) => {
      setImages((prev) => prev.filter((img) => img.id !== imageId));
    };

    socket.on('new_image', handleNewImage);
    socket.on('image_deleted', handleDeletedImage);

    return () => {
      socket.off('new_image', handleNewImage);
      socket.off('image_deleted', handleDeletedImage);
    };
  }, [socket, friend?.id, user?.id]);

  // 2. Фоновое автообновление (Polling fallback каждые 2.5 секунды)
  // Гарантирует автоматическое обновление даже если сокет временно потерял соединение!
  useEffect(() => {
    if (!friend?.id) return;

    const interval = setInterval(async () => {
      try {
        const data = await api.getChatImages(friend.id);
        const incomingImages = data.images || [];

        if (incomingImages.length > 0) {
          const maxId = Math.max(...incomingImages.map((i) => i.id));
          if (maxId > latestImageIdRef.current) {
            latestImageIdRef.current = maxId;
            setImages(incomingImages);
            scrollToBottom();
          }
        }
      } catch (e) {
        // Фоновая ошибка не прерывает работу
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [friend?.id]);

  function scrollToBottom() {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 80);
  }

  // Обработка выбора файла
  function handleFileSelect(file) {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Пожалуйста, выберите файл изображения (PNG, JPG, WebP, GIF)');
      return;
    }

    if (file.size > 25 * 1024 * 1024) {
      setError('Размер изображения не должен превышать 25 МБ');
      return;
    }

    setError('');
    setSelectedFile(file);
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
  }

  // Вставка из буфера обмена (Ctrl + V)
  useEffect(() => {
    function handlePaste(e) {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          handleFileSelect(file);
          break;
        }
      }
    }

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  // Drag & drop обработчики
  function handleDragOver(e) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  }

  function clearSelectedFile() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(null);
    setPreviewUrl(null);
    setCaption('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  // Отправка картинки
  async function handleSendImage(e) {
    if (e) e.preventDefault();
    if (!selectedFile || sending) return;

    setSending(true);
    setError('');

    const formData = new FormData();
    formData.append('image', selectedFile);
    formData.append('receiverId', friend.id);
    if (caption.trim()) {
      formData.append('caption', caption.trim());
    }

    try {
      const res = await api.sendImage(formData);
      clearSelectedFile();
      // Оптимистично добавляем, если еще не добавлен через socket
      if (res.image) {
        setImages((prev) => {
          if (prev.some((img) => img.id === res.image.id)) return prev;
          latestImageIdRef.current = Math.max(latestImageIdRef.current, res.image.id);
          return [...prev, res.image];
        });
      }
      scrollToBottom();
      confetti({ particleCount: 35, spread: 50, origin: { y: 0.85 } });
    } catch (err) {
      setError(err.message || 'Не удалось отправить картинку');
    } finally {
      setSending(false);
    }
  }

  // Удаление картинки
  async function handleDeleteImage(imageId) {
    if (!confirm('Вы уверены, что хотите удалить эту картинку?')) return;
    try {
      await api.deleteImage(imageId);
      setImages((prev) => prev.filter((img) => img.id !== imageId));
    } catch (err) {
      alert(err.message || 'Ошибка удаления картинки');
    }
  }

  // Удаление из друзей
  async function handleRemoveFriend() {
    if (!confirm(`Удалить ${friend.username} из друзей? Обмен картинками будет прекращен.`)) return;
    try {
      await api.removeFriend(friend.id);
      if (onFriendRemoved) onFriendRemoved(friend.id);
    } catch (err) {
      alert(err.message || 'Ошибка удаления из друзей');
    }
  }

  const isOnline = onlineUsers.has(Number(friend?.id));

  return (
    <div 
      className="flex-1 flex flex-col h-full bg-slate-950 relative overflow-hidden"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      
      {/* Оверлей при Drag & Drop */}
      {isDragging && (
        <div className="absolute inset-0 z-30 bg-indigo-950/85 backdrop-blur-sm border-2 border-dashed border-indigo-400 flex flex-col items-center justify-center pointer-events-none animate-fadeIn">
          <div className="p-4 rounded-3xl bg-indigo-600/30 text-indigo-300 mb-3 animate-bounce">
            <UploadCloud className="w-12 h-12" />
          </div>
          <p className="text-lg font-bold text-white">Перетащите картинку сюда</p>
          <p className="text-xs text-indigo-300 mt-1">Она сразу прикрепится к отправке</p>
        </div>
      )}

      {/* Шапка чата */}
      <div className="h-16 px-4 border-b border-slate-800 bg-slate-900/40 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative">
            <img
              src={friend?.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${friend?.username}`}
              alt={friend?.username}
              className="w-10 h-10 rounded-full border border-slate-700 object-cover bg-slate-800"
            />
            <span
              className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-slate-900 ${
                isOnline ? 'bg-emerald-500 ring-2 ring-emerald-500/20' : 'bg-slate-600'
              }`}
            />
          </div>
          <div>
            <div className="font-bold text-sm text-slate-100 flex items-center gap-1.5">
              <span>{friend?.username}</span>
              <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/20">
                В друзьях
              </span>
            </div>
            <div className="text-xs text-slate-400 flex items-center gap-1.5">
              <span>{isOnline ? 'В сети' : 'Не в сети'}</span>
              <span className="text-slate-600">•</span>
              <span className="text-[11px] text-indigo-400/80">Автообновление активно</span>
            </div>
          </div>
        </div>

        {/* Меню действий */}
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {showMenu && (
            <div className="absolute right-0 top-full mt-1 w-48 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-1 z-20">
              <button
                onClick={() => {
                  setShowMenu(false);
                  handleRemoveFriend();
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-rose-400 hover:bg-rose-500/10 rounded-xl transition"
              >
                <UserMinus className="w-4 h-4" />
                <span>Удалить из друзей</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Ошибка */}
      {error && (
        <div className="p-3 mx-4 mt-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError('')} className="text-rose-400 hover:text-rose-200">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Область сообщений / галерея картинок */}
      <div 
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6"
      >
        {loading && (
          <div className="flex items-center justify-center h-full text-xs text-slate-500 animate-pulse">
            Загрузка картинок...
          </div>
        )}

        {!loading && images.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3">
            <div className="w-16 h-16 rounded-3xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center">
              <FileImage className="w-8 h-8" />
            </div>
            <div>
              <h4 className="font-bold text-slate-200 text-base">Обмен картинками открыт!</h4>
              <p className="text-xs text-slate-400 max-w-sm mt-1">
                Вы добавили друг друга в друзья. Прикрепите фото или вставьте его через <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">Ctrl + V</kbd>, чтобы отправить первую картинку!
              </p>
            </div>
          </div>
        )}

        {/* Карточки картинок */}
        {images.map((img) => {
          const isMe = Number(img.sender_id) === Number(user.id);

          return (
            <div
              key={img.id}
              className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} group animate-fadeIn`}
            >
              {/* Информация об авторе */}
              <div className="flex items-center gap-2 mb-1 px-1">
                <span className="text-xs font-semibold text-slate-400">
                  {isMe ? 'Вы' : img.sender_username || friend.username}
                </span>
                <span className="text-[10px] text-slate-600">
                  {new Date(img.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              {/* Тело карточки картинки */}
              <div className="relative max-w-sm sm:max-w-md rounded-2xl overflow-hidden border border-slate-800 bg-slate-900 shadow-xl transition-all duration-200 group-hover:border-slate-700">
                
                {/* Изображение */}
                <div 
                  className="cursor-pointer overflow-hidden bg-slate-950 max-h-[420px] flex items-center justify-center relative"
                  onClick={() => onOpenLightbox(img)}
                >
                  <img
                    src={img.file_url}
                    alt={img.original_name}
                    className="w-full h-auto max-h-[420px] object-cover hover:scale-[1.02] transition-transform duration-300"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-between p-3">
                    <span className="text-[11px] text-white font-medium bg-slate-900/80 px-2 py-0.5 rounded-md backdrop-blur-sm">
                      Нажмите для просмотра
                    </span>
                  </div>
                </div>

                {/* Подпись (если есть) */}
                {img.caption && (
                  <div className="p-3 bg-slate-900/95 border-t border-slate-800 text-xs text-slate-200 break-words">
                    {img.caption}
                  </div>
                )}

                {/* Нижняя панель действий */}
                <div className="px-3 py-1.5 bg-slate-900/80 border-t border-slate-800/60 flex items-center justify-between text-slate-400 text-xs">
                  <span className="text-[10px] text-slate-500">
                    {(img.file_size / (1024 * 1024)).toFixed(2)} МБ
                  </span>

                  <div className="flex items-center gap-1">
                    {/* Скачать */}
                    <a
                      href={img.file_url}
                      download={img.original_name}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded-lg hover:text-white hover:bg-slate-800 transition"
                      title="Скачать оригинал"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </a>

                    {/* Удалить (только если автор) */}
                    {isMe && (
                      <button
                        onClick={() => handleDeleteImage(img.id)}
                        className="p-1.5 rounded-lg hover:text-rose-400 hover:bg-rose-500/10 transition"
                        title="Удалить картинку"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

              </div>
            </div>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* Превью выбранного изображения перед отправкой */}
      {previewUrl && (
        <div className="p-3 bg-slate-900/90 border-t border-slate-800 flex items-center gap-4">
          <div className="relative w-16 h-16 rounded-xl overflow-hidden border border-indigo-500/50 shrink-0">
            <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
            <button
              onClick={clearSelectedFile}
              className="absolute top-1 right-1 p-0.5 bg-rose-500 text-white rounded-full hover:bg-rose-600 transition"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-slate-200 truncate">
              {selectedFile?.name}
            </p>
            <p className="text-[11px] text-slate-400">
              {(selectedFile?.size / (1024 * 1024)).toFixed(2)} МБ — готово к отправке
            </p>
          </div>
        </div>
      )}

      {/* Панель ввода и отправки */}
      <form 
        onSubmit={handleSendImage}
        className="p-3 bg-slate-900/60 border-t border-slate-800 flex items-center gap-2"
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={(e) => handleFileSelect(e.target.files[0])}
          accept="image/*"
          className="hidden"
        />

        {/* Кнопка прикрепления файла */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 transition shrink-0"
          title="Выбрать картинку с компьютера"
        >
          <ImageIcon className="w-4 h-4 text-indigo-400" />
        </button>

        {/* Поле для ввода комментария/подписи */}
        <div className="flex-1 relative">
          <input
            type="text"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder={selectedFile ? 'Добавьте подпись к картинке...' : 'Выберите или вставьте (Ctrl+V) картинку...'}
            className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition"
          />
        </div>

        {/* Кнопка отправки */}
        <button
          type="submit"
          disabled={!selectedFile || sending}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs sm:text-sm font-semibold shadow-lg shadow-indigo-600/30 transition disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          <Send className="w-4 h-4" />
          <span className="hidden sm:inline">{sending ? 'Отправка...' : 'Отправить'}</span>
        </button>
      </form>

    </div>
  );
}
