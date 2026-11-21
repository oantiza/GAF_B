"""Bloques `regulatory` y `provenance` del canónico BDB.

El canónico (`export_bdb/{ISIN}.json`) llevaba el bloque `ms` (Morningstar) y
lo derivado de él, pero ni el indicador de riesgo del KID ni los costes
ex-ante ni el marco UCITS: las cifras que un asesor tiene que poder enseñar
llegaban a la app por otra vía, también Morningstar. Desde el 04-09 el
canónico incorpora:

- `regulatory`: el dato regulatorio (SRI del KID, composición de costes del
  KID, costes ex-ante MiFID/EMT, UCITS/SFDR, domicilio, gestora legal,
  fechas de lanzamiento y registro, registros oficiales e informe periódico),
  con independencia de quién lo haya aportado.
- `provenance`: quién escribió cada campo del canónico (`fuente:endpoint`),
  cuándo se descargó cada endpoint y cuánto depende el documento de cada
  fuente. Es lo que hace auditable el respaldo y medible el rediseño.

`ms.*` no cambia de semántica: sigue siendo el bloque Morningstar. Lo oficial
va aquí; si Morningstar falta, `ms.costs.mifid_ongoing` cae al KID y lo dice.
"""
from __future__ import annotations

from typing import Any

from core.adquisicion import procedencia

VERSION = 1


def _g(d, *ruta):
    for k in ruta:
        if not isinstance(d, dict) or k not in d:
            return None
        d = d[k]
    return d


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _limpia(d: dict | None) -> dict | None:
    """Quita None; devuelve None si no queda nada."""
    if not isinstance(d, dict):
        return None
    out = {k: v for k, v in d.items() if v is not None and v != {} and v != []}
    return out or None


