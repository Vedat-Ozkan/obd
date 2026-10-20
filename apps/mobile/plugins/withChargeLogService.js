const { withAndroidManifest } = require("expo/config-plugins");

const PERMISSIONS = [
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE",
  "android.permission.WAKE_LOCK",
  "android.permission.POST_NOTIFICATIONS",
];
const SERVICE = "com.asterinet.react.bgactions.RNBackgroundActionsTask";

module.exports = function withChargeLogService(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    manifest["uses-permission"] = manifest["uses-permission"] ?? [];
    for (const name of PERMISSIONS) {
      if (!manifest["uses-permission"].some((item) => item.$["android:name"] === name)) manifest["uses-permission"].push({ $: { "android:name": name } });
    }
    const application = manifest.application[0];
    application.service = (application.service ?? []).filter((item) => item.$["android:name"] !== SERVICE);
    application.service.push({ $: { "android:name": SERVICE, "android:foregroundServiceType": "connectedDevice" } });
    return config;
  });
};
