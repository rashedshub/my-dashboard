import { app } from "./firebase.js";
import {
  getFirestore, collection, getDocs, onSnapshot, addDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const db = getFirestore(app);

const SLOT_START = 8 * 60;
const SLOT_END   = 18 * 60;
const SLOT_STEP  = 30;

let rooms        = [];
let bookings     = [];
let weekOffset   = 0;
let selectedRoom = "";
let unsubBookings = null;
let activePopup  = null;

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
function fmtDateFull(d){ return d.toLocaleDateString("en-US",{weekday:"short",day:"numeric",month:"short",year:"numeric"}); }
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
function removePopup() {
  if(activePopup){ activePopup.remove(); activePopup=null; }
  el("slotPopup") && (el("slotPopup").style.display="none");
}

// ── Load rooms ────────────────────────────────────────────────────────────────
async function loadRooms() {
  try {
    const snap = await getDocs(collection(db,"training_rooms"));
    rooms = snap.docs.map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>(a.createdAt||"").localeCompare(b.createdAt||""));
    buildRoomSelects();
  } catch(e){ console.error("Rooms:",e); }
}

function buildRoomSelects() {
  const selEl=el("roomSel"), modalSel=el("modalRoom");
  if(selEl) selEl.innerHTML="";
  if(modalSel) modalSel.innerHTML="";
  if(!rooms.length){
    if(selEl) selEl.innerHTML="<option>No rooms configured</option>";
    return;
  }
  rooms.forEach((r,i)=>{
    [selEl, modalSel].forEach(sel=>{
      if(!sel) return;
      const o=document.createElement("option");
      o.value=r.id; o.textContent=`${r.name} (cap. ${r.capacity})`;
      if(i===0) o.selected=true;
      sel.appendChild(o);
    });
    if(i===0) selectedRoom=r.id;
  });
}

// ── Subscribe bookings ─────────────────────────────────────────────────────────
function subscribeBookings() {
  if(unsubBookings) unsubBookings();
  unsubBookings=onSnapshot(collection(db,"room_bookings"), snap=>{
    bookings=snap.docs.map(d=>({id:d.id,...d.data()}));
    renderSchedule();
    renderToday();
  }, err=>console.error("Bookings:",err));
}

// ── Today summary ─────────────────────────────────────────────────────────────
function renderToday() {
  const todayKey=dateKey(new Date());
  const nowMins=new Date().getHours()*60+new Date().getMinutes();
  const labelEl=el("todayDateLabel"), gridEl=el("todayRooms");
  if(!gridEl) return;
  if(labelEl) labelEl.textContent=new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
  if(!rooms.length){ gridEl.innerHTML=`<div style="padding:16px;color:#94a3b8;font-size:0.82rem;">No rooms configured.</div>`; return; }

  // Row-per-room table layout
  const rows = rooms.map(room=>{
    const bks=bookings.filter(b=>b.roomId===room.id&&b.date===todayKey)
      .sort((a,b)=>a.startTime.localeCompare(b.startTime));
    const slotsHtml = bks.length===0
      ? `<div class="today-avail">✅ Available all day</div>`
      : `<div class="today-slots-cell">${bks.map(b=>{
          const bs=toMins(b.startTime),be=toMins(b.endTime);
          const isNow=nowMins>=bs&&nowMins<be;
          return `<div class="today-slot-chip${isNow?" chip-now":""}">
            <span class="tsc-time">${fmtTime(bs)} – ${fmtTime(be)}${isNow?'<span class="now-pill">NOW</span>':""}</span>
            <span class="tsc-title">${b.title}</span>
            <span class="tsc-by">👤 ${b.bookedByName||"—"}</span>
          </div>`;
        }).join("")}</div>`;
    return `<tr>
      <td><div class="today-room-name">
        <span class="today-room-dot" style="background:${room.color||"#1E3A5F"}"></span>
        ${room.name}
        <span style="font-size:0.68rem;color:var(--muted);font-weight:400;">(${room.capacity||"—"})</span>
      </div></td>
      <td>${slotsHtml}</td>
    </tr>`;
  }).join("");

  gridEl.innerHTML = `<table class="today-table">
    <thead><tr>
      <th style="width:200px;">Room</th>
      <th>Bookings Today</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ── Weekly schedule matrix ────────────────────────────────────────────────────
window.renderSchedule = function() {
  removePopup();
  const selEl=el("roomSel"); selectedRoom=selEl?.value||"";
  const room=rooms.find(r=>r.id===selectedRoom);
  const roomName=room?room.name:"—";
  const dates=getWeekDates(weekOffset);
  const monthYearStr=dates[0].toLocaleDateString("en-US",{month:"short",year:"2-digit"}).replace(" ","-");
  const weekKeys=dates.map(dateKey);
  const roomBks=bookings.filter(b=>b.roomId===selectedRoom&&weekKeys.includes(b.date));

  const slots=[]; for(let m=SLOT_START;m<SLOT_END;m+=SLOT_STEP) slots.push(m);

  function getSlotInfo(dStr,slotMins){
    for(const b of roomBks){
      if(b.date!==dStr) continue;
      const bs=toMins(b.startTime),be=toMins(b.endTime);
      if(slotMins>=bs&&slotMins<be)
        return{booking:b,isStart:slotMins===bs,span:Math.ceil((be-bs)/SLOT_STEP)};
    }
    return null;
  }

  const skip={};
  const nowMins=new Date().getHours()*60+new Date().getMinutes();
  const todayKey=dateKey(new Date());

  let html=`<table class="sched-table">
    <thead>
      <tr class="title-row">
        <td colspan="8">Room Booking Schedule &nbsp;[${roomName}]</td>
        <td class="title-date">${monthYearStr}</td>
      </tr>
      <tr class="week-row">
        <td colspan="9">
          &lt; ${weekOffset===0?"Current Week":weekOffset===-1?"Last Week":weekOffset===1?"Next Week":`Week ${weekOffset>0?"+":""}${weekOffset}`} &gt;
          &nbsp;&nbsp;<span style="font-weight:400;color:#555;">${fmtDayMonth(dates[0])} – ${fmtDayMonth(dates[6])}, ${dates[0].getFullYear()}</span>
        </td>
      </tr>
      <tr class="header-date">
        <td rowspan="2" style="text-align:center;vertical-align:middle;width:78px;background:#D6E4F0;font-weight:700;border:1px solid var(--border);">Time</td>
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
      const dKey=dateKey(d), ck=`${di}-${si}`;
      if(skip[ck]) return;
      const info=getSlotInfo(dKey,slotMins);
      if(info&&info.isStart){
        for(let s=1;s<info.span;s++) skip[`${di}-${si+s}`]=true;
        const b=info.booking;
        const isNow=todayKey===dKey&&nowMins>=toMins(b.startTime)&&nowMins<toMins(b.endTime);
        html+=`<td class="booked-cell${isNow?" booked-now":""}" rowspan="${info.span}">
          <div class="booked-purpose">${b.title}</div>
          <div class="booked-by">👤 ${b.bookedByName||"—"}</div>
        </td>`;
      } else if(!info){
        html+=`<td class="empty-cell" data-date="${dKey}" data-start="${toHHMM(slotMins)}" data-end="${toHHMM(slotMins+SLOT_STEP)}"></td>`;
      }
    });
    html+=`</tr>`;
  });

  html+=`</tbody></table>`;
  el("scheduleWrap").innerHTML=html;

  // Attach click to empty cells
  el("scheduleWrap").querySelectorAll(".empty-cell").forEach(cell=>{
    cell.addEventListener("click", e=>{
      e.stopPropagation();
      showSlotPopup(cell, cell.dataset.date, cell.dataset.start, cell.dataset.end);
    });
  });
};

