import { useMemo } from "react";
import * as formato from "../../core/formato";
import * as F from "../../core/jubilacion/fiscal";
import {
  divisorDe,
  duracion,
  edadDeAgotamiento,
  eurosSinSignoEnCero,
  frasesDeEscenarios,
  libroDelPrimerAnio,
  mapaFiscal,
  metodo,
  NOMBRE_DE_LAS_UNIDADES,
  procedenciaFiscal,
  reglasEnElTiempo,
  respuestaAlMes,
  saldoAlCierre,
  serieDeIngresos,
  serieDeSaldos,
  type FormaComparada,
  type LecturaDeSupervivencia,
  type LineaDelLibro,
  type Unidades
} from "../../core/jubilacion/lectura";
import type { FilaAnual, OpcionCalculada, ResultadoDisponible } from "../../core/jubilacion/motor";
import type { CeldaDeTabla, ColumnaDeTabla } from "../../types/tablaDeDatos";
import { TablaDeDatos } from "../tabla/TablaDeDatos";
import { Aviso } from "../ui/Aviso";
import { Panel } from "../ui/Panel";
import { SegmentedControl } from "../ui/SegmentedControl";
import { GraficoDeIngresos, GraficoDeSaldos } from "./GraficosDeJubilacion";

/**
 * Lo que sale de la simulación, en dos piezas y en este orden: primero la respuesta, después las cuentas.
 *
 * `RespuestaDeJubilacion` va junto al formulario. Arriba, **una sola cifra** —lo que le queda al cliente al mes— con
 * las pocas líneas que la explican: de dónde sale y cuánto se queda el IRPF. Debajo, hasta cuándo llegan los ahorros
 * en cada caso, dicho en frases; la forma de cobrar la previsión, si la hay; y los dos gráficos, que quedan al lado
 * de los ahorros y de las hipótesis que los mueven.
 *
 * `CuentasDeJubilacion` va debajo, a todo el ancho, bajo su rótulo: el detalle fiscal del primer año, el cobro en
 * capital, la tabla año a año y el método con sus fuentes. Es lo mismo que antes iba arriba, y sigue a la vista:
 * cambia el orden, no lo que se enseña (Óscar, 13-11-2026: la salida tenía que ser más clara que la de NUVIA).
 *
 * Todas las cuentas vienen de `core/jubilacion/lectura`, las mismas que usa el informe.
 */

/** Un importe entero, por el módulo de formato: «1.817 €». */
const eurosEnteros = (valor: number): string => formato.importeTitular(valor) ?? "";
/** Un porcentaje con los decimales pedidos: «13,9 %». */
const porcentajeCon = (fraccion: number, decimales: number): string => formato.porcentaje(fraccion, { decimales }) ?? "";

const UNIDADES: ReadonlyArray<{ id: Unidades; label: string }> = [
  { id: "hoy", label: "Euros de hoy" },
  { id: "nominal", label: "Euros de cada año" }
];

const texto = (valor: string): CeldaDeTabla => ({ texto: valor });
const cifra = (valor: number): CeldaDeTabla => ({ texto: eurosSinSignoEnCero(valor), valor });
/** Un importe con su signo escrito: lo que resta lleva el menos; lo que devuelve, el más. Un cero, ninguno (PLA-03). */
const conSigno = (valor: number, signo: 1 | -1, devuelve = false): CeldaDeTabla => ({
  texto: signo === -1 ? eurosSinSignoEnCero(-valor) : devuelve ? `+${eurosSinSignoEnCero(valor)}` : eurosSinSignoEnCero(valor),
  valor: signo * valor
});

const hayPrevisionEn = (res: ResultadoDisponible): boolean => res.entrada.tieneEpsv && res.entrada.epsvPre + res.entrada.epsvPost > 0;

interface FilaDelLibro extends LineaDelLibro {
  id: string;
}

interface FilaFiscal {
  id: string;
  grupoDeFilas: string;
  cabeceraDeGrupo?: boolean;
  concepto: string;
  nota?: string;
  /** `null`: la fila no lleva importe (una cabecera, un bloque vacío). */
  anual: number | null;
  signo: 1 | -1;
  devuelve?: boolean;
}

/* ------------------------------------------------------------------ Junto al formulario --- */

