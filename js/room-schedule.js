import { app } from "./firebase.js";
import { getAuth, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  getFirestore, collection, getDocs, onSnapshot, addDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const auth = getAuth(app);
const db   = getFirestore(app);

// ── Config ────────────────────────────────────────────────────────────────────
const SLOT_START = 8 * 60;
const SLOT_END   = 18 * 60;
const SLOT_STEP  = 30;

// ── State ─────────────────────────────────────────────────────────────────────
let rooms        = [];
let bookings     = [];
let weekOffset   = 0;
let selectedRoom = "";
let currentUser  = null;
let currentUserName = "";
let unsubBookings = null;

// ── Helpers ───────────────────────────────────────────────────────────────────
const el  = id => document.getElementById(id);
function fmtTime(mins) {
  const h=Math.floor(mins/60), m=mins%60, suffix=h>=12?"PM":"AM", hh=h%12||12;
  return `${hh}:${String(m).padStart(2,"0")} ${suffix}`;
}
function toHHMM(mins) { return `${String(Math.floor(mins/60)).padStart(2,"0")}:${String(mins%60).padStart(2,"0")}`; }
function dateKey(d)   { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function toMins(t)    { const [h,m]=t.split(":").map(Number); return h*60+m; }
function fmtDayMonth(d){ return d.toLocaleDateString("en-US",{day:"numeric",month:"short"}); }
function getWeekStart(offset=0) {
  const today=new Date(), day=today.getDay(), diff=(day+1)%7;
  const sat=new Date(today); sat.setDate(today.getDate()-diff+offset*7); sat.setHours(0,0,0,0);
  return sat;
}
function getWeekDates(offset=0) {
  const sat=getWeekStart(offset);
  return Array.from({length:7},(_,i)=>{ const d=new Date(sat); d.setDate(sat.getDate()+i); return d; });
}
function showToast(msg, type="success") {
  const t=el("toast"); if(!t) return;
  t.textContent=msg; t.className=`toast ${type} show`;
  clearTimeout(t._tmr); t._tmr=setTimeout(()=>t.classList.remove("show"),3500);
}
function closeModal() { el("bookModal")?.classList.remove("open"); }

// ── Auth ──────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  currentUser = user;
  if (user) {
    currentUserName = user.displayName || user.email;
    // Try get name from Firestore
    try {
      const { getDoc, doc } = await import("https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js");
      const snap = await getDoc(doc(db,"users",user.uid));
      if (snap.exists()) currentUserName = snap.data().name || user.email;
    } catch(e){}
  }
});

// ── Load rooms ────────────────────────────────────────────────────────────────
async function loadRooms() {
  try {
    const snap = await getDocs(collection(db,"training_rooms"));
    rooms = snap.docs.map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>(a.createdAt||"").localeCompare(b.createdAt||""));

    const sel = el("roomSel"); sel.innerHTML="";
    const modalSel = el("modalRoom"); if(modalSel) modalSel.innerHTML="";

    if (!rooms.length) { sel.innerHTML="<option value=''>No rooms configured</option>"; return; }

    rooms.forEach((r,i) => {
      const o=document.createElement("option");
      o.value=r.id; o.textContent=`${r.name} (cap. ${r.capacity})`;
      if(i===0){ o.selected=true; selectedRoom=r.id; }
      sel.appendChild(o);
      if(modalSel) modalSel.appendChild(o.cloneNode(true));
    });
  } catch(e){ console.error("Rooms:",e); }
}

// ── Subscribe bookings ────────────────────────────────────────────────────────
function subscribeBookings() {
  if(unsubBookings) unsubBookings();
  unsubBookings=onSnapshot(collection(db,"room_bookings"), snap=>{
    bookings=snap.docs.map(d=>({id:d.id,...d.data()}));
    renderSchedule();
  }, err=>console.error("Bookings:",err));
}

