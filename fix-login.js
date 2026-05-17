/**
 * node fix-login.js
 * Réinitialise les utilisateurs ET vérifie que bcrypt fonctionne
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/icu_monitoring';
  console.log('\n🔌 Connexion à:', uri);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  console.log('✅ Connecté à MongoDB\n');

  const db = mongoose.connection.db;
  const col = db.collection('users');

  // Supprimer tous les utilisateurs existants
  const deleted = await col.deleteMany({});
  console.log(`🗑️  ${deleted.deletedCount} utilisateur(s) supprimé(s)`);

  // Hasher les mots de passe manuellement (sans pre-save hook)
  const SALT = 12;
  const users = [
    { firstName: 'Admin',     lastName: 'Système', email: 'admin@rea.dz',   password: await bcrypt.hash('Admin@1234',  SALT), role: 'ADMIN',               unit: 'REA', isActive: true, preferences: { language: 'fr', alarmSound: true, darkMode: true } },
    { firstName: 'Dr. Karim', lastName: 'Benali',  email: 'benali@rea.dz',  password: await bcrypt.hash('Doctor@1234', SALT), role: 'MEDECIN_REANIMATEUR', unit: 'REA', isActive: true, speciality: 'Réanimation médicale', preferences: { language: 'fr', alarmSound: true, darkMode: true } },
    { firstName: 'Dr. Sara',  lastName: 'Ouahab',  email: 'ouahab@rea.dz',  password: await bcrypt.hash('Doctor@1234', SALT), role: 'MEDECIN_REANIMATEUR', unit: 'REA', isActive: true, speciality: 'Anesthésie-Réanimation', preferences: { language: 'fr', alarmSound: true, darkMode: true } },
    { firstName: 'Fatima',    lastName: 'Hadj',    email: 'hadj@rea.dz',    password: await bcrypt.hash('Nurse@1234',  SALT), role: 'INFIRMIER',           unit: 'REA', isActive: true, preferences: { language: 'fr', alarmSound: true, darkMode: true } },
    { firstName: 'Yacine',    lastName: 'Meziani', email: 'meziani@rea.dz', password: await bcrypt.hash('Nurse@1234',  SALT), role: 'INFIRMIER',           unit: 'REA', isActive: true, preferences: { language: 'fr', alarmSound: true, darkMode: true } },
  ];

  await col.insertMany(users);
  console.log(`✅ ${users.length} utilisateurs insérés\n`);

  // Vérification immédiate — simuler exactement ce que fait le serveur
  console.log('🔍 Vérification des mots de passe:\n');
  const tests = [
    { email: 'admin@rea.dz',  password: 'Admin@1234'  },
    { email: 'benali@rea.dz', password: 'Doctor@1234' },
    { email: 'hadj@rea.dz',   password: 'Nurse@1234'  },
  ];

  for (const t of tests) {
    const u = await col.findOne({ email: t.email });
    if (!u) { console.log(`  ❌ ${t.email} → NON TROUVÉ`); continue; }
    const ok = await bcrypt.compare(t.password, u.password);
    console.log(`  ${ok ? '✅' : '❌'} ${t.email} / ${t.password} → ${ok ? 'OK' : 'ÉCHEC'}`);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📧 Comptes pour se connecter:');
  console.log('   admin@rea.dz      →  Admin@1234');
  console.log('   benali@rea.dz     →  Doctor@1234');
  console.log('   hadj@rea.dz       →  Nurse@1234');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await mongoose.disconnect();
  console.log('✅ Terminé — relance le serveur: node src/server.js');
}

main().catch(err => {
  console.error('\n❌ ERREUR:', err.message);
  process.exit(1);
});
