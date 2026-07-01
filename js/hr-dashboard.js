import { app } from "./firebase.js";
import { getAuth, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { getFirestore, doc, getDoc }
  from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const auth = getAuth(app);
const db   = getFirestore(app);

const MONTHS      = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_FULL = ["January","February","March","April","May","June",
                     "July","August","September","October","November","December"];

let currentYear = new Date().getFullYear();
let charts = {};

// ════════════════════════════════════════
// COLOR SYSTEM — Muted, sophisticated
// ════════════════════════════════════════
const P = {
  navy:      "#1E3A5F",
  navyFade:  "rgba(30,58,95,0.12)",
  navySoft:  "rgba(30,58,95,0.55)",
  steel:     "#2E5B88",
  steelFade: "rgba(46,91,136,0.12)",
  teal:      "#1B6B6B",
  tealFade:  "rgba(27,107,107,0.15)",
  sage:      "#3A6B4A",
  sageFade:  "rgba(58,107,74,0.15)",
  gold:      "#8B6914",
  goldFade:  "rgba(139,105,20,0.15)",
  rust:      "#8B3A2A",
  rustFade:  "rgba(139,58,42,0.15)",
  slate:     "#64748B",
  slateFade: "rgba(100,116,139,0.12)",
  // Chart specific
  plan:      "rgba(30,58,95,0.13)",
  planBorder:"rgba(30,58,95,0.4)",
  consumed:  "#2E5B88",
  ytdLine:   "#1E3A5F",
  pace:      "rgba(139,105,20,0.18)",
  paceBorder:"#8B6914",
  completed: "#3A6B4A",
  esTeam:    "#1E3A5F",
  erTeam:    "#1B6B6B",
  vGood:     "#2E5B88",
  good:      "#1B6B6B",
  satisf:    "#8B6914",
  bad:       "#8B3A2A",
  vBad:      "#5C1A0F",
  solved:    "#3A6B4A",
  followup:  "#8B6914",
};

// ════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════
const el  = id  => document.getElementById(id);
const set = (id, v) => { const n=el(id); if(n) n.textContent=v; };

function fmt(n) {
  if (n===null||n===undefined||isNaN(n)) return "—";
  return Number.isInteger(n) ? n.toLocaleString()
    : parseFloat(n).toLocaleString(undefined,{minimumFractionDigits:1,maximumFractionDigits:1});
}

function fmtK(n) {
  if (!n && n!==0) return "";
  if (Math.abs(n)>=1000) return (n/1000).toFixed(1)+"k";
  return String(n);
}

Chart.defaults.font.family = "'Inter', system-ui, -apple-system, sans-serif";
Chart.defaults.color       = "#64748b";

// ── Label drawing utilities ───────────────────────────────────────────────────

/**
 * Draw value labels on top of bars.
 * @param {Chart} chart
 * @param {number[]} [dsIndices] — which dataset indices to label (default: all)
 * @param {string}   [color]
 */
function labelBars(chart, dsIndices, color="#334155") {
  const ctx = chart.ctx;
  ctx.save();
  ctx.font         = "600 10.5px Inter,system-ui,sans-serif";
  ctx.textAlign    = "center";
  ctx.textBaseline = "bottom";
  chart.data.datasets.forEach((ds, di) => {
    if (dsIndices && !dsIndices.includes(di)) return;
    chart.getDatasetMeta(di).data.forEach((bar, idx) => {
      const v = ds.data[idx];
      if (!v || v===0) return;
      ctx.fillStyle = color;
      ctx.fillText(fmtK(v), bar.x, bar.y - 4);
    });
  });
  ctx.restore();
}

/**
 * Draw value labels above each point on a specific line dataset.
 */
function labelLine(chart, dsIdx, dataArr, color="#334155") {
  const ctx  = chart.ctx;
  const meta = chart.getDatasetMeta(dsIdx);
  ctx.save();
  ctx.font         = "600 10px Inter,system-ui,sans-serif";
  ctx.textAlign    = "center";
  ctx.textBaseline = "bottom";
  ctx.fillStyle    = color;
  meta.data.forEach((pt, i) => {
    const v = dataArr[i];
    if (!v && v!==0) return;
    ctx.fillText(fmtK(v), pt.x, pt.y - 8);
  });
  ctx.restore();
}

/** Draw % label inside each doughnut slice (skips slices < 4% to avoid clutter). */
const PIE_LABEL_PLUGIN = {
  id: "pieLabels",
  afterDatasetsDraw(chart) {
    const { ctx, data } = chart;
    const total = data.datasets[0].data.reduce((a,b)=>a+b,0);
    if (!total) return;
    ctx.save();
    ctx.font         = "700 11px Inter,system-ui,sans-serif";
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    chart.getDatasetMeta(0).data.forEach((arc, i) => {
      const v = data.datasets[0].data[i];
      if (!v || v/total < 0.05) return;
      const mid    = (arc.startAngle + arc.endAngle) / 2;
      const radius = (arc.innerRadius + arc.outerRadius) / 2;
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fillText((v/total*100).toFixed(1)+"%",
        arc.x + Math.cos(mid)*radius,
        arc.y + Math.sin(mid)*radius);
    });
    ctx.restore();
  }
};

// Shared axis configs
const xCfg = (extra={}) => ({ grid:{display:false}, ticks:{font:{size:11}}, ...extra });
const yCfg = (extra={}) => ({
  beginAtZero:true,
  grid:{ color:"rgba(148,163,184,0.15)", drawBorder:false },
  ticks:{ font:{size:11}, callback: v => fmtK(v) },
  ...extra
});

function killCharts() {
  Object.values(charts).forEach(c => { try{c.destroy();}catch(e){} });
  charts = {};
}

function showLoading(html) {
  const ls=el("loadingState"), mc=el("mainContent");
  if(ls){ls.style.display="block"; ls.innerHTML=html;}
  if(mc) mc.style.display="none";
}
function showContent() {
  const ls=el("loadingState"), mc=el("mainContent");
  if(ls) ls.style.display="none";
  if(mc) mc.style.display="block";
}

// ════════════════════════════════════════
// AUTH
// ════════════════════════════════════════
onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href="login.html"; return; }
  set("topbarEmail", user.email);
  buildYearPicker();
  loadAll();
});

