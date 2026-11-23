/**
 * El número y el color de un activo en el Comparador: el mismo que lleva en el gráfico, el mapa y la matriz, para que el
 * asesor lo siga de un bloque a otro sin leer el nombre otra vez (Óscar, 20-11-2026: «Marcar activos en el Comparador»).
 * El color solo acompaña: el número es lo que lo identifica, y se lee también sin color.
 */
export function MarcaDeActivo({ numero, color }: { numero: number; color: string }) {
  return (
    <span className="marca-de-activo">
      <span aria-hidden="true" className="marca-de-activo__punto" style={{ background: color }} />
      <span>{numero}</span>
    </span>
  );
}
