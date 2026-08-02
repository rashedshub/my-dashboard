import { app } from "./firebase.js";
import { getAuth, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  getFirestore, collection, getDocs, onSnapshot, addDoc, deleteDoc, doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const auth = getAuth(app);
const db   = getFirestore(app);

const SLOT_START = 8 * 60;
const SLOT_END   = 18 * 60;
const SLOT_STEP  = 30;
const DAYS = ["Sat","Sun","Mon","Tue","Wed","Thu","Fri"];
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const COLORS = ["c-blue","c-green","c-amber","c-navy"];

let rooms        = [];
let bookings     = [];
let weekOffset   = 0;
let selectedRoom = "";
let isAdmin      = false;
let currentUser  = null;
let unsubBookings = null;
let unsubRooms    = null;
let activePopup   = null;

// ── Helpers ───────────────────────────────────────────────────────────────────
const el = id => document.getElementById(id);
function fmtTime(m){ const h=Math.floor(m/60),mn=m%60,s=h>=12?"PM":"AM",hh=h%12||12; return `${hh}:${String(mn).padStart(2,"0")} ${s}`; }
function toHHMM(m){ return `${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`; }
function dateKey(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function toMins(t){ const [h,m]=t.split(":").map(Number); return h*60+m; }
function fmtDayMon(d){ return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`; }
function fmtDateFull(d){ return d.toLocaleDateString("en-US",{weekday:"short",day:"numeric",month:"short",year:"numeric"}); }
function getWeekStart(offset=0){ const t=new Date(),diff=(t.getDay()+1)%7,s=new Date(t); s.setDate(t.getDate()-diff+offset*7); s.setHours(0,0,0,0); return s; }
function getWeekDates(offset=0){ const s=getWeekStart(offset); return Array.from({length:7},(_,i)=>{ const d=new Date(s); d.setDate(s.getDate()+i); return d; }); }

function showToast(msg,type="success"){ const t=el("toast"); t.textContent=msg; t.className=`toast ${type} show`; clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove("show"),3500); }
function openModal(){ el("modal")?.classList.add("open"); }
function closeModal(){ el("modal")?.classList.remove("open"); }
function roomColor(roomId){ const idx=rooms.findIndex(r=>r.id===roomId); return COLORS[idx%COLORS.length]||"c-blue"; }

// ── Auth ──────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  currentUser = user;
  if(user){
    try{ const s=await getDoc(doc(db,"users",user.uid)); isAdmin=s.exists()&&s.data().role==="admin"; }
    catch(e){ isAdmin=false; }
  } else { isAdmin=false; }
});

// ── Load rooms ─────────────────────────────────────────────────────────────────
function subscribeRooms(){
  if(unsubRooms) unsubRooms();
  unsubRooms=onSnapshot(collection(db,"training_rooms"), snap=>{
    rooms=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.createdAt||"").localeCompare(b.createdAt||""));
    buildRoomSelect();
    renderMatrix();
  }, err=>console.error("Rooms:",err));
}

function buildRoomSelect(){
  const sel=el("roomSel"); if(!sel) return;
  const prev=sel.value; sel.innerHTML="";
  if(!rooms.length){ sel.innerHTML="<option>No rooms configured</option>"; return; }
  rooms.forEach((r,i)=>{ const o=document.createElement("option"); o.value=r.id; o.textContent=`${r.name} (${r.capacity} pax)`; if(i===0&&!prev) selectedRoom=r.id; sel.appendChild(o); });
  if(prev&&rooms.find(r=>r.id===prev)) sel.value=prev; else selectedRoom=rooms[0]?.id||"";
}

// ── Bookings ──────────────────────────────────────────────────────────────────
function subscribeBookings(){
  if(unsubBookings) unsubBookings();
  unsubBookings=onSnapshot(collection(db,"room_bookings"), snap=>{
    bookings=snap.docs.map(d=>({id:d.id,...d.data()}));
    renderMatrix();
    renderToday();
  }, err=>console.error("Bookings:",err));
}

// ── Today cards ───────────────────────────────────────────────────────────────
function renderToday(){
  const grid=el("todayGrid"); if(!grid||!rooms.length) return;
  const todayKey=dateKey(new Date());
  const nowMins=new Date().getHours()*60+new Date().getMinutes();

  grid.innerHTML=rooms.map(room=>{
    const bks=bookings.filter(b=>b.roomId===room.id&&b.date===todayKey).sort((a,b)=>a.startTime.localeCompare(b.startTime));
    const dot=`<span class="room-pip" style="background:${room.color||"#2563EB"}"></span>`;
    const badge=bks.length>0
      ? `<span class="tc-badge badge-busy">${bks.length} booking${bks.length>1?"s":""}</span>`
      : `<span class="tc-badge badge-avail">Free today</span>`;
    const bodyHtml=bks.length===0
      ? `<div class="free-state"><i class="ti ti-circle-check" style="font-size:16px"></i>Available all day</div>`
      : bks.map(b=>{
          const bs=toMins(b.startTime),be=toMins(b.endTime);
          const isNow=nowMins>=bs&&nowMins<be;
          return `<div class="bk-row">
            <div class="bk-time-row"><i class="ti ti-clock" style="font-size:11px"></i>${fmtTime(bs)} – ${fmtTime(be)}${isNow?'<span class="now-tag">NOW</span>':""}</div>
            <div class="bk-title">${b.title}</div>
            <div class="bk-who"><i class="ti ti-user" style="font-size:10px"></i> ${b.bookedByName||"—"}</div>
          </div>`;
        }).join("");
    return `<div class="today-card">
      <div class="tc-head"><span class="room-pill">${dot}<span class="room-name">${room.name}</span></span>${badge}</div>
      <div class="tc-body">${bodyHtml}</div>
    </div>`;
  }).join("");
}

