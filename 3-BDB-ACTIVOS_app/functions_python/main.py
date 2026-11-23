"""
Firebase Functions (Python) — backend de BDB-ACTIVOS.

26 funciones: 23 callables (https_fn.on_call) y 3 programadas (scheduler_fn), las de informes.
Todas las callables exigen sesion de Firebase Auth y correo verificado (_require_auth);
el alta de usuarios se gobierna en la consola de Firebase, no aqui. Las de lectura y calculo
leen la maestra como proyecto cruzado (master_project.py, sin valor por defecto), y solo la
base nueva, por readmodel/lector_base_nueva.py: con otro proyecto declarado paran nombrandolo
(master_project.exigir_base_nueva). Escriben las que declaran la cuenta escritora
(WRITER_SERVICE_ACCOUNT): carteras por UID (save_portfolio y delete_portfolio, en portfolios/)
e informes.

Las 20 que trabajaban con la forma de la base vieja (`assets`, `metrics/latest`, `meta/*`) -el
estado del sistema, once `admin_*` y ocho programadas de precios, metricas, integridad, indice y
VL revisados- se borraron el 21-11-2026 con sus modulos (decision 31 del censo
CENSO_BASE_VIEJA_2026-11-21.md; etiqueta referencia-base-vieja-2026-11-21).

Despliegue: solo 23 de las 26 suben (no las tres programadas de informes), con `node scripts/desplegarFunciones.mjs --despliega`
desde la carpeta de la app (lista FUNCIONES; su puerta, scripts/puertaFunciones.mjs, rechaza
cualquier otro `firebase deploy` con firebase.funciones.json). Region europe-west1.
"""
import hashlib
import os
import logging

from firebase_admin import initialize_app
from firebase_functions import https_fn, options, scheduler_fn
# C1 (auditoría 29-09): el logger de firebase_functions imprime JSON en stdout
# (Cloud Run lo indexa como jsonPayload); `logging` estándar acaba en textPayload.
from firebase_functions import logger as fb_logger

from master_project import exigir_arranque_sin_bdb, exigir_emulador_en_local

# Antes de inicializar nada: la app de abajo sale del proyecto del runtime, no de
# MASTER_PROJECT_ID, y con el proyecto de BDB escribiria alli carteras e informes.
exigir_arranque_sin_bdb()
# Y en local el proyecto es el real de la base nueva (21-11-2026): sin el emulador de
# Firestore declarado, el cliente por defecto iria a la nube.
exigir_emulador_en_local()

# App del PROYECTO PROPIO (para contexto de Auth y, en B2, carteras app-owned).
initialize_app()

LOGGER = logging.getLogger(__name__)
APPCHECK_ENFORCED = os.environ.get("BDB_APPCHECK_ENFORCE", "false").lower() in ("1", "true", "yes", "on")
def _enabled_unless_off(value) -> bool:
    """Interruptor que falla cerrado: solo un «no» explicito (false, 0, no u off, sin
    distinguir mayusculas y sin espacios) lo apaga; cualquier otro valor, incluidos el
    vacio, " true" o una errata, lo deja activo. N-09 (tercera pasada, 17-10-2026): antes
    solo se encendia con 1/true/yes/on sin strip, y un "" o " true" lo apagaba. Mismo
    criterio que parseEnabledUnlessOff del frontend (runtimeConfig, VITE_BDB_REQUIRE_...)."""
    return str("" if value is None else value).strip().lower() not in ("false", "0", "no", "off")


# Ola A1 (Q1): toda callable exige email verificado, ademas de sesion. Quien puede darse de
# alta lo gobierna la consola de Firebase, no este codigo.
# Interruptor de emergencia sin tocar codigo: BDB_REQUIRE_EMAIL_VERIFIED=false.
EMAIL_VERIFIED_REQUIRED = _enabled_unless_off(os.environ.get("BDB_REQUIRE_EMAIL_VERIFIED"))
# El proyecto donde CORREN las Functions, que no es el de la maestra: ese lo resuelve
# master_project, sin defecto. Lo pone el runtime, y la CLI de Firebase tambien al
# emular y al desplegar. Aqui tampoco hay defecto, y por la misma razon: hasta el
# 03-11-2026 caia en el proyecto real de BDB, asi que este clon reclamaba sus service
# accounts sin decirlo. Sin proyecto no se reclama identidad ninguna -se despliega con
# la de serie-, que es lo unico honesto cuando no se sabe donde se despliega.
RUNTIME_PROJECT_ID = os.environ.get("GCLOUD_PROJECT") or os.environ.get("GOOGLE_CLOUD_PROJECT")
READER_SERVICE_ACCOUNT = os.environ.get("BDB_READER_SERVICE_ACCOUNT") or (
    f"bdb-functions-reader@{RUNTIME_PROJECT_ID}.iam.gserviceaccount.com"
    if RUNTIME_PROJECT_ID
    else None
)
WRITER_SERVICE_ACCOUNT = os.environ.get("BDB_WRITER_SERVICE_ACCOUNT") or (
    f"bdb-functions-writer@{RUNTIME_PROJECT_ID}.iam.gserviceaccount.com"
    if RUNTIME_PROJECT_ID
    else None
)

