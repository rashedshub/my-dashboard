import { app } from "./firebase.js";
import { guardRole } from "./guard.js";
import { getAuth, signOut }
  from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  getFirestore, collection, addDoc, getDocs, doc,
  updateDoc, deleteDoc, query, orderBy, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const auth = getAuth(app);
const db   = getFirestore(app);

let currentUser = null;
let meetings    = [];
let editingId   = null;
let agendaCount = 0;

const el  = id => document.getElementById(id);
const set = (id,v) => { const e=el(id); if(e) e.textContent=v; };

const STATUS_OPTIONS = ["Pending","In Progress","Continue","Completed","Cancelled"];

guardRole(["admin","data_entry"]).then(({ user }) => {
  currentUser = user;
  set("topbarEmail", user.email);
  subscribeMeetings();
});

// ── Subscribe ─────────────────────────────────────────────────────────────────
function subscribeMeetings(){
  const q = query(collection(db,"mom_meetings"), orderBy("date","desc"));
  onSnapshot(q, snap => {
    meetings = snap.docs.map(d=>({id:d.id,...d.data()}));
    renderList();
  }, err => console.error("MOM:",err));
}

// ── Render meeting list ───────────────────────────────────────────────────────
function renderList(){
  const wrap = el("meetingList");
  if(!meetings.length){
    wrap.innerHTML=`<div class="empty-state"><div class="ei">📋</div><p>No meetings yet. Click <strong>+ New Meeting</strong> to add one.</p></div>`;
    return;
  }
  wrap.innerHTML = meetings.map(m=>{
    const d    = m.date ? new Date(m.date+"T00:00:00").toLocaleDateString("en-US",{day:"numeric",month:"long",year:"numeric"}) : "—";
    const cnt  = (m.agenda||[]).length;
    const done = (m.agenda||[]).filter(a=>a.status==="Completed").length;
    return `<div class="meeting-item">
      <div style="flex:1;min-width:0;">
        <div class="mi-title">${m.title||"Untitled Meeting"}</div>
        <div class="mi-meta">📅 ${d} · 📍 ${m.venue||"—"} · 👤 ${m.facilitator||"—"}</div>
        <div class="mi-meta" style="margin-top:3px">👥 ${m.attendees||"—"}</div>
      </div>
      <span class="mi-badge">${done}/${cnt} done</span>
      <div class="mi-actions">
        <button class="btn-icon" onclick="viewMeeting('${m.id}')" title="View Report">👁️</button>
        <button class="btn-icon" onclick="editMeeting('${m.id}')" title="Edit">✏️</button>
        <button class="btn-icon danger" onclick="deleteMeeting('${m.id}')" title="Delete">🗑️</button>
      </div>
    </div>`;
  }).join("");
}

// ── Agenda item template ──────────────────────────────────────────────────────
function agendaTemplate(idx, data={}){
  agendaCount++;
  el("agendaCount").textContent = `${document.querySelectorAll(".agenda-item").length+1} items`;
  return `<div class="agenda-item" id="ag_${idx}">
    <div class="ai-num">Item ${idx+1} <button class="btn-remove-agenda" onclick="removeAgenda(${idx})">✕ Remove</button></div>
    <div class="field"><label>Subject</label><input type="text" id="ag_subj_${idx}" placeholder="Agenda subject" value="${data.subject||""}"/></div>
    <div class="field"><label>Discussion / Points</label><textarea id="ag_disc_${idx}" placeholder="Key discussion points, decisions made…" style="min-height:80px">${data.discussion||""}</textarea></div>
    <div class="field-row-3">
      <div class="field"><label>Responsible</label><input type="text" id="ag_resp_${idx}" placeholder="Name / Dept" value="${data.responsible||""}"/></div>
      <div class="field"><label>Timeline</label><input type="date" id="ag_time_${idx}" value="${data.timeline||""}"/></div>
      <div class="field"><label>Current Status</label>
        <select id="ag_stat_${idx}">
          ${STATUS_OPTIONS.map(s=>`<option value="${s}" ${data.status===s?"selected":""}>${s}</option>`).join("")}
        </select>
      </div>
    </div>
    <div class="field"><label>Remarks</label><input type="text" id="ag_rmk_${idx}" placeholder="Any remarks or updates" value="${data.remarks||""}"/></div>
  </div>`;
}