// ── Render schedule ───────────────────────────────────────────────────────────
window.renderSchedule = function() {
  const selEl=el("roomSel"); selectedRoom=selEl?.value||"";
  const room=rooms.find(r=>r.id===selectedRoom);
  const roomName=room?room.name:"—";
  const dates=getWeekDates(weekOffset);
  const monthYearStr=dates[0].toLocaleDateString("en-US",{month:"short",year:"2-digit"}).replace(" ","-");
  const weekKeys=dates.map(dateKey);
  const roomBookings=bookings.filter(b=>b.roomId===selectedRoom&&weekKeys.includes(b.date));

  const slots=[];
  for(let m=SLOT_START;m<SLOT_END;m+=SLOT_STEP) slots.push(m);

  function getSlotInfo(dateStr,slotMins){
    for(const b of roomBookings){
      if(b.date!==dateStr) continue;
      const bs=toMins(b.startTime),be=toMins(b.endTime);
      if(slotMins>=bs&&slotMins<be){
        return{booking:b,isStart:slotMins===bs,spanCount:Math.ceil((be-bs)/SLOT_STEP)};
      }
    }
    return null;
  }

  const skip={};
  const nowMins=new Date().getHours()*60+new Date().getMinutes();
  const todayKey=dateKey(new Date());

  let html=`<table class="sched-table">
    <thead>
      <tr class="title-row">
        <td colspan="8" class="title-main">Room Book Schedule &nbsp;[${roomName}]</td>
        <td class="title-date">${monthYearStr}</td>
      </tr>
      <tr class="week-row">
        <td colspan="9" style="text-align:center;font-weight:700;font-size:0.875rem;padding:5px;">
          &lt; ${weekOffset===0?"Current Week":weekOffset===-1?"Last Week":weekOffset===1?"Next Week":`Week ${weekOffset>0?"+":""}${weekOffset}`} &gt;
          &nbsp;&nbsp;<span style="font-weight:400;color:#555;">${fmtDayMonth(dates[0])} – ${fmtDayMonth(dates[6])}, ${dates[0].getFullYear()}</span>
        </td>
      </tr>
      <tr class="header-date">
        <td class="time-col" rowspan="2" style="text-align:center;vertical-align:middle;background:#D6E4F0;font-weight:700;">Time</td>
        ${dates.map(d=>`<td>${fmtDayMonth(d)}</td>`).join("")}
      </tr>
      <tr class="header-day">
        ${dates.map(d=>`<td>${d.toLocaleDateString("en-US",{weekday:"long"})}</td>`).join("")}
      </tr>
    </thead>
    <tbody>`;

  slots.forEach((slotMins,si)=>{
    const isCurrentSlot=todayKey&&slotMins<=nowMins&&nowMins<slotMins+SLOT_STEP;
    html+=`<tr class="${isCurrentSlot?"current-time-row":""}">`;
    html+=`<td class="time-cell">${fmtTime(slotMins)}</td>`;
    dates.forEach((d,di)=>{
      const dKey=dateKey(d);
      const cellKey=`${di}-${si}`;
      if(skip[cellKey]) return;
      const info=getSlotInfo(dKey,slotMins);
      if(info&&info.isStart){
        for(let span=1;span<info.spanCount;span++) skip[`${di}-${si+span}`]=true;
        const b=info.booking;
        html+=`<td class="booked-cell" rowspan="${info.spanCount}"
          title="${b.title} — ${fmtTime(toMins(b.startTime))} to ${fmtTime(toMins(b.endTime))}">
          <div class="booked-purpose">${b.title}</div>
          <div class="booked-by">👤 ${b.bookedByName||b.bookedByEmail||"—"}</div>
        </td>`;
      } else if(!info){
        // Empty cell — clickable to book
        const dStr=dKey, tStr=toHHMM(slotMins), tEndStr=toHHMM(slotMins+SLOT_STEP);
        html+=`<td class="empty-cell" data-date="${dStr}" data-start="${tStr}" data-end="${tEndStr}"></td>`;
      }
    });
    html+=`</tr>`;
  });

  html+=`</tbody></table>`;
  el("scheduleWrap").innerHTML=html;
  el("scheduleWrap").querySelector(".title-main")?.setAttribute("colspan","8");

  // Attach click listeners to empty cells
  el("scheduleWrap").querySelectorAll(".empty-cell").forEach(cell=>{
    cell.addEventListener("click",()=>{
      openBookModal(cell.dataset.date, cell.dataset.start, cell.dataset.end);
    });
  });
};

