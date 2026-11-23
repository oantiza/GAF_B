# -*- coding: utf-8 -*-
"""
R-08 (auditoria 29-09-2026): `analyze_portfolio` encadenaba 4 modelos con 45 s
de timeout cada uno dentro de un callable de 60 s. Si el primer modelo colgaba,
el modal recibia DEADLINE_EXCEEDED sin llegar nunca al segundo modelo.

Ahora hay un presupuesto global (TOTAL_BUDGET_SEC) repartido entre intentos:
cada llamada recibe timeout = min(restante, PER_ATTEMPT_TIMEOUT_SEC), y cuando
el resto no da para nada se devuelve un error controlado en vez de colgar.

Run: `python -m pytest functions_python/tests/test_analyze_portfolio_budget.py -q`
"""
import ast
import json
import os
import sys
import time

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import analyze_portfolio  # noqa: E402

MAIN_PY = os.path.join(os.path.dirname(__file__), "..", "main.py")
REQUEST = {"positions": [{"asset_id": "FONDO", "weight": 1.0}]}
OK_BODY = json.dumps({"candidates": [{"content": {"parts": [{"text": "analisis"}]}}]}).encode("utf-8")


class _Respuesta:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def __init__(self, cuerpo=OK_BODY):
        self._pendiente = cuerpo

    def read(self, n=-1):
        # Como un socket: devuelve lo que queda y despues vacio.
        trozo, self._pendiente = self._pendiente, b""
        return trozo


def _modelo(request):
    return request.full_url.rsplit("/models/", 1)[1].split(":")[0]


