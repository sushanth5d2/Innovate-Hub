/**
 * Collaborative Notes Editor with Rich Text & Version History
 * Uses Quill.js for rich text editing with markdown support
 */

class NotesEditor {
  constructor(groupId, socket) {
    this.groupId = groupId;
    this.socket = socket;
    this.notes = [];
    this.currentNote = null;
    this.quill = null;
    this.autoSaveTimer = null;
    
    this.setupSocketListeners();
  }

  // Setup Socket.IO listeners for real-time collaboration
  setupSocketListeners() {
    if (!this.socket) return;

    // Receive remote note updates
    this.socket.on('note:remote-update', (data) => {
      if (data.noteId === this.currentNote?.id && data.userId !== InnovateAPI.getCurrentUser().id) {
        if (this.quill) {
          // Apply remote changes
          this.quill.updateContents(data.delta, 'api');
          this.showCollaboratorIndicator(data.userId, data.username);
        }
      }
    });

    // User started editing
    this.socket.on('note:user-editing', (data) => {
      if (data.noteId === this.currentNote?.id) {
        this.showCollaboratorIndicator(data.userId, data.username);
      }
    });

    // User stopped editing
    this.socket.on('note:user-left', (data) => {
      this.hideCollaboratorIndicator(data.userId);
    });
  }

  // Load all notes for the group
  async loadNotes() {
    try {
      const response = await InnovateAPI.apiRequest(`/community-groups/${this.groupId}/notes`);
      this.notes = response.notes || [];
      this.renderNotesList();
    } catch (error) {
      console.error('Error loading notes:', error);
      InnovateAPI.showAlert('Failed to load notes', 'error');
    }
  }

