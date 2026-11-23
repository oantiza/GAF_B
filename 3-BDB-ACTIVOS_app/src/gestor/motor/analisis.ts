/**
 * El análisis de una cartera entre dos fechas: TODO lo que la pantalla y los informes
 * enseñan sale de aquí. La pantalla no calcula y los informes tampoco: leen un `Analisis`.
 *
 * Dos pasos, para no repetir lo caro:
 *   1. `preparar`  valora la cartera día a día hasta una fecha (lo caro; una vez por cartera).
 *   2. `analizar`  saca de esa valoración las cifras de un periodo (barato; cada vez que cambia el periodo).
 */
import { calendarioDelBono, cuponCorrido } from "./bonos";
import { componer, type Composicion, type FichaDeActivo } from "./composicion";
import { CERO, aNumero, type Decimal } from "./decimal";
import { desgloseDelPeriodo, type Desglose } from "./desglose";
import { DIAS_POR_ANIO, diasEntre, fechaEnTexto, finDelAnioAnterior, sumarAnios, sumarDias, type Dia } from "./fechas";
import { comprobarIntegridad, type Integridad } from "./integridad";
import { cuentasA, posicionesDe, type Apunte, type Lote } from "./libro";
import type { Activo, Cartera } from "./modelo";
import { rentabilidadDelPeriodo, rentabilidadPorMeses, serieBase100, tramoDe, type Periodo, type RentabilidadDelAnio, type RentabilidadDelPeriodo } from "./rentabilidad";
import { riesgoDeLaSerie, type Riesgo } from "./riesgo";
import { rentabilidadesDeLosUltimosAnios, type RentabilidadDeLosUltimosAnios } from "./ultimosAnios";
import { FUENTE, ultimoHasta, valorar, type DatosDeMercado, type FuenteDelPrecio, type Punto, type Valoracion } from "./valoracion";

export interface Preparado {
  cartera: Cartera;
  mercado: DatosDeMercado;
  fichas: ReadonlyMap<string, FichaDeActivo>;
  valoracion: Valoracion;
  /** Último día valorado. */
  hasta: Dia;
}

export function preparar(cartera: Cartera, mercado: DatosDeMercado, fichas: ReadonlyMap<string, FichaDeActivo>, hasta: Dia): Preparado {
  return { cartera, mercado, fichas, valoracion: valorar(cartera, mercado, { hasta }), hasta };
}

export type IdDePeriodo = "anio" | "1a" | "3a" | "inicio" | "libre";

export interface PeriodoHabitual {
  id: IdDePeriodo;
  nombre: string;
  periodo: Periodo;
  /** Si la cartera tiene historia suficiente para este periodo. */
  disponible: boolean;
}

/** Los periodos que ofrece la pantalla, a una fecha. `inicio` es la víspera del primer movimiento. */
export function periodosHabituales(valoracion: Valoracion, hasta: Dia): PeriodoHabitual[] {
  const primero = valoracion.dias[0];
  const vispera = primero ? sumarDias(primero, -1) : hasta;
  const con = (id: IdDePeriodo, nombre: string, desde: Dia): PeriodoHabitual => ({
    id,
    nombre,
    periodo: { desde: desde < vispera ? vispera : desde, hasta },
    disponible: primero !== undefined && desde >= vispera && desde < hasta
  });
  return [
    { ...con("anio", "Año en curso", finDelAnioAnterior(hasta)), disponible: primero !== undefined && primero <= hasta },
    con("1a", "1 año", sumarAnios(hasta, -1)),
    con("3a", "3 años", sumarAnios(hasta, -3)),
    { id: "inicio", nombre: "Desde el inicio", periodo: { desde: vispera, hasta }, disponible: primero !== undefined && primero <= hasta }
  ];
}

/**
 * La fecha con la que se ROTULA el inicio del periodo, la misma en la pantalla y en los informes
 * (decisión de la dirección, 13-11-2026; MOT-09 y DIR-08). Es la fecha desde la que se mide: el
 * cierre del día anterior al primer día del periodo («del 31/12/2025» en el año en curso). Si la
 * cartera empieza después, la de su primer movimiento, no su víspera. Solo es el rótulo: el cálculo
 * sigue midiendo desde `analisis.periodo.desde`.
 */
export function fechaDeInicioDelPeriodo(analisis: Pick<Analisis, "periodo" | "valoracion">): Dia {
  const primero = analisis.valoracion.dias[0];
  return primero !== undefined && analisis.periodo.desde < primero ? primero : analisis.periodo.desde;
}

/**
 * UNA POSICIÓN SIN PRECIO (decisión de Óscar del 20-11-2026). Si a la fecha no tiene ningún precio —ni serie, ni operación,
 * ni precio a mano, ni extracto: `fuente` es `FUENTE.sinPrecio`—, su valor NO SE CONOCE, y aquí no se da: `precio`, `valor`,
 * `peso`, `latente`, `latentePct`, `resultadoDelPeriodo` y `contribucion` son `null`. Antes eran 0, 0, 0, −coste, −100 %,
 * −lo pagado y los puntos de haberlo perdido: una posición comprada por 1.000 € salía como perdida entera. El motor la sigue
 * contando como cero en el patrimonio y en la rentabilidad (`valoracion.ts`): por eso el patrimonio no la incluye, y
 * `Analisis.sinPrecio` dice cuáles son para que cada total lo diga (`sinPrecio.ts`). Va igual la que tiene precio y está en
 * otra divisa sin tipo de cambio a la fecha (22-11-2026): sin cambio no tiene valor en la base, y su fuente es también
 * `FUENTE.sinPrecio`.
 */
