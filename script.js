//Генерация

function hash2D(x, y, seed) {
  let t = (x * 374761393 + y * 668265263 + seed * 1442695041) >>> 0;
  t = (t ^ (t >>> 13)) >>> 0;
  t = Math.imul(t, 1274126177) >>> 0;
  t = (t ^ (t >>> 16)) >>> 0;
  return t / 4294967296;
}
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(t) { return t * t * (3 - 2 * t); }

function valueNoise2D(x, y, seed, scale) {
  const fx = x / scale;
  const fy = y / scale;

  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = x0 + 1;
  const y1 = y0 + 1;

  const sx = smoothstep(fx - x0);
  const sy = smoothstep(fy - y0);

  const v00 = hash2D(x0, y0, seed);
  const v10 = hash2D(x1, y0, seed);
  const v01 = hash2D(x0, y1, seed);
  const v11 = hash2D(x1, y1, seed);

  const ix0 = lerp(v00, v10, sx);
  const ix1 = lerp(v01, v11, sx);
  return lerp(ix0, ix1, sy);
}

function fbm2D(x, y, seed, baseScale, octaves = 5, persistence = 0.5, lacunarity = 2.0) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise2D(x * freq, y * freq, seed, baseScale);
    sum += n * amp;
    norm += amp;
    amp *= persistence;
    freq *= lacunarity;
  }
  return sum / norm;
}

function falloff(d, strength) {
  const x = Math.max(0, Math.min(1, d));
  const edgeStart = 0.75;
  const t = Math.max(0, (x - edgeStart) / (1 - edgeStart));
  const f = t * t * (3 - 2 * t);
  return Math.max(0, Math.min(1, f * strength));
}

function applyContinentMask(h, x, y, W, H, strength, seed) {
  const cx = (W - 1) / 2;
  const cy = (H - 1) / 2;

  const nx = (x - cx) / cx;
  const ny = (y - cy) / cy;

  let d = Math.sqrt(nx * nx + ny * ny);
  const warp = valueNoise2D(x, y, seed + 9999, 120);
  d += (warp - 0.5) * 0.25;

  const dn = Math.max(0, Math.min(1, d));
  return Math.max(0, Math.min(1, h - falloff(dn, strength)));
}

function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

function temperatureAt(x, y, W, H, h, seaLevel, tLat, tLap) {
  const cy = (H - 1) / 2;
  const lat = Math.abs(y - cy) / cy;
  let t = 1 - lat;
  t = clamp01(0.5 + (t - 0.5) * tLat);

  const sea = Math.max(1e-6, Math.min(1 - 1e-6, seaLevel));
  const e = (h - sea) / (1 - sea);
  const elev = Math.max(0, e);
  t = clamp01(t - elev * tLap);
  return t;
}

function biomeColorWhittaker(h, m, t, seaLevel, beachTh, rockTh, snowTh) {
  const sea = Math.max(1e-6, Math.min(1 - 1e-6, seaLevel));

  if (h < sea) {
    const depth = h / sea;
    return [0, Math.floor(40 + 60 * depth), Math.floor(120 + 120 * depth)];
  }

  const e = (h - sea) / (1 - sea);

  if (e < beachTh) return [220, 210, 140];

  if (e > snowTh) return [240, 240, 240];
  if (e > rockTh) return [140, 140, 140];

  const tZone = (t < 0.33) ? 0 : (t < 0.66 ? 1 : 2);
  const mZone = (m < 0.33) ? 0 : (m < 0.66 ? 1 : 2);

  const palette = [
    [ [190,190,150], [ 70,120, 80], [ 60,110, 90] ],
    [ [205,185,110], [ 60,170, 85], [ 40,140, 85] ],
    [ [220,200,120], [170,180, 90], [ 25,130, 55] ],
  ];
  return palette[tZone][mZone];
}

