/**
 * Lo que se lee de un resultado del simulador de jubilación: las mismas cuentas para la pantalla y para el informe.
 *
 * El motor da importes anuales en euros de cada año. Aquí se ordenan para leerse —el libro del bruto al neto, qué
 * tributa y dónde, las series de los gráficos, los escenarios, las formas de cobro comparadas— y lo usan igual la
 * pantalla y el PDF: lo que el asesor ve y lo que entrega no pueden dar cifras distintas.
 *
 * **Unidades.** `hoy` divide cada importe por la inflación acumulada hasta su año; `nominal` lo deja como está. Un
 * saldo es de cierre de año, así que en euros de hoy descuenta un año más que los ingresos de ese año.
 */
import { importe, oFalta, porcentaje } from "../formato";
import * as F from "./fiscal";
import { AJUSTES, calcular, type ClaveDeEscenario, type EntradaDeJubilacion, type Escenario, type FilaAnual, type FormaDeCobro, type Proyeccion, type ResultadoDisponible } from "./motor";
import { probabilidadDeLlegar, TABLA_DE_MORTALIDAD, type Sexo } from "./supervivencia";

export type Unidades = "hoy" | "nominal";

export const NOMBRE_DE_LAS_UNIDADES: Record<Unidades, string> = { hoy: "euros de hoy", nominal: "euros de cada año" };

/**
 * Un importe en euros que nunca se escribe «−0 €» (PLA-03, INF-13): aquí un IRPF de cero lleva siempre el menos
 * delante. Por defecto en euros enteros: es una simulación, y sus céntimos no los ha calculado nadie. El módulo único
 * ya escribe sin signo lo que redondea a cero (su regla 6).
 */
export function eurosSinSignoEnCero(valor: number, decimales = 0): string {
  return oFalta(importe(valor, { decimales }));
}

/** Un importe de la simulación, en euros enteros: «76.918 €». */
const euros = (valor: number): string => eurosSinSignoEnCero(valor);

/**
 * Un porcentaje elegido para simular (una rentabilidad, la inflación, una caída del escenario de estrés, la parte que
 * se cobra de una vez) con los decimales con los que se elige, sin «+»: es un supuesto, no una rentabilidad medida.
 * «3,0 %», «−12 %», «50 %».
 */
const supuesto = (fraccion: number, decimales: number): string => oFalta(porcentaje(fraccion, { decimales }));

/** Por cuánto se divide un importe del año de `fila` para escribirlo en las unidades pedidas. */
export const divisorDe = (fila: Pick<FilaAnual, "deflactor">, unidades: Unidades): number => (unidades === "hoy" ? fila.deflactor : 1);

/** El patrimonio al cierre del año de `fila`, en las unidades pedidas. */
export const saldoAlCierre = (fila: FilaAnual, inflacion: number, unidades: Unidades): number =>
  unidades === "hoy" ? fila.saldo / (fila.deflactor * (1 + inflacion)) : fila.saldo;

/** El patrimonio que queda al final del plan, en euros de hoy. */
export function patrimonioFinalDeHoy(escenario: Escenario, inflacion: number): number {
  const ultima = escenario.filas.at(-1);
  return ultima ? saldoAlCierre(ultima, inflacion, "hoy") : 0;
}

/** Cómo se aplican las reglas del IRPF a los años futuros, en tres palabras, para la procedencia de un gráfico. */
export function reglasEnElTiempo(res: ResultadoDisponible): string {
  return `reglas del IRPF de ${res.cfg.ejercicio} ${res.escalasConElIpc ? "actualizadas con el IPC" : "fijas"}`;
}

/** Quién lo dice y desde cuándo: la línea de procedencia de toda cifra fiscal de este módulo. */
export function procedenciaFiscal(cfg: F.Configuracion): string {
  return `${cfg.irpf} ${cfg.ejercicio} · ${cfg.normaCorta}${cfg.ccaa ? ` · ${cfg.ccaa.corto ?? cfg.ccaa.nombre}` : ""} · fuentes consultadas ${F.consultaFuentes(cfg)}`;
}

/* -------------------------------------------------------------- Cuánto dura --- */

export interface LecturaDeDuracion {
  clase: "sin-ahorros" | "se-mantiene" | "pierde-valor" | "se-agota" | "llega";
  /** La frase entera, para el informe y para quien no ve la cifra. */
  titulo: string;
  detalle: string;
  /** La edad hasta la que llegan los ahorros, cuando la frase es de una edad. */
  edad: number | null;
}

/** Lo previsto para el año que el patrimonio no ha llegado a pagar, con un euro de margen: es una simulación. */
const cobraDeMenos = (fila: FilaAnual): boolean => fila.previsto - (fila.retiradaAhorros + fila.retiradaEpsv) > 1;

/**
 * La edad a la que se agotan los ahorros: la del primer año que el patrimonio ya no paga entero. `null` si llegan.
 *
 * Auditoría 16-11-2026 (JUB-5). El motor apunta el año en que el patrimonio cierra a cero y le suma uno, y esa edad
 * se escribía tal cual: en el escenario de rentabilidad baja del caso por defecto el año de los 89 cobra el 31 % de
 * lo previsto, y la frase decía «Se agotan a los 90 años». Además dejaba fuera el último año del plan, y un plan
 * cuyo último año se queda corto se leía «Llegan justo a los 95 años».
 *
 * Aquí se mira si el año del cierre a cero se cobró entero. Si no, esa es la edad; si sí —una renta temporal que
 * acaba cuando tenía que acabar—, los ahorros faltan desde el año siguiente, que es lo que ya decía el motor. Se hace
 * en la lectura y no en el motor para que este siga dando las mismas cifras que el de NUVIA.
 */
export function edadDeAgotamiento(proyeccion: Proyeccion): number | null {
  if (proyeccion.agotado !== null) {
    const cierre = proyeccion.filas[proyeccion.agotado - 1];
    return cierre && cobraDeMenos(cierre) ? cierre.edad : proyeccion.edadAgotado;
  }
  const ultima = proyeccion.filas.at(-1);
  return ultima && ultima.saldo < 1 && cobraDeMenos(ultima) ? ultima.edad : null;
}

