import { app } from "./firebase.js";
import {
  getAuth, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  getFirestore,
  doc, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const auth = getAuth(app);
const db   = getFirestore(app);

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_FULL = ["January","February","March","April","May","June",
                     "July","August","September","October","November","December"];

// Month keys match: m0 … m11
const MONTH_KEYS = MONTHS.map((_, i) => `m${i}`);

function getWeeksInMonth(year, month) {
  const weeks = [];
  const lastDay = new Date(year, month + 1, 0);
  let d = new Date(year, month, 1);
  let weekNum = 1;
  while (d <= lastDay) {
    const start = new Date(d);
    const end   = new Date(d); end.setDate(end.getDate() + 6);
    if (end > lastDay) end.setDate(lastDay.getDate());
    weeks.push({
      label: `Week ${weekNum} (${fmtDate(start)} – ${fmtDate(end)})`,
      key:   `w${weekNum}`
    });
    d.setDate(d.getDate() + 7);
    weekNum++;
  }
  return weeks;
}

function fmtDate(d) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function el(id)           { return document.getElementById(id); }
function setText(id, val) { const n = el(id); if (n) n.textContent = val; }

let currentUser  = null;
let currentYear  = new Date().getFullYear();
let currentMode  = "monthly";
let currentMonth = new Date().getMonth();
let currentTeam  = "ES";

// Shared data: { teams: { ES: { m0:5, m1:3, … }, ER: { m0:2, … } }, updatedAt, updatedByEmail }
let sharedData = {};

// ── Auth ──────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  currentUser = user;
  setText("topbarEmail", user.email);
  buildControls();
  loadData();
});

// ── Controls ──────────────────────────────────────────────────────────────────
function buildControls() {
  // Year
  const yearSel = el("yearSelect");
  const base    = new Date().getFullYear();
  for (let y = base - 2; y <= base + 5; y++) {
    const opt = document.createElement("option");
    opt.value = y; opt.textContent = y;
    if (y === base) opt.selected = true;
    yearSel.appendChild(opt);
  }
  yearSel.addEventListener("change", () => { currentYear = Number(yearSel.value); loadData(); });

  // Mode
  const modeSel = el("modeSelect");
  modeSel.addEventListener("change", () => {
    currentMode = modeSel.value;
    el("monthGroup").style.display = currentMode === "weekly" ? "flex" : "none";
    renderTable();
  });

  // Month (weekly mode)
  const monthSel = el("monthSelect");
  MONTHS_FULL.forEach((m, i) => {
    const opt = document.createElement("option");
    opt.value = i; opt.textContent = m;
    if (i === new Date().getMonth()) opt.selected = true;
    monthSel.appendChild(opt);
  });
  monthSel.addEventListener("change", () => { currentMonth = Number(monthSel.value); renderTable(); });

  // Team tabs
  document.querySelectorAll(".team-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".team-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      currentTeam = tab.dataset.team;
      renderTable();
    });
  });
}

// ── Load shared doc ───────────────────────────────────────────────────────────
async function loadData() {
  el("tableArea").innerHTML = `<div class="table-loading">Loading ${currentYear} data…</div>`;
  const lu = el("lastUpdated");
  if (lu) lu.style.display = "none";

  sharedData = { teams: { ES: {}, ER: {} } };

  try {
    const snap = await getDoc(doc(db, "yeep_data", String(currentYear)));
    if (snap.exists()) {
      const data = snap.data();
      sharedData = data;
      if (!sharedData.teams) sharedData.teams = { ES: {}, ER: {} };

      if (data.updatedAt && lu) {
        const ts = data.updatedAt.toDate ? data.updatedAt.toDate() : new Date(data.updatedAt);
        lu.textContent   = `Last saved by ${data.updatedByEmail || "—"} on ${ts.toLocaleString()}`;
        lu.style.display = "block";
      }
    }
  } catch(e) { console.error("Load error:", e); }

  renderTable();
}

