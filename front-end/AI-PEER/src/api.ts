import { Platform } from "react-native";
import * as Device from "expo-device";

function getBaseUrl(): string {
  if (process.env.EXPO_PUBLIC_API_BASE_URL) {
    let url = process.env.EXPO_PUBLIC_API_BASE_URL;
    // When running in an Android emulator (not a physical USB-connected phone),
    // localhost refers to the emulator itself. Rewrite localhost to 10.0.2.2
    // ONLY on emulators so physical devices using `adb reverse tcp:8085 tcp:8085`
    // keep connecting to localhost:8085.
    if (Platform.OS === "android" && !Device.isDevice && url.includes("localhost")) {
      url = url.replace("localhost", "10.0.2.2");
    }
    return url;
  }
  return "https://aipeer-api-596437694331.us-central1.run.app";
}

const BASE = getBaseUrl();

// Reusable JSON fetch helper (single definition)
async function requestJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    // Surface the server message if available
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}


export const api = {
  health: () => requestJSON<{ status: string; version?: string }>("/health"),

  riskSummary: () =>
    requestJSON<{ score: number; level: string }>("/risk/summary"),

  login: (phone: string, password: string) =>
    requestJSON<{ customToken: string; user?: { id: string; name?: string } }>(
      "/auth/login",
      { method: "POST", body: JSON.stringify({ phone, password }) }
    ),

  createAccount: (phone: string, password: string) =>
    requestJSON<{ success: boolean; userId: string; message: string }>(
      "/auth/register",
      { method: "POST", body: JSON.stringify({ phone, password }) }
    ),

  sendCode: (phone: string, password: string, mode: "login" | "create", btrackScore?: number) =>
    requestJSON<{ success: boolean; message: string; expiresIn: number }>(
      "/auth/send-code",
      {
        method: "POST",
        body: JSON.stringify({ phone, password, mode, ...(btrackScore != null && { btrackScore }) }),
      }
    ),

  verify: (phone: string, code: string) =>
    requestJSON<{
      success: boolean;
      customToken: string;
      refreshToken: string;
      userId: string;
      isNewUser: boolean;
    }>("/auth/verify", {
      method: "POST",
      body: JSON.stringify({ phone, code }),
    }),

  // Phone verification via the Firebase native SDK (see src/auth/phoneVerification.ts)
  checkCredentials: (phone: string, password: string, mode: "login" | "create") =>
    requestJSON<{ success: boolean }>("/auth/check-credentials", {
      method: "POST",
      body: JSON.stringify({ phone, password, mode }),
    }),

  phoneLogin: (idToken: string, password: string, mode: "login" | "create", btrackScore?: number) =>
    requestJSON<{
      success: boolean;
      customToken: string;
      refreshToken: string;
      userId: string;
      isNewUser: boolean;
    }>("/auth/phone-login", {
      method: "POST",
      body: JSON.stringify({ idToken, password, mode, ...(btrackScore != null && { btrackScore }) }),
    }),

  refresh: (refreshToken: string) =>
    requestJSON<{ success: boolean; customToken: string; userId: string }>(
      "/auth/refresh",
      { method: "POST", body: JSON.stringify({ refreshToken }) }
    ),

  // user identity comes from the bearer token on the server side, so no id
  // is sent from the client. passing one would be ignored.
  getUser: (token: string) =>
    requestJSON<{ message: string; user: Record<string, any> }>("/users/get", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    }),

  updateUser: (data: Record<string, any>, token: string) =>
    requestJSON<{ message: string }>("/users/update", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    }),

  getModelURL: (token: string) =>
    requestJSON<{ modelUrl: string; filename: string; expiresIn: number }>(
      "/model/getModelURL",
      { method: "GET", headers: { Authorization: `Bearer ${token}` } }
    ),
};

export { BASE };
