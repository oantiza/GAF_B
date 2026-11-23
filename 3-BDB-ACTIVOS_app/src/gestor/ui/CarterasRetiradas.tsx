/**
 * Las carteras retiradas: las que «Retirar la cartera» llevó a la papelera de la carpeta, con la forma de recuperar una
 * (Óscar, 21-11-2026). Va al pie de la lista de carteras, plegado, y solo si hay alguna: la papelera no es algo que se mire
 * a diario. Al recuperarla, la cartera vuelve con el fichero de su nombre y sus copias de seguridad; si ya hay una cartera
 * con ese nombre, o la misma, no se pisa: lo dice el almacén (`YA_EXISTE`) y aquí se enseña tal cual.
 *
 * En Modo cliente no se enseña: son carteras de otros clientes (`SE_OCULTA.otrasCarteras`).
 */
import { useEffect, useState } from "react";
import { useModoCliente } from "../../app/ClientModeContext";
import { Aviso } from "../../components/ui/Aviso";
import { Button } from "../../components/ui/Button";
import { Panel } from "../../components/ui/Panel";
import { useConfirm } from "../../components/ui/useConfirm";
import { useMensaje } from "../../components/ui/useMensaje";
import { TablaDeDatos } from "../../components/tabla/TablaDeDatos";
import { textoDeAusencia } from "../../core/textoDeAusencia";
import type { ColumnaDeTabla } from "../../types/tablaDeDatos";
import type { AlmacenDeCarteras, CarteraRetirada } from "../almacen/almacen";
import { diaDeUnInstante } from "./formato";
import { escrito } from "./textos";

interface FilaDeRetirada extends CarteraRetirada {
  /** El fichero de la papelera: la clave de la fila. */
  id: string;
}

function columnas(alRecuperar: (fila: FilaDeRetirada) => void, recuperando: string | null): ColumnaDeTabla<FilaDeRetirada>[] {
  return [
    { id: "nombre", titulo: "Cartera", encabezaFila: true, celda: (fila) => ({ texto: fila.nombre, valor: fila.nombre.toLowerCase(), apunte: fila.error }) },
    { id: "cliente", titulo: "Cliente", celda: (fila) => (fila.cliente ? { texto: fila.cliente } : { texto: textoDeAusencia("no-aplica"), ausencia: "no-aplica" }) },
    { id: "movimientos", titulo: "Movimientos", cifra: true, celda: (fila) => ({ texto: String(fila.movimientos), valor: fila.movimientos }) },
    { id: "retirada", titulo: "Retirada", tituloCompleto: "Fecha en que se retiró", cifra: true, celda: (fila) => ({ texto: escrito.fecha(diaDeUnInstante(fila.retirada)), valor: fila.retirada }) },
    {
      id: "acciones",
      titulo: "Acciones",
      acciones: true,
      sinOrden: true,
      tituloOculto: true,
      celda: (fila) => ({
        texto: "",
        nodo: (
          <span className="row gestor-acciones">
            <Button
              aria-label={`Recuperar: ${fila.nombre}`}
              busy={recuperando === fila.fichero}
              disabled={Boolean(fila.error) || (recuperando !== null && recuperando !== fila.fichero)}
              onClick={() => alRecuperar(fila)}
              size="sm"
              variant="quiet"
            >
              Recuperar
            </Button>
          </span>
        )
      })
    }
  ];
}

export function CarterasRetiradas({ almacen, alRecuperar }: { almacen: AlmacenDeCarteras; alRecuperar: (fichero: string) => void }) {
  const { seEnsena } = useModoCliente();
  const { confirm, confirmDialog } = useConfirm();
  const { decir } = useMensaje();
  const [retiradas, setRetiradas] = useState<FilaDeRetirada[] | null>(null);
  const [errorDeLectura, setErrorDeLectura] = useState<string | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [recuperando, setRecuperando] = useState<string | null>(null);
  /* Si había alguna al entrar, el bloque se queda aunque se recuperen todas: así se lee que la papelera ha quedado vacía. */
  const [habiaAlguna, setHabiaAlguna] = useState(false);
  const [vuelta, setVuelta] = useState(0);

  useEffect(() => {
    let vigente = true;
    almacen
      .retiradas()
      .then((lista) => {
        if (!vigente) return;
        setErrorDeLectura(null);
        setRetiradas(lista.map((retirada) => ({ ...retirada, id: retirada.fichero })));
        if (lista.length > 0) setHabiaAlguna(true);
      })
      .catch((causa: unknown) => {
        if (vigente) setErrorDeLectura(causa instanceof Error ? causa.message : "No se ha podido leer la papelera.");
      });
    return () => {
      vigente = false;
    };
  }, [almacen, vuelta]);

  if (!seEnsena("otrasCarteras")) return null;
  if (!errorDeLectura && (retiradas === null || (retiradas.length === 0 && !habiaAlguna))) return null;

  const recuperar = async (fila: FilaDeRetirada) => {
    const aceptado = await confirm({
      title: `¿Recuperar la cartera «${fila.nombre}»?`,
      message: "Vuelve a tu carpeta de carteras con su nombre y sus copias de seguridad, y sale de la papelera. Si ya hay una cartera con ese nombre, no se pisa: no se recupera y se dice.",
      confirmLabel: "Recuperar"
    });
    if (!aceptado) return;
    setFallo(null);
    setRecuperando(fila.fichero);
    try {
      const { fichero, nombre } = await almacen.recuperar(fila.fichero);
      decir(`«${nombre}» ha vuelto a tu carpeta de carteras.`);
      alRecuperar(fichero);
    } catch (causa) {
      setFallo(causa instanceof Error ? causa.message : "No se ha podido recuperar la cartera.");
    } finally {
      setRecuperando(null);
      setVuelta((n) => n + 1);
    }
  };

  const cuantas = retiradas?.length ?? 0;
  return (
    <>
      <Panel
        claseDelCuerpo="stack stack--tight"
        estado={retiradas ? <span>{cuantas === 1 ? "1 cartera" : `${cuantas} carteras`}</span> : undefined}
        plegable
        subtitulo={`En la subcarpeta «papelera» de «${almacen.nombre}». Retirar una cartera no la borra: se recupera desde aquí.`}
        titulo="Carteras retiradas"
      >
        {errorDeLectura ? <Aviso titulo="No se puede leer la papelera" tono="error">{errorDeLectura}</Aviso> : null}
        {fallo ? <Aviso anunciar titulo="No se ha recuperado" tono="aviso">{fallo}</Aviso> : null}
        {retiradas && retiradas.length === 0 ? <p className="empty-inline">No queda ninguna cartera retirada.</p> : null}
        {retiradas && retiradas.length > 0 ? (
          <TablaDeDatos columnas={columnas((fila) => void recuperar(fila), recuperando)} deActivos filas={retiradas} titulo="Carteras de la papelera" />
        ) : null}
      </Panel>
      {confirmDialog}
    </>
  );
}
