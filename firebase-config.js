// Firebase web config for the tajweed-companion project.
//
// These are public identifiers, not secrets: Firebase sends them to every
// visitor's browser by design. What protects the data is the Firestore
// security rules, which let each signed-in user read and write only their own
// progress record.
//
// Until apiKey and appId are filled in, sync.js stays switched off and the
// site keeps progress per device, exactly as before.
window.FIREBASE_CONFIG = {
  apiKey: "PASTE_API_KEY",
  authDomain: "tajweed-companion.firebaseapp.com",
  projectId: "tajweed-companion",
  appId: "PASTE_APP_ID"
};
