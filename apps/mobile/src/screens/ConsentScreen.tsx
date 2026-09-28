import { Switch, View } from "react-native";
import { CONSENT_SWITCH_LABEL, CONSENT_TEXT, CONSENT_TITLE } from "../beta/consent.js";
import type { BetaStatus } from "../beta/outbox.js";
import { Button, Screen, styles, Text } from "../ui/kit.js";
import { usePalette } from "../ui/theme.js";

function ConsentScreen({ beta, betaMessage, consentShare, setConsentShare, busy, decideBeta }: { beta: BetaStatus; betaMessage: string; consentShare: boolean; setConsentShare: (share: boolean) => void; busy: boolean; decideBeta: (share: boolean) => Promise<void> }) {
  const colors = usePalette();
  const title = { color: colors.text, fontWeight: "bold" as const, fontSize: 20 };
  const normal = { color: colors.text };
  const muted = { color: colors.muted };
  return <Screen scroll>
    <Text style={title}>{CONSENT_TITLE}</Text>
    <Text style={muted}>{beta.line}</Text>
    {betaMessage ? <Text style={normal}>{betaMessage}</Text> : null}
    <Text style={normal}>{CONSENT_TEXT}</Text>
    <View style={styles.row}><Switch value={consentShare} onValueChange={setConsentShare} /><Text style={normal}>{CONSENT_SWITCH_LABEL}</Text></View>
    <Button title="Continue" disabled={busy} onPress={() => void decideBeta(consentShare)} />
  </Screen>;
}

export { ConsentScreen };
