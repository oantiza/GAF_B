import { aQuienNoLoPiensa, caducado, type HorizonteDelInstrumento } from "../core/avisosDelMercadoObjetivo";
import * as formato from "../core/formato";
import type { FilaDeFicha, SeccionDeFicha, Trozo } from "../types/fichaInstrumento";
import type { Documento, InstrumentoDeLaBase } from "./baseNuevaLectura";
import { nombreDelEmisor } from "./fichaDelEmisor";

/**
 * «Para quién está pensado (según el fabricante)»: el mercado objetivo que declara el fabricante, del documento
 * `declared/target_market` (decisión 58 de Óscar, 09-11-2026). Es puro: entra el instrumento y el día de hoy, sale la sección o nada.
 *
 * Lo que enseña, y por qué así (medición en `INFORME_EMT_EET_2026-11-09.md`, §3 y §4):
 *
 * - **El horizonte mínimo recomendado**, que es lo que el documento aporta de verdad en un ETF sencillo. Manda el del KID si la
 *   base lo tiene (`declared/regulatory.recommended_holding_years`); si no, el del fabricante; si están los dos y no coinciden, se
 *   dice. Los códigos V/S/M/L/H se escriben con la definición de FinDatEx que trae el contrato, sin inventarles años.
 * - **Tipo de cliente y conocimiento en una línea**, y un aviso destacado solo si el fabricante dice NO a minoristas o al
 *   conocimiento básico: es el mercado objetivo negativo, el único que en este catálogo puede saltar.
 * - **Capacidad de pérdidas y canal**, en una línea discreta al pie: en los 23 medidos dicen lo mismo y no distinguen.
 * - `NEUTRAL` se escribe «el fabricante no se pronuncia», porque no es un sí. Lo que el documento no trae se omite.
 *
 * Lo que no enseña: los objetivos (`objectives`), que responden a la costumbre del emisor más que al producto; las preferencias de
 * sostenibilidad, que esperan al EET (aplazado); y el `03050`, que el contrato ni siquiera guarda. Tampoco la huella, la URL ni la
 * versión de la plantilla: son la trazabilidad, no lo que lee el asesor.
 *
 * Son datos del emisor, de uso interno (decisión 53): esta sección es de pantalla y no la importa ningún informe.
 */

export const SUFIJO_MERCADO_OBJETIVO = "declared/target_market";

type Respuesta = "YES" | "NO" | "NEUTRAL";

/* La regla de la fecha vive con los avisos de la cartera, que la usan igual; se reexporta para quien ya la leía de aquí. */
export { caducado };

function valorEn(documento: Documento | undefined, ruta: string): unknown {
  return ruta
    .split(".")
    .reduce<unknown>(
      (actual, tramo) => (actual && typeof actual === "object" ? (actual as Record<string, unknown>)[tramo] : undefined),
      documento
    );
}

export function respuesta(documento: Documento | undefined, ruta: string): Respuesta | undefined {
  const valor = valorEn(documento, ruta);
  return valor === "YES" || valor === "NO" || valor === "NEUTRAL" ? valor : undefined;
}

