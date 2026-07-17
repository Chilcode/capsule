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

// Poll results only trigger a re-render when data actually changed — otherwise
// every 7s tick replays entrance/reveal animations on unchanged content, which
// turns intentional motion (the Mafia role pop, card stagger) into noise.
function jsonEq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

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
    const changed = !boardLoaded || !jsonEq(pointEvents, data || []);
    pointEvents = data || [];
    pointTotals = computeTotals(pointEvents);
    boardLoaded = true;
    if (changed && (activeTab === "board" || activeTab === "capsule")) render();
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

async function syncMafiaGameFromSession(session, participants) {
  if (!sb) return;
  try {
    await sb.from("mafia_games").insert({
      trip: state.tripName || "default",
      players: participants.map((name) => ({ name, role: session.killer_names.includes(name) ? "killer" : "town" })),
      eliminated: session.eliminated,
      winner: session.winner,
      rounds: session.round,
    });
    fetchMafiaGames();
  } catch (e) {
    // offline — game result stays only in the live session for now
  }
}

let mafiaSession = null;

async function fetchMafiaSession() {
  if (!sb) return;
  try {
    const { data, error } = await sb
      .from("mafia_session")
      .select("*")
      .eq("trip", state.tripName || "default")
      .maybeSingle();
    if (error) return;
    const changed = !jsonEq(mafiaSession, data || null);
    mafiaSession = data || null;
    if (changed && activeTab === "mafia") render();
  } catch (e) {}
}