// ── Slot popup ────────────────────────────────────────────────────────────────
function showSlotPopup(cell, date, start, end) {
  removePopup();
  const rect=cell.getBoundingClientRect();
  const top=rect.bottom+window.scrollY+8;
  const left=Math.min(rect.left+window.scrollX, window.innerWidth-250);

  const popup=document.createElement("div");
  popup.className="slot-popup";
  popup.style.cssText=`position:absolute;top:${top}px;left:${left}px;`;

  const dateObj=new Date(date+"T00:00:00");
  const room=rooms.find(r=>r.id===selectedRoom);

  popup.innerHTML=`
    <div class="popup-head">📅 ${fmtTime(toMins(start))} – ${fmtTime(toMins(end))}</div>
    <div class="popup-sub">
      ${fmtDateFull(dateObj)}<br>
      <strong>${room?.name||""}</strong>
      ${room?.capacity ? ` · Capacity: ${room.capacity}` : ""}
    </div>
    <button class="popup-btn" id="popupBook">Book this slot</button>
    <span class="popup-dismiss" id="popupDismiss">Cancel</span>
  `;

  document.body.appendChild(popup);
  activePopup=popup;

  el("popupBook").addEventListener("click", e=>{
    e.stopPropagation(); removePopup();
    openBookModal(date, start, end);
  });
  el("popupDismiss").addEventListener("click", e=>{
    e.stopPropagation(); removePopup();
  });
}

document.addEventListener("click", removePopup);

// ── Booking modal ─────────────────────────────────────────────────────────────
function openBookModal(date, start, end) {
  if(el("modalDate"))  el("modalDate").value  = date;
  if(el("modalStart")) el("modalStart").value = start;
  if(el("modalEnd"))   el("modalEnd").value   = end;
  if(el("modalTitle")) el("modalTitle").value = "";
  if(el("modalName"))  el("modalName").value  = "";
  const ms=el("modalRoom"); if(ms&&selectedRoom) ms.value=selectedRoom;
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
  const title=el("modalTitle")?.value.trim();
  const date=el("modalDate")?.value;
  const startTime=el("modalStart")?.value;
  const endTime=el("modalEnd")?.value;
  const resource=el("modalResource")?.value.trim()||"";
  const targetGroup=el("modalTarget")?.value.trim()||"";

  if(!name)  { showToast("Please enter your name.","error"); return; }
  if(!title) { showToast("Please enter a purpose/title.","error"); return; }
  if(!date)  { showToast("Please select a date.","error"); return; }
  if(!startTime||!endTime){ showToast("Please set start and end time.","error"); return; }
  if(toMins(endTime)<=toMins(startTime)){ showToast("End time must be after start.","error"); return; }
  if(checkConflict()){ showToast("⚠️ Room already booked for that time!","error"); return; }

  btn.disabled=true; btn.classList.add("loading");
  try {
    await addDoc(collection(db,"room_bookings"),{
      roomId, title, date, startTime, endTime,
      resourcePerson:resource, targetGroup,
      bookedBy:"guest_"+Date.now(),
      bookedByName:name,
      bookedByEmail:"",
      createdAt:new Date().toISOString()
    });
    closeModal();
    showToast(`✓ Booked! ${fmtTime(toMins(startTime))} – ${fmtTime(toMins(endTime))}`,"success");
  } catch(e){ showToast("Booking failed: "+e.message,"error"); }
  btn.disabled=false; btn.classList.remove("loading");
}

// ── Wire up buttons ───────────────────────────────────────────────────────────
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
setInterval(()=>{ if(weekOffset===0){ renderSchedule(); renderToday(); } }, 60000);
