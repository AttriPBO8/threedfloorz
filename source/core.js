/* ------------------------------------------------------------------ renderer / scene */
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 300);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.497;
controls.minDistance = 0.8;
controls.maxDistance = 70;

const hemi = new THREE.HemisphereLight(0xe6efff, 0x9a8a74, 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0dc, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

const groundMat = new THREE.MeshStandardMaterial({ color: 0xc9d3bf, roughness: 1 });
const ground = new THREE.Mesh(new THREE.CircleGeometry(80, 64), groundMat);
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.26; ground.receiveShadow = true;
scene.add(ground);

/* ------------------------------------------------------------------ procedural textures */
function canvasTex(size, draw, metres) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.userData.m = metres; return t;
}
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const woodTex = (base) => canvasTex(512, (g, s) => {
  const rows = 8, rh = s / rows;
  for (let r = 0; r < rows; r++) {
    let x = -rnd() * s * 0.6;
    while (x < s) {
      const len = s * (0.45 + rnd() * 0.5), k = 0.86 + rnd() * 0.22;
      g.fillStyle = `rgb(${base[0]*k|0},${base[1]*k|0},${base[2]*k|0})`;
      g.fillRect(x, r * rh, len, rh);
      g.strokeStyle = `rgba(60,35,15,${0.08 + rnd() * 0.08})`; g.lineWidth = 1;
      for (let i = 0; i < 6; i++) { const y = r * rh + rnd() * rh; g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + len*.3, y + rnd()*4-2, x + len*.7, y + rnd()*4-2, x + len, y); g.stroke(); }
      g.fillStyle = 'rgba(40,25,10,.35)'; g.fillRect(x, r * rh, 2, rh);
      x += len;
    }
    g.fillStyle = 'rgba(40,25,10,.35)'; g.fillRect(0, r * rh, s, 2);
  }
}, 1.6);
const tileTex = (n, base, grout, metres) => canvasTex(512, (g, s) => {
  g.fillStyle = grout; g.fillRect(0, 0, s, s);
  const t = s / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const k = 0.94 + rnd() * 0.1;
    g.fillStyle = `rgb(${base[0]*k|0},${base[1]*k|0},${base[2]*k|0})`;
    g.fillRect(i * t + 2, j * t + 2, t - 4, t - 4);
  }
}, metres);
const concreteTex = () => canvasTex(256, (g, s) => {
  g.fillStyle = '#a7a39b'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 2500; i++) { const v = 130 + rnd() * 60 | 0; g.fillStyle = `rgba(${v},${v},${v-6},.25)`; g.fillRect(rnd()*s, rnd()*s, 2, 2); }
}, 1.5);
const rugTex = (c1, c2, round) => { const t = canvasTex(256, (g, s) => {
  g.fillStyle = c1; g.fillRect(0, 0, s, s);
  g.strokeStyle = c2; g.lineWidth = 10;
  if (round) { for (let r = 30; r < s/2; r += 34) { g.beginPath(); g.arc(s/2, s/2, r, 0, 7); g.stroke(); } }
  else { g.strokeRect(18, 18, s-36, s-36); g.lineWidth = 4; g.strokeRect(36, 36, s-72, s-72);
    for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(60 + i*34, s/2 - 30); g.lineTo(77 + i*34, s/2); g.lineTo(60 + i*34, s/2 + 30); g.stroke(); } }
}, 1); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t; };

/* wrap-around drawing helper: draws fn at the 9 tile offsets so patterns tile seamlessly */
const wrap9 = (s, fn) => { for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) fn(ox, oy); };
const marbleTex = (base, vein, metres) => canvasTex(1024, (g, s) => {
  g.fillStyle = base; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 90; i++) { const x = rnd() * s, y = rnd() * s, r = 40 + rnd() * 160; const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${vein[0]},${vein[1]},${vein[2]},${0.03 + rnd() * 0.04})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, s, s); }
  const veins = [];
  for (let i = 0; i < 16; i++) { let x = rnd() * s, y = rnd() * s, a = -0.6 + rnd() * 0.5; const pts = [[x, y]];
    for (let k = 0; k < 14; k++) { a += (rnd() - 0.5) * 0.7; x += Math.cos(a) * 70; y += Math.sin(a) * 70; pts.push([x, y]); }
    veins.push({ pts, w: 0.6 + rnd() * (i < 4 ? 3.2 : 1.4), al: i < 4 ? 0.55 : 0.28 }); }
  try { g.filter = 'blur(1.2px)'; } catch (e) { /* no canvas filters */ }
  for (const v of veins) wrap9(s, (ox, oy) => { g.strokeStyle = `rgba(${vein[0]},${vein[1]},${vein[2]},${v.al})`; g.lineWidth = v.w; g.beginPath();
    v.pts.forEach(([x, y], k) => k ? g.lineTo(x + ox, y + oy) : g.moveTo(x + ox, y + oy)); g.stroke(); });
  try { g.filter = 'none'; } catch (e) { /* ignore */ }
  g.strokeStyle = 'rgba(0,0,0,.09)'; g.lineWidth = 2; g.strokeRect(0, 0, s, s);   // slab joints
}, metres);
const parquetTex = (base) => canvasTex(512, (g, s) => {
  const n = 4, c = s / n, pl = 3;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < pl; k++) {
    const t = 0.86 + rnd() * 0.24; g.fillStyle = `rgb(${base[0] * t | 0},${base[1] * t | 0},${base[2] * t | 0})`;
    const horiz = (i + j) % 2 === 0, x = i * c, y = j * c, w = c / pl;
    if (horiz) g.fillRect(x, y + k * w, c, w); else g.fillRect(x + k * w, y, w, c);
    g.strokeStyle = 'rgba(50,30,12,.35)'; g.lineWidth = 1.5; horiz ? g.strokeRect(x, y + k * w, c, w) : g.strokeRect(x + k * w, y, w, c);
    g.strokeStyle = 'rgba(60,35,15,.08)';
    for (let q = 0; q < 4; q++) { g.beginPath(); if (horiz) { const yy = y + k * w + rnd() * w; g.moveTo(x, yy); g.lineTo(x + c, yy + rnd() * 2 - 1); } else { const xx = x + k * w + rnd() * w; g.moveTo(xx, y); g.lineTo(xx + rnd() * 2 - 1, y + c); } g.stroke(); }
  }
}, 1.2);
const terrazzoTex = () => canvasTex(512, (g, s) => {
  g.fillStyle = '#e8e2d6'; g.fillRect(0, 0, s, s);
  const cols = ['#b9603f', '#6f8c7a', '#2f3a40', '#d8b25a', '#9a958c', '#f7f4ee', '#c9a69a'];
  for (let i = 0; i < 700; i++) { const x = rnd() * s, y = rnd() * s, r = 1.5 + rnd() ** 3 * 11, col = cols[(rnd() * cols.length) | 0], sides = 4 + (rnd() * 3 | 0), a0 = rnd() * 6;
    wrap9(s, (ox, oy) => { g.fillStyle = col; g.beginPath(); for (let k = 0; k < sides; k++) { const a = a0 + k / sides * 6.283, rr = r * (0.6 + rnd() * 0.5); k ? g.lineTo(x + ox + Math.cos(a) * rr, y + oy + Math.sin(a) * rr) : g.moveTo(x + ox + Math.cos(a) * rr, y + oy + Math.sin(a) * rr); } g.fill(); }); }
}, 1.4);
const carpetTex = (base) => canvasTex(256, (g, s) => {
  g.fillStyle = `rgb(${base})`; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 9000; i++) { const v = (rnd() - 0.5) * 34; g.fillStyle = `rgba(${base.map(c => Math.max(0, Math.min(255, c + v)) | 0)},.5)`; g.fillRect(rnd() * s, rnd() * s, 1.5, 1.5); }
}, 0.8);
const slateTex = () => canvasTex(512, (g, s) => {
  g.fillStyle = '#2a2d30'; g.fillRect(0, 0, s, s); const n = 2, t = s / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const k = 0.8 + rnd() * 0.35; g.fillStyle = `rgb(${66 * k | 0},${71 * k | 0},${76 * k | 0})`; g.fillRect(i * t + 3, j * t + 3, t - 6, t - 6);
    for (let q = 0; q < 300; q++) { const v = 50 + rnd() * 50 | 0; g.fillStyle = `rgba(${v},${v + 4},${v + 8},.25)`; g.fillRect(i * t + 3 + rnd() * (t - 6), j * t + 3 + rnd() * (t - 6), 3 + rnd() * 10, 1 + rnd() * 2); } }
}, 1.2);

