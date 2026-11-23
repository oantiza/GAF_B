import json
import os
import sys
from datetime import datetime, timezone

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import weekly_report  # noqa: E402


def valid_report(report_type="WEEKLY_REPORT", date="2026-07-10T07:00:00Z"):
    prefix = weekly_report.REPORT_CONFIG[report_type]["prefix"]
    return {
        "schema_version": "strategy-report.v2",
        "type": report_type,
        "id": f"{prefix}-2026-07-10",
        "date": date,
        "author": "Comite de Inversiones",
        "provider": "Gemini con Google Search",
        "summary": {
            "headline": "Tipos estables, seleccion activa",
            "narrative": "El entorno exige equilibrio entre carry y crecimiento. La cartera mantiene diversificacion y liquidez tactica suficiente para responder a nuevos datos.",
            "keyEvents": [
                "El BCE mantuvo sus tipos oficiales en la reunion de julio.",
                "La inflacion estadounidense modero su ritmo durante el ultimo mes.",
                "Los mercados esperan nuevos datos de actividad en la proxima semana.",
            ],
            "kpis": [
                {"label": "Euro Stoxx", "value": "+1,2% semanal", "trend": "up"},
                {"label": "Bund 10A", "value": "2,6%", "trend": "neutral"},
                {"label": "VIX", "value": "15,4", "trend": "down"},
            ],
            "marketTemperature": "Neutral",
            "tailRisks": [
                {"risk": "Repunte inesperado de inflacion", "probability": "Media", "impact": "Alto"},
                {"risk": "Deterioro brusco del crecimiento", "probability": "Baja", "impact": "Alto"},
            ],
        },
        "assetAllocation": {
            "overview": "Escenario de asignacion equilibrada, con duracion moderada y una reserva de liquidez para aprovechar episodios de volatilidad.",
            "classes": [
                {"assetClass": "Renta Variable", "strategicWeight": 45, "tacticalWeight": 43, "view": "Neutral", "rationale": "Seleccion por calidad."},
                {"assetClass": "Renta Fija", "strategicWeight": 40, "tacticalWeight": 42, "view": "Positiva", "rationale": "Carry atractivo."},
                {"assetClass": "Liquidez", "strategicWeight": 5, "tacticalWeight": 8, "view": "Positiva", "rationale": "Flexibilidad tactica."},
                {"assetClass": "Alternativos", "strategicWeight": 10, "tacticalWeight": 7, "view": "Neutral", "rationale": "Diversificacion."},
            ],
            "regionsEquity": [
                {"region": "EEUU", "weight": 50, "view": "Neutral", "rationale": "Beneficios resistentes."},
                {"region": "Europa", "weight": 25, "view": "Positiva", "rationale": "Valoracion relativa."},
                {"region": "Emergentes", "weight": 15, "view": "Neutral", "rationale": "Seleccion necesaria."},
                {"region": "Japon", "weight": 10, "view": "Neutral", "rationale": "Reformas corporativas."},
            ],
            "regionsFixedIncome": [
                {"region": "Gobierno", "weight": 50, "view": "Positiva", "rationale": "Duracion moderada."},
                {"region": "Credito IG", "weight": 35, "view": "Neutral", "rationale": "Spreads ajustados."},
                {"region": "High Yield", "weight": 15, "view": "Negativa", "rationale": "Prima limitada."},
            ],
            "sectors": [
                {"sector": "Tecnologia", "weight": 35, "view": "Neutral"},
                {"sector": "Financieros", "weight": 35, "view": "Positiva"},
                {"sector": "Defensivos", "weight": 30, "view": "Neutral"},
            ],
        },
        "fullReport": {"narrative": "### Contexto\n\n" + "analisis prudente y fundamentado " * 100},
        "sources": [
            {"title": "Banco Central Europeo", "url": "https://www.ecb.europa.eu/"},
            {"title": "Federal Reserve", "url": "https://www.federalreserve.gov/"},
        ],
        "generation": {
            "generated_at": date,
            "grounded": True,
            "research_model": "research-model",
            "report_model": "report-model",
            "source_count": 2,
        },
    }


class Snapshot:
    def __init__(self, value):
        self.value = value

    def to_dict(self):
        return self.value


