import { app } from "./firebase.js";
import { getAuth, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { getFirestore, collection, getDocs,
  doc, getDoc, updateDoc, deleteDoc }
  from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const auth = getAuth(app);
const db   = getFirestore(app);
let allUsers = [];

// ── Auth guard (admin only) ───────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists() || snap.data().role !== "admin") {
    window.location.href = "dashboard.html"; return;
  }
  document.getElementById("topbarEmail").textContent = user.email;
  loadUsers();
});

// ── Load ──────────────────────────────────────────────────────────────────────
async function loadUsers() {
  try {
    const snapshot = await getDocs(collection(db, "users"));
    allUsers = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAll();
  } catch(e) { showToast("Failed to load users.", true); }
}

function renderAll() { renderPending(); renderAllEmployees(); renderAdmins(); }

// ── Pending ───────────────────────────────────────────────────────────────────
function renderPending() {
  const pending = allUsers.filter(u => u.status === "pending" && u.role !== "admin");
  document.getElementById("pending-count").textContent = `${pending.length} pending`;
  const tbody = document.getElementById("pending-body");
  if (!pending.length) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">✅</div>No pending approvals.</div></td></tr>`;
    return;
  }
  tbody.innerHTML = pending.map(u => `
    <tr data-search="${(u.name+u.email).toLowerCase()}">
      <td><strong>${u.name||"—"}</strong></td>
      <td>${u.email||"—"}</td>
      <td>${u.employeeId||"—"}</td>
      <td>${new Date(u.createdAt||Date.now()).toLocaleDateString()}</td>
      <td>
        <button class="action-btn btn-approve" onclick="approveUser('${u.id}')">Approve</button>
        <button class="action-btn btn-reject"  onclick="rejectUser('${u.id}')">Reject</button>
        <button class="action-btn btn-delete"  onclick="deleteUser('${u.id}')">Delete</button>
      </td>
    </tr>`).join("");
}

// ── All employees ─────────────────────────────────────────────────────────────
function renderAllEmployees() {
  const users = allUsers.filter(u => u.role !== "admin");
  document.getElementById("all-count").textContent = `${users.length} employees`;
  const tbody = document.getElementById("all-body");
  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">👥</div>No employees found.</div></td></tr>`;
    return;
  }
  tbody.innerHTML = users.map(u => `
    <tr data-search="${(u.name+u.email).toLowerCase()}">
      <td><strong>${u.name||"—"}</strong></td>
      <td>${u.email||"—"}</td>
      <td>${u.employeeId||"—"}</td>
      <td>${roleBadge(u.role)}</td>
      <td>${statusBadge(u.status)}</td>
      <td>
        <select class="role-select" onchange="changeRole('${u.id}',this.value)">
          <option value="user"       ${u.role==="user"       ?"selected":""}>User</option>
          <option value="data_entry" ${u.role==="data_entry" ?"selected":""}>Data Entry</option>
          <option value="admin"      ${u.role==="admin"      ?"selected":""}>Admin</option>
        </select>
      </td>
      <td>
        ${u.status==="pending"
          ? `<button class="action-btn btn-approve" onclick="approveUser('${u.id}')">Approve</button>
             <button class="action-btn btn-reject"  onclick="rejectUser('${u.id}')">Reject</button>`
          : ""}
        <button class="action-btn btn-delete" onclick="deleteUser('${u.id}')">Delete</button>
      </td>
    </tr>`).join("");
}

// ── Admins ────────────────────────────────────────────────────────────────────
function renderAdmins() {
  const admins = allUsers.filter(u => u.role === "admin");
  document.getElementById("admins-count").textContent = `${admins.length} admins`;
  const tbody = document.getElementById("admins-body");
  if (!admins.length) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><div class="empty-icon">🛡️</div>No admins yet.</div></td></tr>`;
    return;
  }
  tbody.innerHTML = admins.map(u => `
    <tr data-search="${(u.name+u.email).toLowerCase()}">
      <td><strong>${u.name||"—"}</strong></td>
      <td>${u.email||"—"}</td>
      <td>${u.employeeId||"—"}</td>
      <td>
        <button class="action-btn btn-demote" onclick="changeRole('${u.id}','user')">Remove Admin</button>
        <button class="action-btn btn-delete" onclick="deleteUser('${u.id}')">Delete</button>
      </td>
    </tr>`).join("");
}

// ── Actions ───────────────────────────────────────────────────────────────────
window.approveUser = async (uid) => {
  await updateDoc(doc(db,"users",uid),{status:"active"});
  patch(uid,{status:"active"}); renderAll(); showToast("User approved ✓");
};
window.rejectUser = async (uid) => {
  await updateDoc(doc(db,"users",uid),{status:"rejected"});
  patch(uid,{status:"rejected"}); renderAll(); showToast("User rejected.");
};
window.changeRole = async (uid, role) => {
  const updates = { role, ...(role!=="user" ? {status:"active"} : {}) };
  await updateDoc(doc(db,"users",uid), updates);
  patch(uid, updates); renderAll();
  showToast(`Role set to "${role}" ✓`);
};
window.deleteUser = async (uid) => {
  if (!confirm("Delete this user permanently?")) return;
  await deleteDoc(doc(db,"users",uid));
  allUsers = allUsers.filter(u=>u.id!==uid);
  renderAll(); showToast("User deleted.");
};

function patch(uid, changes) {
  allUsers = allUsers.map(u => u.id===uid ? {...u,...changes} : u);
}

// ── Badges ────────────────────────────────────────────────────────────────────
function roleBadge(role) {
  const map = {
    admin:      `<span class="badge badge-active">Admin</span>`,
    data_entry: `<span class="badge badge-data">Data Entry</span>`,
    user:       `<span class="badge badge-pending">User</span>`,
  };
  return map[role] || `<span class="badge badge-pending">${role||"user"}</span>`;
}
function statusBadge(status) {
  const cls = status==="active" ? "badge-active" : "badge-pending";
  return `<span class="badge ${cls}">${status||"pending"}</span>`;
}

// ── Tab switching ─────────────────────────────────────────────────────────────
window.switchTab = function(tab) {
  ["pending","all","admins"].forEach(t => {
    document.getElementById(`tab-${t}`).style.display = t===tab?"block":"none";
    document.querySelector(`[data-tab="${t}"]`).classList.toggle("active", t===tab);
  });
};
window.filterTable = function(tableId, query) {
  document.querySelectorAll(`#${tableId} tbody tr`).forEach(row => {
    row.style.display = (row.dataset.search||"").includes(query.toLowerCase()) ? "" : "none";
  });
};

function showToast(msg, error=false) {
  const t = document.getElementById("toast");
  t.textContent=msg; t.className="toast"+(error?" error":"");
  t.classList.add("show"); setTimeout(()=>t.classList.remove("show"),3000);
}

document.getElementById("logoutBtn")
  .addEventListener("click", async () => { await signOut(auth); window.location.href="login.html"; });
