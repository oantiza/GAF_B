/// <reference types="vite/client" />

/**
 * Lectura de la BASE NUEVA (`bdb-gestor-de-activos`), solo para la ficha rediseñada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO ES UNA SEGUNDA APP DE FIREBASE, QUE ERA LO OBVIO
 *
 * El id de la base nueva es el de un proyecto REAL que Óscar creó en la nube, usado
 * tal cual en el emulador para que el ensayo local sea idéntico al destino. Hasta
 * ahora media barrera de este clon era que el nombre fuese falso: `gestor-activos-local`
 * no existe, así que una credencial de más no podía hacer daño. Con un proyecto real
 * eso desaparece, y lo único que separa este código de una lectura en la nube es que
 * la conexión vaya al emulador.
 *
 * Un `initializeApp` con ese id horneado en el paquete sería exactamente la puerta que
 * no queremos: bastaría una build con la variable mal puesta. Así que esto habla REST
 * con el emulador y nada más. La URL es la del emulador, el token `owner` solo existe
 * en el emulador, y fuera de `import.meta.env.DEV` la función ni se arma. No hay forma
 * de que este fichero lea la nube: no sabe hacerlo.
 *
 * Y es de SOLO LECTURA. La base nueva la escribe `2-plataforma-datos` con el Admin SDK
 * y nadie más.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** El proyecto de la base nueva. Solo se usa para formar la URL del emulador. */
import { firebaseConfig, USE_EMULATORS } from "../firebaseEnv";

const PROYECTO = "bdb-gestor-de-activos";

/** El emulador de la base nueva (hub 4402, Firestore 8092). */
const EMULADOR =
  import.meta.env.VITE_BASE_NUEVA_EMULATOR_HOST || "127.0.0.1:8092";

/**
 * Si la aplicación está configurada contra el proyecto de la base nueva. En producción es
 * la única forma de leerla: el SDK habla con ese proyecto y la sesión del asesor es la que
 * las reglas comprueban.
 */
const EN_SU_PROYECTO = firebaseConfig.projectId === PROYECTO;

/**
 * Qué camino se usa.
 *
 * El SDK, siempre que la aplicación esté configurada contra este proyecto: en producción, y
 * desde el 21-11-2026 también en desarrollo, donde el SDK habla con el emulador de la base
 * nueva (8092) con la sesión del usuario local y las mismas reglas que la nube. Así lo que se
 * prueba en local es el camino de producción.
 *
 * REST con `Bearer owner` queda solo para un desarrollo configurado contra otro proyecto (la
 * base vieja, `gestor-activos-local`), donde el SDK apunta a un emulador que es otra base.
 *
 * Equivocarse es imposible por construcción: el camino REST no se arma fuera de
 * `import.meta.env.DEV`, y en desarrollo el SDK solo se usa si está conectado a los
 * emuladores, así que una copia local nunca lee la nube por accidente.
 */
const USAR_SDK = EN_SU_PROYECTO && (!import.meta.env.DEV || USE_EMULATORS);

/**
 * La aplicación lee la base nueva como en la nube: la web publicada, y desde el 21-11-2026 el
 * desarrollo local contra su emulador. Sistema lo usaba para ocultar las pestañas de la base vieja, que se
 * borraron el 21-11-2026; hoy lo leen las pruebas del camino (`tests/baseNuevaCaminoDeProduccion.test.ts`), que
 * fijan con él cuándo se usa el SDK y cuándo REST.
 */
export const LEE_LA_NUBE = USAR_SDK;

/**
 * Si hay camino a la base nueva. En desarrollo lo hay siempre —contra el emulador—; en
 * producción, solo si la aplicación está configurada contra `bdb-gestor-de-activos`. Si no,
 * la pantalla lo dice en vez de fallar.
 */
export const BASE_NUEVA_DISPONIBLE = import.meta.env.DEV || EN_SU_PROYECTO;

const RAIZ = `http://${EMULADOR}/v1/projects/${PROYECTO}/databases/(default)/documents`;

/**
 * `Bearer owner` salta las reglas del emulador, que en este proyecto están cerradas
 * del todo a propósito: «cuando exista el frontend nuevo, cada colección que lea
 * abrirá su regla aquí, nombrada, y no antes». Ese día no ha llegado —esto es una
 * vista previa contra un emulador—, así que las reglas se quedan como están y la
 * lectura usa la credencial que solo el emulador acepta.
 */
