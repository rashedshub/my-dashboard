import { app } from "./firebase.js";
import {
  getFirestore, collection, getDocs, onSnapshot, query, where
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const db = getFirestore(app);

// ── Date helpers ──────────────────────────────────────────────────────────────
function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function fmtTime(t) {
  const [h,m] = t.split(":").map(Number);
  return `${h%12||12}:${String(m).padStart(2,"0")} ${h>=12?"PM":"AM"}`;
}

function fmtDateLong(d) {
  return d.toLocaleDateString("en-US",{ weekday:"long", year:"numeric", month:"long", day:"numeric" });
}

function toMins(t) { const [h,m]=t.split(":").map(Number); return h*60+m; }

function isNowActive(startTime, endTime) {
  const now = new Date();
  const cur  = now.getHours()*60 + now.getMinutes();
  return cur >= toMins(startTime) && cur < toMins(endTime);
}

// ── State ─────────────────────────────────────────────────────────────────────
let rooms    = [];
let bookings = [];
let unsubscribe = null;

// ── Init ──────────────────────────────────────────────────────────────────────
const today    = new Date();
const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate()+1);
const todayKey    = dateKey(today);
const tomorrowKey = dateKey(tomorrow);

// Header date
const headerDate = document.getElementById("headerDate");
if (headerDate) {
  headerDate.textContent = fmtDateLong(today);
}

// Load rooms first, then subscribe to bookings
async function init() {
  try {
    const snap = await getDocs(collection(db,"training_rooms"));
    rooms = snap.docs
      .map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>(a.createdAt||"").localeCompare(b.createdAt||""));
  } catch(e) {
    console.error("Rooms load error:",e);
    rooms = [];
  }
  subscribeBookings();
}

function subscribeBookings() {
  if (unsubscribe) unsubscribe();
  unsubscribe = onSnapshot(
    collection(db, "room_bookings"),
    snap => {
      bookings = snap.docs
        .map(d=>({id:d.id,...d.data()}))
        .filter(b => b.date===todayKey || b.date===tomorrowKey);
      renderSchedule();
      updateRefreshTime();
    },
    err => {
      console.error("Bookings error:",err);
      document.getElementById("scheduleArea").innerHTML =
        `<div class="loading"><div class="li">⚠️</div>Failed to load schedule. Please try again.</div>`;
    }
  );
}

// Allow manual refresh
window.loadSchedule = function() {
  document.getElementById("scheduleArea").innerHTML =
    `<div class="loading"><div class="li">📋</div>Refreshing…</div>`;
  subscribeBookings();
};

function updateRefreshTime() {
  const el = document.getElementById("lastRefresh");
  if (el) el.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderSchedule() {
  const area = document.getElementById("scheduleArea");
  if (!area) return;

  const days = [
    { key:todayKey,    label:"Today",    tag:"today",    date:today },
    { key:tomorrowKey, label:"Tomorrow", tag:"tomorrow", date:tomorrow }
  ];

  area.innerHTML = days.map(day => {
    const dayBookings = bookings.filter(b=>b.date===day.key);

    // Build per-room columns
    let roomCols = "";

    if (rooms.length === 0) {
      roomCols = `<div style="padding:24px;color:var(--muted);font-size:0.875rem;text-align:center;">No rooms configured yet.</div>`;
    } else {
      roomCols = `<div class="rooms-grid">` + rooms.map(room => {
        const roomBookings = dayBookings
          .filter(b=>b.roomId===room.id)
          .sort((a,b)=>a.startTime.localeCompare(b.startTime));

        const slots = roomBookings.length === 0
          ? `<div class="no-bookings"><div class="nb-icon">✅</div>Available all day</div>`
          : roomBookings.map(b => {
              const active = day.key===todayKey && isNowActive(b.startTime,b.endTime);
              return `
                <div class="slot">
                  <div class="slot-time">
                    ${fmtTime(b.startTime)}<br/>
                    <span style="font-weight:400;">– ${fmtTime(b.endTime)}</span>
                    ${active ? `<span class="now-chip">Now</span>` : ""}
                  </div>
                  <div class="slot-info">
                    <div class="slot-title">${b.title}</div>
                    <div class="slot-by">👤 ${b.bookedByName||b.bookedByEmail||"—"}</div>
                  </div>
                </div>`;
            }).join("");

        return `
          <div class="room-col">
            <div class="room-col-head">
              <div class="room-col-stripe" style="background:${room.color||"#888"}"></div>
              <div>
                <div class="room-col-name">${room.name}</div>
                <div class="room-col-cap">Capacity: ${room.capacity}</div>
              </div>
            </div>
            <div class="slots">${slots}</div>
          </div>`;
      }).join("") + `</div>`;
    }

    return `
      <div class="day-section">
        <div class="day-label">
          <span>${day.label}</span>
          <span class="dl-tag ${day.tag}">${day.tag==="today"?"Today":"Tomorrow"}</span>
          <span class="day-date">${fmtDateLong(day.date)}</span>
        </div>
        ${roomCols}
      </div>`;
  }).join("");
}

init();

// Auto-refresh every 60 seconds
setInterval(() => {
  updateRefreshTime();
}, 60000);