# ------------------------------------------------------------------ regulatory
def bloque_regulatorio(d: dict) -> dict:
    ident = d.get("identificacion") or {}
    costes = d.get("costes") or {}
    kid = costes.get("kid") or {}
    emt = costes.get("mifid_emt_exante") or {}
    docs = d.get("documentos_oficiales") or {}
    cnmv_costes = costes.get("cnmv") or {}
    cnmv_cartera = _g(d, "cartera", "cnmv") or {}

    proc = _g(d, "meta", "procedencia") or {}
    fuente_kid = docs.get("kid_fuente")
    if not fuente_kid:
        # CNMV y AMF no escriben kid_fuente: la fuente es el adaptador que puso el KID.
        etiqueta = proc.get("costes.kid.fecha") or proc.get("riesgo.sri_kid_1a7") or ""
        f = procedencia.fuente_de(etiqueta)
        if f in ("cnmv_ficha", "amf_geco"):
            fuente_kid = f
    kid_bloque = _limpia({
        # La fecha es la del documento cuya url y sha256 se publican (14-10-2026): si una
        # correccion en origen cambia el KID, la de los costes es de otro documento.
        "date": docs.get("kid_fecha") or kid.get("fecha"),
        "language": kid.get("idioma"),
        "recommended_holding_years": _g(d, "riesgo", "kid_periodo_mantenimiento_anos"),
        "costs": _limpia({
            "entry_pct": _num(kid.get("entrada_pct")),
            "exit_pct": _num(kid.get("salida_pct")),
            "management_and_other_pct": _num(kid.get("gestion_y_otros_pct")),
            "transaction_pct": _num(kid.get("transaccion_pct")),
            "performance_fee_pct": _num(kid.get("rendimiento_pct")),
        }),
        "url": docs.get("kid_url"),
        "source": fuente_kid,
        "sha256": docs.get("kid_sha256"),
        "manufacturer": ident.get("productor_kid"),
    })
    mifid = _limpia({
        "ongoing_pct": _num(emt.get("corrientes_pct")),
        "transaction_pct": _num(emt.get("transaccion_pct")),
        "incidental_pct": _num(emt.get("incidentales_pct")),
        "entry_pct": _num(emt.get("entrada_pct")),
        "exit_pct": _num(emt.get("salida_pct")),
        "as_of": emt.get("fecha"),
    })
    registros = _limpia({
        "cnmv": _limpia({
            "number": ident.get("registro_cnmv"),
            "date": ident.get("fecha_registro_cnmv"),
            "vocation": ident.get("vocacion_cnmv"),
            "fund_class": ident.get("clase_fondo_cnmv"),
            "compartment": ident.get("compartimento_cnmv"),
            "share_class": ident.get("clase_cnmv"),
            "management_company_number": ident.get("gestora_registro_cnmv"),
            "last_prospectus_date": ident.get("fecha_ultimo_folleto"),
        }),
        "cssf": _limpia({
            "umbrella": ident.get("paraguas_legal"),
            "compartment": ident.get("compartimento_legal"),
            "share_class": ident.get("clase_legal"),
            "compartment_currency": ident.get("divisa_compartimento"),
            "authorisation_date": ident.get("fecha_autorizacion_cssf"),
        }) if ident.get("paraguas_legal") else None,
        "esma": _limpia({
            "legal_name": ident.get("nombre_legal_esma"),
            "status": ident.get("estado_registro_esma"),
            "marketed_in_spain": ident.get("comercializado_en_espana"),
            "host_countries": ident.get("paises_comercializacion"),
        }),
        "amf": _limpia({
            "authorisation_number": ident.get("numero_autorizacion_amf"),
            "authorisation_date": ident.get("fecha_autorizacion_amf"),
            "classification": ident.get("clasificacion_amf"),
            "legal_form": ident.get("forma_juridica"),
            "compartment_creation_date": ident.get("fecha_creacion_compartimento"),
        }),
        "gleif": _limpia({
            "legal_name": ident.get("nombre_legal_lei"),
            "status": ident.get("estado_lei"),
            "creation_date": ident.get("fecha_constitucion"),
        }) if ident.get("lei") else None,
    })
    informe = None
    if cnmv_cartera or cnmv_costes:
        informe = _limpia({
            "as_of": cnmv_cartera.get("fecha"),
            "period": cnmv_costes.get("periodo") or _g(d, "meta", "cnmv_periodo_trimestral"),
            "top10": [
                {"name": p.get("nombre"), "isin": p.get("isin"), "weight": _num(p.get("peso_pct")),
                 "currency": p.get("divisa"), "type": p.get("tipo")}
                for p in (cnmv_cartera.get("top10_posiciones") or [])
            ] or None,
            "top10_weight": _num(cnmv_cartera.get("peso_top10_pct")),
            "holdings_count": cnmv_cartera.get("num_posiciones"),
            "total_net_assets_eur": _num(cnmv_cartera.get("patrimonio_total_eur")),
            "turnover_pct": _num(cnmv_cartera.get("rotacion_pct")),
            "ter_quarter_pct": _num(cnmv_costes.get("ter_trimestre_pct")),
            "ter_12m_pct": _num(cnmv_costes.get("ter_12m_pct")),
            "management_fee_period_pct": _num(cnmv_costes.get("comision_gestion_periodo_pct")),
            "depositary_fee_period_pct": _num(cnmv_costes.get("comision_deposito_periodo_pct")),
            "period_months": cnmv_costes.get("periodo_meses"),
        })

    return {
        "version": VERSION,
        "sri": _g(d, "riesgo", "sri_kid_1a7"),
        "srri": _g(d, "riesgo", "srri_1a7"),
        "kid": kid_bloque,
        "mifid_ex_ante_costs": mifid,
        "ucits": ident.get("ucits"),
        "legal_framework": ident.get("marco_legal"),
        "sfdr_article": _g(d, "esg", "sfdr_articulo"),
        "domicile": ident.get("domicilio"),
        "management_company": ident.get("gestora"),
        "management_company_legal": ident.get("gestora_legal"),
        "management_company_lei": ident.get("gestora_lei"),
        "lei": ident.get("lei"),
        "depositary": ident.get("depositario"),
        "launch_date_class": ident.get("fecha_lanzamiento_clase") or ident.get("fecha_lanzamiento_kid"),
        "launch_date_fund": ident.get("fecha_lanzamiento_fondo"),
        "isin_issue_date": ident.get("fecha_emision_isin"),
        "registers": registros,
        "periodic_report": informe,
    }


