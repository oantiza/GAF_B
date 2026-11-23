"""Parser del KID/PRIIPs (documento de datos fundamentales) en PDF.

El KID es el documento que la gestora publica por obligación legal
(Reglamento (UE) 1286/2014) y la fuente primaria de las dos cifras que un
asesor tiene que poder enseñar: el indicador resumido de riesgo (SRI, 1-7) y
la composición de los costes (entrada, salida, gestión y otros costes
corrientes, operación, rendimiento). Los costes ex-ante MiFID/EMT salen de
estos mismos números.

Extrae texto con PyMuPDF y busca por expresiones regulares en español, inglés
y francés (los idiomas de los KID que alojan CNMV y AMF). Devuelve solo lo que
encuentra con certeza: si una cifra no casa con un patrón, va como None y el
llamador decide. Nunca inventa.
"""
from __future__ import annotations

import hashlib
import logging
import re
from pathlib import Path

log = logging.getLogger("fondosdb.kid")

RE_ISIN = re.compile(r"\b([A-Z]{2}[A-Z0-9]{9}\d)\b")
# Un porcentaje, con signo (decisión de Óscar, 17-10, 6.6; casos límite en la
# revisión de la quinta pasada, MEN-8 y MEN-9). El signo cuenta solo si:
# - va pegado a la cifra: «– 0,1 %» (con espacio) es un separador;
# - no va pegado a una letra, cifra, punto o coma: «Costes de entrada-0,30 %»
#   no es negativo, ni «0,10–0,20 %», que es un intervalo;
# - no va detrás de una cifra y un espacio: «0,10 –0,20 %» también es un
#   intervalo.
# Hay que buscar sobre el texto completo (RE_PCT.search(texto, desde, hasta)),
# no sobre un trozo ya cortado: si no, lo que hay delante no se ve.
# Cuentan como signo el guion (U+002D), el signo menos (U+2212), la raya
# (U+2013), la raya de cifra (U+2012, pensada para ir entre cifras), el guion
# sin ruptura (U+2011) y el menos de ancho completo (U+FF0D). No cuenta la raya
# larga (U+2014): en las tablas de los KID marca una celda sin dato («—») o
# separa frases, y leerla como signo daría negativos falsos.
SIGNOS_MENOS = "-−–‒‑－"
RE_PCT = re.compile(r"(?:(?<![\w.,])(?<!\d )([" + SIGNOS_MENOS + r"]))?(\d{1,3}(?:[.,]\d{1,4})?)\s*%")
RE_FECHA = re.compile(r"(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})")
RE_FECHA_ISO = re.compile(r"(\d{4})-(\d{2})-(\d{2})")

IDIOMAS = {
    "es": ("documento de datos fundamentales", "indicador resumido de riesgo"),
    "en": ("key information document", "summary risk indicator"),
    "fr": ("document d'informations clés", "indicateur synthétique de risque",
           "document d’informations clés"),
}

# Clave de la composición de costes -> fila de la tabla en `ETIQUETAS`.
CLAVES_COSTES = {"entrada_pct": "entrada", "salida_pct": "salida", "gestion_y_otros_pct": "gestion",
                 "transaccion_pct": "operacion", "rendimiento_pct": "rendimiento"}

# Etiquetas por idioma. Cada entrada: lista de variantes (minúsculas, sin acentos).
ETIQUETAS = {
    "es": {
        "entrada": ["costes de entrada", "gastos de entrada"],
        "salida": ["costes de salida", "gastos de salida"],
        "gestion": ["comisiones de gestion y otros", "gastos de gestion y otros",
                    "comision de gestion y otros", "costes corrientes"],
        "operacion": ["costes de operacion", "costes de transaccion", "gastos de operacion",
                      "costes de transacciones"],
        "rendimiento": ["comisiones de rendimiento", "comision de rendimiento",
                        "comisiones sobre resultados", "comision sobre resultados",
                        "comisiones de exito", "comision de exito"],
        "nulos": ["no cobramos", "no se aplica", "no aplica", "no hay", "ninguno", "ninguna",
                  "no se cobra", "no existe", "no cobra", "no se aplican", "sin coste"],
    },
    "en": {
        "entrada": ["entry costs", "entry charges"],
        "salida": ["exit costs", "exit charges"],
        "gestion": ["management fees and other", "ongoing costs"],
        "operacion": ["transaction costs", "portfolio transaction costs"],
        "rendimiento": ["performance fees and carried interest", "performance fees",
                        "performance fee"],
        "nulos": ["we do not charge", "none", "not applicable", "no performance fee",
                  "there is no", "n/a", "does not charge", "do not charge"],
    },
    "fr": {
        "entrada": ["couts d'entree", "couts d’entree", "frais d'entree", "frais d’entree",
                    "cout d'entree", "cout d’entree"],
        "salida": ["couts de sortie", "frais de sortie", "cout de sortie"],
        "gestion": ["frais de gestion et autres", "frais courants"],
        "operacion": ["couts de transaction", "frais de transaction"],
        "rendimiento": ["commissions liees aux resultats", "commission liee aux resultats",
                        "commissions de performance", "commission de surperformance",
                        "commissions de surperformance"],
        "nulos": ["nous ne facturons pas", "neant", "non applicable", "aucun", "aucune",
                  "pas de", "sans objet"],
    },
}

