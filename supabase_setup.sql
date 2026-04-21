-- ============================================================
--  DP Gestão – Script de criação de tabelas no Supabase
--  Cole e execute no SQL Editor do Supabase
-- ============================================================

-- ─── 1. EMPLOYEES ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employees (
  id        SERIAL PRIMARY KEY,
  nome      TEXT    NOT NULL DEFAULT '',
  cargo     TEXT    NOT NULL DEFAULT '',
  cpf       TEXT    NOT NULL DEFAULT '',
  nasc      TEXT    NOT NULL DEFAULT '',   -- data de nascimento
  tel       TEXT    NOT NULL DEFAULT '',
  tel2      TEXT    NOT NULL DEFAULT '',
  email     TEXT    NOT NULL DEFAULT '',
  senha     TEXT    NOT NULL DEFAULT '',   -- hash bcrypt
  sexo      TEXT    NOT NULL DEFAULT '',
  estado    TEXT    NOT NULL DEFAULT '',
  dept      TEXT    NOT NULL DEFAULT '',   -- departamento
  adm       TEXT    NOT NULL DEFAULT '',   -- data de admissão
  contrato  TEXT    NOT NULL DEFAULT '',
  empresa   TEXT    NOT NULL DEFAULT '',
  mae       TEXT    NOT NULL DEFAULT '',   -- nome da mãe
  pai       TEXT    NOT NULL DEFAULT '',   -- nome do pai
  en        TEXT    NOT NULL DEFAULT '',   -- endereço (rua/número)
  ep        TEXT    NOT NULL DEFAULT '',   -- endereço (CEP)
  et        TEXT    NOT NULL DEFAULT '',   -- endereço (tipo)
  ew        TEXT    NOT NULL DEFAULT '',   -- endereço (complemento)
  foto      TEXT    NOT NULL DEFAULT '',   -- URL ou base64
  role      TEXT    NOT NULL DEFAULT 'funcionario', -- 'admin' | 'funcionario'
  status    TEXT    NOT NULL DEFAULT 'ativo',        -- 'ativo' | 'inativo' | 'pendente'
  av        INTEGER NOT NULL DEFAULT 0               -- índice do avatar (0-5)
);

-- ─── 2. ATESTADOS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS atestados (
  id            SERIAL PRIMARY KEY,
  emp_id        INTEGER NOT NULL DEFAULT 0,
  emp_nome      TEXT    NOT NULL DEFAULT '',
  tipo          TEXT    NOT NULL DEFAULT 'Atestado médico',
  data_emissao  TEXT    NOT NULL DEFAULT '',
  obs           TEXT    NOT NULL DEFAULT '',
  file_url      TEXT    NOT NULL DEFAULT '',   -- caminho do arquivo
  file_name     TEXT    NOT NULL DEFAULT '',
  status        TEXT    NOT NULL DEFAULT 'pendente', -- 'pendente' | 'aprovado' | 'recusado'
  envio_date    TEXT    NOT NULL DEFAULT '',
  motivo_recusa TEXT    NOT NULL DEFAULT '',
  notif_lida    BOOLEAN NOT NULL DEFAULT false
);

-- ─── 3. DOCUMENTOS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documentos (
  id        SERIAL PRIMARY KEY,
  emp_id    INTEGER NOT NULL DEFAULT 0,
  emp_nome  TEXT    NOT NULL DEFAULT '',
  tipo      TEXT    NOT NULL DEFAULT '',
  nome      TEXT    NOT NULL DEFAULT '',
  file_url  TEXT    NOT NULL DEFAULT '',
  file_name TEXT    NOT NULL DEFAULT '',
  data      TEXT    NOT NULL DEFAULT ''
);

-- ─── 4. EMPRESAS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS empresas (
  id    SERIAL PRIMARY KEY,
  nome  TEXT NOT NULL DEFAULT '',
  cnpj  TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  tel   TEXT NOT NULL DEFAULT '',
  end_  TEXT NOT NULL DEFAULT ''   -- "end" é palavra reservada no SQL, usamos end_
);

