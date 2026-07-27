import { app } from "./firebase.js";
import { getAuth, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { getFirestore, doc, getDoc }
  from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const auth = getAuth(app);
const db   = getFirestore(app);

export function guardRole(allowedRoles = [], redirectTo = "dashboard.html") {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) { window.location.href = "login.html"; return; }
      try {
        const snap    = await getDoc(doc(db, "users", user.uid));
        const profile = snap.exists() ? snap.data() : {};
        const role    = profile.role || "user";
        if (allowedRoles.length > 0 && !allowedRoles.includes(role)) {
          showDenied(role, allowedRoles, redirectTo);
          return;
        }
        resolve({ user, profile });
      } catch(e) {
        console.error("Guard error:", e);
        window.location.href = "login.html";
      }
    });
  });
}

function showDenied(role, required, redirectTo) {
  document.body.innerHTML = `
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'Inter',system-ui,sans-serif;background:#F0F2F5;display:flex;align-items:center;justify-content:center;min-height:100vh;}
      .card{background:#fff;border-radius:14px;border:1px solid #DDE1E7;padding:48px 40px;text-align:center;max-width:400px;width:100%;margin:20px;}
      .icon{font-size:2.8rem;margin-bottom:16px}
      h2{font-size:1.1rem;font-weight:700;color:#0F1923;margin-bottom:8px}
      p{font-size:0.875rem;color:#64748B;line-height:1.6;margin-bottom:24px}
      a{display:inline-block;padding:10px 24px;background:#1E3A5F;color:#fff;border-radius:8px;font-family:inherit;font-size:0.875rem;font-weight:600;text-decoration:none}
    </style>
    <div class="card">
      <div class="icon">🔒</div>
      <h2>Access Restricted</h2>
      <p>Your role (<strong>${role}</strong>) cannot access this page.<br>
      Required: <strong>${required.join(" or ")}</strong>.<br><br>
      Contact your admin to request access. Redirecting in 4 seconds…</p>
      <a href="${redirectTo}">← Go Back</a>
    </div>`;
  setTimeout(() => window.location.href = redirectTo, 4000);
}
