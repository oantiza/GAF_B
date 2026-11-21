import { useEffect, useMemo, useState, type ReactNode } from "react";
import { getAssetDataSource } from "../adapters/assetDataSource";
import { AsyncErrorBanner } from "../components/AsyncErrorBanner";
import { DialogoDelInformeDeJubilacion } from "../components/jubilacion/DialogoDelInformeDeJubilacion";
import { FormularioDeJubilacion } from "../components/jubilacion/FormularioDeJubilacion";
import { CuentasDeJubilacion, RespuestaDeJubilacion } from "../components/jubilacion/ResultadoDeJubilacion";
import { EmptyState } from "../components/ui/AsyncState";
import { Aviso } from "../components/ui/Aviso";
import { Button } from "../components/ui/Button";
import { Distintivo } from "../components/ui/Distintivo";
import { PageHeader } from "../components/ui/PageHeader";
import { useConfirm } from "../components/ui/useConfirm";
import * as formato from "../core/formato";
import { EJERCICIO, ejercicioVencido } from "../core/jubilacion/fiscal";
import { compararFormasDeCobro, lecturaDeLaSupervivencia, type Unidades } from "../core/jubilacion/lectura";
import { calcular } from "../core/jubilacion/motor";
import {
  datosDeEjemplo,
  datosVacios,
  entradaDelMotor,
  quedaAlgoDelEjemplo,
  saldosDeLaCartera,
  sinDatosDelCliente,
  type DatosDeJubilacion
} from "../core/jubilacion/simulacion";
import { createSessionSlot } from "../core/sessionCaches";
import type { AssetDataSourceKind } from "../types/assetDataSource";
import type { BdbManualPortfolioPosition } from "../types/bdbAssets";
import "../styles/jubilacion.css";

/**
 * Jubilación: con qué ingreso neto contará el cliente, qué IRPF pagará cada año según su residencia fiscal y
 * hasta cuándo le llega el patrimonio.
 *
 * **La pregunta que contesta.** La que hace un cliente que se acerca a la jubilación o ya está en ella: «¿cuánto
 * me queda al mes, y me dura?». El asesor la usa delante de él para decidir tres cosas: a qué ritmo retirar, cómo
 * cobrar la EPSV o el plan de pensiones —en renta, de una vez o parte de cada forma— y qué margen deja el plan
 * si el patrimonio rinde menos de lo supuesto.
 *
 * **De dónde viene.** Es el simulador de jubilación de NUVIA, traído el 13-11-2026 con su motor y sus reglas
 * fiscales (`src/core/jubilacion/`) y rehecho para esta casa: habla del cliente y no de tú, lo enseña todo a la
 * vista en vez de en cuatro pasos, abre vacío, parte si se quiere de la propuesta en curso y entrega su informe en
 * el papel de cliente.
 *
 * **Cómo se lee** (rediseño del 14-11-2026, `docs/frontend/SISTEMA_DISENO.md`): la cabecera con su acción principal
 * —el informe—; la mesa de dos columnas, con los datos a la izquierda y la respuesta a la derecha, una sola cifra en
 * `--cifra-xl` junto a la frase que dice que es una simulación; y debajo, a la vista, las cuentas, con el método y
 * las fuentes plegados.
 *
 * **Lo que no hace.** No guarda nada: lo escrito vive en memoria, como lo demás que es de un cliente, y muere con
 * la sesión. No recomienda una forma de cobro: las compara. Y no proyecta con la rentabilidad histórica de la
 * cartera: la rentabilidad es una hipótesis que escribe el asesor, y por eso va siempre con sus escenarios.
 */

/** Lo escrito sobrevive a ir a otra pantalla, y nunca a la sesión. */
const jubilacionEnSesion = createSessionSlot(() => ({ datos: datosVacios(), unidades: "hoy" as Unidades }));

/** Un peso que llega en puntos (60 es un 60 %): sin decimales si es entero, con uno si no. */
const porcentaje = (puntos: number) => formato.porcentaje(puntos / 100, { decimales: Number.isInteger(puntos) ? 0 : 1 }) ?? "";
/** Un importe entero: «120.000 €». */
const euros = (valor: number) => formato.importeTitular(valor) ?? "";