export interface PosicionAnalizada {
  activo: Activo;
  /** Títulos exactos, del libro. */
  titulos: Decimal;
  /** Precio con el que se valora, en la divisa del activo. `null` si no tiene ninguno a la fecha. */
  precio: number | null;
  fuente: FuenteDelPrecio;
  /** Días que tiene el precio. Cero si no hay precio: no dice nada. */
  antiguedad: number;
  /** Valor a la fecha, en la divisa base. `null` si no tiene precio. */
  valor: number | null;
  /** Peso sobre el patrimonio, de 0 a 1. `null` si no tiene precio. */
  peso: number | null;
  /** Coste de lo que queda (FIFO), en la divisa base. `null` si falta un cambio para conocerlo. */
  coste: number | null;
  /** Precio medio de compra por título, en la divisa del activo, si se conoce. */
  precioMedio: number | null;
  /** Resultado latente: valor − coste. `null` si falta el coste o el precio. */
  latente: number | null;
  latentePct: number | null;
  /** Fecha del lote más antiguo. */
  desde: Dia;
  lotes: Lote[];
  /**
   * Del periodo: resultado (precio + divisa + ingresos − costes), ingresos cobrados y contribución a la rentabilidad. El
   * resultado y la contribución son `null` si no tiene precio: salen de su valor, que no se conoce. Los ingresos son dinero
   * cobrado, y se dan siempre.
   */
  resultadoDelPeriodo: number | null;
  ingresosDelPeriodo: number;
  contribucion: number | null;
}

export interface EfectivoAnalizado {
  porDivisa: Array<{ divisa: string; saldo: Decimal; valor: number; enTransito: Decimal }>;
  total: number;
  peso: number;
  /** Efectivo de traspasos en curso, ya incluido en el total. */
  enTransito: number;
}

export interface PosicionCerrada {
  activo: Activo | undefined;
  activoId: string;
  titulos: number;
  coste: number;
  cobrado: number;
  resultado: number;
  /** Resultado sobre el coste. `null` si no se conoce el coste. */
  resultadoPct: number | null;
  /** Primera compra y última venta de los tramos vendidos en el periodo. */
  primeraCompra: Dia;
  ultimaVenta: Dia;
  /** Si tras estas ventas ya no queda nada del activo a la fecha final. */
  cerradaDelTodo: boolean;
  incompleto: boolean;
}

export interface LineaDeIngreso {
  bruto: number;
  retencion: number;
  neto: number;
}

/**
 * Un coste del periodo, de un movimiento: un cargo del servicio (custodia, administración,
 * asesoramiento, otro cargo) o las comisiones y gastos de una operación. Un movimiento con
 * comisión y gastos da una sola línea con los dos. En la divisa base, al cambio del día.
 */
export interface CosteDeUnMovimiento {
  fecha: Dia;
  movimientoId: string;
  /** Clave del registro de tipos del movimiento («comision», «compra»…). */
  tipo: string;
  activoId?: string;
  /** El concepto para el cliente del movimiento, si el asesor lo escribió: el nombre del cargo en el informe de costes. */
  concepto?: string;
  nota?: string;
  importe: number;
}

/** Los gastos corrientes estimados de un fondo o ETF en el periodo. */
export interface GastosCorrientesDeUnProducto {
  activoId: string;
  nombre: string;
  /** Porcentaje anual publicado (0,01 = 1 %). */
  gastosCorrientes: number;
  /** Valor medio de la posición en los días del periodo. */
  valorMedio: number;
  /** valorMedio × gastosCorrientes × días / 365,2425. */
  coste: number;
}

