import { db, collection, doc, serverTimestamp, writeBatch } from "./firebase-init.js";
import { refreshLeaderboard } from "./chosen-badge.js";

// ============================================================
// Badge Designer — 5-step wizard producing one flattened image
// (badgeState -> canvas -> dataURL) that gets written to Firestore.
// ============================================================

const CANVAS_SIZE = 480; // px, the fixed resolution everything is rendered at

const state = {
  shape: null, // circle | rectangle | square | diamond
  bg: {
    type: "solid", // solid | gradient | texture | picture
    solid: "#D85A1E",
    gradient: { from: "#D85A1E", to: "#1F3A2E", angle: 45 },
    texture: { preset: "stripes", color: "#1F3A2E" },
    picture: { src: null, scale: 1, x: 50, y: 50 }, // x/y = % pan of image center
  },
  texts: [], // { id, text, x, y, size, color }
  stickers: [], // { id, emoji, x, y, size }
};

let step = 1;
let selectedTextId = null;
let finalImageDataUrl = null;
const layerEls = new Map();

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = () => `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

// ---------- Shape geometry (shared by CSS preview + canvas export) ----------
const SHAPE_BOX = {
  circle: { x: 0, y: 0, w: 1, h: 1, isCircle: true },
  square: { x: 0.06, y: 0.06, w: 0.88, h: 0.88, isCircle: false },
  rectangle: { x: 0.04, y: 0.18, w: 0.92, h: 0.64, isCircle: false },
  diamond: { x: 0, y: 0, w: 1, h: 1, isDiamond: true },
};

function shapeClipPath(shape) {
  if (shape === "circle") return "circle(50%)";
  if (shape === "diamond") return "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)";
  const b = SHAPE_BOX[shape];
  return `inset(${b.y * 100}% ${(1 - b.x - b.w) * 100}% ${(1 - b.y - b.h) * 100}% ${b.x * 100}%)`;
}

function shapeCanvasPath(ctx, shape, size) {
  const b = SHAPE_BOX[shape];
  ctx.beginPath();
  if (shape === "circle") {
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  } else if (shape === "diamond") {
    ctx.moveTo(size / 2, 0);
    ctx.lineTo(size, size / 2);
    ctx.lineTo(size / 2, size);
    ctx.lineTo(0, size / 2);
    ctx.closePath();
  } else {
    ctx.rect(b.x * size, b.y * size, b.w * size, b.h * size);
  }
}

// ---------- Texture presets (mirrored in CSS for live preview + canvas for export) ----------
const TEXTURE_CSS = {
  stripes: (c) => `repeating-linear-gradient(45deg, ${c} 0 8px, transparent 8px 20px)`,
  dots: (c) => `radial-gradient(${c} 28%, transparent 30%)`,
  grid: (c) => `linear-gradient(${c} 1.5px, transparent 1.5px), linear-gradient(90deg, ${c} 1.5px, transparent 1.5px)`,
  cross: (c) => `repeating-linear-gradient(45deg, ${c} 0 2px, transparent 2px 18px), repeating-linear-gradient(-45deg, ${c} 0 2px, transparent 2px 18px)`,
};
const TEXTURE_BG_SIZE = { stripes: "auto", dots: "18px 18px", grid: "18px 18px", cross: "auto" };

function buildTexturePattern(ctx, preset, color) {
  const size = 24;
  const tile = document.createElement("canvas");
  tile.width = size; tile.height = size;
  const t = tile.getContext("2d");
  t.fillStyle = "#F5F1E8";
  t.fillRect(0, 0, size, size);
  t.strokeStyle = color; t.fillStyle = color; t.lineWidth = 2;
  if (preset === "stripes") {
    t.beginPath(); t.moveTo(-4, size); t.lineTo(size, -4);
    t.moveTo(size / 2 - 4, size * 1.5); t.lineTo(size * 1.5, size / 2 - 4);
    t.stroke();
  } else if (preset === "dots") {
    t.beginPath(); t.arc(size / 2, size / 2, size * 0.2, 0, Math.PI * 2); t.fill();
  } else if (preset === "grid") {
    t.strokeRect(1, 1, size - 2, size - 2);
  } else {
    t.beginPath();
    t.moveTo(0, 0); t.lineTo(size, size);
    t.moveTo(size, 0); t.lineTo(0, size);
    t.stroke();
  }
  return ctx.createPattern(tile, "repeat");
}

// ---------- Live DOM preview ----------
function renderShapeFrame() {
  const frame = $("#badge-canvas-shape");
  if (!frame) return;
  frame.style.clipPath = state.shape ? shapeClipPath(state.shape) : "inset(0)";
}

function renderBackground() {
  const bgEl = $("#badge-canvas-bg");
  const imgEl = $("#badge-canvas-img");
  if (!bgEl) return;
  const { type } = state.bg;
  imgEl.style.display = "none";
  bgEl.style.backgroundImage = "";
  bgEl.style.backgroundColor = "#F5F1E8";

  if (type === "solid") {
    bgEl.style.backgroundColor = state.bg.solid;
  } else if (type === "gradient") {
    const g = state.bg.gradient;
    bgEl.style.backgroundImage = `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})`;
  } else if (type === "texture") {
    const t = state.bg.texture;
    bgEl.style.backgroundImage = TEXTURE_CSS[t.preset](t.color);
    bgEl.style.backgroundSize = TEXTURE_BG_SIZE[t.preset];
  } else if (type === "picture" && state.bg.picture.src) {
    imgEl.style.display = "block";
    if (imgEl.dataset.src !== state.bg.picture.src) {
      imgEl.dataset.src = state.bg.picture.src;
      imgEl.onload = applyPictureTransform;
      imgEl.src = state.bg.picture.src;
    } else {
      applyPictureTransform();
    }
  }
}

function applyPictureTransform() {
  const imgEl = $("#badge-canvas-img");
  const frame = $("#badge-canvas-shape");
  if (!imgEl.naturalWidth || !frame) return;
  const frameSize = frame.clientWidth;
  const coverScale = Math.max(frameSize / imgEl.naturalWidth, frameSize / imgEl.naturalHeight);
  const p = state.bg.picture;
  imgEl.style.width = `${imgEl.naturalWidth}px`;
  imgEl.style.height = `${imgEl.naturalHeight}px`;
  const dx = ((p.x - 50) / 100) * frameSize;
  const dy = ((p.y - 50) / 100) * frameSize;
  imgEl.style.transform = `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(${coverScale * p.scale})`;
}

function clampPct(v) { return Math.max(0, Math.min(100, v)); }

function makeMovable(el, layer, { onTap } = {}) {
  let dragging = false, moved = false, startX = 0, startY = 0, origX = 0, origY = 0;
  el.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".badge-layer-del") || e.target.closest(".badge-layer-resize")) return;
    dragging = true; moved = false;
    startX = e.clientX; startY = e.clientY;
    origX = layer.x; origY = layer.y;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const rect = $("#badge-canvas-shape").getBoundingClientRect();
    const dx = ((e.clientX - startX) / rect.width) * 100;
    const dy = ((e.clientY - startY) / rect.height) * 100;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) moved = true;
    layer.x = clampPct(origX + dx);
    layer.y = clampPct(origY + dy);
    el.style.left = `${layer.x}%`;
    el.style.top = `${layer.y}%`;
  });
  el.addEventListener("pointerup", (e) => {
    dragging = false;
    el.releasePointerCapture(e.pointerId);
    if (!moved && onTap) onTap();
  });
}

function makeResizable(handle, layer, bodyEl, { min = 14, max = 140 } = {}) {
  let dragging = false, startX = 0, origSize = 0;
  handle.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    dragging = true; startX = e.clientX; origSize = layer.size;
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    e.stopPropagation();
    const delta = e.clientX - startX;
    layer.size = Math.max(min, Math.min(max, origSize + delta * 0.6));
    applyLayerSize(bodyEl, layer);
  });
  handle.addEventListener("pointerup", (e) => { dragging = false; handle.releasePointerCapture(e.pointerId); });
}

function applyLayerSize(bodyEl, layer) {
  bodyEl.style.fontSize = `${layer.size}px`;
}

function createLayerEl(layer, kind) {
  const wrap = document.createElement("div");
  wrap.className = "badge-layer";
  wrap.style.left = `${layer.x}%`;
  wrap.style.top = `${layer.y}%`;
  wrap.dataset.id = layer.id;

  const body = document.createElement("div");
  body.className = "badge-layer-body";
  if (kind === "text") body.style.color = layer.color;
  body.textContent = kind === "text" ? layer.text : layer.emoji;
  applyLayerSize(body, layer);

  const del = document.createElement("button");
  del.className = "badge-layer-del";
  del.type = "button";
  del.textContent = "×";
  del.addEventListener("click", (e) => {
    e.stopPropagation();
    removeLayer(layer.id, kind);
  });

  const resize = document.createElement("div");
  resize.className = "badge-layer-resize";

  wrap.appendChild(body);
  wrap.appendChild(del);
  wrap.appendChild(resize);
  $("#badge-canvas-layers").appendChild(wrap);

  makeMovable(wrap, layer, {
    onTap: kind === "text" ? () => selectText(layer.id) : undefined,
  });
  makeResizable(resize, layer, body);

  layerEls.set(layer.id, wrap);
}

function removeLayer(id, kind) {
  const list = kind === "text" ? state.texts : state.stickers;
  const idx = list.findIndex((l) => l.id === id);
  if (idx > -1) list.splice(idx, 1);
  const el = layerEls.get(id);
  if (el) el.remove();
  layerEls.delete(id);
  if (selectedTextId === id) { selectedTextId = null; renderTextEditPanel(); }
  if (kind === "text") renderTextList();
  if (kind === "sticker") renderStickerList();
}

function selectText(id) {
  selectedTextId = id;
  layerEls.forEach((el) => el.classList.remove("is-selected"));
  const el = layerEls.get(id);
  if (el) el.classList.add("is-selected");
  renderTextEditPanel();
}

function renderTextEditPanel() {
  const panel = $("#text-edit-panel");
  if (!panel) return;
  const layer = state.texts.find((t) => t.id === selectedTextId);
  if (!layer) { panel.classList.add("hidden"); return; }
  panel.classList.remove("hidden");
  $("#text-edit-label").textContent = `Editing: "${layer.text}"`;
  $("#text-edit-color").value = layer.color;
}

function renderTextList() {
  const list = $("#text-layer-list");
  if (!list) return;
  list.innerHTML = state.texts.map((t) => `
    <div class="flex items-center justify-between gap-2 bg-bone border-2 border-pine px-3 py-2">
      <span class="font-bold text-sm text-pine truncate">${t.text}</span>
      <button data-id="${t.id}" class="text-remove-btn font-mono text-xs text-rust uppercase">Remove</button>
    </div>`).join("") || `<p class="text-pine/50 text-sm font-bold">No text added yet.</p>`;
  list.querySelectorAll(".text-remove-btn").forEach((b) => b.addEventListener("click", () => removeLayer(b.dataset.id, "text")));
}

function renderStickerList() {
  const list = $("#sticker-layer-list");
  if (!list) return;
  list.innerHTML = state.stickers.map((s) => `
    <div class="flex items-center justify-between gap-2 bg-bone border-2 border-pine px-3 py-2">
      <span class="text-xl">${s.emoji}</span>
      <button data-id="${s.id}" class="sticker-remove-btn font-mono text-xs text-rust uppercase">Remove</button>
    </div>`).join("") || `<p class="text-pine/50 text-sm font-bold">No toppings added yet.</p>`;
  list.querySelectorAll(".sticker-remove-btn").forEach((b) => b.addEventListener("click", () => removeLayer(b.dataset.id, "sticker")));
}

function renderPreview() {
  renderShapeFrame();
  renderBackground();
}

// ---------- Step 1: Shape ----------
function wireShapeStep() {
  $$(".shape-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.shape = btn.dataset.shape;
      $$(".shape-option").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      $("#step1-next").disabled = false;
      $("#step1-next").classList.remove("opacity-40", "cursor-not-allowed");
      renderPreview();
    });
  });
}

// ---------- Step 2: Background ----------
const SOLID_SWATCHES = ["#D85A1E", "#1F3A2E", "#C9A77A", "#F5F1E8", "#7A9E7E", "#E8B04B", "#3E5C76", "#B23A48"];

function wireBackgroundStep() {
  const swatchRow = $("#solid-swatches");
  swatchRow.innerHTML = SOLID_SWATCHES.map((c) => `<button class="swatch-btn w-9 h-9 border-2 border-pine" style="background:${c}" data-color="${c}"></button>`).join("");
  swatchRow.querySelectorAll(".swatch-btn").forEach((b) => b.addEventListener("click", () => {
    state.bg.solid = b.dataset.color;
    $("#solid-custom").value = b.dataset.color;
    renderPreview();
  }));
  $("#solid-custom").addEventListener("input", (e) => { state.bg.solid = e.target.value; renderPreview(); });

  $$(".bg-type-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.bg.type = btn.dataset.bgtype;
      $$(".bg-type-btn").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      $$(".bg-panel").forEach((p) => p.classList.add("hidden"));
      $(`#bg-panel-${state.bg.type}`).classList.remove("hidden");
      renderPreview();
    });
  });

  $("#gradient-from").addEventListener("input", (e) => { state.bg.gradient.from = e.target.value; renderPreview(); });
  $("#gradient-to").addEventListener("input", (e) => { state.bg.gradient.to = e.target.value; renderPreview(); });
  $("#gradient-angle").addEventListener("input", (e) => { state.bg.gradient.angle = Number(e.target.value); renderPreview(); });
  $$(".gradient-preset-btn").forEach((b) => b.addEventListener("click", () => {
    $("#gradient-angle").value = b.dataset.angle;
    state.bg.gradient.angle = Number(b.dataset.angle);
    renderPreview();
  }));

  $$(".texture-preset-btn").forEach((b) => b.addEventListener("click", () => {
    state.bg.texture.preset = b.dataset.preset;
    $$(".texture-preset-btn").forEach((x) => x.classList.remove("is-active"));
    b.classList.add("is-active");
    renderPreview();
  }));
  $("#texture-color").addEventListener("input", (e) => { state.bg.texture.color = e.target.value; renderPreview(); });

  $("#picture-upload").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.bg.picture.src = reader.result;
      state.bg.picture.scale = 1;
      state.bg.picture.x = 50;
      state.bg.picture.y = 50;
      $("#picture-controls").classList.remove("hidden");
      renderPreview();
    };
    reader.readAsDataURL(file);
  });
  $("#picture-remove").addEventListener("click", () => {
    state.bg.picture.src = null;
    $("#picture-controls").classList.add("hidden");
    $("#picture-upload").value = "";
    renderPreview();
  });
  $("#picture-zoom-in").addEventListener("click", () => { state.bg.picture.scale = Math.min(3, state.bg.picture.scale + 0.15); renderPreview(); });
  $("#picture-zoom-out").addEventListener("click", () => { state.bg.picture.scale = Math.max(1, state.bg.picture.scale - 0.15); renderPreview(); });

  // drag-to-pan directly on the canvas when a picture background is active
  const shapeFrame = $("#badge-canvas-shape");
  let panning = false, startX = 0, startY = 0, origX = 50, origY = 50;
  shapeFrame.addEventListener("pointerdown", (e) => {
    if (state.bg.type !== "picture" || !state.bg.picture.src || e.target.closest(".badge-layer")) return;
    panning = true; startX = e.clientX; startY = e.clientY;
    origX = state.bg.picture.x; origY = state.bg.picture.y;
    shapeFrame.setPointerCapture(e.pointerId);
  });
  shapeFrame.addEventListener("pointermove", (e) => {
    if (!panning) return;
    const rect = shapeFrame.getBoundingClientRect();
    state.bg.picture.x = clampPct(origX + ((e.clientX - startX) / rect.width) * 100);
    state.bg.picture.y = clampPct(origY + ((e.clientY - startY) / rect.height) * 100);
    renderPreview();
  });
  shapeFrame.addEventListener("pointerup", (e) => { panning = false; shapeFrame.releasePointerCapture(e.pointerId); });
}

