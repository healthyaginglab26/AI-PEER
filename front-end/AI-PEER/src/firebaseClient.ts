import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { Platform } from "react-native";

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || "AIzaSyFakeKeyForLocalDevOnly0000000",
  authDomain:
    process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || "localhost:9099",
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || "ai-peer",
  storageBucket:
    process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || "ai-peer.appspot.com",
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "000000000000",
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || "1:000000000000:web:0000000000000000",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

// Connect to local Firebase Auth emulator if configured in development
if (__DEV__ && process.env.EXPO_PUBLIC_USE_EMULATOR === "true") {
  try {
    const defaultHost = Platform.OS === "android" ? "http://10.0.2.2:9099" : "http://localhost:9099";
    const authHost = process.env.EXPO_PUBLIC_AUTH_EMULATOR_HOST || defaultHost;
    connectAuthEmulator(auth, authHost, { disableWarnings: true });
    console.log(`[FIREBASE] Client connected to Auth emulator at ${authHost}`);
  } catch (e: any) {
    console.warn("[FIREBASE] Auth emulator connection skipped:", e.message);
  }
}
