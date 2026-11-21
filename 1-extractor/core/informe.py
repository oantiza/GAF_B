"""Informe (tearsheet) HTML estilo Morningstar de un fondo.

Genera una página HTML autocontenida (sin dependencias, sin red) lista para
imprimir a PDF con el navegador (Ctrl+P → Guardar como PDF / @page A4).
Funciona tanto para fondos de renta variable como de renta fija; cada bloque
se dibuja solo si hay datos.

    from core.informe import genera_html
    html = genera_html(dict_del_fondo, isin)
"""
from __future__ import annotations

import datetime as _dt
import json as _json
import os as _os
from html import escape

# --------------------------------------------------------------- utilidades
def _g(o, ruta, defecto=None):
    """Acceso anidado seguro: _g(d, 'rating.estrellas.overall')."""
    cur = o
    for k in ruta.split("."):
        if isinstance(cur, dict) and k in cur:
            cur = cur[k]
        else:
            return defecto
    return cur


def _num(v, dec=2, suf="", signo=False):
    """Formatea número con coma decimal y punto de miles (es-ES)."""
    if v is None or v == "":
        return "·"
    try:
        f = float(v)
    except (TypeError, ValueError):
        return escape(str(v))
    if f != f:  # NaN
        return "·"
    s = f"{f:,.{dec}f}".replace(",", "\x00").replace(".", ",").replace("\x00", ".")
    if signo and f > 0:
        s = "+" + s
    return s + suf


def _pct(v, dec=2, signo=False):
    return _num(v, dec, "%", signo)


def _fecha(s):
    if not s:
        return "·"
    return escape(str(s)[:10])


def _e(v):
    return escape(str(v)) if v not in (None, "") else "·"


# nombres legibles para claves técnicas
_SECTORES = {
    "materiales_basicos": "Materiales básicos", "consumo_ciclico": "Consumo cíclico",
    "servicios_financieros": "Servicios financieros", "inmobiliario": "Inmobiliario",
    "consumo_defensivo": "Consumo defensivo", "salud": "Salud", "utilities": "Utilities",
    "comunicacion": "Comunicación", "industria": "Industria", "tecnologia": "Tecnología",
    "energia": "Energía",
    # renta fija
    "gobierno": "Gobierno", "municipal": "Municipal", "corporativa": "Corporativa",
    "titulizada": "Titulizada", "liquidez": "Liquidez", "derivados": "Derivados",
}
_REGIONES = {
    "estados_unidos": "Estados Unidos", "latinoamerica": "Latinoamérica",
    "reino_unido": "Reino Unido", "eurozona": "Eurozona",
    "europa_ex_euro": "Europa ex-euro", "oriente_medio": "Oriente Medio",
    "asia_desarrollada": "Asia desarrollada", "asia_emergente": "Asia emergente",
    "africa": "África", "canada": "Canadá", "japon": "Japón",
    "australasia": "Australasia",
}
_CAP = {"gigante": "Gigante", "grande": "Grande", "mediana": "Mediana",
        "pequeña": "Pequeña", "micro": "Micro"}
_ACTIVOS = {"rv": "Renta variable", "rf": "Renta fija", "convertibles": "Convertibles",
            "preferentes": "Preferentes", "liquidez": "Liquidez", "otros": "Otros"}
_VENC = {"0_1": "0-1 a", "1_3": "1-3 a", "3_5": "3-5 a", "5_7": "5-7 a",
         "7_10": "7-10 a", "10_15": "10-15 a", "15_20": "15-20 a",
         "20_30": "20-30 a", "mas_30": "+30 a", "10_20": "10-20 a",
         "mas_20": "+20 a", "desconocido": "Desconocido", "negativo": "Negativo"}

_PERIODOS = [("1m", "1 mes"), ("3m", "3 meses"), ("6m", "6 meses"), ("ytd", "Año actual"),
             ("1a", "1 año"), ("3a_anualizada", "3 años (anual.)"),
             ("5a_anualizada", "5 años (anual.)"), ("10a_anualizada", "10 años (anual.)"),
             ("desde_lanzamiento_anualizada", "Desde lanz. (anual.)")]


def _label(clave, mapa):
    return mapa.get(clave, clave.replace("_", " ").capitalize())


# ------------------------------------------------------------- componentes HTML
def _estrellas(n):
    if not n:
        return ""
    n = int(n)
    return ("<span class='stars'>" + "★" * n +
            "<span class='star-off'>" + "★" * (5 - n) + "</span></span>")


def _puntos(n, total=5):
    """Indicador de globos/puntos (p.ej. sostenibilidad) más sobrio que el emoji."""
    if not n:
        return None
    n = int(n)
    return ("<span class='dots'>" + "●" * n +
            "<span class='dot-off'>" + "●" * max(0, total - n) + "</span></span>")


def _metrica_periodo(bloque, prefs=("3a", "5a", "1a", "10a")):
    """Para métricas guardadas como {periodo:{fondo:...}}, devuelve (valor, periodo)."""
    if not isinstance(bloque, dict):
        return (bloque if isinstance(bloque, (int, float)) else None, None)
    for p in prefs:
        v = _g(bloque, f"{p}.fondo")
        if isinstance(v, (int, float)):
            return (v, p)
    return (None, None)


def _barras(items, fmt=lambda v: _pct(v), color="var(--acento)", maxv=None):
    """items = lista (etiqueta, valor). Devuelve filas con barra horizontal."""
    items = [(k, v) for k, v in items if isinstance(v, (int, float)) and v is not None]
    if not items:
        return ""
    tope = maxv or max((abs(v) for _, v in items), default=1) or 1
    filas = []
    for k, v in items:
        w = max(0, min(100, abs(v) / tope * 100))
        c = "var(--rojo)" if v < 0 else color
        filas.append(
            f"<div class='bar-row'><div class='bar-lab'>{escape(str(k))}</div>"
            f"<div class='bar-track'><div class='bar-fill' style='width:{w:.1f}%;background:{c}'></div></div>"
            f"<div class='bar-val'>{fmt(v)}</div></div>")
    return "<div class='bars'>" + "".join(filas) + "</div>"


