import { Fragment, useState, type ReactNode } from "react";
import { Ausencia } from "../ui/Ausencia";
import { Aviso } from "../ui/Aviso";
import { Button } from "../ui/Button";
import { ClaseConColor } from "../ui/ClaseConColor";
import { Distintivo, type TonoDeDistintivo } from "../ui/Distintivo";
import { ListaDePartes } from "../ui/ListaDePartes";
import { PageHeader } from "../ui/PageHeader";
import { Panel } from "../ui/Panel";
import { Respuesta } from "../ui/Respuesta";
import { PanelDePestana, SegmentedTabs } from "../ui/SegmentedTabs";
import { tramoDeLaCaja, type TramoDeLaCaja } from "../../core/cajaDeEstilo";
import { colorDeLaClasePorNombre } from "../../core/coloresDeClase";
import { CabeceraDeSeccion } from "./CabeceraDeSeccion";
import {
  costesDelResumen,
  objetivoDelResumen,
  partesDeLaSeccion,
  partesDelResumen,
  PESTANAS_DE_LA_FICHA,
  pestanaDeLaSeccion,
  politicaDeReparto,
  rentabilidadesDelResumen,
  respuestaDeLaFicha,
  SECCIONES_INTERNAS,
  signoDelTexto,
  tipoEnFrase,
  type PestanaDeLaFicha
} from "./mapaDeLaFicha";
import type {
  AptitudDeFicha,
  CajaDeFicha,
  CeldaDeSeccion,
  ClaseDeAusencia,
  FichaInstrumento as ModeloDeFicha,
  FilaDeFicha,
  SeccionDeFicha,
  Trozo
} from "../../types/fichaInstrumento";
/* La pieza trae su hoja: si la pidiera cada pantalla, una que la olvide la pinta sin estilo. */
import "../../styles/ficha.css";

/**
 * La ficha de un instrumento: «Informe vivo» (paso 4 del rediseño, 14-11-2026), sobre la de la dirección A + B.
 *
 * Un solo pintor para todos los tipos. No hay ninguna rama que pregunte si esto es un
 * fondo o una acción: pinta las secciones que le llegan, que son las que el instrumento
 * declara. Esa es la diferencia con la ficha anterior, cuyos veintitrés bloques eran
 * todos de fondo —la palabra TER, que es un coste que una acción no tiene, aparecía 122
 * veces en el código— y que delante de una acción habría enseñado una columna de huecos.
 *
 * Lo que cambia con el rediseño es dónde se enseña cada sección, no cuáles ni sus cifras: primero la cabecera y la banda de
 * la respuesta, después las pestañas (cada sección, en la suya: `mapaDeLaFicha.ts`), y el Resumen abre con la evolución y
 * tres bloques cortos que llevan a su detalle. Todas las pestañas quedan montadas y las que no se ven, ocultas: así lo
 * que la ficha dice se puede buscar y probar entero, y cambiar de pestaña no vuelve a pedir la evolución.
 */

function Texto({ trozos }: { trozos: Trozo[] }) {
  return (
    <>
      {trozos.map((trozo, indice) =>
        trozo.fuerte ? (
          /* La clave es el índice a propósito: el texto se repite y la lista no se
             reordena nunca —es una frase, no una tabla—. El comentario que había aquí
             silenciaba `react/no-array-index-key`, una regla que este eslint no tiene
             configurada, así que el propio silencio era el error. */
          <b key={indice}>{trozo.texto}</b>
        ) : (
          <span key={indice}>{trozo.texto}</span>
        )
      )}
    </>
  );
}

const CLASE_DE_AUSENCIA: Record<ClaseDeAusencia, string> = {
  "no-aplica": "ficha__fila--no-aplica",
  falta: "ficha__fila--falta",
  "sin-pedir": "ficha__fila--sin-pedir"
};

/**
 * Las tres ausencias se distinguen por su color, por la forma del filete (entero, roto, de
 * color) y por lo que dicen. Con una sola señal no bastaría: quien no distinga la terracota
 * del marino sigue viendo la línea rota. Sin subrayado desde la decisión 30: «Pendiente de
 * alta» no es un enlace, y un subrayado prometía uno.
 */
/* Escritas enteras para que el censo de CSS vea su uso. */
const CLASE_DEL_SIGNO = { sube: "cifra cifra--sube", baja: "cifra cifra--baja", neutro: "" } as const;

