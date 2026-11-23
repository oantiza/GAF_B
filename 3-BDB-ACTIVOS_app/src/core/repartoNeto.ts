/**
 * El reparto NETO por clase de activo (decisión C-29 de Óscar, 21-11-2026, «Sí, las tres»).
 *
 * El proveedor da el reparto de un fondo neto de cortos y de apalancamiento, como Morningstar, y suma el 100 %: una clase
 * puede ser negativa (una posición corta, liquidez prestada) o pasar del 100 % (apalancamiento). ES0137396000 trae renta
 * variable 319,8 % y liquidez −242,6 %. Desde esa fecha se acepta tal cual, con su signo, si suma el 100 %, hasta los topes
 * del contrato de la base nueva (`declared/exposure`, `peso_de_clase`: de −5 a 6). Lo que no suma el 100 % sigue sin reparto.
 *
 * Se lee y se dibuja así, en toda la aplicación:
 *  - la suma ponderada de una cartera sigue siendo correcta con negativos: no se recorta a 0-1 ni se normaliza lo positivo;
 *  - la clase negativa se escribe con su signo («−1,4 %») y no lleva barra ni porción de aro, que no pueden ser negativas;
 *  - junto al reparto va `NOTA_DEL_REPARTO_NETO` cuando alguna clase se sale de 0-100.
 */

/** Los topes de una clase en un reparto neto: los de `peso_de_clase` en el contrato de `declared/exposure`. */
export const TOPE_INFERIOR_DE_UNA_CLASE = -5;
export const TOPE_SUPERIOR_DE_UNA_CLASE = 6;

/** Cuánto puede no sumar 1 un reparto, y cuánto puede salirse de 0-1 una clase por redondeo: la tolerancia de la plataforma. */
export const TOLERANCIA_DEL_REPARTO = 0.01;

/** La nota que acompaña a un reparto con una clase fuera de 0-100. La misma en la ficha y en la cartera. */
export const NOTA_DEL_REPARTO_NETO =
  "Reparto neto: incluye posiciones cortas o apalancamiento, así que una clase puede salir en negativo y otra pasar del 100 %.";

/** La nota de un aro con un reparto neto: lo que no puede dibujar, dicho junto a él (`OaaDonutChart`). */
export const NOTA_DEL_ARO_NETO = "Reparto neto: incluye posiciones cortas o apalancamiento. El aro dibuja solo las partes positivas.";

/** ¿Es un reparto que se lee tal cual? Suma 1 con la tolerancia y ninguna clase pasa de los topes. Las fracciones, en tanto por uno. */
export function sumaComoUnRepartoNeto(fracciones: readonly number[]): boolean {
  const suma = fracciones.reduce((total, valor) => total + valor, 0);
  return (
    Math.abs(suma - 1) <= TOLERANCIA_DEL_REPARTO &&
    fracciones.every((valor) => valor >= TOPE_INFERIOR_DE_UNA_CLASE && valor <= TOPE_SUPERIOR_DE_UNA_CLASE)
  );
}

/**
 * ¿Lleva cortos o apalancamiento? Alguna clase por debajo de 0 o por encima de 1 más allá del redondeo de la tolerancia. Es lo
 * que decide la nota. Vale con fracciones (`escala` 1) o con porcentajes (`escala` 100).
 */
export function tieneCortosOApalancamiento(valores: readonly number[], escala: 1 | 100 = 1): boolean {
  const margen = TOLERANCIA_DEL_REPARTO * escala;
  return valores.some((valor) => Number.isFinite(valor) && (valor < -margen || valor > escala + margen));
}
