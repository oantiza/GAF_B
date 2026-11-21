/**
 * Piezas que comparten los tipos de movimiento: lectura de campos, comprobaciones y los
 * dos moldes de los que salen varios tipos (adquirir títulos y desprenderse de ellos).
 * Un tipo nuevo puede usarlas o escribir sus efectos a mano: el libro no distingue.
 */
import { CERO, UNO, d, dOCero, dOpcional, esDecimal, type Decimal } from "../decimal";
import { esDia } from "../fechas";
import type { CampoDelTipo, ContextoDeMovimiento, DefinicionDeMovimiento, Efecto, GrupoDeMovimiento } from "../efectos";
import { divisaDelEfectivo, type Activo, type Movimiento } from "../modelo";

/** Los campos decimales de un movimiento, para comprobar su forma de una vez. */
const CAMPOS_DECIMALES = ["titulos", "precio", "importe", "comision", "gastos", "retencion", "cuponCorrido", "cambio", "valor", "razon"] as const;

/** Comprobaciones que valen para cualquier tipo: fechas y forma de los números. */
export function erroresDeForma(movimiento: Movimiento): string[] {
  const errores: string[] = [];
  if (!esDia(movimiento.fechaOperacion)) errores.push("La fecha de operación no es válida.");
  if (movimiento.fechaValor !== undefined && !esDia(movimiento.fechaValor)) errores.push("La fecha valor no es válida.");
  if (movimiento.fechaEx !== undefined) {
    if (!esDia(movimiento.fechaEx)) errores.push("La fecha ex-dividendo no es válida.");
    else if (esDia(movimiento.fechaOperacion) && movimiento.fechaEx > movimiento.fechaOperacion) errores.push("La fecha ex-dividendo no puede ser posterior a la del cobro.");
  }
  if (movimiento.destino?.fecha !== undefined && !esDia(movimiento.destino.fecha)) errores.push("La fecha de llegada no es válida.");
  for (const campo of CAMPOS_DECIMALES) {
    const valor = movimiento[campo];
    if (valor !== undefined && !esDecimal(valor)) errores.push(`El campo «${campo}» no es un número válido.`);
  }
  for (const campo of ["comision", "gastos", "retencion", "cuponCorrido"] as const) {
    const valor = movimiento[campo];
    if (valor !== undefined && esDecimal(valor) && d(valor).lt(0)) errores.push(`El campo «${campo}» no puede ser negativo: va ya incluido en el importe.`);
  }
  if (movimiento.cambio !== undefined && esDecimal(movimiento.cambio) && d(movimiento.cambio).lte(0)) {
    errores.push("El tipo de cambio tiene que ser mayor que cero.");
  }
  for (const campo of ["titulos", "precio", "importe"] as const) {
    const valor = movimiento.destino?.[campo];
    if (valor !== undefined && !esDecimal(valor)) errores.push(`El campo «${campo}» del destino no es un número válido.`);
  }
  return errores;
}

export function requiereActivo(movimiento: Movimiento, contexto: ContextoDeMovimiento, errores: string[]): Activo | undefined {
  if (!movimiento.activoId) {
    errores.push("Falta el activo.");
    return undefined;
  }
  const activo = contexto.activo(movimiento.activoId);
  if (!activo) errores.push("El activo del movimiento no está en la cartera.");
  return activo;
}

export function requierePositivo(valor: string | undefined, nombre: string, errores: string[]): void {
  if (valor === undefined || valor === "") errores.push(`Falta ${nombre}.`);
  else if (esDecimal(valor) && d(valor).lte(0)) errores.push(`${nombre[0].toUpperCase()}${nombre.slice(1)} tiene que ser mayor que cero.`);
}

/** El importe de efectivo tiene que existir y llevar el signo que pide el tipo. */
export function requiereImporte(movimiento: Movimiento, signo: -1 | 1 | "libre", errores: string[]): void {
  if (movimiento.importe === undefined || movimiento.importe === "") {
    errores.push("Falta el importe.");
    return;
  }
  if (!esDecimal(movimiento.importe)) return;
  const importe = d(movimiento.importe);
  if (signo === 1 && importe.lt(0)) errores.push("El importe tiene que ser positivo: es un abono en la cuenta de efectivo.");
  if (signo === -1 && importe.gt(0)) errores.push("El importe tiene que ser negativo: es un cargo en la cuenta de efectivo.");
  if (signo === "libre" && importe.eq(0)) errores.push("El importe no puede ser cero.");
}

export function multiplicadorDe(activo: Activo | undefined): Decimal {
  return activo?.multiplicador ? d(activo.multiplicador) : UNO;
}

