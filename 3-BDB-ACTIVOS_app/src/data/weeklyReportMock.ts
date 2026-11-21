import type { WeeklyReport } from "../types/weeklyReport";

// Muestra de respaldo (igual que el MOCK_REPORT del legacy). Se usa hasta que
// el backend exponga la colección `reports` (type=WEEKLY_REPORT) en la BD nueva.
export const WEEKLY_REPORT_MOCK: WeeklyReport = {
  id: "mock-123",
  date: "2026-06-22T00:00:00.000Z",
  author: "Comité de Inversiones",
  provider: "Muestra (pendiente de backend)",
  summary: {
    headline: "Incertidumbre en tipos, foco en beneficios",
    narrative:
      "La recalibración de expectativas sobre los recortes de tipos y la resiliencia económica sugieren un escenario \"más altos por más tiempo\". La atención se desplaza hacia los resultados empresariales del primer trimestre.",
    keyEvents: [
      "Datos de inflación PCE en EEUU superiores a lo esperado.",
      "Reuniones de bancos centrales asiáticos sin cambios significativos.",
      "Apertura de la temporada de resultados del Q1 de empresas FAANG."
    ],
    kpis: [
      { label: "S&P 500", value: "+1.4%", trend: "up" },
      { label: "Yield 10Y US", value: "4.25%", trend: "neutral" },
      { label: "VIX", value: "14.2", trend: "down" }
    ],
    marketTemperature: "Bullish",
    tailRisks: [
      { risk: "Rebote inesperado de inflación", probability: "Media", impact: "Alto" },
      { risk: "Tensión geopolítica Oriente Medio", probability: "Baja", impact: "Alto" }
    ]
  },
  assetAllocation: {
    overview:
      "Mantenemos un sesgo neutral en Renta Variable, enfocándonos en calidad. Sobreponderamos ligeramente Renta Fija a corto plazo debido a las rentabilidades actuales.",
    classes: [
      { assetClass: "Renta Variable", strategicWeight: 45, tacticalWeight: 45, view: "Neutral", rationale: "Valoraciones ajustadas exigiendo selección táctica." },
      { assetClass: "Renta Fija", strategicWeight: 40, tacticalWeight: 42, view: "Positiva", rationale: "Tasas atractivas en la parte corta de la curva." },
      { assetClass: "Liquidez", strategicWeight: 5, tacticalWeight: 8, view: "Positiva", rationale: "Colchón táctico ante posible volatilidad." },
      { assetClass: "Alternativos", strategicWeight: 10, tacticalWeight: 5, view: "Negativa", rationale: "Falta de catalizadores a corto plazo." }
    ],
    regionsEquity: [
      { region: "EEUU", weight: 60, view: "Neutral", rationale: "Crecimiento sólido pero yields al alza presionan múltiplos." },
      { region: "Europa", weight: 20, view: "Positiva", rationale: "Valoraciones relativas atractivas y mejoras macro." },
      { region: "Emergentes", weight: 15, view: "Neutral", rationale: "Falta de estímulo contundente limita el upside." },
      { region: "Japón", weight: 5, view: "Negativa", rationale: "Potencial cambio monetario del BoJ introduce riesgo." }
    ],
    regionsFixedIncome: [
      { region: "Gobierno Corto", weight: 50, view: "Positiva", rationale: "Rentabilidad atractiva con bajo riesgo de duración." },
      { region: "Crédito IG", weight: 30, view: "Neutral", rationale: "Spreads ajustados; selección por calidad." },
      { region: "High Yield", weight: 20, view: "Negativa", rationale: "Compensación insuficiente por el riesgo de impago." }
    ]
  },
  fullReport: {
    narrative:
      "### 1. MACROECONOMÍA Y GEOPOLÍTICA\n\nEl ciclo económico se mantiene robusto, desafiando las estimaciones iniciales de aterrizaje brusco. La recesión parece descartada a corto plazo.\n\n### 2. ESCENARIOS ESTRATÉGICOS 2026\n\nMantenemos el Soft Landing como escenario base (65%), impulsado por la resiliencia del consumidor americano y el soporte fiscal.\n\n### 3. VALORACIONES RELATIVAS\n\n| Región | P/E adelantado | Media histórica |\n| --- | ---: | ---: |\n| EE. UU. (S&P 500) | 20,4x | 16,5x |\n| Europa (Stoxx 50) | 13,2x | 13,5x |\n\nEuropa ofrece un mayor descuento relativo frente a su media histórica."
  }
};
