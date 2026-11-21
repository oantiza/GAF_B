"""El proxy que replica cada índice de referencia, en un solo sitio.

Para calcular beta, R², alpha y tracking error hace falta la serie del índice, y
un índice no se puede traer: MSCI no la licencia barata. Lo que sí se puede traer
es un **fondo índice de acumulación**, que es un ISIN como cualquier otro.

Este fichero es la única tabla que dice qué proxy corresponde a qué benchmark.
Vive en `config/indices.csv` y se lee desde aquí, igual que el universo vive en
`config/fondos.csv`: si algún día cambia un proxy, se cambia en una línea y no en
los sitios donde se use. Es el mismo patrón que la allowlist de proyecto de la
plataforma, y por la misma razón: una elección copiada en dos sitios acaba
diciendo dos cosas.

**Por qué importa tanto acertar el proxy.** Medido el 01-11-2026 con las dos
clases del mismo fondo índice de MSCI World, una cubierta y otra sin cubrir: la
lectura cambia 4,9 puntos a un año y 1,7 anuales a cinco. Un proxy mal elegido
desplaza en silencio TODOS los alphas medidos contra él, y no hay auditoría que
lo cace después. Por eso cada fila declara su clase de serie y lleva su nota.

Las cinco condiciones de un proxy —acumulación, sin cubrir, variante correcta,
réplica física, tamaño— no se comprueban aquí. Dos de ellas las verifica el
sistema: la acumulación sale en `riesgo.historial_precios.politica` del propio
proxy, y la calidad de la serie en sus observaciones y fechas. Las otras tres las
aprueba una persona, y la nota de cada fila dice quién y cuándo.

**Cómo se elige el comparador de una fila cuando existen las dos series**, el
instrumento y el nivel del propio índice (DECISIONES_DATOS_2026-11-07.md, decisión
33). Se elige al aprobar la fila y no se cambia porque aparezca otra serie:

1. Si existe un instrumento aprobado y en producción, **prevalece**: es la
   alternativa que el cliente puede comprar y lleva la misma fiscalidad del
   dividendo que el fondo medido. Condición medible, cuando el índice exista en
   EODHD para comprobarlo: R² ≥ 99 % del instrumento contra su índice y deriva
   anual dentro de ±0,5 puntos.
2. Sin instrumento aprobado, entra el **nivel de índice** (`NIVEL_DE_INDICE`) con
   la variante declarada, verificada por su deriva contra la de precio, sin mes
   vacío en los últimos cinco años y con divisa en el catálogo `INDX`.
3. Si el instrumento **falla** la condición del punto 1 en la medición anual
   (`reports/vigila_proxies.py`), la fila cambia al nivel de índice si lo hay, con
   retirada fechada —§10 de METODO_PROPIO_METRICAS_2026-11-01.md— de los fondos
   que midiese; si no lo hay, se queda sin comparador.

Cómo se aprueba una fila, con esas condiciones y esta regla, está escrito junto a
la tabla en `config/indices.README.md`, porque el CSV no admite comentarios. Qué
fila tiene serie del índice para la medición anual lo dice
`config/indices_vigilancia.csv`, fila a fila y nunca adivinado por nombre.
"""
from __future__ import annotations

import csv
import re
from pathlib import Path

# El proxy de una TASA no es un instrumento: es la serie del €STR que el
# extractor ya trae del BCE para el Sharpe. Se nombra para que una fila de la
# tabla pueda apuntar a ella sin inventarse un ISIN.
PROXY_ESTR = "ESTR_BCE"

# Un NIVEL DE ÍNDICE tampoco es un instrumento: es la serie del propio índice en la bolsa
# `INDX` de EODHD (`IBEXTR.INDX`, `SP500TR.INDX`), que el plan sirve por `/eod` aunque
# `/search` no la encuentre (medido el 07-11-2026, INFORME_CAMINO_C_2026-11-07.md). La fila
# lleva el símbolo entero en `proxy`, y la clase lo exige con ese sufijo para que un ISIN o un
# símbolo de ETF no se cuelen como índice. Decisión 23 (DECISIONES_DATOS_2026-11-07.md): un
# alfa contra el nivel del índice NO se ordena con uno contra un ETF proxy, porque el ETF lleva
# dentro su coste y el índice nada; por eso la clase viaja a la base como `INDEX_LEVEL`.
BOLSA_INDICES = "INDX"

