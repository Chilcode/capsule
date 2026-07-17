const STORAGE_KEY = "capsule.state.v1";

const SUPABASE_URL = "https://ivksvocciabqjzeyuxxd.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_T3te-0JZ9g35P-ElTOdFZQ_07I8oYy5";
const sb =
  typeof window !== "undefined" && window.supabase
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

const POINTS = { quest: 10, chore: 3, mafiaWin: 15 };
const CAPSULE_UNLOCK_COST = 20;

let pointEvents = [];
let pointTotals = {};
let boardLoaded = false;

function computeTotals(events) {
  const totals = {};
  events.forEach((e) => {
    totals[e.camper_name] = (totals[e.camper_name] || 0) + e.amount;
  });
  return totals;
}

async function fetchPointEvents() {
  if (!sb) return;
  try {
    const { data, error } = await sb
      .from("point_events")
      .select("*")
      .eq("trip", state.tripName || "default")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return;
    pointEvents = data || [];
    pointTotals = computeTotals(pointEvents);
    boardLoaded = true;
    if (activeTab === "board" || activeTab === "capsule") render();
  } catch (e) {
    // offline or unreachable — keep showing whatever we already had
  }
}

async function addPoints(camperName, amount, source, label) {
  const name = camperName || "Someone";
  // optimistic local update so it feels instant even before the network round-trip
  pointTotals[name] = (pointTotals[name] || 0) + amount;
  pointEvents = [
    { camper_name: name, amount, source, label, created_at: new Date().toISOString() },
    ...pointEvents,
  ];
  if (!sb) return;
  try {
    await sb.from("point_events").insert({
      trip: state.tripName || "default",
      camper_name: name,
      amount,
      source,
      label,
    });
    fetchPointEvents();
  } catch (e) {
    // offline — points still counted locally, will drift back in sync once reconnected
  }
}

async function syncQuestArtifact(q) {
  if (!sb) return;
  try {
    await sb.from("quest_artifacts").insert({
      trip: state.tripName || "default",
      camper_name: state.keeperName || "Someone",
      quest_id: q.id,
      quest_title: q.title,
      note: q.artifact.note || null,
      photo: q.artifact.photo || null,
      unlock_at: new Date(q.artifact.unlockAt).toISOString(),
    });
  } catch (e) {
    // offline — the memory is still safe locally, just not backed up yet
  }
}

async function syncMafiaGame(m) {
  if (!sb) return;
  try {
    await sb.from("mafia_games").insert({
      trip: state.tripName || "default",
      players: state.campers.map((c) => ({ name: c.name, role: m.killerIds.includes(c.id) ? "killer" : "town" })),
      eliminated: m.eliminated.map((e) => ({ name: camperName(e.camperId), round: e.round, phase: e.phase, wasKiller: e.wasKiller })),
      winner: m.winner,
      rounds: m.round,
    });
  } catch (e) {
    // offline — game result stays local only for now
  }
}

