import { setDemoClock } from "../src/adapters/demoBackend";

// El simulador demo genera series desde «hoy» y salta sábados y domingos: sin reloj fijo, las pruebas
// daban otro resultado según el día. Se fija al viernes 06-11-2026 (laborable) en todas las suites.
// Las que fijan su propio reloj con vi.setSystemTime pueden usar setDemoClock(null) para volver a «ahora».
setDemoClock(() => new Date("2026-11-06T12:00:00Z"));
