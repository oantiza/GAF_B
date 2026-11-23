import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
    columnasDeActivos,
    COLUMNAS_DEL_INFORME,
    fechaYDivisaDeLasCifras,
    filasDeActivos,
    metodologiaDeLaComparativa,
    puntoDeLaComparativa,
    ventanaDelInforme,
    type FuenteDeColumna
} from "../src/adapters/comparativaDeActivos";
import { TablaComparativa, type ColumnaComparada, type FilaComparada } from "../src/components/tabla/TablaComparativa";

/**
 * De dónde dice cada columna que salen sus cifras.
 *
 * El 03-11-2026 se midió que el informe de «Comparar activos» podía imprimir una fila venida
 * de la tarjeta nueva bajo un pie calculado con la base anterior, y que el aviso de «no
 * comparable» no podía morder en una columna de respaldo porque esa columna se quedaba **sin
 * método** aunque el activo lo trajera. La cabecera decía la base y tiraba el método, que es
 * la mitad que importa para interpretar la fila.
 *
 * El método de una columna tiene que salir de la misma fuente que sus cifras. Si no, el pie
 * del informe describe un cálculo que no es el de los números impresos encima, y eso llega a
 * un documento que un asesor firma.
 */
const activo = (metodo?: string, frecuencia?: string) =>
    ({
        asset_id: "a1",
        display_name: "BHP Group",
        isin: "AU000000BHP4",
        metrics: { sharpe_3y: 0.4984, metrics_method: metodo, metrics_frequency: frecuencia }
    }) as unknown as FuenteDeColumna["activo"];

const tarjeta = (metodo: string, frecuencia: string) =>
    ({ metrics: { method: metodo, frequency: frecuencia } }) as unknown as FuenteDeColumna["tarjeta"];

describe("de donde dice la columna que salen sus cifras", () => {
    it("con tarjeta, el metodo es el de la tarjeta", () => {
        const [columna] = columnasDeActivos([
            { activo: activo("GEOMETRIC_CAGR", "WEEKLY"), tarjeta: tarjeta("EXTRACTOR_MONTHLY_V1", "MONTHLY") }
        ]);
        expect(columna?.metodo).toBe("EXTRACTOR_MONTHLY_V1");
        expect(columna?.frecuencia).toBe("MONTHLY");
        expect(columna?.apunte).not.toContain("base anterior");
    });

    it("sin tarjeta, el metodo es el del activo de siempre y NO se tira", () => {
        const [columna] = columnasDeActivos([{ activo: activo("GEOMETRIC_CAGR", "WEEKLY") }]);
        expect(columna?.metodo).toBe("GEOMETRIC_CAGR");
        expect(columna?.frecuencia).toBe("WEEKLY");
        // Y la cabecera sigue diciendo de qué base viene, que es otra cosa.
        expect(columna?.apunte).toContain("base anterior");
    });

    it("sin tarjeta y sin metodo en el activo, la columna lo deja desconocido", () => {
        // Desconocido no es un método: es lo que hace que el aviso de «no comparable» salte.
        const [columna] = columnasDeActivos([{ activo: activo() }]);
        expect(columna?.metodo).toBeUndefined();
        expect(columna?.frecuencia).toBeUndefined();
    });
});

/* Dos columnas con su Sharpe 3A, para que la fila que el informe imprime exista de verdad. */
const columna = (id: string, metodo?: string, frecuencia?: string): ColumnaComparada =>
    ({ id, nombre: id, apunte: id, metodo, frecuencia }) as ColumnaComparada;

const filaSharpe = (valores: Record<string, number | undefined>): FilaComparada =>
    ({
        id: "sharpe-3y",
        titulo: "Sharpe 3 años",
        comparable: true,
        valor: (c: ColumnaComparada) => valores[c.id],
        celda: () => ({ texto: "" })
    }) as unknown as FilaComparada;

describe("el pie del informe describe las cifras que el informe imprime", () => {
    it("toma el metodo de la columna que dio cada cifra, no de otra fuente", () => {
        const { noComparable, footnote } = metodologiaDeLaComparativa(
            [columna("a", "EXTRACTOR_MONTHLY_V1", "MONTHLY"), columna("b", "GEOMETRIC_CAGR", "WEEKLY")],
            [filaSharpe({ a: -0.0935, b: 0.4984 })]
        );
        // Dos metodos distintos entre las cifras presentes: el informe tiene que avisar, y nombrar el de cada uno.
        expect(noComparable?.columnas).toEqual(["sharpe-3y"]);
        expect(noComparable?.sinDeclarar).toBe(false);
        expect(noComparable?.calculoDe).toEqual({ a: "con datos mensuales", b: "con datos semanales" });
        expect(footnote).toBe("Volatilidad y rentabilidad anualizadas.");
    });

    it("sin mezcla no hay aviso, y el pie dice el metodo", () => {
        const { noComparable, footnote } = metodologiaDeLaComparativa(
            [columna("a", "EXTRACTOR_MONTHLY_V2", "MONTHLY"), columna("b", "EXTRACTOR_MONTHLY_V2", "MONTHLY")],
            [filaSharpe({ a: 0.5, b: 0.6 })]
        );
        expect(noComparable).toBeUndefined();
        expect(footnote).toBe("Sharpe 3A: calculado por nosotros en euros, mensual. Volatilidad y rentabilidad anualizadas. Observaciones: mensuales.");
    });

    it("una cifra que no dice de que sale no se da por distinta: se dice que no se sabe", () => {
        const { noComparable } = metodologiaDeLaComparativa(
            [columna("a"), columna("b", "EXTRACTOR_MONTHLY_V2", "MONTHLY")],
            [filaSharpe({ a: 0.5, b: 0.6 })]
        );
        expect(noComparable?.sinDeclarar).toBe(true);
        expect(noComparable?.calculoDe).toEqual({ a: "sin método declarado", b: "con datos mensuales en euros" });
    });

    it("una columna sin cifra no aporta metodologia, aunque la declare", () => {
        /*
         * Es la asimetria que hacia falso el aviso en la otra direccion: el pie se calculaba
         * sobre los activos SELECCIONADOS y no sobre las cifras impresas, asi que podia avisar
         * de una mezcla que no estaba en el papel.
         */
        const { noComparable, footnote } = metodologiaDeLaComparativa(
            [columna("a", "EXTRACTOR_MONTHLY_V1", "MONTHLY"), columna("b", "GEOMETRIC_CAGR", "WEEKLY")],
            [filaSharpe({ a: -0.0935, b: undefined })]
        );
        expect(noComparable).toBeUndefined();
        expect(footnote).toContain("mensual");
        expect(footnote).not.toContain("semanales");
    });

    it("sin la fila del Sharpe no inventa ninguna metodologia", () => {
        const { noComparable, footnote } = metodologiaDeLaComparativa([columna("a", "EXTRACTOR_MONTHLY_V1", "MONTHLY")], []);
        expect(noComparable).toBeUndefined();
        expect(footnote).toBe("Volatilidad y rentabilidad anualizadas.");
    });
});

