# -*- coding: utf-8 -*-
"""Auditoria del 20-11-2026: P1-12 (lecturas de la base nueva), P2-07 puntos 4 y 5, P3-04 y P3-05.

Cada cifra esperada sale de una cuenta a mano, escrita en el comentario de su prueba.
"""
import os
import sys
import threading
import time
from datetime import date, timedelta

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import generador_de_carteras as G  # noqa: E402
from readmodel import lector_base_nueva as lector  # noqa: E402
from readmodel import repository as repo  # noqa: E402
from tests.test_busqueda_de_activos import ACTIVOS, Lector  # noqa: E402


# ───────────────────────────────────────────── una base falsa que cuenta lo que se le pide ─────────────────────────────────────────────

class _Snap:
    def __init__(self, ruta, datos):
        self.id = ruta.split("/")[-1]
        self.exists = datos is not None
        self._datos = datos
        partes = ruta.split("/")
        padre = type("P", (), {"id": partes[1]}) if len(partes) > 2 else None
        self.reference = type("R", (), {"parent": type("C", (), {"parent": padre})})

    def to_dict(self):
        return self._datos


class _Ref:
    def __init__(self, db, ruta):
        self.db, self.ruta = db, ruta

    def collection(self, nombre):
        return _Col(self.db, f"{self.ruta}/{nombre}")


class _Col:
    def __init__(self, db, ruta):
        self.db, self.ruta = db, ruta

    def document(self, ident):
        return _Ref(self.db, f"{self.ruta}/{ident}")

    def stream(self, **_opciones):
        return self.db.stream(self.ruta)


class _Db:
    """`lecturas[ruta]` cuenta cuantas veces se ha pedido cada documento (por `get_all`) o coleccion (por `stream`)."""

    def __init__(self, datos, al_leer_coleccion=None):
        self.datos = datos
        self.lecturas = {}
        self.llamadas_get_all = 0
        self._cerrojo = threading.Lock()
        self.al_leer_coleccion = al_leer_coleccion

    def collection(self, nombre):
        return _Col(self, nombre)

    def get_all(self, referencias, **_opciones):
        with self._cerrojo:
            self.llamadas_get_all += 1
            for r in referencias:
                self.lecturas[r.ruta] = self.lecturas.get(r.ruta, 0) + 1
        return [_Snap(r.ruta, self.datos.get(r.ruta)) for r in referencias]

    def stream(self, ruta):
        with self._cerrojo:
            self.lecturas[ruta] = self.lecturas.get(ruta, 0) + 1
        if self.al_leer_coleccion:
            self.al_leer_coleccion(ruta)
        prefijo = ruta + "/"
        return [_Snap(r, d) for r, d in sorted(self.datos.items()) if r.startswith(prefijo) and "/" not in r[len(prefijo):]]


def _fondo_en_db(datos, isin, trozos=1):
    i = f"instruments/{isin}"
    datos[i] = {"instrument_type": "FUND", "identity": {"name": f"Fondo {isin}", "currency": "EUR"}}
    datos[f"{i}/read/card"] = {"instrument_type": "FUND", "metrics": {"method": "EXTRACTOR_MONTHLY_V4"},
                               "holdings_summary": {"positions_count": 3, "top10_weight": 0.5, "as_of": "2026-09-30"}}
    datos[f"{i}/declared/exposure"] = {"asset_mix": {"equity": 1.0}}
    datos[f"{i}/declared/holdings"] = {"positions_count": 2, "top10_weight": 0.5, "as_of": "2026-09-30"}
    for k in range(trozos):
        datos[f"{i}/holdings_chunks/{k:03d}"] = {"positions": [{"name": f"Bono {k}", "weight": 0.1}]}


ISINS = ["ES0000000001", "ES0000000002", "ES0000000003"]


def _db_de_tres(**kw):
    datos = {}
    for isin in ISINS:
        _fondo_en_db(datos, isin)
    return _Db(datos, **kw)


# ──────────────────────────────────────────────────────── P1-12 (1): read/card una vez ────────────────────────────────────────────────────────

def test_resolve_portfolio_lee_cada_tarjeta_una_vez():
    """3 fondos. Antes: raiz + tarjeta + exposicion (get_assets_many), tarjeta (metricas) y tarjeta (resumen de posiciones) = 5
    documentos por fondo = 15. Ahora la tarjeta se lee una vez: 3 por fondo = 9."""
    db = _db_de_tres()
    l = lector.LectorBaseNueva(db)
    resuelta = repo.resolve_portfolio(l, [{"asset_id": isin, "weight": 1 / 3} for isin in ISINS])
    assert len(resuelta["rows"]) == 3
    for isin in ISINS:
        assert db.lecturas[f"instruments/{isin}/read/card"] == 1
        assert db.lecturas[f"instruments/{isin}"] == 1
    assert sum(db.lecturas.values()) == 9
    assert l.documentos_leidos == 9


