/**
 * Carga de la plataforma los datos de mercado que necesita una cartera: precios diarios de
 * sus activos, tipos de cambio, el tipo libre de riesgo, la ficha de cada activo y lo que
 * hace falta para compararla con su referencia.
 *
 * Lo único que sale del equipo son los ISIN de los activos y las divisas que se piden. Los
 * importes, los títulos y los movimientos no viajan nunca: el cálculo ocurre aquí.
 *
 * La lectura es por años (un documento por instrumento y año) y se guarda en memoria durante
 * la sesión: abrir otra cartera con los mismos activos no vuelve a leerlos.
 */
import { anioDe, type Dia } from "../motor/fechas";
import type { Cartera } from "../motor/modelo";
import type { FichaDeActivo } from "../motor/composicion";
import { claseDeLaReferencia, FONDOS_DE_LOS_PERFILES, nombreDeLaReferencia, type EntradaDeReferencia } from "../motor/referencia";
import { ultimoHasta, type DatosDeMercado, type Punto } from "../motor/valoracion";
import { fichaDeLaTarjeta } from "./fichas";

type Documento = Record<string, unknown>;

/** Frases llanas para los códigos de error del lector de la base. */
const MOTIVOS: Record<string, string> = {
  "permission-denied": "la sesión con la plataforma de datos no tiene permiso para leerlos",
  unauthenticated: "no hay una sesión abierta con la plataforma de datos; vuelve a entrar",
  unavailable: "la plataforma de datos no responde; comprueba la conexión y pulsa «Reintentar»",
  "deadline-exceeded": "la plataforma de datos ha tardado demasiado en responder; pulsa «Reintentar»",
  "resource-exhausted": "la plataforma de datos está recibiendo demasiadas peticiones; prueba dentro de un rato",
  "not-found": "la plataforma de datos no los tiene"
};

/**
 * Por qué no se ha podido leer algo, en una frase para el asesor (GES-21). El mensaje técnico del
 * lector (en inglés, del SDK de la base) no se enseña: va al registro de la consola.
 */
export function motivoEnLlano(error: unknown): string {
  const codigo = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code).replace(/^firestore\//, "") : "";
  console.warn("Gestor de carteras: no se han podido leer datos de mercado.", error);
  return MOTIVOS[codigo] ?? "la plataforma de datos no ha respondido como se esperaba";
}

/** De dónde se leen los datos. La de la plataforma está en `plataforma.ts`; las pruebas ponen la suya. */
export interface FuenteDeMercado {
  /** El documento de un año de la serie de precios de un instrumento, o `undefined` si no existe. */
  preciosDelAnio(isin: string, anio: number): Promise<Documento | undefined>;
  /** El documento de un año de los cambios de una divisa frente al euro (unidades de divisa por 1 EUR). */
  cambiosDelAnio(divisa: string, anio: number): Promise<Documento | undefined>;
  /** El documento de un año del €STR. */
  libreDeRiesgoDelAnio(anio: number): Promise<Documento | undefined>;
  /** La tarjeta de lectura de un instrumento. */
  tarjeta(isin: string): Promise<Documento | undefined>;
}

export interface MercadoCargado {
  datos: DatosDeMercado;
  fichas: Map<string, FichaDeActivo>;
  /**
   * Lo que hace falta para comparar con la referencia elegida. La de una cartera de referencia
   * depende del primer día del periodo, así que aquí van sus dos series y sus pesos, y la serie
   * se construye con el periodo (`serieDeLaReferencia`).
   */
  referencia?: EntradaDeReferencia;
  /** Lo que no se pudo leer, en lenguaje llano. La cartera se valora igual con lo que haya. */
  avisos: string[];
  /** Último día con precio de algún activo: hasta dónde llegan los datos. */
  ultimoDato?: Dia;
}

/** Divisas que cotizan en céntimos de otra: su cambio es el de la divisa mayor por cien. */
const DIVISAS_MENORES: Record<string, { mayor: string; factor: number }> = {
  GBX: { mayor: "GBP", factor: 100 },
  GBp: { mayor: "GBP", factor: 100 }
};

const enCurso = new Map<string, Promise<Documento | undefined>>();

/** Lee una vez por sesión. Un fallo no se guarda, para que reintentar vuelva a leer de verdad. */
function unaVez(clave: string, leer: () => Promise<Documento | undefined>): Promise<Documento | undefined> {
  const guardada = enCurso.get(clave);
  if (guardada) return guardada;
  const lectura = leer().catch((error: unknown) => {
    enCurso.delete(clave);
    throw error;
  });
  enCurso.set(clave, lectura);
  return lectura;
}

