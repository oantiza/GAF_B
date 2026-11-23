/**
 * Una posición sin precio no tiene valor que dar (decisión de Óscar del 20-11-2026).
 *
 * Hasta ese día el análisis daba de ella 0 € de valor, 0 % de peso, −coste de resultado y −100 %: una posición comprada
 * por 1.000 € salía como perdida entera. Ahora su precio, su valor, su peso, su resultado —el latente y el del periodo— y
 * su contribución son `null` —la pantalla y los informes escriben «Falta el dato»—, y los totales que no la cuentan lo
 * dicen. El motor la sigue contando como cero en la serie diaria del valor, y por eso el resultado, la rentabilidad y el
 * riesgo de la cartera llevan una salvedad que lo dice: eso —que valga cero— no cambia aquí.
 *
 * Las cifras esperadas salen de las cuentas a mano escritas junto a cada una.
 */
import { describe, expect, test } from "vitest";
import { FUENTE, analizar, preparar, type Analisis } from "../../src/gestor/motor/analisis";
import { comprobarIntegridad } from "../../src/gestor/motor/integridad";
import { METRICAS, metrica } from "../../src/gestor/motor/metricas/registro";
import type { CondicionesDelBono } from "../../src/gestor/motor/modelo";
import {
  cuantasSinPrecio,
  listaDeLasSinPrecio,
  nombresDeLasSinPrecio,
  notaCortaDeLasSinPrecio,
  notaCortaDeLoContadoComoCero,
  notaDeLasCifrasQueLasCuentanComoCero,
  notaDeLasSinPrecio,
  notaDeLoContadoComoCero,
  salvedadParaVariasCifras
} from "../../src/gestor/motor/sinPrecio";
import { valorar, type DatosDeMercado } from "../../src/gestor/motor/valoracion";
import { activo, cartera, mov, serie, serieDiaria } from "./ayudas";

const TODO = { desde: "1900-01-01", hasta: "2100-01-01" };
const FIN = "2025-01-31";

/*
 * 3.000 € aportados el 02-01-2025.
 *   A, en euros: 10 títulos a 100 € el 02-01 (1.000 €). Su serie llega a 120 € el 31-01.
 *   B, una acción en dólares comprada el 03-01 pagando 1.000 € por 10 títulos, sin escribir el precio y sin serie. El precio
 *   de una operación pagada en otra divisa se deduce con el cambio de ese día (A-196), y el 03-01 no hay ninguno: el del
 *   dólar empieza el 04-01. Así que B no tiene NINGÚN precio. Su coste sí se sabe: los 1.000 € pagados.
 * A 31-01: efectivo 3.000 − 1.000 − 1.000 = 1.000 €; A vale 10 × 120 = 1.200 €; de B no se sabe.
 */
const A = activo("A");
const B = activo("B", "ACCION", "USD");
const MOVIMIENTOS = [
  mov("aportacion", "2025-01-02", { importe: "3000" }),
  mov("compra", "2025-01-02", { activoId: "A", titulos: "10", precio: "100", importe: "-1000" }),
  mov("compra", "2025-01-03", { activoId: "B", titulos: "10", importe: "-1000" })
];
const mercado: DatosDeMercado = {
  precios: new Map([["A", serie(["2025-01-02", 100], [FIN, 120])]]),
  /* 1,25 dólares por euro desde el 04-01, el día después de comprar B: sin cambio el día de la compra, su precio no se
     puede deducir de lo pagado (A-196). Desde ahí sí hay cambio: lo que falta es el precio. */
  cambios: new Map([["USD", serie(["2025-01-04", 1.25])]])
};
const analizada = (c: ReturnType<typeof cartera>, datos: DatosDeMercado = mercado): Analisis => analizar(preparar(c, datos, new Map(), FIN), TODO);
const de = (analisis: Analisis, id: string) => analisis.posiciones.find((posicion) => posicion.activo.id === id)!;

