import { app } from "./firebase.js";
import {
  getFirestore, collection, getDocs, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const db = getFirestore(app);

const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];
const PALETTE = [
  { bg:"rgba(37,99,235,.11)",  border:"#2563EB", text:"#1E3A7A" },
  { bg:"rgba(5,150,105,.11)",  border:"#059669", text:"#065F46" },
  { bg:"rgba(186,117,23,.13)", border:"#BA7517", text:"#7A4E10" },
  { bg:"rgba(124,58,237,.11)", border:"#7C3AED", text:"#4C1D95" },
  { bg:"rgba(220,38,38,.10)",  border:"#DC2626", text:"#7F1D1D" },
  { bg:"rgba(20,184,166,.11)", border:"#14B8A6", text:"#0F766E" },
];

let rooms        = [];
let bookings     = [];
let viewYear     = new Date().getFullYear();
let viewMonth    = new Date().getMonth(); // 0-based
let activeVenue  = "all";
let unsubBookings = null;

// ── Helpers ───────────────────────────────────────────────────────────────────
const el = id => document.getElementById(id);
function fmtTime(t){ const [h,m]=t.split(":").map(Number),s=h>=12?"PM":"AM",hh=h%12||12; return `${hh}:${String(m).padStart(2,"0")} ${s}`; }
function dateKey(y,mo,d){ return `${y}-${String(mo+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`; }
function roomColor(roomId){ const idx=rooms.findIndex(r=>r.id===roomId); return PALETTE[idx%PALETTE.length]||PALETTE[0]; }
function toMins(t){ const [h,m]=t.split(":").map(Number); return h*60+m; }

function openModal(){ el("evModal")?.classList.add("open"); }
function closeModal(){ el("evModal")?.classList.remove("open"); }

// ── Load ──────────────────────────────────────────────────────────────────────
async function loadRooms(){
  try{
    const snap = await getDocs(collection(db,"training_rooms"));
    rooms = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.createdAt||"").localeCompare(b.createdAt||""));
    buildVenueSelect();
  } catch(e){ console.error("Rooms:",e); }
}

function buildVenueSelect(){
  const sel = el("venueSel"); if(!sel) return;
  sel.innerHTML = `<option value="all">All Venues</option>`;
  rooms.forEach(r=>{
    const o = document.createElement("option");
    o.value = r.id; o.textContent = r.name;
    sel.appendChild(o);
  });
  buildLegend();
}

function buildLegend(){
  const wrap = el("calLegend"); if(!wrap) return;
  if(!rooms.length){ wrap.innerHTML=""; return; }
  wrap.innerHTML = rooms.map(r=>{
    const clr = roomColor(r.id);
    return `<div class="leg-item">
      <div class="leg-swatch" style="background:${clr.border};border-color:${clr.border}"></div>
      ${r.name}
    </div>`;
  }).join("");
}

function subscribeBookings(){
  if(unsubBookings) unsubBookings();
  unsubBookings = onSnapshot(collection(db,"room_bookings"), snap=>{
    bookings = snap.docs.map(d=>({id:d.id,...d.data()}));
    renderCalendar();
  }, err=>console.error("Bookings:",err));
}

