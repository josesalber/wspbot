const { getConnection, sql } = require('./database');
const bcrypt = require('bcryptjs');

class Usuario {
    constructor(data) {
        this.id = data.id;
        this.dni = data.dni;
        this.nombre = data.nombre;
        this.apellido = data.apellido;
        this.password = data.password;
        this.rol = data.rol || 'agente'; // Valores posibles: 'admin', 'agente'
        this.es_activo = data.es_activo !== undefined ? data.es_activo : true;
        this.created_at = data.created_at;
        this.updated_at = data.updated_at;
    }

    // Métodos estáticos para autenticación y búsqueda
    
    // Autenticación LOCAL - usa la base de datos local primero
    static async authenticateLocal(dni, password) {
        try {
            console.log(`🔐 Intentando autenticar localmente: ${dni}`);
            
            // 1. Buscar usuario en base de datos local
            const localUser = await Usuario.findByDni(dni);
            
            if (!localUser) {
                console.log(`❌ Usuario no encontrado en base de datos local: ${dni}`);
                return null;
            }

            // 2. Verificar contraseña
            const isValidPassword = await localUser.verifyPassword(password);
            
            if (!isValidPassword) {
                console.log(`❌ Contraseña incorrecta para usuario: ${dni}`);
                return null;
            }

            console.log(`✅ Usuario autenticado localmente: ${dni}`);
            return localUser;
        } catch (error) {
            console.error('Error en autenticación local:', error);
            throw error;
        }
    }

    // Autenticación CENTRAL - usa la API central primero (para sincronización)
    static async authenticateWithCentral(codigoUsuario, password) {
        try {
            console.log(`🔐 Intentando autenticar usuario: ${codigoUsuario}`);
            
            // Import fetch dinámicamente para Node.js
            const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
            
            // 1. Verificar en API central
            const response = await fetch(`${process.env.CENTRAL_API_URL}/usuarios/${codigoUsuario}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.CENTRAL_API_TOKEN}`
                }
            });

            if (!response.ok) {
                console.log(`❌ Usuario no encontrado en API central: ${codigoUsuario}`);
                return null;
            }

            const centralUser = await response.json();
            
            // 2. Buscar o crear usuario local
            let localUser = await Usuario.findByDni(centralUser.dni);
            
            if (!localUser) {
                console.log(`➕ Creando usuario local para: ${centralUser.dni}`);
                localUser = await Usuario.createFromCentral({
                    ...centralUser,
                    password: password
                });
            } else {
                console.log(`🔄 Actualizando datos de usuario local: ${centralUser.dni}`);
                await localUser.updateFromCentral({
                    ...centralUser,
                    password: password
                });
            }

