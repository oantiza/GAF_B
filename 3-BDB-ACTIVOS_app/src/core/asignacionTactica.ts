import { importe as escribirImporte, oFalta, peso } from "./formato";
import { updatePortfolioAmount, type PortfolioAmountUpdate } from "./portfolioAmounts";
import { isWeightBalanced } from "./weightTolerance";
import type { BdbManualPortfolioPosition } from "../types/bdbAssets";

/**
 * Las tres cuentas de Diseño de cartera que mueven pesos solo entre lo libre: la asignación táctica por
 * clase (hallazgo 20), «Repartir a partes iguales» (hallazgo 121) y editar un importe con candados
 * (decisión 37).
 *
 * La regla es la del resto de la pantalla: una posición con candado o con importe fijo no se toca.
 * Antes la asignación táctica la ignoraba, y una posición de 30.000 € fijos acababa pesando 20.000 €
 * con el aviso de que todo había ido bien.
 */

type Posicion = Pick<BdbManualPortfolioPosition, "asset_id" | "weight_percent" | "keepEuros">;

const redondea = (valor: number) => Number(valor.toFixed(2));

/** Una centésima de punto: lo que sale de redondear, y no una diferencia que se pueda ver. */
const HOLGURA = 0.01;

function esFija(posicion: Posicion, candados: Readonly<Record<string, boolean>>): boolean {
  return Boolean(candados[posicion.asset_id] || posicion.keepEuros);
}

/** Reparte `total` en proporción al peso de cada una (a partes iguales si todas están a 0 %), con dos
 *  decimales y sin perder ni una centésima: lo que sobra del redondeo va a la mayor. */
function repartirEnProporcion(posiciones: readonly Posicion[], total: number): Record<string, number> {
  const base = posiciones.reduce((suma, posicion) => suma + Math.max(0, posicion.weight_percent || 0), 0);
  const pesos: Record<string, number> = {};
  posiciones.forEach((posicion) => {
    const parte = base > 0 ? Math.max(0, posicion.weight_percent || 0) / base : 1 / posiciones.length;
    pesos[posicion.asset_id] = redondea(total * parte);
  });
  const repartido = posiciones.reduce((suma, posicion) => suma + pesos[posicion.asset_id], 0);
  const resto = redondea(total - repartido);
  if (posiciones.length > 0 && resto !== 0) {
    const mayor = posiciones.reduce((mejor, posicion) => (pesos[posicion.asset_id] > pesos[mejor.asset_id] ? posicion : mejor));
    pesos[mayor.asset_id] = redondea(pesos[mayor.asset_id] + resto);
  }
  return pesos;
}

export interface ClaseQueNoCabe {
  clase: string;
  /** El objetivo pedido, en puntos de 100. */
  objetivo: number;
  /** Lo que ya pesan sus posiciones con candado o importe fijo. */
  fijado: number;
  sentido: "bajar" | "subir";
}

export interface AsignacionPorClase {
  /** Peso nuevo de cada posición libre. Vacío si alguna clase no cabe: o se aplica todo, o nada. */
  pesos: Record<string, number>;
  /** Las clases cuyo objetivo no se puede alcanzar sin tocar lo fijado. */
  noCaben: ClaseQueNoCabe[];
}

/**
 * Reparte el objetivo de cada clase solo entre sus posiciones libres, conservando la proporción que
 * tienen entre ellas. Lo fijado conserva su peso, así que:
 *
 * - Una clase no puede bajar de lo que ya tiene fijado.
 * - Una clase sin posiciones libres se queda exactamente en lo que tiene fijado.
 *
 * Una clase que no aparece en `objetivos` conserva lo que suma ahora.
 */
export function asignarObjetivosPorClase(opciones: {
  positions: readonly Posicion[];
  claseDe: (assetId: string) => string;
  candados: Readonly<Record<string, boolean>>;
  objetivos: Readonly<Record<string, number>>;
}): AsignacionPorClase {
  const { positions, claseDe, candados, objetivos } = opciones;
  const porClase = new Map<string, Posicion[]>();
  positions.forEach((posicion) => {
    const clase = claseDe(posicion.asset_id);
    porClase.set(clase, [...(porClase.get(clase) ?? []), posicion]);
  });

  const pesos: Record<string, number> = {};
  const noCaben: ClaseQueNoCabe[] = [];
  porClase.forEach((miembros, clase) => {
    const libres = miembros.filter((posicion) => !esFija(posicion, candados));
    const fijado = miembros
      .filter((posicion) => esFija(posicion, candados))
      .reduce((suma, posicion) => suma + (posicion.weight_percent || 0), 0);
    const actual = miembros.reduce((suma, posicion) => suma + (posicion.weight_percent || 0), 0);
    const objetivo = objetivos[clase] ?? actual;

    if (objetivo < fijado - HOLGURA) {
      noCaben.push({ clase, objetivo, fijado, sentido: "bajar" });
      return;
    }
    if (libres.length === 0) {
      if (objetivo > fijado + HOLGURA) noCaben.push({ clase, objetivo, fijado, sentido: "subir" });
      return;
    }
    Object.assign(pesos, repartirEnProporcion(libres, Math.max(0, objetivo - fijado)));
  });

  return noCaben.length > 0 ? { pesos: {}, noCaben } : { pesos, noCaben };
}

