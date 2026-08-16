import { app } from "./firebase.js";
import {
  getFirestore, collection, getDocs, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const db = getFirestore(app);

// ── Config ────────────────────────────────────────────────────────────────────
const SLOT_START = 7 * 60;   // 7:00 AM
const SLOT_END   = 19 * 60;  // 7:00 PM
const SLOT_STEP  = 30;
const SLOT_H     = 32;       // px per slot
const DAYS       = ["Sat","Sun","Mon","Tue","Wed","Thu","Fri"];
const MONTHS_S   = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Room colour palette — assigned by index
const PALETTE = [
  { bg:"rgba(37,99,235,.12)",  border:"#2563EB", text:"#1E3A7A" },
  { bg:"rgba(5,150,105,.12)",  border:"#059669", text:"#065F46" },
  { bg:"rgba(186,117,23,.13)", border:"#BA7517", text:"#7A4E10" },
  { bg:"rgba(124,58,237,.12)", border:"#7C3AED", text:"#4C1D95" },
  { bg:"rgba(220,38,38,.11)",  border:"#DC2626", text:"#7F1D1D" },
  { bg:"rgba(20,184,166,.12)", border:"#14B8A6", text:"#0F766E" },
];

// ── State ─────────────────────────────────────────────────────────────────────
let rooms         = [];
let bookings      = [];
let weekOffset    = 0;
let activeRoom    = "all";  // filter
let unsubBookings = null;

// ── Helpers ───────────────────────────────────────────────────────────────────
const el  = id => document.getElementById(id);
function fmtTime(m){ const h=Math.floor(m/60),mn=m%60,s=h>=12?"PM":"AM",hh=h%12||12; return `${hh}:${String(mn).padStart(2,"0")} ${s}`; }
function dateKey(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function toMins(t){ const [h,m]=t.split(":").map(Number); return h*60+m; }
function fmtDayMon(d){ return `${d.getDate()} ${MONTHS_S[d.getMonth()]}`; }
function fmtDateFull(d){ return d.toLocaleDateString("en-US",{weekday:"long",day:"numeric",month:"long",year:"numeric"}); }
function getWeekStart(offset=0){
  const t=new Date(), diff=(t.getDay()+1)%7, s=new Date(t);
  s.setDate(t.getDate()-diff+offset*7); s.setHours(0,0,0,0); return s;
}
function getWeekDates(offset=0){
  const s=getWeekStart(offset);
  return Array.from({length:7},(_,i)=>{ const d=new Date(s); d.setDate(s.getDate()+i); return d; });
}
function roomColor(roomId){
  const idx = rooms.findIndex(r=>r.id===roomId);
  return PALETTE[idx % PALETTE.length] || PALETTE[0];
}
function showToast(msg){ const t=el("toast"); t.textContent=msg; t.className="toast show"; clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove("show"),3000); }
function openModal(){ el("evModal")?.classList.add("open"); }
function closeModal(){ el("evModal")?.classList.remove("open"); }

// ── Load rooms ────────────────────────────────────────────────────────────────
async function loadRooms(){
  try{
    const snap = await getDocs(collection(db,"training_rooms"));
    rooms = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.createdAt||"").localeCompare(b.createdAt||""));
    buildRoomFilters();
    buildLegend();
  } catch(e){ console.error("Rooms:",e); }
}

function buildRoomFilters(){
  const wrap = el("roomFilters"); if(!wrap) return;
  // Remove old room pills (keep All)
  wrap.querySelectorAll("[data-room]:not([data-room='all'])").forEach(p=>p.remove());

  rooms.forEach(r=>{
    const clr = roomColor(r.id);
    const pill = document.createElement("div");
    pill.className = "rf-pill";
    pill.dataset.room = r.id;
    pill.innerHTML = `<span class="rf-pip" style="background:${clr.border}"></span>${r.name}`;
    pill.addEventListener("click", ()=>setRoomFilter(r.id));
    wrap.appendChild(pill);
  });

  // All pill click
  wrap.querySelector("[data-room='all']").addEventListener("click", ()=>setRoomFilter("all"));
}

