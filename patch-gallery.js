import { fetchAllBadges } from "./chosen-badge.js";

// Replaces the placeholder physics shapes in "Meet the Patch" with the
// actual submitted badge images, pulled straight from Firestore.

const MAX_PATCHES = 24; // keep the physics sim comfortable, not overcrowded
const DISPLAY_SIZE = 84; // on-screen px diameter/side for each patch sprite
const NATIVE_SIZE = 480; // must match CANVAS_SIZE in badge-designer.js

function maskName(fullName) {
  if (!fullName) return "Anonymous";
  return fullName
    .trim()
    .split(/\s+/)
    .map((word) => (word.length <= 2 ? word[0] + "X".repeat(Math.max(word.length - 1, 1)) : word.slice(0, 2) + "X".repeat(word.length - 2)))
    .join(" ");
}

function openBadgeModal(badge) {
  document.getElementById("modal-img").src = badge.imageData;
  document.getElementById("modal-title").innerText = badge.name;
  document.getElementById("modal-teaser").innerText = "Designed by " + maskName(badge.creatorName);
  document.getElementById("modal-body").innerText = "This badge was submitted by a fellow repairer for the Proof of Wear × Patagonia community vote. Show up to the event to see the winning designs in real life.";
  const overlay = document.getElementById("modal-overlay");
  overlay.classList.remove("hidden-transition");
  overlay.classList.add("visible-transition");
  document.body.style.overflow = "hidden";
}

let engine, render, world, patchBodies = [];
let dragStartPos = null;

async function initPatchGallery() {
  const canvasContainer = document.getElementById("patch-canvas");
  const emptyNotice = document.getElementById("patch-empty-notice");
  if (!canvasContainer) return;

  const badges = (await fetchAllBadges()).slice(0, MAX_PATCHES);

  if (!badges.length) {
    if (emptyNotice) emptyNotice.classList.remove("hidden");
    return;
  }
  if (emptyNotice) emptyNotice.classList.add("hidden");

  const { Engine, Render, World, Bodies, Mouse, MouseConstraint, Events, Body, Query } = Matter;

  engine = Engine.create();
  world = engine.world;

  const width = canvasContainer.clientWidth;
  const height = canvasContainer.clientHeight;

  render = Render.create({
    element: canvasContainer,
    engine,
    options: { width, height, wireframes: false, background: "#F5F1E8" },
  });

  const wallOpts = { isStatic: true, render: { visible: false } };
  World.add(world, [
    Bodies.rectangle(width / 2, -10, width, 20, wallOpts),
    Bodies.rectangle(width / 2, height + 10, width, 20, wallOpts),
    Bodies.rectangle(-10, height / 2, 20, height, wallOpts),
    Bodies.rectangle(width + 10, height / 2, 20, height, wallOpts),
  ]);

  const sprite = { texture: null, xScale: DISPLAY_SIZE / NATIVE_SIZE, yScale: DISPLAY_SIZE / NATIVE_SIZE };

  patchBodies = badges.map((badge) => {
    const x = Math.random() * (width - 100) + 50;
    const y = Math.random() * (height - 100) + 50;
    const r = DISPLAY_SIZE / 2;
    const opts = {
      restitution: 0.8,
      render: { sprite: { texture: badge.imageData, xScale: sprite.xScale, yScale: sprite.yScale } },
      plugin: { badge },
    };
    let body;
    if (badge.shape === "circle") body = Bodies.circle(x, y, r, opts);
    else if (badge.shape === "diamond") body = Bodies.polygon(x, y, 4, r, opts);
    else body = Bodies.rectangle(x, y, DISPLAY_SIZE, DISPLAY_SIZE, opts);

    Body.setVelocity(body, { x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 8 });
    Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.2);
    return body;
  });

  World.add(world, patchBodies);

  const mouse = Mouse.create(render.canvas);
  const mouseConstraint = MouseConstraint.create(engine, {
    mouse,
    constraint: { stiffness: 0.2, render: { visible: false } },
  });
  World.add(world, mouseConstraint);
  render.mouse = mouse;

  Events.on(mouseConstraint, "mousedown", () => { dragStartPos = { x: mouse.position.x, y: mouse.position.y }; });
  Events.on(mouseConstraint, "mouseup", () => {
    if (!dragStartPos) return;
    const endPos = { x: mouse.position.x, y: mouse.position.y };
    const dist = Math.hypot(endPos.x - dragStartPos.x, endPos.y - dragStartPos.y);
    if (dist < 5) {
      const bodies = Query.point(patchBodies, endPos);
      if (bodies.length > 0) {
        openBadgeModal(bodies[0].plugin.badge);
        Body.setVelocity(bodies[0], { x: 0, y: 0 });
        Body.setAngularVelocity(bodies[0], 0);
      }
    }
  });

  Engine.run(engine);
  Render.run(render);

  const shakeBtn = document.getElementById("shake-btn");
  if (shakeBtn) {
    shakeBtn.addEventListener("click", () => {
      patchBodies.forEach((p) => {
        Body.applyForce(p, p.position, { x: (Math.random() - 0.5) * 0.5, y: (Math.random() - 0.5) * 0.5 });
      });
    });
  }

  window.addEventListener("resize", () => {
    if (!render) return;
    const c = document.getElementById("patch-canvas");
    if (!c) return;
    render.canvas.width = c.clientWidth;
    render.canvas.height = c.clientHeight;
    render.options.width = c.clientWidth;
    render.options.height = c.clientHeight;
  });
}

window.addEventListener("load", initPatchGallery);
