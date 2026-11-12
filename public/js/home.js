import { html, useState, useFetch, api, attempt, navigate, go, fmtDate, plural } from './lib.js';
import { AppBar } from './ui.js';

export function HomePage() {
  const { data: teams, error } = useFetch('/teams');
  const [name, setName] = useState('');
  const create = async (e) => {
    e.preventDefault();
    const made = await attempt(api('POST', '/teams', { name }));
    if (made) navigate(`/t/${made.id}`);
  };
  return html`
    <${AppBar} />
    <main class="page narrow">
      <h1 class="page-title">Teams</h1>
      ${error && html`<p class="form-error" role="alert">${error}</p>`}
      ${teams && teams.length === 0 && html`<p class="lede">No teams yet. Create one for each group that runs its own retros.</p>`}
      ${teams && teams.length > 0 && html`
        <ul class="rows">
          ${teams.map(
            (t) => html`
              <li key=${t.id}>
                <a class="row-link" href="/t/${t.id}" onClick=${go}>
                  <span class="row-title">${t.name}</span>
                  <span class="row-meta">
                    <span>${plural(t.retros, 'retro')}</span>
                    <span>${t.lastRetroAt ? `last on ${fmtDate(t.lastRetroAt)}` : 'none run yet'}</span>
                    ${t.openActions > 0 && html`<span class="pill">${plural(t.openActions, 'open action')}</span>`}
                  </span>
                </a>
              </li>
            `,
          )}
        </ul>
      `}
      <form class="inline-form" onSubmit=${create}>
        <label class="field grow">
          <span>New team</span>
          <input value=${name} onInput=${(e) => setName(e.target.value)} placeholder="Team name" maxlength="60" />
        </label>
        <button class="btn primary" disabled=${!name.trim()}>Create team</button>
      </form>
    </main>
  `;
}