function buildYearPicker() {
  const sel=el("yearSelect"); if(!sel) return;
  const base=new Date().getFullYear();
  for(let y=base-2; y<=base+5; y++){
    const o=document.createElement("option");
    o.value=y; o.textContent=y;
    if(y===base) o.selected=true;
    sel.appendChild(o);
  }
  sel.addEventListener("change", ()=>{ currentYear=Number(sel.value); loadAll(); });
}

// ════════════════════════════════════════
// LOAD ALL
// ════════════════════════════════════════
async function loadAll() {
  showLoading(`<div class="icon">📊</div>Loading ${currentYear}…`);
  killCharts();
  try {
    const snap = await getDoc(doc(db,"leave_data",String(currentYear)));
    if(!snap.exists()){
      showLoading(`<div class="icon">📭</div>No leave data for ${currentYear}. <a href="leave.html" style="color:#2E5B88;font-weight:600;">Enter data →</a>`);
      return;
    }
    const data   = snap.data();
    const months = data.months||{};
    const planArr     = MONTHS.map(m=>Number(months[m]?.plan)||0);
    const consumedArr = MONTHS.map(m=>Number(months[m]?.consumed)||0);

    const today=new Date();
    const curMo = currentYear===today.getFullYear() ? today.getMonth() : 11;

    const ytdPlan=[], ytdConsumed=[];
    let cumP=0, cumC=0;
    for(let i=0;i<12;i++){
      cumP+=planArr[i]; cumC+=consumedArr[i];
      ytdPlan.push(cumP);
      ytdConsumed.push(i<=curMo ? cumC : null);
    }

    const totPlan     = planArr.reduce((a,b)=>a+b,0);
    const totConsumed = consumedArr.reduce((a,b)=>a+b,0);
    const totDiff     = totConsumed-totPlan;
    const pct         = totPlan>0 ? totConsumed/totPlan*100 : 0;
    const pctCls      = pct>100?"over":pct<100?"under":"exact";
    const ytdPV       = ytdPlan[curMo]||0;
    const ytdCV       = ytdConsumed[curMo]||0;
    const ytdDiff     = ytdCV-ytdPV;

    showContent();
    await new Promise(r=>setTimeout(r,60));

    // Pct card
    const pctEl=el("pctValue");
    if(pctEl){pctEl.textContent=pct.toFixed(1)+"%"; pctEl.className="pct-value "+pctCls;}
    const barEl=el("pctBar");
    if(barEl){barEl.style.width=Math.min(pct,100)+"%"; barEl.className="pct-bar-fill "+pctCls;}
    set("pctPlan",     fmt(totPlan));
    set("pctConsumed", fmt(totConsumed));
    const dEl=el("pctDiff");
    if(dEl){dEl.textContent=(totDiff>=0?"+":"")+fmt(totDiff); dEl.className="s-val "+(totDiff>0?"pos":totDiff<0?"neg":"");}

    const luEl=el("lastUpdated");
    if(luEl&&data.updatedAt){
      const ts=data.updatedAt.toDate?data.updatedAt.toDate():new Date(data.updatedAt);
      luEl.textContent=`Last updated: ${ts.toLocaleString()} · by ${data.updatedByEmail||"—"}`;
      luEl.style.display="block";
    }

    // ② Leave bar
    charts.bar = buildLeaveBar(planArr, consumedArr);

    // ③ YTD line
    set("ytdPlanVal",     fmt(ytdPV));
    set("ytdConsumedVal", fmt(ytdCV));
    const ydEl=el("ytdDiffVal");
    if(ydEl){ydEl.textContent=(ytdDiff>=0?"+":"")+fmt(ytdDiff); ydEl.className="ys-val "+(ytdDiff>0?"pos":ytdDiff<0?"neg":"");}
    charts.ytd = buildYTD(ytdPlan, ytdConsumed);

    await buildYEEP();
    await buildHC();
    await buildFQ();
    await buildWF();

  } catch(e){
    console.error(e);
    showLoading(`<div class="icon">⚠️</div>Error: ${e.message}`);
  }
}

