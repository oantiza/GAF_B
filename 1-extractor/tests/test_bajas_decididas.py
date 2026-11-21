# -*- coding: utf-8 -*-
"""Una baja decidida por una persona: «dejó de cotizar» con fecha, motivo y autor.

Decisión 7 de `DECISIONES_DATOS_2026-11-07.md`. La CAM (`ES0114400007`) figuraba
`nunca_resuelto`, que es falso: FIRDS la tiene, y sus cuotas no se negocian desde 2011. No hay
fuente de precio que lo pruebe, así que la única vía honesta es que lo decida alguien y quede
escrito quién, cuándo y por qué (`core/bajas_decididas.py`).

Lo que fijan estas pruebas, por orden de lo que costaría romperlo:

1. La decisión gana a la fuente, y si la fuente lo da como vivo el conflicto queda escrito.
2. Sobrevive a una pasada con red que trae precio, y a la guarda de calidad.
3. Llega al canónico como `dejo_de_cotizar`, con su detalle y su origen.
4. Un fichero mal escrito no se lee como vacío.
"""
import datetime as dt
import json
import shutil
import sys
import types
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from core import adaptador_bdb, bajas_decididas  # noqa: E402
from core import update as update_pipeline  # noqa: E402
from core.adquisicion import disponibilidad, procedencia  # noqa: E402
from core.adquisicion.adaptador import Adaptador  # noqa: E402
from core.adquisicion.nucleo import _marca_disponibilidad  # noqa: E402

CAM = "ES0114400007"
OTRA = "ES0105046017"   # Aena vigente: sin baja decidida
CABECERA = "isin,desde,motivo,autor,fecha_decision\n"
FILA_CAM = (f'{CAM},2011-12-09,"Absorbida por Banco Sabadell en 2012; sin negociación desde '
            f'2011, suspendida por la CNMV el 09-12-2011","Óscar, decisión 7 del 07-11-2026",2026-11-07\n')


def _base(tmp_path: Path, csv: str | None = CABECERA + FILA_CAM) -> Path:
    """Un proyecto de prueba con el alcance de verdad (España dentro) y sus bajas decididas."""
    (tmp_path / "config").mkdir(parents=True, exist_ok=True)
    shutil.copy(RAIZ / "config" / "alcance_mercados.json", tmp_path / "config")
    if csv is not None:
        (tmp_path / bajas_decididas.FICHERO).write_text(csv, encoding="utf-8")
    return tmp_path


def _marca(base: Path, isin: str = CAM, contesto=None, aportado=None, previo=None, sucesores=None):
    final = {"meta": {}}
    anterior = {"meta": {"disponibilidad": previo}} if previo else None
    _marca_disponibilidad(final, isin, "accion", types.SimpleNamespace(base=base),
                          {"eodhd": contesto}, aportado or {}, anterior, sucesores=sucesores)
    return final


# ---------------------------------------------------------------- el fichero
def test_el_fichero_del_proyecto_se_lee_y_lleva_la_cam():
    bajas = bajas_decididas.carga(RAIZ)
    cam = bajas[CAM]
    assert cam["desde"] == "2011-12-09"
    assert cam["fecha_decision"] == "2026-11-07"
    assert cam["autor"] == "Óscar, decisión 7 del 07-11-2026"
    assert "Banco Sabadell" in cam["motivo"] and "CNMV" in cam["motivo"]


def test_la_fecha_es_la_de_la_suspension_y_la_exclusion_va_en_el_motivo():
    """Decisión 11 del 07-11-2026: `desde` es el primer día sin negociación."""
    cabecera = bajas_decididas.__doc__ or ""
    assert "decisión 11" in cabecera and "día de la suspensión" in cabecera
    bajas = bajas_decididas.carga(RAIZ)
    nh = bajas["ES0161560018"]
    assert nh["desde"] == "2025-09-15"
    assert "suspendida el 15-09-2025" in nh["motivo"]
    assert "exclusión con efectos del 25-09-2025" in nh["motivo"]
    assert bajas["ES0114400007"]["desde"] == "2011-12-09"
    assert bajas["ES0125140A14"]["desde"] == "2026-09-11"


