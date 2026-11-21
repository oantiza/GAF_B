# -*- coding: utf-8 -*-
"""4-base-nueva/quien_entra.py — quién entra hoy en el cálculo por igualar al proveedor (decisiones 55 y 91).

    python 4-base-nueva/quien_entra.py

Lo llama `refrescar.mjs` en cada refresco. Solo lee, y solo del emulador de la base nueva, y deja un JSON en la salida.
La regla no se copia: se pregunta a `optimization.repository._le_faltan_los_pagos`, la misma función que deja entrar o no
a un fondo en simulación y frontera. Así el listado no puede decir otra cosa que el cálculo.

El destino se impone aquí y no se hereda del entorno: este id es de un proyecto REAL, y con las credenciales anónimas de
abajo, además, un error de configuración no podría leer la nube.
"""
import json
import os
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")
sys.dont_write_bytecode = True
PROYECTO = "bdb-gestor-de-activos"
os.environ["FIRESTORE_EMULATOR_HOST"] = "127.0.0.1:8092"
os.environ["GOOGLE_CLOUD_PROJECT"] = PROYECTO
os.environ["MASTER_PROJECT_ID"] = PROYECTO
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "3-BDB-ACTIVOS_app" / "functions_python"))


def main() -> None:
    # Lo que escriban los módulos al cargar o al leer no se mezcla con el JSON, que es lo único que sale por aquí.
    salida = sys.stdout
    sys.stdout = sys.stderr

    from google.auth.credentials import AnonymousCredentials
    from google.cloud import firestore

    from fund_distributions import contraste_con_el_proveedor, rendimiento_12m_pct, reparte_sin_todos_los_pagos
    from fund_history_quality import policy_for
    from optimization.repository import _cached_price_series, _le_faltan_los_pagos
    from readmodel.lector_base_nueva import LectorOptimizacionBaseNueva

    db = firestore.Client(project=PROYECTO, credentials=AnonymousCredentials())
    lector = LectorOptimizacionBaseNueva(db)
    ids = [documento.id for documento in db.collection("instruments").select([]).stream()]
    raices = lector.get_assets_many(ids)

    con_rendimiento = sorted(asset_id for asset_id, raiz in raices.items() if reparte_sin_todos_los_pagos(raiz))
    bloqueados = [asset_id for asset_id in con_rendimiento if policy_for(asset_id).get("blocked")]
    fondos = []
    for asset_id in con_rendimiento:
        if asset_id in bloqueados:
            continue  # Lo bloqueado no se lee ni se mide con ello, iguale o no.
        raiz = raices[asset_id]
        contraste = contraste_con_el_proveedor(raiz, _cached_price_series(lector, asset_id))
        fondos.append({
            "isin": asset_id,
            "nombre": ((raiz.get("identity") or {}).get("name")) or asset_id,
            "rendimiento_12m_pct": rendimiento_12m_pct(raiz),
            "entra": not _le_faltan_los_pagos(raiz, asset_id, lector),
            "diferencias_pp": {ventana: nodo.get("diff_pp") for ventana, nodo in contraste.items()},
        })
    json.dump({"con_rendimiento": len(con_rendimiento), "bloqueados": len(bloqueados), "fondos": fondos}, salida, ensure_ascii=False)


if __name__ == "__main__":
    main()
