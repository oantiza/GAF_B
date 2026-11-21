import { Socket } from "node:net";
import { initializeApp, deleteApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithCustomToken,
  signOut,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  deleteField,
  doc,
  getDocFromServer,
  writeBatch,
  terminate,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

function parseHostPort(value, fallbackPort) {
  const [host, rawPort] = value.split(":");
  return { host, port: Number(rawPort || fallbackPort) };
}

function assertReachable({ host, port }, label) {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const done = (error) => {
      socket.destroy();
      if (error) {
        reject(new Error(`SMOKE_FAIL: ${label} no está disponible en ${host}:${port}. Arranca los emuladores de Auth y Firestore antes de ejecutar este smoke.`));
      } else {
        resolve();
      }
    };
    socket.setTimeout(1000);
    socket.once("connect", () => done());
    socket.once("timeout", () => done(new Error("timeout")));
    socket.once("error", done);
    socket.connect(port, host);
  });
}

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function createAuthEmulatorCustomToken(uid, claims = {}) {
  const now = Math.floor(Date.now() / 1000);
  return [
    base64Url({ alg: "none", typ: "JWT" }),
    base64Url({
      iss: "owner",
      sub: "owner",
      aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
      iat: now,
      exp: now + 3600,
      uid,
      claims,
    }),
    "",
  ].join(".");
}

async function expectPermissionDenied(label, action) {
  try {
    await action();
    throw new Error(`SMOKE_FAIL: ${label} no fue denegado.`);
  } catch (error) {
    if (error?.code === "permission-denied") {
      console.log(`SMOKE_OK: ${label} denegado.`);
      return;
    }
    throw error;
  }
}

async function expectAllowed(label, action) {
  try {
    await action();
    console.log(`SMOKE_OK: ${label} permitido.`);
  } catch (error) {
    throw new Error(`SMOKE_FAIL: ${label} no fue permitido: ${error?.code ?? error?.message ?? error}`);
  }
}

async function seedMasterAsset({ host, port }, projectId, isin) {
  const url = `http://${host}:${port}/v1/projects/${projectId}/databases/(default)/documents/assets/${isin}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: "Bearer owner",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: { asset_id: { stringValue: isin } } }),
  });
  if (!response.ok) {
    throw new Error(`SMOKE_FAIL: no se pudo sembrar el activo maestro (${response.status}).`);
  }
}

// Marca el correo como verificado en el Auth Emulator (API privilegiada con Bearer owner).
async function markEmailVerified({ host, port }, projectId, localId, email) {
  const url = `http://${host}:${port}/identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:update`;
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
    body: JSON.stringify({ localId, email, emailVerified: true }),
  });
  if (!response.ok) {
    throw new Error(`SMOKE_FAIL: no se pudo marcar el correo como verificado (${response.status}).`);
  }
}

