"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "demo-key",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || undefined,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || undefined,
};

/** Google Analytics (GA4) page views and sessions. Off locally and in tests: needs a measurement id. */
function startAnalytics(app: ReturnType<typeof getApp>) {
  if (!config.measurementId || process.env.NEXT_PUBLIC_USE_EMULATORS === "true") return;
  import("firebase/analytics")
    .then(async ({ getAnalytics, isSupported }) => {
      if (await isSupported()) getAnalytics(app);
    })
    .catch(() => {});
}

let authInstance: Auth | null = null;

/** Lazily initialised so nothing runs during server rendering. */
export function firebaseAuth(): Auth {
  if (authInstance) return authInstance;
  const app = getApps().length ? getApp() : initializeApp(config);
  startAnalytics(app);
  const auth = getAuth(app);
  if (process.env.NEXT_PUBLIC_USE_EMULATORS === "true") {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  }
  authInstance = auth;
  return auth;
}
