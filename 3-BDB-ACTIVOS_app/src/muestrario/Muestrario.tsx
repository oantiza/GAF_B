import { useState } from "react";
import { AsyncErrorBanner } from "../components/AsyncErrorBanner";
import { TablaDeDatos } from "../components/tabla/TablaDeDatos";
import { EmptyState, LoadingState } from "../components/ui/AsyncState";
import { Ausencia } from "../components/ui/Ausencia";
import { Aviso } from "../components/ui/Aviso";
import { Button } from "../components/ui/Button";
import { Campo } from "../components/ui/Campo";
import { Cifra, type TipoDeCifra } from "../components/ui/Cifra";
import { Distintivo } from "../components/ui/Distintivo";
import { Esqueleto } from "../components/ui/Esqueleto";
import { EuroAmountInput } from "../components/ui/EuroAmountInput";
import { KpiStrip } from "../components/ui/KpiStrip";
import { ListaDePartes } from "../components/ui/ListaDePartes";
import { Mensajes } from "../components/ui/MensajeEfimero";
import { NotaEmergente } from "../components/ui/NotaEmergente";
import { PageHeader } from "../components/ui/PageHeader";
import { Panel } from "../components/ui/Panel";
import { Respuesta } from "../components/ui/Respuesta";
import { PanelDePestana, SegmentedTabs } from "../components/ui/SegmentedTabs";
import { useConfirm } from "../components/ui/useConfirm";
import { useMensaje } from "../components/ui/useMensaje";
import { usePestanaEnLaDireccion } from "../core/usePestanaEnLaDireccion";
import type { ClaseDeAusencia } from "../types/fichaInstrumento";
import type { ColumnaDeTabla } from "../types/tablaDeDatos";

/** Cada caso de la tabla de cifras: qué se pide y lo que debe salir, para revisarlo de un vistazo. */
interface CasoDeCifra {
  id: string;
  tipo: TipoDeCifra;
  valor: number | null;
  nota: string;
  divisa?: string;
  conSigno?: boolean;
  colorDeSigno?: boolean;
  ausencia?: ClaseDeAusencia;
}

const CASOS_DE_CIFRA: CasoDeCifra[] = [
  { id: "1", tipo: "importe", valor: 1234.56, nota: "Importe en tabla o detalle" },
  { id: "2", tipo: "importe", valor: 1234.5, divisa: "USD", nota: "En otra divisa" },
  { id: "3", tipo: "importe", valor: 18582, conSigno: true, colorDeSigno: true, nota: "Resultado: con signo y color, pedidos" },
  { id: "4", tipo: "importe", valor: -2500, nota: "Un movimiento: sin color" },
  { id: "5", tipo: "importeTitular", valor: 201298.4, nota: "Cifra titular" },
  { id: "6", tipo: "importeGrande", valor: 2304300000, nota: "En millones" },
  { id: "7", tipo: "rentabilidad", valor: 0.1039, nota: "Con signo y color, siempre" },
  { id: "8", tipo: "rentabilidad", valor: -0.0472, nota: "Negativa" },
  { id: "9", tipo: "rentabilidad", valor: 0.00004, nota: "Redondea a cero: sin signo ni color" },
  { id: "10", tipo: "porcentaje", valor: 0.078, nota: "Volatilidad: sin color" },
  { id: "11", tipo: "porcentaje", valor: -0.114, nota: "Caída máxima: sin color" },
  { id: "12", tipo: "peso", valor: 0.24, nota: "Un decimal" },
  { id: "13", tipo: "puntos", valor: 0.0125, nota: "Diferencia con la referencia" },
  { id: "14", tipo: "ratio", valor: 1.18, nota: "Sharpe" },
  { id: "15", tipo: "precio", valor: 535.02, nota: "Valor liquidativo" },
  { id: "16", tipo: "titulos", valor: 17.6642, nota: "Participaciones" },
  { id: "17", tipo: "numero", valor: 1334, nota: "Un recuento" },
  { id: "18", tipo: "rentabilidad", valor: null, nota: "Falta el dato (por defecto)" },
  { id: "19", tipo: "porcentaje", valor: null, ausencia: "no-aplica", nota: "No aplica" },
  { id: "20", tipo: "porcentaje", valor: null, ausencia: "sin-pedir", nota: "Sin pedir" }
];

