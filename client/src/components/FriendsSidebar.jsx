import React, { useState } from 'react';
import { useSocket } from '../context/SocketContext';
import { Search, UserPlus, Image, Users, Sparkles } from 'lucide-react';

export function FriendsSidebar({
  friends = [],
  selectedFriend,
  onSelectFriend,
  onOpenSearch,
  loading = false,
  className = '',
}) {
  const [filter, setFilter] = useState('');
  const { onlineUsers, unreadMap } = useSocket();

  const filteredFriends = friends.filter((f) =>
    f.username.toLowerCase().includes(filter.toLowerCase()) ||
    f.email.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <aside className={`flex flex-col border-r border-slate-800 bg-slate-900/50 shrink-0 h-full ${className}`}>
      
      {/* Шапка сайдбара */}
      <div className="p-3 sm:p-4 border-b border-slate-800 shrink-0">
        <div className="flex items-center justify-between mb-2.5 sm:mb-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-indigo-400" />
            <h3 className="font-bold text-sm text-white">Мои друзья</h3>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700/60">
              {friends.length}
            </span>
          </div>

          <button
            onClick={onOpenSearch}
            className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-indigo-600/15 hover:bg-indigo-600/25 text-indigo-300 border border-indigo-500/20 text-xs font-semibold transition touch-manipulation active:scale-95"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Добавить</span>
          </button>
        </div>

        {/* Быстрый фильтр */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Поиск по друзьям..."
            className="w-full bg-slate-800/80 border border-slate-700/60 rounded-xl pl-9 pr-3 py-2 text-base sm:text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition"
          />
        </div>
      </div>

      {/* Список друзей */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {loading && (
          <div className="p-6 text-center text-xs text-slate-500 animate-pulse">
            Загрузка списка друзей...
          </div>
        )}

        {!loading && friends.length === 0 && (
          <div className="p-6 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 mx-auto flex items-center justify-center">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-300">Друзей пока нет</p>
              <p className="text-xs text-slate-500 mt-1">
                Добавьте друзей, чтобы начать обмениваться картинками!
              </p>
            </div>
            <button
              onClick={onOpenSearch}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition touch-manipulation active:scale-95"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Найти первых друзей</span>
            </button>
          </div>
        )}

        {!loading && friends.length > 0 && filteredFriends.length === 0 && (
          <div className="p-6 text-center text-xs text-slate-500">
            Никого не найдено
          </div>
        )}

        {filteredFriends.map((friend) => {
          const isSelected = selectedFriend?.id === friend.id;
          const isOnline = onlineUsers.has(Number(friend.id));
          const unreadCount = unreadMap?.[Number(friend.id)] || 0;

          return (
            <button
              key={friend.id}
              onClick={() => onSelectFriend(friend)}
              className={`w-full flex items-center gap-3 p-3 rounded-2xl text-left transition-all touch-manipulation active:scale-[0.99] ${
                isSelected
                  ? 'bg-indigo-600/20 border border-indigo-500/40 text-white shadow-sm'
                  : 'hover:bg-slate-800/60 border border-transparent text-slate-300'
              }`}
            >
              <div className="relative shrink-0">
                <img
                  src={friend.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${friend.username}`}
                  alt={friend.username}
                  className="w-11 h-11 rounded-full border border-slate-700 object-cover bg-slate-800"
                />
                <span
                  className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-slate-900 ${
                    isOnline ? 'bg-emerald-500' : 'bg-slate-600'
                  }`}
                  title={isOnline ? 'В сети' : 'Не в сети'}
                />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className="font-semibold text-sm truncate text-slate-200">
                    {friend.username}
                  </span>

                  {unreadCount > 0 ? (
                    <span className="flex items-center justify-center min-w-5 h-5 px-1.5 text-[10px] font-bold text-white bg-indigo-500 rounded-full animate-bounce shadow-md">
                      +{unreadCount}
                    </span>
                  ) : friend.total_images > 0 ? (
                    <span className="flex items-center gap-0.5 text-[11px] text-slate-400 shrink-0">
                      <Image className="w-3 h-3 text-indigo-400" />
                      <span>{friend.total_images}</span>
                    </span>
                  ) : null}
                </div>
                <div className="text-xs text-slate-500 truncate mt-0.5">
                  {friend.email}
                </div>
              </div>
            </button>
          );
        })}
      </div>

    </aside>
  );
}
