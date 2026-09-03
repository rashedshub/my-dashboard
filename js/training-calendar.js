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
function dateKeyD(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
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
  const range     = document.getElementById("dlRange")?.value || "monthly";
  const venue     = el("venueSel")?.value || "all";
  const venueName = venue==="all" ? "All Venues" : (rooms.find(r=>r.id===venue)?.name||"All Venues");
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation:"landscape", unit:"mm", format:"a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const MONTHS_FULL = ["January","February","March","April","May","June",
                       "July","August","September","October","November","December"];

  // ── Helpers ────────────────────────────────────────────────────────────────
  function dateKeyLocal(y,mo,d){ return `${y}-${String(mo+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`; }

  function drawHeader(weekTitle, dateRange) {
    // Company header
    doc.setFillColor(30,58,95);
    doc.rect(0,0,pageW,8,"F");
    doc.setTextColor(255,255,255);
    doc.setFontSize(11); doc.setFont("helvetica","bold");
    doc.text("Youngone Hi-Tech Sportswear Industries Ltd.", pageW/2, 5.5, {align:"center"});

    // Training notice title
    doc.setFillColor(255,255,255);
    doc.setTextColor(0,0,0);
    doc.setFontSize(10); doc.setFont("helvetica","bold");
    doc.text(`Training Notice of ${dateRange}`, pageW/2, 13, {align:"center"});

    // Intro line
    doc.setFontSize(8.5); doc.setFont("helvetica","normal");
    doc.setFillColor(240,242,245);
    doc.rect(8,15,pageW-16,7,"F");
    doc.text("This is to inform all concerned that management will going to arrange below training session:", pageW/2, 19.5, {align:"center"});

    // Venue line
    doc.setFontSize(8); doc.setTextColor(80,80,80);
    doc.text(`Venue: ${venueName}   |   Generated: ${new Date().toLocaleString()}`, pageW-10, 24, {align:"right"});
    doc.setTextColor(0,0,0);
  }

  function buildRows(bks) {
    // Group by day number for row-spanning
    const byDay = {};
    bks.forEach(b=>{
      const d = new Date(b.date+"T00:00:00").getDate();
      if(!byDay[d]) byDay[d]=[];
      byDay[d].push(b);
    });

    const rows = [];
    Object.keys(byDay).sort((a,b)=>Number(a)-Number(b)).forEach(dayNum=>{
      const dayBks = byDay[dayNum];
      dayBks.forEach((b,i)=>{
        const room = rooms.find(r=>r.id===b.roomId);
        const d    = new Date(b.date+"T00:00:00");
        const dayFmt = d.toLocaleDateString("en-US",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
        rows.push({
          day: i===0 ? String(dayNum) : "",
          title: b.title,
          resource: b.resourcePerson||"—",
          datetime: `${dayFmt}
${fmtTime(toMins(b.startTime))}-${fmtTime(toMins(b.endTime))}`,
          target: b.targetGroup||"—",
          venue: room?.name||"—",
          coordBy: b.bookedByName||"—",
          isFirstOfDay: i===0,
          dayCount: dayBks.length
        });
      });
    });
    return rows;
  }

  // ── MONTHLY ────────────────────────────────────────────────────────────────
  if (range === "monthly") {
    const monthName = MONTHS_FULL[viewMonth];
    const dateRange = `${monthName} 1st to ${monthName} ${new Date(viewYear,viewMonth+1,0).getDate()}th ${viewYear}`;
    drawHeader(`${monthName} ${viewYear}`, dateRange);

    const bks = bookings.filter(b=>{
      if(venue!=="all"&&b.roomId!==venue) return false;
      const [y,mo]=b.date.split("-").map(Number);
      return y===viewYear&&(mo-1)===viewMonth;
    }).sort((a,b)=>a.date.localeCompare(b.date)||a.startTime.localeCompare(b.startTime));

    if(!bks.length){
      doc.setFontSize(10); doc.text("No bookings found for this month.", pageW/2, 50, {align:"center"});
      doc.save(`Training_${monthName}_${viewYear}.pdf`); return;
    }
    renderTable(doc, bks, 27);
    doc.save(`Training_Notice_${monthName}_${viewYear}.pdf`);

  // ── WEEKLY (Sat–Thu) ───────────────────────────────────────────────────────
  } else {
    // Week start = Saturday of current calendar view month's first Saturday
    // Use viewYear/viewMonth to get the displayed week, not just today
    const today = new Date();
    const dow = today.getDay(); // 0=Sun..6=Sat
    const diffToSat = (dow + 1) % 7; // days since last Saturday
    const sat = new Date(today);
    sat.setDate(today.getDate() - diffToSat);
    sat.setHours(0,0,0,0);

    // Sat(0) Sun(1) Mon(2) Tue(3) Wed(4) Thu(5) — 6 days, skip Friday
    const weekDates = Array.from({length:6},(_,i)=>{
      const d=new Date(sat); d.setDate(sat.getDate()+i); return d;
    });
    const weekKeys = weekDates.map(d=>dateKeyD(d));

    const satFmt = sat.toLocaleDateString("en-US",{day:"numeric",month:"long",year:"numeric"});
    const thu    = weekDates[5];
    const thuFmt = thu.toLocaleDateString("en-US",{day:"numeric",month:"long",year:"numeric"});
    const dateRange = `${satFmt} to ${thuFmt}`;

    drawHeader("", dateRange);

    const bks = bookings.filter(b=>{
      if(venue!=="all"&&b.roomId!==venue) return false;
      return weekKeys.includes(b.date);
    }).sort((a,b)=>a.date.localeCompare(b.date)||a.startTime.localeCompare(b.startTime));

    if(!bks.length){
      doc.setFontSize(10); doc.text("No bookings found for this week.", pageW/2, 50, {align:"center"});
      const satStr=sat.toISOString().slice(0,10).replace(/-/g,"");
      doc.save(`Training_Notice_Week_${satStr}.pdf`); return;
    }
    renderTable(doc, bks, 27);
    const satStr=sat.toISOString().slice(0,10).replace(/-/g,"");
    doc.save(`Training_Notice_Week_${satStr}.pdf`);
  }
}

