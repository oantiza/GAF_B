"""
Logica de carteras app-owned (por usuario). Sin Firestore: usa un `store` inyectable.
REGLA: una cartera solo guarda asset_id + pesos + metadata propia; NUNCA datos maestros.
Aislada por UID (el store opera siempre dentro del espacio del usuario).

Interfaz `store`:
  store.save(uid, portfolio_id, doc)
  store.list(uid) -> list[doc]
  store.get(uid, portfolio_id) -> doc | None
  store.delete(uid, portfolio_id) -> bool   # True si existia
  store.save_if_unchanged(uid, portfolio_id, doc, expected_updated_at)   # opcional (DIS-03): atomico,
      escribe solo si la guardada sigue teniendo ese `updated_at`; si no, PortfolioConflict
"""
import uuid
from datetime import datetime, timezone
import math
import re

MAX_POSITIONS = 200
MAX_TOTAL_CAPITAL = 1_000_000_000_000.0
SCHEMA_VERSION = "portfolios.v2"
ALLOWED_POSITION_FIELDS = {"asset_id", "weight_percent", "label", "keep_euros", "target_euros"}
PORTFOLIO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
ASSET_ID_RE = re.compile(r"^[A-Za-z0-9_.-]{1,128}$")

# Decision 59 (09-11-2026): cada cartera modelo guarda un nivel de perfil y un horizonte en anos,
# los dos en la raiz del documento. El nivel es el de la escala de diez de la app
# (src/core/riskProfilePreview.ts); el horizonte, el que escribe el asesor. AUSENTE ES AUSENTE: no hay
# valor por defecto ni se deduce uno del otro (la escala de anos por nivel es decision abierta de Oscar).
RISK_PROFILE_LEVEL_MIN = 1
RISK_PROFILE_LEVEL_MAX = 10
# Tope de cordura, no de politica: un horizonte de mas de un siglo es un error de tecleo.
HORIZON_YEARS_MAX = 100.0
PROFILE_FIELDS = ("risk_profile_level", "horizon_years")


class InvalidPortfolio(ValueError):
    """Payload app-owned no valido para persistencia."""


class PortfolioConflict(Exception):
    """DIS-03: la guardada ya no es la que el cliente abrio, y no se ha escrito nada.

    `reason` es "changed" (otra escritura la ha cambiado) o "deleted" (ya no existe);
    `current_updated_at`, la fecha de modificacion de la que hay ahora, si la hay.
    No es un InvalidPortfolio: el dato es valido, lo que ha cambiado es la base.
    """

    def __init__(self, reason: str, current_updated_at=None):
        super().__init__(reason)
        self.reason = reason
        self.current_updated_at = current_updated_at if isinstance(current_updated_at, str) else None


MAX_EXPECTED_UPDATED_AT = 64


def expected_updated_at_of(payload: dict):
    """DIS-03: la fecha con que el cliente abrio la guardada, o None si guarda sin condicion.

    Ausente o null: sin condicion, como antes. Si viene, una cadena no vacia de 64 caracteres
    como mucho; cualquier otra cosa se rechaza. Se compara tal cual, sin interpretarla.
    """
    value = payload.get("expected_updated_at") if isinstance(payload, dict) else None
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > MAX_EXPECTED_UPDATED_AT:
        raise InvalidPortfolio("expected_updated_at debe ser la fecha de modificacion de la cartera abierta.")
    return value


def _num(v):
    try:
        value = None if v is None else float(v)
    except (TypeError, ValueError):
        return None
    return value if value is not None and math.isfinite(value) else None


def _now():
    return datetime.now(timezone.utc).isoformat()


def _iso_timestamp_or_none(value):
    """El texto si es una fecha ISO-8601 que `datetime.fromisoformat` entiende; None si no.

    H04 (auditoria 14-10-2026): `created_at` llegaba del cliente y se guardaba tal cual
    (cualquier texto de hasta 40 caracteres). Ahora solo se conserva si es ISO-8601; si
    no, quien llama usa la hora del servidor.
    """
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text or len(text) > 40:
        return None
    try:
        datetime.fromisoformat(text)
    except ValueError:
        return None
    return text


def validate_risk_profile_level(value):
    """El nivel 1-10 como entero, o None si no se ha definido. Cualquier otra cosa se rechaza."""
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InvalidPortfolio("El nivel de perfil de riesgo debe ser un numero entero del 1 al 10.")
    if isinstance(value, float) and not (math.isfinite(value) and value.is_integer()):
        raise InvalidPortfolio("El nivel de perfil de riesgo debe ser un numero entero del 1 al 10.")
    level = int(value)
    if level < RISK_PROFILE_LEVEL_MIN or level > RISK_PROFILE_LEVEL_MAX:
        raise InvalidPortfolio(f"El nivel de perfil de riesgo {level} esta fuera de la escala del 1 al 10.")
    return level


