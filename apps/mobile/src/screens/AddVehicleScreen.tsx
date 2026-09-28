import { TextInput } from "react-native";
import { SUPPORTED_VEHICLES, vehicleAvailability, vehicleEvidence, type CatalogVehicle } from "../garage/catalog.js";
import { LOCAL_INTEREST_NOTICE, type GarageState, type Interest, type Ownership } from "../garage/flow.js";
import { garageFlow } from "../app/runtime.js";
import { Button, Card, styles, Text } from "../ui/kit.js";
import { usePalette } from "../ui/theme.js";

type Change = (action: () => Promise<GarageState>, after?: () => void) => Promise<void>;
type InterestForm = { make: string; model: string; year: string; joinBeta: boolean };

function AddVehicleScreen({ make, setMake, model, setModel, year, setYear, tag, setTag, busy, change, setView, reopenInterest }: {
  make: string; setMake: (make: string) => void; model: string; setModel: (model: string) => void; year: number | undefined; setYear: (year: number | undefined) => void;
  tag: Ownership; setTag: (tag: Ownership) => void; busy: boolean; change: Change; setView: (view: "garage") => void; reopenInterest: (saved?: Interest) => void;
}) {
  const colors = usePalette();
  const normal = { color: colors.text };
  const muted = { color: colors.muted };
  const models = [...new Set(SUPPORTED_VEHICLES.filter((item) => item.make === make).map((item) => item.model))];
  const choices = SUPPORTED_VEHICLES.filter((item) => item.make === make && item.model === model);
  const selected: CatalogVehicle | undefined = choices.find((item) => item.year === year);
  return <>
    <Text style={normal}>Choose make</Text>
    {[...new Set(SUPPORTED_VEHICLES.map((item) => item.make))].map((choice) => <Button key={choice} title={`${choice}${make === choice ? " ✓" : ""}`} onPress={() => { setMake(choice); setModel(""); setYear(undefined); }} />)}
    {make ? <Text style={normal}>Choose model</Text> : null}
    {models.map((choice) => <Button key={choice} title={`${choice}${model === choice ? " ✓" : ""}`} onPress={() => { setModel(choice); setYear(undefined); }} />)}
    {model ? <Text style={normal}>Choose model year</Text> : null}
    {choices.map((choice) => <Button key={choice.id} title={`${String(choice.year)}${year === choice.year ? " ✓" : ""}`} onPress={() => { setYear(choice.year); }} />)}
    {selected ? <Card>
      <Text style={normal}>{selected.year} {selected.make} {selected.model} · {selected.tier}</Text>
      <Text style={muted}>{vehicleAvailability(selected)}</Text>
      <Text style={muted}>{vehicleEvidence(selected)}</Text>
      <Text style={normal}>Garage tag</Text>
      <Button title={`Mine${tag === "mine" ? " ✓" : ""}`} onPress={() => { setTag("mine"); }} />
      <Button title={`Checked${tag === "checked" ? " ✓" : ""}`} onPress={() => { setTag("checked"); }} />
      <Button title="Add to garage" disabled={busy} onPress={() => void change(() => garageFlow.add(selected.id, tag), () => { setView("garage"); })} />
    </Card> : null}
    <Button title="My make, model, or year is not listed" onPress={() => { reopenInterest(); }} />
  </>;
}

function InterestScreen({ interest, setInterest, interestSaved, setInterestSaved, busy, change }: {
  interest: InterestForm; setInterest: (interest: InterestForm) => void; interestSaved: boolean; setInterestSaved: (saved: boolean) => void; busy: boolean; change: Change;
}) {
  const colors = usePalette();
  const normal = { color: colors.text };
  const muted = { color: colors.muted };
  const inputColors = { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.inputText };
  return <>
    <Text style={muted}>This form saves your interest locally. {LOCAL_INTEREST_NOTICE}.</Text>
    <TextInput style={[styles.input, inputColors]} value={interest.make} onChangeText={(value) => { setInterest({ ...interest, make: value }); setInterestSaved(false); }} placeholder="Make" placeholderTextColor={colors.placeholder} />
    <TextInput style={[styles.input, inputColors]} value={interest.model} onChangeText={(value) => { setInterest({ ...interest, model: value }); setInterestSaved(false); }} placeholder="Model" placeholderTextColor={colors.placeholder} />
    <TextInput style={[styles.input, inputColors]} value={interest.year} onChangeText={(value) => { setInterest({ ...interest, year: value }); setInterestSaved(false); }} placeholder="Model year" keyboardType="number-pad" placeholderTextColor={colors.placeholder} />
    <Button title={`Join future beta interest: ${interest.joinBeta ? "yes" : "no"}`} onPress={() => { setInterest({ ...interest, joinBeta: !interest.joinBeta }); setInterestSaved(false); }} />
    <Button title="Save interest on this phone" disabled={busy} onPress={() => void change(() => garageFlow.saveInterest({ make: interest.make, model: interest.model, year: Number(interest.year), joinBeta: interest.joinBeta }), () => { setInterestSaved(true); })} />
    {interestSaved ? <Text style={normal}>{LOCAL_INTEREST_NOTICE}</Text> : null}
  </>;
}

export { AddVehicleScreen, InterestScreen };
