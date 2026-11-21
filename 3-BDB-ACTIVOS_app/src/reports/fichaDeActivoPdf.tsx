/* eslint-disable react-refresh/only-export-components */
// La ficha de un activo en papel (decisión A-124), con la plantilla única de informes (`./plantilla`): A4 vertical, papel
// blanco, la identidad del asesor en la cabecera y el tema según para quién sale: interno (acero, «USO INTERNO») en la
// pantalla normal y de cliente (granate, «CONFIDENCIAL») cuando se genera en Modo cliente.
//
// Imprime EXACTAMENTE el modelo que la pantalla enseña: un `FichaInstrumento` compuesto por `componerFicha` con el `modoCliente`
// que la pantalla tiene en ese momento. No vuelve a decidir nada: en Modo cliente no salen datos del emisor ni cifras apartadas
// porque el modelo ya no los trae, y lo que no está en el modelo no está en el papel. Las secciones van en el orden en que la
// pantalla las lee —las de las columnas, de dos en dos, y después las anchas— y cada una con su procedencia y su fecha bajo el título.
//
// La única excepción la decidió Óscar (decisión A-126, 09-11-2026): en Modo cliente el papel no lleva la tira «Qué puedes hacer
// con él» ni «Disponibilidad · Sin medir». Las dos hablan al asesor —si entra en una radiografía, si hay métricas nuestras, si
// hemos comprobado que cotiza— y el papel se entrega. La pantalla en Modo cliente las sigue enseñando: la mira el asesor.

import { StyleSheet, View } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { descargar, diaDelDocumento, nombreDelFichero } from "../core/descargaDeFicheros";
import { fecha, fechaYHora, numero, oFalta } from "../core/formato";
import { leerIdentidad } from "../core/identidadDelAsesor";
import type {
  CajaDeFicha,
  CeldaDeSeccion,
  ClaseDeAusencia,
  EvolucionDeLaFicha,
  FichaInstrumento,
  FilaDeFicha,
  SeccionDeFicha,
  Trozo
} from "../types/fichaInstrumento";
import {
  Aviso,
  AvisoLegal,
  DocumentoDeInforme,
  FUENTE,
  GraficoDeLineas,
  Hoja,
  ListaDePartes,
  MEDIDAS,
  PAPEL,
  Parrafo,
  Presentacion,
  Rejilla,
  RAMPA_DEL_TEMA,
  Tabla,
  Texto,
  TEMAS,
  TituloDeSeccion,
  anchoUtil,
  renderizarInforme,
  useInforme,
  type CeldaDeTabla,
  type IdentidadDelAsesor,
  type TemaDeInforme
} from "./plantilla";

/* El ancho útil de la hoja vertical y dos columnas de lo mismo con su calle. */
const CAJA = anchoUtil(false);
const CALLE = 24;
const COLUMNA = (CAJA - CALLE) / 2;

export interface FichaDeActivoPdfInput {
  /** El modelo que la pantalla está enseñando, compuesto con su mismo `modoCliente`. */
  ficha: FichaInstrumento;
  /** El ISIN, para la presentación y el nombre del fichero. */
  isin: string;
  /** El modo de la pantalla al pedirlo. Decide el tema, la cabecera y el nombre: el contenido ya viene filtrado en `ficha`. */
  modoCliente: boolean;
  /** Cuándo se genera. */
  generado: Date;
  /** La fecha de la ficha: cuándo compuso la base la tarjeta que se lee (`read/card.computed_at`). Sin ella, la presentación lo dice. */
  datosA?: string;
  /** La evolución que la ficha tiene cargada. Sin ella no se dibuja nada. */
  evolucion?: EvolucionDeLaFicha | null;
  /** Quién firma. Sin ella, la que el asesor guardó en este navegador (`leerIdentidad`). */
  identidad?: IdentidadDelAsesor;
}

const enUnaLinea = (trozos: readonly Trozo[]) => trozos.map((trozo) => trozo.texto).join("");

/** «09/11/2026 21:52», en la hora de quien lo genera. */
export function momentoDeGeneracion(fecha: Date): string {
  return oFalta(fechaYHora(fecha));
}

