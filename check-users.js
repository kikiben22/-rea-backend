/**
 * Diagnostic + reset complet des utilisateurs
 * node check-users.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/icu_monitoring';
  console.log('Connexion à:', uri);
  await mongoose.connect(uri);

  // Schéma minimal sans hook pre-save
  const UserRaw = mongoose.model('UserRaw', new mongoose.Schema({
    email: String, password: String, firstName: String, lastName: String,
    role: String, isActive: Boolean
  }, { collection: 'users' }));

  const users = await UserRaw.find({}, 'email role isActive password');
  console.log(`\n${users.length} utilisateur(s) trouvé(s):\n`);

  const testPasswords = {
    'admin@rea.dz':   'Admin@1234',
    'benali@rea.dz':  'Doctor@1234',
    'ouahab@rea.dz':  'Doctor@1234',
    'hadj@rea.dz':    'Nurse@1234',
    'meziani@rea.dz': 'Nurse@1234',
  };

  for (const u of users) {
    const expected = testPasswords[u.email];
    let match = '?';
    if (expected && u.password) {
      match = await bcrypt.compare(expected, u.password) ? '✅ OK' : '❌ MAUVAIS HASH';
    }
    console.log(`  ${u.email} | ${u.role} | actif:${u.isActive} | mdp: ${match}`);
  }

  if (users.length === 0 || users.some(async u => !(await bcrypt.compare(testPasswords[u.email]||'', u.password||'')))) {
    console.log('\n⚙️  Réinitialisation des utilisateurs...');
    await UserRaw.deleteMany({});

    const bcryptHash = async (pwd) => bcrypt.hash(pwd, 12);
    const newUsers = [
      { email: 'admin@rea.dz',   password: await bcryptHash('Admin@1234'),  firstName: 'Admin',     lastName: 'Système', role: 'ADMIN',                 isActive: true },
      { email: 'benali@rea.dz',  password: await bcryptHash('Doctor@1234'), firstName: 'Dr. Karim', lastName: 'Benali',  role: 'MEDECIN_REANIMATEUR',   isActive: true },
      { email: 'ouahab@rea.dz',  password: await bcryptHash('Doctor@1234'), firstName: 'Dr. Sara',  lastName: 'Ouahab',  role: 'MEDECIN_REANIMATEUR',   isActive: true },
      { email: 'hadj@rea.dz',    password: await bcryptHash('Nurse@1234'),  firstName: 'Fatima',    lastName: 'Hadj',    role: 'INFIRMIER',             isActive: true },
      { email: 'meziani@rea.dz', password: await bcryptHash('Nurse@1234'),  firstName: 'Yacine',    lastName: 'Meziani', role: 'INFIRMIER',             isActive: true },
    ];
    await UserRaw.insertMany(newUsers);
    console.log('✅ 5 utilisateurs créés avec mots de passe corrects\n');
    console.log('Comptes disponibles:');
    console.log('  admin@rea.dz      →  Admin@1234');
    console.log('  benali@rea.dz     →  Doctor@1234');
    console.log('  hadj@rea.dz       →  Nurse@1234');
  }

  await mongoose.disconnect();
  console.log('\nTerminé.');
}

main().catch(err => { console.error(err); process.exit(1); });