/**
 * A qué edad deja de pagarse entera cada parte del patrimonio, por separado: la previsión (la EPSV o el plan de
 * pensiones) y los demás ahorros. `null` en la que se paga entera todo el plan.
 *
 * Decisión A-168 (16-11-2026, hallazgo JUB-6). El motor da el plan por agotado cuando las dos partes cierran a cero a
 * la vez. Si una se acaba antes —una renta constante de la EPSV con menos rentabilidad de la supuesta—, la frase
 * decía «Llegan a los 95 años» aunque ese cobro faltara desde mucho antes. Una renta temporal que termina cuando
 * estaba previsto no cuenta: ahí no falta nada.
 */
export function edadesSinCobrarEntero(res: ResultadoDisponible, proyeccion: Proyeccion): { prevision: number | null; ahorros: number | null } {
  let prevision: number | null = null;
  let ahorros: number | null = null;
  for (const fila of proyeccion.filas) {
    const deLaPrevision = res.plan.pagoEpsv(fila.anio);
    if (prevision === null && deLaPrevision - fila.retiradaEpsv > 1) prevision = fila.edad;
    if (ahorros === null && fila.previsto - deLaPrevision - fila.retiradaAhorros > 1) ahorros = fila.edad;
  }
  return { prevision, ahorros };
}

/** Con «vivir de lo que rinden», el capital conserva su valor solo si la rentabilidad de la hipótesis llega al IPC. */
export function conservaSuValor(res: ResultadoDisponible): boolean {
  return res.base.r >= res.entrada.inflacion - 1e-12;
}

export function duracion(res: ResultadoDisponible): LecturaDeDuracion {
  const o = res.entrada;
  const base = res.base;
  if (base.saldoInicial <= 1) return { clase: "sin-ahorros", titulo: "Sin ahorros que retirar", detalle: "El ingreso es solo la pensión.", edad: null };
  if (o.estrategia === "conservar") {
    /* Auditoría 16-11-2026 (JUB-1). «Vivir de lo que rinden» retira la rentabilidad por encima del IPC. Si la rentabilidad no
       llega al IPC no hay nada que retirar y el capital, sin tocarlo, pierde poder de compra: con un 1 % y un IPC del 3 %,
       200.000 € son 111.059 € de hoy treinta años después. La pantalla decía igualmente que «conserva su valor». */
    if (!conservaSuValor(res)) {
      const alEmpezar = base.saldoInicial / res.anio1.deflactor;
      return {
        clase: "pierde-valor",
        titulo: "El capital pierde valor",
        detalle: `Con una rentabilidad del ${supuesto(base.r, 1)} y un IPC del ${supuesto(o.inflacion, 1)} no hay nada que retirar sin tocar el capital, y este pierde poder de compra: de ${euros(alEmpezar)} a ${euros(patrimonioFinalDeHoy(base, o.inflacion))} de hoy a los ${o.edadFin}.`,
        edad: null
      };
    }
    return { clase: "se-mantiene", titulo: "El capital se mantiene", detalle: `Con la hipótesis, a los ${o.edadFin} conserva su valor en euros de hoy.`, edad: null };
  }
  const edadAgotado = edadDeAgotamiento(base);
  if (edadAgotado !== null) {
    return { clase: "se-agota", titulo: `Los ahorros se agotan a los ${edadAgotado} años`, detalle: `Antes de la edad del plan (${o.edadFin}).`, edad: edadAgotado };
  }
  return { clase: "llega", titulo: `Los ahorros duran hasta los ${o.edadFin} años`, detalle: `Con una rentabilidad del ${supuesto(o.rentabilidad, 1)} al año.`, edad: o.edadFin };
}

/* ----------------------------------------------- La respuesta, en pocas líneas --- */

export interface LineaDeLaRespuesta {
  clave: "pension" | "ahorros" | "prevision" | "bruto" | "irpf" | "neto";
  concepto: string;
  /** En euros del primer año de jubilación, con su signo: el IRPF resta. */
  anual: number;
  /** De dónde viene el dinero, la suma, lo que se va y lo que queda. */
  clase: "origen" | "suma" | "resta" | "total";
}

/**
 * De dónde sale el ingreso del primer año y cuánto se queda el IRPF. Es el libro del bruto al neto sin el detalle
 * fiscal: lo que explica la cifra que se enseña en grande. El IRPF por bases y sus deducciones están en el libro
 * entero (`libroDelPrimerAnio`) y en el mapa fiscal, que suman lo mismo.
 */
export function respuestaDelPrimerAnio(res: ResultadoDisponible): LineaDeLaRespuesta[] {
  const y = res.anio1;
  const lineas: LineaDeLaRespuesta[] = [];
  if (y.pension > 0.5) lineas.push({ clave: "pension", concepto: "Pensión pública", anual: y.pension, clase: "origen" });
  if (y.retiradaAhorros > 0.5) lineas.push({ clave: "ahorros", concepto: "De los ahorros", anual: y.retiradaAhorros, clase: "origen" });
  if (y.retiradaEpsv > 0.5) lineas.push({ clave: "prevision", concepto: `${res.textos.de.charAt(0).toUpperCase()}${res.textos.de.slice(1)}`, anual: y.retiradaEpsv, clase: "origen" });
  lineas.push(
    { clave: "bruto", concepto: "Ingreso bruto", anual: y.bruto, clase: "suma" },
    { clave: "irpf", concepto: `IRPF · ${oFalta(porcentaje(y.bruto ? y.impuesto / y.bruto : 0, { decimales: 1 }))} del bruto`, anual: -y.impuesto, clase: "resta" },
    { clave: "neto", concepto: "Ingreso neto", anual: y.neto, clase: "total" }
  );
  return lineas;
}

/**
 * Reparte un `total` entero entre unas cifras que lo suman sin redondear, por el método del mayor resto: cada una
 * se queda con su parte entera, y los euros que faltan van, de uno en uno, a las de mayor parte decimal. Ninguna se
 * aparta de su cifra exacta en un euro o más.
 */
export function repartoConMayorResto(valores: readonly number[], total: number): number[] {
  if (valores.length === 0) return [];
  const repartidos = valores.map((valor) => Math.floor(valor));
  let quedan = total - repartidos.reduce((suma, valor) => suma + valor, 0);
  const porResto = valores.map((valor, i) => ({ i, resto: valor - Math.floor(valor) })).sort((a, b) => b.resto - a.resto || a.i - b.i);
  for (let k = 0; quedan > 0; k++, quedan--) repartidos[porResto[k % porResto.length].i] += 1;
  /* Si sobran (las cifras sumaban algo más que el total), se quitan a las de menor resto. */
  for (let k = 0; quedan < 0; k++, quedan++) repartidos[porResto[porResto.length - 1 - (k % porResto.length)].i] -= 1;
  return repartidos;
}

