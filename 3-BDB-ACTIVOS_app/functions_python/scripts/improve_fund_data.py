import os
"""Prepare and apply backed-up, optimistic fund improvements from local sources.

No prices are downloaded or fabricated. --prepare is read-only for Firestore.
--apply requires the exact SHA256 of the reviewed plan. Originals and typed
Firestore timestamps are retained in a local gzip/pickle backup for recovery.
"""
from pathlib import Path
import argparse, collections, copy, gzip, hashlib, json, os, pickle, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import google.auth
from google.cloud import firestore
from fund_data_quality import build_profile, normalize_holdings, inventory_row, summary
from fund_history_quality import policies, usable_documents, METRICS_SOURCE
from contract_validation import validate_contract
from ingest_asset import build_metrics_latest, _estr_window_resolver
from history_backfill import build_year_docs
from metrics_refresh import sharpe_without_rate
from master_project import master_project_id
from write_governance import require_master_writes_enabled

def connect():
    credentials,_=google.auth.load_credentials_from_file(str(Path(os.environ['APPDATA'])/'gcloud/application_default_credentials.json'),
        scopes=['https://www.googleapis.com/auth/cloud-platform'])
    return firestore.Client(project=master_project_id(),credentials=credentials)

def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,default=str).encode()).hexdigest()

# Ronda 2 (14-10-2026): la plataforma escribe las carteras en master.holdings.v1.2
# (v1.1 + `provenance`, additionalProperties: false). Validar todo contra v1.1 haria
# fallar el script con la primera cartera que traiga `provenance`.
HOLDINGS_SCHEMAS = {
    'master.holdings.v1.1': 'holdings.v1.1.schema.json',
    'master.holdings.v1.2': 'holdings.v1.2.schema.json',
}


def holdings_schema_for(doc):
    """Contrato que declara la cartera (`schema_version`). Sin declaracion conocida, v1.2
    si trae `provenance` (solo existe ahi) y v1.1 si no."""
    declared=str((doc or {}).get('schema_version') or '')
    if declared in HOLDINGS_SCHEMAS:
        return HOLDINGS_SCHEMAS[declared]
    return 'holdings.v1.2.schema.json' if 'provenance' in (doc or {}) else 'holdings.v1.1.schema.json'


def without_stale_provenance(doc, content_replaced):
    """Si la cartera se reescribe con OTRAS posiciones (feed local mas reciente), la
    `provenance` vieja (fuente, fecha de obtencion, cobertura) ya no describe el
    contenido y se retira. Si solo se normalizan las mismas posiciones, se conserva."""
    if content_replaced and 'provenance' in doc:
        doc=dict(doc);doc.pop('provenance')
    return doc


# fund_profile/latest tiene varios duenos: este script escribe lo que sale de
# `build_profile`; otras pasadas escriben `documentation_audit`, `holdings_review` o
# `risk_reconciliation`. Sobrescribirlo entero los borraba (ronda 2, 14-10-2026).
def merge_fund_profile(existing, built):
    """Perfil nuevo fusionado sobre el guardado: las claves que construye este script
    se sustituyen; las de otros duenos se conservan."""
    return {**(existing or {}), **built}


# Primer dia de la €STR (el BCE la publica desde el 01-10-2019). Las ventanas de metricas
# acaban todas en el ultimo dato de la serie: si es anterior, ninguna tendra tasa nunca.
ESTR_FIRST_DATE = '2019-10-01'


class _RateProbe:
    """Envuelve el resolutor €STR y anota por que falla: una ventana anterior a la €STR
    (estructural: se repetiria en cada --prepare) o un error del BCE (transitorio).
    _window_risk_free (ingest_asset) convierte cualquier fallo en tasa 0 y lo oculta."""

    def __init__(self, resolver):
        self.resolver = resolver
        self.pre_estr = False
        self.errors = []

    def __call__(self, start, end):
        if str(end)[:10] < ESTR_FIRST_DATE:
            self.pre_estr = True
            raise ValueError('ventana anterior a la €STR (%s)' % ESTR_FIRST_DATE)
        try:
            return self.resolver(start, end)
        except Exception as exc:
            self.errors.append('%s: %s' % (type(exc).__name__, str(exc)[:160]))
            raise