D = r"[\[«\"']?\s*(\d)\s*[\]»\"']?"  # dígito, a veces entre corchetes o comillas
RE_SRI = {
    "es": [re.compile(r"clase de riesgo\s+" + D + r"\s+en una escala de\s*(?:1 a\s*)?7", re.I),
           re.compile(r"en la clase de riesgo\s+" + D + r"\b", re.I),
           re.compile(r"clasificado (?:este|el|esta) (?:producto|fondo|subfondo|compartimento|cartera) (?:en|como)\s+"
                      r"(?:la (?:clase|categor[ií]a)(?: de riesgo)?\s+)?" + D + r"\s+(?:de|en una escala de|sobre)\s*7", re.I),
           re.compile(r"tiene un riesgo de\s+" + D + r"\s+sobre\s+7", re.I),
           re.compile(r"nivel de riesgo\s+(\d)\s+en una escala de\s*7", re.I),
           # «En una escala de 7, la categoría de riesgo 3 indica un nivel de riesgo medio bajo».
           # Se exige solo la segunda mitad a propósito: estos KID son de dos columnas y la
           # extracción las intercala, así que la frase llega partida —«En una escala de 7,
           # modificar sus posiciones. la categoría de riesgo 3 indica»— y pedir que «escala
           # de 7» esté pegado al dígito la deja fuera. «indica un nivel de riesgo» detrás ya
           # fija que el dígito es la clase y no un resto de la escala gráfica.
           re.compile(r"categor[ií]a de riesgo\s+" + D + r"\s+indica un nivel de riesgo", re.I),
           # «Hemos clasificado este producto en la clase de riesgo de 3 (sobre 7)»: el «de»
           # de más antes del dígito y el paréntesis dejaban fuera al patrón de «clasificado».
           re.compile(r"clasificado (?:este|el|esta) (?:producto|fondo|subfondo|compartimento|cartera) (?:en|como)\s+"
                      r"la (?:clase|categor[ií]a) de riesgo de\s+" + D + r"\s*\(\s*sobre\s*7\s*\)", re.I)],
    "en": [re.compile(r"classified this (?:product|fund|sub-fund) as\s+" + D + r"\s+out of\s+7", re.I),
           re.compile(r"risk class\s+" + D + r"\b", re.I),
           re.compile(r"classified as\s+" + D + r"\s+out of\s+7", re.I)],
    "fr": [re.compile(r"class[ée] ce produit dans la classe de risque\s+" + D + r"\s+sur\s+7", re.I),
           re.compile(r"class[ée] ce produit dans l['’]indicateur de risque\s+" + D + r"\s+sur\s+7", re.I),
           re.compile(r"indicateur de risque\s+" + D + r"\s+sur\s+7", re.I),
           re.compile(r"classe de risque\s+" + D + r"\s+sur\s+7", re.I)],
}
RE_PERIODO = {
    "es": re.compile(r"per[ií]odo de mantenimiento recomendado\s*:?\s*(\d{1,2})\s*a[ñn]os?", re.I),
    "en": re.compile(r"recommended holding period\s*:?\s*(\d{1,2})\s*years?", re.I),
    "fr": re.compile(r"p[ée]riode de d[ée]tention recommand[ée]e\s*:?\s*(\d{1,2})\s*ans?", re.I),
}
# Una fecha en cualquiera de sus formas: dd/mm/aaaa (también con . o -),
# «12 de diciembre de 2025», «14 agosto 2026», «19 May 2026».
_F = (r"\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}|\d{4}-\d{2}-\d{2}"
      r"|\d{1,2}(?:er)?\s+(?:de\s+)?[A-Za-z\u00e0-\u00fc]+\s+(?:de\s+)?\d{4}")
RE_FECHA_DOC = {
    # «\s*» y no espacios: el PDF de Amundi pierde los de todo el texto y da «Fechadeelaboracióndeldocumentodedatosfundamentales:17/10/2025».
    "es": [re.compile(r"fecha\s*de\s*(?:elaboraci[oó]n|producci[oó]n|publicaci[oó]n|actualizaci[oó]n)[^:\d]{0,80}:?\s*(" + _F + r")", re.I),
           re.compile(r"fecha (?:del |de este )?documento(?: es)?\s*:?\s*(" + _F + r")", re.I),
           # DWS parte la línea entre «son» y «exactos a 16.04.2026».
           re.compile(r"(?:es|son)\s+exactos?\s+a\s+(?:fecha\s+(?:de\s+)?)?(?:el\s+)?(" + _F + r")", re.I),
           re.compile(r"se\s*(?:elabor[oó]|public[oó]|actualiz[oó]|produjo)\s*el\s*(" + _F + r")", re.I),
           # Participio sin «se»: «Producido el: 16/04/2026» es la redacción más común de
           # las que faltaban, y el patrón de arriba exige «se produjo el». Medido el
           # 31-10-2026 sobre los KID en caché: once documentos la usan.
           re.compile(r"(?:producido|elaborado|publicado|actualizado|emitido|preparado)\s+el\s*:?\s*(" + _F + r")", re.I),
           # «Documento publicado 26/3/2026», sin «el» y sin dos puntos.
           re.compile(r"documento\s+(?:publicado|producido|elaborado|actualizado)\s*:?\s*(" + _F + r")", re.I),
           # «Este documento de datos fundamentales es válido a 2026-02-18».
           re.compile(r"(?:es|son)\s+v[aá]lid[oa]s?\s+a(?:\s+partir\s+de)?\s*:?\s*(" + _F + r")", re.I),
           # «Documento vigente a partir de: 04/09/2026».
           re.compile(r"vigente\s+a\s+partir\s+de\s*:?\s*(" + _F + r")", re.I),
           # «... documento de datos fundamentales tiene fecha de 10/05/2026».
           re.compile(r"tiene\s+fecha\s+de\s*:?\s*(" + _F + r")", re.I),
           re.compile(r"documento de datos fundamentales\s*\|\s*(" + _F + r")", re.I),
           # Los dos puntos pegados a «datos fundamentales», con o sin «Fecha» delante:
           # «...última revisión del documento de datos fundamentales: 5 de mayo de 2025»
           # y «...con este documento de datos fundamentales. Fecha: 7 noviembre 2025».
           # Tienen que ir pegados: en «Fecha de elaboración del Código ISIN: LU0675297237
           # 30 de diciembre de 2022» los dos puntos cuelgan del ISIN y este patrón no debe cogerlos
           # (leería «ISIN: …»). Ojo: esa fecha NO es la de lanzamiento, como se creyó hasta el
           # 21-11-2026: el KID de Groupama G Fund Avenir Europe NC va a dos columnas y, por las
           # coordenadas, es la fecha de elaboración del documento. La leen los dos patrones del
           # final de esta lista (C-30).
           re.compile(r"datos fundamentales\s*[.,]?\s*(?:fecha\s*)?:\s*(" + _F + r")", re.I),
           re.compile(r"documento de datos fundamentales[^\n]{0,40}\n?[^\n]{0,60}(\d{1,2}/\d{1,2}/\d{4})", re.I),
           re.compile(r"informaci[oó]n general\s*\n?\s*(\d{1,2} de \w+ de \d{4})", re.I),
           # Columbia Threadneedle: la fecha va sola en la última línea del bloque «Producto», justo antes de
           # «¿Qué es este producto?» («26 marzo 2026»). Anclada a esa posición para no coger otra suelta.
           re.compile(r"\n[ \t]*(" + _F + r")[ \t]*\n\s*[¿?]?\s*qu[eé] es este producto", re.I),
           # Groupama (dos columnas): la etiqueta partida en dos líneas y la fecha en la del medio, a su derecha.
           re.compile(r"fecha de elaboraci[oó]n del[ \t]*\n[^\n]*?(" + _F + r")[ \t]*\n[ \t]*documento\b", re.I)],
    "en": [re.compile(r"date of production[^:\d]{0,80}:?\s*(" + _F + r")", re.I),
           re.compile(r"production date[^:\d]{0,40}:?\s*(" + _F + r")", re.I),
           re.compile(r"(?:accurate|correct|valid) as (?:at|of)\s+(?:the\s+)?(" + _F + r")", re.I),
           re.compile(r"key information document\s*\|\s*(" + _F + r")", re.I)],
    "fr": [re.compile(r"date de production[^:\d]{0,80}:?\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})", re.I)],
}
RE_PRODUCTOR = {
    "es": re.compile(r"(?:nombre del (?:productor|iniciador)(?: del (?:priip|producto))?|productor del priip|productor|"
                     r"entidad(?: gestora)?|sociedad gestora(?:\s*\([^)]{0,40}\))?)\s*:\s*([^\n]{3,160})", re.I),
    "en": re.compile(r"(?:name of (?:the )?(?:priip )?manufacturer|manufacturer|product manufacturer)\s*:\s*([^\n]{3,160})", re.I),
    "fr": re.compile(r"(?:nom de l'initiateur|nom de l’initiateur|initiateur du priip|producteur)\s*:?\s*([^\n]{3,160})", re.I),
}
# Sin dos puntos: «La sociedad gestora es DWS Investment S.A. (productor)»,
# «el productor, JPMorgan Asset Management (Europe) S.à r.l., (miembro»,
# «Productor Pictet Asset Management (Europe) S.A., (la «Sociedad», «Productor UBS ... ISIN».
RE_PRODUCTOR_2 = {
    "es": [re.compile(r"(?:la )?sociedad gestora es\s+([A-Z][^\n,(]{3,120})", re.I),
           re.compile(r"gestionad[oa] por\s+([A-Z][^\n,(]{3,120})"),
           re.compile(r"(?:del|el) productor(?: del priip)?,\s+([A-Z][^\n,]{3,120})"),
           re.compile(r"\bProductor\s+([A-Z][^\n]{3,120}?)(?=\s+(?:ISIN|\(la\s+«|,\s*\(la)|\s*$)", re.M)],
    "en": [re.compile(r"(?:the )?management company is\s+([A-Z][^\n,(]{3,120})", re.I),
           re.compile(r"(?:the )?(?:priip )?manufacturer(?: of this product)? is\s+([A-Z][^\n,(]{3,120})", re.I)],
    "fr": [re.compile(r"(?:la )?soci[ée]t[ée] de gestion est\s+([A-Z][^\n,(]{3,120})", re.I)],
}
# Lo que sigue al nombre en la misma línea y no forma parte del nombre.
RE_PRODUCTOR_CORTE = re.compile(
    r"\s+(?:perteneciente|pertenece|belonging|appartenant|,? ?(?:parte|part) (?:del|of))\b"
    r"|\s+(?:grupo|group|sitio web|website|direccion web|dirección web)\s*:"
    r"|\s*\((?:en lo sucesivo|en adelante|la\s+«|hereinafter|the\s+“|parte|part of|miembro|member|«|“|\")"
    r"|,\s*(?:\(la|la\s+«|entidad del grupo|que forma|una empresa|miembro|member|part of|\d)"
    r"|\s+(?:es responsable|is responsible|supervisar|Ireland\s+Central|Commission de|CSSF)\b"
    r"|\s+at\s+\d|\s+ISIN\b|\s+\(productor\)", re.I)
