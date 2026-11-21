import type { FichaInstrumento } from "../../src/types/fichaInstrumento";

/**
 * Dos instrumentos reales de la base nueva, leídos el 02-11-2026 después de rehacer
 * las 2.154 tarjetas de calidad, para probar el pintor sin base. Los usaba también la
 * vista previa de la ficha, que se retiró el 04-11-2026 (decisión 26).
 *
 * Ninguna cifra está inventada. Las frases en cursiva bajo «No aplica» son las que la
 * base guarda campo a campo en `quality/latest`, copiadas tal cual.
 */

/** El fondo: doce secciones declaradas, cobertura 46,3 % (105 campos de 227). */
export const FONDO_DE_MUESTRA: FichaInstrumento = {
  tipo: "FONDO DE INVERSIÓN",
  nombre: "Janus Henderson Horizon Euroland Fund A2 EUR",
  identificacion:
    "LU0011889846 · EUR · EAA Fund Eurozone Large-Cap Equity · índice del folleto MSCI EMU NR EUR",
  disponibilidad: { rotulo: "Disponibilidad", valor: "Sin medir", estado: "sin-medir" },
  aptitudes: [
    { rotulo: "Comparar su coste", valor: "1,87 %", estado: "si" },
    { rotulo: "Entrar en una radiografía", valor: "98,67 % renta variable", estado: "si" },
    { rotulo: "Comparar su rentabilidad", valor: "+15,84 % a 1 año", estado: "si" },
    { rotulo: "Medir su alfa", valor: "+3,72 % a 1 año", estado: "si" },
    { rotulo: "Métricas nuestras", valor: "Falta el dato", estado: "falta" }
  ],
  secciones: [
    {
      id: "precio",
      titulo: "Precio",
      procedencia: [{ texto: "Valor liquidativo", fuerte: true }, { texto: " del proveedor · 30 oct 2026" }],
      filas: [{ rotulo: "Último", valor: "99,55 €", destacada: true }]
    },
    {
      id: "rentabilidad",
      titulo: "Rentabilidad anualizada",
      /* La fecha, solo en 3, 5 y 10 años; y sin la nota de su categoría, que era la cifra de su índice (decisión 114, 06-11-2026). */
      procedencia: [{ texto: "Cifras " }, { texto: "del proveedor", fuerte: true }, { texto: " · 3, 5 y 10 años a 31 oct 2026" }],
      filas: [
        { rotulo: "1 año", valor: "+15,84 %" },
        { rotulo: "3 años", valor: "+19,96 %" },
        { rotulo: "5 años", valor: "+9,75 %" },
        { rotulo: "10 años", valor: "+8,64 %" },
        { rotulo: "En el año", valor: "+13,94 %" }
      ],
      nota: "Este fondo no tiene métricas propias nuestras."
    },
    {
      id: "riesgo",
      titulo: "Riesgo",
      procedencia: [{ texto: "Cifras " }, { texto: "del proveedor", fuerte: true }, { texto: " · 31 oct 2026" }],
      filas: [
        { rotulo: "Volatilidad 1 año", valor: "14,84 %" },
        { rotulo: "Volatilidad 3 años", valor: "11,47 %" },
        { rotulo: "Volatilidad 10 años", valor: "16,30 %" },
        { rotulo: "Sharpe 1 año", valor: "0,93" },
        { rotulo: "Sharpe 3 años", valor: "1,42" },
        { rotulo: "Sharpe 10 años", valor: "0,55" },
        {
          rotulo: "Caída máxima",
          valor: "Falta el dato",
          ausencia: "falta",
          glosa: "Doce rutas, de 1 a 10 años y en las tres referencias. El proveedor no la entrega."
        }
      ]
    },
    {
      id: "coste",
      titulo: "Coste",
      procedencia: [{ texto: "Del " }, { texto: "KID", fuerte: true }, { texto: " · 13 feb 2026" }],
      filas: [
        { rotulo: "Coste corriente", valor: "1,87 %" },
        { rotulo: "Comisión de gestión", valor: "1,20 %" },
        { rotulo: "Comisión de entrada (suscripción)", valor: "5,00 %" },
        { rotulo: "Costes de operación", valor: "0,19 %" },
        { rotulo: "Comisión de éxito", valor: "Falta el dato", ausencia: "falta" },
        { rotulo: "Comisión de salida (reembolso)", valor: "Falta el dato", ausencia: "falta" }
      ],
      nota: "La comisión de entrada es un máximo, no lo que se paga siempre. La de gestión y la de salida son del proveedor. La de éxito, si la cobra, consta en su KID."
    },
    {
      id: "regulatorio",
      titulo: "Indicador regulatorio",
      procedencia: [
        { texto: "KID de PRIIPs", fuerte: true },
        { texto: " y " },
        { texto: "UCITS", fuerte: true },
        { texto: " · 31 oct 2026" }
      ],
      filas: [
        { rotulo: "SRI, del KID de PRIIPs", valor: "4 de 7" },
        { rotulo: "SRRI, de UCITS", valor: "5 de 7" }
      ],
      nota:
        "Dos normativas con escalas distintas. Manda el SRI, porque hay KID detrás; el SRRI se enseña para que nadie lo busque fuera."
    },
    {
      id: "contra-indice",
      titulo: "Contra su índice",
      procedencia: [
        { texto: "Contra el " },
        { texto: "índice de categoría", fuerte: true },
        { texto: " del proveedor · 31 oct 2026" }
      ],
      filas: [
        { rotulo: "Beta 1 año", valor: "1,062" },
        { rotulo: "Beta 3 años", valor: "0,948" },
        { rotulo: "R² 1 año", valor: "0,93" },
        { rotulo: "Alfa de Jensen 1 año", valor: "+3,72 %" },
        { rotulo: "Alfa de Jensen 10 años", valor: "−0,68 %" },
        {
          rotulo: "El índice, en nuestra base",
          valor: "Pendiente de alta",
          ausencia: "sin-pedir",
          glosa:
            "Alfa calculada por el proveedor. Cuando demos de alta el índice, se calculará con nuestro método."
        }
      ],
      nota: "No es el índice del folleto (MSCI EMU NR EUR), y por eso se dice."
    },
    {
      id: "composicion",
      titulo: "Composición",
      procedencia: [{ texto: "Declarada por el proveedor · 30 sep 2026" }],
      filas: [
        { rotulo: "Renta variable", valor: "98,67 %" },
        { rotulo: "Efectivo", valor: "1,33 %" },
        { rotulo: "Alternativos e inmobiliario", valor: "Falta el dato", ausencia: "falta" }
      ],
      nota: "Declarado y completo. No suma 100 % de renta variable: hay un 1,33 % de efectivo."
    },
    {
      id: "sectores",
      titulo: "Sectores",
      procedencia: [{ texto: "Taxonomía del proveedor · 30 sep 2026" }],
      filas: [
        { rotulo: "Servicios financieros", valor: "22,98 %" },
        { rotulo: "Industriales", valor: "22,75 %" },
        { rotulo: "Tecnología", valor: "22,56 %" },
        { rotulo: "Consumo cíclico", valor: "6,84 %" },
        { rotulo: "Salud", valor: "5,64 %" },
        { rotulo: "Comunicación", valor: "4,94 %" },
        { rotulo: "Energía", valor: "4,37 %" },
        { rotulo: "Utilities", valor: "4,31 %" },
        { rotulo: "Consumo defensivo", valor: "4,15 %" },
        { rotulo: "Materiales básicos", valor: "1,47 %" }
      ]
    },
    {
      id: "regiones",
      titulo: "Regiones",
      procedencia: [{ texto: "Taxonomía del proveedor · 30 sep 2026" }],
      filas: [
        { rotulo: "Eurozona", valor: "96,53 %" },
        { rotulo: "Reino Unido", valor: "3,47 %" }
      ]
    },
    {
      id: "estilo",
      titulo: "Estilo y tamaño",
      procedencia: [{ texto: "Declarado por el proveedor · 30 sep 2026" }],
      filas: [
        { rotulo: "Mixto", valor: "36,89 %" },
        { rotulo: "Valor", valor: "31,55 %" },
        { rotulo: "Crecimiento", valor: "31,56 %" },
        { rotulo: "Grande", valor: "73,13 %" },
        { rotulo: "Mediana", valor: "22,54 %" },
        { rotulo: "Pequeña", valor: "4,34 %" }
      ]
    },
    {
      id: "rentas",
      titulo: "Rentas",
      procedencia: [
        { texto: "Registros de reparto", fuerte: true },
        { texto: " del proveedor · 31 oct 2026" }
      ],
      filas: [
        { rotulo: "Política declarada", valor: "Reparto" },
        { rotulo: "Rentabilidad por reparto, 12 meses", valor: "0,00 %" },
        { rotulo: "Último pago", valor: "1 jul 2021" }
      ],
      contradiccion:
        "Declara reparto y no reparte desde julio de 2021. Las dos cosas son ciertas: enseñar solo la política sería engañar."
    },
    {
      id: "perfil",
      titulo: "Perfil",
      procedencia: [{ texto: "Del " }, { texto: "folleto", fuerte: true }, { texto: " · 30 sep 2026" }],
      filas: [
        { rotulo: "Vehículo", valor: "UCITS" },
        { rotulo: "Réplica", valor: "Gestión activa" },
        {
          rotulo: "Artículo SFDR",
          valor: "No aplica",
          ausencia: "no-aplica",
          glosa: "Este fondo no se acoge a los artículos 8 ni 9 del reglamento."
        },
        { rotulo: "Clase de participación", valor: "Falta el dato", ausencia: "falta" }
      ]
    },
    {
      id: "patrimonio",
      titulo: "Patrimonio y sostenibilidad",
      procedencia: [{ texto: "Declarados por el proveedor · 30 y 31 oct 2026" }],
      filas: [
        { rotulo: "Patrimonio", valor: "1.007,8 M€" },
        { rotulo: "Sostenibilidad", valor: "4 de 5" }
      ],
      nota: "La sostenibilidad va en la escala del proveedor, de 1 a 5."
    },
    {
      id: "cartera",
      titulo: "Cartera",
      ancha: true,
      procedencia: [
        { texto: "Declarada por el proveedor · 30 sep 2026 · 50 posiciones, diez mayores 43,23 %" }
      ],
      filas: [],
      tabla: {
        columnas: ["Posición", "Sector", "Peso"],
        filas: [
          ["ASML Holding NV", "Tecnología", "6,83 %"],
          ["ASM International NV", "Tecnología", "5,86 %"],
          ["ING Groep NV", "Servicios financieros", "4,95 %"],
          ["UniCredit SpA", "Servicios financieros", "4,84 %"],
          ["Allianz SE", "Servicios financieros", "4,27 %"],
          ["Banco Santander SA", "Servicios financieros", "4,08 %"],
          ["Poste Italiane SpA", "Industriales", "3,43 %"],
          ["RELX PLC", "Industriales", "3,43 %"],
          ["Euronext NV", "Servicios financieros", "2,87 %"],
          ["Siemens AG", "Industriales", "2,68 %"]
        ]
      },
      nota: "Las diez mayores de cincuenta. Las otras cuarenta están en el documento de cartera."
    },
    {
      id: "calidad",
      titulo: "Procedencia y calidad",
      ancha: true,
      procedencia: [{ texto: "Paquete de " }, { texto: "2 nov 2026", fuerte: true }],
      filas: [
        { rotulo: "Nombre", valor: "morningstar_lt · 31 oct 2026" },
        { rotulo: "Categoría", valor: "morningstar_lt · 31 oct 2026" },
        { rotulo: "Divisa", valor: "morningstar_lt · 31 oct 2026" },
        { rotulo: "Cobertura", valor: "46,3 %" }
      ],
      nota:
        "105 campos presentes de 227 aplicables. De los 122 que faltan, 114 no nos los han dado, 6 no aplican y 2 están sin pedir —el índice de referencia, ahí arriba—. Su mayor hueco es de catálogo, no de histórico."
    }
  ]
};

