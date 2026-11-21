/**
 * La valoración diaria de una cartera: cuánto vale cada día, qué entró y salió de fuera, y
 * de dónde viene el resultado de cada día (precio, ingresos, divisa y costes), posición a
 * posición. De aquí salen la rentabilidad, el riesgo, el desglose y la contribución.
 *
 * LA IDENTIDAD que todo cumple, día a día y en la divisa base:
 *
 *     valor de hoy − valor de ayer − flujos externos
 *         = efecto precio + ingresos + efecto divisa − costes
 *
 * Cada posición aporta su parte:
 *     resultado en base   G = V(hoy) − V(ayer) − lo invertido hoy en ella (neto de lo cobrado)
 *     resultado local     L = lo mismo, en la divisa del activo
 *     efecto precio         = L convertido al cambio de hoy
 *     efecto divisa         = G − efecto precio
 * Un activo en la divisa base tiene efecto divisa cero. El efectivo en otra divisa aporta su
 * efecto divisa como el resto que cierra la identidad.
 *
 * RENTABILIDAD DEL DÍA: (V(hoy) − salidas) / (V(ayer) + entradas) − 1. Las entradas de
 * dinero cuentan desde el inicio del día y las salidas al final: una aportación o una
 * retirada no cambian la rentabilidad, que es lo que exige la ponderación por tiempo.
 *
 * Los precios llegan en coma flotante y la valoración se hace en coma flotante. Los saldos,
 * los títulos y los costes, que son exactos, viven en el libro.
 */
import { abs, aNumero, CERO, cifraEnTexto, d, esDecimal, type Decimal } from "./decimal";
import { cuponCorrido } from "./bonos";
import { diasEntre, fechaEnTexto, rangoDeDias, type Dia } from "./fechas";
import { construirLibro, titulosDe, type Apunte, type Libro } from "./libro";
import { divisaDelEfectivo, type Activo, type Cartera, type Movimiento } from "./modelo";
import { factorDeLaSerie, type FactorDeLaSerie } from "./serieAjustada";

/** Un punto de una serie de mercado. */
export interface Punto {
  fecha: Dia;
  valor: number;
}

/** Los datos de mercado que el motor necesita. Los trae la capa `mercado/`; aquí son datos planos. */
export interface DatosDeMercado {
  /** Serie de precios por activo, en la divisa del activo, de más antiguo a más reciente. */
  precios: Map<string, Punto[]>;
  /** Tipo de cambio por divisa: unidades de la divisa por 1 unidad de la divisa base. */
  cambios: Map<string, Punto[]>;
  /** Tipo libre de riesgo: tasa anual en fracción, una observación por día hábil (€STR). */
  libreDeRiesgo?: Punto[];
  /**
   * Los activos cuya serie viene ajustada por dividendos (acciones y ETF cotizados): su
   * precio real de cada día se reconstruye con los dividendos del libro (`serieAjustada.ts`).
   */
  ajustadasPorDividendos?: Set<string>;
}

export const MERCADO_VACIO: DatosDeMercado = { precios: new Map(), cambios: new Map() };

/** De dónde sale el precio con el que se valoró una posición un día. */
export const FUENTE = { sinPrecio: 0, mercado: 1, manual: 2, operacion: 3, extracto: 4 } as const;
export type FuenteDelPrecio = (typeof FUENTE)[keyof typeof FUENTE];

export interface SerieDeActivo {
  activoId: string;
  /** Valor de la posición al cierre de cada día, en la divisa base. */
  valor: Float64Array;
  /** Títulos al cierre de cada día (los reales de ese día, sin ajustar por splits posteriores). */
  titulos: Float64Array;
  /** Precio con el que se valoró, en la divisa del activo y en términos de ese día. */
  precio: Float64Array;
  /** Fuente del precio de cada día (`FUENTE`). */
  fuente: Uint8Array;
  /** Días que tenía el precio usado: cero si es del mismo día. */
  antiguedad: Uint16Array;
  /** Lo invertido en la posición cada día, neto de lo cobrado, en la divisa base. */
  invertido: Float64Array;
  efectoPrecio: Float64Array;
  efectoDivisa: Float64Array;
  /** Ingresos netos cobrados de la posición (dividendos, cupones). */
  ingresos: Float64Array;
  /** Costes atribuidos a la posición que no van dentro de una compra o una venta. */
  costes: Float64Array;
}

export type CodigoDeValoracion = "SIN_CAMBIO" | "SIN_PRECIO" | "DIVIDENDOS_SIN_REGISTRAR" | "CAPITAL_RESIDUAL" | "SIN_CAPITAL";

/**
 * CARTERA CASI VACÍA (auditoría 16-11-2026, GES-2). La rentabilidad de un día es su resultado entre el capital de ese día, y
 * con un capital residual no mide nada: vendido todo y retirado el dinero, quedan 0,50 €; diez días después llega un dividendo
 * de 30 € y el día da +6.000 %, que encadenado es la rentabilidad del periodo, del año y de «desde el inicio».
 *
 * Un día cuyo capital queda por debajo de esta fracción de lo MÁS que había llegado a valer la cartera hasta la víspera no se
 * encadena: su rentabilidad es cero, como la de un día sin capital, y `avisos` dice el tramo y los euros que quedan fuera. El
 * resultado en euros y la TIR no cambian: los dos cuentan ese dinero. El máximo es el de hasta la víspera, así que una cartera
 * que empieza pequeña y crece se mide desde el primer día.
 *
 * Lo que deja sin medir a propósito: una cartera que cayera por debajo del 1 % de su máximo solo por mercado, sin retiradas.
 */
export const CAPITAL_RESIDUAL = 0.01;

