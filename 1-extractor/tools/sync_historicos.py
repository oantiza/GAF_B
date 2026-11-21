"""Sincroniza los históricos de VL desde Firestore (BDB-FONDOS) a un cache local.

EJECUTAR TÚ, CON TUS CREDENCIALES. Solo lee de Firestore: no escribe nada allí.

El proyecto es el de la clave que se le pase, y ninguna orden lo nombra. Por eso se niega con
una clave de BDB, que está en uso y desde este proyecto no se toca (decisión 106, 05-11-2026).

El informe PDF de FondosDB dibuja el gráfico de 5 años leyendo de ese cache
local, así que la generación del PDF sigue siendo 100% offline y sin dependencias.

Requisitos (una vez):
    pip install firebase-admin

Primero INSPECCIONA para confirmar el esquema (no escribe nada):
    python tools/sync_historicos.py --credenciales C:\\ruta\\serviceAccount.json --inspeccionar

Luego SINCRONIZA (vuelca a data/history_vl/<ISIN>.jsonl):
    python tools/sync_historicos.py --credenciales ...
    python tools/sync_historicos.py --credenciales ... --solo ES0114673033 IE00B18GC888
    python tools/sync_historicos.py --credenciales ... --todos        (todo el universo de la colección)
    python tools/sync_historicos.py --credenciales ... --coleccion historico_vl_v2

Salida: data/history_vl/<ISIN>.jsonl  ->  una línea {"fecha":"YYYY-MM-DD","vl":123.45}
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
DESTINO = BASE / "data" / "history_vl"
RE_ISIN = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")
PROYECTO_DE_BDB = "bbdd-activos-financieros"

# nombres de campo candidatos (autodetección de esquema)
CAMPOS_FECHA = ("fecha", "date", "dia", "day", "d", "t", "timestamp", "ts", "x", "time")
CAMPOS_VL = ("vl", "nav", "valor", "value", "v", "y", "precio", "price", "close",
             "navPrice", "valorLiquidativo", "vlIsin")
CAMPOS_ARRAY = ("puntos", "serie", "series", "historico", "historial", "datos",
                "data", "navs", "valores", "vls", "prices", "points", "history")
CAMPOS_ISIN = ("isin", "ISIN", "isinClase", "isin_clase", "code", "codigo")
SUBCOLS = CAMPOS_ARRAY + ("vl", "navs", "valores")


def _norm_fecha(v) -> str | None:
    """Normaliza una fecha (str ISO, datetime, epoch ms/s) a 'YYYY-MM-DD'."""
    if v is None:
        return None
    # datetime de Firestore
    if hasattr(v, "isoformat"):
        try:
            return v.isoformat()[:10]
        except Exception:
            pass
    if isinstance(v, (int, float)):
        import datetime as dt
        seg = v / 1000.0 if v > 1e11 else float(v)
        try:
            return dt.datetime.fromtimestamp(seg, tz=dt.timezone.utc).date().isoformat()
        except (OverflowError, OSError, ValueError):
            return None
    s = str(v).strip()
    m = re.search(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})", s)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    m = re.search(r"(\d{1,2})[-/](\d{1,2})[-/](\d{4})", s)  # dd/mm/yyyy
    if m:
        return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    return None


def _num(v):
    try:
        f = float(str(v).replace(",", "."))
        return f if f == f else None
    except (TypeError, ValueError):
        return None


def _punto_de_dict(o: dict):
    """Extrae (fecha, vl) de un dict de punto, probando nombres de campo."""
    fecha = next((_norm_fecha(o[k]) for k in CAMPOS_FECHA if k in o and o[k] is not None), None)
    vl = next((_num(o[k]) for k in CAMPOS_VL if k in o and _num(o[k]) is not None), None)
    if fecha and vl is not None and vl > 0:
        return (fecha, vl)
    return None


def _puntos_de_valor(valor):
    """Dado un campo (lista de dicts, lista de pares, o map fecha->vl) -> [(fecha,vl)]."""
    out = []
    if isinstance(valor, dict):
        for k, v in valor.items():
            f = _norm_fecha(k)
            n = _num(v if not isinstance(v, dict) else
                     next((v.get(c) for c in CAMPOS_VL if c in v), None))
            if f and n is not None and n > 0:
                out.append((f, n))
    elif isinstance(valor, list):
        for el in valor:
            if isinstance(el, dict):
                p = _punto_de_dict(el)
                if p:
                    out.append(p)
            elif isinstance(el, (list, tuple)) and len(el) >= 2:
                f, n = _norm_fecha(el[0]), _num(el[1])
                if f and n is not None and n > 0:
                    out.append((f, n))
    return out


def _extrae_de_doc(doc) -> list:
    """Saca todos los puntos posibles de un documento (campos array/map)."""
    data = doc.to_dict() or {}
    puntos = []
    for k in CAMPOS_ARRAY:
        if k in data:
            puntos += _puntos_de_valor(data[k])
    if not puntos:
        # quizá el propio doc es un map fecha->vl, o tiene un único map grande
        for k, v in data.items():
            if isinstance(v, (dict, list)):
                puntos += _puntos_de_valor(v)
    return puntos


def _puntos_de_subcoleccion(doc_ref) -> list:
    """Recorre subcolecciones candidatas con un doc por fecha."""
    puntos = []
    try:
        subs = list(doc_ref.collections())
    except Exception:
        return puntos
    for sub in subs:
        if sub.id not in SUBCOLS and len(subs) > 1:
            continue
        for dd in sub.stream():
            o = dd.to_dict() or {}
            p = _punto_de_dict(o)
            if not p:  # quizá la fecha es el id del doc
                f, n = _norm_fecha(dd.id), next(
                    (_num(o[c]) for c in CAMPOS_VL if c in o), None)
                if f and n is not None:
                    p = (f, n)
            if p:
                puntos.append(p)
    return puntos


def _isins_objetivo(args) -> list:
    if args.solo:
        return [i.upper() for i in args.solo]
    funds = BASE / "data" / "funds"
    if funds.exists():
        return sorted(p.stem.upper() for p in funds.glob("*.json"))
    return []


def _conecta(cred_path: str):
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError:
        print("Falta firebase-admin:  pip install firebase-admin")
        sys.exit(1)
    cred = credentials.Certificate(cred_path)
    if cred.project_id == PROYECTO_DE_BDB:
        # RuntimeError y no SystemExit: app.py lee SystemExit como «falta firebase-admin».
        raise RuntimeError("Esa clave es del proyecto de BDB: está en uso, y desde aquí no se lee.")
    try:
        firebase_admin.initialize_app(cred)
    except ValueError:
        pass
    return firestore.client()


def inspecciona(db, coleccion: str, isins: list):
    print(f"== INSPECCIÓN de '{coleccion}' (no se escribe nada)\n")
    col = db.collection(coleccion)
    # intenta por id = ISIN primero
    muestra_ids = isins[:3] or []
    docs = []
    for i in muestra_ids:
        d = col.document(i).get()
        if d.exists:
            docs.append(d)
    if not docs:
        print("No encuentro documentos con id = ISIN; muestreo los primeros de la colección:")
        docs = list(col.limit(3).stream())
    for d in docs:
        data = d.to_dict() or {}
        print(f"--- documento id = {d.id}")
        for k, v in list(data.items())[:25]:
            t = type(v).__name__
            if isinstance(v, list):
                ej = v[0] if v else None
                print(f"    {k}: list[{len(v)}]  ej={json.dumps(ej, default=str)[:120]}")
            elif isinstance(v, dict):
                pares = list(v.items())[:2]
                print(f"    {k}: map[{len(v)}]  ej={json.dumps(dict(pares), default=str)[:120]}")
            else:
                print(f"    {k}: {t} = {json.dumps(v, default=str)[:80]}")
        try:
            subs = list(d.reference.collections())
            if subs:
                print(f"    subcolecciones: {[s.id for s in subs]}")
                for s in subs[:1]:
                    ej = list(s.limit(1).stream())
                    if ej:
                        print(f"      {s.id}[0] id={ej[0].id} "
                              f"{json.dumps(ej[0].to_dict(), default=str)[:160]}")
        except Exception as e:
            print(f"    (no pude leer subcolecciones: {e})")
        # qué puntos extraería el autodetector
        p = _extrae_de_doc(d) or _puntos_de_subcoleccion(d.reference)
        print(f"    >> autodetector extraería {len(p)} puntos"
              + (f" (ej {p[0]} ... {p[-1]})" if p else "") + "\n")
    print("Si los puntos detectados son 0, dime los nombres de campo reales y los añado.")


def sincroniza(db, coleccion: str, isins: list, anios: int) -> None:
    import datetime as dt
    DESTINO.mkdir(parents=True, exist_ok=True)
    corte = (dt.date.today() - dt.timedelta(days=365 * anios + 7)).isoformat()
    col = db.collection(coleccion)
    ok = vacios = 0
    for n, isin in enumerate(isins, 1):
        ref = col.document(isin)
        doc = ref.get()
        puntos = _extrae_de_doc(doc) if doc.exists else []
        if not puntos and doc.exists:
            puntos = _puntos_de_subcoleccion(ref)
        if not puntos:
            # último intento: layout plano (campo isin)
            for campo in CAMPOS_ISIN:
                try:
                    q = col.where(campo, "==", isin).stream()
                    for dd in q:
                        p = _punto_de_dict(dd.to_dict() or {})
                        if p:
                            puntos.append(p)
                    if puntos:
                        break
                except Exception:
                    continue
        # dedup por fecha + recorte
        m = {}
        for f, v in puntos:
            if f >= corte:
                m[f] = v
        serie = sorted(m.items())
        if not serie:
            vacios += 1
            print(f"[{n}/{len(isins)}] {isin}  sin históricos")
            continue
        ruta = DESTINO / f"{isin}.jsonl"
        with ruta.open("w", encoding="utf-8") as fh:
            for f, v in serie:
                fh.write(json.dumps({"fecha": f, "vl": round(v, 6)}, ensure_ascii=False) + "\n")
        ok += 1
        print(f"[{n}/{len(isins)}] {isin}  {len(serie)} puntos  "
              f"({serie[0][0]} → {serie[-1][0]})")
    print(f"\nHecho: {ok} fondos con histórico, {vacios} sin datos. "
          f"Cache en {DESTINO}")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--credenciales", required=True)
    p.add_argument("--coleccion", default="historico_vl_v2")
    p.add_argument("--solo", nargs="*", help="limitar a estos ISINs")
    p.add_argument("--todos", action="store_true",
                   help="recorre toda la colección en vez de solo el universo local")
    p.add_argument("--anios", type=int, default=5)
    p.add_argument("--inspeccionar", action="store_true",
                   help="muestra el esquema de la colección y termina")
    args = p.parse_args()

    db = _conecta(args.credenciales)
    isins = _isins_objetivo(args)

    if args.inspeccionar:
        inspecciona(db, args.coleccion, isins)
        return 0

    if args.todos and not args.solo:
        print(f"Recorriendo toda la colección '{args.coleccion}'...")
        isins = sorted({d.id.upper() for d in db.collection(args.coleccion).stream()
                        if RE_ISIN.match(d.id.upper())})
    if not isins:
        print("No hay ISINs objetivo. Usa --solo, --todos, o ten fondos en data/funds.")
        return 1
    print(f"Sincronizando {len(isins)} fondos desde '{args.coleccion}'...")
    sincroniza(db, args.coleccion, isins, args.anios)
    return 0


if __name__ == "__main__":
    sys.exit(main())
