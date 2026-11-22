
/* ==================================================================
   APP: upload → edit (2D) → 3D view
================================================================== */
const $ = id => document.getElementById(id);
const toastEl = $('toast'); let toastT;
function toast(msg, ms = 2800) { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), ms); }
const busy = (on, msg) => { $('busy').classList.toggle('on', on); if (msg) $('busyTxt').textContent = msg; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let mode = 'upload', planImg = null, planURL = null, built3dFor = null, everBuilt = false;
const ui = { units: 'm', imgAlpha: 0.55, snap: true, furnType: 'bed' };
const det = { thr: null, thick: 1, outline: false };

/* ---------------------------------------------------------------- units */
const FT = 0.3048;
const fmtLen = m => { if (ui.units === 'ft') { const inch = Math.round(m / 0.0254); return `${Math.floor(inch / 12)}′ ${inch % 12}″`; } return `${m.toFixed(2)} m`; };
const fmtArea = m2 => ui.units === 'ft' ? `${Math.round(m2 / (FT * FT))} sq ft` : `${m2.toFixed(1)} m²`;
const toUnit = m => ui.units === 'ft' ? m / FT : m, fromUnit = v => ui.units === 'ft' ? v * FT : v;
const smallUnit = () => ui.units === 'ft' ? 'in' : 'cm';
const toSmall = m => ui.units === 'ft' ? m / 0.0254 : m * 100, fromSmall = v => ui.units === 'ft' ? v * 0.0254 : v / 100;

/* ---------------------------------------------------------------- geometry helpers */
const R4 = o => (o && o.rect) || o;
const norm = r => { if (r[0] > r[2]) [r[0], r[2]] = [r[2], r[0]]; if (r[1] > r[3]) [r[1], r[3]] = [r[3], r[1]]; return r; };
const rnd1 = v => Math.round(v * 10) / 10;
const rr = r => r.map(rnd1);
const inter = (a, b) => a[0] < b[2] - 1e-6 && b[0] < a[2] - 1e-6 && a[1] < b[3] - 1e-6 && b[1] < a[3] - 1e-6;
const rArea = r => (r[2] - r[0]) * (r[3] - r[1]);
const inR = (r, x, y, pad = 0) => x >= r[0] - pad && x <= r[2] + pad && y >= r[1] - pad && y <= r[3] + pad;
function subtractRect(a, b) {
  if (!inter(a, b)) return [a];
  const out = [];
  if (b[1] > a[1]) out.push([a[0], a[1], a[2], b[1]]);
  if (b[3] < a[3]) out.push([a[0], b[3], a[2], a[3]]);
  const y0 = Math.max(a[1], b[1]), y1 = Math.min(a[3], b[3]);
  if (b[0] > a[0]) out.push([a[0], y0, b[0], y1]);
  if (b[2] < a[2]) out.push([b[2], y0, a[2], y1]);
  return out.filter(r => r[2] - r[0] > 0.6 && r[3] - r[1] > 0.6);
}
function mergeWalls() {
  const W = layout.walls, e = 0.8;
  for (let again = true; again;) { again = false;
    for (let i = 0; i < W.length && !again; i++) for (let j = i + 1; j < W.length && !again; j++) {
      const a = W[i], b = W[j];
      if (Math.abs(a[1] - b[1]) < e && Math.abs(a[3] - b[3]) < e && a[0] <= b[2] + e && b[0] <= a[2] + e) { W[i] = [Math.min(a[0], b[0]), a[1], Math.max(a[2], b[2]), a[3]]; W.splice(j, 1); again = true; }
      else if (Math.abs(a[0] - b[0]) < e && Math.abs(a[2] - b[2]) < e && a[1] <= b[3] + e && b[1] <= a[3] + e) { W[i] = [a[0], Math.min(a[1], b[1]), a[2], Math.max(a[3], b[3])]; W.splice(j, 1); again = true; }
    } }
}
const cutWalls = r => { layout.walls = layout.walls.flatMap(w => subtractRect(w, r)); };
const fillWall = r => { layout.walls.push(rr(r.slice())); };
const wallT = () => layout.wallT || 0.2 / (layout.scale || 0.0125);
const U = m => m / (layout.scale || 0.0125);      // metres → plan units
const Mm = u => u * (layout.scale || 0.0125);     // plan units → metres

/* ---------------------------------------------------------------- room helpers */
const ROOM_COLORS = ['#e07a5f', '#3d8bbd', '#81b29a', '#f2cc8f', '#9b72cf', '#e5989b', '#4fb0ae', '#c8a165', '#7a9e3d', '#d0743c', '#5c7cfa', '#b5838d'];
const roomColor = i => ROOM_COLORS[i % ROOM_COLORS.length];
function largestRect(rm) { return rm.rects.reduce((a, b) => rArea(b) > rArea(a) ? b : a, rm.rects[0]); }
function roomAreaM2(rm) {
  // sample the room's rectangles on a 10 cm grid, skipping wall cells and cells counted by an earlier rect
  const st = Math.max(1, U(0.1)); let n = 0;
  const walls = layout.walls;
  rm.rects.forEach((q, qi) => {
    for (let y = q[1] + st / 2; y < q[3]; y += st) for (let x = q[0] + st / 2; x < q[2]; x += st) {
      let skip = false; for (let k = 0; k < qi && !skip; k++) if (inR(rm.rects[k], x, y)) skip = true;
      for (let k = 0; k < walls.length && !skip; k++) { const w = walls[k]; if (x > w[0] && x < w[2] && y > w[1] && y < w[3]) skip = true; }
      if (!skip) n++;
    }
  });
  return n * Mm(st) ** 2;
}
const FLOOR_BY_NAME = [[/bath|wc|toilet|ensuite|en-suite|shower|powder|lav/i, 'bathtile'], [/kitchen|laundry|utility|entry|foyer|mud|pantry/i, 'tile'],
  [/stair|garage|balcony|terrace|patio|porch|deck|store|storage|boiler/i, 'concrete'], [/office|study|den|library/i, 'walnut']];
function refreshRoom(rm) {
  if (!rm.rects.length) return;
  const q = largestRect(rm); rm.label = [rnd1((q[0] + q[2]) / 2), rnd1((q[1] + q[3]) / 2)];
  if (rm.areaAuto !== false) rm.area = fmtArea(roomAreaM2(rm));
}
const refreshRooms = () => (layout.rooms || []).forEach(refreshRoom);

/* ---------------------------------------------------------------- stairs */
function genSteps(st) {
  const [x0, y0, x1, y1] = st.box, n = Math.max(2, Math.min(40, st.n | 0)), w = x1 - x0, h = y1 - y0, out = [];
  for (let i = 0; i < n; i++) { const a = i / n, b = (i + 1) / n;
    if (st.dir === 'N') out.push([x0, y1 - h * b, x1, y1 - h * a]);
    else if (st.dir === 'S') out.push([x0, y0 + h * a, x1, y0 + h * b]);
    else if (st.dir === 'E') out.push([x0 + w * a, y0, x0 + w * b, y1]);
    else out.push([x1 - w * b, y0, x1 - w * a, y1]); }
  st.steps = out.map(rr);
}

/* ---------------------------------------------------------------- furniture catalogue (metres) */
const FURN = {
  bed: ['Bed', 1.5, 2.0], nightstand: ['Nightstand', 0.45, 0.4], wardrobe: ['Wardrobe', 1.2, 0.6], desk: ['Desk', 1.2, 0.6],
  table: ['Dining table', 1.6, 0.9], roundTable: ['Round table', 1.1, 1.1], chair: ['Chair', 0.45, 0.45], sofa: ['Sofa', 2.1, 0.9],
  coffeeTable: ['Coffee table', 1.1, 0.6], rug: ['Rug', 2.4, 1.7], bookshelf: ['Bookshelf', 1.0, 0.35], tvUnit: ['TV unit', 1.6, 0.42],
  plant: ['Plant', 0.45, 0.45], floorLamp: ['Floor lamp', 0.35, 0.35], counter: ['Kitchen counter', 2.4, 0.62], fridge: ['Fridge', 0.7, 0.68],
  washer: ['Washer', 0.6, 0.6], shelf: ['Wall shelf', 1.2, 0.3], basket: ['Basket', 0.4, 0.4], bathtub: ['Bathtub', 1.7, 0.75],
  basin: ['Basin', 0.6, 0.48], toilet: ['Toilet', 0.4, 0.68], shower: ['Shower', 0.9, 0.9], painting: ['Painting', 0.9, 0.04]
};
function newFurniture(type, x, y, rot = 0, extra = {}) {
  const [, w, d] = FURN[type];
  const f = { type, x: rnd1(x), y: rnd1(y), w: rnd1(U(w)), d: rnd1(U(d)), rot, ...extra };
  if (type === 'counter' && f.sink == null) { f.sink = 0.27; f.hob = 0.73; }
  if (type === 'rug' && extra.round) f.d = f.w;
  if (type === 'painting') { f.art = f.art || ART_STYLES[(Math.random() * 5) | 0][0]; f.seed = f.seed || (1 + Math.random() * 99999 | 0); f.ht = f.ht || 0.65; f.elev = f.elev || 1.5; f.frame = f.frame || 'wood'; }
  return f;
}
function footprint(f) { const r = ((f.rot || 0) % 180 + 180) % 180, sw = r === 90 ? f.d : f.w, sd = r === 90 ? f.w : f.d; return [f.x - sw / 2, f.y - sd / 2, f.x + sw / 2, f.y + sd / 2]; }

const ART_STYLES = [['abstract', 'Abstract'], ['landscape', 'Mountain landscape'], ['geometric', 'Geometric'], ['botanical', 'Botanical'], ['colorfield', 'Colour field'], ['photo', 'My own picture']];
/* hang a painting centred above a piece of furniture standing against a wall */
function hangAbove(f, wm, extraTop = 0.25) {
  const pd = U(0.04), [x, y] = frontOf(f, -f.d / 2 + pd / 2), w = Math.min(1.3, Mm(f.w) * 0.6), ht = +(w * (0.55 + Math.random() * 0.25)).toFixed(2);
  const p = newFurniture('painting', x, y, f.rot, { ht }); p.w = rnd1(U(w)); p.d = rnd1(pd); p.elev = +((wm || 1.1) + extraTop + ht / 2).toFixed(2); return p;
}

/* ---------------------------------------------------------------- undo / autosave */
const undoStack = [], redoStack = [];
const snapshot = () => JSON.stringify(layout);
function commit(prev) {
  if (prev != null && prev !== snapshot()) { undoStack.push(prev); if (undoStack.length > 120) undoStack.shift(); redoStack.length = 0; }
  changed();
}
function changed() { built3dFor = null; scheduleSave(); renderEditPanel(); edDraw(); }
function undo() { if (!undoStack.length) return toast('Nothing to undo'); redoStack.push(snapshot()); layout = JSON.parse(undoStack.pop()); ed.sel = null; changed(); }
function redo() { if (!redoStack.length) return toast('Nothing to redo'); undoStack.push(snapshot()); layout = JSON.parse(redoStack.pop()); ed.sel = null; changed(); }
let saveT = null;
const LS_KEY = 'plan-to-3d:v1';
function scheduleSave() { clearTimeout(saveT); saveT = setTimeout(saveLocal, 600); }
let savedImgFor = null, savedImg = null;
function saveLocal() {
  if (!layout || !planImg) return;
  try {
    if (savedImgFor !== planURL) { savedImg = compactImage(); savedImgFor = planURL; }
    localStorage.setItem(LS_KEY, JSON.stringify({ layout, image: savedImg, ui: { units: ui.units }, det }));
  } catch (e) { try { localStorage.setItem(LS_KEY, JSON.stringify({ layout, image: null, ui: { units: ui.units }, det })); } catch (e2) { /* storage unavailable */ } }
}
function compactImage() {
  const c = document.createElement('canvas'); c.width = planImg.width; c.height = planImg.height;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(planImg, 0, 0);
  return c.toDataURL('image/jpeg', 0.85);
}
function readLocal() { try { const s = localStorage.getItem(LS_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }

/* ==================================================================
   LOADING A PLAN
================================================================== */
function loadImageURL(url) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Could not read that image.')); im.src = url; });
}
async function normaliseImage(im) {
  // keep plans to at most 2400 px on the long side (layout units = pixels of this image)
  const max = 2400, r = Math.min(1, max / Math.max(im.width, im.height));
  if (r === 1 && im.src.startsWith('data:')) return { img: im, url: im.src };
  const c = document.createElement('canvas'); c.width = Math.round(im.width * r); c.height = Math.round(im.height * r);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/png'); return { img: await loadImageURL(url), url };
}
async function pdfToURL(file) {
  let pdfjs = null;
  for (const base of ['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/', 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/']) {
    try { pdfjs = await import(base + 'pdf.min.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs'; break; } catch (e) { pdfjs = null; }
  }
  if (!pdfjs) throw new Error('Could not load the PDF reader. Check your connection, or export the plan as an image.');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  let pageNo = 1;
  if (doc.numPages > 1) {
    // pick the page with the most ink in its thumbnail (floor plans are dense line drawings)
    let best = -1;
    for (let p = 1; p <= Math.min(doc.numPages, 8); p++) {
      const pg = await doc.getPage(p), vp = pg.getViewport({ scale: 200 / Math.max(pg.view[2], pg.view[3]) });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; const g = c.getContext('2d', { willReadFrequently: true });
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); await pg.render({ canvasContext: g, viewport: vp }).promise;
      const d = g.getImageData(0, 0, c.width, c.height).data; let ink = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 110) ink++;
      if (ink > best) { best = ink; pageNo = p; }
    }
  }
  const page = await doc.getPage(pageNo), vp0 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: Math.min(6, 2200 / Math.max(vp0.width, vp0.height)) });
  const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: g, viewport: vp }).promise;
  return { url: c.toDataURL('image/png'), note: doc.numPages > 1 ? `Used page ${pageNo} of ${doc.numPages}.` : '' };
}
async function openFile(file) {
  const st = $('upStatus'); st.classList.remove('err');
  try {
    if (/\.json$/i.test(file.name) || file.type === 'application/json') return openProject(JSON.parse(await file.text()));
    busy(true, file.type === 'application/pdf' || /\.pdf$/i.test(file.name) ? 'Reading the PDF…' : 'Reading the image…');
    let url, note = '';
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) ({ url, note } = await pdfToURL(file));
    else url = await new Promise((res, rej) => { const rd = new FileReader(); rd.onload = () => res(rd.result); rd.onerror = () => rej(new Error('Could not read that file.')); rd.readAsDataURL(file); });
    await startFromImage(url, file.name.replace(/\.[^.]+$/, ''), note);
  } catch (err) { busy(false); st.textContent = err.message; st.classList.add('err'); toast(err.message); }
}
async function startFromImage(url, name, note = '') {
  busy(true, 'Finding walls, doors and rooms…');
  const n = await normaliseImage(await loadImageURL(url));
  planImg = n.img; planURL = n.url; overlayTex = null;
  layout = { name: name || 'My floor plan', scale: 0.0125, wallHeight: 2.6, image: { w: planImg.width, h: planImg.height }, walls: [], windows: [], doors: [], rooms: [], stairs: [], furniture: [], lights: [] };
  undoStack.length = redoStack.length = 0;
  det.thr = null; det.thick = 1; det.outline = false;
  await new Promise(r => setTimeout(r, 30));
  runDetection({ keepScale: false, quiet: true });
  if (note) toast(note);
  busy(false);
  setMode('edit'); edFit();
  if (layout.rooms.length) readRoomNames({ auto: true });
}
function runDetection({ keepScale = true, quiet = false } = {}) {
  const prev = snapshot();
  try {
    const R = detectPlan(planImg, { thr: det.thr, thick: det.thick, outline: det.outline, scale: keepScale && !layout.scaleGuessed ? layout.scale : null });
    det.thr = R.thr; $('thr').value = R.thr;
    const oldScale = layout.scale;
    Object.assign(layout, { walls: R.walls, windows: R.windows, doors: R.doors, rooms: R.rooms, wallT: rnd1(R.wallT) });
    if (!keepScale || layout.scaleGuessed) { layout.scale = +R.scale.toFixed(6); layout.scaleGuessed = R.scaleGuessed; rescaleFurniture(oldScale, layout.scale); }
    refreshRooms(); if (ocrWords && ocrFor === planURL) applyText(ocrWords); autoLights(true);
    $('detStatus').classList.remove('err');
    $('detStatus').textContent = `Found ${R.walls.length} wall pieces, ${R.doors.length} doors, ${R.windows.length} windows and ${R.rooms.length} rooms.`;
    ed.sel = null; commit(quiet ? null : prev);
    if (!quiet) toast('Plan re-detected. Undo brings back your edits.');
  } catch (err) {
    $('detStatus').textContent = err.message; $('detStatus').classList.add('err');
    if (quiet) toast(err.message, 5000);
    changed();
  }
}
function rescaleFurniture(oldS, newS) {
  if (!oldS || !newS || oldS === newS) return; const k = oldS / newS;
  (layout.furniture || []).forEach(f => { f.w = rnd1(f.w * k); f.d = rnd1(f.d * k); });
  if (layout.wallT && layout.wallUser) layout.wallT = rnd1(layout.wallT * k);
}
function setScale(newS, why) {
  const prev = snapshot(), old = layout.scale;
  layout.scale = +newS.toFixed(6); layout.scaleGuessed = false; rescaleFurniture(old, layout.scale);
  (layout.stairs || []).forEach(st => { st.rise = st.rise || 0.18; });
  refreshRooms(); commit(prev); toast(why || 'Scale updated');
}
async function openProject(P) {
  const L = P.layout || P;
  validate(L);
  if (typeof P.image === 'string') { planURL = P.image; planImg = await loadImageURL(P.image); }
  else if (!planImg) {
    // no picture: draw a blank sheet the size of the layout
    const b = computeBounds(L), c = document.createElement('canvas'); c.width = Math.max(200, Math.ceil(b.x1 + 40)); c.height = Math.max(200, Math.ceil(b.y1 + 40));
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); planURL = c.toDataURL(); planImg = await loadImageURL(planURL);
  }
  overlayTex = null;
  layout = L; layout.image = layout.image || { w: planImg.width, h: planImg.height };
  layout.walls = layout.walls || []; ['windows', 'doors', 'rooms', 'stairs', 'furniture', 'lights'].forEach(k => layout[k] = layout[k] || []);
  layout.rooms.forEach(rm => { if (rm.areaAuto == null) rm.areaAuto = !rm.area; });
  layout.stairs.forEach(st => { if (!st.box && st.steps && st.steps.length) st.box = st.steps.reduce((a, q) => [Math.min(a[0], q[0]), Math.min(a[1], q[1]), Math.max(a[2], q[2]), Math.max(a[3], q[3])], [1e9, 1e9, -1e9, -1e9]); });
  if (P.ui && P.ui.units) setUnits(P.ui.units, true);
  if (P.det) Object.assign(det, P.det);
  undoStack.length = redoStack.length = 0; ed.sel = null;
  setMode('edit'); edFit(); changed();
}