/*
 * DÍAS SIN CAPITAL DEL CLIENTE (auditoría 16-11-2026, GES-9; decisión de Óscar del 17-11-2026: «que los días sin capital no
 * cuenten»). La rentabilidad de un día es su resultado entre el capital de ese día —lo que valía la cartera la víspera más
 * lo aportado hoy—, y ese capital tiene que ser dinero del cliente. Pasa que no lo es cuando una compra se anota antes que su
 * aportación: el efectivo queda en negativo por lo comprado, la cartera «vale» cero, y lo que la posición gana hasta que
 * llega el dinero se mediría luego sobre sí mismo. Comprado el día 1, subiendo un 1 % diario y aportado el día 4, el día 3 se
 * medía sobre los 100 € ganados el día 2: 201 / 100 − 1 = +101 % en un día, y el periodo daba +103 % donde la cartera ganó
 * un 3,03 %.
 *
 * La regla: la rentabilidad se ENCADENA DESDE QUE HAY DINERO. La cadena se enciende el primer día en que entra dinero del
 * cliente (una aportación o una entrada de títulos) y el capital del día es positivo, y se apaga el día en que el capital es
 * cero o negativo —una cartera liquidada del todo, o con un descubierto que se come lo que había—; vuelve a encenderse con
 * el siguiente dinero que entre. Los días sin encender tienen rentabilidad cero, no entran en la TWR ni en la contribución
 * de cada posición, y `avisos` dice el tramo y los euros que quedan fuera (`SIN_CAPITAL`). El resultado en euros y la TIR
 * sí los cuentan: el dinero no se pierde, solo no se mide como rentabilidad.
 *
 * Lo que deja a propósito: un día con capital positivo pero menor que lo invertido —el cliente aportó 1.000 € y se anotó una
 * compra de 10.000 € antes que el resto— se mide sobre esos 1.000, apalancado. Es dinero del cliente, y se avisa del
 * descubierto (`EFECTIVO_EN_NEGATIVO`).
 */

/** Desvío entre el precio de una compra y el que sale de la serie a partir del cual se sospecha que falta un dividendo. */
export const DESVIO_DE_DIVIDENDO_SIN_REGISTRAR = 0.04;
/**
 * Un dividendo anotado sin su retención es un NETO: el banco lo abona ya descontado, y la serie del proveedor lo rebaja por
 * su bruto. Esa diferencia no es un dividendo que falte, y el aviso no debe saltar por ella. Lo más que puede faltarle a un
 * neto para ser su bruto: en un valor español (ISIN «ES»), la retención española; en uno extranjero, además, la del país de
 * origen. Se supone un inversor residente en España. No cambia ninguna cifra: solo decide si se avisa.
 */
export const RETENCION_MAXIMA_SUPUESTA = { nacional: 0.2, extranjera: 0.46 } as const;
/** Días que tienen que haber pasado desde la compra: antes, la diferencia puede ser el movimiento del día. */
export const DIAS_PARA_SOSPECHAR_DE_UN_DIVIDENDO = 90;

export interface AvisoDeValoracion {
  codigo: CodigoDeValoracion;
  activoId?: string;
  divisa?: string;
  desde: Dia;
  mensaje: string;
}

export interface Valoracion {
  divisaBase: string;
  /** Todos los días naturales desde el primer movimiento hasta el final, seguidos. */
  dias: Dia[];
  indice: Map<Dia, number>;
  /** Valor total al cierre de cada día. */
  valor: Float64Array;
  /** Efectivo (incluido el que está en tránsito), en la divisa base. */
  efectivo: Float64Array;
  /** Flujos externos del día: entradas (≥ 0) y salidas (≤ 0). */
  entradas: Float64Array;
  salidas: Float64Array;
  /** Rentabilidad del día. Cero en un día que no se encadena: sin dinero del cliente (`SIN_CAPITAL`) o con un capital residual (`CAPITAL_RESIDUAL`). */
  rentabilidad: Float64Array;
  /** 1 si el día entra en la rentabilidad ponderada por tiempo; 0 si no se encadena (`SIN_CAPITAL`, `CAPITAL_RESIDUAL`). */
  encadena: Uint8Array;
  /** Base sobre la que se mide la rentabilidad del día: valor de ayer más entradas. */
  capital: Float64Array;
  porActivo: Map<string, SerieDeActivo>;
  /** Ingresos que no son de ningún activo: intereses de la cuenta y otros abonos. */
  ingresosSueltos: Float64Array;
  /** Costes que no son de ningún activo: custodia, asesoramiento, impuestos sueltos. */
  costesSueltos: Float64Array;
  /** Efecto divisa del efectivo: revalorización de los saldos en otra divisa. */
  divisaDelEfectivo: Float64Array;
  avisos: AvisoDeValoracion[];
  libro: Libro;
  /** Cuántas unidades de la divisa base vale una unidad de otra divisa un día (el último cambio conocido). Cero si no hay cambio. */
  aBase(divisa: string, fecha: Dia): number;
  /** De qué día es el cambio que usa `aBase` para esa fecha: puede ser de mucho antes. `undefined` en la divisa base o sin cambio. */
  fechaDelCambio(divisa: string, fecha: Dia): Dia | undefined;
}

/** Recorre una serie ordenada hacia delante devolviendo el último punto en o antes de cada día pedido. */
function cursor<T extends Punto>(puntos: T[]): (fecha: Dia) => T | undefined {
  let i = -1;
  return (fecha) => {
    while (i + 1 < puntos.length && puntos[i + 1].fecha <= fecha) i += 1;
    return i >= 0 ? puntos[i] : undefined;
  };
}

/** Busca por bisección el último punto en o antes de un día: para consultas sueltas, sin orden. */
export function ultimoHasta(puntos: Punto[] | undefined, fecha: Dia): Punto | undefined {
  if (!puntos || puntos.length === 0) return undefined;
  let bajo = 0;
  let alto = puntos.length - 1;
  if (puntos[0].fecha > fecha) return undefined;
  while (bajo < alto) {
    const medio = (bajo + alto + 1) >> 1;
    if (puntos[medio].fecha <= fecha) bajo = medio;
    else alto = medio - 1;
  }
  return puntos[bajo];
}

function ordenados(puntos: Punto[]): Punto[] {
  return [...puntos].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
}

function multiplicador(activo: Activo | undefined): number {
  const valor = activo?.multiplicador ? Number(activo.multiplicador) : 1;
  return Number.isFinite(valor) && valor > 0 ? valor : 1;
}

/** La divisa a la que se refiere el `cambio` de un movimiento. */
function divisaDelCambio(movimiento: Movimiento, base: string, activo: Activo | undefined): string | undefined {
  const efectivo = divisaDelEfectivo(movimiento, base);
  return efectivo !== base ? efectivo : activo?.divisa;
}

