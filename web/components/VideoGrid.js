"use client";

import { useEffect, useRef } from "react";
import styles from "./VideoGrid.module.css";

// ── Video binding helper ───────────────────────────────────────────────────

function useVideoStream(ref, stream) {
  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream || null;
    }
  }, [stream, ref]);
}

// ── Normal camera tile (used in the grid and in the strip) ────────────────

function VideoTile({ stream, name, isLocal, className }) {
  const videoRef = useRef(null);
  useVideoStream(videoRef, stream);

  return (
    <div className={className || styles.videoTile}>
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className={`${styles.videoElement} ${isLocal ? styles.mirrored : ""}`}
        />
      ) : (
        <div className={styles.videoPlaceholder}>
          <span className={styles.placeholderIcon}>🍿</span>
          <span className={styles.placeholderText}>Connecting camera...</span>
        </div>
      )}
      <div className={styles.nameTag}>
        {name}
        {isLocal && " (you)"}
      </div>
    </div>
  );
}

// ── Featured screen-share tile ────────────────────────────────────────────

function ScreenShareTile({ stream, sharerName }) {
  const videoRef = useRef(null);
  useVideoStream(videoRef, stream);

  return (
    <div className={styles.featuredTile}>
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={false}
          className={styles.featuredVideo}
        />
      ) : (
        <div className={styles.videoPlaceholder}>
          <span className={styles.placeholderIcon}>🖥️</span>
          <span className={styles.placeholderText}>Loading screen share...</span>
        </div>
      )}
      <div className={styles.featuredBadge}>
        🖥️ {sharerName} is sharing
      </div>
    </div>
  );
}

// ── Main VideoGrid ────────────────────────────────────────────────────────

export default function VideoGrid({
  localStream,
  remoteStreams,
  peers,
  displayName,
  // Screen share props
  localScreenStream,   // set when local user is sharing
  remoteScreenStreams, // { [peerId]: MediaStream } for remote sharers
}) {
  const remotePeersWithStreams = peers.map((p) => ({
    peerId: p.peerId,
    name: p.name,
    stream: remoteStreams[p.peerId] || null,
    screenStream: remoteScreenStreams?.[p.peerId] || null,
  }));

  // Determine if any screen share is active and which stream/name to feature
  const localSharing = !!localScreenStream;
  const remoteSharingPeer = remotePeersWithStreams.find((p) => p.screenStream);
  const isScreenShareActive = localSharing || !!remoteSharingPeer;

  const featuredStream = localSharing ? localScreenStream : remoteSharingPeer?.screenStream || null;
  const featuredName = localSharing ? `${displayName} (you)` : remoteSharingPeer?.name || "";

  // ── Screen-share featured layout ─────────────────────────────────────────
  if (isScreenShareActive) {
    return (
      <div className={styles.container}>
        <div className={styles.screenShareLayout}>
          {/* Big featured screen tile */}
          <ScreenShareTile stream={featuredStream} sharerName={featuredName} />

          {/* Camera strip — everyone's cameras in a horizontal row */}
          <div className={styles.cameraStrip}>
            <VideoTile
              stream={localStream}
              name={displayName}
              isLocal={true}
              className={styles.stripTile}
            />
            {remotePeersWithStreams.map((p) => (
              <VideoTile
                key={p.peerId}
                stream={p.stream}
                name={p.name}
                isLocal={false}
                className={styles.stripTile}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Normal grid layout (no screen share) ─────────────────────────────────
  const totalTiles = 1 + remotePeersWithStreams.length;

  let gridStyle = {};
  if (totalTiles === 1) {
    gridStyle = { gridTemplateColumns: "1fr", maxWidth: "640px" };
  } else if (totalTiles === 2) {
    gridStyle = { gridTemplateColumns: "repeat(2, 1fr)", maxWidth: "960px" };
  } else {
    gridStyle = {
      gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
      maxWidth: "1200px",
    };
  }

  return (
    <div className={styles.container}>
      <div className={styles.grid} style={gridStyle}>
        <VideoTile stream={localStream} name={displayName} isLocal={true} />
        {remotePeersWithStreams.map((p) => (
          <VideoTile
            key={p.peerId}
            stream={p.stream}
            name={p.name}
            isLocal={false}
          />
        ))}
      </div>
    </div>
  );
}
