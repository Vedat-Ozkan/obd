import { useEffect, useState } from "react";
import { Switch, View } from "react-native";
import { Button as TextButton } from "react-native-paper";
import appJson from "../../app.json";
import { CONSENT_SWITCH_LABEL, PRIVACY_NOTE } from "../beta/consent.js";
import type { BetaStatus } from "../beta/outbox.js";
import { LICENSES, OBDB_ATTRIBUTION } from "../app/licenses.js";
import { folderLabel, phoneTargets, saveThemePreference } from "../app/runtime.js";
import { Button, ListRow, SectionLabel, styles, Text } from "../ui/kit.js";
import { noteBlocks, type ThemePreference } from "../ui/text.js";
import { setThemePreference, useThemePreference, useTokens } from "../ui/theme.js";

const THEME_LABELS: Record<ThemePreference, string> = { system: "System default", light: "Light", dark: "Dark" };

/** The remembered capture folder's name, or "Not chosen"; `reload` re-reads it after a change. */
function useFolderLabel(): [string, () => void] {
  const [label, setLabel] = useState("");
  const reload = () => { void folderLabel().then((name) => { setLabel(name ?? "Not chosen"); }, () => { setLabel("Could not be read"); }); };
  useEffect(reload, []);
  return [label, reload];
}

// Spec §Screens 7: Data, Display and About groups, each row with its current value on the right.
function SettingsScreen({ beta, openBeta, openSaveFolder, openTheme, openPrivacy, openLicenses }: {
  beta: BetaStatus; openBeta: () => void; openSaveFolder: () => void; openTheme: () => void; openPrivacy: () => void; openLicenses: () => void;
}) {
  const [folder] = useFolderLabel();
  const theme = useThemePreference();
  return <>
    <View>
      <SectionLabel>Data</SectionLabel>
      <ListRow icon="cloud-upload-outline" title="Beta data sharing" right={beta.sharing ? "On" : "Off"} onPress={openBeta} />
      <ListRow icon="folder-outline" title="Save folder" right={folder} onPress={openSaveFolder} />
    </View>
    <View>
      <SectionLabel>Display</SectionLabel>
      <ListRow icon="theme-light-dark" title="Theme" right={THEME_LABELS[theme]} onPress={openTheme} />
    </View>
    <View>
      <SectionLabel>About</SectionLabel>
      <ListRow icon="information-outline" title="Version" right={appJson.expo.version} />
      <ListRow icon="shield-account-outline" title="Privacy note" onPress={openPrivacy} />
      <ListRow icon="scale-balance" title="Open-source licenses" onPress={openLicenses} />
    </View>
  </>;
}

/** The T2.9 beta controls, moved from Garage: switching on opens the consent screen, switching off decides at once. */
function BetaScreen({ beta, betaMessage, busy, decideBeta, setConsentOpen, deleteBeta }: {
  beta: BetaStatus; betaMessage: string; busy: boolean; decideBeta: (share: boolean) => Promise<void>; setConsentOpen: (open: boolean) => void; deleteBeta: () => void;
}) {
  const tokens = useTokens();
  return <>
    <View style={[styles.row, { minHeight: 60 }]}>
      <Text style={[styles.rowLabel, { flex: 1 }]}>{CONSENT_SWITCH_LABEL}</Text>
      <Switch accessibilityLabel={CONSENT_SWITCH_LABEL} value={beta.sharing} disabled={busy} onValueChange={(on) => { if (on) setConsentOpen(true); else void decideBeta(false); }} />
    </View>
    <Text style={{ color: tokens.muted }}>{beta.line}</Text>
    {beta.betaId ? <Text>Beta ID: {beta.betaId}</Text> : null}
    {betaMessage ? <Text>{betaMessage}</Text> : null}
    <View style={{ alignItems: "flex-start" }}>
      <TextButton mode="text" textColor={tokens.error} disabled={busy} onPress={deleteBeta} style={{ minHeight: 48, justifyContent: "center" }}>Delete my data</TextButton>
    </View>
  </>;
}

/** System default, Light or Dark: the app re-themes at once, and the choice is kept in the private theme.txt. */
function ThemeScreen() {
  const theme = useThemePreference();
  const choose = (preference: ThemePreference) => { setThemePreference(preference); saveThemePreference(preference); };
  return <View>
    {(["system", "light", "dark"] as const).map((preference) => <ListRow key={preference} title={THEME_LABELS[preference]} selected={theme === preference} onPress={() => { choose(preference); }} />)}
  </View>;
}

/** The folder picked once for saved runs (T0.9b); forgetting it makes the next save ask again (phoneTargets.forgetFolder). */
function SaveFolderScreen() {
  const tokens = useTokens();
  const [folder, reload] = useFolderLabel();
  return <>
    <View><ListRow icon="folder-outline" title="Folder" right={folder} /></View>
    <Text style={{ color: tokens.muted }}>Recordings, codes reports and charge logs are kept on this phone first, then copied to this folder.</Text>
    <Button title="Choose again at next save" tonal disabled={folder === "Not chosen"} onPress={() => { phoneTargets.forgetFolder(); reload(); }} />
  </>;
}

/** Every runtime dependency with its license, and the OBDb attribution (ADR-010). */
function LicensesScreen() {
  return <>
    <View>
      <SectionLabel>Open-source packages</SectionLabel>
      {LICENSES.map((entry) => <ListRow key={entry.name} title={entry.name} right={entry.license} />)}
    </View>
    <View>
      <SectionLabel>Vehicle data</SectionLabel>
      {OBDB_ATTRIBUTION.map((entry) => <ListRow key={entry.name} title={entry.name} subtitle={entry.source} right={entry.license} />)}
    </View>
  </>;
}

/** The pinned PRIVACY_NOTE, verbatim, with its markdown shown as headings, bullets, bold and italic. */
function PrivacyScreen() {
  const tokens = useTokens();
  return <View style={{ gap: 8 }}>
    {noteBlocks(PRIVACY_NOTE).map((block, index) => {
      const spans = block.spans.map((span, at) => <Text key={at} style={[span.bold ? { fontWeight: "700" } : null, span.italic ? { fontStyle: "italic" } : null]}>{span.text}</Text>);
      if (block.kind === "heading") return <Text key={index} selectable accessibilityRole="header" style={styles.rowLabel}>{spans}</Text>;
      if (block.kind === "bullet") return <View key={index} style={[styles.row, { alignItems: "flex-start", paddingLeft: 8 }]}>
        <Text style={{ color: tokens.muted }}>•</Text><Text selectable style={{ flex: 1 }}>{spans}</Text>
      </View>;
      return <Text key={index} selectable>{spans}</Text>;
    })}
  </View>;
}

export { BetaScreen, LicensesScreen, PrivacyScreen, SaveFolderScreen, SettingsScreen, ThemeScreen };
