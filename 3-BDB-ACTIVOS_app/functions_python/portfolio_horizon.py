"""Coherent 3/5-year analysis. Analytical extensions never enter the price cache/DB.

The proxy is an ex-post model, not the ETF's historical track record. Residual
weekly log returns are resampled in deterministic four-week blocks, preserving
idiosyncratic risk instead of pretending the proxy tracks the ETF perfectly.
"""
from dataclasses import dataclass
from datetime import date, timedelta
from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import math
from firebase_functions import logger as LOGGER
from pathlib import Path
import random
import re
import time

from asset_aliases import alias_conflict_message, alias_conflicts, canonical_noting, with_alias_resolutions
from fund_distributions import MOTIVO_REPARTE
from optimization.repository import (
    MOTIVO_REFERENCIA_SIN_ENLACE,
    MOTIVO_SERIE_PARADA,
    InvalidOptimizationRequest, OptimizationError, PUNTOS_DE_LA_FRONTERA, SUPPORTED_WINDOWS, _load_window_values,
    _root_exclusion_reason, _resolve_risk_free_context,
    PriceSeriesProblem, _risk_contribution_contract,
)
from weekly_sampling import DAYS_PER_YEAR, MAX_BRIDGED_WEEK_GAP_DAYS, ex_post_sharpe, weekly_last_observations
from optimization.runtime import prepare_solver_during_reads

# Una ventana de 10 anos pide mas dias de los que se leen por defecto (10 x 366) si un activo cotiza mas reciente
# que el fin de la ventana. Solo la usa quien pide esa ventana: las crisis de la simulacion leen lo de siempre.
MARGEN_DE_LECTURA_DIEZ_ANOS = 30

# Cuantas posiciones mide la simulacion (10-11-2026). Sale de medir, no de elegir: scripts/medir_tope_simulacion.py,
# contra el emulador de la base nueva, con acciones del catalogo, a 3 y 5 anos, en frio y en caliente. Criterio: el
# peor caso en frio no pasa de 60 s (un quinto del plazo de 300 s) ni de 300 MB de pico sobre el proceso ya arrancado.
# Manda la memoria, no el tiempo: 200 posiciones son 13 s pero +707 MB; 90 son +300,3 MB y 85, +283,7 MB. Cada
# activo cuesta unos 3 MB porque se leen y se guardan en la cache todos sus anios de serie. Por eso no llega a las
# 200 que admite una cartera guardada (CAP_POSITIONS en main.py): una cartera de 86 a 200 recibe el limite, dicho.
# Antes eran 40, un tope del 04-09-2026 pensado para 512 MB / 60 s cuando la funcion ya tiene 1 GB / 300 s.
# Va con CAP_SIMULATION_POSITIONS de main.py (tests/test_tope_simulacion.py comprueba que son el mismo numero).
MAX_POSICIONES_SIMULACION = 85

# Por encima de 40 activos medidos no se calcula la frontera eficiente, y la respuesta lo dice. La razon es la
# estimacion: a 3 anos semanal hay unas 157 observaciones, y con 80 o 120 activos la covarianza tiene entre 3.240 y
# 7.260 parametros estimados con esos 157 puntos. Optimizar sobre ella —que es invertirla— da una frontera que es sobre
# todo error de estimacion. Medir la cartera con sus pesos no tiene ese problema: su volatilidad y la aportacion al
# riesgo de cada posicion dependen de cov(r_i, r_cartera), una covarianza por activo, no de la inversa.
# El coste del solver es la razon menor: medido en el mismo script, 0,5 s con 40 activos, 1,5 s con 115 y 4 s con 191.
# Crece, pero no es lo que obliga. Es el mismo numero que CAP_OPTIMIZE_ASSETS (main.py), que no cambia.
MAX_ACTIVOS_FRONTERA = 40

# Lo que se acepto con ese tope es una proporcion: los retornos semanales de 3 anos (157) para 40 activos. Optimizar la
# conserva en cualquier ventana (decision de Oscar, 15-11-2026, hallazgo 12 de la auditoria del backend): el maximo de una
# ventana es 40 x sus retornos / los de 3 anos con el mismo fin, a la baja y sin pasar de 40. A 3 anos sale 40 por
# construccion; a 5 y 10 anos la cuenta pasa de 40 y se queda en 40; a 1 ano, con 53 retornos, sale 13. La cuenta la hace
# `optimization.repository.maximo_de_activos_de_la_ventana`.
VENTANA_DEL_TOPE_DE_LA_FRONTERA = '3Y'


