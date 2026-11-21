# -*- coding: utf-8 -*-
"""
Analisis IA de cartera (equivalente al PortfolioAnalysisModal del legacy).
Llama a Gemini (REST) con un resumen de la cartera y devuelve un analisis breve
en espanol. Solo lectura. NUNCA lanza: cualquier fallo va en `note`.
Requiere env GEMINI_API_KEY (o GOOGLE_API_KEY). Sin clave -> source NOT_CONFIGURED.

Robusto ante deprecaciones de Google: prueba una lista de modelos vigentes y, si
todos devuelven 404 (modelo retirado / "shut down"), consulta ListModels y elige
dinamicamente un modelo flash que soporte generateContent. Asi un apagado de
modelo por parte de Google no vuelve a romper el analisis.
"""
import json
import math
import os
import re
import time
import urllib.error
import urllib.request

# El modal es interactivo, asi que la latencia sigue mandando aunque el coste
# no importe: gemini-3.8-flash con thinkingLevel high resuelve en 5-7 s
# (medido 10-09-2026 con 30 posiciones + contexto).
#
# R-08 (auditoria 29-09-2026): habia 45 s por intento x 4 modelos dentro de un
# callable de 60 s: si el primer modelo colgaba, el modal recibia
# DEADLINE_EXCEEDED sin llegar nunca al segundo. Ahora hay un presupuesto
# global por peticion y cada intento recibe timeout = min(restante, tope):
# con 50 s caben dos modelos colgados y aun queda margen para devolver un
# error controlado. El callable declara timeout_sec=120 en main.py para que
# el frontend reciba siempre respuesta o error, nunca un corte del runtime.
TOTAL_BUDGET_SEC = 50
PER_ATTEMPT_TIMEOUT_SEC = 25
# Por debajo de esto no merece la pena abrir otra conexion.
MIN_ATTEMPT_SEC = 2
_monotonic = time.monotonic
# MEDIA-7 (14-10-2026): aqui habia un socket.setdefaulttimeout() al importar el modulo,
# que cambiaba el timeout de TODO el proceso (Firestore incluido). Cada peticion lleva
# ya su propio `timeout=` (_generate y _discover_flash_model).

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
# Orden de preferencia (mas barato/rapido primero). `*-latest` se auto-actualiza
# con cada release de Google (rotado con aviso de 2 semanas), de modo que sirve
# de red de seguridad si un modelo estable concreto es retirado.
# Ola 09-2026: aqui la latencia sigue contando (es un modal, no un batch), asi
# que se busca el mejor modelo *de respuesta rapida*, no el mejor en absoluto.
# Medido contra la API el 10-09-2026 con 30 posiciones + contexto agregado:
#   gemini-3.8-flash  thinkingLevel high -> 5-7 s   (calidad y velocidad)
#   gemini-2.5-flash  sin thinkingConfig -> 8-9 s   (lo que habia)
# El Pro (gemini-3.1-pro-preview) razona mas pero tarda 13-17 s: inaceptable
# para un modal, y por encima del antiguo timeout de 20 s.
# Nota historica (S6b, auditoria 27-07): "gemini-3.5-flash" se retiro de esta
# lista por no existir entonces. Hoy si existe, pero 3.8 lo supera y lo cubre
# igualmente "gemini-flash-latest".
GEMINI_MODELS = [
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-flash-latest",
    "gemini-2.5-flash",
]


# Hallazgo 24 (auditoria 15-11-2026): el nombre de una posicion puede venir de un
# fichero de banco importado. Entra en la peticion acotado y limpio: un nombre
# largo encarece la llamada y uno con saltos de linea o instrucciones dentro
# podia alterar el resultado.
MAX_LABEL_CHARS = 80
MAX_POSITIONS = 30
MAX_CONTEXT_CHARS = 1500
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f-\x9f  ]+")


def _clean_label(value):
    """Una sola linea, sin caracteres de control y de 80 caracteres como mucho."""
    text = _CONTROL_CHARS.sub(" ", str(value))
    text = " ".join(text.split())
    return text[:MAX_LABEL_CHARS].rstrip()


