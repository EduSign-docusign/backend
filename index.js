const express = require("express");
const docusign = require("docusign-esign");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 8080;

// Initialize Firebase Admin
const { initializeApp, cert } = require("firebase-admin/app");
const firebaseKey = require("./firebase-key.json");
const { getFirestore, FieldValue } = require("firebase-admin/firestore"); // Add FieldValue import

initializeApp({
  credential: cert(firebaseKey),
});

console.log("NODE_ENV", process.env.NODE_ENV)

const backendURL =
  process.env.NODE_ENV === "development"
    ? `http://localhost:${port}` 
    : "https://backend-375617093037.us-central1.run.app";

console.log(`Backend URL: ${backendURL}`);
// Middleware
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

          // Add null checks and default values
          const students = studentsResponse.data.map((student) => {
            // Split the name into parts
            const nameParts = (
              student.sortable_name ||
              student.name ||
              ""
            ).split(",");
            const lastName = (nameParts[0] || "").trim();
            const firstName = (nameParts[1] || "").trim();

            // Get first 3 letters of first and last name
            const firstThree = firstName.slice(0, 3).toLowerCase();
            const lastThree = lastName.slice(0, 3).toLowerCase();

            // Create email pattern
            const emailPattern = `${firstThree}${lastThree}@lgsuhsd.org`;

            // Return only the fields we need with default values
            return {
              id: student.id?.toString() || "",
              name: student.name || "",
              sortable_name: student.sortable_name || "",
              email_pattern: emailPattern,
            };
          });

          console.log(
            `Processed ${students.length} students for course ${course.id}`
          );

          // Return course with default values
          return {
            id: course.id?.toString() || "",
            name: course.name || "",
            course_code: course.course_code || "",
            students: students || [],
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
            course_code: course.course_code || "",
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

      await db.collection("teachers").doc(teacher_id).update({
        docusign_auth_token: tokenResponse.access_token,
        docusign_refresh_token: tokenResponse.refresh_token
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

app.get('/api/getDocURL', async (req, res) => {
  const { document_id } = req.query;
  
  try {
    const db = getFirestore()
    
    const document = await db.collection("documents").doc(document_id).get()
    if (!document.exists) {
      throw ({ status: 404, message: "Document not found" });
    }
    const document_data = document.data()

    const teacher = await db.collection("teachers").doc(document_data.teacher_id).get()
    if (!teacher.exists) {
      throw ({ status: 404, message: "Teacher not found" });
    }
    const teacher_data = teacher.data()
    if (!teacher_data.docusign_auth_token) {
      throw new Error("No auth token present. Could not send document because teacher has not granted permission. This is a bug. 30-day permission should have been granted when document was sent.")
    }

    let access_token = teacher_data.docusign_auth_token


    let accountInfo;

    try {
        accountInfo = await getUserInfo(access_token)
        
    } catch(error) {
        if (error.status === 401 ) {
          if (!teacher_data.docusign_refresh_token) {
            throw new Error("No refresh token present. Could not send document because teacher has not granted permission. This is a bug. 30-day permission should have been granted when document was sent.")
          }

          console.log("Access token expired. Attempting to refresh token...");

          access_token = await refreshDocusignToken(teacher_data.docusign_refresh_token);

          await db.collection("teachers").doc(document_data.teacher_id).update({
            docusign_auth_token: access_token,
          });

          accountInfo = await getUserInfo(access_token);

        }
    } 


    console.log("Account Info:", accountInfo)

    const results = await getSigningURL(accountInfo.baseUri, accountInfo.accountId, access_token, "Parent 1");
    res.json( results.redirectUrl );  
  
   
  } catch (error) {
    console.error(JSON.stringify(error));
    res.status(error.status || 500).json({ error: error.message || 'Failed to get signing URL', status: error.status || 500 });
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



async function getSigningURL(baseUri, accountId, accessToken, parentName) {
  const apiClient = new docusign.ApiClient();
  apiClient.setBasePath(baseUri + '/restapi');
  apiClient.addDefaultHeader('Authorization', `Bearer ${accessToken}`);

  const envelopesApi = new docusign.EnvelopesApi(apiClient);

  const envelopeDefinition = new docusign.EnvelopeDefinition();
  envelopeDefinition.emailSubject = 'Please sign this document';

  // Add a document to the envelope
  const documentBytes = fs.readFileSync(path.resolve('./test.pdf'));
  const documentBase64 = documentBytes.toString('base64');

  const document = new docusign.Document();
  document.documentBase64 = documentBase64;
  document.name = 'Sample Document'; 
  document.fileExtension = 'pdf'; 
  document.documentId = '1'; 
  envelopeDefinition.documents = [document];

  const signer = new docusign.Signer();
  signer.email = CONFIG.clientEmail 
  signer.name = parentName; 
  signer.recipientId = '1';
  signer.clientUserId = CONFIG.clientUserId

  const signHere = new docusign.SignHere();
  signHere.anchorString = '**signature_1**'; 
  signHere.anchorUnits = 'pixels';
  signHere.anchorXOffset = '20';
  signHere.anchorYOffset = '10';

  const tabs = new docusign.Tabs();
  tabs.signHereTabs = [signHere];
  signer.tabs = tabs;

  envelopeDefinition.recipients = new docusign.Recipients();
  envelopeDefinition.recipients.signers = [signer];
  envelopeDefinition.status = 'sent'; // Set envelope status to "sent" to immediately send it

  // Send the envelope
  const results = await envelopesApi.createEnvelope(accountId, {
    envelopeDefinition,
  });
  
  let viewRequest = makeRecipientViewRequest(parentName);

  const rv_results = await envelopesApi.createRecipientView(accountId, results.envelopeId, {
    recipientViewRequest: viewRequest,
  });

  return { envelopeId: results.envelopeId, redirectUrl: rv_results };
}

function makeRecipientViewRequest(parentName) {
  // Data for this method
  // args.dsReturnUrl
  // args.signerEmail
  // args.signerName
  // args.signerClientId
  // args.dsPingUrl

  let viewRequest = new docusign.RecipientViewRequest();

  // Set the url where you want the recipient to go once they are done signing
  // should typically be a callback route somewhere in your app.
  // The query parameter is included as an example of how
  // to save/recover state information during the redirect to
  // the DocuSign signing. It's usually better to use
  // the session mechanism of your web framework. Query parameters
  // can be changed/spoofed very easily.
  viewRequest.returnUrl = "https://cdn.tanuj.xyz/auth-done.png"

  // How has your app authenticated the user? In addition to your app's
  // authentication, you can include authenticate steps from DocuSign.
  // Eg, SMS authentication
  viewRequest.authenticationMethod = 'none';

  // Recipient information must match embedded recipient info
  // we used to create the envelope.
  viewRequest.email = CONFIG.clientEmail;
  viewRequest.userName = parentName;
  viewRequest.clientUserId = CONFIG.clientUserId

  // DocuSign recommends that you redirect to DocuSign for the
  // embedded signing. There are multiple ways to save state.
  // To maintain your application's session, use the pingUrl
  // parameter. It causes the DocuSign signing web page
  // (not the DocuSign server) to send pings via AJAX to your
  // app,
  // NOTE: The pings will only be sent if the pingUrl is an https address

  return viewRequest;
}

// Start server
app.listen(port, () => {
  console.log(`Server running at ${backendURL}:${port}`);
});