const COLUMNAS_DE_CIFRAS: ColumnaDeTabla<CasoDeCifra>[] = [
  { id: "tipo", titulo: "Tipo", sinOrden: true, celda: (caso) => ({ texto: caso.tipo }) },
  { id: "nota", titulo: "Caso", sinOrden: true, celda: (caso) => ({ texto: caso.nota }) },
  {
    id: "cifra",
    titulo: "Cifra",
    cifra: true,
    sinOrden: true,
    celda: (caso) => ({
      texto: "",
      nodo: <Cifra ausencia={caso.ausencia} colorDeSigno={caso.colorDeSigno} conSigno={caso.conSigno} divisa={caso.divisa} tipo={caso.tipo} valor={caso.valor} />
    })
  }
];

/** Sesenta posiciones de ejemplo para la tabla paginada. */
interface PosicionDeEjemplo {
  id: string;
  nombre: string;
  peso: number;
  rentabilidad: number | null;
}

const POSICIONES: PosicionDeEjemplo[] = Array.from({ length: 60 }, (_, indice) => ({
  id: `p${indice + 1}`,
  nombre: `Fondo de ejemplo ${indice + 1}`,
  peso: ((indice * 7) % 23) / 100 + 0.005,
  rentabilidad: indice % 9 === 4 ? null : (((indice * 13) % 41) - 15) / 100
}));

const COLUMNAS_DE_POSICIONES: ColumnaDeTabla<PosicionDeEjemplo>[] = [
  { id: "nombre", titulo: "Activo", encabezaFila: true, celda: (fila) => ({ texto: fila.nombre }) },
  { id: "peso", titulo: "Peso", cifra: true, celda: (fila) => ({ texto: "", nodo: <Cifra tipo="peso" valor={fila.peso} />, valor: fila.peso }) },
  {
    id: "rentabilidad",
    titulo: "Rentabilidad 1 año",
    cifra: true,
    celda: (fila) =>
      fila.rentabilidad === null
        ? { texto: "Falta el dato", ausencia: "falta" }
        : { texto: "", nodo: <Cifra tipo="rentabilidad" valor={fila.rentabilidad} />, valor: fila.rentabilidad }
  }
];

const PESTANAS = [
  { id: "resumen", label: "Resumen" },
  { id: "exposicion", label: "Exposición" },
  { id: "datos", label: "Datos" }
] as const;
type Pestana = (typeof PESTANAS)[number]["id"];
const IDS_DE_PESTANA = PESTANAS.map((p) => p.id);

