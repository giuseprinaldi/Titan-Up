import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { format } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { openDb, newId, OpError, cleanText } from './db.js';
import { RETRO_TEMPLATES, RADAR_TEMPLATES, RATING_LABELS } from './templates.js';
import { createRetro, joinRetro, retroView, applyRetroOp } from './retro.js';
import { createRadar, joinRadar, radarView, applyRadarOp, radarResults } from './radar.js';
import { actionView, addAction, updateAction, deleteAction } from './actions.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const MODULES = join(ROOT, 'node_modules');

const KINDS = {
  retro: { table: 'retros', join: joinRetro, view: retroView, apply: applyRetroOp },
  radar: { table: 'radars', join: joinRadar, view: radarView, apply: applyRadarOp },
};

export function startServer({ port = 3000, host = '0.0.0.0', dbFile = join(ROOT, 'data', 'titan-up.db') } = {}) {
  const db = openDb(dbFile);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    res.set(
      'Content-Security-Policy',
      "default-src 'self'; connect-src 'self' ws: wss:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
    );
    next();
  });

  // ---------- live rooms ----------
  // One room per open retro or health check. Every change re-sends each
  // person their own view of the session, so clients never hold stale state.
  const rooms = new Map(); // "retro:<id>" -> Set<WebSocket>
  let closing = false;

  const onlineIn = (key) => new Set([...(rooms.get(key) || [])].map((ws) => ws.user.id));

  function broadcast(key) {
    const sockets = rooms.get(key);
    if (!sockets?.size) return;
    const [kind, id] = splitKey(key);
    const online = onlineIn(key);
    const views = new Map();
    for (const ws of sockets) {
      if (!views.has(ws.user.id)) {
        const state = KINDS[kind].view(db, id, ws.user, online);
        views.set(ws.user.id, JSON.stringify(state ? { type: 'state', state } : { type: 'gone' }));
      }
      ws.send(views.get(ws.user.id));
    }
  }

  const splitKey = (key) => [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];

  /** Action items are shared by a whole team, so refresh every open retro of that team. */
  function broadcastTeamRetros(teamId) {
    for (const key of rooms.keys()) {
      const [kind, id] = splitKey(key);
      if (kind !== 'retro') continue;
      if (db.get('SELECT team_id FROM retros WHERE id = ?', id)?.team_id === teamId) broadcast(key);
    }
  }

  function closeRoom(key) {
    for (const ws of rooms.get(key) || []) {
      ws.send(JSON.stringify({ type: 'gone' }));
      ws.close(1000);
    }
    rooms.delete(key);
  }

  // ---------- REST API ----------
  const api = express.Router();

  api.post('/users', (req, res) => {
    const user = { id: newId(), token: newId(24), name: cleanText(req.body?.name, 40, { what: 'Your name' }) };
    db.run('INSERT INTO users (id, token, name, created_at) VALUES (?,?,?,?)', user.id, user.token, user.name, Date.now());
    res.status(201).json(user);
  });

  api.use((req, res, next) => {
    const token = /^Bearer (.+)$/.exec(req.get('authorization') || '')?.[1];
    req.user = token ? db.get('SELECT id, name FROM users WHERE token = ?', token) : null;
    if (!req.user) throw new OpError('Tell us your name to continue.', 401);
    next();
  });

  api.get('/me', (req, res) => res.json(req.user));

  api.patch('/me', (req, res) => {
    const name = cleanText(req.body?.name, 40, { what: 'Your name' });
    db.run('UPDATE users SET name = ? WHERE id = ?', name, req.user.id);
    for (const [key, sockets] of rooms) {
      let here = false;
      for (const ws of sockets) {
        if (ws.user.id === req.user.id) {
          ws.user.name = name;
          here = true;
        }
      }
      if (here) broadcast(key);
    }
    res.json({ id: req.user.id, name });
  });

  api.get('/meta', (req, res) => {
    res.json({ retroTemplates: RETRO_TEMPLATES, radarTemplates: RADAR_TEMPLATES, ratingLabels: RATING_LABELS });
  });

  api.get('/teams', (req, res) => {
    res.json(
      db.all(
        `SELECT t.id, t.name, t.created_at AS createdAt,
           (SELECT COUNT(*) FROM retros r WHERE r.team_id = t.id) AS retros,
           (SELECT COUNT(*) FROM radars h WHERE h.team_id = t.id) AS radars,
           (SELECT COUNT(*) FROM action_items a WHERE a.team_id = t.id AND a.done = 0) AS openActions,
           (SELECT MAX(r.created_at) FROM retros r WHERE r.team_id = t.id) AS lastRetroAt
         FROM teams t ORDER BY t.name COLLATE NOCASE`,
      ),
    );
  });

  api.post('/teams', (req, res) => {
    const id = newId();
    db.run('INSERT INTO teams (id, name, created_at) VALUES (?,?,?)', id, cleanText(req.body?.name, 60, { what: 'The team name' }), Date.now());
    res.status(201).json({ id });
  });

  const loadTeam = (id) => {
    const team = db.get('SELECT id, name, created_at AS createdAt FROM teams WHERE id = ?', id);
    if (!team) throw new OpError('That team does not exist.', 404);
    return team;
  };

  api.get('/teams/:id', (req, res) => {
    const team = loadTeam(req.params.id);
    const retros = db.all(
      `SELECT r.id, r.title, r.phase, r.template, r.created_at AS createdAt, r.closed_at AS closedAt, r.created_by AS createdBy,
         (SELECT COUNT(*) FROM notes n WHERE n.retro_id = r.id) AS notes,
         (SELECT COUNT(*) FROM retro_participants p WHERE p.retro_id = r.id) AS people,
         (SELECT COUNT(*) FROM action_items a WHERE a.retro_id = r.id) AS actions
       FROM retros r WHERE r.team_id = ? ORDER BY r.created_at DESC`,
      team.id,
    );
    const radars = db.all('SELECT * FROM radars WHERE team_id = ? ORDER BY created_at DESC', team.id).map((radar) => {
      const out = { id: radar.id, title: radar.title, phase: radar.phase, createdAt: radar.created_at, createdBy: radar.created_by, respondents: 0, results: null };
      if (radar.phase !== 'collect') {
        const { results, respondents } = radarResults(db, radar);
        out.respondents = respondents;
        out.results = results.map((r) => ({ name: r.name, avg: r.avg }));
      } else {
        out.respondents = db.get('SELECT COUNT(DISTINCT user_id) AS c FROM radar_ratings WHERE radar_id = ?', radar.id).c;
      }
      return out;
    });
    const actions = db
      .all(
        `SELECT a.*, r.title AS retro_title FROM action_items a LEFT JOIN retros r ON r.id = a.retro_id
         WHERE a.team_id = ? ORDER BY a.done, a.created_at DESC`,
        team.id,
      )
      .map((a) => ({ ...actionView(a), retroTitle: a.retro_title }));
    res.json({ team, retros, radars, actions });
  });

  api.patch('/teams/:id', (req, res) => {
    const team = loadTeam(req.params.id);
    db.run('UPDATE teams SET name = ? WHERE id = ?', cleanText(req.body?.name, 60, { what: 'The team name' }), team.id);
    res.json({ ok: true });
  });

  api.post('/teams/:id/retros', (req, res) => {
    const team = loadTeam(req.params.id);
    const id = db.tx(() => createRetro(db, { ...req.body, teamId: team.id, user: req.user }));
    res.status(201).json({ id });
  });

  api.post('/teams/:id/radars', (req, res) => {
    const team = loadTeam(req.params.id);
    const id = db.tx(() => createRadar(db, { ...req.body, teamId: team.id, user: req.user }));
    res.status(201).json({ id });
  });

  api.post('/teams/:id/actions', (req, res) => {
    const team = loadTeam(req.params.id);
    const id = addAction(db, { teamId: team.id, text: req.body?.text, owner: req.body?.owner });
    broadcastTeamRetros(team.id);
    res.status(201).json({ id });
  });

  api.patch('/actions/:id', (req, res) => {
    broadcastTeamRetros(updateAction(db, req.params.id, req.body || {}));
    res.json({ ok: true });
  });

  api.delete('/actions/:id', (req, res) => {
    broadcastTeamRetros(deleteAction(db, req.params.id));
    res.json({ ok: true });
  });

  for (const [kind, { table }] of Object.entries(KINDS)) {
    api.delete(`/${table}/:id`, (req, res) => {
      const row = db.get(`SELECT id, created_by, facilitator_id FROM ${table} WHERE id = ?`, req.params.id);
      if (!row) throw new OpError('Already deleted.', 404);
      if (row.created_by !== req.user.id && row.facilitator_id !== req.user.id) {
        throw new OpError('Only the person who started it, or its facilitator, can delete it.', 403);
      }
      db.run(`DELETE FROM ${table} WHERE id = ?`, row.id);
      closeRoom(`${kind}:${row.id}`);
      res.json({ ok: true });
    });
  }

  api.use((req, res) => res.status(404).json({ error: 'Not found.' }));

  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.use('/api', api);

  // ---------- static files ----------
  const longCache = { immutable: true, maxAge: '30d' };
  app.get('/vendor/htm-preact.js', (req, res) => res.sendFile(join(MODULES, 'htm', 'preact', 'standalone.module.js')));
  app.use('/fonts/bricolage', express.static(join(MODULES, '@fontsource-variable', 'bricolage-grotesque', 'files'), longCache));
  app.use('/fonts/instrument', express.static(join(MODULES, '@fontsource-variable', 'instrument-sans', 'files'), longCache));
  app.use(express.static(PUBLIC, { setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));
  // Every other GET is a page inside the single-page app.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || /\.\w+$/.test(req.path)) return next();
    res.set('Cache-Control', 'no-cache').sendFile(join(PUBLIC, 'index.html'));
  });

  app.use((err, req, res, next) => {
    if (err instanceof OpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return res.status(400).json({ error: 'That request could not be read.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server. Try again.' });
  });

  // ---------- WebSocket ----------
  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://x').pathname !== '/ws') return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });

  wss.on('connection', (ws) => {
    ws.alive = true;
    ws.on('pong', () => (ws.alive = true));
    ws.on('error', () => {});
    const send = (msg) => ws.send(JSON.stringify(msg));

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return ws.close(1003);
      }

      if (!ws.room) {
        // The first message says who is joining what.
        const kind = KINDS[msg.kind];
        const user = typeof msg.token === 'string' ? db.get('SELECT id, name FROM users WHERE token = ?', msg.token) : null;
        if (msg.type !== 'hello' || !kind) return ws.close(1008);
        if (!user) return send({ type: 'unauthorized' }), ws.close(1008);
        const id = String(msg.id ?? '');
        if (!db.get(`SELECT 1 AS x FROM ${kind.table} WHERE id = ?`, id)) return send({ type: 'gone' }), ws.close(1000);
        ws.user = { ...user };
        ws.kind = msg.kind;
        ws.sessionId = id;
        ws.room = `${msg.kind}:${id}`;
        kind.join(db, id, ws.user);
        if (!rooms.has(ws.room)) rooms.set(ws.room, new Set());
        rooms.get(ws.room).add(ws);
        return broadcast(ws.room);
      }

      if (msg.type !== 'op' || typeof msg.op !== 'string') return;
      try {
        const result = KINDS[ws.kind].apply(db, ws.sessionId, ws.user, msg.op, msg.args, onlineIn(ws.room));
        if (result.team) broadcastTeamRetros(db.get('SELECT team_id FROM retros WHERE id = ?', ws.sessionId).team_id);
        else broadcast(ws.room);
        send({ type: 'ack', seq: msg.seq });
      } catch (err) {
        if (!(err instanceof OpError)) console.error(err);
        send({ type: 'error', seq: msg.seq, message: err instanceof OpError ? err.message : 'Something went wrong. Try again.' });
        if (err.status === 404) broadcast(ws.room);
      }
    });

    ws.on('close', () => {
      const sockets = rooms.get(ws.room);
      if (!sockets || closing) return;
      sockets.delete(ws);
      if (sockets.size) broadcast(ws.room);
      else rooms.delete(ws.room);
    });
  });

  // Drop connections that silently went away (closed laptops, lost Wi-Fi).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) {
        ws.terminate();
        continue;
      }
      ws.alive = false;
      ws.ping();
    }
  }, 25_000);

  return new Promise((ready) => {
    server.listen(port, host, () => {
      ready({
        port: server.address().port,
        db,
        close: () =>
          new Promise((done) => {
            closing = true;
            clearInterval(heartbeat);
            for (const ws of wss.clients) ws.terminate();
            server.close(() => {
              db.close();
              done();
            });
          }),
      });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Settings come from command-line options (--port=8080 --data-dir=D:\retros)
  // or, failing that, from the environment.
  const option = (name) => process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const dataDir = resolve(option('data-dir') || process.env.DATA_DIR || join(ROOT, 'data'));
  if (process.argv.includes('--exit-with-parent')) {
    // Started by a keep-alive script (deploy/run.ps1 on Windows). If that script
    // goes away, stop too, so that stopping the scheduled task really stops the server.
    const parent = process.ppid;
    setInterval(() => {
      try {
        process.kill(parent, 0);
      } catch (err) {
        if (err.code === 'ESRCH') process.exit(0);
      }
    }, 2000).unref();
  }
  // Report a fatal error and exit only once it has been written out, so the
  // keep-alive script that reads our error output never misses the reason.
  const stop = (err) => process.stderr.write(`${format(err)}\n`, () => process.exit(1));
  process.on('uncaughtException', stop);
  const running = await startServer({
    port: Number(option('port') || process.env.PORT) || 3000,
    host: option('host') || process.env.HOST || '0.0.0.0',
    dbFile: join(dataDir, 'titan-up.db'),
  }).catch(stop);
  console.log(`Titan Up is running on http://localhost:${running.port} (data in ${dataDir})`);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => running.close().then(() => process.exit(0)));
  }
}
