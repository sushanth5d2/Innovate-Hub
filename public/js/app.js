// API base URL
const API_URL = window.location.origin + '/api';

// Get auth token
function getToken() {
  return localStorage.getItem('token');
}

// Set auth token
function setToken(token) {
  localStorage.setItem('token', token);
}

// Remove auth token
function removeToken() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}

// Get current user
function getCurrentUser() {
  const user = localStorage.getItem('user');
  return user ? JSON.parse(user) : null;
}

// Set current user
function setCurrentUser(user) {
  localStorage.setItem('user', JSON.stringify(user));
}

// Check if user is authenticated
function isAuthenticated() {
  return !!getToken();
}

// Redirect if not authenticated
function requireAuth() {
  if (!isAuthenticated()) {
    window.location.href = '/';
    return false;
  }
  return true;
}

// API request helper
async function apiRequest(endpoint, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Remove Content-Type for FormData
  if (options.body instanceof FormData) {
    delete headers['Content-Type'];
  }

  try {
    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }

    return data;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

// Show alert message
function showAlert(message, type = 'success') {
  const alert = document.createElement('div');
  alert.className = `alert alert-${type}`;
  alert.textContent = message;
  
  const container = document.querySelector('.container') || document.body;
  container.insertBefore(alert, container.firstChild);
  
  setTimeout(() => alert.remove(), 5000);
}

// Format date
function formatDate(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now - date;
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  
  return date.toLocaleDateString();
}

// Format timestamp
function formatTimestamp(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString();
}

// Handle file upload preview
function previewFiles(input, previewContainer) {
  if (!input.files) return;
  
  previewContainer.innerHTML = '';
  
  Array.from(input.files).forEach(file => {
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

// Logout
function logout() {
  // Disconnect socket before logout
  if (socket && socket.connected) {
    socket.disconnect();
    socket = null;
  }
  
  apiRequest('/auth/logout', { method: 'POST' })
    .catch(() => {})
    .finally(() => {
      removeToken();
      localStorage.removeItem('user');
      window.location.href = '/';
    });
}

// Copy to clipboard
function copyToClipboard(text) {
  navigator.clipboard.writeText(text)
    .then(() => showAlert('Copied to clipboard!', 'success'))
    .catch(() => showAlert('Failed to copy', 'error'));
}

// Emoji picker (simple implementation)
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
  
  emojisList.forEach(emoji => {
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

// Socket.IO connection
let socket;

function initSocket() {
  if (!isAuthenticated()) {
    console.log('Cannot initialize socket: User not authenticated');
    return null;
  }
  
  // Prevent multiple socket connections
  if (socket && socket.connected) {
    console.log('Socket already connected');
    return socket;
  }
  
  socket = io(window.location.origin, {
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5
  });
  
  const user = getCurrentUser();
  
  socket.on('connect', () => {
    console.log('Connected to server');
    if (user) {
      socket.emit('user:join', user.id);
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Disconnected from server');
  });
  
  socket.on('connect_error', (error) => {
    console.error('Socket connection error:', error);
  });
  
  return socket;
}

// Get socket instance
function getSocket() {
  if (!socket || !socket.connected) {
    socket = initSocket();
  }
  return socket;
}

// Search with debounce
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

// Load user avatar
function getUserAvatar(profilePicture) {
  return profilePicture || '/images/default-avatar.png';
}

// Create default avatar with initials
function createAvatarWithInitials(username) {
  const canvas = document.createElement('canvas');
  canvas.width = 100;
  canvas.height = 100;
  const ctx = canvas.getContext('2d');
  
  // Background
  ctx.fillStyle = '#6366f1';
  ctx.fillRect(0, 0, 100, 100);
  
  // Text
  ctx.fillStyle = 'white';
  ctx.font = 'bold 40px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(username.charAt(0).toUpperCase(), 50, 50);
  
  return canvas.toDataURL();
}

// Initialize page
function initializePage() {
  // Add logout handler if logout button exists
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      logout();
    });
  }
  
  // Highlight active nav item
  const currentPage = window.location.pathname;
  document.querySelectorAll('.navbar-menu a').forEach(link => {
    if (link.getAttribute('href') === currentPage) {
      link.classList.add('active');
    }
  });
}

// Export functions for use in other scripts
window.InnovateAPI = {
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
