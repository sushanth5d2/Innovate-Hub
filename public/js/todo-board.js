/**
 * AI-Powered To-Do Board Manager
 * Supports task creation from text, images, and voice
 */

class TodoBoard {
  constructor(groupId) {
    this.groupId = groupId;
    this.tasks = [];
    this.columns = [
      { id: 'todo', title: 'To Do', icon: '📋' },
      { id: 'in-progress', title: 'In Progress', icon: '⚡' },
      { id: 'done', title: 'Done', icon: '✅' }
    ];
    this.priorities = {
      low: { color: '#34c759', icon: '🟢' },
      medium: { color: '#ff9500', icon: '🟡' },
      high: { color: '#ff3b30', icon: '🔴' }
    };
  }

  // Render the Kanban board
  renderBoard() {
    const board = document.getElementById('todo-board');
    if (!board) return;

    board.innerHTML = this.columns.map(column => `
      <div class="todo-column" data-status="${column.id}">
        <div class="todo-column-header">
          <h4>${column.icon} ${column.title}</h4>
          <span class="task-count">${this.getTasksByStatus(column.id).length}</span>
        </div>
        <div class="todo-column-content" id="column-${column.id}">
          ${this.renderTasksForColumn(column.id)}
        </div>
      </div>
    `).join('');

    this.setupDragAndDrop();
  }

  // Render tasks for a specific column
  renderTasksForColumn(status) {
    const tasks = this.getTasksByStatus(status);
    
    if (tasks.length === 0) {
      return `<div class="empty-column">No tasks</div>`;
    }

    return tasks.map(task => this.renderTask(task)).join('');
  }

  // Render a single task card
  renderTask(task) {
    const priority = this.priorities[task.priority || 'medium'];
    const assignees = task.assignees ? JSON.parse(task.assignees) : [];
    
    return `
      <div class="task-card" data-task-id="${task.id}" draggable="true">
        <div class="task-header">
          <span class="task-priority" style="color: ${priority.color};">${priority.icon}</span>
          <div class="task-actions">
            <button onclick="todoBoard.editTask(${task.id})" title="Edit">✏️</button>
            <button onclick="todoBoard.deleteTask(${task.id})" title="Delete">🗑️</button>
          </div>
        </div>
        <h5 class="task-title">${this.escapeHtml(task.title)}</h5>
        ${task.description ? `<p class="task-description">${this.escapeHtml(task.description)}</p>` : ''}
        <div class="task-footer">
          ${task.due_date ? `<span class="task-due-date">📅 ${this.formatDate(task.due_date)}</span>` : ''}
          ${assignees.length > 0 ? `<span class="task-assignees">👥 ${assignees.length}</span>` : ''}
          ${task.progress ? `
            <div class="task-progress-bar">
              <div class="task-progress-fill" style="width: ${task.progress}%"></div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  // Get tasks by status
  getTasksByStatus(status) {
    return this.tasks.filter(task => task.status === status);
  }

  // Load tasks from server
  async loadTasks() {
    try {
      const response = await InnovateAPI.apiRequest(`/community-groups/${this.groupId}/tasks`);
      this.tasks = response.tasks || [];
      this.renderBoard();
    } catch (error) {
      console.error('Error loading tasks:', error);
      InnovateAPI.showAlert('Failed to load tasks', 'error');
    }
  }

  // Show create task modal
  showCreateTaskModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 600px;">
        <div class="modal-header">
          <h3>Create Task</h3>
          <button onclick="this.closest('.modal-overlay').remove()">×</button>
        </div>
        <div class="modal-body">
          <div class="create-task-tabs">
            <button class="create-tab-btn active" data-tab="text">✍️ Text</button>
            <button class="create-tab-btn" data-tab="image">📷 Image</button>
            <button class="create-tab-btn" data-tab="voice">🎤 Voice</button>
          </div>

          <!-- Text Input Tab -->
          <div class="create-task-tab active" id="text-task-tab">
            <form id="create-task-form">
              <input type="text" id="task-title" placeholder="Task Title" required style="width: 100%; padding: 12px; border: 1px solid var(--ig-border); border-radius: 8px; margin-bottom: 12px; background: var(--ig-secondary-background); color: var(--ig-primary-text);">
              
              <textarea id="task-description" placeholder="Task Description (AI will analyze and suggest details)" style="width: 100%; padding: 12px; border: 1px solid var(--ig-border); border-radius: 8px; min-height: 100px; margin-bottom: 12px; background: var(--ig-secondary-background); color: var(--ig-primary-text); resize: vertical;"></textarea>
              
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
                <select id="task-priority" style="padding: 12px; border: 1px solid var(--ig-border); border-radius: 8px; background: var(--ig-secondary-background); color: var(--ig-primary-text);">
                  <option value="low">🟢 Low Priority</option>
                  <option value="medium" selected>🟡 Medium Priority</option>
                  <option value="high">🔴 High Priority</option>
                </select>
                
                <input type="date" id="task-due-date" style="padding: 12px; border: 1px solid var(--ig-border); border-radius: 8px; background: var(--ig-secondary-background); color: var(--ig-primary-text);">
              </div>
              
              <button type="submit" class="btn btn-primary" style="width: 100%;">🤖 Create with AI</button>
            </form>
          </div>

          <!-- Image Upload Tab -->
          <div class="create-task-tab" id="image-task-tab" style="display: none;">
            <div style="text-align: center; padding: 40px;">
              <p style="margin-bottom: 20px; color: var(--ig-secondary-text);">Upload a photo of your handwritten or printed plan. AI will extract tasks automatically.</p>
              <label class="btn btn-primary" style="cursor: pointer; display: inline-block;">
                📷 Choose Image
                <input type="file" id="task-image-upload" accept="image/*" style="display: none;">
              </label>
              <div id="image-preview" style="margin-top: 20px;"></div>
              <button id="analyze-image-btn" class="btn btn-primary" style="display: none; margin-top: 20px; width: 100%;">🤖 Analyze with AI</button>
            </div>
          </div>

          <!-- Voice Recording Tab -->
          <div class="create-task-tab" id="voice-task-tab" style="display: none;">
            <div style="text-align: center; padding: 40px;">
              <p style="margin-bottom: 20px; color: var(--ig-secondary-text);">Record a voice message describing your tasks. AI will transcribe and create tasks automatically.</p>
              <button id="start-recording-btn" class="btn btn-primary" style="width: 100%;">🎤 Start Recording</button>
              <button id="stop-recording-btn" class="btn btn-secondary" style="display: none; width: 100%; margin-top: 12px;">⏹️ Stop Recording</button>
              <div id="recording-status" style="margin-top: 20px; color: var(--ig-secondary-text);"></div>
              <button id="analyze-voice-btn" class="btn btn-primary" style="display: none; margin-top: 20px; width: 100%;">🤖 Analyze with AI</button>
            </div>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    this.setupCreateTaskModal();
  }

