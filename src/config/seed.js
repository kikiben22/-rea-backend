/**
 * SEED — Données initiales pour le système REA
 * Lance: node src/config/seed.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Monitor = require('../models/Monitor');
const Patient = require('../models/Patient');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/icu_monitoring';

const USERS = [
  { firstName: 'Admin', lastName: 'Système', email: 'admin@rea.dz', password: 'Admin@1234', role: 'ADMIN' },
  { firstName: 'Dr. Karim', lastName: 'Benali', email: 'benali@rea.dz', password: 'Doctor@1234', role: 'MEDECIN_REANIMATEUR', speciality: 'Réanimation médicale' },
  { firstName: 'Dr. Sara', lastName: 'Ouahab', email: 'ouahab@rea.dz', password: 'Doctor@1234', role: 'MEDECIN_REANIMATEUR', speciality: 'Anesthésie-Réanimation' },
  { firstName: 'Fatima', lastName: 'Hadj', email: 'hadj@rea.dz', password: 'Nurse@1234', role: 'INFIRMIER' },
  { firstName: 'Yacine', lastName: 'Meziani', email: 'meziani@rea.dz', password: 'Nurse@1234', role: 'INFIRMIER' },
];

// ── Génération automatique des moniteurs — illimitée ─────────────────────
// Définissez NB_LITS dans votre .env  (ex: NB_LITS=30)
// Sans variable d'env, le système crée autant de lits que nécessaire pour les patients + 10 libres
const NB_LITS = process.env.NB_LITS ? parseInt(process.env.NB_LITS) : 15;

const MONITOR_CATALOG = [
  { brand: 'Mindray',      model: 'BeneVision N22'      },
  { brand: 'GE Healthcare',model: 'CARESCAPE B450'      },
  { brand: 'Nihon Kohden', model: 'BSM-1700'            },
  { brand: 'Mindray',      model: 'BeneVision N17'      },
  { brand: 'Philips',      model: 'IntelliVue MX800'    },
  { brand: 'GE Healthcare',model: 'CARESCAPE B650'      },
  { brand: 'Mindray',      model: 'BeneVision N22'      },
  { brand: 'Dräger',       model: 'Infinity Delta XL'   },
  { brand: 'Philips',      model: 'IntelliVue MX700'    },
  { brand: 'Mindray',      model: 'BeneVision N15'      },
  { brand: 'GE Healthcare',model: 'CARESCAPE B850'      },
  { brand: 'Nihon Kohden', model: 'BSM-6301'            },
  { brand: 'Dräger',       model: 'Infinity Kappa'      },
  { brand: 'Philips',      model: 'IntelliVue MX550'    },
  { brand: 'Mindray',      model: 'BeneVision N12'      },
  { brand: 'GE Healthcare',model: 'CARESCAPE VC150'     },
  { brand: 'Nihon Kohden', model: 'BSM-1703'            },
  { brand: 'Dräger',       model: 'Infinity C500'       },
  { brand: 'Philips',      model: 'IntelliVue MP60'     },
  { brand: 'Mindray',      model: 'BeneVision N1'       },
];

const MONITORS = Array.from({ length: NB_LITS }, (_, i) => {
  const num = String(i + 1).padStart(2, '0');
  const catalog = MONITOR_CATALOG[i % MONITOR_CATALOG.length];
  return {
    monitorId: `MON-LIT${num}`,
    brand:     catalog.brand,
    model:     catalog.model,
    bedNumber: `LIT-${num}`,
    unit:      'REA',
  };
});

const PATIENTS = [
  {
    patientId: 'PAT-2024-001', firstName: 'Mohamed', lastName: 'Amrani', age: 67, sex: 'M',
    admissionReason: 'Insuffisance respiratoire aiguë sur BPCO décompensée',
    urgencyLevel: 'ROUGE', status: 'CRITIQUE',
    diagnoses: [{ code: 'J96.0', label: 'Insuffisance respiratoire aiguë', type: 'principal' }],
    chronicDiseases: ['BPCO sévère', 'HTA', 'Diabète type 2'],
    medicationsBefore: [
      { name: 'Metformine', dose: '1000mg', route: 'PO', frequency: '2x/jour' },
      { name: 'Amlodipine', dose: '5mg', route: 'PO', frequency: '1x/jour' }
    ],
    medicationsICU: [
      { name: 'Noradrénaline', dose: '0.2 mcg/kg/min', route: 'IV', frequency: 'Continu' },
      { name: 'Midazolam', dose: '5 mg/h', route: 'IV', frequency: 'Continu' },
      { name: 'Propofol', dose: '50 mg/h', route: 'IV', frequency: 'Continu' }
    ],
    bedNumber: 'LIT-01', gravityScore: 78, mortalityRisk24h: 0.35
  },
  {
    patientId: 'PAT-2024-002', firstName: 'Aicha', lastName: 'Boudiaf', age: 45, sex: 'F',
    admissionReason: 'Choc septique sur pneumonie bilatérale',
    urgencyLevel: 'ROUGE', status: 'CRITIQUE',
    diagnoses: [{ code: 'A41.9', label: 'Choc septique', type: 'principal' }],
    chronicDiseases: ['Diabète type 1', 'Lupus érythémateux'],
    medicationsBefore: [
      { name: 'Insuline glargine', dose: '20 UI', route: 'SC', frequency: '1x/jour' },
      { name: 'Hydroxychloroquine', dose: '200mg', route: 'PO', frequency: '2x/jour' }
    ],
    medicationsICU: [
      { name: 'Pipéracilline-Tazobactam', dose: '4.5g', route: 'IV', frequency: 'Toutes 6h' },
      { name: 'Vancomycine', dose: '1g', route: 'IV', frequency: 'Toutes 12h' },
      { name: 'Vasopressine', dose: '0.04 UI/min', route: 'IV', frequency: 'Continu' }
    ],
    bedNumber: 'LIT-02', gravityScore: 85, mortalityRisk24h: 0.42
  },
  {
    patientId: 'PAT-2024-003', firstName: 'Ahmed', lastName: 'Tlemcani', age: 55, sex: 'M',
    admissionReason: 'Infarctus du myocarde avec choc cardiogénique',
    urgencyLevel: 'ROUGE', status: 'URGENT',
    diagnoses: [{ code: 'I21.9', label: 'IDM avec choc cardiogénique', type: 'principal' }],
    chronicDiseases: ['Coronaropathie', 'HTA sévère', 'Dyslipidémie'],
    medicationsBefore: [
      { name: 'Aspirine', dose: '100mg', route: 'PO', frequency: '1x/jour' },
      { name: 'Atorvastatine', dose: '40mg', route: 'PO', frequency: '1x/soir' }
    ],
    medicationsICU: [
      { name: 'Dobutamine', dose: '5 mcg/kg/min', route: 'IV', frequency: 'Continu' },
      { name: 'Héparine', dose: '25000 UI/24h', route: 'IV', frequency: 'Continu' },
      { name: 'Furosémide', dose: '80mg', route: 'IV', frequency: '2x/jour' }
    ],
    bedNumber: 'LIT-03', gravityScore: 72, mortalityRisk24h: 0.28
  },
  {
    patientId: 'PAT-2024-004', firstName: 'Nour', lastName: 'Belkacem', age: 28, sex: 'F',
    admissionReason: 'Traumatisme crânien grave suite à AVP',
    urgencyLevel: 'ORANGE', status: 'CRITIQUE',
    diagnoses: [{ code: 'S09.9', label: 'Traumatisme crânien grave', type: 'principal' }],
    chronicDiseases: [],
    medicationsBefore: [],
    medicationsICU: [
      { name: 'Mannitol 20%', dose: '1g/kg', route: 'IV', frequency: 'Toutes 6h' },
      { name: 'Phénytoïne', dose: '100mg', route: 'IV', frequency: 'Toutes 8h' },
      { name: 'Propofol', dose: '40mg/h', route: 'IV', frequency: 'Continu' }
    ],
    bedNumber: 'LIT-04', gravityScore: 68, mortalityRisk24h: 0.22
  },
  {
    patientId: 'PAT-2024-005', firstName: 'Omar', lastName: 'Cherif', age: 72, sex: 'M',
    admissionReason: 'AVC ischémique massif avec troubles de conscience',
    urgencyLevel: 'ORANGE', status: 'STABLE',
    diagnoses: [{ code: 'I63.9', label: 'AVC ischémique', type: 'principal' }],
    chronicDiseases: ['FA persistante', 'HTA', 'IRC modérée'],
    medicationsBefore: [
      { name: 'Warfarine', dose: '5mg', route: 'PO', frequency: '1x/jour' }
    ],
    medicationsICU: [
      { name: 'Altéplase', dose: '0.9 mg/kg', route: 'IV', frequency: 'Unique' },
      { name: 'Aspirine', dose: '300mg', route: 'Sonde NG', frequency: '1x/jour' }
    ],
    bedNumber: 'LIT-05', gravityScore: 55, mortalityRisk24h: 0.15
  },
  {
    patientId: 'PAT-2024-006', firstName: 'Leila', lastName: 'Mabrouk', age: 61, sex: 'F',
    admissionReason: 'Insuffisance rénale aiguë sur sepsis urinaire',
    urgencyLevel: 'ORANGE', status: 'URGENT',
    diagnoses: [{ code: 'N17.9', label: 'Insuffisance rénale aiguë', type: 'principal' }],
    chronicDiseases: ['Diabète type 2', 'HTA', 'Insuffisance rénale chronique stade 3'],
    medicationsBefore: [
      { name: 'Metformine', dose: '500mg', route: 'PO', frequency: '2x/jour' },
      { name: 'Amlodipine', dose: '10mg',  route: 'PO', frequency: '1x/jour' },
    ],
    medicationsICU: [
      { name: 'Ceftriaxone',   dose: '2g',              route: 'IV', frequency: '1x/jour'    },
      { name: 'Métronidazole', dose: '500mg',            route: 'IV', frequency: 'Toutes 8h'  },
      { name: 'Furosémide',    dose: '40mg',             route: 'IV', frequency: '2x/jour'    },
      { name: 'Noradrénaline', dose: '0.1 mcg/kg/min',  route: 'IV', frequency: 'Continu'     },
    ],
    bedNumber: 'LIT-06', gravityScore: 60, mortalityRisk24h: 0.18
  },
];

async function seed() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ MongoDB connecté');

  // Nettoyer
  await Promise.all([User.deleteMany(), Monitor.deleteMany(), Patient.deleteMany()]);
  console.log('🗑️  Collections vidées');

  // Créer utilisateurs
  for (const u of USERS) {
    await new User(u).save();
  }
  console.log(`✅ ${USERS.length} utilisateurs créés`);

  // Créer moniteurs
  const savedMonitors = await Monitor.insertMany(MONITORS);
  console.log(`✅ ${savedMonitors.length} moniteurs créés`);

  // Créer patients et lier aux moniteurs
  for (let i = 0; i < PATIENTS.length; i++) {
    const monitorDoc = savedMonitors.find(m => m.bedNumber === PATIENTS[i].bedNumber);
    const patient = new Patient({
      ...PATIENTS[i],
      monitorId: monitorDoc?._id,
      admissionDate: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000)
    });
    await patient.save();

    if (monitorDoc) {
      await Monitor.findByIdAndUpdate(monitorDoc._id, {
        isOccupied: true,
        currentPatient: patient._id
      });
    }
  }
  console.log(`✅ ${PATIENTS.length} patients créés`);

  console.log('\n🏥 Base de données initialisée avec succès!');
  console.log('📧 Comptes:');
  USERS.forEach(u => console.log(`   ${u.role}: ${u.email} / ${u.password}`));

  mongoose.disconnect();
}

// Seed silencieux appelé depuis server.js (sans disconnect)
async function seedQuiet() {
  try {
    // Ne jamais supprimer les utilisateurs existants
    const bcrypt = require('bcryptjs');
    const existingUsers = await User.countDocuments();
    if (existingUsers === 0) {
      for (const u of USERS) {
        const hashed = await bcrypt.hash(u.password, 12);
        await User.collection.insertOne({ ...u, password: hashed, isActive: true, unit: 'REA', preferences: { language: 'fr', alarmSound: true, darkMode: true }, createdAt: new Date(), updatedAt: new Date() });
      }
      console.log(`✅ ${USERS.length} utilisateurs créés`);
    } else {
      console.log(`ℹ️  ${existingUsers} utilisateurs déjà présents — conservés`);
    }

    await Promise.all([Monitor.deleteMany(), Patient.deleteMany()]);
    const savedMonitors = await Monitor.insertMany(MONITORS);
    for (let i = 0; i < PATIENTS.length; i++) {
      const monitorDoc = savedMonitors.find(m => m.bedNumber === PATIENTS[i].bedNumber);
      const patient = new Patient({
        ...PATIENTS[i],
        monitorId: monitorDoc?._id,
        admissionDate: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000)
      });
      await patient.save();
      if (monitorDoc) await Monitor.findByIdAndUpdate(monitorDoc._id, { isOccupied: true, currentPatient: patient._id });
    }
    console.log(`✅ ${savedMonitors.length} moniteurs, ${PATIENTS.length} patients créés`);
  } catch (err) {
    console.error('Seed erreur:', err.message);
  }
}

module.exports = { seedQuiet };

if (require.main === module) {
  seed().catch(err => { console.error(err); process.exit(1); });
}
