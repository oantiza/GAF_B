"""Verificador de divisa de las series de precios. SOLO LECTURA.

Auditoría de divisas (06-09-2026). Dos fallos motivaron este control:

- La conversión a euros la decidía el METADATO (`source_currency` del documento
  anterior, o `vl_divisa` de la ficha) en vez de la divisa real del listado, así que
  cotizaciones que ya venían en euros se dividían otra vez por EUR/USD, y cotizaciones
  en dólares se guardaban sin convertir.
- El motor excluía por la divisa de la FICHA, no por la de la serie.

Este script no arregla nada: dice, documento a documento, si el tratamiento aplicado
concuerda con la divisa que el proveedor declara para ese listado, y separa lo que no
ha podido verificar de lo que está mal. Es el control que debe pasar antes de admitir
una serie en los cálculos.

Uso:
    python scripts/verify_price_currency.py                    # universo completo
    python scripts/verify_price_currency.py --assets ISIN,ISIN # solo esos
    python scripts/verify_price_currency.py --declared-non-eur # los de ficha != EUR
    python scripts/verify_price_currency.py --sample-prices 3  # contrasta N puntos/doc

Requiere EODHD_API_KEY en el entorno y credenciales de lectura de Firestore.
La clave no se imprime ni se guarda en la salida.
"""
import argparse
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date

from google.cloud import firestore

# La REGLA de resolucion de divisa es la MISMA que usa el productor: vive en
# functions_python/fx_currency.py. Tenerla duplicada aqui fue el fallo de la tercera
# revision: se corrigio el productor y el verificador siguio aceptando —y cacheando—
# «NA» como divisa, y presentaba ese fallo propio como «el proveedor no da precios».
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "functions_python"))
import fx_currency  # noqa: E402
from master_project import exigir_proyecto_permitido, master_project_id  # noqa: E402


def _carga_env():
    """Toma EODHD_API_KEY y credenciales de los .env locales, sin imprimir valores."""
    aqui = os.path.dirname(os.path.abspath(__file__))
    candidatos = [
        os.path.join(aqui, "..", "functions_python", ".env"),
        os.path.join(aqui, "..", ".env.local"),
    ]
    for ruta in candidatos:
        if not os.path.isfile(ruta):
            continue
        with open(ruta, "r", encoding="utf-8-sig") as handle:
            for linea in handle:
                linea = linea.strip()
                if not linea or linea.startswith("#") or "=" not in linea:
                    continue
                clave, valor = linea.split("=", 1)
                clave = clave.strip()
                valor = valor.strip().strip('"').strip("'")
                if clave in {"EODHD_API_KEY", "MASTER_PROJECT_ID"} and not os.environ.get(clave):
                    os.environ[clave] = valor
                if clave == "FIREBASE_SERVICE_ACCOUNT_PATH" and not os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
                    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = valor
                if clave == "FIREBASE_PROJECT_ID" and not os.environ.get("MASTER_PROJECT_ID"):
                    os.environ["MASTER_PROJECT_ID"] = valor


_carga_env()

API = "https://eodhd.com/api"
CACHE_PATH = os.environ.get("FX_VERIFY_CACHE", "tmp/_verify_currency_cache.json")

# El documento se llama EODHD_{symbol}_{lo que sea}; el símbolo lleva su bolsa.
RE_DOC = re.compile(r"^EODHD_(.+?)_(REFRESH|YEAR|[A-Z0-9]+)_?(\d{4})?$")

ESTADOS = (
    "OK",                     # lo guardado coincide con el precio del proveedor convertido
    "ERROR_CONVIERTE_EUR",    # convertido sobre un precio que ya estaba en euros
    "ERROR_SIN_CONVERTIR",    # guardado en la divisa del listado, sin convertir
    "ERROR_ESCALA",           # peniques tratados como libras (o al revés): factor 100
    "ERROR_DISCREPANCIA",     # no cuadra y no encaja en ninguno de los patrones anteriores
    "REVISAR_BASE_PRECIO",    # cuadra con el cierre SIN ajustar, no con el ajustado
    "NO_VERIFICADO",          # no se ha podido contrastar; la CAUSA se registra aparte
)

