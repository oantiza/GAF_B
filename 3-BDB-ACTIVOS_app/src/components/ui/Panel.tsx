import { useId, useState, type ReactNode } from "react";

/**
 * El panel: la pieza que faltaba, y que no es la que el plan creía que faltaba.
 *
 * Medido el 03-11-2026, al ir a construirla: **el CSS del panel ya existe** desde antes
 * del rediseño —`.panel`, `.panel__head`, `.panel__title`, `.panel__body`,
 * `.panel__actions`, y `.panel-head-text` para el título apilado—, y lo usan 36
 * ficheros. Lo que no existía es el componente, exactamente igual que con la tabla: el
 * panel era un acuerdo de nombres de clase que cada pantalla volvía a escribir.
 *
 * Y la prueba de que el acuerdo no se sostiene está escrita en la propia hoja. En
 * `components.css` hay **21 selectores repetidos tres veces** —63 líneas de selector—
 * cuyo único trabajo es decir «yo también soy una cabecera de panel», con un comentario
 * que lo admite: «pasan al mismo lenguaje que `.panel__head`… la lista no crece: un
 * módulo nuevo usa `.panel__head`». La lista creció. Cada pantalla que se rehace contra
 * esta pieza borra su nombre de esas tres listas.
 *
 * Lo que la pieza AÑADE a lo que ya había, y es lo que la dirección A + B exige:
 *
 * - **La procedencia, pegada bajo el título.** Es el principio 1 de la dirección —«nada
 *   se afirma sin decir quién lo dice y desde cuándo»— y es lo que la hace ser la A. Hoy
 *   esa línea viaja como un `<span>` suelto a la derecha del título, mezclada en la
 *   misma fila con los estados y los controles, así que «Rf del BCE · 31 oct» y
 *   «pendiente» se leen como lo mismo.
 * - **Un nombre accesible siempre.** El `<section>` de un panel sin `aria-labelledby` es
 *   una región anónima: un lector de pantalla la anuncia sin decir de qué es. Aquí el id
 *   se genera si no se da, así que no hay forma de montar un panel sin nombre.
 *
 * **Y no añade ni una línea de hoja de estilo.** Eso no es casualidad ni ahorro: la
 * procedencia se pinta con `.panel__subtitle`, que ya existe y usan 36 sitios con este
 * mismo papel —«Mismos activos y fechas que la simulación histórica», «Rf del…»—, y el
 * estado y los controles comparten `.panel__actions`, que ya empuja a la derecha con su
 * separación. Inventar `.panel__procedencia` habría sido repetir el defecto que esta
 * pieza viene a quitar: un nombre nuevo para un estilo que ya estaba escrito.
 *
 * **Su cabecera es la de la ficha** desde el 04-11-2026 (decisión 24 de Óscar): título en
 * tinta y sin el trazo azul. Entonces iba a 17 px en serifa 600 sobre un filete fuerte; en la
 * dirección A (18-11-2026) va en Plex 600 a 15 px (`--texto-ml`) y sin filete debajo
 * (`.panel__title`, `.panel__head`). Se cambió una vez aquí y en `components.css`, y lo
 * heredaron todas las secciones. El antetítulo va solo
 * donde añade algo: uno que repite el título, como «Optimizador / Optimizar cartera», es
 * ruido en una pantalla con quince secciones.
 *
 * Lo que hace desde la dirección A (18-11-2026): dibuja una tarjeta —papel blanco (`--papel`),
 * borde `--filete`, esquina `--radio-bloque` (6 px) y `--sombra-tarjeta`— sobre el lienzo
 * marfil; un panel dentro de otro, o dentro de un diálogo, no lo es. Antes (02-11-2026) no
 * dibujaba caja: las quince cajas con borde sobre fondo gris de la dirección B se descartaron
 * entonces con su motivo escrito.
 */