// ---------- Step 3: Text ----------
function wireTextStep() {
  $("#add-text-btn").addEventListener("click", () => {
    const input = $("#text-input");
    const text = input.value.trim();
    if (!text) return;
    const layer = { id: uid(), text, x: 50, y: 50, size: 28, color: $("#text-color-input").value };
    state.texts.push(layer);
    createLayerEl(layer, "text");
    renderTextList();
    input.value = "";
  });
  $("#text-edit-color").addEventListener("input", (e) => {
    const layer = state.texts.find((t) => t.id === selectedTextId);
    if (!layer) return;
    layer.color = e.target.value;
    const el = layerEls.get(layer.id);
    if (el) el.querySelector(".badge-layer-body").style.color = layer.color;
  });
  $("#text-edit-close").addEventListener("click", () => { selectedTextId = null; layerEls.forEach((el) => el.classList.remove("is-selected")); renderTextEditPanel(); });
}

// ---------- Step 4: Toppings ----------
const STICKER_LIBRARY = ["🧵", "🪡", "🧷", "📌", "⭐", "🔥", "❤️", "✨", "🏔️", "🌲", "🧭", "🪢", "🩹", "🧶", "🎖️", "🏕️"];

function wireStickerStep() {
  const grid = $("#sticker-grid");
  grid.innerHTML = STICKER_LIBRARY.map((e) => `<button class="sticker-pick-btn text-2xl bg-bone border-2 border-pine p-2 hover-press" data-emoji="${e}">${e}</button>`).join("");
  grid.querySelectorAll(".sticker-pick-btn").forEach((b) => b.addEventListener("click", () => {
    const layer = { id: uid(), emoji: b.dataset.emoji, x: 50, y: 50, size: 36 };
    state.stickers.push(layer);
    createLayerEl(layer, "sticker");
    renderStickerList();
  }));
}

