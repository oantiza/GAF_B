/**
 * El motor y las reglas fiscales de Jubilación, comparados con los de NUVIA, de donde salieron.
 *
 * Son dos copias de las mismas reglas —la de NUVIA en JavaScript y la de aquí en TypeScript— y nada las ata: si
 * una cambia y la otra no, ninguna prueba de ninguno de los dos proyectos se entera. Esta sí. **No corre con la
 * suite**: lee otro proyecto, que puede no estar en el ordenador, así que solo corre si se le dice dónde está:
 *
 *   NUVIA_DIR=C:/Users/oanti/Documents/NUVIA-PORTAL-ALFA npx vitest run tests/jubilacionParidadConNuvia.test.ts
 *
 * Lee de NUVIA y no escribe nada en él. Compara las cifras, no los textos: aquí se habla del cliente en tercera
 * persona y allí al usuario de tú. Cuándo pasarla: al revisar las reglas de un ejercicio nuevo, y siempre que se
 * toque `fiscal.ts` o `motor.ts`. Si falla, una de las dos copias ha cambiado: se mira cuál y por qué antes de
 * tocar nada.
 */
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";
import { beforeAll, describe, expect, test } from "vitest";
import * as F from "../src/core/jubilacion/fiscal";
import { calcular, type EntradaDeJubilacion } from "../src/core/jubilacion/motor";

const RAIZ = process.env.NUVIA_DIR;

/* Lo que NUVIA expone, sin tipos: es JavaScript de otro proyecto. */
interface Nuvia {
  motor: { calcular: (entrada: unknown) => unknown };
  fiscal: { configuracion: (territorio: string | null, ccaa?: string | null) => unknown; irpf: (cfg: unknown, rentas: unknown) => unknown };
}

/** Generador con semilla: la misma muestra en cada pasada, para que un fallo se pueda repetir. */
function azar(semilla: number) {
  let a = semilla >>> 0;
  const siguiente = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const entre = (min: number, max: number) => min + siguiente() * (max - min);
  return {
    entre,
    entero: (min: number, max: number) => Math.floor(entre(min, max + 1)),
    uno: <T,>(opciones: readonly T[]): T => opciones[Math.floor(siguiente() * opciones.length)],
    si: (probabilidad = 0.5) => siguiente() < probabilidad,
    /** Un importe, que la mitad de las veces es redondo y a veces es cero. */
    importe: (max: number, ceros = 0.25) => (siguiente() < ceros ? 0 : siguiente() < 0.5 ? Math.round(entre(0, max) / 1000) * 1000 : Math.round(entre(0, max) * 100) / 100)
  };
}

const TERRITORIOS = F.TERRITORIOS.map((territorio) => territorio.id);
const COMUNIDADES = F.CCAA.map((comunidad) => comunidad.id);

function entradaAlAzar(r: ReturnType<typeof azar>): EntradaDeJubilacion {
  const edad = r.entero(40, 95);
  const fondos = r.importe(600000);
  const acciones = r.importe(300000);
  const seguros = r.importe(150000, 0.6);
  const epsvPre = r.importe(200000);
  const epsvPost = r.importe(120000);
  return {
    territorio: r.uno(TERRITORIOS),
    ccaa: r.uno(COMUNIDADES),
    edad,
    edadJubilacion: r.si(0.35) ? edad : edad + r.entero(-3, 20),
    pension: r.importe(3600, 0.1),
    edadFin: r.entero(70, 108),
    estrategia: r.uno(["consumir", "conservar"] as const),
    liquidez: r.importe(250000),
    depositos: r.importe(150000, 0.6),
    fondos,
    fondosCoste: r.importe(fondos * 1.3),
    acciones,
    accionesCoste: r.importe(acciones * 1.3),
    seguros,
    segurosCoste: r.importe(seguros * 1.2),
    ahorroAnual: r.importe(15000, 0.5),
    tieneEpsv: r.si(0.6),
    epsvPre,
    epsvPreRent: r.importe(epsvPre * 1.1),
    epsvPost,
    epsvPostRent: r.importe(epsvPost * 1.1),
    epsvDesglose: r.uno(["certificado", "estimacion"] as const),
    antiguedadConocida: r.si(0.7),
    antiguedad: r.entero(1, 45),
    epsvCobro: r.uno(["renta", "capital", "mixto"] as const),
    epsvPctCapital: r.entero(0, 100),
    epsvRenta: r.uno(["flexible", "temporal", "vitalicia"] as const),
    epsvAniosRenta: r.entero(5, 40),
    contingencia: r.uno(["jubilacion", "invalidez", "dependencia", "enfermedad", "desempleo", "otro"]),
    primerCobro: r.si(0.7),
    dosAnios: r.si(0.8),
    regimen: r.uno(["auto", "transitorio", "nuevo"] as const),
    rentabilidad: Math.round(r.entre(-3, 11) * 10) / 10,
    inflacion: Math.round(r.entre(0, 6.5) * 10) / 10,
    otrasDeducciones: r.importe(1500, 0.7),
    estres: r.si(0.7)
  };
}

