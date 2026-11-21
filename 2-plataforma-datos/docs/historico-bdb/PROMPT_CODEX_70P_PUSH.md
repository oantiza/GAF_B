> **Histórico de BDB: no se ejecuta.** Las órdenes de este documento son contra el proyecto o la carpeta de BDB, que está en uso y desde aquí no se toca. Se conserva como registro (decisión 106, 05-11-2026).

# Encargo a Codex — 70P · Push de los repos al remoto (P0-5)

**Repos:**
- Plataforma `C:\Users\oanti\Proyectos\BDB\2-plataforma-datos` — working tree limpio, ~6 commits sin pushear.
- App `C:\Users\oanti\Proyectos\BDB\3-BDB-ACTIVOS_app` — ~4 commits sin pushear.
- Extractor `C:\Users\oanti\Proyectos\BDB\1-extractor` — commits de 70N + borrado ES0141116030; working tree con ~764 cambios ajenos SIN commitear que **no** se pushean.

**El push NO toca la maestra Firestore. Nunca `--force`.**

## 0. Pre-push — seguridad (los 3 repos)
Confirma que no hay secretos trackeados. **PARA y reporta si aparece algo** (quítalo con `git rm --cached <fichero>` y commitea antes de pushear):
```
git ls-files | findstr /I "secret serviceAccount credentials token .key .pem .env"
```
`.gitignore` ya cubre `.env*`, `*.key`/`*.pem`, `serviceAccount*/credentials*/token*.json`, `config/secrets.json`; este check valida que ninguno se coló en un commit antiguo. `.env.example` puede salir (plantilla sin secretos): es OK.

## A. Plataforma
```
cd C:\Users\oanti\Proyectos\BDB\2-plataforma-datos
git status                               REM limpio
git rev-parse --abbrev-ref HEAD          REM rama (esperado: master)
git log --oneline origin/master..HEAD    REM ~6 commits a subir
git push origin HEAD
```
**PARA si `git status` no está limpio o si el push exige `--force`** (señal de divergencia: reporta antes de forzar nada).

## B. App (3-BDB-ACTIVOS_app)
```
cd C:\Users\oanti\Proyectos\BDB\3-BDB-ACTIVOS_app
git status
git log --oneline @{u}..HEAD             REM ~4 commits a subir
git push
```
Si hay cambios sin commitear que quieras subir, commítalos a propósito antes (no `git add -A` a ciegas).

## C. Extractor (1-extractor)
Primero, ¿tiene remoto? (decisión abierta #4 de OBJETIVOS):
```
cd C:\Users\oanti\Proyectos\BDB\1-extractor
git remote -v
```
- **Con remoto:** `git log --oneline @{u}..HEAD` y luego `git push`. Los ~764 cambios ajenos NO se suben (no están commiteados). **No hagas `git add -A`.**
- **Sin remoto:** no apliques push; es decisión del usuario crear un remoto privado (`git remote add origin <url>` + `git push -u origin HEAD`) o seguir local con backups.

## Reglas
- Nunca `--force` / `--force-with-lease` salvo orden expresa.
- Push sube solo commits; no toca el working tree ni la maestra.
- En el extractor, no commitear los 764 cambios ajenos en este encargo.

## Devolver
Por repo: rama, salida de `git push`, y `git log --oneline @{u}..HEAD` tras el push (vacío = al día). Para el extractor, indica si tenía remoto configurado.
