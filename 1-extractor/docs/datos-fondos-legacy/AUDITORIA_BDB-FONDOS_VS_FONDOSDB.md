# Auditoría BDB-FONDOS — 11-06-2026

Revisión del proyecto `C:\Users\oanti\Documents\BDB-FONDOS` (Firebase `bdb-fondos`,
plan Blaze) y su encaje con FondosDB.

## Qué es

Plataforma seria de **optimización de carteras**: frontend React + Cloud
Functions en Python (motor de optimización, perfiles de riesgo 1-10, suelos de
RV y bandas de volatilidad por perfil), informes, y un pipeline de datos con
gobernanza (canonical / review / error / overrides / validación institucional).

## Colecciones Firestore

| Colección | Uso | Reglas |
|---|---|---|
| `funds_v3` | Universo de fondos (el equivalente a nuestro data/funds) | lectura autenticados, escritura solo admin |
| `historico_vl_v2` | Series de VL (el "proveedor de históricos") | ídem |
| `users/{uid}` | Datos por usuario | solo el propio usuario |
| `analysis_results` | Resultados del optimizador | lectura auth, escritura bloqueada (solo Functions) |
| `system_settings`, `reports`, `synthetic_benchmarks`, `admin_jobs` | Operativa | admin |

## Seguridad: bien planteada

Default-deny global ✓, escrituras solo admin ✓, datos de usuario aislados ✓,
resultados solo escribibles por backend ✓. La apiKey visible en la captura es
configuración pública de cliente (lo normal en Firebase); la defensa real son
las reglas, y están bien. Dos matices:

1. **Lectura del universo para cualquier autenticado**: si el registro (Auth)
   está abierto, cualquiera con una cuenta Google puede leer `funds_v3`
   entero. Si la app es solo para ti o para invitados, restringe el alta de
   usuarios o añade una lista blanca de emails en las reglas.
2. `isAdmin` por email es válido mientras el proveedor verifique el email
   (con Google sí). No usar nunca proveedores sin verificación con esa regla.

## El hallazgo importante: la alimentación de datos

El origen actual es un **parser de PDFs de Morningstar** (informes manuales →
canónico → funds_v3). El estado lo dice todo:

- `data/canonical`: 492 ISINs · `data/error`: **299** · `data/review`: 73.
- **Frescura**: 333 de 492 fondos (68%) llevan datos de **diciembre 2025**
  (6 meses); solo 27 se actualizaron en marzo 2026. Nada posterior.
- Huecos sistémicos del PDF en el propio esquema: `medalist_rating: null`,
  `sustainability: null`, `credit_bucket: null`, `duration_bucket: null`,
  `bond_types: null` — justo la analítica de RF que el optimizador agradecería.
- El coste de mantenerlo se ve en la raíz: 4 PDFs de auditoría, 2 informes de
  remediación, un fichero ERROR de 163 KB.

En paralelo, FondosDB obtiene por API, en ~30 minutos y con datos de ayer,
los mismos campos y bastantes más (YTW, tramos de vencimiento, MiFID, ESG con
carbono, IG/HY%, sectores de bono), con 433/499 fondos en calidad ALTA y los
mismos ISINs (las dos listas comparten el mismo fondos.csv).

## Conclusión y recomendación

La arquitectura de BDB-FONDOS es buena; su cuello de botella es el origen de
datos. La mejora con mejor relación esfuerzo/beneficio no es tocar el
optimizador, sino **cambiar la fuente**: un adaptador que convierta el export
de FondosDB al esquema canónico de BDB (`ms.*`, `classification_v2`,
`portfolio_exposure_v2`) y lo cargue en `funds_v3` con el script de subida ya
existente. El parser de PDFs quedaría como respaldo para fondos sin cobertura
API. Efecto esperado: frescura semanal en vez de semestral, las carpetas
error/review casi vacías, y los nulls de RF rellenos.

*(Pendiente de decisión del propietario — no se ha construido nada.)*
