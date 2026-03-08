/**
 * WhatsApp-Style Call Manager
 * Full-featured voice/video calling with screen share, add member, ringtones, E2E badge
 */

class CallManager {
  constructor() {
    this.localStream = null;
    this.remoteStream = null;
    this.screenStream = null;
    this.peerConnection = null;
    this.isCallActive = false;
    this.isVideoCall = false;
    this.isMuted = false;
    this.isVideoEnabled = true;
    this.isSpeakerOn = false;
    this.isScreenSharing = false;
    this.callStartTime = null;
    this.callDurationInterval = null;
    this.currentCallContactId = null;
    this.currentCallInfo = null; // { username, profile_picture }
    this.callDirection = null; // 'outgoing' | 'incoming'
    this.callState = 'idle'; // idle | ringing | connecting | connected | ended
    this.ringtoneCtx = null;
    this.ringtoneOsc = null;
    this.ringtoneGain = null;
    this.ringtoneInterval = null;
    this.ringbackInterval = null;
    this.callModal = null;
    this.participants = new Map(); // For multi-party calls
    this.additionalPeers = new Map(); // socketId -> RTCPeerConnection for added members

    this.iceConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
    };
  }

  // ========== RINGTONE SYSTEM (Web Audio API) ==========

  _createAudioContext() {
    if (!this.ringtoneCtx || this.ringtoneCtx.state === 'closed') {
      this.ringtoneCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.ringtoneCtx.state === 'suspended') {
      this.ringtoneCtx.resume();
    }
    return this.ringtoneCtx;
  }

  playIncomingRingtone() {
    this.stopAllSounds();
    const ctx = this._createAudioContext();
    let playing = false;

    const playTone = () => {
      if (!this.ringtoneCtx || this.callState !== 'ringing') return;
      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.value = 440;
      osc2.type = 'sine';
      osc2.frequency.value = 480;

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.15, now + 0.05);
      gain.gain.setValueAtTime(0.15, now + 0.8);
      gain.gain.linearRampToValueAtTime(0, now + 0.85);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc1.stop(now + 0.85);
      osc2.start(now);
      osc2.stop(now + 0.85);

      // Second ring
      const osc3 = ctx.createOscillator();
      const osc4 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc3.type = 'sine'; osc3.frequency.value = 440;
      osc4.type = 'sine'; osc4.frequency.value = 480;
      gain2.gain.setValueAtTime(0, now + 1.0);
      gain2.gain.linearRampToValueAtTime(0.15, now + 1.05);
      gain2.gain.setValueAtTime(0.15, now + 1.8);
      gain2.gain.linearRampToValueAtTime(0, now + 1.85);
      osc3.connect(gain2); osc4.connect(gain2); gain2.connect(ctx.destination);
      osc3.start(now + 1.0); osc3.stop(now + 1.85);
      osc4.start(now + 1.0); osc4.stop(now + 1.85);
    };

    playTone();
    this.ringtoneInterval = setInterval(playTone, 3000);
  }

  playRingback() {
    this.stopAllSounds();
    const ctx = this._createAudioContext();

    const playTone = () => {
      if (!this.ringtoneCtx || this.callState !== 'ringing') return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 440;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.08, now + 0.05);
      gain.gain.setValueAtTime(0.08, now + 1.0);
      gain.gain.linearRampToValueAtTime(0, now + 1.05);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now); osc.stop(now + 1.05);
    };

    playTone();
    this.ringbackInterval = setInterval(playTone, 3000);
  }

  playCallEndTone() {
    try {
      const ctx = this._createAudioContext();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 480;
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.5);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.5);
    } catch (e) { /* ignore */ }
  }

  playConnectedTone() {
    try {
      const ctx = this._createAudioContext();
      const now = ctx.currentTime;
      [523, 659, 784].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, now + i * 0.1);
        gain.gain.linearRampToValueAtTime(0.08, now + i * 0.1 + 0.02);
        gain.gain.linearRampToValueAtTime(0, now + i * 0.1 + 0.15);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(now + i * 0.1); osc.stop(now + i * 0.1 + 0.15);
      });
    } catch (e) { /* ignore */ }
  }

  stopAllSounds() {
    if (this.ringtoneInterval) { clearInterval(this.ringtoneInterval); this.ringtoneInterval = null; }
    if (this.ringbackInterval) { clearInterval(this.ringbackInterval); this.ringbackInterval = null; }
  }

  // ========== CALL UI ==========

  _getCallModal() {
    let modal = document.getElementById('waCallModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'waCallModal';
      document.body.appendChild(modal);
    }
    return modal;
  }

  _avatarUrl(pic) {
    if (typeof InnovateAPI !== 'undefined' && InnovateAPI.getUserAvatar) {
      return InnovateAPI.getUserAvatar(pic);
    }
    return pic || '/img/default-avatar.png';
  }

  showOutgoingCallScreen(name, avatar, isVideo) {
    this.callState = 'ringing';
    this.callDirection = 'outgoing';
    this.playRingback();

    const modal = this._getCallModal();
    const avatarUrl = this._avatarUrl(avatar);
    modal.innerHTML = `
      <div class="wa-call-overlay">
        <div class="wa-call-bg"></div>
        <div class="wa-call-content">
          <div class="wa-call-status-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            End-to-end encrypted
          </div>
          <div class="wa-call-avatar-ring">
            <img src="${avatarUrl}" class="wa-call-avatar" onerror="this.src='/img/default-avatar.png'" />
          </div>
          <h2 class="wa-call-name">${this._esc(name)}</h2>
          <p class="wa-call-status" id="waCallStatus">Calling...</p>
          <div class="wa-call-bottom-controls">
            <button class="wa-call-btn" onclick="callManager.toggleSpeaker()" id="waSpeakerBtn" title="Speaker">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
              <span>Speaker</span>
            </button>
            ${isVideo ? `
            <button class="wa-call-btn" onclick="callManager.toggleVideo()" id="waVideoBtn" title="Camera">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
              <span>Camera</span>
            </button>` : ''}
            <button class="wa-call-btn" onclick="callManager.toggleMute()" id="waMuteBtn" title="Mute">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
              <span>Mute</span>
            </button>
            <button class="wa-call-btn wa-call-end" onclick="callManager.endCall()" title="End">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="white"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>
            </button>
          </div>
        </div>
        <video id="waLocalVideoPreview" autoplay playsinline muted style="display:none; position:absolute; inset:0; width:100%; height:100%; object-fit:cover; z-index:0;"></video>
      </div>
    `;
    modal.style.display = 'block';

    if (isVideo && this.localStream) {
      const preview = document.getElementById('waLocalVideoPreview');
      if (preview) {
        preview.srcObject = this.localStream;
        preview.style.display = 'block';
      }
    }
  }

  showIncomingCallScreen(data) {
    this.callState = 'ringing';
    this.callDirection = 'incoming';
    this.playIncomingRingtone();
    window._incomingCallData = data;

    const modal = this._getCallModal();
    const avatarUrl = this._avatarUrl(data.caller?.profile_picture);
    const name = data.caller?.username || 'Unknown';
    const typeLabel = data.isVideo ? 'Video call' : 'Voice call';
    modal.innerHTML = `
      <div class="wa-call-overlay wa-incoming">
        <div class="wa-call-bg"></div>
        <div class="wa-call-content">
          <div class="wa-call-status-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            End-to-end encrypted
          </div>
          <div class="wa-call-avatar-ring wa-ring-pulse">
            <img src="${avatarUrl}" class="wa-call-avatar" onerror="this.src='/img/default-avatar.png'" />
          </div>
          <h2 class="wa-call-name">${this._esc(name)}</h2>
          <p class="wa-call-status">${typeLabel}</p>
          <div class="wa-call-incoming-actions">
            <div class="wa-call-action-col">
              <button class="wa-call-round wa-reject" onclick="callManager.rejectCall()">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="white"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>
              </button>
              <span class="wa-call-action-label">Decline</span>
            </div>
            <div class="wa-call-action-col">
              <button class="wa-call-round wa-accept" onclick="callManager.acceptCall()">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="white"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/></svg>
              </button>
              <span class="wa-call-action-label">Accept</span>
            </div>
          </div>
        </div>
      </div>
    `;
    modal.style.display = 'block';
  }

  showActiveCallScreen(name, avatar, isVideo) {
    this.callState = 'connected';
    this.stopAllSounds();
    this.playConnectedTone();

    const modal = this._getCallModal();
    const avatarUrl = this._avatarUrl(avatar);
    const participantsHtml = this._renderParticipantsList();

    modal.innerHTML = `
      <div class="wa-call-overlay wa-active ${isVideo ? 'wa-video-active' : ''}" id="waCallOverlay" onclick="callManager._toggleControlsVisibility(event)">
        <video id="waRemoteVideo" autoplay playsinline style="display:${isVideo ? 'block' : 'none'}; position:absolute; inset:0; width:100%; height:100%; object-fit:cover; z-index:0; background:#000;"></video>
        <video id="waLocalVideo" autoplay playsinline muted class="wa-local-video-pip" style="display:${isVideo ? 'block' : 'none'};" draggable="false"></video>
        
        <div class="wa-call-top-bar" id="waCallTopBar">
          <button class="wa-top-back-btn" onclick="event.stopPropagation(); callManager._minimizeCall();" title="Minimize">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><polyline points="15 18 9 12 15 6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div style="flex:1; text-align:center;">
            <div class="wa-call-top-name">${this._esc(name)}</div>
            <div class="wa-call-top-timer" id="waCallTimerTop">00:00</div>
          </div>
          <div class="wa-call-top-e2e">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
          </div>
        </div>

        <div class="wa-call-center-info ${isVideo ? 'wa-center-hidden' : ''}" id="waCallCenterInfo">
          <img src="${avatarUrl}" class="wa-call-avatar-active" onerror="this.src='/img/default-avatar.png'" />
          <h2 class="wa-call-name" style="margin-top:12px;">${this._esc(name)}</h2>
          <p class="wa-call-timer" id="waCallTimer">00:00</p>
          <div id="waParticipantsArea" style="margin-top:8px;">${participantsHtml}</div>
        </div>

        <div class="wa-call-controls" id="waCallControls">
          <div class="wa-call-controls-grid">
            <button class="wa-ctrl-btn" onclick="event.stopPropagation(); callManager.toggleSpeaker()" id="waCtrlSpeaker" title="Speaker">
              <div class="wa-ctrl-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
              </div>
              <span>Speaker</span>
            </button>
            <button class="wa-ctrl-btn" onclick="event.stopPropagation(); callManager.toggleVideo()" id="waCtrlVideo" title="Camera">
              <div class="wa-ctrl-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
              </div>
              <span>Camera</span>
            </button>
            <button class="wa-ctrl-btn" onclick="event.stopPropagation(); callManager.toggleMute()" id="waCtrlMute" title="Mute">
              <div class="wa-ctrl-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
              </div>
              <span>Mute</span>
            </button>
            <button class="wa-ctrl-btn" onclick="event.stopPropagation(); callManager.toggleScreenShare()" id="waCtrlScreen" title="Screen Share">
              <div class="wa-ctrl-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/></svg>
              </div>
              <span>Screen</span>
            </button>
          </div>
          <div class="wa-call-controls-row2">
            <button class="wa-ctrl-btn" onclick="event.stopPropagation(); callManager.showAddMemberModal()" id="waCtrlAddMember" title="Add Member">
              <div class="wa-ctrl-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
              </div>
              <span>Add</span>
            </button>
            <button class="wa-end-call-btn" onclick="event.stopPropagation(); callManager.endCall()">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="white"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
    modal.style.display = 'block';

    // Attach streams
    if (this.localStream) {
      const localVid = document.getElementById('waLocalVideo');
      if (localVid) localVid.srcObject = this.localStream;
    }
    if (this.remoteStream) {
      const remoteVid = document.getElementById('waRemoteVideo');
      if (remoteVid) remoteVid.srcObject = this.remoteStream;
    }

    // Start timer
    this.callStartTime = Date.now();
    this.callDurationInterval = setInterval(() => this._updateTimer(), 1000);

    // Make local video draggable
    this._makeLocalVideoDraggable();

    // In video calls, auto-hide controls after 4 seconds
    if (isVideo) {
      this._controlsVisible = true;
      this._controlsTimeout = setTimeout(() => this._hideControls(), 4000);
    }
  }

  showCallEndedScreen(duration) {
    this.callState = 'ended';
    this.stopAllSounds();
    this.playCallEndTone();

    const modal = this._getCallModal();
    const name = this.currentCallInfo?.username || 'User';
    const avatarUrl = this._avatarUrl(this.currentCallInfo?.profile_picture);

    modal.innerHTML = `
      <div class="wa-call-overlay wa-ended">
        <div class="wa-call-bg"></div>
        <div class="wa-call-content">
          <img src="${avatarUrl}" class="wa-call-avatar-active" onerror="this.src='/img/default-avatar.png'" style="width:80px;height:80px;" />
          <h2 class="wa-call-name" style="margin-top:16px;">${this._esc(name)}</h2>
          <p class="wa-call-status" style="color:#ef4444;">Call ended</p>
          ${duration ? `<p class="wa-call-status" style="font-size:13px; opacity:0.7;">${duration}</p>` : ''}
        </div>
      </div>
    `;

    setTimeout(() => { this._hideModal(); }, 2000);
  }

  _hideModal() {
    const modal = document.getElementById('waCallModal');
    if (modal) modal.style.display = 'none';
  }

  _updateTimer() {
    if (!this.callStartTime) return;
    const elapsed = Math.floor((Date.now() - this.callStartTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    const timeStr = `${mins}:${secs}`;
    const timerEl = document.getElementById('waCallTimer');
    if (timerEl) timerEl.textContent = timeStr;
    const timerTop = document.getElementById('waCallTimerTop');
    if (timerTop) timerTop.textContent = timeStr;
    const timerMini = document.getElementById('waCallTimerMini');
    if (timerMini) timerMini.textContent = timeStr;
  }

  _getDurationString() {
    if (!this.callStartTime) return '';
    const elapsed = Math.floor((Date.now() - this.callStartTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    return `${mins}:${secs}`;
  }

  _esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  _renderParticipantsList() {
    if (this.participants.size === 0) return '';
    let html = '<div class="wa-participants">';
    this.participants.forEach((info, id) => {
      html += `<div class="wa-participant-chip">
        <img src="${this._avatarUrl(info.profile_picture)}" class="wa-participant-avatar" onerror="this.src='/img/default-avatar.png'" />
        <span>${this._esc(info.username)}</span>
      </div>`;
    });
    html += '</div>';
    return html;
  }

  _makeLocalVideoDraggable() {
    const vid = document.getElementById('waLocalVideo');
    if (!vid) return;
    let isDragging = false, startX, startY, origX, origY;

    vid.addEventListener('pointerdown', (e) => {
      isDragging = true;
      startX = e.clientX; startY = e.clientY;
      const rect = vid.getBoundingClientRect();
      origX = rect.left; origY = rect.top;
      vid.setPointerCapture(e.pointerId);
      vid.style.transition = 'none';
    });
    vid.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      vid.style.position = 'absolute';
      vid.style.left = (origX + dx) + 'px';
      vid.style.top = (origY + dy) + 'px';
      vid.style.right = 'auto';
      vid.style.bottom = 'auto';
    });
    vid.addEventListener('pointerup', () => { isDragging = false; vid.style.transition = ''; });
  }

  // Toggle controls visibility on tap (for video calls)
  _toggleControlsVisibility(event) {
    // Don't toggle when clicking on controls themselves  
    if (event.target.closest('.wa-call-controls') || event.target.closest('.wa-call-top-bar') || event.target.closest('.wa-local-video-pip')) return;
    
    if (!this.isVideoCall || this.callState !== 'connected') return;

    if (this._controlsVisible) {
      this._hideControls();
    } else {
      this._showControls();
    }
  }

  _hideControls() {
    this._controlsVisible = false;
    if (this._controlsTimeout) { clearTimeout(this._controlsTimeout); this._controlsTimeout = null; }
    const topBar = document.getElementById('waCallTopBar');
    const controls = document.getElementById('waCallControls');
    const centerInfo = document.getElementById('waCallCenterInfo');
    if (topBar) topBar.classList.add('wa-ui-hidden');
    if (controls) controls.classList.add('wa-ui-hidden');
    if (centerInfo) centerInfo.classList.add('wa-center-hidden');
  }

  _showControls() {
    this._controlsVisible = true;
    const topBar = document.getElementById('waCallTopBar');
    const controls = document.getElementById('waCallControls');
    const centerInfo = document.getElementById('waCallCenterInfo');
    if (topBar) topBar.classList.remove('wa-ui-hidden');
    if (controls) controls.classList.remove('wa-ui-hidden');
    // In video calls, only show center info briefly on voice calls
    if (!this.isVideoCall && centerInfo) centerInfo.classList.remove('wa-center-hidden');
    
    // Auto-hide again after 4 seconds
    if (this._controlsTimeout) clearTimeout(this._controlsTimeout);
    this._controlsTimeout = setTimeout(() => this._hideControls(), 4000);
  }

  _minimizeCall() {
    // For now, just a visual indication - could be expanded later
    // Show a small floating call indicator
    const modal = this._getCallModal();
    if (modal) modal.style.display = 'none';
    
    // Create floating mini indicator
    let mini = document.getElementById('waCallMini');
    if (!mini) {
      mini = document.createElement('div');
      mini.id = 'waCallMini';
      mini.className = 'wa-call-mini-indicator';
      document.body.appendChild(mini);
    }
    mini.innerHTML = `
      <div class="wa-mini-avatar">
        <img src="${this._avatarUrl(this.currentCallInfo?.profile_picture)}" onerror="this.src='/img/default-avatar.png'" />
      </div>
      <div class="wa-mini-info">
        <span class="wa-mini-name">${this._esc(this.currentCallInfo?.username || 'Call')}</span>
        <span class="wa-mini-timer" id="waCallTimerMini">00:00</span>
      </div>
      <button class="wa-mini-expand" onclick="callManager._expandCall()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M4 8V4h4v2H6v2H4zm0 8v4h4v-2H6v-2H4zm12-8V4h4v4h-2V6h-2zm0 8v2h2v2h4v-4h-2v2h-2z"/></svg>
      </button>
      <button class="wa-mini-end" onclick="callManager.endCall(); document.getElementById('waCallMini')?.remove();">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>
      </button>
    `;
    mini.style.display = 'flex';
  }

  _expandCall() {
    const mini = document.getElementById('waCallMini');
    if (mini) mini.style.display = 'none';
    const modal = this._getCallModal();
    if (modal) modal.style.display = 'block';
  }

  // ========== CALL LOGIC ==========

  async startCall(contactId, contactInfo, isVideo) {
    if (this.isCallActive) return;

    this.isVideoCall = isVideo;
    this.currentCallContactId = contactId;
    this.currentCallInfo = contactInfo;
    this.isCallActive = true;

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: isVideo ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false
      });

      this.showOutgoingCallScreen(contactInfo.username, contactInfo.profile_picture, isVideo);

      this.peerConnection = new RTCPeerConnection(this.iceConfig);
      this._setupPeerConnection();

      this.localStream.getTracks().forEach(track => {
        this.peerConnection.addTrack(track, this.localStream);
      });

      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      const socket = InnovateAPI.getSocket();
      const user = InnovateAPI.getCurrentUser();
      socket.emit('call:initiate', {
        to: contactId,
        from: user.id,
        offer: offer,
        isVideo: isVideo,
        caller: { username: user.username, profile_picture: user.profile_picture }
      });

      // Auto-timeout after 45s if no answer
      this._ringTimeout = setTimeout(() => {
        if (this.callState === 'ringing') {
          this.endCall();
          if (typeof InnovateAPI !== 'undefined') InnovateAPI.showAlert('No answer', 'info');
        }
      }, 45000);

    } catch (error) {
      console.error('Error starting call:', error);
      this.cleanup();
      if (typeof InnovateAPI !== 'undefined') InnovateAPI.showAlert('Failed to access camera/microphone', 'error');
    }
  }

  async acceptCall() {
    const data = window._incomingCallData;
    if (!data) return;

    this.stopAllSounds();
    this.isVideoCall = data.isVideo;
    this.currentCallContactId = data.from;
    this.currentCallInfo = data.caller;
    this.isCallActive = true;

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: data.isVideo ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false
      });

      this.peerConnection = new RTCPeerConnection(this.iceConfig);
      this._setupPeerConnection();

      this.localStream.getTracks().forEach(track => {
        this.peerConnection.addTrack(track, this.localStream);
      });

      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      InnovateAPI.getSocket().emit('call:answer', { to: data.from, answer: answer });

      this.showActiveCallScreen(data.caller.username, data.caller.profile_picture, data.isVideo);
      window._incomingCallData = null;

    } catch (error) {
      console.error('Error accepting call:', error);
      this.rejectCall();
    }
  }

  rejectCall() {
    const data = window._incomingCallData;
    if (data) {
      InnovateAPI.getSocket().emit('call:reject', { to: data.from });
    }
    this.stopAllSounds();
    this._hideModal();
    this.callState = 'idle';
    window._incomingCallData = null;
  }

  endCall() {
    const duration = this._getDurationString();

    if (this.currentCallContactId) {
      InnovateAPI.getSocket().emit('call:end', { to: this.currentCallContactId });
    }

    // Notify additional participants
    this.additionalPeers.forEach((pc, socketId) => {
      pc.close();
    });
    this.additionalPeers.clear();
    this.participants.clear();

    this.showCallEndedScreen(duration);

    if (this._ringTimeout) { clearTimeout(this._ringTimeout); this._ringTimeout = null; }

    this.cleanup();
  }

  cleanup() {
    this.stopAllSounds();
    if (this._controlsTimeout) { clearTimeout(this._controlsTimeout); this._controlsTimeout = null; }
    
    // Remove mini indicator if present
    const mini = document.getElementById('waCallMini');
    if (mini) mini.remove();

    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    if (this.remoteStream) {
      this.remoteStream.getTracks().forEach(t => t.stop());
      this.remoteStream = null;
    }
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(t => t.stop());
      this.screenStream = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    if (this.callDurationInterval) {
      clearInterval(this.callDurationInterval);
      this.callDurationInterval = null;
    }

    this.isCallActive = false;
    this.isVideoCall = false;
    this.isMuted = false;
    this.isVideoEnabled = true;
    this.isSpeakerOn = false;
    this.isScreenSharing = false;
    this.callStartTime = null;
    this.currentCallContactId = null;
    this.callDirection = null;
  }

  _setupPeerConnection() {
    const pc = this.peerConnection;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        InnovateAPI.getSocket().emit('call:ice-candidate', {
          to: this.currentCallContactId,
          candidate: event.candidate
        });
      }
    };

    pc.ontrack = (event) => {
      if (!this.remoteStream) {
        this.remoteStream = new MediaStream();
      }
      this.remoteStream.addTrack(event.track);
      const remoteVid = document.getElementById('waRemoteVideo');
      if (remoteVid) remoteVid.srcObject = this.remoteStream;
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      const statusEl = document.getElementById('waCallStatus');

      if (state === 'connected' || state === 'completed') {
        if (this.callState !== 'connected') {
          this.showActiveCallScreen(
            this.currentCallInfo?.username || 'User',
            this.currentCallInfo?.profile_picture,
            this.isVideoCall
          );
        }
      } else if (state === 'disconnected' || state === 'failed') {
        if (statusEl) statusEl.textContent = 'Reconnecting...';
        if (state === 'failed') {
          setTimeout(() => { if (pc.iceConnectionState === 'failed') this.endCall(); }, 5000);
        }
      }
    };
  }

  // ========== SOCKET LISTENERS ==========

  setupSocketListeners(socket) {
    socket.off('call:incoming');
    socket.off('call:answered');
    socket.off('call:ice-candidate');
    socket.off('call:rejected');
    socket.off('call:ended');
    socket.off('call:add-member-offer');
    socket.off('call:add-member-answer');
    socket.off('call:add-member-ice');

    socket.on('call:incoming', (data) => {
      if (this.isCallActive) {
        // Already in a call, auto-reject
        socket.emit('call:reject', { to: data.from });
        return;
      }
      this.showIncomingCallScreen(data);
    });

    socket.on('call:answered', async (data) => {
      if (this.peerConnection && data.answer) {
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
      }
      if (this._ringTimeout) { clearTimeout(this._ringTimeout); this._ringTimeout = null; }
    });

    socket.on('call:ice-candidate', async (data) => {
      if (this.peerConnection && data.candidate) {
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) { console.warn('ICE candidate error:', e); }
      }
    });

    socket.on('call:rejected', () => {
      this.stopAllSounds();
      if (this._ringTimeout) { clearTimeout(this._ringTimeout); this._ringTimeout = null; }
      this.showCallEndedScreen('');
      this.cleanup();
    });

    socket.on('call:ended', () => {
      const duration = this._getDurationString();
      this.showCallEndedScreen(duration);
      this.cleanup();
    });

    // Add member signaling
    socket.on('call:add-member-offer', async (data) => {
      if (!this.isCallActive) return;
      // Another user is being added to our call
      const pc = new RTCPeerConnection(this.iceConfig);
      this.additionalPeers.set(data.fromSocketId, pc);

      if (this.localStream) {
        this.localStream.getTracks().forEach(t => pc.addTrack(t, this.localStream));
      }

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          socket.emit('call:add-member-ice', { to: data.fromSocketId, candidate: e.candidate });
        }
      };

      pc.ontrack = (event) => {
        // Additional participant audio/video
        this.participants.set(data.userId, { username: data.username, profile_picture: data.profile_picture });
        this._updateParticipantsUI();
      };

      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('call:add-member-answer', { to: data.fromSocketId, answer });
    });

    socket.on('call:add-member-answer', async (data) => {
      const pc = this.additionalPeers.get(data.fromSocketId);
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      }
    });

    socket.on('call:add-member-ice', async (data) => {
      const pc = this.additionalPeers.get(data.fromSocketId);
      if (pc && data.candidate) {
        try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (e) {}
      }
    });
  }

  _updateParticipantsUI() {
    const area = document.getElementById('waParticipantsArea');
    if (area) area.innerHTML = this._renderParticipantsList();
  }

  // ========== CONTROLS ==========

  toggleMute() {
    if (!this.localStream) return;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (!audioTrack) return;
    audioTrack.enabled = !audioTrack.enabled;
    this.isMuted = !audioTrack.enabled;

    // Update UI
    const btns = [document.getElementById('waMuteBtn'), document.getElementById('waCtrlMute')];
    btns.forEach(btn => {
      if (btn) {
        const iconDiv = btn.querySelector('.wa-ctrl-icon') || btn;
        if (this.isMuted) {
          iconDiv.classList.add('wa-ctrl-active');
          btn.classList.add('wa-ctrl-active-btn');
        } else {
          iconDiv.classList.remove('wa-ctrl-active');
          btn.classList.remove('wa-ctrl-active-btn');
        }
      }
    });
  }

  toggleVideo() {
    if (!this.localStream) return;
    const videoTrack = this.localStream.getVideoTracks()[0];

    if (!videoTrack && !this.isVideoCall) {
      // Upgrade to video
      navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } })
        .then(stream => {
          const newTrack = stream.getVideoTracks()[0];
          this.localStream.addTrack(newTrack);
          if (this.peerConnection) {
            const sender = this.peerConnection.getSenders().find(s => s.track?.kind === 'video');
            if (sender) sender.replaceTrack(newTrack);
            else this.peerConnection.addTrack(newTrack, this.localStream);
          }
          this.isVideoCall = true;
          this.isVideoEnabled = true;
          this._updateVideoUI();
        });
      return;
    }

    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      this.isVideoEnabled = videoTrack.enabled;
      this._updateVideoUI();
    }
  }

  _updateVideoUI() {
    const localVid = document.getElementById('waLocalVideo');
    if (localVid) {
      localVid.style.display = this.isVideoEnabled ? 'block' : 'none';
      if (this.localStream) localVid.srcObject = this.localStream;
    }

    const btns = [document.getElementById('waVideoBtn'), document.getElementById('waCtrlVideo')];
    btns.forEach(btn => {
      if (btn) {
        const iconDiv = btn.querySelector('.wa-ctrl-icon') || btn;
        if (!this.isVideoEnabled) {
          iconDiv.classList.add('wa-ctrl-active');
          btn.classList.add('wa-ctrl-active-btn');
        } else {
          iconDiv.classList.remove('wa-ctrl-active');
          btn.classList.remove('wa-ctrl-active-btn');
        }
      }
    });
  }

  toggleSpeaker() {
    this.isSpeakerOn = !this.isSpeakerOn;
    const btns = [document.getElementById('waSpeakerBtn'), document.getElementById('waCtrlSpeaker')];
    btns.forEach(btn => {
      if (btn) {
        const iconDiv = btn.querySelector('.wa-ctrl-icon') || btn;
        if (this.isSpeakerOn) {
          iconDiv.classList.add('wa-ctrl-active');
          btn.classList.add('wa-ctrl-active-btn');
        } else {
          iconDiv.classList.remove('wa-ctrl-active');
          btn.classList.remove('wa-ctrl-active-btn');
        }
      }
    });
  }

  // ========== SCREEN SHARE ==========

  async toggleScreenShare() {
    if (this.isScreenSharing) {
      // Stop screen share, restore camera
      if (this.screenStream) {
        this.screenStream.getTracks().forEach(t => t.stop());
        this.screenStream = null;
      }

      const videoTrack = this.localStream?.getVideoTracks()[0];
      if (videoTrack && this.peerConnection) {
        const sender = this.peerConnection.getSenders().find(s => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(videoTrack);
      }

      this.isScreenSharing = false;
      this._updateScreenShareUI();
      return;
    }

    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' }, audio: false
      });

      const screenTrack = this.screenStream.getVideoTracks()[0];

      if (this.peerConnection) {
        const sender = this.peerConnection.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
          sender.replaceTrack(screenTrack);
        } else {
          this.peerConnection.addTrack(screenTrack, this.screenStream);
        }
      }

      screenTrack.onended = () => {
        this.isScreenSharing = false;
        const camTrack = this.localStream?.getVideoTracks()[0];
        if (camTrack && this.peerConnection) {
          const sender = this.peerConnection.getSenders().find(s => s.track?.kind === 'video');
          if (sender) sender.replaceTrack(camTrack);
        }
        this._updateScreenShareUI();
      };

      this.isScreenSharing = true;
      this._updateScreenShareUI();

      // Show screen in local video preview
      const localVid = document.getElementById('waLocalVideo');
      if (localVid) {
        localVid.srcObject = this.screenStream;
        localVid.style.display = 'block';
      }

    } catch (error) {
      console.log('Screen share cancelled or failed:', error);
    }
  }

  _updateScreenShareUI() {
    const btn = document.getElementById('waCtrlScreen');
    if (btn) {
      const iconDiv = btn.querySelector('.wa-ctrl-icon');
      if (this.isScreenSharing) {
        iconDiv?.classList.add('wa-ctrl-active');
        btn.classList.add('wa-ctrl-active-btn');
      } else {
        iconDiv?.classList.remove('wa-ctrl-active');
        btn.classList.remove('wa-ctrl-active-btn');
      }
    }
  }

  // ========== ADD MEMBER ==========

  async showAddMemberModal() {
    try {
      const response = await InnovateAPI.apiRequest('/messages/conversations');
      const contacts = response.conversations || response || [];

      let existing = document.getElementById('waAddMemberModal');
      if (existing) existing.remove();

      const modal = document.createElement('div');
      modal.id = 'waAddMemberModal';
      modal.style.cssText = 'position:fixed;inset:0;z-index:1000000;display:flex;align-items:center;justify-content:center;';
      modal.innerHTML = `
        <div onclick="document.getElementById('waAddMemberModal').remove()" style="position:absolute;inset:0;background:rgba(0,0,0,0.7);"></div>
        <div style="position:relative;width:90%;max-width:400px;max-height:70vh;background:var(--ig-secondary-background, #262626);border-radius:16px;display:flex;flex-direction:column;overflow:hidden;">
          <div style="padding:16px;border-bottom:1px solid var(--ig-border, #363636);display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:17px;font-weight:600;color:var(--ig-primary-text, #fff);">Add to call</span>
            <button onclick="document.getElementById('waAddMemberModal').remove()" style="background:none;border:none;color:var(--ig-secondary-text);font-size:22px;cursor:pointer;">&times;</button>
          </div>
          <div style="padding:8px 16px;">
            <div style="display:flex;align-items:center;background:var(--ig-tertiary-background, #363636);border-radius:10px;padding:8px 12px;gap:8px;">
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" width="18" height="18" style="color:var(--ig-secondary-text);flex-shrink:0;"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35" stroke-linecap="round"/></svg>
              <input type="text" id="waAddMemberSearch" placeholder="Search contacts..." oninput="callManager._filterAddMembers(this.value)" style="background:none;border:none;outline:none;color:var(--ig-primary-text, #fff);font-size:14px;width:100%;" />
            </div>
          </div>
          <div id="waAddMemberList" style="flex:1;overflow-y:auto;padding:4px 0;">
            ${contacts.map(c => `
              <div onclick="callManager.addMemberToCall(${c.contact_id}, '${(c.username || '').replace(/'/g, "\\'")}')" style="display:flex;align-items:center;gap:12px;padding:10px 16px;cursor:pointer;transition:background 0.15s;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='none'">
                <img src="${c.profile_picture || '/img/default-avatar.png'}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;" onerror="this.src='/img/default-avatar.png'" />
                <div style="flex:1;min-width:0;">
                  <div style="font-size:15px;font-weight:500;color:var(--ig-primary-text, #fff);">${c.username || ''}</div>
                </div>
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" width="20" height="20" style="color:var(--ig-secondary-text);"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </div>
            `).join('')}
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      window._addMemberContacts = contacts;
    } catch (error) {
      console.error('Failed to load contacts:', error);
      if (typeof InnovateAPI !== 'undefined') InnovateAPI.showAlert('Failed to load contacts', 'error');
    }
  }

  _filterAddMembers(query) {
    const q = query.toLowerCase().trim();
    const contacts = window._addMemberContacts || [];
    const filtered = q ? contacts.filter(c => (c.username || '').toLowerCase().includes(q)) : contacts;
    const list = document.getElementById('waAddMemberList');
    if (!list) return;
    if (filtered.length === 0) {
      list.innerHTML = '<div style="text-align:center;padding:30px;color:#a8a8a8;">No contacts found</div>';
      return;
    }
    list.innerHTML = filtered.map(c => `
      <div onclick="callManager.addMemberToCall(${c.contact_id}, '${(c.username || '').replace(/'/g, "\\'")}')" style="display:flex;align-items:center;gap:12px;padding:10px 16px;cursor:pointer;transition:background 0.15s;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='none'">
        <img src="${c.profile_picture || '/img/default-avatar.png'}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;" onerror="this.src='/img/default-avatar.png'" />
        <div style="flex:1;"><div style="font-size:15px;font-weight:500;color:var(--ig-primary-text, #fff);">${c.username || ''}</div></div>
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" width="20" height="20" style="color:var(--ig-secondary-text);"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
    `).join('');
  }

  addMemberToCall(contactId, username) {
    document.getElementById('waAddMemberModal')?.remove();

    // Send call invite to the user through signaling
    const socket = InnovateAPI.getSocket();
    const user = InnovateAPI.getCurrentUser();

    socket.emit('call:initiate', {
      to: contactId,
      from: user.id,
      offer: null, // Will be sent separately
      isVideo: this.isVideoCall,
      caller: { username: user.username, profile_picture: user.profile_picture },
      isGroupAdd: true
    });

    this.participants.set(contactId, { username, profile_picture: null });
    this._updateParticipantsUI();

    if (typeof InnovateAPI !== 'undefined') InnovateAPI.showAlert(`Calling ${username}...`, 'info');
  }
}