describe("lo que la pantalla marca «No comparable entre sí» llega al papel (decisión 42)", () => {
    const delTipo = (id: string, tipo: string, metrics: Record<string, unknown>) =>
        ({ asset_id: id, display_name: id, isin: id, instrument_type: tipo, metrics }) as unknown as FuenteDeColumna["activo"];
    const metricasDeTarjeta = (metodo: string, frecuencia: string) => ({
        method: metodo,
        frequency: frecuencia,
        annualized_return: { "1y": 0.07, "3y": 0.16, "5y": 0.04, "10y": 0.12 },
        volatility: { "1y": 0.17, "3y": 0.16 },
        sharpe: { "3y": 0.82 },
        max_drawdown: { "3y": -0.26 }
    });

    /* La muestra: una acción de la base anterior, sin tarjeta y en semanal, y dos fondos con la tarjeta en mensual. */
    const accionSinTarjeta: FuenteDeColumna = {
        activo: delTipo("CBA", "STOCK", {
            annualized_return_1y: 0.08,
            annualized_return_3y: 0.25,
            annualized_return_5y: 0.12,
            annualized_return_10y: 0.11,
            volatility_1y: 0.27,
            volatility_3y: 0.22,
            sharpe_3y: 0.98,
            metrics_method: "GEOMETRIC_CAGR",
            metrics_frequency: "WEEKLY"
        })
    };
    const conTarjeta = (id: string, tipo: string, metodo: string, frecuencia: string): FuenteDeColumna => ({
        activo: delTipo(id, tipo, {}),
        tarjeta: { instrument_type: tipo, metrics: metricasDeTarjeta(metodo, frecuencia) } as unknown as FuenteDeColumna["tarjeta"]
    });
    const fondo = (id: string) => conTarjeta(id, "FUND", "EXTRACTOR_MONTHLY_V2", "MONTHLY");
    const muestra = [accionSinTarjeta, fondo("BONOS"), fondo("NEWGEMS")];
    const leerFilas = (fuentes: FuenteDeColumna[]) => filasDeActivos(fuentes, { modoCliente: false });

    it("con la muestra: rentabilidades y volatilidades mezclan, y el Sharpe y la caída no, porque la acción no los imprime", () => {
        const { noComparable, footnote } = metodologiaDeLaComparativa(columnasDeActivos(muestra), leerFilas(muestra));
        expect(noComparable?.columnas).toEqual([
            "annualized_return-1y",
            "annualized_return-3y",
            "annualized_return-5y",
            "annualized_return-10y",
            "volatility-1y",
            "volatility-3y"
        ]);
        expect(noComparable?.calculoDe).toEqual({
            CBA: "con datos semanales",
            BONOS: "con datos mensuales en euros",
            NEWGEMS: "con datos mensuales en euros"
        });
        expect(footnote).toBe("Volatilidad y rentabilidad anualizadas.");
    });

    it("el método es de cada activo: una acción va a diario y una cifra del proveedor es del proveedor", () => {
        const fuentes = [
            conTarjeta("IBERDROLA", "STOCK", "EXTRACTOR_DAILY_V2", "DAILY"),
            conTarjeta("FIDELITY", "FUND", "TRAILING_PROVIDER", "PROVIDER"),
            conTarjeta("DPAM", "FUND", "EXTRACTOR_MONTHLY_V2", "MONTHLY")
        ];
        const { noComparable } = metodologiaDeLaComparativa(columnasDeActivos(fuentes), leerFilas(fuentes));
        expect(noComparable?.calculoDe).toEqual({
            IBERDROLA: "con datos diarios en euros",
            FIDELITY: "con la cifra del proveedor",
            DPAM: "con datos mensuales en euros"
        });
        /* Del Sharpe solo quedan los dos fondos, y aun así mezclan; en lo demás, los tres. */
        expect(noComparable?.columnas).toEqual([...COLUMNAS_DEL_INFORME]);
    });

    it("un activo sin ninguna cifra en lo marcado no se nombra: no hay nada suyo que comparar", () => {
        const sinCifras: FuenteDeColumna = { activo: delTipo("VACIO", "FUND", { metrics_method: "GEOMETRIC_CAGR", metrics_frequency: "WEEKLY" }) };
        const fuentes = [...muestra, sinCifras];
        const { noComparable } = metodologiaDeLaComparativa(columnasDeActivos(fuentes), leerFilas(fuentes));
        expect(Object.keys(noComparable?.calculoDe ?? {})).toEqual(["CBA", "BONOS", "NEWGEMS"]);
    });

    it("marca lo mismo que la tabla de la pantalla, salvo el Sortino, que no sale en el papel", () => {
        const proveedor = conTarjeta("OTRO", "FUND", "TRAILING_PROVIDER", "PROVIDER");
        const conSortino = {
            ...proveedor,
            tarjeta: { ...proveedor.tarjeta, metrics: { ...metricasDeTarjeta("TRAILING_PROVIDER", "PROVIDER"), sortino: { "3y": 1 } } }
        } as FuenteDeColumna;
        const fondoConSortino = {
            ...fondo("BONOS"),
            tarjeta: { instrument_type: "FUND", metrics: { ...metricasDeTarjeta("EXTRACTOR_MONTHLY_V2", "MONTHLY"), sortino: { "3y": 0.5 } } }
        } as unknown as FuenteDeColumna;
        const fuentes = [accionSinTarjeta, fondoConSortino, conSortino];
        const filas = leerFilas(fuentes);
        /* Sin enlace a la ficha: esta prueba no monta el enrutador, y la marca no depende de él. */
        const columnas = columnasDeActivos(fuentes).map((c) => ({ ...c, enlaceAFicha: undefined }));
        const html = renderToStaticMarkup(createElement(TablaComparativa, { columnas, filas, titulo: "Prueba" }));
        const enPantalla = filas
            .filter((f) => html.includes(`<tr class="tabla__fila--incomparable"><th scope="row">${f.titulo}`))
            .map((f) => f.id);
        expect(enPantalla).toContain("sortino-3y");
        expect(enPantalla).toContain("sharpe-3y");
        const { noComparable } = metodologiaDeLaComparativa(columnas, filas);
        expect(noComparable?.columnas).toEqual(enPantalla.filter((id) => id !== "sortino-3y"));
    });
});

