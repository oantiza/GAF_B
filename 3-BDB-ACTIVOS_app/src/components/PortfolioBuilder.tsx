import { useEffect, useMemo, useRef, useState } from "react";
import type {
  BdbAssetDetail,
  BdbManualPortfolioPosition,
  BdbManualPortfolioSummary,
  BdbOptimizationInput,
  BdbOptimizationPreview,
  BdbPortfolioImportResult,
  BdbRiskProfileContract,
  BdbRiskProfileId,
  BdbRiskProfilePreview,
  BdbSavedLocalPortfolio
} from "../types/bdbAssets";
import {
  checkPortfolioFeasibility,
  createDefaultPortfolioConstraints,
  pesosNormalizadosAlCien,
  redondearQueSume
} from "../core/portfolioConstraints";
import { isWeightBalanced } from "../core/portfolio";
import { repartoDeLaCartera } from "../core/radiografiaDeLaCartera";
import { DEFAULT_DRAFT_TOTAL_CAPITAL } from "../core/localPortfolioStorage";
import type { PortfolioAmountUpdate } from "../core/portfolioAmounts";
import { editarImporte, fraseDelImporteAjustado, hayPesoFijado, repartirLoLibreAPartesIguales } from "../core/asignacionTactica";
import type { CarteraAbierta } from "../core/carteraActiva";
import { textoDeGuardada } from "../core/textosDeCartera";
import { disenoEnSesion, type LineaBaseDeCambios, type PasoDeDiseno } from "../core/disenoEnSesion";
import { OptimizerPanel } from "./OptimizerPanel";
import { OptimizationPreviewPanel } from "./OptimizationPreviewPanel";
import { CambiosAplicados } from "./CambiosAplicados";
import { PortfolioConstraintsPanel } from "./PortfolioConstraintsPanel";
import { PortfolioImportPanel } from "./PortfolioImportPanel";
import { PortfolioPositionsTable } from "./PortfolioPositionsTable";
import { PortfolioSummary } from "./PortfolioSummary";
import { PortfolioStatusPanel, QueHayQueRevisar } from "./PortfolioStatusPanel";
import { RegionAllocation } from "./RegionAllocation";
import { PortfolioValidationPanel } from "./PortfolioValidationPanel";
import { RiskProfilePreviewPanel } from "./RiskProfilePreviewPanel";
import { CostsModal } from "./CostsModal";
import { FundSwapModal } from "./FundSwapModal";
import { PortfolioImprovementPanel, type ImprovementCandidateOptions } from "./PortfolioImprovementPanel";
import type { ImprovementCandidateSet } from "../core/portfolioImprovement";
import { PortfolioHorizonPanel } from "./PortfolioHorizonPanel";
import { BacktestComparison } from "./BacktestComparison";
import { PortfolioAnalysisPanel } from "./PortfolioAnalysisPanel";
import { MacroAllocationPanel } from "./MacroAllocationPanel";
import { CapitalContributionPanel } from "./CapitalContributionPanel";
import { SuperSectorsDonut } from "./SuperSectorsDonut";
import type { SwapAlternative, SwapSearchMode } from "../core/fundSwapper";
import type { SwapSelectionOptions } from "../core/fundSwapPresentation";
import { importe as escribirImporte, importeTitular, numero, oFalta, peso as escribirPeso } from "../core/formato";
import { csvCell, downloadCsv } from "../core/positionsShared";
import { usePestanaEnLaDireccion } from "../core/usePestanaEnLaDireccion";
import { Aviso } from "./ui/Aviso";
import { Button } from "./ui/Button";
import { Campo } from "./ui/Campo";
import { Cifra } from "./ui/Cifra";
import { useConfirm } from "./ui/useConfirm";
import { GuardarCarteraDialog } from "./GuardarCarteraDialog";
import { EuroAmountInput } from "./ui/EuroAmountInput";
import { PageHeader } from "./ui/PageHeader";
import { MenuButton } from "./ui/MenuButton";
import { DialogBody, DialogHeader, ModalDialog } from "./ui/ModalDialog";
import { SegmentedControl } from "./ui/SegmentedControl";
import { PanelDePestana, SegmentedTabs } from "./ui/SegmentedTabs";
import "../styles/diseno.css";
import { useCommercialRetroData } from "../core/useCommercialRetroData";
import { buildPortfolioOptimizationDiff, type PortfolioOptimizationApplyContext } from "../core/portfolioOptimizationDiff";
import { optimizationCoverageMessage, uncoveredPositionIds } from "../core/optimizationWeightValidation";
import { candadosTrasSustituir, loQueSePerderiaAlVolver, mismaComposicion } from "../core/cambiosTrasAplicar";
import { useClientMode } from "../app/ClientModeContext";
import { Panel } from "./ui/Panel";
import { GeneradorDeBorrador } from "./GeneradorDeBorrador";
import { PerfilYHorizonteDeLaCartera } from "./PerfilYHorizonteDeLaCartera";
import { AvisosDelMercadoObjetivo } from "./AvisosDelMercadoObjetivo";
import type { PerfilYHorizonte } from "../core/perfilYHorizonte";
import type { BorradorDeCartera, PedidoDeBorrador } from "../adapters/generadorBackend";

interface PortfolioBuilderProps {
  assets: BdbAssetDetail[];
  positions: BdbManualPortfolioPosition[];
  summary: BdbManualPortfolioSummary | null;
  optimizationPreview: BdbOptimizationInput | null;
  localOptimizationPreview: BdbOptimizationPreview | null;
  importResult: BdbPortfolioImportResult | null;
  riskProfilePreview: BdbRiskProfilePreview | null;
  riskProfiles: BdbRiskProfileContract[];
  /** `null` mientras nadie lo haya elegido (decisión 14). */
  selectedRiskProfileId: BdbRiskProfileId | null;
  portfolioNotice: string | null;
  onRemove: (assetId: string) => void;
  /** Con los candados, solo desde el aviso del optimizador tras aplicar una propuesta. */
  onOpenReport: (lockedWeights?: Record<string, number>) => void;
  onReset: () => void;
  onImportText: (text: string) => Promise<void>;
  /** Confirma que los importes pendientes de una importación están en euros (sexta pasada). */
  onConfirmImport?: () => void;
  /** Octava pasada: el asesor elige la columna de importe o el titular de la importación. */
  onChooseImportOption?: (key: string, value: string) => void;
  onSaveLocalPortfolio: (name: string, positions: BdbManualPortfolioPosition[], assets: BdbAssetDetail[], totalCapital: number | undefined) => void;
  onRiskProfileChange: (profileId: BdbRiskProfileId | null) => void;
  onWeightChange: (assetId: string, weightPercent: number) => void;
  /** Cambia el ancla en euros de una posición (`keepEuros`/`targetEuros`) sin tocar su peso. */
  onPositionPatch?: (assetId: string, patch: Pick<BdbManualPortfolioPosition, "keepEuros" | "targetEuros">) => void;
  onAmountsChange: (update: PortfolioAmountUpdate) => void;
  onFindAlternatives: (assetId: string, mode?: SwapSearchMode) => Promise<SwapAlternative[]>;
  onSwap: (oldId: string, newId: string, newLabel: string, options: SwapSelectionOptions) => void;
  /** «Mejorar cartera» (M1): candidatos equivalentes por posición y aplicación de la propuesta. */
  onBuildImprovementCandidates?: (
    positions: BdbManualPortfolioPosition[],
    assets: BdbAssetDetail[],
    options: ImprovementCandidateOptions
  ) => Promise<ImprovementCandidateSet>;
  onApplyImprovement?: (positions: BdbManualPortfolioPosition[]) => void;
  /** Para no repetir un nombre al guardar. La lista de carteras tiene su propia pantalla. */
  savedPortfolios: BdbSavedLocalPortfolio[];
  /** F-04: `undefined` = capital sin fijar; se enseña DEFAULT_DRAFT_TOTAL_CAPITAL como ilustrativo. */
  initialCapital?: number;
  onCapitalChange?: (totalCapital: number | undefined) => void;
  /** Ola 1 (E1): nombre de la cartera activa (cliente · propuesta); vive en el shell. */
  portfolioName?: string;
  onPortfolioNameChange?: (name: string) => void;
  /** Decisión 59: nivel de perfil y horizonte de la cartera, que se guardan con ella. Lo lleva el ciclo del marco. */
  perfilYHorizonte?: PerfilYHorizonte;
  /** Sin él no se ofrecen: no habría dónde guardarlos. */
  onPerfilYHorizonteChange?: (valor: PerfilYHorizonte) => void;
  initialPanel?: PortfolioBuilderInitialPanel;
  /** Lleva al Buscador: una cartera vacía empieza allí o importando (decisión 15). */
  onIrAlBuscador?: () => void;
  /** Tras Simular, el recorrido sigue en Análisis (hallazgo 121). */
  onVerAnalisis?: () => void;
  /** Si lo que hay está guardado, y desde cuándo (hallazgo 47). Lo lleva el marco. */
  guardado?: { abierta: CarteraAbierta | null; sinGuardar: boolean; guardando: boolean };
  /** «Guardar» sobrescribe la cartera abierta; con `comoNueva`, «Guardar como…», crea otra. */
  onGuardar?: (opciones?: { nombre?: string; comoNueva?: boolean }) => Promise<{ ok: boolean; mensaje: string }>;
  /** «Deshacer» tras quitar una posición: vuelve a su sitio. */
  onRestorePosition?: (position: BdbManualPortfolioPosition, index: number) => void;
  /** «Volver a los pesos anteriores» de Antes/después. */
  onRestorePositions?: (positions: BdbManualPortfolioPosition[]) => void;
  /** «Generar un borrador» (decisión 122): lo compone el servidor, y la página lo pide. Sin esto no se ofrece. */
  onGenerarBorrador?: (pedido: PedidoDeBorrador) => Promise<BorradorDeCartera>;
  /** El asesor usa el borrador: sustituye a la cartera, con la misma guardia que una importación. */
  onUsarBorrador?: (borrador: BorradorDeCartera) => void;
  /** DIS-09: las fichas de las posiciones se están leyendo. */
  cargandoFichas?: boolean;
}

