import { useState, type FocusEvent, type ReactNode } from "react";
import * as formato from "../../core/formato";
import { leerCifraTecleada } from "../../core/cifraTecleada";
import * as F from "../../core/jubilacion/fiscal";
import { procedenciaFiscal } from "../../core/jubilacion/lectura";
import type { FormaDeCobro, RegimenDelCapital, ResultadoDeJubilacion, TipoDeRenta } from "../../core/jubilacion/motor";
import { cambiarTerritorio, conElCasoDeLaDfb, totalDeAhorros, type DatosDeJubilacion } from "../../core/jubilacion/simulacion";
import { Ausencia } from "../ui/Ausencia";
import { Button } from "../ui/Button";
import { Campo } from "../ui/Campo";
import { EuroAmountInput } from "../ui/EuroAmountInput";
import { Panel } from "../ui/Panel";
import { SegmentedControl } from "../ui/SegmentedControl";

/**
 * Lo que se escribe del cliente, todo a la vista y en este orden: el cliente, sus ahorros, su EPSV o su plan de
 * pensiones, las hipótesis del asesor y, al final, su residencia fiscal, que casi nunca cambia. El simulador de
 * origen lo pedía en cuatro pasos con «Siguiente»; aquí lo usa un asesor que conoce los datos y necesita verlos
 * juntos para cambiarlos.
 *
 * Cada control va en la pieza `Campo`, que enlaza su rótulo, su pista y su error (MAR-10). No calcula nada: escribe
 * `DatosDeJubilacion` y enseña, junto a cada campo, lo que el motor ha hecho con él.
 */

/** Un porcentaje de los parámetros fiscales, sin decimales: «un 25 %». */
const pctEntero = (fraccion: number): string => formato.porcentaje(fraccion, { decimales: 0 }) ?? "";
/** Un importe entero: «1.817 €». */
const euros = (valor: number): string => formato.importeTitular(valor) ?? "";

/** Cuando el control no es un campo sino un grupo de botones: el rótulo no puede ser un `<label>`, y el grupo ya se nombra. */
function Eleccion({ etiqueta, ayuda, children }: { etiqueta: string; ayuda?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <span className="field__label">{etiqueta}</span>
      {children}
      {ayuda ? <span className="field__hint">{ayuda}</span> : null}
    </div>
  );
}

/**
 * Un número que no es un importe: una edad, unos años, un porcentaje. Vacío es «sin escribir». Fuera de rango no
 * se corrige al teclear —se estaría peleando con quien escribe «6» para poner «65»—: el motor lo acota y aquí se
 * dice con qué valor calcula.
 *
 * Es un campo de texto y no `type="number"` (PLA-06): con la coma decimal, según el idioma del navegador, el número
 * llegaba vacío y el campo volvía en silencio al valor anterior; y la rueda del ratón lo cambiaba. Se lee con la
 * convención española («2,5»), y lo que no se lee se dice junto al campo con el valor con que se sigue calculando.
 */
