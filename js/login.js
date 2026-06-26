try {
  const userCredential = await createUserWithEmailAndPassword(
    auth,
    email,
    password
  );
  const user = userCredential.user;

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
  window.location.href = "login.html"; // ← add this
} catch (error) {
  alert(error.message);
}
