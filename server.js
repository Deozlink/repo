// ─── server.js — PayTrack Voice API v3 ──────────────────────────────────────
// Servidor desplegado en Oregon (US West) → UTC-7 / Pacific Time
// El frontend (CDMX, UTC-6) envía la hora ya ajustada -1h (Oregon es 1h atrás de CDMX).
// Ej: usuario programa 09:00 CDMX → frontend envía 08:00 → servidor dispara 08:00 Oregon = 09:00 CDMX ✓
// Todos los endpoints son GET con query params para evitar preflight CORS.
// Esto permite llamarlos desde archivos HTML locales (file://) sin bloqueos.
//
// GET /api/voice/disparar?url=...        → dispara Voice Monkey de inmediato
// GET /api/voice/programar?url=...&fecha=...&hora=...&tarjeta=...&id=...
//                                        → agenda alerta para fecha/hora
// GET /api/voice/cancelar?id=...         → cancela alerta agendada
// GET /api/voice/alertas                 → lista alertas (debug)
// GET /                                  → health check
// ─────────────────────────────────────────────────────────────────────────────
import express from "express";
import cors    from "cors";
import dotenv  from "dotenv";
import fetch   from "node-fetch";

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 3000;

// CORS abierto — necesario para que el browser lea la respuesta GET
app.use(cors({ origin: "*" }));
app.use(express.json()); // por si acaso llega algún POST en el futuro

// ── Alertas en memoria ───────────────────────────────────────────────────────
const alertas = new Map();

// ── ms hasta fecha+hora local del servidor ───────────────────────────────────
function msHasta(fecha, hora) {
  const [y, m, d] = fecha.split("-").map(Number);
  const [hh, mm]  = hora.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime() - Date.now();
}

// ── Llamar a Voice Monkey (desde el servidor, sin CORS) ──────────────────────
async function llamarVoiceMonkey(url) {
  const res  = await fetch(url);
  const body = await res.text();
  if (!res.ok) throw new Error(`VoiceMonkey ${res.status}: ${body}`);
  return body;
}

// ── Agendar setTimeout ───────────────────────────────────────────────────────
function agendarAlerta(alerta) {
  const ms = msHasta(alerta.fecha, alerta.hora);
  if (ms < 0) { alerta.estado = "vencida"; return; }

  console.log(`[AGENDA] ${alerta.tarjeta} → ${alerta.fecha} ${alerta.hora} Oregon (en ${Math.round(ms/1000)}s) | Ahora servidor: ${new Date().toLocaleTimeString('es-MX',{timeZone:'America/Los_Angeles'})}`);

  alerta.timerId = setTimeout(async () => {
    console.log(`[DISPARO] ${alerta.tarjeta} a las ${new Date().toLocaleString()}`);
    try {
      const r = await llamarVoiceMonkey(alerta.url);
      console.log(`[OK] ${r}`);
      alerta.estado      = "ejecutada";
      alerta.ejecutadaEn = new Date().toISOString();
    } catch (e) {
      console.error(`[ERROR] ${e.message}`);
      alerta.estado = "error";
      alerta.error  = e.message;
    }
    alerta.timerId = null;
    alertas.set(alerta.id, alerta);
  }, ms);

  alerta.estado = "programada";
}

