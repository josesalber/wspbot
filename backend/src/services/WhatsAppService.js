const { Client, LocalAuth } = require('whatsapp-web.js');
const EventEmitter = require('events');
const path = require('path');

class WhatsAppService extends EventEmitter {
    constructor(userId = null) {
        super();
        this.client = null;
        this.isReady = false;
        this.userId = userId; // Soporte para sesiones independientes
    }

    async initialize() {
        try {
            // Limpiar userId para asegurar un clientId válido
            const cleanUserId = this.userId ? String(this.userId).replace(/[^a-zA-Z0-9_-]/g, '') : 'default';
            console.log(`Inicializando WhatsApp para usuario ${this.userId} (clientId: ${cleanUserId})`);
            
            // Configurar sesión independiente por usuario
            const sessionPath = this.userId ? 
                path.join(__dirname, '../..', 'whatsapp_sessions', `session_${cleanUserId}`) :
                path.join(__dirname, '../..', 'whatsapp_sessions', 'default');

            this.client = new Client({
                authStrategy: new LocalAuth({
                    clientId: cleanUserId,
                    dataPath: sessionPath
                }),
                puppeteer: {
                    headless: true,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--no-first-run',
                        '--no-zygote',
                        '--single-process',
                        '--disable-gpu'
                    ]
                }
            });

            this.client.on('qr', (qr) => {
                console.log(`QR Code generado para usuario ${this.userId || 'default'}`);
                this.emit('qr', qr);
            });

            this.client.on('ready', async () => {
                console.log(`🎉 WhatsApp conectado exitosamente para usuario ${this.userId || 'default'}`);
                
                // Registrar versión de WhatsApp Web para diagnóstico
                try {
                    const version = await this.client.getWWebVersion();
                    console.log(`📱 WhatsApp Web versión: ${version}`);
                    
                    // Obtener información del usuario conectado
                    const info = this.client.info;
                    if (info && info.wid) {
                        console.log(`📞 Número conectado: ${info.wid.user}`);
                        console.log(`👤 Nombre de usuario: ${info.pushname || 'Sin nombre'}`);
                    }
                } catch (error) {
                    console.log('⚠️ No se pudo obtener información de WhatsApp Web:', error.message);
                }
                
                this.isReady = true;
                this.emit('ready');
                console.log(`✅ Cliente WhatsApp listo para usuario ${this.userId || 'default'}`);
            });

            this.client.on('disconnected', (reason) => {
                console.log(`WhatsApp desconectado para usuario ${this.userId || 'default'}:`, reason);
                this.isReady = false;
                this.emit('disconnected', reason);
            });

            this.client.on('auth_failure', (msg) => {
                console.error(`Fallo de autenticación para usuario ${this.userId || 'default'}:`, msg);
                this.emit('auth_failure', msg);
            });

            await this.client.initialize();
            
            // Timeout para detectar si el evento ready no se dispara
            const readyTimeout = setTimeout(() => {
                if (!this.isReady) {
                    console.warn(`⚠️ ADVERTENCIA: El evento 'ready' no se disparó en 60 segundos para usuario ${this.userId || 'default'}`);
                    console.warn(`🔧 Esto podría indicar un problema con WhatsApp Web.js`);
                }
            }, 60000); // 60 segundos
            
            // Limpiar timeout cuando se conecte
            this.once('ready', () => {
                clearTimeout(readyTimeout);
            });

        } catch (error) {
            console.error(`Error al inicializar WhatsApp para usuario ${this.userId || 'default'}:`, error);
            throw error;
        }
    }

    // Función para generar emoji aleatorio
    getRandomEmoji() {
        const emojis = [
            '😊', '🌟', '✨', '💫', '🌈', '🎉', '🎊', '🎈', '🌻', '🌺',
            '🌼', '🌷', '🌹', '🌾', '🍀', '🦋', '🌸', '💐', '🌿', '🌱',
            '☀️', '🌤️', '⭐', '🌙', '💎', '🔮', '🎯', '🎪', '🎨', '🎭',
            '🏆', '🎖️', '🏅', '🎁', '🎀', '💌', '💝', '🧿', '🌅', '🌄',
            '🏔️', '🌊', '🔥', '💧', '🌪️', '⚡', '🌳', '🌲', '🎄', '🌴',
            '🥳', '😄', '😃', '😀', '😁', '😆', '🥰', '😍', '🤩', '😇',
            '🙂', '😌', '😋', '😎', '🤗', '🤭', '💪', '👏', '🙌', '👍',
            '✌️', '🤞', '🤟', '👌', '🤘', '🫶', '❤️', '💙', '💚', '💛',
            '🧡', '💜', '🤍', '💗', '💖', '💕', '💓', '💘', '💯', '✅'
        ];
        return emojis[Math.floor(Math.random() * emojis.length)];
    }

    // Función para limpiar caché cuando hay errores de getChat
    async forceRefreshConnection() {
        try {
            console.log('🔄 Forzando actualización de conexión...');
            
            // Intentar obtener el estado actual
            const state = await this.client.getState();
            console.log(`📊 Estado actual del cliente: ${state}`);
            
            // Si no está conectado, no podemos hacer mucho
            if (state !== 'CONNECTED') {
                console.log('⚠️ Cliente no está conectado, no se puede refrescar');
                return false;
            }
            
            // Intentar una operación simple para verificar que la conexión funciona
            await this.client.getContacts();
            console.log('✅ Conexión verificada exitosamente');
            return true;
            
        } catch (error) {
            console.log(`❌ Error refrescando conexión: ${error.message}`);
            return false;
        }
    }

    // Función para resolver ID de chat con fallback (compatible 1.32+)
    async resolveChatId(raw) {
        const cleaned = raw.replace(/\D/g, '');
        if (cleaned.length < 9 || cleaned.length > 15) return null;

        // Asegura código país (regla PE/MX)
        let intl = cleaned;
        if (intl.length === 9) intl = '51' + intl;     // Perú
        else if (intl.length === 10) intl = '52' + intl; // México

        console.log(`🔍 Resolviendo ID para: ${raw} -> ${intl}`);

        // 1) Intento estándar con getNumberId
        try {
            const ni = await this.client.getNumberId(intl);
            if (ni && ni._serialized) {
                console.log(`✅ ID resuelto con getNumberId: ${ni._serialized}`);
                return ni._serialized;
            }
        } catch (error) {
            console.log(`⚠️ getNumberId falló: ${error.message}`);
        }

        // 2) Fallback clásico @c.us
        const jid = `${intl}@c.us`;
        try {
            const ok = await this.client.isRegisteredUser(jid);
            if (ok) {
                console.log(`✅ ID resuelto con isRegisteredUser: ${jid}`);
                return jid;
            }
        } catch (error) {
            console.log(`⚠️ isRegisteredUser falló: ${error.message}`);
        }

        // 3) Intentar con formato original si es diferente
        if (intl !== cleaned) {
            const originalJid = `${cleaned}@c.us`;
            try {
                const ok = await this.client.isRegisteredUser(originalJid);
                if (ok) {
                    console.log(`✅ ID resuelto con formato original: ${originalJid}`);
                    return originalJid;
                }
            } catch (error) {
                console.log(`⚠️ isRegisteredUser con formato original falló: ${error.message}`);
            }
        }

        console.log(`❌ No se pudo resolver ID para: ${raw}`);
        return null;
    }
    personalizeMessage(baseMessage, contactName) {
        const emoji = this.getRandomEmoji();
        const variations = [
            `${emoji} ${baseMessage}`,
            `${baseMessage} ${emoji}`,
            `${emoji} Hola! ${baseMessage}`,
            `¡Hola! ${baseMessage} ${emoji}`,
            `${emoji} ${baseMessage} ¡Saludos!`,
            `${baseMessage} ${emoji} ¡Que tengas un gran día!`
        ];
        
        const selectedVariation = variations[Math.floor(Math.random() * variations.length)];
        
        // Personalizar con nombre si está disponible y no es "Sin nombre"
        if (contactName && contactName !== 'Sin nombre') {
            const personalizedVariations = [
                `${emoji} Hola ${contactName}! ${baseMessage}`,
                `${baseMessage} ${emoji} ¡Saludos ${contactName}!`,
                `${emoji} ${contactName}, ${baseMessage}`,
                `¡Hola ${contactName}! ${baseMessage} ${emoji}`
            ];
            return personalizedVariations[Math.floor(Math.random() * personalizedVariations.length)];
        }
        
        return selectedVariation;
    }

    async sendBulkMessages(contacts, message) {
        if (!this.isReady) {
            throw new Error('WhatsApp no está conectado');
        }

        const results = [];
        
        for (let i = 0; i < contacts.length; i++) {
            const contact = contacts[i];
            
            try {
                // Verificar que el cliente sigue activo
                if (!this.client || !this.isReady) {
                    throw new Error('Cliente WhatsApp desconectado');
                }

                // Usar la nueva función resolveChatId para manejar cambios en la API
                const chatId = await this.resolveChatId(contact.number);
                if (!chatId) {
                    results.push({
                        contact: contact.name,
                        number: contact.number,
                        success: false,
                        error: 'No se pudo resolver el ID de WhatsApp'
                    });
                    continue;
                }

                // Personalizar mensaje con emoji aleatorio y variaciones
                const personalizedMessage = this.personalizeMessage(message, contact.name);

                // Enviar mensaje (con reintentos y estrategia robusta)
                let messageSent = false;
                let retries = 3; // Aumentar reintentos
                
                while (retries > 0 && !messageSent) {
                    try {
                        // Verificar estado del cliente antes de cada intento
                        if (!this.client || !this.isReady) {
                            throw new Error('Cliente WhatsApp desconectado');
                        }

                        // Estrategia robusta: verificar estado de conexión
                        const state = await this.client.getState();
                        if (state !== 'CONNECTED') {
                            throw new Error(`Cliente no conectado: ${state}`);
                        }

                        // Intentar envío con timeout
                        await Promise.race([
                            this.client.sendMessage(chatId, personalizedMessage),
                            new Promise((_, reject) => 
                                setTimeout(() => reject(new Error('Timeout en envío')), 30000)
                            )
                        ]);
                        
                        messageSent = true;
                        console.log(`✅ Mensaje enviado exitosamente a ${contact.name} (${contact.number})`);
                        
                    } catch (sendError) {
                        retries--;
                        console.log(`❌ Error enviando mensaje (${retries} intentos restantes):`, sendError.message);
                        
                        // Si es un error de getChat, esperar más y reintentar
                        if (sendError.message.includes('getChat') || 
                            sendError.message.includes('Evaluation failed') ||
                            sendError.message.includes('Cannot read properties of undefined')) {
                            
                            if (retries > 0) {
                                console.log(`⏳ Error de getChat detectado, refrescando conexión...`);
                                await this.forceRefreshConnection();
                                console.log(`⏳ Esperando 10 segundos antes del siguiente intento...`);
                                await new Promise(resolve => setTimeout(resolve, 10000));
                            }
                        } else if (retries > 0) {
                            // Para otros errores, esperar menos tiempo
                            await new Promise(resolve => setTimeout(resolve, 5000));
                        }
                        
                        if (retries === 0) {
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

                console.log(`✅ Mensaje personalizado enviado a ${contact.name} (${contact.number}): "${personalizedMessage.substring(0, 50)}${personalizedMessage.length > 50 ? '...' : ''}"`);

                // Delay inteligente entre mensajes para evitar ban
                if (i < contacts.length - 1) {
                    await this.intelligentDelay(i, contacts.length);
                }

            } catch (error) {
                console.error(`❌ Error enviando a ${contact.name}:`, error.message);
                results.push({
                    contact: contact.name,
                    number: contact.number,
                    success: false,
                    error: error.message
                });
                
                // Si es un error de conexión, parar el envío
                if (error.message.includes('Target closed') || error.message.includes('desconectado')) {
                    console.error('🚨 Cliente WhatsApp cerrado inesperadamente. Deteniendo envío.');
                    break;
                }
            }
        }

        return results;
    }

    formatPhoneNumber(number) {
        // Remover todos los caracteres no numéricos
        let cleaned = number.replace(/\D/g, '');
        
        console.log(`🇵🇪 Número peruano detectado (${cleaned.length} dígitos): ${number} -> ${cleaned}`);
        
        // Detectar automáticamente el país basado en la longitud
        if (cleaned.length === 9) {
            // Número peruano (9 dígitos) - agregar código 51
            cleaned = '51' + cleaned;
            console.log(`🇵🇪 Número peruano detectado (9 dígitos): ${number} -> ${cleaned}`);
        } else if (cleaned.length === 10) {
            // Número mexicano (10 dígitos) - agregar código 52
            cleaned = '52' + cleaned;
            console.log(`🇲🇽 Número mexicano detectado (10 dígitos): ${number} -> ${cleaned}`);
        } else if (cleaned.length === 11 && cleaned.startsWith('51')) {
            // Ya tiene código peruano
            console.log(`🇵🇪 Número peruano con código: ${number} -> ${cleaned}`);
        } else if (cleaned.length === 12 && cleaned.startsWith('52')) {
            // Ya tiene código mexicano
            console.log(`🇲🇽 Número mexicano con código: ${number} -> ${cleaned}`);
        }
        
        const finalNumber = cleaned + '@c.us';
        console.log(`📱 Número formateado final: ${number} -> ${finalNumber}`);
        return finalNumber;
    }

    getAlternativeFormats(number) {
        const cleaned = number.replace(/\D/g, '');
        const formats = [];
        
        console.log(`🔄 Generando formatos alternativos para: ${number} (${cleaned.length} dígitos)`);
        
        if (cleaned.length === 9) {
            // Número de 9 dígitos - probablemente peruano
            console.log('🇵🇪 Formato peruano principal: 51' + cleaned + '@c.us');
            formats.push('51' + cleaned + '@c.us'); // Con código peruano
            formats.push(cleaned + '@c.us'); // Sin código de país
        } else if (cleaned.length === 10) {
            // Número de 10 dígitos - probablemente mexicano
            console.log('🇲🇽 Formato mexicano principal: 52' + cleaned + '@c.us');
            formats.push('52' + cleaned + '@c.us'); // Con código mexicano
            formats.push(cleaned + '@c.us'); // Sin código de país
        } else if (cleaned.length === 11 && cleaned.startsWith('51')) {
            // Ya tiene código peruano
            formats.push(cleaned + '@c.us');
            formats.push(cleaned.substring(2) + '@c.us'); // Sin código
        } else if (cleaned.length === 12 && cleaned.startsWith('52')) {
            // Ya tiene código mexicano
            formats.push(cleaned + '@c.us');
            formats.push(cleaned.substring(2) + '@c.us'); // Sin código
        } else {
            // Formato desconocido, agregar tal como está
            formats.push(cleaned + '@c.us');
        }
        
        // Agregar formato original si no está ya incluido
        const originalFormat = cleaned + '@c.us';
        if (!formats.includes(originalFormat)) {
            console.log('📱 Formato original:', originalFormat);
            formats.push(originalFormat);
        }
        
        console.log('📋 Formatos finales a probar:', formats);
        return formats;
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
        if (!this.isReady) {
            throw new Error('WhatsApp no está conectado');
        }

        try {
            const contacts = await this.client.getContacts();
            return contacts.map(contact => ({
                id: contact.id._serialized,
                name: contact.name || contact.pushname || 'Sin nombre',
                number: contact.number
            }));
        } catch (error) {
            console.error('Error al obtener contactos:', error);
            throw error;
        }
    }

    async destroy() {
        try {
            if (this.client) {
                this.isReady = false;
                this.emit('disconnected', 'Manually disconnected');
                
                console.log(`🔌 Cerrando WhatsApp Web para usuario ${this.userId || 'default'}...`);
                
                // Esperar un poco antes de cerrar para evitar problemas
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Intentar logout primero (si está autenticado)
                try {
                    await this.client.logout();
                    console.log('📤 Logout exitoso');
                } catch (logoutError) {
                    console.log('⚠️ Logout error (ignorado):', logoutError.message);
                }
                
                // Destruir el cliente de forma más suave
                try {
                    await this.client.destroy();
                    console.log('✅ Cliente WhatsApp destruido correctamente');
                } catch (destroyError) {
                    console.log('⚠️ Error en destroy (ignorado):', destroyError.message);
                }
                
                this.client = null;
                
                // Esperar para asegurar limpieza completa
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        } catch (error) {
            console.error('❌ Error general al destruir cliente:', error.message);
            // Forzar limpieza de estado
            this.client = null;
            this.isReady = false;
        }
    }

    getConnectionState() {
        return {
            isReady: this.isReady,
            client: !!this.client,
            userId: this.userId
        };
    }
}

module.exports = WhatsAppService;
