import { app } from "./firebase.js";
import {
  getAuth, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const auth = getAuth(app);
const db   = getFirestore(app);

// Must match leave.js exactly
const MONTHS     = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_FULL = ["January","February","March","April","May","June",
                     "July","August","September","October","November","December"];

let currentYear = new Date().getFullYear();
let chartBar, chartYTD;

function el(id)           { return document.getElementById(id); }
function setText(id, val) { const n = el(id); if (n) n.textContent = val; }

function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Number.isInteger(n)
    ? n.toLocaleString()
    : parseFloat(n).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
function fmtShort(n) {
  if (!n && n !== 0) return "";
  return Math.abs(n) >= 1000 ? (n / 1000).toFixed(1) + "k" : n;
}
function destroyCharts() {
  try { if (chartBar) { chartBar.destroy(); chartBar = null; } } catch(e) {}
  try { if (chartYTD) { chartYTD.destroy(); chartYTD = null; } } catch(e) {}
}
function diffHTML(diff) {
  if (!diff || diff === 0) return `<span class="diff-z">0</span>`;
  const cls = diff > 0 ? "diff-p" : "diff-n";
  return `<span class="${cls}">${diff > 0 ? "+" : ""}${fmt(diff)}</span>`;
}
function showLoading(msg) {
  const ls = el("loadingState"), mc = el("mainContent");
  if (ls) { ls.style.display = "block"; ls.innerHTML = msg; }
  if (mc) mc.style.display = "none";
}
function showContent() {
  const ls = el("loadingState"), mc = el("mainContent");
  if (ls) ls.style.display = "none";
  if (mc) mc.style.display = "block";
}

// ── Auth ──────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  setText("topbarEmail", user.email);
  buildYearSelector();
  loadData();
});

