require('dotenv').config({ path: __dirname + '/.env' });
const mongoose = require('mongoose');
const Medicament = require('./src/models/Medicament');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/icu_monitoring';

const medicaments = [
  // ── ANTIBIOTIQUES ──────────────────────────────────────────────────────────
  {
    nom: 'Augmentin', nomGenerique: 'Amoxicilline / Acide clavulanique',
    categorie: 'Antibiotique', forme: 'Flacon', dosageUnitaire: '1 g / 200 mg',
    unite: 'flacon', quantiteStock: 80, seuilAlerte: 20,
    numerLot: 'AUG-2025-001', dateExpiration: new Date('2027-06-30'),
    fournisseur: 'SAIDAL', prixUnitaire: 350, emplacement: 'Armoire REA – Antibiotiques'
  },
  {
    nom: 'Ceftriaxone', nomGenerique: 'Ceftriaxone sodique',
    categorie: 'Antibiotique', forme: 'Flacon', dosageUnitaire: '1 g',
    unite: 'flacon', quantiteStock: 120, seuilAlerte: 30,
    numerLot: 'CEF-2025-002', dateExpiration: new Date('2027-03-31'),
    fournisseur: 'PHARMAL', prixUnitaire: 280, emplacement: 'Armoire REA – Antibiotiques'
  },
  {
    nom: 'Vancomycine', nomGenerique: 'Chlorhydrate de vancomycine',
    categorie: 'Antibiotique', forme: 'Flacon', dosageUnitaire: '500 mg',
    unite: 'flacon', quantiteStock: 60, seuilAlerte: 15,
    numerLot: 'VAN-2025-003', dateExpiration: new Date('2026-12-31'),
    fournisseur: 'HIKMA', prixUnitaire: 1200, emplacement: 'Armoire REA – Antibiotiques'
  },
  {
    nom: 'Amikacine', nomGenerique: 'Sulfate d\'amikacine',
    categorie: 'Antibiotique', forme: 'Ampoule', dosageUnitaire: '500 mg / 2 mL',
    unite: 'ampoule', quantiteStock: 100, seuilAlerte: 25,
    numerLot: 'AMI-2025-004', dateExpiration: new Date('2027-01-31'),
    fournisseur: 'SAIDAL', prixUnitaire: 180, emplacement: 'Armoire REA – Antibiotiques'
  },
  {
    nom: 'Métronidazole', nomGenerique: 'Métronidazole',
    categorie: 'Antibiotique', forme: 'Flacon', dosageUnitaire: '500 mg / 100 mL',
    unite: 'flacon', quantiteStock: 90, seuilAlerte: 20,
    numerLot: 'MET-2025-005', dateExpiration: new Date('2027-08-31'),
    fournisseur: 'PFIZER', prixUnitaire: 220, emplacement: 'Armoire REA – Antibiotiques'
  },
  {
    nom: 'Ciprofloxacine', nomGenerique: 'Ciprofloxacine chlorhydrate',
    categorie: 'Antibiotique', forme: 'Flacon', dosageUnitaire: '200 mg / 100 mL',
    unite: 'flacon', quantiteStock: 70, seuilAlerte: 15,
    numerLot: 'CIP-2025-006', dateExpiration: new Date('2027-05-31'),
    fournisseur: 'BAYER', prixUnitaire: 450, emplacement: 'Armoire REA – Antibiotiques'
  },
  {
    nom: 'Imipénème + Cilastatine', nomGenerique: 'Imipénème / Cilastatine',
    categorie: 'Antibiotique', forme: 'Flacon', dosageUnitaire: '500 mg / 500 mg',
    unite: 'flacon', quantiteStock: 40, seuilAlerte: 10,
    numerLot: 'IMP-2025-007', dateExpiration: new Date('2026-10-31'),
    fournisseur: 'MSD', prixUnitaire: 2200, emplacement: 'Armoire REA – Antibiotiques'
  },

  // ── ANTALGIQUES ────────────────────────────────────────────────────────────
  {
    nom: 'Morphine', nomGenerique: 'Chlorhydrate de morphine',
    categorie: 'Antalgique', forme: 'Ampoule', dosageUnitaire: '10 mg / 1 mL',
    unite: 'ampoule', quantiteStock: 50, seuilAlerte: 15,
    numerLot: 'MOR-2025-008', dateExpiration: new Date('2027-02-28'),
    fournisseur: 'COOPER', prixUnitaire: 320, emplacement: 'Coffre stupéfiants'
  },
  {
    nom: 'Fentanyl', nomGenerique: 'Citrate de fentanyl',
    categorie: 'Antalgique', forme: 'Ampoule', dosageUnitaire: '100 µg / 2 mL',
    unite: 'ampoule', quantiteStock: 60, seuilAlerte: 15,
    numerLot: 'FEN-2025-009', dateExpiration: new Date('2027-04-30'),
    fournisseur: 'JANSSEN', prixUnitaire: 850, emplacement: 'Coffre stupéfiants'
  },
  {
    nom: 'Paracétamol', nomGenerique: 'Paracétamol',
    categorie: 'Antalgique', forme: 'Flacon', dosageUnitaire: '1 g / 100 mL',
    unite: 'flacon', quantiteStock: 200, seuilAlerte: 40,
    numerLot: 'PAR-2025-010', dateExpiration: new Date('2027-09-30'),
    fournisseur: 'SAIDAL', prixUnitaire: 120, emplacement: 'Armoire REA – Antalgiques'
  },
  {
    nom: 'Kétamine', nomGenerique: 'Chlorhydrate de kétamine',
    categorie: 'Antalgique', forme: 'Flacon', dosageUnitaire: '500 mg / 10 mL',
    unite: 'flacon', quantiteStock: 30, seuilAlerte: 8,
    numerLot: 'KET-2025-011', dateExpiration: new Date('2026-11-30'),
    fournisseur: 'PFIZER', prixUnitaire: 1500, emplacement: 'Coffre sécurisé'
  },
  {
    nom: 'Tramadol', nomGenerique: 'Chlorhydrate de tramadol',
    categorie: 'Antalgique', forme: 'Ampoule', dosageUnitaire: '100 mg / 2 mL',
    unite: 'ampoule', quantiteStock: 80, seuilAlerte: 20,
    numerLot: 'TRA-2025-012', dateExpiration: new Date('2027-07-31'),
    fournisseur: 'GRÜNENTHAL', prixUnitaire: 210, emplacement: 'Armoire REA – Antalgiques'
  },

  // ── SÉDATIFS ───────────────────────────────────────────────────────────────
  {
    nom: 'Midazolam', nomGenerique: 'Chlorhydrate de midazolam',
    categorie: 'Sédatif', forme: 'Ampoule', dosageUnitaire: '5 mg / 1 mL',
    unite: 'ampoule', quantiteStock: 100, seuilAlerte: 25,
    numerLot: 'MID-2025-013', dateExpiration: new Date('2027-03-31'),
    fournisseur: 'ROCHE', prixUnitaire: 420, emplacement: 'Coffre sécurisé'
  },
  {
    nom: 'Propofol', nomGenerique: 'Propofol',
    categorie: 'Sédatif', forme: 'Flacon', dosageUnitaire: '200 mg / 20 mL',
    unite: 'flacon', quantiteStock: 60, seuilAlerte: 15,
    numerLot: 'PRO-2025-014', dateExpiration: new Date('2027-01-31'),
    fournisseur: 'FRESENIUS', prixUnitaire: 1800, emplacement: 'Frigo médicaments'
  },
  {
    nom: 'Diazépam', nomGenerique: 'Diazépam',
    categorie: 'Sédatif', forme: 'Ampoule', dosageUnitaire: '10 mg / 2 mL',
    unite: 'ampoule', quantiteStock: 70, seuilAlerte: 20,
    numerLot: 'DIA-2025-015', dateExpiration: new Date('2027-06-30'),
    fournisseur: 'ROCHE', prixUnitaire: 150, emplacement: 'Coffre sécurisé'
  },
  {
    nom: 'Thiopental', nomGenerique: 'Thiopental sodique',
    categorie: 'Sédatif', forme: 'Flacon', dosageUnitaire: '500 mg',
    unite: 'flacon', quantiteStock: 25, seuilAlerte: 8,
    numerLot: 'THI-2025-016', dateExpiration: new Date('2026-09-30'),
    fournisseur: 'NORFLORIDIENNE', prixUnitaire: 950, emplacement: 'Coffre sécurisé'
  },

  // ── ANTICOAGULANTS ─────────────────────────────────────────────────────────
  {
    nom: 'Héparine sodique', nomGenerique: 'Héparine sodique',
    categorie: 'Anticoagulant', forme: 'Flacon', dosageUnitaire: '25 000 UI / 5 mL',
    unite: 'flacon', quantiteStock: 80, seuilAlerte: 20,
    numerLot: 'HEP-2025-017', dateExpiration: new Date('2027-04-30'),
    fournisseur: 'SANOFI', prixUnitaire: 650, emplacement: 'Armoire REA – Anticoagulants'
  },
  {
    nom: 'Énoxaparine (Lovenox)', nomGenerique: 'Énoxaparine sodique',
    categorie: 'Anticoagulant', forme: 'Seringue', dosageUnitaire: '40 mg / 0,4 mL',
    unite: 'seringue', quantiteStock: 100, seuilAlerte: 25,
    numerLot: 'ENO-2025-018', dateExpiration: new Date('2027-02-28'),
    fournisseur: 'SANOFI', prixUnitaire: 900, emplacement: 'Frigo médicaments'
  },

  // ── VASOPRESSEURS ──────────────────────────────────────────────────────────
  {
    nom: 'Noradrénaline', nomGenerique: 'Norepinéphrine tartrate',
    categorie: 'Vasopresseur', forme: 'Ampoule', dosageUnitaire: '8 mg / 4 mL',
    unite: 'ampoule', quantiteStock: 60, seuilAlerte: 15,
    numerLot: 'NOR-2025-019', dateExpiration: new Date('2027-05-31'),
    fournisseur: 'AGUETTANT', prixUnitaire: 750, emplacement: 'Frigo médicaments'
  },
  {
    nom: 'Adrénaline (Épinéphrine)', nomGenerique: 'Chlorhydrate d\'adrénaline',
    categorie: 'Vasopresseur', forme: 'Ampoule', dosageUnitaire: '1 mg / 1 mL',
    unite: 'ampoule', quantiteStock: 80, seuilAlerte: 20,
    numerLot: 'ADR-2025-020', dateExpiration: new Date('2027-08-31'),
    fournisseur: 'AGUETTANT', prixUnitaire: 280, emplacement: 'Chariot urgences'
  },
  {
    nom: 'Dopamine', nomGenerique: 'Chlorhydrate de dopamine',
    categorie: 'Vasopresseur', forme: 'Ampoule', dosageUnitaire: '200 mg / 5 mL',
    unite: 'ampoule', quantiteStock: 50, seuilAlerte: 12,
    numerLot: 'DOP-2025-021', dateExpiration: new Date('2026-12-31'),
    fournisseur: 'AGUETTANT', prixUnitaire: 480, emplacement: 'Frigo médicaments'
  },
  {
    nom: 'Dobutamine', nomGenerique: 'Chlorhydrate de dobutamine',
    categorie: 'Vasopresseur', forme: 'Flacon', dosageUnitaire: '250 mg / 20 mL',
    unite: 'flacon', quantiteStock: 35, seuilAlerte: 10,
    numerLot: 'DOB-2025-022', dateExpiration: new Date('2027-01-31'),
    fournisseur: 'LILLY', prixUnitaire: 1100, emplacement: 'Frigo médicaments'
  },
  {
    nom: 'Vasopressine', nomGenerique: 'Vasopressine',
    categorie: 'Vasopresseur', forme: 'Ampoule', dosageUnitaire: '20 UI / 1 mL',
    unite: 'ampoule', quantiteStock: 30, seuilAlerte: 8,
    numerLot: 'VAS-2025-023', dateExpiration: new Date('2026-10-31'),
    fournisseur: 'FERRING', prixUnitaire: 2400, emplacement: 'Frigo médicaments'
  },

  // ── DIURÉTIQUES ────────────────────────────────────────────────────────────
  {
    nom: 'Furosémide', nomGenerique: 'Furosémide',
    categorie: 'Diurétique', forme: 'Ampoule', dosageUnitaire: '20 mg / 2 mL',
    unite: 'ampoule', quantiteStock: 150, seuilAlerte: 30,
    numerLot: 'FUR-2025-024', dateExpiration: new Date('2027-07-31'),
    fournisseur: 'SANOFI', prixUnitaire: 90, emplacement: 'Armoire REA – Diurétiques'
  },
  {
    nom: 'Mannitol 20%', nomGenerique: 'Mannitol',
    categorie: 'Diurétique', forme: 'Flacon', dosageUnitaire: '20 g / 100 mL',
    unite: 'flacon', quantiteStock: 50, seuilAlerte: 12,
    numerLot: 'MAN-2025-025', dateExpiration: new Date('2027-09-30'),
    fournisseur: 'BAXTER', prixUnitaire: 380, emplacement: 'Armoire REA – Diurétiques'
  },

  // ── CORTICOÏDES ────────────────────────────────────────────────────────────
  {
    nom: 'Hydrocortisone', nomGenerique: 'Hémisuccinate d\'hydrocortisone',
    categorie: 'Corticoïde', forme: 'Flacon', dosageUnitaire: '100 mg',
    unite: 'flacon', quantiteStock: 90, seuilAlerte: 20,
    numerLot: 'HYD-2025-026', dateExpiration: new Date('2027-03-31'),
    fournisseur: 'PFIZER', prixUnitaire: 320, emplacement: 'Armoire REA – Corticoïdes'
  },
  {
    nom: 'Méthylprednisolone (Solu-Médrol)', nomGenerique: 'Méthylprednisolone',
    categorie: 'Corticoïde', forme: 'Flacon', dosageUnitaire: '500 mg',
    unite: 'flacon', quantiteStock: 45, seuilAlerte: 10,
    numerLot: 'MET-2025-027', dateExpiration: new Date('2026-11-30'),
    fournisseur: 'PFIZER', prixUnitaire: 1400, emplacement: 'Armoire REA – Corticoïdes'
  },
  {
    nom: 'Dexaméthasone', nomGenerique: 'Phosphate de dexaméthasone',
    categorie: 'Corticoïde', forme: 'Ampoule', dosageUnitaire: '4 mg / 1 mL',
    unite: 'ampoule', quantiteStock: 100, seuilAlerte: 20,
    numerLot: 'DEX-2025-028', dateExpiration: new Date('2027-06-30'),
    fournisseur: 'SAIDAL', prixUnitaire: 180, emplacement: 'Armoire REA – Corticoïdes'
  },

  // ── ANTIHYPERTENSEURS ──────────────────────────────────────────────────────
  {
    nom: 'Nicardipine (Loxen)', nomGenerique: 'Chlorhydrate de nicardipine',
    categorie: 'Antihypertenseur', forme: 'Ampoule', dosageUnitaire: '10 mg / 10 mL',
    unite: 'ampoule', quantiteStock: 60, seuilAlerte: 15,
    numerLot: 'NIC-2025-029', dateExpiration: new Date('2027-02-28'),
    fournisseur: 'CHERP', prixUnitaire: 950, emplacement: 'Frigo médicaments'
  },
  {
    nom: 'Labétalol (Trandate)', nomGenerique: 'Chlorhydrate de labétalol',
    categorie: 'Antihypertenseur', forme: 'Ampoule', dosageUnitaire: '100 mg / 20 mL',
    unite: 'ampoule', quantiteStock: 40, seuilAlerte: 10,
    numerLot: 'LAB-2025-030', dateExpiration: new Date('2027-05-31'),
    fournisseur: 'SANOFI', prixUnitaire: 1200, emplacement: 'Armoire REA – Antihypertenseurs'
  },
  {
    nom: 'Uradipil (Ebrantil)', nomGenerique: 'Chlorhydrate d\'uradipil',
    categorie: 'Antihypertenseur', forme: 'Ampoule', dosageUnitaire: '50 mg / 10 mL',
    unite: 'ampoule', quantiteStock: 30, seuilAlerte: 8,
    numerLot: 'URA-2025-031', dateExpiration: new Date('2026-09-30'),
    fournisseur: 'TAKEDA', prixUnitaire: 1600, emplacement: 'Armoire REA – Antihypertenseurs'
  },

  // ── AUTRES (solutés, urgences) ─────────────────────────────────────────────
  {
    nom: 'NaCl 0,9% (Sérum physiologique)', nomGenerique: 'Chlorure de sodium',
    categorie: 'Autre', forme: 'Poche', dosageUnitaire: '9 g / 1 000 mL',
    unite: 'poche', quantiteStock: 300, seuilAlerte: 60,
    numerLot: 'NaCl-2025-032', dateExpiration: new Date('2028-01-31'),
    fournisseur: 'BAXTER', prixUnitaire: 280, emplacement: 'Réserve solutés'
  },
  {
    nom: 'Glucose 5%', nomGenerique: 'Glucose',
    categorie: 'Autre', forme: 'Poche', dosageUnitaire: '50 g / 1 000 mL',
    unite: 'poche', quantiteStock: 200, seuilAlerte: 40,
    numerLot: 'GLU-2025-033', dateExpiration: new Date('2028-02-28'),
    fournisseur: 'BAXTER', prixUnitaire: 260, emplacement: 'Réserve solutés'
  },
  {
    nom: 'Ringer Lactate', nomGenerique: 'Solution de Ringer Lactate',
    categorie: 'Autre', forme: 'Poche', dosageUnitaire: '1 000 mL',
    unite: 'poche', quantiteStock: 180, seuilAlerte: 40,
    numerLot: 'RIN-2025-034', dateExpiration: new Date('2028-03-31'),
    fournisseur: 'FRESENIUS', prixUnitaire: 310, emplacement: 'Réserve solutés'
  },
  {
    nom: 'Albumine humaine 4%', nomGenerique: 'Albumine humaine',
    categorie: 'Autre', forme: 'Flacon', dosageUnitaire: '40 g / 1 000 mL',
    unite: 'flacon', quantiteStock: 20, seuilAlerte: 5,
    numerLot: 'ALB-2025-035', dateExpiration: new Date('2026-08-31'),
    fournisseur: 'LFB', prixUnitaire: 8500, emplacement: 'Frigo médicaments'
  },
  {
    nom: 'Insuline Actrapid', nomGenerique: 'Insuline humaine soluble',
    categorie: 'Autre', forme: 'Flacon', dosageUnitaire: '100 UI / 1 mL',
    unite: 'flacon', quantiteStock: 30, seuilAlerte: 8,
    numerLot: 'INS-2025-036', dateExpiration: new Date('2026-12-31'),
    fournisseur: 'NOVO NORDISK', prixUnitaire: 1200, emplacement: 'Frigo médicaments'
  },
  {
    nom: 'Atropine', nomGenerique: 'Sulfate d\'atropine',
    categorie: 'Autre', forme: 'Ampoule', dosageUnitaire: '0,5 mg / 1 mL',
    unite: 'ampoule', quantiteStock: 60, seuilAlerte: 15,
    numerLot: 'ATR-2025-037', dateExpiration: new Date('2027-04-30'),
    fournisseur: 'AGUETTANT', prixUnitaire: 95, emplacement: 'Chariot urgences'
  },
  {
    nom: 'Naloxone (Narcan)', nomGenerique: 'Chlorhydrate de naloxone',
    categorie: 'Autre', forme: 'Ampoule', dosageUnitaire: '0,4 mg / 1 mL',
    unite: 'ampoule', quantiteStock: 25, seuilAlerte: 8,
    numerLot: 'NAL-2025-038', dateExpiration: new Date('2027-01-31'),
    fournisseur: 'INDIVIOR', prixUnitaire: 1800, emplacement: 'Chariot urgences'
  },
  {
    nom: 'Succinylcholine (Célocurine)', nomGenerique: 'Chlorure de succinylcholine',
    categorie: 'Sédatif', forme: 'Ampoule', dosageUnitaire: '200 mg / 10 mL',
    unite: 'ampoule', quantiteStock: 50, seuilAlerte: 12,
    numerLot: 'SUC-2025-039', dateExpiration: new Date('2026-07-31'),
    fournisseur: 'CHAUVIN', prixUnitaire: 650, emplacement: 'Frigo médicaments'
  },
  {
    nom: 'Amiodarone (Cordarone)', nomGenerique: 'Chlorhydrate d\'amiodarone',
    categorie: 'Autre', forme: 'Ampoule', dosageUnitaire: '150 mg / 3 mL',
    unite: 'ampoule', quantiteStock: 45, seuilAlerte: 10,
    numerLot: 'AMI-2025-040', dateExpiration: new Date('2027-08-31'),
    fournisseur: 'SANOFI', prixUnitaire: 420, emplacement: 'Chariot urgences'
  },
  {
    nom: 'Bicarbonate de sodium 8,4%', nomGenerique: 'Bicarbonate de sodium',
    categorie: 'Autre', forme: 'Flacon', dosageUnitaire: '8,4 g / 100 mL',
    unite: 'flacon', quantiteStock: 60, seuilAlerte: 15,
    numerLot: 'BIC-2025-041', dateExpiration: new Date('2027-10-31'),
    fournisseur: 'BAXTER', prixUnitaire: 180, emplacement: 'Chariot urgences'
  },
  {
    nom: 'Gluconate de calcium', nomGenerique: 'Gluconate de calcium',
    categorie: 'Autre', forme: 'Ampoule', dosageUnitaire: '1 g / 10 mL',
    unite: 'ampoule', quantiteStock: 80, seuilAlerte: 20,
    numerLot: 'CAL-2025-042', dateExpiration: new Date('2027-05-31'),
    fournisseur: 'AGUETTANT', prixUnitaire: 130, emplacement: 'Armoire REA'
  },
  {
    nom: 'Potassium chlorure 10%', nomGenerique: 'Chlorure de potassium',
    categorie: 'Autre', forme: 'Ampoule', dosageUnitaire: '1 g / 10 mL',
    unite: 'ampoule', quantiteStock: 120, seuilAlerte: 30,
    numerLot: 'KCL-2025-043', dateExpiration: new Date('2027-12-31'),
    fournisseur: 'BAXTER', prixUnitaire: 95, emplacement: 'Armoire REA'
  },
  {
    nom: 'Magnésium sulfate 15%', nomGenerique: 'Sulfate de magnésium',
    categorie: 'Autre', forme: 'Ampoule', dosageUnitaire: '1,5 g / 10 mL',
    unite: 'ampoule', quantiteStock: 70, seuilAlerte: 15,
    numerLot: 'MAG-2025-044', dateExpiration: new Date('2027-11-30'),
    fournisseur: 'AGUETTANT', prixUnitaire: 110, emplacement: 'Armoire REA'
  }
];

async function seed() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connecté à MongoDB');

    const existing = await Medicament.countDocuments();
    if (existing > 0) {
      console.log(`⚠️  ${existing} médicament(s) déjà présent(s). Suppression en cours...`);
      await Medicament.deleteMany({});
      console.log('🗑️  Stock existant effacé.');
    }

    const docs = medicaments.map(m => ({
      ...m,
      mouvements: m.quantiteStock > 0 ? [{
        type: 'ENTREE',
        quantite: m.quantiteStock,
        raison: 'Stock initial – chargement système',
        effectuePar: 'Administrateur'
      }] : []
    }));

    await Medicament.insertMany(docs);
    console.log(`✅ ${docs.length} médicaments insérés avec succès.`);

    const stats = await Medicament.aggregate([
      { $group: { _id: '$categorie', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);
    console.log('\n📦 Répartition par catégorie :');
    stats.forEach(s => console.log(`   ${s._id.padEnd(20)} → ${s.count}`));

  } catch (err) {
    console.error('❌ Erreur :', err.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Déconnecté de MongoDB.');
  }
}

seed();