# ------------------------------------------------------------------ provenance
# campo del canónico -> rutas v2 de las que sale (prefijos: toda la subrama)
MAPA_FONDO: dict[str, tuple[str, ...]] = {
    "name": ("identificacion.nombre",),
    "currency": ("identificacion.divisa_base",),
    "report_date": ("rentabilidad.fecha_dato",),
    "identifiers.ticker": ("identificacion.ticker",),
    "identifiers.exchange": ("identificacion.mercado",),
    "identifiers.eodhd_code": ("identificacion.simbolo_eodhd",),
    "identifiers.source_listing_id": ("identificacion.source_listing_id",),
    "ms.category_morningstar": ("identificacion.categoria_morningstar",),
    "ms.rating_stars": ("rating.estrellas.overall",),
    "ms.medalist_rating": ("rating.medalist.rating",),
    "ms.sustainability_rating": ("esg.globos_sostenibilidad",),
    "ms.portfolio.as_of": ("cartera.fecha",),
    "ms.portfolio.asset_allocation": ("cartera.asignacion_activos",),
    "ms.sectors": ("cartera.sectores_pct",),
    "ms.regions": ("cartera.regiones_pct",),
    "ms.equity_style.market_cap": ("cartera.capitalizacion_pct",),
    "ms.equity_style.style": ("cartera.style_box_rv",),
    "ms.fixed_income": ("cartera.renta_fija",),
    "ms.holdings_top10": ("cartera.posiciones",),
    "ms.holdings_stats.holdings_count_equity": ("cartera.num_posiciones_rv",),
    "ms.holdings_stats.holdings_count_bond": ("cartera.num_posiciones_rf",),
    "ms.holdings_stats.top10_weight": ("cartera.peso_top10_pct",),
    "ms.costs.management_fee": ("costes.comision_gestion_aplicada_pct", "costes.comision_gestion_max_pct"),
    "ms.costs.ter": ("costes.ter_pct",),
    "ms.costs.mifid_ongoing": ("costes.mifid_emt_exante.corrientes_pct",),
    "ms.objective": ("identificacion.estrategia_inversion_texto",),
    "derived.asset_class": ("identificacion.clase_activo", "identificacion.categoria_morningstar"),
    "classification_v2.commercial_type": ("identificacion.categoria_morningstar",),
    "classification_v2.vehicle_complexity": ("identificacion.replicacion", "identificacion.sintetico"),
    "regulatory.sri": ("riesgo.sri_kid_1a7",),
    "regulatory.srri": ("riesgo.srri_1a7",),
    "regulatory.kid": ("costes.kid", "documentos_oficiales", "riesgo.kid_periodo_mantenimiento_anos"),
    "regulatory.mifid_ex_ante_costs": ("costes.mifid_emt_exante",),
    "regulatory.ucits": ("identificacion.ucits",),
    "regulatory.legal_framework": ("identificacion.marco_legal",),
    "regulatory.sfdr_article": ("esg.sfdr_articulo",),
    "regulatory.domicile": ("identificacion.domicilio",),
    "regulatory.management_company": ("identificacion.gestora",),
    "regulatory.management_company_legal": ("identificacion.gestora_legal",),
    "regulatory.management_company_lei": ("identificacion.gestora_lei",),
    "regulatory.lei": ("identificacion.lei",),
    "regulatory.depositary": ("identificacion.depositario",),
    "regulatory.launch_date_class": ("identificacion.fecha_lanzamiento_clase", "identificacion.fecha_lanzamiento_kid"),
    "regulatory.launch_date_fund": ("identificacion.fecha_lanzamiento_fondo",),
    "regulatory.isin_issue_date": ("identificacion.fecha_emision_isin",),
    "regulatory.registers.cnmv": ("identificacion.registro_cnmv", "identificacion.fecha_registro_cnmv",
                                  "identificacion.vocacion_cnmv", "identificacion.clase_fondo_cnmv",
                                  "identificacion.compartimento_cnmv", "identificacion.clase_cnmv",
                                  "identificacion.gestora_registro_cnmv", "identificacion.fecha_ultimo_folleto"),
    "regulatory.registers.cssf": ("identificacion.paraguas_legal", "identificacion.compartimento_legal",
                                  "identificacion.clase_legal", "identificacion.divisa_compartimento",
                                  "identificacion.fecha_autorizacion_cssf"),
    "regulatory.registers.esma": ("identificacion.nombre_legal_esma", "identificacion.estado_registro_esma",
                                  "identificacion.comercializado_en_espana", "identificacion.paises_comercializacion"),
    "regulatory.registers.amf": ("identificacion.numero_autorizacion_amf", "identificacion.fecha_autorizacion_amf",
                                 "identificacion.clasificacion_amf", "identificacion.forma_juridica",
                                 "identificacion.fecha_creacion_compartimento"),
    "regulatory.registers.gleif": ("identificacion.nombre_legal_lei", "identificacion.estado_lei",
                                   "identificacion.fecha_constitucion"),
    "regulatory.periodic_report": ("cartera.cnmv", "costes.cnmv"),
}

