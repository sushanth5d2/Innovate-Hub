/* global InnovateAPI, igTheme */

(function () {
  if (!window.InnovateAPI) {
    console.error('InnovateAPI is not available. Did /js/app.js fail to load?');
    return;
  }

  const communityId = (() => {
    const parts = window.location.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1];
  })();

  const state = {
    community: null,
    groups: [],
    currentGroup: null,
    activeView: 'chat',
    rightTab: 'files',
    tasks: [],
    notes: [],
    currentNote: null,
    currentNoteVersions: [],
    chat: [],
    members: [],
    files: [],
    links: [],
    announcements: [],
    call: {
      joined: false,
      mode: 'video',
      localStream: null,
      screenStream: null,
      peers: new Map(), // socketId -> { pc, userId, displayName, stream }
      socket: null,
      muted: false,
      cameraOff: false,
      screenSharing: false,
      displayName: null,
      userId: null
    }
  };

  const el = {
    sidebar: document.getElementById('wsSidebar'),
    sidebarToggle: document.getElementById('wsSidebarToggle'),
    themeToggle: document.getElementById('wsThemeToggle'),

    communityName: document.getElementById('wsCommunityName'),
    communityMeta: document.getElementById('wsCommunityMeta'),
    
    // Announcements
    createAnnouncement: document.getElementById('wsCreateAnnouncement'),
    announcementsList: document.getElementById('wsAnnouncementsList'),
    pinnedAnnouncements: document.getElementById('wsPinnedAnnouncements'),
    announcementsEmpty: document.getElementById('wsAnnouncementsEmpty'),
    leaveBtn: document.getElementById('wsLeaveCommunity'),

    groupsList: document.getElementById('wsGroupsList'),
    createGroupBtn: document.getElementById('wsCreateGroup'),

    contextTitle: document.getElementById('wsContextTitle'),
    contextSub: document.getElementById('wsContextSub'),

    tabs: Array.from(document.querySelectorAll('[data-ws-tab]')),
    emptyState: document.getElementById('wsEmptyState'),
    views: {
      chat: document.getElementById('view-chat'),
      calls: document.getElementById('view-calls'),
      todo: document.getElementById('view-todo'),
      notes: document.getElementById('view-notes')
    },

    chatMessages: document.getElementById('wsChatMessages'),
    chatInput: document.getElementById('wsChatInput'),
    chatAttach: document.getElementById('wsChatAttach'),
    chatLocBtn: document.getElementById('wsChatLocation'),
    chatSendBtn: document.getElementById('wsChatSend'),
    chatHint: document.getElementById('wsChatHint'),

    rightTabs: Array.from(document.querySelectorAll('[data-ws-right]')),
    rightBody: document.getElementById('wsRightBody'),

    // To-do
    todoText: document.getElementById('wsTodoText'),
    todoCreateFromText: document.getElementById('wsTodoCreateFromText'),
    todoImage: document.getElementById('wsTodoImage'),
    todoCreateFromImage: document.getElementById('wsTodoCreateFromImage'),
    todoCols: {
      todo: document.getElementById('wsColTodo'),
      in_progress: document.getElementById('wsColInProgress'),
      done: document.getElementById('wsColDone')
    },

    // Notes
    notesList: document.getElementById('wsNotesList'),
    noteTitle: document.getElementById('wsNoteTitle'),
    noteContent: document.getElementById('wsNoteContent'),
    noteNewBtn: document.getElementById('wsNoteNew'),
    noteSaveBtn: document.getElementById('wsNoteSave'),
    noteVersionsBtn: document.getElementById('wsNoteVersions'),
    noteStatus: document.getElementById('wsNoteStatus'),

    // Calls
    callStartVoice: document.getElementById('wsStartVoice'),
    callStartVideo: document.getElementById('wsStartVideo'),
    callJoin: document.getElementById('wsJoinCall'),
    callLeave: document.getElementById('wsLeaveCall'),
    callMute: document.getElementById('wsMute'),
    callCamera: document.getElementById('wsCamera'),
    callScreen: document.getElementById('wsScreen'),
    callParticipants: document.getElementById('wsParticipants'),
    callGrid: document.getElementById('wsVideoGrid')
  };

  function setGroupSelectedUI(isSelected) {
    if (el.emptyState) {
      el.emptyState.classList.toggle('hidden', !!isSelected);
    }

    const disable = !isSelected;

    // Chat
    if (el.chatInput) el.chatInput.disabled = disable;
    if (el.chatAttach) el.chatAttach.disabled = disable;
    if (el.chatLocBtn) el.chatLocBtn.disabled = disable;
    if (el.chatSendBtn) el.chatSendBtn.disabled = disable;

    // To-do
    if (el.todoText) el.todoText.disabled = disable;
    if (el.todoImage) el.todoImage.disabled = disable;
    if (el.todoCreateFromText) el.todoCreateFromText.disabled = disable;
    if (el.todoCreateFromImage) el.todoCreateFromImage.disabled = disable;

    // Notes
    if (el.noteTitle) el.noteTitle.disabled = disable;
    if (el.noteContent) el.noteContent.disabled = disable;
    if (el.noteNewBtn) el.noteNewBtn.disabled = disable;
    if (el.noteSaveBtn) el.noteSaveBtn.disabled = disable;
    if (el.noteVersionsBtn) el.noteVersionsBtn.disabled = disable;

    // Calls
    if (el.callStartVoice) el.callStartVoice.disabled = disable;
    if (el.callStartVideo) el.callStartVideo.disabled = disable;
    if (el.callJoin) el.callJoin.disabled = disable;
    if (el.callLeave) el.callLeave.disabled = disable;
  }

  function formatTime(ts) {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  function fileIconByType(type) {
    if (type === 'image') return '🖼️';
    if (type === 'video') return '🎬';
    if (type === 'document') return '📄';
    return '📎';
  }

  function guessFileTypeFromUrl(url) {
    const s = String(url || '').toLowerCase();
    if (s.match(/\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/)) return 'image';
    if (s.match(/\.(mp4|mov|webm|mkv|avi)(\?|#|$)/)) return 'video';
    if (s.match(/\.(pdf|docx?|xlsx?|pptx?|txt)(\?|#|$)/)) return 'document';
    return 'other';
  }

  function filenameFromUrl(url) {
    try {
      const clean = String(url || '').split('?')[0].split('#')[0];
      const parts = clean.split('/');
      return decodeURIComponent(parts[parts.length - 1] || 'file');
    } catch {
      return 'file';
    }
  }

  function ensureGroupSelected() {
    if (!state.currentGroup) {
      throw new Error('Select a group first');
    }
  }

  function setActiveView(view) {
    state.activeView = view;
    
    // Handle views object
    for (const [k, node] of Object.entries(el.views)) {
      node.classList.toggle('active', k === view);
    }
    
    // Handle announcements view separately
    const announcementsView = document.getElementById('view-announcements');
    if (announcementsView) {
      announcementsView.classList.toggle('active', view === 'announcements');
    }
    
    el.tabs.forEach(b => b.classList.toggle('active', b.dataset.wsTab === view));

    // lazy load data per view
    if (view === 'chat') loadGroupChat();
    if (view === 'todo') loadGroupTasks();
    if (view === 'notes') loadNotes();
    if (view === 'announcements') loadAnnouncements();
  }

  function setRightTab(tab) {
    state.rightTab = tab;
    el.rightTabs.forEach(b => b.classList.toggle('active', b.dataset.wsRight === tab));
    renderRightPanel();
  }

  function renderCommunity() {
    if (!state.community) return;
    el.communityName.textContent = state.community.name || 'Community';
    const parts = [];
    if (state.community.team_name) parts.push(state.community.team_name);
    if (typeof state.community.member_count !== 'undefined') parts.push(`${state.community.member_count} members`);
    parts.push(state.community.is_public ? 'Public' : 'Private');
    el.communityMeta.textContent = parts.filter(Boolean).join(' • ');

    el.leaveBtn.style.display = state.community.is_member ? 'inline-flex' : 'none';
  }

  function renderGroups() {
    el.groupsList.innerHTML = '';

    if (!state.groups || state.groups.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ws-card-sub';
      empty.style.padding = '0 12px 12px';
      empty.textContent = 'No groups yet. Create one.';
      el.groupsList.appendChild(empty);
      return;
    }

    state.groups.forEach(g => {
      const row = document.createElement('div');
      row.className = 'ws-item' + (state.currentGroup?.id === g.id ? ' active' : '');

      const left = document.createElement('div');
      left.style.minWidth = '0';

      const t = document.createElement('div');
      t.className = 'ws-item-title';
      t.textContent = g.name;

      const s = document.createElement('div');
      s.className = 'ws-item-sub';
      s.textContent = `${g.member_count || 0} members` + (g.is_member ? '' : ' • Join to access');

      left.appendChild(t);
      left.appendChild(s);

      const badge = document.createElement('div');
      badge.className = 'ws-badge';
      badge.textContent = g.is_member ? 'Member' : 'Join';

      row.appendChild(left);
      row.appendChild(badge);

      row.addEventListener('click', async () => {
        try {
          if (!g.is_member) {
            await InnovateAPI.apiRequest(`/community-groups/${g.id}/join`, { method: 'POST' });
            g.is_member = 1;
          }
          state.currentGroup = g;
          setGroupSelectedUI(true);
          el.contextTitle.textContent = `# ${g.name}`;
          el.contextSub.textContent = g.description || 'Group workspace';
          renderGroups();
          if (window.matchMedia && window.matchMedia('(max-width: 640px)').matches) {
            el.sidebar.classList.remove('open');
          }
          await refreshAllForGroup();
        } catch (e) {
          InnovateAPI.showAlert(e.message || 'Failed to open group', 'error');
        }
      });

      el.groupsList.appendChild(row);
    });
  }

  async function loadCommunity() {
    const data = await InnovateAPI.apiRequest(`/communities/${communityId}`);
    state.community = data.community;
    renderCommunity();
    await loadAnnouncements(); // Load announcements when community loads
  }

  async function loadAnnouncements() {
    try {
      const data = await InnovateAPI.apiRequest(`/communities/${communityId}/announcements`);
      state.announcements = data.announcements || [];
      renderAnnouncements();
    } catch (e) {
      console.error('Error loading announcements:', e);
    }
  }

  function renderAnnouncements() {
    if (!el.announcementsList || !el.pinnedAnnouncements) return;

    const pinned = state.announcements.filter(a => a.is_pinned);
    const regular = state.announcements.filter(a => !a.is_pinned);

    // Show create button for ALL members (for testing) - in production, restrict to admins
    const user = InnovateAPI.getCurrentUser();
    // Temporarily allow everyone to create announcements for testing
    // TODO: In production, restrict to: state.community && (state.community.admin_id === user.id || state.community.role === 'moderator')
    const isAdminOrMod = true;
    
    if (el.createAnnouncement) {
      el.createAnnouncement.style.display = isAdminOrMod ? 'inline-block' : 'none';
      console.log('Create announcement button should be visible:', isAdminOrMod);
    }

    // Render pinned announcements
    el.pinnedAnnouncements.innerHTML = '';
    pinned.forEach(a => {
      const card = createAnnouncementCard(a, true);
      el.pinnedAnnouncements.appendChild(card);
    });

    // Render regular announcements
    el.announcementsList.innerHTML = '';
    regular.forEach(a => {
      const card = createAnnouncementCard(a, false);
      el.announcementsList.appendChild(card);
    });

    // Show empty state if no announcements
    if (el.announcementsEmpty) {
      el.announcementsEmpty.style.display = state.announcements.length === 0 ? 'block' : 'none';
    }
  }

  function createAnnouncementCard(announcement, isPinned) {
    const card = document.createElement('div');
    card.style.cssText = `
      background: var(--ig-primary-background);
      border: 1px solid var(--ig-border);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 16px;
      ${isPinned ? 'border-left: 4px solid #0095f6;' : ''}
    `;

    const header = document.createElement('div');
    header.style.cssText = 'display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;';
    
    const headerLeft = document.createElement('div');
    headerLeft.style.flex = '1';
    
    const titleRow = document.createElement('div');
    titleRow.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 4px;';
    
    if (isPinned) {
      const pin = document.createElement('span');
      pin.textContent = '📌';
      pin.style.fontSize = '18px';
      titleRow.appendChild(pin);
    }
    
    const title = document.createElement('h3');
    title.textContent = announcement.title;
    title.style.cssText = 'font-size: 18px; font-weight: 600; margin: 0;';
    titleRow.appendChild(title);
    
    const author = document.createElement('div');
    author.style.cssText = 'font-size: 13px; color: var(--ig-secondary-text);';
    author.textContent = `By ${announcement.author_username} • ${InnovateAPI.formatDate(announcement.created_at)}`;
    
    headerLeft.appendChild(titleRow);
    headerLeft.appendChild(author);
    
    // Actions for admin/moderator
    const user = InnovateAPI.getCurrentUser();
    const isAdminOrMod = state.community && (
      state.community.admin_id === user.id || 
      announcement.author_id === user.id
    );
    
    if (isAdminOrMod) {
      const actions = document.createElement('div');
      actions.style.cssText = 'display: flex; gap: 8px;';
      
      const pinBtn = document.createElement('button');
      pinBtn.className = 'ws-pill';
      pinBtn.textContent = isPinned ? 'Unpin' : 'Pin';
      pinBtn.onclick = () => togglePinAnnouncement(announcement.id, !isPinned);
      
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'ws-pill danger';
      deleteBtn.textContent = 'Delete';
      deleteBtn.onclick = () => deleteAnnouncement(announcement.id);
      
      actions.appendChild(pinBtn);
      actions.appendChild(deleteBtn);
      header.appendChild(actions);
    }
    
    header.appendChild(headerLeft);
    
    const body = document.createElement('div');
    body.style.cssText = 'color: var(--ig-primary-text); line-height: 1.6; white-space: pre-wrap;';
    body.textContent = announcement.body;
    
    card.appendChild(header);
    card.appendChild(body);
    
    return card;
  }

  async function createAnnouncement() {
    const title = prompt('Announcement title:');
    if (!title) return;
    // Create a modal for better UX
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    `;
    
    const form = document.createElement('div');
    form.style.cssText = `
      background: var(--ig-primary-background);
      border-radius: 12px;
      padding: 24px;
      max-width: 500px;
      width: 90%;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    `;
    
    form.innerHTML = `
      <h3 style="margin: 0 0 20px 0; font-size: 20px; font-weight: 600;">📢 Create Announcement</h3>
      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 8px; font-weight: 500;">Title:</label>
        <input type="text" id="announcementTitle" style="width: 100%; padding: 12px; border: 1px solid var(--ig-border); border-radius: 8px; font-size: 14px; background: var(--ig-secondary-background); color: var(--ig-primary-text);" placeholder="e.g., Exam Schedule Updated">
      </div>
      <div style="margin-bottom: 20px;">
        <label style="display: block; margin-bottom: 8px; font-weight: 500;">Message:</label>
        <textarea id="announcementBody" rows="5" style="width: 100%; padding: 12px; border: 1px solid var(--ig-border); border-radius: 8px; font-size: 14px; resize: vertical; background: var(--ig-secondary-background); color: var(--ig-primary-text);" placeholder="Write your announcement message here..."></textarea>
      </div>
      <div style="display: flex; gap: 12px; justify-content: flex-end;">
        <button id="cancelAnnouncement" class="ws-pill" style="padding: 10px 20px;">Cancel</button>
        <button id="submitAnnouncement" class="ws-pill primary" style="padding: 10px 20px;">Create Announcement</button>
      </div>
    `;
    
    modal.appendChild(form);
    document.body.appendChild(modal);
    
    const titleInput = document.getElementById('announcementTitle');
    const bodyInput = document.getElementById('announcementBody');
    
    titleInput.focus();
    
    document.getElementById('cancelAnnouncement').onclick = () => {
      document.body.removeChild(modal);
    };
    
    document.getElementById('submitAnnouncement').onclick = async () => {
      const title = titleInput.value.trim();
      const body = bodyInput.value.trim();
      
      if (!title) {
        InnovateAPI.showAlert('Please enter a title', 'error');
        return;
      }
      
      if (!body) {
        InnovateAPI.showAlert('Please enter a message', 'error');
        return;
      }
      
      try {
        await InnovateAPI.apiRequest(`/communities/${communityId}/announcements`, {
          method: 'POST',
          body: JSON.stringify({ title, body, is_pinned: false })
        });
        
        InnovateAPI.showAlert('Announcement created! Everyone can see it now.', 'success');
        document.body.removeChild(modal);
        await loadAnnouncements();
      } catch (e) {
        InnovateAPI.showAlert(e.message || 'Failed to create announcement', 'error');
      }
    };
    
    // Close on background click
    modal.onclick = (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
      }
    };
  }

  async function togglePinAnnouncement(announcementId, isPinned) {
    try {
      await InnovateAPI.apiRequest(`/communities/${communityId}/announcements/${announcementId}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_pinned: isPinned })
      });
      
      InnovateAPI.showAlert(isPinned ? 'Announcement pinned!' : 'Announcement unpinned!', 'success');
      await loadAnnouncements();
    } catch (e) {
      InnovateAPI.showAlert(e.message || 'Failed to update announcement', 'error');
    }
  }

  async function deleteAnnouncement(announcementId) {
    if (!confirm('Delete this announcement?')) return;
    
    try {
      await InnovateAPI.apiRequest(`/communities/${communityId}/announcements/${announcementId}`, {
        method: 'DELETE'
      });
      
      InnovateAPI.showAlert('Announcement deleted!', 'success');
      await loadAnnouncements();
    } catch (e) {
      InnovateAPI.showAlert(e.message || 'Failed to delete announcement', 'error');
    }
  }

  async function loadGroups() {
    const data = await InnovateAPI.apiRequest(`/communities/${communityId}/groups`);
    state.groups = data.groups || [];
    renderGroups();
  }

  async function leaveCommunity() {
    await InnovateAPI.apiRequest(`/communities/${communityId}/leave`, { method: 'POST' });
    window.location.href = '/communities';
  }

  async function createGroup() {
    const name = prompt('Group name (e.g., CSE A):');
    if (!name) return;
    const description = prompt('Description (optional):') || '';
    await InnovateAPI.apiRequest(`/communities/${communityId}/groups`, {
      method: 'POST',
      body: JSON.stringify({ name, description })
    });
    await loadGroups();
    InnovateAPI.showAlert('Group created', 'success');
  }

  function renderChat() {
    el.chatMessages.innerHTML = '';

    if (!state.currentGroup) {
      el.chatHint.textContent = 'Select a group to start.';
      setGroupSelectedUI(false);
      return;
    }

    setGroupSelectedUI(true);
    el.chatHint.textContent = 'Attachments + location supported.';

    const me = InnovateAPI.getCurrentUser();

    (state.chat || []).forEach(m => {
      const wrap = document.createElement('div');
      wrap.className = 'ws-msg' + (me && m.user_id === me.id ? ' me' : '');

      const head = document.createElement('div');
      head.className = 'ws-msg-head';
      head.innerHTML = `<div class="ws-msg-user">${m.username || 'User'}</div><div class="ws-msg-time">${formatTime(m.created_at)}</div>`;

      const body = document.createElement('div');
      body.className = 'ws-msg-body';
      body.textContent = m.content || '';

      wrap.appendChild(head);
      wrap.appendChild(body);

      if (m.attachments && m.attachments.length) {
        const at = document.createElement('div');
        at.className = 'ws-msg-attachments';
        m.attachments.forEach(a => {
          const link = document.createElement('a');
          link.className = 'ws-file';
          const href = (typeof a === 'string') ? a : a?.filepath;
          const name = (typeof a === 'string') ? filenameFromUrl(a) : (a?.filename || 'file');
          const type = (typeof a === 'string') ? guessFileTypeFromUrl(a) : (a?.file_type || 'other');
          link.href = href;
          link.target = '_blank';
          link.rel = 'noopener';
          link.textContent = `${fileIconByType(type)} ${name}`;
          at.appendChild(link);
        });
        wrap.appendChild(at);
      }

      el.chatMessages.appendChild(wrap);
    });

    el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  }

  async function loadGroupChat() {
    if (!state.currentGroup) {
      renderChat();
      return;
    }
    const data = await InnovateAPI.apiRequest(`/community-groups/${state.currentGroup.id}/posts`);
    state.chat = data.posts || [];
    renderChat();
  }

  async function sendChat(locationObj) {
    ensureGroupSelected();

    const text = (el.chatInput.value || '').trim();
    const files = el.chatAttach.files ? Array.from(el.chatAttach.files) : [];

    if (!text && files.length === 0 && !locationObj) {
      return;
    }

    const form = new FormData();
    form.append('content', text);
    if (locationObj) form.append('location', JSON.stringify(locationObj));
    files.forEach(f => form.append('attachments', f));

    await InnovateAPI.apiRequest(`/community-groups/${state.currentGroup.id}/posts`, {
      method: 'POST',
      body: form
    });

    el.chatInput.value = '';
    el.chatAttach.value = '';
    await loadGroupChat();
  }

  async function promptAndSendLocation() {
    ensureGroupSelected();

    if (!navigator.geolocation) {
      InnovateAPI.showAlert('Geolocation not supported', 'error');
      return;
    }

    el.chatLocBtn.disabled = true;
    el.chatLocBtn.textContent = 'Getting location…';

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const loc = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy
          };
          await sendChat(loc);
        } catch (e) {
          InnovateAPI.showAlert(e.message || 'Failed to send location', 'error');
        } finally {
          el.chatLocBtn.disabled = false;
          el.chatLocBtn.textContent = 'Share location';
        }
      },
      (err) => {
        el.chatLocBtn.disabled = false;
        el.chatLocBtn.textContent = 'Share location';
        InnovateAPI.showAlert(err.message || 'Location permission denied', 'error');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  async function loadAnnouncements() {
    const data = await InnovateAPI.apiRequest(`/communities/${communityId}/announcements`);
    state.announcements = data.announcements || [];
  }

  async function loadMembers() {
    if (!state.currentGroup) {
      state.members = [];
      return;
    }
    const data = await InnovateAPI.apiRequest(`/community-groups/${state.currentGroup.id}/members`);
    state.members = data.members || [];
  }

  async function loadFilesAndLinks(type) {
    if (!state.currentGroup) {
      state.files = [];
      state.links = [];
      return;
    }

    const [filesData, linksData] = await Promise.all([
      InnovateAPI.apiRequest(`/community-groups/${state.currentGroup.id}/files${type ? `?type=${encodeURIComponent(type)}` : ''}`),
      InnovateAPI.apiRequest(`/community-groups/${state.currentGroup.id}/links`)
    ]);

    state.files = filesData.files || [];
    state.links = linksData.links || [];
  }

  function renderRightPanel() {
    if (!state.currentGroup) {
      el.rightBody.innerHTML = `<div class="ws-card-sub">Select a group to see details.</div>`;
      return;
    }

    if (state.rightTab === 'files') {
      el.rightBody.innerHTML = '';

      const filters = document.createElement('div');
      filters.className = 'ws-drive-filters';
      const buttons = [
        { key: '', label: 'All' },
        { key: 'image', label: 'Images' },
        { key: 'video', label: 'Videos' },
        { key: 'document', label: 'Documents' },
        { key: 'other', label: 'Files' }
      ];

      buttons.forEach(b => {
        const btn = document.createElement('button');
        btn.className = 'ws-pill' + (!b.key ? ' primary' : '');
        btn.textContent = b.label;
        btn.addEventListener('click', async () => {
          filters.querySelectorAll('button').forEach(x => x.classList.remove('primary'));
          btn.classList.add('primary');
          await loadFilesAndLinks(b.key);
          renderRightPanel();
        });
        filters.appendChild(btn);
      });

      el.rightBody.appendChild(filters);

      const grid = document.createElement('div');
      grid.className = 'ws-drive-grid';

      (state.files || []).forEach(f => {
        const card = document.createElement('div');
        card.className = 'ws-drive-card';
        card.addEventListener('click', () => window.open(f.filepath, '_blank'));
        card.innerHTML = `
          <div class="ws-drive-name">${fileIconByType(f.file_type)} ${f.filename}</div>
          <div class="ws-drive-meta">by ${f.username || 'user'} • ${formatTime(f.created_at)}</div>
        `;
        grid.appendChild(card);
      });

      el.rightBody.appendChild(grid);

      const linksTitle = document.createElement('div');
      linksTitle.style.marginTop = '14px';
      linksTitle.style.marginBottom = '8px';
      linksTitle.style.fontWeight = '900';
      linksTitle.textContent = 'Links';
      el.rightBody.appendChild(linksTitle);

      (state.links || []).forEach(l => {
        const a = document.createElement('a');
        a.className = 'ws-file';
        a.href = l.url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = `🔗 ${l.title || l.url}`;
        el.rightBody.appendChild(a);
      });

      return;
    }

    if (state.rightTab === 'members') {
      el.rightBody.innerHTML = '';
      (state.members || []).forEach(m => {
        const row = document.createElement('div');
        row.className = 'ws-kv';
        row.innerHTML = `<div class="ws-k">${m.role}</div><div class="ws-v">${m.username}</div>`;
        el.rightBody.appendChild(row);
      });
      return;
    }

    if (state.rightTab === 'announcements') {
      el.rightBody.innerHTML = '';
      if (!state.announcements.length) {
        el.rightBody.innerHTML = `<div class="ws-card-sub">No announcements yet.</div>`;
        return;
      }
      state.announcements.forEach(a => {
        const card = document.createElement('div');
        card.className = 'ws-card';
        card.style.margin = '0 0 10px 0';
        card.innerHTML = `
          <div class="ws-card-title">${a.title}${a.is_pinned ? ' 📌' : ''}</div>
          <div class="ws-card-sub">${a.author_username} • ${new Date(a.created_at).toLocaleString()}</div>
          <div style="margin-top:8px; white-space:pre-wrap; font-size:13px;">${(a.body || '').replace(/</g, '&lt;')}</div>
        `;
        el.rightBody.appendChild(card);
      });
      return;
    }

    if (state.rightTab === 'github') {
      el.rightBody.innerHTML = `
        <div class="ws-card">
          <div class="ws-card-title">GitHub</div>
          <div class="ws-card-sub">OAuth + repo browser is the next wiring step.</div>
          <div style="margin-top:10px; font-size:13px; color: var(--ws-muted);">
            The DB table exists (community_github_integrations). Add client id/secret to enable OAuth.
          </div>
        </div>
      `;
      return;
    }
  }

  function renderTasks() {
    const buckets = { todo: [], in_progress: [], done: [] };
    (state.tasks || []).forEach(t => {
      const st = t.status || 'todo';
      if (!buckets[st]) buckets.todo.push(t);
      else buckets[st].push(t);
    });

    const renderCol = (node, items) => {
      node.innerHTML = '';
      items.forEach(t => {
        const card = document.createElement('div');
        card.className = 'ws-task';
        card.innerHTML = `
          <div class="ws-task-title">${t.title}</div>
          <div class="ws-task-meta">
            <span>Priority: ${t.priority || 'medium'}</span>
            <span>Progress: ${typeof t.progress === 'number' ? t.progress : 0}%</span>
          </div>
        `;
        card.addEventListener('click', () => editTask(t));
        node.appendChild(card);
      });
    };

    renderCol(el.todoCols.todo, buckets.todo);
    renderCol(el.todoCols.in_progress, buckets.in_progress);
    renderCol(el.todoCols.done, buckets.done);
  }

  async function loadGroupTasks() {
    if (!state.currentGroup) {
      state.tasks = [];
      renderTasks();
      return;
    }
    const data = await InnovateAPI.apiRequest(`/community-groups/${state.currentGroup.id}/tasks`);
    state.tasks = data.tasks || [];
    renderTasks();
  }

  async function createTasksFromText() {
    ensureGroupSelected();
    const text = (el.todoText.value || '').trim();
    if (!text) return;

    await InnovateAPI.apiRequest(`/community-groups/${state.currentGroup.id}/tasks/from-text`, {
      method: 'POST',
      body: JSON.stringify({ text })
    });

    el.todoText.value = '';
    await loadGroupTasks();
    InnovateAPI.showAlert('Tasks created', 'success');
  }

  async function createTasksFromImage() {
    ensureGroupSelected();
    const file = el.todoImage.files && el.todoImage.files[0];
    if (!file) return;

    const form = new FormData();
    form.append('image', file);

    await InnovateAPI.apiRequest(`/community-groups/${state.currentGroup.id}/tasks/from-image`, {
      method: 'POST',
      body: form
    });

    el.todoImage.value = '';
    await loadGroupTasks();
    InnovateAPI.showAlert('Tasks created from image', 'success');
  }

  async function editTask(task) {
    const nextStatus = prompt('Status: todo | in_progress | done', task.status || 'todo');
    if (!nextStatus) return;
    const nextProgress = prompt('Progress (0-100)', String(task.progress ?? 0));
    const progressNum = Math.max(0, Math.min(100, parseInt(nextProgress || '0', 10)));

    await InnovateAPI.apiRequest(`/community-groups/${state.currentGroup.id}/tasks/${task.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: nextStatus, progress: progressNum })
    });

    await loadGroupTasks();
  }

  async function loadNotes() {
    if (!state.currentGroup) {
      state.notes = [];
      renderNotesList();
      return;
    }
    const data = await InnovateAPI.apiRequest(`/community-groups/${state.currentGroup.id}/notes`);
    state.notes = data.notes || [];
    renderNotesList();
  }

  function renderNotesList() {
    el.notesList.innerHTML = '';

    const makeItem = (title, sub, onClick, active) => {
      const row = document.createElement('div');
      row.className = 'ws-item' + (active ? ' active' : '');
      row.innerHTML = `
        <div style="min-width:0;">
          <div class="ws-item-title">${title}</div>
          <div class="ws-item-sub">${sub}</div>
        </div>
        <div class="ws-badge">Note</div>
      `;
      row.addEventListener('click', onClick);
      return row;
    };

    if (!state.notes.length) {
      el.notesList.innerHTML = '<div class="ws-card-sub">No notes yet.</div>';
      return;
    }

    state.notes.forEach(n => {
      const sub = `${new Date(n.updated_at || n.created_at).toLocaleString()} • ${n.updated_by_username || n.created_by_username}`;
      el.notesList.appendChild(makeItem(n.title, sub, () => openNote(n.id), state.currentNote?.id === n.id));
    });
  }

  async function openNote(noteId) {
    const data = await InnovateAPI.apiRequest(`/community-groups/notes/${noteId}`);
    state.currentNote = data.note;
    el.noteTitle.value = state.currentNote.title || '';
    el.noteContent.value = state.currentNote.content_md || '';
    el.noteStatus.textContent = `Opened • ${new Date(state.currentNote.updated_at || state.currentNote.created_at).toLocaleString()}`;
    renderNotesList();
  }

  async function newNote() {
    ensureGroupSelected();
    const title = prompt('Note title');
    if (!title) return;
    const data = await InnovateAPI.apiRequest(`/community-groups/${state.currentGroup.id}/notes`, {
      method: 'POST',
      body: JSON.stringify({ title, content_md: '' })
    });
    await loadNotes();
    await openNote(data.note.id);
  }

  async function saveNote() {
    if (!state.currentNote) {
      InnovateAPI.showAlert('Open a note first', 'error');
      return;
    }
    await InnovateAPI.apiRequest(`/community-groups/notes/${state.currentNote.id}`, {
      method: 'PUT',
      body: JSON.stringify({ title: el.noteTitle.value, content_md: el.noteContent.value })
    });
    el.noteStatus.textContent = 'Saved';
    await loadNotes();
    await openNote(state.currentNote.id);
  }

  async function showVersions() {
    if (!state.currentNote) return;
    const data = await InnovateAPI.apiRequest(`/community-groups/notes/${state.currentNote.id}/versions`);
    const versions = data.versions || [];
    if (!versions.length) {
      InnovateAPI.showAlert('No versions yet', 'success');
      return;
    }
    const choice = prompt(
      'Restore which version? Enter version id:\n' +
      versions.slice(0, 10).map(v => `${v.id}: ${v.created_by_username} @ ${new Date(v.created_at).toLocaleString()}`).join('\n')
    );
    if (!choice) return;
    await InnovateAPI.apiRequest(`/community-groups/notes/${state.currentNote.id}/restore/${choice}`, { method: 'POST' });
    await openNote(state.currentNote.id);
    InnovateAPI.showAlert('Restored', 'success');
  }

  // === Calls (WebRTC mesh) ===

  function getCallRoomId() {
    return `group-call-${state.currentGroup.id}`;
  }

  function ensureSocket() {
    if (!state.call.socket) {
      state.call.socket = InnovateAPI.getSocket();
      wireSocketHandlers(state.call.socket);
    }
    return state.call.socket;
  }

  function wireSocketHandlers(socket) {
    socket.on('group-call:peers', async ({ groupId, peers }) => {
      if (!state.call.joined || String(groupId) !== String(state.currentGroup?.id)) return;
      for (const p of peers) {
        await createPeerConnection(p.socketId, p.userId, p.displayName, true);
      }
      renderParticipants();
    });

    socket.on('group-call:peer-joined', async ({ groupId, peer }) => {
      if (!state.call.joined || String(groupId) !== String(state.currentGroup?.id)) return;
      await createPeerConnection(peer.socketId, peer.userId, peer.displayName, false);
      renderParticipants();
    });

    socket.on('group-call:signal', async ({ groupId, from, payload }) => {
      if (!state.call.joined || String(groupId) !== String(state.currentGroup?.id)) return;
      await handleSignal(from, payload);
    });

    socket.on('group-call:peer-left', ({ groupId, socketId }) => {
      if (String(groupId) !== String(state.currentGroup?.id)) return;
      closePeer(socketId);
      renderParticipants();
      renderVideoGrid();
    });
  }

  async function startCall(mode) {
    ensureGroupSelected();
    state.call.mode = mode;
    await joinCall();
  }

  async function joinCall() {
    ensureGroupSelected();

    if (state.call.joined) return;

    const me = InnovateAPI.getCurrentUser();
    state.call.userId = me?.id;
    state.call.displayName = me?.username || `user-${me?.id || ''}`;

    const wantsVideo = state.call.mode === 'video';
    state.call.localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: wantsVideo
    });

    state.call.joined = true;

    const socket = ensureSocket();
    socket.emit('group-call:join', {
      groupId: state.currentGroup.id,
      userId: state.call.userId,
      displayName: state.call.displayName
    });

    // local tile
    attachLocalVideo();
    renderParticipants();
  }

  function attachLocalVideo() {
    const existing = el.callGrid.querySelector('[data-local="1"]');
    if (existing) existing.remove();

    const tile = document.createElement('div');
    tile.className = 'ws-video';
    tile.dataset.local = '1';

    const v = document.createElement('video');
    v.autoplay = true;
    v.playsInline = true;
    v.muted = true;
    v.srcObject = state.call.localStream;

    const label = document.createElement('div');
    label.className = 'ws-video-label';
    label.textContent = `${state.call.displayName} (You)`;

    tile.appendChild(v);
    tile.appendChild(label);
    el.callGrid.prepend(tile);
  }

  async function createPeerConnection(socketId, userId, displayName, iInitiate) {
    if (state.call.peers.has(socketId)) return;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    // add tracks
    state.call.localStream.getTracks().forEach(t => pc.addTrack(t, state.call.localStream));

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      ensureSocket().emit('group-call:signal', {
        groupId: state.currentGroup.id,
        to: socketId,
        payload: { type: 'ice', candidate: event.candidate }
      });
    };

    const remoteStream = new MediaStream();
    pc.ontrack = (event) => {
      event.streams[0].getTracks().forEach(t => remoteStream.addTrack(t));
      renderVideoGrid();
    };

    state.call.peers.set(socketId, { pc, userId, displayName, stream: remoteStream });

    if (iInitiate) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      ensureSocket().emit('group-call:signal', {
        groupId: state.currentGroup.id,
        to: socketId,
        payload: { type: 'offer', sdp: offer }
      });
    }
  }

  async function handleSignal(fromSocketId, payload) {
    if (!payload || !payload.type) return;

    let entry = state.call.peers.get(fromSocketId);
    if (!entry) {
      // unknown peer, create pc in responder mode
      await createPeerConnection(fromSocketId, null, 'Participant', false);
      entry = state.call.peers.get(fromSocketId);
    }

    const pc = entry.pc;

    if (payload.type === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ensureSocket().emit('group-call:signal', {
        groupId: state.currentGroup.id,
        to: fromSocketId,
        payload: { type: 'answer', sdp: answer }
      });
      return;
    }

    if (payload.type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      return;
    }

    if (payload.type === 'ice' && payload.candidate) {
      try {
        await pc.addIceCandidate(payload.candidate);
      } catch {
        // ignore
      }
    }
  }

  function closePeer(socketId) {
    const entry = state.call.peers.get(socketId);
    if (!entry) return;
    try { entry.pc.close(); } catch {}
    state.call.peers.delete(socketId);
  }

  async function leaveCall() {
    if (!state.call.joined) return;

    ensureSocket().emit('group-call:leave', { groupId: state.currentGroup.id });

    state.call.peers.forEach((_, sid) => closePeer(sid));

    if (state.call.screenStream) {
      state.call.screenStream.getTracks().forEach(t => t.stop());
      state.call.screenStream = null;
    }

    if (state.call.localStream) {
      state.call.localStream.getTracks().forEach(t => t.stop());
      state.call.localStream = null;
    }

    state.call.joined = false;
    state.call.muted = false;
    state.call.cameraOff = false;
    state.call.screenSharing = false;

    el.callGrid.innerHTML = '';
    renderParticipants();
  }

  function renderParticipants() {
    const names = [];
    if (state.call.joined) names.push(`${state.call.displayName} (You)`);
    state.call.peers.forEach(p => names.push(p.displayName || 'Participant'));
    el.callParticipants.textContent = names.length ? names.join(' • ') : 'Not in a call';

    el.callJoin.style.display = state.call.joined ? 'none' : 'inline-flex';
    el.callLeave.style.display = state.call.joined ? 'inline-flex' : 'none';
    el.callMute.disabled = !state.call.joined;
    el.callCamera.disabled = !state.call.joined;
    el.callScreen.disabled = !state.call.joined;
  }

  function renderVideoGrid() {
    // keep local tile, rebuild remote tiles
    const localTile = el.callGrid.querySelector('[data-local="1"]');
    const local = localTile ? localTile.outerHTML : null;

    el.callGrid.innerHTML = '';
    if (local) {
      el.callGrid.insertAdjacentHTML('beforeend', local);
      const v = el.callGrid.querySelector('[data-local="1"] video');
      if (v) v.srcObject = state.call.localStream;
    }

    state.call.peers.forEach((p) => {
      const tile = document.createElement('div');
      tile.className = 'ws-video';

      const v = document.createElement('video');
      v.autoplay = true;
      v.playsInline = true;
      v.srcObject = p.stream;

      const label = document.createElement('div');
      label.className = 'ws-video-label';
      label.textContent = p.displayName || 'Participant';

      tile.appendChild(v);
      tile.appendChild(label);
      el.callGrid.appendChild(tile);
    });
  }

  function toggleMute() {
    if (!state.call.localStream) return;
    state.call.muted = !state.call.muted;
    state.call.localStream.getAudioTracks().forEach(t => (t.enabled = !state.call.muted));
    el.callMute.textContent = state.call.muted ? 'Unmute' : 'Mute';
  }

  function toggleCamera() {
    if (!state.call.localStream) return;
    state.call.cameraOff = !state.call.cameraOff;
    state.call.localStream.getVideoTracks().forEach(t => (t.enabled = !state.call.cameraOff));
    el.callCamera.textContent = state.call.cameraOff ? 'Camera on' : 'Camera off';
  }

  async function toggleScreenShare() {
    if (!state.call.joined) return;

    if (!state.call.screenSharing) {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      state.call.screenStream = screen;
      state.call.screenSharing = true;
      el.callScreen.textContent = 'Stop share';

      const screenTrack = screen.getVideoTracks()[0];
      const senderReplace = (pc) => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) sender.replaceTrack(screenTrack);
      };

      state.call.peers.forEach(p => senderReplace(p.pc));
      // local preview uses screen
      const localVideo = el.callGrid.querySelector('[data-local="1"] video');
      if (localVideo) localVideo.srcObject = screen;

      screenTrack.onended = () => {
        if (state.call.screenSharing) toggleScreenShare().catch(() => {});
      };

      return;
    }

    // stop share and revert
    state.call.screenSharing = false;
    el.callScreen.textContent = 'Share screen';

    if (state.call.screenStream) {
      state.call.screenStream.getTracks().forEach(t => t.stop());
      state.call.screenStream = null;
    }

    const camTrack = state.call.localStream.getVideoTracks()[0];
    if (camTrack) {
      state.call.peers.forEach(p => {
        const sender = p.pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) sender.replaceTrack(camTrack);
      });
    }

    const localVideo = el.callGrid.querySelector('[data-local="1"] video');
    if (localVideo) localVideo.srcObject = state.call.localStream;
  }

  async function refreshAllForGroup() {
    await Promise.all([
      loadGroupChat(),
      loadGroupTasks(),
      loadNotes(),
      loadMembers(),
      loadAnnouncements(),
      loadFilesAndLinks('')
    ]);
    renderRightPanel();
    renderChat();

    // Realtime updates for group chat
    const sock = InnovateAPI.getSocket();
    if (sock && state.currentGroup?.id) {
      sock.emit('community-group:join', state.currentGroup.id);
      sock.off('community-group:post:new');
      sock.on('community-group:post:new', (post) => {
        if (!post || String(post.group_id) !== String(state.currentGroup.id)) return;
        state.chat = [post, ...(state.chat || [])];
        renderChat();
      });
    }
  }

  function bind() {
    InnovateAPI.requireAuth();

    // Start with a disabled workspace until a group is selected.
    setGroupSelectedUI(!!state.currentGroup);

    el.sidebarToggle.addEventListener('click', () => {
      el.sidebar.classList.toggle('open');
    });

    el.themeToggle.addEventListener('click', () => {
      const next = igTheme.toggle();
      el.themeToggle.textContent = next === 'dark' ? 'Light' : 'Dark';
    });

    el.leaveBtn.addEventListener('click', () => {
      if (confirm('Leave this community?')) leaveCommunity().catch(e => InnovateAPI.showAlert(e.message, 'error'));
    });

    el.createGroupBtn.addEventListener('click', () => {
      createGroup().catch(e => InnovateAPI.showAlert(e.message, 'error'));
    });

    // Announcements
    if (el.createAnnouncement) {
      el.createAnnouncement.addEventListener('click', () => {
        createAnnouncement().catch(e => InnovateAPI.showAlert(e.message, 'error'));
      });
    }

    el.tabs.forEach(b => b.addEventListener('click', () => setActiveView(b.dataset.wsTab)));
    el.rightTabs.forEach(b => b.addEventListener('click', async () => {
      setRightTab(b.dataset.wsRight);
      if (b.dataset.wsRight === 'members') {
        await loadMembers();
        renderRightPanel();
      }
      if (b.dataset.wsRight === 'files') {
        await loadFilesAndLinks('');
        renderRightPanel();
      }
      if (b.dataset.wsRight === 'announcements') {
        await loadAnnouncements();
        renderRightPanel();
      }
    }));

    el.chatSendBtn.addEventListener('click', () => sendChat(null).catch(e => InnovateAPI.showAlert(e.message, 'error')));
    el.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChat(null).catch(err => InnovateAPI.showAlert(err.message, 'error'));
      }
    });
    el.chatLocBtn.addEventListener('click', () => promptAndSendLocation());

    el.todoCreateFromText.addEventListener('click', () => createTasksFromText().catch(e => InnovateAPI.showAlert(e.message, 'error')));
    el.todoCreateFromImage.addEventListener('click', () => createTasksFromImage().catch(e => InnovateAPI.showAlert(e.message, 'error')));

    el.noteNewBtn.addEventListener('click', () => newNote().catch(e => InnovateAPI.showAlert(e.message, 'error')));
    el.noteSaveBtn.addEventListener('click', () => saveNote().catch(e => InnovateAPI.showAlert(e.message, 'error')));
    el.noteVersionsBtn.addEventListener('click', () => showVersions().catch(e => InnovateAPI.showAlert(e.message, 'error')));

    el.callStartVoice.addEventListener('click', () => startCall('voice').catch(e => InnovateAPI.showAlert(e.message, 'error')));
    el.callStartVideo.addEventListener('click', () => startCall('video').catch(e => InnovateAPI.showAlert(e.message, 'error')));
    el.callJoin.addEventListener('click', () => joinCall().catch(e => InnovateAPI.showAlert(e.message, 'error')));
    el.callLeave.addEventListener('click', () => leaveCall().catch(e => InnovateAPI.showAlert(e.message, 'error')));
    el.callMute.addEventListener('click', () => toggleMute());
    el.callCamera.addEventListener('click', () => toggleCamera());
    el.callScreen.addEventListener('click', () => toggleScreenShare().catch(e => InnovateAPI.showAlert(e.message, 'error')));

    // initial theme label
    el.themeToggle.textContent = igTheme.getTheme() === 'dark' ? 'Light' : 'Dark';

    setActiveView('announcements'); // Start with announcements
    setRightTab('files');
    renderParticipants();
  } // End bind()

  async function init() {
    bind();
    await Promise.all([loadCommunity(), loadGroups(), loadAnnouncements()]);
    renderRightPanel();
  }

  init().catch(err => {
    console.error(err);
    InnovateAPI.showAlert(err.message || 'Failed to load workspace', 'error');
  });
})();

