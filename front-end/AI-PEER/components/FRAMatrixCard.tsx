import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

type PhysicalRisk = "Low" | "High";
type PerceivedRisk = "Low" | "High";
type Quadrant = "Rational" | "Irrational" | "Incongruent" | "Congruent";

type Props = {
  inputs?: {
    btrackScore?: number; // BTrackS CoP path length in cm
    fesI?: number; // FES-I total score
  };
  onBtrackUpdate?: (newScore: number) => void;
};

function computeFRA(btrackScore: number, fesI: number) {
  // BTrackS: > 30cm = high physiological risk, <= 30cm = low
  const physical: PhysicalRisk = btrackScore > 30 ? "High" : "Low";
  // FES-I: 16-23 low perceived, 24-64 high perceived
  const perceived: PerceivedRisk = fesI > 23 ? "High" : "Low";

  let quadrant: Quadrant;
  if (physical === "Low" && perceived === "Low") quadrant = "Rational";
  else if (physical === "Low" && perceived === "High") quadrant = "Irrational";
  else if (physical === "High" && perceived === "Low") quadrant = "Incongruent";
  else quadrant = "Congruent";

  return { physical, perceived, quadrant };
}

function dotPosition(
  physical: PhysicalRisk,
  perceived: PerceivedRisk
): { x: `${number}%`; y: `${number}%` } {
  const x: `${number}%` = physical === "High" ? "75%" : "25%";
  const y: `${number}%` = perceived === "High" ? "25%" : "75%";
  return { x, y };
}

export default function FRAMatrixCard({ inputs, onBtrackUpdate }: Props) {
  const { t } = useTranslation();
  const btrackScore = typeof inputs?.btrackScore === "number" ? inputs.btrackScore : null;
  const fesI = typeof inputs?.fesI === "number" ? inputs.fesI : null;

  const displayBtrack = btrackScore ?? 0;
  const displayFesI = fesI ?? 28;

  const fra = useMemo(
    () => computeFRA(displayBtrack, displayFesI),
    [displayBtrack, displayFesI]
  );

  const pos = dotPosition(fra.physical, fra.perceived);
  const elevated = fra.quadrant !== "Rational";
  const hasBothScores = btrackScore !== null && fesI !== null;

  const handleEditBtrack = () => {
    Alert.prompt(
      t("FRAMatrixCard.updateBtrackScore"),
      t("FRAMatrixCard.enterBtrackScore"),
      [
        { text: t("contacts.cancel"), style: "cancel" },
        {
          text: t("contacts.save"),
          onPress: (value?: string) => {
            const num = parseFloat(value ?? "");
            if (!isNaN(num) && num >= 0) {
              onBtrackUpdate?.(num);
            } else {
              Alert.alert(t("FRAMatrixCard.invalid"), t("FRAMatrixCard.pleaseEnterValidNumber"));
            }
          },
        },
      ],
      "plain-text",
      btrackScore !== null ? String(btrackScore) : "",
      "decimal-pad"
    );
  };

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.headerRow}>
        <Text style={styles.title}>{t("FRAMatrixCard.todaysRisk")}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={[styles.pill, elevated ? styles.pillBad : styles.pillGood]}>
            <Text style={styles.pillText}>
              {!hasBothScores ? t("FRAMatrixCard.incomplete") : elevated ? t("FRAMatrixCard.elevatedRisk") : t("FRAMatrixCard.lowRisk")}
            </Text>
          </View>
        </View>
      </View>

      <Text style={styles.subtitle}>{t("FRAMatrixCard.riskBasedOn")}</Text>

      {/* Readouts */}
      <View style={styles.readoutRow}>
        <Readout label="BTrackS" value={btrackScore !== null ? `${btrackScore} cm` : "-"} />
        <Readout label="FES-I" value={fesI !== null ? `${fesI}` : "-"} />
        <Readout label="Quadrant" value={hasBothScores ? fra.quadrant : "-"} />
      </View>

      {/* Matrix */}
      <View style={styles.matrixArea}>
        <View style={styles.yRail}>
          <View style={styles.yRailInner}>
            <Text style={styles.ySideTitle}>{t("FRAMatrixCard.perceivedRisk")}</Text>
            <Text style={styles.ySideTick}>{t("FRAMatrixCard.high")}: 24–64</Text>
            <Text style={styles.ySideTick}>{t("FRAMatrixCard.low")}: 16–23</Text>
          </View>
        </View>

        <View style={styles.matrix}>
          <View style={[styles.quad, styles.qTL, styles.badFill]} />
          <View style={[styles.quad, styles.qTR, styles.badFill]} />
          <View style={[styles.quad, styles.qBR, styles.badFill]} />
          <View style={[styles.quad, styles.qBL, styles.goodFill]} />

          <View style={styles.vLine} />
          <View style={styles.hLine} />

          <QuadLabel title="Irrational" pos="tl" bad />
          <QuadLabel title="Congruent" pos="tr" bad />
          <QuadLabel title="Incongruent" pos="br" bad />
          <QuadLabel title="Rational" pos="bl" good />

          <View
            style={[
              styles.dot,
              {
                left: pos.x,
                top: pos.y,
                transform: [{ translateX: -8 }, { translateY: -8 }],
              },
            ]}
          />
        </View>
      </View>

      {/* X axis */}
      <View style={styles.xAxis}>
        <Text style={styles.axisTitle}>{t("FRAMatrixCard.physiologicalRisk")}</Text>
        <Text style={styles.axisHint}>≤ 30cm ({t("FRAMatrixCard.low")}) · &gt; 30cm ({t("FRAMatrixCard.high")})</Text>
        {onBtrackUpdate && (
          <TouchableOpacity onPress={handleEditBtrack} style={styles.editBtrackBtn}>
            <Ionicons name="create-outline" size={14} color="#555" />
            <Text style={styles.editBtrackText}>{t("FRAMatrixCard.editBTrack")}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.readout}>
      <Text style={styles.readoutLabel}>{label}</Text>
      <Text style={styles.readoutValue}>{value}</Text>
    </View>
  );
}