/* ==================================================================
   AUTO-FURNISH + AUTO-LIGHTS
================================================================== */
function obstaclesFor(skip) {
  const T = wallT(), obs = [];
  (layout.doors || []).forEach(d => { const r = R4(d), horiz = r[2] - r[0] >= r[3] - r[1], L = (horiz ? r[2] - r[0] : r[3] - r[1]) / (d.hinge === 'both' ? 2 : 1) + U(0.1);
    const a = (d.swing || 1) < 0 ? L : U(0.5), b = (d.swing || 1) > 0 ? L : U(0.5);   // swing side gets the leaf, the other side a walkway
    obs.push(horiz ? [r[0] - U(0.05), r[1] - a, r[2] + U(0.05), r[3] + b] : [r[0] - a, r[1] - U(0.05), r[2] + b, r[3] + U(0.05)]); });
  (layout.stairs || []).forEach(s => obs.push(s.box || s.steps.reduce((a, q) => [Math.min(a[0], q[0]), Math.min(a[1], q[1]), Math.max(a[2], q[2]), Math.max(a[3], q[3])], [1e9, 1e9, -1e9, -1e9])));
  (layout.walls || []).forEach(w => obs.push(w));
  (layout.furniture || []).forEach(f => { if (f !== skip && f.type !== 'rug') obs.push(footprint(f)); });
  return obs;
}
function innerRect(rm) { const q = largestRect(rm), p = wallT() / 2 + U(0.03); return [q[0] + p, q[1] + p, q[2] - p, q[3] - p]; }
function fits(fp, inner, obs) { if (fp[0] < inner[0] - 0.5 || fp[1] < inner[1] - 0.5 || fp[2] > inner[2] + 0.5 || fp[3] > inner[3] + 0.5) return false; return !obs.some(o => inter(o, fp)); }
function windowBlocks(fp) { return (layout.windows || []).some(w => { const r = R4(w), p = U(0.15); return inter([r[0] - p, r[1] - p, r[2] + p, r[3] + p], fp); }); }
/* place against a wall; sides tried longest first unless `prefer` lists them */
function placeWall(type, inner, obs, opts = {}) {
  const [, wm, dm] = FURN[type], w = opts.w ? U(opts.w) : U(wm), d = opts.d ? U(dm * 0 + opts.d) : U(dm);
  const byLen = ['N', 'S', 'W', 'E'].sort((a, b) => sideLen(b, inner) - sideLen(a, inner));
  const sides = opts.prefer ? [...opts.prefer, ...byLen.filter(x => !opts.prefer.includes(x) && x !== opts.avoid)] : byLen;
  for (const sd of sides) {
    const horiz = sd === 'N' || sd === 'S', lo = horiz ? inner[0] + w / 2 : inner[1] + w / 2, hi = horiz ? inner[2] - w / 2 : inner[3] - w / 2;
    if (hi < lo) continue;
    const mid = opts.at === 'corner' ? lo : (lo + hi) / 2, stp = U(0.12), cands = [];
    for (let k = 0; k <= (hi - lo) / stp + 1; k++) { const o = Math.ceil(k / 2) * stp * (k % 2 ? 1 : -1); const c = opts.at === 'corner' ? lo + k * stp : mid + o; if (c >= lo - 0.1 && c <= hi + 0.1) cands.push(c); }
    if (opts.at === 'corner') cands.push(hi);
    for (const c of cands) {
      let x, y, rot, fp;
      if (sd === 'N') { x = c; y = inner[1] + d / 2; rot = 0; fp = [x - w / 2, inner[1], x + w / 2, inner[1] + d]; }
      else if (sd === 'S') { x = c; y = inner[3] - d / 2; rot = 180; fp = [x - w / 2, inner[3] - d, x + w / 2, inner[3]]; }
      else if (sd === 'W') { y = c; x = inner[0] + d / 2; rot = 90; fp = [inner[0], y - w / 2, inner[0] + d, y + w / 2]; }
      else { y = c; x = inner[2] - d / 2; rot = -90; fp = [inner[2] - d, y - w / 2, inner[2], y + w / 2]; }
      if (!fits(fp, inner, obs) || (opts.tall && windowBlocks(fp))) continue;
      if (type === 'painting' && !wallBehind(sd, fp)) continue;
      const f = newFurniture(type, x, y, rot, opts.extra || {}); f.w = rnd1(w); f.d = rnd1(d); f.side = sd;
      obs.push(fp); return f;
    }
  }
  return null;
}
/* a painting needs solid wall behind its whole width */
function wallBehind(sd, fp) {
  const t = U(0.12), pts = [];
  for (const k of [0.05, 0.5, 0.95]) {
    if (sd === 'N') pts.push([fp[0] + (fp[2] - fp[0]) * k, fp[1] - t]); else if (sd === 'S') pts.push([fp[0] + (fp[2] - fp[0]) * k, fp[3] + t]);
    else if (sd === 'W') pts.push([fp[0] - t, fp[1] + (fp[3] - fp[1]) * k]); else pts.push([fp[2] + t, fp[1] + (fp[3] - fp[1]) * k]);
  }
  return pts.every(([x, y]) => layout.walls.some(w => inR(w, x, y)));
}
const sideLen = (sd, r) => sd === 'N' || sd === 'S' ? r[2] - r[0] : r[3] - r[1];
const OPP = { N: 'S', S: 'N', W: 'E', E: 'W' };
function placeAt(type, x, y, rot, inner, obs, extra = {}) {
  const f = newFurniture(type, x, y, rot, extra), fp = footprint(f);
  if (!fits(fp, inner, obs)) return null; obs.push(fp); return f;
}
function placeFree(type, x, y, rot, extra = {}) { return newFurniture(type, x, y, rot, extra); }   // no collision test (rugs)
function frontOf(f, dist) { const a = (f.rot || 0) * Math.PI / 180; return [f.x + Math.sin(a) * dist, f.y + Math.cos(a) * dist]; }
function along(f, dist) { const a = (f.rot || 0) * Math.PI / 180; return [f.x + Math.cos(a) * dist, f.y - Math.sin(a) * dist]; }
function furnishRoom(rm) {
  { const m = FLOOR_BY_NAME.find(([re]) => re.test(rm.name || '')); if (m && (rm.floor === 'oak' || !rm.floor)) rm.floor = m[1]; }
  const name = rm.name || '', inner = innerRect(rm), obs = obstaclesFor(), out = [];
  const area = rArea(inner) * layout.scale ** 2, add = f => { if (f) { out.push(f); layout.furniture.push(f); } return f; };
  if (inner[2] - inner[0] < U(0.8) || inner[3] - inner[1] < U(0.8)) return 0;
  const tableSet = (cx, cy, big) => {
    const sz = big ? {} : { w: rnd1(U(1.2)), d: rnd1(U(0.8)) };
    const t = placeAt('table', cx, cy, 0, inner, obs, sz) || placeAt('table', cx, cy, 90, inner, obs, sz); if (!t) return;
    add(t); const vert = t.rot === 90, n = Mm(t.w) > 1.35 ? 2 : 1;
    for (let i = 0; i < n; i++) for (const sd of [-1, 1]) {
      const o = n === 2 ? (i ? 1 : -1) * t.w / 4 : 0, gap = t.d / 2 + U(0.25);
      const x = vert ? t.x + sd * gap : t.x + o, y = vert ? t.y + o : t.y + sd * gap;
      const rot = vert ? (sd < 0 ? 90 : -90) : (sd < 0 ? 0 : 180);
      add(placeAt('chair', x, y, rot, inner, obs));
    }
  };
  if (/bed|master|guest|nursery|kids/i.test(name)) {
    const bed = add(placeWall('bed', inner, obs, { w: area < 9 ? 1.2 : 1.5 }));
    if (bed) for (const s of [-1, 1]) { const [x, y] = along(bed, s * (bed.w / 2 + U(0.28))); add(placeAt('nightstand', x, y, bed.rot, inner, obs)); }
    add(placeWall('wardrobe', inner, obs, { tall: true, prefer: bed ? [OPP[bed.side], ...['N', 'S', 'W', 'E'].filter(s => s !== OPP[bed.side])] : undefined }));
    if (area > 13) add(placeWall('desk', inner, obs));
    if (bed) { layout.furniture.push(hangAbove(bed, 1.05, 0.2)); }
    if (area > 11 && bed) { const [x, y] = frontOf(bed, bed.d * 0.1); const rg = placeFree('rug', x, y, bed.rot); rg.w = rnd1(bed.w + U(0.9)); rg.d = rnd1(bed.d * 0.75); layout.furniture.unshift(rg); out.push(rg); }
  } else if (/kitchen/i.test(name)) {
    const c = add(placeWall('counter', inner, obs, { w: Math.min(3.0, Math.max(1.5, Mm(Math.max(inner[2] - inner[0], inner[3] - inner[1])) - 1.2)) }));
    add(placeWall('fridge', inner, obs, { tall: true, at: 'corner' }));
    add(placeWall('painting', inner, obs, { tall: true, w: 0.7 }));
    if (/dining|diner|eat/i.test(name) || area > 12) { const cx = (inner[0] + inner[2]) / 2, cy = (inner[1] + inner[3]) / 2; tableSet(c ? (c.side === 'N' || c.side === 'S' ? cx : cx + (c.side === 'W' ? 1 : -1) * U(0.4)) : cx, c ? (c.side === 'N' ? cy + U(0.4) : c.side === 'S' ? cy - U(0.4) : cy) : cy, area > 16); }
  } else if (/dining/i.test(name)) {
    tableSet((inner[0] + inner[2]) / 2, (inner[1] + inner[3]) / 2, area > 10); add(placeWall('plant', inner, obs, { at: 'corner' }));
    add(placeWall('painting', inner, obs, { tall: true, w: 1.0 }));
  } else if (/living|lounge|family|sitting|great|reception/i.test(name)) {
    const sofa = add(placeWall('sofa', inner, obs, { w: area < 12 ? 1.8 : 2.1 }));
    let tv = null;
    if (sofa) tv = add(placeWall('tvUnit', inner, obs, { prefer: [OPP[sofa.side]], avoid: sofa.side }));
    if (sofa) { const [x, y] = frontOf(sofa, sofa.d / 2 + U(0.62)); const rg = placeFree('rug', x, y, sofa.rot); rg.w = rnd1(Math.min(U(2.6), sofa.w + U(0.4))); rg.d = rnd1(U(1.7)); layout.furniture.unshift(rg); out.push(rg); add(placeAt('coffeeTable', x, y, sofa.rot, inner, obs));
      const [lx, ly] = along(sofa, sofa.w / 2 + U(0.3)); add(placeAt('floorLamp', lx, ly, 0, inner, obs)); layout.furniture.push(hangAbove(sofa, 0.78, 0.3)); }
    add(placeWall('bookshelf', inner, obs, { tall: true }));
    add(placeWall('plant', inner, obs, { at: 'corner' }));
    if (area > 24) add(placeWall('plant', inner, obs, { at: 'corner', prefer: ['S', 'N', 'E', 'W'] }));
  } else if (/bath|wc|toilet|ensuite|en-suite|shower|powder|lav/i.test(name)) {
    if (area > 4.5 && !/shower|wc|powder/i.test(name)) add(placeWall('bathtub', inner, obs, { at: 'corner' })); else add(placeWall('shower', inner, obs, { at: 'corner' }));
    add(placeWall('toilet', inner, obs, { at: 'corner' }));
    add(placeWall('basin', inner, obs));
  } else if (/laundry|utility/i.test(name)) {
    const w1 = add(placeWall('washer', inner, obs, { at: 'corner' }));
    if (w1) { const [x, y] = along(w1, U(0.64) * (w1.rot === 90 || w1.rot === 180 ? -1 : 1)); add(placeAt('washer', x, y, w1.rot, inner, obs, { dryer: true })) || (() => { const [x2, y2] = along(w1, -U(0.64) * (w1.rot === 90 || w1.rot === 180 ? -1 : 1)); add(placeAt('washer', x2, y2, w1.rot, inner, obs, { dryer: true })); })(); }
    add(placeWall('basket', inner, obs, { at: 'corner' }));
  } else if (/office|study|den|library|work/i.test(name)) {
    const dk = add(placeWall('desk', inner, obs));
    if (dk) { const [x, y] = frontOf(dk, dk.d / 2 + U(0.3)); add(placeAt('chair', x, y, ((dk.rot + 180 + 540) % 360) - 180, inner, obs)); }
    add(placeWall('bookshelf', inner, obs, { tall: true }));
  } else if (/hall|corridor|entry|foyer|landing/i.test(name)) {
    add(placeWall('plant', inner, obs, { at: 'corner' })); add(placeWall('painting', inner, obs, { tall: true, w: 0.6 }));
  } else if (/stair|closet|cupboard|storage|store|wic|walk-in|garage|balcony|terrace|patio|porch|deck|void|shaft|lift/i.test(name)) return 0;
  else return -1;
  return out.length;
}
function autoFurnish(onlyRoom) {
  const prev = snapshot();
  const rooms = onlyRoom ? [onlyRoom] : layout.rooms;
  if (!onlyRoom) layout.furniture = [];
  else { const inner = largestRect(onlyRoom); layout.furniture = layout.furniture.filter(f => !inR(inner, f.x, f.y)); }
  let n = 0, skipped = [];
  rooms.forEach(rm => { const k = furnishRoom(rm); if (k < 0) skipped.push(rm.name); else n += k; });
  commit(prev);
  toast(n ? `Placed ${n} pieces of furniture.${skipped.length ? ` Rename ${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? '…' : ''} (e.g. Bedroom, Kitchen) to furnish ${skipped.length > 1 ? 'them' : 'it'}.` : ''}` : 'No furniture placed. Name rooms like Bedroom, Kitchen, Living Room or Bath first.', 4200);
}
function autoLights(silent) {
  const prev = snapshot();
  layout.lights = [];
  (layout.rooms || []).forEach(rm => {
    const q = innerRect(rm), w = Mm(q[2] - q[0]), h = Mm(q[3] - q[1]);
    if (w < 0.6 || h < 0.6) return;
    const nx = Math.max(1, Math.round(w / 3.2)), ny = Math.max(1, Math.round(h / 3.2));
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) layout.lights.push({ at: [rnd1(q[0] + (q[2] - q[0]) * (i + 0.5) / nx), rnd1(q[1] + (q[3] - q[1]) * (j + 0.5) / ny)] });
  });
  if (!silent) { commit(prev); toast(`Placed ${layout.lights.length} ceiling lights.`); }
}

