import { RowDataPacket } from 'mysql2';
import { pool } from './db';

export type EnviarFn = (para: string, texto: string) => Promise<void>;

interface Pergunta {
  id_pergunta_pesquisa:  number;
  nome:                  string;
  tipo_nome:             string;
  valor_min:             number;
  valor_max:             number;
  sn_pergunta_motivo:    string;
  sn_regra_motivo:       string;
  sn_regra_valor_motivo: number;
}

interface Sessao {
  id_respondente:   number;
  nome_respondente: string;
  telefone:         string;
  perguntas:        Pergunta[];
  indice:           number;
  aguardando_motivo: boolean;
  valor_pendente:   number | null;
  enviar:           EnviarFn;
  timer:            NodeJS.Timeout;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const DELAY_RESPOSTA = 4000;

const sessoes = new Map<string, Sessao>();
const lidParaTelefone = new Map<string, string>(); // @lid user → telefone real
const TIMEOUT_MS = 60 * 60 * 1000; // 1 hora

function regraAtiva(regra: string, valor: number, limiar: number): boolean {
  switch (regra) {
    case 'MAA': return valor > limiar;
    case 'MAI': return valor >= limiar;
    case 'III': return valor === limiar;
    case 'MEE': return valor < limiar;
    case 'MEI': return valor <= limiar;
    default:    return false;
  }
}

function formatarPergunta(p: Pergunta, indice: number, total: number): string {
  return (
    `📊 *Pergunta ${indice + 1} de ${total}* — ${p.tipo_nome}\n` +
    `${p.nome}\n\n` +
    `_Digite um número de *${p.valor_min}* a *${p.valor_max}*_`
  );
}

async function salvarResposta(
  id_respondente:      number,
  id_pergunta_pesquisa: number,
  valor:               number,
  motivo:              string | null
) {
  await pool.query(
    `INSERT INTO tb_resposta_pesquisa
       (id_respondente, id_pergunta_pesquisa, valor, resposta_motivo, dh_inclusao)
     VALUES (?, ?, ?, ?, NOW())`,
    [id_respondente, id_pergunta_pesquisa, valor, motivo]
  );
}

async function avancarOuEncerrar(sessao: Sessao) {
  sessao.indice++;
  await sleep(DELAY_RESPOSTA);

  if (sessao.indice >= sessao.perguntas.length) {
    console.log(`[Pesquisa] Todas as perguntas respondidas por ${sessao.telefone}`);
    await sessao.enviar(
      sessao.telefone,
      '✅ Pesquisa concluída! Muito obrigado pela sua participação. 🙏'
    );
    encerrarSessao(sessao.telefone);
    return;
  }

  const proxima = sessao.perguntas[sessao.indice];
  console.log(`[Pesquisa] Enviando pergunta ${sessao.indice + 1}/${sessao.perguntas.length} para ${sessao.telefone}`);
  await sessao.enviar(sessao.telefone, formatarPergunta(proxima, sessao.indice, sessao.perguntas.length));
}

export function registrarLid(lid: string, telefone: string) {
  lidParaTelefone.set(lid, telefone);
  console.log(`[Pesquisa] Mapeamento @lid registrado: ${lid} → ${telefone}`);
}

export function encerrarSessao(telefone: string) {
  const s = sessoes.get(telefone);
  if (s) {
    clearTimeout(s.timer);
    sessoes.delete(telefone);
    // remove entradas @lid que apontavam para este telefone
    for (const [lid, tel] of lidParaTelefone) {
      if (tel === telefone) lidParaTelefone.delete(lid);
    }
    console.log(`[Pesquisa] Sessão removida para ${telefone}`);
  }
}

export function sessaoAtiva(telefone: string): boolean {
  return sessoes.has(telefone);
}

export async function processarMensagem(telefone: string, texto: string) {
  console.log(`[Pesquisa] Mensagem recebida de ${telefone}: "${texto}"`);

  // Resolve @lid → telefone real se necessário
  const chave = lidParaTelefone.get(telefone) ?? telefone;

  const sessao = sessoes.get(chave);
  if (!sessao) {
    console.log(`[Pesquisa] Nenhuma sessão ativa para ${chave} (sessões ativas: ${[...sessoes.keys()].join(', ') || 'nenhuma'})`);
    return;
  }

  try {
    const dest = sessao.telefone; // sempre usa o telefone real da sessão

    if (texto.toLowerCase() === 'sair') {
      await sessao.enviar(dest, '🚫 Pesquisa cancelada. Até a próxima!');
      encerrarSessao(dest);
      return;
    }

    const pergunta = sessao.perguntas[sessao.indice];
    console.log(`[Pesquisa] Pergunta atual: ${sessao.indice + 1}/${sessao.perguntas.length} — "${pergunta.nome}"`);

    // Aguardando texto do motivo
    if (sessao.aguardando_motivo) {
      await salvarResposta(sessao.id_respondente, pergunta.id_pergunta_pesquisa, sessao.valor_pendente!, texto);
      console.log(`[Pesquisa] Motivo salvo para ${dest}: "${texto}"`);
      sessao.aguardando_motivo = false;
      sessao.valor_pendente = null;
      await avancarOuEncerrar(sessao);
      return;
    }

    // Valida resposta numérica
    const valor = parseInt(texto, 10);
    if (isNaN(valor)) {
      await sleep(DELAY_RESPOSTA);
      await sessao.enviar(dest, `⚠️ Por favor, responda apenas com um número de *${pergunta.valor_min}* a *${pergunta.valor_max}*.`);
      return;
    }
    if (valor < pergunta.valor_min || valor > pergunta.valor_max) {
      await sleep(DELAY_RESPOSTA);
      await sessao.enviar(dest, `⚠️ Valor fora do intervalo. Digite entre *${pergunta.valor_min}* e *${pergunta.valor_max}*.`);
      return;
    }

    // Verifica se deve pedir motivo
    if (
      pergunta.sn_pergunta_motivo === 'S' &&
      pergunta.sn_regra_motivo &&
      regraAtiva(pergunta.sn_regra_motivo, valor, pergunta.sn_regra_valor_motivo)
    ) {
      sessao.aguardando_motivo = true;
      sessao.valor_pendente = valor;
      console.log(`[Pesquisa] Aguardando motivo de ${dest} (valor: ${valor})`);
      await sleep(DELAY_RESPOSTA);
      await sessao.enviar(dest, '✍️ Por favor, nos conte o motivo da sua avaliação:');
      return;
    }

    // Salva e avança
    await salvarResposta(sessao.id_respondente, pergunta.id_pergunta_pesquisa, valor, null);
    console.log(`[Pesquisa] Resposta salva — respondente: ${sessao.id_respondente}, pergunta: ${pergunta.id_pergunta_pesquisa}, valor: ${valor}`);
    await avancarOuEncerrar(sessao);

  } catch (err) {
    console.error(`[Pesquisa] Erro ao processar mensagem de ${sessao.telefone}:`, err);
    try {
      await sessao.enviar(sessao.telefone, '⚠️ Ocorreu um erro ao processar sua resposta. Tente novamente.');
    } catch {}
  }
}

export async function iniciarSessao(
  id_respondente:   number,
  id_grupo_pesquisa: number,
  enviar:           EnviarFn
): Promise<{ ok: boolean; message: string }> {

  // Busca respondente
  const [resp] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM tb_respondente WHERE id_respondente = ? LIMIT 1`,
    [id_respondente]
  );
  if (!resp.length) return { ok: false, message: 'Respondente não encontrado' };

  const respondente = resp[0];
  const telefone = String(respondente.telefone);

  if (sessoes.has(telefone)) {
    return { ok: false, message: 'Este respondente já tem uma pesquisa em andamento' };
  }

  // Busca perguntas ativas do grupo com dados do tipo
  const [perguntas] = await pool.query<RowDataPacket[]>(
    `SELECT p.*, t.nome AS tipo_nome, t.valor_min, t.valor_max
     FROM tb_pergunta_pesquisa p
     JOIN tb_tipo_pesquisa t ON t.id_tipo_pesquisa = p.id_tipo_pesquisa
     WHERE p.id_grupo_pesquisa = ? AND p.sn_ativo = 'S'
     ORDER BY p.id_pergunta_pesquisa`,
    [id_grupo_pesquisa]
  );
  if (!perguntas.length) return { ok: false, message: 'Nenhuma pergunta encontrada para este grupo' };

  // Timeout de 1 hora
  const timer = setTimeout(async () => {
    console.log(`[Pesquisa] Sessão expirada por inatividade — ${telefone}`);
    try {
      await enviar(telefone, '⏰ Sua pesquisa expirou por inatividade (1 hora). Solicite uma nova quando quiser.');
    } catch {}
    encerrarSessao(telefone);
  }, TIMEOUT_MS);

  const sessao: Sessao = {
    id_respondente,
    nome_respondente: respondente.nome,
    telefone,
    perguntas: perguntas as Pergunta[],
    indice: 0,
    aguardando_motivo: false,
    valor_pendente: null,
    enviar,
    timer,
  };

  sessoes.set(telefone, sessao);
  console.log(`[Pesquisa] Sessão iniciada — respondente: ${respondente.nome} (${telefone}), ${perguntas.length} pergunta(s)`);

  // Boas-vindas + primeira pergunta
  await enviar(telefone, `👋 Olá, *${respondente.nome}*! Você recebeu uma pesquisa de satisfação.\n\nResponda cada pergunta com um número. Digite *sair* a qualquer momento para cancelar.`);
  await enviar(telefone, formatarPergunta(sessao.perguntas[0], 0, sessao.perguntas.length));

  return { ok: true, message: `Pesquisa enviada para ${respondente.nome} (${telefone})` };
}
