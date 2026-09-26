// Beta consent (ADR-019): docs/specs/T2.9-beta-data-upload.md §Consent screen and §Privacy note, verbatim, one array
// entry per line of the drafts. Any change needs a new CONSENT_VERSION (test/beta-consent.test.ts pins the digest).
import type { CONSENT_VERSIONS } from "obd-core/recording/provenance";

export const CONSENT_VERSION: (typeof CONSENT_VERSIONS)[number] = "beta-1";
export const CONSENT_TITLE = "Help improve battery checks (beta)";
export const CONSENT_SWITCH_LABEL = "Share my data to improve the app";

export const CONSENT_TEXT = [
  "If you switch this on, the app sends a copy of what it read from your car after each scan or charge log. The copy goes to the developer's private storage. You don't have to do anything else. If you're offline, it waits and sends later.",
  "",
  "**What is sent:** the replies your car's modules gave the app. That means battery voltages, current, temperatures, state of charge and trouble codes. It also includes the model and year you picked in your garage, the app version, and the month.",
  "",
  "**What is removed on your phone first:** the last six characters of the VIN (the part that identifies your car), part and serial numbers of the car's modules, the odometer, and anything you typed. The first 11 VIN characters stay; they only say maker, model, year and factory. The app has no location access and sends no location.",
  "",
  "**How it's labeled:** with random codes, never your name, email or VIN.",
  "",
  "**Why:** to confirm the app reads your model correctly and to build better battery measurements.",
  "",
  "**How long:** up to 24 months, then deleted automatically.",
  "",
  "**Your control:** stop any time in Garage → Beta data sharing. \"Delete my data\" there removes everything already sent. Scans of cars you are checking but do not own are shared too — that is what this consent covers (Decision 3).",
].join("\n");

export const PRIVACY_NOTE = [
  "**Beta data: privacy note (version beta-1)**",
  "",
  "*Who.* The app's developer, an individual in Ontario, Canada, runs this beta. Contact: `<owner's chosen address>`.",
  "",
  "*What we collect, only if you switch on sharing.* After each run the app saves, it sends:",
  "- the messages the car's modules sent the app;",
  "- the model and year you chose;",
  "- the app version;",
  "- the month;",
  "- two random codes, one for your phone's install and one per car in your garage.",
  "",
  "Before anything leaves your phone, the app removes:",
  "- the VIN serial (the last six characters);",
  "- module part and serial numbers;",
  "- the odometer;",
  "- other vehicle-information records whose contents we have not reviewed;",
  "- any note you typed.",
  "",
  "The app never asks for your name, email or account. It has no access to your location. Android asks for location on older versions only because it requires that to find Bluetooth devices.",
  "",
  "*Where.* Files are stored in a private Cloudflare R2 bucket and are not public. Cloudflare handles your IP address to deliver each upload. Our upload service does not store it. The server does record when a file arrived.",
  "",
  "*Why.* To check that the app reads each supported model correctly, and to develop and test battery measurements. Results may be published as summaries and statistics that contain no recordings.",
  "",
  "*Who sees it.* Only the developer. We do not sell or share it. A recording from you is published only if you separately agree in writing for that specific file.",
  "",
  "*How long.* Files are deleted automatically 24 months after upload. The developer's working copies follow the same rule.",
  "",
  "*Your choices.* Turn sharing off any time. Nothing more is sent, and anything still waiting is discarded. \"Delete my data\" removes every file already uploaded. The developer's working copies are removed within 30 days. Statistics or models already computed from many testers' data can't be un-computed, but they contain no recordings. If you've uninstalled the app, email the contact above with the beta ID shown in Garage → Beta data sharing.",
].join("\n");
