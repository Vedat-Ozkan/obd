import { type CodesReport } from "obd-core/report";
import type { BatteryDiagnosisReport } from "./report.js";

export type Rating = "great" | "good" | "ok" | "poor" | "not-rated";
export interface RatingView { rating: Rating; basis: string }
export type ReportArea = "soc" | "cells" | "capacity" | "twelveVolt" | "codes";

export const ratingWord: Readonly<Record<Rating, string>> = { great: "Great", good: "Good", ok: "OK", poor: "Poor", "not-rated": "Not rated" };

export const NOT_RATED: RatingView = { rating: "not-rated", basis: "No threshold yet" };

type Module = CodesReport["modules"][number];

function codeList(module: Module): string[] {
  return [module.stored, module.pending, module.permanent].flatMap((read) => read.status === "read" ? read.dtcs : []);
}
export const distinctCodes = (modules: readonly Module[]) => [...new Set(modules.flatMap(codeList))];
export const codesRead = (modules: readonly Module[]) => modules.some((m) => [m.stored, m.pending, m.permanent].some((read) => read.status === "read"));

export function codesRating(codes: CodesReport): RatingView {
  if (distinctCodes(codes.modules).length > 0) return { rating: "poor", basis: "Project policy: a reported code is Poor" };
  if (codes.recentlyCleared.verdict === "indicated") return { rating: "poor", basis: "Project policy (T0.7): the recently-cleared check says yes" };
  if (!codesRead(codes.modules)) return { rating: "not-rated", basis: "No module answered a code read" };
  if (codes.recentlyCleared.verdict === "not-indicated") return { rating: "good", basis: "Project policy: no codes reported, and the recently-cleared check says no" };
  return { rating: "ok", basis: "Project policy: no codes reported, and whether codes were cleared recently is unknown" };
}

export function reportRatings(report: BatteryDiagnosisReport): Readonly<Record<ReportArea, RatingView>> {
  return {
    soc: { rating: "not-rated", basis: "The app does not rate state of charge" },
    cells: NOT_RATED,
    capacity: NOT_RATED,
    twelveVolt: NOT_RATED,
    codes: codesRating(report.codes),
  };
}
