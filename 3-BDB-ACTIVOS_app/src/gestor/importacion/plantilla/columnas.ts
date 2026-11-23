/**
 * La definición de la plantilla genérica de movimientos.
 *
 * La plantilla es un formato propio, en CSV o Excel, para cargar movimientos de cualquier
 * entidad que no tenga importador. De las listas de este fichero salen a la vez el lector
 * (qué cabeceras se reconocen), la plantilla descargable y su hoja de instrucciones: cambiar
 * una columna aquí la cambia en los tres sitios.
 *
 * Las cabeceras se reconocen por su nombre sin distinguir mayúsculas, tildes, espacios ni
 * guiones, y con sinónimos. Los tipos de movimiento se reconocen por su nombre en pantalla,
 * por su clave del registro o por un sinónimo de `SINONIMOS_DE_TIPOS`.
 */
import type { CampoDeMovimiento, DefinicionDeMovimiento } from "../../motor/efectos";
import type { TipoDeActivo } from "../../motor/modelo";
import { TIPOS } from "../../motor/movimientos/registro";

export type ClaveDeColumna =
  | "fecha"
  | "fechaValor"
  | "tipo"
  | "isin"
  | "nombre"
  | "titulos"
  | "precio"
  | "divisaActivo"
  | "importe"
  | "divisa"
  | "comision"
  | "gastos"
  | "retencion"
  | "cuponCorrido"
  | "cambio"
  | "valor"
  | "isinDestino"
  | "nombreDestino"
  | "titulosDestino"
  | "precioDestino"
  | "fechaDestino"
  | "divisaDestino"
  | "importeDestino"
  | "proporcion"
  | "nota";

/** «siempre»: sin ella no se importa la fila. «segunTipo»: la exigen algunos tipos. «no»: opcional. */
export type ObligatoriedadDeColumna = "siempre" | "segunTipo" | "no";

export interface ColumnaDeLaPlantilla<Clave extends string = string> {
  clave: Clave;
  /** El nombre que lleva la cabecera de la plantilla descargable. */
  nombre: string;
  /** Otros nombres de cabecera que se aceptan al leer. */
  sinonimos: readonly string[];
  obligatoria: ObligatoriedadDeColumna;
  descripcion: string;
  ejemplo: string;
  /**
   * El campo del movimiento que alimenta. Si el tipo de la fila no usa ese campo
   * (`DefinicionDeMovimiento.campos`), la columna se ignora en esa fila. Sin campo: la usan todos.
   */
  campo?: CampoDeMovimiento;
}