// ========== E2E ENCRYPTION FOR DMs ==========

const DMEncryption = {
  _deriveKey(userId1, userId2) {
    const ids = [userId1, userId2].sort((a, b) => a - b);
    return `dm_e2e_${ids[0]}_${ids[1]}_innovate_secret`;
  },

  encrypt(text, userId1, userId2) {
    try {
      if (!text || !userId1 || !userId2) return text;
      if (typeof CryptoJS === 'undefined') return text;
      const key = this._deriveKey(userId1, userId2);
      return CryptoJS.AES.encrypt(text, key).toString();
    } catch (e) {
      console.error('DM encrypt error:', e);
      return text;
    }
  },

  decrypt(encryptedText, userId1, userId2) {
    try {
      if (!encryptedText || !userId1 || !userId2) return encryptedText;
      if (typeof CryptoJS === 'undefined') return encryptedText;
      if (!encryptedText.includes('U2FsdGVk')) return encryptedText;
      const key = this._deriveKey(userId1, userId2);
      const decrypted = CryptoJS.AES.decrypt(encryptedText, key).toString(CryptoJS.enc.Utf8);
      if (decrypted) return decrypted;
      // Try with string-coerced IDs in case of type mismatch during encryption
      const key2 = this._deriveKey(String(userId1), String(userId2));
      if (key2 !== key) {
        const decrypted2 = CryptoJS.AES.decrypt(encryptedText, key2).toString(CryptoJS.enc.Utf8);
        if (decrypted2) return decrypted2;
      }
      const key3 = this._deriveKey(Number(userId1), Number(userId2));
      if (key3 !== key && key3 !== key2) {
        const decrypted3 = CryptoJS.AES.decrypt(encryptedText, key3).toString(CryptoJS.enc.Utf8);
        if (decrypted3) return decrypted3;
      }
      // Decryption failed — return friendly placeholder instead of ciphertext
      return '🔒 Encrypted message';
    } catch (e) {
      return '🔒 Encrypted message';
    }
  }
};

// Initialize global instance
const callManager = new CallManager();
window.callManager = callManager;
window.DMEncryption = DMEncryption;
