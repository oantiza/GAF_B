# -*- coding: utf-8 -*-
"""Saneado de la cartera: países a ISO3 y sectores a la nomenclatura propia."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import limpieza  # noqa: E402


def test_los_sectores_en_espanol_con_tilde_no_se_descartan():
    # Auditoría 16-10, NUEVO-2: «Tecnología» y «Energía» quedaban en
    # «tecnologia»/«energia» al normalizar, que no estaban en SECTORES_ES, y
    # el sector desaparecía.
    cartera = {"sectores_pct": {"Energía": 5, "Tecnología": 20, "Servicios financieros": 10,
                                "Consumo cíclico": 4, "Comunicación": 3, "Technology": 99,
                                "inventado": 1}}
    limpieza._normaliza_sectores(cartera)
    assert cartera["sectores_pct"] == {
        "energia": {"fondo": 5}, "tecnologia": {"fondo": 20},
        "servicios_financieros": {"fondo": 10}, "consumo_ciclico": {"fondo": 4},
        "comunicacion": {"fondo": 3}}


def test_cada_sector_valido_se_reconoce_escrito_a_mano():
    for valido in limpieza.SECTORES_VALIDOS:
        escrito = valido.replace("_", " ").capitalize()
        assert limpieza._sector(escrito) == valido, escrito


def test_toda_clave_de_las_tablas_es_alcanzable():
    # Auditoría 16-10, MEDIA-13: «canada », «taiwan », «mexico », «austria » y
    # «energia » nunca se encontraban, porque la búsqueda pasa por _norm_txt,
    # que hace strip(). Cada clave tiene que dar su valor por el camino real.
    for clave, iso in limpieza.PAISES_ISO3.items():
        assert clave == clave.strip(), repr(clave)
        assert limpieza.PAISES_ISO3.get(limpieza._norm_txt(clave)) == iso, repr(clave)
    for clave, sector in limpieza.SECTORES_ES.items():
        assert clave == clave.strip(), repr(clave)
        assert limpieza._sector(clave) == sector, repr(clave)
