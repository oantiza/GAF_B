import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";

/*
 * Lo que la app sabe de un precio congelado (decisión de Óscar del 12-11-2026: NH Hotel Group se queda dado de alta,
 * valorado a su último precio). Sale de la política del servidor, `functions_python/fund_history_policies.json`, y no de
 * una lista escrita en la app: quien lleve la marca `PRICE_FROZEN_DELISTED` con su `frozen_price` es el caso, y nadie más.
 * El fichero entero no entra en el paquete —lleva las notas de cada revisión—: solo el ISIN, la fecha y el precio.
 */
const MODULO_DE_PRECIOS_CONGELADOS = "virtual:precios-congelados";
/* La carpeta de la app, con barras normales: los patrones de vigilancia de ficheros se escriben así también en Windows. */
const RAIZ_DE_LA_APP = fileURLToPath(new URL(".", import.meta.url)).replace(/\\/g, "/").replace(/\/$/, "");
const POLITICAS_DEL_HISTORICO = fileURLToPath(new URL("./functions_python/fund_history_policies.json", import.meta.url));

interface PoliticaDelHistorico {
  flags?: string[];
  frozen_price?: { from?: string; value?: number };
}

function preciosCongelados(): Plugin {
  const resuelto = `\0${MODULO_DE_PRECIOS_CONGELADOS}`;
  return {
    name: "precios-congelados",
    resolveId: (id) => (id === MODULO_DE_PRECIOS_CONGELADOS ? resuelto : undefined),
    load(id) {
      if (id !== resuelto) return undefined;
      this.addWatchFile(POLITICAS_DEL_HISTORICO);
      const { assets } = JSON.parse(readFileSync(POLITICAS_DEL_HISTORICO, "utf8")) as { assets: Record<string, PoliticaDelHistorico> };
      const congelados = Object.fromEntries(
        Object.entries(assets)
          .filter(([, politica]) => (politica.flags ?? []).includes("PRICE_FROZEN_DELISTED"))
          .map(([isin, politica]) => [isin, { desde: politica.frozen_price?.from ?? null, valor: politica.frozen_price?.value ?? null }])
      );
      return `export default ${JSON.stringify(congelados)};`;
    }
  };
}

function chunkName(id: string): string | undefined {
  const normalized = id.replace(/\\/g, "/");

  if (normalized.includes("/node_modules/@react-pdf/")) {
    return "react-pdf";
  }

  if (normalized.includes("/node_modules/firebase/")) {
    return "firebase";
  }

  if (
    normalized.includes("/node_modules/react") ||
    normalized.includes("/node_modules/react-dom") ||
    normalized.includes("/node_modules/scheduler") ||
    normalized.includes("jsx-runtime")
  ) {
    return "react";
  }

  return undefined;
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), preciosCongelados()],
  server: {
    // Puerto propio del clon Gestor Activos Financieros: BDB usa el 5173 y los
    // dos proyectos pueden estar levantados a la vez sin pisarse.
    port: 5174,
    strictPort: true,
    watch: {
      // Generated data, Python environments and other checkouts are not UI sources.
      ignored: [
        "**/output/**", "**/outputs/**", `${RAIZ_DE_LA_APP}/.claude/**`, "**/functions_python/**",
        "**/tmp/**", "**/dist/**", "**/audit-ui/**", "**/artifacts/**", "**/_to_delete/**"
      ]
    }
  },
  test: {
    // Fija el reloj del simulador demo a un día laborable: ver tests/setupRelojDemo.ts.
    // Y corta la red: ninguna prueba llama de verdad a un emulador ni a nadie (tests/setupSinRed.ts).
    setupFiles: ["./tests/setupRelojDemo.ts", "./tests/setupSinRed.ts"],
    // Solo la suite real: sin esto, vitest recoge copias sueltas de tests en
    // carpetas de trabajo (tmp/zNx/...) y el comando falla con 8 suites rotas
    // aunque los 443 tests pasen.
    exclude: [
      "node_modules/**",
      "dist/**",
      "tmp/**",
      "_to_delete/**",
      "_to_delete_auditoria/**",
      "runs/**",
      "output/**",
      // Worktrees de otras sesiones (.claude/worktrees/*): llevan su propia copia
      // de la suite y no deben contarse como tests de este arbol.
      ".claude/**"
    ]
  },
  build: {
    // El motor PDF es deliberadamente diferido. El presupuesto de la carga inicial
    // se verifica aparte con scripts/checkInitialBundleBudget.mjs.
    chunkSizeWarningLimit: 1450,
    rollupOptions: {
      output: {
        manualChunks: chunkName
      }
    }
  }
});