export interface IngresosYCostes {
  dividendos: LineaDeIngreso;
  cupones: LineaDeIngreso;
  intereses: LineaDeIngreso;
  otros: LineaDeIngreso;
  /** Dividendos y cupones netos: los «ingresos» de la cartera. */
  ingresosNetos: number;
  /** Comisiones y gastos de compras y ventas (van dentro del precio pagado o cobrado). */
  costesDeOperacion: number;
  /** Comisiones y gastos cargados en la cuenta: custodia, asesoramiento, mantenimiento. */
  costesDelServicio: number;
  /** El detalle de `costesDelServicio`, cargo a cargo, por fecha: suma exactamente lo mismo. */
  cargosDelServicio: CosteDeUnMovimiento[];
  /** El detalle de `costesDeOperacion`, operación a operación, por fecha: suma exactamente lo mismo. */
  costesPorOperacion: CosteDeUnMovimiento[];
  /** Retenciones e impuestos: los de dentro de dividendos, cupones e intereses más los apuntados sueltos. */
  impuestos: number;
  /** La parte de `impuestos` apuntada aparte (retenciones de reembolsos, impuestos cargados en la cuenta). */
  impuestosApuntados: number;
  /** Gastos corrientes de los fondos (TER), estimados sobre el valor medio. Ya van descontados en su valor liquidativo. */
  gastosCorrientes: number | null;
  /** El detalle de `gastosCorrientes`, producto a producto, de más a menos coste: suma exactamente lo mismo. */
  porProducto: GastosCorrientesDeUnProducto[];
  /** Nombres de las posiciones del periodo cuyos gastos corrientes no se conocen (y no son una acción ni un bono). */
  productosSinGastosCorrientes: string[];
  /**
   * Nombres de los fondos y demás productos con gastos corrientes que no tienen precio a la fecha y no valieron nada en todo el
   * periodo: su valor medio es cero, así que no entran en la estimación ni en `coberturaDeGastosCorrientes`, y la cobertura no
   * los cuenta como cero sino que dice que faltan (`sinPrecio.ts`).
   */
  sinPrecioFueraDeLosGastosCorrientes: string[];
  /**
   * Nombres de los fondos y demás productos con gastos corrientes que tuvieron títulos sin valor (sin precio o sin cambio)
   * solo una parte del periodo: su coste corriente se estima con los días en que sí valieron, así que la cifra es parcial y
   * `gastosCorrientesCompletos` es `false` (H2-02, auditoría del 22-11-2026: un fondo de 100.000 € sin cambio 354 de 364
   * días daba 27 € de coste dado por completo, en vez de unos 1.000 €).
   */
  valoradosSoloParteDelPeriodo: string[];
  /**
   * Valor medio de los fondos, ETF y demás productos con gastos corrientes cuyo TER se conoce, sobre el valor medio de todos
   * ellos (0 a 1). Las acciones y los bonos no entran ni arriba ni abajo: no tienen gastos corrientes, y contarlos como
   * conocidos hacía pasar por casi completa una cartera de acciones con un fondo pequeño sin TER (P2-07, 22-11-2026). Los
   * productos sin precio tampoco entran (no se sabe lo que valen): los nombra `sinPrecioFueraDeLosGastosCorrientes`. Es 1
   * cuando no hay ninguno con valor que medir.
   */
  coberturaDeGastosCorrientes: number;
  /**
   * Si el coste corriente se conoce de todos los productos que lo tienen: `gastosCorrientes` no es `null` y no falta ninguno,
   * ni por no conocerse su TER ni por no tener precio. Sin umbral: un producto que falta, por pequeño que sea, falta.
   */
  gastosCorrientesCompletos: boolean;
  /** Patrimonio medio del periodo: la base de los porcentajes. */
  patrimonioMedio: number;
  /** Costes explícitos (operación + servicio) y totales (con gastos corrientes), sobre el patrimonio medio. */
  costesExplicitos: number;
  costesExplicitosPct: number | null;
  costesTotales: number;
  costesTotalesPct: number | null;
  ingresosPct: number | null;
}

export interface BonoAnalizado {
  activo: Activo;
  nominal: number;
  /**
   * Cupón corrido a la fecha, en la divisa del bono. `null` si el bono no tiene precio: desde la A-193 la posición vale cero
   * entero —no vale su cupón corrido—, y esta cifra no se da donde el valor no se conoce.
   */
  cuponCorrido: number | null;
  vencimiento: Dia;
  vencido: boolean;
  /** Próximos cobros en dos años: cupones y devolución del nominal, en la divisa del bono. */
  proximos: Array<{ fecha: Dia; clase: "cupon" | "vencimiento"; importe: number }>;
}

export interface ReferenciaDeEntrada {
  nombre: string;
  /** Serie del índice, ya en la divisa base de la cartera. */
  serie: Punto[];
}

export interface ReferenciaAnalizada {
  nombre: string;
  disponible: boolean;
  /** Por qué no se puede comparar, si no se puede. */
  motivo?: string;
  /** En base 100 desde el inicio del periodo, en los mismos días que la cartera. */
  serie: Punto[];
  rentabilidad: number | null;
  rentabilidadAnualizada: number | null;
  riesgo?: Riesgo;
  /** Rentabilidad de la cartera menos la del índice, en el periodo. */
  diferencia: number | null;
}

export interface Analisis {
  cartera: { id: string; nombre: string; divisaBase: string; cliente?: string };
  /** El periodo pedido y la fecha de las posiciones (su último día). */
  periodo: Periodo;
  fecha: Dia;
  /** Si la cartera tiene algún movimiento hasta la fecha. */
  vacia: boolean;
  valoracion: Valoracion;
  patrimonio: number;
  rentabilidad?: RentabilidadDelPeriodo;
  desglose?: Desglose;
  riesgo?: Riesgo;
  /** La cartera en base 100 desde el inicio del periodo. */
  serie: Punto[];
  /** Patrimonio y dinero aportado (valor inicial más aportaciones netas acumuladas) cada día del periodo. */
  evolucion: Array<{ fecha: Dia; valor: number; aportado: number }>;
  referencia?: ReferenciaAnalizada;
  /** Las posiciones a la fecha: primero las que tienen valor, de más a menos; al final, las que no tienen precio. */
  posiciones: PosicionAnalizada[];
  /** Las de `posiciones` que no tienen precio a la fecha: el patrimonio no las incluye, y su valor y su resultado no se conocen. */
  sinPrecio: PosicionAnalizada[];
  efectivo: EfectivoAnalizado;
  cerradas: PosicionCerrada[];
  /**
   * Resultado realizado en el periodo y latente a la fecha (FIFO). `null` si alguno no se puede conocer. El latente es el de
   * las posiciones que tienen precio —las de `sinPrecio` no lo tienen, y el total dice que no las incluye—; es `null` si a
   * alguna de ellas le falta el coste, o si ninguna tiene precio.
   */
  realizado: number | null;
  latente: number | null;
  ingresosYCostes: IngresosYCostes;
  composicion: Composicion;
  bonos: BonoAnalizado[];
  porMeses: RentabilidadDelAnio[];
  /** Último año, últimos 3 y últimos 5 años, de toda la historia hasta la fecha: no dependen del periodo, como `porMeses`. */
  ultimosAnios: RentabilidadDeLosUltimosAnios[];
  integridad: Integridad;
}

