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

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "login.html"; return; }

  document.getElementById("topbarEmail").textContent = user.email;

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists()) return;
    const d = snap.data();

    // Redirect admin
    if (d.role === "admin") { window.location.href = "admin.html"; return; }

    // Profile
    document.getElementById("userName").textContent  = d.name?.split(" ")[0] || "there";
    document.getElementById("statRole").textContent  = capitalize(d.role || "—");
    document.getElementById("statEmpId").textContent = d.employeeId || "—";
    document.getElementById("statStatus").innerHTML  = badgeHTML(d.status);
    document.getElementById("infoName").textContent    = d.name       || "—";
    document.getElementById("infoEmail").textContent   = d.email      || "—";
    document.getElementById("infoEmpId").textContent   = d.employeeId || "—";
    document.getElementById("infoRole").textContent    = capitalize(d.role || "—");
    document.getElementById("infoStatus").innerHTML    = badgeHTML(d.status);
    document.getElementById("infoCreated").textContent = d.createdAt
      ? new Date(d.createdAt).toLocaleDateString("en-US", { year:"numeric", month:"long", day:"numeric" })
      : "—";

    // Load my survey responses
    const respSnap = await getDocs(query(
      collection(db, "responses"),
      where("userId", "==", user.uid)
    ));
    const responses = respSnap.docs.map(d => d.data());
    document.getElementById("statSurveys").textContent = responses.length;

    renderMyCharts(responses);
  } catch (e) {
    console.error("Dashboard error:", e);
  }
});

// ── Render per-survey charts for the user ─────────────────────────────────────
async function renderMyCharts(responses) {
  const area = document.getElementById("myChartsArea");
  if (responses.length === 0) return;

  // Group by survey
  const bySurvey = {};
  responses.forEach(r => {
    if (!bySurvey[r.surveyId]) bySurvey[r.surveyId] = { title: r.surveyTitle, frequency: r.frequency, responses: [] };
    bySurvey[r.surveyId].responses.push(r);
  });

  // Load survey question definitions
  const surveyIds = Object.keys(bySurvey);
  const surveyDefs = {};
  await Promise.all(surveyIds.map(async id => {
    const s = await getDoc(doc(db, "surveys", id));
    if (s.exists()) surveyDefs[id] = s.data();
  }));

  area.innerHTML = "";

  for (const [surveyId, group] of Object.entries(bySurvey)) {
    const def = surveyDefs[surveyId];
    if (!def) continue;

    // Sort responses by period
    const sorted = group.responses.sort((a, b) => a.period.localeCompare(b.period));
    const periods = sorted.map(r => r.period);

    const card = document.createElement("div");
    card.className = "chart-card";
    card.innerHTML = `<h3>${group.title} <span style="font-weight:400;color:var(--muted)">(${capitalize(group.frequency)})</span></h3>`;

    // For each rating question, plot trend over time
    def.questions.forEach((q, i) => {
      if (q.type !== "rating") return;
      const dataPoints = sorted.map(r => Number(r.answers?.[i]) || null);

      const wrap = document.createElement("div");
      wrap.style.marginBottom = "20px";
      wrap.innerHTML = `<p style="font-size:0.8rem;color:var(--muted);margin-bottom:8px;">Q${i+1}: ${q.text}</p>
        <div class="chart-wrap"><canvas id="dc-${surveyId}-${i}"></canvas></div>`;
      card.appendChild(wrap);

      setTimeout(() => {
        const ctx = document.getElementById(`dc-${surveyId}-${i}`).getContext("2d");
        new Chart(ctx, {
          type: "line",
          data: {
            labels: periods,
            datasets: [{
              label: "Your rating",
              data: dataPoints,
              borderColor: "#111",
              backgroundColor: "rgba(17,17,17,0.06)",
              borderWidth: 2,
              pointRadius: 5,
              tension: 0.3,
              fill: true
            }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              y: { min: 1, max: 5, ticks: { stepSize: 1 } }
            }
          }
        });
      }, 0);
    });

    area.appendChild(card);
  }
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

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "login.html";
});
