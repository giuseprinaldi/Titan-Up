import { newId, OpError, cleanText } from './db.js';
import { RETRO_TEMPLATES } from './templates.js';
import { actionView, addAction, updateAction, deleteAction } from './actions.js';

export const RETRO_PHASES = ['review', 'brainstorm', 'group', 'vote', 'discuss', 'done'];

export function createRetro(db, { teamId, title, templateId, votesPerPerson, user }) {
  const template = RETRO_TEMPLATES.find((t) => t.id === templateId);
  if (!template) throw new OpError('Pick a format for the retro.');
  const votes = clampInt(votesPerPerson ?? 5, 1, 20, 'Votes per person');
  const hasOpenActions = !!db.get('SELECT 1 AS x FROM action_items WHERE team_id = ? AND done = 0 LIMIT 1', teamId);
  const id = newId();
  db.run(
    `INSERT INTO retros (id, team_id, title, template, columns, phase, review_enabled, votes_per_person,
       facilitator_id, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id, teamId, cleanText(title, 120, { what: 'The title' }), template.id, JSON.stringify(template.columns),
    hasOpenActions ? 'review' : 'brainstorm', hasOpenActions ? 1 : 0, votes, user.id, user.id, Date.now(),
  );
  return id;
}

export function joinRetro(db, retroId, user) {
  db.run('INSERT OR IGNORE INTO retro_participants (retro_id, user_id, joined_at) VALUES (?,?,?)', retroId, user.id, Date.now());
}

function clampInt(value, min, max, what) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new OpError(`${what} must be between ${min} and ${max}.`);
  return n;
}

function loadRetro(db, retroId) {
  const retro = db.get('SELECT * FROM retros WHERE id = ?', retroId);
  if (!retro) throw new OpError('This retro no longer exists.', 404);
  return retro;
}

/** Topics ordered for discussion: most votes first, board order as the tiebreak. */
function rankedTopics(db, retroId) {
  return db.all(
    `SELECT t.*, (SELECT COUNT(*) FROM votes v WHERE v.topic_id = t.id) AS votes
     FROM topics t WHERE t.retro_id = ? ORDER BY votes DESC, t.position ASC`,
    retroId,
  );
}

/**
 * The retro as one particular person is allowed to see it.
 * Notes are anonymous to everyone, other people's notes stay unreadable while
 * brainstorming, and vote totals stay hidden until voting is over.
 */
export function retroView(db, retroId, user, online = new Set()) {
  const retro = db.get('SELECT * FROM retros WHERE id = ?', retroId);
  if (!retro) return null;
  const team = db.get('SELECT id, name FROM teams WHERE id = ?', retro.team_id);
  const hideOthers = retro.phase === 'review' || retro.phase === 'brainstorm';
  const showTotals = retro.phase === 'discuss' || retro.phase === 'done';

  const notesByTopic = new Map();
  const noteCounts = new Map();
  for (const n of db.all('SELECT * FROM notes WHERE retro_id = ? ORDER BY created_at, id', retroId)) {
    const mine = n.author_id === user.id;
    const view = { id: n.id, mine, text: hideOthers && !mine ? null : n.text };
    if (!notesByTopic.has(n.topic_id)) notesByTopic.set(n.topic_id, []);
    notesByTopic.get(n.topic_id).push(view);
    noteCounts.set(n.author_id, (noteCounts.get(n.author_id) || 0) + 1);
  }

  const totals = new Map();
  const mine = new Map();
  const usedBy = new Map();
  for (const v of db.all('SELECT topic_id, user_id, COUNT(*) AS c FROM votes WHERE retro_id = ? GROUP BY topic_id, user_id', retroId)) {
    totals.set(v.topic_id, (totals.get(v.topic_id) || 0) + v.c);
    usedBy.set(v.user_id, (usedBy.get(v.user_id) || 0) + v.c);
    if (v.user_id === user.id) mine.set(v.topic_id, v.c);
  }

  const topics = db
    .all('SELECT * FROM topics WHERE retro_id = ? ORDER BY position, id', retroId)
    .map((t) => ({
      id: t.id,
      columnId: t.column_id,
      title: t.title,
      discussed: !!t.discussed,
      notes: notesByTopic.get(t.id) || [],
      votes: showTotals ? totals.get(t.id) || 0 : null,
      myVotes: mine.get(t.id) || 0,
    }));

  const participants = db
    .all(
      `SELECT u.id, u.name FROM retro_participants p JOIN users u ON u.id = p.user_id
       WHERE p.retro_id = ? ORDER BY p.joined_at`,
      retroId,
    )
    .map((p) => ({
      id: p.id,
      name: p.name,
      online: online.has(p.id),
      notes: noteCounts.get(p.id) || 0,
      votesLeft: Math.max(0, retro.votes_per_person - (usedBy.get(p.id) || 0)),
    }));

  const allActions = db.all('SELECT * FROM action_items WHERE team_id = ? ORDER BY created_at, id', retro.team_id);
  const actions = allActions.filter((a) => a.retro_id === retro.id).map(actionView);
  // Earlier commitments this retro looks back on: still open, or closed out while this retro was running.
  const carried = allActions
    .filter((a) => {
      if (a.retro_id === retro.id || a.created_at >= retro.created_at) return false;
      if (retro.closed_at) return a.done && a.done_at >= retro.created_at && a.done_at <= retro.closed_at;
      return !a.done || a.done_at >= retro.created_at;
    })
    .map(actionView);

  return {
    kind: 'retro',
    id: retro.id,
    team,
    title: retro.title,
    phase: retro.phase,
    phases: RETRO_PHASES.filter((p) => p !== 'review' || retro.review_enabled),
    columns: JSON.parse(retro.columns),
    votesPerPerson: retro.votes_per_person,
    votesLeft: Math.max(0, retro.votes_per_person - (usedBy.get(user.id) || 0)),
    facilitatorId: retro.facilitator_id,
    createdBy: retro.created_by,
    createdAt: retro.created_at,
    currentTopicId: retro.current_topic_id,
    timer: retro.timer_ends_at ? { endsAt: retro.timer_ends_at, duration: retro.timer_duration } : null,
    now: Date.now(),
    me: { id: user.id, name: user.name },
    participants,
    topics,
    actions,
    carried,
  };
}

const NOTE_PHASES = ['brainstorm', 'group'];

/**
 * Apply one change to a retro on behalf of a user. Throws OpError when the
 * change isn't allowed. Returns { team: true } when action items changed, so
 * the caller can refresh the team's other open retros too.
 */
export function applyRetroOp(db, retroId, user, op, args = {}, online = new Set()) {
  const handler = OPS[op];
  if (!handler) throw new OpError('Unknown action.');
  return db.tx(() => {
    const retro = loadRetro(db, retroId);
    return handler({ db, retro, user, args: args || {}, online }) || {};
  });
}

function needFacilitator({ retro, user }) {
  if (retro.facilitator_id !== user.id) throw new OpError('Only the facilitator can do that.', 403);
}

function needPhase({ retro }, phases, message) {
  if (!phases.includes(retro.phase)) throw new OpError(message);
}

function loadTopic({ db, retro }, topicId) {
  const topic = db.get('SELECT * FROM topics WHERE id = ? AND retro_id = ?', String(topicId ?? ''), retro.id);
  if (!topic) throw new OpError('That card no longer exists.', 404);
  return topic;
}

function loadNote({ db, retro }, noteId) {
  const note = db.get('SELECT * FROM notes WHERE id = ? AND retro_id = ?', String(noteId ?? ''), retro.id);
  if (!note) throw new OpError('That note no longer exists.', 404);
  return note;
}

function nextPosition(db, retroId) {
  return (db.get('SELECT MAX(position) AS p FROM topics WHERE retro_id = ?', retroId).p ?? 0) + 1;
}

const OPS = {
  addNote(ctx) {
    const { db, retro, user, args } = ctx;
    needPhase(ctx, NOTE_PHASES, 'Notes can only be added while brainstorming or grouping.');
    const columns = JSON.parse(retro.columns);
    if (!columns.some((c) => c.id === args.columnId)) throw new OpError('That column does not exist.');
    const text = cleanText(args.text, 500, { what: 'A note' });
    const topicId = newId();
    db.run('INSERT INTO topics (id, retro_id, column_id, position) VALUES (?,?,?,?)', topicId, retro.id, args.columnId, nextPosition(db, retro.id));
    db.run('INSERT INTO notes (id, retro_id, topic_id, author_id, text, created_at) VALUES (?,?,?,?,?,?)', newId(), retro.id, topicId, user.id, text, Date.now());
  },

  editNote(ctx) {
    const { db, user, args } = ctx;
    needPhase(ctx, NOTE_PHASES, 'Notes can only be edited while brainstorming or grouping.');
    const note = loadNote(ctx, args.noteId);
    if (note.author_id !== user.id) throw new OpError('You can only edit your own notes.', 403);
    db.run('UPDATE notes SET text = ? WHERE id = ?', cleanText(args.text, 500, { what: 'A note' }), note.id);
  },

  deleteNote(ctx) {
    const { db, user, args } = ctx;
    needPhase(ctx, NOTE_PHASES, 'Notes can only be deleted while brainstorming or grouping.');
    const note = loadNote(ctx, args.noteId);
    if (note.author_id !== user.id) throw new OpError('You can only delete your own notes.', 403);
    db.run('DELETE FROM notes WHERE id = ?', note.id);
    if (!db.get('SELECT 1 AS x FROM notes WHERE topic_id = ? LIMIT 1', note.topic_id)) {
      db.run('DELETE FROM topics WHERE id = ?', note.topic_id);
    }
  },

  // Fold one card (or group) into another.
  merge(ctx) {
    const { db, retro, args } = ctx;
    needPhase(ctx, ['group'], 'Cards can only be grouped during the Group step.');
    const source = loadTopic(ctx, args.sourceId);
    const target = loadTopic(ctx, args.targetId);
    if (source.id === target.id) return;
    db.run('UPDATE notes SET topic_id = ? WHERE topic_id = ?', target.id, source.id);
    db.run('UPDATE votes SET topic_id = ? WHERE topic_id = ?', target.id, source.id);
    db.run('UPDATE action_items SET topic_id = ? WHERE topic_id = ?', target.id, source.id);
    if (!target.title && source.title) db.run('UPDATE topics SET title = ? WHERE id = ?', source.title, target.id);
    if (retro.current_topic_id === source.id) db.run('UPDATE retros SET current_topic_id = ? WHERE id = ?', target.id, retro.id);
    db.run('DELETE FROM topics WHERE id = ?', source.id);
  },

  // Pull one note back out of a group into its own card.
  ungroup(ctx) {
    const { db, retro, args } = ctx;
    needPhase(ctx, ['group'], 'Cards can only be regrouped during the Group step.');
    const note = loadNote(ctx, args.noteId);
    const siblings = db.get('SELECT COUNT(*) AS c FROM notes WHERE topic_id = ?', note.topic_id).c;
    if (siblings < 2) return;
    const from = loadTopic(ctx, note.topic_id);
    const topicId = newId();
    db.run('INSERT INTO topics (id, retro_id, column_id, position) VALUES (?,?,?,?)', topicId, retro.id, from.column_id, from.position + 0.5);
    db.run('UPDATE notes SET topic_id = ? WHERE id = ?', topicId, note.id);
    if (siblings === 2) db.run("UPDATE topics SET title = '' WHERE id = ?", from.id);
  },

  moveTopic(ctx) {
    const { db, retro, args } = ctx;
    needPhase(ctx, ['group'], 'Cards can only be moved during the Group step.');
    const topic = loadTopic(ctx, args.topicId);
    const columns = JSON.parse(retro.columns);
    if (!columns.some((c) => c.id === args.columnId)) throw new OpError('That column does not exist.');
    db.run('UPDATE topics SET column_id = ?, position = ? WHERE id = ?', args.columnId, nextPosition(db, retro.id), topic.id);
  },

  renameTopic(ctx) {
    const { db, args } = ctx;
    needPhase(ctx, ['group', 'vote', 'discuss'], 'Groups can no longer be renamed.');
    const topic = loadTopic(ctx, args.topicId);
    db.run('UPDATE topics SET title = ? WHERE id = ?', cleanText(args.title, 80, { required: false, what: 'The group name' }), topic.id);
  },

  vote(ctx) {
    const { db, retro, user, args } = ctx;
    needPhase(ctx, ['vote'], 'Voting is not open right now.');
    const topic = loadTopic(ctx, args.topicId);
    const used = db.get('SELECT COUNT(*) AS c FROM votes WHERE retro_id = ? AND user_id = ?', retro.id, user.id).c;
    if (used >= retro.votes_per_person) throw new OpError('You have used all your votes. Take one back to move it.');
    db.run('INSERT INTO votes (retro_id, topic_id, user_id) VALUES (?,?,?)', retro.id, topic.id, user.id);
  },

  unvote(ctx) {
    const { db, user, args } = ctx;
    needPhase(ctx, ['vote'], 'Voting is not open right now.');
    const topic = loadTopic(ctx, args.topicId);
    const vote = db.get('SELECT id FROM votes WHERE topic_id = ? AND user_id = ? LIMIT 1', topic.id, user.id);
    if (vote) db.run('DELETE FROM votes WHERE id = ?', vote.id);
  },

  setPhase(ctx) {
    const { db, retro, args } = ctx;
    needFacilitator(ctx);
    const allowed = RETRO_PHASES.filter((p) => p !== 'review' || retro.review_enabled);
    if (!allowed.includes(args.phase)) throw new OpError('That step does not exist.');
    let current = retro.current_topic_id;
    if (current && !db.get('SELECT 1 AS x FROM topics WHERE id = ?', current)) current = null;
    if (args.phase === 'discuss' && !current) {
      current = rankedTopics(db, retro.id).find((t) => !t.discussed)?.id ?? null;
    }
    db.run(
      'UPDATE retros SET phase = ?, current_topic_id = ?, timer_ends_at = NULL, timer_duration = NULL, closed_at = ? WHERE id = ?',
      args.phase, current, args.phase === 'done' ? retro.closed_at ?? Date.now() : null, retro.id,
    );
  },

  setCurrentTopic(ctx) {
    const { db, retro, args } = ctx;
    needFacilitator(ctx);
    needPhase(ctx, ['discuss'], 'Topics are picked during the Discuss step.');
    const topic = loadTopic(ctx, args.topicId);
    db.run('UPDATE retros SET current_topic_id = ? WHERE id = ?', topic.id, retro.id);
  },

  setDiscussed(ctx) {
    const { db, args } = ctx;
    needFacilitator(ctx);
    const topic = loadTopic(ctx, args.topicId);
    db.run('UPDATE topics SET discussed = ? WHERE id = ?', args.discussed ? 1 : 0, topic.id);
  },

  // Mark the current topic as covered and move to the next one in vote order.
  nextTopic(ctx) {
    const { db, retro } = ctx;
    needFacilitator(ctx);
    needPhase(ctx, ['discuss'], 'Topics are picked during the Discuss step.');
    if (retro.current_topic_id) db.run('UPDATE topics SET discussed = 1 WHERE id = ?', retro.current_topic_id);
    const next = rankedTopics(db, retro.id).find((t) => !t.discussed);
    db.run('UPDATE retros SET current_topic_id = ?, timer_ends_at = NULL, timer_duration = NULL WHERE id = ?', next?.id ?? null, retro.id);
  },

  setTimer(ctx) {
    const { db, retro, args } = ctx;
    needFacilitator(ctx);
    const seconds = clampInt(args.seconds, 10, 3600, 'The timer');
    db.run('UPDATE retros SET timer_ends_at = ?, timer_duration = ? WHERE id = ?', Date.now() + seconds * 1000, seconds, retro.id);
  },

  clearTimer(ctx) {
    needFacilitator(ctx);
    ctx.db.run('UPDATE retros SET timer_ends_at = NULL, timer_duration = NULL WHERE id = ?', ctx.retro.id);
  },

  updateSettings(ctx) {
    const { db, retro, args } = ctx;
    needFacilitator(ctx);
    const title = args.title === undefined ? retro.title : cleanText(args.title, 120, { what: 'The title' });
    const votes = args.votesPerPerson === undefined ? retro.votes_per_person : clampInt(args.votesPerPerson, 1, 20, 'Votes per person');
    db.run('UPDATE retros SET title = ?, votes_per_person = ? WHERE id = ?', title, votes, retro.id);
  },

  setFacilitator(ctx) {
    const { db, retro, args } = ctx;
    needFacilitator(ctx);
    const member = db.get('SELECT 1 AS x FROM retro_participants WHERE retro_id = ? AND user_id = ?', retro.id, String(args.userId ?? ''));
    if (!member) throw new OpError('That person has not joined this retro.');
    db.run('UPDATE retros SET facilitator_id = ? WHERE id = ?', args.userId, retro.id);
  },

  // Anyone can pick up facilitation when the facilitator is not connected.
  claimFacilitator(ctx) {
    const { db, retro, user, online } = ctx;
    if (retro.facilitator_id !== user.id && online.has(retro.facilitator_id)) {
      throw new OpError('The facilitator is still here. Ask them to hand over.');
    }
    db.run('UPDATE retros SET facilitator_id = ? WHERE id = ?', user.id, retro.id);
  },

  addAction(ctx) {
    const { db, retro, args } = ctx;
    const topicId = args.topicId ? loadTopic(ctx, args.topicId).id : null;
    addAction(db, { teamId: retro.team_id, retroId: retro.id, topicId, text: args.text, owner: args.owner });
    return { team: true };
  },

  updateAction(ctx) {
    updateAction(ctx.db, String(ctx.args.id ?? ''), ctx.args, ctx.retro.team_id);
    return { team: true };
  },

  deleteAction(ctx) {
    deleteAction(ctx.db, String(ctx.args.id ?? ''), ctx.retro.team_id);
    return { team: true };
  },
};