export const COLUMNAS_DE_MOVIMIENTOS: readonly ColumnaDeLaPlantilla<ClaveDeColumna>[] = [
  {
    clave: "fecha",
    nombre: "Fecha",
    sinonimos: ["Fecha de operación", "Fecha operación", "Fecha de contratación", "Fecha contratación", "Fecha de ejecución", "Date", "Trade date"],
    obligatoria: "siempre",
    descripcion: "Fecha de operación (contratación). Admite dd/mm/aaaa, dd-mm-aaaa, aaaa-mm-dd y el número de serie de fecha de Excel.",
    ejemplo: "07/01/2026"
  },
  {
    clave: "fechaValor",
    nombre: "Fecha valor",
    sinonimos: ["Fecha de valor", "Fecha liquidación", "Fecha de liquidación", "Value date", "Settlement date"],
    obligatoria: "no",
    descripcion: "Fecha de liquidación. En blanco, la de operación.",
    ejemplo: "09/01/2026",
    campo: "fechaValor"
  },
  {
    clave: "tipo",
    nombre: "Tipo",
    sinonimos: ["Tipo de movimiento", "Tipo de operación", "Operación", "Movimiento", "Type"],
    obligatoria: "siempre",
    descripcion: "Qué es el movimiento: su nombre («Compra», «Suscripción de fondo», «Dividendo»…) o su clave («compra», «suscripcion»…). Los tipos admitidos y sus otros nombres están más abajo.",
    ejemplo: "Compra"
  },
  {
    clave: "isin",
    nombre: "ISIN",
    sinonimos: ["Código ISIN", "Cód. ISIN"],
    obligatoria: "segunTipo",
    descripcion: "ISIN del activo. Si no hay ISIN, el activo se identifica por su nombre.",
    ejemplo: "ZZ0000000011",
    campo: "activo"
  },
  {
    clave: "nombre",
    nombre: "Nombre",
    sinonimos: ["Nombre del activo", "Activo", "Instrumento", "Producto", "Valor/Fondo", "Name"],
    obligatoria: "segunTipo",
    descripcion: "Nombre del activo. Obligatorio si el activo no tiene ISIN.",
    ejemplo: "Acción Ejemplo, S.A.",
    campo: "activo"
  },
  {
    clave: "titulos",
    nombre: "Títulos",
    sinonimos: ["Participaciones", "Acciones", "Nominal", "Cantidad", "Unidades", "Número de títulos", "Quantity", "Shares"],
    obligatoria: "segunTipo",
    descripcion: "Número de títulos, participaciones o nominal de un bono. Siempre positivo: el sentido lo da el tipo.",
    ejemplo: "500",
    campo: "titulos"
  },
  {
    clave: "precio",
    nombre: "Precio",
    sinonimos: ["Precio unitario", "Cotización", "Valor liquidativo", "Price"],
    obligatoria: "no",
    descripcion: "Precio por título, en la divisa del activo. En un bono, en % del nominal.",
    ejemplo: "20",
    campo: "precio"
  },
  {
    clave: "divisaActivo",
    nombre: "Divisa del activo",
    sinonimos: ["Moneda del activo", "Divisa activo", "Divisa de cotización"],
    obligatoria: "no",
    descripcion: "Divisa en la que cotiza el activo. En blanco, la divisa base de la cartera.",
    ejemplo: "EUR",
    campo: "activo"
  },
  {
    clave: "importe",
    nombre: "Importe",
    sinonimos: ["Importe neto", "Efectivo", "Importe efectivo", "Neto", "Amount", "Net amount"],
    obligatoria: "segunTipo",
    descripcion: "Efecto en la cuenta de efectivo, con todo incluido. Con o sin signo: el signo lo pone el tipo (una compra carga, una venta abona). En los intereses, en otro cargo o abono y en la retención, el signo del fichero manda: negativo carga, positivo abona.",
    ejemplo: "-10012",
    campo: "importe"
  },
  {
    clave: "divisa",
    nombre: "Divisa",
    sinonimos: ["Moneda", "Divisa de la cuenta", "Divisa del efectivo", "Currency"],
    obligatoria: "no",
    descripcion: "Divisa de la cuenta de efectivo que se mueve. En blanco, la divisa base de la cartera.",
    ejemplo: "EUR",
    campo: "divisa"
  },
  {
    clave: "comision",
    nombre: "Comisión",
    sinonimos: ["Comisiones", "Corretaje", "Fee", "Fees"],
    obligatoria: "no",
    descripcion: "Comisión, en positivo. Ya va incluida en el importe.",
    ejemplo: "10",
    campo: "comision"
  },
  {
    clave: "gastos",
    nombre: "Gastos",
    sinonimos: ["Gasto", "Otros gastos", "Cánones"],
    obligatoria: "no",
    descripcion: "Otros gastos, en positivo. Ya van incluidos en el importe.",
    ejemplo: "2",
    campo: "gastos"
  },
  {
    clave: "retencion",
    nombre: "Retención",
    sinonimos: ["Retenciones", "Withholding", "Withholding tax"],
    obligatoria: "no",
    descripcion: "Retención fiscal, en positivo. Ya está descontada del importe: el bruto es el importe más la retención.",
    ejemplo: "38",
    campo: "retencion"
  },
  {
    clave: "cuponCorrido",
    nombre: "Cupón corrido",
    sinonimos: ["Interés corrido", "Intereses corridos", "Accrued interest"],
    obligatoria: "no",
    descripcion: "Cupón corrido de un bono, en positivo. Ya va incluido en el importe.",
    ejemplo: "50",
    campo: "cuponCorrido"
  },
  {
    clave: "cambio",
    nombre: "Cambio",
    sinonimos: ["Tipo de cambio", "Tipo cambio", "FX", "FX rate", "Exchange rate"],
    obligatoria: "no",
    descripcion: "Tipo de cambio de la operación: unidades de la divisa extranjera por 1 de la divisa base (1 EUR = 1,0825 USD se escribe 1,0825).",
    ejemplo: "1,0825",
    campo: "cambio"
  },
  {
    clave: "valor",
    nombre: "Valor",
    sinonimos: ["Importe traspasado", "Valor traspasado", "Coste total", "Coste"],
    obligatoria: "segunTipo",
    descripcion: "Importe traspasado en un traspaso entre fondos, o coste total de una entrada de títulos. No pasa por la cuenta de efectivo.",
    ejemplo: "10600",
    campo: "valor"
  },
  {
    clave: "isinDestino",
    nombre: "ISIN destino",
    sinonimos: ["ISIN de destino", "ISIN recibido"],
    obligatoria: "segunTipo",
    descripcion: "Traspasos y canjes: ISIN del activo que se recibe.",
    ejemplo: "ZZ0000000045",
    campo: "destinoActivo"
  },
  {
    clave: "nombreDestino",
    nombre: "Nombre destino",
    sinonimos: ["Nombre de destino", "Activo destino", "Fondo destino", "Fondo de destino", "Activo recibido"],
    obligatoria: "segunTipo",
    descripcion: "Traspasos y canjes: nombre del activo que se recibe. Obligatorio si no tiene ISIN.",
    ejemplo: "Fondo Ejemplo Bolsa, FI",
    campo: "destinoActivo"
  },
  {
    clave: "titulosDestino",
    nombre: "Títulos destino",
    sinonimos: ["Títulos de destino", "Participaciones destino", "Participaciones de destino", "Títulos recibidos"],
    obligatoria: "segunTipo",
    descripcion: "Traspasos y canjes: títulos o participaciones que se reciben.",
    ejemplo: "1000",
    campo: "destinoTitulos"
  },
  {
    clave: "precioDestino",
    nombre: "Precio destino",
    sinonimos: ["Precio de destino", "Valor liquidativo destino", "Valor liquidativo de destino"],
    obligatoria: "no",
    descripcion: "Traspasos: valor liquidativo del fondo de destino.",
    ejemplo: "10,6",
    campo: "destinoPrecio"
  },
  {
    clave: "fechaDestino",
    nombre: "Fecha destino",
    sinonimos: ["Fecha de destino", "Fecha de llegada", "Fecha llegada"],
    obligatoria: "no",
    descripcion: "Traspasos: día en que entran las participaciones del fondo de destino, si no es el de operación.",
    ejemplo: "13/05/2026",
    campo: "destinoActivo"
  },
  {
    clave: "divisaDestino",
    nombre: "Divisa destino",
    sinonimos: ["Divisa de destino", "Divisa que entra"],
    obligatoria: "segunTipo",
    descripcion: "Cambio de divisa: la divisa que entra.",
    ejemplo: "USD",
    campo: "destinoDivisa"
  },
  {
    clave: "importeDestino",
    nombre: "Importe destino",
    sinonimos: ["Importe de destino", "Importe que entra"],
    obligatoria: "segunTipo",
    descripcion: "Cambio de divisa: el importe que entra, en la divisa de destino.",
    ejemplo: "9750",
    campo: "destinoImporte"
  },
  {
    clave: "proporcion",
    nombre: "Proporción",
    sinonimos: ["Razón", "Ratio", "Factor"],
    obligatoria: "segunTipo",
    descripcion: "Split: títulos nuevos por cada antiguo (2 en un split de 2 por 1; 0,1 en un contrasplit de 1 por 10).",
    ejemplo: "2",
    campo: "razon"
  },
  {
    clave: "nota",
    nombre: "Nota",
    sinonimos: ["Notas", "Comentario", "Comentarios", "Observaciones", "Concepto"],
    obligatoria: "no",
    descripcion: "Texto libre. Se guarda con el movimiento.",
    ejemplo: "Custodia del primer trimestre"
  }
];

