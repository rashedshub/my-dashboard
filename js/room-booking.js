import { app } from "./firebase.js";
import { getAuth, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  getFirestore, collection, addDoc,
  deleteDoc, doc, onSnapshot, getDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const auth = getAuth(app);
const db   = getFirestore(app);

const DOW    = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];

// ── State ─────────────────────────────────────────────────────────────────────
let currentUser     = null;
let currentUserName = "";
let viewDate        = new Date();
let bookings        = [];
let rooms           = [];   // loaded from Firestore
let activeRoom      = "all";
let unsubBookings   = null;
let unsubRooms      = null;
let initialized     = false;

// ── Helpers ───────────────────────────────────────────────────────────────────
const el  = id => document.getElementById(id);
const set = (id,v) => { const n=el(id); if(n) n.textContent=v; };

function roomById(id)  { return rooms.find(r=>r.id===id); }
function toMins(t)     { const [h,m]=t.split(":").map(Number); return h*60+m; }
function fmtTime(t)    { const [h,m]=t.split(":").map(Number); return `${h%12||12}:${String(m).padStart(2,"0")} ${h>=12?"PM":"AM"}`; }
function dateKey(d)    { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function closeModal(id){ el(id)?.classList.remove("open"); }

function showToast(msg, type="success") {
  const t=el("toast"); if(!t) return;
  t.textContent=msg; t.className=`toast ${type} show`;
  clearTimeout(t._tmr); t._tmr=setTimeout(()=>t.classList.remove("show"),3500);
}

// ── Auth ──────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href="login.html"; return; }
  currentUser = user;
  set("topbarEmail", user.email);
  try {
    const snap = await getDoc(doc(db,"users",user.uid));
    currentUserName = snap.exists() ? (snap.data().name||user.email) : user.email;
  } catch(e){ currentUserName=user.email; }

  if (!initialized) { initialized=true; setupUI(); }
  subscribeRooms();
  subscribeBookings();
});

el("logoutBtn")?.addEventListener("click", async()=>{ await signOut(auth); window.location.href="login.html"; });

// ── Setup UI once ─────────────────────────────────────────────────────────────
function setupUI() {
  buildCalendarHead();
  el("prevBtn")?.addEventListener("click",  ()=>{ viewDate.setMonth(viewDate.getMonth()-1); renderCalendar(); });
  el("nextBtn")?.addEventListener("click",  ()=>{ viewDate.setMonth(viewDate.getMonth()+1); renderCalendar(); });
  el("todayBtn")?.addEventListener("click", ()=>{ viewDate=new Date(); renderCalendar(); });
  el("bookFab")?.addEventListener("click",  ()=>openBookModal(dateKey(new Date())));
  el("bookModalClose")?.addEventListener("click", ()=>closeModal("bookModal"));
  el("bookCancel")?.addEventListener("click",     ()=>closeModal("bookModal"));
  el("bookSubmit")?.addEventListener("click",     submitBooking);
  el("detailModalClose")?.addEventListener("click",()=>closeModal("detailModal"));
  ["bookModal","detailModal"].forEach(id=>{
    el(id)?.addEventListener("click", e=>{ if(e.target===el(id)) closeModal(id); });
  });
  ["bookRoom","bookDate","bookStart","bookEnd"].forEach(id=>{
    el(id)?.addEventListener("change", checkConflict);
  });
}

// ── Live rooms from Firestore ─────────────────────────────────────────────────
function subscribeRooms() {
  if (unsubRooms) unsubRooms();
  unsubRooms = onSnapshot(collection(db,"training_rooms"), snap => {
    rooms = snap.docs
      .map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>(a.createdAt||"").localeCompare(b.createdAt||""));

    if (rooms.length===0) {
      // Show "no rooms" message
      el("roomTabs") && (el("roomTabs").innerHTML=`<span style="font-size:0.8rem;color:var(--muted);">No rooms configured. Ask admin to add rooms.</span>`);
      el("bookRoom") && (el("bookRoom").innerHTML=`<option value="">No rooms available</option>`);
      el("roomLegend") && (el("roomLegend").innerHTML="");
    } else {
      buildRoomTabs();
      buildRoomSelect();
      buildLegend();
    }
    renderCalendar();
  }, err=>console.error("Rooms error:",err));
}

// ── Live bookings ─────────────────────────────────────────────────────────────
function subscribeBookings() {
  if (unsubBookings) unsubBookings();
  unsubBookings = onSnapshot(collection(db,"room_bookings"), snap=>{
    bookings=snap.docs.map(d=>({id:d.id,...d.data()}));
    renderCalendar();
  }, err=>{
    console.error("Bookings error:",err);
    showToast("Failed to load bookings: "+err.message,"error");
  });
}