function timeAgo(ts) {
  const secs = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

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

const CHORES = [
  { id: "dishes", label: "Wash the dishes", category: "cleanup" },
  { id: "tidy-camp", label: "Tidy up the place", category: "cleanup" },
  { id: "trash-run", label: "Pack out the trash", category: "cleanup" },
  { id: "police-brass", label: "Police the brass after shooting", category: "cleanup" },
  { id: "start-fire", label: "Start the fire", category: "fire" },
  { id: "tend-fire", label: "Keep the fire fed", category: "fire" },
  { id: "cook-meal", label: "Cook a meal", category: "cook" },
  { id: "wash-cookware", label: "Scrub the pots and pans", category: "cook" },
  { id: "haul-water", label: "Haul water", category: "water" },
  { id: "float-cooler", label: "Load the cooler for the float", category: "logistics" },
  { id: "ice-run", label: "Ice / beer run", category: "logistics" },
  { id: "atv-fuel", label: "Fuel up / hose off the four-wheelers", category: "gear" },
  { id: "set-up-camp", label: "Set up camp / unload gear", category: "setup" },
  { id: "break-down-camp", label: "Break down camp / load out", category: "setup" },
];

const TITLE_DEFS = [
  { category: "cleanup", categoryLabel: "Cleanup", title: "Most Cleanly Camper" },
  { category: "fire", categoryLabel: "Fire", title: "Fire Keeper" },
  { category: "cook", categoryLabel: "Cooking", title: "Head Chef" },
  { category: "water", categoryLabel: "Water", title: "Water Bearer" },
  { category: "logistics", categoryLabel: "Logistics", title: "Logistics Wizard" },
  { category: "gear", categoryLabel: "Gear", title: "Gear Head" },
  { category: "setup", categoryLabel: "Setup", title: "Camp Architect" },
];

let state = loadState();
let activeTab = "quests";
let openQuestId = null;
let mafiaRevealShown = false;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!parsed.campers) parsed.campers = [];
      if (!parsed.choreLog) parsed.choreLog = [];
      if (parsed.mafia === undefined) parsed.mafia = null;
      return parsed;
    }
  } catch (e) {}
  return {
    tripName: "",
    keeperName: "",
    createdAt: Date.now(),
    quests: DEFAULT_QUESTS.map((q) => ({ ...q, status: "available", artifact: null })),
    campers: [],
    choreLog: [],
    mafia: null,
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
  else if (activeTab === "chores") app.innerHTML = renderChores();
  else if (activeTab === "mafia") app.innerHTML = renderMafia();
  else if (activeTab === "capsule") app.innerHTML = renderCapsule();
  else if (activeTab === "board") app.innerHTML = renderBoard();
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
  const nameBanner =
    state.tripName && !state.keeperName
      ? `<div class="empty" style="padding:14px 12px;margin-bottom:16px;border:1px dashed var(--card-border);border-radius:12px;">Set your name in the <b>Trip</b> tab so the group scoreboard knows it's you.</div>`
      : "";

  const cards = active
    .map(
      (q) => `
    <div class="quest-card">
      <div class="quest-title-row">
        <span class="quest-title">${q.title}</span>
        <span class="quest-tag">+${POINTS.quest} · ${q.tag}</span>
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
    ${nameBanner}
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
          <button class="ghost peek-btn" data-spend="${q.id}">Spend ${CAPSULE_UNLOCK_COST} points to open early</button>
        `
        }
      </div>`;
    })
    .join("");
}

function computeLeaderboard() {
  const totals = {};
  state.campers.forEach((c) => (totals[c.id] = { total: 0 }));
  state.choreLog.forEach((entry) => {
    const chore = CHORES.find((c) => c.id === entry.choreId);
    if (!chore || !totals[entry.camperId]) return;
    totals[entry.camperId][chore.category] = (totals[entry.camperId][chore.category] || 0) + 1;
    totals[entry.camperId].total += 1;
  });
  return totals;
}

function topBy(totals, key) {
  let max = 0;
  let names = [];
  state.campers.forEach((c) => {
    const count = (totals[c.id] && totals[c.id][key]) || 0;
    if (count === 0) return;
    if (count > max) {
      max = count;
      names = [c.name];
    } else if (count === max) {
      names.push(c.name);
    }
  });
  return max > 0 ? { count: max, names } : null;
}

function renderChores() {
  const totals = computeLeaderboard();
  const mvp = topBy(totals, "total");

  const camperChips =
    state.campers
      .map(
        (c) =>
          `<span class="chip">${escapeHtml(c.name)} <button class="chip-remove" data-remove-camper="${c.id}">×</button></span>`
      )
      .join("") || `<span class="empty" style="padding:0;">No campers yet.</span>`;

  const titleCards = TITLE_DEFS.map((t) => {
    const leader = topBy(totals, t.category);
    return `
      <div class="trip-card title-card">
        <div>
          <div class="title-name">${t.title}</div>
          <div class="title-sub">${t.categoryLabel}</div>
        </div>
        <div class="title-holder">${leader ? escapeHtml(leader.names.join(" & ")) + " · " + leader.count : "—"}</div>
      </div>`;
  }).join("");

  const choresByCategory = {};
  CHORES.forEach((c) => {
    (choresByCategory[c.category] = choresByCategory[c.category] || []).push(c);
  });

  const choreSections = TITLE_DEFS.map((t) => {
    const rows = (choresByCategory[t.category] || [])
      .map(
        (c) => `
      <div class="chore-row">
        <div class="chore-label">${c.label}</div>
        <button class="primary" data-log-chore="${c.id}">+${POINTS.chore} · Log</button>
      </div>`
      )
      .join("");
    return rows ? `<h2 class="section-title">${t.categoryLabel}</h2>${rows}` : "";
  }).join("");

  const recent = state.choreLog
    .slice()
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 6)
    .map((entry) => {
      const chore = CHORES.find((c) => c.id === entry.choreId);
      const camper = state.campers.find((c) => c.id === entry.camperId);
      return `
      <div class="log-row">
        <span>${escapeHtml(camper ? camper.name : "someone")} — ${chore ? chore.label : "a chore"}</span>
        <button class="log-undo" data-undo-log="${entry.id}">undo</button>
      </div>`;
    })
    .join("");

  return `
    <h2 class="section-title">Titles</h2>
    <div class="trip-card title-card" style="border-color:var(--gold-dim);">
      <div>
        <div class="title-name">MVP Camper</div>
        <div class="title-sub">Most chores overall</div>
      </div>
      <div class="title-holder">${mvp ? escapeHtml(mvp.names.join(" & ")) + " · " + mvp.count : "—"}</div>
    </div>
    ${titleCards}

    <h2 class="section-title">Campers</h2>
    <div class="trip-card">
      <div class="chip-row">${camperChips}</div>
      <label class="field-label">Add a camper</label>
      <div class="photo-input-row">
        <input type="text" id="newCamperName2" placeholder="Name">
        <button class="ghost" id="addCamperBtn">Add</button>
      </div>
    </div>

    ${choreSections}

    ${recent ? `<h2 class="section-title">Recent</h2><div class="trip-card">${recent}</div>` : ""}
  `;
}

const SOURCE_ICON = { quest: "🗝️", chore: "🏕️", mafia: "🔪", capsule_spend: "🔓" };

function renderBoard() {
  if (!sb) {
    return `<div class="empty">The scoreboard needs a connection to load. It'll show up here once you're online.</div>`;
  }
  if (!boardLoaded) {
    return `<div class="empty">Loading the group scoreboard…</div>`;
  }

  const ranked = Object.entries(pointTotals).sort((a, b) => b[1] - a[1]);
  const leaderRows = ranked
    .map(
      ([name, total], i) => `
    <div class="stat-row">
      <span>${i === 0 && total > 0 ? "👑 " : ""}${escapeHtml(name)}</span>
      <span class="stat-val">${total} pts</span>
    </div>`
    )
    .join("");

  const feedRows = pointEvents
    .slice(0, 30)
    .map(
      (e) => `
    <div class="log-row">
      <span>${SOURCE_ICON[e.source] || "•"} ${escapeHtml(e.camper_name)} — ${escapeHtml(e.label)}</span>
      <span>${e.amount > 0 ? "+" : ""}${e.amount} · ${timeAgo(e.created_at)}</span>
    </div>`
    )
    .join("");

  return `
    <h2 class="section-title">🌐 Group scoreboard</h2>
    <div class="empty" style="text-align:left;padding:0 0 14px;">
      Everyone on this trip, everyone's phone. Earn points from Quests, Camp chores, and Mafia — spend them in Capsule to open a sealed memory early.
    </div>
    <div class="trip-card">
      ${leaderRows || `<div class="empty" style="padding:6px 0;">No points yet — go complete something.</div>`}
    </div>
    <h2 class="section-title">Activity</h2>
    <div class="trip-card">
      ${feedRows || `<div class="empty" style="padding:6px 0;">Nothing logged yet.</div>`}
    </div>
  `;
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
    <div class="empty" style="text-align:left;padding:10px 4px;">Points from Quests, Camp chores, and Mafia sync to everyone's phone when you're online — check the <b>Board</b> tab. Sealed memories (notes/photos) and Mafia game results are also backed up to the cloud so this whole trip survives even if this phone doesn't. The camper list itself is still local to each device.</div>
  `;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function camperName(id) {
  const c = state.campers.find((x) => x.id === id);
  return c ? c.name : "Unknown";
}

function mafiaCheckWin(m) {
  const aliveKillers = m.aliveIds.filter((id) => m.killerIds.includes(id)).length;
  const aliveTown = m.aliveIds.length - aliveKillers;
  if (aliveKillers === 0) return "town";
  if (aliveKillers >= aliveTown) return "mafia";
  return null;
}

function startMafiaGame(killerCount) {
  const ids = state.campers.map((c) => c.id);
  state.mafia = {
    phase: "reveal",
    round: 1,
    killerIds: shuffle(ids).slice(0, killerCount),
    aliveIds: ids.slice(),
    eliminated: [],
    revealOrder: shuffle(ids),
    revealIndex: 0,
    winner: null,
  };
  mafiaRevealShown = false;
  saveState();
  render();
}

function mafiaEliminate(camperId, phase) {
  const m = state.mafia;
  m.aliveIds = m.aliveIds.filter((id) => id !== camperId);
  m.eliminated.push({ camperId, round: m.round, phase, wasKiller: m.killerIds.includes(camperId) });
  const winner = mafiaCheckWin(m);
  if (winner) {
    m.winner = winner;
    m.phase = "over";
    const winningIds = state.campers
      .map((c) => c.id)
      .filter((id) => (winner === "mafia" ? m.killerIds.includes(id) : !m.killerIds.includes(id)));
    winningIds.forEach((id) => {
      addPoints(camperName(id), POINTS.mafiaWin, "mafia", winner === "mafia" ? "Killers won the round" : "Town found the Killers");
    });
    syncMafiaGame(m);
  } else if (phase === "night") {
    m.phase = "day";
  } else {
    m.phase = "night";
    m.round += 1;
  }
  saveState();
  render();
}

function mafiaSkip(phase) {
  const m = state.mafia;
  if (phase === "night") {
    m.phase = "day";
  } else {
    m.phase = "night";
    m.round += 1;
  }
  saveState();
  render();
}

function renderMafia() {
  const m = state.mafia;
  if (!m) return renderMafiaSetup();
  if (m.phase === "reveal") return renderMafiaReveal(m);
  if (m.phase === "night") return renderMafiaPhase(m, "night");
  if (m.phase === "day") return renderMafiaPhase(m, "day");
  if (m.phase === "over") return renderMafiaOver(m);
  return renderMafiaSetup();
}

function renderMafiaSetup() {
  const count = state.campers.length;
  const suggested = Math.max(1, Math.round(count / 4)) || 1;
  const chips =
    state.campers.map((c) => `<span class="chip">${escapeHtml(c.name)}</span>`).join("") ||
    `<span class="empty" style="padding:0;">No campers yet — add some in the Camp tab.</span>`;
  const canStart = count >= 3;
  return `
    <h2 class="section-title">Mafia</h2>
    <div class="trip-card">
      <div class="chip-row">${chips}</div>
      <div class="empty" style="text-align:left;padding:10px 0 0;">
        Some of you are secretly Killers. Pass one phone around — each player privately
        sees their own role, then hides it and passes it on. Killers try not to get caught;
        everyone else tries to catch them before it's too late.
      </div>
      <label class="field-label">How many Killers?</label>
      <input type="number" id="mafiaKillerCount" value="${suggested}" min="1" max="${Math.max(1, count - 1)}">
      <div class="modal-actions">
        <button class="primary" id="mafiaStartBtn" ${canStart ? "" : "disabled"}>Assign roles &amp; start</button>
      </div>
      ${canStart ? "" : `<div class="empty" style="text-align:left;padding:10px 0 0;">Need at least 3 campers — add them in the Camp tab first.</div>`}
    </div>
  `;
}

function renderMafiaReveal(m) {
  const id = m.revealOrder[m.revealIndex];
  const name = camperName(id);
  const isKiller = m.killerIds.includes(id);

  if (!mafiaRevealShown) {
    return `
      <h2 class="section-title">Pass the phone</h2>
      <div class="trip-card" style="text-align:center;">
        <div class="title-name" style="font-size:1.2em;margin-bottom:10px;">Hand the phone to<br>${escapeHtml(name)}</div>
        <div class="empty" style="padding:6px 0 16px;">Everyone else look away.</div>
        <button class="primary" id="mafiaRevealBtn">I'm ${escapeHtml(name)} — show my role</button>
      </div>
      <div class="empty" style="text-align:left;padding:14px 4px 0;">${m.revealIndex + 1} of ${m.revealOrder.length} players</div>
    `;
  }

  return `
    <h2 class="section-title">Your role</h2>
    <div class="trip-card" style="text-align:center;border-color:${isKiller ? "#d98080" : "var(--gold-dim)"};">
      <div style="font-size:2.5em;margin-bottom:6px;">${isKiller ? "🔪" : "👤"}</div>
      <div class="title-name" style="font-size:1.15em;">${isKiller ? "You are a Killer" : "You are a Townsperson"}</div>
      <div class="empty" style="padding:8px 0 16px;">${
        isKiller
          ? "Blend in. You and any other Killers secretly choose a target each night."
          : "Find the Killers before they find you."
      }</div>
      <button class="ghost" id="mafiaNextBtn">Hide it — pass to the next player</button>
    </div>
  `;
}

function renderMafiaPhase(m, phaseName) {
  const isNight = phaseName === "night";
  const aliveRows = m.aliveIds
    .map(
      (id) => `
    <div class="chore-row">
      <div class="chore-label">${escapeHtml(camperName(id))}</div>
      <button class="danger" data-eliminate="${id}">${isNight ? "Killed" : "Voted out"}</button>
    </div>`
    )
    .join("");

  const eliminatedRows = m.eliminated
    .slice()
    .reverse()
    .map(
      (e) => `
    <div class="log-row">
      <span>${escapeHtml(camperName(e.camperId))} — ${e.wasKiller ? "was a Killer 🔪" : "was a Townsperson 👤"} (${e.phase}, round ${e.round})</span>
    </div>`
    )
    .join("");

  return `
    <h2 class="section-title">Round ${m.round} — ${isNight ? "Night" : "Day"}</h2>
    <div class="trip-card">
      <div class="empty" style="text-align:left;padding:0;">
        ${
          isNight
            ? "🌙 Everyone close your eyes. Killers, open yours and silently point to a target."
            : "☀️ Discuss out loud, then vote someone out — or skip the vote."
        }
      </div>
    </div>
    <h2 class="section-title">${m.aliveIds.length} alive</h2>
    ${aliveRows}
    <div class="trip-card">
      <button class="ghost" id="mafiaSkipBtn">${isNight ? "No one was killed" : "Skip the vote"}</button>
    </div>
    ${eliminatedRows ? `<h2 class="section-title">Eliminated</h2><div class="trip-card">${eliminatedRows}</div>` : ""}
  `;
}

function renderMafiaOver(m) {
  const killers = m.killerIds.map((id) => camperName(id)).join(", ");
  return `
    <h2 class="section-title">Game over</h2>
    <div class="trip-card" style="text-align:center;border-color:${m.winner === "mafia" ? "#d98080" : "var(--gold-dim)"};">
      <div style="font-size:2.5em;margin-bottom:6px;">${m.winner === "mafia" ? "🔪" : "🏆"}</div>
      <div class="title-name" style="font-size:1.2em;">${m.winner === "mafia" ? "The Killers win" : "The Townspeople win"}</div>
      <div class="empty" style="padding:10px 0;">Killers were: ${escapeHtml(killers)}</div>
      <button class="primary" id="mafiaNewGameBtn">Play again</button>
    </div>
  `;
}

function wireTabContent() {
  document.querySelectorAll("[data-open]").forEach((btn) => {
    btn.onclick = () => {
      openQuestId = btn.dataset.open;
      render();
    };
  });
  document.querySelectorAll("[data-spend]").forEach((btn) => {
    btn.onclick = () => openSpendPicker(btn.dataset.spend);
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
      if (!confirm("This clears every quest, artifact, camper, and chore log on this device. Continue?")) return;
      state = {
        tripName: "",
        keeperName: "",
        createdAt: Date.now(),
        quests: DEFAULT_QUESTS.map((q) => ({ ...q, status: "available", artifact: null })),
        campers: [],
        choreLog: [],
        mafia: null,
      };
      saveState();
      activeTab = "quests";
      render();
    };
  }

  document.querySelectorAll("[data-log-chore]").forEach((btn) => {
    btn.onclick = () => openCamperPicker(btn.dataset.logChore);
  });
  document.querySelectorAll("[data-remove-camper]").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.removeCamper;
      state.campers = state.campers.filter((c) => c.id !== id);
      state.choreLog = state.choreLog.filter((e) => e.camperId !== id);
      saveState();
      render();
    };
  });
  document.querySelectorAll("[data-undo-log]").forEach((btn) => {
    btn.onclick = () => {
      state.choreLog = state.choreLog.filter((e) => e.id !== btn.dataset.undoLog);
      saveState();
      render();
    };
  });

  const addCamperBtn = document.getElementById("addCamperBtn");
  if (addCamperBtn) {
    addCamperBtn.onclick = () => {
      const input = document.getElementById("newCamperName2");
      const name = input.value.trim();
      if (!name) return;
      state.campers.push({ id: `c-${Date.now()}`, name });
      saveState();
      render();
    };
  }

  const mafiaStartBtn = document.getElementById("mafiaStartBtn");
  if (mafiaStartBtn) {
    mafiaStartBtn.onclick = () => {
      const input = document.getElementById("mafiaKillerCount");
      const count = Math.max(1, Math.min(state.campers.length - 1, parseInt(input.value, 10) || 1));
      startMafiaGame(count);
    };
  }
  const mafiaRevealBtn = document.getElementById("mafiaRevealBtn");
  if (mafiaRevealBtn) {
    mafiaRevealBtn.onclick = () => {
      mafiaRevealShown = true;
      render();
    };
  }
  const mafiaNextBtn = document.getElementById("mafiaNextBtn");
  if (mafiaNextBtn) {
    mafiaNextBtn.onclick = () => {
      const m = state.mafia;
      m.revealIndex += 1;
      mafiaRevealShown = false;
      if (m.revealIndex >= m.revealOrder.length) m.phase = "night";
      saveState();
      render();
    };
  }
  document.querySelectorAll("[data-eliminate]").forEach((btn) => {
    btn.onclick = () => mafiaEliminate(btn.dataset.eliminate, state.mafia.phase);
  });
  const mafiaSkipBtn = document.getElementById("mafiaSkipBtn");
  if (mafiaSkipBtn) {
    mafiaSkipBtn.onclick = () => mafiaSkip(state.mafia.phase);
  }
  const mafiaNewGameBtn = document.getElementById("mafiaNewGameBtn");
  if (mafiaNewGameBtn) {
    mafiaNewGameBtn.onclick = () => {
      state.mafia = null;
      saveState();
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
    addPoints(state.keeperName || "Someone", POINTS.quest, "quest", q.title);
    syncQuestArtifact(q);
    document.body.removeChild(wrap);
    openQuestId = null;
    render();
    toast(`Sealed into the capsule (+${POINTS.quest} pts)`);
  };
}

