import { describe, expect, it } from "vitest";
import { carteraPublicada, pesoVistoDelFondo, rotuloDeCarteraPublicada } from "./carteraPublicada";
import { calculateOverlap, cotaDelSolapamiento, noLlegaAUnaDecima, pasaDeCien, sinComunes, situacionDeLaCartera, solapamientoEnUnaFrase, textoDelSolapamiento } from "./overlap";
import type { BdbAssetHoldings } from "../types/bdbAssets";

const cartera = (asset_id: string, lineas: Array<[string, number]>, extra: Partial<BdbAssetHoldings> = {}): BdbAssetHoldings => ({
  asset_id,
  storage_mode: "SINGLE_DOCUMENT",
  holdings: lineas.map(([name, weight_pct]) => ({ name, isin: `ISIN-${name}`, weight_pct })),
  ...extra
});

describe("calculateOverlap", () => {
  const fundA: BdbAssetHoldings = {
    asset_id: "A",
    storage_mode: "SINGLE_DOCUMENT",
    holdings: [
      { name: "Apple", isin: "US0378331005", weight_pct: 30 },
      { name: "Microsoft", isin: "US5949181045", weight_pct: 15 },
      { name: "Google", isin: "US02079K1079", weight_pct: 15 } // suma 60: 40 sin recibir
    ]
  };

  const fundB: BdbAssetHoldings = {
    asset_id: "B",
    storage_mode: "SINGLE_DOCUMENT",
    holdings: [
      { name: "Apple", isin: "US0378331005", weight_pct: 40 },
      { name: "Microsoft", isin: "US5949181045", weight_pct: 40 }
    ] // suma 80: 20 sin recibir
  };

  it("dos fondos con líneas comunes: lo común, con el peso real de cada línea y sin reescalar (decisión 47)", () => {
    /* Apple = min(30, 40) = 30; Microsoft = min(15, 40) = 15; Google no es común. Total 45.
       Reescalando lo recibido a 100 %, como antes, salían 50, 25 y 75: un 75 % que nadie había visto. */
    const result = calculateOverlap(fundA, fundB);
    expect(result.overlapPercent).toBeCloseTo(45, 10);
    expect(result.commonTop).toHaveLength(2);
    expect(result.commonTop[0].name).toBe("Apple");
    expect(result.commonTop[0].weight).toBeCloseTo(30, 10);
    expect(result.commonTop[1].name).toBe("Microsoft");
    expect(result.commonTop[1].weight).toBeCloseTo(15, 10);
  });

  it("recibido parcial: la mitad de un fondo no se lleva a 100, y la cifra baja a lo que se ha visto", () => {
    /* Como Seilern: 10 líneas de 5,02 cada una, un 50,2 %. Y otro fondo completo con esas 10 líneas a 3 y el resto en otra cosa: 30 + 70.
       Lo común: 10 × min(5,02, 3) = 30. Reescalando, cada una de Seilern valía 10: 10 × min(10, 3) = el mismo 30; con 6 de peso, 60 frente a 50,2. */
    const seilern = cartera("IE00B2NXKW18", Array.from({ length: 10 }, (_, i) => [`L${i}`, 5.02] as [string, number]));
    const otro = cartera("Z", [...Array.from({ length: 10 }, (_, i) => [`L${i}`, 3] as [string, number]), ["Resto", 70]]);
    expect(calculateOverlap(seilern, otro).overlapPercent).toBeCloseTo(30, 10);
    const pesado = cartera("W", Array.from({ length: 10 }, (_, i) => [`L${i}`, 6] as [string, number]).concat([["Resto", 40]]));
    expect(calculateOverlap(seilern, pesado).overlapPercent).toBeCloseTo(50.2, 10);
  });

  it("con derivados, los largos se quedan con su peso: PIMCO ya no se divide por 5,27", () => {
    /* Como PIMCO (+527,25 y −427,25) y Goldman (+313,75 y −213,75), con dos líneas comunes hechas a mano. Lo común: min(2, 3) + min(1,21, 0,5) = 2,5.
       Reescalando: min(2 / 5,2725, 3 / 3,1375) + min(1,21 / 5,2725, 0,5 / 3,1375) = 0,3793 + 0,1594 = 0,539. */
    const pimco = cartera("IE00B11XZ103", [["Comun1", 2], ["Comun2", 1.21], ["Resto", 524.04], ["Ventas", -427.25]]);
    const goldman = cartera("LU1103307408", [["Comun1", 3], ["Comun2", 0.5], ["Otra", 310.25], ["Ventas", -213.75]]);
    expect(calculateOverlap(pimco, goldman).overlapPercent).toBeCloseTo(2.5, 10);
  });

  it("con derivados puede pasar de 100: se conserva el número y se escribe que pasa", () => {
    /* Dos clases del mismo fondo, como las de Goldman Emerging Markets Debt: +330 y −230. Lo común, los largos. */
    const a = cartera("LU0910636546", [["Bonos", 80], ["Forward", 250], ["Ventas", -230]]);
    const b = cartera("LU0910636892", [["Bonos", 80], ["Forward", 250], ["Ventas", -230]]);
    const valor = calculateOverlap(a, b).overlapPercent!;
    expect(valor).toBeCloseTo(330, 10);
    expect(textoDelSolapamiento(valor)).toBe("más de 100\u00a0%");
    expect(solapamientoEnUnaFrase(valor)).toBe("más del 100\u00a0%");
  });

  it("los dos lados: da lo mismo cuál sea el primero", () => {
    expect(calculateOverlap(fundA, fundB).overlapPercent).toBe(calculateOverlap(fundB, fundA).overlapPercent);
  });

  it("un cero medido sigue siendo un cero", () => {
    const fundC = cartera("C", [["Tesla", 100]]);
    const result = calculateOverlap(fundA, fundC);
    expect(result.overlapPercent).toBe(0);
    expect(result.commonTop).toHaveLength(0);
  });

  it("el mismo fondo son 100 %, sumen lo que sumen sus líneas", () => {
    /* Suma 60, y con PIMCO sumaría 527. */
    expect(calculateOverlap(fundA, fundA).overlapPercent).toBe(100);
    const pimco = cartera("IE00B11XZ103", [["Bonos", 527.254], ["Ventas", -427.254]]);
    expect(calculateOverlap(pimco, pimco).overlapPercent).toBe(100);
  });

  it("sin cartera no hay cifra, y eso no es un 0 %", () => {
    expect(calculateOverlap(null, fundA).overlapPercent).toBeNull();
    expect(calculateOverlap(fundA, null).overlapPercent).toBeNull();
    expect(calculateOverlap({ ...fundA, holdings: [] }, fundA).overlapPercent).toBeNull();
    expect(calculateOverlap(cartera("Z", [["Cero", 0]]), fundA).overlapPercent).toBeNull();
  });
});