def validate_horizon_years(value):
    """El horizonte en anos, positivo, o None si no se ha definido. Cero o negativo se rechaza."""
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise InvalidPortfolio("El horizonte debe ser un numero de anos.")
    years = float(value)
    if years <= 0:
        raise InvalidPortfolio("El horizonte debe ser mayor que cero anos.")
    if years > HORIZON_YEARS_MAX:
        raise InvalidPortfolio(f"El horizonte no puede pasar de {int(HORIZON_YEARS_MAX)} anos.")
    return years


def _position_weight_percent(position: dict):
    # `weight` is accepted as a legacy alias for existing saved payloads.
    return _num(position.get("weight_percent") if "weight_percent" in position else position.get("weight"))


def validate_portfolio_id(value) -> str:
    portfolio_id = str(value or "").strip()
    if not PORTFOLIO_ID_RE.fullmatch(portfolio_id):
        raise InvalidPortfolio("portfolio_id no es valido.")
    return portfolio_id


def sanitize_portfolio(payload: dict, uid: str, now: str = None) -> dict:
    if not isinstance(payload, dict):
        raise InvalidPortfolio("La cartera debe ser un objeto.")
    now = now or _now()
    raw_positions = payload.get("positions") or []
    if not isinstance(raw_positions, list):
        raise InvalidPortfolio("positions debe ser una lista.")
    if len(raw_positions) > MAX_POSITIONS:
        raise InvalidPortfolio(f"Maximo {MAX_POSITIONS} posiciones por cartera.")

    positions = []
    weight_sources = []
    seen_asset_ids = set()
    for index, p in enumerate(raw_positions):
        if not isinstance(p, dict):
            raise InvalidPortfolio(f"Posicion {index + 1} no es un objeto.")
        aid = str(p.get("asset_id") or "").strip()
        w = _position_weight_percent(p)
        if not ASSET_ID_RE.fullmatch(aid):
            raise InvalidPortfolio(f"asset_id no valido en posicion {index + 1}.")
        if aid in seen_asset_ids:
            raise InvalidPortfolio(f"asset_id duplicado: {aid}.")
        if w is None or w < 0:
            raise InvalidPortfolio(f"Peso no valido en posicion {index + 1}.")
        seen_asset_ids.add(aid)
        pos = {"asset_id": aid, "weight_percent": float(w)}
        if p.get("label"):
            pos["label"] = str(p["label"])[:120]
        keep_euros = p.get("keep_euros") if "keep_euros" in p else p.get("keepEuros")
        if keep_euros is not None:
            if not isinstance(keep_euros, bool):
                raise InvalidPortfolio(f"keep_euros no valido en posicion {index + 1}.")
            pos["keep_euros"] = keep_euros
        target_euros_raw = p.get("target_euros") if "target_euros" in p else p.get("targetEuros")
        if target_euros_raw is not None:
            target_euros = _num(target_euros_raw)
            if target_euros is None or target_euros < 0 or target_euros > MAX_TOTAL_CAPITAL:
                raise InvalidPortfolio(f"target_euros no valido en posicion {index + 1}.")
            pos["target_euros"] = float(target_euros)
        positions.append(pos)  # solo campos permitidos: el resto (datos maestros) se descarta
        weight_sources.append("weight_percent" if "weight_percent" in p else "weight")
    if positions and "weight_percent" not in weight_sources:
        total = sum(p["weight_percent"] for p in positions)
        if 0 < total <= 1.0001:
            for p in positions:
                p["weight_percent"] = round(p["weight_percent"] * 100.0, 6)
    if any(p["weight_percent"] > 100.0 for p in positions):
        raise InvalidPortfolio("Ningun peso puede superar el 100 por ciento.")

    pid = validate_portfolio_id(payload.get("portfolio_id") or uuid.uuid4())
    base_currency = str(payload.get("base_currency") or "EUR").strip().upper()
    if base_currency != "EUR":
        raise InvalidPortfolio("Solo se admite EUR como moneda base.")
    created_at = _iso_timestamp_or_none(payload.get("created_at")) or now
    total_capital = None
    if payload.get("total_capital") is not None:
        total_capital = _num(payload.get("total_capital"))
        if total_capital is None or total_capital < 0 or total_capital > MAX_TOTAL_CAPITAL:
            raise InvalidPortfolio("total_capital no es valido.")
    doc = {
        "portfolio_id": pid,
        "owner_uid": uid,
        "name": (str(payload.get("name") or "Cartera").strip() or "Cartera")[:120],
        "base_currency": base_currency,
        "source_kind": "BDB_APP_OWNED",
        "positions": positions,
        "created_at": created_at,
        "updated_at": now,
    }
    if total_capital is not None:
        doc["total_capital"] = float(total_capital)
    risk_profile_level = validate_risk_profile_level(payload.get("risk_profile_level"))
    if risk_profile_level is not None:
        doc["risk_profile_level"] = risk_profile_level
    horizon_years = validate_horizon_years(payload.get("horizon_years"))
    if horizon_years is not None:
        doc["horizon_years"] = horizon_years
    return doc


