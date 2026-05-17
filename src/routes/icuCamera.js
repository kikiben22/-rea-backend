const express = require('express');
const { spawn } = require('child_process');
const path    = require('path');
const axios   = require('axios');
const router  = express.Router();

const DETECT_PY = path.join(__dirname, '..', '..', '..', 'ml_service', 'detect.py');
const ML_DIR    = path.join(__dirname, '..', '..', '..', 'ml_service');

// ── Processus Python persistant ───────────────────────────────────────────────
let _pyProc  = null;
let _pyReady = false;
let _pending = null;
let _startTs = 0;

function startPython() {
  if (_pyProc) return;
  _startTs = Date.now();
  _pyProc  = spawn('python', [DETECT_PY], {
    cwd: ML_DIR, stdio: ['pipe','pipe','pipe'],
  });
  _pyProc.stdout.setEncoding('utf8');
  let buf = '';

  _pyProc.stdout.on('data', chunk => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.status === 'ready') { _pyReady = true; console.log('[ICU] IA prete'); return; }
        if (_pending) { clearTimeout(_pending.timer); _pending.resolve(parsed); _pending = null; }
      } catch (e) {
        if (_pending) { clearTimeout(_pending.timer); _pending.reject(new Error('JSON invalide')); _pending = null; }
      }
    }
  });

  _pyProc.stderr.on('data', d => {
    const line = d.toString().trim();
    if (line && !line.includes('WARNING') && !line.includes('INFO')) process.stdout.write(`[ICU] ${line}\n`);
  });

  _pyProc.on('exit', (code) => {
    console.log(`[ICU] Python arrete (${code}) — redemarrage dans 3s`);
    _pyProc = null; _pyReady = false;
    if (_pending) { _pending.reject(new Error('Python arrete')); _pending = null; }
    setTimeout(startPython, 3000);
  });

  _pyProc.on('error', () => { _pyProc = null; _pyReady = false; });
}
startPython();

function detectImage(b64, patientId, bedNumber, save, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    if (!_pyProc || !_pyReady) return reject(new Error('IA non prete'));
    if (_pending) return reject(new Error('Detection en cours'));
    const timer = setTimeout(() => { _pending = null; reject(new Error('Timeout')); }, timeoutMs);
    _pending = { resolve, reject, timer };
    const msg = JSON.stringify({ image: b64, patientId, bedNumber, save: !!save, tasks: ['eye', 'head', 'movement'] }) + '\n';
    _pyProc.stdin.write(msg);
  });
}

// ── Sauvegarder detection dans MongoDB ────────────────────────────────────────
const mongoose = require('mongoose');

const detectionSchema = new mongoose.Schema({
  patientId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Patient' },
  bedNumber:     String,
  movement:      { type: String, enum: ['STABLE','MOUVEMENT','AGITATION'], default: 'STABLE' },
  eye:           String,
  tete:          String,
  finger:        String,
  nose_bleeding: String,
  tube:          String,
  placement:     String,
  imagePath:     String,
  alerte:        String,
}, { timestamps: true });
detectionSchema.index({ patientId: 1, createdAt: -1 });
detectionSchema.index({ createdAt: -1 });
const Detection = mongoose.models.CameraDetection ||
  mongoose.model('CameraDetection', detectionSchema);

const BODY_MAP = { AGGITATION: 'AGITATION', MOVE: 'MOUVEMENT', STABLE: 'STABLE' };

