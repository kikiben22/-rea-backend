/**
 * ROUTE REST — NIHON KOHDEN HTTP PUSH
 *
 * Utilisée quand un gateway réseau (ou le moniteur lui-même si configuré
 * en mode REST) pousse les données en JSON via HTTP POST.
 *
 * POST /api/nihon-kohden/vitals    ← push données vitaux
 * POST /api/nihon-kohden/register  ← enregistrement au boot moniteur
 * GET  /api/nihon-kohden/monitors  ← liste des moniteurs NK actifs
 * POST /api/nihon-kohden/offline   ← moniteur éteint
 *
 * 5 vitaux Life Scope acceptés :
 *   heartRate / spo2 / systolicBP + diastolicBP /
 *   ibpSystolic + ibpDiastolic / respRate / temperature / etco2 / glasgow
 */

const express    = require('express');
const Monitor    = require('../models/Monitor');
const VitalSign  = require('../models/VitalSign');
const Alert      = require('../models/Alert');
const ioInstance = require('../socket/ioInstance');
const router     = express.Router();

// Autoriser uniquement le réseau local (les moniteurs médicaux n'ont pas de JWT)
function lanOnly(req, res, next) {
  const ip = req.ip?.replace('::ffff:', '') || '';
  const ok = ip === '127.0.0.1' || ip === '::1' ||
             ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.');
  if (!ok) return res.status(403).json({ message: 'Accès réservé au réseau local' });
  next();
}

function alarmFor(val, t) {
  if (!t || val == null) return 'NORMAL';
  if (val <= (t.criticalMin ?? 0) || val >= (t.criticalMax ?? 9999)) return 'CRITICAL';
  if (val <= (t.minVal ?? 0)      || val >= (t.maxVal ?? 9999))      return 'WARNING';
  return 'NORMAL';
}

function generateECGWaveform(hr = 75) {
  const points = [];
  const period = Math.round(100 / (hr / 60));
  for (let i = 0; i < 100; i++) {
    const phase = (i % period) / period;
    let val = 0;
    if      (phase < 0.10) val = phase * 10;
    else if (phase < 0.15) val = 1 - (phase - 0.10) * 20;
    else if (phase < 0.20) val = 0.5;
    else if (phase < 0.25) val = 3 * Math.sin((phase - 0.20) * 40);
    else if (phase < 0.35) val = 0.2;
    else if (phase < 0.45) val = 0.8 * Math.sin((phase - 0.35) * 20);
    points.push(parseFloat(val.toFixed(3)));
  }
  return points;
}

