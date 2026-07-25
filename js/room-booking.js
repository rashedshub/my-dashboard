import { app } from "./firebase.js";
import { getAuth, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  getFirestore, collection, addDoc,
  deleteDoc, doc, onSnapshot, getDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const auth = getAuth(app);
const db   = getFirestore(app);

// ── Rooms ─────────────────────────────────────────────────────────────────────
const ROOMS = [
  { id:"room_a", name:"Training Room A", capacity:30, color:"#2E5B88", bg:"rgba(46,91,136,0.12)" },
  { id:"room_b", name:"Training Room B", capacity:20, color:"#1B6B6B", bg:"rgba(27,107,107,0.12)" },
  { id:"room_c", name:"Conference Room", capacity:15, color:"#3A6B4A", bg:"rgba(58,107,74,0.12)" },
  { id:"room_d", name:"Seminar Hall",    capacity:60, color:"#8B6914", bg:"rgba(139,105,20,0.12)" },
];

const DOW    = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];

// ── State ─────────────────────────────────────────────────────────────────────
let currentUser     = null;
let currentUserName = "";
let viewDate        = new Date();
let bookings        = [];
let activeRoom      = "all";
let unsubscribe     = null;
let initialized     = false;

// ── Helpers ───────────────────────────────────────────────────────────────────
const el  = id => document.getElementById(id);
const set = (id, v) => { const n = el(id); if (n) n.textContent = v; };

function roomById(id)    { return ROOMS.find(r => r.id === id); }
function toMinutes(t)    { const [h,m] = t.split(":").map(Number); return h*60+m; }
function fmtTime(t)      {
  const [h,m] = t.split(":").map(Number);
  return `${h%12||12}:${String(m).padStart(2,"0")} ${h>=12?"PM":"AM"}`;
}
function dateKey(d)      {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function showToast(msg, type="success") {
  const t = el("toast"); if (!t) return;
  t.textContent = msg; t.className = `toast ${type} show`;
  clearTimeout(t._tmr); t._tmr = setTimeout(() => t.classList.remove("show"), 3500);
}

// ── Auth ──────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href = "login.html"; return; }
  currentUser = user;
  set("topbarEmail", user.email);

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    currentUserName = snap.exists() ? (snap.data().name || user.email) : user.email;
  } catch(e) { currentUserName = user.email; }

  if (!initialized) {
    initialized = true;
    setupUI();
  }
  subscribeBookings();
});

// ── Setup all UI once ─────────────────────────────────────────────────────────
function setupUI() {
  buildCalendarHead();
  buildRoomTabs();
  buildRoomSelect();
  buildLegend();

  // Nav buttons
  el("prevBtn")?.addEventListener("click",  () => { viewDate.setMonth(viewDate.getMonth()-1); renderCalendar(); });
  el("nextBtn")?.addEventListener("click",  () => { viewDate.setMonth(viewDate.getMonth()+1); renderCalendar(); });
  el("todayBtn")?.addEventListener("click", () => { viewDate = new Date(); renderCalendar(); });

  // FAB
  el("bookFab")?.addEventListener("click",  () => openBookModal(dateKey(new Date())));

  // Book modal buttons
  el("bookModalClose")?.addEventListener("click", () => closeModal("bookModal"));
  el("bookCancel")?.addEventListener("click",     () => closeModal("bookModal"));
  el("bookSubmit")?.addEventListener("click",     submitBooking);

  // Detail modal close
  el("detailModalClose")?.addEventListener("click", () => closeModal("detailModal"));

  // Close on overlay click
  ["bookModal","detailModal"].forEach(id => {
    el(id)?.addEventListener("click", e => { if (e.target === el(id)) closeModal(id); });
  });

  // Live conflict check
  ["bookRoom","bookDate","bookStart","bookEnd"].forEach(id => {
    el(id)?.addEventListener("change", checkConflict);
  });
}