-- ─── 5. AVISOS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS avisos (
  id     SERIAL PRIMARY KEY,
  titulo TEXT NOT NULL DEFAULT '',
  msg    TEXT NOT NULL DEFAULT '',
  data   TEXT NOT NULL DEFAULT ''
);

-- ─── 6. COMUNICADOS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comunicados (
  id     SERIAL PRIMARY KEY,
  titulo TEXT NOT NULL DEFAULT '',
  msg    TEXT NOT NULL DEFAULT '',
  dest   TEXT NOT NULL DEFAULT '',  -- destinatário (ex: "todos", "setor X")
  ch     TEXT NOT NULL DEFAULT 'wz', -- canal: 'wz' (WhatsApp) | 'email'
  data   TEXT NOT NULL DEFAULT ''
);

-- ─── 7. CONFIG ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

-- ─── 8. FÉRIAS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ferias (
  id               SERIAL PRIMARY KEY,
  emp_id           INTEGER NOT NULL DEFAULT 0,
  emp_nome         TEXT    NOT NULL DEFAULT '',
  periodo_aqui_ini TEXT    NOT NULL DEFAULT '',
  periodo_aqui_fim TEXT    NOT NULL DEFAULT '',
  ferias_ini       TEXT    NOT NULL DEFAULT '',
  ferias_fim       TEXT    NOT NULL DEFAULT '',
  dias             INTEGER NOT NULL DEFAULT 30,
  dias_vendidos    INTEGER NOT NULL DEFAULT 0,
  status           TEXT    NOT NULL DEFAULT 'pendente',
  obs              TEXT    NOT NULL DEFAULT '',
  created_at       TEXT    NOT NULL DEFAULT ''
);

-- ─── Desabilitar RLS em todas as tabelas ──────────────────────
-- Necessário para o backend acessar via anon key sem restrições
ALTER TABLE employees   DISABLE ROW LEVEL SECURITY;
ALTER TABLE atestados   DISABLE ROW LEVEL SECURITY;
ALTER TABLE documentos  DISABLE ROW LEVEL SECURITY;
ALTER TABLE empresas    DISABLE ROW LEVEL SECURITY;
ALTER TABLE avisos      DISABLE ROW LEVEL SECURITY;
ALTER TABLE comunicados DISABLE ROW LEVEL SECURITY;
ALTER TABLE config      DISABLE ROW LEVEL SECURITY;
ALTER TABLE ferias      DISABLE ROW LEVEL SECURITY;

-- ─── Dados iniciais de configuração ───────────────────────────
INSERT INTO config (key, value) VALUES
  ('empresa',        'Minha Empresa'),
  ('prazoHoras',     '48'),
  ('jornada',        '44'),
  ('notifWZ',        'true'),
  ('notifEmail',     'true'),
  ('googleClientId', ''),
  ('appleServiceId', '')
ON CONFLICT (key) DO NOTHING;

-- ─── Admin padrão ─────────────────────────────────────────────
-- ATENÇÃO: só execute este INSERT se ainda NÃO tiver um admin cadastrado.
-- Se você já migrou os dados anteriormente, pule esta parte.
--
-- Para inserir um admin com senha "admin123", execute o bloco abaixo
-- depois de gerar o hash correto rodando no terminal do projeto:
--
--   node -e "const b=require('bcryptjs');b.hash('admin123',10).then(h=>console.log(h))"
--
-- Depois substitua <HASH_AQUI> pelo resultado e execute:
--
-- INSERT INTO employees (nome, cargo, email, senha, role, status, av)
-- VALUES ('Administrador', 'Admin', 'admin@dpgestao.com', '<HASH_AQUI>', 'admin', 'ativo', 0)
-- ON CONFLICT DO NOTHING;
