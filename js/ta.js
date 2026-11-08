import { app } from "./firebase.js";
import { guardRole } from "./guard.js";
import { getAuth, signOut }
  from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc,
  collection, addDoc, updateDoc, deleteDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const auth = getAuth(app);
const db   = getFirestore(app);

// ── State (declared before any async work) ───────────────────────────────────
let currentUser  = null;
let requisitions = [];
let editingId    = null;

const el  = id => document.getElementById(id);
const set = (id, v) => { const e = el(id); if (e) e.textContent = v; };
const esc = s => String(s ?? "").replace(/[&<>"']/g, ch =>
  ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));

function parseD(s)  { return new Date(s + "T00:00:00"); }
function todayD()   { const t = new Date(); t.setHours(0,0,0,0); return t; }
function daysBetween(a, b) { return Math.round((b - a) / 86400000); }
function fmtDate(s) {
  if (!s) return "—";
  return parseD(s).toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" });
}
function plural(n, w) { return `${n} ${w}${n === 1 ? "" : "s"}`; }
function showMsg(id, text, cls) {
  const m = el(id); if (!m) return;
  m.textContent = text; m.className = "save-msg " + (cls || "");
  clearTimeout(m._t);
  if (cls === "success") m._t = setTimeout(() => { m.textContent = ""; }, 4000);
}

// ── Auth ─────────────────────────────────────────────────────────────────────
guardRole(["admin", "data_entry"]).then(({ user }) => {
  currentUser = user;
  set("topbarEmail", user.email);
  loadHeadcount();
  subscribeRequisitions();
});

// ═════════════════ Standard vs Current manpower ═════════════════════════════
const HC_INPUTS = { stdOperator:"hcStdOp", curOperator:"hcCurOp", stdHelper:"hcStdHp", curHelper:"hcCurHp" };
const num = id => Math.max(0, Math.floor(Number(el(id)?.value) || 0));

function paintGap(cellId, std, cur) {
  const c = el(cellId); if (!c) return;
  if (!std && !cur) { c.textContent = "—"; c.style.color = ""; return; }
  const g = cur - std;
  if (g < 0)      { c.textContent = `Vacant ${-g}`;  c.style.color = "#8B3A2A"; }
  else if (g > 0) { c.textContent = `Surplus ${g}`;  c.style.color = "#BA7517"; }
  else            { c.textContent = "Full";           c.style.color = "#3A6B4A"; }
}
function updateGaps() {
  paintGap("gapOp", num("hcStdOp"), num("hcCurOp"));
  paintGap("gapHp", num("hcStdHp"), num("hcCurHp"));
}
Object.values(HC_INPUTS).forEach(id => el(id)?.addEventListener("input", updateGaps));

async function loadHeadcount() {
  try {
    const snap = await getDoc(doc(db, "ta_data", "headcount"));
    const d = snap.exists() ? snap.data() : {};
    Object.entries(HC_INPUTS).forEach(([field, id]) => {
      const v = Number(d[field]) || 0;
      el(id).value = v || "";
    });
    updateGaps();
    if (d.updatedAt) set("hcUpdated", "Last updated " + new Date(d.updatedAt).toLocaleString());
  } catch (e) { showMsg("hcMsg", "Load failed: " + e.message, "error"); }
}

el("hcSaveBtn")?.addEventListener("click", async () => {
  const btn = el("hcSaveBtn");
  btn.disabled = true; showMsg("hcMsg", "Saving…", "");
  try {
    await setDoc(doc(db, "ta_data", "headcount"), {
      stdOperator: num("hcStdOp"), curOperator: num("hcCurOp"),
      stdHelper:   num("hcStdHp"), curHelper:   num("hcCurHp"),
      updatedAt: new Date().toISOString(), updatedBy: currentUser?.email || ""
    });
    set("hcUpdated", "Last updated " + new Date().toLocaleString());
    showMsg("hcMsg", "✓ Saved", "success");
  } catch (e) { showMsg("hcMsg", "Save failed: " + e.message, "error"); }
  btn.disabled = false;
});

// ═════════════════ Requisitions ═════════════════════════════════════════════
function subscribeRequisitions() {
  onSnapshot(collection(db, "ta_requisitions"), snap => {
    requisitions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderRequisitions();
  }, err => {
    el("rqBody").innerHTML = `<tr><td colspan="7" style="text-align:center;color:red;padding:20px;">Load failed: ${esc(err.message)}</td></tr>`;
  });
}

