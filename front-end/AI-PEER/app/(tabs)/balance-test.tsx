import React, { useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { useLLM } from "@/src/llm";
import { useTranslation } from "react-i18next";
import { usePrefs } from "@/src/prefs-context";
import { type ContrastPalette } from "../../src/theme";

type Test = {
  id: string; // assessment-1/-2/-3 — used as the video ID
  name: string;
  shortDesc: string;
  purpose: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconBg: string;
  videoLabel: string; // shown on the video-confirm preview screen
  nextRoute: string; // session screen route after preview
};

export default function BalanceTestPage() {
  const router = useRouter();
  const { releaseModel } = useLLM();

  useFocusEffect(
    useCallback(() => {
      releaseModel().catch(console.error);
    }, [releaseModel])
  );
  const { scaled, colors } = usePrefs();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const TESTS: Test[] = [
    {
      id: "assessment-1",
      name: t("balance-test.test1Name"),
      shortDesc: t("balance-test.test1Desc"),
      purpose: t("balance-test.test1Purpose"),
      icon: "barbell-outline",
      iconBg: "#F0E9FF",
      videoLabel: t("balance-test.test1VideoLabel"),
      nextRoute: "/(tabs)/chair-rise-test",
    },
    {
      id: "assessment-3",
      name: t("balance-test.test2Name"),
      shortDesc: t("balance-test.test2Desc"),
      purpose: t("balance-test.test2Purpose"),
      icon: "walk-outline",
      iconBg: "#E8F0FF",
      videoLabel: t("balance-test.test2VideoLabel"),
      nextRoute: "/(tabs)/tug-test",
    },
  ];

  const startTest = (test: Test) => {
    router.replace({
      pathname: "/(tabs)/video-confirm",
      params: {
        cat: "assessment",
        video: test.id,
        label: test.videoLabel,
        nextRoute: test.nextRoute,
        backRoute: "/(tabs)/balance-test",
      },
    });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons
              name="shield-checkmark-outline"
              size={20}
              color={colors.accent}
            />
            <View>
              <Text style={[styles.brand, { fontSize: scaled.h3 }]}>AI PEER</Text>
              <Text style={[styles.subtitle, { fontSize: scaled.h2/2 }]}>{t("balance-test.subtitle")}</Text>
            </View>
          </View>
        </View>

        {/* Segmented control */}
        <View style={styles.segmentOuter}>
          <TouchableOpacity
            style={styles.segmentBtn}
            activeOpacity={0.85}
            onPress={() => router.replace("/(tabs)")}
          >
            <Ionicons name="home-outline" size={14} />
            <Text style={[styles.segmentText, { fontSize: scaled.base }]}>{t("balance-test.overview")}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.segmentBtn, styles.segmentActive]}
            activeOpacity={1}
          >
            <Ionicons name="pulse-outline" size={14} color="#FFF" />
            <Text style={[styles.segmentText, styles.segmentTextActive, { fontSize: scaled.base }]}>
              {t("balance-test.subtitle")}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Center heading */}
        <View style={styles.centerHead}>
          <Text style={styles.centerTitle}>{t("home.subtitle")}</Text>
          <Text style={styles.centerSub}>
            {t("balance-test.centerSub")}
          </Text>
        </View>

        {/* Test cards */}
        <View style={{ gap: 14 }}>
          {TESTS.map((test) => (
            <View key={test.id} style={styles.testCard}>
              <View style={styles.topRow}>
                <View
                  style={[
                    styles.iconCircle,
                    { backgroundColor: test.iconBg },
                  ]}
                >
                  <Ionicons name={test.icon} size={20} color="#8A5A3C" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.testTitle}>{test.name}</Text>
                </View>
              </View>

              <Text style={styles.testDesc}>{test.shortDesc}</Text>

              <View style={styles.purposeStrip}>
                <Ionicons
                  name="information-circle-outline"
                  size={14}
                  color={colors.text}
                />
                <Text style={styles.purposeText}>{test.purpose}</Text>
              </View>

              <TouchableOpacity
                style={styles.startBtn}
                activeOpacity={0.9}
                onPress={() => startTest(test)}
              >
                <Ionicons name="play" size={16} color="#FFF" />
                <Text style={styles.startBtnText}>{t("balance-test.startTest")}</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>

        <View style={{ height: 28 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors: ContrastPalette) => {
  const beige = colors.background;
  const beigeTrack = colors.bgTile;
  const beigeStrip = colors.bgTile;
  const warmRed = colors.accent;

  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: beige },
  container: { paddingHorizontal: 16, gap:14, paddingBottom: 12 },

  header: { paddingTop: 6, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brand: { fontSize: 16, fontWeight: "800", letterSpacing: 0.3, color: colors.text },
  subtitle: { marginTop: 3, marginBottom: 6, color: colors.muted },

  segmentOuter: {
    backgroundColor: beigeTrack,
    borderRadius: 999,
    padding: 4,
    flexDirection: "row",
    gap: 6,
    marginBottom: 14,
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
  segmentActive: { backgroundColor: warmRed },
  segmentText: { fontWeight: "800", color: colors.muted },
  segmentTextActive: { color: "#FFF" },

  centerHead: { alignItems: "center", marginBottom: 16 },
  centerTitle: { fontSize: 18, fontWeight: "900", color: colors.text },
  centerSub: {
    marginTop: 4,
    color: colors.muted,
    fontWeight: "600",
    textAlign: "center",
  },

  testCard: {
    backgroundColor: colors.bgTile,
    borderRadius: 14,
    padding: 16,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.08,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 2 },
    }),
  },

  topRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  testTitle: { fontSize: 17, fontWeight: "900", color: colors.text },

  testDesc: {
    marginTop: 12,
    color: colors.text,
    fontWeight: "600",
    fontSize: 14,
    lineHeight: 20,
  },

  purposeStrip: {
    marginTop: 12,
    backgroundColor: beigeStrip,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  purposeText: {
    flex: 1,
    color: colors.text,
    fontWeight: "700",
    fontSize: 13,
    lineHeight: 18,
  },

  startBtn: {
    marginTop: 14,
    backgroundColor: warmRed,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  startBtnText: { color: "#FFF", fontWeight: "900", fontSize: 15 },
  });
};
