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

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function el(id)           { return document.getElementById(id); }
function setText(id, val) { const n = el(id); if (n) n.textContent = val; }

// ── Slide logic ───────────────────────────────────────────────────────────────
let currentPanel = 0;
const track = el("slideTrack");
const tabs   = document.querySelectorAll(".slide-tab");

function goTo(idx) {
  currentPanel = idx;
  track.style.transform = `translateX(-${idx * 100}%)`;
  tabs.forEach((t, i) => t.classList.toggle("active", i === idx));
}

tabs.forEach(tab => {
  tab.addEventListener("click", () => goTo(Number(tab.dataset.panel)));
});

// Touch / swipe support
let touchStartX = 0;
track.addEventListener("touchstart", e => { touchStartX = e.touches[0].clientX; }, { passive: true });
track.addEventListener("touchend", e => {
  const diff = touchStartX - e.changedTouches[0].clientX;
  if (Math.abs(diff) > 50) {
    const next = diff > 0
      ? Math.min(currentPanel + 1, tabs.length - 1)
      : Math.max(currentPanel - 1, 0);
    goTo(next);
  }
});

// ── Auth ──────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  setText("topbarEmail", user.email);
  loadProfile(user);
  loadSurveys(user);
  loadLeave(user);
});

// ── Profile ───────────────────────────────────────────────────────────────────
async function loadProfile(user) {
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists()) return;
    const d = snap.data();

    if (d.role === "admin") { window.location.href = "admin.html"; return; }

    const firstName = d.name?.split(" ")[0] || "there";
    setText("userName",    firstName);
    setText("welcomeSub",  `${d.employeeId || ""} · ${capitalize(d.status || "pending")}`);

    // Avatar initials
    const initials = (d.name || "?").split(" ").map(w => w[0]).join("").slice(0,2).toUpperCase();
    const avatarEl = el("profileAvatar");
    if (avatarEl) avatarEl.textContent = initials;

    setText("profileName",  d.name || "—");
    setText("profileSub",   `${capitalize(d.role || "user")} · ${d.employeeId || ""}`);
    setText("statRole",     capitalize(d.role || "—"));
    setText("statEmpId",    d.employeeId || "—");
    setText("infoEmail",    d.email || "—");
    setText("infoEmpId",    d.employeeId || "—");
    setText("infoCreated",  d.createdAt
      ? new Date(d.createdAt).toLocaleDateString("en-US", { year:"numeric", month:"long", day:"numeric" })
      : "—");

    const statusEl = el("statStatus");
    if (statusEl) statusEl.innerHTML = badgeHTML(d.status);
    const infoStatusEl = el("infoStatus");
    if (infoStatusEl) infoStatusEl.innerHTML = badgeHTML(d.status);

    // Show admin quick link if admin
    if (d.role === "admin") {
      const adminLink = el("adminLink");
      if (adminLink) adminLink.style.display = "flex";
    }

  } catch(e) { console.error("Profile error:", e); }
}

// ── Survey activity ───────────────────────────────────────────────────────────
async function loadSurveys(user) {
  try {
    const respSnap = await getDocs(query(
      collection(db, "responses"),
      where("userId", "==", user.uid)
    ));
    const responses = respSnap.docs.map(d => d.data());

    setText("statSurveys", responses.length);

    if (responses.length === 0) return;

    el("surveyEmpty").style.display       = "none";
    el("surveyChartsArea").style.display  = "block";

    // Group by survey
    const bySurvey = {};
    responses.forEach(r => {
      if (!bySurvey[r.surveyId]) bySurvey[r.surveyId] = { title: r.surveyTitle, frequency: r.frequency, responses: [] };
      bySurvey[r.surveyId].responses.push(r);
    });

    // Load question defs
    const surveyDefs = {};
    await Promise.all(Object.keys(bySurvey).map(async id => {
      const s = await getDoc(doc(db, "surveys", id));
      if (s.exists()) surveyDefs[id] = s.data();
    }));

    const area = el("surveyChartsArea");
    area.innerHTML = "";

    for (const [surveyId, group] of Object.entries(bySurvey)) {
      const def = surveyDefs[surveyId];
      if (!def) continue;

      const sorted  = group.responses.sort((a,b) => a.period.localeCompare(b.period));
      const periods = sorted.map(r => r.period);

      // Only render rating questions as line charts
      const ratingQs = def.questions
        .map((q, i) => ({ q, i }))
        .filter(({ q }) => q.type === "rating");

      if (ratingQs.length === 0) continue;

      const card = document.createElement("div");
      card.className = "survey-chart-card";
      card.innerHTML = `
        <h3>${group.title}</h3>
        <p class="sc-meta">${capitalize(group.frequency)} · ${sorted.length} response${sorted.length !== 1 ? "s" : ""}</p>
        ${ratingQs.map(({ q, i }) => `
          <p style="font-size:0.78rem;color:var(--muted);margin-bottom:6px;">Q${i+1}: ${q.text}</p>
          <div class="chart-wrap" style="margin-bottom:16px;"><canvas id="sc-${surveyId}-${i}"></canvas></div>
        `).join("")}
      `;
      area.appendChild(card);

      ratingQs.forEach(({ q, i }) => {
        const data = sorted.map(r => Number(r.answers?.[i]) || null);
        const ctx  = document.getElementById(`sc-${surveyId}-${i}`)?.getContext("2d");
        if (!ctx) return;
        new Chart(ctx, {
          type: "line",
          data: {
            labels: periods,
            datasets: [{
              data,
              borderColor: "#111",
              backgroundColor: "rgba(17,17,17,0.05)",
              borderWidth: 2,
              pointRadius: 5,
              pointBackgroundColor: "#111",
              tension: 0.3,
              fill: true,
            }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { grid: { display: false }, ticks: { font: { size: 11 } } },
              y: { min: 1, max: 5, ticks: { stepSize: 1, font: { size: 11 } }, grid: { color: "#f0f0ee" } }
            }
          }
        });
      });
    }

  } catch(e) { console.error("Survey error:", e); }
}

