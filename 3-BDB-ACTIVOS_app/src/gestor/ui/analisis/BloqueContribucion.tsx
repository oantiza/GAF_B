/**
 * Bloque 5: qué ha aportado cada posición al resultado del periodo, de dónde le viene
 * (precio, ingresos, divisa) y cuántos puntos de la rentabilidad son suyos. La suma de la
 * columna de contribución es la rentabilidad del periodo: el motor la enlaza día a día.
 */
import { Cifra } from "../../../components/ui/Cifra";
import { Panel } from "../../../components/ui/Panel";
import { TablaDeDatos } from "../../../components/tabla/TablaDeDatos";
import { textoDeAusencia } from "../../../core/textoDeAusencia";
import type { CeldaDeTabla, ColumnaDeTabla } from "../../../types/tablaDeDatos";
import { fechaDeInicioDelPeriodo, type Analisis } from "../../motor/analisis";
import type { Activo } from "../../motor/modelo";
import { listaDeLasSinPrecio } from "../../motor/sinPrecio";
import { escrito } from "../textos";

interface FilaDeContribucion {
  id: string;
  nombre: string;
  apunte?: string;
  /**
   * La posición no tiene precio a la fecha: lo que sale de su valor —el resultado, lo que viene del precio y de la
   * divisa, y la contribución— no se conoce, y se dice que falta (20-11-2026). Lo cobrado y lo pagado sí se dan.
   */
  sinPrecio?: boolean;
  resultado: number;
  /** `null` donde no aplica: el efectivo no tiene variación de precio. */
  precio: number | null;
  ingresos: number;
  divisa: number;
  costes: number;
  contribucion: number;
}

const FALTA: CeldaDeTabla = { texto: textoDeAusencia("falta"), ausencia: "falta" };

/** Una parte del resultado, en euros o en puntos: con su signo y su color. */
function conSigno(valor: number, tipo: "importe" | "puntos", divisa: string): CeldaDeTabla {
  return tipo === "importe"
    ? { texto: escrito.importeConSigno(valor, divisa), valor, nodo: <Cifra colorDeSigno conSigno divisa={divisa} tipo="importe" valor={valor} /> }
    : { texto: escrito.puntos(valor), valor, nodo: <Cifra tipo="puntos" valor={valor} /> };
}