def _kv(pares, clase=""):
    """pares = lista (clave, valor_html). Tabla clave/valor."""
    pares = [(k, v) for k, v in pares if v not in (None, "", "·")]
    if not pares:
        return ""
    cls = ("kv " + clase).strip()
    return (f"<div class='{cls}'>" + "".join(
        f"<div class='kv-i'><span class='k'>{escape(str(k))}</span>"
        f"<span class='v'>{v}</span></div>"
        for k, v in pares) + "</div>")


def _seccion(titulo, contenido, clase=""):
    if not contenido:
        return ""
    return (f"<section class='blk {clase}'><h3>{escape(titulo)}</h3>{contenido}</section>")


def _sub(titulo, contenido):
    if not contenido:
        return ""
    return (f"<div class='subsec'><div class='sub-h'>{escape(titulo)}</div>{contenido}</div>")


# ------------------------------------------------------------------ bloques
def _bloque_rentabilidad(d):
    tr = _g(d, "rentabilidad.trailing_pct", {}) or {}
    filas = []
    for clave, etiq in _PERIODOS:
        fondo = _g(tr, f"{clave}.fondo")
        cat = _g(tr, f"{clave}.categoria")
        if fondo is None and cat is None:
            continue
        dif = (fondo - cat) if (isinstance(fondo, (int, float))
                                and isinstance(cat, (int, float))) else None
        cf = "pos" if (isinstance(fondo, (int, float)) and fondo >= 0) else "neg"
        filas.append(
            f"<tr><td class='lab'>{etiq}</td>"
            f"<td class='{cf}'>{_pct(fondo, 2, True)}</td>"
            f"<td class='muted'>{_pct(cat)}</td>"
            f"<td class='{'pos' if (dif or 0) >= 0 else 'neg'}'>{_pct(dif, 2, True) if dif is not None else '·'}</td></tr>")
    tabla = ""
    if filas:
        tabla = ("<table class='perf'><thead><tr><th>Periodo</th><th>Fondo</th>"
                 "<th>Categoría</th><th>+/-</th></tr></thead><tbody>"
                 + "".join(filas) + "</tbody></table>")

    # rentabilidad por año natural -> barras
    anual = _g(d, "rentabilidad.por_año_natural", {}) or {}
    pares = []
    for año in sorted(anual.keys(), reverse=True)[:10]:
        v = _g(anual, f"{año}.fondo")
        if isinstance(v, (int, float)):
            pares.append((año, v))
    pares = pares[::-1]
    barras = _barras(pares, fmt=lambda v: _pct(v, 1, True)) if pares else ""
    cuerpo = ""
    if tabla:
        cuerpo += tabla
    if barras:
        cuerpo += "<div class='sub-h'>Rentabilidad por año natural</div>" + barras
    fdato = _g(d, "rentabilidad.fecha_dato")
    if cuerpo and fdato:
        cuerpo += f"<div class='nota'>Datos a {_fecha(fdato)}</div>"
    return _seccion("Rentabilidad", cuerpo)


def _bloque_riesgo(d):
    r = d.get("riesgo", {}) or {}
    vol = r.get("volatilidad_pct", {}) or {}
    sh = r.get("sharpe", {}) or {}
    filas = []
    for p in ["1a", "3a", "5a", "10a"]:
        vf, vc, vi = _g(vol, f"{p}.fondo"), _g(vol, f"{p}.categoria"), _g(vol, f"{p}.indice")
        s = _g(sh, f"{p}.fondo")
        if all(x is None for x in (vf, vc, vi, s)):
            continue
        filas.append(f"<tr><td class='lab'>{p}</td><td>{_num(vf)}</td>"
                     f"<td class='muted'>{_num(vc)}</td><td class='muted'>{_num(vi)}</td>"
                     f"<td>{_num(s)}</td></tr>")
    tabla = ""
    if filas:
        tabla = ("<table class='perf'><thead><tr><th>Periodo</th><th>Volat. fondo</th>"
                 "<th>Vol. cat.</th><th>Vol. índice</th><th>Sharpe</th></tr></thead><tbody>"
                 + "".join(filas) + "</tbody></table>")
    alpha, pa = _metrica_periodo(r.get("alpha"))
    beta, pb = _metrica_periodo(r.get("beta"))
    r2, pr = _metrica_periodo(r.get("r2"))
    te, pt = _metrica_periodo(r.get("tracking_error_pct"))
    ir, pi = _metrica_periodo(r.get("information_ratio"))
    _suf = lambda p: f" ({p})" if p else ""
    extra = _kv([
        (f"Alpha{_suf(pa)}", _num(alpha)),
        (f"Beta{_suf(pb)}", _num(beta)),
        (f"R²{_suf(pr)}", _num(r2)),
        (f"Tracking error{_suf(pt)}", _pct(te)),
        (f"Information ratio{_suf(pi)}", _num(ir)),
        ("Indicador riesgo (SRI/SRRI 1-7)", _e(r.get("sri_kid_1a7") or r.get("srri_1a7"))),
    ])
    return _seccion("Riesgo", tabla + extra, "keep")


def _bloque_asignacion(d):
    aa = _g(d, "cartera.asignacion_activos", {}) or {}
    pares = []
    for k, etiq in _ACTIVOS.items():
        neto = _g(aa, f"{k}.neto")
        if isinstance(neto, (int, float)) and neto > 0.001:
            pares.append((etiq, neto))
    donut = _donut(pares)
    sbx = _caja_estilo_rv(d) or _caja_estilo_rf(d)
    if not donut and not sbx:
        return ""
    izq = (f"<div class='col-donut'><div class='sub-h'>Asignación de activos</div>{donut}</div>"
           if donut else "")
    der = (f"<div class='col-sbx'><div class='sub-h'>Estilo (Style Box)</div>{sbx}</div>"
           if sbx else "")
    return _seccion("Asignación de activos y estilo",
                    f"<div class='cols2'>{izq}{der}</div>", "keep")


_PALETA = ["#0b6e4f", "#3f8f6f", "#6fae90", "#a9cdbb", "#d8a657",
           "#c2362b", "#7a7f87", "#b9bdc4", "#cfd3d8"]


