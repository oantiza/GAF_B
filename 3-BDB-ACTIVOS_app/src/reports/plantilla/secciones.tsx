/* eslint-disable react-refresh/only-export-components */
/**
 * Las secciones: un documento es una lista de secciones, y el compositor las reparte en hojas. Es la arquitectura del
 * Gestor de carteras (`src/gestor/informes/registro.ts` y `hojas.ts`), generalizada para cualquier documento.
 *
 * Cada sección dice si procede con los datos, dónde empieza (la presentación de la primera hoja, una hoja nueva o
 * seguida de la anterior), si va apaisada y cuánto contenido tiene que caber junto a su título. El compositor:
 *  - se salta las que no proceden, sin dejar ni su título ni una hoja vacía;
 *  - numera las que llevan título (01, 02…), seguidas aunque falte alguna;
 *  - pone seguidas las que caben en la misma hoja; abre hoja con una `nueva` o con un cambio de orientación (dos
 *    apaisadas seguidas comparten la suya);
 *  - y no deja un título solo al pie: si debajo no caben `juntoAlTitulo` puntos, el título pasa con su contenido.
 */
import { Fragment, type ReactElement } from "react";
import { View } from "@react-pdf/renderer";
import { Hoja } from "./hoja";
import { TituloDeSeccion } from "./piezas";

/**
 * Dónde empieza una sección.
 *  - `portada`: es la portada a página completa. Su contenido es una `Portada` (que ya es una hoja entera), sin título ni
 *    cabecera; la llevan el informe de cliente y el informe de cartera del gestor.
 *  - `presentacion`: abre la primera hoja y no lleva título de sección (su contenido es la `Presentacion`).
 *  - `nueva`: empieza hoja.
 *  - `seguida`: sigue a la anterior en la misma hoja si cabe (lo normal).
 */
export type ComienzoDeSeccion = "portada" | "presentacion" | "nueva" | "seguida";

export interface SeccionDeInforme<D> {
  /** Único en el documento. */
  id: string;
  titulo: string;
  /** De dónde sale y de cuándo es; va bajo el título. */
  procedencia?: string | ((datos: D) => string | null);
  /** Si con estos datos la sección tiene algo que decir. Si no, no se imprime. */
  procede(datos: D): boolean;
  /** El contenido, con las piezas de la plantilla. El título lo pone el compositor. */
  Contenido(props: { datos: D }): ReactElement | null;
  /** Por defecto, `seguida`. */
  comienzo?: ComienzoDeSeccion;
  /** Hoja apaisada, para una tabla que no cabe en vertical. */
  apaisada?: boolean;
  /** Sin número delante del título. Por defecto se numera. */
  sinNumero?: boolean;
  /**
   * Puntos de contenido que tienen que caber bajo el título en la misma hoja; si no caben, el título pasa a la siguiente
   * con su contenido. Una sección cuyo primer bloque no se parte (un gráfico, una tabla corta) pide aquí su alto.
   */
  juntoAlTitulo?: number;
  /**
   * La sección entera no se parte: el título y su contenido van en un solo bloque, y pasan juntos a la hoja siguiente si no caben.
   * Para una sección corta cuyo contenido es un bloque de alto variable (el reparto, con tantas filas como categorías): con
   * `juntoAlTitulo`, que es un alto fijo, el título se quedaba solo al pie cuando el bloque medía más que esa cifra (15-11-2026).
   * No es para secciones largas: lo que no cabe en una hoja no puede ir entero.
   */
  entera?: boolean;
}

/** Una sección que procede, con el número que le toca (si lleva). */
export interface SeccionNumerada<D> extends SeccionDeInforme<D> {
  numero?: string;
}

export interface TiraDeHojas<D> {
  apaisada: boolean;
  /** La portada: una hoja entera que dibuja su propia sección, sin cabecera de la plantilla. */
  portada?: boolean;
  secciones: SeccionNumerada<D>[];
}

