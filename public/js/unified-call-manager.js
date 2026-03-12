/**
 * Unified Call Manager — shared component for DM and group calls.
 * Replaces both CallManager and GroupCallManager with a single class.
 * Supports: voice/video, screen share, add member, group mesh, call history,
 *           system messages in chat, ongoing call banner, participant picker,
 *           tap-to-swap video, multi-device handling.
 */

class UnifiedCallManager {
  constructor() {
    // WebRTC
    this.localStream = null;
    this.remoteStream = null;
    this.screenStream = null;
    this.peerConnection = null;          // 1-to-1
    this.peers = new Map();              // group mesh: socketId → RTCPeerConnection
    this.participants = new Map();       // userId → { username, profile_picture }
    this.iceConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'turn:a.relay.metered.ca:80', username: 'e8dd65d92f3c1ed1ee8b438c', credential: 'vK+RjR1t5yGpNjrA' },
        { urls: 'turn:a.relay.metered.ca:443', username: 'e8dd65d92f3c1ed1ee8b438c', credential: 'vK+RjR1t5yGpNjrA' },
        { urls: 'turn:a.relay.metered.ca:443?transport=tcp', username: 'e8dd65d92f3c1ed1ee8b438c', credential: 'vK+RjR1t5yGpNjrA' }
      ]
    };

    // State
    this.callState = 'idle';             // idle | ringing | connecting | connected | ended
    this.callDirection = null;           // outgoing | incoming
    this.callMode = null;               // 'dm' | 'group'
    this.isVideoCall = false;
    this.isMuted = false;
    this.isVideoOff = false;
    this.isSpeakerOn = false;
    this.isSharingScreen = false;
    this.isVideoSwapped = false;         // tap-to-swap state

    // Current call details
    this.currentCallId = null;           // DB call_history.id
    this.currentContactId = null;        // target user for DM
    this.currentGroupId = null;          // target group
    this.currentContactInfo = null;      // { username, profile_picture }
    this.callStartTime = null;
    this.callTimerInterval = null;
    this.ringTimeout = null;

    // Socket
    this.socket = null;

    // Persistent audio element for remote audio (survives UI rebuilds)
    this._remoteAudioEl = null;

    // ICE candidate buffer — holds candidates that arrive before peerConnection or remoteDescription is ready
    this._pendingIceCandidates = [];

    // Add member contacts cache
    this._addMemberContacts = [];

    // Multi-device transfer data
    this._pendingTransferData = null;

    // Track which screen mode is currently rendered to avoid unnecessary DOM rebuilds
    this._renderedScreenKey = null;
    // Retry timer for stream attachment
    this._streamRetryTimer = null;

    // Screen share focus mode
    this._participantsHidden = false;
    this._remoteScreenSharePeer = null;  // socketId or 'dm' when remote is sharing
    this._originalIsVideoCall = false;   // restore after screen share ends
    this.peerStreams = new Map();         // socketId → MediaStream for group peers
  }

  // Ensure a persistent hidden audio element exists (outside the modal)
  _ensureRemoteAudio() {
    if (!this._remoteAudioEl) {
      this._remoteAudioEl = document.createElement('audio');
      this._remoteAudioEl.id = 'waPersistentRemoteAudio';
      this._remoteAudioEl.autoplay = true;
      this._remoteAudioEl.style.display = 'none';
      document.body.appendChild(this._remoteAudioEl);
    }
    return this._remoteAudioEl;
  }

  _destroyRemoteAudio() {
    if (this._remoteAudioEl) {
      this._remoteAudioEl.srcObject = null;
      this._remoteAudioEl.remove();
      this._remoteAudioEl = null;
    }
  }

  // Flush any ICE candidates that were buffered before peerConnection/remoteDescription was ready
  async _applyBufferedIceCandidates() {
    while (this._pendingIceCandidates.length > 0) {
      const candidate = this._pendingIceCandidates.shift();
      try {
        if (this.peerConnection) {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } catch (err) {
        console.error('Buffered ICE candidate error:', err);
      }
    }
  }

  // ===================== RINGTONE SYSTEM =====================

  _playTone(frequencies, duration, type = 'sine') {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const gainNode = audioCtx.createGain();
      gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gainNode.connect(audioCtx.destination);

      const oscillators = frequencies.map(freq => {
        const osc = audioCtx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        osc.connect(gainNode);
        return osc;
      });

      oscillators.forEach(o => o.start());
      setTimeout(() => {
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
        setTimeout(() => {
          oscillators.forEach(o => { try { o.stop(); } catch (_) {} });
          audioCtx.close();
        }, 150);
      }, duration);

      return { audioCtx, oscillators, gainNode };
    } catch (_) { return null; }
  }

  playIncomingRingtone() {
    this.stopAllSounds();
    let count = 0;
    const ring = () => {
      if (this.callState !== 'ringing' || this.callDirection !== 'incoming' || count > 30) return;
      this._playTone([440, 480], 400);
      count++;
      this._ringInterval = setTimeout(ring, 1200);
    };
    ring();
  }

  playRingback() {
    this.stopAllSounds();
    let count = 0;
    const ring = () => {
      if (this.callState !== 'ringing' || this.callDirection !== 'outgoing' || count > 30) return;
      this._playTone([440, 480], 1500);
      count++;
      this._ringInterval = setTimeout(ring, 3000);
    };
    ring();
  }

  playCallEndTone() { this._playTone([480, 620], 200); }
  playConnectedTone() { this._playTone([440], 100); setTimeout(() => this._playTone([660], 100), 150); }

  stopAllSounds() {
    if (this._ringInterval) { clearTimeout(this._ringInterval); this._ringInterval = null; }
  }

  // ===================== UI SCREENS =====================

  _getModal() {
    let modal = document.getElementById('waCallModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'waCallModal';
      document.body.appendChild(modal);
    }
    return modal;
  }

  showOutgoingCallScreen(contactInfo) {
    const modal = this._getModal();
    const name = contactInfo?.username || 'User';
    const pic = contactInfo?.profile_picture || '/images/default-avatar.svg';
    const label = this.callMode === 'group' ? 'Group Call' : (this.isVideoCall ? 'Video Call' : 'Voice Call');
    modal.style.display = 'block';
    modal.innerHTML = `
      <div style="position:fixed;top:0;left:0;right:0;bottom:0;background:linear-gradient(135deg,#1a1a2e,#16213e,#0f3460);z-index:100000;display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
        <div style="width:120px;height:120px;border-radius:50%;overflow:hidden;margin-bottom:24px;box-shadow:0 0 30px rgba(0,149,246,0.3);">
          <img src="${pic}" style="width:100%;height:100%;object-fit:cover;" onerror="this.src='/images/default-avatar.svg'" />
        </div>
        <h2 style="margin:0 0 8px;font-size:24px;">${name}</h2>
        <p style="margin:0;color:rgba(255,255,255,0.6);font-size:14px;">${label} • Calling...</p>
        <div style="position:absolute;bottom:80px;display:flex;gap:40px;">
          <button onclick="callManager.endCall()" style="width:64px;height:64px;border-radius:50%;background:#ff3b30;border:none;cursor:pointer;">
            <svg fill="white" width="28" height="28" viewBox="0 0 24 24"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>
          </button>
        </div>
      </div>`;
  }

  showIncomingCallScreen(callerInfo) {
    const modal = this._getModal();
    const name = callerInfo?.username || 'Unknown';
    const pic = callerInfo?.profile_picture || '/images/default-avatar.svg';
    const label = this.callMode === 'group' ? 'Group Call' : (this.isVideoCall ? 'Video Call' : 'Voice Call');
    modal.style.display = 'block';
    modal.innerHTML = `
      <div style="position:fixed;top:0;left:0;right:0;bottom:0;background:linear-gradient(135deg,#1a1a2e,#16213e,#0f3460);z-index:100000;display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
        <div style="width:120px;height:120px;border-radius:50%;overflow:hidden;margin-bottom:24px;box-shadow:0 0 30px rgba(0,149,246,0.3);animation:pulse-ring 1.5s ease-in-out infinite;">
          <img src="${pic}" style="width:100%;height:100%;object-fit:cover;" onerror="this.src='/images/default-avatar.svg'" />
        </div>
        <h2 style="margin:0 0 8px;font-size:24px;">${name}</h2>
        <p style="margin:0;color:rgba(255,255,255,0.6);font-size:14px;">Incoming ${label}</p>
        <div style="position:absolute;bottom:80px;display:flex;gap:60px;">
          <button onclick="callManager.rejectCall()" style="width:64px;height:64px;border-radius:50%;background:#ff3b30;border:none;cursor:pointer;">
            <svg fill="white" width="28" height="28" viewBox="0 0 24 24"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>
          </button>
          <button onclick="callManager.acceptCall()" style="width:64px;height:64px;border-radius:50%;background:#34c759;border:none;cursor:pointer;">
            <svg fill="white" width="28" height="28" viewBox="0 0 24 24"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/></svg>
          </button>
        </div>
      </div>
      <style>@keyframes pulse-ring { 0%,100%{box-shadow:0 0 30px rgba(52,199,89,0.3)} 50%{box-shadow:0 0 50px rgba(52,199,89,0.6)} }</style>`;
  }

  showActiveCallScreen() {
    const modal = this._getModal();
    const isGroup = this.callMode === 'group';
    const name = isGroup ? (this.currentContactInfo?.username || 'Group Call') : (this.currentContactInfo?.username || 'User');
    const pic = this.currentContactInfo?.profile_picture || '/images/default-avatar.svg';
    const isScreenShareMode = this.isSharingScreen || !!this._remoteScreenSharePeer;

    // Build a key that captures the current screen mode to prevent unnecessary rebuilds
    const screenKey = `active-${isGroup}-${this.isVideoCall}-${this.isVideoSwapped}-${this.isSharingScreen}-${!!this._remoteScreenSharePeer}`;
    
    // If we already rendered this exact screen, just re-attach streams
    if (this._renderedScreenKey === screenKey && document.getElementById('waActiveCallContainer')) {
      this._attachStreamsToUI();
      return;
    }
    this._renderedScreenKey = screenKey;

    // Determine which video is big vs small (tap-to-swap)
    const localIsBig = this.isVideoSwapped;
    const participantsHiddenCSS = this._participantsHidden ? 'display:none;' : '';

    let mainContentHTML = '';

    if (isScreenShareMode) {
      // ═══ SCREEN SHARE FOCUSED LAYOUT ═══
      const sharingLabel = this.isSharingScreen ? 'You are sharing your screen' : (isGroup ? 'Screen is being shared' : `${name} is sharing screen`);

      if (isGroup) {
        // Group screen share — main screen share view + small collapsible participant bar
        mainContentHTML = `
          <video id="waScreenShareMain" autoplay muted playsinline style="position:absolute;top:0;left:0;right:0;bottom:0;width:100%;height:100%;object-fit:contain;background:#000;z-index:1;"></video>
          <div style="position:absolute;top:60px;left:12px;z-index:6;background:rgba(0,149,246,0.85);color:white;padding:5px 12px;border-radius:16px;font-size:12px;font-weight:500;display:flex;align-items:center;gap:6px;">
            <svg fill="white" width="14" height="14" viewBox="0 0 24 24"><path d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/></svg>
            ${sharingLabel}
          </div>
          <div id="waParticipantsBar" style="position:absolute;bottom:106px;left:0;right:0;z-index:6;${participantsHiddenCSS}">
            <div id="waGroupVideoGrid" style="display:flex;gap:4px;padding:4px 8px;overflow-x:auto;flex-wrap:nowrap;"></div>
          </div>
          <button id="waToggleParticipants" onclick="callManager._toggleParticipantsVisibility()" style="position:absolute;bottom:106px;right:12px;z-index:7;background:rgba(0,0,0,0.7);color:white;border:1px solid rgba(255,255,255,0.3);border-radius:16px;padding:5px 12px;font-size:11px;cursor:pointer;backdrop-filter:blur(4px);">
            ${this._participantsHidden ? 'Show Participants' : 'Hide Participants'}
          </button>`;
      } else {
        // DM screen share — main screen share view + collapsible PiP for other person
        mainContentHTML = `
          <video id="waScreenShareMain" autoplay muted playsinline style="position:absolute;top:0;left:0;right:0;bottom:0;width:100%;height:100%;object-fit:contain;background:#000;z-index:1;"></video>
          <div style="position:absolute;top:60px;left:12px;z-index:6;background:rgba(0,149,246,0.85);color:white;padding:5px 12px;border-radius:16px;font-size:12px;font-weight:500;display:flex;align-items:center;gap:6px;">
            <svg fill="white" width="14" height="14" viewBox="0 0 24 24"><path d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/></svg>
            ${sharingLabel}
          </div>
          <div id="waParticipantsBar" style="position:absolute;top:100px;right:12px;z-index:6;${participantsHiddenCSS}">
            <video id="${this.isSharingScreen ? 'waRemoteVideo' : 'waLocalVideo'}" autoplay muted playsinline style="width:120px;height:90px;border-radius:12px;object-fit:cover;box-shadow:0 2px 10px rgba(0,0,0,0.4);border:2px solid rgba(255,255,255,0.3);background:#1a1a2e;"></video>
          </div>
          <button id="waToggleParticipants" onclick="callManager._toggleParticipantsVisibility()" style="position:absolute;top:${this._participantsHidden ? '100' : '196'}px;right:12px;z-index:7;background:rgba(0,0,0,0.7);color:white;border:1px solid rgba(255,255,255,0.3);border-radius:16px;padding:5px 12px;font-size:11px;cursor:pointer;backdrop-filter:blur(4px);">
            ${this._participantsHidden ? 'Show' : 'Hide'}
          </button>`;
      }
    } else if (this.isVideoCall && !isGroup) {
      // ═══ DM VIDEO CALL ═══
      mainContentHTML = `
        <video id="${localIsBig ? 'waLocalVideo' : 'waRemoteVideo'}" autoplay muted playsinline style="width:100%;height:100%;object-fit:cover;"></video>
        <video id="${localIsBig ? 'waRemoteVideo' : 'waLocalVideo'}" autoplay muted playsinline onclick="callManager._swapVideos()" style="position:absolute;top:60px;right:12px;width:120px;height:170px;border-radius:12px;object-fit:cover;z-index:4;box-shadow:0 2px 10px rgba(0,0,0,0.4);cursor:pointer;border:2px solid rgba(255,255,255,0.3);"></video>`;
    } else if (!isGroup) {
      // ═══ DM AUDIO CALL ═══
      mainContentHTML = `
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(135deg,#1a1a2e,#16213e,#0f3460);">
          <div style="width:100px;height:100px;border-radius:50%;overflow:hidden;margin-bottom:16px;">
            <img src="${pic}" style="width:100%;height:100%;object-fit:cover;" onerror="this.src='/images/default-avatar.svg'" />
          </div>
          <h3 style="color:white;margin:0 0 4px;">${name}</h3>
        </div>`;
    } else {
      // ═══ GROUP CALL (WhatsApp-style adaptive layout) ═══
      mainContentHTML = `<div id="waGroupVideoGrid" style="position:absolute;top:60px;left:0;right:0;bottom:100px;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:16px;padding:16px;overflow:auto;z-index:1;background:linear-gradient(135deg,#1a1a2e,#16213e,#0f3460);"></div>`;
    }

    modal.style.display = 'block';
    modal.innerHTML = `
      <div id="waActiveCallContainer" style="position:fixed;top:0;left:0;right:0;bottom:0;background:#000;z-index:100000;display:flex;flex-direction:column;">
        ${mainContentHTML}
        <!-- Top bar -->
        <div style="position:absolute;top:0;left:0;right:0;padding:16px;display:flex;justify-content:space-between;align-items:center;z-index:5;background:linear-gradient(to bottom,rgba(0,0,0,0.6),transparent);">
          <button onclick="callManager._minimizeCall()" style="background:none;border:none;color:white;cursor:pointer;padding:8px;">
            <svg fill="white" width="20" height="20" viewBox="0 0 24 24"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>
          </button>
          <span id="waCallTimer" style="color:white;font-size:14px;font-weight:600;">00:00</span>
          ${isGroup ? `<span style="color:rgba(255,255,255,0.7);font-size:12px;" id="waParticipantCount">${this.peers.size + 1} participants</span>` : '<span></span>'}
        </div>
        <!-- Controls bar -->
        <div style="position:absolute;bottom:0;left:0;right:0;padding:24px 16px;display:flex;justify-content:center;gap:16px;flex-wrap:wrap;z-index:5;background:linear-gradient(to top,rgba(0,0,0,0.8) 60%,transparent);">
          <button id="waBtnMute" onclick="callManager.toggleMute()" style="width:50px;height:50px;border-radius:50%;background:${this.isMuted ? '#ff3b30' : 'rgba(255,255,255,0.2)'};border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;" title="Mute">
            <svg fill="white" width="22" height="22" viewBox="0 0 24 24">${this.isMuted ? '<path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>' : '<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>'}</svg>
          </button>
          <button id="waBtnVideo" onclick="callManager.toggleVideo()" style="width:50px;height:50px;border-radius:50%;background:${this.isVideoOff ? '#ff3b30' : 'rgba(255,255,255,0.2)'};border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;" title="Camera">
            <svg fill="white" width="22" height="22" viewBox="0 0 24 24">${this.isVideoOff ? '<path d="M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z"/>' : '<path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>'}</svg>
          </button>
          <button id="waBtnSpeaker" onclick="callManager.toggleSpeaker()" style="width:50px;height:50px;border-radius:50%;background:${this.isSpeakerOn ? 'rgba(0,149,246,0.6)' : 'rgba(255,255,255,0.2)'};border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;" title="Speaker">
            <svg fill="white" width="22" height="22" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
          </button>
          <button id="waBtnScreenShare" onclick="callManager.toggleScreenShare()" style="width:50px;height:50px;border-radius:50%;background:${this.isSharingScreen ? 'rgba(0,149,246,0.6)' : 'rgba(255,255,255,0.2)'};border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;" title="Screen Share">
            <svg fill="white" width="22" height="22" viewBox="0 0 24 24"><path d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/></svg>
          </button>
          <button onclick="callManager.showAddMemberModal()" style="width:50px;height:50px;border-radius:50%;background:rgba(255,255,255,0.2);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;" title="Add Person">
            <svg fill="white" width="22" height="22" viewBox="0 0 24 24"><path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
          </button>
          <button onclick="callManager.endCall()" style="width:50px;height:50px;border-radius:50%;background:#ff3b30;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;" title="End Call">
            <svg fill="white" width="22" height="22" viewBox="0 0 24 24"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>
          </button>
        </div>
      </div>`;

    // Attach streams after DOM is built
    this._attachStreamsToUI();

    // Start/restart timer
    if (!this.callStartTime) this.callStartTime = Date.now();
    if (this.callTimerInterval) clearInterval(this.callTimerInterval);
    this.callTimerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.callStartTime) / 1000);
      const min = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const sec = String(elapsed % 60).padStart(2, '0');
      const timerEl = document.getElementById('waCallTimer');
      if (timerEl) timerEl.textContent = `${min}:${sec}`;
    }, 1000);

    // For group calls, display current participants in grid
    if (isGroup) this._renderGroupGrid();
  }

  // Attach local/remote streams to the current UI elements
  _attachStreamsToUI() {
    // Cancel any pending retry
    if (this._streamRetryTimer) {
      clearTimeout(this._streamRetryTimer);
      this._streamRetryTimer = null;
    }

    // Always use persistent audio element for remote audio (this plays the sound)
    const audioEl = this._ensureRemoteAudio();
    if (this.remoteStream) {
      if (audioEl.srcObject !== this.remoteStream) {
        audioEl.srcObject = this.remoteStream;
      }
      audioEl.play().catch(e => console.warn('[Call] Audio play blocked:', e.message));
    }

    // Screen share main view (used in screen share focused mode)
    const screenShareMain = document.getElementById('waScreenShareMain');
    if (screenShareMain) {
      if (this.isSharingScreen && this.screenStream) {
        // Local user sharing — show own screen preview
        if (screenShareMain.srcObject !== this.screenStream) screenShareMain.srcObject = this.screenStream;
        screenShareMain.play().catch(() => {});
      } else if (this._remoteScreenSharePeer === 'dm' && this.remoteStream) {
        // DM: remote is sharing — remote video has the screen content
        if (screenShareMain.srcObject !== this.remoteStream) screenShareMain.srcObject = this.remoteStream;
        screenShareMain.play().catch(() => {});
      } else if (this._remoteScreenSharePeer && this._remoteScreenSharePeer !== 'dm') {
        // Group: remote peer sharing — find their stream
        const peerStream = this.peerStreams.get(this._remoteScreenSharePeer);
        if (peerStream) {
          if (screenShareMain.srcObject !== peerStream) screenShareMain.srcObject = peerStream;
          screenShareMain.play().catch(() => {});
        }
      }
    }

    // Video elements are ALL muted — audio comes from persistent audio element above
    const localVid = document.getElementById('waLocalVideo');
    if (localVid && this.localStream) {
      if (localVid.srcObject !== this.localStream) {
        localVid.srcObject = this.localStream;
      }
      localVid.play().catch(() => {});
    }
    const remoteVid = document.getElementById('waRemoteVideo');
    if (remoteVid && this.remoteStream) {
      if (remoteVid.srcObject !== this.remoteStream) {
        remoteVid.srcObject = this.remoteStream;
      }
      remoteVid.play().catch(() => {});
    }

    // Retry if we have a remote stream but DOM elements aren't ready yet
    if (this.remoteStream && this.callState === 'connected') {
      const needsVideoRetry = this.isVideoCall && !remoteVid && !screenShareMain;
      const needsAudioRetry = !audioEl.srcObject;
      if (needsVideoRetry || needsAudioRetry) {
        this._streamRetryTimer = setTimeout(() => this._attachStreamsToUI(), 300);
      }
    }
  }

  // WhatsApp-style tap to swap local/remote video
  _swapVideos() {
    this.isVideoSwapped = !this.isVideoSwapped;
    this._renderedScreenKey = null; // Force rebuild for swapped layout
    this.showActiveCallScreen();
  }


  // Tap local PiP in 2-person group video call to swap peer/local
  _swapLocalPeerGroup() {
    this.isVideoSwapped = !this.isVideoSwapped;
    const grid = document.getElementById('waGroupVideoGrid');
    if (!grid) return;
    grid.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;z-index:1;overflow:hidden;background:#000;';
    grid.innerHTML = '';
    if (this.isVideoSwapped) {
      // Local video fills screen, peer is PiP
      const localVid = document.createElement('video');
      localVid.autoplay = true; localVid.muted = true; localVid.playsInline = true;
      localVid.style.cssText = 'width:100%;height:100%;object-fit:cover;position:absolute;top:0;left:0;';
      if (this.localStream) { localVid.srcObject = this.localStream; localVid.play().catch(() => {}); }
      grid.appendChild(localVid);
      const peerPip = document.createElement('video');
      peerPip.autoplay = true; peerPip.playsInline = true;
      peerPip.style.cssText = 'position:absolute;top:70px;right:12px;width:120px;height:170px;border-radius:12px;object-fit:cover;z-index:4;box-shadow:0 2px 10px rgba(0,0,0,0.4);border:2px solid rgba(255,255,255,0.3);cursor:pointer;';
      peerPip.onclick = () => this._swapLocalPeerGroup();
      this.peerStreams.forEach((s) => { if (peerPip.srcObject !== s) peerPip.srcObject = s; peerPip.play().catch(() => {}); });
      grid.appendChild(peerPip);
    } else {
      // Back to default: peer fills screen, local is PiP
      this._renderGroupGrid();
    }
  }

  showCallEndedScreen(reason) {
    const modal = this._getModal();
    const name = this.currentContactInfo?.username || 'User';
    const reasonText = reason || 'Call ended';
    const duration = this.callStartTime ? this._formatDuration(Math.floor((Date.now() - this.callStartTime) / 1000)) : '';
    modal.innerHTML = `
      <div style="position:fixed;top:0;left:0;right:0;bottom:0;background:linear-gradient(135deg,#1a1a2e,#16213e,#0f3460);z-index:100000;display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
        <h2 style="margin:0 0 8px;font-size:24px;">${name}</h2>
        <p style="margin:0;color:rgba(255,255,255,0.6);font-size:14px;">${reasonText}${duration ? ' • ' + duration : ''}</p>
      </div>`;
    setTimeout(() => { modal.style.display = 'none'; modal.innerHTML = ''; }, 2000);
  }

  _minimizeCall() {
    const modal = this._getModal();
    modal.innerHTML = `
      <div id="waCallMiniBanner" onclick="callManager._expandCall()" style="position:fixed;top:0;left:0;right:0;height:36px;background:#34c759;z-index:100000;display:flex;align-items:center;justify-content:center;cursor:pointer;color:white;font-size:13px;font-weight:600;">
        <span id="waCallTimerMini" style="margin-right:8px;">📞</span>
        <span>Tap to return to call</span>
      </div>`;
    // Audio stays playing via persistent audio element (outside modal)
    if (this.callTimerInterval) clearInterval(this.callTimerInterval);
    this.callTimerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.callStartTime) / 1000);
      const min = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const sec = String(elapsed % 60).padStart(2, '0');
      const el = document.getElementById('waCallTimerMini');
      if (el) el.textContent = `📞 ${min}:${sec}`;
    }, 1000);
  }

  _expandCall() { this._renderedScreenKey = null; this.showActiveCallScreen(); }

  _toggleParticipantsVisibility() {
    this._participantsHidden = !this._participantsHidden;
    const bar = document.getElementById('waParticipantsBar');
    const btn = document.getElementById('waToggleParticipants');
    if (bar) bar.style.display = this._participantsHidden ? 'none' : '';
    if (btn) btn.textContent = this._participantsHidden ? (this.callMode === 'group' ? 'Show Participants' : 'Show') : (this.callMode === 'group' ? 'Hide Participants' : 'Hide');
  }

  _formatDuration(seconds) {
    if (!seconds || seconds < 0) return '';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // Shows ongoing call banner at top of chat (for group calls someone else started)
  showOngoingCallBanner(groupId, participantCount) {
    let banner = document.getElementById('waOngoingCallBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'waOngoingCallBanner';
      banner.style.cssText = 'background:#34c759;color:white;padding:8px 16px;display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:500;cursor:pointer;position:fixed;top:60px;left:0;right:0;z-index:9999;';
      const chatHeader = document.querySelector('.ig-chat-header') || document.querySelector('.wa-chat-header');
      if (chatHeader) chatHeader.after(banner);
      else document.body.prepend(banner);
    }
    banner.innerHTML = `
      <span>📞 Ongoing call • ${participantCount} participant${participantCount > 1 ? 's' : ''}</span>
      <button onclick="callManager.joinGroupCall(${groupId})" style="background:white;color:#34c759;border:none;border-radius:16px;padding:4px 16px;font-weight:600;font-size:12px;cursor:pointer;">Join</button>
    `;
    banner.style.display = 'flex';
  }

  hideOngoingCallBanner() {
    const banner = document.getElementById('waOngoingCallBanner');
    if (banner) banner.style.display = 'none';
  }

  // ===================== GROUP VIDEO GRID =====================

  _renderGroupGrid() {
    const grid = document.getElementById('waGroupVideoGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const isScreenShareMode = this.isSharingScreen || !!this._remoteScreenSharePeer;
    const totalParticipants = this.peerStreams.size + 1; // +1 for self

    // ── 2-person video call: full-screen PiP layout (peer big, self small corner) ──
    if (this.isVideoCall && totalParticipants <= 2 && !isScreenShareMode) {
      grid.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;z-index:1;overflow:hidden;background:#000;';

      if (this.peerStreams.size > 0) {
        // Peer fills the full screen
        const peerVid = document.createElement('video');
        peerVid.autoplay = true;
        peerVid.playsInline = true;
        peerVid.style.cssText = 'width:100%;height:100%;object-fit:cover;position:absolute;top:0;left:0;';
        this.peerStreams.forEach((stream, socketId) => {
          if (peerVid.srcObject !== stream) peerVid.srcObject = stream;
          peerVid.play().catch(() => {});
          let peerAudio = document.getElementById(`waGroupPeerAudio-${socketId}`);
          if (!peerAudio) {
            peerAudio = document.createElement('audio');
            peerAudio.id = `waGroupPeerAudio-${socketId}`;
            peerAudio.autoplay = true;
            peerAudio.style.display = 'none';
            document.body.appendChild(peerAudio);
          }
          if (peerAudio.srcObject !== stream) peerAudio.srcObject = stream;
          peerAudio.play().catch(() => {});
        });
        grid.appendChild(peerVid);
      } else {
        // Waiting for peer — show placeholder
        grid.style.cssText += 'display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1a1a2e,#16213e,#0f3460);';
        const peerName = this.currentContactInfo?.username || 'User';
        const peerPic = this.currentContactInfo?.profile_picture;
        const placeholderEl = document.createElement('div');
        placeholderEl.style.cssText = 'text-align:center;color:white;';
        placeholderEl.innerHTML = peerPic
          ? `<img src="${peerPic}" style="width:100px;height:100px;border-radius:50%;object-fit:cover;margin-bottom:16px;" onerror="this.style.display='none'"/><div style="font-size:18px;font-weight:600;">${peerName}</div>`
          : `<div style="width:100px;height:100px;border-radius:50%;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:40px;font-weight:700;color:white;">${peerName.charAt(0).toUpperCase()}</div><div style="font-size:18px;font-weight:600;">${peerName}</div>`;
        grid.appendChild(placeholderEl);
      }

      // Local video — small PiP in top-right corner (muted)
      const localVid = document.createElement('video');
      localVid.id = 'waLocalVideo';
      localVid.autoplay = true;
      localVid.muted = true;
      localVid.playsInline = true;
      localVid.style.cssText = 'position:absolute;top:70px;right:12px;width:120px;height:170px;border-radius:12px;object-fit:cover;z-index:4;box-shadow:0 2px 10px rgba(0,0,0,0.4);border:2px solid rgba(255,255,255,0.3);cursor:pointer;';
      localVid.onclick = () => this._swapLocalPeerGroup();
      if (this.localStream) { localVid.srcObject = this.localStream; localVid.play().catch(() => {}); }
      grid.appendChild(localVid);
      return;
    }

    // ── 3+ participants or audio-only: tile grid ──
    grid.style.cssText = 'position:absolute;top:60px;left:0;right:0;bottom:100px;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:16px;padding:16px;overflow:auto;z-index:1;background:linear-gradient(135deg,#1a1a2e,#16213e,#0f3460);';

    // WhatsApp-style adaptive sizing: larger DPs for fewer participants
    let dpSize, fontSize;
    if (isScreenShareMode) {
      dpSize = 60; fontSize = 20;
    } else if (totalParticipants <= 4) {
      dpSize = 100; fontSize = 30;
    } else if (totalParticipants <= 6) {
      dpSize = 80; fontSize = 24;
    } else {
      dpSize = 64; fontSize = 20;
    }

    const tileCSS = isScreenShareMode
      ? 'position:relative;background:#1a1a2e;border-radius:8px;overflow:hidden;width:100px;height:75px;flex-shrink:0;'
      : `position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;width:${dpSize + 40}px;flex-shrink:0;`;

    // Local user tile
    const localContainer = document.createElement('div');
    localContainer.style.cssText = tileCSS;

    const hasLocalVideo = this.isVideoCall && this.localStream && this.localStream.getVideoTracks().length > 0;
    if (hasLocalVideo && !isScreenShareMode) {
      localContainer.style.cssText = isScreenShareMode
        ? 'position:relative;background:#1a1a2e;border-radius:8px;overflow:hidden;width:100px;height:75px;flex-shrink:0;'
        : `position:relative;background:#1a1a2e;border-radius:12px;overflow:hidden;width:${dpSize + 40}px;height:${dpSize + 60}px;flex-shrink:0;`;
      const localVid = document.createElement('video');
      localVid.autoplay = true;
      localVid.muted = true;
      localVid.playsInline = true;
      localVid.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      localVid.srcObject = this.localStream;
      localContainer.appendChild(localVid);
    } else {
      // Audio-only — circular profile picture (WhatsApp style)
      const user = typeof InnovateAPI !== 'undefined' ? InnovateAPI.getCurrentUser() : null;
      const userPic = user?.profile_picture;
      const avatarDiv = document.createElement('div');
      avatarDiv.style.cssText = `width:${dpSize}px;height:${dpSize}px;border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#667eea,#764ba2);border:3px solid rgba(255,255,255,0.3);box-shadow:0 4px 15px rgba(0,0,0,0.3);`;
      if (userPic) {
        avatarDiv.innerHTML = `<img src="${userPic}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.innerHTML='<svg fill=\\'white\\' width=\\'${fontSize}\\' height=\\'${fontSize}\\' viewBox=\\'0 0 24 24\\'><path d=\\'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z\\'/></svg>'" />`;
      } else {
        avatarDiv.innerHTML = `<svg fill="white" width="${fontSize}" height="${fontSize}" viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`;
      }
      localContainer.appendChild(avatarDiv);
    }

    const localLabel = document.createElement('div');
    localLabel.style.cssText = isScreenShareMode
      ? 'position:absolute;bottom:4px;left:8px;color:white;font-size:11px;background:rgba(0,0,0,0.5);padding:2px 6px;border-radius:4px;'
      : 'color:rgba(255,255,255,0.9);font-size:12px;margin-top:8px;text-align:center;font-weight:500;';
    localLabel.textContent = 'You';
    localContainer.appendChild(localLabel);
    grid.appendChild(localContainer);

    // Also re-render any existing peers
    this.peerStreams.forEach((stream, socketId) => {
      const presence = this.participants.get(socketId);
      this._addGroupPeerVideoToGrid(grid, socketId, presence?.username || 'Participant', stream, tileCSS, dpSize, fontSize);
    });
  }

  _addGroupPeerVideoToGrid(grid, socketId, displayName, stream, tileCSS, dpSize, fontSize) {
    if (!grid) return;
    dpSize = dpSize || 80;
    fontSize = fontSize || 24;
    const isScreenShareMode = this.isSharingScreen || !!this._remoteScreenSharePeer;

    let container = document.getElementById(`waGroupPeer-${socketId}`);
    if (!container) {
      container = document.createElement('div');
      container.id = `waGroupPeer-${socketId}`;
      container.style.cssText = tileCSS;
      grid.appendChild(container);
    }
    container.innerHTML = '';

    const presence = this.participants.get(socketId);
    const peerPic = presence?.profile_picture;
    const hasVideo = stream && stream.getVideoTracks().length > 0 && stream.getVideoTracks()[0].enabled;
    if (hasVideo) {
      if (!isScreenShareMode) {
        container.style.cssText = `position:relative;background:#1a1a2e;border-radius:12px;overflow:hidden;width:${dpSize + 40}px;height:${dpSize + 60}px;flex-shrink:0;`;
      }
      const vid = document.createElement('video');
      vid.autoplay = true;
      vid.muted = true;
      vid.playsInline = true;
      vid.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      vid.srcObject = stream;
      container.appendChild(vid);
    } else {
      // Audio-only participant — circular profile picture (WhatsApp style)
      const avatarDiv = document.createElement('div');
      avatarDiv.style.cssText = `width:${dpSize}px;height:${dpSize}px;border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#f093fb,#f5576c);border:3px solid rgba(255,255,255,0.3);box-shadow:0 4px 15px rgba(0,0,0,0.3);`;
      if (peerPic) {
        avatarDiv.innerHTML = `<img src="${peerPic}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none';this.parentElement.innerHTML='<span style=\\'color:white;font-size:${fontSize}px;font-weight:700;\\'>${(displayName || 'P').charAt(0).toUpperCase()}</span>'" />`;
      } else {
        const initial = (displayName || 'P').charAt(0).toUpperCase();
        avatarDiv.innerHTML = `<span style="color:white;font-size:${fontSize}px;font-weight:700;">${initial}</span>`;
      }
      container.appendChild(avatarDiv);
    }

    // Play audio from this peer — use persistent element outside the grid to survive re-renders
    let peerAudio = document.getElementById(`waGroupPeerAudio-${socketId}`);
    if (!peerAudio) {
      peerAudio = document.createElement('audio');
      peerAudio.id = `waGroupPeerAudio-${socketId}`;
      peerAudio.autoplay = true;
      peerAudio.style.display = 'none';
      document.body.appendChild(peerAudio);
    }
    if (peerAudio.srcObject !== stream) {
      peerAudio.srcObject = stream;
    }
    peerAudio.play().catch(() => {});

    const label = document.createElement('div');
    label.style.cssText = isScreenShareMode
      ? 'position:absolute;bottom:4px;left:8px;color:white;font-size:11px;background:rgba(0,0,0,0.5);padding:2px 6px;border-radius:4px;'
      : 'color:rgba(255,255,255,0.9);font-size:12px;margin-top:8px;text-align:center;font-weight:500;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    label.textContent = displayName || 'Participant';
    container.appendChild(label);
  }

  _addGroupPeerVideo(socketId, displayName, stream, profilePicture) {
    // Store stream for re-renders and screen share
    this.peerStreams.set(socketId, stream);
    // Merge profile_picture into participants (may already exist from _createGroupPeerConnection)
    const existing = this.participants.get(socketId) || {};
    this.participants.set(socketId, { ...existing, username: displayName, profile_picture: profilePicture || existing.profile_picture || null });

    // If this peer is screen sharing, re-attach updated stream to waScreenShareMain
    if (this._remoteScreenSharePeer === socketId) {
      this._attachStreamsToUI();
    }

    const grid = document.getElementById('waGroupVideoGrid');
    if (!grid) return;

    const isScreenShareMode = this.isSharingScreen || !!this._remoteScreenSharePeer;
    const totalParticipants = this.peerStreams.size + 1;

    // For 2-person video: re-render in PiP layout when the first peer arrives
    if (this.isVideoCall && totalParticipants <= 2 && !isScreenShareMode) {
      this._renderGroupGrid();
      const countEl = document.getElementById('waParticipantCount');
      if (countEl) countEl.textContent = `${this.peers.size + 1} participants`;
      return;
    }

    let dpSize, fontSize;
    if (isScreenShareMode) { dpSize = 60; fontSize = 20; }
    else if (totalParticipants <= 4) { dpSize = 100; fontSize = 30; }
    else if (totalParticipants <= 6) { dpSize = 80; fontSize = 24; }
    else { dpSize = 64; fontSize = 20; }

    const tileCSS = isScreenShareMode
      ? 'position:relative;background:#1a1a2e;border-radius:8px;overflow:hidden;width:100px;height:75px;flex-shrink:0;'
      : `position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;width:${dpSize + 40}px;flex-shrink:0;`;

    this._addGroupPeerVideoToGrid(grid, socketId, displayName, stream, tileCSS, dpSize, fontSize);

    const countEl = document.getElementById('waParticipantCount');
    if (countEl) countEl.textContent = `${this.peers.size + 1} participants`;
  }

  _removeGroupPeerVideo(socketId) {
    this.peerStreams.delete(socketId);
    this.participants.delete(socketId);
    const el = document.getElementById(`waGroupPeer-${socketId}`);
    if (el) el.remove();
    // Clean up persistent peer audio element
    const peerAudio = document.getElementById(`waGroupPeerAudio-${socketId}`);
    if (peerAudio) { peerAudio.srcObject = null; peerAudio.remove(); }
    const countEl = document.getElementById('waParticipantCount');
    if (countEl) countEl.textContent = `${this.peers.size + 1} participants`;
  }

  // ===================== CORE CALL METHODS =====================

  async startCall(contactId, contactInfo, isVideo) {
    if (this.callState !== 'idle') {
      if (typeof InnovateAPI !== 'undefined') InnovateAPI.showAlert('Already in a call', 'error');
      return;
    }

    this.callMode = 'dm';
    this.callDirection = 'outgoing';
    this.isVideoCall = isVideo;
    this.callState = 'ringing';
    this.currentContactId = contactId;
    this.currentContactInfo = contactInfo;

    this.showOutgoingCallScreen(contactInfo);
    this.playRingback();

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Media devices not available. Ensure you are on HTTPS.');
      }

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: isVideo ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false
        });
      } catch (mediaErr) {
        console.error('getUserMedia failed:', mediaErr);
        // Fallback: try audio-only if video was requested
        if (isVideo) {
          console.log('Retrying with audio only...');
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          this.isVideoCall = false;
          this.isVideoOff = true;
        } else {
          throw mediaErr;
        }
      }

      if (!stream) {
        throw new Error('Failed to get media stream');
      }

      this.localStream = stream;

      // Check if call was cancelled while waiting for getUserMedia
      if (this.callState !== 'ringing') {
        stream.getTracks().forEach(t => t.stop());
        this.localStream = null;
        return;
      }

      // Prime audio element during user gesture so play() works later (iOS autoplay policy)
      const primeAudio = this._ensureRemoteAudio();
      primeAudio.srcObject = new MediaStream();
      await primeAudio.play().catch(() => {});

      // Guard: if cleanup happened during audio prime
      if (!this.localStream) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      this.peerConnection = new RTCPeerConnection(this.iceConfig);
      this._setupDMPeerConnection();

      stream.getTracks().forEach(track => {
        this.peerConnection.addTrack(track, this.localStream);
      });

      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      const user = InnovateAPI.getCurrentUser();
      this.socket.emit('call:initiate', {
        to: contactId,
        from: user.id,
        offer,
        isVideo: this.isVideoCall,
        caller: { username: user.username, profile_picture: user.profile_picture }
      });

      this._logCallStart('dm', contactId, isVideo);

      // 45s ring timeout
      this.ringTimeout = setTimeout(() => {
        if (this.callState === 'ringing') {
          this.endCall('no_answer');
        }
      }, 45000);

    } catch (err) {
      console.error('startCall error:', err);
      this.cleanup();
      if (typeof InnovateAPI !== 'undefined') InnovateAPI.showAlert('Could not access camera/mic', 'error');
    }
  }

  async startGroupCall(groupId, groupInfo, isAudioOnly) {
    if (this.callState !== 'idle' && this.callState !== 'connecting') {
      if (typeof InnovateAPI !== 'undefined') InnovateAPI.showAlert('Already in a call', 'error');
      return;
    }

    this.callMode = 'group';
    this.callDirection = 'outgoing';
    this.isVideoCall = !isAudioOnly;
    this.callState = 'connecting';
    this.currentGroupId = groupId;
    this.currentContactInfo = groupInfo || { username: 'Group Call' };

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Media devices not available. Ensure you are on HTTPS.');
      }

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: this.isVideoCall ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } : false
        });
      } catch (mediaErr) {
        console.error('getUserMedia failed:', mediaErr);
        if (this.isVideoCall) {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          this.isVideoCall = false;
          this.isVideoOff = true;
        } else {
          throw mediaErr;
        }
      }

      if (!stream) {
        throw new Error('Failed to get media stream');
      }

      this.localStream = stream;

      const user = InnovateAPI.getCurrentUser();
      this.socket.emit('group-call:join', {
        groupId,
        userId: user.id,
        displayName: user.username || user.fullname || 'User',
        isVideo: this.isVideoCall,
        profilePicture: user.profile_picture || null,
        groupPicture: this.currentContactInfo?.profile_picture || null
      });

      this._logCallStart('group', groupId, this.isVideoCall);

      this.callState = 'connected';
      this.showActiveCallScreen();
      this.playConnectedTone();

    } catch (err) {
      console.error('startGroupCall error:', err);
      this.cleanup();
      if (typeof InnovateAPI !== 'undefined') InnovateAPI.showAlert('Could not access camera/mic', 'error');
    }
  }

  async joinGroupCall(groupId, groupInfo) {
    this.hideOngoingCallBanner();
    // Reset state if we were in ringing from group-call:ring
    if (this.callState === 'ringing') {
      this.stopAllSounds();
      if (this.ringTimeout) { clearTimeout(this.ringTimeout); this.ringTimeout = null; }
      this.callState = 'idle';
    }
    // Respect current isVideoCall flag (set by group-call:ring), default to audio-only
    const isAudioOnly = this.isVideoCall === true ? false : true;
    await this.startGroupCall(groupId, groupInfo || { username: 'Group Call' }, isAudioOnly);
  }

  async acceptCall() {
    if (this.callState !== 'ringing' || this.callDirection !== 'incoming') return;

    this.stopAllSounds();
    if (this.ringTimeout) { clearTimeout(this.ringTimeout); this.ringTimeout = null; }
    this.callState = 'connecting';

    // Group call acceptance — join the mesh
    if (this.callMode === 'group' && this._pendingGroupCallData) {
      const groupId = this._pendingGroupCallData.groupId;
      this._pendingGroupCallData = null;
      this.hideOngoingCallBanner();
      // Notify other devices of this user that call was answered here
      const user = InnovateAPI.getCurrentUser();
      this.socket.emit('call:answered-on-device', { userId: user.id, callFrom: groupId });
      await this.startGroupCall(groupId, this.currentContactInfo, !this.isVideoCall);
      return;
    }

    // DM call acceptance
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Media devices not available. Ensure you are on HTTPS.');
      }

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: this.isVideoCall ? { facingMode: 'user' } : false
        });
      } catch (mediaErr) {
        console.error('getUserMedia failed:', mediaErr);
        if (this.isVideoCall) {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          this.isVideoCall = false;
          this.isVideoOff = true;
        } else {
          throw mediaErr;
        }
      }

      if (!stream) {
        throw new Error('Failed to get media stream');
      }

      this.localStream = stream;

      this.peerConnection = new RTCPeerConnection(this.iceConfig);
      this._setupDMPeerConnection();

      stream.getTracks().forEach(track => {
        this.peerConnection.addTrack(track, stream);
      });

      // Prime audio element during user gesture so play() works later (iOS autoplay policy)
      const primeAudio = this._ensureRemoteAudio();
      primeAudio.srcObject = new MediaStream();
      await primeAudio.play().catch(() => {});

      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(this._pendingOffer));
      await this._applyBufferedIceCandidates();

      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      const user = InnovateAPI.getCurrentUser();
      this.socket.emit('call:answer', {
        to: this.currentContactId,
        answer,
        from: user.id
      });

      // Notify server call was answered
      if (this.currentCallId) {
        this._apiPost('/api/calls/answer', { callId: this.currentCallId });
      }

      // Notify other devices of this user that call was answered here
      this.socket.emit('call:answered-on-device', {
        userId: user.id,
        callFrom: this.currentContactId
      });

      this.callState = 'connected';
      this._renderedScreenKey = null; // Force fresh active screen
      this.showActiveCallScreen();
      this.playConnectedTone();

    } catch (err) {
      console.error('acceptCall error:', err);
      this.cleanup();
      if (typeof InnovateAPI !== 'undefined') InnovateAPI.showAlert('Could not access camera/mic', 'error');
    }
  }

  rejectCall() {
    if (this.callState !== 'ringing' || this.callDirection !== 'incoming') return;

    this.stopAllSounds();
    if (this.ringTimeout) { clearTimeout(this.ringTimeout); this.ringTimeout = null; }
    
    if (this.callMode === 'group') {
      // Just dismiss the incoming group call screen — don't signal rejection
      this.showCallEndedScreen('Call declined');
      this.playCallEndTone();
      this.cleanup();
      return;
    }
    
    this.socket.emit('call:reject', { to: this.currentContactId });
    this.showCallEndedScreen('Call declined');
    this.playCallEndTone();
    this._logCallEnd('declined');
    this.cleanup();
  }

  endCall(reason) {
    if (this.callState === 'idle') return;

    this.stopAllSounds();
    if (this.ringTimeout) { clearTimeout(this.ringTimeout); this.ringTimeout = null; }

    // Notify peers that screen sharing stopped before ending
    if (this.isSharingScreen) {
      if (this.callMode === 'group' && this.currentGroupId) {
        this.socket.emit('group-call:screen-share', { groupId: this.currentGroupId, sharing: false });
      } else if (this.callMode === 'dm' && this.currentContactId) {
        this.socket.emit('call:screen-share', { to: this.currentContactId, sharing: false });
      }
    }

    const status = reason || (this.callState === 'connected' ? 'completed' : (this.callState === 'ringing' && this.callDirection === 'outgoing' ? 'cancelled' : 'ended'));

    if (this.callMode === 'dm') {
      this.socket.emit('call:end', { to: this.currentContactId });
    } else if (this.callMode === 'group') {
      this.socket.emit('group-call:leave', { groupId: this.currentGroupId });
      this.peers.forEach((pc) => pc.close());
      this.peers.clear();
    }

    this.showCallEndedScreen(status === 'completed' ? 'Call ended' : (status === 'no_answer' ? 'No answer' : 'Call ended'));
    this.playCallEndTone();
    this._logCallEnd(status);
    this.cleanup();
  }

  cleanup() {
    if (this.callTimerInterval) { clearInterval(this.callTimerInterval); this.callTimerInterval = null; }
    if (this.ringTimeout) { clearTimeout(this.ringTimeout); this.ringTimeout = null; }
    if (this._lastPeerLeftTimer) { clearTimeout(this._lastPeerLeftTimer); this._lastPeerLeftTimer = null; }
    this.stopAllSounds();

    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(t => t.stop());
      this.screenStream = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    this.peers.forEach(pc => pc.close());
    this.peers.clear();
    this.participants.clear();

    // Destroy persistent audio
    this._destroyRemoteAudio();
    // Remove autoplay banner if present
    const autoplayBanner = document.getElementById('waAutoplayBanner');
    if (autoplayBanner) autoplayBanner.remove();

    // Remove any added member audios and persistent peer audio elements
    document.querySelectorAll('[id^="waAddedMemberAudio-"], [id^="waGroupPeerAudio-"]').forEach(el => { el.srcObject = null; el.remove(); });

    this.remoteStream = null;
    this.callState = 'idle';
    this.callDirection = null;
    this.callMode = null;
    this.isVideoCall = false;
    this.isMuted = false;
    this.isVideoOff = false;
    this.isSpeakerOn = false;
    this.isSharingScreen = false;
    this.isVideoSwapped = false;
    this.currentCallId = null;
    this.currentContactId = null;
    this.currentGroupId = null;
    this.currentContactInfo = null;
    this.callStartTime = null;
    this._pendingOffer = null;
    this._pendingTransferData = null;
    this._pendingGroupCallData = null;
    this._pendingIceCandidates = [];
    this._renderedScreenKey = null;
    this._participantsHidden = false;
    this._remoteScreenSharePeer = null;
    this._originalIsVideoCall = false;
    this.peerStreams.clear();
    if (this._streamRetryTimer) {
      clearTimeout(this._streamRetryTimer);
      this._streamRetryTimer = null;
    }
  }

  // ===================== WEBRTC (DM 1-to-1) =====================

  _setupDMPeerConnection() {
    if (!this.peerConnection) return;

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('call:ice-candidate', {
          to: this.currentContactId,
          candidate: event.candidate
        });
      }
    };

    this.peerConnection.ontrack = (event) => {
      console.log('[Call] Remote track received:', event.track.kind, 'readyState:', event.track.readyState);
      
      // Use the stream from the event, or build one from the track
      const incomingStream = event.streams[0];
      
      if (!this.remoteStream) {
        this.remoteStream = incomingStream || new MediaStream();
      } else if (incomingStream && incomingStream.id !== this.remoteStream.id) {
        // If a different stream arrived, merge its tracks into our existing one
        incomingStream.getTracks().forEach(t => {
          if (!this.remoteStream.getTrackById(t.id)) {
            this.remoteStream.addTrack(t);
          }
        });
      }
      
      // Add the specific track if not already present
      if (!this.remoteStream.getTrackById(event.track.id)) {
        this.remoteStream.addTrack(event.track);
      }

      // CRITICAL: Immediately set audio on the persistent element (don't wait for UI rebuild)
      const audioEl = this._ensureRemoteAudio();
      if (audioEl.srcObject !== this.remoteStream) {
        audioEl.srcObject = this.remoteStream;
      }
      audioEl.play().catch(e => {
        console.warn('[Call] Audio play blocked:', e.message);
        // Show tap-to-unmute banner as fallback
        if (!document.getElementById('waAutoplayBanner')) {
          const banner = document.createElement('div');
          banner.id = 'waAutoplayBanner';
          banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#ff9500;color:white;text-align:center;padding:12px;z-index:200000;cursor:pointer;font-weight:600;font-size:14px;';
          banner.textContent = '\uD83D\uDD07 Tap here to enable call audio';
          banner.onclick = () => { audioEl.play().catch(() => {}); banner.remove(); };
          document.body.appendChild(banner);
        }
      });

      // If we received a video track and we're in voice mode, upgrade to video
      // But if remote is screen sharing, don't rebuild to normal video — the screen share layout handles it
      if (event.track.kind === 'video') {
        if (!this.isVideoCall) {
          console.log('[Call] Upgrading to video call — remote video track received');
          this.isVideoCall = true;
        }
        this._renderedScreenKey = null;
        this.showActiveCallScreen();
        return;
      }

      // Always re-attach streams to UI (handles race condition where ontrack fires after DOM rebuild)
      this._attachStreamsToUI();
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState;
      console.log('[Call] Connection state:', state);
      if (state === 'connected') {
        if (this.callState !== 'connected') {
          this.callState = 'connected';
          this.stopAllSounds();
          this._renderedScreenKey = null; // Force rebuild on first connect
          this.showActiveCallScreen();
          this.playConnectedTone();
        } else {
          // Already connected — just re-attach streams (ontrack may have fired)
          this._attachStreamsToUI();
        }
      } else if (state === 'failed' || state === 'closed') {
        this.endCall('connection_lost');
      }
    };

    this.peerConnection.onnegotiationneeded = async () => {
      // Handle renegotiation (needed when adding video track mid-call or screen share)
      if (this.callState !== 'connected') return;
      try {
        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);
        this.socket.emit('call:renegotiate', {
          to: this.currentContactId,
          offer: this.peerConnection.localDescription
        });
      } catch (err) {
        console.error('Renegotiation error:', err);
      }
    };
  }

  // ===================== WEBRTC (GROUP MESH) =====================

  _createGroupPeerConnection(socketId, userId, displayName, initiator, profilePicture) {
    const pc = new RTCPeerConnection(this.iceConfig);

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream));
    }

    // Save display name and profile picture for re-renders
    this.participants.set(socketId, { username: displayName || 'Participant', userId, profile_picture: profilePicture || null });

    pc.ontrack = (event) => {
      // Merge new track into existing stream to preserve live srcObject references
      let stream;
      const existingStream = this.peerStreams.get(socketId);
      if (existingStream) {
        if (!existingStream.getTrackById(event.track.id)) {
          existingStream.addTrack(event.track);
        }
        stream = existingStream;
      } else {
        stream = event.streams[0] || new MediaStream([event.track]);
      }
      this._addGroupPeerVideo(socketId, displayName, stream, profilePicture);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('group-call:signal', {
          groupId: this.currentGroupId,
          to: socketId,
          payload: { candidate: event.candidate }
        });
      }
    };

    // Renegotiation for mid-call changes (screen share, add video)
    pc.onnegotiationneeded = async () => {
      if (pc.connectionState !== 'connected') return;
      if (pc.signalingState !== 'stable') return;
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.socket.emit('group-call:signal', {
          groupId: this.currentGroupId,
          to: socketId,
          payload: pc.localDescription
        });
      } catch (err) {
        console.error('[GroupCall] Renegotiation error:', err);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this._removeGroupPeer(socketId);
      }
    };

    this.peers.set(socketId, pc);

    if (initiator) {
      this._createGroupOffer(socketId, pc);
    }

    return pc;
  }

  async _createGroupOffer(socketId, pc) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.socket.emit('group-call:signal', {
        groupId: this.currentGroupId,
        to: socketId,
        payload: offer
      });
    } catch (err) {
      console.error('Group offer error:', err);
    }
  }

  _removeGroupPeer(socketId) {
    const pc = this.peers.get(socketId);
    if (pc) { pc.close(); this.peers.delete(socketId); }
    this.participants.delete(socketId);
    this.peerStreams.delete(socketId);
    this._removeGroupPeerVideo(socketId);

    // If this peer was sharing screen, exit screen share mode
    if (this._remoteScreenSharePeer === socketId) {
      this._remoteScreenSharePeer = null;
      this._participantsHidden = false;
      this._renderedScreenKey = null;
      if (this.callState === 'connected') this.showActiveCallScreen();
    }

    // Auto-end call if everyone else left and we're the only one remaining
    if (this.peers.size === 0 && this.callState === 'connected' && this.callMode === 'group') {
      if (this._lastPeerLeftTimer) clearTimeout(this._lastPeerLeftTimer);
      this._lastPeerLeftTimer = setTimeout(() => {
        this._lastPeerLeftTimer = null;
        if (this.peers.size === 0 && this.callState === 'connected' && this.callMode === 'group') {
          this.endCall();
        }
      }, 5000);
    }
  }

  // ===================== SOCKET LISTENERS =====================

  setupSocketListeners(socket) {
    this.socket = socket;

    // Remove existing call listeners to prevent duplicates
    socket.off('call:incoming');
    socket.off('call:answered');
    socket.off('call:ice-candidate');
    socket.off('call:rejected');
    socket.off('call:ended');
    socket.off('call:renegotiate');
    socket.off('call:renegotiate-answer');
    socket.off('call:answered-on-device');
    socket.off('group-call:peers');
    socket.off('group-call:peer-joined');
    socket.off('group-call:signal');
    socket.off('group-call:peer-left');
    socket.off('group-call:ring');
    socket.off('group-call:ended');
    socket.off('group-call:screen-share');

    // DM: incoming call
    socket.on('call:incoming', (data) => {
      if (this.callState !== 'idle') {
        socket.emit('call:reject', { to: data.from });
        return;
      }

      // If this is a group add invitation (no WebRTC offer, just an invite to join group call)
      if (data.isGroupAdd && data.groupId) {
        this.callMode = 'group';
        this.callDirection = 'incoming';
        this.callState = 'ringing';
        this.isVideoCall = data.isVideo;
        this.currentGroupId = data.groupId;
        this.currentContactInfo = { username: data.caller?.username || 'Group Call', profile_picture: data.caller?.profile_picture };
        this._pendingGroupCallData = { groupId: data.groupId, isVideo: data.isVideo };

        this.showIncomingCallScreen({
          username: `${data.caller?.username || 'Someone'} invites you to a call`,
          profile_picture: data.caller?.profile_picture
        });
        this.playIncomingRingtone();

        this.ringTimeout = setTimeout(() => {
          if (this.callState === 'ringing') {
            this.stopAllSounds();
            this.showCallEndedScreen('Missed call');
            this.cleanup();
          }
        }, 45000);
        return;
      }

      // If this is a DM add-to-call with an offer, treat it as a normal incoming call
      // but mark it as an add (they'll join an existing DM peer for audio/video)
      this.callMode = 'dm';
      this.callDirection = 'incoming';
      this.callState = 'ringing';
      this.isVideoCall = data.isVideo;
      this.currentContactId = data.from;
      this.currentContactInfo = data.caller;
      this._pendingOffer = data.offer;

      this.showIncomingCallScreen(data.caller);
      this.playIncomingRingtone();

      this.ringTimeout = setTimeout(() => {
        if (this.callState === 'ringing') {
          this.stopAllSounds();
          this.showCallEndedScreen('Missed call');
          this.cleanup();
        }
      }, 45000);
    });

    // DM: call answered by remote
    socket.on('call:answered', async (data) => {
      if (this.callState !== 'ringing' || this.callDirection !== 'outgoing') return;

      this.stopAllSounds();
      if (this.ringTimeout) { clearTimeout(this.ringTimeout); this.ringTimeout = null; }

      try {
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        await this._applyBufferedIceCandidates();
        // Set state to connected — onconnectionstatechange will also fire
        // but the guard (callState !== 'connected') prevents double-rebuild
        this.callState = 'connected';
        this._renderedScreenKey = null; // Force fresh active screen
        this.showActiveCallScreen();
        this.playConnectedTone();
      } catch (err) {
        console.error('Error handling answer:', err);
        this.endCall();
      }
    });

    // DM: ICE candidate — buffer if peerConnection or remoteDescription not ready yet
    socket.on('call:ice-candidate', async (data) => {
      try {
        if (this.peerConnection && this.peerConnection.remoteDescription && data.candidate) {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } else if (data.candidate) {
          this._pendingIceCandidates.push(data.candidate);
        }
      } catch (err) {
        console.error('ICE candidate error:', err);
      }
    });

    // DM: call rejected
    socket.on('call:rejected', () => {
      this.stopAllSounds();
      this.showCallEndedScreen('Call declined');
      this.playCallEndTone();
      this._logCallEnd('declined');
      this.cleanup();
    });

    // DM: call ended by remote
    socket.on('call:ended', () => {
      this.stopAllSounds();
      this.showCallEndedScreen('Call ended');
      this.playCallEndTone();
      this._logCallEnd(this.callState === 'connected' ? 'completed' : 'missed');
      this.cleanup();
    });

    // DM: renegotiation (remote added video track or screen share mid-call)
    socket.on('call:renegotiate', async (data) => {
      try {
        if (!this.peerConnection) return;
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);
        socket.emit('call:renegotiate-answer', {
          to: this.currentContactId,
          answer
        });
        // Video upgrade is now handled in ontrack when the video track arrives
      } catch (err) {
        console.error('Renegotiation answer error:', err);
      }
    });

    socket.on('call:renegotiate-answer', async (data) => {
      try {
        if (!this.peerConnection) return;
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
      } catch (err) {
        console.error('Renegotiation answer set error:', err);
      }
    });

    // Multi-device: call was answered on another device of this user
    socket.on('call:answered-elsewhere', () => {
      if (this.callState === 'ringing' && this.callDirection === 'incoming') {
        this.stopAllSounds();
        this.showCallEndedScreen('Answered on another device');
        this.cleanup();
      }
    });

    // Multi-device: group call was answered on another device
    socket.on('group-call:answered-elsewhere', () => {
      if (this.callState === 'ringing' && this.callDirection === 'incoming' && this.callMode === 'group') {
        this.stopAllSounds();
        this.showCallEndedScreen('Answered on another device');
        this.cleanup();
      }
    });

    // DM: add member signaling
    socket.on('call:add-member-offer', async (data) => {
      try {
        const pc = new RTCPeerConnection(this.iceConfig);
        if (this.localStream) {
          this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream));
        }
        pc.ontrack = (event) => {
          const audio = document.createElement('audio');
          audio.autoplay = true;
          audio.srcObject = event.streams[0];
          audio.id = `waAddedMemberAudio-${data.userId}`;
          document.body.appendChild(audio);
        };
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            socket.emit('call:add-member-ice', { to: data.fromSocketId, candidate: event.candidate });
          }
        };
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('call:add-member-answer', { to: data.fromSocketId, answer });
        this.peers.set(data.fromSocketId, pc);
        this.participants.set(data.userId, { username: data.username, profile_picture: data.profile_picture });
      } catch (err) {
        console.error('add-member-offer error:', err);
      }
    });

    socket.on('call:add-member-answer', async (data) => {
      try {
        const pc = this.peers.get(data.fromSocketId);
        if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      } catch (err) {
        console.error('add-member-answer error:', err);
      }
    });

    socket.on('call:add-member-ice', async (data) => {
      try {
        const pc = this.peers.get(data.fromSocketId);
        if (pc && data.candidate) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (err) {
        console.error('add-member-ice error:', err);
      }
    });

    // ===== GROUP CALL SIGNALING =====

    socket.on('group-call:peers', (data) => {
      if (!data.peers) return;
      data.peers.forEach(peer => {
        this._createGroupPeerConnection(peer.socketId, peer.userId, peer.displayName, true, peer.profilePicture);
      });
    });

    socket.on('group-call:peer-joined', (data) => {
      if (!data.peer) return;
      this._createGroupPeerConnection(data.peer.socketId, data.peer.userId, data.peer.displayName, false, data.peer.profilePicture);
    });

    socket.on('group-call:signal', async (data) => {
      try {
        let pc = this.peers.get(data.from);
        if (!pc) {
          pc = this._createGroupPeerConnection(data.from, null, null, false);
        }
        const payload = data.payload;
        if (payload.candidate) {
          // Buffer ICE candidates if remoteDescription not yet set
          if (pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
          } else {
            if (!pc._bufferedCandidates) pc._bufferedCandidates = [];
            pc._bufferedCandidates.push(payload.candidate);
          }
        } else if (payload.type === 'offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(payload));
          // Flush buffered ICE candidates
          if (pc._bufferedCandidates) {
            for (const c of pc._bufferedCandidates) {
              await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
            }
            pc._bufferedCandidates = [];
          }
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit('group-call:signal', {
            groupId: this.currentGroupId || data.groupId,
            to: data.from,
            payload: answer
          });
        } else if (payload.type === 'answer') {
          await pc.setRemoteDescription(new RTCSessionDescription(payload));
          // Flush buffered ICE candidates
          if (pc._bufferedCandidates) {
            for (const c of pc._bufferedCandidates) {
              await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
            }
            pc._bufferedCandidates = [];
          }
        }
      } catch (err) {
        console.error('group-call:signal error:', err);
      }
    });

    socket.on('group-call:peer-left', (data) => {
      this._removeGroupPeer(data.socketId);
    });

    socket.on('group-call:started', (data) => {
      if (this.callState === 'idle' && data.groupId) {
        this.showOngoingCallBanner(data.groupId, data.participantCount || 1);
      }
    });

    // Group call ring — someone started a group call, show incoming call screen
    socket.on('group-call:ring', (data) => {
      if (this.callState !== 'idle') return;
      
      this.callMode = 'group';
      this.callDirection = 'incoming';
      this.callState = 'ringing';
      this.isVideoCall = !!data.isVideo;
      this.currentGroupId = data.groupId;
      const groupLabel = data.groupName || 'Group Call';
      this.currentContactInfo = { username: groupLabel, profile_picture: data.groupPicture || data.callerPicture || null };
      this._pendingGroupCallData = data;
      
      this.showIncomingCallScreen({
        username: `${data.callerName || 'Someone'} • ${groupLabel}`,
        profile_picture: data.groupPicture || data.callerPicture || null
      });
      this.playIncomingRingtone();
      
      // Auto-dismiss after 45 seconds
      this.ringTimeout = setTimeout(() => {
        if (this.callState === 'ringing' && this.callMode === 'group') {
          this.stopAllSounds();
          this.showCallEndedScreen('Missed group call');
          this.cleanup();
        }
      }, 45000);
    });

    socket.on('group-call:ended', (data) => {
      this.hideOngoingCallBanner();
      // Also dismiss incoming ring screen if we're ringing for this group call
      const gid = data && data.groupId;
      if (this.callState === 'ringing' && this.callMode === 'group' &&
          (!gid || String(this.currentGroupId) === String(gid))) {
        this.stopAllSounds();
        if (this.ringTimeout) { clearTimeout(this.ringTimeout); this.ringTimeout = null; }
        this.showCallEndedScreen('Call cancelled');
        this.cleanup();
      }
    });

    // Screen share signaling — remote user started/stopped sharing
    socket.on('call:screen-share', (data) => {
      this._remoteScreenSharePeer = data.sharing ? 'dm' : null;
      this._participantsHidden = false;
      this._renderedScreenKey = null;
      if (this.callState === 'connected') this.showActiveCallScreen();
    });

    socket.on('group-call:screen-share', (data) => {
      this._remoteScreenSharePeer = data.sharing ? data.from : null;
      this._participantsHidden = false;
      this._renderedScreenKey = null;
      if (this.callState === 'connected') this.showActiveCallScreen();
    });
  }

  // ===================== CONTROLS =====================

  toggleMute() {
    if (!this.localStream) return;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (!audioTrack) return;
    audioTrack.enabled = !audioTrack.enabled;
    this.isMuted = !audioTrack.enabled;
    const btn = document.getElementById('waBtnMute');
    if (btn) {
      btn.style.background = this.isMuted ? '#ff3b30' : 'rgba(255,255,255,0.2)';
      btn.innerHTML = this.isMuted
        ? '<svg fill="white" width="22" height="22" viewBox="0 0 24 24"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/></svg>'
        : '<svg fill="white" width="22" height="22" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>';
    }
  }

  async toggleVideo() {
    if (!this.localStream) return;
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      this.isVideoOff = !videoTrack.enabled;
    } else {
      // Voice call — add video track dynamically
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        const newVideoTrack = videoStream.getVideoTracks()[0];
        this.localStream.addTrack(newVideoTrack);
        if (this.peerConnection) {
          this.peerConnection.addTrack(newVideoTrack, this.localStream);
        }
        this.peers.forEach((pc) => {
          pc.addTrack(newVideoTrack, this.localStream);
        });
        this.isVideoCall = true;
        this.isVideoOff = false;
        this._renderedScreenKey = null; // Force rebuild for video layout
        this.showActiveCallScreen();
        return;
      } catch (err) {
        console.error('Failed to add video:', err);
        return;
      }
    }
    const btn = document.getElementById('waBtnVideo');
    if (btn) {
      btn.style.background = this.isVideoOff ? '#ff3b30' : 'rgba(255,255,255,0.2)';
      btn.innerHTML = this.isVideoOff
        ? '<svg fill="white" width="22" height="22" viewBox="0 0 24 24"><path d="M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z"/></svg>'
        : '<svg fill="white" width="22" height="22" viewBox="0 0 24 24"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>';
    }
    const localVid = document.getElementById('waLocalVideo');
    if (localVid) {
      localVid.style.display = this.isVideoOff ? 'none' : '';
    }
  }

  toggleSpeaker() {
    this.isSpeakerOn = !this.isSpeakerOn;
    const btn = document.getElementById('waBtnSpeaker');
    if (btn) {
      btn.style.background = this.isSpeakerOn ? 'rgba(0,149,246,0.6)' : 'rgba(255,255,255,0.2)';
    }
    const audioEl = this._remoteAudioEl;
    const remoteVid = document.getElementById('waRemoteVideo');
    [audioEl, remoteVid].forEach(el => {
      if (!el) return;
      if (typeof el.setSinkId === 'function') {
        el.setSinkId(this.isSpeakerOn ? 'default' : '').catch(() => {});
      }
      el.volume = this.isSpeakerOn ? 1.0 : 0.5;
    });
  }

  async toggleScreenShare() {
    if (this.isSharingScreen) {
      this._stopScreenShare();
      return;
    }

    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
        audio: true
      });

      const screenTrack = this.screenStream.getVideoTracks()[0];
      const screenAudioTrack = this.screenStream.getAudioTracks()[0];

      // Replace or add video track in peer connection(s)
      if (this.peerConnection) {
        const sender = this.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
          await sender.replaceTrack(screenTrack);
        } else {
          this.peerConnection.addTrack(screenTrack, this.localStream);
        }
        // Add screen audio as a separate track (does NOT replace mic audio)
        if (screenAudioTrack) {
          this.peerConnection.addTrack(screenAudioTrack, this.screenStream);
        }
      }

      this.peers.forEach((pc) => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
          sender.replaceTrack(screenTrack);
        } else {
          pc.addTrack(screenTrack, this.localStream);
        }
        if (screenAudioTrack) {
          pc.addTrack(screenAudioTrack, this.screenStream);
        }
      });

      this.isSharingScreen = true;
      this._originalIsVideoCall = this.isVideoCall;
      if (!this.isVideoCall) this.isVideoCall = true;
      this._participantsHidden = false;
      this._renderedScreenKey = null;
      this.showActiveCallScreen();

      // Signal to peers that screen sharing started
      if (this.callMode === 'group' && this.currentGroupId) {
        this.socket.emit('group-call:screen-share', { groupId: this.currentGroupId, sharing: true });
      } else if (this.callMode === 'dm' && this.currentContactId) {
        this.socket.emit('call:screen-share', { to: this.currentContactId, sharing: true });
      }

      screenTrack.onended = () => this._stopScreenShare();

      if (typeof InnovateAPI !== 'undefined') InnovateAPI.showAlert('Screen sharing started', 'success');
    } catch (err) {
      if (err.name !== 'NotAllowedError') console.error('Screen share error:', err);
    }
  }

  _stopScreenShare() {
    if (!this.screenStream) return;

    // Save references to screen audio tracks BEFORE stopping them
    const screenAudioTracks = this.screenStream.getAudioTracks().slice();

    const cameraTrack = this.localStream?.getVideoTracks()[0];

    // Remove screen audio senders and restore video senders BEFORE stopping tracks
    if (this.peerConnection) {
      const videoSender = this.peerConnection.getSenders().find(s => s.track?.kind === 'video');
      if (videoSender) {
        if (cameraTrack) { videoSender.replaceTrack(cameraTrack); }
        else { this.peerConnection.removeTrack(videoSender); }
      }
      // Remove screen audio sender (keep mic audio sender)
      this.peerConnection.getSenders().forEach(s => {
        if (s.track && screenAudioTracks.includes(s.track)) {
          this.peerConnection.removeTrack(s);
        }
      });
    }
    this.peers.forEach((pc) => {
      const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
      if (videoSender) {
        if (cameraTrack) { videoSender.replaceTrack(cameraTrack); }
        else { pc.removeTrack(videoSender); }
      }
      pc.getSenders().forEach(s => {
        if (s.track && screenAudioTracks.includes(s.track)) {
          pc.removeTrack(s);
        }
      });
    });

    // Now stop and clean up screen stream
    this.screenStream.getTracks().forEach(t => t.stop());
    this.screenStream = null;
    this.isSharingScreen = false;
    this.isVideoCall = this._originalIsVideoCall;
    this._participantsHidden = false;
    this._renderedScreenKey = null;
    this.showActiveCallScreen();

    // Signal to peers that screen sharing stopped
    if (this.callMode === 'group' && this.currentGroupId) {
      this.socket.emit('group-call:screen-share', { groupId: this.currentGroupId, sharing: false });
    } else if (this.callMode === 'dm' && this.currentContactId) {
      this.socket.emit('call:screen-share', { to: this.currentContactId, sharing: false });
    }

    if (typeof InnovateAPI !== 'undefined') InnovateAPI.showAlert('Screen sharing stopped', 'success');
  }

  // ===================== ADD MEMBER (DM → Multi) =====================

  async showAddMemberModal() {
    try {
      const token = InnovateAPI.getToken();
      const user = InnovateAPI.getCurrentUser();
      // Fetch from both conversations and followers/following for full contact list
      const [convRes, followRes] = await Promise.all([
        fetch('/api/messages/conversations', { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`/api/users/${user.id}/following`, { headers: { 'Authorization': `Bearer ${token}` } }).catch(() => null)
      ]);
      const convData = await convRes.json();
      let contacts = (convData.conversations || convData || []).filter(c => c.contact_id !== this.currentContactId);
      // Merge in followed users if available
      if (followRes && followRes.ok) {
        try {
          const followData = await followRes.json();
          const followList = followData.following || followData.users || followData || [];
          const existingIds = new Set(contacts.map(c => c.contact_id));
          followList.forEach(f => {
            const fId = f.id || f.user_id || f.contact_id;
            if (fId && !existingIds.has(fId) && fId !== this.currentContactId) {
              contacts.push({ contact_id: fId, username: f.username, profile_picture: f.profile_picture });
              existingIds.add(fId);
            }
          });
        } catch (_) {}
      }

      this._addMemberContacts = contacts;

      // Remove any existing modal
      const existing = document.getElementById('waAddMemberModal');
      if (existing) existing.remove();

      // Create modal inside the call modal so it shares the same stacking context
      const addModal = document.createElement('div');
      addModal.id = 'waAddMemberModal';
      addModal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:100001;background:rgba(0,0,0,0.7);display:flex;align-items:flex-end;justify-content:center;';
      addModal.onclick = (e) => { if (e.target === addModal) addModal.remove(); };
      addModal.innerHTML = `
        <div style="background:#1a1a2e;border-radius:16px 16px 0 0;width:100%;max-width:420px;max-height:70vh;display:flex;flex-direction:column;position:relative;z-index:100002;">
          <div style="padding:16px;border-bottom:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:space-between;">
            <h3 style="margin:0;color:#fff;font-size:17px;">Add to Call</h3>
            <button onclick="document.getElementById('waAddMemberModal').remove()" style="background:none;border:none;color:#a8a8a8;font-size:24px;cursor:pointer;line-height:1;">✕</button>
          </div>
          <div style="padding:8px 16px;">
            <div style="display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.08);border-radius:10px;padding:8px 12px;">
              <svg fill="none" viewBox="0 0 24 24" stroke="#a8a8a8" stroke-width="2" width="18" height="18"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35" stroke-linecap="round"/></svg>
              <input type="text" id="waAddMemberSearch" placeholder="Search contacts..." style="background:none;border:none;outline:none;color:#fff;font-size:14px;width:100%;" />
            </div>
          </div>
          <div id="waAddMemberList" style="flex:1;overflow-y:auto;padding:4px 0;max-height:50vh;">
            ${this._renderContactList(contacts)}
          </div>
        </div>`;
      // Append inside the call modal overlay for proper stacking
      const callModal = this._getModal();
      callModal.appendChild(addModal);

      // Wire up search with proper event listener
      const searchInput = document.getElementById('waAddMemberSearch');
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          callManager._filterAddMembers(e.target.value);
        });
        setTimeout(() => searchInput.focus(), 100);
      }
    } catch (err) {
      console.error('Failed to load contacts:', err);
      if (typeof InnovateAPI !== 'undefined') InnovateAPI.showAlert('Failed to load contacts', 'error');
    }
  }

  _renderContactList(contacts) {
    if (!contacts || !contacts.length) {
      return '<div style="text-align:center;padding:30px;color:#a8a8a8;">No contacts found</div>';
    }
    return contacts.map(c => {
      const safeUsername = (c.username || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
      return `
      <div onclick="callManager.addMemberToCall(${c.contact_id}, '${safeUsername}')" style="display:flex;align-items:center;gap:12px;padding:10px 16px;cursor:pointer;transition:background 0.15s;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='none'">
        <img src="${c.profile_picture || '/images/default-avatar.svg'}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;" onerror="this.src='/images/default-avatar.svg'" />
        <div style="flex:1;"><div style="font-size:15px;font-weight:500;color:#fff;">${c.username || ''}</div></div>
        <div style="width:36px;height:36px;border-radius:50%;background:rgba(0,149,246,0.2);display:flex;align-items:center;justify-content:center;">
          <svg fill="none" viewBox="0 0 24 24" stroke="#0095f6" stroke-width="2" width="18" height="18"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
      </div>`;
    }).join('');
  }

  _filterAddMembers(query) {
    const q = (query || '').toLowerCase().trim();
    const contacts = this._addMemberContacts || [];
    const filtered = q ? contacts.filter(c => (c.username || '').toLowerCase().includes(q)) : contacts;
    const list = document.getElementById('waAddMemberList');
    if (!list) return;
    list.innerHTML = this._renderContactList(filtered);
  }

  async addMemberToCall(contactId, username) {
    const addModal = document.getElementById('waAddMemberModal');
    if (addModal) addModal.remove();

    const user = InnovateAPI.getCurrentUser();

    try {
      // For group calls, invite the member to join the existing group call
      if (this.callMode === 'group' && this.currentGroupId) {
        // Emit a ring to the specific user for the group call
        this.socket.emit('call:initiate', {
          to: contactId,
          from: user.id,
          offer: null,
          isVideo: this.isVideoCall,
          caller: { username: user.username, profile_picture: user.profile_picture },
          isGroupAdd: true,
          groupId: this.currentGroupId
        });
        if (typeof InnovateAPI !== 'undefined') InnovateAPI.showAlert(`Calling ${username}...`, 'info');
        return;
      }

      // For DM calls, create a separate peer connection to the new member
      const pc = new RTCPeerConnection(this.iceConfig);

      if (this.localStream) {
        this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream));
      }

      pc.ontrack = (event) => {
        const stream = event.streams[0] || new MediaStream([event.track]);
        // Play audio from added member
        const audio = document.createElement('audio');
        audio.autoplay = true;
        audio.srcObject = stream;
        audio.id = `waAddedMemberAudio-${contactId}`;
        document.body.appendChild(audio);
        
        // If video track, show it
        if (event.track.kind === 'video') {
          const remoteVid = document.getElementById('waRemoteVideo');
          if (remoteVid) {
            remoteVid.srcObject = stream;
            remoteVid.play().catch(() => {});
          }
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          this.socket.emit('call:add-member-ice', {
            to: contactId,
            candidate: event.candidate,
            fromUserId: user.id
          });
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      this.peers.set(`added-${contactId}`, pc);
      this.participants.set(contactId, { username, profile_picture: null });

      this.socket.emit('call:initiate', {
        to: contactId,
        from: user.id,
        offer: offer,
        isVideo: this.isVideoCall,
        caller: { username: user.username, profile_picture: user.profile_picture },
        isGroupAdd: true
      });

      if (typeof InnovateAPI !== 'undefined') InnovateAPI.showAlert(`Calling ${username}...`, 'info');
    } catch (err) {
      console.error('addMemberToCall error:', err);
      if (typeof InnovateAPI !== 'undefined') InnovateAPI.showAlert('Failed to add member', 'error');
    }
  }

  // ===================== CALL HISTORY LOGGING =====================

  async _logCallStart(callType, targetId, isVideo) {
    try {
      const token = InnovateAPI.getToken();
      const res = await fetch('/api/calls/log-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ callType, targetId, isVideo })
      });
      const data = await res.json();
      if (data.callId) this.currentCallId = data.callId;
    } catch (err) {
      console.error('Failed to log call start:', err);
    }
  }

  async _logCallEnd(status) {
    if (!this.currentCallId) return;
    try {
      const token = InnovateAPI.getToken();
      const duration = this.callStartTime ? Math.floor((Date.now() - this.callStartTime) / 1000) : 0;
      await fetch('/api/calls/log-end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ callId: this.currentCallId, status, duration })
      });
    } catch (err) {
      console.error('Failed to log call end:', err);
    }
  }

  async _apiPost(url, body) {
    try {
      const token = InnovateAPI.getToken();
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(body)
      });
    } catch (_) {}
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
      return '\u{1F512} Encrypted message';
    } catch (e) {
      return '\u{1F512} Encrypted message';
    }
  }
};

// Initialize global instance
const callManager = new UnifiedCallManager();
window.callManager = callManager;
window.DMEncryption = DMEncryption;

// Auto-init: detect socket and connect call manager on any page
(function _autoInitCallManager() {
  if (callManager._autoInitDone) return;
  function tryInit() {
    if (callManager._autoInitDone) return;
    if (typeof InnovateAPI === 'undefined' || typeof InnovateAPI.getSocket !== 'function') return;
    const socket = InnovateAPI.getSocket();
    if (!socket) return;
    callManager._autoInitDone = true;
    // Ensure waCallModal div exists
    if (!document.getElementById('waCallModal')) {
      const div = document.createElement('div');
      div.id = 'waCallModal';
      div.style.display = 'none';
      document.body.appendChild(div);
    }
    // Only setup if not already done (messages.html calls setupSocketListeners manually)
    if (!callManager.socket) {
      callManager.setupSocketListeners(socket);
    }
  }
  // Try immediately, then retry a few times for pages where socket connects later
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { tryInit(); setTimeout(tryInit, 1000); setTimeout(tryInit, 3000); });
  } else {
    tryInit();
    setTimeout(tryInit, 1000);
    setTimeout(tryInit, 3000);
  }
})();
