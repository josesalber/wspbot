const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsappController');
const authMiddleware = require('../middleware/auth');

// Todas las rutas requieren autenticación
router.use(authMiddleware);

// Rutas de WhatsApp
router.post('/initialize', whatsappController.initializeBot);
router.get('/status', whatsappController.getStatus);
router.post('/send-bulk', whatsappController.sendBulkMessages);
router.post('/disconnect', whatsappController.disconnect);
router.post('/force-new-session', whatsappController.forceNewSession); // Nueva ruta para limpiar sesión
router.get('/historial', whatsappController.getHistorial);
router.get('/debug', whatsappController.getDebugInfo);
router.get('/sessions', whatsappController.getActiveSessions); // Nueva ruta para ver sesiones

module.exports = router;
