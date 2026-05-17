/**
 * node force-seed-meds.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

const STOCK = [
  { nom: 'Noradrénaline', nomGenerique: 'Norépinéphrine', categorie: 'Vasopresseur', forme: 'Ampoule', dosageUnitaire: '8 mg/4 ml', unite: 'ampoule', quantiteStock: 50, seuilAlerte: 10, emplacement: 'Frigo REA', fournisseur: 'Sanofi' },
  { nom: 'Midazolam', nomGenerique: 'Midazolam', categorie: 'Sédatif', forme: 'Ampoule', dosageUnitaire: '5 mg/ml', unite: 'ampoule', quantiteStock: 40, seuilAlerte: 8, emplacement: 'Armoire A', fournisseur: 'Roche' },
  { nom: 'Propofol', nomGenerique: 'Propofol', categorie: 'Sédatif', forme: 'Flacon', dosageUnitaire: '200 mg/20 ml', unite: 'flacon', quantiteStock: 30, seuilAlerte: 6, emplacement: 'Frigo REA' },
  { nom: 'Amoxicilline', nomGenerique: 'Amoxicilline', categorie: 'Antibiotique', forme: 'Flacon', dosageUnitaire: '1 g', unite: 'flacon', quantiteStock: 60, seuilAlerte: 15, emplacement: 'Armoire B' },
  { nom: 'Pipéracilline-Tazobactam', nomGenerique: 'Pip-Tazo', categorie: 'Antibiotique', forme: 'Flacon', dosageUnitaire: '4.5 g', unite: 'flacon', quantiteStock: 45, seuilAlerte: 10, emplacement: 'Armoire B' },
  { nom: 'Vancomycine', nomGenerique: 'Vancomycine', categorie: 'Antibiotique', forme: 'Flacon', dosageUnitaire: '1 g', unite: 'flacon', quantiteStock: 25, seuilAlerte: 8, emplacement: 'Armoire B' },
  { nom: 'Furosémide', nomGenerique: 'Furosémide', categorie: 'Diurétique', forme: 'Ampoule', dosageUnitaire: '20 mg/2 ml', unite: 'ampoule', quantiteStock: 55, seuilAlerte: 10, emplacement: 'Armoire A' },
  { nom: 'Héparine', nomGenerique: 'Héparine sodique', categorie: 'Anticoagulant', forme: 'Flacon', dosageUnitaire: '25000 UI/5 ml', unite: 'flacon', quantiteStock: 20, seuilAlerte: 5, emplacement: 'Frigo REA' },
  { nom: 'Dobutamine', nomGenerique: 'Dobutamine', categorie: 'Vasopresseur', forme: 'Ampoule', dosageUnitaire: '250 mg/20 ml', unite: 'ampoule', quantiteStock: 8, seuilAlerte: 10, emplacement: 'Frigo REA' },
  { nom: 'Métronidazole', nomGenerique: 'Métronidazole', categorie: 'Antibiotique', forme: 'Poche', dosageUnitaire: '500 mg/100 ml', unite: 'poche', quantiteStock: 35, seuilAlerte: 8, emplacement: 'Armoire C' },
  { nom: 'Hydrocortisone', nomGenerique: 'Hydrocortisone', categorie: 'Corticoïde', forme: 'Flacon', dosageUnitaire: '100 mg', unite: 'flacon', quantiteStock: 18, seuilAlerte: 5, emplacement: 'Armoire A' },
  { nom: 'NaCl 0.9%', nomGenerique: 'Chlorure de sodium', categorie: 'Autre', forme: 'Poche', dosageUnitaire: '1000 ml', unite: 'poche', quantiteStock: 100, seuilAlerte: 20, emplacement: 'Réserve' },
  { nom: 'Glucose 5%', nomGenerique: 'Dextrose', categorie: 'Autre', forme: 'Poche', dosageUnitaire: '500 ml', unite: 'poche', quantiteStock: 80, seuilAlerte: 15, emplacement: 'Réserve' },
  { nom: 'Potassium KCl', nomGenerique: 'Chlorure de potassium', categorie: 'Autre', forme: 'Ampoule', dosageUnitaire: '2 g/20 ml', unite: 'ampoule', quantiteStock: 4, seuilAlerte: 10, emplacement: 'Armoire A' },
  { nom: 'Morphine', nomGenerique: 'Chlorhydrate de morphine', categorie: 'Antalgique', forme: 'Ampoule', dosageUnitaire: '10 mg/ml', unite: 'ampoule', quantiteStock: 15, seuilAlerte: 5, emplacement: 'Armoire Sécurisée' },
  { nom: 'Fentanyl', nomGenerique: 'Fentanyl', categorie: 'Antalgique', forme: 'Ampoule', dosageUnitaire: '0.5 mg/10 ml', unite: 'ampoule', quantiteStock: 12, seuilAlerte: 5, emplacement: 'Armoire Sécurisée' },
  { nom: 'Adrénaline', nomGenerique: 'Épinéphrine', categorie: 'Vasopresseur', forme: 'Ampoule', dosageUnitaire: '1 mg/ml', unite: 'ampoule', quantiteStock: 22, seuilAlerte: 8, emplacement: 'Urgence REA' },
  { nom: 'Atropine', nomGenerique: "Sulfate d'atropine", categorie: 'Autre', forme: 'Ampoule', dosageUnitaire: '0.5 mg/ml', unite: 'ampoule', quantiteStock: 18, seuilAlerte: 5, emplacement: 'Urgence REA' },
  { nom: 'Atorvastatine', nomGenerique: 'Atorvastatine', categorie: 'Antihypertenseur', forme: 'Comprimé', dosageUnitaire: '40 mg', unite: 'comprimé', quantiteStock: 200, seuilAlerte: 30, emplacement: 'Armoire C' },
  { nom: 'Insuline Actrapid', nomGenerique: 'Insuline rapide', categorie: 'Autre', forme: 'Flacon', dosageUnitaire: '100 UI/ml', unite: 'flacon', quantiteStock: 15, seuilAlerte: 4, emplacement: 'Frigo REA' },
];

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/icu_monitoring';
  console.log('Connexion →', uri);

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  console.log('✅ Connecté');

  const db = mongoose.connection.db;
  const col = db.collection('medicaments');

  const count = await col.countDocuments();
  console.log(`Documents actuels: ${count}`);

  await col.deleteMany({});
  console.log('🗑️  Collection vidée');

  const now = new Date();
  const docs = STOCK.map((m, i) => ({
    ...m,
    dateExpiration: new Date(now.getFullYear() + 2, now.getMonth(), 1),
    numerLot: `LOT-${Date.now()}-${i}`,
    mouvements: [{ type: 'ENTREE', quantite: m.quantiteStock, raison: 'Stock initial', effectuePar: 'Admin', date: now }],
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }));

  const result = await col.insertMany(docs);
  console.log(`✅ ${result.insertedCount} médicaments insérés dans icu_monitoring.medicaments`);

  const verify = await col.countDocuments();
  console.log(`✅ Vérification: ${verify} documents dans la collection`);

  await mongoose.disconnect();
  console.log('Terminé.');
}

run().catch(err => {
  console.error('ERREUR:', err.message);
  process.exit(1);
});
