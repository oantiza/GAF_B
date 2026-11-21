#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Pone (o quita) el custom claim `admin` a un usuario de Firebase Auth, para habilitar
el Panel Admin de la app.

OJO: el claim es del proyecto de AUTH (el de las functions/app). Si tu proyecto por defecto
de ADC es otro, pásalo con AUTH_PROJECT_ID (lo ves en src/firebase.ts -> projectId, o en la
consola de Firebase). El claim de la nube lo da `npm run nube:administrador` de la plataforma.

Uso (auditoria 29-09 S-04: exige el gate maestro y --project explicito):
    BDB_ACTIVOS_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES \
      python scripts/set_admin.py oantiza@gmail.com --project <proyecto-auth>            # pone admin=True
    ... python scripts/set_admin.py oantiza@gmail.com --project <proyecto-auth> --remove  # lo quita

`--project` debe coincidir con el proyecto de las credenciales ADC activas (o con
GOOGLE_CLOUD_PROJECT); si no, el script aborta sin tocar nada. AUTH_PROJECT_ID sigue
valiendo como valor por defecto de `--project`. Solo valen los dos proyectos de aquí
(`master_project.PROYECTOS_PERMITIDOS`): el de BDB se rechaza aunque coincida con ADC.

Tras ponerlo: cierra sesión y vuelve a entrar en la app (o recarga) para que el token
nuevo lleve el claim.
"""
import argparse
import os
import sys

import firebase_admin
from firebase_admin import auth
import google.auth

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "functions_python"))
from master_project import exigir_proyecto_permitido  # noqa: E402
from write_governance import MASTER_WRITE_CONFIRMATION, MASTER_WRITE_ENV, master_writes_enabled  # noqa: E402

parser = argparse.ArgumentParser(description="Pone o quita el custom claim admin (Firebase Auth).")
parser.add_argument("email")
parser.add_argument("--project", default=os.environ.get("AUTH_PROJECT_ID"),
                    help="Proyecto de Firebase Auth. Obligatorio; debe coincidir con el de ADC.")
parser.add_argument("--remove", action="store_true", help="Quita el claim en vez de ponerlo.")
args = parser.parse_args()
email, remove, proj = args.email, args.remove, args.project

if not master_writes_enabled():
    print(f"Escritura bloqueada: exporta {MASTER_WRITE_ENV}={MASTER_WRITE_CONFIRMATION} solo para esta ejecucion.")
    raise SystemExit(2)
if not proj:
    print("Falta --project (o AUTH_PROJECT_ID): el proyecto de Auth debe indicarse de forma explicita.")
    raise SystemExit(2)
try:
    proj = exigir_proyecto_permitido(proj, "--project")
except RuntimeError as exc:
    print(exc)
    raise SystemExit(2)
try:
    _, adc_project = google.auth.default()
except Exception as exc:  # noqa: BLE001 - se informa y se aborta
    print(f"No hay credenciales ADC utilizables: {exc}")
    raise SystemExit(2)
adc_project = adc_project or os.environ.get("GOOGLE_CLOUD_PROJECT")
if adc_project != proj:
    print(f"--project={proj} no coincide con el proyecto de ADC ({adc_project or 'desconocido'}). No se escribe nada.")
    raise SystemExit(2)

firebase_admin.initialize_app(options={"projectId": proj})

u = auth.get_user_by_email(email)
auth.set_custom_user_claims(u.uid, None if remove else {"admin": True})
print(("Quitado admin a " if remove else "admin=True puesto a ") + "%s (uid %s)." % (email, u.uid))
print("Cierra sesión y vuelve a entrar en la app para refrescar el token.")