options.set_global_options(
    region="europe-west1",
    memory=options.MemoryOption.MB_512,
    # Proyecto privado de baja concurrencia: limita la amplificacion horizontal
    # de lecturas incluso si App Check sigue temporalmente en observacion.
    max_instances=5,
    enforce_app_check=APPCHECK_ENFORCED,
    service_account=READER_SERVICE_ACCOUNT,
)

from readmodel import repository as repo
from readmodel.firestore_client import _valid_asset_id
from readmodel.lector_base_nueva import lector_de_activos, lector_de_optimizacion, resolver_tipo_libre
from portfolios import repository as portfolios
from portfolios.store import almacen_de_carteras
from optimization.repository import (
    InvalidOptimizationRequest,
    OptimizationError,
    OptimizationInternalError,
    optimize_portfolio as optimize_portfolio_service,
    build_rebased_series,
    backtest_portfolio as backtest_portfolio_service,
)
from optimization.improvement_service import improve_portfolio as improve_portfolio_service
from macro_reference import get_macro_reference as macro_reference_service
from ecb_rates import (
    get_ecb_rates as ecb_rates_service,
    get_euro_yield_curve as euro_yield_curve_service,
)


class _ModuloPerezoso:
    """Un modulo que se importa la primera vez que se usa, no al arrancar.

    Firebase importa `main.py` entero en cada instancia (512 MB) para descubrir las funciones. El informe semanal solo lo
    usan las funciones de informes, y trae consigo `curl_cffi`: arrastrarlos al arranque era memoria y tiempo de arranque que la mayoria de las instancias no usan
    (P2-10, auditoria 20-11-2026). Se comporta como el modulo (los atributos van al modulo, y las pruebas pueden
    sustituirlos con `monkeypatch`), y no cambia que funciones descubre Firebase: eso lo deciden los decoradores.
    """

    def __init__(self, nombre: str):
        object.__setattr__(self, "_nombre", nombre)

    def _modulo(self):
        import importlib
        return importlib.import_module(object.__getattribute__(self, "_nombre"))

    def __getattr__(self, atributo):
        return getattr(self._modulo(), atributo)


weekly_report = _ModuloPerezoso("weekly_report")


def _config_de_informes():
    return weekly_report.REPORT_CONFIG


def weekly_report_service(*args, **kwargs):
    return weekly_report.get_weekly_report(*args, **kwargs)


def publish_strategy_report_service(*args, **kwargs):
    return weekly_report.publish_strategy_report(*args, **kwargs)


from analyze_portfolio import analyze_portfolio as analyze_portfolio_service
from economic_calendar import get_economic_calendar as economic_calendar_service
from spanish_calendar import get_dividends_calendar as dividends_calendar_service, get_earnings_calendar as earnings_calendar_service
from quietlog import swallowed
from rate_limit import RateLimitExceeded, UserRateLimiter

RATE_LIMITER = UserRateLimiter()

# C1 (auditoría 29-09): observación de App Check. Una línea jsonPayload por
# llamada, con y sin token, para tener denominador antes de activar el enforce.
APPCHECK_OBSERVATION_MESSAGE = "app_check_observation"
_UA_MAX_LEN = 80


def _uid_hash(uid: str) -> str:
    """Primeros 12 hex del sha256 del uid: nunca el uid ni el correo en claro."""
    return hashlib.sha256(str(uid).encode("utf-8")).hexdigest()[:12]


def _operation_name(req, operation: str | None) -> str:
    if operation:
        return operation
    # Cloud Run expone el nombre del servicio (get-asset-detail) en K_SERVICE.
    service = os.environ.get("K_SERVICE")
    if service:
        return service.replace("-", "_")
    raw = getattr(req, "raw_request", None)
    path = str(getattr(raw, "path", "") or "").strip("/")
    return path.replace("-", "_") or "-"


