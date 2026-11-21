import "../styles/analisis.css";
import { useId, useState } from "react";
import { useBenchmark } from "../app/BenchmarkContext";
import { setAnalysisWindow, useAnalysisWindow } from "../core/analysisPreferences";
import { esFaltaDeDatos } from "../core/appError";
import { benchmarkById } from "../core/benchmarkProfiles";
import * as formato from "../core/formato";
import { faltaElNombre, useIdentidadDelAsesor } from "../core/identidadDelAsesor";
import { AvisoDelInforme } from "./AvisoDelInforme";
import { DatosDelAsesorDialog } from "./DatosDelAsesorDialog";
import { Aviso } from "./ui/Aviso";
import { Button } from "./ui/Button";
import { Campo } from "./ui/Campo";
import { DialogBody, DialogFooter, DialogHeader, ModalDialog } from "./ui/ModalDialog";
import { SegmentedControl } from "./ui/SegmentedControl";

const PERIODOS = [
  { id: "3Y", label: "3 años" },
  { id: "5Y", label: "5 años" }
] as const;

/** Lo que lleva el informe para el cliente, en una línea: lo mismo en las dos puertas. */
export const CONTENIDO_DEL_INFORME_DE_CLIENTE =
  "Composición con el coste corriente y la divisa de cada posición; cifras y distribución geográfica; evolución frente a la cartera de referencia y mapa de riesgo y rentabilidad; crisis pasadas y solapamiento entre fondos; guía de interpretación.";

/**
 * «Firma de los informes»: lo que sale en la cabecera de todos los informes —nombre, entidad o despacho, contacto y si hay
 * logotipo—, leído de la identidad del asesor (`core/identidadDelAsesor.ts`), con «Cambiar» para editarla en «Tus datos en los
 * informes». Sin nombre, un aviso lo dice: los informes saldrían sin firma.
 *
 * El nombre y el contacto ya no se piden en cada pantalla ni en cada diálogo: se escriben una vez ahí.
 */
export function FirmaDeLosInformes({ alCambiar, deshabilitado = false }: { alCambiar: () => void; deshabilitado?: boolean }) {
  const { identidad } = useIdentidadDelAsesor();
  const idDelRotulo = useId();
  const partes = [identidad.nombre, identidad.entidad, identidad.contacto].map((parte) => parte?.trim()).filter(Boolean);
  if (identidad.logotipo) partes.push("con logotipo");
  return (
    <div aria-labelledby={idDelRotulo} className="informes-firma" role="group">
      <div className="informes-firma__linea">
        <span className="informes-firma__rotulo" id={idDelRotulo}>
          Firma de los informes
        </span>
        <span className="informes-firma__valor">{partes.length > 0 ? partes.join(" · ") : "Sin datos del asesor"}</span>
        <Button aria-label="Cambiar la firma de los informes" disabled={deshabilitado} onClick={alCambiar} size="sm">
          Cambiar
        </Button>
      </div>
      {faltaElNombre(identidad) ? <Aviso titulo="Los informes saldrán sin firma:">escribe tus datos.</Aviso> : null}
    </div>
  );
}

interface DialogoDelInformeDeClienteProps {
  /** El nombre de la propuesta, o lo que se ha escrito en el campo si no lo tenía. */
  nombre: string;
  /** La propuesta no tiene nombre: el diálogo lo pide. Lo que se escriba sale en el papel y se guarda al descargar. */
  pedirNombre: boolean;
  alCambiarNombre: (nombre: string) => void;
  /** Para quién es: lo que se haya escrito en Informes o en este mismo diálogo, compartido por las dos puertas. */
  cliente: string;
  alCambiarCliente: (cliente: string) => void;
  /** El capital de la propuesta. Sin él, el informe sale sin importes. */
  capital?: number;
  /** El peso que mide la simulación del periodo, de 0 a 100, cuando ya se conoce. */
  pesoMedidoPct?: number;
  /** Se está generando: el diálogo no se cierra ni con Escape ni con la X, y los campos no se tocan. */
  ocupado: boolean;
  /** Lo que ha salido mal en la última descarga: se dice dentro, con «Reintentar» si reintentar puede arreglarlo. */
  error: unknown;
  /** Por qué no se puede generar con esta cartera (`motivoParaNoGenerarElInformeDeCliente`): se dice dentro y no se descarga. */
  bloqueo?: string | null;
  alDescargar: () => void;
  alCerrar: () => void;
}

