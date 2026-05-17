/**
 * SIMULATEUR DE MONITEURS PHYSIQUES
 * Simule les données envoyées par des moniteurs GE/Mindray/Nihon Kohden
 * Génère des paramètres vitaux réalistes avec variations physiologiques
 */
const Monitor = require('../models/Monitor');
const Patient = require('../models/Patient');
const VitalSign = require('../models/VitalSign');
const Alert = require('../models/Alert');
const axios = require('axios');

const ML_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

// Seuils FR ICU4
const FR_ALERT_LOW  = 8;
const FR_ALERT_HIGH = 18;

/*
 * PROFILS CLINIQUES ICU — Référence SRLF/ESICM
 *
 * Valeurs normales adulte :  PAS 120 / PAD 80 → PAM ≈ 93 mmHg
 * ICU normal :               PAS 90–120 | PAD 60–80 | PAM 65–100
 *
 * Seuils d'alerte CRITIQUE :
 *   Hypotension : PAS < 90 mmHg  OU  PAM < 65 mmHg
 *   Hypertension: PAS > 180 mmHg OU  PAD > 120 mmHg
 *   FR          : apnée < 8 /min | tachypnée > 18 /min (max simulé 23)
 *
 * PAM = (PAS + 2×PAD) / 3
 */
const PATIENT_PROFILES = {

  // STABLE — post-opératoire, récupération
  // Centré sur 120/80 → PAM ≈ 93 mmHg — aucune alerte
  STABLE: {
    hr:    [62,  88],   // 60–90 bpm   normocardie
    spo2:  [96,  99],   // 96–99%      normoxie
    sbp:   [112, 132],  // 112–132 mmHg → centré ~120 mmHg
    dbp:   [74,  86],   // 74–86 mmHg  → centré ~80 mmHg
    // PAM = (122 + 2×80)/3 = 94 mmHg ✓ > 65
    rr:    [12,  17],   // 12–17 /min  eupnée
    temp:  [36.5, 37.4],// °C          normothermie
    etco2: [35,  42],   // mmHg        normocapnie
    gcs:   15,
  },

  // MODERATE — sepsis léger, instabilité débutante
  // PAS limite basse, PAM borderline → alertes WARNING
  MODERATE: {
    hr:    [95,  115],  // tachycardie modérée
    spo2:  [92,  95],   // hypoxémie légère
    sbp:   [90,  105],  // 90–105 mmHg → PAS limite (ICU normal ≥ 90)
    dbp:   [58,  72],   // 58–72 mmHg  → PAD limite basse
    // PAM ex: (97 + 2×65)/3 = 76 mmHg → limite
    rr:    [19,  23],   // tachypnée (> 18 → alerte)
    temp:  [37.8, 38.9],// fièvre modérée
    etco2: [28,  35],
    gcs:   12,
  },

  // CRITICAL — choc septique / SDRA / défaillance multi-organes
  // PAS < 90 → hypotension critique | PAM < 65 → urgence perfusion
  CRITICAL: {
    hr:    [120, 150],  // tachycardie sévère
    spo2:  [80,  88],   // hypoxémie sévère (critique < 88%)
    sbp:   [65,  88],   // 65–88 mmHg → PAS < 90 = hypotension critique
    dbp:   [38,  55],   // 38–55 mmHg
    // PAM ex: (76 + 2×46)/3 = 56 mmHg → < 65 = CRITIQUE
    rr:    [20,  23],   // tachypnée max 23
    temp:  [38.8, 40.5],// hyperthermie
    etco2: [18,  27],
    gcs:   6,           // coma (< 8 = critique)
  },

  // CARDIAC — bradycardie + insuffisance cardiaque congestive
  // PAS limite, FR basse → risque apnée (< 8 /min)
  CARDIAC: {
    hr:    [38,  52],   // bradycardie sévère
    spo2:  [88,  93],   // hypoxémie modérée
    sbp:   [85,  105],  // 85–105 mmHg → borderline (ICU normal ≥ 90)
    dbp:   [52,  68],   // 52–68 mmHg  → PAD limite basse
    // PAM ex: (95 + 2×60)/3 = 72 mmHg → acceptable
    rr:    [4,    8],   // bradypnée/apnée → alerte < 8 (min simulé = 4)
    temp:  [36.2, 37.0],
    etco2: [26,  34],
    gcs:   13,
  },

  // HYPERTENSIVE — crise hypertensive / urgence tensionnelle
  // PAS 185-260 mmHg | PAD 100-120 mmHg → CRITIQUE (AVC, atteinte cardiaque)
  HYPERTENSIVE: {
    hr:    [88,  105],  // tachycardie modérée associée
    spo2:  [94,  97],   // normale
    sbp:   [185, 260],  // PAS 185–260 mmHg → > 180 = CRITIQUE
    dbp:   [100, 120],  // PAD 100–120 mmHg → > 120 = CRITIQUE
    // PAM ex: (220 + 2×110)/3 = 147 mmHg → hypertension majeure
    rr:    [16,  22],   // légère tachypnée
    temp:  [36.8, 37.6],
    etco2: [34,  42],
    gcs:   14,
  },
};

