> **Histórico de BDB: no se ejecuta.** Las órdenes de este documento son contra el proyecto o la carpeta de BDB, que está en uso y desde aquí no se toca. Se conserva como registro (decisión 106, 05-11-2026).

# Operacion cloud

Recursos creados el 2026-07-10:

- Alerta 5xx: `3139498423372535532`.
- Alerta de tareas programadas: `1105161590518688933`.
- Alerta de memoria: `14340990363628241826`.
- Dashboard: `eccea326-d689-4a1c-b493-4ea67fd3ae69`.

Los JSON de `monitoring/` son la definicion reproducible. El dashboard incluye veredictos App Check por servicio y validez. `cloud-build-identity-smoke.yaml` valida que la cuenta de build restringida puede ejecutar una compilacion sin recuperar `Editor`.

Despues de cada despliegue de Functions, comprobar que las NUEVE tareas de Cloud Scheduler (indice 3:45, precios 7:30 mar-sab, semanal lu 7:15, diario lu-vi 7:00, metricas 8:30/9:00/9:30/10:00, integridad 10:30) usan `bdb-functions-writer@bbdd-activos-financieros.iam.gserviceaccount.com`.