/** La serie de la cartera en base 100 de TODA su historia, desde la víspera del primer movimiento hasta `hasta`. */
export function serieDeTodaLaHistoria(valoracion: Valoracion, hasta: Dia): Punto[] {
  const primero = valoracion.dias[0];
  return primero === undefined ? [] : serieBase100(valoracion, { desde: sumarDias(primero, -1), hasta });
}

function lineaVacia(): LineaDeIngreso {
  return { bruto: 0, retencion: 0, neto: 0 };
}

export function analizar(preparado: Preparado, periodo: Periodo, referencia?: ReferenciaDeEntrada): Analisis {
  const { cartera, mercado, fichas, valoracion } = preparado;
  const hasta = periodo.hasta > preparado.hasta ? preparado.hasta : periodo.hasta;
  const porId = new Map(cartera.activos.map((activo) => [activo.id, activo]));
  const tramo = tramoDe(valoracion, periodo);
  const k = valoracion.indice.get(hasta) ?? (valoracion.dias.length > 0 && hasta > valoracion.dias[valoracion.dias.length - 1] ? valoracion.dias.length - 1 : -1);
  const patrimonio = k >= 0 ? valoracion.valor[k] : 0;

  const rentabilidad = rentabilidadDelPeriodo(valoracion, periodo);
  const desglose = desgloseDelPeriodo(valoracion, periodo);
  const serie = serieBase100(valoracion, periodo);
  const riesgo = serie.length > 1 ? riesgoDeLaSerie(serie, mercado.libreDeRiesgo) : undefined;
  const resultadoPorActivo = new Map((desglose?.posiciones ?? []).map((posicion) => [posicion.activoId, posicion]));

  /* Posiciones y efectivo a la fecha: del libro, exactos. */
  const libro = cuentasA(cartera, hasta, { cambio: (divisa, fecha) => {
    const enBase = valoracion.aBase(divisa, fecha);
    return enBase > 0 ? 1 / enBase : undefined;
  } });
  const posiciones: PosicionAnalizada[] = [];
  for (const enLibros of posicionesDe(libro.final)) {
    const activo = porId.get(enLibros.activoId);
    const serieDelActivo = valoracion.porActivo.get(enLibros.activoId);
    if (!activo || !serieDelActivo || k < 0) continue;
    const fuente = serieDelActivo.fuente[k] as FuenteDelPrecio;
    /* Sin precio no hay valor que dar (cabecera de `PosicionAnalizada`). Se mira la fuente, no si el valor es cero: una
       posición que vale cero porque su precio es cero sí tiene valor. */
    const valor = fuente === FUENTE.sinPrecio ? null : serieDelActivo.valor[k];
    const coste = enLibros.costeIncompleto ? null : aNumero(enLibros.costeBase);
    const titulos = aNumero(enLibros.titulos);
    const multiplicador = activo.multiplicador ? Number(activo.multiplicador) : 1;
    const delPeriodo = resultadoPorActivo.get(enLibros.activoId);
    posiciones.push({
      activo,
      titulos: enLibros.titulos,
      precio: valor === null ? null : serieDelActivo.precio[k],
      fuente,
      antiguedad: serieDelActivo.antiguedad[k],
      valor,
      peso: valor === null ? null : patrimonio !== 0 ? valor / patrimonio : 0,
      coste,
      precioMedio: enLibros.costeLocal && titulos > 0 ? aNumero(enLibros.costeLocal) / titulos / multiplicador : null,
      latente: coste === null || valor === null ? null : valor - coste,
      latentePct: coste === null || coste <= 0 || valor === null ? null : valor / coste - 1,
      desde: enLibros.desde,
      lotes: enLibros.lotes,
      resultadoDelPeriodo: valor === null ? null : delPeriodo?.resultado ?? 0,
      ingresosDelPeriodo: delPeriodo?.ingresos ?? 0,
      contribucion: valor === null ? null : delPeriodo?.contribucion ?? 0
    });
  }
  /* De más a menos valor; las que no tienen precio, al final y por su nombre: lo que falta no es el valor más bajo. */
  posiciones.sort((a, b) => {
    if (a.valor === null || b.valor === null) return a.valor === b.valor ? a.activo.nombre.localeCompare(b.activo.nombre, "es") : a.valor === null ? 1 : -1;
    return b.valor - a.valor;
  });
  const sinPrecio = posiciones.filter((posicion) => posicion.valor === null);

  const divisas = new Set([...libro.final.efectivo.keys(), ...libro.final.transito.keys()]);
  const porDivisa = [...divisas].map((divisa) => {
    const saldo = libro.final.efectivo.get(divisa) ?? CERO;
    const enTransito = libro.final.transito.get(divisa) ?? CERO;
    return { divisa, saldo, enTransito, valor: aNumero(saldo.plus(enTransito)) * valoracion.aBase(divisa, hasta) };
  }).filter((linea) => !linea.saldo.eq(0) || !linea.enTransito.eq(0));
  const totalDeEfectivo = porDivisa.reduce((suma, linea) => suma + linea.valor, 0);
  const efectivo: EfectivoAnalizado = {
    porDivisa,
    total: totalDeEfectivo,
    peso: patrimonio !== 0 ? totalDeEfectivo / patrimonio : 0,
    enTransito: porDivisa.reduce((suma, linea) => suma + aNumero(linea.enTransito) * valoracion.aBase(linea.divisa, hasta), 0)
  };

  /* Posiciones cerradas en el periodo: los tramos vendidos entre las dos fechas, por activo. */
  const desde = tramo?.desde ?? periodo.desde;
  const porActivoCerrado = new Map<string, PosicionCerrada>();
  let realizado: number | null = 0;
  for (const tramoVendido of valoracion.libro.realizados) {
    if (tramoVendido.fechaVenta <= desde || tramoVendido.fechaVenta > hasta) continue;
    const cerrada = porActivoCerrado.get(tramoVendido.activoId) ?? {
      activo: porId.get(tramoVendido.activoId),
      activoId: tramoVendido.activoId,
      titulos: 0,
      coste: 0,
      cobrado: 0,
      resultado: 0,
      resultadoPct: null,
      primeraCompra: tramoVendido.fechaCompra,
      ultimaVenta: tramoVendido.fechaVenta,
      cerradaDelTodo: !posiciones.some((posicion) => posicion.activo.id === tramoVendido.activoId),
      incompleto: false
    };
    cerrada.titulos += aNumero(tramoVendido.titulos);
    cerrada.coste += aNumero(tramoVendido.costeBase);
    cerrada.cobrado += aNumero(tramoVendido.cobradoBase);
    cerrada.resultado += aNumero(tramoVendido.resultado);
    cerrada.incompleto = cerrada.incompleto || tramoVendido.incompleto;
    if (tramoVendido.fechaCompra < cerrada.primeraCompra) cerrada.primeraCompra = tramoVendido.fechaCompra;
    if (tramoVendido.fechaVenta > cerrada.ultimaVenta) cerrada.ultimaVenta = tramoVendido.fechaVenta;
    porActivoCerrado.set(tramoVendido.activoId, cerrada);
  }
  const cerradas = [...porActivoCerrado.values()];
  for (const cerrada of cerradas) {
    cerrada.resultadoPct = cerrada.incompleto || cerrada.coste <= 0 ? null : cerrada.resultado / cerrada.coste;
    if (cerrada.incompleto) realizado = null;
    else if (realizado !== null) realizado += cerrada.resultado;
  }
  cerradas.sort((a, b) => b.resultado - a.resultado);
  /* El latente del conjunto es el de las posiciones que tienen precio: como el valor invertido, no incluye las que no lo
     tienen, y lo dice (`sinPrecio.ts`). Si a alguna con precio le falta el coste, no se da; y si ninguna tiene precio,
     tampoco: no hay nada que sumar, y un 0,00 € sería una cifra inventada. */
  const conPrecio = posiciones.filter((posicion) => posicion.valor !== null);
  const latente =
    conPrecio.some((posicion) => posicion.latente === null) || (conPrecio.length === 0 && posiciones.length > 0)
      ? null
      : conPrecio.reduce((suma, posicion) => suma + (posicion.latente ?? 0), 0);

  /* Ingresos y costes del periodo, de los apuntes. */
  const ingresos = { dividendo: lineaVacia(), cupon: lineaVacia(), interes: lineaVacia(), otro: lineaVacia() };
  /* Los costes se apuntan por movimiento: una compra con comisión y gastos es una sola línea. Los totales son la suma de sus líneas,
     en este mismo orden, para que el detalle de un informe sume exactamente su total. */
  const porMovimiento = (lineas: Map<string, CosteDeUnMovimiento>, apunte: Apunte, importe: number) => {
    const linea = lineas.get(apunte.movimiento.id);
    if (linea) linea.importe += importe;
    else lineas.set(apunte.movimiento.id, { fecha: apunte.fecha, movimientoId: apunte.movimiento.id, tipo: apunte.movimiento.tipo, activoId: apunte.movimiento.activoId, concepto: apunte.movimiento.conceptoCliente?.trim() || undefined, nota: apunte.movimiento.nota?.trim() || undefined, importe });
  };
  const deOperacion = new Map<string, CosteDeUnMovimiento>();
  const delServicio = new Map<string, CosteDeUnMovimiento>();
  let impuestosSueltos = 0;
  for (const apunte of valoracion.libro.apuntes) {
    if (apunte.fecha <= desde || apunte.fecha > hasta) continue;
    const efecto = apunte.efecto;
    if (efecto.clase === "ingreso") {
      const cambio = valoracion.aBase(efecto.divisa, apunte.fecha);
      const linea = ingresos[efecto.categoria];
      linea.bruto += aNumero(efecto.bruto) * cambio;
      linea.retencion += aNumero(efecto.retencion) * cambio;
      linea.neto += aNumero(efecto.neto) * cambio;
    } else if (efecto.clase === "coste") {
      const importe = aNumero(efecto.importe) * valoracion.aBase(efecto.divisa, apunte.fecha);
      if (efecto.categoria === "impuesto") impuestosSueltos += importe;
      else porMovimiento(efecto.yaDescontado ? deOperacion : delServicio, apunte, importe);
    }
  }
  const costesPorOperacion = [...deOperacion.values()];
  const cargosDelServicio = [...delServicio.values()];
  const costesDeOperacion = costesPorOperacion.reduce((suma, linea) => suma + linea.importe, 0);
  const costesDelServicio = cargosDelServicio.reduce((suma, linea) => suma + linea.importe, 0);

  let patrimonioMedio = 0;
  let conGastos = 0;
  let invertidoMedio = 0;
  const porProducto: GastosCorrientesDeUnProducto[] = [];
  const productosSinGastosCorrientes: string[] = [];
  const sinPrecioFueraDeLosGastosCorrientes: string[] = [];
  const valoradosSoloParteDelPeriodo: string[] = [];
  if (tramo) {
    const dias = tramo.i1 - tramo.i0;
    for (let i = tramo.i0 + 1; i <= tramo.i1; i += 1) patrimonioMedio += valoracion.valor[i];
    patrimonioMedio /= dias;
    for (const serieDelActivo of valoracion.porActivo.values()) {
      const activo = porId.get(serieDelActivo.activoId);
      /* Una acción o un bono no tienen gastos corrientes: no son parte de lo que se mide, ni como conocidos ni como
         desconocidos (P2-07: antes contaban como conocidos y tapaban un fondo sin TER). */
      const sinGastosPorNaturaleza = activo?.tipo === "ACCION" || activo?.tipo === "BONO";
      let medio = 0;
      /* Los días en que tuvo títulos y no tuvo valor (sin precio o sin cambio): su coste corriente de esos días no se puede
         estimar (H2-02). Antes solo se miraba si le faltaba el precio a la fecha final, y un fondo sin cambio casi todo el año,
         o vendido antes del final sin haber valido nada, daba un coste corriente parcial, o cero, como si fuera completo. */
      let diasSinValor = 0;
      for (let i = tramo.i0 + 1; i <= tramo.i1; i += 1) {
        medio += serieDelActivo.valor[i];
        if (serieDelActivo.titulos[i] > 0 && serieDelActivo.fuente[i] === FUENTE.sinPrecio) diasSinValor += 1;
      }
      medio /= dias;
      if (medio <= 0) {
        const posicion = sinPrecio.find((candidata) => candidata.activo.id === serieDelActivo.activoId);
        if ((posicion || diasSinValor > 0) && !sinGastosPorNaturaleza) sinPrecioFueraDeLosGastosCorrientes.push(activo?.nombre ?? posicion?.activo.nombre ?? serieDelActivo.activoId);
        continue;
      }
      if (diasSinValor > 0 && !sinGastosPorNaturaleza) valoradosSoloParteDelPeriodo.push(activo?.nombre ?? serieDelActivo.activoId);
      const ter = fichas.get(serieDelActivo.activoId)?.gastosCorrientes ?? (activo?.clasificacion?.gastosCorrientes ? Number(activo.clasificacion.gastosCorrientes) : undefined);
      if (ter !== undefined && Number.isFinite(ter)) {
        porProducto.push({ activoId: serieDelActivo.activoId, nombre: activo?.nombre ?? serieDelActivo.activoId, gastosCorrientes: ter, valorMedio: medio, coste: medio * ter * (dias / DIAS_POR_ANIO) });
        conGastos += medio;
        invertidoMedio += medio;
      } else if (!sinGastosPorNaturaleza) {
        productosSinGastosCorrientes.push(activo?.nombre ?? serieDelActivo.activoId);
        invertidoMedio += medio;
      }
    }
  }
  porProducto.sort((a, b) => b.coste - a.coste || a.nombre.localeCompare(b.nombre, "es"));
  const sumaDeLosProductos = porProducto.reduce((suma, producto) => suma + producto.coste, 0);
  /* No hay cifra si hay productos con gastos corrientes y de ninguno se conoce: ni su TER ni, sin precio, su valor. */
  const faltaAlguno = productosSinGastosCorrientes.length > 0 || sinPrecioFueraDeLosGastosCorrientes.length > 0 || valoradosSoloParteDelPeriodo.length > 0;
  const gastosCorrientes = porProducto.length === 0 && faltaAlguno ? null : sumaDeLosProductos;
  const gastosCorrientesCompletos = gastosCorrientes !== null && !faltaAlguno;
  const coberturaDeGastosCorrientes = invertidoMedio > 0 ? conGastos / invertidoMedio : 1;
  const impuestos = impuestosSueltos + ingresos.dividendo.retencion + ingresos.cupon.retencion + ingresos.interes.retencion;
  const costesExplicitos = costesDeOperacion + costesDelServicio;
  const ingresosNetos = ingresos.dividendo.neto + ingresos.cupon.neto;
  const sobreElMedio = (importe: number): number | null => (patrimonioMedio > 0 ? importe / patrimonioMedio : null);
  const ingresosYCostes: IngresosYCostes = {
    dividendos: ingresos.dividendo,
    cupones: ingresos.cupon,
    intereses: ingresos.interes,
    otros: ingresos.otro,
    ingresosNetos,
    costesDeOperacion,
    costesDelServicio,
    cargosDelServicio,
    costesPorOperacion,
    impuestos,
    impuestosApuntados: impuestosSueltos,
    gastosCorrientes,
    porProducto,
    productosSinGastosCorrientes,
    sinPrecioFueraDeLosGastosCorrientes,
    valoradosSoloParteDelPeriodo,
    coberturaDeGastosCorrientes,
    gastosCorrientesCompletos,
    patrimonioMedio,
    costesExplicitos,
    costesExplicitosPct: sobreElMedio(costesExplicitos),
    costesTotales: costesExplicitos + sumaDeLosProductos,
    costesTotalesPct: sobreElMedio(costesExplicitos + sumaDeLosProductos),
    ingresosPct: sobreElMedio(ingresosNetos)
  };

  /* Evolución del patrimonio frente a lo aportado. */
  const evolucion: Analisis["evolucion"] = [];
  if (tramo) {
    let aportado = tramo.i0 >= 0 ? valoracion.valor[tramo.i0] : 0;
    if (tramo.i0 >= 0) evolucion.push({ fecha: valoracion.dias[tramo.i0], valor: valoracion.valor[tramo.i0], aportado });
    for (let i = tramo.i0 + 1; i <= tramo.i1; i += 1) {
      aportado += valoracion.entradas[i] + valoracion.salidas[i];
      evolucion.push({ fecha: valoracion.dias[i], valor: valoracion.valor[i], aportado });
    }
  }

  const composicion = componer(
    /* Lo que no tiene precio no entra en ningún reparto: no hay valor que repartir. El resultado es el mismo que pasarlo con
       valor cero —un reparto ya descarta lo que no vale nada—; lo que cambia es que aquí no se inventa ese cero. */
    posiciones.flatMap((posicion) => (posicion.valor === null ? [] : [{ activo: posicion.activo, valor: posicion.valor }])),
    efectivo.porDivisa.map((linea) => ({ divisa: linea.divisa, valor: linea.valor })),
    fichas
  );

  const bonos: BonoAnalizado[] = posiciones
    .filter((posicion) => posicion.activo.bono)
    .map((posicion) => {
      const bono = posicion.activo.bono!;
      const nominal = aNumero(posicion.titulos);
      return {
        activo: posicion.activo,
        nominal,
        cuponCorrido: posicion.valor === null ? null : nominal * cuponCorrido(bono, hasta),
        vencimiento: bono.vencimiento,
        vencido: bono.vencimiento <= hasta,
        proximos: calendarioDelBono(bono, sumarDias(hasta, 1), sumarAnios(hasta, 2)).map((pago) => ({ fecha: pago.fecha, clase: pago.clase, importe: nominal * pago.fraccion }))
      };
    });

  return {
    cartera: { id: cartera.id, nombre: cartera.nombre, divisaBase: cartera.divisaBase, cliente: cartera.cliente?.nombre },
    periodo: { desde, hasta },
    fecha: hasta,
    vacia: valoracion.dias.length === 0 || k < 0,
    valoracion,
    patrimonio,
    rentabilidad,
    desglose,
    riesgo,
    serie,
    evolucion,
    referencia: referencia ? analizarReferencia(referencia, serie, rentabilidad, mercado.libreDeRiesgo) : undefined,
    posiciones,
    sinPrecio,
    efectivo,
    cerradas,
    realizado,
    latente,
    ingresosYCostes,
    composicion,
    bonos,
    porMeses: rentabilidadPorMeses(valoracion, hasta),
    ultimosAnios: rentabilidadesDeLosUltimosAnios(serieDeTodaLaHistoria(valoracion, hasta)),
    integridad: comprobarIntegridad(cartera, valoracion, hasta, mercado)
  };
}

