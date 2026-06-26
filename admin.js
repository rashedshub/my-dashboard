import { app } from "./firebase.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const auth = getAuth(app);
const db   = getFirestore(app);

let currentTab = "pending";
let allUsers   = [];

// ── Auth guard ────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "login.html"; return; }

  // Verify admin role
  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists() || snap.data().role !== "admin") {
    window.location.href = "dashboard.html";
    return;
  }

  document.getElementById("topbarEmail").textContent = user.email;
  loadUsers();
});

// ── Load all users ────────────────────────────────────────────────────────────
async function loadUsers() {
  try {
    const snapshot = await getDocs(collection(db, "users"));
    allUsers = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAll();
  } catch (e) {
    showToast("Failed to load users.", true);
  }
}

function renderAll() {
  renderPending();
  renderAllEmployees();
  renderAdmins();
}

// ── Pending tab ───────────────────────────────────────────────────────────────
function renderPending() {
  const pending = allUsers.filter(u => u.status === "pending" && u.role !== "admin");
  document.getElementById("pending-count").textContent = `${pending.length} pending`;
  const tbody = document.getElementById("pending-body");

  if (pending.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">✅</div>No pending approvals.</div></td></tr>`;
    return;
  }

  tbody.innerHTML = pending.map(u => `
    <tr data-search="${(u.name + u.email).toLowerCase()}">
      <td><strong>${u.name || "—"}</strong></td>
      <td>${u.email || "—"}</td>
      <td>${u.employeeId || "—"}</td>
      <td>${u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}</td>
      <td>
        <button class="action-btn btn-approve" onclick="approveUser('${u.id}')">Approve</button>
        <button class="action-btn btn-reject"  onclick="rejectUser('${u.id}')">Reject</button>
        <button class="action-btn btn-delete"  onclick="deleteUser('${u.id}')">Delete</button>
      </td>
    </tr>
  `).join("");
}

// ── All employees tab ─────────────────────────────────────────────────────────
function renderAllEmployees() {
  const users = allUsers.filter(u => u.role !== "admin");
  document.getElementById("all-count").textContent = `${users.length} employees`;
  const tbody = document.getElementById("all-body");

  if (users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">👥</div>No employees found.</div></td></tr>`;
    return;
  }

  tbody.innerHTML = users.map(u => `
    <tr data-search="${(u.name + u.email).toLowerCase()}">
      <td><strong>${u.name || "—"}</strong></td>
      <td>${u.email || "—"}</td>
      <td>${u.employeeId || "—"}</td>
      <td>${capitalize(u.role || "user")}</td>
      <td>${badgeHTML(u.status)}</td>
      <td>
        ${u.status === "pending"
          ? `<button class="action-btn btn-approve" onclick="approveUser('${u.id}')">Approve</button>
             <button class="action-btn btn-reject"  onclick="rejectUser('${u.id}')">Reject</button>`
          : ""}
        <button class="action-btn btn-promote" onclick="promoteUser('${u.id}')">Make Admin</button>
        <button class="action-btn btn-delete"  onclick="deleteUser('${u.id}')">Delete</button>
      </td>
    </tr>
  `).join("");
}

// ── Admins tab ────────────────────────────────────────────────────────────────
function renderAdmins() {
  const admins = allUsers.filter(u => u.role === "admin");
  document.getElementById("admins-count").textContent = `${admins.length} admins`;
  const tbody = document.getElementById("admins-body");

  if (admins.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><div class="empty-icon">🛡️</div>No admins yet.</div></td></tr>`;
    return;
  }

  tbody.innerHTML = admins.map(u => `
    <tr data-search="${(u.name + u.email).toLowerCase()}">
      <td><strong>${u.name || "—"}</strong></td>
      <td>${u.email || "—"}</td>
      <td>${u.employeeId || "—"}</td>
      <td>
        <button class="action-btn btn-demote" onclick="demoteUser('${u.id}')">Remove Admin</button>
        <button class="action-btn btn-delete" onclick="deleteUser('${u.id}')">Delete</button>
      </td>
    </tr>
  `).join("");
}

// ── Actions ───────────────────────────────────────────────────────────────────
window.approveUser = async (uid) => {
  await updateDoc(doc(db, "users", uid), { status: "active" });
  updateLocal(uid, { status: "active" });
  renderAll();
  showToast("User approved ✓");
};

window.rejectUser = async (uid) => {
  await updateDoc(doc(db, "users", uid), { status: "rejected" });
  updateLocal(uid, { status: "rejected" });
  renderAll();
  showToast("User rejected.");
};

window.promoteUser = async (uid) => {
  await updateDoc(doc(db, "users", uid), { role: "admin", status: "active" });
  updateLocal(uid, { role: "admin", status: "active" });
  renderAll();
  showToast("User promoted to admin ✓");
};

window.demoteUser = async (uid) => {
  await updateDoc(doc(db, "users", uid), { role: "user" });
  updateLocal(uid, { role: "user" });
  renderAll();
  showToast("Admin demoted to user.");
};

window.deleteUser = async (uid) => {
  if (!confirm("Delete this user? This cannot be undone.")) return;
  await deleteDoc(doc(db, "users", uid));
  allUsers = allUsers.filter(u => u.id !== uid);
  renderAll();
  showToast("User deleted.");
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function updateLocal(uid, changes) {
  allUsers = allUsers.map(u => u.id === uid ? { ...u, ...changes } : u);
}

function capitalize(str) {
  if (!str) return "—";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function badgeHTML(status) {
  const map = {
    active:   "badge-active",
    pending:  "badge-pending",
    rejected: "badge-pending",
  };
  const cls = map[status] || "badge-pending";
  return `<span class="badge ${cls}">${capitalize(status || "pending")}</span>`;
}

// ── Tab switcher ──────────────────────────────────────────────────────────────
window.switchTab = function(tab) {
  ["pending", "all", "admins"].forEach(t => {
    document.getElementById(`tab-${t}`).style.display = t === tab ? "block" : "none";
    document.querySelector(`[data-tab="${t}"]`).classList.toggle("active", t === tab);
  });
  currentTab = tab;
};

// ── Search / filter ───────────────────────────────────────────────────────────
window.filterTable = function(tableId, query) {
  const q = query.toLowerCase();
  document.querySelectorAll(`#${tableId} tbody tr`).forEach(row => {
    const searchVal = row.getAttribute("data-search") || "";
    row.style.display = searchVal.includes(q) ? "" : "none";
  });
};

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, error = false) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.className   = "toast" + (error ? " error" : "");
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

// ── Logout ────────────────────────────────────────────────────────────────────
document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "login.html";
});
