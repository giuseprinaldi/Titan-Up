import { html, useState, useEffect, useFetch, useUser, api, attempt, navigate, go, fmtDate, fmtShortDate, fmtScore, plural } from './lib.js';
import { AppBar, Modal, ActionForm, ActionList, EditableTitle } from './ui.js';
import { TrendGrid } from './charts.js';
import { RETRO_STEPS } from './retro.js';

export function TeamPage({ teamId }) {
  const user = useUser();
  const { data, error, reload } = useFetch(`/teams/${teamId}`);
  const [dialog, setDialog] = useState(null); // 'retro' | 'radar' | { remove: {...} }

  if (error && !data) {
    return html`
      <${AppBar} />
      <main class="page narrow">
        <h1 class="page-title">This team could not be opened</h1>
        <p class="lede">${error}</p>
        <p><a class="btn primary" href="/" onClick=${go}>Go to all teams</a></p>
      </main>
    `;
  }
  if (!data) return html`<${AppBar} /><main class="page"><p class="lede" aria-busy="true">Loading…</p></main>`;

  const { team, retros, radars, actions } = data;
  const open = actions.filter((a) => !a.done);
  const done = actions.filter((a) => a.done);
  const change = (id, patch) => attempt(api('PATCH', `/actions/${id}`, patch)).then(reload);
  const remove = (id) => attempt(api('DELETE', `/actions/${id}`)).then(reload);
  const add = (item) => attempt(api('POST', `/teams/${team.id}/actions`, item)).then(reload);
  const rename = (name) => attempt(api('PATCH', `/teams/${team.id}`, { name })).then(reload);
  const source = (a) => (a.retroTitle ? `from ${a.retroTitle}` : `added ${fmtShortDate(a.createdAt)}`);
  const revealed = radars.filter((r) => r.results && r.respondents > 0).reverse();

  return html`
    <${AppBar} crumbs=${[{ label: team.name }]} />
    <main class="page">
      <header class="page-head">
        <h1 class="page-title"><${EditableTitle} value=${team.name} canEdit=${true} onSave=${rename} /></h1>
        <div class="row">
          <button class="btn primary" onClick=${() => setDialog('retro')}>Start a retro</button>
          <button class="btn" onClick=${() => setDialog('radar')}>Start a health check</button>
        </div>
      </header>

      <div class="team-grid">
        <div class="team-main">
          <section>
            <h2>Retros</h2>
            ${retros.length === 0 && html`<p class="empty">No retros yet. Start one and share the link with the team.</p>`}
            <ul class="rows">
              ${retros.map(
                (r) => html`
                  <li key=${r.id}>
                    <a class="row-link" href="/r/${r.id}" onClick=${go}>
                      <span class="row-title">${r.title}</span>
                      <span class="row-meta">
                        <span>${fmtDate(r.createdAt)}</span>
                        <span>${plural(r.notes, 'note')}</span>
                        <span>${plural(r.people, 'person', 'people')}</span>
                        <span>${plural(r.actions, 'action')}</span>
                        ${r.phase === 'done' ? html`<span class="pill quiet-pill">Finished</span>` : html`<span class="pill live">In progress, ${RETRO_STEPS[r.phase].label.toLowerCase()}</span>`}
                      </span>
                    </a>
                    ${r.createdBy === user.id && html`<button class="btn small ghost" onClick=${() => setDialog({ remove: { path: `/retros/${r.id}`, title: r.title, noun: 'retro' } })}>Delete</button>`}
                  </li>
                `,
              )}
            </ul>
          </section>

          <section>
            <h2>Health checks</h2>
            ${radars.length === 0 && html`<p class="empty">No health checks yet. Run one every month or so to see how the team is trending.</p>`}
            ${revealed.length > 1 && html`
              <p class="section-note">Average score for each area, out of 5, across the last ${revealed.length} checks.</p>
              <${TrendGrid} checks=${revealed} />
            `}
            <ul class="rows">
              ${radars.map((r) => {
                const scored = r.results?.filter((d) => d.avg != null) || [];
                const overall = scored.length ? scored.reduce((sum, d) => sum + d.avg, 0) / scored.length : null;
                return html`
                  <li key=${r.id}>
                    <a class="row-link" href="/h/${r.id}" onClick=${go}>
                      <span class="row-title">${r.title}</span>
                      <span class="row-meta">
                        <span>${fmtDate(r.createdAt)}</span>
                        <span>${plural(r.respondents, 'response')}</span>
                        ${overall != null && html`<span>average ${fmtScore(overall)} out of 5</span>`}
                        ${r.phase === 'collect' && html`<span class="pill live">Collecting answers</span>`}
                      </span>
                    </a>
                    ${r.createdBy === user.id && html`<button class="btn small ghost" onClick=${() => setDialog({ remove: { path: `/radars/${r.id}`, title: r.title, noun: 'health check' } })}>Delete</button>`}
                  </li>
                `;
              })}
            </ul>
          </section>
        </div>

        <aside class="team-side">
          <section>
            <h2>Action items <span class="count">${open.length} open</span></h2>
            <${ActionForm} onAdd=${add} />
            <${ActionList} items=${open} onChange=${change} onDelete=${remove} note=${source} empty="Nothing open. Action items agreed in retros show up here." />
            ${done.length > 0 && html`
              <details class="done-actions">
                <summary>${plural(done.length, 'finished action')}</summary>
                <${ActionList} items=${done} onChange=${change} onDelete=${remove} note=${source} />
              </details>
            `}
          </section>
        </aside>
      </div>
    </main>

    ${dialog === 'retro' && html`<${StartRetro} team=${team} count=${retros.length} onClose=${() => setDialog(null)} />`}
    ${dialog === 'radar' && html`<${StartRadar} team=${team} onClose=${() => setDialog(null)} />`}
    ${dialog?.remove && html`<${ConfirmDelete} ...${dialog.remove} onClose=${() => setDialog(null)} onDone=${() => (setDialog(null), reload())} />`}
  `;
}

