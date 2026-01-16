/**
 * Main Group Page Controller
 * Integrates Chat, Calls, To-Do, Notes, and File Management
 */

// Global instances
let groupCallManager = null;
let todoBoard = null;
let notesEditor = null;
let socket = null;
let currentGroupId = null;
let currentCommunityId = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
  if (!InnovateAPI.requireAuth()) return;

  // Get group ID from URL
  const urlParams = new URLSearchParams(window.location.search);
  currentGroupId = urlParams.get('id');
  currentCommunityId = urlParams.get('communityId');

  if (!currentGroupId) {
    InnovateAPI.showAlert('Group ID not provided', 'error');
    window.location.href = '/communities';
    return;
  }

  // Initialize Socket.IO
  socket = InnovateAPI.getSocket();
  
  // Initialize managers
  groupCallManager = new GroupCallManager(currentGroupId, socket);
  todoBoard = new TodoBoard(currentGroupId);
  notesEditor = new NotesEditor(currentGroupId, socket);

  // Load group data
  await loadGroupData();
  
  // Setup event listeners
  setupEventListeners();
  
  // Setup tab switching
  setupTabs();
  
  // Load initial content
  await loadGroupChat();
  await loadGroupMembers();
});

// Load group data
async function loadGroupData() {
  try {
    const response = await InnovateAPI.apiRequest(`/community-groups/${currentGroupId}`);
    const group = response.group;

    document.getElementById('group-name').textContent = group.name;
    document.getElementById('group-description').textContent = group.description || 'No description';
    document.getElementById('member-count').textContent = group.member_count || 0;
    document.getElementById('creator-name').textContent = group.creator_username || 'Unknown';

    // Setup back button
    const backBtn = document.getElementById('back-to-community');
    if (backBtn && currentCommunityId) {
      backBtn.href = `/community.html?id=${currentCommunityId}`;
    }
  } catch (error) {
    console.error('Error loading group:', error);
    InnovateAPI.showAlert('Failed to load group data', 'error');
  }
}

// Setup event listeners
function setupEventListeners() {
  // Voice/Video call buttons
  const videoCallBtn = document.getElementById('start-video-call');
  const audioCallBtn = document.getElementById('start-audio-call');

  if (videoCallBtn) {
    videoCallBtn.addEventListener('click', () => {
      groupCallManager.startCall(false); // video call
    });
  }

  if (audioCallBtn) {
    audioCallBtn.addEventListener('click', () => {
      groupCallManager.startCall(true); // audio-only call
    });
  }

  // Call controls
  const toggleMic = document.getElementById('toggle-mic');
  const toggleCamera = document.getElementById('toggle-camera');
  const shareScreen = document.getElementById('share-screen');
  const endCall = document.getElementById('end-call');

  if (toggleMic) {
    toggleMic.addEventListener('click', () => groupCallManager.toggleMic());
  }

  if (toggleCamera) {
    toggleCamera.addEventListener('click', () => groupCallManager.toggleCamera());
  }

  if (shareScreen) {
    shareScreen.addEventListener('click', () => groupCallManager.shareScreen());
  }

  if (endCall) {
    endCall.addEventListener('click', () => groupCallManager.endCall());
  }

  // To-Do create button
  const createTaskBtn = document.getElementById('create-task-btn');
  if (createTaskBtn) {
    createTaskBtn.addEventListener('click', () => {
      todoBoard.showCreateTaskModal();
    });
  }

  // Notes buttons
  const createNoteBtn = document.getElementById('create-note-btn');
  if (createNoteBtn) {
    createNoteBtn.addEventListener('click', () => {
      notesEditor.createNote();
    });
  }

  const saveNoteBtn = document.getElementById('save-note-btn');
  if (saveNoteBtn) {
    saveNoteBtn.addEventListener('click', () => {
      notesEditor.saveNote();
    });
  }

  const cancelNoteBtn = document.getElementById('cancel-note-btn');
  if (cancelNoteBtn) {
    cancelNoteBtn.addEventListener('click', () => {
      notesEditor.cancelEdit();
    });
  }

  // Chat send button
  const sendBtn = document.getElementById('send-chat-message-btn');
  if (sendBtn) {
    sendBtn.addEventListener('click', sendChatMessage);
  }

  // Enter key to send
  const chatInput = document.getElementById('chat-message-input');
  if (chatInput) {
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });
  }

  // File attachments
  setupFileAttachments();
}

