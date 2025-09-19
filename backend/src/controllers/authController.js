const Usuario = require('../models/Usuario');
const jwt = require('jsonwebtoken');

const authController = {
    // Login de usuario
    login: async (req, res) => {
        try {
            const { codigoUsuario, password } = req.body;

            if (!codigoUsuario || !password) {
                return res.status(400).json({ error: 'Código de usuario y contraseña son requeridos' });
            }

            // Autenticar con base de datos local primero
            const usuario = await Usuario.authenticateLocal(codigoUsuario, password);
            
            if (!usuario) {
                return res.status(401).json({ error: 'Credenciales inválidas' });
            }

            // Generar JWT
            const token = jwt.sign(
                { userId: usuario.id, codigoUsuario: usuario.dni },
                process.env.JWT_SECRET,
                { expiresIn: '24h' }
            );

            res.json({
                success: true,
                token,
                usuario: {
                    id: usuario.id,
                    dni: usuario.dni,
                    nombre: usuario.nombre,
                    apellido: usuario.apellido,
                    rol: usuario.rol,
                    es_activo: usuario.es_activo
                }
            });

        } catch (error) {
            console.error('Error en login:', error);
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    },

    // Verificar token
    verifyToken: async (req, res) => {
        try {
            res.json({
                success: true,
                usuario: {
                    id: req.usuario.id,
                    dni: req.usuario.dni,
                    nombre: req.usuario.nombre,
                    apellido: req.usuario.apellido,
                    rol: req.usuario.rol,
                    es_activo: req.usuario.es_activo
                }
            });
        } catch (error) {
            console.error('Error al verificar token:', error);
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    },

    // Obtener límite diario del usuario
    getLimiteDiario: async (req, res) => {
        try {
            const limite = await Usuario.getLimiteDiario(req.usuario.id);
            res.json({
                success: true,
                limite
            });
        } catch (error) {
            console.error('Error al obtener límite diario:', error);
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    }
};

module.exports = authController;
