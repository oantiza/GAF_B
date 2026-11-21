import { useCallback, useEffect, useMemo, useState } from "react";
import { BASE_NUEVA_DISPONIBLE } from "../adapters/baseNuevaLectura";
import { listarPlanes } from "../adapters/planesDeLaBase";
import { columnasDePlanes, filasDePlanes } from "../adapters/tablaDePlanes";
import { useModoCliente } from "../app/ClientModeContext";
import { AsyncErrorBanner } from "../components/AsyncErrorBanner";
import { ComparadorDePlanes } from "../components/planes/ComparadorDePlanes";
import { FichaDelPlan } from "../components/planes/FichaDelPlan";
import { TablaDeDatos } from "../components/tabla/TablaDeDatos";
import { EmptyState } from "../components/ui/AsyncState";
import { Button } from "../components/ui/Button";
import { Campo } from "../components/ui/Campo";
import { Esqueleto } from "../components/ui/Esqueleto";
import { MenuButton } from "../components/ui/MenuButton";
import { PageHeader } from "../components/ui/PageHeader";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import * as formato from "../core/formato";
import { avisoCortoDelPlan } from "../core/planes/lectura";
import {
  direccionDeLaVista,
  filtrarPlanes,
  FILTRO_INICIAL,
  hayFiltro,
  MAXIMO_A_COMPARAR,
  TODOS,
  valoresDe,
  vistaDeLaDireccion,
  type FiltroDePlanes,
  type PlanDePensiones,
  type VistaDePlanes
} from "../core/planes/modelo";
import { createSessionSlot } from "../core/sessionCaches";
import { useAsyncData } from "../core/useAsyncData";
import type { EstadoDeTabla } from "../types/tablaDeDatos";
import "../styles/planes.css";

/**
 * Planes y EPSV: el catálogo de planes de pensiones y EPSV que comercializa el banco, con su buscador, la ficha de
 * cada uno y la comparación entre ellos (decisión D-11 de Óscar, 13-11-2026).
 *
 * **La pregunta que contesta.** La de un cliente que ya tiene un plan o una EPSV —o va a tenerlo— y quiere verlo
 * junto a otros: «¿qué es el mío, cómo ha ido, y cómo son estos otros?». El asesor lo usa delante de él para
 * describir y comparar, no para elegir por él.
 *
 * **Por qué está aquí y no en el Buscador.** Un plan o una EPSV son patrimonio del cliente, pero no cartera: no se
 * gestionan con ella, por fiscalidad. Por eso este catálogo es aparte: no sale en el Buscador de activos, no se
 * añade a una cartera y no entra en ningún análisis. Vive en Planificación, junto a Jubilación, que es donde se
 * habla de ellos.
 *
 * **Lo que no hace.** No calcula: cada cifra es la del proveedor, con su fecha. La única excepción es el gráfico de
 * la comparación, que pone las series en base 100 para poder dibujarlas juntas, y lo dice. No ordena por atractivo
 * ni recomienda. Y no guarda nada del cliente: lo marcado para comparar vive en memoria y muere con la sesión.
 *
 * La lista, una ficha y una comparación son la misma pantalla. Cuál se ve va al final de la dirección
 * (`#plan=…`, `#comparar=…`), para que el botón de atrás vuelva a la lista y una ficha se pueda enviar.
 *
 * **Cómo se lee** (rediseño del 14-11-2026): la lista es la respuesta, así que no lleva banda de cifras. La cabecera
 * dice de quién son los datos y de cuándo, y a su derecha, en cuanto hay planes marcados, «Comparar N planes» con un
 * menú para quitar alguno: lo que antes era la bandeja «Para comparar», que empujaba la lista hacia abajo. Debajo,
 * los filtros en una fila, la tabla de 25 en 25 y las notas al pie.
 */

/** Un recuento con punto de millar. */
const recuento = (cuantos: number) => formato.numero(cuantos) ?? "";

/** Lo que se ve mientras llega el catálogo: la forma de la tabla, y para quien no ve la pantalla, qué se espera. */
function CargandoLosPlanes() {
  return (
    <div aria-busy="true">
      <p className="sr-only" role="status">
        Leyendo los planes…
      </p>
      <Esqueleto lineas={8} />
    </div>
  );
}