# Ronda 2 (14-10-2026): la misma tolerancia unica que el frontend
# (src/core/weightTolerance.ts, WEIGHT_TOLERANCE_PERCENT = 0,05 puntos, criterio
# estricto `< 0,05`). Antes aqui era 0,01 y una cartera de 3 x 33,33 % cuadrada en
# pantalla volvia del guardado con el aviso de pesos descuadrados.
WEIGHT_TOLERANCE_PERCENT = 0.05


def weight_warnings(doc: dict) -> list:
    if not doc["positions"]:
        return []
    total = round(sum(p["weight_percent"] for p in doc["positions"]), 4)
    if abs(total - 100.0) < WEIGHT_TOLERANCE_PERCENT:
        return []
    return [{"code": "WEIGHTS_NOT_100", "severity": "MEDIUM",
             "message": f"Los pesos suman {total} (se esperaba 100)."}]


MAX_PORTFOLIOS_PER_USER = 200


def save_portfolio(store, uid: str, payload: dict, now: str = None) -> dict:
    doc = sanitize_portfolio(payload, uid, now)
    expected_updated_at = expected_updated_at_of(payload)
    existing = store.get(uid, doc["portfolio_id"]) if hasattr(store, "get") else None
    # Ola A2 (A2.7): tope de carteras por usuario. Sobrescribir una existente
    # siempre esta permitido; el tope solo frena documentos NUEVOS. Un guardado
    # condicionado (DIS-03) nunca crea uno: si no existe, es un conflicto.
    if (expected_updated_at is None and hasattr(store, "count") and existing is None
            and store.count(uid) >= MAX_PORTFOLIOS_PER_USER):
        raise InvalidPortfolio(f"Maximo {MAX_PORTFOLIOS_PER_USER} carteras guardadas por usuario.")
    # Revision 14-10-2026 (H04): al actualizar, la fecha de alta es la guardada, sea cual
    # sea su formato; solo se valida la que llega con una cartera nueva.
    if isinstance(existing, dict) and existing.get("created_at"):
        doc["created_at"] = existing["created_at"]
    # Decision 59: un cliente que no manda la clave (una version anterior de la pantalla) no borra lo
    # guardado; quien quiere quitar el valor manda la clave con null. Solo se conserva lo que valida.
    for campo, validar in (("risk_profile_level", validate_risk_profile_level), ("horizon_years", validate_horizon_years)):
        if campo in payload or not isinstance(existing, dict) or existing.get(campo) is None:
            continue
        try:
            doc[campo] = validar(existing[campo])
        except InvalidPortfolio:
            pass
    if expected_updated_at is None:
        store.save(uid, doc["portfolio_id"], doc)
    elif hasattr(store, "save_if_unchanged"):
        # DIS-03: los dos almacenes reales comprueban y escriben en una sola operacion atomica.
        store.save_if_unchanged(uid, doc["portfolio_id"], doc, expected_updated_at)
    else:
        # Solo para los dobles en memoria de las pruebas: comprobar con `get` y escribir con `save`
        # NO es atomico, otra escritura puede colarse entre las dos. Ningun almacen real pasa por aqui.
        if not isinstance(existing, dict):
            raise PortfolioConflict("deleted")
        if existing.get("updated_at") != expected_updated_at:
            raise PortfolioConflict("changed", existing.get("updated_at"))
        store.save(uid, doc["portfolio_id"], doc)
    return {
        "schema_version": SCHEMA_VERSION,
        "portfolio_id": doc["portfolio_id"],
        "portfolio": doc,
        "warnings": weight_warnings(doc),
    }


def list_portfolios(store, uid: str) -> list:
    docs = [doc for doc in store.list(uid) if isinstance(doc, dict)]
    return sorted(docs, key=lambda doc: str(doc.get("updated_at") or ""), reverse=True)


def get_portfolio(store, uid: str, portfolio_id: str):
    return store.get(uid, validate_portfolio_id(portfolio_id))


def delete_portfolio(store, uid: str, portfolio_id: str) -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "ok": bool(store.delete(uid, validate_portfolio_id(portfolio_id))),
    }