export interface LineaDeLaRespuestaAlMes extends LineaDeLaRespuesta {
  /** La media mensual en euros enteros, en las unidades pedidas, redondeada para que las líneas sumen. */
  alMes: number;
}

/**
 * Las líneas de la respuesta en euros al mes, redondeadas de forma que cuadren con la cifra que se enseña (PLA-21).
 * Redondeadas una a una no sumaban: 2.333,33 + 656,83 = 2.990,17 se escribía 2.333 + 657 = 2.990, y 2.990 − 415 de
 * IRPF daba 2.575 junto a una cifra de 2.576. Aquí el bruto y el neto se redondean al euro; las fuentes se reparten
 * el bruto por el mayor resto; y el IRPF es lo que va del bruto al neto. Ninguna línea cambia más de un euro.
 */
export function respuestaAlMes(res: ResultadoDisponible, unidades: Unidades): LineaDeLaRespuestaAlMes[] {
  const lineas = respuestaDelPrimerAnio(res);
  const mes = 12 * divisorDe(res.anio1, unidades);
  const bruto = Math.round(res.anio1.bruto / mes);
  const neto = Math.round(res.anio1.neto / mes);
  const origenes = repartoConMayorResto(
    lineas.filter((linea) => linea.clase === "origen").map((linea) => linea.anual / mes),
    bruto
  );
  let siguiente = 0;
  return lineas.map((linea) => {
    const alMes = linea.clase === "origen" ? origenes[siguiente++] : linea.clase === "suma" ? bruto : linea.clase === "total" ? neto : neto - bruto;
    /* `+ 0` convierte un cero negativo en cero: un IRPF de cero no lleva signo. */
    return { ...linea, alMes: alMes + 0 };
  });
}

/* ------------------------------------------------------ Hasta cuándo, en frases --- */

export interface FraseDeEscenario {
  clave: ClaveDeEscenario;
  /** «Con la hipótesis, un 3,0 % al año», «Si rinden un 1,5 % al año»… */
  caso: string;
  /** «Llegan justo a los 95 años», «Se agotan a los 90 años»… */
  resultado: string;
  /** Los ahorros se acaban antes de la edad del plan: es lo que hay que mirar. */
  seAgota: boolean;
}

const ORDEN_DE_LAS_FRASES: readonly ClaveDeEscenario[] = ["base", "conservador", "optimista", "estres"];

/**
 * Los escenarios dichos en frases, con la hipótesis delante: es como se cuenta en una reunión. `null` sin ahorros
 * que retirar, porque entonces no hay nada que pueda acabarse. Lo que sobra va en las `unidades` del resto de la
 * pantalla y del informe.
 */
export function frasesDeEscenarios(res: ResultadoDisponible, unidades: Unidades): FraseDeEscenario[] | null {
  const escenarios = lecturaDeEscenarios(res, unidades);
  if (escenarios.every((e) => e.sinAhorros)) return null;
  const caso = (e: LecturaDeEscenario): string =>
    e.clave === "base" ? `Con la hipótesis, un ${e.hipotesis}` : e.clave === "estres" ? `Con un mal comienzo: ${e.hipotesis}` : `Si rinden un ${e.hipotesis}`;
  return ORDEN_DE_LAS_FRASES.flatMap((clave) => {
    const e = escenarios.find((escenario) => escenario.clave === clave);
    return e ? [{ clave, caso: caso(e), resultado: e.resultado, seAgota: e.edadAgotado !== null || e.edadSinPrevision !== null || e.edadSinAhorros !== null }] : [];
  });
}

/* ------------------------------------------------ Cuántos llegan a la edad del plan --- */

export interface LecturaDeSupervivencia {
  /** `false` cuando la tabla no llega a la edad del plan: la frase lo dice en vez de dar una cifra. */
  disponible: boolean;
  /** «De cada 100 mujeres de 67 años, 23 llegan a cumplir los 95.» */
  frase: string;
  /** Lo que esa cifra significa para este plan, si significa algo. */
  consecuencia: string | null;
  /** Quién lo dice y de cuándo. */
  fuente: string;
  /** Lo que la cifra no es. */
  limite: string;
}

const QUIENES: Record<Sexo | "ambos", string> = { hombre: "hombres", mujer: "mujeres", ambos: "personas" };

/**
 * De las personas que hoy tienen la edad del cliente, cuántas llegan a la edad hasta la que se planifica. Es la
 * otra mitad de elegir esa edad: con un plan que gasta los ahorros, quien llegue vivirá más que ellos. Sin sexo,
 * la tabla de ambos sexos. `null` si la edad de hoy queda fuera de la tabla: no hay nada que decir.
 */
export function lecturaDeLaSupervivencia(res: ResultadoDisponible, sexo: Sexo | null): LecturaDeSupervivencia | null {
  const tabla = TABLA_DE_MORTALIDAD;
  const { edad, edadFin, estrategia } = res.entrada;
  if (edad < tabla.edadInicial || edad >= tabla.edadFinal || edadFin <= edad) return null;
  const fuente = `${tabla.organismo}, tablas de mortalidad de ${tabla.anio} · consultadas el ${tabla.consultada}`;
  const limite = `Mide la mortalidad de ${tabla.anio} en toda la población: no es una previsión ni un dato del cliente. Si la mortalidad sigue bajando, llegarán más.`;
  const probabilidad = probabilidadDeLlegar(edad, edadFin, sexo);
  if (probabilidad === null) {
    return { disponible: false, frase: `La tabla de mortalidad acaba a los ${tabla.edadFinal} años: no dice cuántas personas llegan a cumplir los ${edadFin}.`, consecuencia: null, fuente, limite };
  }
  const deCien = Math.round(probabilidad * 100);
  const cuantos = probabilidad >= 0.995 ? "más de 99 llegan" : `${deCien} ${deCien === 1 ? "llega" : "llegan"}`;
  let consecuencia: string | null = null;
  if (res.base.saldoInicial > 1) {
    consecuencia =
      estrategia !== "conservar"
        ? "A esa edad este plan ya ha gastado los ahorros."
        : conservaSuValor(res)
          ? "Este plan conserva el capital, así que no depende de esa edad."
          : "Este plan no gasta el capital, pero con esta hipótesis pierde valor cada año: a esa edad compra menos que hoy.";
  }
  return { disponible: true, frase: `De cada 100 ${QUIENES[sexo ?? "ambos"]} de ${edad} años, ${cuantos} a cumplir los ${edadFin}.`, consecuencia, fuente, limite };
}