class Document:
    def __init__(self, collection, document_id):
        self.collection = collection
        self.document_id = document_id

    def set(self, value):
        self.collection.writes[self.document_id] = value


class Collection:
    def __init__(self, values=None):
        self.values = values or []
        self.writes = {}

    def stream(self):
        return [Snapshot(value) for value in self.values]

    def where(self, **_kwargs):
        return self

    def order_by(self, *_args, **_kwargs):
        self.values.sort(key=lambda value: str(value.get("date") or ""), reverse=True)
        return self

    def limit(self, value):
        self.values = self.values[:value]
        return self

    def document(self, document_id):
        return Document(self, document_id)


class Database:
    def __init__(self, values=None):
        self.reports = Collection(values)

    def collection(self, name):
        assert name == weekly_report.REPORTS_COLLECTION
        return self.reports


def test_validation_accepts_complete_report_and_rejects_bad_weights():
    report = valid_report()
    assert weekly_report.validate_weekly_report(report, require_sources=True)["id"] == report["id"]

    report["assetAllocation"]["classes"][0]["tacticalWeight"] = 20
    with pytest.raises(weekly_report.WeeklyReportValidationError, match="sumar aproximadamente 100"):
        weekly_report.validate_weekly_report(report, require_sources=True)


def test_reader_returns_latest_valid_report_and_marks_stale():
    invalid = valid_report(date="2026-07-11T07:00:00Z")
    invalid["summary"]["marketTemperature"] = "Optimista"
    older = valid_report(date="2026-06-25T07:00:00Z")
    db = Database([invalid, older])

    result = weekly_report.get_weekly_report(
        {"type": "WEEKLY_REPORT"},
        db=db,
        now=datetime(2026, 7, 10, tzinfo=timezone.utc),
    )

    assert result["report"]["date"] == "2026-06-25T07:00:00Z"
    assert result["freshness"] == "STALE"
    assert result["age_days"] == 15
    assert result["invalid_count"] == 1


def test_extract_sources_deduplicates_grounding_chunks():
    payload = {
        "candidates": [{
            "groundingMetadata": {
                "groundingChunks": [
                    {"web": {"title": "ECB", "uri": "https://ecb.europa.eu/a"}},
                    {"web": {"title": "ECB repeated", "uri": "https://ecb.europa.eu/a"}},
                    {"web": {"title": "Fed", "uri": "https://federalreserve.gov/b"}},
                ]
            }
        }]
    }

    assert weekly_report._extract_sources(payload) == [
        {"title": "ECB", "url": "https://ecb.europa.eu/a"},
        {"title": "Fed", "url": "https://federalreserve.gov/b"},
    ]


def test_generation_fallback_skips_truncated_response(monkeypatch):
    payloads = [
        {"candidates": [{"finishReason": "MAX_TOKENS", "content": {"parts": [{"text": "{truncated"}]}}]},
        {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "complete"}]}}]},
    ]

    monkeypatch.setattr(weekly_report, "REPORT_MODELS", ("first", "second"))
    monkeypatch.setattr(weekly_report, "_generate_content", lambda *args, **kwargs: payloads.pop(0))

    text, _, model = weekly_report._generate_with_fallback(
        "key", "prompt", grounded=False, json_output=True
    )

    assert text == "complete"
    assert model == "second"


def test_generation_overrides_identity_and_attaches_grounding(monkeypatch):
    report = valid_report()
    report.pop("sources")
    calls = []

    def fake_generate(api_key, prompt, *, grounded, json_output, deadline=None, accept_until=None):
        calls.append((grounded, json_output))
        if grounded:
            payload = {
                "candidates": [{"groundingMetadata": {"groundingChunks": [
                    {"web": {"title": "ECB", "uri": "https://ecb.europa.eu/a"}},
                    {"web": {"title": "Fed", "uri": "https://federalreserve.gov/b"}},
                ]}}]
            }
            return "Investigacion actual y contrastada", payload, "research-model"
        return json.dumps(report), {}, "report-model"

    monkeypatch.setattr(weekly_report, "_generate_with_fallback", fake_generate)

    generated = weekly_report.generate_strategy_report(
        "WEEKLY_REPORT",
        api_key="test-key",
        now=datetime(2026, 7, 10, 7, 15, tzinfo=timezone.utc),
    )

    assert calls == [(True, False), (False, True)]
    assert generated["id"] == "weekly-2026-07-10"
    assert generated["date"] == "2026-07-10T07:15:00Z"
    assert generated["author"] == "Redacción automática (IA)"
    assert generated["generation"]["grounded"] is True
    assert generated["generation"]["source_count"] == 2


