/* eslint-disable react-refresh/only-export-components */
/**
 * La Propuesta de cambio (decisión 32), en la plantilla única (tema cliente). Aquí no se calcula nada: lo que imprime lo
 * compone `core/propuestaDeCambio`, con sus cifras ya escritas.
 *
 * Tres hojas: la presentación con las dos composiciones y qué cambia; las cifras de las dos en la misma ventana, las
 * crisis y el coste; y el motivo, que escribe el asesor, con el plan. Las tablas repiten su cabecera si saltan de hoja.
 */
import { LO_QUE_NO_ES_LA_CIFRA_DE_UNA_CRISIS, queMideLaCifraDeUnaCrisis } from "../core/crisisPasadas";
import { descargar, diaDelDocumento, nombreDelFichero } from "../core/descargaDeFicheros";
import { SIMULACION_CON_LOS_PESOS_DE_HOY } from "../core/parteMedida";
import { LO_QUE_NO_INCLUYE_EL_COSTE, SIN_MEDIA_QUE_DAR } from "../core/portfolioCosts";
import { ROTULO_ACTUAL, ROTULO_PROPUESTA, type CeldaDeCrisis, type PropuestaDeCambio } from "../core/propuestaDeCambio";
import { SIN_COMISIONES_NI_IMPUESTOS } from "../core/textosDeCartera";
import { firmaDelInforme } from "./firmaDelInforme";
import { Apunte, Subtitulo, TextoEscrito } from "./textosDelInforme";
import { AvisoLegal, DocumentoDeInforme, HojasDeSecciones, Nota, Parrafo, Presentacion, Tabla, renderizarInforme, type CeldaDeTabla, type FilaDeTabla, type SeccionDeInforme } from "./plantilla";

const DOCUMENTO = "Propuesta de cambio";
const SIMULACION_NO_ES_RECOMENDACION = "Simulación: no es una recomendación.";
const COMO_SE_LEE_LA_DIFERENCIA = "Diferencia: Propuesta menos Actual, en puntos porcentuales.";
const ADVERTENCIA = "Simulación: no es una recomendación";

/** Debajo del nombre: su código, si solo está en un lado y si la simulación la deja fuera. */
const debajoDelNombre = (fila: PropuestaDeCambio["cambios"][number]) => [fila.codigo, fila.donde, fila.fueraDeLaSimulacion].filter(Boolean).join(" · ");

/**
 * Una celda de una crisis: la cifra, si la hay, y debajo sus líneas; sin cifra, la primera línea dice por qué. La cifra va en tinta,
 * sin color: es una medida de riesgo, como la caída máxima, y así la escriben el informe de cliente, el interno y la pantalla.
 */
export function celdaDeCrisis(celda: CeldaDeCrisis): CeldaDeTabla {
  const [primera, ...resto] = celda.lineas;
  if (celda.cifra) return { texto: celda.cifra, apunte: celda.lineas.join("\n") || null };
  return { texto: primera ?? "", apunte: resto.join("\n") || null };
}

/* ------------------------------------------------------------------------------------------------ Las secciones */

const presentacion: SeccionDeInforme<PropuestaDeCambio> = {
  id: "presentacion",
  titulo: "Presentación",
  comienzo: "presentacion",
  procede: () => true,
  Contenido: ({ datos: modelo }) => (
    <>
      <Presentacion
        contexto={[modelo.cliente ? `Para ${modelo.cliente}` : "", `Fecha de emisión: ${modelo.fecha}`]}
        titulo={DOCUMENTO}
        entradilla="Este documento le enseña qué se propone cambiar en su cartera y por qué, con las dos composiciones en el mismo periodo."
        datos={[
          { rotulo: `${ROTULO_ACTUAL} · ${modelo.posicionesActual} ${modelo.posicionesActual === 1 ? "posición" : "posiciones"}`, valor: modelo.nombreActual },
          { rotulo: `${ROTULO_PROPUESTA} · ${modelo.posicionesPropuesta} ${modelo.posicionesPropuesta === 1 ? "posición" : "posiciones"}`, valor: modelo.nombrePropuesta }
        ]}
      />
      <Apunte arriba={0}>{modelo.fraseDelCapital}</Apunte>
    </>
  )
};

