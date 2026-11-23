"""
El almacen de carteras por UID que usan las callables (`save_portfolio`, `list_portfolios`, `delete_portfolio`).

Es el de la base nueva (`portfolios/almacen_base_nueva.py`). El de la base vieja (`FirestorePortfolioStore`, en
`bdb_activos/{uid}/portfolios` de `gestor-activos-local`) se borro el 21-11-2026 con el resto del codigo de esa base
(decision 31 del censo `CENSO_BASE_VIEJA_2026-11-21.md`; etiqueta `referencia-base-vieja-2026-11-21`).
"""


def almacen_de_carteras():
    """El almacen de la base nueva. Con otro proyecto en MASTER_PROJECT_ID para, nombrandolo
    (`master_project.exigir_base_nueva`), en vez de guardar en una base que ya no se lee."""
    from master_project import exigir_base_nueva
    exigir_base_nueva()
    from portfolios.almacen_base_nueva import AlmacenCarterasBaseNueva
    return AlmacenCarterasBaseNueva()
