/**
 * El resumen de una cartera de cliente: lo primero que se ve bajo la respuesta (cuánto vale y
 * cuánto ha ganado, que va encima de las pestañas). Como la maqueta `cartera-de-cliente.png`:
 *
 *   - si hay algo que revisar, primero, con su enlace a «Comprobaciones»;
 *   - a la izquierda, la evolución del patrimonio y los últimos movimientos;
 *   - a la derecha, de dónde viene el resultado y en qué está invertida.
 *
 * Todo lo demás está a un clic, en las otras pestañas.
 */
import { useMemo } from "react";
import { useModoCliente } from "../../../app/ClientModeContext";
import { OaaLineChart, type OaaLineSeries } from "../../../charts/oaa";
import { EmptyState } from "../../../components/ui/AsyncState";
import { Button } from "../../../components/ui/Button";
import { Cifra } from "../../../components/ui/Cifra";
import { ListaDePartes } from "../../../components/ui/ListaDePartes";
import { Panel } from "../../../components/ui/Panel";
import { TablaDeDatos } from "../../../components/tabla/TablaDeDatos";
import { NOTA_DEL_REPARTO_NETO, tieneCortosOApalancamiento } from "../../../core/repartoNeto";
import { textoDeAusencia } from "../../../core/textoDeAusencia";
import type { ColumnaDeTabla } from "../../../types/tablaDeDatos";
import { fechaDeInicioDelPeriodo } from "../../motor/analisis";
import { LIQUIDEZ } from "../../motor/composicion";
import { aNumero, d } from "../../motor/decimal";
import { ordenarMovimientos } from "../../motor/libro";
import { activoDe, type Cartera, type Movimiento } from "../../motor/modelo";
import { nombreDelTipo } from "../../motor/movimientos/registro";
import { notaDeLasSinPrecio } from "../../motor/sinPrecio";
import { colorDeLaParteDeClase } from "../analisis/lectura";
import { FilaDeDato, LineaDeAviso, NotaDeLoContadoComoCero } from "../piezas";
import { aclarar, escrito } from "../textos";
import type { DatosDeVista } from "../tipos";

interface FilaDeUltimo {
  id: string;
  movimiento: Movimiento;
}

/** Los últimos movimientos, como en el libro. El importe va en tinta, con su signo: una aportación no es una ganancia. */
function columnasDeUltimos(cartera: Cartera, conNotas: boolean): ColumnaDeTabla<FilaDeUltimo>[] {
  const base = cartera.divisaBase;
  return [
    { id: "fecha", titulo: "Fecha", encabezaFila: true, celda: ({ movimiento }) => ({ texto: escrito.fecha(movimiento.fechaOperacion), valor: movimiento.fechaOperacion }) },
    { id: "tipo", titulo: "Movimiento", celda: ({ movimiento }) => ({ texto: nombreDelTipo(movimiento.tipo) }) },
    {
      id: "activo",
      titulo: "Activo",
      celda: ({ movimiento }) => {
        const activo = activoDe(cartera, movimiento.activoId)?.nombre;
        const destino = activoDe(cartera, movimiento.destino?.activoId)?.nombre;
        if (activo) return { texto: activo, apunte: destino ? `a ${destino}` : undefined };
        /* La nota del asesor, solo fuera de Modo cliente (`SE_OCULTA.notasDelAsesor`). */
        return conNotas && movimiento.nota ? { texto: movimiento.nota } : { texto: textoDeAusencia("no-aplica"), ausencia: "no-aplica" };
      }
    },
    { id: "titulos", titulo: "Títulos", cifra: true, celda: ({ movimiento }) => (movimiento.titulos ? { texto: escrito.titulos(d(movimiento.titulos)), valor: aNumero(d(movimiento.titulos)) } : { texto: textoDeAusencia("no-aplica"), ausencia: "no-aplica" }) },
    {
      id: "importe",
      titulo: "Importe",
      cifra: true,
      celda: ({ movimiento }) => {
        if (movimiento.importe) {
          const valor = aNumero(d(movimiento.importe));
          return { texto: escrito.importeConSigno(valor, movimiento.divisa ?? base), valor };
        }
        if (movimiento.valor) return { texto: escrito.importe(aNumero(d(movimiento.valor)), movimiento.divisa ?? base), apunte: "No pasa por el efectivo" };
        return { texto: textoDeAusencia("no-aplica"), ausencia: "no-aplica" };
      }
    }
  ];
}