MAPA_ACCION: dict[str, tuple[str, ...]] = {
    "name": ("identificacion.nombre",),
    "currency": ("identificacion.divisa_base",),
    "report_date": ("rentabilidad.fecha_dato", "valoracion.vl_fecha"),
    "ms.stock.ticker": ("identificacion.ticker",),
    "ms.stock.exchange": ("identificacion.mercado",),
    "ms.stock.country": ("identificacion.pais",),
    "ms.stock.sector": ("identificacion.sector",),
    "ms.stock.industry": ("identificacion.industria",),
    "ms.stock.fundamentals": ("fundamentales",),
    "ms.stock.valuation": ("valoracion",),
    "ms.stock.history_trace": ("riesgo.historial_precios",),
    "ms.objective": ("identificacion.descripcion",),
}


def _etiquetas_bajo(proc: dict[str, str], ruta: str) -> set[str]:
    if ruta in proc:
        return {proc[ruta]}
    prefijo = ruta + "."
    return {v for k, v in proc.items() if k.startswith(prefijo)}


def _valor_canonico(canonico: dict, campo: str) -> Any:
    return _g(canonico, *campo.split("."))


def bloque_procedencia(d: dict, canonico: dict, mapa: dict[str, tuple[str, ...]] | None = None) -> dict:
    proc: dict[str, str] = _g(d, "meta", "procedencia") or {}
    adquisicion = _g(d, "meta", "adquisicion") or {}
    mapa = mapa if mapa is not None else MAPA_FONDO

    fields: dict[str, str | None] = {}
    for campo, rutas in mapa.items():
        valor = _valor_canonico(canonico, campo)
        if valor is None or valor == {} or valor == []:
            continue
        etiquetas: set[str] = set()
        for ruta in rutas:
            etiquetas |= _etiquetas_bajo(proc, ruta)
        fields[campo] = "+".join(sorted(etiquetas)) if etiquetas else None

    por_fuente: dict[str, int] = {}
    for etiqueta in fields.values():
        for parte in (etiqueta or "").split("+"):
            f = procedencia.fuente_de(parte)
            if f:
                por_fuente[f] = por_fuente.get(f, 0) + 1

    endpoints: dict[str, dict] = {}
    for fuente, detalle in (adquisicion.get("fuentes") or {}).items():
        for etiqueta, info in (detalle.get("endpoints") or {}).items():
            endpoints[etiqueta] = {k: v for k, v in info.items() if k in ("fetched_at", "url", "periodo",
                                                                         "documento", "fichero", "modo")}

    v2_por_fuente = procedencia.por_fuente({k: v for k, v in proc.items() if not k.startswith("meta.")})
    total = len(fields)
    de_ms = sum(1 for e in fields.values() if e and all(
        procedencia.fuente_de(p) in ("morningstar_lt", "morningstar") for p in e.split("+")))
    reg = {k: v for k, v in fields.items() if k.startswith("regulatory.")}
    reg_oficial = sum(1 for e in reg.values() if e and all(
        procedencia.fuente_de(p) in OFICIALES for p in e.split("+")))
    return {
        "version": VERSION,
        "fields": fields,
        "sources": {f: {"canonical_fields": n, "v2_fields": v2_por_fuente.get(f)}
                    for f, n in sorted(por_fuente.items(), key=lambda x: -x[1])},
        "endpoints": endpoints,
        "plan": adquisicion.get("plan"),
        "acquired_at": _g(d, "meta", "actualizado"),
        "dependency": {
            "canonical_fields_mapped": total,
            "from_morningstar_only": de_ms,
            "regulatory_fields": len(reg),
            "regulatory_from_official_sources": reg_oficial,
        },
    }


# El KID es el documento regulatorio del productor, lo aloje quien lo aloje:
# `kid_gestora` cuenta como oficial y `regulatory.kid.source` dice de dónde salió.
OFICIALES = {"cnmv", "cnmv_ficha", "cssf", "esma", "gleif", "amf_geco", "kid_gestora"}