/* ---------------------------------------------------- Del bruto al neto, año 1 --- */

export interface LineaDelLibro {
  clave: string;
  concepto: string;
  nota?: string;
  /** En euros del primer año de jubilación. Siempre positivo: el signo va aparte. */
  anual: number;
  signo: 1 | -1;
  /** Un total: el bruto o el neto. No suma ni resta, cierra. */
  total?: boolean;
}

/**
 * El primer año, del ingreso bruto al neto, como un libro de cuentas: lo que entra, lo que se lleva el IRPF en
 * cada base, lo que devuelven las deducciones y lo que queda. Cuadra: bruto − cuotas + deducciones = neto.
 */
export function libroDelPrimerAnio(res: ResultadoDisponible): LineaDelLibro[] {
  const f = res.anio1;
  const t = f.irpf;
  const T = res.textos;
  const lineas: LineaDelLibro[] = [{ clave: "pension", concepto: "Pensión pública bruta", nota: "14 pagas", anual: f.pension, signo: 1 }];
  if (f.retiradaAhorros > 0.5) lineas.push({ clave: "ahorros", concepto: "Retiradas de ahorros e inversiones", anual: f.retiradaAhorros, signo: 1 });
  if (f.retiradaEpsv > 0.5) lineas.push({ clave: "prevision", concepto: `Cobro ${T.de}`, anual: f.retiradaEpsv, signo: 1 });
  lineas.push({ clave: "bruto", concepto: "Ingreso bruto", anual: f.bruto, signo: 1, total: true });
  if (t.cuotaGeneral > 0.5) lineas.push({ clave: "general", concepto: "IRPF de la base general", nota: `Escala ${T.rangoGeneral}`, anual: t.cuotaGeneral, signo: -1 });
  if (t.cuotaAhorro > 0.5) lineas.push({ clave: "ahorro", concepto: "IRPF de la base del ahorro", nota: `Escala ${T.rangoAhorro}`, anual: t.cuotaAhorro, signo: -1 });
  if (t.cuotaGeneral <= 0.5 && t.cuotaAhorro <= 0.5) lineas.push({ clave: "sin-irpf", concepto: "IRPF", nota: "Las rentas del año no llegan a pagar impuesto", anual: 0, signo: -1 });
  if (t.deducciones > 0.5) {
    const conceptos = t.desglose.cuota.filter((x) => x.importe > 0.5).map((x) => x.etiqueta.toLocaleLowerCase("es-ES"));
    lineas.push({ clave: "deducciones", concepto: "Deducciones en la cuota", nota: conceptos.join(", "), anual: t.deducciones, signo: 1 });
  }
  lineas.push({ clave: "neto", concepto: "Ingreso neto", anual: f.neto, signo: 1, total: true });
  return lineas;
}

/* ----------------------------------------------------- Qué tributa y dónde --- */

export interface PartidaFiscal {
  concepto: string;
  nota?: string;
  /** En euros del primer año. */
  anual: number;
  /** Reduce la base o la cuota. */
  resta?: boolean;
  /** Un paso intermedio del cálculo, no una renta. */
  intermedia?: boolean;
}

export interface BloqueFiscal {
  clave: "general" | "ahorro" | "exento";
  titulo: string;
  /** Con qué escala tributa, o que no tributa. */
  escala: string;
  partidas: PartidaFiscal[];
  /** Lo que se dice cuando el bloque no tiene nada este año. */
  vacio: string | null;
  cuota: number | null;
  marginal: number | null;
}

export interface MapaFiscal {
  bloques: BloqueFiscal[];
  /** Las deducciones en la cuota y de qué son; `null` si no hay. */
  deducciones: { anual: number; conceptos: string } | null;
  /** Lo que se dice cuando no hay deducciones. */
  sinDeducciones: string;
  total: number;
  /** El IRPF sobre el ingreso bruto. */
  sobreElBruto: number;
}

/** A qué base va cada ingreso del primer año, y qué impuesto sale de cada una. */
export function mapaFiscal(res: ResultadoDisponible): MapaFiscal {
  const f = res.anio1;
  const t = f.irpf;
  const T = res.textos;
  /* Un paso intermedio —la cuota según escala— solo se enseña si después algo la cambia: en Navarra la escala ya es
     la cuota de la base, y la fila la repetiría. */
  const delDesglose = (lineas: F.LineaDelDesglose[], cuota: number): PartidaFiscal[] =>
    lineas
      .filter((x) => (x.sub ? Math.abs(x.importe - cuota) > 0.5 : x.importe > 0.5 || x.clave === "bonificacion" || x.clave === "minoracion"))
      .map((x) => ({ concepto: x.etiqueta, anual: x.importe, resta: x.signo === "-", intermedia: Boolean(x.sub) }));

  const general: PartidaFiscal[] = [{ concepto: "Pensión pública", nota: "Rendimiento del trabajo", anual: f.pension }];
  if (f.epsvTrabajo > 0.5) general.push({ concepto: `${T.Figura}: ${T.vasco ? "parte de aportaciones" : "lo cobrado"}`, nota: "Rendimiento del trabajo", anual: f.epsvTrabajo });
  general.push(...delDesglose(t.desglose.general, t.cuotaGeneral));

  const ahorro: PartidaFiscal[] = [];
  if (f.ganancia > 0.5) ahorro.push({ concepto: "Ganancias de lo vendido", nota: "Solo la plusvalía de fondos, acciones y seguros", anual: f.ganancia });
  if (f.interes > 0.5) ahorro.push({ concepto: "Intereses de liquidez y depósitos", nota: "Tributan cada año, se retiren o no", anual: f.interes });
  if (f.epsvRent - f.epsvRentExenta > 0.5) ahorro.push({ concepto: `${T.Figura}: rentabilidad`, nota: "Rendimiento del capital mobiliario", anual: f.epsvRent - f.epsvRentExenta });
  const hayAhorro = ahorro.length > 0;
  if (hayAhorro) ahorro.push(...delDesglose(t.desglose.ahorro, t.cuotaAhorro));

  const exento: PartidaFiscal[] = [];
  if (f.principal > 0.5) exento.push({ concepto: "Capital propio", nota: "Lo aportado o lo que ya tributó: retirarlo no paga IRPF", anual: f.principal });
  if (f.epsvRentExenta > 0.5) exento.push({ concepto: `${T.Figura}: rentabilidad exenta`, nota: `Renta vitalicia o de ${res.parametros.prevision.rentaMinimaAnios} años o más`, anual: f.epsvRentExenta });

  const enCuota = t.desglose.cuota.filter((x) => x.importe > 0.5);
  return {
    bloques: [
      { clave: "general", titulo: "Base general", escala: `Escala ${T.rangoGeneral}`, partidas: general, vacio: null, cuota: t.cuotaGeneral, marginal: t.marginalGeneral },
      { clave: "ahorro", titulo: "Base del ahorro", escala: `Escala ${T.rangoAhorro}`, partidas: ahorro, vacio: hayAhorro ? null : "Sin rentas en esta base este año.", cuota: t.cuotaAhorro, marginal: t.marginalAhorro },
      { clave: "exento", titulo: "No tributa", escala: "Sin IRPF", partidas: exento, vacio: exento.length ? null : "Nada este año.", cuota: null, marginal: null }
    ],
    deducciones: t.deducciones > 0.5 ? { anual: t.deducciones, conceptos: enCuota.map((x) => x.etiqueta.toLocaleLowerCase("es-ES")).join(", ") } : null,
    sinDeducciones: res.entrada.edadJubilacion < 65 ? T.edadDeduccion : "Sin deducciones en la cuota este año.",
    total: t.total,
    sobreElBruto: f.bruto ? f.impuesto / f.bruto : 0
  };
}

