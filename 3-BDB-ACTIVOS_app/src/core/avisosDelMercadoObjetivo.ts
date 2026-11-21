import * as formato from "./formato";
import { textoDelHorizonte } from "./perfilYHorizonte";
import { nombreDelNivel } from "./textoDelNivelDePerfil";

/**
 * Los avisos que cruzan la cartera modelo con el mercado objetivo que declara el fabricante de cada fondo (decisión 59 de
 * Óscar, 09-11-2026; reglas R1 a R4 de `INFORME_EMT_EET_2026-11-09.md`, «Qué comprobaría la app»; R5 no se construye).
 *
 * Es puro: entra la cartera ya leída —nivel, horizonte y, por posición, lo que dice su documento `declared/target_market`
 * con el horizonte del KID delante— y salen los avisos. Quien lee los documentos es
 * `src/adapters/mercadoObjetivoDeLaCartera.ts`; quien los pinta, `AvisosDelMercadoObjetivo.tsx`.
 *
 * **Todos son informativos**, como el resto del perfil (`PREVIEW_ONLY`): no bloquean nada ni dictaminan idoneidad. Dicen
 * qué declara el fabricante frente a lo que el asesor ha definido para la cartera, con el peso de la posición al lado.
 *
 * - **R1.** El horizonte de la cartera es menor que el del fondo. Solo con años: un código de plazo (V/S/M/L/H) no se
 *   convierte en años, porque sería inventar la cifra. Sin horizonte en la cartera no hay R1 (decisión 59: no se deduce).
 * - **R2.** El fabricante dice NO al cliente minorista o al conocimiento básico. NEUTRAL no es NO, y ausente tampoco.
 * - **R3.** El mercado objetivo tiene más de 12 meses.
 * - **R4.** Una sola nota de cartera, si su nivel es el 1: cuántas posiciones no son para quien no puede asumir pérdidas
 *   (`loss_capacity.no_loss = NO`). Por posición avisaría de casi todo: en los 23 ETF medidos, todos dicen NO.
 *
 * **Decisión B-66 (09-11-2026).** Una posición sin mercado objetivo pero con el horizonte del KID
 * (`declared/regulatory.recommended_holding_years`, documento regulatorio público) entra en R1, y solo en R1: R2, R3 y R4
 * siguen necesitando el EMT. Se cuenta aparte (`soloHorizonte`), para que el panel no la presente como si se hubiera
 * comprobado su mercado objetivo.
 *
 * Una posición sin nada de eso no avisa de nada y se cuenta aparte: no tener mercado objetivo no es que el fabricante
 * diga que sí. Son datos del emisor, de uso interno (decisión 53): esto es de pantalla de asesor, y ningún informe lo lee.
 */

export type RespuestaDelFabricante = "YES" | "NO" | "NEUTRAL";

/**
 * El horizonte del instrumento, como lo resuelve la ficha: el del KID manda; si no lo hay, el del fabricante en su
 * mercado objetivo, en años o en su código.
 */
export type HorizonteDelInstrumento =
  | { anos: number; fuente: "KID" | "fabricante" }
  | { codigo: string; fuente: "fabricante" };

/** Lo que la regla necesita del documento `declared/target_market`, ya leído. */
export interface MercadoObjetivoDeUnaPosicion {
  /** «iShares», «Vanguard»…, o «El fabricante» si no se sabe. */
  emisor: string;
  /** `target_market_as_of`, AAAA-MM-DD. */
  fecha?: string;
  horizonte?: HorizonteDelInstrumento;
  /** `investor_type.retail`. */
  minorista?: RespuestaDelFabricante;
  /** `knowledge.basic`. */
  conocimientoBasico?: RespuestaDelFabricante;
  /** `loss_capacity.no_loss`. */
  sinPerdidas?: RespuestaDelFabricante;
}

/**
 * Lo que se sabe del mercado objetivo de una posición. «sin-documento» es información: la base contestó y no lo tiene.
 * «sin-leer» es que no se pudo preguntar (la base no contestó, o no hay camino a ella) y no se dice igual.
 */
export type DatosDeMercadoObjetivo =
  | { estado: "documento"; mercado: MercadoObjetivoDeUnaPosicion }
  /** Decisión B-66: sin mercado objetivo, pero con los años de su KID. Solo sirve a R1. */
  | { estado: "solo-horizonte"; horizonte: { anos: number; fuente: "KID" } }
  | { estado: "sin-documento" }
  | { estado: "sin-leer" };

export interface PosicionParaAvisos {
  assetId: string;
  nombre: string;
  /** El peso de la posición en la cartera, en puntos (35 = 35 %). */
  pesoPercent: number;
  datos: DatosDeMercadoObjetivo;
}