RE_LANZAMIENTO = {
    "es": [re.compile(r"(?:se (?:lanz[oó]|cre[oó]) el|fecha de (?:lanzamiento|creaci[oó]n)[^:\d]{0,40}:?)\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})", re.I)],
    "en": [re.compile(r"(?:was launched on|launch date[^:\d]{0,30}:?|inception date[^:\d]{0,30}:?)\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}|\d{1,2} \w+ \d{4})", re.I)],
    "fr": [re.compile(r"(?:a [ée]t[ée] (?:lanc[ée]|cr[ée][ée]) le|date de (?:lancement|cr[ée]ation)[^:\d]{0,30}:?)\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})", re.I)],
}
RE_SFDR = re.compile(r"art(?:[íi]culo|icle|\.)\s*(8|9)\b[^\n]{0,120}?(?:2019/2088|sfdr|reglamento de divulgaci[oó]n|disclosure regulation)", re.I)
RE_SFDR_2 = re.compile(r"(?:2019/2088|sfdr)[^\n]{0,160}?art(?:[íi]culo|icle|\.)\s*(8|9)\b", re.I)

MESES_EN = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august",
     "september", "october", "november", "december"], 1)}
MESES_ES = {m: i for i, m in enumerate(
    ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
     "septiembre", "octubre", "noviembre", "diciembre"], 1)}
MESES_FR = {m: i for i, m in enumerate(
    ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout",
     "septembre", "octobre", "novembre", "decembre"], 1)}


def _con_abreviaturas(meses: dict[str, int]) -> dict[str, int]:
    """A\u00f1ade las abreviaturas de tres letras a una tabla de meses.

    Los KID abrevian: \u00ab5 Aug 2026\u00bb en un documento por lo dem\u00e1s en espa\u00f1ol. Sin esto
    el patr\u00f3n de fecha acertaba y `_fecha_iso` devolv\u00eda None, as\u00ed que el documento se
    quedaba sin fecha y su SRI sin evidencia (medido el 31-10-2026).

    Una abreviatura ambigua dentro de su propio idioma **no se a\u00f1ade**: en franc\u00e9s
    \u00abjuin\u00bb y \u00abjuillet\u00bb comparten \u00abjui\u00bb, y adivinar junio o julio en el campo de fecha
    de un documento regulatorio es peor que no tener fecha. Tambi\u00e9n se acepta \u00absept\u00bb,
    que es la \u00fanica abreviatura de cuatro letras de uso corriente.
    """
    cuenta: dict[str, set[int]] = {}
    for nombre, numero in meses.items():
        cortas = [nombre[:3]] + (["sept"] if nombre.startswith("sept") else [])
        for corta in cortas:
            cuenta.setdefault(corta, set()).add(numero)
    out = dict(meses)
    for corta, numeros in cuenta.items():
        if len(numeros) == 1 and corta not in out:
            out[corta] = next(iter(numeros))
    return out


