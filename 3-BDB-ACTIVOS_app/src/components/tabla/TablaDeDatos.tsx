import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "../ui/Button";
import { EnlaceAFicha } from "../ui/EnlaceAFicha";
import { descubrirElFoco } from "./focoBajoColumnaFija";
import { numero } from "../../core/formato";
import type { CeldaDeTabla, ColumnaDeTabla, EstadoDeTabla, FilaAgrupable } from "../../types/tablaDeDatos";
import type { ClaseDeAusencia } from "../../types/fichaInstrumento";
/* La pieza trae su hoja: si la pidiera cada pantalla, una que la olvide la pinta sin estilo. */
import "../../styles/tabla.css";

/**
 * La tabla del sistema (dirección A + B, 02-11-2026).
 *
 * Es una `<table>` de verdad, con `<th scope="col">` y `aria-sort`. La de hoy es una
 * rejilla de `<span>` con la cabecera marcada `aria-hidden`, así que un lector de
 * pantalla lee cada celda sin saber de qué columna es; en la pantalla principal de una
 * herramienta de asesoramiento, eso no es un detalle.
 *
 * Lo que hace y ninguna tabla corriente hace: **al ordenar por una columna cuyas cifras
 * vienen de métodos distintos, agrupa en vez de mezclar.** No bloquea el orden, que
 * sería inútil, y no mezcla, que sería mentir. Dentro de cada grupo el orden compara
 * cosas comparables; entre grupos no compara nada.
 */

const CLASE_DE_AUSENCIA: Record<ClaseDeAusencia, string> = {
  "no-aplica": "tabla__celda--no-aplica",
  falta: "tabla__celda--falta",
  "sin-pedir": "tabla__celda--sin-pedir"
};

/**
 * `comoBoton`: la celda que encabeza una fila abrible, cuando nada más de la fila la abre con el teclado
 * (MAR-01). El `onClick` del `<tr>` es solo para el ratón; este botón es la salida con el tabulador e Intro,
 * con el aspecto del nombre que lleva a una ficha. No deja subir el clic: la fila lo abriría otra vez.
 */
/** Un ISIN al principio del apunte: dos letras, nueve caracteres y el dígito de control. */
const ISIN_AL_PRINCIPIO = /^([A-Z]{2}[A-Z0-9]{9}[0-9])(.*)$/s;

/**
 * El apunte, con el ISIN aparte cuando lo lleva delante: en una tabla de activos se escribe en la mono, como en la
 * captura que eligió Óscar el 17-11-2026, y el resto (el método de la cifra) sigue en la letra del texto.
 */
function apunteConSuIsin(apunte: string): ReactNode {
  const partes = ISIN_AL_PRINCIPIO.exec(apunte);
  if (!partes) return apunte;
  return (
    <>
      <span className="tabla__isin">{partes[1]}</span>
      {partes[2]}
    </>
  );
}

function contenido(celda: CeldaDeTabla, alAbrir?: () => void, comoBoton = false) {
  if (celda.nodo !== undefined) return celda.nodo;
  if (celda.antes !== undefined) {
    return (
      <span className="tabla__con-antes">
        {celda.antes}
        <span>{contenido({ ...celda, antes: undefined }, alAbrir, comoBoton)}</span>
      </span>
    );
  }
  return (
    <>
      {celda.enlaceAFicha ? (
        <EnlaceAFicha alAbrir={alAbrir} isin={celda.enlaceAFicha}>
          {celda.texto}
        </EnlaceAFicha>
      ) : comoBoton && alAbrir ? (
        <button
          className="enlace-a-ficha"
          onClick={(evento) => {
            evento.stopPropagation();
            alAbrir();
          }}
          type="button"
        >
          {celda.texto}
        </button>
      ) : (
        <span className={celda.ausencia ? "tabla__ausencia" : undefined}>{celda.texto}</span>
      )}
      {celda.apunte ? <span className="tabla__apunte">{apunteConSuIsin(celda.apunte)}</span> : null}
      {celda.apunteEstrecho ? (
        <span className="tabla__apunte tabla__apunte--estrecho">{celda.apunteEstrecho}</span>
      ) : null}
    </>
  );
}

