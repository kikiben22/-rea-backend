const express = require('express');
const axios = require('axios');
const VitalSign = require('../models/VitalSign');
const Monitor = require('../models/Monitor');
const Alert = require('../models/Alert');
const { authenticate } = require('../middleware/auth');
const ioInstance = require('../socket/ioInstance');
const router = express.Router();

const ML_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

// Seuils FR (Fréquence Respiratoire) ICU4
const FR_ALERT_LOW  = 8;   // < 8  → APNÉE CRITIQUE
const FR_ALERT_HIGH = 18;  // > 18 → TACHYPNÉE WARNING

// Intervalles PNI disponibles (en minutes)
const PNI_INTERVALS = [1, 2, 2.5, 5, 10, 15, 30, 60, 120, 240, 480];

// POST /api/vitals/push — envoi de signes vitaux depuis un moniteur externe (Packet Sender / BAT)
router.post('/push', async (req, res) => {
  try {
    const { bedNumber, fc, spo2, pas, pad, fr, temp, etco2, glasgow, apiKey, spo2ProbeOut } = req.body;

    // Clé API simple pour sécuriser l'accès
    if (apiKey !== process.env.DEVICE_API_KEY && apiKey !== 'REA2024') {
      return res.status(401).json({ message: 'Clé API invalide' });
    }

    const monitor = await Monitor.findOne({ bedNumber }).populate('currentPatient');
    if (!monitor) return res.status(404).json({ message: `Lit ${bedNumber} introuvable` });
    if (!monitor.isOccupied || !monitor.currentPatient) {
      return res.status(400).json({ message: `Lit ${bedNumber} inoccupé` });
    }

    // Détection sonde oxymètre déconnectée
    const spo2OutDetected = spo2ProbeOut === true || spo2 === null || spo2 === undefined;
    const spo2Display     = spo2OutDetected ? 'OUT' : spo2;

    // Calcul alarmes
    const alarm = (val, min, max, cMin, cMax) => {
      if (val === null || val === undefined) return 'NORMAL';
      if (val < cMin || val > cMax) return 'CRITICAL';
      if (val < min  || val > max)  return 'WARNING';
      return 'NORMAL';
    };

    const t = monitor.thresholds;
    const hrAlarm   = alarm(fc,    t.heartRate.minVal,   t.heartRate.maxVal,   t.heartRate.criticalMin,   t.heartRate.criticalMax);
    const spo2Alarm = spo2OutDetected ? 'CRITICAL' : alarm(spo2, t.spo2.minVal, t.spo2.maxVal, t.spo2.criticalMin, t.spo2.criticalMax);
    const sbpAlarm  = alarm(pas,   t.systolicBP.minVal,  t.systolicBP.maxVal,  t.systolicBP.criticalMin,  t.systolicBP.criticalMax);
    const tempAlarm = alarm(temp,  t.temperature.minVal, t.temperature.maxVal, t.temperature.criticalMin, t.temperature.criticalMax);
    const gcsAlarm  = alarm(glasgow, t.glasgow.minVal,   t.glasgow.maxVal,     t.glasgow.criticalMin,     t.glasgow.criticalMax);

    // Alarme FR avec seuils ICU4 (< 8 ou > 18)
    let rrAlarm = 'NORMAL';
    if (fr !== null && fr !== undefined) {
      if (fr < FR_ALERT_LOW)  rrAlarm = 'CRITICAL';
      else if (fr > FR_ALERT_HIGH) rrAlarm = 'WARNING';
      else rrAlarm = alarm(fr, t.respRate.minVal, t.respRate.maxVal, t.respRate.criticalMin, t.respRate.criticalMax);
    }

    const alarms = [hrAlarm, spo2Alarm, sbpAlarm, rrAlarm, tempAlarm, gcsAlarm];
    const overallAlarm = alarms.includes('CRITICAL') ? 'CRITICAL' : alarms.includes('WARNING') ? 'WARNING' : 'NORMAL';

    // Détection type d'alarme spécifique
    const detectAlarmType = () => {
      // Oxymètre de pouls hors capteur
      if (spo2OutDetected) return { type: 'VITAL_CRITICAL', msg: `OXYMÈTRE DE POULS HORS CAPTEUR — Lit ${bedNumber}`, severity: 'CRITICAL' };
      // FR < 8 → Apnée critique
      if (fr !== undefined && fr < FR_ALERT_LOW)  return { type: 'VITAL_CRITICAL', msg: `APNÉE / BRADYPNÉE — FR=${fr}/min (seuil < ${FR_ALERT_LOW}) — Lit ${bedNumber}`, severity: 'CRITICAL' };
      // FR > 18 → Tachypnée warning
      if (fr !== undefined && fr > FR_ALERT_HIGH) return { type: 'VITAL_WARNING',  msg: `TACHYPNÉE — FR=${fr}/min (seuil > ${FR_ALERT_HIGH}) — Lit ${bedNumber}`, severity: 'MEDIUM' };
      if (fc !== undefined && fc <= 20)  return { type: 'CARDIAC_ARREST', msg: `ARRÊT CARDIAQUE — FC=${fc} bpm — Lit ${bedNumber}`, severity: 'CRITICAL' };
      if (fc !== undefined && fc >= 150) return { type: 'TACHYCARDIA',    msg: `TACHYCARDIE CRITIQUE — FC=${fc} bpm — Lit ${bedNumber}`, severity: 'CRITICAL' };
      if (fc !== undefined && fc <= 35)  return { type: 'BRADYCARDIA',    msg: `BRADYCARDIE SÉVÈRE — FC=${fc} bpm — Lit ${bedNumber}`, severity: 'CRITICAL' };
      if (spo2 !== undefined && spo2 < 88) return { type: 'DESATURATION', msg: `DÉSATURATION — SpO2=${spo2}% — Lit ${bedNumber}`, severity: 'CRITICAL' };
      // ── Pression Artérielle — Référence ICU SRLF/ESICM ──────────────
      // Hypotension critique : PAS < 90 mmHg OU PAM < 65 mmHg
      // Hypertension critique: PAS > 180 mmHg OU PAD > 120 mmHg
      const map = (pas && pad) ? Math.round((pas + 2 * pad) / 3) : null;
      if (pas !== undefined && pas < 90)  return { type: 'HYPOTENSION',   msg: `HYPOTENSION CRITIQUE — PAS=${pas} mmHg (< 90) | PAM=${map ?? '?'} mmHg — Lit ${bedNumber}`, severity: 'CRITICAL' };
      if (map !== null && map < 65)        return { type: 'HYPOTENSION',   msg: `PAM CRITIQUE — PAM=${map} mmHg (< 65) | PAS=${pas}/${pad} — Lit ${bedNumber}`, severity: 'CRITICAL' };
      if (pas !== undefined && pas > 180) return { type: 'HYPERTENSION',  msg: `HYPERTENSION CRITIQUE — PAS=${pas} mmHg (> 180) — Lit ${bedNumber}`, severity: 'CRITICAL' };
      if (pad !== undefined && pad > 120) return { type: 'HYPERTENSION',  msg: `PAD CRITIQUE — PAD=${pad} mmHg (> 120) — Lit ${bedNumber}`, severity: 'CRITICAL' };
      if (temp !== undefined && temp > 40) return { type: 'HYPERTHERMIA', msg: `HYPERTHERMIE — Temp=${temp}°C — Lit ${bedNumber}`, severity: 'HIGH' };
      if (temp !== undefined && temp < 34) return { type: 'HYPOTHERMIA',  msg: `HYPOTHERMIE — Temp=${temp}°C — Lit ${bedNumber}`, severity: 'HIGH' };
      if (glasgow !== undefined && glasgow < 8) return { type: 'COMA',    msg: `COMA / TROUBLE CONSCIENCE — Glasgow=${glasgow}/15 (< 8) — Lit ${bedNumber}`, severity: 'CRITICAL' };
      if (overallAlarm === 'CRITICAL') return { type: 'VITAL_CRITICAL', msg: `ALERTE CRITIQUE — Lit ${bedNumber}`, severity: 'CRITICAL' };
      if (overallAlarm === 'WARNING')  return { type: 'VITAL_WARNING',  msg: `AVERTISSEMENT — Lit ${bedNumber}`, severity: 'MEDIUM' };
      return null;
    };

    // Sauvegarder
    const vital = new VitalSign({
      monitorId: monitor._id,
      patientId: monitor.currentPatient._id,
      heartRate:    { value: fc,      alarm: hrAlarm },
      spo2:         { value: spo2,    alarm: spo2Alarm },
      systolicBP:   { value: pas,     alarm: sbpAlarm },
      diastolicBP:  { value: pad,     alarm: 'NORMAL' },
      meanArterialPressure: pas && pad ? Math.round((pas + 2 * pad) / 3) : null,
      respRate:     { value: fr,      alarm: rrAlarm },
      temperature:  { value: temp,    alarm: tempAlarm },
      etco2:        { value: etco2,   alarm: 'NORMAL' },
      glasgow:      { value: glasgow, alarm: gcsAlarm },
      overallAlarm,
      timestamp: new Date()
    });
    await vital.save();

    // Mettre à jour le moniteur
    await Monitor.findByIdAndUpdate(monitor._id, {
      alarmStatus: overallAlarm,
      'lastVitals.heartRate': fc, 'lastVitals.spo2': spo2,
      'lastVitals.systolicBP': pas, 'lastVitals.diastolicBP': pad,
      'lastVitals.respRate': fr, 'lastVitals.temperature': temp,
      'lastVitals.etco2': etco2, 'lastVitals.glasgow': glasgow,
      'lastVitals.timestamp': new Date()
    });

    // Créer alerte MongoDB si seuil franchi
    const detectedAlarm = detectAlarmType();
    if (detectedAlarm) {
      try {
        // Mapper vers les types valides du schema Alert
        const VALID_TYPES = ['VITAL_CRITICAL','VITAL_WARNING','EQUIPMENT','AI_PREDICTION','MEDICATION','MANUAL','BRACELET_FALL'];
        const alertType = VALID_TYPES.includes(detectedAlarm.type) ? detectedAlarm.type
          : detectedAlarm.severity === 'CRITICAL' ? 'VITAL_CRITICAL' : 'VITAL_WARNING';

        const alertDoc = await Alert.create({
          monitorId:    monitor._id,
          patientId:    monitor.currentPatient._id,
          type:         alertType,
          severity:     detectedAlarm.severity,
          parameter:    detectedAlarm.type,   // ex: 'CARDIAC_ARREST', 'DESATURATION'
          currentValue: fc ?? spo2 ?? pas ?? fr ?? temp ?? glasgow,
          message:      detectedAlarm.msg,
        });
        try {
          const socketIo = ioInstance.getIo();
          if (socketIo) socketIo.to('rea-dashboard').emit('alert:new', alertDoc);
        } catch {}
      } catch {}
    }

    // Prédictions ICU4 (asynchrone — ne bloque pas la réponse)
    let icu4Predictions = null;
    try {
      const map = pas && pad ? Math.round((pas + 2 * pad) / 3) : null;
      const icu4Res = await axios.post(`${ML_URL}/predict-icu4-alerts`, {
        heart_rate:     fc,
        spo2:           spo2OutDetected ? null : spo2,
        resp_rate:      fr,
        temperature:    temp,
        map_value:      map,
        spo2_probe_out: spo2OutDetected,
        pni_interval:   monitor.pniInterval || 15,
        spo2_mode:      monitor.spo2Mode    || 'continuous'
      }, { timeout: 3000 });
      icu4Predictions = icu4Res.data;

      // Créer alertes MongoDB depuis prédictions ICU4 (choc septique, détresse resp, hémo)
      if (icu4Predictions?.alerts?.length) {
        for (const a of icu4Predictions.alerts) {
          if (a.severity === 'CRITICAL' || a.severity === 'HIGH') {
            try {
              const aiAlert = await Alert.create({
                monitorId: monitor._id,
                patientId: monitor.currentPatient._id,
                type:      'AI_PREDICTION',
                severity:  a.severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
                parameter: a.parameter || a.code,
                currentValue: a.value,
                message:   a.message,
              });
              try {
                const socketIo = ioInstance.getIo();
                if (socketIo) socketIo.to('rea-dashboard').emit('alert:new', aiAlert);
              } catch {}
            } catch {}
          }
        }
      }
    } catch {}

    // Émettre en temps réel sur le dashboard
    try {
      const socketIo = ioInstance.getIo();
      if (socketIo) socketIo.to('rea-dashboard').emit('vitals:update', {
        monitorId: monitor._id,
        monitorCode: monitor.monitorId,
        bedNumber: monitor.bedNumber,
        patientId: monitor.currentPatient._id,
        vitals: {
          heartRate: fc, heartRateAlarm: hrAlarm,
          spo2: spo2Display, spo2Alarm, spo2ProbeOut: spo2OutDetected,
          systolicBP: pas, diastolicBP: pad, bpAlarm: sbpAlarm,
          respRate: fr, rrAlarm,
          frAlertLow: FR_ALERT_LOW, frAlertHigh: FR_ALERT_HIGH,
          temperature: temp, tempAlarm,
          etco2, glasgow, gcsAlarm
        },
        overallAlarm,
        icu4: icu4Predictions,
        pniInterval: monitor.pniInterval || 15,
        spo2Mode:    monitor.spo2Mode    || 'continuous',
        timestamp: new Date()
      });
    } catch {}

    res.json({
      message: 'Signes vitaux reçus',
      lit: bedNumber,
      alarme: overallAlarm,
      spo2Status: spo2OutDetected ? 'OUT' : 'OK',
      frStatus: rrAlarm,
      icu4: icu4Predictions?.overall_status || null
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/vitals/monitor/:monitorId/pni-settings — régler intervalle PNI et mode SpO2
router.put('/monitor/:monitorId/pni-settings', authenticate, async (req, res) => {
  try {
    const { pniInterval, spo2Mode } = req.body;
    const updates = {};

    if (pniInterval !== undefined) {
      if (!PNI_INTERVALS.includes(Number(pniInterval))) {
        return res.status(400).json({
          message: `Intervalle PNI invalide. Valeurs acceptées: ${PNI_INTERVALS.join(', ')} minutes`
        });
      }
      updates.pniInterval = Number(pniInterval);
    }

    if (spo2Mode !== undefined) {
      const validModes = ['continuous', '5min', '10min', 'manual'];
      if (!validModes.includes(spo2Mode)) {
        return res.status(400).json({ message: `Mode SpO2 invalide. Valeurs: ${validModes.join(', ')}` });
      }
      updates.spo2Mode = spo2Mode;
    }

    const monitor = await Monitor.findByIdAndUpdate(
      req.params.monitorId, updates, { new: true }
    );
    if (!monitor) return res.status(404).json({ message: 'Moniteur introuvable' });

    const socketIo = ioInstance.getIo();
    if (socketIo) socketIo.to('rea-dashboard').emit('monitor:settings-update', {
      monitorId: monitor._id,
      bedNumber: monitor.bedNumber,
      pniInterval: monitor.pniInterval,
      spo2Mode: monitor.spo2Mode
    });

    res.json({
      message: 'Paramètres mis à jour',
      pniInterval: monitor.pniInterval,
      spo2Mode:    monitor.spo2Mode,
      pniIntervalLabel: _pniLabel(monitor.pniInterval)
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/vitals/config/icu4 — seuils et intervalles ICU4
router.get('/config/icu4', authenticate, async (req, res) => {
  try {
    const mlCfg = await axios.get(`${ML_URL}/icu4/config`, { timeout: 3000 }).catch(() => null);
    res.json({
      fr_thresholds: { low: FR_ALERT_LOW, high: FR_ALERT_HIGH, unit: '/min' },
      pni_intervals: PNI_INTERVALS,
      pni_labels:   ['1min','2min','2.5min','5min','10min','15min','30min','1H','2H','4H','8H'],
      spo2_modes:   ['continuous','5min','10min','manual'],
      spo2_probe_out_display: 'OUT',
      ml_config: mlCfg?.data || null
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

function _pniLabel(minutes) {
  if (!minutes) return '15min';
  if (minutes >= 60) return `${minutes/60}H`;
  return `${minutes}min`;
}

// GET /api/vitals/:patientId/history — historique vitaux
router.get('/:patientId/history', authenticate, async (req, res) => {
  try {
    const { minutes = 60 } = req.query;
    const since = new Date(Date.now() - minutes * 60 * 1000);

    const vitals = await VitalSign.find({
      patientId: req.params.patientId,
      timestamp: { $gte: since }
    })
    .sort({ timestamp: 1 })
    .select('heartRate spo2 systolicBP diastolicBP respRate temperature etco2 glasgow timestamp overallAlarm');

    res.json(vitals);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/vitals/:patientId/latest — derniers vitaux
router.get('/:patientId/latest', authenticate, async (req, res) => {
  try {
    const vital = await VitalSign.findOne({ patientId: req.params.patientId })
      .sort({ timestamp: -1 });
    if (!vital) return res.status(404).json({ message: 'Aucun relevé trouvé' });
    res.json(vital);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/vitals/:patientId/trends — tendances sur 24h
router.get('/:patientId/trends', authenticate, async (req, res) => {
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const vitals = await VitalSign.find({
      patientId: req.params.patientId,
      timestamp: { $gte: since24h }
    }).sort({ timestamp: 1 });

    // Agrégation toutes les heures
    const hourlyTrends = {};
    vitals.forEach(v => {
      const hour = new Date(v.timestamp).getHours();
      if (!hourlyTrends[hour]) {
        hourlyTrends[hour] = { count: 0, heartRate: 0, spo2: 0, systolicBP: 0, temp: 0 };
      }
      hourlyTrends[hour].count++;
      hourlyTrends[hour].heartRate += v.heartRate?.value || 0;
      hourlyTrends[hour].spo2 += v.spo2?.value || 0;
      hourlyTrends[hour].systolicBP += v.systolicBP?.value || 0;
      hourlyTrends[hour].temp += v.temperature?.value || 0;
    });

    const trends = Object.entries(hourlyTrends).map(([hour, data]) => ({
      hour: parseInt(hour),
      heartRate: Math.round(data.heartRate / data.count),
      spo2: Math.round(data.spo2 / data.count),
      systolicBP: Math.round(data.systolicBP / data.count),
      temperature: parseFloat((data.temp / data.count).toFixed(1))
    }));

    res.json(trends);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
