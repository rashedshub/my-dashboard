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
const MONTHS_FULL  = ["January","February","March","April","May","June","July","August","September","October","November","December"];

let currentYear = new Date().getFullYear();
let chartBar, chartYTD;

// ── Helpers ───────────────────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }

function fmt(n) {
  if (n === null || n === undefined) return "—";
  const num = parseFloat(n);
  return Number.isInteger(num)
    ? num.toLocaleString()
    : num.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function fmtShort(n) {
  if (n === null || n === undefined) return "";
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + "k";
  return n;
}

function diffHTML(diff) {
  if (diff === 0) return `<span class="diff-z">0</span>`;
  const cls = diff > 0 ? "diff-p" : "diff-n";
  return `<span class="${cls}">${diff > 0 ? "+" : ""}${fmt(diff)}</span>`;
}

function destroyCharts() {
  if (chartBar) { chartBar.destroy(); chartBar = null; }
  if (chartYTD) { chartYTD.destroy(); chartYTD = null; }
}

function showError(msg) {
  el("loadingState").style.display = "block";
  el("mainContent").style.display  = "none";
  el("loadingState").innerHTML = `<div class="icon">⚠️</div>${msg}`;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  const emailEl = el("topbarEmail");
  if (emailEl) emailEl.textContent = user.email;
  buildYearSelector();
  loadData();
});

