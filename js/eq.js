import { app } from "./firebase.js";
import { guardRole } from "./guard.js";
import { getAuth, signOut }
  from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc }
  from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const auth = getAuth(app);
const db   = getFirestore(app);

const MONTHS     = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_FULL= ["January","February","March","April","May","June",
                    "July","August","September","October","November","December"];

let currentUser = null;
let currentYear = new Date().getFullYear();
let data = {}; // { Jan:{plan:0,complete:0}, ... }

const el  = id => document.getElementById(id);
const set = (id, v) => { const e=el(id); if(e) e.textContent=v; };

guardRole(["admin","data_entry"]).then(({ user }) => {
  currentUser = user;
  set("topbarEmail", user.email);
  buildYearSelector();
  loadData();
});

function buildYearSelector(){
  const sel = el("yearSelect"); if(!sel) return;
  const y = new Date().getFullYear();
  for(let i=y; i>=y-4; i--){
    const o=document.createElement("option");
    o.value=i; o.textContent=i;
    if(i===currentYear) o.selected=true;
    sel.appendChild(o);
  }
  sel.addEventListener("change",()=>{ currentYear=Number(sel.value); loadData(); });
}

async function loadData(){
  el("tableBody").innerHTML=`<tr><td colspan="5" style="padding:20px;color:var(--muted);text-align:center">Loading…</td></tr>`;
  try{
    const snap = await getDoc(doc(db,"eq_data",String(currentYear)));
    data={};
    if(snap.exists()){
      const d=snap.data();
      MONTHS.forEach(m=>{ data[m]={ plan:Number(d[m]?.plan)||0, complete:Number(d[m]?.complete)||0 }; });
    } else {
      MONTHS.forEach(m=>{ data[m]={plan:0,complete:0}; });
    }
    renderTable();
  } catch(e){
    el("tableBody").innerHTML=`<tr><td colspan="5" style="padding:20px;color:red;text-align:center">Load failed: ${e.message}</td></tr>`;
  }
}

function renderTable(){
  let totPlan=0, totComplete=0;
  el("tableBody").innerHTML = MONTHS.map((m,i)=>{
    const p=data[m]?.plan||0, c=data[m]?.complete||0;
    totPlan+=p; totComplete+=c;
    const pct = p>0 ? Math.round(c/p*100) : 0;
    const barColor = pct>=100?"#3A6B4A":pct>=70?"#BA7517":"#8B3A2A";
    return `<tr>
      <td style="font-weight:600;color:var(--text);padding:9px 14px;">${MONTHS_FULL[i]}</td>
      <td style="padding:9px 8px;text-align:center;">
        <input type="number" min="0" class="eq-input" id="plan_${m}"
          value="${p||""}" placeholder="0" oninput="onInput('${m}','plan',this.value)"/>
      </td>
      <td style="padding:9px 8px;text-align:center;">
        <input type="number" min="0" class="eq-input" id="complete_${m}"
          value="${c||""}" placeholder="0" oninput="onInput('${m}','complete',this.value)"/>
      </td>
      <td style="padding:9px 14px;text-align:center;font-weight:700;" id="pct_${m}">
        ${p>0?`<span style="color:${barColor}">${pct}%</span>`:"—"}
      </td>
      <td style="padding:9px 14px;">
        <div style="height:8px;background:#EDF0F4;border-radius:99px;overflow:hidden;min-width:80px;">
          <div id="bar_${m}" style="height:100%;width:${Math.min(pct,100)}%;background:${barColor};border-radius:99px;transition:width 400ms;"></div>
        </div>
      </td>
    </tr>`;
  }).join("");

  // Update totals
  const totPct = totPlan>0?Math.round(totComplete/totPlan*100):0;
  set("totPlan", totPlan||"—");
  set("totComplete", totComplete||"—");
  set("totPct", totPlan>0?`${totPct}%`:"—");
}

window.onInput = function(month, field, val){
  if(!data[month]) data[month]={plan:0,complete:0};
  data[month][field] = Number(val)||0;
  // Update pct + bar for this row
  const p=data[month].plan, c=data[month].complete;
  const pct = p>0?Math.round(c/p*100):0;
  const barColor = pct>=100?"#3A6B4A":pct>=70?"#BA7517":"#8B3A2A";
  const pctEl=el(`pct_${month}`);
  const barEl=el(`bar_${month}`);
  if(pctEl) pctEl.innerHTML = p>0?`<span style="color:${barColor}">${pct}%</span>`:"—";
  if(barEl){ barEl.style.width=Math.min(pct,100)+"%"; barEl.style.background=barColor; }
  // Update totals
  let totPlan=0,totComplete=0;
  MONTHS.forEach(m=>{ totPlan+=data[m]?.plan||0; totComplete+=data[m]?.complete||0; });
  const totPct=totPlan>0?Math.round(totComplete/totPlan*100):0;
  set("totPlan",totPlan||"—"); set("totComplete",totComplete||"—");
  set("totPct",totPlan>0?`${totPct}%`:"—");
};

el("saveBtn")?.addEventListener("click", async()=>{
  const btn=el("saveBtn"), msg=el("saveMsg");
  btn.disabled=true;
  if(msg){ msg.textContent="Saving…"; msg.className="save-msg"; }
  try{
    const saveObj={ year:currentYear, updatedAt:new Date().toISOString(), updatedBy:currentUser.email };
    MONTHS.forEach(m=>{ saveObj[m]={ plan:data[m]?.plan||0, complete:data[m]?.complete||0 }; });
    await setDoc(doc(db,"eq_data",String(currentYear)), saveObj);
    if(msg){ msg.textContent=`✓ Saved — ${new Date().toLocaleString()}`; msg.className="save-msg success"; }
  } catch(e){
    if(msg){ msg.textContent=`Save failed: ${e.message}`; msg.className="save-msg error"; }
  }
  btn.disabled=false;
  setTimeout(()=>{ if(msg) msg.textContent=""; },4000);
});

el("logoutBtn")?.addEventListener("click",async()=>{ await signOut(auth); window.location.href="login.html"; });
