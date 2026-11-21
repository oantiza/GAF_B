/**
 * Los planes de pensiones y las EPSV, leídos de la base nueva (`pension_plans`, decisión D-11).
 *
 * Son dos lecturas y ninguna escribe: la lista entera —220 fichas cortas— y, cuando se abre una ficha, su serie
 * mensual, que va en un documento aparte para que la lista no la arrastre.
 *
 * **Por qué de la base y no de un fichero del sitio.** Los datos son de Morningstar y no se pueden redistribuir.
 * Un fichero dentro del sitio se descarga sin entrar; la base está detrás de la sesión.
 */
import { planDeDocumento, serieDeDocumento, type PlanDePensiones, type SerieDelPlan } from "../core/planes/modelo";
import { createSessionSlot } from "../core/sessionCaches";
import { leerDocumento, listarColeccion } from "./baseNuevaLectura";

const COLECCION = "pension_plans";

/** Lo leído vale para la sesión: ir de la lista a una ficha y volver no vuelve a pedir los 220. Al salir, se olvida. */
const planesEnSesion = createSessionSlot<Promise<PlanDePensiones[]> | null>(() => null);
const seriesEnSesion = createSessionSlot<Map<string, Promise<SerieDelPlan | undefined>> | null>(() => null);

async function leerPlanes(): Promise<PlanDePensiones[]> {
  const documentos = await listarColeccion(COLECCION);
  return documentos
    .flatMap(({ id, documento }) => {
      /* Un documento que no dice su nombre o si es plan o EPSV no se enseña. El contrato de la base lo impide. */
      const plan = planDeDocumento(id, documento);
      return plan ? [plan] : [];
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/** Todos los planes y EPSV, por nombre. */
export function listarPlanes(): Promise<PlanDePensiones[]> {
  const guardada = planesEnSesion.read();
  if (guardada) return guardada;
  const lectura = leerPlanes();
  planesEnSesion.write(lectura);
  /* Una lectura que falla no se queda guardada: el reintento tiene que volver a pedirla. */
  lectura.catch(() => planesEnSesion.reset());
  return lectura;
}

/** La serie mensual de un plan, o `undefined` si el proveedor no dio serie. */
export function leerSerieDelPlan(id: string): Promise<SerieDelPlan | undefined> {
  let guardadas = seriesEnSesion.read();
  if (!guardadas) {
    guardadas = new Map();
    seriesEnSesion.write(guardadas);
  }
  const guardada = guardadas.get(id);
  if (guardada) return guardada;
  const series = guardadas;
  const lectura = leerDocumento(`${COLECCION}/${id}/series/monthly`).then((documento) => (documento ? serieDeDocumento(documento) : undefined));
  series.set(id, lectura);
  lectura.catch(() => series.delete(id));
  return lectura;
}