interface EstadoDeLaPantalla {
  filtro: FiltroDePlanes;
  marcados: string[];
  tabla?: EstadoDeTabla;
}

/** El filtro y lo marcado sobreviven a ir a otra pantalla, y nunca a la sesión. */
const planesEnSesion = createSessionSlot<EstadoDeLaPantalla>(() => ({ filtro: FILTRO_INICIAL, marcados: [] }));

const TIPOS = [
  { id: TODOS, label: "Todos" },
  { id: "PENSION_PLAN", label: "Planes de pensiones" },
  { id: "EPSV", label: "EPSV" }
] as const;

function useVista(): [VistaDePlanes, (vista: VistaDePlanes) => void] {
  const [vista, setVista] = useState<VistaDePlanes>(() => vistaDeLaDireccion(window.location.hash));
  useEffect(() => {
    const leer = () => setVista(vistaDeLaDireccion(window.location.hash));
    window.addEventListener("hashchange", leer);
    window.addEventListener("popstate", leer);
    return () => {
      window.removeEventListener("hashchange", leer);
      window.removeEventListener("popstate", leer);
    };
  }, []);
  /* La dirección manda: si al pintarse ya no dice lo que se enseña, se sigue a la dirección. Es lo que pasa cuando el
     menú lleva a la sección estando en una ficha: no hay `popstate` ni `hashchange` que avisen (PLA-11). */
  const enLaDireccion = vistaDeLaDireccion(window.location.hash);
  if (direccionDeLaVista(enLaDireccion) !== direccionDeLaVista(vista)) setVista(enLaDireccion);
  const ir = useCallback((siguiente: VistaDePlanes) => {
    /* Con `pushState` y no tocando `location.hash`: así no salta el enrutador del marco, y atrás vuelve aquí. */
    window.history.pushState(window.history.state, "", `${window.location.pathname}${direccionDeLaVista(siguiente)}`);
    setVista(siguiente);
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);
  return [vista, ir];
}

export function PlanesPage() {
  const { seEnsena } = useModoCliente();
  const conProveedor = seEnsena("fuenteDeDatos");
  const [vista, ir] = useVista();
  const [estado, setEstado] = useState<EstadoDeLaPantalla>(() => planesEnSesion.read());
  useEffect(() => {
    planesEnSesion.write(estado);
  }, [estado]);
  const { filtro, marcados } = estado;
  const cambiarFiltro = (cambio: Partial<FiltroDePlanes>) => setEstado((actual) => ({ ...actual, filtro: { ...actual.filtro, ...cambio } }));

  const { data, error, loading, retry } = useAsyncData(listarPlanes, [], { enabled: BASE_NUEVA_DISPONIBLE });
  const planes = useMemo(() => data ?? [], [data]);
  const porId = useMemo(() => new Map(planes.map((plan) => [plan.id, plan])), [planes]);

  const marcar = useCallback(
    (id: string) =>
      setEstado((actual) => ({
        ...actual,
        marcados: actual.marcados.includes(id)
          ? actual.marcados.filter((otro) => otro !== id)
          : actual.marcados.length < MAXIMO_A_COMPARAR
            ? [...actual.marcados, id]
            : actual.marcados
      })),
    []
  );
  const abrir = useCallback((id: string) => ir({ tipo: "ficha", id }), [ir]);
  const volver = useCallback(() => ir({ tipo: "lista" }), [ir]);

  const filtrados = useMemo(() => filtrarPlanes(planes, filtro), [planes, filtro]);
  const filas = useMemo(() => filasDePlanes(filtrados), [filtrados]);
  const columnas = useMemo(() => columnasDePlanes({ marcados, alMarcar: marcar, alAbrir: abrir, conProveedor }), [marcados, marcar, abrir, conProveedor]);
  const categorias = useMemo(() => valoresDe(planes, "categoria"), [planes]);
  const gestoras = useMemo(() => valoresDe(planes, "gestora"), [planes]);
  const cuantos = useMemo(
    () => ({ planes: planes.filter((plan) => plan.tipo === "PENSION_PLAN").length, epsv: planes.filter((plan) => plan.tipo === "EPSV").length }),
    [planes]
  );
  const consultado = useMemo(() => planes.map((plan) => plan.consultado).sort().at(-1), [planes]);
  const comparar = useCallback((ids: string[]) => ir({ tipo: "comparar", ids }), [ir]);
  /* Los marcados que siguen en el catálogo, en el orden en que se marcaron. */
  const paraComparar = marcados.flatMap((id) => {
    const plan = porId.get(id);
    return plan ? [plan] : [];
  });

  if (!BASE_NUEVA_DISPONIBLE) {
    return (
      <div>
        <PageHeader eyebrow="Planificación" title="Planes y EPSV" />
        <EmptyState
          description="Esta instalación de la aplicación no está conectada al catálogo de planes, así que no hay nada que enseñar aquí sin inventarlo. Tiene que revisarlo quien la administra."
          title="Sin acceso al catálogo"
        />
      </div>
    );
  }

  if (vista.tipo !== "lista" && !data) {
    /* Se ha entrado por la dirección de una ficha o de una comparación: mientras llega el catálogo no se enseña la lista. */
    return (
      <div>
        <PageHeader eyebrow="Planificación" title="Planes y EPSV" />
        {error ? <AsyncErrorBanner error={error} onRetry={retry} /> : <CargandoLosPlanes />}
      </div>
    );
  }

  if (vista.tipo !== "lista" && data) {
    if (vista.tipo === "ficha") {
      const plan = porId.get(vista.id);
      if (plan) {
        return (
          <FichaDelPlan
            alComparar={() => comparar(paraComparar.map((marcadoAntes) => marcadoAntes.id))}
            alMarcar={marcar}
            alVolver={volver}
            cuantosMarcados={paraComparar.length}
            marcado={marcados.includes(plan.id)}
            plan={plan}
          />
        );
      }
    } else {
      const elegidos = vista.ids.flatMap((id) => {
        const plan = porId.get(id);
        return plan ? [plan] : [];
      });
      /* Lo que la dirección pide y el catálogo no tiene no se descarta en silencio (PLA-24). */
      const ausentes = vista.ids.filter((id) => !porId.has(id));
      if (elegidos.length >= 2) return <ComparadorDePlanes alAbrir={abrir} alVolver={volver} ausentes={ausentes} planes={elegidos} />;
    }
    /* La dirección pide un plan que el catálogo no tiene: se dice, y no se enseña otro en su lugar. */
    return (
      <div>
        <PageHeader eyebrow="Planificación" title="Planes y EPSV" />
        <EmptyState
          action={
            <Button onClick={volver} variant="primary">
              Ver todos los planes
            </Button>
          }
          description="La dirección pide un plan que no está en el catálogo. Puede que el banco haya dejado de comercializarlo o que el enlace esté mal copiado."
          title="Ese plan no está en el catálogo"
        />
      </div>
    );
  }

  /* La procedencia de toda la lista: de quién son los datos y de cuándo. */
  const procedencia = data
    ? [
        `${recuento(cuantos.planes)} planes de pensiones y ${recuento(cuantos.epsv)} EPSV`,
        consultado ? `consultado el ${formato.fecha(consultado) ?? consultado}` : "",
        conProveedor ? "Morningstar; la comisión, del buscador del banco" : ""
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;

  return (
    <div className="planes-lista">
      <PageHeader
        actions={
          paraComparar.length > 0 ? (
            <>
              <MenuButton
                actions={[
                  ...paraComparar.map((plan) => ({ id: plan.id, label: `Quitar ${plan.nombre}`, onSelect: () => marcar(plan.id) })),
                  { id: "todos", label: "Quitar todos", onSelect: () => setEstado((actual) => ({ ...actual, marcados: [] })) }
                ]}
                label={`Para comparar, ${paraComparar.length}/${MAXIMO_A_COMPARAR}`}
              />
              <Button
                disabled={paraComparar.length < 2}
                onClick={() => comparar(paraComparar.map((plan: PlanDePensiones) => plan.id))}
                /* Desactivado, dice por qué (PLA-24). */
                title={paraComparar.length < 2 ? "Marca otro plan con «Comparar»: hacen falta dos para compararlos." : undefined}
                variant="primary"
              >
                {`Comparar ${paraComparar.length} ${paraComparar.length === 1 ? "plan" : "planes"}`}
              </Button>
            </>
          ) : undefined
        }
        description={procedencia}
        eyebrow="Planificación"
        title="Planes y EPSV"
      />

      <div className="planes-filtros">
        <Campo className="planes-filtros__buscar" rotulo="Buscar">
          <input onChange={(evento) => cambiarFiltro({ busqueda: evento.target.value })} placeholder="Nombre, gestora o código" type="search" value={filtro.busqueda} />
        </Campo>
        {/* Un filtro de la lista y no un juego de pestañas: no hay paneles a los que apuntar (MAR-14, DIR-10). */}
        <div className="field">
          <span className="field__label" aria-hidden="true">
            Producto
          </span>
          <SegmentedControl label="Producto" onChange={(tipo) => cambiarFiltro({ tipo })} options={TIPOS} value={filtro.tipo} />
        </div>
        <Campo rotulo="Categoría">
          <select onChange={(evento) => cambiarFiltro({ categoria: evento.target.value })} value={filtro.categoria}>
            <option value={TODOS}>Todas</option>
            {categorias.map((valor) => (
              <option key={valor} value={valor}>
                {valor}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Gestora">
          <select onChange={(evento) => cambiarFiltro({ gestora: evento.target.value })} value={filtro.gestora}>
            <option value={TODOS}>Todas</option>
            {gestoras.map((valor) => (
              <option key={valor} value={valor}>
                {valor}
              </option>
            ))}
          </select>
        </Campo>
        {hayFiltro(filtro) ? (
          <Button onClick={() => setEstado((actual) => ({ ...actual, filtro: FILTRO_INICIAL }))} size="sm" variant="quiet">
            Limpiar búsqueda y filtros
          </Button>
        ) : null}
        {data ? (
          <p aria-live="polite" className="planes-filtros__cuantos">
            {recuento(filas.length)} de {recuento(planes.length)}
          </p>
        ) : null}
      </div>

      {error ? <AsyncErrorBanner error={error} onRetry={retry} /> : null}
      {loading && !data ? <CargandoLosPlanes /> : null}

      {data ? (
        <>
          {filas.length > 0 ? (
            <TablaDeDatos
              alAbrir={(fila) => abrir(fila.id)}
              alCambiarEstado={(tabla) => setEstado((actual) => ({ ...actual, tabla }))}
              columnas={columnas}
              deActivos
              /* Un plan cuyo valor lleva meses parado sigue en la lista del banco: se dice bajo su fila, no se esconde. */
              detalleDe={(fila) => {
                const aviso = avisoCortoDelPlan(fila.plan);
                return aviso ? <p className="planes-lista__aviso">{aviso}</p> : undefined;
              }}
              estado={estado.tabla}
              filas={filas}
              porPagina={25}
              seleccionada={(fila) => marcados.includes(fila.id)}
              titulo="Planes de pensiones y EPSV"
            />
          ) : (
            <EmptyState
              action={
                hayFiltro(filtro) ? (
                  <Button onClick={() => setEstado((actual) => ({ ...actual, filtro: FILTRO_INICIAL }))} variant="secondary">
                    Limpiar búsqueda y filtros
                  </Button>
                ) : undefined
              }
              description={planes.length === 0 ? "El catálogo de planes está vacío: todavía no se ha cargado ninguno." : "Prueba con otro nombre, gestora o código, o quita algún filtro."}
              title={planes.length === 0 ? "No hay planes en el catálogo" : "No hay planes que coincidan"}
            />
          )}

          {/* Las notas, una vez y al pie: lo que hace falta para leer bien la lista. */}
          <div className="planes-notas">
            <p className="cmp-note">
              Rentabilidades en euros; a 3 y 5 años, anualizadas. Cada cifra es la que da {conProveedor ? "Morningstar" : "el proveedor de los datos"}, y la comisión, la que publica{" "}
              {conProveedor ? "el banco" : "la entidad comercializadora"}: aquí no se calcula ninguna.
            </p>
            <p className="cmp-note">Marca de dos a {MAXIMO_A_COMPARAR} planes con «Comparar» para verlos uno junto a otro.</p>
            <p className="cmp-note">
              Los planes de pensiones y las EPSV no son parte de la cartera: no salen en el Buscador, no se añaden a una propuesta y no entran en ningún análisis.
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}
