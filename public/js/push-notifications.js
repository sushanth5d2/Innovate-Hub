/**
 * Push Notifications Client
 * Handles Capacitor push notification registration and incoming notification handling.
 * Works on Android/iOS native apps. No-ops gracefully in browser.
 */
(function() {
  'use strict';

  let pushInitialized = false;
  let currentToken = null;

  /**
   * Check if running inside Capacitor native app
   */
  function isNativeApp() {
    return window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
  }

  /**
   * Initialize push notifications
   * Call this AFTER user is authenticated (token available)
   */
  async function initPushNotifications() {
    if (pushInitialized || !isNativeApp()) return;

    try {
      // Dynamically import Capacitor plugins
      const { PushNotifications } = await import('https://cdn.jsdelivr.net/npm/@capacitor/push-notifications@6/dist/esm/index.js').catch(() => {
        // Fallback: try from Capacitor.Plugins
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications) {
          return { PushNotifications: window.Capacitor.Plugins.PushNotifications };
        }
        return {};
      });

      if (!PushNotifications) {
        console.warn('PushNotifications plugin not available');
        return;
      }

      // Request permission
      const permResult = await PushNotifications.requestPermissions();
      if (permResult.receive !== 'granted') {
        console.warn('Push notification permission denied');
        return;
      }

      // Register for push notifications
      await PushNotifications.register();

      // Listen for registration success
      PushNotifications.addListener('registration', async (token) => {
        console.log('Push registration token:', token.value);
        currentToken = token.value;
        await sendTokenToServer(token.value);
      });

      // Listen for registration errors
      PushNotifications.addListener('registrationError', (error) => {
        console.error('Push registration error:', error);
      });

      // Handle notification received while app is in foreground
      PushNotifications.addListener('pushNotificationReceived', (notification) => {
        console.log('Push notification received in foreground:', notification);
        const data = notification.data || {};

        // Incoming call: trigger the call manager
        if (data.type === 'incoming_call') {
          handleIncomingCallPush(data);
          return;
        }

        // Show in-app notification banner
        showInAppNotification(notification);
      });

      // Handle notification tap (app was in background or killed)
      PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        console.log('Push notification tapped:', action);
        const data = action.notification.data || {};

        // Incoming call tap: navigate to app and the call manager should handle it
        if (data.type === 'incoming_call') {
          handleIncomingCallPush(data);
          return;
        }

        handleNotificationTap(action.notification);
      });

      pushInitialized = true;
      console.log('Push notifications initialized');
    } catch (err) {
      console.error('Failed to initialize push notifications:', err);
    }
  }

  /**
   * Send FCM token to server
   */
  async function sendTokenToServer(deviceToken) {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      const resp = await fetch(window.location.origin + '/api/notifications/device-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({
          token: deviceToken,
          deviceType: window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : 'android'
        })
      });

      if (resp.ok) {
        console.log('Device token registered on server');
      }
    } catch (err) {
      console.error('Failed to register device token:', err);
    }
  }

  /**
   * Unregister device token on logout
   */
  async function unregisterPush() {
    if (!currentToken) return;
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      await fetch(window.location.origin + '/api/notifications/device-token', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ token: currentToken })
      });

      currentToken = null;
      console.log('Device token unregistered');
    } catch (err) {
      console.error('Failed to unregister device token:', err);
    }
  }

  /**
   * Show in-app notification banner when notification arrives while app is open
   */
  function showInAppNotification(notification) {
    const data = notification.data || {};
    const title = notification.title || 'Innovate Hub';
    const body = notification.body || '';

    // Don't show in-app notification for calls (handled by call manager)
    if (data.type === 'incoming_call') return;

    // Create notification banner
    const banner = document.createElement('div');
    banner.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
      background: linear-gradient(135deg, #405DE6, #5851DB, #833AB4);
      color: white; padding: 16px 20px; font-family: -apple-system, sans-serif;
      display: flex; align-items: center; gap: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3); cursor: pointer;
      transform: translateY(-100%); transition: transform 0.3s ease;
    `;

    banner.innerHTML = `
      <div style="flex:1">
        <div style="font-weight:600;font-size:14px">${escapeHtml(title)}</div>
        <div style="font-size:13px;opacity:0.9;margin-top:2px">${escapeHtml(body)}</div>
      </div>
      <div style="font-size:12px;opacity:0.7">now</div>
    `;

    banner.onclick = () => {
      banner.remove();
      handleNotificationTap(notification);
    };

    document.body.appendChild(banner);
    requestAnimationFrame(() => {
      banner.style.transform = 'translateY(0)';
    });

    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      banner.style.transform = 'translateY(-100%)';
      setTimeout(() => banner.remove(), 300);
    }, 5000);
  }

  /**
   * Handle notification tap — navigate to relevant page
   */
  function handleNotificationTap(notification) {
    const data = notification.data || {};
    const type = data.type || '';

    switch (type) {
      case 'message':
        window.location.href = '/messages';
        break;
      case 'incoming_call':
        // Call manager handles this via socket events
        window.location.href = '/home';
        break;
      case 'like':
      case 'comment':
        window.location.href = '/home';
        break;
      case 'follow':
      case 'follow_request':
        window.location.href = '/profile.html';
        break;
      default:
        window.location.href = '/home';
    }
  }

  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Handle incoming call push notification
   * Shows the call screen or reconnects and triggers the call manager
   */
  function handleIncomingCallPush(data) {
    console.log('Incoming call push:', data);

    // If the unified call manager is loaded and socket is connected, it will handle via socket events
    // But if we got here via push (app was backgrounded), we may need to show a local call UI
    if (window.UnifiedCallManager && window.UnifiedCallManager.instance) {
      // Call manager exists, it will receive the socket event
      return;
    }

    // Store the incoming call data so when app loads, it can pick it up
    sessionStorage.setItem('pendingIncomingCall', JSON.stringify({
      from: data.callerId,
      callerName: data.callerName,
      isVideo: data.isVideo === 'true',
      isGroup: data.isGroup === 'true',
      groupId: data.groupId || null,
      timestamp: Date.now()
    }));

    // Navigate to home page where call manager is initialized
    if (!window.location.pathname.includes('/home')) {
      window.location.href = '/home';
    }
  }

  // Expose globally
  window.InnovatePush = {
    init: initPushNotifications,
    unregister: unregisterPush,
    isNativeApp: isNativeApp,
    getToken: () => currentToken
  };

  // Auto-initialize when DOM is ready and user is authenticated
  function autoInit() {
    if (localStorage.getItem('token') && isNativeApp()) {
      // Delay slightly to ensure Capacitor plugins are loaded
      setTimeout(initPushNotifications, 1000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})();
