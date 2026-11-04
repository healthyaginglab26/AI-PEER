// app/_layout.tsx
import { useEffect } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import { LLMProvider } from "@/src/llm";
import { AuthProvider } from "@/src/auth";
import { PrefsProvider, usePrefs } from "../src/prefs-context";
import { VisionProvider } from "@/src/vision";
import * as Notifications from "expo-notifications";
import { requestReminderPermissions } from "@/src/reminder-notifications";
import "../src/i18n";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function RootStack() {
  const { colors } = usePrefs();

  // Ask for notification permission on first launch. iOS only shows the
  // system prompt once; after that requestPermissionsAsync returns the
  // stored status without surfacing UI, so this is safe to call on every
  // mount.
  useEffect(() => {
    requestReminderPermissions().catch(() => {});
  }, []);

  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.background },
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text },
      }}
    >
      {/* Landing (Login) */}
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />

      {/* Welcome - Accessibility Changes */}
      <Stack.Screen name="welcome" options={{ headerShown: false }} />

      {/* Verify - 2FA */}
      <Stack.Screen name="verify" options={{ headerShown: false }} />

      {/* Tabs group (Home/AI Chat/Activity/Contacts/Settings) */}
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />

      {/* Questionnaire */}
      <Stack.Screen name="questionnaire" options={{ headerShown: false }} />

      {/* Chat History - accessible from AI Chat */}
      <Stack.Screen name="chat-history" options={{ headerShown: false }} />

      {/* Optional routes from the Expo template */}
      <Stack.Screen name="modal" options={{ presentation: "modal", title: "Modal" }} />
      <Stack.Screen name="+not-found" options={{ title: "Not found" }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <LLMProvider>
        <PrefsProvider>
          <VisionProvider>
            {Platform.OS === "web" ? (
              <View style={webStyles.outerBackdrop}>
                <View style={webStyles.phoneFrame}>
                  <RootStack />
                </View>
              </View>
            ) : (
              <RootStack />
            )}
          </VisionProvider>
        </PrefsProvider>
      </LLMProvider>
    </AuthProvider>
  );
}

const webStyles = StyleSheet.create({
  outerBackdrop: {
    flex: 1,
    backgroundColor: "#1e293b",
    alignItems: "center",
    justifyContent: "center",
  },
  phoneFrame: {
    width: "100%",
    maxWidth: 430,
    height: "100%",
    maxHeight: 932,
    overflow: "hidden",
    boxShadow: "0px 10px 40px rgba(0, 0, 0, 0.35)",
  } as any,
});

