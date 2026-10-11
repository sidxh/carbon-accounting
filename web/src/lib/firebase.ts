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

/** Where the sign-in email comes from, shown on the sign-in page so people can find it in spam. Set
 * NEXT_PUBLIC_AUTH_EMAIL_SENDER once the sender domain is customised in Authentication > Templates. */
export const AUTH_EMAIL_SENDER =
  process.env.NEXT_PUBLIC_AUTH_EMAIL_SENDER || `noreply@${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "firebaseapp"}.firebaseapp.com`;

let authInstance: Auth | null = null;

/** Lazily initialised so nothing runs during server rendering. */
export function firebaseAuth(): Auth {
  if (authInstance) return authInstance;
  const app = getApps().length ? getApp() : initializeApp(config);
  const auth = getAuth(app);
  if (process.env.NEXT_PUBLIC_USE_EMULATORS === "true") {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  }
  authInstance = auth;
  return auth;
}
