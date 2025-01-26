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

// Initialize the app
let currentUploadData = null;

document.addEventListener("DOMContentLoaded", function () {
  // DOM Elements
  const loginSection = document.getElementById("loginSection");
  const dashboardSection = document.getElementById("dashboardSection");
  const loginForm = document.getElementById("loginForm");
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
  const docusignAuthBtn = document.getElementById("docusignAuthBtn")

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

  docusignAuthBtn.addEventListener("click", () => {
    window.location.href = `/api/teacher-auth?teacher_id=${auth.currentUser.uid}`
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

  async function fetchCourseDocuments(courseId) {
    try {
      const querySnapshot = await db
        .collection("documents")
        .where("course_id", "==", courseId)
        .get();

      return querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
    } catch (error) {
      console.error("Error fetching documents:", error);
      return [];
    }
  }

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
      const courses = teacherData?.courses || [];

      if (!courses || courses.length === 0) {
        coursesList.innerHTML = `
        <div class="empty-state">
          <p>No courses found. Connect your Canvas account to see your courses.</p>
        </div>
      `;
      }

      const coursesHtml = await Promise.all(
        courses.map(async (course) => {
          // Fetch documents for this course
          const documents = await fetchCourseDocuments(course.id);

          // Update the status icons part in loadCourses function
          const documentsHtml = documents.map((doc) => {
            const totalStudents = doc.docusign_envelopes?.length || 0;
            const totalPayments = doc.docusign_envelopes?.reduce((acc, envelope) => {
              return envelope.hasDonated ? acc + 1 : acc;
            }, 0);
          
            const paymentPercentage = (totalPayments / totalStudents) * 100;
          
            const documentStatusHtml = `
              <div class="document-status">
                <div class="document-info">
                  <span class="document-name">${doc.file_name}</span>
                  <span class="document-due-date">Due: ${new Date(
                    doc.due_date?.toDate()
                  ).toLocaleDateString()}</span>
                </div>
                ${
                  doc.donationAmount > 0
                    ? `
                    <div class="payment-progress">
                      <span>${totalPayments} / ${totalStudents} students paid</span>
                      <div class="progress-bar">
                        <div class="progress" style="width: ${paymentPercentage}%"></div>
                      </div>
                    </div>
                    `
                    : ""
                }
                <div class="signing-status">
                  ${
                    doc.docusign_envelopes
                      ?.map((envelope) => {
                        return `
                          <div class="student-signing-status">
                            <span class="student-name">${envelope.name}</span>
                            <div class="status-icons">
                              <div class="status-icon" title="Student signature">
                                ${
                                  envelope.studentHasSigned
                                    ? `<svg class="checkmark" viewBox="0 0 24 24" width="16" height="16"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>`
                                    : `<svg class="cross" viewBox="0 0 24 24" width="16" height="16"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`
                                }
                                <span>Student</span>
                              </div>
                              <div class="status-icon" title="Parent signature">
                                ${
                                  envelope.parentHasSigned
                                    ? `<svg class="checkmark" viewBox="0 0 24 24" width="16" height="16"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>`
                                    : `<svg class="cross" viewBox="0 0 24 24" width="16" height="16"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`
                                }
                                <span>Parent</span>
                              </div>
                            </div>
                          </div>
                        `;
                      })
                      .join("") || ""
                  }
                </div>
              </div>
            `;
          
            return `
              <div class="document-card">
                ${documentStatusHtml}
              </div>
            `;
            }).join("");

            return `
              <div class="course-card">
                <h4>${course.name}</h4>
                <div class="course-info">
                  <span class="student-count">${
                    course.students?.length || 0
                  } students</span>
                </div>

                <div class="documents-section">
                  <h5>Documents</h5>
                  ${documentsHtml}
                </div>

                <div class="file-upload">
                  <div class="upload-form">
                    <input 
                      type="file" 
                      id="file-${course.id}" 
                      class="hidden"
                      accept=".pdf,.doc,.docx"
                      onchange="handleFileSelect(event, '${course.id}', '${course.name}')"
                    >
                    <div class="date-input">
                      <label for="due-date-${course.id}">Due Date:</label>
                      <input 
                        type="date" 
                        id="due-date-${course.id}"
                        min="${new Date().toISOString().split("T")[0]}"
                        required
                      >
                    </div>
                    <!-- Add donation input -->
                    <div class="donation-input">
                      <label for="donation-${course.id}">Payment Amount:</label>
                      <div class="donation-field">
                        <span class="currency-symbol">$</span>
                        <input 
                          type="number" 
                          id="donation-${course.id}"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                        >
                      </div>
                      <small class="donation-help">Leave empty or set to 0 for no required payment</small>
                    </div>
                    <label 
                      for="file-${course.id}" 
                      class="file-upload-button"
                      onclick="handleUploadClick('${course.id}')"
                    >
                      Upload Permission Slip
                    </label>
                  </div>
                </div>
              </div>
            `;
          })
        );

      coursesList.innerHTML = coursesHtml.join("");
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

  function handleUploadClick(courseId) {
    const dueDateInput = document.getElementById(`due-date-${courseId}`);
    if (!dueDateInput.value) {
      window.appAnimations?.showNotification?.(
        "Please select a due date",
        "error"
      );
      return false;
    }
  }

  function cancelUpload() {
    console.log("CANCELLING HEREEEEEE")
    const modal = document.getElementById("uploadConfirmModal");
    modal.classList.add("hidden");
  }

  async function processUpload() {
    if (!currentUploadData) {
      console.log("No upload data found");
      return;
    }

    const confirmButton = document.querySelector(
      "#uploadConfirmModal .primary-button"
    );
    const modal = document.getElementById("uploadConfirmModal");

    try {
      window.appAnimations?.toggleLoadingButton?.(confirmButton, true);

      const formData = new FormData();
      formData.append("file", currentUploadData.file);
      formData.append("courseId", currentUploadData.courseId);
      formData.append("courseName", currentUploadData.courseName);
      formData.append("teacherId", auth.currentUser.uid);
      formData.append("dueDate", currentUploadData.dueDate);
      formData.append(
        "donationAmount",
        currentUploadData.donationAmount.toString()
      ); // Ensure donation amount is included

      console.log(
        "Sending upload request with donation amount:",
        currentUploadData.donationAmount
      );
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Upload failed");
      }

      const result = await response.json();
      console.log("Upload successful:", result);

      // Success notification
      window.appAnimations?.showNotification?.(
        "Permission slip uploaded successfully!",
        "success"
      );

      // Reset form
      const fileInput = document.getElementById(
        `file-${currentUploadData.courseId}`
      );
      const dueDateInput = document.getElementById(
        `due-date-${currentUploadData.courseId}`
      );
      const donationInput = document.getElementById(
        `donation-${currentUploadData.courseId}`
      );

      fileInput.value = "";
      dueDateInput.value = "";
      donationInput.value = "";

      // Hide modal
      modal.classList.add("hidden");

      // Reload the courses to show updated documents
      await loadCourses(auth.currentUser.uid);

      // Redirect to DocuSign auth
      window.location.href = `/api/teacher-auth?teacher_id=${auth.currentUser.uid}`;
    } catch (error) {
      console.error("Error uploading file:", error);
      window.appAnimations?.showNotification?.(error.message, "error");
    } finally {
      window.appAnimations?.toggleLoadingButton?.(confirmButton, false);
      currentUploadData = null;
    }
  }

  window.cancelUpload = cancelUpload
  window.processUpload = processUpload;

  // Add event listeners for the confirmation modal
  document.addEventListener("DOMContentLoaded", () => {
    const modal = document.getElementById("uploadConfirmModal");
    const confirmBtn = document.getElementById("confirmUpload");
    const cancelBtn = document.getElementById("cancelUpload");

    // Confirm button handler
    confirmBtn.addEventListener("click", async () => {
      await processUpload();

      // After successful upload, redirect to DocuSign auth
      if (auth.currentUser) {
        window.location.href = `/api/teacher-auth?teacher_id=${auth.currentUser.uid}`;
      }
    });

    // Cancel button handler
    cancelBtn.addEventListener("click", () => {
      modal.classList.add("hidden");
      if (currentUploadData) {
        const fileInput = document.getElementById(
          `file-${currentUploadData.courseId}`
        );
        const dueDateInput = document.getElementById(
          `due-date-${currentUploadData.courseId}`
        );
        const donationInput = document.getElementById(
          `donation-${currentUploadData.courseId}`
        );

        fileInput.value = "";
        dueDateInput.value = "";
        donationInput.value = "";
        currentUploadData = null;
      }

      console.log("cancel clicked")
      window.appAnimations?.toggleLoadingButton?.(confirmButton, false);

    });

    // Click outside modal handler
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        modal.classList.add("hidden");
        if (currentUploadData) {
          const fileInput = document.getElementById(
            `file-${currentUploadData.courseId}`
          );
          const dueDateInput = document.getElementById(
            `due-date-${currentUploadData.courseId}`
          );
          const donationInput = document.getElementById(
            `donation-${currentUploadData.courseId}`
          );

          fileInput.value = "";
          dueDateInput.value = "";
          donationInput.value = "";
          currentUploadData = null;
        }
      }
    });
  });

  // Make handlers available globally
  window.handleFileSelect = handleFileSelect;
  window.handleUploadClick = handleUploadClick;
  // File upload handling
  // File selection handling
  // File selection handling
  async function handleFileSelect(event, courseId, courseName) {
    const file = event.target.files[0];
    if (!file) return;

    const dueDateInput = document.getElementById(`due-date-${courseId}`);
    const donationInput = document.getElementById(`donation-${courseId}`);

    if (!dueDateInput.value) {
      window.appAnimations?.showNotification?.(
        "Please select a due date",
        "error"
      );
      event.target.value = "";
      return;
    }

    // Store upload data
    currentUploadData = {
      file,
      courseId,
      courseName,
      dueDate: dueDateInput.value,
      donationAmount: parseFloat(donationInput.value) || 0,
    };

    // Show confirmation modal
    const modal = document.getElementById("uploadConfirmModal");
    const fileName = document.getElementById("confirmFileName");
    const dueDate = document.getElementById("confirmDueDate");
    const donationAmount = document.getElementById("confirmDonation");

    fileName.textContent = file.name;
    dueDate.textContent = new Date(dueDateInput.value).toLocaleDateString();
    donationAmount.textContent =
      currentUploadData.donationAmount > 0
        ? `$${currentUploadData.donationAmount.toFixed(2)}`
        : "No donation requested";

    modal.classList.remove("hidden");
  }
  // Reset file selection
  function resetFileSelection(courseId) {
    // Reset file input
    const fileInput = document.getElementById(`file-${courseId}`);
    fileInput.value = "";

    // Get UI elements
    const uploadForm = document.getElementById(`upload-form-${courseId}`);
    const uploadConfirm = document.getElementById(`upload-confirm-${courseId}`);
    const dueDateInput = document.getElementById(`due-date-${courseId}`);

    // Reset due date
    dueDateInput.value = "";

    // Show upload form and hide confirmation
    uploadForm.classList.remove("hidden");
    uploadConfirm.classList.add("hidden");
  }

  // Handle final upload confirmation
  async function confirmUpload(courseId, courseName) {
    const fileInput = document.getElementById(`file-${courseId}`);
    const dueDateInput = document.getElementById(`due-date-${courseId}`);
    const confirmButton = document.querySelector(
      `#upload-confirm-${courseId} .confirm-upload-button`
    );

    if (!fileInput.files[0]) {
      window.appAnimations?.showNotification?.("Please select a file", "error");
      return;
    }

    if (!dueDateInput.value) {
      window.appAnimations?.showNotification?.(
        "Please select a due date",
        "error"
      );
      return;
    }

    try {
      window.appAnimations?.toggleLoadingButton?.(confirmButton, true);

      // Create form data for the upload
      const formData = new FormData();
      formData.append("file", fileInput.files[0]);
      formData.append("courseId", courseId);
      formData.append("courseName", courseName);
      formData.append("teacherId", auth.currentUser.uid);
      formData.append("dueDate", dueDateInput.value);

      // Send to backend
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Upload failed");
      }

      const result = await response.json();

      window.appAnimations?.showNotification?.(
        "Permission slip uploaded successfully!",
        "success"
      );

      // Reset the form
      resetFileSelection(courseId);

      // Redirect to DocuSign auth
      window.location.href = `/api/teacher-auth?teacher_id=${auth.currentUser.uid}`;

      return result.documentId;
    } catch (error) {
      console.error("Error uploading file:", error);
      window.appAnimations?.showNotification?.(error.message, "error");
    } finally {
      window.appAnimations?.toggleLoadingButton?.(confirmButton, false);
    }
  }

  // Make all functions available globally
  window.handleFileSelect = handleFileSelect;
  window.resetFileSelection = resetFileSelection;
  window.confirmUpload = confirmUpload;

  // Make functions available globally
  window.handleUploadClick = handleUploadClick;

  // Auth state observer
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      loginSection.classList.add("hidden");
      dashboardSection.classList.remove("hidden");
      // teacherName.textContent = user.email;
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

  async function updateDashboardStats(userId) {
    try {
      // Get teacher data from Firestore
      const teacherDoc = await db.collection("teachers").doc(userId).get();
      const teacherData = teacherDoc.data();
      const courses = teacherData?.courses || [];

      // Calculate total students
      const totalStudents = courses.reduce(
        (sum, course) => sum + (course.students?.length || 0),
        0
      );

      // Get documents to calculate signatures
      const documents = await db
        .collection("documents")
        .where("teacher_id", "==", userId)
        .get();

      let pending = 0;
      let completed = 0;

      documents.forEach((doc) => {
        const data = doc.data();
        const envelopes = data.docusign_envelopes || [];

        envelopes.forEach((envelope) => {
          if (!envelope.studentHasSigned || !envelope.parentHasSigned) {
            pending++;
          } else {
            completed++;
          }
        });
      });

      // Update DOM
      document.getElementById("activeCourses").textContent = courses.length;
      document.getElementById("totalStudents").textContent = totalStudents;
      document.getElementById("pendingSignatures").textContent = pending;
      document.getElementById("completedForms").textContent = completed;
    } catch (error) {
      console.error("Error updating dashboard stats:", error);
    }
  }

  // Update your auth state observer
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      loginSection.classList.add("hidden");
      dashboardSection.classList.remove("hidden");
      await loadCourses(user.uid);
      await updateDashboardStats(user.uid); // Add this line
      window.appAnimations?.animateDashboard?.();
    } else {
      loginSection.classList.remove("hidden");
      dashboardSection.classList.add("hidden");
    }
  });

  // Make handleFileSelect available globally
  window.handleFileSelect = handleFileSelect;
});
