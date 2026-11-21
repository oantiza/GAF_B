/**
 * Las carteras guardadas en Diseño de cartera, para elegirlas como candidatas. Se listan con
 * el mismo hook que usa Diseño (`useSavedPortfolios`): en la cuenta del asesor si hay sesión
 * con la plataforma, o las de este navegador si no. Si la lectura falla, se dice en una línea
 * y la comparación sigue con las del gestor.
 */
import { DEFAULT_DATA_SOURCE_KIND } from "../../../config/runtimeConfig";
import { useSavedPortfolios } from "../../../core/useSavedPortfolios";
import type { Candidata } from "./calcular";
import { CasillaDeCandidata } from "./CasillaDeCandidata";

/* Los avisos del hook («cargada», «no se pudo listar») son para Diseño: aquí el fallo se lee de su estado. */
const sinAvisos = () => undefined;

export function CandidatasDeDiseno({ elegidas, lleno, alternar, soloLasElegidas = false }: {
  elegidas: ReadonlySet<string>;
  lleno: boolean;
  alternar: (candidata: Candidata) => void;
  /** Modo cliente (GES-08): las carteras guardadas son de otros clientes; solo siguen a la vista las ya elegidas. */
  soloLasElegidas?: boolean;
}) {
  const guardadas = useSavedPortfolios({ sourceKind: DEFAULT_DATA_SOURCE_KIND, onNotice: sinAvisos });
  const aLaVista = soloLasElegidas ? guardadas.savedPortfolios.filter((guardada) => elegidas.has(`diseno:${guardada.portfolio_id}`)) : guardadas.savedPortfolios;

  if (guardadas.listando) return <p className="cmp-note" role="status">Leyendo las propuestas de Diseño…</p>;
  if (guardadas.errorAlListar) {
    return (
      <p className="cmp-note">
        No se han podido leer las propuestas de Diseño (hace falta la sesión iniciada con la plataforma). Puedes comparar con las carteras de clientes.{" "}
        <button className="gestor-enlace" onClick={guardadas.reintentar} type="button">Reintentar</button>
      </p>
    );
  }
  if (guardadas.savedPortfolios.length === 0) {
    return <p className="cmp-note">No hay propuestas guardadas en Diseño{guardadas.enLaCuenta ? " en tu cuenta" : " en este navegador"}.</p>;
  }
  if (aLaVista.length === 0) return <p className="cmp-note">Sal de Modo cliente para ver otras carteras.</p>;
  return (
    <ul className="gestor-candidatas">
      {aLaVista.map((guardada) => {
        const candidata: Candidata = {
          clase: "diseno",
          clave: `diseno:${guardada.portfolio_id}`,
          nombre: guardada.name,
          posiciones: guardada.positions.map((posicion) => ({ isin: posicion.asset_id, pesoPorCien: posicion.weight_percent }))
        };
        const elegida = elegidas.has(candidata.clave);
        return (
          <CasillaDeCandidata
            alCambiar={() => alternar(candidata)}
            detalle={guardada.positions.length === 1 ? "1 activo" : `${guardada.positions.length} activos`}
            elegida={elegida}
            inhabilitada={lleno && !elegida}
            key={candidata.clave}
            nombre={guardada.name}
          />
        );
      })}
    </ul>
  );
}
