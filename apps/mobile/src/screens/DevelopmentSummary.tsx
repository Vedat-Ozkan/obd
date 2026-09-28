import { useEffect, useRef, useState } from "react";
import type { BatteryDiagnosisReport } from "obd-battery/report";
import { uuid } from "expo-modules-core";
import { Linking, Switch, TextInput, View } from "react-native";
import { createDevelopmentSummaryAccess, SUMMARY_DISCLOSURE } from "../summaryAccess.js";
import { createDevelopmentSummaryFlow, type SummaryView } from "../summaryFlow.js";
import { Button, Card, styles, Text } from "../ui/kit.js";
import { usePalette } from "../ui/theme.js";

function DevelopmentSummary({ report }: { report: BatteryDiagnosisReport }) {
  const colors = usePalette();
  const [url, setUrl] = useState<string>(() => {
    const configured: unknown = process.env.EXPO_PUBLIC_SUMMARY_URL;
    return typeof configured === "string" ? configured : "";
  });
  const [token, setToken] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [pending, setPending] = useState(false);
  const [summary, setSummary] = useState<SummaryView>();
  const [access] = useState(() => createDevelopmentSummaryAccess({ development: __DEV__, fetch: globalThis.fetch.bind(globalThis) }));
  const [flow] = useState(() => createDevelopmentSummaryFlow({ access, nextRequestId: () => uuid.v4() }));
  const generation = useRef(0);
  const withdraw = () => {
    generation.current++; flow.withdraw(); setToken(""); setAccepted(false); setSummary(undefined); setPending(false);
  };
  // This component lives only on a saved detail view. Leaving it also clears
  // session auth and prevents the pending promise from updating a later view.
  useEffect(() => () => { generation.current++; flow.withdraw(); }, [flow, report]);
  const request = async () => {
    if (!__DEV__ || pending || !accepted) return;
    const attempt = generation.current;
    setPending(true); setSummary(undefined);
    const result = await flow.summaryFor(report);
    if (generation.current !== attempt) return;
    setSummary(result); setPending(false);
  };
  const normal = { color: colors.text };
  const inputColors = { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.inputText };
  return <Card>
    <Text style={normal}>Development AI summary</Text>
    <Text style={normal}>Local laptop URL. Enter only the separate development access token. Do not enter an OpenRouter API key. The token stays in memory for this detail view.</Text>
    <TextInput accessibilityLabel="Local summary URL" style={[styles.input, inputColors]} value={url} editable={!pending} autoCapitalize="none" autoCorrect={false} onChangeText={(value) => { withdraw(); setUrl(value); }} placeholder="http://192.168.1.20:8788" placeholderTextColor={colors.muted} />
    <TextInput accessibilityLabel="Development access token" style={[styles.input, inputColors]} value={token} editable={!pending} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" onChangeText={(value) => { generation.current++; flow.withdraw(); setAccepted(false); setSummary(undefined); setToken(value); }} placeholder="Separate development access token" placeholderTextColor={colors.muted} />
    <Text style={normal}>{SUMMARY_DISCLOSURE}</Text>
    <Text style={normal} accessibilityRole="link" onPress={() => { void Linking.openURL("https://openrouter.ai/privacy").catch(() => {}); }}>OpenRouter privacy policy</Text>
    <Text style={normal} accessibilityRole="link" onPress={() => { void Linking.openURL("https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html").catch(() => {}); }}>DeepSeek privacy policy</Text>
    <View style={styles.row}><Switch accessibilityLabel="Allow OpenRouter and DeepSeek processing" value={accepted} onValueChange={(value) => {
      if (!value) { withdraw(); return; }
      access.configure(url, token); flow.consent(true); setAccepted(true);
    }} /><Text style={normal}>Allow this AI summary session</Text></View>
    <Button title="Request AI summary" disabled={!accepted || pending} onPress={() => { void request(); }} />
    <Button title="Withdraw AI consent" onPress={withdraw} />
    {pending ? <Text style={normal}>Requesting summary. The offline report remains available.</Text> : null}
    {summary ? <Text style={normal}>{summary.kind === "llm" ? summary.text : summary.reason}</Text> : null}
    {__DEV__ && summary?.evidence ? <View>
      <Text style={normal}>Development run metadata</Text>
      <Text selectable style={normal}>{JSON.stringify(summary.evidence, null, 2)}</Text>
    </View> : null}
  </Card>;
}

export { DevelopmentSummary };
