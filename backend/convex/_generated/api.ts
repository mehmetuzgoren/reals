/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as admin from "../admin.js";
import type * as auth from "../auth.js";
import type * as authUsers from "../authUsers.js";
import type * as blocks from "../blocks.js";
import type * as captions from "../captions.js";
import type * as cleanup from "../cleanup.js";
import type * as crons from "../crons.js";
import type * as dev from "../dev.js";
import type * as devices from "../devices.js";
import type * as friends from "../friends.js";
import type * as http from "../http.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_dto from "../lib/dto.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_http from "../lib/http.js";
import type * as lib_pushProvider from "../lib/pushProvider.js";
import type * as lib_schedule from "../lib/schedule.js";
import type * as lib_verification from "../lib/verification.js";
import type * as media from "../media.js";
import type * as notifications from "../notifications.js";
import type * as planner from "../planner.js";
import type * as profiles from "../profiles.js";
import type * as push from "../push.js";
import type * as replies from "../replies.js";
import type * as reports from "../reports.js";
import type * as rounds from "../rounds.js";
import type * as takes from "../takes.js";
import type * as uploadState from "../uploadState.js";
import type * as uploads from "../uploads.js";
import type * as viewer from "../viewer.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  admin: typeof admin;
  auth: typeof auth;
  authUsers: typeof authUsers;
  blocks: typeof blocks;
  captions: typeof captions;
  cleanup: typeof cleanup;
  crons: typeof crons;
  dev: typeof dev;
  devices: typeof devices;
  friends: typeof friends;
  http: typeof http;
  "lib/access": typeof lib_access;
  "lib/auth": typeof lib_auth;
  "lib/dto": typeof lib_dto;
  "lib/errors": typeof lib_errors;
  "lib/http": typeof lib_http;
  "lib/pushProvider": typeof lib_pushProvider;
  "lib/schedule": typeof lib_schedule;
  "lib/verification": typeof lib_verification;
  media: typeof media;
  notifications: typeof notifications;
  planner: typeof planner;
  profiles: typeof profiles;
  push: typeof push;
  replies: typeof replies;
  reports: typeof reports;
  rounds: typeof rounds;
  takes: typeof takes;
  uploadState: typeof uploadState;
  uploads: typeof uploads;
  viewer: typeof viewer;
}> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
> = anyApi as any;

export const components = componentsGeneric() as unknown as {
  auth: import("@convex-dev/auth/_generated/component.js").ComponentApi<"auth">;
  authApple: import("@convex-dev/auth/components/apple/_generated/component.js").ComponentApi<"authApple">;
  authPassword: import("@convex-dev/auth/components/password/_generated/component.js").ComponentApi<"authPassword">;
  authUsername: import("@convex-dev/auth/components/username/_generated/component.js").ComponentApi<"authUsername">;
};