describe("la regla de la mitad (decisión 6)", () => {
  const completo = cartera("Y", [["Alfa", 50], ["Gamma", 50]]);

  /* A mano: solo Alfa es común, min(30, 50) = 30. La frontera del N/D sigue en la mitad recibida: la 47 no la toca. */
  it("a los dos lados del umbral: 49,99 no da cifra; 50 y 50,01 sí", () => {
    expect(calculateOverlap(cartera("X", [["Alfa", 29.99], ["Beta", 20]]), completo).overlapPercent).toBeNull();
    expect(calculateOverlap(cartera("X", [["Alfa", 30], ["Beta", 20]]), completo).overlapPercent).toBeCloseTo(30, 10);
    expect(calculateOverlap(cartera("X", [["Alfa", 30.01], ["Beta", 20]]), completo).overlapPercent).toBeCloseTo(30.01, 10);
  });

  it("exactamente la mitad no es «más de la mitad», y no depende de cómo se sumen los decimales", () => {
    expect(carteraPublicada(cartera("X", [["A", 16.67], ["B", 16.67], ["C", 16.66]]))).toEqual({ lineas: 3, titulos: 3, pesoPct: 50, suficiente: true, diezPrimeras: [16.67, 16.67, 16.66] });
    expect(carteraPublicada(cartera("X", [["A", 0.1], ["B", 49.8], ["C", 0.1]]))?.suficiente).toBe(true);
  });

  it("basta con que le falte a uno de los dos, en los dos sentidos", () => {
    const corto = cartera("X", [["Alfa", 30]]);
    expect(calculateOverlap(corto, completo).overlapPercent).toBeNull();
    expect(calculateOverlap(completo, corto).overlapPercent).toBeNull();
  });

  it("un fondo corto contra sí mismo tampoco da 100 %", () => {
    const corto = cartera("X", [["Alfa", 30]]);
    expect(calculateOverlap(corto, corto).overlapPercent).toBeNull();
    expect(calculateOverlap(completo, completo).overlapPercent).toBeCloseTo(100);
  });

  /* Los dos ETF de la muestra, con sus 10 líneas de la base vieja: daban 99 %. Con la base nueva, 98,75 %. */
  it("iShares MSCI World y Vanguard S&P 500 dejan de dar un 99 %", () => {
    const nombres = ["NVIDIA", "Apple", "Microsoft", "Amazon", "Alphabet A", "Broadcom", "Alphabet C", "Meta", "Micron", "Tesla"];
    const world = cartera("IE00B4L5Y983", nombres.map((n) => [n, 26.64 / nombres.length] as [string, number]));
    const sp500 = cartera("IE00B3XXRP09", nombres.map((n) => [n, 37.79 / nombres.length] as [string, number]));
    expect(carteraPublicada(world)?.pesoPct).toBeCloseTo(26.64, 6);
    expect(carteraPublicada(sp500)?.pesoPct).toBeCloseTo(37.79, 6);
    expect(calculateOverlap(world, sp500)).toEqual({ overlapPercent: null, commonTop: [] });
  });

  it("no se fía de lo que dice el fondo de sí mismo: cuenta las líneas que han llegado", () => {
    /* Como iShares en la base nueva: 1.247 según la fuente, 10 líneas, 27,78 %. */
    const declarado = cartera("IE00B4L5Y983", Array.from({ length: 10 }, (_, i) => [`L${i}`, 2.778] as [string, number]), { holdings_count: 1247, top10_weight: 27.78 });
    expect(carteraPublicada(declarado)).toEqual({ lineas: 10, titulos: 10, pesoPct: 27.78, suficiente: false, diezPrimeras: Array(10).fill(2.778) });
    /* Y un top10_weight por encima de 100, como el de PIMCO, no dice que esté la cartera. */
    const inflado = cartera("IE00B11XZ103", [["Bono", 30]], { holdings_count: 2376, top10_weight: 151.75 });
    expect(carteraPublicada(inflado)?.suficiente).toBe(false);
  });

  it("los pesos cuentan con su signo: una cartera completa con derivados suma 100 aunque en bruto pase de 500", () => {
    /* PIMCO: +527,254 y −427,254. */
    const pimco = cartera("IE00B11XZ103", [["Bonos", 527.254], ["Derivados vendidos", -427.254]]);
    expect(carteraPublicada(pimco)).toEqual({ lineas: 2, titulos: 2, pesoPct: 100, suficiente: true, diezPrimeras: [527.254, -427.254] });
    expect(pesoVistoDelFondo(carteraPublicada(pimco)!)).toBe(100);
  });

  it("una lista corta con patas de los dos lados no llega a la mitad, aunque su bruto pase", () => {
    /* AXA Euro Strategic Bonds: 10 líneas, +59,56 y −58,53. En bruto pasaría; en neto, un 1,03 %. */
    const axa = cartera("LU0251660279", [["Compras", 59.56], ["Ventas", -58.53]]);
    expect(carteraPublicada(axa)).toEqual({ lineas: 2, titulos: 2, pesoPct: 1.03, suficiente: false, diezPrimeras: [59.56, -58.53] });
    expect(calculateOverlap(axa, completo).overlapPercent).toBeNull();
  });

  it("los negativos no entran en la cifra: una venta no es una inversión en común", () => {
    /* A: compras 120 y ventas −20 = 100 neto. Con Y, Alfa = min(60, 50) = 50. */
    const largoCorto = cartera("A", [["Alfa", 60], ["Beta", 60], ["Venta", -20]]);
    expect(calculateOverlap(largoCorto, completo).overlapPercent).toBeCloseTo(50, 10);
  });

  it("por encima de 100 no falta nada: se escribe lo que dice el dato y lo visto no pasa de 100", () => {
    const nominal = carteraPublicada(cartera("LU0503253931", [["Letras", 60], ["Swap", 48.2729]]))!;
    expect(nominal).toEqual({ lineas: 2, titulos: 2, pesoPct: 108.2729, suficiente: true, diezPrimeras: [60, 48.2729] });
    expect(pesoVistoDelFondo(nominal)).toBe(100);
    expect(rotuloDeCarteraPublicada(nominal)).toBe("2 líneas · 108,3\u00a0% del fondo");
    expect(pesoVistoDelFondo({ pesoPct: -2.29 })).toBe(0);
  });

  it("el rótulo sale del dato, y cuenta líneas: no son las posiciones que declara el fondo (T12)", () => {
    expect(rotuloDeCarteraPublicada({ lineas: 10, pesoPct: 26.64 })).toBe("10 líneas · 26,6\u00a0% del fondo");
    expect(rotuloDeCarteraPublicada({ lineas: 2317, pesoPct: 100 })).toBe("2.317 líneas · 100,0\u00a0% del fondo");
    expect(rotuloDeCarteraPublicada({ lineas: 1, pesoPct: 100 })).toBe("1 línea · 100,0\u00a0% del fondo");
    /* Amundi Global Equity Responsible en la base nueva: 182 líneas, que son sus 49 acciones y 133 de efectivo, cuentas y contratos de divisa. */
    expect(rotuloDeCarteraPublicada({ lineas: 182, pesoPct: 100 })).toBe("182 líneas · 100,0\u00a0% del fondo");
    expect(rotuloDeCarteraPublicada({ lineas: 182, pesoPct: 100 })).not.toContain("posicion");
  });

  it("guarda los pesos de las diez primeras líneas que cuenta, en su orden: con ellos se comprueba el «10 mayores» del proveedor", () => {
    const doce = cartera("X", Array.from({ length: 12 }, (_, i) => [`L${i}`, 12 - i] as [string, number]));
    expect(carteraPublicada(doce)?.diezPrimeras).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
    /* Una línea de peso 0 o sin nombre ni ISIN no es una línea, y no ocupa sitio entre las diez. */
    const conHuecos: BdbAssetHoldings = { asset_id: "Y", storage_mode: "SINGLE_DOCUMENT", holdings: [
      { name: "A", weight_pct: 5 }, { name: "Cero", weight_pct: 0 }, { name: "", weight_pct: 4 }, { name: "B", isin: "ISIN-B", weight_pct: 3 }
    ] };
    expect(carteraPublicada(conHuecos)?.diezPrimeras).toEqual([5, 3]);
  });
});