// ── Room tabs ─────────────────────────────────────────────────────────────────
function buildRoomTabs() {
  const tabs=el("roomTabs"); if(!tabs) return;
  tabs.innerHTML="";

  const allBtn=document.createElement("button");
  allBtn.className="room-tab"+(activeRoom==="all"?" active":"");
  allBtn.dataset.room="all";
  allBtn.innerHTML=`<span class="room-dot" style="background:#1E3A5F"></span>All Rooms`;
  allBtn.addEventListener("click",()=>setRoomFilter("all"));
  tabs.appendChild(allBtn);

  rooms.forEach(r=>{
    const btn=document.createElement("button");
    btn.className="room-tab"+(activeRoom===r.id?" active":"");
    btn.dataset.room=r.id;
    btn.innerHTML=`<span class="room-dot" style="background:${r.color||"#888"}"></span>${r.name} <span style="font-weight:400;opacity:.6;font-size:0.72rem;">(${r.capacity})</span>`;
    btn.addEventListener("click",()=>setRoomFilter(r.id));
    tabs.appendChild(btn);
  });
}

function setRoomFilter(roomId) {
  activeRoom=roomId;
  document.querySelectorAll(".room-tab").forEach(t=>t.classList.toggle("active",t.dataset.room===roomId));
  renderCalendar();
}

function buildRoomSelect() {
  const sel=el("bookRoom"); if(!sel) return;
  const prev=sel.value;
  sel.innerHTML="";
  rooms.forEach(r=>{
    const o=document.createElement("option");
    o.value=r.id; o.textContent=`${r.name} (cap. ${r.capacity})`;
    sel.appendChild(o);
  });
  if (prev && rooms.find(r=>r.id===prev)) sel.value=prev;
}

function buildLegend() {
  const lg=el("roomLegend"); if(!lg) return;
  lg.innerHTML="";
  rooms.forEach(r=>{
    const div=document.createElement("div");
    div.className="legend-item";
    div.innerHTML=`<span class="legend-dot" style="background:${r.color||"#888"}"></span>${r.name}`;
    lg.appendChild(div);
  });
}

function buildCalendarHead() {
  const head=el("calHead"); if(!head) return;
  head.innerHTML="";
  DOW.forEach(d=>{ const div=document.createElement("div"); div.className="cal-dow"; div.textContent=d; head.appendChild(div); });
}

// ── Render calendar ───────────────────────────────────────────────────────────
function renderCalendar() {
  const grid=el("calGrid"); if(!grid) return;
  set("calMonth",`${MONTHS[viewDate.getMonth()]} ${viewDate.getFullYear()}`);
  grid.innerHTML="";

  const year=viewDate.getFullYear(), month=viewDate.getMonth();
  const firstDay=new Date(year,month,1).getDay();
  const daysInMonth=new Date(year,month+1,0).getDate();
  const daysInPrev=new Date(year,month,0).getDate();
  const todayKey=dateKey(new Date());

  const filtered=activeRoom==="all" ? bookings : bookings.filter(b=>b.roomId===activeRoom);
  const byDate={};
  filtered.forEach(b=>{ if(!byDate[b.date]) byDate[b.date]=[]; byDate[b.date].push(b); });

  // Prev month
  for(let i=firstDay-1;i>=0;i--){
    const c=document.createElement("div"); c.className="cal-cell other-month";
    c.innerHTML=`<span class="day-num">${daysInPrev-i}</span>`; grid.appendChild(c);
  }

  // Current month
  for(let d=1;d<=daysInMonth;d++){
    const key=`${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const cell=document.createElement("div");
    cell.className="cal-cell"+(key===todayKey?" today":"");
    cell.dataset.date=key;

    if(key===todayKey){
      const circle=document.createElement("div");
      circle.style.cssText="background:#1E3A5F;color:#fff;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.8rem;font-weight:700;margin-bottom:6px;";
      circle.textContent=d; cell.appendChild(circle);
    } else {
      const span=document.createElement("span"); span.className="day-num"; span.textContent=d; cell.appendChild(span);
    }

    const dayBk=(byDate[key]||[]).sort((a,b)=>a.startTime.localeCompare(b.startTime));
    dayBk.slice(0,3).forEach(b=>{
      const room=roomById(b.roomId)||{color:"#888",bg:"rgba(136,136,136,0.12)"};
      const chip=document.createElement("div"); chip.className="event-chip";
      chip.style.cssText=`background:${room.bg||"rgba(136,136,136,0.12)"};color:${room.color||"#888"};border:1px solid ${room.color||"#888"}30;`;
      chip.innerHTML=`<span class="event-dot" style="background:${room.color||"#888"}"></span>${fmtTime(b.startTime)} ${b.title}`;
      chip.addEventListener("click",e=>{e.stopPropagation();openDetail(b);});
      cell.appendChild(chip);
    });
    if(dayBk.length>3){
      const more=document.createElement("div"); more.className="more-chip";
      more.textContent=`+${dayBk.length-3} more`;
      more.addEventListener("click",e=>e.stopPropagation()); cell.appendChild(more);
    }
    cell.addEventListener("click",()=>openBookModal(key));
    grid.appendChild(cell);
  }

  // Next month
  const remaining=(7-((firstDay+daysInMonth)%7))%7;
  for(let i=1;i<=remaining;i++){
    const c=document.createElement("div"); c.className="cal-cell other-month";
    c.innerHTML=`<span class="day-num">${i}</span>`; grid.appendChild(c);
  }
}