function setRoomFilter(roomId){
  activeRoom = roomId;
  document.querySelectorAll(".rf-pill").forEach(p=>{
    const isAll = p.dataset.room === "all";
    const isActive = p.dataset.room === roomId;
    p.classList.toggle("active", isActive);
    if(isAll) p.classList.toggle("all-pill", true);
    if(isActive && !isAll){
      const clr = roomColor(roomId);
      p.style.background = clr.border;
      p.style.borderColor = clr.border;
    } else if(!isActive){
      p.style.background = "";
      p.style.borderColor = "";
    }
    if(isActive && isAll){
      p.style.background = "var(--navy)";
      p.style.borderColor = "var(--navy)";
    }
  });
  renderCalendar();
}

function buildLegend(){
  const wrap = el("legend"); if(!wrap) return;
  wrap.innerHTML = rooms.map(r=>{
    const clr = roomColor(r.id);
    return `<div class="leg">
      <div class="leg-sq" style="background:${clr.bg};border-left:3px solid ${clr.border}"></div>
      ${r.name}
    </div>`;
  }).join("") + `<div class="leg" style="margin-left:auto">
    <div class="leg-sq" style="background:#FFFBEB;border:1px solid #fde68a"></div>Current time
  </div>`;
}

// ── Subscribe bookings ────────────────────────────────────────────────────────
function subscribeBookings(){
  if(unsubBookings) unsubBookings();
  unsubBookings = onSnapshot(collection(db,"room_bookings"), snap=>{
    bookings = snap.docs.map(d=>({id:d.id,...d.data()}));
    renderCalendar();
  }, err=>console.error("Bookings:",err));
}

// ── Render calendar ───────────────────────────────────────────────────────────
function renderCalendar(){
  const dates   = getWeekDates(weekOffset);
  const todayKey = dateKey(new Date());
  const nowMins  = new Date().getHours()*60+new Date().getMinutes();

  // Week label
  const wl = el("wkLabel"); if(wl) wl.textContent = `${fmtDayMon(dates[0])} – ${fmtDayMon(dates[6])} ${dates[0].getFullYear()}`;

  const weekKeys = dates.map(dateKey);

  // Filter bookings
  const visibleBks = bookings.filter(b=>{
    if(!weekKeys.includes(b.date)) return false;
    if(activeRoom !== "all" && b.roomId !== activeRoom) return false;
    return true;
  });

  // Slots
  const slots=[]; for(let m=SLOT_START;m<SLOT_END;m+=SLOT_STEP) slots.push(m);
  const cols = `72px repeat(7,1fr)`;

  // ── Head ────────────────────────────────────────────────────────────────────
  let head = `<div class="cal-head" style="grid-template-columns:${cols}">
    <div class="ch-time"></div>
    ${dates.map((d,i)=>{
      const k=dateKey(d), isToday=k===todayKey;
      return `<div class="ch-day${isToday?" is-today":""}">
        <div class="ch-day-name">${DAYS[i]}</div>
        <div class="ch-day-num">${d.getDate()}</div>
        ${isToday?'<div class="today-pip"></div>':""}
      </div>`;
    }).join("")}
  </div>`;

  // ── Body ─────────────────────────────────────────────────────────────────────
  // Pre-compute event positions for each booking
  // Event block height = span * SLOT_H - 2px padding
  const evMap = {}; // dateKey → array of {bk, topPx, heightPx, color}
  visibleBks.forEach(b=>{
    const bs = toMins(b.startTime), be = toMins(b.endTime);
    if(bs < SLOT_START || be > SLOT_END) return;
    const topPx    = ((bs - SLOT_START) / SLOT_STEP) * SLOT_H + 1;
    const heightPx = ((be - bs) / SLOT_STEP) * SLOT_H - 2;
    const clr      = roomColor(b.roomId);
    const room     = rooms.find(r=>r.id===b.roomId);
    if(!evMap[b.date]) evMap[b.date] = [];
    evMap[b.date].push({ b, topPx, heightPx, clr, room });
  });

  let body = `<div class="cal-body">`;
  slots.forEach((slotMins,si)=>{
    const isHour   = slotMins % 60 === 0;
    const isCurrent = todayKey && slotMins <= nowMins && nowMins < slotMins+SLOT_STEP;
    const timeLabel = isHour ? fmtTime(slotMins) : "";

    body += `<div class="cal-row${isHour?" is-hour":""}${isCurrent?" is-now":""}\" style="grid-template-columns:${cols}">`;
    body += `<div class="cr-time${isHour?" on-hour":""}">${timeLabel}</div>`;

    dates.forEach((d,di)=>{
      const dKey   = dateKey(d);
      const isToday = dKey===todayKey;
      // Render event blocks only on the first slot of each event (topPx managed absolutely)
      const eventsThisDay = si===0 ? (evMap[dKey]||[]) : [];
      const evHtml = eventsThisDay.map(ev=>{
        const lines = Math.floor(ev.heightPx / 14);
        return `<div class="ev-block" style="
            top:${ev.topPx}px;height:${ev.heightPx}px;
            background:${ev.clr.bg};border-left:3px solid ${ev.clr.border};
            color:${ev.clr.text};"
          onclick="showEvent('${ev.b.id}')">
          <div class="ev-title">${ev.b.title}</div>
          ${lines>=2?`<div class="ev-room">${ev.room?.name||""}</div>`:""}
          ${lines>=3?`<div class="ev-time-label">${fmtTime(toMins(ev.b.startTime))} – ${fmtTime(toMins(ev.b.endTime))}</div>`:""}
        </div>`;
      }).join("");

      body += `<div class="cr-slot${isToday?" is-today-col":""}" style="position:relative">
        ${evHtml}
      </div>`;
    });

    body += `</div>`;
  });
  body += `</div>`;

  // No bookings state
  if(visibleBks.length === 0){
    body = `<div class="state-box"><div class="si">🗓️</div>No bookings this week${activeRoom!=="all"?" for this room":""}.</div>`;
  }

  el("calArea").innerHTML = `<div class="cal-outer">${head}${body}</div>`;
}

