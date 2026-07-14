// ---------------------------------------------------------------------------
// Popcornn — WebRTC peer connection manager
// ---------------------------------------------------------------------------
// Implements:
//   - PeerManager class managing RTCPeerConnections for a WebRTC mesh
//   - Perfect negotiation pattern with polite/impolite roles
//   - Symmetric track attachment & media propagation
//   - Screen share: additive track alongside camera/mic, not a replacement
// ---------------------------------------------------------------------------

export class PeerManager {
  constructor({ localSocketId, onSignal, onStream, onStreamRemove, onScreenStream, onScreenShareStop }) {
    this.localSocketId = localSocketId;
    this.onSignal = onSignal;
    this.onStream = onStream;
    this.onStreamRemove = onStreamRemove;
    this.onScreenStream = onScreenStream || (() => {});
    // Called when the browser's native "Stop sharing" ends the share
    this.onScreenShareStop = onScreenShareStop || (() => {});
    this.peers = new Map(); // remotePeerId -> { pc, polite, makingOffer, ignoreOffer }
    this.localStream = null;
    // Screen share state
    this.screenStream = null;
    this.screenSenders = new Map(); // remotePeerId -> RTCRtpSender
    // Stream ID registered via screen-share-started signal, used to deterministically
    // identify the screen track in ontrack without relying on contentHint or label.
    this.expectedScreenStreamIds = new Map(); // remotePeerId -> streamId
  }

  /**
   * Register the expected screen stream ID for a remote peer.
   * Called when a screen-share-started socket event is received,
   * before the WebRTC track arrives via ontrack.
   * @param {string} remotePeerId
   * @param {string} streamId — MediaStream.id of the sharer's screen capture
   */
  setExpectedScreenStreamId(remotePeerId, streamId) {
    this.expectedScreenStreamIds.set(remotePeerId, streamId);
  }

  /**
   * Set the local media stream. Attach tracks to all existing peer connections.
   * @param {MediaStream} stream
   */
  setLocalStream(stream) {
    this.localStream = stream;
    for (const [, peerState] of this.peers.entries()) {
      const pc = peerState.pc;
      stream.getTracks().forEach((track) => {
        const senders = pc.getSenders();
        const hasTrack = senders.some((s) => s.track === track);
        if (!hasTrack) {
          pc.addTrack(track, stream);
        }
      });
    }
  }

