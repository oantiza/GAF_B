"""Campos derivados: se calculan tras fusionar las fuentes, sin red.

- % investment grade y % high yield desde el desglose de calidad crediticia.
- % de cartera por divisa, agregando las posiciones.
"""
from __future__ import annotations


def aplica(d: dict) -> None:
    _ig_hy(d)
    _divisas(d)
    _tipo_producto(d)
    _cobertura_divisa(d)


def _tipo_producto(d: dict) -> None:
    """fondo | etf | etc | monetario — derivado de tipo, clase de activo,
    categoría y nombre."""
    ident = d.setdefault("identificacion", {})
    nombre = (ident.get("nombre") or "").lower()
    categoria = (ident.get("categoria_morningstar") or "").lower()
    clase = (ident.get("clase_activo") or "").lower()
    tipo = (ident.get("tipo") or "").lower()

    if not (nombre or categoria or clase or tipo):
        ident["tipo_producto"] = "unknown"  # sin evidencia alguna
    elif "monetario" in categoria or "money market" in categoria \
            or "money market" in clase:
        ident["tipo_producto"] = "monetario"
    elif tipo == "etf" and (" etc" in nombre or nombre.endswith("etc")
                            or "commodities" in clase):
        ident["tipo_producto"] = "etc"
    elif tipo == "etf":
        ident["tipo_producto"] = "etf"
    elif tipo == "accion":
        ident["tipo_producto"] = "accion"
    elif tipo == "fondo" or clase or categoria or " fi" in f" {nombre} " \
            or "fund" in nombre or "sicav" in nombre or "fonds" in nombre:
        ident["tipo_producto"] = "fondo"
    else:
        ident["tipo_producto"] = "unknown"


def _cobertura_divisa(d: dict) -> None:
    """clase_cubierta: true | false | 'parcial' — las gestoras lo indican
    siempre en el nombre de la clase; sin señal => no cubierta."""
    ident = d.setdefault("identificacion", {})
    nombre = (ident.get("nombre") or "")
    n = f" {nombre.lower()} "
    if not nombre:
        ident["clase_cubierta"] = None
        return
    import re as _re
    DIV = r"(EUR|USD|GBP|CHF|JPY|SEK|NOK)"
    if "partially hedged" in n or "parcialmente cubierto" in n:
        ident["clase_cubierta"] = "parcial"
    elif "unhedged" in n or "sin cubrir" in n or "no cubierto" in n:
        ident["clase_cubierta"] = False
        return
    else:
        # patrones: "EUR Hedged", "Hedged EUR", "H EUR", "D H USD", "EUR H",
        # "Hdg", "cubierto/a", "(H)", y la clase con la H pegada y la divisa entre
        # paréntesis, "AH (EUR)", "ZH (USD)": así nombra Morgan Stanley sus clases
        # cubiertas, y su KID lo confirma («clase de participaciones con cobertura
        # cambiaria»). Medido el 07-11-2026: 2 clases del universo pasaban por sin
        # cubrir y habrían recibido relativas contra un índice en euros (decisión 27).
        m = (_re.search(DIV + r"[^)]{0,12}?(hedged|hdg|cubiert)", nombre, _re.I)
             or _re.search(r"(hedged|hdg)[^A-Za-z]{0,10}" + DIV, nombre, _re.I)
             or _re.search(r"\b[A-Z]?\s?\bH\b\s+" + DIV, nombre)
             or _re.search(DIV + r"\s+\bH\b(\s|$|\))", nombre)
             or _re.search(r"\b[A-Z]{1,2}H\s*\(" + DIV + r"\)", nombre))
        if m:
            ident["clase_cubierta"] = True
            divisa = next((g for g in m.groups()
                           if g and g.upper() in ("EUR", "USD", "GBP", "CHF",
                                                  "JPY", "SEK", "NOK")), None)
            if divisa:
                ident["divisa_cubierta"] = divisa.upper()
            return
        if ("hedged" in n or "hdg" in n or "cubierto" in n
                or "cubierta" in n or "(h)" in n):
            ident["clase_cubierta"] = True
        else:
            ident["clase_cubierta"] = False


def _ig_hy(d: dict) -> None:
    rf = ((d.get("cartera") or {}).get("renta_fija")) or {}
    cal = rf.get("calidad_crediticia_pct") or {}
    ig = [cal.get(k) for k in ("AAA", "AA", "A", "BBB")]
    hy = [cal.get(k) for k in ("BB", "B", "inferior_B")]
    if any(isinstance(v, (int, float)) for v in ig):
        rf["pct_investment_grade"] = round(
            sum(v for v in ig if isinstance(v, (int, float))), 2)
    if any(isinstance(v, (int, float)) for v in hy):
        rf["pct_high_yield"] = round(
            sum(v for v in hy if isinstance(v, (int, float))), 2)
    if rf:
        d.setdefault("cartera", {})["renta_fija"] = rf


def _divisas(d: dict) -> None:
    posiciones = (d.get("cartera") or {}).get("posiciones") or []
    agregado: dict[str, float] = {}
    total = 0.0
    for p in posiciones:
        if not isinstance(p, dict):
            continue
        divisa = p.get("divisa")
        peso = p.get("peso_pct")
        if divisa and isinstance(peso, (int, float)):
            agregado[divisa] = agregado.get(divisa, 0.0) + peso
            total += peso
    if agregado and total > 20:  # solo si las posiciones cubren algo de cartera
        d.setdefault("cartera", {})["divisas_pct"] = {
            k: round(v, 2) for k, v in
            sorted(agregado.items(), key=lambda x: -x[1])}
