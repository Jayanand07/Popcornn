"use client";

import styles from "../app/room/[code]/room.module.css";

export default function Controls({
  audioEnabled,
  videoEnabled,
  isScreenSharing,
  chatOpen,
  unreadChat,
  onToggleAudio,
  onToggleVideo,
  onToggleScreenShare,
  onToggleChat,
  onLeave,
}) {
  return (
    <div className={styles.controlBar}>
      <button
        className={`${styles.controlBtn} ${
          audioEnabled ? styles.controlBtnActive : ""
        }`}
        title={audioEnabled ? "Mute Microphone" : "Unmute Microphone"}
        onClick={onToggleAudio}
      >
        {audioEnabled ? "🎙️" : "🔇"}
      </button>

      <button
        className={`${styles.controlBtn} ${
          videoEnabled ? styles.controlBtnActive : ""
        }`}
        title={videoEnabled ? "Turn Camera Off" : "Turn Camera On"}
        onClick={onToggleVideo}
      >
        {videoEnabled ? "📷" : "📷❌"}
      </button>

      <button
        className={`${styles.controlBtn} ${
          isScreenSharing ? styles.controlBtnScreenShare : ""
        }`}
        title={isScreenSharing ? "Stop Sharing Screen" : "Share Screen"}
        onClick={onToggleScreenShare}
      >
        {isScreenSharing ? "🖥️✓" : "🖥️"}
      </button>

      {/* ── Chat Toggle Button with optional unread dot ── */}
      <button
        className={`${styles.controlBtn} ${
          chatOpen ? styles.controlBtnActive : ""
        } ${styles.chatToggleBtn}`}
        title={chatOpen ? "Close Chat" : "Open Chat"}
        onClick={onToggleChat}
      >
        <span>💬</span>
        {unreadChat && !chatOpen && <span className={styles.unreadDot} />}
      </button>

      <button
        className={`${styles.controlBtn} ${styles.controlBtnDanger}`}
        title="Leave Party"
        onClick={onLeave}
      >
        ✕
      </button>
    </div>
  );
}
