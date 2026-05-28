import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import http from 'http'; // Importação nativa do Node.js (não precisa de npm install)

// --- O TRUQUE PARA A RENDER NÃO DERRUBAR O BOT ---
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot da Delicie esta online e rodando!');
}).listen(PORT, () => {
    console.log(`🌐 Servidor HTTP "fantasma" rodando na porta ${PORT} para a Render`);
});
// --------------------------------------------------

// Coloque aqui a URL real que a Render gerou para a sua API principal
const URL_API_RENDER = 'https://SUA-API-DELICIE-AQUI.onrender.com/webhook-whatsapp';

async function iniciarBot() {
    // Gerencia a sessão para você não precisar ler o QR Code toda hora
    const { state, saveCreds } = await useMultiFileAuthState('./sessao_whatsapp');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n📱 Escaneie o QR Code abaixo no painel de LOGS da Render:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const erro = lastDisconnect.error?.output?.statusCode;
            const deveReconectar = erro !== DisconnectReason.loggedOut;
            console.log('Conexão fechada. Motivo:', erro);
            
            if (deveReconectar) {
                iniciarBot();
            } else {
                console.log('Você foi desconectado. Apague a pasta "sessao_whatsapp" e rode novamente.');
            }
        } else if (connection === 'open') {
            console.log('\n✅ Bot conectado com sucesso! Pronto para registrar vendas.');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];

        if (!msg.message || msg.key.fromMe) return;

        const textoMensagem = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (textoMensagem) {
            console.log(`\n💬 Nova mensagem recebida: "${textoMensagem}"`);
            
            try {
                const resposta = await fetch(URL_API_RENDER, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mensagem: textoMensagem })
                });

                const dados = await resposta.json();

                if (resposta.ok) {
                    console.log("✅ Venda processada e salva com sucesso!");
                    
                    const textoConfirmacao = `*Venda Registrada com Sucesso!* ✅\n\n` +
                                             `👤 Cliente: ${dados.dados.cliente}\n` +
                                             `🍪 Produto: ${dados.dados.produto}\n` +
                                             `😋 Sabor: ${dados.dados.sabor}\n` +
                                             `📦 Quantidade: ${dados.dados.quantidade}`;
                    
                    await sock.sendMessage(msg.key.remoteJid, { text: textoConfirmacao });
                } else {
                    console.error("⚠️ Erro retornado pela API:", dados.error);
                    await sock.sendMessage(msg.key.remoteJid, { text: `❌ Ops, não consegui registrar a venda. Erro: ${dados.error}` });
                }

            } catch (erro) {
                console.error("❌ Falha ao tentar conectar com a API:", erro);
            }
        }
    });
}

iniciarBot();