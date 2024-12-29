// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyB6XFbwflmcP_t0mAfwPfvptKrUZtk_PoY",
  authDomain: "edusign-d5abd.firebaseapp.com",
  projectId: "edusign-d5abd",
  storageBucket: "edusign-d5abd.appspot.com",
  messagingSenderId: "281754644754",
  appId: "1:281754644754:web:d9018c8c85cc23887dcceb",
}; // Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// DOM Elements
const loginSection = document.getElementById("loginSection");
const dashboardSection = document.getElementById("dashboardSection");
const loginForm = document.getElementById("loginForm");
const teacherName = document.getElementById("teacherName");
const coursesList = document.getElementById("coursesList");
const logoutButton = document.getElementById("logout");
const docusignAuthButton = document.getElementById("docusignAuth");
const loginToggle = document.getElementById("loginToggle");
const signupToggle = document.getElementById("signupToggle");

// Canvas Modal Elements
const canvasAuthBtn = document.getElementById("canvasAuthBtn");
const canvasTokenModal = document.getElementById("canvasTokenModal");
const canvasTokenForm = document.getElementById("canvasTokenForm");
const cancelCanvasToken = document.getElementById("cancelCanvasToken");

// Auth toggle functionality
loginToggle.addEventListener("click", () => {
  loginToggle.classList.add("active");
  signupToggle.classList.remove("active");
  updateFormFields("login");
});

signupToggle.addEventListener("click", () => {
  signupToggle.classList.add("active");
  loginToggle.classList.remove("active");
  updateFormFields("signup");
});

function updateFormFields(mode) {
  const loginForm = document.getElementById("loginForm");
  const submitBtn = loginForm.querySelector('button[type="submit"] span');

  if (mode === "signup") {
    // Add name field if it doesn't exist
    if (!document.getElementById("name")) {
      const nameGroup = document.createElement("div");
      nameGroup.className = "input-group";
      nameGroup.innerHTML = `
                <input type="text" id="name" required autocomplete="name">
                <label for="name">Full Name</label>
                <div class="input-highlight"></div>
            `;
      loginForm.insertBefore(nameGroup, loginForm.firstChild);
    }
    submitBtn.textContent = "Sign Up";
  } else {
    // Remove name field if it exists
    const nameField = document.getElementById("name");
    if (nameField) {
      nameField.parentElement.remove();
    }
    submitBtn.textContent = "Login";
  }

  // Clear form fields
  loginForm.reset();

  // Animate new fields
  const inputs = loginForm.querySelectorAll(".input-group");
  inputs.forEach((input, index) => {
    window.appAnimations?.animateFormField?.(input, index);
  });
}

// Login form submission
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  const name = document.getElementById("name")?.value;
  const button = loginForm.querySelector("button");
  const isSignup = signupToggle.classList.contains("active");

  try {
    window.appAnimations?.toggleLoadingButton?.(button, true);

    if (isSignup) {
      // Create new user
      const userCredential = await auth.createUserWithEmailAndPassword(
        email,
        password
      );

      // Add user to Firestore with additional details
      await db.collection("teachers").doc(userCredential.user.uid).set({
        name: name,
        email: email,
        courses: [],
        created_at: firebase.firestore.FieldValue.serverTimestamp(),
      });

      window.appAnimations?.showNotification?.(
        "Account created successfully!",
        "success"
      );
    } else {
      // Regular login
      await auth.signInWithEmailAndPassword(email, password);
      window.appAnimations?.showNotification?.(
        "Successfully logged in!",
        "success"
      );
    }
  } catch (error) {
    window.appAnimations?.showNotification?.(error.message, "error");
  } finally {
    window.appAnimations?.toggleLoadingButton?.(button, false);
  }
});

// Canvas Modal Handlers
canvasAuthBtn.addEventListener("click", () => {
  canvasTokenModal.classList.remove("hidden");
});

cancelCanvasToken.addEventListener("click", () => {
  canvasTokenModal.classList.add("hidden");
  canvasTokenForm.reset();
});

