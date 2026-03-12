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
      position INTEGER NOT NULL DEFAULT 0,
      due_date DATE,
      labels TEXT,
      is_archived BOOLEAN NOT NULL DEFAULT FALSE
    );
  `);

  // Asegura columnas nuevas si la tabla ya existía con un esquema antiguo
  await pool.query(`
    ALTER TABLE cards
    ADD COLUMN IF NOT EXISTS due_date DATE,
    ADD COLUMN IF NOT EXISTS labels TEXT,
    ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS card_comments (
      id SERIAL PRIMARY KEY,
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS card_checklists (
      id SERIAL PRIMARY KEY,
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      is_done BOOLEAN NOT NULL DEFAULT FALSE
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

// Eliminar tablero (y en cascada sus listas y tarjetas)
app.post('/boards/:id/delete', async (req, res) => {
  const boardId = req.params.id;
  try {
    await pool.query('DELETE FROM boards WHERE id = $1', [boardId]);
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error eliminando tablero');
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
      'SELECT * FROM cards WHERE is_archived = FALSE AND list_id IN (SELECT id FROM lists WHERE board_id = $1) ORDER BY position ASC, id ASC',
      [boardId]
    );

    const cardsByList = {};
    const cardIds = [];
    for (const card of cards) {
      cardIds.push(card.id);
      if (!cardsByList[card.list_id]) cardsByList[card.list_id] = [];
      cardsByList[card.list_id].push(card);
    }

    let commentsByCard = {};
    let checklistsByCard = {};

    if (cardIds.length > 0) {
      const { rows: comments } = await pool.query(
        'SELECT * FROM card_comments WHERE card_id = ANY($1::int[]) ORDER BY created_at ASC',
        [cardIds]
      );
      commentsByCard = comments.reduce((acc, c) => {
        if (!acc[c.card_id]) acc[c.card_id] = [];
        acc[c.card_id].push(c);
        return acc;
      }, {});

      const { rows: checklistItems } = await pool.query(
        'SELECT * FROM card_checklists WHERE card_id = ANY($1::int[]) ORDER BY id ASC',
        [cardIds]
      );
      checklistsByCard = checklistItems.reduce((acc, item) => {
        if (!acc[item.card_id]) acc[item.card_id] = [];
        acc[item.card_id].push(item);
        return acc;
      }, {});
    }

    res.render('board', { board, lists, cardsByList, commentsByCard, checklistsByCard });
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
  const { title, description, boardId, labels, due_date } = req.body;
  if (!title) return res.redirect(`/boards/${boardId}`);
  try {
    const { rows: posRows } = await pool.query(
      'SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM cards WHERE list_id = $1',
      [listId]
    );
    const nextPos = posRows[0].next_pos || 0;
    await pool.query(
      'INSERT INTO cards (list_id, title, description, position, labels, due_date) VALUES ($1, $2, $3, $4, $5, $6)',
      [listId, title, description || '', nextPos, labels || null, due_date || null]
    );
    res.redirect(`/boards/${boardId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error creando tarjeta');
  }
});

// Actualizar tarjeta (título, descripción, etiquetas, fecha de vencimiento)
app.post('/cards/:id/update', async (req, res) => {
  const cardId = req.params.id;
  const { boardId, listId, title, description, labels, due_date } = req.body;
  if (!boardId) return res.status(400).send('boardId requerido');
  if (!title) return res.redirect(`/boards/${boardId}`);
  try {
    await pool.query(
      'UPDATE cards SET title = $1, description = $2, labels = $3, due_date = $4, list_id = $5 WHERE id = $6',
      [title, description || '', labels || null, due_date || null, listId, cardId]
    );
    res.redirect(`/boards/${boardId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error actualizando tarjeta');
  }
});

// Eliminar tarjeta
app.post('/cards/:id/delete', async (req, res) => {
  const cardId = req.params.id;
  const { boardId } = req.body;
  if (!boardId) return res.status(400).send('boardId requerido');
  try {
    await pool.query('DELETE FROM cards WHERE id = $1', [cardId]);
    res.redirect(`/boards/${boardId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error eliminando tarjeta');
  }
});

// Archivar tarjeta (no se muestra en el tablero)
app.post('/cards/:id/archive', async (req, res) => {
  const cardId = req.params.id;
  const { boardId } = req.body;
  if (!boardId) return res.status(400).send('boardId requerido');
  try {
    await pool.query('UPDATE cards SET is_archived = TRUE WHERE id = $1', [cardId]);
    res.redirect(`/boards/${boardId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error archivando tarjeta');
  }
});

// Eliminar lista completa
app.post('/lists/:id/delete', async (req, res) => {
  const listId = req.params.id;
  const { boardId } = req.body;
  if (!boardId) return res.status(400).send('boardId requerido');
  try {
    await pool.query('DELETE FROM lists WHERE id = $1', [listId]);
    res.redirect(`/boards/${boardId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error eliminando lista');
  }
});

// Añadir comentario a una tarjeta
app.post('/cards/:id/comments', async (req, res) => {
  const cardId = req.params.id;
  const { boardId, content } = req.body;
  if (!boardId) return res.status(400).send('boardId requerido');
  if (!content) return res.redirect(`/boards/${boardId}`);
  try {
    await pool.query('INSERT INTO card_comments (card_id, content) VALUES ($1, $2)', [
      cardId,
      content,
    ]);
    res.redirect(`/boards/${boardId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error añadiendo comentario');
  }
});

// Añadir ítem de checklist a una tarjeta
app.post('/cards/:id/checklists', async (req, res) => {
  const cardId = req.params.id;
  const { boardId, title } = req.body;
  if (!boardId) return res.status(400).send('boardId requerido');
  if (!title) return res.redirect(`/boards/${boardId}`);
  try {
    await pool.query('INSERT INTO card_checklists (card_id, title) VALUES ($1, $2)', [
      cardId,
      title,
    ]);
    res.redirect(`/boards/${boardId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error añadiendo elemento de checklist');
  }
});

// Alternar estado de un ítem de checklist
app.post('/checklists/:id/toggle', async (req, res) => {
  const itemId = req.params.id;
  const { boardId } = req.body;
  if (!boardId) return res.status(400).send('boardId requerido');
  try {
    await pool.query(
      'UPDATE card_checklists SET is_done = NOT is_done WHERE id = $1',
      [itemId]
    );
    res.redirect(`/boards/${boardId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error actualizando checklist');
  }
});

// Eliminar un ítem de checklist
app.post('/checklists/:id/delete', async (req, res) => {
  const itemId = req.params.id;
  const { boardId } = req.body;
  if (!boardId) return res.status(400).send('boardId requerido');
  try {
    await pool.query('DELETE FROM card_checklists WHERE id = $1', [itemId]);
    res.redirect(`/boards/${boardId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error eliminando checklist');
  }
});

// Reordenar tarjetas dentro de una lista
app.post('/lists/:id/reorder', async (req, res) => {
  const listId = req.params.id;
  const { cardIds } = req.body;
  if (!Array.isArray(cardIds)) {
    return res.status(400).json({ error: 'cardIds debe ser un array' });
  }
  try {
    for (let index = 0; index < cardIds.length; index += 1) {
      const cardId = cardIds[index];
      await pool.query(
        'UPDATE cards SET position = $1 WHERE id = $2 AND list_id = $3',
        [index, cardId, listId]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error reordenando tarjetas' });
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

