#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Cuanto aguanta la simulacion de 3 y 5 anos (`backtest_portfolio` con `analysis_bundle`) segun las posiciones.

Mide el codigo real —`analyze_horizon` con `lector_de_optimizacion()` y `resolver_tipo_libre()`, los de
produccion— contra el EMULADOR de la base nueva (127.0.0.1:8092, `bdb-gestor-de-activos`). Solo lee: cualquier
escritura de Firestore lanza una excepcion antes de salir del proceso, y el emulador se exige en codigo.

    python functions_python/scripts/medir_tope_simulacion.py [--n 40,47,80,120,200] [--ventanas 3Y,5Y] [--json salida.json]

Cartera de cada caso: las N primeras acciones (`instrument_type == STOCK`) por ISIN que tienen serie anual de 2020 o
antes y de este anio, a pesos iguales. No usa carteras de clientes. Cada caso corre en un proceso propio, para que
la cache de series empiece fria y el pico de memoria sea el suyo: primero en frio (cache vacia) y despues en
caliente (otra peticion, lector nuevo, misma cache de proceso, como en una instancia de Cloud Run ya despierta).

Por caso: segundos totales y por fase (lectura de precios y fichas, frontera si la hay, el resto es calculo),
documentos leidos de Firestore y pico del conjunto de trabajo del proceso (psutil, `peak_wset` en Windows). Con
`--solver`, despues de medir, se cronometra aparte el solver de la frontera sobre los mismos retornos aunque la
simulacion no lo use por encima de 40 activos: es la evidencia del coste que justifica no calcularla.

Limite de la medicion: este PC no es Cloud Run y el emulador no es la red. La nube lee por red con latencia por
lote, y su CPU es otra; las cifras sirven para ordenar los casos y ver como crecen, no son las de produccion.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

EMULADOR = "127.0.0.1:8092"
PROYECTO = "bdb-gestor-de-activos"
ROOT = Path(__file__).resolve().parents[1]


def _entorno_de_emulador():
    os.environ["FIRESTORE_EMULATOR_HOST"] = EMULADOR
    os.environ["MASTER_PROJECT_ID"] = PROYECTO
    os.environ.pop("GOOGLE_APPLICATION_CREDENTIALS", None)
    sys.path.insert(0, str(ROOT))
    if os.environ.get("FIRESTORE_EMULATOR_HOST") != EMULADOR:
        raise SystemExit("Sin emulador no se mide.")


class Contador:
    lecturas = 0


def _instalar_contador_y_cerrojo():
    """Cuenta documentos leidos y prohibe cualquier escritura."""
    from google.cloud.firestore_v1 import batch, client, collection, document, query

    def contar(gen):
        for item in gen:
            Contador.lecturas += 1
            yield item

    original_get_all = client.Client.get_all
    original_stream = query.Query.stream
    original_get = document.DocumentReference.get
    client.Client.get_all = lambda self, *a, **k: contar(original_get_all(self, *a, **k))
    query.Query.stream = lambda self, *a, **k: contar(original_stream(self, *a, **k))

    def get(self, *a, **k):
        Contador.lecturas += 1
        return original_get(self, *a, **k)
    document.DocumentReference.get = get

    def prohibido(*_a, **_k):
        raise RuntimeError("La medicion no escribe: se ha intentado una escritura en Firestore.")
    for nombre in ("set", "update", "delete", "create"):
        setattr(document.DocumentReference, nombre, prohibido)
    collection.CollectionReference.add = prohibido
    batch.WriteBatch.commit = prohibido


def seleccion(n_max: int) -> list:
    """Las n_max primeras acciones por ISIN con serie de 2020 o antes y de este anio. Solo lee."""
    from google.cloud import firestore
    from master_project import master_project_id
    if master_project_id() != PROYECTO:
        raise SystemExit("La medicion es de la base nueva.")
    db = firestore.Client(project=master_project_id())
    anio = str(time.localtime().tm_year)
    ids = sorted(s.id for s in db.collection("instruments").where("instrument_type", "==", "STOCK").stream())
    elegidas = []
    for instrument_id in ids:
        anios = sorted(r.id for r in db.collection("instruments").document(instrument_id).collection("price_series").list_documents())
        if anios and anios[0] <= "2020" and anio in anios:
            elegidas.append(instrument_id)
            if len(elegidas) >= n_max:
                break
    return elegidas