interface FilaDeForma extends FormaComparada {
  id: string;
}

export function RespuestaDeJubilacion({
  resultado: res,
  unidades,
  alCambiarUnidades,
  formas,
  supervivencia
}: {
  resultado: ResultadoDisponible;
  unidades: Unidades;
  alCambiarUnidades: (unidades: Unidades) => void;
  /** La misma simulación con las tres formas de cobro, si hay previsión que cobrar. */
  formas: FormaComparada[] | null;
  /** Cuántos llegan a la edad del plan, según la tabla de mortalidad. `null` si no hay qué decir. */
  supervivencia: LecturaDeSupervivencia | null;
}) {
  const o = res.entrada;
  const T = res.textos;
  const d = divisorDe(res.anio1, unidades);
  const enUnidades = NOMBRE_DE_LAS_UNIDADES[unidades];
  const dura = duracion(res);
  const capital = res.capital;
  /* Las líneas que explican la cifra, redondeadas para que sumen la cifra que se enseña (PLA-21). */
  const lineas = useMemo(() => respuestaAlMes(res, unidades), [res, unidades]);
  const netoAlMes = lineas.find((linea) => linea.clave === "neto")?.alMes ?? Math.round(res.anio1.neto / d / 12);
  const frases = useMemo(() => frasesDeEscenarios(res, unidades), [res, unidades]);
  const ingresos = useMemo(() => serieDeIngresos(res, unidades), [res, unidades]);
  const saldos = useMemo(() => serieDeSaldos(res, unidades), [res, unidades]);

  const filasDeFormas: FilaDeForma[] = (formas ?? []).map((forma) => ({ ...forma, id: forma.forma }));
  const columnasDeFormas: ColumnaDeTabla<FilaDeForma>[] = [
    {
      id: "forma",
      titulo: "Forma de cobro",
      sinOrden: true,
      encabezaFila: true,
      celda: (forma) => ({ texto: forma.elegida ? `${forma.nombre} · la elegida` : forma.nombre, apunte: forma.edadAgotado ? `Los ahorros se agotan a los ${forma.edadAgotado}` : undefined })
    },
    { id: "mensual", titulo: "Neto al mes, primer año", cifra: true, sinOrden: true, celda: (forma) => cifra(forma.netoMensual) },
    { id: "neto", titulo: "Neto de todo el plan", cifra: true, sinOrden: true, celda: (forma) => cifra(forma.netoDelPlan) },
    {
      id: "irpf",
      titulo: "IRPF de todo el plan",
      cifra: true,
      sinOrden: true,
      celda: (forma) => ({ ...cifra(forma.irpfDelPlan), apunte: forma.irpfDelCapital !== null ? `${eurosEnteros(forma.irpfDelCapital)} del cobro de una vez` : undefined })
    },
    { id: "final", titulo: "Patrimonio al final", cifra: true, sinOrden: true, celda: (forma) => cifra(forma.patrimonioFinal) }
  ];

  return (
    <>
      <section aria-label="Resultado de la simulación" className="jubilacion-respuesta">
        <div className="jubilacion-respuesta__cabecera">
          {/* Lo primero que se lee junto a la cifra es lo que es: una simulación (Óscar, 13-11-2026). */}
          {/* No se anuncia: cambia con la edad, y lo que importa oír es la cifra (PLA-20). */}
          <p className="jubilacion-respuesta__momento">
            {"Simulación · "}
            {o.aniosHastaJubilacion
              ? `al jubilarse a los ${o.edadJubilacion}, dentro de ${o.aniosHastaJubilacion} ${o.aniosHastaJubilacion === 1 ? "año" : "años"}`
              : `primer año de jubilación, a los ${o.edadJubilacion}`}
            {" · media mensual del año · "}
            {enUnidades}
          </p>
          <SegmentedControl label="Unidades de los importes" onChange={alCambiarUnidades} options={UNIDADES} value={unidades} />
        </div>
        <div className="jubilacion-respuesta__cuerpo">
          {/* Una cifra, no cuatro: el bruto y el IRPF son las líneas que la explican, a su lado. */}
          {/* La respuesta se anuncia cuando cambia, con su apunte (PLA-20). */}
          <p aria-live="polite" className="jubilacion-respuesta__cifra">
            <span className="jubilacion-respuesta__rotulo">Ingreso neto</span>
            <strong className="jubilacion-respuesta__valor">
              {eurosSinSignoEnCero(netoAlMes)} <span>al mes</span>
            </strong>
            <span className="jubilacion-respuesta__apunte">
              Después del {T.irpf}. {dura.titulo}.
            </span>
          </p>
          <div className="rows jubilacion-libro">
            {lineas.map((linea) => (
              <div className={`rows__item jubilacion-libro__linea jubilacion-libro__linea--${linea.clase}`} key={linea.clave}>
                <span className="rows__label">{linea.concepto}</span>
                <span className="rows__value">{eurosSinSignoEnCero(linea.alMes)}</span>
              </div>
            ))}
          </div>
        </div>
        {/* El cobro de una vez no es una mensualidad: se dice aparte, para que el IRPF del mes no se lea como todo el del año. */}
        {capital ? (
          <p className="cmp-note">
            Aparte, el cobro {T.de} de una vez: {eurosSinSignoEnCero(capital.bruto / d)} brutos, {eurosSinSignoEnCero(-capital.impuesto / d)} de IRPF y {eurosSinSignoEnCero(capital.neto / d)} netos, que se suman a
            los ahorros.
            {/* JUB-7 (auditoría del 16-11-2026): aquí va en las unidades de la cifra de arriba y la tabla del cobro, en euros del
                año del cobro. Con la jubilación en el futuro son dos cifras distintas del mismo cobro, y se dice por qué. */}
            {d !== 1 ? ` Van en ${enUnidades}; en la tabla del cobro en capital, en euros del año del cobro.` : null}
          </p>
        ) : null}
      </section>

      {/* Lado a lado donde caben: en un monitor ancho, la columna del resultado da para dos. */}
      {frases || formas ? (
        <div className="jubilacion-pareja">
          {frases ? (
            <Panel
              claseDelCuerpo="stack stack--tight"
              subtitulo={`Rentabilidades elegidas para simular, no previstas ni prometidas · las mismas retiradas en todos los casos · ${enUnidades}`}
              titulo="Hasta cuándo llegan los ahorros"
            >
              <div className="rows jubilacion-frases">
                {frases.map((frase) => (
                  <div className={`rows__item jubilacion-frase${frase.seAgota ? " jubilacion-frase--agota" : ""}`} key={frase.clave}>
                    <span className="rows__label">{frase.caso}</span>
                    <span className="rows__value">{frase.resultado}</span>
                  </div>
                ))}
              </div>
              {/* La otra mitad de la edad del plan: cuántos llegan a ella. Con su fuente y con lo que no es. */}
              {supervivencia ? (
                <p className="cmp-note">
                  <strong>{supervivencia.frase}</strong>
                  {supervivencia.consecuencia ? ` ${supervivencia.consecuencia}` : ""} {supervivencia.fuente}.{supervivencia.disponible ? ` ${supervivencia.limite}` : ""}
                </p>
              ) : null}
            </Panel>
          ) : null}
          {formas ? (
            <Panel
              claseDelCuerpo="stack stack--tight"
              rotulo={T.Figura}
              subtitulo="La misma simulación con cada forma de cobro; lo demás no cambia · euros de hoy"
              titulo="En renta, de una vez o parte de cada forma"
            >
              <TablaDeDatos columnas={columnasDeFormas} filas={filasDeFormas} titulo={`Las tres formas de cobrar ${T.la}, con las mismas hipótesis`} />
              <p className="cmp-note">
                Suma de todos los años del plan, descontada solo la inflación. Las cifras no dicen cuál conviene: depende de cuánto necesite cobrar el cliente y cuándo.
              </p>
            </Panel>
          ) : null}
        </div>
      ) : null}

      <div className="jubilacion-pareja">
        <Panel
          claseDelCuerpo="stack stack--tight"
          subtitulo={`Media mensual de cada año · pensión y retiradas con un IPC del ${porcentajeCon(o.inflacion, 1)} · ${reglasEnElTiempo(res)} · ${enUnidades}`}
          titulo="El ingreso de cada año"
        >
          <GraficoDeIngresos edadAgotado={edadDeAgotamiento(res.base)} figura={T.vasco ? "EPSV" : "Plan"} serie={ingresos} />
          <p className="cmp-note">La altura de cada barra es lo cobrado en bruto; el tramo gris, el IRPF. El detalle de cada año está en la tabla «Año a año».</p>
        </Panel>

        <Panel
          claseDelCuerpo="stack stack--tight"
          subtitulo={`Todos los escenarios retiran lo mismo que el plan: solo cambia lo que rinde el patrimonio · ${enUnidades}`}
          titulo="Cuánto dura el patrimonio"
        >
          <GraficoDeSaldos escenarios={res.escenarios} serie={saldos} />
        </Panel>
      </div>
    </>
  );
}

