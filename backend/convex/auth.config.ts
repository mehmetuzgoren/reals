import type { AuthConfig } from "convex/server";

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId || !/^[a-z][a-z0-9-]{3,62}$/.test(projectId)) {
  throw new Error("Configure FIREBASE_PROJECT_ID before deploying TAKE");
}

export default {
  providers: [{
    type: "customJwt",
    issuer: `https://securetoken.google.com/${projectId}`,
    applicationID: projectId,
    jwks: "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
    algorithm: "RS256",
  }],
} satisfies AuthConfig;
