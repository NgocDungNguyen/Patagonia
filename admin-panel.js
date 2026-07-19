import {
  db, auth, ADMIN_EMAIL,
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, query, orderBy, serverTimestamp,
  signInWithEmailAndPassword, onAuthStateChanged, signOut,
} from "./firebase-init.js";
import { uploadToCloudinary } from "./cloudinary-upload.js";

const $ = (sel) => document.querySelector(sel);
const uid = () => `new-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

function escapeAttr(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function showError(msg) {
  const el = $("#login-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}

// ---------- Auth ----------
function wireLogin() {
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = $("#login-username").value.trim();
    const password = $("#login-password").value;
    $("#login-error").classList.add("hidden");

    if (username.toLowerCase() !== ADMIN_EMAIL) {
      showError("Invalid username or password.");
      return;
    }
    const btn = $("#login-form button[type=submit]");
    btn.disabled = true;
    btn.textContent = "Signing in…";
    try {
      await signInWithEmailAndPassword(auth, ADMIN_EMAIL, password);
    } catch (err) {
      showError("Invalid username or password.");
      console.warn("Login failed:", err.code);
    } finally {
      btn.disabled = false;
      btn.textContent = "Log In";
    }
  });

  $("#logout-btn").addEventListener("click", () => signOut(auth));

  onAuthStateChanged(auth, (user) => {
    if (user && user.email === ADMIN_EMAIL) {
      $("#login-screen").classList.add("hidden");
      $("#admin-dashboard").classList.remove("hidden");
      loadDraftState();
      loadBadgeManageList();
    } else {
      $("#login-screen").classList.remove("hidden");
      $("#admin-dashboard").classList.add("hidden");
    }
  });
}

// ---------- Draft state ----------
// Nothing here touches Firestore/Cloudinary until "Save All Changes" is
// clicked — everything below just builds up an in-memory draft.
let mediaItems = []; // { id, kind: 'existing'|'new', type, url|previewUrl, publicId?, file?, removed? }
const audioState = { existingUrl: null, existingPublicId: null, newFile: null, removed: false };

function renderAudioUI() {
  const preview = $("#audio-current-preview");
  const removeBtn = $("#audio-remove-btn");
  const removedLabel = $("#audio-removed-label");
  const pendingLabel = $("#audio-pending-label");

  if (audioState.removed) {
    preview.classList.add("hidden");
    removeBtn.classList.add("hidden");
    pendingLabel.classList.add("hidden");
    removedLabel.classList.remove("hidden");
    return;
  }
  removedLabel.classList.add("hidden");

  if (audioState.newFile) {
    preview.src = URL.createObjectURL(audioState.newFile);
    preview.classList.remove("hidden");
    pendingLabel.classList.remove("hidden");
    removeBtn.classList.remove("hidden");
  } else if (audioState.existingUrl) {
    preview.src = audioState.existingUrl;
    preview.classList.remove("hidden");
    pendingLabel.classList.add("hidden");
    removeBtn.classList.remove("hidden");
  } else {
    preview.classList.add("hidden");
    pendingLabel.classList.add("hidden");
    removeBtn.classList.add("hidden");
  }
}

async function loadDraftState() {
  const snap = await getDocs(query(collection(db, "badgePageMedia"), orderBy("createdAt", "desc")));
  mediaItems = snap.docs.map((d) => ({ id: d.id, kind: "existing", ...d.data() }));
  renderGallery();

  const storySnap = await getDoc(doc(db, "badgePageStory", "main"));
  $("#story-textarea").value = storySnap.exists() ? storySnap.data().text || "" : "";

  audioState.existingUrl = null;
  audioState.existingPublicId = null;
  audioState.newFile = null;
  audioState.removed = false;
  $("#audio-file-input").value = "";
  const audioSnap = await getDoc(doc(db, "badgePageAudio", "main"));
  if (audioSnap.exists() && audioSnap.data().url) {
    audioState.existingUrl = audioSnap.data().url;
    audioState.existingPublicId = audioSnap.data().publicId;
  }
  renderAudioUI();
}

// ---------- Media gallery ----------
function renderGallery() {
  const gallery = $("#media-gallery");
  const visible = mediaItems.filter((m) => !m.removed);

  gallery.innerHTML = visible.map((m) => {
    const src = m.kind === "new" ? m.previewUrl : m.url;
    const media = m.type === "video"
      ? `<video src="${src}" class="gallery-preview-trigger" data-src="${src}" data-kind="video" muted></video>`
      : `<img src="${src}" class="gallery-preview-trigger" data-src="${src}" data-kind="image" alt="Media">`;
    return `
      <div class="gallery-tile">
        ${media}
        <button data-id="${m.id}" class="gallery-remove-btn" type="button" aria-label="Remove">×</button>
        ${m.kind === "new" ? '<span class="gallery-new-badge">New</span>' : ""}
      </div>`;
  }).join("") + `<button id="media-add-tile" type="button" class="gallery-add-tile">+</button>`;

  $("#media-add-tile").addEventListener("click", () => $("#media-file-input").click());
  gallery.querySelectorAll(".gallery-remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => removeMediaItem(btn.dataset.id));
  });
  gallery.querySelectorAll(".gallery-preview-trigger").forEach((el) => {
    el.addEventListener("click", () => openLightbox(el.dataset.src, el.dataset.kind));
  });
}

// ---------- Lightbox (preview before saving) ----------
function openLightbox(url, kind) {
  const lightbox = $("#media-lightbox");
  const img = $("#lightbox-img");
  const video = $("#lightbox-video");
  img.classList.add("hidden");
  video.classList.add("hidden");
  video.pause();
  video.removeAttribute("src");

  if (kind === "video") {
    video.src = url;
    video.classList.remove("hidden");
  } else {
    img.src = url;
    img.classList.remove("hidden");
  }
  lightbox.classList.remove("hidden");
  lightbox.classList.add("flex");
}

function closeLightbox() {
  const lightbox = $("#media-lightbox");
  lightbox.classList.add("hidden");
  lightbox.classList.remove("flex");
  $("#lightbox-video").pause();
}

function wireLightbox() {
  $("#lightbox-close").addEventListener("click", closeLightbox);
  $("#media-lightbox").addEventListener("click", (e) => {
    if (e.target.id === "media-lightbox") closeLightbox();
  });
}

function removeMediaItem(id) {
  const item = mediaItems.find((m) => m.id === id);
  if (!item) return;
  if (item.kind === "new") {
    URL.revokeObjectURL(item.previewUrl);
    mediaItems = mediaItems.filter((m) => m.id !== id);
  } else {
    item.removed = true; // deleted from Firestore only when Save is clicked
  }
  renderGallery();
}

function wireMediaInput() {
  $("#media-file-input").addEventListener("change", (e) => {
    const files = Array.from(e.target.files || []);
    files.forEach((file) => {
      const isVideo = file.type.startsWith("video/");
      const isImage = file.type.startsWith("image/");
      if (!isVideo && !isImage) return;
      mediaItems.push({
        id: uid(),
        kind: "new",
        type: isVideo ? "video" : "image",
        file,
        previewUrl: URL.createObjectURL(file),
      });
    });
    e.target.value = "";
    renderGallery();
  });
}

// ---------- Audio staging ----------
function wireAudioInput() {
  $("#audio-file-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      alert("Please choose an audio file.");
      e.target.value = "";
      return;
    }
    audioState.newFile = file;
    audioState.removed = false; // picking a new file supersedes a pending removal
    renderAudioUI();
  });

  $("#audio-remove-btn").addEventListener("click", () => {
    audioState.newFile = null;
    audioState.removed = true;
    $("#audio-file-input").value = "";
    renderAudioUI();
  });
}

// ---------- Save everything at once ----------
function wireFinalSave() {
  $("#final-save-btn").addEventListener("click", async () => {
    const btn = $("#final-save-btn");
    const status = $("#save-status");
    btn.disabled = true;

    try {
      const toDelete = mediaItems.filter((m) => m.kind === "existing" && m.removed);
      for (const item of toDelete) {
        status.textContent = "Removing media…";
        await deleteDoc(doc(db, "badgePageMedia", item.id));
      }

      const toUpload = mediaItems.filter((m) => m.kind === "new");
      for (const item of toUpload) {
        status.textContent = `Uploading ${item.file.name}…`;
        const { url, publicId } = await uploadToCloudinary(item.file, item.type);
        await addDoc(collection(db, "badgePageMedia"), {
          type: item.type, url, publicId, createdAt: serverTimestamp(),
        });
      }

      status.textContent = "Saving story…";
      await setDoc(doc(db, "badgePageStory", "main"), {
        text: $("#story-textarea").value,
        updatedAt: serverTimestamp(),
      });

      if (audioState.removed && audioState.existingUrl) {
        status.textContent = "Removing voice note…";
        await deleteDoc(doc(db, "badgePageAudio", "main"));
      } else if (audioState.newFile) {
        status.textContent = "Uploading voice note…";
        const { url, publicId } = await uploadToCloudinary(audioState.newFile, "video");
        await setDoc(doc(db, "badgePageAudio", "main"), { url, publicId, updatedAt: serverTimestamp() });
      }

      status.textContent = "All changes saved ✓";
      await loadDraftState();
    } catch (err) {
      console.error("Save failed:", err);
      status.textContent = "";
      alert(err.message || "Save failed. Check the console for details.");
    } finally {
      btn.disabled = false;
      setTimeout(() => { status.textContent = ""; }, 3000);
    }
  });
}

// ---------- Manage submitted badges (community leaderboard) ----------
// This is a different collection from everything above — it's the public
// contest data shown in "The Chosen Badge" on the main site, not the
// Badge.html story-wall content. Edits/deletes here apply immediately.
async function loadBadgeManageList() {
  const list = $("#badge-manage-list");
  list.innerHTML = `<p class="text-pine/50 text-sm font-bold">Loading…</p>`;
  const snap = await getDocs(query(collection(db, "badges"), orderBy("votes", "desc")));
  const badges = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  if (!badges.length) {
    list.innerHTML = `<p class="text-pine/50 text-sm font-bold">No badges submitted yet.</p>`;
    return;
  }

  list.innerHTML = badges.map((b) => `
    <div class="grid grid-cols-2 sm:grid-cols-[56px_1fr_1fr_90px_auto_auto] gap-3 items-end bg-tan border-2 border-pine p-3" data-row-id="${b.id}">
      <img src="${b.imageData}" class="w-14 h-14 rounded-full border-2 border-pine object-cover bg-bone" alt="Badge">
      <label class="block col-span-2 sm:col-span-1">
        <span class="font-mono uppercase text-pine/60 text-[10px]">Name</span>
        <input type="text" value="${escapeAttr(b.name)}" data-field="name" class="w-full border-2 border-pine p-2 bg-bone font-bold text-sm mt-1">
      </label>
      <label class="block col-span-2 sm:col-span-1">
        <span class="font-mono uppercase text-pine/60 text-[10px]">Creator</span>
        <input type="text" value="${escapeAttr(b.creatorName)}" data-field="creatorName" class="w-full border-2 border-pine p-2 bg-bone font-bold text-sm mt-1">
      </label>
      <label class="block">
        <span class="font-mono uppercase text-pine/60 text-[10px]">Votes</span>
        <input type="number" min="0" step="1" value="${b.votes || 0}" data-field="votes" class="w-full border-2 border-pine p-2 bg-bone font-bold text-sm mt-1">
      </label>
      <button type="button" class="badge-save-btn bg-pine text-bone font-mono text-xs uppercase px-3 py-2 border-2 border-pine h-[38px]" data-id="${b.id}">Save</button>
      <button type="button" class="badge-delete-btn font-mono text-xs uppercase text-rust underline h-[38px]" data-id="${b.id}">Delete</button>
    </div>`).join("");

  list.querySelectorAll(".badge-save-btn").forEach((btn) => {
    btn.addEventListener("click", () => saveBadgeRow(btn.dataset.id));
  });
  list.querySelectorAll(".badge-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteBadgeRow(btn.dataset.id));
  });
}

async function saveBadgeRow(id) {
  const row = document.querySelector(`[data-row-id="${id}"]`);
  const name = row.querySelector('[data-field="name"]').value.trim();
  const creatorName = row.querySelector('[data-field="creatorName"]').value.trim();
  const votes = parseInt(row.querySelector('[data-field="votes"]').value, 10);

  if (!name || !creatorName || Number.isNaN(votes) || votes < 0) {
    alert("Please fill in a name, creator name, and a non-negative vote count.");
    return;
  }

  const btn = row.querySelector(".badge-save-btn");
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    await updateDoc(doc(db, "badges", id), { name, creatorName, votes });
    btn.textContent = "Saved ✓";
  } catch (err) {
    console.error("Badge update failed:", err);
    alert(err.message || "Update failed. Check the console for details.");
    btn.textContent = "Save";
  } finally {
    btn.disabled = false;
    setTimeout(() => { btn.textContent = "Save"; }, 1500);
  }
}

async function deleteBadgeRow(id) {
  if (!confirm("Delete this badge entirely? This cannot be undone.")) return;
  try {
    await deleteDoc(doc(db, "badges", id));
    await loadBadgeManageList();
  } catch (err) {
    console.error("Badge delete failed:", err);
    alert(err.message || "Delete failed. Check the console for details.");
  }
}

function init() {
  wireLogin();
  wireMediaInput();
  wireAudioInput();
  wireFinalSave();
  wireLightbox();
}

document.addEventListener("DOMContentLoaded", init);