// ════════════════════════════════════════
// ② LEAVE BAR
// ════════════════════════════════════════
function buildLeaveBar(plan, consumed) {
  const c=el("barChart"); if(!c) return;
  return new Chart(c.getContext("2d"),{
    type:"bar",
    data:{
      labels:MONTHS,
      datasets:[
        {label:"Plan",     data:plan,     backgroundColor:P.plan,    borderColor:P.planBorder, borderWidth:1.5, borderRadius:5, borderSkipped:false},
        {label:"Consumed", data:consumed, backgroundColor:P.consumed,borderWidth:0,            borderRadius:5, borderSkipped:false}
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{position:"top",labels:{usePointStyle:true,pointStyle:"circle",padding:20,font:{size:12}}},
        tooltip:{callbacks:{label:c=>` ${c.dataset.label}: ${fmt(c.raw)}`}}
      },
      scales:{x:xCfg(), y:yCfg()},
      animation:{onComplete(){ labelBars(this.chart); }}
    }
  });
}

// ════════════════════════════════════════
// ③ YTD LINE
// ════════════════════════════════════════
function buildYTD(ytdPlan, ytdConsumed) {
  const c=el("ytdChart"); if(!c) return;
  const cData=[...ytdConsumed];
  return new Chart(c.getContext("2d"),{
    type:"line",
    data:{
      labels:MONTHS,
      datasets:[
        {label:"YTD Plan",     data:ytdPlan, borderColor:P.slateFade.replace("0.12","0.6"), backgroundColor:"transparent", borderWidth:2, borderDash:[7,4], pointRadius:3, pointBackgroundColor:P.slate, tension:0.35, fill:false},
        {label:"YTD Consumed", data:cData,   borderColor:P.ytdLine, backgroundColor:"rgba(30,58,95,0.07)", borderWidth:2.5, pointRadius:5, pointBackgroundColor:P.ytdLine, tension:0.35, fill:true}
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{position:"top",labels:{usePointStyle:true,pointStyle:"circle",padding:20,font:{size:12}}},
        tooltip:{callbacks:{label:c=>` ${c.dataset.label}: ${fmt(c.raw)}`}}
      },
      scales:{x:xCfg(), y:yCfg()},
      animation:{onComplete(){ labelLine(this.chart,1,cData); }}
    }
  });
}

