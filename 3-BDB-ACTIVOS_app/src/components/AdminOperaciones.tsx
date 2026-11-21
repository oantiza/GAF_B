import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Aviso } from "./ui/Aviso";
import { Campo } from "./ui/Campo";
import { Button } from "./ui/Button";
import { KpiStrip } from "./ui/KpiStrip";
import { DialogBody, DialogFooter, DialogHeader, ModalDialog } from "./ui/ModalDialog";
import { useConfirm } from "./ui/useConfirm";
import { AsyncErrorBanner } from "./AsyncErrorBanner";
import {
  OPS_MODOS,
  OPS_TIPOS,
  OPS_UNAVAILABLE_MESSAGE,
  lastOpsTaskId,
  waitForOpsTarea,
  type OpsTareaListener,
  deleteOpsCorreccion,
  getOpsCorrecciones,
  getOpsEstado,
  reclasificaOpsActivo,
  runOpsAlta,
  runOpsArchivar,
  runOpsArchivarSeco,
  runOpsAuditar,
  runOpsBackup,
  runOpsCanonico,
  runOpsEscribir,
  runOpsExtraer,
  runOpsPasadaEnSeco,
  runOpsReclasificar,
  runOpsReclasificarSeco,
  saveOpsCorreccion
} from "../adapters/opsLocalBackend";
import { OPS_LOCAL_URL } from "../config/runtimeConfig";
import { toAppError } from "../core/appError";
import { fecha, fechaYHora, numero, oFalta } from "../core/formato";
import { textoDeAusencia } from "../core/textoDeAusencia";
import { TYPE_LABELS } from "../core/labels";
import {
  OPS_MODO_LABELS,
  OPS_SITUACION_LABELS,
  describeOpsError,
  documentosLabel,
  extractIsins,
  formatCorrectionValue,
  fuenteLabel,
  horasLabel,
  interpretCorrectionValue,
  planActionLabel,
  planActionWrites,
  reclasificacionCambios,
  suggestModo,
  tipoLabel
} from "../core/opsLocal";
import type {
  OpsAltaFila,
  OpsArchivarResultado,
  OpsArchivo,
  OpsAuditoria,
  OpsCanonicoResultado,
  OpsCorreccionesActivo,
  OpsEscrituraResultado,
  OpsEstado,
  OpsFichaResumen,
  OpsModoPlataforma,
  OpsPasadaEnSeco,
  OpsReclasificacion,
  OpsTarea,
  OpsTipoActivo
} from "../types/opsLocal";
import { Panel } from "./ui/Panel";

/* PLA-12: fechas y recuentos con el formato común de la aplicación («13/11/2026», «13/11/2026 10:30», «1.097»), y lo
   que no llega se dice con su palabra: nunca una raya ni «N/D», que se leen como un dato. */
const FALTA = textoDeAusencia("falta");
const diaDe = (iso?: string | null) => (iso ? (fecha(iso) ?? iso) : FALTA);
const momentoDe = (iso?: string | null) => (iso ? (fechaYHora(iso) ?? iso) : FALTA);

type Paso =
  | "alta"
  | "extraer"
  | "canonico"
  | "backup"
  | "seco"
  | "escribir"
  | "auditar"
  | "archivar_seco"
  | "archivar"
  | "reclasificar_seco"
  | "reclasificar"
  | "seguimiento";

const PASO_LABELS: Record<Paso, string> = {
  seguimiento: "Seguimiento de la tarea",
  alta: "Alta en el universo",
  extraer: "Extracción",
  canonico: "Canónico",
  backup: "Copia de la maestra",
  seco: "Pasada en seco",
  escribir: "Escritura en la maestra",
  auditar: "Comprobación",
  archivar_seco: "Archivo: pasada en seco",
  archivar: "Archivo en la maestra",
  reclasificar_seco: "Reclasificación: pasada en seco",
  reclasificar: "Reclasificación en la maestra"
};

const MAX_LOG_LINES = 400;
const MAX_LISTED = 6;

interface CorreccionForm {
  ruta: string;
  valor: string;
  motivo: string;
  nueva: boolean;
}

const FORM_VACIO: CorreccionForm = { ruta: "", valor: "", motivo: "", nueva: false };

function listSome(values: string[]): string {
  if (values.length <= MAX_LISTED) return values.join(", ");
  return `${values.slice(0, MAX_LISTED).join(", ")} y ${values.length - MAX_LISTED} más`;
}

function errorMessage(error: unknown): string {
  return toAppError(error).message;
}

function shortId(value: string | null | undefined): string {
  return value ? value.slice(0, 12) : FALTA;
}

