import { useEffect, useRef, useState, type ReactNode } from "react";
import { EnlaceAFicha } from "./ui/EnlaceAFicha";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../types/bdbAssets";
import { numero, oFalta } from "../core/formato";
import { textoDeAusencia } from "../core/textoDeAusencia";
import { CLASS_LABELS, TYPE_LABELS, readableBackendLabel } from "../core/labels";
import { Button } from "./ui/Button";
import { Cifra } from "./ui/Cifra";
import { ClaseConColor } from "./ui/ClaseConColor";
import { EuroAmountInput } from "./ui/EuroAmountInput";
import { hayPesoFijado } from "../core/asignacionTactica";
import { portfolioPositionAmount } from "../core/portfolioAmounts";
import { Aviso } from "./ui/Aviso";
import { Distintivo } from "./ui/Distintivo";
import { NotaEmergente } from "./ui/NotaEmergente";
import { Panel } from "./ui/Panel";

interface PortfolioPositionsTableProps {
  assets: BdbAssetDetail[];
  positions: BdbManualPortfolioPosition[];
  totalCapital: number;
  locks: Record<string, boolean>;
  onRemove: (assetId: string) => void;
  onWeightChange: (assetId: string, weightPercent: number) => void;
  onEuroChange: (assetId: string, euros: number) => void;
  onToggleLock: (assetId: string) => void;
  /** Deja de conservar el importe de una posición (`keepEuros`): vuelve a reescalarse como las demás. */
  onReleaseFixedAmount?: (assetId: string) => void;
  /** Ola 3b (fusión Resumen→Constructor): «Sustituir» por fila abre el buscador de alternativas preseleccionado. */
  onSwapRequest?: (assetId: string) => void;
  /** Los importes salen del capital de ejemplo: la columna lo dice. */
  capitalSinFijar?: boolean;
  /** La salida de una cartera vacía. */
  onIrAlBuscador?: () => void;
  /** Por qué el último importe escrito no ha quedado como se pidió. */
  aviso?: string | null;
  /** Las fichas se están leyendo: lo que falta de ellas aún no se sabe si falta. */
  cargandoFichas?: boolean;
  /** Las herramientas de edición que gobiernan esta tabla (el modo, «Añadir dinero»…), en la cabecera del bloque. */
  acciones?: ReactNode;
  /**
   * D1 (Óscar, 21-11-2026): la fila «Total» al pie, con «Normalizar al 100 %» siempre a la vista. Sin esto, la tabla no
   * lleva pie. `rotulo` cambia a «Repartir a partes iguales» cuando las libres están a cero; con la cartera cuadrada el
   * botón sigue a la vista, desactivado, y dice por qué.
   */
  normalizar?: { alPulsar: () => void; cuadrada: boolean; rotulo: string };
}

/**
 * DIS-05: un peso de más de 100 no se recorta: no se aplica, y se dice qué se ha leído. El campo usa el lector de la
 * cifra tecleada (`leerCifraTecleada`, FMT-20), donde «12.500» es un punto de miles; en un peso eso nunca es lo que se quería, porque
 * cualquier cifra con punto de miles pasa de 100. Por eso basta con enseñar la cifra leída y cómo se escriben decimales.
 */
function textoDelPesoRechazado(valor: number): string {
  const leido = oFalta(numero(valor, { decimales: Number.isInteger(valor) ? 0 : 2 }));
  return `Se ha leído ${leido}\u00a0%: un peso no pasa del 100 %. Los decimales se escriben con coma, como 12,5. El peso no ha cambiado.`;
}

function getAsset(assets: BdbAssetDetail[], assetId: string): BdbAssetDetail | undefined {
  return assets.find((asset) => asset.asset_id === assetId);
}