// ── Book modal ────────────────────────────────────────────────────────────────
function openBookModal(dateStr) {
  if(rooms.length===0){ showToast("No rooms available. Contact admin.","error"); return; }
  el("bookDate").value=dateStr||dateKey(new Date());
  el("bookTitle").value=""; el("bookNotes").value="";
  el("bookStart").value="09:00"; el("bookEnd").value="10:00";
  el("conflictBanner")?.classList.remove("show");
  el("bookModal")?.classList.add("open");
}

function checkConflict(){
  const conflict=hasConflict(el("bookRoom")?.value,el("bookDate")?.value,el("bookStart")?.value,el("bookEnd")?.value);
  el("conflictBanner")?.classList.toggle("show",conflict);
  return conflict;
}

function hasConflict(roomId,date,startTime,endTime,excludeId=null){
  if(!roomId||!date||!startTime||!endTime) return false;
  const s=toMins(startTime),e=toMins(endTime); if(e<=s) return false;
  return bookings.some(b=>{
    if(b.id===excludeId||b.roomId!==roomId||b.date!==date) return false;
    return s<toMins(b.endTime)&&e>toMins(b.startTime);
  });
}

async function submitBooking(){
  const btn=el("bookSubmit");
  const roomId=el("bookRoom")?.value, title=el("bookTitle")?.value.trim(),
        date=el("bookDate")?.value, startTime=el("bookStart")?.value,
        endTime=el("bookEnd")?.value, notes=el("bookNotes")?.value.trim();

  if(!title)    { showToast("Please enter a title.","error"); return; }
  if(!date)     { showToast("Please select a date.","error"); return; }
  if(!startTime||!endTime){ showToast("Please set times.","error"); return; }
  if(toMins(endTime)<=toMins(startTime)){ showToast("End must be after start.","error"); return; }
  if(hasConflict(roomId,date,startTime,endTime)){ showToast("⚠️ Room already booked for that time!","error"); el("conflictBanner")?.classList.add("show"); return; }

  btn.disabled=true; btn.classList.add("loading");
  try {
    await addDoc(collection(db,"room_bookings"),{
      roomId,title,date,startTime,endTime,notes,
      bookedBy:currentUser.uid, bookedByName:currentUserName,
      bookedByEmail:currentUser.email, createdAt:new Date().toISOString()
    });
    closeModal("bookModal");
    showToast(`✓ Booked! ${fmtTime(startTime)} – ${fmtTime(endTime)}`,"success");
  } catch(e){ showToast("Booking failed: "+e.message,"error"); }
  btn.disabled=false; btn.classList.remove("loading");
}

// ── Detail modal ──────────────────────────────────────────────────────────────
function openDetail(booking){
  const room=roomById(booking.roomId)||{name:"Unknown",color:"#888"};
  const isOwner=booking.bookedBy===currentUser.uid;
  el("detailTitle").textContent=booking.title;
  el("detailBody").innerHTML=`
    <div class="${isOwner?"booked-by-me":"booked-by-other"}">
      ${isOwner?"✓ You booked this room":`🔒 Booked by ${booking.bookedByName||booking.bookedByEmail}`}
    </div>
    <div class="detail-row"><div class="detail-icon">🏢</div><div class="detail-info"><div class="di-label">Room</div><div class="di-val" style="color:${room.color};font-weight:700;">${room.name}</div></div></div>
    <div class="detail-row"><div class="detail-icon">📅</div><div class="detail-info"><div class="di-label">Date</div><div class="di-val">${new Date(booking.date+"T00:00:00").toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div></div></div>
    <div class="detail-row"><div class="detail-icon">⏰</div><div class="detail-info"><div class="di-label">Time</div><div class="di-val">${fmtTime(booking.startTime)} – ${fmtTime(booking.endTime)}</div></div></div>
    <div class="detail-row"><div class="detail-icon">👤</div><div class="detail-info"><div class="di-label">Booked by</div><div class="di-val">${booking.bookedByName||booking.bookedByEmail}</div></div></div>
    ${booking.notes?`<div class="detail-row"><div class="detail-icon">📝</div><div class="detail-info"><div class="di-label">Notes</div><div class="di-val">${booking.notes}</div></div></div>`:""}
  `;
  const footer=el("detailFooter"); footer.innerHTML="";
  const closeBtn=document.createElement("button");
  closeBtn.className="btn-ghost"; closeBtn.textContent="Close";
  closeBtn.addEventListener("click",()=>closeModal("detailModal")); footer.appendChild(closeBtn);
  if(isOwner){
    const delBtn=document.createElement("button");
    delBtn.className="btn-danger"; delBtn.textContent="Cancel Booking";
    delBtn.addEventListener("click",async()=>{
      if(!confirm("Cancel this booking?")) return;
      try{ await deleteDoc(doc(db,"room_bookings",booking.id)); closeModal("detailModal"); showToast("Booking cancelled.","warn"); }
      catch(e){ showToast("Failed: "+e.message,"error"); }
    }); footer.appendChild(delBtn);
  }
  el("detailModal")?.classList.add("open");
}
