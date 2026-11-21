# -*- coding: utf-8 -*-
"""Con `--sin-red`, un ETF no pierde lo que solo da la ficha completa de justETF.

justetf_scraping no pasa por `core.http`. Desde ALTA-17b no se llama en modo
sin red, y 12 ETF perdían descripción, posiciones top-10, peso top-10 y países
(revisión de la rama, IMP-1). Ahora:
- la ficha se guarda en `cache/justetf_overview/<ISIN>.json` y en modo sin red
  se sirve de ahí (con el TTL de la familia `cartera`, como la caché HTTP);
- si no hay copia (por ejemplo, la primera vez tras el cambio), la retención
  conserva lo que la ficha anterior tenía de justETF, marcado `retenido:`.

Sin red de verdad: la cotización se siembra en la caché HTTP, la biblioteca es
un módulo falso y cualquier petición de `requests` hace fallar el test.
"""
import datetime as dt
import json
import sys
import time
import types
from pathlib import Path

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.adquisicion import nucleo, registro, retencion  # noqa: E402
from core.adquisicion.adaptador import Contexto  # noqa: E402
from core.http import Http, cache_key  # noqa: E402
from fetchers import justetf  # noqa: E402

ISIN = "IE00B4L5Y983"
SETTINGS = {"prioridad_fuentes": ["justetf"], "divisa": "EUR", "rate_limit_segundos": 0}
FICHA = {
    "name": "iShares Core MSCI World", "description": "Replica el MSCI World.", "index": "MSCI World",
    "replication": "Physical", "fund_currency": "USD", "distribution_policy": "Accumulating",
    "inception_date": "25.09.2009", "fund_domicile": "Ireland", "ter": 0.2, "fund_size_eur": 98000,
    "countries": [{"name": "United States", "percentage": 70.1}, {"name": "Japan", "percentage": 5.2}],
    "sectors": [{"name": "Technology", "percentage": 25.0}],
    "top_holdings": [{"name": "Apple", "isin": "US0378331005", "percentage": 4.9},
                     {"name": "Microsoft", "isin": "US5949181045", "percentage": 4.5}],
    "gettex": object(),            # lo que no se usa no se guarda (no es JSON)
}


@pytest.fixture(autouse=True)
def sin_peticiones(monkeypatch):
    def prohibido(*_a, **_k):
        raise AssertionError("el test ha intentado salir a red")
    monkeypatch.setattr(requests.Session, "request", prohibido)


@pytest.fixture
def biblioteca(monkeypatch):
    """justetf_scraping falso: apunta las llamadas y devuelve FICHA."""
    llamadas: list = []
    mod = types.ModuleType("justetf_scraping")

    def get_etf_overview(isin, *_a, **_k):
        llamadas.append(isin)
        return dict(FICHA)
    mod.get_etf_overview = get_etf_overview
    monkeypatch.setitem(sys.modules, "justetf_scraping", mod)
    return llamadas


def _http(base: Path, **modo) -> Http:
    http = Http(SETTINGS, base / "cache" / "http", **modo)
    url = justetf.QUOTE_URL.format(isin=ISIN)
    ruta = http._ruta_cache(cache_key(url, {"locale": "en", "currency": "EUR"}))
    ruta.write_text(json.dumps({"url": url, "status": 200, "fetched_at": time.time(), "text": json.dumps(
        {"latestQuote": {"raw": 101.5}, "latestQuoteDate": "2026-10-16", "quoteTradingVenue": "XETRA"})}), encoding="utf-8")
    return http


def _pasada(base: Path, anterior: dict | None = None, tipo: str = "etf", fuentes=("justetf",), **modo) -> dict:
    ctx = Contexto(http=_http(base, **modo), settings=SETTINGS, base=base)
    return nucleo.adquiere(ISIN, tipo, ctx, [registro.JUSTETF], list(fuentes), anterior=anterior).datos


def _copia(base: Path) -> Path:
    return base / "cache" / justetf.CARPETA_FICHA / f"{ISIN}.json"


def test_la_ficha_completa_se_guarda_y_sin_red_se_sirve_de_la_copia(tmp_path, biblioteca):
    anterior = _pasada(tmp_path)                         # con red: llama a la biblioteca
    assert biblioteca == [ISIN]
    datos = _copia(tmp_path).read_bytes()
    assert b"\r\n" not in datos and b"gettex" not in datos
    assert [p["nombre"] for p in anterior["cartera"]["posiciones"]] == ["Apple", "Microsoft"]

    d = _pasada(tmp_path, anterior, sin_red=True)
    assert biblioteca == [ISIN]                          # sin red no se vuelve a llamar
    for ruta in ("cartera.posiciones", "cartera.peso_top10_pct", "identificacion.descripcion"):
        assert d["meta"]["procedencia"][ruta] == "justetf", ruta    # dato de la copia, no retenido
    assert d["cartera"]["posiciones"] == anterior["cartera"]["posiciones"]
    assert d["cartera"]["paises_pct"] == anterior["cartera"]["paises_pct"]
    assert "retencion" not in d["meta"]


