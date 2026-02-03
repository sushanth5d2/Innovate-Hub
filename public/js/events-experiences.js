(function () {
  const { apiRequest, requireAuth, getCurrentUser, showAlert, formatTimestamp } = window.InnovateAPI || {};

  if (!requireAuth || !apiRequest) {
    // Fallback if app.js not loaded
    if (!localStorage.getItem('token')) {
      window.location.href = '/login';
    }
  }

  const state = {
    tab: 'discover',
    city: localStorage.getItem('exp-city') || 'Hyderabad',
    query: '',
    discoverEvents: [],
    myEvents: [],
    activeEvent: null,
    activeTicketsEventId: null,
    activeOrdersEventId: null,
    activeManageEventId: null
  };

  function tokenHeaders() {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  function formatMoney(cents, currency) {
    const amount = (Number(cents) || 0) / 100;
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency || 'INR'
    }).format(amount);
  }

  function formatPriceRange(minCents, maxCents, currency) {
    if (minCents === null || minCents === undefined) return 'Price TBA';
    if (Number(minCents) === 0 && Number(maxCents || 0) === 0) return 'Free';
    if (Number(minCents) === Number(maxCents)) return formatMoney(minCents, currency);
    return `${formatMoney(minCents, currency)} – ${formatMoney(maxCents, currency)}`;
  }

  function shortDateLabel(dateString) {
    if (!dateString) return '';
    const d = new Date(normalizeSqliteDate(dateString));
    return d.toLocaleDateString('en-IN', { month: 'short', day: '2-digit' });
  }

  function normalizeSqliteDate(dateString) {
    if (!dateString) return dateString;
    let s = String(dateString);
    if (s.includes(' ') && !s.includes('T') && !s.endsWith('Z')) {
      s = s.replace(' ', 'T') + 'Z';
    }
    return s;
  }

  function countdownParts(dateString) {
    const now = Date.now();
    const target = new Date(normalizeSqliteDate(dateString)).getTime();
    const diff = Math.max(0, target - now);
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    return { days, hours, mins, diff };
  }

  function setTab(tab) {
    state.tab = tab;
    document.querySelectorAll('[data-exp-tab]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-exp-tab') === tab);
    });
    document.querySelectorAll('[data-exp-panel]').forEach((p) => {
      p.style.display = p.getAttribute('data-exp-panel') === tab ? '' : 'none';
    });

    if (tab === 'discover') loadDiscover();
    if (tab === 'mine') loadMine();
    if (tab === 'passes') loadPasses();
    if (tab === 'crosspath') loadCrosspath();
    if (tab === 'reminders') loadReminders();
  }

  async function loadDiscover() {
    const grid = document.getElementById('expDiscoverGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="ig-spinner"></div>';

    try {
      const qs = new URLSearchParams();
      if (state.city) qs.set('city', state.city);
      if (state.query) qs.set('q', state.query);

      const res = await fetch(`/api/events/discover?${qs.toString()}`, { headers: tokenHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load events');

      state.discoverEvents = data.events || [];
      renderEventGrid(grid, state.discoverEvents, { showCreatorBadge: true });
      updateHeaderCopy();
    } catch (e) {
      grid.innerHTML = `<div style="color: var(--ig-secondary-text); padding: 20px;">${e.message}</div>`;
    }
  }

  async function loadMine() {
    const grid = document.getElementById('expMyGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="ig-spinner"></div>';

    try {
      const res = await fetch('/api/events', { headers: tokenHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load events');

      state.myEvents = data.events || [];
      renderEventGrid(grid, state.myEvents, { showCreatorBadge: false });
    } catch (e) {
      grid.innerHTML = `<div style="color: var(--ig-secondary-text); padding: 20px;">${e.message}</div>`;
    }
  }

  function placeholderImage(title) {
    const safe = encodeURIComponent(title || 'Event');
    return `https://dummyimage.com/1200x800/111827/ffffff&text=${safe}`;
  }

  function renderEventGrid(container, events, opts) {
    const currentUser = getCurrentUser ? getCurrentUser() : null;

    if (!events.length) {
      container.innerHTML = `<div style="color: var(--ig-secondary-text); padding: 20px;">No events found.</div>`;
      return;
    }

    container.innerHTML = events
      .map((e) => {
        const minP = e.min_price_cents;
        const maxP = e.max_price_cents;
        const currency = e.ticket_currency || e.currency || 'INR';
        const price = formatPriceRange(minP, maxP, currency);
        const img = e.cover_image || placeholderImage(e.title);
        const city = e.city || '';
        const place = [city, e.location].filter(Boolean).join(' · ');
        const interested = Number(e.interested_count ?? e.attendee_count ?? 0);
        const badge = opts?.showCreatorBadge && e.creator_username ? `<span style="color: var(--ig-secondary-text);">@${e.creator_username}</span>` : '';
        const isMine = currentUser?.id && Number(e.creator_id) === Number(currentUser.id);
        const mineChip = isMine ? `<span style="margin-left:auto; color: rgba(0,149,246,0.9); font-weight:800;">Organizer</span>` : '';

        return `
          <div class="exp-card" data-event-id="${e.id}">
            <div class="exp-card-media">
              <img src="${img}" alt="${(e.title || 'Event').replace(/"/g, '&quot;')}" loading="lazy" onerror="this.onerror=null; this.remove();" />
              <div class="exp-date-chip">${shortDateLabel(e.event_date)}</div>
            </div>
            <div class="exp-card-body">
              <div class="exp-card-title">${e.title || 'Untitled event'}</div>
              <div class="exp-card-meta">
                <span>${place || 'Location TBA'}</span>
                <span>•</span>
                <span>${interested}+ interested</span>
                ${badge ? `<span>•</span>${badge}` : ''}
                ${mineChip}
              </div>
              <div class="exp-card-price">${price}</div>
            </div>
          </div>
        `;
      })
      .join('');

    container.querySelectorAll('[data-event-id]').forEach((card) => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-event-id');
        const ev = events.find((x) => String(x.id) === String(id));
        if (ev) openEventDetail(ev);
      });
    });
  }

  function updateHeaderCopy() {
    const title = document.getElementById('expHeaderTitle');
    const subtitle = document.getElementById('expHeaderSubtitle');
    if (!title || !subtitle) return;

    title.textContent = `All Experiences in ${state.city || 'your city'}`;
    subtitle.textContent = 'Parties, concerts & trips in one place';
  }

  function openEventDetail(ev) {
    state.activeEvent = ev;

    const overlay = document.getElementById('eventOverlay');
    const img = document.getElementById('eventDetailImg');
    const title = document.getElementById('eventDetailTitle');
    const place = document.getElementById('eventDetailPlace');
    const price = document.getElementById('eventDetailPrice');
    const desc = document.getElementById('eventDetailDesc');

    const kInterested = document.getElementById('kpiInterested');
    const kCountdown = document.getElementById('kpiCountdown');
    const kPopularity = document.getElementById('kpiPopularity');

    const currentUser = getCurrentUser ? getCurrentUser() : null;
    const isOrganizer = currentUser?.id && Number(ev.creator_id) === Number(currentUser.id);

    const minP = ev.min_price_cents;
    const maxP = ev.max_price_cents;
    const currency = ev.ticket_currency || 'INR';
    const priceText = formatPriceRange(minP, maxP, currency);

    const placeText = [ev.location, ev.city].filter(Boolean).join(' · ');
    const interested = Number(ev.interested_count ?? ev.attendee_count ?? 0);

    if (img) img.src = ev.cover_image || placeholderImage(ev.title);
    if (title) title.textContent = ev.title || 'Untitled event';
    if (place) place.textContent = placeText || 'Location TBA';
    if (price) price.textContent = priceText;
    if (desc) desc.textContent = ev.description || ev.important_note || '';

    if (kInterested) kInterested.textContent = `${interested}+`;

    const parts = countdownParts(ev.event_date);
    if (kCountdown) {
      kCountdown.textContent = parts.diff ? `${parts.days}d ${String(parts.hours).padStart(2, '0')}h ${String(parts.mins).padStart(2, '0')}m` : 'Now';
    }

    // Popularity: normalize within current list (simple)
    const pool = (state.tab === 'mine' ? state.myEvents : state.discoverEvents) || [];
    const maxInterested = Math.max(1, ...pool.map((x) => Number(x.interested_count ?? x.attendee_count ?? 0)));
    const pct = Math.min(99, Math.round((interested / maxInterested) * 100));
    if (kPopularity) kPopularity.textContent = `${pct}%`;

    // Quick look rows
    document.getElementById('qlTime').textContent = formatTimestamp ? formatTimestamp(ev.event_date) : new Date(normalizeSqliteDate(ev.event_date)).toLocaleString();
    document.getElementById('qlCategory').textContent = ev.category || 'General';
    document.getElementById('qlOrganizer').textContent = ev.organizer_name || (ev.creator_username ? `@${ev.creator_username}` : 'Organizer');
    document.getElementById('qlNote').textContent = ev.important_note || '—';

    // Organizer-only actions
    document.getElementById('btnManagePasses').style.display = isOrganizer ? '' : 'none';
    document.getElementById('btnOrders').style.display = isOrganizer ? '' : 'none';
    document.getElementById('btnCheckin').style.display = isOrganizer ? '' : 'none';

    overlay.classList.add('open');
  }

  function closeEventDetail() {
    const overlay = document.getElementById('eventOverlay');
    overlay.classList.remove('open');
    state.activeEvent = null;
  }

  function openFilters() {
    document.getElementById('filtersDrawer').classList.add('open');
    document.getElementById('filtersOverlay').classList.add('open');
  }

  function closeFilters() {
    document.getElementById('filtersDrawer').classList.remove('open');
    document.getElementById('filtersOverlay').classList.remove('open');
  }

  function applyFilters() {
    const city = document.getElementById('filterCity').value;
    state.city = city;
    localStorage.setItem('exp-city', city);

    const q = document.getElementById('searchInput').value.trim();
    state.query = q;

    closeFilters();
    if (state.tab === 'discover') loadDiscover();
  }

  // ===== Passes =====
  async function loadPasses() {
    const list = document.getElementById('passesList');
    if (!list) return;
    list.innerHTML = '<div class="ig-spinner"></div>';

    try {
      const res = await fetch('/api/events/tickets/mine', { headers: tokenHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load passes');

      const tickets = data.tickets || [];
      if (!tickets.length) {
        list.innerHTML = '<div style="color: var(--ig-secondary-text); padding: 14px;">No passes yet. Open an event and select tickets.</div>';
        return;
      }

      list.innerHTML = tickets
        .map((t) => {
          return `
            <div class="exp-section" style="padding: 14px;">
              <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">
                <div>
                  <div style="font-weight:900;">${t.event_title || 'Event'}</div>
                  <div style="color: var(--ig-secondary-text); font-size: 12px; margin-top: 4px;">${t.ticket_type_name || 'Pass'} • ${formatTimestamp ? formatTimestamp(t.event_date) : ''}</div>
                  <div style="color: var(--ig-secondary-text); font-size: 12px; margin-top: 2px;">${t.event_location || ''}</div>
                </div>
                <div style="color: var(--ig-secondary-text); font-size: 12px;">${t.status || 'issued'}</div>
              </div>
              <div style="margin-top: 12px; display:flex; gap: 14px; align-items:center; flex-wrap:wrap;">
                <div id="qr-${t.id}" style="background:#fff; padding: 8px; border-radius: 12px;"></div>
                <div style="color: var(--ig-secondary-text); font-size: 12px;">
                  <div><strong style="color: var(--ig-primary-text);">Code</strong>: ${t.code}</div>
                  <div class="exp-hint">Show this QR/code at entry for check-in.</div>
                </div>
              </div>
            </div>
          `;
        })
        .join('');

      // Generate QR codes
      if (window.QRCode) {
        tickets.forEach((t) => {
          const el = document.getElementById(`qr-${t.id}`);
          if (!el) return;
          el.innerHTML = '';
          // payload can be expanded later
          new window.QRCode(el, {
            text: String(t.code),
            width: 128,
            height: 128
          });
        });
      }
    } catch (e) {
      list.innerHTML = `<div style="color: var(--ig-secondary-text); padding: 14px;">${e.message}</div>`;
    }
  }

  // ===== Crosspath / Reminders (keep basic) =====
  async function loadCrosspath() {
    const list = document.getElementById('crosspathList');
    if (!list) return;
    list.innerHTML = '<div class="ig-spinner"></div>';

    try {
      const res = await fetch('/api/events/crosspath/pending', { headers: tokenHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load requests');

      const reqs = data.requests || [];
      if (!reqs.length) {
        list.innerHTML = '<div style="color: var(--ig-secondary-text); padding: 14px;">No crosspath requests.</div>';
        return;
      }

      list.innerHTML = reqs
        .map((r) => {
          return `
            <div class="exp-section">
              <div style="font-weight:900;">@${r.user_username}</div>
              <div style="color: var(--ig-secondary-text); font-size: 12px; margin-top: 4px;">Event: ${r.event_title || ''}</div>
              <div class="exp-cta">
                <button class="exp-btn primary" data-cp="${r.id}" data-act="accept">Accept</button>
                <button class="exp-btn" data-cp="${r.id}" data-act="reject">Reject</button>
              </div>
            </div>
          `;
        })
        .join('');

      list.querySelectorAll('button[data-cp]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-cp');
          const act = btn.getAttribute('data-act');
          try {
            const res2 = await fetch(`/api/events/crosspath/${id}/${act}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...tokenHeaders() }
            });
            const d2 = await res2.json();
            if (!res2.ok) throw new Error(d2.error || 'Failed');
            showAlert && showAlert('Updated', 'success');
            loadCrosspath();
          } catch (e) {
            showAlert && showAlert(e.message, 'error');
          }
        });
      });
    } catch (e) {
      list.innerHTML = `<div style="color: var(--ig-secondary-text); padding: 14px;">${e.message}</div>`;
    }
  }

  async function loadReminders() {
    const list = document.getElementById('remindersList');
    if (!list) return;
    list.innerHTML = '<div class="ig-spinner"></div>';

    try {
      const res = await fetch('/api/events/reminders', { headers: tokenHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load reminders');

      const reminders = data.reminders || [];
      if (!reminders.length) {
        list.innerHTML = '<div style="color: var(--ig-secondary-text); padding: 14px;">No reminders.</div>';
        return;
      }

      list.innerHTML = reminders
        .map((r) => {
          return `
            <div class="exp-section">
              <div style="font-weight:900;">${new Date(normalizeSqliteDate(r.reminder_date)).toLocaleString()}</div>
              <div style="color: var(--ig-secondary-text); font-size: 12px; margin-top: 4px;">${r.message || r.post_content || ''}</div>
              <div class="exp-cta">
                <button class="exp-btn" data-rem="${r.id}">Delete</button>
              </div>
            </div>
          `;
        })
        .join('');

      list.querySelectorAll('button[data-rem]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-rem');
          try {
            const res2 = await fetch(`/api/events/reminders/${id}`, { method: 'DELETE', headers: tokenHeaders() });
            const d2 = await res2.json();
            if (!res2.ok) throw new Error(d2.error || 'Failed');
            loadReminders();
          } catch (e) {
            showAlert && showAlert(e.message, 'error');
          }
        });
      });
    } catch (e) {
      list.innerHTML = `<div style="color: var(--ig-secondary-text); padding: 14px;">${e.message}</div>`;
    }
  }

  // ===== Tickets modal (reuse endpoints) =====
  async function openTicketsModal() {
    const ev = state.activeEvent;
    if (!ev) return;

    state.activeTicketsEventId = ev.id;

    const modal = document.getElementById('ticketsModal');
    const list = document.getElementById('ticketTypes');
    const title = document.getElementById('ticketsTitle');
    const sub = document.getElementById('ticketsSubtitle');
    const result = document.getElementById('ticketsResult');

    title.textContent = 'Select Tickets';
    sub.textContent = `${ev.title || 'Event'} • ${formatTimestamp ? formatTimestamp(ev.event_date) : ''}`;
    result.innerHTML = '';
    list.innerHTML = '<div class="ig-spinner"></div>';

    modal.style.display = 'flex';

    try {
      const res = await fetch(`/api/events/${ev.id}/tickets/types`, { headers: tokenHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load ticket types');

      const types = data.types || [];
      if (!types.length) {
        list.innerHTML = '<div style="color: var(--ig-secondary-text);">No ticket types configured yet.</div>';
        return;
      }

      list.innerHTML = types
        .map((t) => {
          const price = t.price_cents ? formatMoney(t.price_cents, t.currency) : 'Free';
          const how = String(t.payment_mode || '').toUpperCase();
          const contact = t.contact_text ? `<div class="exp-hint">${t.contact_text}</div>` : '';
          return `
            <label style="display:flex; gap:10px; padding: 12px; border-radius: 14px; border: 1px solid rgba(255,255,255,0.10); background: rgba(255,255,255,0.03); cursor:pointer;">
              <input type="radio" name="ticketType" value="${t.id}" data-price="${t.price_cents || 0}" data-currency="${t.currency || 'INR'}" style="margin-top: 4px;" />
              <div style="flex:1;">
                <div style="display:flex; justify-content:space-between; gap: 10px;">
                  <div style="font-weight:900;">${t.name}</div>
                  <div style="font-weight:900;">${price}</div>
                </div>
                <div style="color: var(--ig-secondary-text); font-size: 12px; margin-top: 4px;">${(t.description || '').trim() || how}</div>
                ${contact}
              </div>
            </label>
          `;
        })
        .join('');

      // select first by default
      const first = list.querySelector('input[name="ticketType"]');
      if (first) first.checked = true;
      updateTicketTotal();
    } catch (e) {
      list.innerHTML = `<div style="color: var(--ig-secondary-text);">${e.message}</div>`;
    }
  }

  function closeTicketsModal() {
    document.getElementById('ticketsModal').style.display = 'none';
  }

  function selectedTicket() {
    const sel = document.querySelector('input[name="ticketType"]:checked');
    if (!sel) return null;
    return {
      id: sel.value,
      priceCents: Number(sel.getAttribute('data-price') || 0),
      currency: sel.getAttribute('data-currency') || 'INR'
    };
  }

  function updateTicketTotal() {
    const qty = Math.max(1, Number(document.getElementById('ticketQty').value || 1));
    const t = selectedTicket();
    const el = document.getElementById('ticketTotal');
    if (!t) {
      el.textContent = '';
      return;
    }
    const total = (t.priceCents || 0) * qty;
    el.textContent = total ? `Total: ${formatMoney(total, t.currency)}` : 'Total: Free';
  }

  async function checkoutTickets() {
    const ev = state.activeEvent;
    if (!ev) return;

    const qty = Math.max(1, Number(document.getElementById('ticketQty').value || 1));
    const t = selectedTicket();
    const result = document.getElementById('ticketsResult');

    if (!t) {
      result.innerHTML = '<div style="color: var(--ig-error);">Select a ticket type.</div>';
      return;
    }

    result.innerHTML = '<div class="ig-spinner" style="margin: 10px auto;"></div>';

    try {
      const res = await fetch(`/api/events/${ev.id}/tickets/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...tokenHeaders() },
        body: JSON.stringify({ ticket_type_id: Number(t.id), quantity: qty })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Checkout failed');

      if (data.tickets?.length) {
        result.innerHTML = `<div style="color: var(--ig-primary-text); font-weight: 800;">Pass issued.</div><div class="exp-hint">Open Passes tab to view QR.</div>`;
      } else {
        result.innerHTML = `<div style="color: var(--ig-primary-text); font-weight: 800;">Order created.</div><div class="exp-hint">Organizer will DM you after confirming payment.</div>`;
      }
    } catch (e) {
      result.innerHTML = `<div style="color: var(--ig-error);">${e.message}</div>`;
    }
  }

  // ===== Organizer: Orders / Manage Passes / Check-in =====
  async function openOrders() {
    const ev = state.activeEvent;
    if (!ev) return;

    state.activeOrdersEventId = ev.id;
    const modal = document.getElementById('ordersModal');
    const list = document.getElementById('ordersList');
    const title = document.getElementById('ordersTitle');
    const subtitle = document.getElementById('ordersSubtitle');

    title.textContent = 'Manage Orders';
    subtitle.textContent = `${ev.title || 'Event'} • Pending payments`;
    list.innerHTML = '<div class="ig-spinner"></div>';

    modal.style.display = 'flex';

    try {
      const res = await fetch(`/api/events/${ev.id}/orders?status=pending`, { headers: tokenHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');

      const orders = data.orders || [];
      if (!orders.length) {
        list.innerHTML = '<div style="color: var(--ig-secondary-text);">No pending orders.</div>';
        return;
      }

      list.innerHTML = orders
        .map((o) => {
          const money = o.total_cents ? formatMoney(o.total_cents, o.currency) : 'Free';
          return `
            <div class="exp-section" style="padding: 14px;">
              <div style="display:flex; justify-content:space-between; gap: 10px;">
                <div>
                  <div style="font-weight: 900;">@${o.buyer_username}</div>
                  <div style="color: var(--ig-secondary-text); font-size: 12px; margin-top: 4px;">${o.ticket_type_name || 'Pass'} • Qty ${o.quantity} • ${money}</div>
                </div>
                <button class="exp-btn primary" data-order="${o.id}">Mark paid & issue</button>
              </div>
            </div>
          `;
        })
        .join('');

      list.querySelectorAll('button[data-order]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const orderId = btn.getAttribute('data-order');
          btn.disabled = true;
          btn.textContent = 'Issuing...';
          try {
            const res2 = await fetch(`/api/events/${ev.id}/orders/${orderId}/mark-paid`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...tokenHeaders() }
            });
            const d2 = await res2.json();
            if (!res2.ok) throw new Error(d2.error || 'Failed');
            btn.textContent = 'Issued';
            loadPasses();
          } catch (e) {
            btn.disabled = false;
            btn.textContent = 'Mark paid & issue';
            showAlert && showAlert(e.message, 'error');
          }
        });
      });
    } catch (e) {
      list.innerHTML = `<div style="color: var(--ig-secondary-text);">${e.message}</div>`;
    }
  }

  function closeOrders() {
    document.getElementById('ordersModal').style.display = 'none';
  }

  async function openManagePasses() {
    const ev = state.activeEvent;
    if (!ev) return;

    state.activeManageEventId = ev.id;

    const modal = document.getElementById('managePassesModal');
    const list = document.getElementById('managePassesList');
    document.getElementById('managePassesTitle').textContent = `Manage Pass Types`; 
    document.getElementById('managePassesSubtitle').textContent = ev.title || '';

    list.innerHTML = '<div class="ig-spinner"></div>';
    modal.style.display = 'flex';

    await refreshManagePassesList();
  }

  async function refreshManagePassesList() {
    const eventId = state.activeManageEventId;
    const list = document.getElementById('managePassesList');
    if (!eventId || !list) return;

    try {
      const res = await fetch(`/api/events/${eventId}/tickets/types/manage`, { headers: tokenHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');

      const types = data.types || [];
      if (!types.length) {
        list.innerHTML = '<div style="color: var(--ig-secondary-text);">No pass types yet. Create one below.</div>';
        return;
      }

      list.innerHTML = types
        .map((t) => {
          const money = t.price_cents ? formatMoney(t.price_cents, t.currency) : 'Free';
          const status = t.is_active ? 'Active' : 'Inactive';
          return `
            <div class="exp-section" style="padding: 14px;">
              <div style="display:flex; justify-content:space-between; gap: 10px;">
                <div style="min-width:0;">
                  <div style="font-weight: 900;">${t.name}</div>
                  <div style="color: var(--ig-secondary-text); font-size: 12px; margin-top: 4px;">${money} • ${String(t.payment_mode || '').toUpperCase()} • ${status}</div>
                </div>
                <div style="display:flex; gap: 8px;">
                  <button class="exp-btn" data-edit="${t.id}">Edit</button>
                  <button class="exp-btn" data-del="${t.id}" ${t.is_active ? '' : 'disabled'}>Deactivate</button>
                </div>
              </div>
            </div>
          `;
        })
        .join('');

      list.querySelectorAll('button[data-del]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const typeId = btn.getAttribute('data-del');
          if (!confirm('Deactivate this pass type?')) return;
          try {
            const res2 = await fetch(`/api/events/${eventId}/tickets/types/${typeId}`, {
              method: 'DELETE',
              headers: tokenHeaders()
            });
            const d2 = await res2.json();
            if (!res2.ok) throw new Error(d2.error || 'Failed');
            refreshManagePassesList();
            loadDiscover();
            loadMine();
          } catch (e) {
            showAlert && showAlert(e.message, 'error');
          }
        });
      });

      list.querySelectorAll('button[data-edit]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const typeId = btn.getAttribute('data-edit');
          const t = types.find((x) => String(x.id) === String(typeId));
          if (!t) return;
          openEditPassType(t);
        });
      });
    } catch (e) {
      list.innerHTML = `<div style="color: var(--ig-secondary-text);">${e.message}</div>`;
    }
  }

  function openEditPassType(t) {
    document.getElementById('editTypeId').value = t.id;
    document.getElementById('editName').value = t.name || '';
    document.getElementById('editDesc').value = t.description || '';
    document.getElementById('editMode').value = t.payment_mode || 'free';
    document.getElementById('editContact').value = t.contact_text || '';
    document.getElementById('editPrice').value = ((Number(t.price_cents) || 0) / 100).toString();
    document.getElementById('editQty').value = t.quantity_total || '';
    document.getElementById('editActive').checked = !!t.is_active;
    document.getElementById('editPassModal').style.display = 'flex';
  }

  function closeManagePasses() {
    document.getElementById('managePassesModal').style.display = 'none';
  }

  async function createPassType() {
    const eventId = state.activeManageEventId;
    if (!eventId) return;

    const name = document.getElementById('newName').value.trim();
    const description = document.getElementById('newDesc').value.trim();
    const mode = document.getElementById('newMode').value;
    const contact = document.getElementById('newContact').value.trim();
    const price = Math.round(Math.max(0, Number(document.getElementById('newPrice').value || 0)) * 100);
    const qtyRaw = document.getElementById('newQty').value;
    const quantity_total = qtyRaw === '' ? null : Number(qtyRaw);

    if (name.length < 2) {
      showAlert && showAlert('Pass name is required', 'error');
      return;
    }

    try {
      const res = await fetch(`/api/events/${eventId}/tickets/types`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...tokenHeaders() },
        body: JSON.stringify({
          name,
          description,
          payment_mode: mode,
          contact_text: contact,
          price_cents: price,
          currency: 'INR',
          quantity_total
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');

      document.getElementById('newName').value = '';
      document.getElementById('newDesc').value = '';
      document.getElementById('newContact').value = '';
      document.getElementById('newPrice').value = '';
      document.getElementById('newQty').value = '';

      refreshManagePassesList();
      loadDiscover();
      loadMine();
      showAlert && showAlert('Pass type created', 'success');
    } catch (e) {
      showAlert && showAlert(e.message, 'error');
    }
  }

  async function saveEditPassType() {
    const eventId = state.activeManageEventId;
    const typeId = document.getElementById('editTypeId').value;

    const payload = {
      name: document.getElementById('editName').value.trim(),
      description: document.getElementById('editDesc').value.trim(),
      payment_mode: document.getElementById('editMode').value,
      contact_text: document.getElementById('editContact').value.trim(),
      price_cents: Math.round(Math.max(0, Number(document.getElementById('editPrice').value || 0)) * 100),
      quantity_total: document.getElementById('editQty').value === '' ? null : Number(document.getElementById('editQty').value),
      is_active: document.getElementById('editActive').checked
    };

    try {
      const res = await fetch(`/api/events/${eventId}/tickets/types/${typeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...tokenHeaders() },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');

      document.getElementById('editPassModal').style.display = 'none';
      refreshManagePassesList();
      loadDiscover();
      loadMine();
    } catch (e) {
      showAlert && showAlert(e.message, 'error');
    }
  }

  function closeEditPass() {
    document.getElementById('editPassModal').style.display = 'none';
  }

  async function checkInCode() {
    const ev = state.activeEvent;
    if (!ev) return;

    const code = document.getElementById('checkinCode').value.trim();
    const out = document.getElementById('checkinResult');
    out.textContent = '';

    if (code.length < 8) {
      out.textContent = 'Enter a valid code';
      return;
    }

    try {
      const res = await fetch(`/api/events/${ev.id}/tickets/check-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...tokenHeaders() },
        body: JSON.stringify({ code })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      out.textContent = 'Checked in';
      out.style.color = 'var(--ig-blue)';
    } catch (e) {
      out.textContent = e.message;
      out.style.color = 'var(--ig-error)';
    }
  }

  function openCheckin() {
    document.getElementById('checkinModal').style.display = 'flex';
    document.getElementById('checkinCode').value = '';
    document.getElementById('checkinResult').textContent = '';
  }

  function closeCheckin() {
    document.getElementById('checkinModal').style.display = 'none';
  }

  // ===== Create Event Modal =====
  function openCreateEvent() {
    document.getElementById('createEventModal').style.display = 'flex';
    document.getElementById('ceCity').value = state.city || '';
    document.getElementById('cePublic').checked = true;
  }

  function closeCreateEvent() {
    document.getElementById('createEventModal').style.display = 'none';
  }

  async function createEvent() {
    const title = document.getElementById('ceTitle').value.trim();
    const event_date = document.getElementById('ceDate').value;
    const location = document.getElementById('ceLocation').value.trim();
    const description = document.getElementById('ceDesc').value.trim();
    const city = document.getElementById('ceCity').value.trim();
    const category = document.getElementById('ceCategory').value.trim();
    const cover_image = document.getElementById('ceCover').value.trim();
    const organizer_name = document.getElementById('ceOrganizer').value.trim();
    const important_note = document.getElementById('ceNote').value.trim();
    const is_public = document.getElementById('cePublic').checked;

    if (!title || !event_date) {
      showAlert && showAlert('Title and date required', 'error');
      return;
    }

    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...tokenHeaders() },
        body: JSON.stringify({
          title,
          description,
          event_date,
          location,
          city,
          category,
          cover_image: cover_image || null,
          organizer_name: organizer_name || null,
          important_note: important_note || null,
          is_public: is_public ? 1 : 0,
          notes: ''
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      closeCreateEvent();
      setTab('mine');
      loadMine();
      showAlert && showAlert('Event created', 'success');
    } catch (e) {
      showAlert && showAlert(e.message, 'error');
    }
  }

  // ===== Wire up =====
  function wire() {
    const cityBtn = document.getElementById('cityBtn');
    const cityLabel = document.getElementById('cityLabel');
    if (cityLabel) cityLabel.textContent = state.city;

    document.getElementById('filtersBtn').addEventListener('click', openFilters);
    document.getElementById('filtersOverlay').addEventListener('click', closeFilters);
    document.getElementById('closeFilters').addEventListener('click', closeFilters);
    document.getElementById('applyFilters').addEventListener('click', applyFilters);

    document.getElementById('searchInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        state.query = e.target.value.trim();
        loadDiscover();
      }
    });

    document.getElementById('cityBtn').addEventListener('click', () => {
      openFilters();
      document.getElementById('filterCity').focus();
    });

    document.getElementById('closeEventOverlay').addEventListener('click', closeEventDetail);
    document.getElementById('eventOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'eventOverlay') closeEventDetail();
    });

    document.getElementById('btnSelectTickets').addEventListener('click', openTicketsModal);
    document.getElementById('btnManagePasses').addEventListener('click', openManagePasses);
    document.getElementById('btnOrders').addEventListener('click', openOrders);
    document.getElementById('btnCheckin').addEventListener('click', openCheckin);

    document.getElementById('closeTickets').addEventListener('click', closeTicketsModal);
    document.getElementById('ticketQty').addEventListener('input', updateTicketTotal);
    document.getElementById('ticketsModal').addEventListener('change', (e) => {
      if (e.target && e.target.name === 'ticketType') updateTicketTotal();
    });
    document.getElementById('btnCheckout').addEventListener('click', checkoutTickets);

    document.getElementById('closeOrders').addEventListener('click', closeOrders);

    document.getElementById('closeManagePasses').addEventListener('click', closeManagePasses);
    document.getElementById('btnCreatePassType').addEventListener('click', createPassType);

    document.getElementById('closeEditPass').addEventListener('click', closeEditPass);
    document.getElementById('saveEditPass').addEventListener('click', saveEditPassType);

    document.getElementById('closeCreateEvent').addEventListener('click', closeCreateEvent);
    document.getElementById('openCreateEvent').addEventListener('click', openCreateEvent);
    document.getElementById('createEventSubmit').addEventListener('click', createEvent);

    document.getElementById('closeCheckin').addEventListener('click', closeCheckin);
    document.getElementById('btnCheckinGo').addEventListener('click', checkInCode);

    // Default filter values
    document.getElementById('filterCity').value = state.city;
    updateHeaderCopy();

    // Tabs
    document.querySelectorAll('[data-exp-tab]').forEach((btn) => {
      btn.addEventListener('click', () => setTab(btn.getAttribute('data-exp-tab')));
    });

    setTab('discover');
  }

  document.addEventListener('DOMContentLoaded', wire);
})();
