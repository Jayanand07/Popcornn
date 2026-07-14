// ---------------------------------------------------------------------------
// Popcornn — Socket.io client wrapper
// ---------------------------------------------------------------------------
// Singleton socket connection to the signaling server.
// Provides typed helpers for every signaling event.
//
// IMPORTANT: The socket is only connected from the room page, never the
// landing page. This prevents the socket from disconnecting during
// Next.js navigation (which would delete the room on the server).
// ---------------------------------------------------------------------------

import { io } from "socket.io-client";

const SIGNAL_URL =
  process.env.NEXT_PUBLIC_SIGNAL_URL || "http://localhost:4000";
if (process.env.NODE_ENV !== "production") {
  console.log("[socket] SIGNAL_URL resolves to:", SIGNAL_URL);
}

/**
 * Store the successful result of create-room or join-room from the landing page.
 */
export function setLastJoinResult(result) {
  if (typeof window !== "undefined") {
    window.__popcornn_last_join__ = result;
  }
}

/**
 * Retrieve the cached join result on room mount.
 */
export function getLastJoinResult() {
  return typeof window !== "undefined" ? window.__popcornn_last_join__ : null;
}

/**
 * Clear the cached result once consumed.
 */
export function clearLastJoinResult() {
  if (typeof window !== "undefined") {
    window.__popcornn_last_join__ = null;
  }
}


/**
 * Get (or create) the singleton socket instance.
 * Does NOT auto-connect — call connectSocket() explicitly.
 */
export function getSocket() {
  if (typeof window === "undefined") {
    return null;
  }
  if (!window.__popcornn_socket__) {
    window.__popcornn_socket__ = io(SIGNAL_URL, {
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });
  }
  return window.__popcornn_socket__;
}

/**
 * Connect the socket and return a promise that resolves when connected.
 * If already connected, resolves immediately.
 * @returns {Promise<import("socket.io-client").Socket>}
 */
export function connectSocket() {
  const s = getSocket();
  if (s.connected) return Promise.resolve(s);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Socket connection timed out"));
    }, 10000);

    s.once("connect", () => {
      clearTimeout(timeout);
      resolve(s);
    });

    s.once("connect_error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`Socket connection failed: ${err.message}`));
    });

    s.connect();
  });
}

/**
 * Disconnect the socket cleanly.
 */
export function disconnectSocket() {
  if (typeof window !== "undefined" && window.__popcornn_socket__) {
    window.__popcornn_socket__.disconnect();
    window.__popcornn_socket__ = null;
  }
}

// ── Room helpers ────────────────────────────────────────────────────────────

/**
 * Create a new room on the server.
 * @param {string} hostName
 * @returns {Promise<{ code: string }>}
 */
export function emitCreateRoom(hostName) {
  return new Promise((resolve, reject) => {
    const s = getSocket();
    if (!s || !s.connected) return reject(new Error("Socket not connected"));
    s.emit("create-room", { hostName }, (response) => {
      if (response.error) {
        reject(new Error(response.error));
      } else {
        resolve(response); // { code }
      }
    });
  });
}

/**
 * Join an existing room on the server.
 * @param {string} code — room code
 * @param {string} name — display name
 * @returns {Promise<{ ok: boolean, peers: Array<{ peerId: string, name: string }> }>}
 */
export function emitJoinRoom(code, name) {
  return new Promise((resolve, reject) => {
    const s = getSocket();
    if (!s || !s.connected) return reject(new Error("Socket not connected"));
    s.emit("join-room", { code, name }, (response) => {
      if (response.error) {
        reject(new Error(response.error));
      } else {
        resolve(response); // { ok, peers }
      }
    });
  });
}

/**
 * Tell the server we're leaving.
 */
export function emitLeaveRoom() {
  if (typeof window !== "undefined" && window.__popcornn_socket__ && window.__popcornn_socket__.connected) {
    window.__popcornn_socket__.emit("leave-room");
  }
}
