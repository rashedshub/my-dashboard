import { app } from "./firebase.js";
import {
  getAuth,
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const auth = getAuth(app);
const db   = getFirestore(app);
const btn  = document.getElementById("loginBtn");
const msg  = document.getElementById("message");

// Check for ?redirect= param
const redirectTo = new URLSearchParams(window.location.search).get("redirect") || null;

function setLoading(on) {
  btn.disabled = on;
  btn.classList.toggle("loading", on);
}

function friendlyError(code) {
  const map = {
    "auth/invalid-email":          "That email address isn't valid.",
    "auth/user-not-found":         "No account found with that email.",
    "auth/wrong-password":         "Incorrect password. Try again.",
    "auth/invalid-credential":     "Incorrect email or password. Try again.",
    "auth/too-many-requests":      "Too many attempts. Please wait a moment.",
    "auth/network-request-failed": "Network error. Check your connection.",
  };
  return map[code] || "Something went wrong. Please try again.";
}

async function login() {
  const email    = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  msg.className   = "message";
  msg.textContent = "";

  if (!email || !password) {
    msg.textContent = "Please enter your email and password.";
    return;
  }

  setLoading(true);
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Check role
    const snap = await getDoc(doc(db, "users", user.uid));
    const role = snap.exists() ? snap.data().role : "user";

    msg.className   = "message success";
    msg.textContent = "Signed in — redirecting…";

    setTimeout(() => {
      if (redirectTo) {
        window.location.href = redirectTo;
      } else {
        window.location.href = role === "admin" ? "admin.html" : "dashboard.html";
      }
    }, 600);

  } catch (error) {
    msg.textContent = friendlyError(error.code);
    setLoading(false);
  }
}

document.getElementById("loginBtn").addEventListener("click", login);