describe("la ventana del informe", () => {
    it("escribe las fechas y los años como el resto del papel", () => {
        expect(ventanaDelInforme("2023-10-26", "2026-10-27", "3Y", 715, false)).toBe("26/10/2023 a 27/10/2026 · 3A · 715 obs. diarias");
        expect(ventanaDelInforme("2016-01-04", "2026-10-26", "10Y", 562, true)).toBe("04/01/2016 a 26/10/2026 · 10A · 562 obs. semanales");
        expect(ventanaDelInforme("2016-01-04", "2026-10-27", "10Y", 2610, false)).toBe("04/01/2016 a 27/10/2026 · 10A · 2.610 obs. diarias");
    });

    it("lo que no llega no se escribe como una fecha", () => {
        expect(ventanaDelInforme("2023-10-26", undefined, "3Y", 715, false)).toBe("26/10/2023 a Falta el dato · 3A · 715 obs. diarias");
        /* Año y medio no es «3A»: la misma regla que el resto del programa (decisión 80). */
        expect(ventanaDelInforme("2025-04-07", "2026-10-26", "3Y", 81, true)).toBe("07/04/2025 a 26/10/2026 · no llega a 3A · 81 obs. semanales");
    });
});

const fila = (id: string, valores: Record<string, number | undefined>): FilaComparada =>
    ({
        id,
        etiqueta: id,
        valor: (c: ColumnaComparada) => valores[c.id],
        celda: () => ({ texto: "" })
    }) as unknown as FilaComparada;

describe("el punto del mapa lleva sus cifras y su metodo de la misma fuente", () => {
    const filas = [
        fila("volatility-3y", { a: 0.047073, b: 0.262640 }),
        fila("annualized_return-3y", { a: 0.021452, b: 0.158316 })
    ];

    it("las coordenadas salen de las filas que pinta la tabla, no de otro sitio", () => {
        /*
         * El mapa dibuja un panel POR METODO para que dos cifras de metodos distintos no
         * compartan ejes. Hasta el 03-11-2026 tomaba el metodo de la columna y las dos
         * coordenadas de `activo.metrics`, asi que agrupaba por una etiqueta que no describia
         * los numeros pintados: con la etiqueta de uno y las cifras de otro, compartian ejes
         * igual y el panel no servia de nada.
         */
        const punto = puntoDeLaComparativa(columna("b", "GEOMETRIC_CAGR", "WEEKLY"), filas);
        expect(punto.volatilidad).toBeCloseTo(0.26264, 10);
        expect(punto.rentabilidad).toBeCloseTo(0.158316, 10);
        expect(punto.metodo).toBe("GEOMETRIC_CAGR");
    });

    it("una cifra que no esta se queda sin estar: no se rellena con otra fuente", () => {
        // La regla del dato de este proyecto: si una cifra no esta, se dice que no esta.
        const punto = puntoDeLaComparativa(columna("sin-datos", "EXTRACTOR_MONTHLY_V1"), filas);
        expect(punto.volatilidad).toBeUndefined();
        expect(punto.rentabilidad).toBeUndefined();
    });
});


