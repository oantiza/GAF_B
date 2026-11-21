# -*- coding: utf-8 -*-
"""Decision 68 de Oscar: el texto de Estrategia no habla como si un comite hubiera decidido nada.

El encargo dice lo que es esto, y lo que se acaba de redactar se rechaza si habla como una casa. Lo guardado
no se reescribe y tiene que seguir leyendose: habla asi en los 19 semanales de la base local.
"""
from copy import deepcopy
from datetime import datetime, timezone
import json

import pytest

import report_publication
import weekly_report
from atomic_firestore_fake import Database
from test_weekly_report import valid_daily_report, valid_report

NOW = datetime(2026, 10, 26, 7, tzinfo=timezone.utc)

PROMPTS = [
    ("semanal", lambda: weekly_report._report_prompt("WEEKLY_REPORT", NOW, "base")),
    ("diario", lambda: weekly_report._report_prompt("DAILY_REPORT", NOW, "base")),
]
RESEARCH_PROMPTS = [
    ("semanal", lambda: weekly_report._research_prompt("WEEKLY_REPORT", NOW)),
    ("diario", lambda: weekly_report._research_prompt("DAILY_REPORT", NOW)),
]


@pytest.mark.parametrize("_name,prompt", PROMPTS + RESEARCH_PROMPTS)
def test_el_encargo_ya_no_hace_del_modelo_el_comite_de_un_banco(_name, prompt):
    text = prompt().casefold()
    assert "comite de inversiones" not in text
    assert "estratega jefe" not in text
    assert "banca privada espanola" not in text
    assert "sintesis automatica" in text or "sistema automatico" in text
    assert "asesor" in text


@pytest.mark.parametrize("_name,prompt", PROMPTS)
def test_el_encargo_de_redactar_prohibe_hablar_como_una_casa(_name, prompt):
    text = prompt()
    assert "sintesis de mercados para que las lea un asesor" in " ".join(text.split())
    for forbidden in ('"adoptamos"', '"nosotros"', '"nuestro"', '"el Comite adopta"', '"nuestro comite"'):
        assert forbidden in text
    assert "no atribuyas decisiones" in text


@pytest.mark.parametrize("_name,prompt", RESEARCH_PROMPTS)
def test_el_memo_tampoco_le_da_al_redactor_una_voz_que_copiar(_name, prompt):
    text = prompt()
    assert '"recomendamos"' in text and "tercera persona" in text
    assert "no atribuyas decisiones" in text


def test_el_resto_del_encargo_no_cambia():
    weekly = weekly_report._report_prompt("WEEKLY_REPORT", NOW, "BASE-DE-PRUEBA")
    daily = weekly_report._report_prompt("DAILY_REPORT", NOW, "BASE-DE-PRUEBA")
    for text in (weekly, daily):
        assert "usando EXCLUSIVAMENTE la base factual" in " ".join(text.split())
        assert '"author": "Redacción automática (IA)"' in text
        assert '"provider": "Gemini con Google Search"' in text
        assert "BASE-DE-PRUEBA" in text
        assert "promesas de rentabilidad" in text
    assert "todos los grupos de pesos suman 100" in weekly
    assert "cuatro secciones ###: Macroeconomía y geopolítica, Escenarios estratégicos" in weekly
    assert "NO incluyas un bloque assetAllocation" in daily


def _with_text(place, text):
    report = valid_report()
    if place == "headline":
        report["summary"]["headline"] = text
    elif place == "narrative":
        report["summary"]["narrative"] = text + " " + report["summary"]["narrative"]
    elif place == "event":
        report["summary"]["keyEvents"][1] = text + " en la semana."
    elif place == "risk":
        report["summary"]["tailRisks"][0]["risk"] = text
    elif place == "overview":
        report["assetAllocation"]["overview"] = text + " " + report["assetAllocation"]["overview"]
    elif place == "rationale":
        report["assetAllocation"]["classes"][1]["rationale"] = text
    elif place == "region":
        report["assetAllocation"]["regionsEquity"][0]["rationale"] = text
    elif place == "full":
        report["fullReport"]["narrative"] += " " + text
    return report


