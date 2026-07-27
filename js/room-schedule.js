import { app } from "./firebase.js";
import {
  getFirestore, collection, getDocs, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const db = getFirestore(app);

// ── Config ────────────────────────────────────────────────────────────────────
// 30-min slots from 8:00 AM to 6:00 PM
const SLOT_START = 8 * 60;   // 8:00 AM in minutes
const SLOT_END   = 18 * 60;  // 6:00 PM in minutes
const SLOT_STEP  = 30;       // 30-minute slots

const DAYS_OF_WEEK = ["Saturday","Sunday","Monday","Tuesday","Wednesday","Thursday","Friday"];

// ── State ─────────────────────────────────────────────────────────────────────
let rooms         = [];
let bookings      = [];
let weekOffset    = 0;   // 0 = current week, -1 = last week, etc.
let selectedRoom  = "";
let unsubBookings = null;

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtTime(mins) {
  const h = Math.floor(mins/60), m = mins%60;
  const suffix = h>=12?"PM":"AM", hh=h%12||12;
  return `${hh}:${String(m).padStart(2,"0")} ${suffix}`;
}
function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function toMins(t) { const [h,m]=t.split(":").map(Number); return h*60+m; }
function fmtMonthYear(d) { return d.toLocaleDateString("en-US",{month:"short",year:"2-digit"}); }
function fmtDayMonth(d)  { return d.toLocaleDateString("en-US",{day:"numeric",month:"short"}); }

// Get the Saturday of the current week (week starts Saturday)
function getWeekStart(offset=0) {
  const today = new Date();
  const day   = today.getDay(); // 0=Sun,1=Mon,...,6=Sat
  // Days since last Saturday: if today is Sat(6), diff=0; Sun(0), diff=1; Mon(1), diff=2...
  const diff  = (day + 1) % 7;
  const sat   = new Date(today);
  sat.setDate(today.getDate() - diff + offset*7);
  sat.setHours(0,0,0,0);
  return sat;
}

function getWeekDates(offset=0) {
  const sat = getWeekStart(offset);
  return Array.from({length:7}, (_,i) => {
    const d = new Date(sat);
    d.setDate(sat.getDate()+i);
    return d;
  });
}

function showToast(msg) {
  const t=document.getElementById("toast"); if(!t) return;
  t.textContent=msg; t.className="toast show";
  clearTimeout(t._tmr); t._tmr=setTimeout(()=>t.classList.remove("show"),3000);
}

// ── Load rooms ────────────────────────────────────────────────────────────────
async function loadRooms() {
  try {
    const snap = await getDocs(collection(db,"training_rooms"));
    rooms = snap.docs.map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>(a.createdAt||"").localeCompare(b.createdAt||""));

    const sel = document.getElementById("roomSel");
    sel.innerHTML = "";
    if (rooms.length === 0) {
      sel.innerHTML = "<option value=''>No rooms configured</option>";
      return;
    }
    rooms.forEach((r,i) => {
      const o = document.createElement("option");
      o.value = r.id; o.textContent = `${r.name} (cap. ${r.capacity})`;
      if (i===0) { o.selected=true; selectedRoom=r.id; }
      sel.appendChild(o);
    });
  } catch(e) {
    console.error("Rooms load error:",e);
  }
}

// ── Subscribe to bookings ─────────────────────────────────────────────────────
function subscribeBookings() {
  if (unsubBookings) unsubBookings();
  unsubBookings = onSnapshot(
    collection(db,"room_bookings"),
    snap => {
      bookings = snap.docs.map(d=>({id:d.id,...d.data()}));
      renderSchedule();
    },
    err => console.error("Bookings error:",err)
  );
}