/**
 * La línea de procedencia del documento: cuándo, con qué base y para quién, con el formato común («09/11/2026 21:52»). La fecha
 * es la de la base (cuándo compuso la tarjeta), no la de cada cifra: esa la lleva su sección, y escribir «datos a» la hacía
 * pasar por la fecha del dato.
 */
export function lineaDelPie({ generado, datosA, modoCliente }: Pick<FichaDeActivoPdfInput, "generado" | "datosA" | "modoCliente">): string {
  const delDia = datosA ? fecha(datosA) : null;
  const datos = delDia ? `base de datos del ${delDia}` : "base de datos sin fecha";
  return `Generado el ${fechaYHora(generado) ?? ""} · ${datos} · ${modoCliente ? "para el cliente" : "modo interno"}`;
}

/** Lo que el documento dice de sí mismo en la cabecera y en el nombre del fichero. */
const DOCUMENTO = "Ficha de activo";

/**
 * «Ficha de activo - <nombre del activo> - 2026-11-09.pdf», con la convención común (`core/descargaDeFicheros.ts`). Sin nombre, el ISIN.
 * La fecha es la del día en que se genera, en la hora local. La de la pantalla normal es de uso interno y lo dice junto al documento,
 * como la comparativa de activos: es la que no se puede confundir con la que se entrega (la del Modo cliente).
 */
export function nombreDelFicheroDeLaFicha({ ficha, isin, generado, modoCliente }: Pick<FichaDeActivoPdfInput, "isin" | "generado" | "modoCliente"> & { ficha?: Pick<FichaInstrumento, "nombre"> }): string {
  return nombreDelFichero({
    documento: modoCliente ? DOCUMENTO : `${DOCUMENTO} (uso interno)`,
    de: ficha?.nombre?.trim() || isin,
    fecha: diaDelDocumento(generado)
  });
}

/**
 * Las secciones en el orden en que se leen en pantalla: las del flujo de columnas, en su orden, y después las de la banda ancha.
 * Las del flujo van de dos en dos en el papel, que es el orden de lectura de una hoja: izquierda, derecha, abajo.
 */
export function bloquesDelPapel(ficha: FichaInstrumento): Array<{ estrechas: SeccionDeFicha[] } | { ancha: SeccionDeFicha }> {
  const estrechas = ficha.secciones.filter((seccion) => !seccion.ancha);
  const anchas = ficha.secciones.filter((seccion) => seccion.ancha);
  const pares: Array<{ estrechas: SeccionDeFicha[] }> = [];
  for (let indice = 0; indice < estrechas.length; indice += 2) pares.push({ estrechas: estrechas.slice(indice, indice + 2) });
  return [...pares, ...anchas.map((ancha) => ({ ancha }))];
}

/* Lo que no está, en papel, va siempre en gris (la tinta 3) y en letra pequeña: el ocre es el color de los avisos, no el
   de un dato que falta. La frase dice cuál de las tres ausencias es. */
const COLOR_DE_AUSENCIA: Record<ClaseDeAusencia, string> = {
  "no-aplica": PAPEL.tinta3,
  falta: PAPEL.tinta3,
  "sin-pedir": PAPEL.tinta3
};

const M = MEDIDAS;

