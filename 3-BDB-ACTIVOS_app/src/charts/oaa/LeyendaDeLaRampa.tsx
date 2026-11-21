import type { ClaseDeLaRampa } from "./chartTheme";

/**
 * La leyenda de una magnitud pintada con la rampa secuencial: una muestra por clase, con sus límites de verdad (ANA-24).
 * La misma pieza en la matriz de correlación y en la de solapamiento. El color de cada muestra lo pone su clase
 * `oaa-rampa--N`, que lee `--rampa-N`.
 */
export function LeyendaDeLaRampa({ titulo, clases }: { titulo: string; clases: readonly ClaseDeLaRampa[] }) {
  return (
    <div className="oaa-rampa-leyenda">
      <span className="oaa-rampa-leyenda__titulo">{titulo}</span>
      <ul>
        {clases.map((clase) => (
          <li key={clase.paso}>
            <i className={`oaa-rampa--${clase.paso}`} aria-hidden="true" />
            <span>{clase.rotulo}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
