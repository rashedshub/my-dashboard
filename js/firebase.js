import { initializeApp }
from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";

const firebaseConfig = {
  apiKey: "AIzaSyB-ECqcB2CYmZ4NH2ikmMvfA2CxJ6d7uKA",
  authDomain: "my-dashboard-aeb7f.firebaseapp.com",
  projectId: "my-dashboard-aeb7f",
  storageBucket: "my-dashboard-aeb7f.firebasestorage.app",
  messagingSenderId: "374310408419",
  appId: "1:374310408419:web:05381fafc5e0c4e77bb5d6"
};

const app =
initializeApp(firebaseConfig);

export { app };