const s = StyleSheet.create({
  par: { flexDirection: "row", justifyContent: "space-between" },
  columna: { width: COLUMNA },

  fila: { flexDirection: "row", alignItems: "flex-end", paddingVertical: 3, borderBottomWidth: M.tabla.filete, borderBottomColor: PAPEL.filete },
  filaRotulo: { flexGrow: 1, flexShrink: 1, fontSize: M.tabla.celda, color: PAPEL.tinta2, lineHeight: 1.3, paddingRight: 8 },
  filaValor: { fontSize: M.tabla.celda, color: PAPEL.tinta, lineHeight: 1.3, textAlign: "right", maxWidth: "58%" },
  filaValorDestacado: { fontSize: M.cifras.cifra, fontWeight: 600, color: PAPEL.tinta, lineHeight: 1.2, textAlign: "right" },
  filaValorAusente: { fontSize: M.tabla.apunte, lineHeight: 1.3, textAlign: "right", maxWidth: "58%" },
  filaLarga: { paddingVertical: 4, borderBottomWidth: M.tabla.filete, borderBottomColor: PAPEL.filete },
  filaLargaValor: { fontSize: M.tabla.celda, color: PAPEL.tinta, lineHeight: 1.45, marginTop: 1.5 },
  glosa: { fontSize: M.tabla.apunte, color: PAPEL.tinta3, lineHeight: 1.4, paddingTop: 1, paddingBottom: 3, borderBottomWidth: M.tabla.filete, borderBottomColor: PAPEL.filete },

  nota: { fontSize: M.seccion.procedencia, color: PAPEL.tinta2, lineHeight: 1.45, marginTop: 5 },
  cita: { marginTop: 7, paddingLeft: M.nota.sangria, borderLeftWidth: M.nota.filete, fontFamily: FUENTE.serifa, fontSize: M.cuerpo.letra, color: PAPEL.tinta, lineHeight: 1.5 },

  cajaFila: { flexDirection: "row", borderBottomWidth: M.tabla.filete, borderBottomColor: PAPEL.filete },
  cajaCabecera: { flexDirection: "row", borderBottomWidth: M.tabla.filete, borderBottomColor: PAPEL.fileteFuerte },
  cajaEsquina: { width: "28%", fontSize: M.tabla.cabecera, color: PAPEL.tinta3, lineHeight: 1.3, paddingVertical: M.tabla.rellenoVertical },
  cajaColumna: { width: "24%", fontSize: M.tabla.cabecera, fontWeight: 600, color: PAPEL.tinta3, lineHeight: 1.3, textAlign: "right", paddingVertical: M.tabla.rellenoVertical, paddingRight: 6 },
  cajaRotulo: { width: "28%", fontSize: M.tabla.celda, color: PAPEL.tinta2, lineHeight: 1.3, paddingVertical: 6 },
  cajaCelda: { width: "24%", borderLeftWidth: M.tabla.filete, borderLeftColor: PAPEL.filete, paddingVertical: 6, paddingRight: 6 },
  cajaCifra: { fontSize: M.tabla.celda, color: PAPEL.tinta2, lineHeight: 1.3, textAlign: "right" },
  cajaCifraMayor: { fontSize: M.tabla.celda, fontWeight: 600, color: PAPEL.tinta, lineHeight: 1.3, textAlign: "right" },

  cierre: { marginTop: 18 }
});

/** El relleno de la celda con más peso de la caja: el segundo paso de la rampa del tema (crema de bronce o acero muy claro). Es el dato el que lleva el color. */
const rellenoDeLaMayor = (tema: TemaDeInforme) => RAMPA_DEL_TEMA[tema][2];

/** Una fila de rótulo y cifra; larga, un texto corrido. */
function Fila({ fila }: { fila: FilaDeFicha }) {
  if (fila.larga) {
    return (
      <View style={s.filaLarga} wrap={false}>
        <Texto style={s.filaRotulo}>{fila.rotulo}</Texto>
        <Texto style={[s.filaLargaValor, fila.ausencia ? { color: COLOR_DE_AUSENCIA[fila.ausencia], fontSize: M.tabla.apunte } : {}]}>{fila.valor}</Texto>
        {fila.glosa ? <Texto style={[s.nota, { marginTop: 1 }]}>{fila.glosa}</Texto> : null}
      </View>
    );
  }
  const conGlosa = Boolean(fila.glosa);
  const estiloDelValor = fila.ausencia
    ? [s.filaValorAusente, { color: COLOR_DE_AUSENCIA[fila.ausencia] }]
    : fila.destacada
      ? [s.filaValorDestacado]
      : [s.filaValor];
  return (
    <View wrap={false}>
      <View style={[s.fila, conGlosa ? { borderBottomWidth: 0 } : {}]}>
        <Texto style={s.filaRotulo}>{fila.rotulo}</Texto>
        <Texto style={estiloDelValor}>{fila.valor}</Texto>
      </View>
      {conGlosa ? <Texto style={s.glosa}>{fila.glosa ?? ""}</Texto> : null}
    </View>
  );
}