// ── Render schedule ───────────────────────────────────────────────────────────
window.renderSchedule = function() {
  const sel = document.getElementById("roomSel");
  selectedRoom = sel?.value || "";

  const room     = rooms.find(r=>r.id===selectedRoom);
  const roomName = room ? room.name : "—";
  const dates    = getWeekDates(weekOffset);
  const weekSat  = dates[0];

  // Month-Year label (e.g. "Jul-26")
  const monthYearStr = weekSat.toLocaleDateString("en-US",{month:"short",year:"2-digit"}).replace(" ","-");

  // Filter bookings for this room and this week
  const weekKeys = dates.map(dateKey);
  const roomBookings = bookings.filter(b =>
    b.roomId === selectedRoom && weekKeys.includes(b.date)
  );

  // Build slot times array
  const slots = [];
  for (let m = SLOT_START; m < SLOT_END; m += SLOT_STEP) slots.push(m);

  // For each day-slot, find a booking that covers it
  // Returns { booking, isStart, spanCount } or null
  function getSlotInfo(dateStr, slotMins) {
    for (const b of roomBookings) {
      if (b.date !== dateStr) continue;
      const bs = toMins(b.startTime), be = toMins(b.endTime);
      if (slotMins >= bs && slotMins < be) {
        const isStart  = slotMins === bs;
        const spanCount = Math.ceil((be - bs) / SLOT_STEP);
        return { booking:b, isStart, spanCount };
      }
    }
    return null;
  }

  // Track which cells to skip (already spanned)
  const skip = {}; // key: `${dayIdx}-${slotIdx}` = true

  // Current time for highlighting
  const nowMins = new Date().getHours()*60 + new Date().getMinutes();
  const todayKey = dateKey(new Date());

  // ── Build table HTML ──────────────────────────────────────────────────────
  let html = `
  <table class="sched-table">
    <thead>
      <!-- Title row -->
      <tr class="title-row">
        <td colspan="8" class="title-main">Room Book Schedule &nbsp;[${roomName}]</td>
        <td class="title-date">${monthYearStr}</td>
      </tr>
      <!-- Week label row -->
      <tr class="week-row">
        <td colspan="9" style="text-align:center;font-weight:700;font-size:0.875rem;padding:5px;">
          &lt; ${weekOffset===0?"Current Week": weekOffset===-1?"Last Week":weekOffset===1?"Next Week":`Week ${weekOffset>0?"+":""}${weekOffset}`} &gt;
          &nbsp;&nbsp;
          <span style="font-weight:400;color:#555;">${fmtDayMonth(dates[0])} – ${fmtDayMonth(dates[6])}, ${dates[0].getFullYear()}</span>
        </td>
      </tr>
      <!-- Date header row -->
      <tr class="header-date">
        <td class="time-col" rowspan="2" style="text-align:center;vertical-align:middle;background:#D6E4F0;font-weight:700;">Time</td>
        ${dates.map(d=>`<td>${fmtDayMonth(d)}</td>`).join("")}
      </tr>
      <!-- Day name header row -->
      <tr class="header-day">
        ${dates.map(d=>`<td>${d.toLocaleDateString("en-US",{weekday:"long"})}</td>`).join("")}
      </tr>
    </thead>
    <tbody>`;

  slots.forEach((slotMins, si) => {
    const isCurrentSlot = todayKey && slotMins <= nowMins && nowMins < slotMins+SLOT_STEP;
    html += `<tr class="${isCurrentSlot?"current-time-row":""}">`;
    html += `<td class="time-cell">${fmtTime(slotMins)}</td>`;

    dates.forEach((d, di) => {
      const dKey = dateKey(d);
      const cellKey = `${di}-${si}`;
      if (skip[cellKey]) return; // already covered by rowspan

      const info = getSlotInfo(dKey, slotMins);
      if (info && info.isStart) {
        // Mark future cells to skip
        for (let span=1; span<info.spanCount; span++) {
          skip[`${di}-${si+span}`] = true;
        }
        const b = info.booking;
        html += `<td class="booked-cell" rowspan="${info.spanCount}" title="${b.title} — ${fmtTime(toMins(b.startTime))} to ${fmtTime(toMins(b.endTime))}">
          <div class="booked-purpose">${b.title}</div>
          <div class="booked-by">👤 ${b.bookedByName||b.bookedByEmail||"—"}</div>
        </td>`;
      } else if (!info) {
        html += `<td class="empty-cell${isCurrentSlot?" current-time-row":""}"></td>`;
      }
    });

    html += `</tr>`;
  });

  html += `</tbody></table>`;

  // Fix title colspan
  // Total cols = 1 (time) + 7 (days) = 8, title spans 8, date cell is 9th
  document.getElementById("scheduleWrap").innerHTML = html;

  // Fix: title row first td colspan should be 8
  const titleTd = document.querySelector(".title-main");
  if (titleTd) titleTd.setAttribute("colspan","8");
};

// ── Navigation ────────────────────────────────────────────────────────────────
document.getElementById("prevWeek").addEventListener("click",  ()=>{ weekOffset--; renderSchedule(); });
document.getElementById("nextWeek").addEventListener("click",  ()=>{ weekOffset++; renderSchedule(); });
document.getElementById("thisWeek").addEventListener("click",  ()=>{ weekOffset=0; renderSchedule(); });

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await loadRooms();
  subscribeBookings(); // triggers renderSchedule on first snapshot
}

init();

// Auto-refresh current-time highlight every minute
setInterval(() => { if (weekOffset===0) renderSchedule(); }, 60000);
