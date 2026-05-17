const express = require('express');
const Prescription = require('../models/Prescription');
const Patient = require('../models/Patient');
const Medicament = require('../models/Medicament');
const { authenticate, authorize } = require('../middleware/auth');
const router = express.Router();

const MEDECINS = ['MEDECIN_REANIMATEUR', 'ADMIN'];
const INFIRMIERS = ['INFIRMIER', 'ADMIN'];

// ─── MÉDECIN ────────────────────────────────────────────────────────────────

// POST /api/prescriptions — médecin crée une prescription (brouillon)
router.post('/', authenticate, authorize(...MEDECINS), async (req, res) => {
  try {
    const { patientId, medicament, dosage, voie, frequence, heurePrise,
            dureeJours, instructions, stockMedicamentId } = req.body;

    const patient = await Patient.findById(patientId);
    if (!patient) return res.status(404).json({ message: 'Patient non trouvé' });

    // Calculer dateFin si durée fournie
    const dateDebut = new Date();
    let dateFin;
    if (dureeJours) {
      dateFin = new Date(dateDebut);
      dateFin.setDate(dateFin.getDate() + Number(dureeJours));
    }

    const prescription = new Prescription({
      patientId,
      patientInfo: {
        nom:       patient.lastName,
        prenom:    patient.firstName,
        patientId: patient.patientId,
        lit:       patient.bedNumber
      },
      medicament, dosage, voie, frequence, heurePrise,
      dateDebut,           // automatique
      dureeJours:   dureeJours ? Number(dureeJours) : undefined,
      dateFin,             // calculée automatiquement
      instructions,
      stockMedicamentId:   stockMedicamentId || undefined,
      prescritPar:   `${req.user.firstName} ${req.user.lastName}`,
      prescritParId: req.user._id,
      datePrescription: dateDebut,  // automatique
      statut: 'BROUILLON'
    });

    await prescription.save();
    res.status(201).json(prescription);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PUT /api/prescriptions/:id/valider — médecin valide la prescription
router.put('/:id/valider', authenticate, authorize(...MEDECINS), async (req, res) => {
  try {
    const p = await Prescription.findById(req.params.id);
    if (!p) return res.status(404).json({ message: 'Prescription non trouvée' });
    if (p.statut === 'ANNULEE') return res.status(400).json({ message: 'Prescription annulée' });

    p.statut     = 'VALIDEE';
    p.valideDate = new Date();
    p.validePar  = `${req.user.firstName} ${req.user.lastName}`;
    await p.save();
    res.json(p);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/prescriptions/:id/annuler — médecin annule
router.put('/:id/annuler', authenticate, authorize(...MEDECINS), async (req, res) => {
  try {
    const p = await Prescription.findByIdAndUpdate(
      req.params.id,
      { statut: 'ANNULEE' },
      { new: true }
    );
    if (!p) return res.status(404).json({ message: 'Prescription non trouvée' });
    res.json(p);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/prescriptions/:id — modifier une prescription (brouillon seulement)
router.put('/:id', authenticate, authorize(...MEDECINS), async (req, res) => {
  try {
    const p = await Prescription.findById(req.params.id);
    if (!p) return res.status(404).json({ message: 'Prescription non trouvée' });
    if (p.statut !== 'BROUILLON') {
      return res.status(400).json({ message: 'Impossible de modifier une prescription déjà validée' });
    }

    const { dureeJours, dateDebut } = req.body;
    let dateFin;
    if (dureeJours && dateDebut) {
      dateFin = new Date(dateDebut);
      dateFin.setDate(dateFin.getDate() + Number(dureeJours));
    }

    Object.assign(p, req.body);
    if (dateFin) p.dateFin = dateFin;
    await p.save();
    res.json(p);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── INFIRMIER ───────────────────────────────────────────────────────────────

// POST /api/prescriptions/:id/administrer — infirmier coche une administration
router.post('/:id/administrer', authenticate, authorize(...INFIRMIERS), async (req, res) => {
  try {
    const { statut, note } = req.body;
    const p = await Prescription.findById(req.params.id);
    if (!p) return res.status(404).json({ message: 'Prescription non trouvée' });
    if (p.statut !== 'VALIDEE') {
      return res.status(400).json({ message: 'Prescription non validée par le médecin' });
    }

    const now = new Date();
    const heure = now.toTimeString().slice(0, 5); // "HH:MM"

    p.administrations.push({
      date:        now,
      heure,
      infirmier:   `${req.user.firstName} ${req.user.lastName}`,
      infirmierId: req.user._id,
      statut:      statut || 'ADMINISTRE',
      note:        note   || undefined
    });

    // Déduire du stock si médicament lié
    if (p.stockMedicamentId && statut !== 'REFUSE') {
      try {
        await Medicament.findByIdAndUpdate(p.stockMedicamentId, {
          $inc: { quantiteStock: -1 },
          $push: {
            mouvements: {
              type: 'SORTIE', quantite: 1,
              raison: `Administré à ${p.patientInfo?.prenom} ${p.patientInfo?.nom}`,
              patientId: p.patientInfo?.patientId,
              effectuePar: `${req.user.firstName} ${req.user.lastName}`,
              date: now
            }
          }
        });
      } catch (_) { /* stock non bloquant */ }
    }

    await p.save();
    res.json(p);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── CONSULTATION ────────────────────────────────────────────────────────────

// GET /api/prescriptions/patient/:patientId — prescriptions d'un patient
router.get('/patient/:patientId', authenticate, async (req, res) => {
  try {
    const { statut } = req.query;
    const filter = { patientId: req.params.patientId };
    if (statut) filter.statut = statut;

    const prescriptions = await Prescription.find(filter).sort({ datePrescription: -1 });
    res.json(prescriptions);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/prescriptions/infirmier/mes-soins — prescriptions validées pour l'infirmier
router.get('/infirmier/mes-soins', authenticate, authorize(...INFIRMIERS), async (req, res) => {
  try {
    const prescriptions = await Prescription.find({ statut: 'VALIDEE' })
      .sort({ datePrescription: -1 });
    res.json(prescriptions);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/prescriptions/rapport/:patientId — rapport médical complet
router.get('/rapport/:patientId', authenticate, async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.patientId)
      .select('firstName lastName patientId bedNumber admissionDate referentDoctor nurseAssigned status');
    if (!patient) return res.status(404).json({ message: 'Patient non trouvé' });

    const prescriptions = await Prescription.find({ patientId: req.params.patientId })
      .sort({ datePrescription: -1 });

    const stats = {
      total:      prescriptions.length,
      validees:   prescriptions.filter(p => p.statut === 'VALIDEE').length,
      brouillons: prescriptions.filter(p => p.statut === 'BROUILLON').length,
      annulees:   prescriptions.filter(p => p.statut === 'ANNULEE').length,
      administrations: prescriptions.reduce((acc, p) => acc + p.administrations.length, 0)
    };

    res.json({
      patient: {
        id:           patient._id,
        patientId:    patient.patientId,
        nom:          patient.lastName,
        prenom:       patient.firstName,
        lit:          patient.bedNumber,
        admissionDate:patient.admissionDate,
        medecin:      patient.referentDoctor,
        infirmier:    patient.nurseAssigned,
        statut:       patient.status
      },
      prescriptions,
      stats,
      genereAt: new Date()
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
