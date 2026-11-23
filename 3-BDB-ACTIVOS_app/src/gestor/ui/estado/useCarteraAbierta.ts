/**
 * La cartera que se está trabajando: sus cambios, deshacer y rehacer, y su guardado.
 *
 * Con carpeta, cada cambio se guarda solo en el disco al cabo de un instante. Sin carpeta
 * (navegador sin acceso a carpetas), los cambios quedan pendientes hasta que el asesor
 * descarga el fichero. La cartera de demostración no se guarda nunca.
 *
 * NO SE PIERDE TRABAJO SIN AVISAR. Mientras haya algo sin escribir (pendiente, guardando, en
 * error o sin descargar) el navegador pregunta antes de cerrar o recargar la pestaña, y al
 * ocultarse la página se escribe ya lo pendiente. Al salir de la cartera, lo pendiente se
 * escribe antes; si aun así fallase, se descarga una copia de rescate en vez de tragarse el
 * error. Si otra pestaña ha cambiado la cartera (`CONFLICTO`), no se reintenta solo: se elige
 * entre recargar lo del disco o guardar lo de esta pestaña como una cartera aparte.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorDeAlmacen, type AlmacenDeCarteras, type CodigoDeErrorDeAlmacen } from "../../almacen/almacen";
import { descargarCartera } from "../../almacen/descarga";
import { esDemostracion } from "../../demo/carteraDemo";
import { nuevoId, type Cartera } from "../../motor/modelo";

export type EstadoDeGuardado =
  /** Lo que hay en pantalla está en el disco. */
  | "guardado"
  /** Hay cambios esperando a guardarse (en un instante, solos). */
  | "pendiente"
  | "guardando"
  /** No se pudo guardar: los cambios siguen en pantalla y se reintenta al siguiente cambio o a mano. */
  | "error"
  /** Sin carpeta: los cambios están solo en pantalla hasta que se descarga el fichero. */
  | "sin-descargar"
  /** La cartera de demostración: no se guarda. */
  | "no-se-guarda";

interface Historia {
  pasado: Array<{ cartera: Cartera; accion: string }>;
  presente: Cartera;
  futuro: Array<{ cartera: Cartera; accion: string }>;
}

export interface CarteraAbierta {
  cartera: Cartera;
  guardado: EstadoDeGuardado;
  errorDeGuardado: string | null;
  /** El código del último error de guardado (`PERMISO`, `CONFLICTO`…), o `null`. */
  codigoDeError: CodigoDeErrorDeAlmacen | null;
  /** Nombre del fichero en la carpeta, cuando lo hay. */
  fichero: string | null;
  /** Lo último que se hizo y lo que se rehacería, para rotular los botones. */
  accionADeshacer: string | null;
  accionARehacer: string | null;
  /** Si se saliera ahora se perderían cambios: están sin descargar o la carpeta ha fallado. */
  cambiosQueSePerderian: boolean;
  /**
   * Aplica un cambio a la cartera. `accion` lo describe en pocas palabras: «Añadir compra».
   * Con `copiaObligada`, el guardado de este cambio copia lo que sustituye aunque la última
   * copia sea reciente: para los cambios grandes y destructivos.
   */
  cambiar(accion: string, cambio: (cartera: Cartera) => Cartera, opciones?: { copiaObligada?: boolean }): void;
  deshacer(): void;
  rehacer(): void;
  /** Guarda ya, sin esperar. Con carpeta escribe en el disco; sin ella, descarga el fichero. */
  guardarAhora(): Promise<void>;
  /** Descarga el fichero de la cartera tal como está en pantalla, haya carpeta o no. */
  descargarCopia(): void;
  /** Tras un error de permiso: vuelve a pedirlo (desde un clic) y, si se da, guarda. */
  volverADarPermiso(): Promise<void>;
  /** Tras un conflicto: pone en pantalla lo que hay en el disco. Lo de esta pestaña queda en «Deshacer». */
  recargarDelDisco(): Promise<void>;
  /** Tras un conflicto: guarda lo de esta pestaña como una cartera aparte y sigue trabajando en ella. */
  guardarComoCopia(): Promise<void>;
  /** Escribe ya lo pendiente. Devuelve si, aun así, al salir se perderían cambios. */
  prepararSalida(): Promise<boolean>;
  /** El asesor ha decidido salir sin guardar lo que falta: al cerrar la cartera no se intenta nada más. */
  descartarCambios(): void;
  /** Guarda lo de pantalla con copia obligada y lleva la cartera a la papelera. Devuelve si se retiró. */
  retirar(): Promise<boolean>;
}

