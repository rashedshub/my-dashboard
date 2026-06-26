import { app } from "./firebase.js";
import {
  getAuth,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const auth = getAuth(app);
const db   = getFirestore(app);
const btn  = document.getElementById("signupBtn");
const msg  = document.getElementById("message");

function setLoading(on) {
  btn.disabled = on;
  btn.classList.toggle("loading", on);
}

function friendlyError(code) {
  const map = {
    "auth/email-already-in-use":   "An account with this email already exists.",
    "auth/invalid-email":          "That email address isn't valid.",
    "auth/weak-password":          "Password is too weak. Use at least 8 characters.",
    "auth/network-request-failed": "Network error. Check your connection.",
  };
  return map[code] || "Something went wrong. Please try again.";
}

async function signup() {
  const name       = document.getElementById("name").value.trim();
  const employeeId = document.getElementById("employeeId").value.trim();
  const email      = document.getElementById("email").value.trim();
  const password   = document.getElementById("password").value;

  msg.className   = "message";
  msg.textContent = "";

  if (!name || !employeeId || !email || !password) {
    msg.textContent = "Please fill in all fields.";
    return;
  }
  if (password.length < 8) {
    msg.textContent = "Password must be at least 8 characters.";
    return;
  }

  setLoading(true);
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    await setDoc(doc(db, "users", user.uid), {
      uid:        user.uid,
      name,
      employeeId,
      email,
      role:       "user",
      status:     "pending",
      createdAt:  new Date().toISOString()
    });

    msg.className   = "message success";
    msg.textContent = "Account created! Redirecting to login…";
    setTimeout(() => window.location.href = "login.html", 1000);

  } catch (error) {
    msg.textContent = friendlyError(error.code);
    setLoading(false);
  }
}

// Attach event listener (works correctly with ES modules)
btn.addEventListener("click", signup);
