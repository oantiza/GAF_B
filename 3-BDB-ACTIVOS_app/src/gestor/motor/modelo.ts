/**
 * El modelo de datos del gestor de carteras: lo que se guarda en el fichero de una cartera.
 *
 * Todo importe, número de títulos, precio o cambio es un `Dec` (texto decimal). Las fechas
 * son días ISO. Este fichero solo tiene tipos y constructores triviales: ninguna cuenta.
 */
import type { Dec } from "./decimal";
import type { Dia } from "./fechas";

export type TipoDeActivo = "FONDO" | "ETF" | "ACCION" | "BONO" | "OTRO";

export const NOMBRE_DEL_TIPO_DE_ACTIVO: Record<TipoDeActivo, string> = {
  FONDO: "Fondos",
  ETF: "ETF",
  ACCION: "Acciones",
  BONO: "Bonos",
  OTRO: "Otros"
};

/** Cómo cuenta los días un bono para repartir su cupón. */
export type BaseDeCalculo = "ACT/ACT" | "30/360" | "ACT/365" | "ACT/360";

/** Las condiciones de un bono: lo necesario para su cupón corrido y su calendario. */
export interface CondicionesDelBono {
  /** Cupón anual en fracción del nominal: «0.035» es un 3,5 %. Cero en un cupón cero. */
  cupon: Dec;
  /** Pagos al año. */
  frecuencia: 1 | 2 | 4 | 12;
  vencimiento: Dia;
  emision?: Dia;
  base: BaseDeCalculo;
  /** Precio de amortización en % del nominal. Por defecto, 100. */
  amortizacion?: Dec;
}

/** Cómo se reparte un activo entre categorías cuando el catálogo no lo dice (activos manuales). */
export interface ClasificacionManual {
  claseDeActivo?: string;
  region?: string;
  sector?: string;
  /** Gastos corrientes anuales en fracción: «0.0125» es un 1,25 %. */
  gastosCorrientes?: Dec;
}

/** Un activo de la cartera: del catálogo de la plataforma o creado a mano. */
export interface Activo {
  /** Identificador dentro de la cartera. Para un activo con ISIN, el propio ISIN. */
  id: string;
  nombre: string;
  tipo: TipoDeActivo;
  /** Divisa en la que cotiza. */
  divisa: string;
  isin?: string;
  ticker?: string;
  /** `catalogo`: sus precios y su ficha llegan de la plataforma. `manual`: los pone el usuario. */
  origen: "catalogo" | "manual";
  /**
   * Valor = títulos × precio × multiplicador. Uno por defecto. Un bono cotiza en % del
   * nominal y sus «títulos» son el nominal, así que su multiplicador es «0.01».
   */
  multiplicador?: Dec;
  bono?: CondicionesDelBono;
  clasificacion?: ClasificacionManual;
}

export interface Cuenta {
  nombre: string;
  entidad?: string;
  /** Número o alias de la cuenta, si el asesor quiere anotarlo. */
  identificador?: string;
}

/** De dónde viene un movimiento. */
export interface OrigenDelMovimiento {
  via: "manual" | "importado" | "demo";
  importacionId?: string;
  documento?: string;
  fila?: number;
  /** El texto original del extracto, para poder comprobarlo en la revisión. */
  textoOriginal?: string;
}

/** El segundo lado de un traspaso, un canje o un cambio de divisa. */
export interface DestinoDelMovimiento {
  activoId?: string;
  titulos?: Dec;
  precio?: Dec;
  divisa?: string;
  /** Importe que entra en la cuenta de efectivo de destino (cambio de divisa). Positivo. */
  importe?: Dec;
  /** Fecha en que llega el destino, si no es la de operación (un traspaso tarda unos días). */
  fecha?: Dia;
}

/**
 * Un apunte del libro. Qué campos usa cada tipo lo dice su definición
 * (`movimientos/<tipo>.ts`); aquí están todos los que puede llevar cualquiera.
 */