/* Ola 2 (B″): pasos de trabajo, no componentes — Componer · Comprobar ·
   Optimizar · Simular, como en el prototipo aprobado. */
type BuilderStep = PasoDeDiseno;

/* El informe no es un panel del Constructor: es otra ruta (`/cartera/informes`)
   y la página decide la vista por la URL (CRIT-04). */
export type PortfolioBuilderInitialPanel = "composition" | "optimization";

const BUILDER_STEPS: { id: BuilderStep; label: string }[] = [
  { id: "compose", label: "Componer" },
  { id: "check", label: "Comprobar" },
  { id: "optimize", label: "Optimizar" },
  { id: "simulate", label: "Simular" }
];

const round2 = (value: number) => Math.round(value * 100) / 100;
const clampPercent = (value: number) => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

/* Fusión Resumen→Constructor (ola 3b): la edición proporcional con candados
   era pieza única del Resumen; ahora vive aquí, con un único estado de
   candados para toda la app (antes había dos desincronizados, F2.8). */
const EDIT_MODE_OPTIONS = [
  { id: "free", label: "Libre" },
  { id: "proportional", label: "Proporcional" }
] as const;

function stepFromInitialPanel(panel: PortfolioBuilderInitialPanel): BuilderStep {
  return panel === "optimization" ? "optimize" : "compose";
}

const IDS_DE_PASO = BUILDER_STEPS.map((paso) => paso.id);
const CLAVE_DEL_PASO = "paso";

/**
 * Pone el paso en la dirección sin añadir una entrada al historial: es donde se está al entrar, no un cambio. Sin
 * `aunqueHaya`, solo si la dirección no dice ya uno. El primer paso no se escribe: una dirección sin él es la inicial.
 */
