import { Router } from 'express';
import { pool } from '../db';
import { iniciarSessao, registrarLid } from '../sessions';
import { getCliente, isConectado } from './whatsapp';

const router = Router();

// GET /pesquisa/grupos
router.get('/grupos', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id_grupo_pesquisa, nome FROM tb_grupo_pesquisa WHERE sn_ativo = 'S' ORDER BY nome`
    );
    res.json({ ok: true, grupos: rows });
  } catch (error) {
    res.status(500).json({ ok: false, message: 'Erro ao buscar grupos', error: String(error) });
  }
});

// GET /pesquisa/respondentes
router.get('/respondentes', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id_respondente, nome, telefone FROM tb_respondente ORDER BY nome`
    );
    res.json({ ok: true, respondentes: rows });
  } catch (error) {
    res.status(500).json({ ok: false, message: 'Erro ao buscar respondentes', error: String(error) });
  }
});

// POST /pesquisa/iniciar
// Body: { id_respondente, id_grupo_pesquisa }
router.post('/iniciar', async (req, res) => {
  if (!isConectado()) {
    return res.status(400).json({ ok: false, message: 'WhatsApp não está conectado. Conecte primeiro.' });
  }

  const { id_respondente, id_grupo_pesquisa } = req.body;
  if (!id_respondente || !id_grupo_pesquisa) {
    return res.status(400).json({ ok: false, message: 'id_respondente e id_grupo_pesquisa são obrigatórios' });
  }

  const cliente = getCliente();
  const enviar = async (para: string, texto: string) => {
    await cliente!.sendMessage(`${para}@c.us`, texto);
  };

  try {
    const resultado = await iniciarSessao(Number(id_respondente), Number(id_grupo_pesquisa), enviar);
    if (!resultado.ok) return res.json(resultado);

    // Resolve o @lid do número para mapear mensagens recebidas
    const [rows] = await pool.query<any[]>(
      `SELECT telefone FROM tb_respondente WHERE id_respondente = ? LIMIT 1`,
      [id_respondente]
    );
    if (rows.length) {
      const telefone = String(rows[0].telefone);
      try {
        const numId = await cliente!.getNumberId(telefone);
        if (numId && numId._serialized.endsWith('@lid')) {
          registrarLid(numId.user, telefone);
        }
      } catch {
        console.warn('[Pesquisa] Não foi possível resolver @lid para', telefone);
      }
    }

    return res.json(resultado);
  } catch (error) {
    return res.status(500).json({ ok: false, message: 'Erro ao iniciar pesquisa', error: String(error) });
  }
});

export default router;
