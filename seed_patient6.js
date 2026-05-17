/**
 * Ajoute le 6ème patient (LIT-06) sans effacer les données existantes.
 * Usage : node seed_patient6.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/icu_monitoring';

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ MongoDB connecté');

  const Patient = require('./src/models/Patient');
  const Monitor = require('./src/models/Monitor');

  const existing = await Patient.findOne({ bedNumber: 'LIT-06' });
  if (existing) {
    console.log('ℹ️  Patient LIT-06 déjà présent :', existing.firstName, existing.lastName);
    await mongoose.disconnect();
    return;
  }

  const monitor = await Monitor.findOne({ bedNumber: 'LIT-06' });
  if (!monitor) {
    console.log('⚠️  Moniteur LIT-06 introuvable. Vérifiez que les moniteurs sont créés.');
    await mongoose.disconnect();
    return;
  }

  const patient = await Patient.create({
    patientId:       `PAT-${Date.now()}`,
    firstName:       'Leila',
    lastName:        'Mabrouk',
    age:             61,
    sex:             'F',
    admissionReason: 'Insuffisance rénale aiguë sur sepsis urinaire',
    urgencyLevel:    'ORANGE',
    status:          'URGENT',
    bedNumber:       'LIT-06',
    monitorId:       monitor._id,
    unit:            'REA',
    bloodType:       'B+',
    diagnoses:       [{ code: 'N17.9', label: 'Insuffisance rénale aiguë', type: 'principal' }],
    chronicDiseases: ['Diabète type 2', 'HTA', 'Insuffisance rénale chronique stade 3'],
    medicationsBefore: [
      { name: 'Metformine',  dose: '500mg',  route: 'PO', frequency: '2x/jour' },
      { name: 'Amlodipine',  dose: '10mg',   route: 'PO', frequency: '1x/jour' },
    ],
    medicationsICU: [
      { name: 'Ceftriaxone',       dose: '2g',         route: 'IV', frequency: '1x/jour'  },
      { name: 'Métronidazole',     dose: '500mg',       route: 'IV', frequency: 'Toutes 8h' },
      { name: 'Furosémide',        dose: '40mg',        route: 'IV', frequency: '2x/jour'  },
      { name: 'Noradrénaline',     dose: '0.1 mcg/kg/min', route: 'IV', frequency: 'Continu' },
    ],
    gravityScore:     60,
    mortalityRisk24h: 0.18,
    admissionDate:    new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
  });

  await Monitor.findByIdAndUpdate(monitor._id, {
    isOccupied:     true,
    currentPatient: patient._id,
  });

  console.log(`✅ Patient créé : ${patient.firstName} ${patient.lastName} — LIT-06`);
  await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
