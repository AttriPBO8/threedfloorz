
/* ==================================================================
   PLAN DETECTION (runs in the browser on a canvas copy of the plan)
   walls  = thick dark strokes (morphological opening) → rectangles
   gaps   = breaks between collinear wall ends → doors / windows / passages
   rooms  = enclosed regions once every gap is sealed
================================================================== */
function boxCount(src, W, H, k) {
  const r = k >> 1, tmp = new Uint16Array(W * H), out = new Uint16Array(W * H);
  for (let y = 0; y < H; y++) { let acc = 0; const row = y * W;
    for (let x = -r; x < W; x++) { if (x + r < W) acc += src[row + x + r]; if (x - r - 1 >= 0) acc -= src[row + x - r - 1]; if (x >= 0) tmp[row + x] = acc; } }
  for (let x = 0; x < W; x++) { let acc = 0;
    for (let y = -r; y < H; y++) { if (y + r < H) acc += tmp[(y + r) * W + x]; if (y - r - 1 >= 0) acc -= tmp[(y - r - 1) * W + x]; if (y >= 0) out[y * W + x] = acc; } }
  return out;
}
function erode(m, W, H, k) { const c = boxCount(m, W, H, k), o = new Uint8Array(W * H), r = k >> 1;
  for (let y = 0; y < H; y++) { const wy = Math.min(y + r, H - 1) - Math.max(y - r, 0) + 1;
    for (let x = 0; x < W; x++) { const wx = Math.min(x + r, W - 1) - Math.max(x - r, 0) + 1, i = y * W + x; o[i] = c[i] >= wx * wy ? 1 : 0; } } return o; }