def test_the_report_id_and_prompts_use_the_madrid_day_like_the_publication_slot(monkeypatch):
    """22:30 UTC del 9-jul es la 00:30 del 10-jul en Madrid (CEST, UTC+2): `report_publication` abre el cerrojo y el
    documento `weekly-2026-07-10`, y el informe generado a esa hora no puede salir con el id ni la fecha de referencia del 9."""
    report = valid_report()
    prompts = []

    def fake_generate(api_key, prompt, *, grounded, json_output, deadline=None, accept_until=None):
        prompts.append(prompt)
        if grounded:
            payload = {"candidates": [{"groundingMetadata": {"groundingChunks": [
                {"web": {"title": "ECB", "uri": "https://ecb.europa.eu/a"}},
                {"web": {"title": "Fed", "uri": "https://federalreserve.gov/b"}},
            ]}}]}
            return "Investigacion actual y contrastada", payload, "research-model"
        return json.dumps(report), {}, "report-model"

    monkeypatch.setattr(weekly_report, "_generate_with_fallback", fake_generate)

    generated = weekly_report.generate_strategy_report(
        "WEEKLY_REPORT", api_key="test-key", now=datetime(2026, 7, 9, 22, 30, tzinfo=timezone.utc))

    assert generated["id"] == "weekly-2026-07-10"
    assert generated["date"] == "2026-07-09T22:30:00Z"  # el instante real sigue siendo UTC
    assert all("2026-07-10" in p and "2026-07-09" not in p for p in prompts)


def test_publish_writes_only_the_validated_report(monkeypatch):
    report = valid_report()
    from atomic_firestore_fake import Database as AtomicDatabase
    db = AtomicDatabase()
    monkeypatch.setattr(weekly_report, "generate_strategy_report", lambda *args, **kwargs: report)

    result = weekly_report.publish_strategy_report("WEEKLY_REPORT", db=db, now=datetime(2026, 7, 10, 7, tzinfo=timezone.utc))

    assert result["status"] == "PUBLISHED"
    assert db.values[weekly_report.REPORTS_COLLECTION + "/" + report["id"]] == report


def test_validate_weekly_report_sin_deepcopy_devuelve_el_mismo_objeto():
    """Ola 3b (T6h): deep_copy=False valida sin copiar (bucle de candidatos);
    el contrato por defecto (devolver copia) se mantiene intacto."""
    raw = valid_report()

    validated_default = weekly_report.validate_weekly_report(raw, expected_type="WEEKLY_REPORT")
    assert validated_default is not raw, "por defecto sigue devolviendo una copia"
    assert validated_default == raw

    validated_fast = weekly_report.validate_weekly_report(raw, expected_type="WEEKLY_REPORT", deep_copy=False)
    assert validated_fast is raw, "deep_copy=False no copia el informe"


# --------------------------------------------------------------------------- #
# strategy-report.v3: el diario es un brief de mercado y no lleva asignacion.   #
# --------------------------------------------------------------------------- #