// ── Matrix ─────────────────────────────────────────────────────────────────────
window.renderMatrix = function(){
  const selEl=el("roomSel"); selectedRoom=selEl?.value||selectedRoom;
  const room=rooms.find(r=>r.id===selectedRoom);
  const dates=getWeekDates(weekOffset);
  const todayKey=dateKey(new Date());
  const nowMins=new Date().getHours()*60+new Date().getMinutes();
  const weekBks=bookings.filter(b=>b.roomId===selectedRoom&&dates.map(dateKey).includes(b.date));

  // Week label
  const wl=el("wkLabel"); if(wl) wl.textContent=`${fmtDayMon(dates[0])} – ${fmtDayMon(dates[6])} ${dates[0].getFullYear()}`;

  const slots=[]; for(let m=SLOT_START;m<SLOT_END;m+=SLOT_STEP) slots.push(m);
  const cols=`72px repeat(7,1fr)`;

  // Header
  const head=el("matrixHead"); if(!head) return;
  head.style.gridTemplateColumns=cols;
  head.innerHTML=`<div class="mh-time-cell"></div>`+
    dates.map((d,i)=>{
      const k=dateKey(d), isToday=k===todayKey;
      return `<div class="mh-day${isToday?" is-today":""}">
        <div class="mh-day-name">${DAYS[i]}</div>
        <div class="mh-day-date">${d.getDate()}</div>
        ${isToday?'<div class="today-pip"></div>':""}
      </div>`;
    }).join("");

  // Body
  const body=el("matrixBody"); if(!body) return;
  const skip=new Set();
  let html="";
  slots.forEach((slotMins,si)=>{
    const isCurrent=todayKey&&slotMins<=nowMins&&nowMins<slotMins+SLOT_STEP;
    html+=`<div class="m-row${isCurrent?" is-now":""}" style="grid-template-columns:${cols}">`;
    html+=`<div class="m-time">${fmtTime(slotMins)}</div>`;
    dates.forEach((d,di)=>{
      const dKey=dateKey(d), ck=`${di}-${si}`;
      if(skip.has(ck)){ html+=`<div style="border-right:1px solid var(--border)"></div>`; return; }
      const bk=weekBks.find(b=>b.date===dKey&&toMins(b.startTime)<=slotMins&&toMins(b.endTime)>slotMins);
      if(bk&&toMins(bk.startTime)===slotMins){
        const span=Math.ceil((toMins(bk.endTime)-toMins(bk.startTime))/SLOT_STEP);
        for(let s=1;s<span;s++) skip.add(`${di}-${si+s}`);
        const clr=roomColor(bk.roomId);
        html+=`<div class="m-slot booked" rowspan="${span}" style="min-height:${30*span}px;border-right:1px solid var(--border)" data-id="${bk.id}" onclick="openDetail('${bk.id}')">
          <div class="bk-fill ${clr}" style="min-height:${30*span}px">
            <div class="bk-fill-title">${bk.title}</div>
            <div class="bk-fill-who">${bk.bookedByName||"—"}</div>
          </div></div>`;
      } else if(!bk){
        html+=`<div class="m-slot free" data-date="${dKey}" data-start="${toHHMM(slotMins)}" data-end="${toHHMM(slotMins+SLOT_STEP)}" style="border-right:1px solid var(--border)" onclick="openBook('${dKey}','${toHHMM(slotMins)}','${toHHMM(slotMins+SLOT_STEP)}')"></div>`;
      }
    });
    html+="</div>";
  });
  body.innerHTML=html;
};

