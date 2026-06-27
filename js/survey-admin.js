import { app } from "./firebase.js";
import {
  getAuth, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  getFirestore,
  collection, addDoc, getDocs, doc, getDoc, updateDoc, deleteDoc, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const auth = getAuth(app);
const db   = getFirestore(app);

let surveys      = [];
let chartInstances = {};
let questionCount = 0;

// ── Auth guard ────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists() || snap.data().role !== "admin") {
    window.location.href = "dashboard.html"; return;
  }
  document.getElementById("topbarEmail").textContent = user.email;
  addQuestion(); // start with one question
  loadSurveys();
});

// ── Questions builder ─────────────────────────────────────────────────────────
window.addQuestion = function () {
  questionCount++;
  const id  = `q-${questionCount}`;
  const div = document.createElement("div");
  div.className = "question-row";
  div.id = id;
  div.innerHTML = `
    <input type="text" placeholder="Question ${questionCount}" class="q-text-input"/>
    <select class="q-type-select">
      <option value="rating">Rating (1–5)</option>
      <option value="yesno">Yes / No</option>
      <option value="text">Text answer</option>
    </select>
    <button class="btn-icon" onclick="removeQuestion('${id}')">✕</button>
  `;
  document.getElementById("questionsList").appendChild(div);
};

window.removeQuestion = function (id) {
  const el = document.getElementById(id);
  if (el) el.remove();
};

function getQuestions() {
  const rows = document.querySelectorAll(".question-row");
  const questions = [];
  rows.forEach(row => {
    const text = row.querySelector(".q-text-input").value.trim();
    const type = row.querySelector(".q-type-select").value;
    if (text) questions.push({ text, type });
  });
  return questions;
}

// ── Create survey ─────────────────────────────────────────────────────────────
document.getElementById("createBtn").addEventListener("click", async () => {
  const title     = document.getElementById("surveyTitle").value.trim();
  const frequency = document.getElementById("surveyFrequency").value;
  const desc      = document.getElementById("surveyDesc").value.trim();
  const questions = getQuestions();
  const msg       = document.getElementById("createMsg");

  msg.className = "message"; msg.textContent = "";

  if (!title) { msg.textContent = "Please enter a survey title."; return; }
  if (questions.length === 0) { msg.textContent = "Add at least one question."; return; }

  const btn = document.getElementById("createBtn");
  btn.disabled = true; btn.classList.add("loading");

  try {
    await addDoc(collection(db, "surveys"), {
      title, frequency, desc, questions,
      status:    "active",
      createdAt: new Date().toISOString(),
      period:    currentPeriod(frequency)
    });

    msg.className = "message success";
    msg.textContent = "Survey published!";

    // Reset form
    document.getElementById("surveyTitle").value = "";
    document.getElementById("surveyDesc").value  = "";
    document.getElementById("questionsList").innerHTML = "";
    questionCount = 0;
    addQuestion();

    loadSurveys();
  } catch (e) {
    msg.textContent = "Failed to create survey: " + e.message;
  }
  btn.disabled = false; btn.classList.remove("loading");
});

// ── Load surveys ──────────────────────────────────────────────────────────────
async function loadSurveys() {
  const snap = await getDocs(collection(db, "surveys"));
  surveys = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  renderSurveysTable();
  populatePicker();
}

function renderSurveysTable() {
  const tbody = document.getElementById("surveys-body");
  if (surveys.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">📋</div>No surveys yet. Create one above.</div></td></tr>`;
    return;
  }
  tbody.innerHTML = surveys.map(s => `
    <tr>
      <td><strong>${s.title}</strong>${s.desc ? `<br><span style="color:var(--muted);font-size:0.8rem">${s.desc}</span>` : ""}</td>
      <td><span class="badge badge-active">${capitalize(s.frequency)}</span></td>
      <td>${s.questions?.length || 0} questions</td>
      <td>${s.createdAt ? new Date(s.createdAt).toLocaleDateString() : "—"}</td>
      <td>${s.status === "active"
        ? `<span class="badge badge-active">Active</span>`
        : `<span class="badge badge-pending">Closed</span>`}</td>
      <td>
        ${s.status === "active"
          ? `<button class="action-btn btn-reject" onclick="closeSurvey('${s.id}')">Close</button>`
          : `<button class="action-btn btn-approve" onclick="reopenSurvey('${s.id}')">Reopen</button>`}
        <button class="action-btn btn-delete" onclick="deleteSurvey('${s.id}')">Delete</button>
      </td>
    </tr>
  `).join("");
}

function populatePicker() {
  const picker = document.getElementById("resultsSurveyPicker");
  const current = picker.value;
  picker.innerHTML = `<option value="">— choose a survey —</option>` +
    surveys.map(s => `<option value="${s.id}" ${s.id === current ? "selected" : ""}>${s.title} (${capitalize(s.frequency)})</option>`).join("");
}

