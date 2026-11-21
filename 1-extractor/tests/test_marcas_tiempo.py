# -*- coding: utf-8 -*-
"""Las marcas de tiempo del canónico van en UTC con desfase.

`quality.parsed_at` y `generated_at` (fondo y acción) salían en hora local sin
zona, mientras `_resumen.generado` y `meta.actualizado` iban en UTC
(auditoría 16-10, MEDIA-13).
"""
import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import calidad  # noqa: E402
from core.adaptador_bdb import convierte  # noqa: E402
from tests.test_adaptador_validacion import _fondo_sano  # noqa: E402


def _en_utc(marca: str) -> bool:
    return (marca.endswith("+00:00") or marca.endswith("Z")) and \
        dt.datetime.fromisoformat(marca).utcoffset() == dt.timedelta(0)


def test_el_canonico_de_un_fondo_lleva_sus_marcas_en_utc():
    d = _fondo_sano()
    calidad.aplica(d)
    c = convierte(d)
    assert _en_utc(c["generated_at"]), c["generated_at"]
    assert _en_utc(c["quality"]["parsed_at"]), c["quality"]["parsed_at"]


def test_el_canonico_de_una_accion_lleva_sus_marcas_en_utc():
    d = {"meta": {"isin": "US0378331005", "actualizado": "2026-09-01"},
         "identificacion": {"nombre": "Apple Inc", "tipo": "accion"}}
    calidad.aplica(d)
    c = convierte(d)
    assert c["ms"]["stock"] is not None
    assert _en_utc(c["generated_at"]), c["generated_at"]
    assert _en_utc(c["quality"]["parsed_at"]), c["quality"]["parsed_at"]
