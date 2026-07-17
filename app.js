const STORAGE_KEY = "capsule.state.v1";

const DEFAULT_QUESTS = [
  {
    id: "candid",
    title: "The Candid",
    tag: "capture",
    desc: "Capture a moment without anyone noticing. The unposed ones are the ones worth keeping.",
  },
  {
    id: "ask-the-question",
    title: "Ask the Question",
    tag: "connect",
    desc: '“20 years from now, what do you think you’ll remember from this?” Ask someone and record the answer.',
  },
  {
    id: "inside-joke",
    title: "Inside Joke",
    tag: "connect",
    desc: "Start one, or catch one already happening. Write down enough that future-you still gets it.",
  },
  {
    id: "say-the-thing",
    title: "Say the Thing",
    tag: "brave",
    desc: "Tell someone something you don’t usually say out loud.",
  },
  {
    id: "small-brave-thing",
    title: "Small Brave Thing",
    tag: "brave",
    desc: "Do one thing today that scares you a little.",
  },
  {
    id: "lend-a-hand",
    title: "Lend a Hand",
    tag: "build",
    desc: "Help someone with a project — home, car, whatever they need.",
  },
  {
    id: "open-door",
    title: "Open Door",
    tag: "build",
    desc: "Host someone at your place sometime soon.",
  },
  {
    id: "pay-it-forward",
    title: "Pay It Forward",
    tag: "brave",
    desc: "Do something kind for a stranger. No credit necessary.",
  },
];

let state = loadState();
let activeTab = "quests";
let openQuestId = null;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return {
    tripName: "",
    keeperName: "",
    createdAt: Date.now(),
    quests: DEFAULT_QUESTS.map((q) => ({ ...q, status: "available", artifact: null })),
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("is-shown");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("is-shown"), 1800);
}

function completedCount() {
  return state.quests.filter((q) => q.status === "complete").length;
}

function levelInfo() {
  const done = completedCount();
  const total = state.quests.length;
  const level = 1 + Math.floor(done / 3);
  const inLevel = done % 3;
  return { done, total, level, pct: total ? (done / total) * 100 : 0, inLevel };
}

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function render() {
  document.getElementById("levelBadge").textContent = `Keeper Lv.${levelInfo().level}`;
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.tab === activeTab);
  });

  const app = document.getElementById("app");
  if (activeTab === "quests") app.innerHTML = renderQuests();
  else if (activeTab === "capsule") app.innerHTML = renderCapsule();
  else app.innerHTML = renderTrip();

  wireTabContent();

  if (openQuestId) renderQuestModal(openQuestId);
}

function renderQuests() {
  const { done, total, pct, level, inLevel } = levelInfo();
  const active = state.quests.filter((q) => q.status !== "complete");
  const done_ = state.quests.filter((q) => q.status === "complete");

  const tripBanner = !state.tripName
    ? `<div class="empty" style="padding:14px 12px;margin-bottom:16px;border:1px dashed var(--card-border);border-radius:12px;">Name this trip in the <b>Trip</b> tab before you start — it labels every artifact you seal.</div>`
    : "";

  const cards = active
    .map(
      (q) => `
    <div class="quest-card">
      <div class="quest-title-row">
        <span class="quest-title">${q.title}</span>
        <span class="quest-tag">${q.tag}</span>
      </div>
      <div class="quest-desc">${q.desc}</div>
      <div class="quest-actions">
        <button class="primary" data-open="${q.id}">Complete quest</button>
      </div>
    </div>`
    )
    .join("");

  const doneCards = done_
    .map(
      (q) => `
    <div class="quest-card is-complete">
      <div class="quest-title-row">
        <span class="quest-title">${q.title}</span>
        <span class="done-check">✓ sealed</span>
      </div>
    </div>`
    )
    .join("");

  return `
    ${tripBanner}
    <div class="xp-wrap">
      <div class="xp-track"><div class="xp-fill" style="width:${(inLevel / 3) * 100}%"></div></div>
      <div class="xp-label">${done} / ${total} quests sealed into the capsule</div>
    </div>
    <h2 class="section-title">Open quests</h2>
    ${cards || `<div class="empty">All quests complete. Go start a new trip in the Trip tab.</div>`}
    ${done_.length ? `<h2 class="section-title">Completed</h2>${doneCards}` : ""}
  `;
}

function renderCapsule() {
  const items = state.quests.filter((q) => q.artifact);
  if (!items.length) {
    return `<div class="empty">Nothing sealed yet.<br>Complete a quest to add the first artifact to the capsule.</div>`;
  }
  const now = Date.now();
  return items
    .map((q) => {
      const a = q.artifact;
      const sealed = a.unlockAt > now;
      const peeked = a.peeked;
      const showContent = !sealed || peeked;
      return `
      <div class="artifact-card ${sealed && !peeked ? "is-sealed" : ""}">
        <div class="artifact-head">
          <span class="artifact-quest">${q.title}</span>
          <span class="lock-badge">${sealed ? "🔒 opens " + fmtDate(a.unlockAt) : "🔓 unlocked " + fmtDate(a.unlockAt)}</span>
        </div>
        ${
          showContent
            ? `
          ${a.photo ? `<img class="artifact-photo" src="${a.photo}" alt="">` : ""}
          <div class="artifact-note">${escapeHtml(a.note) || "<i>No note left.</i>"}</div>
          <div class="artifact-meta">${state.tripName || "Untitled trip"} · sealed ${fmtDate(a.completedAt)}</div>
        `
            : `
          <div class="seal-note">Sealed by ${escapeHtml(a.by) || "a keeper"} on ${fmtDate(a.completedAt)}. Come back on the unlock date to open it.</div>
          <button class="ghost peek-btn" data-peek="${q.id}">Peek anyway (demo only)</button>
        `
        }
      </div>`;
    })
    .join("");
}