async function main() {
  const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || "demo-bdb-parc";
  const firestoreTarget = parseHostPort(process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080", 8080);
  const authTarget = parseHostPort(process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099", 9099);

  if (!projectId.startsWith("demo-") || ![authTarget.host, firestoreTarget.host].every((host) => ["127.0.0.1", "localhost"].includes(host))) {
    throw new Error("SMOKE_FAIL: estas pruebas solo admiten proyectos demo- y emuladores en loopback.");
  }
  await assertReachable(authTarget, "Auth Emulator");
  await assertReachable(firestoreTarget, "Firestore Emulator");

  const app = initializeApp({
    apiKey: "demo-key",
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
  });
  const auth = getAuth(app);
  const db = getFirestore(app);

  connectAuthEmulator(auth, `http://${authTarget.host}:${authTarget.port}`, { disableWarnings: true });
  connectFirestoreEmulator(db, firestoreTarget.host, firestoreTarget.port);
  await seedMasterAsset(firestoreTarget, projectId, "IE00B4L5Y983");

  const email = `noadmin-${Date.now()}@example.com`;
  await createUserWithEmailAndPassword(auth, email, "password-123456");

  const retroRef = doc(db, "commercial_retro", "IE00B4L5Y983");
  await expectPermissionDenied("usuario autenticado sin claim lee commercial_retro", () => getDocFromServer(retroRef));
  await expectPermissionDenied("usuario autenticado no-admin escribe commercial_retro", () =>
    setDoc(retroRef, {
      isin: "IE00B4L5Y983",
      retro_pct: 0.45,
      as_of_date: "2026-06-30",
      source: "SMOKE",
      updated_at: serverTimestamp(),
      updated_by: email,
    })
  );

  await signOut(auth);
  await expectPermissionDenied("usuario no autenticado lee commercial_retro", () => getDocFromServer(retroRef));

  const adminUid = `admin-${Date.now()}`;
  const adminEmail = `${adminUid}@example.com`;
  const customToken = createAuthEmulatorCustomToken(adminUid, { admin: true, email: adminEmail });
  await signInWithCustomToken(auth, customToken);
  await expectAllowed("usuario con claim admin escribe commercial_retro", () =>
    setDoc(retroRef, {
      isin: "IE00B4L5Y983",
      retro_pct: 0.45,
      as_of_date: "2026-06-30",
      source: "SMOKE",
      updated_at: serverTimestamp(),
      updated_by: adminEmail,
    })
  );
  const isins = Array.from({ length: 21 }, (_, i) => `LU${String(i).padStart(10, "0")}`);
  await Promise.all(isins.map((isin) => seedMasterAsset(firestoreTarget, projectId, isin)));
  const commit = async (ids) => {
    const batch = writeBatch(db);
    ids.forEach((isin) => batch.set(doc(db, "commercial_retro", isin), {
      isin, retro_pct: 0.6, as_of_date: "2026-09-05", source: "SMOKE",
      updated_at: serverTimestamp(), updated_by: adminEmail
    }));
    await batch.commit();
  };
  await expectAllowed("20 activos distintos respetan el límite de reglas", () => commit(isins.slice(0, 20)));
  await expectPermissionDenied("21 activos distintos superan el límite de reglas", () => commit(isins));

  // ALTA-06 (auditoría 16-10-2026): la foto de importación nace con las claves del cliente,
  // firmada por quien la crea, y después solo cambian el avance y el deshacer. Se firma
  // como commercialRetroStore (`user.email ?? user.uid`): el emulador no pasa el claim
  // `email` de un token personalizado, así que aquí firma el uid hasta verificar el correo.
  const signer = () => auth.currentUser.email ?? auth.currentUser.uid;
  const receipt = (importId, extra = {}) => ({
    import_id: importId,
    created_at: serverTimestamp(),
    created_by: signer(),
    as_of_date: "2026-09-30",
    file_name: "retro.xlsx",
    scale: "porcentaje",
    replace_all: false,
    counts: { CREATE: 1 },
    previous: { IE00B4L5Y983: null },
    applied: { IE00B4L5Y983: { retro_pct: 0.45, as_of_date: "2026-09-30", source: "FILE_IMPORT" } },
    schema_version: 2,
    applied_isins: [],
    undone_isins: [],
    applied_versions: {},
    status: "partial",
    ...extra,
  });
  const importId = `smoke-${Date.now()}`;
  const importRef = doc(db, "commercial_retro_imports", importId);
  await expectPermissionDenied("foto de importación con una clave de más", () =>
    setDoc(doc(db, "commercial_retro_imports", `${importId}-x`), receipt(`${importId}-x`, { hack: true })));
  await expectPermissionDenied("foto de importación firmada por otra persona", () =>
    setDoc(doc(db, "commercial_retro_imports", `${importId}-y`), receipt(`${importId}-y`, { created_by: "otro@example.com" })));
  await expectPermissionDenied("foto de importación con fecha de creación del cliente", () =>
    setDoc(doc(db, "commercial_retro_imports", `${importId}-z`), receipt(`${importId}-z`, { created_at: new Date() })));
  await expectAllowed("foto de importación como la crea el cliente", () => setDoc(importRef, receipt(importId)));
  await expectPermissionDenied("reescribir `previous` de la foto", () =>
    updateDoc(importRef, { previous: { IE00B4L5Y983: { retro_pct: 9, as_of_date: "2026-01-01", source: "X" } } }));
  await expectPermissionDenied("reescribir `created_by` de la foto", () => updateDoc(importRef, { created_by: "otro@example.com" }));
  await expectAllowed("avance de lote (applied_isins, versiones, lotes, estado)", () =>
    updateDoc(importRef, {
      applied_isins: ["IE00B4L5Y983"],
      applied_versions: { IE00B4L5Y983: serverTimestamp() },
      applied_batches: 1,
      status: "applied",
    }));
  await expectAllowed("anotar el error de un lote", () => updateDoc(importRef, { error: "SMOKE" }));
  await expectPermissionDenied("reescribir `applied` de una foto aplicada", () =>
    updateDoc(importRef, { applied: { IE00B4L5Y983: "DELETE" } }));
  // Segunda pasada (17-10-2026): con la foto en `applied`, applied_* tampoco cambian, y el
  // deshacer va firmado por la sesión y con la hora del servidor.
  await expectPermissionDenied("reescribir `applied_versions` de una foto aplicada", () =>
    updateDoc(importRef, { applied_versions: { IE00B4L5Y983: serverTimestamp() } }));
  await expectPermissionDenied("reescribir `applied_isins` de una foto aplicada", () =>
    updateDoc(importRef, { applied_isins: [] }));
  await expectPermissionDenied("deshacer firmado por otra persona", () =>
    updateDoc(importRef, {
      undone_isins: ["IE00B4L5Y983"], status: "undone", undone_at: serverTimestamp(), undone_by: "otro@example.com",
    }));
  await expectPermissionDenied("deshacer con la hora del cliente", () =>
    updateDoc(importRef, {
      undone_isins: ["IE00B4L5Y983"], status: "undone", undone_at: new Date(), undone_by: signer(),
    }));
  await expectAllowed("deshacer la importación", () =>
    updateDoc(importRef, {
      undone_isins: ["IE00B4L5Y983"],
      status: "undone",
      undone_at: serverTimestamp(),
      undone_by: signer(),
    }));
  await expectPermissionDenied("una foto deshecha no vuelve a cambiar", () => updateDoc(importRef, { error: "otra vez" }));

  // Tercera pasada (17-10-2026), con casos de la revisión: el ciclo real con más ISIN que un
  // lote (dos lotes al aplicar y dos al deshacer, el primero desde `applied`), el error anotado
  // en `partial` y el cierre sin firma, que ya no se admite.
  const twoBatchId = `smoke-2l-${Date.now()}`;
  const twoBatchRef = doc(db, "commercial_retro_imports", twoBatchId);
  await expectAllowed("foto sin nombre de fichero (file_name null)", () =>
    setDoc(twoBatchRef, receipt(twoBatchId, { file_name: null, previous: { A: null, B: null }, applied: { A: "DELETE", B: "DELETE" } })));
  await expectAllowed("lote 1 (partial -> partial)", () =>
    updateDoc(twoBatchRef, { applied_isins: ["A"], applied_versions: { A: serverTimestamp() }, applied_batches: 1, status: "partial" }));
  await expectAllowed("anotar el error con la foto en partial", () => updateDoc(twoBatchRef, { error: "lote 2 falló" }));
  await expectAllowed("lote 2 (partial -> applied)", () =>
    updateDoc(twoBatchRef, {
      applied_isins: ["A", "B"], applied_versions: { A: serverTimestamp(), B: serverTimestamp() }, applied_batches: 2, status: "applied",
    }));
  await expectAllowed("deshacer parcial desde applied (solo undone_isins)", () => updateDoc(twoBatchRef, { undone_isins: ["A"] }));
  await expectPermissionDenied("applied: cambiar applied_batches", () => updateDoc(twoBatchRef, { applied_batches: 3 }));
  await expectPermissionDenied("applied: volver a partial", () => updateDoc(twoBatchRef, { status: "partial" }));
  await expectPermissionDenied("applied: undone_by firmado por otro sin cerrar", () => updateDoc(twoBatchRef, { undone_by: "otro" }));
  await expectPermissionDenied("applied: undone_at del cliente sin cerrar", () => updateDoc(twoBatchRef, { undone_at: new Date() }));
  await expectPermissionDenied("cerrar en undone solo con status (sin hora ni firma)", () =>
    updateDoc(twoBatchRef, { status: "undone" }));
  await expectPermissionDenied("cerrar en undone sin firma", () =>
    updateDoc(twoBatchRef, { undone_isins: ["A", "B"], status: "undone", undone_at: serverTimestamp() }));
  await expectPermissionDenied("cerrar en undone sin la hora del cierre", () =>
    updateDoc(twoBatchRef, { undone_isins: ["A", "B"], status: "undone", undone_by: signer() }));
  await expectAllowed("cierre del deshacer en el segundo lote", () =>
    updateDoc(twoBatchRef, { undone_isins: ["A", "B"], status: "undone", undone_at: serverTimestamp(), undone_by: signer() }));
  await expectPermissionDenied("undone: borrar undone_by", () => updateDoc(twoBatchRef, { undone_by: deleteField() }));

  // S-08 (auditoría 29-09): av_* exige claim admin + correo verificado (antes, lista de correos).
  const avRef = doc(db, "av_watchlist", `smoke-${Date.now()}`);
  await expectPermissionDenied("admin con correo sin verificar escribe av_watchlist", () => setDoc(avRef, { ticker: "SAN" }));
  await markEmailVerified(authTarget, projectId, adminUid, adminEmail);
  await auth.currentUser.getIdToken(true);
  // Con correo en el token, la foto se firma con el correo (rama `request.auth.token.email`).
  const emailImportId = `smoke-email-${Date.now()}`;
  await expectAllowed("foto de importación firmada con el correo del token", () =>
    setDoc(doc(db, "commercial_retro_imports", emailImportId), receipt(emailImportId, { created_by: adminEmail })));
  await expectPermissionDenied("foto de importación firmada con el uid de otra cuenta", () =>
    setDoc(doc(db, "commercial_retro_imports", `${emailImportId}-x`), receipt(`${emailImportId}-x`, { created_by: "admin-otro" })));
  // Deshacer parcial y luego completo desde `partial`, firmado con el correo del token.
  const emailImportRef = doc(db, "commercial_retro_imports", emailImportId);
  await expectAllowed("avance de lote que deja la foto en partial", () =>
    updateDoc(emailImportRef, {
      applied_isins: ["IE00B4L5Y983"], applied_versions: { IE00B4L5Y983: serverTimestamp() }, applied_batches: 1, status: "partial",
    }));
  await expectAllowed("deshacer parcial (solo undone_isins)", () => updateDoc(emailImportRef, { undone_isins: ["IE00B4L5Y983"] }));
  await expectAllowed("cerrar el deshacer firmado con el correo del token", () =>
    updateDoc(emailImportRef, { status: "undone", undone_at: serverTimestamp(), undone_by: adminEmail }));
  await expectAllowed("admin con correo verificado escribe av_watchlist", () => setDoc(avRef, { ticker: "SAN" }));
  await expectAllowed("admin con correo verificado lee av_watchlist", () => getDocFromServer(avRef));
  await signOut(auth);
  await createUserWithEmailAndPassword(auth, `noadmin-av-${Date.now()}@example.com`, "password-123456");
  await expectPermissionDenied("usuario sin claim lee av_watchlist", () => getDocFromServer(avRef));
  await expectPermissionDenied("usuario sin claim escribe av_informes", () => setDoc(doc(db, "av_informes", "smoke"), { ticker: "SAN" }));
  await signOut(auth);
  await terminate(db);
  await deleteApp(app);

}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});
