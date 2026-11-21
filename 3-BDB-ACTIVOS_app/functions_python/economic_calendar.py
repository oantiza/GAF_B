# -*- coding: utf-8 -*-
"""Calendario economico con fuente en vivo (Forex Factory, solo la semana en curso).

Si el JSON limita al servidor se intenta su formato XML. La respuesta dice que dias
cubre la fuente y distingue: hay eventos, no hay eventos en lo cubierto, el rango cae
fuera de la fuente y la fuente no responde. Nunca propaga errores de proveedores.
"""
from __future__ import annotations

import json
import logging
import re
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

FF_JSON_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
FF_XML_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.xml"
SCHEMA_VERSION = "economic-calendar.v2"
MAX_WINDOW_DAYS = 31
CACHE_TTL = timedelta(minutes=15)
MADRID = ZoneInfo("Europe/Madrid")

_UA = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, application/xml, text/plain, */*",
}
_PRIMARY_CACHE: dict[str, Any] = {
    "fetched_at": None,
    "events": None,
    "source": None,
}
logger = logging.getLogger(__name__)


def _now_madrid() -> datetime:
    return datetime.now(MADRID)


def _read_url(url: str) -> bytes:
    request = urllib.request.Request(url, headers=_UA)
    with urllib.request.urlopen(request, timeout=12) as response:
        return response.read()


def _parse_event_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    raw = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        try:
            parsed = datetime.combine(date.fromisoformat(raw), time.min)
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=MADRID)
    return parsed.astimezone(MADRID)


def _normalise_json_events(payload: bytes) -> list[dict[str, Any]]:
    data = json.loads(payload.decode("utf-8", errors="replace"))
    raw_events = data if isinstance(data, list) else data.get("data", []) if isinstance(data, dict) else []
    events: list[dict[str, Any]] = []
    for item in raw_events[:400]:
        if not isinstance(item, dict):
            continue
        event_date = _parse_event_datetime(item.get("date"))
        event_type = item.get("title") or item.get("event")
        if event_date is None or not isinstance(event_type, str) or not event_type.strip():
            continue
        events.append({
            "date": event_date.isoformat(),
            "country": item.get("country"),
            "type": event_type.strip(),
            "actual": item.get("actual"),
            "estimate": item.get("forecast"),
            "previous": item.get("previous"),
            "importance": item.get("impact"),
            "source": "FOREX_FACTORY",
        })
    return events


def _node_text(node: ET.Element, name: str) -> str | None:
    child = node.find(name)
    if child is None or child.text is None:
        return None
    value = child.text.strip()
    return value or None


def _xml_event_datetime(raw_date: str | None, raw_time: str | None) -> datetime | None:
    if not raw_date:
        return None
    try:
        event_day = datetime.strptime(raw_date, "%m-%d-%Y").date()
    except ValueError:
        return None
    clean_time = (raw_time or "").strip().lower().replace(" ", "")
    try:
        parsed_time = datetime.strptime(clean_time, "%I:%M%p").time()
    except ValueError:
        return datetime.combine(event_day, time.min, tzinfo=MADRID)
    # El XML publica sus horas en GMT; el JSON equivalente ya viene localizado.
    return datetime.combine(event_day, parsed_time, tzinfo=timezone.utc).astimezone(MADRID)


def _normalise_xml_events(payload: bytes) -> list[dict[str, Any]]:
    root = ET.fromstring(payload.decode("windows-1252", errors="replace"))
    events: list[dict[str, Any]] = []
    for node in root.findall(".//event")[:400]:
        event_date = _xml_event_datetime(_node_text(node, "date"), _node_text(node, "time"))
        event_type = _node_text(node, "title")
        if event_date is None or not event_type:
            continue
        events.append({
            "date": event_date.isoformat(),
            "country": _node_text(node, "country"),
            "type": event_type,
            "actual": _node_text(node, "actual"),
            "estimate": _node_text(node, "forecast"),
            "previous": _node_text(node, "previous"),
            "importance": _node_text(node, "impact"),
            "source": "FOREX_FACTORY",
        })
    return events


def _load_primary_events(now: datetime) -> tuple[list[dict[str, Any]], str]:
    cached_at = _PRIMARY_CACHE.get("fetched_at")
    cached_events = _PRIMARY_CACHE.get("events")
    cached_source = _PRIMARY_CACHE.get("source")
    if (
        isinstance(cached_at, datetime)
        and isinstance(cached_events, list)
        and isinstance(cached_source, str)
        and now - cached_at <= CACHE_TTL
    ):
        return list(cached_events), f"{cached_source}_CACHE"

    errors: list[str] = []
    for url, parser, source in (
        (FF_JSON_URL, _normalise_json_events, "FOREX_FACTORY_JSON_LIVE"),
        (FF_XML_URL, _normalise_xml_events, "FOREX_FACTORY_XML_LIVE"),
    ):
        try:
            events = parser(_read_url(url))
            if not events:
                raise ValueError("respuesta sin eventos validos")
            _PRIMARY_CACHE.update({"fetched_at": now, "events": list(events), "source": source})
            return events, source
        except Exception as exc:  # el proveedor nunca rompe la callable
            errors.append(f"{source}: {exc}")
            logger.warning("No se pudo cargar %s: %s", source, exc)

    if isinstance(cached_events, list) and cached_events and isinstance(cached_source, str):
        return list(cached_events), f"{cached_source}_STALE_CACHE"
    raise RuntimeError("; ".join(errors) or "fuente primaria no disponible")


def _fold(value: str) -> str:
    normalised = unicodedata.normalize("NFKD", value)
    ascii_value = "".join(char for char in normalised if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", " ", ascii_value.lower()).strip()


def _parse_request_day(value: Any, field: str, default: date) -> date:
    if value is None or value == "":
        return default
    if not isinstance(value, str):
        raise ValueError(f"{field} debe tener formato AAAA-MM-DD")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{field} debe tener formato AAAA-MM-DD") from exc


def _country_key(value: Any) -> str:
    folded = _fold(str(value or "")).replace(" ", "")
    aliases = {
        "us": "USD",
        "usa": "USD",
        "usd": "USD",
        "eu": "EUR",
        "eurozone": "EUR",
        "eur": "EUR",
        "uk": "GBP",
        "gb": "GBP",
        "gbp": "GBP",
        "jp": "JPY",
        "jpy": "JPY",
        "cn": "CNY",
        "cny": "CNY",
        "es": "ESP",
        "esp": "ESP",
    }
    return aliases.get(folded, folded.upper())


def _filter_events(
    events: list[dict[str, Any]],
    start: date,
    end: date,
    country: str | None,
) -> list[dict[str, Any]]:
    country_filter = _country_key(country) if country else None
    filtered: list[dict[str, Any]] = []
    for event in events:
        parsed = _parse_event_datetime(event.get("date"))
        if parsed is None or not start <= parsed.date() <= end:
            continue
        if country_filter and _country_key(event.get("country")) != country_filter:
            continue
        filtered.append(event)
    filtered.sort(key=lambda event: str(event.get("date") or ""))
    return filtered


def _deduplicate(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    unique: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for event in events:
        key = (
            str(event.get("date") or "")[:16],
            _country_key(event.get("country")),
            _fold(str(event.get("type") or "")),
        )
        if key in seen:
            continue
        seen.add(key)
        unique.append(event)
    unique.sort(key=lambda event: str(event.get("date") or ""))
    return unique



# Retirado el 15-11-2026 (hallazgo 25): el respaldo que tomaba los `keyEvents` del
# informe de estrategia y los pintaba como agenda a las 09:00. Eran hechos ya
# ocurridos, escritos por una IA, con una hora inventada, y casi nunca se activaba
# porque el informe escribe las fechas en español. Sin fuente, el calendario lo dice.

_DIAS = ("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo")
_MESES = (
    "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
    "septiembre", "octubre", "noviembre", "diciembre",
)


def _fecha_larga(day: date) -> str:
    return f"{_DIAS[day.weekday()]} {day.day} de {_MESES[day.month - 1]} de {day.year}"


def _coverage(all_events: list[dict[str, Any]], now: datetime) -> tuple[date, date]:
    """Dias que la fuente cubre: la semana en curso (lunes a domingo), ampliada
    si el propio feed trae eventos fuera de ella."""
    monday = now.date() - timedelta(days=now.weekday())
    sunday = monday + timedelta(days=6)
    days = []
    for event in all_events:
        parsed = _parse_event_datetime(event.get("date"))
        if parsed is not None:
            days.append(parsed.date())
    if days:
        monday = min(monday, min(days))
        sunday = max(sunday, max(days))
    return monday, sunday


def _response(
    events: list[dict[str, Any]],
    source: str,
    start: date,
    end: date,
    note: str | None = None,
    status: str | None = None,
    covers: tuple[date, date] | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "events": events,
        "from": start.isoformat(),
        "to": end.isoformat(),
        "source": source,
        "count": len(events),
    }
    if note:
        result["note"] = note
    # Aditivo: un cliente sin actualizar ignora estos campos.
    if status:
        result["status"] = status
    if covers:
        result["covers_from"] = covers[0].isoformat()
        result["covers_to"] = covers[1].isoformat()
    return result


def get_economic_calendar(request):
    data = request if isinstance(request, dict) else {}
    now = _now_madrid()
    try:
        start = _parse_request_day(data.get("from"), "from", now.date())
        end = _parse_request_day(data.get("to"), "to", start + timedelta(days=7))
        if end < start:
            raise ValueError("to no puede ser anterior a from")
        if (end - start).days > MAX_WINDOW_DAYS:
            raise ValueError(f"el intervalo maximo es de {MAX_WINDOW_DAYS} dias")
    except ValueError as exc:
        return _response([], "INVALID_REQUEST", now.date(), now.date(), str(exc), status="INVALID_REQUEST")

    country = data.get("country") if isinstance(data.get("country"), str) else None
    try:
        all_events, source = _load_primary_events(now)
    except Exception as exc:
        logger.warning("Calendario primario no disponible: %s", exc)
        return _response(
            [],
            "ERROR",
            start,
            end,
            "La fuente del calendario no respondió; no se sabe si hay eventos en ese intervalo.",
            status="SOURCE_ERROR",
        )

    cover_from, cover_to = _coverage(all_events, now)
    covers = (cover_from, cover_to)
    if end < cover_from or start > cover_to:
        return _response(
            [],
            "OUT_OF_SOURCE_RANGE",
            start,
            end,
            f"El rango pedido cae fuera del alcance de la fuente, que solo cubre del "
            f"{_fecha_larga(cover_from)} al {_fecha_larga(cover_to)}.",
            status="OUT_OF_SOURCE_RANGE",
            covers=covers,
        )

    partial_note = None
    if end > cover_to:
        partial_note = (
            f"La fuente solo cubre hasta el {_fecha_larga(cover_to)}; "
            "lo posterior a esa fecha no se puede mostrar."
        )
    events = _deduplicate(_filter_events(all_events, start, end, country))
    if events:
        return _response(events, source, start, end, partial_note, status="OK", covers=covers)
    note = "No hay eventos en lo que la fuente cubre."
    if partial_note:
        note = f"{note} {partial_note}"
    return _response([], source, start, end, note, status="NO_EVENTS_IN_COVERAGE", covers=covers)
