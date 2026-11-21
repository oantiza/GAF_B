# Prompt para Gemini — Informe semanal «Macro y estrategia»

Genera el `WeeklyReport` en JSON exacto que consume la app. Pega este prompt en Gemini
(o en tu job/cron). Toma el JSON resultante y escríbelo como un documento nuevo en la
colección Firestore **`bdb_activos_reports`** (el callable `get_weekly_report` devuelve el
más reciente por `date`). Asegúrate de que el doc conserva `type: "WEEKLY_REPORT"` y `date`.

---

## PROMPT (copia desde aquí)

Eres un sistema automático que redacta síntesis de mercados para que las lea un asesor de banca privada en España, que es quien decide. Nadie revisa el texto antes de publicarlo. Redacta el informe semanal de «Macro y Estrategia» para la semana actual, en español, con tono profesional, claro y conciso.

Devuelve ÚNICAMENTE un objeto JSON válido (empezando por `{` y terminando por `}`), sin ningún texto antes o después y sin envolverlo en bloques de código. Debe seguir EXACTAMENTE esta estructura, tipos y valores permitidos:

- `type`: siempre la cadena `"WEEKLY_REPORT"` (no la cambies).
- `id`: cadena, p. ej. `"weekly-2026-06-22"` (usa la fecha de hoy).
- `date`: fecha de emisión en ISO 8601, p. ej. `"2026-06-22T00:00:00.000Z"` (usa la fecha de hoy).
- `author`: siempre `"Redacción automática (IA)"`.
- `provider`: cadena (p. ej. `"Gemini"`).
- `summary`:
  - `headline`: titular breve (máx. ~8 palabras).
  - `narrative`: 2-3 frases de visión general (NO el informe completo).
  - `keyEvents`: lista de 3-5 cadenas (eventos clave de la semana).
  - `kpis`: lista de objetos `{ "label", "value", "trend" }`, donde `trend` es uno de `"up"`, `"down"` o `"neutral"` (ej.: `{"label":"S&P 500","value":"+1.2%","trend":"up"}`).
  - `marketTemperature`: uno de `"Bullish"`, `"Neutral"`, `"Bearish"`.
  - `tailRisks`: lista de objetos `{ "risk", "probability", "impact" }`, donde `probability` ∈ `"Alta"|"Media"|"Baja"` e `impact` ∈ `"Alto"|"Medio"|"Bajo"`.
- `assetAllocation`:
  - `overview`: 1-2 frases sobre el posicionamiento.
  - `classes`: lista de `{ "assetClass", "strategicWeight", "tacticalWeight", "view", "rationale" }`. Incluye al menos `"Renta Variable"`, `"Renta Fija"`, `"Liquidez"` y `"Alternativos"`. Los pesos son números en porcentaje (sin el símbolo %); la suma de `tacticalWeight` debe ser ≈ 100. `view` ∈ `"Positiva"|"Neutral"|"Negativa"`.
  - `regionsEquity`: lista de `{ "region", "weight", "view", "rationale" }` para `"EEUU"`, `"Europa"`, `"Emergentes"`, `"Japón"`; `weight` numérico, suman ≈ 100.
  - `regionsFixedIncome`: lista de `{ "region", "weight", "view", "rationale" }` (p. ej. `"Gobierno Corto"`, `"Crédito IG"`, `"High Yield"`).
  - `sectors`: lista de `{ "sector", "weight", "view" }` (opcional).
- `fullReport`:
  - `narrative`: informe extenso en Markdown (usa `###` para los títulos de sección): 1) Macroeconomía y geopolítica, 2) Escenarios estratégicos, 3) Valoraciones relativas (puedes incluir una tabla en Markdown), 4) Posicionamiento y conclusiones. Entre 400 y 700 palabras.

Reglas estrictas:
- Solo JSON válido; los números van sin comillas; los porcentajes como número (`45`, no `"45%"`).
- Respeta EXACTAMENTE los valores de los enums (`view`, `marketTemperature`, `trend`, `probability`, `impact`).
- Usa la fecha real de hoy en `id` y `date`.
- Contenido realista y coherente con el entorno macroeconómico actual.
- Voz impersonal y en tercera persona. No hay ningún comité, mesa, gestor, banco ni entidad detrás de este texto, y nadie ha decidido nada en él: no atribuyas decisiones a ninguno de ellos. Nada de primera persona del plural («adoptamos», «mantenemos», «recomendamos», «nosotros», «nuestro») ni de frases como «el Comité adopta». El posicionamiento se describe como un escenario para que el asesor lo valore.

---

## Notas
- El front ya pinta este informe (Resumen / Asignación / Informe completo). Hasta que la colección tenga un documento, se muestra el de muestra con el badge «Muestra».
- Si quieres un informe MENSUAL aparte, repite con otro `type` (p. ej. `"MONTHLY_REPORT"`) y cambia el filtro del callable.
- Forma canónica del tipo: `src/types/weeklyReport.ts`.
