import { app } from "./firebase.js";
import {
  getAuth, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  getFirestore,
  doc, getDoc, collection, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const auth = getAuth(app);
const db   = getFirestore(app);

function el(id)           { return document.getElementById(id); }
function setText(id, val) { const n = el(id); if (n) n.textContent = val; }

// ── Sidebar navigation ────────────────────────────────────────────────────────
const navItems     = document.querySelectorAll(".nav-item[data-section]");
const sections     = document.querySelectorAll(".section-panel");
const dataToggle   = el("dataEntryToggle");
const dataEntrySub = el("dataEntrySub");

function showSection(sectionId) {
  sections.forEach(s => s.classList.remove("active"));
  navItems.forEach(n => n.classList.remove("active"));
  const panel = el(`section-${sectionId}`);
  if (panel) panel.classList.add("active");
  const tab = document.querySelector(`.nav-item[data-section="${sectionId}"]`);
  if (tab) tab.classList.add("active");
  closeSidebar();
}

navItems.forEach(item => {
  item.addEventListener("click", () => {
    const section = item.dataset.section;
    if (section === "dataentry") {
      // Toggle sub-menu
      const isOpen = dataEntrySub.classList.contains("open");
      dataEntrySub.classList.toggle("open", !isOpen);
      item.classList.toggle("open", !isOpen);
    } else {
      showSection(section);
    }
  });
});

// ── Mobile hamburger ──────────────────────────────────────────────────────────
const sidebar        = el("sidebar");
const overlay        = el("sidebarOverlay");
const hamburger      = el("hamburger");

function openSidebar()  { sidebar.classList.add("open"); overlay.classList.add("open"); }
function closeSidebar() { sidebar.classList.remove("open"); overlay.classList.remove("open"); }

hamburger.addEventListener("click", openSidebar);
overlay.addEventListener("click", closeSidebar);

// ── Auth ──────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "login.html"; return; }

  // Topbar chip
  const initials = (user.email || "?")[0].toUpperCase();
  const chipAv = el("chipAvatar");
  if (chipAv) chipAv.textContent = initials;
  setText("chipEmail", user.email);

  loadProfile(user);
  loadSurveys(user);
});

// ── Profile ───────────────────────────────────────────────────────────────────
async function loadProfile(user) {
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists()) return;
    const d = snap.data();

    if (d.role === "admin") { window.location.href = "admin.html"; return; }

    const firstName = d.name?.split(" ")[0] || "there";
    const initials  = (d.name || "?").split(" ").map(w => w[0]).join("").slice(0,2).toUpperCase();

    // Sidebar mini profile
    const sideAv = el("sideAvatar");
    if (sideAv) sideAv.textContent = initials;
    setText("sideName", d.name || "—");
    setText("sideRole", capitalize(d.role || "user"));

    // Topbar avatar
    const chipAv = el("chipAvatar");
    if (chipAv) chipAv.textContent = initials;

    // Main profile
    setText("userName",    firstName);
    setText("userSub",     `${d.employeeId || ""} · ${capitalize(d.status || "pending")}`);
    setText("statRole",    capitalize(d.role || "—"));
    setText("statEmpId",   d.employeeId || "—");
    setText("profileName", d.name || "—");
    setText("profileSub",  `${capitalize(d.role || "user")} · ${d.employeeId || ""}`);
    setText("infoEmail",   d.email || "—");
    setText("infoEmpId",   d.employeeId || "—");
    setText("infoCreated", d.createdAt
      ? new Date(d.createdAt).toLocaleDateString("en-US", { year:"numeric", month:"long", day:"numeric" })
      : "—");

    const avEl = el("profileAvatar");
    if (avEl) avEl.textContent = initials;

    const statusEl = el("statStatus");
    if (statusEl) statusEl.innerHTML = badgeHTML(d.status);
    const infoStatusEl = el("infoStatus");
    if (infoStatusEl) infoStatusEl.innerHTML = badgeHTML(d.status);

  } catch(e) { console.error("Profile error:", e); }
}

// ── Surveys ───────────────────────────────────────────────────────────────────
async function loadSurveys(user) {
  try {
    const respSnap = await getDocs(query(
      collection(db, "responses"),
      where("userId", "==", user.uid)
    ));
    const responses = respSnap.docs.map(d => d.data());
    setText("statSurveys", responses.length);

    if (responses.length === 0) return;

    // Group by survey
    const bySurvey = {};
    responses.forEach(r => {
      if (!bySurvey[r.surveyId]) bySurvey[r.surveyId] = {
        title: r.surveyTitle, frequency: r.frequency, responses: []
      };
      bySurvey[r.surveyId].responses.push(r);
    });

    // Load defs
    const surveyDefs = {};
    await Promise.all(Object.keys(bySurvey).map(async id => {
      const s = await getDoc(doc(db, "surveys", id));
      if (s.exists()) surveyDefs[id] = s.data();
    }));

    const area = el("surveyContent");
    area.innerHTML = "";

    for (const [surveyId, group] of Object.entries(bySurvey)) {
      const def = surveyDefs[surveyId];
      if (!def) continue;
      const sorted  = group.responses.sort((a,b) => a.period.localeCompare(b.period));
      const ratingQs = def.questions.map((q,i) => ({q,i})).filter(({q}) => q.type === "rating");
      if (!ratingQs.length) continue;

      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <h3>${group.title}</h3>
        <p class="card-sub">${capitalize(group.frequency)} · ${sorted.length} response${sorted.length!==1?"s":""}</p>
        ${ratingQs.map(({q,i}) => `
          <p style="font-size:0.78rem;color:var(--muted);margin-bottom:6px;">Q${i+1}: ${q.text}</p>
          <div class="chart-wrap" style="margin-bottom:16px;"><canvas id="sc-${surveyId}-${i}"></canvas></div>
        `).join("")}
      `;
      area.appendChild(card);

      ratingQs.forEach(({q,i}) => {
        const data = sorted.map(r => Number(r.answers?.[i]) || null);
        const ctx  = document.getElementById(`sc-${surveyId}-${i}`)?.getContext("2d");
        if (!ctx) return;
        new Chart(ctx, {
          type: "line",
          data: {
            labels: sorted.map(r => r.period),
            datasets: [{ data, borderColor:"#111", backgroundColor:"rgba(17,17,17,0.05)",
              borderWidth:2, pointRadius:5, pointBackgroundColor:"#111", tension:0.3, fill:true }]
          },
          options: {
            responsive:true, maintainAspectRatio:false,
            plugins: { legend:{display:false} },
            scales: {
              x: { grid:{display:false}, ticks:{font:{size:11}} },
              y: { min:1, max:5, ticks:{stepSize:1,font:{size:11}}, grid:{color:"#f0f0ee"} }
            }
          }
        });
      });
    }
  } catch(e) { console.error("Survey error:", e); }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function capitalize(str) {
  if (!str) return "—";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function badgeHTML(status) {
  const cls = status === "active" ? "badge-active" : "badge-pending";
  return `<span class="badge ${cls}">${capitalize(status || "pending")}</span>`;
}

// ── Logout ────────────────────────────────────────────────────────────────────
el("logoutBtn")?.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "login.html";
});