MESES_EN = _con_abreviaturas(MESES_EN)
MESES_ES = _con_abreviaturas(MESES_ES)
MESES_FR = _con_abreviaturas(MESES_FR)
# El punto de \u00ab5 Aug. 2026\u00bb va dentro del nombre del mes, no separado, o `\s+` no cuadra.
RE_FECHA_LARGA = re.compile(r"\b(\d{1,2})(?:er)?\s+(?:de\s+)?([a-zA-Z\u00e9\u00fb]+)\.?\s+(?:de\s+)?(\d{4})\b")


def texto_pdf(ruta_o_bytes) -> str:
    import fitz  # PyMuPDF

    if isinstance(ruta_o_bytes, (bytes, bytearray)):
        doc = fitz.open(stream=bytes(ruta_o_bytes), filetype="pdf")
    else:
        doc = fitz.open(str(ruta_o_bytes))
    try:
        # sort=True ordena los bloques por posición: en los KID a dos columnas
        # la etiqueta de un coste y su cifra quedan en la misma fila.
        return "\n".join(page.get_text("text", sort=True) for page in doc)
    finally:
        doc.close()


def _sin_acentos(s: str) -> str:
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", s)
                   if unicodedata.category(c) != "Mn")


def _pct(m: re.Match) -> float | None:
    """El valor de un acierto de `RE_PCT`, con su signo."""
    v = _num(m.group(2))
    return -v if v is not None and m.group(1) else v


# PRIIPs admite costes de transacción negativos (el deslizamiento de precio a
# favor puede superar los costes explícitos). Entrada, salida, gestión y
# otros costes corrientes y rendimiento no pueden serlo.
COSTES_CON_SIGNO = frozenset({"transaccion_pct"})


def _normaliza_coste(clave: str, v: float | None, avisos: list[str] | None = None) -> float | None:
    """La misma regla para los costes leídos del texto y de las celdas.

    Hasta el 17-10 cada camino hacía una cosa: el texto pasaba a positivo los
    negativos pequeños (`abs`) y las celdas los dejaban tal cual, y las celdas
    pisaban al texto (revisión, ALTA-16b). Ahora el signo solo se respeta en
    `COSTES_CON_SIGNO`; en el resto un negativo es un error de lectura: se avisa
    y no se usa (decisión de Óscar, 17-10, 6.6)."""
    if v is None or v >= 0 or clave in COSTES_CON_SIGNO:
        return v
    aviso = f"coste_negativo_descartado:{clave}={v:g}"
    if avisos is not None and aviso in avisos:
        return None                   # el texto y las celdas leen el mismo: un aviso (MEN-10)
    log.warning("KID: %s negativo (%g %%): error de lectura, no se usa", clave, v)
    if avisos is not None:
        avisos.append(aviso)
    return None


def _num(s: str) -> float | None:
    try:
        return float(s.replace(",", "."))
    except (TypeError, ValueError):
        return None


def _fecha_iso(s: str) -> str | None:
    if not s:
        return None
    m = RE_FECHA.search(s)
    if m:
        d, mth, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= mth <= 12 and 1 <= d <= 31:
            return f"{y:04d}-{mth:02d}-{d:02d}"
    m = RE_FECHA_LARGA.search(s)
    if m:
        mes = _sin_acentos(m.group(2).lower())
        for tabla in (MESES_EN, MESES_ES, MESES_FR):
            if mes in tabla:
                return f"{int(m.group(3)):04d}-{tabla[mes]:02d}-{int(m.group(1)):02d}"
    m = RE_FECHA_ISO.search(s)
    if m:
        return m.group(0)
    return None


# Marcas inequívocas de un KID PRIIPs, del documento en general y del KIID
# UCITS anterior a 2023 (cuyo indicador, el SRRI, no es el SRI).
MARCAS_PRIIPS = ("indicador resumido de riesgo", "summary risk indicator",
                 "indicateur synthetique de risque", "priip")
MARCAS_DOCUMENTO = ("documento de datos fundamentales", "key information document",
                    "document d'informations cles", "document d’informations cles")
MARCAS_KIID = ("datos fundamentales para el inversor", "key investor information",
               "informations cles pour l'investisseur", "informations cles pour l’investisseur",
               "perfil de riesgo y remuneracion", "perfil de riesgo y rentabilidad",
               "risk and reward profile", "profil de risque et de rendement")


def es_priips(texto: str) -> bool:
    """True si el texto es un KID PRIIPs y no un KIID UCITS (cuyo SRRI no es el SRI).

    Basta la marca inequívoca (el indicador resumido de riesgo o «PRIIP»); sin
    ella, vale el título del documento siempre que no aparezca el vocabulario
    del KIID («datos fundamentales para el inversor», «perfil de riesgo y
    remuneración»). Algunas gestoras (BNP Paribas, Franklin Templeton,
    Carmignac) titulan «Indicador de riesgo» sin «resumido»."""
    t = _sin_acentos(texto.lower())
    if any(m in t for m in MARCAS_PRIIPS):
        return True
    return any(m in t for m in MARCAS_DOCUMENTO) and not any(m in t for m in MARCAS_KIID)


def detecta_idioma(texto: str) -> str | None:
    t = texto.lower()
    puntos = {idioma: sum(t.count(k) for k in claves) for idioma, claves in IDIOMAS.items()}
    mejor = max(puntos.items(), key=lambda x: x[1])
    return mejor[0] if mejor[1] else None


RE_SRI_CONFIRMA = [
    re.compile(r"clase de riesgo\s+" + D + r"\s+en una escala de\s*7,?\s+en (?:la )?que\s+(\d)\s+(?:significa|se traduce|indica)", re.I),
    re.compile(r"risk class\s+" + D + r"\s+out of\s+7,?\s+where\s+(\d)\s+(?:means|is|represents)", re.I),
]