// ════════════════════════════════════════════════════════════════════════════
// GET /api/voice/disparar?url=...
// Dispara Voice Monkey de inmediato — GET simple, sin preflight CORS
// ════════════════════════════════════════════════════════════════════════════
app.get("/api/voice/disparar", async (req, res) => {
  console.log("📥 GET /disparar recibido:", {
    device: (() => { try { return new URL(req.query.url||"").searchParams.get("device"); } catch { return "?"; } })(),
    timestamp: new Date().toISOString(),
  });
  const { url } = req.query;

  if (!url || !url.startsWith("https://api-v2.voicemonkey.io/")) {
    return res.json({ ok: false, error: "URL de VoiceMonkey inválida" });
  }

  try {
    const r = await llamarVoiceMonkey(url);
    console.log(`[DISPARAR] OK → device: ${new URL(url).searchParams.get("device")}`);
    return res.json({ ok: true, respuesta: r });
  } catch (e) {
    console.error(`[DISPARAR] ERROR: ${e.message}`);
    return res.json({ ok: false, error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/voice/programar?url=...&fecha=YYYY-MM-DD&hora=HH:MM&tarjeta=...&id=...
// Agenda alerta — GET simple, sin preflight CORS
// ════════════════════════════════════════════════════════════════════════════
app.get("/api/voice/programar", (req, res) => {
  console.log("📥 GET /programar recibido:", {
    ...req.query,
    url: req.query.url ? req.query.url.substring(0,60)+"..." : undefined, // no loggear token completo
    timestamp: new Date().toISOString(),
    horaOregon: new Date().toLocaleString("es-MX",{timeZone:"America/Los_Angeles"}),
  });
  const { url, fecha, hora, tarjeta, id } = req.query;

  if (!url || !url.startsWith("https://api-v2.voicemonkey.io/"))
    return res.json({ ok: false, error: "URL de VoiceMonkey inválida" });
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha))
    return res.json({ ok: false, error: "fecha inválida (YYYY-MM-DD)" });
  if (!hora || !/^\d{2}:\d{2}$/.test(hora))
    return res.json({ ok: false, error: "hora inválida (HH:MM)" });

  const ms = msHasta(fecha, hora);
  if (ms < -60000)
    return res.json({ ok: false, error: `Fecha/hora ya pasó (hace ${Math.round(-ms/1000)}s)` });

  const alertaId = id || `${Date.now()}-${Math.random().toString(36).slice(2,6)}`;

  // Cancelar alerta previa con el mismo id
  if (alertas.has(alertaId)) {
    const prev = alertas.get(alertaId);
    if (prev.timerId) clearTimeout(prev.timerId);
  }

  const alerta = {
    id: alertaId,
    url, fecha, hora,
    tarjeta:  tarjeta || "—",
    timerId:  null,
    estado:   "pendiente",
    creadaEn: new Date().toISOString(),
  };

  agendarAlerta(alerta);
  alertas.set(alertaId, alerta);

  console.log(`[PROGRAMAR] id=${alertaId} tarjeta=${alerta.tarjeta} ${fecha} ${hora} (en ${Math.max(0,Math.round(ms/1000))}s)`);
  return res.json({ ok: true, id: alertaId, estado: alerta.estado, msHasta: Math.max(ms, 0) });
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/voice/cancelar?id=...
// Cancela alerta — GET simple para evitar preflight CORS
// ════════════════════════════════════════════════════════════════════════════
app.get("/api/voice/cancelar", (req, res) => {
  console.log("📥 GET /cancelar recibido:", { id: req.query.id, timestamp: new Date().toISOString() });
  const { id } = req.query;
  const alerta = alertas.get(id);

  if (!alerta) return res.json({ ok: false, error: "Alerta no encontrada" });

  if (alerta.timerId) { clearTimeout(alerta.timerId); alerta.timerId = null; }
  alerta.estado = "cancelada";
  alertas.set(id, alerta);

  console.log(`[CANCELAR] id=${id}`);
  return res.json({ ok: true, id, estado: "cancelada" });
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/voice/alertas — lista alertas (debug)
// ════════════════════════════════════════════════════════════════════════════
app.get("/api/voice/alertas", (_req, res) => {
  const lista = [...alertas.values()].map(a => ({
    id:          a.id,
    tarjeta:     a.tarjeta,
    fecha:       a.fecha,
    hora:        a.hora,
    estado:      a.estado,
    creadaEn:    a.creadaEn,
    ejecutadaEn: a.ejecutadaEn || null,
    error:       a.error || null,
    device: (() => { try { return new URL(a.url).searchParams.get("device"); } catch { return "?"; } })(),
  }));
  return res.json({ ok: true, total: lista.length, alertas: lista });
});

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  const ahora = new Date();
  return res.json({
  servicio: "PayTrack Voice API",
  version:  "3.0.0",
  horaServidor: ahora.toLocaleString("es-MX", { timeZone: "America/Los_Angeles" }) + " (Oregon/Pacific)",
  horaUTC: ahora.toISOString(),
  nota: "Recibe hora ajustada -1h desde CDMX (Oregon 1h atrás de CDMX)",
  nota:     "Todos los endpoints son GET para evitar preflight CORS desde file://",
  alertasEnMemoria: alertas.size,
  endpoints: [
    "GET /api/voice/disparar?url=...",
    "GET /api/voice/programar?url=...&fecha=YYYY-MM-DD&hora=HH:MM&tarjeta=...&id=...",
    "GET /api/voice/cancelar?id=...",
    "GET /api/voice/alertas",
  ],
});
});

app.listen(PORT, () => {
  console.log(`\n🚀 PayTrack Voice API v3 → puerto ${PORT}`);
  console.log('🕐 Servidor iniciado:', new Date().toISOString());
  console.log('🌍 Hora Oregon/Pacific:', new Date().toLocaleString('es-MX', {timeZone:'America/Los_Angeles'}));
  console.log(`   GET /api/voice/disparar?url=...`);
  console.log(`   GET /api/voice/programar?url=...&fecha=...&hora=...`);
  console.log(`   GET /api/voice/cancelar?id=...`);
  console.log(`   GET /api/voice/alertas\n`);
});