def _narrative(words: int) -> str:
    """Narrativa sintetica con el numero exacto de palabras pedido."""
    frase = "El mercado descuenta el dato publicado esta manana con calma aparente"
    palabras = (frase.split() * ((words // len(frase.split())) + 1))[:words]
    cabecera = "### Cierre y lectura de la sesion" + chr(10) + chr(10)
    return cabecera + " ".join(palabras)


def valid_daily_report(date="2026-07-10T07:00:00Z"):
    report = valid_report("DAILY_REPORT", date=date)
    report.pop("assetAllocation", None)
    report["author"] = "Mesa de Analisis"
    report["fullReport"] = {"narrative": _narrative(300)}
    return report


@pytest.mark.parametrize("tipo", ["DAILY_REPORT", "WEEKLY_REPORT"])
def test_firma_lo_que_es_una_redaccion_automatica(tipo):
    """Decision 21: ni mesa de analisis ni comite de inversiones, que no existen. Con sus tildes."""
    assert weekly_report.REPORT_CONFIG[tipo]["author"] == "Redacción automática (IA)"
    prompt = weekly_report._report_prompt(tipo, weekly_report._as_utc(None), "base")
    assert '"author": "Redacción automática (IA)"' in prompt
    assert "Mesa de Analisis" not in prompt and "Comite de Inversiones" not in prompt


def test_daily_report_valido_sin_asignacion():
    report = weekly_report.validate_weekly_report(valid_daily_report(), expected_type="DAILY_REPORT")
    assert "assetAllocation" not in report
    assert report["id"] == "daily-2026-07-10"


def test_daily_report_descarta_una_asignacion_colada_por_el_modelo():
    """El modelo puede devolverla igualmente; se descarta en vez de validarla."""
    report = valid_daily_report()
    report["assetAllocation"] = {"overview": "media", "classes": []}
    validated = weekly_report.validate_weekly_report(report, expected_type="DAILY_REPORT")
    assert "assetAllocation" not in validated


def test_weekly_report_sigue_exigiendo_asignacion():
    report = valid_report("WEEKLY_REPORT")
    report.pop("assetAllocation")
    with pytest.raises(weekly_report.WeeklyReportValidationError):
        weekly_report.validate_weekly_report(report, expected_type="WEEKLY_REPORT")


def test_narrativa_del_diario_acotada_por_su_propio_rango():
    """Una narrativa de tamano semanal no vale como diario.

    Se usan palabras cortas a proposito: asi el texto se pasa del limite de
    palabras del diario sin pasarse del de caracteres, y lo que salta es el
    rango por tipo, no el tope generico de longitud.
    """
    report = valid_daily_report()
    cabecera = "### Cierre y lectura de la sesion" + chr(10) + chr(10)
    report["fullReport"] = {"narrative": cabecera + " ".join(["dato"] * 500)}
    with pytest.raises(weekly_report.WeeklyReportValidationError) as exc:
        weekly_report.validate_weekly_report(report, expected_type="DAILY_REPORT")
    assert "180" in str(exc.value) and "460" in str(exc.value)


def test_una_narrativa_diaria_de_tamano_semanal_cabe_en_el_semanal():
    """El mismo texto que el diario rechaza es valido como informe semanal."""
    report = valid_report("WEEKLY_REPORT")
    report["fullReport"] = {"narrative": _narrative(700)}
    assert weekly_report.validate_weekly_report(report, expected_type="WEEKLY_REPORT")


def test_monthly_report_ya_no_es_un_tipo_valido():
    report = valid_report("WEEKLY_REPORT")
    report["type"] = "MONTHLY_REPORT"
    with pytest.raises(weekly_report.WeeklyReportValidationError):
        weekly_report.validate_weekly_report(report)


def test_la_cascada_fundamentada_descarta_un_modelo_que_no_busco(monkeypatch):
    """Texto impecable pero sin fuentes: se prueba el siguiente modelo."""
    sin_fuentes = {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "de memoria"}]}}]}
    con_fuentes = {
        "candidates": [{
            "finishReason": "STOP",
            "content": {"parts": [{"text": "investigado"}]},
            "groundingMetadata": {"groundingChunks": [
                {"web": {"title": "BCE", "uri": "https://ecb.europa.eu/a"}},
                {"web": {"title": "Fed", "uri": "https://federalreserve.gov/b"}},
            ]},
        }]
    }
    payloads = [sin_fuentes, con_fuentes]
    monkeypatch.setattr(weekly_report, "RESEARCH_MODELS", ("de-memoria", "buscador"))
    monkeypatch.setattr(weekly_report, "_generate_content", lambda *a, **k: payloads.pop(0))

    text, _, model = weekly_report._generate_with_fallback(
        "key", "prompt", grounded=True, json_output=False
    )

    assert text == "investigado"
    assert model == "buscador"


# ---------------------------------------------------------------------------
# B-03 (auditoria 29-09-2026): la cascada de modelos se abortaba ante 429/5xx
# y ante un timeout de red; solo 400/404 pasaban al siguiente modelo. Un 503
# puntual en el primer modelo tumbaba todo el informe sin probar el resto.
# ---------------------------------------------------------------------------

OK_PAYLOAD = {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "completo"}]}}]}


def _http_error(model, code, detail="overloaded"):
    err = weekly_report.WeeklyReportError(f"Gemini {model}: HTTP {code}. {detail}")
    err.status_code = code
    return err


