/* Ola 3: pestañas de Mercado, un solo nivel. Las tres primeras las pinta
   MacroPage (agenda); la cuarta, StrategyPage. */
export type MacroTab = "calendario" | "dividendos" | "resultados";
export type MercadoTab = MacroTab | "estrategia";

export const MACRO_TABS: { id: MacroTab; label: string }[] = [
  { id: "calendario", label: "Tipos y calendario" },
  { id: "dividendos", label: "Dividendos" },
  { id: "resultados", label: "Resultados" }
];

export const MERCADO_TABS: { id: MercadoTab; label: string }[] = [...MACRO_TABS, { id: "estrategia", label: "Estrategia" }];
