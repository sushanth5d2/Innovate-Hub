/**
 * Push Notification Service
 * Sends FCM push notifications to Android devices when users are offline.
 * Falls back gracefully if Firebase is not configured.
 */

const { getDb } = require('../config/database');

let firebaseAdmin = null;
let firebaseInitialized = false;

// Initialize Firebase Admin SDK (if credentials are available)
const initFirebase = () => {
  if (firebaseInitialized) return !!firebaseAdmin;
  firebaseInitialized = true;

  try {
    const admin = require('firebase-admin');
    const fs = require('fs');
    const path = require('path');

    // Check for service account key file
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
      || path.resolve(__dirname, '../firebase-service-account.json');

    if (fs.existsSync(serviceAccountPath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      firebaseAdmin = admin;
      console.log('Firebase Admin SDK initialized successfully');
      return true;
    }

    // Check for environment variable with JSON
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      firebaseAdmin = admin;
      console.log('Firebase Admin SDK initialized from env variable');
      return true;
    }

    // Check for individual env variables
    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
        })
      });
      firebaseAdmin = admin;
      console.log('Firebase Admin SDK initialized from env variables');
      return true;
    }

    console.warn('Firebase not configured — push notifications disabled. Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_* env vars.');
    return false;
  } catch (err) {
    console.error('Firebase Admin SDK initialization failed:', err.message);
    return false;
  }
};

/**
 * Register a device token for a user
 */
const registerDeviceToken = (userId, deviceToken, deviceType = 'android') => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    db.run(
      `INSERT INTO device_tokens (user_id, device_token, device_type, is_active, updated_at)
       VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, device_token) DO UPDATE SET is_active = 1, updated_at = CURRENT_TIMESTAMP`,
      [userId, deviceToken, deviceType],
      function(err) {
        if (err) return reject(err);
        resolve({ success: true });
      }
    );
  });
};

/**
 * Unregister a device token
 */
const unregisterDeviceToken = (userId, deviceToken) => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    db.run(
      'UPDATE device_tokens SET is_active = 0 WHERE user_id = ? AND device_token = ?',
      [userId, deviceToken],
      function(err) {
        if (err) return reject(err);
        resolve({ success: true });
      }
    );
  });
};

/**
 * Get active device tokens for a user
 */
const getDeviceTokens = (userId) => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    db.all(
      'SELECT device_token, device_type FROM device_tokens WHERE user_id = ? AND is_active = 1',
      [userId],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      }
    );
  });
};

/**
 * Remove invalid tokens (called after FCM rejects them)
 */
const removeInvalidToken = (token) => {
  return new Promise((resolve) => {
    const db = getDb();
    db.run('DELETE FROM device_tokens WHERE device_token = ?', [token], () => resolve());
  });
};

/**
 * Send push notification to a specific user
 * @param {number} userId - Target user ID
 * @param {object} notification - { title, body, data }
 * @param {object} options - { priority: 'high'|'normal', isCall: boolean }
 */
const sendPushToUser = async (userId, notification, options = {}) => {
  if (!initFirebase() || !firebaseAdmin) return;

  try {
    const tokens = await getDeviceTokens(userId);
    if (!tokens.length) return;

    const deviceTokens = tokens.map(t => t.device_token);

    const message = {
      notification: {
        title: notification.title || 'Innovate Hub',
        body: notification.body || ''
      },
      data: {
        ...(notification.data || {}),
        // Ensure all data values are strings (FCM requirement)
        click_action: notification.data?.click_action || 'OPEN_APP',
        type: notification.data?.type || 'general'
      },
      android: {
        priority: options.priority || (options.isCall ? 'high' : 'high'),
        notification: {
          channelId: options.isCall ? 'incoming_calls' : 'default',
          sound: options.isCall ? 'ringtone' : 'default',
          priority: options.isCall ? 'max' : 'high',
          visibility: 'public',
          ...(options.isCall ? {
            // Full-screen intent for incoming calls
            tag: 'incoming_call',
            sticky: true
          } : {})
        }
      }
    };

    // Send to each token individually for better error handling
    const sendPromises = deviceTokens.map(async (token) => {
      try {
        await firebaseAdmin.messaging().send({ ...message, token });
      } catch (err) {
        // Clean up invalid tokens
        if (err.code === 'messaging/registration-token-not-registered' ||
            err.code === 'messaging/invalid-registration-token') {
          await removeInvalidToken(token);
        } else {
          console.error(`FCM send error for user ${userId}:`, err.code || err.message);
        }
      }
    });

    await Promise.all(sendPromises);
  } catch (err) {
    console.error('Push notification send failed:', err.message);
  }
};

/**
 * Send message push notification
 */
const sendMessagePush = (receiverId, senderName, messageContent, senderId) => {
  const body = messageContent.length > 100
    ? messageContent.substring(0, 100) + '...'
    : messageContent;

  return sendPushToUser(receiverId, {
    title: senderName,
    body,
    data: {
      type: 'message',
      senderId: String(senderId),
      senderName
    }
  });
};

/**
 * Send call push notification (high priority for lock screen)
 */
const sendCallPush = (receiverId, callerName, callerId, isVideo, isGroup = false, groupId = null) => {
  return sendPushToUser(receiverId, {
    title: isGroup ? `Group ${isVideo ? 'Video' : 'Voice'} Call` : `Incoming ${isVideo ? 'Video' : 'Voice'} Call`,
    body: `${callerName} is calling...`,
    data: {
      type: 'incoming_call',
      callerId: String(callerId),
      callerName,
      isVideo: String(!!isVideo),
      isGroup: String(!!isGroup),
      groupId: groupId ? String(groupId) : ''
    }
  }, { isCall: true, priority: 'high' });
};

/**
 * Send general notification push
 */
const sendNotificationPush = (userId, title, body, data = {}) => {
  // Stringify all data values for FCM
  const stringData = {};
  for (const [key, val] of Object.entries(data)) {
    stringData[key] = String(val);
  }
  return sendPushToUser(userId, { title, body, data: stringData });
};

module.exports = {
  initFirebase,
  registerDeviceToken,
  unregisterDeviceToken,
  getDeviceTokens,
  sendPushToUser,
  sendMessagePush,
  sendCallPush,
  sendNotificationPush
};