function CampoNumerico({
  etiqueta,
  valor,
  alCambiar,
  min,
  max,
  decimales = false,
  ayuda,
  obligatorio = false
}: {
  etiqueta: string;
  valor: number | null;
  alCambiar: (valor: number | null) => void;
  min: number;
  max: number;
  /** Admite decimales (una rentabilidad, una inflación). Sin él es un entero: una edad o unos años no se redondean en silencio. */
  decimales?: boolean;
  ayuda?: ReactNode;
  /** Sin él no se calcula: vacío no vuelve a un valor por defecto. */
  obligatorio?: boolean;
}) {
  const escrito = (numero: number | null) => (numero === null ? "" : String(numero).replace(".", ","));
  /** Lo tecleado: `null` si está vacío, `NaN` si no es una cifra o tiene decimales donde no caben. */
  const leer = (crudo: string): number | null => {
    if (crudo.trim() === "") return null;
    /* FMT-20: el lector único de la cifra tecleada (`cifraTecleada.ts`). */
    const numero = leerCifraTecleada(crudo);
    return numero !== undefined && (decimales || Number.isInteger(numero)) ? numero : Number.NaN;
  };
  const [texto, setTexto] = useState(() => escrito(valor));
  /* Si el valor cambia desde fuera —un ejemplo, vaciar—, el campo lo sigue. Mientras se teclea, no se pisa. */
  const [visto, setVisto] = useState(valor);
  if (!Object.is(visto, valor)) {
    setVisto(valor);
    if (!Object.is(leer(texto), valor)) setTexto(escrito(valor));
  }
  const leido = leer(texto);
  const noVale = leido !== null && Number.isNaN(leido);
  const fueraDeRango = !noVale && valor !== null && (valor < min || valor > max);
  const acotado = valor === null ? null : Math.min(max, Math.max(min, valor));
  const error = noVale
    ? `${decimales ? "Cifra no válida: escríbela con números, por ejemplo 2,5." : "Escribe un número entero, sin decimales."}${valor !== null ? ` Se sigue calculando con ${escrito(valor)}.` : ""}`
    : fueraDeRango
      ? `Entre ${escrito(min)} y ${escrito(max)}: se calcula con ${escrito(acotado)}.`
      : undefined;
  return (
    <Campo error={error} pista={ayuda} rotulo={etiqueta}>
      <input
        aria-invalid={noVale || fueraDeRango || undefined}
        className="jubilacion-numero"
        inputMode={decimales ? "decimal" : "numeric"}
        lang="es"
        /* Un campo que no puede quedar vacío vuelve, al salir de él, a lo que tenía. */
        onBlur={() => {
          if (texto.trim() === "" && !obligatorio) setTexto(escrito(valor));
        }}
        onChange={(evento) => {
          const crudo = evento.target.value;
          setTexto(crudo);
          const numero = leer(crudo);
          if (numero === null) {
            if (obligatorio) alCambiar(null);
            return;
          }
          if (!Number.isNaN(numero)) alCambiar(numero);
        }}
        type="text"
        value={texto}
      />
    </Campo>
  );
}

/**
 * Vaciar un importe y salir del campo lo devuelve a «sin escribir» (PLA-04). `EuroAmountInput` conserva la cifra
 * anterior cuando se vacía —es lo que conviene a un capital o una posición—, pero aquí `null` y 0 no significan lo
 * mismo: sin coste de adquisición se supone el valor y se avisa; con coste 0, todo es plusvalía. Se mira al salir,
 * en el contenedor del campo, cuando el campo ya ha confirmado y sigue vacío.
 */
const alSalirVacio =
  (valor: number | null, vaciar: () => void) =>
  (evento: FocusEvent<HTMLElement>): void => {
    const campo = evento.target;
    if (valor !== null && campo instanceof HTMLInputElement && campo.value.trim() === "") vaciar();
  };

function Importe({ etiqueta, valor, alCambiar, ayuda }: { etiqueta: string; valor: number | null; alCambiar: (valor: number | null) => void; ayuda?: ReactNode }) {
  /* La caja solo escucha al salir del campo: `Campo` no lleva `onBlur`, y lo que importa es el campo ya confirmado. */
  return (
    <div onBlur={alSalirVacio(valor, () => alCambiar(null))}>
      <Campo pista={ayuda} rotulo={etiqueta}>
        <EuroAmountInput className="jubilacion-importe" min={0} onCommit={alCambiar} value={valor} />
      </Campo>
    </div>
  );
}

function Casilla({ marcada, alCambiar, titulo, nota }: { marcada: boolean; alCambiar: (marcada: boolean) => void; titulo: string; nota?: string }) {
  return (
    <label className="jubilacion-casilla">
      <input checked={marcada} onChange={(evento) => alCambiar(evento.target.checked)} type="checkbox" />
      <span>
        <strong>{titulo}</strong>
        {nota ? <span className="field__hint">{nota}</span> : null}
      </span>
    </label>
  );
}

