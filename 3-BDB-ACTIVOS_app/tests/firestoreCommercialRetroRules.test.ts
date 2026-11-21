import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type MatchBlock = { path: string; body: string };
type AllowRule = { text: string; condition: string };

/** Bloques `match /ruta { ... }` del documento (excluye el `match /databases/...`
 *  raíz). Cuenta llaves para cerrar cada bloque. */
function parseMatchBlocks(source: string): MatchBlock[] {
  const blocks: MatchBlock[] = [];
  // La ruta admite segmentos `{var}` y `{document=**}`; la llave que abre el bloque va después.
  const re = /match\s+(\/(?:[^\s{}]|\{[^{}]*\})+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const path = m[1];
    let depth = 1;
    let i = re.lastIndex;
    for (; i < source.length && depth > 0; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") depth -= 1;
    }
    if (!path.startsWith("/databases/")) blocks.push({ path, body: source.slice(re.lastIndex, i - 1) });
  }
  return blocks;
}

/** Sentencias `allow ...;` de un bloque con su condición normalizada
 *  (sin `if`, espacios colapsados; "" si es incondicional). */
function allowRules(body: string): AllowRule[] {
  const rules: AllowRule[] = [];
  const re = /allow\s+[^;]*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const text = m[0].replace(/\s+/g, " ").trim();
    const cond = /:\s*if\s+(.*);$/.exec(text);
    rules.push({ text, condition: cond ? cond[1].trim() : "" });
  }
  return rules;
}

