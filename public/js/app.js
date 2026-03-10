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
    // Unregister push notification token before logout
    if (window.InnovatePush && window.InnovatePush.unregister) {
      try { window.InnovatePush.unregister(); } catch(e) { /* ignore */ }
    }

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

  function initAdminPanelLink() {
  try {
    const user = getCurrentUser();
    if (!user || !user.is_admin) return;
    const adminToken = localStorage.getItem('admin_token');
    if (!adminToken) return;
    const navIcons = document.querySelector('.ig-nav-icons');
    if (!navIcons) return;
    // Don't add twice
    if (document.getElementById('adminPanelLink')) return;
    const link = document.createElement('a');
    link.id = 'adminPanelLink';
    link.href = '/admin';
    link.title = 'Admin Panel';
    link.style.cssText = 'display:flex;align-items:center;gap:4px;background:linear-gradient(135deg,#6c5ce7,#a29bfe);color:#fff;font-size:11px;font-weight:700;padding:4px 10px;border-radius:16px;text-decoration:none;margin-right:4px;';
    link.innerHTML = '<i class="fas fa-shield-alt" style="font-size:12px;"></i> Admin';
    navIcons.insertBefore(link, navIcons.firstChild);
  } catch(e) {}
}

function initNavProfilePic() {
    const user = getCurrentUser();
    // Find profile nav item by ID or by SVG aria-label
    let profileLink = document.getElementById('profileNavLink');
    if (!profileLink) {
      const nav = document.querySelector('.ig-bottom-nav');
      if (nav) {
        const items = nav.querySelectorAll('.ig-bottom-nav-item');
        for (const item of items) {
          const label = item.querySelector('.ig-bottom-nav-label');
          if (label && label.textContent.trim() === 'Profile') {
            profileLink = item;
            break;
          }
        }
      }
    }
    if (!profileLink) return;
    const svg = profileLink.querySelector('svg');
    if (!svg) return;
    const pic = user && user.profile_picture ? user.profile_picture : '/images/default-avatar.svg';
    const img = document.createElement('img');
    img.src = pic;
    img.alt = 'Profile';
    img.className = 'ig-nav-profile-pic';
    img.onerror = function() { this.src = '/images/default-avatar.svg'; };
    svg.replaceWith(img);
  }

  function initializePage() {
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        logout();
      });
    }

    // Load profile picture into bottom nav Profile item
    initNavProfilePic();
    initAdminPanelLink();

    const currentPage = window.location.pathname;
    document.querySelectorAll('.navbar-menu a').forEach((link) => {
      if (link.getAttribute('href') === currentPage) {
        link.classList.add('active');
      }
    });

    // ---- Native mobile app behaviors ----
    initMobileAppBehaviors();
  }

  function initMobileAppBehaviors() {
    // 1. Prevent rubber-band overscroll (native feel)
    document.body.style.overscrollBehavior = 'none';

    // 2. Disable text selection on UI elements (like native)
    const style = document.createElement('style');
    style.textContent = `
      button, a, .nav-item, .bottom-nav, .top-nav, .navbar,
      .tab, .tab-btn, .story-item, .action-btn, .icon-btn {
        -webkit-user-select: none;
        user-select: none;
        -webkit-tap-highlight-color: transparent;
      }
      /* Smooth page transitions */
      body { 
        -webkit-overflow-scrolling: touch;
      }
      /* Active tap feedback like native */
      button:active, a:active, .nav-item:active, .tab:active, .tab-btn:active {
        opacity: 0.7;
        transition: opacity 0.1s;
      }
      /* Hide scrollbar for cleaner mobile look */
      ::-webkit-scrollbar { width: 0; height: 0; }
      /* Safe area insets for notched phones */
      .bottom-nav, .bottom-navigation {
        padding-bottom: env(safe-area-inset-bottom, 0px);
      }
      .top-nav, .top-navigation, .navbar {
        padding-top: env(safe-area-inset-top, 0px);
      }
    `;
    document.head.appendChild(style);

    // 3. Swipe right from left edge = go back (like native Android)
    let touchStartX = 0;
    let touchStartY = 0;
    let swiping = false;

    document.addEventListener('touchstart', function(e) {
      const touch = e.touches[0];
      // Only trigger from left 25px edge
      if (touch.clientX < 25) {
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        swiping = true;
      }
    }, { passive: true });

    document.addEventListener('touchend', function(e) {
      if (!swiping) return;
      swiping = false;
      const touch = e.changedTouches[0];
      const diffX = touch.clientX - touchStartX;
      const diffY = Math.abs(touch.clientY - touchStartY);
      // Swipe right > 80px and more horizontal than vertical
      if (diffX > 80 && diffX > diffY * 1.5) {
        if (window.history.length > 1) {
          window.history.back();
        }
      }
    }, { passive: true });

    // 4. Viewport meta for proper mobile rendering
    let viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) {
      viewport.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
    }
  }

  // ===== TAKE A BREAK CHECK =====
  function checkBreakStatus() {
    // Skip on login/register pages
    if (window.location.pathname === '/login' || window.location.pathname === '/register' || window.location.pathname === '/') return;
    const token = getToken();
    if (!token) return;

    // Quick local check first
    const localBreak = localStorage.getItem('break_until');
    if (localBreak && new Date(localBreak) > new Date()) {
      showBreakScreenGlobal(localBreak);
      return;
    } else if (localBreak) {
      localStorage.removeItem('break_until');
    }

    // Server check
    fetch(API_URL + '/users/take-a-break/status', {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(function(r) { return r.json(); }).then(function(data) {
      if (data.is_on_break && data.break_until) {
        localStorage.setItem('break_until', data.break_until);
        showBreakScreenGlobal(data.break_until);
      }
    }).catch(function() {});
  }

  function showBreakScreenGlobal(breakUntilStr) {
    if (document.getElementById('break-screen-global')) return;
    const screen = document.createElement('div');
    screen.id = 'break-screen-global';
    screen.style.cssText = 'position:fixed;inset:0;background:#0a0a0a;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-family:-apple-system,BlinkMacSystemFont,sans-serif;';
    screen.innerHTML = '<div style="text-align:center;max-width:340px;padding:20px;">'
      + '<div style="font-size:64px;margin-bottom:16px;">☕</div>'
      + '<h2 style="margin:0 0 8px;font-size:24px;font-weight:700;">You\'re on a break</h2>'
      + '<p style="margin:0 0 24px;color:#86868b;font-size:14px;">Take some time away. The app will unlock when the timer ends.</p>'
      + '<div id="break-countdown-global" style="font-size:48px;font-weight:800;background:linear-gradient(135deg,#fdcb6e,#e17055);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:24px;font-variant-numeric:tabular-nums;"></div>'
      + '<p style="margin:0;color:#86868b;font-size:12px;">You chose this. Stay strong! 💪</p>'
      + '</div>';
    document.body.appendChild(screen);

    var countdown = screen.querySelector('#break-countdown-global');
    function update() {
      var now = new Date();
      var end = new Date(breakUntilStr);
      var diff = end - now;
      if (diff <= 0) {
        screen.remove();
        localStorage.removeItem('break_until');
        return;
      }
      var h = Math.floor(diff / 3600000);
      var m = Math.floor((diff % 3600000) / 60000);
      var s = Math.floor((diff % 60000) / 1000);
      countdown.textContent = (h > 0 ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
      setTimeout(update, 500);
    }
    update();
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
    initializePage,
    initNavProfilePic,
    checkBreakStatus,
    showBreakScreenGlobal
  };

  // Auto-init: load profile pic into bottom nav on every page
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      initNavProfilePic();
      checkBreakStatus();
    });
  } else {
    initNavProfilePic();
    checkBreakStatus();
  }
})();