const FLOORS = {
  oak: { map: woodTex([196, 152, 104]), roughness: 0.55 },
  maple: { map: woodTex([226, 196, 158]), roughness: 0.5 },
  walnut: { map: woodTex([128, 88, 60]), roughness: 0.5 },
  parquet: { map: parquetTex([184, 136, 88]), roughness: 0.45 },
  marble: { map: marbleTex('#f3f1ec', [120, 118, 116], 2.4), roughness: 0.12 },
  blackMarble: { map: marbleTex('#1d1e21', [205, 200, 190], 2.4), roughness: 0.1 },
  terrazzo: { map: terrazzoTex(), roughness: 0.25 },
  slate: { map: slateTex(), roughness: 0.6 },
  carpet: { map: carpetTex([150, 160, 168]), roughness: 1 },
  carpetWarm: { map: carpetTex([196, 168, 136]), roughness: 1 },
  tile: { map: tileTex(4, [222, 216, 204], '#a9a39a', 1.2), roughness: 0.35 },
  bathtile: { map: tileTex(8, [178, 196, 204], '#e9ecee', 1.2), roughness: 0.3 },
  concrete: { map: concreteTex(), roughness: 0.9 }
};
const floorMats = {};
for (const k in FLOORS) floorMats[k] = new THREE.MeshStandardMaterial({ map: FLOORS[k].map, roughness: FLOORS[k].roughness, envMapIntensity: FLOORS[k].roughness < 0.2 ? 1.4 : 1 });
const FLOOR_NAMES = { oak: 'Oak boards', maple: 'Light maple', walnut: 'Walnut boards', parquet: 'Parquet', marble: 'White marble', blackMarble: 'Black marble',
  terrazzo: 'Terrazzo', tile: 'Stone tile', bathtile: 'Bathroom tile', slate: 'Slate', carpet: 'Grey carpet', carpetWarm: 'Oatmeal carpet', concrete: 'Polished concrete' };
const WALL_COLORS = [['#f3f0e9', 'Chalk white'], ['#e4ddd0', 'Warm stone'], ['#c9c4bb', 'Pebble grey'], ['#b7c4a8', 'Sage'], ['#b9d0cf', 'Duck egg'], ['#9fb3c8', 'Dusty blue'],
  ['#3e5266', 'Navy'], ['#4f6b55', 'Forest'], ['#c9775a', 'Terracotta'], ['#e7c4bc', 'Blush'], ['#d8b25a', 'Mustard'], ['#c5bcd8', 'Lavender'], ['#4a4f55', 'Charcoal']];
const paintMats = {};
const paintMat = hex => paintMats[hex] || (paintMats[hex] = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: 0.88, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));

/* procedural wall art (canvas), cached per style + seed */
const artCache = {};
function artTexture(style, seed, ratio, img) {
  const key = img ? 'img:' + img.slice(-64) + img.length : `${style}:${seed}:${ratio.toFixed(2)}`;
  if (artCache[key]) return artCache[key];
  const W = 512, H = Math.round(512 / Math.max(0.3, ratio)), c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  let sd = (seed * 9301 + 49297) % 233280 || 7; const r = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  const P = [['#e07a5f', '#3d405b', '#81b29a', '#f2cc8f', '#f4f1de'], ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51'], ['#0b132b', '#1c2541', '#3a506b', '#5bc0be', '#f6f7eb'],
    ['#582f0e', '#7f4f24', '#936639', '#a68a64', '#ede0d4'], ['#ffcdb2', '#ffb4a2', '#e5989b', '#b5838d', '#6d6875'], ['#1d3557', '#457b9d', '#a8dadc', '#f1faee', '#e63946']];
  const pal = P[Math.floor(r() * P.length)];
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; artCache[key] = tex;
  if (img) { const im = new Image(); im.onload = () => { const k = Math.max(W / im.width, H / im.height); g.drawImage(im, (W - im.width * k) / 2, (H - im.height * k) / 2, im.width * k, im.height * k); tex.needsUpdate = true; }; im.src = img; g.fillStyle = '#ddd'; g.fillRect(0, 0, W, H); return tex; }
  if (style === 'landscape') {
    const sky = g.createLinearGradient(0, 0, 0, H * 0.6); sky.addColorStop(0, '#8fb8d8'); sky.addColorStop(1, '#f3d9b1'); g.fillStyle = sky; g.fillRect(0, 0, W, H);
    g.fillStyle = '#fff3d6'; g.beginPath(); g.arc(W * (0.2 + r() * 0.6), H * (0.2 + r() * 0.15), W * 0.07, 0, 7); g.fill();
    const layers = ['#7c8fa3', '#5f7186', '#46566a', '#2f3d4d'];
    layers.forEach((col, i) => { g.fillStyle = col; g.beginPath(); g.moveTo(0, H); let y = H * (0.42 + i * 0.1);
      for (let x = 0; x <= W; x += 16) { y += (r() - 0.5) * 30; y = Math.max(H * (0.25 + i * 0.08), Math.min(H * (0.62 + i * 0.08), y)); g.lineTo(x, y); } g.lineTo(W, H); g.fill(); });
    g.fillStyle = 'rgba(160,190,210,.55)'; g.fillRect(0, H * 0.82, W, H * 0.18);
  } else if (style === 'geometric') {
    g.fillStyle = '#f4efe4'; g.fillRect(0, 0, W, H); const n = 3 + (r() * 2 | 0), cw = W / n, ch = H / Math.max(2, Math.round(n / ratio));
    for (let x = 0; x < W; x += cw) for (let y = 0; y < H; y += ch) { g.fillStyle = pal[r() * pal.length | 0]; const t = r() * 4 | 0; g.beginPath();
      if (t === 0) g.rect(x, y, cw, ch); else if (t === 1) { g.moveTo(x, y); g.lineTo(x + cw, y); g.lineTo(x, y + ch); } else if (t === 2) g.arc(x + cw / 2, y + ch / 2, Math.min(cw, ch) * 0.42, 0, 7); else { g.arc(x, y + ch, Math.min(cw, ch), -Math.PI / 2, 0); g.lineTo(x, y + ch); } g.fill(); }
  } else if (style === 'botanical') {
    g.fillStyle = '#efe9dc'; g.fillRect(0, 0, W, H); const stems = 3 + (r() * 3 | 0);
    for (let k = 0; k < stems; k++) { const x0 = W * (0.2 + r() * 0.6), y0 = H * 0.95, x1 = x0 + (r() - 0.5) * W * 0.4, y1 = H * (0.1 + r() * 0.3), col = ['#4f7a52', '#6c8f5e', '#3f6b57', '#88a36c'][k % 4];
      g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2 + (r() - 0.5) * 80, (y0 + y1) / 2, x1, y1); g.stroke();
      for (let q = 0.15; q < 1; q += 0.12) { const x = x0 + (x1 - x0) * q, y = y0 + (y1 - y0) * q, sgn = (q * 100 | 0) % 2 ? 1 : -1; g.fillStyle = col; g.save(); g.translate(x, y); g.rotate(sgn * (0.7 + r() * 0.4) - 0.3); g.beginPath(); g.ellipse(sgn * 22, 0, 24, 9, 0, 0, 7); g.fill(); g.restore(); } }
  } else if (style === 'colorfield') {
    const c0 = pal[r() * pal.length | 0]; g.fillStyle = c0; g.fillRect(0, 0, W, H); const bands = 2 + (r() * 2 | 0);
    for (let k = 0; k < bands; k++) { g.fillStyle = pal[(k + 1 + (r() * 3 | 0)) % pal.length]; g.globalAlpha = 0.9; g.fillRect(W * 0.08, H * (0.07 + k * 0.86 / bands), W * 0.84, H * (0.86 / bands - 0.04)); }
    g.globalAlpha = 1;
  } else { // abstract
    g.fillStyle = pal[4]; g.fillRect(0, 0, W, H);
    for (let k = 0; k < 9; k++) { g.fillStyle = pal[r() * 4 | 0]; g.globalAlpha = 0.75 + r() * 0.25; g.beginPath(); if (r() < 0.5) g.arc(r() * W, r() * H, 30 + r() * 140, 0, 7); else g.rect(r() * W - 60, r() * H - 60, 60 + r() * 260, 20 + r() * 120); g.fill(); }
    g.globalAlpha = 1; g.strokeStyle = pal[(r() * 4) | 0]; g.lineWidth = 6 + r() * 10; g.lineCap = 'round'; g.beginPath(); g.moveTo(r() * W, r() * H); g.bezierCurveTo(r() * W, r() * H, r() * W, r() * H, r() * W, r() * H); g.stroke();
  }
  g.strokeStyle = 'rgba(0,0,0,.06)'; for (let i = 0; i < 1400; i++) { g.beginPath(); const x = r() * W, y = r() * H; g.moveTo(x, y); g.lineTo(x + 3, y + 1); g.stroke(); }   // canvas weave
  tex.needsUpdate = true; return tex;
}

