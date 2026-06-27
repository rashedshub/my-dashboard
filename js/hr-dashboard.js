import { app } from "./firebase.js";
import {
  getAuth, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  getFirestore, collection, getDocs
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const auth = getAuth(app);
const db   = getFirestore(app);

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

let currentYear = new Date().getFullYear();
let chartBar, chartYTD;

function el(id)            { return document.getElementById(id); }
function setText(id, val)  { const n = el(id); if (n) n.textContent = val; }
function setHTML(id, val)  { const n = el(id); if (n) n.innerHTML   = val; }

function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Number.isInteger(n)
    ? n.toLocaleString()
    : parseFloat(n).toLocaleString(undefined, { minimumFractionDigits:1, maximumFractionDigits:1 });
}
function fmtShort(n) {
  if (!n && n !== 0) return "";
  return Math.abs(n) >= 1000 ? (n/1000).toFixed(1)+"k" : n;
}
function destroyCharts() {
  try { if (chartBar) { chartBar.destroy(); chartBar = null; } } catch(e){}
  try { if (chartYTD) { chartYTD.destroy(); chartYTD = null; } } catch(e){}
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
  sel.addEventListener("change", () => { currentYear = Number(sel.value); loadData(); });
}

// ── Load data ─────────────────────────────────────────────────────────────────
async function loadData() {
  const ls = el("loadingState"), mc = el("mainContent");
  if (ls) { ls.style.display = "block"; ls.innerHTML = `<div class="icon">📊</div>Loading ${currentYear} data…`; }
  if (mc) mc.style.display = "none";
  destroyCharts();

  try {
    const [leaveSnap, usersSnap] = await Promise.all([
      getDocs(collection(db, "leave_data")),
      getDocs(collection(db, "users"))
    ]);

    const docs = leaveSnap.docs.map(d => d.data()).filter(d => Number(d.year) === Number(currentYear));

    if (docs.length === 0) {
      if (ls) { ls.style.display = "block"; ls.innerHTML = `<div class="icon">📭</div>No leave data for ${currentYear}.`; }
      return;
    }

    // Aggregate monthly totals
    const planByMonth   = Array(12).fill(0);
    const actualByMonth = Array(12).fill(0);
    docs.forEach(d => {
      for (let i = 0; i < 12; i++) {
        planByMonth[i]   += Number(d.months?.[i]?.plan)   || 0;
        actualByMonth[i] += Number(d.months?.[i]?.actual) || 0;
      }
    });

    // YTD index
    const today           = new Date();
    const currentMonthIdx = currentYear === today.getFullYear() ? today.getMonth() : 11;

    // YTD cumulative arrays
    const ytdPlan = [], ytdActual = [];
    let cumP = 0, cumA = 0;
    for (let i = 0; i < 12; i++) {
      cumP += planByMonth[i];
      cumA += actualByMonth[i];
      ytdPlan.push(cumP);
      ytdActual.push(i <= currentMonthIdx ? cumA : null);
    }

    const ytdPlanVal   = ytdPlan[currentMonthIdx]   || 0;
    const ytdActualVal = ytdActual[currentMonthIdx]  || 0;
    const ytdDiff      = ytdActualVal - ytdPlanVal;

    // Card: use FULL year totals (all entered data, not capped to current month)
    const totalPlan   = planByMonth.reduce((a, b) => a + b, 0);
    const totalActual = actualByMonth.reduce((a, b) => a + b, 0);
    const totalDiff   = totalActual - totalPlan;
    const pct         = totalPlan > 0 ? (totalActual / totalPlan * 100) : 0;
    const pctCls      = pct > 100 ? "over" : pct < 100 ? "under" : "exact";

    // Show content before writing into it
    if (ls) ls.style.display = "none";
    if (mc) mc.style.display = "block";

    // Small delay so DOM is painted before Chart.js measures canvas
    await new Promise(r => setTimeout(r, 50));

    // ① Overall % card
    const pctEl = el("pctValue");
    if (pctEl) { pctEl.textContent = pct.toFixed(1) + "%"; pctEl.className = "pct-value " + pctCls; }
    const barEl = el("pctBar");
    if (barEl) { barEl.style.width = Math.min(pct, 100) + "%"; barEl.className = "pct-bar-fill " + pctCls; }
    setText("pctPlan",   fmt(totalPlan));
    setText("pctActual", fmt(totalActual));
    const diffEl = el("pctDiff");
    if (diffEl) {
      diffEl.textContent = (totalDiff >= 0 ? "+" : "") + fmt(totalDiff);
      diffEl.className   = "s-val " + (totalDiff > 0 ? "pos" : totalDiff < 0 ? "neg" : "");
    }

    // ② Bar chart
    renderBarChart(planByMonth, actualByMonth);

    // ③ YTD chart
    setText("ytdPlanVal",   fmt(ytdPlanVal));
    setText("ytdActualVal", fmt(ytdActualVal));
    const ytdDiffEl = el("ytdDiffVal");
    if (ytdDiffEl) {
      ytdDiffEl.textContent = (ytdDiff >= 0 ? "+" : "") + fmt(ytdDiff);
      ytdDiffEl.className   = "ys-val " + (ytdDiff > 0 ? "pos" : ytdDiff < 0 ? "neg" : "");
    }
    renderYTDChart(ytdPlan, ytdActual);

  } catch(e) {
    console.error(e);
    const ls = el("loadingState"), mc = el("mainContent");
    if (mc) mc.style.display = "none";
    if (ls) { ls.style.display = "block"; ls.innerHTML = `<div class="icon">⚠️</div>Failed to load data: ${e.message}`; }
  }
}

