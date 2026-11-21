/**
 * La cartera de demostración: para probar el gestor sin datos propios.
 *
 * Todo en ella es INVENTADO y lo dice: los activos no existen (sus nombres llevan «demo»),
 * sus precios salen de un generador con semilla fija y sus movimientos se construyen sobre
 * esos precios. No lee la plataforma ni el disco, y no se guarda: se genera cada vez igual
 * para una misma fecha. Sirve también de base fija para probar la pantalla y los informes.
 *
 * Recorre los tipos de movimiento que un asesor ve a diario: aportaciones periódicas,
 * compras y ventas, suscripciones, un traspaso entre fondos, dividendos, cupones,
 * comisiones de custodia, intereses, una retirada, un split y posiciones en dólares.
 */
import { cuponCorrido } from "../motor/bonos";
import { aTexto, d, redondear } from "../motor/decimal";
import { diaDeLaSemana, sumarAnios, sumarDias, sumarMeses, type Dia } from "../motor/fechas";
import type { FichaDeActivo } from "../motor/composicion";
import type { ReferenciaDeEntrada } from "../motor/analisis";
import { construirLibro, titulosDe } from "../motor/libro";
import type { Activo, Cartera, ExtractoDeclarado, Movimiento } from "../motor/modelo";
import { ultimoHasta, type DatosDeMercado, type Punto } from "../motor/valoracion";

export const ID_DE_LA_DEMO = "cartera-de-demostracion";

export interface Demostracion {
  cartera: Cartera;
  mercado: DatosDeMercado;
  fichas: Map<string, FichaDeActivo>;
  referencia: ReferenciaDeEntrada;
}

/** Si una cartera es la de demostración: no se guarda y sus precios son sintéticos. */
export function esDemostracion(cartera: Pick<Cartera, "extensiones">): boolean {
  return cartera.extensiones?.demostracion === true;
}