describe("una posición sin precio: lo que el análisis da de ella", () => {
  const analisis = analizada(cartera([A, B], MOVIMIENTOS));

  test("su precio, su valor, su peso y su resultado no se dan; su coste, sí", () => {
    const b = de(analisis, "B");
    expect(b.fuente).toBe(FUENTE.sinPrecio);
    expect(b.precio).toBeNull();
    expect(b.valor).toBeNull();
    expect(b.peso).toBeNull();
    /* Antes: −1.000 € y −100 %. */
    expect(b.latente).toBeNull();
    expect(b.latentePct).toBeNull();
    expect(b.coste).toBe(1000);
  });

  test("su resultado del periodo y su contribución tampoco se dan; lo cobrado, sí", () => {
    const b = de(analisis, "B");
    /* Antes: −1.000 € (lo pagado, como perdido) y −33,33 puntos (los 1.000 € sobre los 3.000 € de la cartera). */
    expect(b.resultadoDelPeriodo).toBeNull();
    expect(b.contribucion).toBeNull();
    expect(b.ingresosDelPeriodo).toBe(0);
    /* A sí: gana 200 €. El día 31 la cartera pasa de 2.000 € a 2.200 € (+10 %), todo de A, y venía de 3.000 € a 2.000 €
       (× 2/3): 10 % × 2/3 = 6,67 puntos, que es 200 / 3.000. */
    const a = de(analisis, "A");
    expect(a.resultadoDelPeriodo).toBeCloseTo(200, 9);
    expect(a.contribucion).toBeCloseTo(200 / 3000, 12);
  });

  test("las demás no cambian: A vale 1.200 €, gana 200 € sobre 1.000 € (+20 %)", () => {
    const a = de(analisis, "A");
    expect(a.precio).toBe(120);
    expect(a.valor).toBe(1200);
    expect(a.coste).toBe(1000);
    expect(a.latente).toBe(200);
    expect(a.latentePct).toBeCloseTo(0.2, 12);
  });

  test("el patrimonio es lo que se puede valorar: 1.200 € de A más 1.000 € de efectivo, sin B", () => {
    expect(analisis.patrimonio).toBe(2200);
    /* Y los pesos son sobre él: A, 1.200 / 2.200 = 6/11; el efectivo, 1.000 / 2.200 = 5/11. */
    expect(de(analisis, "A").peso).toBeCloseTo(6 / 11, 12);
    expect(analisis.efectivo.peso).toBeCloseTo(5 / 11, 12);
  });

  test("el análisis dice cuáles son, y van al final de las posiciones", () => {
    expect(analisis.posiciones.map((posicion) => posicion.activo.id)).toEqual(["A", "B"]);
    expect(analisis.sinPrecio.map((posicion) => posicion.activo.id)).toEqual(["B"]);
    expect(nombresDeLasSinPrecio(analisis)).toEqual(["Activo B"]);
  });

  test("el resultado latente del conjunto es el de las que tienen precio, y dice que no la incluye: +200 €, no −800 €", () => {
    /* Antes sumaba el −1.000 € de B: 200 − 1.000 = −800 €. Ahora es el de A, que es la única con precio. */
    expect(analisis.latente).toBeCloseTo(200, 9);
    const latente = metrica("resultadoLatente");
    expect(latente.valor(analisis)).toBeCloseTo(200, 9);
    expect(latente.motivoSinValor?.(analisis)).toBeUndefined();
    expect(latente.salvedad?.(analisis)).toBe("No incluye Activo B, que no tiene precio.");
  });

  test("si ninguna tiene precio, el latente del conjunto no se da: no hay nada que sumar", () => {
    /* Solo B: 1.000 € aportados y pagados por ella. Un 0,00 € de resultado latente sería una cifra inventada. */
    const soloB = analizada(cartera([B], [mov("aportacion", "2025-01-02", { importe: "1000" }), mov("compra", "2025-01-03", { activoId: "B", titulos: "10", importe: "-1000" })]));
    expect(soloB.latente).toBeNull();
    const latente = metrica("resultadoLatente");
    expect(latente.motivoSinValor?.(soloB)).toBe("Activo B no tiene precio: sin él no se conoce su resultado.");
    expect(latente.salvedad?.(soloB)).toBeUndefined();
  });

  test("el patrimonio lleva su salvedad, la misma frase en la pantalla, en el Excel y en el informe del asesor", () => {
    const patrimonio = metrica("patrimonio");
    expect(patrimonio.valor(analisis)).toBe(2200);
    expect(patrimonio.salvedad?.(analisis)).toBe("No incluye Activo B, que no tiene precio.");
    expect(notaDeLasSinPrecio(analisis)).toBe("No incluye Activo B, que no tiene precio.");
  });

  test("no está en ningún reparto de la composición, que es de lo que vale algo", () => {
    /* Esto ya era así cuando valía cero: un reparto no lista lo que no vale nada. La composición no la recibe —no hay
       valor que pasarle—, y para una acción o un fondo el resultado es el mismo de antes; el que cambia es el bono, que
       antes entraba con su cupón corrido (abajo, en su prueba). */
    expect(analisis.composicion.principales.map((posicion) => posicion.activoId)).toEqual(["A"]);
    /* Lo repartido es lo que vale: 1.200 € de A y 1.000 € de efectivo, y ninguna línea en dólares. */
    expect(analisis.composicion.porTipoDeProducto.total).toBe(2200);
    expect(analisis.composicion.porDivisa.lineas.map((linea) => linea.nombre)).toEqual(["EUR"]);
  });

  test("el orden: primero las que tienen valor, de más a menos; después las que no tienen precio, por su nombre", () => {
    /*
     * Cinco posiciones, apuntadas en este orden: U, sin precio, la primera; Z, 10 títulos a 10 € cuya serie acaba en 0 €
     * (tiene precio, y vale 0,00 €); A, que vale 1.200 €; y C y B, sin precio, la C antes que la B. Un orden que tratase
     * lo que falta como un cero dejaría a U delante de Z, y uno sin desempate, a C delante de B.
     */
    const [U, Z, C] = [activo("U", "ACCION", "USD"), activo("Z"), activo("C", "ACCION", "USD")];
    const conCinco = analizada(
      cartera(
        [U, Z, A, C, B],
        [
          mov("aportacion", "2025-01-02", { importe: "5000" }),
          mov("compra", "2025-01-02", { activoId: "U", titulos: "10", importe: "-500" }),
          mov("compra", "2025-01-02", { activoId: "Z", titulos: "10", precio: "10", importe: "-100" }),
          mov("compra", "2025-01-02", { activoId: "A", titulos: "10", precio: "100", importe: "-1000" }),
          mov("compra", "2025-01-03", { activoId: "C", titulos: "10", importe: "-100" }),
          mov("compra", "2025-01-03", { activoId: "B", titulos: "10", importe: "-100" })
        ]
      ),
      { ...mercado, precios: new Map([...mercado.precios, ["Z", serie(["2025-01-02", 10], [FIN, 0])]]) }
    );
    expect(conCinco.posiciones.map((posicion) => posicion.activo.id)).toEqual(["A", "Z", "B", "C", "U"]);
    expect(conCinco.sinPrecio.map((posicion) => posicion.activo.id)).toEqual(["B", "C", "U"]);
    /* Z tiene precio y vale cero: no es una posición sin precio, y su valor se da. */
    expect(de(conCinco, "Z").valor).toBe(0);
    /* El patrimonio: 5.000 − 500 − 100 − 1.000 − 100 − 100 = 3.200 € de efectivo, más los 1.200 € de A y los 0 € de Z. */
    expect(conCinco.patrimonio).toBeCloseTo(4400, 9);
  });

  test("la comprobación de la cartera lo sigue diciendo como un error, con sus palabras de siempre", () => {
    const preparado = preparar(cartera([A, B], MOVIMIENTOS), mercado, new Map(), FIN);
    const avisos = comprobarIntegridad(preparado.cartera, preparado.valoracion, FIN, mercado).avisos.filter((aviso) => aviso.codigo === "SIN_PRECIO");
    expect(avisos.map((aviso) => [aviso.gravedad, aviso.mensaje])).toEqual([["error", "Activo B no tiene precio: cuenta como cero, y la rentabilidad de cualquier periodo que incluya esta fecha no vale. Ponle un precio a mano."]]);
  });
});