function openCamperPicker(choreId) {
  const chore = CHORES.find((c) => c.id === choreId);
  if (!chore) return;

  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-title">${chore.label}</div>
      <div class="modal-sub">Who did it?</div>
      <div class="chip-row">
        ${
          state.campers
            .map((c) => `<button class="chip" data-pick="${c.id}">${escapeHtml(c.name)}</button>`)
            .join("") || `<span class="empty" style="padding:0;">No campers yet — add one below.</span>`
        }
      </div>
      <label class="field-label">Add a camper</label>
      <div class="photo-input-row">
        <input type="text" id="newCamperName" placeholder="Name">
        <button class="ghost" id="addCamperInline">Add</button>
      </div>
      <div class="modal-actions">
        <button class="ghost" id="pickerCancel">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  function logFor(camperId) {
    state.choreLog.push({
      id: `l-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      camperId,
      choreId,
      ts: Date.now(),
    });
    saveState();
    const camper = state.campers.find((c) => c.id === camperId);
    addPoints(camper ? camper.name : "Someone", POINTS.chore, "chore", chore.label);
    document.body.removeChild(wrap);
    render();
    toast(`Logged for ${camper ? camper.name : "camper"} (+${POINTS.chore} pts)`);
  }

  wrap.querySelectorAll("[data-pick]").forEach((btn) => {
    btn.onclick = () => logFor(btn.dataset.pick);
  });

  wrap.querySelector("#addCamperInline").onclick = () => {
    const input = wrap.querySelector("#newCamperName");
    const name = input.value.trim();
    if (!name) return;
    state.campers.push({ id: `c-${Date.now()}`, name });
    saveState();
    document.body.removeChild(wrap);
    render();
    openCamperPicker(choreId);
  };

  wrap.querySelector("#pickerCancel").onclick = () => {
    document.body.removeChild(wrap);
  };
}

function openSpendPicker(questId) {
  const q = state.quests.find((x) => x.id === questId);
  if (!q) return;

  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-title">Spend ${CAPSULE_UNLOCK_COST} points</div>
      <div class="modal-sub">Whose points are paying to open "${escapeHtml(q.title)}" early?</div>
      <div class="chip-row">
        ${
          state.campers
            .map((c) => `<button class="chip" data-pick="${c.id}">${escapeHtml(c.name)} · ${pointTotals[c.name] || 0} pts</button>`)
            .join("") || `<span class="empty" style="padding:0;">No campers yet — add one below.</span>`
        }
      </div>
      <label class="field-label">Or type a name</label>
      <div class="photo-input-row">
        <input type="text" id="spendName" placeholder="Name">
        <button class="ghost" id="spendConfirm">Spend</button>
      </div>
      <div class="modal-actions">
        <button class="ghost" id="spendCancel">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  function trySpend(name) {
    const balance = pointTotals[name] || 0;
    if (balance < CAPSULE_UNLOCK_COST) {
      toast(`${name} only has ${balance} points — needs ${CAPSULE_UNLOCK_COST}`);
      return;
    }
    addPoints(name, -CAPSULE_UNLOCK_COST, "capsule_spend", `Opened "${q.title}" early`);
    q.artifact.peeked = true;
    saveState();
    document.body.removeChild(wrap);
    render();
    toast(`Opened early — ${CAPSULE_UNLOCK_COST} points spent`);
  }

  wrap.querySelectorAll("[data-pick]").forEach((btn) => {
    const c = state.campers.find((x) => x.id === btn.dataset.pick);
    btn.onclick = () => trySpend(c.name);
  });

  wrap.querySelector("#spendConfirm").onclick = () => {
    const name = wrap.querySelector("#spendName").value.trim();
    if (!name) return;
    trySpend(name);
  };

  wrap.querySelector("#spendCancel").onclick = () => {
    document.body.removeChild(wrap);
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
fetchPointEvents();
setInterval(fetchPointEvents, 7000);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}
