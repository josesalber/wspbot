const Usuario = require('../models/Usuario');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// URL de la API central
const CENTRAL_API_URL = process.env.CENTRAL_API_URL || 'http://172.17.249.98:9095/api';

// Función para verificar DNI en API central
// Estrategia: Primero intentar obtener lista completa, si falla buscar por IDs
const verifyDNIInCentral = async (dni) => {
    try {
        console.log('🔍 Iniciando verifyDNIInCentral para DNI:', dni);
        
        // Estrategia 1: Intentar obtener lista completa de usuarios
        try {
            console.log('📋 Intentando obtener lista completa de usuarios...');
            const listResponse = await fetch(`${CENTRAL_API_URL}/usuarios`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.CENTRAL_API_TOKEN || ''}`
                }
            });

            if (listResponse.ok) {
                const usuarios = await listResponse.json();
                console.log('📋 Lista de usuarios obtenida de API central');
                
                // Si es un array, buscar por DNI
                if (Array.isArray(usuarios)) {
                    const usuario = usuarios.find(u => u.dni === dni);
                    if (usuario) {
                        return {
                            found: true,
                            data: {
                                id: usuario.id,
                                dni: usuario.dni,
                                nombre: usuario.nombre,
                                apellido: usuario.apellido
                            }
                        };
                    }
                }
            }
        } catch (listError) {
            console.log('⚠️ No se pudo obtener lista completa, intentando búsqueda por ID');
        }

        // Estrategia 2: Buscar por IDs individuales (limitado a 50 para eficiencia)
        console.log(`🔍 Buscando DNI ${dni} por IDs individuales...`);
        for (let id = 1; id <= 50; id++) {
            try {
                const response = await fetch(`${CENTRAL_API_URL}/usuarios/${id}`, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${process.env.CENTRAL_API_TOKEN || ''}`
                    }
                });

                if (response.ok) {
                    const usuario = await response.json();
                    
                    // Si encontramos el DNI que buscamos
                    if (usuario.dni === dni) {
                        console.log(`✅ DNI ${dni} encontrado en ID ${id}`);
                        return {
                            found: true,
                            data: {
                                id: usuario.id,
                                dni: usuario.dni,
                                nombre: usuario.nombre,
                                apellido: usuario.apellido
                            }
                        };
                    }
                }
            } catch (error) {
                // Continuar con el siguiente ID si hay error
                continue;
            }
        }
        
        console.log(`❌ DNI ${dni} no encontrado en API central`);
        return {
            found: false,
            data: null
        };
    } catch (error) {
        console.error('Error verificando DNI en API central:', error);
        throw error;
    }
};

// Verificar DNI en API central (endpoint público)
const verifyDNI = async (req, res) => {
    try {
        console.log('📞 verifyDNI endpoint called');
        const { dni } = req.params;
        console.log('📞 DNI received:', dni);

        if (!dni) {
            console.log('❌ DNI not provided');
            return res.status(400).json({ message: 'DNI es requerido' });
        }

        console.log('🔍 Calling verifyDNIInCentral...');
        const result = await verifyDNIInCentral(dni);
        console.log('✅ verifyDNIInCentral result:', result);
        
        res.json(result);
    } catch (error) {
        console.error('❌ Error en verifyDNI endpoint:', error);
        res.status(500).json({ 
            found: false,
            message: 'Error verificando DNI en API central',
            error: error.message
        });
    }
};