def _observe_app_check(req, uid: str, operation: str | None) -> dict:
    """Emite `app_check_observation` (INFO, jsonPayload). Nunca rechaza ni lanza."""
    raw = getattr(req, "raw_request", None)
    headers = getattr(raw, "headers", None) or {}
    ua = str(headers.get("User-Agent") or "")[:_UA_MAX_LEN]
    entry = {
        "app_check": "missing" if getattr(req, "app", None) is None else "present",
        "operation": _operation_name(req, operation),
        "origin": str(headers.get("Origin") or "-"),
        "user_agent": ua or "-",
        "client": "browser" if "Mozilla" in ua else ("script" if ua else "unknown"),
        "uid_hash": _uid_hash(uid),
    }
    try:
        fb_logger.info(APPCHECK_OBSERVATION_MESSAGE, **entry)
    except Exception:
        swallowed("main.py:_observe_app_check")
    return entry


def _require_auth(
    req: https_fn.CallableRequest,
    *,
    operation: str | None = None,
    limit_per_minute: int | None = None,
):
    if req.auth is None:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.UNAUTHENTICATED,
                                  "Necesitas iniciar sesion.")
    if EMAIL_VERIFIED_REQUIRED:
        token = getattr(req.auth, "token", None) or {}
        if not token.get("email_verified", False):
            raise https_fn.HttpsError(https_fn.FunctionsErrorCode.PERMISSION_DENIED,
                                      "Verifica tu correo electronico para usar la aplicacion.")
    if getattr(req, "app", None) is None:
        LOGGER.warning("app_check_token_missing")
    uid = req.auth.uid
    # C1 (auditoría 29-09): observación con y sin token; sin cambio de comportamiento.
    try:
        _observe_app_check(req, uid, operation)
    except Exception:
        swallowed("main.py:_require_auth.observe")
    if operation and limit_per_minute:
        try:
            RATE_LIMITER.check(uid, operation, limit=limit_per_minute)
        except RateLimitExceeded as exc:
            raise https_fn.HttpsError(
                https_fn.FunctionsErrorCode.RESOURCE_EXHAUSTED,
                f"Demasiadas solicitudes. Reintenta en {exc.retry_after_seconds} segundos.",
            ) from exc
    return uid


def _require_admin(
    req: https_fn.CallableRequest,
    *,
    operation: str | None = None,
    limit_per_minute: int | None = None,
):
    """Gate de admin: solo el custom claim `admin` == True (lo pone `npm run nube:administrador` de la plataforma).

    S-08 (auditoría 29-09): se retira la allowlist ADMIN_UIDS (env); era un
    segundo camino de administrador fuera de Auth.

    ALTA-04 (auditoría 16-10-2026): cada callable de administración nombra su
    `operation` y su `limit_per_minute`, que pasan a `_require_auth`. Antes no se
    pasaban y el limitador se saltaba en las 13 (recorridos de la maestra, EODHD y
    Gemini). Desde el 21-11-2026 queda una, `admin_publish_report`: las otras doce eran de la
    base vieja. tests/test_auth_gates.py comprueba el inventario.
    """
    uid = _require_auth(req, operation=operation, limit_per_minute=limit_per_minute)
    token = getattr(req.auth, "token", None) or {}
    if token.get("admin") is True:
        return uid
    raise https_fn.HttpsError(https_fn.FunctionsErrorCode.PERMISSION_DENIED,
                              "Requiere permisos de administrador.")


# Caps server-side (P0-4): topes de tamaño para abrir a terceros sin abuso.
CAP_SEARCH_LIMIT = 200
CAP_COMPARE_IDS = 25
CAP_OPTIMIZE_ASSETS = 40
# Series sueltas (get_price_series) y backtest sin `analysis_bundle` (la comparacion a 10 anos): 40.
# 04-09-2026: 25 -> 40 para que quepan las carteras reales de Andbank (el extracto trae 39 posiciones).
# Va con MAX_REBASED_SERIES_ASSETS (optimization/repository.py). No se sube el 10-11-2026: lo que se
# midio entonces es la simulacion de 3 y 5 anos, no estos dos caminos.
CAP_SERIES_ASSETS = 40
CAP_POSITIONS = 200
# La simulacion de 3 y 5 anos (backtest_portfolio con `analysis_bundle`): MAX_POSICIONES_SIMULACION de
# portfolio_horizon.py, medido el 10-11-2026 con scripts/medir_tope_simulacion.py (manda la memoria:
# 85 posiciones son +284 MB de pico, 200 serian +707 MB). No llega a CAP_POSITIONS: de 86 a 200 la
# pantalla dice el limite. La frontera se queda en 40 activos (MAX_ACTIVOS_FRONTERA).
CAP_SIMULATION_POSITIONS = 85

def _cap_list(data, field, cap, label):
    """Rechaza si data[field] es una lista que excede el cap."""
    items = (data or {}).get(field)
    if isinstance(items, list) and len(items) > cap:
        # 10-11-2026: lleva cuantos llegan. La pantalla lo lee (src/core/appError.ts: limiteSuperado) para
        # decir el limite y cuantas tiene la cartera, en vez de «un dato no valido» y un «reintentar» que no arregla nada.
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                                  "Maximo %d %s por peticion; llegan %d." % (cap, label, len(items)))


