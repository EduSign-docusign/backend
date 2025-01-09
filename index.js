const express = require("express");
const docusign = require("docusign-esign");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
require("dotenv").config();

const port = process.env.PORT || 8080;

// Initialize Firebase Admin
const { initializeApp, cert } = require("firebase-admin/app");
const firebaseKey = require("./firebase-key.json");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");

// Initialize the app with a service account
initializeApp({
  credential: cert(firebaseKey),
  storageBucket: "edusign-d5abd.firebasestorage.app" // Add this line
});
const bucket = getStorage().bucket('gs://edusign-d5abd.firebasestorage.app');



console.log("NODE_ENV", process.env.NODE_ENV)

const backendURL =
  process.env.NODE_ENV === "development"
    ? `http://localhost:${port}` 
    : "https://backend-375617093037.us-central1.run.app";

console.log(`Backend URL: ${backendURL}`);




const multer = require("multer");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});
const app = express();


app.use(cors());
app.use(express.json());
app.use(express.static("public")); // Serve static files from 'public' directory

const CONFIG = {
  clientId: "3e981cbc-6bca-4c25-9453-0c927ecdfb84",
  clientUserId: "1193ac53-5f9d-40bb-9651-8f063fa0d603",
  clientEmail: "tanujsiripurapu@gmail.com",
  clientSecret: "85db939f-5b56-4207-9921-ad3ebee5b587",
  authRedirectUri: `${backendURL}/api/save-teacher-token`,
  authServer: "https://account-d.docusign.com",
};

// Serve the main HTML file
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});