def _sri(texto: str, idioma: str) -> int | None:
    # «clase de riesgo 1 en una escala de 7, en la que 3 significa un riesgo
    # medio bajo»: el primer dígito puede ser un resto de la escala gráfica
    # pegado al texto (Acatis); la repetición es la que explica la clase.
    texto = re.sub(r"\s+", " ", texto)
    for patron in RE_SRI_CONFIRMA:
        m = patron.search(texto)
        if m and 1 <= int(m.group(2)) <= 7:
            return int(m.group(2))
    for patron in RE_SRI.get(idioma, []) + [p for i, ps in RE_SRI.items() if i != idioma for p in ps]:
        m = patron.search(texto)
        if m:
            v = int(m.group(1))
            if 1 <= v <= 7:
                return v
    return None


SECCION_COSTES = ("composicion de los costes", "composition of costs", "composition des couts",
                  "composition des coûts")


_PEGADAS: dict[str, str] | None = None


def _reespacia(plano: str) -> str:
    """Devuelve las etiquetas de coste que el PDF trae con las palabras pegadas
    («costesdeentrada», «costesdesalida» en los KID de DNCA) a su forma con
    espacios, para que las busquen las mismas reglas que al resto."""
    global _PEGADAS
    if _PEGADAS is None:
        _PEGADAS = {}
        for idioma in ETIQUETAS.values():
            for clave, etiquetas in idioma.items():
                if clave == "nulos":
                    continue
                for e in etiquetas:
                    if " " in e:
                        _PEGADAS[e.replace(" ", "")] = e
    for pegada, suelta in _PEGADAS.items():
        if pegada in plano:
            plano = plano.replace(pegada, suelta)
    return plano


def _inicio_tabla(plano: str) -> int:
    """Dónde empieza la tabla de composición de costes (0 si no se localiza)."""
    for marca in SECCION_COSTES:
        i = plano.find(marca)
        if i >= 0:
            return i
    return 0


def _coste(plano: str, etiquetas: list[str], nulos: list[str], todas: list[str],
           ventana: int = 420) -> float | None:
    """Porcentaje de la fila de un coste: desde su etiqueta hasta la etiqueta
    del coste siguiente. 0 si la fila dice que no se cobra; None si no consta."""
    inicio = _inicio_tabla(plano)
    posiciones = [(plano.find(e, inicio), e) for e in etiquetas]
    posiciones = [(i, e) for i, e in posiciones if i >= 0]
    if not posiciones:
        return None
    i, etiqueta = min(posiciones)
    fin = i + len(etiqueta) + ventana
    for otra in todas:
        if otra in etiquetas:
            continue
        j = plano.find(otra, i + len(etiqueta))
        if 0 <= j < fin:
            fin = j
    # Sobre el texto completo, no sobre el trozo: la regla del signo tiene que
    # ver lo que hay delante de la cifra (MEN-8).
    desde = i + len(etiqueta)
    m = RE_PCT.search(plano, desde, fin)
    j_nulo = min([plano.find(n, desde, fin) for n in nulos if plano.find(n, desde, fin) >= 0] or [10 ** 6])
    if m and m.start() < j_nulo:
        v = _pct(m)
        if v is not None:
            return v              # el signo lo decide _normaliza_coste
    if j_nulo < 10 ** 6:
        return 0.0
    if m:
        return _pct(m)
    return None


def _productor(texto: str, idioma: str) -> str | None:
    """Nombre del productor del PRIIP tal y como lo declara el documento."""
    candidatos = []
    m = RE_PRODUCTOR[idioma].search(texto)
    if m:
        candidatos.append(m.group(1))
    for patron in RE_PRODUCTOR_2.get(idioma, []):
        m = patron.search(texto)
        if m:
            candidatos.append(m.group(1))
    for bruto in candidatos:
        nombre = re.sub(r"\s+", " ", bruto).strip(" ;:,")
        nombre = RE_PRODUCTOR_CORTE.split(nombre, maxsplit=1)[0].strip(" ,;")
        # «La gestión del Fondo corresponde a X» (Invesco): el nombre es X.
        m2 = re.match(r"(?i)la gesti[oó]n del fondo corresponde a\s+(.+)", nombre)
        if m2:
            nombre = m2.group(1).strip(" ,;")
        if len(nombre) < 3 or nombre.lower().startswith(("www.", "http")):
            continue
        return nombre
    return None


def sri_por_celdas(ruta_o_bytes) -> int | None:
    """SRI leído del gráfico de la escala 1-7 cuando la prosa no lo dice.

    Muchos KID (Nordea, Schroders, BlackRock, DWS...) no escriben «clase de
    riesgo N»: la escala es una fila de siete dígitos con una casilla
    resaltada. En el PDF el dígito resaltado se distingue por el color (va en
    blanco sobre la casilla rellena, o es el único en color distinto al resto)
    o porque falta de la fila (queda tapado por el relleno). Se acepta solo
    cuando la fila es inequívoca: 6 o 7 dígitos distintos de 1..7 en orden y
    exactamente un candidato.
    """
    import fitz  # PyMuPDF

    if isinstance(ruta_o_bytes, (bytes, bytearray)):
        doc = fitz.open(stream=bytes(ruta_o_bytes), filetype="pdf")
    else:
        doc = fitz.open(str(ruta_o_bytes))
    try:
        for page in doc:
            filas: dict[int, list[tuple[float, int, int]]] = {}
            for b in page.get_text("dict")["blocks"]:
                for linea in b.get("lines", []):
                    for span in linea.get("spans", []):
                        t = span["text"].strip()
                        if not re.fullmatch(r"[1-7]", t):
                            continue
                        y = int(round((span["bbox"][1] + span["bbox"][3]) / 2 / 4))  # agrupa ±2 pt
                        filas.setdefault(y, []).append((span["bbox"][0], int(t), span.get("color", 0)))
            for _y, spans in sorted(filas.items()):
                spans.sort()
                digitos = [d for _x, d, _c in spans]
                if len(digitos) < 6 or len(set(digitos)) != len(digitos) or digitos != sorted(digitos):
                    continue
                faltan = sorted(set(range(1, 8)) - set(digitos))
                if len(digitos) == 6 and len(faltan) == 1:
                    return faltan[0]
                if len(digitos) == 7:
                    colores: dict[int, list[int]] = {}
                    for _x, d, c in spans:
                        colores.setdefault(c, []).append(d)
                    raros = [ds for ds in colores.values() if len(ds) == 1]
                    if len(colores) == 2 and len(raros) == 1:
                        return raros[0][0]
    finally:
        doc.close()
    return None


