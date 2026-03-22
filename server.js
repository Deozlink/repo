// ─── server.js — PayTrack Voice API ─────────────────────────────────────────
// Endpoints:
//   POST /api/voice/disparar  → dispara Voice Monkey de inmediato
//   POST /api/voice/programar → agenda alerta para fecha/hora específica
//   GET  /api/voice/alertas   → lista alertas (debug/monitoreo)
//   DELETE /api/voice/alertas/:id → cancela una alerta agendada
// ─────────────────────────────────────────────────────────────────────────────
import express from "express";
import cors    from "cors";
import dotenv  from "dotenv";
import fetch   from "node-fetch";

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: "*", methods: ["GET","POST","DELETE","OPTIONS"], allowedHeaders: ["Content-Type"] }));
app.use(express.json());

// ── Alertas en memoria (Map sobrevive mientras el proceso corre en Render) ───
// { id, url, fecha, hora, tarjeta, timerId, estado, creadaEn, ejecutadaEn, error }
const alertas = new Map();

// ── ms hasta fecha+hora local del servidor ───────────────────────────────────
function msHasta(fecha, hora) {
  const [y, m, d]  = fecha.split("-").map(Number);
  const [hh, mm]   = hora.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime() - Date.now();
}

// ── Llamar a Voice Monkey desde el backend (sin CORS, sin restricciones) ─────
async function llamarVoiceMonkey(url) {
  const res  = await fetch(url);
  const body = await res.text();
  if (!res.ok) throw new Error(`VoiceMonkey ${res.status}: ${body}`);
  return body;
}

// ── Agendar setTimeout para una alerta ───────────────────────────────────────
function agendarAlerta(alerta) {
  const ms = msHasta(alerta.fecha, alerta.hora);
  if (ms < 0) { alerta.estado = "vencida"; return; }

  console.log(`[AGENDA] ${alerta.tarjeta} → ${alerta.fecha} ${alerta.hora} (en ${Math.round(ms/1000)}s)`);

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
// POST /api/voice/disparar
// Body: { url }  ← URL completa de VoiceMonkey con token y device
// Dispara inmediatamente desde el backend (sin CORS, sin token expuesto)
// ════════════════════════════════════════════════════════════════════════════
app.post("/api/voice/disparar", async (req, res) => {
  const { url } = req.body;
  if (!url?.startsWith("https://api-v2.voicemonkey.io/"))
    return res.status(400).json({ ok: false, error: "URL de VoiceMonkey inválida" });

  try {
    const r = await llamarVoiceMonkey(url);
    console.log(`[DISPARAR] OK`);
    return res.json({ ok: true, respuesta: r });
  } catch (e) {
    console.error(`[DISPARAR] ERROR: ${e.message}`);
    return res.status(502).json({ ok: false, error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/voice/programar
// Body: { url, fecha, hora, tarjeta?, id? }
//   url    → URL VoiceMonkey completa (con token)
//   fecha  → "YYYY-MM-DD"
//   hora   → "HH:MM" (24h, zona del servidor)
//   tarjeta→ nombre de la tarjeta (para logs)
//   id     → id de la alerta (para re-programar o identificar)
// ════════════════════════════════════════════════════════════════════════════
app.post("/api/voice/programar", (req, res) => {
  const { url, fecha, hora, tarjeta, id } = req.body;

  if (!url?.startsWith("https://api-v2.voicemonkey.io/"))
    return res.status(400).json({ ok: false, error: "URL de VoiceMonkey inválida" });
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha))
    return res.status(400).json({ ok: false, error: "fecha inválida (YYYY-MM-DD)" });
  if (!hora || !/^\d{2}:\d{2}$/.test(hora))
    return res.status(400).json({ ok: false, error: "hora inválida (HH:MM)" });

  const ms = msHasta(fecha, hora);
  if (ms < -60000)
    return res.status(400).json({ ok: false, error: `Fecha/hora ya pasó (hace ${Math.round(-ms/1000)}s)` });

  // Cancelar alerta previa con el mismo id si existe
  const alertaId = id || `${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
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

  console.log(`[PROGRAMAR] id=${alertaId} tarjeta=${alerta.tarjeta} ${fecha} ${hora}`);
  return res.json({ ok: true, id: alertaId, estado: alerta.estado, msHasta: Math.max(ms, 0) });
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/voice/alertas — lista alertas (para debug desde el frontend)
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
    // No exponer URL completa (tiene token) — solo el device
    device: (() => { try { return new URL(a.url).searchParams.get("device"); } catch { return "?"; } })(),
  }));
  res.json({ ok: true, total: lista.length, alertas: lista });
});

// ════════════════════════════════════════════════════════════════════════════
// DELETE /api/voice/alertas/:id — cancela alerta pendiente
// ════════════════════════════════════════════════════════════════════════════
app.delete("/api/voice/alertas/:id", (req, res) => {
  const alerta = alertas.get(req.params.id);
  if (!alerta) return res.status(404).json({ ok: false, error: "Alerta no encontrada" });

  if (alerta.timerId) { clearTimeout(alerta.timerId); alerta.timerId = null; }
  alerta.estado = "cancelada";
  alertas.set(alerta.id, alerta);

  console.log(`[CANCELAR] id=${alerta.id}`);
  return res.json({ ok: true, id: alerta.id, estado: "cancelada" });
});

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/", (_req, res) => res.json({
  servicio: "PayTrack Voice API",
  version:  "2.0.0",
  alertasEnMemoria: alertas.size,
  endpoints: ["POST /api/voice/disparar","POST /api/voice/programar","GET /api/voice/alertas","DELETE /api/voice/alertas/:id"],
}));

app.listen(PORT, () => {
  console.log(`\n🚀 PayTrack Voice API → puerto ${PORT}`);
  console.log(`   POST   /api/voice/disparar`);
  console.log(`   POST   /api/voice/programar`);
  console.log(`   GET    /api/voice/alertas`);
  console.log(`   DELETE /api/voice/alertas/:id\n`);
});
