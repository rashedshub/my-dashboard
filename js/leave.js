/**
 * leave.js
 *
 * Firestore structure:
 *   leave_data/{year}  →  {
 *     year: 2026,
 *     months: {
 *       Jan: { plan: 5, consumed: 3 },
 *       Feb: { plan: 2, consumed: 2 },
 *       … (all 12 months)
 *     },
 *     updatedAt, updatedByEmail
 *   }
 *
 * One shared doc per year. Any logged-in user can read or overwrite.
 */

import { app } from "./firebase.js";

import { getAuth, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import {
  getFirestore,
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
let monthData    = {};   // { Jan: {plan, consumed}, … }

// ── DOM refs ──────────────────────────────────────────────────────────────────
const yearSelect  = document.getElementById("yearSelect");
const tableBody   = document.getElementById("tableBody");
const saveBtn     = document.getElementById("saveBtn");
const saveMsg     = document.getElementById("saveMsg");
const lastUpdated = document.getElementById("lastUpdated");
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
  loadData();
});

// ── Auth ──────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, user => {
  if (!user) { window.location.href = "index.html"; return; }
  currentUser = user;
  topbarEmail.textContent = user.email;
  populateYears();
  loadData();
});

logoutBtn.addEventListener("click", () => signOut(auth));

// ── Load shared doc for selected year ─────────────────────────────────────────
async function loadData() {
  saveMsg.textContent = "";
  lastUpdated.textContent = "";
  renderRows({}); // clear while loading

  try {
    const snap = await getDoc(doc(db, "leave_data", String(selectedYear)));
    monthData = snap.exists() ? (snap.data().months || {}) : {};

    if (snap.exists() && snap.data().updatedAt) {
      const ts = snap.data().updatedAt.toDate();
      lastUpdated.textContent =
        `Last updated: ${ts.toLocaleString()}  ·  by ${snap.data().updatedByEmail || "—"}`;
    } else {
      lastUpdated.textContent = "No data saved yet for this year.";
    }
  } catch (err) {
    console.error("loadData:", err);
    showToast("Failed to load data.", "error");
  }

  renderRows(monthData);
}

// ── Render table rows ─────────────────────────────────────────────────────────
function renderRows(data) {
  tableBody.innerHTML = MONTHS.map(m => {
    const plan     = data[m]?.plan     ?? "";
    const consumed = data[m]?.consumed ?? "";
    return `<tr>
      <td class="month-cell">${m}</td>
      <td>
        <input class="leave-input" type="number" min="0" max="365" step="0.5"
          data-month="${m}" data-field="plan"
          value="${plan}" placeholder="—" aria-label="${m} plan">
      </td>
      <td>
        <input class="leave-input" type="number" min="0" max="365" step="0.5"
          data-month="${m}" data-field="consumed"
          value="${consumed}" placeholder="—" aria-label="${m} consumed">
      </td>
    </tr>`;
  }).join("");

  // Mark unsaved on any change
  tableBody.querySelectorAll(".leave-input").forEach(inp => {
    inp.addEventListener("input", () => {
      saveMsg.textContent = "Unsaved changes…";
      saveMsg.style.color = "#b45309";
    });
  });
}

// ── Save ──────────────────────────────────────────────────────────────────────
saveBtn.addEventListener("click", async () => {
  if (!currentUser) return;

  // Collect all values
  const months = {};
  MONTHS.forEach(m => { months[m] = { plan: null, consumed: null }; });

  tableBody.querySelectorAll(".leave-input").forEach(inp => {
    const m     = inp.dataset.month;
    const field = inp.dataset.field;
    const val   = inp.value.trim();
    months[m][field] = val === "" ? null : parseFloat(val);
  });

  setBtnLoading(true);
  saveMsg.textContent = "";
  saveMsg.style.color = "";

  try {
    await setDoc(doc(db, "leave_data", String(selectedYear)), {
      year:           selectedYear,
      months,
      updatedAt:      serverTimestamp(),
      updatedByEmail: currentUser.email,
    });

    monthData = months;
    const now = new Date().toLocaleString();
    showToast("Saved successfully.", "success");
    saveMsg.textContent = `Saved at ${now}`;
    saveMsg.style.color = "#166534";
    lastUpdated.textContent =
      `Last updated: ${now}  ·  by ${currentUser.email}`;
  } catch (err) {
    console.error("Save error:", err);
    showToast("Save failed — check your connection.", "error");
    saveMsg.textContent = "Save failed.";
    saveMsg.style.color = "#991b1b";
  } finally {
    setBtnLoading(false);
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function setBtnLoading(on) {
  saveBtn.classList.toggle("loading", on);
  saveBtn.disabled = on;
}

let toastTimer;
function showToast(msg, type = "info") {
  toast.textContent = msg;
  toast.className   = `toast toast-${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3500);
}
