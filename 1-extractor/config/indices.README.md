# `indices.csv`: cómo se aprueba una fila

*Escrito el 07-11-2026 junto a la tabla porque el CSV no admite comentarios. Lo lee `core/indices.py`,
que es quien impone lo que aquí se dice que se impone. Las decisiones citadas están en
`DECISIONES_DATOS_2026-11-07.md`, en la raíz del proyecto.*

Cada fila dice contra qué serie se miden beta, R², alfa y tracking error de los fondos que declaran
ese índice. **Un proxy mal elegido desplaza en silencio todos los alfas medidos contra él**, y no hay
auditoría que lo cace después. Por eso una fila no se añade: se aprueba.

## Las columnas

| Columna | Qué es | Quién lo impone |
|---|---|---|
| `benchmark` | Nombre del índice tal como lo declaran los fondos, sin divisa | `pliega` lo normaliza |
| `variante` | `NR`, `GR`, `PR` o `TR`; vacía solo en las tasas | la clave de la tabla la lleva (decisión 28) |
| `proxy` | ISIN del instrumento, `ESTR_BCE` para una tasa, o `CODIGO.INDX` para un nivel de índice | `carga` rechaza un nivel de índice sin `.INDX`, y al revés |
| `clase_de_serie` | `VALOR_LIQUIDATIVO`, `PRECIO_DE_MERCADO`, `TASA` o `NIVEL_DE_INDICE` | `carga`; viaja a la base y separa lo comparable (§3 del método) |
| `base` | `TOTAL_RETURN` o `PRICE_RETURN`: si la serie lleva los dividendos | `metricas.relativas` no calcula alfa contra `PRICE_RETURN` |
| `fondos` | Cuántos la declaraban al aprobarla; es un recuento, no una regla | nadie |
| `nota` | Qué instrumento es, sus excepciones, y **quién lo aprobó y cuándo** | una prueba exige la frase en las filas aprobadas |
| `equivalente_de` | Índices declarados que esta fila sustituye, separados por `;` | `carga`; la cifra dice contra qué se midió |

Formato: UTF-8, saltos de línea CRLF, y toda nota con una coma va entre comillas; hay una prueba que
falla si una nota se parte.

## Las condiciones de un instrumento proxy

1. **Acumulación.** Un fondo que reparte tiene una serie de precio sin el dividendo; su alfa saldría
   inflado. La excepción son los ETF que reparten y cuya cotización se lee como cierre ajustado, y la
   nota lo dice.
2. **Sin cubrir.** Una clase cubierta a euros mide otro camino del tipo de cambio: medido el
   01-11-2026, 4,9 puntos a un año en el mismo fondo índice.
3. **Variante correcta.** La que declaran los fondos: un alfa contra NR cuando el fondo declara GR se
   desvía por la retención fiscal del índice.
4. **Réplica física.** Un sintético replica el índice con un swap; se admite solo como excepción
   aprobada por Óscar y la nota lo dice.
5. **Tamaño y serie.** Suficiente patrimonio y una serie en EODHD que cubra las ventanas de cinco años
   sin mes vacío.

Las dos primeras las comprueba el sistema sobre la ficha del propio proxy; las otras tres las
aprueba una persona, y la nota dice quién y cuándo (hoy, «aprobado por Oscar el dd-mm»).

## Cómo se elige el comparador cuando existen las dos series (decisión 33)

El comparador de una fila se elige al aprobarla y **no se cambia porque aparezca otra serie**:

1. **Si existe un instrumento aprobado y en producción, prevalece.** Es la alternativa que el cliente
   puede comprar y lleva la misma fiscalidad del dividendo que el fondo medido. Condición medible,
   cuando el índice exista en EODHD para comprobarlo: R² ≥ 99 % del instrumento contra su índice y
   deriva anual dentro de ±0,5 puntos.
2. **Sin instrumento aprobado, entra el nivel de índice** con la variante declarada, verificada por su
   deriva contra la de precio, sin mes vacío en los últimos cinco años y con divisa en el catálogo
   `INDX` de EODHD.
3. **Si el instrumento falla la condición del punto 1 en la medición anual**, la fila cambia al nivel
   de índice si lo hay, con retirada fechada (§10 de `METODO_PROPIO_METRICAS_2026-11-01.md`) de los
   fondos que midiese; si no lo hay, se queda sin comparador.

Razón medida (`INFORME_CRITERIO_INDICE_ETF_2026-11-07.md`, §2.1): los ETF europeos **ganan** a su
índice net return 0,2-0,5 puntos al año por recuperación de retención; medir contra el índice leería
esa fiscalidad como gestión.

## La medición anual

`python reports/vigila_proxies.py`, una vez al año, solo lectura. Para cada fila con instrumento mira
en `config/indices_vigilancia.csv` si existe la serie del índice con su variante; esa tabla la escribe
una persona, fila a fila, y **no se adivina por nombre** (EODHD llama «STXE 600 NRT» al STOXX Europe
600 NR). Toda fila con instrumento tiene su línea en ella, aunque sea para decir «sin serie»: una fila
nueva sin línea hace fallar la prueba, para que la pregunta se responda al aprobarla. El script
imprime R², deriva anualizada de log(proxy/índice) y meses comunes a 1, 3 y 5 años, marca PASA o
FALLA con los umbrales de arriba, y deja `reports/vigilancia_proxies_<fecha>.json`. No escribe en
`data/`, no toca esta tabla y usa una caché HTTP propia.