export function JubilacionPage({
  positions,
  portfolioName,
  totalCapital,
  sourceKind
}: {
  /** La propuesta en curso, de la que pueden salir los saldos de fondos y acciones. */
  positions: BdbManualPortfolioPosition[];
  portfolioName: string;
  totalCapital: number | undefined;
  sourceKind: AssetDataSourceKind;
}) {
  const [enSesion] = useState(() => jubilacionEnSesion.read());
  const [datos, setDatos] = useState<DatosDeJubilacion>(enSesion.datos);
  const [unidades, setUnidades] = useState<Unidades>(enSesion.unidades);
  useEffect(() => {
    jubilacionEnSesion.write({ datos, unidades });
  }, [datos, unidades]);

  const [informe, setInforme] = useState(false);
  const [tomando, setTomando] = useState(false);
  const [deLaCartera, setDeLaCartera] = useState<{ error: unknown } | { texto: string } | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const { entrada, falta, supuestos } = useMemo(() => entradaDelMotor(datos), [datos]);
  const resultado = useMemo(() => (entrada ? calcular(entrada) : null), [entrada]);
  const formas = useMemo(() => (entrada && resultado?.disponible ? compararFormasDeCobro(entrada) : null), [entrada, resultado]);
  const esEjemplo = quedaAlgoDelEjemplo(datos);
  const vacio = sinDatosDelCliente(datos);

  const cambiar = (siguiente: DatosDeJubilacion) => {
    setDatos(siguiente);
    /* Lo que se dijo al traer los saldos de la cartera deja de ser cierto en cuanto se toca un saldo. */
    if (siguiente.fondos !== datos.fondos || siguiente.acciones !== datos.acciones) setDeLaCartera(null);
  };

  const vaciar = async () => {
    const seguro = await confirm({
      title: "¿Vaciar la simulación?",
      message: "Se borra todo lo escrito del cliente. La residencia fiscal se conserva.",
      confirmLabel: "Vaciar",
      tone: "danger"
    });
    if (!seguro) return;
    setDatos({ ...datosVacios(), territorio: datos.territorio, ccaa: datos.ccaa });
    setDeLaCartera(null);
  };

  const tomarDeLaCartera = async () => {
    if (totalCapital === undefined || positions.length === 0) return;
    /* Lo escrito solo vive en memoria: lo que se pise no se recupera. Si hay algo, se pregunta antes (PLA-05). */
    const escrito = [
      datos.fondos !== null ? `fondos de inversión, ${euros(datos.fondos)}` : "",
      datos.fondosCoste !== null ? `lo aportado a los fondos, ${euros(datos.fondosCoste)}` : "",
      datos.acciones !== null ? `acciones y ETF, ${euros(datos.acciones)}` : "",
      datos.accionesCoste !== null ? `lo pagado por las acciones y ETF, ${euros(datos.accionesCoste)}` : ""
    ].filter(Boolean);
    if (escrito.length > 0) {
      const seguro = await confirm({
        title: "¿Sustituir lo escrito por los saldos de la propuesta?",
        message: `Se sustituye lo que hay escrito (${escrito.join("; ")}) por los saldos de ${portfolioName ? `«${portfolioName}»` : "la propuesta en curso"}, y el coste de adquisición queda sin escribir. Lo escrito no se guarda en ningún sitio: no se podrá recuperar.`,
        confirmLabel: "Sustituir",
        tone: "danger"
      });
      if (!seguro) return;
    }
    setTomando(true);
    setDeLaCartera(null);
    try {
      const activos = await getAssetDataSource(sourceKind).getComparableAssets(positions.map((posicion) => posicion.asset_id));
      const saldos = saldosDeLaCartera(positions, activos, totalCapital);
      const fondos = Math.round(saldos.fondos);
      const acciones = Math.round(saldos.acciones);
      /* El coste no viene con una cartera modelo: se queda sin escribir, y el aviso lo dice. */
      setDatos((actual) => ({ ...actual, fondos: fondos > 0 ? fondos : null, fondosCoste: null, acciones: acciones > 0 ? acciones : null, accionesCoste: null }));
      const partes = [
        `De ${portfolioName ? `«${portfolioName}»` : "la propuesta en curso"} (${euros(totalCapital)}): ${euros(fondos)} en fondos de inversión y ${euros(acciones)} en acciones y ETF.`,
        saldos.pesoSinClasificar > 0.05 ? `El ${porcentaje(saldos.pesoSinClasificar)} de la cartera no se ha podido clasificar y no se ha traído.` : "",
        Math.abs(saldos.pesoTotal - 100) > 0.05 ? `Sus pesos suman ${porcentaje(saldos.pesoTotal)}: ${saldos.pesoTotal < 100 ? "el resto del capital no se reparte" : "se reparte más que su capital"}.` : "",
        "El coste de adquisición no viene con la propuesta: hay que escribirlo."
      ];
      setDeLaCartera({ texto: partes.filter(Boolean).join(" ") });
    } catch (error) {
      setDeLaCartera({ error });
    } finally {
      setTomando(false);
    }
  };

  let avisoDeLaCartera: ReactNode = null;
  if (deLaCartera && "error" in deLaCartera) avisoDeLaCartera = <AsyncErrorBanner error={deLaCartera.error} onRetry={() => void tomarDeLaCartera()} />;
  else if (deLaCartera) {
    avisoDeLaCartera = (
      <Aviso anunciar tono="nota">
        {deLaCartera.texto}
      </Aviso>
    );
  }

  const calculado = resultado?.disponible ? resultado : null;
  const avisos = calculado ? [...supuestos, ...calculado.avisos] : [];
  /* Una sola lectura para la pantalla y para el informe: lo que el asesor ve y lo que entrega dicen lo mismo. */
  const supervivencia = calculado ? lecturaDeLaSupervivencia(calculado, datos.sexo) : null;

  return (
    <div>
      <PageHeader
        actions={
          <>
            {/* Las dos secundarias, siempre a la vista: cada una dice, desactivada, por qué no se puede (PLA-24). Cargar
                el ejemplo sigue pidiendo una simulación vacía, como antes: no pisa en silencio lo escrito del cliente. */}
            <Button
              disabled={!vacio}
              onClick={() => setDatos(datosDeEjemplo({ territorio: datos.territorio, ccaa: datos.ccaa }))}
              title={vacio ? undefined : "Hay datos escritos: vacía la simulación para cargar un ejemplo."}
              variant="secondary"
            >
              Cargar un ejemplo
            </Button>
            <Button disabled={vacio} onClick={() => void vaciar()} title={vacio ? "No hay nada escrito que vaciar." : undefined} variant="secondary">
              Vaciar
            </Button>
            <Button
              disabled={!calculado}
              onClick={() => setInforme(true)}
              /* Desactivado, dice por qué (PLA-24). */
              title={calculado ? undefined : "Faltan datos del cliente: sin un resultado no hay informe que pedir."}
              variant="primary"
            >
              Informe para el cliente
            </Button>
          </>
        }
        description="El ingreso neto del cliente en su jubilación, el IRPF de cada año según su residencia fiscal y hasta cuándo le llega el patrimonio."
        estado={esEjemplo ? <Distintivo tono="aviso">Ejemplo</Distintivo> : undefined}
        eyebrow="Planificación"
        title="Jubilación"
      />

      {esEjemplo ? (
        <Aviso anunciar titulo="Ejemplo.">
          {datos.ejemplo === "dfb"
            ? "Caso práctico de EPSV que publica la Hacienda Foral de Bizkaia para 2026: 100.000 € de derechos cobrados de una vez. No es de ningún cliente."
            : "Cifras inventadas para enseñar la pantalla: no son de ningún cliente."}
        </Aviso>
      ) : null}
      {ejercicioVencido() ? (
        <Aviso titulo={`Normativa de ${EJERCICIO}.`}>
          Las reglas del IRPF de este simulador son las del ejercicio {EJERCICIO} y no se han revisado para el año en curso: sus cifras pueden no corresponder a la norma vigente.
        </Aviso>
      ) : null}

      <div className="jubilacion-mesa">
        <FormularioDeJubilacion
          alCambiar={cambiar}
          alTomarDeLaCartera={() => void tomarDeLaCartera()}
          avisoDeLaCartera={avisoDeLaCartera}
          cartera={positions.length > 0 ? { nombre: portfolioName, posiciones: positions.length, capital: totalCapital } : null}
          datos={datos}
          resultado={resultado}
          tomandoDeLaCartera={tomando}
        />

        {calculado ? (
          <div className="jubilacion-resultado">
            {/* Lo que se ha supuesto y lo que el motor avisa: no se anuncia cada uno, lo que se anuncia es la cifra (PLA-20). */}
            {avisos.map((aviso) => (
              <Aviso key={aviso}>{aviso}</Aviso>
            ))}
            <RespuestaDeJubilacion alCambiarUnidades={setUnidades} formas={formas} resultado={calculado} supervivencia={supervivencia} unidades={unidades} />
          </div>
        ) : (
          <div className="jubilacion-resultado">
            {resultado && !resultado.disponible ? (
              <Aviso anunciar titulo={resultado.estado === "en-preparacion" ? "En preparación." : "Residencia fiscal sin determinar."}>
                {resultado.mensaje}
              </Aviso>
            ) : (
              <EmptyState
                description={
                  vacio
                    ? "Con su edad, su pensión y sus ahorros se calcula el ingreso neto de cada año, el IRPF y hasta cuándo le llega el patrimonio. «Cargar un ejemplo» enseña la pantalla con cifras inventadas."
                    : "En cuanto esté, el resultado aparece aquí y cambia con cada dato."
                }
                title={vacio ? "Escribe los datos del cliente" : (falta ?? "Faltan datos del cliente")}
              />
            )}
          </div>
        )}
      </div>

      {/* Las cuentas —el detalle fiscal, la tabla de cada año, el método— van debajo, a todo el ancho y bajo su rótulo. */}
      {calculado ? <CuentasDeJubilacion resultado={calculado} unidades={unidades} /> : null}

      {informe && calculado ? <DialogoDelInformeDeJubilacion ejemplo={esEjemplo} formas={formas} onClose={() => setInforme(false)} resultado={calculado} supervivencia={supervivencia} supuestos={supuestos} unidades={unidades} /> : null}
      {confirmDialog}
    </div>
  );
}
