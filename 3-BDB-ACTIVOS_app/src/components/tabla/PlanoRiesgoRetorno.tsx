import { useMemo } from "react";
import { anchoDelTexto, decimalesDeLasMarcas, marcasDelEje } from "../../core/escalaDelPlano";
import { oFalta, porcentaje, rentabilidad } from "../../core/formato";
import { nombreDelMetodoEnPantalla as nombreDelMetodo } from "../../core/metodoEnPantalla";
import type { ColumnaComparada } from "./TablaComparativa";
/* La pieza trae su hoja: si la pidiera cada pantalla, una que la olvide la pinta sin estilo. */
import "../../styles/tabla.css";

/**
 * El plano riesgo-retorno: volatilidad en X, rentabilidad en Y.
 *
 * ── POR QUÉ ES UN PANEL POR MÉTODO Y NO UN PLANO CON CINCO COLORES ──────────
 *
 * Dos decisiones, y las dos salen de medir, no de gusto.
 *
 * **Un panel por método.** Los ejes de este plano SON las cifras cuya escala no se
 * puede mezclar. Poner en el mismo plano un punto calculado sobre meses y otro sobre
 * días es afirmar que están en el mismo sistema de coordenadas, y no lo están. En la
 * tabla eso se resolvía agrupando filas; aquí se resuelve con paneles: cada uno tiene
 * sus ejes y dentro de él la comparación es legítima.
 *
 * **Un solo color e identidad escrita en cada punto.** La paleta de series del proyecto
 * se pasó por el validador de la guía de gráficos sobre el papel de esta dirección: con
 * tres series distingue bien, pero **con cinco falla el suelo de visión normal** —el
 * peor par adyacente queda en ΔE 14,8 sobre 15, «difíciles de distinguir incluso con
 * visión cromática completa»—. Son colores sobrios y de croma bajo, que es lo que el
 * proyecto quiere; lo que no se puede es pedirles que identifiquen cinco cosas a la
 * vez. Con la etiqueta pegada al punto, el color no tiene que identificar nada.
 *
 * ── CÓMO SE LEE DESDE EL 04-11-2026 ─────────────────────────────────────────
 *
 * Cada panel dice su escala, con marcas de valor en los dos ejes: cada uno se ajusta a sus
 * puntos, y sin números un +25 % y un +16 % salían a la misma altura en paneles contiguos.
 *
 * Junto al punto van el nombre entero y sus dos cifras **si caben**; si no, el número del activo,
 * el mismo de la evolución y de la matriz de correlación, y debajo la lista con el nombre entero.
 * Nunca un nombre cortado: el final es lo que distingue una clase de otra.
 *
 * Y un panel con un solo punto no dibuja plano. Sin nada al lado, su posición no significaría nada.
 */

/**
 * La ventana que se dibuja. Era «1 año» escrito a mano en tres sitios, y el 03-11-2026
 * esta pieza entró en el comparador, que compara a TRES. Un gráfico rotulado con una
 * ventana que no es la suya no es un detalle de copia: es una cifra mal nombrada.
 */
export type VentanaDelPlano = "1 año" | "3 años" | "5 años" | "10 años";

export interface PuntoDelPlano {
  id: string;
  nombre: string;
  /** El método con que se calcularon sus dos cifras. */
  metodo?: string;
  volatilidad: number | undefined;
  rentabilidad: number | undefined;
}

type PuntoDibujable = PuntoDelPlano & { volatilidad: number; rentabilidad: number };

const ANCHO = 420;
const ALTO = 300;
const MARGEN = { arriba: 16, derecha: 20, abajo: 46, izquierda: 62 };
/** Lo que separa la primera y la última marca del borde: ningún punto se pega a un eje. */
const HOLGURA = 10;
/** Del punto a su etiqueta. */
const SEPARACION = 11;
/** Lo que ocupa en vertical una etiqueta de dos líneas, respecto a su punto. */
const ETIQUETA = { arriba: 12, abajo: 15 };

/* La rentabilidad, con su signo; la volatilidad, sin él (apartado 6 de SISTEMA_DISENO.md). */
const conSigno = (valor: number) => oFalta(rentabilidad(valor));
const volatilidadDe = (valor: number) => oFalta(porcentaje(valor));
/* Las marcas de los ejes, con los decimales que piden sus pasos y sin «+»: son una escala, no una cifra. */
const marcaDelEje = (valor: number, decimales: number) => oFalta(porcentaje(valor, { decimales }));
const cifrasDe = (punto: PuntoDibujable) => `vol. ${volatilidadDe(punto.volatilidad)} · ${conSigno(punto.rentabilidad)}`;

