const mongoose = require('mongoose');

const testResultSchema = new mongoose.Schema({
  patientId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
  examId:          { type: String },
  nom:             { type: String, required: true },
  type:            { type: String, default: 'Biologie' },
  categorie:       { type: String, default: '' },
  labTestId:       { type: mongoose.Schema.Types.ObjectId, ref: 'LabTest', default: null },
  valeur:          { type: Number, default: null },
  unite:           { type: String, default: '' },
  refMin:          { type: Number, default: null },
  refMax:          { type: Number, default: null },
  interpretation:  { type: String, enum: ['NORMAL','ELEVE','BAS','LIMITE',''], default: '' },
  resultat:        { type: String, default: '' },
  note:            { type: String, default: '' },
  dateTest:        { type: Date, default: Date.now },
  prochainTest:    { type: Date, default: null },
  repetitionJours: { type: Number, default: null },
  prescritPar:     { type: String, default: '' },
  saisiPar:        { type: String, default: '' },
}, { timestamps: true });

testResultSchema.index({ patientId: 1, dateTest: -1 });
testResultSchema.index({ labTestId: 1, dateTest: -1 });

module.exports = mongoose.model('TestResult', testResultSchema, 'tests');
