// Health checks: everyone privately rates a set of dimensions from 1 to 5,
// then the facilitator reveals the averages on a radar chart.
import { newId, OpError, cleanText } from './db.js';

export const RADAR_PHASES = ['collect', 'reveal', 'done'];

export function createRadar(db, { teamId, title, dimensions, user }) {
  if (!Array.isArray(dimensions)) throw new OpError('Add at least three things to rate.');
  const dims = dimensions
    .map((d) => ({
      name: cleanText(d?.name, 40, { required: false, what: 'A dimension name' }),
      description: cleanText(d?.description, 160, { required: false, what: 'A dimension description' }),
    }))
    .filter((d) => d.name);
  if (dims.length < 3) throw new OpError('Add at least three things to rate.');
  if (dims.length > 12) throw new OpError('Keep it to twelve things to rate at most.');
  if (new Set(dims.map((d) => d.name.toLowerCase())).size !== dims.length) throw new OpError('Each thing to rate needs a different name.');
  const id = newId();
  db.run(
    'INSERT INTO radars (id, team_id, title, dimensions, phase, facilitator_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)',
    id, teamId, cleanText(title, 120, { what: 'The title' }), JSON.stringify(dims), 'collect', user.id, user.id, Date.now(),
  );
  return id;
}

export function joinRadar(db, radarId, user) {
  db.run('INSERT OR IGNORE INTO radar_participants (radar_id, user_id, joined_at) VALUES (?,?,?)', radarId, user.id, Date.now());
}

/** Per-dimension results for one health check: average, 1-5 counts, comments. */
export function radarResults(db, radar) {
  const dims = JSON.parse(radar.dimensions);
  const results = dims.map((d) => ({ name: d.name, avg: null, counts: [0, 0, 0, 0, 0], comments: [] }));
  const respondents = new Set();
  for (const r of db.all('SELECT * FROM radar_ratings WHERE radar_id = ? ORDER BY dim, value', radar.id)) {
    const res = results[r.dim];
    if (!res) continue;
    res.counts[r.value - 1] += 1;
    if (r.comment) res.comments.push({ value: r.value, text: r.comment });
    respondents.add(r.user_id);
  }
  for (const res of results) {
    const n = res.counts.reduce((a, b) => a + b, 0);
    if (n) res.avg = res.counts.reduce((sum, c, i) => sum + c * (i + 1), 0) / n;
  }
  return { results, respondents: respondents.size };
}

export function radarView(db, radarId, user, online = new Set()) {
  const radar = db.get('SELECT * FROM radars WHERE id = ?', radarId);
  if (!radar) return null;
  const team = db.get('SELECT id, name FROM teams WHERE id = ?', radar.team_id);
  const dimensions = JSON.parse(radar.dimensions);
  const revealed = radar.phase !== 'collect';

  const answered = new Map();
  const myRatings = {};
  for (const r of db.all('SELECT user_id, dim, value, comment FROM radar_ratings WHERE radar_id = ?', radarId)) {
    answered.set(r.user_id, (answered.get(r.user_id) || 0) + 1);
    if (r.user_id === user.id) myRatings[r.dim] = { value: r.value, comment: r.comment };
  }

  const participants = db
    .all(
      `SELECT u.id, u.name FROM radar_participants p JOIN users u ON u.id = p.user_id
       WHERE p.radar_id = ? ORDER BY p.joined_at`,
      radarId,
    )
    .map((p) => ({ id: p.id, name: p.name, online: online.has(p.id), finished: (answered.get(p.id) || 0) >= dimensions.length }));

  let results = null;
  let respondents = 0;
  let previous = null;
  if (revealed) {
    ({ results, respondents } = radarResults(db, radar));
    // The most recent earlier check, matched up by dimension name, for comparison.
    const prev = db.get(
      "SELECT * FROM radars WHERE team_id = ? AND created_at < ? AND phase != 'collect' ORDER BY created_at DESC LIMIT 1",
      radar.team_id, radar.created_at,
    );
    if (prev) {
      const prevResults = radarResults(db, prev);
      const byName = new Map(prevResults.results.map((r) => [r.name.toLowerCase(), r.avg]));
      const avgs = dimensions.map((d) => byName.get(d.name.toLowerCase()) ?? null);
      if (prevResults.respondents && avgs.some((a) => a !== null)) {
        previous = { id: prev.id, title: prev.title, createdAt: prev.created_at, avgs };
      }
    }
  }

  return {
    kind: 'radar',
    id: radar.id,
    team,
    title: radar.title,
    phase: radar.phase,
    phases: RADAR_PHASES,
    dimensions,
    facilitatorId: radar.facilitator_id,
    createdBy: radar.created_by,
    createdAt: radar.created_at,
    me: { id: user.id, name: user.name },
    participants,
    myRatings,
    results,
    respondents,
    previous,
  };
}

