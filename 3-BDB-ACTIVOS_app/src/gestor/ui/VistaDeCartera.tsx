/**
 * Una cartera de cliente abierta: su cabecera, su respuesta (cuánto vale y cuánto ha ganado), el
 * periodo que se mira, sus pestañas y los diálogos (movimiento, importación, informes, ajustes).
 * Aquí se cargan los datos de mercado y se hace el análisis una vez; cada pestaña solo lo lee.
 *
 * La pestaña elegida va en la dirección (`#pestana=…`), y en Análisis también su vista.
 */
import { useCallback, useEffect, useId, useState } from "react";
import { Aviso } from "../../components/ui/Aviso";
import { Button } from "../../components/ui/Button";
import { Campo } from "../../components/ui/Campo";
import { MenuButton, type MenuAction } from "../../components/ui/MenuButton";
import { PageHeader } from "../../components/ui/PageHeader";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { PanelDePestana, SegmentedTabs } from "../../components/ui/SegmentedTabs";
import { useConfirm } from "../../components/ui/useConfirm";
import { usePestanaEnLaDireccion } from "../../core/usePestanaEnLaDireccion";
import type { PositionsPortfolioTransfer } from "../../core/positionsToPortfolio";
import type { AlmacenDeCarteras } from "../almacen/almacen";
import { esDemostracion } from "../demo/carteraDemo";
import type { IdDePeriodo } from "../motor/analisis";
import { hoy as diaDeHoy, sumarAnios } from "../motor/fechas";
import type { Cartera, Movimiento } from "../motor/modelo";
import { AsistenteDeImportacion } from "./dialogos/AsistenteDeImportacion";
import { DialogoDeAjustes } from "./dialogos/DialogoDeAjustes";
import { DialogoDeInformes } from "./dialogos/DialogoDeInformes";
import { DialogoDeVersiones } from "./dialogos/DialogoDeVersiones";
import { FormularioDeMovimiento } from "./dialogos/FormularioDeMovimiento";
import { PESTANAS_DE_LA_CARTERA, ponerLaVistaDelAnalisis, type VistaDelAnalisis } from "./direccion";
import { useAnalisisDeCartera, useMercadoDeCartera, type PeriodoElegido } from "./estado/useAnalisisDeCartera";
import { useCarteraAbierta, type EstadoDeGuardado } from "./estado/useCarteraAbierta";
import { RespuestaDeLaCartera } from "./RespuestaDeLaCartera";
import { preguntarAntesDeSalir, registrarPreguntaDeSalida } from "./salidaDeLaCartera";
import { escrito } from "./textos";
import type { DatosDeVista, VistaDeLaCartera } from "./tipos";
import { VistaAnalisis } from "./vistas/VistaAnalisis";
import { VistaComparar } from "./vistas/VistaComparar";
import { VistaCuentas } from "./vistas/VistaCuentas";
import { VistaMovimientos } from "./vistas/VistaMovimientos";
import { VistaResumen } from "./vistas/VistaResumen";

const PESTANAS: ReadonlyArray<{ id: VistaDeLaCartera; label: string }> = [
  { id: "resumen", label: "Resumen" },
  { id: "cuentas", label: "Cuentas" },
  { id: "movimientos", label: "Movimientos" },
  { id: "analisis", label: "Análisis" },
  { id: "comparar", label: "Comparar" }
];

/** Las pestañas que gobierna el periodo. Cuentas tiene su propia fecha y Movimientos es el libro entero. */
const CON_PERIODO: ReadonlySet<VistaDeLaCartera> = new Set(["resumen", "analisis", "comparar"]);

const TEXTO_DE_GUARDADO: Record<EstadoDeGuardado, string> = {
  guardado: "Guardada en tu equipo",
  pendiente: "Guardando…",
  guardando: "Guardando…",
  error: "No se ha podido guardar",
  "sin-descargar": "Cambios sin descargar",
  "no-se-guarda": "Demostración: no se guarda"
};

