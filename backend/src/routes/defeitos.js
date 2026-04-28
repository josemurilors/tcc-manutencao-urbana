const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');

const router = express.Router();

// Configuração do multer para upload de imagens
const storage = multer.disk_storage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// Configuração do banco de dados
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Middleware para verificar token JWT
const authenticateToken = (req, res, next) => {
  const token = req.header('Authorization');
  
  if (!token) {
    return res.status(401).json({ error: 'Acesso negado' });
  }
  
  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified;
    next();
  } catch (error) {
    res.status(400).json({ error: 'Token inválido' });
  }
};

// Criar diretório de uploads se não existir
const fs = require('fs');
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Endpoint para criar defeito
router.post('/', authenticateToken, upload.single('imagem'), async (req, res) => {
  try {
    const { titulo, descricao, latitude, longitude } = req.body;
    const usuario_id = req.user.userId;
    
    // Validar coordenadas
    if (!latitude || !longitude) {
      return res.status(400).json({ error: 'Latitude e longitude são obrigatórios' });
    }
    
    // Criar ponto geográfico
    const localizacao = `POINT(${longitude} ${latitude})`;
    
    // Caminho da imagem
    const imagem_url = req.file ? `/uploads/${req.file.filename}` : null;
    
    // Inserir defeito no banco
    const result = await pool.query(
      `INSERT INTO defeitos (usuario_id, titulo, descricao, localizacao, imagem_url)
       VALUES ($1, $2, $3, ST_GeomFromText($4, 4326), $5)
       RETURNING id, titulo, descricao, ST_AsText(localizacao) as localizacao, imagem_url, status, criado_em`,
      [usuario_id, titulo, descricao, localizacao, imagem_url]
    );
    
    // Chamar serviço de IA para classificação
    // (implementação futura)
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar defeito:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Endpoint para listar defeitos
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, titulo, descricao, ST_AsText(localizacao) as localizacao, imagem_url, status, criado_em
       FROM defeitos ORDER BY criado_em DESC`
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao listar defeitos:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Endpoint para obter defeito por ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT id, titulo, descricao, ST_AsText(localizacao) as localizacao, imagem_url, status, criado_em
       FROM defeitos WHERE id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Defeito não encontrado' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao obter defeito:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Endpoint para atualizar defeito (admin)
router.patch('/:id', authenticateToken, async (req, res) => {
  try {
    // Verificar se usuário é admin
    const userResult = await pool.query(
      'SELECT admin FROM usuarios WHERE id = $1',
      [req.user.userId]
    );
    
    if (userResult.rows.length === 0 || !userResult.rows[0].admin) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    
    const { id } = req.params;
    const { status } = req.body;
    
    const result = await pool.query(
      'UPDATE defeitos SET status = $1, atualizado_em = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [status, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Defeito não encontrado' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao atualizar defeito:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;