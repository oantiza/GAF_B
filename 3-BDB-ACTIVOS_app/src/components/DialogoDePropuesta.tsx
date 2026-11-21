import { useMemo, useState } from "react";
import { getAssetDataSource } from "../adapters/assetDataSource";
import { fetchComparisonHistory } from "../adapters/portfolioComparisonHistory";
import { seriesParadas } from "../adapters/finDeLaSerie";
import { useModoCliente } from "../app/ClientModeContext";
import { useAnalysisWindow } from "../core/analysisPreferences";
import { esFaltaDeDatos } from "../core/appError";
import { CARTERA_ACTIVA, carterasQueSeOfrecen, eleccionDeLaPropuesta, type EleccionDeLaPropuesta } from "../core/comparacionDeCarteras";
import { importe, oFalta } from "../core/formato";
import type { ComparisonHistory, ComparisonPeriod } from "../core/portfolioComparison";
import {
  faltaParaLaPropuesta,
  MAXIMO_DE_LAS_NOTAS_DEL_PLAN,
  MAXIMO_DEL_MOTIVO,
  propuestaDeCambio,
  ROTULO_ACTUAL,
  ROTULO_PROPUESTA,
  type CarteraDeLaPropuesta
} from "../core/propuestaDeCambio";
import type { ReportBanker } from "../core/reportBanker";
import type { AssetDataSourceKind } from "../types/assetDataSource";
import type { BdbManualPortfolioPosition, BdbSavedLocalPortfolio } from "../types/bdbAssets";
import { AsyncErrorBanner } from "./AsyncErrorBanner";
import { Button } from "./ui/Button";
import { Campo } from "./ui/Campo";
import { DialogBody, DialogFooter, DialogHeader, ModalDialog } from "./ui/ModalDialog";
import { SegmentedControl } from "./ui/SegmentedControl";

const PERIODOS = [
  { id: "3Y", label: "3 años" },
  { id: "5Y", label: "5 años" },
  { id: "10Y", label: "10 años" }
] as const;

type Composicion = CarteraDeLaPropuesta & { capital: number | null };

const capitalFijado = (capital: number | null | undefined) =>
  typeof capital === "number" && Number.isFinite(capital) && capital > 0 ? capital : null;

/**
 * Que el servidor diga que con esas posiciones no se puede simular no impide el documento: qué cambia, el coste y el plan siguen
 * valiendo, y las cifras dicen que faltan. Un fallo pasajero sí se dice, y se puede reintentar: no es un dato que falte.
 */
async function historiaOFaltaDeDatos(positions: readonly BdbManualPortfolioPosition[], periodo: ComparisonPeriod): Promise<ComparisonHistory | null> {
  try {
    return await fetchComparisonHistory(positions, periodo);
  } catch (causa) {
    if (esFaltaDeDatos(causa)) return null;
    throw causa;
  }
}

/**
 * Pedir la Propuesta de cambio desde Informes. Actual y Propuesta se eligen a mano entre las guardadas y la activa: este documento
 * no se alimenta de «Fondos equivalentes» ni de la Propuesta de mejora, que al cliente no se le enseñan hasta validar en vivo. Con
 * Modo cliente se ofrecen la activa y las dos ya elegidas: las demás son de otros clientes.
 *
 * El motivo vive en este diálogo y muere con él: nunca se guarda ni pasa a la propuesta de otro cliente.
 */
