/**
 * PostRenderer — Shared module for rendering posts across home feed,
 * profile grid, and full-screen (TikTok/Reels style) viewers.
 *
 * Usage:
 *   PostRenderer.init({ getUser, refreshPosts, getUserAvatar, linkifyCaption });
 *   const el = PostRenderer.createFeedPost(post);
 *   PostRenderer.openFullScreenViewer(posts, 0, { ... });
 */
const PostRenderer = (function () {
  'use strict';

  // ======================== Configuration ========================

  let _config = {
    getUser: function () { return null; },
    refreshPosts: function () {},
    getUserAvatar: function (pic) { return pic || '/images/default-avatar.svg'; },
    linkifyCaption: function (text) { return escapeHtml(text); },
    renderAttachments: function (/* post, options */) { return ''; },
    openCommentsModal: function (/* postId */) {},
    sharePost: function (/* postId */) {},
    openPostActionsMenu: function (/* postId, userId */) {},
    showAlert: function (/* msg, type */) {},
    apiRequest: null, // function(url, opts) — if null we fall back to fetch
    openAttachment: function (/* url, name */) {},
    openCustomButtonModal: function (/* postId, userId, config */) {},
    showWhoLiked: function (/* postId */) {},
    initPdfEmbeds: function (/* el */) {},
  };

  function init(config) {
    _config = Object.assign({}, _config, config);
  }

  // ======================== Utilities ========================

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Short relative time: "now", "2m", "3h", "1d", "2w"
   */
  function formatTimeShort(dateStr) {
    if (!dateStr) return '';
    var ds = dateStr;
    if (ds.includes(' ') && !ds.includes('T') && !ds.includes('Z')) ds = ds.replace(' ', 'T') + 'Z';
    var diff = Date.now() - new Date(ds).getTime();
    var m = Math.floor(diff / 60000);
    var h = Math.floor(diff / 3600000);
    var d = Math.floor(diff / 86400000);
    var w = Math.floor(d / 7);
    if (m < 1) return 'now';
    if (m < 60) return m + 'm';
    if (h < 24) return h + 'h';
    if (d < 7) return d + 'd';
    return w + 'w';
  }

  /**
   * Long relative time: "Just now", "2 minutes ago", "3 hours ago", "1 days ago", "2 weeks ago"
   */
  function formatTimeAgo(dateStr) {
    if (!dateStr) return '';
    var ds = dateStr;
    if (ds.includes(' ') && !ds.includes('T') && !ds.includes('Z')) ds = ds.replace(' ', 'T') + 'Z';
    var diff = Date.now() - new Date(ds).getTime();
    var m = Math.floor(diff / 60000);
    var h = Math.floor(diff / 3600000);
    var d = Math.floor(diff / 86400000);
    var w = Math.floor(d / 7);
    if (m < 1) return 'Just now';
    if (m < 60) return m + ' minutes ago';
    if (h < 24) return h + ' hours ago';
    if (d < 7) return d + ' days ago';
    return w + ' weeks ago';
  }

  /**
   * Compact number: 1200 → "1.2K", 3400000 → "3.4M"
   */
  function formatCount(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  }

  // ======================== API helper ========================

  function _api(url, opts) {
    if (_config.apiRequest) return _config.apiRequest(url, opts);
    // fallback
    var headers = Object.assign({ 'Content-Type': 'application/json' }, (opts && opts.headers) || {});
    var token = localStorage.getItem('token');
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return fetch('/api' + url, Object.assign({}, opts, { headers: headers })).then(function (r) {
      if (!r.ok) throw new Error('Request failed');
      return r.json();
    });
  }

  // ======================== Global mute state ========================

  if (typeof window._globalMuted === 'undefined') {
    window._globalMuted = true;
  }

  function getMutedIconSvg(size) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';
  }
  function getUnmutedIconSvg(size) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
  }

  /**
   * Apply global mute state to ALL videos on the page (feed + fullscreen).
   */
  function applyGlobalMuteState() {
    // Feed videos
    document.querySelectorAll('.ig-post-video-container video').forEach(function (v) {
      v.muted = window._globalMuted;
    });
    // Fullscreen videos
    document.querySelectorAll('.ig-fullscreen-post video').forEach(function (v) {
      v.muted = window._globalMuted;
    });
    // Feed sound button icons
    document.querySelectorAll('.ig-video-sound-btn').forEach(function (btn) {
      btn.innerHTML = window._globalMuted ? getMutedIconSvg(16) : getUnmutedIconSvg(16);
    });
    // Fullscreen mute button icons
    document.querySelectorAll('.ig-cseries-mute-btn').forEach(function (btn) {
      var mutedIcon = btn.querySelector('.muted-icon');
      var unmutedIcon = btn.querySelector('.unmuted-icon');
      if (mutedIcon && unmutedIcon) {
        mutedIcon.style.display = window._globalMuted ? '' : 'none';
        unmutedIcon.style.display = window._globalMuted ? 'none' : '';
      }
    });
  }

  // ======================== Feed Carousel ========================

  var _carouselStates = {};

  function initCarousel(postId, totalImages) {
    if (!_carouselStates[postId]) {
      _carouselStates[postId] = { currentIndex: 0, totalImages: totalImages };
    }
  }

  function carouselNext(postId) {
    var state = _carouselStates[postId];
    if (!state) return;
    state.currentIndex = (state.currentIndex + 1) % state.totalImages;
    updateCarousel(postId);
  }

  function carouselPrev(postId) {
    var state = _carouselStates[postId];
    if (!state) return;
    state.currentIndex = (state.currentIndex - 1 + state.totalImages) % state.totalImages;
    updateCarousel(postId);
  }

  function carouselGoTo(postId, index) {
    var state = _carouselStates[postId];
    if (!state) return;
    state.currentIndex = index;
    updateCarousel(postId);
  }

  function updateCarousel(postId) {
    var state = _carouselStates[postId];
    if (!state) return;
    var inner = document.getElementById('carousel-inner-' + postId);
    var dots = document.querySelectorAll('#dots-' + postId + ' .ig-carousel-dot');
    if (inner) {
      inner.style.transform = 'translateX(-' + (state.currentIndex * 100) + '%)';
    }
    dots.forEach(function (dot, idx) {
      dot.classList.toggle('active', idx === state.currentIndex);
    });
  }

  function enableCarouselSwipe(postId) {
    var carousel = document.getElementById('carousel-' + postId);
    if (!carousel) return;
    var startX = 0;
    var isDragging = false;

    carousel.addEventListener('touchstart', function (e) {
      startX = e.touches[0].clientX;
      isDragging = true;
    });
    carousel.addEventListener('touchmove', function (e) {
      if (!isDragging) return;
      e.preventDefault();
    });
    carousel.addEventListener('touchend', function (e) {
      if (!isDragging) return;
      isDragging = false;
      var endX = e.changedTouches[0].clientX;
      var diff = startX - endX;
      if (Math.abs(diff) > 50) {
        if (diff > 0) carouselNext(postId);
        else carouselPrev(postId);
      }
    });
  }

  // ======================== Full-Screen Carousel ========================

  var _fsCarouselIdx = {};

  function fsCarouselNav(postId, dir, total, idPrefix) {
    idPrefix = idPrefix || '';
    var key = idPrefix + postId;
    if (!_fsCarouselIdx[key]) _fsCarouselIdx[key] = 0;
    _fsCarouselIdx[key] = Math.max(0, Math.min(total - 1, _fsCarouselIdx[key] + dir));
    var track = document.getElementById(idPrefix + 'fs-carousel-' + postId + '-track');
    if (!track) {
      // home.html uses ig-carousel with carousel-inner
      track = document.getElementById('carousel-inner-fs-carousel-' + postId);
    }
    if (track) track.style.transform = 'translateX(-' + (_fsCarouselIdx[key] * 100) + '%)';
    var dots = document.getElementById(idPrefix + 'fs-carousel-' + postId + '-dots');
    if (!dots) {
      dots = document.getElementById('dots-fs-carousel-' + postId);
    }
    if (dots) {
      Array.from(dots.children).forEach(function (dot, i) {
        if (dot.classList) {
          dot.classList.toggle('active', i === _fsCarouselIdx[key]);
        }
        dot.style.background = i === _fsCarouselIdx[key] ? '#fff' : 'rgba(255,255,255,0.4)';
      });
    }
  }

  /** Legacy wrappers used by home.html onclick handlers */
  function fsCarouselNext(postId, event) {
    if (event) event.stopPropagation();
    // Home uses the standard carousel system for fs-carousel-{postId}
    carouselNext('fs-carousel-' + postId);
  }

  function fsCarouselPrev(postId, event) {
    if (event) event.stopPropagation();
    carouselPrev('fs-carousel-' + postId);
  }

  function fsCarouselGoTo(postId, index, event) {
    if (event) event.stopPropagation();
    carouselGoTo('fs-carousel-' + postId, index);
  }

  // ======================== Feed Post Card ========================

  /**
   * Create an Instagram-style feed post DOM element.
   * Returns an HTMLElement.
   */
  function createFeedPost(post) {
    var postEl = document.createElement('div');
    postEl.className = 'ig-post';
    postEl.dataset.postId = post.id;
    postEl.style.cursor = 'pointer';

    var isLiked = post.user_has_liked || false;
    var isSaved = post.is_saved || false;
    var likesCount = post.likes_count || post.interested_count || 0;
    var commentsCount = post.comments_count || 0;
    var rawAttachmentsHtml = _config.renderAttachments(post);
    var avatarUrl = _config.getUserAvatar(post.profile_picture);
    var captionHtml = _config.linkifyCaption(post.content || '');

    // Handle media
    var mediaHtml = '';
    var isCreatorSeries = post.is_creator_series || post.video_url;
    if (post.video_url) {
      if (isCreatorSeries) {
        mediaHtml = ''
          + '<div class="ig-post-video-container ig-feed-cseries" data-post-id="' + post.id + '">'
          + '<video src="' + post.video_url + '" class="ig-post-image" playsinline loop muted preload="metadata"></video>'
          + '<div class="ig-cseries-badge">'
          + '<svg width="12" height="12" viewBox="0 0 24 24" fill="#fff"><polygon points="5 3 19 12 5 21 5 3"/></svg>'
          + 'Creator Series'
          + '</div>'
          + '<div class="ig-feed-cseries-play-icon">'
          + '<svg width="48" height="48" viewBox="0 0 24 24" fill="rgba(255,255,255,0.85)"><polygon points="5 3 19 12 5 21 5 3"/></svg>'
          + '</div>'
          + '<button class="ig-video-sound-btn" onclick="toggleVideoSound(this, event)">'
          + (window._globalMuted ? getMutedIconSvg(16) : getUnmutedIconSvg(16))
          + '</button>'
          + '</div>';
      } else {
        mediaHtml = ''
          + '<div class="ig-post-video-container" data-post-id="' + post.id + '">'
          + '<video src="' + post.video_url + '" class="ig-post-image" playsinline loop muted preload="metadata"'
          + ' onclick="toggleVideoPlay(this, event)" ondblclick="doubleTapLike(' + post.id + ', event)"></video>'
          + '<div class="ig-video-play-btn" onclick="toggleVideoPlay(this.parentElement.querySelector(\'video\'), event)">'
          + '<svg width="24" height="24" viewBox="0 0 24 24" fill="#fff"><polygon points="5 3 19 12 5 21 5 3"/></svg>'
          + '</div>'
          + '<button class="ig-video-sound-btn" onclick="toggleVideoSound(this, event)">'
          + (window._globalMuted ? getMutedIconSvg(16) : getUnmutedIconSvg(16))
          + '</button>'
          + '</div>';
      }
    } else if (post.images && post.images.length > 0) {
      if (post.images.length === 1) {
        mediaHtml = '<div style="position:relative;overflow:hidden;background:#1a1a1a;" data-post-id="' + post.id + '">'
          + '<img src="' + post.images[0] + '" alt="Post image" class="ig-post-image" ondblclick="doubleTapLike(' + post.id + ', event)">'
          + '</div>';
      } else {
        mediaHtml = ''
          + '<div class="ig-carousel" id="carousel-' + post.id + '" style="background:#1a1a1a;">'
          + '<div class="ig-carousel-inner" id="carousel-inner-' + post.id + '">'
          + post.images.map(function (img, idx) {
              return '<img src="' + img + '" alt="Post image ' + (idx + 1) + '" class="ig-post-image" ondblclick="doubleTapLike(' + post.id + ', event)">';
            }).join('')
          + '</div>'
          + (post.images.length > 1
            ? '<button class="ig-carousel-btn ig-carousel-prev" onclick="event.stopPropagation(); carouselPrev(' + post.id + ')" style="left: 10px;">&#8249;</button>'
              + '<button class="ig-carousel-btn ig-carousel-next" onclick="event.stopPropagation(); carouselNext(' + post.id + ')" style="right: 10px;">&#8250;</button>'
              + '<div class="ig-carousel-dots" id="dots-' + post.id + '">'
              + post.images.map(function (_, idx) {
                  return '<span class="ig-carousel-dot ' + (idx === 0 ? 'active' : '') + '" onclick="event.stopPropagation(); carouselGoTo(' + post.id + ', ' + idx + ')"></span>';
                }).join('')
              + '</div>'
            : '')
          + '</div>';
      }
    }

    // If no visual media, treat attachments as the main media
    var hasVisualMedia = !!post.video_url || (Array.isArray(post.images) && post.images.length > 0);
    var attachmentsHtml = rawAttachmentsHtml;
    if (!hasVisualMedia && rawAttachmentsHtml) {
      mediaHtml = _config.renderAttachments(post, { asMedia: true });
      attachmentsHtml = '';
    }

    var timeShort = formatTimeShort(post.created_at);

    // Poll HTML
    var pollHtml = '';
    if (post.poll) {
      var votesObj = post.poll.votes;
      var totalVotes = typeof votesObj === 'object' && !Array.isArray(votesObj) ? Object.values(votesObj).reduce(function (a, b) { return a + b; }, 0) : (Array.isArray(votesObj) ? votesObj.reduce(function (a, b) { return a + b; }, 0) : 0);
      var userVoted = post.poll.user_voted || null;
      pollHtml = ''
        + '<div class="ig-poll" data-post-id="' + post.id + '" style="margin: 12px 16px; padding: 12px; background: var(--ig-secondary-background); border-radius: 8px;" onclick="event.stopPropagation()">'
        + '<div style="font-weight: 600; margin-bottom: 12px;">' + post.poll.question + '</div>'
        + post.poll.options.map(function (option, idx) {
            var voteCount = typeof votesObj === 'object' && !Array.isArray(votesObj) ? (votesObj[option] || 0) : (Array.isArray(votesObj) ? (votesObj[idx] || 0) : 0);
            var percentage = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;
            var isSelected = userVoted === option;
            return ''
              + '<div class="poll-option' + (isSelected ? ' poll-voted' : '') + '" onclick="event.stopPropagation(); votePoll(' + post.id + ', ' + post.poll.id + ', \'' + option.replace(/'/g, "\\'") + '\')"'
              + ' style="margin-bottom: 8px; position: relative; overflow: hidden; border-radius: 8px; border: ' + (isSelected ? '2px solid var(--ig-blue)' : '1px solid var(--ig-border)') + '; cursor: pointer; transition: all 0.2s;">'
              + '<div style="position: absolute; top: 0; left: 0; height: 100%; width: ' + percentage + '%; background: var(--ig-blue); opacity: ' + (isSelected ? '0.25' : '0.1') + '; transition: width 0.5s ease;"></div>'
              + '<div style="position: relative; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center;">'
              + '<span style="display: flex; align-items: center; gap: 8px;">'
              + (isSelected ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="var(--ig-blue)" stroke="none"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>' : '')
              + '<span' + (isSelected ? ' style="font-weight: 600; color: var(--ig-blue);"' : '') + '>' + option + '</span>'
              + '</span>'
              + '<span style="font-weight: 600; font-size: 14px;' + (isSelected ? ' color: var(--ig-blue);' : '') + '">' + percentage + '%</span>'
              + '</div></div>';
          }).join('')
        + '<div style="margin-top: 8px; font-size: 12px; color: var(--ig-secondary-text); display: flex; justify-content: space-between;">'
        + '<span>' + totalVotes + ' vote' + (totalVotes !== 1 ? 's' : '') + '</span>'
        + (userVoted ? '<span style="color: var(--ig-blue);">You voted</span>' : '')
        + '</div></div>';
    }

    postEl.innerHTML = ''
      + '<div class="ig-post-header">'
      + '<a href="/profile/' + post.user_id + '" class="ig-post-user">'
      + '<img src="' + avatarUrl + '" alt="' + post.username + '" class="ig-post-avatar">'
      + '<div class="ig-post-info">'
      + '<span class="ig-post-username">' + post.username + '</span>'
      + '<span class="ig-post-header-dot">·</span>'
      + '<span class="ig-post-header-time">' + timeShort + '</span>'
      + '</div></a>'
      + '<button class="ig-post-menu" onclick="openPostActionsMenu(' + post.id + ', ' + post.user_id + ')">'
      + '<svg aria-label="More options" fill="currentColor" height="24" viewBox="0 0 24 24" width="24"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>'
      + '</button></div>'

      + mediaHtml

      + '<div class="ig-post-actions">'
      + '<div class="ig-post-actions-left">'
      + '<button class="ig-action-btn ' + (isLiked ? 'liked' : '') + '" onclick="toggleLike(' + post.id + ')" data-post-id="' + post.id + '">'
      + '<svg aria-label="Like" fill="' + (isLiked ? '#ed4956' : 'none') + '" height="24" viewBox="0 0 24 24" width="24">'
      + '<path d="M16.792 3.904A4.989 4.989 0 0 1 21.5 9.122c0 3.072-2.652 4.959-5.197 7.222-2.512 2.243-3.865 3.469-4.303 3.752-.477-.309-2.143-1.823-4.303-3.752C5.141 14.072 2.5 12.167 2.5 9.122a4.989 4.989 0 0 1 4.708-5.218 4.21 4.21 0 0 1 3.675 1.941c.84 1.175.98 1.763 1.12 1.763s.278-.588 1.11-1.766a4.17 4.17 0 0 1 3.679-1.938m0-2a6.04 6.04 0 0 0-4.797 2.127 6.052 6.052 0 0 0-4.787-2.127A6.985 6.985 0 0 0 .5 9.122c0 3.61 2.55 5.827 5.015 7.97.283.246.569.494.853.747l1.027.918a44.998 44.998 0 0 0 3.518 3.018 2 2 0 0 0 2.174 0 45.263 45.263 0 0 0 3.626-3.115l.922-.824c.293-.26.59-.519.885-.774 2.334-2.025 4.98-4.32 4.98-7.94a6.985 6.985 0 0 0-6.708-7.218Z"></path></svg>'
      + '</button>'
      + '<button class="ig-action-btn" onclick="openCommentsModal(' + post.id + ')">'
      + '<svg aria-label="Comment" fill="none" height="24" viewBox="0 0 24 24" width="24" stroke="currentColor" stroke-width="2"><path d="M20.656 17.008a9.993 9.993 0 1 0-3.59 3.615L22 22Z" fill="none" stroke-linejoin="round"></path></svg>'
      + '</button>'
      + '<button class="ig-action-btn" onclick="sharePost(' + post.id + ')">'
      + '<svg aria-label="Share" fill="none" height="24" viewBox="0 0 24 24" width="24" stroke="currentColor" stroke-width="2"><line fill="none" stroke-linejoin="round" x1="22" x2="9.218" y1="3" y2="10.083"></line><polygon fill="none" points="11.698 20.334 22 3.001 2 3.001 9.218 10.084 11.698 20.334" stroke-linejoin="round"></polygon></svg>'
      + '</button>'
      + '</div>'
      + '<button class="ig-action-btn ' + (isSaved ? 'saved' : '') + '" onclick="toggleSave(' + post.id + ')">'
      + '<svg aria-label="Save" fill="' + (isSaved ? 'currentColor' : 'none') + '" height="24" viewBox="0 0 24 24" width="24" stroke="currentColor" stroke-width="2"><polygon fill="none" points="20 21 12 13.44 4 21 4 3 20 3 20 21" stroke-linecap="round" stroke-linejoin="round"></polygon></svg>'
      + '</button></div>'

      + '<div class="ig-post-likes" id="likes-section-' + post.id + '">'
      + (likesCount > 0
        ? '<span class="ig-post-likes-count" id="likes-' + post.id + '" onclick="showWhoLiked(' + post.id + ')" style="cursor: pointer;">'
          + (post.recent_liker
            ? '<span style="font-weight:400;">Liked by </span><strong>' + post.recent_liker + '</strong>' + (likesCount > 1 ? ' <span style="font-weight:400;">and </span><strong>' + (likesCount - 1) + ' other' + (likesCount - 1 > 1 ? 's' : '') + '</strong>' : '')
            : '<strong>' + likesCount + ' ' + (likesCount === 1 ? 'like' : 'likes') + '</strong>')
          + '</span>'
        : '')
      + '</div>'

      + (post.content
        ? '<div class="ig-post-caption">'
          + '<span class="ig-caption-username">' + post.username + '</span>'
          + '<span class="ig-caption-text">' + captionHtml + '</span>'
          + (post.content.length > 150 ? '<button class="ig-caption-more" onclick="this.previousElementSibling.style.display=\'inline\'; this.style.display=\'none\';">more</button>' : '')
          + '</div>'
        : '')

      + attachmentsHtml

      + (commentsCount > 0
        ? '<button class="ig-post-comments-btn" onclick="openCommentsModal(' + post.id + ')">View all ' + commentsCount + ' comments</button>'
        : '')

      + (post.recent_comments && post.recent_comments.length > 0
        ? post.recent_comments.map(function (rc) {
            return '<div class="ig-inline-comment"><span class="ig-inline-comment-user">' + rc.username + '</span><span class="ig-inline-comment-text">' + rc.content + '</span></div>';
          }).join('')
        : '')

      + pollHtml

      + (post.enable_contact || post.enable_interested
        ? '<div class="ig-post-actions-btns" style="margin: 0 16px 12px; display: flex; gap: 8px;">'
          + (post.enable_contact ? '<button onclick="handleContactMe(' + post.id + ')" style="flex: 1; padding: 8px; background: var(--ig-blue); color: white; border: none; border-radius: 6px; font-weight: 600; cursor: pointer;">📞 Contact Me</button>' : '')
          + (post.enable_interested ? '<button onclick="handleInterested(' + post.id + ')" style="flex: 1; padding: 8px; background: var(--ig-blue); color: white; border: none; border-radius: 6px; font-weight: 600; cursor: pointer;">⭐ I\'m Interested</button>' : '')
          + '</div>'
        : '')

      + (post.custom_button
        ? '<button class="cb-post-button" data-post-id="' + post.id + '" data-user-id="' + post.user_id + '" data-config="' + encodeURIComponent(JSON.stringify(post.custom_button)) + '" onclick="event.stopPropagation(); try { openCustomButtonModal(Number(this.dataset.postId), Number(this.dataset.userId), decodeURIComponent(this.dataset.config)); } catch(e) { console.error(\'Custom btn error:\', e); }">'
          + escapeHtml(post.custom_button.name || 'Action')
          + '</button>'
        : '')

      // Comment-to-DM indicator
      + (post.comment_to_dm && post.comment_to_dm.enabled
        ? '<div class="cdm-feed-prompt" onclick="openCommentsModal(' + post.id + ')" style="margin: 0 16px 12px; padding: 10px 14px; background: linear-gradient(135deg, rgba(131,58,180,0.1), rgba(253,29,29,0.1), rgba(252,176,69,0.1)); border: 1px solid rgba(131,58,180,0.2); border-radius: 10px; cursor: pointer; display: flex; align-items: center; gap: 8px;">'
          + '<span style="font-size: 18px;">💬</span>'
          + '<span style="font-size: 13px; font-weight: 600; color: var(--ig-primary-text);">Comment to get a DM with '
          + (post.comment_to_dm.items && post.comment_to_dm.items.length > 0
            ? post.comment_to_dm.items.length + ' link' + (post.comment_to_dm.items.length > 1 ? 's' : '')
            : 'exclusive content')
          + '</span>'
          + '</div>'
        : '')

      + '<div class="ig-post-separator"></div>';

    // Post element setup
    setTimeout(function () {
      postEl.querySelectorAll('.ig-attachment-item').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          var url = btn.getAttribute('data-attachment-url') || '';
          var name = btn.getAttribute('data-attachment-name') || 'Document';
          _config.openAttachment(url, name);
        });
      });
      _config.initPdfEmbeds(postEl);
    }, 0);

    return postEl;
  }

  // ======================== Full-Screen Post HTML ========================

  /**
   * Create HTML string for a single post in full-screen / reel mode.
   * @param {Object} post
   * @param {number} idx — index in the array
   * @param {number} startIndex — the initially selected index (for lazy-load range)
   * @param {Object} opts — { idPrefix: '' | 'pf-', showFollowBtn: true }
   * @returns {string} HTML string
   */
  function createFullScreenPostHTML(post, idx, startIndex, opts) {
    opts = opts || {};
    var idPrefix = opts.idPrefix || '';
    var showFollowBtn = opts.showFollowBtn !== false;

    var isLiked = post.user_has_liked || false;
    var isSaved = post.is_saved || false;
    var likesCount = post.likes_count || 0;
    var commentsCount = post.comments_count || 0;
    var username = post.username || '';
    var avatarUrl = _config.getUserAvatar(post.profile_picture);
    var captionText = post.content || '';
    var encodedCaption = encodeURIComponent(captionText);
    var renderedCaption = _config.linkifyCaption(captionText);

    // Time ago
    var timeAgo = formatTimeAgo(post.created_at);

    // Determine onclick handler names based on prefix
    var fnDoubleTap = idPrefix === 'pf-' ? 'pfDoubleTapLike' : 'doubleTapLikeCreatorSeries';
    var fnHandleTap = idPrefix === 'pf-' ? 'pfHandleTap' : 'handleCreatorSeriesTap';
    var fnToggleMute = idPrefix === 'pf-' ? 'pfToggleMute' : 'toggleCreatorSeriesMute';
    var fnToggleLike = idPrefix === 'pf-' ? 'pfToggleLike' : 'toggleLikeCreatorSeries';
    var fnToggleSave = idPrefix === 'pf-' ? 'pfToggleSave' : 'toggleSaveCreatorSeries';
    var fnSeekVideo = idPrefix === 'pf-' ? 'pfSeekVideo' : 'seekCreatorSeriesVideo';
    var fnExpandCaption = idPrefix === 'pf-' ? 'pfExpandCaption' : 'expandCreatorSeriesCaption';
    var fnFollowUser = idPrefix === 'pf-' ? 'pfFollowUser' : 'followUserFromCreatorSeries';
    var fnOpenComments = idPrefix === 'pf-' ? 'pfOpenCommentsModal' : 'openCommentsModal';
    var fnSharePost = idPrefix === 'pf-' ? 'pfSharePost' : 'sharePost';
    var fnOpenActions = idPrefix === 'pf-' ? 'openPfPostActions' : 'openPostActionsMenu';
    var fnFsCarousel = idPrefix === 'pf-' ? 'pfFsCarousel' : null; // home uses fsCarouselPrev/Next

    // Build media HTML
    var mediaHtml = '';
    if (post.video_url) {
      var shouldPreload = idx <= startIndex + 2;
      mediaHtml = '<div class="ig-cseries-media" ondblclick="' + fnDoubleTap + '(' + post.id + ', event)">'
        + '<video ' + (shouldPreload ? 'src="' + post.video_url + '"' : 'data-src="' + post.video_url + '"')
        + ' playsinline loop preload="' + (shouldPreload ? 'auto' : 'none') + '" data-post-id="' + post.id + '"'
        + (post.images && post.images[0] ? ' poster="' + post.images[0] + '"' : '') + '></video>'
        + '<div class="ig-cseries-loading-spinner" id="' + idPrefix + 'spinner-' + post.id + '">'
        + '<div style="width:36px;height:36px;border:3px solid rgba(255,255,255,0.2);border-top-color:#fff;border-radius:50%;animation:cseriesSpin 0.8s linear infinite;"></div>'
        + '</div>'
        + '<div class="ig-cseries-tap-zone" onclick="' + fnHandleTap + '(this, event)">'
        + '<div class="ig-cseries-pause-indicator">'
        + '<svg width="60" height="60" viewBox="0 0 24 24" fill="rgba(255,255,255,0.9)"><polygon points="5 3 19 12 5 21 5 3"/></svg>'
        + '</div></div></div>';
    } else if (post.images && post.images.length > 0) {
      if (post.images.length === 1) {
        mediaHtml = '<div class="ig-cseries-media" ondblclick="' + fnDoubleTap + '(' + post.id + ', event)">'
          + '<img src="' + post.images[0] + '" alt="Post"></div>';
      } else {
        // Carousel — profile uses its own track ID pattern, home uses ig-carousel
        if (idPrefix === 'pf-') {
          var carouselId = idPrefix + 'fs-carousel-' + post.id;
          mediaHtml = '<div class="ig-cseries-media" ondblclick="' + fnDoubleTap + '(' + post.id + ', event)">'
            + '<div style="width:100%;height:100%;position:relative;overflow:hidden;">'
            + '<div id="' + carouselId + '-track" style="display:flex;height:100%;transition:transform 0.3s ease;">'
            + post.images.map(function (img, imgIdx) {
                return '<img src="' + img + '" alt="Image ' + (imgIdx + 1) + '" style="width:100%;height:100%;object-fit:contain;flex-shrink:0;">';
              }).join('')
            + '</div>'
            + (post.images.length > 1
              ? '<button onclick="event.stopPropagation();pfFsCarousel(' + post.id + ',-1,' + post.images.length + ')" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.2);color:#fff;border:none;border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:18px;z-index:5;backdrop-filter:blur(4px);">&#8249;</button>'
                + '<button onclick="event.stopPropagation();pfFsCarousel(' + post.id + ',1,' + post.images.length + ')" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.2);color:#fff;border:none;border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:18px;z-index:5;backdrop-filter:blur(4px);">&#8250;</button>'
                + '<div id="' + carouselId + '-dots" style="position:absolute;bottom:12px;left:50%;transform:translateX(-50%);display:flex;gap:4px;z-index:5;">'
                + post.images.map(function (_, di) {
                    return '<span style="width:6px;height:6px;border-radius:50%;background:' + (di === 0 ? '#fff' : 'rgba(255,255,255,0.4)') + ';transition:background 0.2s;"></span>';
                  }).join('')
                + '</div>'
              : '')
            + '</div></div>';
        } else {
          // Home-style carousel using ig-carousel system
          mediaHtml = '<div class="ig-cseries-media" ondblclick="' + fnDoubleTap + '(' + post.id + ', event)">'
            + '<div class="ig-carousel" id="fs-carousel-' + post.id + '" style="width:100%;height:100%;">'
            + '<div class="ig-carousel-inner" id="carousel-inner-fs-carousel-' + post.id + '" style="height:100%;">'
            + post.images.map(function (img, imgIdx) {
                return '<img src="' + img + '" alt="Image ' + (imgIdx + 1) + '" style="width:100%;height:100%;object-fit:contain;flex-shrink:0;">';
              }).join('')
            + '</div>'
            + (post.images.length > 1
              ? '<button class="ig-carousel-btn ig-carousel-prev" onclick="fsCarouselPrev(' + post.id + ', event)" style="left:10px;">&#8249;</button>'
                + '<button class="ig-carousel-btn ig-carousel-next" onclick="fsCarouselNext(' + post.id + ', event)" style="right:10px;">&#8250;</button>'
                + '<div class="ig-carousel-dots" id="dots-fs-carousel-' + post.id + '">'
                + post.images.map(function (_, dotIdx) {
                    return '<span class="ig-carousel-dot ' + (dotIdx === 0 ? 'active' : '') + '" onclick="fsCarouselGoTo(' + post.id + ', ' + dotIdx + ', event)"></span>';
                  }).join('')
                + '</div>'
              : '')
            + '</div></div>';
        }
      }
    } else {
      // Text-only
      mediaHtml = '<div class="ig-cseries-media" style="background:linear-gradient(135deg,#833ab4,#fd1d1d,#fcb045);display:flex;align-items:center;justify-content:center;padding:40px;">'
        + '<p style="color:#fff;font-size:22px;font-weight:600;text-align:center;text-shadow:0 2px 8px rgba(0,0,0,0.3);max-width:80%;">' + escapeHtml(captionText).substring(0, 200) + '</p></div>';
    }

    // Poll HTML (fullscreen style)
    var pollHtml = '';
    if (post.poll) {
      var votesObj = post.poll.votes;
      var totalVotes = typeof votesObj === 'object' && !Array.isArray(votesObj) ? Object.values(votesObj).reduce(function (a, b) { return a + b; }, 0) : (Array.isArray(votesObj) ? votesObj.reduce(function (a, b) { return a + b; }, 0) : 0);
      var userVoted = post.poll.user_voted || null;
      pollHtml = '<div class="ig-cseries-poll" data-post-id="' + post.id + '" onclick="event.stopPropagation()">'
        + '<div class="poll-question">' + post.poll.question + '</div>'
        + post.poll.options.map(function (option, oIdx) {
            var voteCount = typeof votesObj === 'object' && !Array.isArray(votesObj) ? (votesObj[option] || 0) : (Array.isArray(votesObj) ? (votesObj[oIdx] || 0) : 0);
            var percentage = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;
            var isSelected = userVoted === option;
            return '<div class="poll-option' + (isSelected ? ' poll-voted' : '') + '" onclick="event.stopPropagation(); votePoll(' + post.id + ', ' + post.poll.id + ', \'' + option.replace(/'/g, "\\'") + '\')">'
              + '<div class="poll-bar" style="width:' + percentage + '%;' + (isSelected ? 'opacity:0.35;' : '') + '"></div>'
              + '<div class="poll-option-label"><span>' + (isSelected ? '✓ ' : '') + option + '</span><span style="font-weight:600;">' + percentage + '%</span></div></div>';
          }).join('')
        + '<div style="margin-top:6px;font-size:11px;color:rgba(255,255,255,0.5);display:flex;justify-content:space-between;">'
        + '<span>' + totalVotes + ' vote' + (totalVotes !== 1 ? 's' : '') + '</span>'
        + (userVoted ? '<span style="color:var(--ig-blue);">You voted</span>' : '')
        + '</div></div>';
    }

    // Custom button
    var customBtnHtml = '';
    if (post.custom_button) {
      customBtnHtml = '<button class="ig-cseries-custom-btn"'
        + ' data-post-id="' + post.id + '"'
        + ' data-user-id="' + post.user_id + '"'
        + ' data-config="' + encodeURIComponent(JSON.stringify(post.custom_button)) + '"'
        + ' onclick="event.stopPropagation(); event.preventDefault(); try { openCustomButtonModal(Number(this.dataset.postId), Number(this.dataset.userId), decodeURIComponent(this.dataset.config)); } catch(e) { console.error(e); }"'
        + ' ontouchend="event.stopPropagation();"'
        + '>'
        + escapeHtml(post.custom_button.name || 'Action')
        + '</button>';
    }

    // Contact / Interested buttons
    var contactBtnsHtml = '';
    if (post.enable_contact || post.enable_interested) {
      contactBtnsHtml = '<div class="ig-cseries-contact-btns" onclick="event.stopPropagation()" ontouchend="event.stopPropagation()">'
        + (post.enable_contact ? '<button onclick="handleContactMe(' + post.id + ')">📞 Contact Me</button>' : '')
        + (post.enable_interested ? '<button onclick="handleInterested(' + post.id + ')">⭐ Interested</button>' : '')
        + '</div>';
    }

    // Attachments
    var attachHtml = '';
    if (Array.isArray(post.files) && post.files.length > 0) {
      attachHtml = post.files.filter(function (f) { return f && (f.path || f.name); }).map(function (f) {
        var name = f.name || 'Attachment';
        var ext = (name.split('.').pop() || '').toUpperCase();
        return '<button onclick="event.stopPropagation(); openAttachment(\'' + (f.path || '').replace(/'/g, "\\'") + '\', \'' + name.replace(/'/g, "\\'") + '\')"'
          + ' style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:8px;color:#fff;font-size:13px;cursor:pointer;width:100%;text-align:left;">'
          + '<span style="background:rgba(255,255,255,0.2);padding:4px 8px;border-radius:4px;font-weight:700;font-size:11px;">' + (ext || 'FILE') + '</span>'
          + '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">' + name + '</span>'
          + '</button>';
      }).join('');
      if (attachHtml) {
        attachHtml = '<div style="display:flex;flex-direction:column;gap:6px;">' + attachHtml + '</div>';
      }
    }

    // Comment-to-DM indicator for fullscreen
    var cdmHtml = '';
    if (post.comment_to_dm && post.comment_to_dm.enabled) {
      var cdmItemCount = (post.comment_to_dm.items && post.comment_to_dm.items.length) || 0;
      var cdmLabel = cdmItemCount > 0 ? cdmItemCount + ' link' + (cdmItemCount > 1 ? 's' : '') : 'exclusive content';
      cdmHtml = '<button class="ig-cseries-cdm-prompt" onclick="event.stopPropagation(); ' + fnOpenComments + '(' + post.id + ')"'
        + ' ontouchend="event.stopPropagation();"'
        + ' style="display:flex;align-items:center;gap:8px;width:100%;padding:10px 14px;background:linear-gradient(135deg,rgba(131,58,180,0.25),rgba(253,29,29,0.2),rgba(252,176,69,0.2));border:1px solid rgba(255,255,255,0.2);border-radius:10px;cursor:pointer;color:#fff;font-size:13px;font-weight:600;text-align:left;pointer-events:auto;touch-action:manipulation;">'
        + '<span style="font-size:18px;">💬</span>'
        + '<span>Comment to get a DM with ' + cdmLabel + '</span>'
        + '</button>';
    }

    var hasFeatures = pollHtml || customBtnHtml || contactBtnsHtml || attachHtml || cdmHtml;

    // Action buttons
    var actionsHtml = '<div class="ig-cseries-actions">';

    // Mute button
    actionsHtml += '<button class="ig-cseries-mute-btn" onclick="event.stopPropagation(); ' + fnToggleMute + '(this)">'
      + '<svg class="unmuted-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" style="' + (window._globalMuted ? 'display:none;' : '') + '"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>'
      + '<svg class="muted-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" style="' + (window._globalMuted ? '' : 'display:none;') + '"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>'
      + '</button>';

    // Like
    actionsHtml += '<button class="ig-cseries-action-btn ' + (isLiked ? 'liked' : '') + '" onclick="' + fnToggleLike + '(' + post.id + ', this)" data-post-id="' + post.id + '">'
      + '<svg viewBox="0 0 24 24"><path d="M16.792 3.904A4.989 4.989 0 0 1 21.5 9.122c0 3.072-2.652 4.959-5.197 7.222-2.512 2.243-3.865 3.469-4.303 3.752-.477-.309-2.143-1.823-4.303-3.752C5.141 14.072 2.5 12.167 2.5 9.122a4.989 4.989 0 0 1 4.708-5.218 4.21 4.21 0 0 1 3.675 1.941c.84 1.175.98 1.763 1.12 1.763s.278-.588 1.11-1.766a4.17 4.17 0 0 1 3.679-1.938Z"/></svg>'
      + '<span class="ig-cseries-action-count ig-cseries-likes-label" id="' + idPrefix + 'likes-' + post.id + '" onclick="event.stopPropagation(); showWhoLiked(' + post.id + ')">' + formatCount(likesCount) + '</span>'
      + '</button>';

    // Comment
    actionsHtml += '<button class="ig-cseries-action-btn" onclick="' + fnOpenComments + '(' + post.id + ')">'
      + '<svg viewBox="0 0 24 24"><path d="M20.656 17.008a9.993 9.993 0 1 0-3.59 3.615L22 22Z" stroke-linejoin="round"/></svg>'
      + '<span class="ig-cseries-action-count" id="' + idPrefix + 'comments-' + post.id + '">' + formatCount(commentsCount) + '</span>'
      + '</button>';

    // Share
    actionsHtml += '<button class="ig-cseries-action-btn" onclick="' + fnSharePost + '(' + post.id + ')">'
      + '<svg viewBox="0 0 24 24"><line x1="22" x2="9.218" y1="3" y2="10.083" stroke-linejoin="round"/><polygon points="11.698 20.334 22 3.001 2 3.001 9.218 10.084 11.698 20.334" stroke-linejoin="round"/></svg>'
      + '</button>';

    // Save
    actionsHtml += '<button class="ig-cseries-action-btn ' + (isSaved ? 'saved' : '') + '" onclick="' + fnToggleSave + '(' + post.id + ', this)">'
      + '<svg viewBox="0 0 24 24"><polygon points="20 21 12 13.44 4 21 4 3 20 3 20 21" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      + '</button>';

    // 3-dot menu
    actionsHtml += '<button class="ig-cseries-action-btn" onclick="' + fnOpenActions + '(' + post.id + ', ' + post.user_id + ')">'
      + '<svg viewBox="0 0 24 24" width="24" height="24" fill="#fff" stroke="none"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>'
      + '</button>';

    actionsHtml += '</div>';

    // Bottom overlay
    var bottomHtml = '<div class="ig-cseries-bottom">'
      + '<div class="ig-cseries-user-row">'
      + '<a href="/profile/' + post.user_id + '" style="display:flex;align-items:center;gap:8px;text-decoration:none;">'
      + '<img src="' + avatarUrl + '" alt="' + username + '" class="ig-cseries-avatar">'
      + '<span class="ig-cseries-username">' + username + '</span></a>'
      + (showFollowBtn ? '<button class="ig-cseries-follow-btn" onclick="' + fnFollowUser + '(' + post.user_id + ', this)">Follow</button>' : '')
      + '</div>';

    if (captionText) {
      bottomHtml += '<div class="ig-cseries-caption" id="' + idPrefix + 'caption-' + post.id + '">' + renderedCaption + '</div>'
        + '<button class="ig-cseries-caption-more" data-full-caption="' + encodedCaption + '" onclick="' + fnExpandCaption + '(' + post.id + ')">... more</button>';
    }

    // Features (poll, custom button, contact, attachments, CDM) — always visible, outside "more"
    if (hasFeatures) {
      bottomHtml += '<div class="ig-cseries-features" style="margin-top:6px;">' + pollHtml + customBtnHtml + contactBtnsHtml + attachHtml + cdmHtml + '</div>';
    }

    bottomHtml += '<div class="ig-cseries-details" id="' + idPrefix + 'details-' + post.id + '">' 
      + (timeAgo ? '<div class="ig-cseries-time">' + timeAgo + '</div>' : '')
      + '</div></div>';
    var progressHtml = '';
    if (post.video_url) {
      progressHtml = '<div class="ig-cseries-progress-bar-container" data-post-id="' + post.id + '" onclick="' + fnSeekVideo + '(this, event)">'
        + '<div class="ig-cseries-progress-track"><div class="ig-cseries-progress-fill" id="' + idPrefix + 'progress-' + post.id + '"></div></div></div>';
    }

    return '<div class="ig-fullscreen-post" data-post-id="' + post.id + '" data-post-index="' + idx + '">'
      + mediaHtml + actionsHtml + bottomHtml + progressHtml + '</div>';
  }

  // ======================== Grid Item ========================

  /**
   * Create HTML string for a profile grid thumbnail.
   */
  function createGridItem(post, onClickFn) {
    var images = Array.isArray(post.images) ? post.images : [];
    var likes = post.likes_count || 0;
    var comments = post.comments_count || 0;
    var hasMultiple = images.length > 1;
    var hasVideo = !!post.video_url;
    var clickHandler = onClickFn || 'viewPost';

    return '<div class="pf-ig-grid-item" onclick="' + clickHandler + '(' + post.id + ')">'
      + (images.length > 0
        ? '<img src="' + images[0] + '" alt="Post" loading="lazy" onerror="this.style.display=\'none\'">'
        : hasVideo
          ? '<div style="width:100%;height:100%;background:#000;display:flex;align-items:center;justify-content:center;"><video src="' + post.video_url + '" style="width:100%;height:100%;object-fit:cover;" muted></video></div>'
          : '<div class="pf-ig-grid-text">' + (post.content || 'Post').substring(0, 100) + '</div>')
      + (hasMultiple ? '<span class="pf-ig-grid-multi"><i class="fas fa-clone"></i></span>' : '')
      + (hasVideo ? '<span class="pf-ig-grid-video"><i class="fas fa-play"></i></span>' : '')
      + '<div class="pf-ig-grid-overlay">'
      + '<span class="pf-ig-grid-stat"><i class="fas fa-heart"></i> ' + likes + '</span>'
      + '<span class="pf-ig-grid-stat"><i class="fas fa-comment"></i> ' + comments + '</span>'
      + '</div></div>';
  }

  // ======================== Full-Screen Viewer ========================

  /**
   * Open a full-screen post viewer overlay.
   * @param {Array} posts
   * @param {number} startIndex
   * @param {Object} opts — { viewerId, contentId, headerText, onClose, idPrefix }
   */
  function openFullScreenViewer(posts, startIndex, opts) {
    opts = opts || {};
    var viewerId = opts.viewerId || 'fullScreenPostViewer';
    var contentId = opts.contentId || 'fullScreenContent';
    var idPrefix = opts.idPrefix || '';
    var onClose = opts.onClose || ('close' + (idPrefix === 'pf-' ? 'ProfileFullScreen' : 'FullScreenPost'));
    var headerText = opts.headerText || ((posts[startIndex] && posts[startIndex].video_url) ? 'Creator Series' : 'Posts');

    // Remove existing viewer if any
    var existing = document.getElementById(viewerId);
    if (existing) existing.remove();

    // Disconnect feed observer and pause ALL videos to prevent overlap
    if (window._feedVideoObserver) {
      window._feedVideoObserver.disconnect();
    }
    pauseAllVideos();

    var viewer = document.createElement('div');
    viewer.id = viewerId;
    viewer.className = 'ig-fullscreen-viewer';
    viewer.innerHTML = '<div class="ig-fullscreen-header">'
      + '<button class="ig-fullscreen-back" onclick="' + onClose + '()">'
      + '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
      + '</button>'
      + '<span style="color:#fff;font-weight:600;font-size:16px;text-shadow:0 1px 3px rgba(0,0,0,0.5);">' + headerText + '</span>'
      + '<div style="margin-left:auto;width:24px;"></div>'
      + '</div>'
      + '<div class="ig-fullscreen-content" id="' + contentId + '"></div>';

    document.body.appendChild(viewer);
    document.body.style.overflow = 'hidden';

    renderFullScreenPosts(posts, startIndex, {
      contentId: contentId,
      idPrefix: idPrefix,
      showFollowBtn: opts.showFollowBtn,
      observerKey: idPrefix || 'cseries',
    });
  }

  /**
   * Render posts into a full-screen content container and set up autoplay.
   */
  function renderFullScreenPosts(posts, startIndex, opts) {
    opts = opts || {};
    var contentId = opts.contentId || 'fullScreenContent';
    var idPrefix = opts.idPrefix || '';
    var content = document.getElementById(contentId);
    if (!content || !posts.length) return;

    content.innerHTML = posts.map(function (post, idx) {
      return createFullScreenPostHTML(post, idx, startIndex, {
        idPrefix: idPrefix,
        showFollowBtn: opts.showFollowBtn,
      });
    }).join('');

    // First: scroll to the correct post INSTANTLY (no smooth scroll)
    var postEls = content.querySelectorAll('.ig-fullscreen-post');
    if (postEls[startIndex]) {
      // Use scrollTop for instant positioning (no animation)
      postEls[startIndex].scrollIntoView({ behavior: 'instant', block: 'start' });
    }

    // Then: after scroll settles, init carousels and video autoplay
    setTimeout(function () {
      // Pause everything again (safety net)
      pauseAllVideos();

      // Init carousels (home-style)
      if (!idPrefix) {
        posts.forEach(function (post) {
          if (post.images && post.images.length > 1) {
            initCarousel('fs-carousel-' + post.id, post.images.length);
            enableCarouselSwipe('fs-carousel-' + post.id);
          }
        });
      }

      setupVideoAutoplay(content, { idPrefix: idPrefix });
      setupProgressBarInteraction(content);
    }, 150);
  }

  /**
   * Close a full-screen viewer and clean up observers.
   */
  function closeFullScreenViewer(viewerId, opts) {
    opts = opts || {};
    var observerKey = opts.observerKey || 'cseries';
    var viewer = document.getElementById(viewerId);
    if (!viewer) return;

    // Disconnect observer
    var obKey = '_' + observerKey + 'Observer';
    var rafKey = '_' + observerKey + 'ProgressRAF';
    if (window[obKey]) { window[obKey].disconnect(); window[obKey] = null; }
    if (window[rafKey]) { cancelAnimationFrame(window[rafKey]); window[rafKey] = null; }

    viewer.querySelectorAll('video').forEach(function (v) { v.pause(); v.muted = true; });
    viewer.remove();
    document.body.style.overflow = '';

    // Re-setup feed video autoplay (re-observe feed videos)
    setupFeedVideoAutoplay();
  }

  // ======================== Video Autoplay (Full-Screen) ========================

  /**
   * Set up IntersectionObserver-based video autoplay for fullscreen content.
   * @param {HTMLElement} contentEl — the scroll container
   * @param {Object} opts — { idPrefix: '' | 'pf-' }
   */
  function setupVideoAutoplay(contentEl, opts) {
    opts = opts || {};
    var idPrefix = opts.idPrefix || '';
    var observerKey = idPrefix === 'pf-' ? 'pf' : 'cseries';
    var obKey = '_' + observerKey + 'Observer';
    var rafKey = '_' + observerKey + 'ProgressRAF';
    // HTML generates ids as: idPrefix + 'spinner-' + postId  (e.g. "spinner-123" or "pf-spinner-123")
    var spinnerId = function (postId) {
      return idPrefix + 'spinner-' + postId;
    };
    var progressId = function (postId) {
      return idPrefix + 'progress-' + postId;
    };

    // Disconnect previous
    if (window[obKey]) window[obKey].disconnect();
    if (window[rafKey]) cancelAnimationFrame(window[rafKey]);

    // Hide spinner when video is ready
    contentEl.querySelectorAll('.ig-fullscreen-post video').forEach(function (v) {
      var postId = v.dataset.postId;
      var spinner = document.getElementById(spinnerId(postId));
      if (spinner) {
        var hide = function () { spinner.classList.add('hidden'); };
        v.addEventListener('canplay', hide);
        v.addEventListener('playing', hide);
        v.addEventListener('loadeddata', hide);
        // If the video already has data or is already playing, hide immediately
        if (v.readyState >= 2 || !v.paused) hide();
      }
    });

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var video = entry.target;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.75) {
          // Pause ALL other fullscreen videos first to prevent overlap
          contentEl.querySelectorAll('.ig-fullscreen-post video').forEach(function (otherV) {
            if (otherV !== video) otherV.pause();
          });

          // Lazy load
          if (!video.src && video.dataset.src) {
            video.src = video.dataset.src;
            video.preload = 'auto';
            video.load();
            var pid = video.dataset.postId;
            var sp = document.getElementById(spinnerId(pid));
            if (sp) sp.classList.remove('hidden');
          }
          video.muted = window._globalMuted;
          video.volume = 1;
          video.play().then(function () {
            // Hide spinner on successful play
            var pid2 = video.dataset.postId;
            var sp2 = document.getElementById(spinnerId(pid2));
            if (sp2) sp2.classList.add('hidden');
          }).catch(function () {
            video.muted = true;
            video.play().then(function () {
              var pid3 = video.dataset.postId;
              var sp3 = document.getElementById(spinnerId(pid3));
              if (sp3) sp3.classList.add('hidden');
            }).catch(function () {});
          });
        } else {
          video.pause();
        }
      });
    }, { threshold: [0.75], root: contentEl });

    window[obKey] = observer;
    contentEl.querySelectorAll('.ig-fullscreen-post video').forEach(function (v) { observer.observe(v); });

    // Progress bar updater
    function updateProgressBars() {
      contentEl.querySelectorAll('.ig-fullscreen-post video').forEach(function (v) {
        var pid = v.dataset.postId;
        var fill = document.getElementById(progressId(pid));
        if (fill && v.duration && !isNaN(v.duration)) {
          fill.style.width = ((v.currentTime / v.duration) * 100) + '%';
        }
      });
      window[rafKey] = requestAnimationFrame(updateProgressBars);
    }
    updateProgressBars();
  }

  // ======================== Video Controls ========================

  /**
   * Get clientX from mouse or touch event.
   */
  function getEventX(event) {
    if (event.touches && event.touches.length > 0) return event.touches[0].clientX;
    if (event.changedTouches && event.changedTouches.length > 0) return event.changedTouches[0].clientX;
    return event.clientX;
  }

  /**
   * Seek video via progress bar click/tap.
   */
  function seekVideo(container, event) {
    event.stopPropagation();
    event.preventDefault();
    var post = container.closest('.ig-fullscreen-post');
    var video = post ? post.querySelector('video') : null;
    if (!video || !video.duration) return;
    var rect = container.getBoundingClientRect();
    var x = getEventX(event) - rect.left;
    var pct = Math.max(0, Math.min(1, x / rect.width));
    video.currentTime = pct * video.duration;
  }

  /**
   * Set up touch/mouse drag-to-seek on all progress bars inside a container.
   */
  function setupProgressBarInteraction(contentEl) {
    contentEl.querySelectorAll('.ig-cseries-progress-bar-container').forEach(function (bar) {
      if (bar._seekBound) return; // already bound
      bar._seekBound = true;

      var postEl = bar.closest('.ig-fullscreen-post');
      var video = postEl ? postEl.querySelector('video') : null;

      function doSeek(clientX) {
        if (!video) {
          postEl = bar.closest('.ig-fullscreen-post');
          video = postEl ? postEl.querySelector('video') : null;
        }
        if (!video || !video.duration || isNaN(video.duration)) return;
        var rect = bar.getBoundingClientRect();
        var x = clientX - rect.left;
        var pct = Math.max(0, Math.min(1, x / rect.width));
        video.currentTime = pct * video.duration;
      }

      // Touch events
      bar.addEventListener('touchstart', function (e) {
        e.stopPropagation();
        e.preventDefault();
        bar.classList.add('dragging');
        doSeek(e.touches[0].clientX);
      }, { passive: false });

      bar.addEventListener('touchmove', function (e) {
        e.stopPropagation();
        e.preventDefault();
        if (e.touches.length > 0) doSeek(e.touches[0].clientX);
      }, { passive: false });

      bar.addEventListener('touchend', function (e) {
        e.stopPropagation();
        bar.classList.remove('dragging');
      });

      // Mouse events
      bar.addEventListener('mousedown', function (e) {
        e.stopPropagation();
        e.preventDefault();
        bar.classList.add('dragging');
        doSeek(e.clientX);

        function onMove(ev) {
          ev.preventDefault();
          doSeek(ev.clientX);
        }
        function onUp() {
          bar.classList.remove('dragging');
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });
  }

  /**
   * Toggle mute in fullscreen — sets global state and updates all icons.
   */
  function toggleMute(btn) {
    window._globalMuted = !window._globalMuted;
    applyGlobalMuteState();
  }

  /**
   * Handle single/double tap on fullscreen video tap zone.
   */
  var _tapTimer = null;
  function handleTap(tapZone, event) {
    event.preventDefault();
    event.stopPropagation();
    var video = tapZone.closest('.ig-cseries-media').querySelector('video');
    if (!video) return;

    if (_tapTimer) {
      clearTimeout(_tapTimer);
      _tapTimer = null;
      var postId = video.dataset.postId;
      if (postId) doubleTapLikeFullScreen(parseInt(postId), event);
      return;
    }

    _tapTimer = setTimeout(function () {
      _tapTimer = null;
      var indicator = tapZone.querySelector('.ig-cseries-pause-indicator');
      if (video.paused) {
        video.play().catch(function () {});
        if (indicator) {
          indicator.innerHTML = '<svg width="60" height="60" viewBox="0 0 24 24" fill="rgba(255,255,255,0.9)"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
          indicator.classList.add('show');
          setTimeout(function () { indicator.classList.remove('show'); }, 600);
        }
      } else {
        video.pause();
        if (indicator) {
          indicator.innerHTML = '<svg width="60" height="60" viewBox="0 0 24 24" fill="rgba(255,255,255,0.9)"><rect x="5" y="3" width="4" height="18" rx="1"/><rect x="15" y="3" width="4" height="18" rx="1"/></svg>';
          indicator.classList.add('show');
          setTimeout(function () { indicator.classList.remove('show'); }, 600);
        }
      }
    }, 250);
  }

  // ======================== Full-Screen Actions ========================

  /**
   * Double-tap like with heart animation (fullscreen).
   */
  var _fsLastTap = 0;
  function doubleTapLikeFullScreen(postId, event) {
    event.preventDefault();
    event.stopPropagation();
    var now = Date.now();
    if (now - _fsLastTap < 500) {
      var postEl = event.currentTarget ? event.currentTarget.closest('.ig-fullscreen-post') : null;
      if (!postEl) postEl = document.querySelector('.ig-fullscreen-post[data-post-id="' + postId + '"]');
      if (!postEl) return;

      var heart = document.createElement('div');
      heart.className = 'ig-cseries-heart-anim';
      heart.innerHTML = '<svg viewBox="0 0 24 24"><path d="M16.792 3.904A4.989 4.989 0 0 1 21.5 9.122c0 3.072-2.652 4.959-5.197 7.222-2.512 2.243-3.865 3.469-4.303 3.752-.477-.309-2.143-1.823-4.303-3.752C5.141 14.072 2.5 12.167 2.5 9.122a4.989 4.989 0 0 1 4.708-5.218 4.21 4.21 0 0 1 3.675 1.941c.84 1.175.98 1.763 1.12 1.763s.278-.588 1.11-1.766a4.17 4.17 0 0 1 3.679-1.938Z"/></svg>';
      postEl.appendChild(heart);
      setTimeout(function () { heart.remove(); }, 900);

      var btn = postEl.querySelector('.ig-cseries-action-btn[data-post-id="' + postId + '"]');
      if (btn && !btn.classList.contains('liked')) {
        toggleLikeFullScreen(postId, btn);
      }
    }
    _fsLastTap = now;
  }

  /**
   * Toggle like in fullscreen view.
   */
  async function toggleLikeFullScreen(postId, btn) {
    try {
      if (!btn) btn = document.querySelector('.ig-cseries-action-btn[data-post-id="' + postId + '"]');
      if (!btn) return;
      var isLiked = btn.classList.contains('liked');

      var response = await _api('/posts/' + postId + '/like', { method: 'POST' });

      btn.classList.toggle('liked');
      var svg = btn.querySelector('svg');
      if (svg) {
        svg.style.fill = isLiked ? 'none' : '#ed4956';
        svg.style.stroke = isLiked ? '#fff' : '#ed4956';
      }

      // Update count (try multiple ID prefixes)
      ['', 'pf-', 'cseries-'].forEach(function (prefix) {
        var countEl = document.getElementById(prefix + 'likes-' + postId);
        if (countEl && response && response.likes_count !== undefined) {
          countEl.textContent = formatCount(response.likes_count);
        }
      });

      // Also update feed like button if present
      var feedBtn = document.querySelector('.ig-post[data-post-id="' + postId + '"] .ig-action-btn[data-post-id="' + postId + '"]');
      if (feedBtn) {
        if (isLiked) feedBtn.classList.remove('liked');
        else feedBtn.classList.add('liked');
        var feedSvg = feedBtn.querySelector('svg');
        if (feedSvg) feedSvg.setAttribute('fill', isLiked ? 'none' : '#ed4956');
      }
      var feedLikes = document.getElementById('likes-' + postId);
      if (feedLikes && response && response.likes_count !== undefined) {
        var count = response.likes_count;
        var currentUser = _config.getUser();
        var myUsername = currentUser ? currentUser.username : 'you';
        if (!isLiked && count > 0) {
          feedLikes.innerHTML = count === 1
            ? '<span style="font-weight:400;">Liked by </span><strong>' + myUsername + '</strong>'
            : '<span style="font-weight:400;">Liked by </span><strong>' + myUsername + '</strong><span style="font-weight:400;"> and </span><strong>' + (count - 1) + ' other' + (count > 2 ? 's' : '') + '</strong>';
        } else if (count > 0) {
          feedLikes.innerHTML = '<strong>' + count + ' ' + (count === 1 ? 'like' : 'likes') + '</strong>';
        } else {
          feedLikes.innerHTML = '';
        }
      }
    } catch (error) {
      console.error('Error toggling like:', error);
    }
  }

  /**
   * Toggle save in fullscreen view.
   */
  async function toggleSaveFullScreen(postId, btn) {
    try {
      if (!btn) {
        btn = document.querySelector('.ig-fullscreen-post[data-post-id="' + postId + '"] .ig-cseries-action-btn.saved')
          || document.querySelector('.ig-fullscreen-post[data-post-id="' + postId + '"] .ig-cseries-action-btn:nth-child(5)');
      }
      if (!btn) return;

      await _api('/posts/' + postId + '/save', { method: 'POST' });
      btn.classList.toggle('saved');
      var svg = btn.querySelector('svg');
      if (svg) svg.style.fill = btn.classList.contains('saved') ? '#fff' : 'none';
    } catch (error) {
      console.error('Error toggling save:', error);
    }
  }

  /**
   * Expand/collapse caption in fullscreen overlay.
   */
  function expandCaption(postId, idPrefix) {
    idPrefix = idPrefix || '';
    // Try multiple prefixes
    var captionEl = document.getElementById(idPrefix + 'caption-' + postId)
      || document.getElementById('cseries-caption-' + postId)
      || document.getElementById('pf-caption-' + postId);
    var detailsEl = document.getElementById(idPrefix + 'details-' + postId)
      || document.getElementById('cseries-details-' + postId)
      || document.getElementById('pf-details-' + postId);
    var moreBtn = captionEl ? captionEl.parentElement.querySelector('.ig-cseries-caption-more') : null;
    if (!captionEl) return;

    var isExpanded = captionEl.classList.contains('expanded');
    if (isExpanded) {
      captionEl.classList.remove('expanded');
      if (detailsEl) detailsEl.classList.remove('expanded');
      if (moreBtn) { moreBtn.textContent = '... more'; moreBtn.style.display = ''; }
    } else {
      captionEl.classList.add('expanded');
      if (detailsEl) detailsEl.classList.add('expanded');
      if (moreBtn) moreBtn.textContent = 'less';
    }
  }

  /**
   * Follow user from fullscreen view.
   */
  async function followUserFullScreen(userId, btn) {
    try {
      await _api('/users/' + userId + '/follow', { method: 'POST' });
      btn.textContent = 'Following';
      btn.style.background = 'rgba(255,255,255,0.2)';
      btn.style.border = '1px solid rgba(255,255,255,0.4)';
      btn.disabled = true;
    } catch (error) {
      console.error('Follow error:', error);
    }
  }

  // ======================== Feed Actions ========================

  /**
   * Toggle like on a feed post.
   */
  async function toggleLikeFeed(postId) {
    try {
      var btn = document.querySelector('.ig-action-btn[data-post-id="' + postId + '"]');
      if (!btn) return;
      var isLiked = btn.classList.contains('liked');

      var response = await _api('/posts/' + postId + '/like', { method: 'POST' });

      btn.classList.toggle('liked');
      var svg = btn.querySelector('svg');
      svg.setAttribute('fill', isLiked ? 'none' : '#ed4956');

      var likesEl = document.getElementById('likes-' + postId);
      var likesSection = document.getElementById('likes-section-' + postId);
      if (likesEl && response && response.likes_count !== undefined) {
        var count = response.likes_count;
        if (count === 0) {
          likesEl.innerHTML = '';
          if (likesSection) likesSection.style.display = 'none';
        } else {
          if (likesSection) likesSection.style.display = '';
          var currentUser = _config.getUser();
          var myUsername = currentUser ? currentUser.username : 'you';
          if (!isLiked) {
            likesEl.innerHTML = count === 1
              ? '<span style="font-weight:400;">Liked by </span><strong>' + myUsername + '</strong>'
              : '<span style="font-weight:400;">Liked by </span><strong>' + myUsername + '</strong><span style="font-weight:400;"> and </span><strong>' + (count - 1) + ' other' + (count > 2 ? 's' : '') + '</strong>';
          } else {
            likesEl.innerHTML = '<strong>' + count + ' ' + (count === 1 ? 'like' : 'likes') + '</strong>';
          }
        }
      }
    } catch (error) {
      console.error('Error toggling like:', error);
    }
  }

  /**
   * Double-tap like with heart animation (feed).
   */
  var _feedLastTap = 0;
  function doubleTapLikeFeed(postId, event) {
    event.preventDefault();
    event.stopPropagation();
    var now = Date.now();
    if (now - _feedLastTap < 500) {
      var target = event.currentTarget.closest('[data-post-id]') || event.currentTarget.parentElement;
      var heart = document.createElement('div');
      heart.className = 'ig-heart-overlay';
      heart.innerHTML = '<svg viewBox="0 0 24 24"><path d="M16.792 3.904A4.989 4.989 0 0 1 21.5 9.122c0 3.072-2.652 4.959-5.197 7.222-2.512 2.243-3.865 3.469-4.303 3.752-.477-.309-2.143-1.823-4.303-3.752C5.141 14.072 2.5 12.167 2.5 9.122a4.989 4.989 0 0 1 4.708-5.218 4.21 4.21 0 0 1 3.675 1.941c.84 1.175.98 1.763 1.12 1.763s.278-.588 1.11-1.766a4.17 4.17 0 0 1 3.679-1.938Z"/></svg>';
      target.style.position = 'relative';
      target.appendChild(heart);
      setTimeout(function () { heart.remove(); }, 900);
      toggleLikeFeed(postId);
    }
    _feedLastTap = now;
  }

  /**
   * Toggle video play/pause (feed inline video).
   */
  function toggleVideoPlay(videoEl, event) {
    event.preventDefault();
    event.stopPropagation();
    var container = videoEl.closest('.ig-post-video-container');
    if (videoEl.paused) {
      videoEl.play();
      if (container) container.classList.remove('paused');
    } else {
      videoEl.pause();
      if (container) container.classList.add('paused');
    }
  }

  /**
   * Toggle video sound (feed videos).
   */
  function toggleVideoSound(btn, event) {
    event.preventDefault();
    event.stopPropagation();
    window._globalMuted = !window._globalMuted;
    applyGlobalMuteState();
  }

  /**
   * Toggle save on a feed post.
   */
  async function toggleSaveFeed(postId) {
    try {
      await _api('/posts/' + postId + '/save', { method: 'POST' });
      var btn = document.querySelector('.ig-post[data-post-id="' + postId + '"] .ig-action-btn.saved, .ig-post[data-post-id="' + postId + '"] .ig-post-actions button:last-child');
      if (btn) {
        btn.classList.toggle('saved');
        var svg = btn.querySelector('svg');
        svg.setAttribute('fill', btn.classList.contains('saved') ? 'currentColor' : 'none');
      }
    } catch (error) {
      console.error('Error toggling save:', error);
    }
  }

  /**
   * Auto-play feed videos when they scroll into view.
   */
  function setupFeedVideoAutoplay() {
    // Disconnect previous feed observer if any
    if (window._feedVideoObserver) {
      window._feedVideoObserver.disconnect();
      window._feedVideoObserver = null;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var video = entry.target;
        if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
          // Do NOT play feed videos while a fullscreen viewer is open
          if (document.querySelector('.ig-fullscreen-viewer')) {
            video.pause();
            return;
          }
          video.muted = window._globalMuted;
          video.play().catch(function () {
            video.muted = true;
            video.play().catch(function () {});
          });
          var container = video.closest('.ig-post-video-container');
          if (container) container.classList.remove('paused');
        } else {
          video.pause();
          var container2 = video.closest('.ig-post-video-container');
          if (container2) container2.classList.add('paused');
        }
      });
    }, { threshold: [0.6] });

    window._feedVideoObserver = observer;
    document.querySelectorAll('.ig-post-video-container video').forEach(function (v) { observer.observe(v); });
  }

  /**
   * Pause ALL videos on the page (feed + fullscreen + any other).
   */
  function pauseAllVideos() {
    document.querySelectorAll('video').forEach(function (v) {
      v.pause();
    });
  }

  // ======================== Poll ========================

  /**
   * Vote on a poll.
   */
  async function votePoll(postId, pollId, option) {
    try {
      var response = await _api('/posts/' + postId + '/poll/' + pollId + '/vote', {
        method: 'POST',
        body: JSON.stringify({ option: option }),
      });
      if (response && response.success) {
        _config.showAlert('Vote recorded!', 'success');
        if (response.votes) {
          var pollData = { votes: response.votes };
          document.querySelectorAll('.ig-poll[data-post-id="' + postId + '"], .ig-cseries-poll[data-post-id="' + postId + '"]').forEach(function (pollEl) {
            updatePollUI(pollEl, pollData, option);
          });
        }
        _config.refreshPosts();
      }
    } catch (error) {
      _config.showAlert(error.message || 'Failed to vote', 'error');
    }
  }

  /**
   * Update poll UI in-place without full reload.
   */
  function updatePollUI(pollEl, pollData, votedOption) {
    var votes = pollData.votes || {};
    var totalVotes = Object.values(votes).reduce(function (a, b) { return a + b; }, 0);
    var options = pollEl.querySelectorAll('.poll-option');
    options.forEach(function (optEl) {
      var labelSpans = optEl.querySelectorAll('.poll-option-label span');
      if (labelSpans.length < 2) return;
      var optionText = labelSpans[0].textContent.replace(/^✓\s*/, '').trim();
      var voteCount = votes[optionText] || 0;
      var percentage = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;
      var isSelected = optionText === votedOption;

      var bar = optEl.querySelector('.poll-bar');
      if (bar) {
        bar.style.width = percentage + '%';
        bar.style.opacity = isSelected ? '0.35' : '';
      }

      labelSpans[0].textContent = (isSelected ? '✓ ' : '') + optionText;
      labelSpans[1].textContent = percentage + '%';
      optEl.classList.toggle('poll-voted', isSelected);
    });

    var voteInfo = pollEl.querySelector('div:last-child');
    if (voteInfo) {
      var countSpan = voteInfo.querySelector('span:first-child');
      if (countSpan) countSpan.textContent = totalVotes + ' vote' + (totalVotes !== 1 ? 's' : '');
      if (!voteInfo.querySelector('span[style*="color:var(--ig-blue)"]')) {
        var youVoted = document.createElement('span');
        youVoted.style.color = 'var(--ig-blue)';
        youVoted.textContent = 'You voted';
        voteInfo.appendChild(youVoted);
      }
    }
  }

  // ======================== Contact / Interested ========================

  async function handleContactMe(postId) {
    try {
      await _api('/posts/' + postId + '/action', {
        method: 'POST',
        body: JSON.stringify({ action_type: 'contact' }),
      });
      _config.showAlert('Request sent! The user will be notified.', 'success');
    } catch (error) {
      _config.showAlert(error.message || 'Failed', 'error');
    }
  }

  async function handleInterested(postId) {
    try {
      await _api('/posts/' + postId + '/action', {
        method: 'POST',
        body: JSON.stringify({ action_type: 'interested' }),
      });
      _config.showAlert('Your interest has been noted!', 'success');
    } catch (error) {
      _config.showAlert(error.message || 'Failed', 'error');
    }
  }

  // ======================== Linkify Caption (default) ========================

  /**
   * Default linkifyCaption implementation.
   * Pages can override via _config.linkifyCaption.
   */
  function linkifyCaptionDefault(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.textContent = text;
    var escaped = div.innerHTML;

    var hashtagPlaceholders = [];
    escaped = escaped.replace(/(^|\s)#(\w+)/g, function (match, space, tag) {
      var idx = hashtagPlaceholders.length;
      hashtagPlaceholders.push(space + '<span class="ig-caption-link">#' + tag + '</span>');
      return '__HASHTAG_' + idx + '__';
    });

    var mentionPlaceholders = [];
    escaped = escaped.replace(/(^|\s)@(\w[\w.]*)/g, function (match, space, username) {
      var idx = mentionPlaceholders.length;
      mentionPlaceholders.push(space + '<a href="/profile/' + username + '" class="ig-caption-link" onclick="event.stopPropagation();">@' + username + '</a>');
      return '__MENTION_' + idx + '__';
    });

    escaped = escaped.replace(/(https?:\/\/[^\s<]+)/gi, function (url) {
      var display = url.replace(/^https?:\/\/(www\.)?/, '');
      if (display.length > 50) display = display.substring(0, 47) + '...';
      return '<a href="' + url + '" target="_blank" rel="noopener" class="ig-caption-link" onclick="event.stopPropagation();">' + display + '</a>';
    });

    hashtagPlaceholders.forEach(function (val, idx) {
      escaped = escaped.replace('__HASHTAG_' + idx + '__', val);
    });
    mentionPlaceholders.forEach(function (val, idx) {
      escaped = escaped.replace('__MENTION_' + idx + '__', val);
    });
    return escaped;
  }

  // ======================== Public API ========================

  var publicAPI = {
    init: init,

    // Utilities
    escapeHtml: escapeHtml,
    formatTimeShort: formatTimeShort,
    formatTimeAgo: formatTimeAgo,
    formatCount: formatCount,
    linkifyCaptionDefault: linkifyCaptionDefault,
    getMutedIconSvg: getMutedIconSvg,
    getUnmutedIconSvg: getUnmutedIconSvg,

    // Feed post card
    createFeedPost: createFeedPost,

    // Full-screen post HTML
    createFullScreenPostHTML: createFullScreenPostHTML,

    // Grid item
    createGridItem: createGridItem,

    // Full-screen viewer lifecycle
    openFullScreenViewer: openFullScreenViewer,
    renderFullScreenPosts: renderFullScreenPosts,
    closeFullScreenViewer: closeFullScreenViewer,

    // Video autoplay
    setupVideoAutoplay: setupVideoAutoplay,
    setupFeedVideoAutoplay: setupFeedVideoAutoplay,
    pauseAllVideos: pauseAllVideos,
    applyGlobalMuteState: applyGlobalMuteState,

    // Video controls
    seekVideo: seekVideo,
    toggleMute: toggleMute,
    handleTap: handleTap,
    setupProgressBarInteraction: setupProgressBarInteraction,

    // Carousel (feed)
    initCarousel: initCarousel,
    carouselNext: carouselNext,
    carouselPrev: carouselPrev,
    carouselGoTo: carouselGoTo,
    updateCarousel: updateCarousel,
    enableCarouselSwipe: enableCarouselSwipe,

    // Carousel (fullscreen)
    fsCarouselNav: fsCarouselNav,
    fsCarouselNext: fsCarouselNext,
    fsCarouselPrev: fsCarouselPrev,
    fsCarouselGoTo: fsCarouselGoTo,

    // Full-screen actions
    doubleTapLikeFullScreen: doubleTapLikeFullScreen,
    toggleLikeFullScreen: toggleLikeFullScreen,
    toggleSaveFullScreen: toggleSaveFullScreen,
    expandCaption: expandCaption,
    followUserFullScreen: followUserFullScreen,

    // Feed actions
    toggleLikeFeed: toggleLikeFeed,
    doubleTapLikeFeed: doubleTapLikeFeed,
    toggleVideoPlay: toggleVideoPlay,
    toggleVideoSound: toggleVideoSound,
    toggleSaveFeed: toggleSaveFeed,

    // Poll
    votePoll: votePoll,
    updatePollUI: updatePollUI,

    // Contact / Interested
    handleContactMe: handleContactMe,
    handleInterested: handleInterested,
  };

  // Expose ALL public functions on window for onclick="" handlers
  Object.keys(publicAPI).forEach(function (k) {
    window[k] = publicAPI[k];
  });

  // ======================== Aliases for backward compatibility ========================

  // Profile.html aliases
  window.closeProfileFullScreen = function () { closeFullScreenViewer('pfFullScreenViewer', { observerKey: 'pf' }); };
  window.pfDoubleTapLike = doubleTapLikeFullScreen;
  window.pfToggleLike = toggleLikeFullScreen;
  window.pfToggleSave = toggleSaveFullScreen;
  window.pfFollowUser = followUserFullScreen;
  window.pfExpandCaption = function (postId) { expandCaption(postId, 'pf-'); };
  window.pfFsCarousel = function (id, dir, total) { fsCarouselNav(id, dir, total, 'pf-'); };
  window.pfSetupVideoAutoplay = function () {
    var content = document.getElementById('pfFullScreenContent');
    if (content) setupVideoAutoplay(content, { idPrefix: 'pf-' });
  };
  window.pfSeekVideo = seekVideo;
  window.pfToggleMute = toggleMute;
  window.pfHandleTap = handleTap;
  window.pfDoubleTapLikeCreatorSeries = doubleTapLikeFullScreen;

  // Home.html Creator Series aliases
  window.closeFullScreenPost = function () { closeFullScreenViewer('fullScreenPostViewer', { observerKey: 'cseries' }); };
  window.toggleLikeCreatorSeries = toggleLikeFullScreen;
  window.toggleSaveCreatorSeries = toggleSaveFullScreen;
  window.expandCreatorSeriesCaption = function (postId) { expandCaption(postId, ''); };
  window.followUserFromCreatorSeries = followUserFullScreen;
  window.handleCreatorSeriesTap = handleTap;
  window.seekCreatorSeriesVideo = seekVideo;
  window.toggleCreatorSeriesMute = toggleMute;
  window.doubleTapLikeCreatorSeries = doubleTapLikeFullScreen;
  window.setupCreatorSeriesVideoAutoplay = function () {
    var content = document.getElementById('fullScreenContent');
    if (content) setupVideoAutoplay(content, { idPrefix: '' });
  };

  // Legacy feed function aliases
  window.toggleLike = toggleLikeFeed;
  window.doubleTapLike = doubleTapLikeFeed;
  window.toggleSave = toggleSaveFeed;
  window.setupVideoAutoplay = setupFeedVideoAutoplay;

  // Compact format alias
  window.formatCompact = formatCount;

  // ======================== Custom Button Action Modal ========================
  // Shared across home.html and profile.html — shows the action sheet when
  // a user taps the custom button on a post (Register, Contact, DM, Hire Me).

  function openCustomButtonModal(postId, postUserId, configJson) {
    var config = typeof configJson === 'string' ? JSON.parse(configJson) : configJson;
    var currentUser = _config.getUser ? _config.getUser() : null;
    var isOwnPost = currentUser && currentUser.id == postUserId;

    // Normalize legacy field names
    if (config.contact && !config.contact_me) config.contact_me = config.contact;
    if (config.hire && !config.hire_me) config.hire_me = config.hire;

    // Detect enabled actions (tolerate missing "enabled")
    var hasContact = config.contact_me && (config.contact_me.enabled !== false) && (
      (config.contact_me.links && config.contact_me.links.length) ||
      (config.contact_me.emails && config.contact_me.emails.length) ||
      (config.contact_me.phones && config.contact_me.phones.length)
    );
    var hasRegister = config.register && (config.register.enabled !== false) && config.register.link;
    var hasDM = config.dm && (config.dm.enabled !== false) && !isOwnPost;
    var hasHireMe = config.hire_me && (config.hire_me.enabled !== false) && !isOwnPost;
    var enabledCount = [hasContact, hasRegister, hasDM, hasHireMe].filter(Boolean).length;

    // If only one action, open directly
    if (enabledCount === 1) {
      if (hasRegister) {
        window.open(config.register.link, '_blank', 'noopener');
        return;
      }
      if (hasContact) {
        var c = config.contact_me;
        var allItems = [].concat(c.links || [], (c.emails || []).map(function(e){return 'mailto:'+e;}), (c.phones || []).map(function(p){return 'tel:'+p;}));
        if (allItems.length === 1) {
          window.open(allItems[0], '_blank', 'noopener');
          return;
        }
      }
    }

    // Remove existing modal
    var existing = document.getElementById('cbActionModal');
    if (existing) existing.remove();

    var sections = '';

    // Contact Me section
    if (config.contact_me && config.contact_me.enabled !== false) {
      var items = '';
      (config.contact_me.links || []).forEach(function(link) {
        items += '<a href="' + escapeHtml(link) + '" target="_blank" rel="noopener" class="cb-contact-item">'
          + '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ig-blue)" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>'
          + '<span>' + escapeHtml(link) + '</span></a>';
      });
      (config.contact_me.emails || []).forEach(function(email) {
        items += '<a href="mailto:' + escapeHtml(email) + '" class="cb-contact-item">'
          + '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e1306c" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>'
          + '<span>' + escapeHtml(email) + '</span></a>';
      });
      (config.contact_me.phones || []).forEach(function(phone) {
        items += '<a href="tel:' + escapeHtml(phone) + '" class="cb-contact-item">'
          + '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00c853" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.42 19.42 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>'
          + '<span>' + escapeHtml(phone) + '</span></a>';
      });
      if (items) {
        sections += '<div class="cb-modal-section"><div class="cb-modal-section-title">\uD83D\uDCDE Contact Information</div>' + items + '</div>';
      }
    }

    // Register section
    if (config.register && config.register.enabled !== false && config.register.link) {
      sections += '<div class="cb-modal-section"><div class="cb-modal-section-title">\uD83D\uDCDD Register</div>'
        + '<a href="' + escapeHtml(config.register.link) + '" target="_blank" rel="noopener" class="cb-contact-item" style="color: var(--ig-blue); font-weight: 600;">'
        + '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ig-blue)" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>'
        + '<span>Open Registration Page</span></a></div>';
    }

    // DM section
    if (config.dm && config.dm.enabled !== false && !isOwnPost) {
      var prefilledMsg = config.dm.message ? escapeHtml(config.dm.message) : '';
      sections += '<div class="cb-modal-section"><div class="cb-modal-section-title">\uD83D\uDCAC Send Message</div>'
        + '<div class="cb-dm-input-area">'
        + '<textarea id="cbDMActionMsg" placeholder="Write your message..." rows="3">' + prefilledMsg + '</textarea>'
        + '<button class="cb-submit-btn" onclick="sendCustomDM(' + postId + ', this)">Send Message</button>'
        + '</div></div>';
    }

    // Hire Me section
    if (config.hire_me && config.hire_me.enabled !== false && !isOwnPost) {
      var formFields = '';
      var fields = config.hire_me.fields || [];
      if (fields.indexOf('name') !== -1) formFields += '<div class="cb-hire-form-group"><label>\uD83D\uDC64 Name</label><input type="text" id="cbHireFormName" placeholder="Your full name" required></div>';
      if (fields.indexOf('email') !== -1) formFields += '<div class="cb-hire-form-group"><label>\uD83D\uDCE7 Email</label><input type="email" id="cbHireFormEmail" placeholder="your@email.com" required></div>';
      if (fields.indexOf('contact') !== -1) formFields += '<div class="cb-hire-form-group"><label>\uD83D\uDCDE Contact Number</label><input type="tel" id="cbHireFormContact" placeholder="+1234567890"></div>';
      if (fields.indexOf('resume_link') !== -1) formFields += '<div class="cb-hire-form-group"><label>\uD83D\uDCCE Resume Link</label><input type="url" id="cbHireFormResume" placeholder="https://drive.google.com/..."></div>';
      (config.hire_me.custom_fields || []).forEach(function(fieldName, idx) {
        formFields += '<div class="cb-hire-form-group"><label>\uD83D\uDCDD ' + escapeHtml(fieldName) + '</label><input type="text" class="cb-hire-custom-input" data-field-name="' + escapeHtml(fieldName) + '" placeholder="Enter ' + escapeHtml(fieldName) + '"></div>';
      });
      if (formFields) {
        sections += '<div class="cb-modal-section"><div class="cb-modal-section-title">\uD83D\uDCBC Hire Me - Application Form</div>'
          + '<form id="cbHireForm" onsubmit="submitHireForm(event, ' + postId + ')">'
          + formFields
          + '<button type="submit" class="cb-submit-btn">Submit Application</button></form></div>';
      }
    }

    if (!sections) {
      if (_config.showAlert) _config.showAlert('No actions available', 'info');
      return;
    }

    var modal = document.createElement('div');
    modal.id = 'cbActionModal';
    modal.className = 'cb-modal-overlay';
    modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
    modal.innerHTML = '<div class="cb-modal" onclick="event.stopPropagation()">'
      + '<div class="cb-modal-header"><h3 class="cb-modal-title">' + escapeHtml(config.name || 'Action') + '</h3>'
      + '<button class="cb-modal-close" onclick="document.getElementById(\'cbActionModal\').remove()">\u00D7</button></div>'
      + '<div class="cb-modal-body">' + sections + '</div></div>';
    document.body.appendChild(modal);
  }

  function sendCustomDM(postId, btn) {
    var textarea = document.getElementById('cbDMActionMsg');
    var message = textarea ? textarea.value.trim() : '';
    if (!message) {
      if (_config.showAlert) _config.showAlert('Please enter a message', 'error');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Sending...';

    var doRequest = _config.apiRequest || function(url, opts) {
      return fetch('/api' + url, Object.assign({}, opts, {
        headers: Object.assign({ 'Authorization': 'Bearer ' + localStorage.getItem('token'), 'Content-Type': 'application/json' }, (opts && opts.headers) || {})
      })).then(function(r) { if (!r.ok) throw new Error('Request failed'); return r.json(); });
    };

    doRequest('/posts/' + postId + '/custom-button-action', {
      method: 'POST',
      body: JSON.stringify({ action: 'dm', message: message })
    }).then(function() {
      if (_config.showAlert) _config.showAlert('Message sent successfully!', 'success');
      var m = document.getElementById('cbActionModal');
      if (m) m.remove();
    }).catch(function(error) {
      if (_config.showAlert) _config.showAlert(error.message || 'Failed to send message', 'error');
      btn.disabled = false;
      btn.textContent = 'Send Message';
    });
  }

  function submitHireForm(event, postId) {
    event.preventDefault();
    var form = document.getElementById('cbHireForm');
    var submitBtn = form.querySelector('.cb-submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    var hire_data = {};
    var nameInput = document.getElementById('cbHireFormName');
    var emailInput = document.getElementById('cbHireFormEmail');
    var contactInput = document.getElementById('cbHireFormContact');
    var resumeInput = document.getElementById('cbHireFormResume');

    if (nameInput) hire_data.name = nameInput.value.trim();
    if (emailInput) hire_data.email = emailInput.value.trim();
    if (contactInput) hire_data.contact = contactInput.value.trim();
    if (resumeInput) hire_data.resume_link = resumeInput.value.trim();

    var customFields = {};
    form.querySelectorAll('.cb-hire-custom-input').forEach(function(inp) {
      var fieldName = inp.getAttribute('data-field-name');
      if (fieldName && inp.value.trim()) customFields[fieldName] = inp.value.trim();
    });
    if (Object.keys(customFields).length > 0) hire_data.custom_fields = customFields;

    if (!hire_data.name && !hire_data.email && !hire_data.contact && !hire_data.resume_link && Object.keys(customFields).length === 0) {
      if (_config.showAlert) _config.showAlert('Please fill in at least one field', 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Application';
      return;
    }

    var doRequest = _config.apiRequest || function(url, opts) {
      return fetch('/api' + url, Object.assign({}, opts, {
        headers: Object.assign({ 'Authorization': 'Bearer ' + localStorage.getItem('token'), 'Content-Type': 'application/json' }, (opts && opts.headers) || {})
      })).then(function(r) { if (!r.ok) throw new Error('Request failed'); return r.json(); });
    };

    doRequest('/posts/' + postId + '/custom-button-action', {
      method: 'POST',
      body: JSON.stringify({ action: 'hire_me', hire_data: hire_data })
    }).then(function() {
      if (_config.showAlert) _config.showAlert('Application submitted successfully! Details sent to the post creator.', 'success');
      var m = document.getElementById('cbActionModal');
      if (m) m.remove();
    }).catch(function(error) {
      if (_config.showAlert) _config.showAlert(error.message || 'Failed to submit application', 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Application';
    });
  }

  // Expose custom button modal functions globally
  window.openCustomButtonModal = openCustomButtonModal;
  window.sendCustomDM = sendCustomDM;
  window.submitHireForm = submitHireForm;

  return publicAPI;
})();