async function saveToMongo(results, patientId, bedNumber, imagePath) {
  try {
    const mv  = results.movement?.label || 'STABLE';
    const nos = results.nose_bleeding?.label || 'non';
    const fin = results.finger?.label || '';
    const tet       = results.tete?.label || '';
    const eye       = results.eye?.label || '';
    const place     = results.placement?.label || '';
    const isUrgent  = mv === 'AGGITATION' || nos === 'oui' || place === 'trop_profond';
    const isAttn    = mv === 'MOVE' || fin === 'bouge' || tet === 'tete_bouge'
                      || tet === 'bouge' || eye === 'open' || place === 'trop_court';
    const alerte    = isUrgent ? 'URGENT' : isAttn ? 'ATTENTION' : 'OK';

    const doc = {
      movement:      BODY_MAP[mv] || 'STABLE',
      eye:           results.eye?.label || '',
      tete:          results.tete?.label || '',
      finger:        results.finger?.label || '',
      nose_bleeding: nos,
      tube:          results.tube?.label || '',
      placement:     results.placement?.label || '',
      alerte,
      imagePath:     imagePath || '',
    };
    if (patientId) doc.patientId = patientId;
    if (bedNumber) doc.bedNumber = bedNumber;
    await Detection.create(doc);
  } catch (e) {
    // Ne pas bloquer si MongoDB indisponible
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.get('/health', (req, res) => {
  res.json({ status: _pyReady ? 'ok' : 'starting', ready: _pyReady,
             uptime: _pyProc ? Math.round((Date.now()-_startTs)/1000) : 0 });
});

router.post('/detect', async (req, res) => {
  try {
    const { image, patientId, bedNumber } = req.body || {};
    if (!image) return res.status(400).json({ error: 'image manquante' });

    // Detecter si c est une alerte pour sauvegarder
    const result = await detectImage(image, patientId, bedNumber, false);
    if (!result.ok) return res.status(503).json(result);

    const results = result.results || {};
    const mv  = results.movement?.label || 'STABLE';
    const nos = results.nose_bleeding?.label || 'non';
    const tete2  = results.tete?.label  || '';
    const eye2   = results.eye?.label   || '';
    const fin2   = results.finger?.label || '';
    const place2 = results.placement?.label || '';
    const isAlert = mv === 'AGGITATION' || mv === 'MOVE'
                    || nos === 'oui'
                    || tete2 === 'tete_bouge' || tete2 === 'bouge'
                    || eye2 === 'open'
                    || fin2 === 'bouge'
                    || place2 === 'trop_court' || place2 === 'trop_profond';

    // Sauvegarder en MongoDB si alerte
    if (isAlert) {
      // Demander aussi la capture image annotee (en arriere-plan)
      detectImage(image, patientId, bedNumber, true, 15000)
        .then(r => {
          const imgPath = r?.results?._saved || '';
          saveToMongo(results, patientId, bedNumber, imgPath);
        })
        .catch(() => saveToMongo(results, patientId, bedNumber, ''));
    }

    res.json(result);
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

/* ── Proxy frame ESP32 ───────────────────────────────────────────────────── */
router.get('/frame', async (req, res) => {
  const ip = (req.query.ip || '').trim();
  if (!ip) return res.status(400).json({ error: 'ip manquant' });
  for (const ep of ['/capture', '/jpg', '/snapshot']) {
    try {
      const r = await axios.get(`http://${ip}${ep}`, {
        timeout: 4000, responseType: 'arraybuffer',
      });
      res.set('Content-Type', r.headers['content-type'] || 'image/jpeg');
      res.set('Cache-Control', 'no-store');
      return res.send(Buffer.from(r.data));
    } catch { }
  }
  res.status(503).json({ error: `ESP32 (${ip}) inaccessible` });
});

/* ── Historique captures ─────────────────────────────────────────────────── */
router.get('/captures', async (req, res) => {
  try {
    const { patientId, bedNumber, limit = 50 } = req.query;
    const filter = {};
    if (patientId) filter.patientId = patientId;
    if (bedNumber)  filter.bedNumber  = bedNumber;
    const docs = await Detection.find(filter)
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .populate('patientId', 'firstName lastName');
    res.json({ ok: true, captures: docs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Compatibilite routes legacy
router.post('/train-online',   (req, res) => res.json({ ok: true, skipped: true }));
router.get('/training-stats',  (req, res) => res.json({ ok: true, count: 0, loss: null }));
router.post('/save-capture',   async (req, res) => {
  try {
    const { image, patientId, bedNumber } = req.body || {};
    if (!image) return res.status(400).json({ error: 'image manquante' });
    const result = await detectImage(image, patientId, bedNumber, true, 15000);
    if (result.ok) {
      await saveToMongo(result.results || {}, patientId, bedNumber, result.results?._saved || '');
    }
    res.json({ ok: true, saved: result.results?._saved || '' });
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});
router.get('/dataset-stats',   (req, res) => res.json({ ok: true, stats: {} }));
router.post('/retrain',        (req, res) => res.json({ ok: true }));
router.get('/retrain-status',  (req, res) => res.json({ ok: true, running: false }));

module.exports = router;