function escalaEntre(marcas: readonly number[], desde: number, hasta: number) {
  const [primera, ultima] = [marcas[0], marcas[marcas.length - 1]];
  return (valor: number) => desde + ((valor - primera) / (ultima - primera || 1)) * (hasta - desde);
}

/** Lo que ocupa la etiqueta de un punto a un lado u otro. */
function hueco(cx: number, cy: number, ancho: number, lado: "derecha" | "izquierda") {
  const x0 = lado === "derecha" ? cx + SEPARACION : cx - SEPARACION - ancho;
  return { x0, x1: x0 + ancho, y0: cy - ETIQUETA.arriba, y1: cy + ETIQUETA.abajo };
}

function Panel({
  metodo,
  puntos,
  ventana,
  numeroDe,
  motivoDelSolo
}: {
  metodo: string | undefined;
  puntos: PuntoDelPlano[];
  ventana: VentanaDelPlano;
  numeroDe: (id: string) => number;
  /** Por qué un punto solo no se sitúa frente a los demás: que el método sea otro no siempre es cierto. */
  motivoDelSolo: string;
}) {
  const dibujables = useMemo(
    () =>
      puntos.filter(
        (punto): punto is PuntoDibujable => punto.volatilidad !== undefined && punto.rentabilidad !== undefined
      ),
    [puntos]
  );

  const dibujo = useMemo(() => {
    if (dibujables.length < 2) return null;
    const marcasX = marcasDelEje(dibujables.map((punto) => punto.volatilidad));
    /* El cero entra siempre en el eje de rentabilidad: un plano de rentabilidades que
       no enseña dónde está el cero deja «perder menos» con la misma pinta que «ganar». */
    const marcasY = marcasDelEje(dibujables.map((punto) => punto.rentabilidad), { conCero: true });
    const x = escalaEntre(marcasX, MARGEN.izquierda + HOLGURA, ANCHO - MARGEN.derecha - HOLGURA);
    const y = escalaEntre(marcasY, ALTO - MARGEN.abajo - HOLGURA, MARGEN.arriba + HOLGURA);

    const colocados = dibujables.map((punto) => {
      const [cx, cy] = [x(punto.volatilidad), y(punto.rentabilidad)];
      const ancho = Math.max(anchoDelTexto(punto.nombre), anchoDelTexto(cifrasDe(punto)));
      const lado: "derecha" | "izquierda" | null =
        cx + SEPARACION + ancho <= ANCHO - MARGEN.derecha
          ? "derecha"
          : cx - SEPARACION - ancho >= MARGEN.izquierda
            ? "izquierda"
            : null;
      return { punto, cx, cy, ancho, lado };
    });
    /* El nombre entero va junto al punto solo si caben todos sin pisarse; si uno no cabe, todos
       llevan su número: dos formas de identificar en un mismo plano se leerían como dos cosas. */
    const huecos = colocados.map(({ cx, cy, ancho, lado }) => (lado ? hueco(cx, cy, ancho, lado) : null));
    const caben = huecos.every((uno, indice) =>
      uno
        ? colocados.every(({ cx, cy }, otroIndice) => {
            if (otroIndice === indice) return true;
            const otro = huecos[otroIndice];
            const pisaSuEtiqueta =
              otro !== null && uno.x0 < otro.x1 && otro.x0 < uno.x1 && uno.y0 < otro.y1 && otro.y0 < uno.y1;
            const pisaSuPunto = uno.x0 - 6 < cx && cx < uno.x1 + 6 && uno.y0 - 6 < cy && cy < uno.y1 + 6;
            return !pisaSuEtiqueta && !pisaSuPunto;
          })
        : false
    );
    return { marcasX, marcasY, x, y, colocados, caben };
  }, [dibujables]);

  const titulo = (cuantos: number) => (
    <figcaption className="plano__titulo">
      {nombreDelMetodo(metodo)}
      <span>
        {cuantos} {cuantos === 1 ? "activo" : "activos"}
      </span>
    </figcaption>
  );

  if (dibujables.length === 0) {
    return (
      <figure className="plano">
        <figcaption className="plano__titulo">{nombreDelMetodo(metodo)}</figcaption>
        <p className="plano__vacio">Ninguno de estos activos tiene las dos cifras.</p>
      </figure>
    );
  }

  if (dibujo === null) {
    const [solo] = dibujables;
    return (
      <figure className="plano">
        {titulo(1)}
        <p className="plano__solo">
          <b>{solo.nombre}</b>
          <span className="plano__solo-cifras">
            Volatilidad {ventana} {volatilidadDe(solo.volatilidad)} · Rentabilidad {ventana} {conSigno(solo.rentabilidad)}
          </span>
        </p>
        <p className="plano__vacio">{motivoDelSolo}</p>
      </figure>
    );
  }

  const { marcasX, marcasY, x, y, colocados, caben } = dibujo;
  const decimalesX = decimalesDeLasMarcas(marcasX);
  const decimalesY = decimalesDeLasMarcas(marcasY);
  const abajoDelEje = ALTO - MARGEN.abajo;

  return (
    <figure className="plano">
      {titulo(dibujables.length)}
      <svg
        aria-label={`Riesgo y rentabilidad a ${ventana}, ${nombreDelMetodo(metodo)}. ${dibujables
          .map((punto) => `${punto.nombre}: volatilidad ${volatilidadDe(punto.volatilidad)}, rentabilidad ${conSigno(punto.rentabilidad)}`)
          .join("; ")}.`}
        className="plano__lienzo"
        role="img"
        viewBox={`0 0 ${ANCHO} ${ALTO}`}
      >
        {/* Ejes recesivos: el dato manda, la rejilla acompaña. */}
        {marcasX.map((marca) => (
          <g key={`x${marca}`}>
            <line className="plano__rejilla" x1={x(marca)} x2={x(marca)} y1={MARGEN.arriba} y2={abajoDelEje} />
            <line className="plano__eje" x1={x(marca)} x2={x(marca)} y1={abajoDelEje} y2={abajoDelEje + 4} />
            <text className="plano__marca-eje" textAnchor="middle" x={x(marca)} y={abajoDelEje + 16}>
              {marcaDelEje(marca, decimalesX)}
            </text>
          </g>
        ))}
        {marcasY.map((marca) => (
          <g key={`y${marca}`}>
            {marca !== 0 ? (
              <line
                className="plano__rejilla"
                x1={MARGEN.izquierda}
                x2={ANCHO - MARGEN.derecha}
                y1={y(marca)}
                y2={y(marca)}
              />
            ) : null}
            <line className="plano__eje" x1={MARGEN.izquierda - 4} x2={MARGEN.izquierda} y1={y(marca)} y2={y(marca)} />
            <text className="plano__marca-eje" textAnchor="end" x={MARGEN.izquierda - 7} y={y(marca) + 3.5}>
              {marcaDelEje(marca, decimalesY)}
            </text>
          </g>
        ))}
        <line className="plano__eje" x1={MARGEN.izquierda} x2={ANCHO - MARGEN.derecha} y1={abajoDelEje} y2={abajoDelEje} />
        <line className="plano__eje" x1={MARGEN.izquierda} x2={MARGEN.izquierda} y1={MARGEN.arriba} y2={abajoDelEje} />
        {/* El cero de rentabilidad, que es la única referencia que significa algo. */}
        <line className="plano__cero" x1={MARGEN.izquierda} x2={ANCHO - MARGEN.derecha} y1={y(0)} y2={y(0)} />

        {colocados.map(({ punto, cx, cy, lado }) => {
          const aLaIzquierda = lado === "izquierda";
          /* Un número se aparta al otro lado si tiene otro punto justo al lado. */
          const numeroALaIzquierda = colocados.some(
            (otro) => otro.punto.id !== punto.id && otro.cx > cx && otro.cx - cx < 22 && Math.abs(otro.cy - cy) < 12
          );
          return (
            <g className="plano__punto" key={punto.id}>
              {/* Una sola cadena: React no admite varios trozos dentro de <title>. */}
              <title>{`${punto.nombre}: volatilidad ${volatilidadDe(punto.volatilidad)}, rentabilidad ${conSigno(punto.rentabilidad)}`}</title>
              {/* Diana invisible, más grande que la marca: el objetivo no es el punto. */}
              <circle className="plano__diana" cx={cx} cy={cy} r={16} />
              {/* Anillo del color del papel: dos puntos que se tocan siguen leyéndose. */}
              <circle className="plano__halo" cx={cx} cy={cy} r={6.5} />
              <circle className="plano__marca" cx={cx} cy={cy} r={5} />
              {caben ? (
                <text
                  className="plano__etiqueta"
                  textAnchor={aLaIzquierda ? "end" : "start"}
                  x={cx + (aLaIzquierda ? -SEPARACION : SEPARACION)}
                  y={cy - 2}
                >
                  <tspan>{punto.nombre}</tspan>
                  <tspan className="plano__cifras" dy={13} x={cx + (aLaIzquierda ? -SEPARACION : SEPARACION)}>
                    {cifrasDe(punto)}
                  </tspan>
                </text>
              ) : (
                <text
                  className="plano__numero"
                  textAnchor={numeroALaIzquierda ? "end" : "start"}
                  x={cx + (numeroALaIzquierda ? -9 : 9)}
                  y={cy + 4}
                >
                  {numeroDe(punto.id)}
                </text>
              )}
            </g>
          );
        })}

        <text className="plano__eje-rotulo" x={(ANCHO + MARGEN.izquierda) / 2} y={ALTO - 8}>
          Volatilidad {ventana}
        </text>
        <text
          className="plano__eje-rotulo"
          transform={`rotate(-90 14 ${(ALTO - MARGEN.abajo) / 2})`}
          x={14}
          y={(ALTO - MARGEN.abajo) / 2}
        >
          Rentabilidad {ventana}
        </text>
      </svg>
      {caben ? null : (
        <ol className="plano__indice">
          {colocados.map(({ punto }) => (
            <li key={punto.id}>
              <b>{numeroDe(punto.id)}</b> · {punto.nombre} · <span className="plano__indice-cifras">{cifrasDe(punto)}</span>
            </li>
          ))}
        </ol>
      )}
    </figure>
  );
}