/**
 * Lo que necesita saber quien saque al asesor de la cartera abierta desde fuera del gestor (el
 * menú de secciones, el cierre de sesión): si se perderían cambios y cómo evitarlo. Solo hay una
 * cartera abierta a la vez; sin ninguna, `salidaDelGestor()` devuelve `null`.
 */
export interface SalidaDelGestor {
  sePerderian: boolean;
  /** Escribe ya lo pendiente; devuelve si, aun así, se perderían cambios. */
  prepararSalida(): Promise<boolean>;
  descargarCopia(): void;
  /** Salir sin guardar lo que falta, sabiéndolo. */
  descartarCambios(): void;
}

let salidaActual: SalidaDelGestor | null = null;

/** La cartera abierta del gestor, para avisar antes de salir de ella desde fuera. */
export function salidaDelGestor(): SalidaDelGestor | null {
  return salidaActual;
}

/** Los estados en que cerrar o recargar la pestaña puede perder algo. */
const AVISAN_AL_CERRAR: ReadonlySet<EstadoDeGuardado> = new Set(["pendiente", "guardando", "error", "sin-descargar"]);

const PASOS_DE_DESHACER = 60;
const ESPERA_ANTES_DE_GUARDAR = 700;

/** Descarga una copia de rescate cuando ya no queda otra forma de conservar los cambios. */
function rescatar(cartera: Cartera, motivo: unknown): void {
  console.error("Gestor de carteras: no se han podido guardar los últimos cambios al cerrar la cartera; se descarga una copia.", motivo);
  try {
    descargarCartera(cartera);
  } catch (error) {
    console.error("Gestor de carteras: tampoco se ha podido descargar la copia.", error);
  }
}

/**
 * `migrada`: el fichero se actualizó al abrirlo desde una versión anterior del gestor. Su primer
 * guardado copia lo que sustituye, para que la versión antigua quede en las copias (GES-24).
 */
