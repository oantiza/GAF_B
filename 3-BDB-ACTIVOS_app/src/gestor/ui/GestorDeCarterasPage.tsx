/**
 * Carteras de clientes: la puerta de entrada. Enseña las carteras de la carpeta del usuario,
 * guía el primer uso (elegir carpeta, crear, importar o probar la demostración) y abre una
 * cartera para trabajar con ella.
 *
 * Las carteras son ficheros en el disco del usuario. Nada de aquí escribe en la base ni en
 * el almacenamiento del navegador.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useModoCliente } from "../../app/ClientModeContext";
import { EmptyState, LoadingState } from "../../components/ui/AsyncState";
import { Aviso } from "../../components/ui/Aviso";
import { Button } from "../../components/ui/Button";
import { Campo } from "../../components/ui/Campo";
import { MenuButton } from "../../components/ui/MenuButton";
import { DialogBody, DialogFooter, DialogHeader, ModalDialog } from "../../components/ui/ModalDialog";
import { PageHeader } from "../../components/ui/PageHeader";
import { Panel } from "../../components/ui/Panel";
import { TablaDeDatos } from "../../components/tabla/TablaDeDatos";
import type { PositionsPortfolioTransfer } from "../../core/positionsToPortfolio";
import { textoDeAusencia } from "../../core/textoDeAusencia";
import type { ColumnaDeTabla } from "../../types/tablaDeDatos";
import type { AlmacenDeCarteras, ResumenDeCartera } from "../almacen/almacen";
import { abrirFichero } from "../almacen/descarga";
import { demostracion } from "../demo/carteraDemo";
import { hoy as diaDeHoy } from "../motor/fechas";
import { carteraVacia, type Cartera } from "../motor/modelo";
import { CarterasRetiradas } from "./CarterasRetiradas";
import { useAlmacen } from "./estado/useAlmacen";
import { diaDeUnInstante } from "./formato";
import { escrito } from "./textos";
import { VistaDeCartera } from "./VistaDeCartera";
import "../../styles/gestor.css";

interface Abierta {
  /** Cambia cada vez que se abre una cartera: fuerza a la vista a empezar de cero. */
  clave: string;
  cartera: Cartera;
  fichero: string | null;
  accionInicial?: "importar";
  /** Si se actualizó al abrirla desde una versión anterior del fichero: se avisa dentro de la cartera (GES-24). */
  migrada?: boolean;
}

interface FilaDeCartera extends ResumenDeCartera {
  /** El fichero: la clave de la fila. */
  id: string;
  apunte?: string;
}

const DIVISAS_BASE = ["EUR", "USD", "GBP", "CHF"];

function DialogoDeNuevaCartera({ titulo, alCrear, alCerrar }: { titulo: string; alCrear: (cartera: Cartera) => void; alCerrar: () => void }) {
  const idDelTitulo = useId();
  const [nombre, setNombre] = useState("");
  const [cliente, setCliente] = useState("");
  const [entidad, setEntidad] = useState("");
  const [divisa, setDivisa] = useState("EUR");
  const crear = () => {
    if (!nombre.trim()) return;
    const cartera = carteraVacia({ nombre: nombre.trim(), divisaBase: divisa, entidad: entidad.trim() || undefined });
    alCrear(cliente.trim() ? { ...cartera, cliente: { nombre: cliente.trim() } } : cartera);
  };
  return (
    <ModalDialog labelledBy={idDelTitulo} onClose={alCerrar} size="sm">
      <DialogHeader onClose={alCerrar} title={titulo} titleId={idDelTitulo} />
      <DialogBody className="stack">
        <Campo rotulo="Nombre de la cartera">
          <input autoFocus onChange={(evento) => setNombre(evento.target.value)} onKeyDown={(evento) => {
            /* DIR-01: anulada, para que la misma pulsación no active el botón que abrió el diálogo y lo reabra. */
            if (evento.key !== "Enter") return;
            evento.preventDefault();
            crear();
          }} placeholder="Por ejemplo, Familia García" type="text" value={nombre} />
        </Campo>
        <Campo opcional rotulo="Cliente">
          <input onChange={(evento) => setCliente(evento.target.value)} type="text" value={cliente} />
        </Campo>
        <Campo opcional rotulo="Entidad donde están las cuentas">
          <input onChange={(evento) => setEntidad(evento.target.value)} type="text" value={entidad} />
        </Campo>
        <Campo pista="La divisa en la que se valora todo. No se puede cambiar después." rotulo="Divisa de la cartera">
          <select onChange={(evento) => setDivisa(evento.target.value)} value={divisa}>
            {DIVISAS_BASE.map((codigo) => (
              <option key={codigo} value={codigo}>{codigo}</option>
            ))}
          </select>
        </Campo>
      </DialogBody>
      <DialogFooter>
        <Button onClick={alCerrar} variant="quiet">Cancelar</Button>
        <Button disabled={!nombre.trim()} onClick={crear} variant="primary">Crear la cartera</Button>
      </DialogFooter>
    </ModalDialog>
  );
}