/** Lo que ordena una celda: su valor, o su texto si no es una ausencia. `undefined` es un hueco. */
type ClaveDeOrden = number | string | undefined;

function claveDeOrden(celda: CeldaDeTabla): ClaveDeOrden {
  return celda.valor ?? (celda.ausencia ? undefined : celda.texto);
}

/** Lo que falta va SIEMPRE al final, nunca arriba: un hueco no es el valor más bajo. */
function comparar(x: ClaveDeOrden, y: ClaveDeOrden, sentido: number): number {
  if (x === undefined && y === undefined) return 0;
  if (x === undefined) return 1;
  if (y === undefined) return -1;
  if (typeof x === "number" && typeof y === "number") return sentido * (x - y);
  return sentido * String(x).localeCompare(String(y), "es");
}

export interface TablaDeDatosProps<F extends FilaAgrupable> {
  filas: F[];
  columnas: ColumnaDeTabla<F>[];
  /** El nombre legible de cada escala, para el encabezado de grupo. */
  nombreDeEscala?: (escala: string | undefined) => string;
  /** Texto accesible de la tabla. */
  titulo: string;
  /** Qué hacer al activar una fila. */
  alAbrir?: (fila: F) => void;
  /**
   * Filas por página. Sin esto se pintan todas, que con 1.076 son 1.076 `<tr>` en el
   * documento: medido, carga en 1,6 s y se nota al ordenar.
   *
   * `true` pagina con las 25 filas del sistema (`FILAS_POR_PAGINA`, apartado 3 de `SISTEMA_DISENO.md`); un número,
   * con las que diga.
   */
  porPagina?: number | true;
  /**
   * El marco se acota al alto de la ventana y la tabla se desplaza por dentro, con la cabecera fija arriba: las
   * cifras no se quedan nunca sin el título de su columna. Sin esto, el marco mide lo que la tabla y desplaza la
   * página, como hasta ahora.
   */
  cabeceraFija?: boolean;
  /**
   * La fila de totales, al pie. Una celda por columna, o `undefined` donde no haya
   * nada que sumar.
   *
   * Entra el 03-11-2026 con la tabla de Posiciones, que la tenía escrita a mano. No es
   * un capricho de esa pantalla: tres tablas de la aplicación llevan `<tfoot>` y las
   * tres lo escriben por su cuenta. Y es la clase de cosa que una tabla no debe dejar
   * a quien la usa, porque un total que no cuadra con lo que se ve encima es el peor
   * error que puede cometer esta pantalla.
   */
  pie?: (columna: ColumnaDeTabla<F>) => CeldaDeTabla | undefined;
  /** El rótulo de la primera celda del pie: «Total visible», «Suma», lo que sea. */
  rotuloDelPie?: string;
  /**
   * Lo que se despliega bajo una fila cuando está abierta. Quien monta la tabla decide
   * qué filas lo están: la tabla solo deja sitio.
   */
  detalleDe?: (fila: F) => ReactNode | undefined;
  /**
   * Qué filas están elegidas, si la tabla sirve para elegir: lo dice la fila entera, porque en una
   * lista larga una casilla marcada no se ve de un vistazo. Quien monta la tabla lleva la selección.
   */
  seleccionada?: (fila: F) => boolean;
  /**
   * Las filas llegan en su orden y con sus cabeceras de grupo (`grupoDeFilas`,
   * `cabeceraDeGrupo`), como en la composición de una cartera por estrategia. Entonces la tabla
   * no ordena por columna: una cabecera de grupo entre filas ordenadas ya no encabezaría nada.
   * Cada grupo va en su `<tbody>`, que es lo que hace cierto un `scope="rowgroup"`.
   */
  agrupada?: boolean;
  /**
   * Por dónde va la tabla, cuando quien la monta quiere conservarlo más allá de esta pantalla. Sin
   * esto lo lleva ella misma y se pierde al desmontarse.
   */
  estado?: EstadoDeTabla;
  alCambiarEstado?: (estado: EstadoDeTabla) => void;
  /** Las filas que van delante de las demás, cada grupo en su orden: la respuesta exacta a una búsqueda. */
  primero?: (fila: F) => boolean;
  /**
   * Cada fila es un activo (un fondo, un ETF, una acción, un plan) o una cartera (una propuesta guardada, una cartera del
   * Gestor, desde el mismo día): la tabla se pinta con la letra y el aire de la captura que eligió Óscar el 17-11-2026
   * —IBM Plex Sans, el ISIN en IBM Plex Mono y la fila centrada en vertical—. Las cifras sin negrita ya no son solo de
   * estas tablas: desde la dirección A lo son las de toda tabla de la pieza.
   */
  deActivos?: boolean;
}

