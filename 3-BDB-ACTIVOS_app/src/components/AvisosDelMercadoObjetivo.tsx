import { useMemo } from "react";
import { useModoCliente } from "../app/ClientModeContext";
import { useMercadoObjetivoDeLaCartera } from "../adapters/mercadoObjetivoDeLaCartera";
import {
  avisosDelMercadoObjetivo,
  type AvisosDeLaCartera,
  type DatosDeMercadoObjetivo
} from "../core/avisosDelMercadoObjetivo";
import { Aviso } from "./ui/Aviso";
import { Cifra } from "./ui/Cifra";
import type { PerfilYHorizonte } from "../core/perfilYHorizonte";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../types/bdbAssets";
import { Panel } from "./ui/Panel";

/** «1 posición», «3 posiciones». */
const posiciones = (n: number) => `${n} ${n === 1 ? "posición" : "posiciones"}`;

/** Las líneas de lo que no se ha podido comprobar. Un hueco no se calla: sin ellas, «sin avisos» diría más de lo que mide. */
function loQueNoSeComprueba(avisos: AvisosDeLaCartera, horizonte: number | undefined): string[] {
  const lineas: string[] = [];
  if (avisos.sinDocumento > 0) {
    lineas.push(
      avisos.sinDocumento === avisos.total
        ? `Ninguna de las ${posiciones(avisos.total)} tiene mercado objetivo ni horizonte del KID en la base: no se ha podido comprobar nada.`
        : `De ${posiciones(avisos.sinDocumento)} no hay mercado objetivo ni horizonte del KID en la base: no avisan, y eso no quiere decir que no haya nada que avisar.`
    );
  }
  if (avisos.soloHorizonte > 0) {
    /* Decisión B-66: R1 sí; el mercado objetivo del fabricante (R2, R3, R4), no. */
    lineas.push(
      `De ${posiciones(avisos.soloHorizonte)} solo hay el horizonte del KID: se compara el horizonte, pero no hay mercado objetivo del fabricante que comprobar.`
    );
  }
  if (avisos.sinLeer > 0) {
    lineas.push(`No se han podido leer los datos de ${posiciones(avisos.sinLeer)}: la base no ha contestado.`);
  }
  if (avisos.conDocumento + avisos.soloHorizonte > 0 && horizonte === undefined) {
    lineas.push("La cartera no tiene horizonte definido, así que no se compara con el que recomienda cada fondo.");
  }
  if (avisos.sinHorizonteEnAnos > 0) {
    lineas.push(
      `${avisos.sinHorizonteEnAnos === 1 ? "1 posición da" : `${avisos.sinHorizonteEnAnos} posiciones dan`} su horizonte como plazo y no en años, o no lo da: no se compara.`
    );
  }
  return lineas;
}

/** El recuento del subtítulo: qué se ha podido mirar de cada posición, sin sumar lo que solo trae el KID al mercado objetivo. */
function recuento(avisos: AvisosDeLaCartera): string {
  const partes = [
    `con mercado objetivo ${avisos.conDocumento}`,
    `solo con horizonte del KID ${avisos.soloHorizonte}`,
    `sin datos ${avisos.sinDocumento}`,
    ...(avisos.sinLeer > 0 ? [`sin leer ${avisos.sinLeer}`] : [])
  ];
  return `${partes.join(", ")} de ${posiciones(avisos.total)}`;
}

const PROCEDENCIA = "Mercado objetivo del fabricante de cada fondo (EMT) y horizonte de su KID";

/**
 * «La cartera frente al mercado objetivo y el horizonte declarados», en Comprobar (decisiones 59 y B-66): los avisos R1 a R3
 * por posición, con su peso al lado, y la nota R4 de cartera. R1 corre también con el horizonte del KID solo (B-66). Informativo, como el perfil elegido de al lado: no evalúa idoneidad ni bloquea nada.
 *
 * Solo pantalla de asesor. En Modo cliente no existe, ni se leen los documentos (decisión 53, `avisosDelMercadoObjetivo` en
 * `src/core/modoCliente.ts`), y ningún informe en papel lo importa.
 */
