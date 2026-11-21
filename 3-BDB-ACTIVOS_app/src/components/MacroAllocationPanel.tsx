import { useEffect, useMemo, useState } from "react";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../types/bdbAssets";
import { oFalta, peso } from "../core/formato";
import { asignarObjetivosPorClase, fraseDeClaseQueNoCabe } from "../core/asignacionTactica";
import { ranuraDeCartera } from "../core/disenoEnSesion";
import { improvementFingerprint } from "../core/improvementResultStore";
import { CLASS_LABELS } from "../core/labels";
import { isWeightBalanced } from "../core/portfolio";
import { SIN_COMISIONES_NI_IMPUESTOS } from "../core/textosDeCartera";
import { Button } from "./ui/Button";
import { Aviso } from "./ui/Aviso";
import { Panel } from "./ui/Panel";

interface MacroAllocationPanelProps {
  positions: BdbManualPortfolioPosition[];
  assets: BdbAssetDetail[];
  /** Los candados de Diseño: esas posiciones, como las de importe fijo, conservan su peso. */
  locks?: Record<string, boolean>;
  onWeightChange: (assetId: string, weightPercent: number) => void;
  /** Dentro del diálogo «Repartir por clase» de Diseño: sin el bloque, que el diálogo ya tiene su título. */
  enDialogo?: boolean;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/* Hallazgo 53: los objetivos que se están probando sobreviven a cambiar de paso, mientras la cartera sea
   la misma; si ha cambiado, parten otra vez de lo que hay. */
const objetivosEnSesion = ranuraDeCartera<{ huella: string; objetivos: Record<string, number> }>(() => ({ huella: "", objetivos: {} }));

export function MacroAllocationPanel({ positions, assets, locks, onWeightChange, enDialogo = false }: MacroAllocationPanelProps) {
  const classOf = useMemo(() => {
    const m = new Map<string, string>();
    assets.forEach((a) => m.set(a.asset_id, a.economic_asset_class));
    return m;
  }, [assets]);

  const classData = useMemo(() => {
    const cur: Record<string, number> = {};
    const fijado: Record<string, number> = {};
    positions.forEach((p) => {
      const w = p.weight_percent || 0;
      const c = classOf.get(p.asset_id) ?? "UNKNOWN";
      cur[c] = (cur[c] ?? 0) + w;
      if (locks?.[p.asset_id] || p.keepEuros) fijado[c] = (fijado[c] ?? 0) + w;
    });
    const classes = Object.keys(cur).sort((a, b) => cur[b] - cur[a]);
    return { cur, fijado, classes };
  }, [positions, classOf, locks]);

  const huella = improvementFingerprint(positions);
  const [targets, setTargets] = useState<Record<string, number>>(() => {
    const guardados = objetivosEnSesion.read();
    return guardados.huella === huella ? guardados.objetivos : {};
  });
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    objetivosEnSesion.write({ huella, objetivos: targets });
  }, [huella, targets]);

  const effectiveTargets = useMemo(() => {
    const t: Record<string, number> = {};
    classData.classes.forEach((c) => {
      t[c] = c in targets ? targets[c] : round2(classData.cur[c]);
    });
    return t;
  }, [classData, targets]);

  const sumTargets = classData.classes.reduce((s, c) => s + (effectiveTargets[c] ?? 0), 0);
  /* Auditoría 14-10 (MEDIA-21/M-15): el criterio común de «cartera cuadrada»
     (WEIGHT_TOLERANCE_PERCENT, ±0,05) en vez de una tolerancia local de 0,1. */
  const balanced = isWeightBalanced(sumTargets);

  /* Hallazgo 20: la cuenta sale de la pantalla, y si un objetivo no cabe se dice antes de aplicar. */
  const asignacion = useMemo(
    () =>
      asignarObjetivosPorClase({
        positions,
        claseDe: (assetId) => classOf.get(assetId) ?? "UNKNOWN",
        candados: locks ?? {},
        objetivos: effectiveTargets
      }),
    [positions, classOf, locks, effectiveTargets]
  );

  function setTarget(c: string, v: number) {
    setTargets({ ...effectiveTargets, [c]: Math.max(0, Math.min(100, v)) });
    setApplied(false);
  }

  function normalizeTargets() {
    if (sumTargets <= 0) return;
    const next: Record<string, number> = {};
    classData.classes.forEach((c) => {
      next[c] = round2(((effectiveTargets[c] ?? 0) / sumTargets) * 100);
    });
    setTargets(next);
    setApplied(false);
  }

  function apply() {
    if (asignacion.noCaben.length > 0) return;
    Object.entries(asignacion.pesos).forEach(([assetId, peso]) => onWeightChange(assetId, peso));
    setApplied(true);
  }

  if (positions.length === 0) {
    return null;
  }

  const procedencia =
    "Fija el peso objetivo por clase y aplícalo. Las posiciones con candado o importe fijo conservan su peso; el resto de la clase se reparte entre las demás, en su proporción actual.";
  const cuerpo = (
    <>
      <div className="macro-alloc-rows">
        {classData.classes.map((c) => (
          <div key={c} className="macro-alloc-row">
            <span className="macro-alloc-class">
              {CLASS_LABELS[c] ?? c}
              <span className="macro-alloc-current">
                {" "}
                · ahora {oFalta(peso(round2(classData.cur[c]) / 100))}
                {classData.fijado[c] ? ` · fijado ${oFalta(peso(round2(classData.fijado[c]) / 100))}` : ""}
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(effectiveTargets[c] ?? 0)}
              onChange={(e) => setTarget(c, Number(e.target.value))}
              aria-label={`Peso objetivo ${CLASS_LABELS[c] ?? c}`}
            />
            <strong className="num">{oFalta(peso((effectiveTargets[c] ?? 0) / 100))}</strong>
          </div>
        ))}
      </div>

      <div className="macro-alloc-actions">
        <p className="macro-alloc-sum">
          Suma objetivo:{" "}
          <strong className={balanced ? "tabular-nums" : "tabular-nums warn"}>{oFalta(peso(sumTargets / 100))}</strong>
        </p>
        <Button onClick={normalizeTargets} disabled={balanced || sumTargets <= 0}>
          Normalizar al 100 %
        </Button>
        <Button variant="primary" onClick={apply} disabled={!balanced || asignacion.noCaben.length > 0}>
          Aplicar a la cartera
        </Button>
      </div>

      {asignacion.noCaben.length > 0 ? (
        <Aviso anunciar titulo="No cabe.">
          {asignacion.noCaben.map((clase) => (
            <span key={clase.clase}>{fraseDeClaseQueNoCabe(clase, CLASS_LABELS[clase.clase] ?? clase.clase)}</span>
          ))}
        </Aviso>
      ) : null}

      {applied ? (
        <Aviso anunciar tono="nota">
          Pesos aplicados según los objetivos por clase.
        </Aviso>
      ) : null}

      <p className="macro-alloc-note">
        Solo reparte entre las clases que ya tienes en cartera. Para incorporar una clase nueva, añade fondos desde el Buscador.
      </p>
      <p className="macro-alloc-note">{SIN_COMISIONES_NI_IMPUESTOS}</p>
    </>
  );

  if (enDialogo) {
    return (
      <div className="stack stack--tight">
        <p className="field__hint">{procedencia}</p>
        {cuerpo}
      </div>
    );
  }

  return (
    <Panel claseDelCuerpo="stack stack--tight" subtitulo={procedencia} titulo="Repartir por clase">
      {cuerpo}
    </Panel>
  );
}
