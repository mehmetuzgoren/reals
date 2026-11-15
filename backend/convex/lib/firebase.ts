"use node";

import { cert, getApps, initializeApp } from "firebase-admin/app";

export function firebaseApp() {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!json || !projectId) throw new Error("Firebase server credentials are not configured");
  const serviceAccount = JSON.parse(json);
  if (serviceAccount.project_id !== projectId) throw new Error("Firebase service account project does not match authentication");
  return getApps().find(app => app.name === "take-server") ?? initializeApp({ credential: cert(serviceAccount), projectId }, "take-server");
}