// Close modal when clicking outside
canvasTokenModal.addEventListener("click", (e) => {
  if (e.target === canvasTokenModal) {
    canvasTokenModal.classList.add("hidden");
    canvasTokenForm.reset();
  }
});

// Handle token submission
canvasTokenForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const token = document.getElementById("canvasToken").value.trim();
  const submitButton = canvasTokenForm.querySelector('button[type="submit"]');

  try {
    window.appAnimations?.toggleLoadingButton?.(submitButton, true);

    // Save token through our backend
    const response = await fetch("/api/canvas/save-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token: token,
        teacherId: auth.currentUser.uid,
      }),
    });

    if (!response.ok) {
      throw new Error("Invalid Canvas token");
    }

    const result = await response.json();

    // Close modal and show success message
    canvasTokenModal.classList.add("hidden");
    canvasTokenForm.reset();
    window.appAnimations?.showNotification?.(
      "Successfully connected to Canvas!",
      "success"
    );

    // Reload courses in UI
    await loadCourses(auth.currentUser.uid);
  } catch (error) {
    console.error("Canvas error:", error);
    window.appAnimations?.showNotification?.(error.message, "error");
  } finally {
    window.appAnimations?.toggleLoadingButton?.(submitButton, false);
  }
});

// Add this with your other DOM element selections at the top
const refreshCoursesBtn = document.getElementById("refreshCoursesBtn");

// Add this refresh function
async function refreshCourses() {
  try {
    const teacherDoc = await db
      .collection("teachers")
      .doc(auth.currentUser.uid)
      .get();
    const token = teacherDoc.data()?.canvas_access_token;

    if (!token) {
      window.appAnimations?.showNotification?.(
        "Please connect Canvas first",
        "error"
      );
      return;
    }

    const refreshBtn = document.getElementById("refreshCoursesBtn");
    // Add spinning animation to icon
    refreshBtn.classList.add("spinning");

    // Call backend to refresh courses
    const response = await fetch("/api/canvas/save-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token: token,
        teacherId: auth.currentUser.uid,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to refresh courses");
    }

    // Reload courses in UI
    await loadCourses(auth.currentUser.uid);
    window.appAnimations?.showNotification?.(
      "Courses refreshed successfully!",
      "success"
    );
  } catch (error) {
    console.error("Refresh error:", error);
    window.appAnimations?.showNotification?.(
      "Error refreshing courses: " + error.message,
      "error"
    );
  } finally {
    // Remove spinning animation
    refreshBtn.classList.remove("spinning");
  }
}

// Add event listener for refresh button
refreshCoursesBtn.addEventListener("click", refreshCourses);

// Load Canvas courses
// Update the loadCourses function in app.js
// Update the loadCourses function in app.js
async function loadCourses(teacherId) {
  try {
    const teacherDoc = await db.collection("teachers").doc(teacherId).get();
    const coursesList = document.getElementById("coursesList");

    if (!teacherDoc.exists) {
      throw new Error("Teacher not found");
    }

    const teacherData = teacherDoc.data();

    // Check if courses exists, if not set to empty array
    const courses = teacherData?.courses || [];

    // Debug log to see what we're getting
    console.log("Courses data:", courses);

    if (!courses || courses.length === 0) {
      coursesList.innerHTML = `
                <div class="empty-state">
                    <p>No courses found. Connect your Canvas account to see your courses.</p>
                </div>
            `;
      return;
    }

    coursesList.innerHTML = courses
      .map(
        (course) => `
            <div class="course-card">
                <h4>${course.name}</h4>
                <div class="course-info">
                    <span class="course-code">${course.course_code || ""}</span>
                    <span class="student-count">${
                      course.students?.length || 0
                    } students</span>
                </div>

                <div class="students-section">
                    <button onclick="toggleStudentsList('${
                      course.id
                    }')" class="view-students-btn">
                        View Students (${course.students?.length || 0})
                    </button>
                    
                    <div id="students-${
                      course.id
                    }" class="students-list hidden">
                        ${(course.students || [])
                          .map(
                            (student) => `
                            <div class="student-item">
                                <div class="student-info">
                                    ${
                                      student.avatar_url
                                        ? `<img src="${student.avatar_url}" alt="${student.name}" class="student-avatar"/>`
                                        : '<div class="student-avatar-placeholder"></div>'
                                    }
                                    <div class="student-details">
                                        <div class="student-name">${
                                          student.name || "Unnamed Student"
                                        }</div>
                                        <div class="student-email">${
                                          student.email_pattern || "No email"
                                        }</div>
                                    </div>
                                </div>
                            </div>
                        `
                          )
                          .join("")}
                    </div>
                </div>

                <div class="file-upload">
                    <input 
                        type="file" 
                        id="file-${course.id}" 
                        class="hidden"
                        accept=".pdf,.doc,.docx"
                        onchange="handleFileSelect(event, '${course.id}', '${
          course.name
        }')"
                    >
                    <label for="file-${course.id}" class="file-upload-button">
                        Upload Permission Slip
                    </label>
                </div>
            </div>
        `
      )
      .join("");

    window.appAnimations?.animateCourseCards?.();
  } catch (error) {
    console.error("Detailed error:", error);
    window.appAnimations?.showNotification?.(
      "Error loading courses: " + error.message,
      "error"
    );
  }
}
function toggleStudentsList(courseId) {
  const studentsList = document.getElementById(`students-${courseId}`);
  if (studentsList.classList.contains("hidden")) {
    studentsList.classList.remove("hidden");
    window.appAnimations?.animateStudentsList?.(studentsList);
  } else {
    studentsList.classList.add("hidden");
  }
}
window.toggleStudentsList = toggleStudentsList;

