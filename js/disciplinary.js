import { app } from "./firebase.js";
import { getAuth, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc }
  from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const auth = getAuth(app);
const db   = getFirestore(app);

// ── Constants ─────────────────────────────────────────────────────────────────
const REASONS = [
  "Negligence of Work",
  "Indecent behaviour",
  "Disobedance",
  "Damage to any property",
  "Dishonesty",
  "Theft",
  "Verbal abuse",
  "Mental abuse",
  "Physical harassment",
  "Sexual Harassement"
];

const MONTHS_FULL = ["January","February","March","April","May","June",
                     "July","August","September","October","November","December"];
const MONTHS      = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ── State ─────────────────────────────────────────────────────────────────────
let currentUser  = null;
let currentYear  = new Date().getFullYear();
let outMode      = "monthly";   // "monthly" | "weekly"
let outMonth     = new Date().getMonth(); // 0-indexed
let caseData     = {};   // { reasons: { [reason]: [ {code,name,desig,subsection,floor,complain,showCauseDate,daysDiff}, ... ] } }
let outData      = {};   // { monthly: { Jan: num, ... }, weekly: { 0: { w1: num, ... }, ... } }

// ── Helpers ───────────────────────────────────────────────────────────────────
const el  = id => document.getElementById(id);
const set = (id, v) => { const n=el(id); if(n) n.textContent=v; };

function showToast(text, error=false) {
  const t = document.getElementById("toast");
  t.textContent = text; t.className = "toast"+(error?" error":"");
  t.classList.add("show"); setTimeout(()=>t.classList.remove("show"),3000);
}
function setLastSaved(elId, email) {
  const n=el(elId); if(!n) return;
  n.textContent=`Last saved by ${email} on ${new Date().toLocaleString()}`;
  n.style.display="block";
}
function fmt(n) { return (!n&&n!==0)?"—":Number(n).toLocaleString(); }

function reasonKey(r) { return r.replace(/[^a-zA-Z0-9]/g,"_"); }

// ── Auth ──────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href="login.html"; return; }
  currentUser = user;
  set("topbarEmail", user.email);
  buildControls();
  await loadAll();
});