describe("un ETF se compara con un fondo, y su columna dice sobre que precio", () => {
    const conPrecio = {
        metrics: { method: "EXTRACTOR_MONTHLY_V2", frequency: "MONTHLY", series_class: "MARKET_PRICE" }
    } as unknown as FuenteDeColumna["tarjeta"];

    it("la cabecera lo dice y el metodo sigue siendo el de los fondos", () => {
        const [etf, fondo] = columnasDeActivos([
            { activo: activo(), tarjeta: conPrecio },
            { activo: activo(), tarjeta: tarjeta("EXTRACTOR_MONTHLY_V2", "MONTHLY") }
        ]);
        expect(etf?.apunte).toContain("precio de mercado");
        expect(fondo?.apunte).not.toContain("precio de mercado");
        expect(etf?.metodo).toBe(fondo?.metodo);
    });
});


describe("dos columnas a cierres distintos lo dicen", () => {
    const aCierre = (asOf: string) =>
        ({ metrics: { method: "EXTRACTOR_MONTHLY_V2", frequency: "MONTHLY", as_of: asOf } }) as unknown as FuenteDeColumna["tarjeta"];

    it("si difieren, cada cabecera lleva el suyo", () => {
        const [a, b] = columnasDeActivos([
            { activo: activo(), tarjeta: aCierre("2026-09-30") },
            { activo: activo(), tarjeta: aCierre("2026-10-31") }
        ]);
        expect(a?.apunte).toContain("30/09/2026");
        expect(b?.apunte).toContain("31/10/2026");
    });

    it("si coinciden, no se repite en cada columna", () => {
        const [a] = columnasDeActivos([
            { activo: activo(), tarjeta: aCierre("2026-10-31") },
            { activo: activo(), tarjeta: aCierre("2026-10-31") }
        ]);
        expect(a?.apunte).not.toContain("oct");
    });
});


describe("lo que no aplica a una accion se dice, con o sin tarjeta", () => {
    const delTipo = (id: string, tipo: string, extra: Record<string, unknown> = {}) =>
        ({
            asset_id: id,
            display_name: id,
            isin: id,
            instrument_type: tipo,
            metrics: { sharpe_3y: 0.98, metrics_method: "GEOMETRIC_CAGR", metrics_frequency: "WEEKLY" },
            ...extra
        }) as unknown as FuenteDeColumna["activo"];
    const accionConTarjeta = {
        instrument_type: "STOCK",
        metrics: { method: "EXTRACTOR_DAILY_V2", frequency: "DAILY", sharpe: { "3y": 1.1 }, sortino: { "3y": 1.4 } }
    } as unknown as FuenteDeColumna["tarjeta"];
    const fondoConTarjeta = {
        instrument_type: "FUND",
        metrics: { method: "EXTRACTOR_MONTHLY_V2", frequency: "MONTHLY", sharpe: { "3y": 0.9 }, sortino: { "3y": 1.2 } }
    } as unknown as FuenteDeColumna["tarjeta"];

    /* Una tabla mixta: la acción de la base anterior, sin tarjeta; la que sí la tiene; y un fondo. */
    const fuentes: FuenteDeColumna[] = [
        { activo: delTipo("sin-tarjeta", "STOCK", { morningstar_rating: 3 }) },
        { activo: delTipo("con-tarjeta", "STOCK"), tarjeta: accionConTarjeta },
        { activo: delTipo("fondo", "FUND", { morningstar_rating: 4 }), tarjeta: fondoConTarjeta }
    ];
    const retroPorActivo = new Map([["fondo", 0.0079], ["sin-tarjeta", 0.5]]);
    const filas = filasDeActivos(fuentes, { modoCliente: false, retroPorActivo });
    const columnas = columnasDeActivos(fuentes);
    const celda = (fila: string, columna: number) => filas.find((f) => f.id === fila)?.celda(columnas[columna]!);

    it.each(["sharpe-3y", "sortino-3y", "estrellas", "retro"])("%s: No aplica en las dos acciones, y no como un hueco", (fila) => {
        for (const columna of [0, 1]) {
            expect(celda(fila, columna)).toEqual({ texto: "No aplica", ausencia: "no-aplica" });
        }
        expect(celda(fila, 2)?.ausencia).toBeUndefined();
    });

    it("la cifra de una accion no entra en el aviso de metodos", () => {
        const sharpe = filas.find((f) => f.id === "sharpe-3y");
        expect(sharpe?.valor?.(columnas[0]!)).toBeUndefined();
        expect(sharpe?.valor?.(columnas[1]!)).toBeUndefined();
        expect(sharpe?.valor?.(columnas[2]!)).toBe(0.9);
    });

    it("el rótulo de las estrellas nombra a Morningstar solo con la fuente a la vista (H3-01)", () => {
        const fondoSolo = [fuentes[2]!];
        const titulo = (modoCliente: boolean) => filasDeActivos(fondoSolo, { modoCliente }).find((f) => f.id === "estrellas")?.titulo;
        expect(titulo(false)).toBe("Morningstar");
        expect(titulo(true)).toBe("Estrellas");
    });

    it("lo que falta en un fondo sigue diciendo que falta", () => {
        const fondoSinNada = [
            { activo: delTipo("fondo", "FUND"), tarjeta: { instrument_type: "FUND", metrics: { method: "M" } } as unknown as FuenteDeColumna["tarjeta"] }
        ];
        const [columna] = columnasDeActivos(fondoSinNada);
        const sortino = filasDeActivos(fondoSinNada, { modoCliente: false }).find((f) => f.id === "sortino-3y");
        expect(sortino?.celda(columna!)).toEqual({ texto: "Falta el dato", ausencia: "falta" });
    });

    it("en una tabla solo de acciones esas filas no salen: una fila entera de No aplica no dice nada", () => {
        const soloAcciones = fuentes.slice(0, 2);
        const ids = filasDeActivos(soloAcciones, { modoCliente: false, retroPorActivo }).map((f) => f.id);
        for (const id of ["sharpe-3y", "sortino-3y", "estrellas", "retro"]) expect(ids).not.toContain(id);
        expect(ids).toContain("volatility-3y");
    });

    /* Decisión 41: el papel lee la misma fila. Con o sin tarjeta, de una acción no sale cifra, y el PDF escribe «No aplica» por su tipo. */
    it.each(["AU000000BHP4", "AU000000BKY0", "AU000000CBA7", "ES0132955008", "JP3122400009", "JP3633400001", "JP3902900004"])(
        "%s, una de las 7 acciones sin tarjeta: su Sharpe de la base anterior no llega ni a la pantalla ni al informe",
        (isin) => {
            const mezcla: FuenteDeColumna[] = [{ activo: delTipo(isin, "STOCK") }, fuentes[2]!];
            const sharpe = filasDeActivos(mezcla, { modoCliente: false }).find((f) => f.id === "sharpe-3y");
            const [accion, otroFondo] = columnasDeActivos(mezcla);
            expect(sharpe?.valor?.(accion!)).toBeUndefined();
            expect(sharpe?.celda(accion!)).toEqual({ texto: "No aplica", ausencia: "no-aplica" });
            expect(sharpe?.valor?.(otroFondo!)).toBe(0.9);
        }
    );

    it("el pie del informe no cuenta la cifra de una acción", () => {
        expect(metodologiaDeLaComparativa(columnas, filas).noComparable?.columnas ?? []).not.toContain("sharpe-3y");
    });

    it("con Modo cliente la cabecera no dice de que base viene la cifra", () => {
        const [conAsesor] = columnasDeActivos(fuentes);
        const [conCliente] = columnasDeActivos(fuentes, { modoCliente: true });
        expect(conAsesor?.apunte).toContain("base anterior");
        expect(conCliente?.apunte).toBe("sin-tarjeta");
    });
});

