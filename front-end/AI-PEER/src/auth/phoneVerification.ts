// src/auth/phoneVerification.ts
//
// SMS 2FA through the Firebase native SDK (Android).
//
// Google now rejects SMS requests sent from our API server without app
// verification (MISSING_CLIENT_IDENTIFIER). The native SDK can prove the
// request comes from the real app (Play Integrity, or a reCAPTCHA fallback),
// so the app now sends and confirms the code itself and hands the backend a
// Firebase ID token as proof (POST /auth/phone-login).
//
// iOS isn't linked yet (see react-native.config.js) and keeps the old flow.

import { Platform } from "react-native";

export type PhoneAuthMode = "login" | "create";

type Pending = {
  phone: string;
  password: string;
  mode: PhoneAuthMode;
  btrackScore?: number;
  confirmation: any;
};

// Kept in memory only, never in route params or storage, because it holds
// the password until the backend has checked it.
let pending: Pending | null = null;

export const nativePhoneAuthAvailable = Platform.OS === "android";

function nativeAuth() {
  // Lazy require so platforms without the native module never load it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- must stay lazy: iOS has no native module linked yet
  return require("@react-native-firebase/auth").default();
}

export function toE164(phone: string) {
  const d = (phone || "").replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? `+${d}` : `+1${d}`;
}

/** Sends the SMS. Call after the backend has accepted the credentials. */
export async function startPhoneVerification(
  phone: string,
  password: string,
  mode: PhoneAuthMode,
  btrackScore?: number
) {
  const confirmation = await nativeAuth().signInWithPhoneNumber(toE164(phone));
  pending = { phone, password, mode, btrackScore, confirmation };
}

export function hasPendingVerification(phone: string) {
  return !!pending && pending.phone === phone;
}

/** Checks the 6-digit code with Firebase and returns proof for the backend. */
export async function confirmPhoneCode(code: string) {
  if (!pending) throw new Error("No verification in progress. Please request a new code.");
  const auth = nativeAuth();
  let user: any = null;
  try {
    const cred = await pending.confirmation.confirm(code);
    user = cred?.user ?? auth.currentUser;
  } catch (e) {
    // Android can read the SMS and verify automatically, after which
    // confirm() fails even though we're already signed in. Also covers a
    // retry after the backend call failed.
    const current = auth.currentUser;
    if (current?.phoneNumber === toE164(pending.phone)) user = current;
    else throw e;
  }
  if (!user) throw new Error("Phone verification failed.");
  const idToken: string = await user.getIdToken(true);
  const { password, mode, btrackScore } = pending;
  return { idToken, password, mode, btrackScore };
}

/** Clears the pending state and signs out the temporary phone-auth user. */
export async function finishPhoneVerification() {
  pending = null;
  try {
    await nativeAuth().signOut();
  } catch {}
}

/** Friendly message for Firebase phone-auth errors, or null if not one. */
export function phoneAuthErrorMessage(e: any): string | null {
  switch (e?.code) {
    case "auth/invalid-verification-code":
      return "Invalid code. Please try again.";
    case "auth/session-expired":
    case "auth/code-expired":
      return "Code expired. Please go back and request a new code.";
    case "auth/invalid-phone-number":
      return "Invalid phone number format.";
    case "auth/too-many-requests":
    case "auth/quota-exceeded":
      return "Too many attempts. Please try again later.";
    case "auth/network-request-failed":
      return "No internet connection. Please try again.";
    case "auth/app-not-authorized":
    case "auth/missing-client-identifier":
      return "This app build isn't registered with Firebase yet (SHA fingerprint / Play Integrity).";
    default:
      return null;
  }
}
