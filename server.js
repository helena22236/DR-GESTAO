'use strict';

const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');
const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const path     = require('path');
const fs       = require('fs');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const multer   = require('multer');

const app = express();
const PORT       = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dp-gestao-secret-2024-xK9mP';

// ─── Supabase ─────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://kxvjrqboqyttzbedjyjz.supabase.co';
const SUPABASE_KEY  = process.env.SUPABASE_KEY  || '';
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

const mailer = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER || '3bgestao@gmail.com',
    pass: process.env.GMAIL_PASS || ''
  }
});

async function enviarEmail(to, subject, html) {
  try {
    await mailer.sendMail({
      from: '"3B Gestão" <3bgestao@gmail.com>',
      to, subject, html
    });
    return true;
  } catch(e) {
    console.error('Erro ao enviar email para', to, e.message);
    return false;
  }
}

async function dbGet(table, filters) {
  let q = db.from(table).select('*');
  if (filters) Object.entries(filters).forEach(([k, v]) => { q = q.eq(k, v); });
  const { data, error } = await q.limit(1).single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}
async function dbAll(table, filters, order) {
  let q = db.from(table).select('*');
  if (filters) Object.entries(filters).forEach(([k, v]) => { q = q.eq(k, v); });
  if (order) q = q.order(order.col, { ascending: order.asc });
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}
async function dbInsert(table, row) {
  const { data, error } = await db.from(table).insert(row).select().single();
  if (error) throw error;
  return data;
}
async function dbUpdate(table, row, filters) {
  let q = db.from(table).update(row);
  Object.entries(filters).forEach(([k, v]) => { q = q.eq(k, v); });
  const { data, error } = await q.select().single();
  if (error) throw error;
  return data;
}
async function dbDelete(table, filters) {
  let q = db.from(table).delete();
  Object.entries(filters).forEach(([k, v]) => { q = q.eq(k, v); });
  const { error } = await q;
  if (error) throw error;
}
async function dbCount(table) {
  const { count, error } = await db.from(table).select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count || 0;
}
async function dbUpsert(table, row, onConflict) {
  const { error } = await db.from(table).upsert(row, { onConflict });
  if (error) throw error;
}

// ─── Diretórios de upload ─────────────────────────────────────────────────
// No Vercel o filesystem é somente leitura — usa /tmp
const isVercel    = !!process.env.VERCEL;
const UPLOADS_DIR = isVercel ? '/tmp/uploads'           : path.join(__dirname, 'uploads');
const ATES_DIR    = isVercel ? '/tmp/uploads/atestados' : path.join(__dirname, 'uploads', 'atestados');
const DOCS_DIR    = isVercel ? '/tmp/uploads/documentos': path.join(__dirname, 'uploads', 'documentos');
[UPLOADS_DIR, ATES_DIR, DOCS_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ─── Multer (memória — base64 salvo no Supabase, sem depender do /tmp) ────
const memStorage = multer.memoryStorage();
const uploadAtes = multer({ storage: memStorage, limits: { fileSize: 20 * 1024 * 1024 } });
const uploadDocs = multer({ storage: memStorage, limits: { fileSize: 20 * 1024 * 1024 } });

function toDataURL(file) {
  if (!file) return '';
  return 'data:' + file.mimetype + ';base64,' + file.buffer.toString('base64');
}

// ─── Security Headers (Helmet) ────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,     // CSP desativado — app usa inline JS/CSS extensivamente
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false    // necessário para o popup do Google Sign-In funcionar
}));

// ─── CORS ─────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://dr-gestao.vercel.app',
  'https://dr-gestao-git-main-ramonmarcaambiental-4586s-projects.vercel.app',
  'http://localhost:3000'
];
app.use(cors({
  origin: (origin, cb) => {
    // Permite requisições sem origin (ex: Postman, mobile) e origens permitidas
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('Bloqueado pelo CORS'));
  },
  credentials: true
}));