def _cap_int(data, field, default, cap, *, minimum=0, label=None):
    """Entero de entrada de usuario: entrada mala -> INVALID_ARGUMENT (no 500),
    y siempre acotado a [minimum, cap]. Companero de _cap_list (P0-4)."""
    raw = (data or {}).get(field, default)
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        raw = default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                                  "%s debe ser un numero entero." % (label or field))
    return min(max(value, minimum), cap)



# 15-11-2026 (hallazgos 19 y 21 de la auditoria del backend): las funciones de catalogo validan lo que
# reciben y dicen como fallo lo que es un fallo. Mismo estilo que _cap_list/_cap_int: una entrada
# mala es INVALID_ARGUMENT con el campo nombrado, nunca un error interno ni una respuesta vacia.
CAP_SEARCH_QUERY_CHARS = 200
CAP_SEARCH_TYPES = 10


def _invalido(mensaje):
    return https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, mensaje)


def _datos(req) -> dict:
    """Los datos de la peticion, que tienen que ser un objeto (o nada)."""
    data = req.data
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise _invalido("Los datos de la peticion tienen que ser un objeto.")
    return data


def _id_de_activo(value, label="asset_id"):
    """Un identificador de activo valido, sin espacios alrededor. Es la puerta del lector antiguo
    (`_valid_asset_id`): un id con barras leeria otro documento del catalogo (hallazgo 21)."""
    if value is None or (isinstance(value, str) and not value.strip()):
        raise _invalido("Falta %s." % label)
    if not isinstance(value, str):
        raise _invalido("%s tiene que ser un texto." % label)
    asset_id = value.strip()
    if not _valid_asset_id(asset_id):
        raise _invalido("%s no es un identificador valido: solo letras, numeros, punto, guion y guion bajo, "
                        "hasta 128 caracteres." % label)
    return asset_id


def _ids_de_activos(data, field) -> list:
    """La lista de identificadores de `field`: tiene que ser una lista de textos. Un texto vacio se ignora, como antes.

    Un texto que no tiene forma de identificador (p. ej. «BRK/B», que Posiciones acepta) NO rechaza la peticion: en un
    lote, el trabajo es decir cual no se reconoce y resolver el resto. El repositorio no lo lee y lo da por inexistente;
    la defensa del hallazgo 21 sigue en el lector."""
    ids = data.get(field)
    if not isinstance(ids, list):
        raise _invalido("%s debe ser una lista." % field)
    for posicion, item in enumerate(ids):
        if not isinstance(item, str):
            raise _invalido("%s[%d] tiene que ser un texto." % (field, posicion))
    return [item.strip() for item in ids if item.strip()]


def _texto_opcional(data, field, cap_chars, label):
    value = data.get(field)
    if value is None:
        return ""
    if not isinstance(value, str):
        raise _invalido("%s tiene que ser un texto." % label)
    if len(value) > cap_chars:
        raise _invalido("Maximo %d caracteres para %s; llegan %d." % (cap_chars, label, len(value)))
    return value


def _lista_de_textos_opcional(data, field, cap, label):
    value = data.get(field)
    if value is None:
        return None
    if not isinstance(value, list):
        raise _invalido("%s debe ser una lista." % field)
    _cap_list(data, field, cap, label)
    if not all(isinstance(item, str) and item.strip() for item in value):
        raise _invalido("Cada elemento de %s tiene que ser un texto." % field)
    return value


def _posiciones(data, field="positions") -> list:
    """`positions` como lista de objetos. Un `asset_id` sin forma de identificador no rechaza la peticion: esa
    posicion sale como no reconocida, fila a fila, y el resto se resuelve (`repo.resolve_portfolio`)."""
    value = data.get(field)
    if value is None:
        return []
    if not isinstance(value, list):
        raise _invalido("%s debe ser una lista." % field)
    for posicion, item in enumerate(value):
        if not isinstance(item, dict):
            raise _invalido("%s[%d] tiene que ser un objeto." % (field, posicion))
    return value


def _base_no_disponible(exc):
    """`repo.LecturaFallida` -> UNAVAILABLE: la pantalla reintenta sola y, si sigue, dice que reintente."""
    return https_fn.HttpsError(
        https_fn.FunctionsErrorCode.UNAVAILABLE,
        "No se ha podido leer la base de activos en este momento. Es un fallo pasajero, no que el dato no "
        "exista: vuelve a intentarlo en unos segundos.")


