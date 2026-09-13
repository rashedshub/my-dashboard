import { app } from "./firebase.js";
import { guardRole } from "./guard.js";
import { getAuth, signOut }
  from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc }
  from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const auth = getAuth(app);
const db   = getFirestore(app);

const CATEGORIES = [
  "Negligence of Work","Indecent Behaviour","Disobedience","Damage to Property",
  "Dishonesty","Theft","Verbal Abuse","Mental Abuse","Physical Harassment","Sexual Harassment",
  "Habitual Late Attendance","Continuous Absent","Habitual Absent","Giving False Information",
  "Leaving without Permission","Sleeping while on Duty","Excess Stay",
  "Improper/Non use of PPE","Fake Certification"
];

let currentUser = null;
let currentData = {};

const el  = id => document.getElementById(id);
const set = (id, v) => { const e=el(id); if(e) e.textContent=v; };
function catKey(c){ return c.toLowerCase().replace(/[^a-z0-9]+/g,"_"); }

guardRole(["admin","data_entry"]).then(({ user }) => {
  currentUser = user;
  set("topbarEmail", user.email);
  loadData();
});

async function loadData(){
  el("tableArea").innerHTML = `<div style="padding:20px;color:var(--muted)">Loading…</div>`;
  try {
    const snap = await getDoc(doc(db,"disciplinary_current","outstanding"));
    currentData = {};
    if(snap.exists()){
      const data = snap.data();
      CATEGORIES.forEach(cat => { currentData[catKey(cat)] = Number(data[catKey(cat)])||0; });
    }
    renderTable();
  } catch(e){
    el("tableArea").innerHTML = `<div style="padding:20px;color:red">Load failed: ${e.message}</div>`;
  }
}

function renderTable(){
  let total = 0;
  const rows = CATEGORIES.map((cat,i)=>{
    const k = catKey(cat);
    const v = currentData[k]||0;
    total += v;
    return `<tr>
      <td class="sl-cell">${i+1}</td>
      <td class="cat-cell">${cat}</td>
      <td><input type="number" min="0" class="disc-input" id="inp_${k}"
        value="${v||""}" placeholder="0" oninput="onInput('${k}',this.value)"/></td>
    </tr>`;
  }).join("");

  el("tableArea").innerHTML = `
    <table class="disc-table">
      <thead><tr>
        <th style="width:40px;">SL</th>
        <th>Disciplinary Category</th>
        <th style="width:160px;text-align:center;">Current Outstanding</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td colspan="2" class="total-label">Total Outstanding Cases</td>
        <td class="total-val" id="grandTotal">${total||"0"}</td>
      </tr></tfoot>
    </table>`;
}

window.onInput = function(key, val){
  currentData[key] = Number(val)||0;
  const total = CATEGORIES.reduce((s,cat)=>s+(currentData[catKey(cat)]||0),0);
  const gt = el("grandTotal"); if(gt) gt.textContent = total||"0";
};

el("saveBtn")?.addEventListener("click", async()=>{
  const btn=el("saveBtn"), msg=el("saveMsg");
  btn.disabled=true;
  if(msg){ msg.textContent="Saving…"; msg.className="save-msg"; }
  try {
    const saveObj = { updatedAt:new Date().toISOString(), updatedBy:currentUser.email };
    CATEGORIES.forEach(cat=>{ saveObj[catKey(cat)]=currentData[catKey(cat)]||0; });
    await setDoc(doc(db,"disciplinary_current","outstanding"), saveObj);
    if(msg){ msg.textContent=`✓ Saved — ${new Date().toLocaleString()}`; msg.className="save-msg success"; }
  } catch(e){
    if(msg){ msg.textContent=`Save failed: ${e.message}`; msg.className="save-msg error"; }
  }
  btn.disabled=false;
  setTimeout(()=>{ if(msg) msg.textContent=""; },5000);
});

el("logoutBtn")?.addEventListener("click",async()=>{ await signOut(auth); window.location.href="login.html"; });