/**
 * Un importe de una operación, llevado a la divisa del activo con el cambio de esa operación: el que declara el propio
 * movimiento si se refiere a ella, o los del día cruzados por la base. `undefined` si falta un cambio.
 *
 * @param cambioDe  Unidades de una divisa por 1 de la base en una fecha, o `undefined`.
 */
function aLaDivisaDelActivo(
  importe: number,
  divisa: string,
  apunte: Apunte,
  activo: Activo,
  base: string,
  cambioDe: (divisa: string, fecha: Dia) => number | undefined
): number | undefined {
  if (divisa === activo.divisa) return importe;
  const deOrigen = divisa === base ? 1 : cambioDe(divisa, apunte.fecha);
  if (deOrigen === undefined || !(deOrigen > 0)) return undefined;
  const enBase = importe / deOrigen;
  const propio = apunte.movimiento.cambio ? Number(apunte.movimiento.cambio) : Number.NaN;
  if (divisa === base && propio > 0 && divisaDelCambio(apunte.movimiento, base, activo) === activo.divisa) return enBase * propio;
  const aDestino = activo.divisa === base ? 1 : cambioDe(activo.divisa, apunte.fecha);
  return aDestino !== undefined && aDestino > 0 ? enBase * aDestino : undefined;
}

/**
 * Los cambios que se usan de verdad: los de mercado y, para las divisas que el mercado no
 * trae, los de los propios movimientos (el último cambio conocido de la cartera).
 *
 * VARIOS CAMBIOS PROPIOS EL MISMO DÍA (decisión de la dirección, 13-11-2026): se usa su media
 * ponderada por importe, que es el cambio al que se convirtió en conjunto lo de ese día: lo
 * convertido en la divisa extranjera entre lo convertido en la base (Σ extranjera / Σ base, la
 * media de los cambios ponderada por el importe en la base). Antes ganaba el último del fichero,
 * y el patrimonio dependía del orden en que se tecleó o importó. El importe es el del efectivo
 * del movimiento, en valor absoluto; si ninguno del día lo trae, la media simple de sus cambios.
 * Un solo cambio en el día se usa tal cual. Solo afecta a la valoración: cada movimiento
 * convierte su propio importe con su propio cambio.
 */
function cambiosEfectivos(cartera: Cartera, mercado: DatosDeMercado): Map<string, Punto[]> {
  const base = cartera.divisaBase;
  const porId = new Map(cartera.activos.map((a) => [a.id, a]));
  interface DelDia {
    extranjera: Decimal;
    enBase: Decimal;
    suma: Decimal;
    cuantos: number;
  }
  const propios = new Map<string, Map<Dia, DelDia>>();
  for (const movimiento of cartera.movimientos) {
    const divisa = divisaDelCambio(movimiento, base, porId.get(movimiento.activoId ?? ""));
    if (!divisa || divisa === base || !esDecimal(movimiento.cambio) || !d(movimiento.cambio).gt(0)) continue;
    const cambio = d(movimiento.cambio);
    const importe = esDecimal(movimiento.importe) ? abs(d(movimiento.importe)) : CERO;
    const enLaExtranjera = divisaDelEfectivo(movimiento, base) === divisa;
    const porDia = propios.get(divisa) ?? new Map<Dia, DelDia>();
    const delDia = porDia.get(movimiento.fechaOperacion) ?? { extranjera: CERO, enBase: CERO, suma: CERO, cuantos: 0 };
    delDia.extranjera = delDia.extranjera.plus(enLaExtranjera ? importe : importe.times(cambio));
    delDia.enBase = delDia.enBase.plus(enLaExtranjera ? importe.div(cambio) : importe);
    delDia.suma = delDia.suma.plus(cambio);
    delDia.cuantos += 1;
    porDia.set(movimiento.fechaOperacion, delDia);
    propios.set(divisa, porDia);
  }
  const cambios = new Map<string, Punto[]>();
  for (const [divisa, puntos] of mercado.cambios) if (puntos.length > 0) cambios.set(divisa, puntos);
  for (const [divisa, porDia] of propios) {
    if (cambios.has(divisa)) continue;
    const puntos: Punto[] = [];
    for (const [fecha, delDia] of porDia) {
      const media = delDia.cuantos === 1 ? delDia.suma : delDia.enBase.gt(0) ? delDia.extranjera.div(delDia.enBase) : delDia.suma.div(delDia.cuantos);
      puntos.push({ fecha, valor: aNumero(media) });
    }
    cambios.set(divisa, ordenados(puntos));
  }
  return cambios;
}

interface PuntoDePrecio extends Punto {
  fuente: FuenteDelPrecio;
}

/**
 * La serie de precios con la que se valora un activo. Si la plataforma tiene serie, manda
 * ella, y un precio a mano del mismo día la corrige. Si no la tiene, se usan los precios a
 * mano y, a falta de ellos, los de las propias operaciones (último precio contratado).
 *
 * ANTES DE QUE EMPIECE LA SERIE (auditoría 16-11-2026, GES-1): una serie que empieza después
 * de la primera compra no dice nada de los días anteriores, y esos días se valoran también con
 * el precio de las operaciones, como si no hubiera serie. Antes la posición valía cero hasta el
 * primer punto de la plataforma: con 1.000 € aportados e invertidos el día 1 y la serie desde
 * el día 10, el primer día daba −100 % y, encadenado, cualquier periodo que lo incluyera
 * también. Desde su primer punto manda la serie, y lo que el precio se movió hasta entonces
 * aparece junto ese día.
 *
 * Y lo que el banco declaró en un extracto de posiciones es un precio más: el valor de la
 * posición entre sus títulos, a la fecha del extracto. Solo se usa cuando es MÁS RECIENTE
 * que el último precio de la plataforma (o no hay serie): el extracto del banco suele ir
 * unos días por delante, y sin él el patrimonio de hoy sale con precios de la semana pasada.
 * En cuanto la serie llega a esa fecha, vuelve a mandar ella. También vale el de un extracto
 * ANTERIOR al primer punto de la serie (GES-1). Los bonos quedan fuera: el
 * banco los valora con su cupón corrido, y aquí el cupón se calcula aparte.
 *
 * @param cambioDe  Unidades de una divisa por 1 de la base en una fecha, o `undefined`.
 */
