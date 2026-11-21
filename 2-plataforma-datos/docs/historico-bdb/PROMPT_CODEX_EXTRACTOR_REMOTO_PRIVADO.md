> **Histórico de BDB: no se ejecuta.** Las órdenes de este documento son contra el proyecto o la carpeta de BDB, que está en uso y desde aquí no se toca. Se conserva como registro (decisión 106, 05-11-2026).

# Encargo a ejecutor — Extractor: higiene .gitignore + remoto privado + push inicial (decisión #4)

**Ejecutor sugerido:** Codex (git + creación de repo remoto privado → fiabilidad). Si no está disponible: Antigravity + **Gemini 3.1 pro**. NO flash.

**Repo:** `C:\Users\oanti\Proyectos\BDB\1-extractor` (Python, hoy local-only sin remoto). Es la pieza de más valor; objetivo: backup versionado en remoto **privado**.

## Contexto (tamaños verificados)
Los ~764 cambios del working tree son **datos regenerables**, no código: `cache/` (1.9 GB), `data/funds/` (37M, 752 JSON), `data/history_vl/` (23M), `data/visor.html` (19M), `export/` (25M ndjson), `data/index.json` (328K), `reports/`. NADA de eso debe versionarse — se reproduce con `python main.py update/export/bdb`. Solo se versiona **código + config**.

## Paso 1 — Higiene .gitignore
Añade a `1-extractor/.gitignore` (ya ignora `cache/`, `data/history/`, `export_bdb/`, secretos):
```
# Datos regenerables (no versionar; se reproducen con main.py update/export/bdb)
data/funds/
data/history_vl/
data/index.json
data/visor.html
export/
reports/
```
Saca del índice lo que ya estuviera trackeado (los ficheros SIGUEN en disco):
```
cd C:\Users\oanti\Proyectos\BDB\1-extractor
git rm -r --cached data/funds data/history_vl data/index.json data/visor.html export reports 2>NUL
git add .gitignore
git commit -m "chore: ignorar datos regenerables (data/export/reports); versionar solo codigo+config"
git status
```
Tras esto `git status` debe quedar limpio (o con solo cambios reales de código/config). Si siguen apareciendo cientos de ficheros de datos, **para y reporta** la carpeta.

## Paso 2 — Pre-push seguridad
```
git ls-files | findstr /I "secret serviceAccount credentials token .key .pem .env"
```
Debe estar **vacío** (`config/secrets.json` ya está gitignored). **PARA si aparece algo.**
Confirma además que `git ls-files` ya NO incluye `data/funds`, `export/`, `cache/` (solo código + `config/*.csv|json` + docs).

## Paso 3 — Crear remoto PRIVADO + push
El repo DEBE ser **privado** (contiene `config/fondos.csv` = tu universo de seguimiento). Con GitHub CLI:
```
gh repo create oantiza/fondosdb --private --source=. --remote=origin --push
```
o manual: crea un repo privado vacío en GitHub y luego:
```
git remote add origin https://github.com/oantiza/fondosdb.git
git push -u origin HEAD
```
(El nombre `fondosdb` es sugerencia; ponle el que prefieras.)

## Paso 4 — Verificar
```
git remote -v
git log --oneline @{u}..HEAD      REM vacío = al día
git ls-files | find /c /v ""      REM nº de ficheros versionados: debe ser pequeño (código+config), no miles
```

## Reglas
- Repo **privado** obligatorio. Nunca subir secretos ni datos masivos (los excluye el .gitignore del Paso 1).
- Nunca `--force`. No `git add -A` a ciegas: tras el Paso 1, solo deben entrar código+config.

## Devolver
`git remote -v`, salida de `git push`, `git log --oneline @{u}..HEAD` (vacío) y el recuento de `git ls-files` (pequeño). Si algo bloquea, repórtalo antes de forzar.