            console.log(`✅ Usuario autenticado exitosamente: ${codigoUsuario}`);
            return localUser;
        } catch (error) {
            console.error('Error autenticando con API central:', error);
            throw error;
        }
    }

    static async findByDni(dni) {
        try {
            const pool = await getConnection();
            const result = await pool.request()
                .input('dni', sql.NVarChar, dni)
                .query('SELECT * FROM usuarios WHERE dni = @dni AND es_activo = 1');

            return result.recordset.length > 0 ? new Usuario(result.recordset[0]) : null;
        } catch (error) {
            console.error('Error al buscar usuario por DNI:', error);
            throw error;
        }
    }

    static async findById(id) {
        try {
            const pool = await getConnection();
            const result = await pool.request()
                .input('id', sql.Int, id)
                .query('SELECT * FROM usuarios WHERE id = @id AND es_activo = 1');

            return result.recordset.length > 0 ? new Usuario(result.recordset[0]) : null;
        } catch (error) {
            console.error('Error al buscar usuario por ID:', error);
            throw error;
        }
    }

    static async getLimiteDiario(usuarioId) {
        try {
            const pool = await getConnection();
            const today = new Date().toISOString().split('T')[0];
            
            console.log(`🔍 Consultando límite diario para usuario ${usuarioId} en fecha ${today}`);
            
            const result = await pool.request()
                .input('usuario_id', sql.Int, usuarioId)
                .input('fecha', sql.Date, today)
                .query(`
                    SELECT 
                        cantidad_enviada as enviados_hoy,
                        limite_maximo as limite_diario,
                        (limite_maximo - cantidad_enviada) as restantes
                    FROM limite_diario 
                    WHERE usuario_id = @usuario_id AND fecha = @fecha
                `);

            if (result.recordset.length > 0) {
                const limite = result.recordset[0];
                console.log(`📊 Límite encontrado:`, limite);
                return limite;
            } else {
                // Crear registro para hoy
                const limite = parseInt(process.env.DAILY_MESSAGE_LIMIT || '200');
                console.log(`➕ Creando nuevo registro de límite para hoy con límite: ${limite}`);
                await pool.request()
                    .input('usuario_id', sql.Int, usuarioId)
                    .input('fecha', sql.Date, today)
                    .input('limite', sql.Int, limite)
                    .query(`
                        INSERT INTO limite_diario (usuario_id, fecha, cantidad_enviada, limite_maximo)
                        VALUES (@usuario_id, @fecha, 0, @limite)
                    `);
                
                const nuevoLimite = {
                    enviados_hoy: 0,
                    limite_diario: limite,
                    restantes: limite
                };
                console.log(`📊 Nuevo límite creado:`, nuevoLimite);
                return nuevoLimite;
            }
        } catch (error) {
            console.error('Error obteniendo límite diario:', error);
            throw error;
        }
    }

    static async registrarEnvio(usuarioId, numerosDestino, mensaje, exitoso) {
        try {
            const pool = await getConnection();
            
            // Convertir array de números a string si es necesario
            const numerosString = Array.isArray(numerosDestino) ? numerosDestino.join(', ') : numerosDestino;
            const cantidadNumeros = Array.isArray(numerosDestino) ? numerosDestino.length : 1;
            
            // 1. Insertar en historial usando la estructura correcta de la tabla
            await pool.request()
                .input('usuario_id', sql.Int, usuarioId)
                .input('numeros_enviados', sql.Text, numerosString)
                .input('cantidad_numeros', sql.Int, cantidadNumeros)
                .input('mensaje_enviado', sql.Text, mensaje)
                .input('estado', sql.NVarChar, exitoso ? 'enviado' : 'error')
                .query(`
                    INSERT INTO envios_historicos (usuario_id, numeros_enviados, cantidad_numeros, mensaje_enviado, estado)
                    VALUES (@usuario_id, @numeros_enviados, @cantidad_numeros, @mensaje_enviado, @estado)
                `);

            // 2. Actualizar límite diario solo si fue exitoso
            if (exitoso) {
                const today = new Date().toISOString().split('T')[0];
                await pool.request()
                    .input('usuario_id', sql.Int, usuarioId)
                    .input('fecha', sql.Date, today)
                    .query(`
                        UPDATE limite_diario 
                        SET cantidad_enviada = cantidad_enviada + 1
                        WHERE usuario_id = @usuario_id AND fecha = @fecha
                    `);
            }

        } catch (error) {
            console.error('Error registrando envío:', error);
            throw error;
        }
    }

    static async getHistorialEnvios(usuarioId, limit = 50, offset = 0, fecha = null) {
        try {
            const pool = await getConnection();
            
            console.log(`📅 getHistorialEnvios - Parámetros: usuarioId=${usuarioId}, fecha=${fecha}`);
            
            // Construir condición WHERE
            let whereCondition = 'WHERE usuario_id = @usuarioId';
            let countWhereCondition = 'WHERE usuario_id = @usuarioId';
            
            if (fecha) {
                // Usar formato más específico para SQL Server - comparar solo la parte de fecha
                whereCondition += ' AND CONVERT(date, fecha_envio) = CONVERT(date, @fecha)';
                countWhereCondition += ' AND CONVERT(date, fecha_envio) = CONVERT(date, @fecha)';
                console.log(`📅 Filtrando por fecha: ${fecha}`);
            }
            
            // Contar total de registros
            const countRequest = pool.request()
                .input('usuarioId', sql.Int, usuarioId);
            
            if (fecha) {
                countRequest.input('fecha', sql.DateTime, new Date(fecha)); // Usar DateTime y crear Date object
            }
            
            const countQuery = `SELECT COUNT(*) as total FROM envios_historicos ${countWhereCondition}`;
            console.log(`📊 Query count: ${countQuery}`);
            console.log(`📊 Fecha parameter: ${fecha} -> ${new Date(fecha)}`);
            
            const countResult = await countRequest.query(countQuery);
            const total = countResult.recordset[0].total;
            
            console.log(`📊 Total registros encontrados: ${total}`);

            // Obtener registros paginados usando la estructura correcta de la tabla
            const dataRequest = pool.request()
                .input('usuarioId', sql.Int, usuarioId)
                .input('limit', sql.Int, limit)
                .input('offset', sql.Int, offset);
                
            if (fecha) {
                dataRequest.input('fecha', sql.DateTime, new Date(fecha)); // Usar DateTime y crear Date object
            }
            
            const dataQuery = `
                SELECT 
                    numeros_enviados,
                    cantidad_numeros,
                    mensaje_enviado,
                    fecha_envio,
                    estado
                FROM envios_historicos 
                ${whereCondition}
                ORDER BY fecha_envio DESC
                OFFSET @offset ROWS
                FETCH NEXT @limit ROWS ONLY
            `;
            
            console.log(`📊 Query data: ${dataQuery}`);
            
            const result = await dataRequest.query(dataQuery);

            console.log(`📊 Registros obtenidos: ${result.recordset.length}`);
            
            // Log de algunos registros para debugging
            if (result.recordset.length > 0) {
                console.log(`📊 Primer registro fecha_envio: ${result.recordset[0].fecha_envio}`);
                console.log(`📊 Último registro fecha_envio: ${result.recordset[result.recordset.length - 1].fecha_envio}`);
            }

            return {
                records: result.recordset,
                total: total
            };
        } catch (error) {
            console.error('Error al obtener historial de envíos:', error);
            throw error;
        }
    }

    // Crear usuario local desde datos centrales
    static async createFromCentral(centralUser) {
        try {
            const pool = await getConnection();
            const hashedPassword = await bcrypt.hash(centralUser.password, 10);
            
            const result = await pool.request()
                .input('dni', sql.NVarChar, centralUser.dni)
                .input('nombre', sql.NVarChar, centralUser.nombre)
                .input('apellido', sql.NVarChar, centralUser.apellido)
                .input('password', sql.NVarChar, hashedPassword)
                .query(`
                    INSERT INTO usuarios (dni, nombre, apellido, password)
                    OUTPUT INSERTED.*
                    VALUES (@dni, @nombre, @apellido, @password)
                `);

            return new Usuario(result.recordset[0]);
        } catch (error) {
            console.error('Error creando usuario local:', error);
            throw error;
        }
    }

    // Métodos de instancia
    async updateFromCentral(centralUser) {
        try {
            const pool = await getConnection();
            const hashedPassword = await bcrypt.hash(centralUser.password, 10);
            
            await pool.request()
                .input('id', sql.Int, this.id)
                .input('nombre', sql.NVarChar, centralUser.nombre)
                .input('apellido', sql.NVarChar, centralUser.apellido)
                .input('password', sql.NVarChar, hashedPassword)
                .query(`
                    UPDATE usuarios 
                    SET nombre = @nombre, apellido = @apellido, password = @password, updated_at = GETDATE()
                    WHERE id = @id
                `);

            this.nombre = centralUser.nombre;
            this.apellido = centralUser.apellido;
            this.password = hashedPassword;
        } catch (error) {
            console.error('Error actualizando usuario local:', error);
            throw error;
        }
    }

    async verifyPassword(password) {
        return await bcrypt.compare(password, this.password);
    }

    async getLimiteDiario() {
        return await Usuario.getLimiteDiario(this.id);
    }

    async canSendMessages(cantidad) {
        try {
            const limite = await this.getLimiteDiario();
            return (limite.enviados_hoy + cantidad) <= limite.limite_diario;
        } catch (error) {
            console.error('Error verificando límite de mensajes:', error);
            return false;
        }
    }

    async getHistorialEnvios(limit = 10, fecha = null) {
        return await Usuario.getHistorialEnvios(this.id, limit, 0, fecha);
    }

    // Métodos para roles y administración
    isAdmin() {
        return this.rol === 'admin';
    }

    static async countUsers() {
        try {
            const pool = await getConnection();
            const result = await pool.request()
                .query('SELECT COUNT(*) as total FROM usuarios WHERE es_activo = 1');
            return result.recordset[0].total;
        } catch (error) {
            console.error('Error contando usuarios:', error);
            throw error;
        }
    }

    static async createFirstAdmin(userData) {
        try {
            const pool = await getConnection();
            const hashedPassword = await bcrypt.hash(userData.password, 12);
            
            const result = await pool.request()
                .input('dni', sql.NVarChar, userData.dni)
                .input('nombre', sql.NVarChar, userData.nombre)
                .input('apellido', sql.NVarChar, userData.apellido)
                .input('password', sql.NVarChar, hashedPassword)
                .input('rol', sql.NVarChar, 'admin')
                .query(`
                    INSERT INTO usuarios (dni, nombre, apellido, password, rol, es_activo, created_at)
                    OUTPUT INSERTED.*
                    VALUES (@dni, @nombre, @apellido, @password, @rol, 1, GETDATE())
                `);

            return new Usuario(result.recordset[0]);
        } catch (error) {
            console.error('Error creando primer admin:', error);
            throw error;
        }
    }

    static async getAllUsers(page = 0, limit = 10) {
        try {
            const pool = await getConnection();
            const offset = page * limit;
            
            const result = await pool.request()
                .input('offset', sql.Int, offset)
                .input('limit', sql.Int, limit)
                .query(`
                    SELECT 
                        u.*,
                        ISNULL(COUNT(eh.id), 0) as total_mensajes,
                        ISNULL(SUM(CASE WHEN CAST(eh.fecha_envio as DATE) = CAST(GETDATE() as DATE) THEN 1 ELSE 0 END), 0) as mensajes_hoy
                    FROM usuarios u
                    LEFT JOIN envios_historicos eh ON u.id = eh.usuario_id
                    WHERE u.es_activo = 1
                    GROUP BY u.id, u.dni, u.nombre, u.apellido, u.password, u.rol, u.es_activo, u.created_at, u.updated_at
                    ORDER BY u.created_at DESC
                    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
                `);

            return result.recordset.map(row => new Usuario(row));
        } catch (error) {
            console.error('Error obteniendo usuarios:', error);
            throw error;
        }
    }

    static async createUser(userData) {
        try {
            const pool = await getConnection();
            const hashedPassword = await bcrypt.hash(userData.password, 12);
            
            const result = await pool.request()
                .input('dni', sql.NVarChar, userData.dni)
                .input('nombre', sql.NVarChar, userData.nombre)
                .input('apellido', sql.NVarChar, userData.apellido)
                .input('password', sql.NVarChar, hashedPassword)
                .input('rol', sql.NVarChar, userData.rol || 'agente')
                .query(`
                    INSERT INTO usuarios (dni, nombre, apellido, password, rol, es_activo, created_at)
                    OUTPUT INSERTED.*
                    VALUES (@dni, @nombre, @apellido, @password, @rol, 1, GETDATE())
                `);

            return new Usuario(result.recordset[0]);
        } catch (error) {
            console.error('Error creando usuario:', error);
            throw error;
        }
    }

    static async updateUser(id, userData) {
        try {
            const pool = await getConnection();
            let updateQuery = `
                UPDATE usuarios 
                SET nombre = @nombre, apellido = @apellido, rol = @rol, updated_at = GETDATE()
            `;
            
            const request = pool.request()
                .input('id', sql.Int, id)
                .input('nombre', sql.NVarChar, userData.nombre)
                .input('apellido', sql.NVarChar, userData.apellido)
                .input('rol', sql.NVarChar, userData.rol);

            if (userData.password) {
                const hashedPassword = await bcrypt.hash(userData.password, 12);
                updateQuery += `, password = @password`;
                request.input('password', sql.NVarChar, hashedPassword);
            }

            updateQuery += ` WHERE id = @id`;
            
            await request.query(updateQuery);
            return await Usuario.findById(id);
        } catch (error) {
            console.error('Error actualizando usuario:', error);
            throw error;
        }
    }

    static async deleteUser(id) {
        try {
            const pool = await getConnection();
            await pool.request()
                .input('id', sql.Int, id)
                .query('UPDATE usuarios SET es_activo = 0, updated_at = GETDATE() WHERE id = @id');
        } catch (error) {
            console.error('Error eliminando usuario:', error);
            throw error;
        }
    }

    static async getUserStats() {
        try {
            const pool = await getConnection();
            const result = await pool.request()
                .query(`
                    SELECT 
                        u.id,
                        u.nombre,
                        u.apellido,
                        u.rol,
                        COUNT(eh.id) as total_mensajes,
                        SUM(CASE WHEN CAST(eh.fecha_envio as DATE) = CAST(GETDATE() as DATE) THEN 1 ELSE 0 END) as mensajes_hoy,
                        SUM(CASE WHEN eh.fecha_envio >= DATEADD(DAY, -7, GETDATE()) THEN 1 ELSE 0 END) as mensajes_semana,
                        SUM(CASE WHEN eh.fecha_envio >= DATEADD(DAY, -30, GETDATE()) THEN 1 ELSE 0 END) as mensajes_mes
                    FROM usuarios u
                    LEFT JOIN envios_historicos eh ON u.id = eh.usuario_id
                    WHERE u.es_activo = 1
                    GROUP BY u.id, u.nombre, u.apellido, u.rol
                    ORDER BY total_mensajes DESC
                `);

            return result.recordset;
        } catch (error) {
            console.error('Error obteniendo estadísticas de usuarios:', error);
            throw error;
        }
    }
}

module.exports = Usuario;