/** Lo que este motor da y el de NUVIA no tiene: no hay con qué compararlo. */
/* Las cinco de las pérdidas de lo vendido son del P1-03 (21-11-2026): NUVIA no compensa pérdidas, y no las tiene. */
const SOLO_AQUI = new Set(["escalasConElIpc", "gananciaBruta", "perdida", "compensado", "perdidaCaducada", "perdidasPendientes"]);
/** Las ramas del resultado que son texto, configuración o funciones: no se comparan. */
const FUERA = new Set(["cfg", "textos", "limites", "parametros", "plan", "avisos", "mensaje"]);
/** Las claves cuyo texto sí es parte del cálculo: qué régimen se aplicó, qué escenario es, con qué método. */
const TEXTO_QUE_CUENTA = new Set(["clave", "elegido", "metodoEpsv", "metodo", "estado"]);

interface Recuento {
  comparados: number;
  distintos: string[];
}

/**
 * Lo que aquí es distinto **a propósito**, con las dos cifras escritas: si cualquiera de las dos cambia, la prueba
 * falla igual que con cualquier otra diferencia. Cada entrada es una decisión de este proyecto, no un despiste.
 *
 * - `rentaMinimaAnios` fuera del País Vasco (auditoría del 16-11-2026, JUB-4): los quince años son el requisito de la
 *   exención vasca. En territorio común y en Navarra aquí se deja simular una renta temporal desde dos años; NUVIA
 *   sigue exigiendo quince. Por eso la muestra de simulaciones no baja de quince fuera del País Vasco: por debajo,
 *   NUVIA calcula otra renta y no hay nada que comparar.
 * - La liquidez con una rentabilidad negativa (auditoría del 16-11-2026, JUB-6 de la tabla de bajos; decidido por Óscar
 *   el 17-11-2026): en las dos copias rinde un 0 % en la proyección de cada año, pero al calcular la retirada que agota
 *   los ahorros NUVIA le da la rentabilidad negativa y aquí también un 0 % (`rendimientoDeLaLiquidez`). El efectivo no
 *   pierde euros, solo poder de compra, y eso ya lo recoge la inflación. No es una cifra suelta sino todo el plan, así
 *   que no cabe en esta lista: la muestra de simulaciones quita la liquidez y el cobro de una vez cuando la rentabilidad
 *   es negativa y se gastan los ahorros —sin ellos las dos copias coinciden, y se sigue comparando todo lo demás—, y una
 *   prueba aparte fija que la diferencia va en el sentido decidido.
 * - Las ventas en pérdidas (hallazgo P1-03 de la auditoría del 20-11-2026; decidido por Óscar el 21-11-2026): aquí lo
 *   vendido se lleva la parte de su coste que le toca y la pérdida se compensa con las ganancias de los cuatro años
 *   siguientes; NUVIA limita el coste que sale a lo cobrado y deja el resto en la cartera, sin plazo. Tampoco cabe en
 *   la lista: la muestra no compara las simulaciones en que algún escenario vende en pérdidas —sin ellas el coste que
 *   sale es el mismo en las dos copias—, y las cuenta.
 * - La EPSV vasca sin desglose con años hasta la jubilación y rentabilidad positiva (aprobado por Óscar el 22-11-2026):
 *   aquí la estimación reglada cubre solo el saldo de hoy y lo que crece hasta jubilarse es todo rentabilidad; NUVIA
 *   aplica la estimación a la prestación entera. Tampoco cabe en la lista: la muestra no compara esas simulaciones
 *   —jubilándose hoy, o con pérdida, las dos copias coinciden— y las cuenta.
 */
