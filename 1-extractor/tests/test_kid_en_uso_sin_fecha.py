# -*- coding: utf-8 -*-
"""Control de «KID en uso sin fecha» (C-30, 21-11-2026).

Una ficha que usa un KID (lleva su url o su sha256) sin la fecha de elaboración se
nombra como aviso: sin fecha no se puede aplicar la caducidad de KID_MAX_DIAS. Si una
gestora cambia la maquetación de su PDF, el lector deja de leerla y esto lo caza.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import calidad  # noqa: E402


def _ficha(**docs):
    return {"documentos_oficiales": docs}


def test_kid_en_uso_sin_fecha_se_nombra():
    r = calidad.kid_en_uso_sin_fecha(_ficha(kid_url="https://x/kid.pdf", kid_fuente="amundi", kid_sha256="ab"))
    assert r == {"fuente": "amundi", "url": "https://x/kid.pdf"}


def test_con_fecha_no_se_avisa():
    assert calidad.kid_en_uso_sin_fecha(
        _ficha(kid_url="https://x/kid.pdf", kid_sha256="ab", kid_fecha="2026-04-16")) is None


def test_sin_kid_no_aplica():
    assert calidad.kid_en_uso_sin_fecha({}) is None
    assert calidad.kid_en_uso_sin_fecha(_ficha()) is None


def test_el_aviso_no_toca_flags_ni_score():
    d = {"documentos_oficiales": {"kid_url": "u", "kid_sha256": "ab"}}
    calidad.aplica(d)
    assert not any("kid" in f for f in d["calidad"]["flags"])