/**
 * Títulos × precio × multiplicador, en la divisa del activo, llevado a la divisa del
 * efectivo del movimiento. Devuelve `undefined` si falta un dato o si hace falta un cambio
 * que el movimiento no trae.
 */
export function efectivoDeLosTitulos(movimiento: Movimiento, contexto: ContextoDeMovimiento): Decimal | undefined {
  const titulos = dOpcional(movimiento.titulos);
  const precio = dOpcional(movimiento.precio);
  const activo = contexto.activo(movimiento.activoId);
  if (!titulos || !precio || !activo) return undefined;
  const local = titulos.times(precio).times(multiplicadorDe(activo));
  const divisa = divisaDelEfectivo(movimiento, contexto.divisaBase);
  if (activo.divisa === divisa) return local;
  /* El cambio se expresa como divisa extranjera por 1 de base: solo resuelve el caso habitual,
     activo en divisa y efectivo en la base. */
  const cambio = dOpcional(movimiento.cambio);
  if (divisa === contexto.divisaBase && cambio && cambio.gt(0)) return local.div(cambio);
  return undefined;
}

/** Los costes explícitos que van dentro del importe de una compra o una venta. */
function costesIncluidos(movimiento: Movimiento, divisa: string): Efecto[] {
  const efectos: Efecto[] = [];
  const comision = dOCero(movimiento.comision);
  const gastos = dOCero(movimiento.gastos);
  if (comision.gt(0)) efectos.push({ clase: "coste", categoria: "comision", activoId: movimiento.activoId, divisa, importe: comision, yaDescontado: true });
  if (gastos.gt(0)) efectos.push({ clase: "coste", categoria: "gasto", activoId: movimiento.activoId, divisa, importe: gastos, yaDescontado: true });
  return efectos;
}

interface MoldeDeOperacion {
  tipo: string;
  nombre: string;
  grupo: GrupoDeMovimiento;
  descripcion: string;
  orden: number;
  /** Si el formulario ofrece el cupón corrido (bonos). */
  conCuponCorrido?: boolean;
  /** Si el formulario ofrece la retención (reembolsos de fondos, amortizaciones). */
  conRetencion?: boolean;
  rotuloDeTitulos?: string;
  /** El rótulo del precio: «Valor liquidativo» en un fondo. Si falta, el genérico («Precio por título»). */
  rotuloDePrecio?: string;
}

const CAMPOS_DE_OPERACION = (molde: MoldeDeOperacion, importe: string): CampoDelTipo[] => [
  { campo: "activo", obligatorio: true },
  { campo: "titulos", obligatorio: true, rotulo: molde.rotuloDeTitulos },
  { campo: "precio", obligatorio: false, rotulo: molde.rotuloDePrecio },
  { campo: "importe", obligatorio: true, rotulo: importe },
  { campo: "comision", obligatorio: false },
  { campo: "gastos", obligatorio: false },
  ...(molde.conCuponCorrido ? [{ campo: "cuponCorrido" as const, obligatorio: false }] : []),
  ...(molde.conRetencion ? [{ campo: "retencion" as const, obligatorio: false }] : []),
  { campo: "cambio", obligatorio: false },
  { campo: "fechaValor", obligatorio: false },
  { campo: "divisa", obligatorio: false }
];

/**
 * Molde de «entran títulos y sale efectivo»: compra y suscripción.
 * Efectivo: −importe. Valores: +títulos, con coste igual a todo lo pagado.
 */
export function definirAdquisicion(molde: MoldeDeOperacion): DefinicionDeMovimiento {
  return {
    tipo: molde.tipo,
    nombre: molde.nombre,
    grupo: molde.grupo,
    descripcion: molde.descripcion,
    orden: molde.orden,
    signoDelEfectivo: -1,
    campos: CAMPOS_DE_OPERACION(molde, "Importe pagado"),
    validar(movimiento, contexto) {
      const errores = erroresDeForma(movimiento);
      requiereActivo(movimiento, contexto, errores);
      requierePositivo(movimiento.titulos, "el número de títulos", errores);
      requiereImporte(movimiento, -1, errores);
      return errores;
    },
    efectos(movimiento, contexto) {
      const divisa = divisaDelEfectivo(movimiento, contexto.divisaBase);
      const importe = d(movimiento.importe!);
      return [
        { clase: "efectivo", divisa, importe },
        { clase: "alta", activoId: movimiento.activoId!, titulos: d(movimiento.titulos!), pagado: { divisa, importe: importe.abs() }, externo: false },
        ...costesIncluidos(movimiento, divisa)
      ];
    },
    importeSugerido(movimiento, contexto) {
      const titulos = efectivoDeLosTitulos(movimiento, contexto);
      if (!titulos) return undefined;
      return titulos.plus(dOCero(movimiento.comision)).plus(dOCero(movimiento.gastos)).plus(dOCero(movimiento.cuponCorrido)).times(-1);
    }
  };
}