/** La acción: cuatro secciones declaradas, cobertura 47,4 % (27 campos de 57). */
export const ACCION_DE_MUESTRA: FichaInstrumento = {
  tipo: "ACCIÓN",
  nombre: "Inmocemento, S.A.",
  identificacion: "ES0105836003 · X8G · EUR · Renta variable · Fráncfort",
  disponibilidad: { rotulo: "Cotizando", valor: "Comprobado hoy", estado: "cotiza" },
  aptitudes: [
    { rotulo: "Comparar su coste", valor: "No aplica", estado: "no-aplica" },
    { rotulo: "Entrar en una radiografía", valor: "100 % renta variable", estado: "si" },
    { rotulo: "Comparar su rentabilidad", valor: "+6,50 % a 1 año", estado: "si" },
    { rotulo: "Medir su alfa", valor: "No aplica", estado: "no-aplica" },
    { rotulo: "Métricas nuestras", valor: "Sí, método diario", estado: "si" }
  ],
  aviso: [
    { texto: "Sus métricas no se pueden ordenar junto a las de un fondo.", fuerte: true },
    {
      texto:
        " Las de esta acción salen de rentabilidades diarias y de ventanas contadas desde el último día de la serie; las de un fondo, de rentabilidades mensuales y meses cerrados. Son dos métodos, no dos juegos de datos, así que una tabla que ordene las dos cosas por volatilidad mezcla dos escalas."
    }
  ],
  secciones: [
    {
      id: "precio",
      titulo: "Precio",
      procedencia: [{ texto: "Precio de " }, { texto: "mercado", fuerte: true }, { texto: " · 30 oct 2026" }],
      filas: [{ rotulo: "Último", valor: "3,556 €", destacada: true }],
      nota:
        "De mercado, no valor liquidativo. Un fondo se suscribe al VL del día; una acción se compra al precio al que alguien la vende."
    },
    {
      id: "metricas",
      titulo: "Nuestras métricas",
      procedencia: [
        { texto: "Calculadas por nosotros", fuerte: true },
        { texto: " · método diario · 30 oct 2026" }
      ],
      filas: [],
      /* El 02-11-2026 esta sección dejó de ser cinco filas elegidas a mano. La caída
         máxima entró en sus tres ventanas —294 acciones al año, donde antes ninguna— y
         lo que queda sin calcular por el camino diario es el Sortino, que por eso no
         tiene fila: no se enseña un hueco de algo que nadie ha calculado todavía. */
      tabla: {
        columnas: ["", "1 año", "3 años", "5 años"],
        filas: [
          ["Rentabilidad anualizada", "+6,50 %", "—", "—"],
          ["Volatilidad", "31,87 %", "28,94 %", "30,11 %"],
          ["Caída máxima", "-18,20 %", "-31,40 %", "-46,36 %"],
          ["Sharpe", "0,14", "0,52", "0,38"]
        ],
        cifras: [1, 2, 3]
      },
      ancha: true,
      nota:
        "Una celda vacía es una ventana que la serie de este instrumento no cubre, no un cero. " +
        "El Sortino no aparece porque el cálculo diario todavía no lo produce."
    },
    {
      id: "equity",
      titulo: "La acción",
      procedencia: [{ texto: "Del " }, { texto: "proveedor", fuerte: true }, { texto: " · 30 oct 2026" }],
      filas: [
        { rotulo: "Mercado", valor: "Fráncfort" },
        { rotulo: "País", valor: "Alemania" },
        { rotulo: "Sector", valor: "Falta el dato", ausencia: "falta" },
        { rotulo: "Industria", valor: "Falta el dato", ausencia: "falta" },
        {
          rotulo: "Actividad",
          valor: "Falta el dato",
          ausencia: "falta",
          glosa: "El proveedor no entrega ninguno de los tres para este valor."
        }
      ]
    },
    {
      id: "composicion",
      titulo: "Composición",
      procedencia: [{ texto: "Derivada del tipo", fuerte: true }, { texto: ", no declarada" }],
      filas: [{ rotulo: "Renta variable", valor: "100 %" }],
      nota:
        "Una acción es renta variable por definición, así que este 100 % no lo ha medido nadie: se deduce de lo que es. En un fondo el mismo reparto viene declarado y por eso allí puede no sumar cien."
    },
    {
      id: "regulatorio",
      titulo: "Indicador regulatorio",
      procedencia: [{ texto: "No hay " }, { texto: "KID de PRIIPs", fuerte: true }, { texto: " detrás" }],
      filas: [
        {
          rotulo: "SRI, de 1 a 7",
          valor: "No aplica",
          ausencia: "no-aplica",
          glosa: "El indicador no existe para este producto. No es un dato que falte."
        },
        { rotulo: "SRRI, de UCITS", valor: "No aplica", ausencia: "no-aplica" }
      ],
      nota: "Lo que sí hay es nuestra volatilidad, con su método y su ventana al lado. Ahí arriba."
    },
    {
      id: "dividendos",
      titulo: "Dividendos",
      procedencia: [{ texto: "El bloque " }, { texto: "no existe", fuerte: true }, { texto: " para este valor" }],
      filas: [
        { rotulo: "Rentabilidad por dividendo prevista", valor: "Falta el dato", ausencia: "falta" },
        { rotulo: "Último pagado", valor: "Falta el dato", ausencia: "falta" },
        { rotulo: "Fecha ex-dividendo", valor: "Falta el dato", ausencia: "falta" },
        {
          rotulo: "Divisa del dividendo",
          valor: "No aplica",
          ausencia: "no-aplica",
          glosa: "Sin importe no hay divisa que declarar."
        }
      ]
    },
    {
      id: "calidad",
      titulo: "Procedencia y calidad",
      ancha: true,
      procedencia: [
        { texto: "Paquete de " },
        { texto: "2 nov 2026", fuerte: true },
        { texto: " · campos de " },
        { texto: "EODHD", fuerte: true },
        { texto: " a 30 oct 2026" }
      ],
      filas: [
        { rotulo: "Nombre, divisa y ticker", valor: "eodhd · 30 oct 2026" },
        { rotulo: "Mercado, país y valoración", valor: "eodhd · 30 oct 2026" },
        { rotulo: "Cobertura", valor: "47,4 %" }
      ],
      nota:
        "27 campos presentes de 57 aplicables. De los 30 que faltan, 28 no nos los han dado y 2 no aplican. Ninguno está sin pedir. Y 20 de los 30 son de métricas, así que su hueco es sobre todo histórico, no catálogo."
    }
  ]
};