function hillshade(height, x, y, W, H, lightAngleDeg, zScale = 1.0) {
  const xm1 = Math.max(0, x - 1), xp1 = Math.min(W - 1, x + 1);
  const ym1 = Math.max(0, y - 1), yp1 = Math.min(H - 1, y + 1);

  const hL = height[y * W + xm1];
  const hR = height[y * W + xp1];
  const hU = height[ym1 * W + x];
  const hD = height[yp1 * W + x];

  const dx = (hR - hL);
  const dy = (hD - hU);

  let nx = -dx * zScale;
  let ny = -dy * zScale;
  let nz = 1.0;
  const invLen = 1.0 / Math.hypot(nx, ny, nz);
  nx *= invLen; ny *= invLen; nz *= invLen;

  const a = (lightAngleDeg * Math.PI) / 180;
  let lx = Math.cos(a);
  let ly = Math.sin(a);
  let lz = 0.75;
  const invL = 1.0 / Math.hypot(lx, ly, lz);
  lx *= invL; ly *= invL; lz *= invL;

  return Math.max(0, nx * lx + ny * ly + nz * lz);
}

function renderNoise(params) {
  const {
    seed, scale, octaves, persistence, lacunarity,
    seaLevel, falloffStrength,
    lightAngleDeg, shadeStrength,
    mScale, mStr, tLat, tLap,
    beachTh, rockTh, snowTh
  } = params;

  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d", { willReadFrequently: false });
  const W = canvas.width, H = canvas.height;

  const height = new Float32Array(W * H);
  const moisture = new Float32Array(W * H);
  const temp = new Float32Array(W * H);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let h = fbm2D(x, y, seed, scale, octaves, persistence, lacunarity);
      h = applyContinentMask(h, x, y, W, H, falloffStrength, seed);
      h = Math.pow(h, 0.9);
      height[y * W + x] = h;

      let m = fbm2D(x, y, seed + 7777, mScale, 4, 0.5, 2.0);
      m = Math.max(0, Math.min(1, (m - 0.5) * mStr + 0.5));
      moisture[y * W + x] = m;

      temp[y * W + x] = temperatureAt(x, y, W, H, h, seaLevel, tLat, tLap);
    }
  }

  const img = ctx.createImageData(W, H);
  const data = img.data;
  let i = 0;

  const zScale = 8.0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      const h = height[idx];

      let [r, g, b] = biomeColorWhittaker(
        h, moisture[idx], temp[idx], seaLevel,
        beachTh, rockTh, snowTh
      );

      const isWater = (h < seaLevel);
      const waterMul = isWater ? 0.4 : 1.0;

      const shade = hillshade(height, x, y, W, H, lightAngleDeg, zScale);

      const ambient = 0.55;
      const rawLight = ambient + (shade * shadeStrength * waterMul) * (1 - ambient);

      const gamma = 0.75;
      const light = Math.pow(rawLight, gamma);

      data[i++] = Math.max(0, Math.min(255, Math.floor(r * light)));
      data[i++] = Math.max(0, Math.min(255, Math.floor(g * light)));
      data[i++] = Math.max(0, Math.min(255, Math.floor(b * light)));
      data[i++] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
}

//UI

function numOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bindRangeNumber(id, fmt = (v) => v) {
  const range = document.getElementById(id);
  const num = document.getElementById(id + "Num");
  const val = document.getElementById(id + "Val");

  function setValue(v) {
    range.value = v;
    num.value = v;
    if (val) val.textContent = `(${fmt(v)})`;
  }

  setValue(range.value);


  range.addEventListener("input", () => { setValue(range.value); scheduleRun(); });
  num.addEventListener("input", () => { setValue(num.value); scheduleRun(); });

  return {
    get: () => Number(range.value),
    set: (v) => setValue(v),
    setEnabled: (on) => { range.disabled = !on; num.disabled = !on; }
  };
}


//render

const seedEl = document.getElementById("seed");

const scaleCtl = bindRangeNumber("scale", (v) => Number(v).toFixed(0));
const octavesCtl = bindRangeNumber("octaves", (v) => Number(v).toFixed(0));
const persistenceCtl = bindRangeNumber("persistence", (v) => Number(v).toFixed(2));
const lacunarityCtl = bindRangeNumber("lacunarity", (v) => Number(v).toFixed(2));

const seaCtl = bindRangeNumber("sea", (v) => Number(v).toFixed(2));
const falloffCtl = bindRangeNumber("falloff", (v) => Number(v).toFixed(2));
const lightAngCtl = bindRangeNumber("lightAng", (v) => Number(v).toFixed(0) + "°");
const shadeCtl = bindRangeNumber("shade", (v) => Number(v).toFixed(2));

const mScaleCtl = bindRangeNumber("mScale", (v) => Number(v).toFixed(0));
const mStrCtl = bindRangeNumber("mStr", (v) => Number(v).toFixed(2));

