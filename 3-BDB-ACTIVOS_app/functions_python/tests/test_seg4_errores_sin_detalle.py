"""SEG-4 (auditoria integral del 16-11-2026): ni excepciones crudas al cliente, ni errores internos por una entrada mal tipada.

Dos sitios:

- `get_weekly_report` devolvia en `note` el `str()` de cualquier excepcion: lo que dijera una libreria o una ruta
  interna llegaba al navegador. Ahora la nota es una frase fija y el detalle se queda en el registro.
- `validate_request` del optimizador hacia `float()` sobre `min_weight` y `max_weight`: un texto o un `null` salian
  como error interno en vez de como una peticion mal escrita.
"""
import logging
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import weekly_report  # noqa: E402
from optimization.repository import InvalidOptimizationRequest, validate_request  # noqa: E402

SECRETO = "/srv/interno/clave-de-servicio.json: permiso denegado"


class BaseQueFalla:
    """Una base cuyo primer paso revienta con un mensaje que no debe salir de aqui."""

    def collection(self, _nombre):
        raise RuntimeError(SECRETO)


def test_la_nota_del_informe_no_lleva_el_texto_de_la_excepcion(caplog):
    with caplog.at_level(logging.ERROR, logger="bdb.weekly_report"):
        respuesta = weekly_report.get_weekly_report({"type": "WEEKLY_REPORT"}, db=BaseQueFalla())
    assert respuesta["source"] == "ERROR" and respuesta["report"] is None
    assert respuesta["note"] == "No se ha podido leer el informe. Reinténtalo en unos minutos."
    assert SECRETO not in str(respuesta)
    # El detalle no se pierde: esta en el registro, que es donde lo lee quien mantiene esto.
    assert SECRETO in caplog.text
    assert "RuntimeError" in caplog.text


def peticion(**restricciones):
    return {
        "schema_version": "portfolio-optimization-request.v1",
        "asset_ids": ["A", "B", "C"],
        "window": "3Y",
        "base_currency": "EUR",
        "frequency": "WEEKLY",
        "objective": "MAX_SHARPE",
        "frontier_points": 7,
        "constraints": {"long_only": True, "fully_invested": True, **restricciones},
    }


@pytest.mark.parametrize("campo", ["min_weight", "max_weight"])
@pytest.mark.parametrize("valor", ["abc", "0.2", None, [0.2], {"v": 0.2}, True, float("nan"), float("inf")])
def test_un_peso_que_no_es_un_numero_es_una_peticion_invalida_y_no_un_error_interno(campo, valor):
    # `None` solo cuenta si la clave viene escrita: sin ella vale el defecto, y eso se prueba abajo.
    with pytest.raises(InvalidOptimizationRequest, match=f"{campo} must be a finite decimal"):
        validate_request(peticion(**{campo: valor}))


def test_los_pesos_validos_siguen_pasando_y_los_que_no_cuadran_siguen_diciendo_por_que():
    # Tres activos con un maximo del 50 %: cabe (3 x 0,5 = 1,5 >= 1). Con el 20 % no llegan al 100 % (3 x 0,2 = 0,6).
    assert validate_request(peticion(min_weight=0.1, max_weight=0.5)) is not None
    assert validate_request(peticion()) is not None  # sin escribirlos: 0 y 1
    assert validate_request(peticion(min_weight=0, max_weight=1)) is not None  # enteros
    with pytest.raises(InvalidOptimizationRequest, match="no llegan al 100"):
        validate_request(peticion(max_weight=0.2))
    with pytest.raises(InvalidOptimizationRequest, match="Invalid min_weight/max_weight"):
        validate_request(peticion(min_weight=0.6, max_weight=0.5))
