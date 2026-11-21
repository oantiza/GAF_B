/**
 * Las cuentas de presentación de los gráficos de la plantilla: los cortes redondos del eje, los tramos de una línea con
 * huecos, las marcas del eje de fechas y la colocación de las etiquetas directas para que no se pisen. Son puras y no
 * importan @react-pdf: `tests/plantilla/piezas.test.tsx` las prueba sueltas. No son cifras del informe.
 */
import { fechaDeEje } from "../../core/formato";

/** Cortes «redondos» del eje: de 1, 2, 2,5 o 5 por potencia de diez, unos cinco. */
export function cortesDelEje(minimo: number, maximo: number, cuantos = 5): number[] {
  if (!Number.isFinite(minimo) || !Number.isFinite(maximo)) return [];
  if (maximo - minimo < 1e-9) {
    const margen = Math.abs(maximo) > 0 ? Math.abs(maximo) * 0.05 : 1;
    minimo -= margen;
    maximo += margen;
  }
  const bruto = (maximo - minimo) / Math.max(1, cuantos - 1);
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const paso = [1, 2, 2.5, 5, 10].map((f) => f * potencia).find((p) => p >= bruto) ?? 10 * potencia;
  const desde = Math.floor(minimo / paso) * paso;
  const hasta = Math.ceil(maximo / paso) * paso;
  const cortes: number[] = [];
  for (let v = desde; v <= hasta + paso / 2; v += paso) cortes.push(Number(v.toPrecision(12)));
  return cortes;
}

/**
 * Los tramos continuos de una serie: un hueco (`null`, `NaN`, un infinito) parte la línea en dos, no se une por encima.
 * Cada tramo es la lista de índices que lo forman; un punto suelto entre dos huecos es un tramo de un punto.
 */
export function tramos(valores: ReadonlyArray<number | null | undefined>): number[][] {
  const salida: number[][] = [];
  let actual: number[] = [];
  valores.forEach((valor, i) => {
    if (typeof valor === "number" && Number.isFinite(valor)) {
      actual.push(i);
      return;
    }
    if (actual.length > 0) salida.push(actual);
    actual = [];
  });
  if (actual.length > 0) salida.push(actual);
  return salida;
}

/** El último valor con cifra de una serie y su índice; `null` si no tiene ninguno. */
export function ultimoValor(valores: ReadonlyArray<number | null | undefined>): { indice: number; valor: number } | null {
  for (let i = valores.length - 1; i >= 0; i -= 1) {
    const valor = valores[i];
    if (typeof valor === "number" && Number.isFinite(valor)) return { indice: i, valor };
  }
  return null;
}

/** Puntos que se dibujan como mucho por tramo: una línea de tres años no gana nada con mil vértices. */
export const MAXIMO_DE_PUNTOS = 400;

/** Aclara un tramo largo: uno de cada `paso` índices, y siempre el primero y el último. */
export function aclarar(indices: readonly number[], maximo = MAXIMO_DE_PUNTOS): number[] {
  if (indices.length <= maximo) return [...indices];
  const paso = Math.ceil(indices.length / maximo);
  const salida = indices.filter((_, i) => i % paso === 0);
  if (salida[salida.length - 1] !== indices[indices.length - 1]) salida.push(indices[indices.length - 1]);
  return salida;
}

/**
 * Las marcas del eje de fechas: el primer día de cada mes que aparece, uno de cada 1, 2, 3, 6, 12 o 24 meses, los
 * necesarios para no pasar de `maximo`. El texto lo pone `fechaDeEje` del módulo común («nov 2026»).
 */
export function marcasDeFechas(fechas: readonly string[], maximo = 6): Array<{ indice: number; texto: string }> {
  if (fechas.length < 2) return [];
  const cambios: Array<{ indice: number; mes: number }> = [];
  for (let i = 1; i < fechas.length; i += 1) {
    if (fechas[i].slice(0, 7) !== fechas[i - 1].slice(0, 7)) {
      cambios.push({ indice: i, mes: Number(fechas[i].slice(0, 4)) * 12 + Number(fechas[i].slice(5, 7)) - 1 });
    }
  }
  if (cambios.length === 0) {
    const texto = fechaDeEje(fechas[0]);
    return texto ? [{ indice: 0, texto }] : [];
  }
  const paso = [1, 2, 3, 6, 12, 24, 60].find((p) => cambios.filter((c) => c.mes % p === 0).length <= maximo) ?? 120;
  return cambios
    .filter((cambio) => cambio.mes % paso === 0)
    .map((cambio) => ({ indice: cambio.indice, texto: fechaDeEje(fechas[cambio.indice]) ?? "" }))
    .filter((marca) => marca.texto !== "");
}

/**
 * Coloca las etiquetas directas al final de las líneas: cada una lo más cerca posible de su punto, sin pisarse (al
 * menos `separacion` entre dos) y dentro de [`arriba`, `abajo`]. Devuelve las alturas en el orden de entrada.
 */
export function colocarEtiquetas(deseadas: readonly number[], separacion: number, arriba: number, abajo: number): number[] {
  const orden = deseadas.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const colocadas = orden.map((o) => Math.min(Math.max(o.y, arriba), abajo));
  for (let k = 1; k < colocadas.length; k += 1) colocadas[k] = Math.max(colocadas[k], colocadas[k - 1] + separacion);
  /* Si la última se sale por abajo, se pone en el límite y se empujan hacia arriba las que haga falta. */
  if (colocadas.length > 0 && colocadas[colocadas.length - 1] > abajo) {
    colocadas[colocadas.length - 1] = abajo;
    for (let k = colocadas.length - 2; k >= 0; k -= 1) colocadas[k] = Math.min(colocadas[k], colocadas[k + 1] - separacion);
  }
  const salida = new Array<number>(deseadas.length);
  orden.forEach((o, k) => {
    salida[o.i] = colocadas[k];
  });
  return salida;
}