/** Entre pruebas, y al cerrar la sesión. */
export function olvidarMercado(): void {
  enCurso.clear();
}

function puntosDe(documento: Documento | undefined): Punto[] {
  const puntos = documento?.points;
  if (!Array.isArray(puntos)) return [];
  const salida: Punto[] = [];
  for (const punto of puntos as Array<Record<string, unknown>>) {
    const fecha = punto?.date;
    const valor = typeof punto?.value === "string" ? Number(punto.value) : punto?.value;
    if (typeof fecha === "string" && typeof valor === "number" && Number.isFinite(valor)) salida.push({ fecha, valor });
  }
  return salida;
}

function anios(desde: number, hasta: number): number[] {
  const lista: number[] = [];
  for (let anio = desde; anio <= hasta; anio += 1) lista.push(anio);
  return lista;
}

async function serieDeAnios(leer: (anio: number) => Promise<Documento | undefined>, desde: number, hasta: number): Promise<{ puntos: Punto[]; documentos: Documento[] }> {
  const documentos = (await Promise.all(anios(desde, hasta).map(leer))).filter((documento): documento is Documento => documento !== undefined);
  const puntos = documentos.flatMap(puntosDe).sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
  return { puntos, documentos };
}

/** El primer año en que la cartera necesita datos de cada activo y de cada divisa. */
function necesidades(cartera: Cartera): { porActivo: Map<string, number>; primerAnio: number | undefined } {
  const porActivo = new Map<string, number>();
  let primerAnio: number | undefined;
  for (const movimiento of cartera.movimientos) {
    const anio = anioDe(movimiento.fechaOperacion);
    if (primerAnio === undefined || anio < primerAnio) primerAnio = anio;
    for (const activoId of [movimiento.activoId, movimiento.destino?.activoId]) {
      if (!activoId) continue;
      const previo = porActivo.get(activoId);
      if (previo === undefined || anio < previo) porActivo.set(activoId, anio);
    }
  }
  return { porActivo, primerAnio };
}

