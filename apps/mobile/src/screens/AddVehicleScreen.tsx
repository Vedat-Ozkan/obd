import { TextInput, View } from "react-native";
import { SUPPORTED_VEHICLES, vehicleAvailability, vehicleEvidence, type CatalogVehicle } from "../garage/catalog.js";
import { LOCAL_INTEREST_NOTICE, type GarageState, type Interest, type Ownership } from "../garage/flow.js";
import { garageFlow } from "../app/runtime.js";
import { Button, Card, ListRow, SectionLabel, styles, Text } from "../ui/kit.js";
import { useTokens } from "../ui/theme.js";

type Change = (action: () => Promise<GarageState>, after?: () => void) => Promise<void>;
type InterestForm = { make: string; model: string; year: string; joinBeta: boolean };

/** Add a vehicle (spec §Screens 1): the picker, then the not-listed form and saved interests, moved here from Garage. */
function AddVehicleScreen({ make, setMake, model, setModel, year, setYear, tag, setTag, busy, change, onAdded, reopenInterest, interests }: {
  make: string; setMake: (make: string) => void; model: string; setModel: (model: string) => void; year: number | undefined; setYear: (year: number | undefined) => void;
  tag: Ownership; setTag: (tag: Ownership) => void; busy: boolean; change: Change; onAdded: () => void; reopenInterest: (saved?: Interest) => void; interests: readonly Interest[];
}) {
  const colors = useTokens();
  const normal = { color: colors.text };
  const muted = { color: colors.muted };
  const models = [...new Set(SUPPORTED_VEHICLES.filter((item) => item.make === make).map((item) => item.model))];
  const choices = SUPPORTED_VEHICLES.filter((item) => item.make === make && item.model === model);
  const selected: CatalogVehicle | undefined = choices.find((item) => item.year === year);
  return <>
    <Text style={muted}>Vehicles and interests are saved privately on this phone.</Text>
    <View>
      <SectionLabel>Make</SectionLabel>
      {[...new Set(SUPPORTED_VEHICLES.map((item) => item.make))].map((choice) => <ListRow key={choice} title={choice} selected={make === choice} onPress={() => { setMake(choice); setModel(""); setYear(undefined); }} />)}
    </View>
    {make ? <View>
      <SectionLabel>Model</SectionLabel>
      {models.map((choice) => <ListRow key={choice} title={choice} selected={model === choice} onPress={() => { setModel(choice); setYear(undefined); }} />)}
    </View> : null}
    {model ? <View>
      <SectionLabel>Model year</SectionLabel>
      {choices.map((choice) => <ListRow key={choice.id} title={String(choice.year)} selected={year === choice.year} onPress={() => { setYear(choice.year); }} />)}
    </View> : null}
    {selected ? <Card>
      <Text style={[styles.rowLabel, normal]}>{selected.year} {selected.make} {selected.model} · {selected.tier}</Text>
      <Text style={muted}>{vehicleAvailability(selected)}</Text>
      <Text style={muted}>{vehicleEvidence(selected)}</Text>
      <SectionLabel>Garage tag</SectionLabel>
      <ListRow title="Mine" selected={tag === "mine"} onPress={() => { setTag("mine"); }} />
      <ListRow title="Checking" selected={tag === "checked"} onPress={() => { setTag("checked"); }} />
      <Button title="Add to garage" disabled={busy} onPress={() => void change(() => garageFlow.add(selected.id, tag), onAdded)} />
    </Card> : null}
    <View>
      <SectionLabel>Not listed</SectionLabel>
      <ListRow title="My make, model, or year is not listed" onPress={() => { reopenInterest(); }} />
      {interests.map((saved, index) => <ListRow key={`${saved.make}-${saved.model}-${String(saved.year)}-${String(index)}`}
        title={`${String(saved.year)} ${saved.make} ${saved.model}`} subtitle={`Beta interest ${saved.joinBeta ? "yes" : "no"} · ${LOCAL_INTEREST_NOTICE}`} onPress={() => { reopenInterest(saved); }} />)}
    </View>
  </>;
}

function InterestScreen({ interest, setInterest, interestSaved, setInterestSaved, busy, change }: {
  interest: InterestForm; setInterest: (interest: InterestForm) => void; interestSaved: boolean; setInterestSaved: (saved: boolean) => void; busy: boolean; change: Change;
}) {
  const colors = useTokens();
  const normal = { color: colors.text };
  const muted = { color: colors.muted };
  const inputColors = { backgroundColor: colors.surface, borderColor: colors.outline, color: colors.text };
  return <>
    <Text style={muted}>This form saves your interest locally. {LOCAL_INTEREST_NOTICE}.</Text>
    <TextInput style={[styles.input, inputColors]} value={interest.make} onChangeText={(value) => { setInterest({ ...interest, make: value }); setInterestSaved(false); }} placeholder="Make" placeholderTextColor={colors.muted} />
    <TextInput style={[styles.input, inputColors]} value={interest.model} onChangeText={(value) => { setInterest({ ...interest, model: value }); setInterestSaved(false); }} placeholder="Model" placeholderTextColor={colors.muted} />
    <TextInput style={[styles.input, inputColors]} value={interest.year} onChangeText={(value) => { setInterest({ ...interest, year: value }); setInterestSaved(false); }} placeholder="Model year" keyboardType="number-pad" placeholderTextColor={colors.muted} />
    <Button title={`Join future beta interest: ${interest.joinBeta ? "yes" : "no"}`} onPress={() => { setInterest({ ...interest, joinBeta: !interest.joinBeta }); setInterestSaved(false); }} />
    <Button title="Save interest on this phone" disabled={busy} onPress={() => void change(() => garageFlow.saveInterest({ make: interest.make, model: interest.model, year: Number(interest.year), joinBeta: interest.joinBeta }), () => { setInterestSaved(true); })} />
    {interestSaved ? <Text style={normal}>{LOCAL_INTEREST_NOTICE}</Text> : null}
  </>;
}

export { AddVehicleScreen, InterestScreen };