// ── Year selector ─────────────────────────────────────────────────────────────
function buildYearSelector() {
  const sel = el("yearSelect");
  if (!sel) return;
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

// ── Load data ─────────────────────────────────────────────────────────────────
async function loadData() {
  showLoading(`<div class="icon">📊</div>Loading ${currentYear} data…`);
  destroyCharts();

  try {
    // Fetch the single shared doc — same as leave.js writes to
    const snap = await getDoc(doc(db, "leave_data", String(currentYear)));

    if (!snap.exists()) {
      showLoading(`<div class="icon">📭</div>No leave data found for ${currentYear}. Enter data on the <a href="leave.html" style="color:var(--text);font-weight:600;">Leave Plan</a> page first.`);
      return;
    }

    const data   = snap.data();
    const months = data.months || {};

    // Extract plan & consumed arrays in MONTHS order
    const planArr     = MONTHS.map(m => Number(months[m]?.plan)     || 0);
    const consumedArr = MONTHS.map(m => Number(months[m]?.consumed) || 0);

    // YTD index — current month or end of year
    const today           = new Date();
    const currentMonthIdx = currentYear === today.getFullYear() ? today.getMonth() : 11;

    // Cumulative YTD arrays
    const ytdPlan = [], ytdConsumed = [];
    let cumP = 0, cumC = 0;
    for (let i = 0; i < 12; i++) {
      cumP += planArr[i];
      cumC += consumedArr[i];
      ytdPlan.push(cumP);
      ytdConsumed.push(i <= currentMonthIdx ? cumC : null);
    }

    const totalPlan     = planArr.reduce((a, b) => a + b, 0);
    const totalConsumed = consumedArr.reduce((a, b) => a + b, 0);
    const totalDiff     = totalConsumed - totalPlan;
    const pct           = totalPlan > 0 ? (totalConsumed / totalPlan * 100) : 0;
    const pctCls        = pct > 100 ? "over" : pct < 100 ? "under" : "exact";

    const ytdPlanVal     = ytdPlan[currentMonthIdx]     || 0;
    const ytdConsumedVal = ytdConsumed[currentMonthIdx] || 0;
    const ytdDiff        = ytdConsumedVal - ytdPlanVal;

    // Show content before rendering into elements
    showContent();
    await new Promise(r => setTimeout(r, 50));

    // ① Pct card
    const pctEl = el("pctValue");
    if (pctEl) { pctEl.textContent = pct.toFixed(1) + "%"; pctEl.className = "pct-value " + pctCls; }
    const barEl = el("pctBar");
    if (barEl) { barEl.style.width = Math.min(pct, 100) + "%"; barEl.className = "pct-bar-fill " + pctCls; }
    setText("pctPlan",     fmt(totalPlan));
    setText("pctConsumed", fmt(totalConsumed));

    const diffEl = el("pctDiff");
    if (diffEl) {
      diffEl.textContent = (totalDiff >= 0 ? "+" : "") + fmt(totalDiff);
      diffEl.className   = "s-val " + (totalDiff > 0 ? "pos" : totalDiff < 0 ? "neg" : "");
    }

    // Last updated info
    const luEl = el("lastUpdated");
    if (luEl && data.updatedAt) {
      const ts = data.updatedAt.toDate ? data.updatedAt.toDate() : new Date(data.updatedAt);
      luEl.textContent   = `Data last updated: ${ts.toLocaleString()} · by ${data.updatedByEmail || "—"}`;
      luEl.style.display = "block";
    }

    // ② Bar chart
    renderBarChart(planArr, consumedArr);

    // ③ YTD chart
    setText("ytdPlanVal",     fmt(ytdPlanVal));
    setText("ytdConsumedVal", fmt(ytdConsumedVal));
    const ytdDiffEl = el("ytdDiffVal");
    if (ytdDiffEl) {
      ytdDiffEl.textContent = (ytdDiff >= 0 ? "+" : "") + fmt(ytdDiff);
      ytdDiffEl.className   = "ys-val " + (ytdDiff > 0 ? "pos" : ytdDiff < 0 ? "neg" : "");
    }
    renderYTDChart(ytdPlan, ytdConsumed);

    // ④ Monthly table
    renderMonthTable(planArr, consumedArr);

  } catch(e) {
    console.error(e);
    showLoading(`<div class="icon">⚠️</div>Failed to load data: ${e.message}`);
  }
}

// ── ② Bar chart ───────────────────────────────────────────────────────────────
function renderBarChart(plan, consumed) {
  const canvas = el("barChart");
  if (!canvas) return;
  chartBar = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: MONTHS,
      datasets: [
        { label:"Plan",     data:plan,     backgroundColor:"rgba(17,17,17,0.12)", borderColor:"rgba(17,17,17,0.25)", borderWidth:1, borderRadius:4 },
        { label:"Consumed", data:consumed, backgroundColor:"rgba(17,17,17,0.82)", borderWidth:0, borderRadius:4 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.raw)}` } }
      },
      scales: {
        x: { grid:{ display:false }, ticks:{ font:{ size:12 } } },
        y: { beginAtZero:true, grid:{ color:"#f0f0ee" },
             ticks:{ callback: v => fmtShort(v), font:{ size:11 } } }
      },
      animation: {
        onComplete() {
          const ctx = this.ctx;
          ctx.save();
          ctx.font = "600 11px Inter,system-ui,sans-serif";
          ctx.textAlign = "center"; ctx.textBaseline = "bottom";
          this.data.datasets.forEach((ds, di) => {
            this.getDatasetMeta(di).data.forEach((bar, idx) => {
              const v = ds.data[idx];
              if (!v) return;
              ctx.fillStyle = di === 0 ? "rgba(17,17,17,0.45)" : "rgba(17,17,17,0.9)";
              ctx.fillText(fmtShort(v), bar.x, bar.y - 4);
            });
          });
          ctx.restore();
        }
      }
    }
  });
}

// ── ③ YTD line chart ──────────────────────────────────────────────────────────
function renderYTDChart(ytdPlan, ytdConsumed) {
  const canvas = el("ytdChart");
  if (!canvas) return;
  chartYTD = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels: MONTHS,
      datasets: [
        { label:"YTD Plan",     data:ytdPlan,     borderColor:"rgba(17,17,17,0.25)", backgroundColor:"transparent", borderWidth:2, borderDash:[6,4], pointRadius:4, pointBackgroundColor:"rgba(17,17,17,0.25)", tension:0.3, fill:false },
        { label:"YTD Consumed", data:ytdConsumed, borderColor:"#111", backgroundColor:"rgba(17,17,17,0.06)", borderWidth:2.5, pointRadius:5, pointBackgroundColor:"#111", tension:0.3, fill:true }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position:"top", labels:{ usePointStyle:true, pointStyle:"circle", padding:20, font:{ size:12 } } },
        tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.raw)}` } }
      },
      scales: {
        x: { grid:{ display:false }, ticks:{ font:{ size:12 } } },
        y: { beginAtZero:true, grid:{ color:"#f0f0ee" },
             ticks:{ callback: v => fmtShort(v), font:{ size:11 } } }
      }
    }
  });
}

// ── ④ Monthly breakdown table ─────────────────────────────────────────────────
function renderMonthTable(plan, consumed) {
  const tbody = el("monthTableBody");
  if (!tbody) return;

  let totalP = 0, totalC = 0;
  let rows = MONTHS_FULL.map((m, i) => {
    const p    = plan[i]     || 0;
    const c    = consumed[i] || 0;
    const diff = c - p;
    const pct  = p > 0 ? (c / p * 100).toFixed(1) + "%" : "—";
    totalP += p; totalC += c;
    return `<tr>
      <td>${m}</td>
      <td>${fmt(p)}</td>
      <td>${fmt(c)}</td>
      <td>${diffHTML(diff)}</td>
      <td>${pct}</td>
    </tr>`;
  }).join("");

  const tDiff = totalC - totalP;
  rows += `<tr class="total-row">
    <td>Total</td>
    <td>${fmt(totalP)}</td>
    <td>${fmt(totalC)}</td>
    <td>${diffHTML(tDiff)}</td>
    <td>${totalP > 0 ? (totalC / totalP * 100).toFixed(1) + "%" : "—"}</td>
  </tr>`;
  tbody.innerHTML = rows;
}

// ── Logout ────────────────────────────────────────────────────────────────────
const logoutBtn = el("logoutBtn");
if (logoutBtn) logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "login.html";
});