function closeModal(id) { el(id)?.classList.remove("open"); }

// ── Firestore live listener ───────────────────────────────────────────────────
function subscribeBookings() {
  if (unsubscribe) unsubscribe();
  unsubscribe = onSnapshot(
    collection(db, "room_bookings"),
    snap => {
      bookings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderCalendar();
    },
    err => {
      console.error("Firestore listener error:", err);
      showToast("Failed to load bookings: " + err.message, "error");
    }
  );
}

// ── Room filter tabs ──────────────────────────────────────────────────────────
function buildRoomTabs() {
  const tabs = el("roomTabs"); if (!tabs) return;
  tabs.innerHTML = "";

  const allBtn = document.createElement("button");
  allBtn.className = "room-tab active"; allBtn.dataset.room = "all";
  allBtn.innerHTML = `<span class="room-dot" style="background:#1E3A5F"></span>All Rooms`;
  allBtn.addEventListener("click", () => setRoomFilter("all"));
  tabs.appendChild(allBtn);

  ROOMS.forEach(r => {
    const btn = document.createElement("button");
    btn.className = "room-tab"; btn.dataset.room = r.id;
    btn.innerHTML = `<span class="room-dot" style="background:${r.color}"></span>${r.name} <span style="font-weight:400;opacity:.6;font-size:0.72rem;">(${r.capacity})</span>`;
    btn.addEventListener("click", () => setRoomFilter(r.id));
    tabs.appendChild(btn);
  });
}

function setRoomFilter(roomId) {
  activeRoom = roomId;
  document.querySelectorAll(".room-tab").forEach(t => {
    t.classList.toggle("active", t.dataset.room === roomId);
  });
  renderCalendar();
}

// ── Room select in modal ──────────────────────────────────────────────────────
function buildRoomSelect() {
  const sel = el("bookRoom"); if (!sel) return;
  sel.innerHTML = "";
  ROOMS.forEach(r => {
    const o = document.createElement("option");
    o.value = r.id; o.textContent = `${r.name} (cap. ${r.capacity})`;
    sel.appendChild(o);
  });
}

// ── Legend ────────────────────────────────────────────────────────────────────
function buildLegend() {
  const lg = el("roomLegend"); if (!lg) return;
  lg.innerHTML = "";
  ROOMS.forEach(r => {
    const div = document.createElement("div");
    div.className = "legend-item";
    div.innerHTML = `<span class="legend-dot" style="background:${r.color}"></span>${r.name}`;
    lg.appendChild(div);
  });
}

// ── Calendar head (days of week) ──────────────────────────────────────────────
function buildCalendarHead() {
  const head = el("calHead"); if (!head) return;
  head.innerHTML = "";
  DOW.forEach(d => {
    const div = document.createElement("div");
    div.className = "cal-dow"; div.textContent = d;
    head.appendChild(div);
  });
}