def test_sin_copia_y_sin_red_se_retiene_lo_de_la_ficha_anterior(tmp_path, biblioteca):
    # La transición: fichas extraídas antes de que existiera la copia.
    anterior = _pasada(tmp_path)
    _copia(tmp_path).unlink()
    biblioteca.clear()

    d = _pasada(tmp_path, anterior, sin_red=True)

    assert biblioteca == []
    assert d["cartera"]["posiciones"] == anterior["cartera"]["posiciones"]
    assert d["cartera"]["peso_top10_pct"] == anterior["cartera"]["peso_top10_pct"]
    assert d["identificacion"]["descripcion"] == "Replica el MSCI World."
    assert d["cartera"]["paises_pct"] == anterior["cartera"]["paises_pct"]
    proc = d["meta"]["procedencia"]
    hoy = retencion._hoy().isoformat()
    assert proc["cartera.posiciones"] == f"retenido:justetf@{hoy}"
    assert proc["valoracion.vl"] == "justetf"            # la cotización sí estaba en caché
    retenidos = {r["ruta"] for r in d["meta"]["retencion"]["retenidos"] if r.get("motivo") == "sin_red"}
    assert {"cartera.posiciones", "identificacion.descripcion", "cartera.paises_pct"} <= retenidos
    assert retencion.avisos(d) == ["dato_retenido"]


def test_con_red_no_se_retiene_nada_aunque_falte(tmp_path, biblioteca, monkeypatch):
    # La retención de modo sin red solo actúa sin red: con red manda la fuente.
    anterior = _pasada(tmp_path)
    _copia(tmp_path).unlink()
    monkeypatch.setattr(sys.modules["justetf_scraping"], "get_etf_overview", lambda isin: {})
    d = _pasada(tmp_path, anterior)
    assert "posiciones" not in d.get("cartera", {})
    assert "retencion" not in d["meta"]


def test_la_copia_caduca_con_el_ttl_de_cartera_salvo_sin_caducidad(tmp_path, biblioteca):
    _pasada(tmp_path)
    copia = json.loads(_copia(tmp_path).read_text(encoding="utf-8"))
    copia["fetched_at"] = time.time() - 40 * 86400       # cartera: 30 días
    _copia(tmp_path).write_text(json.dumps(copia), encoding="utf-8")

    assert justetf._ficha_completa(ISIN, _http(tmp_path, sin_red=True)) is None
    assert justetf._ficha_completa(ISIN, _http(tmp_path, sin_red=True, sin_caducidad=True))["name"] == FICHA["name"]
    assert biblioteca == [ISIN]


def test_las_rutas_que_se_retienen_sin_red_son_las_de_la_ficha_completa():
    out: dict = {}
    justetf._mapea_ficha(out, json.loads(json.dumps({k: FICHA[k] for k in justetf.CAMPOS_FICHA})))
    escritas = {".".join(r.split(".")[:2]) for r in _rutas(out)}
    assert escritas == set(retencion.SIN_RED["justetf"])
    assert set(retencion.SIN_RED["justetf"]) <= set(registro.JUSTETF.capacidades)


def _rutas(d: dict, prefijo: str = "") -> list[str]:
    out = []
    for k, v in d.items():
        ruta = f"{prefijo}{k}"
        out += _rutas(v, ruta + ".") if isinstance(v, dict) else [ruta]
    return out


# --- Tercera pasada: MEN-A a MEN-D -------------------------------------------

def _reescribe_copia(base: Path, **cambios) -> None:
    copia = json.loads(_copia(base).read_text(encoding="utf-8"))
    for clave, valor in cambios.items():
        if clave == "fetched_at":
            copia["fetched_at"] = valor
        else:
            copia["ficha"][clave] = valor
    _copia(base).write_text(json.dumps(copia), encoding="utf-8")


def test_si_la_copia_vigente_ya_no_trae_un_campo_no_se_resucita(tmp_path, biblioteca):
    # MEN-A: la copia se renovó (con red) y justETF ya no da las posiciones.
    anterior = _pasada(tmp_path)
    _reescribe_copia(tmp_path, top_holdings=[], fetched_at=time.time())
    d = _pasada(tmp_path, anterior, sin_red=True)
    assert "posiciones" not in d.get("cartera", {})
    assert "retencion" not in d["meta"] and "sin_servir" not in d["meta"]["adquisicion"]
    assert d["identificacion"]["descripcion"] == "Replica el MSCI World."     # lo demás, de la copia


