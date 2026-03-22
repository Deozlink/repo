// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Endpoint de prueba
app.get("/api/voice/test", (req, res) => {
  res.json({
    mensaje: "API funcionando correctamente",
    timestamp: new Date()
  });
});

// Usa el puerto que Render asigna
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