export function useCarteraAbierta(inicial: Cartera, almacen: AlmacenDeCarteras | null, ficheroInicial: string | null, opciones: { migrada?: boolean } = {}): CarteraAbierta {
  const [historia, setHistoria] = useState<Historia>({ pasado: [], presente: inicial, futuro: [] });
  const demo = esDemostracion(inicial);
  const [guardado, setGuardado] = useState<EstadoDeGuardado>(demo ? "no-se-guarda" : almacen ? "guardado" : ficheroInicial ? "guardado" : "sin-descargar");
  const [errorDeGuardado, setErrorDeGuardado] = useState<string | null>(null);
  const [codigoDeError, setCodigoDeError] = useState<CodigoDeErrorDeAlmacen | null>(null);
  const [fichero, setFichero] = useState<string | null>(ficheroInicial);
  /* La última cartera que se sabe que está en el disco: para no guardar lo que no ha cambiado. */
  const enDisco = useRef<Cartera | null>(ficheroInicial ? inicial : null);
  const presente = historia.presente;
  /* Lo que leen los avisos de salida y el cierre, que no pueden esperar a otro render. */
  const ultima = useRef(presente);
  const codigo = useRef<CodigoDeErrorDeAlmacen | null>(null);
  const temporizador = useRef<number | undefined>(undefined);
  /* El próximo guardado copia lo que sustituye aunque la última copia sea reciente (GES-10). */
  const copiaPendiente = useRef(opciones.migrada === true);
  /* Retirada o descartada a sabiendas: al cerrar la cartera no se escribe ni se descarga nada. */
  const cerrada = useRef(false);
  const original = useRef(inicial);

  const ponerError = useCallback((causa: unknown) => {
    const nuevo = causa instanceof ErrorDeAlmacen ? causa.codigo : null;
    codigo.current = nuevo;
    setCodigoDeError(nuevo);
    setErrorDeGuardado(causa instanceof Error ? causa.message : "No se ha podido guardar la cartera.");
  }, []);

  const quitarError = useCallback(() => {
    codigo.current = null;
    setCodigoDeError(null);
    setErrorDeGuardado(null);
  }, []);

  /*
   * LOS GUARDADOS VAN EN FILA (P2-12, auditoría del 20-11-2026). El automático, «Guardar ahora», el de `pagehide`, el de salir
   * y el de desmontar podían escribir a la vez el mismo fichero: si el de la versión 1 acababa después que el de la 2, en el
   * disco quedaba la 1, la pantalla decía «Guardado» y la 2 no se volvía a escribir. Ahora cada escritura espera a la anterior,
   * en el orden en que se pidieron, así que la última que se pidió —la de lo último de pantalla— es la que queda. Y al llegarle
   * el turno, si lo que iba a escribir ya está en el disco, no escribe.
   */
  const cola = useRef<Promise<unknown>>(Promise.resolve());
  const enCola = useRef(0);
  const ficheroEscrito = useRef<string | null>(ficheroInicial);
  const enFila = useCallback(<T,>(tarea: () => Promise<T>): Promise<T> => {
    const turno = cola.current.then(tarea);
    cola.current = turno.catch(() => undefined);
    return turno;
  }, []);

  /** Escribe la cartera en la carpeta, en su turno. Devuelve el fichero escrito, o `null` si no se pudo. */
  const guardar = useCallback((cartera: Cartera): Promise<string | null> => {
    if (!almacen || demo) return Promise.resolve(null);
    setGuardado("guardando");
    enCola.current += 1;
    return enFila(async () => {
      try {
        if (cartera === enDisco.current && ficheroEscrito.current !== null) return ficheroEscrito.current;
        const copiaObligada = copiaPendiente.current;
        copiaPendiente.current = false;
        try {
          const { fichero: escrito } = await almacen.guardar(cartera, { copiaObligada });
          enDisco.current = cartera;
          ficheroEscrito.current = escrito;
          setFichero(escrito);
          quitarError();
          return escrito;
        } catch (causa) {
          if (copiaObligada) copiaPendiente.current = true;
          ponerError(causa);
          setGuardado("error");
          return null;
        }
      } finally {
        enCola.current -= 1;
        /* Con la fila vacía y lo último escrito: guardado. Si mientras tanto ha habido otro cambio, sigue pendiente: lo recoge el siguiente guardado. */
        if (enCola.current === 0 && enDisco.current === cartera) setGuardado((actual) => (actual === "guardando" || actual === "error" ? "guardado" : actual));
      }
    });
  }, [almacen, demo, enFila, ponerError, quitarError]);

  /* Guardado automático: un instante después del último cambio. Tras un conflicto no se
     reintenta solo: cada intento volvería a fallar y a copiar lo del disco. */
  useEffect(() => {
    if (demo || presente === enDisco.current) return;
    if (!almacen) {
      setGuardado("sin-descargar");
      return;
    }
    if (codigo.current === "CONFLICTO") return;
    setGuardado("pendiente");
    const espera = window.setTimeout(() => {
      temporizador.current = undefined;
      void guardar(presente);
    }, ESPERA_ANTES_DE_GUARDAR);
    temporizador.current = espera;
    return () => window.clearTimeout(espera);
  }, [presente, almacen, demo, guardar]);

  useEffect(() => {
    ultima.current = presente;
  }, [presente]);

  /** Escribe ya lo pendiente, sin esperar al temporizador. Devuelve si lo de pantalla está en el disco. */
  const vaciar = useCallback(async (): Promise<boolean> => {
    window.clearTimeout(temporizador.current);
    temporizador.current = undefined;
    if (!almacen || demo || cerrada.current) return true;
    if (ultima.current === enDisco.current) return true;
    if (codigo.current === "CONFLICTO") return false;
    return (await guardar(ultima.current)) !== null;
  }, [almacen, demo, guardar]);

  /* Cerrar o recargar la pestaña con algo sin escribir: el navegador pregunta (con su propio
     texto) y, con carpeta, se escribe ya lo pendiente. Al ocultarse la página, también. */
  const avisarAlCerrar = AVISAN_AL_CERRAR.has(guardado);
  const vaciarAlSalir = useRef(vaciar);
  useEffect(() => {
    vaciarAlSalir.current = vaciar;
  }, [vaciar]);
  useEffect(() => {
    if (!avisarAlCerrar) return undefined;
    const avisar = (evento: BeforeUnloadEvent) => {
      void vaciarAlSalir.current();
      evento.preventDefault();
      evento.returnValue = "";
    };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [avisarAlCerrar]);
  useEffect(() => {
    if (!almacen || demo) return undefined;
    const alOcultar = () => void vaciarAlSalir.current();
    window.addEventListener("pagehide", alOcultar);
    return () => window.removeEventListener("pagehide", alOcultar);
  }, [almacen, demo]);

  /*
   * Al salir de la cartera con un cambio aún sin escribir, se escribe; si no se puede, se descarga una copia de rescate: el
   * error no se traga en silencio. Solo al desmontar de verdad (P2-12): antes el efecto dependía del almacén, y conectar una
   * carpeta con la cartera abierta y cambios en pantalla ejecutaba la limpieza del efecto anterior —sin carpeta— y descargaba
   * un rescate que no hacía falta, porque el guardado automático ya los escribe en la carpeta nueva. El almacén se lee del
   * último render. Y la escritura de salida va en la fila, detrás de la que estuviera en curso.
   */
  const almacenVigente = useRef(almacen);
  useEffect(() => {
    almacenVigente.current = almacen;
  }, [almacen]);
  useEffect(() => () => {
    window.clearTimeout(temporizador.current);
    const actual = ultima.current;
    const almacenAlSalir = almacenVigente.current;
    if (demo || cerrada.current) return;
    if (!almacenAlSalir) {
      /* Sin carpeta solo se rescata lo que ha cambiado desde que se abrió. */
      if (actual !== enDisco.current && actual !== original.current) rescatar(actual, "sin carpeta y sin descargar");
      return;
    }
    if (actual === enDisco.current && enCola.current === 0) return;
    if (codigo.current === "CONFLICTO") {
      rescatar(actual, "la cartera cambió fuera de esta pestaña");
      return;
    }
    void enFila(async () => {
      if (actual === enDisco.current) return;
      await almacenAlSalir.guardar(actual, { copiaObligada: copiaPendiente.current });
    }).catch((causa: unknown) => rescatar(actual, causa));
  }, [demo, enFila]);

  const cambiar = useCallback((accion: string, cambio: (cartera: Cartera) => Cartera, opciones?: { copiaObligada?: boolean }) => {
    if (opciones?.copiaObligada) copiaPendiente.current = true;
    setHistoria((actual) => {
      const siguiente = cambio(actual.presente);
      if (siguiente === actual.presente) return actual;
      return {
        pasado: [...actual.pasado.slice(-(PASOS_DE_DESHACER - 1)), { cartera: actual.presente, accion }],
        presente: { ...siguiente, modificada: new Date().toISOString() },
        futuro: []
      };
    });
  }, []);

  const deshacer = useCallback(() => {
    setHistoria((actual) => {
      const anterior = actual.pasado[actual.pasado.length - 1];
      if (!anterior) return actual;
      return {
        pasado: actual.pasado.slice(0, -1),
        presente: { ...anterior.cartera, modificada: new Date().toISOString() },
        futuro: [{ cartera: actual.presente, accion: anterior.accion }, ...actual.futuro]
      };
    });
  }, []);

  const rehacer = useCallback(() => {
    setHistoria((actual) => {
      const siguiente = actual.futuro[0];
      if (!siguiente) return actual;
      return {
        pasado: [...actual.pasado, { cartera: actual.presente, accion: siguiente.accion }],
        presente: { ...siguiente.cartera, modificada: new Date().toISOString() },
        futuro: actual.futuro.slice(1)
      };
    });
  }, []);

  const guardarAhora = useCallback(async () => {
    if (demo) return;
    if (almacen) {
      await guardar(presente);
      return;
    }
    setFichero(descargarCartera(presente));
    enDisco.current = presente;
    setGuardado("guardado");
  }, [almacen, demo, guardar, presente]);

  const descargarCopia = useCallback(() => {
    if (demo) return;
    if (!almacen) {
      void guardarAhora();
      return;
    }
    descargarCartera(presente);
  }, [almacen, demo, guardarAhora, presente]);

  const volverADarPermiso = useCallback(async () => {
    if (!almacen?.pedirPermiso) return;
    const concedido = await almacen.pedirPermiso().catch(() => false);
    if (!concedido) {
      setErrorDeGuardado("El navegador no ha dado permiso para la carpeta de carteras. Vuelve a intentarlo, o descarga una copia ahora para no perder los cambios.");
      return;
    }
    await guardar(ultima.current);
  }, [almacen, guardar]);

  /* Recargar y guardar como copia cambian lo que se sabe del disco: van en la fila, para que un guardado en curso no lo pise al acabar. */
  const recargarDelDisco = useCallback(async () => {
    if (!almacen) return;
    window.clearTimeout(temporizador.current);
    await enFila(async () => {
      const id = ultima.current.id;
      try {
        /* Primero el fichero conocido; si ya no es de esta cartera (otra pestaña la renombró), se busca por id. */
        let leida = fichero ? await almacen.abrir(fichero).catch(() => null) : null;
        let en = fichero;
        if (leida?.cartera.id !== id) {
          const resumen = (await almacen.listar()).find((r) => r.id === id && r.error === undefined);
          if (!resumen) throw new ErrorDeAlmacen("NO_ENCONTRADO", "No se encuentra esta cartera en la carpeta: puede que la hayan retirado o renombrado desde otra pestaña o desde otro equipo.");
          leida = await almacen.abrir(resumen.fichero);
          en = resumen.fichero;
        }
        const delDisco = leida.cartera;
        enDisco.current = delDisco;
        ficheroEscrito.current = en;
        copiaPendiente.current = false;
        setHistoria((actual) => ({
          pasado: [...actual.pasado.slice(-(PASOS_DE_DESHACER - 1)), { cartera: actual.presente, accion: "Recargar la versión del disco" }],
          presente: delDisco,
          futuro: []
        }));
        setFichero(en);
        quitarError();
        setGuardado("guardado");
      } catch (causa) {
        ponerError(causa);
      }
    });
  }, [almacen, enFila, fichero, ponerError, quitarError]);

  const guardarComoCopia = useCallback(async () => {
    if (!almacen || demo) return;
    window.clearTimeout(temporizador.current);
    setGuardado("guardando");
    await enFila(async () => {
      const actual = ultima.current;
      const copia: Cartera = { ...actual, id: nuevoId(), nombre: `${actual.nombre} (copia)`, modificada: new Date().toISOString() };
      try {
        const { fichero: escrito } = await almacen.guardar(copia);
        enDisco.current = copia;
        ficheroEscrito.current = escrito;
        copiaPendiente.current = false;
        /* El «Deshacer» de antes era de la otra cartera: se empieza de cero con la nueva. */
        setHistoria({ pasado: [], presente: copia, futuro: [] });
        setFichero(escrito);
        quitarError();
        setGuardado("guardado");
      } catch (causa) {
        ponerError(causa);
        setGuardado("error");
      }
    });
  }, [almacen, demo, enFila, ponerError, quitarError]);

  const prepararSalida = useCallback(async (): Promise<boolean> => {
    if (demo || cerrada.current) return false;
    if (!almacen) return ultima.current !== enDisco.current && guardado === "sin-descargar";
    return !(await vaciar());
  }, [almacen, demo, guardado, vaciar]);

  const descartarCambios = useCallback(() => {
    window.clearTimeout(temporizador.current);
    cerrada.current = true;
  }, []);

  const retirar = useCallback(async (): Promise<boolean> => {
    if (!almacen || demo) return false;
    window.clearTimeout(temporizador.current);
    /* Lo de pantalla se escribe antes, copiando lo que sustituye: a la papelera va todo. */
    copiaPendiente.current = true;
    const escrito = await guardar(ultima.current);
    if (escrito === null) return false;
    try {
      await almacen.retirar(escrito);
      cerrada.current = true;
      return true;
    } catch (causa) {
      setErrorDeGuardado(causa instanceof Error ? causa.message : "No se ha podido retirar la cartera.");
      return false;
    }
  }, [almacen, demo, guardar]);

  const cambiosQueSePerderian = guardado === "error" || guardado === "sin-descargar";

  /* Lo que se publica para quien saque al asesor de la cartera desde fuera del gestor. */
  useEffect(() => {
    const salida: SalidaDelGestor = { sePerderian: cambiosQueSePerderian, prepararSalida, descargarCopia, descartarCambios };
    salidaActual = salida;
    return () => {
      if (salidaActual === salida) salidaActual = null;
    };
  }, [cambiosQueSePerderian, prepararSalida, descargarCopia, descartarCambios]);

  return {
    cartera: presente,
    guardado,
    errorDeGuardado,
    codigoDeError,
    fichero,
    accionADeshacer: historia.pasado[historia.pasado.length - 1]?.accion ?? null,
    accionARehacer: historia.futuro[0]?.accion ?? null,
    cambiosQueSePerderian,
    cambiar,
    deshacer,
    rehacer,
    guardarAhora,
    descargarCopia,
    volverADarPermiso,
    recargarDelDisco,
    guardarComoCopia,
    prepararSalida,
    descartarCambios,
    retirar
  };
}
