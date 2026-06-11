// config.example.js — Copy to config.js and fill in your real values.
// config.js is gitignored — NEVER commit your real keys.
// Better: run `node generate-config.js` to auto-generate config.js from .env

window.FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID",
  measurementId:     "YOUR_MEASUREMENT_ID",
  // Required for Realtime Database — find it in Firebase Console → Realtime Database → Data tab
  databaseURL:       "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
};
