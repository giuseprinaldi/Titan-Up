import { html, useState, useEffect, useRef, useRoom, go, plural } from './lib.js';
import { AppBar, SessionFrame, PhaseRail, People, CopyLinkButton, EditableTitle, ActionForm, ActionList, Popover, Icon, useNow } from './ui.js';

export const RETRO_STEPS = {
  review: { label: 'Review', hint: 'Look back at what the team agreed last time, and tick off what got done.' },
  brainstorm: { label: 'Brainstorm', hint: 'Write one thought per note. Nobody else can read your notes until grouping starts.' },
  group: { label: 'Group', hint: 'Drag a note onto a similar one to group them, then give each group a name.' },
  vote: { label: 'Vote', hint: 'Spend your votes on what you most want to talk about. Totals stay hidden until voting ends.' },
  discuss: { label: 'Discuss', hint: 'Work through the topics from most votes to fewest, and write down what you agree to do.' },
  done: { label: 'Wrap up', hint: 'This retro is finished. Open action items come back at the start of the next one.' },
};

const topicLabel = (t) => t.title || t.notes.find((n) => n.text)?.text || 'Empty card';
/** Discussion order: most votes first, board order as the tiebreak. */
const ranked = (topics) => topics.map((t, i) => ({ t, i })).sort((a, b) => (b.t.votes || 0) - (a.t.votes || 0) || a.i - b.i).map((x) => x.t);

export function RetroPage({ retroId }) {
  const room = useRoom('retro', retroId);
  return html`<${SessionFrame} room=${room} noun="retro">${room.state && html`<${Retro} state=${room.state} send=${room.send} />`}<//>`;
}

function Retro({ state, send }) {
  const lead = state.facilitatorId === state.me.id;
  const steps = state.phases.map((id) => ({ id, ...RETRO_STEPS[id] }));
  const statusOf = (p) =>
    state.phase === 'brainstorm' ? plural(p.notes, 'note') : state.phase === 'vote' ? (p.votesLeft ? `${plural(p.votesLeft, 'vote')} left` : 'Finished voting') : null;
  const nextLabel = state.phase === 'discuss' ? 'Finish retro' : null;

  useEffect(() => {
    document.title = `${state.title} | Titan Up`;
    return () => (document.title = 'Titan Up');
  }, [state.title]);

  return html`
    <${AppBar}
      crumbs=${[
        { label: state.team.name, href: `/t/${state.team.id}` },
        { label: html`<${EditableTitle} value=${state.title} canEdit=${lead} onSave=${(title) => send('updateSettings', { title })} />` },
      ]}
    >
      <${People} state=${state} send=${send} statusOf=${statusOf} />
      <${CopyLinkButton} />
    <//>
    <${PhaseRail} steps=${steps} current=${state.phase} canSteer=${lead} onStep=${(phase) => send('setPhase', { phase })} nextLabel=${nextLabel}>
      ${state.phase !== 'done' && html`<${Timer} state=${state} send=${send} lead=${lead} />`}
    <//>
    ${state.phase === 'review' && html`<${Review} state=${state} send=${send} />`}
    ${['brainstorm', 'group', 'vote'].includes(state.phase) && html`<${Board} state=${state} send=${send} lead=${lead} />`}
    ${state.phase === 'discuss' && html`<${Discuss} state=${state} send=${send} lead=${lead} />`}
    ${state.phase === 'done' && html`<${Summary} state=${state} send=${send} />`}
  `;
}

// ---------- timer ----------

function Timer({ state, send, lead }) {
  const { timer } = state;
  const now = useNow(!!timer) + state.clockOffset;
  if (!timer) {
    if (!lead) return null;
    return html`
      <${Popover} label=${html`${Icon.clock} Start a timer`} buttonClass="btn rail-btn" align="right">
        <div class="timer-presets">
          ${[1, 2, 3, 5, 10, 15].map((m) => html`<button class="btn small" data-close onClick=${() => send('setTimer', { seconds: m * 60 })}>${m} min</button>`)}
        </div>
      <//>
    `;
  }
  const left = Math.max(0, Math.ceil((timer.endsAt - now) / 1000));
  const text = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  return html`
    <span class="timer ${left === 0 ? 'over' : left <= 10 ? 'ending' : ''}" role="timer" aria-live="off">
      ${Icon.clock}
      <span class="timer-text">${left === 0 ? "Time's up" : text}</span>
      ${lead && html`
        <button class="btn small rail-btn" onClick=${() => send('setTimer', { seconds: Math.min(3600, left + 60) })}>Add 1 min</button>
        <button class="btn small rail-btn" onClick=${() => send('clearTimer')}>Stop</button>
      `}
    </span>
  `;
}

