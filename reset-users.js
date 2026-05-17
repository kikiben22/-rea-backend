/**
 * Réinitialise uniquement les utilisateurs
 * node reset-users.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./src/models/User');

const USERS = [
  { firstName: 'Admin',    lastName: 'Système', email: 'admin@rea.dz',   password: 'Admin@1234',  role: 'ADMIN' },
  { firstName: 'Dr. Karim',lastName: 'Benali',  email: 'benali@rea.dz',  password: 'Doctor@1234', role: 'MEDECIN_REANIMATEUR', speciality: 'Réanimation médicale' },
  { firstName: 'Dr. Sara', lastName: 'Ouahab',  email: 'ouahab@rea.dz',  password: 'Doctor@1234', role: 'MEDECIN_REANIMATEUR', speciality: 'Anesthésie-Réanimation' },
  { firstName: 'Fatima',   lastName: 'Hadj',    email: 'hadj@rea.dz',    password: 'Nurse@1234',  role: 'INFIRMIER' },
  { firstName: 'Yacine',   lastName: 'Meziani', email: 'meziani@rea.dz', password: 'Nurse@1234',  role: 'INFIRMIER' },
];

async function resetUsers() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/icu_monitoring';
  await mongoose.connect(uri);
  console.log('✅ Connecté à MongoDB:', uri);

  await User.deleteMany({});
  console.log('🗑️  Utilisateurs supprimés');

  for (const u of USERS) {
    await new User(u).save();
  }
  console.log(`✅ ${USERS.length} utilisateurs recréés`);
  console.log('\n📧 Comptes disponibles:');
  USERS.forEach(u => console.log(`   ${u.role}: ${u.email}  /  ${u.password}`));

  await mongoose.disconnect();
}

resetUsers().catch(err => { console.error(err); process.exit(1); });