def rebuilt_fund_metrics(aid, points, root, stamp, risk_free_resolver=_estr_window_resolver):
    """metrics/latest recalculado con la media €STR de cada ventana: (payload, motivo, causa).

    ALTA-05 (auditoria 16-10-2026): antes se llamaba sin resolutor (tasa 0) y, si la serie
    tenia un last_date nuevo, se borraban sharpe_ratio y risk_free_rate de cada ventana;
    el refresco diario no los reponia hasta el siguiente precio. Ahora se calcula como la
    ingesta y el refresco, y con la misma guarda NO_RATE: si alguna ventana trae Sharpe
    sin tasa, el documento no entra en el plan.

    Motivos (tercera pasada, 17-10-2026): None; 'NO_ESTR' si la serie acaba antes de la
    €STR (estructural, no se arregla repitiendo); 'NO_RATE' si fallo el BCE u otra causa,
    con el error en `causa`."""
    probe = _RateProbe(risk_free_resolver)
    srri=(root.get('risk') or {}).get('srri_1a7')
    new=build_metrics_latest(aid,'FUND',points,stamp,risk_free_resolver=probe,srri=srri)
    new['source']=METRICS_SOURCE if aid in policies() else 'FONDOSDB_EODHD_DAILY_HISTORY'
    if not sharpe_without_rate(new.get('windows')):
        return new,None,None
    if probe.errors:
        return new,'NO_RATE',probe.errors[0]
    if probe.pre_estr:
        return new,'NO_ESTR','la serie acaba antes de la €STR (%s)' % ESTR_FIRST_DATE
    return new,'NO_RATE','tasa €STR no creible o ausente'


class MissingMetricsRateError(RuntimeError):
    """El BCE no dio tasa para fondos que hoy no tienen metrics/latest."""


def abort_if_metrics_would_stay_missing(missing):
    """ALTA-05, segunda pasada (17-10-2026): con NO_RATE el documento no entra en el plan.
    Si el fondo ya tenia metrics/latest, se queda el vivo; si no lo tenia, se quedaria sin
    metricas para siempre, porque el refresco diario no crea un metrics/latest que falta
    (metrics_refresh._should_update_metrics_latest). No se escribe plan: hay que repetir
    --prepare con --reuse-backup cuando responda el BCE (la copia ya esta hecha).

    `missing`: [(isin, causa)]. Tercera pasada: el mensaje dice la causa real. Los fondos
    con la serie anterior a la €STR (NO_ESTR) no llegan aqui: no abortan, se apartan."""
    if missing:
        aids = sorted(aid for aid, _cause in missing)
        listed = ', '.join(aids[:10]) + (' ...' if len(aids) > 10 else '')
        causes = sorted({cause for _aid, cause in missing if cause})
        raise MissingMetricsRateError(
            'NO_RATE: sin tasa sin riesgo para %d fondo(s) sin metrics/latest (%s). Causa: %s. '
            'No se escribe el plan: repite --prepare --reuse-backup cuando el BCE responda; '
            'si se repite con el BCE disponible, revisa las series de estos fondos.'
            % (len(aids), listed, '; '.join(causes[:3]) or 'desconocida'))


def provider_metrics(root, stamp):
    from readmodel.mappers import _map_root_fallback
    m=_map_root_fallback(root); windows={}
    for w in ('1y','3y','5y','10y'):
        v={key:m.get(field+'_'+w) for key,field in [('annualized_return','annualized_return'),('annualized_volatility','volatility'),('sharpe_ratio','sharpe')] if m.get(field+'_'+w) is not None}
        if v:windows[w]={**v,'method':'TRAILING_PROVIDER','frequency':'PROVIDER'}
    return {'asset_id':root['asset_id'],'population':'fund','source':'FONDOSDB_ROOT_ES',
            'updated_at':stamp,'windows':windows,'risk_score_source':'VOL_BUCKET'}