export function PlanoRiesgoRetorno({
  columnas,
  puntoDe,
  ventana = "1 año"
}: {
  columnas: ColumnaComparada[];
  puntoDe: (columna: ColumnaComparada) => PuntoDelPlano;
  /** La ventana de las dos cifras. Rotula los ejes y el texto accesible. */
  ventana?: VentanaDelPlano;
}) {
  const porMetodo = useMemo(() => {
    const mapa = new Map<string, PuntoDelPlano[]>();
    for (const columna of columnas) {
      const punto = puntoDe(columna);
      /* El método de sus dos cifras, que puede no ser el de la columna: las de Allianz AT2 a 3 años son del proveedor, y su 1 año es nuestro (decisión 110). */
      const clave = punto.metodo ?? columna.metodo ?? "";
      mapa.set(clave, [...(mapa.get(clave) ?? []), punto]);
    }
    return [...mapa.entries()];
  }, [columnas, puntoDe]);

  /* El número es la posición en la selección, el mismo de la evolución y de la correlación. */
  const numeros = useMemo(
    () => new Map(columnas.map((columna, indice) => [columna.id, indice + 1])),
    [columnas]
  );

  /*
   * Los que no se dibujan se NOMBRAN. Es la regla F-07 (auditoría 29-09): el mapa
   * anterior se caía a la cifra de un año cuando faltaba la de tres —comparando un
   * punto a un año con puntos a tres—, y se arregló dejándolos fuera y diciendo
   * cuáles. Al sustituir el mapa esa regla tenía que venirse con él: un instrumento
   * que desaparece sin que nadie lo nombre se lee como que no lo elegiste.
   */
  const fuera = useMemo(
    () =>
      columnas
        .map(puntoDe)
        .filter((punto) => punto.volatilidad === undefined || punto.rentabilidad === undefined)
        .map((punto) => punto.nombre),
    [columnas, puntoDe]
  );

  const tieneCifras = (punto: PuntoDelPlano) => punto.volatilidad !== undefined && punto.rentabilidad !== undefined;
  /* Un nombre puede acabar en punto, como «Inmocemento, S.A.», y la frase no lleva dos (decisión 80, en el papel). */
  const losDeFuera = fuera.join("; ");

  return (
    <div className="plano__conjunto">
      {porMetodo.map(([metodo, puntos]) => (
        <Panel
          key={metodo}
          metodo={metodo || undefined}
          motivoDelSolo={
            porMetodo.some(([otro, suyos]) => otro !== metodo && suyos.some(tieneCifras))
              ? "No se sitúa frente a los demás porque su método es otro."
              : "No se sitúa frente a los demás porque no tienen las dos cifras."
          }
          numeroDe={(id) => numeros.get(id) ?? 0}
          puntos={puntos}
          ventana={ventana}
        />
      ))}
      {fuera.length > 0 ? (
        <p className="tabla__aviso">
          <b>Fuera del plano por no tener las dos cifras a {ventana}:</b> {losDeFuera}{losDeFuera.endsWith(".") ? "" : "."} No
          se sustituyen por las de otra ventana.
        </p>
      ) : null}
      {porMetodo.length > 1 ? (
        <p className="tabla__aviso">
          <b>Un panel por método, y no un plano con todos.</b> Los ejes de este gráfico son
          justo las cifras cuya escala no se puede mezclar: ponerlas en el mismo plano sería
          afirmar que están en el mismo sistema de coordenadas. Dentro de cada panel la
          comparación es legítima; entre paneles, las posiciones no se comparan.
        </p>
      ) : null}
    </div>
  );
}
