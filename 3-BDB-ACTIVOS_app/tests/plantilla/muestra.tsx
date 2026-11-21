/* eslint-disable react-refresh/only-export-components */
/**
 * El documento de muestra de la plantilla, con datos inventados y verosímiles (los de la maqueta
 * `docs/frontend/maquetas/informes.html`). Tres partes:
 *  1. la hoja de la maqueta: presentación, cuatro cifras destacadas, la evolución del patrimonio y de dónde viene el
 *     resultado, con su nota;
 *  2. una tabla de 70 posiciones con grupos, para ver la cabecera repetida y el salto de hoja;
 *  3. una hoja apaisada con una tabla ancha, una lista de partes, un aviso y el texto legal.
 *
 * `muestra.test.tsx` la genera en los dos temas y, con `MUESTRA_PDF=<carpeta>`, escribe allí los dos PDF.
 */
import { fecha, importe, importeTitular, numero, peso, porcentaje, precio, rentabilidad, signoDe, titulos } from "../../src/core/formato";
import {
  Aviso,
  AvisoLegal,
  CifrasDestacadas,
  DocumentoDeInforme,
  GraficoDeLineas,
  HojasDeSecciones,
  ListaDePartes,
  Nota,
  Presentacion,
  SERIES,
  Tabla,
  renderizarInforme,
  type CeldaDeTabla,
  type FilaDeTabla,
  type IdentidadDelAsesor,
  type SeccionDeInforme,
  type TemaDeInforme
} from "../../src/reports/plantilla";
import { logotipoDeMuestra } from "./logotipoDeMuestra";

export interface DatosDeMuestra {
  tema: TemaDeInforme;
  cliente: string;
  desde: string;
  hasta: string;
  fechas: string[];
  valor: number[];
  aportado: number[];
  /** Cuántas posiciones lleva la tabla larga. */
  posiciones: number;
}

/* ------------------------------------------------------------------------------------------------ Los datos */

/** Un generador pseudoaleatorio con semilla: la muestra sale igual cada vez. */
function azar(semilla: number) {
  let estado = semilla >>> 0;
  return () => {
    estado = (Math.imul(estado, 1664525) + 1013904223) >>> 0;
    return estado / 2 ** 32;
  };
}

/** Los días laborables entre dos fechas, «AAAA-MM-DD». */
function diasLaborables(desde: string, hasta: string): string[] {
  const dias: string[] = [];
  for (let t = Date.parse(`${desde}T00:00:00Z`); t <= Date.parse(`${hasta}T00:00:00Z`); t += 86_400_000) {
    const dia = new Date(t);
    if (dia.getUTCDay() !== 0 && dia.getUTCDay() !== 6) dias.push(dia.toISOString().slice(0, 10));
  }
  return dias;
}

export function datosDeMuestra(tema: TemaDeInforme, posiciones = 70): DatosDeMuestra {
  const desde = "2025-12-31";
  const hasta = "2026-11-13";
  const fechas = diasLaborables(desde, hasta);
  const siguiente = azar(3);
  const bruto: number[] = [172_716];
  for (let i = 1; i < fechas.length; i += 1) bruto.push(bruto[i - 1] * (1 + 0.0007 + (siguiente() - 0.5) * 0.012));
  /* Que acabe en el patrimonio de la maqueta: se corrige la deriva poco a poco, sin tocar el primer día. */
  const ajuste = 201_298 / bruto[bruto.length - 1];
  const valor = bruto.map((v, i) => Math.round(v * ajuste ** (i / (bruto.length - 1))));
  const aportado = fechas.map((_, i) => 172_716 + Math.floor(i / 22) * 1_000);
  return { tema, cliente: "Familia García", desde, hasta, fechas, valor, aportado, posiciones };
}

export const IDENTIDAD_DE_MUESTRA: IdentidadDelAsesor = {
  nombre: "Marta Ruiz Alonso",
  entidad: "Ruiz & Asociados",
  contacto: "marta.ruiz@ruizasociados.es",
  logotipo: logotipoDeMuestra()
};

/** Una cifra con su color de signo, mirando la cifra ya redondeada. */
const conSigno = (texto: string | null, valor: number, decimales: number): CeldaDeTabla => ({ texto, signo: signoDe(valor, decimales) });

/* ------------------------------------------------------------------------------------------------ Las secciones */

