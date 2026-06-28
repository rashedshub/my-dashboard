/**
 * leave.js
 *
 * Firestore structure:
 *   users/{uid}            → { displayName, email, department, role, … }
 *   leave_data/{uid_year}  → {
 *     employeeUid, employeeName, year,
 *     months: {
 *       "Jan": { plan: 0, actual: 0 },
 *       … (all 12 months)
 *     },
 *     updatedAt, updatedByEmail
 *   }
 *
 * Access:
 *   READ  — any logged-in user
 *   WRITE — any logged-in user (any HR can update any employee row)
 */

import { app } from "./firebase.js";

import { getAuth, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import {
  getFirestore,
  collection, getDocs,
  doc, getDoc, setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const auth = getAuth(app);
const db   = getFirestore(app);

// ── Constants ─────────────────────────────────────────────────────────────────
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun",
                "Jul","Aug","Sep","Oct","Nov","Dec"];

// ── State ─────────────────────────────────────────────────────────────────────
let currentUser  = null;
let selectedYear = new Date().getFullYear();
let employees    = [];  // [{ uid, displayName, department }]
let leaveData    = {};  // { empUid: { Jan:{plan,actual}, … } }
let dirtyRows    = new Set(); // empUids with unsaved changes

// ── DOM refs ──────────────────────────────────────────────────────────────────
const yearSelect  = document.getElementById("yearSelect");
const tableArea   = document.getElementById("tableArea");
const saveBtn     = document.getElementById("saveBtn");
const saveMsg     = document.getElementById("saveMsg");
const topbarEmail = document.getElementById("topbarEmail");
const logoutBtn   = document.getElementById("logoutBtn");
const toast       = document.getElementById("toast");

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
  dirtyRows.clear();
  loadAllLeaveData();
});

// ── Auth ──────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, user => {
  if (!user) { window.location.href = "index.html"; return; }
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

// ── Load employees ────────────────────────────────────────────────────────────
async function loadEmployees() {
  try {
    const snap = await getDocs(collection(db, "users"));
    employees = snap.docs.map(d => ({
      uid:         d.id,
      displayName: d.data().displayName || d.data().name || d.data().email || d.id,
      email:       d.data().email || "",
      department:  d.data().department || d.data().dept || "",
    }));
    employees.sort((a, b) => a.displayName.localeCompare(b.displayName));
  } catch (err) {
    console.error("loadEmployees:", err);
    showToast("Could not load employee list.", "error");
  }
}

// ── Load all leave_data for selected year ─────────────────────────────────────
async function loadAllLeaveData() {
  tableArea.innerHTML = `<div class="table-loading">Loading…</div>`;
  leaveData = {};

  try {
    const snap = await getDocs(collection(db, "leave_data"));
    snap.docs.forEach(d => {
      // docId = empUid_year; empUid may contain underscores → split from end
      const parts = d.id.split("_");
      const year  = parts[parts.length - 1];
      if (year !== String(selectedYear)) return;
      const uid = parts.slice(0, parts.length - 1).join("_");
      leaveData[uid] = d.data().months || emptyMonths();
    });
  } catch (err) {
    console.error("loadAllLeaveData:", err);
    showToast("Could not load leave data.", "error");
  }

  renderTable();
}