def test_sin_fichero_no_hay_bajas(tmp_path):
    assert bajas_decididas.carga(tmp_path) == {}


@pytest.mark.parametrize("texto, error", [
    ("isin,desde,motivo\n", "cabecera"),
    (CABECERA + FILA_CAM + FILA_CAM, "dos veces"),
    (CABECERA + "ES011440000,2011-12-09,motivo largo de verdad,Óscar,2026-11-07\n", "ISIN"),
    (CABECERA + f"{CAM},09-12-2011,motivo largo de verdad,Óscar,2026-11-07\n", "fecha"),
    (CABECERA + f"{CAM},2099-01-01,motivo largo de verdad,Óscar,2026-11-07\n", "futura"),
    (CABECERA + f"{CAM},2011-12-09,corto,Óscar,2026-11-07\n", "motivo"),
    (CABECERA + f"{CAM},2011-12-09,motivo largo de verdad,,2026-11-07\n", "quién"),
    (CABECERA + f"{CAM},2011-12-09,absorbida, sin negociar,Óscar,2026-11-07\n", "columnas de más"),
])
def test_un_fichero_mal_escrito_es_un_error_y_no_un_fichero_vacio(texto, error):
    with pytest.raises(bajas_decididas.ErrorBaja, match=error):
        bajas_decididas.lee(texto, hoy=dt.date(2026, 11, 7))


# ---------------------------------------------------------------- la marca
def test_sin_red_la_baja_decidida_se_aplica_con_su_fecha_y_su_autor(tmp_path):
    """La CAM hoy: nadie contesta, y antes de esto se quedaba en `nunca_resuelto`."""
    previo = {"estado": disponibilidad.NUNCA_RESUELTO, "desde": "2026-11-02", "visto": "2026-11-04"}
    marca = _marca(_base(tmp_path), contesto=None, previo=previo)["meta"]["disponibilidad"]
    assert marca["estado"] == disponibilidad.DEJO_DE_COTIZAR
    assert marca["desde"] == "2011-12-09"            # la del hecho, no la de la decisión ni la anterior
    assert marca["visto"] == dt.date.today().isoformat()
    assert marca["origen"] == "decision"
    assert marca["decision"]["autor"] == "Óscar, decisión 7 del 07-11-2026"
    assert "Banco Sabadell" in marca["detalle"]
    assert "Baja decidida, no medida: Óscar, decisión 7 del 07-11-2026." in marca["detalle"]
    assert "conflicto" not in marca


def test_la_decision_gana_al_proveedor_y_el_conflicto_queda_escrito(tmp_path, caplog):
    aportado = {"eodhd": {"valoracion": {"vl": 1.34}}}
    with caplog.at_level("WARNING", logger="fondosdb.nucleo"):
        marca = _marca(_base(tmp_path), contesto=True, aportado=aportado)["meta"]["disponibilidad"]
    assert marca["estado"] == disponibilidad.DEJO_DE_COTIZAR
    assert marca["conflicto"] == {"estado_fuente": disponibilidad.COTIZA, "fuente": "eodhd",
                                  "visto": dt.date.today().isoformat()}
    assert any("gana la decisión" in m for m in caplog.messages)


def test_gana_tambien_a_la_rama_del_isin_sustituido(tmp_path):
    marca = _marca(_base(tmp_path), contesto=True, aportado={"eodhd": {"valoracion": {"vl": 1.0}}},
                   sucesores={"eodhd": OTRA})["meta"]["disponibilidad"]
    assert marca["origen"] == "decision" and OTRA not in marca["detalle"]
    assert "conflicto" not in marca      # la evidencia también decía «dejó de cotizar»


def test_un_isin_sin_baja_decidida_sigue_como_siempre(tmp_path):
    marca = _marca(_base(tmp_path), OTRA, contesto=True,
                   aportado={"eodhd": {"valoracion": {"vl": 20.0}}})["meta"]["disponibilidad"]
    assert marca["estado"] == disponibilidad.COTIZA
    assert "origen" not in marca and "decision" not in marca


