import { app } from "./firebase.js";
import {
  getAuth, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  getFirestore,
  collection, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const auth = getAuth(app);
const db   = getFirestore(app);

const MONTHS = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec"
];
const MONTHS_FULL = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];

let currentYear  = new Date().getFullYear();
let chartBar, chartYTD, chartVariance;

// ── Auth guard ────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "login.html"; return; }
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
    opt.value = y; opt.textContent = y;
    if (y === base) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener("change", () => {
    currentYear = Number(sel.value);
    loadData();
  });
}

// ── Load & aggregate all employees' leave data ────────────────────────────────
async function loadData() {
  document.getElementById("loadingState").style.display = "block";
  document.getElementById("mainContent").style.display  = "none";
  destroyCharts();

  try {
    // Fetch all leave_data docs for this year (docId pattern: uid_year)
    const snap = await getDocs(collection(db, "leave_data"));
    const docs = snap.docs
      .map(d => d.data())
      .filter(d => d.year === currentYear);

    // Also fetch user names for employee breakdown
    const usersSnap = await getDocs(collection(db, "users"));
    const usersMap  = {};
    usersSnap.docs.forEach(d => { usersMap[d.id] = d.data(); });

    if (docs.length === 0) {
      document.getElementById("loadingState").innerHTML =
        `<div class="icon">📭</div>No leave data found for ${currentYear}.`;
      document.getElementById("loadingState").style.display = "block";
      return;
    }

    // Aggregate monthly totals across all employees
    const planByMonth   = Array(12).fill(0);
    const actualByMonth = Array(12).fill(0);

    // Per-employee totals
    const empRows = docs.map(doc => {
      let totalPlan = 0, totalActual = 0;
      for (let i = 0; i < 12; i++) {
        const plan   = doc.months?.[i]?.plan   || 0;
        const actual = doc.months?.[i]?.actual || 0;
        planByMonth[i]   += plan;
        actualByMonth[i] += actual;
        totalPlan   += plan;
        totalActual += actual;
      }
      const user = usersMap[doc.uid] || {};
      return {
        name:        user.name       || doc.uid,
        employeeId:  user.employeeId || "—",
        totalPlan,
        totalActual,
        diff: totalActual - totalPlan,
        pct:  totalPlan > 0 ? ((totalActual / totalPlan) * 100).toFixed(1) : "—"
      };
    });

    // YTD cumulative arrays
    const ytdPlan = [], ytdActual = [];
    let cumPlan = 0, cumActual = 0;
    const today = new Date();
    const currentMonth = currentYear === today.getFullYear() ? today.getMonth() : 11;

    for (let i = 0; i < 12; i++) {
      cumPlan   += planByMonth[i];
      cumActual += actualByMonth[i];
      ytdPlan.push(cumPlan);
      ytdActual.push(cumActual);
    }

    // Grand totals
    const grandPlan   = planByMonth.reduce((a, b) => a + b, 0);
    const grandActual = actualByMonth.reduce((a, b) => a + b, 0);

    // YTD (up to current month)
    const ytdPlanVal   = ytdPlan[currentMonth]   || 0;
    const ytdActualVal = ytdActual[currentMonth] || 0;
    const ytdDiff      = ytdActualVal - ytdPlanVal;

    renderSummaryCards(grandPlan, grandActual, ytdDiff, docs.length);
    renderBarChart(planByMonth, actualByMonth);
    renderYTDChart(ytdPlan, ytdActual, currentMonth);
    renderVarianceChart(planByMonth, actualByMonth);
    renderMonthlyTable(planByMonth, actualByMonth, ytdPlan, ytdActual);
    renderEmpTable(empRows);

    document.getElementById("loadingState").style.display = "none";
    document.getElementById("mainContent").style.display  = "block";

  } catch (e) {
    document.getElementById("loadingState").innerHTML =
      `<div class="icon">⚠️</div>Failed to load data: ${e.message}`;
    console.error(e);
  }
}

// ── Summary cards ─────────────────────────────────────────────────────────────
function renderSummaryCards(grandPlan, grandActual, ytdDiff, empCount) {
  document.getElementById("cardTotalPlan").textContent   = fmt(grandPlan);
  document.getElementById("cardTotalActual").textContent = fmt(grandActual);
  document.getElementById("cardEmpCount").textContent    = empCount;

  const diffEl  = document.getElementById("cardYTDDiff");
  const diffSub = document.getElementById("cardYTDSub");
  diffEl.textContent = (ytdDiff >= 0 ? "+" : "") + fmt(ytdDiff);
  diffEl.className   = "s-value " + (ytdDiff > 0 ? "s-positive" : ytdDiff < 0 ? "s-negative" : "s-neutral");
  diffSub.textContent = ytdDiff > 0
    ? "Over plan YTD"
    : ytdDiff < 0
    ? "Under plan YTD"
    : "On track";
}