function QuadLabel({
  title,
  pos,
  good,
  bad,
}: {
  title: string;
  pos: "tl" | "tr" | "bl" | "br";
  good?: boolean;
  bad?: boolean;
}) {
  return (
    <View
      style={[
        styles.qLabel,
        styles[pos],
        good && styles.qLabelGood,
        bad && styles.qLabelBad,
      ]}
    >
      <Text style={styles.qText}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFF",
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: "#E6E6E6",
  },

  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: { fontSize: 18.5, fontWeight: "900", color: "#111" },

  pill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  pillGood: { backgroundColor: "#DFF3E5" },
  pillBad: { backgroundColor: "#FFE2E0" },
  pillText: { fontWeight: "900", color: "#111", fontSize: 12 },

  subtitle: { marginTop: 16, fontSize: 11, color: "#555" },

  readoutRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 6,
    flexWrap: "wrap",
  },
  readout: {
    backgroundColor: "#F6F6F6",
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 12,
    minWidth: 82,
  },
  readoutLabel: { fontSize: 9, fontWeight: "800", color: "#666" },
  readoutValue: { marginTop: 3, fontWeight: "900", fontSize: 13, color: "#111" },

  matrixArea: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    height: 260,
  },

  yRail: {
    width: 44,
    height: 260,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 6,
  },
  yRailInner: {
    transform: [{ rotate: "-90deg" }],
    alignItems: "center",
    justifyContent: "center",
    width: 220,
  },
  ySideTitle: { fontSize: 12, fontWeight: "900", color: "#111" },
  ySideTick: { marginTop: 4, fontSize: 11, fontWeight: "700", color: "#555" },

  matrix: {
    flex: 1,
    height: 260,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#DADADA",
    overflow: "hidden",
    position: "relative",
    backgroundColor: "#FAFAFA",
  },

  quad: { position: "absolute", width: "50%", height: "50%" },
  qTL: { left: 0, top: 0 },
  qTR: { right: 0, top: 0 },
  qBL: { left: 0, bottom: 0 },
  qBR: { right: 0, bottom: 0 },

  goodFill: { backgroundColor: "#DFF3E5" },
  badFill: { backgroundColor: "#FFE2E0" },

  vLine: {
    position: "absolute",
    left: "50%",
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: "#8F8F8F",
  },
  hLine: {
    position: "absolute",
    top: "50%",
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: "#8F8F8F",
  },

  qLabel: {
    position: "absolute",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
    borderWidth: 1,
  },
  qLabelGood: {
    backgroundColor: "rgba(223,243,229,0.96)",
    borderColor: "#BDE8CC",
  },
  qLabelBad: {
    backgroundColor: "rgba(255,226,224,0.96)",
    borderColor: "#F2B7B3",
  },
  qText: { fontWeight: "900", fontSize: 12, color: "#111" },

  tl: { top: 12, left: 12 },
  tr: { top: 12, right: 12 },
  bl: { bottom: 12, left: 12 },
  br: { bottom: 12, right: 12 },

  dot: {
    position: "absolute",
    width: 16,
    height: 16,
    borderRadius: 999,
    backgroundColor: "#111",
    borderWidth: 4,
    borderColor: "#FFF",
  },

  xAxis: { alignItems: "center", marginTop: 10 },
  axisTitle: { fontSize: 12, fontWeight: "900", color: "#111" },
  axisHint: {
    marginTop: 2,
    fontSize: 11,
    color: "#555",
    textAlign: "center",
    fontWeight: "700",
  },
  editBtrackBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 25,
    marginBottom: -8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: "#E6D4C6",
    borderRadius: 10,
  },
  editBtrackText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#5B4636",
  },
});
