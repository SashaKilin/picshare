import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { 
  X, 
  Upload, 
  Camera, 
  Image as ImageIcon, 
  User, 
  Calendar, 
  Sparkles, 
  Check, 
  AlertCircle,
  Palette
} from 'lucide-react';

const PRESET_GRADIENTS = [
  { id: 'cosmic', name: 'Космос', value: 'linear-gradient(135deg, #312e81 0%, #581c87 50%, #831843 100%)' },
  { id: 'sunset', name: 'Закат', value: 'linear-gradient(135deg, #e11d48 0%, #ea580c 50%, #f59e0b 100%)' },
  { id: 'cyberpunk', name: 'Неон', value: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 50%, #d946ef 100%)' },
  { id: 'emerald', name: 'Изумруд', value: 'linear-gradient(135deg, #065f46 0%, #115e59 50%, #164e63 100%)' },
  { id: 'amethyst', name: 'Аметист', value: 'linear-gradient(135deg, #4c1d95 0%, #6b21a8 50%, #3730a3 100%)' },
  { id: 'midnight', name: 'Полночь', value: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #090d16 100%)' },
];

const PRESET_BADGES = [
  '🎨 Художник',
  '📸 Фотограф',
  '🎮 Геймер',
  '✨ Мечтатель',
  '😂 Мемолог',
  '🎧 Меломан',
  '🐱 Кошатник',
  '🚀 Исследователь'
];

export function EditProfileModal({ isOpen, onClose, onProfileUpdated }) {
  const { user, updateUser } = useAuth();

  const [username, setUsername] = useState(user?.username || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [birthdate, setBirthdate] = useState(user?.birthdate || '');
  const [badge, setBadge] = useState(user?.badge || '');
  const [avatar, setAvatar] = useState(user?.avatar || '');
  const [banner, setBanner] = useState(user?.banner || '');

  const [loading, setLoading] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [error, setError] = useState('');

  const avatarInputRef = useRef(null);
  const bannerInputRef = useRef(null);

  useEffect(() => {
    if (isOpen && user) {
      setUsername(user.username || '');
      setBio(user.bio || '');
      setBirthdate(user.birthdate || '');
      setBadge(user.badge || '');
      setAvatar(user.avatar || '');
      setBanner(user.banner || '');
      setError('');
    }
  }, [isOpen, user]);

  if (!isOpen) return null;

  async function handleAvatarUpload(file) {
    if (!file) return;
    setUploadingAvatar(true);
    setError('');
    try {
      const res = await api.uploadMedia(file);
      setAvatar(res.url);
    } catch (err) {
      setError(err.message || 'Ошибка загрузки аватара');
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleBannerUpload(file) {
    if (!file) return;
    setUploadingBanner(true);
    setError('');
    try {
      const res = await api.uploadMedia(file);
      setBanner(res.url);
    } catch (err) {
      setError(err.message || 'Ошибка загрузки баннера');
    } finally {
      setUploadingBanner(false);
    }
  }

  function handleDicebearAvatar() {
    const random = Math.floor(Math.random() * 10000);
    setAvatar(`https://api.dicebear.com/7.x/bottts/svg?seed=user_${random}`);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const data = await api.updateProfile({
        username,
        bio,
        birthdate,
        badge,
        avatar,
        banner
      });

      updateUser(data.user);
      if (onProfileUpdated) onProfileUpdated(data.user);
      onClose();
    } catch (err) {
      setError(err.message || 'Не удалось сохранить профиль');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/85 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-xl bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl max-h-[94dvh] sm:max-h-[90dvh] flex flex-col">
        
        {/* Шапка модалки */}
        <div className="p-3.5 sm:p-5 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-900/90">
          <div className="flex items-center gap-2">
            <User className="w-5 h-5 text-indigo-400" />
            <h3 className="font-bold text-base sm:text-lg text-white">Редактирование профиля</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition active:scale-90 touch-manipulation"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Форма редактирования со скроллом */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-3.5 sm:p-6 space-y-4 sm:space-y-6 custom-scrollbar">
          
          {error && (
            <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* 1. Превью Баннера и Аватара */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 sm:mb-2">
              Баннер и Аватарка
            </label>

            {/* Контейнер баннера */}
            <div className="relative h-28 sm:h-36 rounded-2xl overflow-hidden bg-gradient-to-r from-indigo-900 via-purple-900 to-slate-900 border border-slate-700/60 group">
              {banner && banner.startsWith('linear-gradient(') ? (
                <div style={{ background: banner }} className="w-full h-full" />
              ) : banner ? (
                <img src={banner} alt="Banner" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs">
                  Стандартный градиент
                </div>
              )}

              {/* Кнопка смены баннера */}
              <button
                type="button"
                onClick={() => bannerInputRef.current?.click()}
                className="absolute top-2.5 right-2.5 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-xl bg-slate-900/80 hover:bg-slate-900 text-white text-[11px] sm:text-xs font-semibold backdrop-blur border border-slate-700/80 transition flex items-center gap-1.5 active:scale-95 touch-manipulation shadow-md"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>{uploadingBanner ? 'Загрузка...' : 'Сменить баннер'}</span>
              </button>

              <input
                type="file"
                ref={bannerInputRef}
                onChange={(e) => handleBannerUpload(e.target.files[0])}
                accept="image/*"
                className="hidden"
              />
            </div>

            {/* Аватарка (наезжает на нижний край баннера) */}
            <div className="relative -mt-10 sm:-mt-12 ml-2 sm:ml-4 flex items-end gap-2.5 sm:gap-3 mb-3">
              <div className="relative w-18 h-18 sm:w-22 sm:h-22 rounded-2xl sm:rounded-3xl overflow-hidden border-4 border-slate-900 bg-slate-800 shadow-xl group shrink-0">
                <img src={avatar} alt="Avatar" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white"
                  title="Загрузить аватарку"
                >
                  <Camera className="w-5 h-5 sm:w-6 sm:h-6" />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 pb-1">
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  className="px-2.5 py-1.5 sm:px-3 sm:py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition active:scale-95 touch-manipulation"
                >
                  {uploadingAvatar ? 'Загрузка...' : 'Загрузить фото'}
                </button>
                <button
                  type="button"
                  onClick={handleDicebearAvatar}
                  className="px-2.5 py-1.5 sm:px-3 sm:py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 text-xs font-medium border border-indigo-500/30 transition flex items-center gap-1 active:scale-95 touch-manipulation"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Сгенерировать</span>
                </button>
              </div>

              <input
                type="file"
                ref={avatarInputRef}
                onChange={(e) => handleAvatarUpload(e.target.files[0])}
                accept="image/*"
                className="hidden"
              />
            </div>

            {/* Готовые пресеты градиентов для баннера (CSS, работают без интернета и не блокируются) */}
            <div className="p-2 sm:p-2.5 rounded-2xl bg-slate-800/40 border border-slate-800 flex items-center gap-2 overflow-x-auto no-scrollbar">
              <span className="text-[11px] font-medium text-slate-400 shrink-0 flex items-center gap-1">
                <Palette className="w-3.5 h-3.5 text-indigo-400" />
                <span>Градиенты:</span>
              </span>
              {PRESET_GRADIENTS.map((preset) => (
                <button
                  type="button"
                  key={preset.id}
                  onClick={() => setBanner(preset.value)}
                  style={{ background: preset.value }}
                  title={preset.name}
                  className={`w-9 h-6 sm:w-11 sm:h-7 rounded-lg shrink-0 border transition active:scale-95 touch-manipulation shadow-sm ${
                    banner === preset.value
                      ? 'border-white ring-2 ring-indigo-500 scale-105'
                      : 'border-slate-700/80 hover:scale-105 hover:border-slate-500'
                  }`}
                />
              ))}
              {banner && (
                <button
                  type="button"
                  onClick={() => setBanner('')}
                  className="text-[11px] font-medium text-rose-400 hover:text-rose-300 ml-1 shrink-0 px-2 py-1 rounded-lg hover:bg-rose-500/10 transition"
                >
                  Сбросить
                </button>
              )}
            </div>
          </div>

          {/* 2. Имя пользователя */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Имя пользователя (Никнейм)
            </label>
            <input
              type="text"
              required
              minLength={3}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-3.5 py-2.5 text-base sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition"
            />
          </div>

          {/* 3. Описание профиля (Bio) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-300">
                О себе (Описание)
              </label>
              <span className="text-[11px] text-slate-500">
                {bio.length}/300
              </span>
            </div>
            <textarea
              rows={3}
              maxLength={300}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Расскажите о себе, своих увлечениях или любимых артах..."
              className="w-full bg-slate-800/80 border border-slate-700 rounded-xl p-3 text-base sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition resize-none"
            />
          </div>

          {/* 4. Дата рождения */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-indigo-400" />
              <span>Дата рождения</span>
            </label>
            <input
              type="date"
              value={birthdate}
              onChange={(e) => setBirthdate(e.target.value)}
              className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-3.5 py-2.5 text-base sm:text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 transition cursor-pointer"
            />
          </div>

          {/* 5. Статус-бейдж */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              <span>Статус-бейдж</span>
            </label>
            <input
              type="text"
              maxLength={50}
              value={badge}
              onChange={(e) => setBadge(e.target.value)}
              placeholder="Например: 🎨 Люблю рисовать"
              className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-3.5 py-2.5 text-base sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition mb-2"
            />
            {/* Быстрые пресеты бейджей */}
            <div className="flex flex-wrap gap-1.5">
              {PRESET_BADGES.map((b) => (
                <button
                  type="button"
                  key={b}
                  onClick={() => setBadge(b)}
                  className={`px-2.5 py-1 rounded-xl text-[11px] font-medium border transition active:scale-95 touch-manipulation ${
                    badge === b 
                      ? 'bg-indigo-600 text-white border-indigo-500' 
                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>

          {/* Кнопка сохранения */}
          <div className="pt-2 sticky bottom-0 bg-slate-900/90 backdrop-blur-sm -mx-3.5 sm:-mx-6 -mb-3.5 sm:-mb-6 p-3.5 sm:p-6 border-t border-slate-800/80">
            <button
              type="submit"
              disabled={loading || uploadingAvatar || uploadingBanner}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 text-white font-bold text-sm shadow-lg shadow-indigo-600/30 transition active:scale-98 disabled:opacity-50 touch-manipulation"
            >
              {loading ? 'Сохранение...' : 'Сохранить изменения'}
            </button>
          </div>

        </form>

      </div>
    </div>
  );
}