const COLUMNAS: ColumnaDeTabla<FilaDeCartera>[] = [
  { id: "nombre", titulo: "Cartera", encabezaFila: true, celda: (fila) => ({ texto: fila.nombre, valor: fila.nombre.toLowerCase(), apunte: fila.error ?? fila.apunte }) },
  { id: "cliente", titulo: "Cliente", celda: (fila) => (fila.cliente ? { texto: fila.cliente } : { texto: textoDeAusencia("no-aplica"), ausencia: "no-aplica" }) },
  { id: "movimientos", titulo: "Movimientos", cifra: true, celda: (fila) => ({ texto: String(fila.movimientos), valor: fila.movimientos }) },
  { id: "divisa", titulo: "Divisa", celda: (fila) => ({ texto: fila.divisaBase }) },
  { id: "modificada", titulo: "Modificada", tituloCompleto: "Última modificación", cifra: true, celda: (fila) => ({ texto: fila.modificada ? escrito.fecha(diaDeUnInstante(fila.modificada)) : "", valor: fila.modificada }) }
];

/**
 * Las filas de la lista. La clave de cada fila es su fichero, que es único en la carpeta: dos
 * ficheros copiados uno de otro comparten el identificador de la cartera (GES-14). A esos se les
 * avisa, porque comparten también sus copias de seguridad y retirar uno se lleva las del otro.
 */
function filasDeLaLista(lista: readonly ResumenDeCartera[]): FilaDeCartera[] {
  const porId = new Map<string, string[]>();
  for (const resumen of lista) if (resumen.id) porId.set(resumen.id, [...(porId.get(resumen.id) ?? []), resumen.fichero]);
  return lista.map((resumen) => {
    const otros = (resumen.id ? porId.get(resumen.id) ?? [] : []).filter((fichero) => fichero !== resumen.fichero);
    const aviso = otros.length > 0 ? `Es una copia de «${otros.join("», «")}»: comparten las copias de seguridad, y retirar uno se lleva también las del otro.` : undefined;
    return { ...resumen, id: resumen.fichero, apunte: aviso };
  });
}

