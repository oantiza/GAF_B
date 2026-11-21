import { entraAlCargarUnaCartera, NO_SE_ANADE_SIN_MEDIR, sinPrecioNiMetricas } from "./accionDeCartera";
import { esUnIndice } from "./assetMapping";
import { isNotFoundError } from "./appError";
import { importe, oFalta, peso } from "./formato";
import { isWeightBalanced, roundPercent } from "./portfolio";
import {
  brokerExportToCanonicalImport,
  brokerExportToPositionAmounts,
  looksLikeBrokerExport
} from "./brokerPortfolioImport";
import { describeImportSummary, type ImportChoiceValues } from "./importSummary";
import { parseEuropeanNumber } from "./numberFormat";
import type {
  BdbAssetDataSourceKind,
  BdbAssetDetail,
  BdbManualPortfolioPosition,
  BdbPortfolioImportRejectedPosition,
  BdbPortfolioImportResult
} from "../types/bdbAssets";

function getSeparator(line: string): string {
  if (line.includes(";")) {
    return ";";
  }
  if (line.includes("\t")) {
    return "\t";
  }

  return ",";
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

const CABECERAS_DE_PESO = ["weight", "weight_percent", "peso", "peso_percent"];

/**
 * En qué columna va el peso, si la línea es una cabecera. La que escribe «Exportar a CSV» es
 * `asset_id,nombre,peso_percent,importe_eur`, y la que pide el panel, `asset_id,peso`: ninguna se reconocía, y el fichero
 * que exporta la aplicación no se podía volver a importar.
 */
function columnaDelPesoEnLaCabecera(columns: string[]): number | null {
  if (normalizeHeader(columns[0] ?? "") !== "asset_id") return null;
  const indice = columns.findIndex((column) => CABECERAS_DE_PESO.includes(normalizeHeader(column)));
  return indice > 0 ? indice : null;
}

/** Parte una línea respetando las comillas: el nombre de un fondo puede llevar comas. */
function partirLinea(linea: string, separador: string): string[] {
  const columnas: string[] = [];
  let actual = "";
  let entreComillas = false;
  for (let indice = 0; indice < linea.length; indice += 1) {
    const caracter = linea[indice];
    if (caracter === '"') {
      if (entreComillas && linea[indice + 1] === '"') {
        actual += '"';
        indice += 1;
      } else {
        entreComillas = !entreComillas;
      }
    } else if (caracter === separador && !entreComillas) {
      columnas.push(actual);
      actual = "";
    } else {
      actual += caracter;
    }
  }
  columnas.push(actual);
  return columnas.map((columna) => columna.trim());
}

function parseWeight(value: string): number {
  // Ola 2 (T4c): delega en el parser numérico único ("12,5" -> 12.5; también
  // resuelve miles europeos, que antes esta copia interpretaba mal).
  return parseEuropeanNumber(value);
}

function rejectLine(options: {
  lineNumber: number;
  rawLine: string;
  assetId?: string;
  weightPercent?: number;
  reason: BdbPortfolioImportRejectedPosition["reason"];
  message: string;
}): BdbPortfolioImportRejectedPosition {
  return {
    line_number: options.lineNumber,
    raw_line: options.rawLine,
    asset_id: options.assetId,
    weight_percent: options.weightPercent,
    reason: options.reason,
    message: options.message
  };
}

/**
 * Con qué identificadores se busca un activo: el que trae el fichero y, si lleva mercado («MTC.US»), el ticker sin él.
 *
 * Auditoría del 16-11-2026 (IMP-3). El segundo es una sustitución: el sufijo es el mercado, y el mismo ticker en otro
 * mercado puede ser otro valor. «SAN.PA» —Sanofi en París— se buscaba como «SAN», y con un catálogo que tuviera ese
 * ticker se cargaba Banco Santander con el peso de Sanofi, sin ningún aviso. La búsqueda se conserva, porque es como se
 * escribe un ticker con su mercado, pero quien la usa lo sabe (`resolveAsset` dice con qué encontró el activo) y la
 * importación lo avisa con el nombre de lo que carga.
 */
function getLookupCandidates(assetId: string): string[] {
  const trimmed = assetId.trim();
  const candidates = [trimmed];
  const tickerWithoutMarket = trimmed.includes(".") ? trimmed.split(".")[0] : "";

  if (tickerWithoutMarket) {
    candidates.push(tickerWithoutMarket);
  }

  return Array.from(new Set(candidates));
}

async function resolveAsset(
  assetId: string,
  resolver: (assetId: string) => BdbAssetDetail | null | Promise<BdbAssetDetail | null>
): Promise<{ asset: BdbAssetDetail; sinMercado: boolean } | null> {
  const escrito = assetId.trim();
  for (const candidate of getLookupCandidates(assetId)) {
    let asset: BdbAssetDetail | null;

    try {
      asset = await resolver(candidate);
    } catch (error) {
      /* 04-09-2026: un ISIN que no está en la maestra no puede tumbar la
         importación entera. El backend responde NOT_FOUND y eso llegaba aquí
         como excepción: la primera posición desconocida abortaba el import y
         el usuario solo veía «Activo no encontrado.». Ahora es una línea
         rechazada (MISSING_ASSET) más. Cualquier otro fallo — red, permisos,
         backend caído — sí se propaga: ahí sí hay que parar. */
      if (!isNotFoundError(error)) {
        throw error;
      }
      asset = null;
    }

    if (asset) {
      return { asset, sinMercado: candidate !== escrito };
    }
  }

  return null;
}

export async function buildLocalPortfolioImport(options: {
  sourceKind: BdbAssetDataSourceKind;
  text: string;
  /** Elecciones del asesor (columna de importe, titular) para un extracto que las pide (octava pasada). */
  choices?: ImportChoiceValues;
  resolveAsset: (assetId: string) => BdbAssetDetail | null | Promise<BdbAssetDetail | null>;
}): Promise<BdbPortfolioImportResult> {
  const choices = options.choices ?? {};
  const importedPositions: BdbManualPortfolioPosition[] = [];
  const rejectedPositions: BdbPortfolioImportRejectedPosition[] = [];
  /* Posición importada por activo y los ids del texto que han caído en ella:
     dos ISIN que la maestra resuelve al mismo activo (un alias, una clase
     fusionada) o el mismo id repetido se SUMAN en una posición, como en el
     Extracto externo (positionsToPortfolio). Antes el segundo se rechazaba como
     DUPLICATE_ASSET y su importe desaparecía de la cartera. */
  const indexByAssetId = new Map<string, number>();
  const sourceIdsByAssetId = new Map<string, string[]>();
  /* IMP-3: lo que se ha cargado buscando el ticker sin su mercado, para decirlo con el nombre de lo cargado. */
  const cargadosSinMercado: Array<{ escrito: string; asset: BdbAssetDetail }> = [];
  const isBrokerExport = looksLikeBrokerExport(options.text);
  /* B8 (29-09): el extracto se agrupa por ISIN (un fondo en dos cuentas es
     una posición) y se cuentan las filas con importe ilegible para avisar. */
  const brokerImport = isBrokerExport ? brokerExportToCanonicalImport(options.text, choices, { oneClient: true }) : null;
  const importText = brokerImport ? brokerImport.text : options.text;
  /* Auditoría 16-11-2026 (IMP-1): el texto es un extracto y el lector no ha aceptado ninguna posición, así que se lee
     el texto original como «asset_id,peso». Eso vale para lo que de verdad son pesos («ISIN;Importe» con celdas «40%»,
     sonda N13), y solo para eso: antes entraba cualquier cifra, y en un extracto de dos columnas los importes rechazados
     pasaban por pesos («60 USD» y «40 USD» cargaban 60 % y 40 % mientras los avisos decían que «no se importan»; con
     «80,000» y «5,000», 80 % y 5 %). En ese caso una celda solo es un peso si lo dice con su «%». */
  const soloPesosConPorcentaje = brokerImport?.noPositions === true;
  /* El extracto trae importes y de ahi salen los pesos; conservarlos permite
     cargar la cartera con su patrimonio real en vez de dejarla en el capital por
     defecto.
     MEDIA-17 (auditoria 14-10-2026): el capital es el de las lineas ACEPTADAS y
     los pesos se reparten sobre el. Antes se guardaba el total del fichero con
     pesos por debajo del 100 %, y todo lo que renormaliza aguas abajo (costes,
     informe interno, edicion proporcional) inflaba los importes en euros. Lo
     rechazado se dice en un aviso con su importe. */
  const fileAmounts = isBrokerExport ? brokerExportToPositionAmounts(options.text, choices, { oneClient: true }) : [];
  const fileCapital = fileAmounts.reduce((sum, row) => sum + row.amount, 0);
  const fileAmountById = new Map<string, number>();
  for (const row of fileAmounts) {
    fileAmountById.set(row.id, (fileAmountById.get(row.id) ?? 0) + row.amount);
  }
  /** Importe del extracto de cada posicion aceptada, en el orden de importedPositions. */
  const acceptedAmounts: number[] = [];
  // R4-09: CR, LF y CRLF.
  const rows = importText
    .split(/\r\n|\r|\n/)
    .map((rawLine, index) => ({ rawLine, lineNumber: index + 1 }))
    .filter((row) => row.rawLine.trim().length > 0);

  /** Líneas del formato simple con un peso legible (M7: la cabecera no cuenta). */
  let weightLines = 0;
  /* Con cabecera, ella dice cuántas columnas hay, en cuál está el peso y qué separador se usa: un nombre con «;» no lo cambia. */
  let columnaDelPeso = 1;
  let columnasEsperadas = 2;
  let separadorDeLaCabecera: string | null = null;
  for (const [rowIndex, row] of rows.entries()) {
    const separator: string = separadorDeLaCabecera ?? getSeparator(row.rawLine);
    const columns = partirLinea(row.rawLine, separator);

    if (rowIndex === 0) {
      const delPeso = columnaDelPesoEnLaCabecera(columns);
      if (delPeso !== null) {
        columnaDelPeso = delPeso;
        columnasEsperadas = columns.length;
        separadorDeLaCabecera = separator;
        continue;
      }
    }
    if (columns.length === columnasEsperadas && Number.isFinite(parseWeight(columns[columnaDelPeso]))) weightLines += 1;

    if (columns.length !== columnasEsperadas) {
      rejectedPositions.push(
        rejectLine({
          lineNumber: row.lineNumber,
          rawLine: row.rawLine,
          reason: "MALFORMED_LINE",
          message: "Línea mal formateada. Usa asset_id,peso."
        })
      );
      continue;
    }

    const assetId = columns[0];
    const weightValue = columns[columnaDelPeso];

    if (!assetId) {
      rejectedPositions.push(
        rejectLine({
          lineNumber: row.lineNumber,
          rawLine: row.rawLine,
          reason: "INVALID_ASSET_ID",
          message: "Identificador vacío."
        })
      );
      continue;
    }

    const weight = parseWeight(weightValue);

    if (!Number.isFinite(weight) || weight < 0 || weight > 100) {
      rejectedPositions.push(
        rejectLine({
          lineNumber: row.lineNumber,
          rawLine: row.rawLine,
          assetId,
          reason: "INVALID_WEIGHT",
          message: "Peso no numérico o fuera del rango 0-100."
        })
      );
      continue;
    }

    if (soloPesosConPorcentaje && !weightValue.includes("%")) {
      rejectedPositions.push(
        rejectLine({
          lineNumber: row.lineNumber,
          rawLine: row.rawLine,
          assetId,
          reason: "INVALID_WEIGHT",
          message: "Es un importe que el extracto no deja leer, no un peso: no se carga."
        })
      );
      continue;
    }

    const resuelto = await resolveAsset(assetId, options.resolveAsset);
    const asset = resuelto?.asset;

    if (!asset) {
      rejectedPositions.push(
        rejectLine({
          lineNumber: row.lineNumber,
          rawLine: row.rawLine,
          assetId,
          weightPercent: weight,
          reason: "MISSING_ASSET",
          message: "Activo no encontrado en el catálogo."
        })
      );
      continue;
    }

    /* Lo mismo que se conserva al guardar (decisión 113): Deoleo, una clase cerrada o lo suspendido entran con su peso, y en Diseño dicen lo suyo.
       Se queda fuera lo que no es una posición, cada cosa con su nombre: un índice no es lo que dejó de cotizar. */
    if (!entraAlCargarUnaCartera(asset)) {
      rejectedPositions.push(
        rejectLine({
          lineNumber: row.lineNumber,
          rawLine: row.rawLine,
          assetId: asset.asset_id,
          weightPercent: weight,
          ...(sinPrecioNiMetricas(asset)
            ? { reason: "NON_INVESTABLE_NEVER_RESOLVED" as const, message: NO_SE_ANADE_SIN_MEDIR }
            : esUnIndice(asset)
              ? { reason: "NON_INVESTABLE_BENCHMARK" as const, message: "Índice no invertible, excluido de la cartera importada." }
              : { reason: "NON_INVESTABLE" as const, message: "No invertible, excluido de la cartera importada." })
        })
      );
      continue;
    }

    if (resuelto?.sinMercado) cargadosSinMercado.push({ escrito: assetId.trim(), asset });
    const lineAmount =
      fileAmountById.get(assetId) ?? fileAmountById.get(assetId.toUpperCase()) ?? (weight / 100) * fileCapital;
    const existingIndex = indexByAssetId.get(asset.asset_id);
    sourceIdsByAssetId.set(asset.asset_id, [...(sourceIdsByAssetId.get(asset.asset_id) ?? []), assetId]);
    if (existingIndex !== undefined) {
      const existing = importedPositions[existingIndex];
      existing.weight_percent = roundPercent(existing.weight_percent + weight);
      acceptedAmounts[existingIndex] += lineAmount;
      continue;
    }

    indexByAssetId.set(asset.asset_id, importedPositions.length);
    importedPositions.push({
      asset_id: asset.asset_id,
      weight_percent: roundPercent(weight),
      label: asset.display_name
    });
    acceptedAmounts.push(lineAmount);
  }

  const acceptedCapital = acceptedAmounts.reduce((sum, amount) => sum + amount, 0);
  const detectedCapital = fileCapital > 0 && acceptedCapital > 0 ? acceptedCapital : 0;
  if (detectedCapital > 0) {
    // Peso = importe / capital aceptado: peso × capital devuelve el importe del
    // extracto al céntimo. Quinta pasada: con cuatro decimales (roundPercent)
    // el error llegaba a 0,04 € en 87.500 € y crece con el capital; con diez,
    // es despreciable para cualquier cartera.
    importedPositions.forEach((position, index) => {
      position.weight_percent = Number(((acceptedAmounts[index] / detectedCapital) * 100).toFixed(10));
    });
  }

  const totalWeight = roundPercent(importedPositions.reduce((sum, position) => sum + position.weight_percent, 0));
  const warnings: string[] = [];

  const choicePending = Boolean(brokerImport?.choices.some((choice) => choice.chosen === null));
  if (importedPositions.length === 0 && !choicePending) {
    warnings.push("No hay posiciones válidas para cargar.");
  }
  if (importedPositions.length > 0 && !isWeightBalanced(totalWeight)) {
    warnings.push(`La suma de pesos importados es ${oFalta(peso(totalWeight / 100))}, distinta de 100 %.`);
  }
  if (rejectedPositions.length > 0) {
    warnings.push(`${rejectedPositions.length === 1 ? "1 línea rechazada" : `${rejectedPositions.length} líneas rechazadas`} durante la importación.`);
  }
  for (const { escrito, asset } of cargadosSinMercado) {
    warnings.push(
      `«${escrito}» no está en el catálogo con ese mercado: se ha cargado ${asset.asset_id} · ${asset.display_name}, que es el mismo ticker sin el mercado. ` +
        "Comprueba que es el mismo valor: en otro mercado puede ser otra empresa."
    );
  }
  for (const position of importedPositions) {
    const sourceIds = sourceIdsByAssetId.get(position.asset_id) ?? [];
    if (sourceIds.length < 2) continue;
    const distinct = [...new Set(sourceIds)];
    warnings.push(
      distinct.length > 1
        ? `${distinct.slice(0, -1).join(", ")} y ${distinct[distinct.length - 1]} son el mismo activo («${position.label ?? position.asset_id}»): se suman en una posición.`
        : `${distinct[0]} aparece en ${sourceIds.length} líneas: se suman en una posición.`
    );
  }
  const excludedCapital = detectedCapital > 0 ? fileCapital - detectedCapital : 0;
  if (excludedCapital >= 0.005) {
    warnings.push(
      `Quedan fuera ${oFalta(importe(excludedCapital))} del extracto (${oFalta(peso(excludedCapital / fileCapital))}) por las líneas rechazadas: ` +
        `el capital cargado es ${oFalta(importe(detectedCapital))}, la suma de las posiciones aceptadas, y los pesos se reparten sobre él.`
    );
  }
  /* Tercera y cuarta pasada: lo que el lector del extracto no ha querido
     adivinar (columna de importe ambigua o no reconocida, filas sin importe
     legible, en otra divisa sin contravalor, sin identificador, subtotales)
     se dice aquí, con los identificadores afectados. */
  if (brokerImport) warnings.push(...brokerImport.warnings);

  /* Quinta pasada: resumen visible de lo leído, siempre. Séptima: con cada
     posición para comprobar, también en el formato de pesos. Octava: la lista
     de un extracto la pinta el panel como tabla, a partir de `euro_confirmation`. */
  const importSummary = brokerImport
    ? describeImportSummary(brokerImport.summary, { positions: false })
    : [
        `Formato «asset_id,peso»: ${weightLines === 1 ? "1 línea" : `${weightLines} líneas`} con pesos, sin importes en euros; ` +
          `${importedPositions.length === 1 ? "1 posición leída" : `${importedPositions.length} posiciones leídas`}.`,
        ...(importedPositions.length > 0
          ? [
              "Posiciones para comprobar (activo · nombre · peso):",
              ...importedPositions.map((position) =>
                [position.asset_id, position.label, oFalta(peso(position.weight_percent / 100))].filter(Boolean).join(" · ")
              )
            ]
          : [])
      ];
  /* Séptima pasada: lo leído del extracto se confirma SIEMPRE; la pantalla no
     aplica nada (posiciones, pesos ni capital) hasta la confirmación. Octava
     (W45): la lista marca lo que la maestra no tiene y no se cargará. */
  const rejectedIds = new Map(
    rejectedPositions.filter((rejection) => rejection.asset_id).map((rejection) => [rejection.asset_id!.toUpperCase(), rejection.reason])
  );
  const euroConfirmation = brokerImport?.euroConfirmation
    ? {
        ...brokerImport.euroConfirmation,
        positions: brokerImport.euroConfirmation.positions.map((position) => {
          const reason = rejectedIds.get(position.id.toUpperCase());
          if (!reason) return position;
          const note =
            reason === "NON_INVESTABLE_NEVER_RESOLVED"
              ? NO_SE_ANADE_SIN_MEDIR
              : reason === "NON_INVESTABLE_BENCHMARK" || reason === "NON_INVESTABLE"
                ? "no invertible: no se cargará"
                : "no está en el catálogo: no se cargará";
          return { ...position, notes: [...(position.notes ?? []), note] };
        })
      }
    : null;
  if (euroConfirmation && detectedCapital > 0 && rejectedIds.size > 0) {
    importSummary.push(
      `${importedPositions.length === 1 ? "Se cargará 1 posición" : `Se cargarán ${importedPositions.length} posiciones`} por ${oFalta(importe(detectedCapital))}: ` +
        "las marcadas en la lista no se cargan."
    );
  }

  return {
    sourceKind: options.sourceKind,
    imported_positions: importedPositions,
    rejected_positions: rejectedPositions,
    total_weight_percent: totalWeight,
    ...(detectedCapital > 0 ? { detected_capital: Math.round(detectedCapital * 100) / 100 } : {}),
    warnings,
    import_summary: importSummary,
    ...(euroConfirmation && importedPositions.length > 0 ? { euro_confirmation: euroConfirmation } : {}),
    ...(brokerImport && brokerImport.choices.length > 0 ? { import_choices: brokerImport.choices } : {}),
    ...(brokerImport?.summary.unproven ? { import_unproven: brokerImport.summary.unproven } : {}),
    local_only_notice:
      "Importar no guarda la cartera: se guarda al pulsar Guardar. No evalúa idoneidad."
  };
}