CLASES_DE_SERIE = ("VALOR_LIQUIDATIVO", "PRECIO_DE_MERCADO", "TASA", "NIVEL_DE_INDICE")

# La BASE del indice y la CLASE de su serie son dos cosas distintas, y el 01-11-2026
# las confundi: mapeaba PRECIO_DE_MERCADO a PRICE_RETURN, y eso dejaba sin alpha a
# los 69 fondos de MSCI ACWI por una razon falsa.
#
# - La base dice si la serie de referencia INCLUYE los dividendos. El precio de un
#   ETF de ACUMULACION si los incluye —suben con ellos reinvertidos—, asi que es
#   retorno total. Lo que los excluye es un NIVEL DE INDICE de tipo PR, que no es
#   lo mismo que el precio de un instrumento.
# - La clase de serie dice si se midio sobre valor liquidativo o sobre precio de
#   mercado, y eso es la cuestion del RUIDO: medido ese dia, un ETF cotizado
#   infla la volatilidad 1,2 puntos a un anio frente al valor liquidativo de un
#   fondo indice, porque XETRA cierra a las 17:30 y el VL se calcula tras el
#   cierre de EE.UU.
#
# Son independientes: un ETF de acumulacion es base TOTAL_RETURN y clase
# PRECIO_DE_MERCADO. Las dos viajan declaradas porque responden a dos preguntas
# distintas: si el alpha se puede calcular, y cuanto ruido lleva la cifra.
BASES_DE_INDICE = ("TOTAL_RETURN", "PRICE_RETURN")

# Lo que se quita del nombre para comparar: la variante y la divisa son parte del
# nombre formal del índice, pero la divisa deja de distinguir en cuanto todo se
# calcula en euros (decisión 10), así que «MSCI World NR USD» y «NR EUR» caen en
# la misma fila.
RE_VARIANTE = re.compile(r"\b(NR|GR|PR|TR)\b")
RE_DIVISA = re.compile(r"\b(EUR|USD|GBP|JPY|CHF|SEK|NOK|DKK|CAD|AUD|ILA|GBX)\b")

_CACHE: dict[str, tuple[float, dict]] = {}

# El canónico no siempre escribe la variante en su forma corta: trae «MSCI World Net TR EUR»,
# «S&P 500 Net Total Return», «MSCI All Countries World (NTR)», «EURO STOXX 50 Price» o
# «S&P 500 (TR) (1970)». Medido el 06-11-2026 en los 677 fondos y ETF que declaran índice.
# Sin leerlas, «Net TR» se tomaba por la variante TR —que es otra— y el nombre no casaba con
# su fila: el fondo se quedaba sin relativas por la forma de escribirlo, no por el índice.
#
# El orden importa: «Net TR» y «Net Total Return» son NR y se leen antes que «TR» y
# «Total Return» sueltos. «Price» solo es variante al final del nombre: en «LBMA Gold
# Price PM» es parte del nombre del índice.
_FORMAS_DE_VARIANTE = (
    (re.compile(r"\bnet\s+(?:total\s+)?return\b|\bnet\s+tr\b|\bntr\b|\bnet\b", re.I), "NR"),
    (re.compile(r"\bgross\s+(?:total\s+)?return\b|\bgross\s+tr\b|\bgross\b", re.I), "GR"),
    (re.compile(r"\bprice\s+return\b|\bprice\s*$", re.I), "PR"),
    (re.compile(r"\btotal\s+return\b", re.I), "TR"),
)
# Un año entre paréntesis es la fecha base del índice, no otro índice: «S&P 500 (TR) (1970)»
# es el S&P 500.
RE_ANO_BASE = re.compile(r"\(\s*(?:19|20)\d{2}\s*\)")
# «Index» no distingue nada, y «in EUR» es la divisa dicha con una palabra de más.
RE_PALABRA_INDEX = re.compile(r"\bindex\b", re.I)
RE_EN_DIVISA = re.compile(r"\bin\s+(?=" + RE_DIVISA.pattern[2:-2] + r"\b)")


def _normaliza(nombre: str) -> str:
    """El nombre con la variante en su forma corta y sin lo que no distingue un índice de otro."""
    t = RE_ANO_BASE.sub(" ", nombre or "")
    t = RE_DIVISA.sub(" ", RE_EN_DIVISA.sub(" ", t))
    t = re.sub(r"\(\s*(NR|GR|PR|TR|NTR)\s*\)", r" \1 ", t)
    t = re.sub(r"\s+", " ", t).strip()
    for patron, corta in _FORMAS_DE_VARIANTE:
        t = patron.sub(f" {corta} ", t)
    return re.sub(r"\s+", " ", RE_PALABRA_INDEX.sub(" ", t)).strip()


