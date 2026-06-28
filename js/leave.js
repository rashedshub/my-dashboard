import { app } from "./firebase.js";
import {
  getAuth, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  getFirestore,
  doc, getDoc, setDoc, getDocs, collection
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const auth = getAuth(app);
const db   = getFirestore(app);

const MONTHS = [
  "January","February","March","April",
  "May","June","July","August",
  "September","October","November","December"
];

let currentYear = new Date().getFullYear();
let currentUser = null;
let allUsers    = {};   // uid → { name, employeeId }
// Shared data structure:
// { months: { [monthIdx]: { [uid]: { plan, actual } } }, updatedAt, updatedBy }
let sharedData  = {};

function el(id)           { return document.getElementById(id); }
function setText(id, val) { const n = el(id); if (n) n.textContent = val; }

// ── Auth ──────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  currentUser = user;
  setText("topbarEmail", user.email);
  await loadUsers();
  buildYearSelector();
  loadData();
});

// ── Load all users from Firestore ─────────────────────────────────────────────
async function loadUsers() {
  try {
    const snap = await getDocs(collection(db, "users"));
    snap.docs.forEach(d => {
      const data = d.data();
      allUsers[d.id] = { name: data.name || "Unknown", employeeId: data.employeeId || "—" };
    });
  } catch(e) { console.error("loadUsers error:", e); }
}

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

  sharedData = {};
  try {
    const snap = await getDoc(doc(db, "leave_shared", `${currentYear}`));
    if (snap.exists()) {
      sharedData = snap.data();
      // Show last updated
      if (sharedData.updatedAt && lu) {
        const by   = sharedData.updatedByName || sharedData.updatedBy || "someone";
        const time = new Date(sharedData.updatedAt).toLocaleString();
        lu.textContent  = `Last saved by ${by} on ${time}`;
        lu.style.display = "block";
      }
    }
  } catch(e) { console.error("Load error:", e); }

  renderTable();
}

// ── Render table ──────────────────────────────────────────────────────────────
function renderTable() {
  // Build list of users to show as columns
  // Always include current user + any user that already has data
  const userIds = new Set([currentUser.uid]);
  const months  = sharedData.months || {};
  Object.values(months).forEach(monthData => {
    Object.keys(monthData).forEach(uid => userIds.add(uid));
  });

  // Sort: current user first, then by name
  const sortedUids = [...userIds].sort((a, b) => {
    if (a === currentUser.uid) return -1;
    if (b === currentUser.uid) return 1;
    return (allUsers[a]?.name || "").localeCompare(allUsers[b]?.name || "");
  });

  // Build header
  let headerCols = sortedUids.map(uid => {
    const u    = allUsers[uid] || {};
    const name = uid === currentUser.uid ? "You" : (u.name || "Unknown");
    const empId = u.employeeId && u.employeeId !== "—" ? `<br><span style="font-weight:400;opacity:.6">${u.employeeId}</span>` : "";
    return `
      <th colspan="2" style="text-align:center;border-left:1px solid var(--border);">
        ${name}${empId}
      </th>
    `;
  }).join("");

  let subHeaderCols = sortedUids.map(() => `
    <th style="text-align:center;border-left:1px solid var(--border);">Plan</th>
    <th style="text-align:center;">Actual</th>
  `).join("");

  // Build rows
  let bodyRows = "";
  const totals = {}; // uid → { plan, actual }
  sortedUids.forEach(uid => { totals[uid] = { plan: 0, actual: 0 }; });

  MONTHS.forEach((month, i) => {
    let cells = sortedUids.map(uid => {
      const val    = months[i]?.[uid] || {};
      const plan   = val.plan   ?? "";
      const actual = val.actual ?? "";
      if (plan   !== "") totals[uid].plan   += Number(plan)   || 0;
      if (actual !== "") totals[uid].actual += Number(actual) || 0;

      const diff     = (Number(actual) || 0) - (Number(plan) || 0);
      const hasBoth  = plan !== "" && actual !== "";

      return `
        <td style="border-left:1px solid var(--border);text-align:center;">
          <input class="leave-input" type="number" min="0" step="0.5"
            id="plan-${i}-${uid}" value="${plan}" placeholder="0"
            oninput="recalcRow(${i})"/>
        </td>
        <td style="text-align:center;">
          <input class="leave-input" type="number" min="0" step="0.5"
            id="actual-${i}-${uid}" value="${actual}" placeholder="0"
            oninput="recalcRow(${i})"/>
        </td>
      `;
    }).join("");

    bodyRows += `<tr id="row-${i}"><td>${month}</td>${cells}</tr>`;
  });

  // Totals row
  let totalCells = sortedUids.map(uid => {
    const p = totals[uid].plan;
    const a = totals[uid].actual;
    const d = a - p;
    const diffCls = d > 0 ? "diff-pos" : d < 0 ? "diff-neg" : "diff-zer";
    return `
      <td style="border-left:1px solid var(--border);text-align:center;">${fmt(p)}</td>
      <td style="text-align:center;">${fmt(a)} <span class="${diffCls}" style="font-size:0.75rem;">${d !== 0 ? (d > 0 ? "+" : "") + fmt(d) : ""}</span></td>
    `;
  }).join("");

  el("tableArea").innerHTML = `
    <div style="overflow-x:auto;">
      <table class="leave-table">
        <thead>
          <tr>
            <th rowspan="2" style="vertical-align:bottom;">Month</th>
            ${headerCols}
          </tr>
          <tr>${subHeaderCols}</tr>
        </thead>
        <tbody>${bodyRows}</tbody>
        <tfoot>
          <tr class="total-row">
            <td>Total</td>
            ${totalCells}
          </tr>
        </tfoot>
      </table>
    </div>
  `;
}

