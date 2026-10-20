import { StyleSheet, View } from "react-native";
import { SUPPORTED_VEHICLES } from "../garage/catalog.js";
import type { GarageState, GarageVehicle } from "../garage/flow.js";
import { ListRow, Text } from "../ui/kit.js";
import { useTokens } from "../ui/theme.js";

function ownershipLabel(ownership: GarageVehicle["ownership"]): string {
  return ownership === "mine" ? "Mine" : "Checking";
}

function GarageScreen({ state, busy, openCar, addVehicle }: { state: GarageState; busy: boolean; openCar: (id: string) => void; addVehicle: () => void }) {
  const tokens = useTokens();
  return <View>
    {state.vehicles.length === 0 ? <Text style={{ color: tokens.muted }}>No vehicles yet.</Text> : null}
    {state.vehicles.map((entry) => {
      const vehicle = SUPPORTED_VEHICLES.find((item) => item.id === entry.catalogId);
      if (!vehicle) return null;
      return <ListRow key={entry.id} icon="car" title={`${String(vehicle.year)} ${vehicle.make} ${vehicle.model}`} disabled={busy} onPress={() => { openCar(entry.id); }}
        right={<View style={[styles.tag, { backgroundColor: tokens.tag.neutral.bg }]}><Text style={[styles.tagText, { color: tokens.tag.neutral.fg }]}>{ownershipLabel(entry.ownership)}</Text></View>} />;
    })}
    <ListRow icon="plus" title="Add a vehicle" disabled={busy} onPress={addVehicle} />
  </View>;
}

const styles = StyleSheet.create({ tag: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }, tagText: { fontSize: 13, fontWeight: "600" } });

export { GarageScreen, ownershipLabel };
