const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/auth');

// Rutas públicas
router.post('/login', authController.login);

// Rutas protegidas
router.get('/verify', authMiddleware, authController.verifyToken);
router.get('/limite-diario', authMiddleware, authController.getLimiteDiario);

module.exports = router;
