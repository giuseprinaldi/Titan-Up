// Charts for health checks. Plain SVG, sized by viewBox, colored by CSS custom
// properties (--chart-*), so light and dark themes are handled in styles.css.
import { html, useState, fmtScore, fmtShortDate } from './lib.js';

const TAU = Math.PI * 2;

/** Split a label into at most two lines of roughly `max` characters. */
function wrapLabel(text, max = 15) {
  if (text.length <= max) return [text];
  const words = text.split(' ');
  let first = '';
  while (words.length > 1 && (first + ' ' + words[0]).trim().length <= max) first = (first + ' ' + words.shift()).trim();
  if (!first) first = words.shift();
  const rest = words.join(' ');
  return [first, rest.length > max + 3 ? rest.slice(0, max + 2) + '…' : rest].filter(Boolean);
}

/**
 * Radar of average scores (0 at the centre, 5 at the rim). `current` is the
 * emphasised series; `previous`, when given, is drawn in grey for comparison.
 */
export function RadarChart({ names, current, previous, currentLabel = 'This check', previousLabel = 'Previous check' }) {
  const [hover, setHover] = useState(null);
  const W = 560;
  const H = 430;
  const cx = W / 2;
  const cy = H / 2;
  const R = 150;
  const n = names.length;
  const point = (i, value) => {
    const a = (i / n) * TAU - Math.PI / 2;
    const r = (value / 5) * R;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  };
  const ring = (value) => names.map((_, i) => point(i, value).map((v) => v.toFixed(1)).join(',')).join(' ');
  const shape = (values) =>
    values
      .map((v, i) => (v == null ? null : point(i, v).map((x) => x.toFixed(1)).join(',')))
      .filter(Boolean)
      .join(' ');

  const summary = names.map((name, i) => `${name} ${fmtScore(current[i])}`).join(', ');
  const tip = hover == null ? null : point(hover, Math.max(current[hover] ?? 0, previous?.[hover] ?? 0));

  return html`
    <figure class="chart radar">
      <div class="chart-plot">
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Radar chart of average scores out of 5. ${summary}">
          ${[1, 2, 3, 4, 5].map((v) => html`<polygon points=${ring(v)} class=${v === 5 ? 'grid rim' : 'grid'} />`)}
          ${names.map((_, i) => {
            const [x, y] = point(i, 5);
            return html`<line x1=${cx} y1=${cy} x2=${x} y2=${y} class="grid" />`;
          })}
          ${[1, 2, 3, 4, 5].map((v) => html`<text x=${cx + 5} y=${cy - (v / 5) * R + 12} class="tick">${v}</text>`)}
          ${previous && html`<polygon points=${shape(previous)} class="series prev" />`}
          <polygon points=${shape(current)} class="series now" />
          ${current.map((v, i) => {
            if (v == null) return null;
            const [x, y] = point(i, v);
            return html`<circle cx=${x} cy=${y} r=${hover === i ? 6 : 4.5} class="dot now" />`;
          })}
          ${names.map((name, i) => {
            const a = (i / n) * TAU - Math.PI / 2;
            const x = cx + Math.cos(a) * (R + 16);
            const y = cy + Math.sin(a) * (R + 16);
            const anchor = Math.abs(Math.cos(a)) < 0.2 ? 'middle' : Math.cos(a) > 0 ? 'start' : 'end';
            const lines = wrapLabel(name);
            // Labels above the chart grow upward so they never run into the rim.
            const top = Math.sin(a) < -0.5 ? y - (lines.length - 1) * 15 : Math.sin(a) > 0.5 ? y + 11 : y + 4 - (lines.length - 1) * 7;
            return html`
              <text class=${hover === i ? 'label on' : 'label'} text-anchor=${anchor}>
                ${lines.map((line, k) => html`<tspan x=${x} y=${top + k * 15}>${line}</tspan>`)}
              </text>
            `;
          })}
          ${names.map((name, i) => {
            const [x, y] = point(i, current[i] ?? 0);
            return html`
              <circle
                cx=${x} cy=${y} r="16" class="hit" tabindex="0"
                aria-label="${name}: ${fmtScore(current[i])}${previous?.[i] != null ? `, previously ${fmtScore(previous[i])}` : ''}"
                onMouseEnter=${() => setHover(i)} onMouseLeave=${() => setHover(null)}
                onFocus=${() => setHover(i)} onBlur=${() => setHover(null)}
              />
            `;
          })}
        </svg>
        ${tip && html`
          <div class="chart-tip" style="left: ${(tip[0] / W) * 100}%; top: ${(tip[1] / H) * 100}%">
            <strong>${names[hover]}</strong>
            <span><i class="key now" />${currentLabel} <b>${fmtScore(current[hover])}</b></span>
            ${previous?.[hover] != null && html`<span><i class="key prev" />${previousLabel} <b>${fmtScore(previous[hover])}</b></span>`}
          </div>
        `}
      </div>
      ${previous && html`
        <figcaption class="legend">
          <span><i class="key now" />${currentLabel}</span>
          <span><i class="key prev" />${previousLabel}</span>
        </figcaption>
      `}
    </figure>
  `;
}