// ── Render ────────────────────────────────────────────────────────────────────
window.renderCalendar = function(){
  activeVenue = el("venueSel")?.value || "all";

  // Update month label
  el("calMonthLabel").textContent = `${MONTHS[viewMonth]} ${viewYear}`;

  // Build day grid
  const today = new Date();
  // Week starts Saturday: offset so Sat=col0, Sun=col1, ..., Fri=col6
  const firstDayRaw = new Date(viewYear, viewMonth, 1).getDay(); // 0=Sun..6=Sat
  const firstDay    = (firstDayRaw + 1) % 7; // Sat→0, Sun→1, ..., Fri→6
  const daysInMonth = new Date(viewYear, viewMonth+1, 0).getDate();
  const daysInPrev  = new Date(viewYear, viewMonth,   0).getDate();

  // Filter bookings for this month and venue
  const filtered = bookings.filter(b=>{
    if(activeVenue !== "all" && b.roomId !== activeVenue) return false;
    const [y,mo] = b.date.split("-").map(Number);
    return y === viewYear && (mo-1) === viewMonth;
  });

  // Group by date string
  const byDate = {};
  filtered.forEach(b=>{ if(!byDate[b.date]) byDate[b.date]=[];  byDate[b.date].push(b); });
  // Sort each day's bookings by start time
  Object.values(byDate).forEach(arr=>arr.sort((a,b)=>a.startTime.localeCompare(b.startTime)));

  let html = "";

  // Leading empty cells (prev month)
  for(let i=0; i<firstDay; i++){
    const d = daysInPrev - firstDay + i + 1;
    // col i: 0=Sat(not weekend), 1=Sun(weekend), 6=Fri(weekend)
    const lwEnd = i===1 || i===6;
    html += `<div class="day-cell out-month${lwEnd?" is-weekend":""}">
      <span class="day-num">${d}</span>
    </div>`;
  }

  // Current month days
  for(let d=1; d<=daysInMonth; d++){
    const dKey   = dateKey(viewYear, viewMonth, d);
    const dayDate = new Date(viewYear, viewMonth, d);
    const dow    = dayDate.getDay(); // 0=Sun, 6=Sat
    const isToday   = today.getFullYear()===viewYear && today.getMonth()===viewMonth && today.getDate()===d;
    const isWeekend = dow===0 || dow===5; // Sunday or Friday
    const dayBks    = byDate[dKey] || [];

    // Show ALL bookings — row height expands freely
    const chipsHtml = dayBks.map(b=>{
      const clr = roomColor(b.roomId);
      return `<div class="ev-chip" style="background:${clr.bg};border-left-color:${clr.border};color:${clr.text}"
        onclick="showEvent('${b.id}')">
        <div class="ev-chip-time">${fmtTime(b.startTime)} – ${fmtTime(b.endTime)}</div>
        <div class="ev-chip-title">${b.title}</div>
      </div>`;
    }).join("");

    const moreHtml = "";

    html += `<div class="day-cell${isToday?" is-today":""}${isWeekend?" is-weekend":""}">
      <span class="day-num">${d}</span>
      <div class="day-events">${chipsHtml}${moreHtml}</div>
    </div>`;
  }

  // Trailing empty cells
  const totalCells = firstDay + daysInMonth;
  const trailing   = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for(let i=1; i<=trailing; i++){
    const col = (firstDay + daysInMonth + i - 1) % 7;
    // col 1=Sun, col 6=Fri are weekends
    const twEnd = col===1 || col===6;
    html += `<div class="day-cell out-month${twEnd?" is-weekend":""}"><span class="day-num">${i}</span></div>`;
  }

  el("daysGrid").innerHTML = html;
};

// ── Show event detail ─────────────────────────────────────────────────────────
window.showEvent = function(bookingId){
  const b    = bookings.find(x=>x.id===bookingId); if(!b) return;
  const room = rooms.find(r=>r.id===b.roomId);
  const clr  = roomColor(b.roomId);
  const dateObj = new Date(b.date+"T00:00:00");
  const dateFmt = dateObj.toLocaleDateString("en-US",{weekday:"long",day:"numeric",month:"long",year:"numeric"});

  el("evModalBar").style.background  = clr.border;
  el("evTitle").textContent = b.title;
  el("evBody").innerHTML = `
    <div class="md-row">
      <i class="ti ti-building md-icon"></i>
      <div><div class="md-label">Venue</div><div class="md-val">${room?.name||"—"} ${room?.capacity?`(cap. ${room.capacity})`:""}</div></div>
    </div>
    <div class="md-row">
      <i class="ti ti-calendar md-icon"></i>
      <div><div class="md-label">Date</div><div class="md-val">${dateFmt}</div></div>
    </div>
    <div class="md-row">
      <i class="ti ti-clock md-icon"></i>
      <div><div class="md-label">Time</div><div class="md-val">${fmtTime(b.startTime)} – ${fmtTime(b.endTime)}</div></div>
    </div>
    <div class="md-row">
      <i class="ti ti-user md-icon"></i>
      <div><div class="md-label">Booked By</div><div class="md-val">${b.bookedByName||"—"}</div></div>
    </div>
    ${b.notes?`<div class="md-row">
      <i class="ti ti-notes md-icon"></i>
      <div><div class="md-label">Notes</div><div class="md-val">${b.notes}</div></div>
    </div>`:""}
  `;
  openModal();
};

