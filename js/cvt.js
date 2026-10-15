import { app } from "./firebase.js";
import { guardRole } from "./guard.js";
import { getAuth, signOut }
  from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc }
  from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const auth = getAuth(app);
const db   = getFirestore(app);

const JOB_STATUSES = ["Active","Inactive"];
let currentUser = null;
let data = {
  Active:   { total:0, done:0 },
  Inactive: { total:0, done:0 }
};

const el  = id => document.getElementById(id);
const set = (id,v) => { const e=el(id); if(e) e.textContent=v; };

guardRole(["admin","data_entry"]).then(({ user }) => {
  currentUser = user;
  set("topbarEmail", user.email);
  loadData();
});

async function loadData(){
  try{
    const snap = await getDoc(doc(db,"cvt_data","current"));
    if(snap.exists()){
      const d = snap.data();
      JOB_STATUSES.forEach(s=>{
        data[s] = { total:Number(d[s]?.total)||0, done:Number(d[s]?.done)||0 };
      });
    }
    renderTable();
  } catch(e){
    el("tableArea").innerHTML=`<div style="padding:20px;color:red">Load failed: ${e.message}</div>`;
  }
}

function renderTable(){
  let grandTotal=0, grandDone=0;
  const rows = JOB_STATUSES.map(s=>{
    const t=data[s].total, d=data[s].done, nd=t-d;
    const pct=t>0?Math.round(d/t*100):0;
    const barColor=pct>=70?"#3A6B4A":pct>=50?"#BA7517":"#8B3A2A";
    grandTotal+=t; grandDone+=d;
    return `<tr>
      <td style="font-weight:600;padding:10px 14px;">${s}</td>
      <td style="text-align:center;padding:10px 8px;">
        <input type="number" min="0" class="cvt-input" id="cvt_total_${s}"
          value="${t||""}" placeholder="0" oninput="onInput('${s}','total',this.value)"/>
      </td>
      <td style="text-align:center;padding:10px 8px;">
        <input type="number" min="0" class="cvt-input" id="cvt_done_${s}"
          value="${d||""}" placeholder="0" oninput="onInput('${s}','done',this.value)"/>
      </td>
      <td style="text-align:center;font-weight:700;padding:10px 8px;" id="cvt_nd_${s}">${nd||"0"}</td>
      <td style="padding:10px 14px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="flex:1;height:8px;background:#EDF0F4;border-radius:99px;overflow:hidden;min-width:80px;">
            <div id="cvt_bar_${s}" style="height:100%;width:${pct}%;background:${barColor};border-radius:99px;transition:width 400ms;"></div>
          </div>
          <span id="cvt_pct_${s}" style="font-weight:700;font-size:0.85rem;min-width:36px;color:${barColor}">${pct}%</span>
        </div>
      </td>
    </tr>`;
  }).join("");

  const grandND  = grandTotal - grandDone;
  const grandPct = grandTotal>0?Math.round(grandDone/grandTotal*100):0;
  const grandColor = grandPct>=70?"#3A6B4A":grandPct>=50?"#BA7517":"#8B3A2A";

  el("tableArea").innerHTML = `
    <table class="cvt-table">
      <thead><tr>
        <th style="text-align:left;min-width:100px;">Job Status</th>
        <th>Total Joined</th>
        <th>Training Done</th>
        <th>Training Not Done</th>
        <th style="min-width:180px;">Achievement</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td style="font-weight:700;padding:10px 14px;color:var(--navy);">Total</td>
        <td style="text-align:center;font-weight:700;padding:10px 8px;" id="cvt_grand_total">${grandTotal}</td>
        <td style="text-align:center;font-weight:700;padding:10px 8px;" id="cvt_grand_done">${grandDone}</td>
        <td style="text-align:center;font-weight:700;padding:10px 8px;" id="cvt_grand_nd">${grandND}</td>
        <td style="padding:10px 14px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="flex:1;height:8px;background:#EDF0F4;border-radius:99px;overflow:hidden;">
              <div id="cvt_grand_bar" style="height:100%;width:${grandPct}%;background:${grandColor};border-radius:99px;"></div>
            </div>
            <span id="cvt_grand_pct" style="font-weight:700;font-size:0.85rem;min-width:36px;color:${grandColor}">${grandPct}%</span>
          </div>
        </td>
      </tr></tfoot>
    </table>`;
}

window.onInput = function(status, field, val){
  data[status][field] = Number(val)||0;
  const t=data[status].total, d=data[status].done, nd=Math.max(0,t-d);
  const pct=t>0?Math.round(d/t*100):0;
  const barColor=pct>=70?"#3A6B4A":pct>=50?"#BA7517":"#8B3A2A";
  const ndEl=el(`cvt_nd_${status}`); if(ndEl) ndEl.textContent=nd;
  const barEl=el(`cvt_bar_${status}`); if(barEl){barEl.style.width=pct+"%";barEl.style.background=barColor;}
  const pctEl=el(`cvt_pct_${status}`); if(pctEl){pctEl.textContent=pct+"%";pctEl.style.color=barColor;}
  // Update grand totals
  let gt=0,gd=0;
  JOB_STATUSES.forEach(s=>{gt+=data[s].total||0;gd+=data[s].done||0;});
  const gnd=Math.max(0,gt-gd), gpct=gt>0?Math.round(gd/gt*100):0;
  const gc=gpct>=70?"#3A6B4A":gpct>=50?"#BA7517":"#8B3A2A";
  set("cvt_grand_total",gt); set("cvt_grand_done",gd); set("cvt_grand_nd",gnd);
  const gb=el("cvt_grand_bar"); if(gb){gb.style.width=gpct+"%";gb.style.background=gc;}
  const gp=el("cvt_grand_pct"); if(gp){gp.textContent=gpct+"%";gp.style.color=gc;}
};

el("saveBtn")?.addEventListener("click", async()=>{
  const btn=el("saveBtn"), msg=el("saveMsg");
  btn.disabled=true;
  if(msg){msg.textContent="Saving…";msg.className="save-msg";}
  try{
    const saveObj={updatedAt:new Date().toISOString(),updatedBy:currentUser.email};
    JOB_STATUSES.forEach(s=>{saveObj[s]={total:data[s].total||0,done:data[s].done||0};});
    await setDoc(doc(db,"cvt_data","current"),saveObj);
    if(msg){msg.textContent=`✓ Saved — ${new Date().toLocaleString()}`;msg.className="save-msg success";}
  } catch(e){
    if(msg){msg.textContent=`Save failed: ${e.message}`;msg.className="save-msg error";}
  }
  btn.disabled=false;
  setTimeout(()=>{if(msg)msg.textContent="";},4000);
});

el("logoutBtn")?.addEventListener("click",async()=>{await signOut(auth);window.location.href="login.html";});
