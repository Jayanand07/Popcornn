"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  connectSocket,
  emitCreateRoom,
  emitJoinRoom,
  setLastJoinResult,
} from "@/lib/socket";
import styles from "./page.module.css";

export default function Home() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState(null); // null | 'create' | 'join'
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // ── Host: connect, emit create-room, cache result, navigate ─────────
  const handleCreate = async () => {
    if (!name.trim()) {
      setError("Enter your name first");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await connectSocket();
      const response = await emitCreateRoom(name.trim());
      setLastJoinResult({
        code: response.code,
        peers: [],
        isHost: true,
        name: name.trim(),
      });
      router.push(
        `/room/${response.code}?name=${encodeURIComponent(
          name.trim()
        )}&host=true`
      );
    } catch (err) {
      setError(err.message || "Failed to create room");
      setLoading(false);
    }
  };

  // ── Joiner: connect, emit join-room, cache result, navigate ─────────
  const handleJoin = async () => {
    if (!name.trim()) {
      setError("Enter your name first");
      return;
    }
    if (!joinCode.trim()) {
      setError("Enter a room code");
      return;
    }
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 8) {
      setError("Room code must be 8 characters (e.g. QXRT8341)");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await connectSocket();
      const response = await emitJoinRoom(code, name.trim());
      setLastJoinResult({
        code,
        peers: response.peers || [],
        isHost: false,
        name: name.trim(),
      });
      router.push(`/room/${code}?name=${encodeURIComponent(name.trim())}`);
    } catch (err) {
      setError(err.message || "Failed to join room");
      setLoading(false);
    }
  };

  return (
    <main className={styles.main}>
      {/* Ambient background glow */}
      <div className={styles.ambientGlow} />
      <div className={styles.ambientGlowRed} />

      <div className={styles.container}>
        {/* Hero */}
        <div className={`${styles.hero} animate-fade-in`}>
          <div className={styles.logoMark}>🍿</div>
          <h1 className={styles.title}>
            Popcor<span className={styles.titleAccent}>nn</span>
          </h1>
          <p className={styles.subtitle}>
            Watch parties for up to 10 people.
            <br />
            No login. No downloads. Just a code.
          </p>
        </div>

        {/* Card */}
        <div className={`${styles.card} glass animate-slide-up`}>
          {/* Name input — always visible */}
          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor="input-name">
              Your name
            </label>
            <input
              id="input-name"
              className="input-field"
              type="text"
              placeholder="What should we call you?"
              maxLength={24}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError("");
              }}
              disabled={loading}
              autoFocus
            />
          </div>

          {/* Action buttons */}
          {!mode && (
            <div className={`${styles.actions} stagger`}>
              <button
                id="btn-create-room"
                className="btn btn-primary"
                onClick={() => setMode("create")}
                disabled={loading}
              >
                <span className={styles.btnIcon}>✦</span>
                Create Room
              </button>
              <button
                id="btn-join-room"
                className="btn btn-secondary"
                onClick={() => setMode("join")}
                disabled={loading}
              >
                <span className={styles.btnIcon}>→</span>
                Join Room
              </button>
            </div>
          )}

          {/* Create confirmation */}
          {mode === "create" && (
            <div className={`${styles.modePanel} animate-fade-in`}>
              <p className={styles.modeHint}>
                You'll get a code to share with your friends.
              </p>
              <div className={styles.modeActions}>
                <button
                  className="btn btn-primary"
                  onClick={handleCreate}
                  disabled={loading}
                >
                  {loading ? "Creating..." : "Start Party"}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setMode(null);
                    setError("");
                  }}
                  disabled={loading}
                >
                  Back
                </button>
              </div>
            </div>
          )}

          {/* Join form */}
          {mode === "join" && (
            <div className={`${styles.modePanel} animate-fade-in`}>
              <div className={styles.fieldGroup}>
                <label className={styles.label} htmlFor="input-code">
                  Room code
                </label>
                <input
                  id="input-code"
                  className={`input-field ${styles.codeInput}`}
                  type="text"
                  placeholder="e.g. QXRT8341"
                  maxLength={8}
                  value={joinCode}
                  onChange={(e) => {
                    setJoinCode(e.target.value.toUpperCase());
                    setError("");
                  }}
                  onKeyDown={(e) => e.key === "Enter" && !loading && handleJoin()}
                  disabled={loading}
                />
              </div>
              <div className={styles.modeActions}>
                <button
                  className="btn btn-primary"
                  onClick={handleJoin}
                  disabled={loading}
                >
                  {loading ? "Joining..." : "Join Party"}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setMode(null);
                    setError("");
                  }}
                  disabled={loading}
                >
                  Back
                </button>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <p className={`${styles.error} animate-fade-in`}>{error}</p>
          )}
        </div>

        {/* Footer */}
        <p className={`${styles.footer} animate-fade-in`}>
          Peer-to-peer · No data stored · End-to-end
        </p>
      </div>
    </main>
  );
}
