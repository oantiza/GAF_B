# -*- coding: utf-8 -*-
"""Lo que FIRDS dejó en la ficha llega al canónico, y solo eso.

Encargo «identidad» del 07-11-2026, pieza 3. Hasta hoy la ficha tenía CFI, LEI del emisor y
centros de negociación desde el paso 1, y ningún canónico los llevaba. Los casos son reales,
leídos del índice FIRDS del 31-10 con los deltas hasta el 06-11:

- `ES0105046017` Aena: acción en 46 centros; aquí van tres.
- `IE00B4ND3602` iShares Physical Gold: el ETC que el sistema llama `etf` y FIRDS `EYAYFT`.
- `ES0110407006`: un fondo español que no cotiza; FIRDS no lo tiene, y su CFI lo da la CNMV.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.adaptador_bdb import identidad_firds  # noqa: E402

AENA = {
    "identificacion": {
        "cfi": "ESVUFB", "cfi_tipo": "ACCION", "lei_emisor": "959800R7QMXKF0NFMT29",
        "autoridad_competente_firds": "ES",
        "mercados_ue": [{"mic": "AQEU", "primera_negociacion": "2025-06-20"},
                        {"mic": "XMAD", "admision": "2025-06-19", "primera_negociacion": "2025-06-19"},
                        {"mic": "XETB", "admision": "2025-06-23", "baja": None}],
    },
    "meta": {"firds_visto": "2026-10-31", "procedencia": {"identificacion.cfi": "esma_firds:fulins"}},
}
ETC = {
    "identificacion": {"tipo": "etf", "cfi": "EYAYFT", "cfi_tipo": "ESTRUCTURADO",
                       "lei_emisor": "549300T2ISPWHQ8IPF83", "autoridad_competente_firds": "DE",
                       "mercados_ue": [{"mic": "XETA", "admision": "2011-04-18"}]},
    "meta": {"firds_visto": "2026-10-31", "procedencia": {"identificacion.cfi": "esma_firds:fulins"}},
}
FONDO_CNMV = {
    "identificacion": {"tipo": "fondo", "cfi": "CIOGLU"},
    "meta": {"procedencia": {"identificacion.cfi": "cnmv_ficha:ancv"}},
}


def test_una_accion_lleva_su_cfi_su_emisor_y_sus_centros():
    b = identidad_firds(AENA)
    assert b["cfi"] == "ESVUFB" and b["cfi_tipo"] == "ACCION"
    assert b["lei_emisor"] == "959800R7QMXKF0NFMT29"
    assert b["autoridad_competente"] == "ES" and b["visto"] == "2026-10-31"
    assert b["mercados"] == [{"mic": "AQEU", "primera_negociacion": "2025-06-20"},
                             {"mic": "XMAD", "admision": "2025-06-19", "primera_negociacion": "2025-06-19"},
                             {"mic": "XETB", "admision": "2025-06-23"}]
    assert "baja_en_todos" not in b


def test_el_etc_lleva_su_cfi_de_estructurado_y_no_cambia_de_tipo():
    b = identidad_firds(ETC)
    assert (b["cfi"], b["cfi_tipo"]) == ("EYAYFT", "ESTRUCTURADO")
    assert ETC["identificacion"]["tipo"] == "etf"


def test_un_fondo_que_firds_no_tiene_no_lleva_bloque_aunque_tenga_cfi_de_la_cnmv():
    assert identidad_firds(FONDO_CNMV) is None


def test_si_el_cfi_fusionado_es_de_la_cnmv_no_viaja_como_de_firds():
    mezcla = {"identificacion": {**AENA["identificacion"], "cfi": "CIOGLU"},
              "meta": {"firds_visto": "2026-10-31", "procedencia": {"identificacion.cfi": "cnmv_ficha:ancv"}}}
    b = identidad_firds(mezcla)
    assert "cfi" not in b and "cfi_tipo" not in b
    assert b["lei_emisor"] == "959800R7QMXKF0NFMT29"


def test_una_baja_en_todos_los_centros_viaja_con_su_fecha():
    baja = {"identificacion": {**AENA["identificacion"], "baja_en_todos_firds": "2025-07-15"},
            "meta": AENA["meta"]}
    assert identidad_firds(baja)["baja_en_todos"] == "2025-07-15"