def _context_for_prompt(context):
    """Devuelve (texto|None, campos_que_no_cupieron).

    Cada campo entra entero o no entra: antes `json.dumps(...)[:1500]` partia el
    ultimo a mitad y descartaba el resto sin avisar.
    """
    if not isinstance(context, dict) or not context:
        return None, []
    kept = {}
    omitted = []
    for key, value in context.items():
        candidate = dict(kept)
        candidate[key] = value
        if len(json.dumps(candidate, ensure_ascii=False)) <= MAX_CONTEXT_CHARS:
            kept = candidate
        else:
            omitted.append(str(key))
    text = json.dumps(kept, ensure_ascii=False) if kept else None
    return text, omitted


def _build_prompt_parts(positions, context):
    lines = [
        "Eres un analista de inversiones. Analiza esta cartera multi-activo de forma breve y profesional, en espanol.",
        "Entrega: 1) diagnostico de diversificacion y riesgo; 2) 2-3 fortalezas/debilidades; 3) 1-2 sugerencias accionables.",
        "Maximo ~180 palabras. No inventes datos que no aparezcan aqui.",
        "",
        "Posiciones (peso %):",
    ]
    for p in positions[:MAX_POSITIONS]:
        name = _clean_label((p or {}).get("label") or (p or {}).get("asset_id"))
        weight = (p or {}).get("weight")
        # Callable weights are fractions, matching the portfolio request contract.
        pct = f"{weight * 100:.6f}".rstrip("0").rstrip(".") if isinstance(weight, (int, float)) and not isinstance(weight, bool) and math.isfinite(weight) and 0 <= weight <= 1 else "N/D"
        lines.append("- {}: {}{}".format(name, pct, " %" if pct != "N/D" else ""))
    context_text, omitted = _context_for_prompt(context)
    if context_text:
        lines.append("")
        lines.append("Contexto agregado: " + context_text)
    return "\n".join(lines), omitted


def _build_prompt(positions, context):
    return _build_prompt_parts(positions, context)[0]


def _generate(model, key, prompt, timeout=PER_ATTEMPT_TIMEOUT_SEC):
    """Llama generateContent en un modelo. Devuelve (texto|None, (msg, code)|None)."""
    generation_config = {
        # Gemini 3 esta calibrado para temperature=1.0 y Google desaconseja
        # bajarla. El 0.4 de antes venia de la epoca 2.5.
        "temperature": 1.0,
        # maxOutputTokens es el presupuesto conjunto de razonamiento y
        # respuesta. Con 2048 el analisis cabia por poco (1.000-1.500 tokens
        # de pensamiento + ~350 de texto): una cartera algo mayor lo habria
        # cortado con MAX_TOKENS y devuelto un analisis vacio.
        "maxOutputTokens": 8192,
    }
    # `thinkingLevel` lo aceptan 3.x y los alias `*-latest`; la familia 2.5 lo
    # rechaza con HTTP 400 y solo entiende `thinkingBudget`. Sin configurar
    # nada, 2.5 ya piensa por defecto, que es como venia funcionando.
    if not model.startswith("gemini-2.5"):
        generation_config["thinkingConfig"] = {"thinkingLevel": "high"}
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": generation_config,
    }).encode("utf-8")
    # La clave va en cabecera, no en la query string (las URLs acaban en logs
    # intermedios); mismo criterio que weekly_report.py.
    url = "{}/models/{}:generateContent".format(GEMINI_BASE, model)
    req = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return None, ("HTTP {} {}".format(exc.code, exc.reason), exc.code)
    except Exception as exc:  # noqa: BLE001
        return None, (str(exc), None)
    text = ""
    cands = data.get("candidates") or []
    # Una respuesta cortada (MAX_TOKENS, SAFETY...) acaba a media frase: no se sirve
    # como buena. Se trata como un fallo del modelo y la cascada prueba el siguiente.
    finish = cands[0].get("finishReason") if cands and isinstance(cands[0], dict) else None
    if finish not in (None, "STOP"):
        return None, ("respuesta incompleta ({})".format(finish), None)
    for cand in cands:
        for part in ((cand.get("content") or {}).get("parts") or []):
            if isinstance(part.get("text"), str):
                text += part["text"]
    return (text.strip() or None), None