describe("cómo se escribe una cifra que es un mínimo (decisión 47)", () => {
  it("se redondea hacia abajo: un mínimo redondeado hacia arriba deja de serlo", () => {
    expect(textoDelSolapamiento(3.21)).toBe("al menos 3,2\u00a0%");
    expect(textoDelSolapamiento(0.6)).toBe("al menos 0,6\u00a0%");
    expect(textoDelSolapamiento(2.87)).toBe("al menos 2,8\u00a0%");
    /* No llega al 40, y no puede decir que sí. */
    expect(textoDelSolapamiento(39.97)).toBe("al menos 39,9\u00a0%");
    expect(textoDelSolapamiento(40)).toBe("al menos 40,0\u00a0%");
    /* La coma flotante no se lleva una décima: 3,2 × 10 no puede quedar en 31,999… */
    expect(textoDelSolapamiento(3.2)).toBe("al menos 3,2\u00a0%");
    expect(textoDelSolapamiento(0.3 + 0.1 + 0.2)).toBe("al menos 0,6\u00a0%");
  });

  it("por debajo de una décima ya no dice «al menos 0,0 %» (decisión 88): «sin comunes» o «comunes < 0,1 %», y ninguno es un cero", () => {
    /* Lo que la decisión 47 escribía «al menos 0,0 %» son dos cosas: nada en común, o algo que no llega a una décima. */
    expect(textoDelSolapamiento(0)).toBe("sin comunes");
    expect(cotaDelSolapamiento(0)).toEqual({ antes: "sin", cifra: "comunes", palabra: true });
    expect(textoDelSolapamiento(0.07928)).toBe("comunes < 0,1\u00a0%");
    expect(cotaDelSolapamiento(0.0011)).toEqual({ antes: "comunes", cifra: "< 0,1\u00a0%" });
    /* La frontera es la del redondeo hacia abajo: 0,1 ya es «al menos 0,1 %», y 0,0999 no llega. */
    expect(textoDelSolapamiento(0.1)).toBe("al menos 0,1\u00a0%");
    expect(textoDelSolapamiento(0.0999)).toBe("comunes < 0,1\u00a0%");
    expect(textoDelSolapamiento(0.3 - 0.2)).toBe("al menos 0,1\u00a0%");
    expect(sinComunes(0)).toBe(true);
    expect(sinComunes(0.0011)).toBe(false);
    expect(sinComunes(null)).toBe(false);
    expect(noLlegaAUnaDecima(0.0011)).toBe(true);
    expect(noLlegaAUnaDecima(0)).toBe(false);
    expect(noLlegaAUnaDecima(0.1)).toBe(false);
  });

  it("hasta 100 es «al menos»; por encima, «más de 100 %», sin el número", () => {
    expect(textoDelSolapamiento(100)).toBe("al menos 100,0\u00a0%");
    expect(textoDelSolapamiento(100.51)).toBe("más de 100\u00a0%");
    expect(textoDelSolapamiento(347.8)).toBe("más de 100\u00a0%");
    expect(cotaDelSolapamiento(3.21)).toEqual({ antes: "al menos", cifra: "3,2\u00a0%" });
    expect(cotaDelSolapamiento(347.8)).toEqual({ antes: "más de", cifra: "100\u00a0%" });
  });

  it("pasar de 100 por el redondeo del proveedor no es pasar de 100: un fondo sin derivados sigue diciendo «al menos 100,0 %»", () => {
    expect(textoDelSolapamiento(100.00001)).toBe("al menos 100,0\u00a0%");
    expect(textoDelSolapamiento(100.5)).toBe("al menos 100,0\u00a0%");
    expect(pasaDeCien(100.5)).toBe(false);
    expect(pasaDeCien(100.51)).toBe(true);
    expect(pasaDeCien(null)).toBe(false);
  });

  it("dentro de una frase", () => {
    expect(solapamientoEnUnaFrase(62)).toBe("al menos el 62,0\u00a0%");
    expect(solapamientoEnUnaFrase(347.8)).toBe("más del 100\u00a0%");
    expect(solapamientoEnUnaFrase(0.05)).toBe("menos del 0,1\u00a0%");
  });
});