export function BloqueContribucion({ analisis, activos }: { analisis: Analisis; activos: readonly Activo[] }) {
  const desglose = analisis.desglose;
  if (!desglose) return null;
  const divisa = analisis.cartera.divisaBase;
  const enCartera = new Set(analisis.posiciones.map((posicion) => posicion.activo.id));
  const sinPrecio = new Set(analisis.sinPrecio.map((posicion) => posicion.activo.id));
  const nombres = new Map(activos.map((activo) => [activo.id, activo.nombre]));

  const filas: FilaDeContribucion[] = desglose.posiciones.map((posicion) => ({
    id: posicion.activoId,
    nombre: nombres.get(posicion.activoId) ?? posicion.activoId,
    apunte: sinPrecio.has(posicion.activoId) ? "Sin precio" : enCartera.has(posicion.activoId) ? undefined : "Ya no está en la cartera",
    sinPrecio: sinPrecio.has(posicion.activoId),
    resultado: posicion.resultado,
    precio: posicion.precio,
    ingresos: posicion.ingresos,
    divisa: posicion.divisa,
    costes: posicion.costes,
    contribucion: posicion.contribucion
  }));
  const { efectivo } = desglose;
  const hayEfectivo = efectivo.ingresos !== 0 || efectivo.costes !== 0 || efectivo.divisa !== 0;
  if (hayEfectivo) {
    filas.push({
      id: "efectivo-y-comisiones",
      nombre: "Efectivo y comisiones de la cuenta",
      apunte: "Intereses, custodia, asesoramiento y divisa del efectivo",
      resultado: efectivo.resultado,
      precio: null,
      ingresos: efectivo.ingresos,
      divisa: efectivo.divisa,
      costes: efectivo.costes,
      contribucion: efectivo.contribucion
    });
  }
  if (filas.length === 0) return null;
  const hayCostes = filas.some((fila) => Math.abs(fila.costes) >= 0.005);

  const columnas: ColumnaDeTabla<FilaDeContribucion>[] = [
    { id: "posicion", titulo: "Posición", encabezaFila: true, celda: (fila) => ({ texto: fila.nombre, valor: fila.nombre.toLowerCase(), apunte: fila.apunte }) },
    { id: "resultado", titulo: "Resultado", cifra: true, celda: (fila) => (fila.sinPrecio ? FALTA : conSigno(fila.resultado, "importe", divisa)) },
    {
      id: "precio",
      titulo: "De precio",
      cifra: true,
      celda: (fila) => (fila.sinPrecio ? FALTA : fila.precio === null ? { texto: textoDeAusencia("no-aplica"), ausencia: "no-aplica" } : conSigno(fila.precio, "importe", divisa))
    },
    { id: "ingresos", titulo: "De ingresos", cifra: true, celda: (fila) => conSigno(fila.ingresos, "importe", divisa) },
    { id: "divisa", titulo: "De divisa", cifra: true, celda: (fila) => (fila.sinPrecio ? FALTA : conSigno(fila.divisa, "importe", divisa)) },
    ...(hayCostes
      ? [{ id: "costes", titulo: "Costes", cifra: true, celda: (fila: FilaDeContribucion) => conSigno(-fila.costes, "importe", divisa) }]
      : []),
    { id: "contribucion", titulo: "Contribución", cifra: true, celda: (fila) => (fila.sinPrecio ? FALTA : conSigno(fila.contribucion, "puntos", divisa)) }
  ];

  /* El pie con las partes cuadradas al céntimo, como el Resumen y los informes: sumadas, dan el resultado escrito (MOT-10). */
  const cuadrado = desglose.cuadrado;
  const pie = (columna: ColumnaDeTabla<FilaDeContribucion>): CeldaDeTabla | undefined => {
    switch (columna.id) {
      case "resultado":
        return conSigno(cuadrado.resultado, "importe", divisa);
      case "precio":
        return conSigno(cuadrado.precio, "importe", divisa);
      case "ingresos":
        return conSigno(cuadrado.ingresos, "importe", divisa);
      case "divisa":
        return conSigno(cuadrado.divisa, "importe", divisa);
      case "costes":
        return conSigno(-cuadrado.costes, "importe", divisa);
      case "contribucion":
        return conSigno(desglose.contribucionTotal, "puntos", divisa);
      default:
        return undefined;
    }
  };

  return (
    <Panel claseDelCuerpo="stack stack--tight" subtitulo={`Del ${escrito.fecha(fechaDeInicioDelPeriodo(analisis))} al ${escrito.fecha(analisis.periodo.hasta)}, en ${divisa}`} titulo="Contribución de cada posición">
      <TablaDeDatos columnas={columnas} deActivos filas={filas} pie={pie} rotuloDelPie="Toda la cartera" titulo="Contribución de cada posición al resultado y a la rentabilidad" />
      <p className="cmp-note">
        La contribución son los puntos de la rentabilidad de la cartera que ha aportado cada posición, según lo que pesaba cada día: sumadas, dan la rentabilidad del periodo.
      </p>
      {sinPrecio.size > 0 ? (
        <p className="cmp-note">
          {listaDeLasSinPrecio(analisis)} no {sinPrecio.size === 1 ? "tiene" : "tienen"} precio: su resultado y su contribución no se conocen. La fila de toda la cartera {sinPrecio.size === 1 ? "la" : "las"} cuenta como cero, y por eso las demás filas no suman lo que dice.
        </p>
      ) : null}
    </Panel>
  );
}