// ── Show all events for a day ─────────────────────────────────────────────────
window.showDayEvents = function(dKey){
  const dayBks = (bookings.filter(b=>b.date===dKey&&(activeVenue==="all"||b.roomId===activeVenue)))
    .sort((a,b)=>a.startTime.localeCompare(b.startTime));
  const dateObj = new Date(dKey+"T00:00:00");
  const dateFmt = dateObj.toLocaleDateString("en-US",{weekday:"long",day:"numeric",month:"long"});

  el("evModalBar").style.background = "var(--navy)";
  el("evTitle").textContent = dateFmt;
  el("evBody").innerHTML = dayBks.map(b=>{
    const room = rooms.find(r=>r.id===b.roomId);
    const clr  = roomColor(b.roomId);
    return `<div class="day-modal-ev" onclick="showEvent('${b.id}')" style="cursor:pointer;border-left:3px solid ${clr.border};padding-left:10px;">
      <div class="dme-time">${fmtTime(b.startTime)} – ${fmtTime(b.endTime)} · ${room?.name||""}</div>
      <div class="dme-title">${b.title}</div>
      <div class="dme-by">👤 ${b.bookedByName||"—"}</div>
    </div>`;
  }).join("");
  openModal();
};

// ── Nav ───────────────────────────────────────────────────────────────────────
el("prevMonth")?.addEventListener("click",()=>{
  viewMonth--; if(viewMonth<0){ viewMonth=11; viewYear--; } renderCalendar();
});
el("nextMonth")?.addEventListener("click",()=>{
  viewMonth++; if(viewMonth>11){ viewMonth=0; viewYear++; } renderCalendar();
});
el("evClose")?.addEventListener("click", closeModal);
el("evModal")?.addEventListener("click", e=>{ if(e.target===el("evModal")) closeModal(); });

// ── Init ──────────────────────────────────────────────────────────────────────
async function init(){
  await loadRooms();
  subscribeBookings();
}
init();
setInterval(()=>renderCalendar(), 60000);

// ── PDF Download ──────────────────────────────────────────────────────────────
document.getElementById("dlPdfBtn")?.addEventListener("click", generatePDF);