app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file provided" });
    }

    const { courseId, courseName, teacherId, dueDate } = req.body;

    if (!dueDate) {
      return res.status(400).json({ error: "Due date is required" });
    }

    const file = req.file;

    // Create a unique filename
    const timestamp = Date.now();
    const filename = `permission_slips/${teacherId}/${courseId}/${timestamp}_${file.originalname}`;

    // Create a new blob in the bucket and upload the file data
    const fileBlob = bucket.file(filename);

    const blobStream = fileBlob.createWriteStream({
      resumable: false,
      metadata: {
        contentType: file.mimetype,
      },
    });

    blobStream.on('error', (err) => {
      console.error('Upload error:', err);
      res.status(500).json({ error: "Failed to upload file", details: err.message });
    });

    blobStream.on('finish', async () => {
      // Make the file public
      try {
        await fileBlob.makePublic();

        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filename}`;

        // Save document reference in Firestore with due date
        const db = getFirestore();
        const docRef = await db.collection("documents").add({
          course_id: courseId,
          course_name: courseName,
          file_url: publicUrl,
          teacher_id: teacherId,
          file_name: file.originalname,
          uploaded_at: FieldValue.serverTimestamp(),
          due_date: new Date(dueDate),
          status: "uploaded",
        });

        // Handle DocuSign envelopes
        await createAllDocusignEnvelopes(docRef.id);

        res.status(200).json({
          success: true,
          documentId: docRef.id,
          fileUrl: publicUrl,
          dueDate: dueDate
        });
      } catch (err) {
        console.error('Error after upload:', err);
        res.status(500).json({ 
          error: "Failed to process file after upload", 
          details: err.message 
        });
      }
    });

    blobStream.end(file.buffer);
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({
      error: "Failed to process file upload",
      details: error.message,
    });
  }
});

// Delete file endpoint
app.delete("/api/files/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;
    const { teacherId } = req.body;

    // Get the file document
    const db = getFirestore();
    const fileDoc = await db.collection("documents").doc(fileId).get();

    if (!fileDoc.exists) {
      return res.status(404).json({ error: "File not found" });
    }

    const fileData = fileDoc.data();
    console.log("File data:", fileData); // Debug log

    // Verify teacher ownership
    if (fileData.teacher_id !== teacherId) {
      return res
        .status(403)
        .json({ error: "Unauthorized to delete this file" });
    }

    // Get the file path from the original upload path
    const filePath = `permission_slips/${fileData.teacher_id}/${fileData.course_id}/${fileData.file_name}`;
    console.log("Attempting to delete file at path:", filePath); // Debug log

    // Get storage bucket and delete file
    const bucket = getStorage().bucket(CONFIG.storageBucket);
    await bucket
      .file(filePath)
      .delete()
      .catch((error) => {
        console.log("Storage delete error (non-fatal):", error);
        // Continue even if storage delete fails
      });

    // Delete the Firestore document
    await db.collection("documents").doc(fileId).delete();

    res.status(200).json({ message: "File deleted successfully" });
  } catch (error) {
    console.error("Delete file error:", error);
    res.status(500).json({
      error: "Failed to delete file",
      details: error.message,
    });
  }
});


// Canvas API Proxy
app.get("/api/canvas/courses", async (req, res) => {
  const token = req.headers.authorization;

  try {
    const response = await axios.get(
      "https://lgsuhsd.instructure.com/api/v1/courses",
      {
        headers: {
          Authorization: token,
        },
      }
    );
    res.json(response.data);
  } catch (error) {
    console.error("Canvas API Error:", error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: "Failed to fetch courses from Canvas",
    });
  }
});


// Update the server endpoint (server.js)
// Update the server endpoint (server.js)
app.post("/api/canvas/save-token", async (req, res) => {
  const { token, teacherId } = req.body;

  try {
    // 1. First get courses list
    const coursesResponse = await axios.get(
      "https://lgsuhsd.instructure.com/api/v1/courses",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const availableCourses = coursesResponse.data.filter(
      (course) => !course.access_restricted_by_date && course.name
    );

    console.log("Available courses:", availableCourses.length);

    const coursesWithStudents = await Promise.all(
      availableCourses.map(async (course) => {
        try {
          const studentsResponse = await axios.get(
            `https://lgsuhsd.instructure.com/api/v1/courses/${course.id}/users`,
            {
              params: {
                enrollment_type: ["student"],
                per_page: 100,
              },
              headers: {
                Authorization: `Bearer ${token}`,
              },
            }
          );

          // Just get an array of names
          const studentNames = studentsResponse.data
            .map(student => student.name || "")
            .filter(name => name); // Remove any empty names

          console.log(
            `Processed ${studentNames.length} students for course ${course.id}`
          );

          // Return course with just id, name, and array of student names
          return {
            id: course.id?.toString() || "",
            name: course.name || "",
            students: studentNames,
          };
        } catch (error) {
          console.error(
            `Error fetching students for course ${course.id}:`,
            error.response?.data || error
          );
          // Return default course object on error
          return {
            id: course.id?.toString() || "",
            name: course.name || "",
            students: [],
          };
        }
      })
    );

    // Filter out any invalid courses
    const validCourses = coursesWithStudents.filter(
      (course) =>
        course &&
        course.id &&
        Array.isArray(course.students) &&
        course.students.length > 0
    );

    console.log("Saving courses to Firestore:", validCourses);

    const db = getFirestore();
    await db.collection("teachers").doc(teacherId).update({
      canvas_access_token: token,
      courses: validCourses,
      last_synced: FieldValue.serverTimestamp(),
    });

    res.json({
      success: true,
      courses: validCourses,
      totalCourses: validCourses.length,
      totalStudents: validCourses.reduce(
        (sum, course) => sum + course.students.length,
        0
      ),
    });
  } catch (error) {
    console.error("Error saving Canvas token:", error.response?.data || error);
    res.status(400).json({
      error: "Invalid Canvas token or failed to fetch courses/students",
      details: error.message,
    });
  }
});






//Docusign
app.get('/api/teacher-auth', (req, res) => {
  const { teacher_id } = req.query

  if (!teacher_id) {
    res.status(400).json({ error: "No teacher_id provided. Must be the ID of a document in the teachers Firestore collection"})
  }
  
  const authUrl = `${CONFIG.authServer}/oauth/auth?response_type=code&` +
    `scope=signature&` +
    `client_id=${CONFIG.clientId}&` +
    `redirect_uri=${encodeURIComponent(CONFIG.authRedirectUri)}&` +
    `state=${encodeURIComponent(JSON.stringify({ teacher_id }))}`;
  res.redirect(authUrl);
});


//this is internal, redirected from api/teacher-auth DO NOT CALL EXTERNALLY
app.get('/api/save-teacher-token', async(req, res) => {
      const { code, state } = req.query;
      console.log("Loaded state:", JSON.stringify(state))
      const { teacher_id } = JSON.parse(decodeURIComponent(state));

      const tokenResponse = await getDocusignToken(code)
 
      console.log("Got token:", JSON.stringify(tokenResponse))
      
      const db =  getFirestore()

      const accountInfo = await getUserInfo(tokenResponse.access_token)

      await db.collection("teachers").doc(teacher_id).update({
        docusign_auth_token: tokenResponse.access_token,
        docusign_refresh_token: tokenResponse.refresh_token,
        docusign_account_id: accountInfo.accountId,
        docusign_baseUri: accountInfo.baseUri
      })

      res.json("Succesfully saved token. You may return to EduSign")
})

