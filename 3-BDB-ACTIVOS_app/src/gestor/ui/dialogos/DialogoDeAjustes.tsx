/**
 * Ajustes de una cartera: su nombre y su cliente, la entidad de sus cuentas, la referencia
 * con la que se compara y los precios puestos a mano.
 */
import { useId, useState } from "react";
import { Aviso } from "../../../components/ui/Aviso";
import { Button } from "../../../components/ui/Button";
import { Campo } from "../../../components/ui/Campo";
import { DialogBody, DialogFooter, DialogHeader, ModalDialog } from "../../../components/ui/ModalDialog";
import { esDemostracion } from "../../demo/carteraDemo";
import { aNumero, aTexto, d, leerCifra } from "../../motor/decimal";
import { esDia, type Dia } from "../../motor/fechas";
import type { Activo, PrecioManual, ReferenciaDeCartera } from "../../motor/modelo";
import type { CarteraAbierta } from "../estado/useCarteraAbierta";
import { lecturaDeUnaCifraAmbigua } from "../formato";
import { escrito } from "../textos";
import { SelectorDeReferencia } from "./SelectorDeReferencia";

export function DialogoDeAjustes({ abierta, hoy, alCerrar }: { abierta: CarteraAbierta; hoy: Dia; alCerrar: () => void }) {
  const idDelTitulo = useId();
  const { cartera } = abierta;
  const [nombre, setNombre] = useState(cartera.nombre);
  const [cliente, setCliente] = useState(cartera.cliente?.nombre ?? "");
  const [entidad, setEntidad] = useState(cartera.cuentas.valores.entidad ?? "");
  const [referencia, setReferencia] = useState<ReferenciaDeCartera | undefined>(cartera.referencia);
  const [precios, setPrecios] = useState<PrecioManual[]>(cartera.preciosManuales);
  const [activoDelPrecio, setActivoDelPrecio] = useState(cartera.activos.find((activo) => activo.origen === "manual")?.id ?? cartera.activos[0]?.id ?? "");
  const [fechaDelPrecio, setFechaDelPrecio] = useState(hoy);
  const [importeDelPrecio, setImporteDelPrecio] = useState("");
  const [error, setError] = useState<string | null>(null);

  const anadirPrecio = () => {
    const leido = leerCifra(importeDelPrecio);
    if (!activoDelPrecio) return setError("Elige el activo al que poner precio.");
    if (!esDia(fechaDelPrecio)) return setError("La fecha del precio no es válida.");
    if (!leido || leido.lte(0)) return setError("El precio tiene que ser una cifra mayor que cero.");
    setError(null);
    setPrecios((actuales) => [...actuales.filter((existente) => !(existente.activoId === activoDelPrecio && existente.fecha === fechaDelPrecio)), { activoId: activoDelPrecio, fecha: fechaDelPrecio, precio: aTexto(leido) }]);
    setImporteDelPrecio("");
  };

  const guardar = () => {
    if (!nombre.trim()) return setError("La cartera necesita un nombre.");
    /* GES-15: un precio tecleado y sin añadir no se descarta en silencio. */
    if (importeDelPrecio.trim() !== "") return setError("Has escrito un precio a mano sin añadirlo: pulsa «Añadir precio» o borra la cifra antes de guardar.");
    abierta.cambiar("Cambiar los ajustes", (actual) => ({
      ...actual,
      nombre: nombre.trim(),
      cliente: cliente.trim() ? { ...actual.cliente, nombre: cliente.trim() } : undefined,
      cuentas: {
        efectivo: { ...actual.cuentas.efectivo, entidad: entidad.trim() || undefined },
        valores: { ...actual.cuentas.valores, entidad: entidad.trim() || undefined }
      },
      referencia,
      preciosManuales: precios
    }));
    alCerrar();
  };

  const nombreDe = (activoId: string): Activo | undefined => cartera.activos.find((activo) => activo.id === activoId);
  const ordenados = [...precios].sort((a, b) => (a.fecha < b.fecha ? 1 : -1));

  return (
    <ModalDialog closeOnBackdrop={false} labelledBy={idDelTitulo} onClose={alCerrar} size="lg">
      <DialogHeader onClose={alCerrar} title="Ajustes de la cartera" titleId={idDelTitulo} />
      <DialogBody className="stack">
        <div className="gestor-campos">
          <Campo rotulo="Nombre de la cartera">
            <input onChange={(evento) => setNombre(evento.target.value)} type="text" value={nombre} />
          </Campo>
          <Campo rotulo="Cliente">
            <input onChange={(evento) => setCliente(evento.target.value)} type="text" value={cliente} />
          </Campo>
          <Campo rotulo="Entidad de las cuentas">
            <input onChange={(evento) => setEntidad(evento.target.value)} type="text" value={entidad} />
          </Campo>
        </div>

        <h3 className="gestor-subtitulo">Referencia</h3>
        <SelectorDeReferencia
          alCambiar={setReferencia}
          bloqueada={esDemostracion(cartera) ? "La cartera de demostración se compara con su propio índice, inventado como el resto de sus datos: aquí no se puede cambiar." : undefined}
          divisaBase={cartera.divisaBase}
          referencia={referencia}
        />

        <h3 className="gestor-subtitulo">Precios a mano</h3>
        <p className="cmp-note">Para un activo que no está en el catálogo, o para corregir un día concreto. Un precio a mano vale desde su fecha hasta el siguiente precio conocido.</p>
        {cartera.activos.length === 0 ? (
          <p className="cmp-note">La cartera aún no tiene activos.</p>
        ) : (
          <div className="gestor-campos">
            <Campo className="gestor-campos__ancho" rotulo="Activo">
              <select onChange={(evento) => setActivoDelPrecio(evento.target.value)} value={activoDelPrecio}>
                {cartera.activos.map((activo) => (
                  <option key={activo.id} value={activo.id}>{activo.nombre}{activo.origen === "manual" ? " (activo propio)" : ""}</option>
                ))}
              </select>
            </Campo>
            <Campo rotulo="Fecha">
              <input max={hoy} onChange={(evento) => setFechaDelPrecio(evento.target.value)} type="date" value={fechaDelPrecio} />
            </Campo>
            <Campo pista={lecturaDeUnaCifraAmbigua(importeDelPrecio)} rotulo={`Precio${nombreDe(activoDelPrecio) ? ` (${nombreDe(activoDelPrecio)!.divisa})` : ""}`}>
              <input className="gestor-numero" inputMode="decimal" onChange={(evento) => setImporteDelPrecio(evento.target.value)} onKeyDown={(evento) => evento.key === "Enter" && anadirPrecio()} type="text" value={importeDelPrecio} />
            </Campo>
            <div className="field gestor-campos__boton">
              <Button onClick={anadirPrecio} size="sm">Añadir precio</Button>
            </div>
          </div>
        )}
        {ordenados.length > 0 ? (
          <div className="rows">
            {ordenados.map((manual) => (
              <div className="rows__item gestor-fila" key={`${manual.activoId}-${manual.fecha}`}>
                <span className="gestor-fecha">{escrito.fecha(manual.fecha)}</span>
                <span className="rows__label">{nombreDe(manual.activoId)?.nombre ?? manual.activoId}</span>
                <span className="rows__value">
                  {escrito.precio(aNumero(d(manual.precio)), nombreDe(manual.activoId)?.divisa)}
                  <Button aria-label={`Quitar el precio de ${nombreDe(manual.activoId)?.nombre ?? manual.activoId} del ${escrito.fecha(manual.fecha)}`} onClick={() => setPrecios((actuales) => actuales.filter((existente) => existente !== manual))} size="sm" variant="quiet">Quitar</Button>
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {error ? <Aviso tono="error">{error}</Aviso> : null}
      </DialogBody>
      <DialogFooter>
        <Button onClick={alCerrar} variant="quiet">Cancelar</Button>
        <Button onClick={guardar} variant="primary">Guardar los ajustes</Button>
      </DialogFooter>
    </ModalDialog>
  );
}
