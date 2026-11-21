/**
 * Paso 2 del asistente: qué se va a cargar. Primero los problemas que impiden importar,
 * después los activos que piden una decisión y, al final, cada movimiento con su casilla.
 */
import { useMemo, useState } from "react";
import { Ausencia } from "../../../components/ui/Ausencia";
import { Button } from "../../../components/ui/Button";
import { Campo } from "../../../components/ui/Campo";
import { activoPropioPara, type ActivoPorResolver, type DecisionSobreUnActivo, type LineaDeRevision, type Revision } from "../../importacion/revision";
import type { ResultadoDeImportacion } from "../../importacion/tipos";
import { activoDesdeElCatalogo } from "../../mercado/fichas";
import { aNumero, d } from "../../motor/decimal";
import type { Cartera } from "../../motor/modelo";
import { nombreDelTipo } from "../../motor/movimientos/registro";
import { SelectorDeActivo } from "../dialogos/SelectorDeActivo";
import { Distintivo } from "../../../components/ui/Distintivo";
import { LineaDeAviso } from "../piezas";
import { escrito } from "../textos";
import {
  CLASE_DE_LA_GRAVEDAD,
  agruparActivos,
  avisosGenerales,
  documentosDeLasLineas,
  erroresDeLosResultados,
  estaMarcada,
  estadoDeLaLinea,
  hayQueMirar,
  queSeHara,
  resumenDeLaRevision,
  seleccionable,
  tituloDeLosAvisos,
  type MarcasDeLaRevision
} from "./revisionDelAsistente";

type AlDecidir = (clave: string, decision: DecisionSobreUnActivo | undefined) => void;

function detalleDelCitado(activo: ActivoPorResolver): string {
  const apariciones = activo.apariciones === 1 ? "en 1 movimiento" : activo.apariciones > 1 ? `en ${activo.apariciones} movimientos` : "solo en el extracto de posiciones";
  return [activo.citado.isin ?? "Sin ISIN", activo.citado.divisa, apariciones].filter(Boolean).join(" · ");
}

/** Un activo que pide decisión (o al que se le ofrecen parecidos del catálogo). */
function DecisionDeActivo({ activo, decision, cartera, idsDeLaCartera, alDecidir }: {
  activo: ActivoPorResolver;
  decision: DecisionSobreUnActivo | undefined;
  cartera: Cartera;
  idsDeLaCartera: ReadonlySet<string>;
  alDecidir: AlDecidir;
}) {
  const [buscando, setBuscando] = useState(false);
  const clave = activo.citado.clave;
  const porDecidir = activo.estado === "por-decidir";

  return (
    <div className="gestor-decision stack stack--3">
      <span className="gestor-elegido__nombre">
        {activo.citado.nombre}
        <span className="gestor-elegido__detalle">{detalleDelCitado(activo)}</span>
      </span>
      {decision ? (
        <div className="row">
          <span className="gestor-decision__hecha">{queSeHara(activo, decision, idsDeLaCartera)}</span>
          <Button onClick={() => alDecidir(clave, undefined)} size="sm" variant="quiet">Cambiar</Button>
        </div>
      ) : buscando ? (
        <SelectorDeActivo
          activosDeLaCartera={cartera.activos}
          alElegir={(elegido) => {
            if (!elegido) return;
            setBuscando(false);
            alDecidir(clave, elegido);
          }}
          divisaBase={cartera.divisaBase}
          elegido={undefined}
          rotulo={`Qué activo es «${activo.citado.nombre}»`}
        />
      ) : (
        <>
          <p className="cmp-note">
            {porDecidir
              ? "El documento solo da su nombre. Di qué activo es:"
              : `¿Es este del catálogo? Si no es ninguno, se dará de alta con su ISIN y con precio a mano.`}
          </p>
          <div className="row">
            {activo.sugerencias.map((sugerencia) => (
              <Button key={sugerencia.isin} onClick={() => alDecidir(clave, activoDesdeElCatalogo(sugerencia))} size="sm">
                {sugerencia.nombre} · {sugerencia.isin}
              </Button>
            ))}
            {porDecidir ? (
              <>
                <Button onClick={() => setBuscando(true)} size="sm" variant="quiet">Buscar otro</Button>
                <Button onClick={() => alDecidir(clave, activoPropioPara(activo.citado, cartera.divisaBase))} size="sm" variant="quiet">Crear como activo propio</Button>
              </>
            ) : null}
            <Button onClick={() => alDecidir(clave, "omitir")} size="sm" variant="quiet">Dejar fuera sus movimientos</Button>
          </div>
        </>
      )}
    </div>
  );
}

