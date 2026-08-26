// Import the functions you need from the SDKs you need
import { initializeApp, getApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyC01xsACikMlGTd0p_PA52q9Ai5-cHqptU",
  authDomain: "ftt-dashboardgit-0945496-a85e0.firebaseapp.com",
  projectId: "ftt-dashboardgit-0945496-a85e0",
  storageBucket: "ftt-dashboardgit-0945496-a85e0.appspot.com",
  messagingSenderId: "938398391430",
  appId: "1:938398391430:web:bcfc87858048c44646c507"
};

// Initialize Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);
// Cloud Functions client — the Gemini API key lives server-side in the
// `aiGenerate` callable, so no key is ever shipped to the browser.
const functions = getFunctions(app);
// Cloud Storage — holds the automated backup snapshots written by the
// scheduledBackups Cloud Function under backups/{workspaceId}/. It is only
// reached from the owner-only backup-history panel, so the SDK is imported on
// demand rather than shipped in the first-load bundle for every user.
export const loadStorage = async () => {
  const { getStorage } = await import("firebase/storage");
  return getStorage(app);
};

export { app, auth, db, functions };
