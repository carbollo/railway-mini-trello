const express = require('express');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de base de datos (Railway usa DATABASE_URL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Motor de vistas
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS boards (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS lists (
      id SERIAL PRIMARY KEY,
      board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cards (
      id SERIAL PRIMARY KEY,
      list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      position INTEGER NOT NULL DEFAULT 0
    );
  `);
}

// Página principal: listado de tableros
app.get('/', async (req, res) => {
  try {
    const { rows: boards } = await pool.query('SELECT * FROM boards ORDER BY id ASC');
    res.render('boards', { boards });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error cargando tableros');
  }
});

// Crear tablero
app.post('/boards', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.redirect('/');
    await pool.query('INSERT INTO boards (name) VALUES ($1)', [name]);
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error creando tablero');
  }
});

// Ver tablero con listas y tarjetas
app.get('/boards/:id', async (req, res) => {
  const boardId = req.params.id;
  try {
    const { rows: boardRows } = await pool.query('SELECT * FROM boards WHERE id = $1', [boardId]);
    if (boardRows.length === 0) return res.status(404).send('Tablero no encontrado');
    const board = boardRows[0];

    const { rows: lists } = await pool.query(
      'SELECT * FROM lists WHERE board_id = $1 ORDER BY position ASC, id ASC',
      [boardId]
    );

    const { rows: cards } = await pool.query(
      'SELECT * FROM cards WHERE list_id IN (SELECT id FROM lists WHERE board_id = $1) ORDER BY position ASC, id ASC',
      [boardId]
    );

    const cardsByList = {};
    for (const card of cards) {
      if (!cardsByList[card.list_id]) cardsByList[card.list_id] = [];
      cardsByList[card.list_id].push(card);
    }

    res.render('board', { board, lists, cardsByList });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error cargando tablero');
  }
});

// Crear lista en un tablero
app.post('/boards/:id/lists', async (req, res) => {
  const boardId = req.params.id;
  const { name } = req.body;
  if (!name) return res.redirect(`/boards/${boardId}`);
  try {
    const { rows: posRows } = await pool.query(
      'SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM lists WHERE board_id = $1',
      [boardId]
    );
    const nextPos = posRows[0].next_pos || 0;
    await pool.query(
      'INSERT INTO lists (board_id, name, position) VALUES ($1, $2, $3)',
      [boardId, name, nextPos]
    );
    res.redirect(`/boards/${boardId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error creando lista');
  }
});

// Crear tarjeta en una lista
app.post('/lists/:id/cards', async (req, res) => {
  const listId = req.params.id;
  const { title, description, boardId } = req.body;
  if (!title) return res.redirect(`/boards/${boardId}`);
  try {
    const { rows: posRows } = await pool.query(
      'SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM cards WHERE list_id = $1',
      [listId]
    );
    const nextPos = posRows[0].next_pos || 0;
    await pool.query(
      'INSERT INTO cards (list_id, title, description, position) VALUES ($1, $2, $3, $4)',
      [listId, title, description || '', nextPos]
    );
    res.redirect(`/boards/${boardId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error creando tarjeta');
  }
});

// Mover tarjeta (API sencilla para JS del frontend)
app.post('/cards/:id/move', async (req, res) => {
  const cardId = req.params.id;
  const { targetListId, targetPosition } = req.body;
  if (!targetListId) return res.status(400).json({ error: 'targetListId requerido' });
  try {
    let position = targetPosition;
    if (position === undefined || position === null) {
      const { rows: posRows } = await pool.query(
        'SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM cards WHERE list_id = $1',
        [targetListId]
      );
      position = posRows[0].next_pos || 0;
    }
    await pool.query(
      'UPDATE cards SET list_id = $1, position = $2 WHERE id = $3',
      [targetListId, position, cardId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error moviendo tarjeta' });
  }
});

// Arranque
ensureSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor escuchando en puerto ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Error inicializando esquema de base de datos', err);
    process.exit(1);
  });