/** La misma acción, dada de baja hace seis semanas. */
export const BAJA_DE_MUESTRA: FichaInstrumento = {
  tipo: "ACCIÓN",
  nombre: "ERCROS",
  identificacion: "ES0125140A14 · ECR · EUR · Renta variable",
  disponibilidad: { rotulo: "Dejó de cotizar", valor: "21 sep 2026", estado: "baja" },
  aptitudes: [
    { rotulo: "Comparar su coste", valor: "No aplica", estado: "no-aplica" },
    { rotulo: "Entrar en una radiografía", valor: "100 % renta variable", estado: "si" },
    { rotulo: "Comparar su rentabilidad", valor: "Sin serie", estado: "falta" },
    { rotulo: "Medir su alfa", valor: "No aplica", estado: "no-aplica" },
    { rotulo: "Métricas nuestras", valor: "Sin serie", estado: "falta" }
  ],
  secciones: [
    {
      id: "baja",
      titulo: "Por qué está marcada",
      procedencia: [{ texto: "Medido en la " }, { texto: "serie de precios", fuerte: true }, { texto: ", no afirmado" }],
      filas: [
        { rotulo: "Última cotización", valor: "21 sep 2026" },
        { rotulo: "Comprobado", valor: "2 nov 2026" }
      ],
      nota:
        "Medida en 37 documentos de serie. La base guarda el porqué, no solo el estado, y por eso la ficha lo puede enseñar."
    }
  ]
};
