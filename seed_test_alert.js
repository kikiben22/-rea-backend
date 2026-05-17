/**
 * seed_test_alert.js
 * Insère un patient virtuel + 6 moniteurs + une alerte critique dans MongoDB Atlas.
 * Usage: node seed_test_alert.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGODB_URI ||
  'mongodb+srv://ICU_db_user:w3aS3scvhFcQVchh@cluster0.x4m7axc.mongodb.net/rea_system?retryWrites=true&w=majority&appName=Cluster0';

/* ── Schémas inline (légers) ── */
const Bracelet = mongoose.model('Bracelet', new mongoose.Schema({
  deviceId: String,
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient' },
  monitorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Monitor' },
  battery: { type: Number, default: 100 },
  isOnline: { type: Boolean, default: true },
  movementType: { type: String, default: 'REPOS' },
  litName: String,
  fallCount: { type: Number, default: 0 },
  lastSeen: { type: Date, default: Date.now },
}, { timestamps: true }));

const Patient = mongoose.model('Patient', new mongoose.Schema({
  patientId: String,
  firstName: String, lastName: String,
  age: Number, sex: String,
  admissionReason: String,
  urgencyLevel: { type: String, default: 'ROUGE' },
  diagnoses: [{ code: String, label: String }],
}, { timestamps: true }));

const Monitor = mongoose.model('Monitor', new mongoose.Schema({
  monitorId: String,
  brand: { type: String, default: 'Mindray' },
  bedNumber: String,
  unit: { type: String, default: 'REA' },
  isOnline: { type: Boolean, default: true },
  isOccupied: { type: Boolean, default: false },
  currentPatient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', default: null },
  lastVitals: {
    heartRate: Number, spo2: Number,
    systolicBP: Number, diastolicBP: Number,
    respRate: Number, temperature: Number,
    glasgowScore: Number, timestamp: Date,
  },
  alarmStatus: { type: String, default: 'NORMAL' },
}, { timestamps: true }));

const Alert = mongoose.model('Alert', new mongoose.Schema({
  monitorId: mongoose.Schema.Types.ObjectId,
  patientId: mongoose.Schema.Types.ObjectId,
  type: String, severity: String,
  parameter: String, currentValue: Number, threshold: Number,
  message: String,
  acknowledged: { type: Boolean, default: false },
  resolved: { type: Boolean, default: false },
}, { timestamps: true }));

/* ── Données de test ── */
const BEDS = [
  { monitorId: 'MON-REA-001', bedNumber: 'LIT-1' },
  { monitorId: 'MON-REA-002', bedNumber: 'LIT-2' },
  { monitorId: 'MON-REA-003', bedNumber: 'LIT-3' },
  { monitorId: 'MON-REA-004', bedNumber: 'LIT-4' },
  { monitorId: 'MON-REA-005', bedNumber: 'LIT-5' },
  { monitorId: 'MON-REA-006', bedNumber: 'LIT-6' },
];

const PATIENTS = [
  { patientId: 'PAT-001', firstName: 'Ahmed',   lastName: 'Benali',   age: 67, sex: 'M', admissionReason: 'Insuffisance respiratoire aiguë', urgencyLevel: 'ROUGE' },
  { patientId: 'PAT-002', firstName: 'Fatima',  lastName: 'Ouali',    age: 54, sex: 'F', admissionReason: 'Sepsis sévère', urgencyLevel: 'ROUGE' },
  { patientId: 'PAT-003', firstName: 'Mohamed', lastName: 'Khelifi',  age: 72, sex: 'M', admissionReason: 'AVC ischémique', urgencyLevel: 'ORANGE' },
  { patientId: 'PAT-004', firstName: 'Amina',   lastName: 'Hadj',     age: 45, sex: 'F', admissionReason: 'Polytraumatisme', urgencyLevel: 'ROUGE' },
  { patientId: 'PAT-005', firstName: 'Karim',   lastName: 'Messaoud', age: 38, sex: 'M', admissionReason: 'Arrêt cardiorespiratoire récupéré', urgencyLevel: 'ROUGE' },
  { patientId: 'PAT-006', firstName: 'Nadia',   lastName: 'Ferhat',   age: 61, sex: 'F', admissionReason: 'Insuffisance rénale aiguë', urgencyLevel: 'ORANGE' },
];

const VITALS_SAMPLES = [
  { heartRate: 148, spo2: 82, systolicBP: 70, diastolicBP: 40, respRate: 32, temperature: 39.8, glasgowScore: 6 },  // critique
  { heartRate: 125, spo2: 88, systolicBP: 85, diastolicBP: 52, respRate: 26, temperature: 38.9, glasgowScore: 9 },  // warning
  { heartRate: 78,  spo2: 96, systolicBP: 118, diastolicBP: 75, respRate: 16, temperature: 37.2, glasgowScore: 13 }, // normal
  { heartRate: 42,  spo2: 91, systolicBP: 92, diastolicBP: 60, respRate: 28, temperature: 39.1, glasgowScore: 8 },  // critique
  { heartRate: 155, spo2: 86, systolicBP: 200, diastolicBP: 110, respRate: 35, temperature: 40.2, glasgowScore: 5 }, // critique
  { heartRate: 88,  spo2: 94, systolicBP: 130, diastolicBP: 82, respRate: 20, temperature: 37.8, glasgowScore: 12 }, // normal
];