def _donut(pares, r=44, grosor=15):
    """Donut SVG + leyenda. pares = [(etiqueta, valor%)]."""
    import math
    pares = [(k, float(v)) for k, v in pares
             if isinstance(v, (int, float)) and v > 0]
    if not pares:
        return ""
    total = sum(v for _, v in pares) or 1
    C = 2 * math.pi * r
    size = (r + grosor / 2) * 2 + 2
    cx = cy = size / 2
    segs, leyenda, off = [], [], 0.0
    for i, (k, v) in enumerate(pares):
        seg = (v / total) * C
        col = _PALETA[i % len(_PALETA)]
        segs.append(
            f"<circle cx='{cx:.1f}' cy='{cy:.1f}' r='{r:.1f}' fill='none' "
            f"stroke='{col}' stroke-width='{grosor}' "
            f"stroke-dasharray='{seg:.2f} {C - seg:.2f}' "
            f"stroke-dashoffset='{-off:.2f}'/>")
        off += seg
        leyenda.append(
            f"<div class='leg-row'><span class='leg-c' style='background:{col}'></span>"
            f"<span class='leg-k'>{escape(str(k))}</span>"
            f"<span class='leg-v'>{_pct(v)}</span></div>")
    svg = (f"<svg viewBox='0 0 {size:.0f} {size:.0f}' class='donut' "
           f"xmlns='http://www.w3.org/2000/svg'><g transform='rotate(-90 {cx:.1f} {cy:.1f})'>"
           + "".join(segs) + "</g></svg>")
    return f"<div class='donut-wrap'>{svg}<div class='leg'>{''.join(leyenda)}</div></div>"


def _caja_estilo(filas_lab, cols_lab, vals=None, activo=None, titulo_cols=""):
    """Renderiza una rejilla 3x3 estilo Morningstar.
    vals = matriz 3x3 de % (sombreado por peso); activo = (fila,col) a resaltar."""
    mx = max((x for row in (vals or []) for x in row), default=0) or 1
    celdas = ""
    for r in range(3):
        for c in range(3):
            if vals is not None:
                v = vals[r][c]
                a = 0.10 + 0.85 * (v / mx) if v > 0 else 0.0
                bg = f"rgba(11,110,79,{a:.3f})" if v > 0 else "#fafbfa"
                col = "#fff" if a > 0.5 else "#3c4148"
                txt = f"{v:.0f}" if v >= 0.5 else ""
                celdas += f"<div class='sbx-cell' style='background:{bg};color:{col}'>{txt}</div>"
            else:
                on = activo == (r, c)
                bg = "var(--acento)" if on else "#fafbfa"
                celdas += (f"<div class='sbx-cell' style='background:{bg};color:#fff'>"
                           f"{'●' if on else ''}</div>")
    rls = "".join(f"<div>{escape(l)}</div>" for l in filas_lab)
    cls = "".join(f"<div>{escape(l)}</div>" for l in cols_lab)
    return ("<div class='sbx'><div class='sbx-rls'>" + rls + "</div>"
            "<div><div class='sbx-grid'>" + celdas + "</div>"
            "<div class='sbx-cls'>" + cls + "</div>"
            + (f"<div class='sbx-cap'>{escape(titulo_cols)}</div>" if titulo_cols else "")
            + "</div></div>")


def _caja_estilo_rv(d):
    celdas = _g(d, "cartera.style_box_rv.celdas_pct", {}) or {}
    if not any(isinstance(v, (int, float)) and v > 0 for v in celdas.values()):
        return ""
    grid = [["LV", "LB", "LG"], ["MV", "MB", "MG"], ["SV", "SB", "SG"]]
    vals = [[float(celdas.get(k) or 0) for k in row] for row in grid]
    return _caja_estilo(["Grande", "Mediana", "Pequeña"],
                        ["Valor", "Mixto", "Crecim."], vals=vals,
                        titulo_cols="Estilo de inversión")


def _caja_estilo_rf(d):
    rf = _g(d, "cartera.renta_fija", {}) or {}
    cal = (rf.get("calidad_media") or "").strip().upper()
    dur = rf.get("duracion_efectiva")
    if dur is None:
        dur = rf.get("duracion_modificada")
    if not cal and not isinstance(dur, (int, float)):
        return ""
    fila = None
    if cal:
        if cal.startswith(("AAA", "AA")):
            fila = 0
        elif cal.startswith("A") or cal.startswith("BBB"):
            fila = 1
        else:
            fila = 2
    col = None
    if isinstance(dur, (int, float)):
        col = 0 if dur < 3.5 else (1 if dur <= 6 else 2)
    activo = (fila, col) if (fila is not None and col is not None) else None
    caja = _caja_estilo(["Alta", "Media", "Baja"],
                        ["Limit.", "Moder.", "Extensa"], activo=activo,
                        titulo_cols="Duración")
    cap = (f"<div class='nota'>Calidad media {escape(cal) or '·'} · "
           f"duración {_num(dur)} años</div>")
    return caja + cap


def _bloque_equity(d):
    c = d.get("cartera", {}) or {}
    out = []
    # sectores
    sect = c.get("sectores_pct", {}) or {}
    pares = []
    for k, v in sect.items():
        val = v.get("fondo") if isinstance(v, dict) else v
        if isinstance(val, (int, float)):
            pares.append((_label(k, _SECTORES), val))
    pares.sort(key=lambda x: -x[1])
    if pares:
        out.append(_sub("Sectores", _barras(pares)))
    # regiones
    reg = c.get("regiones_pct", {}) or {}
    pares = [(_label(k, _REGIONES), v) for k, v in reg.items()
             if isinstance(v, (int, float)) and v > 0]
    pares.sort(key=lambda x: -x[1])
    if pares:
        out.append(_sub("Distribución geográfica", _barras(pares)))
    # capitalizacion
    cap = c.get("capitalizacion_pct", {}) or {}
    pares = [(_label(k, _CAP), cap[k]) for k in _CAP if isinstance(cap.get(k), (int, float))]
    if pares:
        out.append(_sub("Capitalización", _barras(pares)))
    # valoracion y calidad
    val = c.get("valoracion_cartera", {}) or {}
    cal = c.get("calidad_cartera", {}) or {}
    kv = _kv([
        ("PER", _num(val.get("per"))), ("P/Valor contable", _num(val.get("pb"))),
        ("P/Ventas", _num(val.get("pventas"))), ("P/Cash flow", _num(val.get("pcf"))),
        ("Yield dividendo", _pct(val.get("yield_dividendo_pct"))),
        ("Crec. beneficios", _pct(val.get("crec_beneficios_pct"))),
        ("ROE", _pct(cal.get("roe_pct"))), ("ROA", _pct(cal.get("roa_pct"))),
        ("ROIC", _pct(cal.get("roic_pct"))),
        ("Margen neto", _pct(cal.get("margen_neto_pct"))),
        ("Deuda/Capital", _pct(cal.get("deuda_capital_pct"))),
    ])
    if kv:
        out.append(_sub("Fundamentales de la cartera", kv))
    return _seccion("Análisis de cartera (renta variable)", "".join(out))


