# Firebase deploy dry-run checklist

## Estado detectado

- Proyecto activo local: `bbdd-activos-financieros`.
- Hosting activo: `https://bbdd-activos-financieros.web.app` en canal `live`.
- Functions desplegadas en `europe-west1` con runtime `python312`: `search_assets`, `get_asset_detail`, `compare_assets`, `resolve_portfolio`, `get_price_series`, `get_macro_reference`, `optimize_portfolio`, `save_portfolio`, `list_portfolios`, `get_portfolio`, `delete_portfolio`.
- `.firebaserc`, `firestore.rules` y `firestore.indexes.json` siguen fuera de Git hasta una decision explicita de deploy/reglas.

## Bloqueos actuales

- No ejecutar deploy sin autorizacion explicita.
- No modificar reglas remotas desde este paquete.
- No hacer writes/deletes de Firestore en validaciones secas.
- `firebase.json` tiene predeploy guard y exige `BDB_ACTIVOS_ALLOW_FIREBASE_DEPLOY=YES_I_UNDERSTAND_SHARED_PROJECT`; esa variable no debe fijarse por defecto.
- `.env.local`, credenciales, service accounts y tokens nunca se versionan.

## Riesgos antes de deploy

- El proyecto activo es compartido y tambien contiene la base maestra de activos.
- `save_portfolio` y `delete_portfolio` pueden escribir/borrar carteras app-owned si se invocan con Auth.
- Un deploy de reglas mal revisado podria afectar datos existentes del proyecto.
- La app deberia usar un proyecto Firebase separado o aliases claros (`local`, `staging`, `production`) antes de un deploy profesional.

## Checklist previo a deploy futuro

1. Confirmar proyecto Firebase destino y cambiar/crear aliases en `.firebaserc`.
2. Decidir si BDB-ACTIVOS tendra proyecto separado para Hosting/Functions/Auth.
3. Revisar IAM: el service account de Functions solo debe tener lectura sobre la base maestra si el proyecto es separado.
4. Revisar `firestore.rules` para permitir solo `bdb_activos/{uid}/portfolios/{portfolio_id}` por propietario autenticado.
5. Confirmar que `assets` y colecciones maestras no quedan escribibles desde la app.
6. Revisar rollback: version anterior de Hosting, lista de Functions actuales y reglas previas.
7. Ejecutar build/lint/tests/canary/preview antes de cualquier deploy.
8. Ejecutar deploy solo con aprobacion explicita, comando exacto y proyecto confirmado.

## Decision actual

- Mantener `.firebaserc`, `firestore.rules`, `firestore.indexes.json`, `validate_live.py` y scripts live fuera de Git.
- Versionar solo este checklist como preparacion seca.