function randInRange([min, max], decimals = 0) {
  const val = min + Math.random() * (max - min);
  return decimals ? parseFloat(val.toFixed(decimals)) : Math.round(val);
}

function checkAlarmStatus(value, thresholds) {
  if (value == null || !thresholds) return 'NORMAL';
  const cMin = thresholds.criticalMin;
  const cMax = thresholds.criticalMax;
  const min  = thresholds.minVal ?? thresholds.min;
  const max  = thresholds.maxVal ?? thresholds.max;
  if (cMin != null && value < cMin) return 'CRITICAL';
  if (cMax != null && value > cMax) return 'CRITICAL';
  if (min  != null && value < min)  return 'WARNING';
  if (max  != null && value > max)  return 'WARNING';
  return 'NORMAL';
}

function generateECGWaveform(heartRate) {
  // Génère un tableau de 100 points simulant un ECG
  const points = [];
  const period = Math.round(100 / (heartRate / 60));
  for (let i = 0; i < 100; i++) {
    const phase = (i % period) / period;
    let val = 0;
    if (phase < 0.1) val = phase * 10;
    else if (phase < 0.15) val = 1 - (phase - 0.1) * 20;
    else if (phase < 0.2) val = 0.5;
    else if (phase < 0.25) val = 3 * Math.sin((phase - 0.2) * 40);
    else if (phase < 0.35) val = 0.2;
    else if (phase < 0.45) val = 0.8 * Math.sin((phase - 0.35) * 20);
    points.push(parseFloat(val.toFixed(3)));
  }
  return points;
}

