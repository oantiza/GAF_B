"""El identificador conocido: sin buscador, Morningstar no se cae entero (16-11-2026).

Ese día el buscador de Morningstar empezó a contestar 401 a todas las consultas. Es quien traduce el ISIN al
identificador (SecId) con el que se piden la ficha y la cartera, que seguían respondiendo; sin él, la pasada se quedaba
sin nada de Morningstar en los 802 fondos y ETF de los que ya se sabía el identificador.

Aquí no hay red: un cliente HTTP de mentira contesta lo que cada caso necesita, y la «copia» de cada ISIN es una carpeta
temporal con el `screener.json` que dejó la última pasada buena.
"""
import json
import os
import time
from pathlib import Path

import pytest

from core.http import Respuesta
from fetchers import morningstar_lt as ms

ISIN = "BE0943877671"
VACIA = '{"total": 0, "rows": []}'
DIA = 86400
# Una fila como las que guarda el buscador: identificadores, lo que no cambia y lo que sí.
FILA = {
    "SecId": "F0GBR04E7Y", "FundId": "FSGBR05B1N", "Universe": "FOESP$$ALL", "ISIN": ISIN,
    "Name": "DPAM B Bonds Eur Govt B EUR Cap", "LegalName": "DPAM B - Bonds Eur Government B Cap", "Currency": "EUR",
    "CategoryName": "RF Deuda Pública EUR", "InceptionDate": "1996-10-04T00:00:00",
    "MaxFrontEndLoad": 2.0, "MaxDeferredLoad": 0.0, "LargestSector": "", "AverageCreditQualityCode": "A",
    # Lo que de una fila vieja sería una cifra vieja:
    "ClosePrice": 101.23, "ClosePriceDate": "2026-11-10T00:00:00", "OngoingCharge": 0.52, "StarRatingM255": 3,
    "ReturnM12": -3.28, "ReturnM36": 2.14, "StandardDeviationM36": 5.25, "SharpeM36": -0.09, "Yield_M12": 0.0,
}
ESTABLES = {"SecId", "FundId", "Universe", "Name", "LegalName", "Currency", "CategoryName", "InceptionDate",
            "MaxFrontEndLoad", "MaxDeferredLoad", "AverageCreditQualityCode"}


class Http:
    """Contesta lo que diga `responde(url, params)` y apunta cada dirección que se le pide."""

    def __init__(self, tmp_path: Path, responde):
        self.cache_dir = tmp_path / "http"
        self.responde = responde
        self.pedidas: list[str] = []

    def get(self, url, params=None, headers=None, force=False, familia=None, ttl_dias=None, **_resto):
        self.pedidas.append(url)
        respuesta = self.responde(url, params or {})
        if isinstance(respuesta, Exception):
            raise respuesta
        return respuesta


def sin_autorizacion(url, params):
    """Lo que pasó el 16-11-2026: el buscador da 401 y la ficha por identificador no trae nada que mapear."""
    return Respuesta(401, "", False) if url == ms.SCREENER else Respuesta(404, "", False)


def copia(tmp_path: Path, isin: str = ISIN, fila: dict | None = FILA, hace_dias: float = 6) -> Path:
    """La carpeta de copias de un ISIN, con la fila que el buscador dejó hace `hace_dias`."""
    base = tmp_path / "raw" / isin
    base.mkdir(parents=True)
    if fila is not None:
        ruta = base / "screener.json"
        ruta.write_text(json.dumps(fila), encoding="utf-8")
        cuando = time.time() - hace_dias * DIA
        os.utime(ruta, (cuando, cuando))
    return base


def test_sin_buscador_se_usa_el_identificador_conocido_y_solo_lo_que_no_cambia(tmp_path):
    http = Http(tmp_path, sin_autorizacion)
    base = copia(tmp_path, hace_dias=6)
    fila, guardada = ms._screener(ISIN, http, {}, force=False, raw_base=base)
    assert fila["SecId"] == "F0GBR04E7Y"
    # `LargestSector` venía vacío y no entra. Ni el precio, ni las rentabilidades, ni el riesgo, ni el coste, ni las estrellas.
    assert set(fila) == ESTABLES
    # La fecha que acompaña es la de cuando se guardó la fila, no la de hoy: hace 6 días.
    assert guardada == pytest.approx(time.time() - 6 * DIA, abs=5)
    # Y no se recuerda como «no encontrado»: no ha contestado nadie.
    assert not ms._negativo_screener_vigente(ISIN, http)
    # Tampoco se toca la copia: su fecha sigue siendo la de la última vez que el buscador contestó.
    assert (base / "screener.json").stat().st_mtime == pytest.approx(guardada, abs=1)


