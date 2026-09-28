import { useState } from "react";
import { Switch, View } from "react-native";
import { Icon, TouchableRipple } from "react-native-paper";
import { CONSENT_SWITCH_LABEL, CONSENT_TEXT, CONSENT_TITLE } from "../beta/consent.js";
import type { BetaStatus } from "../beta/outbox.js";
import { Button, Card, Screen, styles, Text } from "../ui/kit.js";
import { consentSections } from "../ui/text.js";
import { useTokens } from "../ui/theme.js";

/** One pinned paragraph behind its own title; closed until tapped. */
function ConsentSection({ title, body }: { title: string; body: string }) {
  const tokens = useTokens();
  const [open, setOpen] = useState(false);
  return <Card>
    <TouchableRipple accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => { setOpen(!open); }} style={{ minHeight: 48, justifyContent: "center" }}>
      <View style={styles.row}>
        <Text style={[styles.rowLabel, { flex: 1 }]}>{title}</Text>
        <Icon source={open ? "chevron-up" : "chevron-down"} size={24} color={tokens.muted} />
      </View>
    </TouchableRipple>
    {open ? <Text selectable>{body}</Text> : null}
  </Card>;
}

// Spec §Screens 8 and §Decisions 5: the pinned beta-1 text verbatim, the intro always shown and each "**Title:**" paragraph
// in its own section. The switch, Continue and the decision are unchanged (T2.9).
function ConsentScreen({ beta, betaMessage, consentShare, setConsentShare, busy, decideBeta }: { beta: BetaStatus; betaMessage: string; consentShare: boolean; setConsentShare: (share: boolean) => void; busy: boolean; decideBeta: (share: boolean) => Promise<void> }) {
  const tokens = useTokens();
  const { intro, sections } = consentSections(CONSENT_TEXT);
  return <Screen scroll blocks>
    <Text accessibilityRole="header" style={styles.h1}>{CONSENT_TITLE}</Text>
    <Text style={{ color: tokens.muted }}>{beta.line}</Text>
    {betaMessage ? <Text>{betaMessage}</Text> : null}
    <Text selectable>{intro}</Text>
    {sections.map((section) => <ConsentSection key={section.title} title={section.title} body={section.body} />)}
    <View style={[styles.row, { minHeight: 60 }]}>
      <Text style={[styles.rowLabel, { flex: 1 }]}>{CONSENT_SWITCH_LABEL}</Text>
      <Switch accessibilityLabel={CONSENT_SWITCH_LABEL} value={consentShare} onValueChange={setConsentShare} />
    </View>
    <Button title="Continue" disabled={busy} onPress={() => void decideBeta(consentShare)} />
  </Screen>;
}

export { ConsentScreen };
