require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Configuración de middlewares
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===============================================
// 1. ENDPOINT DE ACTUALIZACIONES (UPDATES)
// ===============================================
app.get('/api/updates/check', (req, res) => {
  res.json({
    latestVersion: "1.0.0",
    downloadUrl: "https://bro-os.onrender.com/downloads/BroOS_v1.0.0.exe",
    mandatory: false,
    changelog: "¡Lanzamiento oficial de la alfa de Bro OS!"
  });
});

// ===============================================
// 2. BACKEND PARA BRO TALK (WEBSOCKETS)
// ===============================================
io.on('connection', (socket) => {
  console.log(`[Bro Talk] Usuario conectado con ID: ${socket.id}`);

  // Cuando un usuario envía un mensaje
  socket.on('send_message', (data) => {
    console.log(`[Bro Talk] ${data.username}: ${data.message}`);
    
    // Reemitir el mensaje a todos los clientes conectados
    io.emit('receive_message', {
      username: data.username || 'Anónimo',
      message: data.message,
      timestamp: new Date().toLocaleTimeString()
    });
  });

  socket.on('disconnect', () => {
    console.log(`[Bro Talk] Usuario desconectado: ${socket.id}`);
  });
});

// Arrancar servidor
server.listen(PORT, () => {
  console.log(`🚀 Servidor de Bro OS corriendo en http://localhost:${PORT}`);
});
