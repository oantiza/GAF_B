"""Selection controls backed by reviewed corporate-action evidence.

These controls never delete the asset or its history. An ingestion quality
warning alone is not proof that a security has ceased to exist.

Operator decisions (a security the team decides not to offer) live in
`asset_selection_controls.json`, versioned with the code, not in the master
document: `assets/{id}` belongs to the data platform, whose republish replaces
`quality`, and hand edits to Firestore do not survive it.
"""
import json
from functools import lru_cache
from pathlib import Path

SELECTION_CONTROLS_FILE = Path(__file__).with_name("asset_selection_controls.json")


def corporate_action_blocks_selection(root: dict) -> bool:
    return "DEREGISTERED_MERGER_VERIFIED" in ((root.get("quality") or {}).get("review_flags") or [])


@lru_cache(maxsize=1)
def selection_controls() -> dict:
    data = json.loads(SELECTION_CONTROLS_FILE.read_text(encoding="utf-8"))
    return data.get("assets") or {}


def selection_control(asset_id) -> dict:
    return selection_controls().get(str(asset_id or "")) or {}


def nunca_resuelto(root: dict) -> bool:
    """Decision 44 (05-11-2026): nunca se resolvio su simbolo, asi que no tiene precio ni metricas.

    Sale del estado que publica la base nueva, nunca del ISIN. La posicion que ya exista se conserva, como las demas
    restricciones.
    """
    return ((root or {}).get("availability") or {}).get("state") == "NEVER_RESOLVED"


MARCA_DE_PRECIO_CONGELADO = "PRICE_FROZEN_DELISTED"


def valorado_a_precio_congelado(root: dict) -> bool:
    """Una baja que se sigue valorando a su ultimo precio: se queda dada de alta, como unico caso excepcional.

    Hoy es NH Hotel Group, por decision de Oscar del 12-11-2026: hay clientes que lo tienen, no se negocia y se espera una OPA
    de exclusion a ese precio. Se decide por la marca de su politica del historico (`fund_history_policies.json`, con su
    `frozen_price`), nunca por el ISIN. La base sigue diciendo, con verdad, que esta `DELISTED`; lo que cambia es que se puede
    elegir y que su serie se prolonga plana (`extend_frozen_price`). `tests/test_precio_congelado.py` falla si hay mas de uno.
    """
    from fund_history_quality import policy_for
    politica = policy_for((root or {}).get("asset_id"))
    return MARCA_DE_PRECIO_CONGELADO in (politica.get("flags") or []) and bool(politica.get("frozen_price"))


def bloqueado_por_calidad_del_dato(root: dict) -> bool:
    """Decision 75: el equipo lo deja fuera porque su serie tiene saltos sin resolver. Cotiza y se puede comprar, asi que no se dice «no invertible».

    Hoy son Deoleo, Duro Felguera y Squirrel, los tres bloqueados por Oscar el 30-09-2026. Sigue sin proponerse y fuera del
    historico (`exclude_from_history`): esto solo cambia lo que se dice de ellos.
    """
    control = selection_control((root or {}).get("asset_id"))
    return bool(control.get("blocked")) and control.get("reason") == "PRICE_HISTORY_ARTIFACT_UNRESOLVED"


def selection_restriction_flag(root: dict):
    """Public reason for a reviewed restriction. All of them preserve historical use, except the quality block (decision 75)."""
    if nunca_resuelto(root):
        return "NON_INVESTABLE_NEVER_RESOLVED"
    if bloqueado_por_calidad_del_dato(root):
        return "QUALITY_BLOCKED"
    control = selection_control((root or {}).get("asset_id"))
    if not control.get("blocked"):
        return None
    return {
        "SUSPENSION_VERIFIED": "NON_INVESTABLE_SUSPENDED",
        "DELISTING_VERIFIED": "NON_INVESTABLE_DELISTED",
        "CLOSED_TO_NEW_SUBSCRIPTIONS_VERIFIED": "NON_INVESTABLE_CLOSED_SUBSCRIPTIONS",
    }.get(control.get("reason"))


def operator_blocks_selection(root: dict, *, allow_historical: bool = False) -> bool:
    """True if the team has excluded this asset from selection.

    `exclude_from_history` keeps it out of historical analyses too (backtest,
    rebased series), as an `is_investable: false` in the root did.
    """
    # Decision 44: no se elige. En lo historico no se bloquea aqui: se queda fuera porque no tiene serie de precios, que es
    # el motivo de verdad, y no porque alguien lo haya declarado «no invertible».
    if nunca_resuelto(root):
        return not allow_historical
    control = selection_control((root or {}).get("asset_id"))
    if control.get("blocked"):
        return not allow_historical or bool(control.get("exclude_from_history"))
    # Legacy: blocks written by hand into the root before the controls file.
    # Kept until the ownership migration removes them from assets/{id}.
    # La base nueva escribe aqui `is_investable: False` para lo que esta `DELISTED` (`raiz_vieja`): la baja con precio congelado no
    # se bloquea por eso (decision de Oscar del 12-11-2026). Lo que no se hace es proponerle pesos: eso lo para `_root_exclusion_reason`.
    return (root or {}).get("is_investable") is False and not valorado_a_precio_congelado(root)
