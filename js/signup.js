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
const db = getFirestore(app);

window.signup = async function () {

  const name = document.getElementById("name").value;
  const employeeId = document.getElementById("employeeId").value;
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  try {

    // Create user in Firebase Authentication
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );

    const user = userCredential.user;

    // Save additional user information in Firestore
    await setDoc(doc(db, "users", user.uid), {
      uid: user.uid,
      name: name,
      employeeId: employeeId,
      email: email,
      role: "user",
      status: "pending",
      createdAt: new Date().toISOString()
    });

    alert("Registration Successful!");

  } catch (error) {
    alert(error.message);
  }

};