def test_lo_que_no_existe_tampoco_se_vuelve_a_preguntar():
    db = _db_de_tres()
    l = lector.LectorBaseNueva(db)
    assert l.get_metrics_latest_many(["ES0000000009"]) == {}
    assert l.get_holdings_summaries_many(["ES0000000009"]) == {}
    assert db.lecturas["instruments/ES0000000009/read/card"] == 1


# ───────────────────────────────────────────────────── P1-12 (2): posiciones en paralelo ─────────────────────────────────────────────────────

def test_las_posiciones_se_leen_en_paralelo_y_la_cabecera_en_una_sola_llamada():
    """4 fondos: las 4 lecturas de trozos tienen que estar en vuelo a la vez (una barrera de 4 que, en serie, no se abre) y las
    4 cabeceras viajan en un solo `get_all`."""
    barrera = threading.Barrier(4, timeout=5)

    def esperar(ruta):
        if ruta.endswith("/holdings_chunks"):
            barrera.wait()

    datos = {}
    for k in range(4):
        _fondo_en_db(datos, f"ES000000010{k}", trozos=2)
    db = _Db(datos, al_leer_coleccion=esperar)
    salida = lector.LectorBaseNueva(db).get_holdings_many([f"ES000000010{k}" for k in range(4)] + ["ES0000000199"])
    assert sorted(salida) == [f"ES000000010{k}" for k in range(4)]
    assert db.llamadas_get_all == 1
    # Dos trozos de un bono cada uno, a un 10 % (0,1 en la base, 10,0 en el contrato).
    assert [h["holding_weight"] for h in salida["ES0000000100"]["data"]["holdings"]] == [10.0, 10.0]


def test_si_falla_un_activo_el_reintento_no_relee_los_que_ya_estaban():
    """3 fondos y el tercero falla la primera vez. `get_asset_holdings_many` cae a lecturas sueltas: los dos buenos salen de la
    memoria (sus trozos se leyeron 1 vez, no 2) y el tercero se vuelve a pedir (2 veces) y sale."""
    datos = {}
    for isin in ISINS:
        _fondo_en_db(datos, isin)
    fallos = {"pendientes": 1}

    def fallar_una_vez(ruta):
        if ruta == f"instruments/{ISINS[2]}/holdings_chunks" and fallos["pendientes"]:
            fallos["pendientes"] -= 1
            raise RuntimeError("la base no contesta")

    db = _Db(datos, al_leer_coleccion=fallar_una_vez)
    avisos = []
    salida = repo.get_asset_holdings_many(lector.LectorBaseNueva(db), ISINS, avisos)
    assert all(salida[isin] is not None for isin in ISINS)
    assert db.lecturas[f"instruments/{ISINS[0]}/holdings_chunks"] == 1
    assert db.lecturas[f"instruments/{ISINS[1]}/holdings_chunks"] == 1
    assert db.lecturas[f"instruments/{ISINS[2]}/holdings_chunks"] == 2
    assert avisos == []


# ─────────────────────────────────────────── P1-12 (4): recarga de cambios y €STR, de una en una ───────────────────────────────────────────

@pytest.fixture(autouse=True)
def _caches_limpias():
    lector._CAMBIOS.clear()
    lector._ESTR_GUARDADA.clear()
    G._GUARDADO.clear()
    yield
    lector._CAMBIOS.clear()
    lector._ESTR_GUARDADA.clear()
    G._GUARDADO.clear()


class _DbDeCambios:
    def __init__(self, puntos, espera=0.0):
        self.puntos, self.espera = puntos, espera
        self.consultas = 0
        self._cerrojo = threading.Lock()

    def collection(self, _nombre):
        return self

    def where(self, *_):
        return self

    def stream(self, **_opciones):
        with self._cerrojo:
            self.consultas += 1
        time.sleep(self.espera)
        puntos = self.puntos

        class S:
            def to_dict(self):
                return {"points": [{"date": f, "value": v} for f, v in puntos]}
        return [S()] if puntos else []