// ---------- review ----------

function Review({ state, send }) {
  const doneCount = state.carried.filter((a) => a.done).length;
  return html`
    <main class="page narrow">
      <h2>Action items from earlier retros <span class="count">${doneCount} of ${state.carried.length} done</span></h2>
      <${ActionList}
        items=${state.carried}
        onChange=${(id, patch) => send('updateAction', { id, ...patch })}
        onDelete=${(id) => send('deleteAction', { id })}
        empty="Every earlier action item has been dealt with."
      />
      <p class="quiet">Anything left open stays on the team page and comes back next time.</p>
    </main>
  `;
}

// ---------- board: brainstorm, group, vote ----------

function Board({ state, send, lead }) {
  const { phase } = state;
  // Grouping works by drag and drop, or by "picking up" a card and choosing where it goes.
  const [held, setHeld] = useState(null);
  const [dragging, setDragging] = useState(null);
  const moving = dragging || held;
  useEffect(() => {
    if (held && (phase !== 'group' || !state.topics.some((t) => t.id === held))) setHeld(null);
  }, [phase, state.topics, held]);
  useEffect(() => {
    if (!held) return;
    const onKey = (e) => e.key === 'Escape' && setHeld(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [held]);

  const dropOnTopic = (targetId) => {
    if (moving && moving !== targetId) send('merge', { sourceId: moving, targetId });
    setHeld(null);
    setDragging(null);
  };
  const dropOnColumn = (columnId) => {
    const topic = state.topics.find((t) => t.id === moving);
    if (topic && topic.columnId !== columnId) send('moveTopic', { topicId: moving, columnId });
    setHeld(null);
    setDragging(null);
  };
  const grouping = { held, dragging, moving, setHeld, setDragging, dropOnTopic, dropOnColumn };

  return html`
    <${BoardStatus} state=${state} send=${send} lead=${lead} held=${held} onCancel=${() => setHeld(null)} />
    <main class="board" style="--cols: ${state.columns.length}">
      ${state.columns.map((col) => html`<${Column} key=${col.id} col=${col} state=${state} send=${send} grouping=${grouping} />`)}
    </main>
  `;
}

function BoardStatus({ state, send, lead, held, onCancel }) {
  const { phase, participants } = state;
  const here = participants.filter((p) => p.online);
  let content = null;
  if (phase === 'brainstorm') {
    const total = state.topics.reduce((n, t) => n + t.notes.length, 0);
    const mine = state.topics.reduce((n, t) => n + t.notes.filter((x) => x.mine).length, 0);
    content = html`<span>${plural(total, 'note')} on the board, ${mine} of them yours.</span>`;
  } else if (phase === 'group') {
    content = held
      ? html`<span class="strong">Choose the card it belongs with, or a column to move it to.</span> <button class="btn small" onClick=${onCancel}>Put it back</button>`
      : html`<span>${plural(state.topics.length, 'card')}. Dragging not working for you? Use “Pick up” on a card instead.</span>`;
  } else if (phase === 'vote') {
    const used = state.votesPerPerson - state.votesLeft;
    const finished = here.filter((p) => p.votesLeft === 0).length;
    content = html`
      <span class="vote-budget" aria-label="${state.votesLeft} of ${state.votesPerPerson} votes left">
        ${Array.from({ length: state.votesPerPerson }, (_, i) => html`<i class=${i < used ? 'dot spent' : 'dot'} />`)}
      </span>
      <span class="strong">${state.votesLeft ? `${plural(state.votesLeft, 'vote')} left` : 'All your votes are placed'}</span>
      <span>${finished} of ${plural(here.length, 'person', 'people')} finished</span>
      ${lead && html`
        <span class="stepper">
          Votes each
          <button class="btn small" aria-label="Fewer votes each" disabled=${state.votesPerPerson <= 1} onClick=${() => send('updateSettings', { votesPerPerson: state.votesPerPerson - 1 })}>−</button>
          <b>${state.votesPerPerson}</b>
          <button class="btn small" aria-label="More votes each" disabled=${state.votesPerPerson >= 20} onClick=${() => send('updateSettings', { votesPerPerson: state.votesPerPerson + 1 })}>+</button>
        </span>
      `}
    `;
  }
  return html`<div class="status-strip">${content}</div>`;
}

function Column({ col, state, send, grouping }) {
  const { phase } = state;
  const topics = state.topics.filter((t) => t.columnId === col.id);
  const [over, setOver] = useState(false);
  const canWrite = phase === 'brainstorm' || phase === 'group';
  const movingTopic = grouping.moving && state.topics.find((t) => t.id === grouping.moving);
  const acceptsMove = phase === 'group' && movingTopic && movingTopic.columnId !== col.id;

  // While brainstorming, other people's notes are face-down: show how many, not what.
  const visible = phase === 'brainstorm' ? topics.filter((t) => t.notes.some((n) => n.mine)) : topics;
  const hidden = topics.length - visible.length;

  return html`
    <section
      class="column ${over && acceptsMove ? 'drop-target' : ''}"
      style="--hue: var(--hue-${col.hue})"
      onDragOver=${(e) => {
        if (!acceptsMove) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave=${(e) => !e.currentTarget.contains(e.relatedTarget) && setOver(false)}
      onDrop=${(e) => {
        e.preventDefault();
        setOver(false);
        grouping.dropOnColumn(col.id);
      }}
    >
      <header class="column-head">
        <h2><i class="swatch" />${col.title} <span class="count">${topics.length || ''}</span></h2>
        <p>${col.prompt}</p>
        ${grouping.held && acceptsMove && html`<button class="btn small" onClick=${() => grouping.dropOnColumn(col.id)}>Move it here</button>`}
      </header>
      ${canWrite && html`<${Composer} onAdd=${(text) => send('addNote', { columnId: col.id, text })} label=${col.title} />`}
      <div class="cards">
        ${visible.map((t) => html`<${TopicCard} key=${t.id} topic=${t} state=${state} send=${send} grouping=${grouping} />`)}
        ${hidden > 0 && html`
          <div class="facedown" aria-label="${plural(hidden, 'note')} from teammates, hidden for now">
            <span class="facedown-cards" aria-hidden="true">${Array.from({ length: Math.min(hidden, 12) }, () => html`<i />`)}</span>
            <span>${plural(hidden, 'note')} from teammates, hidden until grouping</span>
          </div>
        `}
        ${phase !== 'brainstorm' && topics.length === 0 && html`<p class="empty">Nothing here.</p>`}
      </div>
    </section>
  `;
}

function Composer({ onAdd, label }) {
  const [text, setText] = useState('');
  const add = () => {
    if (!text.trim()) return;
    onAdd(text);
    setText('');
  };
  return html`
    <form class="composer" onSubmit=${(e) => (e.preventDefault(), add())}>
      <textarea
        rows="2"
        value=${text}
        maxlength="500"
        placeholder="Write a note, then press Enter"
        aria-label="New note for ${label}"
        onInput=${(e) => setText(e.target.value)}
        onKeyDown=${(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            add();
          }
        }}
      />
      <button class="btn small" disabled=${!text.trim()}>Add note</button>
    </form>
  `;
}

function TopicCard({ topic, state, send, grouping }) {
  const { phase } = state;
  const [over, setOver] = useState(false);
  const isGroup = topic.notes.length > 1;
  const canGroup = phase === 'group';
  const isMoving = grouping.moving === topic.id;
  const isTarget = canGroup && grouping.moving && !isMoving;

  return html`
    <article
      class="card ${isGroup ? 'is-group' : ''} ${isMoving ? 'moving' : ''} ${over && isTarget ? 'drop-target' : ''}"
      draggable=${canGroup}
      onDragStart=${(e) => {
        if (e.target.closest('input, textarea')) return e.preventDefault();
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', topic.id);
        grouping.setHeld(null);
        // Wait a frame so the browser snapshots the card before it is dimmed.
        requestAnimationFrame(() => grouping.setDragging(topic.id));
      }}
      onDragEnd=${() => grouping.setDragging(null)}
      onDragOver=${(e) => {
        if (!isTarget) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave=${(e) => !e.currentTarget.contains(e.relatedTarget) && setOver(false)}
      onDrop=${(e) => {
        if (!isTarget) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        grouping.dropOnTopic(topic.id);
      }}
    >
      ${isGroup && html`<${GroupTitle} topic=${topic} editable=${canGroup} send=${send} />`}
      <ul class="notes">
        ${topic.notes.map((n) => html`<${Note} key=${n.id} note=${n} phase=${phase} inGroup=${isGroup} send=${send} />`)}
      </ul>
      ${canGroup && html`
        <footer class="card-foot">
          ${grouping.held === topic.id
            ? html`<button class="btn small" onClick=${() => grouping.setHeld(null)}>Put it back</button>`
            : grouping.held
              ? html`<button class="btn small primary" onClick=${() => grouping.dropOnTopic(topic.id)}>Group it with this</button>`
              : html`<button class="btn small ghost" onClick=${() => grouping.setHeld(topic.id)}>Pick up</button>`}
        </footer>
      `}
      ${phase === 'vote' && html`<${VoteControl} topic=${topic} state=${state} send=${send} />`}
    </article>
  `;
}

function GroupTitle({ topic, editable, send }) {
  const [draft, setDraft] = useState(topic.title);
  const focused = useRef(false);
  // Follow other people's renames unless this person is mid-edit.
  useEffect(() => {
    if (!focused.current) setDraft(topic.title);
  }, [topic.title]);
  if (!editable) return html`<h3 class="group-title">${topic.title || 'Unnamed group'}</h3>`;
  const save = () => {
    focused.current = false;
    if (draft.trim() !== topic.title) send('renameTopic', { topicId: topic.id, title: draft });
  };
  return html`
    <input
      class="group-title-input"
      value=${draft}
      maxlength="80"
      placeholder="Name this group"
      aria-label="Group name"
      onFocus=${() => (focused.current = true)}
      onInput=${(e) => setDraft(e.target.value)}
      onBlur=${save}
      onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()}
    />
  `;
}

function Note({ note, phase, inGroup, send }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.text);
  const canEdit = note.mine && (phase === 'brainstorm' || phase === 'group');
  if (editing) {
    const save = () => {
      if (draft.trim() && draft.trim() !== note.text) send('editNote', { noteId: note.id, text: draft });
      setEditing(false);
    };
    return html`
      <li class="note editing">
        <textarea
          rows="3" value=${draft} maxlength="500" autofocus aria-label="Edit note"
          onInput=${(e) => setDraft(e.target.value)}
          onKeyDown=${(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) (e.preventDefault(), save());
            if (e.key === 'Escape') (e.stopPropagation(), setEditing(false));
          }}
        />
        <div class="note-tools shown">
          <button class="btn small primary" onClick=${save}>Save</button>
          <button class="btn small ghost" onClick=${() => setEditing(false)}>Cancel</button>
        </div>
      </li>
    `;
  }
  return html`
    <li class="note">
      <p>${note.text}</p>
      ${(canEdit || (inGroup && phase === 'group')) && html`
        <div class="note-tools">
          ${canEdit && html`<button class="btn small ghost" onClick=${() => (setDraft(note.text), setEditing(true))}>Edit</button>`}
          ${canEdit && html`<button class="btn small ghost" onClick=${() => send('deleteNote', { noteId: note.id })}>Delete</button>`}
          ${inGroup && phase === 'group' && html`<button class="btn small ghost" onClick=${() => send('ungroup', { noteId: note.id })}>Take out of group</button>`}
        </div>
      `}
    </li>
  `;
}

function VoteControl({ topic, state, send }) {
  return html`
    <footer class="card-foot votes">
      <button class="btn small round" aria-label="Take a vote back" disabled=${!topic.myVotes} onClick=${() => send('unvote', { topicId: topic.id })}>−</button>
      <span class="my-votes" aria-label="${plural(topic.myVotes, 'vote')} from you">
        ${topic.myVotes ? Array.from({ length: topic.myVotes }, () => html`<i class="dot spent" />`) : html`<span class="quiet">No votes from you</span>`}
      </span>
      <button class="btn small round primary" aria-label="Vote for this" disabled=${!state.votesLeft} onClick=${() => send('vote', { topicId: topic.id })}>+</button>
    </footer>
  `;
}

// ---------- discuss ----------

function Discuss({ state, send, lead }) {
  const order = ranked(state.topics);
  const current = state.topics.find((t) => t.id === state.currentTopicId);
  const col = current && state.columns.find((c) => c.id === current.columnId);
  const names = state.participants.map((p) => p.name);
  const remaining = order.filter((t) => !t.discussed && t.id !== current?.id).length;
  const change = (id, patch) => send('updateAction', { id, ...patch });
  const remove = (id) => send('deleteAction', { id });
  const forTopic = current ? state.actions.filter((a) => a.topicId === current.id) : [];

  return html`
    <main class="discuss">
      <nav class="agenda" aria-label="Topics, most votes first">
        <h2>Topics <span class="count">${order.filter((t) => t.discussed).length} of ${order.length} covered</span></h2>
        <ol>
          ${order.map((t) => {
            const body = html`
              <span class="tally" title="${plural(t.votes, 'vote')}">${t.votes}</span>
              <span class="agenda-label">${topicLabel(t)}</span>
              ${t.discussed && html`<span class="covered" title="Covered">${Icon.check}<span class="sr-only">Covered</span></span>`}
            `;
            const cls = `${t.id === current?.id ? 'now' : ''} ${t.discussed ? 'discussed' : ''}`;
            return html`
              <li key=${t.id} class=${cls} aria-current=${t.id === current?.id ? 'true' : null}>
                ${lead ? html`<button onClick=${() => send('setCurrentTopic', { topicId: t.id })}>${body}</button>` : html`<div>${body}</div>`}
              </li>
            `;
          })}
        </ol>
        ${order.length === 0 && html`<p class="empty">No notes were written in this retro.</p>`}
      </nav>

      <section class="stage">
        ${current
          ? html`
              <div class="stage-topic" style="--hue: var(--hue-${col?.hue || 'blue'})">
                <p class="stage-meta"><span class="chip">${col?.title}</span> <span>${plural(current.votes, 'vote')}</span></p>
                ${(current.title || current.notes.length > 1) && html`<h2 class="stage-title">${current.title || 'Unnamed group'}</h2>`}
                <ul class="notes large">${current.notes.map((n) => html`<li class="note" key=${n.id}><p>${n.text}</p></li>`)}</ul>
              </div>
              <h3>What will we do about it?</h3>
              <${ActionList} items=${forTopic} onChange=${change} onDelete=${remove} />
              <${ActionForm} names=${names} onAdd=${(item) => send('addAction', { ...item, topicId: current.id })} />
              ${lead && html`
                <div class="row stage-next">
                  <button class="btn primary" onClick=${() => send('nextTopic')}>${remaining ? 'Next topic' : 'Mark as covered'}</button>
                  <span class="quiet">${remaining ? `${plural(remaining, 'topic')} left after this one` : 'This is the last topic'}</span>
                </div>
              `}
            `
          : html`
              <h2 class="stage-title">${order.length ? 'Every topic has been covered' : 'There is nothing to discuss'}</h2>
              <p class="lede">${lead ? 'Add any last action items, then finish the retro.' : 'Add any last action items while the facilitator wraps up.'}</p>
              <${ActionForm} names=${names} onAdd=${(item) => send('addAction', item)} />
            `}
      </section>

      <aside class="stage-actions">
        <h2>Action items <span class="count">${state.actions.length}</span></h2>
        <${ActionList} items=${state.actions} onChange=${change} onDelete=${remove} empty="Nothing agreed yet. Add action items under the topic being discussed." />
      </aside>
    </main>
  `;
}

// ---------- wrap up ----------

function Summary({ state, send }) {
  const order = ranked(state.topics);
  const change = (id, patch) => send('updateAction', { id, ...patch });
  const remove = (id) => send('deleteAction', { id });
  return html`
    <main class="page">
      <div class="team-grid">
        <div class="team-main">
          <section>
            <h2>What we talked about</h2>
            ${order.length === 0 && html`<p class="empty">No notes were written in this retro.</p>`}
            <ol class="recap">
              ${order.map((t) => {
                const col = state.columns.find((c) => c.id === t.columnId);
                const acts = state.actions.filter((a) => a.topicId === t.id);
                return html`
                  <li key=${t.id} style="--hue: var(--hue-${col?.hue || 'blue'})">
                    <span class="tally" title="${plural(t.votes, 'vote')}">${t.votes}</span>
                    <div>
                      <p class="recap-title">${topicLabel(t)} <span class="chip">${col?.title}</span></p>
                      ${(t.title || t.notes.length > 1) && html`<ul class="recap-notes">${t.notes.map((n) => html`<li key=${n.id}>${n.text}</li>`)}</ul>`}
                      ${acts.length > 0 && html`<ul class="recap-actions">${acts.map((a) => html`<li key=${a.id}>${a.text}${a.owner && html` <span class="owner-tag">${a.owner}</span>`}</li>`)}</ul>`}
                    </div>
                  </li>
                `;
              })}
            </ol>
          </section>
        </div>
        <aside class="team-side">
          <section>
            <h2>Action items <span class="count">${state.actions.length}</span></h2>
            <${ActionList} items=${state.actions} onChange=${change} onDelete=${remove} empty="No action items came out of this retro." />
            <${ActionForm} names=${state.participants.map((p) => p.name)} onAdd=${(item) => send('addAction', item)} />
          </section>
          ${state.carried.length > 0 && html`
            <section>
              <h2>Closed out from earlier retros</h2>
              <${ActionList} items=${state.carried} onChange=${change} onDelete=${remove} />
            </section>
          `}
          <p><a class="btn" href="/t/${state.team.id}" onClick=${go}>Back to ${state.team.name}</a></p>
        </aside>
      </div>
    </main>
  `;
}