def _sin_esperas(monkeypatch):
    """Anula el reintento corto y fija un reloj controlable desde el test."""
    esperas = []
    reloj = {"ahora": 1000.0}
    monkeypatch.setattr(weekly_report, "_sleep", lambda s: esperas.append(s))
    monkeypatch.setattr(weekly_report, "_monotonic", lambda: reloj["ahora"])
    return esperas, reloj


def test_un_503_reintenta_una_vez_y_pasa_al_siguiente_modelo(monkeypatch):
    esperas, _ = _sin_esperas(monkeypatch)
    llamadas = []

    def fake_generate(model, *a, **k):
        llamadas.append(model)
        if model == "saturado":
            raise _http_error(model, 503)
        return OK_PAYLOAD

    monkeypatch.setattr(weekly_report, "REPORT_MODELS", ("saturado", "sano"))
    monkeypatch.setattr(weekly_report, "_generate_content", fake_generate)

    text, _, model = weekly_report._generate_with_fallback("key", "prompt", grounded=False, json_output=True)

    assert (text, model) == ("completo", "sano")
    # Un reintento corto con el mismo modelo antes de ceder el turno.
    assert llamadas == ["saturado", "saturado", "sano"]
    assert esperas == [weekly_report.TRANSIENT_RETRY_DELAY_SEC]


def test_slow_research_model_leaves_time_for_an_alternative(monkeypatch):
    esperas,reloj=_sin_esperas(monkeypatch)
    calls=[]
    payload=json.loads(json.dumps(OK_PAYLOAD))
    payload['candidates'][0]['groundingMetadata']={'groundingChunks':[
        {'web':{'uri':'https://www.ecb.europa.eu/','title':'ECB'}},
        {'web':{'uri':'https://www.federalreserve.gov/','title':'Fed'}}]}
    def generate(model,*args,timeout,**kwargs):
        calls.append(model)
        if model=='slow':
            reloj['ahora']+=timeout
            raise _red_lenta(model)
        reloj['ahora']+=20
        return payload
    monkeypatch.setattr(weekly_report,'RESEARCH_MODELS',('slow','available'))
    monkeypatch.setattr(weekly_report,'_generate_content',generate)
    assert weekly_report._generate_with_fallback('key','prompt',grounded=True,json_output=False,
                                               deadline=reloj['ahora']+270)[2]=='available'
    assert calls==['slow','available'] and esperas==[]


@pytest.mark.parametrize("code", [429, 500, 502, 504])
def test_los_demas_codigos_transitorios_tambien_ceden_el_turno(monkeypatch, code):
    _sin_esperas(monkeypatch)
    payloads = [_http_error("a", code), _http_error("a", code), OK_PAYLOAD]

    def fake_generate(*a, **k):
        item = payloads.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    monkeypatch.setattr(weekly_report, "REPORT_MODELS", ("a", "b"))
    monkeypatch.setattr(weekly_report, "_generate_content", fake_generate)

    assert weekly_report._generate_with_fallback("key", "p", grounded=False, json_output=True)[2] == "b"


def test_un_timeout_de_red_pasa_al_siguiente_modelo(monkeypatch):
    """El timeout no lleva status_code: antes se relanzaba tal cual."""
    _sin_esperas(monkeypatch)
    llamadas = []

    def fake_post(url, **kwargs):
        modelo = url.rsplit("/models/", 1)[1].split(":")[0]
        llamadas.append(modelo)
        if modelo == "lento":
            raise weekly_report.curl_errors.Timeout("timed out")
        response = weekly_report.curl_requests.Response()
        response.status_code = 200
        response.content = json.dumps(OK_PAYLOAD).encode("utf-8")
        return response

    monkeypatch.setattr(weekly_report.curl_requests, "post", fake_post)
    monkeypatch.setattr(weekly_report, "REPORT_MODELS", ("lento", "rapido"))

    text, _, model = weekly_report._generate_with_fallback("key", "prompt", grounded=False, json_output=True)

    assert (text, model) == ("completo", "rapido")
    assert llamadas == ["lento", "lento", "rapido"]


