import mysql from 'mysql2/promise';

const DB_NAME = 'scala_zap';

async function conectar() {
  return mysql.createConnection({
    host:     process.env.DB_HOST || 'localhost',
    port:     Number(process.env.DB_PORT || 3306),
    user:     process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    multipleStatements: true,
  });
}

export async function setup() {
  console.log('[Setup] Conectando ao MySQL...');
  const conn = await conectar();
  console.log(`[Setup] Conexão estabelecida — verificando banco "${DB_NAME}"...`);

  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?`,
    [DB_NAME]
  );

  if (rows.length > 0) {
    console.log(`[Setup] Banco "${DB_NAME}" já está configurado`);
    await conn.end();
    return;
  }

  console.log(`[Setup] Banco "${DB_NAME}" não encontrado — iniciando criação...`);

  await conn.query(`CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  console.log(`[Setup] Banco "${DB_NAME}" criado`);

  await conn.query(`USE \`${DB_NAME}\``);

  // ── Tabelas ──────────────────────────────────────────────────────────────

  console.log('[Setup] Criando tabelas...');

  await conn.query(`
    CREATE TABLE tb_usuario (
      id_usuario           INT AUTO_INCREMENT PRIMARY KEY,
      nome                 VARCHAR(150),
      email                VARCHAR(150),
      senha                VARCHAR(255),
      perfil               VARCHAR(10),
      sn_ativo             CHAR(1),
      id_usuario_inclusao  INT,
      dh_inclusao          DATETIME,
      id_usuario_alteracao INT,
      dh_alteracao         DATETIME
    )
  `);
  console.log('[Setup]   ✔ tb_usuario');

  await conn.query(`
    CREATE TABLE tb_empresa (
      id_empresa           INT AUTO_INCREMENT PRIMARY KEY,
      nome                 VARCHAR(150),
      cnpj                 VARCHAR(20),
      sn_ativo             CHAR(1),
      id_usuario_inclusao  INT,
      dh_inclusao          DATETIME,
      id_usuario_alteracao INT,
      dh_alteracao         DATETIME
    )
  `);
  console.log('[Setup]   ✔ tb_empresa');

  await conn.query(`
    CREATE TABLE tb_respondente (
      id_respondente       INT AUTO_INCREMENT PRIMARY KEY,
      nome                 VARCHAR(150),
      telefone             BIGINT,
      id_externo           INT,
      id_usuario_inclusao  INT,
      dh_inclusao          DATETIME,
      id_usuario_alteracao INT,
      dh_alteracao         DATETIME
    )
  `);
  console.log('[Setup]   ✔ tb_respondente');

  await conn.query(`
    CREATE TABLE tb_tipo_pesquisa (
      id_tipo_pesquisa     INT AUTO_INCREMENT PRIMARY KEY,
      nome                 VARCHAR(150),
      valor_min            INT,
      valor_max            INT,
      sn_ativo             CHAR(1),
      id_usuario_inclusao  INT,
      dh_inclusao          DATETIME,
      id_usuario_alteracao INT,
      dh_alteracao         DATETIME
    )
  `);
  console.log('[Setup]   ✔ tb_tipo_pesquisa');

  await conn.query(`
    CREATE TABLE tb_grupo_pesquisa (
      id_grupo_pesquisa    INT AUTO_INCREMENT PRIMARY KEY,
      nome                 VARCHAR(150),
      sn_ativo             CHAR(1),
      id_usuario_inclusao  INT,
      dh_inclusao          DATETIME,
      id_usuario_alteracao INT,
      dh_alteracao         DATETIME
    )
  `);
  console.log('[Setup]   ✔ tb_grupo_pesquisa');

  await conn.query(`
    CREATE TABLE tb_pergunta_pesquisa (
      id_pergunta_pesquisa  INT AUTO_INCREMENT PRIMARY KEY,
      id_grupo_pesquisa     INT,
      id_tipo_pesquisa      INT,
      nome                  VARCHAR(150),
      sn_pergunta_motivo    CHAR(1),
      sn_regra_motivo       CHAR(3),
      sn_regra_valor_motivo INT,
      sn_ativo              CHAR(1),
      id_usuario_inclusao   INT,
      dh_inclusao           DATETIME,
      id_usuario_alteracao  INT,
      dh_alteracao          DATETIME
    )
  `);
  console.log('[Setup]   ✔ tb_pergunta_pesquisa');

  await conn.query(`
    CREATE TABLE tb_resposta_pesquisa (
      id_resposta_pesquisa  INT AUTO_INCREMENT PRIMARY KEY,
      id_respondente        INT,
      id_pergunta_pesquisa  INT,
      valor                 INT,
      resposta_motivo       VARCHAR(150),
      id_usuario_inclusao   INT,
      dh_inclusao           DATETIME,
      id_usuario_alteracao  INT,
      dh_alteracao          DATETIME
    )
  `);
  console.log('[Setup]   ✔ tb_resposta_pesquisa');

  // ── Dados padrão ─────────────────────────────────────────────────────────

  console.log('[Setup] Inserindo dados padrão...');
  const agora = new Date();

  await conn.query(`
    INSERT INTO tb_usuario (nome, email, senha, perfil, sn_ativo, dh_inclusao)
    VALUES ('Administrador', 'admin@scalazap.com', '', 'ADMIN', 'S', ?)
  `, [agora]);
  console.log('[Setup]   ✔ Usuário admin (admin@scalazap.com)');

  await conn.query(`
    INSERT INTO tb_empresa (nome, cnpj, sn_ativo, id_usuario_inclusao, dh_inclusao)
    VALUES ('Empresa Padrão', '', 'S', 1, ?)
  `, [agora]);
  console.log('[Setup]   ✔ Empresa padrão');

  await conn.query(`
    INSERT INTO tb_respondente (nome, telefone, id_usuario_inclusao, dh_inclusao)
    VALUES ('Respondente Padrão', 5512981428757, 1, ?)
  `, [agora]);
  console.log('[Setup]   ✔ Respondente padrão (tel: 5512981428757)');

  await conn.query(`
    INSERT INTO tb_tipo_pesquisa (nome, valor_min, valor_max, sn_ativo, id_usuario_inclusao, dh_inclusao)
    VALUES
      ('NPS',  0, 10, 'S', 1, ?),
      ('CSAT', 1,  5, 'S', 1, ?)
  `, [agora, agora]);
  console.log('[Setup]   ✔ Tipos de pesquisa: NPS (0-10), CSAT (1-5)');

  await conn.query(`
    INSERT INTO tb_grupo_pesquisa (nome, sn_ativo, id_usuario_inclusao, dh_inclusao)
    VALUES ('Grupo Padrão', 'S', 1, ?)
  `, [agora]);
  console.log('[Setup]   ✔ Grupo de pesquisa padrão');

  await conn.query(`
    INSERT INTO tb_pergunta_pesquisa
      (id_grupo_pesquisa, id_tipo_pesquisa, nome, sn_pergunta_motivo, sn_regra_motivo, sn_regra_valor_motivo, sn_ativo, id_usuario_inclusao, dh_inclusao)
    VALUES
      (1, 1, 'Qual a probabilidade de recomendar nosso serviço?',    'S', 'MEI', 5, 'S', 1, ?),
      (1, 1, 'Como você avalia nossa equipe de atendimento?',        'S', 'MEI', 5, 'S', 1, ?),
      (1, 2, 'Qual seu nível de satisfação com o produto recebido?', 'S', 'MEI', 2, 'S', 1, ?)
  `, [agora, agora, agora]);
  console.log('[Setup]   ✔ Perguntas: 2x NPS, 1x CSAT (regra motivo: valor <= 5)');

  await conn.end();
  console.log('[Setup] Concluído com sucesso!');
}
