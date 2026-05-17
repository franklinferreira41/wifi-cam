const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const path     = require('path');
const fs       = require('fs');
const { v4: uuidv4 } = require('uuid');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' }, transports: ['websocket', 'polling'] });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.redirect('/registry.html'));

// ── Persistent Registry ────────────────────────────────────────────────────
const REGISTRY_FILE = path.join(__dirname, 'cameras.json');

function loadRegistry() {
  try {
    if (fs.existsSync(REGISTRY_FILE)) {
      return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
    }
  } catch (e) { console.error('Registry load error:', e); }
  return {};
}

function saveRegistry() {
  try {
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
  } catch (e) { console.error('Registry save error:', e); }
}

// registry: { [cameraId]: { id, name, roomId, lastSeen, createdAt, online } }
let registry = loadRegistry();

// Mark all as offline on startup (stale connections from prev session)
Object.values(registry).forEach(c => { c.online = false; });
saveRegistry();

// ── REST API ───────────────────────────────────────────────────────────────
// List all cameras
app.get('/api/cameras', (req, res) => {
  res.json(Object.values(registry).sort((a, b) => {
    // Online first, then by lastSeen
    if (a.online !== b.online) return b.online ? 1 : -1;
    return new Date(b.lastSeen) - new Date(a.lastSeen);
  }));
});

// Register or update camera metadata
app.post('/api/cameras/register', (req, res) => {
  const { id, name, roomId } = req.body;
  if (!id || !roomId) return res.status(400).json({ error: 'id and roomId required' });

  const existing = registry[id];
  registry[id] = {
    id,
    name:      name || existing?.name || 'Câmera',
    roomId,
    createdAt: existing?.createdAt || new Date().toISOString(),
    lastSeen:  new Date().toISOString(),
    online:    false,
  };
  saveRegistry();
  res.json(registry[id]);
});

// Update camera name
app.patch('/api/cameras/:id', (req, res) => {
  const cam = registry[req.params.id];
  if (!cam) return res.status(404).json({ error: 'not found' });
  if (req.body.name) cam.name = req.body.name;
  saveRegistry();
  io.emit('registry-updated', Object.values(registry));
  res.json(cam);
});

// Delete camera
app.delete('/api/cameras/:id', (req, res) => {
  if (!registry[req.params.id]) return res.status(404).json({ error: 'not found' });
  delete registry[req.params.id];
  saveRegistry();
  io.emit('registry-updated', Object.values(registry));
  res.json({ deleted: true });
});

app.get('/health', (req, res) => res.json({ ok: true, cameras: Object.keys(registry).length }));

// ── Socket.io rooms ────────────────────────────────────────────────────────
const rooms = {};  // roomId → { camera: socketId|null, viewers: Set<socketId> }

function room(id) {
  if (!rooms[id]) rooms[id] = { camera: null, viewers: new Set() };
  return rooms[id];
}

io.on('connection', (socket) => {
  console.log(`[+] ${socket.id}`);

  // ── Camera joins ──────────────────────────────────────────────────────────
  socket.on('join-as-camera', ({ roomId, cameraId, name }) => {
    const r = room(roomId);
    r.camera = socket.id;
    socket.join(roomId);
    socket.data = { roomId, role: 'camera', cameraId };

    // Update registry
    if (cameraId && registry[cameraId]) {
      registry[cameraId].online  = true;
      registry[cameraId].roomId  = roomId;
      registry[cameraId].name    = name || registry[cameraId].name;
      registry[cameraId].lastSeen = new Date().toISOString();
      saveRegistry();
      io.emit('registry-updated', Object.values(registry));
    }

    socket.to(roomId).emit('camera-ready');
    socket.emit('camera-joined', { viewerCount: r.viewers.size });
    console.log(`[CAM] id=${cameraId} room="${roomId}"`);
  });

  // ── Viewer joins ──────────────────────────────────────────────────────────
  socket.on('join-as-viewer', ({ roomId }) => {
    const r = room(roomId);
    r.viewers.add(socket.id);
    socket.join(roomId);
    socket.data = { roomId, role: 'viewer' };

    if (r.camera) {
      io.to(r.camera).emit('viewer-joined', { viewerId: socket.id });
      socket.emit('camera-ready');
    } else {
      socket.emit('waiting-for-camera');
    }
  });

  // ── WebRTC relay ──────────────────────────────────────────────────────────
  socket.on('offer',         ({ to, offer })     => io.to(to).emit('offer',         { from: socket.id, offer }));
  socket.on('answer',        ({ to, answer })    => io.to(to).emit('answer',        { from: socket.id, answer }));
  socket.on('ice-candidate', ({ to, candidate }) => io.to(to).emit('ice-candidate', { from: socket.id, candidate }));

  // ── PTZ relay (viewer → camera) ───────────────────────────────────────────
  socket.on('pan-tilt', ({ pan, tilt }) => {
    const { roomId } = socket.data || {};
    if (roomId && rooms[roomId]?.camera) io.to(rooms[roomId].camera).emit('pan-tilt', { pan, tilt });
  });

  socket.on('person-alert', ({ detected, count }) => {
    const { roomId } = socket.data || {};
    if (roomId && rooms[roomId]?.camera) io.to(rooms[roomId].camera).emit('person-alert', { detected, count });
  });

  // ── Disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const { roomId, role, cameraId } = socket.data || {};
    if (!roomId || !rooms[roomId]) return;
    const r = rooms[roomId];

    if (role === 'camera') {
      r.camera = null;
      io.to(roomId).emit('camera-disconnected');

      if (cameraId && registry[cameraId]) {
        registry[cameraId].online   = false;
        registry[cameraId].lastSeen = new Date().toISOString();
        saveRegistry();
        io.emit('registry-updated', Object.values(registry));
      }
    } else {
      r.viewers.delete(socket.id);
      if (r.camera) io.to(r.camera).emit('viewer-left', { viewerId: socket.id });
    }

    if (!r.camera && r.viewers.size === 0) delete rooms[roomId];
    console.log(`[-] ${socket.id} (${role}) room="${roomId}"`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n📷  WiFi-Cam  →  http://localhost:${PORT}`);
  console.log(`    Registry  →  http://localhost:${PORT}/registry.html\n`);
});
