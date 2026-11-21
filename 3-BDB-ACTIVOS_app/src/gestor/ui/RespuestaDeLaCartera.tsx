/**
 * La respuesta de una cartera de cliente, bajo su cabecera: cuánto vale y cuánto ha ganado en el periodo elegido.
 * Cuatro cifras, las del titular de siempre, y la primera en grande:
 *
 *   1. Patrimonio, sin decimales, con lo que hay en valores y en efectivo.
 *   2. Resultado del periodo, en euros, con su signo y su color.
 *   3. Rentabilidad de la cartera, frente a su referencia si la tiene.
 *   4. Rentabilidad del cliente, que cuenta cuándo aportó y retiró dinero.
 *
 * No calcula nada: lee el análisis del periodo.
 */
import { Cifra } from "../../components/ui/Cifra";
import { NotaEmergente } from "../../components/ui/NotaEmergente";
import { Respuesta } from "../../components/ui/Respuesta";
import { fechaDeInicioDelPeriodo } from "../motor/analisis";
import { metrica, type Metrica } from "../motor/metricas/registro";
import { notaCortaDeLasSinPrecio, notaCortaDeLoContadoComoCero } from "../motor/sinPrecio";
import { escrito } from "./textos";
import type { DatosDeVista } from "./tipos";

const CUAL_SE_ENSENA = "El informe del cliente enseña las dos, y explica en qué se diferencian.";

export function RespuestaDeLaCartera({ datos }: { datos: DatosDeVista }) {
  const { analisis } = datos;
  if (analisis.vacia) return null;
  const divisa = analisis.cartera.divisaBase;
  const rentabilidad = analisis.rentabilidad;
  const invertido = analisis.patrimonio - analisis.efectivo.total;
  const periodo = escrito.periodo(fechaDeInicioDelPeriodo(analisis), analisis.periodo.hasta);
  const referencia = analisis.referencia;
  const tir = metrica("rentabilidadDelCliente");
  const valorDeLaTir = tir.valor(analisis);
  const aportado = rentabilidad?.aportacionesNetas ?? null;
  /*
   * Una posición sin precio (20-11-2026). El patrimonio es lo que se puede valorar, y lo dice junto a la cifra: «No incluye
   * una posición sin precio.». El resultado y las dos rentabilidades sí la cuentan, y como cero: cada cifra lo dice debajo,
   * tras su apunte de siempre. Aquí van sin nombres —caben mal en la banda, y con tres largos el apunte pasaba de siete
   * líneas a 1.024 px—: los nombres están en Cuentas, en el análisis y en la comprobación de la cartera.
   */
  const noIncluye = notaCortaDeLasSinPrecio(analisis);
  const comoCero = notaCortaDeLoContadoComoCero(analisis);
  /* Lo dice cada cifra que lleva esa salvedad en el registro, y solo si la cifra se da: lo que falta ya dice que falta. */
  const conLoContadoComoCero = (apunte: string | undefined, cifra: Metrica) => (comoCero && cifra.salvedad?.(analisis) !== undefined ? (apunte ? `${apunte}. ${comoCero}` : comoCero) : apunte);

  return (
    <Respuesta
      datos={[
        {
          rotulo: "Patrimonio",
          cifra: <Cifra divisa={divisa} tipo="importeTitular" valor={analisis.patrimonio} />,
          apunte: `a ${escrito.fecha(analisis.fecha)} · ${escrito.importeTitular(invertido, divisa)} en valores y ${escrito.importeTitular(analisis.efectivo.total, divisa)} en efectivo${noIncluye ? `. ${noIncluye}` : ""}`,
          principal: true
        },
        {
          rotulo: "Resultado del periodo",
          cifra: <Cifra colorDeSigno conSigno divisa={divisa} tipo="importeTitular" valor={rentabilidad?.resultado} />,
          /* GES-12: un periodo que no se podía dar se enseña desde el inicio, y se dice. */
          apunte: conLoContadoComoCero(datos.periodoCaido ? `desde el inicio, ${periodo}` : periodo, metrica("resultado"))
        },
        {
          rotulo: (
            <>
              Rentabilidad de la cartera{" "}
              <NotaEmergente termino="la rentabilidad de la cartera">
                {metrica("rentabilidad").ayuda} {CUAL_SE_ENSENA}
              </NotaEmergente>
            </>
          ),
          cifra: <Cifra tipo="rentabilidad" valor={rentabilidad?.twr} />,
          apunte: conLoContadoComoCero(
            referencia?.disponible && referencia.rentabilidad !== null
              ? `su referencia, ${escrito.rentabilidad(referencia.rentabilidad)}`
              : rentabilidad?.twrAnualizada !== null && rentabilidad?.twrAnualizada !== undefined
                ? `${escrito.rentabilidad(rentabilidad.twrAnualizada)} al año`
                : undefined,
            metrica("rentabilidad")
          )
        },
        {
          rotulo: (
            <>
              Rentabilidad del cliente{" "}
              <NotaEmergente termino="la rentabilidad del cliente">
                {tir.ayuda} {CUAL_SE_ENSENA}
              </NotaEmergente>
            </>
          ),
          cifra: <Cifra tipo="rentabilidad" valor={valorDeLaTir} />,
          apunte: conLoContadoComoCero(
            aportado === null
              ? undefined
              : `${rentabilidad?.anualiza ? "al año · " : ""}cuenta cuándo ${aportado >= 0 ? "aportó" : "retiró"}: ${escrito.importeTitular(Math.abs(aportado), divisa)} en el periodo`,
            tir
          )
        }
      ]}
      etiqueta="Cuánto vale y cuánto ha ganado"
    />
  );
}
