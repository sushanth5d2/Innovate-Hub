/**
 * PostModal — Unified Create / Edit Post & Creator Series Modal
 *
 * Usage:
 *   PostModal.init('postModalContainer', { prefix: '', getUser: fn, refreshPosts: fn });
 *   PostModal.openCreate();                    // Create mode
 *   PostModal.openEdit(postId);                // Edit mode (fetches post data)
 *   PostModal.close();
 *
 * Any feature added to the HTML template or JS here automatically
 * works in **both** Create and Edit flows — Instagram-style.
 */
const PostModal = (function () {
  'use strict';

  // ========== STATE ==========
  var mode = 'create'; // 'create' | 'edit'
  var activeTab = 'post';
  var prefix = '';
  var containerId = '';

  // Edit-specific
  var editPostId = null;
  var editPostData = null;

  // Media state (Post tab)
  var selectedImages = [];
  var selectedFiles = [];
  var existingImages = [];
  var existingFiles = [];

  // Creator Series state
  var csVideoFile = null;
  var existingVideoUrl = null;
  var csTrimStart = 0;
  var csTrimEnd = 1;
  var csCoverTime = 0;
  var csDuration = 0;

  // Config callbacks
  var _getUser = function () { return null; };
  var _refreshPosts = function () {};

  var CHUNK_SIZE = 4 * 1024 * 1024;
  var PARALLEL_UPLOADS = 6;
  var pollColors = ['#0095f6', '#e1306c', '#833ab4', '#fd1d1d', '#f77737', '#50c878'];
  var hashtagDebounceTimer = null;
  var mentionDebounceTimer = null;

  // ========== HELPERS ==========
  function el(id) {
    return document.getElementById(prefix + id);
  }

  function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // ========== HTML TEMPLATE ==========
  function generateHTML() {
    var p = prefix;
    /* Every element ID is prefixed so two instances (home / profile) never clash. */
    return '' +
    '<div id="' + p + 'postModalOverlay" class="cp-overlay" style="display:none" onclick="if(event.target===this)PostModal.close()">' +
      '<div class="cp-container" onclick="event.stopPropagation()">' +
        '<!-- Header -->' +
        '<div class="cp-header">' +
          '<button class="cp-header-btn" onclick="PostModal.close()">' +
            '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
          '</button>' +
          '<h2 class="cp-header-title" id="' + p + 'pmTitle">Create new post</h2>' +
          '<button class="cp-share-btn" onclick="PostModal.submit()" id="' + p + 'pmShareBtn">Share</button>' +
        '</div>' +

        '<!-- Tab Switcher -->' +
        '<div class="cr-tab-bar">' +
          '<button class="cr-tab active" id="' + p + 'pmTabPost" onclick="PostModal.switchTab(\'post\')">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> Post' +
          '</button>' +
          '<button class="cr-tab" id="' + p + 'pmTabSeries" onclick="PostModal.switchTab(\'series\')">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/></svg> Creator Series' +
          '</button>' +
        '</div>' +

        '<!-- Body -->' +
        '<div class="cp-body">' +
          '<!-- User Info -->' +
          '<div class="cp-user-row">' +
            '<img id="' + p + 'pmUserAvatar" src="/images/default-avatar.svg" alt="" class="cp-avatar">' +
            '<span class="cp-username" id="' + p + 'pmUsername"></span>' +
          '</div>' +

          '<!-- Caption -->' +
          '<div class="cp-caption-wrap">' +
            '<textarea id="' + p + 'pmCaption" class="cp-caption" placeholder="Write the content or caption..." rows="4" oninput="PostModal.onCaptionInput(this)"></textarea>' +
            '<div class="cp-char-count"><span id="' + p + 'pmCharCount">0</span> / 2,200</div>' +
          '</div>' +

          '<!-- Hashtag Suggestions -->' +
          '<div id="' + p + 'pmHashtagSuggestions" class="cp-hashtag-suggestions" style="display:none;">' +
            '<div class="cp-hashtag-header"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg><span>Suggested Hashtags</span></div>' +
            '<div id="' + p + 'pmHashtagList" class="cp-hashtag-list"></div>' +
          '</div>' +

          '<!-- @Mention Suggestions -->' +
          '<div id="' + p + 'pmMentionSuggestions" style="display:none; background: var(--ig-primary-background); border: 1px solid var(--ig-border); border-radius: 12px; margin: 4px 0 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.15); max-height: 240px; overflow-y: auto;">' +
            '<div style="padding: 8px 12px; font-size: 12px; font-weight: 600; color: var(--ig-secondary-text); display: flex; align-items: center; gap: 6px; border-bottom: 1px solid var(--ig-border);">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' +
              '<span>Tag People</span>' +
            '</div>' +
            '<div id="' + p + 'pmMentionList"></div>' +
          '</div>' +

          '<!-- Trending Hashtags -->' +
          '<div id="' + p + 'pmTrendingSection" class="cp-trending-section">' +
            '<div class="cp-trending-header" onclick="PostModal.toggleTrending()">' +
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ig-blue)" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>' +
              '<span>Trending</span>' +
              '<svg class="cp-trending-chevron" id="' + p + 'pmTrendingChevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>' +
            '</div>' +
            '<div id="' + p + 'pmTrendingList" class="cp-trending-list" style="display:none;"></div>' +
          '</div>' +

          '<!-- ===== POST TAB ===== -->' +
          '<div id="' + p + 'pmPostSection" class="cr-media-section">' +
            '<div id="' + p + 'pmExistingMedia" class="cp-media-grid"></div>' +
            '<div id="' + p + 'pmMediaPreview" class="cp-media-grid"></div>' +
            '<div id="' + p + 'pmExistingFiles" class="cp-files-list"></div>' +
            '<div class="cp-toolbar">' +
              '<label class="cp-tool-btn" title="Photos & Videos">' +
                '<input type="file" id="' + p + 'pmMediaInput" accept="image/*,video/*" multiple style="display:none" onchange="PostModal.onMediaSelected(this)">' +
                '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' +
                '<span class="cp-tool-label">Photo/Video</span>' +
              '</label>' +
              '<label class="cp-tool-btn" title="Attach Files">' +
                '<input type="file" id="' + p + 'pmFileInput" accept=".pdf,.doc,.docx,.txt,.zip,.xls,.xlsx,.ppt,.pptx" multiple style="display:none" onchange="PostModal.onFilesSelected(this)">' +
                '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>' +
                '<span class="cp-tool-label">Files</span>' +
              '</label>' +
              '<button class="cp-tool-btn" onclick="PostModal.togglePoll()" title="Poll" id="' + p + 'pmPollToggleBtn">' +
                '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="6" height="18" rx="1"/><rect x="15" y="8" width="6" height="13" rx="1"/><rect x="9" y="11" width="6" height="10" rx="1"/></svg>' +
                '<span class="cp-tool-label">Poll</span>' +
              '</button>' +
              '<button class="cp-tool-btn" onclick="PostModal.toggleSchedule()" title="Schedule" id="' + p + 'pmScheduleToggleBtn">' +
                '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
                '<span class="cp-tool-label">Schedule</span>' +
              '</button>' +
            '</div>' +
          '</div>' +

          '<!-- ===== CREATOR SERIES TAB ===== -->' +
          '<div id="' + p + 'pmSeriesSection" class="cr-media-section" style="display:none">' +
            '<!-- Upload Zone -->' +
            '<div id="' + p + 'pmCSUploadZone" class="cr-cseries-upload-zone">' +
              '<input type="file" id="' + p + 'pmCSVideoInput" accept="video/*" style="display:none" onchange="PostModal.onCSVideoSelected(this)">' +
              '<div class="cr-cseries-upload-placeholder" onclick="document.getElementById(\'' + p + 'pmCSVideoInput\').click()">' +
                '<div class="cr-cseries-upload-icon">' +
                  '<svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="var(--ig-secondary-text)" stroke-width="1.2"><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/></svg>' +
                '</div>' +
                '<p class="cr-cseries-upload-text">Tap to upload a video</p>' +
                '<p class="cr-cseries-upload-hint">MP4, MOV, WebM \u00B7 No time limit</p>' +
              '</div>' +
            '</div>' +

            '<!-- Video Preview (hidden until video selected/loaded) -->' +
            '<div id="' + p + 'pmCSPreview" class="cr-cseries-preview" style="display:none">' +
              '<div class="cr-cseries-video-wrap">' +
                '<video id="' + p + 'pmCSVideo" class="cr-cseries-video" playsinline></video>' +
                '<div class="cr-cseries-play-overlay" onclick="PostModal.toggleCSPlayback()">' +
                  '<svg width="48" height="48" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>' +
                '</div>' +
                '<div class="cr-cseries-duration" id="' + p + 'pmCSDuration">0:00</div>' +
                '<button class="cr-cseries-change-btn" onclick="PostModal.changeCSVideo()">' +
                  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg> Change' +
                '</button>' +
              '</div>' +

              '<!-- Trim -->' +
              '<div class="cr-trim-section">' +
                '<div class="cr-trim-header">' +
                  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ig-blue)" stroke-width="2"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>' +
                  '<span>Trim Video</span>' +
                '</div>' +
                '<div class="cr-trim-timeline" id="' + p + 'pmTrimTimeline">' +
                  '<canvas id="' + p + 'pmTrimCanvas" class="cr-trim-canvas" height="48"></canvas>' +
                  '<div class="cr-trim-handle cr-trim-start" id="' + p + 'pmTrimHandleStart"></div>' +
                  '<div class="cr-trim-handle cr-trim-end" id="' + p + 'pmTrimHandleEnd"></div>' +
                  '<div class="cr-trim-progress" id="' + p + 'pmTrimProgress"></div>' +
                '</div>' +
                '<div class="cr-trim-times">' +
                  '<span id="' + p + 'pmTrimStartTime">0:00</span>' +
                  '<span id="' + p + 'pmTrimDurationLabel">Duration: 0:00</span>' +
                  '<span id="' + p + 'pmTrimEndTime">0:00</span>' +
                '</div>' +
              '</div>' +

              '<!-- Cover -->' +
              '<div class="cr-cover-section">' +
                '<div class="cr-cover-header">' +
                  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ig-blue)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' +
                  '<span>Cover</span>' +
                '</div>' +
                '<div class="cr-cover-thumbnails" id="' + p + 'pmCoverThumbnails"></div>' +
                '<div class="cr-cover-preview">' +
                  '<canvas id="' + p + 'pmCoverCanvas" class="cr-cover-canvas" width="120" height="213"></canvas>' +
                  '<p class="cr-cover-hint">Tap a frame above to set as cover</p>' +
                '</div>' +
              '</div>' +

              '<!-- Audio -->' +
              '<div class="cr-audio-section">' +
                '<div class="cr-audio-header" onclick="PostModal.toggleAudioSection()">' +
                  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>' +
                  '<span>Audio</span>' +
                  '<svg class="cr-audio-chevron" id="' + p + 'pmAudioChevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>' +
                '</div>' +
                '<div id="' + p + 'pmAudioOptions" class="cr-audio-options" style="display:none;">' +
                  '<label class="cp-toggle-row" style="padding:8px 0;">' +
                    '<div class="cp-toggle-info"><span style="font-size:13px;">\uD83D\uDD07 Mute original audio</span></div>' +
                    '<div class="cp-switch"><input type="checkbox" id="' + p + 'pmMuteAudio"><span class="cp-switch-slider"></span></div>' +
                  '</label>' +
                  '<div class="cr-audio-volume">' +
                    '<label class="cb-field-label">Volume</label>' +
                    '<input type="range" id="' + p + 'pmAudioVolume" class="cr-volume-slider" min="0" max="100" value="100">' +
                    '<span id="' + p + 'pmVolumeLabel" class="cr-volume-label">100%</span>' +
                  '</div>' +
                '</div>' +
              '</div>' +
            '</div>' +

            '<!-- CS Toolbar -->' +
            '<div class="cp-toolbar">' +
              '<label class="cp-tool-btn" title="Upload Video" onclick="document.getElementById(\'' + p + 'pmCSVideoInput\').click()">' +
                '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg>' +
                '<span class="cp-tool-label">Video</span>' +
              '</label>' +
              '<button class="cp-tool-btn" onclick="PostModal.togglePoll()" title="Poll">' +
                '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="6" height="18" rx="1"/><rect x="15" y="8" width="6" height="13" rx="1"/><rect x="9" y="11" width="6" height="10" rx="1"/></svg>' +
                '<span class="cp-tool-label">Poll</span>' +
              '</button>' +
              '<button class="cp-tool-btn" onclick="PostModal.toggleSchedule()" title="Schedule">' +
                '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
                '<span class="cp-tool-label">Schedule</span>' +
              '</button>' +
            '</div>' +
          '</div>' +

          '<!-- Poll Section -->' +
          '<div id="' + p + 'pmPollSection" class="cp-section" style="display:none;">' +
            '<div class="cp-section-header">' +
              '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ig-blue)" stroke-width="2"><rect x="3" y="3" width="6" height="18" rx="1"/><rect x="15" y="8" width="6" height="13" rx="1"/><rect x="9" y="11" width="6" height="10" rx="1"/></svg>' +
              '<span>Create Poll</span>' +
              '<button class="cp-section-close" onclick="PostModal.togglePoll()">\u00D7</button>' +
            '</div>' +
            '<input type="text" id="' + p + 'pmPollQuestion" class="cp-input" placeholder="Ask a question...">' +
            '<div id="' + p + 'pmPollOptions" class="cp-poll-options">' +
              '<div class="cp-poll-option-row"><span class="cp-poll-dot" style="background:#0095f6;"></span><input type="text" class="pm-poll-option cp-input" placeholder="Option 1"></div>' +
              '<div class="cp-poll-option-row"><span class="cp-poll-dot" style="background:#e1306c;"></span><input type="text" class="pm-poll-option cp-input" placeholder="Option 2"></div>' +
            '</div>' +
            '<button class="cp-add-option-btn" onclick="PostModal.addPollOption()">' +
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add option' +
            '</button>' +
            '<div class="cp-poll-expiry">' +
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
              '<input type="datetime-local" id="' + p + 'pmPollExpiry" class="cp-datetime-input">' +
              '<span class="cp-expiry-label">Poll ends</span>' +
            '</div>' +
          '</div>' +

          '<!-- Schedule Section -->' +
          '<div id="' + p + 'pmScheduleSection" class="cp-section" style="display:none;">' +
            '<div class="cp-section-header">' +
              '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ig-blue)" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
              '<span>Schedule Post</span>' +
              '<button class="cp-section-close" onclick="PostModal.toggleSchedule()">\u00D7</button>' +
            '</div>' +
            '<div class="cp-schedule-picker">' +
              '<input type="datetime-local" id="' + p + 'pmScheduleTime" class="cp-datetime-input">' +
              '<p class="cp-schedule-hint">Your post will be published at the scheduled time</p>' +
            '</div>' +
          '</div>' +

          '<!-- Advanced Options -->' +
          '<div class="cp-advanced-toggle" onclick="PostModal.toggleAdvanced()">' +
            '<span>Advanced options</span>' +
            '<svg id="' + p + 'pmAdvancedChevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>' +
          '</div>' +
          '<div id="' + p + 'pmAdvancedSection" class="cp-advanced" style="display:none;">' +
            '<label class="cp-toggle-row" style="display:none;">' +
              '<div class="cp-toggle-info"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.42 19.42 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg><span>Contact Me Button</span></div>' +
              '<div class="cp-switch"><input type="checkbox" id="' + p + 'pmEnableContact"><span class="cp-switch-slider"></span></div>' +
            '</label>' +
            '<label class="cp-toggle-row" style="display:none;">' +
              '<div class="cp-toggle-info"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg><span>I\'m Interested Button</span></div>' +
              '<div class="cp-switch"><input type="checkbox" id="' + p + 'pmEnableInterested"><span class="cp-switch-slider"></span></div>' +
            '</label>' +

            '<!-- Custom Button Builder -->' +
            '<div class="cb-builder">' +
              '<div class="cb-builder-header"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ig-blue)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="4"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg><span>Custom Action Button</span></div>' +
              '<input type="text" id="' + p + 'pmCbButtonName" class="cp-input cb-name-input" placeholder="Button name (e.g. Apply Now, Get Quote)">' +

              '<div class="cb-check-row"><input type="checkbox" id="' + p + 'pmCbContactMe" onchange="PostModal.toggleCBSection(\'' + p + 'pmCbContactFields\')"><label class="cb-check-label" for="' + p + 'pmCbContactMe">\uD83D\uDCDE Contact Me</label></div>' +
              '<div id="' + p + 'pmCbContactFields" class="cb-sub-fields" style="display:none;">' +
                '<div class="cb-multi-group" id="' + p + 'pmCbLinksGroup"><label class="cb-field-label">Links</label><div class="cb-multi-row"><input type="url" class="cp-input cb-link-input" placeholder="https://example.com"><button type="button" class="cb-add-btn" onclick="PostModal.addCBField(\'' + p + 'pmCbLinksGroup\',\'url\',\'https://...\')">+</button></div></div>' +
                '<div class="cb-multi-group" id="' + p + 'pmCbEmailsGroup"><label class="cb-field-label">Emails</label><div class="cb-multi-row"><input type="email" class="cp-input cb-email-input" placeholder="email@example.com"><button type="button" class="cb-add-btn" onclick="PostModal.addCBField(\'' + p + 'pmCbEmailsGroup\',\'email\',\'email@example.com\')">+</button></div></div>' +
                '<div class="cb-multi-group" id="' + p + 'pmCbPhonesGroup"><label class="cb-field-label">Phone Numbers</label><div class="cb-multi-row"><input type="tel" class="cp-input cb-phone-input" placeholder="+1234567890"><button type="button" class="cb-add-btn" onclick="PostModal.addCBField(\'' + p + 'pmCbPhonesGroup\',\'tel\',\'+1234567890\')">+</button></div></div>' +
              '</div>' +

              '<div class="cb-check-row"><input type="checkbox" id="' + p + 'pmCbDM" onchange="PostModal.toggleCBSection(\'' + p + 'pmCbDMFields\')"><label class="cb-check-label" for="' + p + 'pmCbDM">\uD83D\uDCAC DM (Direct Message)</label></div>' +
              '<div id="' + p + 'pmCbDMFields" class="cb-sub-fields" style="display:none;"><textarea id="' + p + 'pmCbDMMessage" class="cp-input cb-dm-textarea" placeholder="Custom message" rows="2"></textarea><p class="cb-hint">When clicked, this message will be sent to your DM.</p></div>' +

              '<div class="cb-check-row"><input type="checkbox" id="' + p + 'pmCbRegister" onchange="PostModal.toggleCBSection(\'' + p + 'pmCbRegisterFields\')"><label class="cb-check-label" for="' + p + 'pmCbRegister">\uD83D\uDCDD Register</label></div>' +
              '<div id="' + p + 'pmCbRegisterFields" class="cb-sub-fields" style="display:none;"><input type="url" id="' + p + 'pmCbRegisterLink" class="cp-input" placeholder="Registration link (https://...)"><p class="cb-hint">Clicking will redirect the user to this registration page.</p></div>' +

              '<div class="cb-check-row"><input type="checkbox" id="' + p + 'pmCbHireMe" onchange="PostModal.toggleCBSection(\'' + p + 'pmCbHireMeFields\')"><label class="cb-check-label" for="' + p + 'pmCbHireMe">\uD83D\uDCBC Hire Me</label></div>' +
              '<div id="' + p + 'pmCbHireMeFields" class="cb-sub-fields" style="display:none;">' +
                '<p class="cb-hint">Select which fields viewers must fill out.</p>' +
                '<div class="cb-hire-fields-list">' +
                  '<label class="cb-hire-field-check"><input type="checkbox" id="' + p + 'pmCbHireName" checked> \uD83D\uDC64 Name</label>' +
                  '<label class="cb-hire-field-check"><input type="checkbox" id="' + p + 'pmCbHireEmail" checked> \uD83D\uDCE7 Email</label>' +
                  '<label class="cb-hire-field-check"><input type="checkbox" id="' + p + 'pmCbHireContact" checked> \uD83D\uDCDE Contact Number</label>' +
                  '<label class="cb-hire-field-check"><input type="checkbox" id="' + p + 'pmCbHireResume"> \uD83D\uDCCE Resume Link</label>' +
                '</div>' +
                '<div class="cb-custom-fields-area"><label class="cb-field-label">Custom Fields</label><div id="' + p + 'pmCbCustomFieldsList"></div>' +
                  '<button type="button" class="cp-add-option-btn" onclick="PostModal.addCBCustomField()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add custom field</button>' +
                '</div>' +
              '</div>' +
            '</div>' +

            '<!-- Comment to DM -->' +
            '<div class="cb-builder" style="margin-top:12px;">' +
              '<label class="cp-toggle-row" style="padding:0;margin-bottom:8px;">' +
                '<div class="cp-toggle-info"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ig-blue)" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg><span style="font-weight:600;font-size:14px;">Comment to DM</span></div>' +
                '<div class="cp-switch"><input type="checkbox" id="' + p + 'pmEnableCommentDM" onchange="PostModal.toggleCBSection(\'' + p + 'pmCommentDMFields\')"><span class="cp-switch-slider"></span></div>' +
              '</label>' +
              '<p class="cb-hint" style="margin-top:0;">When enabled, anyone who comments will automatically receive a DM from you.</p>' +
              '<div id="' + p + 'pmCommentDMFields" class="cb-sub-fields" style="display:none;">' +
                '<label class="cp-toggle-row" style="padding:4px 0;"><div class="cp-toggle-info"><span style="font-size:13px;">\uD83D\uDD12 Require Follow</span></div><div class="cp-switch"><input type="checkbox" id="' + p + 'pmCdmRequireFollow" checked onchange="PostModal.toggleCBSection(\'' + p + 'pmCdmNotFollowingSection\')"><span class="cp-switch-slider"></span></div></label>' +
                '<p class="cb-hint">Only send the content after the user follows you.</p>' +
                '<div id="' + p + 'pmCdmNotFollowingSection" class="cb-sub-fields" style="display:block;"><label class="cb-field-label">Message if not following</label><textarea id="' + p + 'pmCdmNotFollowMsg" class="cp-input cb-dm-textarea" rows="2" placeholder="Oh no! It seems you\'re not following me \uD83D\uDE2D Follow me and click \'I\'m following\' to get the link \u2728"></textarea><p class="cb-hint">Leave empty for default message.</p></div>' +
                '<label class="cb-field-label" style="margin-top:8px;">\uD83D\uDCAC DM Message</label>' +
                '<p class="cb-hint">This message will be shown above the buttons in the DM.</p>' +
                '<textarea id="' + p + 'pmCdmDMMessage" class="cp-input cb-dm-textarea" rows="2" placeholder="e.g. Here is the website link that most users use, check it out!"></textarea>' +
                '<label class="cb-field-label" style="margin-top:8px;">\uD83D\uDCE9 Custom DM Buttons</label>' +
                '<p class="cb-hint">Add custom buttons with content.</p>' +
                '<div id="' + p + 'pmCdmItemsList"><div class="cdm-item" data-idx="0"><input type="text" class="cp-input cdm-item-label" placeholder="Custom button name" value=""><input type="text" class="cp-input cdm-item-content" placeholder="Link or content to send" value=""></div></div>' +
                '<button type="button" class="cp-add-option-btn" onclick="PostModal.addCDMItem()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> + Add another custom button</button>' +
              '</div>' +
            '</div>' +

            '<!-- Post Public Toggle (for private accounts) -->' +
            '<div class="cb-builder" id="' + p + 'pmPostPublicSection" style="margin-top:12px;display:none;">' +
              '<label class="cp-toggle-row" style="padding:0;margin-bottom:4px;">' +
                '<div class="cp-toggle-info">' +
                  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ig-blue)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>' +
                  '<span style="font-weight:600;font-size:14px;">Post Public</span>' +
                '</div>' +
                '<div class="cp-switch"><input type="checkbox" id="' + p + 'pmPublicPost"><span class="cp-switch-slider"></span></div>' +
              '</label>' +
              '<p class="cb-hint" style="margin-top:0;">Even though your account is private, this specific post will be visible to everyone. You can change this later by editing the post.</p>' +
            '</div>' +

          '</div>' +

        '</div>' + // cp-body
      '</div>' + // cp-container
    '</div>'; // cp-overlay
  }

  // ========== INIT ==========
  function init(cId, options) {
    containerId = cId;
    prefix = options.prefix || '';
    _getUser = options.getUser || function () { return null; };
    _refreshPosts = options.refreshPosts || function () {};

    var container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = generateHTML();
    }

    // Volume slider listener
    var volSlider = el('pmAudioVolume');
    if (volSlider) {
      volSlider.addEventListener('input', function () {
        var label = el('pmVolumeLabel');
        if (label) label.textContent = this.value + '%';
        var video = el('pmCSVideo');
        if (video) video.volume = this.value / 100;
      });
    }

    // Setup trim handle drag
    setupTrimHandles();
  }

  // ========== OPEN CREATE ==========
  function openCreate() {
    mode = 'create';
    activeTab = 'post';
    editPostId = null;
    editPostData = null;
    resetAll();

    el('pmTitle').textContent = 'Create new post';
    el('pmShareBtn').textContent = 'Share';

    // Show tab bar for create mode
    var tabBar = el('postModalOverlay');
    if (tabBar) {
      var tb = tabBar.querySelector('.cr-tab-bar');
      if (tb) tb.style.display = '';
    }

    setUserInfo();
    switchTab('post');
    loadTrendingHashtags();
    checkPrivateAccountForPostPublic();

    el('postModalOverlay').style.display = 'flex';
    setTimeout(function () { var t = el('pmCaption'); if (t) t.focus(); }, 300);
  }

  // ========== OPEN EDIT ==========
  function openEdit(postId) {
    mode = 'edit';
    editPostData = null;
    resetAll();
    editPostId = postId;

    el('pmTitle').textContent = 'Edit Post';
    el('pmShareBtn').textContent = 'Save';
    setUserInfo();

    InnovateAPI.apiRequest('/posts/' + postId).then(function (response) {
      var post = response.post || response;
      editPostData = post;

      var content = post.content || '';
      var images = Array.isArray(post.images) ? post.images : (post.images ? JSON.parse(post.images) : []);
      var files = Array.isArray(post.files) ? post.files : (post.files ? JSON.parse(post.files) : []);
      var isCreatorSeries = !!post.video_url;

      // Fill caption
      el('pmCaption').value = content;
      el('pmCharCount').textContent = content.length;

      // Determine tab
      if (isCreatorSeries) {
        activeTab = 'series';
        el('pmTitle').textContent = 'Edit Creator Series';
        // Hide tab bar in edit mode (locked to the post type)
        var overlay = el('postModalOverlay');
        if (overlay) {
          var tb = overlay.querySelector('.cr-tab-bar');
          if (tb) tb.style.display = 'none';
        }
        switchTab('series');

        // Load existing video
        existingVideoUrl = post.video_url;
        var videoEl = el('pmCSVideo');
        if (videoEl) {
          initCSPreview(videoEl, post.video_url, null);
        }
      } else {
        activeTab = 'post';
        var overlay = el('postModalOverlay');
        if (overlay) {
          var tb = overlay.querySelector('.cr-tab-bar');
          if (tb) tb.style.display = 'none';
        }
        switchTab('post');

        // Show existing images
        existingImages = images.slice();
        renderExistingMedia();

        // Show existing files
        existingFiles = files.slice();
        renderExistingFiles();
      }

      // Pre-fill poll
      if (post.poll) {
        el('pmPollQuestion').value = post.poll.question || '';
        var optsContainer = el('pmPollOptions');
        var opts = Array.isArray(post.poll.options) ? post.poll.options : Object.keys(post.poll.options || {});
        optsContainer.innerHTML = opts.map(function (opt, i) {
          return '<div class="cp-poll-option-row"><span class="cp-poll-dot" style="background:' + pollColors[i % pollColors.length] + ';"></span><input type="text" class="pm-poll-option cp-input" placeholder="Option ' + (i + 1) + '" value="' + opt + '"></div>';
        }).join('');
        if (post.poll.expires_at) {
          var dt = new Date(post.poll.expires_at);
          el('pmPollExpiry').value = dt.toISOString().slice(0, 16);
        }
        el('pmPollSection').style.display = 'block';
        var pollBtn = el('pmPollToggleBtn');
        if (pollBtn) pollBtn.classList.add('cp-tool-active');
      }

      // Pre-fill schedule
      if (post.scheduled_at) {
        var sdt = new Date(post.scheduled_at);
        el('pmScheduleTime').value = sdt.toISOString().slice(0, 16);
        el('pmScheduleSection').style.display = 'block';
        var schedBtn = el('pmScheduleToggleBtn');
        if (schedBtn) schedBtn.classList.add('cp-tool-active');
      }

      // Pre-fill advanced options
      el('pmEnableContact').checked = !!post.enable_contact;
      el('pmEnableInterested').checked = !!post.enable_interested;

      // Pre-fill custom button
      prefillCustomButton(post.custom_button);
      // Pre-fill comment-to-DM
      prefillCommentDM(post.comment_to_dm);

      // Pre-fill Post Public toggle (for private accounts)
      var publicPostCheckbox = el('pmPublicPost');
      if (publicPostCheckbox) publicPostCheckbox.checked = !!post.is_public_post;
      checkPrivateAccountForPostPublic();

      // Load trending hashtags
      loadTrendingHashtags();

      // Show modal
      el('postModalOverlay').style.display = 'flex';
      setTimeout(function () { var t = el('pmCaption'); if (t) t.focus(); }, 300);
    }).catch(function (err) {
      console.error('Failed to load post for editing:', err);
      InnovateAPI.showAlert('Failed to load post', 'error');
    });
  }

  // ========== CLOSE & RESET ==========
  function close() {
    var overlay = el('postModalOverlay');
    if (overlay) overlay.style.display = 'none';
    // Pause video if playing
    var vid = el('pmCSVideo');
    if (vid) { try { vid.pause(); } catch (e) {} }
    resetAll();
  }

  function resetAll() {
    // Caption
    var caption = el('pmCaption');
    if (caption) caption.value = '';
    var charCount = el('pmCharCount');
    if (charCount) charCount.textContent = '0';

    // Media
    selectedImages = [];
    selectedFiles = [];
    existingImages = [];
    existingFiles = [];
    var mp = el('pmMediaPreview');
    if (mp) mp.innerHTML = '';
    var em = el('pmExistingMedia');
    if (em) em.innerHTML = '';
    var ef = el('pmExistingFiles');
    if (ef) ef.innerHTML = '';
    var mi = el('pmMediaInput');
    if (mi) mi.value = '';
    var fi = el('pmFileInput');
    if (fi) fi.value = '';

    // Creator Series
    csVideoFile = null;
    existingVideoUrl = null;
    csTrimStart = 0;
    csTrimEnd = 1;
    csCoverTime = 0;
    csDuration = 0;
    var csUpload = el('pmCSUploadZone');
    if (csUpload) csUpload.style.display = '';
    var csPreview = el('pmCSPreview');
    if (csPreview) csPreview.style.display = 'none';
    var csVideoInput = el('pmCSVideoInput');
    if (csVideoInput) csVideoInput.value = '';

    // Poll
    var pollSection = el('pmPollSection');
    if (pollSection) pollSection.style.display = 'none';
    var pollQ = el('pmPollQuestion');
    if (pollQ) pollQ.value = '';
    var pollOpts = el('pmPollOptions');
    if (pollOpts) pollOpts.innerHTML =
      '<div class="cp-poll-option-row"><span class="cp-poll-dot" style="background:#0095f6;"></span><input type="text" class="pm-poll-option cp-input" placeholder="Option 1"></div>' +
      '<div class="cp-poll-option-row"><span class="cp-poll-dot" style="background:#e1306c;"></span><input type="text" class="pm-poll-option cp-input" placeholder="Option 2"></div>';
    var pollExp = el('pmPollExpiry');
    if (pollExp) pollExp.value = '';
    var pollBtn = el('pmPollToggleBtn');
    if (pollBtn) pollBtn.classList.remove('cp-tool-active');

    // Schedule
    var schedSec = el('pmScheduleSection');
    if (schedSec) schedSec.style.display = 'none';
    var schedTime = el('pmScheduleTime');
    if (schedTime) schedTime.value = '';
    var schedBtn = el('pmScheduleToggleBtn');
    if (schedBtn) schedBtn.classList.remove('cp-tool-active');

    // Advanced
    var advSec = el('pmAdvancedSection');
    if (advSec) advSec.style.display = 'none';
    var contact = el('pmEnableContact');
    if (contact) contact.checked = false;
    var interested = el('pmEnableInterested');
    if (interested) interested.checked = false;

    // Custom button reset
    var cbName = el('pmCbButtonName');
    if (cbName) cbName.value = '';
    ['pmCbContactMe', 'pmCbDM', 'pmCbRegister', 'pmCbHireMe'].forEach(function (id) {
      var cb = el(id);
      if (cb) cb.checked = false;
    });
    ['pmCbContactFields', 'pmCbDMFields', 'pmCbRegisterFields', 'pmCbHireMeFields'].forEach(function (id) {
      var d = el(id);
      if (d) d.style.display = 'none';
    });

    // Comment-to-DM reset
    var cdmToggle = el('pmEnableCommentDM');
    if (cdmToggle) cdmToggle.checked = false;
    var cdmFields = el('pmCommentDMFields');
    if (cdmFields) cdmFields.style.display = 'none';

    // Hashtags
    var hashSug = el('pmHashtagSuggestions');
    if (hashSug) hashSug.style.display = 'none';

    editPostData = null;
    editPostId = null;
  }

  function setUserInfo() {
    var user = _getUser();
    if (user) {
      var av = el('pmUserAvatar');
      if (av) av.src = user.profile_picture || '/images/default-avatar.svg';
      var un = el('pmUsername');
      if (un) un.textContent = user.username || 'You';
    }
  }

  // ========== TAB SWITCHING ==========
  function switchTab(tab) {
    activeTab = tab;
    var postSection = el('pmPostSection');
    var seriesSection = el('pmSeriesSection');
    var tabPost = el('pmTabPost');
    var tabSeries = el('pmTabSeries');

    if (tab === 'post') {
      if (postSection) postSection.style.display = '';
      if (seriesSection) seriesSection.style.display = 'none';
      if (tabPost) tabPost.classList.add('active');
      if (tabSeries) tabSeries.classList.remove('active');
    } else {
      if (postSection) postSection.style.display = 'none';
      if (seriesSection) seriesSection.style.display = '';
      if (tabPost) tabPost.classList.remove('active');
      if (tabSeries) tabSeries.classList.add('active');
    }
  }

  // ========== MEDIA HANDLING (POST TAB) ==========
  function onMediaSelected(input) {
    if (!input.files) return;
    Array.from(input.files).forEach(function (file) {
      selectedImages.push(file);
    });
    renderMediaPreview();
    input.value = '';
  }

  function onFilesSelected(input) {
    if (!input.files) return;
    Array.from(input.files).forEach(function (file) {
      selectedFiles.push(file);
    });
    renderMediaPreview();
    input.value = '';
  }

  function renderMediaPreview() {
    var container = el('pmMediaPreview');
    if (!container) return;
    container.innerHTML = '';

    selectedImages.forEach(function (file, i) {
      if (!file) return;
      var div = document.createElement('div');
      div.className = 'media-preview-item';
      if (file.type.startsWith('video/')) {
        var video = document.createElement('video');
        video.src = URL.createObjectURL(file);
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
      removeBtn.onclick = function () { selectedImages[i] = null; renderMediaPreview(); };
      div.appendChild(removeBtn);
      container.appendChild(div);
    });
  }

  function renderExistingMedia() {
    var container = el('pmExistingMedia');
    if (!container) return;
    container.innerHTML = existingImages.map(function (img, idx) {
      return '<div class="media-preview-item">' +
        '<img src="' + img + '" alt="Image ' + (idx + 1) + '">' +
        '<button class="media-preview-remove" onclick="PostModal.removeExistingMedia(' + idx + ')" title="Remove">&times;</button>' +
        '</div>';
    }).join('');
  }

  function removeExistingMedia(idx) {
    existingImages[idx] = null;
    existingImages = existingImages.filter(Boolean);
    renderExistingMedia();
  }

  function renderExistingFiles() {
    var container = el('pmExistingFiles');
    if (!container) return;
    container.innerHTML = existingFiles.map(function (f, idx) {
      var name = (typeof f === 'string') ? f.split('/').pop() : (f.name || 'File');
      return '<div class="file-preview-item">' +
        '<span>\uD83D\uDCC4</span>' +
        '<div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + name + '</div></div>' +
        '<button class="file-preview-remove" onclick="PostModal.removeExistingFile(' + idx + ')" title="Remove">&times;</button>' +
        '</div>';
    }).join('');
  }

  function removeExistingFile(idx) {
    existingFiles[idx] = null;
    existingFiles = existingFiles.filter(Boolean);
    renderExistingFiles();
  }

  // ========== CREATOR SERIES ==========
  function onCSVideoSelected(input) {
    if (!input.files || !input.files[0]) return;
    var file = input.files[0];
    if (!file.type.startsWith('video/')) {
      InnovateAPI.showAlert('Please select a video file', 'error');
      return;
    }
    csVideoFile = file;
    existingVideoUrl = null;
    var url = URL.createObjectURL(file);
    var videoEl = el('pmCSVideo');
    initCSPreview(videoEl, url, file.size);
    input.value = '';
  }

  function initCSPreview(videoEl, src, fileSize) {
    csTrimStart = 0;
    csTrimEnd = 1;
    csCoverTime = 0;

    el('pmCSUploadZone').style.display = 'none';
    el('pmCSPreview').style.display = '';

    videoEl.src = src;
    videoEl.onloadedmetadata = function () {
      csDuration = videoEl.duration;

      var durText = formatTime(csDuration);
      if (fileSize) {
        var sizeMB = (fileSize / (1024 * 1024)).toFixed(1);
        durText += ' \u00B7 ' + sizeMB + 'MB';
      }
      var durEl = el('pmCSDuration');
      if (durEl) durEl.textContent = durText;

      // Reset trim
      var trimStart = el('pmTrimHandleStart');
      var trimEnd = el('pmTrimHandleEnd');
      if (trimStart) trimStart.style.left = '0%';
      if (trimEnd) trimEnd.style.left = '100%';
      var trimStartTime = el('pmTrimStartTime');
      var trimEndTime = el('pmTrimEndTime');
      if (trimStartTime) trimStartTime.textContent = '0:00';
      if (trimEndTime) trimEndTime.textContent = formatTime(csDuration);
      var trimDurLabel = el('pmTrimDurationLabel');
      if (trimDurLabel) trimDurLabel.textContent = 'Duration: ' + formatTime(csDuration);

      generateTrimThumbnails(videoEl);
      generateCoverThumbnails(videoEl);
      updateCoverFrame();
    };
  }

  function changeCSVideo() {
    el('pmCSVideoInput').click();
  }

  function toggleCSPlayback() {
    var video = el('pmCSVideo');
    if (!video) return;
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  }

  function toggleAudioSection() {
    var opts = el('pmAudioOptions');
    var chev = el('pmAudioChevron');
    if (!opts) return;
    var isOpen = opts.style.display !== 'none';
    opts.style.display = isOpen ? 'none' : '';
    if (chev) chev.style.transform = isOpen ? '' : 'rotate(180deg)';
  }

  // Trim thumbnail generation
  function generateTrimThumbnails(videoEl) {
    var canvas = el('pmTrimCanvas');
    if (!canvas || !videoEl || !csDuration) return;
    var ctx = canvas.getContext('2d');
    var thumbCount = 10;
    var thumbWidth = canvas.clientWidth / thumbCount;
    canvas.width = canvas.clientWidth;
    canvas.height = 48;

    var tempVideo = document.createElement('video');
    tempVideo.src = videoEl.src;
    tempVideo.muted = true;
    tempVideo.preload = 'auto';

    var idx = 0;
    tempVideo.onseeked = function () {
      ctx.drawImage(tempVideo, idx * thumbWidth, 0, thumbWidth, 48);
      idx++;
      if (idx < thumbCount) {
        tempVideo.currentTime = (idx / thumbCount) * csDuration;
      }
    };
    tempVideo.onloadeddata = function () {
      tempVideo.currentTime = 0;
    };
  }

  // Cover thumbnail generation
  function generateCoverThumbnails(videoEl) {
    var container = el('pmCoverThumbnails');
    if (!container || !videoEl || !csDuration) return;
    container.innerHTML = '';
    var thumbCount = 8;

    var tempVideo = document.createElement('video');
    tempVideo.src = videoEl.src;
    tempVideo.muted = true;
    tempVideo.preload = 'auto';

    var idx = 0;
    tempVideo.onseeked = function () {
      var cvs = document.createElement('canvas');
      cvs.width = 60;
      cvs.height = 80;
      cvs.getContext('2d').drawImage(tempVideo, 0, 0, 60, 80);
      cvs.className = 'cr-cover-thumb';
      cvs.onclick = function () {
        var time = (idx / thumbCount) * csDuration;
        selectCoverFrame(time);
      };
      // capture idx
      (function (currentIdx) {
        cvs.onclick = function () {
          selectCoverFrame((currentIdx / thumbCount) * csDuration);
        };
      })(idx);
      container.appendChild(cvs);
      idx++;
      if (idx < thumbCount) {
        tempVideo.currentTime = (idx / thumbCount) * csDuration;
      }
    };
    tempVideo.onloadeddata = function () {
      tempVideo.currentTime = 0;
    };
  }

  function selectCoverFrame(time) {
    csCoverTime = time;
    // Highlight selected thumb
    var container = el('pmCoverThumbnails');
    if (container) {
      Array.from(container.children).forEach(function (c) { c.classList.remove('selected'); });
      var thumbIdx = Math.round((time / csDuration) * 8);
      if (container.children[thumbIdx]) container.children[thumbIdx].classList.add('selected');
    }
    updateCoverFrame();
  }

  function updateCoverFrame() {
    var videoEl = el('pmCSVideo');
    var coverCanvas = el('pmCoverCanvas');
    if (!videoEl || !coverCanvas) return;

    var tempVideo = document.createElement('video');
    tempVideo.src = videoEl.src;
    tempVideo.muted = true;
    tempVideo.preload = 'auto';
    tempVideo.onseeked = function () {
      var ctx = coverCanvas.getContext('2d');
      ctx.drawImage(tempVideo, 0, 0, coverCanvas.width, coverCanvas.height);
    };
    tempVideo.onloadeddata = function () {
      tempVideo.currentTime = csCoverTime;
    };
  }

  // Trim handle dragging
  function setupTrimHandles() {
    var timeline = el('pmTrimTimeline');
    if (!timeline) return;

    var dragging = null;
    var startHandle = el('pmTrimHandleStart');
    var endHandle = el('pmTrimHandleEnd');
    if (!startHandle || !endHandle) return;

    function onDown(e, handle) {
      e.preventDefault();
      dragging = handle;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onUp);
    }

    function onMove(e) {
      if (!dragging) return;
      e.preventDefault();
      var rect = timeline.getBoundingClientRect();
      var clientX = e.touches ? e.touches[0].clientX : e.clientX;
      var pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));

      if (dragging === 'start') {
        csTrimStart = Math.min(pct, csTrimEnd - 0.05);
        if (startHandle) startHandle.style.left = (csTrimStart * 100) + '%';
      } else {
        csTrimEnd = Math.max(pct, csTrimStart + 0.05);
        if (endHandle) endHandle.style.left = (csTrimEnd * 100) + '%';
      }

      // Update labels
      var trimStartTime = el('pmTrimStartTime');
      var trimEndTime = el('pmTrimEndTime');
      var trimDurLabel = el('pmTrimDurationLabel');
      if (trimStartTime) trimStartTime.textContent = formatTime(csTrimStart * csDuration);
      if (trimEndTime) trimEndTime.textContent = formatTime(csTrimEnd * csDuration);
      if (trimDurLabel) trimDurLabel.textContent = 'Duration: ' + formatTime((csTrimEnd - csTrimStart) * csDuration);

      // Update progress bar
      var progress = el('pmTrimProgress');
      if (progress) {
        progress.style.left = (csTrimStart * 100) + '%';
        progress.style.width = ((csTrimEnd - csTrimStart) * 100) + '%';
      }
    }

    function onUp() {
      dragging = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
    }

    startHandle.addEventListener('mousedown', function (e) { onDown(e, 'start'); });
    startHandle.addEventListener('touchstart', function (e) { onDown(e, 'start'); }, { passive: false });
    endHandle.addEventListener('mousedown', function (e) { onDown(e, 'end'); });
    endHandle.addEventListener('touchstart', function (e) { onDown(e, 'end'); }, { passive: false });
  }

  // ========== POLL ==========
  function togglePoll() {
    var sec = el('pmPollSection');
    if (!sec) return;
    var visible = sec.style.display !== 'none';
    sec.style.display = visible ? 'none' : 'block';
    var btn = el('pmPollToggleBtn');
    if (btn) btn.classList.toggle('cp-tool-active', !visible);
  }

  function addPollOption() {
    var container = el('pmPollOptions');
    if (!container) return;
    var count = container.children.length;
    if (count >= 6) { InnovateAPI.showAlert('Maximum 6 options', 'error'); return; }
    var color = pollColors[count % pollColors.length];
    var row = document.createElement('div');
    row.className = 'cp-poll-option-row';
    row.innerHTML = '<span class="cp-poll-dot" style="background:' + color + ';"></span>' +
      '<input type="text" class="pm-poll-option cp-input" placeholder="Option ' + (count + 1) + '">';
    container.appendChild(row);
  }

  // ========== SCHEDULE ==========
  function toggleSchedule() {
    var sec = el('pmScheduleSection');
    if (!sec) return;
    var visible = sec.style.display !== 'none';
    sec.style.display = visible ? 'none' : 'block';
    var btn = el('pmScheduleToggleBtn');
    if (btn) btn.classList.toggle('cp-tool-active', !visible);
  }

  // ========== ADVANCED OPTIONS ==========
  function toggleAdvanced() {
    var sec = el('pmAdvancedSection');
    var chev = el('pmAdvancedChevron');
    if (!sec) return;
    var visible = sec.style.display !== 'none';
    sec.style.display = visible ? 'none' : 'block';
    if (chev) chev.style.transform = visible ? '' : 'rotate(180deg)';
  }

  // ========== POST PUBLIC (Private Account) ==========
  function checkPrivateAccountForPostPublic() {
    var section = el('pmPostPublicSection');
    if (!section) return;
    
    // Check if current user has a private account
    var user = _getUser ? _getUser() : null;
    if (user && user.id) {
      InnovateAPI.apiRequest('/users/' + user.id).then(function(data) {
        if (data && data.user && data.user.is_private) {
          section.style.display = '';
        } else {
          section.style.display = 'none';
        }
      }).catch(function() {
        section.style.display = 'none';
      });
    } else {
      section.style.display = 'none';
    }
  }

  // ========== CUSTOM BUTTON / CDM HELPERS ==========
  function toggleCBSection(fieldId) {
    var fields = document.getElementById(fieldId);
    if (!fields) return;
    var cb = fields.previousElementSibling;
    // find the checkbox
    var checkbox;
    if (cb && cb.querySelector) checkbox = cb.querySelector('input[type="checkbox"]');
    // Simple toggle based on the checkbox nearest context
    fields.style.display = fields.style.display === 'none' ? '' : 'none';
  }

  function addCBField(groupId, type, placeholder) {
    var group = document.getElementById(groupId);
    if (!group) return;
    var row = document.createElement('div');
    row.className = 'cb-multi-row';
    row.innerHTML = '<input type="' + type + '" class="cp-input" placeholder="' + placeholder + '">' +
      '<button type="button" class="cb-add-btn cb-remove-btn" onclick="this.parentElement.remove()">&times;</button>';
    group.appendChild(row);
  }

  function addCBCustomField() {
    var list = el('pmCbCustomFieldsList');
    if (!list) return;
    var row = document.createElement('div');
    row.className = 'cb-custom-field-row';
    row.innerHTML = '<input type="text" class="cp-input" placeholder="Field name">' +
      '<button type="button" class="cb-add-btn cb-remove-btn" onclick="this.parentElement.remove()">&times;</button>';
    list.appendChild(row);
  }

  function addCDMItem() {
    var list = el('pmCdmItemsList');
    if (!list) return;
    var idx = list.children.length;
    var item = document.createElement('div');
    item.className = 'cdm-item';
    item.setAttribute('data-idx', idx);
    item.innerHTML = '<input type="text" class="cp-input cdm-item-label" placeholder="Custom button name" value="">' +
      '<input type="text" class="cp-input cdm-item-content" placeholder="Link or content to send" value="">';
    list.appendChild(item);
  }

  // ========== CUSTOM BUTTON DATA COLLECTION ==========
  function collectCustomButtonData() {
    var name = el('pmCbButtonName');
    if (!name || !name.value.trim()) return null;

    var data = { name: name.value.trim() };
    var contactCb = el('pmCbContactMe');
    if (contactCb && contactCb.checked) {
      data.contact_me = { enabled: true };
      var linksGroup = el('pmCbLinksGroup');
      if (linksGroup) {
        data.contact_me.links = Array.from(linksGroup.querySelectorAll('input')).map(function (i) { return i.value.trim(); }).filter(Boolean);
      }
      var emailsGroup = el('pmCbEmailsGroup');
      if (emailsGroup) {
        data.contact_me.emails = Array.from(emailsGroup.querySelectorAll('input')).map(function (i) { return i.value.trim(); }).filter(Boolean);
      }
      var phonesGroup = el('pmCbPhonesGroup');
      if (phonesGroup) {
        data.contact_me.phones = Array.from(phonesGroup.querySelectorAll('input')).map(function (i) { return i.value.trim(); }).filter(Boolean);
      }
    }
    var dmCb = el('pmCbDM');
    if (dmCb && dmCb.checked) {
      var dmMsg = el('pmCbDMMessage');
      data.dm = { enabled: true, message: dmMsg ? dmMsg.value.trim() : '' };
    }
    var regCb = el('pmCbRegister');
    if (regCb && regCb.checked) {
      var regLink = el('pmCbRegisterLink');
      data.register = { enabled: true, link: regLink ? regLink.value.trim() : '' };
    }
    var hireCb = el('pmCbHireMe');
    if (hireCb && hireCb.checked) {
      data.hire_me = {
        enabled: true,
        fields: {
          name: el('pmCbHireName') ? el('pmCbHireName').checked : false,
          email: el('pmCbHireEmail') ? el('pmCbHireEmail').checked : false,
          contact: el('pmCbHireContact') ? el('pmCbHireContact').checked : false,
          resume: el('pmCbHireResume') ? el('pmCbHireResume').checked : false
        },
        customFields: []
      };
      var cfList = el('pmCbCustomFieldsList');
      if (cfList) {
        data.hire_me.customFields = Array.from(cfList.querySelectorAll('input')).map(function (i) { return i.value.trim(); }).filter(Boolean);
      }
    }
    return data;
  }

  function collectCommentDMData() {
    var cdmToggle = el('pmEnableCommentDM');
    if (!cdmToggle || !cdmToggle.checked) return null;

    var data = {
      enabled: true,
      require_follow: el('pmCdmRequireFollow') ? el('pmCdmRequireFollow').checked : true,
      not_following_msg: el('pmCdmNotFollowMsg') ? el('pmCdmNotFollowMsg').value.trim() : '',
      dm_message: el('pmCdmDMMessage') ? el('pmCdmDMMessage').value.trim() : '',
      items: []
    };

    var itemsList = el('pmCdmItemsList');
    if (itemsList) {
      Array.from(itemsList.querySelectorAll('.cdm-item')).forEach(function (item) {
        var label = item.querySelector('.cdm-item-label');
        var content = item.querySelector('.cdm-item-content');
        if (label && content && (label.value.trim() || content.value.trim())) {
          data.items.push({ label: label.value.trim(), content: content.value.trim() });
        }
      });
    }
    return data;
  }

  function prefillCustomButton(customButton) {
    if (!customButton) return;
    var cb = (typeof customButton === 'string') ? JSON.parse(customButton) : customButton;
    if (!cb || !cb.name) return;

    // Normalize legacy field names
    var contactData = cb.contact_me || cb.contact || null;
    var hireData = cb.hire_me || cb.hire || null;

    var name = el('pmCbButtonName');
    if (name) name.value = cb.name;

    if (contactData) {
      var contactCb = el('pmCbContactMe');
      if (contactCb) { contactCb.checked = true; toggleCBSection(prefix + 'pmCbContactFields'); }
      if (contactData.links) {
        var linksGroup = el('pmCbLinksGroup');
        if (linksGroup) {
          var inputs = linksGroup.querySelectorAll('input');
          contactData.links.forEach(function (link, i) {
            if (i === 0 && inputs[0]) { inputs[0].value = link; }
            else { addCBField(prefix + 'pmCbLinksGroup', 'url', 'https://...'); var newInputs = linksGroup.querySelectorAll('input'); if (newInputs[i]) newInputs[i].value = link; }
          });
        }
      }
      if (contactData.emails) {
        var emailsGroup = el('pmCbEmailsGroup');
        if (emailsGroup) {
          var inputs = emailsGroup.querySelectorAll('input');
          contactData.emails.forEach(function (email, i) {
            if (i === 0 && inputs[0]) { inputs[0].value = email; }
            else { addCBField(prefix + 'pmCbEmailsGroup', 'email', 'email@example.com'); }
          });
        }
      }
      if (contactData.phones) {
        var phonesGroup = el('pmCbPhonesGroup');
        if (phonesGroup) {
          var inputs = phonesGroup.querySelectorAll('input');
          contactData.phones.forEach(function (phone, i) {
            if (i === 0 && inputs[0]) { inputs[0].value = phone; }
            else { addCBField(prefix + 'pmCbPhonesGroup', 'tel', '+1234567890'); }
          });
        }
      }
    }

    if (cb.dm) {
      var dmCb = el('pmCbDM');
      if (dmCb) { dmCb.checked = true; toggleCBSection(prefix + 'pmCbDMFields'); }
      var dmMsg = el('pmCbDMMessage');
      if (dmMsg && cb.dm.message) dmMsg.value = cb.dm.message;
    }

    if (cb.register) {
      var regCb = el('pmCbRegister');
      if (regCb) { regCb.checked = true; toggleCBSection(prefix + 'pmCbRegisterFields'); }
      var regLink = el('pmCbRegisterLink');
      if (regLink && cb.register.link) regLink.value = cb.register.link;
    }

    if (hireData) {
      var hireCb = el('pmCbHireMe');
      if (hireCb) { hireCb.checked = true; toggleCBSection(prefix + 'pmCbHireMeFields'); }
      if (hireData.fields) {
        if (el('pmCbHireName')) el('pmCbHireName').checked = !!hireData.fields.name;
        if (el('pmCbHireEmail')) el('pmCbHireEmail').checked = !!hireData.fields.email;
        if (el('pmCbHireContact')) el('pmCbHireContact').checked = !!hireData.fields.contact;
        if (el('pmCbHireResume')) el('pmCbHireResume').checked = !!hireData.fields.resume;
      }
    }
  }

  function prefillCommentDM(commentDM) {
    if (!commentDM) return;
    var cdm = (typeof commentDM === 'string') ? JSON.parse(commentDM) : commentDM;
    if (!cdm) return;

    var toggle = el('pmEnableCommentDM');
    if (toggle) { toggle.checked = true; toggleCBSection(prefix + 'pmCommentDMFields'); }

    var reqFollow = el('pmCdmRequireFollow');
    if (reqFollow) reqFollow.checked = (cdm.require_follow !== undefined ? cdm.require_follow : cdm.requireFollow) !== false;

    var notFollowMsg = el('pmCdmNotFollowMsg');
    var nfMsg = cdm.not_following_msg || cdm.notFollowingMsg || '';
    if (notFollowMsg && nfMsg) notFollowMsg.value = nfMsg;

    var dmMsg = el('pmCdmDMMessage');
    var dMsg = cdm.dm_message || cdm.dmMessage || '';
    if (dmMsg && dMsg) dmMsg.value = dMsg;

    if (cdm.items && cdm.items.length > 0) {
      var itemsList = el('pmCdmItemsList');
      if (itemsList) {
        itemsList.innerHTML = '';
        cdm.items.forEach(function (item, i) {
          var div = document.createElement('div');
          div.className = 'cdm-item';
          div.setAttribute('data-idx', i);
          div.innerHTML = '<input type="text" class="cp-input cdm-item-label" placeholder="Custom button name" value="' + (item.label || '') + '">' +
            '<input type="text" class="cp-input cdm-item-content" placeholder="Link or content to send" value="' + (item.content || '') + '">';
          itemsList.appendChild(div);
        });
      }
    }
  }

  // ========== CAPTION & HASHTAGS ==========
  function onCaptionInput(textarea) {
    var count = textarea.value.length;
    var cc = el('pmCharCount');
    if (cc) cc.textContent = count;

    var text = textarea.value;
    var cursorPos = textarea.selectionStart;
    var beforeCursor = text.substring(0, cursorPos);

    // @mention detection (takes priority over hashtags)
    var mentionMatch = beforeCursor.match(/@(\w[\w.]*)$/);
    if (mentionMatch && mentionMatch[1].length >= 1) {
      showMentionSuggestions(mentionMatch[1]);
      // Hide hashtag suggestions while mentioning
      clearTimeout(hashtagDebounceTimer);
      var hSug = el('pmHashtagSuggestions');
      if (hSug) hSug.style.display = 'none';
      return;
    } else {
      clearTimeout(mentionDebounceTimer);
      var mSug = el('pmMentionSuggestions');
      if (mSug) mSug.style.display = 'none';
    }

    // Hashtag detection
    var hashMatch = beforeCursor.match(/#(\w*)$/);
    if (hashMatch && hashMatch[1].length >= 1) {
      showHashtagSuggestions(hashMatch[1]);
    } else {
      clearTimeout(hashtagDebounceTimer);
      var sugEl = el('pmHashtagSuggestions');
      if (sugEl) sugEl.style.display = 'none';
    }
  }

  function showHashtagSuggestions(query) {
    InnovateAPI.apiRequest('/hashtags/search?q=' + encodeURIComponent(query)).then(function (data) {
      var list = el('pmHashtagList');
      var container = el('pmHashtagSuggestions');
      if (!list || !container) return;
      var hashtags = data.hashtags || data || [];
      if (!hashtags.length) { container.style.display = 'none'; return; }

      list.innerHTML = hashtags.map(function (h) {
        var tag = h.tag || h.name || h;
        return '<button class="cp-hashtag-btn" onclick="PostModal.insertHashtag(\'' + tag + '\')">#' + tag + '</button>';
      }).join('');
      container.style.display = '';
    }).catch(function () {
      var sugEl = el('pmHashtagSuggestions');
      if (sugEl) sugEl.style.display = 'none';
    });
  }

  function insertHashtag(tag) {
    var textarea = el('pmCaption');
    if (!textarea) return;
    var text = textarea.value;
    var cursorPos = textarea.selectionStart;
    var beforeCursor = text.substring(0, cursorPos);
    var afterCursor = text.substring(cursorPos);
    var newBefore = beforeCursor.replace(/#\w*$/, '#' + tag + ' ');
    textarea.value = newBefore + afterCursor;
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = newBefore.length;
    var sugEl = el('pmHashtagSuggestions');
    if (sugEl) sugEl.style.display = 'none';
    onCaptionInput(textarea);
  }

  // ========== @MENTION SUGGESTIONS ==========
  function showMentionSuggestions(query) {
    clearTimeout(mentionDebounceTimer);
    mentionDebounceTimer = setTimeout(function () {
      InnovateAPI.apiRequest('/search/users?q=' + encodeURIComponent(query) + '&limit=6').then(function (data) {
        var container = el('pmMentionSuggestions');
        var list = el('pmMentionList');
        if (!container || !list) return;
        var users = data.users || data || [];
        if (!users.length) { container.style.display = 'none'; return; }

        list.innerHTML = users.map(function (u) {
          var uname = u.username || u.name || u;
          var avatar = u.avatar || u.profile_image || '/images/default-avatar.svg';
          var displayName = u.display_name || u.full_name || uname;
          return '<button class="cp-mention-btn" onclick="PostModal.insertMention(\'' + uname.replace(/'/g, "\\'") + '\')" style="display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 12px; background: none; border: none; cursor: pointer; text-align: left; color: var(--ig-primary-text); transition: background 0.15s;" onmouseover="this.style.background=\'var(--ig-hover)\'" onmouseout="this.style.background=\'none\'">'
            + '<img src="' + avatar + '" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; flex-shrink: 0;" onerror="this.src=\'/images/default-avatar.svg\'">'
            + '<div style="flex: 1; min-width: 0;">'
            + '<div style="font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">' + uname + '</div>'
            + (displayName !== uname ? '<div style="font-size: 12px; color: var(--ig-secondary-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">' + displayName + '</div>' : '')
            + '</div></button>';
        }).join('');
        container.style.display = '';
      }).catch(function () {
        var container = el('pmMentionSuggestions');
        if (container) container.style.display = 'none';
      });
    }, 250);
  }

  function insertMention(username) {
    var textarea = el('pmCaption');
    if (!textarea) return;
    var text = textarea.value;
    var cursorPos = textarea.selectionStart;
    var beforeCursor = text.substring(0, cursorPos);
    var afterCursor = text.substring(cursorPos);
    var newBefore = beforeCursor.replace(/@\w[\w.]*$/, '@' + username + ' ');
    textarea.value = newBefore + afterCursor;
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = newBefore.length;
    var container = el('pmMentionSuggestions');
    if (container) container.style.display = 'none';
    onCaptionInput(textarea);
  }

  function toggleTrending() {
    var list = el('pmTrendingList');
    var chev = el('pmTrendingChevron');
    if (!list) return;
    var visible = list.style.display !== 'none';
    list.style.display = visible ? 'none' : '';
    if (chev) chev.style.transform = visible ? '' : 'rotate(180deg)';
    if (!visible && list.innerHTML === '') loadTrendingHashtags();
  }

  function loadTrendingHashtags() {
    InnovateAPI.apiRequest('/posts/trending-hashtags').then(function (data) {
      var list = el('pmTrendingList');
      if (!list) return;
      var hashtags = data.hashtags || data || [];
      list.innerHTML = hashtags.map(function (h) {
        var tag = h.tag || h.name || h;
        var count = h.count || '';
        return '<button class="cp-trending-tag" onclick="PostModal.insertHashtag(\'' + tag + '\')">#' + tag + (count ? ' <small>' + count + '</small>' : '') + '</button>';
      }).join('');
    }).catch(function () {});
  }

  // ========== CHUNKED VIDEO UPLOAD ==========
  async function uploadVideoChunked(file, onProgress) {
    var totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    var initRes = await InnovateAPI.apiRequest('/posts/upload/init', {
      method: 'POST',
      body: JSON.stringify({
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        totalChunks: totalChunks
      })
    });
    var uploadId = initRes.uploadId;

    var completed = 0;
    for (var batch = 0; batch < totalChunks; batch += PARALLEL_UPLOADS) {
      var promises = [];
      for (var j = 0; j < PARALLEL_UPLOADS && (batch + j) < totalChunks; j++) {
        (function (i) {
          var start = i * CHUNK_SIZE;
          var end = Math.min(start + CHUNK_SIZE, file.size);
          var chunk = file.slice(start, end);
          var chunkForm = new FormData();
          chunkForm.append('uploadId', uploadId);
          chunkForm.append('chunkIndex', i.toString());
          chunkForm.append('chunk', chunk, 'chunk_' + i);

          promises.push(
            InnovateAPI.apiRequest('/posts/upload/chunk', {
              method: 'POST',
              body: chunkForm,
              headers: {}
            }).then(function () {
              completed++;
              if (onProgress) onProgress(completed, totalChunks);
            })
          );
        })(batch + j);
      }
      await Promise.all(promises);
    }

    var finalRes = await InnovateAPI.apiRequest('/posts/upload/finalize', {
      method: 'POST',
      body: JSON.stringify({ uploadId: uploadId })
    });

    return finalRes.filePath;
  }

  // ========== SUBMIT ==========
  async function submit() {
    if (mode === 'edit') {
      await submitEdit();
    } else {
      if (activeTab === 'series') {
        await submitCreatorSeries();
      } else {
        await submitPost();
      }
    }
  }

  async function submitPost() {
    var shareBtn = el('pmShareBtn');
    var content = el('pmCaption').value;
    var scheduleTime = el('pmScheduleTime') ? el('pmScheduleTime').value : '';
    var enableContact = el('pmEnableContact') ? el('pmEnableContact').checked : false;
    var enableInterested = el('pmEnableInterested') ? el('pmEnableInterested').checked : false;

    var validImages = selectedImages.filter(Boolean);
    var validFiles = selectedFiles.filter(Boolean);

    if (!content && validImages.length === 0 && validFiles.length === 0) {
      InnovateAPI.showAlert('Please add content or media to share', 'error');
      return;
    }

    shareBtn.disabled = true;
    shareBtn.classList.add('cp-sharing');
    shareBtn.textContent = 'Sharing...';

    var formData = new FormData();
    formData.append('content', content);

    var hashtags = content.match(/#[\w]+/g);
    if (hashtags) formData.append('hashtags', JSON.stringify(hashtags.map(function (h) { return h.substring(1); })));

    validImages.forEach(function (file) {
      if (file.type.startsWith('video/')) {
        formData.append('video', file);
      } else {
        formData.append('images', file);
      }
    });

    validFiles.forEach(function (file) {
      formData.append('files', file);
    });

    // Poll
    var pollSection = el('pmPollSection');
    if (pollSection && pollSection.style.display !== 'none') {
      var pollQ = el('pmPollQuestion') ? el('pmPollQuestion').value : '';
      var pollOpts = Array.from(el('pmPollOptions').querySelectorAll('.pm-poll-option')).map(function (i) { return i.value; }).filter(function (v) { return v.trim(); });
      var pollExpiry = el('pmPollExpiry') ? el('pmPollExpiry').value : '';

      if (pollQ && pollOpts.length >= 2) {
        formData.append('poll_question', pollQ);
        formData.append('poll_options', JSON.stringify(pollOpts));
        if (pollExpiry) formData.append('poll_expiry', pollExpiry);
      } else if (pollQ || pollOpts.length > 0) {
        shareBtn.disabled = false; shareBtn.classList.remove('cp-sharing'); shareBtn.textContent = 'Share';
        InnovateAPI.showAlert('Poll needs a question and at least 2 options', 'error');
        return;
      }
    }

    if (scheduleTime) formData.append('scheduled_at', scheduleTime);
    formData.append('enable_contact', enableContact ? '1' : '0');
    formData.append('enable_interested', enableInterested ? '1' : '0');

    var customButtonData = collectCustomButtonData();
    if (customButtonData) formData.append('custom_button', JSON.stringify(customButtonData));

    var commentDMData = collectCommentDMData();
    if (commentDMData) formData.append('comment_to_dm', JSON.stringify(commentDMData));

    // Post Public toggle for private accounts
    var publicPostToggle = el('pmPublicPost');
    if (publicPostToggle && publicPostToggle.checked) {
      formData.append('is_public_post', '1');
    }

    try {
      await InnovateAPI.apiRequest('/posts', { method: 'POST', body: formData, headers: {} });
      InnovateAPI.showAlert(scheduleTime ? 'Post scheduled successfully!' : 'Post shared!', 'success');
      close();
      _refreshPosts();
    } catch (error) {
      InnovateAPI.showAlert(error.message || 'Failed to create post', 'error');
    } finally {
      shareBtn.disabled = false;
      shareBtn.classList.remove('cp-sharing');
      shareBtn.textContent = 'Share';
    }
  }

  async function submitCreatorSeries() {
    var shareBtn = el('pmShareBtn');
    var content = el('pmCaption').value;
    var scheduleTime = el('pmScheduleTime') ? el('pmScheduleTime').value : '';
    var enableContact = el('pmEnableContact') ? el('pmEnableContact').checked : false;
    var enableInterested = el('pmEnableInterested') ? el('pmEnableInterested').checked : false;

    if (!csVideoFile) {
      InnovateAPI.showAlert('Please upload a video for your creator series', 'error');
      return;
    }

    shareBtn.disabled = true;
    shareBtn.classList.add('cp-sharing');

    try {
      var videoPath;
      var sizeMB = csVideoFile.size / (1024 * 1024);

      if (sizeMB > 4) {
        shareBtn.textContent = 'Uploading 0%...';
        videoPath = await uploadVideoChunked(csVideoFile, function (done, total) {
          var pct = Math.round((done / total) * 100);
          shareBtn.textContent = 'Uploading ' + pct + '%...';
        });
      } else {
        shareBtn.textContent = 'Uploading...';
        videoPath = null;
      }

      shareBtn.textContent = 'Sharing...';

      var formData = new FormData();
      formData.append('content', content);
      formData.append('is_creator_series', '1');

      if (videoPath) {
        formData.append('chunked_video_path', videoPath);
      } else {
        formData.append('video', csVideoFile);
      }

      // Trim info
      var trimStartSec = csTrimStart * csDuration;
      var trimEndSec = csTrimEnd * csDuration;
      formData.append('trim_start', trimStartSec.toFixed(2));
      formData.append('trim_end', trimEndSec.toFixed(2));
      formData.append('cover_time', csCoverTime.toFixed(2));

      // Audio
      var muted = el('pmMuteAudio') ? el('pmMuteAudio').checked : false;
      var volume = el('pmAudioVolume') ? el('pmAudioVolume').value : '100';
      formData.append('audio_muted', muted ? '1' : '0');
      formData.append('audio_volume', volume);

      // Hashtags
      var hashtags = content.match(/#[\w]+/g);
      if (hashtags) formData.append('hashtags', JSON.stringify(hashtags.map(function (h) { return h.substring(1); })));

      // Poll
      var pollSection = el('pmPollSection');
      if (pollSection && pollSection.style.display !== 'none') {
        var pollQ = el('pmPollQuestion') ? el('pmPollQuestion').value : '';
        var pollOpts = Array.from(el('pmPollOptions').querySelectorAll('.pm-poll-option')).map(function (i) { return i.value; }).filter(function (v) { return v.trim(); });
        var pollExpiry = el('pmPollExpiry') ? el('pmPollExpiry').value : '';
        if (pollQ && pollOpts.length >= 2) {
          formData.append('poll_question', pollQ);
          formData.append('poll_options', JSON.stringify(pollOpts));
          if (pollExpiry) formData.append('poll_expiry', pollExpiry);
        } else if (pollQ || pollOpts.length > 0) {
          shareBtn.disabled = false; shareBtn.classList.remove('cp-sharing'); shareBtn.textContent = 'Share';
          InnovateAPI.showAlert('Poll needs a question and at least 2 options', 'error');
          return;
        }
      }

      if (scheduleTime) formData.append('scheduled_at', scheduleTime);
      formData.append('enable_contact', enableContact ? '1' : '0');
      formData.append('enable_interested', enableInterested ? '1' : '0');

      var customButtonData = collectCustomButtonData();
      if (customButtonData) formData.append('custom_button', JSON.stringify(customButtonData));
      var commentDMData = collectCommentDMData();
      if (commentDMData) formData.append('comment_to_dm', JSON.stringify(commentDMData));

      // Post Public toggle for private accounts
      var publicPostCheck = el('pmPublicPost');
      if (publicPostCheck) formData.append('is_public_post', publicPostCheck.checked ? '1' : '0');

      await InnovateAPI.apiRequest('/posts', { method: 'POST', body: formData, headers: {} });
      InnovateAPI.showAlert(scheduleTime ? 'Creator Series scheduled!' : 'Creator Series shared!', 'success');
      close();
      _refreshPosts();
    } catch (error) {
      InnovateAPI.showAlert(error.message || 'Failed to create creator series', 'error');
    } finally {
      shareBtn.disabled = false;
      shareBtn.classList.remove('cp-sharing');
      shareBtn.textContent = 'Share';
    }
  }

  async function submitEdit() {
    var shareBtn = el('pmShareBtn');
    var content = el('pmCaption').value.trim();
    var scheduleTime = el('pmScheduleTime') ? el('pmScheduleTime').value : '';
    var enableContact = el('pmEnableContact') ? el('pmEnableContact').checked : false;
    var enableInterested = el('pmEnableInterested') ? el('pmEnableInterested').checked : false;
    var isCS = activeTab === 'series';

    if (!content && !selectedImages.filter(Boolean).length && !existingImages.filter(Boolean).length && !(editPostData && editPostData.video_url) && !csVideoFile) {
      InnovateAPI.showAlert('Post must have content or media', 'error');
      return;
    }

    shareBtn.disabled = true;
    shareBtn.classList.add('cp-sharing');
    shareBtn.textContent = 'Saving...';

    var formData = new FormData();
    formData.append('content', content);

    var hashtags = content.match(/#[\w]+/g);
    if (hashtags) formData.append('hashtags', JSON.stringify(hashtags.map(function (h) { return h.substring(1); })));

    if (isCS) {
      // Creator Series edit
      formData.append('is_creator_series', '1');

      if (csVideoFile) {
        // New video was selected
        var sizeMB = csVideoFile.size / (1024 * 1024);
        if (sizeMB > 4) {
          try {
            shareBtn.textContent = 'Uploading 0%...';
            var videoPath = await uploadVideoChunked(csVideoFile, function (done, total) {
              shareBtn.textContent = 'Uploading ' + Math.round((done / total) * 100) + '%...';
            });
            formData.append('chunked_video_path', videoPath);
          } catch (e) {
            shareBtn.disabled = false; shareBtn.classList.remove('cp-sharing'); shareBtn.textContent = 'Save';
            InnovateAPI.showAlert('Video upload failed', 'error');
            return;
          }
        } else {
          formData.append('video', csVideoFile);
        }
        shareBtn.textContent = 'Saving...';
      }

      // Trim info
      var trimStartSec = csTrimStart * csDuration;
      var trimEndSec = csTrimEnd * csDuration;
      formData.append('trim_start', trimStartSec.toFixed(2));
      formData.append('trim_end', trimEndSec.toFixed(2));
      formData.append('cover_time', csCoverTime.toFixed(2));

      var muted = el('pmMuteAudio') ? el('pmMuteAudio').checked : false;
      var volume = el('pmAudioVolume') ? el('pmAudioVolume').value : '100';
      formData.append('audio_muted', muted ? '1' : '0');
      formData.append('audio_volume', volume);
    } else {
      // Regular post edit
      if (editPostData && editPostData.images) {
        var kept = existingImages.filter(Boolean);
        formData.append('existingImages', JSON.stringify(kept));
      }
      if (editPostData && editPostData.files) {
        var keptFiles = existingFiles.filter(Boolean);
        formData.append('existingFiles', JSON.stringify(keptFiles));
      }
      selectedImages.filter(Boolean).forEach(function (file) {
        if (file.type.startsWith('video/')) formData.append('video', file);
        else formData.append('images', file);
      });
      selectedFiles.filter(Boolean).forEach(function (file) {
        formData.append('files', file);
      });
    }

    // Poll
    var pollSection = el('pmPollSection');
    if (pollSection && pollSection.style.display !== 'none') {
      var pollQ = el('pmPollQuestion') ? el('pmPollQuestion').value : '';
      var pollOpts = Array.from(el('pmPollOptions').querySelectorAll('.pm-poll-option')).map(function (i) { return i.value; }).filter(function (v) { return v.trim(); });
      var pollExpiry = el('pmPollExpiry') ? el('pmPollExpiry').value : '';
      if (pollQ && pollOpts.length >= 2) {
        formData.append('poll_question', pollQ);
        formData.append('poll_options', JSON.stringify(pollOpts));
        if (pollExpiry) formData.append('poll_expiry', pollExpiry);
      } else if (pollQ || pollOpts.length > 0) {
        shareBtn.disabled = false; shareBtn.classList.remove('cp-sharing'); shareBtn.textContent = 'Save';
        InnovateAPI.showAlert('Poll needs a question and at least 2 options', 'error');
        return;
      }
    }

    if (scheduleTime) formData.append('scheduled_at', scheduleTime);
    formData.append('enable_contact', enableContact ? '1' : '0');
    formData.append('enable_interested', enableInterested ? '1' : '0');

    var customButtonData = collectCustomButtonData();
    if (customButtonData) formData.append('custom_button', JSON.stringify(customButtonData));
    else formData.append('custom_button', '');

    var commentDMData = collectCommentDMData();
    if (commentDMData) formData.append('comment_to_dm', JSON.stringify(commentDMData));
    else formData.append('comment_to_dm', '');

    // Post Public toggle for private accounts
    var publicPostCheck = el('pmPublicPost');
    if (publicPostCheck) formData.append('is_public_post', publicPostCheck.checked ? '1' : '0');

    try {
      await InnovateAPI.apiRequest('/posts/' + editPostId, { method: 'PUT', body: formData, headers: {} });
      close();
      InnovateAPI.showAlert('Post updated successfully!', 'success');
      _refreshPosts();
    } catch (error) {
      InnovateAPI.showAlert(error.message || 'Failed to update post', 'error');
    } finally {
      shareBtn.disabled = false;
      shareBtn.classList.remove('cp-sharing');
      shareBtn.textContent = 'Save';
    }
  }

  // ========== PUBLIC API ==========
  return {
    init: init,
    openCreate: openCreate,
    openEdit: openEdit,
    close: close,
    switchTab: switchTab,
    submit: submit,
    onMediaSelected: onMediaSelected,
    onFilesSelected: onFilesSelected,
    removeExistingMedia: removeExistingMedia,
    removeExistingFile: removeExistingFile,
    onCSVideoSelected: onCSVideoSelected,
    changeCSVideo: changeCSVideo,
    toggleCSPlayback: toggleCSPlayback,
    toggleAudioSection: toggleAudioSection,
    togglePoll: togglePoll,
    addPollOption: addPollOption,
    toggleSchedule: toggleSchedule,
    toggleAdvanced: toggleAdvanced,
    toggleCBSection: toggleCBSection,
    addCBField: addCBField,
    addCBCustomField: addCBCustomField,
    addCDMItem: addCDMItem,
    onCaptionInput: onCaptionInput,
    insertHashtag: insertHashtag,
    insertMention: insertMention,
    toggleTrending: toggleTrending
  };
})();