def _leer_precios_y_raices(reader, asset_ids, *, allow_historical=True, margen_dias=0):
    """Batch roots and overlap independent reads, preserving every eligibility gate.

    Duck-typed readers remain sequential unless they explicitly support parallel I/O.
    Results are collected in asset order so scheduling cannot change the universe.

    `allow_historical`: la simulacion es retrospectiva y mide tambien lo que ya no se puede comprar; quien va a
    proponer pesos, no.
    """
    ids = sorted(asset_ids)
    batch = getattr(reader, 'get_assets_many', None)
    roots = batch(ids) if callable(batch) else {aid: reader.get_asset(aid) for aid in ids}
    lectura = {'margen_dias': margen_dias} if margen_dias else {}

    def load(aid):
        root = roots.get(aid)
        reason = _root_exclusion_reason(root, 'EUR', aid, allow_historical=allow_historical, reader=reader)
        values = None
        if not reason:
            try:
                # Stress scenarios also need the ten-year history for a 3Y/5Y analysis.
                values = {d.isoformat(): v for d, v in _load_window_values(reader, aid, root, '10Y', **lectura).items()}
                if not values:
                    reason = 'PRICE_SERIES_MISSING'
            except PriceSeriesProblem as problem:
                reason = problem.reason
        return aid, values, reason

    workers = min(6, max(1, int(getattr(reader, 'max_parallel_reads', 1))), len(ids))
    if workers > 1:
        pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix='horizon-read')
        try:
            rows = list(pool.map(load, ids))
        finally:
            # Stop queued reads after a transport error instead of waiting through
            # a fresh network retry budget for every remaining asset.
            pool.shutdown(wait=True, cancel_futures=True)
    else:
        rows = [load(aid) for aid in ids]
    loaded = {aid: values for aid, values, reason in rows if not reason}
    excluded = [{'asset_id': aid, 'reason': reason} for aid, _values, reason in rows if reason]
    return loaded, excluded, roots


def _load_horizon_prices(reader, asset_ids, *, con_raices=False):
    loaded, excluded, roots = _leer_precios_y_raices(reader, asset_ids)
    return (loaded, excluded, roots) if con_raices else (loaded, excluded)


# Lo que se mide y no se puede comprar (decision de Oscar, 15-11-2026). La cartera se mide con todo, porque describe lo que
# el cliente tiene; la frontera y sus carteras, solo con lo que pasa la puerta de Optimizar (`allow_historical=False`),
# porque proponen pesos. Una serie plana -un precio congelado- es un activo casi sin riesgo que la frontera cargaria de peso.
# El motivo es mas fino que el codigo de la puerta, que dice NON_INVESTABLE tanto al congelado como al bloqueado: la nota
# de la pantalla tiene que poder decir cual de los tres es.
MOTIVO_PRECIO_CONGELADO = 'FROZEN_PRICE'
MOTIVO_OPERACION_CORPORATIVA = 'CORPORATE_ACTION'
MOTIVO_BLOQUEADO = 'SELECTION_BLOCKED'


def _motivo_fuera_de_la_frontera(root, asset_id, reader):
    """Por que un activo que se ha podido medir no entra en la frontera, o None si entra.

    Lo decide la misma puerta que Optimizar; el motivo se nombra en el orden en que ella mira.
    """
    if _root_exclusion_reason(root, 'EUR', asset_id, allow_historical=False, reader=reader) is None:
        return None
    from asset_eligibility import corporate_action_blocks_selection, valorado_a_precio_congelado
    if corporate_action_blocks_selection(root):
        return MOTIVO_OPERACION_CORPORATIVA
    if valorado_a_precio_congelado(root):
        return MOTIVO_PRECIO_CONGELADO
    return MOTIVO_BLOQUEADO


@lru_cache(maxsize=1)
def references():
    return json.loads(Path(__file__).with_name('analytical_references.json').read_text(encoding='utf8'))


