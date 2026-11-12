// End-to-end test of the server: two people run a whole retro and a health
// check over the real HTTP + WebSocket interface, against an in-memory database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startServer } from '../server/index.js';

let server;
let base;

before(async () => {
  server = await startServer({ port: 0, host: '127.0.0.1', dbFile: ':memory:' });
  base = `http://127.0.0.1:${server.port}`;
});
after(() => server.close());

async function call(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

/** A connected participant: `state` is always the latest view the server sent. */
async function connect(kind, id, token) {
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
  const client = { ws, state: null, seq: 0, pending: new Map(), waiters: [] };
  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.type === 'state') {
      client.state = msg.state;
      client.waiters = client.waiters.filter((w) => !(w.test(msg.state) && (w.resolve(msg.state), true)));
    } else if (msg.type === 'ack' || msg.type === 'error') {
      client.pending.get(msg.seq)?.(msg);
      client.pending.delete(msg.seq);
    } else if (msg.type === 'gone') {
      client.gone = true;
    }
  });
  await new Promise((resolve, reject) => ws.once('open', resolve).once('error', reject));
  ws.send(JSON.stringify({ type: 'hello', kind, id, token }));
  /** Send an op; resolves once it is acknowledged AND the resulting state has arrived. */
  client.op = (op, args) =>
    new Promise((resolve) => {
      const seq = ++client.seq;
      client.pending.set(seq, (msg) => resolve(msg.type === 'error' ? { error: msg.message } : { ok: true }));
      ws.send(JSON.stringify({ type: 'op', op, args, seq }));
    });
  client.until = (test) =>
    client.state && test(client.state) ? Promise.resolve(client.state) : new Promise((resolve) => client.waiters.push({ test, resolve }));
  await client.until(() => true);
  return client;
}

test('a full retro: private brainstorm, grouping, hidden votes, discussion, action items', async () => {
  const ana = (await call('POST', '/api/users', { name: 'Ana' })).body;
  const ben = (await call('POST', '/api/users', { name: 'Ben' })).body;
  assert.equal((await call('GET', '/api/teams')).status, 401, 'API needs a user');

  const team = (await call('POST', '/api/teams', { name: 'Platform' }, ana.token)).body;
  const made = await call('POST', `/api/teams/${team.id}/retros`, { title: 'Sprint 12', templateId: 'start-stop-continue', votesPerPerson: 3 }, ana.token);
  assert.equal(made.status, 201);
  const retroId = made.body.id;

  const a = await connect('retro', retroId, ana.token);
  const b = await connect('retro', retroId, ben.token);
  await a.until((s) => s.participants.length === 2 && s.participants.every((p) => p.online));
  assert.equal(a.state.phase, 'brainstorm', 'no open action items, so no review step');
  assert.equal(a.state.facilitatorId, ana.id);

  // Brainstorm: notes are private to their author.
  await a.op('addNote', { columnId: 'start', text: 'Pair on reviews' });
  await a.op('addNote', { columnId: 'stop', text: 'Friday deploys' });
  await b.op('addNote', { columnId: 'start', text: 'Review in pairs' });
  await b.until((s) => s.topics.length === 3);
  const hiddenFromBen = b.state.topics.flatMap((t) => t.notes).filter((n) => !n.mine);
  assert.equal(hiddenFromBen.length, 2);
  assert.ok(hiddenFromBen.every((n) => n.text === null), "other people's notes are unreadable while brainstorming");
  assert.ok(!JSON.stringify(b.state).includes('Friday deploys'));

  // Only the facilitator moves the retro along.
  assert.match((await b.op('setPhase', { phase: 'group' })).error, /facilitator/);
  assert.match((await b.op('merge', { sourceId: 'x', targetId: 'y' })).error, /Group step/);
  await a.op('setPhase', { phase: 'group' });
  await b.until((s) => s.phase === 'group');
  assert.ok(b.state.topics.flatMap((t) => t.notes).every((n) => typeof n.text === 'string'), 'notes are revealed for grouping');
  assert.ok(!JSON.stringify(b.state).includes(ana.id) || b.state.facilitatorId === ana.id, 'sanity');
  assert.ok(b.state.topics.every((t) => t.notes.every((n) => !('authorId' in n))), 'notes stay anonymous');

  // Group the two similar notes, name the group, then pull one out and put it back.
  const byText = (s, text) => s.topics.find((t) => t.notes.some((n) => n.text === text));
  await b.op('merge', { sourceId: byText(b.state, 'Review in pairs').id, targetId: byText(b.state, 'Pair on reviews').id });
  await b.until((s) => s.topics.length === 2);
  const group = byText(b.state, 'Pair on reviews');
  assert.equal(group.notes.length, 2);
  await b.op('renameTopic', { topicId: group.id, title: 'Pair reviews' });
  await b.op('ungroup', { noteId: group.notes[1].id });
  await b.until((s) => s.topics.length === 3);
  await b.op('merge', { sourceId: byText(b.state, 'Review in pairs').id, targetId: group.id });
  await b.until((s) => s.topics.length === 2);
  assert.match((await b.op('deleteNote', { noteId: byText(b.state, 'Friday deploys').notes[0].id })).error, /your own/);

  // Vote: three each, totals hidden until discussion.
  await a.op('setPhase', { phase: 'vote' });
  await b.until((s) => s.phase === 'vote');
  const deploys = byText(b.state, 'Friday deploys').id;
  await b.op('vote', { topicId: group.id });
  await b.op('vote', { topicId: group.id });
  await b.op('vote', { topicId: deploys });
  assert.match((await b.op('vote', { topicId: deploys })).error, /all your votes/);
  await a.op('vote', { topicId: deploys });
  await a.op('vote', { topicId: deploys });
  await a.until((s) => s.votesLeft === 1);
  assert.equal(a.state.topics.find((t) => t.id === deploys).votes, null, 'totals are hidden while voting');
  assert.equal(a.state.topics.find((t) => t.id === deploys).myVotes, 2);
  await b.op('unvote', { topicId: group.id });
  await b.until((s) => s.votesLeft === 1);

  // Discuss: most-voted topic comes first.
  await a.op('setPhase', { phase: 'discuss' });
  await b.until((s) => s.phase === 'discuss');
  assert.equal(b.state.currentTopicId, deploys);
  assert.equal(b.state.topics.find((t) => t.id === deploys).votes, 3);
  assert.equal(b.state.topics.find((t) => t.id === group.id).votes, 1);
  await b.op('addAction', { text: 'Move release day to Tuesday', owner: 'Ben', topicId: deploys });
  await a.until((s) => s.actions.length === 1);
  await a.op('nextTopic');
  await b.until((s) => s.currentTopicId === group.id);
  assert.ok(b.state.topics.find((t) => t.id === deploys).discussed);
  await a.op('setTimer', { seconds: 300 });
  await b.until((s) => s.timer?.duration === 300);
  await a.op('setPhase', { phase: 'done' });
  await b.until((s) => s.phase === 'done' && s.timer === null);

  // The open action item is reviewed at the start of the next retro.
  const next = (await call('POST', `/api/teams/${team.id}/retros`, { title: 'Sprint 13', templateId: 'mad-sad-glad' }, ben.token)).body;
  const c = await connect('retro', next.id, ben.token);
  assert.equal(c.state.phase, 'review');
  assert.equal(c.state.carried.length, 1);
  assert.equal(c.state.carried[0].text, 'Move release day to Tuesday');
  await c.op('updateAction', { id: c.state.carried[0].id, done: true });
  await c.until((s) => s.carried[0]?.done === true);

  const detail = (await call('GET', `/api/teams/${team.id}`, null, ana.token)).body;
  assert.equal(detail.retros.length, 2);
  assert.equal(detail.actions.filter((x) => !x.done).length, 0);

  // Facilitation can be picked up only when the facilitator has left.
  assert.match((await b.op('claimFacilitator')).error, /still here/);
  a.ws.close();
  await b.until((s) => s.participants.find((p) => p.id === ana.id).online === false);
  assert.ok((await b.op('claimFacilitator')).ok);
  await b.until((s) => s.facilitatorId === ben.id);

  // Deleting a retro sends everyone in it away.
  assert.equal((await call('DELETE', `/api/retros/${retroId}`, null, ben.token)).status, 200);
  await new Promise((resolve) => b.ws.once('close', resolve));
  assert.ok(b.gone);
  c.ws.close();
});