export function PortfolioPositionsTable({
  assets,
  positions,
  totalCapital,
  locks,
  onRemove,
  onWeightChange,
  onEuroChange,
  onToggleLock,
  onReleaseFixedAmount,
  onSwapRequest,
  capitalSinFijar = false,
  onIrAlBuscador,
  aviso = null,
  cargandoFichas = false,
  acciones,
  normalizar
}: PortfolioPositionsTableProps) {
  /* Decisión 37: con un peso fijado, editar un importe no mueve el capital. Lo que dice esto lo hace `editarImporte`. */
  const conPesoFijado = hayPesoFijado(positions, locks);
  const reglaDelImporte = conPesoFijado
    ? "Con pesos fijados, el capital no cambia: el importe se traduce a peso y la diferencia se reparte entre las posiciones libres. El importe de una fila fijada no se edita."
    : capitalSinFijar
      ? ""
      : "Al editar un importe se actualizan el capital total y todos los pesos. Los importes de las demás posiciones se conservan.";
  /* La fila editada puede estar muy por debajo del aviso, y a 768 px lo deja fuera de la vista. Sin verlo, un importe
     que ha cambiado solo parece un error. Solo mueve la vista si hace falta, y solo al aparecer: volver a este paso con
     el aviso puesto no debe llevarse la página. */
  const parrafoDelAviso = useRef<HTMLDivElement>(null);
  const [pesoRechazado, setPesoRechazado] = useState<{ assetId: string; valor: number } | null>(null);
  const avisoYaVisto = useRef(aviso);
  useEffect(() => {
    if (aviso && aviso !== avisoYaVisto.current) parrafoDelAviso.current?.scrollIntoView?.({ block: "nearest" });
    avisoYaVisto.current = aviso;
  }, [aviso]);

  return (
    <Panel
      acciones={acciones}
      claseDelCuerpo="stack stack--tight"
      estado={positions.length > 0 ? `${positions.length} ${positions.length === 1 ? "posición" : "posiciones"}` : null}
      subtitulo={
        positions.length === 0
          ? undefined
          : [capitalSinFijar ? "Los importes son de ejemplo: el capital está sin fijar. Al editar uno se pide fijarlo antes." : "", reglaDelImporte].filter(Boolean).join(" ")
      }
      titulo="Posiciones"
      tituloId="portfolio-positions-title"
    >
      {aviso ? (
        /* MAR-21: lo pinta la pieza `Aviso`. La caja de fuera lleva lo que la pieza no recibe: a quién se trae a la vista y
           el nombre con que lo buscan las pruebas. */
        <div className="portfolio-aviso-de-importe" ref={parrafoDelAviso} data-testid="aviso-peso">
          <Aviso anunciar tono="aviso">
            {aviso}
          </Aviso>
        </div>
      ) : null}
      {positions.length === 0 ? (
        <div className="empty-inline">
          <strong>Cartera vacía</strong>
          <span>Busca los activos en el Buscador y pulsa «Añadir», o importa tus posiciones.</span>
          {onIrAlBuscador ? (
            <Button onClick={onIrAlBuscador} size="sm" variant="secondary">
              Ir al Buscador
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="portfolio-table-wrapper">
          <table className="portfolio-table" aria-label="Posiciones de la cartera">
            <thead>
              <tr>
                <th scope="col">Activo</th>
                {/* Ola 2 (B″): vehículo y clase apilados en una columna — la
                    tabla cabe en las 8 columnas junto a la lateral sin scroll. */}
                <th scope="col">Producto · clase</th>
                <th className="num" scope="col">Peso</th>
                <th className="num" scope="col">{capitalSinFijar ? "Importe de ejemplo" : "Importe"}</th>
                <th className="col-center" scope="col">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {positions.map((position) => {
                const asset = getAsset(assets, position.asset_id);
                const euros = portfolioPositionAmount(position, totalCapital);
                const locked = Boolean(locks[position.asset_id]);
                /* DIS-09: sin ficha (todavía o nunca), el nombre que trae la posición antes que su ISIN. */
                const nombre = asset?.display_name ?? position.label ?? position.asset_id;
                const sinFicha = cargandoFichas && !asset ? "Leyendo…" : textoDeAusencia("falta");

                return (
                  <tr key={position.asset_id}>
                    <td>
                      <span className="cell-entity">
                        <span className="cell-entity__name">
                          <EnlaceAFicha isin={position.asset_id}>{nombre}</EnlaceAFicha>
                        </span>
                        <span className="cell-entity__code">{asset?.isin ?? position.asset_id}</span>
                        {/* Una posición que conserva su importe es fija, como un
                            candado: no se reescala al normalizar ni al editar
                            otras filas en modo Proporcional. */}
                        {position.keepEuros && !locked ? (
                          <span>
                            <Distintivo tono="marca">Importe fijo</Distintivo>{" "}
                            <NotaEmergente termino="el importe fijo">
                              Conserva su importe: no se reescala al normalizar ni al editar otras posiciones en modo
                              Proporcional. Si editas su peso o su importe, fija el nuevo.
                            </NotaEmergente>
                            {onReleaseFixedAmount ? (
                              <>
                                {" "}
                                <Button
                                  size="sm"
                                  variant="quiet"
                                  onClick={() => onReleaseFixedAmount(position.asset_id)}
                                  aria-label={`Soltar el importe fijo de ${nombre}`}
                                  title="Deja de conservar su importe: vuelve a reescalarse como las demás posiciones."
                                >
                                  Soltar
                                </Button>
                              </>
                            ) : null}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td>
                      <span className="cell-entity">
                        <span className="cell-entity__name">
                          {asset?.instrument_type ? TYPE_LABELS[asset.instrument_type] ?? readableBackendLabel(asset.instrument_type) : sinFicha}
                        </span>
                        <span className="cell-entity__code cell-entity__code--text">
                          {/* La clase con el punto de su color, el mismo que en el aro del reparto de al lado (14-11-2026). */}
                          {asset?.economic_asset_class ? (
                            <ClaseConColor clave={asset.economic_asset_class}>
                              {CLASS_LABELS[asset.economic_asset_class] ?? readableBackendLabel(asset.economic_asset_class)}
                            </ClaseConColor>
                          ) : (
                            sinFicha
                          )}
                        </span>
                      </span>
                    </td>
                    <td className="num">
                      <label className="portfolio-weight-input">
                        {/* Con el parser europeo y confirmando al salir, como el importe: en un `type="number"`, un
                            punto dejaba el campo en blanco para el navegador, se leía como 0, y «12.5» acababa en 5. */}
                        <EuroAmountInput
                          aria-describedby={pesoRechazado?.assetId === position.asset_id ? `peso-rechazado-${position.asset_id}` : undefined}
                          aria-invalid={pesoRechazado?.assetId === position.asset_id || undefined}
                          ariaLabel={`Peso de ${nombre}`}
                          disabled={locked}
                          notaDeError="Peso no válido: escríbelo con números, por ejemplo 12,5"
                          onCommit={(value) => {
                            if (value > 100) {
                              setPesoRechazado({ assetId: position.asset_id, valor: value });
                              return;
                            }
                            setPesoRechazado(null);
                            onWeightChange(position.asset_id, value);
                          }}
                          value={Math.round(position.weight_percent * 100) / 100}
                        />
                        <span>%</span>
                        {pesoRechazado?.assetId === position.asset_id ? (
                          <span className="field__error" id={`peso-rechazado-${position.asset_id}`} role="alert">
                            {textoDelPesoRechazado(pesoRechazado.valor)}
                          </span>
                        ) : null}
                      </label>
                    </td>
                    <td className="num">
                      <label className={`portfolio-weight-input portfolio-euro-input${capitalSinFijar ? " is-de-ejemplo" : ""}`}>
                        {/* Revisión 12-08: importe con convención española y
                            confirmación en blur — el type=number rechazaba
                            «20.000» y propagaba cada tecla al estado global. */}
                        <EuroAmountInput
                          disabled={locked}
                          onCommit={(value) => onEuroChange(position.asset_id, value)}
                          value={euros}
                          ariaLabel={`Importe en euros de ${nombre}`}
                        />
                        <span>€</span>
                      </label>

                    </td>
                    <td className="col-center portfolio-row-actions">
                      <button
                        type="button"
                        className={locked ? "portfolio-lock locked" : "portfolio-lock"}
                        aria-pressed={locked}
                        aria-label={`${locked ? "Desbloquear" : "Bloquear"} el peso de ${nombre}`}
                        title={locked ? "Peso fijado: no cambia al normalizar, al optimizar ni al editar otro importe. Mientras esté fijado, su peso y su importe no se editan." : "Fijar peso"}
                        onClick={() => onToggleLock(position.asset_id)}
                      >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                          <rect x="5" y="11" width="14" height="9" rx="2" />
                          {locked ? <path d="M8 11V8a4 4 0 0 1 8 0v3" /> : <path d="M8 11V8a4 4 0 0 1 7-2.4" />}
                        </svg>
                      </button>
                      {/* B3c (12-08): acciones por fila como iconos con nombre
                          accesible — dos textos por fila engordaban la columna. */}
                      {onSwapRequest ? (
                        <button
                          className="portfolio-row-action"
                          onClick={() => onSwapRequest(position.asset_id)}
                          type="button"
                          aria-label={`Sustituir ${nombre}`}
                          title="Sustituir activo"
                        >
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M4 8h13M14 4.5 17.5 8 14 11.5" />
                            <path d="M20 16H7M10 12.5 6.5 16l3.5 3.5" />
                          </svg>
                        </button>
                      ) : null}
                      <button
                        className="portfolio-row-action portfolio-row-action--danger"
                        onClick={() => onRemove(position.asset_id)}
                        type="button"
                        aria-label={`Quitar ${nombre}`}
                        title="Quitar de la cartera"
                      >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
                          <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {normalizar ? (
              <tfoot>
                <tr className="portfolio-table__total">
                  <th colSpan={2} scope="row">
                    <span className="portfolio-table__total-rotulo">
                      <span>Total</span>
                      <Button
                        disabled={normalizar.cuadrada}
                        onClick={normalizar.alPulsar}
                        size="sm"
                        title={normalizar.cuadrada ? "La cartera ya suma 100 %: no hay nada que normalizar." : undefined}
                        variant="secondary"
                      >
                        {normalizar.rotulo}
                      </Button>
                    </span>
                  </th>
                  <td className="num">
                    <Cifra tipo="peso" valor={positions.reduce((suma, position) => suma + (position.weight_percent || 0), 0) / 100} />
                  </td>
                  <td className="num">
                    <Cifra tipo="importe" valor={positions.reduce((suma, position) => suma + portfolioPositionAmount(position, totalCapital), 0)} />
                  </td>
                  <td />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}
    </Panel>
  );
}