/** Una cifra que es una rentabilidad lleva el color de su signo, que ya va escrito (+ o −): el color lo refuerza. */
function ConSigno({ texto }: { texto: string }) {
  const clase = CLASE_DEL_SIGNO[signoDelTexto(texto)];
  return clase ? <span className={clase}>{texto}</span> : <>{texto}</>;
}

/**
 * Una fila de la ficha. `rotulo` pinta el rótulo con algo más que su texto (el distintivo de una aptitud, el punto de color de
 * una clase), sin cambiar lo que dice.
 */
function Fila({ fila, conSigno = false, rotulo }: { fila: FilaDeFicha; conSigno?: boolean; rotulo?: ReactNode }) {
  const clase = `${fila.ausencia ? ` ${CLASE_DE_AUSENCIA[fila.ausencia]}` : ""}${fila.larga ? " ficha__fila--larga" : ""}`;
  return (
    <div className={`ficha__fila${clase}`}>
      <span className="ficha__rotulo">{rotulo ?? fila.rotulo}</span>
      <span className={fila.destacada ? "ficha__valor ficha__valor--destacado" : "ficha__valor"}>
        {conSigno && !fila.ausencia ? <ConSigno texto={fila.valor} /> : fila.valor}
      </span>
      {fila.glosa ? <span className="ficha__glosa">{fila.glosa}</span> : null}
    </div>
  );
}

/** Las secciones cuyas filas son rentabilidades: llevan el color del signo. */
const SECCIONES_DE_RENTABILIDAD: ReadonlySet<string> = new Set(["rentabilidad"]);

/**
 * Las filas de una sección. Un reparto cuyas filas traen su peso en número (regiones, sectores, estilo, tamaño) se pinta como
 * partes de un todo con su barra, cada región en el color de su zona (14-11-2026, Óscar: «le faltan colores en general»);
 * con el mismo rótulo y la misma cifra. La Composición, cuyas filas no traen el peso, sigue en filas, con el punto del color
 * de cada clase delante de su nombre.
 */
function FilasDeLaSeccion({ seccion }: { seccion: SeccionDeFicha }) {
  const partes = partesDeLaSeccion(seccion);
  if (partes) return <ListaDePartes etiqueta={seccion.titulo} partes={partes} />;
  return (
    <>
      {seccion.filas.map((fila) => (
        <Fila
          conSigno={SECCIONES_DE_RENTABILIDAD.has(seccion.id)}
          fila={fila}
          key={fila.rotulo}
          rotulo={
            seccion.id === "composicion" && !fila.ausencia ? (
              <ClaseConColor color={colorDeLaClasePorNombre(fila.rotulo)}>{fila.rotulo}</ClaseConColor>
            ) : undefined
          }
        />
      ))}
    </>
  );
}

function Seccion({ seccion }: { seccion: SeccionDeFicha }) {
  const titulo = SECCIONES_INTERNAS.has(seccion.id) ? (
    <>
      {seccion.titulo} <Distintivo tono="interno">Interno</Distintivo>
    </>
  ) : (
    seccion.titulo
  );
  return (
    <section className={seccion.ancha ? "ficha__seccion ficha__seccion--ancha" : "ficha__seccion"} id={`ficha-seccion-${seccion.id}`}>
      <CabeceraDeSeccion procedencia={<Texto trozos={seccion.procedencia} />} titulo={titulo} />
      {seccion.aviso ? (
        <p className="ficha__aviso">
          <Texto trozos={seccion.aviso} />
        </p>
      ) : null}
      <FilasDeLaSeccion seccion={seccion} />
      {seccion.caja ? <CajaDeLaSeccion caja={seccion.caja} /> : null}
      {seccion.prosa ? <p className="ficha__prosa">{seccion.prosa}</p> : null}
      {seccion.tabla ? <TablaDeSeccion tabla={seccion.tabla} /> : null}
      {seccion.nota ? <p className="ficha__nota">{seccion.nota}</p> : null}
      {seccion.contradiccion ? (
        <p className="ficha__contradiccion">{seccion.contradiccion}</p>
      ) : null}
    </section>
  );
}

/**
 * Lo que la ficha puede hacer con él, dicho como lo dice el asesor: «Se puede comparar su coste». Antes era la tira «Qué puedes
 * hacer con él» bajo la cabecera; ahora va en «Documentos y datos», con la misma cifra que lo demuestra o el porqué de que no.
 */
