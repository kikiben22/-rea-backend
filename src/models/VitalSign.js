const mongoose = require('mongoose');

// TTL index: suppression auto après 30 jours
const vitalSignSchema = new mongoose.Schema({
  monitorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Monitor', required: true },
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
  timestamp: { type: Date, default: Date.now, index: { expires: '30d' } },

  // Paramètres cardiovasculaires
  heartRate: { value: Number, alarm: { type: String, enum: ['NORMAL','WARNING','CRITICAL'], default: 'NORMAL' } },
  spo2: { value: Number, alarm: { type: String, enum: ['NORMAL','WARNING','CRITICAL'], default: 'NORMAL' } },
  systolicBP: { value: Number, alarm: { type: String, enum: ['NORMAL','WARNING','CRITICAL'], default: 'NORMAL' } },
  diastolicBP: { value: Number, alarm: { type: String, enum: ['NORMAL','WARNING','CRITICAL'], default: 'NORMAL' } },
  meanArterialPressure: Number,

  // Paramètres respiratoires
  respRate: { value: Number, alarm: { type: String, enum: ['NORMAL','WARNING','CRITICAL'], default: 'NORMAL' } },
  etco2: { value: Number, alarm: { type: String, enum: ['NORMAL','WARNING','CRITICAL'], default: 'NORMAL' } },
  tidalVolume: Number,
  peep: Number,

  // Neurologique
  glasgow: { value: Number, alarm: { type: String, enum: ['NORMAL','WARNING','CRITICAL'], default: 'NORMAL' } },

  // Température
  temperature: { value: Number, alarm: { type: String, enum: ['NORMAL','WARNING','CRITICAL'], default: 'NORMAL' } },

  // ECG simulé (array de points)
  ecgWaveform: [Number],

  // Status global du relevé
  overallAlarm: { type: String, enum: ['NORMAL','WARNING','CRITICAL'], default: 'NORMAL' }
}, {
  timestamps: false
});

vitalSignSchema.index({ patientId: 1, timestamp: -1 });
vitalSignSchema.index({ monitorId: 1, timestamp: -1 });

module.exports = mongoose.model('VitalSign', vitalSignSchema);
