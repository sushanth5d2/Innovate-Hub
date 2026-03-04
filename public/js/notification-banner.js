/**
 * NotificationBanner — Global banner-style notifications for all pages.
 *
 * Shows iOS/Android style slide-down banners with user avatar for:
 *  - Real-time socket notifications (messages, likes, follows, etc.)
 *  - Due reminders (polled every 60s)
 *
 * Includes snooze support for reminders only (5 min default + more options).
 *
 * Usage: Include this script on any page after app.js and socket.io.
 *   <script src="/js/notification-banner.js"></script>
 */
(function () {
  'use strict';

  if (window.__notifBannerInit) return;
  window.__notifBannerInit = true;

  // ===== CONFIG =====
  var POLL_INTERVAL = 60000;
  var BANNER_DURATION = 5000;
  var MAX_BANNERS = 4;
  var DEDUP_WINDOW = 3000; // ms window to ignore duplicate notifications

  // ===== INJECT STYLES =====
  var style = document.createElement('style');
  style.textContent = ''
    // Container — top-center overlay
    + '.nb-container { position: fixed; top: 0; left: 0; right: 0; z-index: 99999; display: flex; flex-direction: column; align-items: center; pointer-events: none; padding: 10px 12px; gap: 8px; }'
    // Banner card
    + '.nb-banner { pointer-events: auto; width: 100%; max-width: 400px; background: var(--ig-primary-background, #1a1a2e); border: 1px solid var(--ig-border, #333); border-radius: 18px; box-shadow: 0 8px 32px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.2); padding: 12px 14px; display: flex; align-items: center; gap: 10px; animation: nb-slideDown 0.35s cubic-bezier(0.22,1,0.36,1); transition: opacity 0.3s, transform 0.3s; position: relative; overflow: hidden; cursor: pointer; }'
    + '.nb-banner.nb-exit { opacity: 0; transform: translateY(-30px) scale(0.95); pointer-events: none; }'
    // Accent bar at top
    + '.nb-accent { position: absolute; top: 0; left: 0; right: 0; height: 3px; border-radius: 18px 18px 0 0; }'
    // Progress bar (auto-dismiss countdown)
    + '.nb-progress { position: absolute; bottom: 0; left: 0; height: 2px; border-radius: 0 0 18px 18px; animation: nb-shrink linear forwards; }'
    + '@keyframes nb-shrink { from { width: 100%; } to { width: 0%; } }'
    // Avatar
    + '.nb-avatar { width: 44px; height: 44px; border-radius: 50%; flex-shrink: 0; object-fit: cover; border: 2px solid var(--ig-border, #444); background: var(--ig-secondary-background, #262626); }'
    + '.nb-avatar-fallback { width: 44px; height: 44px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 20px; border: 2px solid var(--ig-border, #444); }'
    // Body
    + '.nb-body { flex: 1; min-width: 0; }'
    + '.nb-header { display: flex; align-items: center; gap: 6px; margin-bottom: 2px; }'
    + '.nb-username { font-size: 13px; font-weight: 700; color: var(--ig-primary-text, #fff); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px; }'
    + '.nb-type-badge { font-size: 10px; font-weight: 600; padding: 1px 7px; border-radius: 10px; color: #fff; white-space: nowrap; text-transform: uppercase; letter-spacing: 0.3px; }'
    + '.nb-time { font-size: 10px; color: var(--ig-secondary-text, #888); margin-left: auto; white-space: nowrap; }'
    + '.nb-content { font-size: 13px; color: var(--ig-secondary-text, #bbb); line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }'
    // Actions row (for reminders)
    + '.nb-actions { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; align-items: center; }'
    + '.nb-action-btn { padding: 5px 12px; border-radius: 10px; border: none; font-size: 11px; font-weight: 700; cursor: pointer; transition: all 0.15s; display: inline-flex; align-items: center; gap: 4px; }'
    + '.nb-action-btn:hover { opacity: 0.88; transform: translateY(-1px); }'
    + '.nb-action-primary { background: var(--ig-blue, #0095f6); color: #fff; }'
    + '.nb-action-secondary { background: var(--ig-secondary-background, #262626); color: var(--ig-primary-text, #fff); border: 1px solid var(--ig-border, #333); }'
    + '.nb-action-snooze { background: rgba(255,107,107,0.15); color: #ff6b6b; border: 1px solid rgba(255,107,107,0.25); }'
    + '.nb-action-snooze:hover { background: rgba(255,107,107,0.25); }'
    + '.nb-action-more { background: none; border: none; color: var(--ig-secondary-text, #888); font-size: 10px; padding: 3px 6px; cursor: pointer; text-decoration: underline; }'
    // Dismiss X
    + '.nb-dismiss { position: absolute; top: 8px; right: 10px; background: none; border: none; color: var(--ig-secondary-text, #666); font-size: 16px; cursor: pointer; padding: 0; line-height: 1; transition: color 0.15s; z-index: 2; }'
    + '.nb-dismiss:hover { color: var(--ig-primary-text, #fff); }'
    // Slide animation
    + '@keyframes nb-slideDown { from { opacity: 0; transform: translateY(-40px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }'
    // Snooze dropdown
    + '.nb-snooze-menu { background: var(--ig-primary-background, #1a1a2e); border: 1px solid var(--ig-border, #333); border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.35); padding: 6px 0; margin-top: 6px; animation: nb-menuIn 0.2s ease; }'
    + '@keyframes nb-menuIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }'
    + '.nb-snooze-opt { display: flex; align-items: center; gap: 8px; width: 100%; padding: 9px 14px; background: none; border: none; color: var(--ig-primary-text, #fff); font-size: 12px; font-weight: 500; text-align: left; cursor: pointer; transition: background 0.15s; }'
    + '.nb-snooze-opt:hover { background: var(--ig-hover, rgba(255,255,255,0.06)); }';
  document.head.appendChild(style);

  // ===== CREATE CONTAINER =====
  var container = document.createElement('div');
  container.className = 'nb-container';
  document.body.appendChild(container);

  var activeBanners = [];
  var shownReminderIds = new Set();
  // Dedup: track recently shown notifications by a hash
  var recentNotifHashes = {};

  function notifHash(notif) {
    return (notif.type || '') + ':' + (notif.created_by || notif.sender_id || '') + ':' + (notif.content || '').substring(0, 40);
  }

  function isDuplicate(notif) {
    var h = notifHash(notif);
    var now = Date.now();
    if (recentNotifHashes[h] && (now - recentNotifHashes[h]) < DEDUP_WINDOW) {
      return true;
    }
    recentNotifHashes[h] = now;
    // Clean old entries periodically
    for (var k in recentNotifHashes) {
      if (now - recentNotifHashes[k] > DEDUP_WINDOW * 2) delete recentNotifHashes[k];
    }
    return false;
  }

  // ===== BANNER TYPES =====
  var typeConfig = {
    mention:          { icon: '@',  bg: '#0095f6', label: 'Mention' },
    like:             { icon: '\u2764\uFE0F', bg: '#ed4956', label: 'Like' },
    comment:          { icon: '\uD83D\uDCAC', bg: '#833ab4', label: 'Comment' },
    follow:           { icon: '\uD83D\uDC64', bg: '#5851db', label: 'Follow' },
    follow_request:   { icon: '\uD83D\uDC64', bg: '#5851db', label: 'Request' },
    follow_accepted:  { icon: '\u2705', bg: '#50c878', label: 'Accepted' },
    message:          { icon: '\u2709\uFE0F', bg: '#0095f6', label: 'Message' },
    reminder:         { icon: '\u23F0', bg: '#ff6b6b', label: 'Reminder' },
    post_reminder:    { icon: '\uD83D\uDCCC', bg: '#ee5a24', label: 'Reminder' },
    community_invite: { icon: '\uD83C\uDFD8\uFE0F', bg: '#833ab4', label: 'Community' },
    join_request:     { icon: '\uD83C\uDFD8\uFE0F', bg: '#833ab4', label: 'Community' },
    event_invite:     { icon: '\uD83D\uDCC5', bg: '#f77737', label: 'Event' },
    community_group:  { icon: '\uD83D\uDC65', bg: '#833ab4', label: 'Group' },
    announcement:     { icon: '\uD83D\uDCE2', bg: '#f77737', label: 'Announce' },
    default:          { icon: '\uD83D\uDD14', bg: '#0095f6', label: 'Notification' }
  };

  // ===== SHOW BANNER =====
  function showBanner(opts) {
    // opts: { type, title, message, onClick, actions[], reminderId, duration, profilePic, username }
    var conf = typeConfig[opts.type] || typeConfig['default'];
    var banner = document.createElement('div');
    banner.className = 'nb-banner';

    // Accent bar
    var accent = document.createElement('div');
    accent.className = 'nb-accent';
    accent.style.background = conf.bg;
    banner.appendChild(accent);

    // Avatar or fallback icon
    var avatarEl;
    if (opts.profilePic) {
      avatarEl = document.createElement('img');
      avatarEl.className = 'nb-avatar';
      avatarEl.src = opts.profilePic;
      avatarEl.alt = opts.username || '';
      avatarEl.onerror = function () {
        var fb = document.createElement('div');
        fb.className = 'nb-avatar-fallback';
        fb.style.background = conf.bg + '22';
        fb.style.color = conf.bg;
        fb.textContent = conf.icon;
        avatarEl.replaceWith(fb);
      };
    } else {
      avatarEl = document.createElement('div');
      avatarEl.className = 'nb-avatar-fallback';
      avatarEl.style.background = conf.bg + '22';
      avatarEl.style.color = conf.bg;
      avatarEl.textContent = conf.icon;
    }
    banner.appendChild(avatarEl);

    // Body
    var body = document.createElement('div');
    body.className = 'nb-body';

    // Header row: username + type badge + time
    var header = document.createElement('div');
    header.className = 'nb-header';

    if (opts.username) {
      var uname = document.createElement('span');
      uname.className = 'nb-username';
      uname.textContent = opts.username;
      header.appendChild(uname);
    }

    var badge = document.createElement('span');
    badge.className = 'nb-type-badge';
    badge.style.background = conf.bg;
    badge.textContent = conf.label;
    header.appendChild(badge);

    var timeEl = document.createElement('span');
    timeEl.className = 'nb-time';
    timeEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    header.appendChild(timeEl);

    body.appendChild(header);

    // Content line
    var contentLine = document.createElement('div');
    contentLine.className = 'nb-content';
    if (opts.username && opts.message) {
      contentLine.textContent = opts.message;
    } else if (opts.title && opts.message) {
      contentLine.textContent = opts.title + ': ' + opts.message;
    } else {
      contentLine.textContent = opts.title || opts.message || '';
    }
    body.appendChild(contentLine);

    // Actions slot (for reminders)
    var actionsSlot = document.createElement('div');
    actionsSlot.className = 'nb-banner-actions-slot';
    body.appendChild(actionsSlot);

    banner.appendChild(body);

    // Dismiss button
    var dismissBtn = document.createElement('button');
    dismissBtn.className = 'nb-dismiss';
    dismissBtn.title = 'Dismiss';
    dismissBtn.innerHTML = '&times;';
    dismissBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      removeBanner(banner);
    });
    banner.appendChild(dismissBtn);

    // Click handler (navigation)
    if (opts.onClick) {
      banner.addEventListener('click', function (e) {
        if (e.target.closest('.nb-action-btn, .nb-action-more, .nb-dismiss, .nb-snooze-menu, .nb-snooze-opt')) return;
        opts.onClick();
        removeBanner(banner);
      });
    }

    // Actions (for reminders)
    if (opts.actions && opts.actions.length > 0) {
      var actionsDiv = document.createElement('div');
      actionsDiv.className = 'nb-actions';
      opts.actions.forEach(function (action) {
        var btn = document.createElement('button');
        btn.className = 'nb-action-btn ' + (action.cls || 'nb-action-primary');
        btn.innerHTML = (action.icon ? action.icon + ' ' : '') + action.label;
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          if (action.onClick) action.onClick(banner, btn);
        });
        actionsDiv.appendChild(btn);
      });
      actionsSlot.appendChild(actionsDiv);
    }

    // Limit banners
    while (activeBanners.length >= MAX_BANNERS) {
      removeBanner(activeBanners[0]);
    }

    container.appendChild(banner);
    activeBanners.push(banner);

    // Auto-dismiss with progress bar (non-reminders only)
    var dur = opts.duration !== undefined ? opts.duration : BANNER_DURATION;
    if (dur > 0) {
      var progress = document.createElement('div');
      progress.className = 'nb-progress';
      progress.style.background = conf.bg;
      progress.style.animationDuration = dur + 'ms';
      banner.appendChild(progress);
      banner._timeout = setTimeout(function () {
        removeBanner(banner);
      }, dur);
    }

    return banner;
  }

  function removeBanner(banner) {
    if (!banner || !banner.parentNode) return;
    clearTimeout(banner._timeout);
    banner.classList.add('nb-exit');
    setTimeout(function () {
      if (banner.parentNode) banner.parentNode.removeChild(banner);
      var idx = activeBanners.indexOf(banner);
      if (idx > -1) activeBanners.splice(idx, 1);
    }, 300);
  }

  // ===== SNOOZE (REMINDERS ONLY) =====
  function showSnoozeMenu(banner) {
    var existing = banner.querySelector('.nb-snooze-menu');
    if (existing) { existing.remove(); return; }

    var reminderId = banner._reminderId;
    if (!reminderId) return;

    var menu = document.createElement('div');
    menu.className = 'nb-snooze-menu';
    var options = [
      { label: '15 minutes', mins: 15, icon: '\uD83D\uDD50' },
      { label: '30 minutes', mins: 30, icon: '\uD83D\uDD67' },
      { label: '1 hour', mins: 60, icon: '\uD83D\uDD50' },
      { label: '3 hours', mins: 180, icon: '\uD83D\uDD52' },
      { label: 'Tomorrow 9 AM', mins: 'tomorrow', icon: '\uD83C\uDF05' }
    ];
    options.forEach(function (opt) {
      var optBtn = document.createElement('button');
      optBtn.className = 'nb-snooze-opt';
      optBtn.innerHTML = '<span style="font-size:14px;width:18px;text-align:center;">' + opt.icon + '</span> ' + opt.label;
      optBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (opt.mins === 'tomorrow') {
          var now = new Date();
          var tomorrow9 = new Date(now);
          tomorrow9.setDate(tomorrow9.getDate() + 1);
          tomorrow9.setHours(9, 0, 0, 0);
          snoozeReminder(reminderId, Math.round((tomorrow9 - now) / 60000));
        } else {
          snoozeReminder(reminderId, opt.mins);
        }
        removeBanner(banner);
      });
      menu.appendChild(optBtn);
    });
    var slot = banner.querySelector('.nb-banner-actions-slot');
    if (slot) slot.appendChild(menu);
  }

  function snooze5Min(banner) {
    var reminderId = banner._reminderId;
    if (!reminderId) return;
    snoozeReminder(reminderId, 5);
    removeBanner(banner);
  }

  function snoozeReminder(reminderId, minutes) {
    InnovateAPI.apiRequest('/reminders/' + reminderId + '/snooze', {
      method: 'PUT',
      body: JSON.stringify({ minutes: minutes })
    }).then(function () {
      shownReminderIds.delete(reminderId);
      showBanner({
        type: 'reminder',
        title: 'Snoozed',
        message: 'Reminder will ring again in ' + (minutes >= 60 ? Math.round(minutes / 60) + ' hr' : minutes + ' min'),
        duration: 3000
      });
    }).catch(function (e) {
      console.error('Snooze failed:', e);
    });
  }

  function buildReminderActions(r) {
    return [
      {
        label: 'View',
        icon: '\uD83D\uDC41\uFE0F',
        cls: 'nb-action-primary',
        onClick: function (banner) {
          if (r.source === 'gentle_reminder' && r.source_id) {
            window.location.href = '/post/' + r.source_id;
          } else {
            window.location.href = '/notifications';
          }
          removeBanner(banner);
        }
      },
      {
        label: 'Snooze 5 min',
        icon: '\u23F0',
        cls: 'nb-action-snooze',
        onClick: function (banner) { snooze5Min(banner); }
      },
      {
        label: 'More\u2026',
        cls: 'nb-action-more',
        onClick: function (banner) { showSnoozeMenu(banner); }
      }
    ];
  }

  // ===== POLL DUE REMINDERS =====
  function checkDueReminders() {
    if (!InnovateAPI.isAuthenticated()) return;
    InnovateAPI.apiRequest('/reminders/due').then(function (data) {
      var reminders = data.reminders || [];
      reminders.forEach(function (r) {
        if (shownReminderIds.has(r.id)) return;
        shownReminderIds.add(r.id);
        InnovateAPI.apiRequest('/reminders/' + r.id + '/notified', { method: 'PUT' }).catch(function () {});
        var rType = r.source === 'gentle_reminder' ? 'post_reminder' : 'reminder';
        var banner = showBanner({
          type: rType,
          title: r.title || 'Reminder',
          message: r.description || '',
          duration: 0,
          onClick: r.source === 'gentle_reminder' && r.source_id
            ? function () { window.location.href = '/post/' + r.source_id; }
            : function () { window.location.href = '/notifications'; },
          actions: buildReminderActions(r)
        });
        if (banner) banner._reminderId = r.id;
      });
    }).catch(function () {});
  }

  // ===== SOCKET NOTIFICATIONS =====
  var _socketListening = false;
  var _retryCount = 0;
  var MAX_RETRIES = 20;

  function listenToSocket() {
    if (_socketListening) return;

    var socket = null;
    try {
      socket = InnovateAPI.getSocket ? InnovateAPI.getSocket() : null;
    } catch (e) { /* ignore */ }

    if (!socket || !socket.connected) {
      _retryCount++;
      if (_retryCount <= MAX_RETRIES) setTimeout(listenToSocket, 2000);
      return;
    }

    _socketListening = true;
    console.log('[NotificationBanner] Socket connected, listening for events');

    var user = InnovateAPI.getCurrentUser ? InnovateAPI.getCurrentUser() : null;
    if (user && user.id) {
      socket.emit('user:join', user.id);
    }

    // Listen to all notification event variants the server may emit
    ['notification:receive', 'notification:received', 'new_notification'].forEach(function (evtName) {
      socket.on(evtName, function (notif) {
        handleSocketNotification(notif);
      });
    });

    // NOTE: We do NOT listen to 'new_message' separately.
    // The server now emits notification:receive for messages too,
    // so listening to both would cause duplicate banners.

    // Reminder-specific event
    socket.on('reminder:due', function (reminder) {
      if (shownReminderIds.has(reminder.id)) return;
      shownReminderIds.add(reminder.id);
      var rType = reminder.source === 'gentle_reminder' ? 'post_reminder' : 'reminder';
      var banner = showBanner({
        type: rType,
        title: reminder.title || 'Reminder',
        message: reminder.description || '',
        profilePic: null,
        username: null,
        duration: 0,
        onClick: reminder.source === 'gentle_reminder' && reminder.source_id
          ? function () { window.location.href = '/post/' + reminder.source_id; }
          : function () { window.location.href = '/notifications'; },
        actions: buildReminderActions(reminder)
      });
      if (banner) banner._reminderId = reminder.id;
    });

    // Re-join on reconnect
    socket.on('reconnect', function () {
      console.log('[NotificationBanner] Socket reconnected');
      if (user && user.id) socket.emit('user:join', user.id);
    });
  }

  // ===== HANDLE NOTIFICATION -> BANNER =====
  function handleSocketNotification(notif) {
    if (!notif) return;

    // Dedup check - prevents duplicate banners from multiple event variants
    if (isDuplicate(notif)) return;

    var type = notif.type || 'default';
    var message = notif.content || notif.message || '';
    var title = '';
    var onClick = null;
    var profilePic = notif.profile_picture || notif.sender_picture || '';
    var username = notif.username || notif.sender_username || '';

    // Don't show own message banners
    var currentUser = InnovateAPI.getCurrentUser ? InnovateAPI.getCurrentUser() : null;
    var myId = currentUser ? (currentUser.id || currentUser.userId) : null;
    if (notif.is_own) return;
    if (type === 'message' && notif.sender_id && myId && String(notif.sender_id) === String(myId)) return;

    // Don't show message notification if user is actively viewing that conversation
    if (type === 'message' && window.location.pathname === '/messages') {
      var activeContactId = window.currentContactId;
      if (activeContactId && notif.sender_id && String(notif.sender_id) === String(activeContactId)) return;
    }

    switch (type) {
      case 'mention':
        title = 'mentioned you';
        onClick = function () { window.location.href = '/post/' + (notif.post_id || notif.related_id || ''); };
        break;

      case 'like':
        title = 'liked your post';
        message = message || 'liked your post';
        onClick = function () { window.location.href = '/post/' + (notif.post_id || notif.related_id || ''); };
        break;

      case 'comment':
      case 'reply':
        title = type === 'reply' ? 'replied to your post' : 'commented on your post';
        message = message || title;
        type = 'comment';
        onClick = function () { window.location.href = '/post/' + (notif.post_id || notif.related_id || ''); };
        break;

      case 'follow':
        title = 'started following you';
        message = message || 'started following you';
        onClick = function () { window.location.href = '/profile/' + (notif.created_by || notif.related_id || ''); };
        break;

      case 'follow_request':
        title = 'wants to follow you';
        message = message || 'requested to follow you';
        onClick = function () { window.location.href = '/notifications'; };
        break;

      case 'follow_accepted':
        title = 'accepted your request';
        message = message || 'accepted your follow request';
        onClick = function () { window.location.href = '/profile/' + (notif.created_by || notif.related_id || ''); };
        break;

      case 'message':
      case 'message_request':
        title = type === 'message_request' ? 'Message request' : 'sent a message';
        // Navigate to the specific conversation
        onClick = function () {
          var targetUser = notif.sender_id || notif.created_by || '';
          if (window.location.pathname === '/messages') {
            // Already on messages page — try to open the conversation directly
            if (typeof window.openConversation === 'function') {
              window.openConversation(targetUser);
            } else {
              window.location.href = '/messages?user=' + targetUser;
            }
          } else {
            window.location.href = '/messages?user=' + targetUser;
          }
        };
        break;

      case 'community_invite':
      case 'community_added':
        title = 'Community invitation';
        type = 'community_invite';
        onClick = function () {
          var cid = notif.communityId || notif.related_id || '';
          window.location.href = cid ? '/community?id=' + cid : '/communities';
        };
        break;

      case 'join_request':
        title = 'Join request';
        type = 'join_request';
        onClick = function () {
          var cid = notif.related_id || '';
          window.location.href = cid ? '/community?id=' + cid : '/communities';
        };
        break;

      case 'community_group':
      case 'community_group_message':
        title = 'Group message';
        type = 'community_group';
        onClick = function () {
          var cid = notif.communityId || notif.community_id || '';
          var gid = notif.groupId || notif.group_id || '';
          if (cid && gid) {
            window.location.href = '/community?id=' + cid + '&group=' + gid;
          } else if (cid) {
            window.location.href = '/community?id=' + cid;
          } else {
            window.location.href = '/communities';
          }
        };
        break;

      case 'announcement':
      case 'community_announcement':
        title = 'New announcement';
        type = 'announcement';
        onClick = function () {
          var cid = notif.communityId || notif.community_id || notif.related_id || '';
          window.location.href = cid ? '/community?id=' + cid + '&tab=announcements' : '/communities';
        };
        break;

      case 'event_invite':
        title = 'Event invitation';
        onClick = function () { window.location.href = '/events'; };
        break;

      case 'custom_button':
        title = 'Post interaction';
        onClick = function () { window.location.href = '/post/' + (notif.post_id || notif.related_id || ''); };
        break;

      case 'nearby_donation':
        title = 'Nearby Donation';
        onClick = function () { window.location.href = '/social-service'; };
        break;

      default:
        title = message || 'New notification';
        onClick = function () { window.location.href = '/notifications'; };
    }

    showBanner({
      type: type,
      title: title,
      message: message,
      profilePic: profilePic,
      username: username,
      onClick: onClick
    });
  }

  // ===== INIT =====
  var _initRetries = 0;
  var MAX_INIT_RETRIES = 10;

  function init() {
    // Retry if InnovateAPI isn't ready yet (may load async on some pages)
    if (!window.InnovateAPI || !InnovateAPI.isAuthenticated) {
      _initRetries++;
      if (_initRetries <= MAX_INIT_RETRIES) {
        setTimeout(init, 1000);
      }
      return;
    }
    // Not logged in — no banners needed
    if (!InnovateAPI.isAuthenticated()) return;

    checkDueReminders();
    setInterval(checkDueReminders, POLL_INTERVAL);
    listenToSocket();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 800); });
  } else {
    setTimeout(init, 800);
  }

  // Expose for manual use
  window.NotificationBanner = {
    show: showBanner,
    dismiss: removeBanner,
    checkReminders: checkDueReminders
  };
})();
