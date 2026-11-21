import { useMemo, useState } from "react";
import { getAssetDataSource } from "../adapters/assetDataSource";
import { fetchComparisonHistory } from "../adapters/portfolioComparisonHistory";
import { seriesParadas } from "../adapters/finDeLaSerie";
import { useModoCliente } from "../app/ClientModeContext";
import { esFaltaDeDatos, motivoDelServidor } from "../core/appError";
import { carterasQueSeOfrecen, eleccionDeCarteras, sinMedidaEnLaComparativa, type EleccionDeCarteras } from "../core/comparacionDeCarteras";
import { entradaDeLaComparativa } from "../core/entradaDeComparativa";
import { hayCifraDeCartera } from "../core/medidaDeLaCartera";
import { alinearLasQueDanCifra, comparisonCoverage, type ComparisonHistory, type ComparisonPeriod } from "../core/portfolioComparison";
import type { AssetDataSourceKind } from "../types/assetDataSource";
import type { BdbSavedLocalPortfolio } from "../types/bdbAssets";
import { AvisoDelInforme } from "./AvisoDelInforme";
import { Button } from "./ui/Button";
import { Campo } from "./ui/Campo";
import { DialogBody, DialogFooter, DialogHeader, ModalDialog } from "./ui/ModalDialog";
import { SegmentedControl } from "./ui/SegmentedControl";

const PERIODOS = [
  { id: "3Y", label: "3 años" },
  { id: "5Y", label: "5 años" },
  { id: "10Y", label: "10 años" }
] as const;

/** Lo que dice el diálogo si no ha salido: un fallo, o que con estos datos una de las dos no se mide (y entonces la frase y el motivo). */
interface AvisoDeLaComparativa {
  error: unknown;
  frase?: string;
  motivo?: string;
}

/**
 * Pedir la comparativa de carteras desde Informes. El documento es el mismo que sale de Comparar carteras:
 * misma entrada (`core/entradaDeComparativa`) y misma elección de las dos carteras, que se comparte entre
 * las dos pantallas. Con Modo cliente solo se ofrecen las dos ya elegidas: las demás son de otros clientes.
 */
