import { useEffect, useState } from "react";
import type { DatosDeMercadoObjetivo } from "../core/avisosDelMercadoObjetivo";
import { BASE_NUEVA_DISPONIBLE, leerDocumento, type Documento } from "./baseNuevaLectura";
import { nombreDelEmisor } from "./fichaDelEmisor";
import { horizonteDelInstrumento, respuesta, SUFIJO_MERCADO_OBJETIVO } from "./fichaDelMercadoObjetivo";

/**
 * El cableado de los avisos del mercado objetivo (decisión 59): trae, para cada posición de la cartera, los dos documentos
 * de la base nueva que la ficha ya lee —`declared/target_market` y `declared/regulatory`, del que sale el horizonte del KID—
 * y los deja en la forma que piden las reglas de `src/core/avisosDelMercadoObjetivo.ts`.
 *
 * **No cambia ningún contrato.** El constructor de carteras recibe sus activos por `asset-for-bdb`, que no trae el mercado
 * objetivo, pero no hace falta: se leen los documentos del instrumento por el mismo camino que la ficha y el comparador
 * (`baseNuevaLectura`: REST al emulador en desarrollo, el SDK con la sesión del asesor en producción, donde las reglas abren
 * `instruments/{id}/**` al asesor). El identificador de la posición es el del instrumento en la base nueva, como en el
 * comparador.
 *
 * Primero la tarjeta, que dice qué secciones declara el instrumento, y solo después lo declarado: pedir el mercado objetivo
 * a ciegas funcionaría —un 404 es «no lo tiene»— pero llenaría la consola de 404 que no son errores de nadie, y hoy lo
 * declaran 90 de 1.104. Son una lectura por posición y, como mucho, dos más.
 *
 * Desde la decisión B-66, `declared/regulatory` se lee también sin mercado objetivo: su horizonte del KID, que traen 629
 * instrumentos, basta para R1 y llega como «solo-horizonte».
 */

const SUFIJO_REGULATORIO = "declared/regulatory";

/** Lo que dicen los dos documentos, en la forma de las reglas. Puro: lo prueban sin base. */
export function mercadoObjetivoDeLosDocumentos(
  mercado: Documento | undefined,
  regulatorio: Documento | undefined
): DatosDeMercadoObjetivo {
  if (!mercado) {
    /* Decisión B-66: sin mercado objetivo, los años del KID bastan para R1. Con un documento vacío en su lugar, la
       precedencia de la ficha solo puede devolver los del KID. */
    const delKid = horizonteDelInstrumento({}, regulatorio);
    return delKid && "anos" in delKid && delKid.fuente === "KID"
      ? { estado: "solo-horizonte", horizonte: { anos: delKid.anos, fuente: "KID" } }
      : { estado: "sin-documento" };
  }
  const fecha = mercado["target_market_as_of"];
  const horizonte = horizonteDelInstrumento(mercado, regulatorio);
  const minorista = respuesta(mercado, "investor_type.retail");
  const conocimientoBasico = respuesta(mercado, "knowledge.basic");
  const sinPerdidas = respuesta(mercado, "loss_capacity.no_loss");
  return {
    estado: "documento",
    mercado: {
      emisor: nombreDelEmisor(mercado) || "El fabricante",
      ...(typeof fecha === "string" ? { fecha } : {}),
      ...(horizonte ? { horizonte } : {}),
      ...(minorista ? { minorista } : {}),
      ...(conocimientoBasico ? { conocimientoBasico } : {}),
      ...(sinPerdidas ? { sinPerdidas } : {})
    }
  };
}

type Lector = (ruta: string) => Promise<Documento | undefined>;

/**
 * El mercado objetivo de un instrumento. «sin-documento» si la base contesta y no lo tiene (o no tiene el instrumento:
 * un índice, una acción); «sin-leer» si no hay camino a la base o no contesta, que no es lo mismo y no se dice igual.
 */
export async function leerMercadoObjetivo(id: string, leer: Lector = leerDocumento, disponible = BASE_NUEVA_DISPONIBLE): Promise<DatosDeMercadoObjetivo> {
  if (!disponible) return { estado: "sin-leer" };
  /* Un identificador que no puede ser una ruta de la base no es de un instrumento suyo. */
  if (!id || id.includes("/")) return { estado: "sin-documento" };
  try {
    const tarjeta = await leer(`instruments/${id}/read/card`);
    const secciones = (tarjeta?.["available_sections"] as string[] | undefined) ?? [];
    const conMercado = secciones.includes("target_market");
    const conRegulatorio = secciones.includes("regulatory");
    if (!conMercado && !conRegulatorio) return { estado: "sin-documento" };
    const [mercado, regulatorio] = await Promise.all([
      conMercado ? leer(`instruments/${id}/${SUFIJO_MERCADO_OBJETIVO}`) : Promise.resolve(undefined),
      conRegulatorio ? leer(`instruments/${id}/${SUFIJO_REGULATORIO}`) : Promise.resolve(undefined)
    ]);
    return mercadoObjetivoDeLosDocumentos(mercado, regulatorio);
  } catch {
    return { estado: "sin-leer" };
  }
}

/**
 * Lo ya leído en esta sesión, por instrumento. Volver a «Comprobar» no repite las lecturas; un fallo no se guarda, para que
 * la siguiente vez se intente de nuevo.
 */
const leidos = new Map<string, DatosDeMercadoObjetivo>();

/** Solo para las pruebas. */
export function olvidarMercadosObjetivoLeidos(): void {
  leidos.clear();
}

/**
 * El mercado objetivo de cada posición, por su identificador. `null` mientras falte alguna por leer: los avisos se
 * calculan con todas o no se calculan, para no contar como «sin datos» lo que aún está llegando.
 */
export function useMercadoObjetivoDeLaCartera(ids: string[], activo = true): Map<string, DatosDeMercadoObjetivo> | null {
  const clave = [...new Set(ids)].sort().join(",");
  const [resultado, setResultado] = useState<{ clave: string; datos: Map<string, DatosDeMercadoObjetivo> } | null>(null);

  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    const unicos = clave ? clave.split(",") : [];
    void Promise.all(
      unicos.map(async (id) => {
        const conocido = leidos.get(id);
        if (conocido) return [id, conocido] as const;
        const datos = await leerMercadoObjetivo(id);
        if (datos.estado !== "sin-leer") leidos.set(id, datos);
        return [id, datos] as const;
      })
    ).then((pares) => {
      if (vivo) setResultado({ clave, datos: new Map(pares) });
    });
    return () => {
      vivo = false;
    };
  }, [clave, activo]);

  return resultado && resultado.clave === clave ? resultado.datos : null;
}
