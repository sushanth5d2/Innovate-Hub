/**
 * Group Voice/Video Call Manager with Screen Sharing
 * WebRTC-based mesh network for group calls
 */

class GroupCallManager {
  constructor(groupId, socket) {
    this.groupId = groupId;
    this.socket = socket;
    this.peers = new Map(); // Map of socketId -> RTCPeerConnection
    this.localStream = null;
    this.screenStream = null;
    this.localVideoElement = null;
    this.isCallActive = false;
    this.isMuted = false;
    this.isCameraOff = false;
    this.isSharingScreen = false;
    this.isAudioOnly = false;
    
    this.setupSocketListeners();
  }

  // Setup Socket.IO listeners for signaling
  setupSocketListeners() {
    // Receive list of current peers in call
    this.socket.on('group-call:peers', (data) => {
      console.log('Current peers in call:', data.peers);
      data.peers.forEach(peer => {
        this.createPeerConnection(peer.socketId, peer.userId, peer.displayName, true);
      });
    });

    // New peer joined the call
    this.socket.on('group-call:peer-joined', (data) => {
      console.log('New peer joined:', data.peer);
      this.createPeerConnection(data.peer.socketId, data.peer.userId, data.peer.displayName, false);
      this.updateParticipantsList();
    });

    // Receive signaling data (offer/answer/ice)
    this.socket.on('group-call:signal', async (data) => {
      const { from, payload } = data;
      const pc = this.peers.get(from);
      
      if (!pc) return;

      try {
        if (payload.type === 'offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(payload));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          
          this.socket.emit('group-call:signal', {
            groupId: this.groupId,
            to: from,
            payload: answer
          });
        } else if (payload.type === 'answer') {
          await pc.setRemoteDescription(new RTCSessionDescription(payload));
        } else if (payload.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        }
      } catch (error) {
        console.error('Error handling signal:', error);
      }
    });

    // Peer left the call
    this.socket.on('group-call:peer-left', (data) => {
      console.log('Peer left:', data.socketId);
      this.removePeer(data.socketId);
      this.updateParticipantsList();
    });
  }

  // Start a call (audio-only or video)
  async startCall(audioOnly = false) {
    this.isAudioOnly = audioOnly;
    
    try {
      // Get local media stream
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: audioOnly ? false : {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        }
      });

      // Display local stream
      this.displayLocalStream();

      // Join call room via Socket.IO
      const currentUser = InnovateAPI.getCurrentUser();
      this.socket.emit('group-call:join', {
        groupId: this.groupId,
        userId: currentUser.id,
        displayName: currentUser.username || currentUser.fullname || 'User'
      });

      this.isCallActive = true;
      this.showCallUI();
      
