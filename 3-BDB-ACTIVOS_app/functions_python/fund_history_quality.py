"""Audited fund history restrictions, shared by every analytical reader.

Original observations remain available in Firestore for investigation. A
restriction may only be lifted after an evidenced identity/continuity review.
"""
from copy import deepcopy
from datetime import date, timedelta
from functools import lru_cache
import json
from pathlib import Path

METRICS_SOURCE = "FUND_QUALITY_REVIEW_V1"


@lru_cache(maxsize=1)
def _fichero_de_politicas():
    return json.loads(Path(__file__).with_name("fund_history_policies.json").read_text(encoding="utf-8"))


def policies():
    """`assets`, y no `reviews`, la otra lista del fichero: lo revisado de un fondo que NO queda bajo una politica.

    Vive aparte a proposito. Una entrada en `assets`, aunque no bloquee, cambia lo que leen quienes preguntan
    `if policy_for(...)`: la ficha de datos exige entonces la firma de la revision, y la cifra de la base nueva no la lleva y
    se pierde. Por eso Robeco, con el bloqueo levantado (decision 57), esta en `reviews`, que es registro y nadie lee.
    """
    return _fichero_de_politicas()["assets"]


def policy_for(asset_id):
    return policies().get(asset_id, {})


def se_dibuja_tras_revision(asset_id):
    """Una serie bloqueada y revisada una a una, a la que solo le faltan los pagos (decision 53). Se puede pintar, y no se mide con ella: la excepcion
    es Rendimiento (decision 96), que no necesita que la serie los lleve porque los toma del extracto."""
    return bool(policy_for(asset_id).get("draw_after_review"))


def usable_documents(asset_id, documents, *, para_dibujar=False):
    """Lo que se puede usar de la serie de un fondo con politica de historico.

    `para_dibujar` es para quien pinta, y para Rendimiento, que pone los pagos del extracto: abre un bloqueo solo si la politica lo ha revisado (`draw_after_review`).
    `usable_from` y `excluded_dates` se aplican igual, para que tampoco se pinte lo que la revision quito.
    """
    policy = policy_for(asset_id)
    if not policy:
        return documents
    if policy.get("blocked") and not (para_dibujar and policy.get("draw_after_review")):
        return []
    result = []
    for original in documents:
        points = [p for p in original.get("points", [])
                  if str(p.get("date", "")) >= policy.get("usable_from", "")
                  and str(p.get("date", "")) not in policy.get("excluded_dates", [])]
        if not points:
            continue
        doc = deepcopy(original)
        doc.update(points=points, observations_count=len(points),
                   first_date=min(p["date"] for p in points), last_date=max(p["date"] for p in points))
        result.append(doc)
    return result


def public_flags(asset_id):
    policy = policy_for(asset_id)
    return list(policy.get("flags", []))


def tiene_precio_congelado(asset_id):
    """La politica que hace que `extend_frozen_price` prolongue su serie: la misma pregunta, en un solo sitio."""
    return bool(policy_for(asset_id).get("frozen_price"))


def extend_frozen_price(asset_id, documents, *, today=None, policy=None):
    """Prolonga plano, hasta `today`, un activo con precio congelado (`frozen_price`).

    Caso: un valor excluido de cotizacion (NH Hotel, 24/09/2025) que el broker
    mantiene al ultimo precio. Economicamente la posicion no se mueve: cero
    rentabilidad y cero riesgo. Sin esta prolongacion, su serie acaba el dia que
    se dejo de cotizar y, como la ventana comun es la interseccion de todos los
    activos, el fondo o bien se expulsa por historico insuficiente o bien recorta
    la ventana de toda la cartera.

    Se aplica en tiempo de lectura (price_series_cache), no en la maestra: la serie
    guardada sigue siendo la real y la prolongacion llega siempre hasta la fecha
    de calculo sin tener que regenerar datos cada dia. Solo dias laborables
    (lunes a viernes); los festivos los absorbe la interseccion con los demas
    activos. No se toca `usable_documents`: metrics_refresh lo llama documento a
    documento y prolongaria cada anio por separado.
    """
    policy = policy_for(asset_id) if policy is None else policy
    frozen = policy.get("frozen_price") if policy else None
    if not frozen or not documents:
        return documents
    dated = [(max(str(p.get("date", "")) for p in doc.get("points", [])), index)
             for index, doc in enumerate(documents) if doc.get("points")]
    if not dated:
        return documents
    last_date_text, index = max(dated)
    try:
        last_date = date.fromisoformat(last_date_text[:10])
        value = float(frozen["value"])
    except (ValueError, KeyError, TypeError):
        return documents
    if value <= 0 or last_date_text[:10] < str(frozen.get("from", "")):
        return documents
    today = today or date.today()
    if last_date >= today:
        return documents
    new_points = []
    day = last_date + timedelta(days=1)
    while day <= today:
        if day.weekday() < 5:
            new_points.append({"date": day.isoformat(), "value": value})
        day += timedelta(days=1)
    if not new_points:
        return documents
    doc = deepcopy(documents[index])
    points = list(doc.get("points", [])) + new_points
    doc.update(points=points, observations_count=len(points), last_date=new_points[-1]["date"])
    metadata = dict(doc.get("metadata") or {})
    metadata.update(frozen_price_runtime=True, frozen_price_value=value,
                    frozen_price_from=new_points[0]["date"], frozen_price_to=new_points[-1]["date"])
    doc["metadata"] = metadata
    result = list(documents)
    result[index] = doc
    return result
