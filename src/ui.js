/**
 * DOM layer: the dish tray, the rack switch, warnings, the results card and the
 * level select. The tray icons are drawn from the same lathe profiles the 3D meshes
 * use, so a mug in the tray is unmistakably the mug you are about to pick up.
 */
import { DISHES, iconShape } from './dishes.js';
import { LEVELS, levelItemCount } from './levels.js';
import * as sfx from './audio.js';

const PROGRESS_KEY = 'dishwasher-packing.progress.v1';

export function loadProgress() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}; } catch { return {}; }
}
export function saveProgress(p) {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); } catch { /* private mode */ }
}
export function clearProgress() {
  try { localStorage.removeItem(PROGRESS_KEY); } catch { /* ignore */ }
}

const $ = (sel) => document.querySelector(sel);

export function createUI(handlers) {
  const el = {
    hud: $('#hud'), lvlNum: $('#lvl-num'), lvlName: $('#lvl-name'),
    queue: $('#queue'), queueCount: $('#queue-count'),
    run: $('#btn-run'), warnings: $('#warnings'),
    cycle: $('#cycle'), cycleText: $('.cycle-text'),
    result: $('#result'), resultStars: $('#result-stars'), resultTitle: $('#result-title'),
    resultSub: $('#result-sub'), resultList: $('#result-list'),
    menu: $('#menu'), levels: $('#levels'), help: $('#help'),
    heldHint: $('#held-hint'), loading: $('#loading'),
    rackTabs: [...document.querySelectorAll('.rack-tab')],
  };

  /* ------------------------------ wiring ------------------------------ */
  el.run.addEventListener('click', () => { sfx.ui('up'); handlers.onRun?.(); });
  $('#btn-reset').addEventListener('click', () => { sfx.ui(); handlers.onReset?.(); });
  $('#btn-menu').addEventListener('click', () => { sfx.ui(); handlers.onMenu?.(); });
  $('#btn-help').addEventListener('click', () => { sfx.ui(); showHelp(true); });
  $('#btn-auto').addEventListener('click', () => { sfx.ui('up'); handlers.onAuto?.(); });
  $('#btn-help-close').addEventListener('click', () => { sfx.ui(); showHelp(false); });
  $('#btn-howto').addEventListener('click', () => { sfx.ui(); showHelp(true); });
  $('#btn-retry').addEventListener('click', () => { sfx.ui(); showResult(null); handlers.onRetry?.(); });
  $('#btn-fix').addEventListener('click', () => { sfx.ui(); showResult(null); handlers.onFix?.(); });
  $('#btn-next').addEventListener('click', () => { sfx.ui('up'); showResult(null); handlers.onNext?.(); });
  $('#btn-wipe').addEventListener('click', () => {
    clearProgress(); sfx.ui(); renderLevels();
  });
  for (const tab of el.rackTabs) {
    tab.addEventListener('click', () => { sfx.ui(); handlers.onRack?.(tab.dataset.rack); });
  }

  /* ------------------------------ the tray ------------------------------ */
  function iconCanvas(id) {
    const c = document.createElement('canvas');
    c.width = 88; c.height = 76;
    drawIcon(c, id);
    return c;
  }

  /**
   * entries: [{ id, remaining, total }]
   */
  function renderQueue(entries, heldId) {
    el.queue.innerHTML = '';
    let left = 0;
    for (const e of entries) {
      left += e.remaining;
      const card = document.createElement('button');
      card.className = 'qcard' + (e.remaining === 0 ? ' done' : '') + (heldId === e.id ? ' held' : '');
      card.title = DISHES[e.id]?.name ?? e.id;
      card.appendChild(iconCanvas(e.id));

      const name = document.createElement('div');
      name.className = 'qname';
      name.textContent = DISHES[e.id]?.name ?? e.id;
      card.appendChild(name);

      if (e.remaining > 0) {
        const n = document.createElement('div');
        n.className = 'qcount';
        n.textContent = e.remaining;
        card.appendChild(n);
      }
      const def = DISHES[e.id];
      const badge = { basket: ['🍴', 'Goes in the cutlery basket'],
                      upper: ['▲', 'Belongs in the upper rack'],
                      lower: ['▼', 'Belongs in the lower rack'] }[def?.belongs];
      if (badge) {
        const tag = document.createElement('div');
        tag.className = 'qtag';
        [tag.textContent, tag.title] = badge;
        card.appendChild(tag);
      }
      card.addEventListener('click', () => { sfx.ui(); handlers.onPickQueue?.(e.id); });
      el.queue.appendChild(card);
    }
    el.queueCount.textContent = left ? `· ${left}` : '· none, nice work';
    return left;
  }

  function setRunEnabled(on) { el.run.disabled = !on; }

  function setLevel(index) {
    const lv = LEVELS[index];
    el.lvlNum.textContent = String(index + 1);
    el.lvlName.textContent = lv.name;
  }

  function setRack(name) {
    for (const t of el.rackTabs) t.classList.toggle('active', t.dataset.rack === name);
  }

  function setHeldHint(on) { el.heldHint.classList.toggle('hidden', !on); }

  /* ------------------------------ warnings ------------------------------ */
  let warnTimer = null;
  function showWarnings(list, bad = false) {
    el.warnings.innerHTML = '';
    for (const text of list.slice(0, 3)) {
      const d = document.createElement('div');
      d.className = 'warn-chip' + (bad ? ' bad' : '');
      d.textContent = text;
      el.warnings.appendChild(d);
    }
    clearTimeout(warnTimer);
    if (list.length) warnTimer = setTimeout(() => { el.warnings.innerHTML = ''; }, 4200);
  }

  /* ------------------------------ overlays ------------------------------ */
  function showCycle(on, text) {
    el.cycle.classList.toggle('hidden', !on);
    if (text) el.cycleText.textContent = text;
  }
  function setPhase(text) { el.cycleText.textContent = text; }

  function showResult(res, ctx = {}) {
    if (!res) { el.result.classList.add('hidden'); return; }
    const stars = res.stars ?? 0;
    el.resultStars.innerHTML = [0, 1, 2].map((i) =>
      `<span class="${i < stars ? 'on' : 'off'}">★</span>`).join('');

    const flagged = ctx.flagged ?? 0;
    if (res.pass) {
      el.resultTitle.textContent = stars === 3 ? 'Spotless.' : stars === 2 ? 'Clean enough.' : 'It ran. Just.';
      el.resultSub.textContent = stars === 3
        ? 'Every item washed, every item drained, nothing chipped.'
        : 'The cycle finished, but the load could have been packed better.';
      $('#btn-next').textContent = ctx.isLast ? 'Back to menu' : 'Next level';
      $('#btn-next').classList.remove('hidden');
      $('#btn-fix').classList.add('hidden');
    } else {
      /* Nothing has been thrown away — the racks are still packed exactly as they
         were. Say so, because the obvious reading of a failure screen is that you
         have to start again. */
      el.resultTitle.textContent = res.aborted ? "That won't run." : 'It ran badly.';
      const pointer = flagged
        ? ` The ${flagged === 1 ? 'one at fault is' : `${flagged} at fault are`} marked in red — your load is untouched.`
        : ' Your load is untouched.';
      el.resultSub.textContent = (res.aborted
        ? 'The machine stopped before it started.'
        : 'The cycle finished, and this is what came out.') + pointer;
      $('#btn-next').classList.add('hidden');
      $('#btn-fix').classList.remove('hidden');
    }

    el.resultList.innerHTML = '';
    const add = (cls, text) => {
      const li = document.createElement('li');
      li.className = cls; li.textContent = text;
      el.resultList.appendChild(li);
    };
    for (const b of res.bad ?? []) add('bad', b);
    for (const w of res.warn ?? []) add('warn', w);
    if (res.pass && !(res.warn ?? []).length) add('ok', 'Nothing shaded, nothing pooled, nothing rattled loose.');

    el.result.classList.remove('hidden');
    sfx.fanfare(res.pass);
  }

  function showHelp(on) { el.help.classList.toggle('hidden', !on); }

  function showMenu(on) {
    el.menu.classList.toggle('hidden', !on);
    el.hud.classList.toggle('hidden', on);
    if (on) renderLevels();
  }

  function renderLevels() {
    const progress = loadProgress();
    const highest = Math.max(0, ...Object.keys(progress).map(Number).map((n) => n + 1));
    el.levels.innerHTML = '';
    LEVELS.forEach((lv, i) => {
      const stars = progress[i] ?? 0;
      const locked = i > highest;
      const card = document.createElement('button');
      card.className = 'lcard' + (locked ? ' locked' : '');
      card.innerHTML = `
        <div class="ln">Level ${i + 1}</div>
        <div class="lt">${escapeHtml(lv.name)}</div>
        <div class="ls">${[0, 1, 2].map((k) => `<span class="${k < stars ? 'on' : ''}">★</span>`).join('')}</div>
        <div class="lcount">${levelItemCount(lv)} items</div>
        ${locked ? '<div class="lk">🔒</div>' : ''}`;
      if (!locked) card.addEventListener('click', () => { sfx.ui('up'); handlers.onSelectLevel?.(i); });
      el.levels.appendChild(card);
    });
  }

  function hideLoading() { el.loading.classList.add('hidden'); }

  return {
    renderQueue, setRunEnabled, setLevel, setRack, setHeldHint,
    showWarnings, showCycle, setPhase, showResult, showMenu, showHelp,
    renderLevels, hideLoading,
    get menuOpen() { return !el.menu.classList.contains('hidden'); },
    get resultOpen() { return !el.result.classList.contains('hidden'); },
    get helpOpen() { return !el.help.classList.contains('hidden'); },
  };
}