def extend_history(asset_id, values, reference, version):
    """Only extend before the actual inception; never bridge bad or missing history."""
    first = min(values)
    inception = date.fromisoformat(reference['inception'])
    if abs((date.fromisoformat(first) - inception).days) > 7:
        raise OptimizationError(f'{asset_id}: falta el inicio real; no se puede enlazar la referencia.')
    validation = reference['validation']
    if (validation['weeks'] < 52 or validation['holdout_correlation'] < .75
            or validation['holdout_rmse'] >= validation['zero_return_rmse']):
        raise OptimizationError(f'{asset_id}: referencia sin validación suficiente.')
    residuals = reference['weekly_log_residuals']
    if len(residuals) < 52 or not all(math.isfinite(x) for x in residuals):
        raise OptimizationError('Residuos de referencia inválidos.')
    proxy = {p['date']: p['value'] for p in reference['prices'] if p['date'] <= first}
    dates = sorted(proxy)
    if not dates or (date.fromisoformat(first) - date.fromisoformat(dates[-1])).days > 5:
        raise OptimizationError(f'{asset_id}: la referencia no alcanza el enlace.')
    rng = random.Random(int(hashlib.sha256(f'{version}:{asset_id}'.encode()).hexdigest()[:16], 16))
    weeks = sorted({date.fromisoformat(d).isocalendar()[:2] for d in dates})
    sampled = []
    while len(sampled) < len(weeks):
        offset = rng.randrange(len(residuals) - 3)
        sampled.extend(residuals[offset:offset+4])
    noise = dict(zip(weeks, sampled))
    counts = {w: sum(date.fromisoformat(d).isocalendar()[:2] == w for d in dates) for w in weeks}
    path = {dates[0]: 1.0}
    for prev, current in zip(dates, dates[1:]):
        week = date.fromisoformat(current).isocalendar()[:2]
        log_return = reference['beta'] * math.log(proxy[current]/proxy[prev]) + noise[week]/counts[week]
        path[current] = path[prev] * math.exp(log_return)
    anchor = values[first]/path[dates[-1]]
    estimated = {d: p*anchor for d,p in path.items() if d < first}
    # The real value wins even on the join date; no artificial jump or zero history.
    return {**estimated, **values}, {
        'asset_id': asset_id, 'reference': reference['reference'], 'url': reference['url'],
        'estimated_from': dates[0], 'estimated_until': dates[-1] if dates[-1] < first else dates[-2],
        'observed_from': first, 'validation_weeks': validation['weeks'],
        'holdout_correlation': validation['holdout_correlation'],
        'residual_volatility': validation['residual_volatility'],
        'reference_has_backtested_history': reference['reference_has_backtested_history'],
    }


def _years_before(day, years):
    """Misma fecha `years` anos antes; el 29-feb cae al 28-feb (BAJA, 14-10-2026:
    `replace(year=...)` lanzaba ValueError cuando la ultima semana cerraba en 29-feb)."""
    try:
        return day.replace(year=day.year-years)
    except ValueError:
        return day.replace(year=day.year-years, month=2, day=28)


def _aligned(values, dates, max_age=MAX_BRIDGED_WEEK_GAP_DAYS):
    """Ultimo valor conocido en cada dia de `dates`, con antiguedad maxima `max_age`.

    ALTA-03 (auditoria 16-10-2026): 14 dias, el mismo hueco que puentean el optimizador y
    el backtest (weekly_sampling.MAX_BRIDGED_WEEK_GAP_DAYS). Con 7, un fondo de VL semanal
    que se saltaba una semana festiva entraba en la frontera y salia de este analisis.
    Un hueco mayor sigue excluyendo el activo entero (INSUFFICIENT_HISTORY)."""
    keys=sorted(values); index=-1; result=[]
    for day in dates:
        while index+1<len(keys) and keys[index+1]<=day:
            index+=1
        if index<0 or (date.fromisoformat(day)-date.fromisoformat(keys[index])).days>max_age:
            return None
        result.append(float(values[keys[index]]))
    return result


def _week_indices(dates):
    """Indice de la ultima observacion de cada semana ISO en `dates` (weekly_sampling).

    ALTA-03: la misma regla de semana que la maestra, el optimizador y el backtest, en vez
    de filtrar los viernes. La rejilla es de dias laborables sin huecos, asi que las
    semanas medidas son siempre consecutivas (retornos a 7 dias)."""
    weekly=weekly_last_observations((date.fromisoformat(d),i) for i,d in enumerate(dates))
    return [int(index) for _key,_day,index in weekly]


# OPT-2 (auditoria del 16-11-2026). El fin del periodo era la mediana de las ultimas fechas de los activos, asi que una
# cartera con la mayoria de sus series paradas se media entera hasta donde llegaba esa mayoria, y nada lo decia. Primero
# se aviso; desde la decision A-161 de Oscar, del mismo dia, el periodo acaba en el dato MAS RECIENTE y la serie que no
# llega se aparta con su motivo (`MOTIVO_SERIE_PARADA`), ver `_periodo_comun`. El aviso se queda para cuando ni el dato
# mas reciente es de este mes: el refresco es a mano y unos dias de retraso son lo normal, y por eso no es una semana.
DIAS_DE_PERIODO_ATRASADO = 30
AVISO_PERIODO_ATRASADO = 'PERIOD_END_STALE'


def avisos_del_periodo(dates, today=None):
    """El aviso de periodo atrasado, si el ultimo dia medido queda a mas de DIAS_DE_PERIODO_ATRASADO de hoy."""
    atraso=((today or date.today())-date.fromisoformat(dates[-1])).days
    return [AVISO_PERIODO_ATRASADO] if atraso>DIAS_DE_PERIODO_ATRASADO else []


@dataclass(frozen=True)
class PeriodoComun:
    """Las fechas y los niveles sobre los que se mide y se optimiza. Es lo que hace que dos caminos den la misma cifra."""
    years: int
    ids: list
    dates: list
    matrix: object  # niveles (fechas, activos), en el orden de `ids`
    week_indices: list
    extensions: list


