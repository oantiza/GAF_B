/**
 * Series de precios ajustadas por dividendos.
 *
 * El problema. La serie de una acción o de un ETF cotizado que da la plataforma es una serie
 * de RENTABILIDAD TOTAL: cada dividendo pagado rebaja todos los precios anteriores, de modo
 * que solo el último precio es el de verdad. Telefónica marca 3,69 € en diciembre de 2024
 * cuando cotizaba a 4,30 €. Si se valorase títulos × ese precio, el día de la compra saldría
 * una pérdida que no existe y cada dividendo cobrado se contaría dos veces: una dentro de la
 * serie y otra como ingreso.
 *
 * La solución. El precio real de un día es la serie multiplicada por un factor k ≥ 1 que
 * vale 1 al final y sube un escalón, hacia atrás, en cada dividendo. El libro sabe qué
 * dividendos cobró la posición, así que k se reconstruye con ellos:
 *
 *     antes de un dividendo bruto D por título:   k = K + D / S      (S: serie de la víspera)
 *     antes de un dividendo en acciones:          k = K × (títulos después / títulos antes)
 *
 * donde K es el factor que rige desde ese día. El ancla (dónde k es conocido):
 *   - una posición que sigue abierta: k = 1 en el último precio de la serie;
 *   - una posición ya cerrada: la serie lleva además los dividendos pagados DESPUÉS de vender,
 *     que el libro no conoce; así que se ancla en su última operación con precio,
 *     k = precio de la operación / serie de ese día.
 *
 * Con todos los dividendos registrados por su bruto, títulos × serie × k es el valor real de
 * la posición cada día. Si falta un dividendo, el total sigue siendo exacto hoy (el ancla es
 * el precio de hoy) y el desajuste queda en el pasado, donde `integridad` lo detecta.
 *
 * La fecha ex (auditoría del 16-11-2026, GES-8). El libro anota el dividendo el día que se cobra,
 * y D por título salía de dividir lo cobrado entre los títulos de ESE día. Si la posición cambió
 * entre la fecha ex y el cobro, D sale mal y con él todos los precios anteriores: con 100 títulos
 * en la fecha ex y la mitad vendida antes de cobrar, D salía el doble y la compra, a 50 €, se
 * valoraba a 51 € (+1,96 % falso ese día). Con `fechaEx` en el dividendo, D sale de los títulos
 * de la víspera de esa fecha, que son los que tenían derecho.
 *
 * El escalón se queda en el día del cobro mientras la posición siga abierta: entre la fecha ex y
 * el cobro el precio reconstruido lleva dentro el dividendo pendiente, y por eso el patrimonio no
 * da un bajón esos días. Queda un resto: los títulos comprados o vendidos entre las dos fechas se
 * valoran con ese dividendo dentro, D × títulos cambiados, hasta el cobro. Si la posición se cerró
 * antes de cobrar —antes ese dividendo se perdía para el factor—, el escalón va en la fecha ex.
 */
import { aNumero } from "./decimal";
import { sumarDias, type Dia } from "./fechas";
import type { Apunte } from "./libro";

interface PuntoDeSerie {
  fecha: Dia;
  valor: number;
}

function ultimoHasta(puntos: PuntoDeSerie[], fecha: Dia): PuntoDeSerie | undefined {
  if (puntos.length === 0 || puntos[0].fecha > fecha) return undefined;
  let bajo = 0;
  let alto = puntos.length - 1;
  while (bajo < alto) {
    const medio = (bajo + alto + 1) >> 1;
    if (puntos[medio].fecha <= fecha) bajo = medio;
    else alto = medio - 1;
  }
  return puntos[bajo];
}

type Suceso =
  | { fecha: Dia; clase: "dividendo"; porTitulo: number }
  | { fecha: Dia; clase: "liberadas"; razon: number }
  | { fecha: Dia; clase: "operacion"; precio: number };

interface Tramo {
  /** El factor rige desde este día, incluido, hasta el siguiente tramo. */
  desde: Dia;
  k: number;
}

export interface FactorDeLaSerie {
  /** El factor por el que multiplicar la serie un día para obtener el precio real de ese día. */
  en(fecha: Dia): number;
  /** Si hubo que anclar algún periodo ya cerrado en el precio de su última operación. */
  tramos: Tramo[];
}

const SIN_AJUSTE: FactorDeLaSerie = { en: () => 1, tramos: [] };

/**
 * El factor de una serie ajustada por dividendos, a partir de los apuntes de un activo.
 *
 * @param apuntes  Todos los apuntes del libro, en orden.
 * @param serie    La serie de la plataforma, en la divisa del activo, ya en los mismos
 *                 términos de splits que los títulos «ajustados» (ver `titulosAjustados`).
 * @param factorDeSplits  Por cuánto multiplicar los títulos reales de un día para ponerlos
 *                 en los términos de la serie (los splits posteriores).
 * @param aLocal   Convierte un importe de una divisa a la del activo en una fecha, o
 *                 `undefined` si no hay cambio.
 */
