/**
 * Estado inicial para la revisión visual: una cartera realista de 8 posiciones.
 *
 * **Los ISIN salen de la base sembrada, y eso no es un detalle.** Hasta el 03-11-2026
 * esta muestra tenía cuatro activos que ya no existen en la copia de la maestra
 * (`IE00BKM4GZ66`, `LU0996182563`, `LU2037748774`, `LU1681048804`), así que la cartera
 * no se resolvía y Análisis, Rendimiento y Posiciones fotografiaban su estado vacío
 * mientras la batería informaba «0 issues».
 *
 * Y los cuatro que sí existían **estaban mal etiquetados**: `IE00B3XXRP09` figuraba
 * como «Vanguard Global Aggregate Bond UCITS ETF» y en la base es el **Vanguard S&P
 * 500**; `LU0552385295` figuraba como fondo monetario y es el **Morgan Stanley Global
 * Opportunity**, renta variable con un 19 % de volatilidad. Con esas etiquetas la
 * muestra parecía equilibrada y era renta variable casi entera.
 *
 * Los ocho de ahora se eligieron midiendo contra la base: todos tienen cartera
 * publicada (`holdings_summary.has_holdings`), volatilidad a 3 años, exposición y
 * calidad ALTO, que es lo que necesitan la composición subyacente, el mapa
 * riesgo-retorno y el desglose por sector y estilo. Si alguno desaparece de la maestra,
 * la pantalla vuelve a salir vacía: el nombre de cada uno se escribe aquí tal como lo
 * publica la base, para que el desajuste se vea al leer.
 *
 * **Y un tercer error, del 03-11-2026 y mio:** `IE00B18GC888` llevaba el 20 % de la
 * muestra, y no es un activo de cliente. Es uno de los **dos índices base de los
 * benchmarks sintéticos**, que `EXCLUDED_BENCHMARK_ISINS`
 * (`functions_python/readmodel/repository.py`) deja fuera de la selección a propósito:
 * solo aportan histórico para construir los comparadores. La base lo tiene y el índice
 * de búsqueda también, pero `compare_assets` no lo devuelve, así que la pantalla
 * escribía «Activo no encontrado» y el optimizador trabajaba con 7 de 8. En su sitio va
 * el PIMCO GIS Global Bond EUR Hedged, de la **misma categoría** (EAA Fund Global
 * Diversified Bond - EUR Hedged), con 2.376 posiciones subyacentes publicadas.
 *
 * **El criterio que faltaba:** no basta con medir contra la base. Un activo de la muestra
 * tiene que **devolverlo la fuente que consume la aplicación**, que no es Firestore sino
 * `compare_assets`, y esa capa excluye cosas por diseño. Lo vigila ahora
 * `capturaInterfaz.mjs`, que marca la pasada si alguna ruta escribe «Activo no
 * encontrado».
 *
 * **Lo que NO es un error y se queda:** `IE00B3XXRP09` (Vanguard S&P 500, 12 %) sale
 * «bloqueado por calidad del dato» del cálculo temporal. No es la muestra: es el estado
 * real de la copia de la maestra —una de sus series de precio está en `REPAIR_REQUIRED`
 * por `INCOMPLETE_PROVIDER_OR_FX_HISTORY: 2017-08-28`— y la aplicación hace lo correcto
 * al dejarla fuera y decirlo. Se conserva a propósito: con él, cada captura retrata a la
 * vez las cifras completas del 88 % cubierto **y** el aviso de cobertura parcial.
 *
 * Reparto: 54 % renta variable, 30 % renta fija, 9 % mixto, 7 % alternativos.
 */
