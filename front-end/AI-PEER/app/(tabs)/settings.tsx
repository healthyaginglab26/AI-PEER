// app/(tabs)/settings.tsx
import { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  Switch,
  Vibration,
  Alert,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
} from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { scaleFontSizes } from "../../src/theme";
import type { Prefs } from "../../src/prefs-context";
import { usePrefs } from "../../src/prefs-context";
import { useAuth } from "../../src/auth";
import { type ContrastPalette } from "../../src/theme";
import {
  requestReminderPermissions,
  scheduleReminderNotification,
  cancelReminderNotification,
  scheduleTestNotification,
} from "../../src/reminder-notifications";

type SettingsTab = "accessibility" | "notifications";
type Reminder = {
  id: string;
  title: string;
  hour: number;
  minute: number;
  enabled: boolean;
  notificationId?: string;
};

export default function SettingsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [tab, setTab] = useState<SettingsTab>("accessibility");
  const { prefs, updatePrefs, scaled, colors } = usePrefs();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { logout } = useAuth();
  const REMINDERS_KEY = "user_reminders_v1";
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [remindersLoaded, setRemindersLoaded] = useState(false);

  async function addReminder(title: string, hour: number, minute: number) {
    const permissionGranted = await requestReminderPermissions();
    if (!permissionGranted) {
      Alert.alert(t("settings.notifsDisabled"), t("settings.notifsAlert"));
      return;
    }

    const id = Date.now().toString();

    const reminderBase: Reminder = {
      id,
      title,
      hour,
      minute,
      enabled: true,
    };

    const notificationId = await scheduleReminderNotification(reminderBase);

    setReminders((r) => [
      { ...reminderBase, notificationId },
      ...r,
    ]);
  }

  async function deleteReminder(id: string) {
    const existing = reminders.find((x) => x.id === id);
    if (existing?.notificationId) {
      await cancelReminderNotification(existing.notificationId);
    }
    setReminders((r) => r.filter((x) => x.id !== id));
  }

  async function toggleReminder(id: string) {
    const existing = reminders.find((x) => x.id === id);
    if (!existing) return;

    if (existing.enabled) {
      await cancelReminderNotification(existing.notificationId);
      setReminders((r) =>
        r.map((x) =>
          x.id === id ? { ...x, enabled: false, notificationId: undefined } : x
        )
      );
    } else {
      const permissionGranted = await requestReminderPermissions();
      if (!permissionGranted) {
        Alert.alert(t("settings.notifsDisabled"), t("settings.notifsAlert"));
        return;
      }

      const notificationId = await scheduleReminderNotification(existing);

      setReminders((r) =>
        r.map((x) =>
          x.id === id ? { ...x, enabled: true, notificationId } : x
        )
      );
    }
  }

  // Load reminders from AsyncStorage once on mount
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(REMINDERS_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as Reminder[];
          setReminders(parsed);
        }
      } catch {
        // ignore; reminders stay empty until the user adds one
      } finally {
        setRemindersLoaded(true);
      }
    })();
  }, []);

  // Persist reminders whenever they change (after initial load)
  useEffect(() => {
    if (!remindersLoaded) return;
    (async () => {
      try {
        await AsyncStorage.setItem(REMINDERS_KEY, JSON.stringify(reminders));
      } catch {
        // no-op
      }
    })();
  }, [reminders, remindersLoaded]);

  async function playAlertPreview() {
    if (!prefs.soundAlerts) return;
    // Small haptic tap immediately so the button feels responsive while
    // the system notification spins up ~1s later.
    if (Platform.OS !== "web") Vibration.vibrate(80);
    const scheduled = await scheduleTestNotification();
    if (!scheduled) {
      Alert.alert(t("settings.notifsDisabled"), t("settings.notifsAlert"));
    }
  }

  async function performLogout() {
    const LOGIN_ROUTE = "/login";
    try {
      await logout();
      const mod = await import("@react-native-async-storage/async-storage");
      await mod.default.removeItem("token");
      await mod.default.removeItem("user");
    } catch {
      // no-op
    }
    router.replace(LOGIN_ROUTE);
  }

  function handleLogout() {
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(t("settings.logoutConfirmation"))) {
        void performLogout();
      }
      return;
    }

    Alert.alert(t("settings.logout"), t("settings.logoutConfirmation"), [
      { text: t("settings.cancel"), style: "cancel" },
      {
        text: t("settings.logout"),
        style: "destructive",
        onPress: () => {
          void performLogout();
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.accent} />
            <View>
              <Text style={[styles.brand, { fontSize: scaled.h3 }]}>AI PEER</Text>
              <Text style={[styles.subtitle, { fontSize: scaled.h2 / 2 }]}>{t("settings.title")}</Text>
            </View>
          </View>
        </View>

        <View style={styles.segmentOuter}>
          <SegmentButton
            label={t("settings.access")}
            icon="accessibility-outline"
            active={tab === "accessibility"}
            onPress={() => setTab("accessibility")}
            scaled={scaled}
            styles={styles}
            colors={colors}
          />
          <SegmentButton
            label={t("settings.alerts")}
            icon="alarm-outline"
            active={tab === "notifications"}
            onPress={() => setTab("notifications")}
            scaled={scaled}
            styles={styles}
            colors={colors}
          />
        </View>

        {tab === "accessibility" && (
          <AccessibilityTab
            prefs={prefs}
            updatePrefs={updatePrefs}
            onLogout={handleLogout}
            scaled={scaled}
            styles={styles}
            colors={colors}
          />
        )}

        {tab === "notifications" && (
          <NotificationsTab
            reminders={reminders}
            addReminder={addReminder}
            deleteReminder={deleteReminder}
            toggleReminder={toggleReminder}
            prefs={prefs}
            updatePrefs={updatePrefs}
            playAlert={playAlertPreview}
            scaled={scaled}
            styles={styles}
            colors={colors}
          />
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

      
    </SafeAreaView>
  );
}

function AccessibilityTab({
  prefs,
  updatePrefs,
  onLogout,
  scaled,
  styles,
  colors,
}: {
  prefs: Prefs;
  updatePrefs: <K extends keyof Prefs>(k: K, v: Prefs[K]) => void;
  onLogout: () => void;
  scaled: ReturnType<typeof scaleFontSizes>;
  styles: ReturnType<typeof createStyles>;
  colors: ContrastPalette;
}) {
  const { t } = useTranslation();
  const fontSizesLabels = t("settings.fontSizes", { returnObjects: true }) as string[];
  const contrastOptions = t("settings.contrastModes", { returnObjects: true }) as string[];
  const languages = t("settings.languageLabels", { returnObjects: true }) as string[];

  return (
    <>
      {/* Font Scale - 90% 100% 110%*/}
      <View style={styles.card}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name="text-outline" size={16} color={colors.accent} />
          <Text style={[styles.cardTitle, { fontSize: scaled.base }]}>{t("settings.textSize")}</Text>
        </View>
        <Text style={[styles.settingDescription, { fontSize: scaled.base * 0.75 }]}>
          {t("settings.testDescription")}
        </Text>
        <View style={styles.optionsRow}>
          {fontSizesLabels.map((size, i) => (
            <TouchableOpacity
              key={i}
              onPress={() => updatePrefs("fontScale", 0.9 + i * 0.1)}
              style={[
                styles.optionButton,
                prefs.fontScale === 0.9 + i * 0.1 && styles.optionButtonActive,
              ]}
            >
              <Text
                style={[
                  styles.optionButtonText,
                  prefs.fontScale === 0.9 + i * 0.1 && styles.optionButtonTextActive,
                  { fontSize: scaled.base * 0.75 },
                ]}
              >
                {size}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name="contrast-outline" size={16} color={colors.accent} />
          <Text style={[styles.cardTitle, { fontSize: scaled.base }]}>{t("settings.displayContrast")}</Text>
        </View>
        <Text style={[styles.settingDescription, { fontSize: scaled.base * 0.75 }]}>
          {t("settings.displayDescription")}
        </Text>
        <View style={styles.optionsRow}>
          {(["light", "dark", "high"] as const).map((contrast, i) => (
            <TouchableOpacity
              key={contrast}
              onPress={() => updatePrefs("contrast", contrast)}
              style={[
                styles.optionButton,
                prefs.contrast === contrast && styles.optionButtonActive,
              ]}
            >
              <Text
                style={[
                  styles.optionButtonText,
                  prefs.contrast === contrast && styles.optionButtonTextActive,
                  { fontSize: scaled.base * 0.75 },
                ]}
              >
                {contrastOptions[i]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name="globe-outline" size={16} color={colors.accent} />
          <Text style={[styles.cardTitle, { fontSize: scaled.base }]}>{t("settings.language")}</Text>
        </View>
        <Text style={[styles.settingDescription, { fontSize: scaled.base * 0.75 }]}>{t("settings.languageDescription")}</Text>
        <View style={styles.optionsRow}>
          {(["en", "es", "ht"] as const).map((lang, i) => (
            <TouchableOpacity
              key={lang}
              onPress={() => updatePrefs("language", lang)}
              style={[
                styles.optionButton,
                prefs.language === lang && styles.optionButtonActive,
              ]}
            >
              <Text
                style={[
                  styles.optionButtonText,
                  prefs.language === lang && styles.optionButtonTextActive,
                  { fontSize: scaled.base * 0.75 },
                ]}
              >
                {languages[i]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={[styles.cardTitle, { fontSize: scaled.base, marginBottom: 8 }]}>{t("settings.account")}</Text>
        <TouchableOpacity
          style={styles.logoutButton}
          onPress={onLogout}
          activeOpacity={0.85}
        >
          <Ionicons name="log-out-outline" size={16} color="#fff" />
          <Text style={[styles.logoutButtonText, { fontSize: scaled.small }]}>{t("settings.logout")}</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

function NotificationsTab({
  reminders,
  addReminder,
  deleteReminder,
  toggleReminder,
  prefs,
  updatePrefs,
  playAlert,
  scaled,
  styles,
  colors,
}: {
  reminders: Reminder[];
  addReminder: (title: string, hour: number, minute: number) => void | Promise<void>;
  deleteReminder: (id: string) => void | Promise<void>;
  toggleReminder: (id: string) => void | Promise<void>;
  prefs: Prefs;
  updatePrefs: <K extends keyof Prefs>(k: K, v: Prefs[K]) => void;
  playAlert: () => void;
  scaled: ReturnType<typeof scaleFontSizes>;
  styles: ReturnType<typeof createStyles>;
  colors: ContrastPalette;
}) {
  const [showModal, setShowModal] = useState(false);
  const [title, setTitle] = useState("");
  const [hour, setHour] = useState("");
  const [minute, setMinute] = useState("");
  const [ampm, setAmpm] = useState<"AM" | "PM">("AM");
  const { t } = useTranslation();

  async function handleAdd() {
    const h = Number(hour);
    const m = Number(minute);

    if (!Number.isInteger(h) || h < 1 || h > 12) {
      Alert.alert(t("settings.errorHour"), t("settings.errorHourRange"));
      return;
    }
    if (!Number.isInteger(m) || m < 0 || m > 59) {
      Alert.alert(t("settings.errorMinute"), t("settings.errorMinuteRange"));
      return;
    }

    // convert to 24-hour (military) time
    let military = h % 12; // 12 -> 0
    if (ampm === "PM") military += 12;

    await addReminder(title.trim(), military, m);
    setHour("");
    setTitle("");
    setMinute("");
    setAmpm("AM");
    setShowModal(false);
  }

  return (
    <>
      <View style={styles.card}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name="alarm-outline" size={16} color={colors.accent} />
          <Text style={[styles.cardTitle, { fontSize: scaled.base }]}>{t("settings.reminders")}</Text>
        </View>
        <Text style={[styles.settingDescription, { fontSize: scaled.base * 0.75 }]}>
          {t("settings.remindersDescription")}
        </Text>

        {reminders.map((rem) => (
          <View key={rem.id} style={styles.notificationRow}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="time-outline" size={16} color={colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.notificationLabel, { fontSize: scaled.small }]}>{rem.title}</Text>
                <Text style={[styles.notificationDescription, { fontSize: scaled.h2 / 2 }]}>
                  {String(rem.hour).padStart(2, "0")}:{String(rem.minute).padStart(2, "0")}
                </Text>
              </View>
              <Switch
                value={rem.enabled}
                onValueChange={() => toggleReminder(rem.id)}
                trackColor={{ true: colors.accent, false: colors.background }}
              />
              <TouchableOpacity onPress={() => deleteReminder(rem.id)} style={{ marginLeft: 8 }}>
                <Ionicons name="trash-outline" size={16} color={colors.accent} />
              </TouchableOpacity>
            </View>
          </View>
        ))}

        <View style={{ marginTop: 12, flexDirection: "row", justifyContent: "center" }}>
          <TouchableOpacity
            style={[styles.primaryButton, { paddingHorizontal: 12 }]}
            onPress={() => setShowModal(true)}
            activeOpacity={0.85}
          >
            <Ionicons name="add-circle-outline" size={16} color="#fff" />
            <Text style={[styles.primaryButtonText, { fontSize: scaled.small }]}>{t("settings.add")}</Text>
          </TouchableOpacity>
        </View>

        {/* Add Reminder Modal */}
        <Modal visible={showModal} animationType="slide" transparent>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
              <View style={styles.modalOverlay}>
                <View style={styles.modalContent}>

                  <Text style={[styles.modalTitle, { fontSize: scaled.h2 }]}>{t("settings.add") || "Add Reminder"}</Text>

                  <Text style={[styles.fieldLabel, { fontSize: scaled.small }]}>{t("settings.reminderTitle")}</Text>
                  <TextInput
                    style={[styles.input, { fontSize: scaled.base }]}
                    value={title}
                    onChangeText={setTitle}
                    placeholder={t("settings.reminderTitle")}
                    placeholderTextColor="#999"
                  />

                  <Text style={[styles.fieldLabel, { fontSize: scaled.small }]}>{t("settings.hourLabel")}</Text>
                  <TextInput
                    style={[styles.input, { fontSize: scaled.base, width: 120 }]}
                    value={hour}
                    onChangeText={(t) => setHour(t.replace(/\D/g, "").slice(0, 2))}
                    keyboardType="number-pad"
                    placeholderTextColor="#999"
                    placeholder="HH"
                  />

                  <Text style={[styles.fieldLabel, { fontSize: scaled.small, marginTop: 8 }]}>{t("settings.minuteLabel")}</Text>
                  <TextInput
                    style={[styles.input, { fontSize: scaled.base, width: 120 }]}
                    value={minute}
                    onChangeText={(t) => setMinute(t.replace(/\D/g, "").slice(0, 2))}
                    keyboardType="number-pad"
                    placeholderTextColor="#999"
                    placeholder="MM"
                  />

                  <Text style={[styles.fieldLabel, { fontSize: scaled.small, marginTop: 8 }]}>{t("settings.amPmLabel")}</Text>
                  <View style={{ flexDirection: "row", justifyContent: "flex-start", marginTop: 6, gap: 12 }}>
                    <TouchableOpacity
                      style={[styles.ampmButtons, ampm === "AM" && styles.optionButtonActive, { width: 100 }]}
                      onPress={() => setAmpm("AM")}
                    >
                      <Text style={[styles.optionButtonText, ampm === "AM" && styles.optionButtonTextActive]}>AM</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.ampmButtons, ampm === "PM" && styles.optionButtonActive, { width: 100 }]}
                      onPress={() => setAmpm("PM")}
                    >
                      <Text style={[styles.optionButtonText, ampm === "PM" && styles.optionButtonTextActive]}>PM</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.modalButtons}>
                    <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowModal(false); setTitle(""); setHour(""); setMinute(""); setAmpm("AM"); }}>
                      <Text style={[styles.cancelBtnText, { fontSize: scaled.base }]}>{t("settings.cancel")}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.saveBtn} onPress={handleAdd}>
                      <Text style={[styles.saveBtnText, { fontSize: scaled.base }]}>{t("contacts.save")}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </KeyboardAvoidingView>
        </Modal>
      </View>

      <View style={styles.card}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Ionicons name="volume-high-outline" size={16} color={colors.accent} />
              <Text style={[styles.cardTitle, { fontSize: scaled.base }]}>{t("settings.soundAlerts")}</Text>
            </View>
            <Text style={[styles.settingDescription, { fontSize: scaled.base * 0.75 }]}>
              {t("settings.soundDescription")}
            </Text>
          </View>
          <Switch
            value={prefs.soundAlerts}
            onValueChange={(v) => updatePrefs("soundAlerts", v)}
            trackColor={{ true: colors.accent, false: colors.background }}
          />
        </View>

        {prefs.soundAlerts && (
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={playAlert}
            activeOpacity={0.85}
          >
            <Ionicons name="play-outline" size={14} color={colors.accent} />
            <Text style={[styles.secondaryButtonText, { color: colors.accent, fontSize: scaled.small }]}>
              {t("settings.playPreview")}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </>
  );
}

function SegmentButton({
  label,
  icon,
  active,
  onPress,
  scaled,
  styles,
  colors,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
  scaled: ReturnType<typeof scaleFontSizes>;
  styles: ReturnType<typeof createStyles>;
  colors: ContrastPalette;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.segmentBtn, active && { backgroundColor: colors.accent }]}
    >
      <Ionicons name={icon} size={14} color={active ? "#FFF" : colors.muted} />
      <Text style={[styles.segmentText, active && { color: "#FFF" }, { fontSize: scaled.small }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const createStyles = (colors: ContrastPalette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    container: { paddingHorizontal: 16, paddingBottom: 16, gap: 14 },

    header: {
      paddingTop: 6,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    brand: { fontSize: 16, fontWeight: "800", letterSpacing: 0.3, color: colors.text },
    subtitle: { marginTop: 3, marginBottom: 6, color: colors.muted, fontSize: 13 },

    segmentOuter: {
      backgroundColor: colors.bgTile,
      borderRadius: 999,
      padding: 4,
      flexDirection: "row",
      gap: 6,
    },
    segmentBtn: {
      flex: 1,
      paddingVertical: 8,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 6,
    },
    segmentText: { fontWeight: "700", color: colors.muted, fontSize: 13 },

    card: {
      backgroundColor: colors.bgTile,
      borderRadius: 12,
      padding: 14,
      marginTop: 10,
      ...Platform.select({
        ios: { shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
        android: { elevation: 1.5 },
      }),
    },
    cardTitle: { fontWeight: "800", fontSize: 14, color: colors.text },
    settingDescription: { fontSize: 12, color: colors.muted, marginTop: 4, marginBottom: 12 },

    optionsRow: { flexDirection: "row", gap: 8 },
    optionButton: {
      flex: 1,
      paddingVertical: 10,
      paddingHorizontal: 8,
      borderRadius: 8,
      backgroundColor: colors.background,
      alignItems: "center",
      justifyContent: "center",
    },
    optionButtonActive: {
      backgroundColor: colors.accent,
    },
    optionButtonText: { fontWeight: "600", color: colors.text, fontSize: 12, textAlign: "center" },
    optionButtonTextActive: { color: "#FFF" },

    secondaryButton: {
      marginTop: 12,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 8,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      backgroundColor: colors.background,
    },
    secondaryButtonText: { fontWeight: "700", fontSize: 12 },

    notificationRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.background,
    },
    notificationLabel: { fontWeight: "700", color: colors.text, fontSize: 13 },
    notificationDescription: { fontSize: 11, color: colors.muted, marginTop: 2 },

    primaryButton: {
      backgroundColor: colors.accent,
      borderRadius: 8,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 6,
    },
    primaryButtonText: { color: "#FFF", fontWeight: "700", fontSize: 13 },

    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginTop: 12,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.background,
      backgroundColor: colors.background,
      borderRadius: 10,
      paddingVertical: 12,
      paddingHorizontal: 14,
      fontSize: 16,
      color: colors.text,
    },

    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.4)",
      justifyContent: "flex-end",
    },
    modalContent: {
      backgroundColor: colors.bgTile,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 24,
      paddingBottom: 40,
    },
    modalTitle: { fontWeight: "800", color: colors.text, marginBottom: 20 },
    fieldLabel: { fontWeight: "600", color: colors.muted, marginTop: 12, marginBottom: 6 },
    ampmButtons: {
      paddingVertical: 10,
      paddingHorizontal: 8,
      borderRadius: 8,
      backgroundColor: colors.background,
    },
    modalButtons: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 12 },
    cancelBtn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, backgroundColor: colors.background },
    saveBtn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, backgroundColor: colors.accent },
    cancelBtnText: { color: colors.muted, fontWeight: "700" },
    saveBtnText: { color: "#FFF", fontWeight: "700" },

    logoutButton: {
      backgroundColor: colors.accent,
      borderRadius: 8,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 6,
    },
    logoutButtonText: { color: "#FFF", fontWeight: "700", fontSize: 13 },
  });
