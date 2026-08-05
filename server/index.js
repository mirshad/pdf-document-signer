'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const documentsRouter = require('./routes/documents');
const signaturesRouter = require('./routes/signatures');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIRS = [
  path.join(__dirname, '..', 'data', 'uploads'),
  path.join(__dirname, '..', 'data', 'signatures'),
  path.join(__dirname, '..', 'data', 'signed'),
];

for (const dir of DATA_DIRS) {
  fs.mkdirSync(dir, { recursive: true });
}

const signaturesIndex = path.join(__dirname, '..', 'data', 'signatures', 'index.json');
if (!fs.existsSync(signaturesIndex)) {
  try {
    require('./seed-signatures');
  } catch (err) {
    console.warn('Could not seed predefined signatures:', err.message);
  }
}

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'inkmark' });
});

app.use('/api/documents', documentsRouter);
app.use('/api/signatures', signaturesRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Internal server error',
  });
});

app.listen(PORT, () => {
  console.log(`InkMark running at http://localhost:${PORT}`);
});
