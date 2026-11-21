# -*- coding: utf-8 -*-
"""Correcciones manuales en origen: se guardan con motivo, se aplican en el
núcleo antes del saneado, se atribuyen a `manual:<autor>` y se sirven a la app."""
import json
import sys
import threading
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import canonico_regulatorio, correcciones  # noqa: E402
from core.adquisicion import nucleo  # noqa: E402
import ops_server  # noqa: E402
from tests.test_nucleo import _adaptador, _ctx  # noqa: E402
from tests.test_ops import _base, _pide  # noqa: E402

ADAPTADORES = [_adaptador("oficial", {"riesgo.sri_kid_1a7": 5, "identificacion.ucits": True}, oficial=True, orden=10),
               _adaptador("ms", {"identificacion.nombre": "MS", "identificacion.gestora": "Brand",
                                 "identificacion.domicilio": "IRL", "costes.ter_pct": 1.5,
                                 "identificacion.otro": "sobra"}, orden=20)]


def test_pon_exige_ruta_declarada_motivo_y_tipo_coherente(tmp_path):
    base = _base(tmp_path)
    fila = correcciones.pon(base, "lu0000000001", "riesgo.sri_kid_1a7", "4", "KID de 2026-02", "Óscar A.",
                            adaptadores=ADAPTADORES, actual=5)
    assert fila["valor"] == 4 and isinstance(fila["valor"], int)      # texto del CLI -> entero como el dato
    assert fila["autor"] == "oscar-a"                                  # saneado a etiqueta manual:oscar-a
    assert correcciones.sanea_autor("a:b+c") == "a-b-c" and correcciones.sanea_autor("") == "manual"
    assert fila["fecha"].endswith("Z") and fila["isin"] == "LU0000000001"
    assert correcciones.lista(base) == [fila]
    assert (base / "config" / "correcciones.json").exists()

    with pytest.raises(correcciones.ErrorCorreccion, match="ningún adaptador declara"):
        correcciones.pon(base, "LU0000000001", "riesgo.inventado", 1, "motivo", adaptadores=ADAPTADORES)
    with pytest.raises(correcciones.ErrorCorreccion, match="no se corrige a mano"):
        correcciones.pon(base, "LU0000000001", "calidad.score", 1, "motivo", adaptadores=ADAPTADORES)
    with pytest.raises(correcciones.ErrorCorreccion, match="motivo"):
        correcciones.pon(base, "LU0000000001", "riesgo.sri_kid_1a7", 4, "", adaptadores=ADAPTADORES)
    with pytest.raises(correcciones.ErrorCorreccion, match="escalares"):
        correcciones.pon(base, "LU0000000001", "riesgo.sri_kid_1a7", [4], "motivo", adaptadores=ADAPTADORES)
    with pytest.raises(correcciones.ErrorCorreccion, match="ISIN"):
        correcciones.pon(base, "MALO", "riesgo.sri_kid_1a7", 4, "motivo", adaptadores=ADAPTADORES)
    with pytest.raises(correcciones.ErrorCorreccion, match="numérico"):
        correcciones.pon(base, "LU0000000001", "costes.ter_pct", "alto", "motivo", adaptadores=ADAPTADORES, actual=1.5)
    with pytest.raises(correcciones.ErrorCorreccion, match="booleano"):
        correcciones.pon(base, "LU0000000001", "identificacion.ucits", 3, "motivo", adaptadores=ADAPTADORES, actual=True)
    assert correcciones.pon(base, "LU0000000001", "identificacion.ucits", "no", "no es UCITS", adaptadores=ADAPTADORES,
                            actual=True)["valor"] is False
    assert correcciones.pon(base, "LU0000000001", "costes.ter_pct", "1,25", "folleto", adaptadores=ADAPTADORES,
                            actual=1.5)["valor"] == 1.25
    # sin dato previo, el valor entra tal cual (null borra)
    assert correcciones.pon(base, "LU0000000001", "identificacion.otro", None, "sobra", adaptadores=ADAPTADORES)["valor"] is None

    # bajo un comodín, sin dato en la ficha, hace falta decir que es un campo nuevo
    comodin = [_adaptador("ms2", {"cartera.fecha": "2026-01-01"})]
    comodin[0].capacidades = {"cartera.*": "cartera"}
    with pytest.raises(correcciones.ErrorCorreccion, match="patrón genérico"):
        correcciones.pon(base, "LU0000000001", "cartera.fecha_rara", "2026", "errata", adaptadores=comodin)
    assert correcciones.pon(base, "LU0000000001", "cartera.fecha_rara", "2026", "de verdad", adaptadores=comodin,
                            nueva=True)["ruta"] == "cartera.fecha_rara"
    assert correcciones.pon(base, "LU0000000001", "cartera.fecha", "2026-02-01", "existe", adaptadores=comodin,
                            actual="2026-01-01")["valor"] == "2026-02-01"
    assert correcciones.quita(base, "LU0000000001", "cartera.fecha_rara") and correcciones.quita(base, "LU0000000001", "cartera.fecha")

    assert correcciones.quita(base, "LU0000000001", "costes.ter_pct") is True
    assert correcciones.quita(base, "LU0000000001", "costes.ter_pct") is False
    assert [f["ruta"] for f in correcciones.lista(base, "LU0000000001")] == [
        "identificacion.otro", "identificacion.ucits", "riesgo.sri_kid_1a7"]
    assert correcciones.interpreta_valor("true") is True and correcciones.interpreta_valor("null") is None
    assert correcciones.interpreta_valor("3,5") == 3.5 and correcciones.interpreta_valor("Texto") == "Texto"


