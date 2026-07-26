import { app } from "./firebase.js";
import { getAuth, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  getFirestore, collection, addDoc, getDocs,
  doc, getDoc, setDoc, deleteDoc, onSnapshot, orderBy, query
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const auth = getAuth(app);
const db   = getFirestore(app);

const COLORS = [
  "#1E3A5F","#2E5B88","#1B6B6B","#3A6B4A",
  "#8B6914","#8B3A2A","#5C1A0F","#3A1B6B",
  "#6B3A1B","#1B5B5B","#4A6B1B","#6B1B4A"
];

const el  = id => document.getElementById(id);
const set = (id,v) => { const n=el(id); if(n) n.textContent=v; };

function showToast(msg, type="success") {
  const t=el("toast"); if(!t) return;
  t.textContent=msg; t.className=`toast ${type} show`;
  clearTimeout(t._tmr); t._tmr=setTimeout(()=>t.classList.remove("show"),3500);
}

// ── Auth guard — admin only ───────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href="login.html"; return; }
  const snap = await getDoc(doc(db,"users",user.uid));
  if (!snap.exists() || snap.data().role !== "admin") {
    window.location.href="dashboard.html"; return;
  }
  set("topbarEmail", user.email);
  buildColorPicker();
  subscribeRooms();
});

el("logoutBtn")?.addEventListener("click", async () => {
  await signOut(auth); window.location.href="login.html";
});

// ── Color picker ──────────────────────────────────────────────────────────────
function buildColorPicker() {
  const row = el("colorRow"); if (!row) return;
  row.innerHTML = "";
  COLORS.forEach(c => {
    const sw = document.createElement("div");
    sw.className = "color-swatch" + (c === el("roomColor").value ? " selected" : "");
    sw.style.background = c;
    sw.dataset.color = c;
    sw.addEventListener("click", () => selectColor(c));
    row.appendChild(sw);
  });
}

function selectColor(c) {
  el("roomColor").value = c;
  document.querySelectorAll(".color-swatch").forEach(s => {
    s.classList.toggle("selected", s.dataset.color === c);
  });
}

// ── Live rooms list ───────────────────────────────────────────────────────────
function subscribeRooms() {
  onSnapshot(collection(db, "training_rooms"), snap => {
    const rooms = snap.docs
      .map(d => ({ id:d.id, ...d.data() }))
      .sort((a,b) => (a.createdAt||"").localeCompare(b.createdAt||""));
    renderRooms(rooms);
    set("roomCount", `${rooms.length} room${rooms.length!==1?"s":""}`);
  }, err => {
    console.error(err);
    showToast("Failed to load rooms: "+err.message, "error");
  });
}

function renderRooms(rooms) {
  const list = el("roomsList"); if (!list) return;
  if (rooms.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="ei">🏢</div>No rooms yet. Add one above.</div>`;
    return;
  }
  list.innerHTML = "";
  rooms.forEach(room => {
    const row = document.createElement("div");
    row.className = "room-row";
    row.innerHTML = `
      <div class="room-color-badge" style="background:${room.color||"#1E3A5F"}"></div>
      <div class="room-info">
        <div class="room-name">${room.name}</div>
        <div class="room-meta">
          Capacity: <strong>${room.capacity}</strong> persons
          ${room.location ? ` · ${room.location}` : ""}
        </div>
      </div>
      <div class="room-actions">
        <button class="btn-icon-sm edit" title="Edit" data-id="${room.id}">✏️</button>
        <button class="btn-icon-sm del"  title="Delete" data-id="${room.id}">🗑️</button>
      </div>
    `;
    row.querySelector(".edit").addEventListener("click", () => startEdit(room));
    row.querySelector(".del").addEventListener("click",  () => deleteRoom(room));
    list.appendChild(row);
  });
}

// ── Add / Edit room ───────────────────────────────────────────────────────────
el("saveRoomBtn")?.addEventListener("click", async () => {
  const name     = el("roomName")?.value.trim();
  const capacity = Number(el("roomCapacity")?.value);
  const location = el("roomLocation")?.value.trim();
  const color    = el("roomColor")?.value || "#2E5B88";
  const editId   = el("editingId")?.value;
  const msg      = el("formMsg");
  const btn      = el("saveRoomBtn");

  msg.className = "message"; msg.textContent = "";

  if (!name)         { msg.className="message error"; msg.textContent="Room name is required."; return; }
  if (!capacity||capacity<1) { msg.className="message error"; msg.textContent="Please enter a valid capacity."; return; }

  btn.disabled=true; btn.classList.add("loading");

  const bgColor = color+"26"; // ~15% opacity for background

  try {
    if (editId) {
      await setDoc(doc(db,"training_rooms",editId), {
        name, capacity, location, color, bg:bgColor, updatedAt:new Date().toISOString()
      }, { merge:true });
      showToast(`✓ "${name}" updated.`);
    } else {
      await addDoc(collection(db,"training_rooms"), {
        name, capacity, location, color, bg:bgColor, createdAt:new Date().toISOString()
      });
      showToast(`✓ "${name}" added.`);
    }
    resetForm();
  } catch(e) {
    msg.className="message error"; msg.textContent="Save failed: "+e.message;
  }
  btn.disabled=false; btn.classList.remove("loading");
});

function startEdit(room) {
  el("formTitle").textContent   = "Edit Room";
  el("roomName").value          = room.name||"";
  el("roomCapacity").value      = room.capacity||"";
  el("roomLocation").value      = room.location||"";
  el("roomColor").value         = room.color||"#2E5B88";
  el("editingId").value         = room.id;
  el("saveBtnLabel").textContent = "Save Changes";
  el("cancelEditBtn").style.display = "inline";
  buildColorPicker(); // re-render with new selected color
  el("roomName").focus();
  window.scrollTo({ top:0, behavior:"smooth" });
}

function resetForm() {
  el("formTitle").textContent    = "Add New Room";
  el("roomName").value           = "";
  el("roomCapacity").value       = "";
  el("roomLocation").value       = "";
  el("roomColor").value          = "#2E5B88";
  el("editingId").value          = "";
  el("saveBtnLabel").textContent = "Add Room";
  el("cancelEditBtn").style.display = "none";
  el("formMsg").textContent      = "";
  buildColorPicker();
}

el("cancelEditBtn")?.addEventListener("click", resetForm);

async function deleteRoom(room) {
  if (!confirm(`Delete "${room.name}"? This won't cancel existing bookings.`)) return;
  try {
    await deleteDoc(doc(db,"training_rooms",room.id));
    showToast(`"${room.name}" deleted.`, "error");
  } catch(e) {
    showToast("Delete failed: "+e.message, "error");
  }
}