def _bloque_rf(d):
    rf = _g(d, "cartera.renta_fija", {}) or {}
    if not rf:
        return ""
    # Solo mostramos el bloque si hay analítica real de renta fija (no una mera
    # bolsa de liquidez de un fondo de RV).
    cc = rf.get("calidad_crediticia_pct", {}) or {}
    venc = rf.get("vencimientos_pct", {}) or {}
    hay_rf = (
        any(rf.get(k) is not None for k in
            ("duracion_efectiva", "duracion_modificada", "ytm_pct",
             "vencimiento_efectivo", "precio_medio", "cupon_medio_pct",
             "pct_investment_grade"))
        or any(isinstance(v, (int, float)) and v > 0 for v in cc.values())
        or any(isinstance(v, (int, float)) and v > 0 for v in venc.values())
    )
    if not hay_rf:
        return ""
    out = []
    kv = _kv([
        ("Calidad crediticia media", _e(rf.get("calidad_media"))),
        ("Duración efectiva", _num(rf.get("duracion_efectiva"))),
        ("Duración modificada", _num(rf.get("duracion_modificada"))),
        ("Vencimiento efectivo (años)", _num(rf.get("vencimiento_efectivo"))),
        ("Yield to maturity", _pct(rf.get("ytm_pct"))),
        ("Cupón medio", _pct(rf.get("cupon_medio_pct"))),
        ("Precio medio", _num(rf.get("precio_medio"))),
        ("% Investment grade", _pct(rf.get("pct_investment_grade"))),
        ("% High yield", _pct(rf.get("pct_high_yield"))),
    ])
    if kv:
        out.append(kv)
    # calidad crediticia
    cc = rf.get("calidad_crediticia_pct", {}) or {}
    orden = ["AAA", "AA", "A", "BBB", "BB", "B", "inferior_B", "sin_rating"]
    pares = [(k.replace("inferior_B", "<B").replace("sin_rating", "Sin rating"), cc[k])
             for k in orden if isinstance(cc.get(k), (int, float)) and cc[k] > 0]
    if pares:
        out.append(_sub("Calidad crediticia", _barras(pares)))
    # vencimientos
    venc = rf.get("vencimientos_pct", {}) or {}
    pares = [(_label(k, _VENC), v) for k, v in venc.items()
             if isinstance(v, (int, float)) and v > 0]
    if pares:
        out.append(_sub("Distribución por vencimientos", _barras(pares)))
    # sectores RF
    sect = rf.get("sectores_pct", {}) or {}
    pares = [(_label(k, _SECTORES), v) for k, v in sect.items()
             if isinstance(v, (int, float)) and v > 0]
    pares.sort(key=lambda x: -x[1])
    if pares:
        out.append(_sub("Sectores de renta fija", _barras(pares)))
    return _seccion("Análisis de cartera (renta fija)", "".join(out))


def _bloque_posiciones(d):
    pos = _g(d, "cartera.posiciones", []) or []
    pos = [p for p in pos if isinstance(p, dict)][:10]
    if not pos:
        return ""
    filas = []
    for p in pos:
        sect = _label(p.get("sector", ""), _SECTORES) if p.get("sector") else ""
        det = " · ".join(x for x in [p.get("pais"), sect] if x)
        filas.append(
            f"<tr><td class='lab'>{_e(p.get('nombre'))}"
            f"{f'<span class=ssub>{escape(det)}</span>' if det else ''}</td>"
            f"<td class='muted'>{_e(p.get('ticker') or p.get('isin'))}</td>"
            f"<td class='peso'>{_pct(p.get('peso_pct'))}</td></tr>")
    tot = sum(p.get("peso_pct") or 0 for p in pos)
    n = _g(d, "cartera.num_posiciones")
    tabla = ("<table class='perf hold'><thead><tr><th>Posición</th><th>Ticker / ISIN</th>"
             "<th>Peso</th></tr></thead><tbody>" + "".join(filas) +
             f"<tr class='tot'><td colspan='2'>Top 10</td><td class='peso'>{_pct(tot)}</td></tr>"
             "</tbody></table>")
    cab = f"<div class='nota'>Cartera de {n} posiciones · a {_fecha(_g(d, 'cartera.fecha'))}</div>" if n else ""
    return _seccion("Principales posiciones", tabla + cab, "keep")


def _bloque_divisas(d):
    div = _g(d, "cartera.divisas_pct", {}) or {}
    pares = [(k, v) for k, v in div.items() if isinstance(v, (int, float)) and v > 0]
    pares.sort(key=lambda x: -x[1])
    return _seccion("Exposición por divisa", _barras(pares[:8]))


def _bloque_costes(d):
    co = d.get("costes", {}) or {}
    emt = co.get("mifid_emt_exante", {}) or {}
    kv = _kv([
        ("Gastos corrientes (TER)", _pct(co.get("ter_pct"))),
        ("Comisión de gestión", _pct(co.get("comision_gestion_aplicada_pct"))),
        ("Comisión de gestión (máx.)", _pct(co.get("comision_gestion_max_pct"))),
        ("Comisión de suscripción (máx.)", _pct(co.get("comision_suscripcion_max_pct"))),
        ("Costes corrientes MiFID", _pct(emt.get("corrientes_pct"))),
        ("Costes de transacción MiFID", _pct(emt.get("transaccion_pct"))),
        ("Costes incidentales MiFID", _pct(emt.get("incidentales_pct"))),
    ])
    return _seccion("Costes", kv)