const presentacion: SeccionDeInforme<DatosDeMuestra> = {
  id: "presentacion",
  titulo: "Presentación",
  comienzo: "presentacion",
  procede: () => true,
  Contenido: ({ datos }) => (
    <>
      <Presentacion
        contexto={[datos.cliente, `del ${fecha(datos.desde)} al ${fecha(datos.hasta)}`, `datos a ${fecha(datos.hasta)}`]}
        titulo={datos.tema === "cliente" ? "Informe de su cartera" : "Informe de la cartera"}
      />
      <CifrasDestacadas
        cifras={[
          { rotulo: "Patrimonio", cifra: importeTitular(201_298), apunte: `a ${fecha(datos.hasta)}`, principal: true },
          { rotulo: "Resultado del periodo", cifra: importeTitular(18_582, { conSigno: true }), signo: signoDe(18_582, 0), apunte: "neto de comisiones" },
          { rotulo: "Rentabilidad", cifra: rentabilidad(0.1039), signo: signoDe(0.1039, 4), apunte: `su referencia, ${rentabilidad(0.1388)}` },
          { rotulo: "Caída máxima", cifra: porcentaje(-0.0266), apunte: "recuperada en octubre" }
        ]}
      />
    </>
  )
};

const evolucion: SeccionDeInforme<DatosDeMuestra> = {
  id: "evolucion",
  titulo: "Evolución del patrimonio",
  procedencia: "La distancia entre las dos líneas es lo ganado o perdido",
  procede: (datos) => datos.fechas.length > 1,
  juntoAlTitulo: 200,
  Contenido: ({ datos }) => (
    <GraficoDeLineas
      fechas={datos.fechas}
      series={[
        { nombre: "Valor", valores: datos.valor },
        { nombre: "Aportado", valores: datos.aportado, referencia: true }
      ]}
      formato={(v) => importeTitular(v)}
      alto={186}
    />
  )
};

const RESULTADO: Array<[string, string, number, number]> = [
  ["Variación de precio", "Lo que han subido o bajado los precios", 17_170.13, 0.0925],
  ["Ingresos", "Dividendos, cupones e intereses", 614.97, 0.0033],
  ["Efecto de la divisa", "Lo que ha movido el tipo de cambio", 971.7, 0.0052],
  ["Comisiones y gastos", "Custodia, asesoramiento e impuestos de la cuenta", -175.2, -0.0009]
];

const resultado: SeccionDeInforme<DatosDeMuestra> = {
  id: "resultado",
  titulo: "De dónde viene el resultado",
  procede: () => true,
  juntoAlTitulo: 160,
  Contenido: ({ datos }) => (
    <>
      <Tabla
        columnas={[{ titulo: "Concepto", ancho: 1.25 }, { titulo: "Qué es", ancho: 2.6 }, { titulo: "Importe", ancho: 1.1, cifra: true }, { titulo: "Sobre el patrimonio medio", ancho: 1.45, cifra: true }]}
        filas={RESULTADO.map(([concepto, que, euros, fraccion]) => ({
          celdas: [concepto, que, conSigno(importe(euros, { conSigno: true }), euros, 2), conSigno(rentabilidad(fraccion), fraccion, 4)]
        }))}
        total={["Resultado", "", conSigno(importe(18_581.6, { conSigno: true }), 1, 2), conSigno(rentabilidad(0.1001), 1, 4)]}
      />
      {datos.tema === "cliente" ? (
        <Nota titulo="Cómo leer estas cifras.">
          La rentabilidad de la cartera no depende de cuándo aportó o retiró dinero; por eso sirve para compararla con su referencia. Lo que usted ha ganado en euros es el resultado del periodo.
        </Nota>
      ) : (
        <Nota titulo="Comprobaciones.">
          {`El libro cuadra con el extracto del ${fecha(datos.hasta)} en las 7 líneas comprobadas. Una posición pesa el ${peso(0.471)} de la cartera. No falta ningún precio.`}
        </Nota>
      )}
    </>
  )
};

const CLASES = ["Renta variable", "Renta fija", "Monetario", "Alternativos"] as const;
const NOMBRES: Record<(typeof CLASES)[number], string[]> = {
  "Renta variable": ["Acciones Europa", "Acciones EE. UU.", "Acciones Japón", "Emergentes Asia", "Dividendo global", "Pequeñas compañías"],
  "Renta fija": ["Deuda pública euro", "Crédito grado de inversión", "Bonos ligados a la inflación", "Renta fija flexible"],
  Monetario: ["Monetario euro", "Letras del Tesoro"],
  Alternativos: ["Retorno absoluto", "Materias primas"]
};

