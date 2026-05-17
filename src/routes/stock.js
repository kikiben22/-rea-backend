const express = require('express');
const Medicament = require('../models/Medicament');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

// GET /api/stock — liste tous les médicaments
router.get('/', authenticate, async (req, res) => {
  try {
    const { categorie, search, alerte } = req.query;
    const filter = { isActive: true };
    if (categorie) filter.categorie = categorie;
    if (search) filter.nom = { $regex: search, $options: 'i' };
    if (alerte === 'true') {
      filter.$expr = { $lte: ['$quantiteStock', '$seuilAlerte'] };
    }

    const meds = await Medicament.find(filter)
      .select('-mouvements')
      .sort({ nom: 1 });

    const total = await Medicament.countDocuments({ isActive: true });
    const enAlerte = await Medicament.countDocuments({
      isActive: true,
      $expr: { $lte: ['$quantiteStock', '$seuilAlerte'] }
    });
    const enRupture = await Medicament.countDocuments({ isActive: true, quantiteStock: 0 });

    res.json({ medicaments: meds, total, enAlerte, enRupture });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/stock/:id — détail + historique mouvements
router.get('/:id', authenticate, async (req, res) => {
  try {
    const med = await Medicament.findById(req.params.id);
    if (!med) return res.status(404).json({ message: 'Médicament non trouvé' });
    res.json(med);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/stock — créer un médicament
router.post('/', authenticate, async (req, res) => {
  try {
    const med = new Medicament(req.body);
    // Si une quantité initiale est fournie, enregistrer comme mouvement d'entrée
    if (req.body.quantiteStock > 0) {
      med.mouvements.push({
        type: 'ENTREE',
        quantite: req.body.quantiteStock,
        raison: 'Stock initial',
        effectuePar: req.user?.fullName || 'Système'
      });
    }
    await med.save();
    res.status(201).json(med);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PUT /api/stock/:id — modifier infos médicament (pas le stock)
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { quantiteStock, mouvements, ...data } = req.body; // ignorer modif directe du stock
    const med = await Medicament.findByIdAndUpdate(req.params.id, data, { new: true });
    if (!med) return res.status(404).json({ message: 'Médicament non trouvé' });
    res.json(med);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/stock/:id — désactiver (soft delete)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await Medicament.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ message: 'Médicament supprimé du stock' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/stock/:id/mouvement — entrée ou sortie de stock
router.post('/:id/mouvement', authenticate, async (req, res) => {
  try {
    const { type, quantite, raison, patientId } = req.body;
    if (!['ENTREE', 'SORTIE'].includes(type)) {
      return res.status(400).json({ message: 'Type doit être ENTREE ou SORTIE' });
    }
    if (!quantite || quantite <= 0) {
      return res.status(400).json({ message: 'Quantité invalide' });
    }

    const med = await Medicament.findById(req.params.id);
    if (!med) return res.status(404).json({ message: 'Médicament non trouvé' });

    if (type === 'SORTIE' && med.quantiteStock < quantite) {
      return res.status(400).json({ message: `Stock insuffisant (disponible: ${med.quantiteStock})` });
    }

    med.quantiteStock += type === 'ENTREE' ? quantite : -quantite;
    med.mouvements.push({
      type,
      quantite,
      raison: raison || (type === 'ENTREE' ? 'Réapprovisionnement' : 'Consommation'),
      patientId: patientId || undefined,
      effectuePar: req.user?.fullName || 'Inconnu'
    });

    await med.save();
    res.json({ message: `${type} enregistrée`, medicament: med });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/stock/:id/historique — historique des mouvements
router.get('/:id/historique', authenticate, async (req, res) => {
  try {
    const med = await Medicament.findById(req.params.id).select('nom mouvements');
    if (!med) return res.status(404).json({ message: 'Médicament non trouvé' });
    const historique = med.mouvements.sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json({ nom: med.nom, historique });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
