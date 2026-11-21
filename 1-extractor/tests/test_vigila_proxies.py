# -*- coding: utf-8 -*-
"""La regla de la decisión 33 escrita donde gobierna, y la medición anual que la aplica.

Un proxy que se degrade (cambio de índice, muestreo peor, cierre) seguiría midiendo alfas sin
que nadie lo note. La vigilancia anual mide el instrumento contra su propio índice y marca
PASA o FALLA con los umbrales de la decisión; aquí se comprueba que mide lo que dice medir.
"""
import importlib.util
import math
import random
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from core import indices  # noqa: E402

_spec = importlib.util.spec_from_file_location("vigila_proxies", RAIZ / "reports" / "vigila_proxies.py")
vigila = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(vigila)


# ------------------------------------------------------- la regla, escrita
def test_la_regla_33_esta_en_el_codigo_y_junto_a_la_tabla():
    assert "decisión\n33" in indices.__doc__ or "decisión 33" in indices.__doc__
    assert "DECISIONES_DATOS_2026-11-07.md" in indices.__doc__
    assert "indices.README.md" in indices.__doc__
    readme = RAIZ / "config" / "indices.README.md"
    assert readme.exists()
    texto = readme.read_text(encoding="utf-8")
    assert "decisión 33" in texto and "DECISIONES_DATOS_2026-11-07.md" in texto
    for criterio in ("Acumulación", "Sin cubrir", "Variante correcta", "Réplica física", "Tamaño"):
        assert criterio in texto, criterio
    assert "vigila_proxies.py" in texto


# ------------------------------------------------- la tabla de correspondencia
def test_toda_fila_con_instrumento_tiene_su_linea_en_la_tabla_real():
    filas = vigila.filas_vigiladas(RAIZ)
    assert len(filas) >= 19
    tabla = vigila.carga_tabla()
    pares = vigila.empareja(filas, tabla)
    con_serie = {(f["benchmark"], f["variante"]): e["indice"] for f, e in pares if e["indice"]}
    # Las tres de hoy, con el código que dice el informe; las demás, «sin serie».
    assert con_serie == {("EURO STOXX 50", "NR"): "SX5T",
                         ("S&P 500", "NR"): "SPXNTR",
                         ("STOXX Europe 600", "NR"): "SXXR"}
    # Las tasas y los niveles de índice no se vigilan: no hay instrumento que comparar.
    assert all(f["clase_de_serie"] in vigila.CLASES_VIGILADAS for f in filas)


def test_una_fila_nueva_sin_linea_en_la_tabla_es_un_error(tmp_path):
    (tmp_path / "config").mkdir()
    (tmp_path / "config" / "indices.csv").write_text(
        "benchmark,variante,proxy,clase_de_serie,base,fondos,nota,equivalente_de\r\n"
        "MSCI Nordic,NR,IE0000000001,PRECIO_DE_MERCADO,TOTAL_RETURN,1,prueba,\r\n", encoding="utf-8")
    tabla = tmp_path / "config" / "indices_vigilancia.csv"
    tabla.write_text("benchmark,variante,indice,nota\r\n", encoding="utf-8")
    with pytest.raises(ValueError, match="MSCI Nordic"):
        vigila.empareja(vigila.filas_vigiladas(tmp_path), vigila.carga_tabla(tabla))
    tabla.write_text("benchmark,variante,indice,nota\r\nMSCI Nordic,NR,,no esta\r\n", encoding="utf-8")
    pares = vigila.empareja(vigila.filas_vigiladas(tmp_path), vigila.carga_tabla(tabla))
    assert pares[0][1]["indice"] is None
    indices._CACHE.clear()


def test_la_tabla_rechaza_sufijo_duplicados_y_codigos_raros(tmp_path):
    t = tmp_path / "v.csv"
    t.write_text("benchmark,variante,indice,nota\r\nS&P 500,NR,SPXNTR.INDX,x\r\n", encoding="utf-8")
    with pytest.raises(ValueError, match="sin sufijo"):
        vigila.carga_tabla(t)
    t.write_text("benchmark,variante,indice,nota\r\nS&P 500,NR,SPX NTR,x\r\n", encoding="utf-8")
    with pytest.raises(ValueError, match="no valido"):
        vigila.carga_tabla(t)
    t.write_text("benchmark,variante,indice,nota\r\nS&P 500,NR,SPXNTR,x\r\nS&P 500 NR USD,NR,SPXNTR,x\r\n",
                 encoding="utf-8")
    with pytest.raises(ValueError, match="dos veces"):
        vigila.carga_tabla(t)
    t.write_text("benchmark,variante,nota\r\nS&P 500,NR,x\r\n", encoding="utf-8")
    with pytest.raises(ValueError, match="faltan"):
        vigila.carga_tabla(t)


# ----------------------------------------------------------- la medición
# La serie llega al 6 de noviembre, como la real el día de la primera ejecución: noviembre está a
# medias y no cuenta; el último mes cerrado es octubre.
FIN = date(2026, 11, 6)


