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

window.signup = async function () {
  const name       = document.getElementById("name").value.trim();
  const employeeId = document.getElementById("employeeId").value.trim();
  const email      = document.getElementById("email").value.trim();
  const password   = document.getElementById("password").value;
  const message    = document.getElementById("message");

  message.innerHTML = "";

  // Basic validation
  if (!name || !employeeId || !email || !password) {
    message.innerHTML = "Please fill in all fields.";
    return;
  }

  if (password.length < 6) {
    message.innerHTML = "Password must be at least 6 characters.";
    return;
  }

  try {
    // Create user in Firebase Authentication
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );
    const user = userCredential.user;

    // Save additional info in Firestore
    await setDoc(doc(db, "users", user.uid), {
      uid:       user.uid,
      name:      name,
      employeeId: employeeId,
      email:     email,
      role:      "user",
      status:    "pending",
      createdAt: new Date().toISOString()
    });

    alert("Registration Successful!");
    window.location.href = "login.html";

  } catch (error) {
    message.innerHTML = error.message;
  }
};