function ConfirmDelete({ path, title, noun, onClose, onDone }) {
  const remove = async () => {
    if (await attempt(api('DELETE', path))) onDone();
  };
  return html`
    <${Modal} title="Delete this ${noun}?" onClose=${onClose}>
      <p>“${title}” and everything written in it will be removed for everyone. Action items that came out of it are kept.</p>
      <div class="row end">
        <button class="btn ghost" onClick=${onClose}>Keep it</button>
        <button class="btn danger" onClick=${remove}>Delete ${noun}</button>
      </div>
    <//>
  `;
}

function StartRetro({ team, count, onClose }) {
  const { data: meta } = useFetch('/meta');
  const [title, setTitle] = useState(`Retro ${count + 1}`);
  const [templateId, setTemplateId] = useState('start-stop-continue');
  const [votes, setVotes] = useState(5);
  const [busy, setBusy] = useState(false);
  const start = async (e) => {
    e.preventDefault();
    setBusy(true);
    const made = await attempt(api('POST', `/teams/${team.id}/retros`, { title, templateId, votesPerPerson: Number(votes) }));
    if (made) navigate(`/r/${made.id}`);
    else setBusy(false);
  };
  return html`
    <${Modal} title="Start a retro" onClose=${onClose} wide>
      <form class="stack" onSubmit=${start}>
        <label class="field">
          <span>Title</span>
          <input value=${title} onInput=${(e) => setTitle(e.target.value)} maxlength="120" required autofocus />
        </label>
        <fieldset class="field">
          <legend>Format</legend>
          <div class="choices">
            ${(meta?.retroTemplates || []).map(
              (t) => html`
                <label class="choice" key=${t.id}>
                  <input type="radio" name="template" value=${t.id} checked=${templateId === t.id} onChange=${() => setTemplateId(t.id)} />
                  <span class="choice-body">
                    <strong>${t.name}</strong>
                    <span>${t.blurb}</span>
                    <span class="chips">${t.columns.map((c) => html`<span class="chip" style="--hue: var(--hue-${c.hue})">${c.title}</span>`)}</span>
                  </span>
                </label>
              `,
            )}
          </div>
        </fieldset>
        <label class="field short">
          <span>Votes per person</span>
          <input type="number" min="1" max="20" value=${votes} onInput=${(e) => setVotes(e.target.value)} required />
        </label>
        <div class="row end">
          <button type="button" class="btn ghost" onClick=${onClose}>Cancel</button>
          <button class="btn primary" disabled=${busy || !meta}>Start retro</button>
        </div>
      </form>
    <//>
  `;
}

function StartRadar({ team, onClose }) {
  const { data: meta } = useFetch('/meta');
  const [title, setTitle] = useState(`Health check, ${fmtShortDate(Date.now())}`);
  const [templateId, setTemplateId] = useState(null);
  const [dims, setDims] = useState([]);
  const [busy, setBusy] = useState(false);

  const pick = (t) => {
    setTemplateId(t.id);
    setDims(t.dimensions.map((d) => ({ ...d })));
  };
  useEffect(() => {
    if (meta && !templateId) pick(meta.radarTemplates[0]);
  }, [meta]);

  const edit = (i, patch) => setDims(dims.map((d, k) => (k === i ? { ...d, ...patch } : d)));
  const start = async (e) => {
    e.preventDefault();
    setBusy(true);
    const made = await attempt(api('POST', `/teams/${team.id}/radars`, { title, dimensions: dims.filter((d) => d.name.trim()) }));
    if (made) navigate(`/h/${made.id}`);
    else setBusy(false);
  };
  return html`
    <${Modal} title="Start a health check" onClose=${onClose} wide>
      <form class="stack" onSubmit=${start}>
        <label class="field">
          <span>Title</span>
          <input value=${title} onInput=${(e) => setTitle(e.target.value)} maxlength="120" required autofocus />
        </label>
        <fieldset class="field">
          <legend>Start from</legend>
          <div class="row">
            ${(meta?.radarTemplates || []).map(
              (t) => html`<button type="button" key=${t.id} class="btn ${templateId === t.id ? 'selected' : ''}" aria-pressed=${templateId === t.id} onClick=${() => pick(t)}>${t.name}</button>`,
            )}
          </div>
        </fieldset>
        <fieldset class="field">
          <legend>What everyone rates, from 1 to 5</legend>
          <p class="quiet">Keep the names the same from one check to the next and the team page will chart the trend.</p>
          <ul class="dim-edit">
            ${dims.map(
              (d, i) => html`
                <li key=${i}>
                  <input value=${d.name} onInput=${(e) => edit(i, { name: e.target.value })} placeholder="Name" maxlength="40" aria-label="Name" />
                  <input class="grow" value=${d.description} onInput=${(e) => edit(i, { description: e.target.value })} placeholder="What good looks like" maxlength="160" aria-label="Description" />
                  <button type="button" class="btn small ghost" onClick=${() => setDims(dims.filter((_, k) => k !== i))} aria-label="Remove ${d.name || 'this row'}">Remove</button>
                </li>
              `,
            )}
          </ul>
          ${dims.length < 12 && html`<button type="button" class="btn small" onClick=${() => setDims([...dims, { name: '', description: '' }])}>Add another</button>`}
        </fieldset>
        <div class="row end">
          <button type="button" class="btn ghost" onClick=${onClose}>Cancel</button>
          <button class="btn primary" disabled=${busy || dims.filter((d) => d.name.trim()).length < 3}>Start health check</button>
        </div>
      </form>
    <//>
  `;
}
