/**
 * leave.js
 *
 * Firestore structure:
 *   users/{uid}          → { displayName, email, department, role, … }
 *   leave_data/{uid_year} → {
 *     uid, year,
 *     months: {
 *       "Jan": { plan: 0, actual: 0 },
 *       "Feb": { plan: 0, actual: 0 },
 *       … (all 12 months)
 *     },
 *     updatedAt, updatedByEmail
 *   }
 *
 * Security rules (existing):
 *   leave_data: any logged-in user can READ all docs
 *               users can only WRITE their own doc (docId must start with uid)
 *
 * Therefore:
 *   - Every employee row is visible to all.
 *   - Inputs are only enabled for the current user's own row.
 *   - Save only writes the current user's own doc.
 */

import { initializeApp }         from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut }
                                  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  collection, getDocs,
  doc, getDoc, setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Firebase config ──────────────────────────────────────────────────────────
// Replace with your own config object.
import { firebaseConfig } from "./firebase-config.js";

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ── Constants ────────────────────────────────────────────────────────────────
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun",
                "Jul","Aug","Sep","Oct","Nov","Dec"];

const FIELDS = ["plan", "actual"]; // columns per month

// ── State ────────────────────────────────────────────────────────────────────
let currentUser   = null;   // Firebase auth user
let selectedYear  = new Date().getFullYear();
let employees     = [];     // [{ uid, displayName, email, department }]
let leaveData     = {};     // { uid: { Jan:{plan,actual}, … } }

// ── DOM refs ─────────────────────────────────────────────────────────────────
const yearSelect   = document.getElementById("yearSelect");
const tableArea    = document.getElementById("tableArea");
const saveBtn      = document.getElementById("saveBtn");
const saveMsg      = document.getElementById("saveMsg");
const lastUpdated  = document.getElementById("lastUpdated");
const topbarEmail  = document.getElementById("topbarEmail");
const logoutBtn    = document.getElementById("logoutBtn");
const toast        = document.getElementById("toast");

// ── Year selector ─────────────────────────────────────────────────────────────
function populateYears() {
  const current = new Date().getFullYear();
  for (let y = current - 2; y <= current + 2; y++) {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    if (y === current) opt.selected = true;
    yearSelect.appendChild(opt);
  }
}

yearSelect.addEventListener("change", () => {
  selectedYear = parseInt(yearSelect.value, 10);
  loadAllLeaveData();
});

// ── Auth ──────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, user => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  currentUser = user;
  topbarEmail.textContent = user.email;
  init();
});

logoutBtn.addEventListener("click", () => signOut(auth));

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  populateYears();
  await loadEmployees();
  await loadAllLeaveData();
}

// ── Load employees from users collection ─────────────────────────────────────
async function loadEmployees() {
  try {
    const snap = await getDocs(collection(db, "users"));
    employees = snap.docs.map(d => ({
      uid:         d.id,
      displayName: d.data().displayName || d.data().name || d.data().email || d.id,
      email:       d.data().email || "",
      department:  d.data().department || d.data().dept || "",
    }));
    // Sort alphabetically by display name
    employees.sort((a, b) => a.displayName.localeCompare(b.displayName));
  } catch (err) {
    console.error("Failed to load employees:", err);
    showToast("Could not load employee list.", "error");
  }
}

// ── Load all leave_data docs for the selected year ────────────────────────────
async function loadAllLeaveData() {
  tableArea.innerHTML = `<div class="table-loading">Loading leave data…</div>`;
  lastUpdated.style.display = "none";
  leaveData = {};

  try {
    // Each doc id = uid_year  e.g. "abc123_2025"
    // We read all docs then filter by year suffix
    const snap = await getDocs(collection(db, "leave_data"));
    snap.docs.forEach(d => {
      const parts = d.id.split("_");
      // docId format: uid_year — uid may contain underscores so split from end
      const year = parts[parts.length - 1];
      if (year !== String(selectedYear)) return;
      const uid = parts.slice(0, parts.length - 1).join("_");
      leaveData[uid] = d.data().months || emptyMonths();
    });
  } catch (err) {
    console.error("Failed to load leave data:", err);
    showToast("Could not load leave data.", "error");
  }

  renderTable();
  showOwnLastUpdated();
}

