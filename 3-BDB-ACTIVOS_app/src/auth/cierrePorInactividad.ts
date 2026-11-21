/**
 * El cierre de sesión por inactividad. Decisión 46 de Óscar (05-11-2026): una sesión que nadie cierra sigue abierta, con
 * carteras de clientes a la vista, así que a los 30 minutos sin usar la aplicación se cierra, con aviso un minuto antes.
 * Lo que no esté guardado se pierde si nadie responde: es la consecuencia que aceptó.
 *
 * Aquí está la lógica, sin React y sin el navegador, para poder probarla con un reloj falso: el vigilante recibe la hora y
 * el almacén, y `VigilanteDeInactividad.tsx` le pasa los eventos de verdad.
 *
 * **Se mide con la hora del sistema, no con cuánto ha corrido un temporizador.** Con el portátil dormido los temporizadores
 * se paran; la hora, no. Por eso lo primero que se hace con cualquier señal, también con el ratón que se mueve al volver, es
 * mirar si ya han pasado los 30 minutos: si no, ese mismo movimiento contaría como actividad y salvaría la sesión.
 *
 * **En el almacén solo hay una hora.** Es lo que comparten las pestañas de la misma sesión para que no se cierre una porque
 * la otra está en uso. Ningún dato de un cliente ni del asesor. Al salir con «Salir» se borra; al cerrarse por inactividad se
 * queda, caducada, y por eso la pantalla de acceso sabe qué decir, también si se recarga.
 */

export const TIEMPOS_DE_INACTIVIDAD = {
  cierreMs: 30 * 60 * 1000,
  avisoAntesMs: 60 * 1000,
  /** Cada cuánto se mira la hora. Es lo que tarda como mucho en salir el aviso o en cerrarse tras dormir el portátil. */
  latidoMs: 1000,
  /** Cada cuánto, como mucho, se escribe la hora en el almacén: el ratón da decenas de señales por segundo. */
  escrituraCadaMs: 5000
} as const;

export type TiemposDeInactividad = typeof TIEMPOS_DE_INACTIVIDAD;

export const CLAVE_ULTIMA_ACTIVIDAD = "bdb-activos.ultima-actividad.v1";

export type FaseDeInactividad = { fase: "en-uso" } | { fase: "aviso"; restanteMs: number } | { fase: "cerrar" };

/** En qué punto está una sesión cuya última actividad fue a `ultimaActividad`. */
export function faseDeInactividad(
  ahora: number,
  ultimaActividad: number,
  tiempos: Pick<TiemposDeInactividad, "cierreMs" | "avisoAntesMs"> = TIEMPOS_DE_INACTIVIDAD
): FaseDeInactividad {
  /* Una hora futura es un reloj que ha ido hacia atrás: no ha pasado tiempo, y no puede salir un plazo mayor de 30 minutos. */
  const restanteMs = tiempos.cierreMs - Math.max(0, ahora - ultimaActividad);
  if (restanteMs <= 0) return { fase: "cerrar" };
  return restanteMs <= tiempos.avisoAntesMs ? { fase: "aviso", restanteMs } : { fase: "en-uso" };
}

/** Los segundos que enseña la cuenta atrás: hacia arriba, para que no diga 0:00 mientras quede tiempo. */
export const segundosDeCuentaAtras = (restanteMs: number): number => Math.ceil(restanteMs / 1000);

/** «1:00», «0:59», «0:05». */
export function cuentaAtras(segundos: number): string {
  const enteros = Math.max(0, Math.trunc(segundos));
  return `${Math.floor(enteros / 60)}:${String(enteros % 60).padStart(2, "0")}`;
}

/** Lo poco que se le pide al almacén. Puede no haberlo: el navegador puede tenerlo bloqueado. */
export type AlmacenDeActividad = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function almacenDelNavegador(): AlmacenDeActividad | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function leerUltimaActividad(almacen: AlmacenDeActividad | null): number | null {
  try {
    const hora = Number(almacen?.getItem(CLAVE_ULTIMA_ACTIVIDAD) ?? Number.NaN);
    return Number.isFinite(hora) && hora > 0 ? hora : null;
  } catch {
    return null;
  }
}

export function escribirUltimaActividad(almacen: AlmacenDeActividad | null, hora: number): void {
  try {
    almacen?.setItem(CLAVE_ULTIMA_ACTIVIDAD, String(hora));
  } catch {
    /* Sin almacén, cada pestaña cuenta por su cuenta. El cierre sigue funcionando. */
  }
}

export function olvidarUltimaActividad(almacen: AlmacenDeActividad | null): void {
  try {
    almacen?.removeItem(CLAVE_ULTIMA_ACTIVIDAD);
  } catch {
    /* Nada que olvidar. */
  }
}

/** Si la última actividad guardada ya lleva 30 minutos: la sesión que venía de antes no se abre, y el acceso lo dice. */
export function haCaducadoLaSesion(
  ahora: number,
  almacen: AlmacenDeActividad | null,
  tiempos: Pick<TiemposDeInactividad, "cierreMs" | "avisoAntesMs"> = TIEMPOS_DE_INACTIVIDAD
): boolean {
  const ultima = leerUltimaActividad(almacen);
  return ultima !== null && faseDeInactividad(ahora, ultima, tiempos).fase === "cerrar";
}

