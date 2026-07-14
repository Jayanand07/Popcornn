"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./Chat.module.css";

export default function Chat({
  messages,
  onSendMessage,
  localSocketId,
  displayName,
}) {
  const [inputText, setInputText] = useState("");
  const messagesEndRef = useRef(null);
  const containerRef = useRef(null);

  // Auto-scroll logic: only scroll if the user is already scrolled to/near the bottom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Check if user is scrolled near the bottom (within 100px threshold)
    const threshold = 100;
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;

    if (isNearBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed) return;

    // Call prop callback to handle message sending (emits socket event)
    onSendMessage(trimmed);
    setInputText("");
  };

  const formatTime = (ts) => {
    if (!ts) return "";
    try {
      return new Date(ts).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  };

  return (
    <div className={styles.chatSidebar}>
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.title}>💬 Party Chat</span>
        <span className={styles.badge}>{messages.length} messages</span>
      </div>

      {/* Messages area */}
      <div ref={containerRef} className={styles.messageArea}>
        {messages.length === 0 ? (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon}>🍿</span>
            <p>Welcome to the party! Send a message to start chatting.</p>
          </div>
        ) : (
          messages.map((msg, index) => {
            const isOwn = msg.senderId === localSocketId;
            return (
              <div
                key={msg.id || index}
                className={`${styles.messageWrapper} ${
                  isOwn ? styles.ownMessageWrapper : styles.peerMessageWrapper
                }`}
              >
                {!isOwn && <span className={styles.senderName}>{msg.senderName}</span>}
                <div className={`${styles.bubble} ${isOwn ? styles.ownBubble : styles.peerBubble}`}>
                  <p className={styles.msgText}>{msg.text}</p>
                  <span className={styles.timestamp}>{formatTime(msg.timestamp)}</span>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input panel */}
      <form onSubmit={handleSubmit} className={styles.inputForm}>
        <input
          type="text"
          className={styles.input}
          placeholder="Type a message..."
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
        />
        <button type="submit" className={styles.sendBtn} disabled={!inputText.trim()}>
          ➤
        </button>
      </form>
    </div>
  );
}
