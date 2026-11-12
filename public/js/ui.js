// Components shared by every page.
import { html, useState, useEffect, useRef, useToasts, useUser, setUser, api, attempt, go, toast } from './lib.js';

export function Logo() {
  return html`
    <a class="logo" href="/" onClick=${go} aria-label="Titan Up, all teams">
      <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
        <path d="M16 2.5 27.7 9.25v13.5L16 29.5 4.3 22.75V9.25Z" fill="currentColor" />
        <circle cx="16" cy="16" r="5.5" fill="none" stroke="var(--logo-ring)" stroke-width="3" />
      </svg>
      <span>Titan Up</span>
    </a>
  `;
}

/** Top bar: logo, where you are, and who you are. */
export function AppBar({ crumbs = [], children }) {
  const user = useUser();
  const [renaming, setRenaming] = useState(false);
  return html`
    <header class="appbar">
      <${Logo} />
      <nav class="crumbs" aria-label="Breadcrumb">
        ${crumbs.map((c) =>
          c.href
            ? html`<span class="crumb-sep" aria-hidden="true">/</span><a href=${c.href} onClick=${go}>${c.label}</a>`
            : html`<span class="crumb-sep" aria-hidden="true">/</span><span class="crumb-here">${c.label}</span>`,
        )}
      </nav>
      <div class="appbar-right">
        ${children}
        <button class="who" onClick=${() => setRenaming(true)} title="Change your name">
          <${Avatar} name=${user.name} /> <span class="who-name">${user.name}</span>
        </button>
      </div>
      ${renaming && html`<${RenameDialog} user=${user} onClose=${() => setRenaming(false)} />`}
    </header>
  `;
}

function RenameDialog({ user, onClose }) {
  const [name, setName] = useState(user.name);
  const save = async (e) => {
    e.preventDefault();
    const saved = await attempt(api('PATCH', '/me', { name }));
    if (saved) {
      setUser({ ...user, name: saved.name });
      onClose();
    }
  };
  return html`
    <${Modal} title="Your name" onClose=${onClose}>
      <form onSubmit=${save} class="stack">
        <label class="field">
          <span>Shown to teammates in retros. Your notes stay anonymous either way.</span>
          <input value=${name} onInput=${(e) => setName(e.target.value)} maxlength="40" required autofocus />
        </label>
        <div class="row end">
          <button type="button" class="btn ghost" onClick=${onClose}>Cancel</button>
          <button class="btn primary">Save name</button>
        </div>
      </form>
    <//>
  `;
}

const HUES = ['violet', 'blue', 'teal', 'gold', 'rose'];
function hueFor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return HUES[h % HUES.length];
}

export function Avatar({ name, online, crown }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => [...w][0])
    .join('')
    .toUpperCase();
  return html`
    <span class="avatar ${online === false ? 'away' : ''}" style="--hue: var(--hue-${hueFor(name)})" aria-hidden="true">
      ${initials}${crown && html`<span class="crown" />`}
    </span>
  `;
}

export function Modal({ title, onClose, wide, children }) {
  const ref = useRef();
  useEffect(() => {
    ref.current.showModal();
  }, []);
  return html`
    <dialog ref=${ref} class="modal ${wide ? 'wide' : ''}" onClose=${onClose} onMouseDown=${(e) => e.target === ref.current && onClose()}>
      <div class="modal-inner">
        <header class="modal-head">
          <h2>${title}</h2>
          <button type="button" class="icon-btn" aria-label="Close" onClick=${onClose}>${Icon.close}</button>
        </header>
        ${children}
      </div>
    </dialog>
  `;
}

/** A button that opens a small panel; closes on outside click or Escape. */
export function Popover({ label, buttonClass = 'btn ghost', align = 'right', children, title }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return html`
    <span class="popover-wrap" ref=${ref}>
      <button type="button" class=${buttonClass} aria-expanded=${open} title=${title} onClick=${() => setOpen(!open)}>${label}</button>
      ${open && html`<div class="popover ${align}" onClick=${(e) => e.target.closest('[data-close]') && setOpen(false)}>${children}</div>`}
    </span>
  `;
}

export function Toasts() {
  const toasts = useToasts();
  return html`<div class="toasts" role="status" aria-live="polite">${toasts.map((t) => html`<div class="toast" key=${t.id}>${t.message}</div>`)}</div>`;
}