// ── Year selector ─────────────────────────────────────────────────────────────
function buildYearSelector() {
  const sel  = el("yearSelect");
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

// ── Load & aggregate ──────────────────────────────────────────────────────────
async function loadData() {
  el("loadingState").style.display = "block";
  el("mainContent").style.display  = "none";
  destroyCharts();

  try {
    const [leaveSnap, usersSnap] = await Promise.all([
      getDocs(collection(db, "leave_data")),
      getDocs(collection(db, "users"))
    ]);

    const docs = leaveSnap.docs.map(d => d.data()).filter(d => d.year === currentYear);

    const usersMap = {};
    usersSnap.docs.forEach(d => { usersMap[d.id] = d.data(); });

    if (docs.length === 0) {
      showError(`No leave data found for ${currentYear}.`);
      return;
    }

    // Aggregate per month
    const planByMonth   = Array(12).fill(0);
    const actualByMonth = Array(12).fill(0);

    const empData = docs.map(d => {
      let totalPlan = 0, totalActual = 0;
      for (let i = 0; i < 12; i++) {
        const p = Number(d.months?.[i]?.plan)   || 0;
        const a = Number(d.months?.[i]?.actual) || 0;
        planByMonth[i]   += p;
        actualByMonth[i] += a;
        totalPlan        += p;
        totalActual      += a;
      }
      const user = usersMap[d.uid] || {};
      return { name: user.name || "Unknown", totalPlan, totalActual };
    });

    // YTD up to current month
    const today         = new Date();
    const currentMonthIdx = currentYear === today.getFullYear() ? today.getMonth() : 11;

    const ytdPlan = [], ytdActual = [];
    let cumP = 0, cumA = 0;
    for (let i = 0; i < 12; i++) {
      cumP += planByMonth[i];
      cumA += actualByMonth[i];
      ytdPlan.push(cumP);
      ytdActual.push(i <= currentMonthIdx ? cumA : null);
    }

    const grandPlan     = planByMonth.reduce((a,b) => a+b, 0);
    const grandActual   = actualByMonth.slice(0, currentMonthIdx + 1).reduce((a,b) => a+b, 0);
    const ytdPlanVal    = ytdPlan[currentMonthIdx]  || 0;
    const ytdDiff       = grandActual - ytdPlanVal;

    // Show content first, then render into visible elements
    el("loadingState").style.display = "none";
    el("mainContent").style.display  = "block";

    renderPctCards(grandPlan, grandActual, empData);
    renderBarChart(planByMonth, actualByMonth);
    renderMonthTable(planByMonth, actualByMonth);
    renderYTDChart(ytdPlan, ytdActual, ytdPlanVal, grandActual, ytdDiff);

  } catch (e) {
    console.error(e);
    showError("Failed to load data: " + e.message);
  }
}

// ── ① Percent cards ───────────────────────────────────────────────────────────
function renderPctCards(grandPlan, grandActual, empData) {
  const grid = el("pctGrid");
  if (!grid) return;

  const overallPct = grandPlan > 0 ? (grandActual / grandPlan * 100) : 0;
  const overallCls = overallPct > 100 ? "over" : overallPct < 100 ? "under" : "exact";
  const overallBar = Math.min(overallPct, 100);
  const overallDiff = grandActual - grandPlan;

  let html = `
    <div class="pct-card">
      <div class="c-label">Overall — Actual vs Plan</div>
      <div class="c-pct ${overallCls}">${overallPct.toFixed(1)}%</div>
      <div class="pct-bar-track">
        <div class="pct-bar-fill ${overallCls}" style="width:${overallBar}%"></div>
      </div>
      <div class="c-detail">
        <strong>${fmt(grandActual)}</strong> actual &nbsp;/&nbsp; <strong>${fmt(grandPlan)}</strong> planned (YTD)
        <br>${overallCls === "over"
          ? `<span style="color:#991b1b">▲ ${fmt(overallDiff)} over plan</span>`
          : overallCls === "under"
          ? `<span style="color:#166534">▼ ${fmt(Math.abs(overallDiff))} under plan</span>`
          : "On target"}
      </div>
    </div>
  `;

  empData.forEach(e => {
    const pct    = e.totalPlan > 0 ? (e.totalActual / e.totalPlan * 100) : 0;
    const cls    = pct > 100 ? "over" : pct < 100 ? "under" : "exact";
    const barPct = Math.min(pct, 100);
    const diff   = e.totalActual - e.totalPlan;

    html += `
      <div class="pct-card">
        <div class="c-label">${e.name}</div>
        <div class="c-pct ${cls}">${pct.toFixed(1)}%</div>
        <div class="pct-bar-track">
          <div class="pct-bar-fill ${cls}" style="width:${barPct}%"></div>
        </div>
        <div class="c-detail">
          <strong>${fmt(e.totalActual)}</strong> actual &nbsp;/&nbsp; <strong>${fmt(e.totalPlan)}</strong> planned
          <br>${cls === "over"
            ? `<span style="color:#991b1b">▲ ${fmt(diff)} over plan</span>`
            : cls === "under"
            ? `<span style="color:#166534">▼ ${fmt(Math.abs(diff))} under plan</span>`
            : "On target"}
        </div>
      </div>
    `;
  });

  grid.innerHTML = html;
}

// ── ② Column chart ────────────────────────────────────────────────────────────
function renderBarChart(plan, actual) {
  const canvas = el("barChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  chartBar = new Chart(ctx, {
    type: "bar",
    data: {
      labels: MONTHS_SHORT,
      datasets: [
        {
          label: "Plan",
          data: plan,
          backgroundColor: "rgba(17,17,17,0.12)",
          borderColor: "rgba(17,17,17,0.25)",
          borderWidth: 1,
          borderRadius: 4,
          borderSkipped: false,
        },
        {
          label: "Actual",
          data: actual,
          backgroundColor: "rgba(17,17,17,0.82)",
          borderColor: "rgba(17,17,17,1)",
          borderWidth: 0,
          borderRadius: 4,
          borderSkipped: false,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}` }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 12 } } },
        y: {
          beginAtZero: true,
          grid: { color: "#f0f0ee" },
          ticks: { callback: v => fmtShort(v), font: { size: 11 } }
        }
      },
      animation: {
        onComplete: function() {
          const chart = this;
          const ctx   = chart.ctx;
          ctx.save();
          ctx.font         = "600 11px Inter, system-ui, sans-serif";
          ctx.textAlign    = "center";
          ctx.textBaseline = "bottom";
          chart.data.datasets.forEach((dataset, dsIdx) => {
            const meta = chart.getDatasetMeta(dsIdx);
            meta.data.forEach((bar, idx) => {
              const val = dataset.data[idx];
              if (!val || val === 0) return;
              ctx.fillStyle = dsIdx === 0 ? "rgba(17,17,17,0.45)" : "rgba(17,17,17,0.9)";
              ctx.fillText(fmtShort(val), bar.x, bar.y - 4);
            });
          });
          ctx.restore();
        }
      }
    }
  });
}

// ── Monthly data table ────────────────────────────────────────────────────────
function renderMonthTable(plan, actual) {
  const tbody = el("monthTableBody");
  if (!tbody) return;

  let totalP = 0, totalA = 0;
  let rows = MONTHS_FULL.map((m, i) => {
    const p    = plan[i]   || 0;
    const a    = actual[i] || 0;
    const diff = a - p;
    const pct  = p > 0 ? (a / p * 100).toFixed(1) + "%" : "—";
    totalP += p; totalA += a;
    return `
      <tr>
        <td>${m}</td>
        <td>${fmt(p)}</td>
        <td>${fmt(a)}</td>
        <td>${diffHTML(diff)}</td>
        <td>${pct}</td>
      </tr>
    `;
  }).join("");

  const totalDiff = totalA - totalP;
  const totalPct  = totalP > 0 ? (totalA / totalP * 100).toFixed(1) + "%" : "—";
  rows += `
    <tr class="total-row">
      <td>Total</td>
      <td>${fmt(totalP)}</td>
      <td>${fmt(totalA)}</td>
      <td>${diffHTML(totalDiff)}</td>
      <td>${totalPct}</td>
    </tr>
  `;
  tbody.innerHTML = rows;
}

// ── ③ YTD cumulative line chart ───────────────────────────────────────────────
function renderYTDChart(ytdPlan, ytdActual, ytdPlanVal, ytdActualVal, ytdDiff) {
  const planEl   = el("ytdPlanVal");
  const actualEl = el("ytdActualVal");
  const diffEl   = el("ytdDiffVal");
  const canvas   = el("ytdChart");

  if (planEl)   planEl.textContent   = fmt(ytdPlanVal);
  if (actualEl) actualEl.textContent = fmt(ytdActualVal);
  if (diffEl) {
    diffEl.textContent = (ytdDiff >= 0 ? "+" : "") + fmt(ytdDiff);
    diffEl.className   = "ys-val " + (ytdDiff > 0 ? "pos" : ytdDiff < 0 ? "neg" : "");
  }

  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  chartYTD = new Chart(ctx, {
    type: "line",
    data: {
      labels: MONTHS_SHORT,
      datasets: [
        {
          label: "YTD Plan",
          data: ytdPlan,
          borderColor: "rgba(17,17,17,0.25)",
          backgroundColor: "transparent",
          borderWidth: 2,
          borderDash: [6, 4],
          pointRadius: 4,
          pointBackgroundColor: "rgba(17,17,17,0.25)",
          tension: 0.3,
          fill: false,
        },
        {
          label: "YTD Actual",
          data: ytdActual,
          borderColor: "#111",
          backgroundColor: "rgba(17,17,17,0.06)",
          borderWidth: 2.5,
          pointRadius: 5,
          pointBackgroundColor: "#111",
          tension: 0.3,
          fill: true,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "top",
          labels: { usePointStyle: true, pointStyle: "circle", padding: 20, font: { size: 12 } }
        },
        tooltip: {
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}` }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 12 } } },
        y: {
          beginAtZero: true,
          grid: { color: "#f0f0ee" },
          ticks: { callback: v => fmtShort(v), font: { size: 11 } }
        }
      }
    }
  });
}

// ── Logout ────────────────────────────────────────────────────────────────────
const logoutBtn = el("logoutBtn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "login.html";
  });
}
