// config.js
require("dotenv").config();
const { OpenAI } = require("openai");

const backendURL =
  process.env.NODE_ENV === "development"
    ? `http://localhost:8080`
    : "https://backend-375617093037.us-central1.run.app";


const CONFIG = {
  clientId: "3e981cbc-6bca-4c25-9453-0c927ecdfb84",
  clientUserId: "1193ac53-5f9d-40bb-9651-8f063fa0d603",
  clientEmail: "tanujsiripurapu@gmail.com",
  clientSecret: "85db939f-5b56-4207-9921-ad3ebee5b587",
  authRedirectUri: `${backendURL}/api/save-teacher-token`,
  authServer: "https://account-d.docusign.com",
  PORT: 8080,
  TWILIO_CONFIG: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER,
  },
  DOCUSIGN_PAYMENT_GATEWAY_ID: process.env.DOCUSIGN_PAYMENT_GATEWAY_ID,
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });


module.exports = {
  CONFIG,
  openai,
  backendURL
};