/** Las filas de una sección: las de un reparto (con `peso`) seguidas van juntas en una lista de partes, con su barra. */
function Filas({ filas, ancho }: { filas: readonly FilaDeFicha[]; ancho: number }) {
  const grupos: Array<{ partes: FilaDeFicha[] } | { fila: FilaDeFicha }> = [];
  for (const fila of filas) {
    const esParte = typeof fila.peso === "number" && !fila.ausencia && !fila.larga;
    const ultimo = grupos[grupos.length - 1];
    if (esParte && ultimo && "partes" in ultimo) ultimo.partes.push(fila);
    else grupos.push(esParte ? { partes: [fila] } : { fila });
  }
  /* Las barras de un reparto se miden contra la mayor de su sección: la más larga llena la pista, y la cifra va escrita al lado. */
  return (
    <>
      {grupos.map((grupo, indice) =>
        "partes" in grupo ? (
          <ListaDePartes
            key={`partes-${indice}`}
            ancho={ancho}
            partes={grupo.partes.map((fila) => ({ nombre: fila.rotulo, fraccion: fila.peso ?? null, cifra: fila.valor }))}
          />
        ) : (
          <Fila fila={grupo.fila} key={`${grupo.fila.rotulo}-${indice}`} />
        )
      )}
    </>
  );
}

function celdaDeTabla(celda: CeldaDeSeccion): CeldaDeTabla {
  return typeof celda === "string" ? celda : { texto: null, motivo: celda.texto };
}

/** Las métricas y la cartera, en la tabla de la plantilla: la primera columna más ancha y las cifras a la derecha. */
function TablaDeLaSeccion({ tabla }: { tabla: NonNullable<SeccionDeFicha["tabla"]> }) {
  const cifras = new Set(tabla.cifras ?? [tabla.columnas.length - 1]);
  /* Sin columnas de cifra declaradas, la de posiciones: posición ancha, sector, peso. Con ellas, rótulo y ventanas iguales. */
  const anchoDe = (indice: number) =>
    tabla.cifras === undefined ? ([3.2, 1.7, 0.8][indice] ?? 1) : indice === 0 ? Math.max(1.6, tabla.columnas.length * 0.42) : 1;
  return (
    <Tabla
      columnas={tabla.columnas.map((titulo, indice) => ({ titulo, ancho: anchoDe(indice), cifra: cifras.has(indice) }))}
      filas={tabla.filas.map((fila) => ({ celdas: fila.map(celdaDeTabla) }))}
    />
  );
}

