// Action items belong to a team and outlive the retro they were created in.
import { newId, OpError, cleanText } from './db.js';

export function actionView(row) {
  return {
    id: row.id,
    retroId: row.retro_id,
    topicId: row.topic_id,
    text: row.text,
    owner: row.owner,
    done: !!row.done,
    createdAt: row.created_at,
    doneAt: row.done_at,
  };
}

export function addAction(db, { teamId, retroId = null, topicId = null, text, owner }) {
  const id = newId();
  db.run(
    'INSERT INTO action_items (id, team_id, retro_id, topic_id, text, owner, created_at) VALUES (?,?,?,?,?,?,?)',
    id, teamId, retroId, topicId,
    cleanText(text, 300, { what: 'The action item' }),
    cleanText(owner, 60, { required: false, what: 'The owner' }),
    Date.now(),
  );
  return id;
}

/** Returns the team id the action belongs to. Pass teamId to restrict the update to that team. */
export function updateAction(db, id, patch, teamId = null) {
  const row = db.get('SELECT * FROM action_items WHERE id = ?', id);
  if (!row || (teamId && row.team_id !== teamId)) throw new OpError('That action item no longer exists.', 404);
  const text = patch.text === undefined ? row.text : cleanText(patch.text, 300, { what: 'The action item' });
  const owner = patch.owner === undefined ? row.owner : cleanText(patch.owner, 60, { required: false, what: 'The owner' });
  let { done, done_at: doneAt } = row;
  if (patch.done !== undefined && !!patch.done !== !!row.done) {
    done = patch.done ? 1 : 0;
    doneAt = patch.done ? Date.now() : null;
  }
  db.run('UPDATE action_items SET text = ?, owner = ?, done = ?, done_at = ? WHERE id = ?', text, owner, done, doneAt, id);
  return row.team_id;
}

export function deleteAction(db, id, teamId = null) {
  const row = db.get('SELECT team_id FROM action_items WHERE id = ?', id);
  if (!row || (teamId && row.team_id !== teamId)) throw new OpError('That action item no longer exists.', 404);
  db.run('DELETE FROM action_items WHERE id = ?', id);
  return row.team_id;
}