def variante_de(nombre: str) -> str | None:
    """La variante que declara el nombre (NR, GR, PR o TR), leída también en su forma larga."""
    hallada = RE_VARIANTE.search(_normaliza(nombre))
    return hallada.group(1) if hallada else None


def pliega(nombre: str) -> str:
    """Nombre comparable: sin variante, sin divisa, sin acentos ni dobles espacios."""
    t = RE_VARIANTE.sub("", RE_DIVISA.sub("", _normaliza(nombre)))
    t = (t.replace("€", "E").replace("é", "e").replace("É", "E")
          .replace("í", "i").replace("á", "a").replace("ó", "o").replace("ú", "u"))
    return re.sub(r"[^a-z0-9]+", " ", t.lower()).strip()


def carga(base: Path | None = None) -> dict[tuple[str, str | None], dict]:
    """{(nombre plegado, variante): fila} desde `config/indices.csv`; relee si cambia.

    La clave lleva la variante desde el 07-11-2026 (decisión 28): «S&P 500 (TR) (1970)» y
    «S&P 500 NR USD» pliegan al mismo nombre, y con la clave solo por nombre la fila del S&P 500
    TR habría pisado en silencio la del S&P 500 NR, que mide a 3 fondos. Dos filas con el mismo
    nombre y la misma variante sí son un error de la tabla."""
    if base is None:
        return {}
    ruta = Path(base) / "config" / "indices.csv"
    try:
        mtime = ruta.stat().st_mtime
    except OSError:
        return {}
    guardado = _CACHE.get(str(ruta))
    if guardado and guardado[0] == mtime:
        return guardado[1]
    tabla: dict[tuple[str, str | None], dict] = {}
    equivalencias: list[tuple[str, dict]] = []
    with ruta.open(encoding="utf-8-sig", newline="") as fh:
        for fila in csv.DictReader(fh):
            benchmark = (fila.get("benchmark") or "").strip()
            proxy = (fila.get("proxy") or "").strip().upper()
            clase = (fila.get("clase_de_serie") or "").strip().upper()
            if not benchmark or not proxy:
                continue
            base_indice = (fila.get("base") or "").strip().upper()
            if clase not in CLASES_DE_SERIE:
                raise ValueError(
                    f"clase de serie desconocida en indices.csv: {clase!r} ({benchmark})")
            if base_indice not in BASES_DE_INDICE:
                raise ValueError(
                    f"base de indice desconocida en indices.csv: {base_indice!r} ({benchmark})")
            if (clase == "NIVEL_DE_INDICE") != proxy.endswith(f".{BOLSA_INDICES}"):
                raise ValueError(
                    f"indices.csv: un NIVEL_DE_INDICE es un simbolo .{BOLSA_INDICES} y solo el: "
                    f"{proxy!r} ({benchmark})")
            registro = {
                "benchmark": benchmark,
                "variante": (fila.get("variante") or "").strip().upper() or None,
                "proxy": proxy,
                "clase_de_serie": clase,
                "base": base_indice,
                "nota": (fila.get("nota") or "").strip(),
                "equivalente_de": tuple(
                    e.strip() for e in (fila.get("equivalente_de") or "").split(";") if e.strip()),
                "declarado": None,
            }
            clave = (pliega(benchmark), registro["variante"])
            if clave in tabla:
                raise ValueError(
                    f"indices.csv: {benchmark!r} {registro['variante'] or ''} aparece dos veces")
            tabla[clave] = registro
            equivalencias.extend((e, registro) for e in registro["equivalente_de"])
    # Un proxy de índice EQUIVALENTE: ningún ETF replica el ICE BofA Euro Corporate, y uno del
    # iBoxx EUR Corporates mide casi lo mismo. La fila es la del índice que de verdad se mide
    # (`benchmark`), y `equivalente_de` nombra los índices declarados a los que sustituye,
    # separados por «;». Un fondo que declara uno de esos casa con la fila, y el resultado lleva
    # `declarado`, para que la cifra diga contra qué se midió y a qué equivale; nunca se hace
    # pasar el índice medido por el declarado. Se cargan después de las filas directas: un
    # nombre que ya tiene proxy propio, o que dos filas reclaman, es un error de la tabla.
    for declarado, registro in equivalencias:
        clave = (pliega(declarado), registro["variante"])
        if clave in tabla:
            raise ValueError(
                f"indices.csv: {declarado!r} ya tiene fila; no puede ser equivalente de "
                f"{registro['benchmark']!r}")
        tabla[clave] = {**registro, "declarado": declarado}
    _CACHE[str(ruta)] = (mtime, tabla)
    return tabla


