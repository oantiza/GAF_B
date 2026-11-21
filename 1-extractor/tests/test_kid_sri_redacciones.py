# -*- coding: utf-8 -*-
"""El SRI se lee del texto del KID, y hasta el 31-10-2026 se leía poco.

Diecisiete KID de los 172 en caché no daban SRI ni por el texto ni por el método de
celdas. Sin SRI del propio documento el mapeador no puede construir
`risk.sri_kid_evidence`, y la ficha de la app acaba enseñando el SRRI de UCITS —otra
medida, superada desde 2023— en vez del indicador vigente.

Faltaban dos redacciones, las dos del mismo día:

«En una escala de 7, la categoría de riesgo 3 indica un nivel de riesgo medio bajo» es
la más común. El patrón nuevo pide solo la segunda mitad **a propósito**: estos KID son
de dos columnas y la extracción de texto las intercala, así que la frase llega partida
por un trozo de la columna de al lado. Pedir que «escala de 7» esté pegado al dígito la
dejaba fuera.

«Hemos clasificado este producto en la clase de riesgo de 3 (sobre 7)» se caía por un
«de» de más antes del dígito y por el paréntesis.

Las cadenas están copiadas de los KID reales que había en caché.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import kid  # noqa: E402


def _sri(texto: str) -> int | None:
    return kid._sri(kid._sin_acentos(texto), "es")


# Partidas por la intercalación de columnas, tal como salen del PDF.
PARTIDAS = [
    ("por nuestra incapacidad de pagarle. En una escala de 7, modificar sus posiciones. "
     "la categoria de riesgo 3 indica un nivel de riesgo medio bajo.", 3),
    ("dad de pagarle. En una escala de 7, liquidar, iniciar o modificar sus posiciones. "
     "la categoria de riesgo 2 indica un nivel de riesgo bajo.", 2),
    ("dad de pagarle. En una escala de 7, liquidar, iniciar o modificar sus posiciones. "
     "la categoria de riesgo 3 indica un nivel de riesgo medio bajo.", 3),
]

ENTERAS = [
    ("de los mercados o por nuestra incapacidad de pagarle. En una escala de 7, "
     "la categoria de riesgo 4 indica un nivel de riesgo medio.", 4),
    ("Hemos clasificado este producto en la clase de riesgo de 3 (sobre 7), que es una "
     "clase de riesgo baja-media.", 3),
    ("Hemos clasificado este producto en la clase de riesgo de 6 (sobre 7), que es una "
     "clase de riesgo alta.", 6),
]


@pytest.mark.parametrize("texto,esperado", PARTIDAS)
def test_la_frase_partida_por_las_columnas_sigue_valiendo(texto, esperado):
    assert _sri(texto) == esperado


@pytest.mark.parametrize("texto,esperado", ENTERAS)
def test_redacciones_reales_de_los_kid_en_cache(texto, esperado):
    assert _sri(texto) == esperado


@pytest.mark.parametrize("texto", [
    # La escala gráfica llega al texto plano como una fila de dígitos, con el de la clase
    # repetido. Una fila de dígitos sola no dice nada y no debe dar un SRI.
    "Muestra las probabilidades de que el producto pierda dinero 1 2 33 4 5 6 7 debido a "
    "la evolucion de los mercados. Riesgo mas bajo Riesgo mas alto",
    # Ni el periodo de mantenimiento, ni los años, ni los porcentajes.
    "La duracion del periodo de mantenimiento recomendado es de 3 anos.",
    "El fondo invierte un maximo del 25% del patrimonio neto en mercados emergentes.",
    # «riesgo de sostenibilidad» y «riesgo de contraparte» no son la clase.
    "El riesgo de sostenibilidad del Fondo puede diferir del riesgo de sostenibilidad "
    "del Indicador de referencia en un 7 por ciento.",
])
def test_lo_que_no_es_la_clase_no_da_sri(texto):
    assert _sri(texto) is None


@pytest.mark.parametrize("digito", [1, 2, 3, 4, 5, 6, 7])
def test_los_siete_valores_de_la_escala(digito):
    assert _sri("En una escala de 7, la categoria de riesgo %d indica un nivel de riesgo." % digito) == digito


def test_un_valor_fuera_de_la_escala_no_se_acepta():
    """El SRI de PRIIPs va de 1 a 7. Un 8 o un 0 es un error de lectura."""
    for fuera in (0, 8, 9):
        assert _sri("En una escala de 7, la categoria de riesgo %d indica un nivel de riesgo." % fuera) is None


def test_el_kiid_de_ucits_no_puede_colar_su_srri_como_sri():
    """Esta es la prueba que importa de todo el fichero.

    Los patrones nuevos leen el dígito de un KIID de UCITS igual que de un KID de PRIIPs:
    la redacción de la clase de riesgo se parece. Pero en un KIID ese número es el **SRRI**,
    que es otra escala y otra cosa, y grabarlo como SRI sería el peor error posible en este
    campo. Lo único que lo evita es `es_priips`, y los fetchers que se niegan cuando dice
    False (`kid_gestora._lee` y sus dos hermanos).

    Medido el 31-10-2026: LU0571100824 y LU1897556517 traen de Renta 4 un documento titulado
    «DOCUMENTO DE DATOS FUNDAMENTALES **PARA EL INVERSOR**» —el título de UCITS, no el de
    PRIIPs—, y de ahí se leería un 3 y un 5 que no son SRI. Se descartan, y está bien.
    """
    kiid = ("DOCUMENTO DE DATOS FUNDAMENTALES PARA EL INVERSOR OBJETIVO El presente documento "
            "contiene informacion esencial sobre el fondo. Perfil de riesgo y remuneracion. "
            "En una escala de 7, la categoria de riesgo 3 indica un nivel de riesgo medio bajo.")
    # El patron lee el digito: por eso hace falta el guardia.
    assert _sri(kiid) == 3
    # Y el guardia lo marca como lo que es, para que el fetcher lo tire.
    assert kid.es_priips(kiid) is False
    assert kid.parsea(kiid)["priips"] is False

    # El KID de PRIIPs equivalente si pasa.
    priips = ("Documento de datos fundamentales. Indicador resumido de riesgo. "
              "En una escala de 7, la categoria de riesgo 3 indica un nivel de riesgo medio bajo.")
    assert kid.es_priips(priips) is True
    assert kid.parsea(priips)["sri"] == 3


def test_las_redacciones_que_ya_funcionaban_no_cambian():
    """Los patrones nuevos van al final de la lista: lo que ya acertaba, acierta igual."""
    assert _sri("Hemos clasificado este producto en la clase de riesgo 4 en una escala de 7.") == 4
    assert _sri("clase de riesgo 5 en una escala de 7, en la que 5 significa un riesgo alto") == 5
    assert _sri("El producto esta en la clase de riesgo 2.") == 2
    # La confirmacion manda sobre el resto: el primer digito es un resto de la escala grafica.
    assert _sri("clase de riesgo 1 en una escala de 7, en la que 3 significa un riesgo medio bajo") == 3
