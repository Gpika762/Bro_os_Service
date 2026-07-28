require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;

// ===============================================
// MIDDLEWARES
// ===============================================
app.use(express.json()); // Necesario para leer JSON en POST requests
app.use(express.static(path.join(__dirname, 'public')));

// ===============================================
// CONEXIÓN A BASE DE DATOS (MongoDB Atlas)
// ===============================================
// DATABASE_URL debe estar en tu archivo .env
mongoose.connect(process.env.DATABASE_URL)
  .then(() => console.log('✅ Conectado a MongoDB Atlas (Bro OS DB)'))
  .catch(err => console.error('❌ Error de conexión a Mongo:', err));

// Esquema de Usuario (Define qué guardamos de cada cuenta)
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true }, // Guardaremos el HASH, no la clave real
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// ===============================================
// 1. UPDATES - APARTADO PRIVADO (Con API Key)
// ===============================================
// Middleware para verificar la seguridad del Update
const requireUpdateToken = (req, res, next) => {
  const token = req.header('X-BroOS-Update-Token'); // La app C# debe enviar esta cabecera
  if (!token || token !== process.env.UPDATE_API_KEY) {
    return res.status(403).json({ error: "Acceso denegado. Token de actualización inválido." });
  }
  next(); // Si el token es correcto, continua
};

// Petición de check de update protegida
app.get('/api/updates/check', requireUpdateToken, (req, res) => {
  // Aquí pones tus links reales de descarga
  res.json({
    latestVersion: "1.0.5",
    downloadUrl_x64: "https://turing-links.com/download/BroOS_105_x64.exe", 
    downloadUrl_x86: "https://turing-links.com/download/BroOS_105_x86.exe",
    mandatory: true,
    changelog: "Actualización de seguridad para Bro Talk."
  });
});

// ===============================================
// 2. CUENTAS - APARTADO PÚBLICO (MongoDB)
// ===============================================

// A. REGISTRO DE NUEVA CUENTA
app.post('/api/accounts/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validaciones básicas
    if (!username || !password || username.length < 3 || password.length < 6) {
      return res.status(400).json({ error: "Datos inválidos. Usuario (min 3) y Clave (min 6)." });
    }

    // Verificar si el usuario ya existe
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(409).json({ error: "Ese nombre de usuario ya está pillado, bro." });
    }

    // ENCRIPTAR CONTRASEÑA (Seguridad total)
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Crear y guardar usuario
    const newUser = new User({ username, password: hashedPassword });
    await newUser.save();

    console.log(`[Cuentas] Nuevo usuario registrado: ${username}`);
    res.status(201).json({ message: "¡Bro Account creada con éxito!", username });

  } catch (error) {
    console.error('Error en registro:', error);
    res.status(500).json({ error: "Error interno del servidor al crear la cuenta." });
  }
});

// B. LOGIN DE CUENTA (Para Bro Talk / App C#)
app.post('/api/accounts/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Faltan usuario o contraseña." });
    }

    // Buscar usuario
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: "Usuario o contraseña incorrectos." });
    }

    // Comparar contraseñas
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Usuario o contraseña incorrectos." });
    }

    // Login exitoso
    console.log(`[Cuentas] Login exitoso: ${username}`);
    res.json({ 
      message: "Login correcto", 
      username: user.username,
      token: "AQUÍ_GENERARIAMOS_UN_JWT_TOKEN_PARA_BROTALK_LUEGO" // Por ahora simulado
    });

  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: "Error interno del servidor al loguear." });
  }
});

// ===============================================
// 3. BACKEND PARA BRO TALK (WebSockets)
// ===============================================
// (Por ahora público, luego pediremos el token de login aquí)
io.on('connection', (socket) => {
  console.log(`[Bro Talk] Usuario conectado con ID: ${socket.id}`);

  socket.on('send_message', (data) => {
    // data debe incluir { username, password, message } para validar luego
    console.log(`[Bro Talk] ${data.username}: ${data.message}`);
    
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
  console.log(`🚀 Servidor central de Bro OS corriendo en el puerto ${PORT}`);
});