// ── Leave summary ─────────────────────────────────────────────────────────────
async function loadLeave(user) {
  try {
    const year = new Date().getFullYear();
    const snap = await getDoc(doc(db, "leave_data", `${user.uid}_${year}`));
    if (!snap.exists()) return;

    const months = snap.data().months || {};
    const planByMonth   = Array(12).fill(0).map((_,i) => Number(months[i]?.plan)   || 0);
    const actualByMonth = Array(12).fill(0).map((_,i) => Number(months[i]?.actual) || 0);

    const totalPlan   = planByMonth.reduce((a,b)=>a+b,0);
    const totalActual = actualByMonth.reduce((a,b)=>a+b,0);

    if (totalPlan === 0 && totalActual === 0) return;

    el("leaveEmpty").style.display      = "none";
    el("leaveSummaryArea").style.display = "block";

    const area = el("leaveSummaryArea");

    // Overall bar
    const overallPct = totalPlan > 0 ? (totalActual / totalPlan * 100) : 0;
    const overallCls = overallPct > 100 ? "over" : "ok";

    let barsHTML = `
      <div class="leave-summary-card">
        <h3>Data Entry — Leave Usage ${year}</h3>
        <div class="leave-bar-row">
          <div class="leave-bar-label">
            <span class="lbl-name">Overall (Actual / Plan)</span>
            <span class="lbl-pct">${overallPct.toFixed(1)}% &nbsp;·&nbsp; ${fmt(totalActual)} / ${fmt(totalPlan)}</span>
          </div>
          <div class="leave-track"><div class="leave-fill ${overallCls}" style="width:${Math.min(overallPct,100)}%"></div></div>
        </div>
    `;

    // Per-month bars (only months with data)
    planByMonth.forEach((p, i) => {
      const a   = actualByMonth[i];
      if (p === 0 && a === 0) return;
      const pct = p > 0 ? (a / p * 100) : 0;
      const cls = pct > 100 ? "over" : "ok";
      barsHTML += `
        <div class="leave-bar-row">
          <div class="leave-bar-label">
            <span class="lbl-name">${MONTHS_SHORT[i]}</span>
            <span class="lbl-pct">${pct.toFixed(0)}% &nbsp;·&nbsp; ${fmt(a)} / ${fmt(p)}</span>
          </div>
          <div class="leave-track"><div class="leave-fill ${cls}" style="width:${Math.min(pct,100)}%"></div></div>
        </div>
      `;
    });

    barsHTML += `<a href="leave.html" class="leave-cta">Go to Data Entry →</a></div>`;
    area.innerHTML = barsHTML;

  } catch(e) { console.error("Leave error:", e); }
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

function fmt(n) {
  if (!n && n !== 0) return "—";
  return Number.isInteger(n) ? n.toLocaleString()
    : parseFloat(n).toLocaleString(undefined, { minimumFractionDigits:1, maximumFractionDigits:1 });
}

// ── Logout ────────────────────────────────────────────────────────────────────
const logoutBtn = el("logoutBtn");
if (logoutBtn) logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "login.html";
});
