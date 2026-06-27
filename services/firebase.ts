// Import the functions you need from the SDKs you need
import { initializeApp, getApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

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

export { app, auth, db };
