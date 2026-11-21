/**
 * Las versiones anteriores de una cartera: las copias de seguridad que el almacén hace solo
 * al guardar, en la subcarpeta «copias» de la carpeta de carteras. Se elige una, se ve en
 * qué se diferencia de la actual y se recupera; la actual no se pierde, pasa a ser una copia
 * más y el cambio se puede deshacer.
 */
import { useEffect, useId, useState } from "react";
import "../../../styles/gestor-dialogos.css";
import { EmptyState } from "../../../components/ui/AsyncState";
import { Ausencia } from "../../../components/ui/Ausencia";
import { Aviso } from "../../../components/ui/Aviso";
import { Button } from "../../../components/ui/Button";
import { DialogBody, DialogFooter, DialogHeader, ModalDialog } from "../../../components/ui/ModalDialog";
import { numero as numeroEscrito } from "../../../core/formato";
import type { AlmacenDeCarteras, CopiaDeSeguridad } from "../../almacen/almacen";
import { COPIAS_RECIENTES, DIAS_DE_RETENCION } from "../../almacen/copias";
import type { Cartera } from "../../motor/modelo";
import { escrito } from "../textos";

/** Un número sin unidad, con punto de millar: «1.234», «12,5». */
function formatoNumero(valor: number, opciones: { decimales?: number } = {}): string {
  const texto = numeroEscrito(valor, { decimales: opciones.decimales ?? 0 }) ?? String(valor);
  /* Sin ceros de relleno: «12,0 KB» se escribe «12 KB», como antes. */
  return texto.replace(/,0+$/, "");
}

const UBICACION = "Están en la subcarpeta «copias» de tu carpeta de carteras.";

/** «13/11/2026 15:04», en la hora del equipo. Lo que no se puede leer como instante se enseña tal cual. */
function fechaYHora(iso: string): string {
  return Number.isNaN(new Date(iso).getTime()) ? iso : escrito.fechaYHora(iso);
}

function tamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  const kb = bytes / 1024;
  return kb < 1024 ? `${formatoNumero(kb, { decimales: 1 })} KB` : `${formatoNumero(kb / 1024, { decimales: 1 })} MB`;
}

function movimientos(n: number): string {
  return n === 1 ? "1 movimiento" : `${formatoNumero(n)} movimientos`;
}

function ultimoMovimiento(cartera: Cartera): string | undefined {
  let ultimo: string | undefined;
  for (const movimiento of cartera.movimientos) if (!ultimo || movimiento.fechaOperacion > ultimo) ultimo = movimiento.fechaOperacion;
  return ultimo;
}

/** La lectura de la copia elegida. Lleva su fichero: si se elige otra antes de que acabe, la vieja no pisa a la nueva. */
type Lectura = { fichero: string } & ({ estado: "leyendo" } | { estado: "lista"; cartera: Cartera } | { estado: "error"; mensaje: string });

