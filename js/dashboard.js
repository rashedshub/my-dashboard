import { app } from "./firebase.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const auth = getAuth(app);
const db   = getFirestore(app);

// Guard: redirect to login if not signed in
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  document.getElementById("topbarEmail").textContent = user.email;

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) {
      const d = snap.data();

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
        ? new Date(d.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
        : "—";
    }
  } catch (e) {
    console.error("Failed to load profile:", e);
  }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "login.html";
});

function capitalize(str) {
  if (!str) return "—";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function badgeHTML(status) {
  const cls = status === "active" ? "badge-active" : "badge-pending";
  return `<span class="badge ${cls}">${capitalize(status || "pending")}</span>`;
}
