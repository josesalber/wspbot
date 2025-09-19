const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');

const authMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.header('Authorization');
        
        if (!authHeader) {
            console.log('❌ No se proporcionó header de Authorization');
            return res.status(401).json({ error: 'Token de acceso requerido' });
        }

        if (!authHeader.startsWith('Bearer ')) {
            console.log('❌ Header de Authorization no tiene formato Bearer');
            return res.status(401).json({ error: 'Formato de token inválido' });
        }

        const token = authHeader.replace('Bearer ', '');
        
        if (!token || token.trim() === '') {
            console.log('❌ Token vacío después de extraer Bearer');
            return res.status(401).json({ error: 'Token de acceso requerido' });
        }

        // Verificar que el token tenga el formato básico de JWT (3 partes separadas por puntos)
        const tokenParts = token.split('.');
        if (tokenParts.length !== 3) {
            console.log('❌ Token JWT mal formado - no tiene 3 partes:', tokenParts.length);
            return res.status(401).json({ error: 'Token mal formado' });
        }

        console.log(`🔐 Verificando token para ruta: ${req.method} ${req.path}`);
        
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log(`✅ Token decodificado para usuario ID: ${decoded.userId}`);
        
        const usuario = await Usuario.findById(decoded.userId);
        
        if (!usuario) {
            console.log(`❌ Usuario no encontrado con ID: ${decoded.userId}`);
            return res.status(401).json({ error: 'Usuario no encontrado' });
        }

        console.log(`✅ Usuario autenticado: ${usuario.nombre} ${usuario.apellido} (ID: ${usuario.id})`);
        req.usuario = usuario;
        req.user = usuario; // Para compatibilidad con adminController
        next();
    } catch (error) {
        console.error('❌ Error en middleware de auth:', error.name, '-', error.message);
        
        // Manejo específico de errores JWT
        if (error.name === 'JsonWebTokenError') {
            if (error.message === 'jwt malformed') {
                return res.status(401).json({ error: 'Token mal formado. Por favor, inicia sesión nuevamente.' });
            } else if (error.message === 'invalid signature') {
                return res.status(401).json({ error: 'Firma de token inválida. Por favor, inicia sesión nuevamente.' });
            } else {
                return res.status(401).json({ error: 'Token inválido. Por favor, inicia sesión nuevamente.' });
            }
        } else if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expirado. Por favor, inicia sesión nuevamente.' });
        } else if (error.name === 'NotBeforeError') {
            return res.status(401).json({ error: 'Token no válido aún.' });
        } else {
            return res.status(401).json({ error: 'Error de autenticación. Por favor, inicia sesión nuevamente.' });
        }
    }
};

module.exports = authMiddleware;