def prepare(db, source, output, reuse_backup=False):
    stamp=datetime.now(timezone.utc).isoformat()
    universal={r['_id']:r for line in (source/'export/fondos.ndjson').read_text(encoding='utf-8').splitlines() if (r:=json.loads(line))}
    roots={} if reuse_backup else {s.id:s for s in db.collection('assets').stream() if (s.to_dict() or {}).get('asset_type')=='FUND'}
    positions=collections.defaultdict(list)
    for line in (source/'export/posiciones.ndjson').read_text(encoding='utf-8').splitlines():
        row=json.loads(line);positions[row['isin']].append(row)
    # Each group includes all source documents used by its calculations.
    def read_one(item):
        aid,root=item;ref=root.reference
        snaps=[root, *db.get_all([ref.collection('fund_profile').document('latest'),ref.collection('metrics').document('latest'),
                   ref.collection('holdings').document('latest'),ref.collection('holdings').document('manifest')])]
        manifest=next(s for s in snaps if s.reference.path.endswith('/holdings/manifest'))
        if manifest.exists:
            snaps.extend(ref.collection('holdings').document('manifest').collection('chunks').stream())
        series=list(ref.collection('price_series').stream())
        snaps.extend(series)
        return aid,snaps
    output.mkdir(parents=True,exist_ok=True)
    backup=output/'firestore-before.pickle.gz'
    allsnaps={}
    if reuse_backup:
        from types import SimpleNamespace
        with gzip.open(backup,'rb') as stream:typed=pickle.load(stream)
        stored={p:SimpleNamespace(reference=db.document(p),exists=v['data'] is not None,
                update_time=v['update_time'],to_dict=lambda v=v:copy.deepcopy(v['data'])) for p,v in typed.items()}
        for p,s in stored.items():
            if p.startswith('assets/'):allsnaps.setdefault(p.split('/')[1],[]).append(s)
        retro=stored['commercial_retro/LU1088703118'];inventory=stored['meta/fund_data_quality']
    else:
        with ThreadPoolExecutor(max_workers=8) as pool:
            for n,(aid,snaps) in enumerate(pool.map(read_one,roots.items()),1):
                allsnaps[aid]=snaps
                if n%100==0: print('Read funds:',n,flush=True)
        retro=db.collection('commercial_retro').document('LU1088703118').get()
        inventory=db.collection('meta').document('fund_data_quality').get()
        typed={s.reference.path:{'data':s.to_dict() if s.exists else None,'update_time':s.update_time} for ss in allsnaps.values() for s in ss}
        for s in [retro,inventory]: typed[s.reference.path]={'data':s.to_dict() if s.exists else None,'update_time':s.update_time}
        if backup.exists(): raise RuntimeError('Existing backup: use --reuse-backup or a new output directory')
        with gzip.open(backup,'wb') as stream: pickle.dump(typed,stream)
    groups=[]; inventory_rows=[]; counts=collections.Counter(); details=[]; missing_without_rate=[]; pre_estr=[]
    for aid,snaps in sorted(allsnaps.items()):
        docs={s.reference.path:s.to_dict() for s in snaps if s.exists}; root=copy.deepcopy(docs['assets/'+aid]); ops=[]
        def put(path,data,schema=None,patch=False):
            if schema: validate_contract(data,schema)
            before=docs.get(path)
            if patch:
                changed=any(root_field(before,key)!=value for key,value in data.items())
            else: changed=before!=data
            if changed:ops.append({'path':path,'data':data,'patch':patch})
        filename=source/'export_bdb'/f'{aid}.json'
        profile=None
        if filename.exists() and aid in universal:
            export=json.loads(filename.read_text(encoding='utf-8'))
            profile=build_profile(aid,export,universal[aid],stamp)
            profile['source_sha256']=hashlib.sha256(filename.read_bytes()).hexdigest()
            profile=merge_fund_profile(docs.get(f'assets/{aid}/fund_profile/latest'),profile)
            put(f'assets/{aid}/fund_profile/latest',profile);counts['enriched_profiles']+=1
        if aid in ('IE0031069499','IE0034277479'):
            old_name=root['identity']['name']
            corrected=old_name.replace('\u00e2\u201a\u00ac','\u20ac')
            if corrected!=old_name:
                put('assets/'+aid,{'identity.name':corrected,'product.fund_name':corrected},patch=True)
                root['identity']['name']=corrected;root['product']['fund_name']=corrected
                counts['names_repaired']+=1
        hp=f'assets/{aid}/holdings/latest';mp=f'assets/{aid}/holdings/manifest'
        hpaths=[hp] if docs.get(hp,{}).get('storage_mode')=='SINGLE_DOCUMENT' else sorted(p for p in docs if '/holdings/manifest/chunks/' in p)
        allholdings=[]
        for path in hpaths: allholdings.extend((docs.get(path) or {}).get('holdings') or [])
        localparts=sorted(positions.get(aid,[]),key=lambda p:p.get('parte',0))
        oldmeta=docs.get(hp) or docs.get(mp) or {}
        refreshed_date=None
        if (hpaths==[hp] and localparts and len({p.get('fecha') for p in localparts})==1
            and str(localparts[0].get('fecha') or '')>str(oldmeta.get('as_of_date') or '')
            and [p.get('parte') for p in localparts]==list(range(1,len(localparts)+1))
            and all(p.get('total_partes')==len(localparts) for p in localparts)):
            allholdings=[]
            for part in localparts:
                for row in part['posiciones']:
                    allholdings.append({'holding_name':row.get('nombre'),'holding_weight':row.get('peso_pct'),
                        'holding_weight_unit':'percent','currency':row.get('divisa'),'isin':row.get('isin'),
                        'ticker':row.get('ticker'),'instrument_type':{'rv':'equity','rf':'bond'}.get(row.get('tipo'),'other'),
                        'country':row.get('pais'),'sector':row.get('sector'),'source':'fondosdb',
                        'identifiers':{k:row[k] for k in ('isin','ticker') if row.get(k)},'fund_asset_id':aid,'raw_source':row})
            refreshed_date=localparts[0]['fecha']
            counts['holdings_refreshed']+=1
        newholdings=normalize_holdings(aid,allholdings)
        offset=0
        for path in hpaths:
            old=docs[path];size=len(newholdings) if refreshed_date else len(old.get('holdings') or []);new=copy.deepcopy(old)
            new.update(holdings=newholdings[offset:offset+size],holdings_count=size)
            if refreshed_date:
                new['as_of_date']=refreshed_date
                new['top10_weight']=round(sum(sorted((r['holding_weight'] for r in newholdings if isinstance(r['holding_weight'],(int,float))),reverse=True)[:10]),6)
            offset+=size
            if new!=old:
                new['updated_at']=stamp;new=without_stale_provenance(new,bool(refreshed_date))
                put(path,new,holdings_schema_for(new));counts['holdings_documents_normalized']+=1
        if hpaths:
            hsummary=copy.deepcopy(root.get('holdings_summary') or {})
            hsummary.update(positions_count=len(newholdings),has_holdings=bool(newholdings))
            hsummary.setdefault('full_holdings_loaded',False)
            hsummary.setdefault('top10_weight',None)
            # A top-10 feed is not a complete portfolio even if its weights happen to sum to 100.
            if len(newholdings)<=10: hsummary['full_holdings_loaded']=False
            meta=docs.get(hp) or docs.get(mp) or {}
            hsummary['as_of_date']=refreshed_date or meta.get('as_of_date')
            if refreshed_date:hsummary['top10_weight']=new['top10_weight']
            put('assets/'+aid,{'holdings_summary':hsummary},patch=True);root['holdings_summary']=hsummary
            if mp in docs and docs[mp].get('holdings_count')!=len(newholdings):
                corrected={**docs[mp],'holdings_count':len(newholdings),'updated_at':stamp}
                put(mp,corrected,holdings_schema_for(corrected))
        # Newer local feeds are recorded for review if they would replace a richer portfolio.
        localparts=positions.get(aid,[])
        if localparts:
            localdate=max(str(p.get('fecha') or '') for p in localparts)
            if localdate>str((root.get('holdings_summary') or {}).get('as_of_date') or ''):
                details.append({'isin':aid,'newer_local_holdings_date':localdate,'rows':sum(len(p.get('posiciones',[])) for p in localparts)})
        series=[v for p,v in docs.items() if '/price_series/' in p]
        if aid in policies():
            review={**policies()[aid], 'reviewed_at':stamp, 'policy_version':1,
                    'original_observations_preserved':True}
            for path,original in docs.items():
                if '/price_series/' not in path:continue
                metadata={**(original.get('metadata') or {}),'fund_quality_review':review}
                put(path,{'metadata':metadata},patch=True)
                counts['history_documents_annotated']+=1
        if not series:
            cache=source/'data/history_vl'/f'{aid}.jsonl'
            if cache.exists() and root.get('identity',{}).get('currency') in (None,'EUR'):
                records=[json.loads(l) for l in cache.read_text(encoding='utf-8').splitlines() if l]
                valid=[r for r in records if r.get('divisa')=='EUR' and r.get('fuente')=='eodhd' and isinstance(r.get('vl'),(int,float)) and r['vl']>0]
                if len(valid)==len(records) and len(valid)>40:
                    bydate={r['fecha']:{'date':r['fecha'],'value':r['vl']} for r in valid}
                    pts=[bydate[k] for k in sorted(bydate)]
                    series=build_year_docs(aid,'FUND',aid+'.EUFUND','EUR',pts,{},stamp)
                    for doc in series:put(f'assets/{aid}/price_series/'+doc['document_id'],doc,'price-series.v1.2.schema.json')
                    counts['histories_added']+=1
        if aid in policies() or any('/price_series/' in o['path'] for o in ops) or f'assets/{aid}/metrics/latest' not in docs:
            reviewed=usable_documents(aid,series)
            bydate={p['date']:p for d in reviewed for p in d.get('points',[])}
            points=[bydate[k] for k in sorted(bydate)]
            if points:
                new,reason,cause=rebuilt_fund_metrics(aid,points,root,stamp)
                had_metrics=f'assets/{aid}/metrics/latest' in docs
                if reason=='NO_ESTR':
                    # Tercera pasada: estructural (la serie acaba antes de la €STR). Abortar
                    # no sirve, se repetiria siempre; tampoco se escribe con tasa 0 (es lo que
                    # la guarda NO_RATE prohibe). Se aparta el fondo, con aviso, y se sigue.
                    counts['metrics_skipped_pre_estr']+=1;new=None
                    pre_estr.append({'isin':aid,'last_date':str(points[-1]['date'])[:10],'had_metrics':had_metrics})
                elif reason:
                    # Mismo criterio que metrics_refresh: el documento vivo se queda como esta.
                    counts['metrics_skipped_no_rate']+=1;new=None
                    if not had_metrics:missing_without_rate.append((aid,cause))
            else:new=provider_metrics(root,stamp)
            if new is not None:
                put(f'assets/{aid}/metrics/latest',new,'metrics.v1.3.schema.json');counts['metrics_rebuilt']+=1
        # quality es de la plataforma (el republish lo reescribe): los flags de politica se leen de
        # fund_history_policies.json (public_flags, inventario) y no se copian a la raiz.
        validate_contract(root,'asset.v1.2.schema.json')
        inventory_rows.append(inventory_row(root,profile,series,newholdings))
        if ops:
            # Merge multiple field patches to the same root in a single operation.
            merged={}
            for op in ops:
                if op['path'] in merged:
                    assert op['patch'] and merged[op['path']]['patch'];merged[op['path']]['data'].update(op['data'])
                else:merged[op['path']]=op
            groups.append({'id':aid,'guards':[s.reference.path for s in snaps], 'ops':list(merged.values())})
    abort_if_metrics_would_stay_missing(missing_without_rate)
    if pre_estr:
        sin_metricas=[p['isin'] for p in pre_estr if not p['had_metrics']]
        print('AVISO metricas: %d fondo(s) con la serie anterior a la €STR (%s) no se recalculan; '
              '%d no tienen metrics/latest y siguen sin el (lista en preview.json, metrics_skipped_pre_estr).'
              % (len(pre_estr), ESTR_FIRST_DATE, len(sin_metricas)), file=sys.stderr)
    if retro.exists:
        data=retro.to_dict()
        assert data['retro_pct']==0 and 'Sin dato' in data.get('note',''), 'Retrocession evidence changed'
        groups.append({'id':'retrocession','guards':[retro.reference.path],'ops':[{'path':retro.reference.path,
            'patch':True,'data':{'status':'PENDING_CONFIRMATION'}}]})
    quality=summary(inventory_rows,stamp)
    # Ronda 2 (ALTA-07): aviso si meta/fund_data_quality pasa de 800 KiB (limite 1 MiB).
    from meta_size import size_warning
    size_warning('fund_data_quality',quality)
    groups.append({'id':'inventory','guards':[inventory.reference.path], 'ops':[{'path':inventory.reference.path,'data':quality,'patch':False}]})
    plan={'prepared_at':stamp,'groups':groups,'counts':dict(counts),'newer_holdings_candidates':details,
          'metrics_skipped_pre_estr':pre_estr,
          'policy_sha256':hashlib.sha256(Path(__file__).parents[1].joinpath('fund_history_policies.json').read_bytes()).hexdigest()}
    (output/'plan.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2),encoding='utf-8')
    (output/'preview.json').write_text(json.dumps({'counts':dict(counts),'newer_holdings_candidates':details,'metrics_skipped_pre_estr':pre_estr,'quality':{k:v for k,v in quality.items() if k!='rows'},'plan_sha256':digest(plan)},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'prepared':True,'groups':len(groups),'writes':sum(len(g['ops']) for g in groups),'counts':dict(counts),'sha256':digest(plan)},ensure_ascii=True))