function renderRequisitions() {
  const today = todayD();
  const rows = requisitions.filter(r => r.reqDate).map(r => {
    const open = !r.ecmDate;
    const days = open
      ? Math.max(0, daysBetween(parseD(r.reqDate), today))
      : daysBetween(parseD(r.reqDate), parseD(r.ecmDate));
    return { ...r, open, days };
  });
  rows.sort((a, b) => {
    if (a.open !== b.open) return a.open ? -1 : 1;                 // open first
    if (a.open) return b.days - a.days;                              // oldest open first
    return String(b.ecmDate).localeCompare(String(a.ecmDate));       // latest filled first
  });

  const openCount = rows.filter(r => r.open).length;
  set("rqSummary", `${openCount} open · ${rows.length - openCount} filled`);

  if (!rows.length) {
    el("rqBody").innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:24px;">No requisitions yet.</td></tr>`;
    return;
  }
  el("rqBody").innerHTML = rows.map(r => `<tr>
    <td>${esc(r.position || "—")}${r.remarks ? `<div class="remarks">${esc(r.remarks)}</div>` : ""}</td>
    <td>${Number(r.vacancies) || 1}</td>
    <td>${fmtDate(r.reqDate)}</td>
    <td>${fmtDate(r.ecmDate)}</td>
    <td><span class="badge ${r.open ? "badge-open" : "badge-filled"}">${r.open ? "Open" : "Filled"}</span></td>
    <td>${r.open ? plural(r.days, "day") + " passed" : plural(r.days, "day") + " to fill"}</td>
    <td>
      <button class="row-btn" onclick="editReq('${r.id}')">Edit</button>
      <button class="row-btn danger" onclick="deleteReq('${r.id}')">Delete</button>
    </td>
  </tr>`).join("");
}

function resetForm() {
  editingId = null;
  el("rqPos").value = ""; el("rqQty").value = "1";
  el("rqDate").value = new Date().toISOString().slice(0, 10);
  el("rqEcm").value = ""; el("rqRemarks").value = "";
  el("rqSaveBtn").textContent = "+ Add Requisition";
  el("rqCancelBtn").style.display = "none";
  set("rqFormTitle", "Manpower Requisitions");
}
resetForm();

el("rqSaveBtn")?.addEventListener("click", async () => {
  const position = el("rqPos").value.trim();
  const reqDate  = el("rqDate").value;
  const ecmDate  = el("rqEcm").value;
  const vacancies = Math.max(1, Math.floor(Number(el("rqQty").value) || 1));

  if (!position || !reqDate) { showMsg("rqMsg", "Position and Requisition Date are required.", "error"); return; }
  if (ecmDate && ecmDate < reqDate) { showMsg("rqMsg", "ECM Date cannot be earlier than the Requisition Date.", "error"); return; }

  const btn = el("rqSaveBtn"); btn.disabled = true;
  const payload = {
    position, vacancies, reqDate,
    ecmDate: ecmDate || "",
    remarks: el("rqRemarks").value.trim() || "",
    updatedAt: new Date().toISOString(), updatedBy: currentUser?.email || ""
  };
  try {
    if (editingId) {
      await updateDoc(doc(db, "ta_requisitions", editingId), payload);
      showMsg("rqMsg", "✓ Requisition updated", "success");
    } else {
      payload.createdAt = new Date().toISOString();
      payload.createdBy = currentUser?.email || "";
      await addDoc(collection(db, "ta_requisitions"), payload);
      showMsg("rqMsg", "✓ Requisition added", "success");
    }
    resetForm();
  } catch (e) { showMsg("rqMsg", "Save failed: " + e.message, "error"); }
  btn.disabled = false;
});

el("rqCancelBtn")?.addEventListener("click", () => { resetForm(); showMsg("rqMsg", "", ""); });

window.editReq = function (id) {
  const r = requisitions.find(x => x.id === id); if (!r) return;
  editingId = id;
  el("rqPos").value = r.position || ""; el("rqQty").value = Number(r.vacancies) || 1;
  el("rqDate").value = r.reqDate || ""; el("rqEcm").value = r.ecmDate || "";
  el("rqRemarks").value = r.remarks || "";
  el("rqSaveBtn").textContent = "💾 Update Requisition";
  el("rqCancelBtn").style.display = "";
  set("rqFormTitle", "Edit Requisition");
  el("rqPos").scrollIntoView({ behavior: "smooth", block: "center" });
};

window.deleteReq = async function (id) {
  const r = requisitions.find(x => x.id === id);
  if (!confirm(`Delete requisition "${r?.position || ""}"?`)) return;
  try { await deleteDoc(doc(db, "ta_requisitions", id)); }
  catch (e) { showMsg("rqMsg", "Delete failed: " + e.message, "error"); }
};

el("logoutBtn")?.addEventListener("click", async () => { await signOut(auth); window.location.href = "login.html"; });