/* ------------------------------------------------------- Las series de los gráficos --- */

/**
 * Los cortes de un eje que llega a `maximo`: redondos —0, 1.000, 2.000…— y con el último por encima del máximo.
 * Los usan los gráficos de pantalla y los del papel, para que el mismo dato lleve el mismo eje.
 */
export function cortesDelEje(maximo: number, pasos = 4): number[] {
  if (!(maximo > 0)) return [0, 1];
  const bruto = maximo / pasos;
  const magnitud = Math.pow(10, Math.floor(Math.log10(bruto)));
  const normal = bruto / magnitud;
  const paso = (normal <= 1 ? 1 : normal <= 2 ? 2 : normal <= 2.5 ? 2.5 : normal <= 5 ? 5 : 10) * magnitud;
  const tope = Math.ceil(maximo / paso - 1e-9) * paso;
  const cortes: number[] = [];
  for (let v = 0; v <= tope + paso * 1e-9; v += paso) cortes.push(v);
  return cortes;
}

/**
 * Cómo se reparte el bruto de un año entre lo que queda de cada fuente y el IRPF. El impuesto que añaden las
 * retiradas se reparte entre ahorros y previsión según lo que cada uno aporta a la base imponible. Solo decide
 * el color de cada tramo: los totales no cambian.
 *
 * Los cuatro tramos suman el bruto, y los tres primeros, el neto (P2-11, auditoría del 20-11-2026). El impuesto que
 * le toca a una fuente puede pasar de lo que se retira de ella: al conservar, los intereses de la liquidez tributan
 * y se quedan en la cuenta, y lo retirado de los ahorros puede ser cero. Antes ese tramo se recortaba a cero y el
 * impuesto que sobraba no lo pagaba nadie: la barra pasaba del bruto. Ahora lo que sobra lo paga lo demás que se
 * cobra ese año: primero la otra retirada y, si no alcanza, la pensión.
 */
export function repartoAnual(f: FilaAnual): { pension: number; ahorros: number; prevision: number; irpf: number } {
  const delAhorro = f.interes + f.ganancia;
  const deLaPrevision = f.epsvTrabajo + (f.epsvRent - f.epsvRentExenta);
  const total = delAhorro + deLaPrevision;
  const extra = f.impuestoResto;
  const retirado = f.retiradaAhorros + f.retiradaEpsv;
  const alAhorro = total > 0 ? (extra * delAhorro) / total : retirado > 0 ? (extra * f.retiradaAhorros) / retirado : 0;
  let pension = f.pensionNeta;
  let ahorros = f.retiradaAhorros - alAhorro;
  let prevision = f.retiradaEpsv - (extra - alAhorro);
  if (ahorros < 0) {
    prevision += ahorros;
    ahorros = 0;
  }
  if (prevision < 0) {
    ahorros += prevision;
    prevision = 0;
  }
  if (ahorros < 0) {
    pension += ahorros;
    ahorros = 0;
  }
  return { pension: Math.max(0, pension), ahorros, prevision, irpf: Math.max(0, f.impuesto) };
}

export interface PuntoDeIngresos {
  edad: number;
  /** Media mensual: el total del año entre 12. */
  pension: number;
  ahorros: number;
  prevision: number;
  irpf: number;
  bruto: number;
  neto: number;
}

/** El ingreso mensual de cada año, repartido en lo que queda de cada fuente y el IRPF. */
export function serieDeIngresos(res: ResultadoDisponible, unidades: Unidades): PuntoDeIngresos[] {
  return res.base.filas.map((f) => {
    const mes = 12 * divisorDe(f, unidades);
    const p = repartoAnual(f);
    return { edad: f.edad, pension: p.pension / mes, ahorros: p.ahorros / mes, prevision: p.prevision / mes, irpf: p.irpf / mes, bruto: f.bruto / mes, neto: f.neto / mes };
  });
}

export type PuntoDeSaldos = { edad: number } & Partial<Record<ClaveDeEscenario, number>>;

/**
 * El patrimonio que queda en cada escenario. El primer punto es el de la jubilación; cada uno de los siguientes,
 * el cierre de un año.
 */
export function serieDeSaldos(res: ResultadoDisponible, unidades: Unidades): PuntoDeSaldos[] {
  const inflacion = res.entrada.inflacion;
  const deflactorInicial = unidades === "hoy" ? res.anio1.deflactor : 1;
  const edadInicial = res.entrada.edadJubilacion;
  const puntos: PuntoDeSaldos[] = Array.from({ length: res.entrada.aniosPlan + 1 }, (_, i) => ({ edad: edadInicial + i }));
  for (const escenario of res.escenarios) {
    puntos[0][escenario.clave] = escenario.saldoInicial / deflactorInicial;
    escenario.filas.forEach((fila, i) => {
      puntos[i + 1][escenario.clave] = Math.max(0, saldoAlCierre(fila, inflacion, unidades));
    });
  }
  return puntos;
}