/** Generador con semilla (mulberry32): la misma semilla da siempre la misma serie. */
function generador(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Una normal estándar aproximada (suma de doce uniformes). */
function normal(azar: () => number): number {
  let suma = 0;
  for (let i = 0; i < 12; i += 1) suma += azar();
  return suma - 6;
}

/** Una serie diaria (días hábiles) con deriva y volatilidad anuales, redondeada a `decimales`. */
function serieSintetica(desde: Dia, hasta: Dia, inicial: number, derivaAnual: number, volatilidadAnual: number, semilla: number, decimales = 4): Punto[] {
  const azar = generador(semilla);
  const puntos: Punto[] = [];
  let nivel = inicial;
  const factor = 10 ** decimales;
  for (let dia = desde; dia <= hasta; dia = sumarDias(dia, 1)) {
    if (diaDeLaSemana(dia) > 5) continue;
    if (puntos.length > 0) nivel *= Math.exp((derivaAnual - (volatilidadAnual * volatilidadAnual) / 2) / 252 + (volatilidadAnual / Math.sqrt(252)) * normal(azar));
    puntos.push({ fecha: dia, valor: Math.round(nivel * factor) / factor });
  }
  return puntos;
}

const FONDO_BOLSA = "DEMO-FONDO-BOLSA";
const FONDO_RENTA_FIJA = "DEMO-FONDO-RF";
const FONDO_MIXTO = "DEMO-FONDO-MIXTO";
const ETF_TECNOLOGIA = "DEMO-ETF-TEC";
const ACCION_ENERGIA = "DEMO-ACC-ENERGIA";
const ACCION_SOFTWARE = "DEMO-ACC-SOFTWARE";
const BONO_ESTADO = "DEMO-BONO-2029";
const INDICE = "DEMO-INDICE";

function activos(vencimientoDelBono: Dia): Activo[] {
  return [
    { id: FONDO_BOLSA, nombre: "Bolsa Global Indexada, FI (demo)", tipo: "FONDO", divisa: "EUR", origen: "manual", isin: "ZZ00DEMO0017" },
    { id: FONDO_RENTA_FIJA, nombre: "Renta Fija Euro Corto Plazo, FI (demo)", tipo: "FONDO", divisa: "EUR", origen: "manual", isin: "ZZ00DEMO0025" },
    { id: FONDO_MIXTO, nombre: "Mixto Flexible Europa, FI (demo)", tipo: "FONDO", divisa: "EUR", origen: "manual", isin: "ZZ00DEMO0033" },
    { id: ETF_TECNOLOGIA, nombre: "ETF Tecnología Mundial (demo)", tipo: "ETF", divisa: "USD", origen: "manual", isin: "ZZ00DEMO0041" },
    { id: ACCION_ENERGIA, nombre: "Ibérica de Energía, S.A. (demo)", tipo: "ACCION", divisa: "EUR", origen: "manual", isin: "ZZ00DEMO0058" },
    { id: ACCION_SOFTWARE, nombre: "Northwind Software Inc. (demo)", tipo: "ACCION", divisa: "USD", origen: "manual", isin: "ZZ00DEMO0066" },
    {
      id: BONO_ESTADO,
      nombre: "Bono del Estado 3,25 % (demo)",
      tipo: "BONO",
      divisa: "EUR",
      origen: "manual",
      isin: "ZZ00DEMO0074",
      multiplicador: "0.01",
      bono: { cupon: "0.0325", frecuencia: 1, vencimiento: vencimientoDelBono, base: "ACT/ACT" }
    }
  ];
}

const FICHAS: Array<[string, FichaDeActivo]> = [
  [FONDO_BOLSA, { clases: { "Renta variable": 0.99, Liquidez: 0.01 }, rentaVariable: 0.99, regiones: { "Norteamérica": 0.66, Europa: 0.18, "Asia y Pacífico": 0.14, "Iberoamérica": 0.02 }, sectores: { "Tecnología": 0.27, Financieras: 0.16, Salud: 0.12, Industriales: 0.11, "Consumo cíclico": 0.11, "Comunicación": 0.08, "Consumo defensivo": 0.06, "Energía": 0.04, Materiales: 0.03, Utilities: 0.02 }, gastosCorrientes: 0.0025 }],
  [FONDO_RENTA_FIJA, { clases: { "Renta fija": 0.94, Liquidez: 0.06 }, rentaVariable: 0, gastosCorrientes: 0.0035 }],
  [FONDO_MIXTO, { clases: { "Renta variable": 0.5, "Renta fija": 0.45, Liquidez: 0.05 }, rentaVariable: 0.5, regiones: { Europa: 0.92, "Norteamérica": 0.08 }, sectores: { Financieras: 0.22, Industriales: 0.2, Salud: 0.16, "Consumo defensivo": 0.14, "Tecnología": 0.1, "Energía": 0.1, Utilities: 0.08 }, gastosCorrientes: 0.012 }],
  [ETF_TECNOLOGIA, { clases: { "Renta variable": 1 }, rentaVariable: 1, regiones: { "Norteamérica": 0.82, "Asia y Pacífico": 0.14, Europa: 0.04 }, sectores: { "Tecnología": 0.86, "Comunicación": 0.14 }, gastosCorrientes: 0.003 }],
  [ACCION_ENERGIA, { clases: { "Renta variable": 1 }, rentaVariable: 1, regiones: { Europa: 1 }, sectores: { "Energía": 1 } }],
  [ACCION_SOFTWARE, { clases: { "Renta variable": 1 }, rentaVariable: 1, regiones: { "Norteamérica": 1 }, sectores: { "Tecnología": 1 } }],
  [BONO_ESTADO, { clases: { "Renta fija": 1 }, rentaVariable: 0 }]
];

/**
 * La demostración a una fecha: tres años de historia que terminan ese día.
 * `hoy` fija también los precios, así que la misma fecha da siempre la misma cartera.
 */
export function demostracion(hoy: Dia): Demostracion {
  /* Empieza el primer día hábil de hace tres años. */
  let inicio = sumarAnios(hoy, -3);
  while (diaDeLaSemana(inicio) > 5) inicio = sumarDias(inicio, 1);
  const previo = sumarDias(inicio, -10);
  const vencimientoDelBono = sumarAnios(sumarMeses(inicio, 5), 6);

  const precios = new Map<string, Punto[]>([
    [FONDO_BOLSA, serieSintetica(previo, hoy, 148.2, 0.085, 0.14, 11)],
    [FONDO_RENTA_FIJA, serieSintetica(previo, hoy, 1021.5, 0.024, 0.018, 23, 2)],
    [FONDO_MIXTO, serieSintetica(previo, hoy, 62.4, 0.045, 0.075, 37)],
    [ETF_TECNOLOGIA, serieSintetica(previo, hoy, 54.8, 0.13, 0.22, 41, 2)],
    [ACCION_ENERGIA, serieSintetica(previo, hoy, 11.35, 0.05, 0.19, 53, 3)],
    [BONO_ESTADO, serieSintetica(previo, hoy, 98.1, 0.004, 0.03, 61, 2)]
  ]);
  /* La acción de software hace un split de 2 por 1 a mitad de camino: su serie real cae a la mitad ese día. */
  const diaDelSplit = (() => {
    let dia = sumarMeses(inicio, 19);
    while (diaDeLaSemana(dia) > 5) dia = sumarDias(dia, 1);
    return dia;
  })();
  precios.set(
    ACCION_SOFTWARE,
    serieSintetica(previo, hoy, 312, 0.16, 0.27, 71, 2).map((punto) => (punto.fecha >= diaDelSplit ? { fecha: punto.fecha, valor: Math.round(punto.valor * 50) / 100 } : punto))
  );
  const cambios = new Map<string, Punto[]>([["USD", serieSintetica(previo, hoy, 1.085, 0.005, 0.07, 83)]]);
  const indice = serieSintetica(previo, hoy, 100, 0.075, 0.125, 97);
  /* Un tipo sin riesgo plausible: baja despacio del 3,6 % al 2,2 %. */
  const libreDeRiesgo = serieSintetica(previo, hoy, 100, 0, 0, 1).map((punto, i, todos) => ({ fecha: punto.fecha, valor: 0.036 - (0.014 * i) / Math.max(1, todos.length - 1) }));
  const mercado: DatosDeMercado = { precios, cambios, libreDeRiesgo };

  const precio = (activoId: string, fecha: Dia): number => ultimoHasta(precios.get(activoId), fecha)!.valor;
  const dolar = (fecha: Dia): number => ultimoHasta(cambios.get("USD"), fecha)!.valor;
  const habil = (fecha: Dia): Dia => {
    let dia = fecha;
    while (diaDeLaSemana(dia) > 5) dia = sumarDias(dia, 1);
    return dia > hoy ? hoy : dia;
  };
  const euros = (valor: number): string => aTexto(redondear(d(valor.toFixed(6)), 2));

  const movimientos: Movimiento[] = [];
  let n = 0;
  const alta = (tipo: string, fecha: Dia, campos: Partial<Movimiento>): void => {
    if (fecha > hoy) return;
    n += 1;
    movimientos.push({ id: `demo-${String(n).padStart(3, "0")}`, tipo, fechaOperacion: fecha, origen: { via: "demo" }, ...campos });
  };

  /** Compra o suscripción en euros de un activo en euros: tantos títulos como quepan en el presupuesto. */
  const comprar = (tipo: "compra" | "suscripcion", fecha: Dia, activoId: string, presupuesto: number, comision: number, decimalesDeTitulos: number): void => {
    const p = precio(activoId, fecha);
    const titulos = Math.floor(((presupuesto - comision) / p) * 10 ** decimalesDeTitulos) / 10 ** decimalesDeTitulos;
    const importe = titulos * p + comision;
    alta(tipo, fecha, { activoId, titulos: String(titulos), precio: String(p), comision: comision > 0 ? String(comision) : undefined, importe: `-${euros(importe)}`, fechaValor: sumarDias(fecha, 2) });
  };
  /** Compra en euros de un activo en dólares, con su cambio. */
  const comprarEnDolares = (fecha: Dia, activoId: string, titulos: number, comision: number): void => {
    const p = precio(activoId, fecha);
    const cambio = Math.round(dolar(fecha) * 10000) / 10000;
    alta("compra", fecha, { activoId, titulos: String(titulos), precio: String(p), cambio: String(cambio), comision: String(comision), importe: `-${euros((titulos * p) / cambio + comision)}`, fechaValor: sumarDias(fecha, 2) });
  };

  /* Año 1: se constituye la cartera. */
  alta("aportacion", inicio, { importe: "150000", nota: "Aportación inicial" });
  const dia2 = habil(sumarDias(inicio, 2));
  comprar("suscripcion", dia2, FONDO_BOLSA, 45000, 0, 4);
  comprar("suscripcion", dia2, FONDO_RENTA_FIJA, 40000, 0, 4);
  comprar("compra", habil(sumarDias(inicio, 3)), ACCION_ENERGIA, 12000, 12.5, 0);
  comprarEnDolares(habil(sumarDias(inicio, 6)), ETF_TECNOLOGIA, 180, 9.9);
  comprarEnDolares(habil(sumarDias(inicio, 8)), ACCION_SOFTWARE, 30, 9.9);
  /* El bono: nominal 15.000, con su cupón corrido y su comisión. */
  const diaDelBono = habil(sumarMeses(inicio, 1));
  {
    const p = precio(BONO_ESTADO, diaDelBono);
    const limpio = (15000 * p) / 100;
    /* Se paga además el cupón corrido: lo devengado desde el último cupón, que cobrará entero el comprador. */
    const corrido = Math.round(15000 * cuponCorrido({ cupon: "0.0325", frecuencia: 1, vencimiento: vencimientoDelBono, base: "ACT/ACT" }, diaDelBono) * 100) / 100;
    alta("compra", diaDelBono, { activoId: BONO_ESTADO, titulos: "15000", precio: String(p), cuponCorrido: String(corrido), comision: "25", importe: `-${euros(limpio + corrido + 25)}`, nota: "Nominal 15.000" });
  }

  /* Aportaciones de 1.000 € cada mes, que van al fondo de bolsa cada trimestre. */
  for (let mes = 1; mes <= 35; mes += 1) {
    const fecha = habil(sumarMeses(inicio, mes));
    if (fecha >= hoy) break;
    alta("aportacion", fecha, { importe: "1000", nota: "Aportación periódica" });
    if (mes % 3 === 0) comprar("suscripcion", habil(sumarDias(fecha, 1)), FONDO_BOLSA, 3000, 0, 4);
  }

  /* Cupón anual del bono: 3,25 % de 15.000 = 487,50 € brutos, 19 % de retención. */
  for (let anio = 1; anio <= 3; anio += 1) {
    const fecha = sumarAnios(vencimientoDelBono, anio - 6);
    if (fecha <= diaDelBono || fecha >= hoy) continue;
    alta("cupon", habil(fecha), { activoId: BONO_ESTADO, importe: "394.88", retencion: "92.62" });
  }

  /* Comisión de custodia cada trimestre e intereses de la cuenta cada semestre. */
  for (let trimestre = 1; trimestre <= 11; trimestre += 1) {
    const fecha = habil(sumarDias(sumarMeses(inicio, trimestre * 3), 4));
    if (fecha >= hoy) break;
    alta("comision", fecha, { importe: "-58.40", nota: "Custodia y administración" });
    if (trimestre % 2 === 0) alta("interes", habil(sumarDias(fecha, 1)), { importe: "41.31", retencion: "9.69" });
  }

  /* Año 2: el cliente retira dinero, se rota parte de la renta fija a un fondo mixto y se recogen beneficios. */
  alta("retirada", habil(sumarMeses(inicio, 13)), { importe: "-12000", nota: "Retirada del cliente" });
  {
    const fecha = habil(sumarMeses(inicio, 15));
    const origen = precio(FONDO_RENTA_FIJA, fecha);
    const participaciones = 14;
    const valor = Math.round(participaciones * origen * 100) / 100;
    const llegada = habil(sumarDias(fecha, 3));
    const destino = precio(FONDO_MIXTO, llegada);
    const recibidas = Math.floor((valor / destino) * 10000) / 10000;
    alta("traspaso", fecha, { activoId: FONDO_RENTA_FIJA, titulos: String(participaciones), precio: String(origen), valor: String(valor), destino: { activoId: FONDO_MIXTO, titulos: String(recibidas), precio: String(destino), fecha: llegada } });
  }
  alta("split", diaDelSplit, { activoId: ACCION_SOFTWARE, razon: "2", serieAjustada: false, nota: "Split de 2 por 1" });
  {
    const fecha = habil(sumarMeses(inicio, 23));
    if (fecha < hoy) {
      const p = precio(ETF_TECNOLOGIA, fecha);
      const cambio = Math.round(dolar(fecha) * 10000) / 10000;
      alta("venta", fecha, { activoId: ETF_TECNOLOGIA, titulos: "70", precio: String(p), cambio: String(cambio), comision: "9.9", importe: euros((70 * p) / cambio - 9.9), fechaValor: sumarDias(fecha, 2) });
    }
  }
  /* Año 3: se cierra del todo la mitad de la posición de energía… y después la otra mitad, para tener una posición cerrada. */
  {
    const fecha = habil(sumarMeses(inicio, 30));
    if (fecha < hoy) {
      const libro = construirLibro({ ...carteraBase(vencimientoDelBono), movimientos }, { hasta: fecha });
      const titulos = Number(titulosDe(libro.final, ACCION_ENERGIA).toFixed());
      const p = precio(ACCION_ENERGIA, fecha);
      alta("venta", fecha, { activoId: ACCION_ENERGIA, titulos: String(titulos), precio: String(p), comision: "12.5", importe: euros(titulos * p - 12.5), fechaValor: sumarDias(fecha, 2), nota: "Se cierra la posición" });
    }
  }

  /* Dividendos de la acción de energía, dos al año, mientras se tiene: 0,21 € brutos por título con el 19 % de retención.
     Van al final porque dependen de los títulos que haya en cada fecha, ya con las ventas hechas. */
  for (const mes of [4, 10, 16, 22, 28, 34]) {
    const fecha = habil(sumarMeses(inicio, mes));
    if (fecha >= hoy) break;
    const libro = construirLibro({ ...carteraBase(vencimientoDelBono), movimientos }, { hasta: fecha });
    const titulos = Number(titulosDe(libro.final, ACCION_ENERGIA).toFixed());
    if (titulos <= 0) continue;
    const bruto = titulos * 0.21;
    const retencion = Math.round(bruto * 19) / 100;
    alta("dividendo", fecha, { activoId: ACCION_ENERGIA, importe: euros(bruto - retencion), retencion: euros(retencion) });
  }


  movimientos.sort((a, b) => (a.fechaOperacion < b.fechaOperacion ? -1 : a.fechaOperacion > b.fechaOperacion ? 1 : 0));

  /* Lo que «declara el banco» a la fecha: lo mismo que dice el libro, para que la conciliación cuadre. */
  const base = carteraBase(vencimientoDelBono);
  const final = construirLibro({ ...base, movimientos }, { hasta: hoy }).final;
  const extracto: ExtractoDeclarado = {
    id: "demo-extracto",
    fecha: hoy,
    entidad: "Banco de demostración",
    documento: "Extracto de demostración",
    posiciones: base.activos
      .map((activo) => ({ activo, titulos: titulosDe(final, activo.id) }))
      .filter((linea) => linea.titulos.gt(0))
      .map((linea) => ({ activoId: linea.activo.id, isin: linea.activo.isin, nombre: linea.activo.nombre, titulos: aTexto(linea.titulos) })),
    efectivo: [{ divisa: "EUR", saldo: aTexto(final.efectivo.get("EUR") ?? d(0)) }]
  };

  return {
    cartera: { ...base, movimientos, extractos: [extracto] },
    mercado,
    fichas: new Map(FICHAS),
    referencia: { nombre: "Índice mundial de bolsa (demo)", serie: indice }
  };
}

function carteraBase(vencimientoDelBono: Dia): Cartera {
  return {
    id: ID_DE_LA_DEMO,
    nombre: "Cartera de demostración",
    divisaBase: "EUR",
    creada: "2026-01-01T00:00:00.000Z",
    modificada: "2026-01-01T00:00:00.000Z",
    cliente: { nombre: "Cliente de ejemplo" },
    referencia: { activoId: INDICE, nombre: "Índice mundial de bolsa (demo)" },
    cuentas: {
      efectivo: { nombre: "Cuenta de efectivo", entidad: "Banco de demostración" },
      valores: { nombre: "Cuenta de valores", entidad: "Banco de demostración" }
    },
    activos: activos(vencimientoDelBono),
    movimientos: [],
    preciosManuales: [],
    extractos: [],
    importaciones: [],
    notas: "Cartera inventada para probar el gestor. Sus activos no existen y sus precios son sintéticos.",
    extensiones: { demostracion: true }
  };
}