const CABECERAS = { Authorization: "Bearer owner" };

/** Un valor de Firestore en su envoltorio REST. */
type ValorRest = Record<string, unknown>;

/** Deshace el envoltorio: `{stringValue: "x"}` → `"x"`, y recursivo. */
function desenvolver(valor: ValorRest | undefined): unknown {
  if (!valor) return undefined;
  if ("stringValue" in valor) return valor.stringValue;
  if ("integerValue" in valor) return Number(valor.integerValue);
  if ("doubleValue" in valor) return valor.doubleValue;
  if ("booleanValue" in valor) return valor.booleanValue;
  if ("timestampValue" in valor) return valor.timestampValue;
  if ("nullValue" in valor) return null;
  if ("mapValue" in valor) {
    const campos = (valor.mapValue as { fields?: Record<string, ValorRest> }).fields ?? {};
    return Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, desenvolver(v)]));
  }
  if ("arrayValue" in valor) {
    const valores = (valor.arrayValue as { values?: ValorRest[] }).values ?? [];
    return valores.map((v) => desenvolver(v));
  }
  return undefined;
}

export type Documento = Record<string, unknown>;

/**
 * Lee un documento. Devuelve `undefined` si no existe —que es información, no un
 * error: un instrumento sin `declared/dividends` es un instrumento al que no le
 * conocemos los dividendos— y lanza si el emulador no responde.
 */
export async function leerDocumento(ruta: string): Promise<Documento | undefined> {
  if (USAR_SDK) return (await import("./baseNuevaLecturaSdk")).leerDocumento(ruta);
  const respuesta = await fetch(`${RAIZ}/${ruta}`, { headers: CABECERAS });
  if (respuesta.status === 404) return undefined;
  if (!respuesta.ok) {
    throw new Error(
      `La base nueva respondió ${respuesta.status} a ${ruta}. ` +
        `¿Está levantado su emulador en ${EMULADOR}? Se arranca con 'node 4-base-nueva/arrancar.mjs'.`
    );
  }
  const cuerpo = (await respuesta.json()) as { fields?: Record<string, ValorRest> };
  return desenvolver({ mapValue: { fields: cuerpo.fields ?? {} } }) as Documento;
}

/**
 * El `last_date` del documento de un año de la serie de precios de un instrumento (decisión B-78), o `undefined` si ese año no existe. Los
 * documentos se llaman como su año (`price_series/2025`). Se lee por id: una consulta ordenada por nombre al revés la rechaza el emulador
 * («Firestore does not support descending key scans», 400), y no se supone que la nube la acepte. Solo viaja `last_date`, no los puntos.
 */
export async function leerAnioDeLaSerie(isin: string, anio: number): Promise<Documento | undefined> {
  if (USAR_SDK) return (await import("./baseNuevaLecturaSdk")).leerAnioDeLaSerie(isin, anio);
  const respuesta = await fetch(`${RAIZ}/instruments/${isin}/price_series/${anio}?mask.fieldPaths=last_date`, { headers: CABECERAS });
  if (respuesta.status === 404) return undefined;
  if (!respuesta.ok) throw new Error(`La base nueva respondió ${respuesta.status} al leer la serie de ${isin} de ${anio}.`);
  const cuerpo = (await respuesta.json()) as { fields?: Record<string, ValorRest> };
  return desenvolver({ mapValue: { fields: cuerpo.fields ?? {} } }) as Documento;
}

/**
 * Los documentos de una colección, en el orden de su id, o ninguno si no existe. Sirve para colecciones cortas y troceadas, como los trozos
 * de una cartera; para el catálogo está `listarTarjetas`. El emulador pagina con `nextPageToken`.
 */
