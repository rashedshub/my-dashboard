import { app }
from "./firebase.js";

import {
 getAuth,
 createUserWithEmailAndPassword
}
from
"https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

const auth =
getAuth(app);

window.signup =
async function() {

 const email =
 document.getElementById("email").value;

 const password =
 document.getElementById("password").value;

 try {

 await createUserWithEmailAndPassword(
 auth,
 email,
 password
 );

 alert("Registration Successful");

 } catch(error){

  import { app } from "./firebase.js";

import {
 getAuth,
 createUserWithEmailAndPassword
}
from
"https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import {
 getFirestore,
 doc,
 setDoc
}
from
"https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

 alert(error.message);

 }

}