/* ------------------------------------------------------------------ materials */
const S = (color, roughness = 0.6, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
const M = {
  wall: S(0xf3f0e9, 0.92), cap: S(0x2b3138, 0.8), slab: S(0x8e8a83, 0.95),
  oak: S(0xb98a5a, 0.55), walnut: S(0x6e4a33, 0.5), lacquer: S(0xf1efe9, 0.28), sage: S(0x8ea590, 0.35), sageLight: S(0xa9bca9, 0.35),
  fabricBlue: S(0x3f6c79, 0.95), fabricBlue2: S(0x4b7d8b, 0.95), fabricSand: S(0xcbb999, 0.95), fabricSand2: S(0xd8c9ad, 0.95),
  linen: S(0xf4f1ea, 0.9), duvet: S(0xe2dccf, 0.9), terracotta: S(0xb9603f, 0.85), mustard: S(0xd2a23c, 0.9),
  chrome: S(0xd8dcdf, 0.18, 1), steel: S(0xb9bdc1, 0.32, 0.85), blackMetal: S(0x26282b, 0.45, 0.6), brass: S(0xc9a24f, 0.3, 1),
  ceramic: S(0xf7f7f4, 0.12), granite: S(0x34363a, 0.3), darkGlass: S(0x1b2228, 0.08, 0.2), appliance: S(0xeeeeec, 0.3),
  mirror: S(0xffffff, 0.02, 1), pot: S(0xb5653f, 0.85), leaf: S(0x4f8a4b, 0.8, 0, { flatShading: true }), leaf2: S(0x3f7640, 0.8, 0, { flatShading: true }),
  frame: S(0x3a4047, 0.4, 0.5), sill: S(0xe9e5dc, 0.5), doorWood: S(0xd9c3a2, 0.5), handle: S(0xa9adb1, 0.25, 1),
  wicker: S(0xb59362, 0.95), screen: S(0x111417, 0.15, 0.3),
  glass: new THREE.MeshStandardMaterial({ color: 0xbfe0ee, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
  hob: S(0x15171a, 0.15), stair: S(0xc29466, 0.5)
};
const bulbMats = [];
const glowMat = () => { const m = S(0xfff3dc, 0.6, 0, { emissive: 0xffd9a0, emissiveIntensity: 0.5 }); bulbMats.push(m); return m; };
const shadeMat = glowMat();
const BOOKS = [0x8c3b3b, 0x2f5d7c, 0xd2a23c, 0x3f6e4b, 0xe7e1d4, 0x5a4a7a, 0xc0623f, 0x1f2a33].map(c => S(c, 0.8));

/* ------------------------------------------------------------------ mesh helpers (metres, y = bottom) */
function mk(geo, mat, x, y, z, parent, shadow = true) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
  m.castShadow = shadow; m.receiveShadow = true; parent && parent.add(m); return m;
}
const B = (g, w, h, d, mat, x = 0, y = 0, z = 0) => mk(new THREE.BoxGeometry(w, h, d), mat, x, y + h / 2, z, g);
const Cy = (g, rt, rb, h, seg, mat, x = 0, y = 0, z = 0) => mk(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y + h / 2, z, g);
const legs = (g, w, d, h, mat, s = 0.045, inset = 0.04) => { for (const sx of [-1, 1]) for (const sz of [-1, 1]) B(g, s, h, s, mat, sx * (w / 2 - inset), 0, sz * (d / 2 - inset)); };

/* ------------------------------------------------------------------ low-poly furniture (front faces +Z) */
const F = {
  bed(g, w, d) {
    B(g, w, 0.26, d, M.walnut, 0, 0.1, 0); legs(g, w, d, 0.1, M.blackMetal, 0.06, 0.06);
    B(g, w - 0.06, 0.2, d - 0.1, M.linen, 0, 0.36, 0.03);
    B(g, w - 0.02, 0.06, d * 0.64, M.duvet, 0, 0.56, d / 2 - d * 0.32 - 0.01);
    B(g, w + 0.01, 0.065, 0.3, M.terracotta, 0, 0.565, d / 2 - 0.36);
    const n = w > 1.25 ? 2 : 1, pw = (w - 0.16) / n;
    for (let i = 0; i < n; i++) B(g, pw - 0.06, 0.13, 0.34, M.linen, -w / 2 + 0.08 + pw * (i + 0.5), 0.56, -d / 2 + 0.3);
    B(g, w + 0.06, 0.95, 0.08, M.walnut, 0, 0.1, -d / 2 + 0.04);
  },
  nightstand(g, w, d) {
    B(g, w, 0.5, d, M.oak); B(g, w * 0.8, 0.015, 0.01, M.blackMetal, 0, 0.32, d / 2);
    Cy(g, 0.06, 0.08, 0.04, 10, M.brass, 0, 0.5, 0); Cy(g, 0.012, 0.012, 0.25, 6, M.brass, 0, 0.54, 0);
    mk(new THREE.CylinderGeometry(0.09, 0.13, 0.17, 12, 1, true), shadeMat, 0, 0.84, 0, g, false);
  },
  wardrobe(g, w, d) {
    B(g, w, 0.08, d - 0.04, M.cap, 0, 0, -0.02); B(g, w, 2.02, d, M.lacquer, 0, 0.08, 0);
    B(g, 0.008, 1.95, 0.01, M.frame, 0, 0.11, d / 2);
    for (const s of [-1, 1]) B(g, 0.025, 0.4, 0.03, M.brass, s * 0.05, 0.95, d / 2 + 0.015);
  },
  desk(g, w, d) {
    B(g, w, 0.035, d, M.oak, 0, 0.72, 0); legs(g, w, d, 0.72, M.blackMetal, 0.035, 0.03);
    B(g, 0.32, 0.22, 0.02, M.screen, 0.05, 0.85, -d / 2 + 0.1); B(g, 0.04, 0.12, 0.04, M.blackMetal, 0.05, 0.755, -d / 2 + 0.1);
    Cy(g, 0.05, 0.06, 0.12, 8, M.pot, -w / 2 + 0.12, 0.755, 0);
    mk(new THREE.IcosahedronGeometry(0.08, 0), M.leaf, -w / 2 + 0.12, 0.93, 0, g);
  },
  table(g, w, d) { B(g, w, 0.04, d, M.oak, 0, 0.72, 0); legs(g, w, d, 0.72, M.walnut, 0.05, 0.06);
    Cy(g, 0.05, 0.04, 0.16, 8, M.ceramic, 0, 0.76, 0); mk(new THREE.IcosahedronGeometry(0.07, 0), M.mustard, 0, 0.98, 0, g); },
  roundTable(g, w) {
    Cy(g, w / 2, w / 2, 0.04, 28, M.oak, 0, 0.72, 0); Cy(g, 0.06, 0.06, 0.7, 10, M.blackMetal, 0, 0.03, 0);
    Cy(g, 0.26, 0.3, 0.03, 16, M.blackMetal, 0, 0, 0);
    Cy(g, 0.12, 0.1, 0.06, 12, M.ceramic, 0.15, 0.76, -0.1);
    for (let i = 0; i < 3; i++) mk(new THREE.IcosahedronGeometry(0.04, 0), [M.mustard, M.terracotta, M.leaf][i], 0.13 + i * 0.03, 0.83, -0.12 + (i % 2) * 0.04, g);
  },
  chair(g, w, d) {
    B(g, w, 0.04, d, M.oak, 0, 0.43, 0); legs(g, w, d, 0.43, M.oak, 0.035, 0.03);
    B(g, w - 0.05, 0.03, d - 0.07, M.fabricSand, 0, 0.47, 0.02);
    for (const s of [-1, 1]) B(g, 0.035, 0.42, 0.035, M.oak, s * (w / 2 - 0.03), 0.47, -d / 2 + 0.03);
    B(g, w, 0.16, 0.03, M.oak, 0, 0.72, -d / 2 + 0.03);
  },
  sofa(g, w, d, o) {
    const a = o.color === 'sand' ? M.fabricSand : M.fabricBlue, b = o.color === 'sand' ? M.fabricSand2 : M.fabricBlue2;
    legs(g, w, d, 0.08, M.walnut, 0.05, 0.08);
    B(g, w, 0.22, d, a, 0, 0.08, 0);
    B(g, w, 0.48, 0.2, a, 0, 0.3, -d / 2 + 0.1);
    for (const s of [-1, 1]) B(g, 0.16, 0.3, d, a, s * (w / 2 - 0.08), 0.3, 0);
    const n = w > 1.9 ? 3 : 2, cw = (w - 0.32) / n;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + 0.16 + cw * (i + 0.5);
      B(g, cw - 0.02, 0.15, d - 0.24, b, x, 0.3, 0.1);
      B(g, cw - 0.05, 0.36, 0.13, b, x, 0.42, -d / 2 + 0.26);
    }
    const p = B(g, 0.34, 0.3, 0.1, M.mustard, -w / 2 + 0.34, 0.45, -d / 2 + 0.36); p.rotation.z = 0.2;
  },
  coffeeTable(g, w, d) {
    B(g, w, 0.04, d, M.walnut, 0, 0.38, 0); legs(g, w, d, 0.38, M.walnut, 0.04, 0.05);
    B(g, w - 0.1, 0.02, d - 0.1, M.walnut, 0, 0.1, 0);
    B(g, 0.24, 0.04, 0.17, BOOKS[1], -0.15, 0.42, 0); B(g, 0.2, 0.03, 0.15, BOOKS[4], -0.15, 0.46, 0);
    Cy(g, 0.05, 0.06, 0.14, 10, M.ceramic, 0.18, 0.42, 0.02);
  },
  rug(g, w, d, o) {
    const mat = o.round ? rugMats.round : rugMats.rect;
    if (o.round) mk(new THREE.CylinderGeometry(w / 2, w / 2, 0.012, 40), mat, 0, 0.006, 0, g, false);
    else mk(new THREE.BoxGeometry(w, 0.012, d), mat, 0, 0.006, 0, g, false);
  },
  bookshelf(g, w, d) {
    const H = 1.9;
    for (const s of [-1, 1]) B(g, 0.03, H, d, M.oak, s * (w / 2 - 0.015), 0, 0);
    B(g, w, H, 0.02, M.oak, 0, 0, -d / 2 + 0.01);
    const shelves = 5;
    for (let i = 0; i <= shelves; i++) B(g, w - 0.06, 0.025, d - 0.02, M.oak, 0, i * (H - 0.025) / shelves, 0.01);
    for (let i = 0; i < shelves; i++) {
      let x = -w / 2 + 0.05; const y0 = i * (H - 0.025) / shelves + 0.025;
      while (x < w / 2 - 0.1) {
        const bw = 0.025 + rnd() * 0.03, bh = 0.17 + rnd() * 0.12;
        if (rnd() < 0.12) { x += 0.06; continue; }
        B(g, bw, bh, d * 0.7, BOOKS[(rnd() * BOOKS.length) | 0], x + bw / 2, y0, 0.02); x += bw + 0.004;
      }
    }
  },
  tvUnit(g, w, d) {
    B(g, w, 0.45, d, M.walnut, 0, 0.06, 0); legs(g, w, d, 0.06, M.blackMetal, 0.03, 0.05);
    for (const s of [-1, 1]) B(g, w / 2 - 0.02, 0.4, 0.01, M.oak, s * w / 4, 0.085, d / 2);
    B(g, 1.0, 0.58, 0.04, M.screen, 0, 0.62, -0.02); B(g, 0.3, 0.02, 0.18, M.blackMetal, 0, 0.51, -0.02); B(g, 0.06, 0.1, 0.03, M.blackMetal, 0, 0.53, -0.02);
  },
  plant(g, w) {
    Cy(g, w * 0.36, w * 0.28, 0.32, 10, M.pot, 0, 0, 0);
    const blobs = [[0, 0.6, 0, 0.26], [0.1, 0.82, 0.05, 0.2], [-0.1, 0.76, -0.06, 0.2], [0.02, 1.0, -0.02, 0.15]];
    for (const [x, y, z, r] of blobs) mk(new THREE.IcosahedronGeometry(r * (w / 0.5) * 0.9, 0), rnd() < 0.5 ? M.leaf : M.leaf2, x, y, z, g);
    Cy(g, 0.015, 0.02, 0.3, 5, M.walnut, 0, 0.3, 0);
  },
  floorLamp(g) {
    Cy(g, 0.14, 0.16, 0.03, 14, M.blackMetal); Cy(g, 0.014, 0.014, 1.45, 6, M.blackMetal, 0, 0.03, 0);
    mk(new THREE.CylinderGeometry(0.14, 0.2, 0.26, 14, 1, true), shadeMat, 0, 1.5, 0, g, false);
  },
  counter(g, w, d, o) {
    B(g, w, 0.1, d - 0.08, M.cap, 0, 0, -0.04);
    B(g, w, 0.76, d - 0.03, M.sage, 0, 0.1, -0.015);
    const n = Math.max(1, Math.round(w / 0.6));
    for (let i = 1; i < n; i++) B(g, 0.006, 0.74, 0.006, M.frame, -w / 2 + i * w / n, 0.11, d / 2 - 0.015);
    for (let i = 0; i < n; i++) B(g, 0.14, 0.014, 0.02, M.steel, -w / 2 + (i + 0.5) * w / n, 0.78, d / 2);
    B(g, w + 0.02, 0.04, d + 0.01, M.granite, 0, 0.86, 0);
    if (o.sink != null) {
      const sx = -w / 2 + w * o.sink;
      B(g, 0.5, 0.006, 0.4, M.steel, sx, 0.9, 0.02); B(g, 0.43, 0.007, 0.33, M.darkGlass, sx, 0.9, 0.02);
      Cy(g, 0.016, 0.02, 0.3, 8, M.chrome, sx, 0.9, -d / 2 + 0.08); B(g, 0.022, 0.022, 0.2, M.chrome, sx, 1.18, -d / 2 + 0.17);
    }
    if (o.hob != null) {
      const hx = -w / 2 + w * o.hob;
      B(g, 0.58, 0.008, 0.5, M.hob, hx, 0.9, 0.02);
      for (const [a, b] of [[-0.13, -0.11], [0.13, -0.11], [-0.13, 0.13], [0.13, 0.13]]) mk(new THREE.TorusGeometry(0.08, 0.006, 4, 20), M.steel, hx + a, 0.91, b, g, false).rotation.x = Math.PI / 2;
      B(g, 0.6, 0.12, 0.42, M.steel, hx, 1.42, -d / 2 + 0.21);
    }
    B(g, w, 0.7, 0.34, M.sageLight, 0, 1.55, -d / 2 + 0.17);
    for (let i = 1; i < n; i++) B(g, 0.006, 0.66, 0.006, M.frame, -w / 2 + i * w / n, 1.57, -d / 2 + 0.345);
  },
  fridge(g, w, d) {
    B(g, w, 1.86, d, M.steel); B(g, w + 0.002, 0.01, 0.01, M.frame, 0, 1.2, d / 2);
    B(g, 0.025, 0.4, 0.03, M.blackMetal, w / 2 - 0.07, 1.32, d / 2 + 0.015); B(g, 0.025, 0.6, 0.03, M.blackMetal, w / 2 - 0.07, 0.45, d / 2 + 0.015);
  },
  washer(g, w, d, o) {
    B(g, w, 0.85, d, M.appliance);
    const door = mk(new THREE.TorusGeometry(0.19, 0.03, 8, 24), M.chrome, 0, 0.4, d / 2 + 0.01, g); door.castShadow = false;
    mk(new THREE.CircleGeometry(0.17, 24), o.dryer ? M.darkGlass : S(0x2a3e4a, 0.05, 0.2), 0, 0.4, d / 2 + 0.006, g, false);
    B(g, w, 0.1, 0.012, S(0xd8d8d4, 0.4), 0, 0.73, d / 2);
    Cy(g, 0.03, 0.03, 0.02, 12, M.chrome, w / 2 - 0.12, 0.76, d / 2 + 0.01).rotation.x = Math.PI / 2;
  },
  shelf(g, w, d, o) {
    const h = o.h || 1.5;
    B(g, w, 0.03, d, M.oak, 0, h, 0);
    for (let i = 0; i < 4; i++) Cy(g, 0.05, 0.05, 0.16 + (i % 2) * 0.06, 10, [M.ceramic, M.terracotta, M.sageLight, M.mustard][i], -w / 2 + 0.15 + i * (w - 0.3) / 3, h + 0.03, 0);
  },
  basket(g, w) { Cy(g, w / 2, w * 0.42, 0.4, 10, M.wicker); B(g, w * 0.6, 0.06, w * 0.5, M.linen, 0, 0.38, 0).rotation.y = 0.4; },
  bathtub(g, w, d) {
    const h = 0.56, t = 0.08;
    B(g, w, 0.06, d, M.ceramic);
    B(g, w, h, t, M.ceramic, 0, 0, d / 2 - t / 2); B(g, w, h, t, M.ceramic, 0, 0, -d / 2 + t / 2);
    B(g, t, h, d, M.ceramic, w / 2 - t / 2, 0, 0); B(g, t, h, d, M.ceramic, -w / 2 + t / 2, 0, 0);
    mk(new THREE.BoxGeometry(w - 2 * t, 0.005, d - 2 * t), S(0x9ccbd8, 0.05, 0, { transparent: true, opacity: 0.5 }), 0, 0.32, 0, g, false);
    Cy(g, 0.02, 0.02, 0.18, 8, M.chrome, -w / 2 + 0.06, h, -d / 2 + 0.04); B(g, 0.14, 0.025, 0.025, M.chrome, -w / 2 + 0.11, h + 0.16, -d / 2 + 0.04);
  },
  basin(g, w, d) {
    B(g, w, 0.4, d, M.walnut, 0, 0.42, 0);
    B(g, w + 0.02, 0.03, d + 0.01, M.ceramic, 0, 0.82, 0);
    Cy(g, 0.19, 0.15, 0.13, 18, M.ceramic, 0, 0.85, 0.02);
    Cy(g, 0.15, 0.15, 0.002, 18, S(0xdfe3e5, 0.1), 0, 0.976, 0.02);
    Cy(g, 0.014, 0.016, 0.2, 8, M.chrome, 0, 0.85, -d / 2 + 0.05); B(g, 0.018, 0.018, 0.1, M.chrome, 0, 1.04, -d / 2 + 0.1);
    B(g, w * 0.85, 0.7, 0.02, M.mirror, 0, 1.15, -d / 2 + 0.01);
  },
  toilet(g, w, d) {
    const base = Cy(g, 0.13, 0.11, 0.38, 14, M.ceramic, 0, 0, 0.06); base.scale.z = 1.35;
    const seat = Cy(g, 0.18, 0.18, 0.04, 16, M.ceramic, 0, 0.38, 0.07); seat.scale.z = 1.3;
    B(g, w * 0.95, 0.36, 0.17, M.ceramic, 0, 0.4, -d / 2 + 0.085);
    B(g, w * 0.95 + 0.02, 0.03, 0.19, M.ceramic, 0, 0.76, -d / 2 + 0.085);
    Cy(g, 0.025, 0.025, 0.01, 10, M.chrome, 0, 0.79, -d / 2 + 0.085);
  },
  shower(g, w, d) {
    B(g, w, 0.06, d, M.ceramic); Cy(g, 0.04, 0.04, 0.004, 10, M.chrome, 0, 0.06, 0);
    mk(new THREE.BoxGeometry(w * 0.55, 1.95, 0.012), M.glass, w / 2 - w * 0.275, 1.035, d / 2 - 0.006, g, false);
    mk(new THREE.BoxGeometry(0.012, 1.95, d), M.glass, w / 2 - 0.006, 1.035, 0, g, false);
    B(g, w * 0.55, 0.02, 0.02, M.chrome, w / 2 - w * 0.275, 2.01, d / 2 - 0.006); B(g, 0.02, 0.02, d, M.chrome, w / 2 - 0.006, 2.01, 0);
    B(g, 0.02, 1.0, 0.02, M.chrome, 0, 1.1, -d / 2 + 0.04); B(g, 0.02, 0.02, 0.2, M.chrome, 0, 2.08, -d / 2 + 0.13);
    Cy(g, 0.1, 0.1, 0.02, 16, M.chrome, 0, 2.05, -d / 2 + 0.24);
    B(g, 0.12, 0.08, 0.03, M.chrome, 0, 1.05, -d / 2 + 0.03);
  }
};
F.painting = (g, w, d, o) => {
  const ht = o.ht || 0.7, elev = o.elev || 1.5, fr = 0.035, frameMat = o.frame === 'black' ? M.blackMetal : o.frame === 'white' ? M.lacquer : o.frame === 'gold' ? M.brass : M.walnut;
  const y0 = elev - ht / 2, dz = -d / 2 + 0.02;
  B(g, w, fr, 0.04, frameMat, 0, y0, dz); B(g, w, fr, 0.04, frameMat, 0, y0 + ht - fr, dz);
  B(g, fr, ht, 0.04, frameMat, -w / 2 + fr / 2, y0, dz); B(g, fr, ht, 0.04, frameMat, w / 2 - fr / 2, y0, dz);
  const mat = new THREE.MeshStandardMaterial({ map: artTexture(o.art || 'abstract', o.seed || 1, w / ht, o.img), roughness: 0.75 });
  const pic = mk(new THREE.PlaneGeometry(w - 2 * fr, ht - 2 * fr), mat, 0, y0 + ht / 2, dz + 0.012, g, false); pic.castShadow = false;
  B(g, w - 2 * fr, ht - 2 * fr, 0.01, M.linen, 0, y0 + fr, dz - 0.008);
};
const rugMats = {
  rect: new THREE.MeshStandardMaterial({ map: rugTex('#a96e55', '#e7d7bd'), roughness: 1 }),
  round: new THREE.MeshStandardMaterial({ map: rugTex('#4d6f7a', '#d6c8ab', true), roughness: 1 })
};

/* ------------------------------------------------------------------ build the flat from a layout */
let layout = null, flat = null, built = null;
const state = { cut: false, night: false, labels: true, overlay: false, furniture: true, doorsOpen: true, hour: 14, walk: false };
const labelsEl = document.getElementById('labels');

function disposeTree(o) { o.traverse(n => { if (n.geometry) n.geometry.dispose(); }); }

function computeBounds(L) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = r => { x0 = Math.min(x0, r[0]); y0 = Math.min(y0, r[1]); x1 = Math.max(x1, r[2]); y1 = Math.max(y1, r[3]); };
  (L.walls || []).forEach(add); (L.rooms || []).forEach(r => (r.rects || []).forEach(add)); (L.floors || []).forEach(f => add(f.rect || f));
  if (!isFinite(x0)) { x0 = 0; y0 = 0; x1 = 800; y1 = 800; }
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

function build(L) {
  if (flat) { scene.remove(flat); disposeTree(flat); }
  labelsEl.innerHTML = '';
  flat = new THREE.Group(); scene.add(flat);
  const s = L.scale || 0.0125, H = L.wallHeight || 2.6, cap = state.cut ? 1.15 : H;
  const bd = computeBounds(L);
  const P = (x, y) => [(x - bd.cx) * s, (y - bd.cy) * s];
  const wallMats = [M.wall, M.wall, M.cap, M.wall, M.wall, M.wall];
  const groups = { fixtures: new THREE.Group(), furniture: new THREE.Group(), doors: new THREE.Group(), lights: new THREE.Group() };
  for (const k in groups) flat.add(groups[k]);

  // rect between heights z0..z1 (clamped by cutaway)
  const prism = (r, z0, z1, mats, parent = flat, capTop = true) => {
    z1 = Math.min(z1, cap); if (z1 - z0 < 0.002) return null;
    const [ax, az] = P(r[0], r[1]), [bx, bz] = P(r[2], r[3]);
    const m = mk(new THREE.BoxGeometry(Math.max(bx - ax, 0.005), z1 - z0, Math.max(bz - az, 0.005)), mats, (ax + bx) / 2, (z0 + z1) / 2, (az + bz) / 2, parent);
    if (capTop && z1 >= cap - 1e-6 && Array.isArray(mats)) m.material = wallMats; return m;
  };

  // floors + slab
  const floorRects = [];
  (L.rooms || []).forEach(rm => (rm.rects || []).forEach(r => floorRects.push({ r, floor: rm.floor || 'oak' })));
  (L.floors || []).forEach(f => floorRects.push({ r: f.rect || f, floor: f.floor || 'oak' }));
  for (const { r, floor } of floorRects) {
    const [ax, az] = P(r[0], r[1]), [bx, bz] = P(r[2], r[3]); const w = bx - ax, d = bz - az;
    const mat = floorMats[floor] || floorMats.oak, m = FLOORS[floor] ? FLOORS[floor].map.userData.m : 1.6;
    const geo = new THREE.PlaneGeometry(w, d); const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w + ax) / m, (uv.getY(i) * d - bz) / m);
    const f = mk(geo, mat, (ax + bx) / 2, 0.001, (az + bz) / 2, flat, false); f.rotation.x = -Math.PI / 2;
    mk(new THREE.BoxGeometry(w, 0.25, d), M.slab, (ax + bx) / 2, -0.125, (az + bz) / 2, flat, false);
  }

  // walls
  M.wall.color.set(L.wallColor || '#f3f0e9');
  (L.walls || []).forEach(r => prism(r, 0, H, wallMats));
  paintWalls(L, P, s, H, cap, flat);

  // windows
  (L.windows || []).forEach(r0 => {
    const r = r0.rect || r0, sill = r0.sill ?? 0.9, head = r0.head ?? 2.1;
    prism(r, 0, sill, wallMats); prism(r, head, H, wallMats);
    const [ax, az] = P(r[0], r[1]), [bx, bz] = P(r[2], r[3]);
    const horiz = (bx - ax) >= (bz - az), Lm = horiz ? bx - ax : bz - az, T = horiz ? bz - az : bx - ax;
    const g = new THREE.Group(); g.position.set((ax + bx) / 2, 0, (az + bz) / 2); if (!horiz) g.rotation.y = Math.PI / 2;
    groups.fixtures.add(g);
    const top = Math.min(head, cap); if (top <= sill) { B(g, Lm, 0.03, T + 0.06, M.sill, 0, Math.min(sill, cap) - 0.03, 0); return; }
    const fw = 0.05, h = top - sill;
    B(g, Lm, 0.03, T + 0.08, M.sill, 0, sill - 0.03, 0);
    B(g, fw, h, 0.07, M.frame, -Lm / 2 + fw / 2, sill, 0); B(g, fw, h, 0.07, M.frame, Lm / 2 - fw / 2, sill, 0);
    B(g, Lm, fw, 0.07, M.frame, 0, sill, 0); if (top >= head) B(g, Lm, fw, 0.07, M.frame, 0, top - fw, 0);
    if (Lm > 0.9) B(g, 0.035, h, 0.06, M.frame, 0, sill, 0);
    mk(new THREE.BoxGeometry(Lm - 2 * fw, h, 0.01), M.glass, 0, sill + h / 2, 0, g, false);
  });

  // doors
  (L.doors || []).forEach(dr => {
    const r = dr.rect || dr, dh = Math.min(2.05, H - 0.1);
    prism(r, dh + 0.05, H, wallMats);
    const [ax, az] = P(r[0], r[1]), [bx, bz] = P(r[2], r[3]);
    const horiz = (bx - ax) >= (bz - az), Lm = horiz ? bx - ax : bz - az, T = horiz ? bz - az : bx - ax;
    const g = new THREE.Group(); g.position.set((ax + bx) / 2, 0, (az + bz) / 2); if (!horiz) g.rotation.y = -Math.PI / 2;
    groups.doors.add(g);
    const lh = Math.min(dh, cap);
    for (const sx of [-1, 1]) B(g, 0.04, lh, T + 0.03, M.lacquer, sx * (Lm / 2 - 0.02), 0, 0);
    if (dh + 0.05 <= cap) B(g, Lm, 0.05, T + 0.03, M.lacquer, 0, dh, 0);
    const swingLocal = (horiz ? 1 : -1) * (dr.swing || 1);
    const hinges = dr.hinge === 'both' ? ['start', 'end'] : [dr.hinge || 'start'];
    const leafLen = (Lm - 0.08) / hinges.length - 0.005;
    for (const hg of hinges) {
      const dirx = hg === 'start' ? 1 : -1, hx = hg === 'start' ? -Lm / 2 + 0.04 : Lm / 2 - 0.04;
      const pivot = new THREE.Group(); pivot.position.set(hx, 0, swingLocal * (T / 2 - 0.02)); g.add(pivot);
      pivot.userData = { dirx, sz: swingLocal, open: (dr.open ?? 80) * Math.PI / 180 };
      const leaf = new THREE.Group(); pivot.add(leaf);
      const lw = 0.04, h = Math.min(dh - 0.01, cap);
      if (dr.style === 'glass') {
        const st = 0.07;
        B(leaf, st, h, lw, M.doorWood, st / 2, 0.005, 0); B(leaf, st, h, lw, M.doorWood, leafLen - st / 2, 0.005, 0);
        B(leaf, leafLen, 0.12, lw, M.doorWood, leafLen / 2, 0.005, 0); if (h > 1.9) B(leaf, leafLen, st, lw, M.doorWood, leafLen / 2, h - st + 0.005, 0);
        if (h > 1.1) B(leaf, leafLen, 0.05, lw, M.doorWood, leafLen / 2, 1.0, 0);
        mk(new THREE.BoxGeometry(leafLen - 2 * st, h - 0.2, 0.008), M.glass, leafLen / 2, h / 2 + 0.06, 0, leaf, false);
      } else {
        B(leaf, leafLen, h, lw, M.doorWood, leafLen / 2, 0.005, 0);
        for (const yy of [0.2, 1.15]) if (yy + 0.75 < h) for (const sz of [-1, 1]) B(leaf, leafLen - 0.24, 0.75, 0.006, M.lacquer, leafLen / 2, yy, sz * (lw / 2 + 0.002));
      }
      if (h > 1.05) for (const sz of [-1, 1]) B(leaf, 0.12, 0.02, 0.02, M.handle, leafLen - 0.1, 1.0, sz * 0.035);
    }
  });

  // stairs
  (L.stairs || []).forEach(st => {
    const rise = st.rise || 0.18;
    st.steps.forEach((r, i) => {
      const top = Math.min((i + 1) * rise, cap);
      prism(r, 0, top - 0.03, M.wall, flat, false);
      prism(r, top - 0.03, top, M.stair, flat, false);
    });
  });

  // furniture
  (L.furniture || []).forEach(f => {
    const fn = F[f.type]; if (!fn) return;
    if (f.type === 'painting' && (f.elev || 1.5) - (f.ht || 0.7) / 2 > cap - 0.05) return;   // above the cutaway line
    const g = new THREE.Group(); const [x, z] = P(f.x, f.y);
    g.position.set(x, 0, z); g.rotation.y = (f.rot || 0) * Math.PI / 180;
    fn(g, (f.w || 50) * s, (f.d || f.w || 50) * s, f);
    groups.furniture.add(g);
  });

  // lights: pendant fixture + point light
  const pts = [];
  (L.lights || []).forEach(l => {
    const [x, z] = P(l.at[0], l.at[1]), y = l.h || Math.min(2.25, H - 0.3);
    const pl = new THREE.PointLight(l.color ? new THREE.Color(l.color) : 0xffd6a0, 1, 9, 2);
    pl.position.set(x, y - 0.12, z); groups.lights.add(pl); pts.push(pl);
    const fx = new THREE.Group(); fx.position.set(x, 0, z); groups.lights.add(fx); fx.userData.fixture = true;
    Cy(fx, 0.006, 0.006, H - y, 4, M.blackMetal, 0, y, 0).castShadow = false;
    const sh = mk(new THREE.CylinderGeometry(0.06, 0.2, 0.18, 14, 1, true), M.blackMetal, 0, y - 0.09 + 0.09, 0, fx, false); sh.material = S(0x2d3a40, 0.5, 0.3, { side: THREE.DoubleSide });
    sh.position.y = y - 0.09;
    mk(new THREE.SphereGeometry(0.05, 10, 8), glowMatShared, 0, y - 0.14, 0, fx, false);
  });

  // plan overlay (image placed in plan coordinates)
  if (L.image && overlayTex) {
    const [ax, az] = P(0, 0), [bx, bz] = P(L.image.w, L.image.h);
    const ov = new THREE.Mesh(new THREE.PlaneGeometry(bx - ax, bz - az), new THREE.MeshBasicMaterial({ map: overlayTex, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }));
    ov.rotation.x = -Math.PI / 2; ov.position.set((ax + bx) / 2, Math.min(cap, H) + 0.02, (az + bz) / 2); ov.renderOrder = 5;
    ov.visible = state.overlay; flat.add(ov); groups.overlay = ov;
  }

  // labels
  const labels = [];
  (L.rooms || []).forEach((rm, i) => {
    const r = rm.rects && rm.rects[0]; if (!r) return;
    const at = rm.label || [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2]; const [x, z] = P(at[0], at[1]);
    const el = document.createElement('div'); el.className = 'lbl';
    el.innerHTML = `<b></b>${rm.area ? '<span></span>' : ''}`; el.querySelector('b').textContent = rm.name || `Room ${i + 1}`;
    if (rm.area) el.querySelector('span').textContent = rm.area;
    labelsEl.appendChild(el); labels.push({ el, pos: new THREE.Vector3(x, Math.min(cap, 1.6) + 0.3, z) });
  });

  const R = Math.hypot(bd.x1 - bd.x0, bd.y1 - bd.y0) * s / 2;
  built = { s, H, bd, P, R, groups, pts, labels };
  groups.furniture.visible = state.furniture;
  setDoors(state.doorsOpen, true);
  applyLighting();
  // sun shadow frustum fits the flat
  const sc = sun.shadow.camera; sc.left = -R * 1.2; sc.right = R * 1.2; sc.top = R * 1.2; sc.bottom = -R * 1.2; sc.near = 0.5; sc.far = R * 6; sc.updateProjectionMatrix();
  renderRooms();
}
const glowMatShared = glowMat();