def parsea(texto: str, isin_esperado: str | None = None) -> dict:
    """Extrae lo regulatorio del texto de un KID. Ver módulo para el contrato."""
    idioma_detectado = detecta_idioma(texto)
    idioma = idioma_detectado or "es"
    plano = _reespacia(_sin_acentos(re.sub(r"[ \t]+", " ", texto)).lower())
    plano_1l = re.sub(r"\s+", " ", plano)
    et = ETIQUETAS[idioma]

    isins = RE_ISIN.findall(texto)
    isin = None
    if isin_esperado and isin_esperado.upper() in isins:
        isin = isin_esperado.upper()
    elif isins:
        isin = isins[0]

    periodo = None
    m = RE_PERIODO[idioma].search(_sin_acentos(texto))
    if m:
        periodo = int(m.group(1))

    fecha_doc = None
    for patron in RE_FECHA_DOC[idioma]:
        m = patron.search(_sin_acentos(texto))
        if m:
            fecha_doc = _fecha_iso(m.group(1))
            if fecha_doc:
                break

    productor = _productor(texto, idioma)

    lanzamiento = None
    for patron in RE_LANZAMIENTO[idioma]:
        m = patron.search(_sin_acentos(texto))
        if m:
            lanzamiento = _fecha_iso(m.group(1))
            if lanzamiento:
                break

    sfdr = None
    m = RE_SFDR.search(plano_1l) or RE_SFDR_2.search(plano_1l)
    if m:
        sfdr = m.group(1)

    todas = [e for k in ("entrada", "salida", "gestion", "operacion", "rendimiento") for e in et[k]]
    avisos: list[str] = []
    costes = {clave: _normaliza_coste(clave, _coste(plano_1l, et[fila], et["nulos"], todas), avisos)
              for clave, fila in CLAVES_COSTES.items()}

    return {
        "idioma": idioma,
        # False si el texto no tiene las marcas de un KID PRIIPs (p. ej. un KIID
        # UCITS anterior a 2023, cuyo SRRI no es el SRI).
        "priips": es_priips(texto),
        "isin": isin,
        "sri": _sri(texto, idioma),
        "periodo_mantenimiento_anos": periodo,
        "costes": costes,
        "fecha_documento": fecha_doc,
        "productor": productor,
        "fecha_lanzamiento": lanzamiento,
        "sfdr_articulo": sfdr,
        "texto_sha256": hashlib.sha256(texto.encode("utf-8")).hexdigest(),
        "avisos": avisos,
    }


def parsea_pdf(ruta: Path | str | bytes, isin_esperado: str | None = None) -> dict:
    """Como `parsea`, pero los costes se leen por celdas (coordenadas) cuando
    el PDF lo permite: en los KID a dos columnas la cifra de una fila puede ir
    antes o después de su etiqueta en el texto plano."""
    texto = texto_pdf(ruta)
    r = parsea(texto, isin_esperado)
    try:
        por_celdas = costes_por_celdas(ruta, r["idioma"], r["avisos"])
    except Exception:  # noqa: BLE001 - el texto plano sigue valiendo
        por_celdas = {}
    # Una fila localizada en la tabla manda también cuando no da cifra: el texto plano no ve
    # las columnas, y en la fila de operación de un KID que solo da euros leía el 9 % de la
    # comisión de rendimiento, la fila siguiente (Banca March, medido el 05-11-2026).
    r["costes"].update(por_celdas)
    if r["sri"] is None:
        try:
            r["sri"] = sri_por_celdas(ruta)
        except Exception:  # noqa: BLE001 - sin SRI antes que un SRI inventado
            pass
    return r


# El orden de las filas lo fija el reglamento: una etiqueta se busca después de la anterior.
ORDEN_FILAS = ("entrada_pct", "salida_pct", "gestion_y_otros_pct", "transaccion_pct", "rendimiento_pct")
# Lo que cierra la tabla de costes, si empieza la línea: un KID también nombra el periodo recomendado
# en la frase de encima de la tabla.
FIN_TABLA = ("cuanto tiempo debo mantener", "how long should i hold", "combien de temps dois-je",
             "periodo de mantenimiento recomendado", "recommended holding period", "como puedo reclamar",
             "how can i complain", "comment puis-je")
# La cabecera de las columnas de la tabla, que se repite en cada grupo: no es de ninguna fila.
CABECERAS = ("en caso de salida", "despues de", "de 1 ano", "de: 1 ano", "1 ano", "descripcion", "cuales son los costes",
             "si sale despues", "si vous sortez", "if you exit", "costes unicos", "one-off costs", "couts ponctuels",
             "salida", "cada ano", "en condiciones especificas", "incidencia anual", "costes en caso de")
# Los títulos de grupo de la tabla: una fila no pasa de ellos.
TITULOS_DE_GRUPO = ("costes corrientes", "costes recurrentes", "costes accesorios", "costos corrientes",
                    "gastos corrientes", "ongoing costs", "incidental costs", "couts recurrents",
                    "couts accessoires", "frais courants", "costes unicos", "one-off costs", "couts ponctuels")
# Hasta dónde se admite que una etiqueta no empiece su línea: «de 1 año Costes de entrada»,
# «Los costes de operación». Más allá es prosa: «...se incluyen en «Costes de operación»».
INICIO_DE_LINEA = 16
# Una cifra de la tabla es anual salvo que su propia fila diga otro plazo. Mutuafondo Corto Plazo,
# con 3 meses de periodo recomendado: «0,14 % del valor de su inversión al final del periodo», y
# su coste corriente anual es 0,53 %.
RE_NO_ANUAL = re.compile(r"al final del periodo|(?:por|cada|en|per|over|par|sur)\s+\d+\s+(?:mes|month|mois)")
# Lo que acompaña a una cifra anual: en la fila de entrada o de salida, es de la fila de al lado.
# M&G escribe «4,00 % del valor de su inversión. Se trata del coste de entrada máximo»: ese no es anual.
RE_ES_ANUAL = re.compile(r"\s*(?:(?:del|of the|de la)\s+(?:valor|value|valeur)[^.]{0,40}?\b(?:ano|year|an)\b|(?:al|por|cada|per|par)\s+(?:ano|year|an)\b)")
RE_IMPORTE = re.compile(r"(?:(?:eur|usd|gbp|chf|€|\$|£)\s*(\d[\d.,]*))|(?:(\d[\d.,]*)\s*(?:eur|usd|gbp|chf|€|\$|£))")
# La otra fila del par: «La comisión de salida es de 2,00 %» no es una entrada.
PALABRAS_DE_LA_OTRA_FILA = {
    "entrada_pct": ("de salida", "de reembolso", "de rescate", "exit", "redemption", "de sortie", "de rachat"),
    "salida_pct": ("de entrada", "de suscripcion", "entry", "subscription", "d'entree", "d’entree", "de souscription"),
}