describe("las cifras que sí la cuentan, y como cero, lo dicen", () => {
  const analisis = analizada(cartera([A, B], MOVIMIENTOS));
  const COMO_CERO = "Cuenta Activo B como cero, porque no tiene precio.";

  test("el resultado y la rentabilidad salen de contarla como cero: −800 € y −26,67 %", () => {
    /* Resultado: 2.200 € al final − 3.000 € aportados. Rentabilidad: de 3.000 € a 2.000 € el día 3, al pagar B (× 2/3), y
       de 2.000 € a 2.200 € el 31 (× 1,1): 2/3 × 1,1 − 1. Con una sola aportación el primer día, la del cliente es la misma. */
    expect(metrica("resultado").valor(analisis)).toBeCloseTo(-800, 9);
    expect(metrica("rentabilidad").valor(analisis)).toBeCloseTo((2 / 3) * 1.1 - 1, 12);
    expect(metrica("rentabilidadDelCliente").valor(analisis)).toBeCloseTo(2200 / 3000 - 1, 9);
    /* La caída máxima: de 3.000 € a 2.000 €. */
    expect(metrica("maximaCaida").valor(analisis)).toBeCloseTo(-1 / 3, 12);
  });

  test("las que se dan llevan la salvedad; las que no, no: ya dicen por qué no se dan", () => {
    for (const id of ["resultado", "rentabilidad", "rentabilidadDelCliente", "maximaCaida"]) expect(metrica(id).salvedad?.(analisis), id).toBe(COMO_CERO);
    /* Un mes de historia: ni se anualiza, ni hay veinte semanas para la volatilidad y los ratios, ni referencia, ni un año. */
    for (const id of ["rentabilidadAnualizada", "volatilidad", "sharpe", "sortino", "calmar", "diferenciaConLaReferencia", "rentabilidadUltimoAnio", "rentabilidadUltimos3Anios", "rentabilidadUltimos5Anios"]) {
      expect(metrica(id).valor(analisis), id).toBeNull();
      expect(metrica(id).salvedad?.(analisis), id).toBeUndefined();
    }
  });

  test("lo que es dinero movido no lleva ninguna; el patrimonio y el latente llevan la otra: no la incluyen", () => {
    for (const id of ["aportacionesNetas", "resultadoRealizado", "ingresos", "costes"]) expect(metrica(id).salvedad?.(analisis), id).toBeUndefined();
    for (const id of ["patrimonio", "resultadoLatente"]) expect(metrica(id).salvedad?.(analisis), id).toBe("No incluye Activo B, que no tiene precio.");
  });

  test("las dos frases, con una y con dos", () => {
    expect(notaDeLoContadoComoCero(analisis)).toBe(COMO_CERO);
    expect(notaCortaDeLoContadoComoCero(analisis)).toBe("La posición sin precio cuenta como cero.");
    const C = activo("C", "ACCION", "USD");
    const dos = analizada(cartera([A, B, C], [...MOVIMIENTOS, mov("compra", "2025-01-03", { activoId: "C", titulos: "10", importe: "-100" })]));
    expect(notaDeLoContadoComoCero(dos)).toBe("Cuenta Activo B y Activo C como cero, porque no tienen precio.");
    expect(notaCortaDeLoContadoComoCero(dos)).toBe("Las 2 posiciones sin precio cuentan como cero.");
  });

  test("con seis años de historia, un índice y un tipo sin riesgo, la llevan las trece que salen del valor de cada día", () => {
    /*
     * La misma cartera empezada el 02-01-2019 y mirada el 31-01-2025: A con un precio cada día (100 € hasta el último, que
     * es 120 €), un índice y un tipo sin riesgo planos. Hay más de cinco años: todas las cifras se dan.
     */
    const INICIO = "2019-01-02";
    const largo: DatosDeMercado = {
      precios: new Map([["A", serieDiaria(INICIO, FIN, 100, 120)]]),
      /* Desde el día después de comprar B, como en la cartera corta: sin cambio ese día, B no tiene precio (A-196). */
      cambios: new Map([["USD", serie(["2019-01-04", 1.25])]]),
      libreDeRiesgo: serieDiaria("2018-12-31", FIN, 1, 1)
    };
    const c = cartera(
      [A, B],
      [
        mov("aportacion", INICIO, { importe: "3000" }),
        mov("compra", INICIO, { activoId: "A", titulos: "10", precio: "100", importe: "-1000" }),
        mov("compra", "2019-01-03", { activoId: "B", titulos: "10", importe: "-1000" })
      ]
    );
    const seisAnios = analizar(preparar(c, largo, new Map(), FIN), TODO, { nombre: "Índice", serie: serieDiaria("2018-12-31", FIN, 100, 104) });
    const delValorDeCadaDia = ["resultado", "rentabilidad", "rentabilidadAnualizada", "rentabilidadDelCliente", "volatilidad", "maximaCaida", "sharpe", "sortino", "calmar", "diferenciaConLaReferencia", "rentabilidadUltimoAnio", "rentabilidadUltimos3Anios", "rentabilidadUltimos5Anios"];
    for (const id of delValorDeCadaDia) {
      expect(metrica(id).valor(seisAnios), id).not.toBeNull();
      expect(metrica(id).salvedad?.(seisAnios), id).toBe(COMO_CERO);
    }
    /* Y son esas trece, ni una más: con el patrimonio y el resultado latente, que no la incluyen, quince de las
       diecinueve del registro llevan algo que decir. Las cuatro que no, son dinero movido. */
    expect(METRICAS.filter((m) => m.salvedad?.(seisAnios) !== undefined).map((m) => m.id).sort()).toEqual([...delValorDeCadaDia, "patrimonio", "resultadoLatente"].sort());
    expect(METRICAS).toHaveLength(19);
  });

  test("con todas las posiciones con precio, ninguna cifra lleva salvedad", () => {
    const conPrecio = analizada(cartera([A, B], MOVIMIENTOS, { preciosManuales: [{ activoId: "B", fecha: "2025-01-03", precio: "125" }] }));
    for (const m of METRICAS) expect(m.salvedad?.(conPrecio), m.id).toBeUndefined();
    expect(notaDeLoContadoComoCero(conPrecio)).toBeNull();
    expect(notaCortaDeLoContadoComoCero(conPrecio)).toBeNull();
  });
});

