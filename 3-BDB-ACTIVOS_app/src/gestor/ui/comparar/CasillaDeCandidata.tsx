/** Una cartera que se puede elegir para comparar: una casilla con su nombre y un detalle. */
export function CasillaDeCandidata({ nombre, detalle, elegida, inhabilitada, alCambiar }: {
  nombre: string;
  detalle?: string;
  elegida: boolean;
  inhabilitada: boolean;
  alCambiar: () => void;
}) {
  return (
    <li className="gestor-candidata">
      <label className="check">
        <input checked={elegida} disabled={inhabilitada} onChange={alCambiar} type="checkbox" />
        <span>
          {nombre}
          {detalle ? <span className="gestor-fila__nota">{detalle}</span> : null}
        </span>
      </label>
    </li>
  );
}