@pytest.mark.parametrize("hace_dias, con_lo_estable", [
    (179, True),   # dentro del plazo de 180 días
    (181, False),  # fuera: solo queda el identificador, que no caduca
])
def test_lo_que_no_cambia_vale_180_dias_y_el_identificador_siempre(tmp_path, hace_dias, con_lo_estable):
    assert ms.MAX_DIAS_FILA_GUARDADA == 180
    http = Http(tmp_path, sin_autorizacion)
    fila, _guardada = ms._screener(ISIN, http, {}, force=False, raw_base=copia(tmp_path, hace_dias=hace_dias))
    assert set(fila) == (ESTABLES if con_lo_estable else {"SecId", "FundId", "Universe"})


@pytest.mark.parametrize("fila", [
    None,                                    # nunca se guardó
    {**FILA, "ISIN": "LU0000000001"},        # la copia es de otro ISIN
    {k: v for k, v in FILA.items() if k != "SecId"},  # sin identificador no sirve
])
def test_sin_fila_que_valga_no_hay_nada_y_tampoco_un_negativo(tmp_path, fila):
    http = Http(tmp_path, sin_autorizacion)
    assert ms._screener(ISIN, http, {}, force=False, raw_base=copia(tmp_path, fila=fila)) == (None, None)
    assert not ms._negativo_screener_vigente(ISIN, http)


def test_si_el_buscador_contesta_que_no_existe_la_fila_guardada_no_se_usa(tmp_path):
    """Una respuesta válida y vacía en todos los universos es una baja: lo conocido no la tapa."""
    http = Http(tmp_path, lambda url, params: Respuesta(200, VACIA, False, 1.0))
    assert ms._screener(ISIN, http, {}, force=False, raw_base=copia(tmp_path)) == (None, None)
    assert ms._negativo_screener_vigente(ISIN, http)


def test_la_ficha_se_pide_con_el_identificador_conocido_y_no_hereda_cifras_viejas(tmp_path):
    http = Http(tmp_path, sin_autorizacion)
    copia(tmp_path, hace_dias=6)
    out = ms.fetch(ISIN, http, {}, raw_dir=tmp_path / "raw")
    # Se ha pedido la ficha de ese identificador, que es lo que antes no llegaba a pasar.
    assert ms.LT.format(sec_id="F0GBR04E7Y") in http.pedidas
    assert out["meta"]["sec_id_morningstar"] == "F0GBR04E7Y"
    # De la fila guardada entra lo que no cambia...
    assert out["identificacion"]["nombre"] == "DPAM B - Bonds Eur Government B Cap"
    assert out["identificacion"]["categoria_morningstar"] == "RF Deuda Pública EUR"
    assert out["identificacion"]["fecha_lanzamiento_clase"] == "1996-10-04"
    assert out["costes"] == {"comision_suscripcion_max_pct": 2.0, "comision_reembolso_max_pct": 0.0}
    # ...y nada de lo que sí: ni precio, ni rentabilidades, ni riesgo, ni estrellas, ni coste corriente.
    for bloque in ("valoracion", "rentabilidad", "riesgo", "rating", "distribuciones"):
        assert bloque not in out, bloque


def test_tras_cinco_isin_seguidos_sin_respuesta_no_se_le_pregunta_mas_en_esa_pasada(tmp_path):
    assert ms.ISIN_SEGUIDOS_SIN_BUSCADOR == 5
    http = Http(tmp_path, sin_autorizacion)
    por_isin = len(ms.UNIVERSOS) * 2  # cuatro universos por dos juegos de campos
    for n in range(5):
        isin = f"LU000000000{n}"
        assert ms._screener(isin, http, {}, force=False, raw_base=None) == (None, None)
    assert len(http.pedidas) == 5 * por_isin
    # El sexto ya no gasta consultas, y si tiene identificador conocido lo usa igual.
    fila, _guardada = ms._screener(ISIN, http, {}, force=False, raw_base=copia(tmp_path))
    assert len(http.pedidas) == 5 * por_isin
    assert fila["SecId"] == "F0GBR04E7Y"
    # La cuenta es de esa pasada: con otro cliente, se vuelve a preguntar.
    otra = Http(tmp_path, sin_autorizacion)
    ms._screener("LU0000000009", otra, {}, force=False, raw_base=None)
    assert len(otra.pedidas) == por_isin


def test_un_universo_caido_o_una_respuesta_valida_no_cuentan_como_buscador_caido(tmp_path):
    caido = ms.UNIVERSOS[2]

    def responde(url, params):
        return Respuesta(503, "", False) if params.get("universeIds") == caido else Respuesta(200, VACIA, False, 1.0)

    http = Http(tmp_path, responde)
    for n in range(8):
        ms._screener(f"LU000000001{n}", http, {}, force=False, raw_base=None)
    # Ocho ISIN con un universo caído cada uno: se sigue preguntando por todos.
    assert len(http.pedidas) == 8 * len(ms.UNIVERSOS) * 2