function renderTable(doc, bks, startY) {
  const venue   = el("venueSel")?.value || "all";
  const pageW   = doc.internal.pageSize.getWidth();

  // Group by day
  const byDate = {};
  bks.forEach(b=>{ if(!byDate[b.date]) byDate[b.date]=[]; byDate[b.date].push(b); });

  const body = [];
  const daySpans = []; // track which rows need day-number spanning

  let rowIdx = 0;
  Object.keys(byDate).sort().forEach(dKey=>{
    const dayBks = byDate[dKey];
    const d = new Date(dKey+"T00:00:00");
    const dayNum = d.getDate();
    const spanStart = rowIdx;

    dayBks.forEach((b,i)=>{
      const room = rooms.find(r=>r.id===b.roomId);
      const dateFmt = d.toLocaleDateString("en-US",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).replace(",","");
      body.push([
        i===0 ? String(dayNum) : "",   // Day
        b.title,                        // Training Topic
        b.resourcePerson||"—",          // Trainer/Resource
        `${dateFmt}
${fmtTime(toMins(b.startTime))}-${fmtTime(toMins(b.endTime))}`,  // Date & Time
        b.targetGroup||"—",             // Target Group
        room?.name||"—",                // Venue
        i===0 ? (b.bookedByName||"—") : ""  // Coordinated by (first row only)
      ]);
      rowIdx++;
    });

    if(dayBks.length>1) daySpans.push({start:spanStart, count:dayBks.length});
  });

  doc.autoTable({
    startY,
    head:[["Day","Training Topics","Trainer / Resource Person","Date & Time","Target Group","Venue","Coordinated by"]],
    body,
    styles:{ fontSize:8, cellPadding:2.5, valign:"middle", lineColor:[200,200,200], lineWidth:0.3 },
    headStyles:{ fillColor:[255,255,255], textColor:[0,0,0], fontStyle:"bold", halign:"center", lineWidth:0.3, lineColor:[0,0,0] },
    bodyStyles:{ textColor:[0,0,0] },
    alternateRowStyles:{ fillColor:[255,255,255] },
    columnStyles:{
      0:{ cellWidth:12, halign:"center", fontStyle:"bold" },
      1:{ cellWidth:55 },
      2:{ cellWidth:38 },
      3:{ cellWidth:40 },
      4:{ cellWidth:25 },
      5:{ cellWidth:25 },
      6:{ cellWidth:28 }
    },
    margin:{ left:8, right:8 },
    didParseCell(data) {
      // Yellow highlight for day rows (first of each day group)
      if(data.section==="body" && data.column.index===0 && data.cell.raw!=="") {
        data.cell.styles.fillColor = [255,255,0];
      }
    },
    willDrawCell(data) {
      // Thin border between different days
    }
  });
}