export function VistaResumen({ datos }: { datos: DatosDeVista }) {
  const { analisis, abierta } = datos;
  const { cartera } = abierta;
  const divisa = cartera.divisaBase;
  const rentabilidad = analisis.rentabilidad;
  const desglose = analisis.desglose?.cuadrado;
  const seVenLasNotas = useModoCliente().seEnsena("notasDelAsesor");

  const evolucion = useMemo<OaaLineSeries[]>(() => {
    const puntos = aclarar(analisis.evolucion);
    if (puntos.length < 2) return [];
    return [
      { id: "valor", label: "Patrimonio", papel: "cartera", values: puntos.map((punto) => ({ date: punto.fecha, value: punto.valor })) },
      { id: "aportado", label: "Aportado", papel: "referencia", values: puntos.map((punto) => ({ date: punto.fecha, value: punto.aportado })) }
    ];
  }, [analisis.evolucion]);

  const ultimos = useMemo<FilaDeUltimo[]>(
    () =>
      ordenarMovimientos(cartera.movimientos)
        .filter((movimiento) => movimiento.fechaOperacion <= datos.hoy)
        .slice(-8)
        .reverse()
        .map((movimiento) => ({ id: movimiento.id, movimiento })),
    [cartera.movimientos, datos.hoy]
  );

  if (cartera.movimientos.length === 0) {
    return (
      <EmptyState
        action={
          <div className="row">
            <Button onClick={() => datos.nuevoMovimiento({ tipo: "aportacion" })} variant="primary">Añadir el primer movimiento</Button>
          </div>
        }
        description="Empieza por la aportación inicial del cliente y sus primeras compras, o usa «Importar extractos» para cargar los extractos del banco. En cuanto haya un movimiento verás aquí cuánto vale la cartera, cuánto ha ganado y en qué está invertida."
        title="Esta cartera aún no tiene movimientos"
      />
    );
  }

  const avisos = analisis.integridad.avisos.filter((aviso) => aviso.gravedad !== "nota");
  const avisosDeMercado = datos.mercado.mercado.avisos;
  /* Se cuentan todos los que hay (GES-19), y se dice cuántos no caben en el panel. */
  const totalDeAvisos = avisos.length + avisosDeMercado.length;
  const sinEnsenar = Math.max(0, avisos.length - 4) + Math.max(0, avisosDeMercado.length - 2);
  const clases = analisis.composicion.porClaseDeActivo.lineas;
  const principales = analisis.posiciones.slice(0, 5);
  const noIncluye = notaDeLasSinPrecio(analisis, "El reparto");
  const periodo = escrito.periodo(fechaDeInicioDelPeriodo(analisis), analisis.periodo.hasta);
  const verComprobaciones = () => datos.irA("analisis", "comprobaciones");

  return (
    <div className="stack stack--bloques">
      {totalDeAvisos > 0 ? (
        <Panel
          acciones={<Button onClick={verComprobaciones} size="sm" variant="quiet">Ver las comprobaciones</Button>}
          claseDelCuerpo="stack stack--tight"
          subtitulo="Antes de fiarte de las cifras"
          titulo={totalDeAvisos === 1 ? "Una cosa que revisar" : `${totalDeAvisos} cosas que revisar`}
        >
          <ul className="gestor-avisos">
            {avisos.slice(0, 4).map((aviso, indice) => (
              <LineaDeAviso gravedad={aviso.gravedad} key={`${aviso.codigo}-${indice}`}>{aviso.mensaje}</LineaDeAviso>
            ))}
            {avisosDeMercado.slice(0, 2).map((aviso) => (
              <LineaDeAviso gravedad="aviso" key={aviso}>{aviso}</LineaDeAviso>
            ))}
          </ul>
          {sinEnsenar > 0 ? <p className="cmp-note">{sinEnsenar === 1 ? "Y una más: está en «Comprobaciones»." : `Y ${sinEnsenar} más: están en «Comprobaciones».`}</p> : null}
        </Panel>
      ) : null}

      <div className="gestor-rejilla">
        {evolucion.length > 0 ? (
          <Panel className="gestor-rejilla__ancha" claseDelCuerpo="stack stack--tight" subtitulo={`La distancia entre las dos líneas es lo ganado o perdido · ${periodo}`} titulo="Evolución del patrimonio">
            <OaaLineChart
              ariaLabel="Evolución del patrimonio de la cartera frente al dinero aportado"
              height={280}
              series={evolucion}
              yAxisWidth={76}
              yFormatter={(valor) => (typeof valor === "number" ? escrito.importeTitular(valor, divisa) : "")}
            />
            {/* La línea del patrimonio es la serie del valor: una posición sin precio vale cero en ella, y se dice. */}
            <NotaDeLoContadoComoCero analisis={analisis} />
          </Panel>
        ) : null}

        {rentabilidad && desglose ? (
          <Panel
            acciones={<Button onClick={() => datos.irA("analisis", "composicion")} size="sm" variant="quiet">Ver el análisis</Button>}
            className="gestor-rejilla__estrecha"
            claseDelCuerpo="stack stack--tight"
            subtitulo="Las partes suman el resultado del periodo"
            titulo="De dónde viene el resultado"
          >
            <div className="rows">
              <FilaDeDato nota="Lo que han subido o bajado los precios, ya descontadas las comisiones de compras y ventas" rotulo="Variación de precio">
                <Cifra colorDeSigno conSigno divisa={divisa} tipo="importe" valor={desglose.precio} />
              </FilaDeDato>
              <FilaDeDato nota="Dividendos, cupones e intereses de la cuenta cobrados" rotulo="Ingresos netos de retención">
                <Cifra colorDeSigno conSigno divisa={divisa} tipo="importe" valor={desglose.ingresos} />
              </FilaDeDato>
              <FilaDeDato nota="Lo que ha movido el tipo de cambio" rotulo="Efecto de la divisa">
                <Cifra colorDeSigno conSigno divisa={divisa} tipo="importe" valor={desglose.divisa} />
              </FilaDeDato>
              {desglose.costes !== 0 ? (
                <FilaDeDato nota="Custodia, asesoramiento, otros cargos e impuestos apuntados en la cuenta" rotulo="Costes e impuestos de la cuenta">
                  <Cifra colorDeSigno conSigno divisa={divisa} tipo="importe" valor={-desglose.costes} />
                </FilaDeDato>
              ) : null}
              <FilaDeDato rotulo="Resultado" total>
                <Cifra colorDeSigno conSigno divisa={divisa} tipo="importe" valor={desglose.resultado} />
              </FilaDeDato>
            </div>
            <NotaDeLoContadoComoCero analisis={analisis} />
          </Panel>
        ) : null}

        <Panel
          acciones={<Button onClick={() => datos.irA("movimientos")} size="sm" variant="quiet">Ver todos</Button>}
          className="gestor-rejilla__ancha"
          claseDelCuerpo="stack stack--tight"
          subtitulo={`${cartera.movimientos.length} ${cartera.movimientos.length === 1 ? "movimiento" : "movimientos"} en el libro`}
          titulo="Últimos movimientos"
        >
          <TablaDeDatos columnas={columnasDeUltimos(cartera, seVenLasNotas)} filas={ultimos} titulo="Últimos movimientos de la cartera" />
          <p className="cmp-note">El importe de un movimiento es dinero que entra o sale de la cuenta, y va sin color: el verde y el rojo se reservan para lo que se gana o se pierde.</p>
        </Panel>

        <Panel
          acciones={<Button onClick={() => datos.irA("cuentas")} size="sm" variant="quiet">Ver las cuentas</Button>}
          className="gestor-rejilla__estrecha"
          claseDelCuerpo="stack stack--tight"
          subtitulo={`A ${escrito.fecha(analisis.fecha)} · mirando dentro de cada fondo`}
          titulo="En qué está invertida"
        >
          <ListaDePartes
            etiqueta="Por clase de activo"
            /* Cada clase, con su color de toda la aplicación; «Otros» y «Sin clasificar», apagados (14-11-2026). */
            partes={clases.map((linea) => ({
              nombre: linea.nombre,
              fraccion: linea.peso,
              ...colorDeLaParteDeClase(linea.nombre),
              apunte: linea.nombre === LIQUIDEZ ? `${escrito.importeTitular(linea.valor, divisa)} · incluye la liquidez que mantienen los fondos` : escrito.importeTitular(linea.valor, divisa)
            }))}
          />
          {principales.length > 0 ? (
            <>
              <h3 className="gestor-subtitulo">Principales posiciones</h3>
              <ListaDePartes
                etiqueta="Principales posiciones"
                /* La que no tiene precio no tiene peso ni valor que dar: su peso dice que falta, y su apunte, por qué. */
                partes={principales.map((posicion) => ({ nombre: posicion.activo.nombre, fraccion: posicion.peso, apunte: posicion.valor === null ? "Sin precio" : escrito.importeTitular(posicion.valor, divisa) }))}
              />
            </>
          ) : null}
          {/* El reparto por clase es de lo que se puede valorar, como el de Análisis: una posición sin precio no entra. */}
          {noIncluye ? <p className="cmp-note">{noIncluye}</p> : null}
          {/* C-29: con un fondo de reparto neto dentro, una clase puede salir en negativo o pasar del 100 %. */}
          {tieneCortosOApalancamiento(clases.map((linea) => linea.peso)) ? <p className="cmp-note">{NOTA_DEL_REPARTO_NETO}</p> : null}
        </Panel>
      </div>
    </div>
  );
}