/* doors open/close (animated) */
let doorAnim = null;
function setDoors(open, instant) {
  const pivots = []; built.groups.doors.traverse(n => { if (n.userData && n.userData.dirx) pivots.push(n); });
  const angle = (p, t) => { const o = p.userData.open * t, dx = p.userData.dirx * Math.cos(o), dz = p.userData.sz * Math.sin(o); return Math.atan2(-dz, dx); };
  if (instant) { pivots.forEach(p => p.rotation.y = angle(p, open ? 1 : 0)); return; }
  const from = open ? 0 : 1, to = open ? 1 : 0, t0 = performance.now();
  doorAnim = (now) => { const k = Math.min(1, (now - t0) / 900), e = k * k * (3 - 2 * k); pivots.forEach(p => p.rotation.y = angle(p, from + (to - from) * e)); if (k >= 1) doorAnim = null; };
}

/* paint: thin colour skins on each wall face that looks into a room with its own wall colour */
function paintWalls(L, P, s, H, cap, parent) {
  const rooms = L.rooms || []; if (!rooms.some(r => r.wall)) return;
  const solids = [...(L.walls || []), ...(L.windows || []).map(w => w.rect || w), ...(L.doors || []).map(d => d.rect || d)];
  const inSolid = (x, y) => solids.some(q => x > q[0] && x < q[2] && y > q[1] && y < q[3]);
  const roomAt = (x, y) => rooms.find(rm => (rm.rects || []).some(q => x >= q[0] && x <= q[2] && y >= q[1] && y <= q[3]));
  const pieces = [];
  (L.walls || []).forEach(r => pieces.push([r, 0, H]));
  (L.windows || []).forEach(w => { const r = w.rect || w; pieces.push([r, 0, w.sill ?? 0.9], [r, w.head ?? 2.1, H]); });
  (L.doors || []).forEach(d => pieces.push([d.rect || d, Math.min(2.05, H - 0.1) + 0.05, H]));
  const eps = 0.04 / s, off = 0.002;
  const cuts = []; rooms.forEach(rm => (rm.rects || []).forEach(q => cuts.push(q)));
  for (const [r, z0, z1r] of pieces) {
    const z1 = Math.min(z1r, cap); if (z1 - z0 < 0.01) continue;
    for (const side of ['N', 'S', 'W', 'E']) {
      const horiz = side === 'N' || side === 'S', a = horiz ? r[0] : r[1], b = horiz ? r[2] : r[3], c = side === 'N' ? r[1] : side === 'S' ? r[3] : side === 'W' ? r[0] : r[2];
      const nx = side === 'W' ? -1 : side === 'E' ? 1 : 0, ny = side === 'N' ? -1 : side === 'S' ? 1 : 0;
      const br = [a, b]; for (const q of cuts) for (const v of horiz ? [q[0], q[2]] : [q[1], q[3]]) if (v > a && v < b) br.push(v);
      for (const q of solids) for (const v of horiz ? [q[0], q[2]] : [q[1], q[3]]) if (v > a && v < b) br.push(v);
      br.sort((u, v) => u - v);
      for (let i = 0; i < br.length - 1; i++) {
        const u0 = br[i], u1 = br[i + 1]; if (u1 - u0 < 0.5) continue;
        const m = (u0 + u1) / 2, px = horiz ? m : c + nx * eps, py = horiz ? c + ny * eps : m;
        if (inSolid(px, py)) continue; const rm = roomAt(px, py); if (!rm || !rm.wall) continue;
        const [ax, az] = horiz ? P(u0, c) : P(c, u0), [bx, bz] = horiz ? P(u1, c) : P(c, u1), len = horiz ? bx - ax : bz - az;
        const pl = new THREE.Mesh(new THREE.PlaneGeometry(len, z1 - z0), paintMat(rm.wall));
        pl.position.set((ax + bx) / 2 + nx * off, (z0 + z1) / 2, (az + bz) / 2 + ny * off);
        pl.rotation.y = side === 'S' ? 0 : side === 'N' ? Math.PI : side === 'E' ? Math.PI / 2 : -Math.PI / 2;
        pl.receiveShadow = true; parent.add(pl);
      }
    }
  }
}