def test_seis_hilos_que_piden_la_misma_moneda_la_leen_una_vez():
    db = _DbDeCambios([("2026-01-02", 1.25)], espera=0.2)
    resultados = []
    hilos = [threading.Thread(target=lambda: resultados.append(lector.LectorOptimizacionBaseNueva(db)._cambios_de("USD")))
             for _ in range(6)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join()
    assert db.consultas == 1
    assert resultados == [[("2026-01-02", 1.25)]] * 6


def test_seis_hilos_que_piden_el_estr_lo_leen_una_vez():
    db = _DbDeCambios([("2026-01-02", 0.0193)], espera=0.2)
    hilos = [threading.Thread(target=lambda: lector._estr_guardada(db)) for _ in range(6)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join()
    assert db.consultas == 1


def test_un_cambio_vacio_no_se_guarda_para_los_demas_pero_el_lector_no_lo_repite():
    db = _DbDeCambios([])
    primero = lector.LectorOptimizacionBaseNueva(db)
    assert primero._cambios_de("USD") == [] and primero._cambios_de("USD") == []
    assert db.consultas == 1            # dentro del lector, una vez
    assert "USD" not in lector._CAMBIOS  # y nada en la cache compartida
    assert lector.LectorOptimizacionBaseNueva(db)._cambios_de("USD") == []
    assert db.consultas == 2            # otro lector (otra peticion) vuelve a mirar


def test_un_estr_vacio_no_se_guarda_quince_minutos():
    db = _DbDeCambios([])
    assert lector._estr_guardada(db) == []
    assert lector._estr_guardada(db) == []
    assert db.consultas == 2
    assert lector._ESTR_GUARDADA == {}
    memoria = {}
    assert lector._estr_guardada(db, memoria) == [] and lector._estr_guardada(db, memoria) == []
    assert db.consultas == 3            # con la memoria de quien llama, una sola


# ───────────────────────────────────────────────────────────── P3-04 ─────────────────────────────────────────────────────────────

def test_un_cambio_a_cero_no_rompe_la_conversion_y_se_aparta():
    """Cambios: 2026-01-02 a 1,25 y 2026-01-05 a 0. El punto del 06-01 usaria el 0 (el ultimo en o antes de su fecha): ahora ese
    cambio no existe y usa el del 02-01 (4 dias, dentro de los 7): 100 / 1,25 = 80. Sin ningun cambio bueno, se descarta."""
    documento = {"currency": "USD", "points": [{"date": "2026-01-06", "value": 100.0}]}
    convertido = lector.a_euros(documento, [("2026-01-02", 1.25), ("2026-01-05", 0)])
    assert convertido["points"][0]["value"] == pytest.approx(80.0)
    assert convertido["points"][0]["fx_rate"] == 1.25
    assert lector.a_euros(documento, [("2026-01-05", 0), ("2026-01-04", -1.0), ("2026-01-03", None)]) is None


# ───────────────────────────────────────────────────────────── P3-05 ─────────────────────────────────────────────────────────────

def test_los_espacios_de_los_bordes_no_son_un_alias_sustituido():
    db = _db_de_tres()
    resuelta = repo.resolve_portfolio(lector.LectorBaseNueva(db), [{"asset_id": " ES0000000001 ", "weight": 1}])
    assert [w for w in resuelta["warnings"] if w["code"] == "ALIAS_RESOLVED"] == []
    assert resuelta["rows"][0]["asset_id"] == "ES0000000001"


# ───────────────────────────────────────────────────── P2-07 punto 4: la respuesta exacta ─────────────────────────────────────────────────────

def test_la_respuesta_exacta_va_la_primera_aunque_la_pagina_sea_de_uno():
    """Sanofi (ticker SAN, FR…) es la unica exacta de «SAN» entre estos tres; por id iria despues de Grupo San Jose (ES…). Con
    limit=1, antes salia Grupo San Jose. Ahora: Sanofi, y el cursor deja la siguiente pagina en el primer id del resto."""
    tres = [a for a in ACTIVOS if a["isin"] in ("FR0000120578", "ES0180918015", "IE00B4M6YD48")]
    vistos, cursor = [], None
    for _ in range(4):
        pagina = repo.search_assets_page(Lector(activos=tres), "SAN", None, 1, cursor=cursor)
        vistos += [r["asset_id"] for r in pagina["results"]]
        cursor = pagina["next_cursor"]
        if not cursor:
            break
    assert vistos == ["FR0000120578", "ES0180918015", "IE00B4M6YD48"]


def test_dos_exactas_en_una_pagina_de_dos_van_delante():
    """«SAN»: exactas Santander (ES0113…) y Sanofi (FR…); resto por id: Grupo San Jose (ES0180…) y Artisan (IE…)."""
    pagina = repo.search_assets_page(Lector(), "SAN", None, 2)
    assert [r["asset_id"] for r in pagina["results"]] == ["ES0113900J37", "FR0000120578"]
    segunda = repo.search_assets_page(Lector(), "SAN", None, 2, cursor=pagina["next_cursor"])
    assert [r["asset_id"] for r in segunda["results"]] == ["ES0180918015", "IE00B4M6YD48"]
    assert segunda["next_cursor"] is None


# ──────────────────────────────────────────────────── P2-07 punto 5: el generador de carteras ────────────────────────────────────────────────────

def test_el_residuo_del_redondeo_no_lleva_a_nadie_por_encima_del_tope():
    """[25, 25, 25, 24,99] suma 99,99: faltan 0,01. A la mayor (25) iria a 25,01; cabe en la ultima: 24,99 + 0,01 = 25."""
    posiciones = [{"peso_pct": p} for p in (25.0, 25.0, 25.0, 24.99)]
    G._cuadrar_a_cien(posiciones)
    assert [p["peso_pct"] for p in posiciones] == [25.0, 25.0, 25.0, 25.0]


def test_el_residuo_negativo_resta_a_la_mayor_que_aguanta():
    """4 x 20,01 + 19,98 = 100,02: sobran 0,02; a la mayor (20,01, la primera) 20,01 - 0,02 = 19,99, que sigue por encima de 5."""
    posiciones = [{"peso_pct": p} for p in (20.01, 20.01, 20.01, 20.01, 19.98)]
    G._cuadrar_a_cien(posiciones)
    assert [p["peso_pct"] for p in posiciones] == [19.99, 20.01, 20.01, 20.01, 19.98]
    assert round(sum(p["peso_pct"] for p in posiciones), 2) == 100.0


def test_si_a_nadie_le_cabe_el_residuo_no_hay_borrador():
    """3 x 25 = 75: faltan 25, y sumarlos a cualquiera da 50."""
    with pytest.raises(G.GeneradorNoDisponible):
        G._cuadrar_a_cien([{"peso_pct": 25.0}] * 3)


@pytest.mark.parametrize("datos", [{"nivel": True}, {"nivel": 4, "num_fondos": True}])
def test_un_booleano_no_es_un_nivel_ni_un_numero_de_fondos(datos):
    with pytest.raises(G.GeneradorNoDisponible):
        G.generar_borrador(object(), object(), datos)


# Series de prueba: 12 años de cierres diarios inventados (el dia 1 y el 15 de cada mes) para comprobar lo que lee el borrador.
def _valores(desde_anio, hasta=date(2026, 11, 10), paso=1.0):
    valores, valor = {}, 100.0
    for anio in range(desde_anio, hasta.year + 1):
        for mes in range(1, 13):
            for dia in (1, 15):
                d = date(anio, mes, dia)
                if d <= hasta:
                    valor += paso
                    valores[d] = valor
    return valores


def test_el_borrador_solo_usa_61_meses_de_la_serie():
    """El borrador mide sobre `meses_hasta(ultimo, 61)`. Recortando la serie a 6 años (6 x 366 dias) en vez de 10, esos 61 meses
    salen identicos: octubre de 2021 (el primero de los 61) queda a 5 años y 1 mes del ultimo dato (10-11-2026), dentro de 6."""
    valores = _valores(2014)
    ultimo = G.ultimo_mes_completo(valores)
    assert ultimo == "2026-10"
    meses = G.meses_hasta(ultimo, G.MESES + 1)
    assert (meses[0], len(meses)) == ("2021-10", 61)
    corte = max(valores) - timedelta(days=6 * 366)
    recortada = {d: v for d, v in valores.items() if d >= corte}
    assert G.ultimo_mes_completo(recortada) == ultimo
    completo, corto = G.fin_de_mes(valores), G.fin_de_mes(recortada)
    assert {m: completo[m] for m in meses} == {m: corto[m] for m in meses}
    assert min(corto) <= meses[0]


class _LectorDeActivos:
    def __init__(self, ids):
        self.ids = ids

    def get_search_index(self):
        return {"entries": [{"id": i, "type": "FUND"} for i in self.ids]}

    def _datos_por_instrumento(self, ids, *_ruta):
        return {i: {"identity": {"name": f"Gestora{i[-1]} Fondo", "currency": "EUR"},
                    "classification": {"category": "EAA Fund EUR Corporate Bond"},
                    "costs": {"ongoing_charge": 0.01}, "size": {"aum": 500e6, "currency": "EUR"},
                    "metrics": {}} for i in ids}


class _LectorDeSeries:
    def get_ecb_fx_points(self, _moneda):
        return []

    def get_assets_many(self, ids):
        return {i: {"asset_id": i, "product": {"inception_date": "2010-01-01"}} for i in ids}


def _cargar(monkeypatch, ids, valores_de, barrera=None):
    import optimization.repository as opt

    monkeypatch.setattr(opt, "_root_exclusion_reason", lambda raiz, moneda, asset_id, reader=None: None)

    def cargar(_lector, asset_id, _raiz, ventana, **_k):
        assert ventana == G.VENTANA_DE_LECTURA
        if barrera is not None:
            barrera.wait()
        valores = valores_de[asset_id]
        if valores is None:
            raise opt.PriceSeriesProblem("PRICE_SERIES_MISSING")
        return valores

    monkeypatch.setattr(opt, "_load_window_values", cargar)
    return G.cargar_elegibles(_LectorDeActivos(ids), _LectorDeSeries())


def test_leer_las_series_en_paralelo_da_lo_mismo_que_leerlas_una_a_una(monkeypatch):
    """5 candidatos: tres con 12 años de serie, uno con 3 (le faltan meses de los 61) y uno sin serie. Se espera lo que daria el
    recorrido en serie: los tres primeros elegibles, en el orden de los ids, y un descarte de cada motivo."""
    ids = [f"ES000000000{k}" for k in range(1, 6)]
    valores_de = {ids[0]: _valores(2014, paso=1.0), ids[1]: _valores(2014, paso=2.0), ids[2]: _valores(2014, paso=3.0),
                  ids[3]: _valores(2024), ids[4]: None}
    en_serie = _cargar(monkeypatch, ids, valores_de)
    G._GUARDADO.clear()
    # Los 5 han de estar a la vez en `_load_window_values`: la barrera de 5 no se abre si se leen de uno en uno.
    en_paralelo = _cargar(monkeypatch, ids, valores_de, barrera=threading.Barrier(5, timeout=5))
    for resultado in (en_serie, en_paralelo):
        elegibles, ultimo_mes, fuera = resultado
        assert [f["asset_id"] for f in elegibles] == ids[:3]
        assert ultimo_mes == "2026-10"
        assert fuera == {"sin 5 años completos de serie": 1, "sin serie utilizable": 1}
        assert len(elegibles[0]["serie"]) == 61
    assert [f["serie"] for f in en_serie[0]] == [f["serie"] for f in en_paralelo[0]]
    # El valor de octubre de 2021 del primero: su ultimo cierre (dia 15) de ese mes, calculado sobre la serie, no sobre el motor.
    esperado = valores_de[ids[0]][date(2021, 10, 15)]
    assert en_paralelo[0][0]["serie"]["2021-10"] == esperado


def test_sin_ningun_mes_completo_no_revienta_con_un_valueerror(monkeypatch):
    monkeypatch.setattr(G, "ultimo_mes_completo", lambda _valores: None)
    with pytest.raises(G.GeneradorNoDisponible):
        _cargar(monkeypatch, ["ES0000000001"], {"ES0000000001": _valores(2014)})


# ── restos: resolved_from y cambios del BCE ──

def test_un_id_con_espacios_no_marca_resolved_from():
    l = lector.LectorBaseNueva(_db_de_tres())
    ficha = repo.get_asset_detail(l, " ES0000000001 ", with_holdings=False)
    assert ficha is not None and "resolved_from" not in ficha


def test_los_cambios_del_bce_que_recibe_el_consumidor_son_solo_positivos_y_finitos():
    """Cambios: 02-01 = 1,25; 03-01 = 0; 04-01 = -1; 05-01 = NaN. Solo el primero llega, en cualquier consumidor."""
    class Db(_DbDeCambios):
        def stream(self, **_o):
            class S:
                def to_dict(self):
                    return {"points": [{"date": "2026-01-02", "value": 1.25}, {"date": "2026-01-03", "value": 0},
                                       {"date": "2026-01-04", "value": -1.0}, {"date": "2026-01-05", "value": float("nan")}]}
            return [S()]
    assert lector.LectorOptimizacionBaseNueva(Db([])).get_ecb_fx_points("USD") == [("2026-01-02", 1.25)]
