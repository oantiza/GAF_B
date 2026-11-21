/**
 * Comparar la cartera abierta con hasta tres más: otras del gestor y carteras de Diseño, en
 * el MISMO periodo y con el MISMO motor. Las del gestor se miden con sus movimientos reales;
 * las de Diseño se simulan comprando sus pesos el primer día (`comparar/calcular.ts`).
 *
 * Y el camino de vuelta: llevar las posiciones de esta cartera a una propuesta nueva en Diseño.
 */
import { useMemo, useState } from "react";
import { useModoCliente } from "../../../app/ClientModeContext";
import { OaaLineChart, type OaaLineSeries } from "../../../charts/oaa";
import { EmptyState } from "../../../components/ui/AsyncState";
import { Button } from "../../../components/ui/Button";
import { Panel } from "../../../components/ui/Panel";
import type { PositionsPortfolioTransfer } from "../../../core/positionsToPortfolio";
import { hayAccesoACarpetas } from "../../almacen/acceso";
import { esDemostracion } from "../../demo/carteraDemo";
import { fechaDeInicioDelPeriodo } from "../../motor/analisis";
import { notaDeLoContadoComoCero } from "../../motor/sinPrecio";
import { HAY_PLATAFORMA } from "../../mercado/plataforma";
import { capitalDeReferencia, type Candidata } from "../comparar/calcular";
import { CandidatasDeDiseno } from "../comparar/CandidatasDeDiseno";
import { CasillaDeCandidata } from "../comparar/CasillaDeCandidata";
import { LlevarADiseno } from "../comparar/LlevarADiseno";
import { notasDeLaComparada } from "../comparar/notas";
import { TablaComparada, type ColumnaDeComparacion } from "../comparar/TablaComparada";
import { useCarterasDelGestor, useComparacion } from "../comparar/useComparacion";
import { LineaDeAviso } from "../piezas";
import { aclarar, escrito } from "../textos";
import type { DatosDeVista } from "../tipos";
import "../../../styles/gestor-analisis.css";

/** Cuántas carteras se pueden poner al lado de la abierta. */
const MAXIMO = 3;

