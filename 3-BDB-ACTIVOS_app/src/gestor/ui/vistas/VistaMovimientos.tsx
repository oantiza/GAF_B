/**
 * El libro de movimientos: todos los movimientos de la cartera, importados o a mano, con filtros
 * y con alta, edición y eliminación. Las importaciones se pueden deshacer enteras.
 *
 * El importe de un movimiento va en tinta, con su signo: es dinero que entra o sale de la cuenta,
 * no lo que se gana o se pierde.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useModoCliente } from "../../../app/ClientModeContext";
import { EmptyState } from "../../../components/ui/AsyncState";
import { Aviso } from "../../../components/ui/Aviso";
import { Button } from "../../../components/ui/Button";
import { Campo } from "../../../components/ui/Campo";
import { Panel } from "../../../components/ui/Panel";
import { useConfirm } from "../../../components/ui/useConfirm";
import { TablaDeDatos } from "../../../components/tabla/TablaDeDatos";
import { textoDeAusencia } from "../../../core/textoDeAusencia";
import type { ColumnaDeTabla, EstadoDeTabla } from "../../../types/tablaDeDatos";
import { deshacerImportacion } from "../../importacion/revision";
import { aNumero, d } from "../../motor/decimal";
import { contextoDe, validarMovimiento } from "../../motor/libro";
import { activoDe, type Cartera, type Movimiento } from "../../motor/modelo";
import { TIPOS, nombreDelTipo } from "../../motor/movimientos/registro";
import { diaDeUnInstante } from "../formato";
import { escrito } from "../textos";
import type { DatosDeVista } from "../tipos";

interface FilaDeMovimiento {
  id: string;
  movimiento: Movimiento;
  activo: string;
  destino: string;
  errores: string[];
}

function plegar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function columnas(cartera: Cartera, alEditar: (movimiento: Movimiento) => void, alBorrar: (movimiento: Movimiento) => void, conNotas: boolean): ColumnaDeTabla<FilaDeMovimiento>[] {
  const base = cartera.divisaBase;
  return [
    { id: "fecha", titulo: "Fecha", encabezaFila: true, celda: ({ movimiento }) => ({ texto: escrito.fecha(movimiento.fechaOperacion), valor: movimiento.fechaOperacion, apunte: movimiento.fechaValor && movimiento.fechaValor !== movimiento.fechaOperacion ? `Valor ${escrito.fecha(movimiento.fechaValor)}` : undefined }) },
    { id: "tipo", titulo: "Movimiento", celda: (fila) => ({ texto: nombreDelTipo(fila.movimiento.tipo), apunte: fila.errores[0] ?? (conNotas ? fila.movimiento.nota : undefined) }) },
    { id: "activo", titulo: "Activo", celda: (fila) => (fila.activo ? { texto: fila.activo, valor: fila.activo.toLowerCase(), apunte: fila.destino ? `a ${fila.destino}` : undefined } : { texto: textoDeAusencia("no-aplica"), ausencia: "no-aplica" }) },
    { id: "titulos", titulo: "Títulos", cifra: true, celda: ({ movimiento }) => (movimiento.titulos ? { texto: escrito.titulos(d(movimiento.titulos)), valor: aNumero(d(movimiento.titulos)) } : { texto: textoDeAusencia("no-aplica"), ausencia: "no-aplica" }) },
    {
      id: "precio",
      titulo: "Precio",
      cifra: true,
      soloAncho: true,
      celda: ({ movimiento }) => (movimiento.precio ? { texto: escrito.precio(aNumero(d(movimiento.precio)), activoDe(cartera, movimiento.activoId)?.divisa), valor: aNumero(d(movimiento.precio)) } : { texto: textoDeAusencia("no-aplica"), ausencia: "no-aplica" })
    },
    {
      id: "importe",
      titulo: "Efectivo",
      cifra: true,
      celda: ({ movimiento }) => {
        if (movimiento.importe) {
          const valor = aNumero(d(movimiento.importe));
          return { texto: escrito.importeConSigno(valor, movimiento.divisa ?? base), valor };
        }
        if (movimiento.valor) return { texto: escrito.importe(aNumero(d(movimiento.valor)), movimiento.divisa ?? base), valor: 0, apunte: "No pasa por el efectivo" };
        return { texto: textoDeAusencia("no-aplica"), ausencia: "no-aplica" };
      }
    },
    { id: "origen", titulo: "Origen", soloAncho: true, celda: ({ movimiento }) => ({ texto: movimiento.origen?.via === "importado" ? "Importado" : movimiento.origen?.via === "demo" ? "Demostración" : "A mano", apunte: movimiento.origen?.documento }) },
    {
      id: "acciones",
      titulo: "Acciones",
      acciones: true,
      sinOrden: true,
      tituloOculto: true,
      celda: (fila) => {
        const { movimiento } = fila;
        /* GES-17: cada botón dice de qué movimiento es; un lector de pantalla no oye veinticinco «Eliminar» iguales. */
        const cual = `${nombreDelTipo(movimiento.tipo)}${fila.activo ? ` de ${fila.activo}` : ""} del ${escrito.fecha(movimiento.fechaOperacion)}`;
        return {
          texto: "",
          nodo: (
            <span className="row gestor-acciones">
              <Button aria-label={`Editar: ${cual}`} onClick={() => alEditar(movimiento)} size="sm" variant="quiet">Editar</Button>
              <Button aria-label={`Eliminar: ${cual}`} onClick={() => alBorrar(movimiento)} size="sm" variant="quiet">Eliminar</Button>
            </span>
          )
        };
      }
    }
  ];
}