// ---------- Step navigation ----------
function goToStep(n) {
  step = n;
  $$(".designer-step").forEach((el) => el.classList.add("hidden"));
  $(`.designer-step[data-step="${n}"]`).classList.remove("hidden");
  $$(".designer-progress-dot").forEach((dot, i) => {
    dot.classList.toggle("bg-rust", i < n);
    dot.classList.toggle("bg-pine/20", i >= n);
  });
}

function wireStepNav() {
  $$("[data-next]").forEach((btn) => btn.addEventListener("click", () => goToStep(Number(btn.dataset.next))));
  $$("[data-back]").forEach((btn) => btn.addEventListener("click", () => goToStep(Number(btn.dataset.back))));
}

// ---------- Final render (flattened image for storage) ----------
function renderFinalCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#F5F1E8";
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  ctx.save();
  shapeCanvasPath(ctx, state.shape || "circle", CANVAS_SIZE);
  ctx.clip();

  const { type } = state.bg;
  if (type === "solid") {
    ctx.fillStyle = state.bg.solid;
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  } else if (type === "gradient") {
    const g = state.bg.gradient;
    const rad = (g.angle * Math.PI) / 180;
    const x1 = CANVAS_SIZE / 2 - Math.cos(rad) * CANVAS_SIZE, y1 = CANVAS_SIZE / 2 - Math.sin(rad) * CANVAS_SIZE;
    const x2 = CANVAS_SIZE / 2 + Math.cos(rad) * CANVAS_SIZE, y2 = CANVAS_SIZE / 2 + Math.sin(rad) * CANVAS_SIZE;
    const grad = ctx.createLinearGradient(x1, y1, x2, y2);
    grad.addColorStop(0, g.from);
    grad.addColorStop(1, g.to);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  } else if (type === "texture") {
    ctx.fillStyle = buildTexturePattern(ctx, state.bg.texture.preset, state.bg.texture.color);
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  } else if (type === "picture" && state.bg.picture.src) {
    return renderFinalWithImage(canvas, ctx);
  }

  drawLayers(ctx);
  ctx.restore();
  finalImageDataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return Promise.resolve(finalImageDataUrl);
}