// Función para sincronizar usuario con API central
const syncWithCentralAPI = async (userData, method = 'POST', userId = null) => {
    try {
        const url = method === 'PUT' && userId 
            ? `${CENTRAL_API_URL}/usuarios/${userId}`
            : `${CENTRAL_API_URL}/usuarios`;
            
        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.CENTRAL_API_TOKEN || ''}`
            },
            body: JSON.stringify({
                dni: userData.dni,
                nombre: userData.nombre,
                apellido: userData.apellido,
                password: userData.password // Se envía la contraseña sin encriptar a la API central
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Error sincronizando con API central:', errorText);
            throw new Error(`Error ${response.status}: ${errorText}`);
        }

        const result = await response.json();
        console.log('✅ Usuario sincronizado con API central:', result);
        return result;
    } catch (error) {
        console.error('❌ Error sincronizando con API central:', error);
        throw error;
    }
};

// Obtener estadísticas de usuarios (solo admin)
const getUserStats = async (req, res) => {
    try {
        if (!req.user.isAdmin()) {
            return res.status(403).json({ message: 'Acceso denegado. Solo administradores.' });
        }

        const stats = await Usuario.getUserStats();
        res.json(stats);
    } catch (error) {
        console.error('Error obteniendo estadísticas:', error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// Obtener todos los usuarios (solo admin)
const getAllUsers = async (req, res) => {
    try {
        if (!req.user.isAdmin()) {
            return res.status(403).json({ message: 'Acceso denegado. Solo administradores.' });
        }

        const page = parseInt(req.query.page) || 0;
        const limit = parseInt(req.query.limit) || 10;

        const users = await Usuario.getAllUsers(page, limit);
        const total = await Usuario.countUsers();

        res.json({
            users,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Error obteniendo usuarios:', error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// Crear nuevo usuario (solo admin)
const createUser = async (req, res) => {
    try {
        if (!req.user.isAdmin()) {
            return res.status(403).json({ message: 'Acceso denegado. Solo administradores.' });
        }

        const { dni, nombre, apellido, password, rol } = req.body;

        if (!dni || !nombre || !apellido || !password) {
            return res.status(400).json({ message: 'Todos los campos son requeridos' });
        }

        // Verificar que no exista otro usuario con el mismo DNI localmente
        const existingUser = await Usuario.findByDni(dni);
        if (existingUser) {
            return res.status(400).json({ message: 'Ya existe un usuario con ese DNI' });
        }

        // 1. Verificar si el DNI existe en API central y sincronizar
        try {
            const dniVerification = await verifyDNIInCentral(dni);
            
            if (dniVerification.found) {
                // DNI existe en API central, hacer PUT para actualizar
                console.log(`🔄 DNI ${dni} existe en API central, actualizando con PUT...`);
                await syncWithCentralAPI({
                    dni,
                    nombre,
                    apellido,
                    password
                }, 'PUT', dniVerification.data.id);
            } else {
                // DNI no existe en API central, hacer POST para crear
                console.log(`➕ DNI ${dni} no existe en API central, creando con POST...`);
                await syncWithCentralAPI({
                    dni,
                    nombre,
                    apellido,
                    password
                }, 'POST');
            }
        } catch (centralError) {
            return res.status(400).json({ 
                message: 'Error sincronizando con API central: ' + centralError.message 
            });
        }

        // 2. Crear usuario local después de sincronizar exitosamente
        const newUser = await Usuario.createUser({
            dni,
            nombre,
            apellido,
            password,
            rol: rol || 'agente'
        });

        res.status(201).json({
            message: 'Usuario creado y sincronizado exitosamente',
            user: {
                id: newUser.id,
                dni: newUser.dni,
                nombre: newUser.nombre,
                apellido: newUser.apellido,
                rol: newUser.rol
            }
        });
    } catch (error) {
        console.error('Error creando usuario:', error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// Actualizar usuario (solo admin)
const updateUser = async (req, res) => {
    try {
        if (!req.user.isAdmin()) {
            return res.status(403).json({ message: 'Acceso denegado. Solo administradores.' });
        }

        const { id } = req.params;
        const { nombre, apellido, password, rol } = req.body;

        // Obtener usuario actual para sincronización
        const currentUser = await Usuario.findById(parseInt(id));
        if (!currentUser) {
            return res.status(404).json({ message: 'Usuario no encontrado' });
        }

        const updateData = { nombre, apellido, rol };
        let syncData = {
            dni: currentUser.dni,
            nombre,
            apellido
        };

        // Si se proporciona nueva contraseña, incluirla
        if (password) {
            updateData.password = password;
            syncData.password = password;
        }

        // 1. Sincronizar con API central primero (solo si hay cambios en datos básicos)
        if (nombre !== currentUser.nombre || apellido !== currentUser.apellido || password) {
            try {
                await syncWithCentralAPI(syncData, 'PUT', currentUser.dni);
            } catch (centralError) {
                return res.status(400).json({ 
                    message: 'Error sincronizando con API central: ' + centralError.message 
                });
            }
        }

        // 2. Actualizar usuario local después de sincronizar exitosamente
        const updatedUser = await Usuario.updateUser(parseInt(id), updateData);
        
        if (!updatedUser) {
            return res.status(404).json({ message: 'Usuario no encontrado' });
        }

        res.json({
            message: 'Usuario actualizado y sincronizado exitosamente',
            user: {
                id: updatedUser.id,
                dni: updatedUser.dni,
                nombre: updatedUser.nombre,
                apellido: updatedUser.apellido,
                rol: updatedUser.rol
            }
        });
    } catch (error) {
        console.error('Error actualizando usuario:', error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// Eliminar usuario (solo admin)
const deleteUser = async (req, res) => {
    try {
        if (!req.user.isAdmin()) {
            return res.status(403).json({ message: 'Acceso denegado. Solo administradores.' });
        }

        const { id } = req.params;

        // No permitir que un admin se elimine a sí mismo
        if (parseInt(id) === req.user.id) {
            return res.status(400).json({ message: 'No puedes eliminar tu propia cuenta' });
        }

        await Usuario.deleteUser(parseInt(id));
        res.json({ message: 'Usuario eliminado exitosamente' });
    } catch (error) {
        console.error('Error eliminando usuario:', error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// Verificar si existen usuarios en el sistema
const checkFirstSetup = async (req, res) => {
    try {
        const userCount = await Usuario.countUsers();
        res.json({ 
            needsFirstSetup: userCount === 0,
            userCount 
        });
    } catch (error) {
        console.error('Error verificando setup inicial:', error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// Crear primer usuario administrador
const createFirstAdmin = async (req, res) => {
    try {
        const userCount = await Usuario.countUsers();
        
        if (userCount > 0) {
            return res.status(400).json({ 
                message: 'Ya existen usuarios en el sistema' 
            });
        }

        const { dni, nombre, apellido, password } = req.body;

        if (!dni || !nombre || !apellido || !password) {
            return res.status(400).json({ 
                message: 'Todos los campos son requeridos' 
            });
        }

        // 1. Verificar si el DNI existe en API central y sincronizar
        try {
            const dniVerification = await verifyDNIInCentral(dni);
            
            if (dniVerification.found) {
                // DNI existe en API central, hacer PUT para actualizar
                console.log(`🔄 DNI ${dni} existe en API central, actualizando con PUT...`);
                await syncWithCentralAPI({
                    dni,
                    nombre,
                    apellido,
                    password
                }, 'PUT', dniVerification.data.id);
            } else {
                // DNI no existe en API central, hacer POST para crear
                console.log(`➕ DNI ${dni} no existe en API central, creando con POST...`);
                await syncWithCentralAPI({
                    dni,
                    nombre,
                    apellido,
                    password
                }, 'POST');
            }
        } catch (centralError) {
            // Para el primer admin, si falla la API central, continuamos con creación local
            console.warn('⚠️ No se pudo sincronizar primer admin con API central:', centralError.message);
        }

        // 2. Crear primer admin local
        const firstAdmin = await Usuario.createFirstAdmin({
            dni,
            nombre,
            apellido,
            password
        });

        res.status(201).json({
            message: 'Primer administrador creado exitosamente',
            user: {
                id: firstAdmin.id,
                dni: firstAdmin.dni,
                nombre: firstAdmin.nombre,
                apellido: firstAdmin.apellido,
                rol: firstAdmin.rol
            }
        });
    } catch (error) {
        console.error('Error creando primer admin:', error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

module.exports = {
    getUserStats,
    getAllUsers,
    createUser,
    updateUser,
    deleteUser,
    checkFirstSetup,
    createFirstAdmin,
    verifyDNI
};