def _caso(ids: list, ventana: str, con_solver: bool) -> dict:
    import psutil
    import portfolio_horizon as ph
    from optimization import robust_engine
    from readmodel.lector_base_nueva import lector_de_optimizacion, resolver_tipo_libre

    proceso = psutil.Process()
    tiempos = {}
    capturado = {}
    original_lectura = ph._load_horizon_prices
    original_solve = robust_engine.solve
    original_backtest = ph._backtest

    def lectura(*a, **k):
        t = time.perf_counter()
        try:
            return original_lectura(*a, **k)
        finally:
            tiempos["lectura"] = tiempos.get("lectura", 0.0) + time.perf_counter() - t

    def solve(*a, **k):
        t = time.perf_counter()
        try:
            return original_solve(*a, **k)
        finally:
            tiempos["frontera"] = tiempos.get("frontera", 0.0) + time.perf_counter() - t

    def backtest(ids_, weights, matrix, *a, **k):
        salida = original_backtest(ids_, weights, matrix, *a, **k)
        capturado.setdefault("retornos", (list(ids_), dict(weights), salida[1]))
        return salida

    ph._load_horizon_prices = lectura
    robust_engine.solve = solve
    ph._backtest = backtest
    payload = {"analysis_bundle": True, "window": ventana,
               "positions": [{"asset_id": a, "weight": 1 / len(ids)} for a in ids]}
    # Como en el arranque de la funcion desplegada (optimization/runtime.py: prepare_solver_at_startup): las
    # bibliotecas del solver se importan antes de la primera peticion. Asi «frio» es la cache de series vacia, no
    # el arranque del proceso, y el incremento de memoria es el de la peticion.
    import importlib
    for modulo in ("numpy", "pandas", "pypfopt", "sklearn.covariance", "optimization.stress_analytics"):
        importlib.import_module(modulo)
    # La medicion tiene que poder repetir los casos que justifican el tope, que estan por encima de el (90, 120, 200).
    # Solo en este proceso de medida: el tope del codigo no cambia.
    ph.MAX_POSICIONES_SIMULACION = max(ph.MAX_POSICIONES_SIMULACION, len(ids))
    base = proceso.memory_info().rss

    def una_peticion():
        tiempos.clear()
        antes = Contador.lecturas
        t = time.perf_counter()
        respuesta = ph.analyze_horizon(lector_de_optimizacion(), payload, risk_free_resolver=resolver_tipo_libre())
        total = time.perf_counter() - t
        info = proceso.memory_info()
        return {
            "segundos": round(total, 2),
            "lectura_s": round(tiempos.get("lectura", 0.0), 2),
            "frontera_s": round(tiempos.get("frontera", 0.0), 2) if "frontera" in tiempos else None,
            "calculo_s": round(total - tiempos.get("lectura", 0.0) - tiempos.get("frontera", 0.0), 2),
            "lecturas_firestore": Contador.lecturas - antes,
            "pico_mb": round(getattr(info, "peak_wset", info.rss) / 2**20, 1),
            "pico_sobre_base_mb": round((getattr(info, "peak_wset", info.rss) - base) / 2**20, 1),
            "retenido_mb": round((info.rss - base) / 2**20, 1),
            "medidos": len(respuesta["backtest"]["asset_ids"]),
            "fuera": len(respuesta["backtest"]["excluded_assets"]),
            "con_frontera": respuesta["frontier"] is not None,
            "motivo_sin_frontera": respuesta["frontier_unavailable_reason"],
            "con_aportacion": bool((respuesta.get("frontier") or {}).get("risk_contributions") or respuesta.get("risk_contributions")),
        }

    frio = una_peticion()
    caliente = una_peticion()
    salida = {"n": len(ids), "ventana": ventana, "rss_inicial_mb": round(base / 2**20, 1), "frio": frio, "caliente": caliente}
    if con_solver and "retornos" in capturado:
        ids_, pesos, retornos = capturado["retornos"]
        t = time.perf_counter()
        try:
            original_solve(ids_, retornos.tolist(), current_weights=pesos, frontier_points=ph.PUNTOS_DE_LA_FRONTERA,
                           risk_free_rate=0.0193)
            salida["solver_aparte_s"] = round(time.perf_counter() - t, 2)
        except Exception as exc:  # el solver puede abandonar: se dice
            salida["solver_aparte_s"] = round(time.perf_counter() - t, 2)
            salida["solver_aparte_error"] = type(exc).__name__
        salida["pico_tras_solver_mb"] = round(getattr(proceso.memory_info(), "peak_wset", 0) / 2**20, 1)
    return salida


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--n", default="40,47,80,120,200")
    parser.add_argument("--ventanas", default="3Y,5Y")
    parser.add_argument("--solver", action="store_true")
    parser.add_argument("--json", type=Path, default=None)
    parser.add_argument("--hijo", default=None, help=argparse.SUPPRESS)
    args = parser.parse_args()
    _entorno_de_emulador()
    _instalar_contador_y_cerrojo()

    if args.hijo:
        ids = json.loads(sys.stdin.read())
        print(json.dumps(_caso(ids, args.hijo, args.solver)))
        return 0

    tamanos = [int(x) for x in args.n.split(",")]
    ids = seleccion(max(tamanos))
    print("Seleccion: %d acciones (%s ... %s)" % (len(ids), ids[0], ids[-1]), flush=True)
    resultados = []
    for ventana in args.ventanas.split(","):
        for n in tamanos:
            orden = [sys.executable, "-W", "ignore", str(Path(__file__).resolve()), "--hijo", ventana]
            if args.solver:
                orden.append("--solver")
            hecho = subprocess.run(orden, input=json.dumps(ids[:n]), capture_output=True, text=True, timeout=1800)
            lineas = [l for l in hecho.stdout.splitlines() if l.startswith("{\"n\"")]
            if hecho.returncode or not lineas:
                print("N=%d %s fallo:\n%s" % (n, ventana, hecho.stderr[-2000:]), flush=True)
                continue
            r = json.loads(lineas[-1])
            resultados.append(r)
            for fase in ("frio", "caliente"):
                c = r[fase]
                print("N=%3d %s %-8s total %6.2f s | lectura %6.2f | frontera %s | calculo %5.2f | %5d lecturas | pico %6.1f MB (+%5.1f sobre %5.1f, retiene +%5.1f) | medidos %d fuera %d | frontera %s"
                      % (n, ventana, fase, c["segundos"], c["lectura_s"], "-" if c["frontera_s"] is None else "%.2f" % c["frontera_s"],
                         c["calculo_s"], c["lecturas_firestore"], c["pico_mb"], c["pico_sobre_base_mb"], r["rss_inicial_mb"], c["retenido_mb"],
                         c["medidos"], c["fuera"], "si" if c["con_frontera"] else "no"), flush=True)
            if "solver_aparte_s" in r:
                print("        solver aparte %.2f s%s (pico %.1f MB)" % (r["solver_aparte_s"], " " + r.get("solver_aparte_error", ""), r["pico_tras_solver_mb"]), flush=True)
    if args.json:
        args.json.write_text(json.dumps({"seleccion": ids, "resultados": resultados}, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