def _importes(texto: str) -> list[float]:
    """Los importes de una fila: la última columna de la tabla, sobre el ejemplo de inversión."""
    salida = []
    for a, b in RE_IMPORTE.findall(texto):
        limpio = (a or b).rstrip(".,")
        # «10.000» y «1,234.50»: el último separador seguido de dos cifras es el decimal.
        m = re.fullmatch(r"(.*?)[.,](\d{1,2})", limpio)
        entero, decimal = (m.group(1), m.group(2)) if m else (limpio, "0")
        entero = re.sub(r"[.,]", "", entero)
        if entero.isdigit():
            salida.append(float(f"{entero}.{decimal}"))
    return salida


def _porcentajes_de_entrada_o_salida(clave: str, texto: str) -> list[float]:
    """Los porcentajes de la fila que son de verdad de esa fila.

    Las filas de entrada y salida son de una línea y la de al lado puede asomar: «2,41 % del
    valor de su inversión por año» es de la fila de gestión, y «la comisión de salida es de 2,00 %»
    no es una entrada."""
    salida = []
    for m in RE_PCT.finditer(texto):
        v = _pct(m)
        if v is None or RE_ES_ANUAL.match(texto, m.end()):
            continue
        antes = texto[max(0, m.start() - 30):m.start()]
        if any(p in antes for p in PALABRAS_DE_LA_OTRA_FILA[clave]):
            continue
        salida.append(v)
    return salida


def _lee_fila(clave: str, texto: str, nulos: list[str], avisos: list[str] | None) -> float | None:
    """La cifra de una fila de la tabla de costes, leída de todo lo que hay en la fila.

    Entrada y salida son un máximo: si la fila da un porcentaje positivo, es ese, aunque empiece
    por «no cobramos» (Pictet: «no cobra gastos de entrada, si bien la persona que le venda el
    producto podría cobrarle hasta 5 %», y en la columna «Hasta 500 EUR»). Si solo da un importe
    positivo no hay porcentaje que escribir y no se calcula: PIMCO dice «492 EUR. Se trata de la
    cantidad máxima que se le cobrará», y leerlo como un 0 % era falso. El resto de cifras es la
    primera de la fila, y solo cuenta si la fila no dice otro plazo que el año.
    """
    if clave in ("entrada_pct", "salida_pct"):
        porcentajes = _porcentajes_de_entrada_o_salida(clave, texto)
        positivos = [v for v in porcentajes if v > 0]
        if positivos:
            return max(positivos)
        if any(v < 0 for v in porcentajes):
            return _normaliza_coste(clave, min(porcentajes), avisos)
        if any(v > 0 for v in _importes(texto)):
            if avisos is not None:
                avisos.append(f"coste_solo_en_importe:{clave}")
            return None
        if porcentajes or any(n in texto for n in nulos) or _importes(texto):
            return 0.0
        return None
    if clave in ("gestion_y_otros_pct", "transaccion_pct") and RE_NO_ANUAL.search(texto):
        if avisos is not None:
            avisos.append(f"coste_no_anual:{clave}")
        return None
    # «No cobramos» no puede ser el coste corriente de un fondo: si la fila lo dijera, es que se ha
    # leído la de al lado. En las demás, lo que dice la fila antes de ninguna cifra es lo que vale:
    # lo que venga después puede ser de debajo de la tabla.
    primera = RE_PCT.search(texto)
    if clave != "gestion_y_otros_pct":
        nulo = min((j for j in (texto.find(n) for n in nulos) if j >= 0), default=None)
        if nulo is not None and (primera is None or nulo < primera.start()):
            return 0.0
    porcentajes = [v for v in (_pct(m) for m in RE_PCT.finditer(texto)) if v is not None]
    return _normaliza_coste(clave, porcentajes[0], avisos) if porcentajes else None


def _normaliza_linea(texto: str) -> str:
    return _reespacia(_sin_acentos(re.sub(r"\s+", " ", texto)).lower()).strip()


def _lineas_visuales(ruta_o_bytes) -> list[tuple]:
    """(página, x0, y0, x1, y1, texto normalizado, bloque), ordenadas como se ven y no como vienen
    en el PDF: en muchos KID el flujo del fichero no sigue a la página."""
    import fitz  # PyMuPDF

    if isinstance(ruta_o_bytes, (bytes, bytearray)):
        doc = fitz.open(stream=bytes(ruta_o_bytes), filetype="pdf")
    else:
        doc = fitz.open(str(ruta_o_bytes))
    lineas = []
    try:
        for n_pag, page in enumerate(doc):
            for n_bloque, bloque in enumerate(page.get_text("dict")["blocks"]):
                # Un texto justificado viene a veces palabra a palabra: a la misma altura, dentro
                # de un bloque y sin hueco de columna, es una sola línea.
                sueltas = sorted(bloque.get("lines", []), key=lambda l: (round(l["bbox"][1]), l["bbox"][0]))
                actual = None
                for linea in sueltas:
                    texto = "".join(s["text"] for s in linea["spans"])
                    x0, y0, x1, y1 = linea["bbox"]
                    if actual is not None and abs(y0 - actual[1]) < 2 and x0 - actual[2] < 25:
                        actual = [actual[0], min(actual[1], y0), max(actual[2], x1), max(actual[3], y1), actual[4] + " " + texto]
                        lineas[-1] = (n_pag, actual[0], actual[1], actual[2], actual[3], _normaliza_linea(actual[4]), n_bloque)
                        continue
                    if _normaliza_linea(texto):
                        actual = [x0, y0, x1, y1, texto]
                        lineas.append((n_pag, x0, y0, x1, y1, _normaliza_linea(texto), n_bloque))
    finally:
        doc.close()
    lineas.sort(key=lambda b: (b[0], round(b[2]), b[1]))
    return lineas


