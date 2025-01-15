const axios = require("axios");
const { CONFIG } = require("./config");
const { db, bucket } = require("./firebase");

const TWILIO_CONFIG = {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER,
};


const SignatureChecker = require("./signature");
const signatureChecker = new SignatureChecker(db, TWILIO_CONFIG);

async function remindParents(req, res) {
    const { documentId } = req.params;

    try {
      const callResults = await signatureChecker.triggerReminderCalls(documentId);
      res.status(200).json({ success: true, callResults });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
}


module.exports = {
    remindParents
}