/*
 * Revisión final (V3-5): una tarjeta con cifras nuestras y del proveedor (decisión 110) lleva las suyas a su fecha. Allianz AT2 en la base nueva: su
 * 1 año es nuestro a 31 oct; del proveedor, sus 3, 5 y 10 años a 30 sept y su volatilidad y Sharpe a 3 años a 31 oct. JPMorgan, todo nuestro a 31 oct.
 * Y Vanguard S&P 500: su 10 años es del proveedor, a 30 sept y en dólares.
 */
describe("cada cifra del papel, a su fecha y en su divisa, también las del proveedor", () => {
    const de = (asset_id: string, currency: string) => ({ asset_id, display_name: asset_id, currency, metrics: {} }) as unknown as FuenteDeColumna["activo"];
    const conTarjeta = (currency: string, metrics: Record<string, unknown>) =>
        ({ identity: { currency }, metrics: { method: "EXTRACTOR_MONTHLY_V2", frequency: "MONTHLY", as_of: "2026-10-31", ...metrics } }) as unknown as FuenteDeColumna["tarjeta"];
    const at2: FuenteDeColumna = {
        activo: de("LU1383852487", "EUR"),
        tarjeta: conTarjeta("EUR", {
            annualized_return: { "1y": 0.02 },
            volatility: { "1y": 0.002 },
            provider: { as_of: "2026-10-31", returns_as_of: "2026-09-30", annualized_return: { "3y": 0.0298, "5y": 0.0218, "10y": 0.0095 }, volatility: { "3y": 0.003 }, sharpe: { "3y": 1.2 } }
        })
    };
    const jpm: FuenteDeColumna = {
        activo: de("LU0430492750", "EUR"),
        tarjeta: conTarjeta("EUR", { annualized_return: { "1y": -0.028, "3y": 0.028, "5y": -0.017, "10y": -0.001 }, volatility: { "1y": 0.049, "3y": 0.046 } })
    };
    const vanguard: FuenteDeColumna = {
        activo: de("IE00B3XXRP09", "USD"),
        tarjeta: conTarjeta("USD", {
            annualized_return: { "1y": 0.158, "3y": 0.212, "5y": 0.126 },
            provider: { as_of: "2026-10-31", returns_as_of: "2026-09-30", annualized_return: { "10y": 0.1498 } }
        })
    };

    it("AT2 y JPMorgan: la fecha de las del proveedor, que no es la de las demás, se dice con sus columnas", () => {
        const notas = fechaYDivisaDeLasCifras([at2, jpm]);
        expect(notas.get("LU1383852487")).toEqual({ cierre: "2026-10-31", delProveedor: [{ columnas: ["3A", "5A", "10A"], fecha: "2026-09-30" }] });
        expect(notas.get("LU0430492750")).toEqual({ cierre: "2026-10-31" });
    });

    it("Vanguard y JPMorgan: su 10 años del proveedor, a su fecha y sin convertir; lo demás suyo, en euros", () => {
        const notas = fechaYDivisaDeLasCifras([vanguard, jpm]);
        expect(notas.get("IE00B3XXRP09")).toEqual({ cierre: "2026-10-31", delProveedor: [{ columnas: ["10A"], fecha: "2026-09-30", sinConvertir: "USD" }] });
        expect(notas.get("LU0430492750")).toEqual({ cierre: "2026-10-31" });
    });

    it("todo a la misma fecha y en euros: no hay nada que decir", () => {
        const notas = fechaYDivisaDeLasCifras([jpm, { ...jpm, activo: de("OTRO", "EUR") }]);
        expect(notas.get("LU0430492750")).toEqual({});
        expect(notas.get("OTRO")).toEqual({});
    });
});