      console.log('Call started successfully');
    } catch (error) {
      console.error('Error starting call:', error);
      InnovateAPI.showAlert('Failed to access camera/microphone. Please check permissions.', 'error');
      throw error;
    }
  }

  // Create peer connection for a remote user
  createPeerConnection(socketId, userId, displayName, initiator) {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    // Add local stream tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }

    // Handle incoming remote stream
    pc.ontrack = (event) => {
      console.log('Received remote track from', socketId);
      this.displayRemoteStream(socketId, displayName, event.streams[0]);
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('group-call:signal', {
          groupId: this.groupId,
          to: socketId,
          payload: { candidate: event.candidate }
        });
      }
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      console.log(`Peer ${socketId} connection state:`, pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.removePeer(socketId);
      }
    };

    this.peers.set(socketId, pc);

    // If initiator, create and send offer
    if (initiator) {
      this.createOffer(socketId, pc);
    }

    return pc;
  }

  // Create and send offer
  async createOffer(socketId, pc) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      this.socket.emit('group-call:signal', {
        groupId: this.groupId,
        to: socketId,
        payload: offer
      });
    } catch (error) {
      console.error('Error creating offer:', error);
    }
  }

  // Display local video stream
  displayLocalStream() {
    const videoGrid = document.getElementById('video-grid');
    if (!videoGrid) return;

    let localVideoContainer = document.getElementById('local-video-container');
    
    if (!localVideoContainer) {
      localVideoContainer = document.createElement('div');
      localVideoContainer.id = 'local-video-container';
      localVideoContainer.className = 'video-container';
      localVideoContainer.innerHTML = `
        <video id="local-video" autoplay muted playsinline></video>
        <div class="video-overlay">
          <span class="video-name">You</span>
        </div>
      `;
      videoGrid.appendChild(localVideoContainer);
    }

    this.localVideoElement = document.getElementById('local-video');
    this.localVideoElement.srcObject = this.localStream;
    
    // If audio-only, hide video
    if (this.isAudioOnly) {
      this.localVideoElement.style.display = 'none';
      localVideoContainer.classList.add('audio-only');
    }
  }

  // Display remote video stream
  displayRemoteStream(socketId, displayName, stream) {
    const videoGrid = document.getElementById('video-grid');
    if (!videoGrid) return;

    let remoteVideoContainer = document.getElementById(`remote-${socketId}`);
    
    if (!remoteVideoContainer) {
      remoteVideoContainer = document.createElement('div');
      remoteVideoContainer.id = `remote-${socketId}`;
      remoteVideoContainer.className = 'video-container';
      remoteVideoContainer.innerHTML = `
        <video autoplay playsinline></video>
        <div class="video-overlay">
          <span class="video-name">${displayName}</span>
        </div>
      `;
      videoGrid.appendChild(remoteVideoContainer);
    }

    const video = remoteVideoContainer.querySelector('video');
    video.srcObject = stream;
    
    // If audio-only call, hide video
    if (this.isAudioOnly) {
      video.style.display = 'none';
      remoteVideoContainer.classList.add('audio-only');
    }
  }

  // Remove peer and cleanup
  removePeer(socketId) {
    const pc = this.peers.get(socketId);
    if (pc) {
      pc.close();
      this.peers.delete(socketId);
    }

    const videoContainer = document.getElementById(`remote-${socketId}`);
    if (videoContainer) {
      videoContainer.remove();
    }
  }

  // Toggle microphone mute
  toggleMic() {
    if (!this.localStream) return;

    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      this.isMuted = !audioTrack.enabled;
      
      const micBtn = document.getElementById('toggle-mic');
      if (micBtn) {
        micBtn.innerHTML = this.isMuted ? '🔇' : '🎤';
        micBtn.classList.toggle('muted', this.isMuted);
      }
    }
  }

  // Toggle camera on/off
  toggleCamera() {
    if (!this.localStream || this.isAudioOnly) return;

    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      this.isCameraOff = !videoTrack.enabled;
      
      const cameraBtn = document.getElementById('toggle-camera');
      if (cameraBtn) {
        cameraBtn.innerHTML = this.isCameraOff ? '📹❌' : '📹';
        cameraBtn.classList.toggle('camera-off', this.isCameraOff);
      }

      if (this.localVideoElement) {
        this.localVideoElement.style.display = videoTrack.enabled ? 'block' : 'none';
      }
    }
  }

  // Share screen
  async shareScreen() {
    if (this.isSharingScreen) {
      this.stopScreenShare();
      return;
    }

    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always'
        },
        audio: false
      });

      const screenTrack = this.screenStream.getVideoTracks()[0];

      // Replace video track in all peer connections
      this.peers.forEach((pc) => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
          sender.replaceTrack(screenTrack);
        }
      });

      // Update local video to show screen
      if (this.localVideoElement) {
        this.localVideoElement.srcObject = this.screenStream;
      }

      // Handle screen share stop
      screenTrack.onended = () => {
        this.stopScreenShare();
      };

      this.isSharingScreen = true;
      const screenBtn = document.getElementById('share-screen');
      if (screenBtn) {
        screenBtn.innerHTML = '🖥️ Stop Sharing';
        screenBtn.classList.add('sharing');
      }

      InnovateAPI.showAlert('Screen sharing started', 'success');
    } catch (error) {
      console.error('Error sharing screen:', error);
      InnovateAPI.showAlert('Failed to share screen', 'error');
    }
  }

  // Stop screen sharing
  stopScreenShare() {
    if (!this.screenStream) return;

    const screenTrack = this.screenStream.getVideoTracks()[0];
    screenTrack.stop();

    // Switch back to camera
    if (this.localStream) {
      const cameraTrack = this.localStream.getVideoTracks()[0];
      
      this.peers.forEach((pc) => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender && cameraTrack) {
          sender.replaceTrack(cameraTrack);
        }
      });

      if (this.localVideoElement) {
        this.localVideoElement.srcObject = this.localStream;
      }
    }

    this.screenStream = null;
    this.isSharingScreen = false;

    const screenBtn = document.getElementById('share-screen');
    if (screenBtn) {
      screenBtn.innerHTML = '🖥️ Share Screen';
      screenBtn.classList.remove('sharing');
    }

    InnovateAPI.showAlert('Screen sharing stopped', 'success');
  }

  // End call
  endCall() {
    // Stop all tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    if (this.screenStream) {
      this.screenStream.getTracks().forEach(track => track.stop());
      this.screenStream = null;
    }

    // Close all peer connections
    this.peers.forEach((pc) => {
      pc.close();
    });
    this.peers.clear();

    // Leave call room
    this.socket.emit('group-call:leave', {
      groupId: this.groupId
    });

    this.isCallActive = false;
    this.hideCallUI();

    InnovateAPI.showAlert('Call ended', 'success');
  }

  // Show call UI
  showCallUI() {
    const callContainer = document.getElementById('call-container');
    const feedContent = document.getElementById('feed-content');
    
    if (callContainer) {
      callContainer.style.display = 'flex';
    }
    
    if (feedContent) {
      feedContent.style.display = 'none';
    }
  }

  // Hide call UI
  hideCallUI() {
    const callContainer = document.getElementById('call-container');
    const feedContent = document.getElementById('feed-content');
    const videoGrid = document.getElementById('video-grid');
    
    if (callContainer) {
      callContainer.style.display = 'none';
    }
    
    if (feedContent) {
      feedContent.style.display = 'block';
    }
    
    if (videoGrid) {
      videoGrid.innerHTML = '';
    }
  }

  // Update participants list
  updateParticipantsList() {
    const participantsList = document.getElementById('participants-list');
    if (!participantsList) return;

    const count = this.peers.size + 1; // +1 for local user
    participantsList.innerHTML = `
      <div style="padding: 16px; border-bottom: 1px solid var(--ig-border);">
        <h4 style="margin: 0 0 12px 0; font-size: 14px;">Participants (${count})</h4>
      </div>
      <div style="padding: 12px;">
        <div style="padding: 8px; margin-bottom: 4px; border-radius: 6px; background: var(--ig-hover);">
          <strong>You</strong> (Host)
        </div>
        ${Array.from(this.peers.keys()).map((socketId, i) => `
          <div style="padding: 8px; margin-bottom: 4px; border-radius: 6px;">
            Participant ${i + 1}
          </div>
        `).join('')}
      </div>
    `;
  }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GroupCallManager;
}
