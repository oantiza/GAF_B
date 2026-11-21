/**
 * La tabla alternativa de un gráfico: las mismas cifras que pinta, para el lector de pantalla. Oculta a la vista y no
 * al lector (`sr-only`). Es una sola utilidad para todos los gráficos (apartado 7 de `docs/frontend/SISTEMA_DISENO.md`):
 * la monta `OaaChartFrame` cuando se le pasa `alternativa`, o la pieza que no usa el marco.
 */
export interface FilaAlternativa {
  clave: string;
  /** La cabecera de la fila: la fecha, la categoría, el nombre del punto. */
  rotulo: string;
  celdas: string[];
}

export interface DatosAlternativos {
  /** Qué se ve: el mismo nombre que lleva el gráfico. */
  titulo: string;
  /** La primera es la cabecera de la columna de rótulos («Fecha», «Categoría»…). */
  columnas: string[];
  filas: FilaAlternativa[];
}

/**
 * Lo que se recorta es el envoltorio, no la tabla: `sr-only` (1 × 1 px, `overflow: hidden`, `clip-path`) no vale en un
 * elemento con `display: table`, que crece hasta su contenido. Puesta en la tabla, a 768 px desbordaba la página de
 * Análisis 98 px.
 */
export function TablaAlternativa({ titulo, columnas, filas }: DatosAlternativos) {
  if (!filas.length) return null;
  return (
    <div className="sr-only">
      <table>
        <caption>{titulo}</caption>
        <thead>
          <tr>
            {columnas.map((columna, indice) => (
              <th key={`${indice}-${columna}`} scope="col">
                {columna}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((fila) => (
            <tr key={fila.clave}>
              <th scope="row">{fila.rotulo}</th>
              {fila.celdas.map((celda, indice) => (
                <td key={indice}>{celda}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