describe("el aviso del tipo de cambio antiguo no habla de una posición que no se valora", () => {
  /* El único cambio del dólar es del 04-01-2025: a 31-01 tiene 27 días, y el aviso dice qué posiciones se valoran con él. */
  const avisosDelCambio = (c: ReturnType<typeof cartera>) => {
    const preparado = preparar(c, mercado, new Map(), FIN);
    return comprobarIntegridad(preparado.cartera, preparado.valoracion, FIN, mercado).avisos.filter((aviso) => aviso.codigo === "CAMBIO_ANTIGUO").map((aviso) => aviso.mensaje);
  };

  test("B no tiene precio: no se valora con ningún cambio, y el aviso no sale. Antes decía «con él se valora Activo B»", () => {
    expect(avisosDelCambio(cartera([A, B], MOVIMIENTOS))).toEqual([]);
  });

  test("con un precio puesto a mano sí se valora con ese cambio, y el aviso la nombra", () => {
    expect(avisosDelCambio(cartera([A, B], MOVIMIENTOS, { preciosManuales: [{ activoId: "B", fecha: "2025-01-03", precio: "125" }] }))).toEqual([
      "El último tipo de cambio USD/EUR es del 04/01/2025, de hace 27 días: con él se valora Activo B."
    ]);
  });
});