const LO_QUE_SE_PUEDE: Record<string, string> = {
  "Comparar su coste": "comparar su coste",
  "Entrar en una radiografía": "meter en una radiografía",
  "Comparar su rentabilidad": "comparar su rentabilidad",
  "Medir su alfa": "medir su alfa",
  "Métricas nuestras": "medir con nuestras métricas",
  "Compararlo con sus pares": "comparar con sus pares"
};

/**
 * El tono de la palabra de cada aptitud (14-11-2026, Óscar: «le faltan colores en general»; G14 del inventario): «Se puede», en
 * verde; «No se puede» porque falta un dato, en ocre, que es lo que pide atención; «No aplica», sin distintivo, como la
 * ausencia que es (gris en cursiva). La aptitud con reserva —la cifra está, pero falta algo para usarla sin más, y el valor
 * dice qué— dice «Se puede», pero ni se afirma ni se alarma: en gris, como antes del rediseño, cuando iba en tinta.
 */
const TONO_DE_LA_APTITUD: Record<AptitudDeFicha["estado"], TonoDeDistintivo | null> = {
  si: "favorable",
  reserva: "neutro",
  falta: "aviso",
  "no-aplica": null
};

function FilaDeAptitud({ aptitud }: { aptitud: AptitudDeFicha }) {
  const accion = LO_QUE_SE_PUEDE[aptitud.rotulo] ?? aptitud.rotulo.toLocaleLowerCase("es");
  const palabra = aptitud.estado === "si" || aptitud.estado === "reserva" ? "Se puede" : "No se puede";
  const tono = TONO_DE_LA_APTITUD[aptitud.estado];
  const fila: FilaDeFicha = {
    rotulo: `${palabra} ${accion}`,
    valor: aptitud.valor,
    ...(aptitud.estado === "falta" || aptitud.estado === "no-aplica" ? { ausencia: aptitud.estado } : {})
  };
  return (
    <Fila
      fila={fila}
      rotulo={
        tono ? (
          <>
            <Distintivo tono={tono}>{palabra}</Distintivo> {accion}
          </>
        ) : undefined
      }
    />
  );
}

/**
 * Los huecos que la ficha deja a quien la monta, y por qué son huecos y no datos.
 *
 * El 02-11-2026 esta ficha sustituyó a la anterior dentro del Buscador, y la anterior
 * traía dos cosas que ningún dato de la base puede dar: los botones de añadir a la propuesta
 * y comparar —que dependen de la propuesta en curso y de la selección de comparación, que
 * son estado de la aplicación— y el gráfico de evolución, que sale de una serie que la
 * base nueva todavía no tiene contrato para guardar. Sustituir perdiéndolas habría sido
 * cambiar lo que la aplicación hace, y el rediseño cambia cómo se ve.
 *
 * Entran como `ReactNode` y no como campos del modelo a propósito: este componente es
 * una función pura de datos y no debe saber qué es una propuesta.
 */
interface HuecosDeLaFicha {
  /** Los botones de la cabecera: descargar, comparar y añadir a la propuesta. */
  acciones?: ReactNode;
  /** La evolución del precio, que abre el Resumen. */
  evolucion?: ReactNode;
  /** Un distintivo para la línea de identidad: si se puede proponer. */
  distintivo?: ReactNode;
  /** Avisos de quien la monta (un fallo al descargar, unos fundamentales que no llegan), entre la respuesta y las pestañas. */
  avisos?: ReactNode;
  /**
   * Lo que ocupa el sitio de los fundamentales mientras llegan (ACT-08): con esto la pestaña «Fundamentales» existe aunque aún
   * no tenga secciones, y su hueco queda reservado.
   */
  fundamentalesPendientes?: ReactNode;
  /** La pestaña elegida, si la guarda quien la monta (en la dirección). Sin ella, la ficha la guarda sola. */
  pestana?: PestanaDeLaFicha;
  alElegirPestana?: (pestana: PestanaDeLaFicha) => void;
}

/** Las celdas de la tabla de rentabilidades del Resumen: la cifra con el color de su signo, o por qué no está. */
function CeldaDeRentabilidad({ celda }: { celda: CeldaDeSeccion }) {
  return typeof celda === "string" ? <ConSigno texto={celda} /> : <Ausencia clase={celda.ausencia} motivo={celda.texto} />;
}