# Las frases salen de lo que hay escrito en los informes guardados de la base local.
@pytest.mark.parametrize("expression,text", [
    ("el comite adopta", "Desde un prisma táctico, el Comité adopta un posicionamiento acentuadamente defensivo."),
    ("el comite adopta", "EL COMITE ADOPTA una postura prudente."),
    ("el comite recomienda", "Ante ello, el comité recomienda prudencia."),
    ("comite de inversiones", "el Comite de Inversiones recomienda una postura prudente"),
    ("comite de inversiones", "la propuesta táctica del Comité de Inversiones es prudente y defensiva"),
    ("nuestro", "Nuestro comité mantiene la postura."),
    ("nuestra", "el Comité de Inversiones de nuestra banca privada recomienda una estrategia"),
    ("nuestro", "Nuestro escenario central contempla un aterrizaje suave"),
    ("nosotros", "Para nosotros la duración es prudente."),
    ("mesa de analisis", "La Mesa de Análisis recomienda prudencia."),
    ("adoptamos", "Adoptamos una postura defensiva."),
    ("mantenemos", "Mantenemos una postura defensiva y selectiva."),
    ("recomendamos", "Desde aquí recomendamos adoptar una postura prudente."),
    ("sobreponderamos", "En paralelo, sobreponderamos la liquidez."),
    ("infraponderamos", "Infraponderamos la renta variable."),
    ("seguimos sobreponderando", "En renta fija, seguimos sobreponderando el crédito."),
    ("consideramos", "Consideramos prudente reducir duración."),
    ("esperamos", "En este entorno, esperamos que los beneficios sigan."),
])
@pytest.mark.parametrize("place", ["narrative", "full"])
def test_lo_recien_redactado_se_rechaza_si_habla_como_una_casa(place, expression, text):
    report = _with_text(place, text)
    assert weekly_report.validate_weekly_report(report)  # Como lectura, pasa: lo guardado no se toca.
    with pytest.raises(weekly_report.WeeklyReportValidationError) as error:
        weekly_report.validate_weekly_report(report, reject_institutional_voice=True)
    assert expression in str(error.value)
    assert ("summary.narrative" if place == "narrative" else "fullReport.narrative") in str(error.value)


@pytest.mark.parametrize("place,field", [
    ("headline", "summary.headline"),
    ("event", "summary.keyEvents[1]"),
    ("risk", "summary.tailRisks[0].risk"),
    ("overview", "assetAllocation.overview"),
    ("rationale", "assetAllocation.classes[1].rationale"),
    ("region", "assetAllocation.regionsEquity[0].rationale"),
])
def test_se_mira_en_todo_lo_que_redacta_el_modelo(place, field):
    report = _with_text(place, "Recomendamos prudencia")
    with pytest.raises(weekly_report.WeeklyReportValidationError, match="recomendamos") as error:
        weekly_report.validate_weekly_report(report, reject_institutional_voice=True)
    assert field in str(error.value)


@pytest.mark.parametrize("text", [
    "ha dado comienzo la reunión de dos días del Comité Federal de Mercado Abierto (FOMC) de la Reserva Federal.",
    "introduce divisiones en los comités de política monetaria sobre la trayectoria de tipos.",
    "El Comité de Política Monetaria del Banco de Inglaterra mantuvo los tipos.",
    "El Comité mantuvo los tipos sin cambios tras dos días de reunión de la Fed.",
    "el anuncio de comites para evaluar su posible integracion",
    "El Banco Central Europeo mantiene la tasa de deposito en el 2,25%.",
    "Los máximos, los mínimos y los próximos tramos de los préstamos, en céntimos, son los últimos extremos.",
    "maximos minimos proximos ultimos prestamos centimos",
    "Hemos asistido a una moderacion y seguimos con maxima alerta la situacion fiscal.",
    "se aconseja mantener un colchon de liquidez elevado",
])
def test_lo_que_no_es_hablar_como_una_casa_pasa(text):
    assert weekly_report.validate_weekly_report(_with_text("full", text), reject_institutional_voice=True)


