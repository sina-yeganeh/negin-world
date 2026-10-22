/* Negin World — radial galaxy mind map. Plain JS, no dependencies. */
(() => {
'use strict';

/* ================= helpers ================= */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
};
const fa = n => Number(n).toLocaleString('fa-IR');
const uid = () => 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const isHttp = u => /^https?:\/\//i.test(String(u || '').trim());
const safeMedia = u => /^(data:(image|video|audio)\/|https?:\/\/|media\/)/i.test(String(u || ''));
const CFG = window.NW_CONFIG || {};
let EDIT = new URLSearchParams(location.search).has('edit');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isMobile = () => innerWidth <= 720;

const PALETTE = ['#ff8fc7', '#ffb46b', '#6fb8ff', '#b98bff', '#5fe0c8', '#ffd76b', '#8f9bff', '#ff8fa3', '#8ef0a0', '#e3a6ff', '#7fe7ff', '#ff9b85', '#fff08a'];
const EMOJIS = ['⭐', '💖', '🌙', '✨', '🎵', '🎧', '📚', '🍰', '🌸', '🐱', '🎬', '🎨', '☕', '🌊', '🔥', '🍀', '🦋', '🎁', '📷', '💬', '😂', '🥹', '🫶', '🌷'];
const ROOT_COLOR = '#ff9ad5';

/* ================= crypto (AES-GCM + PBKDF2) ================= */
const te = new TextEncoder(), td = new TextDecoder();
const b64 = buf => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function deriveKey(pass, salt, iter) {
  const base = await crypto.subtle.importKey('raw', te.encode(pass.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function decryptData(pass) {
  const E = window.NW_ENC;
  if (!E) throw new Error('nodata');
  const k = await deriveKey(pass, unb64(E.salt), E.iter || 200000);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(E.iv) }, k, unb64(E.ct));
  return JSON.parse(td.decode(pt));
}
async function encryptToJs(obj, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), iter = 200000;
  const k = await deriveKey(pass, salt, iter);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, te.encode(JSON.stringify(obj)));
  return '/* Negin World — encrypted data. Do not edit by hand; export a new one from edit mode. */\n' +
    'window.NW_ENC = ' + JSON.stringify({ v: 1, iter, salt: b64(salt), iv: b64(iv), ct: b64(ct) }) + ';\n';
}

/* ================= state ================= */
let PASS = '';
let root = null;            // { id:'root', title, subtitle, welcome, signature, version, children }
const nodes = new Map();    // id -> runtime record
const expanded = new Set();
let selectedId = null;
const view = { x: innerWidth / 2, y: innerHeight / 2, s: 1 };

const viewport = $('#viewport'), world = $('#world'), linksSvg = $('#links'), nodesEl = $('#nodes'), panel = $('#panel');

function fromData(d) {
  const r = { id: 'root', version: d.version || 0, ...(d.center || {}), children: d.branches || [] };
  const seen = new Set();
  (function fix(n) { (n.children || []).forEach(c => { if (!c.id || seen.has(c.id)) c.id = uid(); seen.add(c.id); if (!c.children) c.children = []; fix(c); }); })(r);
  return r;
}
function toData() {
  return {
    version: root.version,
    center: { title: root.title, subtitle: root.subtitle, welcome: root.welcome, signature: root.signature },
    branches: root.children
  };
}
function findNode(id, n = root, parent = null, depth = 0, path = []) {
  if (n.id === id) return { n, parent, depth, path };
  for (const c of n.children || []) { const r = findNode(id, c, n, depth + 1, [...path, n]); if (r) return r; }
  return null;
}
function colorOf(id) {
  const f = findNode(id); if (!f) return ROOT_COLOR;
  if (f.depth === 0) return ROOT_COLOR;
  const top = f.depth === 1 ? f.n : f.path[1];
  return top.color || ROOT_COLOR;
}
function countAll(n = root) { return (n.children || []).reduce((a, c) => a + 1 + countAll(c), 0); }

/* ================= drafts ================= */
let saveT = null;
function saveDraft() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    const ok = store.set('nw-draft', JSON.stringify({ data: toData() }));
    if (!ok) toast('<div class="ts">⚠️ حافظه‌ی مرورگر پر شد. حتماً «خروجی برای گیت‌هاب» بگیر تا تغییرات از دست نره.</div>', 6000);
  }, 250);
}
function loadDraft(fileVersion) {
  const raw = store.get('nw-draft'); if (!raw) return null;
  try {
    const d = JSON.parse(raw).data;
    if (d && d.center && Array.isArray(d.branches) && (d.version || 0) >= (fileVersion || 0)) return d;
  } catch (e) { /* ignore */ }
  store.del('nw-draft');
  return null;
}