def _periodo_comun(loaded, excluded, window, bundle, today):
    """One dated matrix: los dias laborables de la ventana, con el ultimo valor conocido de cada activo.

    Un activo que no cubre la ventana sale con su motivo en `excluded`, salvo que tenga referencia validada. El fin
    es la ultima semana de mercado completa hasta el dato mas reciente de cualquiera de ellos, y el inicio, la misma
    fecha `years` antes.

    Decision A-161 (16-11-2026). Antes el fin era la MEDIANA de las ultimas fechas: con dos fondos parados hace un ano y
    un ETF al dia, los tres se median hasta hace un ano y la pantalla decia «100 % del peso». Ahora manda el dato mas
    reciente, y el activo cuya serie acaba antes —mas alla del hueco que se puentea— se aparta con `MOTIVO_SERIE_PARADA`.
    Es mas fiel y puede dejar posiciones fuera de la medida: si pesan mas de lo que la pantalla admite, la cartera se
    queda sin cifra y dice por que.
    """
    import numpy as np
    # P1-04 (auditoria del 20-11-2026): un activo de precio congelado (`frozen_price`, NH Hotel) se prolonga plano hasta
    # hoy al leerlo (`extend_frozen_price`), asi que su ultimo dato es siempre hoy y no dice hasta donde llegan los datos.
    # Si fijaba el fin, en cuanto el refresco a mano pasaba de 14 dias apartaba a todo lo demas con MOTIVO_SERIE_PARADA y la
    # cartera se media solo con el congelado. El fin lo ponen los demas; solo si la cartera es entera de congelados, ellos.
    from fund_history_quality import tiene_precio_congelado
    reales=[v for aid,v in loaded.items() if not tiene_precio_congelado(aid)] or list(loaded.values())
    latest=max(max(v) for v in reales)
    end=min(date.fromisoformat(latest),today or date.today())
    end-=timedelta(days=(end.weekday()-4)%7) # Last completed market week.
    years=SUPPORTED_WINDOWS[window]; start=_years_before(end,years)
    start-=timedelta(days=(start.weekday()-4)%7) # Cover the complete calendar window.
    dates=[]; d=start
    while d<=end:
        if d.weekday()<5: dates.append(d.isoformat())
        d+=timedelta(days=1)
    extensions=[]
    included={}
    for aid,values in loaded.items():
        detail=None
        # A-161: sin precios hasta el final del periodo no se mide, tenga la historia que tenga. Es la misma tolerancia
        # con la que `_aligned` puentea un hueco; aqui se nombra, para no llamarlo «historico insuficiente».
        if (end-date.fromisoformat(max(values))).days>MAX_BRIDGED_WEEK_GAP_DAYS:
            excluded.append({'asset_id':aid,'reason':MOTIVO_SERIE_PARADA}); continue
        if min(values)>start.isoformat() and aid in bundle['assets']:
            try:
                values,detail=extend_history(aid,values,bundle['assets'][aid],bundle['version'])
            except OptimizationError as exc:
                # Hallazgo 15 (15-11-2026): la referencia de UN activo que no enlaza lo aparta con su motivo, como al que no
                # cubre la ventana; el resto se sigue midiendo. Antes caia el calculo entero de la cartera.
                LOGGER.info('portfolio_horizon_reference_link_failed', asset_id=aid, detail=str(exc))
                excluded.append({'asset_id':aid,'reason':MOTIVO_REFERENCIA_SIN_ENLACE}); continue
        aligned=_aligned(values,dates)
        if aligned is None:
            excluded.append({'asset_id':aid,'reason':'INSUFFICIENT_HISTORY'}); continue
        included[aid]=aligned
        if detail:
            detail['estimated_from']=max(detail['estimated_from'],start.isoformat())
            extensions.append(detail)
    if not included:
        raise OptimizationError(f'No hay histórico completo de {years} años ni referencias validadas.')
    ids=sorted(included)
    return PeriodoComun(years=years,ids=ids,dates=dates,matrix=np.asarray([included[a] for a in ids]).T,
                        week_indices=_week_indices(dates),extensions=extensions)


def retornos_semanales(matrix, week_indices):
    """Los retornos semanales de cada activo: la matriz con la que se resuelve la frontera."""
    import numpy as np
    asset_weekly=np.asarray(matrix, dtype=float)[week_indices]
    return asset_weekly[1:]/asset_weekly[:-1]-1


