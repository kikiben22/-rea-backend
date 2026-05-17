const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: 'Email et mot de passe requis' });

    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({ message: 'Identifiants incorrects' });

    if (!user.isActive)
      return res.status(403).json({ message: 'Compte désactivé' });

    user.lastLogin = new Date();
    await user.save();

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.json({
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        unit: user.unit,
        avatar: user.avatar,
        preferences: user.preferences
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

// GET /api/auth/users-by-role?role=INFIRMIER — liste publique pour le login
router.get('/users-by-role', async (req, res) => {
  try {
    const { role } = req.query;
    const filter = role ? { role, isActive: true } : { isActive: true };
    const users = await User.find(filter, 'firstName lastName email role').sort('lastName');
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  res.json(req.user);
});

// POST /api/auth/logout
router.post('/logout', authenticate, (req, res) => {
  res.json({ message: 'Déconnexion réussie' });
});

// POST /api/auth/register (admin only in production)
router.post('/register', async (req, res) => {
  try {
    const { firstName, lastName, email, password, role, unit, speciality, phone } = req.body;
    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ message: 'Email déjà utilisé' });

    const user = new User({ firstName, lastName, email, password, role, unit, speciality, phone });
    await user.save();
    res.status(201).json({ message: 'Utilisateur créé', user });
  } catch (err) {
    res.status(500).json({ message: 'Erreur', error: err.message });
  }
});

module.exports = router;
