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

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];

// Generate week labels for a given year+month
function getWeeksInMonth(year, month) {
  const weeks = [];
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  let weekNum    = 1;
  let d          = new Date(firstDay);

  while (d <= lastDay) {
    const weekStart = new Date(d);
    const weekEnd   = new Date(d);
    weekEnd.setDate(weekEnd.getDate() + 6);
    if (weekEnd > lastDay) weekEnd.setDate(lastDay.getDate());
    weeks.push({
      label: `Week ${weekNum} (${fmtDate(weekStart)} – ${fmtDate(weekEnd)})`,
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

let currentUser = null;
let currentYear = new Date().getFullYear();
let currentMode = "monthly"; // "monthly" | "weekly"
let currentMonth = new Date().getMonth(); // 0-indexed, used in weekly mode
let currentTeam = "ES";
let docData     = {}; // { ES: {...}, ER: {...} }

// ── Auth ──────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  currentUser = user;
  setText("topbarEmail", user.email);
  buildControls();
  loadData();
});

// ── Build controls ────────────────────────────────────────────────────────────
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
  yearSel.addEventListener("change", () => {
    currentYear = Number(yearSel.value);
    loadData();
  });

  // Mode
  const modeSel = el("modeSelect");
  modeSel.addEventListener("change", () => {
    currentMode = modeSel.value;
    el("monthGroup").style.display = currentMode === "weekly" ? "flex" : "none";
    renderTable();
  });

  // Month (for weekly mode)
  const monthSel = el("monthSelect");
  MONTHS.forEach((m, i) => {
    const opt = document.createElement("option");
    opt.value = i; opt.textContent = m;
    if (i === new Date().getMonth()) opt.selected = true;
    monthSel.appendChild(opt);
  });
  monthSel.addEventListener("change", () => {
    currentMonth = Number(monthSel.value);
    renderTable();
  });

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

// ── Load from Firestore ───────────────────────────────────────────────────────
async function loadData() {
  el("tableArea").innerHTML = `<div class="table-loading">Loading ${currentYear} data…</div>`;
  docData = { ES: {}, ER: {} };
  try {
    const snap = await getDoc(doc(db, "yeep_data", `${currentUser.uid}_${currentYear}`));
    if (snap.exists()) {
      docData = snap.data().teams || { ES: {}, ER: {} };
    }
  } catch(e) { console.error("Load error:", e); }
  renderTable();
}

// ── Render table ──────────────────────────────────────────────────────────────
function renderTable() {
  const isCombined = currentTeam === "combined";
  const isWeekly   = currentMode === "weekly";

  // Rows to render
  let rows = [];
  if (isWeekly) {
    rows = getWeeksInMonth(currentYear, currentMonth);
  } else {
    rows = MONTHS.map((m, i) => ({ label: m, key: `m${i}` }));
  }

  // Period heading
  let periodLabel = isWeekly
    ? `${MONTHS[currentMonth]} ${currentYear} — weekly breakdown`
    : `${currentYear} — monthly breakdown`;

  if (isCombined) {
    // Combined view — read-only sum of ES + ER
    const tableRows = rows.map(({ label, key }) => {
      const esVal = Number(docData.ES?.[key]) || 0;
      const erVal = Number(docData.ER?.[key]) || 0;
      const total = esVal + erVal;
      return `
        <tr>
          <td>${label}</td>
          <td>${esVal || "—"}</td>
          <td>${erVal || "—"}</td>
          <td><strong>${total || "—"}</strong></td>
        </tr>
      `;
    }).join("");

    // Totals
    let totES = 0, totER = 0;
    rows.forEach(({ key }) => {
      totES += Number(docData.ES?.[key]) || 0;
      totER += Number(docData.ER?.[key]) || 0;
    });
    const totAll = totES + totER;

    el("tableArea").innerHTML = `
      <p class="period-label">${periodLabel}</p>
      <table class="yeep-table">
        <thead>
          <tr>
            <th>${isWeekly ? "Week" : "Month"}</th>
            <th>ES Team</th>
            <th>ER Team</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
        <tfoot>
          <tr class="total-row">
            <td>Total</td>
            <td>${totES || "—"}</td>
            <td>${totER || "—"}</td>
            <td>${totAll || "—"}</td>
          </tr>
        </tfoot>
      </table>
    `;
    // Hide save button in combined view
    el("saveBtn").style.display = "none";
    el("saveMsg").textContent   = "";

  } else {
    // ES or ER editable view
    const teamData = docData[currentTeam] || {};

    const tableRows = rows.map(({ label, key }) => {
      const val = teamData[key] ?? "";
      return `
        <tr>
          <td>${label}</td>
          <td>
            <input
              class="yeep-input"
              type="number"
              min="0"
              step="1"
              id="inp-${key}"
              value="${val}"
              placeholder="0"
              oninput="updateTotal()"
            />
          </td>
          <td class="diff-cell" id="display-${key}">${val !== "" ? Number(val).toLocaleString() : "—"}</td>
        </tr>
      `;
    }).join("");

    // Compute total
    let currentTotal = 0;
    rows.forEach(({ key }) => { currentTotal += Number(teamData[key]) || 0; });

    el("tableArea").innerHTML = `
      <p class="period-label">${periodLabel}</p>
      <table class="yeep-table">
        <thead>
          <tr>
            <th>${isWeekly ? "Week" : "Month"}</th>
            <th>${currentTeam} Team — Installations</th>
            <th>Saved Value</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
        <tfoot>
          <tr class="total-row">
            <td>Total</td>
            <td></td>
            <td id="grandTotal">${currentTotal > 0 ? currentTotal.toLocaleString() : "—"}</td>
          </tr>
        </tfoot>
      </table>
    `;

    el("saveBtn").style.display = "";
  }
}

// ── Live total update ─────────────────────────────────────────────────────────
window.updateTotal = function() {
  let total = 0;
  document.querySelectorAll(".yeep-input").forEach(inp => {
    total += Number(inp.value) || 0;
  });
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
  const rows = isWeekly
    ? getWeeksInMonth(currentYear, currentMonth)
    : MONTHS.map((m, i) => ({ label: m, key: `m${i}` }));

  // Read inputs
  const updates = {};
  rows.forEach(({ key }) => {
    const inp = el(`inp-${key}`);
    if (inp) updates[key] = Number(inp.value) || 0;
  });

  // Merge into docData
  if (!docData[currentTeam]) docData[currentTeam] = {};
  Object.assign(docData[currentTeam], updates);

  try {
    await setDoc(
      doc(db, "yeep_data", `${currentUser.uid}_${currentYear}`),
      {
        uid:       currentUser.uid,
        year:      currentYear,
        teams:     docData,
        updatedAt: new Date().toISOString()
      }
    );
    msg.className   = "message success";
    msg.textContent = `✓ ${currentTeam} team data saved for ${currentYear}.`;
    showToast(`${currentTeam} data saved!`);

    // Refresh display column
    rows.forEach(({ key }) => {
      const dispEl = el(`display-${key}`);
      if (dispEl) {
        const v = updates[key];
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

el("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "login.html";
});