function renderFinalWithImage(canvas, ctx) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const p = state.bg.picture;
      const baseScale = Math.max(CANVAS_SIZE / img.width, CANVAS_SIZE / img.height) * p.scale;
      const w = img.width * baseScale, h = img.height * baseScale;
      const cx = CANVAS_SIZE * (p.x / 100), cy = CANVAS_SIZE * (p.y / 100);
      ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
      drawLayers(ctx);
      ctx.restore();
      finalImageDataUrl = canvas.toDataURL("image/jpeg", 0.85);
      resolve(finalImageDataUrl);
    };
    img.src = state.bg.picture.src;
  });
}

function drawLayers(ctx) {
  state.texts.forEach((t) => {
    ctx.font = `900 ${t.size}px Fraunces, serif`;
    ctx.fillStyle = t.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(t.text, (t.x / 100) * CANVAS_SIZE, (t.y / 100) * CANVAS_SIZE);
  });
  state.stickers.forEach((s) => {
    ctx.font = `${s.size}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(s.emoji, (s.x / 100) * CANVAS_SIZE, (s.y / 100) * CANVAS_SIZE);
  });
}

// ---------- Save + Submit ----------
function wireSaveAndSubmit() {
  $("#designer-save-btn").addEventListener("click", async () => {
    $("#designer-save-btn").textContent = "Rendering…";
    await renderFinalCanvas();
    $("#result-preview-img").src = finalImageDataUrl;
    $("#result-preview-wrap").classList.remove("hidden");
    $("#designer-save-btn").textContent = "Saved ✓";
  });

  $("#open-submit-modal-btn").addEventListener("click", async () => {
    if (!state.shape) { alert("Please choose a badge shape first (step 1)."); goToStep(1); return; }
    if (!finalImageDataUrl) await renderFinalCanvas();
    $("#submit-badge-modal").classList.remove("hidden-transition");
    $("#submit-badge-modal").classList.add("visible-transition");
  });

  $("#close-submit-modal-btn").addEventListener("click", () => {
    $("#submit-badge-modal").classList.add("hidden-transition");
    $("#submit-badge-modal").classList.remove("visible-transition");
  });

  $("#submit-badge-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const badgeName = $("#submit-badge-name").value.trim();
    const creatorName = $("#submit-creator-name").value.trim();
    const creatorEmail = $("#submit-creator-email").value.trim();
    if (!badgeName || !creatorName || !creatorEmail) return;

    const submitBtn = $("#submit-badge-form button[type=submit]");
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";

    try {
      if (!finalImageDataUrl) await renderFinalCanvas();
      const badgeRef = doc(collection(db, "badges"));
      const submissionRef = doc(collection(db, "badgeSubmissions"));
      const batch = writeBatch(db);
      batch.set(badgeRef, {
        name: badgeName,
        creatorName,
        imageData: finalImageDataUrl,
        shape: state.shape,
        votes: 0,
        createdAt: serverTimestamp(),
      });
      batch.set(submissionRef, {
        badgeId: badgeRef.id,
        badgeName,
        creatorName,
        creatorEmail,
        createdAt: serverTimestamp(),
      });
      await batch.commit();

      $("#submit-badge-form").classList.add("hidden");
      $("#submit-success").classList.remove("hidden");
      await refreshLeaderboard();
    } catch (err) {
      console.error("Badge submit failed:", err);
      alert("Something went wrong submitting your badge. Please try again.");
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit →";
    }
  });
}

export function initBadgeDesigner() {
  wireShapeStep();
  wireBackgroundStep();
  wireTextStep();
  wireStickerStep();
  wireStepNav();
  wireSaveAndSubmit();
  goToStep(1);
  renderPreview();
}

document.addEventListener("DOMContentLoaded", initBadgeDesigner);
