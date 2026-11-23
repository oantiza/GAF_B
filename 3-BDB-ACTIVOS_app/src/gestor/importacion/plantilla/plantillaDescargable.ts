/**
 * La plantilla que el asesor descarga: las hojas como matrices de celdas y la de
 * movimientos como CSV. No escribe ficheros: otra capa convierte las matrices a Excel.
 *
 * Los ejemplos son una cartera pequeña e inventada que cuadra, con un movimiento de cada
 * tipo registrado. Los ISIN empiezan por «ZZ», que no es el código de ningún país: no
 * pueden confundirse con un activo real. Las cuentas, en EUR:
 *
 *   100.000 aportados − 10.012 (compra) − 25.000 (suscripción) − 9.905 (bono) − 9.000
 *   (a dólares) − 30 (custodia) + 162 (dividendo) + 16,20 (intereses) − 25 (impuesto)
 *   + 5.162 (reembolso) + 283,50 (cupón) + 11 (picos del canje) + 15 (bonificación)
 *   − 5.000 (retirada) + 10.000 (amortización) = 56.677,70 EUR.
 *   En USD: 9.750 − 9.015 (compra) + 3.990 (venta) = 4.725 USD.
 *
 * Que la plantilla sigue cuadrando y cubre todos los tipos lo comprueba
 * `tests/gestor/importacionPlantilla.test.ts`: un tipo nuevo sin ejemplo la hace fallar.
 */
import { aTexto, d } from "../../motor/decimal";
import { NOMBRE_DEL_GRUPO } from "../../motor/efectos";
import { TIPOS, definicionDe } from "../../motor/movimientos/registro";
import {
  COLUMNAS_DE_MOVIMIENTOS,
  COLUMNAS_DE_POSICIONES,
  SINONIMOS_DE_TIPOS,
  columnasDelTipo,
  type ClaveDeColumna,
  type ClaveDeColumnaDePosiciones,
  type ColumnaDeLaPlantilla,
  type ObligatoriedadDeColumna
} from "./columnas";

export type Celda = string | number;

export interface HojaDeLaPlantilla {
  nombre: string;
  filas: Celda[][];
}

export const HOJA_DE_MOVIMIENTOS = "Movimientos";
export const HOJA_DE_POSICIONES = "Posiciones";
export const HOJA_DE_INSTRUCCIONES = "Instrucciones";

const ACCION = { isin: "ZZ0000000011", nombre: "Acción Ejemplo, S.A." };
const ACCION_USD = { isin: "ZZ0000000029", nombre: "Ejemplo Corp.", divisaActivo: "USD" };
const FONDO_RF = { isin: "ZZ0000000037", nombre: "Fondo Ejemplo Renta Fija, FI" };
const FONDO_BOLSA = { isin: "ZZ0000000045", nombre: "Fondo Ejemplo Bolsa, FI" };
const BONO = { isin: "ZZ0000000052", nombre: "Bono Ejemplo 3,5 % 2030" };
const HOLDING = { isin: "ZZ0000000060", nombre: "Ejemplo Holding, S.A." };
/** Un activo sin ISIN: se cita por su nombre. */
const SIN_ISIN = { nombre: "Acción Antigua, S.A." };

type FilaDeEjemplo = { tipo: string } & Partial<Record<Exclude<ClaveDeColumna, "tipo">, Celda>>;