/** La caja de estilo y tamaño (decisión A-123), tres por tres: filetes entre celdas, la cifra siempre impresa y la mayor rellena. */
function Caja({ caja }: { caja: CajaDeFicha }) {
  const { tema } = useInforme();
  return (
    <View style={{ marginTop: 4 }} wrap={false}>
      <View style={s.cajaCabecera}>
        <Texto style={s.cajaEsquina}>Tamaño · estilo</Texto>
        {caja.columnas.map((columna) => (
          <Texto key={columna} style={s.cajaColumna}>{columna}</Texto>
        ))}
      </View>
      {caja.filas.map((fila) => (
        <View key={fila.rotulo} style={s.cajaFila}>
          <Texto style={s.cajaRotulo}>{fila.rotulo}</Texto>
          {fila.celdas.map((celda, indice) => (
            <View key={caja.columnas[indice]} style={celda.destacada ? [s.cajaCelda, { backgroundColor: rellenoDeLaMayor(tema) }] : [s.cajaCelda]}>
              <Texto style={celda.destacada ? s.cajaCifraMayor : s.cajaCifra}>{celda.valor}</Texto>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/** Un texto citado del proveedor, en su idioma: filete del color del tema a la izquierda, sin relleno, y se parte si es largo. */
function Cita({ children }: { children: string }) {
  const { tema } = useInforme();
  return <Texto style={[s.cita, { borderLeftColor: TEMAS[tema].color }]}>{children}</Texto>;
}

/** Lo de una sección del modelo, en el orden de la pantalla: aviso, filas, caja, prosa, tabla, nota, contradicción. */
function Contenido({ seccion, ancho }: { seccion: SeccionDeFicha; ancho: number }) {
  return (
    <>
      {seccion.aviso ? <Aviso>{enUnaLinea(seccion.aviso)}</Aviso> : null}
      <Filas ancho={ancho} filas={seccion.filas} />
      {seccion.caja ? <Caja caja={seccion.caja} /> : null}
      {seccion.prosa ? <Cita>{`«${seccion.prosa}»`}</Cita> : null}
      {seccion.tabla ? <TablaDeLaSeccion tabla={seccion.tabla} /> : null}
      {seccion.nota ? <Texto style={s.nota}>{seccion.nota}</Texto> : null}
      {seccion.contradiccion ? <Aviso palabra="Contradicción.">{seccion.contradiccion}</Aviso> : null}
    </>
  );
}

/** Marcas del eje vertical: un paso redondo (1, 2, 2,5 o 5 por potencia de diez) que deja de tres a seis líneas. */
export function marcasDelEje(minimo: number, maximo: number): number[] {
  if (!Number.isFinite(minimo) || !Number.isFinite(maximo)) return [];
  if (minimo === maximo) return [minimo];
  const bruto = (maximo - minimo) / 4;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const paso = ([1, 2, 2.5, 5, 10].find((factor) => factor * potencia >= bruto) ?? 10) * potencia;
  const marcas: number[] = [];
  for (let marca = Math.floor(minimo / paso) * paso; marca <= maximo + paso * 1e-9; marca += paso) marcas.push(Number(marca.toFixed(6)));
  if (marcas[marcas.length - 1] < maximo) marcas.push(Number((marcas[marcas.length - 1] + paso).toFixed(6)));
  return marcas;
}

/**
 * La evolución histórica: la misma serie que la pantalla, base 100, en el gráfico de líneas de la plantilla. El activo va en
 * color del tema; la línea de 100, de donde parte la base, en gris y a trazos (el modelo no trae la serie de su índice, y no se inventa).
 */
function Evolucion({ evolucion }: { evolucion: EvolucionDeLaFicha }) {
  return (
    <View wrap={false}>
      <GraficoDeLineas
        fechas={evolucion.fechas}
        series={[
          { nombre: "El activo", valores: evolucion.valores },
          { nombre: "Base 100", valores: evolucion.fechas.map(() => 100), referencia: true }
        ]}
        formato={(valor) => numero(valor, { decimales: 1 })}
        formatoDelEje={(valor) => numero(valor, { decimales: valor % 1 === 0 ? 0 : 1 })}
        alto={170}
      />
      {evolucion.variacion !== undefined ? (
        <View style={[s.fila, { width: COLUMNA, marginTop: 4 }]}>
          <Texto style={s.filaRotulo}>Variación del periodo</Texto>
          <Texto style={s.filaValor}>{evolucion.variacion}</Texto>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Lo que la cabecera lleva según para quién es el papel (decisión A-126). El papel de cliente no lleva la tira de aptitudes, ni la
 * disponibilidad cuando lo único que dice es que no la hemos medido. Que cotiza o que dejó de cotizar es un hecho del instrumento
 * y se queda en los dos.
 */
export function loQueLlevaLaCabecera(ficha: FichaInstrumento, modoCliente: boolean): { conTira: boolean; conDisponibilidad: boolean } {
  return {
    conTira: !modoCliente && ficha.aptitudes.length > 0,
    conDisponibilidad: !(modoCliente && ficha.disponibilidad.estado === "sin-medir")
  };
}

/** Lo que se queda junto: una sección ancha corta no se parte; la prosa larga del objetivo, sí. */
function cabeEnUnaHoja(seccion: SeccionDeFicha): boolean {
  const filas = seccion.filas.length + (seccion.tabla?.filas.length ?? 0);
  const prosa = seccion.prosa?.length ?? 0;
  return filas <= 30 && prosa <= 1800;
}

/** Los números de sección, seguidos. */
function numerador() {
  let n = 0;
  return () => {
    n += 1;
    return String(n).padStart(2, "0");
  };
}

function FichaDoc({ input }: { input: FichaDeActivoPdfInput }) {
  const { ficha, modoCliente, evolucion } = input;
  const { conTira, conDisponibilidad } = loQueLlevaLaCabecera(ficha, modoCliente);
  const siguiente = numerador();
  const titulo = (seccion: SeccionDeFicha, arriba = false): ReactElement => (
    <TituloDeSeccion numero={siguiente()} titulo={seccion.titulo} procedencia={enUnaLinea(seccion.procedencia)} juntoAlTitulo={80} arribaDelTodo={arriba} />
  );
  return (
    <DocumentoDeInforme
      tema={modoCliente ? "cliente" : "interno"}
      documento={DOCUMENTO}
      titulo={`Ficha · ${ficha.nombre} · ${input.isin}`}
      asunto={modoCliente ? "Ficha de activo" : "Ficha de activo · uso interno del asesor"}
      identidad={input.identidad ?? leerIdentidad()}
    >
      <Hoja>
        <Presentacion
          contexto={[ficha.tipo, lineaDelPie(input)]}
          titulo={ficha.nombre}
          entradilla={ficha.identificacion}
          datos={conDisponibilidad ? [{ rotulo: ficha.disponibilidad.rotulo, valor: ficha.disponibilidad.valor }] : undefined}
        />

        {conTira ? (
          <View wrap={false}>
            <TituloDeSeccion titulo="Qué puedes hacer con él" arribaDelTodo />
            {/* Lo que no aplica o falta se escribe como ausencia, en gris, y no en seminegrita como una cifra: así lo distinguía el color. */}
            <Rejilla
              columnas={3}
              datos={ficha.aptitudes.map((aptitud) =>
                aptitud.estado === "falta" || aptitud.estado === "no-aplica"
                  ? { rotulo: aptitud.rotulo, valor: null, motivo: aptitud.valor }
                  : { rotulo: aptitud.rotulo, valor: aptitud.valor }
              )}
            />
          </View>
        ) : null}
        {ficha.disponibilidad.nota ? <Aviso>{enUnaLinea(ficha.disponibilidad.nota)}</Aviso> : null}
        {ficha.aviso ? <Aviso>{enUnaLinea(ficha.aviso)}</Aviso> : null}

        {bloquesDelPapel(ficha).map((bloque) =>
          "ancha" in bloque ? (
            /* Una sección ancha entera en su hoja si cabe; si es más larga que una hoja, se parte, pero el título no se queda solo. */
            <View key={bloque.ancha.id} wrap={!cabeEnUnaHoja(bloque.ancha)}>
              {titulo(bloque.ancha)}
              <Contenido ancho={CAJA} seccion={bloque.ancha} />
            </View>
          ) : (
            <View key={bloque.estrechas.map((seccion) => seccion.id).join("+")} style={s.par} wrap={false}>
              {bloque.estrechas.map((seccion) => (
                <View key={seccion.id} style={s.columna}>
                  {titulo(seccion)}
                  <Contenido ancho={COLUMNA} seccion={seccion} />
                </View>
              ))}
            </View>
          )
        )}

        {evolucion ? (
          <View wrap={false}>
            <TituloDeSeccion numero={siguiente()} titulo="Evolución histórica" procedencia={evolucion.procedencia} />
            <Evolucion evolucion={evolucion} />
          </View>
        ) : null}

        <View style={s.cierre} wrap={false}>
          <Parrafo>Ficha elaborada con los datos del proveedor y con nuestros cálculos; cada sección dice de dónde sale y de cuándo es.</Parrafo>
          <AvisoLegal />
        </View>
      </Hoja>
    </DocumentoDeInforme>
  );
}

/** Blob del documento. Separado de la descarga para poder ejercitarlo en las pruebas. */
export async function createFichaDeActivoPdfBlob(input: FichaDeActivoPdfInput): Promise<Blob> {
  return renderizarInforme(<FichaDoc input={input} />);
}

export async function downloadFichaDeActivoPdf(input: FichaDeActivoPdfInput): Promise<void> {
  descargar(await createFichaDeActivoPdfBlob(input), nombreDelFicheroDeLaFicha(input));
}