def test_la_fuente_puede_llamarse_como_un_comite_ajeno():
    report = valid_report()
    report["sources"][0]["title"] = "Comité de Inversiones de otro banco"
    assert weekly_report.validate_weekly_report(report, require_sources=True, reject_institutional_voice=True)


def test_el_mensaje_lo_dice_todo_de_una_vez_y_cabe_en_la_correccion():
    report = valid_report()
    report["summary"]["narrative"] = "Mantenemos la duración. " + report["summary"]["narrative"]
    report["assetAllocation"]["overview"] = "Recomendamos liquidez. " + report["assetAllocation"]["overview"]
    report["fullReport"]["narrative"] += " El Comité adopta una postura, y nuestra visión es prudente."
    with pytest.raises(weekly_report.WeeklyReportValidationError) as error:
        weekly_report.validate_weekly_report(report, reject_institutional_voice=True)
    message = str(error.value)
    for expression in ("mantenemos", "recomendamos", "el comite adopta", "nuestra"):
        assert expression in message
    assert len(message) < 1000  # generate_strategy_report corta en 1.000 lo que le dice al modelo.


# --------------------------------------------------------------------------- #
# Lo guardado no se reescribe y tiene que seguir leyendose.                     #
# --------------------------------------------------------------------------- #

class _Snapshot:
    def __init__(self, value):
        self.value = value

    def to_dict(self):
        return self.value


class _Collection:
    def __init__(self, values):
        self.values = values

    def where(self, **_kwargs):
        return self

    def order_by(self, *_args, **_kwargs):
        return self

    def limit(self, _value):
        return self

    def stream(self):
        return [_Snapshot(value) for value in self.values]


class _Reader:
    def __init__(self, values):
        self.reports = _Collection(values)

    def collection(self, _name):
        return self.reports


def _as_it_was_saved(date="2026-10-26T07:15:00Z"):
    report = valid_report(date=date)
    report["author"] = "Comité de Inversiones"
    report["id"] = "weekly-2026-10-26"
    report["fullReport"]["narrative"] += " Desde un prisma táctico, el Comité adopta un posicionamiento defensivo. Sobreponderamos la liquidez."
    return report


def test_la_pantalla_sigue_leyendo_lo_guardado_tal_cual():
    saved = _as_it_was_saved()
    before = deepcopy(saved)
    result = weekly_report.get_weekly_report({"type": "WEEKLY_REPORT"}, db=_Reader([saved]), now=NOW)
    assert result["invalid_count"] == 0
    assert result["report"]["fullReport"]["narrative"] == before["fullReport"]["narrative"]
    assert result["report"]["author"] == "Comité de Inversiones"
    assert saved == before


def test_publicar_otra_vez_ve_lo_guardado_y_no_lo_toca(monkeypatch):
    db = Database()
    saved = _as_it_was_saved()
    db.collection(weekly_report.REPORTS_COLLECTION).document("weekly-2026-10-26").create(deepcopy(saved))
    monkeypatch.setattr(weekly_report, "generate_strategy_report", lambda *a, **k: pytest.fail("No debe generar"))
    assert weekly_report.publish_strategy_report("WEEKLY_REPORT", db=db, now=NOW)["status"] == "ALREADY_PUBLISHED"
    assert db.values[weekly_report.REPORTS_COLLECTION + "/weekly-2026-10-26"] == saved


def test_el_vigilante_da_por_publicado_lo_guardado():
    db = Database()
    saved = _as_it_was_saved()
    db.collection(weekly_report.REPORTS_COLLECTION).document("weekly-2026-10-26").create(saved)
    daily = valid_daily_report(date="2026-10-26T07:00:00Z")
    daily["id"] = "daily-2026-10-26"
    db.collection(weekly_report.REPORTS_COLLECTION).document("daily-2026-10-26").create(daily)
    assert report_publication.check_due_report_publications(db, datetime(2026, 10, 26, 9, tzinfo=timezone.utc)) == []