// ── Render calendar grid ──────────────────────────────────────────────────────
function renderCalendar() {
  const grid = el("calGrid"); if (!grid) return;
  set("calMonth", `${MONTHS[viewDate.getMonth()]} ${viewDate.getFullYear()}`);
  grid.innerHTML = "";

  const year  = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay     = new Date(year, month, 1).getDay();
  const daysInMonth  = new Date(year, month+1, 0).getDate();
  const daysInPrev   = new Date(year, month, 0).getDate();
  const todayKey     = dateKey(new Date());

  // Filter by active room
  const filtered = activeRoom === "all"
    ? bookings
    : bookings.filter(b => b.roomId === activeRoom);

  // Group by date
  const byDate = {};
  filtered.forEach(b => {
    if (!byDate[b.date]) byDate[b.date] = [];
    byDate[b.date].push(b);
  });

  // Prev month trailing cells
  for (let i = firstDay - 1; i >= 0; i--) {
    const cell = document.createElement("div");
    cell.className = "cal-cell other-month";
    cell.innerHTML = `<span class="day-num">${daysInPrev - i}</span>`;
    grid.appendChild(cell);
  }

  // Current month cells
  for (let d = 1; d <= daysInMonth; d++) {
    const key  = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const cell = document.createElement("div");
    cell.className = "cal-cell" + (key === todayKey ? " today" : "");
    cell.dataset.date = key;

    // Day number
    if (key === todayKey) {
      const circle = document.createElement("div");
      circle.style.cssText = "background:#1E3A5F;color:#fff;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.8rem;font-weight:700;margin-bottom:6px;";
      circle.textContent = d;
      cell.appendChild(circle);
    } else {
      const span = document.createElement("span");
      span.className = "day-num"; span.textContent = d;
      cell.appendChild(span);
    }

    // Event chips
    const dayBookings = (byDate[key] || []).sort((a,b) => a.startTime.localeCompare(b.startTime));
    const maxShow = 3;
    dayBookings.slice(0, maxShow).forEach(b => {
      const room = roomById(b.roomId) || { color:"#888", bg:"rgba(136,136,136,0.12)" };
      const chip = document.createElement("div");
      chip.className = "event-chip";
      chip.style.cssText = `background:${room.bg};color:${room.color};border:1px solid ${room.color}30;`;
      chip.innerHTML = `<span class="event-dot" style="background:${room.color}"></span>${fmtTime(b.startTime)} ${b.title}`;
      chip.addEventListener("click", e => { e.stopPropagation(); openDetail(b); });
      cell.appendChild(chip);
    });

    if (dayBookings.length > maxShow) {
      const more = document.createElement("div");
      more.className = "more-chip";
      more.textContent = `+${dayBookings.length - maxShow} more`;
      more.addEventListener("click", e => e.stopPropagation());
      cell.appendChild(more);
    }

    // Click to open book modal with this date
    cell.addEventListener("click", () => openBookModal(key));
    grid.appendChild(cell);
  }

  // Next month leading cells
  const totalCells = firstDay + daysInMonth;
  const remaining  = (7 - (totalCells % 7)) % 7;
  for (let i = 1; i <= remaining; i++) {
    const cell = document.createElement("div");
    cell.className = "cal-cell other-month";
    cell.innerHTML = `<span class="day-num">${i}</span>`;
    grid.appendChild(cell);
  }
}

// ── Book modal ────────────────────────────────────────────────────────────────
function openBookModal(dateStr) {
  el("bookDate").value  = dateStr || dateKey(new Date());
  el("bookTitle").value = "";
  el("bookNotes").value = "";
  el("bookStart").value = "09:00";
  el("bookEnd").value   = "10:00";
  el("conflictBanner")?.classList.remove("show");
  el("bookModal")?.classList.add("open");
}

function checkConflict() {
  const conflict = hasConflict(
    el("bookRoom")?.value,
    el("bookDate")?.value,
    el("bookStart")?.value,
    el("bookEnd")?.value
  );
  el("conflictBanner")?.classList.toggle("show", conflict);
  return conflict;
}

function hasConflict(roomId, date, startTime, endTime, excludeId = null) {
  if (!roomId || !date || !startTime || !endTime) return false;
  const s = toMinutes(startTime), e = toMinutes(endTime);
  if (e <= s) return false;
  return bookings.some(b => {
    if (b.id === excludeId || b.roomId !== roomId || b.date !== date) return false;
    const bs = toMinutes(b.startTime), be = toMinutes(b.endTime);
    return s < be && e > bs;
  });
}

