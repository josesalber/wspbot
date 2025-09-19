const { 
    default: makeWASocket, 
    DisconnectReason, 
    useMultiFileAuthState,
    fetchLatestBaileysVersion 
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');

class WhatsAppServiceBaileys extends EventEmitter {
    constructor(userId = null) {
        super();
        this.sock = null;
        this.isReady = false;
        this.userId = userId;
        this.qrCode = null;
        this.isInitializing = false; // Prevenir múltiples inicializaciones
        this.isSending = false; // Para deshabilitar reconexiones durante envío
        this.authState = null;
        this.saveCreds = null;
    }

    async initialize(forceNew = false) {
        try {
            // Prevenir múltiples inicializaciones simultáneas
            if (this.isInitializing) {
                console.log(`⚠️ Ya hay una inicialización en progreso para usuario ${this.userId}`);
                return;
            }
            
            this.isInitializing = true;
            
            // Si ya hay un socket activo y no forzamos nueva sesión, no hacer nada
            if (this.sock && !forceNew) {
                console.log(`ℹ️ Cliente ya conectado para usuario ${this.userId}`);
                this.isInitializing = false;
                return;
            }

            // Cerrar socket existente si existe
            if (this.sock) {
                try {
                    await this.sock.logout();
                } catch (error) {
                    console.log(`⚠️ Error al cerrar socket anterior: ${error.message}`);
                }
                this.sock = null;
            }
            
            const cleanUserId = this.userId ? String(this.userId).replace(/[^a-zA-Z0-9_-]/g, '') : 'default';
            console.log(`🚀 Inicializando Baileys para usuario ${this.userId} (ID: ${cleanUserId})`);
            
            // Configurar sesión independiente por usuario
            const sessionPath = this.userId ? 
                path.join(__dirname, '../..', 'baileys_sessions', `session_${cleanUserId}`) :
                path.join(__dirname, '../..', 'baileys_sessions', 'default');

            // Si forceNew es true, eliminar sesión existente para forzar QR
            if (forceNew && fs.existsSync(sessionPath)) {
                console.log(`🔄 Forzando nueva sesión - eliminando credenciales existentes...`);
                fs.rmSync(sessionPath, { recursive: true, force: true });
            }

            // Crear directorio si no existe
            if (!fs.existsSync(sessionPath)) {
                fs.mkdirSync(sessionPath, { recursive: true });
            }

            // Configurar autenticación multi-archivo
            const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
            this.authState = state;
            this.saveCreds = saveCreds;

            // Obtener la última versión de Baileys
            const { version, isLatest } = await fetchLatestBaileysVersion();
            console.log(`📱 Usando versión de WhatsApp: ${version.join('.')}, es la última: ${isLatest}`);

            // Crear logger compatible con Baileys
            const logger = {
                level: 'warn',
                child: (bindings) => logger,
                trace: () => {},
                debug: () => {},
                info: () => {},
                warn: console.warn,
                error: console.error,
                fatal: console.error
            };

            // Crear socket de conexión con configuración optimizada para conexiones lentas
            this.sock = makeWASocket({
                version,
                auth: this.authState,
                printQRInTerminal: false,
                defaultQueryTimeoutMs: 60000, // Aumentado para conexiones lentas
                keepAliveIntervalMs: 30000,   // Más tolerante
                logger: logger,
                browser: ['Bot WhatsApp', 'Desktop', '1.0.0'],
                retryRequestDelayMs: 250,     // Delay entre reintentos
                maxMsgRetryCount: 5,          // Más reintentos para mensajes
                // Configuración adicional para estabilidad
                emitOwnEvents: true,
                markOnlineOnConnect: false,   // No marcar online automáticamente 
                syncFullHistory: false,       // No sincronizar historial completo
                generateHighQualityLinkPreview: false,
                shouldSyncHistoryMessage: () => false, // No sincronizar historial
                shouldIgnoreJid: () => false,
                fireInitQueries: true,       // Inicializar queries inmediatamente
                getMessage: async (key) => {
                    return { conversation: 'Message not found' };
                }
            });

            // Event listeners
            this.sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;
                
                console.log(`🔄 Connection update para usuario ${this.userId}: connection=${connection}, qr=${!!qr}`);
                
                if (qr) {
                    console.log(`📱 QR Code generado para usuario ${this.userId || 'default'}`);
                    this.qrCode = qr;
                    this.emit('qr', qr);
                }
                
                // 🔍 Detectar cuando el QR se escanea (qr desaparece pero connection no es 'open' aún)
                if (!qr && this.qrCode && connection !== 'open' && connection !== 'close') {
                    console.log(`🔄 QR escaneado para usuario ${this.userId} - procesando conexión...`);
                    this.qrCode = null;
                    this.emit('qr_scanned');
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    console.log(`❌ Conexión cerrada para usuario ${this.userId || 'default'}`);
                    console.log(`   Código: ${statusCode}, Razón: ${lastDisconnect?.error?.message}`);
                    
                    this.isReady = false;
                    this.emit('disconnected', lastDisconnect?.error?.message || 'Conexión cerrada');
                    
                    // Para código 401 (no autorizado), solo limpiar credenciales SIN reiniciar automáticamente
                    if (statusCode === 401 || statusCode === DisconnectReason.badSession) {
                        console.log(`🔄 Código 401 detectado - limpiando credenciales...`);
                        setTimeout(async () => {
                            try {
                                // Eliminar credenciales solamente
                                const cleanUserId = this.userId ? String(this.userId).replace(/[^a-zA-Z0-9_-]/g, '') : 'default';
                                const sessionPath = this.userId ? 
                                    path.join(__dirname, '../..', 'baileys_sessions', `session_${cleanUserId}`) :
                                    path.join(__dirname, '../..', 'baileys_sessions', 'default');
                                
                                if (fs.existsSync(sessionPath)) {
                                    fs.rmSync(sessionPath, { recursive: true, force: true });
                                    console.log(`🗑️ Credenciales eliminadas - usuario debe reconectar manualmente`);
                                }
                                
                                // NO reinicializar automáticamente, dejar que el usuario presione "Conectar"
                                
                            } catch (error) {
                                console.log(`❌ Error limpiando credenciales: ${error.message}`);
                            }
                        }, 1000);
                    }
                    // Para otros errores, NO hacer reintentos automáticos que interfieren con la conexión
                    else if (statusCode === DisconnectReason.loggedOut) {
                        console.log(`🚪 Usuario cerró sesión manualmente - no reintentando`);
                    } else if (statusCode === DisconnectReason.restartRequired) {
                        console.log(`🔄 WhatsApp requiere reinicio - usuario debe reconectar manualmente`);
                    } else if (this.isSending) {
                        console.log(`⏸️ No reconectando durante envío masivo para usuario ${this.userId}`);
                    } else {
                        console.log(`❌ Conexión cerrada (código ${statusCode}) - esperando reconexión manual`);
                    }
                } else if (connection === 'connecting') {
                    console.log(`🔄 Conectando WhatsApp para usuario ${this.userId || 'default'}...`);
                    // � NO agregar timeout aquí - dejar que WhatsApp maneje su propio timing
                    
                } else if (connection === 'open') {
                    console.log(`🎉 WhatsApp conectado exitosamente para usuario ${this.userId || 'default'}`);
                    
                    // Limpiar cualquier timeout existente
                    if (this.connectionTimeout) {
                        clearTimeout(this.connectionTimeout);
                        this.connectionTimeout = null;
                    }
                    
                    // Obtener información del usuario
                    try {
                        const userInfo = this.sock.user;
                        if (userInfo) {
                            console.log(`📞 Número conectado: ${userInfo.id.split(':')[0]}`);
                            console.log(`👤 Nombre: ${userInfo.name || 'Sin nombre'}`);
                        }
                    } catch (error) {
                        console.log('⚠️ No se pudo obtener información del usuario:', error.message);
                    }
                    
                    this.isReady = true;
                    this.qrCode = null;
                    this.emit('ready');
                    console.log(`✅ Cliente Baileys listo para usuario ${this.userId || 'default'}`);
                }
            });

            // Guardar credenciales cuando cambien
            this.sock.ev.on('creds.update', this.saveCreds);

            // Manejar actualizaciones de mensajes
            this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
                // Solo procesar mensajes nuevos
                if (type === 'notify') {
                    for (const message of messages) {
                        if (!message.key.fromMe) {
                            // Aquí se pueden manejar mensajes entrantes si es necesario
                            console.log(`📨 Mensaje recibido de ${message.key.remoteJid}`);
                        }
                    }
                }
            });

            this.isInitializing = false; // Marcar como completado

        } catch (error) {
            this.isInitializing = false; // Limpiar flag en caso de error
            console.error(`❌ Error al inicializar Baileys para usuario ${this.userId || 'default'}:`, error);
            throw error;
        }
    }

    // Función para generar emoji aleatorio
    getRandomEmoji() {
        const emojis = [
            '😊', '🌟', '✨', '💫', '🎉', '🎊', '🎈','🍀',
            '☀️', '⭐', '💎', '🎯', 
            '🏆', '🎖️', '🏅', '🎁', '🔥','⚡','🥳', '😄', '😃', '😀', '😁', '🤩',
            '🙂', '😌', '😋', '😎', '🤗', '🤭', '💪', '👏', '🙌', '👍',
            '✌️', '🤞', '🤟', '👌', '🤘','💯', '✅'
        ];
        return emojis[Math.floor(Math.random() * emojis.length)];
    }

    // Función para personalizar mensaje - SIMPLIFICADO: solo emoji
    personalizeMessage(baseMessage, contactName) {
        const emoji = this.getRandomEmoji();
        return `${emoji} ${baseMessage}`;
    }

    // Resolver JID (ID de chat) para Baileys
    resolveJid(phoneNumber) {
        const cleaned = phoneNumber.replace(/\D/g, '');
        
        // Detectar automáticamente el país basado en la longitud
        let intl = cleaned;
        if (intl.length === 9) {
            intl = '51' + intl; // Perú
            console.log(`🇵🇪 Número peruano detectado: ${phoneNumber} -> ${intl}`);
        } else if (intl.length === 10) {
            intl = '52' + intl; // México
            console.log(`🇲🇽 Número mexicano detectado: ${phoneNumber} -> ${intl}`);
        }
        
        const jid = `${intl}@s.whatsapp.net`;
        console.log(`📱 JID generado: ${phoneNumber} -> ${jid}`);
        return jid;
    }

    async sendBulkMessages(contacts, message) {
        if (!this.isReady || !this.sock) {
            throw new Error('WhatsApp no está conectado');
        }

        // 🛡️ Activar flag de envío para prevenir reconexiones
        this.isSending = true;
        console.log('🔒 Modo envío activado - Reconexiones deshabilitadas');

        console.log(`🚀 Iniciando envío masivo con Baileys a ${contacts.length} contactos`);
        const results = [];
        
        try {
            for (let i = 0; i < contacts.length; i++) {
                const contact = contacts[i];
                
                try {
                    // Verificar que el socket sigue activo
                    if (!this.sock || !this.isReady) {
                        throw new Error('Socket WhatsApp desconectado');
                    }

                    // Resolver JID del contacto
                    const jid = this.resolveJid(contact.number);

                    // Verificar si el número está registrado en WhatsApp
                    try {
                        const [result] = await this.sock.onWhatsApp(jid);
                        if (!result?.exists) {
                            console.log(`❌ Número no registrado en WhatsApp: ${contact.number}`);
                            results.push({
                                contact: contact.name,
                                number: contact.number,
                                success: false,
                                error: 'Número no registrado en WhatsApp'
                            });
                            continue;
                        }
                        console.log(`✅ Número verificado en WhatsApp: ${contact.number}`);
                    } catch (verifyError) {
                        console.log(`⚠️ No se pudo verificar el número ${contact.number}, continuando...`);
                    }

                    // Personalizar mensaje
                    const personalizedMessage = this.personalizeMessage(message, contact.name);

                    // Enviar mensaje con reintentos
                    let messageSent = false;
                    let retries = 3;
                    
                    while (retries > 0 && !messageSent) {
                        try {
                            await this.sock.sendMessage(jid, { text: personalizedMessage });
                            messageSent = true;
                            console.log(`✅ Mensaje enviado a ${contact.name} (${contact.number}): "${personalizedMessage.substring(0, 50)}${personalizedMessage.length > 50 ? '...' : ''}"`);
                            
                        } catch (sendError) {
                            retries--;
                            console.log(`❌ Error enviando mensaje a ${contact.number} (${retries} intentos restantes):`, sendError.message);
                            
                            if (retries > 0) {
                                await new Promise(resolve => setTimeout(resolve, 3000));
                            } else {
                                throw sendError;
                            }
                        }
                    }
                    
                    results.push({
                        contact: contact.name,
                        number: contact.number,
                        success: true,
                        timestamp: new Date(),
                        sentMessage: personalizedMessage
                    });

                    // Delay inteligente entre mensajes
                    if (i < contacts.length - 1) {
                        await this.intelligentDelay(i, contacts.length);
                    }

                } catch (error) {
                    console.error(`❌ Error enviando a ${contact.name} (${contact.number}):`, error.message);
                    results.push({
                        contact: contact.name,
                        number: contact.number,
                        success: false,
                        error: error.message
                    });
                    
                    // Si es un error de conexión crítico, parar el envío
                    if (error.message.includes('Connection Closed') || 
                        error.message.includes('desconectado')) {
                        console.error('🚨 Socket WhatsApp cerrado inesperadamente. Deteniendo envío.');
                        break;
                    }
                }
            }

            console.log(`🎯 Envío masivo completado: ${results.filter(r => r.success).length}/${results.length} mensajes exitosos`);
            
            // ⚡ SEGURIDAD: Cerrar SOLO la sesión de WhatsApp, NO la sesión del usuario web
            console.log('🔒 Programando cierre automático de la sesión de WhatsApp por seguridad...');
            console.log('ℹ️ NOTA: Solo se cerrará WhatsApp, la sesión web del usuario permanece activa');
            setTimeout(async () => {
                try {
                    console.log('🔐 Cerrando sesión de WhatsApp automáticamente (usuario web sigue activo)...');
                    await this.destroy();
                    console.log('✅ Sesión de WhatsApp cerrada automáticamente - Usuario web sigue conectado');
                } catch (error) {
                    console.log('⚠️ Error cerrando sesión automática de WhatsApp:', error.message);
                }
            }, 5000); // Esperar 5 segundos para asegurar que los mensajes se enviaron

            return results;
            
        } catch (error) {
            console.error('🚨 Error crítico en envío masivo:', error.message);
            throw error;
        } finally {
            // 🛡️ Siempre desactivar flag de envío al finalizar
            this.isSending = false;
            console.log('🔓 Modo envío desactivado - Reconexiones rehabilitadas (finally)');
        }
    }

    async intelligentDelay(currentIndex, totalMessages) {
        let delay;
        
        // Delays más largos cada ciertos mensajes
        if ((currentIndex + 1) % 50 === 0) {
            delay = 300000; // 5 minutos cada 50 mensajes
        } else if ((currentIndex + 1) % 25 === 0) {
            delay = 120000; // 2 minutos cada 25 mensajes
        } else if ((currentIndex + 1) % 10 === 0) {
            delay = 60000; // 1 minuto cada 10 mensajes
        } else {
            // Delay aleatorio entre 8-15 segundos
            delay = Math.floor(Math.random() * 7000) + 8000;
        }

        console.log(`⏰ Esperando ${delay/1000} segundos antes del siguiente mensaje...`);
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    async getContacts() {
        if (!this.isReady || !this.sock) {
            throw new Error('WhatsApp no está conectado');
        }

        try {
            // En Baileys, necesitamos obtener los contactos del store
            const contacts = Object.values(this.sock.store?.contacts || {});
            return contacts.map(contact => ({
                id: contact.id,
                name: contact.name || contact.notify || 'Sin nombre',
                number: contact.id.split('@')[0]
            }));
        } catch (error) {
            console.error('Error al obtener contactos:', error);
            throw error;
        }
    }

    async destroy() {
        try {
            if (this.sock) {
                console.log(`🔌 Cerrando conexión de WhatsApp para usuario ${this.userId || 'default'}...`);
                console.log(`ℹ️ NOTA: Solo se cierra WhatsApp, la sesión web del usuario permanece activa`);
                
                this.isReady = false;
                this.emit('disconnected', 'Manually disconnected');
                
                // Cerrar socket de WhatsApp
                try {
                    await this.sock.logout();
                    console.log('📤 Logout de WhatsApp exitoso');
                } catch (logoutError) {
                    console.log('⚠️ Logout de WhatsApp error (ignorado):', logoutError.message);
                }
                
                this.sock = null;
                console.log('✅ Socket de WhatsApp cerrado correctamente - Usuario web sigue activo');
            }
        } catch (error) {
            console.error('❌ Error al destruir socket de WhatsApp:', error.message);
            this.sock = null;
            this.isReady = false;
        }
    }

    getConnectionState() {
        return {
            isReady: this.isReady,
            client: !!this.sock,
            userId: this.userId,
            qrCode: this.qrCode
        };
    }

    clearUserCredentials(userId) {
        return new Promise((resolve) => {
            try {
                const cleanUserId = String(userId || this.userId).replace(/[^a-zA-Z0-9_-]/g, '');
                const sessionPath = path.join(__dirname, '../..', 'baileys_sessions', `session_${cleanUserId}`);
                
                if (fs.existsSync(sessionPath)) {
                    fs.rmSync(sessionPath, { recursive: true, force: true });
                    console.log(`🗑️ Credenciales eliminadas para usuario ${userId || this.userId}`);
                } else {
                    console.log(`ℹ️ No había credenciales para limpiar para usuario ${userId || this.userId}`);
                }
                
                resolve(true);
            } catch (error) {
                console.error(`❌ Error limpiando credenciales para usuario ${userId || this.userId}:`, error);
                resolve(false);
            }
        });
    }
}

module.exports = WhatsAppServiceBaileys;