export function DialogoDeComparativa({
  carteras,
  sourceKind,
  onClose,
  identidad
}: {
  carteras: readonly BdbSavedLocalPortfolio[];
  sourceKind: AssetDataSourceKind;
  onClose: () => void;
  /** El cliente y quien elabora el informe, los de Informes: la portada los pinta si llegan. */
  identidad?: { cliente?: string; responsable?: { name?: string; email?: string } };
}) {
  const { seEnsena } = useModoCliente();
  const [eleccion, setEleccion] = useState<EleccionDeCarteras>(() => eleccionDeCarteras.read());
  const [periodo, setPeriodo] = useState<ComparisonPeriod>("3Y");
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<AvisoDeLaComparativa | null>(null);
  const seVenLasDemas = seEnsena("otrasCarteras");
  const ofrecidas = useMemo(() => carterasQueSeOfrecen(carteras, eleccion, seVenLasDemas), [carteras, eleccion, seVenLasDemas]);
  const a = carteras.find((cartera) => cartera.portfolio_id === eleccion.a);
  const b = carteras.find((cartera) => cartera.portfolio_id === eleccion.b);
  /* Otra cartera u otro periodo pueden poderse: el aviso era de lo de antes. */
  const elegir = (cambio: Partial<EleccionDeCarteras>) => {
    const siguiente = { ...eleccion, ...cambio };
    eleccionDeCarteras.write(siguiente);
    setEleccion(siguiente);
    setAviso(null);
  };
  const elegirPeriodo = (siguiente: ComparisonPeriod) => {
    setPeriodo(siguiente);
    setAviso(null);
  };

  async function descargar() {
    if (!a || !b) return;
    setOcupado(true);
    setAviso(null);
    try {
      const [historiaA, historiaB, delCatalogo] = await Promise.allSettled([
        fetchComparisonHistory(a.positions, periodo),
        fetchComparisonHistory(b.positions, periodo),
        getAssetDataSource(sourceKind).getComparableAssets([...new Set([...a.positions, ...b.positions].map((p) => p.asset_id))])
      ]);
      /* Un fallo de verdad, de red o del servidor, se reintenta. Que con estos datos una no mida nada, no (decisión 105). */
      const fallo = [historiaA, historiaB].find((historia) => historia.status === "rejected" && !esFaltaDeDatos(historia.reason));
      if (fallo?.status === "rejected") throw fallo.reason;
      if (delCatalogo.status === "rejected") throw delCatalogo.reason;
      const rechazoA = historiaA.status === "rejected" ? historiaA.reason : null;
      const rechazoB = historiaB.status === "rejected" ? historiaB.reason : null;
      const sinMedida = sinMedidaEnLaComparativa(
        { sinMedida: rechazoA !== null, motivo: motivoDelServidor(rechazoA) },
        { sinMedida: rechazoB !== null, motivo: motivoDelServidor(rechazoB) }
      );
      if (historiaA.status === "rejected" || historiaB.status === "rejected") {
        setAviso({ error: rechazoA ?? rechazoB, ...(sinMedida ?? {}) });
        return;
      }
      /* CMP-1: la que no llega al 80 % del peso no da cifra en el papel, y sus fechas no recortan a la otra. */
      const lado = (historia: ComparisonHistory, posiciones: BdbSavedLocalPortfolio["positions"]) => ({ historia, daCifra: hayCifraDeCartera(comparisonCoverage(historia, posiciones).weight) });
      const cargada = { period: periodo, a: historiaA.value, b: historiaB.value, result: alinearLasQueDanCifra(lado(historiaA.value, a.positions), lado(historiaB.value, b.positions), periodo)! };
      const paradas = await seriesParadas([...a.positions, ...b.positions].map((p) => p.asset_id), new Date().toISOString());
      const { downloadComparisonPdf } = await import("../reports/comparePdf");
      await downloadComparisonPdf(entradaDeLaComparativa({ a, b, cargada, assets: delCatalogo.value, identidad, seriesParadas: paradas }));
      onClose();
    } catch (cause) {
      setAviso({ error: cause });
    } finally {
      setOcupado(false);
    }
  }

  const selector = (lado: "a" | "b", rotulo: string, otra: string) => (
    <Campo rotulo={rotulo}>
      <select disabled={ocupado} value={eleccion[lado]} onChange={(evento) => elegir({ [lado]: evento.target.value })}>
        <option value="">Elige una propuesta guardada</option>
        {ofrecidas.map((cartera) => (
          <option disabled={cartera.portfolio_id === otra} key={cartera.portfolio_id} value={cartera.portfolio_id}>
            {cartera.name}
          </option>
        ))}
      </select>
    </Campo>
  );

  return (
    <ModalDialog labelledBy="informes-comparativa-title" onClose={() => { if (!ocupado) onClose(); }} size="sm">
      <DialogHeader titleId="informes-comparativa-title" title="Comparativa de propuestas" onClose={ocupado ? undefined : onClose} />
      <DialogBody className="stack stack--3">
        <p className="analisis-nota">Dos propuestas guardadas en el mismo periodo, con la misma base 100 y en euros.</p>
        {aviso ? <AvisoDelInforme error={aviso.error} frase={aviso.frase} motivo={aviso.motivo} onRetry={() => void descargar()} /> : null}
        {selector("a", "Propuesta A", eleccion.b)}
        {selector("b", "Propuesta B", eleccion.a)}
        {!seVenLasDemas ? <p className="analisis-nota">Sal de Modo cliente para ver otras propuestas.</p> : null}
        <div className="stack stack--2">
          <span className="field__label">Periodo</span>
          <SegmentedControl label="Periodo de la comparación" onChange={elegirPeriodo} options={PERIODOS} value={periodo} />
        </div>
      </DialogBody>
      <DialogFooter>
        <Button disabled={ocupado} onClick={onClose} variant="secondary">Cancelar</Button>
        <Button busy={ocupado} disabled={!a || !b || ocupado || esFaltaDeDatos(aviso?.error)} onClick={() => void descargar()} variant="primary">
          {ocupado ? "Preparando…" : "Descargar el informe"}
        </Button>
      </DialogFooter>
    </ModalDialog>
  );
}