type Dialogo =
  | { clase: "movimiento"; movimiento?: Movimiento; inicial?: Partial<Movimiento> }
  | { clase: "importar" }
  | { clase: "informes" }
  | { clase: "ajustes" }
  | { clase: "versiones" };

export function VistaDeCartera({ inicial, fichero, almacen, alVolver, accionInicial, onSendToBuilder, migrada = false }: {
  inicial: Cartera;
  fichero: string | null;
  almacen: AlmacenDeCarteras | null;
  alVolver: () => void;
  accionInicial?: "importar";
  onSendToBuilder?: (cartera: PositionsPortfolioTransfer) => void;
  /** Si el fichero se actualizó al abrirlo desde una versión anterior del gestor. */
  migrada?: boolean;
}) {
  const abierta = useCarteraAbierta(inicial, almacen, fichero, { migrada });
  const { cartera } = abierta;
  const demo = esDemostracion(cartera);
  const idDelPorQueDeLosInformes = useId();
  /* «Hoy» se vuelve a mirar al volver a la pestaña: una cartera abierta pasada la medianoche valora al día nuevo (GES-26). */
  const [hoy, setHoy] = useState(() => diaDeHoy());
  useEffect(() => {
    const alVolverALaPestana = () => {
      if (document.visibilityState === "visible") setHoy(diaDeHoy());
    };
    document.addEventListener("visibilitychange", alVolverALaPestana);
    return () => document.removeEventListener("visibilitychange", alVolverALaPestana);
  }, []);
  const [vista, elegirVista] = usePestanaEnLaDireccion<VistaDeLaCartera>(PESTANAS_DE_LA_CARTERA, "resumen");
  const irA = useCallback(
    (destino: VistaDeLaCartera, vistaDelAnalisis?: VistaDelAnalisis) => {
      if (destino === "analisis" && vistaDelAnalisis) ponerLaVistaDelAnalisis(vistaDelAnalisis);
      elegirVista(destino);
    },
    [elegirVista]
  );
  const [elegido, setElegido] = useState<PeriodoElegido>({ id: "anio" });
  const [dialogo, setDialogo] = useState<Dialogo | null>(accionInicial === "importar" ? { clase: "importar" } : null);
  const { confirm, confirmDialog } = useConfirm();

  const mercado = useMercadoDeCartera(cartera, hoy);
  const { analisis, preparado, periodos, periodo, caido } = useAnalisisDeCartera(cartera, mercado.mercado, hoy, elegido);
  const periodoCaido = caido && !analisis.vacia;

  const datos: DatosDeVista = {
    abierta,
    analisis,
    preparado,
    periodos,
    periodo,
    elegido,
    periodoCaido,
    hoy,
    mercado,
    almacen,
    irA,
    nuevoMovimiento: (inicialDelMovimiento) => setDialogo({ clase: "movimiento", inicial: inicialDelMovimiento }),
    editarMovimiento: (movimiento) => setDialogo({ clase: "movimiento", movimiento })
  };

  const opcionesDePeriodo = [
    ...periodos.map((habitual) => ({ id: habitual.id, label: habitual.nombre, disabled: !habitual.disponible })),
    { id: "libre" as IdDePeriodo, label: "Entre dos fechas", disabled: analisis.vacia }
  ];

  const retirar = async () => {
    if (!almacen || !abierta.fichero) return;
    const aceptado = await confirm({
      title: `¿Retirar la cartera «${cartera.nombre}»?`,
      message: "La cartera y sus copias de seguridad se mueven a la subcarpeta «papelera» de tu carpeta de carteras. No se borra nada: se recupera desde «Carteras retiradas», al pie de la lista de carteras.",
      confirmLabel: "Retirar",
      tone: "danger"
    });
    if (!aceptado) return;
    if (await abierta.retirar()) alVolver();
  };

  /* Antes de salir se escribe lo pendiente; si aun así se perderían cambios, se pregunta. La misma
     pregunta la hace el marco al salir por el menú o al enviar a Diseño (GES-01). */
  const { prepararSalida, descargarCopia, descartarCambios } = abierta;
  const conCarpeta = almacen !== null;
  const preguntarSiSalir = useCallback(
    () => preguntarAntesDeSalir({ prepararSalida, descargarCopia, descartarCambios }, confirm, conCarpeta),
    [prepararSalida, descargarCopia, descartarCambios, confirm, conCarpeta]
  );
  useEffect(() => registrarPreguntaDeSalida(preguntarSiSalir), [preguntarSiSalir]);
  const volver = async () => {
    if (await preguntarSiSalir()) alVolver();
  };

  const conflicto = abierta.guardado === "error" && abierta.codigoDeError === "CONFLICTO";

  /* Una acción desactivada dice por qué, en su segunda línea. */
  const sinVersiones = demo ? "La cartera de demostración no se guarda: no tiene copias." : !almacen ? "Sin carpeta de carteras no hay copias de seguridad." : undefined;
  const sinDescarga = demo ? "La cartera de demostración no se descarga." : almacen !== null && abierta.guardado !== "error" ? "Se guarda sola en tu carpeta de carteras." : undefined;
  const sinRetirar = demo ? "La cartera de demostración no está en tu carpeta." : !almacen || !abierta.fichero ? "Solo se retira una cartera guardada en tu carpeta." : undefined;
  const acciones: MenuAction[] = [
    { id: "deshacer", label: abierta.accionADeshacer ? `Deshacer: ${abierta.accionADeshacer}` : "Deshacer", description: abierta.accionADeshacer ? undefined : "No hay nada que deshacer.", onSelect: abierta.deshacer, disabled: !abierta.accionADeshacer },
    { id: "rehacer", label: abierta.accionARehacer ? `Rehacer: ${abierta.accionARehacer}` : "Rehacer", description: abierta.accionARehacer ? undefined : "No hay nada que rehacer.", onSelect: abierta.rehacer, disabled: !abierta.accionARehacer },
    { id: "ajustes", label: "Ajustes de la cartera", description: "Nombre, cliente, cuentas, referencia y precios a mano", onSelect: () => setDialogo({ clase: "ajustes" }) },
    { id: "versiones", label: "Versiones anteriores", description: sinVersiones ?? "Recuperar una copia de seguridad", onSelect: () => setDialogo({ clase: "versiones" }), disabled: sinVersiones !== undefined },
    { id: "descargar", label: "Descargar una copia de la cartera", description: sinDescarga ?? "El fichero de la cartera, para guardarlo donde quieras", onSelect: abierta.descargarCopia, disabled: sinDescarga !== undefined },
    { id: "retirar", label: "Retirar la cartera", description: sinRetirar, onSelect: () => void retirar(), disabled: sinRetirar !== undefined, danger: true }
  ];

  const contexto = ["Cartera de cliente", cartera.cliente?.nombre, cartera.cuentas.valores.entidad, cartera.divisaBase === "EUR" ? "en euros" : `en ${cartera.divisaBase}`].filter(Boolean).join(" · ");
  const movimientos = cartera.movimientos.length;
  const ultimoDato = mercado.mercado.ultimoDato;

  return (
    <section aria-labelledby="gestor-cartera-titulo" className="stack stack--bloques gestor">
      <div>
        <Button onClick={() => void volver()} size="sm" variant="quiet">← Carteras de clientes</Button>
      </div>
      <PageHeader
        actions={
          <>
            <MenuButton actions={acciones} align="end" label="Más" />
            <Button aria-describedby={analisis.vacia ? idDelPorQueDeLosInformes : undefined} disabled={analisis.vacia} onClick={() => setDialogo({ clase: "informes" })}>Informes</Button>
            {analisis.vacia ? <span className="sr-only" id={idDelPorQueDeLosInformes}>Los informes necesitan movimientos.</span> : null}
            <Button onClick={() => setDialogo({ clase: "importar" })}>Importar extractos</Button>
            <Button onClick={() => setDialogo({ clase: "movimiento" })} variant="primary">Añadir movimiento</Button>
          </>
        }
        description={
          <span className={abierta.guardado === "error" ? "gestor-estado gestor-estado--error" : "gestor-estado"}>
            {/* GES-17: solo el texto es la región que se anuncia; los botones van fuera de ella. */}
            <span role="status">{conflicto ? "La cartera ha cambiado fuera de esta pestaña" : TEXTO_DE_GUARDADO[abierta.guardado]}</span>
            {abierta.guardado === "sin-descargar" ? (
              <button className="gestor-enlace" onClick={() => void abierta.guardarAhora()} type="button">Descargar ahora</button>
            ) : null}
            {abierta.guardado === "error" && conflicto ? (
              <>
                <button className="gestor-enlace" onClick={() => void abierta.recargarDelDisco()} type="button">Recargar la versión del disco</button>
                <button className="gestor-enlace" onClick={() => void abierta.guardarComoCopia()} type="button">Guardar como una cartera aparte</button>
              </>
            ) : null}
            {abierta.guardado === "error" && !conflicto ? (
              <button className="gestor-enlace" onClick={() => void abierta.guardarAhora()} type="button">{almacen ? "Reintentar" : "Descargar ahora"}</button>
            ) : null}
            {abierta.guardado === "error" && abierta.codigoDeError === "PERMISO" && almacen?.pedirPermiso ? (
              <button className="gestor-enlace" onClick={() => void abierta.volverADarPermiso()} type="button">Volver a dar permiso</button>
            ) : null}
            {abierta.guardado === "error" ? (
              <button className="gestor-enlace" onClick={abierta.descargarCopia} type="button">Descargar una copia ahora</button>
            ) : null}
            <span className="gestor-estado__dato">
              {` · ${movimientos} ${movimientos === 1 ? "movimiento" : "movimientos"}`}
              {ultimoDato ? ` · precios hasta el ${escrito.fecha(ultimoDato)}` : ""}
            </span>
          </span>
        }
        eyebrow={contexto}
        title={cartera.nombre}
        titleId="gestor-cartera-titulo"
      />

      {demo ? (
        <Aviso titulo="Cartera de demostración.">
          Sus activos no existen y sus precios son inventados. Puedes cambiar lo que quieras para probar; nada se guarda.
        </Aviso>
      ) : null}
      {migrada ? (
        <Aviso anunciar tono="nota">
          Esta cartera se guardó con una versión anterior del gestor y se ha actualizado al abrirla. El fichero no cambia hasta el primer guardado, y entonces su versión antigua queda en las copias de seguridad.
        </Aviso>
      ) : null}
      {abierta.errorDeGuardado ? (
        <Aviso tono="error">
          {abierta.errorDeGuardado}
          {conflicto ? " Puedes recargar la versión del disco (lo de esta pestaña queda en «Deshacer», en el menú «Más») o guardar lo de esta pestaña como una cartera aparte." : ""}
        </Aviso>
      ) : null}
      {mercado.error ? (
        <Aviso accion={<Button onClick={mercado.reintentar} size="sm">Reintentar</Button>} tono="error">
          {mercado.error} Las posiciones se valoran con lo que haya en la cartera.
        </Aviso>
      ) : null}

      <RespuestaDeLaCartera datos={datos} />

      <div className="gestor-mandos">
        <SegmentedTabs className="gestor-mandos__pestanas" idPrefix="gestor" label="Secciones de la cartera" onChange={elegirVista} tabs={PESTANAS} value={vista} />
        {CON_PERIODO.has(vista) ? (
          <div className="gestor-periodo">
            <SegmentedControl
              label="Periodo"
              onChange={(id) => setElegido(id === "libre" ? { id, libre: elegido.libre ?? { desde: sumarAnios(hoy, -1) < periodo.desde ? periodo.desde : sumarAnios(hoy, -1), hasta: hoy } } : { id })}
              options={opcionesDePeriodo}
              value={elegido.id}
            />
            {elegido.id === "libre" && elegido.libre ? (
              <span className="gestor-fechas">
                <Campo rotulo="Desde">
                  <input max={elegido.libre.hasta} onChange={(evento) => evento.target.value && setElegido({ id: "libre", libre: { ...elegido.libre!, desde: evento.target.value } })} type="date" value={elegido.libre.desde} />
                </Campo>
                <Campo rotulo="Hasta">
                  <input max={hoy} min={elegido.libre.desde} onChange={(evento) => evento.target.value && setElegido({ id: "libre", libre: { ...elegido.libre!, hasta: evento.target.value } })} type="date" value={elegido.libre.hasta} />
                </Campo>
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      {CON_PERIODO.has(vista) && periodoCaido ? (
        <Aviso anunciar>
          {elegido.id === "libre" ? "Las fechas no forman un periodo: se enseña desde el inicio." : "La cartera no tiene historia para ese periodo: se enseña desde el inicio."}
        </Aviso>
      ) : null}
      {mercado.cargando ? <p className="gestor-nota" role="status">Actualizando precios…</p> : null}

      <PanelDePestana idPrefix="gestor" pestana={vista}>
        {vista === "resumen" ? <VistaResumen datos={datos} /> : null}
        {vista === "cuentas" ? <VistaCuentas datos={datos} /> : null}
        {vista === "movimientos" ? <VistaMovimientos datos={datos} /> : null}
        {vista === "analisis" ? <VistaAnalisis datos={datos} /> : null}
        {vista === "comparar" ? <VistaComparar datos={datos} onSendToBuilder={onSendToBuilder} /> : null}
      </PanelDePestana>

      {dialogo?.clase === "movimiento" ? (
        <FormularioDeMovimiento
          alCerrar={() => setDialogo(null)}
          alGuardar={(movimiento, activosNuevos, esNuevo) => {
            abierta.cambiar(esNuevo ? "Añadir movimiento" : "Editar movimiento", (actual) => ({
              ...actual,
              activos: [...actual.activos, ...activosNuevos.filter((activo) => !actual.activos.some((existente) => existente.id === activo.id))],
              movimientos: esNuevo ? [...actual.movimientos, movimiento] : actual.movimientos.map((existente) => (existente.id === movimiento.id ? movimiento : existente))
            }));
            setDialogo(null);
          }}
          cartera={cartera}
          hoy={hoy}
          inicial={dialogo.inicial}
          movimiento={dialogo.movimiento}
          precios={mercado.mercado.datos}
        />
      ) : null}
      {dialogo?.clase === "importar" ? (
        <AsistenteDeImportacion
          alAplicar={(nueva, descripcion) => {
            abierta.cambiar(descripcion, () => nueva);
            setDialogo(null);
            elegirVista("movimientos");
          }}
          alCerrar={() => setDialogo(null)}
          cartera={cartera}
        />
      ) : null}
      {dialogo?.clase === "informes" ? <DialogoDeInformes
          actualizando={mercado.cargando}
          alCambiarLaReferencia={(nueva) => abierta.cambiar("Cambiar la referencia", (actual) => ({ ...actual, referencia: nueva }))}
          alCerrar={() => setDialogo(null)}
          almacen={almacen}
          analisis={analisis}
          avisosDeMercado={mercado.mercado.avisos}
          cartera={cartera}
        /> : null}
      {dialogo?.clase === "ajustes" ? <DialogoDeAjustes abierta={abierta} alCerrar={() => setDialogo(null)} hoy={hoy} /> : null}
      {dialogo?.clase === "versiones" && almacen ? (
        <DialogoDeVersiones
          alCerrar={() => setDialogo(null)}
          alRecuperar={(recuperada) => {
            abierta.cambiar("Recuperar una versión anterior", () => recuperada, { copiaObligada: true });
            setDialogo(null);
          }}
          almacen={almacen}
          cartera={cartera}
        />
      ) : null}
      {confirmDialog}
    </section>
  );
}