// ── Survey actions ────────────────────────────────────────────────────────────
window.closeSurvey = async (id) => {
  await updateDoc(doc(db, "surveys", id), { status: "closed" });
  showToast("Survey closed.");
  loadSurveys();
};

window.reopenSurvey = async (id) => {
  await updateDoc(doc(db, "surveys", id), { status: "active", period: currentPeriod() });
  showToast("Survey reopened.");
  loadSurveys();
};

window.deleteSurvey = async (id) => {
  if (!confirm("Delete this survey and all its responses?")) return;
  await deleteDoc(doc(db, "surveys", id));
  showToast("Survey deleted.");
  loadSurveys();
};

// ── Results & Charts ──────────────────────────────────────────────────────────
window.loadResults = async function () {
  const surveyId = document.getElementById("resultsSurveyPicker").value;
  const area     = document.getElementById("resultsArea");
  if (!surveyId) {
    area.innerHTML = `<div class="empty-state"><div class="empty-icon">📊</div>Select a survey to see results.</div>`;
    return;
  }

  area.innerHTML = `<div class="empty-state">Loading responses…</div>`;

  // Destroy old charts
  Object.values(chartInstances).forEach(c => c.destroy());
  chartInstances = {};

  const survey = surveys.find(s => s.id === surveyId);
  if (!survey) return;

  // Load all responses for this survey
  const respSnap = await getDocs(query(
    collection(db, "responses"),
    where("surveyId", "==", surveyId)
  ));
  const responses = respSnap.docs.map(d => d.data());

  if (responses.length === 0) {
    area.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div>No responses yet.</div>`;
    return;
  }

  // Build charts per question
  area.innerHTML = `
    <p style="color:var(--muted);font-size:0.875rem;margin-bottom:20px;">
      ${responses.length} response${responses.length !== 1 ? "s" : ""} collected
    </p>
    ${survey.questions.map((q, i) => `
      <div class="chart-card">
        <h3>Q${i + 1}: ${q.text}</h3>
        ${q.type === "text"
          ? `<div id="text-answers-${i}" class="text-answers-list"></div>`
          : `<div class="chart-wrap"><canvas id="chart-${i}"></canvas></div>`}
      </div>
    `).join("")}
  `;

  // Render each question
  survey.questions.forEach((q, i) => {
    const answers = responses.map(r => r.answers?.[i]).filter(a => a !== undefined && a !== "");

    if (q.type === "text") {
      const el = document.getElementById(`text-answers-${i}`);
      el.innerHTML = answers.length === 0
        ? `<p style="color:var(--muted);font-size:0.875rem;">No text answers yet.</p>`
        : answers.map(a => `
            <div style="padding:10px 14px;background:#fafaf9;border-radius:8px;font-size:0.875rem;margin-bottom:8px;border:1px solid var(--border)">
              "${a}"
            </div>`).join("");
      return;
    }

    const ctx = document.getElementById(`chart-${i}`).getContext("2d");

    if (q.type === "rating") {
      // Count 1–5
      const counts = [1,2,3,4,5].map(v => answers.filter(a => Number(a) === v).length);
      chartInstances[i] = new Chart(ctx, {
        type: "bar",
        data: {
          labels: ["1 ★", "2 ★", "3 ★", "4 ★", "5 ★"],
          datasets: [{
            label: "Responses",
            data: counts,
            backgroundColor: ["#fee2e2","#fef9c3","#e0e7ff","#dcfce7","#bbf7d0"],
            borderRadius: 6,
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
        }
      });
    }

    if (q.type === "yesno") {
      const yes = answers.filter(a => a === "Yes").length;
      const no  = answers.filter(a => a === "No").length;
      chartInstances[i] = new Chart(ctx, {
        type: "doughnut",
        data: {
          labels: ["Yes", "No"],
          datasets: [{
            data: [yes, no],
            backgroundColor: ["#dcfce7", "#fee2e2"],
            borderColor: ["#166534", "#991b1b"],
            borderWidth: 1.5
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: "bottom" } }
        }
      });
    }
  });
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function currentPeriod(frequency) {
  const now = new Date();
  if (frequency === "weekly") {
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    return `week-${start.toISOString().split("T")[0]}`;
  }
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function capitalize(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function showToast(msg, error = false) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.className   = "toast" + (error ? " error" : "");
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

window.switchTab = function (tab) {
  ["create", "results"].forEach(t => {
    document.getElementById(`tab-${t}`).style.display = t === tab ? "block" : "none";
    document.querySelector(`[data-tab="${t}"]`).classList.toggle("active", t === tab);
  });
  if (tab === "results") populatePicker();
};

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "login.html";
});
