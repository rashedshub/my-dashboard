import { app } from "./firebase.js";
import {
  getAuth,
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

const auth = getAuth(app);
const btn  = document.getElementById("loginBtn");
const msg  = document.getElementById("message");

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
    await signInWithEmailAndPassword(auth, email, password);
    msg.className   = "message success";
    msg.textContent = "Signed in — redirecting…";
    setTimeout(() => window.location.href = "dashboard.html", 600);

  } catch (error) {
    msg.textContent = friendlyError(error.code);
    setLoading(false);
  }
}

btn.addEventListener("click", login);