async function startVitalSimulator(io) {
  console.log('🔄 Simulateur de vitaux démarré');

  setInterval(async () => {
    try {
      const monitors = await Monitor.find({ isOnline: true, isOccupied: true })
        .populate('currentPatient', 'status urgencyLevel gravityScore');

      /*
       * Distribution clinique réaliste pour 6 lits REA :
       *   LIT-01 → CRITIQUE  (choc, SDRA)
       *   LIT-02 → URGENT    (sepsis débutant)
       *   LIT-03 → CARDIAQUE (bradycardie/IC)
       *   LIT-04 à LIT-06 → STABLE  (post-op, récupération)
       */
      const profileMap = new Map();
      monitors.forEach((m) => {
        const bed = m.bedNumber;
        if      (bed === 'LIT-01') profileMap.set(m._id.toString(), PATIENT_PROFILES.CRITICAL);
        else if (bed === 'LIT-02') profileMap.set(m._id.toString(), PATIENT_PROFILES.MODERATE);
        else if (bed === 'LIT-03') profileMap.set(m._id.toString(), PATIENT_PROFILES.CARDIAC);
        else if (bed === 'LIT-04') profileMap.set(m._id.toString(), PATIENT_PROFILES.HYPERTENSIVE);
        else                       profileMap.set(m._id.toString(), PATIENT_PROFILES.STABLE);
      });

      for (const monitor of monitors) {
        const patient = monitor.currentPatient;
        if (!patient) continue;

        // Profil fixe par session (1 critique, 2 modérés, reste stable)
        const profile = profileMap.get(monitor._id.toString()) || PATIENT_PROFILES.STABLE;

        const hr = randInRange(profile.hr);
        const spo2 = randInRange(profile.spo2);
        const sbp = randInRange(profile.sbp);
        const dbp = randInRange(profile.dbp);
        const rr = randInRange(profile.rr);
        const temp = randInRange(profile.temp, 1);
        const etco2 = randInRange(profile.etco2);
        const gcs = Math.max(3, Math.min(15, profile.gcs + Math.round((Math.random() - 0.5) * 2)));

        // Simuler sonde SpO2 déconnectée (5% de chance sur patients CRITICAL)
        const spo2ProbeOut = (profile === PATIENT_PROFILES.CRITICAL) && Math.random() < 0.05;
        const spo2Display  = spo2ProbeOut ? null : spo2;

        const thresholds = monitor.thresholds;
        const hrAlarm   = checkAlarmStatus(hr,   thresholds.heartRate);
        const spo2Alarm = spo2ProbeOut ? 'CRITICAL' : checkAlarmStatus(spo2, thresholds.spo2);
        const tempAlarm = checkAlarmStatus(temp, thresholds.temperature);

        // PAS et PAD — utiliser les seuils réels du moniteur MongoDB
        const sbpAlarm = checkAlarmStatus(sbp, thresholds.systolicBP);
        const dbpAlarm = checkAlarmStatus(dbp, thresholds.diastolicBP);

        // Alarme PA globale = pire des deux
        const bpAlarm = sbpAlarm === 'CRITICAL' || dbpAlarm === 'CRITICAL' ? 'CRITICAL' :
                        sbpAlarm === 'WARNING'  || dbpAlarm === 'WARNING'  ? 'WARNING'  : 'NORMAL';

        // Glasgow ICU4: < 8 → CRITICAL (coma/trouble conscience), < 10 → WARNING
        let gcsAlarm = 'NORMAL';
        if (gcs < 8)       gcsAlarm = 'CRITICAL';
        else if (gcs < 10) gcsAlarm = 'WARNING';
        else               gcsAlarm = checkAlarmStatus(gcs, thresholds.glasgow);

        // Alarme FR ICU4: < 8 → CRITICAL, > 18 → WARNING
        let rrAlarm = 'NORMAL';
        if (rr < FR_ALERT_LOW)       rrAlarm = 'CRITICAL';
        else if (rr > FR_ALERT_HIGH) rrAlarm = 'WARNING';
        else                         rrAlarm = checkAlarmStatus(rr, thresholds.respRate);

        // Statut global
        const alarms = [hrAlarm, spo2Alarm, bpAlarm, rrAlarm, tempAlarm, gcsAlarm];
        const overallAlarm = alarms.includes('CRITICAL') ? 'CRITICAL' :
                             alarms.includes('WARNING') ? 'WARNING' : 'NORMAL';

        // Sauvegarder relevé — 1 fois toutes les 5 minutes par patient (au lieu de toutes les 3s)
        const now = Date.now();
        if (!monitor._lastSave) monitor._lastSave = {};
        const lastSave = monitor._lastSave[patient._id.toString()] || 0;
        if (now - lastSave >= 5 * 60 * 1000) {
          monitor._lastSave[patient._id.toString()] = now;
          const vitalSign = new VitalSign({
            monitorId: monitor._id,
            patientId: patient._id,
            heartRate: { value: hr, alarm: hrAlarm },
            spo2: { value: spo2Display, alarm: spo2Alarm },
            systolicBP: { value: sbp, alarm: sbpAlarm },
            diastolicBP: { value: dbp, alarm: dbpAlarm },
            meanArterialPressure: Math.round((sbp + 2 * dbp) / 3),
            respRate: { value: rr, alarm: rrAlarm },
            temperature: { value: temp, alarm: tempAlarm },
            etco2: { value: etco2, alarm: 'NORMAL' },
            glasgow: { value: Math.max(3, Math.min(15, gcs)), alarm: gcsAlarm },
            ecgWaveform: generateECGWaveform(hr),
            overallAlarm,
            timestamp: new Date()
          });
          try { await vitalSign.save(); } catch (_) {}
        }

        // Mettre à jour lastVitals dans le moniteur
        await Monitor.findByIdAndUpdate(monitor._id, {
          alarmStatus: overallAlarm,
          'lastVitals.heartRate': hr,
          'lastVitals.spo2': spo2,
          'lastVitals.systolicBP': sbp,
          'lastVitals.diastolicBP': dbp,
          'lastVitals.respRate': rr,
          'lastVitals.temperature': temp,
          'lastVitals.etco2': etco2,
          'lastVitals.glasgow': Math.max(3, Math.min(15, gcs)),
          'lastVitals.timestamp': new Date()
        });

        // Créer alertes si critique — anti-doublon 30s pour ne pas spammer la DB
        if (overallAlarm === 'CRITICAL') {
          const critParam = alarms.findIndex(a => a === 'CRITICAL');
          const paramNames = ['heartRate','spo2','bp_3s','respRate','temperature','glasgow'];
          const paramValues = [hr, spo2ProbeOut ? 'OUT' : spo2, sbp, rr, temp, gcs];
          const paramLabels = ['FC','SpO2','PAS','FR','Temp','Glasgow'];
          const paramKey = paramNames[critParam];

          // 1 alerte max par paramètre toutes les 30s (évite le flood DB)
          const recentSim = await Alert.findOne({
            patientId: patient._id, parameter: paramKey,
            createdAt: { $gte: new Date(Date.now() - 30000) }
          });

          if (!recentSim) {
            let alertMsg;
            if (spo2ProbeOut && critParam === 1) {
              alertMsg = `OXYMÈTRE DE POULS HORS CAPTEUR — Lit ${monitor.bedNumber}`;
            } else if (paramKey === 'respRate' && rr < FR_ALERT_LOW) {
              alertMsg = `APNÉE / BRADYPNÉE CRITIQUE — FR=${rr}/min (seuil < ${FR_ALERT_LOW}) — Lit ${monitor.bedNumber}`;
            } else if (paramKey === 'glasgow' && gcs < 8) {
              alertMsg = `COMA / TROUBLE CONSCIENCE — Glasgow=${gcs}/15 (< 8) — Lit ${monitor.bedNumber}`;
            } else {
              alertMsg = `ALERTE CRITIQUE: ${paramLabels[critParam]} = ${paramValues[critParam]} — Lit ${monitor.bedNumber}`;
            }

            const alert = new Alert({
              monitorId: monitor._id,
              patientId: patient._id,
              type: 'VITAL_CRITICAL',
              severity: 'CRITICAL',
              parameter: paramKey,
              currentValue: typeof paramValues[critParam] === 'number' ? paramValues[critParam] : null,
              message: alertMsg,
            });
            await alert.save();

            io.to('rea-dashboard').emit('alert:new', {
              ...alert.toObject(),
              monitorId: monitor.monitorId,
              bedNumber: monitor.bedNumber
            });
          }
        }

        // Émettre via WebSocket temps réel
        const payload = {
          monitorId: monitor._id,
          monitorCode: monitor.monitorId,
          bedNumber: monitor.bedNumber,
          patientId: patient._id,
          vitals: {
            heartRate: hr, heartRateAlarm: hrAlarm,
            spo2: spo2ProbeOut ? 'OUT' : spo2, spo2Alarm, spo2ProbeOut,
            systolicBP: sbp, diastolicBP: dbp, bpAlarm,
            map: Math.round((sbp + 2 * dbp) / 3),
            respRate: rr, rrAlarm,
            frAlertLow: FR_ALERT_LOW, frAlertHigh: FR_ALERT_HIGH,
            temperature: temp, tempAlarm,
            etco2, glasgow: Math.max(3, Math.min(15, gcs)), gcsAlarm,
            ecgWaveform: generateECGWaveform(hr),
          },
          overallAlarm,
          timestamp: new Date()
        };

        io.to('rea-dashboard').emit('vitals:update', payload);
        io.to(`monitor:${monitor._id}`).emit('vitals:detail', { ...payload });
      }
    } catch (err) {
      console.error('Simulateur erreur:', err.message);
    }
  }, 3000); // Toutes les 3 secondes

  /* ══════════════════════════════════════════════════════════════════
     ALERTES CRITIQUES — toutes les 30 secondes
     5 types d'alertes DIFFÉRENTES via Socket :
       1. COMA        — Glasgow < 8
       2. APNÉE       — FR < 8 /min
       3. TACHYPNÉE   — FR > 18 /min
       4. CHOC SEPTIQUE     — ICU4 ML risk_septic_shock ≥ 30%
       5. DÉTRESSE RESP.    — ICU4 ML risk_resp_failure ≥ 30%
       6. INSTAB. HÉMODY.   — ICU4 ML risk_hemo_instability ≥ 30%
  ══════════════════════════════════════════════════════════════════ */
  setInterval(async () => {
    try {
      const monitors = await Monitor.find({ isOnline: true, isOccupied: true })
        .populate('currentPatient', 'firstName lastName status urgencyLevel');

      for (const monitor of monitors) {
        const patient = monitor.currentPatient;
        if (!patient) continue;

        const lv = monitor.lastVitals;
        if (!lv) continue;

        const pName = `${patient.firstName} ${patient.lastName}`;
        const bed   = monitor.bedNumber;
        const checks = [];

        // ── 1. Glasgow < 8 → COMA ─────────────────────────────────────────────
        // Paramètre 'coma_alert' ≠ 'glasgow' → jamais bloqué par le simulateur 3s
        if (lv.glasgow != null && lv.glasgow < 8) {
          checks.push({ parameter: 'coma_alert', severity: 'CRITICAL', type: 'COMA',
            alertCode: 'COMA', socketEvent: 'alert:coma',
            currentValue: lv.glasgow,
            message: `🧠 COMA / TROUBLE CONSCIENCE — Glasgow=${lv.glasgow}/15 (seuil < 8) — ${pName} — Lit ${bed}`,
            action: 'Protection voies aériennes — intubation si GCS ≤ 8' });
        }

        // ── 2. FR < 8 → APNÉE ────────────────────────────────────────────────
        // Paramètre 'apnea_alert' ≠ 'respRate' → jamais bloqué par le simulateur 3s
        if (lv.respRate != null && lv.respRate < FR_ALERT_LOW) {
          checks.push({ parameter: 'apnea_alert', severity: 'CRITICAL', type: 'VITAL_CRITICAL',
            alertCode: 'APNEA', socketEvent: 'alert:apnea',
            currentValue: lv.respRate,
            message: `🫁 APNÉE / BRADYPNÉE — FR=${lv.respRate}/min (seuil < ${FR_ALERT_LOW}) — ${pName} — Lit ${bed}`,
            action: 'Stimuler le patient — ventilation assistée en urgence' });
        }

        // ── 3. FR > 18 → TACHYPNÉE ───────────────────────────────────────────
        // Paramètre 'tachypnea_alert' → jamais bloqué par le simulateur 3s
        if (lv.respRate != null && lv.respRate > FR_ALERT_HIGH) {
          checks.push({ parameter: 'tachypnea_alert', severity: 'HIGH', type: 'VITAL_WARNING',
            alertCode: 'TACHYPNEA', socketEvent: 'alert:tachypnea',
            currentValue: lv.respRate,
            message: `🫁 TACHYPNÉE — FR=${lv.respRate}/min (seuil > ${FR_ALERT_HIGH}) — ${pName} — Lit ${bed}`,
            action: 'Évaluer: douleur, sepsis, acidose, hypoxie' });
        }

        // ── PA — Référence ICU : normale 120/80, PAM = (PAS + 2×PAD) / 3 ──────
        const mapVal = lv.systolicBP && lv.diastolicBP
          ? Math.round((lv.systolicBP + 2 * lv.diastolicBP) / 3) : null;

        // 4. Hypotension critique : PAS < 90 (norme ICU) ou PAM < 65
        if (lv.systolicBP != null && lv.systolicBP < 90) {
          checks.push({ parameter: 'bp_hypotension',
            severity: 'CRITICAL', type: 'VITAL_CRITICAL',
            alertCode: 'HYPOTENSION CRITIQUE', socketEvent: 'alert:bp-low',
            currentValue: lv.systolicBP,
            message: `HYPOTENSION CRITIQUE — PAS=${lv.systolicBP} mmHg (< 90) | PAD=${lv.diastolicBP ?? '?'} | PAM=${mapVal ?? '?'} mmHg — ${pName} — Lit ${bed}`,
            action: 'Remplissage vasculaire — Noradrénaline si PAM < 65 mmHg — Bilan hemodynamique urgent' });
        } else if (mapVal != null && mapVal < 65) {
          checks.push({ parameter: 'map_basse',
            severity: 'CRITICAL', type: 'VITAL_CRITICAL',
            alertCode: 'PAM BASSE', socketEvent: 'alert:bp-low',
            currentValue: mapVal,
            message: `PAM CRITIQUE — PAM=${mapVal} mmHg (< 65) | PAS=${lv.systolicBP}/${lv.diastolicBP} — ${pName} — Lit ${bed}`,
            action: 'Perfusion insuffisante — Vasopresseurs urgents — Risque défaillance organes' });
        }

        // 5. Hypertension critique : PAS > 180 — Risque AVC / atteinte cardiaque
        if (lv.systolicBP != null && lv.systolicBP > 180) {
          checks.push({ parameter: 'bp_hta',
            severity: 'CRITICAL', type: 'VITAL_CRITICAL',
            alertCode: 'HYPERTENSION CRITIQUE', socketEvent: 'alert:bp-high',
            currentValue: lv.systolicBP,
            message: `HYPERTENSION CRITIQUE — PAS=${lv.systolicBP} mmHg (> 180) | PAM=${mapVal ?? '?'} — ${pName} — Lit ${bed}`,
            action: 'Antihypertenseurs IV urgents — Risque AVC et atteinte cardiaque' });
        }

        // 6. PAD > 120 → hypertension diastolique critique
        if (lv.diastolicBP != null && lv.diastolicBP > 120) {
          checks.push({ parameter: 'pad_elevee',
            severity: 'CRITICAL', type: 'VITAL_CRITICAL',
            alertCode: 'PAD CRITIQUE', socketEvent: 'alert:dbp-high',
            currentValue: lv.diastolicBP,
            message: `PAD CRITIQUE — PAD=${lv.diastolicBP} mmHg (> 120) | PAM=${mapVal ?? '?'} — ${pName} — Lit ${bed}`,
            action: 'Antihypertenseurs — Surveillance renale et cardiaque urgente' });
        }

        // ── 8-10. Prédictions ICU4 ML (3 risques) ────────────────────────────
        try {
          const map = lv.systolicBP && lv.diastolicBP
            ? Math.round((lv.systolicBP + 2 * lv.diastolicBP) / 3) : 70;

          const icu4Res = await axios.post(`${ML_URL}/predict-icu4-alerts`, {
            heart_rate: lv.heartRate, spo2: lv.spo2,
            resp_rate: lv.respRate || 16, temperature: lv.temperature || 37,
            map_value: map,
          }, { timeout: 5000 });

          const pred = icu4Res.data?.icu4_predictions || {};

          const septicP = pred.septic_shock?.probability   || 0;
          const respP   = pred.resp_failure?.probability   || 0;
          const hemoP   = pred.hemo_instability?.probability || 0;

          if (septicP >= 0.3) {
            checks.push({ parameter: 'risk_septic_shock',
              severity: septicP >= 0.6 ? 'CRITICAL' : 'HIGH', type: 'AI_PREDICTION',
              alertCode: 'SEPTIC_SHOCK', socketEvent: 'alert:septic-shock',
              currentValue: Math.round(septicP * 100),
              message: `🦠 RISQUE CHOC SEPTIQUE — ${Math.round(septicP*100)}% (ICU4-XGBoost) — ${pName} — Lit ${bed}`,
              action: 'Bundle Surviving Sepsis: hémocultures → ATB → remplissage → Noradrénaline si PAM < 65' });
          }

          if (respP >= 0.3) {
            checks.push({ parameter: 'risk_resp_failure',
              severity: respP >= 0.6 ? 'CRITICAL' : 'HIGH', type: 'AI_PREDICTION',
              alertCode: 'RESP_FAILURE', socketEvent: 'alert:resp-failure',
              currentValue: Math.round(respP * 100),
              message: `🫁 RISQUE DÉTRESSE RESPIRATOIRE — ${Math.round(respP*100)}% (ICU4-XGBoost) — ${pName} — Lit ${bed}`,
              action: 'GDS en urgence — optimiser O2 — envisager VNI ou intubation' });
          }

          if (hemoP >= 0.3) {
            checks.push({ parameter: 'risk_hemo_instability',
              severity: hemoP >= 0.6 ? 'CRITICAL' : 'HIGH', type: 'AI_PREDICTION',
              alertCode: 'HEMO_INSTABILITY', socketEvent: 'alert:hemo-instability',
              currentValue: Math.round(hemoP * 100),
              message: `💉 RISQUE INSTABILITÉ HÉMODYNAMIQUE — ${Math.round(hemoP*100)}% (ICU4-XGBoost) — ${pName} — Lit ${bed}`,
              action: 'Écho-cœur — monitoring hémodynamique renforcé — remplissage / vasopresseurs' });
          }
        } catch { /* ML non disponible */ }

        // ── Enregistrement + émission Socket par type ─────────────────────────
        // Fenêtre anti-doublon = 29s (< 30s interval) → 2ème alerte toujours autorisée
        for (const check of checks) {
          const recent = await Alert.findOne({
            patientId: patient._id, parameter: check.parameter, resolved: false,
            createdAt: { $gte: new Date(Date.now() - 29000) }
          });
          if (recent) continue;

          const alert = new Alert({
            monitorId: monitor._id, patientId: patient._id,
            type: check.type, severity: check.severity,
            parameter: check.parameter, currentValue: check.currentValue,
            message: check.message,
          });
          await alert.save();

          const payload = {
            ...alert.toObject(),
            monitorId: monitor.monitorId, bedNumber: bed,
            alertCode: check.alertCode, action: check.action,
            patientName: pName, source: 'critical-30s',
          };

          // Événement générique + événement spécifique par type
          io.to('rea-dashboard').emit('alert:new',       payload);
          io.to('rea-dashboard').emit(check.socketEvent, payload);
        }
      }
    } catch (err) {
      console.error('[Alerte 30s] Erreur:', err.message);
    }
  }, 30000); // Toutes les 30 secondes

  /* ══════════════════════════════════════════════════════════
     SCORE IA ICU4 — toutes les 5 minutes
     Calcule les 3 risques simultanés + mortalité pour chaque
     patient actif et met à jour gravityScore dans MongoDB
  ══════════════════════════════════════════════════════════ */
  setInterval(async () => {
    try {
      const monitors = await Monitor.find({ isOnline: true, isOccupied: true })
        .populate('currentPatient');

      let updated = 0;
      for (const monitor of monitors) {
        const patient = monitor.currentPatient;
        if (!patient) continue;

        const lv = monitor.lastVitals;
        if (!lv || !lv.heartRate || !lv.spo2) continue;

        const map = lv.systolicBP && lv.diastolicBP
          ? Math.round((lv.systolicBP + 2 * lv.diastolicBP) / 3)
          : 70;

        try {
          // ── 3 risques simultanés (ICU4/ICU — Hospital A 50k) ──────────────
          const icu4Res = await axios.post(`${ML_URL}/predict-icu4-alerts`, {
            heart_rate:  lv.heartRate,
            spo2:        lv.spo2,
            resp_rate:   lv.respRate   || 16,
            temperature: lv.temperature || 37,
            map_value:   map,
          }, { timeout: 8000 });

          const pred = icu4Res.data.icu4_predictions || {};
          const septic = pred.septic_shock?.probability   || 0;
          const resp   = pred.resp_failure?.probability   || 0;
          const hemo   = pred.hemo_instability?.probability || 0;
          const maxScore = Math.round(Math.max(septic, resp, hemo) * 100);

          // ── Mortalité hospitalière (TRAINNING/WiDS 2020 — 91 713 patients) ─
          const mortRes = await axios.post(`${ML_URL}/predict`, {
            patient_id: String(patient._id),
            age:        patient.age || 50,
            sex:        patient.sex || 'M',
            vitals: {
              heart_rate:   lv.heartRate   || null,
              spo2:         lv.spo2        || null,
              resp_rate:    lv.respRate    || null,
              temperature:  lv.temperature || null,
              systolic_bp:  lv.systolicBP  || null,
              diastolic_bp: lv.diastolicBP || null,
              glasgow:      lv.glasgow     || null,
            },
            chronic_diseases: patient.chronicDiseases || [],
            diagnoses:        patient.diagnoses       || [],
            admission_reason: patient.admissionReason  || '',
          }, { timeout: 8000 });

          const mortality = mortRes.data?.mortality_risk_24h ?? mortRes.data?.mortality_probability ?? 0;

          // ── Mise à jour Patient en base ───────────────────────────────────
          await Patient.findByIdAndUpdate(patient._id, {
            gravityScore:      maxScore,
            mortalityRisk24h:  mortality,
            mortalityRisk48h:  Math.min(1, mortality * 1.3),
            lastAiScoreUpdate: new Date(),
          });

          // ── Diffusion temps réel ──────────────────────────────────────────
          io.to('rea-dashboard').emit('ai-score:update', {
            patientId:       patient._id,
            bedNumber:       monitor.bedNumber,
            patientName:     `${patient.firstName} ${patient.lastName}`,
            gravityScore:    maxScore,
            mortalityRisk24h: Math.round(mortality * 100),
            icu4: {
              septicShock:     Math.round(septic * 100),
              respFailure:     Math.round(resp   * 100),
              hemoInstability: Math.round(hemo   * 100),
            },
            timestamp: new Date(),
          });
          updated++;

        } catch { /* ML service non disponible pour ce patient */ }
      }

      if (updated > 0) console.log(`[Score IA 5min] ${updated} patient(s) mis à jour`);

    } catch (err) {
      console.error('[Score IA 5min] Erreur:', err.message);
    }
  }, 5 * 60 * 1000); // Toutes les 5 minutes
}

module.exports = { startVitalSimulator };
