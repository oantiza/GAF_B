/**
 * Las dos cuentas de la cartera, a cualquier fecha: la cuenta de valores (qué títulos hay,
 * cuánto valen y cuánto costaron) y la cuenta de efectivo (su saldo y su extracto).
 */
import { useMemo, useState } from "react";
import { useModoCliente } from "../../../app/ClientModeContext";
import { EmptyState } from "../../../components/ui/AsyncState";
import { Campo } from "../../../components/ui/Campo";
import { Cifra } from "../../../components/ui/Cifra";
import { Panel } from "../../../components/ui/Panel";
import { SegmentedControl } from "../../../components/ui/SegmentedControl";
import { TablaDeDatos } from "../../../components/tabla/TablaDeDatos";
import { textoDeAusencia } from "../../../core/textoDeAusencia";
import type { CeldaDeTabla, ColumnaDeTabla } from "../../../types/tablaDeDatos";
import { analizar, FUENTE, type PosicionAnalizada } from "../../motor/analisis";
import { aNumero } from "../../motor/decimal";
import { cuentasA, extractoDeEfectivo } from "../../motor/libro";
import { NOMBRE_DEL_TIPO_DE_ACTIVO } from "../../motor/modelo";
import { nombreDelTipo } from "../../motor/movimientos/registro";
import { cuantasSinPrecio, listaDeLasSinPrecio } from "../../motor/sinPrecio";
import { FilaDeDato } from "../piezas";
import type { DatosDeVista } from "../tipos";
import { descripcionDelMovimiento, escrito } from "../textos";

interface FilaDePosicion extends PosicionAnalizada {
  id: string;
}

interface FilaDelExtracto {
  id: string;
  fecha: string;
  concepto: string;
  importe: number;
  saldo: number;
  divisa: string;
}

const TEXTO_DE_LA_FUENTE: Record<number, string | undefined> = {
  [FUENTE.sinPrecio]: "Sin precio",
  [FUENTE.manual]: "Precio a mano",
  [FUENTE.operacion]: "Precio de su última operación",
  [FUENTE.extracto]: "Precio del extracto del banco"
};

/** La celda de un dato que falta: lo escribe la tabla con su pieza, y al ordenar va siempre al final. */
const FALTA: CeldaDeTabla = { texto: textoDeAusencia("falta"), ausencia: "falta" };

/** Un resultado: con su signo y su color. */
function resultado(valor: number | null, tipo: "importe" | "rentabilidad", divisa: string): CeldaDeTabla {
  if (valor === null) return FALTA;
  const texto = tipo === "importe" ? escrito.importeConSigno(valor, divisa) : escrito.rentabilidad(valor);
  return { texto, valor, nodo: tipo === "importe" ? <Cifra colorDeSigno conSigno divisa={divisa} tipo="importe" valor={valor} /> : <Cifra tipo="rentabilidad" valor={valor} /> };
}

function columnas(divisa: string): ColumnaDeTabla<FilaDePosicion>[] {
  return [
    {
      id: "activo",
      titulo: "Activo",
      encabezaFila: true,
      nombre: true,
      celda: (fila) => ({ texto: fila.activo.nombre, valor: fila.activo.nombre.toLowerCase(), apunte: [NOMBRE_DEL_TIPO_DE_ACTIVO[fila.activo.tipo], fila.activo.isin, fila.activo.divisa !== divisa ? fila.activo.divisa : undefined].filter(Boolean).join(" · ") })
    },
    { id: "titulos", titulo: "Títulos", cifra: true, celda: (fila) => ({ texto: escrito.titulos(fila.titulos), valor: aNumero(fila.titulos), apunte: fila.activo.tipo === "BONO" ? "Nominal" : undefined }) },
    {
      id: "precio",
      titulo: "Precio",
      cifra: true,
      celda: (fila) =>
        fila.precio === null
          ? { ...FALTA, apunte: TEXTO_DE_LA_FUENTE[fila.fuente] }
          : {
              /* Un bono cotiza en porcentaje de su nominal, no en euros por título. */
              texto: fila.activo.tipo === "BONO" ? `${escrito.precio(fila.precio, null)} %` : escrito.precio(fila.precio, fila.activo.divisa),
              valor: fila.precio,
              apunte: TEXTO_DE_LA_FUENTE[fila.fuente] ?? (fila.antiguedad > 7 ? `De hace ${fila.antiguedad} días` : undefined)
            }
    },
    /* Sin precio no hay valor ni peso que dar: se dice que faltan, y no se pinta un cero (20-11-2026). */
    { id: "valor", titulo: "Valor", cifra: true, celda: (fila) => (fila.valor === null ? FALTA : { texto: escrito.importe(fila.valor, divisa), valor: fila.valor }) },
    { id: "peso", titulo: "Peso", cifra: true, celda: (fila) => (fila.peso === null ? FALTA : { texto: escrito.peso(fila.peso), valor: fila.peso }) },
    { id: "coste", titulo: "Coste", cifra: true, celda: (fila) => (fila.coste === null ? FALTA : { texto: escrito.importe(fila.coste, divisa), valor: fila.coste, apunte: fila.precioMedio === null ? undefined : fila.activo.tipo === "BONO" ? `${escrito.precio(fila.precioMedio, null)} % del nominal` : `${escrito.precio(fila.precioMedio, fila.activo.divisa)} por título` }) },
    { id: "latente", titulo: "Resultado latente", cifra: true, celda: (fila) => resultado(fila.latente, "importe", divisa) },
    { id: "latentePct", titulo: "%", cifra: true, celda: (fila) => resultado(fila.latentePct, "rentabilidad", divisa) }
  ];
}

