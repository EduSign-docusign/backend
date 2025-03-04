//studentService.js
const axios = require("axios");
const docusign = require("docusign-esign");
const path = require("path");
const fs = require("fs");
const pdf = require('pdf-parse');
const { getPathFromFirebaseStorageUrl, extractToken, verifyToken } = require("./utils");

const { CONFIG, backendURL, openai } = require("./config");


const { getTeacherData } = require("./teacherService");

const { db, bucket } = require("./firebase");


function makeViewRequest(email, name, type, envelope_id, document_id) {
  let viewRequest = new docusign.RecipientViewRequest();

  viewRequest.returnUrl = `${backendURL}/api/signingComplete?document_id=${document_id}&envelope_id=${envelope_id}&type=${type}`;

  viewRequest.authenticationMethod = "none";

  viewRequest.email = email;
  viewRequest.userName = name;
  viewRequest.clientUserId = CONFIG.clientUserId;

  return viewRequest;
}

async function setExpoPushToken(req, res) {
  const { expoPushToken } = req.body;

  try {
    const token = extractToken(req, res)
    const user_id = await verifyToken(token)
  
    if (!user_id) {
      console.error("User not found", user_id)
      return res.status(404).json({ success: false, status: 404, message: "User not found"})
    }
  
    if (!expoPushToken) {
      console.error("Push token not found", expoPushToken)
      return res.status(404).json({ success: false, status: 404, message: "No expoPushToken provided"})
    }
  
    console.log("Updating", user_id, expoPushToken, req.body)
    await db.collection("users").doc(user_id).update({
      expoPushToken: expoPushToken
    })

    res.json({ success: true })
  } catch(error) {
    console.error(JSON.stringify(error));
    res.status(error.status || 500).json({
      error: error.message || "Failed to set Expo Push Token",
      status: error.status || 500,
    });
  }
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
        
        const viewRequest = makeViewRequest(email, name, type, envelope_id, document_id);
    
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


function markHasSigned(type, envelope_id, docusign_envelopes) {
    for (let envelope of docusign_envelopes) {
      if (envelope.envelope_id === envelope_id) {
        if (type == "student") {
          envelope.studentHasSigned = true;
        } else if (type == "parent") {
          envelope.parentHasSigned = true
        } else {
          throw new Error("Type must be student or parent.")
        }
        break;
      }
    }
    return docusign_envelopes; // Return the whole array
}


async function signingComplete(req, res) {
    const { document_id, envelope_id, type } = req.query;

  try {
    const firestore_document = db.collection("documents").doc(document_id);
    const firestore_snap = await firestore_document.get();
    const firestore_data = firestore_snap.data();

 

    await firestore_document.update({
      docusign_envelopes: markHasSigned(
        type,
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
        { role: "user", content: `Summarize the following permission slip into up to 5 concise bullet points for a curious parent:\n\n"${text}"` },
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

function getStatusOfEnvelope(envelope) {
  if (!(envelope.studentHasSigned)) {
    return "Pending Student"
  } else if (!envelope.parentHasSigned) {
    return "Pending Parent"
  } else {
    return "Completed"
  }
}


async function getFamilyMembers(req, res) {
  try {
    const token = extractToken(req, res)
    const user_id = await verifyToken(token)

    if (!user_id) {
      return res.status(404).json({ success: false, message: "User not found"})
    }

    // Fetch the user document
    const userDoc = await db.collection("users").doc(user_id).get();
    const userData = userDoc.data();

    if (!userData) {
      return res.json({ members: [] });
    }

    let children;
    const members = [];
    const requests = [];

    if (userData.type === "student") {
      const parentDoc = await db.collection("users").doc(userData.parentID).get();
      const { children: parentsChildren, ...parentData } = parentDoc.data();

      children = parentsChildren || []

      members.push(parentData);

    } else if (userData.type === "parent") {
      children = userData.children
      const pendingChildren = userData.pending_children || []

      for (const child of pendingChildren) {
        const childDoc = await db.collection("users").doc(child.id).get();
        if (childDoc.exists) {
          requests.push({...childDoc.data(), id: child.id});
        }
      }
  
    } else {
      throw new Error("Type is not student or parent.")
    }

    const filteredChildren = children.filter((child) => child.name !== userData.name);

    for (const child of filteredChildren) {
      const childDoc = await db.collection("users").doc(child.id).get();
      if (childDoc.exists) {
        members.push(childDoc.data());
      }
    }

    res.json({ members: members, requests: requests })

  } catch (error) {
    console.error("Error fetching family members:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred while fetching family members.",
      details: error.message,
    });
  }
}


async function getDocuments(req, res) {
  try {
      const token = extractToken(req, res)
      const user_id = await verifyToken(token)
    
      if (!user_id) {
        console.error("User not found", user_id)
        return res.status(404).json({ success: false, message: "User not found"})
      }
    
      const userDoc = await db.collection("users").doc(user_id).get()
      const userData = userDoc.data()
    
      if (!userData) res.json({ documents: [] })
    
      const querySnapshot = await db.collection("documents").get()
      const result = {};
    
      
      if (userData.type == "student") {
        studentNames = [userData.name]
      } else if (userData.type == "parent") {
        studentNames = userData.children
        .map(child => child.name);      
      } else {
        return []
      }
    
      console.log("Fetching Student Names", studentNames)
          
      querySnapshot.forEach((doc) => {
          //extracting status because we dont want it
          const { status, docusign_envelopes, ...data } = doc.data();
          const course = data.course_name;
    
          const envelopes = docusign_envelopes || [];
          for (const envelope of envelopes) {
            if (studentNames.includes(envelope.name)) {
              if (!result[course]) {
                result[course] = [];
              }
              
              result[course].push({ 
                id: doc.id,
                status: getStatusOfEnvelope(envelope),
                ...envelope,
                ...data 
              });
            }
          }
      });
    
      res.json({ 
        documents: Object.entries(result).map(([course, data]) => ({ title: course, data, }))
      });
  } catch(error) {
    res.status(error.status || 500).json({
      error: error.message || "Failed to get documents",
      status: error.status || 500,
    });  
  }
  
}

async function getUser(req, res) {
  try {
    const token = extractToken(req, res)
    const user_id = await verifyToken(token)
  
    if (!user_id) {
      console.error("User not found", user_id)
      return res.status(404).json({ success: false, message: "User not found"})
    }
  
    const userDoc = await db.collection("users").doc(user_id).get()
    const userData = userDoc.data();
  
    res.json({ user: userData })
  } catch(error) {
    res.status(error.status || 500).json({
      error: error.message || "Failed to get user",
      status: error.status || 500,
    });  
  }
}

async function uploadPFP(req, res) {
  try {
      if (!req.file) {
        return res.status(400).json({ error: "No file provided" });
      }
  
      const { user_id } = req.query;
  
      const file = req.file;
      
      console.log("Made it here! File and user_id", user_id, file)
      const timestamp = Date.now();
      const filename = `pfps/${user_id}/${timestamp}_${file.originalname}`;
  
      const fileBlob = bucket.file(filename);
  
      const blobStream = fileBlob.createWriteStream({
        resumable: false,
        metadata: {
          contentType: file.mimetype,
        },
      });
  
      blobStream.on("error", (err) => {
        console.error("Upload error:", err);
        return res.status(500).json({ error: "Failed to upload file", details: err.message });
      });
  
      blobStream.on("finish", async () => {
        try {
          await fileBlob.makePublic();
  
          const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filename}`;
  
          const docRef = await db.collection("users").doc(user_id).update({
            pfp_url: publicUrl
          });

          res.status(200).json({
            success: true,
            documentId: docRef.id,
            pfp_url: publicUrl,
          });

        } catch (err) {
          console.error("Error after upload:", err);
          res.status(500).json({
            error: "Failed to process file after upload",
            details: err.message,
          });
        }
      });
  
      blobStream.end(file.buffer);
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({
        error: "Failed to process PFP upload",
        details: error.message,
      });
    }
}

module.exports = {
    getSigningURL,
    signingComplete,
    getDocumentSummary,
    getDocuments,
    getUser,
    uploadPFP,
    getFamilyMembers,
    setExpoPushToken
}