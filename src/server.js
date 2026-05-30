require('dotenv').config();
const dns = require('dns');
const { Resolver } = require('dns').promises;
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors     = require('cors');
const helmet   = require('helmet');
const morgan   = require('morgan');
const rateLimit = require('express-rate-limit');
const { spawn } = require('child_process');
const path    = require('path');
const axios   = require('axios');

// ── Lancement automatique du service ML Python (port 8000) ───────────────
(function startMLService() {
  const net = require('net');
  const tester = net.createServer();
  tester.once('error', () => {
    console.log('🤖 Service ML déjà actif sur port 8000');
    tester.close();
  });
  tester.once('listening', () => {
    tester.close(() => {
      const mlDir = path.join(__dirname, '../../ml-service');
      const ml = spawn('python', ['-m', 'uvicorn', 'api:app', '--host', '0.0.0.0', '--port', '8000'], {
        cwd: mlDir, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      });
      ml.stdout.on('data', d => { const l = d.toString().trim(); if (l) console.log(`[ML] ${l}`); });
      ml.stderr.on('data', d => { const l = d.toString().trim(); if (l && !l.includes('INFO')) console.log(`[ML] ${l}`); });
      ml.on('error', () => console.log('⚠️  Service ML non démarré (Python requis)'));
      ml.on('exit', code => { if (code !== 0 && code !== null) console.log(`[ML] Service arrêté (code ${code})`); });
      console.log('🤖 Service ML IA démarré → http://localhost:8000');
    });
  });
  tester.listen(8000, '0.0.0.0');
})();

// ICU Camera : integre directement dans icuCamera.js via detect.py

const authRoutes            = require('./routes/auth');
const patientRoutes         = require('./routes/patients');
const monitorRoutes         = require('./routes/monitors');
const vitalRoutes           = require('./routes/vitals');
const alertRoutes           = require('./routes/alerts');
const predictionRoutes      = require('./routes/predictions');
const chatbotRoutes         = require('./routes/chatbot');
const stockRoutes           = require('./routes/stock');
const prescriptionRoutes    = require('./routes/prescriptions');
const reaModelRoutes        = require('./routes/reaModel');
const geminiRoutes          = require('./routes/gemini');
const nihonKohdenRoutes     = require('./routes/nihonKohden');
const cameraDetectionRoutes = require('./routes/cameraDetections');
const icuCameraRoutes       = require('./routes/icuCamera');
const labTestRoutes              = require('./routes/labTests');
const testRoutes                 = require('./routes/tests');
const { startAutoRenewCron }     = require('./cron/autoRenewTests');
const { initSocketHandlers } = require('./socket/socketHandlers');
const { startVitalSimulator } = require('./socket/vitalSimulator');
const { startNihonKohdenHL7Server } = require('./services/nihonKohdenHL7');
const ioInstance = require('./socket/ioInstance');

const os = require('os');

function getLanIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

const app    = express();
const server = http.createServer(app);

const ALLOWED_ORIGINS = process.env.NODE_ENV === 'production'
  ? true  // Accepte tout en production (mobile depuis n'importe où)
  : ['http://localhost:3000', 'http://localhost:8081'];

const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS, credentials: true }
});

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(morgan('dev'));
app.use(express.json({ limit: '20mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 500 }));

// ── Téléchargement APK (local + cloud Render) ────────────────────────────
const DOWNLOADS_DIR = path.join(__dirname, '../../downloads');
const PUBLIC_DIR    = path.join(__dirname, '../public');
app.use('/download', express.static(DOWNLOADS_DIR));
app.use('/public',   express.static(PUBLIC_DIR));
// Page de téléchargement avec QR code
app.get('/download-app', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'download.html'));
});
// Raccourci direct pour l'APK Android
app.get('/apk', (req, res) => {
  const f = require('fs');
  const publicApk = path.join(PUBLIC_DIR, 'rea-monitor.apk');
  if (f.existsSync(publicApk)) return res.download(publicApk, 'rea-monitor.apk');
  res.status(404).json({ message: 'APK non trouvé' });
});
app.get('/api/download-info', (req, res) => {
  const PORT = process.env.PORT || 5001;
  const ip   = getLanIP();
  res.json({
    url:  `http://${ip}:${PORT}/download/rea-monitor.apk`,
    ip,
    port: PORT,
  });
});

app.use('/api/auth',              authRoutes);
app.use('/api/patients',          patientRoutes);
app.use('/api/monitors',          monitorRoutes);
app.use('/api/vitals',            vitalRoutes);
app.use('/api/alerts',            alertRoutes);
app.use('/api/predictions',       predictionRoutes);
app.use('/api/chatbot',           chatbotRoutes);
app.use('/api/stock',             stockRoutes);
app.use('/api/prescriptions',     prescriptionRoutes);
app.use('/api/rea-model',         reaModelRoutes);
app.use('/api/gemini',            geminiRoutes);
app.use('/api/nihon-kohden',      nihonKohdenRoutes);
app.use('/api/camera-detections', cameraDetectionRoutes);
app.use('/api/icu-camera',        icuCameraRoutes);
app.use('/api/lab-tests',         labTestRoutes);
app.use('/api/tests',             testRoutes);
app.use('/icu-camera',            icuCameraRoutes);