/* ------------------------------------------------------------------ lighting modes */
function applyLighting() {
  const night = state.night, R = built ? built.R : 6;
  document.body.classList.toggle('night', night);
  scene.background = new THREE.Color(night ? 0x0c1222 : 0xdfe6ec);
  hemi.color.set(night ? 0x3a4a7a : 0xe6efff); hemi.groundColor.set(night ? 0x1a1a22 : 0x9a8a74);
  hemi.intensity = night ? 0.18 : 1.0;
  // time of day: 6 h sunrise in the east (+x) … 20 h sunset in the west
  const hr = state.hour ?? 14, f = Math.min(1, Math.max(0, (hr - 6) / 14)), el = Math.max(0.08, Math.sin(f * Math.PI)) * 1.15, az = Math.PI * f;
  const warm = 1 - Math.min(1, Math.sin(f * Math.PI) * 1.6);
  const sunCol = new THREE.Color(0xfff0dc).lerp(new THREE.Color(0xffa055), warm);
  sun.color.copy(night ? new THREE.Color(0x9fb4ff) : sunCol); sun.intensity = night ? 0.25 : 2.6 * (0.55 + 0.45 * Math.min(1, el));
  const D = R * 3;
  sun.position.set(Math.cos(az) * D * Math.cos(el), Math.sin(el) * D, 0.55 * D * Math.cos(el));
  if (!night) scene.background = new THREE.Color(0xdfe6ec).lerp(new THREE.Color(0xf2d2b6), warm * 0.6);
  scene.environmentIntensity = night ? 0.06 : 0.55;
  groundMat.color.set(night ? 0x2a3328 : 0xc9d3bf);
  if (built) built.pts.forEach(p => { p.intensity = night ? 9 : 2.2; });
  bulbMats.forEach(m => m.emissiveIntensity = night ? 3.2 : 0.6);
  renderer.toneMappingExposure = night ? 1.25 : 1.0;
}