async function seed() {
  console.log('🔌 Connexion à MongoDB Atlas…');
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connecté');

  /* Créer ou mettre à jour les 6 patients */
  const patientDocs = [];
  for (const p of PATIENTS) {
    const doc = await Patient.findOneAndUpdate(
      { patientId: p.patientId },
      { $set: p },
      { upsert: true, new: true }
    );
    patientDocs.push(doc);
    console.log(`👤 Patient: ${doc.firstName} ${doc.lastName} (${doc._id})`);
  }

  /* Créer ou mettre à jour les 6 moniteurs */
  const monitorDocs = [];
  for (let i = 0; i < BEDS.length; i++) {
    const b = BEDS[i];
    const vit = { ...VITALS_SAMPLES[i], timestamp: new Date() };
    const alarmStatus = [0, 3, 4].includes(i) ? 'CRITICAL' : i === 1 ? 'WARNING' : 'NORMAL';

    const doc = await Monitor.findOneAndUpdate(
      { monitorId: b.monitorId },
      {
        $set: {
          ...b,
          isOccupied: true,
          currentPatient: patientDocs[i]._id,
          lastVitals: vit,
          alarmStatus,
        }
      },
      { upsert: true, new: true }
    );
    monitorDocs.push(doc);
    console.log(`🖥  Moniteur: ${b.bedNumber} → ${patientDocs[i].firstName} [${alarmStatus}]`);
  }

  /* Créer des alertes critiques */
  const alertsData = [
    {
      monitorId: monitorDocs[0]._id,
      patientId: patientDocs[0]._id,
      type: 'VITAL_CRITICAL',
      severity: 'CRITICAL',
      parameter: 'heartRate',
      currentValue: 148,
      threshold: 120,
      message: `FC critique : 148 bpm (seuil 120) — ${patientDocs[0].firstName} ${patientDocs[0].lastName}`,
    },
    {
      monitorId: monitorDocs[0]._id,
      patientId: patientDocs[0]._id,
      type: 'VITAL_CRITICAL',
      severity: 'CRITICAL',
      parameter: 'spo2',
      currentValue: 82,
      threshold: 90,
      message: `SpO₂ dangereuse : 82% (seuil 90%) — ${patientDocs[0].firstName} ${patientDocs[0].lastName}`,
    },
    {
      monitorId: monitorDocs[3]._id,
      patientId: patientDocs[3]._id,
      type: 'VITAL_CRITICAL',
      severity: 'CRITICAL',
      parameter: 'heartRate',
      currentValue: 42,
      threshold: 50,
      message: `Bradycardie sévère : 42 bpm — ${patientDocs[3].firstName} ${patientDocs[3].lastName}`,
    },
    {
      monitorId: monitorDocs[4]._id,
      patientId: patientDocs[4]._id,
      type: 'VITAL_CRITICAL',
      severity: 'CRITICAL',
      parameter: 'temperature',
      currentValue: 40.2,
      threshold: 39.5,
      message: `Hyperthermie critique : 40.2°C — ${patientDocs[4].firstName} ${patientDocs[4].lastName}`,
    },
  ];

  for (const a of alertsData) {
    await Alert.create({ ...a, resolved: false, acknowledged: false });
    console.log(`🚨 Alerte: ${a.message}`);
  }

  /* Créer 6 bracelets liés aux patients */
  for (let i = 0; i < patientDocs.length; i++) {
    const deviceId = `ESP32-LIT-00${i + 1}`;
    const mvTypes  = ['REPOS', 'REPOS', 'LEGER', 'FORT', 'REPOS', 'LEGER'];
    await Bracelet.findOneAndUpdate(
      { deviceId },
      {
        $set: {
          patientId:    patientDocs[i]._id,
          monitorId:    monitorDocs[i]._id,
          isOnline:     i !== 2,          // LIT-3 hors ligne
          battery:      [92, 78, 45, 61, 88, 33][i],
          movementType: mvTypes[i],
          litName:      `LIT-${i + 1}`,
          lastSeen:     new Date(),
        }
      },
      { upsert: true, new: true }
    );
    console.log(`📿 Bracelet: ${deviceId} → ${patientDocs[i].firstName} [${mvTypes[i]}]`);
  }

  console.log('\n✅ Seed terminé — Rechargez l\'application pour voir les données.');
  await mongoose.disconnect();
}

seed().catch(err => { console.error('❌ Erreur:', err.message); process.exit(1); });