describe("commercial_retro firestore rules", () => {
  const rules = readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8");

  /* Ola A1 (Q2, 25-08): las retrocesiones son margen comercial sensible y el
     registro está abierto — la lectura pasa de «cualquier autenticado» a solo
     admin. Una cuenta sin claim ve N/D en las columnas RETRO. */
  it("restricts reads and writes/deletes to admins", () => {
    expect(rules).toContain("match /commercial_retro/{isin}");
    expect(rules).toContain("allow read: if isAdmin()");
    expect(rules).not.toContain("allow read: if signedIn()");
    expect(rules).toContain("allow create, update: if isAdmin() && assetExists(isin) && isValidCommercialRetro(isin)");
    expect(rules).toContain("allow delete: if isAdmin() && isValidIsin(isin)");
    expect(rules).toContain("request.auth.token.admin == true");
  });

  /* S-11 (auditoría 29-09): `toContain("allow read, write: if false")` pasaba
     aunque hubiera un `match /assets` abierto. Se parsean los bloques `match` y
     se comprueba que ninguna ruta de la maestra ni app-owned queda abierta y que
     el comodín final deniega. */
  it("keeps commercial retro separate from the master assets collection", () => {
    expect(rules).toContain("exists(/databases/$(database)/documents/assets/$(isin))");
    const bloques = parseMatchBlocks(rules);
    expect(bloques.length).toBeGreaterThan(0);

    const protegidos = ["/assets", "/price_series", "/metrics", "/meta", "/bdb_activos"];
    for (const bloque of bloques) {
      const reglas = allowRules(bloque.body);
      const esProtegido = protegidos.some((prefijo) => bloque.path.startsWith(prefijo));
      for (const regla of reglas) {
        // Ninguna regla de ningún match puede ser `if true` o incondicional.
        expect(regla.condition, `${bloque.path}: ${regla.text}`).not.toMatch(/^(true)?$/);
        if (esProtegido) {
          // Una ruta de la maestra o app-owned solo admite `false` o exigir admin.
          expect(regla.condition, `${bloque.path}: ${regla.text}`).toMatch(/^false$|isAdmin\(\)/);
        }
      }
    }

    // Comodín final: es el último match y deniega todo.
    const ultimo = bloques[bloques.length - 1];
    expect(ultimo.path).toBe("/{document=**}");
    expect(allowRules(ultimo.body)).toEqual([
      { text: "allow read, write: if false;", condition: "false" }
    ]);
    // La maestra no se gestiona aquí: ni un match explícito sobre assets/.
    expect(bloques.some((b) => b.path.startsWith("/assets"))).toBe(false);
  });

  it("el parser detecta un match /assets abierto (copia alterada, no el fichero real)", () => {
    const abierto = rules.replace(
      "match /{document=**} {",
      "match /assets/{isin} {\n      allow read, write: if true;\n    }\n\n    match /{document=**} {"
    );
    const bloques = parseMatchBlocks(abierto);
    const assets = bloques.find((b) => b.path === "/assets/{isin}");
    expect(assets).toBeDefined();
    expect(allowRules(assets!.body)[0].condition).toBe("true");
  });

  it("keeps app-owned portfolios behind validated callable functions", () => {
    expect(rules).toContain("match /bdb_activos/{uid}/portfolios/{portfolioId}");
    expect(rules).toMatch(
      /match \/bdb_activos\/\{uid\}\/portfolios\/\{portfolioId\}\s*\{\s*allow read, write: if false;/m
    );
  });

  /* 05-09: la foto de cada importación masiva (lo que había y lo que se
     escribió) vive en su colección, solo para admins y sin borrado. */
  it("guarda la foto de cada importación solo para admins y nunca la borra", () => {
    const block = rules.slice(rules.indexOf("match /commercial_retro_imports/{importId}"));
    expect(block).not.toHaveLength(0);
    expect(block).toMatch(/^match \/commercial_retro_imports\/\{importId\}\s*\{\s*allow read: if isAdmin\(\);/);
    // La validación del recibo vive en isValidImportReceipt (S-09) y la usan create y update.
    expect(rules).toContain("request.resource.data.import_id == importId");
    expect(rules).toContain("request.resource.data.status in ['applied', 'partial', 'undone']");
    // Solo el bloque de esta colección, hasta el siguiente `match /`.
    const own = block.slice("match /".length).split("match /")[0];
    expect(own).toContain("allow create: if isAdmin()\n        && isValidImportReceipt(importId)");
    expect(own).toContain("allow update: if isAdmin()\n        && isValidImportReceipt(importId)");
    expect(own).toContain("allow delete: if false;");
  });

  /* S-09 (auditoría 29-09): la foto de importación nace en `partial` y solo
     avanza (partial -> applied/undone, applied -> undone); `undone` es
     inmutable. Reproduce las transiciones de commercialRetroStore.ts. */
  it("S-09: la foto de importación solo admite las transiciones de estado del cliente", () => {
    const own = rules.slice(rules.indexOf("match /commercial_retro_imports/{importId}")).split("match /")[1];
    expect(own).toContain("&& request.resource.data.status == 'partial';");
    expect(own).toContain("&& isValidImportTransition();");
    const fn = rules.slice(rules.indexOf("function isValidImportTransition()"));
    const cuerpo = fn.slice(0, fn.indexOf("}") + 1).replace(/\s+/g, " ");
    expect(cuerpo).toContain("resource.data.status == 'partial'");
    expect(cuerpo).toContain("resource.data.status == 'applied' && request.resource.data.status in ['applied', 'undone']");
    // Ningún camino admite salir de `undone`.
    expect(cuerpo).not.toContain("resource.data.status == 'undone'");
  });

  /* ALTA-06 (auditoría 16-10-2026): la foto nace solo con las claves que escribe
     applyCommercialRetroImport, firmada por quien la crea, y después solo cambian
     el avance por lotes y el deshacer; `previous`, `applied` y `created_*` son
     inmutables. El smoke del emulador (smoke:commercial-retro-rules) lo ejecuta. */
  it("ALTA-06: la foto de importación nace cerrada y solo cambia lo del avance y el deshacer", () => {
    const own = rules.slice(rules.indexOf("match /commercial_retro_imports/{importId}")).split("match /")[1];
    expect(own).toContain("&& isValidImportCreation()");
    expect(own).toContain("&& isValidImportUpdateKeys()");

    const creation = rules.slice(rules.indexOf("function isValidImportCreation()"));
    const createBody = creation.slice(0, creation.indexOf("\n    }")).replace(/\s+/g, " ");
    const createKeys = /keys\(\)\.hasOnly\(\[([^\]]*)\]\)/.exec(createBody)?.[1] ?? "";
    // Las claves que escribe hoy commercialRetroStore.applyCommercialRetroImport.
    const store = readFileSync(resolve(process.cwd(), "src/adapters/commercialRetroStore.ts"), "utf8");
    const setDocBody = store.slice(store.indexOf("await setDoc(runRef, {"));
    const written = [...setDocBody.slice(0, setDocBody.indexOf("});")).matchAll(/^\s{4}(?:\.\.\.\(meta\.)?([a-z_]+)(?:[,:]| \?)/gm)].map((m) => m[1]);
    expect(written.length).toBe(15);
    expect(createKeys.split(",").map((k) => k.trim().replace(/'/g, "")).sort()).toEqual([...written].sort());
    expect(createBody).toContain("request.resource.data.created_at == request.time");
    expect(createBody).toContain("signedBySession(request.resource.data.created_by)");
    const signer = rules.slice(rules.indexOf("function signedBySession(value)"));
    const signerBody = signer.slice(0, signer.indexOf("\n    }")).replace(/\s+/g, " ");
    expect(signerBody).toContain("value == request.auth.uid || ('email' in request.auth.token && value == request.auth.token.email)");

    const update = rules.slice(rules.indexOf("function isValidImportUpdateKeys()"));
    const updateBody = update.slice(0, update.indexOf("\n    }")).replace(/\s+/g, " ");
    expect(updateBody).toContain("let changed = request.resource.data.diff(resource.data).affectedKeys();");
    const lists = [...updateBody.matchAll(/hasOnly\(\[([^\]]*)\]\)/g)].map((m) =>
      m[1].split(",").map((k) => k.trim().replace(/'/g, "")).sort());
    expect(lists[0]).toEqual([
      "applied_batches", "applied_isins", "applied_versions", "error", "status", "undone_at", "undone_by", "undone_isins"
    ]);
    for (const frozen of ["previous", "applied", "created_by", "created_at", "import_id"]) {
      expect(lists[0]).not.toContain(frozen);
    }
    // Segunda pasada (17-10-2026): con la foto en `applied`, applied_* tampoco cambian.
    expect(updateBody).toContain("resource.data.status != 'applied' || changed.hasOnly([");
    expect(lists[1]).toEqual(["error", "status", "undone_at", "undone_by", "undone_isins"]);

    // Y el deshacer va firmado por la sesión y con la hora del servidor.
    expect(own).toContain("&& isValidImportUndoStamp()");
    const stamp = rules.slice(rules.indexOf("function isValidImportUndoStamp()"));
    const stampBody = stamp.slice(0, stamp.indexOf("\n    }")).replace(/\s+/g, " ");
    expect(stampBody).toContain("(!changed.hasAny(['undone_by']) || signedBySession(request.resource.data.undone_by))");
    expect(stampBody).toContain("(!changed.hasAny(['undone_at']) || request.resource.data.undone_at == request.time)");
    // Tercera pasada (17-10-2026): cerrar en `undone` exige la hora del cierre y la firma.
    expect(stampBody).toContain(
      "(request.resource.data.status != 'undone' || (changed.hasAll(['undone_at']) && request.resource.data.keys().hasAll(['undone_by']) && signedBySession(request.resource.data.undone_by)))"
    );
    // El cliente escribe siempre los tres juntos al cerrar el deshacer.
    expect(store).toMatch(/complete \? \{ status: "undone", undone_at: serverTimestamp\(\), undone_by: updated_by \}/);
  });

  /* S-09 (auditoría 29-09): textos libres acotados para que un admin no pueda
     inflar el documento (note ≤ 2.000, source ≤ 200, updated_by ≤ 320). */
  it("S-09: acota el tamaño de note, source y updated_by en commercial_retro", () => {
    const fn = rules.slice(rules.indexOf("function isValidCommercialRetro(isin)"));
    const cuerpo = fn.slice(0, fn.indexOf("\n    }")).replace(/\s+/g, " ");
    expect(cuerpo).toContain("request.resource.data.source.size() <= 200");
    expect(cuerpo).toContain("request.resource.data.updated_by.size() <= 320");
    expect(cuerpo).toContain("(request.resource.data.note is string && request.resource.data.note.size() <= 2000)");
  });

  /* S-08 (auditoría 29-09): las colecciones av_* se autorizaban por una lista
     de tres correos en claro; ahora exigen el mismo claim `admin` que el resto
     de la app (más correo verificado). Ningún correo puede quedar en las reglas. */
  it("S-08: av_* se autoriza por claim admin y correo verificado, sin correos en claro", () => {
    expect(rules).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    expect(rules).not.toContain("esOscar");
    expect(rules).not.toContain("request.auth.token.email in");
    const fn = rules.slice(rules.indexOf("function esAdminVerificado()"));
    const cuerpo = fn.slice(0, fn.indexOf("}") + 1).replace(/\s+/g, " ");
    expect(cuerpo).toContain("isAdmin() && request.auth.token.email_verified == true");
    for (const bloque of parseMatchBlocks(rules).filter((b) => b.path.startsWith("/av_"))) {
      for (const regla of allowRules(bloque.body)) {
        expect(regla.condition, `${bloque.path}: ${regla.text}`).toMatch(/^(esAdminVerificado\(\)|false)$/);
      }
    }
  });
});