// ── Book modal ────────────────────────────────────────────────────────────────
function openBookModal(date, start, end) {
  // Set values
  if(el("modalDate"))  el("modalDate").value  = date;
  if(el("modalStart")) el("modalStart").value = start;
  if(el("modalEnd"))   el("modalEnd").value   = end;
  if(el("modalTitle2")) el("modalTitle2").value = "";
  if(el("modalNotes"))  el("modalNotes").value  = "";
  el("conflictBanner")?.classList.remove("show");

  // Sync room select to current schedule room
  const modalSel=el("modalRoom");
  if(modalSel && selectedRoom) modalSel.value=selectedRoom;

  // Check if logged in
  if (!currentUser) {
    // Show login prompt instead of form
    el("bookForm") && (el("bookForm").style.display="none");
    el("modalFooter") && (el("modalFooter").style.display="none");
    el("loginBanner") && (el("loginBanner").style.display="block");
    // Set login link to return to this page
    const loginLink=el("loginLink");
    if(loginLink) loginLink.href=`login.html?redirect=${encodeURIComponent(window.location.pathname.split('/').pop()||'room-schedule.html')}`;
    el("modalTitle") && (el("modalTitle").textContent="📅 Book Room");
  } else {
    el("bookForm") && (el("bookForm").style.display="block");
    el("modalFooter") && (el("modalFooter").style.display="flex");
    el("loginBanner") && (el("loginBanner").style.display="none");
  }

  // Check conflict
  checkConflict();

  el("bookModal")?.classList.add("open");
}

function checkConflict() {
  const roomId=el("modalRoom")?.value, date=el("modalDate")?.value,
        start=el("modalStart")?.value, end=el("modalEnd")?.value;
  if(!roomId||!date||!start||!end) return;
  const s=toMins(start), e=toMins(end);
  const conflict=bookings.some(b=>{
    if(b.roomId!==roomId||b.date!==date) return false;
    return s<toMins(b.endTime)&&e>toMins(b.startTime);
  });
  el("conflictBanner")?.classList.toggle("show", conflict);
  return conflict;
}

async function submitBooking() {
  const btn=el("modalSubmit");
  const roomId=el("modalRoom")?.value;
  const title=el("modalTitle2")?.value.trim();
  const date=el("modalDate")?.value;
  const startTime=el("modalStart")?.value;
  const endTime=el("modalEnd")?.value;
  const notes=el("modalNotes")?.value.trim();

  if(!title)   { showToast("Please enter a title.","error"); return; }
  if(!date)    { showToast("Please select a date.","error"); return; }
  if(!startTime||!endTime){ showToast("Please set times.","error"); return; }
  if(toMins(endTime)<=toMins(startTime)){ showToast("End must be after start.","error"); return; }
  if(checkConflict()){ showToast("⚠️ Room already booked for that time!","error"); return; }

  btn.disabled=true; btn.classList.add("loading");
  try {
    await addDoc(collection(db,"room_bookings"),{
      roomId, title, date, startTime, endTime, notes,
      bookedBy:currentUser.uid,
      bookedByName:currentUserName,
      bookedByEmail:currentUser.email,
      createdAt:new Date().toISOString()
    });
    closeModal();
    showToast(`✓ Booked! ${fmtTime(toMins(startTime))} – ${fmtTime(toMins(endTime))}`,"success");
  } catch(e){ showToast("Booking failed: "+e.message,"error"); }
  btn.disabled=false; btn.classList.remove("loading");
}

// ── Nav ───────────────────────────────────────────────────────────────────────
el("prevWeek")?.addEventListener("click",  ()=>{ weekOffset--; renderSchedule(); });
el("nextWeek")?.addEventListener("click",  ()=>{ weekOffset++; renderSchedule(); });
el("thisWeek")?.addEventListener("click",  ()=>{ weekOffset=0; renderSchedule(); });
el("roomSel")?.addEventListener("change",  ()=>renderSchedule());
el("modalClose")?.addEventListener("click", closeModal);
el("modalCancel")?.addEventListener("click",closeModal);
el("modalSubmit")?.addEventListener("click",submitBooking);
el("bookModal")?.addEventListener("click", e=>{ if(e.target===el("bookModal")) closeModal(); });
["modalRoom","modalDate","modalStart","modalEnd"].forEach(id=>{
  el(id)?.addEventListener("change", checkConflict);
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await loadRooms();
  subscribeBookings();
}
init();
setInterval(()=>{ if(weekOffset===0) renderSchedule(); }, 60000);
