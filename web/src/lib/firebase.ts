"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "demo-key",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || undefined,
};

let authInstance: Auth | null = null;

/** Lazily initialised so nothing runs during server rendering. */
export function firebaseAuth(): Auth {
  if (authInstance) return authInstance;
  const app = getApps().length ? getApp() : initializeApp(config);
  const auth = getAuth(app);
  if (process.env.NEXT_PUBLIC_USE_EMULATORS === "true") {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    // Test phone numbers configured in the emulator (and, later, the console)
    // need no reCAPTCHA. Keeps the OTP flow free of SMS in development.
    auth.settings.appVerificationDisabledForTesting = true;
  }
  authInstance = auth;
  return auth;
}