// ════════════════════════════════════════
// ⑤ YEEP
// ════════════════════════════════════════
async function buildYEEP() {
  try {
    const snap=await getDoc(doc(db,"yeep_data",String(currentYear)));
    if(!snap.exists()){set("yeepTotal","No data");return;}
    const teams=snap.data().teams||{};
    const MK=MONTHS.map((_,i)=>`m${i}`);
    const esArr=MK.map(k=>Number(teams.ES?.[k])||0);
    const erArr=MK.map(k=>Number(teams.ER?.[k])||0);
    const totES=esArr.reduce((a,b)=>a+b,0);
    const totER=erArr.reduce((a,b)=>a+b,0);
    const total=totES+totER;

    set("yeepTotal", total.toLocaleString());
    set("yeepES",    totES.toLocaleString());
    set("yeepER",    totER.toLocaleString());
    set("yeepESPct", total>0?`${(totES/total*100).toFixed(1)}% of total`:"—");
    set("yeepERPct", total>0?`${(totER/total*100).toFixed(1)}% of total`:"—");

    const pie=el("yeepPieChart");
    if(pie){
      charts.yeepPie=new Chart(pie.getContext("2d"),{
        type:"doughnut", plugins:[PIE_LABEL_PLUGIN],
        data:{labels:["ES Team","ER Team"],datasets:[{data:[totES,totER],backgroundColor:[P.esTeam,P.erTeam],borderColor:"#fff",borderWidth:3,hoverOffset:8}]},
        options:{responsive:true,maintainAspectRatio:false,cutout:"62%",
          plugins:{legend:{position:"bottom",labels:{usePointStyle:true,pointStyle:"circle",padding:16,font:{size:12}}},
          tooltip:{callbacks:{label:c=>{const p=total>0?(c.raw/total*100).toFixed(1):0;return ` ${c.label}: ${c.raw.toLocaleString()} (${p}%)`;}}}}}
      });
    }
    const bar=el("yeepBarChart");
    if(bar){
      charts.yeepBar=new Chart(bar.getContext("2d"),{
        type:"bar",
        data:{labels:MONTHS,datasets:[
          {label:"ES Team",data:esArr,backgroundColor:P.esTeam,borderRadius:5,borderWidth:0},
          {label:"ER Team",data:erArr,backgroundColor:P.erTeam,borderRadius:5,borderWidth:0}
        ]},
        options:{responsive:true,maintainAspectRatio:false,
          plugins:{legend:{position:"top",labels:{usePointStyle:true,pointStyle:"circle",padding:16,font:{size:12}}},tooltip:{callbacks:{label:c=>` ${c.dataset.label}: ${c.raw.toLocaleString()}`}}},
          scales:{x:xCfg(),y:yCfg()},
          animation:{onComplete(){labelBars(this.chart);}}}
      });
    }
  } catch(e){console.error("YEEP:",e);}
}