function camperKey(name) {
  return "c-" + (name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function addCamperLocal(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return null;
  const id = camperKey(trimmed);
  let camper = state.campers.find((c) => c.id === id);
  if (!camper) {
    camper = { id, name: trimmed };
    state.campers.push(camper);
    saveState();
  }
  syncCamper(trimmed);
  return camper;
}

async function syncCamper(name) {
  if (!sb) return;
  try {
    await sb.from("campers").insert({ trip: state.tripName || "default", name });
  } catch (e) {
    // duplicate name (already synced) or offline — either way, fine
  }
}

async function removeCamperSync(name) {
  if (!sb) return;
  try {
    await sb.from("campers").delete().eq("trip", state.tripName || "default").eq("name", name);
  } catch (e) {}
}

let remoteArtifacts = [];
let mafiaHistory = [];
let feedbackList = [];

async function fetchCampers() {
  if (!sb) return;
  try {
    const { data, error } = await sb.from("campers").select("*").eq("trip", state.tripName || "default");
    if (error) return;
    let changed = false;
    (data || []).forEach((row) => {
      const id = camperKey(row.name);
      if (!state.campers.find((c) => c.id === id)) {
        state.campers.push({ id, name: row.name });
        changed = true;
      }
    });
    if (changed) {
      saveState();
      if (activeTab === "chores" || activeTab === "mafia") render();
    }
  } catch (e) {}
}

async function fetchQuestArtifacts() {
  if (!sb) return;
  try {
    const { data, error } = await sb
      .from("quest_artifacts")
      .select("*")
      .eq("trip", state.tripName || "default")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return;
    const changed = !jsonEq(remoteArtifacts, data || []);
    remoteArtifacts = data || [];
    if (changed && activeTab === "capsule") render();
  } catch (e) {}
}

async function fetchMafiaGames() {
  if (!sb) return;
  try {
    const { data, error } = await sb
      .from("mafia_games")
      .select("*")
      .eq("trip", state.tripName || "default")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) return;
    const changed = !jsonEq(mafiaHistory, data || []);
    mafiaHistory = data || [];
    if (changed && activeTab === "mafia") render();
  } catch (e) {}
}

async function fetchFeedback() {
  if (!sb) return;
  try {
    const { data, error } = await sb
      .from("feedback")
      .select("*")
      .eq("trip", state.tripName || "default")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return;
    const changed = !jsonEq(feedbackList, data || []);
    feedbackList = data || [];
    if (changed && activeTab === "settings") render();
  } catch (e) {}
}

async function submitFeedback(category, message) {
  feedbackList = [
    { camper_name: state.keeperName || "Someone", category, message, created_at: new Date().toISOString() },
    ...feedbackList,
  ];
  if (!sb) return;
  try {
    await sb.from("feedback").insert({
      trip: state.tripName || "default",
      camper_name: state.keeperName || "Someone",
      category,
      message,
    });
    fetchFeedback();
  } catch (e) {}
}

async function syncAll() {
  await Promise.all([
    fetchPointEvents(),
    fetchCampers(),
    fetchQuestArtifacts(),
    fetchMafiaGames(),
    fetchMafiaSession(),
    fetchFeedback(),
  ]);
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
  {
    id: "cliff-send",
    title: "Cliff Send",
    tag: "brave",
    desc: "Jump off the cliff (safely). Capture someone's face mid-air — yours or theirs.",
  },
  {
    id: "river-story",
    title: "River Story",
    tag: "connect",
    desc: "While floating, ask someone about a time they almost gave up on something. Remember what they said.",
  },
  {
    id: "teach-something",
    title: "Teach Something",
    tag: "build",
    desc: "Teach someone here a skill you know — a knot, a card trick, changing a tire. Anything.",
  },
  {
    id: "the-toast",
    title: "The Toast",
    tag: "connect",
    desc: "Raise a toast to someone here, out loud, for a specific reason. Not just \"cheers.\"",
  },
  {
    id: "old-story-new-ears",
    title: "Old Story, New Ears",
    tag: "connect",
    desc: "Tell the whole version of a story from before this group knew each other — not the short version.",
  },
  {
    id: "night-sky",
    title: "Night Sky",
    tag: "capture",
    desc: "Step away from the fire for five minutes and look up. Write down one thing it made you think about.",
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

const FEEDBACK_CATEGORIES = [
  { id: "bug", label: "🐛 Bug" },
  { id: "idea", label: "💡 Idea" },
  { id: "love", label: "❤️ Love" },
  { id: "other", label: "💬 Other" },
];
const FEEDBACK_ICON = { bug: "🐛", idea: "💡", love: "❤️", other: "💬" };

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

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!parsed.campers) parsed.campers = [];
      if (!parsed.choreLog) parsed.choreLog = [];
      if (!parsed.peekedRemote) parsed.peekedRemote = [];
      delete parsed.mafia;
      if (parsed.quests) {
        const existingIds = new Set(parsed.quests.map((q) => q.id));
        DEFAULT_QUESTS.forEach((q) => {
          if (!existingIds.has(q.id)) parsed.quests.push({ ...q, status: "available", artifact: null });
        });
      }
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
    peekedRemote: [],
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
  const now = Date.now();

  const localItems = state.quests
    .filter((q) => q.artifact)
    .map((q) => ({
      title: q.title,
      by: q.artifact.by || "a keeper",
      note: q.artifact.note,
      photo: q.artifact.photo,
      unlockAt: q.artifact.unlockAt,
      completedAt: q.artifact.completedAt,
      sealed: q.artifact.unlockAt > now,
      peeked: q.artifact.peeked,
      spendTarget: q.id,
    }));

  const mine = new Set(
    state.quests.filter((q) => q.artifact).map((q) => `${state.keeperName}::${q.id}`)
  );

  const remoteItems = remoteArtifacts
    .filter((a) => !mine.has(`${a.camper_name}::${a.quest_id}`))
    .map((a) => {
      const unlockAt = new Date(a.unlock_at).getTime();
      return {
        title: a.quest_title,
        by: a.camper_name,
        note: a.note,
        photo: a.photo,
        unlockAt,
        completedAt: new Date(a.created_at).getTime(),
        sealed: unlockAt > now,
        peeked: state.peekedRemote.includes(a.id),
        spendTarget: `remote:${a.id}`,
      };
    });

  const items = [...localItems, ...remoteItems].sort((a, b) => b.completedAt - a.completedAt);

  if (!items.length) {
    return `<div class="empty">Nothing sealed yet — by anyone on this trip.<br>Complete a quest to add the first artifact to the capsule.</div>`;
  }

  return items
    .map((a) => {
      const showContent = !a.sealed || a.peeked;
      return `
      <div class="artifact-card ${a.sealed && !a.peeked ? "is-sealed" : ""}">
        <div class="artifact-head">
          <span class="artifact-quest">${escapeHtml(a.title)}</span>
          <span class="lock-badge">${a.sealed ? "🔒 opens " + fmtDate(a.unlockAt) : "🔓 unlocked " + fmtDate(a.unlockAt)}</span>
        </div>
        ${
          showContent
            ? `
          ${a.photo ? `<img class="artifact-photo" src="${a.photo}" alt="">` : ""}
          <div class="artifact-note">${escapeHtml(a.note) || "<i>No note left.</i>"}</div>
          <div class="artifact-meta">${escapeHtml(a.by)} · ${state.tripName || "Untitled trip"} · sealed ${fmtDate(a.completedAt)}</div>
        `
            : `
          <div class="seal-note">Sealed by ${escapeHtml(a.by)} on ${fmtDate(a.completedAt)}. Come back on the unlock date to open it.</div>
          <button class="ghost peek-btn" data-spend="${a.spendTarget}">Spend ${CAPSULE_UNLOCK_COST} points to open early</button>
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
  const feedbackRows = feedbackList
    .slice(0, 15)
    .map(
      (f) => `
    <div class="log-row">
      <span>${FEEDBACK_ICON[f.category] || "💬"} ${escapeHtml(f.camper_name)} — ${escapeHtml(f.message)}</span>
      <span>${timeAgo(f.created_at)}</span>
    </div>`
    )
    .join("");
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
    <h2 class="section-title">Feedback</h2>
    <div class="trip-card">
      ${feedbackRows || `<div class="empty" style="padding:6px 0;">Nothing yet — tap the 💬 button anytime to leave feedback.</div>`}
    </div>
    <h2 class="section-title">Reset</h2>
    <div class="trip-card">
      <button class="danger" id="resetBtn">Start a new trip (clears this capsule)</button>
    </div>
    <div class="empty" style="text-align:left;padding:10px 4px;">Quests, Camp chores, Mafia, and Capsule all sync live to everyone's phone now — check the <b>Board</b> tab for the shared scoreboard. The camper roster syncs too; only which quests/chores you've marked "peeked" stays local to this device.</div>
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

function mafiaParticipants(session) {
  return Array.from(new Set([...session.alive_names, ...session.eliminated.map((e) => e.name)]));
}

async function startMafiaGame(killerCount) {
  if (!sb) {
    toast("Mafia plays live across phones now — needs a connection to start");
    return;
  }
  const names = state.campers.map((c) => c.name);
  const session = {
    trip: state.tripName || "default",
    phase: "night",
    round: 1,
    killer_names: shuffle(names).slice(0, killerCount),
    alive_names: names,
    eliminated: [],
    winner: null,
  };
  try {
    await sb.from("mafia_session").upsert(session, { onConflict: "trip" });
    mafiaSession = session;
    render();
  } catch (e) {
    toast("Couldn't start the game — check your connection");
  }
}

async function mafiaEliminate(name, phase) {
  if (!mafiaSession) return;
  const aliveNames = mafiaSession.alive_names.filter((n) => n !== name);
  const wasKiller = mafiaSession.killer_names.includes(name);
  const eliminated = [...mafiaSession.eliminated, { name, round: mafiaSession.round, phase, wasKiller }];
  const aliveKillers = aliveNames.filter((n) => mafiaSession.killer_names.includes(n)).length;
  const aliveTown = aliveNames.length - aliveKillers;
  const winner = aliveKillers === 0 ? "town" : aliveKillers >= aliveTown ? "mafia" : null;

  let nextPhase, nextRound;
  if (winner) {
    nextPhase = "over";
    nextRound = mafiaSession.round;
  } else if (phase === "night") {
    nextPhase = "day";
    nextRound = mafiaSession.round;
  } else {
    nextPhase = "night";
    nextRound = mafiaSession.round + 1;
  }

  const next = { ...mafiaSession, alive_names: aliveNames, eliminated, phase: nextPhase, round: nextRound, winner };
  mafiaSession = next;
  render();

  if (sb) {
    try {
      await sb
        .from("mafia_session")
        .update({ alive_names: next.alive_names, eliminated: next.eliminated, phase: next.phase, round: next.round, winner: next.winner })
        .eq("trip", state.tripName || "default");
    } catch (e) {}
  }

  if (winner) {
    const participants = mafiaParticipants(next);
    const winningNames = participants.filter((n) =>
      winner === "mafia" ? next.killer_names.includes(n) : !next.killer_names.includes(n)
    );
    winningNames.forEach((n) => {
      addPoints(n, POINTS.mafiaWin, "mafia", winner === "mafia" ? "Killers won the round" : "Town found the Killers");
    });
    syncMafiaGameFromSession(next, participants);
  }
}

async function mafiaSkip(phase) {
  if (!mafiaSession) return;
  const nextPhase = phase === "night" ? "day" : "night";
  const nextRound = phase === "night" ? mafiaSession.round : mafiaSession.round + 1;
  mafiaSession = { ...mafiaSession, phase: nextPhase, round: nextRound };
  render();
  if (sb) {
    try {
      await sb.from("mafia_session").update({ phase: nextPhase, round: nextRound }).eq("trip", state.tripName || "default");
    } catch (e) {}
  }
}

async function mafiaNewGame() {
  if (sb) {
    try {
      await sb.from("mafia_session").delete().eq("trip", state.tripName || "default");
    } catch (e) {}
  }
  mafiaSession = null;
  render();
}

function renderMafia() {
  if (!sb) {
    return `<div class="empty">Mafia plays live across everyone's phone now, which needs a connection. This tab will come alive once you're online.</div>`;
  }
  if (!mafiaSession) return renderMafiaSetup();
  if (mafiaSession.phase === "over") return renderMafiaOver(mafiaSession);
  return renderMafiaPhase(mafiaSession, mafiaSession.phase);
}

function renderMafiaSetup() {
  const count = state.campers.length;
  const suggested = Math.max(1, Math.round(count / 4)) || 1;
  const chips =
    state.campers.map((c) => `<span class="chip">${escapeHtml(c.name)}</span>`).join("") ||
    `<span class="empty" style="padding:0;">No campers yet — add some in the Camp tab.</span>`;
  const canStart = count >= 3;

  const historyRows = mafiaHistory
    .map((g) => {
      const killers = (g.players || [])
        .filter((p) => p.role === "killer")
        .map((p) => p.name)
        .join(", ");
      return `
      <div class="log-row">
        <span>${g.winner === "mafia" ? "🔪 Killers" : "🏆 Town"} won · ${g.rounds} round${g.rounds === 1 ? "" : "s"} · killers were ${escapeHtml(killers)}</span>
        <span>${timeAgo(g.created_at)}</span>
      </div>`;
    })
    .join("");

  return `
    <h2 class="section-title">Mafia</h2>
    <div class="trip-card">
      <div class="chip-row">${chips}</div>
      <div class="empty" style="text-align:left;padding:10px 0 0;">
        Some of you are secretly Killers. Once it starts, everyone opens Mafia on their
        own phone and sees their own role there — no passing anything around. Killers try
        not to get caught; everyone else tries to catch them before it's too late.
      </div>
      <label class="field-label">How many Killers?</label>
      <input type="number" id="mafiaKillerCount" value="${suggested}" min="1" max="${Math.max(1, count - 1)}">
      <div class="modal-actions">
        <button class="primary" id="mafiaStartBtn" ${canStart ? "" : "disabled"}>Assign roles &amp; start</button>
      </div>
      ${canStart ? "" : `<div class="empty" style="text-align:left;padding:10px 0 0;">Need at least 3 campers — add them in the Camp tab first.</div>`}
    </div>
    ${historyRows ? `<h2 class="section-title">Past games (all phones)</h2><div class="trip-card">${historyRows}</div>` : ""}
  `;
}

function renderMafiaPhase(session, phaseName) {
  const isNight = phaseName === "night";
  const participants = mafiaParticipants(session);
  const isPlayer = !!state.keeperName && participants.includes(state.keeperName);
  const isKiller = isPlayer && session.killer_names.includes(state.keeperName);

  const roleCard = isPlayer
    ? `
    <div class="trip-card role-card" style="text-align:center;border-color:${isKiller ? "#d98080" : "var(--gold-dim)"};margin-bottom:16px;">
      <div style="font-size:2em;margin-bottom:4px;">${isKiller ? "🔪" : "👤"}</div>
      <div class="title-name" style="font-size:1.05em;">${isKiller ? "You are a Killer" : "You are a Townsperson"}</div>
      <div class="empty" style="padding:4px 0 0;">${
        isKiller ? "Blend in. Killers pick a target together each night." : "Find the Killers before they find you."
      }</div>
    </div>`
    : `<div class="empty" style="padding:12px;margin-bottom:16px;border:1px dashed var(--card-border);border-radius:12px;text-align:left;">You're not in this round — set your name in the <b>Trip</b> tab before the next game starts to play.</div>`;

  const aliveRows = session.alive_names
    .map(
      (name) => `
    <div class="chore-row">
      <div class="chore-label">${escapeHtml(name)}</div>
      <button class="danger" data-eliminate="${escapeAttr(name)}">${isNight ? "Killed" : "Voted out"}</button>
    </div>`
    )
    .join("");

  const eliminatedRows = session.eliminated
    .slice()
    .reverse()
    .map(
      (e) => `
    <div class="log-row">
      <span>${escapeHtml(e.name)} — ${e.wasKiller ? "was a Killer 🔪" : "was a Townsperson 👤"} (${e.phase}, round ${e.round})</span>
    </div>`
    )
    .join("");

  return `
    ${roleCard}
    <h2 class="section-title">Round ${session.round} — ${isNight ? "Night" : "Day"}</h2>
    <div class="trip-card">
      <div class="empty" style="text-align:left;padding:0;">
        ${
          isNight
            ? "🌙 Everyone close your eyes. Killers, open yours and silently point to a target."
            : "☀️ Discuss out loud, then vote someone out — or skip the vote."
        }
      </div>
    </div>
    <h2 class="section-title">${session.alive_names.length} alive</h2>
    ${aliveRows}
    <div class="trip-card">
      <button class="ghost" id="mafiaSkipBtn">${isNight ? "No one was killed" : "Skip the vote"}</button>
    </div>
    ${eliminatedRows ? `<h2 class="section-title">Eliminated</h2><div class="trip-card">${eliminatedRows}</div>` : ""}
  `;
}

function renderMafiaOver(session) {
  const killers = session.killer_names.join(", ");
  return `
    <h2 class="section-title">Game over</h2>
    <div class="trip-card" style="text-align:center;border-color:${session.winner === "mafia" ? "#d98080" : "var(--gold-dim)"};">
      <div style="font-size:2.5em;margin-bottom:6px;">${session.winner === "mafia" ? "🔪" : "🏆"}</div>
      <div class="title-name" style="font-size:1.2em;">${session.winner === "mafia" ? "The Killers win" : "The Townspeople win"}</div>
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
      if (state.keeperName) addCamperLocal(state.keeperName);
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
        peekedRemote: [],
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
      const camper = state.campers.find((c) => c.id === id);
      state.campers = state.campers.filter((c) => c.id !== id);
      state.choreLog = state.choreLog.filter((e) => e.camperId !== id);
      saveState();
      if (camper) removeCamperSync(camper.name);
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
      if (addCamperLocal(input.value)) render();
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
  document.querySelectorAll("[data-eliminate]").forEach((btn) => {
    btn.onclick = () => mafiaEliminate(btn.dataset.eliminate, mafiaSession.phase);
  });
  const mafiaSkipBtn = document.getElementById("mafiaSkipBtn");
  if (mafiaSkipBtn) {
    mafiaSkipBtn.onclick = () => mafiaSkip(mafiaSession.phase);
  }
  const mafiaNewGameBtn = document.getElementById("mafiaNewGameBtn");
  if (mafiaNewGameBtn) {
    mafiaNewGameBtn.onclick = () => mafiaNewGame();
  }
}

function closeAnyModal() {
  document.querySelectorAll(".modal-backdrop").forEach((el) => el.remove());
}

function renderQuestModal(questId) {
  const q = state.quests.find((x) => x.id === questId);
  if (!q) {
    openQuestId = null;
    return;
  }
  closeAnyModal();
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
  closeAnyModal();

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
    if (!addCamperLocal(input.value)) return;
    document.body.removeChild(wrap);
    render();
    openCamperPicker(choreId);
  };

  wrap.querySelector("#pickerCancel").onclick = () => {
    document.body.removeChild(wrap);
  };
}

function openSpendPicker(target) {
  const isRemote = typeof target === "string" && target.indexOf("remote:") === 0;
  const remoteId = isRemote ? target.slice(7) : null;
  const q = isRemote ? null : state.quests.find((x) => x.id === target);
  const remoteArt = isRemote ? remoteArtifacts.find((a) => a.id === remoteId) : null;
  if (!q && !remoteArt) return;
  const title = isRemote ? remoteArt.quest_title : q.title;
  closeAnyModal();

  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-title">Spend ${CAPSULE_UNLOCK_COST} points</div>
      <div class="modal-sub">Whose points are paying to open "${escapeHtml(title)}" early?</div>
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
    addPoints(name, -CAPSULE_UNLOCK_COST, "capsule_spend", `Opened "${title}" early`);
    if (isRemote) {
      state.peekedRemote.push(remoteId);
    } else {
      q.artifact.peeked = true;
    }
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

function openFeedbackModal() {
  closeAnyModal();
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-title">Feedback</div>
      <div class="modal-sub">Bug, idea, or just a reaction — anything helps, and everyone can see what's already been said.</div>
      <div class="chip-row">
        ${FEEDBACK_CATEGORIES.map((c, i) => `<button class="chip ${i === 0 ? "is-active" : ""}" data-fb-cat="${c.id}">${c.label}</button>`).join("")}
      </div>
      <label class="field-label">What's on your mind?</label>
      <textarea id="fbMessage" placeholder="Type it out..."></textarea>
      <div class="modal-actions">
        <button class="ghost" id="fbCancel">Cancel</button>
        <button class="primary" id="fbSubmit">Send</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  let category = FEEDBACK_CATEGORIES[0].id;
  wrap.querySelectorAll("[data-fb-cat]").forEach((btn) => {
    btn.onclick = () => {
      category = btn.dataset.fbCat;
      wrap.querySelectorAll("[data-fb-cat]").forEach((b) => b.classList.toggle("is-active", b === btn));
    };
  });

  wrap.querySelector("#fbCancel").onclick = () => wrap.remove();
  wrap.querySelector("#fbSubmit").onclick = () => {
    const message = wrap.querySelector("#fbMessage").value.trim();
    if (!message) return;
    submitFeedback(category, message);
    wrap.remove();
    toast("Feedback sent — thanks!");
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

const feedbackFab = document.getElementById("feedbackFab");
if (feedbackFab) feedbackFab.onclick = () => openFeedbackModal();

render();
syncAll();
setInterval(syncAll, 7000);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}
