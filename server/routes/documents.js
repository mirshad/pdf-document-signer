'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { PDFDocument } = require('pdf-lib');

const router = express.Router();

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'data', 'uploads');
const SIGNED_DIR = path.join(__dirname, '..', '..', 'data', 'signed');
const SIGNATURES_DIR = path.join(__dirname, '..', '..', 'data', 'signatures');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${uuidv4()}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(Object.assign(new Error('Only PDF files are allowed'), { status: 400 }));
    }
    cb(null, true);
  },
});

router.post('/upload', upload.single('pdf'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No PDF file uploaded' });
  }

  res.json({
    id: path.basename(req.file.filename),
    originalName: req.file.originalname,
    size: req.file.size,
    url: `/api/documents/${encodeURIComponent(path.basename(req.file.filename))}`,
  });
});

router.get('/signed/:id/download', (req, res) => {
  const id = path.basename(req.params.id);
  const filePath = path.join(SIGNED_DIR, id);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Signed document not found' });
  }

  res.download(filePath, id);
});

router.get('/signed/:id', (req, res) => {
  const id = path.basename(req.params.id);
  const filePath = path.join(SIGNED_DIR, id);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Signed document not found' });
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${id}"`);
  fs.createReadStream(filePath).pipe(res);
});

/**
 * Body:
 * {
 *   documentId: string,
 *   placements: [{
 *     signatureId?: string,
 *     imageDataUrl?: string,
 *     pageIndex: number,
 *     x: number, y: number,
 *     width: number, height: number
 *   }]
 * }
 * Coordinates are in PDF points with origin at bottom-left (pdf-lib space).
 */
router.post('/sign', async (req, res, next) => {
  try {
    const { documentId, placements } = req.body || {};

    if (!documentId || !Array.isArray(placements) || placements.length === 0) {
      return res.status(400).json({ error: 'documentId and placements are required' });
    }

    const safeId = path.basename(documentId);
    const sourcePath = path.join(UPLOADS_DIR, safeId);

    if (!fs.existsSync(sourcePath)) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const pdfBytes = fs.readFileSync(sourcePath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();

    for (const placement of placements) {
      const pageIndex = Number(placement.pageIndex);
      if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pages.length) {
        return res.status(400).json({ error: `Invalid pageIndex: ${placement.pageIndex}` });
      }

      let pngBytes;
      if (placement.signatureId) {
        const sigPath = path.join(SIGNATURES_DIR, path.basename(placement.signatureId));
        if (!fs.existsSync(sigPath)) {
          return res.status(404).json({ error: `Signature not found: ${placement.signatureId}` });
        }
        pngBytes = fs.readFileSync(sigPath);
      } else if (placement.imageDataUrl && typeof placement.imageDataUrl === 'string') {
        const match = placement.imageDataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
        if (!match) {
          return res.status(400).json({ error: 'imageDataUrl must be a PNG or JPEG data URL' });
        }
        pngBytes = Buffer.from(match[2], 'base64');
      } else {
        return res.status(400).json({ error: 'Each placement needs signatureId or imageDataUrl' });
      }

      const isJpeg = placement.imageDataUrl
        ? /image\/jpe?g/i.test(placement.imageDataUrl)
        : false;
      const image = isJpeg
        ? await pdfDoc.embedJpg(pngBytes)
        : await pdfDoc.embedPng(pngBytes);

      const page = pages[pageIndex];
      const width = Number(placement.width) || 160;
      const height = Number(placement.height) || 60;
      const x = Number(placement.x) || 0;
      const y = Number(placement.y) || 0;

      page.drawImage(image, { x, y, width, height });
    }

    const signedBytes = await pdfDoc.save();
    const outName = `signed-${uuidv4()}.pdf`;
    const outPath = path.join(SIGNED_DIR, outName);
    fs.writeFileSync(outPath, signedBytes);

    res.json({
      id: outName,
      url: `/api/documents/signed/${encodeURIComponent(outName)}`,
      downloadUrl: `/api/documents/signed/${encodeURIComponent(outName)}/download`,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req, res) => {
  const id = path.basename(req.params.id);
  const filePath = path.join(UPLOADS_DIR, id);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Document not found' });
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${id}"`);
  fs.createReadStream(filePath).pipe(res);
});

module.exports = router;