describe("en cuanto tiene un precio, tiene valor", () => {
  test("con 125 $ por título puestos a mano el 03-01, B vale 10 × 125 / 1,25 = 1.000 €: ni gana ni pierde", () => {
    const analisis = analizada(cartera([A, B], MOVIMIENTOS, { preciosManuales: [{ activoId: "B", fecha: "2025-01-03", precio: "125" }] }));
    const b = de(analisis, "B");
    expect(b.fuente).toBe(FUENTE.manual);
    expect(b.precio).toBe(125);
    expect(b.valor).toBeCloseTo(1000, 9);
    expect(b.latente).toBeCloseTo(0, 9);
    expect(b.latentePct).toBeCloseTo(0, 12);
    /* El patrimonio ya la cuenta: 1.200 + 1.000 + 1.000 = 3.200 €, y A pesa 1.200 / 3.200 = 37,5 %. */
    expect(analisis.patrimonio).toBeCloseTo(3200, 9);
    expect(de(analisis, "A").peso).toBeCloseTo(0.375, 12);
    expect(b.peso).toBeCloseTo(1000 / 3200, 12);
    expect(analisis.sinPrecio).toEqual([]);
    expect(notaDeLasSinPrecio(analisis)).toBeNull();
    expect(metrica("patrimonio").salvedad?.(analisis)).toBeUndefined();
    /* Y el resultado latente del conjunto vuelve: 200 € de A y 0 € de B. */
    expect(analisis.latente).toBeCloseTo(200, 9);
  });

  test("una posición que vale cero porque su precio es cero no es una posición sin precio", () => {
    /* A, con su serie a 0 € el 31-01: tiene precio (cero) y valor (cero), y pierde los 1.000 € que costó. */
    const aCero: DatosDeMercado = { ...mercado, precios: new Map([["A", serie(["2025-01-02", 100], [FIN, 0])]]) };
    const analisis = analizada(cartera([A], MOVIMIENTOS.slice(0, 2)), aCero);
    const a = de(analisis, "A");
    expect(a.fuente).toBe(FUENTE.mercado);
    expect(a.precio).toBe(0);
    expect(a.valor).toBe(0);
    expect(a.latente).toBe(-1000);
    expect(a.latentePct).toBe(-1);
    expect(analisis.sinPrecio).toEqual([]);
  });
});

