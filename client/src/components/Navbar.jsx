import React from 'react';
import { useAuth } from '../context/AuthContext';
import { 
  Images, 
  UserPlus, 
  Bell, 
  LogOut, 
  LogIn, 
  Sparkles, 
  LayoutGrid, 
  MessageSquareHeart
} from 'lucide-react';

export function Navbar({ 
  onOpenAuth, 
  onOpenSearch, 
  onOpenRequests, 
  requestsCount = 0,
  activeView, 
  setActiveView 
}) {
  const { user, logout, isAuthenticated } = useAuth();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-800 bg-slate-900/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
        
        {/* Логотип */}
        <div 
          onClick={() => setActiveView('chat')} 
          className="flex items-center gap-3 cursor-pointer select-none group"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/25 group-hover:scale-105 transition-transform">
            <Images className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 font-bold text-lg tracking-tight text-white">
              <span>PicShare</span>
              <span className="text-[10px] uppercase font-extrabold px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                Friends
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">Обмен картинками с друзьями</p>
          </div>
        </div>

        {/* Действия и навигация */}
        {isAuthenticated ? (
          <div className="flex items-center gap-2 sm:gap-3">
            
            {/* Переключение Лента / Чат */}
            <div className="flex bg-slate-800/80 p-1 rounded-xl border border-slate-700/60">
              <button
                onClick={() => setActiveView('chat')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activeView === 'chat'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <MessageSquareHeart className="w-4 h-4" />
                <span className="hidden md:inline">Диалоги</span>
              </button>
              <button
                onClick={() => setActiveView('feed')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activeView === 'feed'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <LayoutGrid className="w-4 h-4" />
                <span className="hidden md:inline">Общая лента</span>
              </button>
            </div>

            {/* Найти друзей */}
            <button
              onClick={onOpenSearch}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-200 text-xs sm:text-sm font-medium border border-slate-700 transition"
              title="Найти пользователей"
            >
              <UserPlus className="w-4 h-4 text-indigo-400" />
              <span className="hidden sm:inline">Найти друзей</span>
            </button>

            {/* Заявки в друзья */}
            <button
              onClick={onOpenRequests}
              className="relative p-2 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
              title="Заявки в друзья"
            >
              <Bell className="w-4 h-4" />
              {requestsCount > 0 && (
                <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-5 h-5 px-1 text-[11px] font-bold text-white bg-rose-500 rounded-full animate-pulse shadow-lg shadow-rose-500/50">
                  {requestsCount}
                </span>
              )}
            </button>

            {/* Профиль пользователя */}
            <div className="flex items-center gap-2.5 pl-2 border-l border-slate-800">
              <img
                src={user?.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${user?.username}`}
                alt={user?.username}
                className="w-8 h-8 rounded-full border border-indigo-500/40 object-cover bg-slate-800"
              />
              <div className="hidden lg:block text-left">
                <div className="text-xs font-semibold text-slate-200 leading-tight">
                  {user?.username}
                </div>
                <div className="text-[11px] text-slate-400 truncate max-w-[130px]">
                  {user?.email}
                </div>
              </div>

              {/* Кнопка выхода */}
              <button
                onClick={logout}
                className="p-2 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition"
                title="Выйти"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>

          </div>
        ) : (
          <div className="flex items-center gap-3">
            <button
              onClick={onOpenAuth}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-sm font-semibold shadow-lg shadow-indigo-600/30 transition transform hover:-translate-y-0.5"
            >
              <LogIn className="w-4 h-4" />
              <span>Войти / Регистрация</span>
            </button>
          </div>
        )}

      </div>
    </header>
  );
}
