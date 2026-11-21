# Implementacion de la auditoria de backend y datos

Fecha de cierre tecnico: 2026-07-10

## Alcance

Revision e implantacion sobre la aplicacion BDB-ACTIVOS, sus Cloud Functions, reglas de Firestore, plataforma de datos, extractor, autenticacion, IAM, copias, tareas programadas, contratos, observabilidad y costes.

## Resultado ejecutivo

La plataforma queda operativa con privilegio minimo, recuperacion probada, contratos versionados y controles automaticos. No se detectaron perdidas de datos ni inconsistencias activas despues de las migraciones. La aplicacion y las tareas programadas estan desplegadas en produccion.

## Controles implantados

### Aplicacion y backend

- Validacion estricta de carteras: identificadores, numeros finitos, pesos no negativos, limite de posiciones y tamano de ficheros.
- Escritura de carteras exclusivamente mediante backend autenticado; eliminada la escritura directa del cliente.
- Limites por usuario y operacion para llamadas costosas.
- App Check instrumentado en modo observacion, con reCAPTCHA Enterprise registrado sobre la app web y preparado para enforcement posterior.
- Auditoria reproducible de App Check: comprueba proveedor, dominios, servicios protegidos y veredictos de las ultimas 48 horas sin mostrar claves.
- Parser XLS reforzado para decimales europeos y fallback controlado.
- Los tipos monetarios de la Agenda de mercado se consultan desde el backend al ECB Data Portal; se eliminan las cifras fijas y, ante un fallo total o parcial, la interfaz deja las series ausentes como no disponibles.
- Frontera y backtest calculan la referencia libre de riesgo como promedio de €STR ponderado por días naturales sobre sus fechas comunes; exponen observaciones, cobertura y un fallback explícito si el BCE no responde.
- Las métricas Sharpe heredadas de fuentes heterogéneas ya no se presentan bajo una etiqueta de RF fija que no pueda acreditarse.
- Estrategia semanal y mensual se generan en dos fases: investigación actual con Google Search y redacción estructurada. El servidor valida fechas, enums, pesos, extensión y al menos dos fuentes antes de publicar.
- Los informes exponen vigencia y fuentes en la interfaz; las respuestas truncadas de Gemini se descartan y se reintentan con otro modelo.
- El publicador manual incompleto se sustituyó por una herramienta con vista previa por defecto y escritura explícita mediante `--publish`.
- CORS de callables verificado desde `127.0.0.1:5173`.
- CSP, anti-framing, politica de permisos, referrer policy y cache diferenciada entre HTML y assets.
- Cierre de sesion elimina el estado local de cartera.
- Dialogo de seguridad de cuenta con verificacion de correo, cambio de contrasena y alta o baja de TOTP.
- Inicio de sesion compatible con el reto TOTP de seis digitos.

### Identidades y secretos

- Cuenta lectora con `roles/datastore.viewer`.
- Cuenta escritora con `roles/datastore.user` y acceso solo a los secretos necesarios.
- Todas las funciones usan una de esas cuentas dedicadas.
- La cuenta de build conserva solo `roles/run.builder`.
- Las cuentas por defecto ya no tienen `roles/editor`; la de build tampoco tiene acceso a Firestore.
- Versiones antiguas de `EODHD_API_KEY` deshabilitadas; solo la version vigente permanece activa.
- Restricciones de la API key web limitadas a dominios oficiales y desarrollo local.
- Proveedor TOTP habilitado de forma optativa con un intervalo adyacente de tolerancia.
- Smoke TOTP completo superado con usuario temporal: alta, inscripcion, reto, retirada y borrado.

### Integridad de datos

- 757 activos raiz activos y validos.
- 11.858 series historicas validas bajo `asset-price-series.v1.2`.
- 757 documentos `metrics/latest` canonicos; cero invalidos o ausentes.
- Indice de busqueda reconciliado: 757 esperados, 757 presentes, cero diferencias.
- Contrato `asset-market.v1` para ETF e indices provisionales.
- Escritores Python y TypeScript alineados con los contratos vigentes.
- Cuatro referencias antiguas de `commercial_retro` sin raiz quedan congeladas y gobernadas; las reglas impiden crear o modificar nuevas referencias huerfanas.

### Recuperacion

- Firestore PITR habilitado con retencion de siete dias.
- Proteccion contra borrado habilitada.
- Backup gestionado diario con retencion de siete dias.
- Backup gestionado semanal con retencion de 28 dias.
- Copia completa local: `2-plataforma-datos/data/backups/2026-07-10T05-20-29-663Z`.
- Contenido: 14.872 documentos Firestore y un usuario Auth.
- Restore drill en emulador: 14.872 restaurados, 14.872 verificados, cero diferencias de hash.

### Operacion y costes

- Alertas de errores 5xx, fallos de tareas y memoria alta.
- Canal de correo y dashboard operativo creados.
- Auditoria `DATA_WRITE` de Firestore activada y verificada sin habilitar `DATA_READ`, para contener volumen y coste.
- Presupuesto mensual existente verificado: 10 EUR, umbrales 50 %, 90 % y 100 %.
- Tareas programadas de precios, metricas e indice habilitadas con identidad escritora.
- Tareas de estrategia semanal (lunes) y mensual (día 1) preparadas con identidad escritora y secreto gestionado de Gemini.
- Gemini API habilitada en el proyecto; la clave web admite de forma exacta los orígenes locales `localhost:5173` y `127.0.0.1:5173` además de producción.

### Dependencias y extractor

- Dependencias Python de Functions fijadas a versiones exactas.
- Cero vulnerabilidades conocidas en npm para aplicacion y plataforma.
- Cero vulnerabilidades conocidas en requisitos Python auditables.
- `justetf-scraping` no figura en PyPI; queda fijado a un commit concreto.
- Parser XML de CNMV migrado a `defusedxml`.
- SHA-1 se conserva solo donde forma parte de identificadores compatibles y se declara explicitamente como uso no criptografico.

## Verificacion

- Frontend: 274 pruebas.
- Functions Python: 129 pruebas.
- Plataforma de datos: 631 pruebas.
- Extractor: 9 pruebas.
- Total: 1043 pruebas superadas.
- TypeScript, lint, build de produccion y `git diff --check`: correctos.
- Build con la identidad restringida: correcto.
- Scheduler de metricas con identidad escritora: HTTP 200.
- Hosting, cabeceras, cache, CORS y rechazo sin autenticacion: correctos.

## Pendientes deliberados

1. Abrir Seguridad de la cuenta y enviar el enlace para sustituir la contrasena compartida durante la conversacion. No se ha guardado en codigo ni configuracion.
2. Enviar y completar la verificacion del correo; despues se podra activar TOTP desde el mismo dialogo.
3. Mantener la observacion durante al menos 48 horas desde la correccion del registro del 2026-07-10; no habilitar enforcement hasta obtener trafico `VALID` y una proporcion no valida igual o inferior al 1 %.
4. Antes del enforcement, registrar un token debug exclusivo para desarrollo local y guardarlo solo en `.env.local`; nunca versionarlo ni habilitar `localhost` como dominio reCAPTCHA.
5. Revisar trimestralmente las cuatro referencias legacy congeladas y retirarlas solo con una decision de negocio.

## Cadencia recomendada

- Diario: revisar fallos de tareas y errores 5xx.
- Semanal: revisar cobertura de precios, metricas e indice.
- Mensual: restore drill completo y revision del presupuesto.
- Trimestral: IAM, secretos, dependencias, reglas y datos legacy.
