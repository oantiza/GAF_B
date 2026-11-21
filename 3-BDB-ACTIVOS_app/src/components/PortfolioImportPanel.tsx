import { useState } from "react";
import { Aviso } from "./ui/Aviso";
import { Button } from "./ui/Button";
import type { BdbPortfolioImportRejectedPosition, BdbPortfolioImportResult } from "../types/bdbAssets";
import { FileUploadField } from "./ui/FileUploadField";
import { oFalta, peso } from "../core/formato";
import { BROKER_IMPORT_ACCEPT, readPositionImportFileText } from "../core/importFileReader";
import { EURO_CONFIRMATION_TEXT, INCLUDE_UNPROVEN_KEY, INCLUDE_UNPROVEN_YES, pendingChoices, WEIGHTS_CONFIRMATION_TEXT } from "../core/importSummary";
import { ImportChoices, ImportConfirmationTable, IncludeUnprovenBox, UnprovenTable } from "./ImportReview";
import { useLatestRequest } from "../core/useLatestRequest";

interface PortfolioImportPanelProps {
  importResult: BdbPortfolioImportResult | null;
  onImportText: (text: string) => Promise<void>;
  /** Confirma lo que enseña el resumen y carga la importación (séptima pasada: siempre). */
  onConfirmImport?: () => void;
  /** Octava pasada: el asesor elige la columna de importe o el titular. */
  onChooseImportOption?: (key: string, value: string) => void;
}

function formatReason(reason: BdbPortfolioImportRejectedPosition["reason"]): string {
  if (reason === "MALFORMED_LINE") {
    return "Formato";
  }
  if (reason === "INVALID_ASSET_ID") {
    return "Identificador";
  }
  if (reason === "INVALID_WEIGHT") {
    return "Peso";
  }
  if (reason === "MISSING_ASSET") {
    return "No encontrado";
  }
  if (reason === "NON_INVESTABLE_BENCHMARK") {
    return "Índice";
  }
  if (reason === "NON_INVESTABLE") {
    return "No invertible";
  }
  if (reason === "NON_INVESTABLE_NEVER_RESOLVED") {
    return "Sin precio";
  }

  return "Duplicado";
}

function buildRejectionSummary(rejections: BdbPortfolioImportRejectedPosition[]): string {
  const benchmarkRejections = rejections.filter((rejection) => rejection.reason === "NON_INVESTABLE_BENCHMARK");

  if (benchmarkRejections.length > 0) {
    /* DIS-21: si además hay otras líneas rechazadas, se cuentan también; antes la frase las callaba. */
    const otras = rejections.length - benchmarkRejections.length;
    return [
      `${benchmarkRejections.length === 1 ? "1 índice rechazado" : `${benchmarkRejections.length} índices rechazados`} por no ser invertible. No entra como posición de cartera.`,
      otras === 1 ? " Y 1 línea rechazada por otros motivos." : otras > 1 ? ` Y ${otras} líneas rechazadas por otros motivos.` : ""
    ].join("");
  }

  return `${rejections.length === 1 ? "1 línea rechazada" : `${rejections.length} líneas rechazadas`} en la importación.`;
}