/** Sin tildes ni mayúsculas: «garcia» encuentra «García». */
function plegar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function ListaDeCarteras({ almacen, alAbrir, alCrear, alImportar, alAbrirDemo, alCambiarDeCarpeta }: {
  almacen: AlmacenDeCarteras;
  alAbrir: (fichero: string) => void;
  alCrear: () => void;
  alImportar: () => void;
  alAbrirDemo: () => void;
  alCambiarDeCarpeta: () => void;
}) {
  const { seEnsena } = useModoCliente();
  const [carteras, setCarteras] = useState<FilaDeCartera[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  useEffect(() => {
    let vigente = true;
    almacen
      .listar()
      .then((lista) => {
        if (vigente) setCarteras(filasDeLaLista(lista));
      })
      .catch((causa: unknown) => {
        if (vigente) setError(causa instanceof Error ? causa.message : "No se ha podido leer la carpeta de carteras.");
      });
    return () => {
      vigente = false;
    };
  }, [almacen]);

  const visibles = useMemo(() => {
    const texto = plegar(busqueda.trim());
    if (!carteras || !texto) return carteras ?? [];
    return carteras.filter((fila) => plegar(`${fila.nombre} ${fila.cliente ?? ""}`).includes(texto));
  }, [carteras, busqueda]);

  if (error) {
    return <EmptyState action={<Button onClick={alCambiarDeCarpeta} variant="primary">Elegir la carpeta de nuevo</Button>} description={error} title="No se puede leer la carpeta de carteras" />;
  }
  if (carteras === null) return <LoadingState>Leyendo la carpeta de carteras…</LoadingState>;
  /* GES-08: delante de un cliente, las carteras de los demás no se enseñan (decisión 19). */
  if (!seEnsena("otrasCarteras") && carteras.length > 0) {
    return <EmptyState description="Las carteras de la carpeta son de tus clientes y no se enseñan en Modo cliente. Sal de Modo cliente para verlas y abrir una." title="Tus carteras no se enseñan en Modo cliente" />;
  }
  if (carteras.length === 0) {
    return (
      <EmptyState
        action={
          <div className="row">
            <Button onClick={alCrear} variant="primary">Crear una cartera</Button>
            <Button onClick={alImportar}>Importarla de los extractos del banco</Button>
            <Button onClick={alAbrirDemo} variant="quiet">Ver la cartera de demostración</Button>
          </div>
        }
        description={`La carpeta «${almacen.nombre}» está vacía. Crea tu primera cartera e introduce sus movimientos, o cárgala a partir de los extractos del banco. Si antes quieres ver cómo funciona, abre la cartera de demostración.`}
        title="Aún no hay carteras"
      />
    );
  }
  return (
    <Panel
      claseDelCuerpo="stack stack--tight"
      subtitulo={busqueda.trim() ? `${visibles.length} de ${carteras.length} carteras` : `${carteras.length} ${carteras.length === 1 ? "cartera" : "carteras"}`}
      titulo="Tus carteras"
    >
      <Campo className="gestor-buscar" rotulo="Buscar">
        <input onChange={(evento) => setBusqueda(evento.target.value)} placeholder="Nombre de la cartera o del cliente" type="search" value={busqueda} />
      </Campo>
      {visibles.length === 0 ? (
        <p className="cmp-note" role="status">Ninguna cartera responde a «{busqueda.trim()}».</p>
      ) : (
        <TablaDeDatos alAbrir={(fila) => (fila.error ? undefined : alAbrir(fila.fichero))} columnas={COLUMNAS} deActivos filas={visibles} titulo="Carteras guardadas en tu equipo" />
      )}
    </Panel>
  );
}

export function GestorDeCarterasPage({ onSendToBuilder }: { onSendToBuilder?: (cartera: PositionsPortfolioTransfer) => void } = {}) {
  const control = useAlmacen();
  const [abierta, setAbierta] = useState<Abierta | null>(null);
  const [dialogo, setDialogo] = useState<null | "nueva" | "importar">(null);
  const [aviso, setAviso] = useState<string | null>(null);
  /* Cambia al recuperar una cartera retirada: la lista se vuelve a leer y la enseña. */
  const [lecturaDeLaLista, setLecturaDeLaLista] = useState(0);
  const selectorDeFichero = useRef<HTMLInputElement>(null);
  const almacen = control.estado.fase === "lista" ? control.estado.almacen : null;

  const abrir = useCallback((cartera: Cartera, fichero: string | null, accionInicial?: "importar", migrada = false) => {
    setAviso(null);
    setAbierta({ clave: `${cartera.id}-${Date.now()}`, cartera, fichero, accionInicial, migrada });
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  const abrirDeLaCarpeta = useCallback(async (fichero: string) => {
    if (!almacen) return;
    try {
      const leida = await almacen.abrir(fichero);
      abrir(leida.cartera, fichero, undefined, Boolean(leida.migrada));
    } catch (causa) {
      setAviso(causa instanceof Error ? causa.message : "No se ha podido abrir la cartera.");
    }
  }, [abrir, almacen]);

  const abrirDeUnFichero = useCallback(async (fichero: File | undefined) => {
    if (!fichero) return;
    try {
      abrir((await abrirFichero(fichero)).cartera, null);
    } catch (causa) {
      setAviso(causa instanceof Error ? causa.message : "No se ha podido abrir el fichero.");
    }
  }, [abrir]);

  const crear = useCallback(async (cartera: Cartera, accionInicial?: "importar") => {
    setDialogo(null);
    if (!almacen) {
      abrir(cartera, null, accionInicial);
      return;
    }
    try {
      const { fichero } = await almacen.guardar(cartera);
      abrir(cartera, fichero, accionInicial);
    } catch (causa) {
      setAviso(causa instanceof Error ? causa.message : "No se ha podido crear la cartera.");
    }
  }, [abrir, almacen]);

  const abrirDemo = useCallback(() => abrir(demostracion(diaDeHoy()).cartera, null), [abrir]);

  if (abierta) {
    return <VistaDeCartera accionInicial={abierta.accionInicial} alVolver={() => setAbierta(null)} almacen={almacen} fichero={abierta.fichero} inicial={abierta.cartera} key={abierta.clave} migrada={abierta.migrada} onSendToBuilder={onSendToBuilder} />;
  }

  const fase = control.estado.fase;
  const procedencia =
    fase === "lista"
      ? `En tu equipo, en la carpeta «${control.estado.almacen.nombre}». Cada cartera es un fichero de esa carpeta y no sale de él.`
      : "El seguimiento de las carteras de tus clientes: movimientos, posiciones, rentabilidad e informes. Las carteras se guardan como ficheros en tu equipo y no salen de él.";
  return (
    <section aria-labelledby="gestor-titulo" className="stack stack--bloques gestor">
      <PageHeader
        actions={
          fase === "lista" ? (
            <>
              <MenuButton
                actions={[
                  { id: "demo", label: "Ver la cartera de demostración", description: "Activos y precios inventados; no se guarda", onSelect: abrirDemo },
                  { id: "carpeta", label: "Cambiar de carpeta", description: "Elegir otra carpeta de carteras", onSelect: () => void control.elegir() }
                ]}
                align="end"
                label="Más"
              />
              <Button onClick={() => setDialogo("importar")}>Importar extractos</Button>
              <Button onClick={() => setDialogo("nueva")} variant="primary">Nueva cartera</Button>
            </>
          ) : undefined
        }
        description={procedencia}
        eyebrow="Clientes"
        title="Carteras de clientes"
        titleId="gestor-titulo"
      />

      {aviso ? <Aviso anunciar tono="aviso">{aviso}</Aviso> : null}
      {control.error ? <Aviso tono="error">{control.error}</Aviso> : null}

      {fase === "comprobando" ? <LoadingState>Buscando tu carpeta de carteras…</LoadingState> : null}

      {fase === "sin-carpeta" ? (
        <EmptyState
          action={
            <div className="row">
              <Button onClick={() => void control.elegir()} variant="primary">Elegir la carpeta de carteras</Button>
              <Button onClick={abrirDemo} variant="quiet">Probar antes con una cartera de demostración</Button>
            </div>
          }
          description="Elige una carpeta de tu equipo, por ejemplo «Documentos › Carteras». Cada cartera será un fichero dentro de ella, con copias de seguridad automáticas. Solo hay que elegirla una vez."
          title="Empieza por decir dónde guardar tus carteras"
        >
          <ol className="gestor-pasos">
            <li><strong>Elige la carpeta.</strong> El navegador te pedirá permiso para leer y escribir en ella.</li>
            <li><strong>Crea una cartera</strong> a mano o cárgala de los extractos del banco.</li>
            <li><strong>Consulta</strong> cuánto vale, cuánto ha ganado y en qué está invertida, y descarga sus informes.</li>
          </ol>
        </EmptyState>
      ) : null}

      {fase === "falta-permiso" ? (
        <EmptyState
          action={
            <div className="row">
              <Button onClick={() => void control.reanudar()} variant="primary">Abrir mi carpeta de carteras</Button>
              <Button onClick={() => void control.elegir()} variant="quiet">Elegir otra carpeta</Button>
            </div>
          }
          description={`Tus carteras están en la carpeta «${control.estado.nombre}». El navegador pide que confirmes el acceso en cada visita: es un clic.`}
          title="Vuelve a abrir tu carpeta"
        />
      ) : null}

      {fase === "sin-acceso" ? (
          <EmptyState
            action={
              <div className="row">
                <Button onClick={() => setDialogo("nueva")} variant="primary">Nueva cartera</Button>
                <Button onClick={() => selectorDeFichero.current?.click()}>Abrir un fichero de cartera</Button>
                <Button onClick={abrirDemo} variant="quiet">Cartera de demostración</Button>
              </div>
            }
            description="Este navegador no permite guardar en una carpeta del equipo. Puedes trabajar igual: abre un fichero de cartera o crea una nueva, y descárgala al terminar. Para que se guarde sola y con copias de seguridad, usa Chrome o Edge."
            title="Trabaja con ficheros de cartera"
          >
            <input accept=".json,.cartera.json,application/json" className="gestor-oculto" onChange={(evento) => void abrirDeUnFichero(evento.target.files?.[0])} ref={selectorDeFichero} type="file" />
          </EmptyState>
      ) : null}

      {fase === "lista" ? (
        <ListaDeCarteras
          alAbrir={(fichero) => void abrirDeLaCarpeta(fichero)}
          alAbrirDemo={abrirDemo}
          alCambiarDeCarpeta={() => void control.elegir()}
          alCrear={() => setDialogo("nueva")}
          alImportar={() => setDialogo("importar")}
          almacen={control.estado.almacen}
          key={lecturaDeLaLista}
        />
      ) : null}
      {fase === "lista" ? <CarterasRetiradas alRecuperar={() => setLecturaDeLaLista((n) => n + 1)} almacen={control.estado.almacen} /> : null}

      {dialogo === "nueva" ? <DialogoDeNuevaCartera alCerrar={() => setDialogo(null)} alCrear={(cartera) => void crear(cartera)} titulo="Nueva cartera" /> : null}
      {dialogo === "importar" ? <DialogoDeNuevaCartera alCerrar={() => setDialogo(null)} alCrear={(cartera) => void crear(cartera, "importar")} titulo="Nueva cartera a partir de los extractos" /> : null}
    </section>
  );
}
