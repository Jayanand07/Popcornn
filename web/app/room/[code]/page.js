"use client";

import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import {
  getSocket,
  connectSocket,
  emitJoinRoom,
  emitLeaveRoom,
  disconnectSocket,
  getLastJoinResult,
  clearLastJoinResult,
} from "@/lib/socket";
import { PeerManager } from "@/lib/webrtc";
import VideoGrid from "@/components/VideoGrid";
import Controls from "@/components/Controls";
import Chat from "@/components/Chat";
import styles from "./room.module.css";

function RoomContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const urlCode = params.code; // code from route params
  const searchName = searchParams.get("name") || "";

  // ── State ──────────────────────────────────────────────────────────────
  const [roomCode, setRoomCode] = useState(urlCode);
  const [displayName, setDisplayName] = useState("");
  const [peers, setPeers] = useState([]); // [{ peerId, name }]
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [localScreenStream, setLocalScreenStream] = useState(null);
  const [remoteScreenStreams, setRemoteScreenStreams] = useState({}); // { [peerId]: MediaStream }
  // Chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [unreadChat, setUnreadChat] = useState(false);
  const [messages, setMessages] = useState([]);
  const [localSocketId, setLocalSocketId] = useState("");
  const chatOpenRef = useRef(false);
  const hasJoined = useRef(false);
  const peerManagerRef = useRef(null);

  // ── Connect socket + create/join room on mount ─────────────────────────
  useEffect(() => {
    let active = true;
    const cached = getLastJoinResult();
    const finalName = cached?.name || searchName;

    // 2. If name is missing, redirect back to landing page
    if (!finalName || !finalName.trim()) {
      router.push("/");
      return;
    }

    if (hasJoined.current) return;
    hasJoined.current = true;

    setDisplayName(finalName.trim());

    const setup = async () => {
      try {
        const socket = await connectSocket();
        if (!active) return;

        setLocalSocketId(socket.id);

        // 1. Get user media stream first before establishing connection (guarantees tracks exist)
        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 1920, height: 1080, frameRate: 60 },
            audio: true,
          });
          if (active) {
            setLocalStream(stream);
          }
        } catch (mediaErr) {
          console.error("Camera/microphone access failed:", mediaErr);
          if (active) {
            const isMockMode =
              typeof window !== "undefined" &&
              (window.location.search.includes("mock=true") ||
                window.__IS_TEST_ENVIRONMENT__ ||
                navigator.webdriver ||
                process.env.NEXT_PUBLIC_IS_TESTING === "true");

            if (isMockMode) {
              console.warn("Falling back to mock stream for testing/headless execution.");
              try {
                // Create a mock canvas stream with visual labels
                const canvas = document.createElement("canvas");
                canvas.width = 640;
                canvas.height = 480;
                const ctx = canvas.getContext("2d");

                ctx.fillStyle = "#121215";
                ctx.fillRect(0, 0, 640, 480);
                ctx.fillStyle = "#ffc107";
                ctx.font = "28px var(--font-sans), sans-serif";
                ctx.fillText("🍿 Popcornn Live (Mock)", 80, 150);
                ctx.fillStyle = "#a0a0a8";
                ctx.font = "20px var(--font-sans), sans-serif";
                ctx.fillText(finalName.trim(), 80, 200);
                ctx.fillText("(Mock Camera Feed)", 80, 240);

                // Add a subtle animation to simulate camera active states
                let frame = 0;
                const animate = () => {
                  if (!active) return;
                  ctx.fillStyle = "#121215";
                  ctx.fillRect(80, 280, 160, 40);
                  ctx.fillStyle = "#4caf50";
                  ctx.beginPath();
                  ctx.arc(100 + Math.cos(frame * 0.1) * 20, 300, 8, 0, Math.PI * 2);
                  ctx.fill();
                  frame++;
                  requestAnimationFrame(animate);
                };
                animate();

                const videoTrack = canvas.captureStream(30).getVideoTracks()[0];

                // Create a mock silent audio track using Web Audio API
                const audioContext = new (window.AudioContext ||
                  window.webkitAudioContext)();
                const oscillator = audioContext.createOscillator();
                const dst = oscillator.createMediaStreamDestination
                  ? oscillator.createMediaStreamDestination()
                  : audioContext.createMediaStreamDestination();
                oscillator.connect(dst);
                oscillator.start();
                const audioTrack = dst.stream.getAudioTracks()[0];

                stream = new MediaStream([videoTrack, audioTrack]);
                setLocalStream(stream);
              } catch (fallbackErr) {
                console.error("Mock fallback failed:", fallbackErr);
                setError(
                  "Camera and microphone access is required to join the watch party. Please grant permissions and reload."
                );
                return;
              }
            } else {
              // Real browser user: show inline warning, don't bypass with fake stream
              setError(
                "Camera and microphone access is required to join the watch party. Please grant permissions and reload."
              );
              return;
            }
          }
        }

        // Initialize PeerManager with callbacks
        const pm = new PeerManager({
          localSocketId: socket.id,
          onSignal: (to, data) => {
            socket.emit("signal", { to, data });
          },
          onStream: (peerId, remoteStream) => {
            if (active) {
              setRemoteStreams((prev) => ({ ...prev, [peerId]: remoteStream }));
            }
          },
          onStreamRemove: (peerId) => {
            if (active) {
              setRemoteStreams((prev) => {
                const next = { ...prev };
                delete next[peerId];
                return next;
              });
            }
          },
          // Called when a remote peer's screen share track arrives via WebRTC
          onScreenStream: (peerId, screenStream) => {
            if (active) {
              setRemoteScreenStreams((prev) => ({ ...prev, [peerId]: screenStream }));
            }
          },
          // Called when browser's native "Stop sharing" button ends the share
          onScreenShareStop: () => {
            if (active) {
              setIsScreenSharing(false);
              setLocalScreenStream(null);
              socket.emit("screen-share-stopped");
            }
          },
        });
        pm.setLocalStream(stream);
        peerManagerRef.current = pm;

        let initialPeers = [];

        // 2. Consume cached lastJoinResult or join room
        if (cached && cached.code === urlCode) {
          setPeers(cached.peers || []);
          setJoined(true);
          initialPeers = cached.peers || [];
          clearLastJoinResult();

          // Still emit join-room in the background to register our new socket ID
          emitJoinRoom(urlCode, finalName.trim()).catch((err) => {
            console.error("Background join registration failed:", err);
          });
        } else {
          // Fallback: ONLY join-room with the code from route params
          const result = await emitJoinRoom(urlCode, finalName.trim());
          if (!active) return;
          setPeers(result.peers || []);
          setJoined(true);
          initialPeers = result.peers || [];
        }

        // 3. Symmetrically add peer connections for all existing peers
        initialPeers.forEach((p) => {
          pm.addPeer(p.peerId);
        });

        // ── Socket event listeners ──────────────────────────────────────
        socket.on("peer-joined", ({ peerId, name: peerName }) => {
          if (!active) return;
          setPeers((prev) => {
            if (prev.some((p) => p.peerId === peerId)) return prev;
            return [...prev, { peerId, name: peerName }];
          });
          if (peerManagerRef.current) {
            peerManagerRef.current.addPeer(peerId);
          }
        });

        socket.on("peer-left", ({ peerId }) => {
          if (!active) return;
          setPeers((prev) => prev.filter((p) => p.peerId !== peerId));
          if (peerManagerRef.current) {
            peerManagerRef.current.removePeer(peerId);
          }
        });

        socket.on("signal", ({ from, data }) => {
          if (!active) return;
          if (peerManagerRef.current) {
            peerManagerRef.current.handleSignal(from, data);
          }
        });

        // Screen share signaling — a lightweight broadcast from the sharer
        socket.on("screen-share-started", ({ from, screenStreamId }) => {
          if (!active) return;
          // Register the expected stream ID with PeerManager so ontrack can
          // deterministically classify the incoming track without guessing.
          if (peerManagerRef.current && screenStreamId) {
            peerManagerRef.current.setExpectedScreenStreamId(from, screenStreamId);
          }
          // Pre-populate remoteScreenStreams so VideoGrid renders the featured tile
          // as soon as the stream arrives via ontrack (via onScreenStream callback).
          setRemoteScreenStreams((prev) => ({ ...prev, [from]: null }));
        });

        socket.on("screen-share-stopped", ({ from }) => {
          if (!active) return;
          setRemoteScreenStreams((prev) => {
            const next = { ...prev };
            delete next[from];
            return next;
          });
        });

        // Chat message listener
        socket.on("chat-message", ({ senderId, text, senderName, timestamp }) => {
          if (!active) return;
          setMessages((prev) => [
            ...prev,
            {
              id: `${senderId}-${timestamp}-${Math.random()}`,
              senderId,
              senderName,
              text,
              timestamp,
            },
          ]);

          // Trigger unread dot if chat panel is closed
          if (!chatOpenRef.current) {
            setUnreadChat(true);
          }
        });
      } catch (err) {
        if (!active) return;
        setError(err.message || "Something went wrong");
      }
    };

    setup();

    // ── Cleanup on unmount (leaving the room page) ──────────────────────
    return () => {
      active = false;
      const s = getSocket();
      if (s) {
        s.off("peer-joined");
        s.off("peer-left");
        s.off("signal");
        s.off("screen-share-started");
        s.off("screen-share-stopped");
        s.off("chat-message");
      }
      if (peerManagerRef.current) {
        peerManagerRef.current.closeAll();
        peerManagerRef.current = null;
      }
      emitLeaveRoom();
      disconnectSocket();
      hasJoined.current = false;
    };
  }, [urlCode, searchName, router]); // eslint-disable-line react-hooks/exhaustive-deps
  // ^ Empty deps: we only want this to run once on mount. The ref guard
  // handles StrictMode double-mount. Values are captured in closure.

  // ── Leave handler ──────────────────────────────────────────────────────
  const handleLeave = useCallback(() => {
    emitLeaveRoom();
    disconnectSocket();
    router.push("/");
  }, [router]);

  // ── Copy code ──────────────────────────────────────────────────────────
  const copyCode = useCallback(() => {
    if (!roomCode) return;
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [roomCode]);

  const handleToggleAudio = useCallback(() => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setAudioEnabled(audioTrack.enabled);
      }
    }
  }, [localStream]);

  const handleToggleVideo = useCallback(() => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setVideoEnabled(videoTrack.enabled);
      }
    }
  }, [localStream]);

  // ── Screen share toggle ────────────────────────────────────────────────
  const handleToggleScreenShare = useCallback(async () => {
    const pm = peerManagerRef.current;
    if (!pm) return;

    if (isScreenSharing) {
      // Stop: remove track senders and stop the capture
      pm.stopScreenShare();
      setIsScreenSharing(false);
      setLocalScreenStream(null);
      const s = getSocket();
      if (s) s.emit("screen-share-stopped");
    } else {
      try {
        const screenStream = await pm.startScreenShare();
        setLocalScreenStream(screenStream);
        setIsScreenSharing(true);
        const s = getSocket();
        // Include the screen stream's .id so receiving peers can deterministically
        // match it in ontrack without relying on contentHint or label heuristics.
        if (s) s.emit("screen-share-started", { screenStreamId: screenStream.id });
      } catch (err) {
        if (err.name === "NotAllowedError" || err.name === "AbortError") {
          // User cancelled the picker — not an error, just a no-op
          console.log("[screen-share] User cancelled screen share picker");
        } else {
          console.error("[screen-share] Failed to start:", err);
        }
      }
    }
  }, [isScreenSharing]);

  // ── Chat handlers ──────────────────────────────────────────────────────
  const handleToggleChat = useCallback(() => {
    setChatOpen((prev) => {
      const next = !prev;
      chatOpenRef.current = next;
      if (next) {
        setUnreadChat(false); // clear unread state when opened
      }
      return next;
    });
  }, []);

  const handleSendMessage = useCallback((text) => {
    const s = getSocket();
    if (!s) return;
    s.emit("chat-message", { text, senderName: displayName });
  }, [displayName]);

  // ── Error state ────────────────────────────────────────────────────────
  if (error) {
    return (
      <main className={styles.main}>
        <div className={styles.stage}>
          <div className={`${styles.placeholder} glass animate-fade-in-scale`}>
            <div className={styles.placeholderIcon}>⚠️</div>
            <h2 className={styles.placeholderTitle}>Can't join room</h2>
            <p className={styles.placeholderText}>{error}</p>
            <button
              className="btn btn-primary"
              style={{ marginTop: 16 }}
              onClick={() => router.push("/")}
            >
              Back to home
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ── Loading state (host waiting for code) ──────────────────────────────
  const displayCode = roomCode || "…";
  const totalParticipants = peers.length + 1;

  return (
    <main className={styles.main}>
      <div className={styles.topBar}>
        <div className={styles.brandRow}>
          <span className={styles.logo}>🍿</span>
          <span className={styles.brandName}>Popcornn</span>
        </div>

        <div
          className={styles.roomCode}
          onClick={copyCode}
          title="Click to copy"
        >
          <span className={styles.codeLabel}>ROOM</span>
          <span className={styles.codeValue}>{displayCode}</span>
          <span className={styles.copyHint}>{copied ? "✓" : "📋"}</span>
        </div>

        <div className={styles.participantChip}>
          <span className={styles.participantDot} />
          <span className={styles.participantCount}>
            {totalParticipants} {totalParticipants === 1 ? "person" : "people"}
          </span>
        </div>
      </div>

      {/* ── Participant list ── */}
      <div className={styles.participantBar}>
        <div className={styles.participantList}>
          <span className={styles.participantTag}>
            <span
              className={styles.participantTagDot}
              style={{ background: "var(--amber-400)" }}
            />
            {displayName} (you)
          </span>
          {peers.map((p) => (
            <span key={p.peerId} className={styles.participantTag}>
              <span className={styles.participantTagDot} />
              {p.name}
            </span>
          ))}
          {totalParticipants > 5 && (
            <span className={styles.scaleWarning}>
              ℹ️ Video quality adapts automatically in larger rooms
            </span>
          )}
        </div>
      </div>

      {/* ── Main Area (Video Grid + Optional Chat Panel) ── */}
      <div className={styles.contentArea}>
        <div className={styles.stage}>
          {joined ? (
            <VideoGrid
              localStream={localStream}
              remoteStreams={remoteStreams}
              peers={peers}
              displayName={displayName}
              localScreenStream={localScreenStream}
              remoteScreenStreams={remoteScreenStreams}
            />
          ) : (
            <div className={`${styles.placeholder} glass`}>
              <p className={styles.placeholderText}>Connecting…</p>
            </div>
          )}
        </div>
        {chatOpen && (
          <Chat
            messages={messages}
            onSendMessage={handleSendMessage}
            localSocketId={localSocketId}
            displayName={displayName}
          />
        )}
      </div>

      {/* ── Controls ── */}
      <Controls
        audioEnabled={audioEnabled}
        videoEnabled={videoEnabled}
        isScreenSharing={isScreenSharing}
        chatOpen={chatOpen}
        unreadChat={unreadChat}
        onToggleAudio={handleToggleAudio}
        onToggleVideo={handleToggleVideo}
        onToggleScreenShare={handleToggleScreenShare}
        onToggleChat={handleToggleChat}
        onLeave={handleLeave}
      />
    </main>
  );
}

export default function RoomPage() {
  return (
    <Suspense
      fallback={
        <main className={styles.main}>
          <div className={styles.stage}>
            <div className={`${styles.placeholder} glass`}>
              <div className={styles.placeholderIcon}>🍿</div>
              <p className={styles.placeholderText}>Loading room…</p>
            </div>
          </div>
        </main>
      }
    >
      <RoomContent />
    </Suspense>
  );
}