export interface CarteraParaAvisos {
  /** Decisión 59: entero de 1 a 10, o ausente. */
  nivel?: number;
  /** Decisión 59: años, o ausente. No se deduce del nivel. */
  horizonteAnos?: number;
  posiciones: PosicionParaAvisos[];
}

export type ReglaDelMercadoObjetivo = "R1" | "R2" | "R3";

export interface AvisoDeUnaPosicion {
  regla: ReglaDelMercadoObjetivo;
  texto: string;
  /** R2 es el mercado objetivo negativo: se pinta destacado. */
  destacado: boolean;
}

export interface PosicionConAvisos {
  assetId: string;
  nombre: string;
  pesoPercent: number;
  avisos: AvisoDeUnaPosicion[];
}

export interface NotaDeLaCartera {
  texto: string;
  /** Posiciones que el fabricante no piensa para quien no puede asumir pérdidas. */
  posiciones: number;
  /** Todas las posiciones de la cartera. */
  de: number;
  /** El peso de esas posiciones, en puntos. */
  pesoPercent: number;
}

export interface AvisosDeLaCartera {
  /** Solo las posiciones que avisan de algo: primero las del mercado objetivo negativo, luego por peso. */
  posiciones: PosicionConAvisos[];
  /** R4, o nada. */
  notaDeLaCartera?: NotaDeLaCartera;
  total: number;
  /** Con mercado objetivo (EMT): R1 a R4. */
  conDocumento: number;
  /** Sin mercado objetivo y con el horizonte del KID (decisión B-66): solo R1. */
  soloHorizonte: number;
  /** Ni mercado objetivo ni horizonte del KID. */
  sinDocumento: number;
  sinLeer: number;
  /**
   * Con horizonte en la cartera: las posiciones con documento cuyo horizonte no está en años (un código, o nada), que R1
   * no puede comparar. Sin horizonte en la cartera, cero: no hay nada con qué comparar.
   */
  sinHorizonteEnAnos: number;
}

/** Diferencias menores que esta son la misma cifra escrita de otra forma (0,005 años son dos días). */
const TOLERANCIA_EN_ANOS = 0.005;

