# -*- coding: utf-8 -*-
"""Base del YTD (14-10-2026): ultimo cierre <= 31-dic del anio anterior.

Hasta ahora las dos rutas de ingesta tomaban como base el primer punto del anio:
el YTD perdia la primera sesion y, con historico mensual (`1mo`, fechado a
primero de mes con el cierre del mes), todo enero. Si no hay cierre del anio
anterior la base sigue siendo el primer punto del anio.
"""
import datetime as _dt
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import fund_ingest  # noqa: E402
import ingest_asset  # noqa: E402
import metrics_refresh  # noqa: E402

ISIN = "IE00B4L5Y983"  # sin politica de historico en fund_history_policies.json


def _diaria(inicio, fin, base=100.0, paso=0.03):
    puntos, dia, i = [], inicio, 0
    while dia <= fin:
        if dia.weekday() < 5:
            puntos.append({"date": dia, "value": round(base + i * paso + (0.4 if i % 2 else -0.4), 4)})
            i += 1
        dia += _dt.timedelta(days=1)
    return puntos


def _mensual(meses, base=100.0):
    """Serie `1mo`: un punto el dia 1 de cada mes con el cierre de ese mes."""
    return [{"date": dia, "value": round(base * (1.01 ** i) + (2 if i % 2 else 0), 4)}
            for i, dia in enumerate(meses)]


def _primeros_de_mes(desde, hasta):
    out, dia = [], desde
    while dia <= hasta:
        out.append(dia)
        dia = _dt.date(dia.year + (dia.month == 12), dia.month % 12 + 1, 1)
    return out


def _iso(puntos):
    return [{"date": p["date"].isoformat(), "value": p["value"]} for p in puntos]


def _esperado(puntos, base):
    return round(puntos[-1]["value"] / base["value"] - 1.0, 8)


# --- Serie diaria ----------------------------------------------------------------

def test_diaria_con_cierre_del_anio_anterior_mide_desde_el_31_dic():
    puntos = _diaria(_dt.date(2025, 6, 2), _dt.date(2026, 10, 13))
    cierre = [p for p in puntos if p["date"] <= _dt.date(2025, 12, 31)][-1]
    primero_del_anio = [p for p in puntos if p["date"].year == 2026][0]

    ytd = fund_ingest.ytd_return(puntos)

    assert cierre["date"] == _dt.date(2025, 12, 31)
    assert ytd == _esperado(puntos, cierre)
    # La primera sesion del anio cuenta: antes era la base y se perdia.
    assert ytd != _esperado(puntos, primero_del_anio)


def test_diaria_con_31_dic_en_fin_de_semana_usa_el_ultimo_cierre_habil():
    puntos = _diaria(_dt.date(2022, 6, 1), _dt.date(2023, 3, 15))  # 31-12-2022: sabado
    cierre = [p for p in puntos if p["date"] <= _dt.date(2022, 12, 31)][-1]

    assert cierre["date"] == _dt.date(2022, 12, 30)
    assert fund_ingest.ytd_return(puntos) == _esperado(puntos, cierre)


def test_diaria_que_empieza_este_anio_mide_desde_su_primer_punto():
    puntos = _diaria(_dt.date(2026, 3, 2), _dt.date(2026, 10, 13))

    assert fund_ingest.ytd_return(puntos) == _esperado(puntos, puntos[0])


def test_primera_sesion_del_anio_con_cierre_anterior_ya_tiene_ytd():
    puntos = [p for p in _diaria(_dt.date(2025, 12, 1), _dt.date(2026, 1, 2))
              if p["date"] != _dt.date(2026, 1, 1)]  # festivo

    assert [p["date"] for p in puntos[-2:]] == [_dt.date(2025, 12, 31), _dt.date(2026, 1, 2)]
    assert fund_ingest.ytd_return(puntos) == _esperado(puntos, puntos[-2])


def test_un_solo_punto_en_el_anio_sin_cierre_anterior_no_da_ytd():
    assert fund_ingest.ytd_return([{"date": "2026-01-02", "value": 10.0}]) is None
    assert fund_ingest.ytd_return([]) is None


def test_cierre_anterior_tras_un_hueco_largo_no_sirve_de_base():
    """Un cierre de junio de 2024 seguido de un hueco hasta 2026 mediria dos
    anios, no el anio en curso: se cae al primer punto del anio."""
    viejos = _diaria(_dt.date(2024, 5, 1), _dt.date(2024, 6, 28))
    nuevos = _diaria(_dt.date(2026, 2, 2), _dt.date(2026, 10, 13), base=150.0)

    assert fund_ingest.ytd_return(viejos + nuevos) == _esperado(nuevos, nuevos[0])


# --- Serie mensual (1mo) ---------------------------------------------------------

def test_mensual_1mo_con_cierre_del_anio_anterior_no_pierde_enero():
    puntos = _mensual(_primeros_de_mes(_dt.date(2024, 1, 1), _dt.date(2026, 10, 1)))
    diciembre = next(p for p in puntos if p["date"] == _dt.date(2025, 12, 1))
    enero = next(p for p in puntos if p["date"] == _dt.date(2026, 1, 1))

    ytd = fund_ingest.ytd_return(_iso(puntos))

    assert ytd == _esperado(puntos, diciembre)
    # Con la base en el punto de enero el YTD empezaba en el cierre de enero.
    assert ytd != _esperado(puntos, enero)


def test_mensual_1mo_que_empieza_este_anio_mide_desde_su_primer_punto():
    puntos = _mensual(_primeros_de_mes(_dt.date(2026, 1, 1), _dt.date(2026, 10, 1)))

    assert fund_ingest.ytd_return(_iso(puntos)) == _esperado(puntos, puntos[0])


# --- Una sola implementacion -----------------------------------------------------

def test_ingest_asset_usa_la_misma_funcion():
    assert ingest_asset._ytd_return is fund_ingest.ytd_return


@pytest.mark.parametrize("serie", ["diaria", "mensual"])
def test_las_tres_rutas_publican_el_mismo_ytd(monkeypatch, serie):
    if serie == "diaria":
        puntos = _diaria(_dt.date(2024, 1, 1), _dt.date(2026, 10, 13))
    else:
        puntos = _mensual(_primeros_de_mes(_dt.date(2020, 1, 1), _dt.date(2026, 10, 1)))
    base = [p for p in puntos if p["date"] <= _dt.date(2025, 12, 31)][-1]
    esperado = _esperado(puntos, base)
    ahora = "2026-10-14T08:30:00.000Z"

    acciones = ingest_asset.build_metrics_latest(ISIN, "STOCK", _iso(puntos), ahora)
    fondos = fund_ingest._metrics_doc(ISIN, _iso(puntos), {}, ahora)
    monkeypatch.setattr(metrics_refresh, "_risk_free_resolver",
                        lambda: (lambda _s, _e: {"rate": 0.02}))
    refresco, motivo = metrics_refresh._recomputed_metrics(
        ISIN, {"population": "fund", "source": "FONDOSDB_EODHD_DAILY_HISTORY"},
        [p["value"] for p in puntos], [p["date"] for p in puntos], ahora)

    assert motivo is None
    assert acciones["ytd_return"] == fondos["ytd_return"] == refresco["ytd_return"] == esperado