// ── Open booking modal ────────────────────────────────────────────────────────
window.openBook = function(date,start,end){
  const room=rooms.find(r=>r.id===selectedRoom);
  const dateObj=new Date(date+"T00:00:00");
  el("modalEyebrow").textContent="Book this slot";
  el("modalTime").textContent=`${fmtTime(toMins(start))} – ${fmtTime(toMins(end))}`;
  el("modalMeta").textContent=`${fmtDateFull(dateObj)} · ${room?.name||""}`;

  el("modalBody").innerHTML=`
    <div class="conflict-banner" id="conflictBanner">⚠️ This time overlaps an existing booking — please adjust.</div>
    <div class="field"><label>Room</label>
      <select id="bkRoom">${rooms.map(r=>`<option value="${r.id}"${r.id===selectedRoom?" selected":""}>${r.name} (${r.capacity} pax)</option>`).join("")}</select></div>
    <div class="field"><label>Your Name</label><input type="text" id="bkName" placeholder="Full name"/></div>
    <div class="field"><label>Purpose / Title</label><input type="text" id="bkTitle" placeholder="e.g. Team Meeting"/></div>
    <div class="field"><label>Date</label><input type="date" id="bkDate" value="${date}"/></div>
    <div class="field-row">
      <div class="field"><label>Start</label><input type="time" id="bkStart" value="${start}"/></div>
      <div class="field"><label>End</label><input type="time" id="bkEnd" value="${end}"/></div>
    </div>
    <div class="field"><label>Notes (optional)</label><input type="text" id="bkNotes" placeholder="Additional info…"/></div>`;

  el("modalFoot").innerHTML=`
    <button class="btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn-primary" id="bkSubmit" onclick="submitBook()"><span>Confirm Booking</span><span class="spin"></span></button>`;

  ["bkRoom","bkDate","bkStart","bkEnd"].forEach(id=>el(id)?.addEventListener("change",checkConflict));
  openModal();
};

function checkConflict(){
  const roomId=el("bkRoom")?.value,date=el("bkDate")?.value,start=el("bkStart")?.value,end=el("bkEnd")?.value;
  if(!roomId||!date||!start||!end) return false;
  const s=toMins(start),e=toMins(end);
  const conflict=bookings.some(b=>{ if(b.roomId!==roomId||b.date!==date) return false; return s<toMins(b.endTime)&&e>toMins(b.startTime); });
  el("conflictBanner")?.classList.toggle("show",conflict);
  return conflict;
}

