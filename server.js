require('dotenv').config();

async function main() {
  // Initialize database first (loads WASM) — must complete before other modules
  await require('./lib/db').ready;

  const express = require('express');
  const http = require('http');
  const https = require('https');
  const fs = require('fs');
  const { Server } = require('socket.io');
  const path = require('path');
  const cookieParser = require('cookie-parser');

  // -------------------------------------------------------------------------
  // Express + HTTP/HTTPS + Socket.io setup
  // -------------------------------------------------------------------------
  const app = express();
  const PORT = process.env.PORT || 4567;

  // HTTPS setup (production with certs)
  const certPath = process.env.SSL_CERT || '/home/opc/certs/fullchain.pem';
  const keyPath = process.env.SSL_KEY || '/home/opc/certs/privkey.pem';
  let server;

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    server = https.createServer({
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
    }, app);

    // HTTP → HTTPS redirect on port 80
    const httpRedirect = express();
    httpRedirect.get('*', (req, res) => {
      res.redirect(`https://${req.headers.host}${req.url}`);
    });
    http.createServer(httpRedirect).listen(80, () => {
      console.log('[Server] HTTP→HTTPS redirect on port 80');
    }).on('error', () => {});
  } else {
    server = http.createServer(app);
  }

  const io = new Server(server);

  // Middleware
  app.use(express.json());
  app.use(cookieParser());

  // -------------------------------------------------------------------------
  // Static file serving
  // -------------------------------------------------------------------------

  // Platform static files at root
  app.use(express.static(path.join(__dirname, 'platform', 'public')));

  // Fork game static files at /games/fork/
  app.use('/games/fork', express.static(path.join(__dirname, 'games', 'fork', 'public')));

  // Platform assets
  app.use('/platform-assets', express.static(path.join(__dirname, 'platform', 'assets')));

  // -------------------------------------------------------------------------
  // API routes
  // -------------------------------------------------------------------------
  app.use('/api', require('./platform/routes'));

  // Dev API: return ending data for preview (Fork game)
  const forkGame = require('./games/fork/game-logic');
  app.get('/api/dev/endings', forkGame.getDevEndingsHandler);

  // -------------------------------------------------------------------------
  // SPA catch-all routes
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Socket.IO — Fork game namespace
  // -------------------------------------------------------------------------
  const forkNamespace = io.of('/fork');
  forkGame.register(forkNamespace);

  // -------------------------------------------------------------------------
  // Start server
  // -------------------------------------------------------------------------
  const HTTPS_PORT = process.env.HTTPS_PORT || 443;
  const listenPort = server instanceof https.Server ? HTTPS_PORT : PORT;
  server.listen(listenPort, () => {
    const proto = server instanceof https.Server ? 'https' : 'http';
    console.log(`[Server] Murmy platform running on ${proto}://localhost:${listenPort}`);
    console.log(`[Server] Fork game available at ${proto}://localhost:${listenPort}/games/fork`);
  });
}

main().catch((err) => {
  console.error('[Server] Failed to start:', err);
  process.exit(1);
});