/*
 * Decisión 114: la rentabilidad del proveedor a 1 año no lleva fecha. Llega de otra respuesta suya y, en muchos fondos, es del cierre del mes siguiente al
 * de su bloque: JPMorgan Taiwan D (acc) da a 1 año exactamente su serie a 30 oct, y a 3 años, a 30 sept. Sus 3, 5 y 10 años y su riesgo sí son de esa fecha.
 * Hamco Global Value: nuestro «En el año» y, del proveedor, 1, 3 y 5 años a 30 sept. JPMorgan Taiwan A (dist): todas sus cifras del proveedor.
 */
describe("la rentabilidad del proveedor a 1 año, sin fecha (decisión 114)", () => {
    const de = (asset_id: string, currency: string) => ({ asset_id, display_name: asset_id, currency, metrics: {} }) as unknown as FuenteDeColumna["activo"];
    const tarjeta = (currency: string, metrics: Record<string, unknown>) =>
        ({ identity: { currency }, metrics }) as unknown as FuenteDeColumna["tarjeta"];
    const hamco: FuenteDeColumna = {
        activo: de("LU3038481936", "EUR"),
        tarjeta: tarjeta("EUR", {
            method: "EXTRACTOR_MONTHLY_V2", frequency: "MONTHLY", as_of: "2026-10-31", ytd_return: 0.105115,
            provider: { as_of: "2026-09-30", annualized_return: { "1y": 0.146205, "3y": 0.09670632, "5y": 0.13526445 } }
        })
    };
    const jpm: FuenteDeColumna = {
        activo: de("LU0430492750", "EUR"),
        tarjeta: tarjeta("EUR", { method: "EXTRACTOR_MONTHLY_V2", frequency: "MONTHLY", as_of: "2026-10-31", annualized_return: { "1y": -0.028, "3y": 0.028 } })
    };
    const taiwan = (as_of: string): FuenteDeColumna => ({
        activo: de("LU0117843481", "USD"),
        tarjeta: tarjeta("USD", {
            method: "TRAILING_PROVIDER", frequency: "PROVIDER", as_of,
            annualized_return: { "1y": 0.6185959, "3y": 0.47902919, "5y": 0.21078524, "10y": 0.18290975 }, volatility: { "1y": 0.5088, "3y": 0.3358 }
        })
    });

    it("en la pantalla, la celda del proveedor a 1 año dice de quién es y que no tiene fecha; las de 3 y 5 años, su fecha", () => {
        const fuentes = [hamco, jpm];
        const [columna] = columnasDeActivos(fuentes);
        const filas = filasDeActivos(fuentes, { modoCliente: false });
        const celda = (id: string) => filas.find((f) => f.id === id)!.celda(columna!);
        expect(celda("annualized_return-1y")).toMatchObject({ texto: "+14,62\u00a0%", apunte: "Del proveedor, sin fecha" });
        expect(celda("annualized_return-3y")).toMatchObject({ texto: "+9,67\u00a0%", apunte: "Del proveedor · a 30/09/2026" });
        expect(celda("annualized_return-5y").apunte).toBe("Del proveedor · a 30/09/2026");
    });

    it("una columna toda del proveedor con su fecha en la cabecera: sus rentabilidades dicen que no la tienen, y su riesgo va con la de la cabecera (decisión 119)", () => {
        const fuentes = [taiwan("2026-09-30"), jpm];
        const [columna] = columnasDeActivos(fuentes);
        expect(columna?.apunte).toBe("LU0117843481 · proveedor · a 30/09/2026");
        const filas = filasDeActivos(fuentes, { modoCliente: false });
        const celda = (id: string) => filas.find((f) => f.id === id)!.celda(columna!);
        expect(celda("annualized_return-1y")).toMatchObject({ texto: "+61,86\u00a0%", apunte: "Sin fecha" });
        expect(celda("annualized_return-3y")).toMatchObject({ texto: "+47,90\u00a0%", apunte: "Sin fecha" });
        expect(celda("annualized_return-5y")).toMatchObject({ texto: "+21,08\u00a0%", apunte: "Sin fecha" });
        expect(celda("annualized_return-10y")).toMatchObject({ texto: "+18,29\u00a0%", apunte: "Sin fecha" });
        expect(celda("volatility-1y")).toMatchObject({ texto: "50,88\u00a0%" });
        expect(celda("volatility-1y").apunte).toBeUndefined();
        expect(celda("volatility-3y").apunte).toBeUndefined();
        /* La columna de al lado, toda nuestra, no cambia: su cabecera dice su fecha y sus celdas no llevan apunte. */
        const [, suya] = columnasDeActivos(fuentes);
        expect(suya?.apunte).toBe("LU0430492750 · a 31/10/2026");
        expect(filas.find((f) => f.id === "annualized_return-3y")!.celda(suya!).apunte).toBeUndefined();
    });

    it("una rentabilidad que falta dice que falta, sin «Sin fecha» (decisión 119)", () => {
        const sinDiez: FuenteDeColumna = {
            ...taiwan("2026-09-30"),
            tarjeta: tarjeta("USD", { method: "TRAILING_PROVIDER", frequency: "PROVIDER", as_of: "2026-09-30", annualized_return: { "1y": 0.25, "3y": 0.2 } })
        };
        const fuentes = [sinDiez, jpm];
        const [columna] = columnasDeActivos(fuentes);
        const filas = filasDeActivos(fuentes, { modoCliente: false });
        const celda = (id: string) => filas.find((f) => f.id === id)!.celda(columna!);
        expect(celda("annualized_return-3y")).toMatchObject({ texto: "+20,00\u00a0%", apunte: "Sin fecha" });
        expect(celda("annualized_return-10y")).toMatchObject({ texto: "Falta el dato", ausencia: "falta" });
        expect(celda("annualized_return-10y").apunte).toBeUndefined();
        expect(fechaYDivisaDeLasCifras(fuentes).get("LU0117843481")).toEqual({
            cierre: "2026-09-30", sinConvertir: "USD", delProveedor: [{ columnas: ["1A", "3A"], sinFecha: true }]
        });
    });

    it("sin fecha en la cabecera no hay nada que matizar", () => {
        const fuentes = [taiwan("2026-10-31"), jpm];
        const [columna] = columnasDeActivos(fuentes);
        expect(columna?.apunte).toBe("LU0117843481 · proveedor");
        const filas = filasDeActivos(fuentes, { modoCliente: false });
        for (const id of ["annualized_return-1y", "annualized_return-3y", "annualized_return-5y", "annualized_return-10y", "volatility-1y"]) {
            expect(filas.find((f) => f.id === id)!.celda(columna!).apunte).toBeUndefined();
        }
    });

    it("en el papel, su 1A va aparte y «sin fecha», detrás de las que la tienen", () => {
        const notas = fechaYDivisaDeLasCifras([hamco, jpm]);
        expect(notas.get("LU3038481936")).toEqual({
            cierre: "2026-10-31",
            delProveedor: [{ columnas: ["3A", "5A"], fecha: "2026-09-30" }, { columnas: ["1A"], sinFecha: true }]
        });
        expect(notas.get("LU0430492750")).toEqual({ cierre: "2026-10-31" });
    });

    it("en el papel, la columna toda del proveedor lleva su fecha y su divisa, y sus rentabilidades, «sin fecha» (decisión 119)", () => {
        const notas = fechaYDivisaDeLasCifras([taiwan("2026-09-30"), jpm]);
        expect(notas.get("LU0117843481")).toEqual({ cierre: "2026-09-30", sinConvertir: "USD", delProveedor: [{ columnas: ["1A", "3A", "5A", "10A"], sinFecha: true }] });
        expect(notas.get("LU0430492750")).toEqual({ cierre: "2026-10-31" });
    });

    /*
     * Decisión 119: el caso que la abrió. JPMorgan Taiwan A (dist) con Allianz AT2, en la base nueva. Las dos tarjetas son del 31 oct, y las del proveedor de
     * AT2, del 30 sept: el papel pone fechas. Taiwan las lleva todas del proveedor, a la fecha de su riesgo, y sus rentabilidades son del 30 sept.
     */
    it("en el papel, Taiwan A con AT2: «a 31 oct» ya no cubre sus rentabilidades, y sí su riesgo", () => {
        const at2: FuenteDeColumna = {
            activo: de("LU1383852487", "EUR"),
            tarjeta: tarjeta("EUR", {
                method: "EXTRACTOR_MONTHLY_V2", frequency: "MONTHLY", as_of: "2026-10-31", annualized_return: { "1y": 0.02 }, volatility: { "1y": 0.002 },
                provider: { as_of: "2026-10-31", returns_as_of: "2026-09-30", annualized_return: { "3y": 0.0298, "5y": 0.0218, "10y": 0.0095 }, volatility: { "3y": 0.003 }, sharpe: { "3y": 1.2 } }
            })
        };
        const notas = fechaYDivisaDeLasCifras([taiwan("2026-10-31"), at2]);
        expect(notas.get("LU0117843481")).toEqual({ cierre: "2026-10-31", sinConvertir: "USD", delProveedor: [{ columnas: ["1A", "3A", "5A", "10A"], sinFecha: true }] });
        expect(notas.get("LU1383852487")).toEqual({ cierre: "2026-10-31", delProveedor: [{ columnas: ["3A", "5A", "10A"], fecha: "2026-09-30" }] });
        /* En pantalla, las dos cabeceras son del 31 oct y no dicen fecha: nada que matizar en Taiwan. */
        const fuentes = [taiwan("2026-10-31"), at2];
        const [columna] = columnasDeActivos(fuentes);
        expect(columna?.apunte).toBe("LU0117843481 · proveedor");
        expect(filasDeActivos(fuentes, { modoCliente: false }).find((f) => f.id === "annualized_return-3y")!.celda(columna!).apunte).toBeUndefined();
    });

    it("si el papel no pone ninguna fecha, no hay nada que decir de la del 1A: solo la divisa", () => {
        const notas = fechaYDivisaDeLasCifras([taiwan("2026-10-31"), jpm]);
        expect(notas.get("LU0117843481")).toEqual({ sinConvertir: "USD" });
        expect(notas.get("LU0430492750")).toEqual({});
    });
});

