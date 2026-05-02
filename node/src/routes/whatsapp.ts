import { Router } from 'express';
import { Client, LocalAuth, MessageMedia } from 'whatsapp-web.js';
import qrcode from 'qrcode';

const router = Router();

type Status = 'desconectado' | 'inicializando' | 'aguardando_qr' | 'conectado';

let client: Client | null = null;
let status: Status = 'desconectado';
let qrAtual: string | null = null;
let destruindo = false;

function clienteConectado(): boolean {
  return status === 'conectado' && client !== null;
}

function formatarNumero(numero: string): string {
  return numero.includes('@') ? numero : `${numero}@c.us`;
}

// POST /whatsapp/conectar
// Inicializa o cliente WhatsApp e aguarda o QR code para escaneamento
router.post('/conectar', async (req, res) => {
  if (status === 'conectado') {
    return res.json({ ok: true, message: 'WhatsApp já está conectado', status });
  }

  if (status === 'inicializando' || status === 'aguardando_qr') {
    return res.json({ ok: true, message: 'Inicialização já em andamento', status, qr: qrAtual });
  }

  status = 'inicializando';
  qrAtual = null;

  client = new Client({
    authStrategy: new LocalAuth({ clientId: 'scala-zap' }),
    puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] },
  });

  client.on('qr', async (qr) => {
    qrAtual = await qrcode.toDataURL(qr);
    status = 'aguardando_qr';
    console.log('[WhatsApp] QR code gerado — escaneie no celular');
  });

  client.on('ready', () => {
    status = 'conectado';
    qrAtual = null;
    console.log('[WhatsApp] Cliente conectado com sucesso');
  });

  client.on('auth_failure', (msg) => {
    status = 'desconectado';
    qrAtual = null;
    client = null;
    console.error('[WhatsApp] Falha de autenticação:', msg);
  });

  client.on('disconnected', async (reason) => {
    console.log('[WhatsApp] Desconectado:', reason);
    status = 'desconectado';
    qrAtual = null;
    const c = client;
    client = null;
    // só destrói o browser se o disconnect veio do WhatsApp (LOGOUT etc.)
    // quando veio do botão desconectar, o destroy já foi chamado antes
    if (!destruindo) {
      try { await c?.destroy(); } catch {}
    }
    destruindo = false;
  });

  // erros internos do Puppeteer (ex: detached Frame após logout) — não afetam o funcionamento
  client.on('error', (err: Error) => {
    console.warn('[WhatsApp] Erro interno (ignorado):', err.message);
  });

  client.initialize();

  // Aguarda até 30s pelo QR ou pela conexão direta (sessão salva)
  await new Promise<void>((resolve) => {
    const intervalo = setInterval(() => {
      if (qrAtual || status === 'conectado') {
        clearInterval(intervalo);
        resolve();
      }
    }, 500);
    setTimeout(() => {
      clearInterval(intervalo);
      resolve();
    }, 30000);
  });

  return res.json({ ok: true, status, qr: qrAtual });
});

// GET /whatsapp/status
// Retorna o status atual e o QR code (quando disponível)
router.get('/status', (req, res) => {
  res.json({ ok: true, status, qr: qrAtual });
});

// POST /whatsapp/desconectar
// Encerra a sessão do WhatsApp
router.post('/desconectar', async (req, res) => {
  if (!client) {
    return res.json({ ok: true, message: 'Nenhum cliente ativo' });
  }
  destruindo = true;
  try {
    await client.destroy();
  } catch {
    destruindo = false;
  }
  client = null;
  status = 'desconectado';
  qrAtual = null;
  return res.json({ ok: true, message: 'Desconectado com sucesso' });
});

// POST /whatsapp/mensagem
// Body: { numero: "5511999999999", mensagem: "Olá!" }
router.post('/mensagem', async (req, res) => {
  if (!clienteConectado()) {
    return res.status(400).json({ message: 'WhatsApp não está conectado. Use POST /whatsapp/conectar primeiro.' });
  }

  const { numero, mensagem } = req.body;
  if (!numero || !mensagem) {
    return res.status(400).json({ message: 'numero e mensagem são obrigatórios' });
  }

  try {
    const chatId = formatarNumero(String(numero));
    const resultado = await client!.sendMessage(chatId, String(mensagem));
    return res.json({ ok: true, id: resultado.id._serialized });
  } catch (error) {
    return res.status(500).json({ message: 'Erro ao enviar mensagem', error: String(error) });
  }
});

// POST /whatsapp/imagem
// Body: { numero: "5511999999999", url_imagem: "https://..." }
//    ou { numero, base64: "...", mimetype: "image/jpeg", filename: "foto.jpg" }
router.post('/imagem', async (req, res) => {
  if (!clienteConectado()) {
    return res.status(400).json({ message: 'WhatsApp não está conectado. Use POST /whatsapp/conectar primeiro.' });
  }

  const { numero, url_imagem, base64, mimetype, filename } = req.body;
  if (!numero || (!url_imagem && !base64)) {
    return res.status(400).json({ message: 'numero e url_imagem (ou base64) são obrigatórios' });
  }

  try {
    const chatId = formatarNumero(String(numero));
    let media: MessageMedia;

    if (url_imagem) {
      media = await MessageMedia.fromUrl(String(url_imagem));
    } else {
      media = new MessageMedia(
        mimetype || 'image/jpeg',
        String(base64),
        filename || 'imagem.jpg'
      );
    }

    const resultado = await client!.sendMessage(chatId, media);
    return res.json({ ok: true, id: resultado.id._serialized });
  } catch (error) {
    return res.status(500).json({ message: 'Erro ao enviar imagem', error: String(error) });
  }
});

// POST /whatsapp/mensagem-imagem
// Body: { numero: "5511999999999", url_imagem: "https://...", mensagem: "Legenda aqui" }
//    ou { numero, base64: "...", mimetype: "image/jpeg", filename: "foto.jpg", mensagem: "..." }
router.post('/mensagem-imagem', async (req, res) => {
  if (!clienteConectado()) {
    return res.status(400).json({ message: 'WhatsApp não está conectado. Use POST /whatsapp/conectar primeiro.' });
  }

  const { numero, url_imagem, base64, mimetype, filename, mensagem } = req.body;
  if (!numero || (!url_imagem && !base64) || !mensagem) {
    return res.status(400).json({ message: 'numero, mensagem e url_imagem (ou base64) são obrigatórios' });
  }

  try {
    const chatId = formatarNumero(String(numero));
    let media: MessageMedia;

    if (url_imagem) {
      media = await MessageMedia.fromUrl(String(url_imagem));
    } else {
      media = new MessageMedia(
        mimetype || 'image/jpeg',
        String(base64),
        filename || 'imagem.jpg'
      );
    }

    const resultado = await client!.sendMessage(chatId, media, { caption: String(mensagem) });
    return res.json({ ok: true, id: resultado.id._serialized });
  } catch (error) {
    return res.status(500).json({ message: 'Erro ao enviar imagem com mensagem', error: String(error) });
  }
});

export default router;