/* ---------------------------------------------------------------- Los escenarios --- */

export interface LecturaDeEscenario {
  clave: ClaveDeEscenario;
  nombre: string;
  /** Con qué rentabilidad se ha proyectado. */
  hipotesis: string;
  resultado: string;
  /** Qué parte de las retiradas previstas llega a pagar el patrimonio. */
  cobertura: number;
  edadAgotado: number | null;
  /** La edad a la que la EPSV o el plan deja de pagarse entero, si es antes de que se acabe todo. `null` si no pasa. */
  edadSinPrevision: number | null;
  /** Lo mismo para los ahorros que no son la previsión. */
  edadSinAhorros: number | null;
  /** Lo que queda al final del plan, en euros de hoy. */
  finalDeHoy: number;
  /** Lo mismo, en las unidades pedidas: es la cifra de la frase, y el último punto de `serieDeSaldos` en ellas. */
  final: number;
  sinAhorros: boolean;
}

/**
 * Cada escenario en una línea: todos retiran lo mismo que el plan, y solo cambia lo que rinde el patrimonio. Lo que
 * sobra se escribe en las `unidades` pedidas; si sobra algo o se llega justo se decide en euros de hoy, para que
 * cambiar de unidades cambie la cifra y no la conclusión.
 */
export function lecturaDeEscenarios(res: ResultadoDisponible, unidades: Unidades): LecturaDeEscenario[] {
  const o = res.entrada;
  return res.escenarios.map((e) => {
    const finalDeHoy = patrimonioFinalDeHoy(e, o.inflacion);
    const ultima = e.filas.at(-1);
    const final = ultima ? Math.max(0, saldoAlCierre(ultima, o.inflacion, unidades)) : 0;
    const sinAhorros = e.saldoInicial <= 1;
    const edadAgotado = edadDeAgotamiento(e);
    /* A-168: la parte que se acaba antes que el conjunto se dice en la misma frase. */
    const porPartes = edadesSinCobrarEntero(res, e);
    const antesDe = (edad: number | null): number | null => (edad !== null && (edadAgotado === null || edad < edadAgotado) ? edad : null);
    const edadSinPrevision = sinAhorros ? null : antesDe(porPartes.prevision);
    const edadSinAhorros = sinAhorros || edadSinPrevision !== null ? null : antesDe(porPartes.ahorros);
    const laPrevision = res.textos.vasco ? "la EPSV" : "el plan de pensiones";
    const lasPartes = edadSinPrevision !== null
      ? edadAgotado !== null ? `; ${laPrevision}, ya a los ${edadSinPrevision}` : `; ${laPrevision} se agota a los ${edadSinPrevision}`
      : edadSinAhorros !== null
        ? edadAgotado !== null ? `; los que no son ${laPrevision}, ya a los ${edadSinAhorros}` : `; los que no son ${laPrevision} se agotan a los ${edadSinAhorros}`
        : "";
    const resultado = sinAhorros
      ? "Sin ahorros"
      : (edadAgotado !== null
        ? `Se agotan a los ${edadAgotado} años`
        : finalDeHoy > 1000
          ? `Llegan a los ${o.edadFin} años y sobran ${euros(final)}`
          : `Llegan justo a los ${o.edadFin} años`) + lasPartes;
    const [primero, segundo] = AJUSTES.estres.map((caida) => supuesto(caida, 0));
    return {
      clave: e.clave,
      nombre: e.nombre,
      hipotesis: e.clave === "estres" ? `${primero} y ${segundo} los dos primeros años; después, ${supuesto(o.rentabilidad, 1)}` : `${supuesto(e.r, 1)} al año`,
      resultado,
      cobertura: Math.min(1, e.cobertura),
      edadAgotado,
      edadSinPrevision,
      edadSinAhorros,
      finalDeHoy,
      final,
      sinAhorros
    };
  });
}

/* ------------------------------------------------------- Formas de cobro comparadas --- */

export interface FormaComparada {
  forma: FormaDeCobro;
  nombre: string;
  /** Es la que está elegida en la simulación. */
  elegida: boolean;
  /** Todo en euros de hoy. La media mensual del primer año de jubilación. */
  netoMensual: number;
  /** El IRPF de todos los años del plan, con el que añade el cobro en capital. */
  irpfDelPlan: number;
  /** Lo que el cliente ingresa, neto, en todos los años del plan. */
  netoDelPlan: number;
  /** Lo que queda al final. */
  patrimonioFinal: number;
  /** El IRPF que añade el cobro de una vez, si lo hay. */
  irpfDelCapital: number | null;
  edadAgotado: number | null;
}

/**
 * La misma simulación con la EPSV o el plan de pensiones cobrado de las tres formas: en renta, de una vez y parte
 * de cada. Todo lo demás es igual —el cliente, las hipótesis, el tipo de renta, las condiciones del capital—, así
 * que las diferencias son de la forma de cobro y de nada más. En euros de hoy, sin descontar más que la inflación.
 *
 * No ordena ni señala una: cuál conviene depende de lo que el cliente necesite cobrar y cuándo, y eso no está
 * en estas cifras. `null` si no hay previsión que cobrar.
 */
