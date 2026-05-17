const mongoose = require('mongoose');

const medicationSchema = new mongoose.Schema({
  name: String,
  dose: String,
  route: String,       // IV, PO, IM
  frequency: String,
  heure: String,       // ex: "08:30"
  startDate: Date,
  endDate: Date,
  prescribedBy: String,
  notes: String
}, { timestamps: true });

const patientSchema = new mongoose.Schema({
  patientId: { type: String, unique: true, required: true },
  // Identité
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  age: { type: Number, required: true },
  sex: { type: String, enum: ['M', 'F'], required: true },
  birthDate: Date,
  bloodType: { type: String, enum: ['A+','A-','B+','B-','AB+','AB-','O+','O-'] },

  // Admission
  admissionDate: { type: Date, default: Date.now },
  admissionReason: { type: String, required: true },
  urgencyLevel: {
    type: String,
    enum: ['VERT', 'JAUNE', 'ORANGE', 'ROUGE', 'NOIR'],
    default: 'ORANGE'
  },

  // Clinique
  diagnoses: [{ code: String, label: String, type: { type: String } }],
  chronicDiseases: [String],

  // Médicaments
  medicationsBefore: [medicationSchema],
  medicationsICU: [medicationSchema],

  // Moniteur assigné
  monitorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Monitor' },
  bedNumber: String,
  unit: { type: String, default: 'REA' },

  // État
  status: {
    type: String,
    enum: ['STABLE', 'CRITIQUE', 'URGENT', 'AMÉLIORATION', 'SORTI', 'DÉCÉDÉ'],
    default: 'CRITIQUE'
  },
  isActive: { type: Boolean, default: true },
  dischargeDate: Date,
  dischargeReason: String,

  // Examens conseillés
  examens: [{
    nom:         { type: String, required: true },
    type:        { type: String, enum: ['Biologie','Radiologie','Cardiologie','Neurologie','Microbiologie','Autre'], default: 'Biologie' },
    priorite:    { type: String, enum: ['URGENT','NORMAL'], default: 'NORMAL' },
    statut:      { type: String, enum: ['DEMANDE','EN_COURS','RESULTAT','ANNULE'], default: 'DEMANDE' },
    note:        String,
    resultat:    { type: String, default: '' },
    valeur:      { type: Number, default: null },
    unite:       { type: String, default: '' },
    labTestId:   { type: mongoose.Schema.Types.ObjectId, ref: 'LabTest', default: null },
    refMin:      { type: Number, default: null },
    refMax:      { type: Number, default: null },
    interpretation: { type: String, enum: ['NORMAL','ELEVE','BAS','LIMITE',''], default: '' },
    dateResultat:    Date,
    prochainTest:    { type: Date, default: null },
    repetitionJours: { type: Number, default: null },
    renouvele:       { type: Boolean, default: false },
    date:            { type: Date, default: Date.now },
    prescritPar:     String,
    saisiPar:        String
  }],

  // Notes médicales
  notes: [{ date: Date, author: String, content: String, type: String }],

  // Score de gravité IA (mis à jour par ML)
  gravityScore: { type: Number, min: 0, max: 100, default: 0 },
  mortalityRisk24h: { type: Number, min: 0, max: 1, default: 0 },
  mortalityRisk48h: { type: Number, min: 0, max: 1, default: 0 },
  lastPredictionDate: Date,

  // Scores d'admission
  scoreAdmission: {
    igs2:   { type: Number, default: null },
    apache2:{ type: Number, default: null },
    sofa:   { type: Number, default: null },
    glasgow:{ type: Number, default: null },
    saps2:  { type: Number, default: null },
  },

  // Explorations (imagerie, ECG, écho…)
  explorations: [{
    type:        { type: String, enum: ['Radiologie','Échographie','Scanner','IRM','ECG','EEG','Endoscopie','Autre'], default: 'Autre' },
    description: String,
    date:        { type: Date, default: Date.now },
    resultat:    String,
    prescritPar: String,
  }],

  // Avis spécialisés
  avisNeurologie:       { type: String, default: '' },
  avisCardiologie:      { type: String, default: '' },
  avisChirurgie:        { type: String, default: '' },
  avisPneumologie:      { type: String, default: '' },
  avisNephrologie:      { type: String, default: '' },
  avisInfectiologie:    { type: String, default: '' },
  avisAutre:            { type: String, default: '' },
  avisReanimateur:      { type: String, default: '' },
  avisMedecinInterne:   { type: String, default: '' },
  avisMedecinUrgentiste:{ type: String, default: '' },
  decisionReanimateur:  { type: String, enum: ['EN_ATTENTE','DECES','TRANSFERT'], default: 'EN_ATTENTE' },

  // Traitements du séjour (evolution)
  traitementsSejour: [{
    date:        { type: Date, default: Date.now },
    medicament:  String,
    dose:        String,
    voie:        String,
    frequence:   String,
    duree:       String,
    prescritPar: String,
    note:        String,
  }],

  // Conclusion et sortie
  conclusionType: {
    type: String,
    enum: ['EN_COURS', 'DECES', 'TRANSFERT', 'SORTIE_REA'],
    default: 'EN_COURS'
  },
  conclusion:       { type: String, default: '' },
  posteRea:         { type: String, default: '' },
  transfertService: { type: String, default: '' },
  transfertDate:    Date,

  // Décès
  isDead:     { type: Boolean, default: false },
  deathDate:  Date,
  deathCause: { type: String, default: '' },
  deathTime:  { type: String, default: '' },

  // Médecin référent
  referentDoctor: String,
  nurseAssigned: String,

  // Bracelet anti-chute associé
  braceletId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bracelet' },

  // Photos cliniques du patient (base64 data URLs)
  photos: [{
    data:      { type: String, required: true },   // data:image/jpeg;base64,...
    caption:   { type: String, default: '' },
    uploadedAt:{ type: Date,   default: Date.now },
    uploadedBy:{ type: String, default: '' },
  }]
}, {
  timestamps: true
});

patientSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

module.exports = mongoose.model('Patient', patientSchema, 'icu_patients');