/** Si el mercado objetivo tiene más de 12 meses a `hoy`. Una fecha ilegible no caduca: no se sabe, y no se afirma. */
export function caducado(fecha: unknown, hoy: Date): boolean {
  if (typeof fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const [anio, mes, dia] = fecha.split("-").map(Number);
  /* El día que cumple un año tiene 12 meses justos; desde el siguiente, más. */
  return hoy.getTime() >= Date.UTC(anio + 1, mes - 1, dia + 1);
}

/**
 * A quién no piensa el producto el fabricante, en su mercado objetivo negativo: «clientes minoristas», «quien solo tiene
 * conocimiento básico». Vacío si no dice NO a ninguno de los dos. Lo usa también la ficha.
 */
export function aQuienNoLoPiensa(
  minorista: RespuestaDelFabricante | undefined,
  conocimientoBasico: RespuestaDelFabricante | undefined
): string[] {
  return [
    minorista === "NO" ? "clientes minoristas" : undefined,
    conocimientoBasico === "NO" ? "quien solo tiene conocimiento básico" : undefined
  ].filter((parte): parte is string => parte !== undefined);
}

function fuenteDelHorizonte(horizonte: { fuente: "KID" | "fabricante" }, emisor: string): string {
  return horizonte.fuente === "KID" ? "según su KID" : `según el mercado objetivo de ${emisor}`;
}

/** R1: solo con años en los dos lados. */
function avisoDelHorizonte(
  horizonte: HorizonteDelInstrumento | undefined,
  horizonteDeLaCartera: number | undefined,
  emisor: string
): AvisoDeUnaPosicion | undefined {
  if (horizonteDeLaCartera === undefined || !horizonte || !("anos" in horizonte)) return undefined;
  if (horizonteDeLaCartera >= horizonte.anos - TOLERANCIA_EN_ANOS) return undefined;
  return {
    regla: "R1",
    destacado: false,
    texto:
      `La cartera se ha definido a ${textoDelHorizonte(horizonteDeLaCartera)} y este fondo recomienda ` +
      `${textoDelHorizonte(horizonte.anos)}, ${fuenteDelHorizonte(horizonte, emisor)}.`
  };
}

function avisosDe(mercado: MercadoObjetivoDeUnaPosicion, horizonteDeLaCartera: number | undefined, hoy: Date): AvisoDeUnaPosicion[] {
  const avisos: AvisoDeUnaPosicion[] = [];

  const negativo = aQuienNoLoPiensa(mercado.minorista, mercado.conocimientoBasico);
  if (negativo.length > 0) {
    avisos.push({
      regla: "R2",
      destacado: true,
      texto: `${mercado.emisor} no lo piensa para ${negativo.join(" ni para ")}: es su mercado objetivo negativo.`
    });
  }

  const r1 = avisoDelHorizonte(mercado.horizonte, horizonteDeLaCartera, mercado.emisor);
  if (r1) avisos.push(r1);

  if (caducado(mercado.fecha, hoy)) {
    avisos.push({
      regla: "R3",
      destacado: false,
      texto: `Su mercado objetivo es del ${formato.oFalta(formato.fecha(mercado.fecha))}: tiene más de 12 meses, y ${mercado.emisor} puede haberlo revisado después.`
    });
  }

  return avisos;
}

const pesoEnTexto = (puntos: number) => formato.oFalta(formato.peso(puntos / 100));

/** «1 posición», «3 posiciones». */
const posiciones = (n: number) => `${n} ${n === 1 ? "posición" : "posiciones"}`;

function notaDePerdidas(cartera: CarteraParaAvisos, sinDatos: number): NotaDeLaCartera | undefined {
  if (cartera.nivel !== 1) return undefined;
  const incompatibles = cartera.posiciones.filter(
    (posicion) => posicion.datos.estado === "documento" && posicion.datos.mercado.sinPerdidas === "NO"
  );
  if (incompatibles.length === 0) return undefined;
  const de = cartera.posiciones.length;
  const pesoPercent = incompatibles.reduce((suma, posicion) => suma + posicion.pesoPercent, 0);
  const nombre = nombreDelNivel(1);
  const verbo = incompatibles.length === 1 ? "no es compatible" : "no son compatibles";
  let texto =
    `La cartera es de nivel 1${nombre ? ` (${nombre})` : ""}: ${incompatibles.length} de ${posiciones(de)} ` +
    `(${pesoEnTexto(pesoPercent)} del peso) ${verbo} con un cliente que no pueda asumir pérdidas, según su fabricante.`;
  if (sinDatos > 0) texto += ` De ${posiciones(sinDatos)} no hay mercado objetivo, y no se cuentan.`;
  return { texto, posiciones: incompatibles.length, de, pesoPercent };
}

const ORDEN_DE_LA_REGLA: Record<ReglaDelMercadoObjetivo, number> = { R2: 0, R1: 1, R3: 2 };

export function avisosDelMercadoObjetivo(cartera: CarteraParaAvisos, hoy: Date = new Date()): AvisosDeLaCartera {
  let conDocumento = 0;
  let soloHorizonte = 0;
  let sinDocumento = 0;
  let sinLeer = 0;
  let sinHorizonteEnAnos = 0;
  const conAvisos: PosicionConAvisos[] = [];

  for (const posicion of cartera.posiciones) {
    const { datos } = posicion;
    if (datos.estado === "sin-documento") {
      sinDocumento += 1;
      continue;
    }
    if (datos.estado === "sin-leer") {
      sinLeer += 1;
      continue;
    }
    if (datos.estado === "solo-horizonte") {
      soloHorizonte += 1;
      /* La fuente es siempre el KID: el emisor no llega a la frase. */
      const r1 = avisoDelHorizonte(datos.horizonte, cartera.horizonteAnos, "");
      if (r1) conAvisos.push({ assetId: posicion.assetId, nombre: posicion.nombre, pesoPercent: posicion.pesoPercent, avisos: [r1] });
      continue;
    }
    conDocumento += 1;
    if (cartera.horizonteAnos !== undefined && !(datos.mercado.horizonte && "anos" in datos.mercado.horizonte)) {
      sinHorizonteEnAnos += 1;
    }
    const avisos = avisosDe(datos.mercado, cartera.horizonteAnos, hoy).sort(
      (a, b) => ORDEN_DE_LA_REGLA[a.regla] - ORDEN_DE_LA_REGLA[b.regla]
    );
    if (avisos.length > 0) {
      conAvisos.push({ assetId: posicion.assetId, nombre: posicion.nombre, pesoPercent: posicion.pesoPercent, avisos });
    }
  }

  const negativo = (posicion: PosicionConAvisos) => posicion.avisos.some((aviso) => aviso.destacado);
  conAvisos.sort((a, b) => Number(negativo(b)) - Number(negativo(a)) || b.pesoPercent - a.pesoPercent);

  /* R4 necesita el EMT: lo que solo trae el horizonte del KID tampoco tiene mercado objetivo. */
  const notaDeLaCartera = notaDePerdidas(cartera, soloHorizonte + sinDocumento + sinLeer);
  return {
    posiciones: conAvisos,
    ...(notaDeLaCartera ? { notaDeLaCartera } : {}),
    total: cartera.posiciones.length,
    conDocumento,
    soloHorizonte,
    sinDocumento,
    sinLeer,
    sinHorizonteEnAnos
  };
}