// Setup tab switching
function setupTabs() {
  const tabs = {
    'feed-tab': 'feed-content',
    'todo-tab': 'todo-content',
    'notes-tab': 'notes-content',
    'links-tab': 'links-content',
    'images-tab': 'images-content',
    'documents-tab': 'documents-content',
    'videos-tab': 'videos-content',
    'files-tab': 'files-content',
    'members-tab': 'members-content'
  };

  Object.keys(tabs).forEach(tabId => {
    const tabBtn = document.getElementById(tabId);
    if (tabBtn) {
      tabBtn.addEventListener('click', async () => {
        // Remove active class from all tabs
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        
        // Hide all content
        Object.values(tabs).forEach(contentId => {
          const content = document.getElementById(contentId);
          if (content) content.style.display = 'none';
        });

        // Activate clicked tab
        tabBtn.classList.add('active');
        const contentId = tabs[tabId];
        const content = document.getElementById(contentId);
        if (content) content.style.display = 'block';

        // Load content for specific tabs
        if (tabId === 'todo-tab') {
          await todoBoard.loadTasks();
        } else if (tabId === 'notes-tab') {
          await notesEditor.loadNotes();
        } else if (tabId === 'links-tab') {
          await loadLinks();
        } else if (tabId === 'images-tab') {
          await loadFiles('image');
        } else if (tabId === 'documents-tab') {
          await loadFiles('document');
        } else if (tabId === 'videos-tab') {
          await loadFiles('video');
        } else if (tabId === 'files-tab') {
          await loadFiles('other');
        } else if (tabId === 'members-tab') {
          await loadGroupMembers();
        }
      });
    }
  });
}

// Load group chat messages
async function loadGroupChat() {
  try {
    const response = await InnovateAPI.apiRequest(`/community-groups/${currentGroupId}/posts`);
    const messages = response.posts || [];

    const chatContainer = document.getElementById('group-chat-messages');
    if (!chatContainer) return;

    if (messages.length === 0) {
      chatContainer.innerHTML = `
        <div style="text-align: center; padding: 60px 20px; color: var(--ig-secondary-text);">
          <div style="font-size: 48px; margin-bottom: 16px;">💬</div>
          <p>No messages yet. Start the conversation!</p>
        </div>
      `;
      return;
    }

    chatContainer.innerHTML = messages.map(msg => renderChatMessage(msg)).join('');
    chatContainer.scrollTop = chatContainer.scrollHeight;

    // Join group chat room
    if (socket) {
      socket.emit('group:join', currentGroupId);
      
      // Listen for new messages
      socket.on('group:message:receive', (message) => {
        const newMsg = renderChatMessage(message);
        chatContainer.insertAdjacentHTML('beforeend', newMsg);
        chatContainer.scrollTop = chatContainer.scrollHeight;
      });
    }
  } catch (error) {
    console.error('Error loading chat:', error);
  }
}

// Render a chat message
function renderChatMessage(msg) {
  const currentUser = InnovateAPI.getCurrentUser();
  const isOwn = msg.user_id === currentUser.id;
  const alignClass = isOwn ? 'sent' : 'received';
  
  let attachmentsHTML = '';
  if (msg.attachments) {
    try {
      const attachments = JSON.parse(msg.attachments);
      attachmentsHTML = attachments.map(att => {
        if (att.type === 'image') {
          return `<img src="${att.url}" style="max-width: 200px; border-radius: 8px; margin-top: 8px;">`;
        } else if (att.type === 'location') {
          return `<div style="margin-top: 8px;"><a href="https://www.google.com/maps?q=${att.lat},${att.lng}" target="_blank" style="color: var(--ig-blue);">📍 View Location</a></div>`;
        } else {
          return `<div style="margin-top: 8px;"><a href="${att.url}" target="_blank" style="color: var(--ig-blue);">📎 ${att.name}</a></div>`;
        }
      }).join('');
    } catch (e) {}
  }

  return `
    <div class="ig-message ig-message-${alignClass}" style="max-width: 70%; margin-bottom: 12px; ${isOwn ? 'margin-left: auto;' : ''}">
      ${!isOwn ? `<div style="font-size: 12px; font-weight: 600; margin-bottom: 4px; color: var(--ig-secondary-text);">${msg.username}</div>` : ''}
      ${msg.content ? `<div>${msg.content}</div>` : ''}
      ${attachmentsHTML}
      <div class="ig-message-time" style="font-size: 11px; margin-top: 4px; opacity: 0.7;">
        ${InnovateAPI.formatDate(msg.created_at)}
      </div>
    </div>
  `;
}

