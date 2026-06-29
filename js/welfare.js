import { app } from "./firebase.js";
import {
  getAuth, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const auth = getAuth(app);
const db   = getFirestore(app);

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun",
                "Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_FULL = ["January","February","March","April","May","June",
                     "July","August","September","October","November","December"];

const FOOD_FIELDS = ["vg","g","s","b","vb"];
const FOOD_LABELS = ["Very Good","Good","Satisfactory","Bad","Very Bad"];

let currentYear = new Date().getFullYear();
let currentUser = null;

// Shared data cache per collection
let healthData  = {};
let foodData    = {};
let welfareData = {};

function el(id)           { return document.getElementById(id); }
function setText(id, val) { const n = el(id); if (n) n.textContent = val; }
function fmt(n)           { return (!n && n!==0) ? "—" : Number(n).toLocaleString(); }

function showToast(text, error = false) {
  const toast = document.getElementById("toast");
  toast.textContent = text;
  toast.className   = "toast" + (error ? " error" : "");
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

function setLastUpdated(elId, data) {
  const n = el(elId);
  if (!n || !data?.updatedAt) return;
  const ts = data.updatedAt.toDate ? data.updatedAt.toDate() : new Date(data.updatedAt);
  n.textContent   = `Last saved by ${data.updatedByEmail || "—"} on ${ts.toLocaleString()}`;
  n.style.display = "block";
}

// ── Auth ──────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  currentUser = user;
  setText("topbarEmail", user.email);
  buildYearSelector();
  loadAll();
});