def _bloque_esg(d):
    esg = d.get("esg", {}) or {}
    if not esg:
        return ""
    carb = esg.get("carbono", {}) or {}
    globos = esg.get("globos_sostenibilidad")
    globos_html = _puntos(globos) or "·"
    kv = _kv([
        ("Rating de sostenibilidad", globos_html),
        ("Sustainability score", _num(esg.get("sustainability_score"))),
        ("Score ambiental", _num(esg.get("score_ambiental"))),
        ("Score social", _num(esg.get("score_social"))),
        ("Score gobernanza", _num(esg.get("score_gobernanza"))),
        ("Cobertura de la cartera", _pct(esg.get("cobertura_cartera_pct"))),
        ("Riesgo de carbono", _num(carb.get("carbon_risk_score"))),
        ("Clasificación carbono", _e(carb.get("clasificacion"))),
    ])
    return _seccion("ESG / Sostenibilidad", kv)


# ----------------------------------------------------- histórico (5 años) SVG
def _carga_serie(base, isin, anios=5):
    """Lee el cache local data/history_vl/<ISIN>.jsonl -> [(fecha, vl)] ordenado
    y recortado a los últimos `anios` años. Devuelve [] si no hay cache."""
    if not base:
        return []
    ruta = _os.path.join(str(base), "data", "history_vl", f"{isin}.jsonl")
    if not _os.path.exists(ruta):
        return []
    pts = []
    try:
        with open(ruta, encoding="utf-8") as f:
            for ln in f:
                ln = ln.strip()
                if not ln:
                    continue
                try:
                    o = _json.loads(ln)
                except ValueError:
                    continue
                fecha = o.get("fecha") or o.get("date") or o.get("dia")
                vl = o.get("vl")
                if vl is None:
                    vl = o.get("nav", o.get("valor", o.get("value")))
                try:
                    vl = float(vl)
                except (TypeError, ValueError):
                    continue
                if fecha and vl == vl and vl > 0:
                    pts.append((str(fecha)[:10], vl))
    except OSError:
        return []
    pts.sort(key=lambda x: x[0])
    if pts:
        corte = (_dt.date.today() - _dt.timedelta(days=365 * anios + 7)).isoformat()
        pts = [p for p in pts if p[0] >= corte]
    return pts


def _muestrea(pts, maximo=340):
    """Reduce el nº de puntos preservando el primero y el último."""
    n = len(pts)
    if n <= maximo:
        return pts
    paso = n / maximo
    idx = sorted({int(i * paso) for i in range(maximo)} | {0, n - 1})
    return [pts[i] for i in idx]


def _grafico_svg(pts):
    """SVG de 'crecimiento de 100' (base 100 al inicio). pts = [(fecha, vl)]."""
    if len(pts) < 8:
        return ""
    base = pts[0][1]
    if not base:
        return ""
    serie = [(f, v / base * 100.0) for f, v in pts]
    serie = _muestrea(serie)
    vals = [v for _, v in serie]
    fechas = [f for f, _ in serie]
    n = len(serie)
    vmin, vmax = min(vals), max(vals)
    if vmax - vmin < 1e-9:
        vmax += 1
        vmin -= 1
    margen = (vmax - vmin) * 0.10
    lo, hi = vmin - margen, vmax + margen
    W, H = 824.0, 232.0
    padL, padR, padT, padB = 46.0, 12.0, 14.0, 26.0
    iw, ih = W - padL - padR, H - padT - padB

    def X(i):
        return padL + (i / (n - 1)) * iw

    def Y(v):
        return padT + (hi - v) / (hi - lo) * ih

    pts_xy = [(X(i), Y(v)) for i, v in enumerate(vals)]
    linea = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts_xy)
    area = (f"M{pts_xy[0][0]:.1f},{Y(lo):.1f} L"
            + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts_xy)
            + f" L{pts_xy[-1][0]:.1f},{Y(lo):.1f} Z")
    subio = vals[-1] >= 100
    color = "#0b6e4f" if subio else "#c2362b"
    relleno = "rgba(11,110,79,.10)" if subio else "rgba(194,54,43,.10)"

    # líneas guía horizontales + etiquetas eje Y
    guias = []
    for gv in _niveles(lo, hi):
        y = Y(gv)
        guias.append(f"<line x1='{padL:.1f}' y1='{y:.1f}' x2='{W - padR:.1f}' y2='{y:.1f}' "
                     f"class='grid'/>")
        guias.append(f"<text x='{padL - 6:.1f}' y='{y + 3:.1f}' class='ylab'>{gv:.0f}</text>")
    # línea base 100 destacada
    y100 = Y(100)
    base_line = (f"<line x1='{padL:.1f}' y1='{y100:.1f}' x2='{W - padR:.1f}' y2='{y100:.1f}' "
                 f"class='base100'/>")
    # ticks de años en eje X
    ticks = []
    visto = set()
    for i, f in enumerate(fechas):
        anio = f[:4]
        if anio not in visto:
            visto.add(anio)
            x = X(i)
            ticks.append(f"<text x='{x:.1f}' y='{H - 8:.1f}' class='xlab'>{escape(anio)}</text>")
    # punto final
    xf, yf = pts_xy[-1]
    ret = vals[-1] - 100
    badge_txt = f"{'+' if ret >= 0 else ''}{ret:,.1f}%".replace(",", "\x00").replace(".", ",").replace("\x00", ".")

    svg = (
        f"<svg viewBox='0 0 {W:.0f} {H:.0f}' class='chart' "
        f"preserveAspectRatio='xMidYMid meet' xmlns='http://www.w3.org/2000/svg'>"
        + "".join(guias) + base_line
        + f"<path d='{area}' fill='{relleno}' stroke='none'/>"
        + f"<path d='{linea}' fill='none' stroke='{color}' stroke-width='1.8' "
          f"stroke-linejoin='round'/>"
        + f"<circle cx='{xf:.1f}' cy='{yf:.1f}' r='3' fill='{color}'/>"
        + "".join(ticks)
        + "</svg>")

    nota = (f"<div class='chart-meta'><span class='chart-ret' style='color:{color}'>{badge_txt}</span>"
            f"<span class='chart-sub'>en el periodo · base 100 = {escape(fechas[0])} · "
            f"último {escape(fechas[-1])}</span></div>")
    return svg + nota