/**
 * Molde de «salen títulos y entra efectivo»: venta, reembolso y amortización.
 * Valores: −títulos por FIFO. Efectivo: +importe. Si hay retención, lo obtenido por la
 * posición es el importe más la retención, y la retención es un impuesto aparte.
 */
export function definirEnajenacion(molde: MoldeDeOperacion): DefinicionDeMovimiento {
  return {
    tipo: molde.tipo,
    nombre: molde.nombre,
    grupo: molde.grupo,
    descripcion: molde.descripcion,
    orden: molde.orden,
    signoDelEfectivo: 1,
    campos: CAMPOS_DE_OPERACION(molde, "Importe cobrado"),
    validar(movimiento, contexto) {
      const errores = erroresDeForma(movimiento);
      requiereActivo(movimiento, contexto, errores);
      requierePositivo(movimiento.titulos, "el número de títulos", errores);
      requiereImporte(movimiento, 1, errores);
      return errores;
    },
    efectos(movimiento, contexto) {
      const divisa = divisaDelEfectivo(movimiento, contexto.divisaBase);
      const importe = d(movimiento.importe!);
      const retencion = dOCero(movimiento.retencion);
      const efectos: Efecto[] = [
        { clase: "efectivo", divisa, importe },
        { clase: "baja", activoId: movimiento.activoId!, titulos: d(movimiento.titulos!), cobrado: { divisa, importe: importe.plus(retencion) }, externo: false, realiza: true },
        ...costesIncluidos(movimiento, divisa)
      ];
      if (retencion.gt(0)) efectos.push({ clase: "coste", categoria: "impuesto", activoId: movimiento.activoId, divisa, importe: retencion, yaDescontado: false });
      return efectos;
    },
    importeSugerido(movimiento, contexto) {
      const titulos = efectivoDeLosTitulos(movimiento, contexto);
      if (!titulos) return undefined;
      return titulos
        .plus(dOCero(movimiento.cuponCorrido))
        .minus(dOCero(movimiento.comision))
        .minus(dOCero(movimiento.gastos))
        .minus(dOCero(movimiento.retencion));
    }
  };
}

/** Molde de «se cobra un ingreso de un activo»: dividendo y cupón. */
export function definirIngreso(molde: { tipo: string; nombre: string; descripcion: string; categoria: "dividendo" | "cupon"; orden: number }): DefinicionDeMovimiento {
  return {
    tipo: molde.tipo,
    nombre: molde.nombre,
    grupo: "ingresos",
    descripcion: molde.descripcion,
    orden: molde.orden,
    signoDelEfectivo: 1,
    campos: [
      { campo: "activo", obligatorio: true },
      { campo: "importe", obligatorio: true, rotulo: "Importe cobrado (neto)" },
      { campo: "retencion", obligatorio: false, ayuda: "Lo retenido antes del abono. El bruto es el importe más la retención." },
      { campo: "gastos", obligatorio: false },
      { campo: "cambio", obligatorio: false },
      { campo: "fechaValor", obligatorio: false },
      ...(molde.categoria === "dividendo"
        ? [{ campo: "fechaEx" as const, obligatorio: false, ayuda: "Solo hace falta si la posición cambió entre la fecha ex-dividendo y el cobro: el dividendo por título se calcula con los títulos de la víspera." }]
        : []),
      { campo: "divisa", obligatorio: false }
    ],
    validar(movimiento, contexto) {
      const errores = erroresDeForma(movimiento);
      requiereActivo(movimiento, contexto, errores);
      requiereImporte(movimiento, 1, errores);
      return errores;
    },
    efectos(movimiento, contexto) {
      const divisa = divisaDelEfectivo(movimiento, contexto.divisaBase);
      const neto = d(movimiento.importe!);
      const retencion = dOCero(movimiento.retencion);
      const gastos = dOCero(movimiento.gastos).plus(dOCero(movimiento.comision));
      const efectos: Efecto[] = [
        { clase: "efectivo", divisa, importe: neto },
        { clase: "ingreso", categoria: molde.categoria, activoId: movimiento.activoId, divisa, bruto: neto.plus(retencion).plus(gastos), retencion, neto }
      ];
      if (gastos.gt(0)) efectos.push({ clase: "coste", categoria: "gasto", activoId: movimiento.activoId, divisa, importe: gastos, yaDescontado: true });
      return efectos;
    }
  };
}

export { CERO };