/* El importe de un movimiento de efectivo va en tinta, con su signo: una aportación no es una ganancia. */
const COLUMNAS_DEL_EXTRACTO: ColumnaDeTabla<FilaDelExtracto>[] = [
  { id: "fecha", titulo: "Fecha", encabezaFila: true, celda: (fila) => ({ texto: escrito.fecha(fila.fecha), valor: fila.fecha }) },
  { id: "concepto", titulo: "Concepto", celda: (fila) => ({ texto: fila.concepto }) },
  { id: "importe", titulo: "Importe", cifra: true, celda: (fila) => ({ texto: escrito.importeConSigno(fila.importe, fila.divisa), valor: fila.importe }) },
  { id: "saldo", titulo: "Saldo", cifra: true, celda: (fila) => ({ texto: escrito.importe(fila.saldo, fila.divisa), valor: fila.saldo }) }
];

const CRITERIOS = [
  { id: "operacion", label: "Fecha de operación" },
  { id: "valor", label: "Fecha valor" }
] as const;

export function VistaCuentas({ datos }: { datos: DatosDeVista }) {
  const { abierta, preparado, hoy } = datos;
  const { cartera } = abierta;
  const divisa = cartera.divisaBase;
  const [aFecha, setAFecha] = useState(hoy);
  const [criterio, setCriterio] = useState<"operacion" | "valor">("operacion");
  const seVenLasNotas = useModoCliente().seEnsena("notasDelAsesor");
  const primerDia = preparado.valoracion.dias[0];

  /*
   * Las cuentas a la fecha pedida: el mismo análisis, cortado ese día. El ya calculado solo vale si
   * acaba ese mismo día: el del periodo elegido en otra pestaña puede acabar antes.
   */
  const aEsaFecha = useMemo(() => {
    if (datos.analisis.fecha === aFecha) return datos.analisis;
    return analizar(preparado, { desde: datos.periodos.find((periodo) => periodo.id === "inicio")?.periodo.desde ?? aFecha, hasta: aFecha });
  }, [aFecha, datos.analisis, datos.periodos, preparado]);

  /* El saldo por fecha valor: lo que el banco considera disponible ese día. */
  const porValor = useMemo(() => (criterio === "valor" ? cuentasA(cartera, aFecha, { criterio: "valor" }) : null), [criterio, cartera, aFecha]);
  const libro = preparado.valoracion.libro;
  const divisasDeEfectivo = useMemo(() => {
    const todas = new Set<string>([divisa]);
    for (const apunte of libro.apuntes) if (apunte.efecto.clase === "efectivo" && !apunte.efecto.transito) todas.add(apunte.efecto.divisa);
    return [...todas];
  }, [libro, divisa]);
  const [divisaDelExtracto, setDivisaDelExtracto] = useState(divisa);
  const extracto = useMemo(() => extractoDeEfectivo(libro, divisaDelExtracto).filter((linea) => linea.fecha <= aFecha), [libro, divisaDelExtracto, aFecha]);

  if (cartera.movimientos.length === 0 || !primerDia) {
    return <EmptyState description="Cuando la cartera tenga movimientos, aquí verás sus dos cuentas: los títulos de la cuenta de valores y el saldo de la cuenta de efectivo, a la fecha que elijas." title="Las cuentas están vacías" />;
  }

  const filas: FilaDePosicion[] = aEsaFecha.posiciones.map((posicion) => ({ ...posicion, id: posicion.activo.id }));
  /* Lo invertido es lo que se puede valorar: una posición sin precio no suma, y el total dice que no la incluye. Si ninguna
     tiene precio no hay nada que sumar, y el total no se da: un 0,00 € sería una cifra inventada. */
  const conValor = filas.flatMap((fila) => (fila.valor === null ? [] : [fila.valor]));
  const invertido = conValor.length > 0 ? conValor.reduce((suma, valor) => suma + valor, 0) : null;
  const sinPrecio = aEsaFecha.sinPrecio.length;
  const unaSola = sinPrecio === 1;
  const costeTotal = filas.every((fila) => fila.coste !== null) ? filas.reduce((suma, fila) => suma + (fila.coste ?? 0), 0) : null;
  const cols = columnas(divisa);
  const filasDelExtracto: FilaDelExtracto[] = extracto
    .slice(-15)
    .reverse()
    .map((linea) => ({
      id: `${linea.movimiento.id}-${linea.fecha}`,
      fecha: linea.fecha,
      concepto: descripcionDelMovimiento(linea.movimiento, cartera.activos.find((activo) => activo.id === linea.movimiento.activoId)?.nombre, undefined, { conNota: seVenLasNotas }) || nombreDelTipo(linea.movimiento.tipo),
      importe: aNumero(linea.importe),
      saldo: aNumero(linea.saldo),
      divisa: linea.divisa
    }));

  return (
    <div className="stack stack--bloques">
      <div className="gestor-mandos">
        <Campo rotulo="Cuentas a fecha">
          <input max={hoy} min={primerDia} onChange={(evento) => evento.target.value && setAFecha(evento.target.value > hoy ? hoy : evento.target.value)} type="date" value={aFecha} />
        </Campo>
        <div className="field">
          <span className="field__label">Saldo de efectivo por</span>
          <SegmentedControl label="Criterio del saldo de efectivo" onChange={setCriterio} options={CRITERIOS} value={criterio} />
        </div>
      </div>

      <Panel
        estado={<span>{escrito.importe(aEsaFecha.patrimonio, divisa)} en total{sinPrecio > 0 ? ` · no incluye ${cuantasSinPrecio(sinPrecio)}` : ""}</span>}
        subtitulo={`${cartera.cuentas.valores.nombre}${cartera.cuentas.valores.entidad ? ` · ${cartera.cuentas.valores.entidad}` : ""} · a ${escrito.fecha(aEsaFecha.fecha)}`}
        titulo="Cuenta de valores"
      >
        {filas.length === 0 ? (
          <p className="cmp-note">No hay posiciones a esta fecha.</p>
        ) : (
          <TablaDeDatos
            columnas={cols}
            deActivos
            filas={filas}
            pie={(columna) => {
              switch (columna.id) {
                /* Lo que los totales no incluyen se dice bajo su rótulo, que es la celda ancha y vale para toda la fila: bajo
                   la cifra ensanchaba la columna del valor unos 70 px, y a 1.024 px la tabla dejaba de caber en su caja
                   (medido el 20-11-2026). Con las mismas palabras que el total del bloque. */
                case "activo":
                  return sinPrecio > 0 ? { texto: "Total invertido", apunte: `No incluye ${cuantasSinPrecio(sinPrecio)}` } : undefined;
                /* Un total que no se puede dar lo dice: una celda en blanco se lee como un cero. */
                case "valor":
                  return invertido === null ? FALTA : { texto: escrito.importe(invertido, divisa) };
                case "peso":
                  return invertido === null ? FALTA : aEsaFecha.patrimonio > 0 ? { texto: escrito.peso(invertido / aEsaFecha.patrimonio) } : undefined;
                case "coste":
                  return costeTotal === null ? FALTA : { texto: escrito.importe(costeTotal, divisa) };
                /* El latente del conjunto es el de las posiciones con precio (`Analisis.latente`). */
                case "latente":
                  return resultado(aEsaFecha.latente, "importe", divisa);
                default:
                  return undefined;
              }
            }}
            rotuloDelPie="Total invertido"
            titulo="Posiciones de la cuenta de valores"
          />
        )}
        {/* Una sola nota: dos párrafos seguidos se leían como uno, sin aire entre ellos (este bloque no apila su cuerpo). */}
        <p className="cmp-note">
          El coste es lo pagado por los títulos que quedan, con sus comisiones, empezando a vender por los más antiguos. El resultado latente es el valor menos ese coste; no está materializado.
          {filas.some((fila) => fila.activo.tipo === "BONO") ? " En un bono incluye el cupón corrido que ha ido devengando, no solo lo que ha cambiado su precio." : ""}
          {sinPrecio > 0
            ? ` ${listaDeLasSinPrecio(aEsaFecha)} no ${unaSola ? "tiene precio: su valor, su peso y su resultado no se conocen hasta que se le ponga uno" : "tienen precio: el valor, el peso y el resultado de cada una no se conocen hasta que tenga uno"}. Los totales de la tabla y el patrimonio no ${unaSola ? "la" : "las"} incluyen${
                /* El coste sí se conoce, y por eso su total la cuenta. Si no se da —falta un tipo de cambio—, no se dice. */
                costeTotal === null ? "" : `, salvo el del coste, que sí ${unaSola ? "la" : "las"} cuenta`
              }.`
            : ""}
        </p>
      </Panel>

      <div className="gestor-columnas">
        <Panel
          claseDelCuerpo="stack stack--tight"
          subtitulo={`${cartera.cuentas.efectivo.nombre}${cartera.cuentas.efectivo.entidad ? ` · ${cartera.cuentas.efectivo.entidad}` : ""} · a ${escrito.fecha(aEsaFecha.fecha)}`}
          titulo="Cuenta de efectivo"
        >
          <div className="rows">
            {(porValor
              ? [...porValor.final.efectivo.entries()].map(([codigo, saldo]) => ({ divisa: codigo, saldo, enTransito: null as null | number }))
              : aEsaFecha.efectivo.porDivisa.map((linea) => ({ divisa: linea.divisa, saldo: linea.saldo, enTransito: aNumero(linea.enTransito) }))
            ).map((linea) => (
              <FilaDeDato key={linea.divisa} nota={linea.enTransito ? `más ${escrito.importe(linea.enTransito, linea.divisa)} de un traspaso en curso` : undefined} rotulo={`Saldo en ${linea.divisa}`}>
                {/* Un saldo no es un resultado: va en tinta, con su signo si es negativo. */}
                <Cifra divisa={linea.divisa} tipo="importe" valor={aNumero(linea.saldo)} />
              </FilaDeDato>
            ))}
            {aEsaFecha.efectivo.porDivisa.length === 0 && !porValor ? <FilaDeDato rotulo={`Saldo en ${divisa}`}><Cifra divisa={divisa} tipo="importe" valor={0} /></FilaDeDato> : null}
          </div>
          <p className="cmp-note">
            {criterio === "valor"
              ? "Por fecha valor: solo cuentan los movimientos ya liquidados ese día. Es el saldo disponible que enseña el banco."
              : "Por fecha de operación: cuentan todos los movimientos contratados hasta ese día, aunque no se hayan liquidado. Es el criterio con el que se valora la cartera."}
          </p>
        </Panel>

        <Panel
          acciones={
            divisasDeEfectivo.length > 1 ? (
              <select aria-label="Divisa del extracto" onChange={(evento) => setDivisaDelExtracto(evento.target.value)} value={divisaDelExtracto}>
                {divisasDeEfectivo.map((codigo) => (
                  <option key={codigo} value={codigo}>{codigo}</option>
                ))}
              </select>
            ) : undefined
          }
          subtitulo={`Últimos movimientos en ${divisaDelExtracto} hasta el ${escrito.fecha(aEsaFecha.fecha)}, con el saldo que deja cada uno`}
          titulo="Extracto de la cuenta de efectivo"
        >
          {extracto.length === 0 ? (
            <p className="cmp-note">No hay movimientos de efectivo hasta esta fecha.</p>
          ) : (
            <TablaDeDatos columnas={COLUMNAS_DEL_EXTRACTO} filas={filasDelExtracto} titulo={`Extracto de la cuenta de efectivo en ${divisaDelExtracto}`} />
          )}
          {extracto.length > 15 ? <p className="cmp-note">Se enseñan los 15 últimos de {extracto.length}. El libro completo está en «Movimientos».</p> : null}
        </Panel>
      </div>
    </div>
  );
}
