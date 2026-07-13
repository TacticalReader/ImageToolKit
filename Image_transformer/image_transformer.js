/**
 * Image Transformer — Main Logic
 * Handles upload, transform settings, preview generation, and downloads.
 */
(function () {
  'use strict';

  /* ============================================================
     STATE
     ============================================================ */
  const MAX_FILES = 7;
  const SUPPORTED = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'];

  let uploadedFiles = [];          // { file, url, img, w, h }
  let transformedBlobs = [];       // parallel array of Blob | null
  let transformedURLs = [];        // parallel array of objectURL | null

  const settings = {
    ratio: 'original',             // 'original','1:1','4:3','16:9','9:16','custom'
    dimMode: 'dimensions',         // 'dimensions' | 'percentage'
    width: 1920,
    height: 1080,
    scale: 100,
    format: 'jpeg',                // 'jpeg','png','webp','avif'
    quality: 85,
    background: 'original',        // 'original','white','black','transparent','custom'
    bgCustomColor: '#ff6600',
    maintainAR: true,
    noEnlarge: true,
    autoOrient: true,
    removeMeta: false,
    linked: true,                  // chain link between width/height
  };

  /* ============================================================
     DOM REFS
     ============================================================ */
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  const fileInput = $('#fileInput');
  const uploadZone = $('#uploadZone');
  const thumbnailStrip = $('#thumbnailStrip');
  const uploadFooter = $('#uploadFooter');
  const uploadCount = $('#uploadCount');
  const clearAllBtn = $('#clearAllBtn');
  const panelsSection = $('#panelsSection');
  const statusBar = $('#statusBar');
  const previewList = $('#previewList');
  const previewCount = $('#previewCount');
  const resetAllBtn = $('#resetAllBtn');
  const transformBtn = $('#transformBtn');
  const previewAllBtn = $('#previewAllBtn');
  const downloadAllBtn = $('#downloadAllBtn');

  // Settings controls
  const aspectRatioGrid = $('#aspectRatioGrid');
  const dimToggle = $('#dimToggle');
  const dimInputs = $('#dimInputs');
  const pctInputs = $('#pctInputs');
  const widthInput = $('#widthInput');
  const heightInput = $('#heightInput');
  const scaleInput = $('#scaleInput');
  const chainLink = $('#chainLink');
  const dimNote = $('#dimNote');
  const formatBtns = $('#formatBtns');
  const qualitySlider = $('#qualitySlider');
  const qualityValue = $('#qualityValue');
  const qualityControl = $('#qualityControl');
  const bgBtns = $('#bgBtns');
  const bgColorPicker = $('#bgColorPicker');
  const bgCustomSwatch = $('#bgCustomSwatch');

  // Toggles
  const optMaintainAR = $('#optMaintainAR');
  const optNoEnlarge = $('#optNoEnlarge');
  const optAutoOrient = $('#optAutoOrient');
  const optRemoveMeta = $('#optRemoveMeta');

  // Status
  const statusTotal = $('#statusTotal');
  const statusOrigSize = $('#statusOrigSize');
  const statusEstSize = $('#statusEstSize');

  /* ============================================================
     UTILITY
     ============================================================ */
  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function formatExt(mime) {
    const map = { 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/webp': 'WebP', 'image/avif': 'AVIF', 'image/gif': 'GIF' };
    return map[mime] || 'IMG';
  }

  function getOutputMime() {
    const map = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' };
    return map[settings.format] || 'image/jpeg';
  }

  function getOutputExt() {
    const map = { jpeg: 'jpg', png: 'png', webp: 'webp', avif: 'avif' };
    return map[settings.format] || 'jpg';
  }

  function getFormatLabel() {
    const map = { jpeg: 'JPG', png: 'PNG', webp: 'WebP', avif: 'AVIF' };
    return map[settings.format] || 'JPG';
  }

  function ratioToNumber(r) {
    if (r === 'original') return null;
    if (r === 'custom') return null;
    const parts = r.split(':');
    return parseInt(parts[0]) / parseInt(parts[1]);
  }

  /* ============================================================
     FILE UPLOAD
     ============================================================ */
  uploadZone.addEventListener('click', () => fileInput.click());
  uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
  uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    handleFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener('change', () => { handleFiles(fileInput.files); fileInput.value = ''; });

  function handleFiles(fileList) {
    const remaining = MAX_FILES - uploadedFiles.length;
    if (remaining <= 0) return;
    const files = Array.from(fileList).filter(f => SUPPORTED.includes(f.type)).slice(0, remaining);
    if (!files.length) return;

    let loaded = 0;
    files.forEach(file => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        uploadedFiles.push({ file, url, img, w: img.naturalWidth, h: img.naturalHeight });
        loaded++;
        if (loaded === files.length) {
          renderThumbnails();
          showPanels();
          clearTransformed();
        }
      };
      img.src = url;
    });
  }

  function removeFile(index) {
    URL.revokeObjectURL(uploadedFiles[index].url);
    uploadedFiles.splice(index, 1);
    if (transformedURLs[index]) URL.revokeObjectURL(transformedURLs[index]);
    transformedBlobs.splice(index, 1);
    transformedURLs.splice(index, 1);
    renderThumbnails();
    renderPreviewRows();
    if (uploadedFiles.length === 0) hidePanels();
    updateStatus();
  }

  function clearAll() {
    uploadedFiles.forEach(f => URL.revokeObjectURL(f.url));
    transformedURLs.forEach(u => { if (u) URL.revokeObjectURL(u); });
    uploadedFiles = [];
    transformedBlobs = [];
    transformedURLs = [];
    renderThumbnails();
    hidePanels();
  }

  clearAllBtn.addEventListener('click', clearAll);

  /* ============================================================
     THUMBNAIL STRIP
     ============================================================ */
  function renderThumbnails() {
    thumbnailStrip.innerHTML = '';
    uploadedFiles.forEach((item, i) => {
      const card = document.createElement('div');
      card.className = 'thumb-card';
      card.innerHTML = `
        <div class="thumb-img-wrap">
          <img src="${item.url}" alt="${item.file.name}">
          <span class="thumb-number">${i + 1}</span>
          <button class="thumb-remove" data-idx="${i}" title="Remove"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="thumb-info">
          <p class="thumb-name">${item.file.name}</p>
          <p class="thumb-meta">${formatBytes(item.file.size)}  •  ${item.w} × ${item.h}</p>
        </div>
      `;
      thumbnailStrip.appendChild(card);
    });

    // Remove buttons
    thumbnailStrip.querySelectorAll('.thumb-remove').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        removeFile(parseInt(btn.dataset.idx));
      });
    });

    // Footer
    if (uploadedFiles.length > 0) {
      uploadFooter.style.display = 'flex';
      uploadCount.textContent = `${uploadedFiles.length} / ${MAX_FILES} images uploaded`;
    } else {
      uploadFooter.style.display = 'none';
    }
    previewCount.textContent = uploadedFiles.length;
  }

  function showPanels() {
    panelsSection.style.display = 'grid';
    statusBar.style.display = 'flex';
    renderPreviewRows();
    updateStatus();
  }

  function hidePanels() {
    panelsSection.style.display = 'none';
    statusBar.style.display = 'none';
  }

  /* ============================================================
     PREVIEW ROWS
     ============================================================ */
  function renderPreviewRows() {
    previewList.innerHTML = '';
    uploadedFiles.forEach((item, i) => {
      const hasTransform = !!transformedBlobs[i];
      const dims = computeOutputDims(item.w, item.h);
      const row = document.createElement('div');
      row.className = 'preview-row-item';

      let transThumbHTML;
      if (hasTransform) {
        transThumbHTML = `<div class="pr-trans-thumb"><img src="${transformedURLs[i]}" alt="Transformed"></div>`;
      } else {
        transThumbHTML = `<div class="pr-trans-placeholder"><i class="fa-solid fa-image"></i></div>`;
      }

      let sizeHTML;
      if (hasTransform) {
        sizeHTML = `
          <div class="pr-size-info">
            <span class="pr-format-badge">${getFormatLabel()}</span>
            <p class="pr-new-dims">${dims.w} × ${dims.h}</p>
            <p class="pr-new-size">${formatBytes(transformedBlobs[i].size)}</p>
          </div>`;
      } else {
        sizeHTML = `
          <div class="pr-size-info">
            <span class="pr-format-badge">${getFormatLabel()}</span>
            <p class="pr-new-dims">${dims.w} × ${dims.h}</p>
            <p class="pr-new-size" style="color:var(--text-400);">—</p>
          </div>`;
      }

      row.innerHTML = `
        <div class="pr-orig">
          <div class="pr-orig-thumb"><img src="${item.url}" alt="${item.file.name}"></div>
          <div class="pr-orig-info">
            <p class="pr-orig-name">${item.file.name}</p>
            <p class="pr-orig-dims">${item.w} × ${item.h}</p>
            <p class="pr-orig-size">${formatBytes(item.file.size)}</p>
          </div>
        </div>
        <div class="pr-arrow"><i class="fa-solid fa-arrow-right"></i></div>
        <div class="pr-trans">${transThumbHTML}</div>
        ${sizeHTML}
        <button class="pr-dl-btn" data-idx="${i}" ${!hasTransform ? 'disabled' : ''} title="Download"><i class="fa-solid fa-download"></i></button>
      `;
      previewList.appendChild(row);
    });

    // Download individual buttons
    previewList.querySelectorAll('.pr-dl-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        if (transformedBlobs[idx]) downloadBlob(transformedBlobs[idx], getOutputFilename(uploadedFiles[idx].file.name));
      });
    });
    previewCount.textContent = uploadedFiles.length;
  }

  /* ============================================================
     SETTINGS WIRING
     ============================================================ */

  // --- Aspect Ratio ---
  aspectRatioGrid.addEventListener('click', e => {
    const btn = e.target.closest('.ar-btn');
    if (!btn) return;
    aspectRatioGrid.querySelectorAll('.ar-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    settings.ratio = btn.dataset.ratio;
    updateDimNote();
    syncDimensionsFromRatio();
    clearTransformed();
    renderPreviewRows();
  });

  // --- Dimension mode toggle ---
  dimToggle.addEventListener('click', e => {
    const tab = e.target.closest('.dim-tab');
    if (!tab) return;
    dimToggle.querySelectorAll('.dim-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    settings.dimMode = tab.dataset.mode;
    dimInputs.style.display = settings.dimMode === 'dimensions' ? 'flex' : 'none';
    pctInputs.style.display = settings.dimMode === 'percentage' ? 'flex' : 'none';
    clearTransformed();
    renderPreviewRows();
  });

  // --- Width / Height inputs ---
  widthInput.addEventListener('input', () => {
    settings.width = parseInt(widthInput.value) || 1;
    if (settings.linked) syncHeight();
    clearTransformed();
    renderPreviewRows();
  });
  heightInput.addEventListener('input', () => {
    settings.height = parseInt(heightInput.value) || 1;
    if (settings.linked) syncWidth();
    clearTransformed();
    renderPreviewRows();
  });
  scaleInput.addEventListener('input', () => {
    settings.scale = parseInt(scaleInput.value) || 1;
    clearTransformed();
    renderPreviewRows();
  });

  // Steppers
  document.querySelectorAll('.stepper-up').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      input.value = parseInt(input.value || 0) + 1;
      input.dispatchEvent(new Event('input'));
    });
  });
  document.querySelectorAll('.stepper-down').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      input.value = Math.max(1, parseInt(input.value || 0) - 1);
      input.dispatchEvent(new Event('input'));
    });
  });

  // Chain link
  chainLink.addEventListener('click', () => {
    settings.linked = !settings.linked;
    chainLink.classList.toggle('active', settings.linked);
    if (settings.linked) syncHeight();
  });

  function syncHeight() {
    const ar = getCurrentAR();
    if (ar) {
      settings.height = Math.round(settings.width / ar);
      heightInput.value = settings.height;
    }
  }
  function syncWidth() {
    const ar = getCurrentAR();
    if (ar) {
      settings.width = Math.round(settings.height * ar);
      widthInput.value = settings.width;
    }
  }

  function getCurrentAR() {
    const r = ratioToNumber(settings.ratio);
    if (r) return r;
    // Use first image or width/height
    if (settings.ratio === 'original' && uploadedFiles.length) {
      return uploadedFiles[0].w / uploadedFiles[0].h;
    }
    if (settings.ratio === 'custom') return null;
    return settings.width / settings.height;
  }

  function syncDimensionsFromRatio() {
    const r = ratioToNumber(settings.ratio);
    if (!r) return;
    // Keep height, adjust width
    settings.width = Math.round(settings.height * r);
    widthInput.value = settings.width;
  }

  function updateDimNote() {
    const labels = {
      'original': 'Aspect ratio will be locked to original',
      '1:1': 'Aspect ratio will be locked to 1:1',
      '4:3': 'Aspect ratio will be locked to 4:3',
      '16:9': 'Aspect ratio will be locked to 16:9',
      '9:16': 'Aspect ratio will be locked to 9:16',
      'custom': 'Enter custom width and height',
    };
    dimNote.textContent = labels[settings.ratio] || '';
  }

  // --- Format ---
  formatBtns.addEventListener('click', e => {
    const btn = e.target.closest('.fmt-btn');
    if (!btn) return;
    formatBtns.querySelectorAll('.fmt-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    settings.format = btn.dataset.format;
    // Hide quality for PNG (lossless)
    qualityControl.style.display = settings.format === 'png' ? 'none' : 'flex';
    clearTransformed();
    renderPreviewRows();
  });

  // --- Quality slider ---
  qualitySlider.addEventListener('input', () => {
    settings.quality = parseInt(qualitySlider.value);
    qualityValue.textContent = settings.quality + '%';
    // Update track fill
    const pct = settings.quality;
    qualitySlider.style.background = `linear-gradient(to right,var(--indigo-500) ${pct}%,var(--border) ${pct}%)`;
    clearTransformed();
  });

  // --- Background ---
  bgBtns.addEventListener('click', e => {
    const btn = e.target.closest('.bg-btn');
    if (!btn) return;
    bgBtns.querySelectorAll('.bg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    settings.background = btn.dataset.bg;
    if (settings.background === 'custom') bgColorPicker.click();
    clearTransformed();
  });

  bgColorPicker.addEventListener('input', () => {
    settings.bgCustomColor = bgColorPicker.value;
    bgCustomSwatch.style.background = settings.bgCustomColor;
    clearTransformed();
  });

  // --- Toggle options ---
  optMaintainAR.addEventListener('change', () => { settings.maintainAR = optMaintainAR.checked; clearTransformed(); renderPreviewRows(); });
  optNoEnlarge.addEventListener('change', () => { settings.noEnlarge = optNoEnlarge.checked; clearTransformed(); renderPreviewRows(); });
  optAutoOrient.addEventListener('change', () => { settings.autoOrient = optAutoOrient.checked; clearTransformed(); });
  optRemoveMeta.addEventListener('change', () => { settings.removeMeta = optRemoveMeta.checked; clearTransformed(); });

  /* ============================================================
     COMPUTE OUTPUT DIMENSIONS
     ============================================================ */
  function computeOutputDims(origW, origH) {
    let w, h;

    if (settings.dimMode === 'percentage') {
      w = Math.round(origW * settings.scale / 100);
      h = Math.round(origH * settings.scale / 100);
    } else {
      w = settings.width;
      h = settings.height;
    }

    // Maintain aspect ratio
    if (settings.maintainAR && settings.dimMode === 'dimensions') {
      const targetAR = ratioToNumber(settings.ratio);
      if (targetAR) {
        // Fit within w x h while maintaining target AR
        if (w / h > targetAR) {
          w = Math.round(h * targetAR);
        } else {
          h = Math.round(w / targetAR);
        }
      } else if (settings.ratio === 'original') {
        const origAR = origW / origH;
        if (w / h > origAR) {
          w = Math.round(h * origAR);
        } else {
          h = Math.round(w / origAR);
        }
      }
    }

    // Do not enlarge
    if (settings.noEnlarge) {
      if (w > origW || h > origH) {
        const scale = Math.min(origW / w, origH / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
    }

    return { w: Math.max(1, w), h: Math.max(1, h) };
  }

  /* ============================================================
     TRANSFORM ENGINE
     ============================================================ */
  function clearTransformed() {
    transformedURLs.forEach(u => { if (u) URL.revokeObjectURL(u); });
    transformedBlobs = new Array(uploadedFiles.length).fill(null);
    transformedURLs = new Array(uploadedFiles.length).fill(null);
    updateStatus();
  }

  async function transformImage(index) {
    const item = uploadedFiles[index];
    if (!item) return;

    const dims = computeOutputDims(item.w, item.h);
    const canvas = document.createElement('canvas');
    canvas.width = dims.w;
    canvas.height = dims.h;
    const ctx = canvas.getContext('2d');

    // Background
    if (settings.background === 'white') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, dims.w, dims.h);
    } else if (settings.background === 'black') {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, dims.w, dims.h);
    } else if (settings.background === 'custom') {
      ctx.fillStyle = settings.bgCustomColor;
      ctx.fillRect(0, 0, dims.w, dims.h);
    } else if (settings.background === 'transparent') {
      // leave transparent — only works with PNG/WebP
    }
    // 'original' — draw image directly (any transparency is kept as-is)

    // Draw image with "cover" fitting into the target canvas
    let sx = 0, sy = 0, sw = item.w, sh = item.h;
    let dx = 0, dy = 0, dw = dims.w, dh = dims.h;

    // If aspect ratios differ, crop to fit (cover)
    const srcAR = item.w / item.h;
    const dstAR = dims.w / dims.h;
    if (Math.abs(srcAR - dstAR) > 0.01) {
      if (srcAR > dstAR) {
        // source is wider — crop width
        sw = Math.round(item.h * dstAR);
        sx = Math.round((item.w - sw) / 2);
      } else {
        // source is taller — crop height
        sh = Math.round(item.w / dstAR);
        sy = Math.round((item.h - sh) / 2);
      }
    }

    ctx.drawImage(item.img, sx, sy, sw, sh, dx, dy, dw, dh);

    // Export
    const mime = getOutputMime();
    const quality = settings.format === 'png' ? undefined : settings.quality / 100;

    return new Promise(resolve => {
      canvas.toBlob(blob => {
        if (transformedURLs[index]) URL.revokeObjectURL(transformedURLs[index]);
        transformedBlobs[index] = blob;
        transformedURLs[index] = URL.createObjectURL(blob);
        resolve();
      }, mime, quality);
    });
  }

  async function transformAll() {
    transformBtn.disabled = true;
    transformBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Transforming...';

    for (let i = 0; i < uploadedFiles.length; i++) {
      await transformImage(i);
    }

    renderPreviewRows();
    updateStatus();

    transformBtn.disabled = false;
    transformBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Transform Images';
  }

  transformBtn.addEventListener('click', () => {
    if (uploadedFiles.length === 0) return;
    transformAll();
  });

  previewAllBtn.addEventListener('click', () => {
    if (uploadedFiles.length === 0) return;
    transformAll();
  });

  /* ============================================================
     DOWNLOAD
     ============================================================ */
  function getOutputFilename(originalName) {
    const baseName = originalName.replace(/\.[^.]+$/, '');
    return `${baseName}_transformed.${getOutputExt()}`;
  }

  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  downloadAllBtn.addEventListener('click', () => {
    transformedBlobs.forEach((blob, i) => {
      if (blob) {
        setTimeout(() => {
          downloadBlob(blob, getOutputFilename(uploadedFiles[i].file.name));
        }, i * 200); // stagger to avoid browser blocking
      }
    });
  });

  /* ============================================================
     STATUS BAR
     ============================================================ */
  function updateStatus() {
    const count = uploadedFiles.length;
    statusTotal.textContent = `Total ${count} image${count !== 1 ? 's' : ''}`;

    const origSize = uploadedFiles.reduce((sum, f) => sum + f.file.size, 0);
    statusOrigSize.textContent = `Original size: ${formatBytes(origSize)}`;

    const transSize = transformedBlobs.reduce((sum, b) => sum + (b ? b.size : 0), 0);
    if (transSize > 0 && origSize > 0) {
      const pct = Math.round((1 - transSize / origSize) * 100);
      statusEstSize.textContent = `${formatBytes(transSize)} (${pct}% smaller)`;
    } else {
      statusEstSize.textContent = '—';
    }
  }

  /* ============================================================
     RESET ALL
     ============================================================ */
  resetAllBtn.addEventListener('click', () => {
    clearAll();
    // Reset settings to defaults
    settings.ratio = 'original';
    settings.dimMode = 'dimensions';
    settings.width = 1920;
    settings.height = 1080;
    settings.scale = 100;
    settings.format = 'jpeg';
    settings.quality = 85;
    settings.background = 'original';
    settings.linked = true;
    settings.maintainAR = true;
    settings.noEnlarge = true;
    settings.autoOrient = true;
    settings.removeMeta = false;

    // Reset UI
    aspectRatioGrid.querySelectorAll('.ar-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
    dimToggle.querySelectorAll('.dim-tab').forEach((t, i) => t.classList.toggle('active', i === 0));
    dimInputs.style.display = 'flex';
    pctInputs.style.display = 'none';
    widthInput.value = 1920;
    heightInput.value = 1080;
    scaleInput.value = 100;
    chainLink.classList.add('active');
    formatBtns.querySelectorAll('.fmt-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
    qualitySlider.value = 85;
    qualityValue.textContent = '85%';
    qualitySlider.style.background = `linear-gradient(to right,var(--indigo-500) 85%,var(--border) 85%)`;
    qualityControl.style.display = 'flex';
    bgBtns.querySelectorAll('.bg-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
    dimNote.textContent = 'Aspect ratio will be locked to original';
    optMaintainAR.checked = true;
    optNoEnlarge.checked = true;
    optAutoOrient.checked = true;
    optRemoveMeta.checked = false;
  });

  // Init quality slider track
  qualitySlider.style.background = `linear-gradient(to right,var(--indigo-500) 85%,var(--border) 85%)`;

})();
