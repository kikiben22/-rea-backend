const mongoose = require('mongoose');

const braceletSchema = new mongoose.Schema({
  deviceId:       { type: String, required: true },
  patientId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Patient' },
  monitorId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Monitor' },
  firmware:       { type: String, default: '1.0.0' },
  battery:        { type: Number, min: 0, max: 100, default: 100 },
  isOnline:       { type: Boolean, default: false },
  lastSeen:       { type: Date, default: Date.now },
  lastFallAt:     { type: Date },
  fallCount:      { type: Number, default: 0 },
  movementType:   { type: String, enum: ['REPOS', 'LEGER', 'FORT'], default: 'REPOS' },
  lastMovementAt: { type: Date },
  movementCount:  { type: Number, default: 0 },
  lastAcc:        { type: Number, default: 0 },
  lastGyr:        { type: Number, default: 0 },
  litName:        { type: String, default: '' },
}, { timestamps: true });

braceletSchema.index({ deviceId: 1 }, { unique: true });
braceletSchema.index({ patientId: 1 });

module.exports = mongoose.model('Bracelet', braceletSchema);