/* ================= node rendering ================= */
function thumbHTML(n) {
  const m = (n.media || []).find(x => x.type === 'image' || x.type === 'video');
  if (!n.thumb || !m || !safeMedia(m.src)) return '';
  return m.type === 'image'
    ? `<div class="th"><img src="${esc(m.src)}" alt="" draggable="false"></div>`
    : `<div class="th"><video src="${esc(m.src)}" autoplay loop muted playsinline></video></div>`;
}
function renderNode(o) {
  const n = o.n, c = colorOf(n.id), kids = (n.children || []).length;
  o.el.style.setProperty('--c', c);
  o.el.className = 'nd ' + (o.d === 0 ? 'root' : o.d === 1 ? 'branch' : 'leaf') +
    (expanded.has(n.id) ? ' open' : '') + (n.quote ? ' quote' : '') + (selectedId === n.id ? ' sel' : '') +
    (o.d >= 2 && thumbHTML(n) ? ' has-th' : '') + (o.entered ? ' in' : '') + (o.leaving ? ' out' : '');
  let h;
  if (o.d === 0) {
    h = `<div class="ndi"><div class="planet"><b>${esc(n.title || 'نگین')}</b><i>${esc(n.subtitle || '')}</i></div></div>`;
  } else if (o.d === 1) {
    h = `<div class="ndi"><div class="orb"><span class="em">${esc(n.emoji || '⭐')}</span>${kids ? `<span class="cnt">${fa(kids)}</span>` : ''}</div><span class="lbl">${esc(n.title)}</span></div>`;
  } else {
    const th = thumbHTML(n);
    const more = kids ? `<span class="more">${expanded.has(n.id) ? '−' : '+' + fa(kids)}</span>` : '';
    h = th
      ? `<div class="ndi">${th}<div class="lbl-row"><span class="lbl">${esc(n.title)}</span>${more}</div></div>`
      : `<div class="ndi"><span class="em">${esc(n.emoji || '✦')}</span><span class="lbl">${esc(n.title)}</span>${more}</div>`;
  }
  o.el.innerHTML = h;
  if (o.path) o.path.setAttribute('stroke', c);
}
function refreshAll() { nodes.forEach(o => { if (!o.leaving) renderNode(o); }); }

/* ================= layout ================= */
function visibleList() {
  const vis = [];
  (function rec(n, p, d) {
    vis.push({ n, p, d });
    if (d === 0 || expanded.has(n.id)) (n.children || []).forEach(c => rec(c, n, d + 1));
  })(root, null, 0);
  return vis;
}
function computeLayout(vis) {
  const kids = n => (n === root || expanded.has(n.id)) ? (n.children || []) : [];
  const W = n => { const k = kids(n); return k.length ? k.reduce((a, c) => a + W(c), 0) : 1; };
  const N1 = Math.max(1, root.children.length), L = W(root), TAU = Math.PI * 2;
  let maxD = 0; vis.forEach(v => { maxD = Math.max(maxD, v.d); });
  const need = L * 104 / TAU; // radius needed so all visible leaves fit on one ring
  const r = [0, Math.max(isMobile() ? 230 : 270, N1 * 158 / TAU, maxD >= 2 ? need - 290 : 0)];
  for (let d = 2; d <= maxD; d++) r[d] = Math.max(r[d - 1] + (d === 2 ? 235 : 210), need);

  const pos = new Map([['root', { x: 0, y: 0, a: 0, r: 0 }]]);
  const first = root.children[0];
  const a0 = -Math.PI / 2 - (first ? TAU * W(first) / L / 2 : 0);
  (function assign(n, s, e, d) {
    const k = kids(n); if (!k.length) return;
    const tot = k.reduce((a, c) => a + W(c), 0); let a = s;
    k.forEach(c => {
      const span = (e - s) * W(c) / tot, am = a + span / 2, rr = r[d + 1];
      pos.set(c.id, { a: am, r: rr, x: Math.cos(am) * rr, y: Math.sin(am) * rr, d: d + 1 });
      assign(c, a, a + span, d + 1); a += span;
    });
  })(root, a0, a0 + TAU, 0);

  // relax overlaps by pushing outer nodes outward along their ray
  const items = vis.map(v => { const o = nodes.get(v.n.id); return { id: v.n.id, d: v.d, p: pos.get(v.n.id), w: (o.w || 120) + 14, h: (o.h || 40) + 12 }; });
  for (let it = 0; it < 80; it++) {
    let moved = false;
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const A = items[i], B = items[j];
      if (A.d <= 1 && B.d <= 1) continue;
      const ox = (A.w + B.w) / 2 - Math.abs(A.p.x - B.p.x), oy = (A.h + B.h) / 2 - Math.abs(A.p.y - B.p.y);
      if (ox > 0 && oy > 0) {
        const M = (A.d > B.d || (A.d === B.d && A.p.r >= B.p.r)) ? A : B;
        if (M.d === 0) continue;
        M.p.r += Math.min(18, Math.min(ox, oy) + 2);
        M.p.x = Math.cos(M.p.a) * M.p.r; M.p.y = Math.sin(M.p.a) * M.p.r; moved = true;
      }
    }
    if (!moved) break;
  }
  return pos;
}

/* ================= update / DOM sync ================= */
function createNode(v) {
  const parent = v.p ? nodes.get(v.p.id) : null;
  const start = parent ? { ...parent.cur } : { x: 0, y: 0 };
  const el = document.createElement('div');
  el.dataset.id = v.n.id;
  const o = { n: v.n, p: v.p, d: v.d, el, cur: start, tgt: { ...start }, from: { ...start }, w: 0, h: 0, leaving: false, entered: false, path: null };
  if (v.p) {
    o.path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    o.path.setAttribute('class', 'd' + Math.min(3, v.d));
    linksSvg.appendChild(o.path);
  }
  nodes.set(v.n.id, o);
  renderNode(o);
  nodesEl.appendChild(el);
  el.style.transform = `translate(${start.x}px,${start.y}px) translate(-50%,-50%)`;
  requestAnimationFrame(() => requestAnimationFrame(() => { o.entered = true; if (!o.leaving) el.classList.add('in'); }));
  return o;
}
function update(opts = {}) {
  const vis = visibleList();
  const ids = new Set(vis.map(v => v.n.id));
  // mark leaving
  nodes.forEach((o, id) => {
    if (!ids.has(id) && !o.leaving) { o.leaving = true; o.el.classList.remove('in'); o.el.classList.add('out'); }
  });
  vis.forEach(v => {
    let o = nodes.get(v.n.id);
    if (o && o.leaving) { o.leaving = false; o.el.classList.remove('out'); o.el.classList.add('in'); }
    if (!o) o = createNode(v);
    o.n = v.n; o.p = v.p; o.d = v.d;
    renderNode(o);
  });
  vis.forEach(v => { const o = nodes.get(v.n.id); o.w = o.el.offsetWidth; o.h = o.el.offsetHeight; });
  const pos = computeLayout(vis);
  vis.forEach(v => { const o = nodes.get(v.n.id), p = pos.get(v.n.id); o.tgt = { x: p.x, y: p.y }; });
  // leaving nodes collapse into their nearest visible ancestor
  nodes.forEach(o => {
    if (!o.leaving) return;
    let pid = o.p && o.p.id, anc = pid && nodes.get(pid);
    while (anc && anc.leaving) { pid = anc.p && anc.p.id; anc = pid && nodes.get(pid); }
    o.tgt = anc ? { ...anc.tgt } : { x: 0, y: 0 };
  });
  animateNodes(opts.after);
}

