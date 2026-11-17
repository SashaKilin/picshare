import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { LayoutGrid, Download, Image as ImageIcon, Sparkles, MessageSquare } from 'lucide-react';

export function FeedView({ onSelectFriend, onOpenLightbox }) {
  const [feed, setFeed] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadFeed();
  }, []);

  async function loadFeed() {
    setLoading(true);
    setError('');
    try {
      const data = await api.getFeed();
      setFeed(data.feed || []);
    } catch (err) {
      setError(err.message || 'Ошибка загрузки ленты');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 overflow-y-auto p-4 sm:p-8">
      <div className="max-w-6xl mx-auto w-full">
        
        {/* Заголовок ленты */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
              <LayoutGrid className="w-6 h-6 text-indigo-400" />
              <span>Общая галерея картинок</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Все картинки, которыми вы обмениваетесь со взаимными друзьями
            </p>
          </div>

          <button
            onClick={loadFeed}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition"
          >
            Обновить
          </button>
        </div>

        {loading && (
          <div className="py-20 text-center text-xs text-slate-500 animate-pulse">
            Загрузка галереи...
          </div>
        )}

        {!loading && feed.length === 0 && (
          <div className="py-20 text-center space-y-3">
            <div className="w-16 h-16 rounded-3xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 mx-auto flex items-center justify-center">
              <ImageIcon className="w-8 h-8" />
            </div>
            <h3 className="font-bold text-slate-200 text-base">В галерее пока пусто</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Отправьте картинку любому из ваших друзей в диалоге, и она появится здесь!
            </p>
          </div>
        )}

        {/* Сетка картинок */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {feed.map((img) => (
            <div
              key={img.id}
              className="group relative bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl overflow-hidden shadow-lg flex flex-col transition"
            >
              {/* Превью картинки */}
              <div
                onClick={() => onOpenLightbox(img)}
                className="aspect-square bg-slate-950 overflow-hidden cursor-pointer relative"
              >
                <img
                  src={img.file_url}
                  alt={img.original_name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-between p-3">
                  <span className="text-[11px] text-white font-medium bg-slate-900/80 px-2 py-0.5 rounded backdrop-blur-sm">
                    Открыть
                  </span>
                  <a
                    href={img.file_url}
                    download={img.original_name}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="p-1.5 rounded-lg bg-slate-900/80 text-white hover:bg-slate-800 transition"
                    title="Скачать"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>

              {/* Информация под картинкой */}
              <div className="p-3 flex items-center justify-between gap-2 border-t border-slate-800">
                <div className="flex items-center gap-2 min-w-0">
                  <img
                    src={img.sender_avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${img.sender_username}`}
                    alt={img.sender_username}
                    className="w-6 h-6 rounded-full border border-slate-700 object-cover shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-200 truncate">
                      {img.sender_username}
                    </div>
                    {img.caption && (
                      <div className="text-[11px] text-slate-400 truncate">
                        {img.caption}
                      </div>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => onSelectFriend({ id: img.sender_id, username: img.sender_username, avatar: img.sender_avatar })}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-400 hover:bg-indigo-500/10 transition shrink-0"
                  title="Перейти к диалогу"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
