import {
  db, auth, ADMIN_EMAIL,
  collection, doc, addDoc, setDoc, deleteDoc, getDoc, getDocs, query, orderBy, serverTimestamp,
  signInWithEmailAndPassword, onAuthStateChanged, signOut,
} from "./firebase-init.js";
import { uploadToCloudinary } from "./cloudinary-upload.js";

const $ = (sel) => document.querySelector(sel);
const uid = () => `new-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

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
const audioState = { existingUrl: null, existingPublicId: null, newFile: null };

async function loadDraftState() {
  const snap = await getDocs(query(collection(db, "badgePageMedia"), orderBy("createdAt", "desc")));
  mediaItems = snap.docs.map((d) => ({ id: d.id, kind: "existing", ...d.data() }));
  renderGallery();

  const storySnap = await getDoc(doc(db, "badgePageStory", "main"));
  $("#story-textarea").value = storySnap.exists() ? storySnap.data().text || "" : "";

  audioState.existingUrl = null;
  audioState.existingPublicId = null;
  audioState.newFile = null;
  const audioSnap = await getDoc(doc(db, "badgePageAudio", "main"));
  const preview = $("#audio-current-preview");
  $("#audio-pending-label").classList.add("hidden");
  $("#audio-file-input").value = "";
  if (audioSnap.exists() && audioSnap.data().url) {
    audioState.existingUrl = audioSnap.data().url;
    audioState.existingPublicId = audioSnap.data().publicId;
    preview.src = audioState.existingUrl;
    preview.classList.remove("hidden");
  } else {
    preview.classList.add("hidden");
  }
}

// ---------- Media gallery ----------
function renderGallery() {
  const gallery = $("#media-gallery");
  const visible = mediaItems.filter((m) => !m.removed);

  gallery.innerHTML = visible.map((m) => {
    const src = m.kind === "new" ? m.previewUrl : m.url;
    const media = m.type === "video"
      ? `<video src="${src}" muted></video>`
      : `<img src="${src}" alt="Media">`;
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
    const preview = $("#audio-current-preview");
    preview.src = URL.createObjectURL(file);
    preview.classList.remove("hidden");
    $("#audio-pending-label").classList.remove("hidden");
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

      if (audioState.newFile) {
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

function init() {
  wireLogin();
  wireMediaInput();
  wireAudioInput();
  wireFinalSave();
}

document.addEventListener("DOMContentLoaded", init);