def test_un_403_de_credenciales_falla_de_inmediato(monkeypatch):
    esperas, _ = _sin_esperas(monkeypatch)
    llamadas = []

    def fake_generate(model, *a, **k):
        llamadas.append(model)
        raise _http_error(model, 403, "API key not valid")

    monkeypatch.setattr(weekly_report, "REPORT_MODELS", ("a", "b"))
    monkeypatch.setattr(weekly_report, "_generate_content", fake_generate)

    with pytest.raises(weekly_report.WeeklyReportError, match="HTTP 403"):
        weekly_report._generate_with_fallback("key", "prompt", grounded=False, json_output=True)

    # La clave esta mal para todos los modelos: ni reintento ni siguiente.
    assert llamadas == ["a"]
    assert esperas == []


def test_un_error_inesperado_no_http_se_relanza(monkeypatch):
    _sin_esperas(monkeypatch)

    def fake_generate(model, *a, **k):
        raise weekly_report.WeeklyReportError(f"Gemini {model}: Expecting value: line 1")

    monkeypatch.setattr(weekly_report, "REPORT_MODELS", ("a", "b"))
    monkeypatch.setattr(weekly_report, "_generate_content", fake_generate)

    with pytest.raises(weekly_report.WeeklyReportError, match="Expecting value"):
        weekly_report._generate_with_fallback("key", "prompt", grounded=False, json_output=True)


def test_presupuesto_agotado_deja_de_intentar_con_mensaje_claro(monkeypatch):
    _, reloj = _sin_esperas(monkeypatch)
    llamadas = []

    def fake_generate(model, *a, **k):
        llamadas.append(model)
        # Cada intento "consume" 200 s de reloj y acaba en 503.
        reloj["ahora"] += 200
        raise _http_error(model, 503)

    monkeypatch.setattr(weekly_report, "REPORT_MODELS", ("a", "b", "c", "d"))
    monkeypatch.setattr(weekly_report, "_generate_content", fake_generate)

    with pytest.raises(weekly_report.WeeklyReportError) as excinfo:
        weekly_report._generate_with_fallback("key", "prompt", grounded=False, json_output=True)

    mensaje = str(excinfo.value)
    assert "Presupuesto de tiempo" in mensaje and "420" in mensaje
    assert "HTTP 503" in mensaje
    # 200 s (a) + 200 s (reintento de a) = 400 s < 420 -> aun se prueba b;
    # tras b (600 s) se corta sin tocar c ni d.
    assert llamadas == ["a", "a", "b"]


def test_la_investigacion_reserva_una_llamada_completa_para_redactar(monkeypatch):
    """La reserva de redaccion se descuenta del mismo plazo total de 420 s."""
    _, reloj = _sin_esperas(monkeypatch)
    started = reloj["ahora"]
    plazos = []
    aceptaciones = []

    def fake_generate(api_key, prompt, *, grounded, json_output, deadline=None, accept_until=None):
        plazos.append(deadline)
        aceptaciones.append(accept_until)
        if grounded:
            reloj["ahora"] = deadline - 1
            payload = {"candidates": [{"groundingMetadata": {"groundingChunks": [
                {"web": source} for source in valid_report()["sources"]
            ]}}]}
            return "Investigacion contrastada", payload, "research-model"
        assert deadline - reloj["ahora"] >= weekly_report.GEMINI_REQUEST_TIMEOUT_SEC
        return json.dumps(valid_report()), {}, "report-model"

    monkeypatch.setattr(weekly_report, "_generate_with_fallback", fake_generate)
    weekly_report.generate_strategy_report("WEEKLY_REPORT", api_key="k")

    assert plazos == [
        started + weekly_report.CASCADE_TIME_BUDGET_SEC - weekly_report.REPORT_TIME_RESERVE_SEC,
        started + weekly_report.CASCADE_TIME_BUDGET_SEC,
    ]
    # La investigacion se acepta mientras la redaccion conserve su minimo;
    # la redaccion usa su propio plazo.
    assert aceptaciones == [
        started + weekly_report.CASCADE_TIME_BUDGET_SEC - weekly_report.MIN_CALL_TIMEOUT_SEC,
        None,
    ]


# ---------------------------------------------------------------------------
# A-02 (auditoria 18-10-2026): el presupuesto solo se miraba antes de cada
# llamada y cada una podia esperar 150 s completos. Ahora se limita la
# transferencia completa y se comprueba el plazo tambien al volver de ella.
# ---------------------------------------------------------------------------

