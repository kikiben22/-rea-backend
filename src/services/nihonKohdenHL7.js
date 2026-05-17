/**
 * SERVEUR HL7 MLLP — NIHON KOHDEN LIFE SCOPE
 *
 * Protocole : HL7 v2.5 encapsulé dans MLLP (Minimal Lower Layer Protocol)
 *   0x0B          → Start Block
 *   <message HL7> → texte pipe-delimited
 *   0x1C 0x0D     → End Block + CR
 *
 * Port MLLP standard : 2575
 *
 * Flux :  Moniteur Life Scope → Ethernet → TCP:2575 (ce serveur)
 *         → parse ORU^R01 → MongoDB → Socket.IO → Dashboard
 *
 * 5 vitaux Nihon Kohden Life Scope :
 *   ECG/FC  — LOINC 8867-4  / tag HR
 *   SpO₂    — LOINC 59408-5 / tag SPO2
 *   NIBP    — LOINC 8480-6(S) 8462-4(D) 8478-0(MAP) / tags NIBP-S/D/M
 *   IBP     — LOINC 76534-7(S) 76535-4(D) 8308-9(MAP) / tags ABP-S/D/M
 *   FR      — LOINC 9279-1  / tag RESP
 *   Temp    — LOINC 8310-5  / tag TEMP
 *   EtCO₂   — LOINC 19889-5 / tag ETCO2
 */

const net        = require('net');
const Monitor    = require('../models/Monitor');
const VitalSign  = require('../models/VitalSign');
const Alert      = require('../models/Alert');
const ioInstance = require('../socket/ioInstance');

const MLLP_START = 0x0B;
const MLLP_END1  = 0x1C;
const MLLP_END2  = 0x0D;

// ── Codes LOINC + abréviations NK Life Scope → champ interne ─────────────────
const CODE_MAP = {
  // ECG / FC
  '8867-4':  'heartRate',  'HR': 'heartRate',  'HEART-RATE': 'heartRate',
  // SpO₂
  '59408-5': 'spo2',       'SPO2': 'spo2',     'SAT': 'spo2',
  // NIBP systolique
  '8480-6':  'systolicBP', '55284-4': 'systolicBP',
  'NIBP-S': 'systolicBP',  'NIBP_SYS': 'systolicBP', 'NI-S': 'systolicBP',
  // NIBP diastolique
  '8462-4':  'diastolicBP','NIBP-D': 'diastolicBP', 'NIBP_DIA': 'diastolicBP', 'NI-D': 'diastolicBP',
  // NIBP MAP
  '8478-0':  'map',        'NIBP-M': 'map',    'NIBP_MAP': 'map', 'NI-M': 'map',
  // IBP artériel (radial / fémoral) — valeurs invasives
  '76534-7': 'ibpSystolic','ABP-S': 'ibpSystolic',  'ART-S': 'ibpSystolic',  'IBP1-S': 'ibpSystolic',
  '76535-4': 'ibpDiastolic','ABP-D': 'ibpDiastolic', 'ART-D': 'ibpDiastolic', 'IBP1-D': 'ibpDiastolic',
  '8308-9':  'ibpMap',     'ABP-M': 'ibpMap',   'ART-M': 'ibpMap',   'IBP1-M': 'ibpMap',
  // Fréquence respiratoire
  '9279-1':  'respRate',   'RESP': 'respRate',  'RR': 'respRate',
  // Température
  '8310-5':  'temperature','TEMP': 'temperature','TEMP1': 'temperature',
  // EtCO₂ (capnographie)
  '19889-5': 'etco2',      'ETCO2': 'etco2',   'CO2-ET': 'etco2', 'CO2_ET': 'etco2',
  // Glasgow
  '9269-2':  'glasgow',    'GCS': 'glasgow',
};

