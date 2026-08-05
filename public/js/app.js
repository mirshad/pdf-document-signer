/* global pdfjsLib from CDN */
(() => {
  'use strict';

  const state = {
    documentId: null,
    documentName: null,
    pdfDoc: null,
    pageNum: 1,
    pageCount: 0,
    scale: 1.25,
    renderTask: null,
    signatures: [],
    selectedSignatureId: null,
    placements: [],
    placementWidth: 180,
    drawing: false,
  };

  const els = {
    pdfInput: document.getElementById('pdf-input'),
    pdfInputEmpty: document.getElementById('pdf-input-empty'),
    btnApply: document.getElementById('btn-apply'),
    signatureList: document.getElementById('signature-list'),
    btnNewSign: document.getElementById('btn-new-sign'),
    sigWidth: document.getElementById('sig-width'),
    sigWidthVal: document.getElementById('sig-width-val'),
    btnClearPlacements: document.getElementById('btn-clear-placements'),
    docMeta: document.getElementById('doc-meta'),
    docName: document.getElementById('doc-name'),
    btnPrev: document.getElementById('btn-prev'),
    btnNext: document.getElementById('btn-next'),
    pageIndicator: document.getElementById('page-indicator'),
    emptyState: document.getElementById('empty-state'),
    viewerWrap: document.getElementById('viewer-wrap'),
    pageStage: document.getElementById('page-stage'),
    canvas: document.getElementById('pdf-canvas'),
    overlay: document.getElementById('overlay'),
    toast: document.getElementById('toast'),
    signDialog: document.getElementById('sign-dialog'),
    signForm: document.getElementById('sign-form'),
    signName: document.getElementById('sign-name'),
    signPad: document.getElementById('sign-pad'),
    btnClearPad: document.getElementById('btn-clear-pad'),
    btnCancelSign: document.getElementById('btn-cancel-sign'),
  };

  let toastTimer = null;
  const pad = {
    ctx: null,
    drawing: false,
    hasInk: false,
    lastX: 0,
    lastY: 0,
  };

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.hidden = true;
    }, 2800);
  }

  async function api(url, options = {}) {
    const res = await fetch(url, options);
    const contentType = res.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await res.json() : null;
    if (!res.ok) {
      throw new Error((data && data.error) || `Request failed (${res.status})`);
    }
    return data;
  }

  function updateActionState() {
    const hasDoc = Boolean(state.documentId);
    const hasPlacements = state.placements.length > 0;
    els.btnApply.disabled = !(hasDoc && hasPlacements);
    els.btnClearPlacements.disabled = !hasPlacements;
    els.docMeta.hidden = !hasDoc;
  }

  async function loadSignatures() {
    state.signatures = await api('/api/signatures');
    if (!state.selectedSignatureId && state.signatures.length) {
      state.selectedSignatureId = state.signatures[0].id;
    }
    if (
      state.selectedSignatureId &&
      !state.signatures.some((s) => s.id === state.selectedSignatureId)
    ) {
      state.selectedSignatureId = state.signatures[0] ? state.signatures[0].id : null;
    }
    renderSignatureList();
  }

  function renderSignatureList() {
    els.signatureList.innerHTML = '';
    if (!state.signatures.length) {
      els.signatureList.innerHTML = '<p class="panel-lead">No signatures yet. Create one.</p>';
      return;
    }

    for (const sig of state.signatures) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `signature-item${sig.id === state.selectedSignatureId ? ' active' : ''}`;
      item.setAttribute('role', 'listitem');
      item.innerHTML = `
        <img src="${sig.url}" alt="${escapeHtml(sig.name)} signature" />
        <span class="sig-name">${escapeHtml(sig.name)}</span>
        <span class="sig-badge">${sig.predefined ? 'Saved' : 'Custom'}</span>
      `;
      item.addEventListener('click', () => {
        state.selectedSignatureId = sig.id;
        renderSignatureList();
      });

      if (!sig.predefined) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'sig-delete';
        del.textContent = 'Delete';
        del.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await api(`/api/signatures/${encodeURIComponent(sig.id)}`, { method: 'DELETE' });
            showToast('Signature deleted');
            await loadSignatures();
          } catch (err) {
            showToast(err.message);
          }
        });
        item.appendChild(del);
      }

      els.signatureList.appendChild(item);
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function handleFile(file) {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      showToast('Please choose a PDF file');
      return;
    }

    const form = new FormData();
    form.append('pdf', file);

    try {
      const uploaded = await api('/api/documents/upload', { method: 'POST', body: form });
      state.documentId = uploaded.id;
      state.documentName = uploaded.originalName;
      state.placements = [];
      state.pageNum = 1;
      els.docName.textContent = uploaded.originalName;

      const bytes = await fetch(uploaded.url).then((r) => r.arrayBuffer());
      // eslint-disable-next-line no-undef
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      // eslint-disable-next-line no-undef
      state.pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
      state.pageCount = state.pdfDoc.numPages;

      els.emptyState.hidden = true;
      els.viewerWrap.hidden = false;
      updateActionState();
      await renderPage();
      showToast('PDF loaded — select a signature and click to place');
    } catch (err) {
      showToast(err.message);
    }
  }

  async function renderPage() {
    if (!state.pdfDoc) return;
    if (state.renderTask) {
      try {
        state.renderTask.cancel();
      } catch {
        /* ignore */
      }
    }

    const page = await state.pdfDoc.getPage(state.pageNum);
    const viewport = page.getViewport({ scale: state.scale });
    const canvas = els.canvas;
    const ctx = canvas.getContext('2d');
    const outputScale = window.devicePixelRatio || 1;

    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    els.pageStage.style.width = `${viewport.width}px`;
    els.pageStage.style.height = `${viewport.height}px`;

    const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
    state.renderTask = page.render({ canvasContext: ctx, viewport, transform });
    try {
      await state.renderTask.promise;
    } catch (err) {
      if (err && err.name === 'RenderingCancelledException') return;
      throw err;
    }

    els.pageIndicator.textContent = `Page ${state.pageNum} / ${state.pageCount}`;
    els.btnPrev.disabled = state.pageNum <= 1;
    els.btnNext.disabled = state.pageNum >= state.pageCount;
    renderPlacements();
  }

  function getSelectedSignature() {
    return state.signatures.find((s) => s.id === state.selectedSignatureId) || null;
  }

  function renderPlacements() {
    els.overlay.innerHTML = '';
    const pagePlacements = state.placements.filter((p) => p.pageIndex === state.pageNum - 1);
    const canvasRect = {
      width: els.canvas.clientWidth,
      height: els.canvas.clientHeight,
    };

    for (const placement of pagePlacements) {
      const el = document.createElement('div');
      el.className = 'placement';
      el.style.left = `${placement.displayX}px`;
      el.style.top = `${placement.displayY}px`;
      el.style.width = `${placement.displayWidth}px`;
      el.style.height = `${placement.displayHeight}px`;

      const img = document.createElement('img');
      img.src = placement.imageUrl;
      img.alt = 'Signature placement';
      el.appendChild(img);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove';
      remove.setAttribute('aria-label', 'Remove signature');
      remove.textContent = '×';
      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        state.placements = state.placements.filter((p) => p.id !== placement.id);
        updateActionState();
        renderPlacements();
      });
      el.appendChild(remove);

      enableDrag(el, placement, canvasRect);
      els.overlay.appendChild(el);
    }
  }

  function enableDrag(el, placement, canvasRect) {
    let startX = 0;
    let startY = 0;
    let originX = 0;
    let originY = 0;

    const onPointerDown = (e) => {
      if (e.target.classList.contains('remove')) return;
      e.preventDefault();
      e.stopPropagation();
      startX = e.clientX;
      startY = e.clientY;
      originX = placement.displayX;
      originY = placement.displayY;
      el.setPointerCapture(e.pointerId);
      el.style.cursor = 'grabbing';
    };

    const onPointerMove = (e) => {
      if (!el.hasPointerCapture(e.pointerId)) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      placement.displayX = clamp(originX + dx, 0, canvasRect.width - placement.displayWidth);
      placement.displayY = clamp(originY + dy, 0, canvasRect.height - placement.displayHeight);
      el.style.left = `${placement.displayX}px`;
      el.style.top = `${placement.displayY}px`;
    };

    const onPointerUp = (e) => {
      if (!el.hasPointerCapture(e.pointerId)) return;
      el.releasePointerCapture(e.pointerId);
      el.style.cursor = 'grab';
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function placeSignature(clientX, clientY) {
    const sig = getSelectedSignature();
    if (!sig || !state.pdfDoc) {
      showToast(state.pdfDoc ? 'Select a signature first' : 'Open a PDF first');
      return;
    }

    const rect = els.overlay.getBoundingClientRect();
    const displayWidth = state.placementWidth;
    const displayHeight = Math.round(displayWidth * 0.38);
    const displayX = clamp(clientX - rect.left - displayWidth / 2, 0, rect.width - displayWidth);
    const displayY = clamp(clientY - rect.top - displayHeight / 2, 0, rect.height - displayHeight);

    state.placements.push({
      id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      pageIndex: state.pageNum - 1,
      signatureId: sig.id,
      imageUrl: sig.url,
      displayX,
      displayY,
      displayWidth,
      displayHeight,
    });

    updateActionState();
    renderPlacements();
  }

  function toPdfPlacements() {
    const canvasW = els.canvas.clientWidth;
    const canvasH = els.canvas.clientHeight;
    // PDF.js renders with top-left origin; pdf-lib uses bottom-left in PDF points.
    // At scale S, canvas CSS pixels map to PDF points by dividing by S.
    return state.placements.map((p) => {
      const pdfWidth = p.displayWidth / state.scale;
      const pdfHeight = p.displayHeight / state.scale;
      const pdfX = p.displayX / state.scale;
      const pdfY = (canvasH - p.displayY - p.displayHeight) / state.scale;
      return {
        signatureId: p.signatureId,
        pageIndex: p.pageIndex,
        x: pdfX,
        y: pdfY,
        width: pdfWidth,
        height: pdfHeight,
      };
    });
  }

  async function applyAndDownload() {
    if (!state.documentId || !state.placements.length) return;
    els.btnApply.disabled = true;
    try {
      const result = await api('/api/documents/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: state.documentId,
          placements: toPdfPlacements(),
        }),
      });
      showToast('Signed PDF ready');
      const a = document.createElement('a');
      a.href = result.downloadUrl;
      a.download = `signed-${state.documentName || 'document.pdf'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      showToast(err.message);
    } finally {
      updateActionState();
    }
  }

  function initPad() {
    const canvas = els.signPad;
    const ctx = canvas.getContext('2d');
    pad.ctx = ctx;
    clearPad();

    const pos = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    };

    canvas.addEventListener('pointerdown', (e) => {
      pad.drawing = true;
      const p = pos(e);
      pad.lastX = p.x;
      pad.lastY = p.y;
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!pad.drawing) return;
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(pad.lastX, pad.lastY);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      pad.lastX = p.x;
      pad.lastY = p.y;
      pad.hasInk = true;
    });

    const end = (e) => {
      if (!pad.drawing) return;
      pad.drawing = false;
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
    };

    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  function clearPad() {
    const canvas = els.signPad;
    const ctx = pad.ctx || canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#14243a';
    pad.hasInk = false;
    pad.drawing = false;
  }

  function openSignDialog() {
    els.signName.value = '';
    clearPad();
    els.signDialog.showModal();
    els.signName.focus();
  }

  async function saveSignature(e) {
    e.preventDefault();
    const name = els.signName.value.trim();
    if (!name) {
      showToast('Enter a name for the signature');
      return;
    }
    if (!pad.hasInk) {
      showToast('Draw your signature first');
      return;
    }

    const imageDataUrl = els.signPad.toDataURL('image/png');
    try {
      const created = await api('/api/signatures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, imageDataUrl }),
      });
      els.signDialog.close();
      state.selectedSignatureId = created.id;
      await loadSignatures();
      showToast('Signature saved');
    } catch (err) {
      showToast(err.message);
    }
  }

  function bindEvents() {
    const onFile = (e) => {
      const file = e.target.files && e.target.files[0];
      handleFile(file);
      e.target.value = '';
    };
    els.pdfInput.addEventListener('change', onFile);
    els.pdfInputEmpty.addEventListener('change', onFile);

    els.btnApply.addEventListener('click', applyAndDownload);
    els.btnNewSign.addEventListener('click', openSignDialog);
    els.btnClearPad.addEventListener('click', clearPad);
    els.btnCancelSign.addEventListener('click', () => els.signDialog.close());
    els.signForm.addEventListener('submit', saveSignature);

    els.sigWidth.addEventListener('input', () => {
      state.placementWidth = Number(els.sigWidth.value);
      els.sigWidthVal.textContent = `${state.placementWidth}px`;
    });

    els.btnClearPlacements.addEventListener('click', () => {
      state.placements = [];
      updateActionState();
      renderPlacements();
    });

    els.btnPrev.addEventListener('click', async () => {
      if (state.pageNum <= 1) return;
      state.pageNum -= 1;
      await renderPage();
    });

    els.btnNext.addEventListener('click', async () => {
      if (state.pageNum >= state.pageCount) return;
      state.pageNum += 1;
      await renderPage();
    });

    els.overlay.addEventListener('click', (e) => {
      if (e.target !== els.overlay) return;
      placeSignature(e.clientX, e.clientY);
    });

    window.addEventListener('resize', () => {
      if (state.pdfDoc) {
        clearTimeout(window.__inkmarkResize);
        window.__inkmarkResize = setTimeout(() => renderPage(), 150);
      }
    });
  }

  function waitForPdfJs() {
    return new Promise((resolve) => {
      if (window.pdfjsLib) return resolve();
      const timer = setInterval(() => {
        if (window.pdfjsLib) {
          clearInterval(timer);
          resolve();
        }
      }, 30);
    });
  }

  async function boot() {
    await waitForPdfJs();
    initPad();
    bindEvents();
    updateActionState();
    try {
      await loadSignatures();
    } catch (err) {
      showToast(err.message);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