/** La posición `n` (desde 1) de la tabla larga: su clase y su fila. */
function posicion(n: number): { clase: (typeof CLASES)[number]; celdas: CeldaDeTabla[] } {
  const clase = CLASES[n <= 30 ? 0 : n <= 52 ? 1 : n <= 62 ? 2 : 3];
  const siguiente = azar(n * 7919);
  const valor = 1_200 + Math.round(siguiente() * 9_000 * 100) / 100;
  const latente = Math.round((siguiente() - 0.35) * valor * 0.18 * 100) / 100;
  const isin = `LU${String(1_000_000_000 + n * 7_654_321).slice(0, 10)}`;
  const nombre = `Posición ${String(n).padStart(3, "0")} · ${NOMBRES[clase][n % NOMBRES[clase].length]}`;
  return {
    clase,
    celdas: [
      { texto: nombre, apunte: isin },
      n % 9 === 0 ? "USD" : "EUR",
      importe(valor),
      peso(valor / 201_298),
      /* Una de cada veintitrés no tiene precio de compra: su resultado latente falta, y se dice. */
      n % 23 === 0 ? null : conSigno(importe(latente, { conSigno: true }), latente, 2)
    ]
  };
}

const posicionesAlDetalle: SeccionDeInforme<DatosDeMuestra> = {
  id: "posiciones",
  titulo: "Posiciones al detalle",
  procedencia: "Valoradas al cierre del 13/11/2026, en euros",
  comienzo: "nueva",
  procede: (datos) => datos.posiciones > 0,
  Contenido: ({ datos }) => {
    const filas: FilaDeTabla[] = [];
    let claseAnterior = "";
    for (let n = 1; n <= datos.posiciones; n += 1) {
      const { clase, celdas } = posicion(n);
      if (clase !== claseAnterior) filas.push({ grupo: clase });
      claseAnterior = clase;
      filas.push({ celdas });
    }
    return (
      <Tabla
        columnas={[{ titulo: "Denominación", ancho: 3.4 }, { titulo: "Divisa", ancho: 0.7 }, { titulo: "Valor", ancho: 1.2, cifra: true }, { titulo: "Peso", ancho: 0.8, cifra: true }, { titulo: "Resultado latente", ancho: 1.3, cifra: true }]}
        filas={filas}
        total={[`Total, ${numero(datos.posiciones)} posiciones`, "", importe(201_298), peso(1), conSigno(importe(12_406.55, { conSigno: true }), 1, 2)]}
      />
    );
  }
};

const ANCHAS: Array<[string, string, string, number, number, number, number, number, number]> = [
  ["Acciones Europa", "LU0996182563", "Renta variable", 182.4512, 135.08, 24_646.53, 0.1224, 2_310.4, 0.0012],
  ["Acciones EE. UU.", "IE00B5BMR087", "Renta variable", 41.0731, 535.02, 21_975.02, 0.1092, 3_402.88, 0.0007],
  ["Emergentes Asia", "LU0048597586", "Renta variable", 512.0, 31.7745, 16_268.54, 0.0808, -642.1, 0.0165],
  ["Dividendo global", "IE00B8KGV557", "Renta variable", 1_051.0, 12.448, 13_082.85, 0.065, 905.25, 0.0038],
  ["Deuda pública euro", "LU0290355717", "Renta fija", 98.5, 241.36, 23_773.96, 0.1181, -221.4, 0.0015],
  ["Crédito grado de inversión", "IE00B3F81R35", "Renta fija", 210.25, 108.92, 22_900.43, 0.1138, 640.0, 0.002],
  ["Bonos ligados a la inflación", "LU1650491282", "Renta fija", 140.0, 113.5, 15_890.0, 0.0789, 118.9, 0.0025],
  ["Monetario euro", "FR0010510800", "Monetario", 186.0, 105.48, 19_619.28, 0.0975, 402.11, 0.001],
  ["Retorno absoluto", "LU0256839860", "Alternativos", 64.3, 199.12, 12_803.42, 0.0636, -88.3, 0.0124]
];