/* ------------------------------------------------------------------ camera: framing, fly-to, tour */
const tmpV = new THREE.Vector3();
function W3(p) { const [x, z] = built.P(p[0], p[1]); return new THREE.Vector3(x, p[2] ?? 0, z); }
function overviewPose() {
  const R = built.R, fov = camera.fov * Math.PI / 180, fit = Math.min(1, camera.aspect);
  const dist = R / Math.sin(fov / 2) / Math.max(fit, 0.55) * 0.72;
  const dir = new THREE.Vector3(0.45, 0.95, 0.85).normalize();
  return { pos: dir.multiplyScalar(dist), look: new THREE.Vector3(0, 0.2, 0) };
}
function topPose() {
  const R = built.R, fov = camera.fov * Math.PI / 180;
  return { pos: new THREE.Vector3(0, R / Math.tan(fov / 2) / Math.max(Math.min(1, camera.aspect), 0.55) * 1.05, 0.01), look: new THREE.Vector3(0, 0, 0) };
}
let fly = null;
function flyTo(pos, look, dur = 1600) {
  if (walk) stopWalk(true);
  stopTour(false);
  fly = { p0: camera.position.clone(), l0: controls.target.clone(), p1: pos.clone(), l1: look.clone(), t0: performance.now(), dur };
}
function roomPose(rm) {
  const s = built.s; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  rm.rects.forEach(r => { x0 = Math.min(x0, r[0]); y0 = Math.min(y0, r[1]); x1 = Math.max(x1, r[2]); y1 = Math.max(y1, r[3]); });
  const c = W3([(x0 + x1) / 2, (y0 + y1) / 2, 0.4]), size = Math.max(x1 - x0, y1 - y0) * s;
  tmpV.subVectors(camera.position, controls.target); tmpV.y = 0; if (tmpV.lengthSq() < 1e-4) tmpV.set(0, 0, 1); tmpV.normalize();
  const pos = c.clone().addScaledVector(tmpV, size * 0.75 + 1.2); pos.y = Math.max(built.H + 1.8, size * 1.05 + 2.4);
  return { pos, look: c };
}