@pytest.mark.parametrize("tipo,fuentes", [("etf", ("cnmv",)), ("fondo", ("justetf",))])
def test_si_justetf_no_esta_en_el_plan_no_se_retiene_nada(tmp_path, biblioteca, tipo, fuentes):
    # MEN-A: `--fuentes` sin justetf, o un ISIN reclasificado de ETF a fondo.
    anterior = _pasada(tmp_path)
    _copia(tmp_path).unlink()
    d = _pasada(tmp_path, anterior, tipo=tipo, fuentes=fuentes, sin_red=True)
    assert "retencion" not in d["meta"]
    assert "posiciones" not in d.get("cartera", {})


@pytest.mark.parametrize("dias,retiene", [(170, True), (190, False)])
def test_la_retencion_cuenta_desde_la_descarga_de_la_copia(tmp_path, biblioteca, dias, retiene):
    # MEN-B: la ficha anterior se regeneró hoy desde una copia vieja (con
    # --sin-caducidad); su meta.actualizado es de hoy, pero el dato es de cuando
    # se descargó la copia, y el tope de 180 días cuenta desde ahí.
    _pasada(tmp_path)
    descarga = time.time() - dias * 86400
    _reescribe_copia(tmp_path, fetched_at=descarga)
    anterior = _pasada(tmp_path, sin_red=True, sin_caducidad=True)       # servida de la copia vieja
    assert anterior["meta"]["procedencia"]["cartera.posiciones"] == "justetf"

    d = _pasada(tmp_path, anterior, sin_red=True)                         # ya caducada: no se sirve
    assert d["meta"]["adquisicion"]["sin_servir"] == {"justetf": ["overview"]}
    fecha = dt.datetime.fromtimestamp(descarga, dt.timezone.utc).date().isoformat()
    if retiene:
        assert d["meta"]["procedencia"]["cartera.posiciones"] == f"retenido:justetf@{fecha}"
        assert {r["ruta"]: r["dias"] for r in d["meta"]["retencion"]["retenidos"]}["cartera.posiciones"] >= 169
    else:
        assert "posiciones" not in d.get("cartera", {})
        motivos = {r["ruta"]: r["motivo"] for r in d["meta"]["retencion"]["descartados"]}
        assert motivos["cartera.posiciones"].startswith("sin_red_antiguedad_")


def test_un_fallo_al_mapear_la_ficha_no_se_lleva_la_cotizacion(tmp_path, biblioteca, monkeypatch):
    # MEN-C: un país sin `percentage` (biblioteca nueva o copia editada a mano).
    rota = dict(FICHA, countries=[{"name": "United States"}])
    monkeypatch.setattr(sys.modules["justetf_scraping"], "get_etf_overview", lambda isin: dict(rota))
    d = _pasada(tmp_path)
    assert d["valoracion"]["vl"] == 101.5 and d["valoracion"]["vl_fecha"] == "2026-10-16"
    assert d["meta"]["errores"] == []
    assert d["identificacion"]["descripcion"] == "Replica el MSCI World."     # lo mapeado antes del fallo


def test_si_no_se_puede_guardar_la_copia_se_usa_la_ficha_descargada(tmp_path, biblioteca, monkeypatch, caplog):
    # MEN-D: disco lleno, permisos o el destino abierto por otro proceso.
    def falla(*_a, **_k):
        raise PermissionError("destino abierto por otro proceso")
    monkeypatch.setattr(justetf, "atomic_write_text", falla)
    with caplog.at_level("WARNING", logger="fondosdb.justetf"):
        d = _pasada(tmp_path)
    assert biblioteca == [ISIN]
    assert [p["nombre"] for p in d["cartera"]["posiciones"]] == ["Apple", "Microsoft"]
    assert d["identificacion"]["descripcion"] == "Replica el MSCI World."
    assert not _copia(tmp_path).exists()
    assert any("no se pudo guardar la copia" in r.getMessage() for r in caplog.records)


# --- Cuarta pasada: MEN-F y MEN-G --------------------------------------------

