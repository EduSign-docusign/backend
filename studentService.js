//studentService.js
const axios = require("axios");
const docusign = require("docusign-esign");
const path = require("path");
const fs = require("fs");
const pdf = require('pdf-parse');
const { getPathFromFirebaseStorageUrl } = require("./utils");

const { CONFIG, backendURL, openai } = require("./config");


const { getTeacherData } = require("./teacherService");

const { db, bucket } = require("./firebase");


function makeViewRequest(email, name, envelope_id, document_id) {
  let viewRequest = new docusign.RecipientViewRequest();

  viewRequest.returnUrl = `${backendURL}/api/signingComplete?document_id=${document_id}&envelope_id=${envelope_id}`;

  viewRequest.authenticationMethod = "none";

  viewRequest.email = email;
  viewRequest.userName = name;
  viewRequest.clientUserId = CONFIG.clientUserId;

  return viewRequest;
}

async function getSigningURL(req, res) {
    const { document_id, student_id, type } = req.query;
    
      try {    
        const firestore_document = await db
          .collection("documents")
          .doc(document_id)
          .get();
        const firestore_data = firestore_document.data();
    
        const student_document = await db.collection("users").doc(student_id).get();
        const student_data = student_document.data();
        
        //Requires teacher authentication to create the embedded signing, uses saved teacher token in FireStore
        const teacher_id = firestore_data.teacher_id;
        const teacher_data = await getTeacherData(teacher_id);
    
        const apiClient = new docusign.ApiClient();
        apiClient.setBasePath(teacher_data.docusign_baseUri + "/restapi");
        apiClient.addDefaultHeader(
          "Authorization",
          `Bearer ${teacher_data.docusign_auth_token}`
        );
    
        const envelopesApi = new docusign.EnvelopesApi(apiClient);
    
        let email;
        let name;
    
        if (type == "student") {
          email = student_data.email;
          name = student_data.name;
        } else if (type == "parent") {
          email = student_data.parentEmail;
          name = student_data.parentName;
        } else {
          throw { status: 400, message: "Type must be student or parent" };
        }
    
        function getEnvelopeIDByStudentName(studentName, envelopes) {
          for (const envelope of envelopes) {
            if (envelope.name == studentName) {
              return envelope.envelope_id;
            }
          }
        }
    
        const envelope_id = getEnvelopeIDByStudentName(student_data.name, firestore_data.docusign_envelopes);
    
        const viewRequest = makeViewRequest(email, name, envelope_id, document_id);
    
        const url = await envelopesApi.createRecipientView(
          teacher_data.docusign_account_id,
          envelope_id,
          {
            recipientViewRequest: viewRequest,
          }
        );
    
        res.json(url);
      } catch (error) {
        console.error(JSON.stringify(error));
        res.status(error.status || 500).json({
          error: error.message || "Failed to get signing URL",
          status: error.status || 500,
        });
      }
}


function markStudentHasSigned(envelope_id, docusign_envelopes) {
    for (let envelope of docusign_envelopes) {
      if (envelope.envelope_id === envelope_id) {
        envelope.studentHasSigned = true;
        break;
      }
    }
    return docusign_envelopes; // Return the whole array
}


async function signingComplete(req, res) {
    const { document_id, envelope_id } = req.query;

  try {
    const firestore_document = db.collection("documents").doc(document_id);
    const firestore_snap = await firestore_document.get();
    const firestore_data = firestore_snap.data();

 

    await firestore_document.update({
      docusign_envelopes: markStudentHasSigned(
        envelope_id,
        firestore_data.docusign_envelopes
      ),
    });

    res.redirect("https://cdn.tanuj.xyz/auth-done.png");
  } catch (error) {
    console.error(JSON.stringify(error));

    res.status(error.status || 500).json({
      error: error.message || "Failed to complete signing URL",
      status: error.status || 500,
    });
  }
}

async function downloadPDFFromFirebase(filePath, outputPath) {
    const file = bucket.file(filePath);
  
    console.log("Downloading PDF from Firebase...");
    await file.download({ destination: outputPath });
    console.log("PDF downloaded successfully.");
  
    return outputPath;
};
  
async function extractTextFromPDF(pdfPath) {
    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await pdf(dataBuffer);
    return data.text;
};

async function summarizeText(text) {
    const messages = [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: `Summarize the following permission slip into concise bullet points for a parent or student to sign:\n\n"${text}"` },
    ];

    const response = await openai.chat.completions.create({
        model: "gpt-4", // You can change this to any chat-compatible model
        messages: messages,
        max_tokens: 150,
        temperature: 0.5,
    });

    return response.choices[0].message.content.trim();
}

async function getDocumentSummary(req, res) {
    const { document_id } = req.query;
    
      try {
        const firebase_document = await db.collection("documents").doc(document_id).get()
        const document_data = firebase_document.data()
    
        const tempFilePath = path.join(__dirname, "temp_permission_slip.pdf");
    
        await downloadPDFFromFirebase(getPathFromFirebaseStorageUrl(document_data.file_url), tempFilePath);
    
        console.log("Extracting text...");
        const extractedText = await extractTextFromPDF(tempFilePath);
    
        console.log("Summarizing content...");
        const summary = await summarizeText(extractedText);
    
        console.log("\n**Permission Slip Summary:**\n", summary);
        fs.unlinkSync(tempFilePath);
    
        res.json({ summary: summary })
      } catch (error) {
          console.error("Error processing permission slip:", error);
      }
    
      
}

async function getDocuments(req, res) {
  const { user_id } = req.query;

  const userDoc = await db.collection("users").doc(user_id).get()
  const userData = userDoc.data()

  if (!userData) res.json({ documents: [] })

  const querySnapshot = await db.collection("documents").get()
  const result = {};

  
  if (userData.type == "student") {
    studentNames = [userData.name]
  } else if (userData.type == "parent") {
    studentNames = userData.children
    .filter(child => !child.invite_pending)
    .map(child => child.name);      
  } else {
    return []
  }

  console.log("Fetching Student Names", studentNames)
      
  querySnapshot.forEach((doc) => {
      //extracting status because we dont want it
      const { status, ...data } = doc.data();
      const course = data.course_name;
      
      if (!result[course]) {
        result[course] = [];
      }

      const envelopes = data.docusign_envelopes || [];
      for (const envelope of envelopes) {
        if (studentNames.includes(envelope.name)) {
          result[course].push({ 
            id: doc.id,
            status: envelope.studentHasSigned ? "Pending" : "Completed",
            ...data 
          });
        }
      }
  });

  res.json({ 
    documents: Object.entries(result).map(([course, data]) => ({ title: course, data, }))
  });
}

module.exports = {
    getSigningURL,
    signingComplete,
    getDocumentSummary,
    getDocuments
}