import { html, useState, useEffect, useRef, useRoom, useFetch, go, plural, fmtScore, fmtShortDate } from './lib.js';
import { AppBar, SessionFrame, PhaseRail, People, CopyLinkButton, EditableTitle } from './ui.js';
import { RadarChart, Distribution, Delta } from './charts.js';

const RADAR_STEPS = {
  collect: { label: 'Rate', hint: 'Rate each area from 1 to 5. Your answers are private: only team averages are ever shown.' },
  reveal: { label: 'Results', hint: 'Talk through where the team is strong, where it is struggling, and what has changed.' },
  done: { label: 'Closed', hint: 'This health check is finished. Its results feed the trend on the team page.' },
};

export function RadarPage({ radarId }) {
  const room = useRoom('radar', radarId);
  return html`<${SessionFrame} room=${room} noun="health check">${room.state && html`<${Radar} state=${room.state} send=${room.send} />`}<//>`;
}

function Radar({ state, send }) {
  const lead = state.facilitatorId === state.me.id;
  const steps = state.phases.map((id) => ({ id, ...RADAR_STEPS[id] }));
  const statusOf = (p) => (state.phase === 'collect' ? (p.finished ? 'Finished' : 'Still rating') : null);
  const nextLabel = state.phase === 'collect' ? 'Show results' : 'Close health check';

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
    <${PhaseRail} steps=${steps} current=${state.phase} canSteer=${lead} onStep=${(phase) => send('setPhase', { phase })} nextLabel=${nextLabel} />
    ${state.phase === 'collect' ? html`<${Collect} state=${state} send=${send} />` : html`<${Results} state=${state} />`}
  `;
}

function Collect({ state, send }) {
  const { data: meta } = useFetch('/meta');
  const labels = meta?.ratingLabels || [];
  const rated = Object.keys(state.myRatings).length;
  const here = state.participants.filter((p) => p.online);
  const finished = here.filter((p) => p.finished).length;
  return html`
    <div class="status-strip">
      <span class="strong">${rated === state.dimensions.length ? 'You have rated everything' : `You have rated ${rated} of ${state.dimensions.length}`}</span>
      <span>${finished} of ${plural(here.length, 'person', 'people')} finished</span>
    </div>
    <main class="page narrow">
      <ol class="rate-list">
        ${state.dimensions.map((d, i) => html`<${RateRow} key=${i} index=${i} dim=${d} mine=${state.myRatings[i]} labels=${labels} send=${send} />`)}
      </ol>
      <p class="quiet">You can change your answers until the facilitator shows the results.</p>
    </main>
  `;
}

function RateRow({ index, dim, mine, labels, send }) {
  const [comment, setComment] = useState(mine?.comment || '');
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setComment(mine?.comment || '');
  }, [mine?.comment]);
  const rate = (value) => send('rate', { dim: index, value, comment });
  const saveComment = () => {
    focused.current = false;
    if (mine && comment.trim() !== mine.comment) send('rate', { dim: index, value: mine.value, comment });
  };
  return html`
    <li class="rate-row ${mine ? 'rated' : ''}">
      <div class="rate-text">
        <h2>${dim.name}</h2>
        ${dim.description && html`<p>${dim.description}</p>`}
      </div>
      <div class="rate-input">
        <div class="scale" role="radiogroup" aria-label="${dim.name}, 1 to 5">
          ${[1, 2, 3, 4, 5].map(
            (v) => html`
              <button type="button" role="radio" aria-checked=${mine?.value === v} class=${mine?.value === v ? 'on' : ''} title=${labels[v - 1] || ''} onClick=${() => rate(v)}>
                ${v}<span class="sr-only"> ${labels[v - 1] || ''}</span>
              </button>
            `,
          )}
        </div>
        <div class="scale-ends"><span>${labels[0]}</span><span>${labels[4]}</span></div>
        ${mine && html`
          <input
            class="rate-comment"
            value=${comment}
            maxlength="300"
            placeholder="Comment, shown without your name"
            aria-label="Comment on ${dim.name}"
            onFocus=${() => (focused.current = true)}
            onInput=${(e) => setComment(e.target.value)}
            onBlur=${saveComment}
            onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()}
          />
        `}
      </div>
    </li>
  `;
}

function Results({ state }) {
  const { results, previous, respondents } = state;
  if (!respondents) {
    return html`
      <main class="page narrow">
        <h2 class="page-title">Nobody rated anything</h2>
        <p class="lede">The facilitator can go back to the Rate step to collect answers.</p>
      </main>
    `;
  }
  const names = results.map((r) => r.name);
  const current = results.map((r) => r.avg);
  const prevLabel = previous ? `${previous.title} (${fmtShortDate(previous.createdAt)})` : null;
  const sorted = results.map((r, i) => ({ ...r, i })).filter((r) => r.avg != null);
  const strongest = [...sorted].sort((a, b) => b.avg - a.avg)[0];
  const weakest = [...sorted].sort((a, b) => a.avg - b.avg)[0];

  return html`
    <div class="status-strip">
      <span class="strong">Answers from ${plural(respondents, 'person', 'people')}</span>
      ${strongest && weakest && strongest.i !== weakest.i && html`<span>Strongest: ${strongest.name} at ${fmtScore(strongest.avg)}</span><span>Weakest: ${weakest.name} at ${fmtScore(weakest.avg)}</span>`}
    </div>
    <main class="page results">
      <${RadarChart} names=${names} current=${current} previous=${previous?.avgs} currentLabel=${state.title} previousLabel=${prevLabel} />
      <table class="score-table">
        <caption class="sr-only">Average score, change, and spread of answers for each area</caption>
        <thead>
          <tr><th scope="col">Area</th><th scope="col" class="num">Average</th><th scope="col">Spread of answers</th></tr>
        </thead>
        <tbody>
          ${results.map(
            (r, i) => html`
              <tr key=${i}>
                <th scope="row">
                  ${r.name}
                  ${state.dimensions[i].description && html`<small>${state.dimensions[i].description}</small>`}
                  ${r.comments.length > 0 && html`
                    <ul class="comments">
                      ${r.comments.map((c) => html`<li><span class="comment-score">${c.value}</span>${c.text}</li>`)}
                    </ul>
                  `}
                </th>
                <td class="num">
                  <span class="score">${fmtScore(r.avg)}</span>
                  ${previous?.avgs[i] != null && r.avg != null && html`<${Delta} value=${r.avg - previous.avgs[i]} />`}
                </td>
                <td><${Distribution} counts=${r.counts} /></td>
              </tr>
            `,
          )}
        </tbody>
      </table>
      <p class="results-foot"><a class="btn" href="/t/${state.team.id}" onClick=${go}>Back to ${state.team.name}</a></p>
    </main>
  `;
}
