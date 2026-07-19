// Central Firebase bootstrap. Every other module imports `db`/`auth`
// (and the helpers they re-export) from here instead of hitting the CDN
// directly, so there is exactly one place that knows the SDK version.
//
// NOTE: Cloud Storage for Firebase is intentionally NOT used here — as of
// late 2024 it requires the paid Blaze plan even for free-tier-sized usage.
// Media files (images/video/audio) are uploaded to Cloudinary instead (see
// cloudinary-upload.js); only their resulting URLs are stored in Firestore.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  writeBatch,
  increment,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// The one admin account, created manually in the Firebase console
// (Authentication → Users → Add user). Must be created with this exact
// lowercase email — Admin.html's login form accepts "Admin@gmail.com" in
// any casing and lowercases it before signing in.
export const ADMIN_EMAIL = "admin@gmail.com";

export {
  collection,
  doc,
  addDoc,
  setDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  writeBatch,
  increment,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
};