/* --------------------------------------------------------------------- A todo el ancho --- */

interface FilaDeCapital extends OpcionCalculada {
  id: string;
  aplicada: boolean;
}

interface FilaDelAnio {
  id: string;
  fila: FilaAnual;
}

export function CuentasDeJubilacion({ resultado: res, unidades }: { resultado: ResultadoDisponible; unidades: Unidades }) {
  const o = res.entrada;
  const T = res.textos;
  const d = divisorDe(res.anio1, unidades);
  const enUnidades = NOMBRE_DE_LAS_UNIDADES[unidades];
  const procedencia = procedenciaFiscal(res.cfg);
  const hayPrevision = hayPrevisionEn(res);

  const libro = useMemo(() => libroDelPrimerAnio(res), [res]);
  const neto = libro[libro.length - 1];
  const filasDelLibro: FilaDelLibro[] = libro.slice(0, -1).map((linea) => ({ ...linea, id: linea.clave }));
  const importeDelLibro = (linea: LineaDelLibro, porMes: boolean): CeldaDeTabla =>
    conSigno(linea.anual / d / (porMes ? 12 : 1), linea.signo, linea.clave === "deducciones");
  const columnasDelLibro: ColumnaDeTabla<FilaDelLibro>[] = [
    { id: "concepto", titulo: "Concepto", sinOrden: true, encabezaFila: true, celda: (linea) => ({ texto: linea.concepto, apunte: linea.nota }) },
    { id: "mes", titulo: "Al mes", cifra: true, sinOrden: true, celda: (linea) => importeDelLibro(linea, true) },
    { id: "anio", titulo: "Al año", cifra: true, sinOrden: true, celda: (linea) => importeDelLibro(linea, false) }
  ];

  const mapa = useMemo(() => mapaFiscal(res), [res]);
  const filasFiscales: FilaFiscal[] = mapa.bloques.flatMap((bloque) => [
    { id: bloque.clave, grupoDeFilas: bloque.clave, cabeceraDeGrupo: true, concepto: bloque.titulo, nota: bloque.escala, anual: null, signo: 1 as const },
    ...bloque.partidas.map((partida, i): FilaFiscal => ({ id: `${bloque.clave}-${i}`, grupoDeFilas: bloque.clave, concepto: partida.concepto, nota: partida.nota, anual: partida.anual, signo: partida.resta ? -1 : 1 })),
    ...(bloque.vacio ? [{ id: `${bloque.clave}-vacio`, grupoDeFilas: bloque.clave, concepto: bloque.vacio, anual: null, signo: 1 as const }] : []),
    ...(bloque.cuota !== null
      ? [
          {
            id: `${bloque.clave}-cuota`,
            grupoDeFilas: bloque.clave,
            concepto: "Impuesto de esta base",
            nota: bloque.marginal ? `Tipo marginal: ${porcentajeCon(bloque.marginal, 1)}` : undefined,
            anual: bloque.cuota,
            signo: -1 as const
          }
        ]
      : [])
  ]);
  filasFiscales.push(
    { id: "cuota", grupoDeFilas: "cuota", cabeceraDeGrupo: true, concepto: "En la cuota", nota: mapa.deducciones ? undefined : mapa.sinDeducciones, anual: null, signo: 1 },
    ...(mapa.deducciones ? [{ id: "cuota-deducciones", grupoDeFilas: "cuota", concepto: "Deducciones", nota: mapa.deducciones.conceptos, anual: mapa.deducciones.anual, signo: 1 as const, devuelve: true }] : [])
  );
  const importeFiscal = (fila: FilaFiscal, porMes: boolean): CeldaDeTabla =>
    fila.anual === null ? texto("") : conSigno(fila.anual / d / (porMes ? 12 : 1), fila.signo, fila.devuelve);
  const columnasFiscales: ColumnaDeTabla<FilaFiscal>[] = [
    { id: "concepto", titulo: "Concepto", sinOrden: true, encabezaFila: true, celda: (fila) => ({ texto: fila.concepto, apunte: fila.nota }) },
    { id: "mes", titulo: "Al mes", cifra: true, sinOrden: true, celda: (fila) => importeFiscal(fila, true) },
    { id: "anio", titulo: "Al año", cifra: true, sinOrden: true, celda: (fila) => importeFiscal(fila, false) }
  ];

  const capital = res.capital;
  const pv = res.parametros.prevision;
  const filasDeCapital: FilaDeCapital[] = capital ? capital.opciones.map((opcion) => ({ ...opcion, id: opcion.clave, aplicada: capital.opciones.length > 1 && capital.elegido === opcion.clave })) : [];
  const columnasDeCapital: ColumnaDeTabla<FilaDeCapital>[] = [
    {
      id: "regimen",
      titulo: "Régimen",
      sinOrden: true,
      encabezaFila: true,
      celda: (opcion) => ({ texto: opcion.aplicada ? `${opcion.titulo} · aplicado` : opcion.titulo, apunte: opcion.sub })
    },
    { id: "bruto", titulo: "Cobro bruto", cifra: true, sinOrden: true, celda: (opcion) => cifra(opcion.bases.bruto) },
    ...(pv.modelo === "reduccion"
      ? [
          {
            id: "reduccion",
            titulo: `Reducción del ${porcentajeCon(pv.reduccion, 0)}`,
            cifra: true,
            sinOrden: true,
            celda: (opcion: FilaDeCapital) => conSigno(opcion.bases.detalle.reduccion ?? 0, -1)
          }
        ]
      : []),
    { id: "general", titulo: "A la base general", cifra: true, sinOrden: true, celda: (opcion) => cifra(opcion.bases.general) },
    ...(pv.modelo === "vasco" ? [{ id: "ahorro", titulo: "A la base del ahorro", cifra: true, sinOrden: true, celda: (opcion: FilaDeCapital) => cifra(opcion.bases.ahorro) }] : []),
    { id: "impuesto", titulo: "IRPF que añade", cifra: true, sinOrden: true, celda: (opcion) => conSigno(opcion.impuesto, -1) },
    { id: "neto", titulo: "Neto", cifra: true, sinOrden: true, celda: (opcion) => cifra(opcion.neto) }
  ];

  const filasDeAnios: FilaDelAnio[] = res.base.filas.map((fila) => ({ id: String(fila.anio), fila }));
  const delAnio =
    (importe: (fila: FilaAnual) => number, signo: 1 | -1 = 1) =>
    ({ fila }: FilaDelAnio): CeldaDeTabla =>
      conSigno(importe(fila) / divisorDe(fila, unidades), signo);
  const columnasDeAnios: ColumnaDeTabla<FilaDelAnio>[] = [
    { id: "edad", titulo: "Edad", sinOrden: true, encabezaFila: true, celda: ({ fila }) => ({ texto: String(fila.edad), valor: fila.edad }) },
    { id: "pension", titulo: "Pensión bruta", cifra: true, sinOrden: true, celda: delAnio((fila) => fila.pension) },
    { id: "ahorros", titulo: "Retirada de ahorros", cifra: true, sinOrden: true, celda: delAnio((fila) => fila.retiradaAhorros) },
    ...(hayPrevision ? [{ id: "prevision", titulo: T.Figura, cifra: true, sinOrden: true, celda: delAnio((fila) => fila.retiradaEpsv) }] : []),
    { id: "bruto", titulo: "Bruto", cifra: true, sinOrden: true, celda: delAnio((fila) => fila.bruto) },
    { id: "irpf", titulo: "IRPF", cifra: true, sinOrden: true, celda: delAnio((fila) => fila.impuesto, -1) },
    { id: "neto", titulo: "Neto", cifra: true, sinOrden: true, celda: delAnio((fila) => fila.neto) },
    { id: "mensual", titulo: "Neto al mes", cifra: true, sinOrden: true, celda: delAnio((fila) => fila.neto / 12) },
    { id: "saldo", titulo: "Ahorros al cierre", cifra: true, sinOrden: true, celda: ({ fila }) => cifra(saldoAlCierre(fila, o.inflacion, unidades)) }
  ];

  const comoSeCalcula = useMemo(() => metodo(res), [res]);
  const escalas: Array<{ titulo: string; tramos: F.Escala }> = [
    { titulo: res.cfg.modelo === "comun" ? "Escala de la base general (estatal más autonómica)" : "Escala de la base general", tramos: res.parametros.escalaGeneralVisible },
    { titulo: res.cfg.modelo === "comun" ? "Escala de la base del ahorro (estatal más autonómica)" : "Escala de la base del ahorro", tramos: res.parametros.escalaAhorro },
    ...(res.cfg.modelo === "comun" && res.parametros.escalaAutonomica
      ? [
          { titulo: "Parte estatal de la base general (art. 63)", tramos: res.parametros.escalaGeneral },
          { titulo: res.cfg.ccaa?.referencia ? "Escala de referencia (art. 65)" : `Escala autonómica · ${res.cfg.ccaa?.nombre ?? ""}`, tramos: res.parametros.escalaAutonomica }
        ]
      : [])
  ];

  return (
    <>
      <div className="jubilacion-nivel">
        <h2 className="jubilacion-nivel__titulo">Las cuentas, para comprobarlas</h2>
        <p className="jubilacion-nivel__texto">El detalle fiscal del primer año, la tabla de cada año, el método y las fuentes.</p>
      </div>

      {/* Lado a lado donde caben: en un monitor ancho, una sola tabla de tres columnas deja la cifra a un palmo de su rótulo. */}
      <div className="jubilacion-pareja">
        {/* Los paneles de las cuentas van bajo su `h2`, «Las cuentas, para comprobarlas»: son `h3` (MAR-32). */}
        <Panel nivel={3} rotulo="Primer año de jubilación" subtitulo={`${procedencia} · ${enUnidades}`} titulo="Del bruto al neto">
          <TablaDeDatos
            columnas={columnasDelLibro}
            filas={filasDelLibro}
            pie={(columna) => (columna.id === "mes" ? cifra(neto.anual / d / 12) : columna.id === "anio" ? cifra(neto.anual / d) : undefined)}
            rotuloDelPie="Ingreso neto"
            titulo="Del ingreso bruto al neto en el primer año de jubilación"
          />
        </Panel>

        <Panel nivel={3} rotulo="Primer año de jubilación" subtitulo={`${procedencia} · ${enUnidades}`} titulo="Qué tributa y dónde">
          <TablaDeDatos
            agrupada
            columnas={columnasFiscales}
            filas={filasFiscales}
            pie={(columna) => (columna.id === "mes" ? conSigno(mapa.total / d / 12, -1) : columna.id === "anio" ? conSigno(mapa.total / d, -1) : undefined)}
            rotuloDelPie={`IRPF del año · ${porcentajeCon(mapa.sobreElBruto, 1)} de lo cobrado en bruto`}
            titulo="A qué base va cada ingreso del primer año y qué impuesto sale de cada una"
          />
        </Panel>
      </div>

      {capital ? (
        <Panel claseDelCuerpo="stack stack--tight" nivel={3} rotulo={`${T.Figura} · cobro de una vez`} subtitulo={`${procedencia} · euros del año del cobro`} titulo="Lo que queda del cobro en capital">
          <TablaDeDatos columnas={columnasDeCapital} filas={filasDeCapital} titulo={`Cobro ${T.de} de una vez: bases, impuesto y neto`} />
          <p className="cmp-note">
            El impuesto es el que este cobro añade al IRPF del primer año, y no está en «Del bruto al neto». Lo neto se suma a los ahorros y se reparte en el plan.{" "}
            {capital.bases.conReduccion
              ? pv.modelo === "vasco"
                ? `Se aplica la reducción por primer cobro, hasta ${eurosEnteros(pv.limite)}.`
                : `Se aplica la reducción del ${porcentajeCon(pv.reduccion, 0)} a la parte que deriva de aportaciones anteriores a ${pv.corte}.`
              : "No se aplica reducción: no se cumplen las condiciones del cobro."}{" "}
            {capital.opciones.length > 1
              ? `${capital.automatico ? "Se aplica el régimen de menor impuesto estimado. " : ""}Es una comparación de cálculo: el régimen que corresponde lo confirma la EPSV.`
              : `La parte de los derechos anterior a ${pv.corte} la certifica la entidad gestora.`}
          </p>
        </Panel>
      ) : null}

      <Panel claseDelCuerpo="jubilacion-anios" nivel={3} subtitulo={`Importes anuales · ${procedencia} · ${enUnidades}`} titulo="Año a año">
        <TablaDeDatos columnas={columnasDeAnios} filas={filasDeAnios} titulo="El plan año a año: pensión, retiradas, IRPF, neto y ahorros al cierre" />
      </Panel>

      {/* Siete secciones largas: el método, sus límites, los parámetros, las escalas, la norma y las fuentes. Son para
          comprobar, no para leer cada vez, y empiezan plegadas. Plegadas siguen en la página: no se ocultan en Modo
          cliente ni dejan de imprimirse con su panel. */}
      <Panel nivel={3} plegable subtitulo={`${T.nombre} · ${procedencia}`} titulo="El método y las fuentes">
        <div className="jubilacion-carriles">
          <section className="stack stack--3">
            <h4 className="section-label">El método</h4>
            <ol className="jubilacion-lista">
              {comoSeCalcula.pasos.map((paso) => (
                <li key={paso.titulo}>
                  <strong>{paso.titulo}.</strong> {paso.texto}
                </li>
              ))}
            </ol>
          </section>
          <section className="stack stack--3">
            <h4 className="section-label">Lo que no tiene en cuenta</h4>
            <ul className="jubilacion-lista">
              {comoSeCalcula.noTieneEnCuenta.map((limite) => (
                <li key={limite}>{limite}</li>
              ))}
            </ul>
          </section>
          <section className="stack stack--3">
            <h4 className="section-label">Parámetros de {res.cfg.ejercicio}</h4>
            <ul className="jubilacion-lista">
              {F.resumenParametros(res.cfg).map((parametro) => (
                <li key={parametro}>{parametro}</li>
              ))}
            </ul>
          </section>
          {escalas.map((escala) => (
            <section className="stack stack--3" key={escala.titulo}>
              <h4 className="section-label">{escala.titulo}</h4>
              <div className="rows">
                {escala.tramos.map(([desde, tipo], i) => (
                  <div className="rows__item" key={desde}>
                    <span className="rows__label">{i + 1 < escala.tramos.length ? `De ${eurosEnteros(desde)} a ${eurosEnteros(escala.tramos[i + 1][0])}` : `Más de ${eurosEnteros(desde)}`}</span>
                    <span className="rows__value">{F.tipoEscrito(tipo)}</span>
                  </div>
                ))}
              </div>
            </section>
          ))}
          <section className="stack stack--3">
            <h4 className="section-label">Normativa aplicada</h4>
            <ul className="jubilacion-lista">
              {res.cfg.normativa.map(([norma, queRegula]) => (
                <li key={norma}>
                  <strong>{norma}</strong> {queRegula}
                </li>
              ))}
            </ul>
          </section>
          <section className="stack stack--3">
            <h4 className="section-label">Fuentes oficiales, consultadas {F.consultaFuentes(res.cfg)}</h4>
            <ul className="jubilacion-lista">
              {res.cfg.fuentes.map((fuente) => (
                <li key={fuente.href}>
                  <a href={fuente.href} rel="noopener noreferrer" target="_blank">
                    {fuente.k} · {fuente.t}
                  </a>
                  {fuente.d ? ` ${fuente.d}` : ""}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </Panel>

      <Aviso className="jubilacion-pie" titulo="Simulación." tono="nota">
        Calculada con las reglas del {T.irpf} de {res.cfg.ejercicio}
        {res.cfg.ccaa ? ` (${res.cfg.ccaa.nombre})` : ""} y con una rentabilidad y una inflación elegidas para simular: no son una previsión ni una promesa. No es una liquidación
        tributaria, ni asesoramiento fiscal personalizado, ni una recomendación de inversión. El cálculo se hace en este equipo: los datos del cliente no se guardan ni se envían.
      </Aviso>
    </>
  );
}
