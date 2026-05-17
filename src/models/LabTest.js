const mongoose = require('mongoose');

const plageSchema = new mongoose.Schema({
  sexe:   { type: String, enum: ['M', 'F', 'TOUS'], default: 'TOUS' },
  ageMin: { type: Number, default: 0 },
  ageMax: { type: Number, default: 999 },
  min:    { type: Number, required: true },
  max:    { type: Number, required: true },
}, { _id: false });

const labTestSchema = new mongoose.Schema({
  nom:        { type: String, required: true, trim: true },
  categorie:  { type: String, required: true, trim: true },
  unite:      { type: String, default: '' },
  description:{ type: String, default: '' },
  plages:     [plageSchema],
  actif:      { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('LabTest', labTestSchema, 'lab_tests');