@https_fn.on_call()
def search_assets(req: https_fn.CallableRequest):
    _require_auth(req, operation="search_assets", limit_per_minute=120)
    data = _datos(req)
    limit = _cap_int(data, "limit", 20, CAP_SEARCH_LIMIT, minimum=1)
    query = _texto_opcional(data, "query", CAP_SEARCH_QUERY_CHARS, "la busqueda")
    types = _lista_de_textos_opcional(data, "types", CAP_SEARCH_TYPES, "tipos")
    cursor = str(data.get("cursor") or "").strip()[:64] or None
    try:
        page = repo.search_assets_page(lector_de_activos(), query, types, limit, cursor=cursor)
    except repo.LecturaFallida as exc:
        raise _base_no_disponible(exc) from exc
    # total_matches/next_cursor/read_warnings son aditivos: los clientes antiguos los ignoran.
    return {
        "assets": page["results"],
        "source": "BBDD_FIRESTORE_LIVE",
        "total_matches": page["total_matches"],
        "next_cursor": page["next_cursor"],
        "read_warnings": page.get("read_warnings") or [],
    }


@https_fn.on_call()
def get_asset_detail(req: https_fn.CallableRequest):
    _require_auth(req, operation="get_asset_detail", limit_per_minute=60)
    asset_id = _id_de_activo(_datos(req).get("asset_id"))
    try:
        detail = repo.get_asset_detail(lector_de_activos(), asset_id, with_holdings=False)
    except repo.LecturaFallida as exc:
        raise _base_no_disponible(exc) from exc
    if detail is None:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.NOT_FOUND, "Activo no encontrado.")
    return detail


@https_fn.on_call()
def get_asset_holdings(req: https_fn.CallableRequest):
    _require_auth(req, operation="get_asset_holdings", limit_per_minute=30)
    asset_id = _id_de_activo(_datos(req).get("asset_id"))
    try:
        return repo.get_asset_holdings(lector_de_activos(), asset_id)
    except repo.LecturaFallida as exc:
        raise _base_no_disponible(exc) from exc


@https_fn.on_call()
def get_asset_holdings_batch(req: https_fn.CallableRequest):
    """Holdings de hasta 25 activos en una llamada (ola 3b).

    Sustituye el abanico de n `get_asset_holdings` simultaneas del X-Ray, que
    provocaba cola y arranques en frio en Cloud Run (~7 s hasta pantalla
    utilizable con 10 fondos, medido en produccion el 11-08).
    """
    _require_auth(req, operation="get_asset_holdings_batch", limit_per_minute=30)
    data = _datos(req)
    _cap_list(data, "asset_ids", CAP_COMPARE_IDS, "activos")
    ids = _ids_de_activos(data, "asset_ids")
    avisos = []
    try:
        holdings = repo.get_asset_holdings_many(lector_de_activos(), ids, avisos)
    except repo.LecturaFallida as exc:
        raise _base_no_disponible(exc) from exc
    # read_warnings es aditivo: un activo cuyas posiciones no se pudieron leer sale como None y aqui se dice.
    return {"holdings": holdings, "read_warnings": avisos}


@https_fn.on_call()
def compare_assets(req: https_fn.CallableRequest):
    _require_auth(req, operation="compare_assets", limit_per_minute=30)
    data = _datos(req)
    _cap_list(data, "asset_ids", CAP_COMPARE_IDS, "activos")
    ids = _ids_de_activos(data, "asset_ids")
    try:
        # missing_asset_ids y read_warnings son aditivos; las filas son las de siempre.
        return repo.compare_assets_page(lector_de_activos(), ids)
    except repo.LecturaFallida as exc:
        raise _base_no_disponible(exc) from exc


@https_fn.on_call()
def resolve_portfolio(req: https_fn.CallableRequest):
    _require_auth(req, operation="resolve_portfolio", limit_per_minute=30)
    data = _datos(req)
    _cap_list(data, "positions", CAP_POSITIONS, "posiciones")
    positions = _posiciones(data)
    try:
        return repo.resolve_portfolio(lector_de_activos(), positions)
    except repo.LecturaFallida as exc:
        raise _base_no_disponible(exc) from exc


@https_fn.on_call(memory=options.MemoryOption.GB_1, max_instances=5, timeout_sec=300)
def optimize_portfolio(req: https_fn.CallableRequest):
    _require_auth(req, operation="optimize_portfolio", limit_per_minute=12)
    _cap_list(_datos(req), "asset_ids", CAP_OPTIMIZE_ASSETS, "activos")
    try:
        return optimize_portfolio_service(
            lector_de_optimizacion(), _datos(req),
            risk_free_resolver=resolver_tipo_libre(),
        )
    except InvalidOptimizationRequest as exc:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, str(exc))
    except OptimizationError as exc:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.FAILED_PRECONDITION, str(exc))
    except OptimizationInternalError as exc:
        # Un fallo del programa, no «sin solucion»: INTERNAL, con su texto y su referencia, sin la traza (va al registro).
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INTERNAL, str(exc))