def _niveles(lo, hi, n=4):
    """Niveles 'redondos' para las líneas guía del eje Y."""
    rango = hi - lo
    if rango <= 0:
        return [lo]
    paso_bruto = rango / n
    mag = 10 ** (len(str(int(paso_bruto))) - 1) if paso_bruto >= 1 else 1
    paso = max(1, round(paso_bruto / mag) * mag)
    ini = int(lo / paso) * paso
    out = []
    v = ini
    while v <= hi:
        if v >= lo:
            out.append(v)
        v += paso
    return out or [lo, hi]


# Etiquetas de procedencia cuyo VL sale convertido a la divisa que se pide, no
# en la de la clase: el screener de Morningstar se pide con `currencyId=EUR`,
# así que su `ClosePrice` va en euros aunque su `divisa_base` sea USD.
VL_EN_DIVISA_PEDIDA = frozenset({"morningstar_lt:screener"})


def divisa_del_vl(d: dict) -> str | None:
    """La divisa con la que se pinta el VL (informe y visor), o None.

    `valoracion.vl_divisa` si la hay. Si no, `identificacion.divisa_base` solo
    cuando las dos salen de la misma fuente y documento (la misma etiqueta de
    procedencia) y esa fuente da el VL en la divisa de la clase. Es el caso de
    ES0132526031: VL y divisa del mismo informe semestral de la CNMV
    (revisión de la cuarta pasada, MEN-E). En cualquier otro caso, None: la
    divisa de la clase no vale para un VL de otra fuente, que puede ir en otra
    divisa (el mensual de la CNMV va siempre en euros, IMP-B)."""
    val = d.get("valoracion") or {}
    if val.get("vl_divisa"):
        return val["vl_divisa"]
    proc = (d.get("meta") or {}).get("procedencia") or {}
    etiqueta_vl = proc.get("valoracion.vl")
    divisa_base = (d.get("identificacion") or {}).get("divisa_base")
    if (divisa_base and etiqueta_vl and etiqueta_vl == proc.get("identificacion.divisa_base")
            and etiqueta_vl not in VL_EN_DIVISA_PEDIDA):
        return divisa_base
    return None


# ------------------------------------------------------------------ documento
def genera_html(d: dict, isin: str, base=None) -> str:
    ident = d.get("identificacion", {}) or {}
    val = d.get("valoracion", {}) or {}
    rating = d.get("rating", {}) or {}
    nombre = ident.get("nombre") or isin
    tipo = (ident.get("tipo_producto") or "").upper()
    estrellas = _g(rating, "estrellas.overall")
    medal = _g(rating, "medalist.rating")
    fuentes_raw = _g(d, "meta.fuentes", {}) or {}
    if isinstance(fuentes_raw, dict):
        fuentes = sorted({str(x) for v in fuentes_raw.values() for x in (v if isinstance(v, list) else [v])})
    else:
        fuentes = sorted(set(str(x) for x in fuentes_raw)) if isinstance(fuentes_raw, list) else []
    hoy = _dt.date.today().isoformat()

    # franja de datos clave (cabecera)
    pat = val.get("patrimonio_fondo_meur")
    divisa_vl = divisa_del_vl(d)
    clave_cards = [
        ("VL", f"{_num(val.get('vl'), 4)} {_e(divisa_vl)}",
         _fecha(val.get("vl_fecha"))),
        ("Patrimonio", f"{_num(pat, 1)} M{_e(val.get('patrimonio_divisa') or 'EUR')}",
         _fecha(val.get("patrimonio_fecha"))),
        ("TER", _pct(_g(d, "costes.ter_pct")), "anual"),
        ("Rating Morningstar", _estrellas(estrellas) or "·",
         f"{estrellas}★" if estrellas else ""),
    ]
    cards = "".join(
        f"<div class='card'><div class='c-lab'>{escape(t)}</div>"
        f"<div class='c-val'>{v}</div><div class='c-sub'>{escape(str(s))}</div></div>"
        for t, v, s in clave_cards)

    # ficha de identificación
    ident_kv = _kv([
        ("Gestora", _e(ident.get("gestora"))),
        ("Categoría Morningstar", _e(ident.get("categoria_morningstar"))),
        ("Clase de activo", _e(ident.get("clase_activo"))),
        ("Domicilio", _e(ident.get("domicilio"))),
        ("Divisa base", _e(ident.get("divisa_base"))),
        ("Clase cubierta", (f"Sí ({_e(ident.get('divisa_cubierta'))})"
                            if ident.get("clase_cubierta") else "No")),
        ("Lanzamiento", _fecha(ident.get("fecha_lanzamiento_clase")
                               or ident.get("fecha_lanzamiento_fondo"))),
        ("Inversión mínima", _num(ident.get("inversion_minima_inicial"), 0)),
        ("Índice de referencia", _e(ident.get("indice_benchmark_oficial"))),
        ("Medalist rating", _e(medal)),
        ("Yield distribución 12m", _pct(_g(d, "distribuciones.yield_12m_pct"))),
    ], "kv-sm")
    estrategia = ident.get("estrategia_inversion_texto")
    estrategia_html = ""
    if estrategia:
        txt = escape(str(estrategia))
        if len(txt) > 460:
            txt = txt[:460].rsplit(" ", 1)[0] + "…"
        estrategia_html = f"<div class='estrategia'><b>Estrategia de inversión.</b> {txt}</div>"

    bloques = "".join([
        _seccion("Identificación", ident_kv + estrategia_html),
        _bloque_rentabilidad(d),
        _bloque_riesgo(d),
        _bloque_asignacion(d),
        _bloque_equity(d),
        _bloque_rf(d),
        _bloque_posiciones(d),
        _bloque_divisas(d),
        _bloque_costes(d),
        _bloque_esg(d),
    ])

    estrellas_cab = (f"<span class='cab-stars'>{_estrellas(estrellas)}</span>"
                     if estrellas else "")
    medal_cab = (f"<span class='badge'>{escape(str(medal))}</span>" if medal else "")
    tipo_cab = f"<span class='badge tipo'>{escape(tipo)}</span>" if tipo else ""

    # gráfico de evolución a 5 años (solo si hay cache de históricos)
    svg = _grafico_svg(_carga_serie(base, isin, anios=5))
    grafico = (f"<section class='chartband'><h3>Evolución · crecimiento de 100 "
               f"(5 años)</h3>{svg}</section>") if svg else ""

    return _PLANTILLA.format(
        titulo=escape(nombre), isin=escape(isin),
        sub=escape(" · ".join(x for x in [ident.get("gestora"),
                   ident.get("categoria_morningstar")] if x)),
        estrellas=estrellas_cab, badges=tipo_cab + medal_cab,
        cards=cards, grafico=grafico, bloques=bloques,
        fuentes=escape(", ".join(map(str, fuentes))) if fuentes else "—",
        hoy=hoy,
    )