/** Las filas de una página cuando se pagina sin decir cuántas: las 25 del sistema. */
export const FILAS_POR_PAGINA = 25;

const AVISO_DE_METODOS_DISTINTOS = (
  <>
    <b>Esta columna no tiene una sola escala.</b> Sus cifras salen de métodos distintos, así
    que la tabla se ha agrupado: dentro de cada grupo el orden compara cosas comparables, y
    entre grupos no compara nada. Ordenarlas juntas pondría una desviación calculada sobre
    meses al lado de otra calculada sobre días.
  </>
);

export function TablaDeDatos<F extends FilaAgrupable>({
  filas,
  columnas,
  pie,
  rotuloDelPie,
  detalleDe,
  seleccionada,
  nombreDeEscala = (escala) => escala ?? "Sin método",
  titulo,
  alAbrir,
  porPagina: filasPorPagina,
  cabeceraFija = false,
  agrupada = false,
  estado,
  alCambiarEstado,
  primero,
  deActivos = false
}: TablaDeDatosProps<F>) {
  const porPagina = filasPorPagina === true ? FILAS_POR_PAGINA : filasPorPagina;
  const [propio, setPropio] = useState<EstadoDeTabla>({ orden: null, sentido: 1, pagina: 1 });
  const vigente = estado ?? propio;
  const { orden, sentido, pagina } = vigente;
  const cambiar = (cambio: Partial<EstadoDeTabla>) => {
    const siguiente = { ...vigente, ...cambio };
    setPropio(siguiente);
    alCambiarEstado?.(siguiente);
  };
  const marco = useRef<HTMLDivElement>(null);

  /* Cambiar el filtro devuelve a la primera página: quedarse en la nueve de una lista que ahora
     tiene tres es una pantalla en blanco sin explicación. Se compara con las filas anteriores y no
     se hace al montar, porque una tabla que vuelve con su estado guardado tiene que seguir en su
     página. Cambiar el orden lo hace `pulsa`. */
  const filasAnteriores = useRef(filas);
  useEffect(() => {
    if (filasAnteriores.current === filas) return;
    filasAnteriores.current = filas;
    if (pagina !== 1) cambiar({ pagina: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filas]);

  const columna = columnas.find((c) => c.id === orden);

  /* La clave de cada fila se calcula UNA vez y se ordena sobre ella (ACT-12 a). Ordenar llamando a `celda` dentro de
     la comparación la llamaba dos veces por comparación, y cada celda numérica formatea un texto que el orden no usa:
     con 1.100 filas eran unas 20.000 llamadas cada vez que cambiaba la lista. `sort` es estable, así que el resultado
     es el mismo, empates incluidos. */
  const porColumna = useMemo(() => {
    if (!columna) return filas;
    return filas
      .map((fila) => ({ fila, clave: claveDeOrden(columna.celda(fila)) }))
      .sort((a, b) => comparar(a.clave, b.clave, sentido))
      .map(({ fila }) => fila);
  }, [filas, columna, sentido]);

  const ordenadas = useMemo(
    () => (primero ? [...porColumna.filter(primero), ...porColumna.filter((fila) => !primero(fila))] : porColumna),
    [porColumna, primero]
  );

  /* Se agrupa solo si hace falta: una columna de escala mixta cuyas filas traen más de
     una escala. Con una sola escala en pantalla, agrupar sería ruido. */
  const grupos = useMemo(() => {
    if (!columna?.escalaMixta) return null;
    /* La escala es la de la cifra por la que se ordena: la de su columna si la dice, y si no la de la fila. */
    const escalaDe = (fila: F) => (columna.escalaDe ? columna.escalaDe(fila) : fila.escala) ?? "";
    const escalas = new Set(ordenadas.map(escalaDe));
    if (escalas.size < 2) return null;
    const porEscala = new Map<string, F[]>();
    for (const fila of ordenadas) {
      const clave = escalaDe(fila);
      porEscala.set(clave, [...(porEscala.get(clave) ?? []), fila]);
    }
    return [...porEscala.entries()];
  }, [ordenadas, columna]);

  /*
   * La página se corta sobre la lista YA agrupada, no sobre los grupos: así una página
   * son siempre las mismas N filas y el grupo que quede partido repite su encabezado
   * con «continúa». Partir por grupos daría páginas de 641 y de 8.
   */
  const enOrden: Array<{ grupo: string; continua?: boolean } | { fila: F }> = useMemo(
    () =>
      grupos
        ? grupos.flatMap(([escala, suyas]) => [
            { grupo: escala },
            ...suyas.map((f) => ({ fila: f }))
          ])
        : ordenadas.map((f) => ({ fila: f })),
    [grupos, ordenadas]
  );

  const soloFilas = enOrden.filter((entrada): entrada is { fila: F } => "fila" in entrada);
  const paginas = porPagina ? Math.max(1, Math.ceil(soloFilas.length / porPagina)) : 1;
  const actual = Math.min(pagina, paginas);

  const visibles = useMemo(() => {
    if (!porPagina) return enOrden;
    const desde = (actual - 1) * porPagina;
    const hasta = desde + porPagina;
    const trozo: Array<{ grupo: string; continua?: boolean } | { fila: F }> = [];
    let contadas = 0;
    let grupoAbierto: string | null = null;
    for (const entrada of enOrden) {
      if ("grupo" in entrada) {
        grupoAbierto = entrada.grupo;
        if (contadas >= desde && contadas < hasta) trozo.push({ grupo: entrada.grupo });
        continue;
      }
      if (contadas >= desde && contadas < hasta) {
        /* Si la página arranca dentro de un grupo, su encabezado se repite. */
        if (trozo.length === 0 && grupoAbierto !== null) {
          trozo.push({ grupo: grupoAbierto, continua: true });
        }
        trozo.push(entrada);
      }
      contadas += 1;
      if (contadas >= hasta) break;
    }
    return trozo;
  }, [enOrden, porPagina, actual]);

  /* Un `<tbody>` por grupo en una tabla agrupada; en las demás, uno solo, como siempre. */
  const tramos = useMemo(() => {
    if (!agrupada) return [visibles];
    const salida: (typeof visibles)[] = [];
    let anterior: string | undefined;
    visibles.forEach((entrada, indice) => {
      const clave = "fila" in entrada ? entrada.fila.grupoDeFilas : undefined;
      if (indice === 0 || clave !== anterior) salida.push([]);
      salida[salida.length - 1].push(entrada);
      anterior = clave;
    });
    return salida;
  }, [agrupada, visibles]);

  /* Pasar de página lleva al principio de la tabla: los botones están al final, y sin esto se empezaba
     a leer la página nueva por su última fila. */
  const irALaPagina = (siguiente: number) => {
    cambiar({ pagina: Math.min(paginas, Math.max(1, siguiente)) });
    marco.current?.scrollIntoView?.({ block: "start" });
  };

  const pulsa = (id: string) => {
    cambiar(orden === id ? { sentido: sentido === 1 ? -1 : 1, pagina: 1 } : { orden: id, sentido: 1, pagina: 1 });
  };

  /* Lo que una columna pide de su `<th>` y de sus `<td>`. */
  const claseDeColumna = (c: ColumnaDeTabla<F>) =>
    [
      c.cifra ? "tabla__celda--cifra" : "",
      c.acciones ? "tabla__celda--acciones" : "",
      c.soloAncho ? "tabla__columna--solo-ancho" : "",
      c.nombre ? "tabla__celda--nombre" : "",
      c.prosa ? "tabla__celda--prosa" : ""
    ].filter(Boolean);

  const hayAcciones = columnas.some((c) => c.acciones);
  const celdas = (fila: F) =>
    columnas.map((c) => {
      const celda = c.celda(fila);
      const clase = [
        ...claseDeColumna(c),
        c.encabezaFila ? "tabla__celda--fila" : "",
        celda.ausencia ? CLASE_DE_AUSENCIA[celda.ausencia] : ""
      ]
        .filter(Boolean)
        .join(" ");
      if (c.encabezaFila) {
        /* Si la fila se abre y no trae ya su enlace, su nodo o una columna de acciones con sus botones, su
           nombre es el botón que la abre con el teclado (MAR-01). */
        const comoBoton = Boolean(alAbrir) && !hayAcciones && Boolean(celda.texto);
        return (
          <th className={clase} key={c.id} scope={fila.cabeceraDeGrupo ? "rowgroup" : "row"}>
            {contenido(celda, alAbrir ? () => alAbrir(fila) : undefined, comoBoton)}
          </th>
        );
      }
      return (
        <td
          className={clase || undefined}
          key={c.id}
          /* Pulsar un botón de la columna de acciones no abre la ficha. Sin esto,
             añadir a cartera te saca de la lista, que es lo contrario de lo que pides
             al pulsarlo desde una lista. */
          onClick={c.acciones ? (evento) => evento.stopPropagation() : undefined}
        >
          {contenido(celda, alAbrir ? () => alAbrir(fila) : undefined)}
        </td>
      );
    });

  const fila = (f: F) => {
    const detalle = detalleDe?.(f);
    return (
      <Fragment key={f.id}>
        <tr
          className={
            [
              alAbrir ? "tabla__fila--abrible" : "",
              f.cabeceraDeGrupo ? "tabla__fila--cabecera-de-grupo" : f.grupoDeFilas ? "tabla__fila--de-grupo" : "",
              seleccionada?.(f) ? "is-selected" : ""
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
          onClick={alAbrir ? () => alAbrir(f) : undefined}
        >
          {celdas(f)}
        </tr>
        {detalle !== undefined ? (
          <tr className="tabla__detalle">
            <td colSpan={columnas.length}>{detalle}</td>
          </tr>
        ) : null}
      </Fragment>
    );
  };

  return (
    /* El marco se desplaza, asi que tiene que poder enfocarse: una zona con scroll a
       la que no se llega con el teclado deja columnas inalcanzables sin raton. Es lo
       que hacian a mano los `-table-wrap` que esta pieza sustituye. */
    <>
    <div
      aria-label={`${titulo} (tabla desplazable)`}
      className={cabeceraFija ? "tabla__marco tabla__marco--cabecera-fija" : "tabla__marco"}
      /* Lo que se enfoca con el teclado bajo una columna fija se trae a la vista (WCAG 2.4.11): ver `focoBajoColumnaFija`. */
      onFocus={(evento) => {
        if (evento.target !== evento.currentTarget) descubrirElFoco(evento.target);
      }}
      ref={marco}
      role="group"
      tabIndex={0}
    >
      <table className={deActivos ? "tabla tabla--activos" : "tabla"}>
        <caption className="sr-only">{titulo}</caption>
        <thead>
          <tr>
            {columnas.map((c) => {
              const activa = orden === c.id;
              /* El nombre entero de un título corto, para quien no lo ve: detrás del corto, que es lo que se dice en voz alta. */
              const completo = c.tituloCompleto ? <span className="sr-only"> ({c.tituloCompleto})</span> : null;
              return (
                <th
                  aria-sort={activa ? (sentido === 1 ? "ascending" : "descending") : undefined}
                  className={claseDeColumna(c).join(" ") || undefined}
                  key={c.id}
                  scope="col"
                  title={c.tituloCompleto}
                >
                  {/* Una columna de acciones no se ordena: no hay nada que comparar
                      entre dos botones, y un encabezado pulsable que no hace nada es
                      peor que uno quieto. Una tabla agrupada, tampoco. */}
                  {c.tituloOculto ? (
                    <span className="sr-only">{c.titulo}</span>
                  ) : c.acciones || c.sinOrden || agrupada ? (
                    <span className="tabla__titulo-fijo">
                      {c.titulo}
                      {completo}
                    </span>
                  ) : (
                    /* En una columna de cifras la flecha va delante: el título acaba en el mismo borde que sus cifras, esté o no
                       ordenada por ella. */
                    <button onClick={() => pulsa(c.id)} type="button">
                      {activa && c.cifra ? <span className="tabla__flecha tabla__flecha--delante">{sentido === 1 ? "↑" : "↓"}</span> : null}
                      {c.titulo}
                      {completo}
                      {activa && !c.cifra ? <span className="tabla__flecha">{sentido === 1 ? "↑" : "↓"}</span> : null}
                    </button>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        {tramos.map((tramo, indiceDelTramo) => (
          <tbody key={indiceDelTramo}>
            {tramo.map((entrada) => {
              if ("fila" in entrada) return fila(entrada.fila);
              const cuantas = grupos?.find(([escala]) => escala === entrada.grupo)?.[1].length ?? 0;
              return (
                <tr className="tabla__grupo" key={`g-${entrada.grupo}-${entrada.continua ? "c" : ""}`}>
                  <td colSpan={columnas.length}>
                    <b>{nombreDeEscala(entrada.grupo || undefined)}</b> · {cuantas}{" "}
                    {cuantas === 1 ? "activo" : "activos"}
                    {entrada.continua
                      ? " · continúa de la página anterior"
                      : " · ordenados entre ellos, no contra los otros grupos"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
        {pie ? (
          <tfoot>
            <tr className="tabla__pie">
              {columnas.map((c, indice) => {
                const celda = pie(c);
                /* El rótulo va en la primera celda y es cabecera de fila: lo que sigue
                   a la derecha es lo que ese rótulo totaliza. */
                if (indice === 0) {
                  return (
                    <th
                      className={c.cifra ? "tabla__celda--cifra" : undefined}
                      key={c.id}
                      scope="row"
                    >
                      {celda ? contenido(celda) : (rotuloDelPie ?? "Total")}
                    </th>
                  );
                }
                return (
                  <td className={c.cifra ? "tabla__celda--cifra" : undefined} key={c.id}>
                    {celda ? contenido(celda) : null}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
      {/* Fuera del marco: es lo que se desplaza, y esto no debe irse de lado con las columnas. «Anterior» y «Siguiente»
          llevan borde, para que se vean como botones y el deshabilitado se distinga (dirección A, 18-11-2026). */}
      {porPagina ? (
        <PaginasDeLaTabla actual={actual} irA={irALaPagina} porPagina={porPagina} titulo={titulo} total={soloFilas.length} />
      ) : null}
      {grupos ? <p className="tabla__aviso">{AVISO_DE_METODOS_DISTINTOS}</p> : null}
    </>
  );
}

/**
 * Las páginas de una lista larga: «26–50 de 376», «Anterior», «2 de 16» y «Siguiente». La pinta `TablaDeDatos` con `porPagina`, y la usa
 * también una tabla escrita a mano que no puede pasar por ella —la de Retrocesiones de Sistema, que lleva campos en cada fila—, para que las
 * dos paginen igual (Óscar, 20-11-2026). Con una sola página no pinta nada.
 */
export function PaginasDeLaTabla({ actual, irA, porPagina, titulo, total }: {
  actual: number;
  irA: (pagina: number) => void;
  porPagina: number;
  titulo: string;
  total: number;
}) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  if (paginas <= 1) return null;
  return (
    <nav aria-label={`Páginas de ${titulo.toLowerCase()}`} className="tabla__paginas">
      <span>
        {numero((actual - 1) * porPagina + 1)}–{numero(Math.min(actual * porPagina, total))} de{" "}
        {numero(total)}
      </span>
      <Button
        disabled={actual <= 1}
        onClick={() => irA(actual - 1)}
        size="sm"
        variant="secondary"
      >
        Anterior
      </Button>
      <strong>
        {actual} de {paginas}
      </strong>
      <Button
        disabled={actual >= paginas}
        onClick={() => irA(actual + 1)}
        size="sm"
        variant="secondary"
      >
        Siguiente
      </Button>
    </nav>
  );
}
