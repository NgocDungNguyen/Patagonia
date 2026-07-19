import { db, doc, getDoc, collection, getDocs, query, orderBy } from "./firebase-init.js";

const $ = (sel) => document.querySelector(sel);

async function loadMedia() {
  const wrapper = $("#carousel-wrapper");
  const snap = await getDocs(query(collection(db, "badgePageMedia"), orderBy("createdAt", "desc")));
  const items = snap.docs.map((d) => d.data());

  if (!items.length) {
    wrapper.innerHTML = `<div class="swiper-slide"><div class="brutal-border bg-bone flex items-center justify-center h-[320px] sm:h-[420px]"><p class="text-center text-pine/50 font-bold uppercase tracking-widest">No media shared yet.</p></div></div>`;
    return;
  }

  wrapper.innerHTML = items.map((m) => `
    <div class="swiper-slide">
      <div class="brutal-border bg-bone overflow-hidden">
        ${m.type === "video"
          ? `<video src="${m.url}" controls playsinline class="w-full h-[320px] sm:h-[420px] object-cover bg-black"></video>`
          : `<img src="${m.url}" class="w-full h-[320px] sm:h-[420px] object-cover" alt="Shared memory" loading="lazy">`}
      </div>
    </div>`).join("");

  new Swiper(".swiper", {
    slidesPerView: 1.1,
    centeredSlides: true,
    spaceBetween: 20,
    grabCursor: true,
    loop: items.length > 1,
    pagination: { el: ".swiper-pagination", clickable: true },
    navigation: { nextEl: "#carousel-next", prevEl: "#carousel-prev" },
    breakpoints: { 768: { slidesPerView: 1.5, spaceBetween: 40 } },
  });
}

async function loadStory() {
  const snap = await getDoc(doc(db, "badgePageStory", "main"));
  const text = snap.exists() ? snap.data().text : "";
  $("#story-text").textContent = text && text.trim() ? text : "No story shared yet.";
}

// ---------- Audio visualizer (Web Audio API) ----------
let audioCtx, analyser, dataArray, animationId, sourceConnected = false;

function setupVisualizer(audioEl) {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaElementSource(audioEl);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 64;
  source.connect(analyser);
  analyser.connect(audioCtx.destination);
  dataArray = new Uint8Array(analyser.frequencyBinCount);
  sourceConnected = true;
}

function drawVisualizer() {
  const canvas = $("#audio-visualizer");
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  analyser.getByteFrequencyData(dataArray);
  ctx.clearRect(0, 0, w, h);
  const barCount = dataArray.length;
  const barWidth = w / barCount;
  for (let i = 0; i < barCount; i++) {
    const v = dataArray[i] / 255;
    const barH = Math.max(4, v * h);
    ctx.fillStyle = i % 2 === 0 ? "#D85A1E" : "#F5F1E8";
    ctx.fillRect(i * barWidth, h - barH, Math.max(1, barWidth - 3), barH);
  }
  animationId = requestAnimationFrame(drawVisualizer);
}

async function loadAudio() {
  const snap = await getDoc(doc(db, "badgePageAudio", "main"));
  if (!snap.exists() || !snap.data().url) {
    $("#audio-empty-notice").classList.remove("hidden");
    $("#audio-player-controls").classList.add("hidden");
    return;
  }

  const audioEl = $("#audio-el");
  audioEl.crossOrigin = "anonymous";
  audioEl.src = snap.data().url;

  $("#audio-play-btn").addEventListener("click", async () => {
    if (!sourceConnected) setupVisualizer(audioEl);
    if (audioCtx.state === "suspended") await audioCtx.resume();
    if (audioEl.paused) {
      await audioEl.play();
      $("#audio-play-btn").textContent = "❚❚";
      drawVisualizer();
    } else {
      audioEl.pause();
      $("#audio-play-btn").textContent = "►";
      cancelAnimationFrame(animationId);
    }
  });

  audioEl.addEventListener("ended", () => {
    $("#audio-play-btn").textContent = "►";
    cancelAnimationFrame(animationId);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  loadMedia();
  loadStory();
  loadAudio();
});
