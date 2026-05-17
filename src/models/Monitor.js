const mongoose = require('mongoose');

const thresholdSchema = new mongoose.Schema({
  param: String,
  min: Number,
  max: Number,
  criticalMin: Number,
  criticalMax: Number
});

const monitorSchema = new mongoose.Schema({
  monitorId: { type: String, unique: true, required: true },
  brand: { type: String, default: 'Mindray' },
  model: String,
  serialNumber: String,
  bedNumber: { type: String, required: true },
  unit: { type: String, default: 'REA' },
  isOnline: { type: Boolean, default: true },
  isOccupied: { type: Boolean, default: false },
  currentPatient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', default: null },

  // Thresholds personnalisés
  thresholds: {
    heartRate:   { minVal: { type: Number, default: 40  }, maxVal: { type: Number, default: 150 }, criticalMin: { type: Number, default: 30  }, criticalMax: { type: Number, default: 180 } },
    spo2:        { minVal: { type: Number, default: 92  }, maxVal: { type: Number, default: 100 }, criticalMin: { type: Number, default: 88  }, criticalMax: { type: Number, default: 100 } },
    systolicBP:  { minVal: { type: Number, default: 85  }, maxVal: { type: Number, default: 160 }, criticalMin: { type: Number, default: 70  }, criticalMax: { type: Number, default: 200 } },
    diastolicBP: { minVal: { type: Number, default: 50  }, maxVal: { type: Number, default: 100 }, criticalMin: { type: Number, default: 40  }, criticalMax: { type: Number, default: 120 } },
    respRate:    { minVal: { type: Number, default: 10  }, maxVal: { type: Number, default: 30  }, criticalMin: { type: Number, default: 6   }, criticalMax: { type: Number, default: 40  } },
    temperature: { minVal: { type: Number, default: 35  }, maxVal: { type: Number, default: 39  }, criticalMin: { type: Number, default: 34  }, criticalMax: { type: Number, default: 41  } },
    etco2:       { minVal: { type: Number, default: 30  }, maxVal: { type: Number, default: 50  }, criticalMin: { type: Number, default: 20  }, criticalMax: { type: Number, default: 60  } },
    glasgow:     { minVal: { type: Number, default: 8   }, maxVal: { type: Number, default: 15  }, criticalMin: { type: Number, default: 3   }, criticalMax: { type: Number, default: 15  } },
  },

  // Dernier relevé
  lastVitals: {
    heartRate: Number,
    spo2: Number,
    systolicBP: Number,
    diastolicBP: Number,
    respRate: Number,
    temperature: Number,
    etco2: Number,
    glasgow: Number,
    timestamp: Date
  },

  alarmStatus: {
    type: String,
    enum: ['NORMAL', 'WARNING', 'CRITICAL', 'SILENCED'],
    default: 'NORMAL'
  },

  // Paramètres PNI (Pression Non-Invasive)
  pniInterval: {
    type: Number,
    default: 15,
    enum: [1, 2, 2.5, 5, 10, 15, 30, 60, 120, 240, 480]
  },
  lastPniAt: Date,

  // Mode de mesure SpO2
  spo2Mode: {
    type: String,
    default: 'continuous',
    enum: ['continuous', '5min', '10min', 'manual']
  },

  lastMaintenance: Date,
  installDate: Date
}, {
  timestamps: true
});

module.exports = mongoose.model('Monitor', monitorSchema);