/** «a», «a y b», «a, b y c». */
function enLista(partes: string[]): string {
  return partes.length <= 1 ? (partes[0] ?? "") : `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

const conMayuscula = (texto: string) => (texto ? texto[0].toUpperCase() + texto.slice(1) : texto);

/* --- el horizonte -------------------------------------------------------------------------------------------------------- */

/**
 * Los cinco códigos del campo `05080` del EMT, con la definición de FinDatEx que recoge el contrato: muy corto, corto, medio y largo
 * plazo, y hasta el vencimiento. No se les ponen años: el fabricante eligió no darlos.
 */
const PLAZO_DEL_CODIGO: Record<string, string> = {
  V: "Muy corto plazo",
  S: "Corto plazo",
  M: "Medio plazo",
  L: "Largo plazo",
  H: "Hasta el vencimiento"
};

/** «5 años», «1 año», «0,92 años». Sin ceros de relleno: 5 años no son «5,00». */
export function enAnos(anos: number): string {
  if (anos === 1) return "1 año";
  const decimales = Number.isInteger(anos) ? 0 : Number.isInteger(anos * 10) ? 1 : 2;
  return `${formato.oFalta(formato.numero(anos, { decimales }))} años`;
}

/** El plazo del fabricante, en años o en su código, o nada. */
function plazoDelFabricante(mercado: Documento): { texto: string; anos?: number } | undefined {
  const anos = valorEn(mercado, "min_holding_period.years");
  if (typeof anos === "number" && Number.isFinite(anos)) return { texto: enAnos(anos), anos };
  const codigo = valorEn(mercado, "min_holding_period.code");
  return typeof codigo === "string" && PLAZO_DEL_CODIGO[codigo] ? { texto: PLAZO_DEL_CODIGO[codigo] } : undefined;
}

/** «KID de 21/08/2026», o «KID, sin fecha» si la base no la guarda: no se le pone otra. */
function elKid(regulatorio: Documento | undefined): string {
  const fecha = valorEn(regulatorio, "kid_evidence.document_date");
  const escrita = fecha ? formato.fecha(String(fecha)) : null;
  return escrita ? `KID de ${escrita}` : "KID, sin fecha";
}

/** Los años del KID (`declared/regulatory.recommended_holding_years`), si la base los tiene. */
function anosDelKid(regulatorio: Documento | undefined): number | undefined {
  const anos = valorEn(regulatorio, "recommended_holding_years");
  return typeof anos === "number" && Number.isFinite(anos) ? anos : undefined;
}

/**
 * El horizonte del instrumento con la misma precedencia que enseña la ficha: el del KID manda; si no lo hay, el del
 * fabricante en su mercado objetivo, en años o en su código (que no se convierte en años). Lo usan los avisos de la cartera.
 */
export function horizonteDelInstrumento(mercado: Documento, regulatorio: Documento | undefined): HorizonteDelInstrumento | undefined {
  const delKid = anosDelKid(regulatorio);
  if (delKid !== undefined) return { anos: delKid, fuente: "KID" };
  const anos = valorEn(mercado, "min_holding_period.years");
  if (typeof anos === "number" && Number.isFinite(anos)) return { anos, fuente: "fabricante" };
  const codigo = valorEn(mercado, "min_holding_period.code");
  return typeof codigo === "string" && PLAZO_DEL_CODIGO[codigo] ? { codigo, fuente: "fabricante" } : undefined;
}

function filaDelHorizonte(mercado: Documento, regulatorio: Documento | undefined, emisor: string): FilaDeFicha | undefined {
  const delFabricante = plazoDelFabricante(mercado);
  const delKid = anosDelKid(regulatorio);
  const rotulo = "Horizonte mínimo recomendado";

  if (delKid !== undefined) {
    const kid = elKid(regulatorio);
    let glosa = `Del ${kid}.`;
    if (delFabricante?.anos !== undefined) {
      glosa =
        Math.abs(delFabricante.anos - delKid) < 0.005
          ? `Del ${kid}; ${emisor} dice lo mismo en su mercado objetivo.`
          : `Del ${kid}, que manda. ${emisor}, en su mercado objetivo, recomienda ${delFabricante.texto}.`;
    } else if (delFabricante) {
      /* Un código frente a unos años no se puede comparar: se dicen los dos. */
      glosa = `Del ${kid}, que manda. ${emisor}, en su mercado objetivo, lo da sin años: ${delFabricante.texto.toLowerCase()}.`;
    }
    return { rotulo, valor: enAnos(delKid), destacada: true, glosa };
  }

  if (!delFabricante) return undefined;
  return {
    rotulo,
    valor: delFabricante.texto,
    destacada: true,
    glosa:
      delFabricante.anos !== undefined
        ? `Según ${emisor}, en su mercado objetivo.`
        : `Según ${emisor}, en su mercado objetivo, que lo da como plazo y no en años.`
  };
}

/* --- tipo de cliente y conocimiento -------------------------------------------------------------------------------------- */

const CLIENTES: Array<{ campo: string; uno: string; varios: string }> = [
  { campo: "retail", uno: "minorista", varios: "minoristas" },
  { campo: "professional", uno: "profesional", varios: "profesionales" },
  { campo: "eligible_counterparty", uno: "contraparte elegible", varios: "contrapartes elegibles" }
];

/** «Minorista y profesional», «Profesional, no para minoristas», con lo que no se pronuncia entre paréntesis. */
function fraseDelCliente(mercado: Documento): string | undefined {
  const con = (valor: Respuesta) => CLIENTES.filter((cliente) => respuesta(mercado, `investor_type.${cliente.campo}`) === valor);
  const si = con("YES");
  const no = con("NO");
  const neutro = con("NEUTRAL");
  if (si.length + no.length + neutro.length === 0) return undefined;

  const sobre = neutro.length > 0 ? `sobre ${enLista(neutro.map((c) => c.varios))}, el fabricante no se pronuncia` : undefined;
  const partes = [
    si.length > 0 ? enLista(si.map((c) => c.uno)) : undefined,
    no.length > 0 ? `no para ${enLista(no.map((c) => c.varios))}` : undefined
  ].filter((parte): parte is string => parte !== undefined);
  if (partes.length === 0) return sobre;
  return sobre ? `${partes.join(", ")} (${sobre})` : partes.join(", ");
}

/**
 * Los tres niveles de la sección 2 del EMT, del más bajo al más alto, con lo que significa que el fabricante diga que sí al más bajo
 * de ellos. Básico es el de quien invierte por primera vez.
 */
const NIVELES: Array<{ campo: string; si: string; nombre: string }> = [
  { campo: "basic", si: "sin experiencia previa", nombre: "el inversor básico" },
  { campo: "informed", si: "con conocimiento medio o alguna experiencia", nombre: "el inversor informado" },
  { campo: "advanced", si: "con conocimiento avanzado o experiencia en el sector", nombre: "el inversor avanzado" }
];

function fraseDelConocimiento(mercado: Documento): string | undefined {
  const respuestas = NIVELES.map((nivel) => ({ ...nivel, valor: respuesta(mercado, `knowledge.${nivel.campo}`) }));
  if (respuestas.every((nivel) => nivel.valor === undefined)) return undefined;
  const primero = respuestas.findIndex((nivel) => nivel.valor === "YES");
  if (primero < 0) {
    return respuestas.some((nivel) => nivel.valor === "NEUTRAL")
      ? "sobre el conocimiento necesario, el fabricante no se pronuncia"
      : "no lo piensa para ningún nivel de conocimiento";
  }
  /* Por debajo del primer sí, un NO se da por dicho (y el del básico lleva su aviso); un NEUTRAL se dice. */
  const callados = respuestas.slice(0, primero).filter((nivel) => nivel.valor === "NEUTRAL");
  const frase = respuestas[primero].si;
  return callados.length > 0
    ? `${frase} (sobre ${enLista(callados.map((nivel) => nivel.nombre))}, el fabricante no se pronuncia)`
    : frase;
}

function filaDelCliente(mercado: Documento): FilaDeFicha | undefined {
  const partes = [fraseDelCliente(mercado), fraseDelConocimiento(mercado)].filter((parte): parte is string => parte !== undefined);
  if (partes.length === 0) return undefined;
  return { rotulo: "Tipo de cliente y conocimiento", valor: conMayuscula(partes.join("; ")), larga: true };
}

/** El mercado objetivo negativo: el fabricante dice NO al minorista o al conocimiento básico. Es lo único que lleva aviso. */
function avisoNegativo(mercado: Documento, emisor: string): Trozo[] | undefined {
  const aQuien = aQuienNoLoPiensa(respuesta(mercado, "investor_type.retail"), respuesta(mercado, "knowledge.basic"));
  if (aQuien.length === 0) return undefined;
  return [
    { texto: `${emisor} no lo piensa para ${aQuien.join(" ni para ")}.`, fuerte: true },
    { texto: " Es su mercado objetivo negativo, no un hueco del dato." }
  ];
}

/* --- capacidad de pérdidas y canal, la línea discreta -------------------------------------------------------------------- */

const PERDIDAS: Array<{ campo: string; frases: Record<Respuesta, string> }> = [
  {
    campo: "no_guarantee",
    frases: {
      YES: "capital en riesgo, sin garantía",
      NO: "no lo piensa para quien no necesita garantía de capital",
      NEUTRAL: "sobre la garantía de capital, el fabricante no se pronuncia"
    }
  },
  {
    campo: "no_loss",
    frases: {
      YES: "apto para quien no puede asumir pérdidas",
      NO: "no es para quien no puede asumir pérdidas",
      NEUTRAL: "sobre quien no puede asumir pérdidas, el fabricante no se pronuncia"
    }
  }
];

function fraseDePerdidas(mercado: Documento): string | undefined {
  const partes = PERDIDAS.map(({ campo, frases }) => {
    const valor = respuesta(mercado, `loss_capacity.${campo}`);
    return valor ? frases[valor] : undefined;
  }).filter((parte): parte is string => parte !== undefined);
  return partes.length > 0 ? `Capacidad de pérdidas: ${partes.join("; ")}.` : undefined;
}

const CANALES: Array<{ campo: string; nombre: string }> = [
  { campo: "execution_only", nombre: "solo ejecución" },
  { campo: "appropriateness", nombre: "con test de conveniencia" },
  { campo: "advice", nombre: "asesoramiento" },
  { campo: "portfolio_management", nombre: "gestión de carteras" }
];

/** R, P, B y N del EMT: a quién se distribuye por ese canal. */
const DESTINATARIO: Record<string, string> = {
  B: "a minoristas y profesionales",
  R: "solo a minoristas",
  P: "solo a profesionales",
  N: "a ninguno"
};

function fraseDelCanal(mercado: Documento): string | undefined {
  const declarados = CANALES.map((canal) => ({ ...canal, valor: valorEn(mercado, `distribution.${canal.campo}`) })).filter(
    (canal): canal is { campo: string; nombre: string; valor: string } => typeof canal.valor === "string" && DESTINATARIO[canal.valor] !== undefined
  );
  if (declarados.length === 0) return undefined;
  const valores = ["B", "R", "P", "N"].filter((valor) => declarados.some((canal) => canal.valor === valor));
  if (valores.length === 1 && declarados.length === CANALES.length) {
    return valores[0] === "N" ? "Canal: ninguno." : `Canal: cualquiera, ${DESTINATARIO[valores[0]]}.`;
  }
  const grupos = valores.map(
    (valor) => `${enLista(declarados.filter((canal) => canal.valor === valor).map((canal) => canal.nombre))}, ${DESTINATARIO[valor]}`
  );
  return `Canal: ${grupos.join("; ")}.`;
}

/* --- la sección --------------------------------------------------------------------------------------------------------- */

/**
 * La sección, o `undefined` si el instrumento no tiene documento de mercado objetivo —que es lo normal: hoy lo traen 23 de los 32
 * ETF y nada más—. No hay estado vacío: lo que no se declara no se pinta.
 */
export function seccionDelMercadoObjetivo(instrumento: InstrumentoDeLaBase, hoy: Date = new Date()): SeccionDeFicha | undefined {
  const mercado = instrumento.bloques[SUFIJO_MERCADO_OBJETIVO];
  if (!mercado) return undefined;
  const emisor = nombreDelEmisor(mercado) || "El fabricante";
  const fecha = valorEn(mercado, "target_market_as_of");

  const filas = [filaDelHorizonte(mercado, instrumento.bloques["declared/regulatory"], emisor), filaDelCliente(mercado)].filter(
    (fila): fila is FilaDeFicha => fila !== undefined
  );
  const discreta = [fraseDePerdidas(mercado), fraseDelCanal(mercado)].filter((parte): parte is string => parte !== undefined);
  const aviso = avisoNegativo(mercado, emisor);
  /* Un documento que solo trae su fecha no dice para quién es: no se pinta una cabecera sin nada debajo. */
  if (filas.length === 0 && discreta.length === 0 && !aviso) return undefined;

  const viejo = caducado(fecha, hoy)
    ? `Este mercado objetivo tiene más de 12 meses: ${emisor} puede haberlo revisado después.`
    : undefined;
  const nota = [viejo, ...discreta].filter((parte): parte is string => parte !== undefined).join(" ");

  const procedencia: Trozo[] = [{ texto: `Declarado por ${emisor}`, fuerte: true }];
  const fechaEscrita = fecha ? formato.fecha(String(fecha)) : null;
  if (fechaEscrita) procedencia.push({ texto: ` · ${fechaEscrita}` });

  return {
    id: "mercado-objetivo",
    titulo: "Para quién está pensado (según el fabricante)",
    procedencia,
    filas,
    ...(aviso ? { aviso } : {}),
    ...(nota ? { nota } : {})
  };
}