export async function listarColeccion(ruta: string): Promise<Array<{ id: string; documento: Documento }>> {
  if (USAR_SDK) return (await import("./baseNuevaLecturaSdk")).listarColeccion(ruta);
  const salida: Array<{ id: string; documento: Documento }> = [];
  let pagina: string | undefined;
  do {
    /* Sin `orderBy`: el orden se pone al final, y así no depende de lo que acepte el emulador. */
    const consulta = new URLSearchParams({ pageSize: "100" });
    if (pagina) consulta.set("pageToken", pagina);
    const respuesta = await fetch(`${RAIZ}/${ruta}?${consulta.toString()}`, { headers: CABECERAS });
    if (respuesta.status === 404) return salida;
    if (!respuesta.ok) throw new Error(`La base nueva respondió ${respuesta.status} al listar ${ruta}.`);
    const cuerpo = (await respuesta.json()) as { documents?: Array<{ name?: string; fields?: Record<string, ValorRest> }>; nextPageToken?: string };
    for (const documento of cuerpo.documents ?? []) {
      salida.push({
        id: documento.name?.split("/").at(-1) ?? "",
        documento: desenvolver({ mapValue: { fields: documento.fields ?? {} } }) as Documento
      });
    }
    pagina = cuerpo.nextPageToken || undefined;
  } while (pagina);
  return salida.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * La base ha contestado, y ese instrumento no está. No es un fallo de lectura y no se dice igual: uno
 * se arregla reintentando, y este no. Sin distinguirlos, un enlace mal copiado y una caída de la red
 * acababan en la misma pantalla.
 */
export class InstrumentoDesconocido extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "InstrumentoDesconocido";
  }
}

/** Todo lo que la ficha necesita de un instrumento, leído de una vez. */
export interface InstrumentoDeLaBase {
  isin: string;
  raiz: Documento;
  tarjeta: Documento;
  calidad: Documento | undefined;
  /** Clave = sufijo (`declared/costs`, `computed/metrics`…). */
  bloques: Record<string, Documento | undefined>;
}

/**
 * Los bloques que la ficha lee además de la tarjeta.
 *
 * La tarjeta NO basta, y conviene no descubrirlo tarde: su contrato dice que está
 * pensada para la fila de una lista. De las doce secciones que declara un fondo
 * proyecta costes, exposición, cartera, precio, patrimonio y sostenibilidad, y de
 * perfil y regulación solo la política de reparto y el indicador de 1 a 7. Las otras
 * se leen aquí, «porque solo se miran con la ficha delante».
 */
const SUFIJO_DE_LA_SECCION: Record<string, string> = {
  profile: "declared/profile",
  costs: "declared/costs",
  regulatory: "declared/regulatory",
  exposure: "declared/exposure",
  provider_risk: "declared/provider_risk",
  provider_returns: "declared/provider_returns",
  distributions: "declared/distributions",
  provenance: "declared/provenance",
  size: "declared/size",
  sustainability: "declared/sustainability",
  holdings: "declared/holdings",
  quote: "declared/quote",
  equity: "declared/equity",
  dividends: "declared/dividends",
  /* Lo que publica el emisor de un ETF y su prima o descuento (decisiones 51 y 52): solo 15 instrumentos los declaran. */
  issuer_data: "declared/issuer_data",
  premium_discount: "computed/premium_discount",
  /* Para quién lo piensa el fabricante, de su EMT (decisión 58): hoy lo traen 23 de los 32 ETF, y la tarjeta solo lo anuncia si existe. */
  target_market: "declared/target_market",
  metrics: "computed/metrics"
};

/**
 * Lee un instrumento entero. Son dieciocho peticiones en paralelo contra el emulador,
 * y eso es aceptable porque es UNA ficha: lo que no se puede hacer así es una lista.
 * Por eso existe la tarjeta, y por eso esta función no se usa en el buscador.
 */
export async function leerInstrumento(isin: string): Promise<InstrumentoDeLaBase> {
  const [raiz, tarjeta, calidad] = await Promise.all([
    leerDocumento(`instruments/${isin}`),
    leerDocumento(`instruments/${isin}/read/card`),
    leerDocumento(`instruments/${isin}/quality/latest`)
  ]);

  if (!raiz) throw new InstrumentoDesconocido(`La base nueva no tiene el instrumento ${isin}.`);
  if (!tarjeta) {
    throw new InstrumentoDesconocido(
      `${isin} está en la base pero no tiene tarjeta de lectura. La compone la segunda ` +
        `pasada de la plataforma: 'npm run baseNueva:batch -- --write'.`
    );
  }

  /*
   * Y ahora solo lo que el instrumento DECLARA. Para eso existe `available_sections`:
   * pedir los quince bloques a ciegas funcionaba, porque un 404 es «no lo tiene», pero
   * dejaba la consola del navegador llena de 404 que no son errores de nadie. Un fondo
   * declara doce secciones y una accion cuatro: son doce y cuatro peticiones.
   */
  const declaradas = (tarjeta["available_sections"] as string[] | undefined) ?? [];
  const sufijos = declaradas
    .map((seccion) => SUFIJO_DE_LA_SECCION[seccion])
    .filter((sufijo): sufijo is string => sufijo !== undefined);
  const documentos = await Promise.all(
    sufijos.map((sufijo) => leerDocumento(`instruments/${isin}/${sufijo}`))
  );

  return {
    isin,
    raiz,
    tarjeta,
    calidad,
    bloques: Object.fromEntries(sufijos.map((sufijo, i) => [sufijo, documentos[i]]))
  };
}