export type ClaveDeColumnaDePosiciones = "fecha" | "isin" | "nombre" | "titulos" | "valor" | "precio" | "divisa";

/** La hoja opcional «Posiciones»: lo que la entidad declara que hay a una fecha, para conciliar. */
export const COLUMNAS_DE_POSICIONES: readonly ColumnaDeLaPlantilla<ClaveDeColumnaDePosiciones>[] = [
  {
    clave: "fecha",
    nombre: "Fecha",
    sinonimos: ["Fecha del extracto", "Fecha de valoración", "Date"],
    obligatoria: "siempre",
    descripcion: "Fecha a la que la entidad declara la posición.",
    ejemplo: "31/12/2026"
  },
  {
    clave: "isin",
    nombre: "ISIN",
    sinonimos: ["Código ISIN"],
    obligatoria: "segunTipo",
    descripcion: "ISIN del activo. En blanco en las filas de efectivo.",
    ejemplo: "ZZ0000000045"
  },
  {
    clave: "nombre",
    nombre: "Nombre",
    sinonimos: ["Nombre del activo", "Activo", "Instrumento", "Producto", "Name"],
    obligatoria: "segunTipo",
    descripcion: "Nombre del activo. En las filas de efectivo, «Efectivo».",
    ejemplo: "Fondo Ejemplo Bolsa, FI"
  },
  {
    clave: "titulos",
    nombre: "Títulos",
    sinonimos: ["Participaciones", "Acciones", "Nominal", "Cantidad", "Unidades", "Quantity"],
    obligatoria: "segunTipo",
    descripcion: "Títulos, participaciones o nominal que declara la entidad. En blanco en las filas de efectivo.",
    ejemplo: "1000"
  },
  {
    clave: "valor",
    nombre: "Valor",
    sinonimos: ["Valor de mercado", "Valoración", "Saldo", "Valor en euros"],
    obligatoria: "no",
    descripcion: "Valor de mercado en la divisa base de la cartera. En las filas de efectivo, el saldo en su divisa.",
    ejemplo: "11200"
  },
  /* A-210 (21-11-2026): el precio de mercado en la divisa del activo, como el que trae un extracto de Andbank (A-205). Va con
     la divisa al lado: sin ella no se usa. */
  {
    clave: "precio",
    nombre: "Precio",
    sinonimos: ["Precio de mercado", "Cotización", "Valor liquidativo", "Price"],
    obligatoria: "no",
    descripcion: "Precio de mercado por título, en la divisa del activo, que va en «Divisa». En un bono, en % del nominal. Con él la posición se valora a ese precio; en blanco, el precio se deduce del valor en la divisa base, con el cambio del día.",
    ejemplo: "11,2"
  },
  {
    clave: "divisa",
    nombre: "Divisa",
    sinonimos: ["Moneda", "Currency"],
    obligatoria: "no",
    descripcion: "En las filas de efectivo, la divisa del saldo (en blanco, la base). En las de un activo, su divisa, que es también la del precio: con precio, no puede ir en blanco.",
    ejemplo: "EUR"
  }
];