export function FichaInstrumento({
  ficha,
  acciones,
  evolucion,
  distintivo,
  avisos,
  fundamentalesPendientes,
  pestana: pestanaDeFuera,
  alElegirPestana
}: { ficha: ModeloDeFicha } & HuecosDeLaFicha) {
  const [pestanaPropia, setPestanaPropia] = useState<PestanaDeLaFicha>("resumen");
  const deLaPestana = (pestana: PestanaDeLaFicha) =>
    ficha.secciones.filter((seccion) => pestanaDeLaSeccion(seccion.id) === pestana);

  /* Una pestaña sin contenido no se enseña. Documentos y datos tiene siempre, si hay algo que decir de lo que se puede hacer. */
  const pestanas = PESTANAS_DE_LA_FICHA.filter(
    ({ id }) =>
      id === "resumen" ||
      deLaPestana(id).length > 0 ||
      (id === "fundamentales" && fundamentalesPendientes !== undefined && fundamentalesPendientes !== null) ||
      (id === "documentos" && ficha.aptitudes.length > 0)
  );
  const pedida = pestanaDeFuera ?? pestanaPropia;
  const pestana = pestanas.some(({ id }) => id === pedida) ? pedida : "resumen";
  const elegir = (siguiente: PestanaDeLaFicha) => (alElegirPestana ? alElegirPestana(siguiente) : setPestanaPropia(siguiente));
  const verPestana = (destino: PestanaDeLaFicha, texto: string) =>
    pestanas.some(({ id }) => id === destino) ? (
      <Button className="ficha__ver" onClick={() => elegir(destino)} size="sm" variant="quiet">
        {texto}
      </Button>
    ) : null;

  const respuesta = respuestaDeLaFicha(ficha);
  const rentabilidades = rentabilidadesDelResumen(ficha);
  const partes = partesDelResumen(ficha);
  const costes = costesDelResumen(ficha);
  const objetivo = objetivoDelResumen(ficha);
  const hayLateral = partes !== null || costes !== null || objetivo !== null;
  const hayPrincipal = Boolean(evolucion) || rentabilidades !== null;

  const [isin, ...restoDeLaIdentidad] = ficha.identificacion.split(" · ");
  const reparto = politicaDeReparto(ficha);
  const { disponibilidad } = ficha;

  const contenidoDe = (id: PestanaDeLaFicha): ReactNode => {
    if (id !== "resumen") {
      const secciones = deLaPestana(id);
      return (
        <>
          {id === "fundamentales" ? fundamentalesPendientes : null}
          {/* Flujo en columnas, no rejilla de filas: con filas, una sección corta al lado de una larga deja un vacío del alto de
              la larga. Las anchas (tablas, texto corrido) van debajo, a lo ancho. */}
          {secciones.some((seccion) => !seccion.ancha) || (id === "documentos" && ficha.aptitudes.length > 0) ? (
            <div className="ficha__flujo">
              {secciones
                .filter((seccion) => !seccion.ancha)
                .map((seccion) => (
                  <Seccion key={seccion.id} seccion={seccion} />
                ))}
              {id === "documentos" && ficha.aptitudes.length > 0 ? (
                <div className="ficha__aptitudes">
                  <CabeceraDeSeccion
                    procedencia="Según los datos que tenemos de él"
                    titulo="Qué se puede hacer con él"
                  />
                  {ficha.aptitudes.map((aptitud) => (
                    <FilaDeAptitud aptitud={aptitud} key={aptitud.rotulo} />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {secciones.some((seccion) => seccion.ancha) ? (
            <div className="ficha__banda">
              {secciones
                .filter((seccion) => seccion.ancha)
                .map((seccion) => (
                  <Seccion key={seccion.id} seccion={seccion} />
                ))}
            </div>
          ) : null}
        </>
      );
    }
    return (
      <div className={hayPrincipal && hayLateral ? "ficha__resumen" : "ficha__resumen ficha__resumen--una"}>
        {hayPrincipal ? (
          <div className="ficha__resumen-principal">
            {evolucion ? <div className="ficha__evolucion">{evolucion}</div> : null}
            {rentabilidades ? (
              <div aria-label="Rentabilidad por periodo (tabla desplazable)" className="ficha__rentabilidades" role="group" tabIndex={0}>
                <table className="ficha__tabla">
                  <caption className="sr-only">Rentabilidad por periodo</caption>
                  <thead>
                    <tr>
                      <th scope="col">Rentabilidad</th>
                      {rentabilidades.columnas.map((columna) => (
                        <th className="ficha__celda--cifra" key={columna} scope="col">
                          {columna}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">{tipoEnFrase(ficha.tipo)}</th>
                      {rentabilidades.celdas.map((celda, indice) => (
                        <td className="ficha__celda--cifra" key={rentabilidades.columnas[indice]}>
                          <CeldaDeRentabilidad celda={celda} />
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
                <p className="ficha__nota">
                  Las de más de un año son anualizadas; «En el año» no lo está. Quién calcula cada una, en «Rentabilidad y riesgo».
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
        {hayLateral ? (
          <div className="ficha__resumen-lateral">
            {partes ? (
              <Panel
                acciones={verPestana("cartera", "Ver la cartera")}
                subtitulo={<Texto trozos={partes.seccion.procedencia} />}
                titulo="En qué invierte"
              >
                <ListaDePartes
                  etiqueta={`${partes.seccion.titulo}: las ${partes.partes.length} primeras de ${partes.total}`}
                  partes={partes.partes}
                />
                {partes.total > partes.partes.length ? (
                  <p className="ficha__nota">{`Las ${partes.total}, en «Cartera».`}</p>
                ) : null}
              </Panel>
            ) : null}
            {costes ? (
              <Panel
                acciones={verPestana("costes", "Ver los costes")}
                subtitulo={<Texto trozos={costes.seccion.procedencia} />}
                titulo="Lo que cuesta"
              >
                {costes.filas.map((fila) => (
                  <Fila fila={fila} key={fila.rotulo} />
                ))}
              </Panel>
            ) : null}
            {objetivo ? (
              <Panel subtitulo="Del folleto, en su idioma" titulo="El fondo, en una frase">
                <p className="ficha__prosa">{objetivo.texto}</p>
                {objetivo.recortado ? verPestana("documentos", "Leer entero") : null}
              </Panel>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <article className="ficha">
      <PageHeader
        actions={acciones}
        actionsClassName="ficha__acciones"
        className="ficha__cabecera"
        description={
          <span className="ficha__identificacion">
            <span className="ficha__isin">{isin}</span>
            {/* Cada dato, entero: la línea solo se parte en un separador. Antes se partía donde caía el ancho, y a 2.000 px
                el índice salía como «JPM EMU Bond» al final de una línea e «Index 1-3» al principio de la otra. */}
            {[...restoDeLaIdentidad, ...(reparto ? [reparto] : [])].map((parte, indice) => (
              <Fragment key={`${indice}-${parte}`}>
                {" · "}
                <span className="ficha__dato">{parte}</span>
              </Fragment>
            ))}
            {" · "}
            {/* Un instrumento que dejó de cotizar se marca con la FECHA, no con un adjetivo: «Dejó de cotizar · 21 sep
                2026» no suena a pérdida de dinero. */}
            <span className={`ficha__disponibilidad ficha__disponibilidad--${disponibilidad.estado}`}>
              {disponibilidad.rotulo}
              {disponibilidad.rotulo.endsWith(" ") ? "" : " "}
              <b>{disponibilidad.valor}</b>
            </span>
            {distintivo ? <> {distintivo}</> : null}
          </span>
        }
        eyebrow={tipoEnFrase(ficha.tipo)}
        title={ficha.nombre}
      />

      <Respuesta
        abierta
        datos={respuesta.map((dato) => ({
          rotulo: dato.rotulo,
          cifra: dato.ausencia ? <Ausencia clase={dato.ausencia} motivo={dato.valor} /> : dato.valor,
          apunte: dato.apunte,
          signo: dato.ausencia ? undefined : dato.signo
        }))}
        etiqueta={`Lo esencial de ${ficha.nombre}`}
      />

      {/* De dónde sale la baja y el aviso del instrumento entero: entre la respuesta y las pestañas, como todo aviso. */}
      {disponibilidad.nota || ficha.aviso || avisos ? (
        <div className="ficha__avisos">
          {disponibilidad.nota ? (
            <Aviso tono="aviso">
              <Texto trozos={disponibilidad.nota} />
            </Aviso>
          ) : null}
          {ficha.aviso ? (
            <Aviso tono="nota">
              <Texto trozos={ficha.aviso} />
            </Aviso>
          ) : null}
          {avisos}
        </div>
      ) : null}

      <SegmentedTabs idPrefix="ficha" label="Secciones de la ficha" onChange={elegir} tabs={pestanas} value={pestana} />
      {pestanas.map(({ id }) => (
        <PanelDePestana className="ficha__panel" hidden={id !== pestana} idPrefix="ficha" key={id} pestana={id}>
          {contenidoDe(id)}
        </PanelDePestana>
      ))}
    </article>
  );
}

/**
 * La tabla de una sección. Por defecto solo la última columna es cifra —la tabla de
 * posiciones es posición, sector y peso—, y una sección puede decir cuáles lo son.
 */
/** Las filas de una tabla de ventanas que son un resultado, y por eso llevan el color de su signo (apartado 4 de SISTEMA_DISENO.md). */
const FILAS_CON_SIGNO = /^(Rentabilidad|Alfa)/;

function TablaDeSeccion({ tabla }: { tabla: NonNullable<SeccionDeFicha["tabla"]> }) {
  const cifras = new Set(tabla.cifras ?? [tabla.columnas.length - 1]);
  /* Con una o dos ventanas no hay nada que repartir a lo ancho: la cifra se quedaba a 869 px de su
     rótulo, y leerla obligaba a seguir la línea. */
  const corta = tabla.cifras !== undefined && tabla.cifras.length > 0 && tabla.columnas.length <= 3;
  return (
    <table className={corta ? "ficha__tabla ficha__tabla--corta" : "ficha__tabla"}>
      <thead>
        <tr>
          {tabla.columnas.map((columna, indice) => (
            <th
              className={cifras.has(indice) ? "ficha__celda--cifra" : undefined}
              key={columna || `col-${indice}`}
              scope="col"
            >
              {columna}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {tabla.filas.map((fila, indiceDeFila) => (
          /* Con el índice: una cartera puede traer dos líneas con el mismo nombre, y la lista no se
             reordena. */
          <tr key={`${String(fila[0])}-${indiceDeFila}`}>
            {fila.map((celda, indice) => (
              <td className={cifras.has(indice) ? "ficha__celda--cifra" : undefined} key={indice}>
                {typeof celda !== "string" ? (
                  <Ausencia clase={celda.ausencia} motivo={celda.texto} />
                ) : indice > 0 && cifras.has(indice) && FILAS_CON_SIGNO.test(String(fila[0])) ? (
                  /* Una rentabilidad o un alfa: el color de su signo, que ya va escrito. */
                  <ConSigno texto={celda} />
                ) : (
                  celda
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * La caja de estilo y tamaño: nueve casillas, con el tamaño en las filas y el estilo en las columnas, cada una con su
 * cifra escrita y con el color más intenso cuanto más pesa (14-11-2026, por decisión de Óscar: la tabla de filetes de la
 * decisión A-123, con una sola celda realzada, no se leía como una caja de estilo). Los tramos de color son los de
 * `tramoDeLaCaja`, los mismos de la radiografía. Sigue siendo una tabla de verdad para quien no ve: cada cifra tiene su
 * fila y su columna. El color no es la única señal: la cifra va en cada casilla, la mayor lleva además su contorno, y
 * la nota de la sección la nombra.
 */
/* Las clases, escritas enteras: el censo de CSS no ve un nombre que se compone en la ejecución. */
const CLASE_DEL_TRAMO: Record<TramoDeLaCaja, string> = {
  0: "ficha__caja-celda--t0",
  1: "ficha__caja-celda--t1",
  2: "ficha__caja-celda--t2",
  3: "ficha__caja-celda--t3",
  4: "ficha__caja-celda--t4"
};

function CajaDeLaSeccion({ caja }: { caja: CajaDeFicha }) {
  return (
    <table className="ficha__caja">
      <thead>
        <tr>
          <th scope="col">
            <span className="ficha__caja-ejes">Tamaño · estilo</span>
          </th>
          {caja.columnas.map((columna) => (
            <th key={columna} scope="col">
              {columna}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {caja.filas.map((fila) => (
          <tr key={fila.rotulo}>
            <th scope="row">{fila.rotulo}</th>
            {fila.celdas.map((celda, indice) => (
              <td
                className={`ficha__caja-celda ${CLASE_DEL_TRAMO[tramoDeLaCaja(celda.peso)]}${celda.destacada ? " ficha__caja-celda--mayor" : ""}`}
                key={caja.columnas[indice]}
              >
                {celda.valor}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