export interface Vigilante {
  /** Teclado, ratón, toque o volver a la pestaña. Mientras se avisa no cuenta: solo cuenta responder al aviso. */
  actividad(): void;
  /** Mira la hora. No cuenta como actividad: lo llama un temporizador. */
  comprobar(): void;
  /** La respuesta al aviso. Si ya han pasado los 30 minutos, llega tarde: se cierra igual. */
  seguirAqui(): void;
  /** Escribe la hora que quedaba por escribir: la pestaña se va y las otras tienen que saberla. */
  volcar(): void;
}

export function crearVigilante(opciones: {
  ahora: () => number;
  almacen: AlmacenDeActividad | null;
  /** Los segundos de la cuenta atrás, o `null` si no hay que avisar. Solo se llama cuando cambian. */
  alAvisar: (segundos: number | null) => void;
  alCerrar: () => void;
  tiempos?: TiemposDeInactividad;
}): Vigilante {
  const { ahora, almacen, alAvisar, alCerrar, tiempos = TIEMPOS_DE_INACTIVIDAD } = opciones;
  const arranque = ahora();
  const guardada = leerUltimaActividad(almacen);
  /* Sin hora guardada, o con una futura, empieza a contar ahora. Una sesión con la hora ya caducada no se salva por esto:
     el min la deja como está, y la primera comprobación la cierra. */
  let ultima = guardada === null ? arranque : Math.min(guardada, arranque);
  let escrita = guardada ?? 0;
  let escritaEn = guardada === null ? 0 : arranque;
  let enPantalla: number | null = null;
  let cerrada = false;

  const escribir = (momento: number) => {
    escribirUltimaActividad(almacen, ultima);
    escrita = ultima;
    escritaEn = momento;
  };
  if (guardada !== ultima) escribir(arranque);

  /** Lo que haya escrito otra pestaña. */
  const ponerAlDia = (momento: number) => {
    const deOtraPestana = leerUltimaActividad(almacen);
    if (deOtraPestana !== null && deOtraPestana > ultima) {
      ultima = deOtraPestana;
      escrita = deOtraPestana;
    }
    if (ultima > momento) {
      /* El reloj ha ido hacia atrás. Si no se corrige, la sesión no se cerraría hasta que volviera a esa hora. */
      ultima = momento;
      escribir(momento);
    }
  };

  const avisar = (segundos: number | null) => {
    if (segundos === enPantalla) return;
    enPantalla = segundos;
    alAvisar(segundos);
  };

  const comprobar = () => {
    if (cerrada) return;
    const momento = ahora();
    ponerAlDia(momento);
    const lectura = faseDeInactividad(momento, ultima, tiempos);
    if (lectura.fase === "cerrar") {
      cerrada = true;
      avisar(null);
      alCerrar();
      return;
    }
    avisar(lectura.fase === "aviso" ? segundosDeCuentaAtras(lectura.restanteMs) : null);
    if (ultima > escrita && momento - escritaEn >= tiempos.escrituraCadaMs) escribir(momento);
  };

  return {
    comprobar,
    actividad() {
      if (cerrada) return;
      const momento = ahora();
      ponerAlDia(momento);
      if (faseDeInactividad(momento, ultima, tiempos).fase !== "en-uso") {
        comprobar();
        return;
      }
      ultima = momento;
      if (momento - escritaEn >= tiempos.escrituraCadaMs) escribir(momento);
    },
    seguirAqui() {
      if (cerrada) return;
      const momento = ahora();
      ponerAlDia(momento);
      if (faseDeInactividad(momento, ultima, tiempos).fase === "cerrar") {
        comprobar();
        return;
      }
      ultima = momento;
      escribir(momento);
      avisar(null);
    },
    volcar() {
      if (!cerrada && ultima > escrita) escribir(ahora());
    }
  };
}

/** Lo justo de un evento para decidir si lo ha hecho una persona. */
interface SenalDeEvento {
  type: string;
  isTrusted?: boolean;
  screenX?: number;
  screenY?: number;
}

/**
 * Si un evento es actividad de una persona. Lo lanzado por código no lo es, y un temporizador que lanzara uno mantendría la
 * sesión abierta para siempre. Y el navegador manda movimientos de ratón sin que nadie lo mueva cuando algo cambia debajo del
 * puntero: por eso un movimiento solo cuenta si cambia la posición. `posicion` es la última vista, y se actualiza aquí.
 */
export function esActividadDeUnaPersona(evento: SenalDeEvento, posicion: { x: number | null; y: number | null }): boolean {
  if (evento.isTrusted === false) return false;
  if (evento.type !== "pointermove") return true;
  const { screenX: x = null, screenY: y = null } = evento;
  const seHaMovido = x !== posicion.x || y !== posicion.y;
  posicion.x = x;
  posicion.y = y;
  return seHaMovido;
}
