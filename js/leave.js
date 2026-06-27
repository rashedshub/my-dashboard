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

let currentUser = null;
let currentYear = new Date().getFullYear();

// ── Auth guard ────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  currentUser = user;
  document.getElementById("topbarEmail").textContent = user.email;
  buildYearSelector();
  loadData();
});

// ── Year selector ─────────────────────────────────────────────────────────────
function buildYearSelector() {
  const sel  = document.getElementById("yearSelect");
  const base = new Date().getFullYear();
  for (let y = base - 2; y <= base + 5; y++) {
    const opt = document.createElement("option");
    opt.value       = y;
    opt.textContent = y;
    if (y === base) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener("change", () => {
    currentYear = Number(sel.value);
    loadData();
  });
}

// ── Load data from Firestore ──────────────────────────────────────────────────
async function loadData() {
  document.getElementById("tableArea").innerHTML =
    `<div class="table-loading">Loading ${currentYear} data…</div>`;

  let existing = {};
  try {
    const snap = await getDoc(
      doc(db, "leave_data", `${currentUser.uid}_${currentYear}`)
    );
    if (snap.exists()) existing = snap.data().months || {};
  } catch (e) {
    console.error("Load error:", e);
  }

  renderTable(existing);
}

// ── Render table ──────────────────────────────────────────────────────────────
function renderTable(data) {
  const rows = MONTHS.map((month, i) => {
    const plan   = data[i]?.plan   ?? "";
    const actual = data[i]?.actual ?? "";
    return `
      <tr>
        <td>${month}</td>
        <td>
          <input
            class="leave-input plan"
            type="number"
            min="0"
            step="0.5"
            id="plan-${i}"
            value="${plan}"
            placeholder="0"
            oninput="updateDiff(${i})"
          />
        </td>
        <td>
          <input
            class="leave-input actual"
            type="number"
            min="0"
            step="0.5"
            id="actual-${i}"
            value="${actual}"
            placeholder="0"
            oninput="updateDiff(${i})"
          />
        </td>
        <td class="diff-cell" id="diff-${i}">${calcDiffHTML(plan, actual)}</td>
      </tr>
    `;
  }).join("");

  document.getElementById("tableArea").innerHTML = `
    <table class="leave-table">
      <thead>
        <tr>
          <th>Month</th>
          <th>Plan Leave</th>
          <th>Actual Leave</th>
          <th>Difference</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr class="totals-row">
          <td>Total</td>
          <td id="total-plan" style="text-align:center;">—</td>
          <td id="total-actual" style="text-align:center;">—</td>
          <td id="total-diff" style="text-align:center;" class="diff-cell">—</td>
        </tr>
      </tfoot>
    </table>
  `;

  updateTotals();
}

// ── Diff & totals ─────────────────────────────────────────────────────────────
window.updateDiff = function(i) {
  const plan   = parseFloat(document.getElementById(`plan-${i}`).value)   || 0;
  const actual = parseFloat(document.getElementById(`actual-${i}`).value) || 0;
  document.getElementById(`diff-${i}`).innerHTML = calcDiffHTML(plan, actual);
  updateTotals();
};

function calcDiffHTML(plan, actual) {
  const p = parseFloat(plan)   || 0;
  const a = parseFloat(actual) || 0;
  if (p === 0 && a === 0) return `<span class="diff-zero">—</span>`;
  const diff = a - p;
  if (diff > 0) return `<span class="diff-pos">+${fmt(diff)}</span>`;
  if (diff < 0) return `<span class="diff-neg">${fmt(diff)}</span>`;
  return `<span class="diff-zero">0</span>`;
}

function updateTotals() {
  let totalPlan = 0, totalActual = 0;
  MONTHS.forEach((_, i) => {
    totalPlan   += parseFloat(document.getElementById(`plan-${i}`)?.value)   || 0;
    totalActual += parseFloat(document.getElementById(`actual-${i}`)?.value) || 0;
  });

  document.getElementById("total-plan").textContent   = fmt(totalPlan);
  document.getElementById("total-actual").textContent = fmt(totalActual);
  document.getElementById("total-diff").innerHTML     = calcDiffHTML(totalPlan, totalActual);
}

function fmt(n) {
  return Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

// ── Save data ─────────────────────────────────────────────────────────────────
document.getElementById("saveBtn").addEventListener("click", async () => {
  const btn = document.getElementById("saveBtn");
  const msg = document.getElementById("saveMsg");
  msg.className = "message"; msg.textContent = "";
  btn.disabled = true; btn.classList.add("loading");

  const months = {};
  MONTHS.forEach((_, i) => {
    months[i] = {
      month:  MONTHS[i],
      plan:   parseFloat(document.getElementById(`plan-${i}`).value)   || 0,
      actual: parseFloat(document.getElementById(`actual-${i}`).value) || 0,
    };
  });

  try {
    await setDoc(
      doc(db, "leave_data", `${currentUser.uid}_${currentYear}`),
      {
        uid:       currentUser.uid,
        year:      currentYear,
        months,
        updatedAt: new Date().toISOString()
      }
    );
    msg.className   = "message success";
    msg.textContent = `✓ Data saved for ${currentYear}.`;
    showToast(`Leave data for ${currentYear} saved!`);
  } catch (e) {
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

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "login.html";
});