// Send chat message
async function sendChatMessage() {
  const input = document.getElementById('chat-message-input');
  const content = input.value.trim();
  
  // Get attachments
  const attachmentPreview = document.getElementById('chat-attachment-preview');
  const attachments = [];
  
  attachmentPreview.querySelectorAll('[data-attachment]').forEach(el => {
    attachments.push(JSON.parse(el.dataset.attachment));
  });

  if (!content && attachments.length === 0) return;

  try {
    const formData = new FormData();
    formData.append('content', content);
    if (attachments.length > 0) {
      formData.append('attachments', JSON.stringify(attachments));
    }

    const response = await fetch(`/api/community-groups/${currentGroupId}/posts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${InnovateAPI.getToken()}`
      },
      body: formData
    });

    if (response.ok) {
      input.value = '';
      attachmentPreview.innerHTML = '';
      
      // Emit to socket for real-time
      if (socket) {
        const result = await response.json();
        socket.emit('group:message', {
          groupId: currentGroupId,
          message: result.post
        });
      }
    }
  } catch (error) {
    console.error('Error sending message:', error);
    InnovateAPI.showAlert('Failed to send message', 'error');
  }
}

// Setup file attachments
function setupFileAttachments() {
  const photoInput = document.getElementById('chat-photo');
  const videoInput = document.getElementById('chat-video');
  const fileInput = document.getElementById('chat-file');
  const audioInput = document.getElementById('chat-audio');
  const locationBtn = document.getElementById('share-location-btn');

  if (photoInput) {
    photoInput.addEventListener('change', (e) => handleFileSelect(e.target.files[0], 'image'));
  }

  if (videoInput) {
    videoInput.addEventListener('change', (e) => handleFileSelect(e.target.files[0], 'video'));
  }

  if (fileInput) {
    fileInput.addEventListener('change', (e) => handleFileSelect(e.target.files[0], 'file'));
  }

  if (audioInput) {
    audioInput.addEventListener('change', (e) => handleFileSelect(e.target.files[0], 'audio'));
  }

  if (locationBtn) {
    locationBtn.addEventListener('click', shareLocation);
  }
}

