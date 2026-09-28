import { Switch, View } from "react-native";
import { Button as TextButton } from "react-native-paper";
import { CONSENT_SWITCH_LABEL, PRIVACY_NOTE } from "../beta/consent.js";
import type { BetaStatus } from "../beta/outbox.js";
import { ListRow, SectionLabel, styles, Text } from "../ui/kit.js";
import { useTokens } from "../ui/theme.js";

// Spec §Screens 7. C1 has the Data › Beta data sharing and About › Privacy note rows; C4 adds Save folder, Theme, Version and licenses.
function SettingsScreen({ beta, openBeta, openPrivacy }: { beta: BetaStatus; openBeta: () => void; openPrivacy: () => void }) {
  return <>
    <View>
      <SectionLabel>Data</SectionLabel>
      <ListRow icon="cloud-upload-outline" title="Beta data sharing" right={beta.sharing ? "On" : "Off"} onPress={openBeta} />
    </View>
    <View>
      <SectionLabel>About</SectionLabel>
      <ListRow icon="shield-account-outline" title="Privacy note" onPress={openPrivacy} />
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

/** The pinned PRIVACY_NOTE as plain text; C4 formats its markdown. */
function PrivacyScreen() {
  return <Text selectable>{PRIVACY_NOTE}</Text>;
}

export { BetaScreen, PrivacyScreen, SettingsScreen };