/** How many people gave each score, 1 to 5, as five thin columns. */
export function Distribution({ counts }) {
  const max = Math.max(1, ...counts);
  const total = counts.reduce((a, b) => a + b, 0);
  const label = counts.map((c, i) => `${c} gave ${i + 1}`).join(', ');
  return html`
    <div class="dist" role="img" aria-label="Spread of ${total} answers: ${label}">
      ${counts.map(
        (c, i) => html`
          <div class="dist-col" title="${c} ${c === 1 ? 'person' : 'people'} answered ${i + 1}">
            <span class="dist-n">${c || ''}</span>
            <span class="dist-bar" style="height: ${c ? Math.max(4, (c / max) * 30) : 0}px" />
            <span class="dist-x">${i + 1}</span>
          </div>
        `,
      )}
    </div>
  `;
}

/**
 * One small line chart per dimension, showing its average across past health
 * checks. `checks` is oldest-first: [{ id, title, createdAt, results: [{ name, avg }] }].
 */
export function TrendGrid({ checks }) {
  const latest = checks[checks.length - 1];
  const series = latest.results
    .map((dim) => ({
      name: dim.name,
      points: checks
        .map((c) => ({ check: c, avg: c.results.find((r) => r.name.toLowerCase() === dim.name.toLowerCase())?.avg ?? null }))
        .filter((p) => p.avg != null),
    }))
    .filter((s) => s.points.length > 0);
  return html`<div class="trend-grid">${series.map((s) => html`<${TrendCell} key=${s.name} series=${s} />`)}</div>`;
}

function TrendCell({ series }) {
  const [hover, setHover] = useState(null);
  const W = 200;
  const H = 76;
  const left = 14;
  const right = 40;
  const top = 8;
  const bottom = 8;
  const pts = series.points;
  const x = (i) => (pts.length === 1 ? left : left + (i / (pts.length - 1)) * (W - left - right));
  const y = (v) => top + ((5 - v) / 4) * (H - top - bottom);
  const last = pts[pts.length - 1];
  const first = pts[0];
  const change = pts.length > 1 ? last.avg - first.avg : null;
  const shown = hover == null ? null : pts[hover];
  return html`
    <figure class="chart trend">
      <figcaption>
        <span class="trend-name">${series.name}</span>
        ${change != null && html`<${Delta} value=${change} label="since ${fmtShortDate(first.check.createdAt)}" />`}
      </figcaption>
      <div class="chart-plot">
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${series.name}: ${pts.map((p) => `${fmtShortDate(p.check.createdAt)} ${fmtScore(p.avg)}`).join(', ')}">
          ${[1, 3, 5].map((v) => html`<line x1=${left} x2=${W - right} y1=${y(v)} y2=${y(v)} class="grid" /><text x="0" y=${y(v) + 3.5} class="tick">${v}</text>`)}
          ${pts.length > 1 && html`<polyline points=${pts.map((p, i) => `${x(i).toFixed(1)},${y(p.avg).toFixed(1)}`).join(' ')} class="line now" />`}
          ${hover != null && html`<line x1=${x(hover)} x2=${x(hover)} y1=${top} y2=${H - bottom} class="cross" />`}
          ${shown && hover !== pts.length - 1 && html`<circle cx=${x(hover)} cy=${y(shown.avg)} r="4.5" class="dot now" />`}
          <circle cx=${x(pts.length - 1)} cy=${y(last.avg)} r="4.5" class="dot now" />
          <text x=${x(pts.length - 1) + 10} y=${y(last.avg) + 4.5} class="end-value">${fmtScore(last.avg)}</text>
          ${pts.map((p, i) => {
            const half = pts.length === 1 ? 20 : (W - left - right) / (pts.length - 1) / 2;
            return html`
              <rect
                x=${x(i) - half} y="0" width=${half * 2} height=${H} class="hit" tabindex="0"
                aria-label="${p.check.title}, ${fmtShortDate(p.check.createdAt)}: ${fmtScore(p.avg)}"
                onMouseEnter=${() => setHover(i)} onMouseLeave=${() => setHover(null)}
                onFocus=${() => setHover(i)} onBlur=${() => setHover(null)}
              />
            `;
          })}
        </svg>
        ${shown && html`
          <div class="chart-tip" style="left: ${(x(hover) / W) * 100}%; top: ${(y(shown.avg) / H) * 100}%">
            <strong>${shown.check.title}</strong>
            <span>${fmtShortDate(shown.check.createdAt)} <b>${fmtScore(shown.avg)}</b></span>
          </div>
        `}
      </div>
    </figure>
  `;
}

/** A signed change with an arrow and words, so direction never relies on color. */
export function Delta({ value, label }) {
  if (value == null) return null;
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return html`<span class="delta flat">No change${label ? ` ${label}` : ''}</span>`;
  const up = rounded > 0;
  return html`
    <span class="delta ${up ? 'up' : 'down'}">
      <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true"><path d=${up ? 'M5 1 9.5 9h-9Z' : 'M5 9 .5 1h9Z'} fill="currentColor" /></svg>
      ${up ? 'Up' : 'Down'} ${Math.abs(rounded).toFixed(1)}${label ? ` ${label}` : ''}
    </span>
  `;
}