// ── Génération ECG waveform (100 pts) identique au simulateur ─────────────────
function generateECGWaveform(heartRate = 75) {
  const points = [];
  const period = Math.round(100 / (heartRate / 60));
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

// ── Parse OBX → { field, value } ─────────────────────────────────────────────
// OBX|seq|type|code^name^sys||value|unit|refrange|...
function parseOBX(seg) {
  const f = seg.split('|');
  if (f[0] !== 'OBX') return null;
  const codeParts = (f[3] || '').split('^');
  const code = codeParts[0].toUpperCase();
  const name = (codeParts[1] || '').toUpperCase().replace(/\s+/g,'-');
  const field = CODE_MAP[code] || CODE_MAP[name];
  if (!field) return null;
  const value = parseFloat(f[5]);
  if (isNaN(value)) return null;
  return { field, value };
}

// ── Parse MSH ─────────────────────────────────────────────────────────────────
function parseMSH(seg) {
  const f = seg.split('|');
  return {
    sendingApp:      f[2] || 'NK_UNKNOWN',
    sendingFacility: f[3] || 'ICU',
    msgType:         f[8] || '',
    msgId:           f[9] || '',
  };
}

// ── Parse message HL7 complet ─────────────────────────────────────────────────
function parseHL7(raw) {
  const segs = raw.replace(/\r\n/g, '\r').split('\r').filter(Boolean);
  const result = { msh: null, vitals: {} };
  for (const seg of segs) {
    if (seg.startsWith('MSH')) result.msh = parseMSH(seg);
    else if (seg.startsWith('OBX')) {
      const o = parseOBX(seg);
      if (o) result.vitals[o.field] = o.value;
    }
  }
  return result;
}

// ── Calcul statut alarme ──────────────────────────────────────────────────────
function alarmFor(val, t) {
  if (!t || val == null) return 'NORMAL';
  if (val <= (t.criticalMin ?? 0) || val >= (t.criticalMax ?? 9999)) return 'CRITICAL';
  if (val <= (t.minVal ?? 0)      || val >= (t.maxVal ?? 9999))      return 'WARNING';
  return 'NORMAL';
}

// ── Traitement d'un message HL7 parsé ────────────────────────────────────────
async function processMessage(hl7, remoteIp) {
  const { msh, vitals } = hl7;
  if (!msh || !msh.msgType.includes('ORU')) return;
  if (Object.keys(vitals).length === 0) return;

  const monitorCode = msh.sendingApp;

  // 1. Trouver ou créer le moniteur
  let monitor = await Monitor.findOne({ monitorId: monitorCode });
  if (!monitor) {
    monitor = new Monitor({
      monitorId:  monitorCode,
      brand:      'Nihon Kohden',
      model:      'Life Scope G',
      bedNumber:  monitorCode.replace(/^NK_?/i, '').replace(/_/g, ' ') || monitorCode,
      isOnline:   true,
    });
    await monitor.save();
    console.log(`🆕 [NK] Nouveau moniteur auto-enregistré : ${monitorCode} (${remoteIp})`);
  } else if (!monitor.isOnline) {
    await Monitor.findByIdAndUpdate(monitor._id, { isOnline: true });
  }

  // 2. MAP calculée si non reçue
  if (!vitals.map && vitals.systolicBP && vitals.diastolicBP)
    vitals.map = Math.round((vitals.systolicBP + 2 * vitals.diastolicBP) / 3);
  if (!vitals.ibpMap && vitals.ibpSystolic && vitals.ibpDiastolic)
    vitals.ibpMap = Math.round((vitals.ibpSystolic + 2 * vitals.ibpDiastolic) / 3);

  // 3. Calcul alarmes + payload plat (format dashboard)
  const t = monitor.thresholds || {};
  const hrAlarm   = alarmFor(vitals.heartRate,   t.heartRate);
  const spo2Alarm = alarmFor(vitals.spo2,        t.spo2);
  const sbpAlarm  = alarmFor(vitals.systolicBP,  t.systolicBP);
  const rrAlarm   = alarmFor(vitals.respRate,     t.respRate);
  const tempAlarm = alarmFor(vitals.temperature,  t.temperature);
  const gcsAlarm  = alarmFor(vitals.glasgow,      t.glasgow);
  const ibpAlarm  = alarmFor(vitals.ibpSystolic,  t.systolicBP);

  const allAlarms = [hrAlarm, spo2Alarm, sbpAlarm, rrAlarm, tempAlarm, gcsAlarm, ibpAlarm];
  const overallAlarm = allAlarms.includes('CRITICAL') ? 'CRITICAL'
                     : allAlarms.includes('WARNING')  ? 'WARNING' : 'NORMAL';

  // Format plat identique au simulateur (lu par DashboardPage)
  const flatVitals = {
    heartRate:    vitals.heartRate,    heartRateAlarm: hrAlarm,
    spo2:         vitals.spo2,         spo2Alarm,
    systolicBP:   vitals.systolicBP,
    diastolicBP:  vitals.diastolicBP,  bpAlarm: sbpAlarm,
    map:          vitals.map,
    ibpSystolic:  vitals.ibpSystolic,
    ibpDiastolic: vitals.ibpDiastolic, ibpAlarm,
    ibpMap:       vitals.ibpMap,
    respRate:     vitals.respRate,     rrAlarm,
    temperature:  vitals.temperature,  tempAlarm,
    etco2:        vitals.etco2,
    glasgow:      vitals.glasgow,      gcsAlarm,
    ecgWaveform:  generateECGWaveform(vitals.heartRate || 75),
    source:       'nihon-kohden',
  };

  // 4. Sauvegarder VitalSign si patient assigné
  if (monitor.currentPatient) {
    const vsDoc = {
      monitorId:   monitor._id,
      patientId:   monitor.currentPatient,
      overallAlarm,
      heartRate:   vitals.heartRate   != null ? { value: vitals.heartRate,   alarm: hrAlarm   } : undefined,
      spo2:        vitals.spo2        != null ? { value: vitals.spo2,        alarm: spo2Alarm } : undefined,
      systolicBP:  vitals.systolicBP  != null ? { value: vitals.systolicBP,  alarm: sbpAlarm  } : undefined,
      diastolicBP: vitals.diastolicBP != null ? { value: vitals.diastolicBP, alarm: 'NORMAL'  } : undefined,
      meanArterialPressure: vitals.map,
      respRate:    vitals.respRate    != null ? { value: vitals.respRate,    alarm: rrAlarm   } : undefined,
      temperature: vitals.temperature != null ? { value: vitals.temperature, alarm: tempAlarm } : undefined,
      etco2:       vitals.etco2       != null ? { value: vitals.etco2,       alarm: 'NORMAL'  } : undefined,
      glasgow:     vitals.glasgow     != null ? { value: vitals.glasgow,     alarm: gcsAlarm  } : undefined,
      ecgWaveform: flatVitals.ecgWaveform,
    };
    await new VitalSign(vsDoc).save().catch(() => {});
  }

  // 5. Mettre à jour lastVitals
  const lastVitalsUpdate = {};
  const FIELDS = ['heartRate','spo2','systolicBP','diastolicBP','respRate','temperature','etco2','glasgow'];
  for (const f of FIELDS) {
    if (vitals[f] != null) lastVitalsUpdate[`lastVitals.${f}`] = vitals[f];
  }
  lastVitalsUpdate['lastVitals.timestamp'] = new Date();
  await Monitor.findByIdAndUpdate(monitor._id, { ...lastVitalsUpdate, alarmStatus: overallAlarm, isOnline: true });

  // 6. Alertes critiques
  if (overallAlarm === 'CRITICAL') {
    const critMap = { heartRate: hrAlarm, spo2: spo2Alarm, systolicBP: sbpAlarm, respRate: rrAlarm, temperature: tempAlarm };
    for (const [f, a] of Object.entries(critMap)) {
      if (a === 'CRITICAL' && vitals[f] != null) {
        await new Alert({
          monitorId: monitor._id,
          patientId: monitor.currentPatient || undefined,
          type:     'VITAL_CRITICAL',
          severity: 'CRITICAL',
          parameter: f,
          currentValue: vitals[f],
          message: `[NK Life Scope] ${f} CRITIQUE : ${vitals[f]} — Lit ${monitor.bedNumber}`,
        }).save().catch(() => {});
      }
    }
  }

  // 7. Broadcast Socket.IO → dashboard (même format que le simulateur)
  const io = ioInstance.getIo();
  if (io) {
    const payload = {
      monitorId:   monitor._id,
      monitorCode,
      bedNumber:   monitor.bedNumber,
      vitals:      flatVitals,
      overallAlarm,
      timestamp:   new Date(),
    };
    // Émet sur les deux canaux (compatibilité simulateur + NK)
    io.to('rea-dashboard').emit('vitals:update',   payload);
    io.to('rea-dashboard').emit('monitor:vitals',  payload);
    io.to(`monitor:${monitor._id}`).emit('vitals:detail', payload);

    if (overallAlarm !== 'NORMAL') {
      io.to('rea-dashboard').emit('monitor:alarm', {
        monitorId: monitor._id, bedNumber: monitor.bedNumber, level: overallAlarm,
      });
      if (overallAlarm === 'CRITICAL') {
        io.to('rea-dashboard').emit('alert:new', {
          monitorId: monitorCode, bedNumber: monitor.bedNumber,
          severity: 'CRITICAL', message: `Alarme CRITIQUE — Lit ${monitor.bedNumber}`,
        });
      }
    }
  }

  console.log(
    `📡 [NK] ${monitorCode} → FC:${vitals.heartRate ?? '-'}bpm  SpO₂:${vitals.spo2 ?? '-'}%  ` +
    `NIBP:${vitals.systolicBP ?? '-'}/${vitals.diastolicBP ?? '-'}  ` +
    `IBP:${vitals.ibpSystolic ?? '-'}/${vitals.ibpDiastolic ?? '-'}  ` +
    `FR:${vitals.respRate ?? '-'}  T°:${vitals.temperature ?? '-'}  [${overallAlarm}]`
  );
}

// ── Serveur TCP MLLP ──────────────────────────────────────────────────────────
function startNihonKohdenHL7Server(port = 2575) {
  const server = net.createServer(socket => {
    const remoteIp = socket.remoteAddress?.replace('::ffff:', '') || 'unknown';
    console.log(`🔌 [NK] Connexion moniteur Life Scope : ${remoteIp}`);

    let buf = Buffer.alloc(0);

    socket.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);

      while (true) {
        const start = buf.indexOf(MLLP_START);
        if (start === -1) { buf = Buffer.alloc(0); break; }
        const end = buf.indexOf(MLLP_END1, start);
        if (end === -1) break; // message incomplet

        const rawHL7 = buf.slice(start + 1, end).toString('utf8');
        buf = buf.slice(end + 2); // skip 0x1C + 0x0D

        const parsed = parseHL7(rawHL7);
        processMessage(parsed, remoteIp).catch(err =>
          console.error(`[NK] Erreur traitement: ${err.message}`)
        );

        // ACK MLLP → moniteur
        const ack = `\x0BMSH|^~\\&|REA_SERVER|ICU|${parsed.msh?.sendingApp || 'NK'}|` +
          `${parsed.msh?.sendingFacility || 'ICU'}|` +
          `${new Date().toISOString().replace(/\D/g,'').slice(0,14)}||ACK^R01|ACK${Date.now()}|P|2.5\r` +
          `MSA|AA|${parsed.msh?.msgId || ''}\r\x1C\x0D`;
        socket.write(Buffer.from(ack));
      }
    });

    socket.on('close', () => {
      console.log(`🔴 [NK] Moniteur déconnecté : ${remoteIp}`);
      // Marquer hors ligne
      Monitor.updateMany({ /* impossible sans monitorCode ici */ }, {}).catch(() => {});
    });
    socket.on('error', err => console.error(`[NK] Socket erreur (${remoteIp}): ${err.message}`));
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`\n📡 [NK Life Scope] Serveur MLLP démarré → TCP :${port}`);
    console.log(`   Sur le moniteur : Menu Réseau → IP serveur + port ${port} + HL7 v2.5 MLLP`);
  });

  server.on('error', err => console.error(`[NK] Erreur serveur: ${err.message}`));
  return server;
}

module.exports = { startNihonKohdenHL7Server, parseHL7 };