def periodo_para_optimizar(reader, asset_ids, window, *, today=None, reference_bundle=None):
    """La misma matriz que `analyze_horizon`, para Optimizar (decision 40): mismos activos y ventana, mismo calculo.

    Lo unico distinto es que aqui no entra lo que ya no se puede comprar, porque se van a proponer pesos. Devuelve
    el periodo, lo que se queda fuera y las fichas leidas.

    Las referencias solo se enlazan a 3 y 5 anios, las ventanas de la simulacion: es donde se validaron, y a 10 anios
    casi toda la serie de un activo con referencia seria estimada. Ahi el que no cubre la ventana se queda fuera.
    """
    bundle=reference_bundle or references()
    if window not in ('3Y','5Y'):
        bundle={**bundle,'assets':{}}
    margen=MARGEN_DE_LECTURA_DIEZ_ANOS if window=='10Y' else 0
    loaded,excluded,roots=_leer_precios_y_raices(reader,asset_ids,allow_historical=False,margen_dias=margen)
    if not loaded:
        raise OptimizationError('Hacen falta al menos dos activos con precios en euros y suficiente histórico en este periodo. Prueba con otro periodo o con otros activos.')
    return _periodo_comun(loaded,excluded,window,bundle,today),excluded,roots


def periodo_de_la_cartera(reader, asset_ids, window, *, today=None, reference_bundle=None):
    """El periodo de `analyze_horizon` para una cartera, para «Mejorar cartera» (15-11-2026).

    La misma lectura (`_load_horizon_prices`: tambien lo que ya no se puede comprar, porque describe lo que el cliente
    tiene) y el mismo `_periodo_comun`: mismas fechas y el mismo trato a la posicion que no cubre la ventana, que se aparta
    con su motivo o se completa con su referencia. Devuelve el periodo, lo que se queda fuera, las fichas, los precios
    leidos y las referencias, para repetir el periodo en otra ventana.

    Donde Simular falla porque ninguna posicion se puede medir, aqui el periodo es None y `excluded` dice por que cada una:
    para quien mejora una cartera es un resultado. Cualquier otro error (una referencia que no enlaza) sube como alli.
    """
    bundle=reference_bundle or references()
    loaded,excluded,roots=_load_horizon_prices(reader,asset_ids,con_raices=True)
    periodo=None
    if loaded:
        try:
            periodo=_periodo_comun(loaded,excluded,window,bundle,today)
        except OptimizationError:
            # `_periodo_comun` anota en `excluded` a cada uno que no cubre la ventana antes de rendirse; si falta alguno, el
            # error fue otro.
            fuera={item['asset_id'] for item in excluded}
            if not all(aid in fuera for aid in loaded):
                raise
    return periodo,excluded,roots,loaded,bundle


def leer_lo_comprable(reader, asset_ids):
    """Precios y fichas con la puerta de Optimizar (`allow_historical=False`): solo lo que se puede comprar."""
    return _leer_precios_y_raices(reader,asset_ids,allow_historical=False)


def serie_propia_en(values, dates):
    """La serie propia de un activo en las fechas de un periodo, con la regla de `_periodo_comun` y SIN completarla con
    una referencia: None si no cubre todas las fechas."""
    return _aligned(values,dates)


def _correlaciones(asset_returns):
    """La matriz de correlaciones de los retornos semanales. La que no se puede calcular (un activo de varianza cero, como
    un precio congelado) va vacia, None, y no 0, que es una correlacion real (hallazgo 11, 15-11-2026). La diagonal es 1."""
    import numpy as np
    with np.errstate(invalid='ignore', divide='ignore'):
        crudo=np.corrcoef(np.asarray(asset_returns,dtype=float).T)
    k=crudo.shape[0]
    return [[1.0 if i==j else (float(crudo[i,j]) if np.isfinite(crudo[i,j]) else None) for j in range(k)] for i in range(k)]


def _anos_de_la_ventana(window):
    """Los anos de una ventana ("1Y", "5Y", "10Y"): todos los digitos, no solo el primero ("10Y" no es 1)."""
    return int(re.match(r'\d+', str(window)).group())


def _backtest(ids, weights, matrix, dates, week_indices, window, excluded, requested, rf_context):
    import numpy as np
    levels=np.asarray(matrix, dtype=float)
    portfolio=(levels/levels[0] @ np.asarray([weights[a] for a in ids]))*100
    weekly=portfolio[week_indices]
    returns=weekly[1:]/weekly[:-1]-1
    years=(date.fromisoformat(dates[-1])-date.fromisoformat(dates[0])).days/DAYS_PER_YEAR
    cagr=float((portfolio[-1]/portfolio[0])**(1/years)-1)
    vol=float(np.std(returns,ddof=1)*math.sqrt(52))
    rf=rf_context['risk_free_rate']
    asset_returns=retornos_semanales(levels,week_indices)
    corr=_correlaciones(asset_returns) if len(ids)>1 else [[1.0]]
    return {
      'schema_version':'backtest.v1','base_currency':'EUR','window':window,'units':'decimal',
      'frequency':'DAILY','metrics_frequency':'WEEKLY','max_drawdown_frequency':'DAILY',
      # Decision 6.3 (17-10-2026): Sharpe ex post unico de weekly_sampling.
      # Con volatilidad cero el Sharpe no existe: va vacio, nunca 0 (hallazgo 11, 15-11-2026).
      'metrics':{'cagr':cagr,'volatility':vol,'sharpe':ex_post_sharpe(cagr,rf,vol),
                 'max_drawdown':float(np.min(portfolio/np.maximum.accumulate(portfolio)-1)),'rf_rate':rf},
      'risk_free':rf_context,'portfolio_series':[{'date':d,'value':float(p)} for d,p in zip(dates,portfolio)],
      'asset_ids':ids,'weights_normalized':weights,'correlation_matrix':corr,
      'benchmark_series':{},'synthetics':[],
      'coverage':{'requested_assets':requested,'included_assets':len(ids),'common_observations':len(dates),
                  'measured_observations':len(weekly),'required_observations':_anos_de_la_ventana(window)*52+1,
                  'measurement_frequency':'WEEKLY','first_date':dates[0],'last_date':dates[-1]},
      'excluded_assets':excluded,'warnings':[],
    }, asset_returns