export async function cargarMercado(cartera: Cartera, hasta: Dia, fuente: FuenteDeMercado): Promise<MercadoCargado> {
  const avisos: string[] = [];
  const base = cartera.divisaBase;
  const anioFinal = anioDe(hasta);
  const { porActivo, primerAnio } = necesidades(cartera);
  const datos: DatosDeMercado = { precios: new Map(), cambios: new Map(), ajustadasPorDividendos: new Set() };
  const fichas = new Map<string, FichaDeActivo>();
  let ultimoDato: Dia | undefined;
  if (primerAnio === undefined) return { datos, fichas, avisos };
  /* Un año antes del primer movimiento: hace falta un precio en o antes de su fecha. */
  const desdeElAnio = primerAnio - 1;

  /* 1. Precios y ficha de cada activo del catálogo. */
  const delCatalogo = cartera.activos.filter((activo) => activo.origen === "catalogo" && activo.isin && porActivo.has(activo.id));
  const sinSerie: string[] = [];
  /* Las series que la plataforma tiene en una divisa distinta de aquella en la que se anotó el activo. */
  const enOtraDivisa: Array<{ activo: (typeof delCatalogo)[number]; divisa: string }> = [];
  await Promise.all(delCatalogo.map(async (activo) => {
    const isin = activo.isin!;
    try {
      const [serie, tarjeta] = await Promise.all([
        serieDeAnios((anio) => unaVez(`precios:${isin}:${anio}`, () => fuente.preciosDelAnio(isin, anio)), (porActivo.get(activo.id) ?? primerAnio) - 1, anioFinal),
        unaVez(`tarjeta:${isin}`, () => fuente.tarjeta(isin))
      ]);
      if (serie.puntos.length > 0) {
        datos.precios.set(activo.id, serie.puntos);
        const ultimo = serie.puntos[serie.puntos.length - 1].fecha;
        if (!ultimoDato || ultimo > ultimoDato) ultimoDato = ultimo;
        /* La serie de mercado de una acción o un ETF viene ajustada por dividendos y splits; el valor liquidativo de un fondo, no. */
        if (serie.documentos.some((documento) => documento.price_class === "MARKET_PRICE")) datos.ajustadasPorDividendos!.add(activo.id);
        const divisaDeLaSerie = serie.documentos.map((documento) => documento.currency).find((divisa): divisa is string => typeof divisa === "string");
        if (divisaDeLaSerie && divisaDeLaSerie !== activo.divisa) enOtraDivisa.push({ activo, divisa: divisaDeLaSerie });
      } else sinSerie.push(activo.nombre);
      if (tarjeta) fichas.set(activo.id, fichaDeLaTarjeta(tarjeta));
    } catch (error) {
      avisos.push(`No se han podido leer los precios de ${activo.nombre}: ${motivoEnLlano(error)}.`);
    }
  }));
  if (sinSerie.length > 0) avisos.push(`La plataforma no tiene serie de precios de: ${sinSerie.join(", ")}. Se valoran con sus precios a mano o con el de su última operación.`);

  /* 2. Tipos de cambio de cada divisa que aparece, frente a la divisa base. */
  const divisas = new Set<string>();
  for (const activo of cartera.activos) if (porActivo.has(activo.id)) divisas.add(activo.divisa);
  for (const { divisa } of enOtraDivisa) divisas.add(divisa);
  for (const movimiento of cartera.movimientos) {
    if (movimiento.divisa) divisas.add(movimiento.divisa);
    if (movimiento.destino?.divisa) divisas.add(movimiento.destino.divisa);
  }
  divisas.delete(base);
  const frenteAlEuro = new Map<string, Punto[]>();
  const leerFrenteAlEuro = async (divisa: string): Promise<Punto[]> => {
    if (divisa === "EUR") return [];
    const previa = frenteAlEuro.get(divisa);
    if (previa) return previa;
    const menor = DIVISAS_MENORES[divisa];
    const real = menor?.mayor ?? divisa;
    const { puntos } = await serieDeAnios((anio) => unaVez(`cambios:${real}:${anio}`, () => fuente.cambiosDelAnio(real, anio)), desdeElAnio, anioFinal);
    const serie = menor ? puntos.map((punto) => ({ fecha: punto.fecha, valor: punto.valor * menor.factor })) : puntos;
    frenteAlEuro.set(divisa, serie);
    return serie;
  };
  /** Unidades de `divisa` por 1 de la base, día a día. Vacía si la plataforma no tiene el cambio. */
  const frenteALaBase = async (divisa: string): Promise<Punto[]> => {
    const propia = await leerFrenteAlEuro(divisa);
    if (base === "EUR") return propia;
    /* Divisa por 1 de base = (divisa por EUR) / (base por EUR). */
    const deLaBase = await leerFrenteAlEuro(base);
    if (divisa === "EUR") return deLaBase.filter((punto) => punto.valor > 0).map((punto) => ({ fecha: punto.fecha, valor: 1 / punto.valor }));
    const serie: Punto[] = [];
    for (const punto of propia) {
      const enBase = ultimoHasta(deLaBase, punto.fecha);
      if (enBase && enBase.valor > 0) serie.push({ fecha: punto.fecha, valor: punto.valor / enBase.valor });
    }
    return serie;
  };
  const sinCambio: string[] = [];
  let cambiosIlegibles: string | undefined;
  await Promise.all([...divisas].map(async (divisa) => {
    try {
      const serie = await frenteALaBase(divisa);
      if (serie.length > 0) datos.cambios.set(divisa, serie);
      else sinCambio.push(divisa);
    } catch (error) {
      cambiosIlegibles = motivoEnLlano(error);
      sinCambio.push(divisa);
    }
  }));
  if (sinCambio.length > 0) {
    avisos.push(
      cambiosIlegibles
        ? `No se han podido leer los tipos de cambio diarios (${sinCambio.join(", ")}). Lo que está en esas divisas se valora con el cambio de sus propias operaciones.`
        : `La plataforma no tiene tipos de cambio de ${sinCambio.join(", ")}. Lo que está en esas divisas se valora con el cambio de sus propias operaciones.`
    );
  }

  /*
   * Un mismo ETF cotiza en varias divisas y la plataforma guarda una sola línea: quien lo compró en dólares
   * tiene el activo en USD y la serie en EUR. Es el mismo fondo, así que su precio vale: se lleva a la divisa
   * del activo con el cambio de cada día. Sin ese cambio no se puede, y la serie no se usa.
   */
  for (const { activo, divisa } of enOtraDivisa) {
    const deLaSerie = divisa === base ? undefined : datos.cambios.get(divisa);
    const delActivo = activo.divisa === base ? undefined : datos.cambios.get(activo.divisa);
    const convertidos: Punto[] = [];
    if ((divisa === base || deLaSerie) && (activo.divisa === base || delActivo)) {
      for (const punto of datos.precios.get(activo.id) ?? []) {
        const origen = deLaSerie ? ultimoHasta(deLaSerie, punto.fecha)?.valor : 1;
        const destino = delActivo ? ultimoHasta(delActivo, punto.fecha)?.valor : 1;
        if (origen && origen > 0 && destino && destino > 0) convertidos.push({ fecha: punto.fecha, valor: (punto.valor * destino) / origen });
      }
    }
    /* Solo los activos del catálogo traen serie, y no los anota el asesor: llevan la divisa de su ficha, que en dieciséis
       instrumentos no es la de su serie. El aviso dice de dónde sale cada divisa (decisión A-199, 20-11-2026). */
    const deDondeSale = `su ficha del catálogo, en ${activo.divisa}`;
    if (convertidos.length > 0) {
      datos.precios.set(activo.id, convertidos);
      avisos.push(`La serie de precios de ${activo.nombre} está en ${divisa} y ${deDondeSale}: se ha convertido con el cambio de cada día.`);
    } else {
      datos.precios.delete(activo.id);
      datos.ajustadasPorDividendos!.delete(activo.id);
      avisos.push(`La serie de precios de ${activo.nombre} está en ${divisa} y ${deDondeSale}, y falta el tipo de cambio para convertirla: se valora con sus precios a mano o con el de su última operación.`);
    }
  }

  /* 3. Tipo libre de riesgo (€STR): solo tiene sentido con la base en euros. */
  if (base === "EUR") {
    try {
      const { puntos } = await serieDeAnios((anio) => unaVez(`estr:${anio}`, () => fuente.libreDeRiesgoDelAnio(anio)), Math.max(desdeElAnio, 2019), anioFinal);
      if (puntos.length > 0) datos.libreDeRiesgo = puntos;
    } catch {
      avisos.push("No se ha podido leer el tipo libre de riesgo (€STR): el ratio de Sharpe no se puede dar.");
    }
  }

  /* 4. La referencia: un activo, las dos series de una cartera de referencia o el €STR, en la divisa base. */
  let referencia: EntradaDeReferencia | undefined;
  if (cartera.referencia) {
    const nombre = nombreDeLaReferencia(cartera.referencia);
    /**
     * La serie de un activo del catálogo, llevada a la divisa base. Vacía si la plataforma no la tiene, o si falta el cambio
     * para convertirla (`sinCambio` dice de qué divisa).
     *
     * Cada precio se convierte con la divisa en que está su serie, la que declara cada documento (`currency`), como los de
     * las posiciones. La de la ficha solo vale si la serie no la declara. Hasta el 20-11-2026 se usaba siempre la de la
     * ficha, y un ETF que cotiza en euros con la ficha en dólares —el «MSCI ACWI» de la lista y otras quince series del
     * catálogo— dividía sus precios en euros por el cambio del dólar: con una cartera de prueba del 02-01 al 20-11-2026,
     * «su referencia» salía +24,27 % y la serie da +16,41 % (decisión de Óscar del 20-11-2026, A-195).
     */
    const serieEnLaBase = async (isin: string): Promise<{ puntos: Punto[]; nombreDelFondo?: string; sinCambio?: string }> => {
      const [serie, tarjeta] = await Promise.all([
        serieDeAnios((anio) => unaVez(`precios:${isin}:${anio}`, () => fuente.preciosDelAnio(isin, anio)), desdeElAnio, anioFinal),
        unaVez(`tarjeta:${isin}`, () => fuente.tarjeta(isin))
      ]);
      const identidad = tarjeta?.identity as Record<string, unknown> | undefined;
      const nombreDelFondo = typeof identidad?.name === "string" ? identidad.name : undefined;
      const divisaDeLaFicha = typeof identidad?.currency === "string" ? identidad.currency : undefined;
      const puntos: Punto[] = [];
      let sinCambio: string | undefined;
      for (const documento of serie.documentos) {
        const divisa = typeof documento.currency === "string" ? documento.currency : divisaDeLaFicha ?? base;
        const delDocumento = puntosDe(documento);
        if (divisa === base) {
          puntos.push(...delDocumento);
          continue;
        }
        const cambios = datos.cambios.get(divisa) ?? (await frenteALaBase(divisa));
        let convertidos = 0;
        for (const punto of delDocumento) {
          const cambio = ultimoHasta(cambios, punto.fecha);
          if (cambio && cambio.valor > 0) {
            puntos.push({ fecha: punto.fecha, valor: punto.valor / cambio.valor });
            convertidos += 1;
          }
        }
        if (convertidos === 0 && delDocumento.length > 0) sinCambio = divisa;
      }
      puntos.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
      return { puntos, nombreDelFondo, sinCambio: puntos.length === 0 ? sinCambio : undefined };
    };
    const sinComparar = (motivo: string, aviso = motivo) => {
      referencia = { nombre, motivo };
      avisos.push(aviso);
    };
    const clase = claseDeLaReferencia(cartera.referencia);
    try {
      if (clase.clase === "activo") {
        const { puntos, sinCambio: divisaSinCambio } = await serieEnLaBase(clase.isin);
        if (puntos.length > 0) referencia = { nombre, serie: puntos };
        else if (divisaSinCambio) sinComparar(`La serie de la referencia (${nombre}) está en ${divisaSinCambio} y la plataforma no tiene el tipo de cambio para llevarla a ${base}: no se puede comparar.`);
        else sinComparar(`La plataforma no tiene serie de precios de la referencia (${nombre}): no se puede comparar.`);
      } else if (clase.clase === "perfil") {
        const [rf, rv] = await Promise.all([serieEnLaBase(FONDOS_DE_LOS_PERFILES.rf), serieEnLaBase(FONDOS_DE_LOS_PERFILES.rv)]);
        const faltan = [
          rf.puntos.length === 0 ? `${rf.nombreDelFondo ?? "el fondo de renta fija"} (${FONDOS_DE_LOS_PERFILES.rf})` : null,
          rv.puntos.length === 0 ? `${rv.nombreDelFondo ?? "el fondo de renta variable"} (${FONDOS_DE_LOS_PERFILES.rv})` : null
        ].filter((falta): falta is string => falta !== null);
        const divisaSinCambio = rf.sinCambio ?? rv.sinCambio;
        if (faltan.length === 0) referencia = { nombre, base: { rf: rf.puntos, rv: rv.puntos }, pesos: clase.perfil.weights };
        else if (divisaSinCambio) sinComparar(`La cartera de referencia ${clase.perfil.name} no se puede calcular: la serie de sus fondos está en ${divisaSinCambio} y la plataforma no tiene el tipo de cambio para llevarla a ${base}.`);
        else sinComparar(`La cartera de referencia ${clase.perfil.name} no se puede calcular: la plataforma no tiene la serie de ${faltan.join(" ni la de ")}.`);
      } else if (clase.clase === "liquidez") {
        if (base !== "EUR") sinComparar("La liquidez se mide con el €STR, un tipo en euros: solo se compara con una cartera en euros.");
        else if (!datos.libreDeRiesgo || datos.libreDeRiesgo.length === 0) sinComparar("La plataforma no tiene el €STR: no se puede comparar con la liquidez.");
        else referencia = { nombre, estr: datos.libreDeRiesgo };
      } else {
        sinComparar(`Esta versión de la aplicación no reconoce la referencia guardada en la cartera (${clase.codigo}): elige otra.`);
      }
    } catch (error) {
      sinComparar(
        "No se han podido leer los datos de la referencia: no se puede comparar.",
        `No se han podido leer los datos de la referencia: ${motivoEnLlano(error)}.`
      );
    }
  }

  return { datos, fichas, referencia, avisos, ultimoDato };
}

/**
 * Los datos de mercado de una lista de activos entre dos fechas, sin que haya una cartera
 * con movimientos todavía: para simular una cartera de pesos (las de Diseño) hace falta
 * conocer los precios antes de poder escribir sus compras.
 */
export function cargarMercadoDeActivos(activos: Cartera["activos"], divisaBase: string, desde: Dia, hasta: Dia, fuente: FuenteDeMercado): Promise<MercadoCargado> {
  /* Una cartera de trámite que nombra cada activo en la fecha de inicio: es lo que `cargarMercado` mira para saber qué pedir. */
  const deTramite: Cartera = {
    id: "mercado-de-activos",
    nombre: "",
    divisaBase,
    creada: "",
    modificada: "",
    cuentas: { efectivo: { nombre: "" }, valores: { nombre: "" } },
    activos,
    movimientos: activos.map((activo, indice) => ({ id: `tramite-${indice}`, tipo: "entradaDeTitulos", fechaOperacion: desde, activoId: activo.id, titulos: "1", precio: "1" })),
    preciosManuales: [],
    extractos: [],
    importaciones: []
  };
  return cargarMercado(deTramite, hasta, fuente);
}