function preciosEfectivos(
  cartera: Cartera,
  libro: Libro,
  mercado: DatosDeMercado,
  activo: Activo,
  cambioDe: (divisa: string, fecha: Dia) => number | undefined
): { puntos: PuntoDePrecio[]; conSerieDeMercado: boolean } {
  const deMercado = mercado.precios.get(activo.id) ?? [];
  const porFecha = new Map<Dia, PuntoDePrecio>();
  const conSerieDeMercado = deMercado.length > 0;
  /* Las operaciones ponen precio donde la plataforma no tiene dato: siempre si no hay serie, y hasta la víspera de su primer punto si la hay. */
  const primeraDeMercado = deMercado[0]?.fecha;
  {
    const mult = multiplicador(activo);
    for (const apunte of libro.apuntes) {
      const efecto = apunte.efecto;
      if ((efecto.clase !== "alta" && efecto.clase !== "baja") || efecto.activoId !== activo.id) continue;
      if (primeraDeMercado !== undefined && apunte.fecha >= primeraDeMercado) continue;
      const movimiento = apunte.movimiento;
      const esElOrigen = movimiento.activoId === activo.id;
      const declarado = esElOrigen ? movimiento.precio : movimiento.destino?.precio;
      let precio = declarado !== undefined ? Number(declarado) : Number.NaN;
      if (!(precio > 0)) {
        /* Sin precio declarado, el implícito: lo pagado o cobrado entre los títulos, en la divisa del activo. Si se pagó en
           otra, se lleva a la del activo con el cambio de la operación (decisión A-196, 20-11-2026): hasta entonces una
           compra pagada en euros de un valor en dólares, sin precio escrito, se quedaba sin precio y contaba como cero. */
        const dinero = efecto.clase === "alta" ? efecto.pagado : efecto.cobrado;
        const titulos = aNumero(efecto.titulos);
        if (titulos > 0 && dinero.importe.gt(0)) {
          const enLaDivisaDelActivo = aLaDivisaDelActivo(aNumero(dinero.importe), dinero.divisa, apunte, activo, cartera.divisaBase, cambioDe);
          if (enLaDivisaDelActivo !== undefined && enLaDivisaDelActivo > 0) precio = enLaDivisaDelActivo / titulos / mult;
        }
      }
      if (precio > 0) porFecha.set(apunte.fecha, { fecha: apunte.fecha, valor: precio, fuente: FUENTE.operacion });
    }
  }
  for (const punto of deMercado) porFecha.set(punto.fecha, { ...punto, fuente: FUENTE.mercado });
  if (activo.tipo !== "BONO") {
    const ultimaDeMercado = deMercado[deMercado.length - 1]?.fecha;
    const mult = multiplicador(activo);
    for (const extracto of cartera.extractos) {
      for (const posicion of extracto.posiciones) {
        if (posicion.activoId !== activo.id || posicion.valor === undefined) continue;
        /* GES-10 (auditoría del 16-11-2026): el precio es del día de su cotización, que el extracto dice posición a posición. Con la
           fecha del extracto —la mayor de todas— un fondo valorado tres días antes quedaba con un precio fechado de más. */
        const fechaDelPrecio = posicion.fecha ?? extracto.fecha;
        /* Dentro del tramo que cubre la serie manda ella. Antes de su primer punto, igual que después del último, el extracto es el único precio de mercado que hay. */
        if (ultimaDeMercado !== undefined && primeraDeMercado !== undefined && primeraDeMercado <= fechaDelPrecio && fechaDelPrecio <= ultimaDeMercado) continue;
        const titulos = Number(posicion.titulos);
        const valor = Number(posicion.valor);
        const cambio = activo.divisa === cartera.divisaBase ? 1 : cambioDe(activo.divisa, extracto.fecha);
        if (!(titulos > 0) || !(valor > 0) || cambio === undefined || !(cambio > 0)) continue;
        /* El valor declarado está en la divisa base: a la del activo, entre los títulos. */
        porFecha.set(fechaDelPrecio, { fecha: fechaDelPrecio, valor: (valor * cambio) / titulos / mult, fuente: FUENTE.extracto });
      }
    }
  }
  for (const manual of cartera.preciosManuales) {
    const valor = Number(manual.precio);
    if (manual.activoId === activo.id && valor > 0) porFecha.set(manual.fecha, { fecha: manual.fecha, valor, fuente: FUENTE.manual });
  }
  const puntos = [...porFecha.values()].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
  return { puntos, conSerieDeMercado };
}

export interface OpcionesDeValoracion {
  /** Último día a valorar. Por defecto, el del último movimiento. */
  hasta?: Dia;
}

