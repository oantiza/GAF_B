/**
 * El hueco de algo que está cargando, con la forma de lo que va a llegar: unas líneas de texto o un bloque (un
 * gráfico, una tabla). Así la página no salta cuando llegan los datos.
 *
 * - `lineas`: tantas líneas de texto como se esperan; la última, más corta, como acaba un párrafo. Tres por defecto.
 * - `alto`: un bloque de ese alto en píxeles, en vez de líneas.
 *
 * Lleva `aria-hidden`: no dice nada a quien no ve la pantalla. **El anuncio lo hace quien lo usa**, con un
 * `LoadingState` o un `aria-busy` en la región que espera; el esqueleto solo dibuja. Su brillo se para si se ha
 * pedido reducir el movimiento.
 *
 * ```tsx
 * <Esqueleto lineas={4} />
 * <Esqueleto alto={280} />   // el hueco de un gráfico
 * ```
 */
export interface EsqueletoProps {
  /** Líneas de texto. Tres por defecto, si no se da `alto`. */
  lineas?: number;
  /** Un bloque de este alto, en píxeles. */
  alto?: number;
  className?: string;
}

export function Esqueleto({ lineas = 3, alto, className = "" }: EsqueletoProps) {
  if (alto !== undefined) {
    return <div aria-hidden="true" className={`esqueleto esqueleto__bloque ${className}`.trim()} style={{ height: `${alto}px` }} />;
  }
  const cuantas = Math.max(1, Math.round(lineas));
  return (
    <div aria-hidden="true" className={`esqueleto ${className}`.trim()}>
      {Array.from({ length: cuantas }, (_, indice) => (
        <span className="esqueleto__linea" key={indice} />
      ))}
    </div>
  );
}
