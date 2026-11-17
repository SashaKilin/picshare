const API_BASE = '/api';

export function getAuthToken() {
  return localStorage.getItem('picshare_token');
}

export function setAuthToken(token) {
  if (token) {
    localStorage.setItem('picshare_token', token);
  } else {
    localStorage.removeItem('picshare_token');
  }
}

async function request(endpoint, options = {}) {
  const token = getAuthToken();
  const headers = {
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // If body is NOT FormData, default to application/json
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Произошла ошибка при выполнении запроса');
  }

  return data;
}

export const api = {
  // Auth
  register: (userData) => request('/auth/register', { method: 'POST', body: userData }),
  login: (credentials) => request('/auth/login', { method: 'POST', body: credentials }),
  googleAuth: (credential) => request('/auth/google', { method: 'POST', body: { credential } }),
  getMe: () => request('/auth/me'),
  updateProfile: (profileData) => request('/auth/profile', { method: 'PUT', body: profileData }),

  // Friends
  getFriends: () => request('/friends'),
  getFriendRequests: () => request('/friends/requests'),
  sendFriendRequest: (targetUserId, query) => request('/friends/request', { method: 'POST', body: { targetUserId, query } }),
  acceptFriendRequest: (requestId, senderId) => request('/friends/accept', { method: 'POST', body: { requestId, senderId } }),
  rejectFriendRequest: (requestId, senderId) => request('/friends/reject', { method: 'POST', body: { requestId, senderId } }),
  removeFriend: (friendId) => request(`/friends/${friendId}`, { method: 'DELETE' }),
  searchUsers: (q) => request(`/friends/search?q=${encodeURIComponent(q)}`),

  // Images
  sendImage: (formData) => request('/images/send', { method: 'POST', body: formData }),
  getChatImages: (friendId) => request(`/images/chat/${friendId}`),
  deleteImage: (imageId) => request(`/images/${imageId}`, { method: 'DELETE' }),
  getFeed: () => request('/images/feed'),

  // Health
  getHealth: () => request('/health'),
};
