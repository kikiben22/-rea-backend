const cron    = require('node-cron');
const Patient = require('../models/Patient');

async function renouvellerTests() {
  try {
    const now   = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // minuit local

    // Trouver tous les patients actifs ayant des examens à renouveler
    const patients = await Patient.find({
      isActive: true,
      'examens.prochainTest': { $lte: now },
      'examens.renouvele': { $ne: true },
    });

    let count = 0;
    for (const patient of patients) {
      let modified = false;
      const nouveaux = [];

      for (const ex of patient.examens) {
        if (
          ex.prochainTest &&
          new Date(ex.prochainTest) <= now &&
          !ex.renouvele
        ) {
          // Marquer l'ancien examen comme renouvelé
          ex.renouvele = true;

          // Calculer la prochaine date si répétition en cours
          let nouvelleDate = null;
          if (ex.repetitionJours && ex.repetitionJours > 0) {
            nouvelleDate = new Date(ex.prochainTest);
            nouvelleDate.setDate(nouvelleDate.getDate() + ex.repetitionJours);
          }

          // Créer le nouvel examen DEMANDE
          nouveaux.push({
            nom:             ex.nom,
            type:            ex.type,
            priorite:        ex.priorite || 'NORMAL',
            statut:          'DEMANDE',
            note:            ex.note,
            labTestId:       ex.labTestId,
            refMin:          ex.refMin,
            refMax:          ex.refMax,
            unite:           ex.unite,
            repetitionJours: ex.repetitionJours,
            prochainTest:    nouvelleDate,
            renouvele:       false,
            prescritPar:     ex.prescritPar || 'Auto-renouvellement',
            date:            new Date(),
          });

          modified = true;
          count++;
        }
      }

      if (modified) {
        patient.examens.push(...nouveaux);
        await patient.save();
      }
    }

    if (count > 0) {
      console.log(`[CRON] ${count} examen(s) renouvelé(s) automatiquement`);
    }
  } catch (err) {
    console.error('[CRON] Erreur auto-renouvellement examens:', err.message);
  }
}

// Lancer tous les jours à 00:05
function startAutoRenewCron() {
  cron.schedule('5 0 * * *', renouvellerTests, { timezone: 'Africa/Algiers' });
  console.log('[CRON] Auto-renouvellement examens actif (00:05 chaque jour)');
  // Vérifier aussi au démarrage du serveur
  renouvellerTests();
}

module.exports = { startAutoRenewCron, renouvellerTests };