describe("solo títulos: fuera derivados, sus contrapartidas y el efectivo (decisión 87)", () => {
  const conCodigo = (asset_id: string, lineas: Array<[string, number, string | undefined]>): BdbAssetHoldings => ({
    asset_id,
    storage_mode: "SINGLE_DOCUMENT",
    holdings: lineas.map(([name, weight_pct, holding_type_code]) => ({ name, isin: `ISIN-${name}`, weight_pct, holding_type_code }))
  });

  it("PIMCO y Goldman: los dos futuros sobre deuda dejan de contar, y queda el bono común", () => {
    /* Hecho a mano con la forma de la muestra: Long Gilt 1,71 y BTP 0,93 comunes como futuros (TF), y un bono común de 0,58.
       Antes: 1,71 + 0,93 + 0,58 = 3,22. Ahora solo el bono: 0,58, «al menos 0,5 %». */
    const pimco = conCodigo("IE00B11XZ103", [["Long Gilt", 1.71, "TF"], ["BTP", 0.93, "TF"], ["Bono", 0.58, "B"], ["Resto", 96.78, "B"]]);
    const goldman = conCodigo("LU1103307408", [["Long Gilt", 2, "TF"], ["BTP", 1, "TF"], ["Bono", 0.7, "B"], ["Otro", 96.3, "B"]]);
    const valor = calculateOverlap(pimco, goldman).overlapPercent!;
    expect(valor).toBeCloseTo(0.58, 10);
    expect(textoDelSolapamiento(valor)).toBe("al menos 0,5\u00a0%");
  });

  it("cada grupo de la lista sale, y nada más: contrapartida, efectivo, cuentas, depositario y colateral", () => {
    const codigos = ["CQ", "OT", "C", "CH", "CD", "QQ", "CA", "CU", "SI", "EL"];
    const a = conCodigo("A", [...codigos.map((codigo) => [`L-${codigo}`, 5, codigo] as [string, number, string]), ["Bono", 50, "B"]]);
    const b = conCodigo("B", [...codigos.map((codigo) => [`L-${codigo}`, 5, codigo] as [string, number, string]), ["Otro", 50, "B"]]);
    expect(calculateOverlap(a, b).overlapPercent).toBe(0);
    /* Pagarés, repos y monetarios son liquidez en el contrato, pero no efectivo: se quedan. 3 × 5 = 15. */
    const c = conCodigo("C", [["Pagare", 5, "CP"], ["Repo", 5, "CR"], ["Monetario", 5, "FM"], ["Bono", 85, "B"]]);
    const d = conCodigo("D", [["Pagare", 5, "CP"], ["Repo", 5, "CR"], ["Monetario", 5, "FM"], ["Otro", 85, "B"]]);
    expect(calculateOverlap(c, d).overlapPercent).toBeCloseTo(15, 10);
  });

  it("una línea sin código no se quita, ni se mira su nombre: la cifra se queda como antes", () => {
    /* Sin catálogo subido no hay código, y el código nuevo no quita nada: «Cash» y un futuro cuentan como hoy, 0,4 + 1,5 = 1,9. */
    const a = conCodigo("A", [["Cash", 0.4, undefined], ["Long Gilt Future", 1.5, undefined], ["Bono", 98.1, undefined]]);
    const b = conCodigo("B", [["Cash", 0.6, undefined], ["Long Gilt Future", 2, undefined], ["Otro", 97.4, undefined]]);
    expect(calculateOverlap(a, b).overlapPercent).toBeCloseTo(1.9, 10);
    /* Basta con que uno de los dos diga qué es: si en B el efectivo trae «C», ya no es un título común. */
    const bConCodigo = conCodigo("B", [["Cash", 0.6, "C"], ["Long Gilt Future", 2, undefined], ["Otro", 97.4, undefined]]);
    expect(calculateOverlap(a, bConCodigo).overlapPercent).toBeCloseTo(1.5, 10);
  });

  it("la regla de la mitad sigue contando todas las líneas recibidas: el efectivo es parte de lo recibido", () => {
    /* 45 de títulos y 10 de efectivo: 55 recibidos, más de la mitad, y hay cifra; sin el efectivo serían 45 y no la habría. */
    const a = conCodigo("A", [["Bono", 45, "B"], ["Cash", 10, "C"]]);
    const b = conCodigo("B", [["Bono", 30, "B"], ["Otro", 70, "B"]]);
    expect(calculateOverlap(a, b).overlapPercent).toBeCloseTo(30, 10);
  });

  it("las dos clases de un fondo dejan de pasar de 100 por sus forwards", () => {
    /* Como Goldman Emerging Markets Debt: +330 y −230, con 250 de forwards (CU). Antes, 330; sin ellos, los 80 de bonos. */
    const a = conCodigo("LU0910636546", [["Bonos", 80, "B"], ["Forward", 250, "CU"], ["Ventas", -230, "CU"]]);
    const b = conCodigo("LU0910636892", [["Bonos", 80, "B"], ["Forward", 250, "CU"], ["Ventas", -230, "CU"]]);
    expect(calculateOverlap(a, b).overlapPercent).toBeCloseTo(80, 10);
  });

  it("una línea que pesa 0 o vende en uno de los dos no es común, ni sale en la lista", () => {
    const a = conCodigo("A", [["Alfa", 50, "E"], ["Beta", -5, "E"], ["Gamma", 55, "E"]]);
    const b = conCodigo("B", [["Beta", 20, "E"], ["Delta", 80, "E"]]);
    const resultado = calculateOverlap(a, b);
    expect(resultado.overlapPercent).toBe(0);
    expect(resultado.commonTop).toEqual([]);
  });
});

describe("qué se puede decir de cada posición", () => {
  it("una acción no aplica aunque una respuesta traiga líneas; un tipo desconocido no se da por acción", () => {
    expect(situacionDeLaCartera("STOCK", null).situacion).toBe("no_aplica");
    expect(situacionDeLaCartera("STOCK", cartera("X", [["Alfa", 100]])).situacion).toBe("no_aplica");
    expect(situacionDeLaCartera(undefined, null).situacion).toBe("sin_cartera");
    expect(situacionDeLaCartera("OTHER", cartera("X", [["Alfa", 100]])).situacion).toBe("medible");
  });

  it("distingue lo corto de lo que no tiene nada", () => {
    expect(situacionDeLaCartera("ETF", cartera("X", [["Alfa", 26.64]])).situacion).toBe("insuficiente");
    expect(situacionDeLaCartera("FUND", cartera("X", [])).situacion).toBe("sin_cartera");
    expect(situacionDeLaCartera("FUND", cartera("X", [["Alfa", 50]])).situacion).toBe("medible");
  });
});