def test_el_primer_modelo_cuelga_y_el_segundo_responde_dentro_del_presupuesto(monkeypatch):
    """Reloj simulado: cada urlopen 'consume' exactamente el timeout que recibe."""
    reloj = {"ahora": 0.0}
    llamadas = []

    def fake_urlopen(request, timeout=None):
        llamadas.append((_modelo(request), timeout))
        if _modelo(request) == "colgado":
            reloj["ahora"] += timeout
            raise TimeoutError("timed out")
        reloj["ahora"] += 3
        return _Respuesta()

    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setattr(analyze_portfolio, "_monotonic", lambda: reloj["ahora"])
    monkeypatch.setattr(analyze_portfolio.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(analyze_portfolio, "GEMINI_MODELS", ["colgado", "sano"])

    result = analyze_portfolio.analyze_portfolio(REQUEST)

    assert result["source"] == "GEMINI_LIVE"
    assert result["model"] == "sano"
    # Ningun intento supera el tope por intento ni el presupuesto total.
    assert llamadas[0] == ("colgado", analyze_portfolio.PER_ATTEMPT_TIMEOUT_SEC)
    assert all(t <= analyze_portfolio.PER_ATTEMPT_TIMEOUT_SEC for _, t in llamadas)
    assert reloj["ahora"] <= analyze_portfolio.TOTAL_BUDGET_SEC


def test_dos_modelos_colgados_agotan_el_presupuesto_con_error_controlado(monkeypatch):
    reloj = {"ahora": 0.0}
    llamadas = []

    def fake_urlopen(request, timeout=None):
        llamadas.append((_modelo(request), timeout))
        reloj["ahora"] += timeout
        raise TimeoutError("timed out")

    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setattr(analyze_portfolio, "_monotonic", lambda: reloj["ahora"])
    monkeypatch.setattr(analyze_portfolio.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(analyze_portfolio, "GEMINI_MODELS", ["a", "b", "c", "d"])

    result = analyze_portfolio.analyze_portfolio(REQUEST)

    assert result["source"] == "ERROR"
    assert result["analysis"] is None
    assert "presupuesto" in result["note"].lower()
    # 25 + 25 = 50 s: el tercer modelo ya no se intenta, y tampoco ListModels.
    assert [m for m, _ in llamadas] == ["a", "b"]
    assert sum(t for _, t in llamadas) <= analyze_portfolio.TOTAL_BUDGET_SEC


def test_el_ultimo_intento_recibe_solo_el_tiempo_restante(monkeypatch):
    reloj = {"ahora": 0.0}
    llamadas = []

    def fake_urlopen(request, timeout=None):
        llamadas.append(timeout)
        reloj["ahora"] += 20  # falla antes del timeout, con error de red
        raise ConnectionResetError("reset")

    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setattr(analyze_portfolio, "_monotonic", lambda: reloj["ahora"])
    monkeypatch.setattr(analyze_portfolio.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(analyze_portfolio, "GEMINI_MODELS", ["a", "b", "c"])
    monkeypatch.setattr(analyze_portfolio, "TOTAL_BUDGET_SEC", 50)
    monkeypatch.setattr(analyze_portfolio, "PER_ATTEMPT_TIMEOUT_SEC", 25)

    analyze_portfolio.analyze_portfolio(REQUEST)

    # t=0 -> 25; t=20 -> 25; t=40 -> quedan 10 s -> timeout 10.
    assert llamadas == [25, 25, 10]


def test_con_reloj_real_un_modelo_que_tarda_no_bloquea_al_siguiente(monkeypatch):
    """Mock que de verdad tarda: respeta el timeout que recibe, como un socket."""

    def fake_urlopen(request, timeout=None):
        if _modelo(request) == "lento":
            time.sleep(timeout)
            raise TimeoutError("timed out")
        return _Respuesta()

    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setattr(analyze_portfolio.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(analyze_portfolio, "GEMINI_MODELS", ["lento", "rapido"])
    monkeypatch.setattr(analyze_portfolio, "TOTAL_BUDGET_SEC", 0.6)
    monkeypatch.setattr(analyze_portfolio, "PER_ATTEMPT_TIMEOUT_SEC", 0.2)
    monkeypatch.setattr(analyze_portfolio, "MIN_ATTEMPT_SEC", 0.05)

    inicio = time.monotonic()
    result = analyze_portfolio.analyze_portfolio(REQUEST)
    transcurrido = time.monotonic() - inicio

    assert result["model"] == "rapido"
    assert transcurrido < 0.6


def test_un_403_sigue_cortando_sin_probar_mas_modelos(monkeypatch):
    llamadas = []

    def fake_generate(model, key, prompt, timeout=None):
        llamadas.append(model)
        return None, ("HTTP 403 Forbidden", 403)

    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setattr(analyze_portfolio, "_generate", fake_generate)
    monkeypatch.setattr(analyze_portfolio, "GEMINI_MODELS", ["a", "b"])

    result = analyze_portfolio.analyze_portfolio(REQUEST)

    assert result["source"] == "ERROR" and "403" in result["note"]
    assert llamadas == ["a"]


def test_el_callable_declara_un_timeout_que_cubre_el_presupuesto():
    """main.py: el decorador de analyze_portfolio debe dar margen al presupuesto
    (60 s por defecto era justo lo que colgaba al modal)."""
    with open(MAIN_PY, encoding="utf-8") as fh:
        tree = ast.parse(fh.read(), filename=MAIN_PY)
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "analyze_portfolio")
    decorador = next(d for d in fn.decorator_list if isinstance(d, ast.Call))
    kwargs = {kw.arg: kw.value for kw in decorador.keywords}
    timeout = kwargs.get("timeout_sec")
    assert timeout is not None, "analyze_portfolio no declara timeout_sec"
    assert ast.literal_eval(timeout) >= analyze_portfolio.TOTAL_BUDGET_SEC + 30


# --- Auditoria 20-11-2026 (P1-07, restos): respuesta vacia y plazo total de lectura ---------------------------------

VACIO_BODY = json.dumps({"candidates": [{"content": {"parts": [{"text": "  "}]}, "finishReason": "STOP"}]}).encode("utf-8")


def test_un_primer_modelo_que_contesta_vacio_deja_probar_el_siguiente(monkeypatch):
    def fake_urlopen(request, timeout=None):
        return _Respuesta(VACIO_BODY if _modelo(request) == "vacio" else OK_BODY)

    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setattr(analyze_portfolio.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(analyze_portfolio, "GEMINI_MODELS", ["vacio", "sano"])

    result = analyze_portfolio.analyze_portfolio(REQUEST)

    assert result["source"] == "GEMINI_LIVE" and result["model"] == "sano"


def test_si_todos_contestan_vacio_se_dice_que_fue_sin_texto(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setattr(analyze_portfolio.urllib.request, "urlopen", lambda request, timeout=None: _Respuesta(VACIO_BODY))
    monkeypatch.setattr(analyze_portfolio, "_discover_flash_model", lambda key, timeout=15: None)
    monkeypatch.setattr(analyze_portfolio, "GEMINI_MODELS", ["a", "b"])

    result = analyze_portfolio.analyze_portfolio(REQUEST)

    assert result["source"] == "EMPTY_RESPONSE" and result["analysis"] is None


def test_vacio_y_caida_juntos_son_un_error_no_una_respuesta_vacia(monkeypatch):
    def fake_urlopen(request, timeout=None):
        if _modelo(request) == "caido":
            raise ConnectionResetError("reset")
        return _Respuesta(VACIO_BODY)

    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setattr(analyze_portfolio.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(analyze_portfolio, "_discover_flash_model", lambda key, timeout=15: None)
    monkeypatch.setattr(analyze_portfolio, "GEMINI_MODELS", ["caido", "vacio"])

    assert analyze_portfolio.analyze_portfolio(REQUEST)["source"] == "ERROR"


class _Goteo:
    """Una respuesta que va soltando bytes sueltos: cada lectura cabe en el timeout del socket, el total no."""

    def __init__(self, reloj):
        self.reloj = reloj

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self, n=-1):
        self.reloj["ahora"] += 10  # cada lectura tarda 10 s: dentro del timeout de 25, pero se acumulan
        return b"x"


def test_una_respuesta_que_gotea_se_corta_en_el_plazo_total_y_se_pasa_al_siguiente(monkeypatch):
    reloj = {"ahora": 0.0}

    def fake_urlopen(request, timeout=None):
        return _Goteo(reloj) if _modelo(request) == "goteo" else _Respuesta()

    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setattr(analyze_portfolio, "_monotonic", lambda: reloj["ahora"])
    monkeypatch.setattr(analyze_portfolio.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(analyze_portfolio, "GEMINI_MODELS", ["goteo", "sano"])

    result = analyze_portfolio.analyze_portfolio(REQUEST)

    # Lecturas a t=0 (10), t=10 (20), t=20 (30): al pasar de 25 s corta, y quedan 20 s de los 50 para el segundo modelo.
    assert result["model"] == "sano"
    assert reloj["ahora"] == 30.0


def test_una_respuesta_gigante_se_rechaza(monkeypatch):
    class Gigante(_Respuesta):
        def read(self, n=-1):
            return b"x" * analyze_portfolio._READ_CHUNK

    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setattr(analyze_portfolio.urllib.request, "urlopen", lambda request, timeout=None: Gigante())
    monkeypatch.setattr(analyze_portfolio, "_discover_flash_model", lambda key, timeout=15: None)
    monkeypatch.setattr(analyze_portfolio, "GEMINI_MODELS", ["a"])

    result = analyze_portfolio.analyze_portfolio(REQUEST)

    assert result["source"] == "ERROR" and result["analysis"] is None