const TERRITORIOS_EN_PANTALLA: Record<string, string> = { alava: "Álava / Araba", estatal: "Territorio común" };

const ACTIVOS: ReadonlyArray<{
  valor: "liquidez" | "depositos" | "fondos" | "acciones" | "seguros";
  coste?: "fondosCoste" | "accionesCoste" | "segurosCoste";
  nombre: string;
  elCoste?: string;
}> = [
  { valor: "liquidez", nombre: "Liquidez y cuentas" },
  { valor: "depositos", nombre: "Depósitos y renta fija" },
  { valor: "fondos", coste: "fondosCoste", nombre: "Fondos de inversión", elCoste: "Lo aportado a los fondos de inversión" },
  { valor: "acciones", coste: "accionesCoste", nombre: "Acciones y ETF", elCoste: "Lo pagado por las acciones y ETF" },
  { valor: "seguros", coste: "segurosCoste", nombre: "Seguros de ahorro", elCoste: "Las primas pagadas de los seguros de ahorro" }
];

const CONTINGENCIAS: ReadonlyArray<[string, string]> = [
  ["jubilacion", "Jubilación"],
  ["invalidez", "Invalidez"],
  ["dependencia", "Dependencia"],
  ["enfermedad", "Enfermedad grave"],
  ["desempleo", "Desempleo de larga duración"],
  ["otro", "Otro rescate"]
];

export interface CarteraParaLaSimulacion {
  nombre: string;
  posiciones: number;
  capital: number | undefined;
}

