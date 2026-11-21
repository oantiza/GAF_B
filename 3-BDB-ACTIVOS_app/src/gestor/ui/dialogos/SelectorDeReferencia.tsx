/**
 * «Comparar con»: la referencia de la cartera elegida de una lista a la vista —las cinco carteras
 * de referencia, los índices con los que ya compara Rendimiento, la liquidez—, o cualquier otro
 * activo del catálogo, o ninguna. Debajo, qué es lo elegido, en una línea llana.
 *
 * No guarda nada: avisa con `alCambiar`, y quien lo usa decide cuándo se guarda.
 */
import { useEffect, useId, useState } from "react";
import { Aviso } from "../../../components/ui/Aviso";
import { Button } from "../../../components/ui/Button";
import { Campo } from "../../../components/ui/Campo";
import { catalogoDeActivos } from "../../mercado/plataforma";
import type { ReferenciaDeCartera } from "../../motor/modelo";
import { claseDeLaReferencia, descripcionDeLaReferencia, nombreDeLaReferencia, OPCIONES_DE_REFERENCIA, opcionDeLaLista, referenciaDeLaOpcion } from "../../motor/referencia";
import { SelectorDeActivo } from "./SelectorDeActivo";

const OTRO = "otro";
const NINGUNA = "";

export function SelectorDeReferencia({ referencia, alCambiar, divisaBase, bloqueada, rotulo = "Comparar con" }: {
  referencia: ReferenciaDeCartera | undefined;
  alCambiar: (referencia: ReferenciaDeCartera | undefined) => void;
  divisaBase: string;
  /** Si no se puede cambiar, por qué (la demostración trae su propia referencia). */
  bloqueada?: string;
  rotulo?: string;
}) {
  const id = useId();
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nombreDelFondo, setNombreDelFondo] = useState<string | undefined>(undefined);

  const clase = referencia ? claseDeLaReferencia(referencia) : undefined;
  const isin = clase?.clase === "activo" ? clase.isin : undefined;
  const deLaLista = referencia ? opcionDeLaLista(referencia.activoId) : undefined;
  const valor = buscando ? OTRO : !referencia ? NINGUNA : deLaLista ? deLaLista.codigo : OTRO;

  /* El nombre del fondo con el que se sigue un índice, de su tarjeta del catálogo. */
  useEffect(() => {
    if (!isin) return;
    let vigente = true;
    catalogoDeActivos()
      .then((catalogo) => {
        if (vigente) setNombreDelFondo(catalogo.find((activo) => activo.isin === isin)?.nombre);
      })
      .catch(() => undefined);
    return () => {
      vigente = false;
    };
  }, [isin]);

  const elegir = (codigo: string) => {
    setError(null);
    if (codigo === OTRO) return setBuscando(true);
    setBuscando(false);
    if (codigo === NINGUNA) return alCambiar(undefined);
    const opcion = opcionDeLaLista(codigo);
    if (opcion) alCambiar(referenciaDeLaOpcion(opcion));
  };

  const descripcion = bloqueada
    ? bloqueada
    : buscando
      ? "Busca un fondo indexado o un ETF que represente el mercado con el que quieres comparar la cartera."
      : referencia
        ? `${deLaLista ? "" : `${nombreDeLaReferencia(referencia)}. `}${descripcionDeLaReferencia(referencia, isin ? nombreDelFondo : undefined)}`
        : "La cartera no se compara con ninguna referencia.";

  return (
    <div className="gestor-referencia stack stack--tight">
      <Campo rotulo={rotulo}>
        {bloqueada ? (
          <select aria-describedby={`${id}-que-es`} defaultValue="fija" disabled id={`${id}-lista`}>
            <option value="fija">{referencia ? nombreDeLaReferencia(referencia) : "Sin referencia"}</option>
          </select>
        ) : (
          <select aria-describedby={`${id}-que-es`} id={`${id}-lista`} onChange={(evento) => elegir(evento.target.value)} value={valor}>
            {OPCIONES_DE_REFERENCIA.map((grupo) => (
              <optgroup key={grupo.grupo} label={grupo.titulo}>
                {grupo.opciones.map((opcion) => (
                  <option key={opcion.codigo} value={opcion.codigo}>{opcion.rotulo}</option>
                ))}
              </optgroup>
            ))}
            <option value={OTRO}>Otro activo del catálogo…</option>
            <option value={NINGUNA}>Sin referencia</option>
          </select>
        )}
      </Campo>
      <p className="cmp-note" id={`${id}-que-es`}>{descripcion}</p>
      {buscando && !bloqueada ? (
        <div className="stack stack--tight">
          <SelectorDeActivo
            activosDeLaCartera={[]}
            alElegir={(activo) => {
              if (!activo) return;
              if (activo.origen === "catalogo" && activo.isin) {
                setBuscando(false);
                setError(null);
                alCambiar({ activoId: activo.isin, nombre: activo.nombre });
              } else setError("La referencia tiene que ser un activo del catálogo: hace falta su serie de precios.");
            }}
            divisaBase={divisaBase}
            elegido={undefined}
            rotulo="Buscar en el catálogo"
          />
          <span className="row">
            <Button onClick={() => { setBuscando(false); setError(null); }} size="sm" variant="quiet">Cancelar</Button>
          </span>
        </div>
      ) : null}
      {!buscando && !bloqueada && valor === OTRO ? (
        <span className="row">
          <Button onClick={() => setBuscando(true)} size="sm" variant="quiet">Buscar otro activo</Button>
        </span>
      ) : null}
      {error ? <Aviso tono="error">{error}</Aviso> : null}
    </div>
  );
}
