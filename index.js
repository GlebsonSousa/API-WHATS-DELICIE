import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import express from 'express';
import qrcodeTerminal from 'qrcode-terminal';
import qrcodeWeb from 'qrcode';
import pino from 'pino';
import fs from 'fs';

const app = express();
app.use(express.json());

// Variáveis globais para a rota do QR Code
let qrCodeAtual = '';
let statusConexao = 'Aguardando inicialização...';

// URL da sua outra API (A que salva no banco)
const URL_API_RENDER = 'https://SUA-API-DELICIE-AQUI.onrender.com/webhook-whatsapp';

// --- ROTAS WEB ---
app.get('/', (req, res) => {
    res.send(`<h2>Status do Bot: ${statusConexao}</h2><p>Acesse <a href="/qr">/qr</a> para ler o código.</p>`);
});

app.get('/qr', async (req, res) => {
    if (statusConexao === 'Conectado') {
        return res.send('<h2>✅ O Bot já está conectado! Não é necessário ler o QR Code.</h2>');
    }
    if (!qrCodeAtual) {
        return res.send('<h2>⏳ Gerando QR Code... Atualize a página em 5 segundos.</h2>');
    }
    
    try {
        const qrImage = await qrcodeWeb.toDataURL(qrCodeAtual);
        res.send(`
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; font-family:sans-serif;">
                <h2>📱 Escaneie para conectar o Bot</h2>
                <img src="${qrImage}" style="width: 300px; height: 300px; border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.2);"/>
                <p style="color:gray;">Atualize a página se o código expirar (muda a cada 40s).</p>
            </div>
        `);
    } catch (err) {
        res.send('Erro ao renderizar a imagem do QR Code.');
    }
});

// --- LÓGICA DO WHATSAPP ---
async function iniciarBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./sessao_whatsapp');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // Desligamos no terminal para usar na web
        logger: pino({ level: 'silent' }),
        browser: ['Ubuntu', 'Chrome', '20.0.04']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrCodeAtual = qr;
            statusConexao = 'Aguardando leitura do QR Code';
            console.log('🔄 Novo QR Code gerado. Acesse a rota /qr para ler.');
            // Opcional: mantemos no terminal também caso você olhe os logs
            qrcodeTerminal.generate(qr, { small: true }); 
        }

        if (connection === 'close') {
            statusConexao = 'Desconectado';
            const erro = lastDisconnect.error?.output?.statusCode;
            console.log('❌ Conexão fechada. Motivo:', erro);
            
            if (erro === 405) {
                console.log('⚠️ Erro 405 (Recusado). Forçando limpeza da sessão...');
                qrCodeAtual = ''; // Limpa o QR code antigo
                try {
                    fs.rmSync('./sessao_whatsapp', { recursive: true, force: true });
                    console.log('🧹 Pasta de sessão apagada com sucesso.');
                } catch (e) {
                    console.log('A pasta já estava limpa.');
                }
                setTimeout(iniciarBot, 3000); // Tenta iniciar de novo em 3s
            } 
            else if (erro !== DisconnectReason.loggedOut) {
                setTimeout(iniciarBot, 3000);
            } 
            else {
                console.log('Você desconectou. Limpando dados para novo login...');
                try { fs.rmSync('./sessao_whatsapp', { recursive: true, force: true }); } catch (e) {}
            }
        } else if (connection === 'open') {
            qrCodeAtual = ''; // Apaga o QR Code da memória
            statusConexao = 'Conectado';
            console.log('\n✅ Bot conectado e pronto para uso!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const textoMensagem = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (textoMensagem) {
            console.log(`💬 Mensagem: "${textoMensagem}"`);
            
            try {
                const resposta = await fetch(URL_API_RENDER, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mensagem: textoMensagem })
                });

                const dados = await resposta.json();

                if (resposta.ok) {
                    const textoConfirmacao = `*Venda Registrada!* ✅\nCliente: ${dados.dados.cliente}\nProduto: ${dados.dados.produto}\nSabor: ${dados.dados.sabor}\nQtd: ${dados.dados.quantidade}`;
                    await sock.sendMessage(msg.key.remoteJid, { text: textoConfirmacao });
                } else {
                    await sock.sendMessage(msg.key.remoteJid, { text: `❌ Erro: ${dados.error}` });
                }
            } catch (erro) {
                console.error("Falha ao comunicar com API:", erro);
            }
        }
    });
}

// Inicia o Express e depois o Bot
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🌐 Servidor rodando na porta ${PORT}`);
    iniciarBot();
});