  // Setup create task modal interactions
  setupCreateTaskModal() {
    // Tab switching
    document.querySelectorAll('.create-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.create-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.create-task-tab').forEach(t => t.style.display = 'none');
        
        e.target.classList.add('active');
        const tabId = e.target.dataset.tab + '-task-tab';
        document.getElementById(tabId).style.display = 'block';
      });
    });

    // Text form submission
    const form = document.getElementById('create-task-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.createTaskFromText();
      });
    }

    // Image upload
    const imageInput = document.getElementById('task-image-upload');
    if (imageInput) {
      imageInput.addEventListener('change', (e) => {
        this.handleImageUpload(e.target.files[0]);
      });
    }

    // Voice recording
    this.setupVoiceRecording();
  }

  // Create task from text with AI analysis
  async createTaskFromText() {
    const title = document.getElementById('task-title').value;
    const description = document.getElementById('task-description').value;
    const priority = document.getElementById('task-priority').value;
    const dueDate = document.getElementById('task-due-date').value;

    if (!title) {
      InnovateAPI.showAlert('Please enter a task title', 'error');
      return;
    }

    try {
      const response = await InnovateAPI.apiRequest(`/community-groups/${this.groupId}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          title,
          description,
          priority,
          due_date: dueDate || null,
          status: 'todo'
        })
      });

      if (response.success) {
        InnovateAPI.showAlert('Task created successfully!', 'success');
        document.querySelector('.modal-overlay').remove();
        await this.loadTasks();
      }
    } catch (error) {
      console.error('Error creating task:', error);
      InnovateAPI.showAlert('Failed to create task', 'error');
    }
  }

  // Handle image upload for task extraction
  async handleImageUpload(file) {
    if (!file) return;

    const preview = document.getElementById('image-preview');
    const analyzeBtn = document.getElementById('analyze-image-btn');
    
    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => {
      preview.innerHTML = `<img src="${e.target.result}" style="max-width: 100%; border-radius: 8px; border: 1px solid var(--ig-border);">`;
      analyzeBtn.style.display = 'block';
    };
    reader.readAsDataURL(file);

    // Store file for analysis
    this.uploadedImage = file;

    // Setup analyze button
    analyzeBtn.onclick = () => this.analyzeImageForTasks();
  }

  // Analyze image using ML service
  async analyzeImageForTasks() {
    if (!this.uploadedImage) return;

    const formData = new FormData();
    formData.append('image', this.uploadedImage);

    try {
      InnovateAPI.showAlert('🤖 AI is analyzing your image...', 'success');
      
      // Call ML service
      const response = await fetch(`/api/ml/tasks/from-image`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${InnovateAPI.getToken()}`
        },
        body: formData
      });

      const result = await response.json();

      if (result.success && result.tasks && result.tasks.length > 0) {
        // Create tasks from AI analysis
        for (const task of result.tasks) {
          await InnovateAPI.apiRequest(`/community-groups/${this.groupId}/tasks`, {
            method: 'POST',
            body: JSON.stringify({
              ...task,
              status: 'todo',
              source_type: 'image'
            })
          });
        }

        InnovateAPI.showAlert(`✅ Created ${result.tasks.length} tasks from image!`, 'success');
        document.querySelector('.modal-overlay').remove();
        await this.loadTasks();
      } else {
        InnovateAPI.showAlert('No tasks found in image. Try manual entry.', 'error');
      }
    } catch (error) {
      console.error('Error analyzing image:', error);
      InnovateAPI.showAlert('Failed to analyze image. ML service may be offline.', 'error');
    }
  }

  // Setup voice recording
  setupVoiceRecording() {
    let mediaRecorder = null;
    let audioChunks = [];

    const startBtn = document.getElementById('start-recording-btn');
    const stopBtn = document.getElementById('stop-recording-btn');
    const status = document.getElementById('recording-status');
    const analyzeBtn = document.getElementById('analyze-voice-btn');

    if (!startBtn || !stopBtn) return;

    startBtn.addEventListener('click', async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = (e) => {
          audioChunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
          const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
          this.recordedAudio = audioBlob;
          analyzeBtn.style.display = 'block';
          status.textContent = 'Recording saved. Click Analyze to extract tasks.';
        };

        mediaRecorder.start();
        startBtn.style.display = 'none';
        stopBtn.style.display = 'block';
        status.textContent = '🔴 Recording... Speak your tasks clearly.';
      } catch (error) {
        InnovateAPI.showAlert('Microphone access denied', 'error');
      }
    });

    stopBtn.addEventListener('click', () => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
        stopBtn.style.display = 'none';
        startBtn.style.display = 'block';
      }
    });

    if (analyzeBtn) {
      analyzeBtn.onclick = () => this.analyzeVoiceForTasks();
    }
  }

  // Analyze voice recording
  async analyzeVoiceForTasks() {
    if (!this.recordedAudio) return;

    const formData = new FormData();
    formData.append('audio', this.recordedAudio, 'recording.webm');

    try {
      InnovateAPI.showAlert('🤖 AI is transcribing your voice...', 'success');
      
      const response = await fetch(`/api/ml/tasks/from-voice`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${InnovateAPI.getToken()}`
        },
        body: formData
      });

      const result = await response.json();

      if (result.success && result.tasks && result.tasks.length > 0) {
        for (const task of result.tasks) {
          await InnovateAPI.apiRequest(`/community-groups/${this.groupId}/tasks`, {
            method: 'POST',
            body: JSON.stringify({
              ...task,
              status: 'todo',
              source_type: 'voice'
            })
          });
        }

        InnovateAPI.showAlert(`✅ Created ${result.tasks.length} tasks from voice!`, 'success');
        document.querySelector('.modal-overlay').remove();
        await this.loadTasks();
      } else {
        InnovateAPI.showAlert('No tasks found. Try manual entry.', 'error');
      }
    } catch (error) {
      console.error('Error analyzing voice:', error);
      InnovateAPI.showAlert('Failed to analyze voice. ML service may be offline.', 'error');
    }
  }

  // Setup drag and drop
  setupDragAndDrop() {
    const cards = document.querySelectorAll('.task-card');
    const columns = document.querySelectorAll('.todo-column-content');

    cards.forEach(card => {
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', card.dataset.taskId);
        card.classList.add('dragging');
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
      });
    });

    columns.forEach(column => {
      column.addEventListener('dragover', (e) => {
        e.preventDefault();
        column.classList.add('drag-over');
      });

      column.addEventListener('dragleave', () => {
        column.classList.remove('drag-over');
      });

      column.addEventListener('drop', async (e) => {
        e.preventDefault();
        column.classList.remove('drag-over');
        
        const taskId = e.dataTransfer.getData('text/plain');
        const newStatus = column.id.replace('column-', '');
        
        await this.updateTaskStatus(taskId, newStatus);
      });
    });
  }

  // Update task status
  async updateTaskStatus(taskId, newStatus) {
    try {
      await InnovateAPI.apiRequest(`/community-groups/${this.groupId}/tasks/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus })
      });

      await this.loadTasks();
      InnovateAPI.showAlert('Task status updated', 'success');
    } catch (error) {
      console.error('Error updating task:', error);
      InnovateAPI.showAlert('Failed to update task', 'error');
    }
  }

  // Edit task
  async editTask(taskId) {
    // Implement edit modal (similar to create)
    InnovateAPI.showAlert('Edit feature coming soon!', 'success');
  }

  // Delete task
  async deleteTask(taskId) {
    if (!confirm('Are you sure you want to delete this task?')) return;

    try {
      await InnovateAPI.apiRequest(`/community-groups/${this.groupId}/tasks/${taskId}`, {
        method: 'DELETE'
      });

      await this.loadTasks();
      InnovateAPI.showAlert('Task deleted', 'success');
    } catch (error) {
      console.error('Error deleting task:', error);
      InnovateAPI.showAlert('Failed to delete task', 'error');
    }
  }

  // Utility functions
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