// ════════════════════════════════════════
// ⑥ HEALTH CHECKUP
// ════════════════════════════════════════
async function buildHC() {
  try {
    const snap=await getDoc(doc(db,"health_data",String(currentYear)));
    if(!snap.exists()){set("hcTarget","No data");return;}
    const data=snap.data();
    const months=data.months||{};
    const target=Number(data.target)||0;
    const completed=MONTHS.map(m=>Number(months[m]?.completed)||0);
    const ytd=completed.reduce((a,b)=>a+b,0);
    const pct=target>0?(ytd/target*100).toFixed(1):"—";
    const monthlyPace=target>0 ? parseFloat((target/12).toFixed(1)) : 0;
    const paceArr=MONTHS.map(()=>monthlyPace);

    set("hcTarget",    target>0?target.toLocaleString():"—");
    set("hcCompleted", ytd.toLocaleString());
    const pEl=el("hcPct");
    if(pEl){
      pEl.textContent=pct!=="—"?pct+"%":"—";
      pEl.style.color=pct!=="—"&&Number(pct)>=100?"#3A6B4A":"#8B3A2A";
    }
    set("hcPctSub",pct!=="—"?(Number(pct)>=100?"On track ✓":`${(target-ytd).toLocaleString()} remaining`):"");

    const c=el("hcBarChart"); if(!c) return;
    const compData=[...completed];
    const paceData=[...paceArr];
    charts.hcBar=new Chart(c.getContext("2d"),{
      type:"bar",
      data:{
        labels:MONTHS,
        datasets:[
          {label:"Monthly Pace",  data:paceData, backgroundColor:P.pace,     borderColor:P.paceBorder, borderWidth:2, borderRadius:5, borderSkipped:false},
          {label:"Completed",     data:compData, backgroundColor:P.completed, borderWidth:0,            borderRadius:5, borderSkipped:false}
        ]
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{
          legend:{position:"top",labels:{usePointStyle:true,pointStyle:"circle",padding:20,font:{size:12}}},
          tooltip:{callbacks:{label:c=>` ${c.dataset.label}: ${fmt(c.raw)}`}}
        },
        scales:{x:xCfg(), y:yCfg()},
        animation:{
          onComplete(){
            // Label BOTH datasets explicitly
            labelBars(this.chart, [0,1]);
          }
        }
      }
    });
  } catch(e){console.error("HC:",e);}
}

// ════════════════════════════════════════
// ⑦ FOOD QUALITY
// ════════════════════════════════════════
async function buildFQ() {
  const FF=["vg","g","s","b","vb"];
  const FL=["Very Good","Good","Satisfactory","Bad","Very Bad"];
  const FC=[P.vGood,P.good,P.satisf,P.bad,P.vBad];
  try {
    const snap=await getDoc(doc(db,"food_data",String(currentYear)));
    if(!snap.exists()){set("fqTotal","No data");return;}
    const months=snap.data().months||{};
    const totals={vg:0,g:0,s:0,b:0,vb:0};
    const byMonth={vg:[],g:[],s:[],b:[],vb:[]};
    MONTHS.forEach(m=>{
      FF.forEach(f=>{
        const v=Number(months[m]?.[f])||0;
        totals[f]+=v; byMonth[f].push(v);
      });
    });
    const grand=Object.values(totals).reduce((a,b)=>a+b,0);
    set("fqTotal",    grand.toLocaleString());
    set("fqPositive", (totals.vg+totals.g).toLocaleString());
    set("fqNegative", (totals.b+totals.vb).toLocaleString());

    const pie=el("fqPieChart");
    if(pie){
      charts.fqPie=new Chart(pie.getContext("2d"),{
        type:"doughnut", plugins:[PIE_LABEL_PLUGIN],
        data:{labels:FL,datasets:[{data:FF.map(f=>totals[f]),backgroundColor:FC,borderColor:"#fff",borderWidth:3,hoverOffset:8}]},
        options:{responsive:true,maintainAspectRatio:false,cutout:"55%",
          plugins:{legend:{position:"bottom",labels:{usePointStyle:true,pointStyle:"circle",padding:10,font:{size:11}}},
          tooltip:{callbacks:{label:c=>{const p=grand>0?(c.raw/grand*100).toFixed(1):0;return ` ${c.label}: ${c.raw} (${p}%)`;}}}}}
      });
    }
    const bar=el("fqBarChart");
    if(bar){
      charts.fqBar=new Chart(bar.getContext("2d"),{
        type:"bar",
        data:{labels:MONTHS,datasets:FF.map((f,i)=>({label:FL[i],data:byMonth[f],backgroundColor:FC[i],borderWidth:0,borderRadius:0}))},
        options:{responsive:true,maintainAspectRatio:false,
          plugins:{legend:{position:"top",labels:{usePointStyle:true,pointStyle:"circle",padding:10,font:{size:11}}},
          tooltip:{mode:"index",intersect:false}},
          scales:{x:{...xCfg(),stacked:true},y:{...yCfg(),stacked:true}},
          animation:{onComplete(){
            // Label the top of each stacked bar (last visible dataset)
            labelBars(this.chart,[FF.length-1]);
          }}}
      });
    }
  } catch(e){console.error("FQ:",e);}
}

