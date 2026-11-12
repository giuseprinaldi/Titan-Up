import { html, render, useState, useUser, usePath, setUser, api, go } from './lib.js';
import { AppBar, Logo, Toasts } from './ui.js';
import { HomePage } from './home.js';
import { TeamPage } from './team.js';
import { RetroPage } from './retro.js';
import { RadarPage } from './radar.js';

const ROUTES = [
  [/^\/$/, () => html`<${HomePage} />`],
  [/^\/t\/([\w-]+)$/, (id) => html`<${TeamPage} key=${id} teamId=${id} />`],
  [/^\/r\/([\w-]+)$/, (id) => html`<${RetroPage} key=${id} retroId=${id} />`],
  [/^\/h\/([\w-]+)$/, (id) => html`<${RadarPage} key=${id} radarId=${id} />`],
];

function App() {
  const user = useUser();
  const path = usePath();
  if (!user) return html`<${NameGate} /><${Toasts} />`;
  for (const [pattern, page] of ROUTES) {
    const match = pattern.exec(path);
    if (match) return html`${page(match[1])}<${Toasts} />`;
  }
  return html`
    <${AppBar} />
    <main class="page narrow">
      <h1 class="page-title">There is nothing at this address</h1>
      <p class="lede">The link may be mistyped, or the retro it pointed to was deleted.</p>
      <p><a class="btn primary" href="/" onClick=${go}>Go to all teams</a></p>
    </main>
    <${Toasts} />
  `;
}

/** First visit: ask for a display name. No password; the browser remembers you. */
function NameGate() {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const invited = /^\/r\//.test(location.pathname) ? 'retro' : /^\/h\//.test(location.pathname) ? 'health check' : null;
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      setUser(await api('POST', '/users', { name }));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return html`
    <main class="gate">
      <form class="gate-card" onSubmit=${submit}>
        <${Logo} />
        <h1>${invited ? `You have been invited to a ${invited}` : 'Run retros your team looks forward to'}</h1>
        <label class="field">
          <span>What should teammates call you?</span>
          <input value=${name} onInput=${(e) => setName(e.target.value)} maxlength="40" required autofocus autocomplete="given-name" />
        </label>
        ${error && html`<p class="form-error" role="alert">${error}</p>`}
        <button class="btn primary big" disabled=${busy || !name.trim()}>${invited ? `Join the ${invited}` : 'Continue'}</button>
        <p class="quiet">No password needed. This browser will remember you, and the notes you write in retros are always anonymous.</p>
      </form>
    </main>
  `;
}

render(html`<${App} />`, document.getElementById('app'));