  // Render notes list
  renderNotesList() {
    const notesList = document.getElementById('notes-list');
    if (!notesList) return;

    if (this.notes.length === 0) {
      notesList.innerHTML = `
        <div style="text-align: center; padding: 60px 20px; color: var(--ig-secondary-text);">
          <div style="font-size: 48px; margin-bottom: 16px;">📝</div>
          <p style="font-size: 16px; margin-bottom: 8px;">No notes yet</p>
          <p style="font-size: 14px;">Create your first note to get started!</p>
        </div>
      `;
      return;
    }

    notesList.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px;">
        ${this.notes.map(note => this.renderNoteCard(note)).join('')}
      </div>
    `;
  }

  // Render a single note card
  renderNoteCard(note) {
    const updatedAt = new Date(note.updated_at);
    const preview = this.getPlainTextPreview(note.content_md || '');
    
    return `
      <div class="note-card" onclick="notesEditor.openNote(${note.id})">
        <div class="note-card-header">
          <h4 class="note-card-title">${this.escapeHtml(note.title)}</h4>
          <div class="note-card-actions" onclick="event.stopPropagation()">
            <button onclick="notesEditor.showVersionHistory(${note.id})" title="Version History">🕒</button>
            <button onclick="notesEditor.deleteNote(${note.id})" title="Delete">🗑️</button>
          </div>
        </div>
        <div class="note-card-preview">${preview}</div>
        <div class="note-card-footer">
          <span>Updated ${InnovateAPI.formatDate(note.updated_at)}</span>
        </div>
      </div>
    `;
  }

  // Create new note
  async createNote() {
    document.getElementById('notes-list').style.display = 'none';
    document.getElementById('notes-editor-container').style.display = 'block';
    document.getElementById('note-title').value = '';
    
    this.currentNote = null;
    this.initializeEditor();
    
    // Set default title
    document.getElementById('note-title').focus();
  }

  // Open existing note
  async openNote(noteId) {
    try {
      const response = await InnovateAPI.apiRequest(`/community-groups/${this.groupId}/notes/${noteId}`);
      this.currentNote = response.note;
      
      document.getElementById('notes-list').style.display = 'none';
      document.getElementById('notes-editor-container').style.display = 'block';
      
      document.getElementById('note-title').value = this.currentNote.title;
      this.initializeEditor(this.currentNote.content_md);
      
      // Notify others that we're editing
      if (this.socket) {
        this.socket.emit('note:join', {
          noteId: this.currentNote.id,
          groupId: this.groupId,
          userId: InnovateAPI.getCurrentUser().id,
          username: InnovateAPI.getCurrentUser().username
        });
      }
    } catch (error) {
      console.error('Error opening note:', error);
      InnovateAPI.showAlert('Failed to open note', 'error');
    }
  }

  // Initialize Quill editor
  initializeEditor(content = '') {
    const editorContainer = document.getElementById('notes-editor');
    
    // Clear existing editor
    if (this.quill) {
      this.quill = null;
    }
    editorContainer.innerHTML = '';

    // Initialize Quill with full toolbar
    this.quill = new Quill('#notes-editor', {
      theme: 'snow',
      placeholder: 'Start writing your note...',
      modules: {
        toolbar: [
          [{ 'header': [1, 2, 3, false] }],
          ['bold', 'italic', 'underline', 'strike'],
          ['blockquote', 'code-block'],
          [{ 'list': 'ordered'}, { 'list': 'bullet' }],
          [{ 'color': [] }, { 'background': [] }],
          ['link', 'image'],
          ['clean']
        ],
        syntax: true
      }
    });

    // Set content if editing existing note
    if (content) {
      try {
        // Try to parse as Delta format
        const delta = JSON.parse(content);
        this.quill.setContents(delta);
      } catch {
        // Fallback to plain text
        this.quill.setText(content);
      }
    }

    // Setup real-time collaboration
    this.quill.on('text-change', (delta, oldDelta, source) => {
      if (source === 'user' && this.currentNote) {
        // Send changes to other collaborators
        if (this.socket) {
          this.socket.emit('note:update', {
            noteId: this.currentNote.id,
            groupId: this.groupId,
            delta: delta,
            userId: InnovateAPI.getCurrentUser().id,
            username: InnovateAPI.getCurrentUser().username
          });
        }
        
        // Auto-save after 2 seconds of inactivity
        this.scheduleAutoSave();
      }
    });
  }

  // Schedule auto-save
  scheduleAutoSave() {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }
    
    this.autoSaveTimer = setTimeout(() => {
      this.saveNote(true); // silent save
    }, 2000);
  }

  // Save note
  async saveNote(silent = false) {
    const title = document.getElementById('note-title').value.trim();
    
    if (!title) {
      if (!silent) {
        InnovateAPI.showAlert('Please enter a note title', 'error');
      }
      return;
    }

    if (!this.quill) {
      if (!silent) {
        InnovateAPI.showAlert('Editor not initialized', 'error');
      }
      return;
    }

    const content = JSON.stringify(this.quill.getContents());

    try {
      if (this.currentNote) {
        // Update existing note
        const response = await InnovateAPI.apiRequest(`/community-groups/${this.groupId}/notes/${this.currentNote.id}`, {
          method: 'PUT',
          body: JSON.stringify({ title, content_md: content })
        });
        
        if (!silent) {
          InnovateAPI.showAlert('Note saved successfully!', 'success');
        }
      } else {
        // Create new note
        const response = await InnovateAPI.apiRequest(`/community-groups/${this.groupId}/notes`, {
          method: 'POST',
          body: JSON.stringify({ title, content_md: content })
        });
        
        if (response.success) {
          this.currentNote = response.note;
          if (!silent) {
            InnovateAPI.showAlert('Note created successfully!', 'success');
          }
        }
      }
    } catch (error) {
      console.error('Error saving note:', error);
      if (!silent) {
        InnovateAPI.showAlert('Failed to save note', 'error');
      }
    }
  }

  // Cancel editing
  cancelEdit() {
    if (this.currentNote && this.socket) {
      this.socket.emit('note:leave', {
        noteId: this.currentNote.id,
        userId: InnovateAPI.getCurrentUser().id
      });
    }
    
    this.currentNote = null;
    document.getElementById('notes-editor-container').style.display = 'none';
    document.getElementById('notes-list').style.display = 'block';
  }

  // Show version history
  async showVersionHistory(noteId) {
    try {
      const response = await InnovateAPI.apiRequest(`/community-groups/${this.groupId}/notes/${noteId}/versions`);
      const versions = response.versions || [];
      
      const modal = document.createElement('div');
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-content" style="max-width: 700px;">
          <div class="modal-header">
            <h3>📜 Version History</h3>
            <button onclick="this.closest('.modal-overlay').remove()">×</button>
          </div>
          <div class="modal-body">
            ${versions.length === 0 ? `
              <p style="text-align: center; padding: 40px; color: var(--ig-secondary-text);">No version history available</p>
            ` : `
              <div style="display: flex; flex-direction: column; gap: 12px;">
                ${versions.map((version, index) => `
                  <div style="padding: 16px; border: 1px solid var(--ig-border); border-radius: 8px; background: var(--ig-secondary-background);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                      <strong>Version ${versions.length - index}</strong>
                      <span style="font-size: 12px; color: var(--ig-secondary-text);">${InnovateAPI.formatTimestamp(version.created_at)}</span>
                    </div>
                    <div style="font-size: 14px; color: var(--ig-secondary-text);">
                      Edited by ${version.created_by_username || 'Unknown'}
                    </div>
                    <button class="btn btn-secondary" style="margin-top: 8px;" onclick="notesEditor.restoreVersion(${noteId}, ${version.id})">
                      ↩️ Restore This Version
                    </button>
                  </div>
                `).join('')}
              </div>
            `}
          </div>
        </div>
      `;
      
      document.body.appendChild(modal);
    } catch (error) {
      console.error('Error loading version history:', error);
      InnovateAPI.showAlert('Failed to load version history', 'error');
    }
  }

  // Restore a previous version
  async restoreVersion(noteId, versionId) {
    if (!confirm('Are you sure you want to restore this version? Current content will be saved as a new version.')) {
      return;
    }

    try {
      await InnovateAPI.apiRequest(`/community-groups/${this.groupId}/notes/${noteId}/restore/${versionId}`, {
        method: 'POST'
      });

      InnovateAPI.showAlert('Version restored successfully!', 'success');
      document.querySelector('.modal-overlay').remove();
      
      // Reload the note
      this.openNote(noteId);
    } catch (error) {
      console.error('Error restoring version:', error);
      InnovateAPI.showAlert('Failed to restore version', 'error');
    }
  }

  // Delete note
  async deleteNote(noteId) {
    if (!confirm('Are you sure you want to delete this note? This action cannot be undone.')) {
      return;
    }

    try {
      await InnovateAPI.apiRequest(`/community-groups/${this.groupId}/notes/${noteId}`, {
        method: 'DELETE'
      });

      InnovateAPI.showAlert('Note deleted successfully', 'success');
      await this.loadNotes();
    } catch (error) {
      console.error('Error deleting note:', error);
      InnovateAPI.showAlert('Failed to delete note', 'error');
    }
  }

  // Show collaborator indicator
  showCollaboratorIndicator(userId, username) {
    const indicator = document.getElementById(`collaborator-${userId}`);
    if (indicator) return; // Already showing

    const indicators = document.getElementById('collaborator-indicators') || this.createIndicatorsContainer();
    
    const newIndicator = document.createElement('div');
    newIndicator.id = `collaborator-${userId}`;
    newIndicator.className = 'collaborator-indicator';
    newIndicator.textContent = `✏️ ${username} is editing...`;
    
    indicators.appendChild(newIndicator);
  }

  // Hide collaborator indicator
  hideCollaboratorIndicator(userId) {
    const indicator = document.getElementById(`collaborator-${userId}`);
    if (indicator) {
      indicator.remove();
    }
  }

  // Create collaborator indicators container
  createIndicatorsContainer() {
    const container = document.createElement('div');
    container.id = 'collaborator-indicators';
    container.style.cssText = 'position: fixed; top: 80px; right: 20px; display: flex; flex-direction: column; gap: 8px; z-index: 1000;';
    
    document.body.appendChild(container);
    return container;
  }

  // Utility functions
  getPlainTextPreview(content, maxLength = 150) {
    try {
      const delta = JSON.parse(content);
      const text = delta.ops.map(op => typeof op.insert === 'string' ? op.insert : '').join('');
      return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    } catch {
      return content.substring(0, maxLength) + '...';
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// CSS for Notes Editor (inject into page)
const notesStyles = document.createElement('style');
notesStyles.textContent = `
  .note-card {
    background: var(--ig-primary-background);
    border: 1px solid var(--ig-border);
    border-radius: 8px;
    padding: 16px;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    flex-direction: column;
    height: 200px;
  }

  .note-card:hover {
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    transform: translateY(-2px);
  }

  .note-card-header {
    display: flex;
    justify-content: space-between;
    align-items: start;
    margin-bottom: 12px;
  }

  .note-card-title {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--ig-primary-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .note-card-actions {
    display: flex;
    gap: 4px;
  }

  .note-card-actions button {
    background: none;
    border: none;
    font-size: 14px;
    cursor: pointer;
    padding: 4px;
    opacity: 0.7;
    transition: opacity 0.2s;
  }

  .note-card-actions button:hover {
    opacity: 1;
  }

  .note-card-preview {
    flex: 1;
    font-size: 14px;
    color: var(--ig-secondary-text);
    line-height: 1.6;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 5;
    -webkit-box-orient: vertical;
  }

  .note-card-footer {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--ig-border);
    font-size: 12px;
    color: var(--ig-secondary-text);
  }

  #notes-editor {
    min-height: 400px;
    background: var(--ig-primary-background);
    border: 1px solid var(--ig-border);
    border-radius: 8px;
  }

  .ql-toolbar {
    border: 1px solid var(--ig-border) !important;
    border-radius: 8px 8px 0 0 !important;
    background: var(--ig-secondary-background) !important;
  }

  .ql-container {
    border: 1px solid var(--ig-border) !important;
    border-radius: 0 0 8px 8px !important;
    font-size: 14px;
  }

  .ql-editor {
    min-height: 400px;
    color: var(--ig-primary-text);
  }

  .ql-editor.ql-blank::before {
    color: var(--ig-secondary-text);
  }

  [data-theme="dark"] .ql-toolbar {
    filter: invert(1);
  }

  [data-theme="dark"] .ql-editor {
    color: #fafafa;
  }

  .collaborator-indicator {
    background: var(--ig-blue);
    color: white;
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 600;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    animation: slideIn 0.3s ease;
  }

  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
`;
document.head.appendChild(notesStyles);

// Export for use in group page
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NotesEditor;
}
