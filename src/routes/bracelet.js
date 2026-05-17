const express  = require('express');
const router   = express.Router();
const Bracelet = require('../models/Bracelet');
const Alert    = require('../models/Alert');
const Patient  = require('../models/Patient');
const { getIo } = require('../socket/ioInstance');

// ─── POST /api/bracelet/register ─────────────────────────────────────────────
// L'ESP32 s'enregistre au démarrage
router.post('/register', async (req, res) => {
  try {
    const { deviceId, patientId, firmware, battery, lit } = req.body;
    if (!deviceId) return res.status(400).json({ message: 'deviceId requis' });

    const update = {
      firmware: firmware || '1.0.0',
      battery:  battery  || 100,
      isOnline: true,
      lastSeen: new Date(),
      litName:  lit || '',
    };
    if (patientId) update.patientId = patientId;

    // Auto-associer au patient du bon lit
    if (lit) {
      const Patient = require('../models/Patient');
      const patient = await Patient.findOne({ bedNumber: Number(lit) });
      if (patient) update.patientId = patient._id;
    }

    const bracelet = await Bracelet.findOneAndUpdate(
      { deviceId },
      update,
      { upsert: true, new: true }
    ).populate('patientId', 'firstName lastName patientId bedNumber');

    const io = getIo();
    if (io) io.to('rea-dashboard').emit('bracelet:online', bracelet);

    console.log(`📿 Bracelet en ligne: ${deviceId} — Lit ${lit || '?'}`);
    res.json({ ok: true, bracelet });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── POST /api/bracelet/fall ──────────────────────────────────────────────────
// Alerte de chute détectée par l'ESP32
router.post('/fall', async (req, res) => {
  try {
    const { deviceId, patientId, magnitude, ax, ay, az, battery } = req.body;
    if (!deviceId) return res.status(400).json({ message: 'deviceId requis' });

    // Récupérer le bracelet et le patient lié
    const bracelet = await Bracelet.findOneAndUpdate(
      { deviceId },
      { battery, lastSeen: new Date(), lastFallAt: new Date(), $inc: { fallCount: 1 } },
      { new: true }
    ).populate('patientId', 'firstName lastName patientId bedNumber');

    // Identifier le patient (via bracelet DB ou payload)
    const linkedPatientId = bracelet?.patientId?._id || patientId || null;
    const patientInfo     = bracelet?.patientId;

    // Créer l'alerte dans la base
    const alert = await Alert.create({
      patientId:    linkedPatientId,
      type:         'EQUIPMENT',
      severity:     'CRITICAL',
      parameter:    'bracelet_fall',
      currentValue: parseFloat(magnitude) || 0,
      threshold:    2.5,
      message: patientInfo
        ? `🚨 CHUTE DÉTECTÉE — Patient ${patientInfo.firstName} ${patientInfo.lastName} (Lit ${patientInfo.bedNumber || '?'}) — Impact: ${magnitude}g`
        : `🚨 CHUTE DÉTECTÉE — Bracelet ${deviceId} — Impact: ${magnitude}g`,
    });

    // Alerte temps réel → dashboard web + mobile
    const io = getIo();
    if (io) {
      const fullAlert = {
        ...alert.toObject(),
        bracelet: { deviceId, magnitude, ax, ay, az, battery },
        patient:  patientInfo || null,
        isFall:   true,
      };
      io.to('rea-dashboard').emit('alert:new', fullAlert);
      io.to('rea-dashboard').emit('bracelet:fall', fullAlert);
    }

    console.log(`🚨 Chute bracelet ${deviceId} — magnitude: ${magnitude}g`);
    res.status(201).json({ ok: true, alertId: alert._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ─── POST /api/bracelet/heartbeat ────────────────────────────────────────────
// Ping périodique de l'ESP32 (batterie + uptime)
router.post('/heartbeat', async (req, res) => {
  try {
    const { deviceId, battery, uptime } = req.body;
    if (!deviceId) return res.status(400).json({ message: 'deviceId requis' });

    const bracelet = await Bracelet.findOneAndUpdate(
      { deviceId },
      { battery, isOnline: true, lastSeen: new Date() },
      { new: true }
    );

    // Alerte batterie faible
    if (battery <= 15 && bracelet) {
      const existing = await Alert.findOne({
        parameter: 'bracelet_battery',
        resolved: false,
        patientId: bracelet.patientId,
      });
      if (!existing) {
        const alert = await Alert.create({
          patientId: bracelet.patientId,
          type:      'EQUIPMENT',
          severity:  'HIGH',
          parameter: 'bracelet_battery',
          currentValue: battery,
          threshold: 15,
          message:   `⚠ Batterie faible bracelet ${deviceId} — ${battery}%`,
        });
        const io = getIo();
        if (io) io.to('rea-dashboard').emit('alert:new', alert);
      }
    }

    // Mise à jour status temps réel
    const io = getIo();
    if (io) io.to('rea-dashboard').emit('bracelet:heartbeat', { deviceId, battery, uptime });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── POST /api/bracelet/data ─────────────────────────────────────────────────
// Endpoint universel reçu du firmware ESP32 (mac, lit, etat, acc, gyr)
router.post('/data', async (req, res) => {
  try {
    const { mac, lit, etat, acc, gyr } = req.body;
    if (!mac) return res.status(400).json({ ok: false, message: 'mac requis' });

    const movementType = etat === 'URGENCE' ? 'FORT' : etat === 'MOUVEMENT' ? 'LEGER' : 'REPOS';

    const update = {
      isOnline:     true,
      lastSeen:     new Date(),
      movementType,
      lastAcc:      Number(acc) || 0,
      lastGyr:      Number(gyr) || 0,
      litName:      lit || '',
    };

    if (movementType !== 'REPOS') {
      update.lastMovementAt = new Date();
      update.$inc = { movementCount: 1 };
    }

    const bracelet = await Bracelet.findOneAndUpdate(
      { deviceId: mac },
      update,
      { upsert: true, new: true }
    ).populate('patientId', 'firstName lastName bedNumber patientId');

    const io = getIo();

    if (movementType === 'FORT') {
      // Mouvement fort = agitation/danger, pas une chute
      // Déduplique : pas plus d'une alerte active par bracelet
      const existing = await Alert.findOne({
        parameter: 'bracelet_movement_fort',
        resolved:  false,
        patientId: bracelet?.patientId?._id || null,
      });

      if (!existing) {
        const alertMsg = bracelet?.patientId
          ? `⚠ AGITATION FORTE — ${bracelet.patientId.firstName} ${bracelet.patientId.lastName} (Lit ${bracelet.patientId.bedNumber || lit || '?'}) — Acc: ${acc}`
          : `⚠ AGITATION FORTE — Bracelet ${mac} (Lit ${lit || '?'}) — Acc: ${acc}`;

        const alert = await Alert.create({
          patientId:    bracelet?.patientId?._id || null,
          type:         'EQUIPMENT',
          severity:     'HIGH',
          parameter:    'bracelet_movement_fort',
          currentValue: parseFloat(acc) || 0,
          threshold:    2.5,
          message:      alertMsg,
        });

        if (io) {
          const payload = {
            ...alert.toObject(),
            bracelet:     { deviceId: mac, acc, gyr, battery: bracelet?.battery },
            patient:      bracelet?.patientId || null,
            movementType: 'FORT',
            lit,
          };
          io.to('rea-dashboard').emit('alert:new', payload);
          io.to('rea-dashboard').emit('bracelet:movement', payload);
        }
      } else if (io) {
        // Alerte déjà active : mettre à jour le mouvement sans créer de doublon
        io.to('rea-dashboard').emit('bracelet:movement', {
          deviceId:     mac,
          lit,
          movementType: 'FORT',
          acc,
          gyr,
          patient:      bracelet?.patientId || null,
          bracelet:     { deviceId: mac, battery: bracelet?.battery },
          timestamp:    new Date(),
        });
      }
      console.log(`⚠ AGITATION FORTE bracelet ${mac} lit ${lit} — acc:${acc}`);

    } else if (movementType === 'LEGER') {
      if (io) {
        io.to('rea-dashboard').emit('bracelet:movement', {
          deviceId:     mac,
          lit,
          movementType: 'LEGER',
          acc,
          gyr,
          patient:      bracelet?.patientId || null,
          bracelet:     { deviceId: mac, battery: bracelet?.battery },
          timestamp:    new Date(),
        });
      }
      console.log(`🟢 mouvement léger bracelet ${mac} lit ${lit}`);

    } else {
      if (io) {
        io.to('rea-dashboard').emit('bracelet:heartbeat', {
          deviceId:     mac,
          battery:      bracelet?.battery,
          movementType: 'REPOS',
          lit,
        });
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[bracelet/data]', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ─── GET /api/bracelet ───────────────────────────────────────────────────────
// Liste tous les bracelets (dashboard)
router.get('/', async (req, res) => {
  try {
    const bracelets = await Bracelet.find()
      .populate('patientId', 'firstName lastName patientId bedNumber status')
      .sort({ lastSeen: -1 });
    res.json(bracelets);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── PUT /api/bracelet/:deviceId/link ────────────────────────────────────────
// Associer un bracelet à un patient (depuis le dashboard)
router.put('/:deviceId/link', async (req, res) => {
  try {
    const { patientId } = req.body;
    const bracelet = await Bracelet.findOneAndUpdate(
      { deviceId: req.params.deviceId },
      { patientId },
      { new: true }
    ).populate('patientId', 'firstName lastName patientId bedNumber');

    if (!bracelet) return res.status(404).json({ message: 'Bracelet introuvable' });

    const io = getIo();
    if (io) io.to('rea-dashboard').emit('bracelet:updated', bracelet);

    res.json(bracelet);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── PUT /api/bracelet/:deviceId/offline ─────────────────────────────────────
router.put('/:deviceId/offline', async (req, res) => {
  try {
    const bracelet = await Bracelet.findOneAndUpdate(
      { deviceId: req.params.deviceId },
      { isOnline: false },
      { new: true }
    );
    if (!bracelet) return res.status(404).json({ message: 'Bracelet introuvable' });
    const io = getIo();
    if (io) io.to('rea-dashboard').emit('bracelet:updated', bracelet);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Tâche de fond : marquer hors-ligne si pas de heartbeat depuis 2 min ──────
setInterval(async () => {
  try {
    const cutoff = new Date(Date.now() - 2 * 60 * 1000);
    const result = await Bracelet.updateMany(
      { isOnline: true, lastSeen: { $lt: cutoff } },
      { isOnline: false }
    );
    if (result.modifiedCount > 0) {
      console.log(`📿 ${result.modifiedCount} bracelet(s) marqué(s) hors-ligne`);
      const io = getIo();
      if (io) io.to('rea-dashboard').emit('bracelet:status-check', {});
    }
  } catch (_) {}
}, 60 * 1000);

module.exports = router;