export function DialogoDePropuesta({
  activa,
  carteras,
  cliente,
  responsable,
  sourceKind,
  onClose
}: {
  activa: { name: string; positions: readonly BdbManualPortfolioPosition[]; capital: number | null | undefined };
  carteras: readonly BdbSavedLocalPortfolio[];
  /** El que se ha escrito en Informes, si se ha escrito. */
  cliente: string;
  /** Quien firma, el de Informes: vacío, la portada sale sin firma (decisión A-64). */
  responsable: ReportBanker;
  sourceKind: AssetDataSourceKind;
  onClose: () => void;
}) {
  const { seEnsena } = useModoCliente();
  const [eleccion, setEleccion] = useState<EleccionDeLaPropuesta>(() => eleccionDeLaPropuesta.read());
  /* Empieza en el periodo de la pantalla: «Salen con los datos de arriba». */
  const periodoDeLaPantalla = useAnalysisWindow();
  const [periodo, setPeriodo] = useState<ComparisonPeriod>(periodoDeLaPantalla);
  const [motivo, setMotivo] = useState("");
  const [notas, setNotas] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const seVenLasDemas = seEnsena("otrasCarteras");
  const ofrecidas = useMemo(
    () => carterasQueSeOfrecen(carteras, { a: eleccion.actual, b: eleccion.propuesta }, seVenLasDemas),
    [carteras, eleccion, seVenLasDemas]
  );
  const composicion = (id: string): Composicion | null => {
    if (id === CARTERA_ACTIVA) return { name: activa.name, positions: activa.positions, capital: capitalFijado(activa.capital) };
    const guardada = carteras.find((cartera) => cartera.portfolio_id === id);
    return guardada ? { name: guardada.name, positions: guardada.positions, capital: capitalFijado(guardada.total_capital) } : null;
  };
  const actual = composicion(eleccion.actual);
  const propuesta = composicion(eleccion.propuesta);
  const falta = faltaParaLaPropuesta({ actual, propuesta, motivo });
  const elegir = (cambio: Partial<EleccionDeLaPropuesta>) => {
    const siguiente = { ...eleccion, ...cambio };
    eleccionDeLaPropuesta.write(siguiente);
    setEleccion(siguiente);
  };

  async function descargar() {
    if (!actual || !propuesta || falta) return;
    setOcupado(true);
    setError(null);
    try {
      const [historiaActual, historiaPropuesta, assets] = await Promise.all([
        historiaOFaltaDeDatos(actual.positions, periodo),
        historiaOFaltaDeDatos(propuesta.positions, periodo),
        getAssetDataSource(sourceKind).getComparableAssets([...new Set([...actual.positions, ...propuesta.positions].map((p) => p.asset_id))])
      ]);
      const generadoEn = new Date().toISOString();
      const modelo = propuestaDeCambio({
        seriesParadas: await seriesParadas([...actual.positions, ...propuesta.positions].map((p) => p.asset_id), generadoEn),
        actual,
        propuesta,
        periodo,
        historiaActual,
        historiaPropuesta,
        assets,
        capital: actual.capital,
        cliente,
        responsable,
        motivo,
        notasDelPlan: notas,
        generadoEn
      });
      const { downloadPropuestaDeCambioPdf } = await import("../reports/propuestaDeCambioPdf");
      await downloadPropuestaDeCambioPdf(modelo);
      onClose();
    } catch (causa) {
      setError(causa);
    } finally {
      setOcupado(false);
    }
  }

  const nombreDeLaActiva = activa.name.trim() || "sin nombre";
  const selector = (lado: keyof EleccionDeLaPropuesta, rotulo: string, otra: string) => (
    <Campo rotulo={rotulo}>
      <select disabled={ocupado} value={eleccion[lado]} onChange={(evento) => elegir({ [lado]: evento.target.value })}>
        <option value="">Elige una propuesta</option>
        <option disabled={otra === CARTERA_ACTIVA} value={CARTERA_ACTIVA}>{`Propuesta en curso · ${nombreDeLaActiva}`}</option>
        {ofrecidas.map((cartera) => (
          <option disabled={cartera.portfolio_id === otra} key={cartera.portfolio_id} value={cartera.portfolio_id}>
            {cartera.name}
          </option>
        ))}
      </select>
    </Campo>
  );

  /* El capital es el de lo que hay: el plan mueve ese dinero, y el de otra cartera no se toma prestado. */
  const fraseDelCapital = actual
    ? actual.capital != null
      ? `Capital de ${ROTULO_ACTUAL}: ${oFalta(importe(actual.capital))}.`
      : `${ROTULO_ACTUAL} no tiene capital fijado: el documento saldrá en porcentajes.`
    : null;
  const otroCapital = actual && propuesta && propuesta.capital != null && propuesta.capital !== actual.capital
    ? `${ROTULO_PROPUESTA} tiene otro capital (${oFalta(importe(propuesta.capital))}): el plan no lo usa.`
    : null;

  return (
    <ModalDialog labelledBy="informes-propuesta-title" onClose={() => { if (!ocupado) onClose(); }} size="sm">
      <DialogHeader titleId="informes-propuesta-title" title="Propuesta de cambio" onClose={ocupado ? undefined : onClose} />
      <DialogBody className="stack stack--3">
        <p className="analisis-nota">Las dos composiciones en el mismo periodo, con su coste, su motivo y su plan.</p>
        {error ? <AsyncErrorBanner error={error} onRetry={() => void descargar()} /> : null}
        {selector("actual", ROTULO_ACTUAL, eleccion.propuesta)}
        {selector("propuesta", ROTULO_PROPUESTA, eleccion.actual)}
        {!seVenLasDemas ? <p className="analisis-nota">Sal de Modo cliente para ver otras propuestas.</p> : null}
        <div className="stack stack--2">
          <span className="field__label">Periodo</span>
          <SegmentedControl label="Periodo de la comparación" onChange={setPeriodo} options={PERIODOS} value={periodo} />
        </div>
        <Campo pista="Se imprime tal cual, como lo que ha escrito el asesor." rotulo="Motivo de la propuesta">
          <textarea disabled={ocupado} maxLength={MAXIMO_DEL_MOTIVO} onChange={(evento) => setMotivo(evento.target.value)} rows={4} value={motivo} />
        </Campo>
        <Campo opcional rotulo="Notas sobre la ejecución">
          <textarea disabled={ocupado} maxLength={MAXIMO_DE_LAS_NOTAS_DEL_PLAN} onChange={(evento) => setNotas(evento.target.value)} rows={2} value={notas} />
        </Campo>
        <p className="analisis-nota">
          Cliente: {cliente.trim() || "sin nombre en el informe"}. Elaborado por: {responsable.name.trim() || responsable.email.trim() || "sin firma en el informe"}.{fraseDelCapital ? ` ${fraseDelCapital}` : ""}{otroCapital ? ` ${otroCapital}` : ""}
        </p>
      </DialogBody>
      {/* Junto a los botones: el cuerpo puede hacer scroll, y lo que falta se ve sin moverlo. */}
      <DialogFooter nota={falta}>
        <Button disabled={ocupado} onClick={onClose} variant="secondary">Cancelar</Button>
        <Button busy={ocupado} disabled={Boolean(falta) || ocupado} onClick={() => void descargar()} variant="primary">
          {ocupado ? "Preparando…" : "Descargar el informe"}
        </Button>
      </DialogFooter>
    </ModalDialog>
  );
}