describe("varias sin precio", () => {
  const C = activo("C", "ACCION", "USD");
  const D = activo("D", "ACCION", "USD");
  const E = activo("E", "ACCION", "USD");
  const F = activo("F", "ACCION", "USD");
  /* Cada una, 10 títulos pagando 100 € sin precio. La aportación da para todas. */
  const con = (...mas: Array<ReturnType<typeof activo>>) =>
    analizada(cartera([A, B, ...mas], [...MOVIMIENTOS, ...mas.map((uno) => mov("compra", "2025-01-03", { activoId: uno.id, titulos: "10", importe: "-100" }))]));

  test("dos: van al final, y la frase las nombra a las dos", () => {
    const analisis = con(C);
    expect(analisis.posiciones.map((posicion) => posicion.activo.id)).toEqual(["A", "B", "C"]);
    expect(listaDeLasSinPrecio(analisis)).toBe("Activo B y Activo C");
    expect(notaDeLasSinPrecio(analisis)).toBe("No incluye Activo B ni Activo C, que no tienen precio.");
    expect(metrica("resultadoLatente").salvedad?.(analisis)).toBe("No incluye Activo B ni Activo C, que no tienen precio.");
  });

  test("si ninguna tiene precio y son dos, el motivo va en plural", () => {
    const dosSolas = analizada(
      cartera([B, C], [mov("aportacion", "2025-01-02", { importe: "1100" }), mov("compra", "2025-01-03", { activoId: "B", titulos: "10", importe: "-1000" }), mov("compra", "2025-01-03", { activoId: "C", titulos: "10", importe: "-100" })])
    );
    expect(metrica("resultadoLatente").motivoSinValor?.(dosSolas)).toBe("Activo B y Activo C no tienen precio: sin ellos no se conoce su resultado.");
  });

  test("hasta cuatro se nombran todas; con cinco o más, las tres primeras y cuántas más", () => {
    expect(notaDeLasSinPrecio(con(C, D))).toBe("No incluye Activo B, Activo C ni Activo D, que no tienen precio.");
    /* Con cuatro, «y otra» no ahorra nada y escondía un nombre: se escriben las cuatro. */
    expect(notaDeLasSinPrecio(con(C, D, E))).toBe("No incluye Activo B, Activo C, Activo D ni Activo E, que no tienen precio.");
    expect(listaDeLasSinPrecio(con(C, D, E))).toBe("Activo B, Activo C, Activo D y Activo E");
    expect(notaDeLasSinPrecio(con(C, D, E, F))).toBe("No incluye Activo B, Activo C, Activo D ni otras 2, que no tienen precio.");
    expect(listaDeLasSinPrecio(con(C, D, E, F))).toBe("Activo B, Activo C, Activo D y otras 2");
    expect(notaDeLoContadoComoCero(con(C, D, E, F))).toBe("Cuenta Activo B, Activo C, Activo D y otras 2 como cero, porque no tienen precio.");
  });

  test("las formas sin nombres y con sujeto, con una y con varias", () => {
    const una = con();
    const tres = con(C, D);
    expect(cuantasSinPrecio(1)).toBe("una posición sin precio");
    expect(cuantasSinPrecio(3)).toBe("3 posiciones sin precio");
    expect(notaCortaDeLasSinPrecio(una)).toBe("No incluye una posición sin precio.");
    expect(notaCortaDeLasSinPrecio(tres)).toBe("No incluye 3 posiciones sin precio.");
    expect(notaDeLasSinPrecio(una, "El reparto")).toBe("El reparto no incluye Activo B, que no tiene precio.");
    expect(notaDeLasSinPrecio(tres, "El reparto")).toBe("El reparto no incluye Activo B, Activo C ni Activo D, que no tienen precio.");
    expect(notaDeLoContadoComoCero(una, { quien: "El patrimonio medio" })).toBe("El patrimonio medio cuenta Activo B como cero, porque no tiene precio.");
    expect(notaDeLasCifrasQueLasCuentanComoCero(una)).toBe("Estas cifras cuentan Activo B como cero, porque no tiene precio.");
    expect(notaDeLasCifrasQueLasCuentanComoCero(tres)).toBe("Estas cifras cuentan Activo B, Activo C y Activo D como cero, porque no tienen precio.");
    /* La misma salvedad para varias cifras a la vez: lo que sigue a los dos puntos. */
    expect(salvedadParaVariasCifras("No incluye Activo B, que no tiene precio.", una)).toBe("ninguna incluye Activo B, que no tiene precio.");
    expect(salvedadParaVariasCifras("No incluye Activo B, Activo C ni Activo D, que no tienen precio.", tres)).toBe("ninguna incluye Activo B, Activo C ni Activo D, que no tienen precio.");
    expect(salvedadParaVariasCifras("Cuenta Activo B como cero, porque no tiene precio.", una)).toBe("cada una cuenta Activo B como cero, porque no tiene precio.");
    /* Y con todas con precio, nada de nada. */
    const ninguna = analizada(cartera([A], MOVIMIENTOS.slice(0, 2)));
    for (const frase of [notaCortaDeLasSinPrecio(ninguna), notaDeLasSinPrecio(ninguna, "El reparto"), notaDeLoContadoComoCero(ninguna, { quien: "El patrimonio medio" }), notaDeLasCifrasQueLasCuentanComoCero(ninguna)]) expect(frase).toBeNull();
  });
});