def medir_con_la_serie(periodo, weights, window, rf_context):
    """Las cuatro cifras que la Comparativa de Simular ensena de una cartera, con la misma cuenta y no con otra parecida.
    Si alguna no es un numero no se manda ninguna: lo que no se puede medir se dice que falta."""
    metrics=_backtest(periodo.ids,weights,periodo.matrix,periodo.dates,periodo.week_indices,window,[],len(periodo.ids),rf_context)[0]['metrics']
    medida={campo:metrics[campo] for campo in ('cagr','volatility','sharpe','max_drawdown')}
    return medida if all(isinstance(valor,(int,float)) and math.isfinite(valor) for valor in medida.values()) else None


def _aportaciones_de_la_cartera(ids, norm, returns):
    """La aportacion al riesgo de cada posicion con la covarianza que daria `solve` con estos retornos."""
    from optimization.robust_engine import estimate_covariance
    import numpy as np
    covarianza, meta_covarianza = estimate_covariance(returns.tolist(), ids)
    return _risk_contribution_contract(
        ids, [norm[a] for a in ids], np.asarray(covarianza, dtype=float).tolist(), meta_covarianza.get('covariance_estimator'))


def _punto_de_la_cartera(ids, norm, returns, risk_free_rate):
    """El punto de la cartera con todos sus activos medidos.

    Los mismos estimadores que `solve` usa por dentro (James-Stein para la media, Ledoit-Wolf u OAS para la covarianza),
    sobre la misma matriz y con su misma cuenta del punto: es la cifra que daba `solve(ids, ..., current_weights=norm)`,
    sin resolver una frontera que no se usa. Devuelve el punto, la covarianza y el nombre de su estimador.
    """
    from optimization.robust_engine import _make_point, estimate_covariance, estimate_returns
    import numpy as np
    matriz=returns.tolist()
    medias,_meta=estimate_returns(matriz)
    covarianza,meta_covarianza=estimate_covariance(matriz,ids)
    covarianza=np.asarray(covarianza,dtype=float)
    punto=_make_point(ids,[norm[a] for a in ids],medias,covarianza,risk_free_rate)
    return punto,covarianza.tolist(),meta_covarianza.get('covariance_estimator')