// ── Open modal ────────────────────────────────────────────────────────────────
function openModal(meeting=null){
  editingId   = meeting?.id || null;
  agendaCount = 0;
  el("modalTitle").textContent = meeting ? "Edit Meeting" : "New Meeting";
  el("fTitle").value       = meeting?.title       || "";
  el("fDate").value        = meeting?.date        || new Date().toISOString().slice(0,10);
  el("fVenue").value       = meeting?.venue       || "";
  el("fFacilitator").value = meeting?.facilitator || "";
  el("fAttendees").value   = meeting?.attendees   || "";

  const items = meeting?.agenda || [];
  el("agendaItems").innerHTML = items.map((a,i)=>agendaTemplate(i,a)).join("");
  el("agendaCount").textContent = `${items.length} items`;
  agendaCount = items.length;
  el("meetingModal").classList.add("open");
}
function closeModal(){ el("meetingModal").classList.remove("open"); }

window.removeAgenda = function(idx){
  const item = el(`ag_${idx}`);
  if(item) item.remove();
  // Update counts
  const items = document.querySelectorAll(".agenda-item");
  items.forEach((it,i)=>{ const n=it.querySelector(".ai-num"); if(n) n.childNodes[0].textContent=`Item ${i+1} `; });
  el("agendaCount").textContent = `${items.length} items`;
};

el("addAgendaBtn")?.addEventListener("click",()=>{
  const idx = agendaCount++;
  el("agendaItems").insertAdjacentHTML("beforeend", agendaTemplate(idx));
  el("agendaCount").textContent = `${document.querySelectorAll(".agenda-item").length} items`;
});

// ── Collect agenda ────────────────────────────────────────────────────────────
function collectAgenda(){
  const items = document.querySelectorAll(".agenda-item");
  return Array.from(items).map(it=>{
    const idx = it.id.replace("ag_","");
    return {
      subject:    el(`ag_subj_${idx}`)?.value.trim()||"",
      discussion: el(`ag_disc_${idx}`)?.value.trim()||"",
      responsible:el(`ag_resp_${idx}`)?.value.trim()||"",
      timeline:   el(`ag_time_${idx}`)?.value||"",
      status:     el(`ag_stat_${idx}`)?.value||"Pending",
      remarks:    el(`ag_rmk_${idx}`)?.value.trim()||""
    };
  }).filter(a=>a.subject);
}

// ── Save ──────────────────────────────────────────────────────────────────────
el("modalSave")?.addEventListener("click", async()=>{
  const btn = el("modalSave"); btn.disabled=true;
  const payload = {
    title:       el("fTitle").value.trim()||"Untitled Meeting",
    date:        el("fDate").value||"",
    venue:       el("fVenue").value.trim()||"",
    facilitator: el("fFacilitator").value.trim()||"",
    attendees:   el("fAttendees").value.trim()||"",
    agenda:      collectAgenda(),
    updatedAt:   new Date().toISOString(),
    updatedBy:   currentUser.email
  };
  try{
    if(editingId){
      await updateDoc(doc(db,"mom_meetings",editingId), payload);
    } else {
      payload.createdAt = new Date().toISOString();
      payload.createdBy = currentUser.email;
      await addDoc(collection(db,"mom_meetings"), payload);
    }
    closeModal();
  } catch(e){ alert("Save failed: "+e.message); }
  btn.disabled=false;
});

// ── Edit / Delete ─────────────────────────────────────────────────────────────
window.editMeeting = function(id){
  const m = meetings.find(x=>x.id===id);
  if(m) openModal(m);
};
window.deleteMeeting = async function(id){
  const m = meetings.find(x=>x.id===id);
  if(!confirm(`Delete meeting "${m?.title}"?`)) return;
  await deleteDoc(doc(db,"mom_meetings",id));
};

// ── View report ───────────────────────────────────────────────────────────────
window.viewMeeting = function(id){
  window.location.href = `mom-report.html?id=${id}`;
};

// ── Buttons ───────────────────────────────────────────────────────────────────
el("newMeetingBtn")?.addEventListener("click",()=>openModal());
el("modalClose")?.addEventListener("click", closeModal);
el("modalCancel")?.addEventListener("click", closeModal);
el("meetingModal")?.addEventListener("click",e=>{ if(e.target===el("meetingModal")) closeModal(); });
el("logoutBtn")?.addEventListener("click",async()=>{ await signOut(auth); window.location.href="login.html"; });
