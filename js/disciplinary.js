import { app } from "./firebase.js";
import { guardRole } from "./guard.js";
import { getAuth, signOut }
  from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc }
  from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const auth = getAuth(app);
const db   = getFirestore(app);

// ── Categories (full list) ────────────────────────────────────────────────────
const CATEGORIES = [
  "Negligence of Work",
  "Indecent Behaviour",
  "Disobedience",
  "Damage to Property",
  "Dishonesty",
  "Theft",
  "Verbal Abuse",
  "Mental Abuse",
  "Physical Harassment",
  "Sexual Harassment",
  "Habitual Late Attendance",
  "Continuous Absent",
  "Habitual Absent",
  "Giving False Information",
  "Leaving without Permission",
  "Sleeping while on Duty",
  "Excess Stay",
  "Improper/Non use of PPE",
  "Fake Certification"
];

const MONTHS      = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_FULL = ["January","February","March","April","May","June",
                     "July","August","September","October","November","December"];

// ── State ─────────────────────────────────────────────────────────────────────
let currentUser = null;
let currentYear = new Date().getFullYear();
// summaryData: { [category]: { Jan:0, Feb:0, ... } }
let summaryData = {};

// ── Helpers ───────────────────────────────────────────────────────────────────
const el  = id => document.getElementById(id);
const set = (id, v) => { const e = el(id); if(e) e.textContent = v; };
function catKey(c){ return c.toLowerCase().replace(/[^a-z0-9]+/g,"_"); }

// ── Auth ──────────────────────────────────────────────────────────────────────
guardRole(["admin","data_entry"]).then(({ user }) => {
  currentUser = user;
  set("topbarEmail", user.email);
  buildYearSelector();
  loadData();
});

// ── Year selector ─────────────────────────────────────────────────────────────
function buildYearSelector(){
  const sel = el("yearSelect"); if(!sel) return;
  const thisYear = new Date().getFullYear();
  for(let y = thisYear; y >= thisYear - 4; y--){
    const o = document.createElement("option");
    o.value = y; o.textContent = y;
    if(y === currentYear) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener("change", () => {
    currentYear = Number(sel.value);
    loadData();
  });
}

// ── Load data ─────────────────────────────────────────────────────────────────
async function loadData(){
  el("tableArea").innerHTML = `<div style="padding:20px;color:var(--muted)">Loading ${currentYear} data…</div>`;
  try {
    const snap = await getDoc(doc(db,"disciplinary_summary", String(currentYear)));
    summaryData = {};
    if(snap.exists()){
      const data = snap.data();
      CATEGORIES.forEach(cat => {
        const k = catKey(cat);
        summaryData[k] = data[k] || {};
      });
    }
    renderTable();
  } catch(e){
    el("tableArea").innerHTML = `<div style="padding:20px;color:red">Load failed: ${e.message}</div>`;
  }
}

// ── Render table ──────────────────────────────────────────────────────────────
function renderTable(){
  // Calculate totals
  const monthTotals = {};
  MONTHS.forEach(m => monthTotals[m] = 0);
  let grandTotal = 0;

  const rows = CATEGORIES.map(cat => {
    const k    = catKey(cat);
    const data = summaryData[k] || {};
    let rowTotal = 0;
    const cells = MONTHS.map(m => {
      const v = Number(data[m]) || 0;
      monthTotals[m] += v;
      rowTotal += v;
      grandTotal += v;
      return `<td><input type="number" min="0" class="disc-input"
        data-cat="${k}" data-month="${m}"
        value="${v||""}" placeholder="0"
        oninput="onInput(this)"/></td>`;
    }).join("");
    return `<tr>
      <td class="cat-cell">${cat}</td>
      ${cells}
      <td class="total-cell" id="row_${k}">${rowTotal||"—"}</td>
    </tr>`;
  }).join("");

  // Totals row
  const totalCells = MONTHS.map(m =>
    `<td class="total-cell" id="mt_${m}">${monthTotals[m]||"—"}</td>`
  ).join("");

  el("tableArea").innerHTML = `
    <div style="overflow-x:auto;">
    <table class="disc-summary-table">
      <thead>
        <tr>
          <th style="min-width:200px;">Category</th>
          ${MONTHS.map(m=>`<th>${m}</th>`).join("")}
          <th>Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td class="total-cell" style="font-weight:700;">Monthly Total</td>
          ${totalCells}
          <td class="total-cell" style="font-weight:700;" id="grandTotal">${grandTotal||"—"}</td>
        </tr>
      </tfoot>
    </table>
    </div>`;
}

// ── Input handler ─────────────────────────────────────────────────────────────
window.onInput = function(inp){
  const k = inp.dataset.cat;
  const m = inp.dataset.month;
  const v = Number(inp.value) || 0;
  if(!summaryData[k]) summaryData[k] = {};
  summaryData[k][m] = v;
  // Update row total
  const rowTotal = MONTHS.reduce((s,mo) => s + (Number(summaryData[k]?.[mo])||0), 0);
  const rowEl = el(`row_${k}`);
  if(rowEl) rowEl.textContent = rowTotal || "—";
  // Update month total
  const monthTotal = CATEGORIES.reduce((s,cat) => s + (Number(summaryData[catKey(cat)]?.[m])||0), 0);
  const mtEl = el(`mt_${m}`);
  if(mtEl) mtEl.textContent = monthTotal || "—";
  // Update grand total
  const grand = CATEGORIES.reduce((s,cat) =>
    s + MONTHS.reduce((ss,mo) => ss + (Number(summaryData[catKey(cat)]?.[mo])||0), 0), 0);
  const gtEl = el("grandTotal");
  if(gtEl) gtEl.textContent = grand || "—";
};

// ── Save ──────────────────────────────────────────────────────────────────────
el("saveBtn")?.addEventListener("click", async () => {
  const btn = el("saveBtn");
  const msg = el("saveMsg");
  btn.disabled = true;
  if(msg){ msg.textContent = "Saving…"; msg.className = "save-msg"; }
  try {
    const saveObj = { year: currentYear, updatedAt: new Date().toISOString(), updatedBy: currentUser.email };
    CATEGORIES.forEach(cat => {
      const k = catKey(cat);
      saveObj[k] = summaryData[k] || {};
    });
    await setDoc(doc(db,"disciplinary_summary", String(currentYear)), saveObj);
    if(msg){ msg.textContent = `✓ Saved for ${currentYear}`; msg.className = "save-msg success"; }
  } catch(e){
    if(msg){ msg.textContent = `Save failed: ${e.message}`; msg.className = "save-msg error"; }
  }
  btn.disabled = false;
  setTimeout(() => { if(msg) msg.textContent = ""; }, 4000);
});

// ── Logout ────────────────────────────────────────────────────────────────────
el("logoutBtn")?.addEventListener("click", async () => {
  await signOut(auth); window.location.href = "login.html";
});
