// Refresh token storage. The token is a 30-day bearer — leaking it is a
// full account takeover, so it lives in expo-secure-store:
//   - iOS: Keychain (hardware-backed on devices with Secure Enclave)
//   - Android: EncryptedSharedPreferences backed by Android Keystore
// Before this module existed the token sat in plaintext AsyncStorage. The
// getRefreshToken() one-shot migration below keeps existing users signed
// in across the upgrade: first run after update moves the legacy value into
// SecureStore and wipes it from AsyncStorage.
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "refreshToken";

export async function getRefreshToken(): Promise<string | null> {
    if (Platform.OS === "web") {
        return await AsyncStorage.getItem(KEY);
    }

    const secure = await SecureStore.getItemAsync(KEY);
    if (secure) return secure;

    const legacy = await AsyncStorage.getItem(KEY);
    if (legacy) {
        await SecureStore.setItemAsync(KEY, legacy);
        await AsyncStorage.removeItem(KEY);
        return legacy;
    }
    return null;
}

export async function setRefreshToken(value: string): Promise<void> {
    if (Platform.OS === "web") {
        await AsyncStorage.setItem(KEY, value);
        return;
    }
    await SecureStore.setItemAsync(KEY, value);
}

export async function clearRefreshToken(): Promise<void> {
    if (Platform.OS !== "web") {
        await SecureStore.deleteItemAsync(KEY);
    }
    // belt-and-suspenders during the rollout window (and primary store on web):
    // wipe the AsyncStorage copy on every clear.
    await AsyncStorage.removeItem(KEY);
}