export function VistaMovimientos({ datos }: { datos: DatosDeVista }) {
  const { abierta } = datos;
  const { cartera } = abierta;
  const [busqueda, setBusqueda] = useState("");
  const [tipo, setTipo] = useState("");
  const [activoId, setActivoId] = useState("");
  const [origen, setOrigen] = useState("");
  const { confirm, confirmDialog } = useConfirm();
  const seVenLasNotas = useModoCliente().seEnsena("notasDelAsesor");

  const filas = useMemo<FilaDeMovimiento[]>(() => {
    const contexto = contextoDe(cartera);
    return cartera.movimientos
      .map((movimiento) => ({
        id: movimiento.id,
        movimiento,
        activo: activoDe(cartera, movimiento.activoId)?.nombre ?? "",
        destino: activoDe(cartera, movimiento.destino?.activoId)?.nombre ?? "",
        errores: validarMovimiento(movimiento, contexto)
      }))
      /* Lo más reciente, arriba. */
      .sort((a, b) => (a.movimiento.fechaOperacion < b.movimiento.fechaOperacion ? 1 : a.movimiento.fechaOperacion > b.movimiento.fechaOperacion ? -1 : 0));
  }, [cartera]);

  const visibles = useMemo(() => {
    const texto = plegar(busqueda.trim());
    return filas.filter((fila) => {
      const { movimiento } = fila;
      if (tipo && movimiento.tipo !== tipo) return false;
      if (activoId && movimiento.activoId !== activoId && movimiento.destino?.activoId !== activoId) return false;
      if (origen && (movimiento.origen?.via ?? "manual") !== origen) return false;
      if (!texto) return true;
      return plegar([nombreDelTipo(movimiento.tipo), fila.activo, fila.destino, seVenLasNotas ? movimiento.nota ?? "" : "", movimiento.fechaOperacion, escrito.fecha(movimiento.fechaOperacion), movimiento.importe ?? ""].join(" ")).includes(texto);
    });
  }, [filas, busqueda, tipo, activoId, origen, seVenLasNotas]);

  /*
   * GES-18: la tabla vuelve a la página 1 cuando cambian sus filas, y las filas cambian con cada
   * edición o borrado. Se lleva aquí su estado y se ignora ese reinicio cuando lo ha causado un
   * cambio de la cartera y no del filtro: tras corregir un movimiento de la página 6, se sigue en la 6.
   * Las refs se ponen al día al final de cada pintado; el reinicio de la tabla llega antes.
   */
  const [estadoDeLaTabla, setEstadoDeLaTabla] = useState<EstadoDeTabla>({ orden: null, sentido: 1, pagina: 1 });
  const claveDelFiltro = [busqueda, tipo, activoId, origen].join("|");
  const filtroPintado = useRef(claveDelFiltro);
  const visiblesPintadas = useRef(visibles);
  useEffect(() => {
    filtroPintado.current = claveDelFiltro;
    visiblesPintadas.current = visibles;
  });
  const alCambiarEstadoDeLaTabla = (siguiente: EstadoDeTabla) => {
    const porLaCartera = visibles !== visiblesPintadas.current && claveDelFiltro === filtroPintado.current;
    if (porLaCartera && siguiente.pagina === 1 && siguiente.orden === estadoDeLaTabla.orden && siguiente.sentido === estadoDeLaTabla.sentido) return;
    setEstadoDeLaTabla(siguiente);
  };

  const borrar = async (movimiento: Movimiento) => {
    const aceptado = await confirm({
      title: "¿Eliminar este movimiento?",
      message: `${nombreDelTipo(movimiento.tipo)} del ${escrito.fecha(movimiento.fechaOperacion)}${movimiento.importe ? `, ${escrito.importeConSigno(aNumero(d(movimiento.importe)), movimiento.divisa ?? cartera.divisaBase)}` : ""}. Se puede deshacer desde el menú «Más».`,
      confirmLabel: "Eliminar",
      tone: "danger"
    });
    if (aceptado) abierta.cambiar("Borrar movimiento", (actual) => ({ ...actual, movimientos: actual.movimientos.filter((existente) => existente.id !== movimiento.id) }), { copiaObligada: true });
  };

  const deshacer = async (importacionId: string, cuantos: number) => {
    const aceptado = await confirm({
      title: "¿Deshacer esta importación?",
      message: `Se quitan sus ${cuantos} movimientos, lo que declaraban sus extractos y los activos que solo usaba ella. Los movimientos que hayas añadido a mano no se tocan.`,
      confirmLabel: "Deshacer la importación",
      tone: "danger"
    });
    if (aceptado) abierta.cambiar("Deshacer una importación", (actual) => deshacerImportacion(actual, importacionId), { copiaObligada: true });
  };

  if (cartera.movimientos.length === 0) {
    return (
      <EmptyState
        action={<Button onClick={() => datos.nuevoMovimiento({ tipo: "aportacion" })} variant="primary">Añadir el primer movimiento</Button>}
        description="El libro está vacío. Añade los movimientos a mano o usa «Importar extractos» para cargarlos de los extractos del banco; se pueden combinar las dos vías en la misma cartera."
        title="Aún no hay movimientos"
      />
    );
  }

  const usados = cartera.activos.filter((activo) => cartera.movimientos.some((movimiento) => movimiento.activoId === activo.id || movimiento.destino?.activoId === activo.id));
  const tiposUsados = TIPOS.filter((definicion) => cartera.movimientos.some((movimiento) => movimiento.tipo === definicion.tipo));
  const hayImportados = cartera.movimientos.some((movimiento) => movimiento.origen?.via === "importado");
  const conErrores = filas.filter((fila) => fila.errores.length > 0).length;

  return (
    <div className="stack stack--bloques">
      <Panel
        acciones={<Button onClick={() => datos.nuevoMovimiento()} size="sm" variant="primary">Añadir movimiento</Button>}
        claseDelCuerpo="stack stack--tight"
        subtitulo={`${visibles.length === filas.length ? `${filas.length} movimientos, del más reciente al más antiguo` : `${visibles.length} de ${filas.length} movimientos`} · el libro entero, a ${escrito.fecha(datos.hoy)}`}
        titulo="Libro de movimientos"
      >
        <div className="gestor-filtros">
          <Campo rotulo="Buscar">
            <input onChange={(evento) => setBusqueda(evento.target.value)} placeholder="Activo, nota, fecha o importe" type="search" value={busqueda} />
          </Campo>
          <Campo rotulo="Tipo">
            <select onChange={(evento) => setTipo(evento.target.value)} value={tipo}>
              <option value="">Todos</option>
              {tiposUsados.map((definicion) => (
                <option key={definicion.tipo} value={definicion.tipo}>{definicion.nombre}</option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Activo">
            <select onChange={(evento) => setActivoId(evento.target.value)} value={activoId}>
              <option value="">Todos</option>
              {usados.map((activo) => (
                <option key={activo.id} value={activo.id}>{activo.nombre}</option>
              ))}
            </select>
          </Campo>
          {hayImportados ? (
            <Campo rotulo="Origen">
              <select onChange={(evento) => setOrigen(evento.target.value)} value={origen}>
                <option value="">Todos</option>
                <option value="manual">A mano</option>
                <option value="importado">Importados</option>
              </select>
            </Campo>
          ) : null}
        </div>
        {conErrores > 0 ? (
          <Aviso tono="error">
            {conErrores === 1 ? "Hay un movimiento que no se puede aplicar" : `Hay ${conErrores} movimientos que no se pueden aplicar`}: su motivo va bajo su nombre. Edítalos para corregirlos.
          </Aviso>
        ) : null}
        {visibles.length === 0 ? (
          <p className="cmp-note">Ningún movimiento responde a ese filtro.</p>
        ) : (
          <TablaDeDatos alAbrir={(fila) => datos.editarMovimiento(fila.movimiento)} columnas={columnas(cartera, datos.editarMovimiento, (movimiento) => void borrar(movimiento), seVenLasNotas)} alCambiarEstado={alCambiarEstadoDeLaTabla} estado={estadoDeLaTabla} filas={visibles} porPagina={25} titulo="Movimientos de la cartera" />
        )}
      </Panel>

      {cartera.importaciones.length > 0 ? (
        <Panel subtitulo="Cada importación se puede deshacer entera" titulo="Importaciones">
          <div className="rows">
            {[...cartera.importaciones].reverse().map((importacion) => (
              <div className="rows__item gestor-fila" key={importacion.id}>
                <span className="gestor-fecha">{escrito.fecha(diaDeUnInstante(importacion.fecha))}</span>
                <span className="rows__label">
                  {importacion.entidad} · {importacion.movimientos} {importacion.movimientos === 1 ? "movimiento" : "movimientos"}
                  <span className="gestor-fila__nota">{importacion.documentos.map((documento) => documento.nombre).join(", ")}</span>
                </span>
                <span className="rows__value">
                  <Button onClick={() => void deshacer(importacion.id, importacion.movimientos)} size="sm" variant="quiet">Deshacer</Button>
                </span>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
      {confirmDialog}
    </div>
  );
}