def test_si_no_se_puede_guardar_la_copia_nueva_no_se_sirve_la_vieja(tmp_path, biblioteca, monkeypatch):
    # MEN-F: la copia V1 (40 días) se quedaba y una pasada --sin-caducidad
    # posterior la servía como dato fresco, por detrás de la ficha V2.
    _pasada(tmp_path)
    _reescribe_copia(tmp_path, fetched_at=time.time() - 40 * 86400)
    v2 = dict(FICHA, description="Versión 2", top_holdings=[{"name": "Nvidia", "isin": "US67066G1040",
                                                              "percentage": 5.1}])
    monkeypatch.setattr(sys.modules["justetf_scraping"], "get_etf_overview", lambda isin: dict(v2))
    real = justetf.atomic_write_text

    def falla(*_a, **_k):
        raise PermissionError("destino abierto por otro proceso")
    monkeypatch.setattr(justetf, "atomic_write_text", falla)
    nueva = _pasada(tmp_path)
    monkeypatch.setattr(justetf, "atomic_write_text", real)
    assert nueva["identificacion"]["descripcion"] == "Versión 2"
    assert not _copia(tmp_path).exists()                      # la vieja ya no está

    d = _pasada(tmp_path, nueva, sin_red=True, sin_caducidad=True)
    assert d["identificacion"]["descripcion"] == "Versión 2"
    assert [p["nombre"] for p in d["cartera"]["posiciones"]] == ["Nvidia"]
    assert d["meta"]["procedencia"]["cartera.posiciones"].startswith("retenido:justetf@")


def test_si_tampoco_se_puede_quitar_la_copia_vieja_la_pasada_sigue(tmp_path, biblioteca, monkeypatch):
    _pasada(tmp_path)
    _reescribe_copia(tmp_path, fetched_at=time.time() - 40 * 86400)   # caducada: se vuelve a descargar
    biblioteca.clear()

    def falla(*_a, **_k):
        raise PermissionError("bloqueado")
    monkeypatch.setattr(justetf, "atomic_write_text", falla)
    monkeypatch.setattr(Path, "unlink", falla)
    d = _pasada(tmp_path)
    assert biblioteca == [ISIN]
    assert d["identificacion"]["descripcion"] == "Replica el MSCI World." and d["meta"]["errores"] == []


CORRUPTOS = [float("nan"), float("inf"), 1e20, "abc", -5, 0]


@pytest.mark.parametrize("marca", CORRUPTOS + ["futura"])
def test_un_fetched_at_corrupto_en_la_copia_no_tumba_nada(tmp_path, biblioteca, marca):
    # MEN-G: NaN hacía fallar la retención (y todo update --all); 1e20 o
    # Infinity dejaban la copia vigente para siempre y el export fallaba.
    from core import exporta

    anterior = _pasada(tmp_path)
    _reescribe_copia(tmp_path, fetched_at=time.time() + 10 * 86400 if marca == "futura" else marca)

    d = _pasada(tmp_path, anterior, sin_red=True)             # la copia no vale: se retiene
    assert d["meta"]["adquisicion"]["sin_servir"] == {"justetf": ["overview"]}
    hoy = retencion._hoy().isoformat()
    assert d["meta"]["procedencia"]["cartera.posiciones"] == f"retenido:justetf@{hoy}"

    n = len(d["cartera"]["posiciones"])
    assert exporta.procedencia_cartera(tmp_path, ISIN, d, n)["obtenido"] == f"{hoy}T00:00:00+00:00"
    assert exporta.procedencia_cartera(tmp_path, ISIN, anterior, n)["obtenido"] is None

    biblioteca.clear()
    _pasada(tmp_path)                                          # con red: se vuelve a descargar
    assert biblioteca == [ISIN]
    assert retencion.procedencia.epoca_valida(json.loads(_copia(tmp_path).read_text(encoding="utf-8"))["fetched_at"])


@pytest.mark.parametrize("marca", CORRUPTOS)
def test_la_retencion_ignora_una_fecha_de_copia_corrupta(marca):
    anterior = {"identificacion": {"tipo": "etf", "descripcion": "x"},
                "meta": {"actualizado": "2026-10-14T05:00:00+00:00",
                         "procedencia": {"identificacion.descripcion": "justetf"}}}
    final = {"identificacion": {"tipo": "etf"}, "meta": {"procedencia": {}}}
    retencion.aplica(final, anterior, hoy=dt.date(2026, 10, 17), sin_servir={"justetf": {"overview": marca}})
    assert final["meta"]["procedencia"]["identificacion.descripcion"] == "retenido:justetf@2026-10-14"


def test_epoca_valida():
    valida = retencion.procedencia.epoca_valida
    ahora = time.time()
    assert valida(ahora - 86400) == ahora - 86400 and valida(str(ahora)) == ahora
    for malo in CORRUPTOS + [None, ahora + 3 * 86400, [1]]:
        assert valida(malo) is None, malo
