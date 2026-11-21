/**
 * La escala del plano riesgo-retorno: dónde van las marcas de cada eje, y si una etiqueta cabe.
 *
 * Cada panel se ajusta a sus puntos, y hasta el 04-11-2026 sus ejes no llevaban ni un número: un
 * +25,28 % y un +16,33 % salían a la misma altura en paneles contiguos. Los paneles siguen sin
 * compartir escala, porque son métodos distintos, pero cada uno dice ahora la suya.
 */

/** Los pasos que se leen de un vistazo, por cada potencia de diez. */
const PASOS = [1, 2, 2.5, 5];

/**
 * Entre cuatro y cinco marcas redondas que abarcan todos los valores.
 *
 * Se elige el paso más fino que no pase de cinco. No puede quedarse en tres: si el paso anterior
 * pedía seis marcas, los valores cruzan al menos tres intervalos de él, y eso con el doble del paso
 * son al menos tres intervalos otra vez, o sea cuatro marcas.
 *
 * `maximo` sube el tope: un gráfico de líneas admite siete, y con siete el eje se ciñe más a la serie
 * (de 98 a 142, «90 … 150» de diez en diez en vez de «80 … 160» de veinte en veinte).
 */
export function marcasDelEje(valores: readonly number[], opciones: { conCero?: boolean; maximo?: number } = {}): number[] {
  const maximo = opciones.maximo ?? 5;
  const conocidos = valores.filter((valor) => Number.isFinite(valor));
  const todos = opciones.conCero ? [...conocidos, 0] : conocidos;
  if (todos.length === 0) return [];
  let min = Math.min(...todos);
  let max = Math.max(...todos);
  /* Un solo valor no da recorrido: se le abre un margen para que tenga una escala que leer. */
  if (max - min < 1e-9) {
    const margen = Math.max(Math.abs(max) * 0.5, 0.01);
    min -= margen;
    max += margen;
  }
  const potenciaDeInicio = Math.floor(Math.log10(max - min)) - 2;
  for (let potencia = potenciaDeInicio; potencia <= potenciaDeInicio + 4; potencia += 1) {
    for (const paso of PASOS) {
      const tamano = paso * 10 ** potencia;
      const desde = Math.floor(min / tamano + 1e-9);
      const hasta = Math.ceil(max / tamano - 1e-9);
      if (hasta - desde + 1 <= maximo) {
        /* El redondeo a 10 decimales quita el 0,30000000000000004 de multiplicar en coma flotante. */
        return Array.from({ length: hasta - desde + 1 }, (_, indice) =>
          Number(((desde + indice) * tamano).toFixed(10))
        );
      }
    }
  }
  return [min, max];
}

/** Decimales para escribir unas marcas de proporción en porcentaje: 0, 1 o 2, los que hagan falta. */
export function decimalesDeLasMarcas(marcas: readonly number[]): number {
  const enPorcentaje = marcas.map((marca) => marca * 100);
  for (const decimales of [0, 1, 2]) {
    if (enPorcentaje.every((valor) => Math.abs(valor - Number(valor.toFixed(decimales))) < 1e-6)) return decimales;
  }
  return 2;
}

/**
 * Lo que mide un texto del plano en unidades del dibujo, a 11 de cuerpo. Es una estimación por tipo
 * de letra, un poco por exceso, para no depender de medir en el navegador: las mayúsculas de
 * «COMMONWEALTH BANK OF AUSTRALIA» ocupan bastante más que las minúsculas de un fondo.
 */
export function anchoDelTexto(texto: string): number {
  let ancho = 0;
  for (const letra of texto) {
    if (letra === " " || /[.,;:'·|!il1]/.test(letra)) ancho += 3.4;
    else if (/[A-ZÁÉÍÓÚÑ%]/.test(letra)) ancho += 7.6;
    else ancho += 6.2;
  }
  return ancho;
}