export function FormularioDeJubilacion({
  datos,
  alCambiar,
  resultado,
  cartera,
  alTomarDeLaCartera,
  tomandoDeLaCartera,
  avisoDeLaCartera
}: {
  datos: DatosDeJubilacion;
  alCambiar: (siguiente: DatosDeJubilacion) => void;
  /** El resultado vigente, para decir junto a cada campo lo que el motor ha hecho con él. `null` si no se calcula. */
  resultado: ResultadoDeJubilacion | null;
  /** La propuesta en curso, si la hay: de ella pueden salir los saldos de fondos y acciones. */
  cartera: CarteraParaLaSimulacion | null;
  alTomarDeLaCartera: () => void;
  tomandoDeLaCartera: boolean;
  /** Lo que pasó al tomar los saldos de la propuesta: qué se repartió y qué no. */
  avisoDeLaCartera: ReactNode;
}) {
  const pon = (cambio: Partial<DatosDeJubilacion>) => alCambiar({ ...datos, ...cambio });
  const cfg = F.configuracion(datos.territorio, datos.ccaa);
  const T = F.disponible(cfg) ? F.textos(cfg) : null;
  const pv = cfg?.parametros.prevision ?? null;
  const vasco = pv?.modelo === "vasco";
  const calculado = resultado?.disponible ? resultado : null;
  const o = calculado?.entrada ?? null;
  const edadDelPlan = o?.edadFin ?? datos.edadFin;
  const pensionAnual = datos.pension === null ? null : datos.pension * 14;
  const total = totalDeAhorros(datos);
  const saldoDeLaPrevision = (datos.epsvPre ?? 0) + (datos.epsvPost ?? 0);
  const conReduccion = datos.primerCobro && (datos.dosAnios || (vasco && ["invalidez", "dependencia"].includes(datos.contingencia)));
  const figura = T?.Figura ?? "EPSV o plan de pensiones";
  /* La edad de hoy como la lee el motor: acotada entre 40 y 95 y entera. */
  const edadDeHoy = Math.round(Math.min(95, Math.max(40, datos.edad ?? 40)));

  return (
    <div className="jubilacion-datos">
      <Panel claseDelCuerpo="stack stack--tight" titulo="El cliente">
        <div className="jubilacion-campos">
          <CampoNumerico alCambiar={(edad) => pon({ edad })} etiqueta="Edad actual" max={95} min={40} obligatorio valor={datos.edad} />
          <Eleccion etiqueta="Situación">
            <SegmentedControl
              label="Situación del cliente"
              onChange={(jubilado) => pon({ jubilado: jubilado === "si" })}
              options={[
                { id: "si", label: "Ya jubilado" },
                { id: "no", label: "Aún no" }
              ]}
              value={datos.jubilado ? "si" : "no"}
            />
          </Eleccion>
          {datos.jubilado ? null : (
            <CampoNumerico
              alCambiar={(edadJubilacion) => pon({ edadJubilacion })}
              etiqueta="Edad de jubilación"
              /* Los mismos límites que el motor: no antes de la edad de hoy, ni después de los 75 salvo que ya los tenga (PLA-14). */
              max={Math.max(edadDeHoy, 75)}
              min={edadDeHoy}
              obligatorio
              valor={datos.edadJubilacion}
            />
          )}
          <CampoNumerico
            alCambiar={(edadFin) => pon({ edadFin: edadFin ?? datos.edadFin })}
            ayuda="La edad hasta la que tienen que llegar los ahorros."
            etiqueta="Planificar hasta los"
            max={110}
            min={(o?.edadJubilacion ?? datos.edad ?? 40) + 1}
            valor={datos.edadFin}
          />
          {/* Un desplegable y no botones: tres opciones no caben en la columna de un campo, y se cortaban. */}
          <Campo pista="Solo elige la tabla de mortalidad con la que se dice cuántos llegan a esa edad: no cambia el cálculo." rotulo="Sexo">
            <select onChange={(evento) => pon({ sexo: evento.target.value === "hombre" || evento.target.value === "mujer" ? evento.target.value : null })} value={datos.sexo ?? ""}>
              <option value="">Sin indicar</option>
              <option value="hombre">Hombre</option>
              <option value="mujer">Mujer</option>
            </select>
          </Campo>
        </div>
        <Importe
          alCambiar={(pension) => pon({ pension })}
          ayuda={
            <>
              14 pagas al año, antes de impuestos{datos.jubilado ? "" : ", en euros de hoy"}.
              {pensionAnual !== null ? ` Al año, ${euros(pensionAnual)}.` : ""} Sube cada año con el IPC de las hipótesis.
            </>
          }
          etiqueta="Pensión pública bruta, por paga"
          valor={datos.pension}
        />
      </Panel>

      <Panel claseDelCuerpo="stack stack--tight" subtitulo="Valor de hoy. Lo que no se escribe, no cuenta" titulo="Ahorros e inversiones">
        {/* A la vista, y no en la cabecera del bloque: es el atajo que más se usa cuando hay una propuesta abierta. */}
        {cartera && cartera.posiciones > 0 ? (
          <div className="jubilacion-atajo">
            <Button
              busy={tomandoDeLaCartera}
              disabled={cartera.capital === undefined}
              onClick={alTomarDeLaCartera}
              size="sm"
              title={cartera.capital === undefined ? "La propuesta en curso no tiene capital fijado: sin él no hay saldos que traer" : undefined}
              variant="secondary"
            >
              Tomar de la propuesta en curso
            </Button>
            <span className="field__hint">
              {cartera.nombre ? `«${cartera.nombre}» · ` : ""}
              {cartera.posiciones} {cartera.posiciones === 1 ? "posición" : "posiciones"}
            </span>
          </div>
        ) : null}
        {avisoDeLaCartera}
        <table className="jubilacion-saldos">
          <thead>
            <tr>
              <th scope="col">
                <span className="ui-visually-hidden">Clase de ahorro</span>
              </th>
              <th scope="col">Valor de hoy</th>
              <th scope="col">Coste de adquisición</th>
            </tr>
          </thead>
          <tbody>
            {ACTIVOS.map((activo) => (
              <tr key={activo.valor}>
                <th scope="row">{activo.nombre}</th>
                <td onBlur={alSalirVacio(datos[activo.valor], () => pon({ [activo.valor]: null }))}>
                  <EuroAmountInput ariaLabel={`${activo.nombre}: valor de hoy`} className="jubilacion-importe" min={0} onCommit={(valor) => pon({ [activo.valor]: valor })} value={datos[activo.valor]} />
                </td>
                <td onBlur={activo.coste ? alSalirVacio(datos[activo.coste], () => pon({ [activo.coste as string]: null })) : undefined}>
                  {activo.coste ? (
                    <EuroAmountInput ariaLabel={activo.elCoste} className="jubilacion-importe" min={0} onCommit={(coste) => pon({ [activo.coste as string]: coste })} value={datos[activo.coste]} />
                  ) : (
                    <Ausencia clase="no-aplica" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td>{euros(total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
        <p className="cmp-note">
          La liquidez y los depósitos tributan por sus intereses de cada año. De los fondos, las acciones y los seguros tributa la ganancia de lo que se vende,
          a coste medio: por eso hace falta su coste.
        </p>
        {datos.jubilado ? null : (
          <Importe
            alCambiar={(ahorroAnual) => pon({ ahorroAnual })}
            ayuda={
              calculado && o && o.aniosHastaJubilacion > 0
                ? `Se suma cada año a las inversiones, en euros de hoy. A los ${o.edadJubilacion}, los ahorros serían ${euros(calculado.plan.ini.liq + calculado.plan.ini.V)} de entonces.`
                : "Se suma cada año a las inversiones, en euros de hoy."
            }
            etiqueta="Ahorro anual hasta la jubilación"
            valor={datos.ahorroAnual}
          />
        )}
        <Eleccion
          ayuda={
            datos.estrategia === "consumir"
              ? `Se retira cada año una cantidad que sube con el IPC, y los ahorros se acaban a los ${edadDelPlan}.`
              : datos.rentabilidad > datos.inflacion
                ? "Se retira solo la rentabilidad por encima del IPC: el capital mantiene su valor."
                : datos.rentabilidad === datos.inflacion
                  ? "Se retira solo la rentabilidad por encima del IPC, y con esta hipótesis no la hay: no se retira nada."
                  : "Se retira solo la rentabilidad por encima del IPC, y con esta hipótesis no la hay: no se retira nada y el capital pierde valor."
          }
          etiqueta="Uso de los ahorros"
        >
          <SegmentedControl
            label="Uso de los ahorros"
            onChange={(estrategia) => pon({ estrategia })}
            options={[
              { id: "consumir", label: `Gastarlos hasta los ${edadDelPlan}` },
              { id: "conservar", label: "Vivir de lo que rinden" }
            ]}
            value={datos.estrategia}
          />
        </Eleccion>
      </Panel>

      <Panel claseDelCuerpo="stack stack--tight" subtitulo={T?.fiscalRenta} titulo={figura}>
        {!T || !pv ? (
          <p className="cmp-note">Elige la residencia fiscal: de ella depende si es una EPSV o un plan de pensiones, y cómo tributa.</p>
        ) : (
          <>
            <SegmentedControl
              label={`¿Tiene ${T.una}?`}
              onChange={(tiene) => pon({ tieneEpsv: tiene === "si" })}
              options={[
                { id: "no", label: `No tiene ${T.figura}` },
                { id: "si", label: `Tiene ${T.una}` }
              ]}
              value={datos.tieneEpsv ? "si" : "no"}
            />
            {datos.tieneEpsv ? (
              <>
                {vasco ? (
                  <Eleccion etiqueta="Desglose de aportaciones y rentabilidad">
                    <SegmentedControl
                      label="Desglose de la EPSV"
                      onChange={(epsvDesglose) => pon({ epsvDesglose })}
                      options={[
                        { id: "certificado", label: "Con certificado" },
                        { id: "estimacion", label: "Sin desglose" }
                      ]}
                      value={datos.epsvDesglose}
                    />
                  </Eleccion>
                ) : null}
                {vasco && datos.epsvDesglose === "estimacion" ? (
                  <>
                    <Importe alCambiar={(saldo) => pon({ epsvPre: saldo, epsvPost: saldo === null ? null : 0 })} etiqueta={`Saldo total ${T.de}`} valor={datos.epsvPre === null && datos.epsvPost === null ? null : saldoDeLaPrevision} />
                    <Casilla alCambiar={(antiguedadConocida) => pon({ antiguedadConocida })} marcada={datos.antiguedadConocida} titulo="Se sabe cuántos años lleva aportando" />
                    {datos.antiguedadConocida ? (
                      <CampoNumerico alCambiar={(antiguedad) => pon({ antiguedad: antiguedad ?? datos.antiguedad })} etiqueta="Años desde la primera aportación" max={60} min={1} valor={datos.antiguedad} />
                    ) : null}
                    {pv.modelo === "vasco" ? (
                      <p className="cmp-note">
                        Sin desglose, {cfg?.hacienda} estima la rentabilidad{calculado ? ` en el ${pctEntero(calculado.resumen.ratioEpsv)} de lo cobrado` : ""}: un{" "}
                        {pctEntero(pv.estimacionAnual)} por año de antigüedad, con un máximo del {pctEntero(pv.estimacionMaxima)}, o el {pctEntero(pv.estimacionSinAntiguedad)} si no se conoce la antigüedad.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <table className="jubilacion-saldos">
                    <thead>
                      <tr>
                        <th scope="col">
                          <span className="ui-visually-hidden">Tramo</span>
                        </th>
                        <th scope="col">{vasco ? "Saldo" : "Derechos consolidados"}</th>
                        <th scope="col">{vasco ? "De él, rentabilidad" : ""}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        [
                          ["epsvPre", "epsvPreRent", T.etiquetaPre],
                          ["epsvPost", "epsvPostRent", T.etiquetaPost]
                        ] as const
                      ).map(([saldo, rentabilidad, etiqueta]) => (
                        <tr key={saldo}>
                          <th scope="row">{etiqueta}</th>
                          <td onBlur={alSalirVacio(datos[saldo], () => pon({ [saldo]: null }))}>
                            <EuroAmountInput ariaLabel={`${etiqueta}: saldo`} className="jubilacion-importe" min={0} onCommit={(valor) => pon({ [saldo]: valor })} value={datos[saldo]} />
                          </td>
                          <td onBlur={vasco ? alSalirVacio(datos[rentabilidad], () => pon({ [rentabilidad]: null })) : undefined}>
                            {vasco ? (
                              <EuroAmountInput ariaLabel={`${etiqueta}: rentabilidad`} className="jubilacion-importe" min={0} onCommit={(valor) => pon({ [rentabilidad]: valor })} value={datos[rentabilidad]} />
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {pv.modelo === "reduccion" ? (
                  <p className="cmp-note">
                    En {cfg?.nombre} no se separa la rentabilidad: todo lo cobrado {T.de} es rendimiento del trabajo. Solo importa qué parte deriva de aportaciones anteriores a {pv.corte},
                    porque esa parte puede reducirse un {pctEntero(pv.reduccion)} si se cobra de una vez. La certifica la entidad gestora; sin ese dato, se deja vacía y se calcula sin la reducción.
                  </p>
                ) : null}

                <Eleccion etiqueta="Forma de cobro">
                  <SegmentedControl<FormaDeCobro>
                    label="Forma de cobro"
                    onChange={(epsvCobro) => pon({ epsvCobro })}
                    options={[
                      { id: "renta", label: "En renta" },
                      { id: "capital", label: "De una vez" },
                      { id: "mixto", label: "Parte de cada forma" }
                    ]}
                    value={datos.epsvCobro}
                  />
                </Eleccion>
                {datos.epsvCobro === "mixto" ? (
                  <CampoNumerico alCambiar={(pct) => pon({ epsvPctCapital: pct ?? datos.epsvPctCapital })} etiqueta="Parte que se cobra de una vez, en %" max={95} min={5} valor={datos.epsvPctCapital} />
                ) : null}

                {datos.epsvCobro !== "capital" ? (
                  <div className="jubilacion-campos">
                    <Campo pista={T.bloqueRenta.find((opcion) => opcion.v === datos.epsvRenta)?.d} rotulo="Tipo de renta">
                      <select onChange={(evento) => pon({ epsvRenta: evento.target.value as TipoDeRenta })} value={datos.epsvRenta}>
                        {T.bloqueRenta.map((opcion) => (
                          <option key={opcion.v} value={opcion.v}>
                            {opcion.t}
                          </option>
                        ))}
                      </select>
                    </Campo>
                    {datos.epsvRenta === "temporal" ? (
                      <CampoNumerico alCambiar={(anios) => pon({ epsvAniosRenta: anios ?? datos.epsvAniosRenta })} etiqueta="Duración de la renta, en años" max={40} min={pv.rentaMinimaAnios} valor={datos.epsvAniosRenta} />
                    ) : null}
                  </div>
                ) : null}

                {datos.epsvCobro !== "renta" ? (
                  <div className="stack stack--tight">
                    <p className="section-label">Condiciones del cobro de una vez · {conReduccion ? T.reduccionCapital : "sin reducción"}</p>
                    {pv.modelo === "vasco" ? (
                      <div className="jubilacion-campos jubilacion-campos--pareja jubilacion-campos--ancha">
                        <Campo rotulo="Motivo del cobro">
                          <select onChange={(evento) => pon({ contingencia: evento.target.value })} value={datos.contingencia}>
                            {CONTINGENCIAS.map(([valor, texto]) => (
                              <option key={valor} value={valor}>
                                {texto}
                              </option>
                            ))}
                          </select>
                        </Campo>
                        <Campo rotulo={`Régimen de lo aportado hasta ${pv.corte - 1}`}>
                          <select onChange={(evento) => pon({ regimen: evento.target.value as RegimenDelCapital })} value={datos.regimen}>
                            <option value="auto">El de menor impuesto estimado</option>
                            <option value="transitorio">Transitorio: integra el {pctEntero(pv.capitalTransitorio)}</option>
                            <option value="nuevo">
                              Desde {pv.corte}: aportación al {pctEntero(pv.capital)}
                            </option>
                          </select>
                        </Campo>
                      </div>
                    ) : (
                      <p className="cmp-note">
                        La reducción del {pctEntero(pv.reduccion)} ({cfg?.modelo === "navarra" ? "DT 25.ª" : "DT 12.ª"}) se aplica a la parte del cobro que deriva de aportaciones anteriores a {pv.corte}. El resto
                        tributa íntegro como rendimiento del trabajo.
                      </p>
                    )}
                    <Casilla alCambiar={(primerCobro) => pon({ primerCobro })} marcada={datos.primerCobro} nota={T.condicionPrimerCobroNota} titulo={T.condicionPrimerCobro} />
                    <Casilla
                      alCambiar={(dosAnios) => pon({ dosAnios })}
                      marcada={datos.dosAnios}
                      nota={vasco ? "No se exige en invalidez o dependencia." : "Requisito de la reducción."}
                      titulo="Han pasado más de 2 años desde la primera aportación"
                    />
                  </div>
                ) : null}
              </>
            ) : (
              <p className="cmp-note">Sin {T.figura}, el cálculo usa la pensión y los ahorros.</p>
            )}
            {/* El caso práctico que publica la Hacienda Foral, mientras no haya una EPSV escrita que pisar. */}
            {cfg?.caso === "dfb" && saldoDeLaPrevision === 0 ? (
              <div>
                <Button onClick={() => alCambiar(conElCasoDeLaDfb(datos))} size="sm" variant="quiet">
                  Cargar el caso de la Hacienda Foral
                </Button>
              </div>
            ) : null}
          </>
        )}
      </Panel>

      <Panel claseDelCuerpo="stack stack--tight" subtitulo="Se eligen para simular: no son una previsión ni una promesa" titulo="Hipótesis">
        <div className="jubilacion-campos jubilacion-campos--pareja">
          <CampoNumerico
            alCambiar={(rentabilidad) => pon({ rentabilidad: rentabilidad ?? datos.rentabilidad })}
            ayuda="Lo que rendiría de media cada año el patrimonio, después de gastos. Enseña también 1,5 puntos menos y más."
            etiqueta="Rentabilidad anual, en %"
            decimales
            max={10}
            min={-2}
            valor={datos.rentabilidad}
          />
          <CampoNumerico
            alCambiar={(inflacion) => pon({ inflacion: inflacion ?? datos.inflacion })}
            ayuda="La pensión y las retiradas suben con él cada año. Los euros de hoy lo descuentan."
            etiqueta="Inflación (IPC) anual, en %"
            decimales
            max={6}
            min={0}
            valor={datos.inflacion}
          />
        </div>
        <Casilla
          alCambiar={(estres) => pon({ estres })}
          marcada={datos.estres}
          /* Espacio que no se parte ante el «%»: sin él, a 1024 px la línea se cortaba en «del 5 / % el segundo». */
          nota={"Una caída del 12 % el primer año de jubilación y del 5 % el segundo, con las mismas retiradas. Perder al principio daña más que perder después."}
          titulo="Proyectar también un mal comienzo"
        />
        <Importe
          alCambiar={(otrasDeducciones) => pon({ otrasDeducciones })}
          ayuda={
            cfg?.modelo === "vasco"
              ? "Al año: por donativos, por ejemplo. La deducción por edad y la minoración ya se aplican solas."
              : cfg?.modelo === "navarra"
                ? "Al año: por donativos, por ejemplo. La deducción por trabajo y el mínimo personal ya se aplican solos."
                : "Al año: por donativos, por ejemplo. El mínimo personal y la reducción del trabajo ya se aplican solos; no incluye deducciones autonómicas."
          }
          etiqueta="Otras deducciones en la cuota"
          valor={datos.otrasDeducciones}
        />
      </Panel>

      {/* Al final: casi nunca cambia, pero de ella sale la norma de todo lo demás, y su procedencia se lee aquí. */}
      <Panel
        claseDelCuerpo="stack stack--tight"
        subtitulo={F.disponible(cfg) ? procedenciaFiscal(cfg) : "Sin residencia fiscal no hay normativa que aplicar"}
        titulo="Residencia fiscal"
      >
        <div className="jubilacion-campos">
          <Campo rotulo="Territorio">
            <select
              onChange={(evento) => alCambiar(cambiarTerritorio(datos, evento.target.value))}
              value={datos.territorio ?? ""}
            >
              {datos.territorio === null ? <option value="">Sin elegir</option> : null}
              {F.TERRITORIOS.map((territorio) => (
                <option key={territorio.id} value={territorio.id}>
                  {TERRITORIOS_EN_PANTALLA[territorio.id] ?? territorio.nombre}
                </option>
              ))}
            </select>
          </Campo>
          {datos.territorio === "estatal" ? (
            <Campo rotulo="Comunidad autónoma">
              <select onChange={(evento) => alCambiar(cambiarTerritorio(datos, "estatal", evento.target.value))} value={datos.ccaa}>
                {F.CCAA.map((comunidad) => (
                  <option key={comunidad.id} value={comunidad.id}>
                    {comunidad.nombre}
                  </option>
                ))}
              </select>
            </Campo>
          ) : null}
        </div>
        {cfg?.ccaa ? <p className="cmp-note">{cfg.ccaa.referencia ? cfg.ccaa.descripcion : cfg.ccaa.nota}</p> : null}
        {T ? <p className="cmp-note">{T.ambito}</p> : null}
      </Panel>
    </div>
  );
}
