/**
 * Post Interactions - Shared module
 * Extracts duplicated post interaction code from home.html and profile.html
 * into a single reusable IIFE module.
 *
 * Usage (home.html):
 *   PostInteractions.init({
 *     getUser: () => user,
 *     refreshPosts: () => loadPosts(),
 *     prefix: ''
 *   });
 *
 * Usage (profile.html):
 *   PostInteractions.init({
 *     getUser: () => currentUser,
 *     refreshPosts: () => loadRecentPosts(),
 *     prefix: 'pf'
 *   });
 */
const PostInteractions = (function () {
  'use strict';

  // ======================== Configuration ========================

  let _config = {
    getUser: () => null,
    refreshPosts: () => {},
    prefix: '' // '' for home, 'pf' for profile
  };

  function init(config) {
    _config = { ..._config, ...config };
  }

  // ======================== Helpers ========================

  /**
   * Get DOM element by ID, applying the configured prefix.
   * Converts 'editPostContent' → 'pfEditPostContent' when prefix = 'pf'.
   */
  function el(id) {
    if (_config.prefix) {
      return document.getElementById(
        _config.prefix + id.charAt(0).toUpperCase() + id.slice(1)
      );
    }
    return document.getElementById(id);
  }

  /** Convenience: get the element by a raw (already-prefixed) ID. */
  function elRaw(id) {
    return document.getElementById(id);
  }

  function getUser() {
    return _config.getUser();
  }

  function refreshPosts() {
    _config.refreshPosts();
  }

  function getPrefix() {
    return _config.prefix;
  }

  // ======================== Utilities ========================

  /**
   * Format a number compactly: 1000 → 1K, 1000000 → 1M
   */
  function formatCount(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  }

  // ======================== Bottom Sheet ========================

  /**
   * Make a bottom sheet draggable (drag down to dismiss, drag up to expand).
   * Works with both touch and mouse events.
   */
  function setupBottomSheetDrag(overlayEl, closeFn) {
    var sheetEl = overlayEl.querySelector('.ig-bottom-sheet, .ig-comments-sheet');
    var handle = overlayEl.querySelector('.ig-bottom-sheet-handle, .ig-comments-sheet-handle');
    if (!sheetEl || !handle) return;

    var startY = 0, currentDelta = 0, isDragging = false;
    var DISMISS_THRESHOLD = 120;
    var EXPAND_THRESHOLD = -50;

    function isDesktop() {
      return window.innerWidth >= 768;
    }

    function onStart(clientY) {
      startY = clientY;
      currentDelta = 0;
      isDragging = true;
      sheetEl.style.transition = 'none';
    }

    function onMove(clientY) {
      if (!isDragging) return;
      currentDelta = clientY - startY;
      if (currentDelta > 0) {
        var isDesktopCentered = isDesktop();
        sheetEl.style.transform = isDesktopCentered
          ? 'translate(-50%, ' + currentDelta + 'px)'
          : 'translateY(' + currentDelta + 'px)';
      }
    }

    function getBaseTransform() {
      return isDesktop() ? 'translate(-50%, 0)' : 'translateY(0)';
    }

    function onEnd() {
      if (!isDragging) return;
      isDragging = false;
      sheetEl.style.transition = '';

      if (currentDelta > DISMISS_THRESHOLD) {
        closeFn();
      } else if (currentDelta < EXPAND_THRESHOLD) {
        sheetEl.classList.add('ig-sheet-expanded');
        sheetEl.style.transform = getBaseTransform();
      } else {
        sheetEl.style.transform = getBaseTransform();
      }
      currentDelta = 0;
    }

    // Touch events
    handle.addEventListener('touchstart', function (e) { onStart(e.touches[0].clientY); }, { passive: true });
    handle.addEventListener('touchmove', function (e) { onMove(e.touches[0].clientY); }, { passive: true });
    handle.addEventListener('touchend', function () { onEnd(); });

    // Mouse events (desktop drag)
    handle.addEventListener('mousedown', function (e) {
      e.preventDefault();
      onStart(e.clientY);
      var onMouseMove = function (ev) { onMove(ev.clientY); };
      var onMouseUp = function () {
        onEnd();
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    // Double-click handle to toggle expand
    handle.addEventListener('dblclick', function (e) {
      e.preventDefault();
      sheetEl.classList.toggle('ig-sheet-expanded');
    });
  }

  /**
   * Toggle expand/collapse for any bottom sheet (called from expand button).
   */
  function toggleSheetExpand(btn) {
    var sheetEl = btn.closest('.ig-comments-sheet, .ig-bottom-sheet');
    if (sheetEl) sheetEl.classList.toggle('ig-sheet-expanded');
  }

  // ======================== Comments System ========================

  var currentReplyTo = null;

  /**
   * Open Comments bottom sheet for a post.
   */
  async function openCommentsModal(postId) {
    try {
      var response = await InnovateAPI.apiRequest('/posts/' + postId + '/comments');
      var comments = response.comments || [];
      var postOwnerId = response.post_user_id || null;

      // Remove any existing comments sheet
      var p = getPrefix();
      var sheetId = p ? p + 'CommentsSheet' : 'commentsBottomSheet';
      var existingSheet = document.getElementById(sheetId);
      if (existingSheet) existingSheet.remove();

      var sheet = document.createElement('div');
      sheet.id = sheetId;
      sheet.className = 'ig-comments-sheet-overlay';

      var previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      var close = function () {
        document.removeEventListener('keydown', onKeyDown);
        sheet.classList.add('ig-sheet-closing');
        setTimeout(function () {
          document.body.style.overflow = previousOverflow;
          sheet.remove();
        }, 280);
      };

      var onKeyDown = function (e) {
        if (e.key === 'Escape') close();
      };
      document.addEventListener('keydown', onKeyDown);

      sheet.addEventListener('click', function (e) {
        if (e.target === sheet) close();
      });

      // Store post info for comment rendering
      window._commentsPostOwnerId = postOwnerId;
      window._commentsPostId = postId;

      var user = getUser();
      var userAvatar = user
        ? InnovateAPI.getUserAvatar(user.profile_picture)
        : '/img/default-avatar.png';

      var inputId = p ? p + 'ModalCommentInput' : 'modalCommentInput';
      var replyInfoId = p ? p + 'CommentReplyInfo' : 'commentReplyInfo';
      var replyUsernameId = p ? p + 'ReplyToUsername' : 'replyToUsername';
      var mentionDropdownId = p ? p + 'MentionDropdown' : 'mentionDropdown';
      var containerId = p ? p + 'CommentsListContainer' : 'commentsListContainer';

      sheet.innerHTML =
        '<div class="ig-comments-sheet">' +
        '<div class="ig-comments-sheet-handle"><div class="ig-sheet-drag-indicator"></div></div>' +
        '<div class="ig-comments-sheet-header">' +
        '<span class="ig-comments-sheet-title">Comments</span>' +
        '<button class="ig-sheet-expand-btn" onclick="toggleSheetExpand(this)" title="Expand">' +
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>' +
        '</button></div>' +
        '<div class="ig-comments-sheet-body" id="' + containerId + '">' +
        (comments.length
          ? renderCommentsThreaded(comments, postId, postOwnerId)
          : '<div class="ig-comments-empty"><div style="font-size: 28px; margin-bottom: 8px;">💬</div>No comments yet. Be the first!</div>') +
        '</div>' +
        '<div id="' + replyInfoId + '" class="ig-comments-reply-info" style="display:none;">' +
        '<span>Replying to <strong id="' + replyUsernameId + '"></strong></span>' +
        '<button onclick="cancelReply()" style="background:none;border:none;color:var(--ig-secondary-text);cursor:pointer;font-size:16px;padding:4px 8px;">✕</button>' +
        '</div>' +
        '<div class="ig-comments-sheet-input">' +
        '<img src="' + userAvatar + '" class="ig-comments-input-avatar">' +
        '<div style="flex: 1; position: relative;">' +
        '<input type="text" id="' + inputId + '" placeholder="Add a comment..."' +
        ' class="ig-comments-input-field"' +
        ' onkeydown="if(event.key===\'Enter\')submitModalComment(' + postId + ')"' +
        ' oninput="handleCommentMention(this)">' +
        '<div id="' + mentionDropdownId + '" class="ig-mention-dropdown"></div>' +
        '</div>' +
        '<button onclick="submitModalComment(' + postId + ')" class="ig-comments-post-btn">Post</button>' +
        '</div></div>';

      document.body.appendChild(sheet);

      // Animate in
      requestAnimationFrame(function () {
        sheet.classList.add('ig-sheet-open');
      });

      // Setup drag to close/expand
      setupBottomSheetDrag(sheet, close);

      // Close any open comment menus when clicking inside sheet
      sheet.addEventListener('click', function (e) {
        if (!e.target.closest('.ig-comment-actions-menu') && !e.target.closest('.ig-comment-more-btn')) {
          document.querySelectorAll('.comment-3dot-menu').forEach(function (m) {
            m.classList.remove('ig-menu-visible');
          });
        }
      });

      // Focus the input
      setTimeout(function () {
        var inp = document.getElementById(inputId);
        if (inp) inp.focus();
      }, 350);
    } catch (error) {
      InnovateAPI.showAlert('Failed to load comments', 'error');
    }
  }

  /**
   * Render comments in threaded (Instagram-style) layout.
   */
  function renderCommentsThreaded(comments, postId, postOwnerId) {
    // Build a lookup of all comment IDs for resolving root parents
    var commentById = {};
    comments.forEach(function (c) { commentById[c.id] = c; });

    var topLevel = comments.filter(function (c) { return !c.parent_id; });
    var topLevelIds = {};
    topLevel.forEach(function (c) { topLevelIds[c.id] = true; });

    // Flatten all replies under the root top-level comment (Instagram-style)
    var repliesMap = {};
    comments.filter(function (c) { return c.parent_id; }).forEach(function (c) {
      var rootId = c.parent_id;
      if (!topLevelIds[rootId]) {
        var parent = commentById[rootId];
        if (parent && parent.parent_id) rootId = parent.parent_id;
      }
      if (!repliesMap[rootId]) repliesMap[rootId] = [];
      repliesMap[rootId].push(c);
    });

    var p = getPrefix();
    var hiddenRepliesPrefix = p ? p + '-hidden-replies-' : 'hidden-replies-';

    var html = '';
    topLevel.forEach(function (c) {
      html += renderCommentItem(c, postId, postOwnerId, false);
      var replies = repliesMap[c.id] || [];
      if (replies.length > 0) {
        html += '<div class="ig-comment-replies-thread" data-parent-id="' + c.id + '">';
        if (replies.length > 1) {
          html += '<button onclick="toggleReplies(' + c.id + ')" class="ig-comment-view-replies-btn" data-toggle-replies="' + c.id + '">' +
            '<span class="ig-comment-replies-line"></span>' +
            'View ' + (replies.length - 1) + ' more ' + (replies.length - 1 === 1 ? 'reply' : 'replies') +
            '</button>';
          html += '<div class="ig-comment-hidden-replies" id="' + hiddenRepliesPrefix + c.id + '">';
          replies.slice(0, -1).forEach(function (r) {
            html += renderCommentItem(r, postId, postOwnerId, true);
          });
          html += '</div>';
          // Latest reply always visible
          html += renderCommentItem(replies[replies.length - 1], postId, postOwnerId, true);
        } else {
          html += renderCommentItem(replies[0], postId, postOwnerId, true);
        }
        html += '</div>';
      }
    });
    return html;
  }

  /**
   * Render a single comment item (HTML string).
   */
  function renderCommentItem(c, postId, postOwnerId, isReply) {
    var user = getUser();
    var userId = user ? user.id : null;
    var isOwn = c.user_id === userId;
    var isPostOwner = userId === postOwnerId;
    var canDelete = isOwn || isPostOwner;
    var timeAgo = (typeof InnovateAPI !== 'undefined' && InnovateAPI.formatDate)
      ? InnovateAPI.formatDate(c.created_at)
      : '';
    var contentWithMentions = (c.content || '').replace(
      /@(\w+)/g,
      '<a href="/profile/$1" class="ig-comment-mention">@$1</a>'
    );
    var likesCount = c.likes_count || 0;
    var hasLiked = c.user_has_liked > 0;
    var avatar = InnovateAPI.getUserAvatar(c.profile_picture);

    var p = getPrefix();
    var menuId = p ? p + '-comment-menu-' + c.id : 'comment-menu-' + c.id;

    return '<div class="ig-comment-row ' + (isReply ? 'ig-comment-reply' : '') + '" data-comment-id="' + c.id + '">' +
      '<a href="/profile/' + c.user_id + '" class="ig-comment-avatar-link">' +
      '<img src="' + avatar + '" alt="' + c.username + '" class="ig-comment-avatar ' + (isReply ? 'ig-comment-avatar-sm' : '') + '">' +
      '</a>' +
      '<div class="ig-comment-body">' +
      '<div class="ig-comment-text">' +
      '<a href="/profile/' + c.user_id + '" class="ig-comment-username">' + c.username + '</a>' +
      '<span class="ig-comment-content">' + contentWithMentions + '</span>' +
      '</div>' +
      '<div class="ig-comment-meta">' +
      '<span class="ig-comment-time">' + timeAgo + '</span>' +
      (likesCount > 0
        ? '<button class="ig-comment-meta-btn" onclick="showWhoLikedComment(' + c.id + ')">' + likesCount + ' ' + (likesCount === 1 ? 'like' : 'likes') + '</button>'
        : '') +
      '<button class="ig-comment-meta-btn" onclick="replyToComment(' + c.id + ', \'' + c.username + '\', ' + postId + ')">Reply</button>' +
      '<button class="ig-comment-meta-btn ig-comment-more-btn" onclick="event.stopPropagation(); toggleCommentMenu(' + c.id + ')">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="4" cy="12" r="2.5"/><circle cx="12" cy="12" r="2.5"/><circle cx="20" cy="12" r="2.5"/></svg>' +
      '</button>' +
      '</div>' +
      '<div class="comment-3dot-menu ig-comment-actions-menu" id="' + menuId + '">' +
      (canDelete
        ? '<button onclick="deleteComment(' + postId + ', ' + c.id + ', this)" class="ig-comment-action-item ig-comment-action-danger">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>' +
          'Delete</button>'
        : '') +
      '<button onclick="reportComment(' + c.id + ')" class="ig-comment-action-item">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z"/></svg>' +
      'Report</button>' +
      '</div>' +
      '</div>' +
      '<button class="ig-comment-like-btn ' + (hasLiked ? 'ig-comment-liked' : '') + '" onclick="likeComment(' + c.id + ', this, ' + postId + ')" data-comment-id="' + c.id + '">' +
      '<svg viewBox="0 0 24 24" width="14" height="14">' +
      '<path d="M16.792 3.904A4.989 4.989 0 0 1 21.5 9.122c0 3.072-2.652 4.959-5.197 7.222-2.512 2.243-3.865 3.469-4.303 3.752-.477-.309-2.143-1.823-4.303-3.752C5.141 14.072 2.5 12.167 2.5 9.122a4.989 4.989 0 0 1 4.708-5.218 4.21 4.21 0 0 1 3.675 1.941c.84 1.175.98 1.763 1.12 1.763s.278-.588 1.11-1.766a4.17 4.17 0 0 1 3.679-1.938Z"/>' +
      '</svg>' +
      '</button>' +
      '</div>';
  }

  /**
   * Toggle show/hide reply thread.
   */
  function toggleReplies(parentId) {
    var p = getPrefix();
    var hiddenId = p ? p + '-hidden-replies-' + parentId : 'hidden-replies-' + parentId;
    var hidden = document.getElementById(hiddenId);
    var btn = document.querySelector('[data-toggle-replies="' + parentId + '"]');
    if (hidden && btn) {
      var isHidden = !hidden.classList.contains('ig-replies-visible');
      if (isHidden) {
        hidden.classList.add('ig-replies-visible');
        btn.innerHTML = '<span class="ig-comment-replies-line"></span> Hide replies';
      } else {
        hidden.classList.remove('ig-replies-visible');
        var count = hidden.querySelectorAll('.ig-comment-row').length;
        btn.innerHTML = '<span class="ig-comment-replies-line"></span> View ' + count + ' more ' + (count === 1 ? 'reply' : 'replies');
      }
    }
  }

  /**
   * Toggle 3-dot comment action menu.
   */
  function toggleCommentMenu(commentId) {
    var p = getPrefix();
    var menuId = p ? p + '-comment-menu-' + commentId : 'comment-menu-' + commentId;
    document.querySelectorAll('.comment-3dot-menu').forEach(function (m) {
      if (m.id !== menuId) m.classList.remove('ig-menu-visible');
    });
    var menu = document.getElementById(menuId);
    if (menu) menu.classList.toggle('ig-menu-visible');
  }

  /**
   * Like / unlike a comment.
   */
  async function likeComment(commentId, btn, postId) {
    try {
      var res = await InnovateAPI.apiRequest('/posts/' + postId + '/comments/' + commentId + '/like', { method: 'POST' });
      if (res.liked) {
        btn.classList.add('ig-comment-liked');
      } else {
        btn.classList.remove('ig-comment-liked');
      }
      // Update likes count in the meta area
      var commentRow = btn.closest('.ig-comment-row');
      if (commentRow) {
        var meta = commentRow.querySelector('.ig-comment-meta');
        var existingLikeCount = meta.querySelector('.ig-comment-likes-count-btn');
        if (res.likes_count > 0) {
          if (existingLikeCount) {
            existingLikeCount.textContent = res.likes_count + ' ' + (res.likes_count === 1 ? 'like' : 'likes');
          } else {
            var timeEl = meta.querySelector('.ig-comment-time');
            if (timeEl) {
              var likeBtn = document.createElement('button');
              likeBtn.className = 'ig-comment-meta-btn ig-comment-likes-count-btn';
              likeBtn.textContent = res.likes_count + ' ' + (res.likes_count === 1 ? 'like' : 'likes');
              likeBtn.onclick = function () { showWhoLikedComment(commentId); };
              timeEl.after(likeBtn);
            }
          }
        } else if (existingLikeCount) {
          existingLikeCount.remove();
        }
      }
    } catch (err) {
      InnovateAPI.showAlert('Failed to like comment', 'error');
    }
  }

  /**
   * Show who liked a comment.
   */
  function showWhoLikedComment(commentId) {
    InnovateAPI.showAlert('Comment liked!', 'info');
  }

  /**
   * Report a comment.
   */
  function reportComment(commentId) {
    document.querySelectorAll('.comment-3dot-menu').forEach(function (m) {
      m.classList.remove('ig-menu-visible');
    });
    InnovateAPI.showAlert('Comment reported. We will review it.', 'success');
  }

  /**
   * Set up reply to a comment.
   */
  function replyToComment(commentId, username, postId) {
    currentReplyTo = { commentId: commentId, username: username, postId: postId };
    var p = getPrefix();
    var replyInfoId = p ? p + 'CommentReplyInfo' : 'commentReplyInfo';
    var replyUsernameId = p ? p + 'ReplyToUsername' : 'replyToUsername';
    var inputId = p ? p + 'ModalCommentInput' : 'modalCommentInput';

    var replyInfo = document.getElementById(replyInfoId);
    var replyUser = document.getElementById(replyUsernameId);
    if (replyInfo && replyUser) {
      replyInfo.style.display = 'flex';
      replyUser.textContent = '@' + username;
    }
    var input = document.getElementById(inputId);
    if (input) {
      input.value = '@' + username + ' ';
      input.focus();
    }
  }

  /**
   * Cancel reply mode.
   */
  function cancelReply() {
    currentReplyTo = null;
    var p = getPrefix();
    var replyInfoId = p ? p + 'CommentReplyInfo' : 'commentReplyInfo';
    var inputId = p ? p + 'ModalCommentInput' : 'modalCommentInput';

    var replyInfo = document.getElementById(replyInfoId);
    if (replyInfo) replyInfo.style.display = 'none';
    var input = document.getElementById(inputId);
    if (input) input.value = '';
  }

  /**
   * Delete a comment.
   */
  async function deleteComment(postId, commentId, btn) {
    if (!confirm('Delete this comment?')) {
      var menu = btn.closest('.comment-3dot-menu');
      if (menu) menu.classList.remove('ig-menu-visible');
      return;
    }
    try {
      await InnovateAPI.apiRequest('/posts/' + postId + '/comments/' + commentId, { method: 'DELETE' });
      var commentEl = btn.closest('[data-comment-id]');
      if (commentEl) commentEl.remove();
      InnovateAPI.showAlert('Comment deleted', 'success');
      refreshPosts(); // Refresh comment count
    } catch (err) {
      InnovateAPI.showAlert('Failed to delete comment', 'error');
    }
  }

  var mentionSearchTimeout = null;

  /**
   * Handle @mention autocomplete in comment input.
   */
  async function handleCommentMention(input) {
    var val = input.value;
    var cursorPos = input.selectionStart;
    var textBeforeCursor = val.substring(0, cursorPos);
    var mentionMatch = textBeforeCursor.match(/@(\w*)$/);

    var p = getPrefix();
    var dropdownId = p ? p + 'MentionDropdown' : 'mentionDropdown';
    var dropdown = document.getElementById(dropdownId);

    if (!mentionMatch || mentionMatch[1].length < 1) {
      if (dropdown) dropdown.style.display = 'none';
      return;
    }

    var query = mentionMatch[1];
    clearTimeout(mentionSearchTimeout);
    mentionSearchTimeout = setTimeout(async function () {
      try {
        var res = await InnovateAPI.apiRequest('/users/search/query?q=' + encodeURIComponent(query));
        var users = res.users || [];

        if (users.length === 0) {
          dropdown.style.display = 'none';
          return;
        }

        dropdown.style.display = 'block';
        dropdown.innerHTML = users.map(function (u) {
          return '<div onclick="insertMention(\'' + u.username + '\')" style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;transition:background 0.2s;" onmouseover="this.style.background=\'var(--ig-border)\'" onmouseout="this.style.background=\'\'">' +
            '<img src="' + InnovateAPI.getUserAvatar(u.profile_picture) + '" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">' +
            '<div>' +
            '<div style="font-weight:600;font-size:13px;">' + u.username + '</div>' +
            (u.bio ? '<div style="font-size:11px;color:var(--ig-secondary-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;">' + u.bio + '</div>' : '') +
            '</div></div>';
        }).join('');
      } catch (err) {
        if (dropdown) dropdown.style.display = 'none';
      }
    }, 300);
  }

  /**
   * Insert @mention into comment input.
   */
  function insertMention(username) {
    var p = getPrefix();
    var inputId = p ? p + 'ModalCommentInput' : 'modalCommentInput';
    var input = document.getElementById(inputId);
    if (!input) return;
    var val = input.value;
    var cursorPos = input.selectionStart;
    var textBeforeCursor = val.substring(0, cursorPos);
    var textAfterCursor = val.substring(cursorPos);
    var newBefore = textBeforeCursor.replace(/@\w*$/, '@' + username + ' ');
    input.value = newBefore + textAfterCursor;
    input.focus();
    input.selectionStart = input.selectionEnd = newBefore.length;
    var dropdownId = p ? p + 'MentionDropdown' : 'mentionDropdown';
    var dropdown = document.getElementById(dropdownId);
    if (dropdown) dropdown.style.display = 'none';
  }

  /**
   * Submit a comment from modal.
   */
  async function submitModalComment(postId) {
    var p = getPrefix();
    var inputId = p ? p + 'ModalCommentInput' : 'modalCommentInput';
    var input = document.getElementById(inputId);
    if (!input) return;
    var content = input.value.trim();
    if (!content) return;

    try {
      var endpoint = '/posts/' + postId + '/comments';

      if (currentReplyTo && currentReplyTo.commentId) {
        endpoint = '/posts/' + postId + '/comments/' + currentReplyTo.commentId + '/reply';
      }

      await InnovateAPI.apiRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify({ content: content })
      });

      // Handle @mentions - send notifications
      var mentions = content.match(/@(\w+)/g);
      if (mentions) {
        for (var i = 0; i < mentions.length; i++) {
          var mentionUsername = mentions[i].substring(1);
          try {
            await InnovateAPI.apiRequest('/posts/' + postId + '/mention', {
              method: 'POST',
              body: JSON.stringify({ mentioned_username: mentionUsername })
            });
          } catch (e) { /* ignore mention errors */ }
        }
      }

      input.value = '';
      cancelReply();

      // Reload comments
      var commentsRes = await InnovateAPI.apiRequest('/posts/' + postId + '/comments');
      var containerId = p ? p + 'CommentsListContainer' : 'commentsListContainer';
      var container = document.getElementById(containerId);
      var postOwnerId = commentsRes.post_user_id || window._commentsPostOwnerId;
      if (container && commentsRes.comments) {
        container.innerHTML = commentsRes.comments.length
          ? renderCommentsThreaded(commentsRes.comments, postId, postOwnerId)
          : '<div class="ig-comments-empty"><div style="font-size: 28px; margin-bottom: 8px;">💬</div>No comments yet. Be the first!</div>';
      }

      refreshPosts(); // Refresh comment count
    } catch (err) {
      InnovateAPI.showAlert('Failed to post comment', 'error');
    }
  }

  // ======================== Likes ========================

  /**
   * Show who liked a post (bottom sheet).
   */
  async function showWhoLiked(postId) {
    try {
      var response = await InnovateAPI.apiRequest('/posts/' + postId + '/likes');

      if (!response.likes || response.likes.length === 0) {
        InnovateAPI.showAlert('No likes yet', 'info');
        return;
      }

      var p = getPrefix();
      var sheetId = p ? p + 'LikesSheet' : 'likesBottomSheet';
      var existing = document.getElementById(sheetId);
      if (existing) existing.remove();

      var sheet = document.createElement('div');
      sheet.id = sheetId;
      sheet.className = 'ig-bottom-sheet-overlay';

      var previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      var close = function () {
        document.removeEventListener('keydown', onKeyDown);
        sheet.classList.add('ig-sheet-closing');
        setTimeout(function () {
          document.body.style.overflow = previousOverflow;
          sheet.remove();
        }, 280);
      };
      var onKeyDown = function (e) { if (e.key === 'Escape') close(); };
      document.addEventListener('keydown', onKeyDown);
      sheet.addEventListener('click', function (e) { if (e.target === sheet) close(); });

      var user = getUser();
      var currentUserId = user ? user.id : null;

      sheet.innerHTML =
        '<div class="ig-bottom-sheet">' +
        '<div class="ig-bottom-sheet-handle"><div class="ig-sheet-drag-indicator"></div></div>' +
        '<div class="ig-bottom-sheet-header">' +
        '<span class="ig-bottom-sheet-title">Likes</span>' +
        '<button class="ig-sheet-expand-btn" onclick="toggleSheetExpand(this)" title="Expand">' +
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>' +
        '</button></div>' +
        '<div class="ig-bottom-sheet-body">' +
        response.likes.map(function (u) {
          return '<div class="ig-likes-user-row">' +
            '<a href="/profile/' + u.user_id + '" class="ig-likes-avatar-link">' +
            '<img src="' + InnovateAPI.getUserAvatar(u.profile_picture) + '" alt="' + u.username + '" class="ig-likes-avatar">' +
            '</a>' +
            '<a href="/profile/' + u.user_id + '" class="ig-likes-user-info">' +
            '<div class="ig-likes-username">' + u.username + '</div>' +
            (u.bio ? '<div class="ig-likes-bio">' + u.bio + '</div>' : '') +
            '</a>' +
            (u.user_id !== currentUserId
              ? '<button onclick="followFromLikes(' + u.user_id + ', this)" class="ig-likes-follow-btn">Follow</button>'
              : '') +
            '</div>';
        }).join('') +
        '</div></div>';

      document.body.appendChild(sheet);
      setupBottomSheetDrag(sheet, close);
      requestAnimationFrame(function () { sheet.classList.add('ig-sheet-open'); });
    } catch (error) {
      InnovateAPI.showAlert('Failed to load likes', 'error');
    }
  }

  /**
   * Follow user from likes modal.
   */
  async function followFromLikes(userId, btn) {
    try {
      await InnovateAPI.apiRequest('/users/' + userId + '/follow', { method: 'POST' });
      btn.textContent = 'Following';
      btn.style.background = 'transparent';
      btn.style.border = '1px solid var(--ig-border)';
      btn.style.color = 'var(--ig-primary-text)';
    } catch (err) {
      InnovateAPI.showAlert('Failed to follow', 'error');
    }
  }

  // ======================== Share ========================

  var shareSearchTimeout = null;

  /**
   * Open share post bottom sheet.
   */
  async function sharePost(postId) {
    var url = window.location.origin + '/post/' + postId;

    var existing = document.getElementById('shareBottomSheet');
    if (existing) existing.remove();

    var sheet = document.createElement('div');
    sheet.id = 'shareBottomSheet';
    sheet.className = 'ig-bottom-sheet-overlay';

    var previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    var close = function () {
      document.removeEventListener('keydown', onKeyDown);
      sheet.classList.add('ig-sheet-closing');
      setTimeout(function () {
        document.body.style.overflow = previousOverflow;
        sheet.remove();
      }, 280);
    };
    var onKeyDown = function (e) { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKeyDown);
    sheet.addEventListener('click', function (e) { if (e.target === sheet) close(); });

    // Fetch frequent contacts
    var suggestedUsers = [];
    try {
      var res = await InnovateAPI.apiRequest('/users/frequent/messaged');
      suggestedUsers = res.users || [];
    } catch (e) { /* no suggested users */ }

    sheet.innerHTML =
      '<div class="ig-bottom-sheet ig-share-sheet">' +
      '<div class="ig-bottom-sheet-handle"><div class="ig-sheet-drag-indicator"></div></div>' +
      '<div class="ig-bottom-sheet-header">' +
      '<span class="ig-bottom-sheet-title">Share</span>' +
      '</div>' +
      '<div class="ig-share-search">' +
      '<input type="text" id="shareSearchInput" placeholder="Search..."' +
      ' class="ig-share-search-input"' +
      ' oninput="searchShareUsers(this.value, ' + postId + ')">' +
      '</div>' +
      '<div id="shareUsersContainer" class="ig-bottom-sheet-body" style="min-height: 80px; max-height: 200px;">' +
      (suggestedUsers.length > 0
        ? '<div class="ig-share-section-label">Suggested</div>' +
          suggestedUsers.map(function (u) {
            return '<div class="ig-share-user-row">' +
              '<img src="' + InnovateAPI.getUserAvatar(u.profile_picture) + '" class="ig-share-user-avatar">' +
              '<div class="ig-share-user-info">' +
              '<div class="ig-share-username">' + u.username + '</div>' +
              (u.bio ? '<div class="ig-share-user-bio">' + u.bio + '</div>' : '') +
              '</div>' +
              '<button onclick="sendPostToUser(' + (u.user_id || u.id) + ', ' + postId + ', this)" class="ig-share-send-btn">Send</button>' +
              '</div>';
          }).join('')
        : '<div style="padding: 20px 16px; color: var(--ig-secondary-text); text-align: center; font-size: 14px;">Search for people to share with</div>') +
      '</div>' +
      '<div class="ig-share-actions">' +
      '<button onclick="copyShareLink(\'' + url + '\')" class="ig-share-action-item">' +
      '<div class="ig-share-action-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></div>' +
      '<span>Copy link</span></button>' +
      '<a href="https://wa.me/?text=' + encodeURIComponent(url) + '" target="_blank" class="ig-share-action-item">' +
      '<div class="ig-share-action-icon" style="background: #25d366;"><svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/></svg></div>' +
      '<span>WhatsApp</span></a>' +
      '<a href="https://twitter.com/intent/tweet?url=' + encodeURIComponent(url) + '" target="_blank" class="ig-share-action-item">' +
      '<div class="ig-share-action-icon" style="background: #000;"><svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg></div>' +
      '<span>X</span></a>' +
      '<a href="mailto:?body=' + encodeURIComponent(url) + '" class="ig-share-action-item">' +
      '<div class="ig-share-action-icon" style="background: #ea4335;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg></div>' +
      '<span>Email</span></a>' +
      '</div></div>';

    document.body.appendChild(sheet);
    setupBottomSheetDrag(sheet, close);
    requestAnimationFrame(function () { sheet.classList.add('ig-sheet-open'); });
  }

  /**
   * Copy share link to clipboard.
   */
  function copyShareLink(url) {
    InnovateAPI.copyToClipboard(url);
    InnovateAPI.showAlert('Link copied!', 'success');
  }

  /**
   * Search users for sharing.
   */
  async function searchShareUsers(query, postId) {
    clearTimeout(shareSearchTimeout);
    if (!query.trim()) return;
    shareSearchTimeout = setTimeout(async function () {
      try {
        var res = await InnovateAPI.apiRequest('/users/search/query?q=' + encodeURIComponent(query));
        var users = res.users || [];
        var container = document.getElementById('shareUsersContainer');
        if (!container) return;

        if (users.length === 0) {
          container.innerHTML = '<div style="padding: 20px 16px; color: var(--ig-secondary-text); text-align: center;">No users found</div>';
          return;
        }

        container.innerHTML = users.map(function (u) {
          return '<div class="ig-share-user-row">' +
            '<img src="' + InnovateAPI.getUserAvatar(u.profile_picture) + '" class="ig-share-user-avatar">' +
            '<div class="ig-share-user-info">' +
            '<div class="ig-share-username">' + u.username + '</div>' +
            (u.bio ? '<div class="ig-share-user-bio">' + u.bio + '</div>' : '') +
            '</div>' +
            '<button onclick="sendPostToUser(' + u.id + ', ' + postId + ', this)" class="ig-share-send-btn">Send</button>' +
            '</div>';
        }).join('');
      } catch (err) {
        /* ignore */
      }
    }, 300);
  }

  /**
   * Send post to user via DM.
   */
  async function sendPostToUser(userId, postId, btn) {
    try {
      var url = window.location.origin + '/post/' + postId;
      await InnovateAPI.apiRequest('/messages/send', {
        method: 'POST',
        body: JSON.stringify({
          receiver_id: userId,
          content: 'Check out this post: ' + url
        })
      });
      btn.textContent = 'Sent';
      btn.disabled = true;
      btn.style.background = 'transparent';
      btn.style.border = '1px solid var(--ig-border)';
      btn.style.color = 'var(--ig-primary-text)';
    } catch (err) {
      InnovateAPI.showAlert('Failed to send', 'error');
    }
  }

  // ======================== Post Actions Menu (3-dot) ========================

  var currentPostIdForActions = null;
  var currentPostOwnerId = null;

  /**
   * Open post actions 3-dot menu.
   */
  function openPostActionsMenu(postId, ownerId) {
    currentPostIdForActions = postId;
    currentPostOwnerId = ownerId;

    var modal = el('postActionsModal');
    var viewerActions = el('viewerActions') || el('postActionsViewer');
    var ownerActions = el('ownerActions') || el('postActionsOwner');

    var user = getUser();
    var currentUserId = user ? user.id : null;

    // Detect if this is a Creator Series (video) post
    var postEl = document.querySelector('.ig-post[data-post-id="' + postId + '"], .ig-fullscreen-post[data-post-id="' + postId + '"]');
    var isCreatorSeries = postEl ? !!postEl.querySelector('video') : !!document.querySelector('.ig-fullscreen-viewer');
    var editLabel = isCreatorSeries ? 'Edit Creator Series' : 'Edit Post';

    // Update the edit button label in owner actions
    if (ownerActions) {
      var editItem = ownerActions.querySelector('.post-action-item:first-child span');
      if (editItem) editItem.textContent = editLabel;
    }

    if (ownerId === currentUserId) {
      if (viewerActions) viewerActions.style.display = 'none';
      if (ownerActions) ownerActions.style.display = 'block';
    } else {
      if (viewerActions) viewerActions.style.display = 'block';
      if (ownerActions) ownerActions.style.display = 'none';
    }

    if (modal) modal.style.display = 'flex';
  }

  /**
   * Close post actions modal.
   */
  function closePostActionsModal(event) {
    var modalId = getPrefix() ? getPrefix() + 'PostActionsModal' : 'postActionsModal';
    if (!event || event.target.id === modalId) {
      var modal = document.getElementById(modalId);
      if (modal) modal.style.display = 'none';
    }
  }

  /**
   * Repost a post.
   */
  async function handleRepost() {
    closePostActionsModal();
    var postId = currentPostIdForActions;
    try {
      var res = await InnovateAPI.apiRequest('/posts/' + postId);
      var post = res.post || res;
      var caption = post.content || '';
      var repostCaption = '♻️ Repost from @' + (post.username || 'user') + '\n\n' + caption;

      // Build FormData for the repost
      var formData = new FormData();
      formData.append('content', repostCaption);

      // Include original images if any
      if (post.images && post.images.length > 0) {
        var imgs = Array.isArray(post.images) ? post.images : JSON.parse(post.images);
        formData.append('existing_images', JSON.stringify(imgs));
      }

      // Include video if any
      if (post.video_url) {
        formData.append('existing_video', post.video_url);
      }

      var createRes = await fetch('/posts', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + InnovateAPI.getToken() },
        body: formData
      });

      if (!createRes.ok) throw new Error('Repost failed');

      InnovateAPI.showAlert('Reposted successfully!', 'success');
      refreshPosts();
    } catch (error) {
      console.error('Repost error:', error);
      InnovateAPI.showAlert('Failed to repost', 'error');
    }
  }

  /**
   * Open gentle reminder modal.
   */
  function handleGentleReminder() {
    closePostActionsModal();
    var reminderModal = el('reminderModal');
    if (reminderModal) reminderModal.style.display = 'flex';
  }

  /**
   * Report a post.
   */
  function handleReport() {
    closePostActionsModal();
    if (confirm('Report this post for violating community guidelines?')) {
      InnovateAPI.showAlert('Thank you for your report. We will review this post.', 'success');
    }
  }

  // ======================== Edit Post Modal ========================

  var editPostData = null;
  var editNewImages = [];
  var editNewFiles = [];
  var editHasExistingPoll = false;
  var trendingHashtagsCache = null;
  var pollColors = ['#0095f6', '#e1306c', '#833ab4', '#fd1d1d', '#f77737', '#fcaf45', '#405de6', '#5851db'];

  /**
   * Open edit post modal with post data.
   */
  function handleEditPost() {
    closePostActionsModal();

    var postId = currentPostIdForActions;
    editPostData = null;
    editNewImages = [];
    editNewFiles = [];
    editHasExistingPoll = false;

    InnovateAPI.apiRequest('/posts/' + postId).then(function (response) {
      var post = response.post || response;
      editPostData = post;

      var content = post.content || '';
      var images = Array.isArray(post.images) ? post.images : (post.images ? JSON.parse(post.images) : []);
      var files = Array.isArray(post.files) ? post.files : (post.files ? JSON.parse(post.files) : []);

      // Fill caption
      el('editPostContent').value = content;
      el('editCharCount').textContent = content.length;

      // Set user info
      var user = getUser();
      if (user) {
        var avatar = el('editUserAvatar');
        var username = el('editUsername');
        if (avatar) avatar.src = user.profile_picture || '/img/default-avatar.png';
        if (username) username.textContent = user.username || 'You';
      }

      var p = getPrefix();
      var isCreatorSeries = !!post.video_url;

      // Toggle Post vs Creator Series mode in edit modal
      var postMediaSection = el('editPostMediaSection');
      var csSection = el('editCreatorSeriesSection');

      if (isCreatorSeries) {
        // === Creator Series mode ===
        if (postMediaSection) postMediaSection.style.display = 'none';
        if (csSection) csSection.style.display = '';

        // Load video with full trim/cover/audio preview
        var csVideo = el('editCreatorSeriesVideo');
        if (csVideo) {
          initEditCSPreview(csVideo, post.video_url, null);
        }

        // Clear post-mode sections
        el('editExistingMedia').innerHTML = '';
        el('editExistingFiles').innerHTML = '';
        el('editNewMedia').innerHTML = '';
      } else {
        // === Post mode ===
        if (postMediaSection) postMediaSection.style.display = '';
        if (csSection) csSection.style.display = 'none';

        // Show existing images
        var existingMedia = el('editExistingMedia');
        existingMedia.innerHTML = images.map(function (img, idx) {
          var itemId = p ? p + 'EditMedia-' + idx : 'editMedia-' + idx;
          return '<div class="media-preview-item" id="' + itemId + '">' +
            '<img src="' + img + '" alt="Image ' + (idx + 1) + '">' +
            '<button class="media-preview-remove" onclick="removeEditMedia(' + idx + ')" title="Remove">&times;</button>' +
            '</div>';
        }).join('');

        // Show existing files
        var existingFiles = el('editExistingFiles');
        existingFiles.innerHTML = files.map(function (f, idx) {
          var name = f.name || 'File';
          var size = f.size ? (f.size / 1024).toFixed(1) + ' KB' : '';
          var itemId = p ? p + 'EditFile-' + idx : 'editFile-' + idx;
          return '<div class="file-preview-item" id="' + itemId + '">' +
            '<span>📄</span>' +
            '<div style="flex: 1; min-width: 0;">' +
            '<div style="font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">' + name + '</div>' +
            (size ? '<div style="font-size: 11px; color: var(--ig-secondary-text);">' + size + '</div>' : '') +
            '</div>' +
            '<button class="file-preview-remove" onclick="removeEditFile(' + idx + ')" title="Remove">&times;</button>' +
            '</div>';
        }).join('');

        // Clear new media previews
        el('editNewMedia').innerHTML = '';
      }

      // Pre-fill poll if exists
      var pollSection = el('editPollSection');
      var pollBtn = el('editPollToggleBtn');
      var pollOptionClass = p ? 'pf-edit-poll-option' : 'edit-poll-option';
      if (post.poll) {
        editHasExistingPoll = true;
        el('editPollQuestion').value = post.poll.question || '';
        var optionsContainer = el('editPollOptions');
        var options = Array.isArray(post.poll.options) ? post.poll.options : Object.keys(post.poll.options || {});
        optionsContainer.innerHTML = options.map(function (opt, i) {
          return '<div class="cp-poll-option-row">' +
            '<span class="cp-poll-dot" style="background: ' + pollColors[i % pollColors.length] + ';"></span>' +
            '<input type="text" class="' + pollOptionClass + ' cp-input" placeholder="Option ' + (i + 1) + '" value="' + opt + '">' +
            '</div>';
        }).join('');
        if (post.poll.expires_at) {
          var dt = new Date(post.poll.expires_at);
          el('editPollExpiry').value = dt.toISOString().slice(0, 16);
        }
        pollSection.style.display = 'block';
        if (pollBtn) pollBtn.classList.add('cp-tool-active');
      } else {
        pollSection.style.display = 'none';
        if (pollBtn) pollBtn.classList.remove('cp-tool-active');
        el('editPollQuestion').value = '';
        el('editPollOptions').innerHTML =
          '<div class="cp-poll-option-row"><span class="cp-poll-dot" style="background:#0095f6;"></span><input type="text" class="' + pollOptionClass + ' cp-input" placeholder="Option 1"></div>' +
          '<div class="cp-poll-option-row"><span class="cp-poll-dot" style="background:#e1306c;"></span><input type="text" class="' + pollOptionClass + ' cp-input" placeholder="Option 2"></div>';
        el('editPollExpiry').value = '';
      }

      // Pre-fill schedule
      var scheduleSection = el('editScheduleSection');
      var scheduleBtn = el('editScheduleToggleBtn');
      if (post.scheduled_at) {
        var sdt = new Date(post.scheduled_at);
        el('editScheduleTime').value = sdt.toISOString().slice(0, 16);
        scheduleSection.style.display = 'block';
        if (scheduleBtn) scheduleBtn.classList.add('cp-tool-active');
      } else {
        el('editScheduleTime').value = '';
        scheduleSection.style.display = 'none';
        if (scheduleBtn) scheduleBtn.classList.remove('cp-tool-active');
      }

      // Pre-fill advanced options
      el('editEnableContact').checked = !!post.enable_contact;
      el('editEnableInterested').checked = !!post.enable_interested;
      el('editAdvancedOptions').style.display = 'none';

      // Pre-fill custom button data (home only — profile doesn't have CB/CDM edit)
      if (!p) {
        prefillEditCustomButton(post.custom_button);
        prefillEditCommentDM(post.comment_to_dm);
      }

      // Load trending hashtags for the edit modal
      loadEditTrendingHashtags();

      // Set modal title based on post type (Creator Series vs regular)
      var isCreatorSeries = !!post.video_url;
      var titleEl = el('editPostModal').querySelector('.cp-header-title');
      if (titleEl) titleEl.textContent = isCreatorSeries ? 'Edit Creator Series' : 'Edit Post';

      // Show modal
      el('editPostModal').style.display = 'flex';
      setTimeout(function () {
        var textarea = el('editPostContent');
        if (textarea) textarea.focus();
      }, 300);
    }).catch(function (err) {
      // Fallback: just get content from DOM
      var postEl = document.querySelector('.ig-post[data-post-id="' + postId + '"], .ig-fullscreen-post[data-post-id="' + postId + '"]');
      var content = postEl ? (postEl.querySelector('.ig-caption-text') || {}).textContent || '' : '';
      el('editPostContent').value = content;
      el('editCharCount').textContent = content.length;

      var user = getUser();
      if (user) {
        var av = el('editUserAvatar');
        var un = el('editUsername');
        if (av) av.src = user.profile_picture || '/img/default-avatar.png';
        if (un) un.textContent = user.username || 'You';
      }

      el('editExistingMedia').innerHTML = '';
      el('editExistingFiles').innerHTML = '';
      el('editNewMedia').innerHTML = '';
      el('editPollSection').style.display = 'none';
      el('editScheduleSection').style.display = 'none';
      el('editAdvancedOptions').style.display = 'none';
      el('editPostModal').style.display = 'flex';
    });
  }

  /**
   * Close edit modal.
   */
  function closeEditModal(event) {
    var p = getPrefix();
    var modalId = p ? p + 'EditPostModal' : 'editPostModal';
    if (!event || event.target.id === modalId) {
      var modal = document.getElementById(modalId);
      if (modal) modal.style.display = 'none';

      // Reset form
      el('editPostContent').value = '';
      el('editCharCount').textContent = '0';
      el('editExistingMedia').innerHTML = '';
      el('editNewMedia').innerHTML = '';
      el('editExistingFiles').innerHTML = '';
      var imgInput = el('editPostImages');
      var fileInput = el('editPostFiles');
      if (imgInput) imgInput.value = '';
      if (fileInput) fileInput.value = '';

      // Reset poll
      el('editPollSection').style.display = 'none';
      var pollBtn = el('editPollToggleBtn');
      if (pollBtn) pollBtn.classList.remove('cp-tool-active');
      el('editPollQuestion').value = '';
      el('editPollExpiry').value = '';
      var pollOptionClass = p ? 'pf-edit-poll-option' : 'edit-poll-option';
      el('editPollOptions').innerHTML =
        '<div class="cp-poll-option-row"><span class="cp-poll-dot" style="background:#0095f6;"></span><input type="text" class="' + pollOptionClass + ' cp-input" placeholder="Option 1"></div>' +
        '<div class="cp-poll-option-row"><span class="cp-poll-dot" style="background:#e1306c;"></span><input type="text" class="' + pollOptionClass + ' cp-input" placeholder="Option 2"></div>';

      // Reset schedule
      el('editScheduleSection').style.display = 'none';
      var schedBtn = el('editScheduleToggleBtn');
      if (schedBtn) schedBtn.classList.remove('cp-tool-active');
      el('editScheduleTime').value = '';

      // Reset advanced
      el('editAdvancedOptions').style.display = 'none';
      el('editEnableContact').checked = false;
      el('editEnableInterested').checked = false;

      // Reset hashtag suggestions
      el('editHashtagSuggestions').style.display = 'none';

      editPostData = null;
      editNewImages = [];
      editNewFiles = [];
      editHasExistingPoll = false;
    }
  }

  /**
   * Submit edited post.
   */
  async function submitEditPost() {
    var btn = el('editShareBtn');
    var content = el('editPostContent').value.trim();
    var editPollSection = el('editPollSection');
    var editScheduleTime = el('editScheduleTime').value;
    var enableContact = el('editEnableContact').checked;
    var enableInterested = el('editEnableInterested').checked;

    if (!content && !editNewImages.filter(Boolean).length &&
        !(editPostData && editPostData.images && editPostData.images.filter(Boolean).length) &&
        !(editPostData && editPostData.video_url)) {
      InnovateAPI.showAlert('Post must have content or media', 'error');
      return;
    }

    btn.disabled = true;
    btn.classList.add('cp-sharing');
    btn.textContent = 'Saving...';

    var formData = new FormData();
    formData.append('content', content);

    // Extract hashtags from content
    var hashtags = content.match(/#[\w]+/g);
    if (hashtags) {
      formData.append('hashtags', JSON.stringify(hashtags.map(function (h) { return h.substring(1); })));
    }

    // Send remaining existing images (not removed)
    if (editPostData && editPostData.images) {
      var kept = editPostData.images.filter(Boolean);
      formData.append('existingImages', JSON.stringify(kept));
    }

    // Send remaining existing files (not removed)
    if (editPostData && editPostData.files) {
      var keptFiles = editPostData.files.filter(Boolean);
      formData.append('existingFiles', JSON.stringify(keptFiles));
    }

    // Append new images
    editNewImages.filter(Boolean).forEach(function (file) {
      if (file.type.startsWith('video/')) {
        formData.append('video', file);
      } else {
        formData.append('images', file);
      }
    });

    // Append new files
    editNewFiles.filter(Boolean).forEach(function (file) {
      formData.append('files', file);
    });

    // Add poll data if poll section is visible
    var p = getPrefix();
    var pollOptionClass = p ? 'pf-edit-poll-option' : 'edit-poll-option';
    if (editPollSection.style.display !== 'none') {
      var pollQuestion = el('editPollQuestion').value;
      var pollOptionsSelector = p
        ? '#' + p + 'EditPollSection .' + pollOptionClass
        : '#editPollSection .edit-poll-option';
      var pollOptions = Array.from(document.querySelectorAll(pollOptionsSelector))
        .map(function (input) { return input.value; })
        .filter(function (val) { return val.trim(); });
      var pollExpiry = el('editPollExpiry').value;

      if (pollQuestion && pollOptions.length >= 2) {
        formData.append('poll_question', pollQuestion);
        formData.append('poll_options', JSON.stringify(pollOptions));
        if (pollExpiry) {
          formData.append('poll_expiry', pollExpiry);
        }
      } else if (pollQuestion || pollOptions.length > 0) {
        btn.disabled = false;
        btn.classList.remove('cp-sharing');
        btn.textContent = 'Save';
        InnovateAPI.showAlert('Poll needs a question and at least 2 options', 'error');
        return;
      }
    }

    // Add schedule time
    if (editScheduleTime) {
      formData.append('scheduled_at', editScheduleTime);
    }

    // Add action buttons
    formData.append('enable_contact', enableContact ? '1' : '0');
    formData.append('enable_interested', enableInterested ? '1' : '0');

    // Add custom button data (home only)
    if (!p) {
      var editCustomButtonData = collectEditCustomButtonData();
      if (editCustomButtonData) {
        formData.append('custom_button', JSON.stringify(editCustomButtonData));
      } else {
        formData.append('custom_button', '');
      }

      // Add comment-to-DM data (home only)
      var editCommentDMData = collectEditCommentDMData();
      if (editCommentDMData) {
        formData.append('comment_to_dm', JSON.stringify(editCommentDMData));
      } else {
        formData.append('comment_to_dm', '');
      }
    }

    try {
      await InnovateAPI.apiRequest('/posts/' + currentPostIdForActions, {
        method: 'PUT',
        body: formData,
        headers: {}
      });
      closeEditModal();
      InnovateAPI.showAlert('Post updated successfully!', 'success');
      refreshPosts();
    } catch (error) {
      InnovateAPI.showAlert(error.message || 'Failed to update post', 'error');
    } finally {
      btn.disabled = false;
      btn.classList.remove('cp-sharing');
      btn.textContent = 'Save';
    }
  }

  // --- Edit modal toggle helpers ---

  // ===== Edit Creator Series — shared trim/cover/audio state =====
  var editCsTrimStart = 0;
  var editCsTrimEnd = 1;
  var editCsCoverTime = 0;
  var editCsDuration = 0;

  function formatCSTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /** Resolve edit CS element IDs using the prefix system */
  function csEl(id) {
    var p = getPrefix();
    if (p) {
      return document.getElementById(p + 'EditCs' + id.charAt(0).toUpperCase() + id.slice(1));
    }
    return document.getElementById('editCs' + id.charAt(0).toUpperCase() + id.slice(1));
  }

  /**
   * Initialize the Creator Series edit preview with trim, cover, audio.
   * Called from handleEditPost when post.video_url exists, and from onEditCSVideoChanged.
   */
  function initEditCSPreview(videoEl, videoSrc, fileSize) {
    editCsTrimStart = 0;
    editCsTrimEnd = 1;
    editCsCoverTime = 0;

    videoEl.src = videoSrc;
    videoEl.onloadedmetadata = function() {
      editCsDuration = videoEl.duration;

      // Duration label
      var durEl = el('editCreatorSeriesDuration');
      var durText = formatCSTime(editCsDuration);
      if (fileSize) {
        var sizeMB = (fileSize / (1024 * 1024)).toFixed(1);
        durText += ' \u00B7 ' + sizeMB + 'MB';
      }
      if (durEl) durEl.textContent = durText;

      // Reset trim handles and labels
      var trimStart = csEl('trimStart');
      var trimEnd = csEl('trimEnd');
      if (trimStart) trimStart.style.left = '0px';
      if (trimEnd) trimEnd.style.right = '0px';
      var startTime = csEl('trimStartTime');
      var endTime = csEl('trimEndTime');
      var durLabel = csEl('trimDurationLabel');
      if (startTime) startTime.textContent = '0:00';
      if (endTime) endTime.textContent = formatCSTime(editCsDuration);
      if (durLabel) durLabel.textContent = 'Duration: ' + formatCSTime(editCsDuration);

      // Generate thumbnails
      generateEditCSTrimThumbnails(videoEl);
      generateEditCSCoverThumbnails(videoEl);
      updateEditCSCoverFrame(0);
    };

    videoEl.onended = function() {
      var overlay = csEl('playOverlay') || el('editCsPlayOverlay');
      if (overlay) overlay.classList.add('cr-paused');
    };

    // Setup audio controls
    var volSlider = csEl('audioVolume');
    var volLabel = csEl('volumeLabel');
    if (volSlider) {
      volSlider.value = 100;
      volSlider.oninput = function() {
        if (volLabel) volLabel.textContent = this.value + '%';
        videoEl.volume = this.value / 100;
      };
    }
    if (volLabel) volLabel.textContent = '100%';

    var muteCheck = csEl('muteAudio');
    var volSection = csEl('volumeSection');
    if (muteCheck) {
      muteCheck.checked = false;
      muteCheck.onchange = function() {
        videoEl.muted = this.checked;
        if (volSection) volSection.style.display = this.checked ? 'none' : '';
      };
    }
    if (volSection) volSection.style.display = '';

    // Audio section collapsed
    var audioOpts = csEl('audioOptions');
    var audioChevron = csEl('audioChevron');
    if (audioOpts) audioOpts.style.display = 'none';
    if (audioChevron) audioChevron.classList.remove('cr-open');
  }

  /**
   * Handle changing the video when editing a Creator Series.
   */
  function onEditCSVideoChanged(input) {
    var file = input.files && input.files[0];
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      InnovateAPI.showAlert('Please select a video file', 'error');
      return;
    }

    // Store the new video file so submitEditPost sends it
    editNewImages = [file];

    // Preview the new video with full trim/cover/audio
    var csVideo = el('editCreatorSeriesVideo');
    if (csVideo) {
      var url = URL.createObjectURL(file);
      initEditCSPreview(csVideo, url, file.size);
    }
  }

  /** Toggle play/pause on the edit Creator Series video */
  function toggleEditCSPlayback() {
    var video = el('editCreatorSeriesVideo');
    var p = getPrefix();
    var overlayId = p ? p + 'EditCsPlayOverlay' : 'editCsPlayOverlay';
    var overlay = document.getElementById(overlayId);
    if (!video) return;
    if (video.paused) {
      video.play();
      if (overlay) overlay.classList.remove('cr-paused');
    } else {
      video.pause();
      if (overlay) overlay.classList.add('cr-paused');
    }
  }

  /** Toggle audio section in edit CS */
  function toggleEditCSAudio() {
    var opts = csEl('audioOptions');
    var chevron = csEl('audioChevron');
    if (!opts) return;
    var showing = opts.style.display === 'none';
    opts.style.display = showing ? '' : 'none';
    if (chevron) chevron.classList.toggle('cr-open', showing);
  }

  /** Generate trim timeline thumbnails */
  function generateEditCSTrimThumbnails(videoEl) {
    var canvas = csEl('trimCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var numFrames = 10;
    canvas.width = canvas.offsetWidth * 2;
    canvas.height = 96;
    var fw = canvas.width / numFrames;
    var fh = canvas.height;
    var framesLoaded = 0;

    var tempVideo = document.createElement('video');
    tempVideo.src = videoEl.src;
    tempVideo.muted = true;
    tempVideo.preload = 'auto';
    tempVideo.crossOrigin = 'anonymous';

    tempVideo.onseeked = function() {
      ctx.drawImage(tempVideo, framesLoaded * fw, 0, fw, fh);
      framesLoaded++;
      if (framesLoaded < numFrames) {
        tempVideo.currentTime = (framesLoaded / numFrames) * editCsDuration;
      }
    };

    tempVideo.onloadeddata = function() {
      tempVideo.currentTime = 0;
    };
  }

  /** Generate cover frame thumbnails */
  function generateEditCSCoverThumbnails(videoEl) {
    var container = csEl('coverThumbnails');
    if (!container) return;
    container.innerHTML = '';
    var numFrames = 8;
    var tempVideo = document.createElement('video');
    tempVideo.src = videoEl.src;
    tempVideo.muted = true;
    tempVideo.preload = 'auto';
    tempVideo.crossOrigin = 'anonymous';
    var currentIdx = 0;

    tempVideo.onseeked = function() {
      var c = document.createElement('canvas');
      c.width = 112;
      c.height = 200;
      var cx = c.getContext('2d');
      var vw = tempVideo.videoWidth;
      var vh = tempVideo.videoHeight;
      var scale = Math.max(c.width / vw, c.height / vh);
      var sw = c.width / scale;
      var sh = c.height / scale;
      var sx = (vw - sw) / 2;
      var sy = (vh - sh) / 2;
      cx.drawImage(tempVideo, sx, sy, sw, sh, 0, 0, c.width, c.height);

      if (currentIdx === 0) c.classList.add('cr-cover-selected');
      c.dataset.time = tempVideo.currentTime;
      c.onclick = function() { selectEditCSCoverFrame(c); };
      container.appendChild(c);
      currentIdx++;
      if (currentIdx < numFrames) {
        var nextTime = (currentIdx / (numFrames - 1)) * editCsDuration;
        tempVideo.currentTime = Math.min(nextTime, editCsDuration - 0.1);
      }
    };

    tempVideo.onloadeddata = function() {
      tempVideo.currentTime = 0;
    };
  }

  function selectEditCSCoverFrame(canvasEl) {
    var container = csEl('coverThumbnails');
    if (container) {
      var all = container.querySelectorAll('canvas');
      for (var i = 0; i < all.length; i++) all[i].classList.remove('cr-cover-selected');
    }
    canvasEl.classList.add('cr-cover-selected');
    editCsCoverTime = parseFloat(canvasEl.dataset.time) || 0;
    updateEditCSCoverFrame(editCsCoverTime);
  }

  function updateEditCSCoverFrame(time) {
    var coverCanvas = csEl('coverCanvas');
    if (!coverCanvas) return;
    var video = el('editCreatorSeriesVideo');
    if (!video || !video.src) return;

    var tempVideo = document.createElement('video');
    tempVideo.src = video.src;
    tempVideo.muted = true;
    tempVideo.crossOrigin = 'anonymous';
    tempVideo.currentTime = time;
    tempVideo.onseeked = function() {
      var ctx = coverCanvas.getContext('2d');
      var vw = tempVideo.videoWidth;
      var vh = tempVideo.videoHeight;
      var scale = Math.max(coverCanvas.width / vw, coverCanvas.height / vh);
      var sw = coverCanvas.width / scale;
      var sh = coverCanvas.height / scale;
      var sx = (vw - sw) / 2;
      var sy = (vh - sh) / 2;
      ctx.drawImage(tempVideo, sx, sy, sw, sh, 0, 0, coverCanvas.width, coverCanvas.height);
    };
  }

  // ===== Edit CS Trim Handle Dragging =====
  (function setupEditCSTrimHandles() {
    var dragging = null;

    function getHandleIds() {
      // Detect which prefix is active based on which section is visible
      var pfSection = document.getElementById('pfEditCreatorSeriesSection');
      if (pfSection && pfSection.style.display !== 'none') {
        return { start: 'pfEditCsTrimStart', end: 'pfEditCsTrimEnd', timeline: 'pfEditCsTrimTimeline',
                 startTime: 'pfEditCsTrimStartTime', endTime: 'pfEditCsTrimEndTime', durLabel: 'pfEditCsTrimDurationLabel' };
      }
      return { start: 'editCsTrimStart', end: 'editCsTrimEnd', timeline: 'editCsTrimTimeline',
               startTime: 'editCsTrimStartTime', endTime: 'editCsTrimEndTime', durLabel: 'editCsTrimDurationLabel' };
    }

    function handleDrag(clientX) {
      if (!dragging) return;
      var ids = getHandleIds();
      var timeline = document.getElementById(ids.timeline);
      if (!timeline) return;
      var rect = timeline.getBoundingClientRect();
      var x = Math.max(0, Math.min(clientX - rect.left, rect.width));
      var frac = x / rect.width;

      if (dragging === 'start') {
        editCsTrimStart = Math.min(frac, editCsTrimEnd - 0.05);
        var h = document.getElementById(ids.start);
        if (h) h.style.left = (editCsTrimStart * 100) + '%';
        var st = document.getElementById(ids.startTime);
        if (st) st.textContent = formatCSTime(editCsTrimStart * editCsDuration);
      } else {
        editCsTrimEnd = Math.max(frac, editCsTrimStart + 0.05);
        var h2 = document.getElementById(ids.end);
        if (h2) h2.style.left = (editCsTrimEnd * 100 - 3) + '%';
        var et = document.getElementById(ids.endTime);
        if (et) et.textContent = formatCSTime(editCsTrimEnd * editCsDuration);
      }

      var dl = document.getElementById(ids.durLabel);
      if (dl) dl.textContent = 'Duration: ' + formatCSTime((editCsTrimEnd - editCsTrimStart) * editCsDuration);
    }

    document.addEventListener('mousedown', function(e) {
      if (e.target.id === 'editCsTrimStart' || e.target.id === 'pfEditCsTrimStart') dragging = 'start';
      else if (e.target.id === 'editCsTrimEnd' || e.target.id === 'pfEditCsTrimEnd') dragging = 'end';
    });
    document.addEventListener('mousemove', function(e) { handleDrag(e.clientX); });
    document.addEventListener('mouseup', function() { dragging = null; });

    document.addEventListener('touchstart', function(e) {
      if (e.target.id === 'editCsTrimStart' || e.target.id === 'pfEditCsTrimStart') dragging = 'start';
      else if (e.target.id === 'editCsTrimEnd' || e.target.id === 'pfEditCsTrimEnd') dragging = 'end';
    }, { passive: true });
    document.addEventListener('touchmove', function(e) {
      if (!dragging) return;
      handleDrag(e.touches[0].clientX);
    }, { passive: true });
    document.addEventListener('touchend', function() { dragging = null; }, { passive: true });
  })();

  function toggleEditPoll() {
    var section = el('editPollSection');
    var btn = el('editPollToggleBtn');
    var isVisible = section.style.display !== 'none';
    section.style.display = isVisible ? 'none' : 'block';
    if (btn) btn.classList.toggle('cp-tool-active', !isVisible);
  }

  function toggleEditSchedule() {
    var section = el('editScheduleSection');
    var btn = el('editScheduleToggleBtn');
    var isVisible = section.style.display !== 'none';
    section.style.display = isVisible ? 'none' : 'block';
    if (btn) btn.classList.toggle('cp-tool-active', !isVisible);
  }

  function toggleEditAdvancedOptions() {
    var section = el('editAdvancedOptions');
    var isVisible = section.style.display !== 'none';
    section.style.display = isVisible ? 'none' : 'block';
  }

  function addEditPollOption() {
    var container = el('editPollOptions');
    var p = getPrefix();
    var pollOptionClass = p ? 'pf-edit-poll-option' : 'edit-poll-option';
    var optionCount = container.querySelectorAll('.' + pollOptionClass).length;
    if (optionCount >= 8) {
      InnovateAPI.showAlert('Maximum 8 poll options', 'info');
      return;
    }
    var color = pollColors[optionCount % pollColors.length];
    var row = document.createElement('div');
    row.className = 'cp-poll-option-row';
    row.innerHTML = '<span class="cp-poll-dot" style="background: ' + color + ';"></span>' +
      '<input type="text" class="' + pollOptionClass + ' cp-input" placeholder="Option ' + (optionCount + 1) + '">';
    container.appendChild(row);
  }

  function onEditCaptionInput(textarea) {
    el('editCharCount').textContent = textarea.value.length;

    // Hashtag detection
    var text = textarea.value;
    var cursorPos = textarea.selectionStart;
    var beforeCursor = text.substring(0, cursorPos);
    var hashMatch = beforeCursor.match(/#(\w*)$/);

    if (hashMatch && hashMatch[1].length >= 1) {
      showEditHashtagSuggestions(hashMatch[1]);
    } else {
      el('editHashtagSuggestions').style.display = 'none';
    }
  }

  async function showEditHashtagSuggestions(query) {
    var suggestionsDiv = el('editHashtagSuggestions');
    var listDiv = el('editHashtagList');

    var suggestions = [];
    if (trendingHashtagsCache && trendingHashtagsCache.length > 0) {
      suggestions = trendingHashtagsCache
        .filter(function (h) { return h.tag.toLowerCase().startsWith(query.toLowerCase()); })
        .slice(0, 6);
    }

    if (suggestions.length > 0) {
      listDiv.innerHTML = suggestions.map(function (h) {
        return '<span class="cp-hashtag-chip" onclick="insertEditHashtag(\'' + h.tag + '\')">#' + h.tag + '</span>';
      }).join('');
      suggestionsDiv.style.display = 'block';
    } else {
      suggestionsDiv.style.display = 'none';
    }
  }

  function insertEditHashtag(tag) {
    var textarea = el('editPostContent');
    var text = textarea.value;
    var cursorPos = textarea.selectionStart;
    var beforeCursor = text.substring(0, cursorPos);
    var afterCursor = text.substring(cursorPos);
    var newBefore = beforeCursor.replace(/#\w*$/, '#' + tag + ' ');
    textarea.value = newBefore + afterCursor;
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = newBefore.length;
    el('editCharCount').textContent = textarea.value.length;
    el('editHashtagSuggestions').style.display = 'none';
  }

  function toggleEditTrendingHashtags() {
    var list = el('editTrendingList');
    var chevron = el('editTrendingChevron');
    if (list.style.display === 'none') {
      list.style.display = 'block';
      if (chevron) chevron.classList.add('cp-open');
    } else {
      list.style.display = 'none';
      if (chevron) chevron.classList.remove('cp-open');
    }
  }

  async function loadEditTrendingHashtags() {
    try {
      var data = await InnovateAPI.apiRequest('/posts/trending-hashtags');
      if (data && data.hashtags && data.hashtags.length > 0) {
        trendingHashtagsCache = data.hashtags;
        var list = el('editTrendingList');
        if (list) {
          list.innerHTML = data.hashtags.map(function (h) {
            return '<div class="cp-trending-item" onclick="insertEditHashtag(\'' + h.tag + '\')">' +
              '<span class="cp-trending-tag">#' + h.tag + '</span>' +
              '<span class="cp-trending-count">' + (h.usage_count || 0) + ' posts</span>' +
              '</div>';
          }).join('');
        }
      }
    } catch (e) { /* optional */ }
  }

  function removeEditMedia(idx) {
    var p = getPrefix();
    var id = p ? p + 'EditMedia-' + idx : 'editMedia-' + idx;
    var elem = document.getElementById(id);
    if (elem) elem.remove();
    if (editPostData && editPostData.images) {
      editPostData.images[idx] = null;
    }
  }

  function removeEditFile(idx) {
    var p = getPrefix();
    var id = p ? p + 'EditFile-' + idx : 'editFile-' + idx;
    var elem = document.getElementById(id);
    if (elem) elem.remove();
    if (editPostData && editPostData.files) {
      editPostData.files[idx] = null;
    }
  }

  function previewEditMedia(input) {
    var container = el('editNewMedia');
    var p = getPrefix();
    Array.from(input.files).forEach(function (file) {
      editNewImages.push(file);
      var idx = editNewImages.length - 1;
      var itemId = p ? p + 'EditNewMedia-' + idx : 'editNewMedia-' + idx;
      var div = document.createElement('div');
      div.className = 'media-preview-item';
      div.id = itemId;

      if (file.type.startsWith('video/')) {
        var video = document.createElement('video');
        video.src = URL.createObjectURL(file);
        video.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        video.muted = true;
        div.appendChild(video);
      } else {
        var img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        div.appendChild(img);
      }

      var removeBtn = document.createElement('button');
      removeBtn.className = 'media-preview-remove';
      removeBtn.innerHTML = '&times;';
      removeBtn.onclick = (function (i, d) {
        return function () { editNewImages[i] = null; d.remove(); };
      })(idx, div);
      div.appendChild(removeBtn);
      container.appendChild(div);
    });
  }

  function previewEditFiles(input) {
    var container = el('editExistingFiles');
    var p = getPrefix();
    Array.from(input.files).forEach(function (file) {
      editNewFiles.push(file);
      var idx = editNewFiles.length - 1;
      var itemId = p ? p + 'EditNewFile-' + idx : 'editNewFile-' + idx;
      var size = (file.size / 1024).toFixed(1) + ' KB';
      var div = document.createElement('div');
      div.className = 'file-preview-item';
      div.id = itemId;
      div.innerHTML = '<span>📄</span>' +
        '<div style="flex:1;min-width:0;">' +
        '<div style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + file.name + '</div>' +
        '<div style="font-size:11px;color:var(--ig-secondary-text);">' + size + '</div></div>' +
        '<button class="file-preview-remove" onclick="editNewFiles[' + idx + ']=null;this.parentElement.remove();" title="Remove">&times;</button>';
      container.appendChild(div);
    });
  }

  // ======================== Custom Button & Comment-to-DM Helpers ========================
  // These only apply to home.html (no prefix). Profile doesn't have CB/CDM edit.

  function toggleEditCBSection(sectionId) {
    var section = document.getElementById(sectionId);
    if (!section) return;
    var mapping = {
      'editCbContactFields': 'editCbContactMe',
      'editCbDMFields': 'editCbDM',
      'editCbRegisterFields': 'editCbRegister',
      'editCbHireMeFields': 'editCbHireMe',
      'editCommentDMFields': 'editEnableCommentDM',
      'editCdmNotFollowingSection': 'editCdmRequireFollow'
    };
    var chk = document.getElementById(mapping[sectionId]);
    section.style.display = chk && chk.checked ? 'block' : 'none';
  }

  function addEditCBField(groupId, type, placeholder) {
    var group = document.getElementById(groupId);
    if (!group) return;
    var rows = group.querySelectorAll('.cb-multi-row');
    if (rows.length >= 5) {
      InnovateAPI.showAlert('Maximum 5 entries', 'info');
      return;
    }
    var row = document.createElement('div');
    row.className = 'cb-multi-row';
    row.innerHTML = '<input type="' + type + '" class="cp-input" placeholder="' + placeholder + '">' +
      '<button type="button" class="cb-remove-btn" onclick="this.parentElement.remove()">×</button>';
    group.appendChild(row);
  }

  function addEditCBCustomField() {
    var list = document.getElementById('editCbCustomFieldsList');
    if (!list) return;
    var count = list.querySelectorAll('.cb-custom-field-row').length;
    if (count >= 5) {
      InnovateAPI.showAlert('Maximum 5 custom fields', 'info');
      return;
    }
    var row = document.createElement('div');
    row.className = 'cb-custom-field-row';
    row.innerHTML = '<input type="text" class="cp-input" placeholder="Field name (e.g. Portfolio URL)">' +
      '<button type="button" class="cb-remove-btn" onclick="this.parentElement.remove()">×</button>';
    list.appendChild(row);
  }

  function addEditCDMItem() {
    var list = document.getElementById('editCdmItemsList');
    var idx = list.querySelectorAll('.cdm-item').length;
    var item = document.createElement('div');
    item.className = 'cdm-item';
    item.dataset.idx = idx;
    item.innerHTML =
      '<input type="text" class="cp-input cdm-item-label" placeholder="Custom button name" value="">' +
      '<input type="text" class="cp-input cdm-item-content" placeholder="Link or content to send" value="">' +
      '<button type="button" class="cdm-item-remove" onclick="this.parentElement.remove()">&times;</button>';
    list.appendChild(item);
  }

  function collectEditCustomButtonData() {
    var name = (document.getElementById('editCbButtonName') || {}).value;
    if (name) name = name.trim();
    var contactMe = (document.getElementById('editCbContactMe') || {}).checked;
    var dm = (document.getElementById('editCbDM') || {}).checked;
    var register = (document.getElementById('editCbRegister') || {}).checked;
    var hireMe = (document.getElementById('editCbHireMe') || {}).checked;

    if (!name || (!contactMe && !dm && !register && !hireMe)) return null;

    var data = { name: name };

    if (contactMe) {
      var links = getEditMultiFieldValues('editCbLinksGroup');
      var emails = getEditMultiFieldValues('editCbEmailsGroup');
      var phones = getEditMultiFieldValues('editCbPhonesGroup');
      data.contact_me = { enabled: true, links: links, emails: emails, phones: phones };
    }

    if (dm) {
      var message = (document.getElementById('editCbDMMessage') || {}).value;
      data.dm = { enabled: true, message: message ? message.trim() : '' };
    }

    if (register) {
      var link = (document.getElementById('editCbRegisterLink') || {}).value;
      data.register = { enabled: true, link: link ? link.trim() : '' };
    }

    if (hireMe) {
      var fields = [];
      if ((document.getElementById('editCbHireName') || {}).checked) fields.push('name');
      if ((document.getElementById('editCbHireEmail') || {}).checked) fields.push('email');
      if ((document.getElementById('editCbHireContact') || {}).checked) fields.push('contact');
      if ((document.getElementById('editCbHireResume') || {}).checked) fields.push('resume_link');

      var customFields = [];
      document.querySelectorAll('#editCbCustomFieldsList .cb-custom-field-row input').forEach(function (inp) {
        var val = inp.value.trim();
        if (val) customFields.push(val);
      });

      data.hire_me = { enabled: true, fields: fields, custom_fields: customFields };
    }

    return data;
  }

  function getEditMultiFieldValues(groupId) {
    var group = document.getElementById(groupId);
    if (!group) return [];
    var values = [];
    group.querySelectorAll('.cb-multi-row input').forEach(function (inp) {
      var val = inp.value.trim();
      if (val) values.push(val);
    });
    return values;
  }

  function collectEditCommentDMData() {
    var enabled = (document.getElementById('editEnableCommentDM') || {}).checked;
    if (!enabled) return null;

    var requireFollow = (document.getElementById('editCdmRequireFollow') || {}).checked || false;
    var notFollowMsg = (document.getElementById('editCdmNotFollowMsg') || {}).value;
    if (notFollowMsg) notFollowMsg = notFollowMsg.trim();
    var dmMessage = (document.getElementById('editCdmDMMessage') || {}).value;
    if (dmMessage) dmMessage = dmMessage.trim();

    var items = [];
    document.querySelectorAll('#editCdmItemsList .cdm-item').forEach(function (elItem) {
      var label = (elItem.querySelector('.cdm-item-label') || {}).value;
      if (label) label = label.trim();
      var itemContent = (elItem.querySelector('.cdm-item-content') || {}).value;
      if (itemContent) itemContent = itemContent.trim();
      if (label && itemContent) items.push({ label: label, content: itemContent });
    });

    if (items.length === 0) return null;

    return {
      enabled: true,
      require_follow: requireFollow,
      not_following_msg: notFollowMsg || '',
      dm_message: dmMessage || '',
      items: items
    };
  }

  function prefillEditCustomButton(customButton) {
    // Reset all fields first
    var nameInput = document.getElementById('editCbButtonName');
    if (nameInput) nameInput.value = '';
    ['editCbContactMe', 'editCbDM', 'editCbRegister', 'editCbHireMe'].forEach(function (id) {
      var elem = document.getElementById(id);
      if (elem) elem.checked = false;
    });
    ['editCbContactFields', 'editCbDMFields', 'editCbRegisterFields', 'editCbHireMeFields'].forEach(function (id) {
      var elem = document.getElementById(id);
      if (elem) elem.style.display = 'none';
    });
    // Reset sub-fields
    ['editCbLinksGroup', 'editCbEmailsGroup', 'editCbPhonesGroup'].forEach(function (id) {
      var group = document.getElementById(id);
      if (group) {
        var rows = group.querySelectorAll('.cb-multi-row');
        rows.forEach(function (r, i) {
          if (i > 0) r.remove();
          else {
            var inp = r.querySelector('input');
            if (inp) inp.value = '';
          }
        });
      }
    });
    var dmMsg = document.getElementById('editCbDMMessage');
    if (dmMsg) dmMsg.value = '';
    var regLink = document.getElementById('editCbRegisterLink');
    if (regLink) regLink.value = '';
    ['editCbHireName', 'editCbHireEmail', 'editCbHireContact'].forEach(function (id) {
      var elem = document.getElementById(id);
      if (elem) elem.checked = true;
    });
    var resumeChk = document.getElementById('editCbHireResume');
    if (resumeChk) resumeChk.checked = false;
    var customFieldsList = document.getElementById('editCbCustomFieldsList');
    if (customFieldsList) customFieldsList.innerHTML = '';

    if (!customButton) return;

    var data = typeof customButton === 'string' ? JSON.parse(customButton) : customButton;
    if (!data || !data.name) return;

    nameInput.value = data.name;

    if (data.contact_me && data.contact_me.enabled) {
      document.getElementById('editCbContactMe').checked = true;
      document.getElementById('editCbContactFields').style.display = 'block';
      fillEditMultiField('editCbLinksGroup', 'url', 'https://...', data.contact_me.links || []);
      fillEditMultiField('editCbEmailsGroup', 'email', 'email@example.com', data.contact_me.emails || []);
      fillEditMultiField('editCbPhonesGroup', 'tel', '+1234567890', data.contact_me.phones || []);
    }

    if (data.dm && data.dm.enabled) {
      document.getElementById('editCbDM').checked = true;
      document.getElementById('editCbDMFields').style.display = 'block';
      document.getElementById('editCbDMMessage').value = data.dm.message || '';
    }

    if (data.register && data.register.enabled) {
      document.getElementById('editCbRegister').checked = true;
      document.getElementById('editCbRegisterFields').style.display = 'block';
      document.getElementById('editCbRegisterLink').value = data.register.link || '';
    }

    if (data.hire_me && data.hire_me.enabled) {
      document.getElementById('editCbHireMe').checked = true;
      document.getElementById('editCbHireMeFields').style.display = 'block';
      var fields = data.hire_me.fields || [];
      document.getElementById('editCbHireName').checked = fields.includes('name');
      document.getElementById('editCbHireEmail').checked = fields.includes('email');
      document.getElementById('editCbHireContact').checked = fields.includes('contact');
      document.getElementById('editCbHireResume').checked = fields.includes('resume_link');
      (data.hire_me.custom_fields || []).forEach(function (f) {
        var row = document.createElement('div');
        row.className = 'cb-custom-field-row';
        row.innerHTML = '<input type="text" class="cp-input" value="' + f + '"><button type="button" class="cb-remove-btn" onclick="this.parentElement.remove()">×</button>';
        customFieldsList.appendChild(row);
      });
    }
  }

  function fillEditMultiField(groupId, type, placeholder, values) {
    var group = document.getElementById(groupId);
    if (!group) return;
    // Clear existing rows
    group.querySelectorAll('.cb-multi-row').forEach(function (r) { r.remove(); });
    if (values.length === 0) {
      var row = document.createElement('div');
      row.className = 'cb-multi-row';
      row.innerHTML = '<input type="' + type + '" class="cp-input" placeholder="' + placeholder + '"><button type="button" class="cb-add-btn" onclick="addEditCBField(\'' + groupId + '\',\'' + type + '\',\'' + placeholder + '\')">+</button>';
      group.appendChild(row);
      return;
    }
    values.forEach(function (val, i) {
      var row = document.createElement('div');
      row.className = 'cb-multi-row';
      row.innerHTML = '<input type="' + type + '" class="cp-input" placeholder="' + placeholder + '" value="' + val + '">' +
        (i === 0
          ? '<button type="button" class="cb-add-btn" onclick="addEditCBField(\'' + groupId + '\',\'' + type + '\',\'' + placeholder + '\')">+</button>'
          : '<button type="button" class="cb-remove-btn" onclick="this.parentElement.remove()">×</button>');
      group.appendChild(row);
    });
  }

  function prefillEditCommentDM(commentDM) {
    // Reset
    var enableChk = document.getElementById('editEnableCommentDM');
    if (enableChk) enableChk.checked = false;
    var fields = document.getElementById('editCommentDMFields');
    if (fields) fields.style.display = 'none';
    var followChk = document.getElementById('editCdmRequireFollow');
    if (followChk) followChk.checked = true;
    var notFollowMsg = document.getElementById('editCdmNotFollowMsg');
    if (notFollowMsg) notFollowMsg.value = '';
    var dmMsgEl = document.getElementById('editCdmDMMessage');
    if (dmMsgEl) dmMsgEl.value = '';
    var itemsList = document.getElementById('editCdmItemsList');
    if (itemsList) {
      itemsList.innerHTML =
        '<div class="cdm-item" data-idx="0">' +
        '<input type="text" class="cp-input cdm-item-label" placeholder="Custom button name (e.g. Get Link, Download)" value="">' +
        '<input type="text" class="cp-input cdm-item-content" placeholder="Link or content to send" value="">' +
        '</div>';
    }

    if (!commentDM) return;

    var data = typeof commentDM === 'string' ? JSON.parse(commentDM) : commentDM;
    if (!data || !data.enabled) return;

    enableChk.checked = true;
    fields.style.display = 'block';
    followChk.checked = !!data.require_follow;
    document.getElementById('editCdmNotFollowingSection').style.display = data.require_follow ? 'block' : 'none';
    notFollowMsg.value = data.not_following_msg || '';
    dmMsgEl.value = data.dm_message || '';

    if (data.items && data.items.length > 0) {
      itemsList.innerHTML = data.items.map(function (item, i) {
        return '<div class="cdm-item" data-idx="' + i + '">' +
          '<input type="text" class="cp-input cdm-item-label" placeholder="Custom button name" value="' + (item.label || '') + '">' +
          '<input type="text" class="cp-input cdm-item-content" placeholder="Link or content to send" value="' + (item.content || '') + '">' +
          (i > 0 ? '<button type="button" class="cdm-item-remove" onclick="this.parentElement.remove()">&times;</button>' : '') +
          '</div>';
      }).join('');
    }
  }

  // ======================== Archive & Delete ========================

  /**
   * Archive a post.
   */
  async function handleArchivePost() {
    if (confirm('Archive this post? You can restore it later from your profile.')) {
      try {
        await InnovateAPI.apiRequest('/posts/' + currentPostIdForActions + '/archive', {
          method: 'PUT'
        });
        closePostActionsModal();
        InnovateAPI.showAlert('Post archived successfully!', 'success');
        // Remove from fullscreen viewer if applicable
        var fsEl = document.querySelector('.ig-fullscreen-post[data-post-id="' + currentPostIdForActions + '"]');
        if (fsEl) fsEl.remove();
        refreshPosts();
      } catch (error) {
        InnovateAPI.showAlert(error.message || 'Failed to archive post', 'error');
      }
    }
  }

  /**
   * Delete a post.
   */
  async function handleDeletePost() {
    if (confirm('Are you sure you want to delete this post? This cannot be undone.')) {
      try {
        await InnovateAPI.apiRequest('/posts/' + currentPostIdForActions, {
          method: 'DELETE'
        });
        closePostActionsModal();
        InnovateAPI.showAlert('Post deleted successfully!', 'success');
        // Remove from fullscreen viewer if applicable
        var fsEl = document.querySelector('.ig-fullscreen-post[data-post-id="' + currentPostIdForActions + '"]');
        if (fsEl) fsEl.remove();
        refreshPosts();
      } catch (error) {
        InnovateAPI.showAlert(error.message || 'Failed to delete post', 'error');
      }
    }
  }

  // ======================== Reminder / Meeting ========================

  /**
   * Close reminder modal.
   */
  function closeReminderModal(event) {
    var p = getPrefix();
    var modalId = p ? p + 'ReminderModal' : 'reminderModal';
    if (!event || event.target.id === modalId) {
      document.getElementById(modalId).style.display = 'none';
    }
  }

  /**
   * Submit a reminder.
   */
  async function submitReminder() {
    var date = el('reminderDate').value;
    var message = el('reminderMessage').value;

    if (!date) {
      InnovateAPI.showAlert('Please select a date and time', 'error');
      return;
    }

    try {
      await InnovateAPI.apiRequest('/posts/' + currentPostIdForActions + '/reminder', {
        method: 'POST',
        body: JSON.stringify({ reminder_date: date, message: message })
      });
      closeReminderModal();
      InnovateAPI.showAlert('Reminder set! Check the Events calendar.', 'success');
      el('reminderDate').value = '';
      el('reminderMessage').value = '';
    } catch (error) {
      InnovateAPI.showAlert(error.message || 'Failed to set reminder', 'error');
    }
  }

  // ======================== Public API & Window Globals ========================

  // All functions exposed on the module
  var publicAPI = {
    init: init,

    // Utilities
    formatCount: formatCount,

    // Bottom sheet
    setupBottomSheetDrag: setupBottomSheetDrag,
    toggleSheetExpand: toggleSheetExpand,

    // Comments
    openCommentsModal: openCommentsModal,
    renderCommentsThreaded: renderCommentsThreaded,
    renderCommentItem: renderCommentItem,
    toggleReplies: toggleReplies,
    toggleCommentMenu: toggleCommentMenu,
    likeComment: likeComment,
    showWhoLikedComment: showWhoLikedComment,
    reportComment: reportComment,
    replyToComment: replyToComment,
    cancelReply: cancelReply,
    deleteComment: deleteComment,
    submitModalComment: submitModalComment,
    handleCommentMention: handleCommentMention,
    insertMention: insertMention,

    // Likes
    showWhoLiked: showWhoLiked,
    followFromLikes: followFromLikes,

    // Share
    sharePost: sharePost,
    copyShareLink: copyShareLink,
    searchShareUsers: searchShareUsers,
    sendPostToUser: sendPostToUser,

    // Post actions menu
    openPostActionsMenu: openPostActionsMenu,
    closePostActionsModal: closePostActionsModal,
    handleRepost: handleRepost,
    handleGentleReminder: handleGentleReminder,
    handleReport: handleReport,

    // Edit post modal
    handleEditPost: handleEditPost,
    closeEditModal: closeEditModal,
    submitEditPost: submitEditPost,
    toggleEditPoll: toggleEditPoll,
    toggleEditSchedule: toggleEditSchedule,
    toggleEditAdvancedOptions: toggleEditAdvancedOptions,
    addEditPollOption: addEditPollOption,
    onEditCaptionInput: onEditCaptionInput,
    showEditHashtagSuggestions: showEditHashtagSuggestions,
    insertEditHashtag: insertEditHashtag,
    toggleEditTrendingHashtags: toggleEditTrendingHashtags,
    loadEditTrendingHashtags: loadEditTrendingHashtags,
    removeEditMedia: removeEditMedia,
    removeEditFile: removeEditFile,
    previewEditMedia: previewEditMedia,
    previewEditFiles: previewEditFiles,
    onEditCSVideoChanged: onEditCSVideoChanged,
    toggleEditCSPlayback: toggleEditCSPlayback,
    toggleEditCSAudio: toggleEditCSAudio,
    selectEditCSCoverFrame: selectEditCSCoverFrame,

    // Custom button & Comment-to-DM
    toggleEditCBSection: toggleEditCBSection,
    addEditCBField: addEditCBField,
    addEditCBCustomField: addEditCBCustomField,
    addEditCDMItem: addEditCDMItem,
    collectEditCustomButtonData: collectEditCustomButtonData,
    getEditMultiFieldValues: getEditMultiFieldValues,
    collectEditCommentDMData: collectEditCommentDMData,
    prefillEditCustomButton: prefillEditCustomButton,
    fillEditMultiField: fillEditMultiField,
    prefillEditCommentDM: prefillEditCommentDM,

    // Archive & Delete
    handleArchivePost: handleArchivePost,
    handleDeletePost: handleDeletePost,

    // Reminder
    closeReminderModal: closeReminderModal,
    submitReminder: submitReminder,

    // Expose state accessors
    getCurrentPostIdForActions: function () { return currentPostIdForActions; },
    getEditPostData: function () { return editPostData; }
  };

  // ======================== Expose all functions globally ========================
  // This ensures onclick="openCommentsModal(...)" in HTML still works.

  var globalFunctions = [
    'formatCount',
    'setupBottomSheetDrag', 'toggleSheetExpand',
    'openCommentsModal', 'renderCommentsThreaded', 'renderCommentItem',
    'toggleReplies', 'toggleCommentMenu', 'likeComment',
    'showWhoLikedComment', 'reportComment',
    'replyToComment', 'cancelReply', 'deleteComment',
    'submitModalComment', 'handleCommentMention', 'insertMention',
    'showWhoLiked', 'followFromLikes',
    'sharePost', 'copyShareLink', 'searchShareUsers', 'sendPostToUser',
    'openPostActionsMenu', 'closePostActionsModal',
    'handleRepost', 'handleGentleReminder', 'handleReport',
    'handleEditPost', 'closeEditModal', 'submitEditPost',
    'toggleEditPoll', 'toggleEditSchedule', 'toggleEditAdvancedOptions',
    'addEditPollOption', 'onEditCaptionInput',
    'showEditHashtagSuggestions', 'insertEditHashtag',
    'toggleEditTrendingHashtags', 'loadEditTrendingHashtags',
    'removeEditMedia', 'removeEditFile',
    'previewEditMedia', 'previewEditFiles',
    'onEditCSVideoChanged',
    'toggleEditCSPlayback', 'toggleEditCSAudio',
    'selectEditCSCoverFrame',
    'toggleEditCBSection', 'addEditCBField', 'addEditCBCustomField',
    'addEditCDMItem', 'collectEditCustomButtonData', 'getEditMultiFieldValues',
    'collectEditCommentDMData', 'prefillEditCustomButton',
    'fillEditMultiField', 'prefillEditCommentDM',
    'handleArchivePost', 'handleDeletePost',
    'closeReminderModal', 'submitReminder'
  ];

  globalFunctions.forEach(function (name) {
    window[name] = publicAPI[name];
  });

  // ======================== Create prefixed aliases for profile.html ========================
  // e.g. window.pfOpenCommentsModal = window.openCommentsModal

  globalFunctions.forEach(function (name) {
    var prefixed = 'pf' + name.charAt(0).toUpperCase() + name.slice(1);
    window[prefixed] = publicAPI[name];
  });

  // Also set specific profile.html aliases that use different naming conventions
  window.pfSetupSheetDrag = setupBottomSheetDrag;
  window.pfToggleSheetExpand = toggleSheetExpand;
  window.openPfPostActions = openPostActionsMenu;
  window.closePfPostActions = closePostActionsModal;
  window.pfOpenCommentsModal = openCommentsModal;
  window.pfRenderComments = renderCommentsThreaded;
  window.pfRenderCommentItem = renderCommentItem;
  window.pfToggleReplies = toggleReplies;
  window.pfToggleCommentMenu = toggleCommentMenu;
  window.pfLikeComment = likeComment;
  window.pfReplyToComment = replyToComment;
  window.pfCancelReply = cancelReply;
  window.pfDeleteComment = deleteComment;
  window.pfReportComment = reportComment;
  window.pfHandleMention = handleCommentMention;
  window.pfInsertMention = insertMention;
  window.pfSubmitComment = submitModalComment;
  window.pfShowWhoLiked = showWhoLiked;
  window.pfFollowFromLikes = followFromLikes;
  window.pfSharePost = sharePost;
  window.pfHandleRepost = handleRepost;
  window.pfHandleGentleReminder = handleGentleReminder;
  window.pfHandleReport = handleReport;
  window.pfHandleEditPost = handleEditPost;
  window.pfCloseEditModal = closeEditModal;
  window.pfSubmitEditPost = submitEditPost;
  window.pfToggleEditPoll = toggleEditPoll;
  window.pfToggleEditSchedule = toggleEditSchedule;
  window.pfToggleEditAdvancedOptions = toggleEditAdvancedOptions;
  window.pfAddEditPollOption = addEditPollOption;
  window.pfOnEditCaptionInput = onEditCaptionInput;
  window.pfShowEditHashtagSuggestions = showEditHashtagSuggestions;
  window.pfInsertEditHashtag = insertEditHashtag;
  window.pfToggleEditTrendingHashtags = toggleEditTrendingHashtags;
  window.pfLoadEditTrendingHashtags = loadEditTrendingHashtags;
  window.pfRemoveEditMedia = removeEditMedia;
  window.pfRemoveEditFile = removeEditFile;
  window.pfPreviewEditMedia = previewEditMedia;
  window.pfPreviewEditFiles = previewEditFiles;
  window.pfHandleArchivePost = handleArchivePost;
  window.pfHandleDeletePost = handleDeletePost;
  window.pfCloseReminderModal = closeReminderModal;
  window.pfSubmitReminder = submitReminder;

  // Expose state variables on window so non-shared functions can access them
  window.formatCompact = formatCount; // alias for profile.html compatibility
  Object.defineProperty(window, 'currentPostIdForActions', {
    get: function () { return currentPostIdForActions; },
    set: function (v) { currentPostIdForActions = v; },
    configurable: true
  });
  Object.defineProperty(window, 'currentPostOwnerId', {
    get: function () { return currentPostOwnerId; },
    set: function (v) { currentPostOwnerId = v; },
    configurable: true
  });

  // Expose editNewFiles on window for inline onclick handlers
  Object.defineProperty(window, 'editNewFiles', {
    get: function () { return editNewFiles; },
    set: function (v) { editNewFiles = v; },
    configurable: true
  });
  Object.defineProperty(window, 'pfEditNewFiles', {
    get: function () { return editNewFiles; },
    set: function (v) { editNewFiles = v; },
    configurable: true
  });

  return publicAPI;
})();
