> **Histórico de BDB: no se ejecuta.** Las órdenes de este documento son contra el proyecto o la carpeta de BDB, que está en uso y desde aquí no se toca. Se conserva como registro (decisión 106, 05-11-2026).

# Encargo a ejecutor — 70Q · Remediar .env.production + commit docs + push (continúa 70P)

**Ejecutor sugerido:** Codex (operación git con paradas de seguridad → máxima fiabilidad). Si Codex no está disponible: Antigravity + **Gemini 3.1 pro** (NO flash: hay decisiones de parada y verificación de secretos).

70P paró bien en el precheck. Decidido: **sacar `.env.production` del tracking** (3 vars VITE públicas, SIN secretos — no hay nada que rotar) y **commitear los docs**. Cambios de ficheros YA hechos por Claude (no requieren tu entorno):
- App `.gitignore`: ahora ignora `.env.*` (excepto `.env.example`).
- App `.env.example`: documenta `VITE_ADMIN_EMAILS` (placeholder).

## A. App — sacar .env.production del tracking
```
cd C:\Users\oanti\Proyectos\BDB\3-BDB-ACTIVOS_app
git rm --cached .env.production            REM lo mantiene en disco; deja de versionarlo
git add .gitignore .env.example
git status                                  REM deleted .env.production + modified .gitignore/.env.example
git commit -m "chore(app): dejar de versionar .env.production; ignorar .env.* + documentar VITE_ADMIN_EMAILS"
git ls-files | findstr .env                 REM debe mostrar SOLO .env.example
```

## B. Plataforma — commitear docs (desbloquea working tree)
```
cd C:\Users\oanti\Proyectos\BDB\2-plataforma-datos
git add docs/PROMPT_CODEX_70P_PUSH.md docs/PROMPT_CODEX_70Q_REMEDIAR_ENV_PUSH.md
git commit -m "docs: encargos push 70P/70Q"
git status                                  REM limpio
```

## C. Push (los 3 repos)
Pre-push seguridad (PARA si sale algo que no sea `.env.example`):
```
git ls-files | findstr /I "secret serviceAccount credentials token .key .pem .env"
```
- **Plataforma:** `git push origin HEAD`  (~7 commits con el de docs)
- **App:** confirma que `git ls-files | findstr .env` solo lista `.env.example` → `git push`
- **Extractor:** `git remote -v`; con remoto → `git push` (NO `git add -A`, deja los ~764 ajenos); sin remoto → decisión del usuario (crear remoto privado o seguir local).

## Reglas
Nunca `--force`. Push solo sube commits; no toca la maestra. No `git add -A` en el extractor.

## Devolver
Por repo: salida de `git push` y `git log --oneline @{u}..HEAD` tras el push (vacío = al día). Confirma que `git ls-files` de la app ya no incluye `.env.production`.