@https_fn.on_call()
def get_price_series(req: https_fn.CallableRequest):
    _require_auth(req, operation="get_price_series", limit_per_minute=30)
    _cap_list(_datos(req), "asset_ids", CAP_SERIES_ASSETS, "activos")
    try:
        return build_rebased_series(lector_de_optimizacion(), _datos(req))
    except InvalidOptimizationRequest as exc:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, str(exc))
    except OptimizationError as exc:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.FAILED_PRECONDITION, str(exc))


@https_fn.on_call(min_instances=0, max_instances=5, memory=options.MemoryOption.GB_1, timeout_sec=300)
def backtest_portfolio(req: https_fn.CallableRequest):
    _require_auth(req, operation="backtest_portfolio", limit_per_minute=20)
    bundle = _datos(req).get("analysis_bundle") is True
    _cap_list(_datos(req), "positions", CAP_SIMULATION_POSITIONS if bundle else CAP_SERIES_ASSETS, "posiciones")
    try:
        if bundle:
            from portfolio_horizon import analyze_horizon
            return analyze_horizon(
                lector_de_optimizacion(), _datos(req),
                risk_free_resolver=resolver_tipo_libre(),
            )
        return backtest_portfolio_service(
            lector_de_optimizacion(), _datos(req),
            risk_free_resolver=resolver_tipo_libre(),
        )
    except InvalidOptimizationRequest as exc:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, str(exc))
    except OptimizationError as exc:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.FAILED_PRECONDITION, str(exc))


@https_fn.on_call(max_instances=3, memory=options.MemoryOption.GB_1, timeout_sec=300)
def improve_portfolio(req: https_fn.CallableRequest):
    """«Mejorar cartera» (M1): sustituciones equivalentes con pesos conservados.

    Solo lectura. Carga una vez las series de cartera + candidatos (tope
    MAX_IMPROVEMENT_ASSETS en el servicio) y evalua las combinaciones en memoria;
    por eso no reutiliza backtest_portfolio llamada a llamada.
    """
    _require_auth(req, operation="improve_portfolio", limit_per_minute=6)
    try:
        return improve_portfolio_service(
            lector_de_optimizacion(), _datos(req),
            risk_free_resolver=resolver_tipo_libre(),
        )
    except InvalidOptimizationRequest as exc:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, str(exc))
    except OptimizationError as exc:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.FAILED_PRECONDITION, str(exc))


@https_fn.on_call(max_instances=3, memory=options.MemoryOption.GB_1, timeout_sec=120)
def generate_portfolio_draft(req: https_fn.CallableRequest):
    """Borrador de cartera por nivel de riesgo (decision 122, `generador_de_carteras.py`).

    Solo lectura. Lee una vez las tarjetas de los fondos y la serie de los que pasan los filtros, y lo guarda 15 minutos: el
    segundo borrador no vuelve a leer. Solo con la base nueva, como todas: con otro proyecto declarado lo dice.
    """
    _require_auth(req, operation="generate_portfolio_draft", limit_per_minute=10)
    datos = _datos(req)
    from master_project import BaseNuevaRequerida, exigir_base_nueva
    from generador_de_carteras import GeneradorNoDisponible, generar_borrador
    from readmodel.firestore_client import get_master_db
    from readmodel.lector_base_nueva import LectorBaseNueva, LectorOptimizacionBaseNueva
    try:
        exigir_base_nueva()
    except BaseNuevaRequerida as exc:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.FAILED_PRECONDITION, str(exc)) from exc
    try:
        db = get_master_db()
        # El Sharpe y el Sortino son los de la ficha (20-11-2026): el generador ya no mide con el €STR por su cuenta.
        return generar_borrador(LectorBaseNueva(db), LectorOptimizacionBaseNueva(db), datos)
    except GeneradorNoDisponible as exc:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.FAILED_PRECONDITION, str(exc))


@https_fn.on_call()
def get_macro_reference(req: https_fn.CallableRequest):
    # Auditoría 11-08 (D13): mismo rate limit que sus hermanas de datos macro.
    _require_auth(req, operation="get_macro_reference", limit_per_minute=30)
    return macro_reference_service(_datos(req))


@https_fn.on_call(max_instances=5)
def get_ecb_rates(req: https_fn.CallableRequest):
    _require_auth(req, operation="get_ecb_rates", limit_per_minute=30)
    return ecb_rates_service(_datos(req))


@https_fn.on_call(max_instances=5)
def get_euro_yield_curve(req: https_fn.CallableRequest):
    _require_auth(req, operation="get_euro_yield_curve", limit_per_minute=30)
    return euro_yield_curve_service(_datos(req))


