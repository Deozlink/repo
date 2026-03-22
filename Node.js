import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import voiceRoutes from "./routes/voice.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api/voice", voiceRoutes);

const PORT = process.env.PORT || 3000;  // Render asigna un puerto
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));