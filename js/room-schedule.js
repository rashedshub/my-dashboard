import { app } from "./firebase.js";
import {
  getFirestore, collection, getDocs, onSnapshot, addDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const db = getFirestore(app);

// ── Config ────────────────────────────────────────────────────────────────────
const SLOT_START = 8 * 60;
const SLOT_END   = 18 * 60;
const SLOT_STEP  = 30;

// ── State ─────────────────────────────────────────────────────────────────────
let rooms        = [];
let bookings     = [];
let weekOffset   = 0;
let selectedRoom = "";
let unsubBookings = null;
let activePopup  = null;

// Multi-slot selection state
let selecting    = false;  // mouse is down, dragging
let selDate      = null;   // which day column
let selDayIdx    = null;
let selStartSlot = null;   // slot index (first clicked)
let selEndSlot   = null;   // slot index (current hover)

// ── Helpers ───────────────────────────────────────────────────────────────────
const el = id => document.getElementById(id);
function fmtTime(mins) {
  const h=Math.floor(mins/60),m=mins%60,s=h>=12?"PM":"AM",hh=h%12||12;
  return `${hh}:${String(m).padStart(2,"0")} ${s}`;
}
function toHHMM(mins) {
  return `${String(Math.floor(mins/60)).padStart(2,"0")}:${String(mins%60).padStart(2,"0")}`;
}
function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function toMins(t)     { const [h,m]=t.split(":").map(Number); return h*60+m; }
function fmtDayMonth(d){ return d.toLocaleDateString("en-US",{day:"numeric",month:"short"}); }
function fmtDateLong(d){ return d.toLocaleDateString("en-US",{weekday:"short",day:"numeric",month:"short",year:"numeric"}); }

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
function closeModal()  { el("bookModal")?.classList.remove("open"); }
function removePopup() { if(activePopup){ activePopup.remove(); activePopup=null; } }

function slotMinutes(idx) { return SLOT_START + idx * SLOT_STEP; }
function allSlots() {
  const s=[]; for(let m=SLOT_START;m<SLOT_END;m+=SLOT_STEP) s.push(m); return s;
}

// ── Load rooms ────────────────────────────────────────────────────────────────
async function loadRooms() {
  try {
    const snap = await getDocs(collection(db,"training_rooms"));
    rooms = snap.docs.map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>(a.createdAt||"").localeCompare(b.createdAt||""));
    const selEl=el("roomSel"), modalSel=el("modalRoom");
    selEl.innerHTML=""; if(modalSel) modalSel.innerHTML="";
    if(!rooms.length){ selEl.innerHTML="<option>No rooms configured</option>"; return; }
    rooms.forEach((r,i)=>{
      const o=document.createElement("option");
      o.value=r.id; o.textContent=`${r.name} (cap. ${r.capacity})`;
      if(i===0){ o.selected=true; selectedRoom=r.id; }
      selEl.appendChild(o);
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
  clearSelection();
  removePopup();

  const selEl=el("roomSel"); selectedRoom=selEl?.value||"";
  const room=rooms.find(r=>r.id===selectedRoom);
  const roomName=room?room.name:"—";
  const dates=getWeekDates(weekOffset);
  const monthYearStr=dates[0].toLocaleDateString("en-US",{month:"short",year:"2-digit"}).replace(" ","-");
  const weekKeys=dates.map(dateKey);
  const roomBks=bookings.filter(b=>b.roomId===selectedRoom&&weekKeys.includes(b.date));

  const slots=allSlots();

  function getSlotInfo(dateStr,slotMins){
    for(const b of roomBks){
      if(b.date!==dateStr) continue;
      const bs=toMins(b.startTime),be=toMins(b.endTime);
      if(slotMins>=bs&&slotMins<be)
        return{booking:b,isStart:slotMins===bs,spanCount:Math.ceil((be-bs)/SLOT_STEP)};
    }
    return null;
  }

  const skip={};
  const nowMins=new Date().getHours()*60+new Date().getMinutes();
  const todayKey=dateKey(new Date());

  let html=`<table class="sched-table" id="schedTable">
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
    const isCurrent=todayKey&&slotMins<=nowMins&&nowMins<slotMins+SLOT_STEP;
    html+=`<tr class="${isCurrent?"current-time-row":""}">`;
    html+=`<td class="time-cell">${fmtTime(slotMins)}</td>`;
    dates.forEach((d,di)=>{
      const dKey=dateKey(d), cellKey=`${di}-${si}`;
      if(skip[cellKey]) return;
      const info=getSlotInfo(dKey,slotMins);
      if(info&&info.isStart){
        for(let s=1;s<info.spanCount;s++) skip[`${di}-${si+s}`]=true;
        const b=info.booking;
        html+=`<td class="booked-cell" rowspan="${info.spanCount}">
          <div class="booked-purpose">${b.title}</div>
          <div class="booked-by">👤 ${b.bookedByName||"—"}</div>
        </td>`;
      } else if(!info){
        html+=`<td class="empty-cell"
          data-date="${dKey}" data-di="${di}" data-si="${si}"
          data-start="${toHHMM(slotMins)}" data-end="${toHHMM(slotMins+SLOT_STEP)}">
          <span class="slot-hint">📅 Click to select</span>
        </td>`;
      }
    });
    html+=`</tr>`;
  });

  html+=`</tbody></table>`;
  el("scheduleWrap").innerHTML=html;
  el("scheduleWrap").querySelector(".title-main")?.setAttribute("colspan","8");

  attachCellEvents();
};

// ── Multi-slot selection ──────────────────────────────────────────────────────
function attachCellEvents() {
  const cells = el("scheduleWrap").querySelectorAll(".empty-cell");
  cells.forEach(cell=>{
    cell.addEventListener("mousedown", onCellMouseDown);
    cell.addEventListener("mouseenter", onCellMouseEnter);
    cell.addEventListener("mouseup", onCellMouseUp);
  });
  // Also end on mouseup anywhere
  document.addEventListener("mouseup", onDocMouseUp);
}

function onCellMouseDown(e) {
  e.preventDefault();
  removePopup();
  clearSelection();

  const cell=e.currentTarget;
  selDate      = cell.dataset.date;
  selDayIdx    = Number(cell.dataset.di);
  selStartSlot = Number(cell.dataset.si);
  selEndSlot   = selStartSlot;
  selecting    = true;

  highlightSelection();
}

function onCellMouseEnter(e) {
  if(!selecting) return;
  const cell=e.currentTarget;
  // Only allow selection within same column (same date)
  if(cell.dataset.date !== selDate) return;
  selEndSlot = Number(cell.dataset.si);
  highlightSelection();
}

function onCellMouseUp(e) {
  if(!selecting) return;
  selecting=false;
  document.removeEventListener("mouseup", onDocMouseUp);

  const minSlot = Math.min(selStartSlot, selEndSlot);
  const maxSlot = Math.max(selStartSlot, selEndSlot);
  const startMins = slotMinutes(minSlot);
  const endMins   = slotMinutes(maxSlot) + SLOT_STEP;

  showSelectionPopup(selDate, startMins, endMins, minSlot);
}

function onDocMouseUp() {
  if(selecting){
    selecting=false;
    document.removeEventListener("mouseup", onDocMouseUp);
    const minSlot=Math.min(selStartSlot,selEndSlot), maxSlot=Math.max(selStartSlot,selEndSlot);
    showSelectionPopup(selDate, slotMinutes(minSlot), slotMinutes(maxSlot)+SLOT_STEP, minSlot);
  }
}

function highlightSelection() {
  if(selDate===null) return;
  const cells=el("scheduleWrap").querySelectorAll(".empty-cell");
  const minSlot=Math.min(selStartSlot,selEndSlot);
  const maxSlot=Math.max(selStartSlot,selEndSlot);

  cells.forEach(cell=>{
    const di=Number(cell.dataset.di), si=Number(cell.dataset.si);
    const inSel = di===selDayIdx && si>=minSlot && si<=maxSlot;
    cell.classList.toggle("selected", inSel);
    cell.classList.toggle("sel-start", inSel && si===minSlot);
    cell.classList.toggle("sel-end",   inSel && si===maxSlot);
  });

  // Show floating label
  const startMins=slotMinutes(minSlot);
  const endMins=slotMinutes(maxSlot)+SLOT_STEP;
  const slots=(maxSlot-minSlot+1);
  const label=el("selLabel");
  if(label){
    label.innerHTML=`${fmtTime(startMins)} – ${fmtTime(endMins)} <span>(${slots} slot${slots>1?"s":""} · ${slots*30} min)</span>`;
    label.classList.add("show");
  }
}

function clearSelection() {
  selDate=null; selDayIdx=null; selStartSlot=null; selEndSlot=null; selecting=false;
  el("scheduleWrap")?.querySelectorAll(".empty-cell").forEach(c=>{
    c.classList.remove("selected","sel-start","sel-end","selecting");
  });
  el("selLabel")?.classList.remove("show");
}

// ── Slot popup ────────────────────────────────────────────────────────────────
function showSelectionPopup(date, startMins, endMins, anchorSlotIdx) {
  removePopup();
  if(!date) return;

  // Find the top selected cell to anchor the popup
  const anchorCell=el("scheduleWrap").querySelector(
    `.empty-cell[data-date="${date}"][data-si="${Math.min(selStartSlot??anchorSlotIdx,selEndSlot??anchorSlotIdx)}"]`
  );
  const rect = anchorCell ? anchorCell.getBoundingClientRect() : {bottom:200,left:400};

  const popup=document.createElement("div");
  popup.className="slot-popup";
  const top=rect.bottom+window.scrollY+8;
  const left=Math.min(rect.left+window.scrollX, window.innerWidth-250);
  popup.style.cssText=`top:${top}px;left:${left}px;`;

  const dateObj=new Date(date+"T00:00:00");
  const slotCount=(endMins-startMins)/SLOT_STEP;
  const roomName=rooms.find(r=>r.id===selectedRoom)?.name||"";

  popup.innerHTML=`
    <div class="slot-popup-head">📅 ${fmtTime(startMins)} – ${fmtTime(endMins)}</div>
    <div class="slot-popup-sub">
      ${fmtDateLong(dateObj)}<br>
      ${roomName} &nbsp;·&nbsp; ${slotCount} slot${slotCount>1?"s":""} (${slotCount*30} min)
    </div>
    <button class="slot-popup-btn" id="popupBookBtn">Book this slot</button>
    <span class="slot-popup-cancel" id="popupCancelBtn">Cancel</span>
  `;

  document.body.appendChild(popup);
  activePopup=popup;

  el("popupBookBtn").addEventListener("click", e=>{
    e.stopPropagation();
    removePopup();
    openBookModal(date, toHHMM(startMins), toHHMM(endMins));
  });
  el("popupCancelBtn").addEventListener("click", e=>{
    e.stopPropagation();
    removePopup();
    clearSelection();
  });
}

document.addEventListener("click", ()=>{ removePopup(); clearSelection(); });

// ── Booking modal ─────────────────────────────────────────────────────────────
function openBookModal(date, start, end) {
  if(el("modalDate"))   el("modalDate").value  = date;
  if(el("modalStart"))  el("modalStart").value = start;
  if(el("modalEnd"))    el("modalEnd").value   = end;
  if(el("modalTitle2")) el("modalTitle2").value= "";
  if(el("modalNotes"))  el("modalNotes").value = "";
  if(el("modalName"))   el("modalName").value  = "";
  const modalSel=el("modalRoom");
  if(modalSel&&selectedRoom) modalSel.value=selectedRoom;
  el("conflictBanner")?.classList.remove("show");
  checkConflict();
  el("bookModal")?.classList.add("open");
}

function checkConflict() {
  const roomId=el("modalRoom")?.value, date=el("modalDate")?.value,
        start=el("modalStart")?.value, end=el("modalEnd")?.value;
  if(!roomId||!date||!start||!end) return false;
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
  const name=el("modalName")?.value.trim();
  const title=el("modalTitle2")?.value.trim();
  const date=el("modalDate")?.value;
  const startTime=el("modalStart")?.value;
  const endTime=el("modalEnd")?.value;
  const notes=el("modalNotes")?.value.trim();

  if(!name)  { showToast("Please enter your name.","error"); return; }
  if(!title) { showToast("Please enter a purpose/title.","error"); return; }
  if(!date)  { showToast("Please select a date.","error"); return; }
  if(!startTime||!endTime){ showToast("Please set times.","error"); return; }
  if(toMins(endTime)<=toMins(startTime)){ showToast("End must be after start.","error"); return; }
  if(checkConflict()){ showToast("⚠️ Room already booked for that time!","error"); return; }

  btn.disabled=true; btn.classList.add("loading");
  try {
    await addDoc(collection(db,"room_bookings"),{
      roomId, title, date, startTime, endTime, notes,
      bookedBy:    "guest_"+Date.now(),
      bookedByName: name,
      bookedByEmail:"",
      createdAt:   new Date().toISOString()
    });
    closeModal();
    clearSelection();
    showToast(`✓ Booked! ${fmtTime(toMins(startTime))} – ${fmtTime(toMins(endTime))}`,"success");
  } catch(e){ showToast("Booking failed: "+e.message,"error"); }
  btn.disabled=false; btn.classList.remove("loading");
}

// ── Nav + modal buttons ───────────────────────────────────────────────────────
el("prevWeek")?.addEventListener("click",  ()=>{ weekOffset--; renderSchedule(); });
el("nextWeek")?.addEventListener("click",  ()=>{ weekOffset++; renderSchedule(); });
el("thisWeek")?.addEventListener("click",  ()=>{ weekOffset=0; renderSchedule(); });
el("roomSel")?.addEventListener("change",  ()=>renderSchedule());
el("modalClose")?.addEventListener("click",  closeModal);
el("modalCancel")?.addEventListener("click", closeModal);
el("modalSubmit")?.addEventListener("click", submitBooking);
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
