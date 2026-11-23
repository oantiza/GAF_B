export type AppErrorKind = "AUTH" | "NETWORK" | "BACKEND";

export class AppError extends Error {
  kind: AppErrorKind;
  /**
   * Detalle técnico (mensaje original del SDK o del backend, en inglés casi
   * siempre). Nunca es el texto principal del banner: se enseña plegado.
   */
  detail?: string;
  /** La petición pasa de un tope del servidor: no es un fallo pasajero y reintentar no lo cambia. */
  limite?: boolean;

  constructor(kind: AppErrorKind, message: string, options?: { cause?: unknown; detail?: string; limite?: boolean }) {
    super(message);
    this.name = "AppError";
    this.kind = kind;
    if (options && "cause" in options) {
      this.cause = options.cause;
    }
    if (options?.detail) {
      this.detail = options.detail;
    }
    if (options?.limite) {
      this.limite = true;
    }
  }
}

/* 10-11-2026. Un tope del servidor (`_cap_list` en functions_python/main.py) llega como `invalid-argument` con
   «Maximo 40 posiciones por peticion; llegan 47.». Se leía como «La petición contiene un dato no válido» y la pantalla
   ofrecía reintentar, que no arregla nada. Aquí se traduce una vez para todas las pantallas: el límite y cuántas hay. */
const TOPE_DEL_SERVIDOR = /M[aá]ximo (\d+) (\S+) por petici[oó]n; llegan (\d+)/;
const LIMITE_PROPIO = /^El cálculo admite \d+ \S+ como máximo y /;

function textoDelLimite(maximo: number, que: string, cantidad: number): string {
  const quien = que === "posiciones" ? "esta cartera tiene" : "se han pedido";
  return `El cálculo admite ${maximo} ${que} como máximo y ${quien} ${cantidad}. No es un fallo pasajero: reintentar no lo cambia.`;
}

/** Si el error es un tope del servidor, la frase que lo dice; si no, null. Acepta el error del SDK, un AppError o su texto. */
export function limiteDelCalculo(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  if (error instanceof AppError && error.limite) return error.message;
  const texto = typeof error === "string" ? error.trim()
    : typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "";
  if (LIMITE_PROPIO.test(texto)) return sinEstadoHttp(texto);
  const detalle = error instanceof AppError ? error.detail ?? "" : texto;
  const tope = TOPE_DEL_SERVIDOR.exec(detalle);
  return tope ? textoDelLimite(Number(tope[1]), tope[2], Number(tope[3])) : null;
}

function codeOf(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code.toLowerCase();
  }
  return "";
}

/* Auditoría 16-10 (revisión): un error que llega como TEXTO también lleva su
   causa. `usePortfolioHorizon` guarda `error.message` y lo pasaba a
   AsyncErrorBanner; aquí se perdía y el banner decía el genérico «No se pudo
   completar la operación.» en vez de, p. ej., «El histórico no cubre el periodo
   completo seleccionado.». */
function messageOf(error: unknown): string {
  if (typeof error === "string") return error.trim();
  return error instanceof Error ? error.message : "";
}

/**
 * U-06. Texto propio en castellano por código de Firebase. El mensaje del SDK
 * («Missing or insufficient permissions.», «Failed to fetch») no es para el
 * cliente: queda como `detail` plegado en el banner y como `cause`.
 */
export const MENSAJE_GENERICO_PRECONDICION = "La operación no se puede ejecutar en el estado actual de los datos.";

const FIREBASE_CODE_MESSAGES: Array<{ code: string; kind: AppErrorKind; message: string }> = [
  { code: "permission-denied", kind: "AUTH", message: "Tu cuenta no tiene permiso para esta operación." },
  { code: "unauthenticated", kind: "AUTH", message: "Necesitas iniciar sesión para continuar." },
  { code: "unavailable", kind: "NETWORK", message: "El servicio no está disponible en este momento. Reinténtalo en unos segundos." },
  { code: "deadline-exceeded", kind: "NETWORK", message: "El servicio ha tardado demasiado en responder. Reinténtalo en unos segundos." },
  { code: "failed-precondition", kind: "BACKEND", message: MENSAJE_GENERICO_PRECONDICION },
  { code: "invalid-argument", kind: "BACKEND", message: "La petición contiene un dato no válido." },
  { code: "not-found", kind: "BACKEND", message: "El recurso solicitado no existe." },
  { code: "resource-exhausted", kind: "BACKEND", message: "Se ha superado el límite de uso del servicio. Espera unos minutos y reinténtalo." },
  { code: "internal", kind: "BACKEND", message: "El servicio ha fallado internamente. Reinténtalo en unos segundos." }
];