export function compararFormasDeCobro(entrada: EntradaDeJubilacion): FormaComparada[] | null {
  if (!entrada.tieneEpsv || entrada.epsvPre + entrada.epsvPost <= 0) return null;
  const pctDelMixto = entrada.epsvCobro === "mixto" ? Math.min(95, Math.max(5, entrada.epsvPctCapital)) : 50;
  const formas: Array<{ forma: FormaDeCobro; nombre: string }> = [
    { forma: "renta", nombre: "En renta" },
    { forma: "mixto", nombre: `Mixto: el ${supuesto(pctDelMixto / 100, 0)} de una vez` },
    { forma: "capital", nombre: "Todo de una vez" }
  ];
  const comparadas: FormaComparada[] = [];
  for (const { forma, nombre } of formas) {
    const res = calcular({ ...entrada, epsvCobro: forma, epsvPctCapital: pctDelMixto });
    if (!res.disponible) return null;
    const filas = res.base.filas;
    const deflactorInicial = res.anio1.deflactor;
    const irpfDelCapital = res.capital ? res.capital.impuesto / deflactorInicial : null;
    comparadas.push({
      forma,
      nombre,
      elegida: forma === entrada.epsvCobro,
      netoMensual: res.resumen.netoMensual / res.resumen.deflactor1,
      irpfDelPlan: filas.reduce((suma, f) => suma + f.impuesto / f.deflactor, 0) + (irpfDelCapital ?? 0),
      netoDelPlan: filas.reduce((suma, f) => suma + f.neto / f.deflactor, 0),
      patrimonioFinal: patrimonioFinalDeHoy(res.base, res.entrada.inflacion),
      irpfDelCapital,
      edadAgotado: edadDeAgotamiento(res.base)
    });
  }
  return comparadas;
}

/* ----------------------------------------------------------- Cómo se calcula --- */

export interface PasoDelMetodo {
  titulo: string;
  texto: string;
}

/**
 * Cómo trata el simulador las pérdidas de lo vendido, en el territorio del cálculo (hallazgo P1-03; Óscar, 21-11-2026).
 * Donde la norma deja compensarlas también con los intereses del año (territorio común y Navarra, hasta el 25 %), se dice
 * que el simulador no lo hace y hacia dónde se equivoca.
 */
export function compensacionDePerdidas(res: ResultadoDisponible): string {
  const regla = F.reglaDeCompensacion(res.cfg);
  const base = `Si se vende en pérdidas, la pérdida se compensa con las ganancias de lo vendido de los ${regla.plazo} años siguientes y lo que no cabe en ese plazo se pierde (${regla.articulo}).`;
  const cruce = regla.cruceConRendimientos > 0
    ? ` La norma deja compensar además hasta un ${supuesto(regla.cruceConRendimientos, 0)} con los intereses del mismo año; el simulador no lo hace, y ese año el impuesto podría salir algo mayor que el real.`
    : "";
  return `${base}${cruce} No calcula ventas por lotes: usa el coste medio.`;
}

export function metodo(res: ResultadoDisponible): { pasos: PasoDelMetodo[]; noTieneEnCuenta: string[] } {
  /* Solo si algún escenario rinde menos de cero y hay liquidez hoy o en la jubilación: es cuando la liquidez se queda en un
     0 % (JUB-6 y A-191). */
  const hayLiquidez = res.entrada.liquidez + res.entrada.depositos > 0 || res.plan.ini.liq + res.plan.netoCapital > 0;
  const liquidezAlCero = hayLiquidez && res.escenarios.some((escenario) => escenario.r < 0);
  return {
    pasos: [
      { titulo: "El punto de partida", texto: "Se toman los saldos de hoy. Si aún falta para la jubilación, crecen con la rentabilidad elegida y con el ahorro anual hasta entonces." },
      { titulo: "Un plan de retiradas", texto: "Se calcula la retirada anual que, subiendo con el IPC, agota los ahorros justo a la edad elegida. Si se prefiere conservar el capital, solo se retira la rentabilidad por encima del IPC." },
      { titulo: "El IRPF de cada año", texto: res.textos.pasoTres },
      { titulo: "En euros de hoy", texto: "Cada importe se divide por la inflación acumulada hasta su año, para poder compararlo con lo que cuesta vivir hoy." }
    ],
    noTieneEnCuenta: [
      res.escalasConElIpc
        ? `Las escalas, las deducciones y los límites del IRPF de ${res.cfg.ejercicio} se actualizan cada año con el IPC supuesto${
            res.cfg.modelo === "navarra" ? ": es un supuesto, y en 2026 Navarra no actualizó su escala" : ", como vienen haciendo las Haciendas forales vascas: es un supuesto"
          }. Si un año no se actualizan, el impuesto real sería mayor que el estimado.`
        : `Las reglas del IRPF de ${res.cfg.ejercicio} se mantienen fijas, en euros nominales, todos los años del plan: si las escalas se actualizan con la inflación, el impuesto real sería menor que el estimado.`,
      ...res.limites,
      "Una sola rentabilidad para todo el patrimonio, igual todos los años: es un supuesto elegido para simular, no una previsión ni una rentabilidad prometida. Los mercados suben y bajan.",
      ...(liquidezAlCero ? ["Con una rentabilidad negativa, la liquidez y los depósitos rinden un 0 %, antes y después de la jubilación: el efectivo no pierde euros, solo poder de compra, y eso ya lo recoge la inflación."] : []),
      "Las retiradas salen de la liquidez y de las inversiones a prorrata de su saldo, sin un orden fiscal.",
      compensacionDePerdidas(res),
      "No incluye otros ingresos (alquileres, trabajo) ni el IRPF de los años anteriores a la jubilación.",
      "Un solo contribuyente, en declaración individual: no reparte los ahorros con el cónyuge ni cuenta su pensión.",
      "La pensión sube cada año con el IPC supuesto, sin aplicar la pensión máxima.",
      /* Los dos que siguen, solo si se han elegido: son límites de esa forma de cobro, no del cálculo entero. */
      ...(res.capital ? ["Lo cobrado de una vez se suma a la liquidez: rinde como ella y sus intereses tributan cada año, como los de un depósito. Reinvertido en fondos, tributaría más tarde."] : []),
      ...(res.plan.Epsv0 > 0 && res.entrada.epsvRenta === "vitalicia" ? [`La renta vitalicia se reparte hasta la edad del plan (${res.entrada.edadFin} años) y ahí se acaba: su cuantía cambia con esa edad. La de una aseguradora no se agota, y la calcula con sus propias tablas.`] : [])
    ]
  };
}

/* -------------------------------------------------------- Los datos de la simulación --- */

