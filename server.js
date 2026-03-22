// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// 🚀 Ruta raíz
app.get("/", (req, res) => {
  res.send("Servidor Voice API en Render está funcionando ✅");
});

// 🧪 Endpoint de prueba
app.get("/api/voice/test", (req, res) => {
  res.json({
    mensaje: "API funcionando correctamente",
    timestamp: new Date()
  });
});

// 🔔 Endpoint para disparar Voice Monkey
app.post("/api/voice/disparar", async (req, res) => {
  const { url } = req.body || {};

  // Usa la URL de la variable de entorno si no envían una
  const voiceUrl = url || process.env.VOICE_URL;

  if (!voiceUrl) {
    return res.status(400).json({ error: "No hay URL de Voice Monkey configurada" });
  }

  try {
    const response = await fetch(voiceUrl);
    res.json({
      mensaje: "Voice Monkey disparado correctamente ✅",
      status: response.status
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 🔥 Puerto dinámico para Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
