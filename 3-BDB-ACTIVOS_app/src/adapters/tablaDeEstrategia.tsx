import { Cifra } from "../components/ui/Cifra";
import { Distintivo, type TonoDeDistintivo } from "../components/ui/Distintivo";
import { regionDeEstrategia } from "../core/textoDeEstrategia";
import { textoDeAusencia } from "../core/textoDeAusencia";
import type { ColumnaDeTabla, FilaAgrupable } from "../types/tablaDeDatos";
import type { AssetClassWeight, RegionWeight, SectorWeight } from "../types/weeklyReport";

/**
 * Las tres tablas de Estrategia, con la pieza en vez de a mano.
 *
 * Las tres dicen lo mismo con otro nombre —un segmento, su peso y la visión del comité
 * sobre él—, y las tres estaban escritas por separado. Aquí se declaran una vez y se
 * parametriza lo que cambia: cómo se llama la primera columna, si hay uno o dos pesos y
 * si hay justificación.
 *
 * Dos cosas que conviene no perder al tocarlas:
 *
 * - **Un peso se escribe con un decimal**, como en toda la aplicación (apartado 6 de
 *   `SISTEMA_DISENO.md`): «45,0 %», «42,5 %». Antes cada columna elegía sus decimales
 *   mirando sus filas, y la misma tabla enseñaba «45 %» en una columna y «45,0 %» en la
 *   de al lado.
 * - **La visión no es texto, es un distintivo**, y con el color de su sentido: «Positiva» en
 *   verde (`favorable`), «Negativa» en rojo (`desfavorable`), «Neutral» en gris. Hasta el
 *   14-11-2026 iba sin color (ACT-15); ese día Óscar pidió recuperar el color que tenía antes
 *   del rediseño («le faltan colores en general»), y el verde y el rojo dicen también el sentido
 *   de una opinión, no solo lo que se gana o se pierde. La palabra sigue escrita: el color
 *   refuerza, no sustituye; y la columna se ordena por ella.
 */

export type VisionDelComite = "Positiva" | "Neutral" | "Negativa";

const TONO_DE_LA_VISION: Record<VisionDelComite, TonoDeDistintivo> = {
  Positiva: "favorable",
  Neutral: "neutro",
  Negativa: "desfavorable"
};

export interface FilaDeSegmento extends FilaAgrupable {
  nombre: string;
  /** El peso principal, en por ciento (no en tanto por uno). */
  peso: number;
  /** El segundo peso, cuando la tabla enfrenta el peso estratégico contra el táctico. */
  pesoTactico?: number;
  vision: VisionDelComite;
  justificacion?: string;
}

export function filasDeRegiones(regiones: RegionWeight[]): FilaDeSegmento[] {
  return regiones.map((r) => ({
    id: regionDeEstrategia(r.region),
    nombre: regionDeEstrategia(r.region),
    peso: r.weight,
    vision: r.view,
    justificacion: r.rationale
  }));
}

export function filasDeSectores(sectores: SectorWeight[]): FilaDeSegmento[] {
  return sectores.map((s) => ({ id: s.sector, nombre: s.sector, peso: s.weight, vision: s.view }));
}

export function filasDeClases(clases: AssetClassWeight[]): FilaDeSegmento[] {
  return clases.map((c) => ({
    id: c.assetClass,
    nombre: c.assetClass,
    peso: c.strategicWeight,
    pesoTactico: c.tacticalWeight,
    vision: c.view,
    justificacion: c.rationale
  }));
}

export interface OpcionesDeSegmentos {
  /** «Zona», «Sector», «Clase»: cada tabla llama distinto a lo mismo. */
  columnaDelNombre: string;
  /** «Peso», o «Estratégica» cuando hay dos. */
  columnaDelPeso: string;
  /** El título de la segunda columna de peso; sin él, no hay segunda. */
  columnaDelPesoTactico?: string;
  /** El título de la justificación; sin él, no se pinta esa columna. */
  columnaDeLaJustificacion?: string;
  /** Lo que se escribe cuando una fila no trae justificación propia. */
  justificacionPorDefecto?: string;
}

/* El peso llega en por ciento (45, no 0,45). */
const celdaDePeso = (peso: number) => ({ texto: "", valor: peso, nodo: <Cifra tipo="peso" valor={peso / 100} /> });

export function columnasDeSegmentos(
  _filas: FilaDeSegmento[],
  o: OpcionesDeSegmentos
): ColumnaDeTabla<FilaDeSegmento>[] {
  const columnas: ColumnaDeTabla<FilaDeSegmento>[] = [
    {
      id: "nombre",
      titulo: o.columnaDelNombre,
      encabezaFila: true,
      celda: (fila) => ({ texto: fila.nombre, valor: fila.nombre })
    },
    {
      id: "peso",
      titulo: o.columnaDelPeso,
      cifra: true,
      celda: (fila) => celdaDePeso(fila.peso)
    }
  ];

  if (o.columnaDelPesoTactico) {
    columnas.push({
      id: "peso-tactico",
      titulo: o.columnaDelPesoTactico,
      cifra: true,
      celda: (fila) =>
        fila.pesoTactico == null
          ? { texto: textoDeAusencia("falta", { estrecha: true }), ausencia: "falta" }
          : celdaDePeso(fila.pesoTactico)
    });
  }

  columnas.push({
    id: "vision",
    titulo: "Visión",
    celda: (fila) => ({
      texto: fila.vision,
      valor: fila.vision,
      /* Una visión que no es ninguna de las tres (el comité escribe texto libre) va en gris. */
      nodo: <Distintivo tono={TONO_DE_LA_VISION[fila.vision] ?? "neutro"}>{fila.vision}</Distintivo>
    })
  });

  if (o.columnaDeLaJustificacion) {
    columnas.push({
      id: "justificacion",
      titulo: o.columnaDeLaJustificacion,
      celda: (fila) => {
        const texto = fila.justificacion ?? o.justificacionPorDefecto;
        /* Sin justificación y sin texto por defecto no se escribe nada: un hueco
           vacío aquí es honesto, porque el comité no siempre razona cada línea. */
        return texto ? { texto, valor: texto } : { texto: "", valor: "" };
      }
    });
  }

  return columnas;
}
