import { useSyncExternalStore } from "react";
import { registerSessionCache } from "./sessionCaches";

export type AnalysisWindow = "3Y" | "5Y";
let selected: AnalysisWindow = "3Y";
const listeners = new Set<() => void>();
export function setAnalysisWindow(value: AnalysisWindow) {
  if (value !== "3Y" && value !== "5Y") throw new Error("Periodo inválido");
  if (selected === value) return;
  selected = value;
  listeners.forEach((notify) => notify());
}
registerSessionCache(() => setAnalysisWindow("3Y"));
export function getAnalysisWindow(): AnalysisWindow { return selected; }
export function useAnalysisWindow() {
  return useSyncExternalStore((notify) => { listeners.add(notify); return () => { listeners.delete(notify); }; }, () => selected, () => selected);
}