describe("si a una con precio le falta el coste, el resultado latente no se da, y es por el coste", () => {
  test("B sin precio, y G comprada con dólares el día antes de que haya cambio a euros", () => {
    /* G: 5 títulos a 120 $ pagados el 03-01 con 600 $ aportados en dólares, y el cambio del dólar empieza el 04-01: tiene
       precio (el de la operación) y valor (5 × 120 / 1,25 = 480 €), y no se sabe lo que costó en euros. Sin ningún cambio
       tampoco tendría valor, e iría como una sin precio (22-11-2026). */
    const G = activo("G", "ACCION", "USD");
    const analisis = analizada(
      cartera([A, B, G], [...MOVIMIENTOS, mov("aportacion", "2025-01-02", { importe: "600", divisa: "USD" }), mov("compra", "2025-01-03", { activoId: "G", titulos: "5", precio: "120", divisa: "USD", importe: "-600" })])
    );
    expect(de(analisis, "G").valor).toBeCloseTo(480, 9);
    expect(de(analisis, "G").coste).toBeNull();
    /* B no entra en el total y no lo impide; lo impide G, que tiene precio y no coste. */
    expect(analisis.latente).toBeNull();
    expect(metrica("resultadoLatente").motivoSinValor?.(analisis)).toBe("Falta un tipo de cambio para conocer el coste de alguna posición.");
    expect(metrica("resultadoLatente").salvedad?.(analisis)).toBeUndefined();
  });
});