export function valorar(cartera: Cartera, mercado: DatosDeMercado = MERCADO_VACIO, opciones: OpcionesDeValoracion = {}): Valoracion {
  const base = cartera.divisaBase;
  const porId = new Map(cartera.activos.map((activo) => [activo.id, activo]));
  const cambios = cambiosEfectivos(cartera, mercado);

  /* 1. El libro, guardando cómo quedan las cuentas al cierre de cada día con apuntes. */
  interface Foto {
    titulos: Map<string, number>;
    efectivo: Map<string, number>;
    apuntes: Apunte[];
  }
  const fotos = new Map<Dia, Foto>();
  const libro = construirLibro(cartera, {
    cambio: (divisa, fecha) => ultimoHasta(cambios.get(divisa), fecha)?.valor,
    hasta: opciones.hasta,
    alCerrarElDia(dia, estado, apuntes) {
      const titulos = new Map<string, number>();
      for (const apunte of apuntes) {
        const efecto = apunte.efecto;
        if (efecto.clase === "alta" || efecto.clase === "baja" || efecto.clase === "ajusteDeTitulos") titulos.set(efecto.activoId, aNumero(titulosDe(estado, efecto.activoId)));
        if (efecto.clase === "canje") {
          titulos.set(efecto.activoId, aNumero(titulosDe(estado, efecto.activoId)));
          titulos.set(efecto.destinoId, aNumero(titulosDe(estado, efecto.destinoId)));
        }
      }
      const efectivo = new Map<string, number>();
      for (const [divisa, saldo] of estado.efectivo) efectivo.set(divisa, aNumero(saldo));
      for (const [divisa, saldo] of estado.transito) efectivo.set(divisa, (efectivo.get(divisa) ?? 0) + aNumero(saldo));
      fotos.set(dia, { titulos, efectivo, apuntes: [...apuntes] });
    }
  });

  const primera = libro.primeraFecha;
  const ultima = opciones.hasta && primera && opciones.hasta >= primera ? opciones.hasta : libro.ultimaFecha;
  const dias = primera && ultima ? rangoDeDias(primera, ultima) : [];
  const n = dias.length;
  const indice = new Map(dias.map((dia, i) => [dia, i]));
  const avisos: AvisoDeValoracion[] = [];

  const valoracion: Valoracion = {
    divisaBase: base,
    dias,
    indice,
    valor: new Float64Array(n),
    efectivo: new Float64Array(n),
    entradas: new Float64Array(n),
    salidas: new Float64Array(n),
    rentabilidad: new Float64Array(n),
    encadena: new Uint8Array(n),
    capital: new Float64Array(n),
    porActivo: new Map(),
    ingresosSueltos: new Float64Array(n),
    costesSueltos: new Float64Array(n),
    divisaDelEfectivo: new Float64Array(n),
    avisos,
    libro,
    aBase(divisa, fecha) {
      if (divisa === base) return 1;
      const punto = ultimoHasta(cambios.get(divisa), fecha);
      return punto && punto.valor > 0 ? 1 / punto.valor : 0;
    },
    fechaDelCambio(divisa, fecha) {
      if (divisa === base) return undefined;
      const punto = ultimoHasta(cambios.get(divisa), fecha);
      return punto && punto.valor > 0 ? punto.fecha : undefined;
    }
  };
  if (n === 0) return valoracion;

  /* 2. Por cada activo que aparece en el libro: su serie de precios y sus splits. */
  interface EstadoDeActivo {
    activo: Activo | undefined;
    serie: SerieDeActivo;
    precioEn: (fecha: Dia) => PuntoDePrecio | undefined;
    /** Factores de los splits con serie ajustada, con su fecha: antes de ella, los títulos se multiplican. */
    splits: Array<{ fecha: Dia; factor: number }>;
    /** Todos los splits del activo, con serie de mercado o sin ella, estén o no en la serie: dividen un precio de antes de ellos. */
    todosLosSplits: Array<{ fecha: Dia; factor: number }>;
    /** El factor que devuelve a una serie ajustada por dividendos su precio real. */
    k: FactorDeLaSerie | undefined;
    titulos: number;
    valorAyer: number;
    localAyer: number;
    sinPrecioDesde?: Dia;
  }
  const estados = new Map<string, EstadoDeActivo>();
  const estadoDe = (activoId: string): EstadoDeActivo => {
    let estado = estados.get(activoId);
    if (estado) return estado;
    const activo = porId.get(activoId);
    const precios = activo
      ? preciosEfectivos(cartera, libro, mercado, activo, (divisa, fecha) => ultimoHasta(cambios.get(divisa), fecha)?.valor)
      : { puntos: [], conSerieDeMercado: false };
    const cursorDePrecio = cursor<PuntoDePrecio>(precios.puntos);
    const serie: SerieDeActivo = {
      activoId,
      valor: new Float64Array(n),
      titulos: new Float64Array(n),
      precio: new Float64Array(n),
      fuente: new Uint8Array(n),
      antiguedad: new Uint16Array(n),
      invertido: new Float64Array(n),
      efectoPrecio: new Float64Array(n),
      efectoDivisa: new Float64Array(n),
      ingresos: new Float64Array(n),
      costes: new Float64Array(n)
    };
    const todosLosSplits = (libro.ajustes.get(activoId) ?? []).map((ajuste) => ({ fecha: ajuste.fecha, factor: aNumero(ajuste.factor), serieAjustada: ajuste.serieAjustada }));
    /* Solo una serie de mercado puede venir ajustada por un split: sin ella, ningún precio lo está. */
    const splits = precios.conSerieDeMercado ? todosLosSplits.filter((split) => split.serieAjustada) : [];
    let k: FactorDeLaSerie | undefined;
    /** El mismo factor, suponiendo que a cada dividendo anotado sin retención le falta la mayor retención posible. Solo para el aviso. */
    let kHolgado: FactorDeLaSerie | undefined;
    if (activo && precios.conSerieDeMercado && mercado.ajustadasPorDividendos?.has(activoId)) {
      const cambioDe = (divisa: string, fecha: Dia): number | undefined => (divisa === base ? 1 : ultimoHasta(cambios.get(divisa), fecha)?.valor);
      const serieDeMercado = mercado.precios.get(activoId) ?? [];
      const factorDeLosSplits = (fecha: Dia): number => splits.reduce((factor, split) => (split.fecha > fecha ? factor * split.factor : factor), 1);
      const aLocal = (importe: number, divisa: string, apunte: Apunte): number | undefined =>
        aLaDivisaDelActivo(importe, divisa, apunte, activo, base, cambioDe);
      k = factorDeLaSerie(activoId, libro.apuntes, serieDeMercado, factorDeLosSplits, aLocal);
      const retencion = activo.isin?.slice(0, 2).toUpperCase() === "ES" ? RETENCION_MAXIMA_SUPUESTA.nacional : RETENCION_MAXIMA_SUPUESTA.extranjera;
      kHolgado = factorDeLaSerie(activoId, libro.apuntes, serieDeMercado, factorDeLosSplits, (importe, divisa, apunte) => {
        const local = aLocal(importe, divisa, apunte);
        const conRetencionAnotada = Number(apunte.movimiento.retencion ?? 0) > 0;
        return local === undefined || conRetencionAnotada ? local : local / (1 - retencion);
      });
    }
    if (activo && k && kHolgado) {
      /*
       * Con todos los dividendos anotados, el precio que sale de la serie el día de una compra es el que se pagó.
       * Si lo pagado queda claramente por encima, la serie descuenta dividendos que el libro no tiene: falta alguno,
       * o hubo una ampliación de capital. Se mide con el factor holgado: lo que explica la retención no cuenta.
       */
      const deMercado = mercado.precios.get(activoId) ?? [];
      const ultimoDato = deMercado[deMercado.length - 1]?.fecha;
      let mayor: { fecha: Dia; desvio: number } | undefined;
      for (const apunte of libro.apuntes) {
        const efecto = apunte.efecto;
        if (efecto.clase !== "alta" || efecto.activoId !== activoId || efecto.externo || apunte.movimiento.activoId !== activoId) continue;
        const pagado = apunte.movimiento.precio ? Number(apunte.movimiento.precio) : Number.NaN;
        const enSerie = ultimoHasta(deMercado, apunte.fecha)?.valor;
        if (!(pagado > 0) || enSerie === undefined || !(enSerie > 0) || !ultimoDato || diasEntre(apunte.fecha, ultimoDato) < DIAS_PARA_SOSPECHAR_DE_UN_DIVIDENDO) continue;
        const enElDia = enSerie * kHolgado.en(apunte.fecha) * splits.reduce((factor, split) => (split.fecha > apunte.fecha ? factor * split.factor : factor), 1);
        const desvio = pagado / enElDia - 1;
        if (desvio > DESVIO_DE_DIVIDENDO_SIN_REGISTRAR && (!mayor || desvio > mayor.desvio)) mayor = { fecha: apunte.fecha, desvio };
      }
      if (mayor) {
        avisos.push({
          codigo: "DIVIDENDOS_SIN_REGISTRAR",
          activoId,
          desde: mayor.fecha,
          mensaje: `Puede faltar algún dividendo de ${activo.nombre}, o haber habido una ampliación de capital: el precio de la compra del ${fechaEnTexto(mayor.fecha)} queda un ${cifraEnTexto(mayor.desvio * 100, 1)} % por encima del que sale de su serie de precios, aun contando con que los dividendos anotados sean netos de retención. Comprueba en el extracto los dividendos cobrados desde entonces.`
        });
      }
    }
    estado = {
      activo,
      serie,
      precioEn: cursorDePrecio,
      splits,
      todosLosSplits,
      k,
      titulos: 0,
      valorAyer: 0,
      localAyer: 0
    };
    estados.set(activoId, estado);
    valoracion.porActivo.set(activoId, serie);
    return estado;
  };
  for (const apunte of libro.apuntes) {
    const efecto = apunte.efecto;
    if ("activoId" in efecto && efecto.activoId) estadoDe(efecto.activoId);
    if (efecto.clase === "canje") estadoDe(efecto.destinoId);
  }

  /* 3. Cambios: unidades de base por 1 de la divisa, día a día. */
  const cursoresDeCambio = new Map<string, (fecha: Dia) => Punto | undefined>();
  const sinCambioDesde = new Map<string, Dia>();
  const aBase = (divisa: string, fecha: Dia): number => {
    if (divisa === base) return 1;
    let cursorDeCambio = cursoresDeCambio.get(divisa);
    if (!cursorDeCambio) {
      cursorDeCambio = cursor(cambios.get(divisa) ?? []);
      cursoresDeCambio.set(divisa, cursorDeCambio);
    }
    const punto = cursorDeCambio(fecha);
    if (punto && punto.valor > 0) return 1 / punto.valor;
    if (!sinCambioDesde.has(divisa)) {
      sinCambioDesde.set(divisa, fecha);
      avisos.push({ codigo: "SIN_CAMBIO", divisa, desde: fecha, mensaje: `No hay tipo de cambio ${divisa}/${base} desde el ${fechaEnTexto(fecha)}: lo que está en ${divisa} no se puede valorar y cuenta como cero.` });
    }
    return 0;
  };

  /** Factor por el que se multiplican los títulos de un día para leer una serie ajustada por splits posteriores. */
  const factorDeSplits = (estado: Pick<EstadoDeActivo, "splits">, fecha: Dia): number => {
    let factor = 1;
    for (const split of estado.splits) if (split.fecha > fecha) factor *= split.factor;
    return factor;
  };

  /**
   * El precio de un punto en los términos de la serie (títulos de hoy): la serie de la plataforma
   * recupera su precio real con el factor de dividendos; un precio a mano, de una operación o de un
   * extracto es ya el real de su día. Si entre su día y hoy hubo un split, ese precio es de títulos
   * antiguos y se divide por la razón (2×1: la mitad), haya o no serie de mercado y la ajuste o no:
   * `serieAjustada` solo dice algo de los puntos de mercado. Después se pasa a títulos de la serie.
   * Un precio del mismo día del split se toma como posterior a él, como en la serie.
   */
  const precioEnTerminosDeLaSerie = (estado: EstadoDeActivo, punto: PuntoDePrecio | undefined, dia: Dia): number => {
    if (!punto) return 0;
    if (punto.fuente === FUENTE.mercado) return punto.valor * (estado.k?.en(dia) ?? 1);
    let desdeElPrecio = 1;
    for (const split of estado.todosLosSplits) if (split.fecha > punto.fecha && split.fecha <= dia) desdeElPrecio *= split.factor;
    return punto.valor / desdeElPrecio / factorDeSplits(estado, dia);
  };

  const efectivoHoy = new Map<string, number>();
  let valorAyer = 0;
  let huboOtraDivisaAyer = false;
  /* Lo más que ha valido la cartera hasta la víspera, y los días con resultado que no se encadenan por capital residual. */
  let maximoHastaAyer = 0;
  let sinEncadenar: { desde: Dia; hasta: Dia; resultado: number } | undefined;
  /* Y los días con resultado en los que no había capital del cliente sobre el que medirlo (GES-9). La cadena se enciende el
     primer día en que entra dinero del cliente con capital positivo, y se apaga el día en que el capital es cero o negativo:
     desde ahí, lo que valga la cartera hasta que vuelva a entrar dinero no es capital del cliente sobre el que medir. */
  let hayDinero = false;
  let sinCapital: { desde: Dia; hasta: Dia; resultado: number } | undefined;

  /* 4. Día a día. */
  for (let k = 0; k < n; k += 1) {
    const dia = dias[k];
    const foto = fotos.get(dia);
    const invertidoBase = new Map<string, number>();
    const invertidoLocal = new Map<string, number>();
    const sumar = (mapa: Map<string, number>, clave: string, importe: number) => mapa.set(clave, (mapa.get(clave) ?? 0) + importe);
    let entradas = 0;
    let salidas = 0;
    let ingresosDelDia = 0;
    let costesDelDia = 0;
    /* Entradas, salidas y canjes de títulos sin efectivo: se valoran con el precio del día, más abajo. */
    const enEspecie: Array<{ activoId: string; titulos: number; signo: 1 | -1; externo: boolean; contraId?: string }> = [];

    if (foto) {
      for (const [divisa, saldo] of foto.efectivo) efectivoHoy.set(divisa, saldo);
      for (const [activoId, titulos] of foto.titulos) estadoDe(activoId).titulos = titulos;

      for (const apunte of foto.apuntes) {
        const efecto = apunte.efecto;
        switch (efecto.clase) {
          case "efectivo":
            /* Un apunte en otra divisa, aunque el saldo vuelva a cero el mismo día, puede dejar efecto divisa. */
            if (efecto.divisa !== base) huboOtraDivisaAyer = true;
            break;
          case "flujoExterno": {
            const importe = aNumero(efecto.importe) * aBase(efecto.divisa, dia);
            if (importe >= 0) entradas += importe;
            else salidas += importe;
            break;
          }
          case "alta":
          case "baja": {
            const estado = estadoDe(efecto.activoId);
            const signo = efecto.clase === "alta" ? 1 : -1;
            if (efecto.externo) {
              enEspecie.push({ activoId: efecto.activoId, titulos: aNumero(efecto.titulos), signo, externo: true });
              break;
            }
            const dinero = efecto.clase === "alta" ? efecto.pagado : efecto.cobrado;
            const importe = aNumero(dinero.importe);
            const enBase = importe * aBase(dinero.divisa, dia);
            sumar(invertidoBase, efecto.activoId, signo * enBase);
            /* Lo mismo en la divisa del activo, para separar precio y divisa. */
            const divisaDelActivo = estado.activo?.divisa ?? base;
            let enLocal: number;
            if (dinero.divisa === divisaDelActivo) enLocal = importe;
            else if (divisaDelActivo === base) enLocal = enBase;
            else {
              const propio = apunte.movimiento.cambio ? Number(apunte.movimiento.cambio) : Number.NaN;
              const seRefiereAlActivo = divisaDelCambio(apunte.movimiento, base, estado.activo) === divisaDelActivo;
              const cambioDelDia = aBase(divisaDelActivo, dia);
              if (dinero.divisa === base && propio > 0 && seRefiereAlActivo) enLocal = importe * propio;
              else enLocal = cambioDelDia > 0 ? enBase / cambioDelDia : 0;
            }
            sumar(invertidoLocal, efecto.activoId, signo * enLocal);
            break;
          }
          case "canje":
            enEspecie.push({ activoId: efecto.destinoId, titulos: aNumero(efecto.titulosDestino), signo: 1, externo: false, contraId: efecto.activoId });
            break;
          case "ingreso": {
            const importe = aNumero(efecto.neto) * aBase(efecto.divisa, dia);
            ingresosDelDia += importe;
            if (efecto.activoId) estadoDe(efecto.activoId).serie.ingresos[k] += importe;
            else valoracion.ingresosSueltos[k] += importe;
            break;
          }
          case "coste": {
            if (efecto.yaDescontado) break;
            const importe = aNumero(efecto.importe) * aBase(efecto.divisa, dia);
            costesDelDia += importe;
            if (efecto.activoId) estadoDe(efecto.activoId).serie.costes[k] += importe;
            else valoracion.costesSueltos[k] += importe;
            break;
          }
          default:
            break;
        }
      }
    }

    /* Valoración de cada posición al cierre. */
    interface Cierre {
      estado: EstadoDeActivo;
      local: number;
      valor: number;
      cambio: number;
      /** Valor de un título hoy, en la divisa del activo (precio × multiplicador + cupón corrido). */
      unitario: number;
    }
    const cierres: Cierre[] = [];
    for (const estado of estados.values()) {
      const tocado = invertidoBase.has(estado.serie.activoId) || enEspecie.some((e) => e.activoId === estado.serie.activoId || e.contraId === estado.serie.activoId);
      if (estado.titulos <= 0 && estado.valorAyer === 0 && !tocado) continue;
      const activo = estado.activo;
      const punto = estado.precioEn(dia);
      const factor = factorDeSplits(estado, dia);
      const corrido = activo?.bono ? cuponCorrido(activo.bono, dia) : 0;
      const precioAjustado = precioEnTerminosDeLaSerie(estado, punto, dia);
      /* Sin ningún precio la posición cuenta como cero entera, también el cupón corrido de un bono: sin precio, el cupón solo
         no valora nada. Hasta el 20-11-2026 un bono sin precio «valía» su cupón corrido —10,96 € en uno en dólares de 1.000 de
         nominal al 5 %, a los 100 días del cupón y con el dólar a 1,25— mientras su aviso decía que contaba como cero, y ese
         resto entraba en el patrimonio y en la composición. */
      const unitarioAjustado = punto ? precioAjustado * multiplicador(activo) + corrido / factor : 0;
      const cambio = activo ? aBase(activo.divisa, dia) : 1;
      const local = estado.titulos * factor * unitarioAjustado;
      const serie = estado.serie;
      serie.titulos[k] = estado.titulos;
      serie.precio[k] = precioAjustado * factor;
      serie.fuente[k] = punto?.fuente ?? FUENTE.sinPrecio;
      serie.antiguedad[k] = punto ? Math.min(65535, Math.max(0, diasEntre(punto.fecha, dia))) : 0;
      if (!punto && estado.titulos > 0 && !estado.sinPrecioDesde) {
        estado.sinPrecioDesde = dia;
        avisos.push({ codigo: "SIN_PRECIO", activoId: serie.activoId, desde: dia, mensaje: `${activo?.nombre ?? serie.activoId} no tiene ningún precio desde el ${fechaEnTexto(dia)}: cuenta como cero hasta que se le ponga uno.` });
      }
      cierres.push({ estado, local, valor: local * cambio, cambio, unitario: unitarioAjustado * factor });
    }
    const cierreDe = new Map(cierres.map((cierre) => [cierre.estado.serie.activoId, cierre]));

    /* Lo que entra o sale en especie se valora al precio de hoy: es flujo externo y, para la posición, dinero invertido. */
    for (const especie of enEspecie) {
      const cierre = cierreDe.get(especie.activoId);
      if (!cierre) continue;
      const local = especie.titulos * cierre.unitario;
      const enBase = local * cierre.cambio;
      sumar(invertidoBase, especie.activoId, especie.signo * enBase);
      sumar(invertidoLocal, especie.activoId, especie.signo * local);
      if (especie.externo) {
        if (especie.signo > 0) entradas += enBase;
        else salidas -= enBase;
      } else if (especie.contraId) {
        /* Canje: lo que recibe el activo nuevo sale del antiguo, por el mismo valor. */
        const contra = cierreDe.get(especie.contraId);
        sumar(invertidoBase, especie.contraId, -enBase);
        sumar(invertidoLocal, especie.contraId, contra && contra.cambio > 0 ? -enBase / contra.cambio : -enBase);
      }
    }

    let valorDePosiciones = 0;
    let precioDelDia = 0;
    let divisaDePosiciones = 0;
    for (const cierre of cierres) {
      const { estado, local, valor, cambio } = cierre;
      const id = estado.serie.activoId;
      const invertido = invertidoBase.get(id) ?? 0;
      const resultadoBase = valor - estado.valorAyer - invertido;
      const resultadoLocal = local - estado.localAyer - (invertidoLocal.get(id) ?? 0);
      const efectoPrecio = resultadoLocal * cambio;
      const serie = estado.serie;
      serie.valor[k] = valor;
      serie.invertido[k] = invertido;
      serie.efectoPrecio[k] = efectoPrecio;
      serie.efectoDivisa[k] = resultadoBase - efectoPrecio;
      valorDePosiciones += valor;
      precioDelDia += efectoPrecio;
      divisaDePosiciones += resultadoBase - efectoPrecio;
      estado.valorAyer = valor;
      estado.localAyer = local;
    }

    let efectivo = 0;
    let hayOtraDivisa = huboOtraDivisaAyer;
    huboOtraDivisaAyer = false;
    for (const [divisa, saldo] of efectivoHoy) {
      if (saldo === 0) continue;
      efectivo += saldo * aBase(divisa, dia);
      if (divisa !== base) {
        hayOtraDivisa = true;
        huboOtraDivisaAyer = true;
      }
    }

    const valor = valorDePosiciones + efectivo;
    const resultado = valor - valorAyer - entradas - salidas;
    const capital = valorAyer + entradas;
    valoracion.valor[k] = valor;
    valoracion.efectivo[k] = efectivo;
    valoracion.entradas[k] = entradas;
    valoracion.salidas[k] = salidas;
    valoracion.capital[k] = capital;
    /* Lo que queda sin explicar por posiciones, ingresos y costes es la divisa del efectivo: la revalorización de los
       saldos en otra divisa. Si ni hoy ni ayer hubo efectivo en otra divisa, ese resto solo puede ser ruido de coma
       flotante (del orden de 1e-13) y se deja en cero exacto. */
    valoracion.divisaDelEfectivo[k] = hayOtraDivisa ? resultado - precioDelDia - divisaDePosiciones - ingresosDelDia + costesDelDia : 0;
    if (!(capital > 1e-9)) hayDinero = false;
    else if (entradas > 1e-9) hayDinero = true;
    const residual = hayDinero && capital < CAPITAL_RESIDUAL * maximoHastaAyer;
    const encadena = hayDinero && !residual;
    valoracion.rentabilidad[k] = encadena ? (valor - salidas) / capital - 1 : 0;
    valoracion.encadena[k] = encadena ? 1 : 0;
    if (residual && Math.abs(resultado) >= 0.005) {
      sinEncadenar = sinEncadenar ? { desde: sinEncadenar.desde, hasta: dia, resultado: sinEncadenar.resultado + resultado } : { desde: dia, hasta: dia, resultado };
    }
    if (!hayDinero && Math.abs(resultado) >= 0.005) {
      sinCapital = sinCapital ? { desde: sinCapital.desde, hasta: dia, resultado: sinCapital.resultado + resultado } : { desde: dia, hasta: dia, resultado };
    }
    maximoHastaAyer = Math.max(maximoHastaAyer, valor);
    valorAyer = valor;
  }

  if (sinEncadenar) {
    const unDia = sinEncadenar.desde === sinEncadenar.hasta;
    const cuando = unDia ? `El ${fechaEnTexto(sinEncadenar.desde)} la cartera estaba` : `Del ${fechaEnTexto(sinEncadenar.desde)} al ${fechaEnTexto(sinEncadenar.hasta)} la cartera estuvo`;
    const signo = sinEncadenar.resultado < 0 ? "−" : "";
    avisos.push({
      codigo: "CAPITAL_RESIDUAL",
      desde: sinEncadenar.desde,
      mensaje: `${cuando} casi vacía (por debajo del ${cifraEnTexto(CAPITAL_RESIDUAL * 100, 0)} % de lo que había llegado a valer): el resultado de ${unDia ? "ese día" : "esos días"}, ${signo}${cifraEnTexto(Math.abs(sinEncadenar.resultado), 2)} ${base}, no entra en la rentabilidad ponderada por tiempo, porque medido sobre un capital tan pequeño la dispararía. Sí cuenta en el resultado en euros y en la TIR.`
    });
  }

  if (sinCapital) {
    const unDia = sinCapital.desde === sinCapital.hasta;
    const cuando = unDia ? `El ${fechaEnTexto(sinCapital.desde)} la cartera no tenía` : `Del ${fechaEnTexto(sinCapital.desde)} al ${fechaEnTexto(sinCapital.hasta)} la cartera no tuvo`;
    const signo = sinCapital.resultado < 0 ? "−" : "";
    avisos.push({
      codigo: "SIN_CAPITAL",
      desde: sinCapital.desde,
      mensaje: `${cuando} capital del cliente sobre el que medir (lo que valía era cero, negativo o solo lo ganado antes de que llegara el dinero): el resultado de ${unDia ? "ese día" : "esos días"}, ${signo}${cifraEnTexto(Math.abs(sinCapital.resultado), 2)} ${base}, no entra en la rentabilidad ponderada por tiempo, que se encadena desde que hay dinero. Suele ser una compra anotada antes que su aportación, o un cobro que llega a una cartera ya vacía: revisa las fechas. Sí cuenta en el resultado en euros.`
    });
  }

  return valoracion;
}