/** Días que puede ir por detrás el último dato de la referencia respecto al final del periodo. El mismo plazo que el €STR y que un precio antiguo. */
export const RETRASO_MAXIMO_DE_LA_REFERENCIA = 7;

/**
 * Días naturales que pueden separar dos datos seguidos de la referencia, desde el que hace de punto de partida (el último en
 * o antes del inicio del periodo) hasta el último del periodo. Con más, no se compara y se dice entre qué fechas faltan
 * (decisión de Óscar del 20-11-2026; es lo que quedaba de GES-5). La misma regla y el mismo plazo que el €STR de la liquidez
 * (`HUECO_MAXIMO_DEL_ESTR`, en `referencia.ts`).
 *
 * POR QUÉ. El índice se arrastra plano donde no tiene dato, y eso falsea dos cosas distintas:
 *  - Si lo viejo es el punto de partida, su rentabilidad incluye lo que se movió ANTES del periodo: con el índice en 100 el
 *    2 de octubre, 112 el 5 de enero y 118 el 9 de febrero, un periodo desde el 31 de diciembre salía +18 % y la cartera
 *    «perdía» 8 puntos contra un tramo que no es suyo. Lo que hizo el índice desde el 31 de diciembre no se sabe.
 *  - Si el hueco está en medio, la rentabilidad del periodo no cambia, pero el camino sí: un índice que cae un 15 % y se
 *    recupera dentro del hueco sale sin esa caída, plano, y su volatilidad y su caída máxima —las que se leen junto a las
 *    de la cartera— quedan por debajo de lo que fueron.
 *
 * QUÉ DEJA FUERA, medido el 20-11-2026 sobre las series de la base: ninguna de las referencias de la lista —los tres índices,
 * los dos fondos de las carteras de referencia y sus fechas comunes, y el €STR— tiene dos datos a más de 7 días en toda su
 * historia. El mayor salto es de 7 días justos, que pasa: del 17 al 24 de junio de 2019, en el fondo de renta fija y en las
 * fechas comunes. Con «otro activo del catálogo» sí ocurre: doce fondos tienen en el último año un salto de 8 a 12 días
 * —ocho de China, Taiwán o Asia, de 10 a 12 días en febrero de 2026, las fechas del Año Nuevo chino, y cuatro españoles, de
 * 8 a 10 días en diciembre, febrero y abril—, y un periodo que lo cruce no se compara con ellos. En tres años son 36 fondos
 * y 4 acciones, y en cinco, 68 y 8; con un plazo de 14 días serían ninguno, 3 y 14. La causa de cada salto se dedujo de sus
 * fechas, sin contrastarla con el calendario de cada mercado. Óscar decidió el 20-11-2026 que se quedan los 7 días, iguales
 * que los del €STR (decisión A-198): los fondos que deja fuera rara vez sirven de referencia.
 *
 * LO QUE ESTA REGLA NO VE. Una cartera de referencia («perfil:…») llega aquí ya mezclada, con su primer dato fechado en el
 * inicio del periodo aunque el valor liquidativo de sus fondos sea de hasta 14 días antes: esa tolerancia es de la propia
 * mezcla (`ANTIGUEDAD_MAXIMA_DEL_PRIMER_DIA`, en `core/benchmarkProfiles.ts`; la misma que la simulación de una cartera), y
 * su punto de partida puede ser más viejo que los 7 días de aquí. Con las series de hoy no pasa: sus fondos no tienen
 * saltos de más de 7 días. Si las dos reglas deben valer lo mismo es una decisión abierta.
 */
