require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cookieParser = require('cookie-parser');

// ---------------------------------------------------------------------------
// Express + HTTP + Socket.io setup
// ---------------------------------------------------------------------------
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 4567;

// Middleware
app.use(express.json());
app.use(cookieParser());

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------

// Platform static files at root
app.use(express.static(path.join(__dirname, 'platform', 'public')));

// Fork game static files at /games/fork/
app.use('/games/fork', express.static(path.join(__dirname, 'games', 'fork', 'public')));

// Platform assets
app.use('/platform-assets', express.static(path.join(__dirname, 'platform', 'assets')));

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
app.use('/api', require('./platform/routes'));

// Dev API: return ending data for preview (Fork game)
const forkGame = require('./games/fork/game-logic');
app.get('/api/dev/endings', forkGame.getDevEndingsHandler);

// ---------------------------------------------------------------------------
// SPA catch-all routes
// ---------------------------------------------------------------------------

// Fork game SPA catch-all
app.get('/games/fork/*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'games', 'fork', 'public', 'index.html'));
});
app.get('/games/fork', (_req, res) => {
  res.sendFile(path.join(__dirname, 'games', 'fork', 'public', 'index.html'));
});

// Platform SPA catch-all (must be last)
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'platform', 'public', 'index.html'));
});

// ---------------------------------------------------------------------------
// Socket.IO — Fork game namespace
// ---------------------------------------------------------------------------
const forkNamespace = io.of('/fork');
forkGame.register(forkNamespace);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
server.listen(PORT, () => {
  console.log(`[Server] Murmy platform running on http://localhost:${PORT}`);
  console.log(`[Server] Fork game available at http://localhost:${PORT}/games/fork`);
});
