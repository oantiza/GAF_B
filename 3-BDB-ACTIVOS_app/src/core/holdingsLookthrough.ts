import type {
  BdbAssetDetail,
  BdbAssetHoldings,
  BdbFundPublishedPortfolio,
  BdbHoldingPosition,
  BdbManualPortfolioPosition,
  BdbPortfolioLookThrough,
  BdbPortfolioLookThroughRow
} from "../types/bdbAssets";
import { carteraPublicada, pesoVistoDelFondo } from "./carteraPublicada";
import { esAccion } from "./esAccion";
import { oFalta, peso } from "./formato";
import { claseDeLinea, esFondoPorSuCodigo } from "./lineaDeCartera";
import { assetPmsShares } from "./portfolio";

const TOP_LOOKTHROUGH_ROWS = 25;

function normalizeHoldingName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLocaleLowerCase("es-ES");
}

export function holdingKey(holding: BdbHoldingPosition): string | null {
  const isin = holding.isin?.trim().toUpperCase();
  if (isin) {
    return `isin:${isin}`;
  }
  const name = normalizeHoldingName(holding.name);
  return name ? `name:${name}` : null;
}

function holdingIdentifier(holding: BdbHoldingPosition): string | undefined {
  return holding.isin?.trim().toUpperCase() || holding.ticker?.trim().toUpperCase() || undefined;
}