/** ¿Mensaje del navegador/SDK que delata un fallo de red? */
function looksLikeNetworkFailure(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("network") || lower.includes("failed to fetch") || lower.includes("load failed");
}

const NETWORK_MESSAGE = "No hay conexión con el servidor. Comprueba la red y reinténtalo.";

/* Un error que llega como texto suele ser el `message` de un AppError ya
   traducido: usePortfolioHorizon guarda `error.message`. Si es uno de nuestros
   textos, recupera también su tipo, y el banner su título («Sin conexión con el
   servidor», «Sesión requerida») en vez de «No se ha podido completar»
   (tercera revisión, 17-10). */
const KIND_BY_OWN_MESSAGE = new Map<string, AppErrorKind>([
  ...FIREBASE_CODE_MESSAGES.map((entry) => [entry.message, entry.kind] as const),
  [NETWORK_MESSAGE, "NETWORK"]
]);

/* 15-11-2026 (hallazgo 19 de la auditoría del backend). Cuando la base no contesta, las funciones de catálogo responden
   `unavailable` con un texto propio que ya está en castellano y dice lo que importa: que es pasajero y que el dato no
   falta. Ese texto es el principal; el genérico de `unavailable` hablaría de «servicio», y el título, de conexión. */
const BASE_NO_DISPONIBLE = /^No se ha podido leer la base de activos/;

/* El texto del servidor para un fallo del programa en Optimizar (`OptimizationInternalError`, functions_python). */
const ERROR_INTERNO_PROPIO = /^Error interno del optimizador:/;

/* El SDK de Functions añade el estado HTTP al final del texto que manda el servidor: « [503]», « [400]». Es del transporte, no
   del mensaje: detrás de un texto nuestro, ya claro, solo estorba. Se quita de los textos propios; en el detalle técnico de un
   fallo genérico se conserva, porque ahí sí identifica el fallo. */
const ESTADO_HTTP_AL_FINAL = /\s*\[\d{3}\]\s*$/;

/** El texto sin el estado HTTP que el SDK le pega al final. */
export function sinEstadoHttp(texto: string): string {
  return texto.replace(ESTADO_HTTP_AL_FINAL, "");
}