def analyze_horizon(reader, payload, *, risk_free_resolver=None, reference_bundle=None, today=None):
    """One eligible universe, one dated matrix, one selection for every consumer."""
    window=payload.get('window','3Y')
    if window not in ('3Y','5Y'):
        raise InvalidOptimizationRequest('Selecciona 3 o 5 años.')
    positions=payload.get('positions')
    if not isinstance(positions,list) or not 1<=len(positions)<=MAX_POSICIONES_SIMULACION:
        raise InvalidOptimizationRequest(f'Se admiten entre 1 y {MAX_POSICIONES_SIMULACION} posiciones.')
    weights={}
    aliases={}
    conflicts=alias_conflicts([p.get('asset_id') for p in positions if isinstance(p,dict)])
    if conflicts:
        raise InvalidOptimizationRequest(alias_conflict_message(conflicts))
    for p in positions:
        aid=p.get('asset_id') if isinstance(p,dict) else None
        weight=p.get('weight') if isinstance(p,dict) else None
        if not isinstance(aid,str) or not aid or isinstance(weight,bool) or not isinstance(weight,(int,float)) or not math.isfinite(weight) or weight<0:
            raise InvalidOptimizationRequest('Posición o peso inválido.')
        if weight>0:
            # 14-10-2026 (CRIT-02): un ISIN sustituido se analiza con el sucesor vigente.
            aid=canonical_noting(aid,aliases) or aid
            weights[aid]=weights.get(aid,0)+weight
    if not weights:
        raise InvalidOptimizationRequest('La cartera no tiene pesos positivos.')
    started = time.monotonic()
    with prepare_solver_during_reads(len(weights) >= 2):
        bundle=reference_bundle or references()
        loaded, excluded, roots = _load_horizon_prices(reader, weights, con_raices=True)
        read_seconds = time.monotonic() - started
    LOGGER.info('portfolio_horizon_phase', phase='read', assets=len(weights), included=len(loaded), seconds=round(read_seconds, 3))
    if not loaded:
        if excluded and all(item['reason'] == MOTIVO_REPARTE for item in excluded):
            raise OptimizationError('Todas las posiciones reparten y no tenemos todos sus pagos: no se puede simular esta cartera.')
        raise OptimizationError('No hay activos con precios EUR válidos para el análisis.')
    periodo=_periodo_comun(loaded,excluded,window,bundle,today)
    years,ids,dates,matrix,week_indices,extensions=periodo.years,periodo.ids,periodo.dates,periodo.matrix,periodo.week_indices,periodo.extensions
    covered=sum(weights[a] for a in ids); total=sum(weights.values())
    norm={a:weights[a]/covered for a in ids}
    rf_context, warnings=_resolve_risk_free_context(dates[0],dates[-1],.0193,risk_free_resolver)
    warnings=list(warnings)+avisos_del_periodo(dates,today)
    backtest,returns=_backtest(ids,norm,matrix,dates,week_indices,window,excluded,len(weights),rf_context)
    # Los avisos del tipo libre tambien viajan con las metricas, que es donde la pantalla los enseña.
    backtest['warnings']=list(warnings)
    from optimization.stress_analytics import stress_windows
    backtest['stress_scenarios']=stress_windows(
        {a:[{'date':d,'value':v} for d,v in values.items()] for a,values in loaded.items()},
        weights, exclusion_reasons={p['asset_id']:p['reason'] for p in excluded if p['asset_id'] not in loaded},
    )
    frontier=None; frontier_error=None; optimal=None; aportaciones_sin_frontera=None
    # Lo medido que no se puede comprar: entra en las cifras de la cartera y se queda fuera de la frontera. Con la lista
    # vacia todo lo de abajo es lo de antes, linea a linea: `comprables` es `ids`.
    fuera_de_la_frontera=[]
    for a in ids:
        motivo=_motivo_fuera_de_la_frontera(roots.get(a),a,reader)
        if motivo:
            fuera_de_la_frontera.append({'asset_id':a,'reason':motivo,'weight':norm[a]})
    apartados={item['asset_id'] for item in fuera_de_la_frontera}
    comprables=[a for a in ids if a not in apartados]
    # La equiponderada tambien propone pesos, asi que sigue la misma regla que la frontera (pendiente del 19-11-2026: el
    # 15-11 contaba siete valores que no se pueden comprar, y una serie plana la favorece). Pesos iguales entre lo que se
    # puede comprar y cero en lo apartado, sobre las mismas columnas que la cartera, como la del Maximo Sharpe. Sin nada
    # que se pueda comprar no hay equiponderada que proponer: va vacia, y `frontier_excluded_assets` dice por que.
    equal=None
    if comprables:
        equal,_=_backtest(ids,{a:(1/len(comprables) if a not in apartados else 0.0) for a in ids},matrix,dates,week_indices,
                          window,excluded,len(weights),rf_context)
    if len(comprables)>MAX_ACTIVOS_FRONTERA:
        # Sin frontera, pero con la aportacion al riesgo: es una medida con los pesos, no una optimizacion. Sale de la
        # misma covarianza que daria `solve` con estos retornos (estimate_covariance, la que usa por dentro), y viaja
        # fuera de `frontier` porque no hay frontera. Hasta 40 activos no se pasa por aqui y la respuesta es la de antes.
        # El tope se cuenta sobre los que entrarian en la frontera; la aportacion, sobre todos los medidos.
        aportaciones_sin_frontera=_aportaciones_de_la_cartera(ids,norm,returns)
        # «Con series históricas», porque la pantalla puede dibujar debajo la estimada por composición, que es otra
        # cuenta y no pasa por aquí; y «de todos los activos medidos», porque los que no tienen serie se quedan fuera.
        cuantos=(f'tiene {len(ids)} medidos' if not apartados else
                 f'tiene {len(comprables)} medidos que se pueden comprar')
        frontier_error=(f'La frontera con series históricas se calcula con {MAX_ACTIVOS_FRONTERA} activos como máximo y esta cartera '
                        f'{cuantos}: con {len(week_indices)-1} semanas de datos, optimizar con tantos daría '
                        'sobre todo error de estimación. Las cifras de la cartera y la aportación al riesgo sí salen de todos los activos medidos.')
    elif len(comprables)>=2:
        try:
            from optimization.robust_engine import solve
            solver_started = time.monotonic()
            if not apartados:
                engine=solve(ids,returns.tolist(),current_weights=norm,frontier_points=PUNTOS_DE_LA_FRONTERA,risk_free_rate=rf_context['risk_free_rate'])
                actual=engine['current_portfolio']
                covarianza,estimador=engine['covariance_matrix'],engine.get('covariance_meta',{}).get('covariance_estimator')
            else:
                # La frontera, con la misma matriz que Optimizar: las columnas de lo que se puede comprar, en el mismo
                # orden. Sin `current_weights`: el punto que daria el motor seria otra cartera, la de los pesos
                # repartidos sin lo apartado.
                columnas=[ids.index(a) for a in comprables]
                engine=solve(comprables,returns[:,columnas].tolist(),frontier_points=PUNTOS_DE_LA_FRONTERA,risk_free_rate=rf_context['risk_free_rate'])
                # La cartera de verdad, con todo lo medido y el mismo estimador del modelo: es el punto que daba antes.
                # Puede caer fuera de la frontera, porque lleva lo que la frontera no admite, y la nota lo dice.
                actual,covarianza,estimador=_punto_de_la_cartera(ids,norm,returns,rf_context['risk_free_rate'])
            LOGGER.info('portfolio_horizon_phase', phase='solve', assets=len(comprables), seconds=round(time.monotonic() - solver_started, 3), total_seconds=round(time.monotonic() - started, 3))
            contributions, contribution_meta=_risk_contribution_contract(ids,[norm[a] for a in ids],covarianza,estimador)
            cobertura={**backtest['coverage'],'common_observations':len(week_indices)}
            if apartados:
                # La cobertura de la frontera es la de su universo, como en Optimizar.
                cobertura['included_assets']=len(comprables)
            frontier={
              'schema_version':'portfolio-frontier.v1','as_of_date':dates[-1],'units':'decimal','base_currency':'EUR',
              'methodology':{'window':window,'frequency':'WEEKLY','annualization_factor':52,
                 'alignment_policy':'COMMON_WEEKLY_DATES',**rf_context,**engine.get('methodology_extra',{})},
              'coverage':cobertura,
              'current_portfolio':actual,
              **{k:engine[k] for k in ['min_volatility_portfolio','max_sharpe_portfolio','target_portfolio','frontier']},
              'excluded_assets':excluded,'warnings':warnings+engine.get('warnings',[]),
              'risk_contributions':contributions,'risk_contributions_meta':contribution_meta,
            }
            # Se simula sobre las mismas columnas que la cartera, con cero en lo apartado: la serie es la de la cartera de
            # Maximo Sharpe, y la pantalla compara las tres simulaciones activo a activo.
            pesos_maximo=engine['max_sharpe_portfolio']['weights']
            if apartados:
                pesos_maximo={a:pesos_maximo.get(a,0.0) for a in ids}
            optimal,_=_backtest(ids,pesos_maximo,matrix,dates,week_indices,window,excluded,len(weights),rf_context)
        except Exception as exc:
            # Backtest/projection remain usable; solver failure must be visible.
            import logging
            logging.getLogger(__name__).warning('horizon_frontier_failed: %s',type(exc).__name__)
            frontier_error='No se ha podido resolver la frontera con estos datos.'
    elif apartados:
        # Hay cartera que medir, pero no frontera que proponer: lo que se puede comprar no llega a dos activos.
        if len(ids)>=2:
            aportaciones_sin_frontera=_aportaciones_de_la_cartera(ids,norm,returns)
        frontier_error=(f'La frontera solo usa activos que se pueden comprar y necesita al menos dos: en esta cartera '
                        f'{"no queda ninguno" if not comprables else "solo queda uno"} después de apartar '
                        f'{"el que no se puede comprar" if len(apartados)==1 else f"los {len(apartados)} que no se pueden comprar"}. '
                        f'Las cifras de la cartera sí {"lo" if len(apartados)==1 else "los"} incluyen.')
    else:
        frontier_error='La frontera necesita al menos dos activos.'
    respuesta={
      'schema_version':'portfolio-horizon.v1','window':window,'horizon_years':years,
      'reference_version':bundle['version'],'backtest':backtest,'frontier':frontier,
      'frontier_unavailable_reason':frontier_error,'equal_weight':equal,'max_sharpe':optimal,
      'coverage_weight_percent':100*covered/total,'extensions':extensions,
      'methodology':'Reconstrucción retrospectiva con referencia EUR y residuos semanales en bloques; conserva precios reales. No es rentabilidad histórica observada ni predicción. El índice STOXX anterior a su lanzamiento incluye datos retrospectivos.',
    }
    if aportaciones_sin_frontera is not None:
        respuesta['risk_contributions'], respuesta['risk_contributions_meta'] = aportaciones_sin_frontera
    if fuera_de_la_frontera:
        # Solo cuando hay alguno: sin ninguno, la respuesta es la de antes. No es `excluded_assets`, que es lo que no se
        # ha podido medir: esto se mide y esta en las cifras de la cartera. `weight` es su peso en la cartera medida, la
        # misma base que `current_portfolio.weights`.
        respuesta['frontier_excluded_assets']=fuera_de_la_frontera
    return with_alias_resolutions(respuesta, aliases)