function Diferencias({ copia, actual }: { copia: Cartera; actual: Cartera }) {
  const filas = [
    { rotulo: "Movimientos", enLaCopia: movimientos(copia.movimientos.length), ahora: movimientos(actual.movimientos.length) },
    { rotulo: "Activos", enLaCopia: String(copia.activos.length), ahora: String(actual.activos.length) },
    { rotulo: "Último movimiento", enLaCopia: ultimoMovimiento(copia), ahora: ultimoMovimiento(actual), esFecha: true }
  ];
  return (
    <div aria-label="Diferencias entre esta versión y la de ahora (tabla desplazable)" className="gestor-tabla-envoltorio" role="group" tabIndex={0}>
      <table className="gestor-tabla">
        <thead>
          <tr>
            <th />
            <th className="gestor-tabla__cifra">En esta versión</th>
            <th className="gestor-tabla__cifra">Ahora</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((fila) => (
            <tr key={fila.rotulo}>
              <td>{fila.rotulo}</td>
              <td className="gestor-tabla__cifra">{fila.enLaCopia ? (fila.esFecha ? escrito.fecha(fila.enLaCopia) : fila.enLaCopia) : <Ausencia clase="no-aplica" motivo="Ninguno" />}</td>
              <td className="gestor-tabla__cifra">{fila.ahora ? (fila.esFecha ? escrito.fecha(fila.ahora) : fila.ahora) : <Ausencia clase="no-aplica" motivo="Ninguno" />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DialogoDeVersiones({ cartera, almacen, alRecuperar, alCerrar }: {
  cartera: Cartera;
  almacen: AlmacenDeCarteras;
  alRecuperar: (cartera: Cartera) => void;
  alCerrar: () => void;
}) {
  const idDelTitulo = useId();
  const [copias, setCopias] = useState<CopiaDeSeguridad[] | null>(null);
  const [errorDeLista, setErrorDeLista] = useState<string | null>(null);
  const [elegida, setElegida] = useState<CopiaDeSeguridad | null>(null);
  const [lectura, setLectura] = useState<Lectura | null>(null);

  useEffect(() => {
    let vigente = true;
    almacen
      .copias(cartera.id)
      .then((leidas) => {
        if (vigente) setCopias([...leidas].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0)));
      })
      .catch((causa: unknown) => {
        if (vigente) setErrorDeLista(causa instanceof Error && causa.message ? causa.message : "No se han podido leer las copias.");
      });
    return () => {
      vigente = false;
    };
  }, [almacen, cartera.id]);

  const elegir = (copia: CopiaDeSeguridad) => {
    setElegida(copia);
    const fichero = copia.fichero;
    setLectura({ fichero, estado: "leyendo" });
    const sigueElegida = (nueva: Lectura) => setLectura((actual) => (actual?.fichero === fichero ? nueva : actual));
    almacen
      .leerCopia(copia)
      .then((leida) => sigueElegida({ fichero, estado: "lista", cartera: leida.cartera }))
      .catch((causa: unknown) => sigueElegida({ fichero, estado: "error", mensaje: causa instanceof Error && causa.message ? causa.message : "No se ha podido leer esta copia." }));
  };

  let contenido;
  if (errorDeLista) contenido = <Aviso tono="error">{errorDeLista}</Aviso>;
  else if (copias === null) contenido = <p className="cmp-note" role="status">Buscando las copias…</p>;
  else if (copias.length === 0) {
    contenido = (
      <EmptyState
        description={`Las copias se hacen solas al guardar: la primera aparecerá en cuanto cambies la cartera. ${UBICACION}`}
        title="Aún no hay versiones anteriores"
      />
    );
  } else {
    contenido = (
      <>
        <p className="cmp-note">Una copia de la cartera tal como estaba, hecha sola al guardar. {UBICACION} Se conservan las {COPIAS_RECIENTES} más recientes y una por día de los últimos {DIAS_DE_RETENCION} días.</p>
        <div className="rows">
          {copias.map((copia) => (
            <div className={copia === elegida ? "rows__item gestor-fila gestor-version--elegida" : "rows__item gestor-fila"} key={copia.fichero}>
              <span className="rows__label">
                {fechaYHora(copia.fecha)}
                <span className="gestor-fila__nota">{[copia.movimientos !== undefined ? movimientos(copia.movimientos) : undefined, tamano(copia.bytes)].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="rows__value">
                <Button aria-pressed={copia === elegida} onClick={() => elegir(copia)} size="sm" variant="quiet">{copia === elegida ? "Elegida" : "Ver"}</Button>
              </span>
            </div>
          ))}
        </div>
        {elegida && lectura ? (
          <section aria-labelledby={`${idDelTitulo}-elegida`} className="stack stack--3">
            <h3 className="gestor-subtitulo" id={`${idDelTitulo}-elegida`}>La versión del {fechaYHora(elegida.fecha)}, frente a la actual</h3>
            {lectura.estado === "leyendo" ? <p className="cmp-note" role="status">Leyendo la copia…</p> : null}
            {lectura.estado === "error" ? <Aviso tono="error">{lectura.mensaje}</Aviso> : null}
            {lectura.estado === "lista" ? <Diferencias actual={cartera} copia={lectura.cartera} /> : null}
          </section>
        ) : null}
      </>
    );
  }

  const recuperable = lectura?.estado === "lista" ? lectura.cartera : null;
  return (
    <ModalDialog closeOnBackdrop={false} labelledBy={idDelTitulo} onClose={alCerrar} size="md">
      <DialogHeader eyebrow={cartera.nombre} onClose={alCerrar} title="Versiones anteriores" titleId={idDelTitulo} />
      <DialogBody className="stack">{contenido}</DialogBody>
      <DialogFooter nota={recuperable ? "La versión actual no se pierde: se puede deshacer desde el menú «Más» y, al guardarse, queda como una copia más." : undefined}>
        <Button onClick={alCerrar} variant="quiet">Cerrar</Button>
        {copias && copias.length > 0 ? (
          <Button disabled={!recuperable} onClick={() => recuperable && alRecuperar(recuperable)} variant="primary">Recuperar esta versión</Button>
        ) : null}
      </DialogFooter>
    </ModalDialog>
  );
}