const queCambia: SeccionDeInforme<PropuestaDeCambio> = {
  id: "que-cambia",
  titulo: "Qué cambia, posición a posición",
  procedencia: `Cada composición llevada al 100 %. ${COMO_SE_LEE_LA_DIFERENCIA}`,
  procede: () => true,
  juntoAlTitulo: 90,
  Contenido: ({ datos: modelo }) => (
    <>
      {modelo.cambios.length > 0 ? (
        <Tabla
          columnas={[{ titulo: "Posición", ancho: 42 }, { titulo: ROTULO_ACTUAL, ancho: 13.5, cifra: true }, { titulo: ROTULO_PROPUESTA, ancho: 13.5, cifra: true }, { titulo: "Diferencia", ancho: 14, cifra: true }, { titulo: "Coste corriente", ancho: 17, cifra: true }]}
          filas={modelo.cambios.map((fila) => ({ celdas: [{ texto: fila.nombre, apunte: debajoDelNombre(fila) || null }, fila.textoActual, fila.textoPropuesta, fila.textoDiferencia, fila.coste] }))}
          total={["Total", modelo.totalActual, modelo.totalPropuesta, "", ""]}
        />
      ) : null}
      <Apunte arriba={8}>{modelo.resumenDeCambios}</Apunte>
      {modelo.notasDePeso.map((nota) => (
        <Apunte key={nota} arriba={3}>{nota}</Apunte>
      ))}
    </>
  )
};

const cifras: SeccionDeInforme<PropuestaDeCambio> = {
  id: "cifras",
  titulo: "Rentabilidad, riesgo y coste",
  comienzo: "nueva",
  procede: () => true,
  Contenido: ({ datos: modelo }) => {
    const { cifras: c, costes, crisis } = modelo;
    return (
      <>
        <Subtitulo primero>{`Rentabilidad, volatilidad y caída · ${c.periodo}`}</Subtitulo>
        <Apunte arriba={0}>{c.ventana ? `${SIMULACION_NO_ES_RECOMENDACION} ${c.ventana}.` : SIMULACION_NO_ES_RECOMENDACION}</Apunte>
        <Tabla
          columnas={[{ titulo: c.conTramoEstimado ? "Cifra · estimado" : "Cifra", ancho: 34 }, { titulo: ROTULO_ACTUAL, ancho: 22, cifra: true }, { titulo: ROTULO_PROPUESTA, ancho: 22, cifra: true }, { titulo: "Diferencia", ancho: 22, cifra: true }]}
          filas={c.filas.map((fila) => ({ celdas: [fila.rotulo, fila.actual, fila.propuesta, fila.diferencia] }))}
        />
        <Apunte arriba={6}>{`${SIMULACION_CON_LOS_PESOS_DE_HOY} ${modelo.netasDe} ${COMO_SE_LEE_LA_DIFERENCIA}`}</Apunte>
        {c.notas.map((nota) => (
          <Apunte key={nota} arriba={3}>{nota}</Apunte>
        ))}
        {modelo.fueraDetallado.map((item) => (
          <Apunte key={`${item.rotulo}-${item.nombre}`} arriba={1}>{`${item.rotulo}: ${item.nombre} (${item.peso}), por ${item.motivo}.`}</Apunte>
        ))}

        <Subtitulo>Cómo se habrían comportado en crisis pasadas</Subtitulo>
        {crisis.filas.length === 0 ? (
          <Nota>{crisis.sinNinguna ?? ""}</Nota>
        ) : (
          <>
            <Apunte arriba={0}>{queMideLaCifraDeUnaCrisis("cada composición")}</Apunte>
            <Tabla
              columnas={[{ titulo: "Crisis", ancho: 24 }, { titulo: ROTULO_ACTUAL, ancho: 38 }, { titulo: ROTULO_PROPUESTA, ancho: 38 }]}
              filas={crisis.filas.map((fila): FilaDeTabla => ({ celdas: [{ texto: fila.nombre, apunte: fila.contexto }, celdaDeCrisis(fila.actual), celdaDeCrisis(fila.propuesta)] }))}
            />
            <Apunte arriba={6}>{LO_QUE_NO_ES_LA_CIFRA_DE_UNA_CRISIS}</Apunte>
          </>
        )}

        <Subtitulo>Coste corriente</Subtitulo>
        <Apunte arriba={0}>Media ponderada por el peso del coste corriente de cada posición, el de la tabla «Qué cambia».</Apunte>
        <Tabla
          columnas={[{ titulo: "Coste", ancho: 36 }, { titulo: ROTULO_ACTUAL, ancho: 25, cifra: true }, { titulo: ROTULO_PROPUESTA, ancho: 25, cifra: true }, { titulo: "Diferencia", ancho: 14, cifra: true }]}
          filas={costes.filas.map((fila) => ({ celdas: [fila.rotulo, fila.actual, fila.propuesta, fila.diferencia] }))}
        />
        <Apunte arriba={6}>{`No incluye costes de operación. ${LO_QUE_NO_INCLUYE_EL_COSTE}`}</Apunte>
        {costes.hayAcciones ? (
          <Apunte arriba={3}>{costes.sinMediaEnNinguna ? SIN_MEDIA_QUE_DAR : "Una acción no tiene coste corriente: en su fila dice «No aplica» y en la media cuenta como cero. Un fondo o un ETF sin dato no cuenta como cero: es un dato que falta."}</Apunte>
        ) : null}
      </>
    );
  }
};