function generatePDF() {
  const range   = document.getElementById("dlRange")?.value || "monthly";
  const venue   = el("venueSel")?.value || "all";
  const venueName = venue==="all" ? "All Venues" : (rooms.find(r=>r.id===venue)?.name||"All Venues");
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation:"landscape", unit:"mm", format:"a4" });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const MONTHS = ["January","February","March","April","May","June",
                  "July","August","September","October","November","December"];
  const DAYS_SAT = ["Saturday","Sunday","Monday","Tuesday","Wednesday","Thursday"];

  // Header
  function drawPageHeader(title, subtitle) {
    doc.setFillColor(30, 58, 95);
    doc.rect(0, 0, pageW, 22, "F");
    doc.setTextColor(255,255,255);
    doc.setFontSize(14); doc.setFont("helvetica","bold");
    doc.text("Training Calendar & Venue Schedule — E&C Portal", 12, 9);
    doc.setFontSize(10); doc.setFont("helvetica","normal");
    doc.text(title, 12, 16);
    doc.setTextColor(100,100,100);
    doc.setFontSize(8);
    doc.text(`Venue: ${venueName}   |   Generated: ${new Date().toLocaleString()}`, pageW-12, 16, {align:"right"});
    doc.setTextColor(0,0,0);
  }

  // ── MONTHLY ────────────────────────────────────────────────────────────────
  if (range === "monthly") {
    const title = `${MONTHS[viewMonth]} ${viewYear}`;
    drawPageHeader(title, "");

    // Filter bookings
    const bks = bookings.filter(b=>{
      if(venue!=="all"&&b.roomId!==venue) return false;
      const [y,mo]=b.date.split("-").map(Number);
      return y===viewYear&&(mo-1)===viewMonth;
    }).sort((a,b)=>a.date.localeCompare(b.date)||a.startTime.localeCompare(b.startTime));

    if(bks.length===0){
      doc.setFontSize(11); doc.text("No bookings found for this month.", 12, 40);
    } else {
      // Table
      const tableData = bks.map(b=>{
        const room = rooms.find(r=>r.id===b.roomId);
        const d = new Date(b.date+"T00:00:00");
        const day = d.toLocaleDateString("en-US",{weekday:"short",day:"numeric",month:"short"});
        return [
          day,
          `${fmtTime(toMins(b.startTime))} – ${fmtTime(toMins(b.endTime))}`,
          b.title,
          room?.name||"—",
          b.bookedByName||"—",
          b.resourcePerson||"—",
          b.targetGroup||"—"
        ];
      });

      doc.autoTable({
        startY: 26,
        head:[["Date","Time","Title / Purpose","Venue","Coord. By","Resource Person","Target Group"]],
        body: tableData,
        styles:{ fontSize:8, cellPadding:2.5 },
        headStyles:{ fillColor:[30,58,95], textColor:255, fontStyle:"bold" },
        alternateRowStyles:{ fillColor:[245,247,250] },
        columnStyles:{
          0:{cellWidth:28}, 1:{cellWidth:32}, 2:{cellWidth:55},
          3:{cellWidth:30}, 4:{cellWidth:28}, 5:{cellWidth:28}, 6:{cellWidth:28}
        },
        margin:{left:10,right:10}
      });
    }

    doc.save(`Training_Calendar_${MONTHS[viewMonth]}_${viewYear}.pdf`);

  // ── WEEKLY (Sat–Thu) ───────────────────────────────────────────────────────
  } else {
    // Get current week Sat–Thu (6 days, skip Friday)
    const today  = new Date();
    const dayOfWeek = today.getDay(); // 0=Sun..6=Sat
    const diffToSat = (dayOfWeek + 1) % 7;
    const sat = new Date(today); sat.setDate(today.getDate()-diffToSat); sat.setHours(0,0,0,0);

    // Build 6 dates: Sat Sun Mon Tue Wed Thu
    const weekDates = Array.from({length:6},(_,i)=>{ const d=new Date(sat); d.setDate(sat.getDate()+i); return d; });
    const weekKeys  = weekDates.map(dateKey);

    const satFmt = sat.toLocaleDateString("en-US",{day:"numeric",month:"short",year:"numeric"});
    const thuDate = weekDates[5];
    const thuFmt  = thuDate.toLocaleDateString("en-US",{day:"numeric",month:"short",year:"numeric"});
    const title   = `Week of ${satFmt} – ${thuFmt}`;

    drawPageHeader(title,"");

    const bks = bookings.filter(b=>{
      if(venue!=="all"&&b.roomId!==venue) return false;
      return weekKeys.includes(b.date);
    }).sort((a,b)=>a.date.localeCompare(b.date)||a.startTime.localeCompare(b.startTime));

    if(bks.length===0){
      doc.setFontSize(11); doc.text("No bookings found for this week.", 12, 40);
    } else {
      const tableData = bks.map(b=>{
        const room = rooms.find(r=>r.id===b.roomId);
        const d = new Date(b.date+"T00:00:00");
        const day = d.toLocaleDateString("en-US",{weekday:"long",day:"numeric",month:"short"});
        return [
          day,
          `${fmtTime(toMins(b.startTime))} – ${fmtTime(toMins(b.endTime))}`,
          b.title,
          room?.name||"—",
          b.bookedByName||"—",
          b.resourcePerson||"—",
          b.targetGroup||"—"
        ];
      });

      doc.autoTable({
        startY: 26,
        head:[["Day / Date","Time","Title / Purpose","Venue","Coord. By","Resource Person","Target Group"]],
        body: tableData,
        styles:{ fontSize:8, cellPadding:2.5 },
        headStyles:{ fillColor:[30,58,95], textColor:255, fontStyle:"bold" },
        alternateRowStyles:{ fillColor:[245,247,250] },
        columnStyles:{
          0:{cellWidth:30}, 1:{cellWidth:32}, 2:{cellWidth:55},
          3:{cellWidth:28}, 4:{cellWidth:28}, 5:{cellWidth:28}, 6:{cellWidth:28}
        },
        margin:{left:10,right:10}
      });
    }

    const satStr = sat.toISOString().slice(0,10).replace(/-/g,"");
    doc.save(`Training_Calendar_Week_${satStr}.pdf`);
  }
}