def _red_lenta(model):
    err = weekly_report.WeeklyReportError(f"Gemini {model}: error de red (timed out)")
    err.transient = True
    return err


def test_un_proveedor_lento_nunca_pasa_del_plazo_del_informe(monkeypatch):
    _, reloj = _sin_esperas(monkeypatch)
    plazo = reloj["ahora"] + weekly_report.CASCADE_TIME_BUDGET_SEC
    timeouts = []

    def fake_generate(model, *a, timeout, **k):
        # Proveedor que no contesta: agota su timeout entero y falla por red.
        timeouts.append(timeout)
        reloj["ahora"] += timeout
        raise _red_lenta(model)

    monkeypatch.setattr(weekly_report, "REPORT_MODELS", ("a", "b", "c"))
    monkeypatch.setattr(weekly_report, "_generate_content", fake_generate)

    with pytest.raises(weekly_report.WeeklyReportError, match="quedan 0 s.*presupuesto total 420 s") as excinfo:
        weekly_report._generate_with_fallback("key", "p", grounded=False, json_output=True)

    # 150 + 150 + 120 = 420: la ultima llamada se recorta a lo que quedaba.
    assert timeouts == [150, 150, 120]
    assert reloj["ahora"] <= plazo
    assert "error de red" in str(excinfo.value)


def test_la_redaccion_solo_espera_lo_que_dejo_la_investigacion(monkeypatch):
    _, reloj = _sin_esperas(monkeypatch)
    timeouts = []

    def fake_generate(model, *a, timeout, **k):
        timeouts.append(timeout)
        return OK_PAYLOAD

    monkeypatch.setattr(weekly_report, "REPORT_MODELS", ("a",))
    monkeypatch.setattr(weekly_report, "_generate_content", fake_generate)

    # La investigacion se ha comido todo menos 45 s del plazo comun.
    weekly_report._generate_with_fallback("key", "p", grounded=False, json_output=True,
                                          deadline=reloj["ahora"] + 45)
    assert timeouts == [45]


def test_sin_margen_minimo_no_se_lanza_la_llamada(monkeypatch):
    _, reloj = _sin_esperas(monkeypatch)
    llamadas = []
    monkeypatch.setattr(weekly_report, "REPORT_MODELS", ("a",))
    monkeypatch.setattr(weekly_report, "_generate_content", lambda model, *a, **k: llamadas.append(model))

    with pytest.raises(weekly_report.WeeklyReportError, match="fase de redaccion.*Intentos: ninguno"):
        weekly_report._generate_with_fallback(
            "key", "p", grounded=False, json_output=True,
            deadline=reloj["ahora"] + weekly_report.MIN_CALL_TIMEOUT_SEC - 1,
        )
    assert llamadas == []


def test_el_timeout_recortado_llega_a_la_peticion(monkeypatch):
    seen = {}

    def fake_post(url, **kwargs):
        seen.update(kwargs)
        response = weekly_report.curl_requests.Response()
        response.status_code = 200
        response.content = json.dumps(OK_PAYLOAD).encode("utf-8")
        return response

    monkeypatch.setattr(weekly_report.curl_requests, "post", fake_post)
    weekly_report._generate_content("m", "k", "hola", grounded=False, json_output=False, timeout=37.5)
    assert seen["timeout"] == 37.5
    assert seen["stream"] is False


def test_una_respuesta_valida_fuera_de_plazo_no_se_acepta(monkeypatch):
    _, reloj = _sin_esperas(monkeypatch)

    def fake_generate(*args, **kwargs):
        reloj["ahora"] += 31
        return OK_PAYLOAD

    monkeypatch.setattr(weekly_report, "_generate_content", fake_generate)
    with pytest.raises(weekly_report.WeeklyReportError, match="Presupuesto de tiempo agotado"):
        weekly_report._generate_with_fallback(
            "key", "p", grounded=False, json_output=True, deadline=reloj["ahora"] + 30,
        )