def _discover_flash_model(key, timeout=15):
    """Ultimo recurso: pregunta a Google que modelos hay y elige un flash valido."""
    url = "{}/models".format(GEMINI_BASE)
    try:
        request = urllib.request.Request(url, headers={"x-goog-api-key": key})
        with urllib.request.urlopen(request, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception:  # noqa: BLE001
        return None
    best = None
    best_score = -1
    for m in (data.get("models") or []):
        methods = m.get("supportedGenerationMethods") or []
        if "generateContent" not in methods:
            continue
        name = (m.get("name") or "").replace("models/", "")
        low = name.lower()
        if any(bad in low for bad in ("tts", "image", "embedding", "live", "vision", "robotics")):
            continue
        score = 0
        if "flash" in low:
            score += 10
        if "lite" in low:
            score += 1
        if "exp" in low or "preview" in low or "thinking" in low:
            score -= 3
        # Antes habia una lista fija de versiones ("3.5", "3.1", ...): cualquier
        # modelo mas nuevo que la lista puntuaba 0 y perdia contra uno viejo
        # -- justo el fallo que este descubridor existe para evitar. Ahora la
        # version se lee del nombre, asi que 3.8 gana a 3.5 sin tocar codigo.
        version = re.search(r"gemini-(\d+(?:\.\d+)?)", low)
        if version:
            score += float(version.group(1)) * 2
        if score > best_score:
            best_score = score
            best = name
    return best


def analyze_portfolio(request):
    if not isinstance(request, dict):
        return {"analysis": None, "source": "INVALID", "note": "request invalido"}
    positions = request.get("positions") or []
    if not positions:
        return {"analysis": None, "source": "EMPTY", "note": "sin posiciones"}
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        return {
            "analysis": None,
            "source": "NOT_CONFIGURED",
            "note": "Falta GEMINI_API_KEY en el entorno de Functions.",
        }

    prompt, omitted_context = _build_prompt_parts(positions, request.get("context"))
    tried = []
    deadline = _monotonic() + TOTAL_BUDGET_SEC

    def _remaining():
        return deadline - _monotonic()

    def _live(text, model):
        result = {"analysis": text, "model": model, "source": "GEMINI_LIVE"}
        if omitted_context:
            # Aditivo: los campos del contexto agregado que no cupieron en la peticion.
            result["context_omitted"] = omitted_context
        return result

    def _budget_exhausted(stage):
        return {"analysis": None, "source": "ERROR",
                "note": "Gemini: presupuesto de tiempo agotado ({} s) {}. Intentos: {}".format(
                    TOTAL_BUDGET_SEC, stage, " | ".join(tried) or "ninguno")}

    # 1) Lista priorizada de modelos vigentes; salta los retirados (404/400) y
    #    los que no responden a tiempo o estan saturados (red, 429, 5xx).
    for model in GEMINI_MODELS:
        remaining = _remaining()
        if remaining < MIN_ATTEMPT_SEC:
            return _budget_exhausted("antes de probar {}".format(model))
        text, err = _generate(model, key, prompt, timeout=min(remaining, PER_ATTEMPT_TIMEOUT_SEC))
        if text:
            return _live(text, model)
        if err is None:
            return {"analysis": None, "source": "EMPTY_RESPONSE",
                    "note": "Gemini ({}) respondio sin texto.".format(model)}
        msg, code = err
        tried.append("{} -> {}".format(model, msg))
        # 404/400 = modelo no valido o retirado -> probar el siguiente.
        # None (timeout/red) o 429/5xx = ese modelo no vale AHORA -> siguiente,
        # sin reintento: es un modal y la latencia manda (mismo criterio que
        # la cascada de weekly_report.py, B-03).
        # Otros codigos (401/403 clave invalida) -> no insistir.
        if code in (404, 400) or code is None or code in (429, 500, 502, 503, 504):
            continue
        return {"analysis": None, "source": "ERROR",
                "note": "Gemini: {} (modelo {}).".format(msg, model)}

    # 2) Red de seguridad: todos los conocidos fallaron -> descubrir uno.
    remaining = _remaining()
    if remaining < MIN_ATTEMPT_SEC:
        return _budget_exhausted("tras la lista de modelos")
    discovered = _discover_flash_model(key, timeout=min(remaining, 15))
    if discovered and discovered not in GEMINI_MODELS:
        remaining = _remaining()
        if remaining < MIN_ATTEMPT_SEC:
            return _budget_exhausted("antes de probar {}".format(discovered))
        text, err = _generate(discovered, key, prompt, timeout=min(remaining, PER_ATTEMPT_TIMEOUT_SEC))
        if text:
            return _live(text, discovered)
        if err is not None:
            tried.append("{} -> {}".format(discovered, err[0]))

    return {"analysis": None, "source": "ERROR",
            "note": "Ningun modelo Gemini disponible. Intentos: " + " | ".join(tried)}
