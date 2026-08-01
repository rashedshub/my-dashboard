import { app } from "./firebase.js";
import { guardRole } from "./guard.js";
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
const MKEYS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

let currentYear = new Date().getFullYear();
let currentUser = null;

function el(id)           { return document.getElementById(id); }
function setText(id, val) { const n = el(id); if (n) n.textContent = val; }

// ── Auth ──────────────────────────────────────────────────────────────────────
guardRole(["admin","data_entry"]).then(({ user }) => {
  currentUser = user;
  setText("topbarEmail", user.email);
  buildYearSelector();
  loadData();
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
  sel.addEventListener("change", () => {
    currentYear = Number(sel.value);
    loadData();
  });
}

// ── Load shared data ──────────────────────────────────────────────────────────
async function loadData() {
  el("tableArea").innerHTML = `<div class="table-loading">Loading ${currentYear} data…</div>`;
  const lu = el("lastUpdated");
  if (lu) lu.style.display = "none";

  let months = {};
  try {
    const snap = await getDoc(doc(db, "leave_data", `${currentYear}`));
    if (snap.exists()) {
      const data = snap.data();
      // Data stored at top level: { Jan: {plan,consumed}, Feb: {...}, ... }
      // Also support nested months field as fallback
      if (data.months) {
        months = data.months;
      } else {
        // Extract month keys from top-level document
        const mk = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        months = {};
        mk.forEach(m => { if (data[m]) months[m] = data[m]; });
      }
      if (data.updatedAt && lu) {
        const by   = data.updatedByName || data.updatedBy || "someone";
        const time = new Date(data.updatedAt).toLocaleString();
        lu.textContent   = `Last saved by ${by} on ${time}`;
        lu.style.display = "block";
      }
    }
  } catch(e) { console.error("Load error:", e); }

  renderTable(months);
}

// ── Render table ──────────────────────────────────────────────────────────────
function renderTable(months) {
  let totalPlan = 0, totalActual = 0;

  const rows = MONTHS.map((month, i) => {
    const plan   = months[MKEYS[i]]?.plan ?? "";
    const actual = months[MKEYS[i]]?.consumed ?? months[MKEYS[i]]?.actual ?? "";
    if (plan   !== "") totalPlan   += Number(plan)   || 0;
    if (actual !== "") totalActual += Number(actual) || 0;
    return `
      <tr>
        <td>${month}</td>
        <td style="text-align:center;">
          <input class="leave-input" type="number" min="0" step="0.5"
            id="plan-${i}" value="${plan}" placeholder="0"
            oninput="updateTotals()"/>
        </td>
        <td style="text-align:center;">
          <input class="leave-input" type="number" min="0" step="0.5"
            id="actual-${i}" value="${actual}" placeholder="0"
            oninput="updateTotals()"/>
        </td>
        <td style="text-align:center;" id="diff-${i}">${diffHTML(Number(plan)||0, Number(actual)||0)}</td>
      </tr>
    `;
  }).join("");

  const totalDiff = totalActual - totalPlan;

  el("tableArea").innerHTML = `
    <table class="leave-table">
      <thead>
        <tr>
          <th>Month</th>
          <th style="text-align:center;">Plan Leave</th>
          <th style="text-align:center;">Actual Leave</th>
          <th style="text-align:center;">Difference</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr class="total-row">
          <td>Total</td>
          <td style="text-align:center;" id="totalPlan">${fmt(totalPlan)}</td>
          <td style="text-align:center;" id="totalActual">${fmt(totalActual)}</td>
          <td style="text-align:center;" id="totalDiff">${diffHTML(totalPlan, totalActual)}</td>
        </tr>
      </tfoot>
    </table>
  `;

  // Attach live diff update per row
  MONTHS.forEach((_, i) => {
    el(`plan-${i}`)?.addEventListener("input",   () => updateRowDiff(i));
    el(`actual-${i}`)?.addEventListener("input", () => updateRowDiff(i));
  });
}

// ── Live updates ──────────────────────────────────────────────────────────────
window.updateTotals = function() {
  let totalPlan = 0, totalActual = 0;
  MONTHS.forEach((_, i) => {
    totalPlan   += Number(el(`plan-${i}`)?.value)   || 0;
    totalActual += Number(el(`actual-${i}`)?.value) || 0;
  });
  setText("totalPlan",   fmt(totalPlan));
  setText("totalActual", fmt(totalActual));
  const td = el("totalDiff");
  if (td) td.innerHTML = diffHTML(totalPlan, totalActual);
};

function updateRowDiff(i) {
  const p = Number(el(`plan-${i}`)?.value)   || 0;
  const a = Number(el(`actual-${i}`)?.value) || 0;
  const d = el(`diff-${i}`);
  if (d) d.innerHTML = diffHTML(p, a);
  updateTotals();
}

// ── Save ──────────────────────────────────────────────────────────────────────
el("saveBtn").addEventListener("click", async () => {
  const btn = el("saveBtn");
  const msg = el("saveMsg");
  msg.className = "message"; msg.textContent = "";
  btn.disabled  = true; btn.classList.add("loading");

  const months = {};
  const saveData = {};
  MONTHS.forEach((_, i) => {
    saveData[MKEYS[i]] = {
      plan:     parseFloat(el(`plan-${i}`)?.value)   || 0,
      consumed: parseFloat(el(`actual-${i}`)?.value) || 0,
    };
  });

  try {
    await setDoc(doc(db, "leave_data", `${currentYear}`), {
      year:          currentYear,
      ...saveData,
      updatedAt:     new Date().toISOString(),
      updatedBy:     currentUser.uid,
      updatedByName: currentUser.email
    });

    msg.className   = "message success";
    msg.textContent = `✓ Data saved for ${currentYear}.`;

    const lu = el("lastUpdated");
    if (lu) {
      lu.textContent   = `Last saved by ${currentUser.email} on ${new Date().toLocaleString()}`;
      lu.style.display = "block";
    }

    showToast("Leave data saved!");
  } catch(e) {
    msg.textContent = "Save failed: " + e.message;
  }

  btn.disabled = false; btn.classList.remove("loading");
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function diffHTML(plan, actual) {
  const diff = (Number(actual) || 0) - (Number(plan) || 0);
  if (!plan && !actual) return `<span class="diff-zer">—</span>`;
  if (diff === 0)       return `<span class="diff-zer">0</span>`;
  const cls = diff > 0 ? "diff-pos" : "diff-neg";
  return `<span class="${cls}">${diff > 0 ? "+" : ""}${fmt(diff)}</span>`;
}

function fmt(n) {
  if (!n && n !== 0) return "—";
  return Number.isInteger(n)
    ? n.toLocaleString()
    : parseFloat(n).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

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