@https_fn.on_call()
def get_weekly_report(req: https_fn.CallableRequest):
    _require_auth(req, operation="get_weekly_report", limit_per_minute=60)
    data = _datos(req)
    # Un tipo no permitido llegaba como error interno (WeeklyReportValidationError del servicio).
    report_type = data.get("type")
    if report_type not in (None, "") and (not isinstance(report_type, str) or report_type not in _config_de_informes()):
        raise _invalido("type no es un tipo de informe valido; los validos son: %s."
                        % ", ".join(sorted(_config_de_informes())))
    return weekly_report_service(data)


@https_fn.on_call(secrets=["GEMINI_API_KEY"], max_instances=3, timeout_sec=120)
def analyze_portfolio(req: https_fn.CallableRequest):
    _require_auth(req, operation="analyze_portfolio", limit_per_minute=6)
    data = _datos(req)
    _cap_list(data, "positions", CAP_POSITIONS, "posiciones")
    _posiciones(data)
    return analyze_portfolio_service(data)


@https_fn.on_call()
def get_economic_calendar(req: https_fn.CallableRequest):
    _require_auth(req, operation="get_economic_calendar", limit_per_minute=30)
    return economic_calendar_service(_datos(req))


# Sin secreto a proposito. spanish_calendar usaria EODHD_API_KEY si estuviera, pero el plan
# contratado no incluye su calendario (medido el 03-11-2026: 422 en dividendos y 403 en
# resultados), asi que la fuente real es Yahoo, que no pide clave. Sin clave, esa via se salta.
@https_fn.on_call(timeout_sec=120)
def get_dividends_calendar(req: https_fn.CallableRequest):
    _require_auth(req, operation="get_dividends_calendar", limit_per_minute=30)
    return dividends_calendar_service(_datos(req))


@https_fn.on_call(timeout_sec=120)
def get_earnings_calendar(req: https_fn.CallableRequest):
    _require_auth(req, operation="get_earnings_calendar", limit_per_minute=30)
    return earnings_calendar_service(_datos(req))


# ---------- Carteras app-owned (B2): CRUD por UID, escritura en el proyecto propio ----------

@https_fn.on_call(service_account=WRITER_SERVICE_ACCOUNT)
def save_portfolio(req: https_fn.CallableRequest):
    uid = _require_auth(req, operation="save_portfolio", limit_per_minute=30)
    try:
        return portfolios.save_portfolio(almacen_de_carteras(), uid, _datos(req))
    except portfolios.InvalidPortfolio as exc:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, str(exc))
    except portfolios.PortfolioConflict as exc:
        # DIS-03: con `expected_updated_at`, la guardada ya no es la que el cliente abrio. No se ha escrito nada.
        mensaje = ("No se ha guardado: la cartera guardada ya no existe, se ha eliminado desde otra pestaña u otro equipo."
                   if exc.reason == "deleted" else
                   "No se ha guardado: la cartera guardada ha cambiado desde que la abriste, se ha guardado desde otra pestaña u otro equipo.")
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.ABORTED,
            mensaje,
            details={"code": "PORTFOLIO_CONFLICT", "reason": exc.reason, "current_updated_at": exc.current_updated_at},
        )


@https_fn.on_call()
def list_portfolios(req: https_fn.CallableRequest):
    uid = _require_auth(req, operation="list_portfolios", limit_per_minute=60)
    items = portfolios.list_portfolios(almacen_de_carteras(), uid)
    return {
        "schema_version": portfolios.SCHEMA_VERSION,
        "portfolios": items,
        "count": len(items),
    }


@https_fn.on_call(service_account=WRITER_SERVICE_ACCOUNT)
def delete_portfolio(req: https_fn.CallableRequest):
    uid = _require_auth(req, operation="delete_portfolio", limit_per_minute=30)
    pid = _datos(req).get("portfolio_id")
    try:
        return portfolios.delete_portfolio(almacen_de_carteras(), uid, pid)
    except portfolios.InvalidPortfolio as exc:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, str(exc))
    except portfolios.PortfolioConflict:
        # Se guardaba la misma cartera mientras se borraba y, tras varios intentos, no hubo manera de atar el borrado a lo
        # leido: no se ha borrado nada y se puede volver a intentar.
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.ABORTED,
            "No se ha borrado: la cartera se estaba guardando en ese momento. Vuelve a intentarlo.",
        )