export function VistaComparar({ datos, onSendToBuilder }: { datos: DatosDeVista; onSendToBuilder?: (cartera: PositionsPortfolioTransfer) => void }) {
  const { analisis, abierta, almacen, hoy } = datos;
  const { cartera } = abierta;
  const demo = esDemostracion(cartera);
  const divisa = cartera.divisaBase;
  const [elegidas, setElegidas] = useState<Candidata[]>([]);
  const claves = useMemo(() => new Set(elegidas.map((candidata) => candidata.clave)), [elegidas]);
  const lleno = elegidas.length >= MAXIMO;

  const delGestor = useCarterasDelGestor(almacen, { id: cartera.id, fichero: abierta.fichero });
  /* GES-08: en Modo cliente no se ofrecen las carteras de otros clientes (decisión 19). Las ya elegidas siguen a la
     vista, como A y B en Comparar carteras de Diseño, para poder quitarlas. */
  const { seEnsena } = useModoCliente();
  const seVenLasDemas = seEnsena("otrasCarteras");
  const delGestorALaVista =
    delGestor.estado === "listo" ? delGestor.carteras.filter((resumen) => seVenLasDemas || claves.has(`gestor:${resumen.fichero}`)) : [];
  const { estadoDe, reintentar } = useComparacion(elegidas, {
    desde: analisis.periodo.desde,
    hasta: analisis.periodo.hasta,
    hoy,
    divisaBase: divisa,
    capital: capitalDeReferencia(analisis),
    almacen
  });

  const alternar = (candidata: Candidata) =>
    setElegidas((actuales) =>
      actuales.some((actual) => actual.clave === candidata.clave)
        ? actuales.filter((actual) => actual.clave !== candidata.clave)
        : actuales.length >= MAXIMO
          ? actuales
          : [...actuales, candidata]
    );

  const columnas: ColumnaDeComparacion[] = [
    { clave: "abierta", nombre: cartera.nombre, apunte: "Esta cartera", estado: "listo", analisis },
    ...elegidas.map((candidata): ColumnaDeComparacion => {
      const calculo = estadoDe(candidata);
      return {
        clave: candidata.clave,
        nombre: candidata.nombre,
        apunte: candidata.clase === "gestor" ? "Cartera de cliente" : "Propuesta de Diseño, simulada",
        estado: calculo.estado,
        analisis: calculo.estado === "listo" ? calculo.comparada.analisis : undefined
      };
    })
  ];

  /* Cuatro series como mucho, y cada una aclarada a unos cuatrocientos puntos: no hace falta memorizarlas. La abierta es
     la cartera (marino); las demás, series en su orden. */
  const series: OaaLineSeries[] = columnas
    .filter((columna) => columna.analisis && columna.analisis.serie.length > 1)
    .map((columna) => ({
      id: columna.clave,
      label: columna.nombre,
      papel: columna.clave === "abierta" ? "cartera" : "serie",
      values: aclarar(columna.analisis!.serie).map((punto) => ({ date: punto.fecha, value: punto.valor }))
    }));

  if (cartera.movimientos.length === 0 || analisis.vacia || !analisis.rentabilidad) {
    return (
      <EmptyState
        description="Para comparar hace falta que la cartera tenga historia en el periodo elegido. Cuando la tenga, podrás ponerla al lado de otras carteras de clientes y de las propuestas de Diseño, con las mismas cifras."
        title="Nada que comparar todavía"
      />
    );
  }

  const periodo = `Del ${escrito.fecha(fechaDeInicioDelPeriodo(analisis))} al ${escrito.fecha(analisis.periodo.hasta)}`;
  const comoCero = notaDeLoContadoComoCero(analisis, { quien: "Esta cartera" });
  const notas = elegidas.flatMap((candidata): Array<{ candidata: Candidata; gravedad: "aviso" | "nota"; texto: string }> => {
    const calculo = estadoDe(candidata);
    if (calculo.estado === "error") return [{ candidata, gravedad: "aviso", texto: `«${candidata.nombre}»: no se ha podido calcular. ${calculo.mensaje}` }];
    if (calculo.estado === "listo") return notasDeLaComparada(calculo.comparada, divisa).map((texto) => ({ candidata, gravedad: "nota", texto }));
    return [];
  });

  return (
    <div className="stack stack--bloques">
      <Panel estado={<span className="gestor-calculando">{elegidas.length} de {MAXIMO} elegidas</span>} subtitulo={`Hasta ${MAXIMO}, en el mismo periodo que esta cartera: ${periodo.toLowerCase()}`} titulo="Con qué carteras comparar">
        <div className="gestor-columnas">
          <fieldset className="gestor-grupo">
            <legend className="gestor-subtitulo">Carteras de clientes</legend>
            {delGestor.estado === "sin-carpeta" ? (
              <p className="cmp-note">
                {hayAccesoACarpetas()
                  ? "No hay una carpeta de carteras abierta. Elígela en «Carteras de clientes» para comparar con las demás carteras guardadas."
                  : "Este navegador no deja abrir una carpeta de carteras, así que no se puede comparar con otras carteras guardadas. Las propuestas de Diseño sí se pueden comparar."}
              </p>
            ) : delGestor.estado === "cargando" ? (
              <p className="cmp-note" role="status">Leyendo la carpeta…</p>
            ) : delGestor.estado === "error" ? (
              <p className="cmp-note">No se ha podido leer la carpeta de carteras: {delGestor.mensaje}</p>
            ) : delGestor.carteras.length === 0 ? (
              <p className="cmp-note">No hay otras carteras en la carpeta.</p>
            ) : delGestorALaVista.length === 0 ? (
              <p className="cmp-note">Sal de Modo cliente para ver otras carteras.</p>
            ) : (
              <>
                <ul className="gestor-candidatas">
                {delGestorALaVista.map((resumen) => {
                  const candidata: Candidata = { clase: "gestor", clave: `gestor:${resumen.fichero}`, nombre: resumen.nombre, fichero: resumen.fichero };
                  const elegida = claves.has(candidata.clave);
                  return (
                    <CasillaDeCandidata
                      alCambiar={() => alternar(candidata)}
                      detalle={resumen.error ?? [resumen.cliente, `${resumen.movimientos} movimientos`].filter(Boolean).join(" · ")}
                      elegida={elegida}
                      inhabilitada={Boolean(resumen.error) || (lleno && !elegida)}
                      key={candidata.clave}
                      nombre={resumen.nombre}
                    />
                  );
                })}
                </ul>
                {!seVenLasDemas ? <p className="cmp-note">Sal de Modo cliente para ver otras carteras.</p> : null}
              </>
            )}
          </fieldset>
          <fieldset className="gestor-grupo">
            <legend className="gestor-subtitulo">Propuestas de Diseño</legend>
            {demo ? (
              <p className="cmp-note">
                Esta es la cartera de demostración, con precios inventados: solo se compara con otras carteras de clientes. Las propuestas de Diseño se simulan con los precios de la plataforma, y no se mezclan con los de la demostración.
              </p>
            ) : !HAY_PLATAFORMA ? (
              <p className="cmp-note">Esta instalación no tiene conexión con la plataforma de datos: las propuestas de Diseño no se pueden simular.</p>
            ) : (
              <CandidatasDeDiseno alternar={alternar} elegidas={claves} lleno={lleno} soloLasElegidas={!seVenLasDemas} />
            )}
          </fieldset>
        </div>
      </Panel>

      <Panel claseDelCuerpo="stack stack--tight" subtitulo={`${periodo} · las mismas cifras, calculadas igual para todas`} titulo="Comparación">
        <TablaComparada columnas={columnas} />
        {elegidas.length === 0 ? <p className="cmp-note">Elige arriba hasta {MAXIMO} carteras para ponerlas al lado de esta.</p> : null}
        {/* La columna de esta cartera sale de la serie del valor: una posición sin precio vale cero en ella, y se dice.
            Las de las carteras comparadas lo dicen en sus notas (`notasDeLaComparada`). */}
        {comoCero ? <p className="cmp-note">{comoCero}</p> : null}
        {notas.length > 0 ? (
          <ul className="gestor-avisos">
            {notas.map((nota) => (
              <LineaDeAviso
                accion={nota.gravedad === "aviso" ? <Button onClick={() => reintentar(nota.candidata)} size="sm">Reintentar</Button> : undefined}
                gravedad={nota.gravedad}
                key={`${nota.candidata.clave}-${nota.texto}`}
              >
                {nota.texto}
              </LineaDeAviso>
            ))}
          </ul>
        ) : null}
        <p className="cmp-note">
          Las carteras de clientes se miden con sus movimientos reales.{" "}
          {!demo
            ? "Una propuesta de Diseño se simula comprando sus pesos el primer día del periodo, sin reequilibrar, sin aportaciones y sin comisiones: por eso de ella se comparan la rentabilidad y el riesgo, no los euros."
            : ""}
        </p>
      </Panel>

      {series.length > 1 ? (
        <Panel subtitulo={`En base 100 desde el ${escrito.fecha(fechaDeInicioDelPeriodo(analisis))}`} titulo="Evolución comparada">
          <OaaLineChart ariaLabel="Evolución de las carteras comparadas, en base 100" height={300} series={series} />
        </Panel>
      ) : null}

      <LlevarADiseno analisis={analisis} onSendToBuilder={onSendToBuilder} />
    </div>
  );
}
