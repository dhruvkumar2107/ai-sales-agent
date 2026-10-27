import admin from "firebase-admin";
import { env } from "../config";

let app: admin.app.App | null = null;

/** Lazily initialise firebase-admin. Supports inline service-account env vars or GOOGLE_APPLICATION_CREDENTIALS. */
export function firebase(): admin.app.App {
  if (app) return app;
  const credential =
    env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY
      ? admin.credential.cert({
          projectId: env.FIREBASE_PROJECT_ID,
          clientEmail: env.FIREBASE_CLIENT_EMAIL,
          privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        })
      : admin.credential.applicationDefault();
  app = admin.initializeApp({
    credential,
    projectId: env.FIREBASE_PROJECT_ID,
    storageBucket: env.FIREBASE_STORAGE_BUCKET,
  });
  return app;
}

export const firestore = () => firebase().firestore();
export const firebaseAuth = () => firebase().auth();
export const storageBucket = () => firebase().storage().bucket();