/** Un ejemplo por tipo de movimiento, en orden de fecha. La cuenta de cada importe va a su lado. */
export const EJEMPLOS_DE_MOVIMIENTOS: readonly FilaDeEjemplo[] = [
  { tipo: "aportacion", fecha: "02/01/2026", importe: 100000, nota: "Aportación inicial del cliente" },
  /* Posición que llega de otra entidad: 200 títulos a 15 de coste = 3.000. */
  { tipo: "entradaDeTitulos", fecha: "05/01/2026", ...SIN_ISIN, titulos: 200, precio: 15, divisaActivo: "EUR", nota: "Traspasada desde otra entidad" },
  /* 500 × 20 = 10.000, + 10 de comisión + 2 de gastos = 10.012 cargados. */
  { tipo: "compra", fecha: "07/01/2026", fechaValor: "09/01/2026", ...ACCION, titulos: 500, precio: 20, importe: -10012, comision: 10, gastos: 2 },
  /* 1.000 participaciones × 25 = 25.000. */
  { tipo: "suscripcion", fecha: "08/01/2026", ...FONDO_RF, titulos: 1000, precio: 25, importe: -25000 },
  /* Nominal 10.000 al 98,5 % = 9.850, + 50 de cupón corrido + 5 de comisión = 9.905. */
  { tipo: "compra", fecha: "12/01/2026", ...BONO, titulos: 10000, precio: 98.5, importe: -9905, comision: 5, cuponCorrido: 50, nota: "Bono: títulos es el nominal y el precio va en % del nominal" },
  /* Salen 9.000 EUR y entran 9.750 USD (1,0833 USD por EUR). */
  { tipo: "cambioDeDivisa", fecha: "15/01/2026", importe: -9000, divisa: "EUR", divisaDestino: "USD", importeDestino: 9750 },
  /* 50 × 180 = 9.000 USD, + 15 de comisión = 9.015 USD. El cambio del día (1,0825 USD por EUR) da su coste en euros. */
  { tipo: "compra", fecha: "16/01/2026", ...ACCION_USD, titulos: 50, precio: 180, importe: -9015, divisa: "USD", comision: 15, cambio: 1.0825 },
  { tipo: "comision", fecha: "02/02/2026", importe: -30, nota: "Custodia del primer trimestre" },
  /* 500 títulos × 0,40 = 200 brutos; retención del 19 % = 38; netos 162. */
  { tipo: "dividendo", fecha: "16/02/2026", ...ACCION, importe: 162, retencion: 38 },
  /* Una acción nueva por cada 20: 500 / 20 = 25. */
  { tipo: "dividendoEnAcciones", fecha: "02/03/2026", ...ACCION, titulos: 25 },
  /* 20 brutos; retención del 19 % = 3,80; netos 16,20. */
  { tipo: "interes", fecha: "31/03/2026", importe: 16.2, retencion: 3.8 },
  { tipo: "retencion", fecha: "01/04/2026", importe: -25, nota: "Impuesto cargado suelto en la cuenta" },
  /* 2 por 1: los 50 títulos pasan a 100. */
  { tipo: "split", fecha: "15/04/2026", ...ACCION_USD, proporcion: 2 },
  /* 40 × 100 = 4.000 USD, − 10 de comisión = 3.990 USD. */
  { tipo: "venta", fecha: "20/04/2026", ...ACCION_USD, titulos: 40, precio: 100, importe: 3990, divisa: "USD", comision: 10, cambio: 1.1342 },
  /* 200 × 26 = 5.200; ganancia 200 × (26 − 25) = 200; retención del 19 % = 38; netos 5.162. */
  { tipo: "reembolso", fecha: "04/05/2026", ...FONDO_RF, titulos: 200, precio: 26, importe: 5162, retencion: 38 },
  /* 400 × 26,50 = 10.600 traspasados; 10.600 / 10,60 = 1.000 participaciones de destino. */
  {
    tipo: "traspaso",
    fecha: "11/05/2026",
    ...FONDO_RF,
    titulos: 400,
    precio: 26.5,
    valor: 10600,
    isinDestino: FONDO_BOLSA.isin,
    nombreDestino: FONDO_BOLSA.nombre,
    titulosDestino: 1000,
    precioDestino: 10.6,
    fechaDestino: "13/05/2026"
  },
  /* 10.000 × 3,5 % = 350 brutos; retención del 19 % = 66,50; netos 283,50. */
  { tipo: "cupon", fecha: "12/06/2026", ...BONO, importe: 283.5, retencion: 66.5 },
  /* 525 títulos, una nueva por cada dos: 262,5. Entran 262 y el medio título se cobra: 0,5 × 22 = 11. */
  { tipo: "canje", fecha: "15/06/2026", ...ACCION, titulos: 525, isinDestino: HOLDING.isin, nombreDestino: HOLDING.nombre, titulosDestino: 262, importe: 11, nota: "Fusión por absorción" },
  /* De los 200 títulos, 50 caducan sin valor y los otros 150 se entregan a otra entidad. */
  { tipo: "extincionDeTitulos", fecha: "25/06/2026", ...SIN_ISIN, titulos: 50, nota: "Caducados sin valor" },
  { tipo: "salidaDeTitulos", fecha: "01/07/2026", ...SIN_ISIN, titulos: 150, nota: "Entregada a otra entidad" },
  { tipo: "otroEfectivo", fecha: "20/07/2026", importe: 15, nota: "Bonificación de la entidad" },
  { tipo: "retirada", fecha: "01/12/2026", importe: -5000 },
  /* Amortización anticipada del nominal entero al 100 %: 10.000. */
  { tipo: "amortizacion", fecha: "15/12/2026", ...BONO, titulos: 10000, precio: 100, importe: 10000 }
];