/** Con qué datos se ha calculado, en pares rótulo y valor, para que el informe diga de dónde salen sus cifras. */
export function datosDeLaSimulacion(res: ResultadoDisponible): Array<[rotulo: string, valor: string]> {
  const o = res.entrada;
  const T = res.textos;
  const ahorros = o.liquidez + o.depositos + o.fondos + o.acciones + o.seguros;
  const cobro = { renta: "en forma de renta", capital: "de una vez (capital)", mixto: `mixto, ${supuesto(o.epsvPctCapital / 100, 0)} de una vez` }[o.epsvCobro];
  const tipoDeRenta = { flexible: "retiradas periódicas", temporal: `renta temporal de ${o.epsvAniosRenta} años`, vitalicia: `renta vitalicia, aproximada con una cuantía constante hasta los ${o.edadFin} años` }[o.epsvRenta];
  const datos: Array<[string, string]> = [
    ["Edad actual", `${o.edad} años`],
    ["Jubilación", o.aniosHastaJubilacion ? `A los ${o.edadJubilacion} años` : "Ya jubilado"],
    ["Pensión pública bruta", `${euros(o.pension)} × 14 pagas`],
    ["Horizonte del plan", `Hasta los ${o.edadFin} años`],
    ["Ahorros e inversiones hoy", euros(ahorros)]
  ];
  if (o.aniosHastaJubilacion && o.ahorroAnual > 0) datos.push(["Ahorro anual hasta la jubilación", euros(o.ahorroAnual)]);
  datos.push(
    ["Uso de los ahorros", o.estrategia === "conservar" ? "Vivir de lo que rinden" : "Gastarlos a lo largo del plan"],
    [T.Figura, o.tieneEpsv && o.epsvPre + o.epsvPost > 0 ? `${euros(o.epsvPre + o.epsvPost)}, ${cobro}${o.epsvCobro !== "capital" ? ` · ${tipoDeRenta}` : ""}` : "No"],
    ["Rentabilidad e inflación supuestas", `${supuesto(o.rentabilidad, 1)} y ${supuesto(o.inflacion, 1)} al año`],
    ["Residencia fiscal", `${T.nombre} · ${res.cfg.irpf} ${res.cfg.ejercicio}`]
  );
  if (o.otrasDeducciones > 0) datos.push(["Otras deducciones en la cuota", `${euros(o.otrasDeducciones)} al año`]);
  return datos;
}

/* ------------------------------------------------------ Lo supuesto y lo avisado --- */

/**
 * Lo que el simulador supone con una EPSV sin desglose (modelo vasco): la estimación reglada de su rentabilidad y a qué
 * tramo va el saldo (N05). El formulario lo dice junto al saldo y el informe con los supuestos, con las mismas palabras:
 * hasta el 22-11-2026 solo lo decía la pantalla (H2-17 de la auditoría de ese día). Sin `calculado`, la regla sin la
 * estimación que se aplica. Fuera del modelo vasco no hay nada que suponer.
 */
export function notasDelSaldoSinDesglose(cfg: F.Configuracion, antiguedadConocida: boolean, antiguedad: number, calculado: ResultadoDisponible | null): string[] {
  const pv = cfg.parametros.prevision;
  if (pv.modelo !== "vasco") return [];
  const entero = (fraccion: number): string => supuesto(fraccion, 0);
  const aplicada = calculado ? ` en el ${entero(F.ratioEstimado(calculado.cfg, calculado.entrada.antiguedadConocida, calculado.entrada.antiguedad))} de lo cobrado` : "";
  const crece =
    calculado && calculado.entrada.aniosHastaJubilacion > 0 && calculado.entrada.rentabilidad > 0
      ? " El simulador la aplica al saldo de hoy; lo que crezca hasta la jubilación cuenta entero como rentabilidad."
      : "";
  return [
    `Sin desglose, ${cfg.hacienda} estima la rentabilidad${aplicada}: un ${entero(pv.estimacionAnual)} por año de antigüedad, con un máximo del ${entero(pv.estimacionMaxima)}, o el ${entero(pv.estimacionSinAntiguedad)} si no se conoce la antigüedad.${crece}`,
    F.saldoSinDesgloseEsPosterior(antiguedadConocida, antiguedad)
      ? `Con un año de antigüedad o menos, la primera aportación puede ser de ${pv.corte}: el simulador trata el saldo entero como posterior a ${pv.corte - 1} y no aplica el régimen transitorio. El certificado de la EPSV da el reparto exacto.`
      : `El simulador trata el saldo como aportado hasta ${pv.corte - 1}. Si el cliente ha aportado en ${pv.corte}, el certificado de la EPSV da el reparto exacto.`
  ];
}

/**
 * Lo que se dice cuando la casilla de «más de 2 años desde la primera aportación» no puede cumplirse con lo escrito (sin
 * desglose, antigüedad conocida): la pantalla la desmarca junto a ella y el informe lo lleva con los supuestos (H1-03,
 * aprobado por Óscar el 23-11-2026). `null` si puede cumplirse o no se sabe.
 */
export function notaDeLosDosAnios(o: { sinDesglose: boolean; antiguedadConocida: boolean; antiguedad: number; aniosHastaCobro: number; contingencia: string }): string | null {
  if (!F.dosAniosNoPuedeCumplirse(o)) return null;
  return o.aniosHastaCobro > 0
    ? "Con la antigüedad escrita, cuando se cobre no habrán pasado más de 2 años desde la primera aportación: el cobro no tiene la reducción."
    : "Con la antigüedad escrita, no han pasado más de 2 años desde la primera aportación: el cobro no tiene la reducción.";
}

/**
 * Lo que la pantalla avisa sobre el resultado, y el informe en su primera hoja: lo supuesto para poder calcular
 * (`entradaDelMotor`) y lo que el motor ha corregido de la entrada. Hasta el 22-11-2026 el informe llevaba solo lo
 * primero (H2-17).
 */
export function avisosDelResultado(res: ResultadoDisponible, supuestos: readonly string[]): string[] {
  return [...supuestos, ...res.avisos];
}

/** Lo supuesto de la EPSV del resultado si va sin desglose y tiene saldo, para el informe: lo que el formulario dice junto al saldo. */
export function supuestosDeLaPrevision(res: ResultadoDisponible): string[] {
  const o = res.entrada;
  if (!(o.tieneEpsv && o.epsvDesglose === "estimacion" && o.epsvPre + o.epsvPost > 0)) return [];
  const dosAnios = o.epsvCobro === "renta" ? null : notaDeLosDosAnios({ sinDesglose: true, antiguedadConocida: o.antiguedadConocida, antiguedad: o.antiguedad, aniosHastaCobro: o.aniosHastaJubilacion, contingencia: o.contingencia });
  return [...notasDelSaldoSinDesglose(res.cfg, o.antiguedadConocida, o.antiguedad, res), ...(dosAnios ? [dosAnios] : [])];
}