def test_el_nucleo_aplica_las_correcciones_antes_del_saneado_y_las_atribuye(tmp_path):
    base = _base(tmp_path)
    correcciones.guarda(base, {"LU0000000001": {
        "riesgo.sri_kid_1a7": {"valor": 4, "motivo": "KID 2026-02 dice 4", "autor": "oscar", "fecha": "2026-09-05T10:00:00Z"},
        "identificacion.gestora": {"valor": "Brand", "motivo": "ya coincide", "autor": "oscar", "fecha": "2026-09-05T10:00:00Z"},
        "identificacion.otro": {"valor": None, "motivo": "sobra", "autor": "oscar", "fecha": "2026-09-05T10:00:00Z"},
        "identificacion.domicilio": {"valor": "LUX", "motivo": "folleto: Luxemburgo", "autor": "oscar", "fecha": "2026-09-05T10:00:00Z"},
        "identificacion.ucits": {"valor": True, "motivo": "redundante", "autor": "oscar", "fecha": "2026-09-05T10:00:00Z"},
    }})
    res = nucleo.adquiere("LU0000000001", "fondo", _ctx(base), ADAPTADORES)
    d, proc = res.datos, res.datos["meta"]["procedencia"]

    assert d["riesgo"]["sri_kid_1a7"] == 4 and proc["riesgo.sri_kid_1a7"] == "manual:oscar"
    assert d["identificacion"]["gestora"] == "Brand" and proc["identificacion.gestora"] == "ms:identificacion"
    assert "otro" not in d["identificacion"] and "identificacion.otro" not in proc
    assert d["identificacion"]["domicilio"] == "LUX" and proc["identificacion.domicilio"] == "manual:oscar"
    assert proc["identificacion.ucits"] == "oficial:identificacion"
    c = d["meta"]["correcciones"]
    assert c["riesgo.sri_kid_1a7"] == {"valor": 4, "motivo": "KID 2026-02 dice 4", "autor": "oscar",
                                       "fecha": "2026-09-05T10:00:00Z", "valor_fuente": 5,
                                       "fuente": "oficial:riesgo", "redundante": False}
    assert c["identificacion.gestora"]["redundante"] is True
    assert c["identificacion.ucits"]["redundante"] is True
    assert c["identificacion.otro"]["valor_fuente"] == "sobra"
    assert c["identificacion.domicilio"]["valor_fuente"] == "IRL"
    assert d["calidad"]["bucket"]                                   # el saneado corrió después
    assert proc["calidad.bucket"] == "derivado:calidad"

    # sin correcciones para el ISIN no se anota nada
    res2 = nucleo.adquiere("LU0000000002", "fondo", _ctx(base), ADAPTADORES)
    assert "correcciones" not in res2.datos["meta"]
    assert res2.datos["riesgo"]["sri_kid_1a7"] == 5


def test_un_fichero_roto_no_tumba_la_ficha_pero_deja_aviso(tmp_path):
    base = _base(tmp_path)
    (base / "config" / "correcciones.json").write_text("{no es json", encoding="utf-8")
    res = nucleo.adquiere("LU0000000001", "fondo", _ctx(base), ADAPTADORES)
    assert res.datos["riesgo"]["sri_kid_1a7"] == 5
    assert any(e.startswith("correcciones:") for e in res.datos["meta"]["errores"])


def test_manual_no_cuenta_como_fuente_oficial_en_el_canonico():
    d = {"riesgo": {"sri_kid_1a7": 4}, "identificacion": {"nombre": "F"},
         "meta": {"procedencia": {"riesgo.sri_kid_1a7": "manual:oscar", "identificacion.nombre": "cssf:registro"},
                  "adquisicion": {"plan": ["cssf"], "fuentes": {}}}}
    canonico = {"regulatory": {"sri": 4}, "name": "F"}
    p = canonico_regulatorio.bloque_procedencia(d, canonico)
    assert p["fields"]["regulatory.sri"] == "manual:oscar"
    assert p["sources"]["manual"]["canonical_fields"] == 1
    assert p["dependency"]["regulatory_from_official_sources"] == 0