export interface Movimiento {
  id: string;
  /** Clave del registro de tipos: «compra», «dividendo»… */
  tipo: string;
  /** Fecha de contratación. Las posiciones y la rentabilidad se miden con ella. */
  fechaOperacion: Dia;
  /** Fecha valor (liquidación). Si falta, es la de operación. */
  fechaValor?: Dia;
  /**
   * Fecha ex-dividendo de un dividendo: el primer día que el título cotiza sin derecho a cobrarlo. Opcional. Con ella,
   * el dividendo por título sale de los títulos de la víspera —los que tenían derecho— y no de los del día del cobro
   * (auditoría del 16-11-2026, GES-8). No mueve el apunte: el efectivo sigue entrando el día del cobro.
   */
  fechaEx?: Dia;
  activoId?: string;
  /** Número de títulos (o nominal de un bono). Siempre positivo: el sentido lo da el tipo. */
  titulos?: Dec;
  /** Precio por título, en la divisa del activo. */
  precio?: Dec;
  /** Divisa de la cuenta de efectivo afectada. Si falta, la divisa base de la cartera. */
  divisa?: string;
  /** Efecto neto en la cuenta de efectivo, CON SIGNO: positivo abona, negativo carga. */
  importe?: Dec;
  /** Desglose ya incluido en `importe`, en su misma divisa y siempre positivo. */
  comision?: Dec;
  gastos?: Dec;
  retencion?: Dec;
  cuponCorrido?: Dec;
  /**
   * Tipo de cambio de la operación: unidades de la divisa extranjera por 1 unidad de la
   * divisa base (la convención del BCE: 1 EUR = 1,0850 USD). Se refiere a la divisa del
   * efectivo si no es la base y, si lo es, a la del activo.
   */
  cambio?: Dec;
  /** Valor económico de una operación que no pasa por el efectivo (traspaso, entrada de títulos). */
  valor?: Dec;
  destino?: DestinoDelMovimiento;
  /** Proporción de un split: títulos nuevos por cada título antiguo («2» en un 2×1, «0.1» en un 1×10). */
  razon?: Dec;
  /** Split: si la serie de precios de la plataforma ya viene ajustada por él. Por defecto, sí. */
  serieAjustada?: boolean;
  /**
   * Cómo se llama el cargo en el papel del cliente («Custodia del segundo semestre»), en una comisión o un gasto. Opcional
   * y corto (`LARGO_DEL_CONCEPTO`). Lo escribe el asesor para el cliente, a diferencia de la `nota`, que es suya y no sale
   * en ningún papel del cliente (P1-11, aprobado por Óscar el 21-11-2026). El informe de costes nombra y agrupa los cargos
   * del servicio con él; sin él, con el nombre del tipo («Comisión o gasto»).
   */
  conceptoCliente?: string;
  nota?: string;
  origen?: OrigenDelMovimiento;
}

/** Lo más largo que puede ser el concepto para el cliente de un cargo: cabe en una línea de la tabla del informe de costes. */
export const LARGO_DEL_CONCEPTO = 60;

export interface PrecioManual {
  activoId: string;
  fecha: Dia;
  precio: Dec;
}

/** Lo que un extracto declara de una posición, para conciliar. */
export interface PosicionDeclarada {
  activoId?: string;
  isin?: string;
  nombre: string;
  titulos: Dec;
  /** Valor de mercado declarado, en la divisa base. */
  valor?: Dec;
  /**
   * El precio de mercado que declara el extracto, en la divisa del activo, y esa divisa (A-205, decisión de Óscar del
   * 21-11-2026). Van juntos: un precio sin su divisa no se usa. Con ellos la posición se valora a ese precio; sin ellos
   * —los ficheros de antes y los extractos que no lo dicen—, el precio se deduce del `valor` en la divisa base con el
   * cambio del día del extracto, como hasta ahora. Opcionales: no cambian la versión del formato. El precio es por título
   * (títulos × precio = valor en esa divisa): en un bono, por unidad de nominal. Lo dan así Andbank y, ya convertido al
   * aplicar la importación, la plantilla (A-210).
   */
  precio?: Dec;
  divisa?: string;
  /**
   * La fecha de la cotización con la que el banco valoró esta posición, si la dice (GES-10, auditoría del 16-11-2026). Un
   * extracto mezcla cotizaciones de días distintos —un fondo publica su valor días después que una acción—, y el precio
   * que se deduce de esta posición es de esta fecha, no de la del extracto. Sin ella, la del extracto.
   */
  fecha?: Dia;
}