const posicionesAnchas: SeccionDeInforme<DatosDeMuestra> = {
  id: "posiciones-con-sus-datos",
  titulo: "Posiciones con todos sus datos",
  procedencia: "Precios al 13/11/2026; costes corrientes según el último documento de datos fundamentales",
  apaisada: true,
  procede: () => true,
  Contenido: () => (
    <Tabla
      columnas={[
        { titulo: "Activo", ancho: 2.6 },
        { titulo: "Clase", ancho: 1.3 },
        { titulo: "Títulos", ancho: 1, cifra: true },
        { titulo: "Precio", ancho: 1, cifra: true },
        { titulo: "Valor", ancho: 1.2, cifra: true },
        { titulo: "Peso", ancho: 0.75, cifra: true },
        { titulo: "Resultado latente", ancho: 1.25, cifra: true },
        { titulo: "Coste corriente", ancho: 1, cifra: true }
      ]}
      filas={ANCHAS.map(([nombre, isin, clase, cantidad, precioUnitario, valor, pesoEnCartera, latente, coste]) => ({
        celdas: [
          { texto: nombre, apunte: isin },
          clase,
          titulos(cantidad),
          precio(precioUnitario),
          importe(valor),
          peso(pesoEnCartera),
          conSigno(importe(latente, { conSigno: true }), latente, 2),
          porcentaje(coste)
        ]
      }))}
      total={["Total", "", "", "", importe(170_960.03), peso(0.8493), conSigno(importe(6_827.74, { conSigno: true }), 1, 2), ""]}
    />
  )
};

const reparto: SeccionDeInforme<DatosDeMuestra> = {
  id: "reparto",
  titulo: "Reparto por clase de activo",
  procedencia: "Sobre el patrimonio del 13/11/2026",
  apaisada: true,
  procede: () => true,
  juntoAlTitulo: 120,
  Contenido: () => (
    <>
      <ListaDePartes
        partes={[
          { nombre: "Renta variable", fraccion: 0.482, cifra: peso(0.482) },
          { nombre: "Renta fija", fraccion: 0.315, cifra: peso(0.315) },
          { nombre: "Monetario", fraccion: 0.098, cifra: peso(0.098) },
          { nombre: "Alternativos", fraccion: 0.064, cifra: peso(0.064) },
          { nombre: "Liquidez", fraccion: 0.041, cifra: peso(0.041), color: SERIES.referencia }
        ]}
      />
      <Aviso>Dos posiciones no tienen precio desde el 07/11/2026: se valoran a su último precio conocido.</Aviso>
      <AvisoLegal />
    </>
  )
};

export const SECCIONES_DE_MUESTRA: readonly SeccionDeInforme<DatosDeMuestra>[] = [presentacion, evolucion, resultado, posicionesAlDetalle, posicionesAnchas, reparto];

/* ------------------------------------------------------------------------------------------------ El documento */

export function DocumentoDeMuestra({ datos, identidad = IDENTIDAD_DE_MUESTRA, secciones = SECCIONES_DE_MUESTRA }: { datos: DatosDeMuestra; identidad?: IdentidadDelAsesor; secciones?: readonly SeccionDeInforme<DatosDeMuestra>[] }) {
  return (
    <DocumentoDeInforme
      tema={datos.tema}
      documento="Informe de cartera"
      titulo={`Informe de cartera - ${datos.cliente}`}
      asunto={datos.tema === "cliente" ? "Informe de la cartera para el cliente" : "Informe de trabajo del asesor"}
      identidad={identidad}
      destinatario={datos.cliente}
    >
      <HojasDeSecciones secciones={secciones} datos={datos} />
    </DocumentoDeInforme>
  );
}

/** El PDF de la muestra, en bytes. */
export async function generarMuestra(tema: TemaDeInforme, opciones: { identidad?: IdentidadDelAsesor; posiciones?: number; secciones?: readonly SeccionDeInforme<DatosDeMuestra>[] } = {}): Promise<Buffer> {
  const datos = datosDeMuestra(tema, opciones.posiciones);
  const blob = await renderizarInforme(<DocumentoDeMuestra datos={datos} identidad={opciones.identidad ?? IDENTIDAD_DE_MUESTRA} secciones={opciones.secciones} />);
  return Buffer.from(await blob.arrayBuffer());
}