describe("un bono sin precio cuenta como cero entero, también su cupón corrido", () => {
  /*
   * Un bono en dólares al 5 % anual (ACT/ACT), con cupón cada 2 de enero: 1.000 de nominal comprados el 02-01-2025 pagando
   * 900 € y sin escribir el precio, con el cambio del dólar desde el día siguiente: sin cambio el día de la compra, su precio
   * no se deduce de lo pagado (A-196). 2.000 € aportados: quedan 1.100 € de efectivo.
   * El 12-04-2025 han pasado 100 días de un periodo de 365: el cupón corrido es 1.000 × 5 % × 100 / 365 = 13,6986 $.
   */
  const condiciones: CondicionesDelBono = { cupon: "0.05", frecuencia: 1, vencimiento: "2030-01-02", base: "ACT/ACT" };
  const BONO = activo("BON", "BONO", "USD", { multiplicador: "0.01", bono: condiciones });
  const movimientos = [mov("aportacion", "2025-01-02", { importe: "2000" }), mov("compra", "2025-01-02", { activoId: "BON", titulos: "1000", importe: "-900" })];
  const cambios: DatosDeMercado = { precios: new Map(), cambios: new Map([["USD", serie(["2025-01-03", 1.25])]]) };
  const DIA = "2025-04-12";

  test("sin precio vale cero, y el patrimonio es solo el efectivo: antes contaba su cupón corrido, 13,6986 $ / 1,25 = 10,96 €", () => {
    const v = valorar(cartera([BONO], movimientos), cambios, { hasta: DIA });
    const k = v.indice.get(DIA)!;
    expect(v.porActivo.get("BON")!.fuente[k]).toBe(FUENTE.sinPrecio);
    expect(v.porActivo.get("BON")!.valor[k]).toBe(0);
    expect(v.valor[k]).toBe(1100);
  });

  test("con precio, el cupón corrido sí cuenta: al 98 %, (980 + 13,6986) / 1,25 = 794,96 €", () => {
    const c = cartera([BONO], movimientos, { preciosManuales: [{ activoId: "BON", fecha: DIA, precio: "98" }] });
    const v = valorar(c, cambios, { hasta: DIA });
    const k = v.indice.get(DIA)!;
    expect(v.porActivo.get("BON")!.valor[k]).toBeCloseTo((980 + (1000 * 0.05 * 100) / 365) / 1.25, 9);
    expect(v.porActivo.get("BON")!.valor[k]).toBeCloseTo(794.96, 2);
  });

  test("en el análisis sale como las demás: sin valor, y el patrimonio no lo incluye", () => {
    const analisis = analizar(preparar(cartera([BONO], movimientos), cambios, new Map(), DIA), TODO);
    expect(analisis.posiciones[0].valor).toBeNull();
    expect(analisis.patrimonio).toBe(1100);
    expect(notaDeLasSinPrecio(analisis)).toBe("No incluye Activo BON, que no tiene precio.");
    /* Y no está en la composición, donde antes entraba con sus 10,96 €. */
    expect(analisis.composicion.principales).toEqual([]);
  });
});

describe("A-196 · una compra pagada en otra divisa da precio, con el cambio de la operación", () => {
  /*
   * La misma cartera, con el dólar a 1,25 desde el 02-01: el día de la compra de B (03-01) ya hay cambio. Sin precio escrito,
   * el de la operación es lo pagado en dólares entre los títulos: 1.000 € × 1,25 / 10 = 125 $. Valorada a ese precio, B vale
   * 10 × 125 / 1,25 = 1.000 €: ni gana ni pierde, y el patrimonio es 1.200 + 1.000 + 1.000 = 3.200 €. Antes de la A-196, B no
   * tenía ningún precio y contaba como cero: patrimonio 2.200 € y resultado −800 €.
   */
  const conCambio: DatosDeMercado = { ...mercado, cambios: new Map([["USD", serie(["2025-01-02", 1.25])]]) };

  test("con el cambio del día: 125 $ por título, «última operación», 1.000 € y el patrimonio entero", () => {
    const analisis = analizada(cartera([A, B], MOVIMIENTOS), conCambio);
    const b = de(analisis, "B");
    expect(b.fuente).toBe(FUENTE.operacion);
    expect(b.precio).toBeCloseTo(125, 9);
    expect(b.valor).toBeCloseTo(1000, 9);
    expect(b.latente).toBeCloseTo(0, 9);
    expect(analisis.sinPrecio).toEqual([]);
    expect(analisis.patrimonio).toBeCloseTo(3200, 9);
    expect(metrica("patrimonio").salvedad?.(analisis)).toBeUndefined();
  });

  test("si la operación declara su cambio, manda el suyo: con 1,30, 1.000 € × 1,30 / 10 = 130 $, y vale 10 × 130 / 1,25 = 1.040 €", () => {
    const conElSuyo = [MOVIMIENTOS[0], MOVIMIENTOS[1], mov("compra", "2025-01-03", { activoId: "B", titulos: "10", importe: "-1000", cambio: "1.30" })];
    const b = de(analizada(cartera([A, B], conElSuyo), conCambio), "B");
    expect(b.fuente).toBe(FUENTE.operacion);
    expect(b.precio).toBeCloseTo(130, 9);
    expect(b.valor).toBeCloseTo(1040, 9);
  });
});