const motivoYPlan: SeccionDeInforme<PropuestaDeCambio> = {
  id: "motivo-y-plan",
  titulo: "Motivo y plan de ejecución",
  comienzo: "nueva",
  procede: () => true,
  Contenido: ({ datos: modelo }) => {
    const { plan } = modelo;
    const conImportes = plan.capital != null;
    const menores = plan.menoresSinListar;
    return (
      <>
        <Subtitulo primero>Motivo de la propuesta</Subtitulo>
        <Apunte arriba={0}>Lo ha escrito su asesor.</Apunte>
        <TextoEscrito texto={modelo.motivo} />

        <Subtitulo>Plan de ejecución</Subtitulo>
        <Apunte arriba={0}>
          {conImportes
            ? `Primero lo que se reduce, después lo que se aumenta, de mayor a menor. Importes sobre el capital de la composición ${ROTULO_ACTUAL}, redondeados al euro: el importe real dependerá del valor de cada posición el día en que se ejecute.`
            : "Primero lo que se reduce, después lo que se aumenta, de mayor a menor."}
        </Apunte>
        {plan.pasos.length > 0 ? (
          <Tabla
            columnas={conImportes
              ? [{ titulo: "Operación", ancho: 14 }, { titulo: "Posición", ancho: 54 }, { titulo: "De la cartera", ancho: 16, cifra: true }, { titulo: "Importe", ancho: 16, cifra: true }]
              : [{ titulo: "Operación", ancho: 14 }, { titulo: "Posición", ancho: 66 }, { titulo: "De la cartera", ancho: 20, cifra: true }]}
            filas={plan.pasos.map((paso) => ({
              celdas: conImportes
                ? [paso.operacion, { texto: paso.nombre, apunte: paso.codigo }, paso.textoPuntos, paso.textoImporte ?? ""]
                : [paso.operacion, { texto: paso.nombre, apunte: paso.codigo }, paso.textoPuntos]
            }))}
            total={conImportes ? ["", "Lo que cambia de posición", plan.textoTotalPuntos, plan.textoTotalImporte ?? ""] : ["", "Lo que cambia de posición", plan.textoTotalPuntos]}
          />
        ) : null}
        {menores > 0 ? <Apunte arriba={6}>{`${menores === 1 ? "No se lista 1 cambio" : `No se listan ${menores} cambios`} de menos de 0,01 puntos.`}</Apunte> : null}
        {modelo.notasDelPlan ? (
          <>
            <Apunte arriba={10}>Notas de su asesor sobre la ejecución:</Apunte>
            <TextoEscrito texto={modelo.notasDelPlan} />
          </>
        ) : null}
        <Nota>{SIN_COMISIONES_NI_IMPUESTOS}</Nota>
        <Parrafo>{`${SIMULACION_NO_ES_RECOMENDACION} Las rentabilidades pasadas no garantizan rentabilidades futuras.`}</Parrafo>
        <AvisoLegal />
      </>
    );
  }
};

const SECCIONES: readonly SeccionDeInforme<PropuestaDeCambio>[] = [presentacion, queCambia, cifras, motivoYPlan];

function PropuestaDoc({ modelo }: { modelo: PropuestaDeCambio }) {
  return (
    <DocumentoDeInforme
      tema="cliente"
      documento={DOCUMENTO}
      titulo={modelo.cliente ? `${DOCUMENTO} - ${modelo.cliente}` : DOCUMENTO}
      asunto="Propuesta de cambio de cartera"
      identidad={firmaDelInforme(modelo.responsable)}
      destinatario={modelo.cliente || undefined}
      advertencia={ADVERTENCIA}
    >
      <HojasDeSecciones secciones={SECCIONES} datos={modelo} />
    </DocumentoDeInforme>
  );
}

export async function createPropuestaDeCambioPdfBlob(modelo: PropuestaDeCambio): Promise<Blob> {
  return renderizarInforme(<PropuestaDoc modelo={modelo} />);
}

export async function downloadPropuestaDeCambioPdf(modelo: PropuestaDeCambio): Promise<void> {
  descargar(await createPropuestaDeCambioPdfBlob(modelo), nombreDelFicheroDeLaPropuesta(modelo));
}

/** «Propuesta de cambio - Familia García - 2026-11-05.pdf»: el cliente, o la propuesta si no hay cliente, y el día de emisión que imprime. */
export function nombreDelFicheroDeLaPropuesta(modelo: Pick<PropuestaDeCambio, "cliente" | "nombrePropuesta" | "dia">): string {
  return nombreDelFichero({ documento: DOCUMENTO, de: modelo.cliente.trim() || modelo.nombrePropuesta.trim() || null, fecha: diaDelDocumento(modelo.dia) });
}
