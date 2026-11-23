/**
 * Los informes de una cartera de cliente: el del cliente, el de costes, el del asesor y los datos en
 * Excel, del periodo que el usuario tiene elegido en la pantalla. Se generan en el navegador.
 *
 * La firma de los informes (nombre, entidad o despacho, contacto y logotipo) es la identidad del asesor
 * de toda la aplicación (`src/core/identidadDelAsesor.ts`), que se cambia en su propio diálogo. Lo que el
 * asesor escribió antes en los ajustes de la carpeta de carteras no se pierde: si la identidad está vacía,
 * se adopta una vez. Ya no se escribe en los ajustes de la carpeta.
 */
import { useEffect, useId, useState } from "react";
import "../../../styles/gestor-dialogos.css";
import { useModoCliente } from "../../../app/ClientModeContext";
import { DatosDelAsesorDialog } from "../../../components/DatosDelAsesorDialog";
import { Aviso } from "../../../components/ui/Aviso";
import { Button } from "../../../components/ui/Button";
import { Distintivo } from "../../../components/ui/Distintivo";
import { DialogBody, DialogFooter, DialogHeader, ModalDialog } from "../../../components/ui/ModalDialog";
import { faltaElNombre, useIdentidadDelAsesor } from "../../../core/identidadDelAsesor";
import type { AlmacenDeCarteras } from "../../almacen/almacen";
import { esDemostracion } from "../../demo/carteraDemo";
import { fechaDeInicioDelPeriodo, type Analisis } from "../../motor/analisis";
import { hoy } from "../../motor/fechas";
import type { Cartera, ReferenciaDeCartera } from "../../motor/modelo";
import { LineaDeAviso } from "../piezas";
import { escrito } from "../textos";
import { adoptarLaFirmaDeLaCarpeta } from "./firmaDeLaCarpeta";
import { SelectorDeReferencia } from "./SelectorDeReferencia";

type Documento = "cliente" | "costes" | "asesor" | "excel";

const DOCUMENTOS: Array<{ id: Documento; nombre: string; para: string; boton: string }> = [
  { id: "cliente", nombre: "Informe de la cartera", para: "Para entregar o enseñar en una reunión: breve y explicado, sin jerga.", boton: "Descargar el PDF" },
  { id: "costes", nombre: "Costes de la cartera", para: "Para entregar al cliente: lo que ha costado la cartera, con el detalle de cada coste.", boton: "Descargar el PDF" },
  { id: "asesor", nombre: "Informe del asesor", para: "Tu herramienta de trabajo: todo el detalle, la conciliación y los avisos.", boton: "Descargar el PDF" },
  { id: "excel", nombre: "Datos en Excel", para: "Una hoja por tema (resumen, posiciones, movimientos, rentabilidad mensual…) para trabajar las cifras en una hoja de cálculo.", boton: "Descargar el Excel" }
];

/** Los de uso interno del asesor: en Modo cliente no se ofrecen (`SE_OCULTA.documentosInternos`). */
const DOCUMENTOS_INTERNOS: ReadonlySet<Documento> = new Set(["asesor", "excel"]);

