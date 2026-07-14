// ---------------------------------------------------------------------------
// Popcornn — In-memory room store + room-code generator
// ---------------------------------------------------------------------------
// No database. Room state lives here and dies when the process restarts.
// That's fine — rooms are ephemeral by design.
// ---------------------------------------------------------------------------

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid ambiguity
const DIGITS  = '0123456789';
const MAX_PARTICIPANTS = 10;

/** @type {Map<string, Room>} */
const rooms = new Map();

/** @type {Map<string, NodeJS.Timeout>} */
const deleteTimeouts = new Map();

/**
 * @typedef {Object} Participant
 * @property {string} id       — socket.id
 * @property {string} name     — display name chosen by the user
 */

/**
 * @typedef {Object} Room
 * @property {string}        code
 * @property {Participant[]} participants
 * @property {number}        createdAt    — Date.now()
 */

// ── Code generation ─────────────────────────────────────────────────────────

function randomFrom(charset, length) {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset[Math.floor(Math.random() * charset.length)];
  }
  return result;
}

/**
 * Generate a room code (4 letters + 4 digits, e.g. QXRT8341).
 * Collision-checked against current rooms.
 */
function generateCode() {
  let code;
  do {
    code = randomFrom(LETTERS, 4) + randomFrom(DIGITS, 4);
  } while (rooms.has(code));
  return code;
}

// ── Room CRUD ───────────────────────────────────────────────────────────────

/**
 * Create a new room.
 * @param {string} hostId   — socket.id of the host
 * @param {string} hostName — display name
 * @returns {Room}
 */
function createRoom(hostId, hostName) {
  const code = generateCode();
  const room = {
    code,
    participants: [{ id: hostId, name: hostName }],
    createdAt: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

/**
 * Add a participant to an existing room.
 * @returns {{ ok: boolean, room?: Room, error?: string }}
 */
function joinRoom(code, peerId, peerName) {
  const room = rooms.get(code);
  if (!room) return { ok: false, error: 'Room not found' };
  if (room.participants.length >= MAX_PARTICIPANTS) return { ok: false, error: 'Room is full (max 10)' };
  if (room.participants.some(p => p.id === peerId)) return { ok: false, error: 'Already in this room' };

  // Cancel pending deletion timeout if anyone joins/reconnects
  if (deleteTimeouts.has(code)) {
    clearTimeout(deleteTimeouts.get(code));
    deleteTimeouts.delete(code);
    console.log(`[room-saved] ${code} (deletion canceled, peer joined)`);
  }

  room.participants.push({ id: peerId, name: peerName });
  return { ok: true, room };
}

/**
 * Remove a participant from their room. Deletes the room if now empty.
 * @returns {{ room: Room|null, wasDeleted: boolean }}
 */
function leaveRoom(code, peerId) {
  const room = rooms.get(code);
  if (!room) return { room: null, wasDeleted: false };

  room.participants = room.participants.filter(p => p.id !== peerId);

  if (room.participants.length === 0) {
    // Schedule deletion in 10 seconds to allow for page transitions/refreshes
    if (!deleteTimeouts.has(code)) {
      const timeoutId = setTimeout(() => {
        rooms.delete(code);
        deleteTimeouts.delete(code);
        console.log(`[room-deleted] ${code} (empty timeout expired)`);
      }, 10000);
      deleteTimeouts.set(code, timeoutId);
    }
    return { room: null, wasDeleted: false };
  }
  return { room, wasDeleted: false };
}

/**
 * Find which room a socket belongs to (for disconnect cleanup).
 * @param {string} peerId — socket.id
 * @returns {Room|undefined}
 */
function findRoomByPeer(peerId) {
  for (const room of rooms.values()) {
    if (room.participants.some(p => p.id === peerId)) return room;
  }
  return undefined;
}

/**
 * Get a room by code.
 * @returns {Room|undefined}
 */
function getRoom(code) {
  return rooms.get(code);
}

module.exports = {
  createRoom,
  joinRoom,
  leaveRoom,
  findRoomByPeer,
  getRoom,
  MAX_PARTICIPANTS,
};
