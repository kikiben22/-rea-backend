const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  monitorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Monitor' },
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient' },
  type: {
    type: String,
    enum: ['VITAL_CRITICAL', 'VITAL_WARNING', 'EQUIPMENT', 'AI_PREDICTION', 'MEDICATION', 'MANUAL', 'BRACELET_FALL'],
    required: true
  },
  severity: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], required: true },
  parameter: String,         // ex: 'heartRate', 'spo2'
  currentValue: Number,
  threshold: Number,
  message: { type: String, required: true },
  acknowledged: { type: Boolean, default: false },
  acknowledgedBy: String,
  acknowledgedAt: Date,
  resolved: { type: Boolean, default: false },
  resolvedAt: Date,
  escalated: { type: Boolean, default: false }
}, {
  timestamps: true
});

alertSchema.index({ patientId: 1, createdAt: -1 });
alertSchema.index({ acknowledged: 1, resolved: 1 });

module.exports = mongoose.model('Alert', alertSchema);