function dilate(m, W, H, k) { const c = boxCount(m, W, H, k), o = new Uint8Array(W * H); for (let i = 0; i < o.length; i++) o[i] = c[i] > 0 ? 1 : 0; return o; }
function greedyRects(m, W, H, minArea) {
  const used = new Uint8Array(W * H), out = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!m[i] || used[i]) continue;
    let x2 = x; while (x2 + 1 < W && m[y * W + x2 + 1] && !used[y * W + x2 + 1]) x2++;
    let y2 = y; outer: while (y2 + 1 < H) { for (let xx = x; xx <= x2; xx++) { const j = (y2 + 1) * W + xx; if (!m[j] || used[j]) break outer; } y2++; }
    for (let yy = y; yy <= y2; yy++) used.fill(1, yy * W + x, yy * W + x2 + 1);
    if ((x2 - x + 1) * (y2 - y + 1) >= minArea) out.push([x, y, x2 + 1, y2 + 1]);
  }
  return out;
}
function otsu(gray) {
  const hist = new Float64Array(256); for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const N = gray.length; let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = N - wB; if (!wF) break;
    sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2; if (v > best) { best = v; thr = t; } }
  return Math.max(60, Math.min(200, thr));
}
function floodExterior(block, W, H) {
  const N = W * H, ext = new Uint8Array(N), stack = new Int32Array(N); let sp = 0;
  const push = i => { if (!ext[i] && !block[i]) { ext[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); } for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (sp) { const i = stack[--sp], x = i % W; if (x > 0) push(i - 1); if (x < W - 1) push(i + 1); if (i >= W) push(i - W); if (i < N - W) push(i + W); }
  return ext;
}
const paint = (m, W, q, v = 1) => { for (let y = q[1]; y < q[3]; y++) m.fill(v, y * W + q[0], y * W + q[2]); };

/* opt: { thr (null = auto), thick (multiplier), outline (bool), scale (m per original px, or null = guess) } */
function detectPlan(img, opt = {}) {
  const maxD = 1100, r = Math.min(1, maxD / Math.max(img.width, img.height));
  const W = Math.round(img.width * r), H = Math.round(img.height * r), N = W * H;
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.drawImage(img, 0, 0, W, H);
  const px = g.getImageData(0, 0, W, H).data, gray = new Uint8Array(N);
  for (let i = 0; i < N; i++) gray[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) | 0;
  const thr = opt.thr ?? otsu(gray);
  const dark = new Uint8Array(N); for (let i = 0; i < N; i++) dark[i] = gray[i] < thr ? 1 : 0;
  const k = Math.max(3, Math.round(Math.max(W, H) * 0.008 * (opt.thick || 1))) | 1;
  let base = dark;
  if (opt.outline) { const kc = Math.max(5, Math.round(k * 2.6)) | 1; base = erode(dilate(dark, W, H, kc), W, H, kc); }
  const wall = dilate(erode(base, W, H, k), W, H, k);
  for (let i = 0; i < N; i++) wall[i] &= base[i];
  let wallRects = greedyRects(wall, W, H, k * k * 2);
  if (wallRects.length < 3) throw new Error('No thick walls found. Try a lower “Min wall thickness”, a higher darkness threshold, or tick “Walls drawn as outlines”.');
  // wall thickness: median of min(horizontal run, vertical run) over wall pixels
  let T = k * 2; {
    const hr = new Uint16Array(N), hist = new Float64Array(Math.max(W, H) + 1); let tot = 0;
    for (let y = 0; y < H; y++) { let x = 0; while (x < W) { if (!wall[y * W + x]) { x++; continue; } let e = x; while (e < W && wall[y * W + e]) e++; hr.fill(e - x, y * W + x, y * W + e); x = e; } }
    for (let x = 0; x < W; x++) { let y = 0; while (y < H) { if (!wall[y * W + x]) { y++; continue; } let e = y; while (e < H && wall[e * W + x]) e++;
      for (let yy = y; yy < e; yy++) { const t = Math.min(hr[yy * W + x], e - y); hist[t]++; tot++; } y = e; } }
    let acc = 0; for (let t = 0; t < hist.length; t++) { acc += hist[t]; if (acc >= tot / 2) { T = t; break; } }
  }
  // clean mask from the kept rectangles
  const wm = new Uint8Array(N); wallRects.forEach(q => paint(wm, W, q));
  const mpp = opt.scale ? opt.scale / r : 0.23 / T;          // metres per detection pixel

  /* ---- gaps between collinear wall ends ---- */
  const minG = Math.max(T * 1.3, 0.45 / mpp), maxG = Math.min(3.4 / mpp, Math.max(W, H) * 0.4);
  const colFrac = (x, y0, y1) => { let n = 0; for (let y = y0; y < y1; y++) n += wm[y * W + x]; return n / Math.max(1, y1 - y0); };
  const rowFrac = (y, x0, x1) => { let n = 0; const o = y * W; for (let x = x0; x < x1; x++) n += wm[o + x]; return n / Math.max(1, x1 - x0); };
  let gaps = [];
  for (const q of wallRects) {
    const w = q[2] - q[0], h = q[3] - q[1], t = Math.min(w, h);
    if (t < 0.55 * T || t > 1.9 * T) continue;
    if (w >= h * 1.5) {
      if (q[2] < W - 1 && colFrac(q[2], q[1], q[3]) < 0.5) { let x = q[2]; while (x < W && x - q[2] <= maxG && colFrac(x, q[1], q[3]) < 0.6) x++;
        const gg = x - q[2]; if (x < W && gg >= minG && gg <= maxG) gaps.push({ r: [q[2], q[1], x, q[3]], horiz: true }); }
      if (q[0] > 0 && colFrac(q[0] - 1, q[1], q[3]) < 0.5) { let x = q[0] - 1; while (x >= 0 && q[0] - 1 - x <= maxG && colFrac(x, q[1], q[3]) < 0.6) x--;
        const gg = q[0] - 1 - x; if (x >= 0 && gg >= minG && gg <= maxG) gaps.push({ r: [x + 1, q[1], q[0], q[3]], horiz: true }); }
    }
    if (h >= w * 1.5) {
      if (q[3] < H - 1 && rowFrac(q[3], q[0], q[2]) < 0.5) { let y = q[3]; while (y < H && y - q[3] <= maxG && rowFrac(y, q[0], q[2]) < 0.6) y++;
        const gg = y - q[3]; if (y < H && gg >= minG && gg <= maxG) gaps.push({ r: [q[0], q[3], q[2], y], horiz: false }); }
      if (q[1] > 0 && rowFrac(q[1] - 1, q[0], q[2]) < 0.5) { let y = q[1] - 1; while (y >= 0 && q[1] - 1 - y <= maxG && rowFrac(y, q[0], q[2]) < 0.6) y--;
        const gg = q[1] - 1 - y; if (y >= 0 && gg >= minG && gg <= maxG) gaps.push({ r: [q[0], y + 1, q[2], q[1]], horiz: false }); }
    }
  }
  // merge side-by-side pieces of the same opening (walls split lengthwise)
  for (let again = true; again;) { again = false;
    for (let i = 0; i < gaps.length && !again; i++) for (let j = i + 1; j < gaps.length && !again; j++) {
      const a = gaps[i], b = gaps[j]; if (a.horiz !== b.horiz) continue;
      const A = a.r, Bq = b.r, ax = a.horiz ? 0 : 1, cx = 1 - ax;
      const span = Math.min(A[ax + 2], Bq[ax + 2]) - Math.max(A[ax], Bq[ax]), need = 0.8 * Math.max(A[ax + 2] - A[ax], Bq[ax + 2] - Bq[ax]);
      const touch = Math.max(A[cx], Bq[cx]) - Math.min(A[cx + 2], Bq[cx + 2]) <= 3;
      if (span >= need && touch) { a.r = [Math.min(A[0], Bq[0]), Math.min(A[1], Bq[1]), Math.max(A[2], Bq[2]), Math.max(A[3], Bq[3])]; gaps.splice(j, 1); again = true; }
    } }
  // de-duplicate overlapping gaps (keep the shorter one)
  const area = q => (q[2] - q[0]) * (q[3] - q[1]);
  const ovl = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  gaps.sort((a, b) => area(a.r) - area(b.r));
  gaps = gaps.filter((gp, i) => !gaps.slice(0, i).some(o => ovl(o.r, gp.r) > 0.3 * Math.min(area(o.r), area(gp.r))));
  // a gap must not swallow a wall
  gaps = gaps.filter(gp => { let n = 0; const q = gp.r; for (let y = q[1]; y < q[3]; y++) for (let x = q[0]; x < q[2]; x++) n += wm[y * W + x]; return n < area(q) * 0.25; });

  /* ---- exterior, with every gap sealed ---- */
  const sealed = wm.slice(); gaps.forEach(gp => paint(sealed, W, gp.r));
  const kd = Math.max(3, Math.round(T / 4)) | 1;
  const sealedD = dilate(sealed, W, H, kd);
  let ext = dilate(floodExterior(sealedD, W, H), W, H, kd);
  for (let i = 0; i < N; i++) if (sealed[i]) ext[i] = 0;
  let inside = 0; for (let i = 0; i < N; i++) if (!ext[i]) inside++;
  if (inside < N * 0.05) { ext = floodExterior(dark, W, H); }

  /* ---- classify each gap ---- */
  const doors = [], windows = [];
  const countDark = (q) => { let n = 0; const x0 = Math.max(0, q[0]), x1 = Math.min(W, q[2]), y0 = Math.max(0, q[1]), y1 = Math.min(H, q[3]);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * W + x; if (dark[i] && !wm[i]) n++; } return n; };
  const isExt = (x, y) => x < 0 || y < 0 || x >= W || y >= H || ext[(y | 0) * W + (x | 0)] === 1;
  for (const gp of gaps) {
    const q = gp.r, len = gp.horiz ? q[2] - q[0] : q[3] - q[1], th0 = gp.horiz ? q[3] - q[1] : q[2] - q[0];
    // inner band (skip the 2 px next to each wall end)
    const inner = gp.horiz ? [q[0] + 2, q[1], q[2] - 2, q[3]] : [q[0], q[1] + 2, q[2], q[3] - 2];
    const fill = countDark(inner) / Math.max(1, area(inner));
    const off = Math.max(3, th0);
    const m = gp.horiz ? (q[0] + q[2]) / 2 : (q[1] + q[3]) / 2;
    const sideA = gp.horiz ? isExt(m, q[1] - off) : isExt(q[0] - off, m), sideB = gp.horiz ? isExt(m, q[3] + off) : isExt(q[2] + off, m);
    const exterior = sideA || sideB;
    // door arcs: look for a quarter circle swept from either jamb, on either side
    const D = (x, y) => { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= H) return 0; const i = y * W + x; return dark[i] && !wm[i] ? 1 : 0; };
    const arcCov = (hx, hy, ux, uy, vx, vy, R) => { let hit = 0, n = 0;
      for (let a = 12; a <= 84; a += 4) { n++; const ca = Math.cos(a * Math.PI / 180), sa = Math.sin(a * Math.PI / 180);
        for (let s = R * 0.82; s <= R * 1.03; s += 1) { if (D(hx + s * (ca * ux + sa * vx), hy + s * (ca * uy + sa * vy)) || D(hx + s * (ca * ux + sa * vx) + 1, hy + s * (ca * uy + sa * vy)) ) { hit++; break; } } }
      return hit / n; };
    let best = { cov: 0 };
    for (const side of [1, -1]) {
      if (exterior && ((side === 1 && sideB) || (side === -1 && sideA))) continue;
      const vx = gp.horiz ? 0 : side, vy = gp.horiz ? side : 0, ux = gp.horiz ? 1 : 0, uy = gp.horiz ? 0 : 1;
      const ex = gp.horiz ? null : (side === 1 ? q[2] : q[0]), ey = gp.horiz ? (side === 1 ? q[3] : q[1]) : null;
      const S0 = gp.horiz ? [q[0], ey] : [ex, q[1]], S1 = gp.horiz ? [q[2], ey] : [ex, q[3]];
      const cs = arcCov(S0[0], S0[1], ux, uy, vx, vy, len), ce = arcCov(S1[0], S1[1], -ux, -uy, vx, vy, len);
      const cb = Math.min(arcCov(S0[0], S0[1], ux, uy, vx, vy, len / 2), arcCov(S1[0], S1[1], -ux, -uy, vx, vy, len / 2));
      for (const [cov, hinge] of [[cs, 'start'], [ce, 'end'], [cb * 1.05, 'both']]) if (cov > best.cov) best = { cov, hinge, swing: side };
    }
    const back = v => Math.round(v / r);
    const rect = q.map(back);
    if (opt.debug) console.log(JSON.stringify(q), 'fill', fill.toFixed(3), 'cov', best.cov.toFixed(2), best.hinge, best.swing, 'ext', exterior);
    if (fill >= 0.2 && len * mpp < 3.6) { windows.push(rect); continue; }
    if (best.cov >= 0.6) {
      doors.push({ rect, hinge: best.hinge, swing: best.swing, open: best.hinge === 'both' ? 70 : 82, ...(len * mpp > 1.7 ? { style: 'glass' } : {}) });
      continue;
    }
    if (fill > 0.12 && len * mpp < 3.6) { windows.push(rect); continue; }
    // interior break with no arc: open passage (left as a gap)
  }

  /* ---- rooms: connected free space inside the sealed walls ---- */
  const free = new Uint8Array(N); for (let i = 0; i < N; i++) free[i] = !sealedD[i] && !ext[i] ? 1 : 0;
  const lab = new Int32Array(N), comps = []; const stack = new Int32Array(N);
  for (let s0 = 0; s0 < N; s0++) {
    if (!free[s0] || lab[s0]) continue;
    const id = comps.length + 1; let sp = 0, n = 0, x0 = W, y0 = H, x1 = 0, y1 = 0, edge = false; stack[sp++] = s0; lab[s0] = id;
    while (sp) { const i = stack[--sp], x = i % W, y = (i / W) | 0; n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
      if (x > 0 && free[i - 1] && !lab[i - 1]) { lab[i - 1] = id; stack[sp++] = i - 1; }
      if (x < W - 1 && free[i + 1] && !lab[i + 1]) { lab[i + 1] = id; stack[sp++] = i + 1; }
      if (i >= W && free[i - W] && !lab[i - W]) { lab[i - W] = id; stack[sp++] = i - W; }
      if (i < N - W && free[i + W] && !lab[i + W]) { lab[i + W] = id; stack[sp++] = i + W; } }
    comps.push({ id, n, bb: [x0, y0, x1 + 1, y1 + 1], edge });
  }
  const minRoom = 1.0 / (mpp * mpp);
  const rooms = [];
  const gs = Math.max(3, Math.round(T / 2));
  const dk = (Math.round(T * 0.5 + kd / 2) * 2 + 1) | 1;
  for (const cp of comps) {
    if (cp.edge || cp.n < minRoom) continue;
    // grow the region halfway into the surrounding walls so floors meet under them
    const pad = T + 2, bx0 = Math.max(0, cp.bb[0] - pad), by0 = Math.max(0, cp.bb[1] - pad), bx1 = Math.min(W, cp.bb[2] + pad), by1 = Math.min(H, cp.bb[3] + pad);
    const bw = bx1 - bx0, bh = by1 - by0, sub = new Uint8Array(bw * bh);
    for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) if (lab[y * W + x] === cp.id) sub[(y - by0) * bw + (x - bx0)] = 1;
    const grown = dilate(sub, bw, bh, dk);
    for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) { const j = (y - by0) * bw + (x - bx0); if (grown[j] && ext[y * W + x] && !wm[y * W + x]) grown[j] = 0; }
    const GW = Math.ceil(bw / gs), GH = Math.ceil(bh / gs), grid = new Uint8Array(GW * GH);
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      let n = 0, t = 0; for (let y = gy * gs; y < Math.min(bh, gy * gs + gs); y++) for (let x = gx * gs; x < Math.min(bw, gx * gs + gs); x++) { t++; n += grown[y * bw + x]; }
      grid[gy * GW + gx] = n > t * 0.5 ? 1 : 0;
    }
    const rects = greedyRects(grid, GW, GH, 1).map(q => [bx0 + q[0] * gs, by0 + q[1] * gs, Math.min(bx1, bx0 + q[2] * gs), Math.min(by1, by0 + q[3] * gs)])
      .sort((a, b) => area(b) - area(a));
    if (!rects.length) continue;
    rooms.push({ rects: rects.map(q => q.map(v => Math.round(v / r))), cx: cp.bb[0] + cp.bb[2], cy: cp.bb[1] + cp.bb[3] });
  }
  rooms.sort((a, b) => (Math.round(a.cy / (H * 0.18)) - Math.round(b.cy / (H * 0.18))) || a.cx - b.cx);
  return {
    walls: wallRects.map(q => q.map(v => Math.round(v / r))), windows, doors,
    rooms: rooms.map((rm, i) => ({ name: `Room ${i + 1}`, floor: 'oak', rects: rm.rects, areaAuto: true })),
    ...(opt.debug ? { dbg: { ext, W, H, r, gaps, wm } } : {}),
    thr, wallT: T / r, scale: mpp * r, scaleGuessed: !opt.scale, gaps: gaps.length
  };
}