const DISTINTO_A_PROPOSITO: ReadonlyArray<{ ruta: RegExp; aqui: number; enNuvia: number }> = [
  { ruta: /parametros\.prevision\.rentaMinimaAnios$/, aqui: 2, enNuvia: 15 }
];

const MODELO_VASCO = new Set(F.TERRITORIOS.filter((territorio) => territorio.modelo === "vasco").map((territorio) => territorio.id));

/** Recorre lo que da este módulo y exige que NUVIA dé lo mismo en el mismo sitio. */
function comparar(nuestro: unknown, suyo: unknown, ruta: string, recuento: Recuento): void {
  if (recuento.distintos.length > 12) return;
  if (typeof nuestro === "function") return;
  if (typeof nuestro === "number") {
    recuento.comparados++;
    /* Solo donde aquí está la cifra de la excepción: en el modelo vasco son quince en las dos copias, y se compara como todo. */
    const sabido = DISTINTO_A_PROPOSITO.find((excepcion) => excepcion.ruta.test(ruta) && nuestro === excepcion.aqui);
    if (sabido) {
      if (suyo !== sabido.enNuvia) recuento.distintos.push(`${ruta}: aquí ${nuestro} a propósito, y en NUVIA se esperaba ${sabido.enNuvia}; hay ${String(suyo)}`);
      return;
    }
    const igual = typeof suyo === "number" && (Object.is(nuestro, suyo) || Math.abs(nuestro - suyo) <= 1e-9 * Math.max(1, Math.abs(nuestro), Math.abs(suyo)));
    if (!igual) recuento.distintos.push(`${ruta}: aquí ${nuestro}, en NUVIA ${String(suyo)}`);
    return;
  }
  if (typeof nuestro === "boolean" || nuestro === null) {
    recuento.comparados++;
    /* Lo que aquí es `null` allí puede no existir: las dos cosas dicen «no hay». */
    if (nuestro === null ? suyo != null : nuestro !== suyo) recuento.distintos.push(`${ruta}: aquí ${String(nuestro)}, en NUVIA ${String(suyo)}`);
    return;
  }
  if (typeof nuestro === "string") {
    if (TEXTO_QUE_CUENTA.has(ruta.split(".").at(-1)!.replace(/\[\d+\]$/, ""))) {
      recuento.comparados++;
      if (nuestro !== suyo) recuento.distintos.push(`${ruta}: aquí «${nuestro}», en NUVIA «${String(suyo)}»`);
    }
    return;
  }
  if (Array.isArray(nuestro)) {
    const lista = Array.isArray(suyo) ? suyo : [];
    if (lista.length !== nuestro.length) recuento.distintos.push(`${ruta}: aquí ${nuestro.length} elementos, en NUVIA ${Array.isArray(suyo) ? lista.length : "no es una lista"}`);
    nuestro.forEach((elemento, i) => comparar(elemento, lista[i], `${ruta}[${i}]`, recuento));
    return;
  }
  if (nuestro && typeof nuestro === "object") {
    const otro = (suyo ?? {}) as Record<string, unknown>;
    for (const [clave, valor] of Object.entries(nuestro)) {
      if (ruta === "" && FUERA.has(clave)) continue;
      if (SOLO_AQUI.has(clave)) continue;
      comparar(valor, otro[clave], ruta ? `${ruta}.${clave}` : clave, recuento);
    }
  }
}

