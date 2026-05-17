const jwt = require('jsonwebtoken');
const Alert = require('../models/Alert');
const Monitor = require('../models/Monitor');

function initSocketHandlers(io) {
  // Middleware d'auth Socket.IO
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Non authentifié'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      socket.userRole = decoded.role;
      next();
    } catch {
      next(new Error('Token invalide'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`👤 Client connecté: ${socket.id}`);

    // Rejoindre la salle REA
    socket.join('rea-dashboard');

    // S'abonner à un moniteur spécifique
    socket.on('subscribe:monitor', (monitorId) => {
      socket.join(`monitor:${monitorId}`);
    });

    // Acquitter une alerte depuis le frontend
    socket.on('alert:acknowledge', async ({ alertId, userName }) => {
      await Alert.findByIdAndUpdate(alertId, {
        acknowledged: true,
        acknowledgedBy: userName,
        acknowledgedAt: new Date()
      });
      io.to('rea-dashboard').emit('alert:updated', { alertId, status: 'acknowledged' });
    });

    // Silence alarme moniteur
    socket.on('monitor:silence', async (monitorId) => {
      await Monitor.findByIdAndUpdate(monitorId, { alarmStatus: 'SILENCED' });
      setTimeout(async () => {
        await Monitor.findByIdAndUpdate(monitorId, { alarmStatus: 'NORMAL' });
        io.to(`monitor:${monitorId}`).emit('monitor:alarm-restored', monitorId);
      }, 120000); // 2 minutes
    });

    // ── Camera Frame Relay : PC → Backend → Mobile ──────────────
    // Le PC envoie une frame (base64 JPEG) → on la broadcast à tous les clients
    socket.on('camera:frame', (data) => {
      // data: { frame, bedNumber, patientName, detection, movement }
      socket.broadcast.emit('camera:live-frame', {
        frame:       data.frame,       // base64 JPEG
        bedNumber:   data.bedNumber,
        patientName: data.patientName,
        detection:   data.detection,   // résultats IA
        movement:    data.movement,    // STABLE / MOVE / AGGITATION
        timestamp:   Date.now(),
      });
    });

    socket.on('disconnect', () => {
      console.log(`👤 Client déconnecté: ${socket.id}`);
    });
  });
}

module.exports = { initSocketHandlers };
