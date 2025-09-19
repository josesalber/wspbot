const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const adminController = require('../controllers/adminController');

// Ruta pública para verificar si necesita setup inicial
router.get('/setup/check', adminController.checkFirstSetup);

// Ruta pública para crear primer administrador
router.post('/setup/first-admin', adminController.createFirstAdmin);

// Ruta pública para verificar DNI en API central
router.get('/verify-dni/:dni', adminController.verifyDNI);

// Todas las rutas siguientes requieren autenticación
router.use(authMiddleware);

// Estadísticas de usuarios (solo admin)
router.get('/stats', adminController.getUserStats);

// CRUD de usuarios (solo admin)
router.get('/users', adminController.getAllUsers);
router.post('/users', adminController.createUser);
router.put('/users/:id', adminController.updateUser);
router.delete('/users/:id', adminController.deleteUser);

module.exports = router;