/** ¿El servidor ha mandado texto propio, o solo el nombre del código (lo que pone el SDK cuando no hay mensaje)? */
function textoPropioDelServidor(original: string, code: string): string | undefined {
  const texto = sinEstadoHttp(original).trim();
  if (!texto) return undefined;
  const nombre = texto.toLowerCase().replace(/_/g, "-").replace(/^functions\//, "");
  return nombre === code.replace(/^functions\//, "") || nombre === "failed-precondition" ? undefined : texto;
}

/** Las partes de un activo que el servidor puede no haber podido leer (su aviso `READ_FAILED`). */
export type ParteSinLeer = "asset" | "metrics" | "holdings";

const QUE_NO_SE_LEYO: Record<ParteSinLeer, string> = {
  asset: "la ficha",
  metrics: "las métricas",
  holdings: "las posiciones"
};

/**
 * La lectura de la base ha fallado en parte: no es que el activo no exista ni que le falte el dato, y se arregla
 * reintentando. Sirve a las pantallas que no pueden enseñar media respuesta sin que parezca completa.
 */
export function lecturaIncompleta(partes: ParteSinLeer[], assetIds: string[]): AppError {
  const que = [...new Set(partes)].map((parte) => QUE_NO_SE_LEYO[parte]);
  const lista = que.length > 1 ? `${que.slice(0, -1).join(", ")} y ${que[que.length - 1]}` : que[0] ?? "los datos";
  const de = assetIds.length === 1 ? assetIds[0] : `${assetIds.length} activos (${assetIds.join(", ")})`;
  return new AppError(
    "BACKEND",
    `No se pudo leer de la base ${lista} de ${de}. No es que no exista ni que falte el dato: vuelve a intentarlo en unos segundos.`
  );
}

export function toAppError(error: unknown, fallbackMessage = "No se pudo completar la operación."): AppError {
  if (error instanceof AppError) {
    return error;
  }
  const code = codeOf(error);
  const original = messageOf(error);
  if (code.includes("unavailable") && BASE_NO_DISPONIBLE.test(original)) {
    return new AppError("BACKEND", sinEstadoHttp(original), { cause: error });
  }
  const limite = limiteDelCalculo(error);
  if (limite) {
    return new AppError("BACKEND", limite, { cause: error, detail: original && original !== limite ? original : undefined, limite: true });
  }
  /* Un `failed-precondition` es siempre el servidor diciendo, con sus palabras y en castellano, por qué con estos datos no se
     puede («Sin solución…», el tope de activos, el generador sin base nueva). Ese texto es el que lee el asesor. */
  if (code.includes("failed-precondition")) {
    const propio = textoPropioDelServidor(original, code);
    if (propio) return new AppError("BACKEND", propio, { cause: error });
  }
  /* 20-11-2026: Optimizar distingue un fallo del programa («Error interno del optimizador…», con su referencia) de «no hay
     solución». Ese texto dice que cambiar restricciones no lo arregla, y es el que lee el asesor; el genérico de `internal`
     («Reinténtalo») no lo diría. */
  if (code.includes("internal") && ERROR_INTERNO_PROPIO.test(sinEstadoHttp(original))) {
    return new AppError("BACKEND", sinEstadoHttp(original), { cause: error });
  }
  const ownKind = typeof error === "string" ? KIND_BY_OWN_MESSAGE.get(original) : undefined;
  if (ownKind) {
    return new AppError(ownKind, original, { cause: error });
  }
  const detail = original || undefined;
  const byCode = code ? FIREBASE_CODE_MESSAGES.find((entry) => code.includes(entry.code)) : undefined;
  if (byCode) {
    return new AppError(byCode.kind, byCode.message, { cause: error, detail });
  }
  if (code.includes("network") || looksLikeNetworkFailure(original)) {
    return new AppError("NETWORK", NETWORK_MESSAGE, { cause: error, detail });
  }
  /* Sin código conocido: el mensaje suele ser nuestro (adaptadores, contratos)
     y ya está en castellano; se conserva porque es accionable (A2.3). */
  return new AppError("BACKEND", original || fallbackMessage, { cause: error });
}

/**
 * ¿El backend respondió NOT_FOUND (el recurso no existe, no es que fallara)?
 *
 * `toAppError` normaliza el tipo a "BACKEND" y pierde el código original de
 * Firebase ("functions/not-found"), que sobrevive en `cause`. Sirve para que un
 * activo ausente de la maestra sea un caso previsto (null / línea rechazada) y
 * no un error que tumbe toda la operación.
 */
export function isNotFoundError(error: unknown): boolean {
  if (codeOf(error).includes("not-found")) {
    return true;
  }
  if (error instanceof AppError && error.cause !== undefined) {
    return codeOf(error.cause).includes("not-found");
  }
  return false;
}

/**
 * ¿El backend ha dicho que con estos datos no se puede, en vez de fallar? Es su `failed-precondition`, y como `isNotFoundError`
 * el código sobrevive en `cause`. No es un fallo y no se arregla reintentando: una cartera sin ninguna serie no la tendrá
 * dentro de unos segundos.
 */
export function esFaltaDeDatos(error: unknown): boolean {
  if (codeOf(error).includes("failed-precondition")) {
    return true;
  }
  return error instanceof AppError && error.cause !== undefined && codeOf(error.cause).includes("failed-precondition");
}

/** Por qué los datos no dan, tal como lo escribe el servidor y sin el código de estado del final. Es cocina del asesor: en Modo cliente no se enseña. */
export function motivoDelServidor(error: unknown): string | undefined {
  if (!(error instanceof AppError)) return undefined;
  /* Con texto propio del servidor, el motivo es el propio mensaje; con el genérico, lo que quede en el detalle. */
  const motivo = error.detail ?? (esFaltaDeDatos(error) && error.message !== MENSAJE_GENERICO_PRECONDICION ? error.message : undefined);
  return (motivo ? sinEstadoHttp(motivo) : undefined) || undefined;
}

export function appErrorTitle(error: AppError): string {
  if (error.kind === "AUTH") {
    return "Sesión requerida";
  }
  if (error.kind === "NETWORK") {
    return "Sin conexión con el servidor";
  }
  if (error.limite) {
    return "Por encima del límite del cálculo";
  }
  return "No se ha podido completar";
}
