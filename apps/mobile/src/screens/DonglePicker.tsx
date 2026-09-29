import { useEffect, useRef, useState } from "react";
import { ScrollView, Switch, useWindowDimensions, View } from "react-native";
import { Modal, Portal } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { bleManager } from "../app/runtime.js";
import { orderDevices, scanDevices, type ScannedDevice } from "../ble/BleTransport.js";
import { ListRow, styles, Text } from "../ui/kit.js";
import { useTokens } from "../ui/theme.js";

const signal = (rssi: number | undefined) => rssi === undefined ? "Signal unknown" : `Signal ${String(rssi).replace("-", "−")} dBm`;

/** X-2026-09-28-persistent-dongle §Picker sheet: a bottom sheet that scans only while it is visible; a tap outside or system back closes only the sheet. */
export function DonglePicker({ visible, rememberedId, onPick, onDismiss }: { visible: boolean; rememberedId?: string; onPick: (device: ScannedDevice) => void; onDismiss: () => void }) {
  const tokens = useTokens();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [devices, setDevices] = useState<ScannedDevice[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string>();
  const stopScan = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    if (!visible) return undefined;
    setDevices([]); setError(undefined);
    const seen = new Map<string, ScannedDevice>();
    const stop = scanDevices(bleManager(), (device) => { seen.set(device.id, device); setDevices([...seen.values()]); }, (cause) => { setError(`Scan error: ${cause.message}`); });
    stopScan.current = stop;
    return () => { stopScan.current = undefined; stop(); };
  }, [visible]);

  const { shown, hidden } = orderDevices(devices, rememberedId, showAll);
  return <Portal>
    <Modal visible={visible} onDismiss={onDismiss} style={{ justifyContent: "flex-end", marginBottom: 0 }}
      contentContainerStyle={{ backgroundColor: tokens.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, justifyContent: "flex-start", paddingBottom: insets.bottom }}>
      <View style={{ padding: 16, gap: 8 }}>
        <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: "700" }}>Choose your OBD dongle</Text>
        {error ? <Text style={{ color: tokens.error }}>{error}</Text> : null}
        <ScrollView style={{ maxHeight: height * 0.7 }}>
          {shown.map((item) => <ListRow key={item.id} icon="bluetooth" title={item.name ?? "Unnamed device"}
            subtitle={`${item.id === rememberedId ? "Last used with this car · " : ""}${signal(item.rssi)}`} onPress={() => {
              // Spec order: stop the scan before the connect starts. The effect cleanup only runs after React commits, so stop here too (stopping twice is harmless).
              // No busy guard: the sheet covers the start buttons and Change dongle is disabled while a session is busy, so no session is running under an open picker.
              stopScan.current?.(); onPick(item);
            }} />)}
          {!showAll && shown.length === 0 ? <Text style={{ color: tokens.muted, paddingVertical: 8 }}>No OBD adapters found yet. Check the dongle is plugged in, or show all devices.</Text> : null}
          <View style={[styles.row, { minHeight: 60 }]}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Show all devices</Text>
              <Text style={[styles.caption, { color: tokens.muted }]}>{showAll ? "Showing every device found" : `${String(hidden)} other ${hidden === 1 ? "device" : "devices"} hidden`}</Text>
            </View>
            <Switch accessibilityLabel="Show all devices" value={showAll} onValueChange={setShowAll} />
          </View>
        </ScrollView>
      </View>
    </Modal>
  </Portal>;
}
