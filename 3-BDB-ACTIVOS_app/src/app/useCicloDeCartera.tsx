import { lazy, Suspense, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { EleccionAnteLaGuardadaCambiada } from "../components/CarteraCambiadaDialog";
import {
  hayCambiosSinGuardar,
  huellaDeCartera,
  type CarteraAbierta,
  type ContenidoDeCartera
} from "../core/carteraActiva";
import { escucharCarterasGuardadas } from "../core/carterasGuardadasAvisos";
import { olvidarTrabajoDeCartera, perfilEnSesion } from "../core/disenoEnSesion";
import { getBrowserDraftStorage } from "../core/draftStorage";
import {
  readCarteraAbiertaFromStorage,
  readPerfilYHorizonteFromStorage,
  writeCarteraAbiertaToStorage,
  writePerfilYHorizonteToStorage
} from "../core/localPortfolioStorage";
import { perfilElegidoDelNivel, type PerfilYHorizonte } from "../core/perfilYHorizonte";
import type { AssetDataSourceKind } from "../types/assetDataSource";
import type { BdbManualPortfolioPosition, BdbSavedLocalPortfolio } from "../types/bdbAssets";

/* Fuera de la carga inicial, que tiene presupuesto. Se trae en cuanto hay algo que perder: así la
   pregunta sale al momento y no depende de la red en el peor momento. */
const cargarElDialogo = () => import("../components/CambiosSinGuardarDialog");
// eslint-disable-next-line react-refresh/only-export-components -- este fichero exporta un hook; el diálogo es suyo y no se exporta.
const CambiosSinGuardarDialog = lazy(() => cargarElDialogo().then((modulo) => ({ default: modulo.CambiosSinGuardarDialog })));
// eslint-disable-next-line react-refresh/only-export-components -- como el anterior: el diálogo es del hook y no se exporta.
const CarteraCambiadaDialog = lazy(() => import("../components/CarteraCambiadaDialog").then((modulo) => ({ default: modulo.CarteraCambiadaDialog })));

type EstadoQueSePregunta = "cambiada" | "eliminada" | "sin-comprobar";

/** Lo que devuelve guardar: si ha ido bien y la frase para quien lo ha pedido. */
export type ResultadoDeGuardar = { ok: boolean; mensaje: string; conAvisos?: boolean };

export interface CicloDeCartera {
  /** La cartera guardada de la que parte lo que hay en pantalla; `null` si no se ha guardado nunca. */
  abierta: CarteraAbierta | null;
  sinGuardar: boolean;
  guardando: boolean;
  /** Cambia cada vez que algo sustituye la cartera: lo que se recuerda de la anterior ya no vale. */
  generacion: number;
  /** Decisión 59: nivel de perfil y horizonte de lo que hay en Diseño. Se guardan con la cartera. */
  perfilYHorizonte: PerfilYHorizonte;
  /**
   * Cambiarlos es un cambio de la cartera: queda sin guardar hasta «Guardar», como el capital. Un nivel
   * nuevo pasa también a ser el perfil elegido de la sesión (`perfilEnSesion`).
   */
  fijarPerfilYHorizonte: (valor: PerfilYHorizonte) => void;
  /** Hace la acción si no hay nada que perder; si lo hay, pregunta antes. */
  conGuardia: (accion: () => void) => void;
  /** Pone otra cartera en Diseño. Con `abierta` es esa cartera guardada; sin ella, una sin guardar. */
  sustituir: (contenido: ContenidoDeCartera, abierta?: BdbSavedLocalPortfolio | null) => void;
  /** «Guardar» sobrescribe la abierta. Con `comoNueva`, «Guardar como…», crea otra y pasa a ser esa. */
  guardar: (opciones?: { nombre?: string; comoNueva?: boolean }) => Promise<ResultadoDeGuardar>;
  /** El aviso de cambios sin guardar. Va en el marco: «Salir» y las demás salidas están allí. */
  dialogo: ReactNode;
}

/**
 * El ciclo de vida de la cartera activa (hallazgo 47). Lo lleva el marco porque ya lleva las
 * posiciones, el capital y el nombre, y porque hay salidas que no pasan por Diseño de cartera.
 *
 * Qué cartera está abierta se recuerda en el mismo almacenamiento que el borrador: recargar la página
 * no debe convertir la siguiente vez que se pulse «Guardar» en una copia.
 */
export function useCicloDeCartera(opciones: {
  sourceKind: AssetDataSourceKind;
  positions: BdbManualPortfolioPosition[];
  capital: number | undefined;
  nombre: string;
  setPositions: Dispatch<SetStateAction<BdbManualPortfolioPosition[]>>;
  setCapital: (capital: number | undefined) => void;
  setNombre: (nombre: string) => void;
}): CicloDeCartera {
  const { sourceKind, positions, capital, nombre, setPositions, setCapital, setNombre } = opciones;
  const [abierta, setAbierta] = useState<CarteraAbierta | null>(() =>
    readCarteraAbiertaFromStorage(getBrowserDraftStorage(sourceKind), sourceKind)
  );
  const [generacion, setGeneracion] = useState(0);
  /* Lo lleva el ciclo y no el marco: solo lo leen Diseño y el guardado, y así no cruza tres pantallas. */
  const [perfilYHorizonte, setPerfilYHorizonte] = useState<PerfilYHorizonte>(() =>
    readPerfilYHorizonteFromStorage(getBrowserDraftStorage(sourceKind), sourceKind)
  );
  const [guardando, setGuardando] = useState(false);
  const [pendiente, setPendiente] = useState<{ accion: () => void } | null>(null);
  const [errorAlGuardar, setErrorAlGuardar] = useState<string | null>(null);
  const [avisoAlGuardar, setAvisoAlGuardar] = useState<string | null>(null);
  /* DIS-03: la pregunta antes de sobrescribir una guardada que ha cambiado desde que se abrió. */
  const [conflicto, setConflicto] = useState<EstadoQueSePregunta | null>(null);
  const resolverConflicto = useRef<((eleccion: EleccionAnteLaGuardadaCambiada) => void) | null>(null);
  /* La fecha de modificación de cada cartera que otra pestaña ha guardado mientras esta estaba abierta: la lectura
     de antes de guardar puede llegar con la lista de hace unos segundos, y esto no. */
  const guardadasFuera = useRef(new Map<string, string>());

  const sinGuardar = hayCambiosSinGuardar({ positions, capital, nombre, perfilYHorizonte }, abierta);

  useEffect(() => {
    writeCarteraAbiertaToStorage(getBrowserDraftStorage(sourceKind), sourceKind, abierta);
  }, [abierta, sourceKind]);

  useEffect(() => {
    writePerfilYHorizonteToStorage(getBrowserDraftStorage(sourceKind), sourceKind, perfilYHorizonte);
  }, [perfilYHorizonte, sourceKind]);

  /* Si se elimina la cartera abierta, lo que hay en pantalla se queda, pero ya no parte de ninguna. Desde el
     DIS-03 llega también lo que se elimina o se guarda en otra pestaña. */
  useEffect(
    () =>
      escucharCarterasGuardadas((aviso) => {
        if (aviso.tipo === "guardada") {
          if (aviso.deOtraPestana) guardadasFuera.current.set(aviso.cartera.portfolio_id, aviso.cartera.updated_at);
          return;
        }
        setAbierta((actual) => (actual?.portfolio_id === aviso.id ? null : actual));
      }),
    []
  );

  function preguntarAnteLaGuardadaCambiada(estado: EstadoQueSePregunta): Promise<EleccionAnteLaGuardadaCambiada> {
    resolverConflicto.current?.("cancelar");
    return new Promise((resolve) => {
      resolverConflicto.current = resolve;
      setConflicto(estado);
    });
  }

  function elegirAnteLaGuardadaCambiada(eleccion: EleccionAnteLaGuardadaCambiada) {
    resolverConflicto.current?.(eleccion);
    resolverConflicto.current = null;
    setConflicto(null);
  }

  /* Con la fuente en vivo el borrador vive en la pestaña: cerrarla lo pierde. El navegador enseña su
     propio texto; lo único que se decide aquí es si pregunta. */
  useEffect(() => {
    if (!sinGuardar) return undefined;
    void cargarElDialogo().catch(() => undefined);
    const avisar = (evento: BeforeUnloadEvent) => {
      evento.preventDefault();
      evento.returnValue = "";
    };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [sinGuardar]);

  function conGuardia(accion: () => void) {
    if (!sinGuardar) {
      accion();
      return;
    }
    setErrorAlGuardar(null);
    setAvisoAlGuardar(null);
    setPendiente({ accion });
  }

  /** La cartera guardada, con la huella del contenido que coincide con ella. */
  const abiertaDesde = (guardada: BdbSavedLocalPortfolio, contenido: ContenidoDeCartera): CarteraAbierta => ({
    portfolio_id: guardada.portfolio_id,
    created_at: guardada.created_at,
    updated_at: guardada.updated_at,
    huella: huellaDeCartera(contenido)
  });

  /*
   * Decisión 59: el nivel guardado arrastra el «Perfil elegido (informativo)» de Comprobar, y solo en ese
   * sentido. Abrir una cartera con nivel, o cambiar el nivel en sus controles, pone ese perfil en la sesión;
   * elegir otro perfil en Comprobar no toca la cartera. La asimetría es a propósito: el nivel es un dato de
   * la cartera, se guarda con ella y lo leerán los avisos; el perfil elegido es de la sesión, sirve para
   * mirar la cartera contra otro perfil («¿y si fuera un 6?») y nunca se guarda. Si mirar cambiara el dato,
   * una consulta dejaría la cartera con cambios sin guardar y, al pulsar «Guardar», con otro nivel.
   *
   * Sin nivel no se arrastra nada. Al sustituir la cartera el perfil elegido ya se ha olvidado
   * (`olvidarTrabajoDeCartera`, decisión 14: el perfil de un cliente no es el del siguiente), y quitar el
   * nivel en los controles deja el perfil elegido como esté: «Sin definir» no es ningún perfil.
   */
  function arrastrarAlPerfilElegido(nivel: number | undefined) {
    const perfil = perfilElegidoDelNivel(nivel);
    if (perfil) perfilEnSesion.write(perfil);
  }

  function fijarPerfilYHorizonte(valor: PerfilYHorizonte) {
    if (valor.risk_profile_level !== perfilYHorizonte.risk_profile_level) arrastrarAlPerfilElegido(valor.risk_profile_level);
    setPerfilYHorizonte(valor);
  }

  function sustituir(contenido: ContenidoDeCartera, guardada: BdbSavedLocalPortfolio | null = null) {
    olvidarTrabajoDeCartera();
    arrastrarAlPerfilElegido(contenido.perfilYHorizonte?.risk_profile_level);
    setPositions(contenido.positions);
    setCapital(contenido.capital);
    setNombre(contenido.nombre);
    /* Otra cartera trae los suyos o ninguno: los de la anterior no pasan a la siguiente. */
    setPerfilYHorizonte(contenido.perfilYHorizonte ?? {});
    setAbierta(guardada ? abiertaDesde(guardada, contenido) : null);
    setGeneracion((actual) => actual + 1);
  }

  async function guardar(peticion: { nombre?: string; comoNueva?: boolean } = {}): Promise<ResultadoDeGuardar> {
    const nombreFinal = (peticion.nombre ?? nombre).trim();
    setGuardando(true);
    try {
      /* Diferido: esto arrastra el acceso a la base, y solo hace falta al pulsar. */
      const { comprobarLaGuardada, guardarCartera } = await import("../core/guardarCartera");
      /* DIS-03: antes de sobrescribir la abierta, se mira si alguien la ha cambiado o eliminado desde que se
         abrió. Si es así, no se pisa en silencio: se pregunta. */
      const sinGuardarNada = { ok: false, mensaje: "No se ha guardado. La cartera guardada sigue como estaba, y lo de la pantalla sigue sin guardar." };
      let comoNueva = Boolean(peticion.comoNueva);
      /* «Sobrescribir de todos modos»: el asesor ya ha decidido pisarla, y se guarda sin condición. */
      let forzar = false;
      if (!comoNueva && abierta) {
        const { estado: leido } = await comprobarLaGuardada(sourceKind, abierta);
        const deFuera = guardadasFuera.current.get(abierta.portfolio_id);
        const estado = leido === "igual" && deFuera !== undefined && deFuera !== abierta.updated_at ? "cambiada" : leido;
        if (estado !== "igual") {
          const eleccion = await preguntarAnteLaGuardadaCambiada(estado);
          if (eleccion === "cancelar") return sinGuardarNada;
          comoNueva = eleccion === "nueva";
          forzar = eleccion === "sobrescribir";
        }
      }
      /* Sobre la abierta, `guardarCartera` manda su fecha de modificación como condición, salvo con `forzar`. */
      const pedirGuardado = () =>
        guardarCartera({
          sourceKind,
          nombre: nombreFinal,
          positions,
          capital,
          sobre: comoNueva ? null : abierta,
          forzar,
          perfilYHorizonte
        });
      let resultado = await pedirGuardado();
      /* Lo que se ha colado entre la comprobación y el guardado lo rechaza el servidor: la misma pregunta. */
      if (!resultado.ok && resultado.conflicto) {
        const eleccion = await preguntarAnteLaGuardadaCambiada(resultado.conflicto);
        if (eleccion === "cancelar") return sinGuardarNada;
        comoNueva = eleccion === "nueva";
        forzar = eleccion === "sobrescribir";
        resultado = await pedirGuardado();
      }
      if (resultado.ok) {
        setNombre(nombreFinal);
        /* La huella sale de lo que se ha guardado: si una posición no invertible se ha quedado fuera, lo
           de la pantalla no coincide con lo guardado, y decirlo es lo cierto. Lo mismo el perfil y el
           horizonte: si el servidor no los devuelve (unas Functions sin desplegar), no se han guardado. */
        setAbierta(
          abiertaDesde(resultado.cartera, {
            positions: resultado.positions,
            capital,
            nombre: nombreFinal,
            perfilYHorizonte: { risk_profile_level: resultado.cartera.risk_profile_level, horizon_years: resultado.cartera.horizon_years }
          })
        );
      }
      return resultado;
    } catch {
      return { ok: false, mensaje: "No se ha podido guardar. Inténtalo de nuevo." };
    } finally {
      setGuardando(false);
    }
  }

  const dialogo = pendiente ? (
    <Suspense fallback={null}>
      <CambiosSinGuardarDialog
        error={errorAlGuardar}
        guardando={guardando}
        nombre={nombre}
        sinPosiciones={positions.length === 0}
        avisoAlGuardar={avisoAlGuardar}
        onContinuar={() => {
          setPendiente(null);
          setAvisoAlGuardar(null);
          pendiente.accion();
        }}
        onCancelar={() => {
          setPendiente(null);
          setAvisoAlGuardar(null);
        }}
        onDescartar={() => {
          setPendiente(null);
          pendiente.accion();
        }}
        onGuardar={(nombreParaGuardar) => {
          setErrorAlGuardar(null);
          void guardar({ nombre: nombreParaGuardar }).then((resultado) => {
            if (!resultado.ok) {
              setErrorAlGuardar(resultado.mensaje);
              return;
            }
            /* Lo guardado no es todo lo que había, o el servidor tiene algo que decir: seguir sin decirlo
               sustituiría lo de la pantalla y se perdería sin una palabra. */
            if (resultado.conAvisos) {
              setAvisoAlGuardar(resultado.mensaje);
              return;
            }
            setPendiente(null);
            pendiente.accion();
          });
        }}
      />
    </Suspense>
  ) : null;

  const preguntaAlGuardar = conflicto ? (
    <Suspense fallback={null}>
      <CarteraCambiadaDialog estado={conflicto} nombre={nombre} onElegir={elegirAnteLaGuardadaCambiada} />
    </Suspense>
  ) : null;

  return {
    abierta,
    sinGuardar,
    guardando,
    generacion,
    perfilYHorizonte,
    fijarPerfilYHorizonte,
    conGuardia,
    sustituir,
    guardar,
    dialogo: (
      <>
        {dialogo}
        {preguntaAlGuardar}
      </>
    )
  };
}
