// Import the functions you need from the SDKs you need
import { initializeApp, getApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, Firestore,
} from "firebase/firestore";
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

// Offline persistence: staff routinely have this open in more than one tab/
// device at the counter, so persistence must support multiple tabs sharing
// one local cache (persistentMultipleTabManager) rather than the older
// single-tab persistence, which used to throw 'failed-precondition' the
// moment a second tab opened. With this enabled, reads are served from the
// local cache when offline and writes are queued and replayed automatically
// on reconnect — no app code needs to know a write happened offline.
//
// initializeFirestore can still fail synchronously in a handful of real
// environments (no IndexedDB at all, e.g. some in-app/webview browsers or
// very old Safari private-browsing modes) — falling back to the plain
// memory-only client keeps the app usable rather than crashing on startup;
// staff just lose the "keep working through a refresh while offline" benefit
// in that one uncommon case.
let db: Firestore;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch (err) {
  console.warn('Firestore persistent cache unavailable — falling back to memory-only Firestore.', err);
  db = getFirestore(app);
}
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