@scheduler_fn.on_schedule(
    schedule="15 7 * * 1",
    timezone="Europe/Madrid",
    # Ola 09-2026: con gemini-3.1-pro-preview y thinkingLevel high la fase de
    # investigacion tarda ~57 s y la de redaccion ~15 s. 300 s bastaban para el
    # camino feliz, pero no para una cascada de reintentos sobre la lista de
    # modelos. La funcion corre una vez por semana: el margen no cuesta nada.
    timeout_sec=540,
    memory=options.MemoryOption.MB_512,
    max_instances=1,
    secrets=["GEMINI_API_KEY"],
    service_account=WRITER_SERVICE_ACCOUNT,
)
def scheduled_publish_weekly_report(event: scheduler_fn.ScheduledEvent) -> None:
    try:
        result = publish_strategy_report_service("WEEKLY_REPORT")
        if result.get("status") not in ("PUBLISHED", "ALREADY_PUBLISHED", "IN_PROGRESS"):
            raise RuntimeError("Weekly report publication failed: " + str(result.get("status")))
        print("scheduled_publish_weekly_report_ok:", result)
    except Exception as exc:
        print("ERROR scheduled_publish_weekly_report_failed:", str(exc))
        raise


# 09-2026: el informe mensual se retira y su hueco lo ocupa el diario. El mensual
# apenas anadia nada sobre el semanal y su ventana de frescura de 40 dias hacia
# que casi siempre se mostrase un documento viejo. Los documentos `monthly-*` ya
# publicados siguen en Firestore, simplemente ya no se consultan.
@scheduler_fn.on_schedule(
    # De lunes a viernes a las 07:00, quince minutos antes que el semanal para
    # que el lunes no se solapen. El del lunes cubre el fin de semana.
    schedule="0 7 * * 1-5",
    timezone="Europe/Madrid",
    timeout_sec=540,
    memory=options.MemoryOption.MB_512,
    max_instances=1,
    secrets=["GEMINI_API_KEY"],
    service_account=WRITER_SERVICE_ACCOUNT,
)
def scheduled_publish_daily_report(event: scheduler_fn.ScheduledEvent) -> None:
    try:
        result = publish_strategy_report_service("DAILY_REPORT")
        if result.get("status") not in ("PUBLISHED", "ALREADY_PUBLISHED", "IN_PROGRESS"):
            raise RuntimeError("Daily report publication failed: " + str(result.get("status")))
        print("scheduled_publish_daily_report_ok:", result)
    except Exception as exc:
        print("ERROR scheduled_publish_daily_report_failed:", str(exc))
        raise


@https_fn.on_call(timeout_sec=540, secrets=["GEMINI_API_KEY"], max_instances=1,
                  service_account=WRITER_SERVICE_ACCOUNT)
def admin_publish_report(req: https_fn.CallableRequest):
    """Dispara a mano la generacion de un informe, sin esperar al cron.

    Hasta ahora los unicos puntos de entrada eran los schedulers: probar un
    cambio de prompt obligaba a esperar al dia siguiente.
    """
    uid = _require_admin(req, operation="admin_publish_report", limit_per_minute=2)
    data = _datos(req)
    report_type = str(data.get("type") or "DAILY_REPORT")
    # Solo un booleano verdadero fuerza: "true" o 1 no cuentan (15-11-2026).
    force = data.get("force") is True
    if report_type not in _config_de_informes():
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                                  "Tipo de informe no permitido.")
    try:
        return publish_strategy_report_service(
            report_type, force=force, forced_by=_uid_hash(uid) if force else None)
    except Exception as exc:
        # El detalle (puede traer texto crudo del proveedor de IA) va al registro, no al cliente.
        LOGGER.error("admin_publish_report_failed type=%s force=%s error_type=%s detail=%s",
                     report_type, force, type(exc).__name__, str(exc)[:2000])
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.INTERNAL,
            "No se pudo generar o guardar el informe. El detalle queda en el registro del servidor.",
            details={"error_type": type(exc).__name__},
        ) from exc


@scheduler_fn.on_schedule(
    schedule="35,50 7 * * 1-5", timezone="Europe/Madrid", timeout_sec=880,
    memory=options.MemoryOption.MB_512, max_instances=1, secrets=["GEMINI_API_KEY"],
    service_account=WRITER_SERVICE_ACCOUNT,
)
def scheduled_recover_strategy_reports(event: scheduler_fn.ScheduledEvent) -> None:
    from report_publication import recover_due_reports
    from firebase_admin import firestore
    result = recover_due_reports(db=firestore.client(), publish_report=publish_strategy_report_service)
    print("scheduled_recover_strategy_reports:", result)
    if any(row.get("status") not in ("PUBLISHED", "ALREADY_PUBLISHED", "IN_PROGRESS") for row in result):
        raise RuntimeError("Strategy report recovery failed; see structured results")


# Prepare numerical endpoints during container startup, before handling requests.
# FUNCTION_TARGET is absent during deployment discovery and in ordinary tests.
from optimization.runtime import prepare_solver_at_startup
prepare_solver_at_startup()