/*
 * §3 del método (20-11-2026): la caída a 3 años del proveedor, donde no hay la nuestra, no comparte fila con las nuestras sin decirlo.
 * Hasta ese día la fila no miraba de quién era la cifra: la marca «No comparable entre sí» no podía saltar y la celda no decía «Del proveedor».
 */
describe("la caída del proveedor junto a las nuestras (§3 del método)", () => {
    const de = (asset_id: string) => ({ asset_id, display_name: asset_id, currency: "EUR", metrics: {} }) as unknown as FuenteDeColumna["activo"];
    const conTarjeta = (asset_id: string, metrics: Record<string, unknown>): FuenteDeColumna => ({
        activo: de(asset_id),
        tarjeta: { identity: { currency: "EUR" }, metrics } as unknown as FuenteDeColumna["tarjeta"]
    });
    const nuestra = conTarjeta("LU0000000001", { method: "EXTRACTOR_MONTHLY_V4", frequency: "MONTHLY", as_of: "2026-10-31", max_drawdown: { "3y": -0.12 } });
    const suya = conTarjeta("LU0000000002", {
        method: "EXTRACTOR_MONTHLY_V4", frequency: "MONTHLY", as_of: "2026-10-31",
        provider: { as_of: "2026-10-31", max_drawdown: { "3y": -0.2 } }
    });

    it("la fila se marca, la celda dice de quién es y el papel la cuenta entre las no comparables", () => {
        const fuentes = [nuestra, suya];
        const columnas = columnasDeActivos(fuentes);
        const filas = filasDeActivos(fuentes, { modoCliente: false });
        const caida = filas.find((f) => f.id === "caida-3y")!;
        expect(caida.metodoDe?.(columnas[1]!)).toEqual({ metodo: "TRAILING_PROVIDER", frecuencia: "PROVIDER" });
        expect(caida.metodoDe?.(columnas[0]!)).toBeUndefined();
        expect(caida.celda(columnas[1]!).apunte).toBe("Del proveedor · a 31/10/2026");
        const html = renderToStaticMarkup(createElement(TablaComparativa, { columnas, filas: [caida], titulo: "t" }));
        expect(html).toContain("No comparable entre sí");
        expect(metodologiaDeLaComparativa(columnas, filas).noComparable?.columnas).toContain("caida-3y");
    });

    it("dos caídas nuestras del mismo método comparten fila sin marca", () => {
        const otra = conTarjeta("LU0000000003", { method: "EXTRACTOR_MONTHLY_V4", frequency: "MONTHLY", as_of: "2026-10-31", max_drawdown: { "3y": -0.08 } });
        const fuentes = [nuestra, otra];
        const columnas = columnasDeActivos(fuentes);
        const caida = filasDeActivos(fuentes, { modoCliente: false }).find((f) => f.id === "caida-3y")!;
        expect(renderToStaticMarkup(createElement(TablaComparativa, { columnas, filas: [caida], titulo: "t" }))).not.toContain("No comparable entre sí");
    });
});

