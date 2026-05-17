require('dotenv').config();
const mongoose = require('mongoose');

const TESTS = [
  // HÉMATOLOGIE
  { nom:'Hémoglobine', categorie:'Hématologie', unite:'g/dL', description:'Taux d\'hémoglobine sanguin', plages:[{sexe:'M',ageMin:0,ageMax:999,min:13.5,max:17.5},{sexe:'F',ageMin:0,ageMax:999,min:12,max:16}] },
  { nom:'Hématocrite', categorie:'Hématologie', unite:'%', description:'Volume des globules rouges', plages:[{sexe:'M',ageMin:0,ageMax:999,min:40,max:52},{sexe:'F',ageMin:0,ageMax:999,min:36,max:48}] },
  { nom:'Globules rouges (GR)', categorie:'Hématologie', unite:'T/L', description:'Érythrocytes', plages:[{sexe:'M',ageMin:0,ageMax:999,min:4.5,max:5.9},{sexe:'F',ageMin:0,ageMax:999,min:4,max:5.2}] },
  { nom:'Globules blancs (GB)', categorie:'Hématologie', unite:'G/L', description:'Leucocytes totaux', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:4,max:10}] },
  { nom:'Polynucléaires neutrophiles', categorie:'Hématologie', unite:'G/L', description:'PNN', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:1.8,max:7.5}] },
  { nom:'Lymphocytes', categorie:'Hématologie', unite:'G/L', description:'', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:1,max:4}] },
  { nom:'Monocytes', categorie:'Hématologie', unite:'G/L', description:'', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:0.2,max:1}] },
  { nom:'Éosinophiles', categorie:'Hématologie', unite:'G/L', description:'', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:0.05,max:0.5}] },
  { nom:'Plaquettes', categorie:'Hématologie', unite:'G/L', description:'Thrombocytes', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:150,max:400}] },
  { nom:'VGM', categorie:'Hématologie', unite:'fL', description:'Volume globulaire moyen', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:80,max:100}] },
  { nom:'TCMH', categorie:'Hématologie', unite:'pg', description:'Teneur corpusculaire en hémoglobine', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:27,max:33}] },
  { nom:'CCMH', categorie:'Hématologie', unite:'g/dL', description:'Concentration corpusculaire en hémoglobine', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:32,max:36}] },
  { nom:'Réticulocytes', categorie:'Hématologie', unite:'%', description:'Précurseurs globules rouges', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:0.5,max:2.5}] },
  { nom:'VS (Vitesse de sédimentation)', categorie:'Hématologie', unite:'mm/h', description:'1ère heure', plages:[{sexe:'M',ageMin:0,ageMax:50,min:0,max:15},{sexe:'M',ageMin:50,ageMax:999,min:0,max:20},{sexe:'F',ageMin:0,ageMax:50,min:0,max:20},{sexe:'F',ageMin:50,ageMax:999,min:0,max:30}] },
  // BIOCHIMIE
  { nom:'Créatinine', categorie:'Biochimie', unite:'µmol/L', description:'Marqueur fonction rénale', plages:[{sexe:'M',ageMin:0,ageMax:999,min:62,max:106},{sexe:'F',ageMin:0,ageMax:999,min:44,max:80}] },
  { nom:'Urée', categorie:'Biochimie', unite:'mmol/L', description:'Catabolisme protéique', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:2.5,max:7.5}] },
  { nom:'Acide urique', categorie:'Biochimie', unite:'µmol/L', description:'', plages:[{sexe:'M',ageMin:0,ageMax:999,min:200,max:420},{sexe:'F',ageMin:0,ageMax:999,min:150,max:360}] },
  { nom:'Glycémie', categorie:'Biochimie', unite:'mmol/L', description:'Glucose à jeun', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:3.9,max:6.1}] },
  { nom:'HbA1c', categorie:'Biochimie', unite:'%', description:'Hémoglobine glyquée', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:4,max:5.7}] },
  { nom:'CRP (Protéine C-réactive)', categorie:'Biochimie', unite:'mg/L', description:'Marqueur inflammation', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:0,max:5}] },
  { nom:'Albumine', categorie:'Biochimie', unite:'g/L', description:'Protéine plasmatique principale', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:35,max:52}] },
  { nom:'Protéines totales', categorie:'Biochimie', unite:'g/L', description:'', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:64,max:83}] },
  { nom:'Bilirubine totale', categorie:'Biochimie', unite:'µmol/L', description:'', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:5,max:17}] },
  { nom:'Bilirubine directe', categorie:'Biochimie', unite:'µmol/L', description:'', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:0,max:5}] },
  { nom:'ASAT (TGO)', categorie:'Biochimie', unite:'UI/L', description:'Transaminase aspartique', plages:[{sexe:'M',ageMin:0,ageMax:999,min:0,max:40},{sexe:'F',ageMin:0,ageMax:999,min:0,max:35}] },
  { nom:'ALAT (TGP)', categorie:'Biochimie', unite:'UI/L', description:'Transaminase alanine', plages:[{sexe:'M',ageMin:0,ageMax:999,min:0,max:41},{sexe:'F',ageMin:0,ageMax:999,min:0,max:31}] },
  { nom:'Gamma-GT', categorie:'Biochimie', unite:'UI/L', description:'', plages:[{sexe:'M',ageMin:0,ageMax:999,min:10,max:55},{sexe:'F',ageMin:0,ageMax:999,min:7,max:38}] },
  { nom:'PAL (Phosphatases alcalines)', categorie:'Biochimie', unite:'UI/L', description:'', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:35,max:105}] },
  { nom:'LDH', categorie:'Biochimie', unite:'UI/L', description:'Lacticodéshydrogénase', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:135,max:225}] },
  { nom:'CPK (Créatine phosphokinase)', categorie:'Biochimie', unite:'UI/L', description:'Marqueur musculaire', plages:[{sexe:'M',ageMin:0,ageMax:999,min:24,max:195},{sexe:'F',ageMin:0,ageMax:999,min:24,max:170}] },
  { nom:'Lipase', categorie:'Biochimie', unite:'UI/L', description:'Enzyme pancréatique', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:13,max:60}] },
  { nom:'Amylase', categorie:'Biochimie', unite:'UI/L', description:'', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:30,max:110}] },
  { nom:'Troponine I', categorie:'Biochimie', unite:'µg/L', description:'Marqueur nécrose myocardique', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:0,max:0.04}] },
  { nom:'Troponine T hs', categorie:'Biochimie', unite:'ng/L', description:'Troponine haute sensibilité', plages:[{sexe:'M',ageMin:0,ageMax:999,min:0,max:19},{sexe:'F',ageMin:0,ageMax:999,min:0,max:14}] },
  { nom:'BNP', categorie:'Biochimie', unite:'pg/mL', description:'Peptide natriurétique', plages:[{sexe:'TOUS',ageMin:0,ageMax:75,min:0,max:100},{sexe:'TOUS',ageMin:75,ageMax:999,min:0,max:200}] },
  { nom:'NT-proBNP', categorie:'Biochimie', unite:'pg/mL', description:'', plages:[{sexe:'TOUS',ageMin:0,ageMax:75,min:0,max:125},{sexe:'TOUS',ageMin:75,ageMax:999,min:0,max:450}] },
  { nom:'Procalcitonine (PCT)', categorie:'Biochimie', unite:'µg/L', description:'Marqueur infectieux bactérien', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:0,max:0.5}] },
  { nom:'Lactate', categorie:'Biochimie', unite:'mmol/L', description:'Métabolisme anaérobie', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:0.5,max:2.2}] },
  { nom:'Ferritine', categorie:'Biochimie', unite:'µg/L', description:'Réserves en fer', plages:[{sexe:'M',ageMin:0,ageMax:999,min:30,max:400},{sexe:'F',ageMin:0,ageMax:999,min:15,max:200}] },
  { nom:'Fer sérique', categorie:'Biochimie', unite:'µmol/L', description:'', plages:[{sexe:'M',ageMin:0,ageMax:999,min:11,max:29},{sexe:'F',ageMin:0,ageMax:999,min:7,max:27}] },
  { nom:'Cholestérol total', categorie:'Biochimie', unite:'mmol/L', description:'', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:0,max:5.2}] },
  { nom:'HDL-Cholestérol', categorie:'Biochimie', unite:'mmol/L', description:'', plages:[{sexe:'M',ageMin:0,ageMax:999,min:1,max:1.6},{sexe:'F',ageMin:0,ageMax:999,min:1.2,max:2}] },
  { nom:'LDL-Cholestérol', categorie:'Biochimie', unite:'mmol/L', description:'', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:0,max:3.4}] },
  { nom:'Triglycérides', categorie:'Biochimie', unite:'mmol/L', description:'', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:0.4,max:1.7}] },
  // IONOGRAMME
  { nom:'Sodium (Na+)', categorie:'Ionogramme', unite:'mmol/L', description:'Natrémie', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:136,max:145}] },
  { nom:'Potassium (K+)', categorie:'Ionogramme', unite:'mmol/L', description:'Kaliémie', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:3.5,max:5.0}] },
  { nom:'Chlorures (Cl-)', categorie:'Ionogramme', unite:'mmol/L', description:'', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:98,max:107}] },
  { nom:'Bicarbonates (HCO3-)', categorie:'Ionogramme', unite:'mmol/L', description:'Réserve alcaline', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:22,max:29}] },
  { nom:'Calcium ionisé', categorie:'Ionogramme', unite:'mmol/L', description:'', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:1.15,max:1.35}] },
  { nom:'Calcium total', categorie:'Ionogramme', unite:'mmol/L', description:'', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:2.2,max:2.6}] },
  { nom:'Magnésium (Mg2+)', categorie:'Ionogramme', unite:'mmol/L', description:'', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:0.7,max:1.1}] },
  { nom:'Phosphore inorganique', categorie:'Ionogramme', unite:'mmol/L', description:'', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:0.8,max:1.45}] },
  // COAGULATION
  { nom:'TP (Taux de prothrombine)', categorie:'Coagulation', unite:'%', description:'', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:70,max:100}] },
  { nom:'INR', categorie:'Coagulation', unite:'', description:'International Normalized Ratio', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:0.8,max:1.2}] },
  { nom:'TCA', categorie:'Coagulation', unite:'s', description:'Temps de céphaline activée', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:25,max:35}] },
  { nom:'Fibrinogène', categorie:'Coagulation', unite:'g/L', description:'Facteur I', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:2,max:4}] },
  { nom:'D-dimères', categorie:'Coagulation', unite:'µg/L', description:'Fibrinolyse', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:0,max:500}] },
  { nom:'Antithrombine III', categorie:'Coagulation', unite:'%', description:'', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:80,max:120}] },
  // GAZOMÉTRIE
  { nom:'pH artériel', categorie:'Gazométrie', unite:'', description:'Équilibre acido-basique', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:7.35,max:7.45}] },
  { nom:'PaO2', categorie:'Gazométrie', unite:'mmHg', description:'Pression partielle O2 artériel', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:80,max:100}] },
  { nom:'PaCO2', categorie:'Gazométrie', unite:'mmHg', description:'Pression partielle CO2', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:35,max:45}] },
  { nom:'SaO2', categorie:'Gazométrie', unite:'%', description:'Saturation artérielle O2', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:95,max:100}] },
  { nom:'HCO3- artériel', categorie:'Gazométrie', unite:'mmol/L', description:'Bicarbonate artériel', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:22,max:26}] },
  { nom:'Excès de base (BE)', categorie:'Gazométrie', unite:'mmol/L', description:'Base Excess', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:-2,max:2}] },
  { nom:'PaO2/FiO2 (Horowitz)', categorie:'Gazométrie', unite:'mmHg', description:'Index oxygénation', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:300,max:500}] },
  // ENDOCRINOLOGIE
  { nom:'TSH', categorie:'Endocrinologie', unite:'mUI/L', description:'Thyréostimuline', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:0.4,max:4.0}] },
  { nom:'T4 libre (FT4)', categorie:'Endocrinologie', unite:'pmol/L', description:'Thyroxine libre', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:12,max:22}] },
  { nom:'T3 libre (FT3)', categorie:'Endocrinologie', unite:'pmol/L', description:'', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:3.1,max:6.8}] },
  { nom:'Cortisol (8h)', categorie:'Endocrinologie', unite:'nmol/L', description:'Cortisol matinal', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:171,max:536}] },
  { nom:'Insuline à jeun', categorie:'Endocrinologie', unite:'mUI/L', description:'', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:3,max:25}] },
  { nom:'PTH (Parathormone)', categorie:'Endocrinologie', unite:'pg/mL', description:'', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:15,max:65}] },
  { nom:'Vitamine D (25-OH)', categorie:'Endocrinologie', unite:'ng/mL', description:'', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:30,max:100}] },
  { nom:'Prolactine', categorie:'Endocrinologie', unite:'mUI/L', description:'', plages:[{sexe:'M',ageMin:0,ageMax:999,min:53,max:360},{sexe:'F',ageMin:0,ageMax:999,min:40,max:530}] },
  { nom:'Testostérone totale', categorie:'Endocrinologie', unite:'nmol/L', description:'', plages:[{sexe:'M',ageMin:18,ageMax:999,min:9.9,max:27.8},{sexe:'F',ageMin:18,ageMax:999,min:0.2,max:2.9}] },
  // IMMUNOLOGIE
  { nom:'CRP ultrasensible', categorie:'Immunologie', unite:'mg/L', description:'', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:0,max:1}] },
  { nom:'IgG', categorie:'Immunologie', unite:'g/L', description:'Immunoglobulines G', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:7,max:16}] },
  { nom:'IgA', categorie:'Immunologie', unite:'g/L', description:'Immunoglobulines A', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:0.7,max:4}] },
  { nom:'IgM', categorie:'Immunologie', unite:'g/L', description:'Immunoglobulines M', plages:[{sexe:'M',ageMin:0,ageMax:999,min:0.4,max:2.3},{sexe:'F',ageMin:0,ageMax:999,min:0.5,max:2.8}] },
  { nom:'Complément C3', categorie:'Immunologie', unite:'g/L', description:'', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:0.9,max:1.8}] },
  { nom:'Complément C4', categorie:'Immunologie', unite:'g/L', description:'', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:0.1,max:0.4}] },
  { nom:'Facteur rhumatoïde (FR)', categorie:'Immunologie', unite:'UI/mL', description:'', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:0,max:14}] },
  { nom:'AgHBs (Hépatite B)', categorie:'Immunologie', unite:'', description:'Antigène hépatite B surface', plages:[] },
  { nom:'Anti-HCV (Hépatite C)', categorie:'Immunologie', unite:'', description:'Anticorps hépatite C', plages:[] },
  // UROLOGIE
  { nom:'Protéinurie 24h', categorie:'Urologie', unite:'mg/24h', description:'', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:0,max:150}] },
  { nom:'Créatininurie 24h', categorie:'Urologie', unite:'mmol/24h', description:'', plages:[{sexe:'M',ageMin:0,ageMax:999,min:9,max:17},{sexe:'F',ageMin:0,ageMax:999,min:7,max:14}] },
  { nom:'Natriurie 24h', categorie:'Urologie', unite:'mmol/24h', description:'Sodium urinaire', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:100,max:250}] },
  { nom:'Kaliurie 24h', categorie:'Urologie', unite:'mmol/24h', description:'', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:25,max:125}] },
  { nom:'Microalbuminurie 24h', categorie:'Urologie', unite:'mg/24h', description:'', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:0,max:30}] },
  { nom:'Clairance créatinine', categorie:'Urologie', unite:'mL/min', description:'DFG estimé (Cockroft)', plages:[{sexe:'M',ageMin:0,ageMax:999,min:90,max:140},{sexe:'F',ageMin:0,ageMax:999,min:80,max:125}] },
  // MICROBIOLOGIE
  { nom:'Hémoculture aérobie', categorie:'Microbiologie', unite:'', description:'Culture sanguine aérobiose', plages:[] },
  { nom:'Hémoculture anaérobie', categorie:'Microbiologie', unite:'', description:'Culture sanguine anaérobiose', plages:[] },
  { nom:'ECBU', categorie:'Microbiologie', unite:'', description:'Examen cytobactériologique urinaire', plages:[] },
  { nom:'Coproculture', categorie:'Microbiologie', unite:'', description:'Culture des selles', plages:[] },
  { nom:'Ag urinaire légionelle', categorie:'Microbiologie', unite:'', description:'', plages:[] },
  { nom:'Ag urinaire pneumocoque', categorie:'Microbiologie', unite:'', description:'', plages:[] },
  { nom:'Procalcitonine PCT sérique', categorie:'Microbiologie', unite:'µg/L', description:'Sepsis bactérien', plages:[{sexe:'TOUS',ageMin:0,ageMax:999,min:0,max:0.25}] },
];

async function run() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db;
  const col = db.collection('lab_tests');

  const existing = await col.find({}, { projection: { nom: 1 } }).toArray();
  const existingNames = new Set(existing.map(t => t.nom.toLowerCase()));

  let added = 0;
  for (const test of TESTS) {
    if (!existingNames.has(test.nom.toLowerCase())) {
      await col.insertOne({ ...test, createdAt: new Date(), updatedAt: new Date() });
      added++;
      process.stdout.write(`\r✅ Ajouté ${added}/${TESTS.length}: ${test.nom.substring(0,40).padEnd(40)}`);
    }
  }

  console.log(`\n\n✅ ${added} tests ajoutés au catalogue`);
  console.log(`ℹ️  ${TESTS.length - added} tests déjà existants`);
  await mongoose.disconnect();
}

run().catch(e => { console.error('\n❌', e.message); process.exit(1); });
