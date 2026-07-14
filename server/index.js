// ---------------------------------------------------------------------------
// Popcornn — Signaling server entry point
// ---------------------------------------------------------------------------
// This server's ONLY job: introduce peers to each other so they can connect
// directly via WebRTC. No video ever passes through here.
// ---------------------------------------------------------------------------

const express = require('express');
const http    = require('http');
const cors    = require('cors');
const { Server } = require('socket.io');
const { createRoom, joinRoom, leaveRoom, findRoomByPeer } = require('./rooms');

// ── Config ──────────────────────────────────────────────────────────────────

const PORT        = process.env.PORT || 4000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';

// ── Express ─────────────────────────────────────────────────────────────────

const app    = express();
const server = http.createServer(app);

app.use(cors({ origin: CORS_ORIGIN }));

// Health check — Render + UptimeRobot hit this to prevent spin-down
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ── Socket.io ───────────────────────────────────────────────────────────────

const io = new Server(server, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ['GET', 'POST'],
  },
});

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);

  // ── Create room ─────────────────────────────────────────────────────────
  socket.on('create-room', ({ hostName }, callback) => {
    const room = createRoom(socket.id, hostName);
    socket.join(room.code);                      // join the Socket.io room
    console.log(`[create-room] ${hostName} created ${room.code}`);
    callback({ code: room.code });
  });

  // ── Join room ───────────────────────────────────────────────────────────
  socket.on('join-room', ({ code, name }, callback) => {
    const result = joinRoom(code, socket.id, name);
    if (!result.ok) {
      console.log(`[join-room] rejected ${name} from ${code}: ${result.error}`);
      return callback({ error: result.error });
    }

    socket.join(code);                           // join the Socket.io room

    // Tell existing members about the new peer
    socket.to(code).emit('peer-joined', {
      peerId: socket.id,
      name,
    });

    // Tell the new peer about everyone already in the room
    const existingPeers = result.room.participants
      .filter(p => p.id !== socket.id)
      .map(p => ({ peerId: p.id, name: p.name }));

    console.log(`[join-room] ${name} joined ${code} (${result.room.participants.length} total)`);
    callback({ ok: true, peers: existingPeers });
  });

  // ── Signal relay (SDP offer/answer/ICE candidates) ──────────────────────
  // Relayed between exactly two peers — never broadcast room-wide.
  // Same-room guard: reject if the target isn't in the sender's room.
  socket.on('signal', ({ to, data }) => {
    const room = findRoomByPeer(socket.id);
    if (!room || !room.participants.some(p => p.id === to)) return;
    io.to(to).emit('signal', {
      from: socket.id,
      data,
    });
  });

  socket.on('chat-message', ({ text, senderName }) => {
    const room = findRoomByPeer(socket.id);
    if (!room) return;
    io.to(room.code).emit('chat-message', {
      senderId: socket.id,
      text,
      senderName,
      timestamp: Date.now(),
    });
  });

  // ── Screen share signaling ───────────────────────────────────────────────
  // Broadcast to room so peers know to feature the new stream.
  socket.on('screen-share-started', ({ screenStreamId } = {}) => {
    const room = findRoomByPeer(socket.id);
    if (!room) return;
    console.log(`[screen-share-started] ${socket.id} in ${room.code} (streamId: ${screenStreamId})`);
    socket.to(room.code).emit('screen-share-started', { from: socket.id, screenStreamId });
  });

  socket.on('screen-share-stopped', () => {
    const room = findRoomByPeer(socket.id);
    if (!room) return;
    console.log(`[screen-share-stopped] ${socket.id} in ${room.code}`);
    socket.to(room.code).emit('screen-share-stopped', { from: socket.id });
  });

  // ── Leave room ──────────────────────────────────────────────────────────
  socket.on('leave-room', () => {
    handleLeave(socket);
  });

  // ── Disconnect (browser close, network drop, etc.) ──────────────────────
  socket.on('disconnect', (reason) => {
    console.log(`[disconnect] ${socket.id} (${reason})`);
    handleLeave(socket);
  });
});

// ── Shared leave logic ────────────────────────────────────────────────────

function handleLeave(socket) {
  const room = findRoomByPeer(socket.id);
  if (!room) return;

  const { wasDeleted } = leaveRoom(room.code, socket.id);

  // Tell remaining members this peer left
  socket.to(room.code).emit('peer-left', { peerId: socket.id });
  socket.leave(room.code);

  if (wasDeleted) {
    console.log(`[room-deleted] ${room.code} (empty)`);
  } else {
    console.log(`[leave-room] ${socket.id} left ${room.code}`);
  }
}

// ── Start ───────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`Popcornn signaling server running on :${PORT}`);
  console.log(`CORS origin: ${CORS_ORIGIN}`);
});