function nombreDelActivo(clave: string | undefined, revision: Revision, decisiones: ReadonlyMap<string, DecisionSobreUnActivo>): string | undefined {
  if (!clave) return undefined;
  const activo = revision.activos.find((candidato) => candidato.citado.clave === clave);
  const decidido = decisiones.get(clave) ?? activo?.propuesto;
  return decidido && decidido !== "omitir" ? decidido.nombre : activo?.citado.nombre;
}

function FilaDeLinea({ linea, marcada, revision, decisiones, divisaBase, alMarcar }: {
  linea: LineaDeRevision;
  marcada: boolean;
  revision: Revision;
  decisiones: ReadonlyMap<string, DecisionSobreUnActivo>;
  divisaBase: string;
  alMarcar: (marcada: boolean) => void;
}) {
  const movimiento = linea.movimiento ?? linea.propuesto.movimiento;
  const estado = estadoDeLaLinea(linea);
  const activo = nombreDelActivo(linea.propuesto.activo?.clave, revision, decisiones);
  const destino = nombreDelActivo(linea.propuesto.destino?.clave, revision, decisiones);
  const avisos = linea.propuesto.avisos;
  const tipo = nombreDelTipo(movimiento.tipo);
  return (
    <>
      <tr className={avisos.length > 0 ? "gestor-tabla__fila--con-avisos" : undefined}>
        <td className="gestor-tabla__marca">
          <input aria-label={`Importar: ${tipo} del ${escrito.fecha(movimiento.fechaOperacion)}`} checked={marcada} disabled={!seleccionable(linea)} onChange={(evento) => alMarcar(evento.target.checked)} type="checkbox" />
        </td>
        <td className="gestor-tabla__fecha">{escrito.fecha(movimiento.fechaOperacion)}</td>
        <td>{tipo}</td>
        <td>
          {activo ?? <Ausencia clase="no-aplica" />}
          {destino ? <span className="gestor-fila__nota">a {destino}</span> : null}
        </td>
        <td className="gestor-tabla__cifra">{movimiento.titulos ? escrito.titulos(d(movimiento.titulos)) : <Ausencia clase="no-aplica" />}</td>
        <td className="gestor-tabla__cifra">
          {movimiento.importe ? (
            /* El importe de un movimiento va en tinta, con su signo: no es lo que se gana o se pierde. */
            escrito.importeConSigno(aNumero(d(movimiento.importe)), movimiento.divisa ?? divisaBase)
          ) : (
            <Ausencia clase="no-aplica" motivo={movimiento.valor ? "Sin efectivo" : undefined} />
          )}
        </td>
        <td>
          <Distintivo tono={CLASE_DE_LA_GRAVEDAD[estado.gravedad]}>{estado.etiqueta}</Distintivo>
          {estado.detalle ? <span className="gestor-fila__nota">{estado.detalle}</span> : null}
        </td>
      </tr>
      {avisos.length > 0 ? (
        <tr className="gestor-tabla__avisos">
          <td />
          <td colSpan={6}>
            <ul className="gestor-avisos">
              {avisos.map((aviso) => (
                <LineaDeAviso gravedad="aviso" key={aviso}>{aviso}</LineaDeAviso>
              ))}
            </ul>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function PasoRevision({ cartera, resultados, revision, decisiones, marcas, sinCatalogo, alDecidir, alMarcar }: {
  cartera: Cartera;
  resultados: readonly ResultadoDeImportacion[];
  revision: Revision;
  decisiones: ReadonlyMap<string, DecisionSobreUnActivo>;
  marcas: MarcasDeLaRevision;
  /** Si no se ha podido leer el catálogo (o está vacío): se sigue sin él y se dice. */
  sinCatalogo: boolean;
  alDecidir: AlDecidir;
  alMarcar: (ids: string[], marcada: boolean) => void;
}) {
  const [soloMirar, setSoloMirar] = useState(false);
  const [documento, setDocumento] = useState("");

  const errores = erroresDeLosResultados(resultados);
  const avisos = avisosGenerales(resultados);
  const grupos = agruparActivos(revision.activos);
  const idsDeLaCartera = useMemo(() => new Set(cartera.activos.map((activo) => activo.id)), [cartera.activos]);
  const documentos = documentosDeLasLineas(revision);
  const visibles = revision.lineas.filter((linea) => (!soloMirar || hayQueMirar(linea)) && (!documento || linea.propuesto.documento === documento));
  const marcables = visibles.filter(seleccionable);
  const todasMarcadas = marcables.length > 0 && marcables.every((linea) => estaMarcada(linea, marcas));
  const decisionDe = (activo: ActivoPorResolver) => decisiones.get(activo.citado.clave);

  return (
    <div className="stack">
      {errores.length > 0 ? (
        <div className="stack stack--3">
          <ul className="gestor-avisos">
            {errores.map(({ entidad, error }) => (
              <LineaDeAviso gravedad="error" key={`${entidad}-${error}`}>{entidad}: {error}</LineaDeAviso>
            ))}
          </ul>
          <p className="cmp-note">De {errores.length === 1 ? "ese documento" : "esos documentos"} no hay nada que importar hasta que se resuelva.</p>
        </div>
      ) : null}

      <p className="gestor-resumen" role="status">{resumenDeLaRevision(revision)}</p>

      {avisos.length > 0 ? (
        <details className="gestor-plegable">
          <summary>{tituloDeLosAvisos(avisos.length)}</summary>
          <ul className="gestor-avisos">
            {avisos.map((aviso) => (
              <LineaDeAviso gravedad="aviso" key={aviso}>{aviso}</LineaDeAviso>
            ))}
          </ul>
        </details>
      ) : null}

      {revision.activos.length > 0 ? (
        <section aria-labelledby="gestor-importar-activos" className="stack stack--tight">
          <h3 className="gestor-subtitulo" id="gestor-importar-activos">Activos que citan los documentos</h3>
          {sinCatalogo ? <p className="cmp-note">No se ha podido leer el catálogo de activos: los que traen ISIN se darán de alta con precio a mano, y no hay sugerencias por nombre.</p> : null}
          {grupos.porDecidir.map((activo) => (
            <DecisionDeActivo activo={activo} alDecidir={alDecidir} cartera={cartera} decision={decisionDe(activo)} idsDeLaCartera={idsDeLaCartera} key={activo.citado.clave} />
          ))}
          {grupos.nuevosConSugerencias.map((activo) => (
            <DecisionDeActivo activo={activo} alDecidir={alDecidir} cartera={cartera} decision={decisionDe(activo)} idsDeLaCartera={idsDeLaCartera} key={activo.citado.clave} />
          ))}
          {grupos.resueltos.length > 0 ? (
            <div className="rows">
              {grupos.resueltos.map((activo) => (
                <div className="rows__item gestor-fila" key={activo.citado.clave}>
                  <span className="rows__label">
                    {activo.citado.nombre}
                    <span className="gestor-fila__nota">{detalleDelCitado(activo)}</span>
                  </span>
                  <span className="rows__value">
                    {queSeHara(activo, decisionDe(activo), idsDeLaCartera)}
                    {decisionDe(activo) === "omitir" ? (
                      <Button onClick={() => alDecidir(activo.citado.clave, undefined)} size="sm" variant="quiet">Incluirlos</Button>
                    ) : (
                      <Button onClick={() => alDecidir(activo.citado.clave, "omitir")} size="sm" variant="quiet">Dejar fuera</Button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {revision.lineas.length > 0 ? (
        <section aria-labelledby="gestor-importar-movimientos" className="stack stack--tight">
          <h3 className="gestor-subtitulo" id="gestor-importar-movimientos">Movimientos</h3>
          <div className="gestor-filtros">
            <label className="gestor-casilla">
              <input checked={soloMirar} onChange={(evento) => setSoloMirar(evento.target.checked)} type="checkbox" />
              Ver solo lo que hay que mirar
            </label>
            {documentos.length > 1 ? (
              <Campo rotulo="Documento">
                <select onChange={(evento) => setDocumento(evento.target.value)} value={documento}>
                  <option value="">Todos</option>
                  {documentos.map((nombre) => (
                    <option key={nombre} value={nombre}>{nombre}</option>
                  ))}
                </select>
              </Campo>
            ) : null}
          </div>
          {visibles.length === 0 ? (
            <p className="cmp-note">No hay nada que mirar con este filtro.</p>
          ) : (
            <div aria-label="Movimientos por revisar (tabla desplazable)" className="gestor-tabla-envoltorio" role="group" tabIndex={0}>
              <table className="gestor-tabla">
                <thead>
                  <tr>
                    <th className="gestor-tabla__marca">
                      <input
                        aria-label="Marcar todos los que se ven"
                        checked={todasMarcadas}
                        disabled={marcables.length === 0}
                        onChange={(evento) => alMarcar(marcables.map((linea) => linea.propuesto.movimiento.id), evento.target.checked)}
                        type="checkbox"
                      />
                    </th>
                    <th>Fecha</th>
                    <th>Movimiento</th>
                    <th>Activo</th>
                    <th className="gestor-tabla__cifra">Títulos</th>
                    <th className="gestor-tabla__cifra">Efectivo</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((linea) => (
                    <FilaDeLinea
                      alMarcar={(marcada) => alMarcar([linea.propuesto.movimiento.id], marcada)}
                      decisiones={decisiones}
                      divisaBase={cartera.divisaBase}
                      key={linea.propuesto.movimiento.id}
                      linea={linea}
                      marcada={estaMarcada(linea, marcas)}
                      revision={revision}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <p className="cmp-note">Los documentos no traen movimientos. Si traen posiciones, en el paso siguiente se comprueban contra la cartera.</p>
      )}
    </div>
  );
}
