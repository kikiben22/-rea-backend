require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db;

  const cols = await db.listCollections().toArray();
  console.log('Collections:', cols.map(c => c.name).join(', '));

  // Camera detections — tout supprimer
  try {
    const r = await db.collection('cameradetections').deleteMany({});
    console.log('cameradetections supprimés:', r.deletedCount);
  } catch(e) { console.log('cameradetections:', e.message); }

  // Alertes résolues
  try {
    const r = await db.collection('alerts').deleteMany({ resolved: true });
    console.log('alerts résolues supprimées:', r.deletedCount);
  } catch(e) { console.log('alerts resolved:', e.message); }

  // Alertes de plus de 7 jours
  try {
    const cut = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const r = await db.collection('alerts').deleteMany({ createdAt: { $lt: cut } });
    console.log('alerts >7j supprimées:', r.deletedCount);
  } catch(e) { console.log('alerts old:', e.message); }

  // Sessions
  try {
    const r = await db.collection('sessions').deleteMany({});
    console.log('sessions supprimées:', r.deletedCount);
  } catch(e) { console.log('sessions:', e.message); }

  await mongoose.disconnect();
  console.log('\nNettoyage terminé !');
}

run().catch(e => { console.error(e.message); process.exit(1); });