export function applyRadarOp(db, radarId, user, op, args = {}, online = new Set()) {
  const handler = OPS[op];
  if (!handler) throw new OpError('Unknown action.');
  return db.tx(() => {
    const radar = db.get('SELECT * FROM radars WHERE id = ?', radarId);
    if (!radar) throw new OpError('This health check no longer exists.', 404);
    return handler({ db, radar, user, args: args || {}, online }) || {};
  });
}

function needFacilitator({ radar, user }) {
  if (radar.facilitator_id !== user.id) throw new OpError('Only the facilitator can do that.', 403);
}

const OPS = {
  rate({ db, radar, user, args }) {
    if (radar.phase !== 'collect') throw new OpError('Ratings are closed for this health check.');
    const dims = JSON.parse(radar.dimensions);
    const dim = Number(args.dim);
    if (!Number.isInteger(dim) || dim < 0 || dim >= dims.length) throw new OpError('That is not one of the things to rate.');
    const value = Number(args.value);
    if (!Number.isInteger(value) || value < 1 || value > 5) throw new OpError('Ratings go from 1 to 5.');
    const comment = cleanText(args.comment, 300, { required: false, what: 'The comment' });
    db.run(
      `INSERT INTO radar_ratings (radar_id, user_id, dim, value, comment) VALUES (?,?,?,?,?)
       ON CONFLICT (radar_id, user_id, dim) DO UPDATE SET value = excluded.value, comment = excluded.comment`,
      radar.id, user.id, dim, value, comment,
    );
  },

  setPhase(ctx) {
    const { db, radar, args } = ctx;
    needFacilitator(ctx);
    if (!RADAR_PHASES.includes(args.phase)) throw new OpError('That step does not exist.');
    db.run('UPDATE radars SET phase = ?, closed_at = ? WHERE id = ?', args.phase, args.phase === 'done' ? radar.closed_at ?? Date.now() : null, radar.id);
  },

  updateSettings(ctx) {
    needFacilitator(ctx);
    ctx.db.run('UPDATE radars SET title = ? WHERE id = ?', cleanText(ctx.args.title, 120, { what: 'The title' }), ctx.radar.id);
  },

  setFacilitator(ctx) {
    const { db, radar, args } = ctx;
    needFacilitator(ctx);
    const member = db.get('SELECT 1 AS x FROM radar_participants WHERE radar_id = ? AND user_id = ?', radar.id, String(args.userId ?? ''));
    if (!member) throw new OpError('That person has not joined this health check.');
    db.run('UPDATE radars SET facilitator_id = ? WHERE id = ?', args.userId, radar.id);
  },

  claimFacilitator({ db, radar, user, online }) {
    if (radar.facilitator_id !== user.id && online.has(radar.facilitator_id)) {
      throw new OpError('The facilitator is still here. Ask them to hand over.');
    }
    db.run('UPDATE radars SET facilitator_id = ? WHERE id = ?', user.id, radar.id);
  },
};
