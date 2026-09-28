// Settings › Open-source licenses (X-2026-09-28-app-redesign §Screens 7). Every runtime dependency that ships in the app:
// apps/mobile/package.json's and, transitively, its workspace packages' (zod), with the `license` field of its installed
// package.json, read 2026-09-28;
// test/redesign-text.test.ts checks both against the installed packages.
export const LICENSES: readonly { name: string; license: string }[] = [
  { name: "@expo-google-fonts/jetbrains-mono", license: "MIT AND OFL-1.1" },
  { name: "@expo-google-fonts/manrope", license: "MIT AND OFL-1.1" },
  { name: "@expo/vector-icons", license: "MIT" },
  { name: "base64-js", license: "MIT" },
  { name: "expo", license: "MIT" },
  { name: "expo-dev-client", license: "MIT" },
  { name: "expo-file-system", license: "MIT" },
  { name: "expo-font", license: "MIT" },
  { name: "expo-modules-core", license: "MIT" },
  { name: "expo-sharing", license: "MIT" },
  { name: "expo-system-ui", license: "MIT" },
  { name: "react", license: "MIT" },
  { name: "react-native", license: "MIT" },
  { name: "react-native-background-actions", license: "MIT" },
  { name: "react-native-ble-plx", license: "MIT" },
  { name: "react-native-paper", license: "MIT" },
  { name: "react-native-safe-area-context", license: "MIT" },
  { name: "zod", license: "MIT" },
];

// ADR-010: the OBDb signalsets the app ships are CC-BY-SA-4.0 and must be attributed. Sources and commits are the
// READMEs in packages/obd-core/vehicles/{chevrolet-equinox-ev,saej1979}/ (the J1979 PID table in obd-core is taken from the second).
export const OBDB_ATTRIBUTION: readonly { name: string; source: string; license: string }[] = [
  { name: "OBDb Chevrolet Equinox EV signalset", source: "https://github.com/OBDb/Chevrolet-Equinox-EV (commit 15ee122df435d541d928dac8e7532bf43e39bdd4, unmodified)", license: "CC-BY-SA-4.0" },
  { name: "OBDb SAEJ1979 signalset", source: "https://github.com/OBDb/SAEJ1979 (commit d3259214a9e0340c4a6cff9ec5f8ff5953eee6f2, unmodified)", license: "CC-BY-SA-4.0" },
];