function finitePercent(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Lo que se dice de una línea que es otro fondo, en la tabla y en la frase de lo mirado (decisión A-165). */
export const FONDO_SIN_MIRAR_POR_DENTRO = "fondo sin mirar por dentro";

/**
 * De dónde sale una línea, sacado del dato: «Directa + 2 fondos», «Directa», «3 fondos». Lo leen pantalla y papel.
 * Si la línea es a su vez un fondo, lo dice: su cartera no se ha abierto.
 */
export function origenDeLaLinea(row: Pick<BdbPortfolioLookThroughRow, "direct_weight_percent" | "fund_count" | "fund_not_opened">): string {
  const fondos = `${row.fund_count} ${row.fund_count === 1 ? "fondo" : "fondos"}`;
  const origen = !row.direct_weight_percent ? fondos : row.fund_count > 0 ? `Directa + ${fondos}` : "Directa";
  return row.fund_not_opened ? `${origen} · ${FONDO_SIN_MIRAR_POR_DENTRO}` : origen;
}

/**
 * Qué se ha mirado de verdad para hacer la tabla. Que un fondo publique algo no dice cuánto: con la muestra, «el 100 % del
 * peso» eran 8 fondos, y de dos de ellos solo habían llegado sus 10 mayores posiciones.
 */
export function resumenDeLoMirado(
  lookThrough: Pick<BdbPortfolioLookThrough, "covered_funds" | "fund_positions" | "direct_positions" | "seen_weight_percent" | "fund_portfolios" | "unopened_funds_weight_percent">
): string {
  const cortos = lookThrough.fund_portfolios.filter((fondo) => !fondo.sufficient).length;
  const acciones = lookThrough.direct_positions;
  const partes = [
    ...(lookThrough.fund_positions > 0
      ? [`${lookThrough.covered_funds} de ${lookThrough.fund_positions} ${lookThrough.fund_positions === 1 ? "fondo publica" : "fondos publican"} cartera${cortos > 0 ? `, ${cortos === 1 ? "uno" : cortos} de ellos menos de la mitad` : ""}`]
      : []),
    ...(acciones > 0 ? [`${acciones} ${acciones === 1 ? "acción" : "acciones"} en directo`] : [])
  ];
  /* A-165: lo que los fondos tienen en otros fondos se ha recibido, pero no se abre: no cuenta como mirado, y se dice. */
  const sinAbrir = lookThrough.unopened_funds_weight_percent ?? 0;
  const dentro = sinAbrir >= 0.05
    ? ` Otro ${oFalta(peso(sinAbrir / 100))} son fondos que llevan dentro los fondos de la cartera: no se miran por dentro.`
    : "";
  return `${partes.join(" y ")}. Se ha mirado el ${oFalta(peso(lookThrough.seen_weight_percent / 100))} del peso de la cartera.${dentro}`;
}

/**
 * Lo que se ha visto de la renta variable, en una frase. Es lo que hace leíble la tabla: con la muestra, las acciones que se ven
 * son unos 32 puntos de los 54 de renta variable, porque de dos ETF solo llegan sus 10 mayores posiciones.
 */
export function resumenDeLasAcciones(
  lookThrough: Pick<BdbPortfolioLookThrough, "equities" | "fund_portfolios">
): string {
  const { identified_weight_percent: vistas, equity_exposure_percent: exposicion } = lookThrough.equities;
  const parciales = lookThrough.fund_portfolios.some((fondo) => !fondo.sufficient);
  return (
    `Las acciones identificadas suman el ${oFalta(peso(Math.max(0, vistas) / 100))} de la cartera, que tiene un ${oFalta(peso(exposicion / 100))} en renta variable.` +
    (parciales ? " De un fondo que solo publica sus mayores posiciones no se ve el resto: cada peso es un mínimo." : "")
  );
}

/**
 * Un ETF de renta variable: las líneas de su cartera, que no traen clase, son acciones. Sin esta regla desaparece lo que la cartera
 * tiene en ETF: con la muestra, un 36 % de ella, y NVIDIA sale con 0,27 % en vez de 2,57 %. Los ETF de otra cosa no entran.
 */
function esEtfDeRentaVariable(asset: Pick<BdbAssetDetail, "instrument_type" | "economic_asset_class">): boolean {
  return asset.instrument_type === "ETF" && asset.economic_asset_class === "EQUITY";
}

interface FilaEnCurso {
  name: string;
  identifier?: string;
  weight_percent: number;
  direct_weight_percent: number;
  source_asset_ids: Set<string>;
  /** La línea es un fondo dentro de un fondo de la cartera. */
  fondoSinAbrir?: boolean;
}

function ordenarYRecortar(filas: Map<string, FilaEnCurso>): BdbPortfolioLookThroughRow[] {
  return Array.from(filas.entries())
    .map(([key, row]) => ({
      key,
      name: row.name,
      identifier: row.identifier,
      weight_percent: row.weight_percent,
      fund_count: row.source_asset_ids.size,
      source_asset_ids: Array.from(row.source_asset_ids).sort(),
      ...(row.direct_weight_percent > 0 ? { direct_weight_percent: row.direct_weight_percent } : {}),
      ...(row.fondoSinAbrir ? { fund_not_opened: true as const } : {})
    }))
    .sort((a, b) => b.weight_percent - a.weight_percent || a.name.localeCompare(b.name, "es"))
    .slice(0, TOP_LOOKTHROUGH_ROWS);
}

interface BuildPortfolioLookThroughArgs {
  positions: BdbManualPortfolioPosition[];
  assets: BdbAssetDetail[];
  loadHoldings: (assetId: string) => Promise<BdbAssetHoldings | null>;
  /** Ola 3b: carga en lote (una llamada, n ids). Si está presente, gana; el
      fan-out en paralelo queda como respaldo. */
  loadHoldingsMany?: (assetIds: string[]) => Promise<Map<string, BdbAssetHoldings | null>>;
}

export async function buildPortfolioLookThrough({
  positions,
  assets,
  loadHoldings,
  loadHoldingsMany
}: BuildPortfolioLookThroughArgs): Promise<BdbPortfolioLookThrough> {
  const assetsById = new Map(assets.map((asset) => [asset.asset_id, asset]));
  const aggregate = new Map<string, FilaEnCurso>();
  const acciones = new Map<string, FilaEnCurso>();
  const fondosSinClase: string[] = [];
  const warnings: string[] = [];
  let coveredFunds = 0;
  let seenWeight = 0;
  let sinAbrir = 0;
  let directPositions = 0;
  const fundPortfolios: BdbFundPublishedPortfolio[] = [];

  /* Una acción en directo es una línea de la cartera: se ve entera y no le falta ningún dato. Se casa con las líneas de
     los fondos solo por ISIN, que traen más de 7.700 líneas de estas acciones en cada base. Por el nombre no: Prosegur Cash
     se llama «CASH» en la base vieja, y en las líneas hay 227 «Cash» que son efectivo; y «Deutsche Bank AG» es también el
     nombre de sus bonos. Una línea sin ISIN que sí fuera la acción (unas 30 de 160.000) queda como fila aparte. */
  const directas = positions.flatMap((position) => {
    const weight = finitePercent(position.weight_percent);
    const asset = assetsById.get(position.asset_id);
    return weight > 0 && asset && esAccion(asset.instrument_type) ? [{ asset, weight }] : [];
  });
  for (const { asset, weight } of directas) {
    const identifier = (asset.isin ?? asset.asset_id).trim().toUpperCase();
    const key = `isin:${identifier}`;
    const existing = aggregate.get(key);
    if (existing) {
      existing.weight_percent += weight;
      existing.direct_weight_percent += weight;
    } else {
      aggregate.set(key, { name: asset.display_name, identifier, weight_percent: weight, direct_weight_percent: weight, source_asset_ids: new Set() });
      directPositions += 1;
    }
    const accion = acciones.get(key);
    if (accion) {
      accion.weight_percent += weight;
      accion.direct_weight_percent += weight;
    } else {
      acciones.set(key, { name: asset.display_name, identifier, weight_percent: weight, direct_weight_percent: weight, source_asset_ids: new Set() });
    }
    seenWeight += weight;
  }

  const fundPositions = positions.filter((position) =>
    finitePercent(position.weight_percent) > 0 && !esAccion(assetsById.get(position.asset_id)?.instrument_type)).length;
  const eligible = positions.flatMap((position) => {
    const fundWeight = finitePercent(position.weight_percent);
    if (fundWeight <= 0) {
      return [];
    }
    const asset = assetsById.get(position.asset_id);
    return asset?.holdings_summary?.has_holdings && !esAccion(asset.instrument_type) ? [{ position, asset, fundWeight }] : [];
  });

  // Auditoría 27-07 (DV6): las peticiones iban encadenadas dentro del bucle
  // (medido en vivo: ~5,1 s con 10 fondos, ~130 ms cada una en caliente). En
  // paralelo con tolerancia por fondo bajan a ~0,3-0,5 s. La agregación de
  // abajo sigue el orden ORIGINAL de posiciones: el resultado es idéntico.
  // Ola 3b: con `loadHoldingsMany` todo el look-through es UNA llamada — el
  // abanico paralelo movía el coste al servidor (cola + arranques en frío).
  let loaded: Array<(typeof eligible)[number] & { holdings: BdbAssetHoldings | null; failed: boolean }>;
  if (loadHoldingsMany && eligible.length > 1) {
    try {
      const byId = await loadHoldingsMany(eligible.map((item) => item.position.asset_id));
      const delLote = eligible.map((item) => ({
        ...item,
        holdings: byId.get(item.position.asset_id) ?? null,
        failed: false
      }));
      /* UI-2 (auditoría del 16-11-2026): todos estos fondos dicen tener cartera, así que el que vuelve sin ella del lote
         no es un fondo «sin posiciones subyacentes»: es uno que no ha llegado. Se pide de uno en uno, y ahí sí se distingue
         el fallo («no disponibles») de la cartera que de verdad viene vacía. */
      const sinLlegar = delLote.filter((item) => item.holdings === null);
      if (sinLlegar.length > 0) {
        const unoAUno = new Map((await loadIndividually(sinLlegar, loadHoldings)).map((item) => [item.position.asset_id, item]));
        loaded = delLote.map((item) => unoAUno.get(item.position.asset_id) ?? item);
      } else {
        loaded = delLote;
      }
    } catch {
      loaded = await loadIndividually(eligible, loadHoldings);
    }
  } else {
    loaded = await loadIndividually(eligible, loadHoldings);
  }

  for (const { position, asset, fundWeight, holdings, failed } of loaded) {
    if (failed) {
      warnings.push(`${asset.display_name}: posiciones subyacentes no disponibles.`);
      continue;
    }

    const rows = holdings?.holdings.filter((holding) => holding.weight_pct > 0) ?? [];
    if (!holdings || rows.length === 0) {
      warnings.push(`${asset.display_name}: sin posiciones subyacentes.`);
      continue;
    }

    coveredFunds += 1;
    const publicada = carteraPublicada(holdings);
    if (publicada) {
      /* Decisión A-165 de Óscar (16-11-2026, hallazgo IMP-5). La posición de un fondo en otro fondo es una línea más de su
         cartera, pero de ella no se sabe qué lleva dentro: se ha recibido, no se ha mirado. Su peso sale de «lo mirado».
         Antes un fondo con el 40 % en un ETF decía «se ha mirado el 100 % del peso». No se abre un nivel por ahora. */
      const visto = pesoVistoDelFondo(publicada);
      const enFondos = Math.min(visto, rows.reduce((suma, holding) => suma + (esFondoPorSuCodigo(holding.holding_type_code) ? holding.weight_pct : 0), 0));
      seenWeight += (fundWeight * (visto - enFondos)) / 100;
      sinAbrir += (fundWeight * enFondos) / 100;
      fundPortfolios.push({
        asset_id: position.asset_id,
        display_name: asset.display_name,
        lines: publicada.lineas,
        security_lines: publicada.titulos,
        published_weight_percent: publicada.pesoPct,
        sufficient: publicada.suficiente,
        ...(enFondos > 0 ? { funds_inside_weight_percent: enFondos } : {}),
        ...(holdings.issuer_portfolio ? { issuer_portfolio: holdings.issuer_portfolio } : {})
      });
    }

    /* Solo acciones, con su signo: una venta en corto de NVIDIA resta de lo que el fondo lleva en NVIDIA. No son pesos brutos de
       un lado, como los de abajo, porque aquí se suma la misma cosa. */
    const etfDeRentaVariable = esEtfDeRentaVariable(asset);
    let lineasSinClase = 0;
    for (const holding of holdings.holdings) {
      const clase = claseDeLinea(holding);
      if (clase === "sin-clase" && !etfDeRentaVariable) lineasSinClase += 1;
      if (clase === "otra" || (clase === "sin-clase" && !etfDeRentaVariable)) continue;
      const key = holdingKey(holding);
      const contribution = (fundWeight * holding.weight_pct) / 100;
      if (!key || !Number.isFinite(contribution)) continue;
      const existente = acciones.get(key);
      if (existente) {
        existente.weight_percent += contribution;
        existente.source_asset_ids.add(position.asset_id);
        existente.identifier ??= holdingIdentifier(holding);
      } else {
        acciones.set(key, {
          name: holding.name,
          identifier: holdingIdentifier(holding),
          weight_percent: contribution,
          direct_weight_percent: 0,
          source_asset_ids: new Set([position.asset_id])
        });
      }
    }
    /* Un fondo sin renta variable no lleva acciones, sepa o no qué es cada línea: no tiene por qué impedir la tabla. */
    if (lineasSinClase > 0 && assetPmsShares(asset).shares.equity > 0) fondosSinClase.push(asset.display_name);

    for (const holding of rows) {
      const key = holdingKey(holding);
      if (!key) {
        continue;
      }
      const contribution = (fundWeight * holding.weight_pct) / 100;
      if (!Number.isFinite(contribution) || contribution <= 0) {
        continue;
      }
      const esFondo = esFondoPorSuCodigo(holding.holding_type_code);
      const existing = aggregate.get(key);
      if (existing) {
        existing.weight_percent += contribution;
        existing.source_asset_ids.add(position.asset_id);
        if (esFondo) existing.fondoSinAbrir = true;
        if (!existing.identifier) {
          existing.identifier = holdingIdentifier(holding);
        }
        continue;
      }
      aggregate.set(key, {
        name: holding.name,
        identifier: holdingIdentifier(holding),
        weight_percent: contribution,
        direct_weight_percent: 0,
        source_asset_ids: new Set([position.asset_id]),
        ...(esFondo ? { fondoSinAbrir: true } : {})
      });
    }
  }

  const rows = ordenarYRecortar(aggregate);
  const exposicion = positions.reduce((suma, position) => {
    const weight = finitePercent(position.weight_percent);
    const asset = assetsById.get(position.asset_id);
    return weight > 0 && asset ? suma + weight * assetPmsShares(asset).shares.equity : suma;
  }, 0);

  return {
    rows,
    equities: {
      rows: ordenarYRecortar(new Map([...acciones].filter(([, fila]) => fila.weight_percent > 0))),
      identified_weight_percent: [...acciones.values()].reduce((suma, fila) => suma + fila.weight_percent, 0),
      equity_exposure_percent: exposicion,
      unclassified_funds: fondosSinClase
    },
    fund_positions: fundPositions,
    covered_funds: coveredFunds,
    direct_positions: directPositions,
    seen_weight_percent: seenWeight,
    ...(sinAbrir > 0 ? { unopened_funds_weight_percent: sinAbrir } : {}),
    fund_portfolios: fundPortfolios,
    warnings
  };
}

async function loadIndividually<T extends { position: { asset_id: string } }>(
  eligible: T[],
  loadHoldings: (assetId: string) => Promise<BdbAssetHoldings | null>
): Promise<Array<T & { holdings: BdbAssetHoldings | null; failed: boolean }>> {
  return Promise.all(
    eligible.map(async (item) => {
      try {
        return { ...item, holdings: await loadHoldings(item.position.asset_id), failed: false };
      } catch {
        return { ...item, holdings: null as BdbAssetHoldings | null, failed: true };
      }
    })
  );
}