export const HUECO_MAXIMO_DE_LA_REFERENCIA = 7;

/** El índice de referencia en base 100 sobre los mismos días que la cartera, con su rentabilidad y su riesgo. */
function analizarReferencia(referencia: ReferenciaDeEntrada, serieDeLaCartera: Punto[], rentabilidad: RentabilidadDelPeriodo | undefined, libreDeRiesgo: Punto[] | undefined): ReferenciaAnalizada {
  const sinDatos = (motivo: string): ReferenciaAnalizada => ({ nombre: referencia.nombre, disponible: false, motivo, serie: [], rentabilidad: null, rentabilidadAnualizada: null, diferencia: null });
  if (serieDeLaCartera.length < 2 || !rentabilidad) return sinDatos("La cartera no tiene historia en este periodo.");
  const inicio = ultimoHasta(referencia.serie, serieDeLaCartera[0].fecha);
  if (!inicio || inicio.valor <= 0) return sinDatos("El índice no tiene datos desde el inicio del periodo.");
  const ultimoDia = serieDeLaCartera[serieDeLaCartera.length - 1].fecha;
  const fin = ultimoHasta(referencia.serie, ultimoDia);
  if (!fin || fin.fecha <= inicio.fecha) return sinDatos("El índice no tiene datos dentro del periodo.");
  /* Auditoría 16-11-2026 (GES-5): un índice que acaba meses antes se arrastraba plano hasta el final y se comparaba como si estuviera
     al día (+1 % hasta febrero frente al +20 % de la cartera hasta junio: 19 puntos de diferencia que no existen). La misma regla
     que el €STR de la liquidez: atrasado más de una semana, no hay comparación y se dice hasta dónde llega. */
  if (diasEntre(fin.fecha, ultimoDia) > RETRASO_MAXIMO_DE_LA_REFERENCIA) {
    return sinDatos(`El índice llega hasta el ${fechaEnTexto(fin.fecha)}: está atrasado para este periodo.`);
  }
  /* Los huecos (`HUECO_MAXIMO_DE_LA_REFERENCIA`): cada par de datos seguidos, desde el punto de partida hasta el último
     del periodo. El primer par puede empezar antes del periodo: es el que dice lo viejo que es el punto de partida. El
     motivo dice el porqué y nada más: quien lo enseña ya dice que no se compara (el informe del asesor lo antepone). */
  let previo = inicio;
  for (const punto of referencia.serie) {
    if (punto.fecha <= inicio.fecha) continue;
    if (punto.fecha > ultimoDia) break;
    const dias = diasEntre(previo.fecha, punto.fecha);
    if (dias > HUECO_MAXIMO_DE_LA_REFERENCIA) {
      return sinDatos(`El índice no tiene datos entre el ${fechaEnTexto(previo.fecha)} y el ${fechaEnTexto(punto.fecha)}: son ${dias} días, y el máximo para compararlo son ${HUECO_MAXIMO_DE_LA_REFERENCIA}.`);
    }
    previo = punto;
  }
  const serie: Punto[] = [];
  let i = 0;
  let ultimo = inicio.valor;
  /* La serie del índice se recorre una vez, a la par que los días de la cartera. */
  for (const punto of serieDeLaCartera) {
    while (i < referencia.serie.length && referencia.serie[i].fecha <= punto.fecha) {
      ultimo = referencia.serie[i].valor;
      i += 1;
    }
    serie.push({ fecha: punto.fecha, valor: (100 * ultimo) / inicio.valor });
  }
  const acumulada = serie[serie.length - 1].valor / 100 - 1;
  return {
    nombre: referencia.nombre,
    disponible: true,
    serie,
    rentabilidad: acumulada,
    rentabilidadAnualizada: rentabilidad.anualiza ? Math.pow(1 + acumulada, DIAS_POR_ANIO / rentabilidad.dias) - 1 : null,
    riesgo: riesgoDeLaSerie(serie, libreDeRiesgo),
    diferencia: rentabilidad.twr - acumulada
  };
}

export { FUENTE };
