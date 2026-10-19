// app/index.tsx
import { useRouter } from "expo-router";
import { useState, useEffect, useMemo } from "react";
import { ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, TouchableWithoutFeedback, View } from "react-native";
import { useTranslation } from "react-i18next";
import { api } from "../src/api";
import { useAuth } from "../src/auth";
import { usePrefs } from "../src/prefs-context";
import { type ContrastPalette, scaleFontSizes, radii, spacing } from "../src/theme";

function normalizePhone(input: string) {
  // keep digits only; backend can decide final validation
  return (input || "").replace(/\D/g, "");
}

export default function Login() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const { colors, scaled } = usePrefs();
  const s = useMemo(() => createStyles(colors, scaled), [colors, scaled]);

  useEffect(() => {
    if (!authLoading && user) {
      router.replace("/(tabs)");
    }
  }, [authLoading, user]);

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [btrackInput, setBtrackInput] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

 /* const onSubmit = async () => {
    setErr(null);
    const p = normalizePhone(phone);
    if (p.length < 10) return setErr("Enter a valid phone number (10+ digits).");
    if (password.length < 6) return setErr("Password must be at least 6 characters.");
    
   
    try {
      setLoading(true);
      const res = await api.login(p, password);
      // store token for later requests
      try { await AsyncStorage.setItem("token", res.token); } catch {}
      router.replace("/(tabs)"); // go to the app after login
    } catch (e: any) {
      setErr("Invalid phone or password");
    } finally {
      setLoading(false);
    }
  };
 */
  const onLogin = async () => {
    setErr(null);
    const p = normalizePhone(phone);
    if (p.length < 10) return setErr(t("login.enterValidPhone"));
    if (password.length < 6) return setErr(t("login.passwordMinChars"));

    try {
      setLoading(true);
      await api.sendCode(p, password, "login");
      router.replace(`/verify?phone=${p}&mode=login`);
    } catch (e: any) {
      setErr(e.message || t("login.invalidPhoneOrPassword"));
    } finally {
      setLoading(false);
    }
  };

  const onCreate = async () => {
    setErr(null);
    const p = normalizePhone(phone);
    if (p.length < 10) return setErr(t("login.enterValidPhone"));
    if (password.length < 6) return setErr(t("login.passwordMinChars"));
    if (password !== confirmPassword.trim()) return setErr(t("login.passwordsDoNotMatch"));

    try {
      setLoading(true);
      const btrack = btrackInput.trim() ? parseFloat(btrackInput.trim()) : undefined;
      await api.sendCode(p, password, "create", btrack);
      router.replace(`/verify?phone=${p}&mode=create`);
    } catch (e: any) {
      setErr(e.message || t("login.failedCreateAccount"));
    } finally {
      setLoading(false);
    }
  };

  const onDevFastLogin = async () => {
    setErr(null);
    setLoading(true);
    try {
      await api.sendCode("15555555555", "password123", "login");
      router.replace("/verify?phone=15555555555&mode=login");
    } catch (e: any) {
      setErr(e.message || "Dev fast login failed");
    } finally {
      setLoading(false);
    }
  };

  const switch_clearPages = async () => {
    setIsCreating(!isCreating);
    setShowPw(false);
    setPhone("");
    setPassword("");
    setConfirmPassword("");
    setBtrackInput("");
    setErr(null);
  };

  if (authLoading || user) {
    return (
      <View style={[s.wrap, { alignItems: "center" }]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={spacing(6)}>
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={s.wrap}>
        <Text style={s.brand}>AI PEER</Text>
        <Text style={s.subtitle}>{isCreating ? t("login.createAccount") : t("login.signInToContinue")}</Text>

        {isCreating ? (
          <View style={s.form}>
            <Text style={s.label}>{t("login.phoneNumber")}</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder="(555) 123-4567"
              placeholderTextColor={colors.muted}
              style={s.input}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={[s.label, { marginTop: spacing(3) }]}>{t("login.password")}</Text>
            <View style={s.row}>
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPw}
                placeholder={t("login.createPasswordPlaceholder")}
                placeholderTextColor={colors.muted}
                style={[s.input, { flex: 1 }]}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity onPress={() => setShowPw(!showPw)} style={s.toggle}>
                <Text style={s.toggleText}>{showPw ? t("login.hide") : t("login.show")}</Text>
              </TouchableOpacity>
            </View>

            <Text style={[s.label, { marginTop: spacing(3) }]}>{t("login.confirmPassword")}</Text>
            <View style={s.row}>
              <TextInput
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showPw}
                placeholder={t("login.reenterPasswordPlaceholder")}
                placeholderTextColor={colors.muted}
                style={[s.input, { flex: 1 }]}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity onPress={() => setShowPw(!showPw)} style={s.toggle}>
                <Text style={s.toggleText}>{showPw ? t("login.hide") : t("login.show")}</Text>
              </TouchableOpacity>
            </View>

            <Text style={[s.label, { marginTop: spacing(3) }]}>BTrackS Score (cm)</Text>
            <TextInput
              value={btrackInput}
              onChangeText={setBtrackInput}
              keyboardType="decimal-pad"
              placeholder="e.g. 25.4 (optional)"
              placeholderTextColor={colors.muted}
              style={s.input}
            />

            {err ? <Text style={s.error}>{err}</Text> : null}

            <TouchableOpacity style={s.loginBtn} onPress={onCreate} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.loginTxt}>{t("login.createAccountBtn")}</Text>}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => switch_clearPages()} style={s.switchWrap}>
              <Text style={s.switchText}>{t("login.alreadyHaveAccount")}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={s.form}>
            <Text style={s.label}>{t("login.phoneNumber")}</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder="(555) 123-4567"
              placeholderTextColor={colors.muted}
              style={s.input}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={[s.label, { marginTop: spacing(3) }]}>{t("login.password")}</Text>
            <View style={s.row}>
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPw}
                placeholder={t("login.enterPasswordPlaceholder")}
                placeholderTextColor={colors.muted}
                style={[s.input, { flex: 1 }]}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity onPress={() => setShowPw(!showPw)} style={s.toggle}>
                <Text style={s.toggleText}>{showPw ? t("login.hide") : t("login.show")}</Text>
              </TouchableOpacity>
            </View>

            {err ? <Text style={s.error}>{err}</Text> : null}

            <TouchableOpacity onPress={() => Alert.alert(t("login.forgotPasswordAlertTitle"), t("login.forgotPasswordAlertBody"))}> 
              <Text style={s.link}>{t("login.forgotPassword")}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.loginBtn} onPress={onLogin} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.loginTxt}>{t("login.logInBtn")}</Text>}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => switch_clearPages()} style={s.switchWrap}>
              <Text style={s.switchText}>{t("login.dontHaveAccount")}</Text>
            </TouchableOpacity>

            {__DEV__ && (
              <TouchableOpacity
                style={[s.loginBtn, { backgroundColor: "#0284c7", marginTop: spacing(4) }]}
                onPress={onDevFastLogin}
                disabled={loading}
              >
                <Text style={s.loginTxt}>⚡ Dev Fast Login (John Senior)</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const createStyles = (
  colors: ContrastPalette,
  scaled: ReturnType<typeof scaleFontSizes>
) =>
StyleSheet.create({
  wrap: { flex: 1, padding: spacing(6), backgroundColor: colors.background, justifyContent: "center" },
  brand: { fontSize: scaled.h1, fontWeight: "800", color: colors.accent, textAlign: "center" },
  subtitle: { fontSize: scaled.small, color: colors.text, textAlign: "center", marginTop: spacing(1), marginBottom: spacing(3) },

  form: { marginTop: spacing(6) },
  label: { fontSize: scaled.small, color: colors.text, marginBottom: spacing(1) },
  input: {
    borderWidth: 1, borderColor: colors.muted, borderRadius: radii.lg,
    paddingVertical: spacing(3), paddingHorizontal: spacing(3), fontSize: scaled.base, color: colors.text, backgroundColor: colors.bgTile,
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing(0) },
  toggle: { marginLeft: spacing(1), paddingVertical: spacing(3), paddingHorizontal: spacing(3) },
  toggleText: { color: colors.accent, fontWeight: "600" },

  error: { color: "#b91c1c", marginTop: spacing(2) },

  loginBtn: { marginTop: spacing(8), backgroundColor: colors.accent, paddingVertical: spacing(3.5), borderRadius: radii.lg, alignItems: "center" },
  loginTxt: { color: "#fff", fontWeight: "700", fontSize: scaled.base },
  link: { color: colors.accent, textAlign: "center", marginTop: spacing(2.5), fontWeight: "600" },
  switchWrap: { marginTop: spacing(3), alignItems: "center" },
  switchText: { color: colors.accent, textAlign: "center", fontWeight: "700" },
});