/**
 * Otros nombres de cada tipo de movimiento, además de su nombre en pantalla y su clave.
 * PARA AÑADIR UNO: una línea aquí. Se comparan sin mayúsculas, tildes, espacios ni signos.
 */
export const SINONIMOS_DE_TIPOS: Readonly<Record<string, readonly string[]>> = {
  compra: ["Compra de valores", "Compra de acciones", "Compra de bonos", "Compra de ETF", "Buy"],
  venta: ["Venta de valores", "Venta de acciones", "Venta de bonos", "Venta de ETF", "Sell"],
  suscripcion: ["Suscripción", "Compra de fondo", "Compra de fondos", "Suscripción de fondos"],
  reembolso: ["Reembolso", "Venta de fondo", "Venta de fondos", "Reembolso de fondos"],
  traspaso: ["Traspaso", "Traspaso de fondos", "Traspaso entre fondos"],
  aportacion: ["Ingreso", "Ingreso en cuenta", "Ingreso de efectivo", "Transferencia recibida", "Aportación de efectivo", "Depósito", "Deposit"],
  retirada: ["Reintegro", "Transferencia emitida", "Retirada de efectivo", "Withdrawal"],
  dividendo: ["Dividendos", "Dividendo en efectivo", "Dividend"],
  cupon: ["Cupones", "Pago de cupón", "Coupon"],
  interes: ["Intereses", "Interés", "Intereses de la cuenta", "Interest"],
  comision: ["Comisión", "Comisiones", "Gasto", "Gastos", "Comisión de custodia", "Custodia", "Fee"],
  retencion: ["Retención", "Retenciones", "Impuesto", "Impuestos", "Tax"],
  cambioDeDivisa: ["Cambio de moneda", "Conversión de divisa", "Compraventa de divisa", "FX"],
  otroEfectivo: ["Otro", "Otro cargo", "Otro abono", "Abono", "Cargo", "Regularización"],
  entradaDeTitulos: ["Traspaso de entrada", "Recepción de títulos", "Alta de títulos", "Posición inicial"],
  salidaDeTitulos: ["Traspaso de salida", "Entrega de títulos", "Baja de títulos"],
  dividendoEnAcciones: ["Scrip", "Scrip dividend", "Acciones liberadas", "Ampliación liberada"],
  split: ["Contrasplit", "Desdoblamiento", "Agrupación de acciones"],
  canje: ["Fusión", "Cambio de ISIN", "Canje de valores"],
  amortizacion: ["Amortización", "Vencimiento", "Amortización de bono"]
};

/**
 * Los rótulos de compra o venta que dicen además qué se compra o se vende. Cada uno es un sinónimo de `SINONIMOS_DE_TIPOS`.
 * Una «Compra» a secas no dice nada del activo: la lectura supone «acción» y la revisión pregunta si el activo es nuevo
 * (22-11-2026: 10.000 de nominal de un bono al 98,5 comprados con «Compra» valían 985.000 €).
 */