async function submitBooking() {
  const btn       = el("bookSubmit");
  const roomId    = el("bookRoom")?.value;
  const title     = el("bookTitle")?.value.trim();
  const date      = el("bookDate")?.value;
  const startTime = el("bookStart")?.value;
  const endTime   = el("bookEnd")?.value;
  const notes     = el("bookNotes")?.value.trim();

  if (!title)     { showToast("Please enter a title.", "error"); return; }
  if (!date)      { showToast("Please select a date.", "error"); return; }
  if (!startTime || !endTime) { showToast("Please set start and end time.", "error"); return; }
  if (toMinutes(endTime) <= toMinutes(startTime)) { showToast("End time must be after start time.", "error"); return; }
  if (hasConflict(roomId, date, startTime, endTime)) {
    showToast("⚠️ Already booked! Please choose a different time.", "error");
    el("conflictBanner")?.classList.add("show");
    return;
  }

  btn.disabled = true; btn.classList.add("loading");
  try {
    await addDoc(collection(db, "room_bookings"), {
      roomId, title, date, startTime, endTime, notes,
      bookedBy:      currentUser.uid,
      bookedByName:  currentUserName,
      bookedByEmail: currentUser.email,
      createdAt:     new Date().toISOString()
    });
    closeModal("bookModal");
    showToast(`✓ Booked! ${fmtTime(startTime)} – ${fmtTime(endTime)}`, "success");
  } catch(e) {
    showToast("Booking failed: " + e.message, "error");
  }
  btn.disabled = false; btn.classList.remove("loading");
}

// ── Detail modal ──────────────────────────────────────────────────────────────
function openDetail(booking) {
  const room    = roomById(booking.roomId) || { name:"Unknown Room", color:"#888" };
  const isOwner = booking.bookedBy === currentUser.uid;

  el("detailTitle").textContent = booking.title;
  el("detailBody").innerHTML = `
    <div class="${isOwner ? "booked-by-me" : "booked-by-other"}">
      ${isOwner ? "✓ You booked this room" : `🔒 Booked by ${booking.bookedByName || booking.bookedByEmail}`}
    </div>
    <div class="detail-row">
      <div class="detail-icon">🏢</div>
      <div class="detail-info">
        <div class="di-label">Room</div>
        <div class="di-val" style="color:${room.color};font-weight:700;">${room.name}</div>
      </div>
    </div>
    <div class="detail-row">
      <div class="detail-icon">📅</div>
      <div class="detail-info">
        <div class="di-label">Date</div>
        <div class="di-val">${new Date(booking.date+"T00:00:00").toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div>
      </div>
    </div>
    <div class="detail-row">
      <div class="detail-icon">⏰</div>
      <div class="detail-info">
        <div class="di-label">Time</div>
        <div class="di-val">${fmtTime(booking.startTime)} – ${fmtTime(booking.endTime)}</div>
      </div>
    </div>
    <div class="detail-row">
      <div class="detail-icon">👤</div>
      <div class="detail-info">
        <div class="di-label">Booked by</div>
        <div class="di-val">${booking.bookedByName || booking.bookedByEmail}</div>
      </div>
    </div>
    ${booking.notes ? `
    <div class="detail-row">
      <div class="detail-icon">📝</div>
      <div class="detail-info">
        <div class="di-label">Notes</div>
        <div class="di-val">${booking.notes}</div>
      </div>
    </div>` : ""}
  `;

  const footer = el("detailFooter");
  footer.innerHTML = "";

  const closeBtn = document.createElement("button");
  closeBtn.className = "btn-ghost"; closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", () => closeModal("detailModal"));
  footer.appendChild(closeBtn);

  if (isOwner) {
    const delBtn = document.createElement("button");
    delBtn.className = "btn-danger"; delBtn.textContent = "Cancel Booking";
    delBtn.addEventListener("click", async () => {
      if (!confirm("Cancel this booking? This cannot be undone.")) return;
      try {
        await deleteDoc(doc(db, "room_bookings", booking.id));
        closeModal("detailModal");
        showToast("Booking cancelled.", "warn");
      } catch(e) {
        showToast("Failed to cancel: " + e.message, "error");
      }
    });
    footer.appendChild(delBtn);
  }

  el("detailModal")?.classList.add("open");
}
