import { app } from "./firebase.js";
import {
  getAuth,
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

const auth = getAuth(app);

window.login = async function () {
  const email    = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const message  = document.getElementById("message");

  message.innerHTML = "";

  if (email === "" || password === "") {
    message.innerHTML = "Please enter email and password.";
    return;
  }

  try {
    const userCredential = await signInWithEmailAndPassword(
      auth,
      email,
      password
    );
    const user = userCredential.user;
    alert("Login Successful!");
    window.location.href = "dashboard.html";
  } catch (error) {
    message.innerHTML = error.message;
  }
};
