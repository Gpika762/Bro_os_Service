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

app.use(express.json()); // Necesario para leer JSON en POST requests
app.use(express.static(path.join(__dirname, 'public')));

// ===============================================
// CONEXIÓN A BASE DE DATOS (MongoDB Atlas)
// ===============================================
mongoose.connect(process.env.DATABASE_URL)
  .then(() => console.log('✅ Conectado a MongoDB Atlas (Bro OS DB)'))
  .catch(err => console.error('❌ Error de conexión a Mongo:', err));

// Esquema de Usuario (Actualizado con Estado y Amigos)
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true }, // Guardaremos el HASH, no la clave real
  status: { type: String, default: 'offline' }, // online, offline, busy, away
  friends: [{ type: String }], // Lista de usuarios agregados como amigos
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Diccionario en memoria para rastrear sockets activos: { username: socket.id }
const activeSockets = new Map();

// ===============================================
// 1. UPDATES - APARTADO PRIVADO (Con API Key)
// ===============================================
const requireUpdateToken = (req, res, next) => {
  const token = req.header('X-BroOS-Update-Token'); // La app C# debe enviar esta cabecera
  if (!token || token !== process.env.UPDATE_API_KEY) {
    return res.status(403).json({ error: "Acceso denegado. Token de actualización inválido." });
  }
  next();
};

app.get('/api/updates/check', requireUpdateToken, (req, res) => {
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

    if (!username || !password || username.length < 3 || password.length < 6) {
      return res.status(400).json({ error: "Datos inválidos. Usuario (min 3) y Clave (min 6)." });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(409).json({ error: "Ese nombre de usuario ya está pillado, bro." });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

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

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: "Usuario o contraseña incorrectos." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Usuario o contraseña incorrectos." });
    }

    console.log(`[Cuentas] Login exitoso: ${username}`);
    res.json({ 
      message: "Login correcto", 
      username: user.username,
      token: "AQUÍ_GENERARIAMOS_UN_JWT_TOKEN_PARA_BROTALK_LUEGO"
    });

  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: "Error interno del servidor al loguear." });
  }
});

// ===============================================
// 3. BACKEND PARA BRO TALK (WebSockets en Tiempo Real)
// ===============================================
io.on('connection', (socket) => {
  let authenticatedUser = null;
  console.log(`[Bro Talk] Nueva conexión WebSocket ID: ${socket.id}`);

  // A. AUTENTICAR CONEXIÓN DE SOCKET
  socket.on('authenticate', async (data) => {
    try {
      const { username, password } = data;
      const user = await User.findOne({ username });

      if (!user) {
        return socket.emit('auth_result', { success: false, error: 'Usuario no encontrado.' });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return socket.emit('auth_result', { success: false, error: 'Contraseña incorrecta.' });
      }

      // Autenticación correcta
      authenticatedUser = user.username;
      activeSockets.set(authenticatedUser, socket.id);

      // Cambiar estado a ONLINE en la BD
      user.status = 'online';
      await user.save();

      // Responder al usuario con sus datos y lista de amigos
      socket.emit('auth_result', {
        success: true,
        username: user.username,
        friends: user.friends,
        status: user.status
      });

      // Notificar a todos sus amigos que se conectó
      notifyFriendsStatus(user.username, user.friends, 'online');
      console.log(`[Bro Talk] Usuario autenticado y ONLINE: ${user.username}`);

    } catch (err) {
      console.error('Error en autenticación WebSocket:', err);
      socket.emit('auth_result', { success: false, error: 'Error en el servidor.' });
    }
  });

  // B. CHAT GENERAL (Broadcast público)
  socket.on('send_message', (data) => {
    console.log(`[Bro Talk Public] ${data.username}: ${data.message}`);
    
    io.emit('receive_message', {
      username: data.username || authenticatedUser || 'Anónimo',
      message: data.message,
      timestamp: new Date().toLocaleTimeString()
    });
  });

  // C. MENSAJES PRIVADOS Y ZUMBIDOS
  socket.on('send_private_message', (data) => {
    if (!authenticatedUser) {
      return socket.emit('error_msg', { message: 'Inicia sesión primero.' });
    }

    const { targetUser, message, type } = data; // type: 'text' o 'nudge'
    const targetSocketId = activeSockets.get(targetUser);

    const payload = {
      from: authenticatedUser,
      message: message,
      type: type || 'text',
      timestamp: new Date().toLocaleTimeString()
    };

    if (targetSocketId) {
      // Enviar directamente al socket del amigo
      io.to(targetSocketId).emit('receive_private_message', payload);
      socket.emit('message_sent_status', { targetUser, delivered: true });
    } else {
      // El amigo está Offline
      socket.emit('message_sent_status', { targetUser, delivered: false, note: 'Usuario no está en línea' });
    }
  });

  // D. CAMBIAR ESTADO (online, busy, away)
  socket.on('change_status', async (data) => {
    if (!authenticatedUser) return;
    const { newStatus } = data;

    const user = await User.findOne({ username: authenticatedUser });
    if (user) {
      user.status = newStatus;
      await user.save();
      notifyFriendsStatus(user.username, user.friends, newStatus);
    }
  });

  // E. HEARTBEAT / PING
  socket.on('ping_check', () => {
    socket.emit('pong_check', { timestamp: Date.now() });
  });

  // F. DESCONEXIÓN
  socket.on('disconnect', async () => {
    if (authenticatedUser) {
      activeSockets.delete(authenticatedUser);

      const user = await User.findOne({ username: authenticatedUser });
      if (user) {
        user.status = 'offline';
        await user.save();
        notifyFriendsStatus(user.username, user.friends, 'offline');
      }
      console.log(`[Bro Talk] Usuario desconectado: ${authenticatedUser}`);
    } else {
      console.log(`[Bro Talk] Conexión cerrada ID: ${socket.id}`);
    }
  });
});

// Función auxiliar para notificar cambios de estado a amigos
async function notifyFriendsStatus(username, friendsList, status) {
  if (!friendsList || friendsList.length === 0) return;
  
  friendsList.forEach(friendName => {
    const friendSocketId = activeSockets.get(friendName);
    if (friendSocketId) {
      io.to(friendSocketId).emit('friend_status_change', {
        friendUsername: username,
        newStatus: status
      });
    }
  });
}

// Arrancar servidor
server.listen(PORT, () => {
  console.log(`🚀 Servidor central de Bro OS corriendo en el puerto ${PORT}`);
});