const tLatCtl = bindRangeNumber("tLat", (v) => Number(v).toFixed(2));
const tLapCtl = bindRangeNumber("tLap", (v) => Number(v).toFixed(2));

const beachCtl = bindRangeNumber("beach", (v) => Number(v).toFixed(3));
const rockCtl  = bindRangeNumber("rock",  (v) => Number(v).toFixed(2));
const snowCtl  = bindRangeNumber("snow",  (v) => Number(v).toFixed(2));


function collectParams() {
  const seed = (numOr(seedEl.value, 38) | 0);

  const params = {
    seed,
    scale: clamp(numOr(scaleCtl.get(), 64), 2, 2048),
    octaves: Math.round(clamp(numOr(octavesCtl.get(), 5), 1, 12)),
    persistence: clamp(numOr(persistenceCtl.get(), 0.5), 0, 1),
    lacunarity: clamp(numOr(lacunarityCtl.get(), 2.0), 1, 10),

    seaLevel: clamp(numOr(seaCtl.get(), 0.45), 0, 1),
    falloffStrength: clamp(numOr(falloffCtl.get(), 0.75), 0, 5),

    lightAngleDeg: clamp(numOr(lightAngCtl.get(), 315), 0, 360),
    shadeStrength: clamp(numOr(shadeCtl.get(), 1), 0, 1),

    mScale: clamp(numOr(mScaleCtl.get(), 180), 0, 2000),
    mStr:   clamp(numOr(mStrCtl.get(), 1.1), 0, 3),

    tLat: clamp(numOr(tLatCtl.get(), 1.0), 0, 3),
    tLap: clamp(numOr(tLapCtl.get(), 0.55), 0, 2),

    beachTh: clamp(numOr(beachCtl.get(), 0.06), 0, 0.3),
    rockTh:  clamp(numOr(rockCtl.get(), 0.45), 0, 1),
    snowTh:  clamp(numOr(snowCtl.get(), 0.60), 0, 1),
  };

  if (params.snowTh < params.rockTh + 0.01) {
    params.snowTh = Math.min(0.99, params.rockTh + 0.01);
    snowCtl.set(params.snowTh);
  }

  return params;
}



function run() {
  renderNoise(collectParams());
}

function scheduleRun(immediate = false) {
  const rt = document.getElementById("realtime");
  if (!rt.checked && !immediate) return;
  run();
}

//Кнопки

seedEl.addEventListener("input", () => scheduleRun(true));

document.getElementById("btnRand").addEventListener("click", () => {
  seedEl.value = Math.floor(Math.random() * 1001);
  scheduleRun(true);
});

document.getElementById("btnSave").addEventListener("click", () => {
  const canvas = document.getElementById("c");
  const a = document.createElement("a");
  a.download = `map_seed_${seedEl.value || 0}.png`;
  a.href = canvas.toDataURL("image/png");
  a.click();
});

document.getElementById("btnGen").addEventListener("click", () => {
  scheduleRun(true);
});

document.getElementById("realtime").addEventListener("change", (e) => {
  if (e.target.checked) scheduleRun(true);
});

document.getElementById("btnReliefReset").addEventListener("click", () => {
  beachCtl.set(0.06);
  rockCtl.set(0.45);
  snowCtl.set(0.60);
  scheduleRun(true);
});

scheduleRun(true);

const openSavesBtn = document.getElementById("openSaves");
const closeSavesBtn = document.getElementById("closeSaves");
const overlayEl = document.getElementById("savesOverlay");
const drawerEl = document.getElementById("savesDrawer");

function openSaves() {
  if (typeof renderSlotsUI === "function") renderSlotsUI();

  overlayEl.hidden = false;
  drawerEl.classList.add("open");
  drawerEl.setAttribute("aria-hidden", "false");

  document.body.style.overflow = "hidden";
}

function closeSaves() {
  drawerEl.classList.remove("open");
  drawerEl.setAttribute("aria-hidden", "true");
  overlayEl.hidden = true;

  document.body.style.overflow = "";
}

openSavesBtn?.addEventListener("click", openSaves);
closeSavesBtn?.addEventListener("click", closeSaves);
overlayEl?.addEventListener("click", closeSaves);

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && drawerEl.classList.contains("open")) {
    closeSaves();
  }
});

//Сохранения

const LS_KEY = "terrain_saves_v1";
const SLOTS_COUNT = 10;