_PLANTILLA = """<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>{titulo} — Informe</title>
<style>
  :root {{
    --tinta:#16191d; --suave:#6c727b; --linea:#e4e6ea; --linea2:#f0f1f3;
    --acento:#0b6e4f; --rojo:#c2362b; --morning:#e0301e; --panel:#fff; --fondo:#f4f5f3;
  }}
  * {{ box-sizing:border-box; }}
  html,body {{ margin:0; background:var(--fondo); color:var(--tinta);
    font:12.5px/1.42 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    -webkit-print-color-adjust:exact; print-color-adjust:exact; }}
  .hoja {{ max-width:880px; margin:0 auto; background:var(--panel); }}
  /* barra de acciones (no se imprime) */
  .toolbar {{ position:sticky; top:0; z-index:9; display:flex; gap:10px; align-items:center;
    justify-content:flex-end; padding:10px 28px; background:#101311; }}
  .toolbar span {{ margin-right:auto; color:#cde8d8; font-size:12px; }}
  .toolbar button {{ padding:8px 18px; border:0; border-radius:7px; cursor:pointer;
    font-size:13px; font-weight:600; background:var(--acento); color:#fff; }}
  .toolbar button.sec {{ background:#2b2f2c; color:#cde8d8; }}
  /* cabecera */
  header.doc {{ padding:26px 32px 18px; border-bottom:3px solid var(--morning); }}
  .eyebrow {{ font-size:11px; letter-spacing:.14em; text-transform:uppercase;
    color:var(--morning); font-weight:700; }}
  header.doc h1 {{ font:600 25px/1.2 Georgia,"Times New Roman",serif; margin:6px 0 4px; }}
  .sub {{ color:var(--suave); font-size:13px; }}
  .cab-row {{ display:flex; align-items:center; gap:12px; margin-top:10px; flex-wrap:wrap; }}
  .cab-stars .stars {{ font-size:20px; }}
  .isin-pill {{ font:600 12px ui-monospace,Consolas,monospace; background:var(--fondo);
    border:1px solid var(--linea); border-radius:6px; padding:3px 9px; }}
  .badge {{ font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase;
    background:#eef3f0; color:var(--acento); border-radius:6px; padding:4px 9px; }}
  .badge.tipo {{ background:#16191d; color:#fff; }}
  .stars {{ color:var(--morning); letter-spacing:1px; }}
  .star-off {{ color:#dcdfe3; }}
  .dots {{ color:var(--acento); letter-spacing:1px; font-size:11px; }}
  .dot-off {{ color:#dcdfe3; }}
  /* tarjetas clave */
  .cards {{ display:grid; grid-template-columns:repeat(4,1fr); gap:1px; background:var(--linea);
    border-bottom:1px solid var(--linea); }}
  .card {{ background:var(--panel); padding:14px 18px; }}
  .c-lab {{ font-size:10.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--suave); }}
  .c-val {{ font:600 18px/1.2 Georgia,serif; margin:4px 0 2px; }}
  .c-sub {{ font-size:11px; color:var(--suave); }}
  /* banda del gráfico de evolución */
  .chartband {{ padding:12px 30px 10px; border-bottom:1px solid var(--linea); }}
  .chartband h3 {{ font:600 12px/1.2 -apple-system,sans-serif; letter-spacing:.06em;
    text-transform:uppercase; color:var(--tinta); margin:0 0 8px; padding-bottom:5px;
    border-bottom:2px solid var(--tinta); }}
  .chart {{ width:100%; height:auto; display:block; }}
  .chart .grid {{ stroke:#eef0f2; stroke-width:1; }}
  .chart .base100 {{ stroke:#c9ccd1; stroke-width:1; stroke-dasharray:3 3; }}
  .chart .ylab {{ fill:var(--suave); font-size:9px; text-anchor:end; }}
  .chart .xlab {{ fill:var(--suave); font-size:9px; text-anchor:middle; }}
  .chart .xlab.ini {{ text-anchor:start; }}
  .chart-meta {{ display:flex; align-items:baseline; gap:10px; margin-top:2px; }}
  .chart-ret {{ font:600 16px/1 Georgia,serif; }}
  .chart-sub {{ font-size:10.5px; color:var(--suave); }}
  /* cuerpo en dos columnas */
  main {{ padding:10px 30px 6px; }}
  .blk {{ margin:0 0 11px; }}
  .blk.keep {{ break-inside:avoid; }}
  .subsec {{ break-inside:avoid; margin-bottom:2px; }}
  .kv-sm {{ font-size:10.5px; }}
  .kv-sm .v {{ white-space:normal; }}
  .cols2 {{ display:flex; gap:24px; align-items:flex-start; break-inside:avoid; }}
  .cols2 .col-donut {{ flex:1 1 56%; }}
  .cols2 .col-sbx {{ flex:0 0 auto; }}
  .blk h3 {{ font:600 11.5px/1.2 -apple-system,sans-serif; letter-spacing:.06em;
    text-transform:uppercase; color:var(--tinta); margin:0 0 7px; padding-bottom:4px;
    border-bottom:2px solid var(--tinta); break-after:avoid; }}
  .sub-h {{ font-size:10.5px; font-weight:700; color:var(--suave); text-transform:uppercase;
    letter-spacing:.05em; margin:9px 0 4px; break-after:avoid; }}
  /* donut de asignación */
  .donut-wrap {{ display:flex; align-items:center; gap:14px; }}
  .donut {{ width:104px; height:104px; flex:none; }}
  .leg {{ display:flex; flex-direction:column; gap:2px; flex:1; }}
  .leg-row {{ display:grid; grid-template-columns:11px 1fr auto; align-items:center;
    gap:6px; font-size:11.5px; }}
  .leg-c {{ width:9px; height:9px; border-radius:2px; }}
  .leg-k {{ color:#3c4148; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }}
  .leg-v {{ font-variant-numeric:tabular-nums; font-weight:700; }}
  /* style box 3x3 */
  .sbx {{ display:flex; gap:5px; align-items:stretch; margin:2px 0 2px; }}
  .sbx-rls {{ display:flex; flex-direction:column; justify-content:space-around;
    font-size:8.5px; color:var(--suave); text-align:right; padding-bottom:13px; }}
  .sbx-grid {{ display:grid; grid-template-columns:repeat(3,30px);
    grid-template-rows:repeat(3,25px); gap:2px; }}
  .sbx-cell {{ display:flex; align-items:center; justify-content:center;
    font-size:9.5px; font-weight:700; border:1px solid var(--linea);
    border-radius:2px; font-variant-numeric:tabular-nums; }}
  .sbx-cls {{ display:grid; grid-template-columns:repeat(3,30px); gap:2px;
    font-size:8.5px; color:var(--suave); text-align:center; margin-top:2px; }}
  .sbx-cap {{ font-size:8.5px; color:var(--suave); text-transform:uppercase;
    letter-spacing:.04em; margin-top:3px; }}
  /* clave/valor */
  .kv {{ columns:2; column-gap:24px; }}
  .kv-i {{ display:flex; justify-content:space-between; gap:10px; break-inside:avoid;
    padding:1.5px 0; border-bottom:1px solid var(--linea2); }}
  .kv-i .k {{ color:var(--suave); }}
  .kv-i .v {{ font-weight:600; text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }}
  .estrategia {{ margin-top:10px; font-size:12px; color:#3c4148; line-height:1.55;
    background:var(--fondo); border-left:3px solid var(--acento); padding:9px 11px; border-radius:0 6px 6px 0; }}
  /* tablas */
  table.perf {{ width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }}
  table.perf th {{ font-size:10px; text-transform:uppercase; letter-spacing:.04em;
    color:var(--suave); text-align:right; padding:3px 4px; border-bottom:1px solid var(--linea); font-weight:600; }}
  table.perf th:first-child {{ text-align:left; }}
  table.perf td {{ padding:2.5px 4px; text-align:right; border-bottom:1px solid var(--linea2); }}
  table.perf td.lab {{ text-align:left; }}
  table.perf td.muted {{ color:var(--suave); }}
  table.perf td.pos {{ color:var(--acento); font-weight:600; }}
  table.perf td.neg {{ color:var(--rojo); font-weight:600; }}
  table.perf td.peso {{ font-weight:700; }}
  table.hold td, table.hold th {{ font-size:10px; padding:2px 4px; }}
  table.hold .ssub {{ display:block; font-size:8.5px; color:var(--suave); font-weight:400; }}
  table.perf tr.tot td {{ border-top:1.5px solid var(--tinta); border-bottom:0;
    font-weight:700; padding-top:5px; }}
  /* barras */
  .bars {{ columns:2; column-gap:20px; }}
  .bars .bar-row {{ break-inside:avoid; margin-bottom:3px; }}
  table.perf tr {{ break-inside:avoid; }}
  .sbx, .donut-wrap, .chartband {{ break-inside:avoid; }}
  .bar-row {{ display:grid; grid-template-columns:104px 1fr 44px; align-items:center; gap:8px; font-size:11px; }}
  .bar-lab {{ color:#3c4148; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }}
  .bar-track {{ background:var(--linea2); border-radius:3px; height:8px; overflow:hidden; }}
  .bar-fill {{ height:100%; border-radius:3px; }}
  .bar-val {{ text-align:right; font-variant-numeric:tabular-nums; font-weight:600; color:#3c4148; }}
  .nota {{ font-size:10.5px; color:var(--suave); margin-top:6px; }}
  .globos {{ font-size:13px; }}
  footer {{ padding:12px 30px 16px; border-top:1px solid var(--linea); color:var(--suave);
    font-size:10px; line-height:1.45; }}
  footer b {{ color:#3c4148; }}
  @media print {{
    .toolbar {{ display:none; }}
    body, .hoja {{ background:#fff; max-width:none; }}
    @page {{ size:A4; margin:13mm 12mm; }}
  }}
</style>
</head>
<body>
<div class="hoja">
  <div class="toolbar">
    <span>Informe generado por FondosDB · usa Ctrl+P → «Guardar como PDF» para exportar</span>
    <button class="sec" onclick="window.close()">Cerrar</button>
    <button onclick="window.print()">⤓ Guardar como PDF</button>
  </div>
  <header class="doc">
    <div class="eyebrow">Ficha de fondo · Informe</div>
    <h1>{titulo}</h1>
    <div class="sub">{sub}</div>
    <div class="cab-row">
      <span class="isin-pill">{isin}</span>
      {estrellas}
      {badges}
    </div>
  </header>
  <div class="cards">{cards}</div>
  {grafico}
  <main>{bloques}</main>
  <footer>
    <b>Fuentes de datos:</b> {fuentes}. Informe generado el {hoy} por FondosDB a partir de
    datos fundamentales recopilados de fuentes públicas. Documento meramente informativo;
    no constituye recomendación de inversión ni asesoramiento financiero. Rentabilidades
    pasadas no garantizan resultados futuros. Verifica las cifras con el folleto y el
    DFI/KID oficiales antes de invertir.
  </footer>
</div>
</body>
</html>"""