def costes_por_celdas(ruta_o_bytes, idioma: str, avisos: list[str] | None = None) -> dict[str, float | None]:
    """Composición de costes leyendo la tabla por filas geométricas, sobre líneas.

    La fila de una etiqueta son las líneas cuyo centro cae entre el punto medio con la etiqueta
    anterior y el punto medio con la siguiente: una cifra suele ir centrada en la fila y empezar
    por encima de su etiqueta. Por bloques no se puede: según el PDF, un mismo bloque lleva las
    tres etiquetas o los valores de dos filas. Devuelve solo las filas localizadas, y una fila
    sin cifra legible va como None.
    """
    et = ETIQUETAS[idioma]
    lineas = _lineas_visuales(ruta_o_bytes)
    todas_etiquetas = [e for k in CLAVES_COSTES.values() for e in et[k]]

    def cortada(texto: str, propias: list[str]) -> str:
        """El texto hasta la etiqueta de otra fila, si la hay en la misma línea."""
        fin = len(texto)
        for e in todas_etiquetas:
            if e not in propias:
                j = texto.find(e, 1)
                if 0 < j < fin and texto[j - 1] not in "«\"":
                    fin = j
        return texto[:fin]

    inicio = next((i for i, b in enumerate(lineas) if any(m in b[5] for m in SECCION_COSTES)), None)
    # Sin título de tabla, empieza en la primera fila de entrada que abra su línea.
    if inicio is None:
        inicio = next((i for i, b in enumerate(lineas)
                       if any(0 <= b[5].find(e) <= INICIO_DE_LINEA for e in et["entrada"])), 0)
    fin_tabla = next((i for i, b in enumerate(lineas) if i > inicio and b[5].lstrip("¿").startswith(FIN_TABLA)), len(lineas))

    def siguiente_de_su_columna(i: int) -> int | None:
        """La línea que sigue a esta en su columna, aunque entre medias se vean otras: las del valor van a su lado."""
        b = lineas[i]
        for k in range(i + 1, min(i + 12, len(lineas))):
            c = lineas[k]
            if c[0] != b[0] or c[2] - b[4] > 8:
                return None
            if abs(c[1] - b[1]) <= 6:
                return k
        return None

    # Una etiqueta puede venir partida en dos líneas: «Comisiones de gestión y» / «otros costes».
    texto_de = []
    for i, b in enumerate(lineas):
        k = siguiente_de_su_columna(i)
        texto_de.append(b[5] + " " + lineas[k][5] if k is not None else b[5])

    def busca(etiquetas: list[str], desde: int) -> tuple[int, int] | None:
        """(línea, posición). Por orden de `etiquetas`, de la más precisa a la genérica, que además
        de fila es el título de un grupo de filas («Costes corrientes detraídos cada año»)."""
        for e in etiquetas:
            for i in range(desde, fin_tabla):
                j = texto_de[i].find(e)
                if 0 <= j <= INICIO_DE_LINEA and j < len(lineas[i][5]) and (j == 0 or texto_de[i][j - 1] not in "«\""):
                    return i, j
        # Una etiqueta detrás de su cifra, en la misma línea: «...puede 187,10 EUR Costes de operación».
        for e in etiquetas:
            for i in range(desde, fin_tabla):
                j = lineas[i][5].find(e)
                if j > INICIO_DE_LINEA and lineas[i][5][j - 1] not in "«\"":
                    return i, j
        return None

    filas: list[tuple[str, int, int]] = []
    desde = inicio
    for clave in ORDEN_FILAS:
        hallada = busca(et[CLAVES_COSTES[clave]], desde)
        if hallada is not None:
            filas.append((clave, *hallada))
            desde = hallada[0]

    def anclaje(i: int) -> tuple[float, float, float]:
        """x0 y extensión vertical de la etiqueta, con las líneas que la continúan en su columna."""
        b = lineas[i]
        y0, y1 = b[2], b[4]
        k = siguiente_de_su_columna(i)
        while k is not None and k < fin_tabla:
            c = lineas[k]
            if RE_PCT.search(c[5]) or any(0 <= c[5].find(e) <= INICIO_DE_LINEA for e in todas_etiquetas):
                break
            y1 = c[4]
            k = siguiente_de_su_columna(k)
        return b[1], y0, y1

    anclas = [anclaje(i) for _c, i, _j in filas]
    titulos = [b for b in lineas[inicio:fin_tabla]
               if b[5].startswith(TITULOS_DE_GRUPO) and not RE_PCT.search(b[5])
               and not any(e in b[5] for e in todas_etiquetas if e not in TITULOS_DE_GRUPO)]
    out: dict[str, float | None] = {}
    for n, (clave, i, j) in enumerate(filas):
        fila = lineas[i]
        propias = et[CLAVES_COSTES[clave]]
        x0, y0, y1 = anclas[n]
        c = (y0 + y1) / 2
        # Lo de la izquierda de una etiqueta no es de su fila, salvo que la línea no empiece por ella:
        # «29,79 EUR Costes de operación incurrimos al comprar...», con la cifra una línea más arriba.
        izquierda = x0 - 4 if j == 0 else 0
        # Sin vecina en la página, una fila normal.
        previa = (anclas[n - 1][1] + anclas[n - 1][2]) / 2 if n > 0 and lineas[filas[n - 1][1]][0] == fila[0] else None
        posterior = (anclas[n + 1][1] + anclas[n + 1][2]) / 2 if n + 1 < len(filas) and lineas[filas[n + 1][1]][0] == fila[0] else None
        lo = (previa + c) / 2 if previa is not None else c - 45
        hi = (posterior + c) / 2 if posterior is not None else c + 60
        for t in titulos:
            if t[0] != fila[0] or t is fila:
                continue
            if t[4] <= c:
                lo = max(lo, t[4])
            elif t[2] >= c:
                hi = min(hi, t[2])
        trozos = []
        for k in range(inicio, fin_tabla):
            b = lineas[k]
            if b[0] != fila[0] or b[1] < izquierda or not lo <= (b[2] + b[4]) / 2 <= hi:
                continue
            if k == i:
                # Desde la etiqueta: la regla del signo tiene que ver lo que hay delante de la cifra (MEN-8).
                # Salvo que la cifra vaya delante: «0,1 % Costes de operación de cartera».
                trozos.append(cortada(b[5][j:] if RE_PCT.search(b[5][j:]) or not RE_PCT.search(b[5]) else b[5], propias))
            elif not b[5].lstrip("¿").startswith(CABECERAS) or RE_PCT.search(b[5]):
                trozos.append(cortada(b[5], propias))
        out[clave] = _lee_fila(clave, " ".join(trozos), et["nulos"], avisos)
    return out
