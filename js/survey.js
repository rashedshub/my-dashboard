import { app } from "./firebase.js";
import {
  getAuth, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  getFirestore,
  collection, getDocs, addDoc, query, where, doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const auth = getAuth(app);
const db   = getFirestore(app);
let currentUser = null;

// ── Auth guard ────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  currentUser = user;
  document.getElementById("topbarEmail").textContent = user.email;
  loadSurveys();
});

// ── Load active surveys ───────────────────────────────────────────────────────
async function loadSurveys() {
  const area = document.getElementById("surveysArea");

  const surveySnap = await getDocs(query(
    collection(db, "surveys"),
    where("status", "==", "active")
  ));
  const surveys = surveySnap.docs.map(d => ({ id: d.id, ...d.data() }));

  if (surveys.length === 0) {
    area.innerHTML = `<div class="empty-state"><div class="empty-icon">✅</div>No active surveys right now.</div>`;
    return;
  }

  // Check which ones this user has already answered this period
  const respSnap = await getDocs(query(
    collection(db, "responses"),
    where("userId", "==", currentUser.uid)
  ));
  const answered = new Set(respSnap.docs.map(d => d.data().surveyId + "_" + d.data().period));

  area.innerHTML = "";
  surveys.forEach(survey => {
    const key       = survey.id + "_" + survey.period;
    const submitted = answered.has(key);
    area.appendChild(renderSurveyCard(survey, submitted));
  });
}

// ── Render survey card ────────────────────────────────────────────────────────
function renderSurveyCard(survey, submitted) {
  const card = document.createElement("div");
  card.className = "survey-card";
  card.id = `survey-${survey.id}`;

  if (submitted) {
    card.innerHTML = `
      <h3>${survey.title}</h3>
      <p class="meta">${capitalize(survey.frequency)} survey${survey.desc ? " · " + survey.desc : ""}</p>
      <div class="survey-submitted">
        <div class="check">✅</div>
        You've already submitted this survey for the current period.
      </div>
    `;
    return card;
  }

  const answers = {}; // questionIndex → answer

  card.innerHTML = `
    <h3>${survey.title}</h3>
    <p class="meta">${capitalize(survey.frequency)} survey${survey.desc ? " · " + survey.desc : ""}</p>
    ${survey.questions.map((q, i) => `
      <div class="question-block" id="${survey.id}-q${i}">
        <div class="q-text">Q${i + 1}. ${q.text}</div>
        ${renderQuestionInput(survey.id, i, q)}
      </div>
    `).join("")}
    <button class="btn" id="submit-${survey.id}" style="margin-top:8px;">
      <span class="btn-label">Submit</span>
      <span class="spinner"></span>
    </button>
    <p class="message" id="msg-${survey.id}"></p>
  `;

  // Attach answer listeners after rendering
  setTimeout(() => {
    survey.questions.forEach((q, i) => {
      if (q.type === "rating") {
        card.querySelectorAll(`[data-survey="${survey.id}"][data-q="${i}"]`).forEach(btn => {
          btn.addEventListener("click", () => {
            card.querySelectorAll(`[data-survey="${survey.id}"][data-q="${i}"]`).forEach(b => b.classList.remove("selected"));
            btn.classList.add("selected");
            answers[i] = btn.dataset.val;
          });
        });
      } else if (q.type === "yesno") {
        card.querySelectorAll(`[data-survey="${survey.id}"][data-q="${i}"]`).forEach(btn => {
          btn.addEventListener("click", () => {
            card.querySelectorAll(`[data-survey="${survey.id}"][data-q="${i}"]`).forEach(b => b.classList.remove("selected"));
            btn.classList.add("selected");
            answers[i] = btn.dataset.val;
          });
        });
      } else {
        const ta = card.querySelector(`#text-${survey.id}-${i}`);
        if (ta) ta.addEventListener("input", () => { answers[i] = ta.value; });
      }
    });

    const submitBtn = card.querySelector(`#submit-${survey.id}`);
    submitBtn.addEventListener("click", () => submitSurvey(survey, answers, card));
  }, 0);

  return card;
}

function renderQuestionInput(surveyId, i, q) {
  if (q.type === "rating") {
    return `<div class="rating-row">
      ${[1,2,3,4,5].map(v => `<button class="rating-btn" data-survey="${surveyId}" data-q="${i}" data-val="${v}">${v}</button>`).join("")}
    </div>`;
  }
  if (q.type === "yesno") {
    return `<div class="yesno-row">
      <button class="yesno-btn" data-survey="${surveyId}" data-q="${i}" data-val="Yes">Yes</button>
      <button class="yesno-btn" data-survey="${surveyId}" data-q="${i}" data-val="No">No</button>
    </div>`;
  }
  return `<textarea class="text-answer" id="text-${surveyId}-${i}" placeholder="Your answer…"></textarea>`;
}

// ── Submit survey ─────────────────────────────────────────────────────────────
async function submitSurvey(survey, answers, card) {
  const btn = card.querySelector(`#submit-${survey.id}`);
  const msg = card.querySelector(`#msg-${survey.id}`);
  msg.className = "message"; msg.textContent = "";

  // Validate all answered
  for (let i = 0; i < survey.questions.length; i++) {
    if (answers[i] === undefined || answers[i] === "") {
      msg.textContent = `Please answer question ${i + 1}.`;
      return;
    }
  }

  btn.disabled = true; btn.classList.add("loading");

  try {
    // Get user profile for name
    const userSnap = await getDoc(doc(db, "users", currentUser.uid));
    const userName = userSnap.exists() ? userSnap.data().name : currentUser.email;

    await addDoc(collection(db, "responses"), {
      surveyId:    survey.id,
      surveyTitle: survey.title,
      userId:      currentUser.uid,
      userName,
      userEmail:   currentUser.email,
      answers:     Object.values(answers),
      period:      survey.period,
      frequency:   survey.frequency,
      submittedAt: new Date().toISOString()
    });

    // Show submitted state
    const submitArea = card.querySelector(`#submit-${survey.id}`).parentNode;
    card.querySelector(".survey-card > *:last-child")?.remove();
    card.innerHTML = `
      <h3>${survey.title}</h3>
      <p class="meta">${capitalize(survey.frequency)} survey${survey.desc ? " · " + survey.desc : ""}</p>
      <div class="survey-submitted">
        <div class="check">✅</div>
        Thank you! Your response has been recorded.
      </div>
    `;
    showToast("Survey submitted ✓");
  } catch (e) {
    msg.textContent = "Failed to submit: " + e.message;
    btn.disabled = false; btn.classList.remove("loading");
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
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

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "login.html";
});
