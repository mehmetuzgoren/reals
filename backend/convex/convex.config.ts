import { defineApp } from "convex/server";
import { v } from "convex/values";
import auth from "@convex-dev/auth/convex.config.js";
import authApple from "@convex-dev/auth/components/apple/convex.config.js";
import authPassword from "@convex-dev/auth/components/password/convex.config.js";
import authUsername from "@convex-dev/auth/components/username/convex.config.js";

const app = defineApp({ env: {
  AUTH_APPLE_CLIENT_ID: v.string(),
  AUTH_APPLE_TEAM_ID: v.string(),
  AUTH_APPLE_KEY_ID: v.string(),
  AUTH_APPLE_PRIVATE_KEY: v.string(),
} });
app.use(auth);
app.use(authApple, { httpPrefix: "/oauth/apple", env: {
  CLIENT_ID: app.env.AUTH_APPLE_CLIENT_ID,
  TEAM_ID: app.env.AUTH_APPLE_TEAM_ID,
  KEY_ID: app.env.AUTH_APPLE_KEY_ID,
  PRIVATE_KEY: app.env.AUTH_APPLE_PRIVATE_KEY,
} });
app.use(authPassword);
app.use(authUsername);
export default app;
