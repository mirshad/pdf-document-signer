'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

const SIGNATURES_DIR = path.join(__dirname, '..', '..', 'data', 'signatures');
const META_PATH = path.join(SIGNATURES_DIR, 'index.json');

function readMeta() {
  if (!fs.existsSync(META_PATH)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function writeMeta(list) {
  fs.writeFileSync(META_PATH, JSON.stringify(list, null, 2));
}

router.get('/', (_req, res) => {
  const list = readMeta().map((item) => ({
    ...item,
    url: `/api/signatures/${encodeURIComponent(item.id)}/image`,
  }));
  res.json(list);
});

router.get('/:id/image', (req, res) => {
  const id = path.basename(req.params.id);
  const meta = readMeta().find((s) => s.id === id);
  const filePath = path.join(SIGNATURES_DIR, id);

  if (!meta || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Signature not found' });
  }

  res.setHeader('Content-Type', meta.mimeType || 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  fs.createReadStream(filePath).pipe(res);
});

/**
 * Create a signature from a drawn canvas data URL.
 * Body: { name: string, imageDataUrl: string }
 */
router.post('/', (req, res) => {
  const { name, imageDataUrl } = req.body || {};

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  if (!imageDataUrl || typeof imageDataUrl !== 'string') {
    return res.status(400).json({ error: 'imageDataUrl is required' });
  }

  const match = imageDataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
  if (!match) {
    return res.status(400).json({ error: 'imageDataUrl must be a PNG or JPEG data URL' });
  }

  const ext = match[1].toLowerCase() === 'png' ? 'png' : 'jpg';
  const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
  const id = `${uuidv4()}.${ext}`;
  const buffer = Buffer.from(match[2], 'base64');

  if (buffer.length > 2 * 1024 * 1024) {
    return res.status(400).json({ error: 'Signature image is too large (max 2MB)' });
  }

  fs.writeFileSync(path.join(SIGNATURES_DIR, id), buffer);

  const list = readMeta();
  const entry = {
    id,
    name: name.trim().slice(0, 80),
    mimeType,
    predefined: false,
    createdAt: new Date().toISOString(),
  };
  list.push(entry);
  writeMeta(list);

  res.status(201).json({
    ...entry,
    url: `/api/signatures/${encodeURIComponent(id)}/image`,
  });
});

router.delete('/:id', (req, res) => {
  const id = path.basename(req.params.id);
  const list = readMeta();
  const index = list.findIndex((s) => s.id === id);

  if (index === -1) {
    return res.status(404).json({ error: 'Signature not found' });
  }

  if (list[index].predefined) {
    return res.status(400).json({ error: 'Cannot delete predefined signatures' });
  }

  const filePath = path.join(SIGNATURES_DIR, id);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  list.splice(index, 1);
  writeMeta(list);
  res.json({ ok: true });
});

module.exports = router;
module.exports.readMeta = readMeta;
module.exports.writeMeta = writeMeta;
module.exports.SIGNATURES_DIR = SIGNATURES_DIR;