def _indice(anos=6, semilla=3):
    aleatorio = random.Random(semilla)
    d = FIN - timedelta(days=int(365.25 * anos))
    serie, nivel = [], 1000.0
    while d <= FIN:
        if d.weekday() < 5:
            nivel *= 1 + aleatorio.gauss(0.0003, 0.01)
            serie.append((d, nivel))
        d += timedelta(days=1)
    return serie


def test_un_proxy_igual_al_indice_da_r2_uno_y_deriva_cero():
    indice = _indice()
    r = vigila.mide(list(indice), indice)
    assert r["estado"] == "PASA"
    assert r["ultimo_mes"] == "2026-10-31"  # noviembre está a medias; octubre, cerrado
    for clave, _n in vigila.VENTANAS:
        v = r["ventanas"][clave]
        assert v["disponible"] and v["pasa"]
        assert v["r2"] == pytest.approx(1.0, abs=1e-6)
        assert v["deriva_pt"] == pytest.approx(0.0, abs=1e-6)
        assert v["tracking_error_pct"] == pytest.approx(0.0, abs=1e-6)
    assert r["ventanas"]["5a"]["meses"] == 60 and r["meses_comunes"] >= 60


def test_un_proxy_que_gana_0_3_puntos_al_anio_da_deriva_0_3_y_pasa():
    indice = _indice()
    origen = indice[0][0]
    proxy = [(f, p * math.exp(0.003 * (f - origen).days / 365.25)) for f, p in indice]
    r = vigila.mide(proxy, indice)
    assert r["estado"] == "PASA"
    for clave, _n in vigila.VENTANAS:
        v = r["ventanas"][clave]
        # El año de la ventana no mide exactamente 365,25 días: tolerancia de una centésima.
        assert v["deriva_pt"] == pytest.approx(0.3, abs=0.01), clave
        assert v["r2"] == pytest.approx(1.0, abs=1e-4), clave
        assert v["pasa"]


def test_un_proxy_que_pierde_mas_de_medio_punto_falla_aunque_el_r2_sea_uno():
    indice = _indice()
    origen = indice[0][0]
    proxy = [(f, p * math.exp(-0.008 * (f - origen).days / 365.25)) for f, p in indice]
    r = vigila.mide(proxy, indice)
    assert r["estado"] == "FALLA"
    assert all(not v["pasa"] and v["r2"] > 0.999 for v in r["ventanas"].values())
    assert r["ventanas"]["1a"]["deriva_pt"] == pytest.approx(-0.8, abs=0.01)


def test_un_proxy_con_ruido_baja_el_r2_y_falla():
    indice = _indice()
    aleatorio = random.Random(11)
    proxy, nivel = [], 1000.0
    anterior = indice[0][1]
    for f, p in indice:
        nivel *= (p / anterior) * (1 + aleatorio.gauss(0, 0.006))
        anterior = p
        proxy.append((f, nivel))
    r = vigila.mide(proxy, indice)
    assert r["estado"] == "FALLA"
    assert any(v["r2"] < vigila.R2_MINIMO for v in r["ventanas"].values())


def test_una_ventana_sin_sus_meses_se_dice_y_no_cuenta():
    indice = _indice(anos=2)  # 23 meses cerrados: hay 1a, no 3a ni 5a
    r = vigila.mide(list(indice), indice)
    assert r["estado"] == "PASA"
    assert r["ventanas"]["1a"]["disponible"]
    for clave in ("3a", "5a"):
        v = r["ventanas"][clave]
        assert not v["disponible"] and "hacen falta" in v["motivo"]
    corta = _indice(anos=0.5)
    r = vigila.mide(list(corta), corta)
    assert r["estado"] == "SIN_DATOS"
    assert not any(v["disponible"] for v in r["ventanas"].values())


def test_un_mes_que_falta_en_el_indice_rompe_la_ventana_que_lo_cruza():
    indice = _indice()
    # Sin el mes de hace 20 meses en el índice: la ventana de 3 años ya no es consecutiva.
    ano_mes = ((FIN.year * 12 + FIN.month - 1) - 20)
    y, m = divmod(ano_mes, 12)
    agujereado = [(f, p) for f, p in indice if (f.year, f.month) != (y, m + 1)]
    r = vigila.mide(list(indice), agujereado)
    assert r["ventanas"]["1a"]["disponible"]
    assert not r["ventanas"]["3a"]["disponible"] and "consecutivos" in r["ventanas"]["3a"]["motivo"]
    assert not r["ventanas"]["5a"]["disponible"]


def test_el_fin_a_ultimo_dia_de_mes_cuenta_ese_mes():
    indice = _indice()
    r = vigila.mide(list(indice), indice, fin=date(2026, 9, 30))
    assert r["ultimo_mes"] == "2026-09-30"
    r = vigila.mide(list(indice), indice, fin=date(2026, 9, 15))
    assert r["ultimo_mes"] == "2026-08-31"