// ── POST /api/nihon-kohden/vitals ─────────────────────────────────────────────
// Corps JSON attendu :
// {
//   "monitorId":    "NK_BSM_BED01",   ← configuré dans le moniteur (obligatoire)
//   "bedNumber":    "01",             ← si 1ère connexion
//   "heartRate":    72,               ← ECG / FC  (bpm)
//   "spo2":         98,               ← SpO₂      (%)
//   "systolicBP":   120,              ← NIBP sys  (mmHg)
//   "diastolicBP":  80,               ← NIBP dia  (mmHg)
//   "ibpSystolic":  115,              ← IBP art.  (mmHg) — optionnel
//   "ibpDiastolic": 75,               ← IBP art.  (mmHg) — optionnel
//   "respRate":     16,               ← FR        (/min)
//   "temperature":  37.1,             ← Temp      (°C)
//   "etco2":        38,               ← EtCO₂     (mmHg) — optionnel
//   "glasgow":      15                ← GCS       (/15)  — optionnel
// }
router.post('/vitals', lanOnly, async (req, res) => {
  try {
    const { monitorId, bedNumber, ...raw } = req.body;
    if (!monitorId) return res.status(400).json({ message: 'monitorId requis' });

    // Trouver ou créer le moniteur
    let monitor = await Monitor.findOne({ monitorId });
    if (!monitor) {
      monitor = new Monitor({
        monitorId,
        brand:     'Nihon Kohden',
        model:     'Life Scope G',
        bedNumber: bedNumber || monitorId,
        isOnline:  true,
      });
      await monitor.save();
      console.log(`🆕 [NK-REST] Nouveau moniteur : ${monitorId}`);
    } else if (!monitor.isOnline) {
      await Monitor.findByIdAndUpdate(monitor._id, { isOnline: true });
    }

    // Extraire valeurs numériques
    const v = {};
    const FIELDS = ['heartRate','spo2','systolicBP','diastolicBP',
                    'ibpSystolic','ibpDiastolic','respRate','temperature','etco2','glasgow'];
    for (const f of FIELDS) {
      const n = parseFloat(raw[f]);
      if (!isNaN(n)) v[f] = n;
    }

    // MAP calculée si absente
    if (!v.map && v.systolicBP && v.diastolicBP)
      v.map = Math.round((v.systolicBP + 2 * v.diastolicBP) / 3);
    if (!v.ibpMap && v.ibpSystolic && v.ibpDiastolic)
      v.ibpMap = Math.round((v.ibpSystolic + 2 * v.ibpDiastolic) / 3);

    const t = monitor.thresholds || {};
    const hrAlarm   = alarmFor(v.heartRate,   t.heartRate);
    const spo2Alarm = alarmFor(v.spo2,        t.spo2);
    const sbpAlarm  = alarmFor(v.systolicBP,  t.systolicBP);
    const rrAlarm   = alarmFor(v.respRate,     t.respRate);
    const tempAlarm = alarmFor(v.temperature,  t.temperature);
    const gcsAlarm  = alarmFor(v.glasgow,      t.glasgow);
    const ibpAlarm  = alarmFor(v.ibpSystolic,  t.systolicBP);

    const allAlarms    = [hrAlarm, spo2Alarm, sbpAlarm, rrAlarm, tempAlarm, gcsAlarm, ibpAlarm];
    const overallAlarm = allAlarms.includes('CRITICAL') ? 'CRITICAL'
                       : allAlarms.includes('WARNING')  ? 'WARNING' : 'NORMAL';

    // Format plat identique au simulateur
    const flatVitals = {
      heartRate:    v.heartRate,    heartRateAlarm: hrAlarm,
      spo2:         v.spo2,         spo2Alarm,
      systolicBP:   v.systolicBP,
      diastolicBP:  v.diastolicBP,  bpAlarm: sbpAlarm,
      map:          v.map,
      ibpSystolic:  v.ibpSystolic,
      ibpDiastolic: v.ibpDiastolic, ibpAlarm,
      ibpMap:       v.ibpMap,
      respRate:     v.respRate,     rrAlarm,
      temperature:  v.temperature,  tempAlarm,
      etco2:        v.etco2,
      glasgow:      v.glasgow,      gcsAlarm,
      ecgWaveform:  generateECGWaveform(v.heartRate || 75),
      source:       'nihon-kohden',
    };

    // Sauvegarder VitalSign
    if (monitor.currentPatient) {
      const vsDoc = {
        monitorId:   monitor._id,
        patientId:   monitor.currentPatient,
        overallAlarm,
        heartRate:   v.heartRate   != null ? { value: v.heartRate,   alarm: hrAlarm   } : undefined,
        spo2:        v.spo2        != null ? { value: v.spo2,        alarm: spo2Alarm } : undefined,
        systolicBP:  v.systolicBP  != null ? { value: v.systolicBP,  alarm: sbpAlarm  } : undefined,
        diastolicBP: v.diastolicBP != null ? { value: v.diastolicBP, alarm: 'NORMAL'  } : undefined,
        meanArterialPressure: v.map,
        respRate:    v.respRate    != null ? { value: v.respRate,    alarm: rrAlarm   } : undefined,
        temperature: v.temperature != null ? { value: v.temperature, alarm: tempAlarm } : undefined,
        etco2:       v.etco2       != null ? { value: v.etco2,       alarm: 'NORMAL'  } : undefined,
        glasgow:     v.glasgow     != null ? { value: v.glasgow,     alarm: gcsAlarm  } : undefined,
        ecgWaveform: flatVitals.ecgWaveform,
      };
      await new VitalSign(vsDoc).save().catch(() => {});
    }

    // Mettre à jour lastVitals
    const upd = { alarmStatus: overallAlarm, isOnline: true };
    for (const f of FIELDS) {
      if (v[f] != null) upd[`lastVitals.${f}`] = v[f];
    }
    upd['lastVitals.timestamp'] = new Date();
    await Monitor.findByIdAndUpdate(monitor._id, upd);

    // Alertes critiques
    if (overallAlarm === 'CRITICAL') {
      const critMap = { heartRate: hrAlarm, spo2: spo2Alarm, systolicBP: sbpAlarm, respRate: rrAlarm, temperature: tempAlarm };
      for (const [f, a] of Object.entries(critMap)) {
        if (a === 'CRITICAL' && v[f] != null) {
          await new Alert({
            monitorId: monitor._id,
            patientId: monitor.currentPatient || undefined,
            type: 'VITAL_CRITICAL', severity: 'CRITICAL',
            parameter: f, currentValue: v[f],
            message: `[NK Life Scope] ${f} CRITIQUE : ${v[f]} — Lit ${monitor.bedNumber}`,
          }).save().catch(() => {});
        }
      }
    }

    // Broadcast Socket.IO (même format que simulateur)
    const io = ioInstance.getIo();
    if (io) {
      const payload = {
        monitorId:   monitor._id,
        monitorCode: monitorId,
        bedNumber:   monitor.bedNumber,
        vitals:      flatVitals,
        overallAlarm,
        timestamp:   new Date(),
      };
      io.to('rea-dashboard').emit('vitals:update',  payload);
      io.to('rea-dashboard').emit('monitor:vitals', payload);
      io.to(`monitor:${monitor._id}`).emit('vitals:detail', payload);

      if (overallAlarm !== 'NORMAL') {
        io.to('rea-dashboard').emit('monitor:alarm', {
          monitorId: monitor._id, bedNumber: monitor.bedNumber, level: overallAlarm,
        });
        if (overallAlarm === 'CRITICAL') {
          io.to('rea-dashboard').emit('alert:new', {
            monitorId, bedNumber: monitor.bedNumber,
            severity: 'CRITICAL', message: `Alarme CRITIQUE — Lit ${monitor.bedNumber}`,
          });
        }
      }
    }

    console.log(`📡 [NK-REST] ${monitorId} → FC:${v.heartRate ?? '-'}  SpO₂:${v.spo2 ?? '-'}%  [${overallAlarm}]`);
    res.json({ ok: true, monitorId, overallAlarm });

  } catch (err) {
    console.error('[NK-REST] Erreur:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/nihon-kohden/register ───────────────────────────────────────────
// Appelé au démarrage du moniteur pour s'enregistrer dans le système
router.post('/register', lanOnly, async (req, res) => {
  try {
    const { monitorId, bedNumber, model, serialNumber } = req.body;
    if (!monitorId || !bedNumber) return res.status(400).json({ message: 'monitorId et bedNumber requis' });

    let monitor = await Monitor.findOne({ monitorId });
    if (monitor) {
      await Monitor.findByIdAndUpdate(monitor._id, { isOnline: true, model, serialNumber });
      return res.json({ ok: true, created: false, monitorId });
    }

    monitor = await new Monitor({
      monitorId, bedNumber,
      brand: 'Nihon Kohden',
      model: model || 'Life Scope G',
      serialNumber, isOnline: true,
    }).save();

    const io = ioInstance.getIo();
    if (io) {
      io.to('rea-dashboard').emit('monitor:registered', {
        monitorId: monitor._id, monitorCode: monitorId,
        bedNumber, brand: 'Nihon Kohden', model: monitor.model,
      });
    }

    console.log(`✅ [NK-REST] Moniteur enregistré : ${monitorId} — Lit ${bedNumber}`);
    res.status(201).json({ ok: true, created: true, monitorId });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/nihon-kohden/monitors ────────────────────────────────────────────
router.get('/monitors', async (req, res) => {
  try {
    const monitors = await Monitor.find({ brand: 'Nihon Kohden' })
      .populate('currentPatient', 'patientId firstName lastName bedNumber')
      .sort('bedNumber');
    res.json(monitors);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/nihon-kohden/offline ────────────────────────────────────────────
router.post('/offline', lanOnly, async (req, res) => {
  try {
    const { monitorId } = req.body;
    if (!monitorId) return res.status(400).json({ message: 'monitorId requis' });
    await Monitor.findOneAndUpdate({ monitorId }, { isOnline: false, alarmStatus: 'NORMAL' });
    const io = ioInstance.getIo();
    if (io) io.to('rea-dashboard').emit('monitor:offline', { monitorCode: monitorId });
    console.log(`🔴 [NK-REST] Moniteur hors ligne : ${monitorId}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