def _fila_para(tabla: dict[tuple[str, str | None], dict], benchmark: str) -> dict | None:
    """La fila de ese nombre con su variante, con la regla de siempre para las que no la declaran.

    La variante tiene que coincidir cuando las dos se declaran: un alpha contra la variante
    equivocada se desvía por la retención fiscal del índice. Una fila sin variante (las tasas)
    sirve para cualquier nombre; un nombre sin variante casa con la única fila de ese índice, y si
    hay varias no se adivina cuál: «EuroStoxx 50» a secas no es ni el de precio ni el NR."""
    clave = pliega(benchmark)
    candidatas = {v: f for (c, v), f in tabla.items() if c == clave}
    if not candidatas:
        return None
    pedida = variante_de(benchmark)
    if pedida:
        return candidatas.get(pedida) or candidatas.get(None)
    if len(candidatas) == 1:
        return next(iter(candidatas.values()))
    return candidatas.get(None)


def proxy_de(benchmark: str, base: Path | None = None) -> dict | None:
    """La fila del proxy de ese benchmark, o `None` si no hay ninguno.

    `None` no es un fallo: de los 243 índices distintos de la base solo unos
    pocos tienen proxy aprobado, y los demás se quedan sin métricas relativas
    hasta que alguien elija uno. Devolver `None` es lo que impide que se calcule
    un alpha contra un índice que nadie ha verificado.
    """
    if not benchmark:
        return None
    tabla = carga(base)
    if not tabla:
        return None
    return _fila_para(tabla, benchmark)


def es_nivel_de_indice(fila: dict | None) -> bool:
    """Si la serie de referencia es el propio índice (bolsa INDX de EODHD) y no un instrumento."""
    return bool(fila) and fila.get("clase_de_serie") == "NIVEL_DE_INDICE"


def es_tasa(fila: dict | None) -> bool:
    """Si el proxy es el €STR y no un instrumento con ISIN."""
    return bool(fila) and fila.get("proxy") == PROXY_ESTR


# La referencia de una ACCION, que ningun folleto declara y por eso la elegimos nosotros
# (decisiones 12 y 24). Sale de donde COTIZA y no del ISIN: Medtronic tiene ISIN irlandes y
# cotiza en Nueva York. Una bolsa que no este en la tabla es un hueco y se ve como tal.
ALCANCES_DE_ACCION = ("AREA", "MERCADO", "SIN_REFERENCIA")


def referencia_de_accion(simbolo: str, base: Path | None = None) -> dict | None:
    """{bolsa, alcance, fila} de la referencia de esa cotizacion, o None si nadie la ha decidido.

    `fila` es la de `indices.csv`, o None si esta decidido que no tiene referencia."""
    if base is None or "." not in (simbolo or ""):
        return None
    bolsa = simbolo.rsplit(".", 1)[-1].strip().upper()
    ruta = Path(base) / "config" / "indices_de_accion.csv"
    try:
        with ruta.open(encoding="utf-8-sig", newline="") as fh:
            fila = next((f for f in csv.DictReader(fh) if (f.get("bolsa") or "").strip().upper() == bolsa), None)
    except OSError:
        return None
    if fila is None:
        return None
    alcance = (fila.get("alcance") or "").strip().upper()
    if alcance not in ALCANCES_DE_ACCION:
        raise ValueError(f"alcance desconocido en indices_de_accion.csv: {alcance!r} ({bolsa})")
    if alcance == "SIN_REFERENCIA":
        return {"bolsa": bolsa, "alcance": alcance, "fila": None}
    benchmark = (fila.get("benchmark") or "").strip()
    del_indice = _fila_para(carga(base), benchmark)
    if del_indice is None:
        raise ValueError(f"{benchmark!r} no esta en indices.csv ({bolsa})")
    return {"bolsa": bolsa, "alcance": alcance, "fila": del_indice}