/** Un peso en puntos (40 es un 40 %), con un decimal: «40,0 %», «33,3 %». */
function pct(puntos: number): string {
  return oFalta(peso(puntos / 100));
}

/** La frase, con la cifra medida: se lee antes de aplicar. */
export function fraseDeClaseQueNoCabe(clase: ClaseQueNoCabe, etiqueta: string): string {
  return clase.sentido === "bajar"
    ? `${etiqueta} no puede bajar al ${pct(clase.objetivo)}: el ${pct(clase.fijado)} está fijado.`
    : `${etiqueta} no puede subir al ${pct(clase.objetivo)}: todas sus posiciones están fijadas en el ${pct(clase.fijado)}.`;
}

/**
 * «Repartir a partes iguales»: lo que dejan libre candados e importes fijos, a partes iguales entre
 * las demás. Es `aPartesIguales` de `repartoDePesos.ts` con lo fijado descontado: todas iguales salvo
 * la última, que se queda con el resto, y la suma es exacta. Se reparte en centésimas enteras y hacia
 * abajo: redondeando hacia arriba, un hueco de 0,05 entre 7 dejaba a la última con −0,01. Si lo fijado
 * ya llega al 100 %, no hay nada que repartir y no devuelve nada.
 */
export function repartirLoLibreAPartesIguales(
  positions: readonly Posicion[],
  candados: Readonly<Record<string, boolean>>
): Record<string, number> {
  const libres = positions.filter((posicion) => !esFija(posicion, candados));
  const fijado = positions
    .filter((posicion) => esFija(posicion, candados))
    .reduce((suma, posicion) => suma + (posicion.weight_percent || 0), 0);
  const hueco = redondea(100 - fijado);
  if (libres.length === 0 || hueco <= 0) return {};
  const cada = Math.floor(Math.round(hueco * 100) / libres.length) / 100;
  const pesos: Record<string, number> = {};
  libres.forEach((posicion) => {
    pesos[posicion.asset_id] = cada;
  });
  pesos[libres[libres.length - 1].asset_id] = redondea(hueco - cada * (libres.length - 1));
  return pesos;
}

/**
 * Lo que deja sumar pesos sin redondear, que son cocientes de céntimos: 100.000 € y 200.000 € pesan 33,33… y 66,66…, y
 * suman 99,99999999999999. Eso no es peso libre, ni un cambio que aplicar: esto, sobre mil millones de euros, es un céntimo.
 */
const RUIDO = 1e-9;

/** Por qué un importe no ha quedado como se pidió. Las cifras, en euros salvo `fijado`, en puntos de 100. */
export type AjusteDelImporte =
  | { motivo: "no-cabe"; pedido: number; queda: number; fijado: number; libresACero: number }
  | { motivo: "unica-libre"; pedido: number; queda: number }
  | { motivo: "sin-capital" };

export interface ImporteEditado {
  update: PortfolioAmountUpdate;
  /** `null` si el importe ha quedado exactamente como se pidió. */
  ajuste: AjusteDelImporte | null;
}

/** Si hay algún peso que editar un importe podría mover. Un candado sobre un 0 % no lo es: 0 sobre cualquier capital es 0. */
export function hayPesoFijado(positions: readonly Posicion[], candados: Readonly<Record<string, boolean>>): boolean {
  return positions.some((posicion) => candados[posicion.asset_id] && (posicion.weight_percent || 0) > 0);
}

/**
 * Editar el importe de una fila. Decisión 37 de Óscar (05-11-2026): manda el peso.
 *
 * Sin peso fijado, lo de siempre: el capital es la suma de los importes y los de las demás filas se conservan. Con
 * él, eso lo movería: el mismo importe sobre otro capital es otro peso. Así que **el capital no cambia**, y el importe
 * se traduce a peso sobre ese capital:
 *
 * - Lo fijado (candados e importes fijos de las demás filas) no se toca, ni en una centésima.
 * - El peso no puede pasar de lo que deja lo fijado: si pide más, se queda ahí y las demás libres pasan a 0.
 * - Si la cartera cuadraba, sigue cuadrando: las demás libres se reparten lo que queda en su proporción, y a partes
 *   iguales si están todas a 0 %. Si no hay otra libre, el importe de la editada es lo que deja lo fijado, pida
 *   lo que pida.
 * - Si no cuadraba, lo que nadie había asignado no se asigna por él: las libres solo bajan si no caben.
 * - Con lo fijado en el 100 % o más no cabe nada y no se toca nada. Con capital 0 no hay sobre qué traducir.
 *
 * Los pesos no se redondean, como en `updatePortfolioAmount`: peso × capital devuelve el euro exacto. La fila fijada
 * no se edita: devuelve `null`, como una cifra que no se puede leer.
 */
