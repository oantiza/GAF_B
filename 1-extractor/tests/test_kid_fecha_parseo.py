# -*- coding: utf-8 -*-
"""La fecha del documento se lee del texto del KID, y hasta el 31-10-2026 se leía poco.

Treinta y un KID de los 172 en caché no daban fecha, y sin fecha el mapeador no puede
construir `risk.sri_kid_evidence`: el fondo publica su SRI y no hay documento que lo
sostenga. La causa eran dos cosas distintas, no una.

La primera, redacciones que no estaban cubiertas. La más común con diferencia es
«Producido el: 16/04/2026»: un participio sin «se», mientras el patrón que existía
pedía «se produjo el».

La segunda, los meses abreviados. «5 Aug 2026» en un documento por lo demás en
español hacía acertar al patrón y fallar a `_fecha_iso`, que solo conocía los nombres
completos.

Las cadenas de abajo están copiadas de los KID reales que había en caché, no inventadas.
Las de `SIN_FECHA` son las trampas: fechas de lanzamiento y de creación, que no son la
del documento y deben seguir sin acertar.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import kid  # noqa: E402


def _fecha(texto: str) -> str | None:
    """Lo que hace `parsea` con la fecha, aislado."""
    for patron in kid.RE_FECHA_DOC["es"]:
        encaje = patron.search(kid._sin_acentos(texto))
        if encaje:
            fecha = kid._fecha_iso(encaje.group(1))
            if fecha:
                return fecha
    return None


CON_FECHA = [
    ("Autorite des marches financiers (GP97008). Producido el: 16/04/2026", "2026-04-16"),
    ("valores mobiliarios autorizada por la CSSF. Producido el: 16/04/2026", "2026-04-16"),
    ("Este documento de datos fundamentales es valido a 2026-02-18", "2026-02-18"),
    ("la ultima revision del documento de datos fundamentales: 5 de mayo de 2025", "2025-05-05"),
    ("Este producto esta autorizado en Ireland. Documento vigente a partir de: 04/09/2026", "2026-09-04"),
    ("Sector Financiero (CSSF) en Luxemburgo. Documento publicado 26/3/2026", "2026-03-26"),
    ("en relacion con este documento de datos fundamentales. Fecha: 7 noviembre 2025", "2025-11-07"),
    ("CSSF. Este documento de datos fundamentales tiene fecha de 10/05/2026", "2026-05-10"),
    ("www.ninetyone.com | +44 (0) 203 938 1800. Publicado el 27 de marzo de 2026", "2026-03-27"),
    ("Este documento de datos fundamentales es exacto a 5 Aug 2026", "2026-08-05"),
]

SIN_FECHA = [
    # El ISIN se come los dos puntos y la fecha que sigue es la de lanzamiento.
    "Fecha de elaboracion del Codigo ISIN: LU0675297237 30 de diciembre de 2022",
    "La SICAV se creo el 30/06/1999 con una duracion indefinida.",
    "El subfondo se lanzo el 30/06/1999.",
    "La clase de acciones mostrada se lanzo el 15 de enero de 2015.",
    "El fondo se constituyo el 12/03/2004 con una duracion de 99 anos.",
]


@pytest.mark.parametrize("texto,esperada", CON_FECHA)
def test_redacciones_reales_de_los_kid_en_cache(texto, esperada):
    assert _fecha(texto) == esperada


@pytest.mark.parametrize("texto", SIN_FECHA)
def test_una_fecha_de_lanzamiento_no_es_la_del_documento(texto):
    assert _fecha(texto) is None


@pytest.mark.parametrize("texto,esperada", [
    ("5 Aug 2026", "2026-08-05"),
    ("7 ene 2026", "2026-01-07"),
    ("1 sept 2026", "2026-09-01"),
    ("1 sep 2026", "2026-09-01"),
    ("12 dic. 2025", "2025-12-12"),
    ("3 March 2026", "2026-03-03"),
    ("12 de diciembre de 2025", "2025-12-12"),
])
def test_los_meses_abreviados_tambien_cuentan(texto, esperada):
    assert kid._fecha_iso(texto) == esperada


def test_una_abreviatura_ambigua_no_se_adivina():
    """En frances «juin» y «juillet» comparten «jui».

    Poner junio o julio a cara o cruz en la fecha de un documento regulatorio es peor
    que no tener fecha, asi que esa abreviatura no se da de alta.
    """
    assert "jui" not in kid.MESES_FR
    assert kid._fecha_iso("3 jui 2026") is None
    # Las que no chocan si estan, en los tres idiomas.
    assert kid.MESES_FR["mar"] == 3
    assert kid.MESES_ES["may"] == 5
    assert kid.MESES_EN["may"] == 5
    assert kid.MESES_EN["mar"] == 3


def test_los_nombres_completos_siguen_estando():
    completos = {
        "es": ["enero", "febrero", "marzo", "abril", "mayo", "junio",
               "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
        "en": ["january", "february", "march", "april", "may", "june",
               "july", "august", "september", "october", "november", "december"],
        "fr": ["janvier", "fevrier", "mars", "avril", "mai", "juin",
               "juillet", "aout", "septembre", "octobre", "novembre", "decembre"],
    }
    for tabla, nombres in ((kid.MESES_ES, completos["es"]),
                           (kid.MESES_EN, completos["en"]),
                           (kid.MESES_FR, completos["fr"])):
        for numero, nombre in enumerate(nombres, 1):
            assert tabla[nombre] == numero
