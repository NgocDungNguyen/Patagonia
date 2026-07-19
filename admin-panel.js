import {
  db, auth, ADMIN_EMAIL,
  collection, doc, addDoc, setDoc, deleteDoc, getDoc, getDocs, query, orderBy, serverTimestamp,
  signInWithEmailAndPassword, onAuthStateChanged, signOut,
} from "./firebase-init.js";
import { uploadToCloudinary } from "./cloudinary-upload.js";

const $ = (sel) => document.querySelector(sel);

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
      loadMedia();
      loadStory();
      loadAudio();
    } else {
      $("#login-screen").classList.remove("hidden");
      $("#admin-dashboard").classList.add("hidden");
    }
  });
}

// ---------- Media (carousel) ----------
async function loadMedia() {
  const list = $("#media-list");
  list.innerHTML = `<p class="text-pine/50 text-sm font-bold">Loading…</p>`;
  const snap = await getDocs(query(collection(db, "badgePageMedia"), orderBy("createdAt", "desc")));
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!items.length) {
    list.innerHTML = `<p class="text-pine/50 text-sm font-bold">No media uploaded yet.</p>`;
    return;
  }
  list.innerHTML = items.map((m) => `
    <div class="flex items-center gap-3 bg-bone border-2 border-pine p-3">
      ${m.type === "video"
        ? `<video src="${m.url}" class="w-16 h-16 object-cover border-2 border-pine" muted></video>`
        : `<img src="${m.url}" class="w-16 h-16 object-cover border-2 border-pine" alt="Media">`}
      <span class="flex-1 font-mono text-xs text-pine/70 uppercase truncate">${m.type}</span>
      <button data-id="${m.id}" class="media-delete-btn font-mono text-xs text-rust uppercase underline">Remove</button>
    </div>`).join("");
  list.querySelectorAll(".media-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteMedia(btn.dataset.id));
  });
}

// Note: this only unlists the item from the site (deletes the Firestore
// doc). The underlying file stays in your Cloudinary media library — an
// unsigned client can upload to Cloudinary but can't safely delete from it
// (that requires the API secret, which must never live in browser code).
// Clean up unused files from cloudinary.com's Media Library if it matters.
async function deleteMedia(id) {
  if (!confirm("Remove this item from the site? (The file will still exist in your Cloudinary library.)")) return;
  await deleteDoc(doc(db, "badgePageMedia", id));
  loadMedia();
}

function wireMediaUpload() {
  $("#media-upload-btn").addEventListener("click", async () => {
    const input = $("#media-upload-input");
    const file = input.files[0];
    if (!file) return;
    const isVideo = file.type.startsWith("video/");
    const isImage = file.type.startsWith("image/");
    if (!isVideo && !isImage) { alert("Please choose an image or video file."); return; }

    const btn = $("#media-upload-btn");
    btn.disabled = true;
    btn.textContent = "Uploading…";
    try {
      const { url, publicId } = await uploadToCloudinary(file, isVideo ? "video" : "image");
      await addDoc(collection(db, "badgePageMedia"), {
        type: isVideo ? "video" : "image",
        url,
        publicId,
        createdAt: serverTimestamp(),
      });
      input.value = "";
      await loadMedia();
    } catch (err) {
      console.error("Media upload failed:", err);
      alert(err.message || "Upload failed. Check the console for details.");
    } finally {
      btn.disabled = false;
      btn.textContent = "Upload";
    }
  });
}

// ---------- Story ----------
async function loadStory() {
  const snap = await getDoc(doc(db, "badgePageStory", "main"));
  $("#story-textarea").value = snap.exists() ? snap.data().text || "" : "";
}

function wireStory() {
  $("#story-save-btn").addEventListener("click", async () => {
    const btn = $("#story-save-btn");
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      await setDoc(doc(db, "badgePageStory", "main"), {
        text: $("#story-textarea").value,
        updatedAt: serverTimestamp(),
      });
      btn.textContent = "Saved ✓";
    } catch (err) {
      console.error("Story save failed:", err);
      btn.textContent = "Save Story";
      alert("Save failed. Check the console for details.");
    } finally {
      btn.disabled = false;
      setTimeout(() => { btn.textContent = "Save Story"; }, 1500);
    }
  });
}

// ---------- Audio ----------
async function loadAudio() {
  const snap = await getDoc(doc(db, "badgePageAudio", "main"));
  const preview = $("#audio-current-preview");
  if (snap.exists() && snap.data().url) {
    preview.src = snap.data().url;
    preview.classList.remove("hidden");
  } else {
    preview.classList.add("hidden");
  }
}

function wireAudioUpload() {
  $("#audio-upload-btn").addEventListener("click", async () => {
    const input = $("#audio-upload-input");
    const file = input.files[0];
    if (!file) return;
    if (!file.type.startsWith("audio/")) { alert("Please choose an audio file (MP3)."); return; }

    const btn = $("#audio-upload-btn");
    btn.disabled = true;
    btn.textContent = "Uploading…";
    try {
      // Cloudinary has no distinct "audio" resource type — it goes through
      // the video upload endpoint, which handles audio-only files fine.
      const { url, publicId } = await uploadToCloudinary(file, "video");
      await setDoc(doc(db, "badgePageAudio", "main"), {
        url,
        publicId,
        updatedAt: serverTimestamp(),
      });
      input.value = "";
      await loadAudio();
    } catch (err) {
      console.error("Audio upload failed:", err);
      alert(err.message || "Upload failed. Check the console for details.");
    } finally {
      btn.disabled = false;
      btn.textContent = "Upload / Replace";
    }
  });
}

function init() {
  wireLogin();
  wireMediaUpload();
  wireStory();
  wireAudioUpload();
}

document.addEventListener("DOMContentLoaded", init);