function renderTrip() {
  const { done, total, level } = levelInfo();
  return `
    <h2 class="section-title">This trip</h2>
    <div class="trip-card">
      <label class="field-label">Trip name</label>
      <input type="text" id="tripNameInput" value="${escapeAttr(state.tripName)}" placeholder="e.g. Big Bend 2026">
      <label class="field-label">Your name (shown on artifacts)</label>
      <input type="text" id="keeperNameInput" value="${escapeAttr(state.keeperName)}" placeholder="e.g. Diego">
    </div>
    <h2 class="section-title">Progress</h2>
    <div class="trip-card">
      <div class="stat-row"><span>Keeper level</span><span class="stat-val">${level}</span></div>
      <div class="stat-row"><span>Quests sealed</span><span class="stat-val">${done} / ${total}</span></div>
      <div class="stat-row"><span>Started</span><span class="stat-val">${fmtDate(state.createdAt)}</span></div>
    </div>
    <h2 class="section-title">Reset</h2>
    <div class="trip-card">
      <button class="danger" id="resetBtn">Start a new trip (clears this capsule)</button>
    </div>
    <div class="empty" style="text-align:left;padding:10px 4px;">This demo saves locally on this phone only — there’s no shared sync between devices yet.</div>
  `;
}

function wireTabContent() {
  document.querySelectorAll("[data-open]").forEach((btn) => {
    btn.onclick = () => {
      openQuestId = btn.dataset.open;
      render();
    };
  });
  document.querySelectorAll("[data-peek]").forEach((btn) => {
    btn.onclick = () => {
      const q = state.quests.find((x) => x.id === btn.dataset.peek);
      q.artifact.peeked = true;
      saveState();
      render();
    };
  });

  const tripInput = document.getElementById("tripNameInput");
  if (tripInput) {
    tripInput.onchange = () => {
      state.tripName = tripInput.value.trim();
      saveState();
      toast("Trip name saved");
    };
  }
  const keeperInput = document.getElementById("keeperNameInput");
  if (keeperInput) {
    keeperInput.onchange = () => {
      state.keeperName = keeperInput.value.trim();
      saveState();
    };
  }
  const resetBtn = document.getElementById("resetBtn");
  if (resetBtn) {
    resetBtn.onclick = () => {
      if (!confirm("This clears every quest and artifact on this device. Continue?")) return;
      state = {
        tripName: "",
        keeperName: "",
        createdAt: Date.now(),
        quests: DEFAULT_QUESTS.map((q) => ({ ...q, status: "available", artifact: null })),
      };
      saveState();
      activeTab = "quests";
      render();
    };
  }
}

function renderQuestModal(questId) {
  const q = state.quests.find((x) => x.id === questId);
  if (!q) {
    openQuestId = null;
    return;
  }
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-title">${q.title}</div>
      <div class="modal-sub">${q.desc}</div>

      <label class="field-label">What happened?</label>
      <textarea id="artNote" placeholder="Enough detail that it makes sense in 10 years..."></textarea>

      <label class="field-label">Photo (optional)</label>
      <div class="photo-input-row">
        <input type="file" accept="image/*" capture="environment" id="artPhoto">
        <img id="photoPreview" class="photo-preview" style="display:none;">
      </div>

      <label class="field-label">Unlock in (years)</label>
      <input type="number" id="artYears" value="10" min="0" max="30">

      <div class="modal-actions">
        <button class="ghost" id="modalCancel">Cancel</button>
        <button class="primary" id="modalSeal">Seal into capsule</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  let photoDataUrl = null;
  const photoInput = wrap.querySelector("#artPhoto");
  const preview = wrap.querySelector("#photoPreview");
  photoInput.onchange = async () => {
    const file = photoInput.files[0];
    if (!file) return;
    photoDataUrl = await compressImage(file);
    preview.src = photoDataUrl;
    preview.style.display = "block";
  };

  wrap.querySelector("#modalCancel").onclick = () => {
    document.body.removeChild(wrap);
    openQuestId = null;
  };

  wrap.querySelector("#modalSeal").onclick = () => {
    const note = wrap.querySelector("#artNote").value.trim();
    const years = parseFloat(wrap.querySelector("#artYears").value) || 0;
    const now = Date.now();
    q.status = "complete";
    q.artifact = {
      note,
      photo: photoDataUrl,
      by: state.keeperName,
      completedAt: now,
      unlockAt: now + years * 365.25 * 24 * 60 * 60 * 1000,
      peeked: years <= 0,
    };
    saveState();
    document.body.removeChild(wrap);
    openQuestId = null;
    render();
    toast("Sealed into the capsule");
  };
}

function compressImage(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 900;
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.75));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function escapeAttr(str) {
  return escapeHtml(str || "");
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.onclick = () => {
    activeTab = btn.dataset.tab;
    openQuestId = null;
    render();
  };
});

render();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}