# --------------------------------------------------------------------------- #
# Se vuelve a pedir como cualquier otro fallo de validacion.                    #
# --------------------------------------------------------------------------- #

def _generation(monkeypatch, drafts):
    prompts = []
    sources = valid_report()["sources"]
    payload = {"candidates": [{"groundingMetadata": {"groundingChunks": [
        {"web": {"title": source["title"], "uri": source["url"]}} for source in sources]}}]}

    def generate(_key, prompt, *, grounded, json_output, deadline=None, accept_until=None):
        if grounded:
            return "Base factual comprobada", payload, "research"
        prompts.append(prompt)
        return json.dumps(drafts.pop(0)), {}, "writer"

    monkeypatch.setattr(weekly_report, "_generate_with_fallback", generate)
    return prompts


def test_un_borrador_que_habla_como_un_comite_se_corrige_una_vez(monkeypatch):
    bad = valid_report()
    bad["fullReport"]["narrative"] += " El Comité adopta una postura defensiva y sobreponderamos liquidez."
    prompts = _generation(monkeypatch, [bad, valid_report()])
    db = Database()

    result = weekly_report.publish_strategy_report("WEEKLY_REPORT", db=db, api_key="k", now=NOW)

    assert result["status"] == "PUBLISHED"
    assert len(prompts) == 2
    assert "CORRECCION EDITORIAL" in prompts[1]
    assert "el comite adopta" in prompts[1] and "sobreponderamos" in prompts[1]
    published = db.values[weekly_report.REPORTS_COLLECTION + "/weekly-2026-10-26"]
    assert "Comité adopta" not in published["fullReport"]["narrative"]
    assert published["author"] == "Redacción automática (IA)"
    assert published["provider"] == "Gemini con Google Search"


def test_si_insiste_no_se_publica_y_el_motivo_dice_por_que(monkeypatch):
    bad = valid_report()
    bad["fullReport"]["narrative"] += " Mantenemos una postura defensiva."
    prompts = _generation(monkeypatch, [deepcopy(bad), deepcopy(bad)])
    db = Database()

    with pytest.raises(weekly_report.WeeklyReportValidationError, match="mantenemos"):
        weekly_report.publish_strategy_report("WEEKLY_REPORT", db=db, api_key="k", now=NOW)

    assert len(prompts) == 2
    assert weekly_report.REPORTS_COLLECTION + "/weekly-2026-10-26" not in db.values
    assert db.values["_report_publication/weekly-2026-10-26"]["status"] == "FAILED"


def test_el_encargo_pide_los_titulos_con_tilde_y_el_estilo_a_la_espanola():
    weekly = weekly_report._report_prompt("WEEKLY_REPORT", NOW, "base")
    daily = weekly_report._report_prompt("DAILY_REPORT", NOW, "base")
    assert (
        "Macroeconomía y geopolítica, Escenarios estratégicos, Valoraciones y mercados, Posicionamiento y conclusiones"
        in weekly
    )
    assert "Macroeconomia" not in weekly and "estrategicos" not in weekly
    assert "Cierre y lectura de la sesión" in daily
    for text in (weekly, daily):
        flat = " ".join(text.split())
        assert 'coma decimal y un espacio antes del signo ("3,8 %"' in flat
        assert '"interanual" y no "YoY"' in flat
        assert '"tercer trimestre" y no "Q3"' in flat
        assert "fechas en español" in flat
    assert "EEUU|Europa|Emergentes|Japón" in weekly


@pytest.mark.parametrize("region", ["Japon", "Japón"])
def test_la_validacion_acepta_japon_con_y_sin_tilde(region):
    report = valid_report()
    for row in report["assetAllocation"]["regionsEquity"]:
        if row["region"].startswith("Jap"):
            row["region"] = region
    validated = weekly_report.validate_weekly_report(report, expected_type="WEEKLY_REPORT")
    assert region in [row["region"] for row in validated["assetAllocation"]["regionsEquity"]]