  /**
   * Add a remote peer to track. Creates connection and attaches tracks.
   * @param {string} remotePeerId
   */
  addPeer(remotePeerId) {
    if (this.peers.has(remotePeerId)) {
      return this.peers.get(remotePeerId);
    }

    const config = {
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    };

    const pc = new RTCPeerConnection(config);
    // Politeness: lexicographically smaller socket ID is polite
    const polite = this.localSocketId < remotePeerId;

    const peerState = {
      pc,
      polite,
      makingOffer: false,
      ignoreOffer: false,
      remotePeerId,
    };

    this.peers.set(remotePeerId, peerState);

    // 1. Symmetrical track attachment: immediately add tracks if localStream is ready
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localStream);
      });
    }

    // 1b. If a screen share is currently active, add the screen track too
    if (this.screenStream) {
      const screenTrack = this.screenStream.getVideoTracks()[0];
      if (screenTrack) {
        const sender = pc.addTrack(screenTrack, this.screenStream);
        this.screenSenders.set(remotePeerId, sender);
      }
    }

    // 2. Handle ICE candidate discovery
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.onSignal(remotePeerId, { candidate: event.candidate });
      }
    };

    // 3. Receive remote media tracks — identify screen tracks by stream ID first,
    //    falling back to label regex if no expected ID has been registered.
    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        const stream = event.streams[0];
        const expectedId = this.expectedScreenStreamIds.get(remotePeerId);

        // Primary: deterministic match via stream.id from screen-share-started signal
        const matchedById = expectedId && stream.id === expectedId;
        // Fallback: OS/browser label heuristic (unreliable, varies by platform)
        const matchedByLabel =
          !expectedId &&
          /screen|monitor|window|display/i.test(
            stream.getVideoTracks()[0]?.label || ""
          );

        const isScreenTrack = matchedById || matchedByLabel;

        if (isScreenTrack) {
          // Consume the registered ID — it's a one-shot expectation per share
          if (matchedById) this.expectedScreenStreamIds.delete(remotePeerId);
          this.onScreenStream(remotePeerId, stream);
        } else {
          this.onStream(remotePeerId, stream);
        }
      }
    };

    // 4. Perfect negotiation: onnegotiationneeded
    pc.onnegotiationneeded = async () => {
      try {
        peerState.makingOffer = true;
        await pc.setLocalDescription();
        this.onSignal(remotePeerId, { sdp: pc.localDescription });
      } catch (err) {
        console.error(`[webrtc] Negotiation failed for ${remotePeerId}:`, err);
      } finally {
        peerState.makingOffer = false;
      }
    };

    // 5. Connection state monitoring
    pc.onconnectionstatechange = () => {
      console.log(`[webrtc] Connection state to ${remotePeerId} changed to: ${pc.connectionState}`);
    };

    return peerState;
  }

  /**
   * Remove a remote peer and close its peer connection.
   * @param {string} remotePeerId
   */
  removePeer(remotePeerId) {
    const peerState = this.peers.get(remotePeerId);
    if (peerState) {
      try {
        peerState.pc.close();
      } catch (err) {
        console.error(`[webrtc] Error closing PC for ${remotePeerId}:`, err);
      }
      this.peers.delete(remotePeerId);
    }
    this.screenSenders.delete(remotePeerId);
    this.onStreamRemove(remotePeerId);
  }

  /**
   * Handle incoming signaling messages (SDP or ICE candidates).
   * @param {string} remotePeerId
   * @param {object} data
   */
  async handleSignal(remotePeerId, data) {
    let peerState = this.peers.get(remotePeerId);
    if (!peerState) {
      peerState = this.addPeer(remotePeerId);
    }

    const { pc, polite } = peerState;

    try {
      if (data.sdp) {
        const description = data.sdp;
        const offerCollision =
          description.type === "offer" &&
          (peerState.makingOffer || pc.signalingState !== "stable");

        peerState.ignoreOffer = !polite && offerCollision;
        if (peerState.ignoreOffer) {
          console.log(`[webrtc] Collision: Ignoring impolite offer from ${remotePeerId}`);
          return;
        }

        await pc.setRemoteDescription(description);

        if (description.type === "offer") {
          await pc.setLocalDescription();
          this.onSignal(remotePeerId, { sdp: pc.localDescription });
        }
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (err) {
          // Swallow candidates only if we are ignoring the offer
          if (!peerState.ignoreOffer) {
            throw err;
          }
        }
      }
    } catch (err) {
      console.error(`[webrtc] Error handling signal from ${remotePeerId}:`, err);
    }
  }

  // ── Screen Share ──────────────────────────────────────────────────────────

  /**
   * Start screen sharing. Adds the screen track to all existing peer connections
   * as an additional track (camera/mic remain active). If the user stops sharing
   * via the browser's native UI, stopScreenShare() is called automatically.
   * @returns {Promise<MediaStream>} the captured screen stream
   */
  async startScreenShare() {
    if (this.screenStream) {
      console.warn("[webrtc] Screen share already active");
      return this.screenStream;
    }

    const screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: 1920, height: 1080, frameRate: 60 },
    });

    this.screenStream = screenStream;

    const screenTrack = screenStream.getVideoTracks()[0];

    // When the user clicks the browser's native "Stop sharing" button
    screenTrack.addEventListener("ended", () => {
      console.log("[webrtc] Screen share ended by browser native UI");
      this.stopScreenShare();
      this.onScreenShareStop();
    });

    // Add the screen track to every existing peer connection
    for (const [remotePeerId, peerState] of this.peers.entries()) {
      const sender = peerState.pc.addTrack(screenTrack, screenStream);
      this.screenSenders.set(remotePeerId, sender);
    }

    console.log("[webrtc] Screen share started");
    return screenStream;
  }

  /**
   * Stop screen sharing. Removes screen track senders from all peer connections
   * and stops the screen stream's tracks.
   */
  stopScreenShare() {
    if (!this.screenStream) return;

    // Remove the screen track sender from every peer connection
    for (const [remotePeerId, sender] of this.screenSenders.entries()) {
      const peerState = this.peers.get(remotePeerId);
      if (peerState) {
        try {
          peerState.pc.removeTrack(sender);
        } catch (err) {
          console.error(`[webrtc] Error removing screen track for ${remotePeerId}:`, err);
        }
      }
    }
    this.screenSenders.clear();

    // Stop the actual screen capture tracks
    this.screenStream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch (err) {
        console.error("[webrtc] Error stopping screen track:", err);
      }
    });

    this.screenStream = null;
    console.log("[webrtc] Screen share stopped");
  }

  /**
   * Clean up all active connections and stop local media tracks.
   */
  closeAll() {
    // Stop any active screen share first
    this.stopScreenShare();

    for (const [remotePeerId, peerState] of this.peers.entries()) {
      try {
        peerState.pc.close();
      } catch (err) {
        console.error(`[webrtc] Error closing PC for ${remotePeerId}:`, err);
      }
      this.onStreamRemove(remotePeerId);
    }
    this.peers.clear();

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (err) {
          console.error("[webrtc] Error stopping track:", err);
        }
      });
      this.localStream = null;
    }
  }
}