type FilaDePosicion = Partial<Record<ClaveDeColumnaDePosiciones, Celda>>;

/**
 * Lo que la entidad declararía a 31-12-2026 si el libro de los ejemplos es correcto. Los
 * valores de mercado son inventados (1.000 × 11,20 = 11.200; 400 × 26,80 = 10.720); el
 * efectivo es el de la cuenta de la cabecera de este fichero. El precio es opcional (A-210):
 * el fondo de bolsa lo da, el de renta fija no, y Ejemplo Corp., en dólares, lo da en su
 * divisa: 60 × 105 = 6.300 USD, que la entidad declara como 6.000 EUR (a 1,05 USD por EUR).
 */
export const EJEMPLOS_DE_POSICIONES: readonly FilaDePosicion[] = [
  { fecha: "31/12/2026", ...FONDO_BOLSA, titulos: 1000, valor: 11200, precio: 11.2, divisa: "EUR" },
  { fecha: "31/12/2026", ...FONDO_RF, titulos: 400, valor: 10720, divisa: "EUR" },
  { fecha: "31/12/2026", isin: ACCION_USD.isin, nombre: ACCION_USD.nombre, titulos: 60, valor: 6000, precio: 105, divisa: "USD" },
  { fecha: "31/12/2026", nombre: "Efectivo", valor: 56677.7, divisa: "EUR" },
  { fecha: "31/12/2026", nombre: "Efectivo", valor: 4725, divisa: "USD" }
];

function filaDe<Clave extends string>(columnas: readonly ColumnaDeLaPlantilla<Clave>[], valores: Partial<Record<Clave, Celda>>): Celda[] {
  return columnas.map((columna) => valores[columna.clave] ?? "");
}

const OBLIGATORIEDAD: Record<ObligatoriedadDeColumna, string> = { siempre: "Sí", segunTipo: "Según el tipo", no: "No" };

function filaDeInstruccion(columna: ColumnaDeLaPlantilla): Celda[] {
  return [columna.nombre, OBLIGATORIEDAD[columna.obligatoria], columna.descripcion, columna.ejemplo, columna.sinonimos.join(", ")];
}