export const SEED_POSITIONS = [
  { asset_id: "IE00B4L5Y983", weight_percent: 24, label: "iShares Core MSCI World UCITS ETF USD (Acc)" },
  { asset_id: "IE00B3XXRP09", weight_percent: 12, label: "Vanguard S&P 500 UCITS ETF" },
  { asset_id: "LU1883318740", weight_percent: 10, label: "Amundi Funds - Global Equity Responsible A EUR (C)" },
  { asset_id: "LU0329355670", weight_percent: 8, label: "Robeco QI Emerging Markets Active Equities D EUR" },
  { asset_id: "IE00B11XZ103", weight_percent: 20, label: "PIMCO GIS Global Bond Fund E Class EUR (Hedged) Accumulation" },
  { asset_id: "LU0430492750", weight_percent: 10, label: "JPMorgan Funds - Euro Aggregate Bond Fund C (acc) EUR" },
  { asset_id: "FR0013367265", weight_percent: 9, label: "R-co Valor Balanced C EUR" },
  { asset_id: "LU1103307408", weight_percent: 7, label: "Goldman Sachs Absolute Return Tracker EUR-Hedged" }
];

/**
 * **Dónde escribe, y por qué en dos sitios.** `readCurrentPortfolioDraftFromStorage`
 * devuelve `[]` salvo que el borrador guardado declare EXACTAMENTE la fuente con la que
 * corre la aplicación, y `getBrowserDraftStorage` elige `sessionStorage` con la fuente
 * en vivo y `localStorage` con las locales. Esta semilla escribía solo en
 * `localStorage` y solo con `BBDD_STATIC_EXPORT_SAMPLE`: cuando la fuente por defecto
 * pasó a `BBDD_LIVE_API`, dejó de sembrar nada y **nadie se enteró**, porque el lector
 * no falla, devuelve una cartera vacía.
 *
 * Así que se escribe la misma cartera dos veces, una por configuración. Es la forma de
 * que la semilla no dependa de una constante del código de la aplicación que puede
 * cambiar sin avisarla.
 */
export const SEED_SCRIPT = (positions) => {
  const comun = {
    schema_version: "current-portfolio.v1",
    updated_at: new Date("2026-07-25T09:00:00Z").toISOString(),
    local_only_notice:
      "Guardado local en este navegador/dispositivo. No contiene datos maestros ni metricas oficiales.",
    positions
  };
  const CLAVE = "bdb-activos.current-portfolio.v1";
  window.localStorage.setItem(
    CLAVE,
    JSON.stringify({ ...comun, sourceKind: "BBDD_STATIC_EXPORT_SAMPLE" })
  );
  try {
    window.sessionStorage.setItem(
      CLAVE,
      JSON.stringify({ ...comun, sourceKind: "BBDD_LIVE_API" })
    );
  } catch {
    /* Sin sessionStorage (ventana privada bloqueada) queda la copia local. */
  }

  const saved = {
    schema_version: "local-portfolios.v1",
    updated_at: new Date("2026-07-24T18:30:00Z").toISOString(),
    local_only_notice:
      "Guardado local en este navegador/dispositivo. No contiene datos maestros ni metricas oficiales.",
    saved_portfolios: [
      {
        id: "demo-perfil-equilibrado",
        name: "Perfil equilibrado · revisión julio",
        created_at: new Date("2026-07-10T10:15:00Z").toISOString(),
        updated_at: new Date("2026-07-24T18:30:00Z").toISOString(),
        sourceKind: "BBDD_STATIC_EXPORT_SAMPLE",
        positions
      },
      {
        id: "demo-perfil-defensivo",
        name: "Perfil defensivo · propuesta",
        created_at: new Date("2026-06-28T08:00:00Z").toISOString(),
        updated_at: new Date("2026-07-02T11:20:00Z").toISOString(),
        sourceKind: "BBDD_STATIC_EXPORT_SAMPLE",
        /* Defensivo de verdad: 70 % renta fija. El de antes decía «defensivo» y era
           65 % renta variable, porque dos de sus cuatro ISIN estaban mal etiquetados. */
        positions: [
          { asset_id: "IE00B11XZ103", weight_percent: 45 },
          { asset_id: "LU0430492750", weight_percent: 25 },
          { asset_id: "FR0013367265", weight_percent: 15 },
          { asset_id: "IE00B4L5Y983", weight_percent: 15 }
        ]
      }
    ]
  };
  window.localStorage.setItem("bdb-activos.local-portfolios.v1", JSON.stringify(saved));
};
