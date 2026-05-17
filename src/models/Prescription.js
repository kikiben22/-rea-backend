const mongoose = require('mongoose');

// Chaque administration cochée par l'infirmier
const administrationSchema = new mongoose.Schema({
  date:        { type: Date, default: Date.now },   // automatique
  heure:       { type: String },                     // ex: "08:30" auto
  infirmier:   { type: String, required: true },
  infirmierId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  statut:      { type: String, enum: ['ADMINISTRE', 'REFUSE', 'REPORTE'], default: 'ADMINISTRE' },
  note:        { type: String }
}, { timestamps: true });

const prescriptionSchema = new mongoose.Schema({
  // Référence patient
  patientId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
  patientInfo: { nom: String, prenom: String, patientId: String, lit: String }, // cache

  // Médicament prescrit
  medicament:      { type: String, required: true },
  dosage:          { type: String, required: true },
  voie:            { type: String, enum: ['IV', 'PO', 'IM', 'SC', 'SL', 'Inhalation', 'Topique'], default: 'IV' },
  frequence:       { type: String, required: true },
  heurePrise:      { type: String },              // ex: "08:00"
  dateDebut:       { type: Date, default: Date.now }, // automatique à la création
  dureeJours:      { type: Number },              // durée en jours
  dateFin:         { type: Date },                // calculée automatiquement
  instructions:    { type: String },

  // Stock lié (optionnel)
  stockMedicamentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicament' },

  // Médecin prescripteur
  prescritPar:     { type: String, required: true },   // nom complet médecin
  prescritParId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  datePrescription:{ type: Date, default: Date.now },  // automatique

  // Validation par le médecin
  statut: {
    type: String,
    enum: ['BROUILLON', 'VALIDEE', 'ANNULEE', 'TERMINEE'],
    default: 'BROUILLON'
  },
  valideDate:  { type: Date },
  validePar:   { type: String },

  // Administrations cochées par l'infirmier
  administrations: [administrationSchema],

  // Infirmier assigné
  infirmierAssigne: { type: String }

}, { timestamps: true });

// Calculer la date de fin automatiquement
prescriptionSchema.pre('save', function (next) {
  if (this.dureeJours && this.dateDebut && !this.dateFin) {
    const fin = new Date(this.dateDebut);
    fin.setDate(fin.getDate() + this.dureeJours);
    this.dateFin = fin;
  }
  next();
});

module.exports = mongoose.model('Prescription', prescriptionSchema);
