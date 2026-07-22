import { initializeApp, getApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getAI, getGenerativeModel, GoogleAIBackend } from "firebase/ai";

const firebaseConfig = {
  apiKey: "AIzaSyA0FwkoIdv-6vtPuphrT_1C_s365Qu1qfE",
  authDomain: "oneseco-io-trillastrobuzz.firebaseapp.com",
  projectId: "oneseco-io-trillastrobuzz",
  storageBucket: "oneseco-io-trillastrobuzz.firebasestorage.app",
  messagingSenderId: "359386666459",
  appId: "1:359386666459:web:e75e711c730bd06d7143fe",
  measurementId: "G-Q6GE30T5QR",
  databaseURL: "https://oneseco-io-trillastrobuzz-default-rtdb.firebaseio.com"
};

// Initialize Firebase App
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Initialize Services
export const auth = getAuth(app);
export const db = getFirestore(app);

// Initialize the AI service using Google AI Backend (Gemini Developer API)
const ai = getAI(app, { backend: new GoogleAIBackend() });

// Create generative model instance using gemini-2.5-flash
export const geminiModel = getGenerativeModel(ai, { model: "gemini-2.5-flash" });
export default app;