def root_field(doc,path):
    for key in path.split('.'):
        doc=doc.get(key) if isinstance(doc,dict) else None
    return doc

def apply(db, output, expected):
    plan=json.loads((output/'plan.json').read_text(encoding='utf-8'))
    assert digest(plan)==expected, 'Plan changed'
    assert plan['policy_sha256']==hashlib.sha256(Path(__file__).parents[1].joinpath('fund_history_policies.json').read_bytes()).hexdigest()
    with gzip.open(output/'firestore-before.pickle.gz','rb') as f:before=pickle.load(f)
    journal=output/'applied.ndjson'; done=set()
    if journal.exists():done={json.loads(l)['id'] for l in journal.read_text().splitlines()}
    for index,group in enumerate(plan['groups']):
        if group['id'] in done:continue
        transaction=db.transaction()
        @firestore.transactional
        def write(tx):
            refs=[db.document(p) for p in group['guards']]
            actual={s.reference.path:s for s in db.get_all(refs,transaction=tx)}
            for p in group['guards']:
                old=before[p];snap=actual[p]
                if old['update_time']!=snap.update_time:raise RuntimeError('Concurrent change: '+p)
            for op in group['ops']:
                ref=db.document(op['path'])
                if op['patch']:tx.update(ref,op['data'])
                elif before.get(op['path'],{}).get('data') is None:tx.create(ref,op['data'])
                else:tx.set(ref,op['data'])
        write(transaction)
        with journal.open('a',encoding='utf-8') as f:f.write(json.dumps({'id':group['id'],'writes':len(group['ops']),'at':datetime.now(timezone.utc).isoformat()})+'\n')
        if index%50==0:print('Applied groups:',index+1,flush=True)
    print('Applied all reviewed groups:',len(plan['groups']))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--prepare',action='store_true');p.add_argument('--reuse-backup',action='store_true');p.add_argument('--apply-sha256')
    a=p.parse_args()
    if a.apply_sha256:require_master_writes_enabled('improve_fund_data')  # decision 106: antes de abrir nada
    db=connect()
    if a.prepare:prepare(db,a.source,a.output,a.reuse_backup)
    elif a.apply_sha256:apply(db,a.output,a.apply_sha256)
    else:p.error('Select --prepare or --apply-sha256')