export function factorDeLaSerie(
  activoId: string,
  apuntes: readonly Apunte[],
  serie: PuntoDeSerie[],
  factorDeSplits: (fecha: Dia) => number,
  aLocal: (importe: number, divisa: string, apunte: Apunte) => number | undefined
): FactorDeLaSerie {
  if (serie.length === 0) return SIN_AJUSTE;

  /* 1. Los sucesos del activo, por periodos de tenencia (de tener títulos a no tenerlos). */
  const periodos: Array<{ sucesos: Suceso[]; abierto: boolean }> = [];
  let actual: { sucesos: Suceso[]; abierto: boolean } | undefined;
  let titulos = 0; // en términos de la serie
  /* Los títulos al cierre de cada día con cambios, y en qué periodo: para saber cuántos había la víspera de una fecha ex. */
  const tenencia: Array<{ fecha: Dia; titulos: number; periodo: { sucesos: Suceso[]; abierto: boolean } | undefined }> = [];
  const apuntarTenencia = (fecha: Dia, periodo: { sucesos: Suceso[]; abierto: boolean } | undefined): void => {
    const ultima = tenencia.at(-1);
    if (ultima && ultima.fecha === fecha) {
      ultima.titulos = titulos;
      ultima.periodo = periodo;
    } else tenencia.push({ fecha, titulos, periodo });
  };
  const tenenciaAntesDe = (fecha: Dia) => {
    for (let i = tenencia.length - 1; i >= 0; i -= 1) if (tenencia[i].fecha < fecha) return tenencia[i];
    return undefined;
  };

  const abrir = (): { sucesos: Suceso[]; abierto: boolean } => {
    if (!actual) {
      actual = { sucesos: [], abierto: true };
      periodos.push(actual);
    }
    return actual;
  };
  const cerrarSiVacio = (): void => {
    if (actual && titulos <= 1e-9) {
      actual.abierto = false;
      actual = undefined;
      titulos = 0;
    }
  };

  for (const apunte of apuntes) {
    const efecto = apunte.efecto;
    const factor = factorDeSplits(apunte.fecha);
    switch (efecto.clase) {
      case "alta": {
        if (efecto.activoId !== activoId) break;
        const entran = aNumero(efecto.titulos) * factor;
        const periodo = abrir();
        const gratis = !efecto.externo && efecto.pagado.importe.eq(0);
        if (gratis && titulos > 0) {
          /* Acciones liberadas: la serie las trata como un dividendo. */
          periodo.sucesos.push({ fecha: apunte.fecha, clase: "liberadas", razon: (titulos + entran) / titulos });
        } else {
          const movimiento = apunte.movimiento;
          const declarado = movimiento.activoId === activoId ? movimiento.precio : movimiento.destino?.precio;
          const precio = declarado !== undefined ? Number(declarado) / factor : Number.NaN;
          if (precio > 0) periodo.sucesos.push({ fecha: apunte.fecha, clase: "operacion", precio });
        }
        titulos += entran;
        apuntarTenencia(apunte.fecha, periodo);
        break;
      }
      case "baja": {
        if (efecto.activoId !== activoId || !actual) break;
        const precio = apunte.movimiento.activoId === activoId && apunte.movimiento.precio !== undefined ? Number(apunte.movimiento.precio) / factor : Number.NaN;
        if (precio > 0) actual.sucesos.push({ fecha: apunte.fecha, clase: "operacion", precio });
        titulos -= aNumero(efecto.titulos) * factor;
        cerrarSiVacio();
        apuntarTenencia(apunte.fecha, actual);
        break;
      }
      case "canje": {
        if (efecto.activoId === activoId && actual) {
          titulos = efecto.titulos ? titulos - aNumero(efecto.titulos) * factor : 0;
          cerrarSiVacio();
          apuntarTenencia(apunte.fecha, actual);
        } else if (efecto.destinoId === activoId) {
          const periodo = abrir();
          titulos += aNumero(efecto.titulosDestino) * factor;
          apuntarTenencia(apunte.fecha, periodo);
        }
        break;
      }
      case "ingreso": {
        if (efecto.activoId !== activoId || efecto.categoria !== "dividendo") break;
        const fechaEx = apunte.movimiento.fechaEx;
        const conDerecho = fechaEx !== undefined && fechaEx <= apunte.fecha ? tenenciaAntesDe(fechaEx) : undefined;
        if (conDerecho?.periodo && conDerecho.titulos > 1e-9 && fechaEx !== undefined) {
          const bruto = aLocal(aNumero(efecto.bruto), efecto.divisa, apunte);
          if (bruto === undefined || bruto <= 0) break;
          const porTitulo = bruto / conDerecho.titulos;
          if (conDerecho.periodo === actual && titulos > 1e-9) actual.sucesos.push({ fecha: apunte.fecha, clase: "dividendo", porTitulo });
          else {
            /* La posición con derecho ya se cerró: el escalón va en la fecha ex, delante de lo que pasara ese mismo día. */
            const sucesos = conDerecho.periodo.sucesos;
            const sitio = sucesos.findIndex((suceso) => suceso.fecha >= fechaEx);
            sucesos.splice(sitio === -1 ? sucesos.length : sitio, 0, { fecha: fechaEx, clase: "dividendo", porTitulo });
          }
          break;
        }
        if (!actual || titulos <= 1e-9) break;
        const bruto = aLocal(aNumero(efecto.bruto), efecto.divisa, apunte);
        if (bruto !== undefined && bruto > 0) actual.sucesos.push({ fecha: apunte.fecha, clase: "dividendo", porTitulo: bruto / titulos });
        break;
      }
      default:
        break;
    }
  }

  /* 2. Por cada periodo: se fija k en el ancla y se propaga hacia atrás (y hacia delante, si el ancla no es el final). */
  const tramos: Tramo[] = [];
  const serieDeLaVispera = (fecha: Dia): number => ultimoHasta(serie, sumarDias(fecha, -1))?.valor ?? ultimoHasta(serie, fecha)?.valor ?? 0;

  for (const periodo of periodos) {
    const sucesos = periodo.sucesos;
    if (sucesos.length === 0) continue;
    let indiceDelAncla = sucesos.length; // «después del último suceso»: k = 1
    let kDelAncla = 1;
    if (!periodo.abierto) {
      for (let i = sucesos.length - 1; i >= 0; i -= 1) {
        const suceso = sucesos[i];
        if (suceso.clase !== "operacion") continue;
        const enSerie = ultimoHasta(serie, suceso.fecha)?.valor ?? 0;
        const razon = enSerie > 0 ? suceso.precio / enSerie : 1;
        /* Un precio de operación disparatado (un error de tecleo) no debe torcer toda la valoración. */
        if (razon > 0.2 && razon < 5) {
          indiceDelAncla = i;
          kDelAncla = razon;
        }
        break;
      }
    }

    /* Hacia atrás: el factor que rige ANTES de cada suceso. */
    let k = kDelAncla;
    const anteriores: Tramo[] = [];
    for (let i = Math.min(indiceDelAncla, sucesos.length) - 1; i >= 0; i -= 1) {
      const suceso = sucesos[i];
      anteriores.push({ desde: suceso.fecha, k });
      if (suceso.clase === "dividendo") {
        const vispera = serieDeLaVispera(suceso.fecha);
        if (vispera > 0) k += suceso.porTitulo / vispera;
      } else if (suceso.clase === "liberadas") {
        k *= suceso.razon;
      }
    }
    /* El tramo más antiguo del periodo rige desde antes de su primer suceso. */
    anteriores.push({ desde: "0000-01-01", k });
    anteriores.reverse();
    /* El primer tramo de un periodo no debe pisar los periodos anteriores: empieza donde empieza el periodo. */
    anteriores[0].desde = tramos.length === 0 ? "0000-01-01" : sucesos[0].fecha;
    tramos.push(...anteriores);

    /* Hacia delante desde el ancla, si quedan sucesos después de ella. */
    k = kDelAncla;
    for (let i = indiceDelAncla + 1; i < sucesos.length; i += 1) {
      const suceso = sucesos[i];
      if (suceso.clase === "dividendo") {
        const vispera = serieDeLaVispera(suceso.fecha);
        if (vispera > 0) k = Math.max(1e-6, k - suceso.porTitulo / vispera);
      } else if (suceso.clase === "liberadas") {
        k /= suceso.razon;
      } else continue;
      tramos.push({ desde: suceso.fecha, k });
    }
  }

  /* Tramos con la misma fecha: manda el último (el que rige desde ese día). */
  const limpios: Tramo[] = [];
  for (const tramo of tramos) {
    const ultimo = limpios[limpios.length - 1];
    if (ultimo && ultimo.desde === tramo.desde) ultimo.k = tramo.k;
    else if (!ultimo || Math.abs(ultimo.k - tramo.k) > 1e-12) limpios.push({ ...tramo });
  }
  if (limpios.every((tramo) => Math.abs(tramo.k - 1) < 1e-12)) return SIN_AJUSTE;

  return {
    tramos: limpios,
    en(fecha) {
      let k = limpios[0].k;
      for (const tramo of limpios) {
        if (tramo.desde <= fecha) k = tramo.k;
        else break;
      }
      return k;
    }
  };
}