// ── Year selector ─────────────────────────────────────────────────────────────
function buildYearSelector() {
  const sel  = el("yearSelect");
  const base = new Date().getFullYear();
  for (let y = base - 2; y <= base + 5; y++) {
    const opt = document.createElement("option");
    opt.value = y; opt.textContent = y;
    if (y === base) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener("change", () => { currentYear = Number(sel.value); loadAll(); });
}

// ── Load all sections ─────────────────────────────────────────────────────────
async function loadAll() {
  await Promise.all([loadHealth(), loadFood(), loadWelfare()]);
}

// ════════════════════════════════════════════════════════
//  ① HEALTH CHECKUP
// ════════════════════════════════════════════════════════
async function loadHealth() {
  healthData = {};
  try {
    const snap = await getDoc(doc(db, "health_data", String(currentYear)));
    if (snap.exists()) {
      healthData = snap.data();
      setLastUpdated("healthUpdated", healthData);
    }
  } catch(e) { console.error("Health load:", e); }
  renderHealth();
}

function renderHealth() {
  const months = healthData.months || {};
  const target = healthData.target || "";

  // Target input
  const ti = el("healthTarget");
  if (ti) ti.value = target;

  let total = 0;
  const rows = MONTHS_FULL.map((m, i) => {
    const key = MONTHS[i];
    const val = months[key]?.completed ?? "";
    if (val !== "") total += Number(val) || 0;
    return `<tr>
      <td>${m}</td>
      <td><input class="wb-input" type="number" min="0" step="1"
        id="health-${key}" value="${val}" placeholder="0"
        oninput="updateHealthTotals()"/></td>
    </tr>`;
  }).join("");

  el("healthBody").innerHTML = rows;
  updateHealthTotals();
}

window.updateHealthTotals = function() {
  let total = 0;
  MONTHS.forEach(m => { total += Number(el(`health-${m}`)?.value) || 0; });
  setText("healthTotal", fmt(total));
  setText("healthYTD",   fmt(total));

  const target = Number(el("healthTarget")?.value) || 0;
  const pct    = target > 0 ? (total / target * 100).toFixed(1) + "%" : "—";
  setText("healthPct", pct);
};

el("healthSaveBtn").addEventListener("click", async () => {
  const btn = el("healthSaveBtn"), msg = el("healthMsg");
  msg.className = "message"; msg.textContent = "";
  btn.disabled  = true; btn.classList.add("loading");

  const months = {};
  MONTHS.forEach(m => {
    months[m] = { completed: Number(el(`health-${m}`)?.value) || 0 };
  });

  try {
    const data = {
      year:           currentYear,
      target:         Number(el("healthTarget")?.value) || 0,
      months,
      updatedAt:      new Date().toISOString(),
      updatedByEmail: currentUser.email
    };
    await setDoc(doc(db, "health_data", String(currentYear)), data);
    healthData = data;
    msg.className   = "message success";
    msg.textContent = "✓ Health data saved.";
    setLastUpdated("healthUpdated", data);
    showToast("Health checkup data saved!");
  } catch(e) {
    msg.textContent = "Save failed: " + e.message;
  }
  btn.disabled = false; btn.classList.remove("loading");
});

// ════════════════════════════════════════════════════════
//  ② FOOD QUALITY SURVEY
// ════════════════════════════════════════════════════════
async function loadFood() {
  foodData = {};
  try {
    const snap = await getDoc(doc(db, "food_data", String(currentYear)));
    if (snap.exists()) {
      foodData = snap.data();
      setLastUpdated("foodUpdated", foodData);
    }
  } catch(e) { console.error("Food load:", e); }
  renderFood();
}

function renderFood() {
  const months = foodData.months || {};

  const rows = MONTHS_FULL.map((m, i) => {
    const key  = MONTHS[i];
    const mData = months[key] || {};
    const inputs = FOOD_FIELDS.map(f =>
      `<td><input class="wb-input" type="number" min="0" step="1"
        id="food-${key}-${f}" value="${mData[f] ?? ""}" placeholder="0"
        oninput="updateFoodTotals()"/></td>`
    ).join("");
    return `<tr><td>${m}</td>${inputs}<td id="food-row-${key}">—</td></tr>`;
  }).join("");

  el("foodBody").innerHTML = rows;
  updateFoodTotals();
}

window.updateFoodTotals = function() {
  let colTotals = { vg:0, g:0, s:0, b:0, vb:0 };
  let grandTotal = 0;

  MONTHS.forEach(m => {
    let rowTotal = 0;
    FOOD_FIELDS.forEach(f => {
      const v = Number(el(`food-${m}-${f}`)?.value) || 0;
      colTotals[f] += v;
      rowTotal     += v;
    });
    grandTotal += rowTotal;
    const rowEl = el(`food-row-${m}`);
    if (rowEl) rowEl.textContent = rowTotal > 0 ? rowTotal.toLocaleString() : "—";
  });

  setText("ft-vg",    fmt(colTotals.vg));
  setText("ft-g",     fmt(colTotals.g));
  setText("ft-s",     fmt(colTotals.s));
  setText("ft-b",     fmt(colTotals.b));
  setText("ft-vb",    fmt(colTotals.vb));
  setText("ft-total", fmt(grandTotal));
};

el("foodSaveBtn").addEventListener("click", async () => {
  const btn = el("foodSaveBtn"), msg = el("foodMsg");
  msg.className = "message"; msg.textContent = "";
  btn.disabled  = true; btn.classList.add("loading");

  const months = {};
  MONTHS.forEach(m => {
    const mData = {};
    FOOD_FIELDS.forEach(f => { mData[f] = Number(el(`food-${m}-${f}`)?.value) || 0; });
    months[m] = mData;
  });

  try {
    const data = {
      year: currentYear, months,
      updatedAt: new Date().toISOString(),
      updatedByEmail: currentUser.email
    };
    await setDoc(doc(db, "food_data", String(currentYear)), data);
    foodData = data;
    msg.className   = "message success";
    msg.textContent = "✓ Food quality data saved.";
    setLastUpdated("foodUpdated", data);
    showToast("Food quality data saved!");
  } catch(e) {
    msg.textContent = "Save failed: " + e.message;
  }
  btn.disabled = false; btn.classList.remove("loading");
});

// ════════════════════════════════════════════════════════
//  ③ WELFARE / WORKPLACE ISSUE RESOLUTION
// ════════════════════════════════════════════════════════
async function loadWelfare() {
  welfareData = {};
  try {
    const snap = await getDoc(doc(db, "welfare_data", String(currentYear)));
    if (snap.exists()) {
      welfareData = snap.data();
      setLastUpdated("welfareUpdated", welfareData);
    }
  } catch(e) { console.error("Welfare load:", e); }
  renderWelfare();
}

function renderWelfare() {
  const months = welfareData.months || {};

  const rows = MONTHS_FULL.map((m, i) => {
    const key   = MONTHS[i];
    const mData = months[key] || {};
    return `<tr>
      <td>${m}</td>
      <td><input class="wb-input" type="number" min="0" step="1"
        id="wel-${key}-total" value="${mData.total ?? ""}" placeholder="0"
        oninput="updateWelfareTotals()"/></td>
      <td><input class="wb-input" type="number" min="0" step="1"
        id="wel-${key}-solved" value="${mData.solved ?? ""}" placeholder="0"
        oninput="updateWelfareTotals()"/></td>
      <td><input class="wb-input" type="number" min="0" step="1"
        id="wel-${key}-followup" value="${mData.followup ?? ""}" placeholder="0"
        oninput="updateWelfareTotals()"/></td>
      <td id="wel-pct-${key}">—</td>
    </tr>`;
  }).join("");

  el("welfareBody").innerHTML = rows;
  updateWelfareTotals();
}

window.updateWelfareTotals = function() {
  let totTotal = 0, totSolved = 0, totFollowup = 0;

  MONTHS.forEach(m => {
    const total    = Number(el(`wel-${m}-total`)?.value)    || 0;
    const solved   = Number(el(`wel-${m}-solved`)?.value)   || 0;
    const followup = Number(el(`wel-${m}-followup`)?.value) || 0;
    totTotal    += total;
    totSolved   += solved;
    totFollowup += followup;

    const pctEl = el(`wel-pct-${m}`);
    if (pctEl) pctEl.textContent = total > 0 ? (solved/total*100).toFixed(0)+"%" : "—";
  });

  setText("wt-total",    fmt(totTotal));
  setText("wt-solved",   fmt(totSolved));
  setText("wt-followup", fmt(totFollowup));
  setText("wt-pct", totTotal > 0 ? (totSolved/totTotal*100).toFixed(1)+"%" : "—");
};

el("welfareSaveBtn").addEventListener("click", async () => {
  const btn = el("welfareSaveBtn"), msg = el("welfareMsg");
  msg.className = "message"; msg.textContent = "";
  btn.disabled  = true; btn.classList.add("loading");

  const months = {};
  MONTHS.forEach(m => {
    months[m] = {
      total:    Number(el(`wel-${m}-total`)?.value)    || 0,
      solved:   Number(el(`wel-${m}-solved`)?.value)   || 0,
      followup: Number(el(`wel-${m}-followup`)?.value) || 0,
    };
  });

  try {
    const data = {
      year: currentYear, months,
      updatedAt: new Date().toISOString(),
      updatedByEmail: currentUser.email
    };
    await setDoc(doc(db, "welfare_data", String(currentYear)), data);
    welfareData = data;
    msg.className   = "message success";
    msg.textContent = "✓ Welfare data saved.";
    setLastUpdated("welfareUpdated", data);
    showToast("Welfare data saved!");
  } catch(e) {
    msg.textContent = "Save failed: " + e.message;
  }
  btn.disabled = false; btn.classList.remove("loading");
});

// ── Logout ────────────────────────────────────────────────────────────────────
el("logoutBtn")?.addEventListener("click", async () => {
  await signOut(auth); window.location.href = "login.html";
});
