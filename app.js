const express = require('express');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

const dbPath = path.join(__dirname, 'books.db');
let db = null;

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    await db.run(`
      CREATE TABLE IF NOT EXISTS book (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        author TEXT NOT NULL,
        published_year INTEGER NOT NULL
      );
    `);

    app.listen(3000, () => {
      console.log('Server running at http://localhost:3000/');
    });
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};
initializeDbAndServer();

// Get all books
app.get('/books', async (request, response) => {
  const books = await db.all(`SELECT * FROM book`);
  response.send(books);
});

// Get book by ID
app.get('/books/:id', async (request, response) => {
  const { id } = request.params;
  const book = await db.get(`SELECT * FROM book WHERE id = ?`, [id]);
  if (book === undefined) {
    response.status(404).send('Book not found');
  } else {
    response.send(book);
  }
});

// Add a new book
app.post('/books', async (request, response) => {
  const { title, author, publishedYear } = request.body;
  if (!title || !author || typeof publishedYear !== 'number') {
    response.status(400).send('Invalid book data');
    return;
  }

  const id = uuidv4();
  const query = `
    INSERT INTO book (id, title, author, published_year)
    VALUES (?, ?, ?, ?)`;
  await db.run(query, [id, title, author, publishedYear]);
  response.send('Book added successfully');
});

// Update a book
app.put('/books/:id', async (request, response) => {
  const { id } = request.params;
  const { title, author, publishedYear } = request.body;

  const existing = await db.get(`SELECT * FROM book WHERE id = ?`, [id]);
  if (!existing) {
    response.status(404).send('Book not found');
    return;
  }

  const query = `
    UPDATE book
    SET title = ?, author = ?, published_year = ?
    WHERE id = ?`;
  await db.run(query, [title, author, publishedYear, id]);
  response.send('Book updated successfully');
});

// Delete a book
app.delete('/books/:id', async (request, response) => {
  const { id } = request.params;

  const existing = await db.get(`SELECT * FROM book WHERE id = ?`, [id]);
  if (!existing) {
    response.status(404).send('Book not found');
    return;
  }

  await db.run(`DELETE FROM book WHERE id = ?`, [id]);
  response.send('Book deleted successfully');
});

// Bulk import books from CSV
app.post('/books/import', upload.single('file'), async (request, response) => {
  const filePath = request.file.path;
  const content = fs.readFileSync(filePath, 'utf8');

  const lines = content.trim().split('\n');
  const header = lines[0].split(',').map(h => h.trim());
  const expectedHeader = ['title', 'author', 'publishedYear'];

  if (JSON.stringify(header) !== JSON.stringify(expectedHeader)) {
    fs.unlinkSync(filePath);
    response.status(400).send('Invalid CSV header format');
    return;
  }

  let addedCount = 0;
  const errors = [];

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(',').map(val => val.trim());
    const [title, author, publishedYearStr] = row;
    const publishedYear = Number(publishedYearStr);

    if (!title || !author || isNaN(publishedYear)) {
      errors.push({ row: i + 1, error: 'Invalid or missing fields' });
      continue;
    }

    const id = uuidv4();
    try {
      await db.run(
        `INSERT INTO book (id, title, author, published_year)
         VALUES (?, ?, ?, ?)`,
        [id, title, author, publishedYear]
      );
      addedCount += 1;
    } catch (err) {
      errors.push({ row: i + 1, error: err.message });
    }
  }

  fs.unlinkSync(filePath);
  response.send({ added: addedCount, errors });
});

module.exports = app;
