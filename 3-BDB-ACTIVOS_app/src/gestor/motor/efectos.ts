/**
 * El contrato entre un tipo de movimiento y el libro.
 *
 * Un tipo de movimiento no escribe en las cuentas: declara qué EFECTOS produce. El libro
 * solo entiende los efectos de este fichero. Añadir un tipo de movimiento es combinar
 * efectos que ya existen en un módulo nuevo de `movimientos/`; el libro no se toca.
 *
 * Un efecto ocurre en la fecha de operación de su movimiento, salvo que lleve su propia
 * `fecha` (la segunda pata de un traspaso que tarda unos días).
 */
import type { Decimal } from "./decimal";
import type { Dia } from "./fechas";
import type { Activo, Movimiento } from "./modelo";

export type CategoriaDeIngreso = "dividendo" | "cupon" | "interes" | "otro";
export type CategoriaDeCoste = "comision" | "gasto" | "impuesto";

export interface ImporteEnDivisa {
  divisa: string;
  importe: Decimal;
}

export type Efecto =
  /**
   * Abono (+) o cargo (−) en la cuenta de efectivo. `transito`: dinero de un traspaso entre
   * fondos que ha salido de uno y aún no ha entrado en el otro; cuenta como patrimonio pero
   * no aparece en el extracto de la cuenta del banco.
   */
  | { clase: "efectivo"; divisa: string; importe: Decimal; transito?: boolean; fecha?: Dia }
  /** Dinero que el cliente mete (+) o saca (−) de la cartera. No es resultado. */
  | { clase: "flujoExterno"; divisa: string; importe: Decimal }
  /**
   * Entran títulos en la cuenta de valores. `pagado` es lo que costaron, todo incluido:
   * es el coste del lote. `externo`: llegan de fuera sin pasar por el efectivo, y su valor
   * de mercado de ese día cuenta como aportación.
   */
  | { clase: "alta"; activoId: string; titulos: Decimal; pagado: ImporteEnDivisa; externo: boolean; fecha?: Dia }
  /**
   * Salen títulos. `cobrado` es lo que se obtuvo, neto. `realiza`: si la salida cierra los
   * lotes con resultado (una venta sí; una entrega de títulos a otra entidad, no).
   */
  | { clase: "baja"; activoId: string; titulos: Decimal; cobrado: ImporteEnDivisa; externo: boolean; realiza: boolean }
  /** Split o contrasplit: los títulos de cada lote se multiplican por `factor`; el coste no cambia. */
  | { clase: "ajusteDeTitulos"; activoId: string; factor: Decimal; serieAjustada: boolean }
  /** Canje: los lotes pasan a otro activo conservando coste y fecha. Sin `titulos`, se canjea toda la posición. */
  | { clase: "canje"; activoId: string; destinoId: string; titulos?: Decimal; titulosDestino: Decimal }
  /** Un ingreso cobrado. `neto` es lo que llegó al efectivo; `bruto` = neto + retención (+ gastos). */
  | { clase: "ingreso"; categoria: CategoriaDeIngreso; activoId?: string; divisa: string; bruto: Decimal; retencion: Decimal; neto: Decimal }
  /**
   * Un coste explícito. `yaDescontado`: va dentro del importe de otra pata (la comisión de
   * una compra está en lo pagado) y por eso se informa pero no se vuelve a restar.
   */
  | { clase: "coste"; categoria: CategoriaDeCoste; activoId?: string; divisa: string; importe: Decimal; yaDescontado: boolean };

export type ClaseDeEfecto = Efecto["clase"];

/** Lo que un tipo de movimiento puede consultar al validar o al producir efectos. */
export interface ContextoDeMovimiento {
  divisaBase: string;
  activo(activoId: string | undefined): Activo | undefined;
}

export type GrupoDeMovimiento = "efectivo" | "compraventa" | "ingresos" | "valores" | "corporativas";

export const NOMBRE_DEL_GRUPO: Record<GrupoDeMovimiento, string> = {
  efectivo: "Efectivo",
  compraventa: "Compras y ventas",
  ingresos: "Ingresos",
  valores: "Títulos sin efectivo",
  corporativas: "Operaciones corporativas"
};

/** Los campos que un formulario puede pedir. Cada tipo dice cuáles usa. */
export type CampoDeMovimiento =
  | "activo"
  | "titulos"
  | "precio"
  | "importe"
  | "comision"
  | "gastos"
  | "retencion"
  | "cuponCorrido"
  | "cambio"
  | "valor"
  | "divisa"
  | "fechaValor"
  | "fechaEx"
  | "destinoActivo"
  | "destinoTitulos"
  | "destinoPrecio"
  | "destinoDivisa"
  | "destinoImporte"
  | "destinoFecha"
  | "razon";

export interface CampoDelTipo {
  campo: CampoDeMovimiento;
  obligatorio: boolean;
  /** Rótulo propio de este tipo («Importe cobrado», «Nominal»). Si falta, el genérico. */
  rotulo?: string;
  ayuda?: string;
}

/** La definición de un tipo de movimiento: lo que el registro guarda de él. */
export interface DefinicionDeMovimiento {
  tipo: string;
  /** Nombre en pantalla: «Compra», «Traspaso entre fondos». */
  nombre: string;
  grupo: GrupoDeMovimiento;
  /** Una frase en lenguaje llano: qué es y qué hace en las dos cuentas. */
  descripcion: string;
  campos: CampoDelTipo[];
  /**
   * Sentido del `importe` en la cuenta de efectivo: −1 carga, +1 abona, 0 no toca el
   * efectivo, «libre» admite los dos signos (intereses, otro cargo o abono).
   */
  signoDelEfectivo: -1 | 0 | 1 | "libre";
  /**
   * Orden dentro de un mismo día: lo que entra va antes que lo que sale. Las compras van
   * antes que las ventas: como las ventas consumen siempre el lote más antiguo, aplicar
   * antes la compra del día no cambia ningún resultado y evita un falso descubierto.
   */
  orden: number;
  /** Solo en un cambio de divisa: sus dos patas de efectivo no cuadran por divisa, y es lo esperado. */
  cambiaDeDivisa?: boolean;
  /** Errores en lenguaje llano. Lista vacía: el movimiento es válido. */
  validar(movimiento: Movimiento, contexto: ContextoDeMovimiento): string[];
  /** Los efectos del movimiento. Solo se llama con un movimiento válido. */
  efectos(movimiento: Movimiento, contexto: ContextoDeMovimiento): Efecto[];
  /**
   * El importe de efectivo que se deduce de los demás campos (títulos × precio ± gastos),
   * con su signo, para proponerlo en el formulario. `undefined` si no se puede deducir.
   */
  importeSugerido?(movimiento: Movimiento, contexto: ContextoDeMovimiento): Decimal | undefined;
}
