const express    = require('express');
const Patient    = require('../models/Patient');
const Monitor    = require('../models/Monitor');
const Bracelet   = require('../models/Bracelet');
const TestResult = require('../models/TestResult');
const { authenticate } = require('../middleware/auth');
const { getIo } = require('../socket/ioInstance');
const router = express.Router();

// GET /api/patients — liste tous les patients actifs
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, unit, page = 1, limit = 20 } = req.query;
    const filter = { isActive: true };
    if (status) filter.status = status;
    if (unit) filter.unit = unit;

    const patients = await Patient.find(filter)
      .populate('monitorId', 'monitorId bedNumber brand model isOnline alarmStatus lastVitals')
      .sort({ bedNumber: 1, admissionDate: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await Patient.countDocuments(filter);
    res.json({ patients, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/patients/:id — détail patient
router.get('/:id', authenticate, async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.id)
      .populate('monitorId');
    if (!patient) return res.status(404).json({ message: 'Patient non trouvé' });
    res.json(patient);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/patients — créer patient
router.post('/', authenticate, async (req, res) => {
  try {
    const patientId = `PAT-${Date.now()}`;
    const patient = new Patient({ ...req.body, patientId });
    await patient.save();

    // Marquer le moniteur comme occupé
    if (req.body.monitorId) {
      await Monitor.findByIdAndUpdate(req.body.monitorId, {
        isOccupied: true,
        currentPatient: patient._id
      });
    }
    res.status(201).json(patient);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/patients/:id — mettre à jour
router.put('/:id', authenticate, async (req, res) => {
  try {
    const patient = await Patient.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!patient) return res.status(404).json({ message: 'Patient non trouvé' });
    res.json(patient);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/patients/:id/medications — ajouter médicament
router.post('/:id/medications', authenticate, async (req, res) => {
  try {
    const { type, medication } = req.body; // type: 'before' | 'icu'
    const patient = await Patient.findById(req.params.id);
    if (!patient) return res.status(404).json({ message: 'Patient non trouvé' });

    const med = { ...medication, prescribedBy: req.user.fullName };
    if (type === 'before') {
      patient.medicationsBefore.push(med);
    } else {
      patient.medicationsICU.push(med);
    }
    await patient.save();
    res.json(patient);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/patients/:id/medications/:medId — modifier un médicament
router.put('/:id/medications/:medId', authenticate, async (req, res) => {
  try {
    const { type, medication } = req.body; // type: 'before' | 'icu'
    const patient = await Patient.findById(req.params.id);
    if (!patient) return res.status(404).json({ message: 'Patient non trouvé' });

    const array = type === 'before' ? patient.medicationsBefore : patient.medicationsICU;
    const med = array.id(req.params.medId);
    if (!med) return res.status(404).json({ message: 'Médicament non trouvé' });

    Object.assign(med, medication);
    await patient.save();
    res.json(patient);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/patients/:id/medications/:medId — supprimer un médicament
router.delete('/:id/medications/:medId', authenticate, async (req, res) => {
  try {
    const { type } = req.query; // type: 'before' | 'icu'
    const patient = await Patient.findById(req.params.id);
    if (!patient) return res.status(404).json({ message: 'Patient non trouvé' });

    if (type === 'before') {
      patient.medicationsBefore = patient.medicationsBefore.filter(
        m => m._id.toString() !== req.params.medId
      );
    } else {
      patient.medicationsICU = patient.medicationsICU.filter(
        m => m._id.toString() !== req.params.medId
      );
    }
    await patient.save();
    res.json({ message: 'Médicament supprimé', patient });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/patients/:id/medications/rapport — rapport médicaments d'un patient
router.get('/:id/medications/rapport', authenticate, async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.id).select(
      'firstName lastName patientId bedNumber medicationsBefore medicationsICU admissionDate'
    );
    if (!patient) return res.status(404).json({ message: 'Patient non trouvé' });

    const allMeds = [
      ...patient.medicationsBefore.map(m => ({ ...m.toObject(), type: 'Avant REA' })),
      ...patient.medicationsICU.map(m => ({ ...m.toObject(), type: 'REA' }))
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
      patient: {
        id: patient._id,
        patientId: patient.patientId,
        fullName: `${patient.firstName} ${patient.lastName}`,
        bedNumber: patient.bedNumber,
        admissionDate: patient.admissionDate
      },
      medications: allMeds,
      total: allMeds.length,
      generatedAt: new Date()
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/patients/:id/generer-rapport — enregistre la génération du rapport
router.post('/:id/generer-rapport', authenticate, async (req, res) => {
  try {
    const { generePar } = req.body;
    const patient = await Patient.findByIdAndUpdate(
      req.params.id,
      {
        $push: {
          notes: {
            date:    new Date(),
            author:  generePar || 'Système',
            content: 'Rapport médical complet généré et imprimé',
            type:    'RAPPORT',
          }
        }
      },
      { new: true }
    );
    if (!patient) return res.status(404).json({ message: 'Patient non trouvé' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/patients/:id/examens
router.post('/:id/examens', authenticate, async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.id);
    if (!patient) return res.status(404).json({ message: 'Patient non trouvé' });
    patient.examens.push({ ...req.body, prescritPar: `${req.user.firstName} ${req.user.lastName}`, date: new Date() });
    await patient.save();
    res.status(201).json(patient.examens[patient.examens.length - 1]);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PUT /api/patients/:id/examens/:examId
router.put('/:id/examens/:examId', authenticate, async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.id);
    if (!patient) return res.status(404).json({ message: 'Patient non trouvé' });
    const exam = patient.examens.id(req.params.examId);
    if (!exam) return res.status(404).json({ message: 'Examen non trouvé' });
    Object.assign(exam, req.body);

    // Recalculer l'interprétation automatiquement si valeur + plages disponibles
    if (exam.valeur != null && exam.refMin != null && exam.refMax != null) {
      const v     = parseFloat(exam.valeur);
      const marge = (exam.refMax - exam.refMin) * 0.1;
      if (!isNaN(v)) {
        if      (v > exam.refMax)              exam.interpretation = 'ELEVE';
        else if (v < exam.refMin)              exam.interpretation = 'BAS';
        else if (v > exam.refMax - marge || v < exam.refMin + marge) exam.interpretation = 'LIMITE';
        else                                   exam.interpretation = 'NORMAL';
      }
    }

    await patient.save();

    // Sauvegarder dans collection "tests" quand résultat saisi
    if (req.body.statut === 'RESULTAT' || req.body.resultat) {
      await TestResult.findOneAndUpdate(
        { examId: req.params.examId },
        {
          patientId:       patient._id,
          examId:          req.params.examId,
          nom:             exam.nom,
          type:            exam.type,
          labTestId:       exam.labTestId,
          valeur:          exam.valeur,
          unite:           exam.unite,
          refMin:          exam.refMin,
          refMax:          exam.refMax,
          interpretation:  exam.interpretation,
          resultat:        exam.resultat,
          note:            exam.note,
          dateTest:        exam.dateResultat || new Date(),
          prochainTest:    exam.prochainTest,
          repetitionJours: exam.repetitionJours,
          prescritPar:     exam.prescritPar,
          saisiPar:        `${req.user.firstName} ${req.user.lastName}`,
        },
        { upsert: true, new: true }
      );
    }

    res.json(exam);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE /api/patients/:id/examens/:examId
router.delete('/:id/examens/:examId', authenticate, async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.id);
    if (!patient) return res.status(404).json({ message: 'Patient non trouvé' });
    patient.examens = patient.examens.filter(e => e._id.toString() !== req.params.examId);
    await patient.save();
    res.json({ message: 'Examen supprimé' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET /api/patients/stats/overview
router.get('/stats/overview', authenticate, async (req, res) => {
  try {
    const total = await Patient.countDocuments({ isActive: true });
    const critical = await Patient.countDocuments({ isActive: true, status: 'CRITIQUE' });
    const urgent = await Patient.countDocuments({ isActive: true, urgencyLevel: 'ROUGE' });
    const stable = await Patient.countDocuments({ isActive: true, status: 'STABLE' });
    res.json({ total, critical, urgent, stable });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── PUT /api/patients/:id/bracelet — assigner/retirer bracelet ──────────────
// Lie un bracelet physique (ESP32) à un patient dans la base
router.put('/:id/bracelet', authenticate, async (req, res) => {
  try {
    const { deviceId } = req.body;   // MAC address de l'ESP32, ou null pour retirer
    const patient = await Patient.findById(req.params.id);
    if (!patient) return res.status(404).json({ message: 'Patient introuvable' });

    if (deviceId) {
      // Trouver ou créer le bracelet
      const bracelet = await Bracelet.findOneAndUpdate(
        { deviceId },
        { patientId: patient._id },
        { upsert: true, new: true }
      );
      patient.braceletId = bracelet._id;
      await patient.save();

      const io = getIo();
      if (io) io.to('rea-dashboard').emit('bracelet:updated', {
        ...bracelet.toObject(),
        patientId: { _id: patient._id, firstName: patient.firstName,
                     lastName: patient.lastName, bedNumber: patient.bedNumber }
      });

      res.json({ ok: true, bracelet, patient: { _id: patient._id, firstName: patient.firstName, lastName: patient.lastName } });
    } else {
      // Retirer le bracelet
      if (patient.braceletId) {
        await Bracelet.findByIdAndUpdate(patient.braceletId, { $unset: { patientId: 1 } });
      }
      patient.braceletId = undefined;
      await patient.save();
      res.json({ ok: true, message: 'Bracelet retiré' });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/patients/:id/explorations
router.post('/:id/explorations', authenticate, async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.id);
    if (!patient) return res.status(404).json({ message: 'Patient introuvable' });
    patient.explorations.push({ ...req.body, prescritPar: `${req.user.firstName} ${req.user.lastName}` });
    await patient.save();
    res.status(201).json(patient.explorations[patient.explorations.length - 1]);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE /api/patients/:id/explorations/:expId
router.delete('/:id/explorations/:expId', authenticate, async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.id);
    if (!patient) return res.status(404).json({ message: 'Patient introuvable' });
    patient.explorations = patient.explorations.filter(e => e._id.toString() !== req.params.expId);
    await patient.save();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST /api/patients/:id/photos — ajouter une photo (base64)
router.post('/:id/photos', authenticate, async (req, res) => {
  try {
    const { data, caption } = req.body;
    if (!data) return res.status(400).json({ message: 'data manquant' });
    const patient = await Patient.findById(req.params.id);
    if (!patient) return res.status(404).json({ message: 'Patient introuvable' });
    patient.photos.push({
      data,
      caption: caption || '',
      uploadedBy: req.user?.firstName + ' ' + req.user?.lastName || 'Inconnu',
    });
    await patient.save();
    res.json({ photos: patient.photos });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE /api/patients/:id/photos/:photoId — supprimer une photo
router.delete('/:id/photos/:photoId', authenticate, async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.id);
    if (!patient) return res.status(404).json({ message: 'Patient introuvable' });
    patient.photos = patient.photos.filter(p => p._id.toString() !== req.params.photoId);
    await patient.save();
    res.json({ photos: patient.photos });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