export const Icon = {
  close: html`<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="m3.5 3.5 9 9m0-9-9 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none" /></svg>`,
  check: html`<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="m3 8.5 3.2 3L13 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" /></svg>`,
  link: html`<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M6.8 9.2a3 3 0 0 0 4.2 0l2.1-2.1a3 3 0 0 0-4.2-4.2l-.9.9m1.2 3a3 3 0 0 0-4.2 0L2.9 8.9a3 3 0 0 0 4.2 4.2l.9-.9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none" /></svg>`,
  clock: html`<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" fill="none" /><path d="M8 4.8V8l2.2 1.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none" /></svg>`,
};

export function CopyLinkButton() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(location.href);
      ok = true;
    } catch {
      // The clipboard API needs HTTPS or localhost. On a plain-HTTP intranet
      // address, fall back to the older selection-based copy.
      const box = document.createElement('textarea');
      box.value = location.href;
      box.style.cssText = 'position:fixed;opacity:0';
      document.body.append(box);
      box.select();
      try {
        ok = document.execCommand('copy');
      } catch {}
      box.remove();
    }
    if (!ok) return toast(`Share this link: ${location.href}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return html`<button type="button" class="btn ghost" onClick=${copy}>${Icon.link} ${copied ? 'Link copied' : 'Copy invite link'}</button>`;
}

/** Avatars of everyone in the session, with a panel listing who is who. */
export function People({ state, send, statusOf }) {
  const { participants, facilitatorId, me } = state;
  const iLead = facilitatorId === me.id;
  const lead = participants.find((p) => p.id === facilitatorId);
  const shown = participants.slice(0, 6);
  const label = html`
    <span class="avatar-stack">
      ${shown.map((p) => html`<${Avatar} key=${p.id} name=${p.name} online=${p.online} crown=${p.id === facilitatorId} />`)}
      ${participants.length > shown.length && html`<span class="avatar more">+${participants.length - shown.length}</span>`}
    </span>
    <span class="sr-only">${participants.length === 1 ? "1 person" : participants.length + " people"} here. Show list.</span>
  `;
  return html`
    <${Popover} label=${label} buttonClass="people-btn" title="Who is here">
      <ul class="people-list">
        ${participants.map(
          (p) => html`
            <li key=${p.id}>
              <${Avatar} name=${p.name} online=${p.online} crown=${p.id === facilitatorId} />
              <span class="people-name">
                ${p.name}${p.id === me.id && html` <span class="quiet">(you)</span>`}
                <small>${[p.id === facilitatorId && 'Facilitator', !p.online && 'Away', p.online && statusOf?.(p)].filter(Boolean).join(', ')}</small>
              </span>
              ${iLead && p.id !== me.id && p.online && html`<button class="btn small" data-close onClick=${() => send('setFacilitator', { userId: p.id })}>Hand over</button>`}
            </li>
          `,
        )}
      </ul>
      ${!iLead && !lead?.online && html`
        <div class="popover-foot">
          <p>The facilitator is away.</p>
          <button class="btn small primary" data-close onClick=${() => send('claimFacilitator')}>Take over facilitating</button>
        </div>
      `}
    <//>
  `;
}

/**
 * The dark band across the top of a session: the current step in large type,
 * what to do in it, the full sequence, and the facilitator's controls.
 */
export function PhaseRail({ steps, current, canSteer, onStep, children, nextLabel }) {
  const index = steps.findIndex((s) => s.id === current);
  const step = steps[index];
  const next = steps[index + 1];
  return html`
    <section class="rail" aria-label="Progress">
      <div class="rail-main">
        <div class="rail-now">
          <h1>${step.label}</h1>
          <p>${step.hint}</p>
        </div>
        <div class="rail-side">
          <ol class="steps">
            ${steps.map(
              (s, i) => html`
                <li key=${s.id} class=${i < index ? 'past' : i === index ? 'now' : ''} aria-current=${i === index ? 'step' : null}>
                  ${canSteer && i !== index
                    ? html`<button type="button" onClick=${() => onStep(s.id)} title="Go to ${s.label}"><span class="step-n">${i + 1}</span>${s.label}</button>`
                    : html`<span><span class="step-n">${i + 1}</span>${s.label}</span>`}
                </li>
              `,
            )}
          </ol>
          <div class="rail-controls">
            ${children}
            ${canSteer && next && html`<button type="button" class="btn light" onClick=${() => onStep(next.id)}>${nextLabel || `Next: ${next.label}`}</button>`}
          </div>
        </div>
      </div>
      <div class="rail-progress" aria-hidden="true"><span style="--fill: ${((index + 1) / steps.length) * 100}%" /></div>
    </section>
  `;
}

/** Wraps a live session page: joining, deleted, and reconnecting states. */
export function SessionFrame({ room, noun, children }) {
  if (room.status === 'gone') {
    return html`
      <${AppBar} />
      <main class="page narrow">
        <h1 class="page-title">This ${noun} was deleted</h1>
        <p class="lede">Nothing else was affected. Action items that came out of it are still on the team page.</p>
        <p><a class="btn primary" href="/" onClick=${go}>Go to all teams</a></p>
      </main>
    `;
  }
  if (!room.state) {
    return html`<${AppBar} /><main class="page narrow"><p class="lede" aria-busy="true">Joining the ${noun}…</p></main>`;
  }
  return html`
    ${room.status === 'reconnecting' && html`<div class="banner" role="status">Connection lost. Reconnecting…</div>`}
    ${children}
  `;
}

/** The session title; the facilitator can click it to rename. */
export function EditableTitle({ value, canEdit, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (!editing) {
    return canEdit
      ? html`<button class="title-btn" title="Rename" onClick=${() => (setDraft(value), setEditing(true))}>${value}</button>`
      : html`<span class="crumb-here">${value}</span>`;
  }
  const done = (save) => {
    if (save && draft.trim() && draft.trim() !== value) onSave(draft.trim());
    setEditing(false);
  };
  return html`
    <input
      class="title-input"
      value=${draft}
      maxlength="120"
      autofocus
      aria-label="Title"
      onInput=${(e) => setDraft(e.target.value)}
      onBlur=${() => done(true)}
      onKeyDown=${(e) => (e.key === 'Enter' ? done(true) : e.key === 'Escape' ? done(false) : null)}
    />
  `;
}

// ---------- action items ----------

export function ActionForm({ onAdd, names = [], placeholder = 'What will be done?' }) {
  const [text, setText] = useState('');
  const [owner, setOwner] = useState('');
  const listId = useRef(`names-${Math.random().toString(36).slice(2)}`).current;
  const submit = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    onAdd({ text, owner });
    setText('');
    setOwner('');
  };
  return html`
    <form class="action-form" onSubmit=${submit}>
      <input class="grow" value=${text} onInput=${(e) => setText(e.target.value)} placeholder=${placeholder} maxlength="300" aria-label="Action item" />
      <input class="owner" value=${owner} onInput=${(e) => setOwner(e.target.value)} placeholder="Owner" maxlength="60" list=${listId} aria-label="Owner" />
      <datalist id=${listId}>${names.map((n) => html`<option value=${n} />`)}</datalist>
      <button class="btn" disabled=${!text.trim()}>Add action</button>
    </form>
  `;
}

export function ActionList({ items, onChange, onDelete, empty, note }) {
  if (!items.length) return empty ? html`<p class="empty">${empty}</p>` : null;
  return html`<ul class="actions">${items.map((item) => html`<${ActionRow} key=${item.id} item=${item} onChange=${onChange} onDelete=${onDelete} note=${note?.(item)} />`)}</ul>`;
}

function ActionRow({ item, onChange, onDelete, note }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const [owner, setOwner] = useState(item.owner);
  if (editing) {
    const save = (e) => {
      e.preventDefault();
      if (!text.trim()) return;
      onChange(item.id, { text, owner });
      setEditing(false);
    };
    return html`
      <li class="action editing">
        <form onSubmit=${save} class="action-edit">
          <input class="grow" value=${text} onInput=${(e) => setText(e.target.value)} maxlength="300" aria-label="Action item" autofocus />
          <input class="owner" value=${owner} onInput=${(e) => setOwner(e.target.value)} placeholder="Owner" maxlength="60" aria-label="Owner" />
          <button class="btn small primary">Save</button>
          <button type="button" class="btn small ghost" onClick=${() => setEditing(false)}>Cancel</button>
          <button type="button" class="btn small danger" onClick=${() => onDelete(item.id)}>Delete</button>
        </form>
      </li>
    `;
  }
  return html`
    <li class="action ${item.done ? 'done' : ''}">
      <label class="check">
        <input type="checkbox" checked=${item.done} onChange=${(e) => onChange(item.id, { done: e.target.checked })} />
        <span class="box">${Icon.check}</span>
        <span class="sr-only">Done</span>
      </label>
      <div class="action-body">
        <span class="action-text">${item.text}</span>
        <span class="action-meta">
          <span class=${item.owner ? 'owner-tag' : 'owner-tag none'}>${item.owner || 'No owner'}</span>
          ${note && html`<span>${note}</span>`}
        </span>
      </div>
      <button class="btn small ghost" onClick=${() => (setText(item.text), setOwner(item.owner), setEditing(true))}>Edit</button>
    </li>
  `;
}

/** Re-render on an interval while `active`; returns the current time in ms. */
export function useNow(active, every = 250) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [active, every]);
  return now;
}