export interface PanelProps {
  /** El título. Va en `h2` salvo que `nivel` diga otra cosa. */
  titulo: ReactNode;
  /**
   * El antetítulo: «Paso 1». Se apila sobre el título, no compite con él. Va solo si dice
   * algo que el título no dice.
   */
  rotulo?: ReactNode;
  /**
   * La línea bajo el título, en gris y pequeña: es donde va la procedencia —«Rf del
   * BCE», «Cifras del proveedor · 31 oct 2026», el periodo de un cálculo—, que es el
   * principio 1 de la dirección y la ranura que faltaba.
   *
   * Se llama `subtitulo` y no `procedencia` porque de los 36 sitios que ya usan esta
   * clase, la mitad pone ahí una descripción y no una fuente («Peso por clase
   * económica»). Nombrarla `procedencia` obligaría a mentir en la mitad de las llamadas.
   *
   * No es donde van los estados. Un «pendiente» no es ni una procedencia ni un
   * subtítulo.
   */
  subtitulo?: ReactNode;
  /**
   * El estado del panel, a la derecha del título: «preparado», «pendiente», un recuento.
   * Lo que hoy son los `<span className="warn">` sueltos de la cabecera, que se pasan
   * tal cual con su clase: el panel no decide si un estado es un aviso.
   */
  estado?: ReactNode;
  /** Controles: un selector de vista, un botón. A la derecha, después del estado. */
  acciones?: ReactNode;
  /**
   * El id del título, para enlazarlo desde fuera. Si no se da se genera uno: el panel
   * queda nombrado de todas formas.
   */
  tituloId?: string;
  /**
   * El nivel del encabezado. La regla (MAR-32, 14-11-2026): `h1` la pantalla, `h2` cada
   * bloque, `h3` lo que va dentro de un bloque. Así que `2` por defecto, y `3` para un
   * panel dentro de otro, bajo un `h2` escrito a mano o dentro de un diálogo (cuyo título
   * es `h2`). Antes era `h3` por defecto, y entre el `h1` y el `h3` no había ningún `h2`.
   * El aspecto no depende del nivel: lo da `.panel__title`.
   */
  nivel?: 2 | 3;
  className?: string;
  /**
   * Clase para el cuerpo, no para la sección. Casi siempre es una pila: el cuerpo de un
   * panel suele ser una columna con hueco, y eso es `stack` con su modificador, no una
   * clase propia de la pantalla.
   */
  claseDelCuerpo?: string;
  /**
   * Para el detalle largo, que no tiene por qué estar abierto («primero la respuesta; el detalle, a un clic»): el
   * título pasa a ser un botón con `aria-expanded` que enseña u oculta el cuerpo. Se abre con clic, Intro o Espacio.
   * Las acciones y el estado se quedan fuera del botón, a la derecha, y siguen funcionando con el cuerpo cerrado.
   * Sin esta propiedad, el panel es el de siempre.
   */
  plegable?: boolean;
  /** Si el panel plegable empieza abierto. Cerrado por defecto: si se pliega es porque es detalle. */
  abiertoAlEmpezar?: boolean;
  /** El cuerpo. Va en `.panel__body`, sin relleno lateral. */
  children: ReactNode;
}

export function Panel({
  titulo,
  rotulo,
  subtitulo,
  estado,
  acciones,
  tituloId,
  nivel = 2,
  className = "",
  claseDelCuerpo = "",
  plegable = false,
  abiertoAlEmpezar = false,
  children
}: PanelProps) {
  /* El id se genera siempre, aunque luego no se use: `useId` no puede ir dentro de un
     condicional. */
  const generado = useId();
  const idDelTitulo = tituloId ?? generado;
  const idDelCuerpo = `${generado}-cuerpo`;
  const Titulo = nivel === 3 ? "h3" : "h2";
  const [abierto, setAbierto] = useState(abiertoAlEmpezar);
  const oculto = plegable && !abierto;

  return (
    <section aria-labelledby={idDelTitulo} className={`panel ${className}`.trim()}>
      <div className="panel__head">
        <div className="panel-head-text">
          {rotulo ? <p className="section-label">{rotulo}</p> : null}
          <Titulo className="panel__title" id={idDelTitulo}>
            {/* El botón va DENTRO del encabezado y no al revés: así se sigue llegando al panel por su título con la
                navegación por encabezados, y el botón se llama como el panel. */}
            {plegable ? (
              <button
                aria-controls={idDelCuerpo}
                aria-expanded={abierto}
                className="panel__plegador"
                onClick={() => setAbierto((antes) => !antes)}
                type="button"
              >
                {titulo}
                <span aria-hidden="true" className="panel__indicador" />
              </button>
            ) : (
              titulo
            )}
          </Titulo>
          {subtitulo ? <p className="panel__subtitle">{subtitulo}</p> : null}
        </div>
        {/* Estado y controles comparten la misma caja: `.panel__actions` ya empuja a la
            derecha y separa lo que lleve dentro. */}
        {estado || acciones ? (
          <div className="panel__actions">
            {estado}
            {acciones}
          </div>
        ) : null}
      </div>
      <div className={`panel__body ${claseDelCuerpo}`.trim()} hidden={oculto} id={plegable ? idDelCuerpo : undefined}>
        {children}
      </div>
    </section>
  );
}
