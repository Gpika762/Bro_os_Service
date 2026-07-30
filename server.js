require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===============================================
// ALMACENAMIENTO LOCAL EN MEMORIA (Sin MongoDB)
// ===============================================
// Formato: { "nombreUsuario": { username: "...", password: "hashPassword", status: "offline", friends: [] } }
const usersDB = new Map();

// Diccionario de sockets activos: { "nombreUsuario": "socket.id" }
const activeSockets = new Map();

console.log('⚡ Servidor iniciado en modo Local/Memoria (Sin MongoDB)');

// ===============================================
// 1. UPDATES - APARTADO PRIVADO
// ===============================================
const requireUpdateToken = (req, res, next) => {
  const token = req.header('X-BroOS-Update-Token');
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
// 2. CUENTAS - SISTEMA LOCAL & APARTADO DE BÚSQUEDA
// ===============================================

// APARTADO NUEVO: BÚSQUEDA / CONSULTA DE CUENTA POR NOMBRE
app.get('/api/accounts/lookup/:username', (req, res) => {
  const { username } = req.params;
  if (!username) {
    return res.status(400).json({ exists: false, error: "Nombre de usuario requerido." });
  }

  const user = usersDB.get(username.toLowerCase());
  if (!user) {
    return res.status(404).json({ exists: false, message: "Usuario no encontrado." });
  }

  res.json({
    exists: true,
    username: user.username,
    status: user.status
  });
});

// A. REGISTRO DE NUEVA CUENTA
app.post('/api/accounts/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password || username.length < 3 || password.length < 6) {
      return res.status(400).json({ error: "Datos inválidos. Usuario (min 3) y Clave (min 6)." });
    }

    if (usersDB.has(username.toLowerCase())) {
      return res.status(409).json({ error: "Ese nombre de usuario ya está pillado, bro." });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Guardar usuario en memoria
    usersDB.set(username.toLowerCase(), {
      username: username,
      password: hashedPassword,
      status: 'offline',
      friends: []
    });

    console.log(`[Cuentas] Nuevo usuario registrado localmente: ${username}`);
    res.status(201).json({ message: "¡Bro Account creada con éxito!", username });

  } catch (error) {
    console.error('Error en registro:', error);
    res.status(500).json({ error: "Error interno del servidor al crear la cuenta." });
  }
});

// B. LOGIN DE CUENTA (REST API)
app.post('/api/accounts/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Faltan usuario o contraseña." });
    }

    const user = usersDB.get(username.toLowerCase());
    if (!user) {
      return res.status(401).json({ error: "Usuario o contraseña incorrectos." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Usuario o contraseña incorrectos." });
    }

    console.log(`[Cuentas] Login exitoso: ${user.username}`);
    res.json({ 
      message: "Login correcto", 
      username: user.username,
      token: "BRO_TALK_LOCAL_TOKEN"
    });

  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: "Error interno del servidor al loguear." });
  }
});

// ===============================================
// 3. BACKEND PARA BRO TALK (WebSockets)
// ===============================================
io.on('connection', (socket) => {
  let authenticatedUser = null;
  console.log(`[Bro Talk] Nueva conexión WebSocket ID: ${socket.id}`);

  // A. AUTENTICAR CONEXIÓN DE SOCKET (OPCIÓN 1: AUTO-REGISTRO EN EL AIRE)
  socket.on('authenticate', async (data) => {
    try {
      const { username, password } = data;
      if (!username || !password) {
        return socket.emit('auth_result', { success: false, error: 'Faltan usuario o contraseña.' });
      }

      const key = username.toLowerCase();
      let user = usersDB.get(key);

      // SI EL USUARIO NO EXISTE EN LA MEMORIA, LO CREAMOS AUTOMÁTICAMENTE
      if (!user) {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        user = {
          username: username,
          password: hashedPassword,
          status: 'offline',
          friends: []
        };
        usersDB.set(key, user);
        console.log(`[Bro Talk] 🆕 Usuario creado automáticamente al autenticar: ${username}`);
      } else {
        // SI YA EXISTE, VALIDAMOS LA CONTRASEÑA
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
          return socket.emit('auth_result', { success: false, error: 'Contraseña incorrecta.' });
        }
      }

      authenticatedUser = user.username;
      activeSockets.set(authenticatedUser, socket.id);

      user.status = 'online';

      socket.emit('auth_result', {
        success: true,
        username: user.username,
        friends: user.friends,
        status: user.status
      });

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

    const { targetUser, message, type } = data;
    const targetSocketId = activeSockets.get(targetUser);

    const payload = {
      from: authenticatedUser,
      message: message,
      type: type || 'text',
      timestamp: new Date().toLocaleTimeString()
    };

    if (targetSocketId) {
      io.to(targetSocketId).emit('receive_private_message', payload);
      socket.emit('message_sent_status', { targetUser, delivered: true });
    } else {
      socket.emit('message_sent_status', { targetUser, delivered: false, note: 'Usuario no está en línea' });
    }
  });

  // D. CAMBIAR ESTADO
  socket.on('change_status', (data) => {
    if (!authenticatedUser) return;
    const { newStatus } = data;

    const user = usersDB.get(authenticatedUser.toLowerCase());
    if (user) {
      user.status = newStatus;
      notifyFriendsStatus(user.username, user.friends, newStatus);
    }
  });

  // E. HEARTBEAT / PING
  socket.on('ping_check', () => {
    socket.emit('pong_check', { timestamp: Date.now() });
  });

  // F. DESCONEXIÓN
  socket.on('disconnect', () => {
    if (authenticatedUser) {
      activeSockets.delete(authenticatedUser);

      const user = usersDB.get(authenticatedUser.toLowerCase());
      if (user) {
        user.status = 'offline';
        notifyFriendsStatus(user.username, user.friends, 'offline');
      }
      console.log(`[Bro Talk] Usuario desconectado: ${authenticatedUser}`);
    } else {
      console.log(`[Bro Talk] Conexión cerrada ID: ${socket.id}`);
    }
  });
});

function notifyFriendsStatus(username, friendsList, status) {
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
  console.log(`🚀 Servidor Bro OS y Bro Talk corriendo directamente en el puerto ${PORT}`);
});