def test_un_fichero_roto_lo_dice_en_la_ficha_y_deja_la_evidencia(tmp_path):
    final = _marca(_base(tmp_path, CABECERA + FILA_CAM + FILA_CAM), contesto=True,
                   aportado={"eodhd": {"valoracion": {"vl": 1.0}}})
    assert final["meta"]["disponibilidad"]["estado"] == disponibilidad.COTIZA
    assert any(e.startswith("bajas_decididas:") for e in final["meta"]["errores"])


# ---------------------------------------------------------------- una pasada entera
def _eodhd_falso(vl):
    """Un EODHD que contesta y da precio: la pasada con red en la que la fuente lo cree vivo."""
    def fetch(isin, _ctx):
        procedencia.contesto(True)
        return {"identificacion": {"isin": isin, "nombre": "CAM, CUOTAS PARTICIPATIVAS",
                                   "ticker": "CAM", "mercado": "MC"},
                "valoracion": {"vl": vl, "vl_fecha": "2026-11-06"}}
    return Adaptador(id="eodhd", descripcion="falso", oficial=False,
                     capacidades={"identificacion.*": "identidad", "valoracion.*": "precio"},
                     endpoints=(), fetch=fetch, implicito=True)


def _pasada(base, monkeypatch, vl=1.34, previo=None):
    monkeypatch.setattr(update_pipeline, "_adaptadores_activos", lambda: [_eodhd_falso(vl)])
    if previo is not None:
        (base / "data" / "funds").mkdir(parents=True, exist_ok=True)
        (base / "data" / "funds" / f"{CAM}.json").write_text(json.dumps(previo), encoding="utf-8")
    r = update_pipeline.ejecuta_pipeline(CAM, "accion", ["eodhd"], http=None, settings={},
                                         force=False, base=base, sin_historico=True,
                                         print_cb=lambda *_a: None)
    ruta = base / "data" / "funds" / f"{CAM}.json"
    return r, (json.loads(ruta.read_text(encoding="utf-8")) if ruta.exists() else None)


def test_sobrevive_a_una_pasada_con_red_que_trae_precio(tmp_path, monkeypatch):
    r, ficha = _pasada(_base(tmp_path), monkeypatch)
    assert r["ok"], r
    marca = ficha["meta"]["disponibilidad"]
    assert marca["estado"] == disponibilidad.DEJO_DE_COTIZAR and marca["origen"] == "decision"
    assert marca["conflicto"]["estado_fuente"] == disponibilidad.COTIZA
    assert ficha["valoracion"]["vl"] == 1.34      # el dato se queda: la decisión no borra nada


def test_la_guarda_de_calidad_no_para_la_baja_decidida(tmp_path, monkeypatch):
    """La ficha anterior tenía VL y la pasada lo pierde: la guarda conserva la ficha, y aun así
    la marca decidida entra."""
    previo = {"identificacion": {"isin": CAM, "nombre": "CAM", "ticker": "CAM", "mercado": "MC",
                                 "tipo": "accion"},
              "valoracion": {"vl": 1.34, "vl_fecha": "2011-12-08"},
              "meta": {"disponibilidad": {"estado": disponibilidad.NUNCA_RESUELTO,
                                          "desde": "2026-11-02", "visto": "2026-11-04"}}}
    r, ficha = _pasada(_base(tmp_path), monkeypatch, vl=None, previo=previo)
    assert r["ok"] and "QUALITY_REGRESSION_BLOCKED" in r["reason"], r
    assert ficha["valoracion"] == previo["valoracion"]
    assert ficha["meta"]["disponibilidad"]["origen"] == "decision"
    assert ficha["meta"]["disponibilidad"]["desde"] == "2011-12-09"


# ---------------------------------------------------------------- el canónico
def test_llega_al_canonico_como_dejo_de_cotizar_con_su_detalle(tmp_path, monkeypatch):
    _r, ficha = _pasada(_base(tmp_path), monkeypatch)
    disp = adaptador_bdb.convierte_accion(ficha)["disponibilidad"]
    assert disp["estado"] == "dejo_de_cotizar"
    assert disp["desde"] == "2011-12-09"
    assert "Baja decidida, no medida" in disp["detalle"]
    assert disp["origen"] == "decision"
