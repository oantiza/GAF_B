/**
 * Quién firma un informe de la plantilla: la identidad del asesor (`leerIdentidad()`, la que se escribe una vez en
 * «Tus datos en los informes») y, encima, el nombre y el contacto que haya escrito quien lo descarga (`banker`), cuando
 * llegan escritos. Lo que no está no se inventa: sin nada, la cabecera queda sin membrete.
 *
 * Lo usan la comparativa de propuestas, el informe de costes, la propuesta de cambio y la simulación de jubilación, que
 * reciben `banker` desde sus diálogos y no cambian cómo los llaman.
 */
import { leerIdentidad } from "../core/identidadDelAsesor";
import type { IdentidadDelAsesor } from "./plantilla";

export function firmaDelInforme(banker?: { name?: string | null; email?: string | null } | null): IdentidadDelAsesor {
  const base = leerIdentidad();
  const nombre = banker?.name?.trim();
  const contacto = banker?.email?.trim();
  return { ...base, ...(nombre ? { nombre } : {}), ...(contacto ? { contacto } : {}) };
}
