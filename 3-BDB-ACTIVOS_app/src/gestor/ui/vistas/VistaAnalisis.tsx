/**
 * El análisis de una cartera de cliente: el detalle a un clic del Resumen, repartido en cuatro
 * vistas que se eligen bajo las pestañas (y van en la dirección, `#…&vista=composicion`):
 *
 *   - Rentabilidad: cuánto ha rendido, frente a qué, con cuánto riesgo y mes a mes.
 *   - Composición: en qué está, qué ha aportado cada posición, qué se vendió y los bonos.
 *   - Ingresos y costes: qué ha cobrado y qué ha pagado.
 *   - Comprobaciones: lo que hay que revisar, y si la cartera cuadra con el banco.
 *
 * No calcula nada: cada bloque lee el `Analisis` del periodo elegido. Un bloque que no
 * procede no sale; ninguno deja un título sin contenido.
 */
import { EmptyState } from "../../../components/ui/AsyncState";
import { Button } from "../../../components/ui/Button";
import { SegmentedControl } from "../../../components/ui/SegmentedControl";
import { usePestanaEnLaDireccion } from "../../../core/usePestanaEnLaDireccion";
import { BloqueBonos } from "../analisis/BloqueBonos";
import { BloqueCerradas } from "../analisis/BloqueCerradas";
import { BloqueComposicion } from "../analisis/BloqueComposicion";
import { BloqueComprobaciones } from "../analisis/BloqueComprobaciones";
import { BloqueContribucion } from "../analisis/BloqueContribucion";
import { BloqueIngresosYCostes } from "../analisis/BloqueIngresosYCostes";
import { BloqueMeses } from "../analisis/BloqueMeses";
import { BloqueReferencia } from "../analisis/BloqueReferencia";
import { BloqueRentabilidad } from "../analisis/BloqueRentabilidad";
import { BloqueRiesgo } from "../analisis/BloqueRiesgo";
import { CLAVE_DE_LA_VISTA, VISTAS_DEL_ANALISIS, type VistaDelAnalisis } from "../direccion";
import type { DatosDeVista } from "../tipos";
import "../../../styles/gestor-analisis.css";

const OPCIONES: ReadonlyArray<{ id: VistaDelAnalisis; label: string }> = [
  { id: "rentabilidad", label: "Rentabilidad" },
  { id: "composicion", label: "Composición" },
  { id: "ingresos", label: "Ingresos y costes" },
  { id: "comprobaciones", label: "Comprobaciones" }
];

export function VistaAnalisis({ datos }: { datos: DatosDeVista }) {
  const { analisis, abierta } = datos;
  const { cartera } = abierta;
  const [vista, elegirVista] = usePestanaEnLaDireccion<VistaDelAnalisis>(VISTAS_DEL_ANALISIS, "rentabilidad", CLAVE_DE_LA_VISTA);

  if (cartera.movimientos.length === 0 || analisis.vacia) {
    return (
      <EmptyState
        action={
          <div className="row">
            <Button onClick={() => datos.nuevoMovimiento({ tipo: "aportacion" })} variant="primary">Añadir el primer movimiento</Button>
          </div>
        }
        description="El análisis necesita movimientos: la aportación inicial y las primeras compras, o los extractos del banco cargados con «Importar extractos». Con ellos verás aquí la rentabilidad, el riesgo, la rentabilidad de cada mes, de dónde viene el resultado y si la cartera cuadra con el banco."
        title="Aún no hay nada que analizar"
      />
    );
  }

  return (
    <div className="stack stack--bloques">
      <SegmentedControl label="Qué parte del análisis" onChange={elegirVista} options={OPCIONES} value={vista} />

      {vista === "rentabilidad" ? (
        <>
          <BloqueRentabilidad analisis={analisis} />
          {analisis.rentabilidad || analisis.riesgo ? (
            <div className="gestor-rejilla">
              <div className="gestor-rejilla__ancha">
                <BloqueReferencia abierta={abierta} analisis={analisis} cargando={datos.mercado.cargando} />
              </div>
              <div className="gestor-rejilla__estrecha">
                <BloqueRiesgo analisis={analisis} />
              </div>
            </div>
          ) : null}
          <BloqueMeses analisis={analisis} />
        </>
      ) : null}

      {vista === "composicion" ? (
        <>
          <BloqueComposicion analisis={analisis} />
          <BloqueContribucion activos={cartera.activos} analisis={analisis} />
          <BloqueCerradas analisis={analisis} />
          <BloqueBonos analisis={analisis} />
        </>
      ) : null}

      {vista === "ingresos" ? <BloqueIngresosYCostes analisis={analisis} /> : null}

      {vista === "comprobaciones" ? <BloqueComprobaciones analisis={analisis} avisosDeMercado={datos.mercado.mercado.avisos} /> : null}
    </div>
  );
}