let tour = null;
const tourBtn = document.getElementById('tourBtn'), tourProg = document.getElementById('tourProg');
function makeTourKeys() {
  const L = layout;
  if (L.tour && L.tour.length >= 3) return L.tour.map(k => ({ pos: W3(k.pos), look: W3(k.look) }));
  // auto tour: wide shots + hover over each room (or light cluster), then pull back
  const R = built.R, keys = [];
  keys.push({ pos: new THREE.Vector3(0, R * 1.4, R * 2.6), look: new THREE.Vector3() });
  keys.push({ pos: new THREE.Vector3(-R * 2.2, R * 1.0, R * 0.6), look: new THREE.Vector3() });
  let spots = (L.rooms || []).filter(r => r.rects && r.rects.length).map(r => { const q = r.rects[0]; return [(q[0] + q[2]) / 2, (q[1] + q[3]) / 2]; });
  if (!spots.length) spots = (L.lights || []).map(l => l.at);
  spots = spots.map(p => W3([p[0], p[1], 0.4])).sort((a, b) => Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x)).slice(0, 8);
  // start roughly from the west side
  const start = spots.reduce((bi, p, i, a) => (p.x < a[bi].x ? i : bi), 0); spots = spots.slice(start).concat(spots.slice(0, start));
  spots.forEach(c => { const out = c.clone().setY(0); if (out.lengthSq() < 0.5) out.set(0, 0, 1); out.normalize();
    keys.push({ pos: c.clone().addScaledVector(out, 2.2).setY(built.H + 3.2), look: c }); });
  keys.push({ pos: new THREE.Vector3(R * 0.4, R * 1.1, R * 1.9), look: new THREE.Vector3() });
  keys.push({ pos: new THREE.Vector3(R * 2.1, R * 1.5, R * 2.1), look: new THREE.Vector3() });
  return keys;
}
function startTour() {
  fly = null;
  const keys = makeTourKeys();
  const posC = new THREE.CatmullRomCurve3(keys.map(k => k.pos), false, 'centripetal');
  const lookC = new THREE.CatmullRomCurve3(keys.map(k => k.look), false, 'centripetal');
  const dur = (keys.length - 1) * 4300;
  // ease from the current view into the first key
  tour = { posC, lookC, dur, t0: performance.now() + 1400, lead: { p0: camera.position.clone(), l0: controls.target.clone(), t0: performance.now() } };
  tourBtn.textContent = '■ Stop tour'; controls.enabled = true;
}
function stopTour(reset = true) {
  if (!tour) return; tour = null; tourBtn.textContent = '▶ Play tour'; if (reset) tourProg.style.width = '0';
}
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeSine = t => -(Math.cos(Math.PI * t) - 1) / 2;
