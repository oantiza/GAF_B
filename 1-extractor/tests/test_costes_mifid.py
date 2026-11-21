# -*- coding: utf-8 -*-
"""La lectura de los costes MiFID de Morningstar (decisión 60, 09-11-2026).

Morningstar da dos cifras por coste: `…Estimated` (ex ante, la del EMT `07130` y la del KID) y `…Actual`
(la real del último periodo, la del `08070`). Hasta el 09-11 se tomaba primero la real y se guardaba como
`costes.mifid_emt_exante`. La medición está en `INFORME_COSTE_OPERACION_2026-11-09.md` (raíz). Los números
de abajo son los de `IE000DR59CI3` y `IE000X59ZHE2` en la caché del 08-11.
"""
import json
import logging
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from core import exporta  # noqa: E402
from fetchers.morningstar_lt import _mapea_mifid  # noqa: E402

# La forma real de la respuesta, recortada a lo que se lee (IE000DR59CI3, 08-11-2026), con la fecha de
# la real movida para que se distinga de la estimada.
MIFID = {
    "SummaryRiskIndicator": 5,
    "TransactionFeeActual": 0.22607, "TransactionFeeActualDate": "2025-12-31T00:00:00",
    "TransactionFeeEstimated": 0.07829, "TransactionFeeEstimatedDate": "2026-06-30T00:00:00",
    "PerformanceFeeActual": 0.0, "PerformanceFeeActualDate": "2025-12-31T00:00:00",
    "PerformanceFeeEstimated": 0.0, "PerformanceFeeEstimatedDate": "2026-06-30T00:00:00",
    "OngoingCostActual": 0.52, "OngoingCostActualDate": "2025-12-31T00:00:00",
    "OngoingCostEstimated": 0.5, "OngoingCostEstimatedDate": "2026-06-30T00:00:00",
}


def _mapea(mifid: dict, isin: str = "IE000DR59CI3") -> dict:
    out: dict = {}
    _mapea_mifid(out, {"Mifid": mifid, "CollectedSRRI": {"Rank": 6}}, isin)
    return out


def test_manda_la_estimada_con_su_fecha():
    c = _mapea(MIFID)["costes"]
    assert c["mifid_emt_exante"] == {"corrientes_pct": 0.5, "transaccion_pct": 0.07829,
                                     "incidentales_pct": 0.0, "fecha": "2026-06-30"}


def test_la_real_va_a_su_bloque_ex_post_con_su_fecha():
    c = _mapea(MIFID)["costes"]
    assert c["mifid_ex_post"] == {"corrientes_pct": 0.52, "transaccion_pct": 0.22607,
                                  "incidentales_pct": 0.0, "fecha": "2025-12-31"}


def test_sin_estimada_no_cae_a_la_real():
    """Antes era al revés: la real primero y la estimada si faltaba. Ahora la real nunca se guarda como ex ante."""
    mifid = {k: v for k, v in MIFID.items() if not k.startswith("PerformanceFeeEstimated")}
    c = _mapea(mifid)["costes"]
    assert "incidentales_pct" not in c["mifid_emt_exante"]
    assert c["mifid_ex_post"]["incidentales_pct"] == 0.0


def test_sin_ninguna_estimada_no_hay_fecha_ex_ante():
    mifid = {k: v for k, v in MIFID.items() if "Estimated" not in k}
    c = _mapea(mifid)["costes"]
    assert "mifid_emt_exante" not in c                  # ni siquiera la fecha: no aplica sin cifra
    assert c["mifid_ex_post"]["fecha"] == "2025-12-31"


def test_una_estimada_negativa_queda_ausente_con_aviso(caplog):
    """No se recorta a cero, que sería inventar un coste."""
    mifid = {**MIFID, "TransactionFeeEstimated": -0.01}
    with caplog.at_level(logging.WARNING, logger="fondosdb.morningstar_lt"):
        c = _mapea(mifid, "IE000X59ZHE2")["costes"]
    assert "transaccion_pct" not in c["mifid_emt_exante"]
    assert c["mifid_emt_exante"]["corrientes_pct"] == 0.5
    avisos = [r.getMessage() for r in caplog.records]
    assert any("IE000X59ZHE2" in a and "TransactionFeeEstimated" in a and "negativo" in a for a in avisos)


def test_una_real_negativa_se_conserva_en_ex_post():
    """El caso real de IE000X59ZHE2: −0,02848 % ex post, 0,08904 % ex ante. Un ex post puede ser negativo."""
    mifid = {**MIFID, "TransactionFeeActual": -0.02848, "TransactionFeeEstimated": 0.08904}
    c = _mapea(mifid, "IE000X59ZHE2")["costes"]
    assert c["mifid_emt_exante"]["transaccion_pct"] == 0.08904
    assert c["mifid_ex_post"]["transaccion_pct"] == -0.02848


# ------------------------------------------------------------------ el canónico
def _ficha_con_ex_post(base: Path) -> None:
    isin = "IE000DR59CI3"
    d = {
        "meta": {"isin": isin, "procedencia": {
            "costes.mifid_emt_exante.transaccion_pct": "morningstar_lt:Mifid",
            "costes.mifid_ex_post.transaccion_pct": "morningstar_lt:Mifid",
            "costes.mifid_ex_post.fecha": "morningstar_lt:Mifid"}},
        "identificacion": {"isin": isin, "tipo": "etf", "nombre": "ETF de prueba"},
        "costes": {"ter_pct": 0.5,
                   "mifid_emt_exante": {"transaccion_pct": 0.07829, "fecha": "2026-06-30"},
                   "mifid_ex_post": {"transaccion_pct": 0.22607, "fecha": "2026-06-30"}},
        "calidad": {"bucket": "COMPLETO", "flags": []},
    }
    funds = base / "data" / "funds"
    funds.mkdir(parents=True, exist_ok=True)
    (funds / f"{isin}.json").write_text(json.dumps(d), encoding="utf-8")


def test_el_canonico_no_lleva_el_ex_post(tmp_path):
    _ficha_con_ex_post(tmp_path)
    exporta.export_all(tmp_path, tmp_path / "export")
    texto = (tmp_path / "export" / "fondos.ndjson").read_text(encoding="utf-8")
    assert "mifid_ex_post" not in texto                 # ni el bloque ni su procedencia
    doc = json.loads(texto.splitlines()[0])
    assert doc["costes"]["mifid_emt_exante"] == {"transaccion_pct": 0.07829, "fecha": "2026-06-30"}
    assert doc["meta"]["procedencia"] == {"costes.mifid_emt_exante.transaccion_pct": "morningstar_lt:Mifid"}
    # La ficha no se toca: el ex post se sigue guardando.
    ficha = json.loads((tmp_path / "data" / "funds" / "IE000DR59CI3.json").read_text(encoding="utf-8"))
    assert ficha["costes"]["mifid_ex_post"]["transaccion_pct"] == 0.22607