export function Muestrario() {
  const { decir } = useMensaje();
  const { confirm, confirmDialog } = useConfirm();
  const [pestana, setPestana] = usePestanaEnLaDireccion<Pestana>(IDS_DE_PESTANA, "resumen");
  const [capital, setCapital] = useState<number | null>(100000);
  const [trabajando, setTrabajando] = useState(false);

  const trabajar = () => {
    setTrabajando(true);
    window.setTimeout(() => {
      setTrabajando(false);
      decir("Hecho");
    }, 2000);
  };

  return (
    <>
    <main className="app-content">
      <PageHeader
        description="Cada pieza común en todos sus estados, con datos de ejemplo. Solo para desarrollo: no forma parte de la aplicación."
        eyebrow="Sistema de diseño · paso 2"
        title="Muestrario de piezas"
      />

      <div className="stack stack--bloques">
        <Panel subtitulo="src/components/ui/Respuesta.tsx · de tres a seis cifras; una principal" titulo="Respuesta">
          <div className="stack">
            <Respuesta
              datos={[
                { rotulo: "Rentabilidad anualizada", cifra: <Cifra tipo="rentabilidad" valor={0.119} />, apunte: "la referencia, +9,15 %" },
                { rotulo: "Volatilidad", cifra: <Cifra tipo="porcentaje" valor={0.078} />, apunte: "la referencia, 8,40 %" },
                {
                  rotulo: (
                    <>
                      Ratio de Sharpe <NotaEmergente termino="el ratio de Sharpe">La rentabilidad por encima del tipo sin riesgo, por cada punto de volatilidad.</NotaEmergente>
                    </>
                  ),
                  cifra: <Cifra tipo="ratio" valor={1.18} />,
                  apunte: "tipo sin riesgo, 2,60 %"
                },
                { rotulo: "Caída máxima", cifra: <Cifra tipo="porcentaje" valor={-0.114} />, apunte: "de mar a oct de 2025" },
                { rotulo: "Coste corriente de la cartera", cifra: <Cifra tipo="porcentaje" valor={0.0092} />, apunte: "920 € al año sobre 100.000 €" }
              ]}
              etiqueta="Rentabilidad y riesgo de la cartera"
            />
            <Respuesta
              datos={[
                { rotulo: "Patrimonio", cifra: <Cifra tipo="importeTitular" valor={201298} />, apunte: "a 13/11/2026 · 170.678 € en valores y 30.620 € en efectivo", principal: true },
                { rotulo: "Resultado del periodo", cifra: <Cifra colorDeSigno conSigno tipo="importeTitular" valor={18582} />, apunte: "del 31/12/2025 al 13/11/2026" },
                { rotulo: "Rentabilidad de la cartera", cifra: <Cifra tipo="rentabilidad" valor={-0.0472} />, apunte: "su referencia, +13,88 %" },
                { rotulo: "Coste corriente", cifra: <Cifra tipo="porcentaje" valor={null} />, apunte: "sin el KID de dos fondos" }
              ]}
              etiqueta="Cuánto vale y cuánto ha ganado"
            />
            <p className="field__hint">Para comparar: la tira de hoy, «KpiStrip», con la cifra a 28 px (antes 26).</p>
            <KpiStrip
              ariaLabel="La tira de cifras de hoy"
              items={[
                { label: "Rentabilidad", value: "+11,90 %", note: "la referencia, +9,15 %" },
                { label: "Volatilidad", value: "7,80 %" },
                { label: "Coste", value: "No aplica" }
              ]}
            />
          </div>
        </Panel>

        <Panel subtitulo="src/components/ui/Cifra.tsx · formato, color y ausencia en un solo sitio" titulo="Cifra">
          <TablaDeDatos columnas={COLUMNAS_DE_CIFRAS} filas={CASOS_DE_CIFRA} titulo="Casos de la pieza Cifra" />
        </Panel>

        <Panel subtitulo="src/components/ui/Aviso.tsx · aviso, nota y error; con acción" titulo="Aviso">
          <div className="stack stack--tight">
            <Aviso titulo="Una posición sin medir.">
              Vanguard S&amp;P 500 UCITS ETF (12,0 %) queda fuera de la simulación por la calidad de su serie de precios. Las cifras describen el 88,0 % restante.
            </Aviso>
            <Aviso titulo="Riesgo concentrado." tono="aviso">
              iShares Core MSCI World pesa el 24,0 % y aporta el 44,5 % del riesgo de la cartera.
            </Aviso>
            <Aviso titulo="Diversificación correcta." tono="nota">
              4 clases de activo y 8 posiciones; ninguna supera el 25 %.
            </Aviso>
            <Aviso
              accion={
                <Button onClick={() => decir("Reintentado")} size="sm">
                  Reintentar
                </Button>
              }
              titulo="No se pudo cargar la serie."
              tono="error"
            >
              El servidor no ha respondido a tiempo.
            </Aviso>
            <Aviso tono="nota">Un aviso sin título: el lector de pantalla oye «Nota.» delante.</Aviso>
            <AsyncErrorBanner error={new Error("Series no disponibles.")} onRetry={() => decir("Reintentado")} />
          </div>
        </Panel>

        <div className="grid">
          <div className="col-6">
            <Panel subtitulo="src/components/ui/Distintivo.tsx" titulo="Distintivo">
              <div className="row">
                <Distintivo>Acumulación</Distintivo>
                <Distintivo tono="marca">Se puede proponer</Distintivo>
                <Distintivo tono="interno">Interno</Distintivo>
                <Distintivo tono="aviso">Datos parciales</Distintivo>
              </div>
            </Panel>
          </div>
          <div className="col-6">
            <Panel subtitulo="src/components/ui/Ausencia.tsx" titulo="Ausencia">
              <div className="row">
                <Ausencia clase="falta" />
                <Ausencia clase="no-aplica" />
                <Ausencia clase="sin-pedir" />
                <Ausencia clase="falta" estrecha />
              </div>
            </Panel>
          </div>
        </div>

        <div className="grid">
          <div className="col-6">
            <Panel subtitulo="src/components/ui/ListaDePartes.tsx · Por clase de activo · pesos de hoy" titulo="Lista de partes">
              <ListaDePartes
                etiqueta="Por clase de activo"
                partes={[
                  { nombre: "Renta variable", fraccion: 0.54 },
                  { nombre: "Renta fija", fraccion: 0.3, apunte: "Gobiernos y empresas" },
                  { nombre: "Mixto", fraccion: 0.09 },
                  { nombre: "Sin clasificar", fraccion: null },
                  { nombre: "Otros", fraccion: 0.07, apagada: true }
                ]}
              />
            </Panel>
          </div>
          <div className="col-6">
            <Panel subtitulo="src/components/ui/NotaEmergente.tsx · clic, Intro o Espacio; Escape o salir la cierran" titulo="Nota emergente">
              <p>
                Riesgo (SRI){" "}
                <NotaEmergente termino="el SRI">
                  El indicador resumido de riesgo del documento de datos fundamentales: de 1 (el más bajo) a 7.
                </NotaEmergente>{" "}
                y coste corriente{" "}
                <NotaEmergente termino="el coste corriente">Lo que cuesta el fondo al año, descontado de su valor liquidativo.</NotaEmergente>
              </p>
            </Panel>
          </div>
        </div>

        <Panel subtitulo="src/components/ui/Campo.tsx · rótulo, control, pista y error enlazados" titulo="Campo">
          <div className="grid">
            <div className="col-4">
              <Campo pista="Como aparecerá en el informe" rotulo="Nombre de la propuesta">
                <input defaultValue="Familia García" type="text" />
              </Campo>
            </div>
            <div className="col-4">
              <Campo pista="En euros" rotulo="Capital">
                <EuroAmountInput onCommit={setCapital} value={capital} />
              </Campo>
            </div>
            <div className="col-4">
              <Campo rotulo="Perfil de riesgo">
                <select defaultValue="5">
                  <option value="3">3 · Moderado</option>
                  <option value="5">5 · Equilibrado</option>
                  <option value="6">6 · Dinámico</option>
                </select>
              </Campo>
            </div>
            <div className="col-4">
              <Campo error="El horizonte debe ser mayor que cero años." pista="En años" rotulo="Horizonte">
                <input defaultValue="0" type="text" />
              </Campo>
            </div>
            <div className="col-4">
              <Campo opcional rotulo="Nota para el cliente">
                <textarea defaultValue="" />
              </Campo>
            </div>
            <div className="col-4">
              <Campo rotulo="Fecha de los datos">
                <input defaultValue="2026-11-13" type="date" />
              </Campo>
            </div>
          </div>
        </Panel>

        <Panel subtitulo="src/components/ui/Button.tsx · principal, secundario, discreto y de peligro; tres tamaños" titulo="Botón">
          <div className="stack stack--tight">
            <div className="row">
              <Button variant="primary">Añadir</Button>
              <Button>Comparar</Button>
              <Button variant="quiet">Descargar la ficha</Button>
              <Button variant="danger">Eliminar</Button>
              <Button disabled>Desactivado</Button>
            </div>
            <div className="row">
              <Button size="sm">Pequeño</Button>
              <Button>Normal</Button>
              <Button size="lg" variant="primary">
                Grande
              </Button>
              <Button busy={trabajando} onClick={trabajar} textoAlTrabajar="Calculando…" variant="primary">
                {trabajando ? "Calculando…" : "Trabajar dos segundos"}
              </Button>
              <Button
                onClick={() => void confirm({ title: "¿Eliminar la propuesta?", message: "No se puede deshacer.", confirmLabel: "Eliminar", tone: "danger" })}
                variant="secondary"
              >
                Abrir una confirmación
              </Button>
            </div>
          </div>
          {confirmDialog}
        </Panel>

        <Panel subtitulo="src/components/ui/SegmentedTabs.tsx y src/core/usePestanaEnLaDireccion.ts · la pestaña va en la dirección" titulo="Pestañas">
          <div className="stack stack--tight">
            <SegmentedTabs idPrefix="muestrario" label="Secciones de ejemplo" onChange={setPestana} tabs={PESTANAS} value={pestana} />
            <PanelDePestana idPrefix="muestrario" pestana={pestana}>
              <p>
                Pestaña elegida: <strong>{pestana}</strong>. Mira el final de la dirección y prueba «Atrás».
              </p>
            </PanelDePestana>
          </div>
        </Panel>

        <Panel subtitulo="src/components/tabla/TablaDeDatos.tsx · 25 filas por página y cabecera fija" titulo="Tabla de datos">
          <TablaDeDatos cabeceraFija columnas={COLUMNAS_DE_POSICIONES} filas={POSICIONES} porPagina titulo="Posiciones de ejemplo" />
        </Panel>

        <Panel abiertoAlEmpezar={false} plegable subtitulo="src/components/ui/Panel.tsx · cerrado al empezar" titulo="Panel plegable">
          <p>El cuerpo de un bloque de detalle, que se abre con el título.</p>
        </Panel>

        <Panel
          abiertoAlEmpezar
          acciones={
            <Button size="sm" variant="quiet">
              Ver el detalle
            </Button>
          }
          plegable
          subtitulo="Abierto al empezar, con una acción que queda fuera del botón"
          titulo="Panel plegable abierto"
        >
          <p>Las acciones siguen a la derecha y funcionan con el cuerpo cerrado.</p>
        </Panel>

        <div className="grid">
          <div className="col-6">
            <Panel subtitulo="src/components/ui/Esqueleto.tsx · líneas y bloque; quieto si se reduce el movimiento" titulo="Esqueleto">
              <div className="stack">
                <Esqueleto lineas={3} />
                <Esqueleto alto={120} />
              </div>
            </Panel>
          </div>
          <div className="col-6">
            <Panel subtitulo="src/components/ui/MensajeEfimero.tsx · se va a los cuatro segundos" titulo="Mensaje efímero">
              <div className="row">
                <Button onClick={() => decir("Guardado")}>Guardar</Button>
                <Button onClick={() => decir("Copiado")}>Copiar</Button>
              </div>
            </Panel>
          </div>
        </div>

        <Panel subtitulo="src/components/ui/AsyncState.tsx · carga y vacío, con el nivel del título elegido" titulo="Estados">
          <div className="stack">
            <LoadingState>Cargando las posiciones…</LoadingState>
            <EmptyState
              action={<Button variant="primary">Buscar activos</Button>}
              description="Añade dos activos para compararlos."
              nivel={3}
              title="Sin comparación"
            />
          </div>
        </Panel>
      </div>
    </main>
    {/* Fuera de la página: la región de los mensajes flota sobre todo, como en la aplicación. */}
    <Mensajes />
    </>
  );
}