export function PortfolioImportPanel({ importResult, onImportText, onConfirmImport, onChooseImportOption }: PortfolioImportPanelProps) {
  const [isImporting, setIsImporting] = useState(false);
  // La casilla se marca para ESTA importación: una nueva la vuelve a pedir.
  const [euroCheckFor, setEuroCheckFor] = useState<BdbPortfolioImportResult | null>(null);
  const euroChecked = euroCheckFor !== null && euroCheckFor === importResult;
  const choicesPending = pendingChoices(importResult?.import_choices).length > 0;
  const euroPending = Boolean(importResult && importResult.imported_positions.length > 0 && !importResult.euro_confirmed);
  const unproven = importResult?.import_unproven;
  const unprovenLeft = Boolean(unproven && unproven.positions.length > 0 && !unproven.included);
  // M2 de la revisión 7: antes de confirmar, nada está «cargado».
  const loaded = Boolean(importResult?.euro_confirmed);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  // M2 (revisión 6): si se eligen dos ficheros seguidos, gana el último aunque el primero tarde más en leerse.
  const fileRequest = useLatestRequest();

  async function handleFile(file: File): Promise<void> {
    const request = fileRequest.begin();
    setFileName(file.name);
    setFileError(null);
    setIsImporting(true);

    try {
      const content = await readPositionImportFileText(file);
      if (!fileRequest.isCurrent(request)) return;

      if (!content.trim()) {
        setFileError("El fichero está vacío o no se ha podido leer su contenido.");
        return;
      }

      await onImportText(content);
    } catch (error) {
      if (!fileRequest.isCurrent(request)) return;
      setFileError(error instanceof Error ? error.message : "No se pudo leer el fichero.");
    } finally {
      if (fileRequest.isCurrent(request)) setIsImporting(false);
    }
  }

  return (
    <section className="portfolio-import-embedded" aria-labelledby="portfolio-import-title">
      {/* Este panel vive DENTRO de una columna del Constructor, que es su único
          anfitrión: su cabecera es la de la columna, no la de un panel. La
          variante suelta, con su propia cabecera a mano, no la pintaba nadie. */}
      <div className="portfolio-col-head">
        <p className="portfolio-col-eyebrow" id="portfolio-import-title">Importar posiciones</p>
        {/* «Solo activos invertibles» dejó de ser cierto: entra también lo que un cliente puede tener y no se puede proponer (decisión 113). */}
        <p className="portfolio-col-sub">Sube asset_id,peso o el extracto de tu bróker (.csv, .xls o .xlsx). Lo que no entra se dice, línea a línea.</p>
      </div>

      <div className="portfolio-import-layout">
        <FileUploadField
          className="portfolio-import-file"
          label="Fichero de posiciones o extracto del bróker"
          helper={isImporting
            ? "Importando…"
            : fileError
              ? fileError
              : fileName
                ? `Último fichero: ${fileName}`
                : "Acepta CSV, TXT, XLS y XLSX con asset_id y peso, o ISIN y valor de mercado."}
          accept={BROKER_IMPORT_ACCEPT}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            void handleFile(file);
          }}
        />
      </div>

      {importResult ? (
        <div className="portfolio-import-result">
          <dl className="portfolio-import-kpis">
            <div>
              <dt>{loaded ? "Cargadas" : "Leídas"}</dt>
              <dd>{importResult.imported_positions.length}</dd>
            </div>
            <div>
              <dt>Rechazadas</dt>
              <dd>{importResult.rejected_positions.length}</dd>
            </div>
            <div>
              <dt>{loaded ? "Peso cargado" : "Peso leído"}</dt>
              <dd>{oFalta(peso(importResult.total_weight_percent / 100))}</dd>
            </div>
          </dl>

          {/* Quinta pasada: red de seguridad. Qué se ha leído, de qué columna,
              con qué criterio de divisa, de qué hojas o tablas y qué se ha
              descartado; siempre, haya o no avisos. */}
          {importResult.import_summary && importResult.import_summary.length > 0 ? (
            /* MAR-21: lo pinta la pieza `Aviso`, como el resumen de Posiciones: lo pendiente en ocre (aviso) y lo ya revisado en
               azul claro (nota). La caja de fuera sigue siendo la región viva con el nombre del resumen, como antes. */
            <div aria-label="Resumen de la importación" role="status">
              <Aviso tono={euroPending || choicesPending || unprovenLeft ? "aviso" : "nota"} titulo="Resumen de la importación.">
              <div className="stack stack--tight">
                {importResult.import_summary.map((line) => (
                  <span key={line}>{line}</span>
                ))}
                {/* Octava pasada (B1, B5): lo que el lector no elige por el asesor. */}
                {importResult.import_choices && importResult.import_choices.length > 0 && onChooseImportOption ? (
                  <ImportChoices choices={importResult.import_choices} onChoose={onChooseImportOption} />
                ) : null}
                {/* Novena pasada (I5): la segunda casilla, desmarcada; lo de fuera va en la lista de abajo. */}
                {onChooseImportOption && !importResult.euro_confirmed ? (
                  <IncludeUnprovenBox
                    unproven={unproven}
                    disabled={choicesPending || isImporting}
                    onToggle={(include) => onChooseImportOption(INCLUDE_UNPROVEN_KEY, include ? INCLUDE_UNPROVEN_YES : "no")}
                  />
                ) : null}
                {/* Séptima pasada: ninguna importación se carga hasta que el asesor
                    confirma lo que enseña el resumen, posición a posición. */}
                {euroPending ? (
                  <>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={euroChecked}
                        disabled={choicesPending}
                        onChange={(event) => setEuroCheckFor(event.target.checked ? importResult : null)}
                      />
                      <span>{importResult.euro_confirmation ? EURO_CONFIRMATION_TEXT : WEIGHTS_CONFIRMATION_TEXT}</span>
                    </label>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={!euroChecked || !onConfirmImport || isImporting || choicesPending}
                      onClick={() => onConfirmImport?.()}
                    >
                      Cargar las posiciones
                    </Button>
                    {importResult.euro_confirmation ? <ImportConfirmationTable positions={importResult.euro_confirmation.positions} compact /> : null}
                  </>
                ) : importResult.euro_confirmed ? (
                  <span>{importResult.euro_confirmation ? "Importes confirmados en euros por el asesor." : "Activos y pesos confirmados por el asesor."}</span>
                ) : null}
                {!importResult.euro_confirmed ? <UnprovenTable unproven={unproven} compact /> : null}
              </div>
              </Aviso>
            </div>
          ) : null}

          {importResult.warnings.length > 0 ? (
            <ul className="portfolio-import-warnings" aria-label="Avisos de la importación">
              {importResult.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : loaded || !euroPending ? (
            <p className="asset-detail-muted">Importación sin avisos adicionales.</p>
          ) : null}

          {importResult.rejected_positions.length > 0 ? (
            <div className="portfolio-import-rejections">
              <div className="portfolio-import-rejection-summary" role="status">
                <strong>Líneas rechazadas.</strong>{" "}
                <span>{buildRejectionSummary(importResult.rejected_positions)}</span>
              </div>
              <h3>Detalle de rechazos</h3>
              <ul>
                {importResult.rejected_positions.map((rejection) => (
                  <li key={`${rejection.line_number}-${rejection.reason}-${rejection.raw_line}`}>
                    <strong>Línea {rejection.line_number}: {formatReason(rejection.reason)}.</strong>{" "}
                    <span>
                      {rejection.asset_id ? `${rejection.asset_id}: ` : ""}
                      {rejection.message}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="portfolio-import-notice">{importResult.local_only_notice}</p>
        </div>
      ) : null}
    </section>
  );
}