function escribirElPaso(paso: BuilderStep, aunqueHaya: boolean): void {
  if (typeof window === "undefined") return;
  const prefijo = `${CLAVE_DEL_PASO}=`;
  const trozos = window.location.hash.replace(/^#/, "").split("&").filter(Boolean);
  if (!aunqueHaya && trozos.some((trozo) => trozo.startsWith(prefijo))) return;
  const resto = trozos.filter((trozo) => !trozo.startsWith(prefijo));
  const nuevos = paso === "compose" ? resto : [...resto, `${prefijo}${paso}`];
  const hash = nuevos.length ? `#${nuevos.join("&")}` : "";
  if (hash === window.location.hash || (hash === "" && window.location.hash === "")) return;
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${hash}`);
}

/** Cuánto tiempo se queda «Deshacer» a la vista tras quitar una posición. */
const DESHACER_MS = 8000;

export function PortfolioBuilder({
  assets,
  positions,
  summary,
  optimizationPreview,
  localOptimizationPreview,
  importResult,
  riskProfilePreview,
  riskProfiles,
  selectedRiskProfileId,
  onRemove,
  onOpenReport,
  onReset,
  onImportText,
  onConfirmImport,
  onChooseImportOption,
  onSaveLocalPortfolio,
  onRiskProfileChange,
  onWeightChange,
  onPositionPatch,
  onAmountsChange,
  onFindAlternatives,
  onSwap,
  onBuildImprovementCandidates,
  onApplyImprovement,
  portfolioNotice,
  savedPortfolios,
  initialCapital,
  onCapitalChange,
  portfolioName = "",
  onPortfolioNameChange,
  perfilYHorizonte,
  onPerfilYHorizonteChange,
  initialPanel = "composition",
  onIrAlBuscador,
  onVerAnalisis,
  guardado,
  onGuardar,
  onRestorePosition,
  onRestorePositions,
  onGenerarBorrador,
  onUsarBorrador,
  cargandoFichas = false
}: PortfolioBuilderProps) {
  const { enabled: clientMode } = useClientMode();
  /* F-04 (29-09): sin capital fijado, el Constructor reparte sobre 100.000 €
     ILUSTRATIVOS (marcados en el campo) que no viajan al informe: solo lo que
     el usuario teclea, un extracto o una cartera guardada fijan el capital. */
  const capitalIlustrativo = initialCapital === undefined;
  const [totalCapital, setTotalCapital] = useState<number>(initialCapital ?? DEFAULT_DRAFT_TOTAL_CAPITAL);
  /* Hallazgo 53: lo que antes se perdía al ir al Buscador a añadir un fondo y volver. Se recupera de
     la sesión, en memoria, y lo vacía el marco cuando algo sustituye la cartera. */
  const [enSesion] = useState(() => disenoEnSesion.read());
  const [locks, setLocks] = useState<Record<string, boolean>>(enSesion.locks);
  const [editMode, setEditMode] = useState<"free" | "proportional">(enSesion.editMode);
  /** Por qué se ha ajustado el último peso tecleado o no se ha podido normalizar. El de un importe sale junto a la
      tabla donde se ha escrito: a 768 px, arriba queda a dos pantallas y no se vería. */
  const [avisoDePeso, setAvisoDePeso] = useState<{ texto: string; deImporte: boolean } | null>(null);
  const weightNotice = avisoDePeso && !avisoDePeso.deImporte ? avisoDePeso.texto : null;
  const avisoDeImporte = avisoDePeso?.deImporte ? avisoDePeso.texto : null;
  const setWeightNotice = (texto: string | null) => setAvisoDePeso(texto === null ? null : { texto, deImporte: false });
  const [showCosts, setShowCosts] = useState(false);
  const [swapState, setSwapState] = useState<{ open: boolean; assetId?: string } | null>(null);
  /* El paso va en la dirección (`/cartera#paso=check`): se puede recargar, compartir y volver con «Atrás». Una ruta que
     pide un paso (`/cartera/optimizacion`) manda; si la dirección no dice ninguno, se vuelve al paso en el que se estaba
     (hallazgo 53). Las dos cosas se escriben en la dirección antes de leerla, sin añadir una entrada al historial. */
  useState(() => {
    if (initialPanel !== "composition") escribirElPaso(stepFromInitialPanel(initialPanel), true);
    else escribirElPaso(enSesion.step, false);
    return null;
  });
  const [step, setStep] = usePestanaEnLaDireccion<BuilderStep>(IDS_DE_PASO, "compose", CLAVE_DEL_PASO);
  /* Con posiciones, importar es un botón de la cabecera y abre esto: lo mismo que se ve con la cartera
     vacía. Antes era una sección plegada, fija sobre los pasos, que empujaba el trabajo a media pantalla. */
  const [importando, setImportando] = useState(false);
  /* «Añadir dinero» y «Repartir por clase»: dos acciones de la cabecera de Posiciones, cada una con su diálogo. */
  const [herramienta, setHerramienta] = useState<"aportar" | "repartir" | null>(null);
  const [comparisonBaseline, setComparisonBaseline] = useState<LineaBaseDeCambios | null>(enSesion.comparisonBaseline);
  const { confirm, confirmDialog } = useConfirm();
  /* El nombre es uno solo: el de la cartera. Este diálogo solo lo pide cuando hace falta otro. */
  const [dialogoDeNombre, setDialogoDeNombre] = useState<"como" | "sin-nombre" | null>(null);
  const [errorDeNombre, setErrorDeNombre] = useState<string | null>(null);
  /* Hallazgo 47: quitar una posición deja «Deshacer» a la vista unos segundos. */
  const [quitada, setQuitada] = useState<{ position: BdbManualPortfolioPosition; index: number; conCandado: boolean; nombre: string } | null>(null);
  useEffect(() => {
    disenoEnSesion.write({ locks, editMode, step, comparisonBaseline });
  }, [locks, editMode, step, comparisonBaseline]);

  useEffect(() => {
    if (!quitada) return undefined;
    const temporizador = window.setTimeout(() => setQuitada(null), DESHACER_MS);
    return () => window.clearTimeout(temporizador);
  }, [quitada]);

  /* Solo cuando la dirección cambia estando aquí: al montar manda lo de arriba, o volver a la pantalla
     devolvería siempre al primer paso. */
  const panelAnterior = useRef(initialPanel);
  useEffect(() => {
    if (panelAnterior.current === initialPanel) return;
    panelAnterior.current = initialPanel;
    setStep(stepFromInitialPanel(initialPanel));
  }, [initialPanel, setStep]);

  // Sin posiciones solo se puede componer: los demás pasos vuelven al primero.
  useEffect(() => {
    if (positions.length === 0 && step !== "compose") setStep("compose");
  }, [positions.length, setStep, step]);

  // Auditoría 11-08 (N1): antes el padre remontaba este componente con un
  // `key` por capital y cada tecla borraba el estado local. Ahora la prop se
  // re-sincroniza SOLO cuando cambia (cartera guardada cargada, hidratación);
  // en el roundtrip local → onCapitalChange → prop los valores ya coinciden y
  // no se resetea el input mientras se teclea.
  useEffect(() => {
    if (typeof initialCapital !== "number" || !Number.isFinite(initialCapital)) {
      // F-04: capital sin fijar (p. ej. tras vaciar) → vuelve el ilustrativo.
      setTotalCapital((current) => (current === DEFAULT_DRAFT_TOTAL_CAPITAL ? current : DEFAULT_DRAFT_TOTAL_CAPITAL));
      return;
    }
    const safeCapital = Math.max(0, initialCapital);
    setTotalCapital((current) => (current === safeCapital ? current : safeCapital));
  }, [initialCapital]);

  const weightSum = useMemo(
    () => positions.reduce((sum, position) => sum + (position.weight_percent || 0), 0),
    [positions]
  );
  const balanced = isWeightBalanced(weightSum);
  /* Lo que falta para cuadrar se dice en euros solo si los euros son de alguien. Y lo decide la suma: con capital 0
     no había euros que comparar y salía «Sobran −0 €» cuando faltaban 30 puntos. */
  const textoDeDescuadre = () => {
    const faltan = weightSum < 100;
    const diferencia = Math.abs(100 - weightSum) / 100;
    /* Lo que falta entre dos porcentajes son puntos porcentuales, con un decimal como los pesos: «Faltan 3,5 pp». */
    const cantidad = capitalIlustrativo || !(totalCapital > 0) ? `${numero(diferencia * 100, { decimales: 1 })}\u00a0pp` : importeTitular(diferencia * totalCapital);
    return `${faltan ? "Faltan" : "Sobran"} ${cantidad}`;
  };

  const { records: comparisonRetros } = useCommercialRetroData(clientMode ? [] : assets);
  const comparisonRetroPct = useMemo(
    () => new Map([...comparisonRetros].filter(([, record]) => record.status !== "PENDING_CONFIRMATION").map(([assetId, record]) => [assetId, record.retro_pct])),
    [comparisonRetros]
  );
  /* Lo que se enseña es lo que dejó la propuesta, no lo que hay ahora: un 15 % escrito a mano no es de la columna
     «Propuesta», y sus cifras del modelo no son de esos pesos. Si la cartera ya no es esa, se dice y se retiran. */
  const carteraTrasAplicar = comparisonBaseline?.aplicada ?? positions;
  const haCambiadoDespues = comparisonBaseline ? !mismaComposicion(carteraTrasAplicar, positions) : false;
  const optimizationComparison = useMemo(
    () => comparisonBaseline ? buildPortfolioOptimizationDiff({
      source: comparisonBaseline.source,
      before: comparisonBaseline.before,
      after: carteraTrasAplicar,
      assets,
      retroPctByAssetId: comparisonRetroPct,
      beforeMetrics: comparisonBaseline.beforeMetrics,
      afterMetrics: comparisonBaseline.afterMetrics
    }) : null,
    [assets, carteraTrasAplicar, comparisonBaseline, comparisonRetroPct]
  );

  const applyOptimizedWeights = (weights: Record<string, number>, context?: PortfolioOptimizationApplyContext): string | null => {
    /* R-01 (auditoría 29-09-2026): defensa en profundidad. Una propuesta que no menciona
       una posición con peso (recortada por el tope del objetivo) no debe ponerla a 0 %:
       se rechaza entera y se devuelve el motivo para que el panel lo muestre. */
    const uncovered = uncoveredPositionIds(positions, weights, locks);
    if (uncovered.length > 0) {
      return `${optimizationCoverageMessage(uncovered.length)} No se ha cambiado ningún peso.`;
    }
    /* DIS-23: a dos decimales y sumando lo mismo que la propuesta, como «Normalizar». Redondeando cada peso por su
       cuenta, siete de 1/7 quedaban en 100,03 %. */
    const libres = positions.filter((position) => !locks[position.asset_id]);
    const propuestos = libres.map((position) => (weights[position.asset_id] ?? 0) * 100);
    const objetivo = round2(propuestos.reduce((suma, peso) => suma + peso, 0));
    const redondeados = redondearQueSume(propuestos, objetivo);
    const pesoAplicado = new Map(libres.map((position, indice) => [position.asset_id, redondeados[indice]]));
    setComparisonBaseline({
      before: positions.map((position) => ({ ...position })),
      aplicada: positions.map((position) =>
        locks[position.asset_id] ? { ...position } : { ...position, weight_percent: pesoAplicado.get(position.asset_id) ?? 0 }
      ),
      source: context?.source ?? "Optimizador",
      beforeMetrics: context?.beforeMetrics,
      afterMetrics: context?.afterMetrics
    });
    positions.forEach((position) => {
      // A locked holding keeps its original value, including precision beyond two decimals.
      if (!locks[position.asset_id]) aplicarPesoNuevo(position.asset_id, pesoAplicado.get(position.asset_id) ?? 0);
    });
    return null;
  };

  /* DIS-01: un peso aplicado (optimización, «Reparte por clase») que mueve una posición de importe fijo
     también fija su importe nuevo; si no, el siguiente cambio de capital la devolvería al peso de antes. */
  function aplicarPesoNuevo(assetId: string, weightPercent: number) {
    const position = positions.find((item) => item.asset_id === assetId);
    onWeightChange(assetId, weightPercent);
    if (position && Math.abs(weightPercent - (position.weight_percent || 0)) > 0.005) syncKeptAmount(position, weightPercent);
  }

  const lockedWeights = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    positions.forEach((position) => {
      if (locks[position.asset_id]) {
        out[position.asset_id] = (position.weight_percent || 0) / 100;
      }
    });
    return out;
  }, [positions, locks]);
  /* Posiciones fijas para la mesa de trabajo (normalizar, edición proporcional):
     candados e importes fijos. El optimizador y el informe siguen recibiendo solo
     los candados (`lockedWeights`). */
  const fixedWeights = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = { ...lockedWeights };
    positions.forEach((position) => {
      if (position.keepEuros && typeof out[position.asset_id] !== "number") {
        out[position.asset_id] = (position.weight_percent || 0) / 100;
      }
    });
    return out;
  }, [lockedWeights, positions]);
  const fixedWeightSum = Object.values(fixedWeights).reduce((sum, weight) => sum + weight * 100, 0);
  const fixedOverflow = fixedWeightSum > 100.005;
  /* Qué puede hacer el asesor para liberar peso, según lo que haya fijado: los
     consejos no hablan de candados si solo hay importes fijos, ni al revés. */
  const hasLockedPositions = positions.some((position) => locks[position.asset_id]);
  const hasFixedAmounts = positions.some((position) => position.keepEuros && !locks[position.asset_id]);
  const unfixAdvice =
    hasLockedPositions && hasFixedAmounts
      ? "quita un candado o suelta un importe fijo («Soltar» en su fila)"
      : hasFixedAmounts
        ? "suelta un importe fijo («Soltar» en su fila)"
        : "quita un candado";
  const reduceFixedAdvice =
    hasLockedPositions && hasFixedAmounts
      ? "quita un candado o reduce o suelta un importe fijo"
      : hasFixedAmounts
        ? "reduce o suelta un importe fijo"
        : "quita un candado";
  const sentence = (text: string) => text.charAt(0).toLocaleUpperCase("es") + text.slice(1);
  const selectedRiskProfile = useMemo(
    () => riskProfiles.find((profile) => profile.risk_profile_id === selectedRiskProfileId),
    [riskProfiles, selectedRiskProfileId]
  );
  const portfolioConstraints = useMemo(() => createDefaultPortfolioConstraints(), []);
  const feasibility = useMemo(
    () =>
      checkPortfolioFeasibility({
        assets,
        positions,
        lockedWeights,
        constraints: portfolioConstraints,
        selectedRiskProfile
      }),
    [assets, lockedWeights, portfolioConstraints, positions, selectedRiskProfile]
  );

  // Los candados de posiciones que ya no existen se limpian (patrón del
  // antiguo Resumen): un candado huérfano descuadraba la normalización.
  useEffect(() => {
    setLocks((current) => {
      const validIds = new Set(positions.map((position) => position.asset_id));
      const next = Object.fromEntries(Object.entries(current).filter(([assetId]) => validIds.has(assetId)));
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [positions]);

  function toggleLock(assetId: string) {
    setLocks((prev) => ({ ...prev, [assetId]: !prev[assetId] }));
    /* «Hay un 40 % fijado» deja de ser cierto en cuanto se toca un candado. */
    setWeightNotice(null);
  }

  function quitarPosicion(assetId: string) {
    const index = positions.findIndex((position) => position.asset_id === assetId);
    if (index < 0) return;
    // El nombre se toma ahora: en cuanto la posición se va, el catálogo de la pantalla deja de tenerlo.
    setQuitada({ position: positions[index], index, conCandado: Boolean(locks[assetId]), nombre: nameOf(assetId) });
    onRemove(assetId);
  }

  function deshacerQuitar() {
    if (!quitada) return;
    onRestorePosition?.(quitada.position, quitada.index);
    if (quitada.conCandado) setLocks((prev) => ({ ...prev, [quitada.position.asset_id]: true }));
    setQuitada(null);
  }

  async function volverALosPesosAnteriores() {
    if (!comparisonBaseline) return;
    /* La línea base sobrevive a cambiar de pantalla: entre medias se ha podido añadir un fondo o cambiar un peso, y
       volver se lo lleva todo. Se pregunta nombrando lo que se perdería. */
    const seQuita = loQueSePerderiaAlVolver(comparisonBaseline.aplicada ?? positions, positions, nameOf);
    if (seQuita.length > 0) {
      const seguir = await confirm({
        title: "Volver a los pesos anteriores",
        message: `La cartera ha cambiado desde que se aplicó la propuesta, y volver deshace también eso:\n${seQuita.join("\n")}`,
        confirmLabel: "Volver y perder esos cambios",
        tone: "danger"
      });
      if (!seguir) return;
    }
    onRestorePositions?.(comparisonBaseline.before);
    setComparisonBaseline(null);
  }

  /** «Soltar»: la posición deja de conservar su importe y se reescala como las demás. */
  function releaseFixedAmount(assetId: string) {
    setWeightNotice(null);
    onPositionPatch?.(assetId, { keepEuros: false, targetEuros: undefined });
  }

  const nameOf = (assetId: string) =>
    assets.find((asset) => asset.asset_id === assetId)?.display_name ??
    positions.find((position) => position.asset_id === assetId)?.label ??
    assetId;

  /* La fila que conserva su importe (`keepEuros`) y se edita a mano fija su
     importe nuevo: si `targetEuros` se quedara en el antiguo, el siguiente
     cambio de capital la devolvería a él. Con capital cero no hay importe que
     conservar (un ancla de 0 € la dejaría a 0 % en cuanto se fije el capital):
     la posición deja de fijar euros y conserva el peso tecleado. */
  function syncKeptAmount(position: BdbManualPortfolioPosition, weightPercent: number) {
    if (!position.keepEuros || !onPositionPatch) return;
    if (totalCapital > 0) {
      onPositionPatch(position.asset_id, {
        keepEuros: true,
        targetEuros: Math.round((weightPercent / 100) * totalCapital * 100) / 100
      });
    } else {
      onPositionPatch(position.asset_id, { keepEuros: false, targetEuros: undefined });
    }
  }

  function commitWeights(nextWeights: Record<string, number>) {
    positions.forEach((position) => {
      const targetWeight = nextWeights[position.asset_id];
      if (typeof targetWeight !== "number") return;
      const rounded = round2(targetWeight);
      if (Math.abs(rounded - (position.weight_percent || 0)) <= 0.005) return;
      onWeightChange(position.asset_id, rounded);
      syncKeptAmount(position, rounded);
    });
  }

  /** Edición proporcional (pieza del antiguo Resumen): al cambiar un peso, el
      resto de posiciones sin candado se reescala para mantener el 100 %. */
  function handleTableWeightChange(assetId: string, value: number) {
    if (locks[assetId]) {
      return;
    }
    const current = positions.find((position) => position.asset_id === assetId);
    if (!current) {
      return;
    }
    const requestedWeight = clampPercent(value);
    setWeightNotice(null);
    if (editMode === "free") {
      commitWeights({ [assetId]: requestedWeight });
      return;
    }

    /* ALTA-20.1 (auditoría 14-10-2026): una posición que conserva su importe
       (`keepEuros`, p. ej. tras sustituir un fondo manteniendo los euros) no se
       reescala, pero su peso sigue en la cartera: es fija, como un candado.
       El peso tecleado no puede pasar de lo que dejan las fijas y, si no queda
       ninguna otra libre, es exactamente eso: la editada es la única que puede
       cerrar el 100 %. Cuando el valor se ajusta, se dice por qué. */
    const isFixed = (position: BdbManualPortfolioPosition) =>
      position.asset_id !== assetId && Boolean(locks[position.asset_id] || position.keepEuros);
    const fixedSum = positions
      .filter(isFixed)
      .reduce((sum, position) => sum + (position.weight_percent || 0), 0);
    const room = Math.max(0, 100 - fixedSum);
    const flexible = positions.filter((position) => position.asset_id !== assetId && !isFixed(position));
    const nextWeight = flexible.length === 0 ? room : Math.min(requestedWeight, room);

    if (Math.abs(nextWeight - requestedWeight) >= 0.005) {
      const name = nameOf(assetId);
      setWeightNotice(
        fixedSum > 100
          ? `Las posiciones fijas ya suman ${oFalta(escribirPeso(fixedSum / 100))}: no queda peso para «${name}». ${sentence(reduceFixedAdvice)}.`
          : flexible.length === 0
            ? `«${name}» es la única posición libre: en modo Proporcional su peso es lo que dejan las fijas (${oFalta(escribirPeso(room / 100))}), no ${oFalta(escribirPeso(requestedWeight / 100))}. Para darle otro peso, ${unfixAdvice} o usa el modo Libre.`
            : `«${name}» se queda en ${oFalta(escribirPeso(room / 100))}: es lo que dejan libre las posiciones fijas (candados e importes fijos).`
      );
    }

    const nextWeights: Record<string, number> = { [assetId]: nextWeight };
    if (flexible.length > 0) {
      const targetForOthers = Math.max(0, room - nextWeight);
      const flexibleSum = flexible.reduce((sum, position) => sum + (position.weight_percent || 0), 0);
      flexible.forEach((position) => {
        const base = flexibleSum > 0 ? (position.weight_percent || 0) / flexibleSum : 1 / flexible.length;
        nextWeights[position.asset_id] = targetForOthers * base;
      });

      const roundedSum = Object.values(nextWeights).reduce((sum, weight) => sum + round2(weight), 0);
      const residual = round2(room - roundedSum);
      if (Math.abs(residual) >= 0.01) {
        const largest = [...flexible].sort((a, b) => (b.weight_percent || 0) - (a.weight_percent || 0))[0];
        nextWeights[largest.asset_id] = clampPercent((nextWeights[largest.asset_id] || 0) + residual);
      }
    }

    commitWeights(nextWeights);
  }

  /* Hallazgos 48 y 13: editar un importe o aportar convierte el capital de ejemplo en capital real,
     y luego el informe lo imprime. Nadie lo ha declarado, así que se pregunta antes. */
  function pedirCapitalFijado(motivo: string): Promise<boolean> {
    if (!capitalIlustrativo) return Promise.resolve(true);
    return confirm({
      title: "Capital sin fijar",
      message: `${motivo} Los ${oFalta(importeTitular(totalCapital))} son de ejemplo: para seguir, hay que fijarlos como capital real de la cartera.`,
      confirmLabel: `Fijar ${oFalta(importeTitular(totalCapital))} y seguir`
    });
  }

  /* Decisión 37: manda el peso. La cuenta es de `editarImporte`; aquí se pregunta, se aplica y se dice. */
  async function handleEuroChange(assetId: string, euros: number) {
    const editado = editarImporte(positions, totalCapital, assetId, euros, locks);
    if (!editado) return;
    const aviso = editado.ajuste ? { texto: fraseDelImporteAjustado(editado.ajuste, nameOf(assetId), unfixAdvice), deImporte: true } : null;
    /* Si no hay nada que aplicar, tampoco hay por qué fijar el capital. */
    if (editado.update.positions === positions) {
      setAvisoDePeso(aviso);
      return;
    }
    const motivo = hayPesoFijado(positions, locks)
      ? "Con pesos fijados, un importe se traduce a peso sobre el capital de la cartera."
      : "Editar un importe cambia el capital de la cartera.";
    if (!(await pedirCapitalFijado(motivo))) return;
    setTotalCapital(editado.update.totalCapital);
    onAmountsChange(editado.update);
    setAvisoDePeso(aviso);
  }

  /** Aportación de capital: pesos, importes fijos y capital en un solo cambio. */
  async function handleContribution(update: PortfolioAmountUpdate): Promise<boolean> {
    if (!(await pedirCapitalFijado("Una aportación se suma al capital de la cartera."))) return false;
    setWeightNotice(null);
    setTotalCapital(update.totalCapital);
    onAmountsChange(update);
    return true;
  }

  /* Conservar un importe solo tiene sentido si el importe es de verdad: un ancla sobre euros de ejemplo
     recolocaría la posición en cuanto se fijara el capital. */
  async function handleSwap(oldId: string, newId: string, newLabel: string, options: SwapSelectionOptions) {
    if (options.preserveMode === "money" && capitalIlustrativo) {
      if (!(await pedirCapitalFijado("Conservar el importe de una posición necesita un capital real."))) return;
      onCapitalChange?.(totalCapital);
    }
    setLocks((prev) => candadosTrasSustituir(prev, oldId, newId));
    onSwap(oldId, newId, newLabel, options);
  }

  /** «Guardar»: sobrescribe la abierta. Sin nombre, lo pide: una cartera no se guarda sin él. */
  function pulsarGuardar() {
    if (!portfolioName.trim()) {
      setErrorDeNombre(null);
      setDialogoDeNombre("sin-nombre");
      return;
    }
    void onGuardar?.();
  }

  async function guardarConNombre(nombre: string) {
    setErrorDeNombre(null);
    const resultado = await onGuardar?.({ nombre, comoNueva: dialogoDeNombre === "como" });
    if (resultado && !resultado.ok) {
      setErrorDeNombre(resultado.mensaje);
      return;
    }
    setDialogoDeNombre(null);
  }

  /** Al pie de un paso largo, el siguiente empieza muy arriba: la vista y el foco van a sus pestañas. */
  function irAlPaso(siguiente: BuilderStep) {
    setStep(siguiente);
    window.requestAnimationFrame(() => {
      const pestana = document.getElementById(`builder-step-tab-${siguiente}`);
      pestana?.scrollIntoView?.({ block: "start" });
      pestana?.focus();
    });
  }

  /* Al cambiar el capital, las posiciones de importe fijo (`keepEuros`, sin
     candado) conservan sus euros y su peso cambia; las libres absorben la
     diferencia en proporción a sus pesos, de modo que la suma de pesos no
     cambia: una cartera al 100 % sigue al 100 % y ningún euro se pierde. Los
     candados conservan su peso. Antes las libres no se movían y la cartera
     quedaba, p. ej., al 75 % sin aviso. Si no hay libres con peso que absorban
     el cambio, se avisa y se ofrece normalizar. */
  function handleCapitalChange(nextCapital: number) {
    const safeCapital = Math.max(0, nextCapital);
    const capitalChanged = Math.abs(safeCapital - totalCapital) >= 0.005;
    setWeightNotice(null);
    /* Un capital de 0 no es un capital: la cartera vuelve a «sin fijar», como dice Informes. */
    if (safeCapital <= 0) {
      setTotalCapital(DEFAULT_DRAFT_TOTAL_CAPITAL);
      onCapitalChange?.(undefined);
      return;
    }
    setTotalCapital(safeCapital);
    onCapitalChange?.(safeCapital);
    const anchored = positions.filter(
      (position) => position.keepEuros && !locks[position.asset_id] && typeof position.targetEuros === "number"
    );
    if (anchored.length === 0) {
      return;
    }
    const nextWeights: Record<string, number> = {};
    anchored.forEach((position) => {
      nextWeights[position.asset_id] = ((position.targetEuros ?? 0) / safeCapital) * 100;
    });
    const anchoredBefore = anchored.reduce((sum, position) => sum + (position.weight_percent || 0), 0);
    const anchoredAfter = Object.values(nextWeights).reduce((sum, weight) => sum + weight, 0);
    const free = positions.filter((position) => !(position.asset_id in nextWeights) && !locks[position.asset_id]);
    const freeSum = free.reduce((sum, position) => sum + (position.weight_percent || 0), 0);
    const room = freeSum + anchoredBefore - anchoredAfter;
    const absorbed = freeSum > 0 && room >= 0;
    if (absorbed) {
      free.forEach((position) => {
        nextWeights[position.asset_id] = ((position.weight_percent || 0) / freeSum) * room;
      });
    }
    /* Los pesos se aplican acotados a 0-100 %, como los guarda la página: la
       suma del aviso sale de esos mismos pesos, no de los teóricos (una fija de
       50.000 € con 40.000 € de capital queda al 100 %, no al 125 %). */
    Object.keys(nextWeights).forEach((assetId) => {
      nextWeights[assetId] = clampPercent(nextWeights[assetId]);
    });
    positions.forEach((position) => {
      const weight = nextWeights[position.asset_id];
      if (typeof weight === "number" && Math.abs(weight - (position.weight_percent || 0)) > 1e-9) {
        onWeightChange(position.asset_id, weight);
      }
    });
    if (!capitalChanged || Math.abs(anchoredAfter - anchoredBefore) < 0.005) {
      return;
    }
    const totalAfter =
      positions.reduce((sum, position) => sum + (nextWeights[position.asset_id] ?? (position.weight_percent || 0)), 0);
    if (absorbed) {
      setWeightNotice(
        "Las posiciones de importe fijo conservan sus euros; el cambio de capital se reparte entre las libres según sus pesos."
      );
      return;
    }
    if (room < 0) {
      // Importe fijo que no cabe: lo que piden las fijas por encima del capital que dejan los candados.
      const lockedWeight = positions
        .filter((position) => locks[position.asset_id])
        .reduce((sum, position) => sum + (position.weight_percent || 0), 0);
      const fixedEuros = anchored.reduce((sum, position) => sum + (position.targetEuros ?? 0), 0);
      const roomForFixed = (safeCapital * Math.max(0, 100 - lockedWeight)) / 100;
      const outside = fixedEuros - roomForFixed;
      setWeightNotice(
        outside >= 0.005
          ? `Con ${oFalta(importeTitular(safeCapital))} de capital${lockedWeight > 0 ? " y los pesos con candado" : ""}, los importes fijos (${oFalta(escribirImporte(fixedEuros))}) no caben: quedan fuera ${oFalta(escribirImporte(outside))}. La cartera suma ${oFalta(escribirPeso(totalAfter / 100))}. Sube el capital o ${reduceFixedAdvice}.`
          : `Con ${oFalta(importeTitular(safeCapital))} los importes fijos ya no caben en el peso que tenía la cartera, que ahora suma ${oFalta(escribirPeso(totalAfter / 100))}. Sube el capital o ${reduceFixedAdvice}.`
      );
      return;
    }
    setWeightNotice(
      `Las posiciones de importe fijo conservan sus euros, pero no hay posiciones libres con peso que absorban el cambio: la cartera suma ${oFalta(escribirPeso(totalAfter / 100))}. Para cuadrarla, ${
        free.length > 0 ? "da peso a alguna posición libre" : unfixAdvice
      } y usa «Normalizar al 100 %», o ajusta los pesos.`
    );
  }

  /* Normalizar reparte solo entre las posiciones libres: candados e importes
     fijos (`keepEuros`) conservan su peso, igual que en la edición proporcional. */
  const libresACero =
    positions.some((position) => typeof fixedWeights[position.asset_id] !== "number") &&
    positions.every((position) => typeof fixedWeights[position.asset_id] === "number" || (position.weight_percent || 0) <= 0);

  function normalize() {
    setWeightNotice(null);
    const free = positions.filter((position) => typeof fixedWeights[position.asset_id] !== "number");
    if (free.length === 0) {
      setWeightNotice(`No hay posiciones libres que reescalar: todas tienen candado o importe fijo. ${sentence(unfixAdvice)} o usa el modo Libre.`);
      return;
    }
    if (fixedOverflow) return; // el aviso de fijas por encima del 100 % ya lo explica
    if (libresACero) {
      /* Lo que acaba de llegar del Buscador entra al 0 %: no hay proporción que conservar. */
      Object.entries(repartirLoLibreAPartesIguales(positions, locks)).forEach(([assetId, weight]) => onWeightChange(assetId, weight));
      return;
    }
    Object.entries(pesosNormalizadosAlCien({ positions, lockedWeights: fixedWeights })).forEach(([assetId, weight]) => onWeightChange(assetId, weight));
  }

  /* DIS-16: el mismo CSV que Posiciones (`csvCell` y `downloadCsv`): punto y coma, coma decimal y BOM, para que una hoja
     de cálculo en español lo abra en columnas. La primera columna sigue llamándose `asset_id` y la del peso, «Peso»: son
     las que reconoce el lector de importación, y así lo que se descarga se vuelve a importar. */
  function exportCsv() {
    const lines = [["asset_id", "Nombre", "Peso", "Euros"].join(";")];
    positions.forEach((position) => {
      const asset = assets.find((item) => item.asset_id === position.asset_id);
      const name = String(asset?.display_name ?? position.label ?? position.asset_id).replace(/\r?\n/g, " ");
      // Sin capital fijado no hay importe: una columna vacía, no los euros de ejemplo.
      const euros = capitalIlustrativo ? null : Math.round(((position.weight_percent || 0) / 100) * (totalCapital || 0) * 100) / 100;
      lines.push([csvCell(position.asset_id), csvCell(name), csvCell(position.weight_percent), csvCell(euros)].join(";"));
    });
    downloadCsv(lines, "propuesta.csv");
  }

  /* Las tres formas de empezar una propuesta, iguales en los dos sitios donde se ofrecen. */
  const arranque = (
    <div className="portfolio-start-grid">
      <div className="portfolio-start-buscador">
        <div className="portfolio-col-head">
          <p className="portfolio-col-eyebrow">Desde el Buscador</p>
          <p className="portfolio-col-sub">Busca cada activo y pulsa «Añadir». Entra al 0 %; el peso se lo das aquí.</p>
        </div>
        {onIrAlBuscador ? <Button variant="secondary" onClick={onIrAlBuscador}>Ir al Buscador</Button> : null}
      </div>
      <PortfolioImportPanel
        importResult={importResult}
        onImportText={onImportText}
        onConfirmImport={onConfirmImport}
        onChooseImportOption={onChooseImportOption}
      />
      {onGenerarBorrador && onUsarBorrador ? (
        <GeneradorDeBorrador
          perfiles={riskProfiles}
          nivelInicial={riskProfiles.find((perfil) => perfil.risk_profile_id === selectedRiskProfileId)?.level}
          sustituye={positions.length > 0}
          onGenerar={onGenerarBorrador}
          onUsar={(borrador) => {
            setImportando(false);
            onUsarBorrador(borrador);
          }}
        />
      ) : null}
    </div>
  );

  /* Una importación a medias sobrevive a cambiar de pantalla (hallazgo 53). Con el diálogo cerrado, se dice aquí. */
  const importacionSinConfirmar = Boolean(
    importResult &&
      !importResult.euro_confirmed &&
      (importResult.imported_positions.length > 0 || (importResult.import_choices ?? []).some((choice) => choice.chosen === null))
  );
  const avisoDeImportacion = positions.length > 0 && importacionSinConfirmar && !importando;
  /* Los euros que se pueden decir que se mueven: sobre el capital de ejemplo sería una cifra inventada. */
  const capitalFijado = capitalIlustrativo ? undefined : totalCapital;
  const hayPosiciones = positions.length > 0;
  const descuadrada = hayPosiciones && !balanced;
  const cerrarHerramienta = () => setHerramienta(null);
  const siguientePaso = BUILDER_STEPS[BUILDER_STEPS.findIndex((item) => item.id === step) + 1];

  /* Lo que gobierna la edición de los pesos va en la cabecera del bloque que gobierna: el modo, y las dos acciones que
     cambian varios pesos a la vez (DIS-15: «Repartir por clase» vivía en Simular, que solo mide). */
  const herramientas = (
    <div className="diseno-herramientas">
      <SegmentedControl
        className="fund-mode-switch"
        label="Al editar un peso"
        onChange={(mode) => {
          setEditMode(mode);
          setWeightNotice(null);
        }}
        options={EDIT_MODE_OPTIONS}
        value={editMode}
      />
      <Button onClick={() => setHerramienta("aportar")} size="sm" variant="secondary">
        Añadir dinero
      </Button>
      <Button onClick={() => setHerramienta("repartir")} size="sm" variant="secondary">
        Repartir por clase
      </Button>
    </div>
  );

  return (
    <article className="portfolio-builder-panel builder-page">
      <PageHeader
        className="portfolio-header"
        eyebrow="Propuesta"
        title={portfolioName.trim() || "Diseño de la propuesta"}
        estado={
          !guardado
            ? undefined
            : guardado.sinGuardar
              ? <span className="estado-de-guardado is-sin-guardar">Cambios sin guardar</span>
              : guardado.abierta
                ? <span className="estado-de-guardado">{textoDeGuardada(guardado.abierta.updated_at)}</span>
                : undefined
        }
        actionsClassName="portfolio-header-actions"
        actions={
          <>
            <Button
              busy={guardado?.guardando}
              disabled={!hayPosiciones || !guardado?.sinGuardar}
              onClick={pulsarGuardar}
              size="sm"
              variant="primary"
            >
              Guardar
            </Button>
            {/* DIS-18: dentro están las tres formas de empezar, y el diálogo se titula así. Con la propuesta vacía no
                hace falta: las tres ya están a la vista. */}
            {hayPosiciones ? (
              <Button onClick={() => setImportando(true)} size="sm" variant="secondary">
                Importar
              </Button>
            ) : null}
            <MenuButton
              label="Más"
              actions={[
                {
                  id: "guardar-como",
                  label: "Guardar como…",
                  description: "Guarda otra propuesta, con otro nombre; la abierta no cambia",
                  disabled: !hayPosiciones || Boolean(guardado?.guardando),
                  onSelect: () => {
                    setErrorDeNombre(null);
                    setDialogoDeNombre("como");
                  }
                },
                {
                  id: "nueva",
                  label: "Nueva propuesta",
                  /* Deja Diseño para empezar otra. Las guardadas no se tocan, y si hay cambios sin guardar, el marco
                     pregunta antes. */
                  description: "Sin posiciones, capital ni nombre. No elimina ninguna propuesta guardada",
                  disabled: !hayPosiciones && !portfolioName && capitalIlustrativo && !guardado?.abierta,
                  danger: true,
                  onSelect: onReset
                },
                {
                  id: "costes",
                  label: "Ver los costes",
                  // Auditoría 11-08: en modo cliente no se menciona la retrocesión.
                  description: clientMode ? "Coste corriente de cada posición y de la cartera" : "Coste corriente, retrocesión y coste de la cartera",
                  disabled: !hayPosiciones,
                  onSelect: () => setShowCosts(true)
                },
                {
                  id: "alternativas",
                  label: "Buscar alternativas",
                  description: "Sustituir una posición por un equivalente",
                  disabled: !hayPosiciones,
                  onSelect: () => setSwapState({ open: true })
                },
                {
                  id: "csv",
                  label: "Descargar en CSV",
                  description: "Posiciones, pesos e importes, para una hoja de cálculo",
                  disabled: !hayPosiciones,
                  onSelect: exportCsv
                }
              ]}
            />
          </>
        }
      />

      {/* La respuesta de esta pantalla son los datos de la propuesta: lo que se edita a la izquierda y lo que no a la
          derecha, a la vista en los cuatro pasos. La pieza `Respuesta` es solo para cifras: la banda usa su aspecto. */}
      <section aria-label="Datos de la propuesta" className="respuesta diseno-datos">
        <div className="diseno-datos__campos">
          <Campo rotulo="Nombre">
            <input
              aria-label="Nombre de la propuesta"
              maxLength={80}
              onChange={(event) => onPortfolioNameChange?.(event.target.value)}
              placeholder="Cliente · propuesta"
              type="text"
              value={portfolioName}
            />
          </Campo>
          {/* Revisión 12-08: campo de importe europeo — acepta «250.000», formatea al salir y confirma al salir o con
              Intro. */}
          <Campo pista={capitalIlustrativo ? "En euros · sin fijar" : "En euros"} rotulo="Capital">
            <EuroAmountInput
              ariaLabel="Capital total en euros"
              confirmarLaMismaCifra={capitalIlustrativo}
              onCommit={handleCapitalChange}
              value={totalCapital}
            />
          </Campo>
          {onPerfilYHorizonteChange ? (
            <PerfilYHorizonteDeLaCartera valor={perfilYHorizonte ?? {}} onChange={onPerfilYHorizonteChange} />
          ) : null}
        </div>
        <div className="diseno-datos__cifras">
          <div className="respuesta__dato">
            <p className="respuesta__rotulo">Posiciones</p>
            <p className="respuesta__cifra">
              <Cifra tipo="numero" valor={positions.length} />
            </p>
            <p className="respuesta__apunte">{capitalIlustrativo ? "capital sin fijar" : importeTitular(totalCapital)}</p>
          </div>
          <div className={descuadrada ? "respuesta__dato diseno-datos__suma--descuadre" : "respuesta__dato"}>
            <p className="respuesta__rotulo">Suma de pesos</p>
            <p className="respuesta__cifra">
              <Cifra tipo="peso" valor={weightSum / 100} />
            </p>
            <p className="respuesta__apunte portfolio-edelta">
              {!hayPosiciones ? "Sin posiciones todavía" : balanced ? "Cartera cuadrada" : textoDeDescuadre()}
            </p>
            {/* En Componer, «Normalizar» vive al pie de la tabla, siempre a la vista (D1): aquí sale en los otros pasos. */}
            {descuadrada && step !== "compose" ? (
              <Button className="diseno-datos__normalizar" onClick={normalize} size="sm" variant="secondary">
                {libresACero ? "Repartir a partes iguales" : "Normalizar al 100 %"}
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      {capitalIlustrativo && hayPosiciones ? (
        <div className="diseno-datos__nota" data-testid="capital-ilustrativo">
          <Aviso
            accion={
              <Button onClick={() => handleCapitalChange(totalCapital)} size="sm" variant="secondary">
                Usar {importeTitular(totalCapital)} como capital real
              </Button>
            }
            titulo="Capital sin fijar."
          >
            Los {importeTitular(totalCapital)} son de ejemplo y no salen en el informe de cliente ni en el de costes. Escribe el capital real o usa esta cifra.
          </Aviso>
        </div>
      ) : null}

      {avisoDeImportacion ? (
        <Aviso
          accion={
            <Button onClick={() => setImportando(true)} size="sm" variant="secondary">
              Revisar la importación
            </Button>
          }
          anunciar
        >
          Hay una importación sin confirmar: sus posiciones aún no se han cargado.
        </Aviso>
      ) : portfolioNotice && !importando ? (
        <div className="portfolio-notice" role="status">{portfolioNotice}</div>
      ) : null}

      {/* Con la propuesta vacía, empezar es el trabajo y se queda a la vista: un solo estado vacío (DIS-18). */}
      {!hayPosiciones ? (
        <Panel
          subtitulo={onGenerarBorrador ? "Añade activos desde el Buscador, importa tus posiciones o genera un borrador." : "Importa tus posiciones o añádelas desde el Buscador."}
          titulo="Empieza tu propuesta"
          tituloId="portfolio-start-title"
        >
          {arranque}
        </Panel>
      ) : null}

      <SegmentedTabs
        tabs={BUILDER_STEPS.map((item) => ({ ...item, disabled: item.id !== "compose" && !hayPosiciones }))}
        value={step}
        onChange={setStep}
        label="Pasos de la propuesta"
        idPrefix="builder-step"
        className="builder-steps"
      />

      <PanelDePestana className="builder-workspace-panel diseno-paso" idPrefix="builder-step" pestana={step}>
        {step === "compose" ? (
          <>
            {fixedOverflow ? (
              <Aviso anunciar titulo="Las posiciones fijas no caben.">
                Las posiciones fijas (candados e importes fijos) suman {oFalta(escribirPeso(fixedWeightSum / 100))}: más del
                100 %, así que no queda peso para las demás y la cartera no puede cuadrar. {sentence(reduceFixedAdvice)}.
              </Aviso>
            ) : null}
            {weightNotice ? (
              /* Ocre, como el aviso del importe de la tabla: dice por qué un peso no ha quedado como se pidió. */
              <div data-testid="aviso-peso">
                <Aviso anunciar tono="aviso">
                  {weightNotice}
                </Aviso>
              </div>
            ) : null}
            {quitada ? (
              <Aviso
                accion={
                  <Button onClick={deshacerQuitar} size="sm" variant="secondary">
                    Deshacer
                  </Button>
                }
                anunciar
                tono="nota"
              >
                Se ha quitado «{quitada.nombre}».
              </Aviso>
            ) : null}
            {hayPosiciones ? (
              <div className="grid builder-compose">
                <div className="col-8 builder-compose__main">
                  <PortfolioPositionsTable
                    acciones={herramientas}
                    assets={assets}
                    locks={locks}
                    onEuroChange={(assetId, euros) => void handleEuroChange(assetId, euros)}
                    onRemove={quitarPosicion}
                    onToggleLock={toggleLock}
                    onReleaseFixedAmount={onPositionPatch ? releaseFixedAmount : undefined}
                    onWeightChange={handleTableWeightChange}
                    onSwapRequest={(assetId) => setSwapState({ open: true, assetId })}
                    positions={positions}
                    totalCapital={totalCapital}
                    capitalSinFijar={capitalIlustrativo}
                    aviso={avisoDeImporte}
                    cargandoFichas={cargandoFichas}
                    normalizar={{
                      alPulsar: normalize,
                      cuadrada: balanced,
                      rotulo: libresACero ? "Repartir a partes iguales" : "Normalizar al 100 %"
                    }}
                  />
                </div>
                <aside className="col-4 builder-compose__side" aria-label="Reparto, riesgo y estado de la propuesta">
                  <PortfolioSummary
                    summary={summary}
                    variant="side"
                    totalCapital={totalCapital}
                    capitalSinFijar={capitalIlustrativo}
                    fueraDelReparto={repartoDeLaCartera(summary).fuera}
                  />
                  <RegionAllocation positions={positions} assets={assets} variant="side" />
                  {/* La frontera compacta y, debajo, las cuatro cifras del periodo común (la frontera volvió a Componer el 14-11-2026). */}
                  <PortfolioHorizonPanel assets={assets} onVerAnalisis={onVerAnalisis} positions={positions} variant="metricas" />
                  <PortfolioStatusPanel
                    summary={summary}
                    positions={positions}
                    assets={assets}
                    riskProfilePreview={riskProfilePreview}
                    feasibility={feasibility}
                    onVerComprobar={() => irAlPaso("check")}
                  />
                </aside>
              </div>
            ) : null}
          </>
        ) : null}

        {step === "check" ? (
          <>
            {/* Primero lo que impide proponerla y lo que pide atención; después, cada comprobación en su bloque. */}
            <QueHayQueRevisar
              summary={summary}
              positions={positions}
              assets={assets}
              riskProfilePreview={riskProfilePreview}
              feasibility={feasibility}
            />
            <PortfolioValidationPanel
              assets={assets}
              optimizationAssetCount={optimizationPreview?.assets.length ?? 0}
              positions={positions}
              summary={summary}
            />
            {/* Decisión 59: el nivel y el horizonte guardados con la cartera, frente a lo que declara cada fabricante. */}
            <AvisosDelMercadoObjetivo assets={assets} perfilYHorizonte={perfilYHorizonte ?? {}} positions={positions} />
            <PortfolioConstraintsPanel feasibility={feasibility} perfilElegido={selectedRiskProfile?.risk_profile_label} />
            <RiskProfilePreviewPanel
              onProfileChange={onRiskProfileChange}
              preview={riskProfilePreview}
              riskProfiles={riskProfiles}
              selectedProfileId={selectedRiskProfileId}
            />
            <SuperSectorsDonut positions={positions} assets={assets} />
            <PortfolioAnalysisPanel positions={positions} summary={summary} assets={assets} />
          </>
        ) : null}

        {step === "optimize" ? (
          <>
            {/* Primero lo que se viene a hacer aquí; la comprobación previa, que no es el cálculo, al final y plegada.
                Ola 1 (E2): una sola puerta de optimización — el OptimizerPanel. Aquí sale la frontera del periodo común
                hasta que se optimiza, y después la del cálculo. */}
            <OptimizerPanel
              assets={assets}
              capital={capitalFijado}
              feasibility={feasibility}
              frontierPrevia={<PortfolioHorizonPanel assets={assets} onVerAnalisis={onVerAnalisis} positions={positions} variant="frontera" />}
              lockedWeights={lockedWeights}
              onApplyWeights={applyOptimizedWeights}
              // Auditoría 11-08 (F1.4): tras aplicar, el siguiente paso → informes por la vía existente, con el mismo
              // capital y los candados de la cartera.
              onOpenReport={() => onOpenReport(lockedWeights)}
              onVerAnalisis={onVerAnalisis}
              positions={positions}
            />
            {optimizationComparison ? (
              <CambiosAplicados
                capital={capitalFijado}
                comparacion={optimizationComparison}
                carteraCambiada={haCambiadoDespues}
                onVolverALosPesosAnteriores={onRestorePositions ? () => void volverALosPesosAnteriores() : undefined}
              />
            ) : null}
            {onBuildImprovementCandidates && onApplyImprovement ? (
              <PortfolioImprovementPanel
                assets={assets}
                capital={capitalFijado}
                positions={positions}
                lockedWeights={lockedWeights}
                portfolioName={portfolioName}
                onBuildCandidates={onBuildImprovementCandidates}
                onApplyProposal={(next) => {
                  /* Como una optimización: Antes/después enseña qué cambió y se puede volver atrás. */
                  setComparisonBaseline({ before: positions.map((position) => ({ ...position })), aplicada: next.map((position) => ({ ...position })), source: "Fondos equivalentes" });
                  onApplyImprovement(next);
                }}
                // ALTA-10 (auditoría 16-10-2026): como el guardado normal, sin
                // capital fijado no viajan los 100.000 € ilustrativos (F-04).
                onSaveProposal={(name, proposedPositions, proposedAssets) =>
                  onSaveLocalPortfolio(name, proposedPositions, proposedAssets, capitalIlustrativo ? undefined : totalCapital)}
              />
            ) : null}
            <OptimizationPreviewPanel assets={assets} plegable positions={positions} preview={localOptimizationPreview} />
          </>
        ) : null}

        {step === "simulate" ? (
          <>
            {/* Mide, con la frontera eficiente (volvió el 14-11-2026), y sin edición de pesos («Repartir por clase» está en Componer). */}
            <PortfolioHorizonPanel assets={assets} onVerAnalisis={onVerAnalisis} positions={positions} />
            {/* Ola 1 (E2): la comparativa no aplica pesos; se optimiza en el paso Optimizar. */}
            <BacktestComparison assets={assets} positions={positions} />
          </>
        ) : null}

        {/* Hallazgo 121: el recorrido se llevaba en la cabeza. Cada paso dice cuál es el siguiente. */}
        {hayPosiciones ? (
          <nav className="diseno-siguiente" aria-label="Siguiente paso">
            {step === "simulate" || !siguientePaso ? (
              <>
                {onVerAnalisis ? <Button onClick={onVerAnalisis} variant="secondary">Ver el análisis</Button> : null}
                <Button onClick={() => onOpenReport()} variant="secondary">Preparar los informes</Button>
              </>
            ) : (
              <Button onClick={() => irAlPaso(siguientePaso.id)} variant="secondary">
                Siguiente: {siguientePaso.label} →
              </Button>
            )}
          </nav>
        ) : null}
      </PanelDePestana>
      {showCosts ? (
        <CostsModal
          assets={assets}
          positions={positions}
          totalCapital={capitalFijado}
          onClose={() => setShowCosts(false)}
        />
      ) : null}
      {swapState?.open ? (
        <FundSwapModal
          assets={assets}
          positions={positions}
          totalCapital={totalCapital}
          initialSelectedAssetId={swapState.assetId}
          onFindAlternatives={onFindAlternatives}
          onSwap={(oldId, newId, newLabel, options) => void handleSwap(oldId, newId, newLabel, options)}
          onClose={() => setSwapState(null)}
        />
      ) : null}
      {herramienta === "aportar" && hayPosiciones ? (
        <ModalDialog labelledBy="diseno-aportar-title" onClose={cerrarHerramienta} size="md">
          <DialogHeader onClose={cerrarHerramienta} title="Añadir dinero" titleId="diseno-aportar-title" />
          <DialogBody>
            <CapitalContributionPanel
              enDialogo
              positions={positions}
              totalCapital={totalCapital}
              capitalSinFijar={capitalIlustrativo}
              locks={locks}
              onApply={handleContribution}
            />
          </DialogBody>
        </ModalDialog>
      ) : null}
      {herramienta === "repartir" && hayPosiciones ? (
        <ModalDialog labelledBy="diseno-repartir-title" onClose={cerrarHerramienta} size="md">
          <DialogHeader onClose={cerrarHerramienta} title="Repartir por clase" titleId="diseno-repartir-title" />
          <DialogBody>
            <MacroAllocationPanel assets={assets} enDialogo positions={positions} locks={locks} onWeightChange={aplicarPesoNuevo} />
          </DialogBody>
        </ModalDialog>
      ) : null}
      {importando && hayPosiciones ? (
        <ModalDialog labelledBy="importar-cartera-title" onClose={() => setImportando(false)} size="lg">
          <DialogHeader onClose={() => setImportando(false)} title="Empezar o importar" titleId="importar-cartera-title" />
          <DialogBody>
            <p className="field__hint">Lo que cargues sustituye a la propuesta que hay en Diseño. El nombre y el capital se vacían, salvo el capital que traiga el fichero. Si tiene cambios sin guardar, se pregunta antes.</p>
            {arranque}
          </DialogBody>
        </ModalDialog>
      ) : null}
      {confirmDialog}
      {dialogoDeNombre ? (
        <GuardarCarteraDialog
          error={errorDeNombre}
          guardando={Boolean(guardado?.guardando)}
          nombre={portfolioName}
          nombresGuardados={savedPortfolios.map((portfolio) => portfolio.name)}
          onCancelar={() => setDialogoDeNombre(null)}
          onGuardar={(nombre) => void guardarConNombre(nombre)}
          titulo={dialogoDeNombre === "como" ? "Guardar como…" : "Guardar la propuesta"}
        />
      ) : null}
    </article>
  );
}