// CSS for To-Do Board (inject into page)
const todoStyles = document.createElement('style');
todoStyles.textContent = `
  .todo-column {
    background: var(--ig-secondary-background);
    border: 1px solid var(--ig-border);
    border-radius: 8px;
    padding: 16px;
    min-height: 400px;
  }

  .todo-column-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 2px solid var(--ig-border);
  }

  .todo-column-header h4 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  .task-count {
    background: var(--ig-blue);
    color: white;
    padding: 4px 12px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 600;
  }

  .todo-column-content {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 300px;
  }

  .todo-column-content.drag-over {
    background: var(--ig-hover);
    border: 2px dashed var(--ig-blue);
    border-radius: 8px;
  }

  .task-card {
    background: var(--ig-primary-background);
    border: 1px solid var(--ig-border);
    border-radius: 8px;
    padding: 12px;
    cursor: move;
    transition: all 0.2s;
  }

  .task-card:hover {
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    transform: translateY(-2px);
  }

  .task-card.dragging {
    opacity: 0.5;
  }

  .task-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .task-priority {
    font-size: 18px;
  }

  .task-actions {
    display: flex;
    gap: 4px;
  }

  .task-actions button {
    background: none;
    border: none;
    font-size: 14px;
    cursor: pointer;
    padding: 4px;
    opacity: 0.7;
    transition: opacity 0.2s;
  }

  .task-actions button:hover {
    opacity: 1;
  }

  .task-title {
    margin: 0 0 8px 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--ig-primary-text);
  }

  .task-description {
    margin: 0 0 12px 0;
    font-size: 13px;
    color: var(--ig-secondary-text);
    line-height: 1.4;
  }

  .task-footer {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    font-size: 12px;
    color: var(--ig-secondary-text);
  }

  .task-progress-bar {
    flex: 1;
    height: 6px;
    background: var(--ig-border);
    border-radius: 3px;
    overflow: hidden;
  }

  .task-progress-fill {
    height: 100%;
    background: var(--ig-blue);
    transition: width 0.3s;
  }

  .empty-column {
    text-align: center;
    padding: 40px 20px;
    color: var(--ig-secondary-text);
    font-size: 14px;
  }

  .create-task-tabs {
    display: flex;
    gap: 8px;
    margin-bottom: 20px;
    border-bottom: 1px solid var(--ig-border);
  }

  .create-tab-btn {
    flex: 1;
    padding: 12px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--ig-secondary-text);
    cursor: pointer;
    font-weight: 600;
    transition: all 0.2s;
  }

  .create-tab-btn.active {
    color: var(--ig-blue);
    border-bottom-color: var(--ig-blue);
  }

  .create-tab-btn:hover {
    color: var(--ig-primary-text);
  }

  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  }

  .modal-content {
    background: var(--ig-primary-background);
    border-radius: 12px;
    width: 90%;
    max-height: 90vh;
    overflow-y: auto;
  }

  .modal-header {
    padding: 20px;
    border-bottom: 1px solid var(--ig-border);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 20px;
  }

  .modal-header button {
    background: none;
    border: none;
    font-size: 28px;
    cursor: pointer;
    color: var(--ig-secondary-text);
    line-height: 1;
  }

  .modal-body {
    padding: 20px;
  }
`;
document.head.appendChild(todoStyles);

// Export for use in group page
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TodoBoard;
}