// Handle file selection
async function handleFileSelect(file, type) {
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await fetch(`/api/community-groups/${currentGroupId}/files`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${InnovateAPI.getToken()}`
      },
      body: formData
    });

    const result = await response.json();
    
    if (result.success) {
      addAttachmentPreview({
        type,
        url: result.file.filepath,
        name: result.file.filename
      });
    }
  } catch (error) {
    console.error('Error uploading file:', error);
    InnovateAPI.showAlert('Failed to upload file', 'error');
  }
}

// Add attachment preview
function addAttachmentPreview(attachment) {
  const preview = document.getElementById('chat-attachment-preview');
  
  const el = document.createElement('div');
  el.dataset.attachment = JSON.stringify(attachment);
  
  if (attachment.type === 'image') {
    el.innerHTML = `
      <img src="${attachment.url}" style="width: 100%; height: 80px; object-fit: cover; border-radius: 4px;">
      <button onclick="this.parentElement.remove()">×</button>
    `;
  } else {
    el.innerHTML = `
      <div style="padding: 12px; text-align: center;">
        <div style="font-size: 24px; margin-bottom: 4px;">📎</div>
        <div style="font-size: 11px; word-break: break-all;">${attachment.name}</div>
      </div>
      <button onclick="this.parentElement.remove()">×</button>
    `;
  }
  
  preview.appendChild(el);
}

// Share location
function shareLocation() {
  if (!navigator.geolocation) {
    InnovateAPI.showAlert('Geolocation not supported', 'error');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      addAttachmentPreview({
        type: 'location',
        lat: position.coords.latitude,
        lng: position.coords.longitude
      });
      InnovateAPI.showAlert('Location added!', 'success');
    },
    (error) => {
      InnovateAPI.showAlert('Failed to get location', 'error');
    }
  );
}

// Load links
async function loadLinks() {
  try {
    const response = await InnovateAPI.apiRequest(`/community-groups/${currentGroupId}/links`);
    const links = response.links || [];

    const linksList = document.getElementById('links-list');
    if (!linksList) return;

    if (links.length === 0) {
      linksList.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--ig-secondary-text);">
          <div style="font-size: 48px; margin-bottom: 16px;">🔗</div>
          <p>No links saved yet</p>
        </div>
      `;
      return;
    }

    linksList.innerHTML = links.map(link => `
      <div style="background: var(--ig-primary-background); border: 1px solid var(--ig-border); border-radius: 8px; padding: 16px; margin-bottom: 12px;">
        <h4 style="margin: 0 0 8px 0;">
          <a href="${link.url}" target="_blank" style="color: var(--ig-blue); text-decoration: none;">${link.title || link.url}</a>
        </h4>
        ${link.description ? `<p style="margin: 0; color: var(--ig-secondary-text); font-size: 14px;">${link.description}</p>` : ''}
        <div style="margin-top: 8px; font-size: 12px; color: var(--ig-secondary-text);">
          Added by ${link.username} · ${InnovateAPI.formatDate(link.created_at)}
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Error loading links:', error);
  }
}

// Load files by type
async function loadFiles(fileType) {
  try {
    const response = await InnovateAPI.apiRequest(`/community-groups/${currentGroupId}/files?type=${fileType}`);
    const files = response.files || [];

    const containerId = fileType === 'image' ? 'images-grid' : 
                        fileType === 'video' ? 'videos-grid' : 
                        fileType === 'document' ? 'documents-list' : 'files-list';
    
    const container = document.getElementById(containerId);
    if (!container) return;

    if (files.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--ig-secondary-text); grid-column: 1/-1;">
          <div style="font-size: 48px; margin-bottom: 16px;">📁</div>
          <p>No ${fileType}s yet</p>
        </div>
      `;
      return;
    }

    if (fileType === 'image') {
      container.innerHTML = files.map(file => `
        <div style="position: relative; border-radius: 8px; overflow: hidden;">
          <img src="${file.filepath}" style="width: 100%; height: 200px; object-fit: cover; cursor: pointer;" onclick="window.open('${file.filepath}', '_blank')">
        </div>
      `).join('');
    } else if (fileType === 'video') {
      container.innerHTML = files.map(file => `
        <video controls style="width: 100%; border-radius: 8px;">
          <source src="${file.filepath}">
        </video>
      `).join('');
    } else {
      container.innerHTML = files.map(file => `
        <div style="background: var(--ig-primary-background); border: 1px solid var(--ig-border); border-radius: 8px; padding: 16px; margin-bottom: 12px; display: flex; align-items: center; gap: 12px;">
          <div style="font-size: 32px;">📄</div>
          <div style="flex: 1;">
            <a href="${file.filepath}" target="_blank" style="color: var(--ig-blue); font-weight: 600; text-decoration: none;">${file.filename}</a>
            <div style="font-size: 12px; color: var(--ig-secondary-text); margin-top: 4px;">
              ${(file.filesize / 1024 / 1024).toFixed(2)} MB · ${InnovateAPI.formatDate(file.created_at)}
            </div>
          </div>
        </div>
      `).join('');
    }
  } catch (error) {
    console.error('Error loading files:', error);
  }
}

// Load group members
async function loadGroupMembers() {
  try {
    const response = await InnovateAPI.apiRequest(`/community-groups/${currentGroupId}/members`);
    const members = response.members || [];

    const membersList = document.getElementById('members-list');
    if (!membersList) return;

    membersList.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 16px;">
        ${members.map(member => `
          <div style="background: var(--ig-primary-background); border: 1px solid var(--ig-border); border-radius: 8px; padding: 16px; display: flex; align-items: center; gap: 12px;">
            <img src="${InnovateAPI.getUserAvatar(member.profile_picture)}" style="width: 48px; height: 48px; border-radius: 50%; object-fit: cover;">
            <div style="flex: 1;">
              <div style="font-weight: 600;">${member.username}</div>
              <div style="font-size: 12px; color: var(--ig-secondary-text);">${member.role}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (error) {
    console.error('Error loading members:', error);
  }
}