/** Las secciones que proceden, en su orden, numeradas de dos cifras las que llevan título y número. */
export function seccionesQueProceden<D>(secciones: readonly SeccionDeInforme<D>[], datos: D): SeccionNumerada<D>[] {
  const ids = new Set<string>();
  for (const seccion of secciones) {
    if (ids.has(seccion.id)) throw new Error(`Hay dos secciones con el identificador «${seccion.id}».`);
    ids.add(seccion.id);
  }
  let numero = 0;
  return secciones
    .filter((seccion) => seccion.procede(datos))
    .map((seccion) => {
      if (seccion.comienzo === "portada" || seccion.comienzo === "presentacion" || seccion.sinNumero) return { ...seccion };
      numero += 1;
      return { ...seccion, numero: String(numero).padStart(2, "0") };
    });
}

/** Cómo se reparten en hojas: una tira por cada sección que abre hoja, y las seguidas detrás. */
export function repartirEnHojas<D>(secciones: readonly SeccionNumerada<D>[]): TiraDeHojas<D>[] {
  const tiras: TiraDeHojas<D>[] = [];
  for (const seccion of secciones) {
    const apaisada = seccion.apaisada === true;
    if (seccion.comienzo === "portada") {
      tiras.push({ apaisada: false, portada: true, secciones: [seccion] });
      continue;
    }
    const actual = tiras[tiras.length - 1];
    const abre = !actual || actual.portada === true || apaisada !== actual.apaisada || seccion.comienzo === "nueva" || seccion.comienzo === "presentacion";
    if (abre) tiras.push({ apaisada, secciones: [seccion] });
    else actual.secciones.push(seccion);
  }
  return tiras;
}

/*
 * El título y el contenido van sueltos en la hoja, como hermanos: @react-pdf solo mueve un título a la hoja siguiente
 * (`minPresenceAhead`) si tiene algo detrás en su mismo contenedor.
 */
function Seccion<D>({ seccion, datos, abreLaHoja }: { seccion: SeccionNumerada<D>; datos: D; abreLaHoja: boolean }) {
  const Contenido = seccion.Contenido;
  const procedencia = typeof seccion.procedencia === "function" ? seccion.procedencia(datos) : seccion.procedencia;
  const conTitulo = seccion.comienzo !== "presentacion" && seccion.comienzo !== "portada";
  const titulo = conTitulo ? (
    <TituloDeSeccion titulo={seccion.titulo} numero={seccion.numero} procedencia={procedencia} juntoAlTitulo={seccion.entera ? 0 : seccion.juntoAlTitulo} arribaDelTodo={abreLaHoja} />
  ) : null;
  /* Entera: un solo bloque que no se parte, con el título dentro. Así no depende de acertar con un alto. */
  if (seccion.entera && conTitulo) {
    return (
      <View wrap={false}>
        {titulo}
        <Contenido datos={datos} />
      </View>
    );
  }
  return (
    <>
      {titulo}
      <Contenido datos={datos} />
    </>
  );
}

/**
 * Las hojas de un documento hecho de secciones. Va dentro de un `DocumentoDeInforme`:
 *
 *   <DocumentoDeInforme tema="cliente" documento="Informe de cartera" identidad={…} destinatario="Familia García">
 *     <HojasDeSecciones secciones={SECCIONES} datos={datos} />
 *   </DocumentoDeInforme>
 */
export function HojasDeSecciones<D>({ secciones, datos }: { secciones: readonly SeccionDeInforme<D>[]; datos: D }) {
  const tiras = repartirEnHojas(seccionesQueProceden(secciones, datos));
  return (
    <>
      {tiras.map((tira, i) => tira.portada ? (
        <Fragment key={i}>
          <Seccion seccion={tira.secciones[0]} datos={datos} abreLaHoja />
        </Fragment>
      ) : (
        <Hoja key={i} apaisada={tira.apaisada}>
          {tira.secciones.map((seccion, j) => (
            <Fragment key={seccion.id}>
              <Seccion seccion={seccion} datos={datos} abreLaHoja={j === 0} />
            </Fragment>
          ))}
        </Hoja>
      ))}
    </>
  );
}