// ── Proxy transparent vers le service ML Python (port 8000) ─────────────────
app.use('/api/ml', async (req, res) => {
  const ML = process.env.ML_SERVICE_URL || 'http://localhost:8000';
  try {
    const r = await axios({
      method:  req.method,
      url:     `${ML}${req.path}`,
      data:    req.body,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });
    res.json(r.data);
  } catch (e) {
    const status = e.response?.status || 503;
    res.status(status).json({ error: 'Service ML indisponible', detail: e.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date(),
    database: mongoose.connection.readyState === 1 ? 'connectee' : 'deconnectee',
    dbState: mongoose.connection.readyState,
  });
});



// ── Résolution SRV Atlas via Google DNS (contourne les DNS FAI bloquants) ──
async function resolveAtlasSrv(srvUri) {
  const match = srvUri.match(/^mongodb\+srv:\/\/([^:@]+):([^@]+)@([^/?]+)(\/[^?]*)?(\?.*)?$/);
  if (!match) return srvUri;
  const [, user, pass, host, dbPath, query] = match;
  const resolver = new Resolver();
  resolver.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
  try {
    const srvRecords = await resolver.resolveSrv(`_mongodb._tcp.${host}`);
    let txtOpts = '';
    try {
      const txt = await resolver.resolveTxt(host);
      txtOpts = txt.flat().join('&');
    } catch (_) {}
    const hosts = srvRecords.map(r => `${r.name}:${r.port}`).join(',');
    const db = dbPath || '/rea_system';
    const params = new URLSearchParams(txtOpts);
    if (!params.has('ssl'))        params.set('ssl', 'true');
    if (!params.has('authSource')) params.set('authSource', 'admin');
    if (!params.has('tls'))        params.set('tls', 'true');
    const directUri = `mongodb://${user}:${pass}@${hosts}${db}?${params.toString()}`;
    console.log(`[DNS] SRV résolu via Google DNS → ${srvRecords.length} hôte(s)`);
    return directUri;
  } catch (err) {
    console.warn('[DNS] Résolution SRV échouée, utilisation URI originale:', err.message);
    return srvUri;
  }
}

// ── Connexion MongoDB Atlas ───────────────────────────────────────────────
async function startServer() {
  let mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/rea_system';
  const isAtlas = mongoUri.includes('mongodb+srv://') || mongoUri.includes('mongodb.net');

  if (mongoUri.includes('mongodb+srv://')) {
    mongoUri = await resolveAtlasSrv(mongoUri);
  }

  try {
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 30000,
      ...(isAtlas ? { retryWrites: true, w: 'majority', tls: true } : {}),
    });
    console.log(`✅ MongoDB ${isAtlas ? 'Atlas (cloud)' : 'local'} connecté`);
  } catch (err) {
    console.error('❌ MongoDB Atlas échoué:', err.message.slice(0, 120));
    if (isAtlas) {
      console.log('🔄 Tentative connexion MongoDB local (fallback)...');
      try {
        await mongoose.connect('mongodb://localhost:27017/rea_system', {
          serverSelectionTimeoutMS: 5000,
        });
        console.log('✅ MongoDB local connecté (mode hors-ligne)');
      } catch (localErr) {
        console.error('❌ MongoDB local aussi échoué:', localErr.message.slice(0, 80));
        console.log('⚠️  Démarrage sans base de données — certaines routes indisponibles');
      }
    } else {
      console.log('⚠️  Démarrage sans base de données — certaines routes indisponibles');
    }
  }

  // Seed si base vide
  if (mongoose.connection.readyState === 1) {
    try {
      const User       = require('./models/User');
      const Patient    = require('./models/Patient');
      const Medicament = require('./models/Medicament');
      const userCount    = await User.countDocuments();
      const patientCount = await Patient.countDocuments();
      if (userCount === 0 || patientCount === 0) {
        console.log('🌱 Initialisation des données demo...');
        await require('./config/seed').seedQuiet();
      }
      const medCount = await Medicament.countDocuments();
      if (medCount === 0) {
        console.log('💊 Initialisation des médicaments...');
        await require('./config/seedStock').seedStockQuiet();
      }
    } catch (e) {
      console.log('⚠️  Seed ignoré:', e.message);
    }
  }

  ioInstance.setIo(io);
  initSocketHandlers(io);
  startVitalSimulator(io);
  startAutoRenewCron();

  // Serveur HL7 MLLP Nihon Kohden
  const NK_HL7_PORT = parseInt(process.env.NK_HL7_PORT) || 2575;
  try {
    startNihonKohdenHL7Server(io, NK_HL7_PORT);
    console.log(`📡 Serveur HL7 MLLP démarré → port ${NK_HL7_PORT}`);
  } catch (e) {
    console.log('⚠️  HL7 MLLP non démarré:', e.message);
  }

  // Warmup Ollama
  try {
    const axios = require('axios');
    const ollamaUrl   = process.env.OLLAMA_URL   || 'http://localhost:11434';
    const ollamaModel = process.env.OLLAMA_MODEL  || 'llama3.2:1b';
    axios.post(`${ollamaUrl}/api/generate`, {
      model: ollamaModel, prompt: 'ok', stream: false,
    }, { timeout: 5000 }).catch(() => {});
    console.log(`[Ollama] Warmup ${ollamaModel}`);
  } catch {}

  const PORT = process.env.PORT || 5001;
  server.listen(PORT, () => {
    console.log(`🚀 Serveur REA démarré → http://localhost:${PORT}`);
    console.log(`📊 Dashboard        → http://localhost:3000`);
  });
}

startServer();
