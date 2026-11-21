# -*- coding: utf-8 -*-
"""Decision 41 (08-11-2026): la cotizacion principal de una accion es la del mercado de origen del
ISIN en su divisa, y la ficha dice cuando no lo es. Los casos son los que la motivaron: Generali
(Milan no esta en EODHD), Compass (Londres solo en USD), NXP (NASDAQ, con euros solo en regionales)
y una normal. Sin red: la serie de cada linea es una lista hecha a mano."""
import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import csv  # noqa: E402
import pytest  # noqa: E402

from fetchers import eodhd, esma_firds  # noqa: E402

ULTIMO = dt.date(2026, 11, 6)
RAIZ = Path(__file__).resolve().parents[1]


def _linea(code, exch, cur, isin, tipo="Common Stock"):
    return {"Code": code, "Exchange": exch, "Currency": cur, "ISIN": isin, "Type": tipo}


def _serie(n, desde_anios=8, volumen=1000, repetidos=False):
    """`n` sesiones con cierre que cambia, mas una larga cola antigua para dar la historia."""
    puntos = [{"date": ULTIMO - dt.timedelta(days=3650 * desde_anios // 10 + i + 400),
               "price": 10.0, "raw": {"close": 10.0 + i * 0.01, "volume": volumen}} for i in range(5)]
    puntos.sort(key=lambda p: p["date"])
    for i in range(n):
        cierre = 20.0 if repetidos else 20.0 + i * 0.01
        puntos.append({"date": ULTIMO - dt.timedelta(days=n - 1 - i), "price": cierre,
                       "raw": {"close": cierre, "volume": volumen}})
    return puntos


def _series(monkeypatch, por_simbolo):
    monkeypatch.setattr(eodhd, "_serie_eod_ajustada", lambda s, *a, **k: por_simbolo[s])


def test_italia_sin_milan_va_a_la_linea_en_euros_con_mas_sesiones(monkeypatch):
    isin = "IT0000062072"
    items = [_linea("0K78", "LSE", "EUR", isin), _linea("ASG", "XETRA", "EUR", isin), _linea("ASG", "F", "EUR", isin)]
    _series(monkeypatch, {"0K78.LSE": _serie(240), "ASG.XETRA": _serie(250), "ASG.F": _serie(251)})
    elegida = eodhd._elige_principal(isin, items, None, "t", False)
    assert (elegida["Code"], elegida["Exchange"]) == ("ASG", "XETRA")  # F no le saca un 10 %: no la desplaza
    assert eodhd.aviso_de_cotizacion(isin, "XETRA", "EUR") == eodhd.AVISO_MERCADO_NO_DISPONIBLE


def test_linea_con_el_precio_parado_no_cuenta_y_gana_la_regional(monkeypatch):
    isin = "NL0015435975"  # Campari: 0ROY.LSE trae volumen con cierres repetidos
    items = [_linea("0ROY", "LSE", "EUR", isin), _linea("58H", "F", "EUR", isin)]
    _series(monkeypatch, {"0ROY.LSE": _serie(250, repetidos=True), "58H.F": _serie(135)})
    assert eodhd._elige_principal(isin, items, None, "t", False)["Exchange"] == "F"


def test_compass_se_queda_en_londres_en_usd_y_avisa_de_la_divisa(monkeypatch):
    isin = "GB00BD6K4575"
    items = [_linea("CPG", "LSE", "USD", isin), _linea("XGR2", "F", "EUR", isin), _linea("XGR2", "STU", "EUR", isin)]
    elegida = eodhd._elige_principal(isin, items, None, "t", False)
    assert (elegida["Code"], elegida["Exchange"]) == ("CPG", "LSE")
    assert eodhd.aviso_de_cotizacion(isin, "LSE", "USD") == eodhd.AVISO_DIVISA_NO_DISPONIBLE


def test_nxp_no_acaba_en_una_regional(monkeypatch):
    isin = "NL0009538784"
    items = [_linea("NXPI", "US", "USD", isin), _linea("VNX", "F", "EUR", isin), _linea("VNX", "STU", "EUR", isin)]
    elegida = eodhd._elige_principal(isin, items, None, "t", False, RAIZ)
    assert (elegida["Code"], elegida["Exchange"]) == ("NXPI", "US")
    assert eodhd._elige_principal(isin, items, None, "t", False) is None  # sin base, solo el prefijo: Ámsterdam


def test_una_normal_no_avisa(monkeypatch):
    isin = "ES0113900J37"
    items = [_linea("BNC", "F", "EUR", isin), _linea("SAN", "MC", "EUR", isin)]
    elegida = eodhd._elige_principal(isin, items, None, "t", False)
    assert (elegida["Code"], elegida["Exchange"]) == ("SAN", "MC")
    assert eodhd.aviso_de_cotizacion(isin, "MC", "EUR") is None
    assert eodhd.aviso_de_cotizacion("GB0005405286", "LSE", "GBX") is None
    assert eodhd.aviso_de_cotizacion("IE00B4BNMY34", "US", "USD") is None  # Irlanda no esta en la tabla


# --- De donde sale el mercado de origen (08-11-2026): tabla con fuente, FIRDS y, al final, el prefijo.

@pytest.mark.parametrize("isin,bolsa,divisa", [
    ("CH0044328745", "US", "USD"),   # Chubb
    ("NL0009538784", "US", "USD"),   # NXP
    ("NL0009805522", "US", "USD"),   # Nebius
    ("NL0010832176", "BR", "EUR"),   # argenx
    ("CH1216478797", "AS", "EUR"),   # DSM-Firmenich
    ("NL0000235190", "PA", "EUR"),   # Airbus
    ("NL0000226223", "PA", "EUR"),   # STMicroelectronics
    ("NL0015001FS8", "MC", "EUR"),   # Ferrovial
    ("DE0008404005", "XETRA", "EUR"),  # Allianz
])
def test_las_de_su_bolsa_no_avisan(isin, bolsa, divisa):
    assert eodhd.aviso_de_cotizacion(isin, bolsa, divisa, RAIZ) is None


def test_generali_y_compass_siguen_avisando():
    assert eodhd.aviso_de_cotizacion("IT0000062072", "XETRA", "EUR", RAIZ) == eodhd.AVISO_MERCADO_NO_DISPONIBLE
    assert eodhd.aviso_de_cotizacion("GB00BD6K4575", "LSE", "USD", RAIZ) == eodhd.AVISO_DIVISA_NO_DISPONIBLE


def test_cada_fila_de_la_tabla_es_valida_y_dice_de_donde_sale():
    with (RAIZ / eodhd.RUTA_MERCADO_DE_ORIGEN).open(encoding="utf-8-sig", newline="") as f:
        filas = list(csv.DictReader(f))
    with (RAIZ / "config" / "fondos.csv").open(encoding="utf-8-sig", newline="") as f:
        acciones = {r["isin"] for r in csv.DictReader(f) if r["tipo"] == "accion"}
    assert len({r["isin"] for r in filas}) == len(filas)
    for r in filas:
        assert r["isin"] in acciones, r["isin"]
        assert r["bolsa"] and len(r["divisa"]) == 3, r["isin"]
        assert r["fuente"].strip(), r["isin"]
        dt.date.fromisoformat(r["fecha"])


def _indice(tmp_path, filas):
    """Un indice FIRDS minimo: `filas` = {isin: (autoridad, [(mic, admision, baja), ...])}."""
    ruta = tmp_path / esma_firds.RUTA_INDICE
    ruta.parent.mkdir(parents=True)
    con = esma_firds.abre(ruta)
    con.execute("INSERT INTO meta VALUES ('completo', '2026-10-31')")
    for isin, (autoridad, mercados) in filas.items():
        con.execute("INSERT INTO instrumentos (isin, autoridad) VALUES (?, ?)", (isin, autoridad))
        for mic, admision, baja in mercados:
            con.execute("INSERT INTO mercados (isin, mic, admision, baja) VALUES (?, ?, ?, ?)",
                        (isin, mic, admision, baja))
    con.commit()
    con.close()
    return tmp_path


def test_firds_toma_la_bolsa_de_la_autoridad_y_no_la_admision_mas_antigua(tmp_path):
    base = _indice(tmp_path, {
        "NL0000235190": ("FR", [("XETA", "2000-07-02", None), ("XMAD", "2000-07-10", None), ("XPAR", "2000-09-25", None)]),
        "FR0000120271": ("FR", [("XBRU", "2000-09-25", None), ("XPAR", "2000-09-25", None)]),
        "LU2598331598": ("IT", [("MTAA", "2008-11-10", None), ("HMTF", "2025-01-24", "2099-12-31")]),
    })
    assert eodhd.mercado_de_origen("NL0000235190", base) == ("PA", "EUR")  # Airbus, sin tabla
    assert eodhd.mercado_de_origen("FR0000120271", base) == ("PA", "EUR")  # Total: empate con Bruselas
    assert eodhd.mercado_de_origen("LU2598331598", base) == ("MI", "EUR")  # Tenaris: el prefijo no sabia nada
    assert eodhd.aviso_de_cotizacion("LU2598331598", "LSE", "EUR", base) == eodhd.AVISO_MERCADO_NO_DISPONIBLE


def test_firds_no_decide_cuando_no_puede_ver_la_bolsa_de_origen(tmp_path):
    base = _indice(tmp_path, {
        "GB00BP6MXD84": ("NL", [("XAMS", "2021-12-21", None)]),         # Shell: Londres no reporta a ESMA
        "FI0009000681": ("FI", [("XSTO", "2007-06-04", None)]),          # Nokia: admision fuera de su pais
        "ES0000000001": ("ES", [("XMAD", "2010-01-01", "2020-01-01")]),  # admision dada de baja
    })
    assert eodhd.mercado_de_origen("GB00BP6MXD84", base)[0] == "LSE"
    assert eodhd.mercado_de_origen("FI0009000681", base) == ("HE", "EUR")
    assert esma_firds.mercado_de_origen(base, "ES0000000001", dt.date(2026, 11, 8)) is None


def test_sin_indice_firds_decide_el_prefijo(tmp_path):
    assert esma_firds.mercado_de_origen(tmp_path, "FR0000120271") is None
    assert eodhd.mercado_de_origen("FR0000120271", tmp_path) == ("PA", "EUR")
    assert not (tmp_path / esma_firds.RUTA_INDICE).exists()  # preguntar no crea un indice vacio
