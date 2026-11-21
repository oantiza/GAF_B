import type { MacroReference } from "../adapters/macroReferenceBackend";

const unirAnios = (anios: readonly number[]): string =>
  anios.length <= 1 ? anios.join("") : `${anios.slice(0, -1).join(", ")} y ${anios[anios.length - 1]}`;

/**
 * Lo que la referencia macro dice de sí misma, en frases para el asesor: qué fuentes respondieron, qué es dato de una
 * tabla y qué es supuesto, qué periodo cubre de verdad la media de Letras y de qué territorio y ejercicio es la escala
 * fiscal (hallazgo 27, 15-11-2026). Un servidor sin actualizar no manda nada de esto y la lista sale vacía: no se
 * inventa lo que no se sabe.
 */
export function notasDeLaReferencia(ref: MacroReference): string[] {
  const notas: string[] = [];
  if (ref.sources && ref.source) {
    const fallaron = ref.sources.filter((fuente) => fuente.status !== "OK").map((fuente) => fuente.name);
    notas.push(
      `Fuentes que respondieron: ${ref.source}.${fallaron.length ? ` Sin respuesta: ${fallaron.join(" y ")}.` : ""}`
    );
  }
  const tabla = ref.rate_tables?.deposit;
  if (tabla) {
    notas.push(
      `Los tipos de depósitos y de Letras de cada año salen de una tabla fija del programa, no de una consulta: son datos de tabla hasta ${tabla.measured_through_year}` +
        (tabla.assumed_years.length ? ` y supuestos en ${unirAnios(tabla.assumed_years)}, años aún no cerrados.` : ".")
    );
  }
  if (ref.letras_period) notas.push(ref.letras_period.note);
  if (ref.bizkaia_tax_scale) notas.push(ref.bizkaia_tax_scale.note);
  return notas;
}