export const TIPO_DE_ACTIVO_DE_LOS_ROTULOS: Readonly<Record<string, TipoDeActivo>> = {
  "Compra de bonos": "BONO",
  "Venta de bonos": "BONO",
  "Compra de acciones": "ACCION",
  "Venta de acciones": "ACCION",
  "Compra de ETF": "ETF",
  "Venta de ETF": "ETF"
};

const TIPO_DE_ACTIVO_POR_ROTULO: ReadonlyMap<string, TipoDeActivo> = new Map(
  Object.entries(TIPO_DE_ACTIVO_DE_LOS_ROTULOS).map(([rotulo, tipo]) => [normalizarRotulo(rotulo), tipo])
);

/** El tipo de activo que dice el rótulo de una compra o una venta («Compra de bonos»), o `undefined` si no dice ninguno. */
export function tipoDeActivoDelRotulo(rotulo: string): TipoDeActivo | undefined {
  return TIPO_DE_ACTIVO_POR_ROTULO.get(normalizarRotulo(rotulo));
}

/** Sin tildes, en minúsculas y sin nada que no sea letra o cifra: «Fecha_Valor» y «fecha valor» son lo mismo. */
export function normalizarRotulo(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Construye el reconocedor de cabeceras de una lista de columnas. Lanza si dos columnas comparten un nombre. */
function reconocedorDeColumnas<Clave extends string>(columnas: readonly ColumnaDeLaPlantilla<Clave>[]): (texto: string) => Clave | undefined {
  const porRotulo = new Map<string, Clave>();
  for (const columna of columnas) {
    for (const rotulo of [columna.nombre, columna.clave, ...columna.sinonimos]) {
      const clave = normalizarRotulo(rotulo);
      const previa = porRotulo.get(clave);
      if (previa !== undefined && previa !== columna.clave) {
        throw new Error(`La cabecera «${rotulo}» de la plantilla sirve para dos columnas: «${previa}» y «${columna.clave}».`);
      }
      porRotulo.set(clave, columna.clave);
    }
  }
  return (texto) => porRotulo.get(normalizarRotulo(texto));
}

export const columnaDeMovimientos = reconocedorDeColumnas(COLUMNAS_DE_MOVIMIENTOS);
export const columnaDePosiciones = reconocedorDeColumnas(COLUMNAS_DE_POSICIONES);

export function definicionDeColumna(clave: ClaveDeColumna): ColumnaDeLaPlantilla<ClaveDeColumna> {
  return COLUMNAS_DE_MOVIMIENTOS.find((columna) => columna.clave === clave)!;
}

const TIPO_POR_ROTULO: ReadonlyMap<string, DefinicionDeMovimiento> = (() => {
  const mapa = new Map<string, DefinicionDeMovimiento>();
  for (const definicion of TIPOS) {
    for (const rotulo of [definicion.tipo, definicion.nombre, ...(SINONIMOS_DE_TIPOS[definicion.tipo] ?? [])]) {
      const clave = normalizarRotulo(rotulo);
      const previa = mapa.get(clave);
      if (previa && previa !== definicion) {
        throw new Error(`El nombre de tipo «${rotulo}» de la plantilla sirve para dos tipos: «${previa.tipo}» y «${definicion.tipo}».`);
      }
      mapa.set(clave, definicion);
    }
  }
  return mapa;
})();

/** El tipo de movimiento que nombra un texto de la columna «Tipo», o `undefined` si no se reconoce. */
export function reconocerTipo(texto: string): DefinicionDeMovimiento | undefined {
  return TIPO_POR_ROTULO.get(normalizarRotulo(texto));
}

/** Las columnas de la plantilla que usa un tipo de movimiento, con si son obligatorias para él. */
export function columnasDelTipo(definicion: DefinicionDeMovimiento): Array<{ columna: ColumnaDeLaPlantilla<ClaveDeColumna>; obligatoria: boolean }> {
  const resultado: Array<{ columna: ColumnaDeLaPlantilla<ClaveDeColumna>; obligatoria: boolean }> = [];
  for (const columna of COLUMNAS_DE_MOVIMIENTOS) {
    if (columna.obligatoria === "siempre") {
      resultado.push({ columna, obligatoria: true });
      continue;
    }
    if (!columna.campo) continue;
    const campo = definicion.campos.find((candidato) => candidato.campo === columna.campo);
    if (!campo) continue;
    /* El activo se cita por ISIN o por nombre: ninguna de las dos columnas es obligatoria por sí sola. */
    const obligatoria = campo.obligatorio && columna.campo !== "activo" && columna.campo !== "destinoActivo";
    resultado.push({ columna, obligatoria });
  }
  return resultado;
}
