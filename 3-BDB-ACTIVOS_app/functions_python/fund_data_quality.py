"""Fund enrichment and quality inventory. No network or implicit writes."""
from collections import Counter
from copy import deepcopy
from datetime import date
import hashlib
import json
import re
from fund_history_quality import policy_for


def sanitized(value):
    """Retain data provenance, never credentials or authenticated endpoints."""
    if isinstance(value, dict):
        return {k: sanitized(v) for k, v in value.items()
                if not re.search(r'token|password|secret|api.?key|authorization|endpoints', k, re.I)}
    if isinstance(value, list):
        return [sanitized(v) for v in value]
    if isinstance(value, str) and re.search(r'(api.?key|token|authorization|password)=', value, re.I):
        return None
    return value


def build_profile(isin, export, universal, acquired_at):
    if export.get('isin') != isin or universal.get('_id') != isin:
        raise ValueError('Fund enrichment identity mismatch')
    ident = universal.get('identificacion') or {}
    profile = {
        'schema_version': 'fund-profile.v1', 'asset_id': isin,
        'identity': {key: ident.get(key) for key in (
            'gestora', 'indice_benchmark_oficial', 'inversion_minima_inicial',
            'estrategia_inversion_texto', 'clase_cubierta', 'divisa_cubierta',
            'politica_distribucion', 'fecha_lanzamiento_clase', 'fecha_lanzamiento_fondo')},
        'regulatory': export.get('regulatory') or {},
        'fund_size': {k: v for k, v in (universal.get('valoracion') or {}).items() if k.startswith('patrimonio_')},
        'management': universal.get('gestion') or {},
        'provenance': {k: export.get('provenance', {}).get(k) for k in ('fields', 'sources', 'acquired_at')},
        'source': 'FondosDB', 'source_generated_at': export.get('generated_at'),
        'report_date': export.get('report_date'), 'imported_at': acquired_at,
        'commercial_availability': 'UNVERIFIED',
    }
    return sanitized(profile)


def normalize_holdings(isin, holdings):
    """Keep every economic row; stable IDs include currency and instrument terms.

    A suffix distinguishes indistinguishable source rows without deleting them.
    Weights are excluded from the identity so ordinary rebalancing keeps IDs.
    """
    seen = Counter()
    result = []
    for original in holdings:
        row = deepcopy(original)
        if not any(row.get(k) for k in ('name', 'holding_name', 'isin', 'ticker', 'identifiers', 'currency')):
            result.append(row)
            continue
        row.setdefault('holding_name', row.get('name'))
        if 'holding_weight' not in row and isinstance(row.get('weight_pct'), (int, float)):
            row.update(holding_weight=row['weight_pct'], holding_weight_unit='percent')
        identity = {k: row.get(k) for k in ('holding_name', 'isin', 'ticker', 'identifiers', 'currency',
                    'instrument_type', 'holding_type', 'maturity', 'expiry', 'strike', 'contract', 'country')}
        digest = hashlib.sha256((isin+'|'+json.dumps(identity, sort_keys=True, ensure_ascii=False)).encode()).hexdigest()[:24]
        seen[digest] += 1
        row['holding_id'] = digest if seen[digest] == 1 else f'{digest}-{seen[digest]}'
        result.append(row)
    return result


def days_old(value, today):
    try:
        return (today-date.fromisoformat(str(value)[:10])).days
    except (ValueError, TypeError):
        return None


def holdings_review_flags(profile):
    """Only reviewed portfolio findings become persistent inventory flags."""
    profile = profile or {}
    allowed = {'RECUENTO_POSICIONES_PENDIENTE', 'FECHAS_CARTERA_DISCREPANTES',
               'CARTERA_PUBLICADA_PARCIAL', 'CARTERA_RECIENTE_NO_SUSTITUIDA'}
    flags = sorted(set((profile.get('holdings_review') or {}).get('review_flags') or []) & allowed)
    if (profile.get('corporate_action_review') or {}).get('status') == 'DEREGISTERED_MERGER_VERIFIED':
        flags.append('BAJA_CNMV_VERIFICADA')
    return flags


def monthly_reference_summary(profile):
    """Monthly references never count as admitted daily analytics history."""
    reference = (profile or {}).get('monthly_history_reference') or {}
    verified = reference.get('status') == 'VERIFIED_MONTHLY_REFERENCE'
    return {
        'reference_history_observations': reference.get('observations_count', 0) if verified else 0,
        'reference_history_first_date': reference.get('first_date') if verified else None,
        'reference_history_last_date': reference.get('last_date') if verified else None,
    }


PRICE_SERIES_SUMMARY_FIELDS = ('first_date', 'last_date', 'observations_count')


def history_span(docs):
    """(first_date, last_date, observations) de una lista de price_series.

    B-07: el inventario semanal lee los documentos proyectados (solo los campos
    resumen) para no arrastrar los puntos de todos los fondos. Si un documento
    trae `points` (fondos con politica, ya filtrados por `usable_documents`, o
    llamadas antiguas con el documento completo) se cuenta por fecha, que es
    exacto; si no, se suman los campos resumen que escribe el productor.
    """
    dates = set()
    first = last = None
    count = 0
    for d in docs:
        points = d.get('points')
        if points:
            dates.update(str(p.get('date')) for p in points if p.get('date'))
            continue
        f, l = d.get('first_date'), d.get('last_date')
        if not f or not l:
            continue
        first = str(f) if first is None else min(first, str(f))
        last = str(l) if last is None else max(last, str(l))
        count += max(int(d.get('observations_count') or 0), 0)
    if dates:
        first = min(dates) if first is None else min(first, min(dates))
        last = max(dates) if last is None else max(last, max(dates))
        count += len(dates)
    return first, last, count