/*
 * La caída máxima, en rojo (propuesta C3 de las láminas, aprobada por Óscar el 21-11-2026): una caída es siempre una pérdida. Se pinta
 * por la cifra tal como se escribe, a dos decimales del %: −0,12 se escribe «−12,00 %» y va en rojo; −0,00004 se escribe «0,00 %» y,
 * como 0, va sin color; una positiva (un error del dato) no lleva color, y nunca el verde.
 */
describe("la caída máxima de la tabla comparada, en rojo", () => {
    /* El formato común separa la unidad con un espacio que no parte línea; aquí se lee como un espacio. */
    const plano = (texto: string | undefined) => texto?.replace(/\s/g, " ");
    const conCaida = (asset_id: string, valor: number | undefined): FuenteDeColumna => ({
        activo: { asset_id, display_name: asset_id, currency: "EUR", metrics: {} } as unknown as FuenteDeColumna["activo"],
        tarjeta: { identity: { currency: "EUR" }, metrics: { method: "EXTRACTOR_MONTHLY_V4", frequency: "MONTHLY", as_of: "2026-10-31", ...(valor === undefined ? {} : { max_drawdown: { "3y": valor } }) } } as unknown as FuenteDeColumna["tarjeta"]
    });
    const fuentes = [conCaida("A", -0.12), conCaida("B", 0), conCaida("C", -0.00004), conCaida("D", 0.05), conCaida("E", undefined)];
    const columnas = columnasDeActivos(fuentes);
    const caida = filasDeActivos(fuentes, { modoCliente: false }).find((f) => f.id === "caida-3y")!;

    it("una pérdida escrita lleva el signo de lo que baja; cero, ninguno; una positiva no va en verde; la que falta, nada", () => {
        expect(columnas.map((c) => caida.celda(c).signo)).toEqual(["baja", undefined, undefined, undefined, undefined]);
        expect(plano(caida.celda(columnas[0]!).texto)).toBe("−12,00 %");
        expect(plano(caida.celda(columnas[2]!).texto)).toBe("0,00 %");
    });

    it("en la tabla, la de A en rojo con la clase de la pieza Cifra", () => {
        const html = renderToStaticMarkup(createElement(TablaComparativa, { columnas, filas: [caida], titulo: "t" }));
        expect(plano(html)).toContain('<span class="cifra cifra--baja">−12,00 %</span>');
        expect(html.match(/cifra--baja/g)).toHaveLength(1);
        expect(html).not.toContain("cifra--sube");
    });
});