// ── Render table ──────────────────────────────────────────────────────────────
function renderTable() {
  if (!employees.length) {
    tableArea.innerHTML = `<div class="table-loading">No employees found.</div>`;
    return;
  }

  // Two-level header
  let h1 = `<tr>
    <th class="col-name" rowspan="2">Employee</th>
    <th class="col-dept" rowspan="2">Department</th>`;
  MONTHS.forEach(m => { h1 += `<th class="month-header" colspan="2">${m}</th>`; });
  h1 += `</tr>`;

  let h2 = `<tr>`;
  MONTHS.forEach(() => {
    h2 += `<th class="sub-header">Plan</th><th class="sub-header">Actual</th>`;
  });
  h2 += `</tr>`;

  // Body — every row is editable by anyone
  const rows = employees.map(emp => {
    const months = leaveData[emp.uid] || emptyMonths();

    // Last updated meta stored per employee doc
    const lastSave = leaveData[`__meta_${emp.uid}`];

    let cells = "";
    MONTHS.forEach(m => {
      const p = months[m]?.plan   ?? "";
      const a = months[m]?.actual ?? "";
      cells += `
        <td class="month-sep">
          <input class="leave-input" type="number" min="0" max="365" step="0.5"
            data-emp="${emp.uid}" data-month="${m}" data-field="plan"
            value="${p}" placeholder="—" aria-label="${m} plan for ${escHtml(emp.displayName)}">
        </td>
        <td>
          <input class="leave-input" type="number" min="0" max="365" step="0.5"
            data-emp="${emp.uid}" data-month="${m}" data-field="actual"
            value="${a}" placeholder="—" aria-label="${m} actual for ${escHtml(emp.displayName)}">
        </td>`;
    });

    return `<tr data-emp="${emp.uid}">
      <td class="col-name">${escHtml(emp.displayName)}</td>
      <td class="col-dept">${escHtml(emp.department)}</td>
      ${cells}
    </tr>`;
  });

  tableArea.innerHTML = `
    <table class="leave-table">
      <thead>${h1}${h2}</thead>
      <tbody>${rows.join("")}</tbody>
    </table>`;

  // Mark dirty on any input change
  tableArea.querySelectorAll(".leave-input").forEach(inp => {
    inp.addEventListener("input", () => {
      dirtyRows.add(inp.dataset.emp);
      saveMsg.textContent = "Unsaved changes…";
      saveMsg.style.color = "#b45309";
    });
  });

  saveMsg.textContent = "";
  saveMsg.style.color = "";
}

// ── Save ALL modified rows ────────────────────────────────────────────────────
saveBtn.addEventListener("click", async () => {
  if (!currentUser) return;

  // Collect all inputs grouped by employee
  const byEmp = {};
  tableArea.querySelectorAll(".leave-input").forEach(inp => {
    const uid   = inp.dataset.emp;
    const m     = inp.dataset.month;
    const field = inp.dataset.field;
    const val   = inp.value.trim();
    if (!byEmp[uid]) byEmp[uid] = emptyMonths();
    byEmp[uid][m][field] = val === "" ? null : parseFloat(val);
  });

  const uidsToSave = Object.keys(byEmp); // save all rows every time
  if (!uidsToSave.length) return;

  setBtnLoading(true);
  saveMsg.textContent = "";
  saveMsg.style.color = "";

  let saved = 0, failed = 0;

  await Promise.all(uidsToSave.map(async empUid => {
    const emp = employees.find(e => e.uid === empUid);
    try {
      const docId = `${empUid}_${selectedYear}`;
      await setDoc(doc(db, "leave_data", docId), {
        employeeUid:   empUid,
        employeeName:  emp?.displayName || "",
        year:          selectedYear,
        months:        byEmp[empUid],
        updatedAt:     serverTimestamp(),
        updatedByEmail: currentUser.email,
      });
      leaveData[empUid] = byEmp[empUid];
      saved++;
    } catch (err) {
      console.error(`Save failed for ${empUid}:`, err);
      failed++;
    }
  }));

  setBtnLoading(false);
  dirtyRows.clear();

  if (failed === 0) {
    showToast(`Saved ${saved} employee row${saved !== 1 ? "s" : ""}.`, "success");
    saveMsg.textContent = `All changes saved at ${new Date().toLocaleTimeString()} by ${currentUser.email}`;
    saveMsg.style.color = "#166534";
  } else {
    showToast(`${saved} saved, ${failed} failed. Check console.`, "error");
    saveMsg.textContent = `${failed} row(s) failed to save.`;
    saveMsg.style.color = "#991b1b";
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