def test_campos_corregibles_de_una_ficha():
    ficha = {"identificacion": {"nombre": "F", "tipo": "fondo"}, "riesgo": {"sri_kid_1a7": 4},
             "cartera": {"posiciones": [{"a": 1}], "paises_pct": {"USA": 60.0}},
             "calidad": {"score": 80}, "meta": {"procedencia": {"riesgo.sri_kid_1a7": "manual:oscar"},
                                                "correcciones": {"riesgo.sri_kid_1a7": {"valor": 4, "redundante": False}}}}
    propias = {"riesgo.sri_kid_1a7": {"valor": 4, "motivo": "KID"}, "costes.ter_pct": {"valor": 1.2, "motivo": "folleto"}}
    filas = correcciones.campos(ficha, propias, ADAPTADORES)
    por_ruta = {f["ruta"]: f for f in filas}
    assert set(por_ruta) == {"identificacion.nombre", "riesgo.sri_kid_1a7", "costes.ter_pct"}  # tipo: config_csv, no declarada
    assert por_ruta["riesgo.sri_kid_1a7"]["valor"] == 4 and por_ruta["riesgo.sri_kid_1a7"]["fuente"] == "manual:oscar"
    assert por_ruta["riesgo.sri_kid_1a7"]["correccion"] == propias["riesgo.sri_kid_1a7"]
    assert por_ruta["riesgo.sri_kid_1a7"]["aplicada"] == {"valor": 4, "redundante": False}
    assert por_ruta["costes.ter_pct"]["valor"] is None and por_ruta["costes.ter_pct"]["aplicada"] is None
    assert por_ruta["identificacion.nombre"]["correccion"] is None and por_ruta["identificacion.nombre"]["tipo"] == "texto"


@pytest.fixture
def servidor(tmp_path, monkeypatch):
    base = _base(tmp_path)
    (base / "data" / "funds" / "LU0000000001.json").write_text(json.dumps({
        "identificacion": {"nombre": "Fondo Uno", "tipo": "fondo"}, "riesgo": {"sri_kid_1a7": 5},
        "meta": {"procedencia": {"riesgo.sri_kid_1a7": "cssf:kid", "identificacion.nombre": "cssf:registro"}}}), encoding="utf-8")
    from core.adquisicion import registro
    monkeypatch.setattr(registro, "ADAPTADORES", ADAPTADORES)
    srv = ops_server.crea_servidor(base, 0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield srv
    srv.shutdown()
    srv.server_close()


def test_el_servicio_registra_lista_y_retira_correcciones(servidor):
    estado, _c, datos = _pide(servidor, "POST", "/api/ops/correcciones",
                              {"isin": "LU0000000001", "ruta": "riesgo.sri_kid_1a7", "valor": "4", "motivo": "KID 2026-02", "autor": "Óscar"})
    assert estado == 200 and datos["ok"] is True
    assert datos["correccion"]["valor"] == 4 and datos["valor_actual"] == 5 and "extraer" in datos["siguiente"]

    estado, _c, datos = _pide(servidor, "POST", "/api/ops/correcciones",
                              {"isin": "LU0000000001", "ruta": "riesgo.sri_kid_1a7", "valor": "alto", "motivo": "KID"})
    assert estado == 400 and "numérico" in datos["error"]
    estado, _c, datos = _pide(servidor, "POST", "/api/ops/correcciones", {"isin": "LU0000000001", "ruta": "riesgo.sri_kid_1a7", "motivo": "x"})
    assert estado == 400 and "valor" in datos["error"]
    estado, _c, datos = _pide(servidor, "POST", "/api/ops/correcciones",
                              {"isin": "LU0000000001", "ruta": "riesgo.nada", "valor": 1, "motivo": "motivo"})
    assert estado == 400 and "declara" in datos["error"]

    estado, _c, datos = _pide(servidor, "GET", "/api/ops/correcciones/LU0000000001")
    assert estado == 200 and datos["con_ficha"] is True
    assert [c["ruta"] for c in datos["correcciones"]] == ["riesgo.sri_kid_1a7"]
    campo = next(f for f in datos["campos"] if f["ruta"] == "riesgo.sri_kid_1a7")
    assert campo["valor"] == 5 and campo["fuente"] == "cssf:kid" and campo["correccion"]["valor"] == 4 and campo["aplicada"] is None

    estado, _c, datos = _pide(servidor, "GET", "/api/ops/correcciones")
    assert estado == 200 and len(datos["correcciones"]) == 1 and "riesgo.sri_kid_1a7" in datos["rutas_declaradas"]

    estado, _c, datos = _pide(servidor, "GET", "/api/ops/ficha/LU0000000001")
    assert datos["ficha"]["correcciones"] == {"aplicadas": 0, "redundantes": []}

    estado, _c, datos = _pide(servidor, "DELETE", "/api/ops/correcciones/LU0000000001/riesgo.sri_kid_1a7")
    assert estado == 200 and datos["ok"] is True
    estado, _c, datos = _pide(servidor, "DELETE", "/api/ops/correcciones/LU0000000001/riesgo.sri_kid_1a7")
    assert estado == 404
    estado, _c, _d = _pide(servidor, "DELETE", "/api/ops/correcciones/LU0000000001")
    assert estado == 404
    assert _pide(servidor, "GET", "/api/ops/correcciones/MALO")[0] == 400
    assert _pide(servidor, "GET", "/api/ops/correcciones/LU0000000001")[2]["correcciones"] == []
