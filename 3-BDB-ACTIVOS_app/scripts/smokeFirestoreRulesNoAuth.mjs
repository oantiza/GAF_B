import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initializeApp } from "firebase/app";
import { doc, getDoc, getFirestore } from "firebase/firestore";

function loadEnvFile(fileName) {
  const filePath = resolve(process.cwd(), fileName);
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [rawKey, ...rawValue] = trimmed.split("=");
    const key = rawKey.trim();
    if (process.env[key]) continue;
    process.env[key] = rawValue.join("=").trim().replace(/^["']|["']$/g, "");
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env.production");

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  throw new Error("Falta config web Firebase VITE_FIREBASE_* para ejecutar el smoke de reglas.");
}

// El proyecto sale de los .env, como en src/firebaseEnv.ts, y aqui tampoco se abre el de BDB.
const PROYECTO_DE_BDB = "bbdd-activos-financieros";
if (firebaseConfig.projectId === PROYECTO_DE_BDB) {
  throw new Error("Esa configuracion es la del proyecto de BDB: esta en uso, y desde aqui no se toca.");
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

try {
  await getDoc(doc(db, "assets", "smoke-no-auth"));
  throw new Error("SMOKE_FAIL: assets/ permitio lectura sin auth.");
} catch (error) {
  if (error?.code === "permission-denied") {
    console.log("SMOKE_OK: assets/ deniega lectura sin auth.");
    process.exit(0);
  }
  throw error;
}
