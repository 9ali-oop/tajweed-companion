// Firebase web config for the tajweed-companion project.
//
// These are public identifiers, not secrets: Firebase sends them to every
// visitor's browser by design. What protects the data is the Firestore
// security rules, which let each signed-in user read and write only their own
// progress record.
//
// If apiKey or appId is ever blanked, sync.js switches itself off and the
// site falls back to keeping progress per device.
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyAOEcbMB6ZIRB2SMNtV6Boh6PU9B06GzpY",
  authDomain: "tajweed-companion.firebaseapp.com",
  projectId: "tajweed-companion",
  appId: "1:869722736392:web:96f997c5ab7b0a24bf8ebd"
};
