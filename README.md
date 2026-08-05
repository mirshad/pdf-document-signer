# InkMark — PDF Document Signer

Node.js full-stack app for opening a PDF, placing predefined or hand-drawn signatures, and downloading the signed document.

Ported from the InkMark work originally shipped under [`mirshad/BugTracker`](https://github.com/mirshad/BugTracker/pull/2) into this dedicated repository.

## Features

- Upload and view multi-page PDFs in the browser
- Place signatures by clicking on the page; drag to reposition
- Use predefined signatures shipped with the app
- Draw and save a new signature on a canvas pad
- Apply signatures into the PDF and download the result

## Stack

- **Backend:** Express, Multer, pdf-lib
- **Frontend:** Vanilla JS, PDF.js, HTML Canvas
- **Storage:** Local filesystem under `data/`

## Quick start

```bash
npm install
npm run seed    # create predefined signatures
npm start
```

Open [http://localhost:3000](http://localhost:3000).

Development with auto-reload:

```bash
npm run dev
```

## API overview

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/documents/upload` | Upload a PDF (`multipart/form-data`, field `pdf`) |
| `GET` | `/api/documents/:id` | Fetch an uploaded PDF |
| `POST` | `/api/documents/sign` | Embed signature placements and produce a signed PDF |
| `GET` | `/api/documents/signed/:id/download` | Download a signed PDF |
| `GET` | `/api/signatures` | List predefined and custom signatures |
| `POST` | `/api/signatures` | Save a drawn signature (`name`, `imageDataUrl`) |
| `DELETE` | `/api/signatures/:id` | Delete a custom signature |

### Sign request body

```json
{
  "documentId": "uuid-filename.pdf",
  "placements": [
    {
      "signatureId": "uuid.png",
      "pageIndex": 0,
      "x": 72,
      "y": 100,
      "width": 160,
      "height": 60
    }
  ]
}
```

Coordinates use PDF points with origin at the bottom-left (pdf-lib space).

## Project layout

```
.
  server/
    index.js
    routes/
    seed-signatures.js
  public/
    index.html
    css/
    js/
  data/
    uploads/
    signatures/
    signed/
```

## Notes

- Uploaded and signed files live under `data/` and are gitignored.
- Predefined signatures can be regenerated anytime with `npm run seed` (custom signatures are kept).
- Max upload size is 20MB.