window.submitBook = async function(){
  const btn=el("bkSubmit");
  const roomId=el("bkRoom")?.value, name=el("bkName")?.value.trim();
  const title=el("bkTitle")?.value.trim(), date=el("bkDate")?.value;
  const startTime=el("bkStart")?.value, endTime=el("bkEnd")?.value;
  const notes=el("bkNotes")?.value.trim();
  if(!name)  { showToast("Please enter your name.","error"); return; }
  if(!title) { showToast("Please enter a purpose.","error"); return; }
  if(!date)  { showToast("Please select a date.","error"); return; }
  if(!startTime||!endTime){ showToast("Please set times.","error"); return; }
  if(toMins(endTime)<=toMins(startTime)){ showToast("End must be after start.","error"); return; }
  if(checkConflict()){ showToast("⚠️ Room already booked for that time!","error"); return; }
  btn.disabled=true; btn.classList.add("loading");
  try{
    await addDoc(collection(db,"room_bookings"),{
      roomId,title,date,startTime,endTime,notes,
      bookedBy:"guest_"+Date.now(), bookedByName:name, bookedByEmail:"",
      createdAt:new Date().toISOString()
    });
    closeModal(); showToast(`✓ Booked! ${fmtTime(toMins(startTime))} – ${fmtTime(toMins(endTime))}`,"success");
  }catch(e){ showToast("Booking failed: "+e.message,"error"); }
  btn.disabled=false; btn.classList.remove("loading");
};

// ── Detail modal ──────────────────────────────────────────────────────────────
window.openDetail = function(bookingId){
  const b=bookings.find(x=>x.id===bookingId); if(!b) return;
  const room=rooms.find(r=>r.id===b.roomId);
  const dateObj=new Date(b.date+"T00:00:00");
  el("modalEyebrow").textContent="Booking details";
  el("modalTime").textContent=`${fmtTime(toMins(b.startTime))} – ${fmtTime(toMins(b.endTime))}`;
  el("modalMeta").textContent=`${fmtDateFull(dateObj)} · ${room?.name||""}`;
  el("modalBody").innerHTML=`
    <div class="bk-detail-card">
      <div class="bk-detail-title">${b.title}</div>
      <div class="bk-detail-who"><i class="ti ti-user" style="font-size:13px"></i>${b.bookedByName||"—"}</div>
      ${b.notes?`<div style="font-size:11px;color:var(--text2);margin-top:6px"><i class="ti ti-notes" style="font-size:12px;vertical-align:-1px"></i> ${b.notes}</div>`:""}
    </div>`;
  const foot=el("modalFoot");
  foot.innerHTML=`<button class="btn-ghost" onclick="closeModal()">Close</button>`;
  if(isAdmin){
    const delBtn=document.createElement("button");
    delBtn.className="btn-danger"; delBtn.textContent="Delete Booking";
    delBtn.onclick=async()=>{
      if(!confirm(`Delete "${b.title}"?`)) return;
      try{ await deleteDoc(doc(db,"room_bookings",bookingId)); closeModal(); showToast("Booking deleted.","warn"); }
      catch(e){ showToast("Failed: "+e.message,"error"); }
    };
    foot.appendChild(delBtn);
  }
  openModal();
};

// ── Nav ───────────────────────────────────────────────────────────────────────
el("prevWeek")?.addEventListener("click",()=>{ weekOffset--; renderMatrix(); });
el("nextWeek")?.addEventListener("click",()=>{ weekOffset++; renderMatrix(); });
el("thisWeek")?.addEventListener("click",()=>{ weekOffset=0; renderMatrix(); });
el("roomSel")?.addEventListener("change",()=>renderMatrix());
el("modalClose")?.addEventListener("click",closeModal);
el("modal")?.addEventListener("click",e=>{ if(e.target===el("modal")) closeModal(); });

// ── Init ──────────────────────────────────────────────────────────────────────
subscribeRooms();
subscribeBookings();
setInterval(()=>{ if(weekOffset===0){ renderMatrix(); renderToday(); } },60000);