// ── Event detail modal ────────────────────────────────────────────────────────
window.showEvent = function(bookingId){
  const b    = bookings.find(x=>x.id===bookingId); if(!b) return;
  const room = rooms.find(r=>r.id===b.roomId);
  const clr  = roomColor(b.roomId);
  const dateObj = new Date(b.date+"T00:00:00");

  el("evModalBar").style.background = clr.border;
  el("evTitle").textContent = b.title;
  el("evBody").innerHTML = `
    <div class="md-row">
      <i class="ti ti-building md-icon"></i>
      <div><div class="md-label">Room</div><div class="md-val">${room?.name||"—"} ${room?.capacity?`· Capacity ${room.capacity}`:""}</div></div>
    </div>
    <div class="md-row">
      <i class="ti ti-calendar md-icon"></i>
      <div><div class="md-label">Date</div><div class="md-val">${fmtDateFull(dateObj)}</div></div>
    </div>
    <div class="md-row">
      <i class="ti ti-clock md-icon"></i>
      <div><div class="md-label">Time</div><div class="md-val">${fmtTime(toMins(b.startTime))} – ${fmtTime(toMins(b.endTime))}</div></div>
    </div>
    <div class="md-row">
      <i class="ti ti-user md-icon"></i>
      <div><div class="md-label">Booked by</div><div class="md-val">${b.bookedByName||"—"}</div></div>
    </div>
    ${b.notes?`<div class="md-row">
      <i class="ti ti-notes md-icon"></i>
      <div><div class="md-label">Notes</div><div class="md-val">${b.notes}</div></div>
    </div>`:""}
  `;
  openModal();
};

// ── Nav ───────────────────────────────────────────────────────────────────────
el("prevWeek")?.addEventListener("click", ()=>{ weekOffset--; renderCalendar(); });
el("nextWeek")?.addEventListener("click", ()=>{ weekOffset++; renderCalendar(); });
el("thisWeek")?.addEventListener("click", ()=>{ weekOffset=0; renderCalendar(); });
el("evClose")?.addEventListener("click",  closeModal);
el("evModal")?.addEventListener("click",  e=>{ if(e.target===el("evModal")) closeModal(); });

// ── Init ──────────────────────────────────────────────────────────────────────
async function init(){
  await loadRooms();
  subscribeBookings();
}
init();
setInterval(()=>{ if(weekOffset===0) renderCalendar(); }, 60000);