function hojaDeInstrucciones(): HojaDeLaPlantilla {
  const filas: Celda[][] = [
    ["Plantilla de movimientos del gestor de carteras"],
    ["Una fila por movimiento en la hoja «Movimientos». El orden de las columnas no importa: se reconocen por su nombre, sin distinguir mayúsculas ni tildes. Las columnas que un tipo no usa se dejan en blanco."],
    ["El importe se puede escribir con o sin signo: el signo lo pone el tipo. Solo en los intereses, en otro cargo o abono y en la retención el signo del fichero manda (negativo carga, positivo abona)."],
    ["Las cifras se admiten con coma o con punto decimal («1.234,56» o «1234.56»), una sola forma en todo el fichero: si alguna cifra lleva coma decimal, el punto es de millares; si alguna lleva punto decimal y ninguna coma, el punto es decimal y «1.085» es 1,085. Si ninguna lo deja ver, «1.085» se lee como 1.085,00 y la línea queda por revisar. Las filas vacías, las de totales y las que empiezan por # se ignoran."],
    ["La hoja «Posiciones» es opcional: lo que la entidad declara a una fecha, para comprobar que el libro cuadra. El efectivo va en filas con Nombre «Efectivo» y su divisa."],
    ["En «Posiciones», el precio de cada activo es opcional. Si se pone, va en la divisa del activo, con esa divisa en «Divisa» (en un bono, en % del nominal), y la posición se valora a ese precio. Sin él, el precio se deduce del valor en la divisa base, con el cambio del día."],
    [],
    ["Columnas de la hoja «Movimientos»"],
    ["Columna", "Obligatoria", "Qué es", "Ejemplo", "Otros nombres que se aceptan"],
    ...COLUMNAS_DE_MOVIMIENTOS.map(filaDeInstruccion),
    [],
    ["Tipos de movimiento"],
    ["Tipo", "Grupo", "Qué hace", "Columnas que usa (* obligatoria)", "Otros nombres que se aceptan"],
    ...TIPOS.map((definicion) => [
      definicion.nombre,
      NOMBRE_DEL_GRUPO[definicion.grupo],
      definicion.descripcion,
      columnasDelTipo(definicion).map(({ columna, obligatoria }) => (obligatoria ? `${columna.nombre}*` : columna.nombre)).join(", "),
      [definicion.tipo, ...(SINONIMOS_DE_TIPOS[definicion.tipo] ?? [])].join(", ")
    ]),
    [],
    ["Columnas de la hoja «Posiciones»"],
    ["Columna", "Obligatoria", "Qué es", "Ejemplo", "Otros nombres que se aceptan"],
    ...COLUMNAS_DE_POSICIONES.map(filaDeInstruccion)
  ];
  return { nombre: HOJA_DE_INSTRUCCIONES, filas };
}

/** Las hojas de la plantilla como matrices de celdas, listas para escribirlas en un Excel o un CSV. */
export function hojasDeLaPlantilla(): Array<{ nombre: string; filas: Array<Array<string | number>> }> {
  const movimientos: Celda[][] = [
    COLUMNAS_DE_MOVIMIENTOS.map((columna) => columna.nombre),
    ...EJEMPLOS_DE_MOVIMIENTOS.map(({ tipo, ...resto }) =>
      filaDe(COLUMNAS_DE_MOVIMIENTOS, { ...resto, tipo: definicionDe(tipo)?.nombre ?? tipo }))
  ];
  const posiciones: Celda[][] = [
    COLUMNAS_DE_POSICIONES.map((columna) => columna.nombre),
    ...EJEMPLOS_DE_POSICIONES.map((fila) => filaDe(COLUMNAS_DE_POSICIONES, fila))
  ];
  return [
    { nombre: HOJA_DE_MOVIMIENTOS, filas: movimientos },
    { nombre: HOJA_DE_POSICIONES, filas: posiciones },
    hojaDeInstrucciones()
  ];
}

/** Una celda en el CSV: las cifras con coma decimal y sin millares, que es como las abre un Excel en español. */
function celdaCsv(celda: Celda): string {
  const texto = typeof celda === "number" ? aTexto(d(celda)).replace(".", ",") : celda;
  return /[;"\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/** La hoja «Movimientos» como texto CSV (separador «;», con BOM UTF-8 para que Excel lo abra bien, CRLF). */
export function plantillaCsv(): string {
  const hoja = hojasDeLaPlantilla().find((candidata) => candidata.nombre === HOJA_DE_MOVIMIENTOS)!;
  return `\uFEFF${hoja.filas.map((fila) => fila.map(celdaCsv).join(";")).join("\r\n")}\r\n`;
}