// ── Controls ──────────────────────────────────────────────────────────────────
function buildControls() {
  // Year
  const sel=el("yearSelect"); const base=new Date().getFullYear();
  for(let y=base-2;y<=base+5;y++){
    const o=document.createElement("option");
    o.value=y; o.textContent=y; if(y===base) o.selected=true;
    sel.appendChild(o);
  }
  sel.addEventListener("change",()=>{ currentYear=Number(sel.value); loadAll(); });

  // Week month picker
  const wm=el("weekMonthSelect");
  MONTHS_FULL.forEach((m,i)=>{
    const o=document.createElement("option");
    o.value=i; o.textContent=m; if(i===outMonth) o.selected=true;
    wm.appendChild(o);
  });
  wm.addEventListener("change",()=>{ outMonth=Number(wm.value); renderOutTable(); });

  // Tabs
  document.querySelectorAll(".page-tab").forEach(tab=>{
    tab.addEventListener("click",()=>{
      document.querySelectorAll(".page-tab").forEach(t=>t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(t=>t.classList.remove("active"));
      tab.classList.add("active");
      el(`tab-${tab.dataset.tab}`).classList.add("active");
    });
  });
}

window.setMode = function(mode) {
  outMode=mode;
  el("modeMonthly").classList.toggle("active", mode==="monthly");
  el("modeWeekly").classList.toggle("active",  mode==="weekly");
  el("weekMonthPicker").style.display = mode==="weekly"?"flex":"none";
  renderOutTable();
};

// ── Load all data ─────────────────────────────────────────────────────────────
async function loadAll() {
  caseData={}; outData={};
  try {
    const [cs, os] = await Promise.all([
      getDoc(doc(db,"disciplinary_cases",String(currentYear))),
      getDoc(doc(db,"disciplinary_out",  String(currentYear)))
    ]);
    if(cs.exists()) {
      caseData=cs.data();
      const ts = caseData.updatedAt ? new Date(caseData.updatedAt.toDate?caseData.updatedAt.toDate():caseData.updatedAt) : null;
      if(ts) {
        const ls=el("caseLastSaved");
        if(ls){ls.textContent=`Last saved by ${caseData.updatedByEmail||"—"} on ${ts.toLocaleString()}`;ls.style.display="block";}
        set("sumUpdated", ts.toLocaleDateString());
      }
    }
    if(os.exists()) {
      outData=os.data();
      const ls=el("outLastSaved");
      if(ls&&outData.updatedAt){
        const ts=outData.updatedAt.toDate?outData.updatedAt.toDate():new Date(outData.updatedAt);
        ls.textContent=`Last saved by ${outData.updatedByEmail||"—"} on ${ts.toLocaleString()}`;
        ls.style.display="block";
      }
    }
  } catch(e){console.error("Load:",e);}
  renderCaseTables();
  renderOutTable();
}

// ════════════════════════════════════════
// CASE RECORDS
// ════════════════════════════════════════
function renderCaseTables() {
  const container=el("reasonTables"); container.innerHTML="";
  let totalCases=0, activeReasons=0;

  REASONS.forEach(reason=>{
    const key=reasonKey(reason);
    const rows=(caseData.reasons?.[key])||[{}]; // at least 1 empty row
    totalCases += rows.filter(r=>r.name||r.code).length;
    if(rows.some(r=>r.name||r.code)) activeReasons++;

    const card=document.createElement("div");
    card.className="disc-card"; card.id=`card-${key}`;
    card.innerHTML=`
      <div class="disc-reason-header">
        <span>${reason}</span>
        <button class="add-row-btn" onclick="addRow('${key}')">+ Add Row</button>
      </div>
      <table class="disc-table">
        <thead>
          <tr>
            <th style="width:30px;">#</th>
            <th>Code</th>
            <th>Employee Name</th>
            <th>Designation</th>
            <th>Sub Section</th>
            <th>Floor</th>
            <th>Complain</th>
            <th>Show Cause Date</th>
            <th>Days Diff</th>
            <th style="width:30px;"></th>
          </tr>
        </thead>
        <tbody id="tbody-${key}"></tbody>
      </table>
    `;
    container.appendChild(card);
    renderRows(key, rows);
  });

  set("sumTotal",   totalCases||"0");
  set("sumReasons", activeReasons||"0");
}

function renderRows(key, rows) {
  const tbody=el(`tbody-${key}`); if(!tbody) return;
  tbody.innerHTML="";
  if(!rows||rows.length===0){
    tbody.innerHTML=`<tr><td colspan="10"><div class="empty-reason">No entries — click + Add Row</div></td></tr>`;
    return;
  }
  rows.forEach((row,i)=>{ tbody.appendChild(buildRow(key, i, row)); });
}

function buildRow(key, idx, row={}) {
  const tr=document.createElement("tr");
  tr.id=`row-${key}-${idx}`;
  tr.innerHTML=`
    <td style="color:var(--muted);font-size:0.75rem;text-align:center;">${idx+1}</td>
    <td><input class="di di-sm" type="text" placeholder="Code" value="${row.code||""}" data-k="${key}" data-i="${idx}" data-f="code"/></td>
    <td><input class="di di-lg" type="text" placeholder="Employee Name" value="${row.name||""}" data-k="${key}" data-i="${idx}" data-f="name"/></td>
    <td><input class="di di-md" type="text" placeholder="Designation" value="${row.desig||""}" data-k="${key}" data-i="${idx}" data-f="desig"/></td>
    <td><input class="di di-md" type="text" placeholder="Sub Section" value="${row.subsection||""}" data-k="${key}" data-i="${idx}" data-f="subsection"/></td>
    <td><input class="di di-sm" type="text" placeholder="Floor" value="${row.floor||""}" data-k="${key}" data-i="${idx}" data-f="floor"/></td>
    <td><input class="di di-xl" type="text" placeholder="Complain details" value="${row.complain||""}" data-k="${key}" data-i="${idx}" data-f="complain"/></td>
    <td><input class="di di-date" type="date" value="${row.showCauseDate||""}" data-k="${key}" data-i="${idx}" data-f="showCauseDate"/></td>
    <td><input class="di di-sm" type="number" min="0" placeholder="0" value="${row.daysDiff??""}" data-k="${key}" data-i="${idx}" data-f="daysDiff"/></td>
    <td><button class="del-btn" onclick="delRow('${key}',${idx})" title="Delete row">✕</button></td>
  `;
  return tr;
}

window.addRow = function(key) {
  if(!caseData.reasons) caseData.reasons={};
  if(!caseData.reasons[key]) caseData.reasons[key]=[];
  caseData.reasons[key].push({});
  renderRows(key, caseData.reasons[key]);
  updateSummary();
};

window.delRow = function(key, idx) {
  if(!caseData.reasons?.[key]) return;
  caseData.reasons[key].splice(idx,1);
  if(caseData.reasons[key].length===0) caseData.reasons[key]=[{}];
  renderRows(key, caseData.reasons[key]);
  updateSummary();
};

function updateSummary() {
  let total=0, active=0;
  REASONS.forEach(r=>{
    const rows=caseData.reasons?.[reasonKey(r)]||[];
    const filled=rows.filter(x=>x.name||x.code).length;
    total+=filled; if(filled>0) active++;
  });
  set("sumTotal",   total||"0");
  set("sumReasons", active||"0");
}

function collectCases() {
  const reasons={};
  REASONS.forEach(reason=>{
    const key=reasonKey(reason);
    const tbody=el(`tbody-${key}`); if(!tbody) return;
    const inputs=tbody.querySelectorAll("input[data-k]");
    const rowMap={};
    inputs.forEach(inp=>{
      const i=Number(inp.dataset.i), f=inp.dataset.f;
      if(!rowMap[i]) rowMap[i]={};
      rowMap[i][f]=inp.value.trim();
    });
    reasons[key]=Object.values(rowMap).filter(r=>Object.values(r).some(v=>v));
    if(reasons[key].length===0) reasons[key]=[{}];
  });
  return reasons;
}

el("caseSaveBtn").addEventListener("click", async()=>{
  const btn=el("caseSaveBtn"), msg=el("caseMsg");
  msg.className="message"; msg.textContent="";
  btn.disabled=true; btn.classList.add("loading");
  try {
    const reasons=collectCases();
    const data={ year:currentYear, reasons, updatedAt:new Date().toISOString(), updatedByEmail:currentUser.email };
    await setDoc(doc(db,"disciplinary_cases",String(currentYear)), data);
    caseData=data;
    msg.className="message success"; msg.textContent=`✓ Cases saved for ${currentYear}.`;
    setLastSaved("caseLastSaved", currentUser.email);
    updateSummary();
    showToast("Disciplinary cases saved!");
  } catch(e){ msg.textContent="Save failed: "+e.message; }
  btn.disabled=false; btn.classList.remove("loading");
});

// ════════════════════════════════════════
// OUTSTANDING NUMBER
// ════════════════════════════════════════
function getWeeks(year, month) {
  const weeks=[]; const last=new Date(year,month+1,0); let d=new Date(year,month,1); let n=1;
  while(d<=last){
    const s=new Date(d), e=new Date(d); e.setDate(e.getDate()+6);
    if(e>last) e.setDate(last.getDate());
    weeks.push({ label:`Week ${n} (${s.toLocaleDateString("en-US",{month:"short",day:"numeric"})} – ${e.toLocaleDateString("en-US",{month:"short",day:"numeric"})})`, key:`w${n}` });
    d.setDate(d.getDate()+7); n++;
  }
  return weeks;
}

function renderOutTable() {
  const area=el("outTableArea"); if(!area) return;
  const title=el("outTableTitle");

  if(outMode==="monthly"){
    if(title) title.textContent="Monthly Outstanding Numbers";
    let total=0;
    const rows=MONTHS_FULL.map((m,i)=>{
      const v=outData.monthly?.[MONTHS[i]]??""
      if(v!=="") total+=Number(v)||0;
      return `<tr>
        <td>${m}</td>
        <td><input class="out-input" type="number" min="0" id="out-m-${MONTHS[i]}" value="${v}" placeholder="0" oninput="updateOutTotal()"/></td>
      </tr>`;
    }).join("");
    area.innerHTML=`
      <table class="out-table">
        <thead><tr><th>Month</th><th>Outstanding Cases</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr class="total-row"><td>Total</td><td style="text-align:center;" id="outTotal">${total||"—"}</td></tr></tfoot>
      </table>`;
  } else {
    const weeks=getWeeks(currentYear, outMonth);
    if(title) title.textContent=`Weekly Outstanding — ${MONTHS_FULL[outMonth]} ${currentYear}`;
    let total=0;
    const mKey=MONTHS[outMonth];
    const rows=weeks.map(({label,key})=>{
      const v=outData.weekly?.[mKey]?.[key]??""
      if(v!=="") total+=Number(v)||0;
      return `<tr>
        <td>${label}</td>
        <td><input class="out-input" type="number" min="0" id="out-w-${mKey}-${key}" value="${v}" placeholder="0" oninput="updateOutTotal()"/></td>
      </tr>`;
    }).join("");
    area.innerHTML=`
      <table class="out-table">
        <thead><tr><th>Week</th><th>Outstanding Cases</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr class="total-row"><td>Total</td><td style="text-align:center;" id="outTotal">${total||"—"}</td></tr></tfoot>
      </table>`;
  }
}

window.updateOutTotal = function() {
  let total=0;
  document.querySelectorAll(".out-input").forEach(inp=>{ total+=Number(inp.value)||0; });
  set("outTotal", total>0?total.toLocaleString():"—");
};

el("outSaveBtn").addEventListener("click", async()=>{
  const btn=el("outSaveBtn"), msg=el("outMsg");
  msg.className="message"; msg.textContent="";
  btn.disabled=true; btn.classList.add("loading");

  if(!outData.monthly) outData.monthly={};
  if(!outData.weekly)  outData.weekly={};

  if(outMode==="monthly"){
    MONTHS.forEach(m=>{ const inp=el(`out-m-${m}`); if(inp) outData.monthly[m]=Number(inp.value)||0; });
  } else {
    const mKey=MONTHS[outMonth];
    if(!outData.weekly[mKey]) outData.weekly[mKey]={};
    const weeks=getWeeks(currentYear,outMonth);
    weeks.forEach(({key})=>{ const inp=el(`out-w-${mKey}-${key}`); if(inp) outData.weekly[mKey][key]=Number(inp.value)||0; });
  }

  try {
    const data={ year:currentYear, monthly:outData.monthly, weekly:outData.weekly, updatedAt:new Date().toISOString(), updatedByEmail:currentUser.email };
    await setDoc(doc(db,"disciplinary_out",String(currentYear)), data);
    outData=data;
    msg.className="message success"; msg.textContent=`✓ Outstanding numbers saved.`;
    setLastSaved("outLastSaved", currentUser.email);
    showToast("Outstanding data saved!");
  } catch(e){ msg.textContent="Save failed: "+e.message; }
  btn.disabled=false; btn.classList.remove("loading");
});

// ── Logout ────────────────────────────────────────────────────────────────────
el("logoutBtn")?.addEventListener("click",async()=>{ await signOut(auth); window.location.href="login.html"; });
