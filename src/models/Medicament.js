const mongoose = require('mongoose');

const mouvementSchema = new mongoose.Schema({
  type:        { type: String, enum: ['ENTREE', 'SORTIE'], required: true },
  quantite:    { type: Number, required: true },
  raison:      { type: String },          // ex: "Prescrit à PAT-001", "Livraison fournisseur"
  patientId:   { type: String },          // si sortie liée à un patient
  effectuePar: { type: String },
  date:        { type: Date, default: Date.now }
});

const medicamentSchema = new mongoose.Schema({
  nom:           { type: String, required: true },
  nomGenerique:  { type: String },
  categorie: {
    type: String,
    enum: ['Antibiotique', 'Antalgique', 'Sédatif', 'Anticoagulant', 'Vasopresseur',
           'Diurétique', 'Corticoïde', 'Antihypertenseur', 'Autre'],
    default: 'Autre'
  },
  forme:         { type: String, enum: ['Comprimé', 'Ampoule', 'Flacon', 'Poche', 'Seringue', 'Autre'], default: 'Ampoule' },
  dosageUnitaire:{ type: String },        // ex: "500 mg", "1000 UI"
  unite:         { type: String, default: 'unité' },

  // Stock
  quantiteStock: { type: Number, default: 0, min: 0 },
  seuilAlerte:   { type: Number, default: 10 },

  // Traçabilité
  numerLot:      { type: String },
  dateExpiration:{ type: Date },
  fournisseur:   { type: String },
  prixUnitaire:  { type: Number, default: 0 },

  // Emplacement
  emplacement:   { type: String, default: 'Armoire REA' }, // ex: Frigo, Armoire A

  // Historique mouvements
  mouvements:    [mouvementSchema],

  isActive: { type: Boolean, default: true }
}, { timestamps: true });

// Niveau de stock
medicamentSchema.virtual('niveauStock').get(function () {
  if (this.quantiteStock === 0) return 'RUPTURE';
  if (this.quantiteStock <= this.seuilAlerte) return 'CRITIQUE';
  return 'OK';
});

module.exports = mongoose.model('Medicament', medicamentSchema);
