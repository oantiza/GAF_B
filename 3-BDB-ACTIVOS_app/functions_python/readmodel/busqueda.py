# -*- coding: utf-8 -*-
"""
Como se encuentra un activo por lo que se teclea (decision 81 de Oscar, 05-11-2026).

La misma regla que el Buscador, `src/core/busquedaDeActivos.ts`: se pliegan acentos y mayusculas, se
ignoran apostrofos y puntos, y cada palabra tecleada tiene que estar en el nombre, el ISIN o el
simbolo, en cualquier orden, o ser una palabra entera de un nombre habitual: dentro de «Iberia» esta
IBE, y un simbolo tiene que seguir dando lo mismo. Las dos pasan por los mismos casos,
`tests/fixtures/busqueda_de_activos.json`.
"""
import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def _lista() -> dict:
    return json.loads(Path(__file__).with_name("nombres_habituales.json").read_text(encoding="utf-8"))


def plegar(texto) -> str:
    """Sin acentos y en minusculas. Tambien la enie: «Diseño» encuentra el «Diseno» de la base."""
    descompuesto = unicodedata.normalize("NFD", str(texto or ""))
    return "".join(c for c in descompuesto if not unicodedata.category(c).startswith("M")).lower()


_APOSTROFOS_Y_PUNTOS = re.compile(r"['’‘´`.]")


def como_se_busca(texto) -> str:
    """Plegado y sin apostrofos ni puntos (decision 113): «Loreal» y «L'Oreal» encuentran a L'Oréal, y «JP Morgan» y «J.P. Morgan» son lo mismo."""
    return _APOSTROFOS_Y_PUNTOS.sub("", plegar(texto))


def palabras_de_la_busqueda(busqueda) -> list:
    variantes = _lista()["variantes_de_gestora"]
    return [variantes.get(palabra, palabra) for palabra in como_se_busca(busqueda).split()]


def _habituales(isin) -> list:
    return _lista()["nombres_por_isin"].get(str(isin or ""), [])


def coincide(palabras: list, nombre, isin, ticker=None) -> bool:
    """Si un activo responde a las palabras de `palabras_de_la_busqueda`. Sin palabras responden todos."""
    if not palabras:
        return True
    donde = como_se_busca(" ".join(str(campo) for campo in (nombre, isin, ticker) if campo))
    habituales = como_se_busca(" ".join(_habituales(isin))).split()
    return all(palabra in donde or palabra in habituales for palabra in palabras)


def es_respuesta_exacta(busqueda, isin, ticker=None) -> bool:
    """Si lo tecleado es exactamente su simbolo, su ISIN o su nombre habitual: es lo que va delante."""
    texto = " ".join(como_se_busca(busqueda).split())
    if not texto:
        return False
    return any(como_se_busca(campo) == texto for campo in (isin, ticker, *_habituales(isin)) if campo)
