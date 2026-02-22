/**
 * SharedTasksNotes - Unified UI component for Tasks & Notes
 * 
 * Usage:
 *   SharedTasksNotes.init({ contextType: 'user', contextId: userId, container: '#my-container' });
 *   SharedTasksNotes.init({ contextType: 'group', contextId: groupId, container: '#group-container' });
 * 
 * Renders a tabbed Tasks (Kanban) + Notes view using the shared API.
 */
window.SharedTasksNotes = (function () {
  'use strict';

  let config = {
    contextType: 'user',
    contextId: null,
    container: null,
    activeTab: 'tasks', // 'tasks' or 'notes'
    tasks: [],
    notes: [],
    showArchivedNotes: false
  };

  // ==================== TASKS ====================

  async function loadTasks() {
    try {
      const res = await InnovateAPI.apiRequest(
        `/shared/tasks?context_type=${config.contextType}&context_id=${config.contextId}`
      );
      config.tasks = res.tasks || [];
    } catch (e) {
      console.error('SharedTasksNotes: Error loading tasks', e);
      config.tasks = [];
    }
  }

  async function loadNotes() {
    try {
      const ts = Date.now();
      const res = await InnovateAPI.apiRequest(
        `/shared/notes?context_type=${config.contextType}&context_id=${config.contextId}&_t=${ts}`
      );
      config.notes = res.notes || [];
    } catch (e) {
      console.error('SharedTasksNotes: Error loading notes', e);
      config.notes = [];
    }
  }

  // ==================== RENDER TASKS ====================

  function renderTasksView(container) {
    const tasks = config.tasks;
    const tasksByStatus = {
      todo: tasks.filter(t => t.status === 'todo'),
      in_progress: tasks.filter(t => t.status === 'in_progress'),
      done: tasks.filter(t => t.status === 'done')
    };

    container.innerHTML = `
      <div class="stn-toolbar">
        <button class="stn-btn stn-btn-primary" id="stnAddTask">
          <i class="fas fa-plus"></i> Add Task
        </button>
        <button class="stn-btn stn-btn-secondary" id="stnImportImage">
          <i class="fas fa-image"></i> From Image
        </button>
        <button class="stn-btn stn-btn-secondary" id="stnCalendarView">
          <i class="fas fa-calendar"></i> Calendar
        </button>
      </div>

      <div class="stn-kanban">
        <div class="stn-kanban-col" data-status="todo">
          <div class="stn-kanban-header">
            <span class="stn-kanban-icon">📋</span>
            <h3>To Do</h3>
            <span class="stn-kanban-count">${tasksByStatus.todo.length}</span>
          </div>
          <div class="stn-kanban-body" data-drop="todo">
            ${renderKanbanCards(tasksByStatus.todo)}
          </div>
        </div>

        <div class="stn-kanban-col" data-status="in_progress">
          <div class="stn-kanban-header">
            <span class="stn-kanban-icon">⚡</span>
            <h3>In Progress</h3>
            <span class="stn-kanban-count">${tasksByStatus.in_progress.length}</span>
          </div>
          <div class="stn-kanban-body" data-drop="in_progress">
            ${renderKanbanCards(tasksByStatus.in_progress)}
          </div>
        </div>

        <div class="stn-kanban-col" data-status="done">
          <div class="stn-kanban-header">
            <span class="stn-kanban-icon">✅</span>
            <h3>Done</h3>
            <span class="stn-kanban-count">${tasksByStatus.done.length}</span>
          </div>
          <div class="stn-kanban-body" data-drop="done">
            ${renderKanbanCards(tasksByStatus.done)}
          </div>
        </div>
      </div>

      ${tasks.length === 0 ? `
        <div class="stn-empty">
          <div class="stn-empty-icon">✅</div>
          <div class="stn-empty-title">No tasks yet</div>
          <div class="stn-empty-text">Create your first task to get started!</div>
        </div>
      ` : ''}
    `;

    // Wire up events
    container.querySelector('#stnAddTask')?.addEventListener('click', () => openTaskModal());
    container.querySelector('#stnImportImage')?.addEventListener('click', () => importTaskFromImage());
    container.querySelector('#stnCalendarView')?.addEventListener('click', () => showCalendarView(container));

    // Drag & drop
    container.querySelectorAll('.stn-kanban-body').forEach(col => {
      col.addEventListener('dragover', (e) => {
        e.preventDefault();
        col.style.background = 'rgba(0, 149, 246, 0.08)';
      });
      col.addEventListener('dragleave', () => {
        col.style.background = '';
      });
      col.addEventListener('drop', async (e) => {
        e.preventDefault();
        col.style.background = '';
        const taskId = e.dataTransfer.getData('text/plain');
        const newStatus = col.dataset.drop;
        if (taskId && newStatus) {
          await updateTask(taskId, { status: newStatus });
          await refreshView();
          InnovateAPI.showAlert('Task moved', 'success');
        }
      });
    });

    // Task card clicks
    container.querySelectorAll('.stn-task-card').forEach(card => {
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', card.dataset.taskId);
        card.style.opacity = '0.5';
      });
      card.addEventListener('dragend', () => {
        card.style.opacity = '1';
      });
      card.querySelector('.stn-task-edit')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const task = config.tasks.find(t => String(t.id) === String(card.dataset.taskId));
        if (task) openTaskModal(task);
      });
      card.querySelector('.stn-task-delete')?.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteTask(card.dataset.taskId);
      });
      card.addEventListener('click', () => {
        const task = config.tasks.find(t => String(t.id) === String(card.dataset.taskId));
        if (task) openTaskModal(task);
      });
    });
  }

  function renderKanbanCards(tasks) {
    if (tasks.length === 0) {
      return '<div class="stn-kanban-empty">Drop tasks here</div>';
    }
    return tasks.map(task => {
      let subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
      const totalSub = subtasks.length;
      const completedSub = subtasks.filter(s => s.completed).length;

      let dueDateClass = '';
      let dueDateText = '';
      if (task.due_date) {
        const dueDate = new Date(task.due_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        dueDate.setHours(0, 0, 0, 0);
        const diffDays = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));

        if (diffDays < 0) { dueDateClass = 'overdue'; dueDateText = `Overdue by ${Math.abs(diffDays)}d`; }
        else if (diffDays === 0) { dueDateClass = 'due-today'; dueDateText = 'Due today'; }
        else if (diffDays <= 3) { dueDateClass = 'due-soon'; dueDateText = `Due in ${diffDays}d`; }
        else { dueDateText = dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
      }

      return `
        <div class="stn-task-card ${dueDateClass}" draggable="true" data-task-id="${task.id}">
          <div class="stn-task-top">
            <span class="stn-priority stn-priority-${task.priority || 'medium'}">${task.priority || 'medium'}</span>
            <div class="stn-task-actions">
              <button class="stn-task-edit" title="Edit"><i class="fas fa-edit"></i></button>
              <button class="stn-task-delete" title="Delete"><i class="fas fa-trash"></i></button>
            </div>
          </div>
          <div class="stn-task-title">${escHtml(task.title)}</div>
          ${task.description ? `<div class="stn-task-desc">${escHtml(task.description).substring(0, 80)}${task.description.length > 80 ? '...' : ''}</div>` : ''}
          ${totalSub > 0 ? `<div class="stn-task-subtasks"><i class="fas fa-check-circle"></i> ${completedSub}/${totalSub} steps</div>` : ''}
          <div class="stn-task-footer">
            ${task.due_date ? `<span class="stn-due ${dueDateClass}"><i class="fas fa-calendar"></i> ${dueDateText}</span>` : ''}
            ${task.progress ? `<span class="stn-progress-chip">${task.progress}%</span>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  // ==================== TASK MODAL ====================

  function openTaskModal(task = null) {
    const isEdit = !!task;
    let subtasks = Array.isArray(task?.subtasks) ? task.subtasks : [];

    const overlay = document.createElement('div');
    overlay.className = 'stn-modal-overlay';
    overlay.innerHTML = `
      <div class="stn-modal">
        <div class="stn-modal-header">
          <h3>${isEdit ? 'Edit Task' : 'Create Task'}</h3>
          <button class="stn-modal-close">&times;</button>
        </div>
        <div class="stn-modal-body">
          <form id="stnTaskForm">
            <div class="stn-form-group">
              <label>Title *</label>
              <input type="text" id="stnTaskTitle" placeholder="Enter task title" value="${escAttr(task?.title || '')}" required>
            </div>
            <div class="stn-form-group">
              <label>Description</label>
              <textarea id="stnTaskDesc" placeholder="Add details">${escHtml(task?.description || '')}</textarea>
            </div>
            <div class="stn-form-row">
              <div class="stn-form-group">
                <label>Due Date</label>
                <input type="date" id="stnTaskDue" value="${task?.due_date ? String(task.due_date).split('T')[0] : ''}">
              </div>
              <div class="stn-form-group">
                <label>Priority</label>
                <select id="stnTaskPriority">
                  <option value="low" ${task?.priority === 'low' ? 'selected' : ''}>Low</option>
                  <option value="medium" ${task?.priority === 'medium' || !task ? 'selected' : ''}>Medium</option>
                  <option value="high" ${task?.priority === 'high' ? 'selected' : ''}>High</option>
                </select>
              </div>
            </div>
            <div class="stn-form-group">
              <label>Subtasks (Steps)</label>
              <div id="stnSubtasksList">
                ${subtasks.map((st, i) => subtaskItemHtml(st, i)).join('')}
              </div>
              <button type="button" class="stn-btn stn-btn-text" id="stnAddSubtask">+ Add Step</button>
            </div>
            <div class="stn-form-group">
              <label>Progress</label>
              <div class="stn-progress-display">
                <span id="stnProgressPct">0%</span>
                <span id="stnProgressLabel">0 of 0 steps</span>
              </div>
            </div>
          </form>
        </div>
        <div class="stn-modal-footer">
          <button class="stn-btn stn-btn-secondary stn-modal-cancel">Cancel</button>
          <button class="stn-btn stn-btn-primary" id="stnSaveTask">${isEdit ? 'Update' : 'Create'} Task</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    recalcProgress();

    overlay.querySelector('.stn-modal-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.stn-modal-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#stnAddSubtask').addEventListener('click', () => {
      const list = overlay.querySelector('#stnSubtasksList');
      const count = list.querySelectorAll('.stn-subtask-item').length + 1;
      list.insertAdjacentHTML('beforeend', subtaskItemHtml({ text: '', completed: false }, count - 1));
      wireSubtaskEvents(overlay);
      recalcProgress();
    });

    wireSubtaskEvents(overlay);

    overlay.querySelector('#stnSaveTask').addEventListener('click', async () => {
      const title = overlay.querySelector('#stnTaskTitle').value.trim();
      if (!title) { InnovateAPI.showAlert('Title required', 'error'); return; }

      const description = overlay.querySelector('#stnTaskDesc').value.trim();
      const dueDate = overlay.querySelector('#stnTaskDue').value;
      const priority = overlay.querySelector('#stnTaskPriority').value;
      const subtaskEls = overlay.querySelectorAll('.stn-subtask-item');
      const subtasksArr = Array.from(subtaskEls).map(el => ({
        text: el.querySelector('input[type="text"]').value.trim(),
        completed: el.querySelector('input[type="checkbox"]').checked
      })).filter(s => s.text);
      const total = subtasksArr.length;
      const completed = subtasksArr.filter(s => s.completed).length;
      const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

      try {
        if (isEdit) {
          await updateTask(task.id, { title, description, due_date: dueDate || null, priority, subtasks: subtasksArr, progress });
          InnovateAPI.showAlert('Task updated!', 'success');
        } else {
          await InnovateAPI.apiRequest('/shared/tasks/from-text', {
            method: 'POST',
            body: JSON.stringify({
              context_type: config.contextType,
              context_id: config.contextId,
              text: title,
              description,
              due_date: dueDate || null,
              priority,
              subtasks: JSON.stringify(subtasksArr),
              progress
            })
          });
          InnovateAPI.showAlert('Task created!', 'success');
        }
        overlay.remove();
        await refreshView();
      } catch (e) {
        InnovateAPI.showAlert('Failed to save task', 'error');
      }
    });

    function recalcProgress() {
      const items = overlay.querySelectorAll('.stn-subtask-item');
      const total = items.length;
      const done = Array.from(items).filter(el => el.querySelector('input[type="checkbox"]').checked).length;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      const pctEl = overlay.querySelector('#stnProgressPct');
      const lblEl = overlay.querySelector('#stnProgressLabel');
      if (pctEl) pctEl.textContent = pct + '%';
      if (lblEl) lblEl.textContent = `${done} of ${total} steps`;
    }

    function wireSubtaskEvents(root) {
      root.querySelectorAll('.stn-subtask-remove').forEach(btn => {
        btn.onclick = () => { btn.closest('.stn-subtask-item').remove(); recalcProgress(); };
      });
      root.querySelectorAll('.stn-subtask-item input[type="checkbox"]').forEach(cb => {
        cb.onchange = () => recalcProgress();
      });
    }
  }

  function subtaskItemHtml(st, idx) {
    return `
      <div class="stn-subtask-item">
        <input type="checkbox" ${st.completed ? 'checked' : ''}>
        <input type="text" value="${escAttr(st.text || '')}" placeholder="Step ${idx + 1}">
        <button type="button" class="stn-subtask-remove">&times;</button>
      </div>
    `;
  }

  async function updateTask(taskId, data) {
    await InnovateAPI.apiRequest(`/shared/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  }

  async function deleteTask(taskId) {
    if (!confirm('Delete this task? This cannot be undone.')) return;
    try {
      await InnovateAPI.apiRequest(`/shared/tasks/${taskId}`, { method: 'DELETE' });
      InnovateAPI.showAlert('Task deleted', 'success');
      await refreshView();
    } catch (e) {
      InnovateAPI.showAlert('Failed to delete task', 'error');
    }
  }

  function importTaskFromImage() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append('image', file);
      formData.append('context_type', config.contextType);
      formData.append('context_id', config.contextId);
      try {
        await InnovateAPI.apiRequest('/shared/tasks/from-image', { method: 'POST', body: formData });
        InnovateAPI.showAlert('Tasks extracted from image!', 'success');
        await refreshView();
      } catch (e) {
        InnovateAPI.showAlert(e.message || 'Failed to extract tasks from image', 'error');
      }
    };
    input.click();
  }

  function showCalendarView(container) {
    const tasks = config.tasks.filter(t => t.due_date && t.status !== 'done');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const grouped = { overdue: [], today: [], upcoming: [] };
    tasks.forEach(t => {
      const d = new Date(t.due_date);
      d.setHours(0, 0, 0, 0);
      if (d < today) grouped.overdue.push(t);
      else if (d.getTime() === today.getTime()) grouped.today.push(t);
      else grouped.upcoming.push(t);
    });

    const calHtml = `
      <div class="stn-toolbar">
        <button class="stn-btn stn-btn-secondary" id="stnBackToBoard"><i class="fas fa-th"></i> Board View</button>
      </div>
      <div class="stn-calendar-list">
        ${grouped.overdue.length ? `<div class="stn-cal-section"><h4 style="color:#ed4956;">⏰ Overdue (${grouped.overdue.length})</h4>${calendarTaskCards(grouped.overdue)}</div>` : ''}
        ${grouped.today.length ? `<div class="stn-cal-section"><h4 style="color:#0095f6;">📅 Today (${grouped.today.length})</h4>${calendarTaskCards(grouped.today)}</div>` : ''}
        ${grouped.upcoming.length ? `<div class="stn-cal-section"><h4 style="color:#34c759;">🔜 Upcoming (${grouped.upcoming.length})</h4>${calendarTaskCards(grouped.upcoming)}</div>` : ''}
        ${tasks.length === 0 ? '<div class="stn-empty"><div class="stn-empty-icon">📅</div><div class="stn-empty-title">No tasks with due dates</div></div>' : ''}
      </div>
    `;
    container.innerHTML = calHtml;
    container.querySelector('#stnBackToBoard')?.addEventListener('click', () => renderTasksView(container));
  }

  function calendarTaskCards(tasks) {
    return tasks.map(t => `
      <div class="stn-cal-card" onclick="SharedTasksNotes._editTask(${t.id})">
        <span class="stn-priority stn-priority-${t.priority || 'medium'}">${t.priority || 'medium'}</span>
        <span class="stn-cal-title">${escHtml(t.title)}</span>
        <span class="stn-cal-date">${new Date(t.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
      </div>
    `).join('');
  }

  // ==================== RENDER NOTES ====================

  function renderNotesView(container) {
    const notes = config.notes;
    const activeNotes = config.showArchivedNotes ? notes : notes.filter(n => !n.is_archived);
    const archivedCount = notes.filter(n => n.is_archived).length;

    container.innerHTML = `
      <div class="stn-toolbar">
        <button class="stn-btn stn-btn-primary" id="stnNewNote">
          <i class="fas fa-plus"></i> New Note
        </button>
        <div class="stn-search-wrapper">
          <input type="text" id="stnNoteSearch" placeholder="🔍 Search notes..." class="stn-search-input">
        </div>
        ${archivedCount > 0 ? `
          <button class="stn-btn stn-btn-secondary" id="stnToggleArchived">
            ${config.showArchivedNotes ? '📤 Hide' : '📥 Show'} Archived (${archivedCount})
          </button>
        ` : ''}
      </div>
      ${activeNotes.length === 0 ? `
        <div class="stn-empty">
          <div class="stn-empty-icon">📝</div>
          <div class="stn-empty-title">No notes yet</div>
          <div class="stn-empty-text">Create a note to get started</div>
        </div>
      ` : `
        <div class="stn-notes-grid" id="stnNotesGrid">
          ${activeNotes.map(n => renderNoteCard(n)).join('')}
        </div>
      `}
    `;

    // Wire events
    container.querySelector('#stnNewNote')?.addEventListener('click', () => showCreateNoteModal());
    container.querySelector('#stnToggleArchived')?.addEventListener('click', () => {
      config.showArchivedNotes = !config.showArchivedNotes;
      renderNotesView(container);
    });
    container.querySelector('#stnNoteSearch')?.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase();
      container.querySelectorAll('.stn-note-card').forEach(card => {
        const title = card.dataset.title || '';
        card.style.display = title.includes(term) ? '' : 'none';
      });
    });

    // Note card actions
    container.querySelectorAll('.stn-note-card').forEach(card => {
      const noteId = card.dataset.noteId;
      card.querySelector('.stn-note-open')?.addEventListener('click', (e) => { e.stopPropagation(); openNoteEditor(noteId); });
      card.querySelector('.stn-note-pin')?.addEventListener('click', (e) => { e.stopPropagation(); togglePin(noteId); });
      card.querySelector('.stn-note-lock')?.addEventListener('click', (e) => { e.stopPropagation(); toggleLock(noteId); });
      card.querySelector('.stn-note-dup')?.addEventListener('click', (e) => { e.stopPropagation(); duplicateNote(noteId); });
      card.querySelector('.stn-note-share')?.addEventListener('click', (e) => { e.stopPropagation(); shareNote(noteId); });
      card.querySelector('.stn-note-archive')?.addEventListener('click', (e) => { e.stopPropagation(); toggleArchive(noteId); });
      card.querySelector('.stn-note-del')?.addEventListener('click', (e) => { e.stopPropagation(); deleteNote(noteId); });
      card.addEventListener('click', () => openNoteEditor(noteId));
    });
  }

  function renderNoteCard(note) {
    const isPinned = note.is_pinned === 1 || note.is_pinned === true;
    const isLocked = note.is_locked === 1 || note.is_locked === true;
    const isArchived = note.is_archived === 1 || note.is_archived === true;

    return `
      <div class="stn-note-card ${isPinned ? 'stn-note-pinned' : ''} ${isArchived ? 'stn-note-archived' : ''}" data-note-id="${note.id}" data-title="${escAttr((note.title || '').toLowerCase())}">
        <div class="stn-note-badges">
          ${isPinned ? '<span class="stn-badge-pin" title="Pinned">📌</span>' : ''}
          ${isLocked ? '<span class="stn-badge-lock" title="Locked">🔒</span>' : ''}
          ${isArchived ? '<span class="stn-badge-arch">ARCHIVED</span>' : ''}
        </div>
        <div class="stn-note-title">${escHtml(note.title)}</div>
        <div class="stn-note-meta">${InnovateAPI.formatDate(note.updated_at)} • ${note.updated_by_username || note.created_by_username}</div>
        <div class="stn-note-actions">
          ${!isLocked ? '<button class="stn-note-open" title="Edit">✏️</button>' : ''}
          <button class="stn-note-pin" title="${isPinned ? 'Unpin' : 'Pin'}">${isPinned ? '📌' : '📍'}</button>
          <button class="stn-note-lock" title="${isLocked ? 'Unlock' : 'Lock'}">${isLocked ? '🔓' : '🔒'}</button>
          <button class="stn-note-dup" title="Duplicate">📋</button>
          <button class="stn-note-share" title="Share">🔗</button>
          <button class="stn-note-archive" title="${isArchived ? 'Unarchive' : 'Archive'}">${isArchived ? '📤' : '📥'}</button>
          <button class="stn-note-del" title="Delete" style="color:#ed4956;">🗑️</button>
        </div>
      </div>
    `;
  }

  // ==================== NOTE ACTIONS ====================

  function showCreateNoteModal() {
    const overlay = document.createElement('div');
    overlay.className = 'stn-modal-overlay';
    overlay.innerHTML = `
      <div class="stn-modal">
        <div class="stn-modal-header" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;">
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="font-size:24px;">📝</span>
            <div>
              <h3 style="margin:0;">Create New Note</h3>
              <div style="font-size:13px;opacity:0.9;">Collaborative or personal note</div>
            </div>
          </div>
          <button class="stn-modal-close" style="color:white;">&times;</button>
        </div>
        <form id="stnNoteForm" style="padding:24px;">
          <div class="stn-form-group">
            <label>📌 Note Title *</label>
            <input type="text" id="stnNoteTitle" placeholder="e.g., Meeting Notes, Ideas, Resources" required autofocus>
          </div>
          <div style="display:flex;gap:12px;padding-top:20px;border-top:1px solid var(--ig-border);">
            <button type="submit" class="stn-btn stn-btn-primary" style="flex:1;">Create Note</button>
            <button type="button" class="stn-btn stn-btn-secondary stn-modal-cancel">Cancel</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(overlay);
    overlay.querySelector('.stn-modal-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.stn-modal-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#stnNoteForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = overlay.querySelector('#stnNoteTitle').value.trim();
      if (!title) return;
      try {
        const res = await InnovateAPI.apiRequest('/shared/notes', {
          method: 'POST',
          body: JSON.stringify({ context_type: config.contextType, context_id: config.contextId, title, content_md: '' })
        });
        overlay.remove();
        openNoteEditor(res.note.id);
      } catch (e) {
        InnovateAPI.showAlert('Failed to create note', 'error');
      }
    });
  }

  function openNoteEditor(noteId) {
    window.open(`/shared-note-editor.html?id=${noteId}`, '_blank');
  }

  async function togglePin(noteId) {
    const note = config.notes.find(n => String(n.id) === String(noteId));
    if (!note) return;
    try {
      await InnovateAPI.apiRequest(`/shared/notes/${noteId}/pin`, {
        method: 'PUT',
        body: JSON.stringify({ is_pinned: !note.is_pinned })
      });
      InnovateAPI.showAlert(note.is_pinned ? 'Unpinned' : 'Pinned', 'success');
      await refreshView();
    } catch (e) {
      InnovateAPI.showAlert('Failed', 'error');
    }
  }

  async function toggleLock(noteId) {
    const note = config.notes.find(n => String(n.id) === String(noteId));
    if (!note) return;
    try {
      await InnovateAPI.apiRequest(`/shared/notes/${noteId}/lock`, {
        method: 'PUT',
        body: JSON.stringify({ is_locked: !note.is_locked })
      });
      InnovateAPI.showAlert(note.is_locked ? 'Unlocked' : 'Locked', 'success');
      await refreshView();
    } catch (e) {
      InnovateAPI.showAlert('Failed', 'error');
    }
  }

  async function toggleArchive(noteId) {
    const note = config.notes.find(n => String(n.id) === String(noteId));
    if (!note) return;
    try {
      await InnovateAPI.apiRequest(`/shared/notes/${noteId}/archive`, {
        method: 'PUT',
        body: JSON.stringify({ is_archived: !note.is_archived })
      });
      InnovateAPI.showAlert(note.is_archived ? 'Unarchived' : 'Archived', 'success');
      await refreshView();
    } catch (e) {
      InnovateAPI.showAlert('Failed', 'error');
    }
  }

  async function duplicateNote(noteId) {
    try {
      await InnovateAPI.apiRequest(`/shared/notes/${noteId}/duplicate`, { method: 'POST' });
      InnovateAPI.showAlert('Note duplicated!', 'success');
      await refreshView();
    } catch (e) {
      InnovateAPI.showAlert('Failed', 'error');
    }
  }

  function shareNote(noteId) {
    const url = `${window.location.origin}/shared-note-editor.html?id=${noteId}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => InnovateAPI.showAlert('Link copied!', 'success'));
    } else {
      prompt('Copy this link:', url);
    }
  }

  async function deleteNote(noteId) {
    if (!confirm('Delete this note? This cannot be undone.')) return;
    try {
      await InnovateAPI.apiRequest(`/shared/notes/${noteId}`, { method: 'DELETE' });
      InnovateAPI.showAlert('Note deleted', 'success');
      await refreshView();
    } catch (e) {
      InnovateAPI.showAlert('Failed', 'error');
    }
  }

  // ==================== MAIN RENDER ====================

  function render() {
    const container = typeof config.container === 'string' ? document.querySelector(config.container) : config.container;
    if (!container) { console.error('SharedTasksNotes: container not found'); return; }

    container.innerHTML = `
      <div class="stn-wrapper">
        <div class="stn-tabs">
          <button class="stn-tab ${config.activeTab === 'tasks' ? 'active' : ''}" data-tab="tasks">
            <i class="fas fa-tasks"></i> Tasks
          </button>
          <button class="stn-tab ${config.activeTab === 'notes' ? 'active' : ''}" data-tab="notes">
            <i class="fas fa-sticky-note"></i> Notes
          </button>
        </div>
        <div class="stn-content" id="stnContent"></div>
      </div>
    `;

    container.querySelectorAll('.stn-tab').forEach(btn => {
      btn.addEventListener('click', async () => {
        config.activeTab = btn.dataset.tab;
        container.querySelectorAll('.stn-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === config.activeTab));
        await loadCurrentData();
        renderContent(container.querySelector('#stnContent'));
      });
    });

    renderContent(container.querySelector('#stnContent'));
  }

  function renderContent(contentEl) {
    if (!contentEl) return;
    if (config.activeTab === 'tasks') {
      renderTasksView(contentEl);
    } else {
      renderNotesView(contentEl);
    }
  }

  async function loadCurrentData() {
    if (config.activeTab === 'tasks') {
      await loadTasks();
    } else {
      await loadNotes();
    }
  }

  async function refreshView() {
    await loadCurrentData();
    const container = typeof config.container === 'string' ? document.querySelector(config.container) : config.container;
    if (!container) return;
    const contentEl = container.querySelector('#stnContent');
    if (contentEl) renderContent(contentEl);
  }

  // ==================== UTILITIES ====================

  function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function escAttr(str) {
    return String(str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ==================== PUBLIC API ====================

  return {
    /**
     * Initialize the shared tasks & notes widget.
     * @param {Object} opts - { contextType: 'user'|'group', contextId: number, container: string|Element, activeTab: 'tasks'|'notes' }
     */
    async init(opts) {
      config.contextType = opts.contextType || 'user';
      config.contextId = opts.contextId;
      config.container = opts.container;
      config.activeTab = opts.activeTab || 'tasks';
      config.tasks = [];
      config.notes = [];
      config.showArchivedNotes = false;

      await loadCurrentData();
      render();
    },

    /** Refresh the current view (re-fetch data + re-render) */
    refresh: refreshView,

    /** Switch to a specific tab: 'tasks' or 'notes' */
    async switchTab(tab) {
      config.activeTab = tab;
      await loadCurrentData();
      render();
    },

    /** Expose editTask for calendar card clicks */
    _editTask(taskId) {
      const task = config.tasks.find(t => t.id === taskId);
      if (task) openTaskModal(task);
    }
  };
})();
