"""Familias de dato y su frescura.

Hasta el 04-09 la caché HTTP tenía un único TTL (`cache_dias`, 7 días) para
todo: cada pasada refrescaba los 29 endpoints de un fondo aunque solo hubiera
cambiado el valor liquidativo (9,4 h para 763 fondos). Cada familia cambia a un
ritmo distinto y merece su propio plazo. Los valores por defecto salen del
descubrimiento del 04-09 y se pueden ajustar en `config/settings.json`
(`ttl_dias_por_familia`), sin invalidar nada: el TTL se aplica al LEER la
caché, no al escribirla.
"""
from __future__ import annotations

# familia -> TTL en días
TTL_POR_DEFECTO: dict[str, float] = {
    "precio": 1,          # VL, precio, fecha, divisa de cotización
    "rendimiento": 1,     # rentabilidades y riesgo diarios (screener)
    "analitica": 30,      # estrellas, medalist, matriz de riesgo mensual, drawdown
    "cartera": 30,        # posiciones, sectores, regiones, asignación, renta fija
    "esg": 30,            # globos, carbono, SFDR
    "costes": 90,         # TER, comisiones, MiFID/EMT
    "regulatorio": 90,    # KID (SRI, costes), registros oficiales, informes periódicos
    "identidad": 365,     # nombre legal, domicilio, UCITS, gestora, lanzamiento, LEI
}

FAMILIAS = tuple(TTL_POR_DEFECTO)

DESCRIPCION = {
    "precio": "valor liquidativo y precio (cambia a diario)",
    "rendimiento": "rentabilidad, volatilidad y Sharpe (derivables de la serie)",
    "analitica": "analítica propietaria: estrellas, medalist, matriz de riesgo",
    "cartera": "composición de cartera (mensual/trimestral)",
    "esg": "sostenibilidad: globos, carbono, SFDR",
    "costes": "TER, comisiones y costes ex-ante MiFID (anual)",
    "regulatorio": "KID/PRIIPs, registros oficiales e informes periódicos",
    "identidad": "identidad legal: domicilio, UCITS, gestora, lanzamiento",
}


def ttl_familias(settings: dict | None) -> dict[str, float]:
    """TTL efectivo por familia: defecto + ajustes de settings (solo familias conocidas)."""
    out = dict(TTL_POR_DEFECTO)
    ajustes = (settings or {}).get("ttl_dias_por_familia") or {}
    for familia, dias in ajustes.items():
        if familia in out:
            try:
                out[familia] = float(dias)
            except (TypeError, ValueError):
                continue
    return out