// ── Render table ──────────────────────────────────────────────────────────────
function renderTable() {
  const isWeekly   = currentMode === "weekly";
  const isCombined = currentTeam === "combined";

  const rows = isWeekly
    ? getWeeksInMonth(currentYear, currentMonth)
    : MONTHS_FULL.map((m, i) => ({ label: m, key: MONTH_KEYS[i] }));

  const periodLabel = isWeekly
    ? `${MONTHS_FULL[currentMonth]} ${currentYear} — weekly`
    : `${currentYear} — monthly`;

  if (isCombined) {
    // Read-only combined view
    let totES = 0, totER = 0;
    const tableRows = rows.map(({ label, key }) => {
      const es = Number(sharedData.teams?.ES?.[key]) || 0;
      const er = Number(sharedData.teams?.ER?.[key]) || 0;
      totES += es; totER += er;
      return `<tr>
        <td>${label}</td>
        <td style="text-align:center;">${es || "—"}</td>
        <td style="text-align:center;">${er || "—"}</td>
        <td style="text-align:center;font-weight:600;">${(es + er) || "—"}</td>
      </tr>`;
    }).join("");

    el("tableArea").innerHTML = `
      <p class="period-label">${periodLabel}</p>
      <table class="yeep-table">
        <thead>
          <tr>
            <th>${isWeekly ? "Week" : "Month"}</th>
            <th style="text-align:center;">ES Team</th>
            <th style="text-align:center;">ER Team</th>
            <th style="text-align:center;">Total</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
        <tfoot>
          <tr class="total-row">
            <td>Total</td>
            <td style="text-align:center;">${totES || "—"}</td>
            <td style="text-align:center;">${totER || "—"}</td>
            <td style="text-align:center;">${(totES + totER) || "—"}</td>
          </tr>
        </tfoot>
      </table>
    `;
    el("saveBtn").style.display = "none";

  } else {
    // Editable single-team view
    const teamData = sharedData.teams?.[currentTeam] || {};
    let currentTotal = 0;

    const tableRows = rows.map(({ label, key }) => {
      const val = teamData[key] ?? "";
      if (val !== "") currentTotal += Number(val) || 0;
      return `<tr>
        <td>${label}</td>
        <td style="text-align:center;">
          <input class="yeep-input" type="number" min="0" step="1"
            id="inp-${key}" value="${val}" placeholder="0"
            oninput="updateTotal()"/>
        </td>
        <td style="text-align:center;" id="disp-${key}">${val !== "" ? Number(val).toLocaleString() : "—"}</td>
      </tr>`;
    }).join("");

    el("tableArea").innerHTML = `
      <p class="period-label">${periodLabel}</p>
      <table class="yeep-table">
        <thead>
          <tr>
            <th>${isWeekly ? "Week" : "Month"}</th>
            <th style="text-align:center;">${currentTeam} Team — Installations</th>
            <th style="text-align:center;">Saved</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
        <tfoot>
          <tr class="total-row">
            <td>Total</td>
            <td></td>
            <td style="text-align:center;" id="grandTotal">${currentTotal > 0 ? currentTotal.toLocaleString() : "—"}</td>
          </tr>
        </tfoot>
      </table>
    `;
    el("saveBtn").style.display = "";
  }
}

// ── Live total ────────────────────────────────────────────────────────────────
window.updateTotal = function() {
  let total = 0;
  document.querySelectorAll(".yeep-input").forEach(inp => { total += Number(inp.value) || 0; });
  const gt = el("grandTotal");
  if (gt) gt.textContent = total > 0 ? total.toLocaleString() : "—";
};

// ── Save ──────────────────────────────────────────────────────────────────────
el("saveBtn").addEventListener("click", async () => {
  const btn = el("saveBtn");
  const msg = el("saveMsg");
  msg.className = "message"; msg.textContent = "";
  btn.disabled  = true; btn.classList.add("loading");

  const isWeekly = currentMode === "weekly";
  const rows     = isWeekly
    ? getWeeksInMonth(currentYear, currentMonth)
    : MONTHS_FULL.map((_, i) => ({ key: MONTH_KEYS[i] }));

  // Read inputs into team data
  if (!sharedData.teams) sharedData.teams = { ES: {}, ER: {} };
  if (!sharedData.teams[currentTeam]) sharedData.teams[currentTeam] = {};

  rows.forEach(({ key }) => {
    const inp = el(`inp-${key}`);
    if (inp) sharedData.teams[currentTeam][key] = Number(inp.value) || 0;
  });

  try {
    await setDoc(doc(db, "yeep_data", String(currentYear)), {
      year:           currentYear,
      teams:          sharedData.teams,
      updatedAt:      new Date().toISOString(),
      updatedByEmail: currentUser.email
    });

    msg.className   = "message success";
    msg.textContent = `✓ ${currentTeam} data saved for ${currentYear}.`;
    showToast(`${currentTeam} team data saved!`);

    const lu = el("lastUpdated");
    if (lu) {
      lu.textContent   = `Last saved by ${currentUser.email} on ${new Date().toLocaleString()}`;
      lu.style.display = "block";
    }

    // Refresh saved column
    rows.forEach(({ key }) => {
      const dispEl = el(`disp-${key}`);
      if (dispEl) {
        const v = sharedData.teams[currentTeam][key];
        dispEl.textContent = v > 0 ? v.toLocaleString() : "—";
      }
    });

  } catch(e) {
    msg.textContent = "Save failed: " + e.message;
  }

  btn.disabled = false; btn.classList.remove("loading");
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function showToast(text, error = false) {
  const toast = document.getElementById("toast");
  toast.textContent = text;
  toast.className   = "toast" + (error ? " error" : "");
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

el("logoutBtn")?.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "login.html";
});