/** Lo que un extracto importado dice que hay en la cartera a una fecha. */
export interface ExtractoDeclarado {
  id: string;
  fecha: Dia;
  entidad?: string;
  documento?: string;
  importacionId?: string;
  posiciones: PosicionDeclarada[];
  /** Saldo de efectivo declarado, por divisa. */
  efectivo: Array<{ divisa: string; saldo: Dec }>;
}

/** El registro de una importación: para deshacerla entera y detectar duplicados. */
export interface Importacion {
  id: string;
  /** Fecha y hora ISO en que se confirmó. */
  fecha: string;
  entidad: string;
  documentos: Array<{ nombre: string; tipo: string }>;
  movimientos: number;
}

/**
 * Con qué se compara la cartera. La elección va codificada en `activoId`, sin cambiar el formato
 * del fichero (`motor/referencia.ts`):
 *   - `perfil:<id>`: una de las cinco carteras de referencia (`perfil:equilibrado`), mezcla de dos
 *     fondos con los pesos fijados el primer día del periodo y sin reequilibrar;
 *   - `tipo:ESTR`: la liquidez, el €STR del BCE capitalizado;
 *   - un ISIN tal cual: un activo del catálogo (los índices de la lista lo son).
 * Ningún ISIN lleva dos puntos. `nombre` es el que se enseña.
 */
export interface ReferenciaDeCartera {
  /** El código de la referencia: `perfil:<id>`, `tipo:ESTR` o el ISIN de un activo del catálogo. */
  activoId: string;
  nombre: string;
}

export interface Cartera {
  id: string;
  nombre: string;
  divisaBase: string;
  /** Fecha y hora ISO. */
  creada: string;
  modificada: string;
  /** Opcional. Permite agrupar carteras por cliente o familia más adelante. */
  cliente?: { id?: string; nombre?: string };
  referencia?: ReferenciaDeCartera;
  cuentas: { efectivo: Cuenta; valores: Cuenta };
  activos: Activo[];
  movimientos: Movimiento[];
  preciosManuales: PrecioManual[];
  extractos: ExtractoDeclarado[];
  importaciones: Importacion[];
  notas?: string;
  /**
   * Campo libre que el gestor conserva sin interpretarlo. Lo que venga después
   * (asignación objetivo, mandato, bandas) cabe aquí sin cambiar de versión.
   */
  extensiones?: Record<string, unknown>;
}

/** Un identificador nuevo. `crypto.randomUUID` existe en navegadores y en Node. */
export function nuevoId(): string {
  return globalThis.crypto.randomUUID();
}

export function carteraVacia(datos: { nombre: string; divisaBase?: string; entidad?: string; ahora?: string; id?: string }): Cartera {
  const ahora = datos.ahora ?? new Date().toISOString();
  return {
    id: datos.id ?? nuevoId(),
    nombre: datos.nombre,
    divisaBase: datos.divisaBase ?? "EUR",
    creada: ahora,
    modificada: ahora,
    cuentas: {
      efectivo: { nombre: "Cuenta de efectivo", entidad: datos.entidad },
      valores: { nombre: "Cuenta de valores", entidad: datos.entidad }
    },
    activos: [],
    movimientos: [],
    preciosManuales: [],
    extractos: [],
    importaciones: []
  };
}

export function activoDe(cartera: Cartera, activoId: string | undefined): Activo | undefined {
  return activoId === undefined ? undefined : cartera.activos.find((activo) => activo.id === activoId);
}

/** La divisa de la pata de efectivo de un movimiento. */
export function divisaDelEfectivo(movimiento: Movimiento, divisaBase: string): string {
  return movimiento.divisa ?? divisaBase;
}