/**
 * Las 1.077 calidades, de una consulta.
 *
 * Es la lectura más pesada de la aplicación y solo la hace la pantalla de salud del
 * catálogo: cada documento trae su lista de ausencias, y son 92.470 en total.
 */
export async function listarCalidades(): Promise<Documento[]> {
  if (USAR_SDK) return (await import("./baseNuevaLecturaSdk")).listarCalidades();
  const respuesta = await fetch(`${RAIZ}:runQuery`, {
    method: "POST",
    headers: { ...CABECERAS, "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: { from: [{ collectionId: "quality", allDescendants: true }], limit: 5000 }
    })
  });
  if (!respuesta.ok) {
    throw new Error(
      `La base nueva respondió ${respuesta.status} al leer la calidad. ` +
        `¿Está levantado su emulador en ${EMULADOR}?`
    );
  }
  const cuerpo = (await respuesta.json()) as Array<{ document?: { fields?: Record<string, ValorRest> } }>;
  return cuerpo
    .filter((tramo) => tramo.document !== undefined)
    .map((tramo) => desenvolver({ mapValue: { fields: tramo.document?.fields ?? {} } }) as Documento);
}

/** Los campos de la tarjeta que una LISTA necesita. El resto no se trae. */
const CAMPOS_DE_LA_LISTA = [
  "computed_at",
  "instrument_id",
  "instrument_type",
  "identity",
  "classification",
  "quote",
  "costs",
  "size",
  "sustainability",
  "metrics",
  "quality",
  /* La exposición entró el 02-11 con la radiografía de cartera: sin ella la pantalla
     decía «explica el 0 %» de una cartera que sí tiene reparto, que es peor que no
     decir nada. La máscara ahorra bytes, pero lo que no se pide no existe. */
  "exposure",
  /* Si dejó de cotizar: el Buscador marca la fila con esto, sin leer la raíz de cada instrumento. */
  "availability"
];

/**
 * Todas las tarjetas, de una sola consulta.
 *
 * Esto es para lo que existe la tarjeta de lectura, y aquí se ve: una consulta de grupo
 * de colección sobre `read` devuelve las 1.076 en **311 ms y 4 MB**, medido el
 * 02-11-2026 contra el emulador. Leer los documentos de cada instrumento, como hace la
 * ficha, serían dieciocho mil peticiones.
 *
 * Los 4 MB son mucho para una carga y conviene no olvidarlo: contra un emulador local
 * da igual, contra una base de verdad habría que paginar o mover el filtro al servidor.
 */
export async function listarTarjetas(): Promise<Documento[]> {
  if (USAR_SDK) return (await import("./baseNuevaLecturaSdk")).listarTarjetas();
  const consulta = {
    structuredQuery: {
      from: [{ collectionId: "read", allDescendants: true }],
      select: { fields: CAMPOS_DE_LA_LISTA.map((fieldPath) => ({ fieldPath })) },
      limit: 5000
    }
  };
  const respuesta = await fetch(`${RAIZ}:runQuery`, {
    method: "POST",
    headers: { ...CABECERAS, "Content-Type": "application/json" },
    body: JSON.stringify(consulta)
  });
  if (!respuesta.ok) {
    throw new Error(
      `La base nueva respondió ${respuesta.status} al listar las tarjetas. ` +
        `¿Está levantado su emulador en ${EMULADOR}? Se arranca con 'node 4-base-nueva/arrancar.mjs'.`
    );
  }
  const cuerpo = (await respuesta.json()) as Array<{ document?: { fields?: Record<string, ValorRest> } }>;
  return cuerpo
    .filter((tramo) => tramo.document !== undefined)
    .map((tramo) => desenvolver({ mapValue: { fields: tramo.document?.fields ?? {} } }) as Documento);
}