/* ==================================================================
   2D EDITOR
================================================================== */
const ed = { cv: $('ed'), s: 1, ox: 0, oy: 0, sel: null, drag: null, hover: null, tool: 'select', append: -1, space: false, ptrs: new Map(), measure: null, cycle: null, guides: null };
const eg = ed.cv.getContext('2d');
const toS = (x, y) => [ed.ox + x * ed.s, ed.oy + y * ed.s];
const toP = (sx, sy) => [(sx - ed.ox) / ed.s, (sy - ed.oy) / ed.s];
const TOOLS = [
  ['select', 'Select', 'V', 'M5 3l13 8-6 1.5L9 19z'],
  ['wall', 'Wall', 'W', 'M3 8h18v8H3z M3 12h18'],
  ['door', 'Door', 'D', 'M5 20V4h3 M8 4a12 12 0 0 1 12 12 M5 20h15'],
  ['window', 'Window', 'N', 'M3 9h18v6H3z M3 11h18 M3 13h18'],
  ['room', 'Room', 'R', 'M4 4h16v16H4z M4 12h7 M11 4v16'],
  ['stairs', 'Stairs', 'S', 'M4 20h4v-4h4v-4h4V8h4V4'],
  ['furniture', 'Furniture', 'F', 'M5 11V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4 M3 11h18v5H3z M5 16v3 M19 16v3'],
  ['light', 'Light', 'L', 'M9 18h6 M10 21h4 M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z'],
  ['measure', 'Measure', 'M', 'M3 17L17 3l4 4L7 21z M7 13l2 2 M10 10l2 2 M13 7l2 2'],
  ['erase', 'Erase', 'X', 'M7 21h10 M5 15l9-9 5 5-6 6H9z M10 10l5 5']
];
const TOOL_HELP = {
  select: 'Click to select; drag to move; drag a corner to resize. Click overlapping things again to cycle. Drag empty space to pan.',
  wall: 'Drag along a wall line to draw a straight wall. It snaps to other walls.',
  door: 'Drag along a wall to cut a door into it, or click a wall for a standard 85 cm door.',
  window: 'Drag along a wall to cut a window into it, or click a wall for a 1.2 m window.',
  room: 'Drag a rectangle to add a room. It takes that space from rooms it overlaps, so you can split a room in two.',
  stairs: 'Drag over the staircase. Set the number of steps and which way they climb in the panel.',
  furniture: 'Pick a piece below, then click the plan to place it. It turns to face away from the nearest wall.',
  light: 'Click to add a ceiling light.',
  measure: 'Drag between two points of known size (a wall with a written dimension, a door) to set the scale.',
  erase: 'Click anything to delete it. Deleting a door or window fills the wall back in.'
};
function buildTools() {
  $('tools').innerHTML = TOOLS.map(([id, name, key, d]) => `<button data-tool="${id}" aria-pressed="false" title="${name} (${key})"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>${name}<kbd>${key}</kbd></button>`).join('');
  $('tools').querySelectorAll('button').forEach(b => b.onclick = () => setTool(b.dataset.tool));
  $('palette').innerHTML = Object.entries(FURN).map(([k, v]) => `<button data-f="${k}" aria-pressed="${k === ui.furnType}">${v[0]}</button>`).join('');
  $('palette').querySelectorAll('button').forEach(b => b.onclick = () => { ui.furnType = b.dataset.f; $('palette').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); });
}
function setTool(t) {
  if (t !== 'room') ed.append = -1;
  ed.tool = t; ed.drag = null;
  $('tools').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === t));
  $('palette').hidden = t !== 'furniture';
  $('toolHelp').textContent = TOOL_HELP[t] + (t === 'room' && ed.append >= 0 ? ` Adding to “${layout.rooms[ed.append].name}”.` : '');
  $('toolName').textContent = '';
  setHint(); edCursor(); edDraw();
}
function setHint(msg) {
  if (msg != null) { $('hint').textContent = msg; return; }
  $('hint').textContent = ed.tool === 'select' ? '' : TOOL_HELP[ed.tool];
}

/* ---- view fit / resize ---- */
function edAvail() {
  const w = innerWidth, h = innerHeight, pr = $('panel').getBoundingClientRect();
  if (w > 820) return [pr.right + 12, 12, w - 12, h - 12];
  if (pr.left > w * 0.4) return [12, 12, pr.left - 12, h - 12];
  return [8, 60, w - 8, pr.top - 8];
}
function edFit() {
  if (!planImg) return;
  const [ax, ay, bx, by] = edAvail();
  let x0 = 0, y0 = 0, x1 = planImg.width, y1 = planImg.height;
  const s = Math.min((bx - ax) / (x1 - x0), (by - ay) / (y1 - y0)) * 0.96;
  ed.s = s; ed.ox = (ax + bx) / 2 - (x0 + x1) / 2 * s; ed.oy = (ay + by) / 2 - (y0 + y1) / 2 * s; edDraw();
}
function edResize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  ed.cv.width = Math.round(innerWidth * dpr); ed.cv.height = Math.round(innerHeight * dpr); ed.dpr = dpr; edDraw();
}
function zoomAt(sx, sy, k) {
  const ns = Math.max(0.05, Math.min(40, ed.s * k)); k = ns / ed.s;
  ed.ox = sx - (sx - ed.ox) * k; ed.oy = sy - (sy - ed.oy) * k; ed.s = ns; edDraw();
}

/* ---- hit testing ---- */
function hitFurn(f, x, y, pad) {
  const a = (f.rot || 0) * Math.PI / 180, dx = x - f.x, dy = y - f.y;
  const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
  const py = f.type === 'painting' ? pad + 5 / ed.s : pad;
  return Math.abs(lx) <= f.w / 2 + pad && Math.abs(ly) <= f.d / 2 + py;
}
function hitAll(x, y) {
  const pad = 4 / ed.s, out = [];
  (layout.lights || []).forEach((l, i) => { if (Math.hypot(l.at[0] - x, l.at[1] - y) < 9 / ed.s) out.push({ k: 'light', i }); });
  (layout.furniture || []).map((f, i) => [f, i]).reverse().forEach(([f, i]) => { if (hitFurn(f, x, y, pad)) out.push({ k: 'furniture', i }); });
  (layout.doors || []).forEach((d, i) => { if (inR(R4(d), x, y, pad)) out.push({ k: 'door', i }); });
  (layout.windows || []).forEach((w, i) => { if (inR(R4(w), x, y, pad)) out.push({ k: 'window', i }); });
  (layout.stairs || []).forEach((s, i) => { if (s.box && inR(s.box, x, y, pad)) out.push({ k: 'stair', i }); });
  (layout.walls || []).forEach((w, i) => { if (inR(w, x, y, pad)) out.push({ k: 'wall', i }); });
  (layout.rooms || []).forEach((rm, i) => rm.rects.forEach((q, j) => { if (inR(q, x, y)) out.push({ k: 'room', i, j }); }));
  return out;
}
const sameSel = (a, b) => a && b && a.k === b.k && a.i === b.i && (a.j ?? 0) === (b.j ?? 0);
function selRect(sel) {
  if (!sel) return null;
  if (sel.k === 'wall') return layout.walls[sel.i];
  if (sel.k === 'door') return R4(layout.doors[sel.i]);
  if (sel.k === 'window') return R4(layout.windows[sel.i]);
  if (sel.k === 'room') return layout.rooms[sel.i].rects[sel.j];
  if (sel.k === 'stair') return layout.stairs[sel.i].box;
  return null;
}
function setSelRect(sel, r) {
  r = rr(norm(r));
  if (sel.k === 'wall') layout.walls[sel.i] = r;
  else if (sel.k === 'door') layout.doors[sel.i].rect = r;
  else if (sel.k === 'window') { const w = layout.windows[sel.i]; if (Array.isArray(w)) layout.windows[sel.i] = r; else w.rect = r; }
  else if (sel.k === 'room') layout.rooms[sel.i].rects[sel.j] = r;
  else if (sel.k === 'stair') {
    const st = layout.stairs[sel.i], o = st.box;
    if (st.dir) { st.box = r; genSteps(st); }
    else { // hand-made steps: map them from the old box into the new one
      const kx = (r[2] - r[0]) / Math.max(1e-6, o[2] - o[0]), ky = (r[3] - r[1]) / Math.max(1e-6, o[3] - o[1]);
      st.steps = st.steps.map(q => rr([r[0] + (q[0] - o[0]) * kx, r[1] + (q[1] - o[1]) * ky, r[0] + (q[2] - o[0]) * kx, r[1] + (q[3] - o[1]) * ky])); st.box = r; }
  }
}
function handlesOf(sel) {
  const r = selRect(sel); if (!r) return [];
  return [[r[0], r[1], 0], [r[2], r[1], 1], [r[2], r[3], 2], [r[0], r[3], 3]];
}

/* ---- snapping ---- */
function snapVal(v, axis, skipSel) {
  if (!ui.snap) return { v, g: null };
  const th = 7 / ed.s; let best = null, bd = th;
  const consider = (c) => { const d = Math.abs(c - v); if (d < bd) { bd = d; best = c; } };
  (layout.walls || []).forEach((w, i) => { if (skipSel && skipSel.k === 'wall' && skipSel.i === i) return; consider(w[axis]); consider(w[axis + 2]); });
  return best == null ? { v, g: null } : { v: best, g: best };
}
function snapPt(x, y, skipSel) {
  const a = snapVal(x, 0, skipSel), b = snapVal(y, 1, skipSel);
  ed.guides = { x: a.g, y: b.g }; return [a.v, b.v];
}
function snapRectMove(r, skipSel) {
  // snap whichever edge is closest on each axis
  ed.guides = { x: null, y: null };
  if (!ui.snap) return r;
  const out = r.slice();
  for (const ax of [0, 1]) {
    const s0 = snapVal(r[ax], ax, skipSel), s1 = snapVal(r[ax + 2], ax, skipSel);
    const d0 = s0.g != null ? Math.abs(s0.v - r[ax]) : Infinity, d1 = s1.g != null ? Math.abs(s1.v - r[ax + 2]) : Infinity;
    const dd = d0 <= d1 ? (s0.g != null ? s0.v - r[ax] : 0) : s1.v - r[ax + 2];
    if (isFinite(Math.min(d0, d1))) { out[ax] += dd; out[ax + 2] += dd; ed.guides[ax ? 'y' : 'x'] = d0 <= d1 ? s0.v : s1.v; }
  }
  return out;
}

/* ---- drafting shapes ---- */
function wallAt(x, y) { const T = wallT(); let best = null, bd = Infinity;
  (layout.walls || []).forEach((w, i) => { if (inR(w, x, y, T * 0.6)) { const c = Math.hypot(x - (w[0] + w[2]) / 2, y - (w[1] + w[3]) / 2) * 0 + rArea(w) * 0 + Math.min(Math.abs(x - w[0]) + Math.abs(x - w[2]) - (w[2] - w[0]), 1e9) + Math.min(Math.abs(y - w[1]) + Math.abs(y - w[3]) - (w[3] - w[1]), 1e9); if (c < bd) { bd = c; best = w; } } });
  return best; }
function draftRect(d) {
  const { tool } = d; let [x0, y0] = [d.x0, d.y0], [x1, y1] = [d.x1, d.y1];
  const T = wallT();
  if (tool === 'wall') {
    if (Math.abs(x1 - x0) >= Math.abs(y1 - y0)) return [Math.min(x0, x1), y0 - T / 2, Math.max(x0, x1), y0 + T / 2];
    return [x0 - T / 2, Math.min(y0, y1), x0 + T / 2, Math.max(y0, y1)];
  }
  if (tool === 'door' || tool === 'window') {
    const w = d.wall || wallAt(x0, y0), click = Math.hypot(x1 - x0, y1 - y0) < 6 / ed.s, def = U(tool === 'door' ? 0.85 : 1.2) / 2;
    if (w) {
      const horiz = w[2] - w[0] >= w[3] - w[1];
      if (horiz) { const a = click ? x0 - def : Math.min(x0, x1), b = click ? x0 + def : Math.max(x0, x1); return [Math.max(w[0], a), w[1], Math.min(w[2], b), w[3]]; }
      const a = click ? y0 - def : Math.min(y0, y1), b = click ? y0 + def : Math.max(y0, y1); return [w[0], Math.max(w[1], a), w[2], Math.min(w[3], b)];
    }
    if (click) return null;
    return draftRect({ ...d, tool: 'wall' });
  }
  return norm([x0, y0, x1, y1]);
}