def inventory_row(root, profile, raw_series, holdings, *, today=None):
    from fund_history_quality import usable_documents
    today = today or date.today()
    aid = root['asset_id']
    docs = usable_documents(aid, raw_series)
    first, last, observations = history_span(docs)
    hdate = (root.get('holdings_summary') or {}).get('as_of_date')
    risks = root.get('risk') or {}
    reg = (profile or {}).get('regulatory') or {}
    fi = root.get('fixed_income_profile') or {}
    flags = list(policy_for(aid).get('flags', []))
    flags.extend(holdings_review_flags(profile))
    if not observations: flags.append('SIN_HISTORICO_UTILIZABLE')
    elif days_old(last,today)>7: flags.append('HISTORICO_ANTIGUO')
    if not holdings: flags.append('SIN_POSICIONES')
    elif hdate is None or days_old(hdate,today) is None or days_old(hdate,today)>90: flags.append('POSICIONES_ANTIGUAS')
    if len(holdings)<=10 and holdings and not (root.get('holdings_summary') or {}).get('full_holdings_loaded'):
        flags.append('SOLO_POSICIONES_PRINCIPALES')
    if not (reg.get('kid') or {}).get('url'): flags.append('SIN_DOCUMENTO_KID')
    elif (age := days_old((reg.get('kid') or {}).get('date'), today)) is not None and age > 365:
        flags.append('KID_ANTIGUO')
    if (root.get('classification') or {}).get('asset_class')=='RF' and not (
            (fi.get('effective_duration') is not None or fi.get('modified_duration') is not None)
            and (fi.get('yield_to_maturity') is not None or fi.get('yield_to_worst') is not None)
            and fi.get('avg_credit_quality')): flags.append('RENTA_FIJA_INCOMPLETA')
    return {'isin':aid, 'name':root.get('identity',{}).get('name') or aid,
            'history_last_date':last, 'history_first_date':first,
            'history_observations':observations, **monthly_reference_summary(profile),
            'holdings_date':hdate, 'holdings_count':len(holdings),
            'has_profile':bool(profile), 'has_kid':bool((reg.get('kid') or {}).get('url')),
            'flags':flags, 'history_blocked':bool(policy_for(aid).get('blocked')),
            'sri':risks.get('sri_kid_1a7'), 'report_date':(profile or {}).get('report_date')}


def summary(rows, generated_at):
    return {'schema_version':'fund-quality.v1', 'generated_at':generated_at,
            'total_funds':len(rows), 'with_profile':sum(r['has_profile'] for r in rows),
            'with_history':sum(bool(r['history_observations']) for r in rows),
            'with_monthly_reference':sum(bool(r.get('reference_history_observations')) for r in rows),
            'history_blocked':sum(r['history_blocked'] for r in rows),
            'with_kid':sum(r['has_kid'] for r in rows),
            'issues':dict(Counter(f for r in rows for f in r['flags'])), 'rows':rows}


def refresh_inventory_if_due(db, now):
    """Weekly bounded refresh, invoked only inside the existing integrity write gate."""
    from concurrent.futures import ThreadPoolExecutor
    ref=db.collection('meta').document('fund_data_quality')
    snapshot=ref.get()
    if not snapshot.exists:
        return False  # Initial publication requires the backed-up migration.
    previous=snapshot.to_dict() or {}
    age=days_old(previous.get('generated_at'),now.date())
    if age is not None and age<7:
        return False
    roots=[s for s in db.collection('assets').stream() if (s.to_dict() or {}).get('asset_type')=='FUND']
    if len(roots)>2000:
        raise RuntimeError('Fund quality inventory exceeds the reviewed census limit')
    def collect(snap):
        root=snap.to_dict();aid=snap.id;asset=snap.reference
        profile=asset.collection('fund_profile').document('latest').get(
            field_paths=['asset_id','report_date','regulatory.kid.url','regulatory.kid.date',
                         'holdings_review.review_flags','corporate_action_review.status',
                         'monthly_history_reference.status','monthly_history_reference.observations_count',
                         'monthly_history_reference.first_date','monthly_history_reference.last_date'])
        holding=asset.collection('holdings').document('latest').get(
            field_paths=['holdings_count','as_of_date'])
        if not holding.exists:
            holding=asset.collection('holdings').document('manifest').get(
                field_paths=['holdings_count','as_of_date'])
        h=holding.to_dict() or {} if holding.exists else {}
        root['holdings_summary']={**(root.get('holdings_summary') or {}),'as_of_date':h.get('as_of_date')}
        # B-07: proyeccion de los campos resumen; los puntos solo para los
        # fondos con politica de historico, que `usable_documents` filtra por fecha.
        fields=list(PRICE_SERIES_SUMMARY_FIELDS)
        if policy_for(aid) and not policy_for(aid).get('blocked'):
            fields.append('points')
        documents=[s.to_dict() for s in asset.collection('price_series').select(fields).stream()]
        count=min(max(int(h.get('holdings_count') or 0),0),100000)
        return inventory_row(root,profile.to_dict() if profile.exists else None,documents,[None]*count,today=now.date())
    with ThreadPoolExecutor(max_workers=6) as pool:
        rows=list(pool.map(collect,roots))
    from google.cloud import firestore
    payload=summary(sorted(rows,key=lambda r:r['isin']),now.isoformat())
    # Ronda 2 (ALTA-07): linea WARNING si el inventario pasa de 800 KiB (limite 1 MiB).
    from meta_size import size_warning
    size_warning('fund_data_quality',payload)
    ref.update(payload,option=firestore.LastUpdateOption(snapshot.update_time))
    return True