function readSlots() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    const slots = new Array(SLOTS_COUNT).fill(null);
    for (let i = 0; i < SLOTS_COUNT; i++) slots[i] = arr[i] ?? null;
    return slots;
  } catch {
    return new Array(SLOTS_COUNT).fill(null);
  }
}

function writeSlots(slots) {
  localStorage.setItem(LS_KEY, JSON.stringify(slots));
}

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

function applyParamsToUI(p) {
  seedEl.value = p.seed ?? seedEl.value;

  scaleCtl.set(p.scale ?? 64);
  octavesCtl.set(p.octaves ?? 5);
  persistenceCtl.set(p.persistence ?? 0.5);
  lacunarityCtl.set(p.lacunarity ?? 2.0);

  seaCtl.set(p.seaLevel ?? 0.45);
  falloffCtl.set(p.falloffStrength ?? 0.75);

  lightAngCtl.set(p.lightAngleDeg ?? 315);
  shadeCtl.set(p.shadeStrength ?? 1);

  mScaleCtl.set(p.mScale ?? 180);
  mStrCtl.set(p.mStr ?? 1.1);

  tLatCtl.set(p.tLat ?? 1.0);
  tLapCtl.set(p.tLap ?? 0.55);

  beachCtl.set(p.beachTh ?? 0.06);
  rockCtl.set(p.rockTh ?? 0.45);
  snowCtl.set(p.snowTh ?? 0.60);

}

function saveToSlot(slotIndex) {
  const canvas = document.getElementById("c");
  const dataUrl = canvas.toDataURL("image/png");
  const params = collectParams();

  const slots = readSlots();
  slots[slotIndex] = {
    ts: Date.now(),
    title: `Seed ${params.seed}`,
    img: dataUrl,
    params
  };
  writeSlots(slots);
  renderSlotsUI();
}

function loadFromSlot(slotIndex) {
  const slots = readSlots();
  const s = slots[slotIndex];
  if (!s) return;

  applyParamsToUI(s.params || {});
  scheduleRun(true);
  closeSaves();
}

function deleteSlot(slotIndex) {
  if (!confirm('Вы уверены?')) return;
  const slots = readSlots();
  slots[slotIndex] = null;
  writeSlots(slots);
  renderSlotsUI();
}

function clearAllSlots() {
  if (!confirm('Вы уверены?')) return;
  writeSlots(new Array(SLOTS_COUNT).fill(null));
  renderSlotsUI();
}

function renderSlotsUI() {
  const slotsEl = document.getElementById("slots");
  if (!slotsEl) return;

  const slots = readSlots();

  slotsEl.innerHTML = slots.map((s, i) => {
    if (!s) {
      return `
        <div style="border:1px dashed #d1d5db; border-radius:14px; padding:10px; background:#fafafa;">
          <div style="font-weight:700; font-size:13px; margin-bottom:6px;">Слот ${i + 1}</div>
          <div style="font-size:12px; color:#6b7280; margin-bottom:10px;">Пусто</div>
          <button type="button" class="btn" data-action="save" data-i="${i}">Сохранить сюда</button>
        </div>
      `;
    }

    return `
      <div style="border:1px solid #e5e7eb; border-radius:14px; padding:10px; background:#fff;">
        <div style="display:flex; justify-content:space-between; gap:8px; align-items:flex-start;">
          <div>
            <div style="font-weight:700; font-size:13px;">Слот ${i + 1} — ${s.title || ""}</div>
            <div style="font-size:12px; color:#6b7280;">${formatDate(s.ts)}</div>
          </div>
        </div>

        <div style="margin:10px 0;">
          <img src="${s.img}" alt="preview" style="width:100%; border-radius:12px; border:1px solid #e5e7eb;" />
        </div>

        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button type="button" class="btn" data-action="load" data-i="${i}">Загрузить</button>
          <button type="button" class="btn secondary" data-action="del" data-i="${i}">Удалить</button>
        </div>
      </div>
    `;
  }).join("");


  slotsEl.onclick = (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;

    const action = btn.dataset.action;
    const idx = Number(btn.dataset.i);

    if (action === "save") saveToSlot(idx);
    if (action === "load") loadFromSlot(idx);
    if (action === "del") deleteSlot(idx);
  };
}

document.getElementById("saveAllClear")?.addEventListener("click", clearAllSlots);

renderSlotsUI();