// ── Bar chart — Plan vs Actual by month ───────────────────────────────────────
function renderBarChart(plan, actual) {
  const ctx = document.getElementById("barChart").getContext("2d");
  chartBar = new Chart(ctx, {
    type: "bar",
    data: {
      labels: MONTHS,
      datasets: [
        {
          label: "Plan",
          data: plan,
          backgroundColor: "rgba(17,17,17,0.12)",
          borderColor: "rgba(17,17,17,0.4)",
          borderWidth: 1.5,
          borderRadius: 5,
        },
        {
          label: "Actual",
          data: actual,
          backgroundColor: "rgba(17,17,17,0.75)",
          borderColor: "rgba(17,17,17,1)",
          borderWidth: 1.5,
          borderRadius: 5,
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: "top", labels: { usePointStyle: true, pointStyle: "circle", padding: 20 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}` } }
      },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, grid: { color: "#f0f0ee" },
             ticks: { callback: v => fmtShort(v) } }
      }
    }
  });
}

// ── YTD line chart ────────────────────────────────────────────────────────────
function renderYTDChart(ytdPlan, ytdActual, currentMonth) {
  const ctx = document.getElementById("ytdChart").getContext("2d");
  // Only show up to current month for actual, full year for plan
  const actualData = ytdActual.map((v, i) => i <= currentMonth ? v : null);

  chartYTD = new Chart(ctx, {
    type: "line",
    data: {
      labels: MONTHS,
      datasets: [
        {
          label: "YTD Plan",
          data: ytdPlan,
          borderColor: "rgba(17,17,17,0.3)",
          backgroundColor: "rgba(17,17,17,0.04)",
          borderWidth: 2,
          borderDash: [5, 4],
          pointRadius: 4,
          tension: 0.3,
          fill: false,
        },
        {
          label: "YTD Actual",
          data: actualData,
          borderColor: "#111",
          backgroundColor: "rgba(17,17,17,0.07)",
          borderWidth: 2.5,
          pointRadius: 5,
          tension: 0.3,
          fill: true,
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: "top", labels: { usePointStyle: true, pointStyle: "circle", padding: 16 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}` } }
      },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, grid: { color: "#f0f0ee" },
             ticks: { callback: v => fmtShort(v) } }
      }
    }
  });
}

// ── Variance bar chart ────────────────────────────────────────────────────────
function renderVarianceChart(plan, actual) {
  const variance = plan.map((p, i) => actual[i] - p);
  const colors   = variance.map(v => v > 0 ? "rgba(22,101,52,0.7)" : v < 0 ? "rgba(153,27,27,0.7)" : "rgba(17,17,17,0.15)");

  const ctx = document.getElementById("varianceChart").getContext("2d");
  chartVariance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: MONTHS,
      datasets: [{
        label: "Variance (Actual − Plan)",
        data: variance,
        backgroundColor: colors,
        borderRadius: 5,
        borderWidth: 0,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.raw >= 0 ? "+" : ""}${fmt(ctx.raw)}` } }
      },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: "#f0f0ee" },
             ticks: { callback: v => fmtShort(v) } }
      }
    }
  });
}

// ── Monthly table ─────────────────────────────────────────────────────────────
function renderMonthlyTable(plan, actual, ytdPlan, ytdActual) {
  const tbody = document.getElementById("monthlyTableBody");

  let rows = "";
  let tPlan = 0, tActual = 0;

  MONTHS_FULL.forEach((month, i) => {
    const p    = plan[i]   || 0;
    const a    = actual[i] || 0;
    const diff = a - p;
    tPlan   += p;
    tActual += a;
    const ytdDiff = ytdActual[i] - ytdPlan[i];

    rows += `
      <tr>
        <td class="month-name">${month}</td>
        <td>${fmt(p)}</td>
        <td>${fmt(a)}</td>
        <td>${diffHTML(diff)}</td>
        <td>${fmt(ytdPlan[i])}</td>
        <td>${fmt(ytdActual[i])}</td>
        <td>${diffHTML(ytdDiff)}</td>
      </tr>
    `;
  });

  const grandDiff = tActual - tPlan;
  rows += `
    <tr class="total-row">
      <td>Total</td>
      <td>${fmt(tPlan)}</td>
      <td>${fmt(tActual)}</td>
      <td>${diffHTML(grandDiff)}</td>
      <td>—</td><td>—</td><td>—</td>
    </tr>
  `;

  tbody.innerHTML = rows;
}

// ── Employee breakdown table ──────────────────────────────────────────────────
function renderEmpTable(empRows) {
  const tbody = document.getElementById("empTableBody");
  if (empRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--muted)">No employee data.</td></tr>`;
    return;
  }

  tbody.innerHTML = empRows
    .sort((a, b) => b.totalPlan - a.totalPlan)
    .map(e => `
      <tr>
        <td><strong>${e.name}</strong>${e.employeeId !== "—" ? `<br><span style="font-size:0.78rem;color:var(--muted)">${e.employeeId}</span>` : ""}</td>
        <td>${fmt(e.totalPlan)}</td>
        <td>${fmt(e.totalActual)}</td>
        <td>${diffHTML(e.diff)}</td>
        <td>${e.pct !== "—" ? `<span style="font-weight:600">${e.pct}%</span>` : "—"}</td>
      </tr>
    `).join("");
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function diffHTML(diff) {
  if (diff === 0) return `<span class="diff-zer">0</span>`;
  const cls = diff > 0 ? "diff-pos" : "diff-neg";
  return `<span class="${cls}">${diff > 0 ? "+" : ""}${fmt(diff)}</span>`;
}

function fmt(n) {
  if (n === null || n === undefined) return "—";
  return Number.isInteger(n)
    ? n.toLocaleString()
    : parseFloat(n).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function fmtShort(n) {
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + "k";
  return n;
}

function destroyCharts() {
  if (chartBar)      { chartBar.destroy();      chartBar      = null; }
  if (chartYTD)      { chartYTD.destroy();      chartYTD      = null; }
  if (chartVariance) { chartVariance.destroy(); chartVariance = null; }
}

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