test('a health check: private ratings, reveal, comparison with the previous one', async () => {
  const ana = (await call('POST', '/api/users', { name: 'Ana' })).body;
  const ben = (await call('POST', '/api/users', { name: 'Ben' })).body;
  const team = (await call('POST', '/api/teams', { name: 'Payments' }, ana.token)).body;
  const dimensions = [{ name: 'Pace' }, { name: 'Quality' }, { name: 'Enjoyment' }];
  assert.equal((await call('POST', `/api/teams/${team.id}/radars`, { title: 'Q1', dimensions: dimensions.slice(0, 2) }, ana.token)).status, 400);

  async function run(title, anaValues, benValues) {
    const { id } = (await call('POST', `/api/teams/${team.id}/radars`, { title, dimensions }, ana.token)).body;
    const a = await connect('radar', id, ana.token);
    const b = await connect('radar', id, ben.token);
    for (const [dim, value] of anaValues.entries()) await a.op('rate', { dim, value });
    for (const [dim, value] of benValues.entries()) await b.op('rate', { dim, value, comment: dim === 0 ? 'Too many handoffs' : '' });
    await a.until((s) => s.participants.length === 2 && s.participants.every((p) => p.finished));
    assert.equal(a.state.results, null, 'no results before the reveal');
    assert.equal(a.state.myRatings[0].value, anaValues[0]);
    assert.match((await a.op('rate', { dim: 0, value: 9 })).error, /1 to 5/);
    await a.op('setPhase', { phase: 'reveal' });
    const state = await b.until((s) => s.phase === 'reveal');
    assert.match((await b.op('rate', { dim: 0, value: 1 })).error, /closed/);
    a.ws.close();
    b.ws.close();
    return state;
  }

  const first = await run('Q1', [2, 4, 5], [4, 4, 3]);
  assert.deepEqual(first.results.map((r) => r.avg), [3, 4, 4]);
  assert.deepEqual(first.results[0].counts, [0, 1, 0, 1, 0]);
  assert.deepEqual(first.results[0].comments, [{ value: 4, text: 'Too many handoffs' }]);
  assert.equal(first.respondents, 2);
  assert.equal(first.previous, null);

  const second = await run('Q2', [4, 4, 5], [4, 2, 5]);
  assert.deepEqual(second.results.map((r) => r.avg), [4, 3, 5]);
  assert.deepEqual(second.previous.avgs, [3, 4, 4]);

  const detail = (await call('GET', `/api/teams/${team.id}`, null, ana.token)).body;
  assert.deepEqual(detail.radars.map((r) => r.title), ['Q2', 'Q1']);
  assert.deepEqual(detail.radars[0].results.map((r) => r.avg), [4, 3, 5]);
});
