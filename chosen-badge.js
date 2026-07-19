import {
  db, collection, doc, getDoc, getDocs, query, orderBy, limit,
  serverTimestamp, writeBatch, increment,
} from "./firebase-init.js";

const VOTED_BADGE_KEY = "pow_voted_badge_id";
const TOP_N = 5;
const rowRotate = (i) => (i % 2 === 0 ? "rotate-1" : "rotate-2");
let pendingVoteBadgeId = null;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function hashEmail(email) {
  const normalized = email.trim().toLowerCase();
  const encoded = new TextEncoder().encode(normalized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
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
      btn.addEventListener("click", () => openVoteEmailModal(btn.dataset.badgeId));
    });
  }
}

function openVoteEmailModal(badgeId) {
  pendingVoteBadgeId = badgeId;
  document.getElementById("vote-email-error").classList.add("hidden");
  document.getElementById("vote-email-input").value = "";
  const modal = document.getElementById("vote-email-modal");
  modal.classList.remove("hidden-transition");
  modal.classList.add("visible-transition");
}

function closeVoteEmailModal() {
  const modal = document.getElementById("vote-email-modal");
  modal.classList.add("hidden-transition");
  modal.classList.remove("visible-transition");
  pendingVoteBadgeId = null;
}

function wireVoteEmailModal() {
  const cancelBtn = document.getElementById("vote-email-cancel");
  const form = document.getElementById("vote-email-form");
  if (cancelBtn) cancelBtn.addEventListener("click", closeVoteEmailModal);
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("vote-email-input").value;
      const badgeId = pendingVoteBadgeId;
      const submitBtn = form.querySelector("button[type=submit]");
      submitBtn.disabled = true;
      submitBtn.textContent = "Casting…";
      const ok = await castVote(badgeId, email);
      submitBtn.disabled = false;
      submitBtn.textContent = "Confirm Vote";
      if (ok) closeVoteEmailModal();
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

async function castVote(badgeId, email) {
  if (hasVoted() || !badgeId || !email) return false;

  // The vote-marker doc ID is a hash of the voter's email, not a random
  // client-generated ID — this is what makes "already voted" durable across
  // reloads/devices/cleared storage: it only resets if a different email is
  // used, not whenever local browser storage happens to get wiped.
  const voterHash = await hashEmail(email);
  const markerRef = doc(db, "voteMarkers", voterHash);
  const badgeRef = doc(db, "badges", badgeId);
  const batch = writeBatch(db);
  batch.set(markerRef, { badgeId, votedAt: serverTimestamp() });
  batch.update(badgeRef, { votes: increment(1) });

  try {
    await batch.commit();
    localStorage.setItem(VOTED_BADGE_KEY, badgeId);
    showVotedNotice();
    await refreshLeaderboard();
    return true;
  } catch (err) {
    // Marker already existed for this email's hash — genuinely already voted.
    document.getElementById("vote-email-error").classList.remove("hidden");
    console.warn("Vote failed:", err);
    return false;
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
  wireVoteEmailModal();
  if (hasVoted()) showVotedNotice("You've already voted — thanks!");
  await refreshLeaderboard();
}

export { fetchTopBadges, fetchAllBadges, escapeHtml, refreshLeaderboard };

document.addEventListener("DOMContentLoaded", initChosenBadge);