// ── Render table ──────────────────────────────────────────────────────────────
function renderTable() {
  if (!employees.length) {
    tableArea.innerHTML = `<div class="table-loading">No employees found.</div>`;
    return;
  }

  // ── Build header rows (two-level: month → plan/actual) ────────────────────
  // Row 1: Employee | Dept | Jan (colspan 2) | Feb (colspan 2) | …
  // Row 2:           |      | Plan | Actual  | Plan | Actual  | …
  let headerRow1 = `<tr>
    <th class="col-name" rowspan="2">Employee</th>
    <th class="col-dept" rowspan="2">Department</th>`;

  MONTHS.forEach(m => {
    headerRow1 += `<th class="month-header" colspan="2">${m}</th>`;
  });
  headerRow1 += `</tr>`;

  let headerRow2 = `<tr>`;
  MONTHS.forEach(() => {
    headerRow2 += `<th class="sub-header">Plan</th><th class="sub-header">Actual</th>`;
  });
  headerRow2 += `</tr>`;

  // ── Build body rows ───────────────────────────────────────────────────────
  const bodyRows = employees.map(emp => {
    const isOwn   = emp.uid === currentUser.uid;
    const months  = leaveData[emp.uid] || emptyMonths();
    const rowClass = isOwn ? "own-row" : "";

    let cells = "";
    MONTHS.forEach((m, i) => {
      const planVal   = months[m]?.plan   ?? "";
      const actualVal = months[m]?.actual ?? "";
      const sep       = i === 0 ? "" : ""; // border via CSS on month-sep

      if (isOwn) {
        cells += `
          <td class="month-sep">
            <input class="leave-input" type="number" min="0" max="31" step="0.5"
              data-uid="${emp.uid}" data-month="${m}" data-field="plan"
              value="${planVal}" placeholder="0" aria-label="${m} plan">
          </td>
          <td>
            <input class="leave-input" type="number" min="0" max="31" step="0.5"
              data-uid="${emp.uid}" data-month="${m}" data-field="actual"
              value="${actualVal}" placeholder="0" aria-label="${m} actual">
          </td>`;
      } else {
        cells += `
          <td class="month-sep">${planVal !== "" ? planVal : "—"}</td>
          <td>${actualVal !== "" ? actualVal : "—"}</td>`;
      }
    });

    return `<tr class="${rowClass}">
      <td class="col-name">${escHtml(emp.displayName)}${isOwn ? ' <span style="font-size:0.7rem;color:#92400e;font-weight:400;">(you)</span>' : ""}</td>
      <td class="col-dept">${escHtml(emp.department)}</td>
      ${cells}
    </tr>`;
  });

  tableArea.innerHTML = `
    <table class="leave-table">
      <thead>${headerRow1}${headerRow2}</thead>
      <tbody>${bodyRows.join("")}</tbody>
    </table>`;

  saveMsg.textContent = "";
}

// ── Show own row's last-updated timestamp ─────────────────────────────────────
async function showOwnLastUpdated() {
  if (!currentUser) return;
  try {
    const docId  = `${currentUser.uid}_${selectedYear}`;
    const snap   = await getDoc(doc(db, "leave_data", docId));
    if (snap.exists() && snap.data().updatedAt) {
      const ts = snap.data().updatedAt.toDate();
      lastUpdated.textContent =
        `Your row last saved: ${ts.toLocaleString()} by ${snap.data().updatedByEmail || currentUser.email}`;
      lastUpdated.style.display = "block";
    }
  } catch (_) { /* non-critical */ }
}

// ── Save current user's row ───────────────────────────────────────────────────
saveBtn.addEventListener("click", async () => {
  if (!currentUser) return;

  // Collect values from inputs for own row
  const inputs = tableArea.querySelectorAll(
    `input[data-uid="${currentUser.uid}"]`
  );

  const months = emptyMonths();
  inputs.forEach(inp => {
    const m     = inp.dataset.month;
    const field = inp.dataset.field;
    const val   = inp.value.trim();
    months[m][field] = val === "" ? null : parseFloat(val);
  });

  // Validate: no month value > 31
  for (const m of MONTHS) {
    for (const f of FIELDS) {
      const v = months[m][f];
      if (v !== null && (v < 0 || v > 31)) {
        showToast(`${m} ${f} must be between 0 and 31.`, "error");
        return;
      }
    }
  }

  setBtnLoading(true);
  saveMsg.textContent = "";

  try {
    const docId  = `${currentUser.uid}_${selectedYear}`;
    await setDoc(doc(db, "leave_data", docId), {
      uid:            currentUser.uid,
      year:           selectedYear,
      months,
      updatedAt:      serverTimestamp(),
      updatedByEmail: currentUser.email,
    });

    // Update local cache
    leaveData[currentUser.uid] = months;
    showToast("Saved successfully.", "success");
    saveMsg.textContent = `Saved at ${new Date().toLocaleTimeString()}`;
    await showOwnLastUpdated();
  } catch (err) {
    console.error("Save error:", err);
    showToast("Save failed — check your connection.", "error");
  } finally {
    setBtnLoading(false);
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function emptyMonths() {
  const m = {};
  MONTHS.forEach(mo => { m[mo] = { plan: null, actual: null }; });
  return m;
}

function setBtnLoading(on) {
  saveBtn.classList.toggle("loading", on);
  saveBtn.disabled = on;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

let toastTimer;
function showToast(msg, type = "info") {
  toast.textContent = msg;
  toast.className   = `toast toast-${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3500);
}