def test_sin_tiempo_tras_el_fallo_no_se_reintenta_ni_se_prueba_otro(monkeypatch):
    esperas, reloj = _sin_esperas(monkeypatch)
    calls = []

    def fake_generate(model, *args, **kwargs):
        calls.append(model)
        reloj["ahora"] += 30
        raise _red_lenta(model)

    monkeypatch.setattr(weekly_report, "REPORT_MODELS", ("a", "b"))
    monkeypatch.setattr(weekly_report, "_generate_content", fake_generate)
    with pytest.raises(weekly_report.WeeklyReportError, match="Presupuesto de tiempo agotado"):
        weekly_report._generate_with_fallback(
            "key", "p", grounded=False, json_output=True, deadline=reloj["ahora"] + 30,
        )
    assert calls == ["a"]
    assert esperas == []


def test_si_el_reintento_no_cabe_se_prueba_el_siguiente_modelo(monkeypatch):
    # Quedan 24 s: no caben 5 s de espera + 20 s de llamada, pero el siguiente
    # modelo no espera y si cabe.
    esperas, reloj = _sin_esperas(monkeypatch)
    calls = []

    def fake_generate(model, *args, timeout, **kwargs):
        calls.append((model, timeout))
        if model == "a":
            reloj["ahora"] += 6
            raise _red_lenta(model)
        return OK_PAYLOAD

    monkeypatch.setattr(weekly_report, "REPORT_MODELS", ("a", "b"))
    monkeypatch.setattr(weekly_report, "_generate_content", fake_generate)
    text, _, model = weekly_report._generate_with_fallback(
        "key", "p", grounded=False, json_output=True, deadline=reloj["ahora"] + 30,
    )
    assert (text, model) == ("completo", "b")
    assert calls == [("a", 30), ("b", 24)]
    assert esperas == []


def test_la_investigacion_que_llega_justo_tras_su_plazo_se_acepta(monkeypatch):
    _, reloj = _sin_esperas(monkeypatch)
    plazo = reloj["ahora"] + 30
    payload = {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "investigado"}]},
                               "groundingMetadata": {"groundingChunks": [
                                   {"web": source} for source in valid_report()["sources"]]}}]}

    def fake_generate(model, *args, timeout, **kwargs):
        # El timeout cubre hasta el plazo; la respuesta completa llega 0,2 s despues.
        reloj["ahora"] += timeout + 0.2
        return payload

    monkeypatch.setattr(weekly_report, "RESEARCH_MODELS", ("buscador",))
    monkeypatch.setattr(weekly_report, "_generate_content", fake_generate)
    text, _, model = weekly_report._generate_with_fallback(
        "key", "p", grounded=True, json_output=False, deadline=plazo, accept_until=plazo + 150,
    )
    assert (text, model) == ("investigado", "buscador")


def test_la_investigacion_no_se_acepta_si_la_redaccion_ya_no_cabe(monkeypatch):
    _, reloj = _sin_esperas(monkeypatch)
    plazo = reloj["ahora"] + 30

    def fake_generate(*args, **kwargs):
        reloj["ahora"] = plazo + 151
        return OK_PAYLOAD

    monkeypatch.setattr(weekly_report, "RESEARCH_MODELS", ("buscador",))
    monkeypatch.setattr(weekly_report, "_generate_content", fake_generate)
    with pytest.raises(weekly_report.WeeklyReportError, match="Presupuesto de tiempo agotado"):
        weekly_report._generate_with_fallback(
            "key", "p", grounded=True, json_output=False, deadline=plazo, accept_until=plazo + 150,
        )


def test_las_esperas_de_reintento_cuentan_dentro_del_plazo(monkeypatch):
    esperas, reloj = _sin_esperas(monkeypatch)
    started = reloj["ahora"]
    timeouts = []

    def fake_sleep(seconds):
        esperas.append(seconds)
        reloj["ahora"] += seconds

    def fake_generate(model, *args, timeout, **kwargs):
        timeouts.append(timeout)
        reloj["ahora"] += timeout
        raise _red_lenta(model)

    monkeypatch.setattr(weekly_report, "_sleep", fake_sleep)
    monkeypatch.setattr(weekly_report, "_generate_content", fake_generate)
    with pytest.raises(weekly_report.WeeklyReportError, match="Presupuesto de tiempo agotado"):
        weekly_report._generate_with_fallback("key", "p", grounded=False, json_output=True)
    assert timeouts == [150, 150, 115]
    assert esperas == [5]
    assert reloj["ahora"] - started == weekly_report.CASCADE_TIME_BUDGET_SEC
