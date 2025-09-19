const sql = require('mssql');
require('dotenv').config();

// Debug de variables de entorno
console.log('🔍 Variables de entorno cargadas:');
console.log('DB_SERVER:', process.env.DB_SERVER);
console.log('DB_NAME:', process.env.DB_NAME);
console.log('DB_USER:', process.env.DB_USER);
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('SKIP_TABLE_CREATION:', process.env.SKIP_TABLE_CREATION);

const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true'
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

// Validar configuración antes de conectar
if (!config.server || !config.database || !config.user) {
    console.error('❌ Configuración de base de datos incompleta:');
    console.error('- server:', config.server);
    console.error('- database:', config.database);
    console.error('- user:', config.user);
    throw new Error('Configuración de base de datos incompleta');
}

let pool = null;

const getConnection = async () => {
    try {
        if (!pool) {
            pool = await sql.connect(config);
            console.log('✅ Conectado a SQL Server');
        }
        return pool;
    } catch (error) {
        console.error('❌ Error conectando a SQL Server:', error);
        throw error;
    }
};

const closeConnection = async () => {
    try {
        if (pool) {
            await pool.close();
            pool = null;
            console.log('✅ Conexión SQL Server cerrada');
        }
    } catch (error) {
        console.error('❌ Error cerrando conexión SQL Server:', error);
    }
};

// Crear tablas si no existen
const createTables = async () => {
    try {
        const pool = await getConnection();

        // Tabla usuarios locales
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='usuarios' AND xtype='U')
            CREATE TABLE usuarios (
                id INT IDENTITY(1,1) PRIMARY KEY,
                dni NVARCHAR(20) UNIQUE NOT NULL,
                nombre NVARCHAR(100) NOT NULL,
                apellido NVARCHAR(100) NOT NULL,
                password NVARCHAR(255) NOT NULL,
                rol NVARCHAR(20) DEFAULT 'agente' NOT NULL,
                es_activo BIT DEFAULT 1 NOT NULL,
                created_at DATETIME DEFAULT GETDATE(),
                updated_at DATETIME DEFAULT GETDATE()
            )
        `);

        // Agregar columnas si no existen (para tablas existentes)
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'rol')
            ALTER TABLE usuarios ADD rol NVARCHAR(20) DEFAULT 'agente' NOT NULL
        `);

        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'es_activo')
            ALTER TABLE usuarios ADD es_activo BIT DEFAULT 1 NOT NULL
        `);

        // Actualizar usuarios existentes que no tengan rol
        await pool.request().query(`
            UPDATE usuarios SET rol = 'agente' WHERE rol IS NULL OR rol = ''
        `);

        // Actualizar usuarios existentes que no tengan es_activo
        await pool.request().query(`
            UPDATE usuarios SET es_activo = 1 WHERE es_activo IS NULL
        `);

        // Tabla para historial de envíos
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='envios_historicos' AND xtype='U')
            CREATE TABLE envios_historicos (
                id INT IDENTITY(1,1) PRIMARY KEY,
                usuario_id INT NOT NULL,
                numeros_enviados TEXT NOT NULL,
                cantidad_numeros INT NOT NULL,
                mensaje_enviado TEXT NOT NULL,
                fecha_envio DATETIME DEFAULT GETDATE(),
                estado NVARCHAR(50) DEFAULT 'enviado',
                FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
            )
        `);

        // Tabla para control diario de envíos
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='limite_diario' AND xtype='U')
            CREATE TABLE limite_diario (
                id INT IDENTITY(1,1) PRIMARY KEY,
                usuario_id INT NOT NULL,
                fecha DATE NOT NULL,
                cantidad_enviada INT DEFAULT 0,
                limite_maximo INT DEFAULT 200,
                UNIQUE(usuario_id, fecha),
                FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
            )
        `);

        console.log('✅ Tablas creadas/verificadas correctamente');
    } catch (error) {
        console.error('❌ Error creando tablas:', error);
    }
};

module.exports = {
    sql,
    getConnection,
    closeConnection,
    createTables
};