export function AvisosDelMercadoObjetivo({
  positions,
  assets,
  perfilYHorizonte
}: {
  positions: BdbManualPortfolioPosition[];
  assets: BdbAssetDetail[];
  perfilYHorizonte: PerfilYHorizonte;
}) {
  const { seEnsena } = useModoCliente();
  const visible = seEnsena("avisosDelMercadoObjetivo") && positions.length > 0;
  const ids = useMemo(() => positions.map((position) => position.asset_id), [positions]);
  const leidos = useMercadoObjetivoDeLaCartera(ids, visible);

  const avisos = useMemo(() => {
    if (!leidos) return null;
    const nombres = new Map(assets.map((asset) => [asset.asset_id, asset.display_name]));
    return avisosDelMercadoObjetivo({
      nivel: perfilYHorizonte.risk_profile_level,
      horizonteAnos: perfilYHorizonte.horizon_years,
      posiciones: positions.map((position) => ({
        assetId: position.asset_id,
        nombre: nombres.get(position.asset_id) ?? position.label ?? position.asset_id,
        pesoPercent: position.weight_percent || 0,
        datos: leidos.get(position.asset_id) ?? ({ estado: "sin-leer" } satisfies DatosDeMercadoObjetivo)
      }))
    });
  }, [leidos, assets, positions, perfilYHorizonte.risk_profile_level, perfilYHorizonte.horizon_years]);

  if (!visible) return null;

  const cuantos = avisos ? avisos.posiciones.length : 0;
  const subtitulo = avisos ? `${PROCEDENCIA} · ${recuento(avisos)}` : PROCEDENCIA;
  const horizonte = perfilYHorizonte.horizon_years;
  /* Lo que de verdad se ha comparado: lo que solo trae el KID, solo si la cartera tiene horizonte. */
  const comprobadas = avisos ? avisos.conDocumento + (horizonte !== undefined ? avisos.soloHorizonte : 0) : 0;

  return (
    <Panel
      claseDelCuerpo="stack stack--tight"
      estado={
        cuantos > 0 ? <span className="badge is-warn">{cuantos === 1 ? "1 posición avisa" : `${cuantos} posiciones avisan`}</span> : null
      }
      subtitulo={subtitulo}
      titulo="La cartera frente al mercado objetivo y el horizonte declarados"
      tituloId="avisos-mercado-objetivo-title"
    >
      {!avisos ? (
        <p className="empty-inline" role="status">
          Leyendo el mercado objetivo y el horizonte de las posiciones…
        </p>
      ) : (
        <>
          <p className="avisos-mercado-objetivo__marco">
            Informativo: compara lo que se ha definido para la cartera con lo que declaran el fabricante y el KID de cada fondo. No
            evalúa idoneidad.
          </p>
          {avisos.notaDeLaCartera ? (
            <div data-testid="nota-de-perdidas">
              <Aviso tono="aviso">{avisos.notaDeLaCartera.texto}</Aviso>
            </div>
          ) : null}
          {avisos.posiciones.length > 0 ? (
            <ul className="avisos-mercado-objetivo" aria-label="Posiciones con avisos del mercado objetivo">
              {avisos.posiciones.map((posicion) => (
                <li key={posicion.assetId}>
                  <span className="avisos-mercado-objetivo__nombre">{posicion.nombre}</span>
                  <span className="avisos-mercado-objetivo__peso"><Cifra tipo="peso" valor={posicion.pesoPercent / 100} /></span>
                  {posicion.avisos.map((aviso) => (
                    <p
                      className={aviso.destacado ? "avisos-mercado-objetivo__aviso avisos-mercado-objetivo__aviso--destacado" : "avisos-mercado-objetivo__aviso"}
                      key={aviso.regla}
                    >
                      {aviso.texto}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          ) : comprobadas > 0 ? (
            <p className="empty-inline">Ninguna posición con datos avisa de nada frente a lo definido en la cartera.</p>
          ) : null}
          {loQueNoSeComprueba(avisos, horizonte).map((linea) => (
            <p className="avisos-mercado-objetivo__marco" key={linea}>
              {linea}
            </p>
          ))}
        </>
      )}
    </Panel>
  );
}
