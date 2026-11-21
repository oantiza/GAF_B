/**
 * Las piezas pequeñas que comparten las pantallas del gestor: una métrica con su nota emergente en lenguaje llano, una
 * fila de dato y un aviso en una lista. No calculan nada, y escriben las cifras con la pieza común `Cifra`.
 */
import type { ReactNode } from "react";
import { Ausencia } from "../../components/ui/Ausencia";
import { Aviso } from "../../components/ui/Aviso";
import { Cifra } from "../../components/ui/Cifra";
import { NotaEmergente } from "../../components/ui/NotaEmergente";
import type { Analisis } from "../motor/analisis";
import type { Metrica } from "../motor/metricas/tipos";
import { notaDeLasCifrasQueLasCuentanComoCero } from "../motor/sinPrecio";
import { nombreDeMetrica } from "./textos";

/**
 * Las métricas que dicen si se gana o se pierde, y por eso van en verde o en rojo: un resultado, una rentabilidad y la
 * diferencia con la referencia. La caída máxima lleva su signo pero no color (apartado 4 de `SISTEMA_DISENO.md`).
 */
const CON_COLOR: ReadonlySet<string> = new Set([
  "rentabilidad",
  "rentabilidadAnualizada",
  "rentabilidadDelCliente",
  "resultado",
  "resultadoLatente",
  "resultadoRealizado",
  "diferenciaConLaReferencia",
  "rentabilidadUltimoAnio",
  "rentabilidadUltimos3Anios",
  "rentabilidadUltimos5Anios"
]);

/** El valor de una métrica para un análisis: la cifra con su formato y su color, o por qué no está. */
export function ValorDeMetrica({ metrica, analisis }: { metrica: Metrica; analisis: Analisis }) {
  const valor = metrica.valor(analisis);
  if (valor === null) return <Ausencia clase={metrica.noAplica?.(analisis) ? "no-aplica" : "falta"} motivo={metrica.motivoSinValor?.(analisis) ?? "Sin datos"} />;
  const color = CON_COLOR.has(metrica.id);
  switch (metrica.formato) {
    case "importe":
      return <Cifra colorDeSigno={color} conSigno={metrica.conSigno} divisa={analisis.cartera.divisaBase} tipo="importe" valor={valor} />;
    case "porcentaje":
      return color ? <Cifra tipo="rentabilidad" valor={valor} /> : <Cifra conSigno={metrica.conSigno} tipo="porcentaje" valor={valor} />;
    case "puntos":
      return <Cifra tipo="puntos" valor={valor} />;
    case "ratio":
      return <Cifra tipo="ratio" valor={valor} />;
  }
}

/**
 * Una métrica completa: rótulo, nota emergente y valor, en una fila con filete. Bajo la nota de la fila va la salvedad de
 * la cifra, si la tiene: lo que hay que saber para leerla («Cuenta Activo B como cero, porque no tiene precio.»).
 */
export function FilaDeMetrica({ metrica, analisis, nota }: { metrica: Metrica; analisis: Analisis; nota?: ReactNode }) {
  const nombre = nombreDeMetrica(metrica);
  /* Una cifra que no se da no lleva salvedad: su ausencia ya dice por qué. */
  const salvedad = metrica.valor(analisis) === null ? undefined : metrica.salvedad?.(analisis);
  return (
    <div className="rows__item gestor-fila">
      <span className="rows__label">
        {nombre} <NotaEmergente termino={nombre.toLowerCase()}>{metrica.ayuda}</NotaEmergente>
        {nota ? <span className="gestor-fila__nota">{nota}</span> : null}
        {salvedad ? <span className="gestor-fila__nota">{salvedad}</span> : null}
      </span>
      <span className="rows__value">
        <ValorDeMetrica analisis={analisis} metrica={metrica} />
      </span>
    </div>
  );
}

/**
 * La nota de un bloque cuyas cifras salen todas de la serie diaria del valor —un gráfico, una tabla de meses, el desglose
 * del resultado— cuando alguna posición no tiene precio: «Estas cifras cuentan Activo B como cero, porque no tiene
 * precio.». Nada si todas lo tienen.
 */
export function NotaDeLoContadoComoCero({ analisis }: { analisis: Pick<Analisis, "sinPrecio"> }) {
  const nota = notaDeLasCifrasQueLasCuentanComoCero(analisis);
  return nota ? <p className="cmp-note">{nota}</p> : null;
}

/**
 * Una fila de dato cualquiera: rótulo a la izquierda, valor a la derecha, filete debajo. Si la cifra es la de una métrica
 * y no se pinta con `FilaDeMetrica` —lleva otro rótulo, o dos cifras—, su `salvedad` va bajo la nota, como allí.
 */
export function FilaDeDato({ rotulo, children, nota, salvedad, total = false }: { rotulo: ReactNode; children: ReactNode; nota?: ReactNode; salvedad?: string; total?: boolean }) {
  return (
    <div className={total ? "rows__item gestor-fila gestor-fila--total" : "rows__item gestor-fila"}>
      <span className="rows__label">
        {rotulo}
        {nota ? <span className="gestor-fila__nota">{nota}</span> : null}
        {salvedad ? <span className="gestor-fila__nota">{salvedad}</span> : null}
      </span>
      <span className="rows__value">{children}</span>
    </div>
  );
}

const PALABRA = { error: "Error.", aviso: "Aviso.", nota: "Nota." } as const;

/**
 * Un aviso de una lista (`ul.gestor-avisos`), con la pieza común: su palabra escrita delante, nunca solo el color.
 *
 * Un error del libro va en ocre y no en rojo: el tono `error` de `Aviso` se anuncia siempre al aparecer, y estos ya
 * estaban al abrir la pantalla (no se gritan). Lo distingue su palabra, «Error.».
 */
export function LineaDeAviso({ gravedad, accion, children }: { gravedad: "error" | "aviso" | "nota"; accion?: ReactNode; children: ReactNode }) {
  return (
    <li>
      <Aviso accion={accion} tono={gravedad === "nota" ? "nota" : "aviso"} titulo={PALABRA[gravedad]}>
        {children}
      </Aviso>
    </li>
  );
}