export function DialogoDeInformes({ analisis, cartera, almacen, alCerrar, alCambiarLaReferencia, actualizando = false, avisosDeMercado = [] }: {
  analisis: Analisis;
  /** Los avisos de la carga de mercado (cambios o precios que no se han podido leer), para repetirlos antes de generar. */
  avisosDeMercado?: readonly string[];
  cartera: Cartera;
  /** La carpeta de carteras: de sus ajustes se adopta, una vez, la firma que el asesor escribió antes. */
  almacen: AlmacenDeCarteras | null;
  alCerrar: () => void;
  /** Guarda en la cartera la referencia con la que se compara. Sin ella, el diálogo no ofrece cambiarla. */
  alCambiarLaReferencia?: (referencia: ReferenciaDeCartera | undefined) => void;
  /** Si se están leyendo datos de mercado (por ejemplo, los de una referencia recién elegida): hasta que lleguen no se genera nada. */
  actualizando?: boolean;
}) {
  const idDelTitulo = useId();
  /* GES-08: el informe del asesor y los datos en Excel son su herramienta de trabajo; delante de un cliente no se ofrecen. */
  const seVenLosInternos = useModoCliente().seEnsena("documentosInternos");
  const aLaVista = seVenLosInternos ? DOCUMENTOS : DOCUMENTOS.filter((documento) => !DOCUMENTOS_INTERNOS.has(documento.id));
  const { identidad, guardar } = useIdentidadDelAsesor();
  const [cambiandoLaFirma, setCambiandoLaFirma] = useState(false);
  const [generando, setGenerando] = useState<Documento | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* Lo que el asesor ya tenía escrito en los ajustes de la carpeta pasa a su identidad, si la identidad está vacía. */
  useEffect(() => {
    if (!almacen) return;
    let vigente = true;
    void adoptarLaFirmaDeLaCarpeta(almacen, guardar, () => vigente);
    return () => {
      vigente = false;
    };
  }, [almacen, guardar]);

  const generar = async (documento: Documento) => {
    setGenerando(documento);
    setHecho(null);
    setError(null);
    try {
      const informes = await import("../../informes");
      const firma = [identidad.nombre, identidad.entidad, identidad.contacto, identidad.logotipo].some(Boolean) ? { ...identidad } : undefined;
      const datos = { analisis, cartera, asesor: firma, generado: hoy() };
      const nombre = documento === "excel" ? await informes.descargarExcel(datos) : await informes.descargarInformePdf(documento, datos);
      setHecho(`Listo: se ha descargado «${nombre}».`);
    } catch (causa) {
      setError(`No se ha podido generar el documento. ${causa instanceof Error && causa.message ? causa.message : "Vuelve a intentarlo."}`);
    } finally {
      setGenerando(null);
    }
  };

  const errores = analisis.integridad.errores;
  /* GES-16: lo que el Resumen llama «Antes de fiarte de las cifras» se repite aquí, antes de generar: los avisos del motor y los del mercado. */
  const avisos = analisis.integridad.avisos.filter((aviso) => aviso.gravedad !== "nota");
  const porRevisar = avisos.length + avisosDeMercado.length;
  const firma = [identidad.nombre, identidad.entidad, identidad.contacto].filter(Boolean).join(" · ");

  return (
    <>
      <ModalDialog
        closeOnBackdrop={false}
        labelledBy={idDelTitulo}
        onClose={() => {
          if (!cambiandoLaFirma) alCerrar();
        }}
        size="md"
      >
        <DialogHeader eyebrow={cartera.nombre} onClose={alCerrar} title="Informes" titleId={idDelTitulo} />
        <DialogBody className="stack">
          <p className="gestor-nota">
            Del {escrito.fecha(fechaDeInicioDelPeriodo(analisis))} al {escrito.fecha(analisis.periodo.hasta)}. Es el periodo elegido en la pantalla: para otro, cámbialo arriba antes de descargar.
          </p>
          {errores > 0 ? (
            <Aviso titulo="Errores sin resolver.">
              La cartera tiene {errores === 1 ? "1 error sin resolver" : `${errores} errores sin resolver`}; las cifras del informe pueden no ser fiables.
            </Aviso>
          ) : null}
          {porRevisar > 0 ? (
            <section aria-labelledby={`${idDelTitulo}-revisar`} className="stack stack--tight">
              <h3 className="gestor-subtitulo" id={`${idDelTitulo}-revisar`}>{porRevisar === 1 ? "Una cosa que revisar antes de generar" : `${porRevisar} cosas que revisar antes de generar`}</h3>
              <ul className="gestor-avisos">
                {avisos.map((aviso, indice) => (
                  <LineaDeAviso gravedad={aviso.gravedad} key={`${aviso.codigo}-${indice}`}>{aviso.mensaje}</LineaDeAviso>
                ))}
                {avisosDeMercado.map((aviso) => (
                  <LineaDeAviso gravedad="aviso" key={aviso}>{aviso}</LineaDeAviso>
                ))}
              </ul>
              <p className="cmp-note">El detalle está en Análisis, en «Comprobaciones».</p>
            </section>
          ) : null}

          {alCambiarLaReferencia ? (
            <SelectorDeReferencia
              alCambiar={alCambiarLaReferencia}
              bloqueada={esDemostracion(cartera) ? "La cartera de demostración se compara con su propio índice, inventado como el resto de sus datos: aquí no se puede cambiar." : undefined}
              divisaBase={cartera.divisaBase}
              referencia={cartera.referencia}
              rotulo="Referencia con la que se compara"
            />
          ) : null}
          {actualizando ? <p className="cmp-note" role="status">Leyendo los datos de mercado: los documentos se podrán generar en un momento.</p> : null}

          <div className="rows">
            {aLaVista.map((documento) => (
              <div className="rows__item gestor-fila" key={documento.id}>
                <span className="rows__label">
                  {documento.nombre}{" "}
                  {DOCUMENTOS_INTERNOS.has(documento.id) ? <Distintivo tono="interno">Interno</Distintivo> : <Distintivo tono="marca">Para el cliente</Distintivo>}
                  <span className="gestor-fila__nota">{documento.para}</span>
                </span>
                <span className="rows__value">
                  <Button aria-label={`${documento.boton}: ${documento.nombre}`} busy={generando === documento.id} disabled={generando !== null || actualizando} onClick={() => void generar(documento.id)} size="sm">
                    {documento.boton}
                  </Button>
                </span>
              </div>
            ))}
          </div>
          {!seVenLosInternos ? <p className="cmp-note">En Modo cliente solo se ofrecen los informes para el cliente.</p> : null}
          {generando ? <p className="cmp-note" role="status">Generando…</p> : null}
          {hecho ? <p className="gestor-nota" role="status">{hecho}</p> : null}
          {error ? <Aviso tono="error">{error}</Aviso> : null}

          <div className="gestor-firma">
            <div className="gestor-firma__texto">
              <p className="field__label">Firma de los informes</p>
              <p className="gestor-firma__linea">
                {firma || "Sin datos del asesor"}
                {identidad.logotipo ? " · con logotipo" : ""}
              </p>
            </div>
            <Button aria-label="Cambiar la firma de los informes" onClick={() => setCambiandoLaFirma(true)} size="sm">Cambiar</Button>
          </div>
          {faltaElNombre(identidad) ? (
            <Aviso titulo="Falta tu nombre.">Los informes saldrán sin firma. Escríbelo con «Cambiar»: vale para todos los informes.</Aviso>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button onClick={alCerrar}>Cerrar</Button>
        </DialogFooter>
      </ModalDialog>
      <DatosDelAsesorDialog abierto={cambiandoLaFirma} alCerrar={() => setCambiandoLaFirma(false)} />
    </>
  );
}