const getDocusignToken = async(code) => {
    const tokenResponse = await axios.post(`${CONFIG.authServer}/oauth/token`, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: CONFIG.redirectUri,
    }, {
      auth: {
        username: CONFIG.clientId,
        password: CONFIG.clientSecret,
      },
  });

    return tokenResponse.data
};

const refreshDocusignToken = async (refresh_token) => {
  try {
    const response = await axios.post(`${CONFIG.authServer}/oauth/token`, {
      grant_type: "refresh_token",
      refresh_token: refresh_token,
    }, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${Buffer.from(`${CONFIG.clientId}:${CONFIG.clientSecret}`).toString("base64")}`,
      },
    });

    return response.data.access_token;
  } catch (err) {
    console.error("Failed to refresh DocuSign token:", err.response?.data || err.message);
    throw new Error("Failed to refresh DocuSign token");
  }
};

//This is called when the student clicks on a document in mobile app
app.get('/api/getSigningURL', async (req, res) => {
  const { document_id, student_id, type } = req.query;

  try {
      const db = getFirestore();

      const firestore_document = await db.collection("documents").doc(document_id).get()
      const firestore_data = firestore_document.data()

      const student_document = await db.collection("students").doc(student_id).get()
      const student_data = student_document.data()

      const teacher_id = firestore_data.teacher_id
      const teacher_data = await getTeacherData(teacher_id)

      const apiClient = new docusign.ApiClient();
      apiClient.setBasePath(teacher_data.docusign_baseUri + '/restapi');
      apiClient.addDefaultHeader('Authorization', `Bearer ${teacher_data.docusign_auth_token}`);
          
      const envelopesApi = new docusign.EnvelopesApi(apiClient);

      let email;
      let name;

      if (type == "student") {
          email = student_data.email
          name = student_data.name
      } else if (type == "parent") {
          email = student_data.parentEmail
          name = student_data.parentName
      } else {
          throw { status: 400, message: "Type must be student or parent" }
      }

      const envelope_id = firestore_data.recipients[student_data.name]
      const viewRequest = makeViewRequest(email, name, envelope_id, document_id);
      
      const url = await envelopesApi.createRecipientView(teacher_data.docusign_account_id, envelope, {
        recipientViewRequest: viewRequest,
      });

      res.json( url )
  } catch (error) {
    console.error(JSON.stringify(error));
    res.status(error.status || 500).json({ error: error.message || 'Failed to get signing URL', status: error.status || 500 });
  }
});

function makeViewRequest(email, name, envelope_id, document_id) {

  let viewRequest = new docusign.RecipientViewRequest();

  viewRequest.returnUrl = `${backendURL}/api/signingComplete?document_id=${document_id}&envelope_id=${envelope_id}`

  viewRequest.authenticationMethod = 'none';

  viewRequest.email = email;
  viewRequest.userName = name;
  viewRequest.clientUserId = CONFIG.clientUserId

  return viewRequest;
}

app.get('/api/signingComplete', async (req, res) => {
  const { document_id, envelope_id } = req.query;

  try {
    const db = getFirestore()

    const firestore_document = db.collection("documents").doc(document_id)
    const firestore_snap = await firestore_document.get()
    const firestore_data = firestore_snap.data()

    function markStudentHasSigned(envelope_id, docusign_envelopes) {
      for (let envelope of docusign_envelopes) {
          if (envelope.envelope_id === envelope_id) {
              envelope.studentHasSigned = true;
              break;
          }
      }
      return docusign_envelopes; // Return the whole array
  }

    await firestore_document.update({
      docusign_envelopes: markStudentHasSigned(envelope_id, firestore_data.docusign_envelopes)
    })

    res.redirect("https://cdn.tanuj.xyz/auth-done.png")
  } catch(error) {
    console.error(JSON.stringify(error))

    res.status(error.status || 500).json({ error: error.message || 'Failed to complete signing URL', status: error.status || 500 });
  }
});


async function getUserInfo(accessToken) {
    const userInfoUrl = 'https://account-d.docusign.com/oauth/userinfo';
    console.log("Getting Base URI With Token", accessToken)

    const response = await axios.get(userInfoUrl, {
        headers: {
            'Authorization': `Bearer ${accessToken}`
        }
    });

    // Log the full response for debugging
    console.log('UserInfo Response:', response.data);

    // Get the default account from the accounts array
    const defaultAccount = response.data.accounts.find(acc => acc.is_default) || response.data.accounts[0];

    if (!defaultAccount) {
        throw new Error('No account found in the userinfo response');
    }

    return {
        baseUri: defaultAccount.base_uri,
        accountId: defaultAccount.account_id
    };
}

function getStudentsByCourseId(courses, courseId) {
  const course = courses.find((course) => course.id === courseId);
  return course.students
}

app.get('/api/createEnvelopeTest', async (req, res) => {
  await createAllDocusignEnvelopes("T3l8dlaY3ckRrDUvn2QF")
  res.json("ok")
});

//internal function
async function createDocusignEnvelope(envelopesApi, accountId, studentEmail, studentName, parentEmail, parentName) {
  const envelopeDefinition = new docusign.EnvelopeDefinition();
  envelopeDefinition.emailSubject = `Parents & Students, please sign this document`;

  const documentBytes = fs.readFileSync(path.resolve('./ps.pdf'));
  const documentBase64 = documentBytes.toString('base64');

  const document = new docusign.Document();
  document.documentBase64 = documentBase64;
  document.name = 'TEST PERMISSION SLIP'; 
  document.fileExtension = 'pdf'; 
  document.documentId = '1'; 
  envelopeDefinition.documents = [document];

  const signer = new docusign.Signer();
  signer.email = parentEmail
  signer.name = parentName; 
  signer.recipientId = '2';
  signer.clientUserId = CONFIG.clientUserId

  const signer2 = new docusign.Signer();
  signer2.email = studentEmail 
  signer2.name = studentName; 
  signer2.recipientId = '1';
  signer2.clientUserId = CONFIG.clientUserId

  envelopeDefinition.recipients = new docusign.Recipients();
  envelopeDefinition.recipients.signers = [signer, signer2];
  envelopeDefinition.status = 'sent';

  const env_results = await envelopesApi.createEnvelope(accountId, {
    envelopeDefinition,
  });

  return env_results.envelopeId
}

async function getTeacherData(teacher_id) {
  const db = getFirestore()

  const teacher_document = await db.collection("teachers").doc(teacher_id).get()
  if (!teacher_document.exists) {
    throw ({ status: 404, message: "Teacher not found" });
  }
  const teacher_data = teacher_document.data()

  if (!teacher_data.docusign_auth_token) {
    throw new Error("No auth token present. Could not send document because teacher has not granted permission. This is a bug. 30-day permission should have been granted when document was sent.")
  }

  let access_token = teacher_data.docusign_auth_token
  let accountInfo;

  try {
      accountInfo = await getUserInfo(access_token)
      await db.collection("teachers").doc(firestore_data.teacher_id).update({
        docusign_baseUri: accountInfo.baseUri,
        docusign_account_id: accountInfo.accountId
      })
      
  } catch(error) {
      if (error.status === 401 ) {
        if (!teacher_data.docusign_refresh_token) {
          throw new Error("No refresh token present. Could not send document because teacher has not granted permission. This is a bug. 30-day permission should have been granted when document was sent.")
        }

        console.log("Access token expired. Attempting to refresh token...");

        access_token = await refreshDocusignToken(teacher_data.docusign_refresh_token);

        await db.collection("teachers").doc(teacher_id).update({
          docusign_auth_token: access_token,
        });

        accountInfo = await getUserInfo(access_token);

      }
  } 


  console.log("Account Info:", accountInfo)

  const updated_teacher_document = await db.collection("teachers").doc(teacher_id).get()
  const updated_teacher_data = updated_teacher_document.data()

  return updated_teacher_data
}
//document_id is a Firebase document id
//this should be called when a document is sent to students
async function createAllDocusignEnvelopes(document_id) {
  const db = getFirestore();

  const firestore_document = await db.collection("documents").doc(document_id).get()
  const firestore_data = firestore_document.data()
  const course_id = firestore_data.course_id
  const teacher_id = firestore_data.teacher_id

  const teacher_data = await getTeacherData(teacher_id)

  const courses = teacher_data.courses

  const students = getStudentsByCourseId(courses, course_id)
  console.log("Sending envelope to students:", students)




  const baseUri = teacher_data.docusign_baseUri
  const accountId = teacher_data.docusign_account_id

  const apiClient = new docusign.ApiClient();
  apiClient.setBasePath(baseUri + '/restapi');
  apiClient.addDefaultHeader('Authorization', `Bearer ${teacher_data.docusign_auth_token}`);
  

  const envelopesApi = new docusign.EnvelopesApi(apiClient);

  const docusign_envelopes = []

  for (const student of students) {
    try {
      // Query Firestore for the student document where name matches
      const querySnapshot = await db.collection("students").where('name', '==', student).get()

      if (querySnapshot.empty) {
        console.log(`No document found for student: ${student}`);
        continue;
      }

      const studentDoc = querySnapshot.docs[0];
      const studentData = studentDoc.data()
      console.log(`Document for ${student}:`, studentData);

      const envelope_id = await createDocusignEnvelope(envelopesApi, accountId, studentData.email, studentData.name, studentData.parentEmail, studentData.parentName)

      const envelope = {
        name: student,
        envelope_id: envelope_id,
        studentHasSigned: false,
        parentHasSigned: false
      }

      docusign_envelopes.push(envelope)
    } catch (error) {
      console.error(`Error fetching document for student ${student}:`, error);
    }
  }

  await db.collection("documents").doc(document_id).update({
    docusign_envelopes: docusign_envelopes
  })
  

  // let studentViewRequest = makeViewRequest("goat@tanuj.xyz", "Student Signer");
  // let parentViewRequest = makeViewRequest("tanuj@medihacks.org", "Parent Signer");

  // const studentURL = await envelopesApi.createRecipientView(accountId, env_results.envelopeId, {
  //   recipientViewRequest: studentViewRequest,
  // });

  // const parentURL = await envelopesApi.createRecipientView(accountId, env_results.envelopeId, {
  //   recipientViewRequest: parentViewRequest,
  // });

}





// async function getSigningURL(baseUri, accountId, accessToken, parentName) {
//   const apiClient = new docusign.ApiClient();
//   apiClient.setBasePath(baseUri + '/restapi');
//   apiClient.addDefaultHeader('Authorization', `Bearer ${accessToken}`);

//   const envelopesApi = new docusign.EnvelopesApi(apiClient);

//   const envelopeDefinition = new docusign.EnvelopeDefinition();
//   envelopeDefinition.emailSubject = 'Please sign this document';

//   // Add a document to the envelope
//   const documentBytes = fs.readFileSync(path.resolve('./test.pdf'));
//   const documentBase64 = documentBytes.toString('base64');

//   const document = new docusign.Document();
//   document.documentBase64 = documentBase64;
//   document.name = 'Sample Document'; 
//   document.fileExtension = 'pdf'; 
//   document.documentId = '1'; 
//   envelopeDefinition.documents = [document];

//   const signer = new docusign.Signer();
//   signer.email = CONFIG.clientEmail 
//   signer.name = parentName; 
//   signer.recipientId = '1';
//   signer.clientUserId = CONFIG.clientUserId

//   const signHere = new docusign.SignHere();
//   signHere.anchorString = '**signature_1**'; 
//   signHere.anchorUnits = 'pixels';
//   signHere.anchorXOffset = '20';
//   signHere.anchorYOffset = '10';

//   const tabs = new docusign.Tabs();
//   tabs.signHereTabs = [signHere];
//   signer.tabs = tabs;

//   envelopeDefinition.recipients = new docusign.Recipients();
//   envelopeDefinition.recipients.signers = [signer];
//   envelopeDefinition.status = 'sent'; // Set envelope status to "sent" to immediately send it

//   // Send the envelope
//   const results = await envelopesApi.createEnvelope(accountId, {
//     envelopeDefinition,
//   });
  
//   let viewRequest = makeRecipientViewRequest(parentName);

//   const rv_results = await envelopesApi.createRecipientView(accountId, results.envelopeId, {
//     recipientViewRequest: viewRequest,
//   });

//   return { envelopeId: results.envelopeId, redirectUrl: rv_results };
// }



// Start server
app.listen(port, () => {
  console.log(`Server running at ${backendURL}`);
});