let nodeAnim = 0;
const ease = t => 1 - Math.pow(1 - t, 3);
function animateNodes(after) {
  cancelAnimationFrame(nodeAnim);
  const t0 = performance.now(), dur = reduceMotion ? 1 : 750;
  nodes.forEach(o => { o.from = { ...o.cur }; });
  const step = t => {
    const k = Math.min(1, (t - t0) / dur), e = ease(k);
    nodes.forEach(o => { o.cur.x = o.from.x + (o.tgt.x - o.from.x) * e; o.cur.y = o.from.y + (o.tgt.y - o.from.y) * e; });
    drawNodes();
    if (k < 1) nodeAnim = requestAnimationFrame(step);
    else {
      nodes.forEach((o, id) => { if (o.leaving) { o.el.remove(); o.path && o.path.remove(); nodes.delete(id); } });
      if (after) after();
    }
  };
  nodeAnim = requestAnimationFrame(step);
}
function radial(x, y) { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; }
function drawNodes() {
  nodes.forEach(o => {
    o.el.style.transform = `translate(${o.cur.x}px,${o.cur.y}px) translate(-50%,-50%)`;
    if (o.path && o.p) {
      const P = nodes.get(o.p.id); if (!P) return;
      const px = P.cur.x, py = P.cur.y, cx = o.cur.x, cy = o.cur.y, dist = Math.hypot(cx - px, cy - py);
      const [ux, uy] = P.d === 0 ? radial(cx - px, cy - py) : radial(px, py);
      const [vx, vy] = radial(cx, cy);
      const k = dist * 0.42;
      o.path.setAttribute('d', `M${px.toFixed(1)},${py.toFixed(1)} C${(px + ux * k).toFixed(1)},${(py + uy * k).toFixed(1)} ${(cx - vx * k).toFixed(1)},${(cy - vy * k).toFixed(1)} ${cx.toFixed(1)},${cy.toFixed(1)}`);
    }
  });
}