// ════════════════════════════════════════
// ⑧ WELFARE
// ════════════════════════════════════════
async function buildWF() {
  try {
    const snap=await getDoc(doc(db,"welfare_data",String(currentYear)));
    if(!snap.exists()){set("wfTotal","No data");return;}
    const months=snap.data().months||{};
    const totArr=MONTHS.map(m=>Number(months[m]?.total)||0);
    const solArr=MONTHS.map(m=>Number(months[m]?.solved)||0);
    const folArr=MONTHS.map(m=>Number(months[m]?.followup)||0);
    const gTot=totArr.reduce((a,b)=>a+b,0);
    const gSol=solArr.reduce((a,b)=>a+b,0);
    const gFol=folArr.reduce((a,b)=>a+b,0);
    const pct=gTot>0?(gSol/gTot*100).toFixed(1):"—";

    set("wfTotal",    gTot.toLocaleString());
    set("wfSolved",   gSol.toLocaleString());
    set("wfFollowup", gFol.toLocaleString());
    set("wfPct",      pct!=="—"?`${pct}% resolved`:"—");

    const pie=el("wfPieChart");
    if(pie){
      charts.wfPie=new Chart(pie.getContext("2d"),{
        type:"doughnut", plugins:[PIE_LABEL_PLUGIN],
        data:{labels:["Solved","Follow-up"],datasets:[{data:[gSol,gFol],backgroundColor:[P.solved,P.followup],borderColor:"#fff",borderWidth:3,hoverOffset:8}]},
        options:{responsive:true,maintainAspectRatio:false,cutout:"62%",
          plugins:{legend:{position:"bottom",labels:{usePointStyle:true,pointStyle:"circle",padding:20,font:{size:12}}},
          tooltip:{callbacks:{label:c=>{const p=gTot>0?(c.raw/gTot*100).toFixed(1):0;return ` ${c.label}: ${c.raw} (${p}%)`;}}}}}
      });
    }
    const bar=el("wfBarChart");
    if(bar){
      charts.wfBar=new Chart(bar.getContext("2d"),{
        type:"bar",
        data:{labels:MONTHS,datasets:[
          {label:"Total",     data:totArr, backgroundColor:P.slateFade, borderColor:P.slate, borderWidth:1.5, borderRadius:5, borderSkipped:false},
          {label:"Solved",    data:solArr, backgroundColor:P.solved,    borderWidth:0, borderRadius:5, borderSkipped:false},
          {label:"Follow-up", data:folArr, backgroundColor:P.followup,  borderWidth:0, borderRadius:5, borderSkipped:false}
        ]},
        options:{responsive:true,maintainAspectRatio:false,
          plugins:{legend:{position:"top",labels:{usePointStyle:true,pointStyle:"circle",padding:14,font:{size:12}}},tooltip:{callbacks:{label:c=>` ${c.dataset.label}: ${c.raw}`}}},
          scales:{x:xCfg(),y:yCfg()},
          animation:{onComplete(){labelBars(this.chart,[0,1,2]);}}}
      });
    }
  } catch(e){console.error("WF:",e);}
}

// ── Logout ────────────────────────────────────────────────────────────────────
el("logoutBtn")?.addEventListener("click", async()=>{
  await signOut(auth); window.location.href="login.html";
});