# Causas de «no verificado». Se cuentan separadas porque mezclarlas fue lo que hizo
# pasar por «el proveedor no publica precios» un fallo de resolución de divisa nuestro.
CAUSAS_NO_VERIFICADO = (
    "SIN_SIMBOLO",       # el documento no dice de qué listado viene
    "SIN_DIVISA",        # el proveedor no publica divisa para ese listado
    "DIVISA_NO_VALIDA",  # la publica, pero no es una divisa («NA»)
    "SIN_FX",            # hay divisa, pero no hay EUR/divisa para esa fecha
    "SIN_COTIZACION",    # hay divisa y FX, pero el proveedor no da cotización esa fecha
    "VALOR_INVALIDO",
    "SIN_PUNTOS",        # el documento guardado no tiene puntos
    "SIN_METADATOS",     # convierte, pero el punto no guarda source_value/fx_rate
)


_TOKEN_CACHE = {}


def _token():
    """La clave, del entorno o de Secret Manager. Nunca se imprime ni se guarda."""
    if _TOKEN_CACHE.get("valor"):
        return _TOKEN_CACHE["valor"]
    token = os.environ.get("EODHD_API_KEY")
    if not token:
        # En esta casa la clave vive en Secret Manager, no en los .env (ver runbook).
        proyecto = exigir_proyecto_permitido(os.environ.get("SECRET_PROJECT_ID") or master_project_id(), "SECRET_PROJECT_ID")
        try:
            import subprocess
            token = subprocess.run(
                ["gcloud", "secrets", "versions", "access", "latest",
                 "--secret=EODHD_API_KEY", "--project=%s" % proyecto],
                capture_output=True, text=True, timeout=60, shell=(os.name == "nt"),
            ).stdout.strip()
        except Exception:  # noqa: BLE001
            token = ""
    if not token:
        raise RuntimeError(
            "Sin EODHD_API_KEY: expórtala en el entorno o da acceso a Secret Manager, "
            "o pasa --currencies con un mapa símbolo→divisa ya verificado."
        )
    _TOKEN_CACHE["valor"] = token
    return token


def _get_json(path, params):
    params = dict(params or {})
    params.setdefault("api_token", _token())
    params.setdefault("fmt", "json")
    url = "%s/%s?%s" % (API, path.lstrip("/"), urllib.parse.urlencode(params))
    for intento in range(3):
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception:  # noqa: BLE001 - se reintenta y si no se marca NO_VERIFICADO
            if intento == 2:
                return None
            time.sleep(1.5 * (intento + 1))
    return None


# Versión del formato de caché. Las entradas escritas por la resolución ANTIGUA
# guardaban «NA» y null como si fueran respuestas buenas; al subir la versión se
# descartan y se vuelven a resolver con la regla compartida.
CACHE_VERSION = 2


class DivisaDeListado:
    """Divisa que el proveedor declara para cada símbolo, cacheada en disco.

    Usa `fx_currency.resolve_listing_currency`: los mismos fundamentales y la misma
    búsqueda exacta por símbolo y bolsa que el productor. Guarda también POR QUÉ no se
    resolvió, para no volver a confundir «sin divisa» con «sin cotización».
    """

    def __init__(self, path=CACHE_PATH, get_json=None):
        self.path = path
        self.get_json = get_json or _get_json
        self.data = {}
        self.revalidadas = 0
        if path and os.path.exists(path):
            self._carga(path)

    def _carga(self, path):
        try:
            with open(path, "r", encoding="utf-8") as handle:
                bruto = json.load(handle)
        except (OSError, ValueError):
            return
        if isinstance(bruto, dict) and bruto.get("version") == CACHE_VERSION:
            entradas = bruto.get("divisas") or {}
            for symbol, entrada in entradas.items():
                if isinstance(entrada, dict) and fx_currency.es_divisa_valida(entrada.get("divisa")):
                    self.data[symbol] = dict(entrada)
                else:
                    # No se conserva un «no resuelto»: se vuelve a intentar con la
                    # regla vigente, que es la única forma de que la corrección llegue
                    # a los símbolos que ya fallaron una vez.
                    self.revalidadas += 1
            return
        # Formato antiguo (símbolo → divisa, con «NA» y null aceptados como respuesta).
        entradas = bruto if isinstance(bruto, dict) else {}
        for symbol, divisa in entradas.items():
            if isinstance(divisa, str) and fx_currency.es_divisa_valida(divisa):
                self.data[symbol] = {"divisa": divisa.strip().upper(), "motivo": None}
            else:
                self.revalidadas += 1

    def precarga(self, ruta):
        """Mapa símbolo→divisa ya verificado, para no depender de la clave."""
        if not ruta:
            return
        with open(ruta, "r", encoding="utf-8") as handle:
            for symbol, divisa in (json.load(handle) or {}).items():
                codigo = (divisa or "").strip().upper()
                if fx_currency.es_divisa_valida(codigo):
                    self.data[symbol] = {"divisa": codigo, "motivo": None}
                else:
                    # Un mapa precargado con «NA» no exime de resolver: se ignora.
                    self.data.pop(symbol, None)

    def resuelve(self, symbol):
        """(divisa, causa). `causa` es None cuando hay divisa."""
        if not symbol:
            return None, "SIN_SIMBOLO"
        entrada = self.data.get(symbol)
        if entrada and fx_currency.es_divisa_valida(entrada.get("divisa")):
            return entrada["divisa"], None
        divisa, motivo = fx_currency.resolve_listing_currency(symbol, self.get_json)
        causa = None if divisa else (motivo or "SIN_DIVISA")
        self.data[symbol] = {"divisa": divisa, "motivo": causa}
        return divisa, causa

    def get(self, symbol):
        """Solo la divisa, para el código que no necesita la causa."""
        return self.resuelve(symbol)[0]

    def save(self):
        if not self.path:
            return
        os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
        with open(self.path, "w", encoding="utf-8") as handle:
            json.dump(
                {"version": CACHE_VERSION, "divisas": self.data},
                handle, indent=2, sort_keys=True, ensure_ascii=False,
            )