/**
 * El informe para el cliente: una sola puerta, la misma en Análisis y en Informes (ANA-12). Los mismos campos, los mismos
 * textos y el mismo comportamiento: no se cierra mientras genera, el error sale dentro y la entrada del informe la monta, en
 * las dos pantallas, `entradaDelInformeDeCliente`.
 *
 * La firma no se pide aquí: se enseña en una línea, con «Cambiar», que abre «Tus datos en los informes» en lugar de este diálogo
 * (dos diálogos apilados se disputarían el foco y Escape) y vuelve aquí al cerrarse.
 */
export function DialogoDelInformeDeCliente({
  nombre,
  pedirNombre,
  alCambiarNombre,
  cliente,
  alCambiarCliente,
  capital,
  pesoMedidoPct,
  ocupado,
  error,
  bloqueo,
  alDescargar,
  alCerrar
}: DialogoDelInformeDeClienteProps) {
  const idDelTitulo = useId();
  const { benchmarkId } = useBenchmark();
  const periodo = useAnalysisWindow();
  const [editandoLaFirma, setEditandoLaFirma] = useState(false);
  const cerrar = () => {
    if (!ocupado) alCerrar();
  };

  if (editandoLaFirma) {
    return <DatosDelAsesorDialog abierto alCerrar={() => setEditandoLaFirma(false)} />;
  }

  const capitalFijado = typeof capital === "number" && Number.isFinite(capital) && capital > 0;
  const resumen = [
    `Cartera de referencia: ${benchmarkById(benchmarkId)?.name ?? benchmarkId}`,
    capitalFijado ? `capital: ${formato.importeTitular(capital)}` : "capital sin fijar: el informe saldrá sin importes",
    typeof pesoMedidoPct === "number" ? `peso medido: ${formato.peso(pesoMedidoPct / 100)}` : null
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ModalDialog labelledBy={idDelTitulo} onClose={cerrar} size="sm">
      <DialogHeader
        eyebrow={nombre.trim() || "Propuesta sin nombre"}
        onClose={ocupado ? undefined : alCerrar}
        title="Informe para el cliente"
        titleId={idDelTitulo}
      />
      <DialogBody className="stack stack--3">
        {bloqueo ? <Aviso titulo="La cartera no cuadra.">{bloqueo}</Aviso> : null}
        {error && !bloqueo ? <AvisoDelInforme error={error} onRetry={alDescargar} /> : null}
        <p className="analisis-nota">{CONTENIDO_DEL_INFORME_DE_CLIENTE}</p>
        {pedirNombre ? (
          <Campo pista="La propuesta no tiene nombre: el que escribas sale en el informe y se guarda en la propuesta." rotulo="Nombre de la propuesta">
            <input disabled={ocupado} maxLength={80} onChange={(evento) => alCambiarNombre(evento.target.value)} type="text" value={nombre} />
          </Campo>
        ) : null}
        <Campo opcional pista="Vacío, el informe sale sin nombre de cliente." rotulo="Preparado para">
          <input autoFocus disabled={ocupado} maxLength={120} onChange={(evento) => alCambiarCliente(evento.target.value)} type="text" value={cliente} />
        </Campo>
        <div className="stack stack--2">
          <span className="field__label">Periodo</span>
          <SegmentedControl label="Periodo del informe" onChange={setAnalysisWindow} options={PERIODOS} value={periodo} />
        </div>
        <p className="analisis-nota">{resumen}.</p>
        <FirmaDeLosInformes alCambiar={() => setEditandoLaFirma(true)} deshabilitado={ocupado} />
      </DialogBody>
      <DialogFooter>
        <Button disabled={ocupado} onClick={alCerrar} variant="secondary">
          Cancelar
        </Button>
        <Button busy={ocupado} disabled={ocupado || Boolean(bloqueo) || esFaltaDeDatos(error)} onClick={alDescargar} textoAlTrabajar="Preparando el informe…" variant="primary">
          {ocupado ? "Preparando…" : "Descargar el informe"}
        </Button>
      </DialogFooter>
    </ModalDialog>
  );
}
