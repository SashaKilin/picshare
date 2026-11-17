import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider, useSocket } from './context/SocketContext';
import { api } from './api';
import { Navbar } from './components/Navbar';
import { AuthModal } from './components/AuthModal';
import { UserSearchModal } from './components/UserSearchModal';
import { FriendRequestsModal } from './components/FriendRequestsModal';
import { FriendsSidebar } from './components/FriendsSidebar';
import { ImageChat } from './components/ImageChat';
import { FeedView } from './components/FeedView';
import { LightboxModal } from './components/LightboxModal';
import { NotificationToast } from './components/NotificationToast';
import { 
  Images, 
  ShieldCheck, 
  UserPlus, 
  Zap, 
  Sparkles, 
  ArrowRight,
  FileImage,
  Users
} from 'lucide-react';

function MainApp() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { socket } = useSocket();

  const [activeView, setActiveView] = useState('chat'); // 'chat' | 'feed'
  const [friends, setFriends] = useState([]);
  const [selectedFriend, setSelectedFriend] = useState(null);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [requestsCount, setRequestsCount] = useState(0);

  // Модальные окна
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isRequestsOpen, setIsRequestsOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState(null);

  useEffect(() => {
    if (isAuthenticated) {
      loadFriends();
      loadRequestsCount();
    } else {
      setFriends([]);
      setSelectedFriend(null);
      setRequestsCount(0);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!socket || !isAuthenticated) return;

    const handleReq = () => {
      loadRequestsCount();
    };

    const handleAccepted = () => {
      loadFriends();
      loadRequestsCount();
    };

    const handleRemoved = () => {
      loadFriends();
      setSelectedFriend(null);
    };

    socket.on('new_friend_request', handleReq);
    socket.on('friend_request_accepted', handleAccepted);
    socket.on('friend_removed', handleRemoved);

    return () => {
      socket.off('new_friend_request', handleReq);
      socket.off('friend_request_accepted', handleAccepted);
      socket.off('friend_removed', handleRemoved);
    };
  }, [socket, isAuthenticated]);

  async function loadFriends() {
    setLoadingFriends(true);
    try {
      const data = await api.getFriends();
      setFriends(data.friends || []);
      // На десктопе выбираем первого друга, если еще не выбран
      if (window.innerWidth >= 768 && data.friends?.length > 0 && !selectedFriend) {
        setSelectedFriend(data.friends[0]);
      }
    } catch (err) {
      console.error('Ошибка загрузки друзей:', err);
    } finally {
      setLoadingFriends(false);
    }
  }

  async function loadRequestsCount() {
    try {
      const data = await api.getFriendRequests();
      setRequestsCount(data.incoming?.length || 0);
    } catch (err) {
      console.error('Ошибка подсчета заявок:', err);
    }
  }

  function handleFriendAccepted(friend) {
    loadFriends();
    loadRequestsCount();
    if (friend) {
      setSelectedFriend(friend);
      setActiveView('chat');
    }
  }

  function handleFriendRemoved(friendId) {
    setFriends((prev) => prev.filter((f) => f.id !== friendId));
    if (selectedFriend?.id === friendId) {
      setSelectedFriend(null);
    }
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center animate-spin">
            <Images className="w-6 h-6 text-white" />
          </div>
          <span className="text-xs text-slate-400 font-medium">Загрузка PicShare...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 font-sans">
      
      {/* Навигационная панель */}
      <Navbar
        onOpenAuth={() => setIsAuthOpen(true)}
        onOpenSearch={() => setIsSearchOpen(true)}
        onOpenRequests={() => setIsRequestsOpen(true)}
        requestsCount={requestsCount}
        activeView={activeView}
        setActiveView={setActiveView}
      />

      {/* Основной контент */}
      {isAuthenticated ? (
        <main className="flex-1 flex overflow-hidden h-[calc(100dvh-3.5rem)] sm:h-[calc(100dvh-4rem)]">
          {activeView === 'feed' ? (
            <FeedView
              onSelectFriend={(friend) => {
                setSelectedFriend(friend);
                setActiveView('chat');
              }}
              onOpenLightbox={(img) => setLightboxImage(img)}
            />
          ) : (
            <>
              {/* Сайдбар со списком друзей:
                  - На мобильном виден, если друг НЕ выбран
                  - На планшете/ПК виден ВСЕГДА */}
              <FriendsSidebar
                friends={friends}
                selectedFriend={selectedFriend}
                onSelectFriend={(friend) => setSelectedFriend(friend)}
                onOpenSearch={() => setIsSearchOpen(true)}
                loading={loadingFriends}
                className={`${
                  selectedFriend ? 'hidden md:flex' : 'flex w-full'
                } md:w-80 lg:w-96`}
              />

              {/* Окно диалога:
                  - На мобильном видно, если друг ВЫБРАН
                  - На планшете/ПК занимает оставшееся пространство */}
              {selectedFriend ? (
                <div className={`flex-1 flex flex-col h-full ${selectedFriend ? 'flex' : 'hidden md:flex'}`}>
                  <ImageChat
                    friend={selectedFriend}
                    onFriendRemoved={handleFriendRemoved}
                    onOpenLightbox={(img) => setLightboxImage(img)}
                    onBack={() => setSelectedFriend(null)}
                  />
                </div>
              ) : (
                <div className="flex-1 hidden md:flex flex-col items-center justify-center text-center p-8 bg-slate-950">
                  <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-3xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mb-4">
                    <Images className="w-8 h-8 sm:w-10 sm:h-10" />
                  </div>
                  <h3 className="text-lg sm:text-xl font-bold text-white">Выберите друга для обмена картинками</h3>
                  <p className="text-xs text-slate-400 max-w-md mt-2">
                    Выберите друга из списка слева или найдите новых знакомых, чтобы делиться фото и мемами.
                  </p>
                  <button
                    onClick={() => setIsSearchOpen(true)}
                    className="mt-6 flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-lg shadow-indigo-600/30 transition transform hover:-translate-y-0.5 active:scale-95"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span>Найти друзей</span>
                  </button>
                </div>
              )}
            </>
          )}
        </main>
      ) : (
        /* Приветственный лендинг */
        <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
          <div className="max-w-4xl w-full text-center py-6 sm:py-12 px-2 sm:px-4">
            
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-xs font-semibold mb-6 animate-pulse">
              <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span>Безопасный обмен фото и картинками</span>
            </div>

            <h1 className="text-3xl sm:text-5xl md:text-6xl font-extrabold text-white tracking-tight leading-tight">
              Делитесь картинками <br className="hidden sm:inline" />
              <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                только со своими друзьями
              </span>
            </h1>

            <p className="mt-4 text-sm sm:text-lg text-slate-400 max-w-2xl mx-auto px-2">
              Никаких публичных лент и спама. Добавляйте друг друга в друзья и отправляйте картинки, мемы и арты в приватных диалогах.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={() => setIsAuthOpen(true)}
                className="w-full sm:w-auto px-8 py-3.5 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 text-white font-bold text-sm shadow-xl shadow-indigo-600/30 transition active:scale-95 flex items-center justify-center gap-2"
              >
                <span>Начать прямо сейчас</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {/* Карточки фич */}
            <div className="mt-12 sm:mt-16 grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 text-left">
              <div className="p-5 sm:p-6 rounded-3xl bg-slate-900/60 border border-slate-800/80">
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mb-3 sm:mb-4">
                  <Zap className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <h3 className="font-bold text-white text-sm sm:text-base">Быстрый старт</h3>
                <p className="text-xs text-slate-400 mt-1 sm:mt-2 leading-relaxed">
                  Регистрация по почте без кодов подтверждения или вход в один клик через Google аккаунт.
                </p>
              </div>

              <div className="p-5 sm:p-6 rounded-3xl bg-slate-900/60 border border-slate-800/80">
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center mb-3 sm:mb-4">
                  <Users className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <h3 className="font-bold text-white text-sm sm:text-base">Взаимная дружба</h3>
                <p className="text-xs text-slate-400 mt-1 sm:mt-2 leading-relaxed">
                  Отправлять и получать картинки можно строго после обоюдного согласия и добавления в друзья.
                </p>
              </div>

              <div className="p-5 sm:p-6 rounded-3xl bg-slate-900/60 border border-slate-800/80">
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-pink-500/10 border border-pink-500/20 text-pink-400 flex items-center justify-center mb-3 sm:mb-4">
                  <FileImage className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <h3 className="font-bold text-white text-sm sm:text-base">Удобный обмен</h3>
                <p className="text-xs text-slate-400 mt-1 sm:mt-2 leading-relaxed">
                  Съемка с камеры телефона, Drag & Drop, полноэкранный Lightbox и моментальная доставка картинок.
                </p>
              </div>
            </div>

          </div>
        </main>
      )}

      {/* Модальные окна */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
      />

      <UserSearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelectFriend={(friend) => {
          setSelectedFriend(friend);
          setActiveView('chat');
        }}
      />

      <FriendRequestsModal
        isOpen={isRequestsOpen}
        onClose={() => setIsRequestsOpen(false)}
        onFriendAccepted={handleFriendAccepted}
      />

      <LightboxModal
        image={lightboxImage}
        onClose={() => setLightboxImage(null)}
      />

      <NotificationToast
        onOpenRequests={() => setIsRequestsOpen(true)}
        onSelectFriend={(friend) => {
          setSelectedFriend(friend);
          setActiveView('chat');
        }}
      />

    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <MainApp />
      </SocketProvider>
    </AuthProvider>
  );
}