/* ================= view: pan / zoom ================= */
function applyView() { world.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.s})`; }
let viewAnim = 0;
function tweenView(tx, ty, ts, dur = 650) {
  cancelAnimationFrame(viewAnim);
  if (reduceMotion) dur = 1;
  const f = { ...view }, t0 = performance.now();
  const step = t => {
    const k = Math.min(1, (t - t0) / dur), e = ease(k);
    view.x = f.x + (tx - f.x) * e; view.y = f.y + (ty - f.y) * e; view.s = f.s + (ts - f.s) * e;
    applyView(); if (k < 1) viewAnim = requestAnimationFrame(step);
  };
  viewAnim = requestAnimationFrame(step);
}
function focusArea() {
  const W = innerWidth, H = innerHeight, top = 70;
  if (panel.classList.contains('open')) {
    if (isMobile()) { const ph = panel.getBoundingClientRect().height; return { x: W / 2, y: top + (H - ph - top) / 2, w: W, h: H - ph - top }; }
    const pr = panel.getBoundingClientRect().right; return { x: pr + (W - pr) / 2, y: top + (H - top) / 2, w: W - pr, h: H - top };
  }
  return { x: W / 2, y: top + (H - top) / 2, w: W, h: H - top };
}
function fitView(ids, minS = 0.22) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  nodes.forEach((o, id) => {
    if (o.leaving || (ids && !ids.includes(id))) return;
    x0 = Math.min(x0, o.tgt.x - o.w / 2); x1 = Math.max(x1, o.tgt.x + o.w / 2);
    y0 = Math.min(y0, o.tgt.y - o.h / 2); y1 = Math.max(y1, o.tgt.y + o.h / 2);
  });
  if (!isFinite(x0)) return;
  const A = focusArea();
  const s = Math.max(minS, Math.min(1.15, (A.w - 40) / (x1 - x0), (A.h - 40) / (y1 - y0)));
  tweenView(A.x - ((x0 + x1) / 2) * s, A.y - ((y0 + y1) / 2) * s, s);
}
function panTo(id, scale) {
  const o = nodes.get(id); if (!o) return;
  const A = focusArea(), s = scale || Math.max(view.s, isMobile() ? 0.62 : 0.8);
  tweenView(A.x - o.tgt.x * s, A.y - o.tgt.y * s, s);
}
function zoomAt(f, sx, sy) {
  cancelAnimationFrame(viewAnim);
  const ns = Math.max(0.18, Math.min(2.6, view.s * f));
  view.x = sx - (sx - view.x) * (ns / view.s); view.y = sy - (sy - view.y) * (ns / view.s); view.s = ns; applyView();
}

const pointers = new Map();
let drag = null, pinch = null, moved = false;
viewport.addEventListener('pointerdown', e => {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  viewport.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  cancelAnimationFrame(viewAnim);
  if (pointers.size === 1) { drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, target: e.target }; moved = false; }
  else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: view.s, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, vx: view.x, vy: view.y };
    moved = true;
  }
});
viewport.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const ns = Math.max(0.18, Math.min(2.6, pinch.s * d / pinch.d));
    view.x = mx - (pinch.mx - pinch.vx) * (ns / pinch.s); view.y = my - (pinch.my - pinch.vy) * (ns / pinch.s); view.s = ns; applyView();
  } else if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!moved && Math.hypot(dx, dy) > 6) { moved = true; viewport.classList.add('dragging'); }
    if (moved) { view.x = drag.vx + dx; view.y = drag.vy + dy; applyView(); }
  }
});
const endPointer = e => {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (pointers.size === 0) {
    viewport.classList.remove('dragging');
    if (drag && !moved && e.type === 'pointerup') {
      const ndEl = drag.target.closest && drag.target.closest('.nd');
      if (ndEl) onNodeClick(ndEl.dataset.id);
    }
    drag = null;
  } else if (pointers.size === 1) {
    const [p] = [...pointers.values()]; drag = { x: p.x, y: p.y, vx: view.x, vy: view.y, target: viewport };
  }
};
viewport.addEventListener('pointerup', endPointer);
viewport.addEventListener('pointercancel', endPointer);
viewport.addEventListener('wheel', e => {
  e.preventDefault();
  const f = e.ctrlKey ? Math.exp(-e.deltaY * 0.01) : Math.exp(-e.deltaY * 0.0015);
  zoomAt(f, e.clientX, e.clientY);
}, { passive: false });

/* ================= interactions ================= */
function select(id) {
  selectedId = id;
  nodes.forEach((o, k) => o.el.classList.toggle('sel', k === id));
}
function onNodeClick(id) {
  hideHint();
  const f = findNode(id); if (!f) return;
  const hasKids = (f.n.children || []).length > 0;
  select(id);
  if (f.depth > 0 && hasKids) {
    const opening = !expanded.has(id);
    if (opening) expanded.add(id); else collapseDeep(f.n);
    openPanel(id);
    update({ after: () => { if (opening) fitView([id, ...f.n.children.map(c => c.id)], isMobile() ? 0.5 : 0.4); else panTo(id); } });
  } else {
    openPanel(id);
    requestAnimationFrame(() => panTo(id));
  }
}
function collapseDeep(n) { expanded.delete(n.id); (n.children || []).forEach(collapseDeep); }
function expandPath(id) {
  const f = findNode(id); if (!f) return;
  f.path.forEach(p => { if (p !== root) expanded.add(p.id); });
}
function goTo(id) {
  expandPath(id); select(id); openPanel(id);
  update({ after: () => panTo(id) });
}

/* ================= panel (view) ================= */
function mediaHTML(m, i, n) {
  const cap = m.caption ? `<figcaption>${esc(m.caption)}</figcaption>` : '';
  if ((m.type === 'image' || m.type === 'video' || m.type === 'audio') && !safeMedia(m.src)) return '';
  switch (m.type) {
    case 'image': return `<figure class="pm${m.sticker ? ' sticker' : ''}"><img src="${esc(m.src)}" alt="${esc(m.caption || n.title)}" ${m.sticker ? '' : `data-lb="${i}"`}>${cap}</figure>`;
    case 'video': return `<figure class="pm${m.sticker ? ' sticker' : ''}"><video src="${esc(m.src)}" autoplay loop muted playsinline controlslist="nodownload"></video>${cap}</figure>`;
    case 'audio': return `<div class="pm audio"><div class="cap">🎧 ${esc(m.caption || 'آهنگ')}</div><audio controls preload="none" src="${esc(m.src)}"></audio></div>`;
    case 'music':
    case 'link': {
      if (!isHttp(m.src)) return '';
      let host = ''; try { host = new URL(m.src).hostname.replace(/^www\./, ''); } catch (e) { /* ignore */ }
      const icon = m.type === 'music' ? (/spotify/.test(host) ? '🟢' : /youtu/.test(host) ? '▶️' : /soundcloud/.test(host) ? '☁️' : '🎵') : (/instagram/.test(host) ? '📸' : '🔗');
      return `<div class="pm"><a class="linkcard" href="${esc(m.src)}" target="_blank" rel="noopener noreferrer"><span class="li">${icon}</span><span class="lt"><b>${esc(m.caption || (m.type === 'music' ? 'گوش بده' : 'باز کن'))}</b><span>${esc(host)}</span></span><span>↗</span></a></div>`;
    }
  }
  return '';
}
function crumbHTML(f) {
  const parts = f.path.map(p => `<a data-go="${esc(p.id)}">${esc(p === root ? (root.title || 'نگین') : p.title)}</a>`);
  return parts.length ? parts.join(' ‹ ') : 'مرکز دنیا';
}
function openPanel(id) {
  const f = findNode(id); if (!f) return;
  const n = f.n, c = colorOf(id);
  panel.style.setProperty('--c', c);
  const head = `<div class="p-head"><div class="p-orb">${f.depth === 0 ? '🪐' : esc(n.emoji || '✦')}</div>
    <div class="p-titles"><div class="p-crumb">${crumbHTML(f)}</div><h2 class="p-title">${esc(f.depth === 0 ? (n.title || 'نگین') : (n.quote ? 'جمله‌ی معروف' : n.title))}</h2></div>
    <button class="p-close" data-close aria-label="بستن">✕</button></div>`;
  let body;
  if (EDIT) body = editFormHTML(f);
  else if (f.depth === 0) {
    const all = countAll();
    body = `<p class="p-text">${esc(n.welcome || '')}</p>${n.signature ? `<div class="p-sign">${esc(n.signature)}</div>` : ''}
      <div class="p-stats"><div class="p-stat"><b>${fa(root.children.length)}</b><span>سیاره</span></div><div class="p-stat"><b>${fa(all - root.children.length)}</b><span>تیکه از نگین</span></div></div>
      <div class="p-sec">سیاره‌ها</div>${chipsHTML(root.children)}`;
  } else {
    const media = (n.media || []).map((m, i) => mediaHTML(m, i, n)).join('');
    body = (n.quote ? `<p class="p-quote">${esc(n.title)}</p>` : '') +
      (n.text ? `<p class="p-text">${esc(n.text)}</p>` : '') + media +
      ((n.children || []).length ? `<div class="p-sec">${f.depth === 1 ? 'تیکه‌های این سیاره' : 'شاخه‌ها'}</div>${chipsHTML(n.children)}` : '') +
      (!n.text && !media && !(n.children || []).length && !n.quote ? '<p class="p-empty">هنوز چیزی اینجا نیست… ✨</p>' : '');
  }
  panel.innerHTML = head + `<div class="p-body">${body}</div>`;
  panel.classList.add('open');
  if (EDIT) bindEditForm(f);
}
function chipsHTML(list) {
  return `<div class="chips">${list.map(k => `<button class="chip" data-go="${esc(k.id)}" style="--c:${colorOf(k.id)}"><span>${esc(k.quote ? '💬' : (k.emoji || '✦'))}</span>${esc(k.title)}</button>`).join('')}</div>`;
}
function closePanel() {
  panel.classList.remove('open'); select(null);
}
panel.addEventListener('click', e => {
  if (e.target.closest('[data-close]')) return closePanel();
  const go = e.target.closest('[data-go]');
  if (go) { const id = go.dataset.go; if (id === 'root') { select('root'); openPanel('root'); panTo('root'); } else goTo(id); return; }
  const img = e.target.closest('img[data-lb]');
  if (img && !EDIT) { const lb = $('#lightbox'); lb.innerHTML = `<img src="${esc(img.getAttribute('src'))}" alt="">`; lb.hidden = false; }
});
$('#lightbox').addEventListener('click', e => { e.currentTarget.hidden = true; e.currentTarget.innerHTML = ''; });
addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (!$('#lightbox').hidden) $('#lightbox').click(); else if (!$('#modal').hidden) closeModal(); else closePanel(); }
});

/* ================= toolbar ================= */
let allOpen = false;
$('#btnExpand').addEventListener('click', () => {
  allOpen = !allOpen;
  if (allOpen) (function rec(n) { (n.children || []).forEach(c => { if ((c.children || []).length) { expanded.add(c.id); rec(c); } }); })(root);
  else expanded.clear();
  $('#btnExpand').classList.toggle('on', allOpen);
  update({ after: () => fitView() });
});
$('#btnFit').addEventListener('click', () => fitView());
$('#btnQuote').addEventListener('click', () => {
  const qs = []; (function rec(n) { (n.children || []).forEach(c => { if (c.quote) qs.push(c); rec(c); }); })(root);
  if (!qs.length) return toast('<div class="ts">هنوز جمله‌ای ثبت نشده 💬</div>');
  const q = qs[Math.floor(Math.random() * qs.length)];
  toast(`<div class="tq">${esc(q.title)}</div>${q.text ? `<div class="ts">${esc(q.text)}</div>` : ''}<button data-go="${esc(q.id)}">نشونم بده ←</button>`, 6000);
});
let toastT = null;
function toast(html, ms = 3500) {
  const t = $('#toast'); t.innerHTML = html; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}
$('#toast').addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) { $('#toast').classList.remove('show'); goTo(g.dataset.go); } });
let hintT = null;
function showHint() { const h = $('#hint'); h.hidden = false; hintT = setTimeout(hideHint, 7000); }
function hideHint() { clearTimeout(hintT); const h = $('#hint'); h.classList.add('fade'); setTimeout(() => { h.hidden = true; }, 1000); }

/* ================= modal ================= */
function openModal(html) { const m = $('#modal'); m.innerHTML = `<div class="mcard">${html}</div>`; m.hidden = false; }
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal' || e.target.closest('[data-mclose]')) closeModal(); });

/* ================= edit mode ================= */
function editFormHTML(f) {
  const n = f.n;
  if (f.depth === 0) {
    return `<div class="ef">
      <label>اسم وسط دنیا</label><input type="text" data-k="title" value="${esc(n.title)}">
      <label>زیرعنوان (انگلیسی)</label><input type="text" data-k="subtitle" value="${esc(n.subtitle)}" dir="ltr">
      <label>پیام خوش‌آمد</label><textarea data-k="welcome">${esc(n.welcome)}</textarea>
      <label>امضا</label><input type="text" data-k="signature" value="${esc(n.signature)}">
      <div class="actions"><button class="btn primary" data-act="add-child">+ سیاره‌ی جدید</button></div>
    </div>`;
  }
  const media = (n.media || []).map((m, i) => {
    const icon = { image: '🖼️', video: '🎬', audio: '🎧', music: '🎵', link: '🔗' }[m.type] || '•';
    const prev = m.type === 'image' && safeMedia(m.src) ? `<img src="${esc(m.src)}" alt="">` : m.type === 'video' && safeMedia(m.src) ? `<video src="${esc(m.src)}" muted></video>` : icon;
    return `<div class="mrow"><span class="mprev">${prev}</span><input type="text" data-mcap="${i}" value="${esc(m.caption || '')}" placeholder="توضیح (اختیاری)"><button data-mdel="${i}" title="حذف">🗑</button></div>`;
  }).join('');
  return `<div class="ef">
    <label>عنوان</label><input type="text" data-k="title" value="${esc(n.title)}">
    <label>ایموجی</label>
    <div class="row"><input type="text" class="emo-in" data-k="emoji" value="${esc(n.emoji || '')}"><div class="emo-pal">${EMOJIS.map(e => `<button data-emo="${e}">${e}</button>`).join('')}</div></div>
    ${f.depth === 1 ? `<label>رنگ سیاره</label><div class="swatches">${PALETTE.map(p => `<button data-color="${p}" style="--s:${p}" class="${p === n.color ? 'on' : ''}"></button>`).join('')}</div>` : ''}
    <label>توضیح</label><textarea data-k="text" placeholder="هر چی راجع بهش می‌دونی…">${esc(n.text || '')}</textarea>
    ${f.depth >= 2 ? `<label class="check"><input type="checkbox" data-kb="quote" ${n.quote ? 'checked' : ''}> این یه «جمله‌ی معروف»ه (عنوان = خود جمله)</label>
    <label class="check"><input type="checkbox" data-kb="thumb" ${n.thumb ? 'checked' : ''}> عکس/ویدیوی اول رو روی نقشه نشون بده</label>` : ''}
    <label>عکس، ویدیو، آهنگ و لینک</label>
    <div class="mlist">${media || '<span class="p-empty">چیزی اضافه نشده</span>'}</div>
    <div class="madd">
      <button data-madd="image">🖼️ عکس</button><button data-madd="video">🎬 ویدیو/استیکر</button>
      <button data-madd="music">🎵 لینک آهنگ</button><button data-madd="audio">🎧 فایل آهنگ</button><button data-madd="link">🔗 لینک</button>
    </div>
    <div id="linkForm"></div>
    <input type="file" id="mFile" hidden>
    <div class="actions">
      <button class="btn primary" data-act="add-child">+ زیرشاخه</button>
      <button class="btn" data-act="up">⬆️</button><button class="btn" data-act="down">⬇️</button>
      <button class="btn danger" data-act="delete">🗑 حذف</button>
    </div>
    <p class="note">تغییرها خودکار روی همین مرورگر ذخیره می‌شن. برای اینکه روی سایت اصلی هم بیاد، از «خروجی برای گیت‌هاب» استفاده کن.</p>
  </div>`;
}
let relayoutT = null;
function changed(relayout = true) {
  saveDraft(); refreshAll();
  if (relayout) { clearTimeout(relayoutT); relayoutT = setTimeout(() => update(), 350); }
}
function bindEditForm(f) {
  const n = f.n, body = panel.querySelector('.ef'); if (!body) return;
  body.querySelectorAll('[data-k]').forEach(inp => inp.addEventListener('input', () => {
    n[inp.dataset.k] = inp.value;
    if (inp.dataset.k === 'title' || inp.dataset.k === 'emoji') { const t = panel.querySelector('.p-title'); if (inp.dataset.k === 'title' && t) t.textContent = inp.value; const o = panel.querySelector('.p-orb'); if (inp.dataset.k === 'emoji' && o) o.textContent = inp.value || '✦'; }
    changed(inp.dataset.k !== 'text' && inp.dataset.k !== 'welcome' && inp.dataset.k !== 'signature');
  }));
  body.querySelectorAll('[data-kb]').forEach(inp => inp.addEventListener('change', () => { n[inp.dataset.kb] = inp.checked; changed(); }));
  body.querySelectorAll('[data-mcap]').forEach(inp => inp.addEventListener('input', () => { n.media[+inp.dataset.mcap].caption = inp.value; saveDraft(); }));
  body.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.emo) { n.emoji = b.dataset.emo; body.querySelector('[data-k=emoji]').value = n.emoji; panel.querySelector('.p-orb').textContent = n.emoji; changed(false); }
    else if (b.dataset.color) { n.color = b.dataset.color; body.querySelectorAll('[data-color]').forEach(x => x.classList.toggle('on', x === b)); panel.style.setProperty('--c', n.color); changed(false); }
    else if (b.dataset.mdel != null) { n.media.splice(+b.dataset.mdel, 1); changed(); openPanel(n.id); }
    else if (b.dataset.madd) addMedia(n, b.dataset.madd);
    else if (b.dataset.act === 'add-child') addChild(n);
    else if (b.dataset.act === 'up' || b.dataset.act === 'down') {
      const sib = f.parent.children, i = sib.indexOf(n), j = b.dataset.act === 'up' ? i - 1 : i + 1;
      if (j >= 0 && j < sib.length) { [sib[i], sib[j]] = [sib[j], sib[i]]; saveDraft(); update(); }
    } else if (b.dataset.act === 'delete') {
      if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'مطمئنی؟ دوباره بزن'; setTimeout(() => { b.classList.remove('armed'); b.textContent = '🗑 حذف'; }, 3000); return; }
      f.parent.children.splice(f.parent.children.indexOf(n), 1);
      saveDraft(); closePanel(); update();
    }
  });
}
function addChild(parent) {
  const isTop = parent === root;
  const c = { id: uid(), title: isTop ? 'سیاره‌ی جدید' : 'شاخه‌ی جدید', emoji: isTop ? '🌟' : '✦', text: '', children: [] };
  if (isTop) c.color = PALETTE[root.children.length % PALETTE.length];
  parent.children = parent.children || [];
  parent.children.push(c);
  if (!isTop) expanded.add(parent.id);
  saveDraft(); select(c.id); openPanel(c.id);
  update({ after: () => { panTo(c.id); const t = panel.querySelector('[data-k=title]'); if (t) { t.focus(); t.select(); } } });
}
function readFile(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); }); }
async function compressImage(file) {
  if (file.type === 'image/gif') return readFile(file);
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, 1100 / Math.max(img.width, img.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    const alpha = /png|webp/.test(file.type);
    return cv.toDataURL(alpha ? 'image/webp' : 'image/jpeg', 0.82);
  } finally { URL.revokeObjectURL(url); }
}
function addMedia(n, type) {
  n.media = n.media || [];
  if (type === 'music' || type === 'link') {
    const lf = panel.querySelector('#linkForm');
    lf.innerHTML = `<div class="linkform"><input type="url" id="lfUrl" placeholder="https://…" dir="ltr"><input type="text" id="lfCap" placeholder="${type === 'music' ? 'اسم آهنگ / خواننده' : 'متن دکمه'}"><div class="row"><button class="btn primary" id="lfOk">افزودن</button><button class="btn" id="lfNo">انصراف</button></div></div>`;
    lf.querySelector('#lfUrl').focus();
    lf.querySelector('#lfNo').onclick = () => { lf.innerHTML = ''; };
    lf.querySelector('#lfOk').onclick = () => {
      const u = lf.querySelector('#lfUrl').value.trim();
      if (!isHttp(u)) { toast('<div class="ts">لینک باید با https:// شروع بشه</div>'); return; }
      n.media.push({ type, src: u, caption: lf.querySelector('#lfCap').value.trim() });
      changed(false); openPanel(n.id);
    };
    return;
  }
  const inp = panel.querySelector('#mFile');
  inp.accept = type === 'image' ? 'image/*' : type === 'video' ? 'video/*,image/gif' : 'audio/*';
  inp.onchange = async () => {
    const file = inp.files[0]; if (!file) return;
    const limit = type === 'image' ? 15 : 4;
    if (file.size > limit * 1024 * 1024) { toast(`<div class="ts">فایل خیلی بزرگه (حداکثر ${fa(limit)} مگابایت)</div>`); return; }
    try {
      const src = type === 'image' ? await compressImage(file) : await readFile(file);
      n.media.push({ type: (type === 'video' && file.type === 'image/gif') ? 'image' : type, src, caption: '' });
      if (n.thumb === undefined && (type === 'image' || type === 'video')) n.thumb = true;
      changed(); openPanel(n.id);
    } catch (e) { toast('<div class="ts">خوندن فایل نشد 😕</div>'); }
  };
  inp.click();
}
function download(name, text, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function setupEditBar() {
  $('#editbar').hidden = !EDIT;
  if (!EDIT) return;
  $('#ebAdd').onclick = () => addChild(selectedId && selectedId !== 'root' ? findNode(selectedId).n : root);
  $('#ebMore').onclick = e => { e.stopPropagation(); $('#ebMenu').hidden = !$('#ebMenu').hidden; };
  document.addEventListener('click', () => { $('#ebMenu').hidden = true; });
  $('#ebExport').onclick = () => {
    openModal(`<h3>💾 خروجی برای گیت‌هاب</h3>
      <p>یه فایل <code>data.enc.js</code> ساخته می‌شه که همه‌ی شاخه‌ها، عکس‌ها و استیکرها رو رمزنگاری‌شده داره.</p>
      <label style="font-size:13px;color:var(--muted)">رمز جدید (اگه خالی بمونه همون رمز فعلی می‌مونه)</label>
      <input type="text" id="newPass" dir="ltr" placeholder="••••">
      <div class="row"><button class="btn primary" id="doExport">دانلود فایل</button><button class="btn" data-mclose>انصراف</button></div>`);
    $('#doExport').onclick = async () => {
      const np = $('#newPass').value.trim();
      root.version = Date.now();
      const js = await encryptToJs(toData(), np || PASS);
      if (np) { PASS = np; if (store.get('nw-pass')) store.set('nw-pass', np); }
      saveDraft();
      download('data.enc.js', js, 'text/javascript');
      openModal(`<h3>✅ فایل ساخته شد</h3><ol>
        <li>فایل دانلودشده‌ی <code>data.enc.js</code> رو بردار.</li>
        <li>تو ریپوی گیت‌هاب، فایل <code>data.enc.js</code> قبلی رو با این جایگزین کن (Add file ← Upload files).</li>
        <li>Commit کن؛ یکی دو دقیقه بعد سایت آپدیت می‌شه.</li></ol>
        ${np ? '<p>⚠️ رمز عوض شد. رمز جدید رو یادت نره!</p>' : ''}
        <div class="row"><button class="btn primary" data-mclose>باشه</button></div>`);
    };
  };
  $('#ebMenu').addEventListener('click', e => {
    const act = e.target.closest('button') && e.target.closest('button').dataset.act; if (!act) return;
    if (act === 'backup') download('negin-world-backup.json', JSON.stringify(toData(), null, 2), 'application/json');
    if (act === 'import') $('#importFile').click();
    if (act === 'reset') {
      openModal(`<h3>↩️ برگشت به نسخه‌ی اصلی</h3><p>تغییرهایی که خروجی نگرفتی پاک می‌شن و سایت از روی فایل <code>data.enc.js</code> دوباره بارگذاری می‌شه.</p>
        <div class="row"><button class="btn primary" id="doReset">آره، برگرد</button><button class="btn" data-mclose>نه</button></div>`);
      $('#doReset').onclick = () => { store.del('nw-draft'); location.reload(); };
    }
    if (act === 'exit') { const u = new URL(location.href); u.searchParams.delete('edit'); location.href = u.toString(); }
  });
  $('#importFile').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      if (!d.center || !Array.isArray(d.branches)) throw new Error('bad');
      d.version = Math.max(d.version || 0, root.version || 0);
      store.set('nw-draft', JSON.stringify({ data: d }));
      location.reload();
    } catch (err) { toast('<div class="ts">این فایل پشتیبان معتبر نیست 😕</div>'); }
    e.target.value = '';
  };
}

/* ================= starfield ================= */
const cv = $('#stars'), ctx = cv.getContext('2d');
let stars = [], shooting = [], SW = 0, SH = 0, DPR = 1, nextShoot = 0;
function initStars() {
  DPR = Math.min(2, devicePixelRatio || 1); SW = innerWidth; SH = innerHeight;
  cv.width = SW * DPR; cv.height = SH * DPR;
  const n = Math.round(SW * SH / 2300);
  stars = Array.from({ length: n }, () => {
    const z = [0.12, 0.3, 0.55][Math.floor(Math.random() * 3)], tint = Math.random();
    return { x: Math.random() * SW, y: Math.random() * SH, z, r: Math.random() * 1.2 + 0.25 + z, ph: Math.random() * 6.3, sp: 0.4 + Math.random() * 1.8,
      c: tint < 0.08 ? '255,190,230' : tint < 0.16 ? '185,205,255' : tint < 0.2 ? '255,236,180' : '255,255,255' };
  });
}
function drawStars(t) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, SW, SH);
  for (const s of stars) {
    const px = (((s.x + view.x * s.z * 0.35) % SW) + SW) % SW, py = (((s.y + view.y * s.z * 0.35) % SH) + SH) % SH;
    const a = reduceMotion ? 0.8 : 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 0.001 * s.sp + s.ph));
    ctx.fillStyle = `rgba(${s.c},${a * (0.45 + s.z)})`;
    ctx.beginPath(); ctx.arc(px, py, s.r * 0.75, 0, 6.283); ctx.fill();
    if (s.r > 1.5 && a > 0.85) { ctx.fillStyle = `rgba(${s.c},${(a - 0.85) * 1.2})`; ctx.fillRect(px - s.r * 2.2, py - 0.4, s.r * 4.4, 0.8); ctx.fillRect(px - 0.4, py - s.r * 2.2, 0.8, s.r * 4.4); }
  }
  if (!reduceMotion) {
    if (t > nextShoot) {
      nextShoot = t + 3500 + Math.random() * 6000;
      const ang = Math.PI * (0.15 + Math.random() * 0.2) * (Math.random() < 0.5 ? 1 : -1) + (Math.random() < 0.5 ? 0 : Math.PI);
      shooting.push({ x: Math.random() * SW, y: Math.random() * SH * 0.6, vx: Math.cos(ang) * 9, vy: Math.abs(Math.sin(ang)) * 9, life: 1 });
    }
    shooting = shooting.filter(s => s.life > 0);
    for (const s of shooting) {
      const g = ctx.createLinearGradient(s.x, s.y, s.x - s.vx * 12, s.y - s.vy * 12);
      g.addColorStop(0, `rgba(255,240,250,${s.life})`); g.addColorStop(1, 'rgba(255,200,240,0)');
      ctx.strokeStyle = g; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.vx * 12, s.y - s.vy * 12); ctx.stroke();
      s.x += s.vx; s.y += s.vy; s.life -= 0.018;
    }
    requestAnimationFrame(drawStars);
  }
}
initStars(); requestAnimationFrame(drawStars);
let rsT = null;
addEventListener('resize', () => {
  initStars(); if (reduceMotion) requestAnimationFrame(drawStars);
  clearTimeout(rsT); rsT = setTimeout(() => { if (root) update(); }, 200);
});

/* ================= gate / boot ================= */
const gate = $('#gate'), gp = $('#gatePass'), gerr = $('#gateErr');
$('#gateHint').textContent = CFG.hint || '';
async function unlock(pass, remember, silent) {
  $('#gateBtn').disabled = true;
  try {
    const fileData = await decryptData(pass);
    PASS = pass;
    if (remember) store.set('nw-pass', pass);
    const draft = loadDraft(fileData.version);
    root = fromData(draft || fileData);
    start(!!draft);
  } catch (e) {
    if (silent) { store.del('nw-pass'); }
    else {
      gerr.textContent = e.message === 'nodata' ? 'فایل data.enc.js پیدا نشد 😕' : 'رمز اشتباهه 🙈 دوباره امتحان کن';
      const card = $('.gate-card'); card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
      gp.select();
    }
  } finally { $('#gateBtn').disabled = false; }
}
$('#gateForm').addEventListener('submit', e => { e.preventDefault(); if (gp.value) unlock(gp.value, $('#gateRemember').checked); });

function start(fromDraft) {
  gate.classList.add('gone');
  $('#topbar').hidden = false;
  setupEditBar();
  view.x = innerWidth / 2; view.y = innerHeight / 2 + 20; view.s = isMobile() ? 0.5 : 0.85; applyView();
  update({ after: () => fitView(null, isMobile() ? 0.44 : 0.22) });
  if (EDIT && fromDraft) toast('<div class="ts">نسخه‌ی ویرایش‌شده‌ی روی این مرورگر بارگذاری شد ✏️</div>', 4000);
  if (!EDIT && !store.get('nw-welcomed')) {
    setTimeout(() => { select('root'); openPanel('root'); store.set('nw-welcomed', '1'); if (!isMobile()) setTimeout(() => fitView(), 450); }, 1300);
  } else showHint();
  setTimeout(() => gate.remove(), 1000);
}

const saved = store.get('nw-pass');
if (saved) unlock(saved, true, true); else setTimeout(() => gp.focus(), 300);
})();