# Subunidades: el listado cotiza en centesimas de la divisa mayor. Mismo mapa que el
# productor (fx_currency.SUBUNIDADES), para que la escala no divirja.
_SUBUNIDADES = fx_currency.SUBUNIDADES
_FX_CACHE = {}
_FX_CACHE_FROM = {}


def divisa_mayor(codigo):
    return fx_currency.divisa_mayor(codigo)


def fx_del_dia(mayor, dia):
    """EUR→divisa del día (o el anterior disponible), del proveedor."""
    if mayor == "EUR":
        return 1.0
    desde = min("1999-01-01", str(dia))
    if mayor not in _FX_CACHE or desde < _FX_CACHE_FROM.get(mayor, "9999-12-31"):
        filas = _get_json("eod/EUR%s.FOREX" % mayor, {"from": desde, "period": "d", "order": "a"})
        serie = {}
        if isinstance(filas, list):
            for fila in filas:
                if isinstance(fila, dict) and fila.get("date"):
                    valor = fila.get("adjusted_close", fila.get("close"))
                    try:
                        valor = float(valor)
                    except (TypeError, ValueError):
                        continue
                    if valor > 0:
                        serie[str(fila["date"])] = valor
        _FX_CACHE[mayor] = (sorted(serie), serie)
        _FX_CACHE_FROM[mayor] = desde
    fechas, serie = _FX_CACHE[mayor]
    if not fechas:
        return None
    import bisect
    indice = bisect.bisect_right(fechas, str(dia)) - 1
    if indice < 0:
        return None
    return serie[fechas[indice]]


def valor_esperado(precio_proveedor, divisa_listado, dia):
    """Lo que deberia valer ese punto en euros, segun el proveedor y su divisa."""
    mayor, escala = divisa_mayor(divisa_listado)
    tasa = fx_del_dia(mayor, dia)
    if tasa is None or not tasa:
        return None
    return float(precio_proveedor) * escala / tasa


def simbolo_de(doc_id, doc):
    """El símbolo del listado: del identificador de origen o del nombre del documento."""
    origen = str(doc.get("source_listing_id") or doc.get("source_price_id") or "")
    if "EODHD:" in origen:
        return origen.split("EODHD:", 1)[1].strip() or None
    match = RE_DOC.match(doc_id)
    if match:
        return match.group(1)
    return None


def punto_convertido(punto):
    """¿El punto lleva rastro de conversión?"""
    if not isinstance(punto, dict):
        return False
    if punto.get("fx") or punto.get("fx_rate") or punto.get("fx_pair"):
        return True
    origen = str(punto.get("native_currency") or punto.get("source_currency") or "").upper()
    return bool(origen) and origen != "EUR"