// ── Recalculate totals row live ───────────────────────────────────────────────
window.recalcRow = function(monthIdx) {
  // Just re-read all inputs and update totals footer
  const tfoot = document.querySelector(".leave-table tfoot .total-row");
  if (!tfoot) return;

  const userIds = getUserIds();
  userIds.forEach((uid, colIdx) => {
    let totalPlan = 0, totalActual = 0;
    for (let i = 0; i < 12; i++) {
      totalPlan   += Number(el(`plan-${i}-${uid}`)?.value)   || 0;
      totalActual += Number(el(`actual-${i}-${uid}`)?.value) || 0;
    }
    const diff    = totalActual - totalPlan;
    const diffCls = diff > 0 ? "diff-pos" : diff < 0 ? "diff-neg" : "diff-zer";
    const cells   = tfoot.querySelectorAll("td");
    const base    = 1 + colIdx * 2;
    if (cells[base])     cells[base].textContent     = fmt(totalPlan);
    if (cells[base + 1]) cells[base + 1].innerHTML   =
      `${fmt(totalActual)} <span class="${diffCls}" style="font-size:0.75rem;">${diff !== 0 ? (diff > 0 ? "+" : "") + fmt(diff) : ""}</span>`;
  });
};

function getUserIds() {
  const userIds = new Set([currentUser.uid]);
  const months  = sharedData.months || {};
  Object.values(months).forEach(md => Object.keys(md).forEach(uid => userIds.add(uid)));
  return [...userIds].sort((a, b) => {
    if (a === currentUser.uid) return -1;
    if (b === currentUser.uid) return 1;
    return (allUsers[a]?.name || "").localeCompare(allUsers[b]?.name || "");
  });
}

// ── Save ──────────────────────────────────────────────────────────────────────
el("saveBtn").addEventListener("click", async () => {
  const btn = el("saveBtn");
  const msg = el("saveMsg");
  msg.className = "message"; msg.textContent = "";
  btn.disabled  = true; btn.classList.add("loading");

  const userIds = getUserIds();
  const months  = {};

  for (let i = 0; i < 12; i++) {
    months[i] = {};
    userIds.forEach(uid => {
      const plan   = parseFloat(el(`plan-${i}-${uid}`)?.value)   || 0;
      const actual = parseFloat(el(`actual-${i}-${uid}`)?.value) || 0;
      if (plan !== 0 || actual !== 0) {
        months[i][uid] = { plan, actual };
      }
    });
  }

  const userName = allUsers[currentUser.uid]?.name || currentUser.email;

  try {
    await setDoc(doc(db, "leave_shared", `${currentYear}`), {
      year:          currentYear,
      months,
      updatedAt:     new Date().toISOString(),
      updatedBy:     currentUser.uid,
      updatedByName: userName
    });

    // Update local cache
    sharedData.months        = months;
    sharedData.updatedAt     = new Date().toISOString();
    sharedData.updatedByName = userName;

    const lu = el("lastUpdated");
    if (lu) {
      lu.textContent  = `Last saved by ${userName} on ${new Date().toLocaleString()}`;
      lu.style.display = "block";
    }

    msg.className   = "message success";
    msg.textContent = `✓ Data saved for ${currentYear}.`;
    showToast("Leave data saved!");

  } catch(e) {
    msg.textContent = "Save failed: " + e.message;
  }

  btn.disabled = false; btn.classList.remove("loading");
});

// ── Helpers ───────────────────────────────────────────────────────────────────
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