// Add this function to toggle students list visibility
function toggleStudentsList(courseId) {
  const studentsList = document.getElementById(`students-${courseId}`);
  if (studentsList.classList.contains("hidden")) {
    studentsList.classList.remove("hidden");
    window.appAnimations?.animateStudentsList?.(studentsList);
  } else {
    studentsList.classList.add("hidden");
  }
}

// Make it available globally
window.toggleStudentsList = toggleStudentsList;
// File upload handling
async function handleFileSelect(event, courseId, courseName) {
  const file = event.target.files[0];
  if (!file) return;

  const fileLabel = event.target.nextElementSibling;

  try {
    window.appAnimations?.toggleLoadingButton?.(fileLabel, true);

    // 1. Upload file to Firebase Storage
    const storageRef = storage.ref();
    const fileRef = storageRef.child(
      `permission_slips/${auth.currentUser.uid}/${courseId}/${file.name}`
    );
    await fileRef.put(file);
    const fileUrl = await fileRef.getDownloadURL();

    // 2. Create document in Firestore
    const docRef = await db.collection("documents").add({
      course_name: courseName,
      file: fileUrl,
      teacher_id: auth.currentUser.uid,
      recipients: [],
      created_at: firebase.firestore.FieldValue.serverTimestamp(),
    });

    window.appAnimations?.showNotification?.(
      "File uploaded successfully!",
      "success"
    );

    // 3. Redirect to DocuSign auth
    window.location.href = `/api/teacher-auth?teacher_id=${auth.currentUser.uid}`;

    return docRef.id;
  } catch (error) {
    console.error("Error uploading file:", error);
    window.appAnimations?.showNotification?.(error.message, "error");
  } finally {
    window.appAnimations?.toggleLoadingButton?.(fileLabel, false);
  }
}

// Auth state observer
auth.onAuthStateChanged(async (user) => {
  if (user) {
    loginSection.classList.add("hidden");
    dashboardSection.classList.remove("hidden");
    teacherName.textContent = user.email;
    await loadCourses(user.uid);
    window.appAnimations?.animateDashboard?.();
  } else {
    loginSection.classList.remove("hidden");
    dashboardSection.classList.add("hidden");
  }
});

// Logout handler
logoutButton.addEventListener("click", async () => {
  try {
    await auth.signOut();
    window.appAnimations?.showNotification?.(
      "Successfully logged out!",
      "success"
    );
  } catch (error) {
    window.appAnimations?.showNotification?.(error.message, "error");
  }
});

// Make handleFileSelect available globally
window.handleFileSelect = handleFileSelect;
