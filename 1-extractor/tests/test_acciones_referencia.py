# -*- coding: utf-8 -*-
"""Una accion contra su referencia: solo beta y R2, a 3 y 5 anos (decision 24)."""
import random
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fetchers import eodhd, vl_fondos  # noqa: E402


def _config(tmp_path):
    (tmp_path / "config").mkdir()
    (tmp_path / "config" / "indices.csv").write_text(
        "benchmark,variante,proxy,clase_de_serie,base,fondos,nota\n"
        "MSCI Europe,NR,IE0007987708,VALOR_LIQUIDATIVO,TOTAL_RETURN,1,nota\n", encoding="utf-8")
    (tmp_path / "config" / "indices_de_accion.csv").write_text(
        "bolsa,benchmark,alcance,nota\nMC,MSCI Europe,AREA,Espana\nTO,,SIN_REFERENCIA,Canada\n", encoding="utf-8")


def _series(anos=6):
    aleatorio = random.Random(7)
    fin, d = date(2026, 10, 30), date(2026, 10, 30) - timedelta(days=365 * anos)
    indice, accion, i, a = [], [], 100.0, 100.0
    while d <= fin:
        if d.weekday() < 5:
            r = aleatorio.gauss(0.0004, 0.01)
            i *= 1 + r
            a *= 1 + 1.3 * r + aleatorio.gauss(0, 0.01)
            indice.append((d, round(i, 4)))
            accion.append((d, round(a, 4)))
        d += timedelta(days=1)
    return accion, indice


def test_solo_beta_y_r2_a_tres_y_cinco_anos(tmp_path, monkeypatch):
    _config(tmp_path)
    accion, indice = _series()
    monkeypatch.setattr(vl_fondos, "_serie_del_proxy", lambda *a, **k: indice)
    monkeypatch.setattr(eodhd, "_token", lambda *a, **k: "t")
    out = {}
    eodhd._aplica_referencia(out, accion, "EODHD:SAN.MC", None, tmp_path)
    r = out["riesgo"]["relativas"]
    assert r["indice_nombre"] == "MSCI Europe" and r["alcance"] == "AREA" and r["indice_proxy"] == "IE0007987708"
    assert set(r["beta"]) == {"3a", "5a"} and set(r["r2"]) == {"3a", "5a"}
    assert 1.0 < r["beta"]["3a"] < 1.6
    for ajena in ("jensen_alpha", "rentabilidad_activa", "tracking_error", "information_ratio"):
        assert ajena not in r


def test_una_historia_corta_no_publica_nada(tmp_path, monkeypatch):
    _config(tmp_path)
    accion, indice = _series(anos=2)
    monkeypatch.setattr(vl_fondos, "_serie_del_proxy", lambda *a, **k: indice)
    monkeypatch.setattr(eodhd, "_token", lambda *a, **k: "t")
    out = {}
    eodhd._aplica_referencia(out, accion, "EODHD:SAN.MC", None, tmp_path)
    assert out == {}


def test_sin_referencia_lo_dice_y_una_bolsa_sin_decidir_tambien(tmp_path):
    _config(tmp_path)
    accion, _ = _series()
    out = {}
    eodhd._aplica_referencia(out, accion, "EODHD:RY.TO", None, tmp_path)
    assert out["riesgo"]["relativas"] == {"aviso": "sin_referencia_de_mercado(TO)"}
    out = {}
    eodhd._aplica_referencia(out, accion, "EODHD:ALGO.XX", None, tmp_path)
    assert out["riesgo"]["relativas"] == {"aviso": "sin_relativas_bolsa_sin_referencia(XX)"}
