// firebase.js
const { initializeApp, cert } = require("firebase-admin/app");
const { getStorage } = require("firebase-admin/storage");
const { getFirestore } = require("firebase-admin/firestore");
const firebaseKey = require("./firebase-key.json");

// Initialize Firebase
const app = initializeApp({
  credential: cert(firebaseKey),
  storageBucket: "edusign-d5abd.firebasestorage.app",
});

// Export Firestore and Storage for use in other files
const db = getFirestore();
const bucket = getStorage().bucket();

module.exports = { db, bucket };