export function editarImporte(
  positions: BdbManualPortfolioPosition[],
  totalCapital: number,
  assetId: string,
  euros: number,
  candados: Readonly<Record<string, boolean>>
): ImporteEditado | null {
  const sinPesoFijado = updatePortfolioAmount(positions, totalCapital, assetId, euros);
  if (!sinPesoFijado || candados[assetId]) return null;
  if (!hayPesoFijado(positions, candados)) return { update: sinPesoFijado, ajuste: null };
  if (!(totalCapital > 0)) return { update: { positions, totalCapital }, ajuste: { motivo: "sin-capital" } };

  const pesoDe = (posicion: Posicion) => posicion.weight_percent || 0;
  const suma = (lista: readonly Posicion[]) => lista.reduce((total, posicion) => total + pesoDe(posicion), 0);
  const aEuros = (peso: number) => Math.round((peso / 100) * totalCapital * 100) / 100;

  const editada = positions.find((posicion) => posicion.asset_id === assetId)!;
  const otras = positions.filter((posicion) => posicion !== editada);
  const libres = otras.filter((posicion) => !esFija(posicion, candados));
  const pesoFijado = suma(otras.filter((posicion) => esFija(posicion, candados)));
  const fijado = Math.round(pesoFijado * 1e9) / 1e9;
  const hueco = 100 - pesoFijado;
  const pedido = Math.round(euros * 100) / 100;

  if (hueco <= RUIDO) {
    const sigue = aEuros(pesoDe(editada));
    return {
      update: { positions, totalCapital },
      ajuste: sigue === pedido ? null : { motivo: "no-cabe", pedido, queda: sigue, fijado, libresACero: 0 }
    };
  }

  const cuadraba = isWeightBalanced(suma(positions));
  const pesoPedido = (pedido / totalCapital) * 100;
  const unicaLibre = libres.length === 0 && cuadraba;
  const peso = unicaLibre ? hueco : Math.min(pesoPedido, hueco);
  const queda = aEuros(peso);
  const sumaLibres = suma(libres);
  const loQueDeja = hueco - peso > RUIDO ? hueco - peso : 0;
  const paraLibres = cuadraba ? loQueDeja : Math.min(sumaLibres, loQueDeja);
  const pesoLibre = (posicion: Posicion) => {
    if (paraLibres === sumaLibres) return pesoDe(posicion);
    return sumaLibres > 0 ? (pesoDe(posicion) / sumaLibres) * paraLibres : paraLibres / libres.length;
  };

  const nuevas = positions.map((posicion) => {
    if (posicion === editada) return { ...posicion, weight_percent: peso, ...(posicion.keepEuros ? { targetEuros: queda } : {}) };
    return esFija(posicion, candados) ? posicion : { ...posicion, weight_percent: pesoLibre(posicion) };
  });
  const nadaCambia = nuevas.every((posicion, indice) => Math.abs(posicion.weight_percent - positions[indice].weight_percent) < RUIDO);

  const ajuste: AjusteDelImporte | null =
    queda === pedido
      ? null
      : unicaLibre && pesoPedido < hueco
        ? { motivo: "unica-libre", pedido, queda }
        : {
            motivo: "no-cabe",
            pedido,
            queda,
            fijado,
            libresACero: libres.filter((posicion) => pesoDe(posicion) > 0 && pesoLibre(posicion) <= 0).length
          };
  return { update: { positions: nadaCambia ? positions : nuevas, totalCapital }, ajuste };
}

/** El importe de una posición, con sus céntimos: «60.000,00 €». */
const importe = (valor: number) => oFalta(escribirImporte(valor));

/** La frase que lo dice, con la cifra. `consejo` es lo que puede hacer el asesor para soltar lo fijado. */
export function fraseDelImporteAjustado(ajuste: AjusteDelImporte, nombre: string, consejo: string): string {
  if (ajuste.motivo === "sin-capital") {
    return "Con pesos fijados, un importe se traduce a peso sobre el capital, y el capital está a 0 €: escríbelo primero.";
  }
  if (ajuste.motivo === "unica-libre") {
    return `«${nombre}» es la única posición libre: su importe es lo que deja lo fijado, ${importe(ajuste.queda)}, y no ${importe(ajuste.pedido)}. Para darle otro, ${consejo}.`;
  }
  const lasDemas = ajuste.libresACero === 0 ? "" : ajuste.libresACero === 1 ? ", y la otra posición libre pasa a 0 €" : ", y las otras posiciones libres pasan a 0 €";
  /* Con todo fijado no ayuda subir el capital: el 100 % de cualquier capital sigue sin dejar sitio. */
  const remedio = ajuste.fijado >= 100 ? consejo : `sube el capital o ${consejo}`;
  return `El importe no cabe porque hay un ${pct(ajuste.fijado)} fijado: «${nombre}» se queda en ${importe(ajuste.queda)} en vez de ${importe(ajuste.pedido)}${lasDemas}. Para que quepa, ${remedio}.`;
}