// ─── Middleware ────────────────────────────────────────────────────────────
app.use(express.json({ limit: '30mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(__dirname));

// ─── Auth helpers ──────────────────────────────────────────────────────────
function signToken(emp) {
  return jwt.sign(
    { id: emp.id, role: emp.role, nome: emp.nome, email: emp.email || '' },
    JWT_SECRET, { expiresIn: '30d' }
  );
}
function authMiddleware(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return res.status(401).json({ message: 'Não autenticado', code: 'UNAUTH' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ message: 'Token inválido', code: 'UNAUTH' }); }
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin')
    return res.status(403).json({ message: 'Acesso restrito' });
  next();
}
function empToObj(r) {
  if (!r) return null;
  return {
    id: r.id, nome: r.nome, cargo: r.cargo || '', cpf: r.cpf || '',
    nasc: r.nasc || '', tel: r.tel || '', tel2: r.tel2 || '', email: r.email || '',
    sexo: r.sexo || '', estado: r.estado || '', dept: r.dept || '', adm: r.adm || '',
    contrato: r.contrato || '', empresa: r.empresa || '', mae: r.mae || '',
    pai: r.pai || '', en: r.en || '', ep: r.ep || '', et: r.et || '', ew: r.ew || '',
    foto: r.foto || '', role: r.role || 'funcionario', status: r.status || 'ativo',
    av: r.av || 0
  };
}

// ─── Validação de CPF ─────────────────────────────────────────────────────
function validarCPF(cpf) {
  const c = cpf.replace(/\D/g, '');
  if (c.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(c)) return false; // ex: 111.111.111-11
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(c[i]) * (10 - i);
  let r = (soma * 10) % 11;
  if (r === 10 || r === 11) r = 0;
  if (r !== parseInt(c[9])) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(c[i]) * (11 - i);
  r = (soma * 10) % 11;
  if (r === 10 || r === 11) r = 0;
  return r === parseInt(c[10]);
}

// ─── AUTH ─────────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { login, senha } = req.body || {};
    if (!login || !senha) return res.status(400).json({ message: 'Preencha todos os campos' });
    const lo = login.toLowerCase().trim();
    const cpfDigits = login.replace(/\D/g, '');

    let { data: emp } = await db.from('employees').select('*').ilike('email', lo).limit(1).single();
    if (!emp && cpfDigits.length === 11) {
      const { data: all } = await db.from('employees').select('*').neq('cpf', '');
      emp = (all || []).find(e => e.cpf.replace(/\D/g, '') === cpfDigits) || null;
    }
    if (!emp) return res.status(401).json({ message: 'E-mail/CPF ou senha incorretos', code: 'WRONG' });
    if (emp.status === 'inativo')  return res.status(403).json({ message: 'Acesso bloqueado', code: 'INATIVO' });
    if (emp.status === 'pendente') return res.status(403).json({ message: 'Aguardando aprovação', code: 'PENDENTE' });

    const ok = await bcrypt.compare(senha, emp.senha);
    if (!ok) return res.status(401).json({ message: 'E-mail/CPF ou senha incorretos', code: 'WRONG' });

    res.json({ token: signToken(emp), user: { id: emp.id, nome: emp.nome, role: emp.role, email: emp.email } });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

app.post('/api/auth/login-social', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ message: 'E-mail necessário' });
    const { data: emp } = await db.from('employees').select('*').ilike('email', email).limit(1).maybeSingle();
    if (!emp)                      return res.status(404).json({ message: 'Conta não encontrada', code: 'NOT_FOUND' });
    if (emp.status === 'inativo')  return res.status(403).json({ message: 'Acesso bloqueado', code: 'INATIVO' });
    if (emp.status === 'pendente') return res.status(403).json({ message: 'Aguardando aprovação', code: 'PENDENTE' });
    res.json({ token: signToken(emp), user: { id: emp.id, nome: emp.nome, role: emp.role, email: emp.email } });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

app.post('/api/auth/register-google', async (req, res) => {
  try {
    const { email, nome, cpf, tel, nasc } = req.body || {};
    if (!nome || !cpf || !email || !tel || !nasc)
      return res.status(400).json({ message: 'Preencha todos os campos obrigatórios.' });
    if (!validarCPF(cpf.replace(/\D/g,'')))
      return res.status(400).json({ message: 'CPF inválido.' });
    const { data: exists } = await db.from('employees').select('id')
      .or(`email.ilike.${email},cpf.eq.${cpf.replace(/\D/g,'')}`).limit(1).maybeSingle();
    if (exists) return res.status(409).json({ message: 'E-mail ou CPF já cadastrado.' });
    const count = await dbCount('employees');
    await dbInsert('employees', {
      nome: nome.toUpperCase(), cpf: cpf.replace(/\D/g,''), email: email.toLowerCase(),
      senha: '', tel, nasc,
      role: count === 0 ? 'admin' : 'funcionario',
      status: count === 0 ? 'ativo' : 'pendente',
      cargo: '', sexo: '', estado: '', dept: '', adm: '', contrato: '',
      empresa: '', mae: '', pai: '', en: '', ep: '', et: '', ew: '', foto: '', av: 0
    });
    res.json({ success: true });
  } catch(e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

app.get('/api/config/public', async (req, res) => {
  try {
    const rows = await dbAll('config');
    const cfg = {};
    rows.forEach(r => { cfg[r.key] = r.value; });
    res.json({ googleClientId: cfg.googleClientId || '' });
  } catch(e) { res.json({ googleClientId: '' }); }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const emp = await dbGet('employees', { id: req.user.id });
    if (!emp || emp.status === 'inativo')
      return res.status(403).json({ message: 'Acesso negado', code: 'INATIVO' });
    res.json({ user: { id: emp.id, nome: emp.nome, role: emp.role, email: emp.email } });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { nome, cpf, email, senha, nasc, tel, sexo, estado, dept, adm,
            contrato, empresa, mae, pai, en, ep, et, ew, cargo } = req.body || {};
    if (!nome || !cpf || !email || !senha)
      return res.status(400).json({ message: 'Dados obrigatórios faltando' });
    if (!validarCPF(cpf))
      return res.status(400).json({ message: 'CPF inválido' });
    const { data: exists } = await db.from('employees').select('id')
      .or(`email.ilike.${email},cpf.eq.${cpf}`).limit(1).maybeSingle();
    if (exists) return res.status(409).json({ message: 'E-mail ou CPF já cadastrado' });
    const hash = await bcrypt.hash(senha, 10);
    const count = await dbCount('employees');
    await dbInsert('employees', {
      nome, cargo: cargo||'', cpf, nasc: nasc||'', tel: tel||'', email, senha: hash,
      sexo: sexo||'', estado: estado||'', dept: dept||'', adm: adm||'',
      contrato: contrato||'', empresa: empresa||'', mae: mae||'', pai: pai||'',
      en: en||'', ep: ep||'', et: et||'', ew: ew||'', av: count % 6,
      status: 'pendente', role: 'funcionario'
    });
    res.json({ message: 'Cadastro realizado! Aguarde aprovação.' });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

// ─── EMPLOYEES ────────────────────────────────────────────────────────────
app.get('/api/employees', authMiddleware, async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      const rows = await dbAll('employees', null, { col: 'id', asc: true });
      return res.json(rows.map(empToObj));
    }
    const emp = await dbGet('employees', { id: req.user.id });
    res.json(emp ? [empToObj(emp)] : []);
  } catch (e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

app.post('/api/employees', authMiddleware, adminOnly, async (req, res) => {
  try {
    const d = req.body || {};
    if (!d.nome) return res.status(400).json({ message: 'Nome obrigatório' });
    let hash = '';
    if (d.senha && d.senha.length >= 6) hash = await bcrypt.hash(d.senha, 10);
    const count = await dbCount('employees');
    const row = await dbInsert('employees', {
      nome: d.nome, cargo: d.cargo||'', cpf: d.cpf||'', nasc: d.nasc||'',
      tel: d.tel||'', tel2: d.tel2||'', email: d.email||'', senha: hash,
      sexo: d.sexo||'', estado: d.estado||'', dept: d.dept||'', adm: d.adm||'',
      contrato: d.contrato||'', empresa: d.empresa||'', mae: d.mae||'', pai: d.pai||'',
      en: d.en||'', ep: d.ep||'', et: d.et||'', ew: d.ew||'', foto: d.foto||'',
      role: d.role||'funcionario', status: d.status||'ativo', av: count % 6
    });
    res.json(empToObj(row));
  } catch (e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

app.put('/api/employees/:id', authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id);
  if (req.user.role !== 'admin' && req.user.id !== id)
    return res.status(403).json({ message: 'Acesso negado' });
  try {
    const d = req.body || {};
    const cur = await dbGet('employees', { id });
    if (!cur) return res.status(404).json({ message: 'Funcionário não encontrado' });
    let hash = cur.senha;
    if (d.senha && d.senha.length >= 6) hash = await bcrypt.hash(d.senha, 10);
    const row = await dbUpdate('employees', {
      nome: d.nome??cur.nome, cargo: d.cargo??cur.cargo, cpf: d.cpf??cur.cpf,
      nasc: d.nasc??cur.nasc, tel: d.tel??cur.tel, tel2: d.tel2??cur.tel2,
      email: d.email??cur.email, senha: hash, sexo: d.sexo??cur.sexo,
      estado: d.estado??cur.estado, dept: d.dept??cur.dept, adm: d.adm??cur.adm,
      contrato: d.contrato??cur.contrato, empresa: d.empresa??cur.empresa,
      mae: d.mae??cur.mae, pai: d.pai??cur.pai, en: d.en??cur.en, ep: d.ep??cur.ep,
      et: d.et??cur.et, ew: d.ew??cur.ew, foto: d.foto??cur.foto,
      role: d.role??cur.role, status: d.status??cur.status
    }, { id });
    res.json(empToObj(row));
  } catch (e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

app.delete('/api/employees/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const row = await dbGet('employees', { id });
    if (row) await moverParaLixeira('funcionario', row, req.user.nome || req.user.email || '');
    await dbDelete('employees', { id });
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

// ─── ATESTADOS ────────────────────────────────────────────────────────────
function ateToObj(r) {
  return {
    id: r.id, empId: r.emp_id, empNome: r.emp_nome, tipo: r.tipo,
    dataEmissao: r.data_emissao, obs: r.obs,
    fileBase64: r.file_url, fileName: r.file_name,
    status: r.status, envioDate: r.envio_date,
    motivoRecusa: r.motivo_recusa || '', notifLida: r.notif_lida || false
  };
}

app.get('/api/atestados', authMiddleware, async (req, res) => {
  try {
    const rows = req.user.role === 'admin'
      ? await dbAll('atestados', null, { col: 'id', asc: false })
      : await dbAll('atestados', { emp_id: req.user.id }, { col: 'id', asc: false });
    res.json(rows.map(ateToObj));
  } catch (e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

app.post('/api/atestados', authMiddleware, uploadAtes.single('file'), async (req, res) => {
  try {
    const { empId, tipo, dataEmissao, obs } = req.body || {};
    const finalId = req.user.role === 'admin' ? parseInt(empId) : req.user.id;
    const emp = await dbGet('employees', { id: finalId });
    const fileUrl  = req.file ? toDataURL(req.file) : '';
    const fileName = req.file ? req.file.originalname : '';
    const today    = new Date().toISOString().split('T')[0];
    const row = await dbInsert('atestados', {
      emp_id: finalId, emp_nome: emp ? emp.nome : '—',
      tipo: tipo||'Atestado médico', data_emissao: dataEmissao||'',
      obs: obs||'', file_url: fileUrl, file_name: fileName,
      status: 'pendente', envio_date: today
    });
    res.json(ateToObj(row));
  } catch (e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

app.put('/api/atestados/:id/status', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { status, motivo_recusa } = req.body || {};
    if (!['aprovado','recusado','pendente'].includes(status))
      return res.status(400).json({ message: 'Status inválido' });
    const upd = { status };
    if (status === 'recusado') { upd.motivo_recusa = motivo_recusa || ''; upd.notif_lida = false; }
    await dbUpdate('atestados', upd, { id: parseInt(req.params.id) });

    // Envia email de notificação ao funcionário se recusado
    if (status === 'recusado') {
      const ates = await dbGet('atestados', { id: parseInt(req.params.id) });
      if (ates && ates.emp_id) {
        const emp = await dbGet('employees', { id: ates.emp_id });
        if (emp && emp.email && emp.email.includes('@')) {
          const html = `<div style="font-family:sans-serif;max-width:600px;margin:auto;background:#f8fafc;padding:32px;border-radius:12px">
            <div style="background:#7f1d1d;padding:20px 24px;border-radius:8px;margin-bottom:24px">
              <h2 style="color:#fff;margin:0;font-size:18px">❌ Atestado Recusado</h2>
            </div>
            <p style="color:#334155;font-size:15px">Olá, <strong>${emp.nome}</strong>.</p>
            <p style="color:#334155;font-size:15px">Seu atestado do tipo <strong>${ates.tipo}</strong> foi recusado.</p>
            <div style="background:#fee2e2;border-left:4px solid #ef4444;padding:12px 16px;border-radius:6px;margin:20px 0">
              <p style="color:#991b1b;margin:0;font-size:14px"><strong>Motivo:</strong> ${motivo_recusa}</p>
            </div>
            <p style="color:#64748b;font-size:13px">Acesse o sistema para mais detalhes ou envie um novo atestado.</p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
            <p style="color:#94a3b8;font-size:12px">3B Gestão — Sistema de Gestão de Pessoal</p>
          </div>`;
          await enviarEmail(emp.email, 'Atestado recusado — ' + ates.tipo, html);
        }
      }
    }
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

app.put('/api/atestados/:id/notif-lida', authMiddleware, async (req, res) => {
  try {
    await dbUpdate('atestados', { notif_lida: true }, { id: parseInt(req.params.id) });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ message: 'Erro interno' }); }
});

app.delete('/api/atestados/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const row = await dbGet('atestados', { id });
    if (row) await moverParaLixeira('atestado', row, req.user.nome || req.user.email || '');
    await dbDelete('atestados', { id });
    res.json({ success: true });
  } catch(e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

// ─── FÉRIAS ───────────────────────────────────────────────────────────────
function feriasToObj(r) {
  return {
    id: r.id, empId: r.emp_id, empNome: r.emp_nome,
    periodoAquiIni: r.periodo_aqui_ini||'', periodoAquiFim: r.periodo_aqui_fim||'',
    ferIni: r.ferias_ini||'', ferFim: r.ferias_fim||'',
    dias: r.dias||30, diasVendidos: r.dias_vendidos||0,
    empresa: r.empresa||'', visto: !!r.visto,
    status: r.status||'pendente', obs: r.obs||'', createdAt: r.created_at||''
  };
}

app.get('/api/ferias', authMiddleware, async (req, res) => {
  try {
    const rows = req.user.role === 'admin'
      ? await dbAll('ferias', null, { col: 'id', asc: false })
      : await dbAll('ferias', { emp_id: req.user.id }, { col: 'id', asc: false });
    res.json(rows.map(feriasToObj));
  } catch(e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

app.post('/api/ferias', authMiddleware, async (req, res) => {
  try {
    const { empId, periodoAquiIni, periodoAquiFim, ferIni, ferFim, dias, diasVendidos, empresa, obs } = req.body || {};
    const finalId = req.user.role === 'admin' ? (empId || req.user.id) : req.user.id;
    const emp = await dbGet('employees', { id: finalId });
    const today = new Date().toISOString().split('T')[0];
    const row = await dbInsert('ferias', {
      emp_id: finalId, emp_nome: emp ? emp.nome : '—',
      periodo_aqui_ini: periodoAquiIni||'', periodo_aqui_fim: periodoAquiFim||'',
      ferias_ini: ferIni||'', ferias_fim: ferFim||'',
      dias: dias||30, dias_vendidos: diasVendidos||0,
      empresa: empresa||'',
      status: 'pendente', obs: obs||'', created_at: today
    });
    res.json(feriasToObj(row));
  } catch(e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

app.delete('/api/ferias/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const row = await dbGet('ferias', { id });
    if (row) await moverParaLixeira('ferias', row, req.user.nome || req.user.email || '');
    await dbDelete('ferias', { id });
    res.json({ success: true });
  } catch(e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

app.put('/api/ferias/:id/visto', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const row = await dbGet('ferias', { id });
    if (!row) return res.status(404).json({ message: 'Não encontrado' });
    if (req.user.role !== 'admin' && row.emp_id !== req.user.id)
      return res.status(403).json({ message: 'Sem permissão' });
    await dbUpdate('ferias', { visto: true }, { id });
    res.json({ success: true });
  } catch(e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

app.put('/api/ferias/:id/editar', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { periodoAquiIni, periodoAquiFim, ferIni, ferFim, dias, empresa, obs } = req.body || {};
    await dbUpdate('ferias', {
      periodo_aqui_ini: periodoAquiIni||'', periodo_aqui_fim: periodoAquiFim||'',
      ferias_ini: ferIni||'', ferias_fim: ferFim||'',
      dias: dias||30, empresa: empresa||'', obs: obs||''
    }, { id: parseInt(req.params.id) });
    res.json({ success: true });
  } catch(e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

app.put('/api/ferias/:id/status', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { status, obs } = req.body || {};
    const valid = ['pendente','aprovado','em_andamento','concluido','recusado'];
    if (!valid.includes(status)) return res.status(400).json({ message: 'Status inválido' });
    const upd = { status };
    if (obs !== undefined) upd.obs = obs;
    await dbUpdate('ferias', upd, { id: parseInt(req.params.id) });
    res.json({ success: true });
  } catch(e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

// ─── DOCUMENTOS ───────────────────────────────────────────────────────────
function docToObj(r) {
  return {
    id: r.id, empId: r.emp_id, empNome: r.emp_nome, tipo: r.tipo,
    nome: r.nome, fileBase64: r.file_url, fileName: r.file_name, data: r.data
  };
}

app.get('/api/documentos', authMiddleware, async (req, res) => {
  try {
    const rows = req.user.role === 'admin'
      ? await dbAll('documentos', null, { col: 'id', asc: false })
      : await dbAll('documentos', { emp_id: req.user.id }, { col: 'id', asc: false });
    res.json(rows.map(docToObj));
  } catch (e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

app.post('/api/documentos', authMiddleware, adminOnly, uploadDocs.single('file'), async (req, res) => {
  try {
    const { empId, tipo, nome, data } = req.body || {};
    const emp = await dbGet('employees', { id: parseInt(empId) });
    const fileUrl  = req.file ? toDataURL(req.file) : '';
    const fileName = req.file ? req.file.originalname : '';
    const today    = data || new Date().toISOString().split('T')[0];
    const row = await dbInsert('documentos', {
      emp_id: parseInt(empId), emp_nome: emp ? emp.nome : '—',
      tipo: tipo||'', nome: nome||'', file_url: fileUrl, file_name: fileName, data: today
    });
    res.json(docToObj(row));
  } catch (e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

app.delete('/api/documentos/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const row = await dbGet('documentos', { id });
    if (row) await moverParaLixeira('documento', row, req.user.nome || req.user.email || '');
    await dbDelete('documentos', { id });
    res.json({ success: true });
  } catch(e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

// ─── EMPRESAS ────────────────────────────────────────────────────────────
app.get('/api/empresas', authMiddleware, async (req, res) => {
  try {
    const rows = await dbAll('empresas', null, { col: 'id', asc: true });
    res.json(rows.map(r => ({ id: r.id, nome: r.nome, cnpj: r.cnpj, email: r.email, tel: r.tel, end: r.end_ })));
  } catch (e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

app.post('/api/empresas', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { nome, cnpj, email, tel, end } = req.body || {};
    if (!nome) return res.status(400).json({ message: 'Nome obrigatório' });
    const row = await dbInsert('empresas', { nome, cnpj: cnpj||'', email: email||'', tel: tel||'', end_: end||'' });
    res.json({ id: row.id, nome, cnpj: cnpj||'', email: email||'', tel: tel||'', end: end||'' });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

app.put('/api/empresas/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { nome, cnpj, email, tel, end } = req.body || {};
    if (!nome) return res.status(400).json({ message: 'Nome obrigatório' });
    await dbUpdate('empresas', { nome, cnpj: cnpj||'', email: email||'', tel: tel||'', end_: end||'' }, { id: parseInt(req.params.id) });
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

app.delete('/api/empresas/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const row = await dbGet('empresas', { id });
    if (row) await moverParaLixeira('empresa', row, req.user.nome || req.user.email || '');
    await dbDelete('empresas', { id });
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

// ─── AVISOS ───────────────────────────────────────────────────────────────
app.get('/api/avisos', authMiddleware, async (req, res) => {
  try {
    const rows = await dbAll('avisos', null, { col: 'id', asc: false });
    res.json(rows.map(r => ({ id: r.id, titulo: r.titulo, msg: r.msg, data: r.data })));
  } catch (e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

app.post('/api/avisos', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { titulo, msg } = req.body || {};
    if (!titulo) return res.status(400).json({ message: 'Título obrigatório' });
    const data = new Date().toISOString().split('T')[0];
    const row = await dbInsert('avisos', { titulo, msg: msg||'', data });
    res.json({ id: row.id, titulo, msg: msg||'', data });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

// ─── EMAIL EM MASSA ───────────────────────────────────────────────────────
app.post('/api/avisos/email-todos', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { assunto, mensagem } = req.body || {};
    if (!assunto || !mensagem)
      return res.status(400).json({ message: 'Assunto e mensagem são obrigatórios' });

    const funcionarios = await dbAll('employees', { status: 'ativo' });
    const emails = funcionarios.map(e => e.email).filter(e => e && e.includes('@'));

    if (emails.length === 0)
      return res.status(400).json({ message: 'Nenhum funcionário com e-mail cadastrado' });

    const html = `<div style="font-family:sans-serif;max-width:600px;margin:auto">
      <h2 style="color:#1e3a5f">${assunto}</h2>
      <p style="color:#334155;line-height:1.6">${mensagem.replace(/\n/g, '<br>')}</p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin-top:32px">
      <p style="color:#94a3b8;font-size:12px">DP Gestão — Sistema de Gestão de Pessoal</p>
    </div>`;

    let enviados = 0;
    for (const to of emails) {
      const ok = await enviarEmail(to, assunto, html);
      if (ok) enviados++;
    }

    res.json({ success: true, enviados });
  } catch (e) {
    console.error('Erro email-todos:', e);
    res.status(500).json({ message: 'Erro ao enviar e-mails: ' + (e.message || JSON.stringify(e)) });
  }
});

// ─── COMUNICADOS ─────────────────────────────────────────────────────────
app.get('/api/comunicados', authMiddleware, async (req, res) => {
  try {
    const rows = await dbAll('comunicados', null, { col: 'id', asc: false });
    res.json(rows.map(r => ({ id: r.id, titulo: r.titulo, msg: r.msg, dest: r.dest, ch: r.ch, data: r.data })));
  } catch (e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

app.post('/api/comunicados', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { titulo, msg, dest, ch } = req.body || {};
    if (!titulo) return res.status(400).json({ message: 'Título obrigatório' });
    const data = new Date().toISOString().split('T')[0];
    const row = await dbInsert('comunicados', { titulo, msg: msg||'', dest: dest||'', ch: ch||'wz', data });

    // Dispara email para funcionários ativos se canal for email ou ambos
    if (ch === 'email' || ch === 'ambos') {
      const funcionarios = await dbAll('employees', { status: 'ativo' });
      const emails = funcionarios.map(e => e.email).filter(e => e && e.includes('@'));
      const html = `<div style="font-family:sans-serif;max-width:600px;margin:auto;background:#f8fafc;padding:32px;border-radius:12px">
        <div style="background:#1e3a6e;padding:20px 24px;border-radius:8px;margin-bottom:24px">
          <h2 style="color:#fff;margin:0;font-size:18px">📢 ${titulo}</h2>
        </div>
        <p style="color:#334155;line-height:1.7;font-size:15px">${(msg||'').replace(/\n/g,'<br>')}</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
        <p style="color:#94a3b8;font-size:12px">3B Gestão — Sistema de Gestão de Pessoal</p>
      </div>`;
      for (const to of emails) await enviarEmail(to, titulo, html);
    }

    res.json({ id: row.id, titulo, msg: msg||'', dest: dest||'', ch: ch||'wz', data });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

app.delete('/api/comunicados/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const row = await dbGet('comunicados', { id });
    if (row) await moverParaLixeira('comunicado', row, req.user.nome || req.user.email || '');
    await dbDelete('comunicados', { id });
    res.json({ success: true });
  } catch(e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

// ─── CONFIG ───────────────────────────────────────────────────────────────
app.get('/api/config', authMiddleware, async (req, res) => {
  try {
    const rows = await dbAll('config');
    const cfg = {};
    rows.forEach(r => { cfg[r.key] = r.value; });
    res.json({
      empresa: cfg.empresa || 'Minha Empresa',
      prazoHoras: parseInt(cfg.prazoHoras) || 48,
      jornada: parseInt(cfg.jornada) || 44,
      notifWZ:    cfg.notifWZ    !== 'false',
      notifEmail: cfg.notifEmail !== 'false',
      googleClientId: cfg.googleClientId || '',
      appleServiceId: cfg.appleServiceId || ''
    });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

app.put('/api/config', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { empresa, prazoHoras, jornada, notifWZ, notifEmail, googleClientId, appleServiceId } = req.body || {};
    const updates = [
      { key: 'empresa',        value: empresa        || 'Minha Empresa' },
      { key: 'prazoHoras',     value: String(prazoHoras || 48) },
      { key: 'jornada',        value: String(jornada    || 44) },
      { key: 'notifWZ',        value: String(notifWZ  !== false) },
      { key: 'notifEmail',     value: String(notifEmail !== false) },
      { key: 'googleClientId', value: googleClientId || '' },
      { key: 'appleServiceId', value: appleServiceId || '' }
    ];
    for (const u of updates) await dbUpsert('config', u, 'key');
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

// ─── Editar perfil próprio (funcionário) ─────────────────────────────────
app.put('/api/employees/:id/perfil', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (req.user.role !== 'admin' && req.user.id !== id)
      return res.status(403).json({ message: 'Acesso negado' });
    const { tel, tel2, email, en, ep, ew, et, ew2, en2, ep2 } = req.body || {};
    await dbUpdate('employees', {
      tel: tel||'', tel2: tel2||'', email: email||'',
      en: en||'', ep: ep||'', ew: ew||'', et: et||''
    }, { id });
    res.json({ success: true });
  } catch(e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

// ─── Trocar senha própria ─────────────────────────────────────────────────
app.put('/api/employees/:id/senha', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (req.user.role !== 'admin' && req.user.id !== id)
      return res.status(403).json({ message: 'Acesso negado' });
    const { senhaAtual, novaSenha } = req.body || {};
    if (!senhaAtual || !novaSenha) return res.status(400).json({ message: 'Preencha todos os campos' });
    const emp = await dbGet('employees', { id });
    if (!emp) return res.status(404).json({ message: 'Usuário não encontrado' });
    const ok = await bcrypt.compare(senhaAtual, emp.senha || '');
    if (!ok) return res.status(401).json({ message: 'Senha atual incorreta' });
    const hash = await bcrypt.hash(novaSenha, 10);
    await dbUpdate('employees', { senha: hash }, { id });
    res.json({ success: true });
  } catch(e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

// ─── Foto de perfil ───────────────────────────────────────────────────────
app.put('/api/employees/:id/foto', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (req.user.role !== 'admin' && req.user.id !== id)
      return res.status(403).json({ message: 'Acesso negado' });
    const { foto } = req.body || {};
    await dbUpdate('employees', { foto: foto || '' }, { id });
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

// ─── LIXEIRA ─────────────────────────────────────────────────────────────
async function moverParaLixeira(tipo, dados, excluidoPor) {
  try {
    const excluido_em = new Date().toISOString();
    // Remove campos base64 pesados (foto, file_url) para não exceder limite
    const dadosLeves = Object.fromEntries(
      Object.entries(dados).filter(([k]) => !['foto','file_url'].includes(k))
    );
    dadosLeves._tipo_original = tipo;
    await dbInsert('lixeira', { tipo, dados: dadosLeves, excluido_por: excluidoPor, excluido_em });
  } catch(e) {
    console.error('moverParaLixeira erro:', e.message);
  }
}

app.get('/api/lixeira', authMiddleware, adminOnly, async (req, res) => {
  try {
    const rows = await dbAll('lixeira', null, { col: 'id', asc: false });
    res.json(rows.map(r => ({
      id: r.id, tipo: r.tipo,
      dados: typeof r.dados === 'string' ? JSON.parse(r.dados) : r.dados,
      excluidoPor: r.excluido_por, excluidoEm: r.excluido_em
    })));
  } catch(e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

app.post('/api/lixeira/:id/restaurar', authMiddleware, adminOnly, async (req, res) => {
  try {
    const item = await dbGet('lixeira', { id: parseInt(req.params.id) });
    if (!item) return res.status(404).json({ message: 'Item não encontrado' });
    const dados = typeof item.dados === 'string' ? JSON.parse(item.dados) : item.dados;
    const tabelaMap = { atestado: 'atestados', documento: 'documentos', ferias: 'ferias', funcionario: 'employees', empresa: 'empresas' };
    const tabela = tabelaMap[item.tipo];
    if (!tabela) return res.status(400).json({ message: 'Tipo inválido' });
    const { id: _origId, ...rest } = dados;
    await dbInsert(tabela, rest);
    await dbDelete('lixeira', { id: parseInt(req.params.id) });
    res.json({ success: true });
  } catch(e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

app.delete('/api/lixeira/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await dbDelete('lixeira', { id: parseInt(req.params.id) });
    res.json({ success: true });
  } catch(e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

// ─── RECUPERAÇÃO DE SENHA ─────────────────────────────────────────────────
app.post('/api/recuperar-senha', async (req, res) => {
  try {
    const { cpf, nasc } = req.body || {};
    if (!cpf || !nasc) return res.status(400).json({ message: 'CPF e data de nascimento são obrigatórios' });
    // Normaliza: compara só os dígitos para ignorar formatação (com ou sem máscara)
    const cpfDigits = cpf.replace(/\D/g, '');
    const todos = await dbAll('employees');
    const emp = todos.find(e => e.cpf && e.cpf.replace(/\D/g, '') === cpfDigits);
    if (!emp || emp.nasc !== nasc.trim()) return res.status(404).json({ message: 'Funcionário não encontrado. Verifique o CPF e data de nascimento.' });
    if (emp.status !== 'ativo') return res.status(403).json({ message: 'Conta inativa. Contate o administrador.' });
    const created_at = new Date().toISOString();
    await dbInsert('recuperacao_senha', { emp_id: emp.id, emp_nome: emp.nome, cpf: cpf.trim(), status: 'pendente', created_at });
    res.json({ success: true, nome: emp.nome });
  } catch(e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

app.get('/api/recuperacao', authMiddleware, adminOnly, async (req, res) => {
  try {
    const rows = await dbAll('recuperacao_senha', null, { col: 'id', asc: false });
    res.json(rows.map(r => ({ id: r.id, empId: r.emp_id, empNome: r.emp_nome, cpf: r.cpf, status: r.status, createdAt: r.created_at })));
  } catch(e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

app.get('/api/recuperacao/minha', authMiddleware, async (req, res) => {
  try {
    const rows = await dbAll('recuperacao_senha', { emp_id: req.user.id });
    const aprovada = rows.find(r => r.status === 'aprovado');
    res.json({ temAprovada: !!aprovada });
  } catch(e) { res.status(500).json({ message: 'Erro interno' }); }
});

app.put('/api/recuperacao/:id/aprovar', authMiddleware, adminOnly, async (req, res) => {
  try {
    const rec = await dbGet('recuperacao_senha', { id: parseInt(req.params.id) });
    if (!rec) return res.status(404).json({ message: 'Solicitação não encontrada' });
    // Senha padrão = primeiros 6 dígitos do CPF
    const senhaTemp = rec.cpf.replace(/\D/g, '').slice(0, 6);
    const hash = await bcrypt.hash(senhaTemp, 10);
    await dbUpdate('employees', { senha: hash }, { id: rec.emp_id });
    await dbUpdate('recuperacao_senha', { status: 'aprovado' }, { id: parseInt(req.params.id) });
    res.json({ success: true });
  } catch(e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

app.put('/api/recuperacao/:id/recusar', authMiddleware, adminOnly, async (req, res) => {
  try {
    await dbUpdate('recuperacao_senha', { status: 'recusado' }, { id: parseInt(req.params.id) });
    res.json({ success: true });
  } catch(e) { console.error(e); res.status(500).json({ message: 'Erro interno' }); }
});

app.put('/api/recuperacao/concluir', authMiddleware, async (req, res) => {
  try {
    const rows = await dbAll('recuperacao_senha', { emp_id: req.user.id });
    for (const r of rows.filter(x => x.status === 'aprovado')) {
      await dbUpdate('recuperacao_senha', { status: 'concluido' }, { id: r.id });
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ message: 'Erro interno' }); }
});

// ─── Fallback ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ─── Start ────────────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n✅  DP Gestão rodando em http://localhost:${PORT}\n`);
    console.log('   Admin:        amandabritosilva17@gmail.com  /  admin123');
    console.log('   Funcionário:  ana.lima@empresa.com  /  ana123\n');
  });
}

module.exports = app;
