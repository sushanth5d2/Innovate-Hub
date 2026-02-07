(function () {
  // Idempotent global: don't redeclare in global scope if script is loaded twice.
  if (window.InnovateAPI && window.InnovateAPI.__version) {
    return;
  }

  const API_URL = window.location.origin + '/api';

  function getToken() {
    return localStorage.getItem('token');
  }

  function setToken(token) {
    localStorage.setItem('token', token);
  }

  function removeToken() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }

  function getCurrentUser() {
    const user = localStorage.getItem('user');
    return user ? JSON.parse(user) : null;
  }

  function setCurrentUser(user) {
    localStorage.setItem('user', JSON.stringify(user));
  }

  function isAuthenticated() {
    return !!getToken();
  }

  function requireAuth() {
    if (!isAuthenticated()) {
      window.location.href = '/';
      return false;
    }
    return true;
  }

  async function apiRequest(endpoint, options = {}) {
    const token = getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    if (options.body instanceof FormData) {
      delete headers['Content-Type'];
    }

    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers
    });

    const text = await response.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error('Invalid server response');
      }
    }

    if (!response.ok) {
      const error = new Error(data.error || `Request failed with status ${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  }

  function showAlert(message, type = 'success') {
    const alert = document.createElement('div');
    alert.className = `alert alert-${type}`;
    alert.textContent = message;

    const container = document.querySelector('.container') || document.body;
    container.insertBefore(alert, container.firstChild);
    setTimeout(() => alert.remove(), 5000);
  }

  function formatDate(dateString) {
    if (!dateString) return 'Unknown';
    
    // Handle SQLite datetime format: "2026-01-19 11:40:38"
    // SQLite stores in UTC, so we need to explicitly handle it
    let dateStr = dateString;
    if (dateStr.includes(' ') && !dateStr.includes('T') && !dateStr.includes('Z')) {
      dateStr = dateStr.replace(' ', 'T') + 'Z'; // Add 'Z' to indicate UTC
    }
    
    const date = new Date(dateStr);
    
    // Get current time in IST (UTC+5:30)
    const now = new Date();
    
    // Calculate difference
    const diff = now - date;

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;

    // Format date in IST timezone
    return date.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
  }

  function formatTimestamp(dateString) {
    if (!dateString) return '';
    
    // Handle SQLite datetime format
    let dateStr = dateString;
    if (dateStr.includes(' ') && !dateStr.includes('T') && !dateStr.includes('Z')) {
      dateStr = dateStr.replace(' ', 'T') + 'Z'; // Add 'Z' to indicate UTC
    }
    
    const date = new Date(dateStr);
    
    // Format in IST (Asia/Kolkata timezone)
    return date.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  }

  function previewFiles(input, previewContainer) {
    if (!input?.files || !previewContainer) return;
    previewContainer.innerHTML = '';

    Array.from(input.files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (file.type.startsWith('image/')) {
          const img = document.createElement('img');
          img.src = e.target.result;
          img.style.maxWidth = '150px';
          img.style.marginRight = '10px';
          img.style.borderRadius = '8px';
          previewContainer.appendChild(img);
        } else {
          const fileInfo = document.createElement('div');
          fileInfo.textContent = file.name;
          fileInfo.style.padding = '10px';
          fileInfo.style.background = '#f3f4f6';
          fileInfo.style.borderRadius = '6px';
          fileInfo.style.marginBottom = '5px';
          previewContainer.appendChild(fileInfo);
        }
      };
      reader.readAsDataURL(file);
    });
  }

  // Socket.IO
  let socket = null;

  function initSocket() {
    if (!isAuthenticated()) {
      return null;
    }

    if (socket && socket.connected) {
      return socket;
    }

    if (typeof window.io !== 'function') {
      console.warn('Socket.IO client not loaded (window.io missing)');
      return null;
    }

    socket = window.io(window.location.origin, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5
    });

    const user = getCurrentUser();

    socket.on('connect', () => {
      if (user?.id) {
        socket.emit('user:join', user.id);
      }
    });

    return socket;
  }

  function getSocket() {
    if (!socket || !socket.connected) {
      socket = initSocket();
    }
    return socket;
  }

  function logout() {
    try {
      if (socket && socket.connected) {
        socket.disconnect();
      }
    } catch {
      // ignore
    } finally {
      socket = null;
    }

    apiRequest('/auth/logout', { method: 'POST' })
      .catch(() => {})
      .finally(() => {
        removeToken();
        window.location.href = '/';
      });
  }

  function copyToClipboard(text) {
    navigator.clipboard
      .writeText(text)
      .then(() => showAlert('Copied to clipboard!', 'success'))
      .catch(() => showAlert('Failed to copy', 'error'));
  }

  function createEmojiPicker(inputElement) {
    const emojisList = ['😀', '😂', '😍', '🎉', '👍', '❤️', '🔥', '⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🏆', '🥇', '🎯'];
    const picker = document.createElement('div');
    picker.className = 'emoji-picker';
    picker.style.cssText = `
      position: absolute;
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 10px;
      display: none;
      z-index: 1000;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    `;

    emojisList.forEach((emoji) => {
      const span = document.createElement('span');
      span.textContent = emoji;
      span.style.cssText = 'cursor: pointer; padding: 5px; font-size: 24px;';
      span.onclick = () => {
        inputElement.value += emoji;
        picker.style.display = 'none';
      };
      picker.appendChild(span);
    });

    return picker;
  }

  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  function getUserAvatar(profilePicture) {
    return profilePicture || '/images/default-avatar.svg';
  }

  function createAvatarWithInitials(username) {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#6366f1';
    ctx.fillRect(0, 0, 100, 100);

    ctx.fillStyle = 'white';
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((username || '?').charAt(0).toUpperCase(), 50, 50);

    return canvas.toDataURL();
  }

  function initializePage() {
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        logout();
      });
    }

    const currentPage = window.location.pathname;
    document.querySelectorAll('.navbar-menu a').forEach((link) => {
      if (link.getAttribute('href') === currentPage) {
        link.classList.add('active');
      }
    });
  }

  window.InnovateAPI = {
    __version: '2026-01-12',
    API_URL,
    getToken,
    setToken,
    removeToken,
    getCurrentUser,
    setCurrentUser,
    isAuthenticated,
    requireAuth,
    apiRequest,
    showAlert,
    formatDate,
    formatTimestamp,
    previewFiles,
    logout,
    copyToClipboard,
    createEmojiPicker,
    initSocket,
    getSocket,
    debounce,
    getUserAvatar,
    createAvatarWithInitials,
    initializePage
  };
})();