// ── ② Bar chart ───────────────────────────────────────────────────────────────
function renderBarChart(plan, actual) {
  const canvas = el("barChart");
  if (!canvas) return;
  chartBar = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: MONTHS_SHORT,
      datasets: [
        { label:"Plan",   data:plan,   backgroundColor:"rgba(17,17,17,0.12)", borderColor:"rgba(17,17,17,0.25)", borderWidth:1, borderRadius:4 },
        { label:"Actual", data:actual, backgroundColor:"rgba(17,17,17,0.82)", borderWidth:0, borderRadius:4 }
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins: {
        legend: { display:false },
        tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.raw)}` } }
      },
      scales: {
        x: { grid:{display:false}, ticks:{font:{size:12}} },
        y: { beginAtZero:true, grid:{color:"#f0f0ee"}, ticks:{callback:v=>fmtShort(v), font:{size:11}} }
      },
      animation: {
        onComplete() {
          const ctx = this.ctx;
          ctx.save();
          ctx.font = "600 11px Inter,system-ui,sans-serif";
          ctx.textAlign = "center"; ctx.textBaseline = "bottom";
          this.data.datasets.forEach((ds,di) => {
            this.getDatasetMeta(di).data.forEach((bar,idx) => {
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
function renderYTDChart(ytdPlan, ytdActual) {
  const canvas = el("ytdChart");
  if (!canvas) return;
  chartYTD = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels: MONTHS_SHORT,
      datasets: [
        { label:"YTD Plan",   data:ytdPlan,   borderColor:"rgba(17,17,17,0.25)", backgroundColor:"transparent", borderWidth:2, borderDash:[6,4], pointRadius:4, pointBackgroundColor:"rgba(17,17,17,0.25)", tension:0.3, fill:false },
        { label:"YTD Actual", data:ytdActual, borderColor:"#111", backgroundColor:"rgba(17,17,17,0.06)", borderWidth:2.5, pointRadius:5, pointBackgroundColor:"#111", tension:0.3, fill:true }
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins: {
        legend: { position:"top", labels:{usePointStyle:true, pointStyle:"circle", padding:20, font:{size:12}} },
        tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.raw)}` } }
      },
      scales: {
        x: { grid:{display:false}, ticks:{font:{size:12}} },
        y: { beginAtZero:true, grid:{color:"#f0f0ee"}, ticks:{callback:v=>fmtShort(v), font:{size:11}} }
      }
    }
  });
}

// ── Logout ────────────────────────────────────────────────────────────────────
const logoutBtn = el("logoutBtn");
if (logoutBtn) logoutBtn.addEventListener("click", async () => { await signOut(auth); window.location.href = "login.html"; });
