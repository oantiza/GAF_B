import { useState } from "react";
import { faltaElNombre, useIdentidadDelAsesor } from "../../core/identidadDelAsesor";
import { NOMBRE_DE_LAS_UNIDADES, type FormaComparada, type LecturaDeSupervivencia, type Unidades } from "../../core/jubilacion/lectura";
import type { ResultadoDisponible } from "../../core/jubilacion/motor";
import { AsyncErrorBanner } from "../AsyncErrorBanner";
import { DatosDelAsesorDialog } from "../DatosDelAsesorDialog";
import { Aviso } from "../ui/Aviso";
import { Button } from "../ui/Button";
import { Campo } from "../ui/Campo";
import { DialogBody, DialogFooter, DialogHeader, ModalDialog } from "../ui/ModalDialog";

/**
 * Pedir el informe de jubilación. Las cifras son las de la pantalla, en las unidades que tenga puestas; aquí solo
 * se dice para quién es. El nombre del cliente vive en este diálogo y muere con él, como todo lo que es de un
 * cliente.
 *
 * **La firma** es el membrete del asesor, el mismo de todos los informes (`core/identidadDelAsesor.ts`): aquí se lee
 * en una línea —nombre · entidad · contacto— y se cambia con «Cambiar», que abre «Tus datos en los informes». Ya no
 * se escribe en este diálogo: lo que se escribía aquí era esa misma identidad, y escrita en dos sitios acababa
 * diciendo dos cosas.
 */
export function DialogoDelInformeDeJubilacion({
  resultado,
  unidades,
  formas,
  supervivencia,
  supuestos,
  ejemplo,
  onClose
}: {
  resultado: ResultadoDisponible;
  unidades: Unidades;
  formas: FormaComparada[] | null;
  /** Cuántos llegan a la edad del plan: la misma lectura que la pantalla. */
  supervivencia: LecturaDeSupervivencia | null;
  supuestos: string[];
  /** Los datos son de un ejemplo: el documento lo dirá en la portada y en cada pie. */
  ejemplo: boolean;
  onClose: () => void;
}) {
  const [cliente, setCliente] = useState("");
  const { identidad } = useIdentidadDelAsesor();
  const [cambiandoLaFirma, setCambiandoLaFirma] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const firma = [identidad.nombre, identidad.entidad, identidad.contacto].filter(Boolean).join(" · ");

  async function descargar() {
    setOcupado(true);
    setError(null);
    try {
      const { downloadJubilacionPdf } = await import("../../reports/jubilacionPdf");
      /* Lo mismo que antes llegaba de los dos campos: el nombre y el contacto de la identidad del asesor. */
      await downloadJubilacionPdf({
        resultado,
        unidades,
        formas,
        supervivencia,
        supuestos,
        ejemplo,
        clientName: cliente,
        banker: { name: identidad.nombre ?? "", email: identidad.contacto ?? "" }
      });
      onClose();
    } catch (causa) {
      setError(causa);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <ModalDialog
        labelledBy="jubilacion-informe-title"
        onClose={() => {
          if (!ocupado && !cambiandoLaFirma) onClose();
        }}
        size="sm"
      >
        <DialogHeader onClose={ocupado ? undefined : onClose} title="Informe de jubilación para el cliente" titleId="jubilacion-informe-title" />
        <DialogBody className="stack">
          <p className="field__hint">
            Las cifras de esta pantalla, con la respuesta en la primera hoja: el ingreso neto, de dónde sale y hasta cuándo llegan los ahorros. Después, el plan año a año con los datos
            de partida y, como anexo, las cuentas del primer año y cómo se ha calculado, con sus fuentes.
          </p>
          {error ? <AsyncErrorBanner error={error} onRetry={() => void descargar()} /> : null}
          <p className="field__hint">
            Los importes van en <strong>{NOMBRE_DE_LAS_UNIDADES[unidades]}</strong>, como en la pantalla.
            {ejemplo ? " Los datos son de un ejemplo, y el documento lo dice en la primera hoja y en la cabecera y el pie de todas." : ""}
          </p>
          <Campo opcional rotulo="Cliente">
            <input autoFocus disabled={ocupado} maxLength={120} onChange={(evento) => setCliente(evento.target.value)} placeholder="Vacío, sin nombre de cliente" type="text" value={cliente} />
          </Campo>
          <div className="jubilacion-firma">
            <div className="jubilacion-firma__texto">
              <p className="field__label">Firma de los informes</p>
              <p className="jubilacion-firma__linea">{firma || "Sin datos del asesor"}</p>
            </div>
            <Button aria-label="Cambiar la firma de los informes" disabled={ocupado} onClick={() => setCambiandoLaFirma(true)} size="sm" variant="secondary">
              Cambiar
            </Button>
          </div>
          {faltaElNombre(identidad) ? (
            <Aviso titulo="Falta tu nombre.">El informe saldrá sin firma. Escríbelo con «Cambiar»: vale para todos los informes.</Aviso>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button disabled={ocupado} onClick={onClose} variant="secondary">
            Cancelar
          </Button>
          <Button busy={ocupado} disabled={ocupado} onClick={() => void descargar()} variant="primary">
            {ocupado ? "Preparando…" : "Descargar el informe"}
          </Button>
        </DialogFooter>
      </ModalDialog>
      <DatosDelAsesorDialog abierto={cambiandoLaFirma} alCerrar={() => setCambiandoLaFirma(false)} />
    </>
  );
}
