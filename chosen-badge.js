import {
  db, collection, doc, getDoc, getDocs, query, orderBy, limit,
  serverTimestamp, writeBatch, increment,
} from "./firebase-init.js";

const VOTER_ID_KEY = "pow_voter_id";
const VOTED_BADGE_KEY = "pow_voted_badge_id";
const TOP_N = 5;
const rowRotate = (i) => (i % 2 === 0 ? "rotate-1" : "rotate-2");

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getVoterId() {
  let id = localStorage.getItem(VOTER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(VOTER_ID_KEY, id);
  }
  return id;
}

function hasVoted() {
  return !!localStorage.getItem(VOTED_BADGE_KEY);
}

async function fetchTopBadges(max = TOP_N) {
  const q = query(collection(db, "badges"), orderBy("votes", "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function fetchAllBadges() {
  const q = query(collection(db, "badges"), orderBy("votes", "desc"), limit(200));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function rowTemplate(badge, rank, maxVotes, showVote) {
  const pct = maxVotes > 0 ? Math.max(4, Math.round((badge.votes / maxVotes) * 100)) : 4;
  const rankColor = rank === 1 ? "text-rust" : "text-pine";
  const barColor = rank === 1 ? "bg-rust" : "bg-pine";
  const voteBtn = showVote
    ? `<button class="vote-btn shrink-0 font-mono text-[10px] sm:text-xs uppercase tracking-widest bg-pine text-bone px-3 py-2 border-2 border-pine hover:bg-rust hover:border-rust transition-colors" data-badge-id="${badge.id}">Vote ▲</button>`
    : "";
  return `
    <div class="flex items-center gap-2 sm:gap-4 md:gap-6 bg-tan brutal-border p-2 sm:p-4 ${rowRotate(rank)}">
      <div class="font-fraunces text-xl sm:text-3xl md:text-5xl font-black w-7 sm:w-10 md:w-16 text-center ${rankColor}">${String(rank).padStart(2, "0")}</div>
      <img src="${badge.imageData}" class="w-10 h-10 sm:w-16 sm:h-16 md:w-20 md:h-20 rounded-full brutal-border object-cover flex-shrink-0 bg-bone" alt="${escapeHtml(badge.name)}">
      <div class="flex-1 min-w-0">
        <div class="flex flex-wrap justify-between items-end gap-x-2 mb-1">
          <span class="font-fraunces text-base sm:text-xl md:text-2xl font-black text-pine truncate">${escapeHtml(badge.name)}</span>
          <span class="font-mono text-xs sm:text-sm font-bold text-pine">${badge.votes || 0} Votes</span>
        </div>
        <div class="h-4 bg-pine/10 brutal-border border-pine w-full">
          <div class="h-full ${barColor}" style="width: ${pct}%"></div>
        </div>
      </div>
      ${voteBtn}
    </div>`;
}

function renderRows(container, badges, { showVote }) {
  if (!badges.length) {
    container.innerHTML = `<p class="text-center text-pine/60 font-bold uppercase tracking-widest text-sm py-8">No badges submitted yet — be the first!</p>`;
    return;
  }
  const maxVotes = badges[0].votes || 0;
  container.innerHTML = badges.map((b, i) => rowTemplate(b, i + 1, maxVotes, showVote)).join("");
  if (showVote) {
    container.querySelectorAll(".vote-btn").forEach((btn) => {
      btn.addEventListener("click", () => castVote(btn.dataset.badgeId));
    });
  }
}

function showVotedNotice(message) {
  const notice = document.getElementById("vote-notice");
  if (notice) {
    notice.textContent = message || "Voting successful! Thanks for backing a design.";
    notice.classList.remove("hidden");
  }
  document.querySelectorAll(".vote-btn").forEach((btn) => btn.remove());
}

async function castVote(badgeId) {
  if (hasVoted()) return;
  document.querySelectorAll(".vote-btn").forEach((btn) => (btn.disabled = true));

  const voterId = getVoterId();
  const markerRef = doc(db, "voteMarkers", voterId);
  const badgeRef = doc(db, "badges", badgeId);
  const batch = writeBatch(db);
  batch.set(markerRef, { badgeId, votedAt: serverTimestamp() });
  batch.update(badgeRef, { votes: increment(1) });

  try {
    await batch.commit();
    localStorage.setItem(VOTED_BADGE_KEY, badgeId);
    showVotedNotice();
    await refreshLeaderboard();
  } catch (err) {
    // Marker already existed (already voted from this browser before) or a rules rejection.
    localStorage.setItem(VOTED_BADGE_KEY, badgeId);
    showVotedNotice("You've already voted in this browser.");
    console.warn("Vote failed:", err);
  }
}

let showingAll = false;

async function refreshLeaderboard() {
  const top = document.getElementById("badge-leaderboard");
  if (top) renderRows(top, await fetchTopBadges(), { showVote: !hasVoted() });

  if (showingAll) {
    const all = document.getElementById("badge-fulllist");
    if (all) renderRows(all, await fetchAllBadges(), { showVote: !hasVoted() });
  }
}

function wireShowMore() {
  const btn = document.getElementById("badge-showmore-btn");
  const wrap = document.getElementById("badge-showmore-wrap");
  if (!btn || !wrap) return;
  btn.addEventListener("click", async () => {
    showingAll = !showingAll;
    if (showingAll) {
      wrap.classList.remove("hidden");
      btn.textContent = "Show Less ↑";
      const all = document.getElementById("badge-fulllist");
      renderRows(all, await fetchAllBadges(), { showVote: !hasVoted() });
    } else {
      wrap.classList.add("hidden");
      btn.textContent = "Show More ↓";
    }
  });
}

export async function initChosenBadge() {
  wireShowMore();
  if (hasVoted()) showVotedNotice("You've already voted — thanks!");
  await refreshLeaderboard();
}

export { fetchTopBadges, fetchAllBadges, escapeHtml, refreshLeaderboard };

document.addEventListener("DOMContentLoaded", initChosenBadge);
