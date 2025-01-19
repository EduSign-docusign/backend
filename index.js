const express = require("express");
const path = require("path");
const cors = require("cors");
const multer = require("multer");
require("dotenv").config();

const { CONFIG, backendURL } = require("./config");

const teacherService = require("./teacherService");
const studentService = require("./studentService");
const twilioService = require("./twilioService");
const parentService = require("./parentService")

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

// Serve the main HTML file
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Teacher-related routes
app.get("/api/teacher-auth", teacherService.authorizeTeacher);
app.get("/api/save-teacher-token", teacherService.saveTeacherDocusignToken);
app.post("/api/upload", upload.single("file"), teacherService.uploadFile);
app.delete("/api/files/:fileId", teacherService.deleteFile);
app.get("/api/canvas/courses", teacherService.getCanvasCourses);
app.post("/api/docusign-payment-webhook", teacherService.paymentWebhook);
app.post("/api/canvas/save-token", teacherService.saveCanvasCoursesAndToken);

// Student-related routes
app.get("/api/getSigningURL", studentService.getSigningURL);
app.get("/api/signingComplete", studentService.signingComplete);
app.get("/api/getDocumentSummary", studentService.getDocumentSummary);
app.get("/api/getDocuments", studentService.getDocuments);
app.get("/api/getUser", studentService.getUser);
app.get("/api/getFamilyMembers", studentService.getFamilyMembers);
app.post("/api/uploadPFP", upload.single("file"), studentService.uploadPFP);

//Parent-related routes
app.post("/api/addChild", parentService.addChild)
app.delete("/api/removeChild", parentService.removeChild)

// Twilio routes
app.post("/api/trigger-reminder-calls/:documentId", twilioService.remindParents);


// Start server
app.listen(CONFIG.PORT, () => {
  console.log(`Server running at ${backendURL}`);
});
