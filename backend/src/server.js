const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Debug inicial
console.log('🔍 Cargando configuración...');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('Archivo .env:', path.join(__dirname, '../.env'));

// Importar rutas
const authRoutes = require('./routes/auth');
const whatsappRoutes = require('./routes/whatsapp');
const adminRoutes = require('./routes/admin');

// Importar modelos para inicializar DB
const { createTables } = require('./models/database');

const app = express();
const PORT = process.env.PORT || 3001;

// Configuración dinámica de CORS
const allowedOrigins = [
    process.env.FRONTEND_URL || 'http://172.17.249.85:3000',
    'http://172.17.249.85:3000',
    'http://172.17.249.85:3000',
    'http://127.0.0.1:3000'
];

// Agregar origen adicional si está definido en variables de entorno
if (process.env.ADDITIONAL_ORIGINS) {
    const additionalOrigins = process.env.ADDITIONAL_ORIGINS.split(',');
    allowedOrigins.push(...additionalOrigins);
}

const corsOptions = {
    origin: function (origin, callback) {
        // Permitir requests sin origin (aplicaciones móviles, Postman, etc.)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.log(`⚠️ CORS bloqueado para origen: ${origin}`);
            console.log(`✅ Orígenes permitidos:`, allowedOrigins);
            callback(new Error('No permitido por política CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    optionsSuccessStatus: 200 // Para soportar navegadores legacy
};

// Middleware
app.use(cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging middleware con información de CORS
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    const origin = req.headers.origin || 'No origin';
    console.log(`${timestamp} - ${req.method} ${req.url} | Origin: ${origin}`);
    next();
});

// Rutas de la API
app.use('/api/auth', authRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/admin', adminRoutes);

// Ruta de health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        port: PORT,
        cors: {
            allowedOrigins: allowedOrigins,
            requestOrigin: req.headers.origin || 'No origin'
        }
    });
});

// Endpoint para testing de CORS
app.get('/api/cors-test', (req, res) => {
    res.json({
        message: '🎉 CORS funcionando correctamente!',
        origin: req.headers.origin || 'No origin header',
        userAgent: req.headers['user-agent'] || 'No user agent',
        timestamp: new Date().toISOString(),
        allowedOrigins: allowedOrigins
    });
});

// Servir archivos estáticos del frontend en producción
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, '../../frontend/build')));
    
    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, '../../frontend/build/index.html'));
    });
}

// Middleware de manejo de errores
app.use((err, req, res, next) => {
    console.error('Error:', err.stack);
    res.status(500).json({ 
        error: 'Error interno del servidor',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Middleware para rutas no encontradas
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Ruta no encontrada' });
});

// Inicializar servidor
async function startServer() {
    try {
        console.log('� Iniciando servidor en modo PRODUCCIÓN...');
        console.log('⏭️ Saltando creación de tablas (modo producción)');
        
        const host = process.env.BACKEND_HOST || '172.17.249.85';
        app.listen(PORT, host, () => {
            console.log(`🚀 Servidor ejecutándose en http://${host}:${PORT}`);
            console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
            console.log(`🖥️ Frontend URL: ${process.env.FRONTEND_URL || 'http://172.17.249.85:3000'}`);
            console.log(`🔗 CORS configurado para:`, allowedOrigins);
        });

    } catch (error) {
        console.error('Error al inicializar servidor:', error);
        process.exit(1);
    }
}

// Manejo de cierre graceful
process.on('SIGTERM', () => {
    console.log('Cerrando servidor...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('Cerrando servidor...');
    process.exit(0);
});

// Iniciar servidor
startServer();