describe.skipIf(!RAIZ)("el motor y las reglas de Jubilación dan lo mismo que los de NUVIA", () => {
  let nuvia: Nuvia;

  beforeAll(() => {
    const ficheros = ["fiscal", "motor"].map((nombre) => `${RAIZ}/js/nuvia-jubilacion-${nombre}.js`);
    const falta = ficheros.find((fichero) => !existsSync(fichero));
    if (falta) throw new Error(`NUVIA_DIR no apunta a NUVIA: falta ${falta}`);
    const contexto: Record<string, unknown> = {};
    for (const fichero of ficheros) vm.runInNewContext(readFileSync(fichero, "utf8"), contexto);
    nuvia = { motor: contexto.NuviaJubilacion as Nuvia["motor"], fiscal: contexto.NuviaJubilacionFiscal as Nuvia["fiscal"] };
  });

  test("los parámetros fiscales de cada territorio y de cada comunidad son los mismos, cifra a cifra", () => {
    const recuento: Recuento = { comparados: 0, distintos: [] };
    const pares: Array<[string, string | null]> = [...TERRITORIOS.filter((id) => id !== "estatal").map((id): [string, null] => [id, null]), ...COMUNIDADES.map((id): [string, string] => ["estatal", id])];
    for (const [territorio, ccaa] of pares) {
      const aqui = F.configuracion(territorio, ccaa);
      const alli = nuvia.fiscal.configuracion(territorio, ccaa) as Record<string, unknown> | null;
      expect(aqui, `${territorio} ${ccaa ?? ""}`).not.toBeNull();
      comparar({ parametros: aqui!.parametros, escalaAutonomica: aqui!.escalaAutonomica ?? null, minimoAutonomico: aqui!.minimoAutonomico ?? null, ejercicio: aqui!.ejercicio, estado: aqui!.estado },
        { parametros: alli?.parametros, escalaAutonomica: alli?.escalaAutonomica, minimoAutonomico: alli?.minimoAutonomico, ejercicio: alli?.ejercicio, estado: alli?.estado }, `${territorio}${ccaa ? `/${ccaa}` : ""}`, recuento);
    }
    expect(recuento.distintos).toEqual([]);
    expect(recuento.comparados).toBeGreaterThan(1000);
  });

  test("20.000 liquidaciones de IRPF al azar dan el mismo resultado", () => {
    const r = azar(20261113);
    const recuento: Recuento = { comparados: 0, distintos: [] };
    for (let i = 0; i < 20000; i++) {
      const territorio = r.uno(TERRITORIOS);
      const ccaa = territorio === "estatal" ? r.uno(COMUNIDADES) : null;
      const cfg = F.configuracion(territorio, ccaa);
      if (!F.disponible(cfg)) continue;
      const trabajo = r.importe(120000, 0.15);
      const rentas = { trabajo, ahorro: r.importe(90000, 0.3), edad: r.entero(40, 100), otrasDeducciones: r.importe(2500, 0.7), trabajoBruto: trabajo + r.importe(60000, 0.6) };
      comparar(F.irpf(cfg, rentas), nuvia.fiscal.irpf(nuvia.fiscal.configuracion(territorio, ccaa), rentas), `irpf ${i} (${territorio}${ccaa ? `/${ccaa}` : ""}, ${JSON.stringify(rentas)})`, recuento);
    }
    expect(recuento.distintos).toEqual([]);
    expect(recuento.comparados).toBeGreaterThan(200000);
  }, 600_000);

  test("4.000 simulaciones al azar dan las mismas cifras, año a año y en cada escenario", () => {
    const r = azar(4000);
    const recuento: Recuento = { comparados: 0, distintos: [] };
    let conCapital = 0;
    let antesDeJubilarse = 0;
    let mayoresDe75 = 0;
    let negativas = 0;
    let conPerdidas = 0;
    let epsvSinDesgloseQueCrece = 0;
    for (let i = 0; i < 4000; i++) {
      const entrada = entradaAlAzar(r);
      /* Ver DISTINTO_A_PROPOSITO: fuera del País Vasco las dos copias solo coinciden desde quince años de renta. */
      if (!MODELO_VASCO.has(entrada.territorio ?? "")) entrada.epsvAniosRenta = Math.max(15, entrada.epsvAniosRenta);
      /* Ver DISTINTO_A_PROPOSITO: con una rentabilidad negativa solo coinciden sin liquidez, porque aquí rinde un 0 %
         antes de jubilarse (A-191) y, gastando los ahorros, también al calcular la retirada (JUB-6). */
      if (entrada.rentabilidad < 0) {
        Object.assign(entrada, { liquidez: 0, depositos: 0 });
        if (entrada.estrategia === "consumir") Object.assign(entrada, { epsvCobro: "renta" });
        negativas++;
      }
      /* NUVIA deja las reglas del IRPF fijas en todos los territorios; aquí los vascos las actualizan (A-159). Se compara
         con las fijas, que es la cuenta que comparten los dos motores. */
      const aqui = calcular(entrada, { escalasDelIrpf: "fijas" });
      /* Ver DISTINTO_A_PROPOSITO: si algún escenario vende en pérdidas, las dos copias calculan distinto a propósito (P1-03). */
      if (aqui.disponible && aqui.escenarios.some((escenario) => escenario.filas.some((fila) => fila.perdida > 0))) {
        conPerdidas++;
        continue;
      }
      /* Ver DISTINTO_A_PROPOSITO: sin desglose, el crecimiento hasta jubilarse es todo rentabilidad aquí, no en NUVIA. */
      if (aqui.disponible && aqui.entrada.epsvDesglose === "estimacion" && aqui.entrada.tieneEpsv && aqui.entrada.aniosHastaJubilacion > 0 && aqui.entrada.rentabilidad > 0) {
        epsvSinDesgloseQueCrece++;
        continue;
      }
      if (aqui.disponible) {
        if (aqui.capital) conCapital++;
        if (aqui.entrada.aniosHastaJubilacion > 0) antesDeJubilarse++;
        if (aqui.entrada.edad > 75) mayoresDe75++;
      }
      comparar(aqui, nuvia.motor.calcular(entrada), `simulación ${i} (${JSON.stringify(entrada)})`, recuento);
    }
    expect(recuento.distintos).toEqual([]);
    /* La muestra tiene que haber pasado por lo difícil: cobros de una vez, años de espera y clientes de más de 75. */
    expect(conCapital).toBeGreaterThan(800);
    expect(antesDeJubilarse).toBeGreaterThan(800);
    expect(mayoresDe75).toBeGreaterThan(800);
    /* Y por rentabilidades negativas, aunque sea sin liquidez. */
    expect(negativas).toBeGreaterThan(300);
    expect(recuento.comparados).toBeGreaterThan(1_000_000);
    console.info(`Paridad con NUVIA: ${conPerdidas} de 4.000 simulaciones venden en pérdidas y no se comparan (P1-03).`);
    console.info(`Paridad con NUVIA: ${epsvSinDesgloseQueCrece} de 4.000 tienen una EPSV vasca sin desglose que crece hasta jubilarse y no se comparan.`);
  }, 600_000);

  test("con liquidez y una rentabilidad negativa, aquí se retira más y no sobra nada; en NUVIA sobra (JUB-6, a propósito)", () => {
    const r = azar(617);
    let comparadas = 0;
    let distintas = 0;
    const fuera: string[] = [];
    for (let i = 0; i < 1000; i++) {
      /* Sin previsión: una renta temporal más larga que el plan deja saldo al final en las dos copias, y no es esto. */
      const entrada: EntradaDeJubilacion = { ...entradaAlAzar(r), estrategia: "consumir", tieneEpsv: false, liquidez: 1000 + r.importe(250000, 0), rentabilidad: -Math.round(r.entre(1, 20)) / 10 };
      if (!MODELO_VASCO.has(entrada.territorio ?? "")) entrada.epsvAniosRenta = Math.max(15, entrada.epsvAniosRenta);
      const aqui = calcular(entrada, { escalasDelIrpf: "fijas" });
      if (!aqui.disponible) continue;
      const alli = nuvia.motor.calcular(entrada) as { base: { saldoFinal: number; filas: Array<{ retiradaAhorros: number }> } };
      comparadas++;
      const retiradaAqui = aqui.base.filas[0].retiradaAhorros;
      const retiradaAlli = alli.base.filas[0].retiradaAhorros;
      if (retiradaAqui > retiradaAlli + 0.01) distintas++;
      /* Aquí el plan base agota los ahorros justo al final; allí sobra lo que no se llegó a retirar. */
      if (retiradaAqui < retiradaAlli - 0.01 || aqui.base.saldoFinal > 1 || aqui.base.saldoFinal > alli.base.saldoFinal + 0.01) {
        fuera.push(`${i}: retirada ${retiradaAqui} frente a ${retiradaAlli}; sobra ${aqui.base.saldoFinal} frente a ${alli.base.saldoFinal}`);
      }
    }
    expect(fuera).toEqual([]);
    expect(comparadas).toBeGreaterThan(900);
    expect(distintas).toBeGreaterThan(900);
  }, 600_000);
});
