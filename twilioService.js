const axios = require("axios");
const { CONFIG } = require("./config");
const { db, bucket } = require("./firebase");
require("dotenv").config();

const TWILIO_CONFIG = {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER,
};


const SignatureChecker = require("./signature");
const { extractToken, verifyToken, sendPushNotification } = require("./utils");
const signatureChecker = new SignatureChecker(db, TWILIO_CONFIG);

async function callParents(req, res) {
    const { document_id } = req.query;

    try {
      const callResults = await signatureChecker.triggerReminderCalls(document_id);
      res.status(200).json({ success: true, callResults });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
}

async function remindAllParents(req, res) {
      const { document_id } = req.query;

      const doc = await db.collection("documents").doc(document_id).get();

      if (!doc.exists) {
        throw new Error("Document not found");
      }

      const documentData = doc.data();

      console.log("Document Data:", documentData); 
      console.log("Envelopes:", documentData.docusign_envelopes); 

      for (const envelope of documentData.docusign_envelopes || []) {
        console.log("Processing envelope:", envelope); 

        if (!envelope.studentHasSigned) {
            const studentDoc = await db.collection("users").doc(envelope.student_id).get()
            const studentData = studentDoc.data()
            
            if (!studentData) {
              continue
            }
            
            await sendPushNotification({expoPushToken: studentData?.expoPushToken, title: "Student Reminder", body: `You still have not signed ${documentData.file_name}`})
        }

        if (!envelope.parentHasSigned) {
          const studentDoc = await db.collection("users").doc(envelope.student_id).get()
          const studentData = studentDoc.data()

          if (!studentData) {
            continue
          }

          const parentDoc = await db.collection("users").doc(studentData.parentID).get()
          const parentData = parentDoc.data()

          await sendPushNotification({expoPushToken: parentData?.expoPushToken, title: "Parent Reminder", body: `You still have not signed ${documentData.file_name}`})
        }
      }

      res.json({ success: true })
}

async function remindStudentOrParent(req, res) {
    const token = extractToken(req, res)
    const user_id = await verifyToken(token)

    //student_id will only be filled if user.type is parent
    const { document_id, student_id } = req.query;

    if (!user_id) {
      return res.status(404).json({ success: false, message: "User not found"})
    }

    if (!document_id) {
      return res.status(404).json({ success: false, message: "No document provided"})
    }

    const userDoc = await db.collection("users").doc(user_id).get()
    const userData = userDoc.data()

    if (userData.type == "parent" && !student_id) {
      return res.status(404).json({ success: false, message: "No student id provided"})
    }

    const firebaseDoc = await db.collection("documents").doc(document_id).get()
    const firebaseData = firebaseDoc.data()

    if (userData.type == "student") {
        const parentDoc = await db.collection("users").doc(userData.parentID).get()
        const parentData = parentDoc.data()

        await sendPushNotification({expoPushToken: parentData.expoPushToken, title: "Parent Reminder", body: `You still have not signed ${firebaseData.file_name}`})
    } else if (userData.type == "parent") {
        const student = userData.children.find(child => child.id === student_id)

        if (!student) {
            return res.status(404).json({ success: false, message: "No student found"})
        }

        const studentDoc = await db.collection("users").doc(student.id).get()
        const studentData = studentDoc.data()

        await sendPushNotification({expoPushToken: studentData.expoPushToken, title: "Student Reminder", body: `You still have not signed ${firebaseData.file_name}`})
    } 

    res.json({ success: true })
}


module.exports = {
  callParents,
  remindStudentOrParent,
  remindAllParents
}