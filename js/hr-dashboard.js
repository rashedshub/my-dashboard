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
let chartBar, chartYTD, chartYeepPie, chartYeepBar,
    chartHCBar, chartFQPie, chartFQBar, chartWFPie, chartWFBar;

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

// Shared: draw value labels on top of every bar in a bar chart
function barLabelPlugin(color = "rgba(17,17,17,0.8)") {
  return {
    onComplete() {
      const ctx = this.ctx;
      ctx.save();
      ctx.font = "600 11px Inter,system-ui,sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      this.data.datasets.forEach((ds, di) => {
        this.getDatasetMeta(di).data.forEach((bar, idx) => {
          const v = ds.data[idx];
          if (!v || v === 0) return;
          ctx.fillStyle = color;
          ctx.fillText(fmtShort(v), bar.x, bar.y - 3);
        });
      });
      ctx.restore();
    }
  };
}

// Shared: draw percentage labels on doughnut slices
function pieLabelPlugin() {
  return {
    id: "pieLabels",
    afterDatasetsDraw(chart) {
      const { ctx, data } = chart;
      const total = data.datasets[0].data.reduce((a,b) => a+b, 0);
      if (!total) return;
      ctx.save();
      ctx.font = "bold 12px Inter,system-ui,sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      chart.getDatasetMeta(0).data.forEach((arc, i) => {
        const val = data.datasets[0].data[i];
        if (!val) return;
        const pct = (val / total * 100).toFixed(1) + "%";
        const angle  = (arc.startAngle + arc.endAngle) / 2;
        const radius = (arc.innerRadius + arc.outerRadius) / 2;
        const x = arc.x + Math.cos(angle) * radius;
        const y = arc.y + Math.sin(angle) * radius;
        ctx.fillStyle = "#fff";
        ctx.fillText(pct, x, y);
      });
      ctx.restore();
    }
  };
}
function destroyCharts() {
  [chartBar, chartYTD, chartYeepPie, chartYeepBar,
   chartHCBar, chartFQPie, chartFQBar, chartWFPie, chartWFBar]
    .forEach(c => { try { if (c) c.destroy(); } catch(e){} });
  chartBar = chartYTD = chartYeepPie = chartYeepBar =
  chartHCBar = chartFQPie = chartFQBar = chartWFPie = chartWFBar = null;
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

    // ⑤ YEEP
    await loadYEEP();

    // ⑥⑦⑧ Welfare sections
    await loadHealthCheckup();
    await loadFoodQuality();
    await loadWelfare();

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
      animation: barLabelPlugin()
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
        { label:"YTD Plan",     data:ytdPlan,     borderColor:"rgba(17,17,17,0.25)", backgroundColor:"transparent", borderWidth:2, borderDash:[6,4], pointRadius:4, pointBackgroundColor:"rgba(17,17,17,0.25)", tension:0.3, fill:false, datalabels:{ display:false } },
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
      },
      animation: {
        onComplete() {
          const ctx = this.ctx;
          ctx.save();
          ctx.font = "600 10px Inter,system-ui,sans-serif";
          ctx.textAlign = "center"; ctx.textBaseline = "bottom";
          ctx.fillStyle = "#111";
          // Only label YTD Consumed (dataset 1)
          const meta = this.getDatasetMeta(1);
          meta.data.forEach((pt, idx) => {
            const v = ytdConsumed[idx];
            if (!v) return;
            ctx.fillText(fmtShort(v), pt.x, pt.y - 8);
          });
          ctx.restore();
        }
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

// ── ⑤ YEEP — load single shared doc ─────────────────────────────────────────
async function loadYEEP() {
  try {
    const MONTH_KEYS = ["m0","m1","m2","m3","m4","m5","m6","m7","m8","m9","m10","m11"];

    // Single shared doc per year — same as yeep.js writes to
    const snap = await getDoc(doc(db, "yeep_data", String(currentYear)));

    if (!snap.exists()) {
      setText("yeepTotal", "No data");
      setText("yeepES", "—"); setText("yeepER", "—");
      setText("yeepESPct", "—"); setText("yeepERPct", "—");
      return;
    }

    const teams = snap.data().teams || {};

    const esMonthly = MONTH_KEYS.map(k => Number(teams.ES?.[k]) || 0);
    const erMonthly = MONTH_KEYS.map(k => Number(teams.ER?.[k]) || 0);

    const totalES = esMonthly.reduce((a, b) => a + b, 0);
    const totalER = erMonthly.reduce((a, b) => a + b, 0);
    const total   = totalES + totalER;

    // Stat cards
    setText("yeepTotal", total.toLocaleString());
    setText("yeepES",    totalES.toLocaleString());
    setText("yeepER",    totalER.toLocaleString());
    setText("yeepESPct", total > 0 ? `${(totalES/total*100).toFixed(1)}% of total` : "—");
    setText("yeepERPct", total > 0 ? `${(totalER/total*100).toFixed(1)}% of total` : "—");

    // Pie chart — ES vs ER
    const pieCanvas = el("yeepPieChart");
    if (pieCanvas) {
      chartYeepPie = new Chart(pieCanvas.getContext("2d"), {
        type: "doughnut",
        data: {
          labels: ["ES Team", "ER Team"],
          datasets: [{
            data: [totalES, totalER],
            backgroundColor: ["rgba(55,48,163,0.8)", "rgba(22,101,52,0.8)"],
            borderColor:     ["#3730a3", "#166534"],
            borderWidth: 2,
            hoverOffset: 6,
          }]
        },
        plugins: [pieLabelPlugin()],
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: "bottom", labels: { usePointStyle: true, pointStyle: "circle", padding: 20, font: { size: 12 } } },
            tooltip: { callbacks: { label: c => { const pct=total>0?(c.raw/total*100).toFixed(1):0; return ` ${c.label}: ${c.raw.toLocaleString()} (${pct}%)`; } } }
          },
          cutout: "60%",
        }
      });
    }

    // Bar chart — monthly ES vs ER
    const barCanvas = el("yeepBarChart");
    if (barCanvas) {
      chartYeepBar = new Chart(barCanvas.getContext("2d"), {
        type: "bar",
        data: {
          labels: MONTHS,
          datasets: [
            { label:"ES Team", data:esMonthly, backgroundColor:"rgba(55,48,163,0.7)", borderRadius:4, borderWidth:0 },
            { label:"ER Team", data:erMonthly, backgroundColor:"rgba(22,101,52,0.7)",  borderRadius:4, borderWidth:0 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position:"top", labels:{ usePointStyle:true, pointStyle:"circle", padding:16, font:{ size:12 } } },
            tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${c.raw.toLocaleString()}` } }
          },
          scales: {
            x: { grid:{ display:false }, ticks:{ font:{ size:11 } } },
            y: { beginAtZero:true, grid:{ color:"#f0f0ee" }, ticks:{ font:{ size:11 } } }
          },
          animation: barLabelPlugin()
        }
      });
    }

  } catch(e) {
    console.error("YEEP load error:", e);
  }
}

// ── ⑥ Health Checkup ─────────────────────────────────────────────────────────
async function loadHealthCheckup() {
  try {
    const snap = await getDoc(doc(db, "health_data", String(currentYear)));
    if (!snap.exists()) { setText("hcTarget","No data"); return; }
    const data   = snap.data();
    const months = data.months || {};
    const target = Number(data.target) || 0;
    const MK     = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const completed = MK.map(m => Number(months[m]?.completed) || 0);
    const ytd    = completed.reduce((a,b) => a+b, 0);
    const pct    = target > 0 ? (ytd/target*100).toFixed(1) : "—";
    const monthlyTarget = target > 0 ? (target/12).toFixed(1) : 0;
    const pace   = MK.map(() => Number(monthlyTarget));

    setText("hcTarget",    target > 0 ? target.toLocaleString() : "—");
    setText("hcCompleted", ytd.toLocaleString());
    const pctEl = el("hcPct");
    if (pctEl) {
      pctEl.textContent = pct !== "—" ? pct+"%" : "—";
      pctEl.style.color = pct !== "—" && Number(pct) >= 100 ? "#166534" : "#991b1b";
    }
    setText("hcPctSub", pct !== "—" ? (Number(pct) >= 100 ? "On track ✓" : `${(target-ytd).toLocaleString()} remaining`) : "");

    const canvas = el("hcBarChart");
    if (!canvas) return;
    chartHCBar = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: MONTHS,
        datasets: [
          { label:"Completed", data:completed, backgroundColor:"rgba(22,101,52,0.75)", borderRadius:4 },
          { label:"Monthly Pace", data:pace, backgroundColor:"rgba(17,17,17,0.1)", borderRadius:4 }
        ]
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins: { legend:{ position:"top", labels:{ usePointStyle:true, pointStyle:"circle", padding:16, font:{size:12} } },
          tooltip:{ callbacks:{ label: c => ` ${c.dataset.label}: ${fmt(c.raw)}` } } },
        scales: { x:{ grid:{display:false} }, y:{ beginAtZero:true, grid:{color:"#f0f0ee"} } }
      }
    });
  } catch(e) { console.error("HC error:", e); }
}

// ── ⑦ Food Quality ───────────────────────────────────────────────────────────
async function loadFoodQuality() {
  const FOOD_FIELDS  = ["vg","g","s","b","vb"];
  const FOOD_LABELS  = ["Very Good","Good","Satisfactory","Bad","Very Bad"];
  const FOOD_COLORS  = ["rgba(22,101,52,0.8)","rgba(74,222,128,0.7)","rgba(250,204,21,0.7)","rgba(249,115,22,0.7)","rgba(153,27,27,0.8)"];
  const MK = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  try {
    const snap = await getDoc(doc(db, "food_data", String(currentYear)));
    if (!snap.exists()) { setText("fqTotal","No data"); return; }
    const months = snap.data().months || {};

    const totals = { vg:0, g:0, s:0, b:0, vb:0 };
    const byMonth = { vg:[], g:[], s:[], b:[], vb:[] };
    MK.forEach(m => {
      FOOD_FIELDS.forEach(f => {
        const v = Number(months[m]?.[f]) || 0;
        totals[f]      += v;
        byMonth[f].push(v);
      });
    });

    const grandTotal = Object.values(totals).reduce((a,b)=>a+b,0);
    const positive   = totals.vg + totals.g;
    const negative   = totals.b  + totals.vb;

    setText("fqTotal",    grandTotal.toLocaleString());
    setText("fqPositive", positive.toLocaleString());
    setText("fqNegative", negative.toLocaleString());

    // Pie
    const pieCanvas = el("fqPieChart");
    if (pieCanvas) {
      chartFQPie = new Chart(pieCanvas.getContext("2d"), {
        type: "doughnut",
        plugins: [pieLabelPlugin()],
        data: {
          labels: FOOD_LABELS,
          datasets: [{ data: FOOD_FIELDS.map(f=>totals[f]), backgroundColor:FOOD_COLORS, borderWidth:2, hoverOffset:6 }]
        },
        options: {
          responsive:true, maintainAspectRatio:false, cutout:"55%",
          plugins: {
            legend:{ position:"bottom", labels:{ usePointStyle:true, pointStyle:"circle", padding:12, font:{size:11} } },
            tooltip:{ callbacks:{ label: c => { const pct = grandTotal>0?(c.raw/grandTotal*100).toFixed(1):0; return ` ${c.label}: ${c.raw} (${pct}%)`; } } }
          }
        }
      });
    }

    // Stacked bar
    const barCanvas = el("fqBarChart");
    if (barCanvas) {
      chartFQBar = new Chart(barCanvas.getContext("2d"), {
        type: "bar",
        data: {
          labels: MONTHS,
          datasets: FOOD_FIELDS.map((f,i) => ({
            label: FOOD_LABELS[i], data: byMonth[f],
            backgroundColor: FOOD_COLORS[i], borderRadius:0
          }))
        },
        options: {
          responsive:true, maintainAspectRatio:false,
          plugins: { legend:{ position:"top", labels:{ usePointStyle:true, pointStyle:"circle", padding:10, font:{size:11} } } },
          scales: {
            x: { stacked:true, grid:{display:false} },
            y: { stacked:true, beginAtZero:true, grid:{color:"#f0f0ee"} }
          },
          animation: barLabelPlugin()
        }
      });
    }
  } catch(e) { console.error("FQ error:", e); }
}

// ── ⑧ Welfare ────────────────────────────────────────────────────────────────
async function loadWelfare() {
  const MK = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  try {
    const snap = await getDoc(doc(db, "welfare_data", String(currentYear)));
    if (!snap.exists()) { setText("wfTotal","No data"); return; }
    const months = snap.data().months || {};

    const totalArr    = MK.map(m => Number(months[m]?.total)    || 0);
    const solvedArr   = MK.map(m => Number(months[m]?.solved)   || 0);
    const followupArr = MK.map(m => Number(months[m]?.followup) || 0);

    const grandTotal  = totalArr.reduce((a,b)=>a+b,0);
    const grandSolved = solvedArr.reduce((a,b)=>a+b,0);
    const grandFollow = followupArr.reduce((a,b)=>a+b,0);
    const pct         = grandTotal > 0 ? (grandSolved/grandTotal*100).toFixed(1) : "—";

    setText("wfTotal",    grandTotal.toLocaleString());
    setText("wfSolved",   grandSolved.toLocaleString());
    setText("wfFollowup", grandFollow.toLocaleString());
    setText("wfPct", pct !== "—" ? `${pct}% resolved` : "—");

    // Pie
    const pieCanvas = el("wfPieChart");
    if (pieCanvas) {
      chartWFPie = new Chart(pieCanvas.getContext("2d"), {
        type: "doughnut",
        plugins: [pieLabelPlugin()],
        data: {
          labels: ["Solved","Follow-up"],
          datasets: [{ data:[grandSolved,grandFollow],
            backgroundColor:["rgba(22,101,52,0.8)","rgba(180,83,9,0.7)"],
            borderColor:["#166534","#b45309"], borderWidth:2, hoverOffset:6 }]
        },
        options: {
          responsive:true, maintainAspectRatio:false, cutout:"55%",
          plugins: {
            legend:{ position:"bottom", labels:{ usePointStyle:true, pointStyle:"circle", padding:20, font:{size:12} } },
            tooltip:{ callbacks:{ label: c => { const pct=grandTotal>0?(c.raw/grandTotal*100).toFixed(1):0; return ` ${c.label}: ${c.raw} (${pct}%)`; } } }
          }
        }
      });
    }

    // Bar
    const barCanvas = el("wfBarChart");
    if (barCanvas) {
      chartWFBar = new Chart(barCanvas.getContext("2d"), {
        type: "bar",
        data: {
          labels: MONTHS,
          datasets: [
            { label:"Total",    data:totalArr,    backgroundColor:"rgba(17,17,17,0.12)", borderRadius:4 },
            { label:"Solved",   data:solvedArr,   backgroundColor:"rgba(22,101,52,0.75)", borderRadius:4 },
            { label:"Follow-up",data:followupArr, backgroundColor:"rgba(180,83,9,0.65)",  borderRadius:4 }
          ]
        },
        options: {
          responsive:true, maintainAspectRatio:false,
          plugins: { legend:{ position:"top", labels:{ usePointStyle:true, pointStyle:"circle", padding:14, font:{size:12} } },
            tooltip:{ callbacks:{ label: c => ` ${c.dataset.label}: ${c.raw}` } } },
          scales: { x:{ grid:{display:false} }, y:{ beginAtZero:true, grid:{color:"#f0f0ee"} } },
          animation: barLabelPlugin()
        }
      });
    }
  } catch(e) { console.error("Welfare error:", e); }
}

// ── Logout ────────────────────────────────────────────────────────────────────
const logoutBtn = el("logoutBtn");
if (logoutBtn) logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "login.html";
});