/** Errores de la plataforma en español, con el texto original plegado como detalle técnico. */
function OpsErrores({ errores }: { errores: unknown[] }) {
  if (errores.length === 0) return null;
  return (
    <ul className="admin-mini-list">
      {errores.slice(0, MAX_LISTED).map((error, i) => {
        const e = describeOpsError(error);
        return (
          <li key={i}>
            {e.donde ? <span className="ops-isin">{e.donde}</span> : null}
            {e.donde ? " " : null}
            {e.mensaje}
            {e.detalle ? (
              <details className="async-error-banner__detail">
                <summary>Detalle técnico</summary>
                <code>{e.detalle}</code>
              </details>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Registro en vivo de la tarea en curso (o de la última), con progreso. */
function TareaLog({ tarea, paso }: { tarea: OpsTarea | null; paso: Paso | null }) {
  const preRef = useRef<HTMLPreElement>(null);
  const lines = tarea?.log ?? [];
  useEffect(() => {
    const el = preRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  if (!tarea) return null;
  const progreso = tarea.progreso;
  const avance = progreso.total ? `${progreso.actual ?? 0}/${progreso.total}` : null;
  return (
    <div className="ops-log" aria-live="polite">
      <div className="ops-log__head">
        <span className="ops-log__title">
          {paso ? PASO_LABELS[paso] : tarea.nombre}
          {tarea.estado === "en_curso" ? " · en curso" : tarea.estado === "hecha" ? " · terminada" : " · con error"}
        </span>
        <span className="ops-log__meta">
          {avance ? `${avance}${progreso.isin ? ` · ${progreso.isin}` : ""} · ` : ""}
          {`${oFalta(numero(tarea.segundos))}\u00a0s`}
        </span>
      </div>
      <pre ref={preRef} className="code-block ops-log__body">{lines.slice(-MAX_LOG_LINES).join("\n") || "Esperando al servicio…"}</pre>
    </div>
  );
}

function EstadoStrip({ estado }: { estado: OpsEstado }) {
  const plataforma = estado.plataforma;
  const copia = plataforma.ultimo_backup;
  const plataformaLista = plataforma.existe && plataforma.scripts_ok && plataforma.node_modules && plataforma.npm && plataforma.credenciales;
  return (
    <KpiStrip
      ariaLabel="Estado del extractor y de la plataforma"
      items={[
        { label: "Universo", value: estado.universo.total },
        { label: "Fichas extraídas", value: estado.fichas },
        { label: "Canónicos", value: estado.canonicos.ok ?? 0 },
        { label: "Paquete", value: estado.paquete_coherente ? "Coherente" : "Incoherente" },
        { label: "Copia de la maestra", value: copia ? (copia.vigente ? horasLabel(copia.edad_horas) : "Caducada") : "Sin copia" },
        { label: "Plataforma", value: plataformaLista ? "Lista" : "No disponible" }
      ]}
    />
  );
}

interface AdminOperacionesProps {
  /** Las acciones se dan de alta por la ingesta EODHD: la pestaña Ingesta. */
  onOpenIngesta?: () => void;
}

export function AdminOperaciones({ onOpenIngesta }: AdminOperacionesProps) {
  const observation = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const [resumeId, setResumeId] = useState(() => lastOpsTaskId() ?? "");
  const [estado, setEstado] = useState<OpsEstado | null>(null);
  const [estadoError, setEstadoError] = useState<unknown>(null);
  const [estadoLoading, setEstadoLoading] = useState(true);

  const [isinText, setIsinText] = useState("");
  const [tipoForzado, setTipoForzado] = useState<OpsTipoActivo | "">("");
  const [force, setForce] = useState(false);
  const [modo, setModo] = useState<OpsModoPlataforma>("alta");
  const [modoManual, setModoManual] = useState(false);

  const [pasoActivo, setPasoActivo] = useState<Paso | null>(null);
  const [tarea, setTarea] = useState<OpsTarea | null>(null);
  const [pasoError, setPasoError] = useState<{ paso: Paso; mensaje: string } | null>(null);

  const [altaFilas, setAltaFilas] = useState<OpsAltaFila[] | null>(null);
  const [fichas, setFichas] = useState<OpsFichaResumen[] | null>(null);
  const [canonico, setCanonico] = useState<OpsCanonicoResultado | null>(null);
  const [seco, setSeco] = useState<OpsPasadaEnSeco | null>(null);
  const [escritura, setEscritura] = useState<OpsEscrituraResultado | null>(null);
  const [auditoria, setAuditoria] = useState<OpsAuditoria | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmCount, setConfirmCount] = useState("");

  const [archivoText, setArchivoText] = useState("");
  const [archivoMotivo, setArchivoMotivo] = useState("");
  const [archivoSeco, setArchivoSeco] = useState<OpsArchivo | null>(null);
  const [archivado, setArchivado] = useState<OpsArchivarResultado | null>(null);
  const [confirmArchivoOpen, setConfirmArchivoOpen] = useState(false);
  const [confirmArchivoCount, setConfirmArchivoCount] = useState("");

  /* ALTA-13: cambiar el tipo en el universo no llega a la maestra; la
     reclasificación allí tiene su propio paso con pasada en seco y recuento. */
  const [reclasText, setReclasText] = useState("");
  const [reclasSeco, setReclasSeco] = useState<OpsReclasificacion | null>(null);
  const [reclasificado, setReclasificado] = useState<OpsReclasificacion | null>(null);
  const [reclasPendientes, setReclasPendientes] = useState<string[]>([]);
  const [reclasPreparar, setReclasPreparar] = useState(true);
  const [confirmReclasOpen, setConfirmReclasOpen] = useState(false);
  const [confirmReclasCount, setConfirmReclasCount] = useState("");

  const [correccionIsin, setCorreccionIsin] = useState("");
  const [correcciones, setCorrecciones] = useState<OpsCorreccionesActivo | null>(null);
  const [correccionesError, setCorreccionesError] = useState<string | null>(null);
  const [correccionesBusy, setCorreccionesBusy] = useState(false);
  const [form, setForm] = useState<CorreccionForm>(FORM_VACIO);
  const [correccionMensaje, setCorreccionMensaje] = useState<string | null>(null);
  /* El ISIN cuyo tipo se está cambiando en el universo: mientras, no se lanza otro (PLA-10). */
  const [reclasificando, setReclasificando] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const isins = useMemo(() => extractIsins(isinText), [isinText]);
  const acciones = useMemo(
    () => new Set((altaFilas ?? []).filter((f) => f.tipo === "accion").map((f) => f.isin)),
    [altaFilas]
  );
  const invalidos = useMemo(() => new Set((altaFilas ?? []).filter((f) => f.situacion === "invalido").map((f) => f.isin)), [altaFilas]);
  /** Lo que sigue el proceso del extractor: ni acciones (van por Ingesta) ni ISIN no válidos. */
  const operables = useMemo(() => isins.filter((i) => !acciones.has(i) && !invalidos.has(i)), [isins, acciones, invalidos]);

  const busy = pasoActivo !== null;
  const otraTarea = estado?.tarea_en_curso ?? (tarea?.estado === "en_curso" ? tarea : null);
  const copia = estado?.plataforma.ultimo_backup ?? null;
  const copiaVigente = copia?.vigente === true;
  const plataformaLista = Boolean(
    estado && estado.plataforma.existe && estado.plataforma.scripts_ok && estado.plataforma.node_modules && estado.plataforma.npm
  );
  const escriturasPrevistas = seco?.escrituras ?? 0;
  const secoVigente = seco !== null && seco.modo === modo && seco.isins.join(",") === operables.join(",");
  /* U-10: una sola acción primaria por contexto. El paso que toca ahora lleva
     el botón primario; los demás pasos quedan en secundario. */
  const pasoSugerido: 1 | 2 | 3 | 4 | 5 =
    altaFilas === null ? 1 : fichas === null ? 2 : canonico === null ? 3 : !secoVigente ? 4 : 5;
  const variantePaso = (paso: 1 | 2 | 3 | 4 | 5): "primary" | "secondary" => (pasoSugerido === paso ? "primary" : "secondary");

  const archivoIsins = useMemo(() => extractIsins(archivoText), [archivoText]);
  const archivoSecoVigente = archivoSeco !== null && archivoSeco.isins.join(",") === archivoIsins.join(",");
  const archivables = archivoSecoVigente ? archivoSeco.archivables : 0;

  const reclasIsins = useMemo(() => extractIsins(reclasText), [reclasText]);
  const reclasSecoVigente = reclasSeco !== null && reclasSeco.isins.join(",") === reclasIsins.join(",");
  const reclasificables = reclasSecoVigente ? reclasSeco.reclasificables : 0;

  const loadEstado = useCallback(async () => {
    setEstadoLoading(true);
    try {
      const e = await getOpsEstado();
      if (!mounted.current) return;
      setEstado(e);
      setEstadoError(null);
    } catch (error) {
      if (!mounted.current) return;
      setEstado(null);
      setEstadoError(error);
    } finally {
      if (mounted.current) setEstadoLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const timeoutId = window.setTimeout(() => void loadEstado(), 0);
    return () => {
      mounted.current = false;
      observation.current?.abort();
      window.clearTimeout(timeoutId);
    };
  }, [loadEstado]);

  // El texto cambió: lo hecho para otros ISIN deja de valer.
  const resetDesde = (paso: Paso) => {
    const orden: Paso[] = ["alta", "extraer", "canonico", "backup", "seco", "escribir", "auditar"];
    const desde = orden.indexOf(paso);
    if (desde <= orden.indexOf("alta")) setAltaFilas(null);
    if (desde <= orden.indexOf("extraer")) setFichas(null);
    if (desde <= orden.indexOf("canonico")) setCanonico(null);
    if (desde <= orden.indexOf("seco")) setSeco(null);
    if (desde <= orden.indexOf("escribir")) setEscritura(null);
    if (desde <= orden.indexOf("auditar")) setAuditoria(null);
  };

  async function ejecuta<T>(paso: Paso, fn: (onUpdate: OpsTareaListener) => Promise<T>, onDone: (result: T) => void) {
    if (observation.current) return;
    const controller = new AbortController();
    observation.current = controller;
    const onUpdate: OpsTareaListener = Object.assign((next: OpsTarea) => {
      if (mounted.current && !controller.signal.aborted) {
        setTarea(next);
        setResumeId(next.id);
      }
    }, { signal: controller.signal });
    setPasoActivo(paso);
    setPasoError(null);
    setTarea(null);
    try {
      const result = await fn(onUpdate);
      if (mounted.current && !controller.signal.aborted) onDone(result);
    } catch (error) {
      if (mounted.current) setPasoError({ paso, mensaje: errorMessage(error) });
    } finally {
      observation.current = null;
      if (mounted.current) {
        setPasoActivo(null);
        void loadEstado();
      }
    }
  }

  const reanudar = (id: string) => ejecuta("seguimiento", async (onUpdate) => {
    const result = await waitForOpsTarea(id, onUpdate);
    if (result.estado === "error") throw new Error(result.error ?? "La tarea terminó con error.");
    return result;
  }, setTarea);

  const darDeAlta = () =>
    ejecuta("alta", (onUpdate) => runOpsAlta(isins, tipoForzado, onUpdate), (filas) => {
      resetDesde("extraer");
      setAltaFilas(filas);
      if (!modoManual) setModo(suggestModo(filas.map((f) => f.situacion)));
    });

  const extraer = () =>
    ejecuta("extraer", (onUpdate) => runOpsExtraer(operables, { force }, onUpdate), (result) => {
      resetDesde("canonico");
      setFichas(result);
    });

  const generarCanonico = () =>
    ejecuta("canonico", (onUpdate) => runOpsCanonico(operables, onUpdate), (result) => {
      resetDesde("seco");
      setCanonico(result);
    });

  const hacerCopia = () => ejecuta("backup", (onUpdate) => runOpsBackup(onUpdate), () => undefined);

  const pasadaEnSeco = () =>
    ejecuta("seco", (onUpdate) => runOpsPasadaEnSeco(operables, modo, onUpdate), (result) => {
      resetDesde("escribir");
      setSeco(result);
    });

  const escribir = () => {
    setConfirmOpen(false);
    return ejecuta("escribir", (onUpdate) => runOpsEscribir(operables, modo, escriturasPrevistas, onUpdate), (result) => {
      setEscritura(result);
      setAuditoria(result.auditoria);
    });
  };

  const auditar = () => ejecuta("auditar", (onUpdate) => runOpsAuditar(operables, onUpdate), setAuditoria);

  const archivarSeco = () =>
    ejecuta("archivar_seco", (onUpdate) => runOpsArchivarSeco(archivoIsins, archivoMotivo, onUpdate), (result) => {
      setArchivado(null);
      setArchivoSeco(result);
    });

  const archivar = () => {
    setConfirmArchivoOpen(false);
    return ejecuta("archivar", (onUpdate) => runOpsArchivar(archivoIsins, archivables, archivoMotivo, onUpdate), (result) => {
      setArchivado(result);
      setArchivoSeco(null);
      // Lo archivado ya no está en el universo: tampoco debe seguir en el proceso de carga.
      const fuera = new Set((result.baja ?? []).filter((b) => b.estaba).map((b) => b.isin));
      if (fuera.size > 0) {
        setIsinText((current) => extractIsins(current).filter((i) => !fuera.has(i)).join("\n"));
        resetDesde("alta");
      }
    });
  };

  /* Cambiar el tipo escribe en el universo del extractor y reinicia los pasos: se confirma antes, y no se lanzan dos a
     la vez. Antes cada `change` del desplegable escribía, y con las flechas del teclado eran varias escrituras (PLA-10). */
  const reclasificar = async (isin: string, tipo: OpsTipoActivo) => {
    if (reclasificando) return;
    const actual = altaFilas?.find((f) => f.isin === isin)?.tipo;
    const seguro = await confirm({
      title: `¿Cambiar el tipo de ${isin} a ${tipoLabel(tipo)}?`,
      message: `Se cambia en el universo del extractor${actual ? ` (ahora es ${tipoLabel(actual as OpsTipoActivo)})` : ""}, y los pasos ya hechos para estos activos hay que repetirlos desde la extracción.`,
      confirmLabel: "Cambiar el producto"
    });
    if (!seguro) return;
    setReclasificando(isin);
    setPasoError(null);
    try {
      const r = await reclasificaOpsActivo(isin, tipo);
      setAltaFilas((current) => (current ?? []).map((f) => (f.isin === isin ? { ...f, tipo: r.tipo } : f)));
      resetDesde("extraer");
      // Pasa a acción: si la maestra lo tiene como fondo, hay que reclasificarlo allí (paso 8).
      setReclasPendientes((current) => (r.siguiente ? [...new Set([...current, isin])] : current.filter((i) => i !== isin)));
      if (r.siguiente) {
        setReclasText((current) => (extractIsins(current).includes(isin) ? current : `${current}${current.trim() ? "\n" : ""}${isin}`));
        setReclasSeco(null);
      }
    } catch (error) {
      setPasoError({ paso: "alta", mensaje: errorMessage(error) });
    } finally {
      setReclasificando(null);
    }
  };

  const reclasificarSeco = () =>
    ejecuta("reclasificar_seco", (onUpdate) => runOpsReclasificarSeco(reclasIsins, reclasPreparar, onUpdate), (result) => {
      setReclasificado(null);
      setReclasSeco(result);
    });

  const reclasificarEnMaestra = () => {
    setConfirmReclasOpen(false);
    return ejecuta("reclasificar", (onUpdate) => runOpsReclasificar(reclasIsins, reclasificables, onUpdate), (result) => {
      setReclasificado(result);
      setReclasSeco(null);
      const hechos = new Set(result.filas.filter((f) => f.postverify?.ok).map((f) => f.isin));
      setReclasPendientes((current) => current.filter((i) => !hechos.has(i)));
    });
  };

  // ------------------------------------------------------------ correcciones
  const cargarCorrecciones = async (isin: string) => {
    const limpio = isin.trim().toUpperCase();
    setCorreccionesBusy(true);
    setCorreccionesError(null);
    try {
      setCorrecciones(await getOpsCorrecciones(limpio));
    } catch (error) {
      setCorrecciones(null);
      setCorreccionesError(errorMessage(error));
    } finally {
      setCorreccionesBusy(false);
    }
  };

  const guardarCorreccion = async () => {
    if (!correcciones) return;
    setCorreccionesBusy(true);
    setCorreccionesError(null);
    try {
      const r = await saveOpsCorreccion({
        isin: correcciones.isin,
        ruta: form.ruta.trim(),
        valor: interpretCorrectionValue(form.valor),
        motivo: form.motivo.trim(),
        nueva: form.nueva
      });
      setCorreccionMensaje(
        `Corrección guardada: ${r.correccion.ruta} = ${formatCorrectionValue(r.correccion.valor)} (la fuente trae ${formatCorrectionValue(r.valor_actual)}). ` +
          "Para que llegue a la ficha y a la maestra: extraer, canónico, pasada en seco (republicar) y escribir."
      );
      setForm(FORM_VACIO);
      if (!isins.includes(correcciones.isin)) {
        setIsinText((current) => `${current}${current.trim() ? "\n" : ""}${correcciones.isin}`);
        /* El ISIN nuevo no está extraído: lo hecho para los anteriores deja de valer, como al teclearlo (PLA-16). */
        resetDesde("extraer");
      }
      setModo("republish");
      setModoManual(true);
      await cargarCorrecciones(correcciones.isin);
    } catch (error) {
      setCorreccionesError(errorMessage(error));
      setCorreccionesBusy(false);
    }
  };

  const retirarCorreccion = async (ruta: string, motivo: string) => {
    if (!correcciones) return;
    /* Borra la corrección con su motivo: se pregunta antes, diciendo cuál (PLA-10). */
    const seguro = await confirm({
      title: `¿Retirar la corrección de ${ruta}?`,
      message: `Se borra la corrección manual de ${correcciones.isin}${motivo ? `, con su motivo («${motivo}»)` : ""}. En la siguiente extracción vuelve el dato de la fuente.`,
      confirmLabel: "Retirar",
      tone: "danger"
    });
    if (!seguro) return;
    setCorreccionesBusy(true);
    setCorreccionesError(null);
    try {
      await deleteOpsCorreccion(correcciones.isin, ruta);
      setCorreccionMensaje(`Corrección retirada: ${ruta}. En la siguiente extracción vuelve el dato de la fuente.`);
      await cargarCorrecciones(correcciones.isin);
    } catch (error) {
      setCorreccionesError(errorMessage(error));
      setCorreccionesBusy(false);
    }
  };

  // ------------------------------------------------------------------ vistas
  if (!estado && estadoError) {
    const appError = toAppError(estadoError);
    return (
      <div className="ops-admin">
        <div className="ops-empty" role="status">
          <p className="ops-empty__title">
            {appError.kind === "NETWORK" ? "El servicio local de operaciones no está en marcha" : "El servicio de operaciones no responde bien"}
          </p>
          <p>{appError.kind === "NETWORK" ? OPS_UNAVAILABLE_MESSAGE : appError.message}</p>
          <p className="ops-empty__hint">
            El servicio corre en esta misma máquina, en {OPS_LOCAL_URL}, y solo atiende a la app. Desde él se hacen el alta, la
            extracción, el canónico, las correcciones y la plataforma de datos (copia, pasada en seco, escritura y comprobación).
          </p>
          <div>
            <Button onClick={() => void loadEstado()} busy={estadoLoading} variant="primary">
              Reintentar
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ops-admin">
      <div className="admin-content-toolbar">
        <Button busy={estadoLoading} onClick={() => void loadEstado()} size="sm" variant="secondary">
          Actualizar estado
        </Button>
      </div>

      {estado ? <EstadoStrip estado={estado} /> : null}
      {estadoError && estado ? <AsyncErrorBanner error={estadoError} onRetry={() => void loadEstado()} /> : null}

      {otraTarea ? (
        <Aviso anunciar>
          Hay otra tarea en marcha en el servicio ({otraTarea.nombre}, {otraTarea.progreso.isin ?? "sin ISIN"}). Espera a que termine: el
          extractor no ejecuta dos a la vez.
        </Aviso>
      ) : null}

      {estado && !estado.paquete_coherente ? (
        <Aviso>
          El paquete del extractor no es coherente (export y export_bdb salen de instantáneas distintas). Regenera el canónico antes de la
          pasada en seco: la plataforma lo rechazaría.
        </Aviso>
      ) : null}

      {/* Paso 1 · activos ------------------------------------------------ */}
      <Panel
        subtitulo="Pega uno o varios ISIN. El alta resuelve nombre y producto y los añade al universo del extractor; lo que ya estaba se deja como está."
        titulo="1 · Activos"
      >
        <div className="ops-input-row">
          <Campo
            className="ops-isin-field"
            pista={`${isins.length} ISIN reconocidos${operables.length !== isins.length ? ` · ${operables.length} siguen el proceso` : ""}`}
            rotulo="ISIN"
          >
            <textarea
              value={isinText}
              rows={3}
              placeholder={"LU0113257694\nIE00B4L5Y983"}
              className="ops-isin-text"
              onChange={(event) => {
                setIsinText(event.target.value);
                resetDesde("alta");
              }}
            />
          </Campo>
          <Campo rotulo="Producto">
            <select value={tipoForzado} onChange={(event) => setTipoForzado(event.target.value as OpsTipoActivo | "")}>
              <option value="">Detectar</option>
              {OPS_TIPOS.map((t) => (
                <option key={t} value={t}>{tipoLabel(t)}</option>
              ))}
            </select>
          </Campo>
          <div className="ops-step-actions">
            <Button variant={variantePaso(1)} onClick={() => void darDeAlta()} disabled={busy || isins.length === 0 || Boolean(otraTarea)} busy={pasoActivo === "alta"}>
              Dar de alta
            </Button>
          </div>
        </div>

        {altaFilas ? (
          <div aria-label="Resultado del alta de activos (tabla desplazable)" className="table-wrap" role="group" tabIndex={0}>
            <table className="report-table ops-table" aria-label="Resultado del alta de activos">
              <thead>
                <tr>
                  <th scope="col">ISIN</th>
                  <th scope="col">Situación</th>
                  <th scope="col">Nombre</th>
                  <th scope="col">Producto</th>
                </tr>
              </thead>
              <tbody>
                {altaFilas.map((fila) => (
                  <tr key={fila.isin}>
                    <td className="ops-isin">{fila.isin}</td>
                    <td>
                      {OPS_SITUACION_LABELS[fila.situacion]}
                      {fila.situacion === "nuevo" && fila.identificado === false ? " · sin identificar" : ""}
                    </td>
                    <td>{fila.nombre || FALTA}</td>
                    <td>
                      {fila.situacion === "invalido" ? (
                        FALTA
                      ) : (
                        <select
                          aria-label={`Producto de ${fila.isin}`}
                          value={OPS_TIPOS.includes(fila.tipo as OpsTipoActivo) ? fila.tipo : "fondo"}
                          disabled={busy || reclasificando !== null}
                          onChange={(event) => void reclasificar(fila.isin, event.target.value as OpsTipoActivo)}
                        >
                          {OPS_TIPOS.map((t) => (
                            <option key={t} value={t}>{tipoLabel(t)}</option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {reclasPendientes.length > 0 ? (
          <Aviso anunciar>
            {listSome(reclasPendientes)} pasa(n) a acción en el universo del extractor. Si la maestra lo(s) tiene como fondo, la alta lo(s)
            salta y el republish lo(s) aparta: reclasifícalo(s) en el paso 8, «Reclasificar en la maestra».
          </Aviso>
        ) : null}

        {acciones.size > 0 ? (
          <Aviso
            accion={
              onOpenIngesta ? (
                <Button size="sm" onClick={onOpenIngesta}>
                  Ir a Ingesta
                </Button>
              ) : undefined
            }
            tono="nota"
          >
            {acciones.size} acción(es) ({listSome([...acciones])}) no siguen este proceso: sus datos entran en la maestra por la ingesta EODHD.
          </Aviso>
        ) : null}
      </Panel>

      {/* Paso 2 · extraer ------------------------------------------------ */}
      <Panel
        acciones={<>
          <label className="ops-check">
            <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
            <span>Ignorar la caché</span>
          </label>
          <Button variant={variantePaso(2)} size="sm" onClick={() => void extraer()} disabled={busy || operables.length === 0 || Boolean(otraTarea)} busy={pasoActivo === "extraer"}>
            Extraer {operables.length} activo(s)
          </Button>
        </>}
        subtitulo={`Una pasada del extractor por los ${operables.length} activo(s): fuentes oficiales primero, caché por familia de dato, correcciones manuales aplicadas.`}
        titulo="2 · Extraer"
      >
        {fichas ? (
            <div aria-label="Fichas extraídas (tabla desplazable)" className="table-wrap" role="group" tabIndex={0}>
              <table className="report-table ops-table" aria-label="Fichas extraídas">
                <thead>
                  <tr>
                    <th scope="col">ISIN</th>
                    <th scope="col">Nombre</th>
                    <th scope="col">Calidad</th>
                    <th scope="col" className="num">SRI</th>
                    <th scope="col">Fuente del SRI</th>
                    <th scope="col">KID</th>
                    <th scope="col" className="num">Campos</th>
                    <th scope="col">Avisos</th>
                  </tr>
                </thead>
                <tbody>
                  {fichas.map((ficha) => (
                    <tr key={ficha.isin} className={ficha.sin_ficha ? "ops-row--flag" : undefined}>
                      <td className="ops-isin">{ficha.isin}</td>
                      <td>{ficha.sin_ficha ? "Sin ficha: ninguna fuente dio datos" : ficha.nombre || FALTA}</td>
                      <td>{ficha.calidad.bucket ? `${ficha.calidad.bucket}${typeof ficha.calidad.score === "number" ? ` · ${ficha.calidad.score}` : ""}` : FALTA}</td>
                      <td className="num">{ficha.sri.valor ?? FALTA}</td>
                      <td>{ficha.sri.fuente ? `${fuenteLabel(ficha.sri.fuente)}${ficha.sri.oficial ? "" : " · no oficial"}` : FALTA}</td>
                      <td>{ficha.kid.fuente ? `${fuenteLabel(ficha.kid.fuente)}${ficha.kid.fecha ? ` · ${diaDe(ficha.kid.fecha)}` : ""}` : FALTA}</td>
                      <td className="num">{ficha.sin_ficha ? FALTA : ficha.campos_con_dato}</td>
                      <td>
                        {[
                          ficha.correcciones.aplicadas ? `${ficha.correcciones.aplicadas} corrección(es)` : null,
                          ficha.correcciones.redundantes.length ? `${ficha.correcciones.redundantes.length} redundante(s)` : null,
                          ficha.errores.length ? `${ficha.errores.length} error(es) de fuente` : null
                        ]
                          .filter(Boolean)
                          .join(" · ") || FALTA}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        ) : null}
      </Panel>

      {/* Paso 3 · canónico ----------------------------------------------- */}
      <Panel
        acciones={<>
          <Button variant={variantePaso(3)} size="sm" onClick={() => void generarCanonico()} disabled={busy || Boolean(otraTarea)} busy={pasoActivo === "canonico"}>
            Regenerar canónico
          </Button>
        </>}
        subtitulo="Regenera el paquete completo (export_bdb y export comparten identificador): es lo que la plataforma lee."
        titulo="3 · Canónico"
      >
        {canonico ? (
          <>
            <KpiStrip
              ariaLabel="Resultado del canónico"
              items={[
                { label: "Generados", value: canonico.ok },
                { label: "Con errores", value: canonico.errores },
                { label: "Paquete", value: canonico.paquete_coherente ? "Coherente" : "Incoherente" },
                { label: "Identificador", value: shortId(canonico.package_id) }
              ]}
            />
            {canonico.fondos.length > 0 ? (
              <ul className="admin-mini-list">
                {canonico.fondos.map((f) => (
                  <li key={f.isin}>
                    <span className="ops-isin">{f.isin}</span>{" "}
                    {!f.generado
                      ? "sin canónico (no hay ficha o está bloqueada)"
                      : f.validation_ok === false
                        ? `contrato no válido: ${f.errors.slice(0, 2).join("; ") || "ver detalle"}`
                        : `válido${f.kid_source ? ` · KID ${fuenteLabel(f.kid_source)}` : ""}${f.warnings ? ` · ${f.warnings} aviso(s)` : ""}`}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </Panel>

      {/* Paso 4 · copia y pasada en seco --------------------------------- */}
      <Panel
        acciones={<>
          <Button size="sm" onClick={() => void hacerCopia()} disabled={busy || !plataformaLista || Boolean(otraTarea)} busy={pasoActivo === "backup"}>
            {copiaVigente ? "Repetir copia" : "Hacer copia de la maestra"}
          </Button>
        </>}
        subtitulo={`Antes de escribir hace falta una copia de la maestra de menos de ${estado?.plataforma.backup_max_horas ?? 24} horas. La pasada en seco no escribe nada: enseña lo que la plataforma haría.`}
        titulo="4 · Copia y pasada en seco"
      >
        <p className="ops-meta">
          {copia
            ? `Última copia: ${momentoDe(copia.exportado)} · ${horasLabel(copia.edad_horas)} · ${copia.registros ?? FALTA} registros · verificación ${copia.verificacion ?? FALTA}${copia.vigente ? "" : " · caducada"}`
            : "No hay ninguna copia de la maestra en la plataforma."}
          {!plataformaLista && estado ? ` · La plataforma de datos no está disponible aquí (${estado.plataforma.ruta}).` : ""}
        </p>
        <div className="ops-input-row">
          <Campo rotulo="Qué se le pide a la plataforma">
            <select
              value={modo}
              onChange={(event) => {
                setModo(event.target.value as OpsModoPlataforma);
                setModoManual(true);
                resetDesde("seco");
              }}
            >
              {OPS_MODOS.map((m) => (
                <option key={m} value={m}>{OPS_MODO_LABELS[m]}</option>
              ))}
            </select>
          </Campo>
          <div className="ops-step-actions">
            <Button
              variant={variantePaso(4)}
              onClick={() => void pasadaEnSeco()}
              disabled={busy || operables.length === 0 || !plataformaLista || Boolean(otraTarea) || estado?.paquete_coherente === false}
              busy={pasoActivo === "seco"}
            >
              Pasada en seco
            </Button>
          </div>
        </div>

        {seco ? (
          <>
            <KpiStrip
              ariaLabel="Resumen de la pasada en seco"
              items={[
                { label: "Escrituras previstas", value: seco.escrituras },
                ...(seco.modo === "alta"
                  ? [
                      { label: "Documentos a crear", value: seco.documentos ?? FALTA },
                      { label: "Ya existen", value: seco.recuento.SKIP_EXISTS ?? 0 },
                      { label: "Retenidos", value: seco.recuento.REVIEW_HOLD ?? 0 },
                      { label: "Rechazados", value: seco.recuento.BLOCKED_REJECTED ?? 0 },
                      { label: "Paquete", value: seco.validacion_paquete ?? FALTA }
                    ]
                  : [
                      { label: "Comprobados", value: seco.recuento.checked ?? 0 },
                      { label: "Sin cambios", value: seco.recuento.matched ?? 0 },
                      { label: "A republicar", value: seco.recuento.to_republish ?? 0 },
                      { label: "Sin canónico válido", value: seco.recuento.canonical_invalid ?? 0 },
                      { label: "No están en la maestra", value: seco.recuento.live_missing ?? 0 }
                    ])
              ]}
            />
            <div aria-label="Plan de escritura de la pasada en seco (tabla desplazable)" className="table-wrap" role="group" tabIndex={0}>
              <table className="report-table ops-table ops-plan-table" aria-label="Plan de escritura de la pasada en seco">
                <thead>
                  <tr>
                    <th scope="col">ISIN</th>
                    <th scope="col">Acción</th>
                    <th scope="col">{seco.modo === "alta" ? "Documentos o motivo" : "Campos que cambian"}</th>
                  </tr>
                </thead>
                <tbody>
                  {seco.filas.map((fila) => (
                    <tr key={fila.isin} className={planActionWrites(fila.accion) ? undefined : "ops-row--quiet"}>
                      <td className="ops-isin">{fila.isin}</td>
                      <td>{planActionLabel(fila.accion)}</td>
                      <td className="ops-cell-wrap">
                        {seco.modo === "alta"
                          ? documentosLabel(fila.documentos) || (fila.motivos ?? []).join(" · ") || FALTA
                          : (fila.rutas && fila.rutas.length > 0 ? fila.rutas : fila.campos ?? []).join(" · ") || FALTA}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {seco.modo === "alta" ? (
              <p className="ops-meta">
                Cada activo nuevo entra con su ficha, su cartera y un documento de métricas inicial con las rentabilidades y riesgos del proveedor
                que trae el canónico; en los fondos, el refresco diario de la app solo le actualiza la caída máxima. Los que ya existen no se
                tocan: la escritura solo manda los activos a crear.
              </p>
            ) : null}
            {seco.otros_en_plan && seco.otros_en_plan.length > 0 ? (
              <p className="ops-meta">También se actualiza: {seco.otros_en_plan.join(", ")}.</p>
            ) : null}
            {seco.modo === "republish" && (seco.recuento.live_missing ?? 0) > 0 ? (
              <Aviso>{seco.recuento.live_missing} activo(s) no están en la maestra: para ellos hay que pedir «Alta», no «Republicar».</Aviso>
            ) : null}
          </>
        ) : null}
      </Panel>

      {/* Paso 5 · escribir ----------------------------------------------- */}
      <Panel
        acciones={<>
          <Button
            variant={variantePaso(5)}
            size="sm"
            onClick={() => {
              setConfirmCount("");
              setConfirmOpen(true);
            }}
            disabled={busy || !secoVigente || escriturasPrevistas === 0 || !copiaVigente || Boolean(otraTarea)}
            busy={pasoActivo === "escribir"}
          >
            Escribir {escriturasPrevistas} cambio(s)
          </Button>
        </>}
        subtitulo="Se teclea el número de escrituras de la pasada en seco. El servicio repite la pasada justo antes y, si el número cambió, no escribe. El gate de escritura solo existe en el proceso que escribe."
        titulo="5 · Escribir en la maestra"
      >
        {!secoVigente ? (
          <p className="ops-meta">Primero la pasada en seco de estos mismos activos y con este mismo modo.</p>
        ) : escriturasPrevistas === 0 ? (
          <p className="ops-meta">La pasada en seco no prevé ninguna escritura: nada que hacer.</p>
        ) : !copiaVigente ? (
          <Aviso>No hay copia de la maestra de las últimas {estado?.plataforma.backup_max_horas ?? 24} horas. Haz la copia en el paso 4.</Aviso>
        ) : null}

        {escritura ? (
          <>
            {escritura.mensaje ? <p className="ops-meta">{escritura.mensaje}</p> : null}
            {escritura.escritura ? (
              <KpiStrip
                ariaLabel="Resultado de la escritura"
                items={[
                  {
                    label: escritura.escritura.modo === "alta" ? "Creados" : "Republicados",
                    value: (escritura.escritura.modo === "alta" ? escritura.escritura.escritura?.escritos : escritura.escritura.escritura?.republicados) ?? 0
                  },
                  { label: "Postverificados", value: escritura.escritura.escritura?.postverify_ok ?? 0 },
                  { label: "Postverificación fallida", value: escritura.escritura.escritura?.postverify_fallidos ?? 0 },
                  { label: "Errores", value: escritura.escritura.escritura?.errores.length ?? 0 },
                  { label: "Comprobación", value: escritura.auditoria ? (escritura.auditoria.en_cero ? "En cero" : `${escritura.auditoria.desvios} desvío(s)`) : "No hecha" }
                ]}
              />
            ) : null}
            {escritura.escritura?.error ? (
              <Aviso tono="error">{escritura.escritura.error}</Aviso>
            ) : null}
            {escritura.escritura?.escritura ? <OpsErrores errores={escritura.escritura.escritura.errores} /> : null}
          </>
        ) : null}
      </Panel>

      {/* Paso 6 · comprobar ---------------------------------------------- */}
      <Panel
        acciones={<>
          <Button size="sm" onClick={() => void auditar()} disabled={busy || operables.length === 0 || !plataformaLista || Boolean(otraTarea)} busy={pasoActivo === "auditar"}>
            Auditar
          </Button>
        </>}
        subtitulo="Auditoría de consistencia entre el canónico del extractor y lo que hay en la maestra para estos activos."
        titulo="6 · Comprobar"
      >
        {auditoria ? (
          <>
            <KpiStrip
              ariaLabel="Resultado de la auditoría"
              items={[
                { label: "Desvíos", value: auditoria.desvios },
                { label: "Carteras desviadas", value: auditoria.holdings_desviados },
                { label: "Resultado", value: auditoria.en_cero ? "En cero" : "Con desvíos" }
              ]}
            />
            {auditoria.detalle.length > 0 ? (
              <ul className="admin-mini-list">
                {auditoria.detalle.slice(0, MAX_LISTED).map((d, i) => (
                  <li key={i}>
                    <span className="ops-isin">{String(d.asset_id ?? "")}</span>{" "}
                    {Array.isArray(d.drift_paths) ? d.drift_paths.slice(0, 8).join(" · ") : Array.isArray(d.drift_fields) ? d.drift_fields.join(" · ") : JSON.stringify(d).slice(0, 160)}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </Panel>

      {/* Paso 7 · archivar ----------------------------------------------- */}
      <Panel
        subtitulo="Retira activos de la maestra sin perderlos: copia restaurable en local y en «_archived_assets», fuera de «assets» y del buscador, baja del universo del extractor y canónico regenerado. Sin borrado físico. Primero la pasada en seco; después, teclear el recuento."
        titulo="7 · Archivar"
      >
        <div className="ops-input-row">
          <Campo className="ops-isin-field" pista={`${archivoIsins.length} ISIN reconocidos`} rotulo="ISIN a archivar">
            <textarea
              value={archivoText}
              rows={2}
              placeholder="LU0000000001"
              className="ops-isin-text"
              onChange={(event) => {
                setArchivoText(event.target.value);
                setArchivoSeco(null);
                setArchivado(null);
              }}
            />
          </Campo>
          <Campo rotulo="Motivo">
            <input value={archivoMotivo} placeholder="alta errónea · clase liquidada" onChange={(event) => setArchivoMotivo(event.target.value)} />
          </Campo>
          <div className="ops-step-actions">
            <Button onClick={() => void archivarSeco()} disabled={busy || archivoIsins.length === 0 || !plataformaLista || Boolean(otraTarea)} busy={pasoActivo === "archivar_seco"}>
              Pasada en seco
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmArchivoCount("");
                setConfirmArchivoOpen(true);
              }}
              disabled={busy || !archivoSecoVigente || archivables === 0 || !copiaVigente || Boolean(otraTarea)}
              busy={pasoActivo === "archivar"}
            >
              Archivar {archivables} activo(s)
            </Button>
          </div>
        </div>

        {archivoSecoVigente && archivoSeco ? (
          <>
            <KpiStrip
              ariaLabel="Resumen de la pasada en seco del archivo"
              items={[
                { label: "En la maestra", value: archivoSeco.archivables },
                { label: "No están", value: archivoSeco.no_existen.length },
                { label: "Subdocumentos", value: archivoSeco.recuento.subdocs_total ?? 0 },
                { label: "En el buscador", value: archivoSeco.recuento.in_search_index ?? 0 }
              ]}
            />
            <div aria-label="Archivo de activos (tabla desplazable)" className="table-wrap" role="group" tabIndex={0}>
              <table className="report-table ops-table" aria-label="Archivo de activos">
                <thead>
                  <tr>
                    <th scope="col">ISIN</th>
                    <th scope="col">Acción</th>
                    <th scope="col">Nombre</th>
                    <th scope="col">Producto</th>
                    <th scope="col" className="num">Subdocumentos</th>
                    <th scope="col">Buscador</th>
                  </tr>
                </thead>
                <tbody>
                  {archivoSeco.filas.map((fila) => (
                    <tr key={fila.isin} className={fila.existe ? undefined : "ops-row--quiet"}>
                      <td className="ops-isin">{fila.isin}</td>
                      <td>{planActionLabel(fila.accion)}</td>
                      <td>{fila.nombre ?? FALTA}</td>
                      <td>{fila.tipo ?? FALTA}</td>
                      <td className="num">{fila.existe ? fila.subdocs : textoDeAusencia("no-aplica")}</td>
                      <td>{fila.existe ? (fila.en_indice ? "Sí" : "No") : textoDeAusencia("no-aplica")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!copiaVigente && archivables > 0 ? (
              <Aviso>No hay copia de la maestra de las últimas {estado?.plataforma.backup_max_horas ?? 24} horas. Haz la copia en el paso 4 antes de archivar.</Aviso>
            ) : null}
          </>
        ) : null}

        {archivado ? (
          <>
            <KpiStrip
              ariaLabel="Resultado del archivo"
              items={[
                { label: "Archivados", value: archivado.archivo.escritura?.archivados ?? 0 },
                { label: "Subdocumentos copiados", value: archivado.archivo.escritura?.subdocs_copiados ?? 0 },
                { label: "Fuera del buscador", value: archivado.archivo.escritura?.indice_retirados ?? 0 },
                { label: "Postverificados", value: archivado.archivo.escritura?.postverify_ok ?? 0 },
                { label: "Fallidos", value: archivado.archivo.escritura?.postverify_fallidos ?? 0 },
                { label: "Universo", value: archivado.baja ? `${archivado.baja.filter((b) => b.estaba).length} baja(s)` : "Sin cambios" }
              ]}
            />
            {archivado.archivo.mensaje ? <p className="ops-meta">{archivado.archivo.mensaje}</p> : null}
            {archivado.archivo.error ? (
              <Aviso tono="error">{archivado.archivo.error}</Aviso>
            ) : null}
            {archivado.archivo.escritura && archivado.archivo.escritura.copias.length > 0 ? (
              <ul className="admin-mini-list">
                {archivado.archivo.escritura.copias.map((c) => (
                  <li key={c}>Copia restaurable: {c}</li>
                ))}
              </ul>
            ) : null}
            <p className="ops-meta">
              {archivado.canonico
                ? `Canónico regenerado sin los activos archivados: ${archivado.canonico.ok} generados${archivado.canonico.paquete_coherente ? ", paquete coherente" : ", paquete incoherente"}.`
                : "El canónico no se regeneró: ningún activo superó la postverificación."}
            </p>
          </>
        ) : null}
      </Panel>

      {/* Paso 8 · reclasificar en la maestra ------------------------------ */}
      <Panel
        subtitulo="Para un activo que el universo ya da por acción y la maestra sigue teniendo como fondo. La pasada en seco dice qué cambiaría: ficha de acción sin los bloques de fondo, métricas invalidadas hasta que la app las recalcule y entrada del buscador; y repara lo que haya quedado a medias en las que ya son acción. Después, teclear el recuento."
        titulo="8 · Reclasificar en la maestra"
      >
        <div className="ops-input-row">
          <Campo
            className="ops-isin-field"
            pista={`${reclasIsins.length} ISIN reconocidos · tienen que estar ya como acción en el universo`}
            rotulo="ISIN a reclasificar"
          >
            <textarea
              value={reclasText}
              rows={2}
              placeholder="ES0105046009"
              className="ops-isin-text"
              onChange={(event) => {
                setReclasText(event.target.value);
                setReclasSeco(null);
                setReclasificado(null);
              }}
            />
          </Campo>
          <label className="ops-check">
            <input type="checkbox" checked={reclasPreparar} onChange={(event) => { setReclasPreparar(event.target.checked); setReclasSeco(null); }} />
            <span>Extraer como acción los que aún no tienen canónico de acción</span>
          </label>
          <div className="ops-step-actions">
            <Button
              onClick={() => void reclasificarSeco()}
              disabled={busy || reclasIsins.length === 0 || !plataformaLista || Boolean(otraTarea)}
              busy={pasoActivo === "reclasificar_seco"}
            >
              Pasada en seco
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmReclasCount("");
                setConfirmReclasOpen(true);
              }}
              disabled={busy || !reclasSecoVigente || reclasificables === 0 || !copiaVigente || Boolean(otraTarea)}
              busy={pasoActivo === "reclasificar"}
            >
              Reclasificar {reclasificables} activo(s)
            </Button>
          </div>
        </div>

        {reclasSecoVigente && reclasSeco ? (
          <>
            <KpiStrip
              ariaLabel="Resumen de la pasada en seco de la reclasificación"
              items={[
                { label: "A reclasificar", value: reclasSeco.recuento.a_reclasificar ?? reclasSeco.reclasificables },
                { label: "A reparar", value: reclasSeco.recuento.a_reparar ?? 0 },
                { label: "Se omiten", value: reclasSeco.recuento.omitidos ?? 0 },
                { label: "Con error", value: reclasSeco.recuento.errores ?? 0 }
              ]}
            />
            <div aria-label="Reclasificación en la maestra (tabla desplazable)" className="table-wrap" role="group" tabIndex={0}>
              <table className="report-table ops-table" aria-label="Reclasificación en la maestra">
                <thead>
                  <tr>
                    <th scope="col">ISIN</th>
                    <th scope="col">Acción</th>
                    <th scope="col">Producto en la maestra</th>
                    <th scope="col">Qué cambia o por qué no</th>
                  </tr>
                </thead>
                <tbody>
                  {reclasSeco.filas.map((fila) => (
                    <tr key={fila.isin} className={planActionWrites(fila.accion) ? undefined : "ops-row--quiet"}>
                      <td className="ops-isin">{fila.isin}</td>
                      <td>{planActionLabel(fila.accion)}</td>
                      <td>{fila.de ? `${TYPE_LABELS[fila.de] ?? fila.de} → ${TYPE_LABELS[fila.a ?? "STOCK"] ?? fila.a}` : FALTA}</td>
                      <td className="ops-cell-wrap">
                        {fila.accion === "RECLASSIFY" ? reclasificacionCambios(fila) || FALTA : fila.motivo || FALTA}
                        {fila.error ? (
                          <details className="async-error-banner__detail">
                            <summary>Detalle técnico</summary>
                            <code>{fila.error}</code>
                          </details>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {reclasSeco.carteras_colgando.length > 0 ? (
              <Aviso>
                {listSome(reclasSeco.carteras_colgando.map((c) => c.isin))} conserva(n) la cartera de cuando era(n) fondo. No se borra: si sobra,
                archívala aparte.
              </Aviso>
            ) : null}
            {reclasSeco.metricas_de_fondo.length > 0 ? (
              <Aviso>
                {listSome(reclasSeco.metricas_de_fondo)} ya es (son) acción pero conserva(n) métricas de fondo. Esta pasada no las toca: se
                invalidan desde la plataforma con «reclassify:stock --repair-metrics».
              </Aviso>
            ) : null}
            {!copiaVigente && reclasificables > 0 ? (
              <Aviso>No hay copia de la maestra de las últimas {estado?.plataforma.backup_max_horas ?? 24} horas. Haz la copia en el paso 4 antes de reclasificar.</Aviso>
            ) : null}
          </>
        ) : null}

        {reclasificado ? (
          <>
            {reclasificado.mensaje ? <p className="ops-meta">{reclasificado.mensaje}</p> : null}
            {reclasificado.escritura ? (
              <KpiStrip
                ariaLabel="Resultado de la reclasificación"
                items={[
                  { label: "Reclasificados", value: reclasificado.escritura.escritos ?? 0 },
                  { label: "Reparados", value: reclasificado.escritura.reparados ?? 0 },
                  { label: "Métricas invalidadas", value: reclasificado.escritura.metricas_invalidadas ?? 0 },
                  { label: "Postverificados", value: reclasificado.escritura.postverify_ok ?? 0 },
                  { label: "Fallidos", value: reclasificado.escritura.postverify_fallidos ?? 0 },
                  { label: "Comprobación", value: reclasificado.auditoria ? (reclasificado.auditoria.en_cero ? "En cero" : `${reclasificado.auditoria.desvios} desvío(s)`) : "No hecha" }
                ]}
              />
            ) : null}
            {reclasificado.error ? (
              <Aviso tono="error">{reclasificado.error}</Aviso>
            ) : null}
            {reclasificado.escritura ? <OpsErrores errores={reclasificado.escritura.errores} /> : null}
            {reclasificado.escritura && (reclasificado.escritura.escritos ?? 0) > 0 ? (
              <p className="ops-meta">
                Hasta que el refresco de métricas de la app las recalcule como acción, el activo se ve sin métricas, no con las del fondo.
              </p>
            ) : null}
          </>
        ) : null}
      </Panel>

      {pasoError ? (
        <Aviso tono="error">{PASO_LABELS[pasoError.paso]}: {pasoError.mensaje}</Aviso>
      ) : null}
      <Panel titulo="Seguimiento de operaciones">
        <p>Detener el seguimiento o salir de esta pantalla deja el trabajo en el servicio. Puedes consultar su resultado sin ejecutarlo otra vez.</p>
        {busy ? <Button onClick={() => observation.current?.abort()} size="sm">Detener seguimiento</Button> : (
          <div>
            <label>Identificador de tarea <input value={resumeId} onChange={(event) => setResumeId(event.target.value)} /></label>
            <Button disabled={!resumeId.trim()} onClick={() => void reanudar(resumeId.trim())} size="sm">Consultar o reanudar seguimiento</Button>
            {otraTarea ? <Button onClick={() => void reanudar(otraTarea.id)} size="sm">Seguir la tarea en curso</Button> : null}
          </div>
        )}
      </Panel>
      <TareaLog tarea={tarea} paso={pasoActivo} />

      {/* Correcciones ---------------------------------------------------- */}
      <Panel
        subtitulo="La corrección se guarda en el extractor con su motivo, se aplica en la siguiente extracción con procedencia «manual» y llega a la maestra por el camino de siempre. Solo campos que alguna fuente declara; «null» borra el campo."
        titulo="Corregir un campo"
      >
        <div className="ops-input-row">
          <Campo rotulo="ISIN">
            <input
              value={correccionIsin}
              list="ops-correccion-isins"
              placeholder="LU0113257694"
              className="ops-isin-input"
              onChange={(event) => setCorreccionIsin(event.target.value.toUpperCase())}
            />
          </Campo>
          <datalist id="ops-correccion-isins">
            {operables.map((i) => (
              <option key={i} value={i} />
            ))}
          </datalist>
          <div className="ops-step-actions">
            <Button
              onClick={() => {
                setCorreccionMensaje(null);
                void cargarCorrecciones(correccionIsin);
              }}
              disabled={correccionesBusy || !/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(correccionIsin.trim())} busy={correccionesBusy && !correcciones}>
              Ver campos
            </Button>
          </div>
        </div>

        {correccionesError ? (
          <Aviso tono="error">{correccionesError}</Aviso>
        ) : null}
        {correccionMensaje ? (
          <Aviso anunciar tono="nota">{correccionMensaje}</Aviso>
        ) : null}

        {correcciones ? (
          <>
            {!correcciones.con_ficha ? (
              <p className="ops-meta">{correcciones.isin} aún no tiene ficha extraída: solo se ven las correcciones registradas.</p>
            ) : null}
            <div className="ops-correccion-form">
              <Campo rotulo="Campo (ruta)">
                <input
                  value={form.ruta}
                  list="ops-correccion-rutas"
                  placeholder="riesgo.sri_kid_1a7"
                  className="ops-mono-input"
                  onChange={(event) => setForm((current) => ({ ...current, ruta: event.target.value }))}
                />
              </Campo>
              <datalist id="ops-correccion-rutas">
                {correcciones.campos.map((c) => (
                  <option key={c.ruta} value={c.ruta} />
                ))}
              </datalist>
              <Campo rotulo="Valor nuevo">
                <input value={form.valor} placeholder="4 · texto · true · null" onChange={(event) => setForm((current) => ({ ...current, valor: event.target.value }))} />
              </Campo>
              <Campo className="ops-motivo-field" rotulo="Motivo y origen del dato">
                <input value={form.motivo} placeholder="KID del productor de 2026-02" onChange={(event) => setForm((current) => ({ ...current, motivo: event.target.value }))} />
              </Campo>
              <label className="ops-check">
                <input type="checkbox" checked={form.nueva} onChange={(event) => setForm((current) => ({ ...current, nueva: event.target.checked }))} />
                <span>Es un campo que la ficha no tiene todavía</span>
              </label>
              <div className="ops-step-actions">
                <Button variant="primary" onClick={() => void guardarCorreccion()} disabled={correccionesBusy || form.ruta.trim().length === 0 || form.motivo.trim().length < 3}>
                  Guardar corrección
                </Button>
              </div>
            </div>

            <div aria-label="Correcciones del activo (tabla desplazable)" className="table-wrap" role="group" tabIndex={0}>
              <table className="report-table ops-table ops-campos-table" aria-label="Correcciones del activo">
                <thead>
                  <tr>
                    <th scope="col">Campo</th>
                    <th scope="col">Valor en la ficha</th>
                    <th scope="col">Fuente</th>
                    <th scope="col">Corrección</th>
                    <th scope="col">Estado</th>
                    <th scope="col"><span className="ui-visually-hidden">Acciones</span></th>
                  </tr>
                </thead>
                <tbody>
                  {correcciones.campos.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="ops-empty-cell">Sin campos corregibles: extrae el activo primero.</td>
                    </tr>
                  ) : (
                    correcciones.campos.map((campo) => (
                      <tr key={campo.ruta} className={campo.correccion ? "ops-row--flag" : undefined}>
                        <td className="ops-mono">{campo.ruta}</td>
                        <td className="ops-cell-wrap">{formatCorrectionValue(campo.valor)}</td>
                        <td>{fuenteLabel(campo.fuente)}</td>
                        <td className="ops-cell-wrap">
                          {campo.correccion ? `${formatCorrectionValue(campo.correccion.valor)} · ${campo.correccion.motivo}` : FALTA}
                        </td>
                        <td>
                          {!campo.correccion
                            ? FALTA
                            : !campo.aplicada
                              ? "Pendiente de extraer"
                              : campo.aplicada.redundante
                                ? "Redundante: la fuente ya coincide"
                                : "Aplicada"}
                        </td>
                        <td>
                          <div className="ops-row-actions">
                            <Button
                              size="sm"
                              disabled={correccionesBusy}
                              onClick={() =>
                                setForm({
                                  ruta: campo.ruta,
                                  valor: campo.correccion ? String(campo.correccion.valor ?? "null") : campo.valor === null ? "" : String(campo.valor),
                                  motivo: campo.correccion?.motivo ?? "",
                                  nueva: false
                                })
                              }
                            >
                              Corregir
                            </Button>
                            {campo.correccion ? (
                              <Button size="sm" variant="danger" disabled={correccionesBusy} onClick={() => void retirarCorreccion(campo.ruta, campo.correccion?.motivo ?? "")}>
                                Retirar
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </Panel>

      {confirmArchivoOpen && archivoSeco ? (
        <ModalDialog labelledBy="ops-archive-title" size="sm" onClose={() => setConfirmArchivoOpen(false)}>
          <DialogHeader
            titleId="ops-archive-title"
            eyebrow="Archivo en la maestra"
            title={`Archivar ${archivables} activo(s)`}
            onClose={() => setConfirmArchivoOpen(false)}
          />
          <DialogBody>
            <p>
              Se archivarán {listSome(archivoSeco.filas.filter((f) => f.existe).map((f) => f.isin))}: copia restaurable en local y en «_archived_assets»,
              retirada de «assets» y del buscador, baja del universo del extractor y canónico regenerado. Copia vigente de {horasLabel(copia?.edad_horas)}.
              {archivoMotivo.trim() ? ` Motivo: ${archivoMotivo.trim()}.` : ""}
            </p>
            <Campo rotulo="Teclea el número de activos para confirmar">
              <input inputMode="numeric" value={confirmArchivoCount} autoFocus onChange={(event) => setConfirmArchivoCount(event.target.value.trim())} />
            </Campo>
          </DialogBody>
          <DialogFooter>
            <Button onClick={() => setConfirmArchivoOpen(false)}>Cancelar</Button>
            <Button variant="danger" disabled={confirmArchivoCount !== String(archivables)} onClick={() => void archivar()}>
              Archivar
            </Button>
          </DialogFooter>
        </ModalDialog>
      ) : null}

      {confirmReclasOpen && reclasSeco ? (
        <ModalDialog labelledBy="ops-reclass-title" size="sm" onClose={() => setConfirmReclasOpen(false)}>
          <DialogHeader
            titleId="ops-reclass-title"
            eyebrow="Reclasificación en la maestra"
            title={`Reclasificar o reparar ${reclasificables} activo(s)`}
            onClose={() => setConfirmReclasOpen(false)}
          />
          <DialogBody>
            <p>
              Se reescribirá como acción la ficha de {listSome(reclasSeco.filas.filter((f) => planActionWrites(f.accion)).map((f) => f.isin))}: desaparecen
              los bloques de fondo, las métricas quedan invalidadas hasta que la app las recalcule y el buscador lo muestra como acción. Copia vigente
              de {horasLabel(copia?.edad_horas)}. La pasada en seco se repite antes de escribir y, si el recuento ya no coincide, no se escribe nada.
            </p>
            <Campo rotulo="Teclea el número de activos para confirmar">
              <input inputMode="numeric" value={confirmReclasCount} autoFocus onChange={(event) => setConfirmReclasCount(event.target.value.trim())} />
            </Campo>
          </DialogBody>
          <DialogFooter>
            <Button onClick={() => setConfirmReclasOpen(false)}>Cancelar</Button>
            <Button variant="danger" disabled={confirmReclasCount !== String(reclasificables)} onClick={() => void reclasificarEnMaestra()}>
              Reclasificar
            </Button>
          </DialogFooter>
        </ModalDialog>
      ) : null}

      {confirmOpen && seco ? (
        <ModalDialog labelledBy="ops-write-title" size="sm" onClose={() => setConfirmOpen(false)}>
          <DialogHeader
            titleId="ops-write-title"
            eyebrow="Escritura en la maestra"
            title={`Escribir ${escriturasPrevistas} cambio(s) (${modo === "alta" ? "alta" : "republicar"})`}
            onClose={() => setConfirmOpen(false)}
          />
          <DialogBody>
            <p>
              La plataforma escribirá en la base maestra {escriturasPrevistas} activo(s): {listSome(seco.filas.filter((f) => planActionWrites(f.accion)).map((f) => f.isin))}
              {seco.modo === "alta" && typeof seco.documentos === "number" ? `, con ${seco.documentos} documento(s) entre fichas, carteras y métricas iniciales` : ""}.
              Copia vigente de {horasLabel(copia?.edad_horas)}. La pasada en seco se repite antes de escribir y, si el recuento ya no coincide, no se
              escribe nada.
            </p>
            <Campo rotulo="Teclea el número de escrituras para confirmar">
              <input inputMode="numeric" value={confirmCount} autoFocus onChange={(event) => setConfirmCount(event.target.value.trim())} />
            </Campo>
          </DialogBody>
          <DialogFooter>
            <Button onClick={() => setConfirmOpen(false)}>Cancelar</Button>
            {/* PLA-18: escribir en la maestra es de la misma clase que archivar o reclasificar: el botón, de peligro. */}
            <Button variant="danger" disabled={confirmCount !== String(escriturasPrevistas)} onClick={() => void escribir()}>
              Escribir
            </Button>
          </DialogFooter>
        </ModalDialog>
      ) : null}
      {confirmDialog}
    </div>
  );
}
