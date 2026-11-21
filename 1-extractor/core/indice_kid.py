"""¿Confirma el KID el índice que Morningstar atribuye al fondo?

El índice de referencia de los fondos y ETF que lo declaran llega de un solo sitio,
`morningstar_lt` (`identificacion.indice_benchmark_oficial`), y de él cuelgan el proxy y
las relativas: beta, R², alfa y tracking error. Si Morningstar atribuye un índice que el
fondo no usa, el alfa se mide contra lo que no es y nada en la ficha lo dice. El KID es el
documento regulatorio de la clase y suele nombrar su índice: este módulo lo lee y deja
escrito, fondo a fondo, si lo confirma y con qué frase (camino B del paso 2, decisión 5 de
`DECISIONES_DATOS_2026-11-07.md`).

**Solo evidencia.** No cambia el índice, ni el proxy, ni ninguna cifra: el estado se escribe
junto al índice de Morningstar, y quien decide qué hacer con un NO_CONFIRMADO es Óscar.

**La huella manda**, como en `config/politica_kid.json`: el KID que se lee es el de la ficha
(`documentos_oficiales.kid_sha256`), y un PDF de la caché cuyo texto no da esa huella no
cuenta, porque un documento nuevo puede decir otra cosa.

Los estados, por el orden en que se deciden:

- `COMPUESTO`: una frase del KID que habla de su referencia la da en piezas con su peso
  («80% Ibex35 Net Return y 20% PSI20»). Va delante porque Morningstar se queda a menudo con
  una de las piezas, y su nombre casaría entero con la frase.
- `CONFIRMADO_COMPLETO`: todas las palabras que distinguen el índice, normalizadas, están
  en una misma frase del KID (o en dos seguidas: un nombre puede quedar partido).
- `KID_SIN_INDICE`: el KID dice que el fondo no se gestiona con un índice de referencia.
- `CONFIRMADO_MARCA`: el KID nombra la marca (MSCI, JPM…) en una frase que habla de un
  índice, pero no el índice entero. `faltan` dice qué palabras no aparecen: puede ser otro
  índice de la misma marca, o una forma de escribirlo que la normalización no conoce.
- `NO_CONFIRMADO`: el KID se leyó y no nombra la marca. El texto es la frase en la que
  habla de su referencia, si la hay.
- `SIN_KID`: la ficha no tiene KID, o el PDF de la caché no es el de la ficha.

**Lo que hace casar dos nombres, y lo que no.** Las marcas y abreviaturas se reducen a una
forma (JPM = J.P. Morgan = JPMorgan; S&P = Standard & Poor's; BBgBarc = Barclays =
Bloomberg; BofA ML = Merrill Lynch = ICE BofA), y se quitan la variante (NR, TR, Net Total
Return…), la divisa, los años base y la palabra «Index», que no distinguen un índice de
otro. Lo que sí distingue —«Hedged», «Small Cap», «1-3», «10/40»— se queda: si el KID no lo
dice, el fondo baja a CONFIRMADO_MARCA, que es lo honrado.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import re
import unicodedata
from pathlib import Path

METODO = "indice_kid v1"
ESTADOS = ("CONFIRMADO_COMPLETO", "CONFIRMADO_MARCA", "COMPUESTO", "NO_CONFIRMADO",
           "KID_SIN_INDICE", "SIN_KID")
MAX_TEXTO = 200

# Formas de una misma marca o palabra, a su forma única. Se aplican sobre el texto plegado
# (sin acentos, en minúsculas, con la puntuación todavía dentro) y en este orden: las largas
# antes que las cortas, para que «bofa merrill lynch» no se quede en «bofa» + «merrill».
_ALIAS: tuple[tuple[str, str], ...] = (
    # J.P. Morgan, y sus familias dichas enteras en el KID y en siglas en Morningstar
    (r"j\s*\.?\s*p\s*\.?\s*morgan(?:\s+chase)?|jpmorgan|\bjpm\b", " jpm "),
    (r"\bcorporate\s+emerging\s+markets?\s+bond\s+index\b", " cembi "),
    (r"\bemerging\s+markets?\s+bond\s+index\b", " embi "),
    # «GBI» es «Government Bond Index», y «bond» no distingue: «Euro Agg Bond» es el Euro
    # Aggregate. Las dos formas acaban en «govt».
    (r"\bgovernment\s+bond\s+index\b|\bgbi\b", " govt "),
    # S&P, también pegado al número: «S&P500»
    (r"standard\s*(?:&|and|\+)?\s*poor\s*'?\s*s|\bs\s*&\s*p(?=\b|\d)|\bs\s*and\s*p\b|\bsandp\b",
     " sp "),
    # Bloomberg y sus nombres anteriores: Lehman, Barclays, Bloomberg Barclays
    (r"bloomberg\s+barclays|\bbbgbarc\b|\bbbg\s*barc\b|\bbarclays\s+capital\b|\bbarclays\b"
     r"|\blehman(?:\s+brothers)?\b|\bbbg\b|\bbloomberg\b", " bloomberg "),
    # ICE BofA, antes BofA Merrill Lynch
    (r"\bice\s*bofa\s*ml\b|\bice\s+bank\s+of\s+america(?:\s+merrill\s+lynch)?\b"
     r"|\bbofa\s+merrill\s+lynch\b|\bbank\s+of\s+america\s+merrill\s+lynch\b|\bbofa\s*ml\b"
     r"|\bmerrill\s+lynch\b|\bice\s*bofa\b|\bbofa\b|\bbaml\b", " icebofa "),
    (r"\bmarkit\s+iboxx\b|\bi\s*boxx\b", " iboxx "),
    (r"\beuro\s*stoxx(?=\b|\d)", " eurostoxx "),
    (r"\beuroagg\b", " euro agg "),
    (r"\bibex\s*-?\s*35\b", " ibex 35 "),
    (r"\btokyo\s+stock\s+price\s+index\b", " topix "),
    (r"\bdow\s+jones\b", " dj "),
    (r"\bftse\s+russell\b", " ftse "),
    (r"€\s*ster\b|\bester\b|€\s*str\b|\be\s*str\b|\bestr\b|\beuro\s+short\s*-?\s*terme?\s+rate\b",
     " estr "),
    (r"\ball\s*-?\s*countr(?:y|ies)\s+world\b|\bworld\s+all\s+countr(?:y|ies)\b|\bac\s+world\b"
     r"|\bacwi\b", " acwi "),
    (r"\ball\s*-?\s*countr(?:y|ies)\b", " ac "),
    (r"\bjapan\b|\bjpn\b|\bjp\b", " japan "),
    (r"\bpacific\b|\bpac\b", " pacific "),
    (r"\bemerging\s+markets?\b|\bmercados\s+emergentes\b|\bmarches\s+emergents\b|\bemerging\b",
     " em "),
    (r"\bdeveloped\s+markets?\b|\bdm\b", " dm "),
    (r"\blarge\s*-?\s*mid\s*-?\s*caps?\b|\blargemidcap\b", " largemidcap "),
    (r"\bsmall\s*-?\s*caps?\b|\bsmallcap\b|\bsmall\b", " smallcap "),
    (r"\bsmid\b", " smid "),
    (r"\blc\b", " largecap "),
    (r"\bmid\s*-?\s*caps?\b", " midcap "),
    (r"\blarge\s*-?\s*caps?\b", " largecap "),
    (r"\bhigh\s+yield\b|\bnon\s*-?\s*ig\b|\bnon\s*-?\s*investment\s+grade\b", " hy "),
    (r"\binvestment\s+grade\b", " ig "),
    (r"\bgovernments?\b|\bgoverment\b|\bgov\b|\bgovt\b|\bsovereign\b", " govt "),
    (r"\bnon\s*-?\s*financials?\b|\bnfincl\b|\bnf\b", " nonfinancial "),
    (r"\bex\s*-?\s*(?:financials?|fincl|fin)\b|\bxf\b", " exfinancials "),
    (r"\bcorporates?\b|\bcorp\b", " corp "),
    (r"\baggregated?\b|\bagg\b", " agg "),
    (r"\bwgilb\b", " world govt inflationlinked "),
    (r"\bgil\b", " global inflationlinked "),
    (r"\binflation\s*-?\s*linked\b|\binfl\s*lkd\b|\binfl\s+linked\b|\bil\b", " inflationlinked "),
    (r"\btreasur(?:y|ies)\b|\btsy\b|\btsry\b|\btrsy\b", " treasury "),
    (r"\bfloat\s*-?\s*adj(?:usted)?\b|\bflt\s*-?\s*adj\b", " floatadjusted "),
    (r"\bfloating\s+rate\b|\bfl\s*-?\s*rt\b|\bflt\s*-?\s*rt\b", " floatingrate "),
    (r"\binfrastructure\b|\binfra\b", " infrastructure "),
    (r"\bbrookfld\b", " brookfield "),
    (r"\ball\s*-?\s*share\b|\ballsh\b|\ballshare\b", " allshare "),
    (r"\bbroad\b|\bbrd\b", " broad "),
    (r"\binformation\s+technology\b|\binfo\s*tech\b", " infotech "),
    (r"\bcommunication\s+services\b|\bcomm?\s+serv\b", " commservices "),
    (r"\bconsumer\s+discretionary\b|\bcon(?:sumer)?\s+disc(?:retionary|rtionary)?\b", " consumerdisc "),
    (r"\bhealth\s*-?\s*care\b", " healthcare "),
    (r"\bequipment\s*(?:&|and)\s*supplies\b|\bequip\s*(?:&|and)\s*supp\b", " equipsupplies "),
    (r"\bmetals?\s*(?:&|and)\s*mining\b|\bme\s*&\s*mi\b", " metalsmining "),
    (r"\bbuffer\b|\bbf\b", " buffer "),
    (r"\binvestable\s+market\b|\bimi\b", " imi "),
    (r"\bindustrials\b|\bind\b", " industrials "),
    (r"\bmaterials\b|\bmat\b", " materials "),
    (r"\bconvertibles?\b|\bcb\b", " convertible "),
    (r"\bcovered\b|\bcov\b", " covered "),
    (r"\binterest\s+rate\b|\bir\b", " interestrate "),
    (r"\bduration\b|\bdur\b", " duration "),
    (r"\bdiversified\b|\bdivers\b|\bdvrs\b|\bdiv\b", " diversified "),
    (r"\bconstr(?:ained)?\b|\bcnst\b|\bconstn?d\b|\bctd\b|\bcons\b", " constrained "),
    (r"\beuropean\s+currency\b|\beuro\s+ccy\b", " euro currency "),
    (r"\bglobal\b|\bgbl\b|\bglb\b", " global "),
    (r"\bworld\b|\bwld\b|\bmundial\b|\bmonde\b|\bwelt\b", " world "),
    (r"\binternational\b|\binternacional\b|\bintl\b", " intl "),
    (r"\brenta\s+variable\b", " rv "),
    (r"\brenta\s+fija\b", " rf "),
    (r"\bmarkets?\b|\bmkts?\b", " markets "),
    (r"\bequity\b|\bequities\b|\beq\b", " equity "),
    (r"\bselect\b|\bsel\b", " select "),
    (r"\bequal\s*-?\s*weight(?:ed)?\b", " equalweight "),
    # «Hedged», «Hdg», «SEKhdg», «hedged to EUR»: la cobertura sí distingue un índice.
    (r"\bunhedged\b|\bunhgd\b|\bnon\s*-?\s*hedged\b", " "),
    (r"\b(?:[a-z]{3}\s*-?\s*)?h(?:dg|gd|edged)\b|\bh(?:usd|eur|chf|gbp|jpy|sek)\b|\bcubierto\b"
     r"|\bcouvert\b|\babgesichert\b", " hedged "),
    (r"\bbiotechnology\b|\bbiotech\b", " biotech "),
    # «1-3Y», «1-3 years», «1-3 años»: los años de un tramo se quedan en sus números.
    (r"(\d)\s*\+?\s*(?:y|yr|yrs|years?|ans?|anos?|jahre?)\b", r"\1 "),
    # «3M», «3 meses», «3 Month» y «3 mois» son el mismo plazo.
    (r"(\d)\s*-?\s*(?:m|mo|month|months|mes|meses|mois|monate?)\b", r"\1m "),
)
_ALIAS_RE = tuple((re.compile(p), r) for p, r in _ALIAS)

# Lo que no distingue un índice de otro: la variante, la divisa, «Index», el operador de la
# bolsa delante del nombre (BME, FSE), el «capitalizado» de una tasa, y las palabras de
# enlace en los idiomas de los KID de la base.
_VACIAS = frozenset("""
index indices indice indexes indizes indexe indicateur the of de del des du la le les el los
las et and und y en in on a an au aux zum zur der die das
net return returns total gross price nr gr pr tr tri ntr ret rendimiento neto rentabilidad
bond bonds
usd eur gbp jpy chf sek nok dkk cad aud hkd gbx ila lcl
bme fse capitalise capitalisee capitalized capitalised capitalizado capitalizada jour ois
""".split())

# Una frase que habla de la referencia del fondo.
_REFERENCIA = re.compile(
    r"benchmark|indice de referencia|indice de reference|reference index|referenzindex|"
    r"referenzwert|vergleichsindex|valor de referencia|indicateur de reference|"
    r"\bindices?\b|\bindex\b|\bindizes\b|\btracks?\b|\breplica|\breplicate|\breproduire|nachbilden|"
    r"\breferencia\b|\breference\b|\breferenz|\bcomparador|\bcomparativ|\bcomparator|"
    # «para comparar la rentabilidad», y el índice dicho como objetivo de rentabilidad
    # («superior a la del MSCI Europe Small Cap», «surperformer», «outperform»). No
    # «compararlo con otros productos», que es la frase fija del encabezado de todo KID.
    r"\bcomparar\b|\bcompare\b|\bcomparer\b|rentabilidad superior a la del|\bsuperar\b|\bbatir\b|"
    r"\boutperform|\bsurperform|\bsuperieure? a celle d")
# La referencia dicha con su nombre propio, para el texto de un NO_CONFIRMADO.
_REFERENCIA_FUERTE = re.compile(
    r"benchmark|indice de referencia|indice de reference|reference index|referenzindex|"
    r"referenzwert|vergleichsindex|valor de referencia|indicateur de reference|"
    r"(?:toma|utiliza|usa) como referencia|como referencia la rentabilidad|"
    r"referencia a efectos de rentabilidad")
# El KID dice que no hay índice. Partió del medido el 06-11 en `reports/_kid_indice.py`, con
# las redacciones que ese día quedaban fuera («No se gestiona en relación con un valor de
# referencia», «sin referencia a parámetros verificables», «Indicateur de référence : Néant»).
_SIN_REFERENCIA = re.compile(
    r"no (?:tiene|utiliza|usa|sigue|toma como referencia) (?:un |ningun |a )?(?:indice|referencia|benchmark)|"
    r"no se gestiona (?:con|en relacion con|con referencia a|en referencia a) (?:un |ningun )?"
    r"(?:valor |indice )?(?:de )?referencia|no esta gestionado con (?:un |ningun )?(?:indice|referencia)|"
    r"sin (?:referencia a|indice de) (?:un |ningun )?(?:indice|referencia)|"
    r"sin referencia a parametros verificables|"
    r"not managed (?:in )?(?:reference|relation) to (?:a|any) (?:benchmark|index)|"
    r"(?:is|are) not (?:managed )?(?:by )?reference to (?:a|any) (?:benchmark|index)|"
    r"does not (?:have|use|track|follow) (?:a|an|any) (?:benchmark|index|reference)|"
    r"\bno benchmark|without reference to (?:a|any) (?:benchmark|index|verifiable)|"
    r"(?:has|have) no (?:benchmark|reference index)|not (?:have|use) a benchmark|"
    r"n.est pas gere par rapport a un indice|pas d.indicateur de reference|"
    r"sans (?:indice|indicateur) de reference|indicateur de reference ?: ?neant|"
    r"indice de referencia ?: ?(?:/|ninguno|no aplica|n/a)(?=[\s.]|$)|"
    r"kein(?:en)? (?:referenzindex|referenzwert|vergleichsindex)|nicht an einem referenzwert")
# Un índice compuesto. Se cuentan, en el texto SIN plegar, los porcentajes seguidos de un
# nombre propio, y bastan dos en la misma frase: «50 % de sus activos» no es una pieza,
# «50% MSCI World» sí. Un «+» suelto no basta: «MSCI EFM Europe + CIS» es el nombre de un
# índice, y «€STR + 2%» un diferencial sobre un solo índice.
_PIEZA_PORCENTUAL = re.compile(
    r"\b\d{1,3}(?:[.,]\d+)?\s*%\s*"
    r"(?:(?:of|the|de|del|du|des|la|le|el|por|en|un|una|al|by|von|in|tipo|taux)\s+){0,3}"
    r"[\"«“(]?[A-ZÁÉÍÓÚÑ€]")
# La pieza dicha al revés, con el peso DETRÁS del nombre: «IBEX Small Cap Net Return (IBEXSN)
# en un 30%, del IBEX Medium Cap Net Return (IBEXCN) en un 50% y del IBEX 35 Net Return
# (IBEXNR) en un 20%». Medido el 07-11-2026 sobre los 679 KID: era el único compuesto que el
# contador de arriba daba por CONFIRMADO_COMPLETO, y con una fila del IBEX 35 habría publicado
# beta 0,6 y R² 66 % contra un índice que no es el suyo (decisión 27). Un nombre propio —con
# mayúscula, hasta siete palabras y un paréntesis opcional— seguido de «en un N %» o «al N %».
_PIEZA_PORCENTUAL_DETRAS = re.compile(
    r"[A-ZÁÉÍÓÚÑ€][\w&./-]*(?:\s+[\w&./-]+){0,6}(?:\s*\([^)]{1,20}\))?"
    r"\s+(?:en\s+una?|al|a\s+un)\s+\d{1,3}(?:[.,]\d+)?\s*%")
# Las tablas de escenarios del KID: porcentajes seguidos de «Lo que podría recibir» o
# «Desfavorable», que el contador de piezas tomaba por un índice compuesto.
# O dicho con su nombre: «índice compuesto», «composite benchmark». Con la palabra, bastan
# dos porcentajes cualesquiera en la frase («80 % del tipo €STR capitalizado y 20 %…»).
_COMPUESTO_PALABRA = re.compile(r"\bindice compuesto|\bcompuesto en un\b|\bcompuesto de \d|"
                                r"\bcomposite (?:benchmark|index)|\bindice compose de|"
                                r"\bindicateur de reference compose|\bzusammengesetzt")
# La composición del PROPIO índice («répartition initiale : 35% Or - 20% Argent…») no es un
# índice compuesto: es cómo pondera sus componentes uno solo.
_PONDERACION_PROPIA = re.compile(r"repartition|ponderacion|ponderation|weighting|pondere")
_PORCENTAJE = re.compile(r"(?<![-−\d])\d{1,2}(?:[.,]\d+)?\s*%")
_ESCENARIOS = re.compile(r"rendimiento medio|average return|rendement moyen|lo que (?:podria|puede) recibir|"
                         r"what you might get|escenario|scenario|desfavorable|unfavourable|defavorable")


def pliega(s: str) -> str:
    """Sin acentos y en minúsculas, carácter a carácter: la longitud no cambia, y una
    posición en el texto plegado es la misma en el original (para recortar la cita)."""
    out = []
    for c in s or "":
        base = (unicodedata.normalize("NFD", c)[:1] or c).lower()
        out.append(base if len(base) == 1 else c)
    return "".join(out)


def normaliza(texto: str) -> list[str]:
    """Las palabras que distinguen un índice, en su forma única."""
    t = pliega(texto).replace("’", "'")
    t = re.sub(r"\(\s*(?:19|20)\d{2}\s*\)", " ", t)   # «S&P 500 (TR) (1970)»
    for patron, forma in _ALIAS_RE:
        t = patron.sub(forma, t)
    t = re.sub(r"(\d)\s*[/-]\s*(\d)", r"\1_\2", t)     # «10/40» = «10-40»; «1-3»
    tokens = re.sub(r"[^a-z0-9_]+", " ", t).split()
    # El plural no distingue: «Metals» y «Metal», «Corps» y «Corp».
    tokens = [x[:-1] if len(x) > 4 and x.endswith("s") and not x.endswith("ss") else x
              for x in tokens]
    return [x for x in tokens if x not in _VACIAS and (len(x) > 1 or x.isdigit())]


def texto_lectura(ruta: Path | str) -> str:
    """El texto del PDF en el orden de lectura del documento, sin reordenar por posición.

    `core.kid.texto_pdf` ordena los bloques por posición para leer las tablas de costes,
    y en un KID a dos columnas eso intercala las líneas de una columna con las de la otra:
    el nombre de un índice puede quedar partido. La huella se calcula con aquel; la lectura,
    con este."""
    import fitz  # PyMuPDF
    doc = fitz.open(str(ruta))
    try:
        return "\n".join(page.get_text("text") for page in doc)
    finally:
        doc.close()


def frases(texto: str) -> list[str]:
    """El texto en frases, con los espacios aplanados. «J.P. Morgan» no corta frase."""
    t = re.sub(r"-\s*\n\s*(?=[a-záéíóú])", "", texto or "")   # palabras partidas a final de línea
    t = re.sub(r"\s+", " ", t).strip()
    trozos = re.split(r"(?<=[a-z0-9\)\]»\"”][.;])\s+(?=[A-ZÁÉÍÓÚ«\"“(])|\s+[•Q]\s+(?=[A-ZÁÉÍÓÚ])", t)
    return [x.strip() for x in trozos if x.strip()]


def _posicion_de(frase: str, marca: str) -> int | None:
    """Dónde empieza, en el texto literal, la palabra que normalizada es `marca`: «J.P.
    Morgan» para «jpm». Se busca el primer corte de palabra a partir del cual aparece."""
    cortes = [m.start() for m in re.finditer(r"\S+", frase)]
    for corte in reversed(cortes):
        if marca in normaliza(frase[corte:]):
            return corte
    return None


def _cita(frase: str, ancla: str | None, marca: str | None = None) -> str:
    """El fragmento literal, de MAX_TEXTO caracteres como mucho, alrededor del ancla."""
    if len(frase) <= MAX_TEXTO:
        return frase
    inicio = 0
    hallado = re.search(re.escape(ancla), pliega(frase)) if ancla else None
    if hallado:
        inicio = max(0, hallado.start() - 40)
    elif marca:
        posicion = _posicion_de(frase, marca)
        inicio = max(0, (posicion or 0) - 40)
    return frase[inicio:inicio + MAX_TEXTO].strip()


def _ventanas(fs: list[str]) -> list[tuple[str, list[str], str]]:
    """Cada frase sola y después cada una con la siguiente (un nombre puede quedar partido
    entre dos), con sus palabras normalizadas y su texto plegado. Las solas van primero: la
    cita sale de la frase que lo dice, si una basta."""
    solas = [(f, normaliza(f), pliega(f)) for f in fs]
    pares = [(f"{a} {b}", normaliza(f"{a} {b}"), pliega(f"{a} {b}")) for a, b in zip(fs, fs[1:])]
    return solas + pares


def _cita_de(cuerpo: str, marca: str, ancla: str | None) -> str:
    """La cita de una ventana, empezando por la frase en la que aparece la marca: en una
    ventana de dos frases, la primera puede no tener nada que ver con el índice."""
    trozos = frases(cuerpo)
    desde = next((i for i, f in enumerate(trozos) if marca in normaliza(f)), 0)
    return _cita(" ".join(trozos[desde:]), ancla, marca)


def _ancla_de(nombre: str) -> str | None:
    """Lo que buscar en el texto plegado para centrar la cita: la primera palabra del nombre."""
    palabras = re.findall(r"[a-z0-9&.€]+", pliega(nombre))
    return palabras[0] if palabras else None


def compara(nombre_ms: str, texto: str) -> dict:
    """{estado, texto_del_kid, faltan?} de un nombre de Morningstar contra el texto de un KID."""
    buscado = normaliza(nombre_ms)
    if not buscado:
        return {"estado": "NO_CONFIRMADO", "texto_del_kid": None, "motivo": "nombre_sin_palabras"}
    marca = buscado[0]
    ancla = _ancla_de(nombre_ms)
    sueltas = frases(texto)
    ventanas = _ventanas(sueltas)

    # 1. Compuesto: UNA frase que nombra su referencia («índice de referencia», «benchmark»…;
    #    «index» suelto no basta: también lo dice el universo de inversión o la composición
    #    del propio índice), con dos piezas porcentuales, y que no sea una tabla de escenarios.
    for cuerpo in sueltas:
        plegada = pliega(cuerpo)
        if not (_REFERENCIA_FUERTE.search(plegada) or _COMPUESTO_PALABRA.search(plegada))                 or _ESCENARIOS.search(plegada) or _PONDERACION_PROPIA.search(plegada):
            continue
        piezas = [p for p in _PIEZA_PORCENTUAL.finditer(cuerpo)
                  if not cuerpo[:p.start()].rstrip().endswith(("-", "−"))
                  and not re.match(r"100\s*%", p.group(0))]
        piezas += [p for p in _PIEZA_PORCENTUAL_DETRAS.finditer(cuerpo)
                   if not re.search(r"100\s*%$", p.group(0))]
        if len(piezas) >= 2 or (_COMPUESTO_PALABRA.search(plegada)
                                and len(_PORCENTAJE.findall(cuerpo)) >= 2):
            primera = piezas[0].group(0) if piezas else _PORCENTAJE.search(cuerpo).group(0)
            return {"estado": "COMPUESTO", "texto_del_kid": _cita(cuerpo, pliega(primera))}

    # 2. El nombre entero en una frase (o en dos seguidas). Si el nombre es de UNA palabra
    #    («€STR»), la frase además tiene que hablar de una referencia: suelto, también sale
    #    en la comisión de rentabilidad o en los costes.
    for cuerpo, toks, pl in ventanas:
        if all(x in toks for x in buscado) and (len(buscado) > 1 or _REFERENCIA.search(pl)):
            return {"estado": "CONFIRMADO_COMPLETO", "texto_del_kid": _cita_de(cuerpo, marca, ancla)}

    # 3. El KID dice que no hay índice.
    for cuerpo in sueltas:
        sin = _SIN_REFERENCIA.search(pliega(cuerpo))
        if sin:
            return {"estado": "KID_SIN_INDICE", "texto_del_kid": _cita(cuerpo, sin.group(0)[:20])}

    # 4. La marca en una frase que habla de un índice: la que más palabras del nombre tiene.
    con_marca = [(c, toks) for c, toks, pl in ventanas if marca in toks and _REFERENCIA.search(pl)]
    if con_marca:
        cuerpo, toks = max(con_marca, key=lambda v: (sum(x in v[1] for x in buscado), -len(v[0])))
        return {"estado": "CONFIRMADO_MARCA", "texto_del_kid": _cita_de(cuerpo, marca, ancla),
                "faltan": [x for x in buscado if x not in toks]}

    # 5. Nada: la frase en la que el KID nombra su referencia, si la nombra.
    frase = next((c for c in sueltas if _REFERENCIA_FUERTE.search(pliega(c))), None) \
        or next((c for c in sueltas if _REFERENCIA.search(pliega(c))), None)
    hallado = None
    if frase:
        hallado = _REFERENCIA_FUERTE.search(pliega(frase)) or _REFERENCIA.search(pliega(frase))
    return {"estado": "NO_CONFIRMADO",
            "texto_del_kid": _cita(frase, hallado.group(0) if hallado else None) if frase else None}


# --------------------------------------------------------------- el KID de la ficha
def pdfs_de(isin: str, base: Path) -> list[Path]:
    """Los PDF del KID de ese ISIN en la caché, de cualquiera de sus fuentes."""
    raiz = Path(base) / "cache" / "kid"
    isin = isin.strip().upper()
    return sorted({*raiz.glob(f"*/{isin}_*.pdf"), *raiz.glob(f"*/*/{isin}_*.pdf")})


def pdf_con_huella(isin: str, huella: str, base: Path) -> Path | None:
    """El PDF de la caché cuyo texto da la huella de la ficha, o None."""
    from core import kid
    for ruta in pdfs_de(isin, base):
        try:
            texto = kid.texto_pdf(ruta)
        except Exception:  # noqa: BLE001 - un PDF ilegible no es el de la ficha
            continue
        if hashlib.sha256(texto.encode("utf-8")).hexdigest() == huella:
            return ruta
    return None


def comprueba(isin: str, nombre_ms: str, huella: str | None, base: Path,
              hoy: dt.date | None = None) -> dict:
    """El bloque `identificacion.indice_benchmark_kid` de un fondo."""
    bloque = {"indice_morningstar": nombre_ms, "kid_sha256": huella,
              "fecha_comprobacion": (hoy or dt.date.today()).isoformat(), "metodo": METODO}
    if not huella:
        return {"estado": "SIN_KID", "motivo": "ficha_sin_kid", **bloque}
    ruta = pdf_con_huella(isin, huella, base)
    if ruta is None:
        return {"estado": "SIN_KID", "motivo": "kid_de_la_ficha_no_en_cache", **bloque}
    try:
        texto = texto_lectura(ruta)
    except Exception:  # noqa: BLE001
        return {"estado": "SIN_KID", "motivo": "kid_ilegible", **bloque}
    return {**compara(nombre_ms, texto), **bloque}