/* ------------------------------ icon drawing ------------------------------ */
export function drawIcon(canvas, id) {
  const s = iconShape(id);
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.save();

  const fill = `#${s.color.toString(16).padStart(6, '0')}`;
  ctx.fillStyle = fill;
  ctx.strokeStyle = 'rgba(255,255,255,.35)';
  ctx.lineWidth = 1.4;
  ctx.lineJoin = 'round';

  const pad = 8;
  const cx = W / 2, baseY = H - pad;

  if (s.kind === 'profile') {
    const maxR = Math.max(...s.pts.map((p) => p.x));
    const maxY = Math.max(...s.pts.map((p) => p.y));
    const minY = Math.min(...s.pts.map((p) => p.y));
    const k = Math.min((W / 2 - pad) / Math.max(maxR, 1e-4), (H - pad * 2) / Math.max(maxY - minY, 1e-4));
    ctx.beginPath();
    s.pts.forEach((p, i) => {
      const x = cx + p.x * k, y = baseY - (p.y - minY) * k;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    for (let i = s.pts.length - 1; i >= 0; i--) {
      const p = s.pts[i];
      ctx.lineTo(cx - p.x * k, baseY - (p.y - minY) * k);
    }
    ctx.closePath();
    ctx.fill(); ctx.stroke();
  } else if (s.kind === 'rect') {
    const k = Math.min((W - pad * 2) / s.w, (H - pad * 2) / Math.max(s.h, 0.012));
    const w = s.w * k, h = Math.max(s.h * k, 4);
    if (s.hollow) {
      ctx.beginPath();
      ctx.moveTo(cx - w / 2, baseY - h);
      ctx.lineTo(cx - w / 2 + w * 0.06, baseY);
      ctx.lineTo(cx + w / 2 - w * 0.06, baseY);
      ctx.lineTo(cx + w / 2, baseY - h);
      ctx.lineTo(cx + w / 2 - 3, baseY - h);
      ctx.lineTo(cx + w / 2 - w * 0.09, baseY - 3);
      ctx.lineTo(cx - w / 2 + w * 0.09, baseY - 3);
      ctx.lineTo(cx - w / 2 + 3, baseY - h);
      ctx.closePath();
    } else {
      ctx.beginPath();
      ctx.roundRect(cx - w / 2, baseY - h, w, h, 2);
    }
    ctx.fill(); ctx.stroke();
  } else if (s.kind === 'stick') {
    const k = (H - pad * 2) / s.len;
    const L = s.len * k;
    ctx.beginPath();
    ctx.roundRect(cx - 2.5, baseY - L, 5, L * 0.72, 2);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    if (s.kind2 === 'spoon') ctx.ellipse(cx, baseY - L * 0.88, 6, 9, 0, 0, Math.PI * 2);
    else if (s.kind2 === 'fork') {
      ctx.roundRect(cx - 6, baseY - L, 12, L * 0.26, 2);
    } else ctx.roundRect(cx - 5, baseY - L, 10, L * 0.3, 2);
    ctx.fill(); ctx.stroke();
  } else if (s.kind === 'tool') {
    ctx.beginPath();
    ctx.roundRect(cx - 2.5, H * 0.30, 5, H * 0.5, 2);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    if (s.tool === 'whisk') {
      for (let i = -2; i <= 2; i++) {
        ctx.moveTo(cx, H * 0.32);
        ctx.quadraticCurveTo(cx + i * 5.5, H * 0.16, cx, H * 0.08);
      }
      ctx.stroke();
    } else if (s.tool === 'ladle') {
      ctx.arc(cx, H * 0.24, 8, 0, Math.PI); ctx.fill(); ctx.stroke();
    } else if (s.tool === 'spatula') {
      ctx.roundRect(cx - 8, H * 0.10, 16, H * 0.22, 3); ctx.fill(); ctx.stroke();
    } else if (s.tool === 'tongs') {
      ctx.moveTo(cx - 5, H * 0.10); ctx.lineTo(cx, H * 0.62);
      ctx.moveTo(cx + 5, H * 0.10); ctx.lineTo(cx, H * 0.62);
      ctx.stroke();
    } else {
      ctx.roundRect(cx - 6, H * 0.12, 12, H * 0.2, 3); ctx.fill(); ctx.stroke();
    }
  }
  ctx.restore();
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