def documento_convierte(doc, puntos):
    """¿El documento declara conversión, en su cabecera o en sus puntos?

    La primera versión de este verificador solo miraba los puntos y marcó 9.993
    documentos como «sin convertir»: la mayoría declaran la conversión en la cabecera
    (`source_currency`, `fx_pair`, `fx_policy`) y no la repiten punto a punto.
    """
    cabecera = str(doc.get("source_currency") or "").upper()
    if cabecera and cabecera != "EUR":
        return True
    if doc.get("fx_pair") or doc.get("fx_policy") or doc.get("minor_scale"):
        return True
    return any(punto_convertido(p) for p in puntos)


def fx_coherente(punto, tolerancia=0.005):
    """value ≈ source_value / fx_rate (o × escala para peniques)."""
    if not isinstance(punto, dict):
        return None
    valor = punto.get("value", punto.get("close"))
    origen = punto.get("source_value")
    tasa = punto.get("fx_rate")
    if tasa is None and isinstance(punto.get("fx"), dict):
        tasa = (punto["fx"] or {}).get("eur_usd")
    if valor is None or origen is None or not tasa:
        return None
    try:
        esperado = float(origen) / float(tasa)
        if not esperado:
            return None
        return abs(float(valor) - esperado) / abs(esperado) <= tolerancia
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def veredicto_por_precio(symbol, doc, divisa_listado, puntos_muestra=3):
    """Compara lo guardado con lo que deberia valer. Es el criterio definitivo.

    Devuelve (estado, motivo, factor, causa). El factor es guardado / esperado:
    1 correcto · ~100 o ~0,01 error de escala (peniques) · ~tipo de cambio sin convertir
    o convertido de mas · cualquier otra cosa, discrepancia sin explicacion. `causa` solo
    viene con NO_VERIFICADO, y dice si falto la COTIZACION o falto el FX: presentar las
    dos como «sin precios del proveedor» ocultaba fallos propios.
    """
    filas = contrasta_precios(symbol, doc, puntos_muestra)
    if not filas:
        return ("NO_VERIFICADO",
                "sin cotizacion del proveedor para las fechas comprobadas", None, "SIN_COTIZACION")
    factores = []
    faltantes = []
    for fila in filas:
        try:
            guardado = float(fila["guardado"])
            proveedor = float(fila["proveedor"])
        except (TypeError, ValueError):
            faltantes.append("SIN_COTIZACION" if fila.get("proveedor") is None else "VALOR_INVALIDO")
            continue
        if not all(math.isfinite(x) and x > 0 for x in (guardado, proveedor)):
            faltantes.append("VALOR_INVALIDO")
            continue
        esperado = valor_esperado(proveedor, divisa_listado, fila["date"])
        if not esperado or not math.isfinite(esperado):
            faltantes.append("SIN_FX")
            continue
        factores.append((guardado / esperado, fila["date"], guardado, esperado))
    if not factores:
        if faltantes and faltantes[0] != "SIN_FX":
            return "NO_VERIFICADO", "sin cotizacion o valor valido en las fechas pedidas", None, faltantes[0]
        mayor, _escala = divisa_mayor(divisa_listado)
        return ("NO_VERIFICADO",
                "sin EUR%s.FOREX para las fechas comprobadas" % mayor, None, "SIN_FX")
    # Segunda revisión de Astra: el veredicto salía de la MEDIANA, así que un documento
    # con dos puntos correctos y uno con factor 100 se daba por bueno. Basta con que UN
    # punto comprobado se salga de la tolerancia para que el documento no sea correcto.
    # A price verdict permits serialization rounding, not a 2% economic error.
    fuera = [f for f in factores if abs(f[2] - f[3]) > max(0.00011, abs(f[3]) * 0.00001)]
    if not fuera:
        if faltantes:
            return "NO_VERIFICADO", "%d de %d puntos sin contraste" % (len(faltantes), len(filas)), None, faltantes[0]
        total = len(doc.get("points") or [])
        alcance = ("historico completo" if len(factores) == total else "solo muestra; historico no verificado")
        return "OK", "%d/%d puntos: %s" % (len(factores), total, alcance), factores[len(factores) // 2][0], None
    # Antes de llamarlo discrepancia: ¿cuadra con el cierre SIN ajustar? El proveedor da
    # `close` y `adjusted_close`; una serie guardada sobre el cierre no tiene un error de
    # divisa —tiene otra base de precio, que es un problema distinto y se dice aparte—.
    factores_cierre = []
    for fila in filas:
        try:
            guardado = float(fila["guardado"])
            cierre = float(fila.get("proveedor_cierre"))
        except (TypeError, ValueError):
            continue
        esperado = valor_esperado(cierre, divisa_listado, fila["date"])
        if esperado:
            factores_cierre.append(abs(guardado - esperado) <= max(0.00011, abs(esperado) * 0.00001))
    if len(factores_cierre) == len(filas) and all(factores_cierre) and not faltantes:
        return ("REVISAR_BASE_PRECIO",
                "cuadra con el cierre sin ajustar del proveedor, no con el ajustado: "
                "revisar la base de precio de la serie (no es un error de divisa)",
                factores[len(factores) // 2][0], None)
    fuera.sort()
    factor, dia, guardado, esperado = fuera[len(fuera) // 2]
    detalle = "%s: guardado %.6f, esperado %.6f (factor %.4f)" % (dia, guardado, esperado, factor)
    if len(fuera) < len(factores):
        detalle = "%d de %d puntos comprobados fallan · %s" % (len(fuera), len(factores), detalle)
    if abs(factor - 100.0) <= 2.0 or abs(factor - 0.01) <= 0.0002:
        return "ERROR_ESCALA", "subunidad mal aplicada — " + detalle, factor, None
    mayor, _escala = divisa_mayor(divisa_listado)
    tasa = fx_del_dia(mayor, dia) or 0
    if mayor != "EUR" and tasa and abs(factor - tasa) <= 0.02 * max(tasa, 1):
        return "ERROR_SIN_CONVERTIR", "guardado en la divisa del listado — " + detalle, factor, None
    if mayor != "EUR" and tasa and abs(factor - (1.0 / tasa)) <= 0.02 * max(1.0 / tasa, 1):
        return "ERROR_CONVIERTE_EUR", "convertido sobre un precio que ya estaba en euros — " + detalle, factor, None
    return "ERROR_DISCREPANCIA", "no cuadra con el proveedor — " + detalle, factor, None


def ratio_contra_proveedor(symbol, doc, puntos_muestra=3):
    """Cociente mediano entre lo guardado y el cierre del proveedor, en la misma fecha.

    ≈1 significa «guardado en la divisa del listado» (sin convertir); ≈ el tipo de
    cambio, «convertido». Es el árbitro cuando los metadatos no bastan.
    """
    filas = contrasta_precios(symbol, doc, puntos_muestra)
    ratios = []
    for fila in filas:
        try:
            guardado = float(fila["guardado"])
            proveedor = float(fila["proveedor"])
            if proveedor:
                ratios.append(guardado / proveedor)
        except (TypeError, ValueError, ZeroDivisionError):
            continue
    if not ratios:
        return None
    ratios.sort()
    return ratios[len(ratios) // 2]


def clasifica(doc_id, doc, divisa_listado):
    puntos = doc.get("points") or []
    if not puntos:
        return "NO_VERIFICADO", "documento sin puntos"
    if not divisa_listado:
        return "NO_VERIFICADO", "sin divisa del proveedor para el listado"
    muestra = [p for p in puntos[-5:] if isinstance(p, dict)]
    convierte = documento_convierte(doc, muestra)
    if divisa_listado == "EUR":
        if convierte:
            return "ERROR_CONVIERTE_EUR", "el listado ya cotiza en EUR y el documento aplica FX"
        return "OK_SIN_CONVERSION", ""
    if not convierte:
        return "ERROR_SIN_CONVERTIR", "el listado cotiza en %s y el documento no convierte" % divisa_listado
    coherentes = [fx_coherente(p) for p in muestra]
    if any(resultado is False for resultado in coherentes):
        return "ERROR_FX_INCOHERENTE", "value no cuadra con source_value / fx_rate"
    if all(resultado is None for resultado in coherentes):
        return "NO_VERIFICADO", "convierte, pero el punto no guarda source_value/fx_rate"
    return "OK_CONVERTIDO", ""


def contrasta_precios(symbol, doc, cuantos):
    """Compara N puntos del documento con el cierre del proveedor, en su divisa."""
    puntos = sorted(
        (p for p in (doc.get("points") or []) if isinstance(p, dict) and p.get("date")),
        key=lambda p: str(p["date"]),
    )
    if not puntos or cuantos == 0:
        return []
    if cuantos < 0 or cuantos >= len(puntos):
        elegidos = puntos
    elif cuantos == 1:
        elegidos = [puntos[-1]]
    else:
        elegidos = [puntos[round(i * (len(puntos) - 1) / (cuantos - 1))] for i in range(cuantos)]
    desde = min(str(p["date"]) for p in elegidos)
    hasta = max(str(p["date"]) for p in elegidos)
    filas = _get_json("eod/%s" % symbol, {"from": desde, "to": hasta, "period": "d", "order": "a"})
    if not isinstance(filas, list):
        filas = []
    por_fecha = {str(f.get("date")): f for f in filas if isinstance(f, dict)}
    salida = []
    for punto in elegidos:
        fila = por_fecha.get(str(punto["date"])) or {}
        salida.append({
            "date": str(punto["date"]),
            "guardado": punto.get("value", punto.get("close")),
            # El proveedor da dos precios por dia. Contrastar solo contra el AJUSTADO
            # marcaba como «discrepancia» a series guardadas sobre el cierre sin
            # ajustar: no es un fallo de divisa y hay que decirlo aparte.
            "proveedor": fila.get("adjusted_close", fila.get("close")),
            "proveedor_cierre": fila.get("close", fila.get("adjusted_close")),
            "source_value": punto.get("source_value"),
            "fx_rate": punto.get("fx_rate"),
        })
    return salida


def main():
    parser = argparse.ArgumentParser(description="Verifica la divisa de las series de precios (solo lectura)")
    parser.add_argument("--assets", help="lista de asset_id separados por coma")
    parser.add_argument("--assets-file",
                        help="fichero con asset_id separados por coma o por lineas "
                             "(una lista larga no cabe en la linea de comandos de Windows)")
    parser.add_argument("--declared-non-eur", action="store_true", help="solo activos cuya ficha declara divisa != EUR")
    parser.add_argument("--limit", type=int, default=0, help="máximo de activos a revisar")
    parser.add_argument("--docs-por-activo", type=int, default=0,
                        help="revisa solo N documentos por activo (el más reciente y el más antiguo); "
                             "un barrido completo del universo son decenas de miles de llamadas")
    parser.add_argument("--full-prices", action="store_true", help="contrasta todos los puntos, sin muestreo")
    parser.add_argument("--sample-prices", type=int, default=0, help="puntos por documento a contrastar con el proveedor")
    parser.add_argument("--currencies", help="JSON símbolo→divisa ya verificado (evita llamar al proveedor)")
    parser.add_argument("--out", default="tmp/_verify_currency.json")
    args = parser.parse_args()

    db = firestore.Client(project=master_project_id())
    divisas = DivisaDeListado()
    divisas.precarga(args.currencies)

    if args.assets or args.assets_file:
        crudo = args.assets or ""
        if args.assets_file:
            with open(args.assets_file, "r", encoding="utf-8-sig") as handle:
                crudo = crudo + "," + handle.read()
        ids = []
        for trozo in crudo.replace("\r", ",").replace("\n", ",").split(","):
            trozo = trozo.strip()
            if trozo and trozo not in ids:
                ids.append(trozo)
    else:
        ids = []
        for snap in db.collection("assets").select(["identity.currency", "currency", "base_currency"]).stream():
            data = snap.to_dict() or {}
            identity = data.get("identity") or {}
            declarada = data.get("currency") or identity.get("currency") or data.get("base_currency")
            if args.declared_non_eur and (not declarada or declarada == "EUR"):
                continue
            ids.append(snap.id)
    if args.limit:
        ids = ids[: args.limit]

    resultado = {
        "generated_at": date.today().isoformat(),
        "modo": "todos los puntos" if args.full_prices else "muestreo de puntos",
        "muestreo_documentos": args.docs_por_activo,
        "historico_completo_solicitado": args.full_prices and not args.docs_por_activo,
        "aviso": "OK solo cubre los puntos contrastados; una muestra no certifica el historico ni su continuidad.",
        "project": master_project_id(),
        "assets_revisados": 0,
        "docs_revisados": 0,
        "por_estado": {estado: 0 for estado in ESTADOS},
        # Las causas de «no verificado», separadas: un fallo de resolución de divisa
        # nuestro no puede volver a contarse como ausencia de datos del proveedor.
        "por_causa_no_verificado": {causa: 0 for causa in CAUSAS_NO_VERIFICADO},
        "cache_divisas_revalidadas": divisas.revalidadas,
        "hallazgos": [],
        "no_verificados": [],
    }

    for asset_id in ids:
        resultado["assets_revisados"] += 1
        documentos = list(db.collection("assets").document(asset_id).collection("price_series").stream())
        if args.docs_por_activo and len(documentos) > args.docs_por_activo:
            # MUESTREO por los extremos temporales —ordenando por fecha, no por nombre:
            # ordenar por id ponía dos documentos de 2026 en HSBC—. Es una primera criba
            # para localizar activos sospechosos, NO una verificación del histórico: STOR
            # demuestra que un activo puede tener años correctos y un refresco malo.
            def _fecha(snap):
                doc = snap.to_dict() or {}
                return str(doc.get("first_date") or doc.get("last_date") or snap.id)

            documentos.sort(key=_fecha)
            mitad = max(1, args.docs_por_activo // 2)
            documentos = documentos[:mitad] + documentos[-mitad:]
        for snap in documentos:
            doc = snap.to_dict() or {}
            resultado["docs_revisados"] += 1
            symbol = simbolo_de(snap.id, doc)
            divisa, causa_divisa = divisas.resuelve(symbol) if symbol else (None, "SIN_SIMBOLO")
            if not divisa:
                textos = {
                    "SIN_SIMBOLO": "el documento no dice de qué listado viene",
                    "SIN_DIVISA": "el proveedor no publica divisa para el listado",
                    "DIVISA_NO_VALIDA": "el proveedor publica una divisa no válida para el listado",
                }
                estado, motivo, factor, causa = (
                    "NO_VERIFICADO",
                    textos.get(causa_divisa, "sin divisa del proveedor para el listado"),
                    None,
                    causa_divisa,
                )
            elif not (doc.get("points") or []):
                estado, motivo, factor, causa = "NO_VERIFICADO", "documento sin puntos", None, "SIN_PUNTOS"
            else:
                # El veredicto lo da el PRECIO, no los metadatos: así se detectan también
                # los errores de escala, que un documento con metadatos coherentes esconde.
                estado, motivo, factor, causa = veredicto_por_precio(
                    symbol, doc, divisa, -1 if args.full_prices else (args.sample_prices or 3))
                contexto, _detalle = clasifica(snap.id, doc, divisa)
                if estado == "OK" and contexto.startswith("ERROR"):
                    motivo = "precio correcto, pero los metadatos dicen %s" % contexto
                if estado == "NO_VERIFICADO" and not causa and contexto == "NO_VERIFICADO":
                    causa = "SIN_METADATOS"
            resultado["por_estado"][estado] += 1
            if estado == "NO_VERIFICADO" and causa in resultado["por_causa_no_verificado"]:
                resultado["por_causa_no_verificado"][causa] += 1
            if estado.startswith("ERROR") or estado == "REVISAR_BASE_PRECIO":
                fila = {
                    "asset_id": asset_id,
                    "doc": snap.id,
                    "symbol": symbol,
                    "divisa_listado": divisa,
                    "doc_currency": doc.get("currency"),
                    "source_currency": doc.get("source_currency"),
                    "puntos": len(doc.get("points") or []),
                    "estado": estado,
                    "motivo": motivo,
                    "factor": factor,
                }
                if args.sample_prices and symbol:
                    fila["muestra"] = contrasta_precios(symbol, doc, args.sample_prices)
                resultado["hallazgos"].append(fila)
            elif estado == "NO_VERIFICADO":
                resultado["no_verificados"].append({
                    "asset_id": asset_id, "doc": snap.id, "symbol": symbol,
                    "causa": causa, "motivo": motivo,
                })
        divisas.save()

    activos_con_error = sorted({fila["asset_id"] for fila in resultado["hallazgos"]})
    resultado["activos_con_error"] = activos_con_error
    resultado["activos_con_error_total"] = len(activos_con_error)

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(resultado, handle, indent=2, ensure_ascii=False)

    resultado["cache_divisas_revalidadas"] = divisas.revalidadas

    print(json.dumps({
        "assets_revisados": resultado["assets_revisados"],
        "docs_revisados": resultado["docs_revisados"],
        "por_estado": resultado["por_estado"],
        "por_causa_no_verificado": resultado["por_causa_no_verificado"],
        "cache_divisas_revalidadas": resultado["cache_divisas_revalidadas"],
        "activos_con_error": resultado["activos_con_error_total"],
        "salida": args.out,
    }, indent=2, ensure_ascii=False))
    return 1 if resultado["hallazgos"] else 0


if __name__ == "__main__":
    sys.exit(main())