/* ---- pointer handling ---- */
function evPt(e) { const r = ed.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
ed.cv.addEventListener('contextmenu', e => e.preventDefault());
ed.cv.addEventListener('pointerdown', e => {
  if (mode !== 'edit') return;
  ed.cv.focus({ preventScroll: true });
  const [sx, sy] = evPt(e); ed.ptrs.set(e.pointerId, [sx, sy]);
  try { ed.cv.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  if (ed.ptrs.size === 2) { const [a, b] = [...ed.ptrs.values()]; ed.drag = { type: 'pinch', d0: Math.hypot(a[0] - b[0], a[1] - b[1]), c0: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], s0: ed.s, ox: ed.ox, oy: ed.oy }; return; }
  const [px, py] = toP(sx, sy);
  if (e.button === 1 || e.button === 2 || ed.space) { ed.drag = { type: 'pan', sx, sy, ox: ed.ox, oy: ed.oy }; edCursor('grabbing'); return; }
  const t = ed.tool;
  if (t === 'select') {
    // corner handles of the current selection first
    if (ed.sel) { const hd = handlesOf(ed.sel).find(([hx, hy]) => { const [a, b] = toS(hx, hy); return Math.hypot(a - sx, b - sy) < 9; });
      if (hd) { ed.drag = { type: 'resize', corner: hd[2], orig: selRect(ed.sel).slice(), prev: snapshot(), sel: ed.sel }; return; }
      if (ed.sel.k === 'furniture') { const f = layout.furniture[ed.sel.i], [rx, ry] = rotHandle(f), [a, b] = toS(rx, ry); if (Math.hypot(a - sx, b - sy) < 10) { ed.drag = { type: 'rotate', prev: snapshot(), f }; return; } }
    }
    const hits = hitAll(px, py);
    if (hits.length) {
      let pick = hits[0];
      const idx = hits.findIndex(h => sameSel(h, ed.sel));
      if (idx >= 0 && ed.cycle && Math.hypot(ed.cycle[0] - sx, ed.cycle[1] - sy) < 4) pick = hits[(idx + 1) % hits.length];
      else if (idx >= 0) pick = hits[idx];
      ed.sel = pick; ed.cycle = [sx, sy];
      ed.drag = { type: 'move', px, py, sx, sy, prev: snapshot(), orig: JSON.parse(JSON.stringify(selObj(pick))), origRect: selRect(pick) && selRect(pick).slice(), moved: false, sel: pick };
      renderEditPanel(); edDraw(); return;
    }
    ed.sel = null; renderEditPanel();
    ed.drag = { type: 'pan', sx, sy, ox: ed.ox, oy: ed.oy }; edCursor('grabbing'); edDraw(); return;
  }
  if (t === 'erase') { const h = hitAll(px, py)[0]; if (h) { const prev = snapshot(); deleteSel(h); commit(prev); } return; }
  if (t === 'furniture') { const prev = snapshot(); const f = newFurniture(ui.furnType, px, py, 0); orientToWall(f); layout.furniture.push(f); ed.sel = { k: 'furniture', i: layout.furniture.length - 1 }; commit(prev); return; }
  if (t === 'light') { const prev = snapshot(); layout.lights.push({ at: [rnd1(px), rnd1(py)] }); ed.sel = { k: 'light', i: layout.lights.length - 1 }; commit(prev); return; }
  let [qx, qy] = t === 'measure' ? [px, py] : snapPt(px, py);
  ed.drag = { type: 'draw', tool: t, x0: qx, y0: qy, x1: qx, y1: qy, wall: (t === 'door' || t === 'window') ? wallAt(px, py) : null };
  edDraw();
});
ed.cv.addEventListener('pointermove', e => {
  if (mode !== 'edit') return;
  const [sx, sy] = evPt(e);
  if (ed.ptrs.has(e.pointerId)) ed.ptrs.set(e.pointerId, [sx, sy]);
  const d = ed.drag, [px, py] = toP(sx, sy);
  if (!d) { const h = ed.tool === 'select' || ed.tool === 'erase' ? hitAll(px, py)[0] : null; if (!sameSel(h, ed.hover)) { ed.hover = h; edDraw(); } edCursor(); return; }
  if (d.type === 'pinch') { if (ed.ptrs.size < 2) return; const [a, b] = [...ed.ptrs.values()], dd = Math.hypot(a[0] - b[0], a[1] - b[1]), c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const ns = Math.max(0.05, Math.min(40, d.s0 * dd / d.d0)), k = ns / d.s0;
    ed.s = ns; ed.ox = c[0] - (d.c0[0] - d.ox) * k; ed.oy = c[1] - (d.c0[1] - d.oy) * k; edDraw(); return; }
  if (d.type === 'pan') { ed.ox = d.ox + sx - d.sx; ed.oy = d.oy + sy - d.sy; edDraw(); return; }
  if (d.type === 'move') {
    if (!d.moved && Math.hypot(sx - d.sx, sy - d.sy) < 3) return; d.moved = true;
    const dx = px - d.px, dy = py - d.py, s = d.sel;
    if (s.k === 'furniture') { const f = layout.furniture[s.i]; f.x = rnd1(d.orig.x + dx); f.y = rnd1(d.orig.y + dy); }
    else if (s.k === 'light') { layout.lights[s.i].at = [rnd1(d.orig.at[0] + dx), rnd1(d.orig.at[1] + dy)]; }
    else { const r = snapRectMove([d.origRect[0] + dx, d.origRect[1] + dy, d.origRect[2] + dx, d.origRect[3] + dy], s); setSelRect(s, r); }
    edDraw(); return;
  }
  if (d.type === 'resize') {
    const r = d.orig.slice(), [qx, qy] = snapPt(px, py, d.sel), c = d.corner;
    if (c === 0) { r[0] = qx; r[1] = qy; } else if (c === 1) { r[2] = qx; r[1] = qy; } else if (c === 2) { r[2] = qx; r[3] = qy; } else { r[0] = qx; r[3] = qy; }
    setSelRect(d.sel, r); edDraw(); return;
  }
  if (d.type === 'rotate') { const f = d.f; let a = Math.atan2(px - f.x, py - f.y) * 180 / Math.PI; a = Math.round(a / 15) * 15; if (!e.shiftKey) a = Math.round(a / 90) * 90 === a ? a : a; f.rot = ((a + 540) % 360) - 180; edDraw(); return; }
  if (d.type === 'draw') { const [qx, qy] = d.tool === 'measure' ? [px, py] : snapPt(px, py); d.x1 = qx; d.y1 = qy; edDraw(); }
});
function endPointer(e) {
  ed.ptrs.delete(e.pointerId);
  const d = ed.drag; if (!d) return;
  if (d.type === 'pinch') { if (ed.ptrs.size < 2) ed.drag = null; return; }
  ed.drag = null; ed.guides = null; edCursor();
  if (d.type === 'pan') return;
  if (d.type === 'move') {
    if (!d.moved) { edDraw(); return; }
    if (d.sel.k === 'door' || d.sel.k === 'window') { fillWall(d.origRect); cutWalls(selRect(d.sel)); mergeWalls(); }
    if (d.sel.k === 'room') refreshRoom(layout.rooms[d.sel.i]);
    commit(d.prev); return;
  }
  if (d.type === 'resize') {
    const r = selRect(d.sel);
    if (r[2] - r[0] < 1 || r[3] - r[1] < 1) setSelRect(d.sel, d.orig);
    if (d.sel.k === 'door' || d.sel.k === 'window') { fillWall(d.orig); cutWalls(selRect(d.sel)); mergeWalls(); }
    if (d.sel.k === 'room') refreshRoom(layout.rooms[d.sel.i]);
    commit(d.prev); return;
  }
  if (d.type === 'rotate') { commit(d.prev); return; }
  if (d.type === 'draw') finishDraw(d);
}
ed.cv.addEventListener('pointerup', endPointer);
ed.cv.addEventListener('pointercancel', endPointer);
ed.cv.addEventListener('wheel', e => { if (mode !== 'edit') return; e.preventDefault(); const [sx, sy] = evPt(e);
  if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) zoomAt(sx, sy, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
  else { ed.ox -= e.deltaX; edDraw(); } }, { passive: false });

function finishDraw(d) {
  const prev = snapshot(), t = d.tool, len = Math.hypot(d.x1 - d.x0, d.y1 - d.y0);
  if (t === 'measure') { if (len * ed.s < 8) { edDraw(); return; } ed.measure = { x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1, len }; showCalib(); edDraw(); return; }
  const r = draftRect(d);
  if (!r || (t !== 'door' && t !== 'window' && (r[2] - r[0]) * ed.s < 6 && (r[3] - r[1]) * ed.s < 6)) { edDraw(); return; }
  if ((r[2] - r[0]) < 1 || (r[3] - r[1]) < 1) { edDraw(); return; }
  const q = rr(r);
  if (t === 'wall') { layout.walls.push(q); ed.sel = { k: 'wall', i: layout.walls.length - 1 }; }
  else if (t === 'door') { cutWalls(q); layout.doors.push({ rect: q, hinge: 'start', swing: 1, open: 82 }); ed.sel = { k: 'door', i: layout.doors.length - 1 }; }
  else if (t === 'window') { cutWalls(q); layout.windows.push(q); ed.sel = { k: 'window', i: layout.windows.length - 1 }; }
  else if (t === 'room') {
    if ((q[2] - q[0]) * layout.scale < 0.4 || (q[3] - q[1]) * layout.scale < 0.4) { edDraw(); return; }
    let target = ed.append >= 0 ? layout.rooms[ed.append] : null;
    layout.rooms.forEach(rm => { if (rm !== target) rm.rects = rm.rects.flatMap(a => subtractRect(a, q)); });
    if (target) target.rects.push(q);
    else { target = { name: `Room ${layout.rooms.length + 1}`, floor: 'oak', rects: [q], areaAuto: true }; layout.rooms.push(target); }
    layout.rooms = layout.rooms.filter(rm => rm.rects.length);
    refreshRooms();
    const ri = layout.rooms.indexOf(target); ed.sel = { k: 'room', i: ri, j: target.rects.length - 1 }; ed.append = -1;
    setTool('select');
  }
  else if (t === 'stairs') {
    const horiz = q[2] - q[0] > q[3] - q[1], st = { rise: 0.18, box: q, dir: horiz ? 'E' : 'N', n: 0 };
    st.n = Math.max(3, Math.min(20, Math.round(Mm(horiz ? q[2] - q[0] : q[3] - q[1]) / 0.27)));
    genSteps(st); layout.stairs.push(st); ed.sel = { k: 'stair', i: layout.stairs.length - 1 };
  }
  commit(prev);
}
function orientToWall(f) {
  // face away from the nearest wall within ~1 m
  let best = null, bd = U(1.0);
  (layout.walls || []).forEach(w => {
    const cand = [[f.y - w[3], 'N', f.x >= w[0] && f.x <= w[2] && f.y >= w[3]], [w[1] - f.y, 'S', f.x >= w[0] && f.x <= w[2] && f.y <= w[1]],
      [f.x - w[2], 'W', f.y >= w[1] && f.y <= w[3] && f.x >= w[2]], [w[0] - f.x, 'E', f.y >= w[1] && f.y <= w[3] && f.x <= w[0]]];
    cand.forEach(([dd, sd, ok]) => { if (ok && dd >= 0 && dd < bd) { bd = dd; best = [sd, w]; } });
  });
  if (!best) return;
  const [sd, w] = best; f.rot = { N: 0, S: 180, W: 90, E: -90 }[sd];
  if (['floorLamp', 'plant', 'rug', 'roundTable', 'table', 'coffeeTable', 'basket'].includes(f.type)) return;
  if (sd === 'N') f.y = rnd1(w[3] + f.d / 2); else if (sd === 'S') f.y = rnd1(w[1] - f.d / 2); else if (sd === 'W') f.x = rnd1(w[2] + f.d / 2); else f.x = rnd1(w[0] - f.d / 2);
}
function rotHandle(f) { const a = (f.rot || 0) * Math.PI / 180, dist = f.d / 2 + 16 / ed.s; return [f.x + Math.sin(a) * dist, f.y + Math.cos(a) * dist]; }
function selObj(s) {
  if (!s) return null;
  return { wall: layout.walls, door: layout.doors, window: layout.windows, room: layout.rooms, stair: layout.stairs, furniture: layout.furniture, light: layout.lights }[s.k][s.i];
}
function deleteSel(s) {
  if (!s) return;
  if (s.k === 'door' || s.k === 'window') { const r = selRect(s); (s.k === 'door' ? layout.doors : layout.windows).splice(s.i, 1); fillWall(r); mergeWalls(); }
  else if (s.k === 'wall') layout.walls.splice(s.i, 1);
  else if (s.k === 'room') layout.rooms.splice(s.i, 1);
  else if (s.k === 'stair') layout.stairs.splice(s.i, 1);
  else if (s.k === 'furniture') layout.furniture.splice(s.i, 1);
  else if (s.k === 'light') layout.lights.splice(s.i, 1);
  if (sameSel(s, ed.sel) || (ed.sel && ed.sel.k === s.k)) ed.sel = null;
}

/* ---- drawing ---- */
let drawQueued = false;
function edDraw() { if (drawQueued) return; drawQueued = true; requestAnimationFrame(() => { drawQueued = false; edPaint(); }); }
function edCursor(force) {
  let c = 'default';
  if (force) c = force; else if (ed.space || (ed.drag && ed.drag.type === 'pan')) c = 'grab';
  else if (ed.tool === 'select') c = ed.hover ? 'move' : 'grab';
  else if (ed.tool === 'erase') c = ed.hover ? 'pointer' : 'not-allowed';
  else c = 'crosshair';
  ed.cv.style.cursor = c;
}
function edPaint() {
  const g = eg, dpr = ed.dpr || 1; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, ed.cv.width, ed.cv.height);
  g.fillStyle = '#f6f4ee'; g.fillRect(0, 0, ed.cv.width, ed.cv.height);
  if (!layout || !planImg) return;
  g.setTransform(dpr * ed.s, 0, 0, dpr * ed.s, dpr * ed.ox, dpr * ed.oy);
  const px1 = 1 / ed.s;
  // sheet + plan image
  g.fillStyle = '#fff'; g.shadowColor = 'rgba(0,0,0,.12)'; g.shadowBlur = 14 * px1; g.fillRect(0, 0, planImg.width, planImg.height); g.shadowBlur = 0;
  g.globalAlpha = ui.imgAlpha; g.imageSmoothingQuality = 'high'; g.drawImage(planImg, 0, 0); g.globalAlpha = 1;
  const L = layout, T = wallT();
  const rectP = q => g.fillRect(q[0], q[1], q[2] - q[0], q[3] - q[1]);
  const strokeR = q => g.strokeRect(q[0], q[1], q[2] - q[0], q[3] - q[1]);
  const isSel = (k, i, j) => ed.sel && ed.sel.k === k && ed.sel.i === i && (j == null || ed.sel.j === j);
  const isHov = (k, i, j) => ed.hover && ed.hover.k === k && ed.hover.i === i && (j == null || ed.hover.j === j);
  // rooms
  L.rooms.forEach((rm, i) => {
    const col = roomColor(i); g.fillStyle = col + (isSel('room', i) ? '55' : '30');
    rm.rects.forEach((q, j) => { rectP(q); if (isSel('room', i, j) || isHov('room', i, j)) { g.strokeStyle = col; g.lineWidth = 2 * px1; g.setLineDash([6 * px1, 4 * px1]); strokeR(q); g.setLineDash([]); } });
  });
  // stairs
  L.stairs.forEach((st, i) => {
    g.fillStyle = 'rgba(194,148,102,.35)'; st.steps.forEach(q => rectP(q));
    g.strokeStyle = '#8a6440'; g.lineWidth = 1 * px1; st.steps.forEach(q => strokeR(q));
    if (st.box) { const b = st.box, cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, hl = Math.min(b[2] - b[0], b[3] - b[1]) * 0.35 + (st.dir === 'N' || st.dir === 'S' ? (b[3] - b[1]) * 0.25 : (b[2] - b[0]) * 0.25);
      const v = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[st.dir] || [0, -1];
      g.strokeStyle = '#5c3f22'; g.lineWidth = 2 * px1; g.beginPath(); g.moveTo(cx - v[0] * hl, cy - v[1] * hl); g.lineTo(cx + v[0] * hl, cy + v[1] * hl);
      const ax = cx + v[0] * hl, ay = cy + v[1] * hl, ah = 8 * px1; g.lineTo(ax - v[0] * ah - v[1] * ah * 0.7, ay - v[1] * ah + v[0] * ah * 0.7); g.moveTo(ax, ay); g.lineTo(ax - v[0] * ah + v[1] * ah * 0.7, ay - v[1] * ah - v[0] * ah * 0.7); g.stroke();
      if (isSel('stair', i) || isHov('stair', i)) { g.strokeStyle = '#2f6fb0'; g.lineWidth = 2 * px1; strokeR(b); } }
  });
  // walls
  L.walls.forEach((w, i) => { g.fillStyle = isSel('wall', i) ? '#2f6fb0' : isHov('wall', i) ? '#3d4a57' : 'rgba(31,42,51,.82)'; rectP(w); });
  // windows
  L.windows.forEach((w0, i) => { const q = R4(w0); g.fillStyle = isSel('window', i) ? '#2f6fb0' : '#bfe6f5'; rectP(q);
    g.strokeStyle = '#1f7fa8'; g.lineWidth = 1.2 * px1; strokeR(q); const horiz = q[2] - q[0] >= q[3] - q[1];
    g.beginPath(); if (horiz) { const m = (q[1] + q[3]) / 2; g.moveTo(q[0], m); g.lineTo(q[2], m); } else { const m = (q[0] + q[2]) / 2; g.moveTo(m, q[1]); g.lineTo(m, q[3]); } g.stroke(); });
  // doors with swing arcs
  L.doors.forEach((d, i) => {
    const q = R4(d), horiz = q[2] - q[0] >= q[3] - q[1], Ln = horiz ? q[2] - q[0] : q[3] - q[1], sel = isSel('door', i);
    g.fillStyle = sel ? 'rgba(47,111,176,.45)' : 'rgba(224,122,63,.25)'; rectP(q);
    const hinges = d.hinge === 'both' ? ['start', 'end'] : [d.hinge || 'start'], leaf = Ln / hinges.length, sw = d.swing || 1, op = (d.open ?? 80) * Math.PI / 180;
    g.strokeStyle = sel ? '#2f6fb0' : '#c0602c'; g.lineWidth = 1.6 * px1;
    hinges.forEach(h => {
      let hx, hy, ux, uy, vx, vy;
      if (horiz) { hx = h === 'start' ? q[0] : q[2]; hy = sw > 0 ? q[3] : q[1]; ux = h === 'start' ? 1 : -1; uy = 0; vx = 0; vy = sw; }
      else { hy = h === 'start' ? q[1] : q[3]; hx = sw > 0 ? q[2] : q[0]; ux = 0; uy = h === 'start' ? 1 : -1; vx = sw; vy = 0; }
      g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx + leaf * (Math.cos(op) * ux + Math.sin(op) * vx), hy + leaf * (Math.cos(op) * uy + Math.sin(op) * vy)); g.stroke();
      g.beginPath(); for (let k = 0; k <= 20; k++) { const a = op * k / 20, x = hx + leaf * (Math.cos(a) * ux + Math.sin(a) * vx), y = hy + leaf * (Math.cos(a) * uy + Math.sin(a) * vy); k ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.setLineDash([4 * px1, 3 * px1]); g.stroke(); g.setLineDash([]);
    });
  });
  // furniture
  L.furniture.forEach((f, i) => {
    g.save(); g.translate(f.x, f.y); g.rotate(-(f.rot || 0) * Math.PI / 180);
    const sel = isSel('furniture', i), hov = isHov('furniture', i);
    g.fillStyle = f.type === 'rug' ? 'rgba(169,110,85,.18)' : sel ? 'rgba(47,111,176,.28)' : 'rgba(255,255,255,.85)';
    g.strokeStyle = sel ? '#2f6fb0' : hov ? '#1f2a33' : '#6b5a48'; g.lineWidth = (sel ? 2 : 1.2) * px1;
    if (f.type === 'painting') { g.fillStyle = sel ? '#2f6fb0' : '#b5653f'; g.fillRect(-f.w / 2, -f.d / 2 - 2 * px1, f.w, f.d + 4 * px1); g.restore();
      if (sel) { const [rx, ry] = rotHandle(f); g.fillStyle = '#fff'; g.strokeStyle = '#2f6fb0'; g.lineWidth = 2 * px1; g.beginPath(); g.arc(rx, ry, 6 * px1, 0, 7); g.fill(); g.stroke(); }
      return; }
    const round = f.type === 'roundTable' || (f.type === 'rug' && f.round) || f.type === 'plant' || f.type === 'floorLamp' || f.type === 'basket';
    g.beginPath(); if (round) g.ellipse(0, 0, f.w / 2, f.d / 2, 0, 0, 7); else g.rect(-f.w / 2, -f.d / 2, f.w, f.d); g.fill(); g.stroke();
    if (!round) { g.beginPath(); g.moveTo(-f.w / 2, f.d / 2); g.lineTo(f.w / 2, f.d / 2); g.lineWidth = 3 * px1; g.stroke(); } // front edge
    if (f.type === 'bed') { g.lineWidth = 1 * px1; g.strokeRect(-f.w / 2 + f.w * 0.08, -f.d / 2 + f.d * 0.05, f.w * 0.84, f.d * 0.16); }
    g.rotate((f.rot || 0) * Math.PI / 180);
    const fs = Math.max(8 * px1, Math.min(f.w, f.d) * 0.22); if (fs * ed.s > 6) { g.fillStyle = '#3a3128'; g.font = `500 ${fs}px "IBM Plex Sans", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(FURN[f.type] ? FURN[f.type][0].split(' ')[0] : f.type, 0, 0); }
    g.restore();
    if (sel) { const [rx, ry] = rotHandle(f); g.fillStyle = '#fff'; g.strokeStyle = '#2f6fb0'; g.lineWidth = 2 * px1; g.beginPath(); g.arc(rx, ry, 6 * px1, 0, 7); g.fill(); g.stroke(); }
  });
  // lights
  L.lights.forEach((l, i) => { const sel = isSel('light', i); g.fillStyle = sel ? '#2f6fb0' : '#f2b631'; g.strokeStyle = '#7a5600'; g.lineWidth = 1.2 * px1;
    g.beginPath(); g.arc(l.at[0], l.at[1], 6 * px1, 0, 7); g.fill(); g.stroke(); g.beginPath(); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; g.moveTo(l.at[0] + Math.cos(a) * 8 * px1, l.at[1] + Math.sin(a) * 8 * px1); g.lineTo(l.at[0] + Math.cos(a) * 11 * px1, l.at[1] + Math.sin(a) * 11 * px1); } g.stroke(); });
  // room labels
  g.textAlign = 'center'; g.textBaseline = 'middle';
  L.rooms.forEach((rm, i) => { if (!rm.rects.length) return; const [x, y] = rm.label || [(rm.rects[0][0] + rm.rects[0][2]) / 2, (rm.rects[0][1] + rm.rects[0][3]) / 2];
    const fs = 13 * px1; g.font = `600 ${fs}px "IBM Plex Sans", sans-serif`; const t1 = rm.name || `Room ${i + 1}`, t2 = rm.area || '';
    const w = Math.max(g.measureText(t1).width, (g.font = `500 ${fs * 0.85}px "IBM Plex Mono", monospace`, g.measureText(t2).width)) + 14 * px1;
    g.fillStyle = 'rgba(255,255,255,.92)'; g.strokeStyle = roomColor(i); g.lineWidth = 1.5 * px1; g.beginPath(); g.roundRect(x - w / 2, y - (t2 ? 17 : 11) * px1, w, (t2 ? 34 : 22) * px1, 6 * px1); g.fill(); g.stroke();
    g.fillStyle = '#1f2a33'; g.font = `600 ${fs}px "IBM Plex Sans", sans-serif`; g.fillText(t1, x, y - (t2 ? 6 : 0) * px1);
    if (t2) { g.fillStyle = '#5b6872'; g.font = `500 ${fs * 0.85}px "IBM Plex Mono", monospace`; g.fillText(t2, x, y + 8 * px1); } });
  // selection handles
  if (ed.sel) handlesOf(ed.sel).forEach(([hx, hy]) => { g.fillStyle = '#fff'; g.strokeStyle = '#2f6fb0'; g.lineWidth = 2 * px1; g.fillRect(hx - 5 * px1, hy - 5 * px1, 10 * px1, 10 * px1); g.strokeRect(hx - 5 * px1, hy - 5 * px1, 10 * px1, 10 * px1); });
  // draft
  const d = ed.drag;
  if (d && d.type === 'draw') {
    if (d.tool === 'measure') drawMeasure(g, d.x0, d.y0, d.x1, d.y1, px1);
    else { const r = draftRect(d); if (r) { g.fillStyle = { wall: 'rgba(31,42,51,.5)', door: 'rgba(224,122,63,.5)', window: 'rgba(31,127,168,.45)', room: roomColor(L.rooms.length) + '44', stairs: 'rgba(194,148,102,.5)' }[d.tool] || 'rgba(47,111,176,.3)';
      rectP(r); g.strokeStyle = '#2f6fb0'; g.lineWidth = 1.5 * px1; g.setLineDash([5 * px1, 4 * px1]); strokeR(r); g.setLineDash([]);
      const lenM = Mm(Math.max(r[2] - r[0], r[3] - r[1])); const lbl = d.tool === 'room' ? `${fmtLen(Mm(r[2] - r[0]))} × ${fmtLen(Mm(r[3] - r[1]))}` : fmtLen(lenM);
      tag(g, lbl, (r[0] + r[2]) / 2, r[1] - 14 * px1, px1); } }
  }
  if (ed.measure && !d) drawMeasure(g, ed.measure.x0, ed.measure.y0, ed.measure.x1, ed.measure.y1, px1);
  // snap guides
  if (ed.guides && d) { g.strokeStyle = 'rgba(214,51,108,.7)'; g.lineWidth = 1 * px1; g.setLineDash([3 * px1, 3 * px1]);
    if (ed.guides.x != null) { g.beginPath(); g.moveTo(ed.guides.x, -1e4); g.lineTo(ed.guides.x, 1e4); g.stroke(); }
    if (ed.guides.y != null) { g.beginPath(); g.moveTo(-1e4, ed.guides.y); g.lineTo(1e4, ed.guides.y); g.stroke(); } g.setLineDash([]); }
  // dimension of the selected thing
  if (ed.sel && !d) { const r = selRect(ed.sel); if (r && ed.sel.k !== 'room') tag(g, fmtLen(Mm(Math.max(r[2] - r[0], r[3] - r[1]))), (r[0] + r[2]) / 2, r[1] - 14 * px1, px1); }
}
function tag(g, text, x, y, px1) {
  g.font = `500 ${11 * px1}px "IBM Plex Mono", monospace`; const w = g.measureText(text).width + 10 * px1;
  g.fillStyle = 'rgba(31,42,51,.88)'; g.beginPath(); g.roundRect(x - w / 2, y - 9 * px1, w, 18 * px1, 5 * px1); g.fill();
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x, y);
}
function drawMeasure(g, x0, y0, x1, y1, px1) {
  g.strokeStyle = '#d6336c'; g.lineWidth = 2 * px1; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  [[x0, y0], [x1, y1]].forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 4 * px1, 0, 7); g.fillStyle = '#d6336c'; g.fill(); });
  tag(g, fmtLen(Mm(Math.hypot(x1 - x0, y1 - y0))), (x0 + x1) / 2, (y0 + y1) / 2 - 14 * px1, px1);
}

/* ---- calibration ---- */
function showCalib() {
  $('calib').hidden = false;
  $('calibTxt').innerHTML = `That line measures <b>${esc(fmtLen(Mm(ed.measure.len)))}</b> at the current scale. Enter its real length:`;
  $('uC').textContent = `(${ui.units})`; $('calibLen').value = toUnit(Mm(ed.measure.len)).toFixed(2);
  $('calib').scrollIntoView({ block: 'nearest' }); setTimeout(() => { $('calibLen').focus(); $('calibLen').select(); }, 50);
}
$('calibSet').onclick = () => {
  const v = fromUnit(parseFloat($('calibLen').value)); if (!(v > 0) || !ed.measure) return;
  setScale(v / ed.measure.len, `Scale set: that line is now ${fmtLen(v)}.`); ed.measure = null; $('calib').hidden = true; setTool('select');
};
$('calibCancel').onclick = () => { ed.measure = null; $('calib').hidden = true; edDraw(); };
$('calibLen').onkeydown = e => { if (e.key === 'Enter') $('calibSet').click(); };
$('measureBtn').onclick = () => { setTool('measure'); toast('Drag across something whose real length you know.'); };

/* ---- edit panel ---- */
function renderEditPanel() {
  if (!layout) return;
  $('planName').textContent = layout.name || 'My floor plan';
  // rooms list
  const ul = $('edRooms'); ul.innerHTML = '';
  layout.rooms.forEach((rm, i) => {
    const li = document.createElement('li'), b = document.createElement('button');
    b.className = ed.sel && ed.sel.k === 'room' && ed.sel.i === i ? 'on' : '';
    b.innerHTML = `<span><i class="sw" style="background:${roomColor(i)}"></i><span></span></span><span class="a"></span>`;
    b.children[0].children[1].textContent = rm.name || `Room ${i + 1}`; b.children[1].textContent = rm.area || '';
    b.onclick = () => { ed.sel = { k: 'room', i, j: 0 }; setTool('select'); renderEditPanel(); focusRect(largestRect(rm)); };
    li.appendChild(b); ul.appendChild(li);
  });
  if (!layout.rooms.length) ul.innerHTML = '<li class="note" style="margin:0">No rooms yet. Use the Room tool to drag one out.</li>';
  $('roomCount').textContent = layout.rooms.length ? `${layout.rooms.length}` : '';
  // scale
  const b = computeBounds({ walls: layout.walls.length ? layout.walls : [[0, 0, planImg.width, planImg.height]] });
  $('uW').textContent = `(${ui.units})`; $('uH').textContent = `(${ui.units})`;
  if (document.activeElement !== $('outerW')) $('outerW').value = toUnit(Mm(b.x1 - b.x0)).toFixed(2);
  if (document.activeElement !== $('wallH')) $('wallH').value = toUnit(layout.wallHeight || 2.6).toFixed(2);
  $('scaleInfo').textContent = `${Math.round(1 / layout.scale)} px per metre`;
  $('scaleNote').textContent = layout.scaleGuessed ? 'The scale is a guess from the wall thickness. Measure a known length (or type the overall width) for true sizes.' : `Plan is ${fmtLen(Mm(b.x1 - b.x0))} × ${fmtLen(Mm(b.y1 - b.y0))}.`;
  $('scaleNote').style.color = layout.scaleGuessed ? '#9a5b00' : '';
  $('undoBtn').disabled = !undoStack.length; $('redoBtn').disabled = !redoStack.length;
  renderProps();
}
function focusRect(q) {
  const [ax, ay, bx, by] = edAvail(), cx = (q[0] + q[2]) / 2, cy = (q[1] + q[3]) / 2;
  if (q[0] * ed.s + ed.ox < ax || q[2] * ed.s + ed.ox > bx || q[1] * ed.s + ed.oy < ay || q[3] * ed.s + ed.oy > by) { ed.ox = (ax + bx) / 2 - cx * ed.s; ed.oy = (ay + by) / 2 - cy * ed.s; }
  edDraw();
}
function swatchRow(cur, key) {
  return `<div class="swatches" data-sw="${key}">${WALL_COLORS.map(([hex, nm]) => `<button class="sw${(cur || '').toLowerCase() === hex ? ' on' : ''}" data-hex="${hex}" title="${nm}" aria-label="${nm}" style="background:${hex}"></button>`).join('')}
    <label class="sw custom" title="Any colour"><input type="color" value="${cur || '#f3f0e9'}" aria-label="Pick any colour"></label><button class="sw clear${cur ? '' : ' on'}" data-hex="" title="Default (match the house)" aria-label="Default">×</button></div>`;
}
function bindSwatches(root, onPick) {
  root.querySelectorAll('.swatches').forEach(box => {
    box.querySelectorAll('button.sw').forEach(b => b.onclick = () => onPick(b.dataset.hex || null));
    const ci = box.querySelector('input[type=color]'); if (ci) ci.onchange = () => onPick(ci.value);
  });
}
function pickPhoto(f) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = () => { const file = inp.files[0]; if (!file) return; const rd = new FileReader();
    rd.onload = async () => { try { const im = await loadImageURL(rd.result), k = Math.min(1, 640 / Math.max(im.width, im.height)), c = document.createElement('canvas');
      c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      const prev = snapshot(); f.img = c.toDataURL('image/jpeg', 0.85); f.art = 'photo'; f.ht = +(Mm(f.w) * c.height / c.width).toFixed(3); commit(prev); toast('Your picture is on the wall.'); }
      catch (e) { toast('Could not read that picture.'); } }; rd.readAsDataURL(file); };
  inp.click();
}
function field(label, html) { return `<label class="f"><span>${label}</span>${html}</label>`; }
function renderProps() {
  const s = ed.sel, box = $('props'); $('propsSec').hidden = !s;
  if (!s) { box.innerHTML = ''; return; }
  const o = selObj(s); if (!o) { ed.sel = null; $('propsSec').hidden = true; return; }
  let h = '';
  const del = `<button class="danger" data-act="del">Delete</button>`;
  if (s.k === 'room') {
    const fl = Object.entries(FLOOR_NAMES).map(([v, nm]) => `<option value="${v}" ${o.floor === v ? 'selected' : ''}>${nm}</option>`).join('');
    h = `<div class="title">Room <span>${o.rects.length} area${o.rects.length > 1 ? 's' : ''}</span></div>
      ${field('Name', `<input type="text" data-k="name" value="${esc(o.name || '')}">`)}
      ${field('Floor', `<select data-k="floor">${fl}</select>`)}
      ${field('Area label', `<input type="text" data-k="area" value="${esc(o.area || '')}" style="width:110px">`)}
      <div class="f" style="margin-bottom:4px">Wall paint</div>${swatchRow(o.wall, 'wall')}
      <div class="grid" style="margin-top:8px"><button data-act="append">Add area</button><button data-act="furnish">Furnish room</button>
      ${o.rects.length > 1 ? '<button data-act="rmRect">Remove this area</button>' : ''}<button data-act="autoArea">${o.areaAuto === false ? 'Auto area' : 'Recount area'}</button>${del}</div>`;
  } else if (s.k === 'door') {
    h = `<div class="title">Door <span>${fmtLen(Mm(Math.max(o.rect[2] - o.rect[0], o.rect[3] - o.rect[1])))}</span></div>
      ${field('Hinge', `<select data-k="hinge"><option value="start" ${o.hinge === 'start' ? 'selected' : ''}>${o.rect[2] - o.rect[0] >= o.rect[3] - o.rect[1] ? 'Left' : 'Top'}</option><option value="end" ${o.hinge === 'end' ? 'selected' : ''}>${o.rect[2] - o.rect[0] >= o.rect[3] - o.rect[1] ? 'Right' : 'Bottom'}</option><option value="both" ${o.hinge === 'both' ? 'selected' : ''}>Double door</option></select>`)}
      ${field('Leaf', `<select data-k="style"><option value="" ${!o.style ? 'selected' : ''}>Panelled wood</option><option value="glass" ${o.style === 'glass' ? 'selected' : ''}>Glazed</option></select>`)}
      ${field(`Opens to <span class="note">${o.open ?? 80}°</span>`, `<input type="range" min="0" max="110" step="5" data-k="open" value="${o.open ?? 80}">`)}
      <div class="grid"><button data-act="flipSwing">Flip swing side</button><button data-act="flipHinge">Flip hinge</button>${del}</div>`;
  } else if (s.k === 'window') {
    const sill = o.sill ?? 0.9, head = o.head ?? 2.1;
    h = `<div class="title">Window <span>${fmtLen(Mm(Math.max(R4(o)[2] - R4(o)[0], R4(o)[3] - R4(o)[1])))}</span></div>
      ${field(`Sill height (${ui.units})`, `<input type="number" step="0.05" min="0" data-k="sill" value="${toUnit(sill).toFixed(2)}">`)}
      ${field(`Head height (${ui.units})`, `<input type="number" step="0.05" min="0.3" data-k="head" value="${toUnit(head).toFixed(2)}">`)}
      <div class="grid"><button data-act="toDoor">Make it a door</button>${del}</div>`;
  } else if (s.k === 'wall') {
    const w = o[2] - o[0], hh = o[3] - o[1];
    h = `<div class="title">Wall <span>${fmtLen(Mm(Math.max(w, hh)))} long</span></div>
      ${field(`Thickness (${smallUnit()})`, `<input type="number" step="1" min="2" data-k="thick" value="${toSmall(Mm(Math.min(w, hh))).toFixed(0)}">`)}
      <div class="grid"><button data-act="toDoor">Cut a door here</button><button data-act="toWindow">Make it a window</button>${del}</div>`;
  } else if (s.k === 'furniture' && o.type === 'painting') {
    h = `<div class="title">Painting <span>${toSmall(Mm(o.w)).toFixed(0)} × ${toSmall(o.ht || 0.65).toFixed(0)} ${smallUnit()}</span></div>
      ${field('Art', `<select data-k="art">${ART_STYLES.map(([k, nm]) => `<option value="${k}" ${(o.img ? 'photo' : o.art) === k ? 'selected' : ''}>${nm}</option>`).join('')}</select>`)}
      ${field('Frame', `<select data-k="frame">${[['wood', 'Walnut'], ['black', 'Black metal'], ['white', 'White'], ['gold', 'Brass']].map(([k, nm]) => `<option value="${k}" ${o.frame === k ? 'selected' : ''}>${nm}</option>`).join('')}</select>`)}
      ${field(`Width (${smallUnit()})`, `<input type="number" step="1" min="10" data-k="w" value="${toSmall(Mm(o.w)).toFixed(0)}">`)}
      ${field(`Height (${smallUnit()})`, `<input type="number" step="1" min="10" data-k="ht" value="${toSmall(o.ht || 0.65).toFixed(0)}">`)}
      ${field(`Centre height (${smallUnit()})`, `<input type="number" step="1" min="30" data-k="elev" value="${toSmall(o.elev || 1.5).toFixed(0)}">`)}
      <div class="grid3"><button data-act="reroll" title="New random artwork">New art</button><button data-act="photo">Use photo…</button><button data-act="dup">Copy</button></div>
      <div class="row" style="margin-top:6px"><button data-act="rotL">⟲ 90°</button><button data-act="rotR">⟳ 90°</button>${del}</div>`;
  } else if (s.k === 'furniture') {
    const opts = Object.entries(FURN).map(([k, v]) => `<option value="${k}" ${o.type === k ? 'selected' : ''}>${v[0]}</option>`).join('');
    h = `<div class="title">Furniture <span>${esc(FURN[o.type] ? FURN[o.type][0] : o.type)}</span></div>
      ${field('Type', `<select data-k="type">${opts}</select>`)}
      ${field(`Width (${smallUnit()})`, `<input type="number" step="1" min="5" data-k="w" value="${toSmall(Mm(o.w)).toFixed(0)}">`)}
      ${field(`Depth (${smallUnit()})`, `<input type="number" step="1" min="5" data-k="d" value="${toSmall(Mm(o.d)).toFixed(0)}">`)}
      ${field('Facing', `<input type="number" step="15" data-k="rot" value="${o.rot || 0}">`)}
      <div class="grid3"><button data-act="rotL" title="Rotate left ([)">⟲ 90°</button><button data-act="rotR" title="Rotate right (])">⟳ 90°</button><button data-act="dup" title="Duplicate (Ctrl+D)">Copy</button></div>
      <div class="row" style="margin-top:6px">${del}</div>`;
  } else if (s.k === 'stair') {
    h = !o.dir ? `<div class="title">Stairs <span>${o.steps.length} steps</span></div>
      ${field(`Step rise (${smallUnit()})`, `<input type="number" step="0.5" min="10" max="25" data-k="rise" value="${toSmall(o.rise || 0.18).toFixed(1)}">`)}
      <div class="grid"><button data-act="straight">Make straight flight</button>${del}</div>` : `<div class="title">Stairs <span>${o.n} steps</span></div>
      ${field('Steps', `<input type="number" step="1" min="2" max="40" data-k="n" value="${o.n}">`)}
      ${field('Climbs toward', `<select data-k="dir">${['N', 'E', 'S', 'W'].map(v => `<option value="${v}" ${o.dir === v ? 'selected' : ''}>${{ N: 'Top of plan', E: 'Right', S: 'Bottom of plan', W: 'Left' }[v]}</option>`).join('')}</select>`)}
      ${field(`Step rise (${smallUnit()})`, `<input type="number" step="0.5" min="10" max="25" data-k="rise" value="${toSmall(o.rise || 0.18).toFixed(1)}">`)}
      <div class="row">${del}</div>`;
  } else if (s.k === 'light') {
    h = `<div class="title">Ceiling light</div><div class="row">${del}</div>`;
  }
  box.innerHTML = h;
  box.querySelectorAll('[data-k]').forEach(inp => {
    const ev = inp.tagName === 'SELECT' || inp.type === 'range' ? 'change' : 'change';
    if (inp.type === 'range') inp.oninput = () => { const lbl = inp.closest('label').querySelector('.note'); if (lbl) lbl.textContent = inp.value + '°'; const d = selObj(ed.sel); d.open = +inp.value; edDraw(); };
    inp.addEventListener(ev, () => applyProp(inp.dataset.k, inp.value));
    if (inp.type === 'text') inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
  });
  box.querySelectorAll('[data-act]').forEach(b => b.onclick = () => propAction(b.dataset.act));
  bindSwatches(box, hex => { const prev = snapshot(), o2 = selObj(ed.sel); if (!o2) return; if (hex) o2.wall = hex; else delete o2.wall; commit(prev); });
}
function applyProp(k, v) {
  const prev = snapshot(), s = ed.sel, o = selObj(s); if (!o) return;
  if (s.k === 'room') {
    if (k === 'name') { o.name = v.trim() || o.name; const m = FLOOR_BY_NAME.find(([re]) => re.test(o.name)); if (m && (o.floor === 'oak' || !o.floor)) o.floor = m[1]; }
    else if (k === 'floor') o.floor = v;
    else if (k === 'area') { o.area = v.trim(); o.areaAuto = false; }
  } else if (s.k === 'door') {
    if (k === 'hinge') o.hinge = v; else if (k === 'style') { if (v) o.style = v; else delete o.style; } else if (k === 'open') o.open = +v;
  } else if (s.k === 'window') {
    let w = o; if (Array.isArray(w)) { w = { rect: w }; layout.windows[s.i] = w; }
    const val = fromUnit(parseFloat(v)); if (isFinite(val)) w[k] = +val.toFixed(3);
  } else if (s.k === 'wall') {
    const t = U(fromSmall(parseFloat(v))); if (t > 0) { const horiz = o[2] - o[0] >= o[3] - o[1], c = horiz ? (o[1] + o[3]) / 2 : (o[0] + o[2]) / 2;
      if (horiz) { o[1] = rnd1(c - t / 2); o[3] = rnd1(c + t / 2); } else { o[0] = rnd1(c - t / 2); o[2] = rnd1(c + t / 2); } }
  } else if (s.k === 'furniture') {
    if (k === 'type') { const keep = { x: o.x, y: o.y, rot: o.rot }; const f = newFurniture(v, keep.x, keep.y, keep.rot); layout.furniture[s.i] = f; }
    else if (k === 'w' || k === 'd') { const u = U(fromSmall(parseFloat(v))); if (u > 0) o[k] = rnd1(u); }
    else if (k === 'rot') o.rot = ((parseFloat(v) || 0) + 540) % 360 - 180;
    else if (k === 'ht' || k === 'elev') { const m = fromSmall(parseFloat(v)); if (m > 0) o[k] = +m.toFixed(3); }
    else if (k === 'frame') o.frame = v;
    else if (k === 'art') { if (v === 'photo') { pickPhoto(o); return; } o.art = v; delete o.img; }
  } else if (s.k === 'stair') {
    if (k === 'n') o.n = Math.max(2, Math.min(40, parseInt(v) || o.n)); else if (k === 'dir') o.dir = v; else if (k === 'rise') o.rise = +fromSmall(parseFloat(v)).toFixed(3);
    if (o.dir) genSteps(o);
  }
  if (s.k === 'room') refreshRoom(o);
  commit(prev);
}
function propAction(a) {
  const prev = snapshot(), s = ed.sel, o = selObj(s); if (!o) return;
  if (a === 'del') { deleteSel(s); ed.sel = null; }
  else if (a === 'append') { ed.append = s.i; setTool('room'); toast(`Drag a rectangle to add it to “${o.name}”.`); return; }
  else if (a === 'furnish') { autoFurnish(o); return; }
  else if (a === 'rmRect') { o.rects.splice(s.j, 1); ed.sel = { k: 'room', i: s.i, j: 0 }; refreshRoom(o); }
  else if (a === 'autoArea') { o.areaAuto = true; refreshRoom(o); }
  else if (a === 'straight') { const b = o.box, horiz = b[2] - b[0] > b[3] - b[1]; o.dir = horiz ? 'E' : 'N'; o.n = o.steps.length; genSteps(o); }
  else if (a === 'flipSwing') o.swing = -(o.swing || 1);
  else if (a === 'flipHinge') o.hinge = o.hinge === 'start' ? 'end' : o.hinge === 'end' ? 'start' : 'both';
  else if (a === 'rotL' || a === 'rotR') o.rot = (((o.rot || 0) + (a === 'rotL' ? 90 : -90)) + 540) % 360 - 180;
  else if (a === 'reroll') { o.seed = 1 + Math.random() * 99999 | 0; delete o.img; if (o.art === 'photo') o.art = 'abstract'; }
  else if (a === 'photo') { pickPhoto(o); return; }
  else if (a === 'dup') { const f = { ...o, x: rnd1(o.x + o.w * 0.3 + U(0.1)), y: rnd1(o.y + U(0.1)) }; layout.furniture.push(f); ed.sel = { k: 'furniture', i: layout.furniture.length - 1 }; }
  else if (a === 'toDoor') {
    const r = (R4(o)).slice();
    if (s.k === 'window') layout.windows.splice(s.i, 1);
    else { const horiz = r[2] - r[0] >= r[3] - r[1], c = horiz ? (r[0] + r[2]) / 2 : (r[1] + r[3]) / 2, h = Math.min(U(0.45), (horiz ? r[2] - r[0] : r[3] - r[1]) / 2);
      if (horiz) { r[0] = c - h; r[2] = c + h; } else { r[1] = c - h; r[3] = c + h; } cutWalls(r); }
    layout.doors.push({ rect: rr(r), hinge: 'start', swing: 1, open: 82 }); ed.sel = { k: 'door', i: layout.doors.length - 1 };
  }
  else if (a === 'toWindow') { const r = o.slice(); layout.walls.splice(s.i, 1); layout.windows.push(r); ed.sel = { k: 'window', i: layout.windows.length - 1 }; }
  commit(prev);
}

/* ---- edit panel wiring ---- */
$('units').onchange = e => setUnits(e.target.value);
function setUnits(u, quiet) { ui.units = u; $('units').value = u; refreshRooms(); if (!quiet) changed(); }
$('outerW').onchange = () => {
  const v = fromUnit(parseFloat($('outerW').value)); if (!(v > 0)) return;
  const b = computeBounds({ walls: layout.walls.length ? layout.walls : [[0, 0, planImg.width, planImg.height]] });
  setScale(v / (b.x1 - b.x0), `Scale set from the overall width (${fmtLen(v)}).`);
};
$('wallH').onchange = () => { const v = fromUnit(parseFloat($('wallH').value)); if (v >= 1.8 && v <= 8) { const prev = snapshot(); layout.wallHeight = +v.toFixed(3); commit(prev); } };
$('thr').oninput = () => { det.thr = +$('thr').value; };
$('thr').onchange = () => runDetection();
$('thick').onchange = () => { det.thick = +$('thick').value; runDetection(); };
$('outline').onchange = () => { det.outline = $('outline').checked; runDetection(); };
$('redetectBtn').onclick = () => runDetection();
$('clearBtn').onclick = () => { const prev = snapshot(); Object.assign(layout, { walls: [], windows: [], doors: [], rooms: [], stairs: [], furniture: [], lights: [] }); ed.sel = null; commit(prev); toast('Cleared. Draw walls with the Wall tool, or press Undo.'); };
$('imgAlpha').oninput = () => { ui.imgAlpha = +$('imgAlpha').value; edDraw(); };
$('undoBtn').onclick = undo; $('redoBtn').onclick = redo;
$('snapBtn').onclick = () => { ui.snap = !ui.snap; $('snapBtn').setAttribute('aria-pressed', ui.snap); };
$('furnishBtn').onclick = () => autoFurnish();
$('lightsBtn').onclick = () => autoLights(false);
$('buildBtn').onclick = () => build3D();
$('zIn').onclick = () => { const [a, b, c, d] = edAvail(); zoomAt((a + c) / 2, (b + d) / 2, 1.25); };
$('zOut').onclick = () => { const [a, b, c, d] = edAvail(); zoomAt((a + c) / 2, (b + d) / 2, 0.8); };
$('zFit').onclick = edFit;


/* ==================================================================
   ROOM NAMES FROM THE PLAN (text recognition, runs in the browser)
================================================================== */
const TESS = { lib: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js', workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
  corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1', langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int' };
let ocrWords = null, ocrFor = null, ocrBusy = false;
const AREA_RE = /(\d{1,5}(?:[.,]\d+)?)\s*(sq\.?\s*f(?:ee)?t|sqft|sf\b|ft\s*2|ft²|sq\.?\s*m(?:t|tr|etres|eters)?\b|m\s*2\b|m²|sq\b)/i;
async function readText() {
  if (ocrFor === planURL && ocrWords) return ocrWords;
  const mod = await import(TESS.lib), Tess = mod.default || mod;
  const st = $('ocrStatus');
  const worker = await Tess.createWorker('eng', 1, { workerPath: TESS.workerPath, corePath: TESS.corePath, langPath: TESS.langPath,
    logger: m => { if (m.status && st) st.textContent = `${m.status[0].toUpperCase() + m.status.slice(1)}… ${m.progress ? Math.round(m.progress * 100) + '%' : ''}`; } });
  const k = Math.max(1, Math.min(2.5, 2200 / Math.max(planImg.width, planImg.height)));
  const c = document.createElement('canvas'); c.width = Math.round(planImg.width * k); c.height = Math.round(planImg.height * k);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(planImg, 0, 0, c.width, c.height);
  await worker.setParameters({ tessedit_pageseg_mode: '11' });     // sparse text: labels scattered over a drawing
  const { data } = await worker.recognize(c);
  await worker.terminate();
  ocrWords = (data.words || []).filter(w => w.confidence > 50 && /[A-Za-z0-9]/.test(w.text))
    .map(w => ({ text: w.text.trim(), conf: w.confidence, x0: w.bbox.x0 / k, y0: w.bbox.y0 / k, x1: w.bbox.x1 / k, y1: w.bbox.y1 / k }));
  ocrFor = planURL;
  return ocrWords;
}
function cleanName(words) {
  const toks = words.join(' ').replace(AREA_RE, ' ').replace(/\s*[/&+]\s*/g, ' / ').replace(/\d+\s*['’′]\s*-?\s*\d*\s*(["”″]|'')?/g, ' ').replace(/[x×]\s*(?=\d)/g, ' ').split(/\s+/)
    .map(t => t === '/' ? t : t.replace(/[^A-Za-z\-.]/g, '').replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, ''))
    .filter(t => t === '/' || (t.length >= 3 && /[aeiouy]/i.test(t)) || /^(wc|en|ft|of|up|dn)$/i.test(t))
    .filter(t => !/^(sq|ft|sqft|up|dn|down)$/i.test(t));
  let n = toks.join(' ').replace(/(\s*\/\s*)+/g, ' / ').replace(/\s+/g, ' ').replace(/^\/\s*|\s*\/$/g, '').trim();
  if (n && n === n.toUpperCase()) n = n.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
  return n.slice(0, 40);
}
function applyText(words, { quiet = false } = {}) {
  let named = 0, imperial = 0, metric = 0; const ratios = [];
  layout.rooms.forEach(rm => {
    const inside = words.filter(w => { const cx = (w.x0 + w.x1) / 2, cy = (w.y0 + w.y1) / 2; return rm.rects.some(q => inR(q, cx, cy)); });
    if (!inside.length) return;
    const lh = inside.reduce((a, w) => a + (w.y1 - w.y0), 0) / inside.length;
    // group the words into label blocks, then use the block that names the biggest space
    inside.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
    const blocks = [];
    for (const w of inside) {
      const bl = blocks.find(b => w.y0 - b.y1 < lh * 1.6 && w.x0 < b.x1 + lh * 3 && w.x1 > b.x0 - lh * 3);
      if (bl) { bl.words.push(w); bl.x0 = Math.min(bl.x0, w.x0); bl.x1 = Math.max(bl.x1, w.x1); bl.y1 = Math.max(bl.y1, w.y1); }
      else blocks.push({ words: [w], x0: w.x0, x1: w.x1, y0: w.y0, y1: w.y1 });
    }
    blocks.forEach(b => { b.words.sort((a, c) => (Math.round(a.y0 / (lh * 0.8)) - Math.round(c.y0 / (lh * 0.8))) || a.x0 - c.x0); b.txt = b.words.map(w => w.text).join(' ');
      b.name = cleanName(b.words.map(w => w.text)); const m = b.txt.match(AREA_RE); b.area = m ? parseFloat(m[1].replace(',', '.')) : 0; b.am = m; });
    const cands = blocks.filter(b => b.name);
    if (!cands.length) return;
    cands.sort((a, b) => (b.area - a.area) || (b.name.length - a.name.length));
    const best = cands[0], name = best.name, am = best.am;
    if (name && /^Room \d+$/.test(rm.name || '')) { rm.name = name; named++; const m = FLOOR_BY_NAME.find(([re]) => re.test(name)); if (m && (rm.floor === 'oak' || !rm.floor)) rm.floor = m[1]; }
    if (am) {
      const v = parseFloat(am[1].replace(',', '.')), isM = /m/i.test(am[2]) && !/f/i.test(am[2]);
      isM ? metric++ : imperial++;
      const m2 = isM ? v : v * FT * FT; rm.area = isM ? `${v} m²` : `${Math.round(v)} sq ft`; rm.areaAuto = false;
      const ours = roomAreaM2(rm); if (ours > 0.5 && m2 > 0.5) ratios.push(m2 / ours);
    }
  });
  if (imperial + metric && ui.units === 'm' && imperial > metric) setUnits('ft', true);
  let scaled = false;
  if (layout.scaleGuessed && ratios.length) {
    ratios.sort((a, b) => a - b); const med = ratios[ratios.length >> 1], k = Math.sqrt(med);
    if (k > 0.4 && k < 2.5) { const old = layout.scale; layout.scale = +(layout.scale * k).toFixed(6); layout.scaleGuessed = false; layout.scaleFromAreas = true; rescaleFurniture(old, layout.scale); scaled = true; }
  }
  refreshRooms();
  return { named, scaled, areas: ratios.length };
}
async function readRoomNames({ auto = false } = {}) {
  if (ocrBusy || !layout || !layout.rooms.length) { if (!auto && layout && !layout.rooms.length) toast('Add rooms first, then read their names.'); return; }
  ocrBusy = true; $('ocrBtn').disabled = true; const st = $('ocrStatus'); st.classList.remove('err'); st.textContent = 'Reading the text on the plan…';
  const forURL = planURL;
  try {
    const words = await readText();
    if (forURL !== planURL || !layout) return;
    const prev = snapshot(), r = applyText(words);
    commit(prev);
    st.textContent = r.named || r.areas ? `Named ${r.named} room${r.named === 1 ? '' : 's'} from the plan's labels${r.areas ? `, read ${r.areas} area${r.areas === 1 ? '' : 's'}` : ''}${r.scaled ? ', and set the scale from them' : ''}.` : 'No room labels found inside the rooms. Name them in the panel.';
    if (r.named && auto) toast(`Read ${r.named} room names from the plan. Press Auto-furnish to furnish them.`, 4200);
    if (r.scaled) toast('Scale set from the room areas written on the plan. Check it under Scale.', 4500);
  } catch (err) {
    st.textContent = auto ? 'Room names could not be read automatically (text reader unavailable). Name rooms in the panel.' : 'Could not read the text: ' + (err && err.message || err);
    st.classList.add('err');
  } finally { ocrBusy = false; $('ocrBtn').disabled = false; }
}
$('ocrBtn').onclick = () => { layout.rooms.forEach(rm => { if (/^Room \d+$/.test(rm.name || '')) rm.areaAuto = true; }); readRoomNames(); };

/* ==================================================================
   MODES + 3D
================================================================== */
function setMode(m) {
  mode = m; document.body.classList.remove('m-upload', 'm-edit', 'm-view'); document.body.classList.add('m-' + m);
  $('stepUpload').setAttribute('aria-current', m === 'upload' ? 'step' : 'false');
  $('stepEdit').setAttribute('aria-current', m === 'edit' ? 'step' : 'false');
  $('stepView').setAttribute('aria-current', m === 'view' ? 'step' : 'false');
  $('stepEdit').disabled = !layout; $('stepView').disabled = !layout || !layout.walls.length;
  if (m !== 'view' && tour) stopTour(false);
  if (m !== 'view' && walk) stopWalk(true);
  $('scroll').scrollTop = 0;
  if (m === 'edit') { renderEditPanel(); setTool(ed.tool); }
  if (m === 'upload') { const sv = readLocal(); $('resumeBtn').hidden = !(sv && sv.layout); }
  resize(); edResize();
}
async function build3D() {
  try { validate(layout); } catch (err) { toast('Add some walls first: ' + err.message, 4000); return; }
  refreshRooms();
  const go = () => {
    const first = !everBuilt; everBuilt = true;
    if (built3dFor !== snapshot()) { build(layout); built3dFor = snapshot(); }
    setMode('view');
    if (first) { const p = overviewPose(); camera.position.copy(p.pos).multiplyScalar(1.6); controls.target.copy(p.look); startTour(); }
  };
  if (!overlayTex || overlayTex.userData.url !== planURL) loadOverlay(planURL, go); else go();
}
function loadOverlay(url, cb) { new THREE.TextureLoader().load(url, t => { t.colorSpace = THREE.SRGBColorSpace; t.userData.url = url; overlayTex = t; built3dFor = null; cb && cb(); }, undefined, () => { overlayTex = null; cb && cb(); }); }
let overlayTex = null;

/* ==================================================================
   DECORATE (3D view): floors, wall paint, paintings
================================================================== */
let decRoom = 'all';
function renderDecorate() {
  if (!layout) return;
  const sel = $('decRoom'), rooms = layout.rooms || [];
  sel.innerHTML = `<option value="all">Whole home</option>` + rooms.map((r, i) => `<option value="${i}">${esc(r.name || 'Room ' + (i + 1))}</option>`).join('');
  if (decRoom !== 'all' && !rooms[+decRoom]) decRoom = 'all'; sel.value = decRoom;
  const target = decRoom === 'all' ? null : rooms[+decRoom];
  const curFloor = target ? target.floor || 'oak' : (rooms.length && rooms.every(r => (r.floor || 'oak') === (rooms[0].floor || 'oak')) ? rooms[0].floor || 'oak' : null);
  $('floorSw').innerHTML = Object.entries(FLOOR_NAMES).map(([k, nm]) => `<button data-floor="${k}" aria-pressed="${curFloor === k}" title="${nm}"><i style="background-image:url(${floorThumb(k)})"></i><span>${nm}</span></button>`).join('');
  $('floorSw').querySelectorAll('button').forEach(b => b.onclick = () => decorate(r => { r.floor = b.dataset.floor; }));
  const curWall = target ? target.wall : layout.wallColor;
  $('wallSw').innerHTML = swatchRow(curWall, 'dec');
  bindSwatches($('wallSw'), hex => decorate(r => { if (hex) r.wall = hex; else delete r.wall; }, hex));
}
const thumbCache = {};
function floorThumb(k) {
  if (thumbCache[k]) return thumbCache[k];
  const src = FLOORS[k].map.image, c = document.createElement('canvas'); c.width = 96; c.height = 48;
  c.getContext('2d').drawImage(src, 0, 0, src.width, src.width / 2, 0, 0, 96, 48);
  return (thumbCache[k] = c.toDataURL('image/jpeg', 0.8));
}
function decorate(fn, wallHex) {
  const prev = snapshot();
  if (decRoom === 'all') {
    layout.rooms.forEach(fn);
    if (wallHex !== undefined) { if (wallHex) layout.wallColor = wallHex; else delete layout.wallColor; layout.rooms.forEach(r => delete r.wall); }
  } else fn(layout.rooms[+decRoom]);
  commit(prev); rebuild3D();
}
function rebuild3D() { if (mode === 'view' && layout) { build(layout); built3dFor = snapshot(); if (walk) walkObstacles(); } }
$('decRoom').onchange = e => { decRoom = e.target.value; renderDecorate();
  if (decRoom !== 'all') { const rm = layout.rooms[+decRoom]; if (rm && !walk) { const p = roomPose(rm); flyTo(p.pos, p.look); } } };
$('artBtn').onclick = () => {
  const prev = snapshot(); let n = 0;
  layout.furniture = layout.furniture.filter(f => f.type !== 'painting');
  layout.rooms.forEach(rm => {
    if (/bath|wc|toilet|laundry|utility|stair|closet|storage|garage/i.test(rm.name || '')) return;
    const inner = innerRect(rm), obs = obstaclesFor();
    // above a sofa or bed if there is one, otherwise on the longest free wall
    const anchor = layout.furniture.find(f => (f.type === 'sofa' || f.type === 'bed') && inR(inner, f.x, f.y));
    if (anchor) { layout.furniture.push(hangAbove(anchor, anchor.type === 'bed' ? 1.05 : 0.78, anchor.type === 'bed' ? 0.2 : 0.3)); n++; }
    const area = rArea(inner) * layout.scale ** 2;
    for (let k = anchor ? 1 : 0; k < (area > 20 ? 2 : 1); k++) { const p = placeWall('painting', inner, obs, { tall: true, w: 0.6 + Math.random() * 0.5 }); if (p) { layout.furniture.push(p); n++; } }
  });
  commit(prev); rebuild3D(); toast(n ? `Hung ${n} paintings. Press again for a new arrangement.` : 'No free wall space found for paintings.');
};
$('shuffleBtn').onclick = () => {
  const ps = layout.furniture.filter(f => f.type === 'painting'); if (!ps.length) { $('artBtn').click(); return; }
  const prev = snapshot(); ps.forEach(f => { if (!f.img) { f.seed = 1 + Math.random() * 99999 | 0; f.art = ART_STYLES[(Math.random() * 5) | 0][0]; f.frame = ['wood', 'black', 'white', 'gold'][(Math.random() * 4) | 0]; } });
  commit(prev); rebuild3D();
};
const fmtHour = h => { const hh = Math.floor(h), mm = Math.round((h - hh) * 60); return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`; };
$('hour').oninput = () => { state.hour = +$('hour').value; $('hourLbl').textContent = fmtHour(state.hour); if (state.night) { state.night = false; $('nightBtn').setAttribute('aria-pressed', false); } applyLighting(); };

/* ==================================================================
   WALK-THROUGH (first person, eye height, walls are solid)
================================================================== */
let walk = null; const walkKeys = new Set();
function walkObstacles() {
  const s = built.s, P = built.P, out = [];
  const add = q => { const [ax, az] = P(q[0], q[1]), [bx, bz] = P(q[2], q[3]); out.push([Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)]); };
  (layout.walls || []).forEach(add); (layout.windows || []).forEach(w => add(w.rect || w));
  if (state.furniture) (layout.furniture || []).forEach(f => { if (!['rug', 'painting', 'chair'].includes(f.type)) add(footprint(f)); });
  walk.obs = out;
}
function startWalk() {
  if (!built || walk) return;
  stopTour(false); fly = null;
  // start in the room nearest the current view target, at its middle
  const rooms = (layout.rooms || []).filter(r => r.rects.length);
  let best = null, bd = Infinity;
  rooms.forEach(rm => { const q = largestRect(rm), [x, z] = built.P((q[0] + q[2]) / 2, (q[1] + q[3]) / 2), d = Math.hypot(x - controls.target.x, z - controls.target.z); if (d < bd) { bd = d; best = [x, z, q]; } });
  if (!best) { const b = built.bd; const [x, z] = built.P(b.cx, b.cy); best = [x, z]; }
  walk = { x: best[0], z: best[1], yaw: Math.atan2(-best[0], -best[1]) || 0, pitch: -0.05, t: performance.now(), drag: null, bob: 0, saved: { pos: camera.position.clone(), target: controls.target.clone(), fov: camera.fov } };
  walkObstacles();
  // nudge off furniture if we start inside something
  for (let i = 0; i < 40 && blocked(walk.x, walk.z); i++) { walk.x += Math.cos(i) * 0.15 * (1 + i / 8); walk.z += Math.sin(i) * 0.15 * (1 + i / 8); }
  controls.enabled = false; camera.fov = 62; camera.updateProjectionMatrix();
  document.body.classList.add('walking'); $('walkBtn').setAttribute('aria-pressed', true); $('walkBtn').textContent = '■ Stop walking';
  $('c').focus({ preventScroll: true });
}
function stopWalk(silent) {
  if (!walk) return;
  const sv = walk.saved; walk = null; walkKeys.clear();
  controls.enabled = true; camera.fov = sv.fov; camera.updateProjectionMatrix();
  document.body.classList.remove('walking'); $('walkBtn').setAttribute('aria-pressed', false); $('walkBtn').textContent = '🚶 Walk through at eye level';
  if (!silent) { const p = overviewPose(); camera.position.set(camera.position.x, 6, camera.position.z); controls.target.set(camera.position.x, 0, camera.position.z - 0.01); flyTo(p.pos, p.look, 1400); }
}
const R_BODY = 0.22;
function blocked(x, z) { return walk.obs.some(q => x > q[0] - R_BODY && x < q[2] + R_BODY && z > q[1] - R_BODY && z < q[3] + R_BODY); }
function stepWalk(now) {
  const dt = Math.min(0.05, (now - walk.t) / 1000); walk.t = now;
  const K = k => walkKeys.has(k);
  const turn = (K('arrowleft') || K('q') ? 1 : 0) - (K('arrowright') || K('e') ? 1 : 0); walk.yaw += turn * 1.8 * dt;
  const fwd = (K('w') || K('arrowup') ? 1 : 0) - (K('s') || K('arrowdown') ? 1 : 0), side = (K('d') ? 1 : 0) - (K('a') ? 1 : 0);
  const sp = (walkKeys.has('shift') ? 2.6 : 1.3) * dt;
  const fx = -Math.sin(walk.yaw), fz = -Math.cos(walk.yaw), rx = -fz, rz = fx;
  let dx = (fx * fwd + rx * side) * sp, dz = (fz * fwd + rz * side) * sp;
  if (dx || dz) { if (!blocked(walk.x + dx, walk.z)) walk.x += dx; if (!blocked(walk.x, walk.z + dz)) walk.z += dz; walk.bob += Math.hypot(dx, dz) * 9; }
  const eye = Math.min(1.62, (state.cut ? 2.4 : built.H - 0.3)) + Math.sin(walk.bob) * 0.025;
  camera.position.set(walk.x, eye, walk.z);
  const cp = Math.cos(walk.pitch);
  controls.target.set(walk.x + fx * cp, eye + Math.sin(walk.pitch), walk.z + fz * cp);
  camera.lookAt(controls.target);
}
$('walkBtn').onclick = () => walk ? stopWalk() : startWalk();
const cv3 = $('c');
cv3.addEventListener('pointerdown', e => { if (!walk) return; walk.drag = { x: e.clientX, y: e.clientY, yaw: walk.yaw, pitch: walk.pitch, id: e.pointerId }; try { cv3.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ } });
cv3.addEventListener('pointermove', e => { if (!walk || !walk.drag || walk.drag.id !== e.pointerId) return; const d = walk.drag;
  walk.yaw = d.yaw + (e.clientX - d.x) * 0.005; walk.pitch = Math.max(-1.2, Math.min(1.2, d.pitch + (e.clientY - d.y) * 0.004)); });
const endDrag = e => { if (walk && walk.drag && walk.drag.id === e.pointerId) walk.drag = null; };
cv3.addEventListener('pointerup', endDrag); cv3.addEventListener('pointercancel', endDrag);
document.querySelectorAll('#walkPad button').forEach(b => {
  const k = b.dataset.k, on = e => { e.preventDefault(); walkKeys.add(k); }, off = () => walkKeys.delete(k);
  b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
});

function renderRooms() {
  renderDecorate();
  const ul = $('rooms'); ul.innerHTML = '';
  const rooms = (layout.rooms || []).filter(r => r.rects && r.rects.length);
  if (!rooms.length) { ul.innerHTML = '<li class="note" style="margin:0">No named rooms yet. Add them in the editor.</li>'; return; }
  rooms.forEach((rm, i) => {
    const li = document.createElement('li'), b = document.createElement('button');
    b.innerHTML = `<span></span><span class="a"></span>`; b.children[0].textContent = `${i + 1}. ${rm.name || 'Room'}`; b.children[1].textContent = rm.area || '';
    b.onclick = () => { const p = roomPose(rm); flyTo(p.pos, p.look); };
    li.appendChild(b); ul.appendChild(li);
  });
}
const toggle = (id, key, fn) => { const b = $(id); b.onclick = () => { state[key] = !state[key]; b.setAttribute('aria-pressed', state[key]); fn(); }; };
toggle('cutBtn', 'cut', () => { build(layout); built3dFor = snapshot(); });
toggle('nightBtn', 'night', applyLighting);
toggle('lblBtn', 'labels', () => {});
toggle('ovlBtn', 'overlay', () => { if (built.groups.overlay) built.groups.overlay.visible = state.overlay; else toast('No plan image for this layout'); });
toggle('furnBtn', 'furniture', () => { built.groups.furniture.visible = state.furniture; if (walk) walkObstacles(); });
toggle('doorBtn', 'doorsOpen', () => setDoors(state.doorsOpen));
tourBtn.onclick = () => { if (walk) stopWalk(true); tour ? stopTour() : startTour(); };
$('overviewBtn').onclick = () => { const p = overviewPose(); flyTo(p.pos, p.look); };
$('topBtn').onclick = () => { const p = topPose(); flyTo(p.pos, p.look); };
$('collapse').onclick = () => { const p = $('panel'), c = p.classList.toggle('collapsed'); $('collapse').textContent = c ? 'Show' : 'Hide'; $('collapse').setAttribute('aria-expanded', !c); resize(); };
controls.addEventListener('start', () => { if (tour) stopTour(); fly = null; });
$('backEditBtn').onclick = () => setMode('edit');
$('stepUpload').onclick = () => setMode('upload');
$('stepEdit').onclick = () => { if (layout) setMode('edit'); };
$('stepView').onclick = () => build3D();
$('shotBtn').onclick = () => { renderer.render(scene, camera); const a = document.createElement('a'); a.href = renderer.domElement.toDataURL('image/png'); a.download = (layout.name || 'floor-plan').replace(/[^\w-]+/g, '-') + '-3d.png'; a.click(); };

/* keyboard */
window.addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input, textarea, select, dialog')) return;
  const k = e.key.toLowerCase();
  if (mode === 'edit') {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k === 'd') { e.preventDefault(); if (ed.sel && ed.sel.k === 'furniture') propAction('dup'); return; }
    if (mod && k === 's') { e.preventDefault(); saveProject(); return; }
    if (mod) return;
    if (k === ' ') { ed.space = true; edCursor(); e.preventDefault(); return; }
    if (k === 'escape') { ed.drag = null; ed.measure = null; $('calib').hidden = true; if (ed.tool !== 'select') setTool('select'); else { ed.sel = null; renderEditPanel(); } edDraw(); return; }
    if ((k === 'delete' || k === 'backspace') && ed.sel) { e.preventDefault(); const prev = snapshot(); deleteSel(ed.sel); ed.sel = null; commit(prev); return; }
    if (k.startsWith('arrow') && ed.sel) {
      e.preventDefault(); const st = e.shiftKey ? 10 : 1, dx = k === 'arrowleft' ? -st : k === 'arrowright' ? st : 0, dy = k === 'arrowup' ? -st : k === 'arrowdown' ? st : 0;
      const prev = snapshot(), s = ed.sel, o = selObj(s);
      if (s.k === 'furniture') { o.x = rnd1(o.x + dx); o.y = rnd1(o.y + dy); }
      else if (s.k === 'light') o.at = [o.at[0] + dx, o.at[1] + dy];
      else { const r = selRect(s), old = r.slice(); setSelRect(s, [r[0] + dx, r[1] + dy, r[2] + dx, r[3] + dy]); if (s.k === 'door' || s.k === 'window') { fillWall(old); cutWalls(selRect(s)); mergeWalls(); } if (s.k === 'room') refreshRoom(o); }
      commit(prev); return;
    }
    if ((k === '[' || k === ']') && ed.sel && ed.sel.k === 'furniture') { propAction(k === '[' ? 'rotL' : 'rotR'); return; }
    if (k === 'enter') { build3D(); return; }
    const tool = TOOLS.find(t => t[2].toLowerCase() === k); if (tool) { setTool(tool[0]); return; }
    if (k === '0') { edFit(); return; }
    if (k === '=' || k === '+') { $('zIn').click(); return; } if (k === '-') { $('zOut').click(); return; }
    return;
  }
  if (mode !== 'view') return;
  if (walk) { if (k === 'escape' || k === 'k') { stopWalk(); return; } walkKeys.add(k === 'shift' ? 'shift' : k); if (k.startsWith('arrow') || k === ' ') e.preventDefault(); return; }
  if (k === 'k') { startWalk(); return; }
  const sph = new THREE.Spherical().setFromVector3(tmpV.subVectors(camera.position, controls.target));
  const stop = () => { if (tour) stopTour(); fly = null; };
  let moved = false;
  if (k === 'arrowleft') { sph.theta -= 0.06; moved = true; }
  else if (k === 'arrowright') { sph.theta += 0.06; moved = true; }
  else if (k === 'arrowup') { sph.phi = Math.max(0.05, sph.phi - 0.05); moved = true; }
  else if (k === 'arrowdown') { sph.phi = Math.min(controls.maxPolarAngle, sph.phi + 0.05); moved = true; }
  else if (k === '+' || k === '=') { sph.radius = Math.max(controls.minDistance, sph.radius * 0.9); moved = true; }
  else if (k === '-' || k === '_') { sph.radius = Math.min(controls.maxDistance, sph.radius * 1.1); moved = true; }
  else if ('wasd'.includes(k) && k.length === 1) {
    stop(); const fwd = tmpV.subVectors(controls.target, camera.position).setY(0).normalize(), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const step = sph.radius * 0.04, d = k === 'w' ? fwd.multiplyScalar(step) : k === 's' ? fwd.multiplyScalar(-step) : k === 'd' ? right.multiplyScalar(step) : right.multiplyScalar(-step);
    camera.position.add(d); controls.target.add(d); e.preventDefault(); return;
  }
  else if (k === 't') tourBtn.click();
  else if (k === 'o') $('overviewBtn').click();
  else if (k === 'p') $('topBtn').click();
  else if (k === 'c') $('cutBtn').click();
  else if (k === 'n') $('nightBtn').click();
  else if (k === 'l') $('lblBtn').click();
  else if (k === 'e') setMode('edit');
  else if (/^[1-9]$/.test(k)) { const b = $('rooms').querySelectorAll('button')[+k - 1]; b && b.click(); }
  else return;
  if (moved) { stop(); camera.position.copy(controls.target).add(tmpV.setFromSpherical(sph)); e.preventDefault(); }
});
window.addEventListener('keyup', e => { walkKeys.delete(e.key.toLowerCase()); });
window.addEventListener('blur', () => walkKeys.clear());
window.addEventListener('keyup', e => { if (e.key === ' ') { ed.space = false; edCursor(); } });

/* ---- layout JSON dialog + project files ---- */
function validate(L) {
  if (!L || typeof L !== 'object') throw new Error('Layout must be a JSON object.');
  if (!Array.isArray(L.walls) || !L.walls.length) throw new Error('"walls" must be a non-empty array of [x0, y0, x1, y1] rectangles.');
  const bad = L.walls.find(r => !Array.isArray(r) || r.length !== 4 || r.some(v => typeof v !== 'number'));
  if (bad) throw new Error('Every wall must be [x0, y0, x1, y1] numbers. Problem: ' + JSON.stringify(bad));
  for (const r of L.walls) norm(r);
  if (L.scale != null && !(L.scale > 0)) throw new Error('"scale" must be a positive number (metres per plan unit).');
}
function stringify(L) {
  const keys = Object.keys(L), out = ['{'];
  keys.forEach((k, i) => {
    const v = L[k], end = i < keys.length - 1 ? ',' : '';
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') { out.push(`  "${k}": [`); v.forEach((it, j) => out.push('    ' + JSON.stringify(it) + (j < v.length - 1 ? ',' : ''))); out.push('  ]' + end); }
    else out.push(`  "${k}": ${JSON.stringify(v)}${end}`);
  });
  out.push('}'); return out.join('\n');
}
const dlg = $('jsonDlg');
$('jsonBtn').onclick = () => { $('jsonText').value = stringify(layout); $('jsonErr').textContent = ''; dlg.showModal(); };
$('jsonClose').onclick = () => dlg.close();
$('jsonApply').onclick = () => {
  try { const L = JSON.parse($('jsonText').value); validate(L); const prev = snapshot(); layout = L; ['windows', 'doors', 'rooms', 'stairs', 'furniture', 'lights'].forEach(k => layout[k] = layout[k] || []); commit(prev);
    build(layout); built3dFor = snapshot(); dlg.close(); toast('Layout applied'); }
  catch (err) { $('jsonErr').textContent = err.message; }
};
const download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); };
$('jsonSave').onclick = () => download(new Blob([$('jsonText').value], { type: 'application/json' }), 'floor-plan-layout.json');
$('jsonLoad').onclick = () => $('jsonFile').click();
$('jsonFile').onchange = e => { const f = e.target.files[0]; if (!f) return; f.text().then(t => { $('jsonText').value = t; $('jsonErr').textContent = ''; }); e.target.value = ''; };
function saveProject() {
  if (!layout) return;
  download(new Blob([JSON.stringify({ app: 'plan-to-3d', version: 1, layout, image: planURL, ui: { units: ui.units }, det })], { type: 'application/json' }), (layout.name || 'floor-plan').replace(/[^\w-]+/g, '-') + '.plan3d.json');
  toast('Project saved with its plan image. Open it again from step 1.');
}
$('saveProjBtn').onclick = saveProject; $('saveProjBtn2').onclick = saveProject;

/* ---- upload screen wiring ---- */
const dz = $('dz');
dz.onclick = () => $('planFile').click();
dz.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('planFile').click(); } };
$('planFile').onchange = e => { const f = e.target.files[0]; if (f) openFile(f); e.target.value = ''; };
$('openProjBtn').onclick = () => $('projFile').click();
$('projFile').onchange = e => { const f = e.target.files[0]; if (f) f.text().then(t => openProject(JSON.parse(t))).catch(err => { $('upStatus').textContent = 'That is not a project file: ' + err.message; $('upStatus').classList.add('err'); }); e.target.value = ''; };
$('sampleBtn').onclick = () => startFromImage(PLAN_IMG, 'Sample flat');
$('exampleBtn').onclick = async () => { busy(true, 'Loading the example…'); planURL = PLAN_IMG; planImg = await loadImageURL(PLAN_IMG); busy(false);
  const L = structuredClone(SAMPLE); L.rooms.forEach(r => r.areaAuto = false); L.wallT = 19; await openProject({ layout: L, image: PLAN_IMG }); build3D(); };
$('resumeBtn').onclick = () => { const sv = readLocal(); if (sv) openProject(sv).catch(err => toast(err.message)); };
let dragDepth = 0;
addEventListener('dragenter', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; document.body.classList.add('dragging'); e.preventDefault(); } });
addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dragging'); });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging'); const f = e.dataTransfer.files[0]; if (f) openFile(f); });
addEventListener('paste', e => { if (mode !== 'upload') return; const it = [...(e.clipboardData || {}).items || []].find(i => i.type.startsWith('image/')); if (it) openFile(new File([it.getAsFile()], 'Pasted plan.png', { type: it.type })); });

/* ==================================================================
   RESIZE + RENDER LOOP
================================================================== */
function resize() {
  const w = innerWidth, h = innerHeight, panel = $('panel'), wide = w > 820;
  document.body.classList.toggle('wide', wide);
  renderer.setSize(w, h, false); camera.aspect = w / h;
  const pr = panel.getBoundingClientRect();
  let ox = 0, oy = 0;
  if (wide) ox = -(pr.right) / 2 * 0.9;
  else if (pr.left > w * 0.4) ox = -(w - pr.left) / 2;
  else oy = (h - pr.top) / 2 * 0.9;
  camera.setViewOffset(w, h, ox, oy, w, h);
  camera.updateProjectionMatrix();
}
addEventListener('resize', () => { resize(); edResize(); });
new ResizeObserver(() => { resize(); edResize(); }).observe($('panel'));

function frame(now) {
  requestAnimationFrame(frame);
  if (mode !== 'view' || !built) return;
  if (doorAnim) doorAnim(now);
  if (walk) stepWalk(now);
  else if (tour) {
    const ld = tour.lead;
    if (now < tour.t0 && tour.frozen == null) {
      const k = easeSine(Math.min(1, (now - ld.t0) / 1400));
      camera.position.lerpVectors(ld.p0, tour.posC.getPoint(0), k); controls.target.lerpVectors(ld.l0, tour.lookC.getPoint(0), k);
    } else {
      const raw = tour.frozen ?? Math.min(1, (now - tour.t0) / tour.dur), t = easeSine(raw);
      camera.position.copy(tour.posC.getPoint(t)); controls.target.copy(tour.lookC.getPoint(t));
      tourProg.style.width = (raw * 100).toFixed(1) + '%';
      if (raw >= 1 && tour.frozen == null) { stopTour(false); toast('Tour finished. Drag to explore, or press T to replay.'); }
    }
    camera.lookAt(controls.target);
  } else if (fly) {
    const k = Math.min(1, (now - fly.t0) / fly.dur), e = ease(k);
    camera.position.lerpVectors(fly.p0, fly.p1, e); controls.target.lerpVectors(fly.l0, fly.l1, e);
    camera.position.y += Math.sin(Math.PI * e) * Math.min(3, fly.p0.distanceTo(fly.p1) * 0.15);
    camera.lookAt(controls.target);
    if (k >= 1) fly = null;
  } else controls.update();
  built.groups.lights.children.forEach(c => { if (c.userData.fixture) c.visible = !state.cut; });
  const w = innerWidth, h = innerHeight;
  for (const lb of built.labels) {
    tmpV.copy(lb.pos).project(camera);
    const vis = state.labels && !walk && tmpV.z < 1 && Math.abs(tmpV.x) < 1.1 && Math.abs(tmpV.y) < 1.1 && camera.position.distanceTo(lb.pos) > 2.2;
    lb.el.style.display = vis ? '' : 'none';
    if (vis) { lb.el.style.left = ((tmpV.x + 1) / 2 * w) + 'px'; lb.el.style.top = ((1 - tmpV.y) / 2 * h) + 'px'; }
  }
  renderer.render(scene, camera);
}

/* ---- start ---- */
buildTools(); setTool('select');
resize(); edResize(); setMode('upload');
requestAnimationFrame(frame);
window.__app = { get ocr() { return ocrWords; }, get walk() { return walk; }, get built() { return built; }, get layout() { return layout; }, get ed() { return ed; }, startFromImage, build3D, setMode, autoFurnish, autoLights, setScale, edFit, tourAt(r) { if (!tour) startTour(); tour.frozen = r; }, state, flyTo, overviewPose, topPose, camera, controls, openProject, runDetection };
