/**
 * Image Transformer — Main Logic
 * Handles upload, transform settings, preview generation, and downloads.
 *
 * Bug fixes & improvements:
 * - Toast notification system for user feedback
 * - Per-image loading spinners during transform
 * - AVIF browser support detection with fallback warning
 * - Transparent background forces PNG/WebP output (JPG can't do transparency)
 * - Clean aspect ratio logic: Original uses per-image AR, Custom is freeform, presets use fixed AR
 * - noEnlarge now scales down the TARGET dimensions first, preserving AR intent
 * - GIF warning: Canvas can't preserve animation frames
 * - removeMeta is a no-op note (Canvas export already strips EXIF)
 * - Max canvas dimension guard (16384px) to prevent browser crashes
 * - File size limit (50 MB per file)
 */
(function () {
  'use strict';

  /* ============================================================
     CONSTANTS
     ============================================================ */
  const MAX_FILES = 7;
  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
  const MAX_CANVAS_DIM = 16384;           // browser hard limit
  const SUPPORTED = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'];
  const TRANSPARENCY_FORMATS = ['png', 'webp']; // formats that support alpha

  /* ============================================================
     STATE
     ============================================================ */
  let uploadedFiles = [];          // { file, url, img, w, h }
  let transformedBlobs = [];       // parallel array of Blob | null
  let transformedURLs = [];        // parallel array of objectURL | null
  let isTransforming = false;      // guard against double-clicks

  const settings = {
    ratio: 'original',
    dimMode: 'dimensions',
    width: 1920,
    height: 1080,
    scale: 100,
    format: 'jpeg',
    quality: 85,
    background: 'original',
    bgCustomColor: '#ff6600',
    maintainAR: true,
    noEnlarge: true,
    autoOrient: true,
    removeMeta: false,
    linked: true,
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

  const optMaintainAR = $('#optMaintainAR');
  const optNoEnlarge = $('#optNoEnlarge');
  const optAutoOrient = $('#optAutoOrient');
  const optRemoveMeta = $('#optRemoveMeta');

  const statusTotal = $('#statusTotal');
  const statusOrigSize = $('#statusOrigSize');
  const statusEstSize = $('#statusEstSize');

  /* ============================================================
     TOAST NOTIFICATION SYSTEM
     ============================================================ */
  const toastContainer = document.createElement('div');
  toastContainer.id = 'toastContainer';
  toastContainer.className = 'toast-container';
  document.body.appendChild(toastContainer);

  /**
   * Show a toast message.
   * @param {string} message
   * @param {'info'|'success'|'warning'|'error'} type
   * @param {number} duration — ms before auto-dismiss (0 = sticky)
   */
  function showToast(message, type = 'info', duration = 4000) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icons = {
      info: 'fa-circle-info',
      success: 'fa-circle-check',
      warning: 'fa-triangle-exclamation',
      error: 'fa-circle-xmark',
    };
    toast.innerHTML = `<i class="fa-solid ${icons[type]}"></i><span>${message}</span>`;
    toastContainer.appendChild(toast);
    // Trigger enter animation
    requestAnimationFrame(() => toast.classList.add('toast-visible'));
    if (duration > 0) {
      setTimeout(() => dismissToast(toast), duration);
    }
    return toast;
  }

  function dismissToast(toast) {
    toast.classList.remove('toast-visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    // Fallback removal
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 500);
  }

  /* ============================================================
     FEATURE DETECTION
     ============================================================ */
  let avifSupported = true; // optimistic default
  (function detectAVIF() {
    const img = new Image();
    img.onload = () => { avifSupported = img.width > 0; };
    img.onerror = () => { avifSupported = false; };
    // Tiny 1×1 AVIF encoded
    img.src = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAABcAAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAEAAAABAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQAMAAAAABNjb2xybmNseAACAAIABoAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAAB9tZGF0EgAKBzgADlAgIGkyCR/wAABAAACkA';
  })();

  /* ============================================================
     UTILITY
     ============================================================ */
  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
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

  /**
   * Returns the numeric aspect ratio for a preset string, or null for 'original'/'custom'.
   */
  function ratioToNumber(r) {
    if (r === 'original' || r === 'custom') return null;
    const parts = r.split(':');
    return parseInt(parts[0]) / parseInt(parts[1]);
  }

  /**
   * Get the effective output format, accounting for transparency constraints.
   * If user chose transparent bg + JPG/AVIF, we silently upgrade to PNG.
   */
  function getEffectiveFormat() {
    if (settings.background === 'transparent' && !TRANSPARENCY_FORMATS.includes(settings.format)) {
      return 'png'; // fallback — JPG/AVIF can't do transparency
    }
    return settings.format;
  }

  function getEffectiveMime() {
    const f = getEffectiveFormat();
    const map = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' };
    return map[f] || 'image/jpeg';
  }

  function getEffectiveExt() {
    const f = getEffectiveFormat();
    const map = { jpeg: 'jpg', png: 'png', webp: 'webp', avif: 'avif' };
    return map[f] || 'jpg';
  }

  function getEffectiveLabel() {
    const f = getEffectiveFormat();
    const map = { jpeg: 'JPG', png: 'PNG', webp: 'WebP', avif: 'AVIF' };
    return map[f] || 'JPG';
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
    if (remaining <= 0) {
      showToast(`Maximum ${MAX_FILES} images allowed.`, 'warning');
      return;
    }

    const allFiles = Array.from(fileList);

    // Filter unsupported types with feedback
    const unsupported = allFiles.filter(f => !SUPPORTED.includes(f.type));
    if (unsupported.length) {
      showToast(`${unsupported.length} file(s) skipped — unsupported format.`, 'warning');
    }

    let files = allFiles.filter(f => SUPPORTED.includes(f.type));

    // Filter oversized files
    const oversized = files.filter(f => f.size > MAX_FILE_SIZE);
    if (oversized.length) {
      showToast(`${oversized.length} file(s) skipped — exceeds 50 MB limit.`, 'warning');
      files = files.filter(f => f.size <= MAX_FILE_SIZE);
    }

    // Warn about GIF animation loss
    const gifs = files.filter(f => f.type === 'image/gif');
    if (gifs.length) {
      showToast('GIF files will be converted to static images (animation is not preserved).', 'info', 5000);
    }

    files = files.slice(0, remaining);
    if (!files.length) return;

    let loaded = 0;
    let errors = 0;
    files.forEach(file => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        // Guard against absurdly large images
        if (img.naturalWidth > MAX_CANVAS_DIM || img.naturalHeight > MAX_CANVAS_DIM) {
          showToast(`"${file.name}" is too large (${img.naturalWidth}×${img.naturalHeight}). Max ${MAX_CANVAS_DIM}px per side.`, 'error', 6000);
          URL.revokeObjectURL(url);
          errors++;
        } else {
          uploadedFiles.push({ file, url, img, w: img.naturalWidth, h: img.naturalHeight });
        }
        loaded++;
        if (loaded === files.length) {
          renderThumbnails();
          if (uploadedFiles.length > 0) {
            showPanels();
          }
          clearTransformed();
          if (errors === 0 && uploadedFiles.length > 0) {
            showToast(`${files.length - errors} image(s) loaded successfully.`, 'success', 2500);
          }
        }
      };
      img.onerror = () => {
        showToast(`Failed to load "${file.name}".`, 'error');
        URL.revokeObjectURL(url);
        errors++;
        loaded++;
        if (loaded === files.length) {
          renderThumbnails();
          if (uploadedFiles.length > 0) showPanels();
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

    thumbnailStrip.querySelectorAll('.thumb-remove').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        removeFile(parseInt(btn.dataset.idx));
      });
    });

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
      row.id = `preview-row-${i}`;

      let transThumbHTML;
      if (hasTransform) {
        transThumbHTML = `<div class="pr-trans-thumb"><img src="${transformedURLs[i]}" alt="Transformed"></div>`;
      } else {
        transThumbHTML = `<div class="pr-trans-placeholder"><i class="fa-solid fa-image"></i></div>`;
      }

      const effLabel = getEffectiveLabel();

      let sizeHTML;
      if (hasTransform) {
        sizeHTML = `
          <div class="pr-size-info">
            <span class="pr-format-badge">${effLabel}</span>
            <p class="pr-new-dims">${dims.w} × ${dims.h}</p>
            <p class="pr-new-size">${formatBytes(transformedBlobs[i].size)}</p>
          </div>`;
      } else {
        sizeHTML = `
          <div class="pr-size-info">
            <span class="pr-format-badge">${effLabel}</span>
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

    previewList.querySelectorAll('.pr-dl-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        if (transformedBlobs[idx]) downloadBlob(transformedBlobs[idx], getOutputFilename(uploadedFiles[idx].file.name));
      });
    });
    previewCount.textContent = uploadedFiles.length;
  }

  /**
   * Show a per-row loading spinner (replaces the transform-preview column temporarily).
   */
  function setRowLoading(index, loading) {
    const row = document.getElementById(`preview-row-${index}`);
    if (!row) return;
    const transCol = row.querySelector('.pr-trans');
    if (!transCol) return;
    if (loading) {
      transCol.innerHTML = `<div class="pr-trans-placeholder pr-loading"><i class="fa-solid fa-spinner fa-spin"></i></div>`;
    }
    // When loading finishes, renderPreviewRows() will replace the content
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
    if (settings.linked) {
      syncHeight();
      clearTransformed();
      renderPreviewRows();
    }
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

  /**
   * Returns the aspect ratio for the current setting.
   * - Preset (1:1, 4:3, etc.): returns the numeric ratio.
   * - Original: returns the first uploaded image's AR (or null if none).
   * - Custom: always returns null (user controls w/h independently).
   */
  function getCurrentAR() {
    const r = ratioToNumber(settings.ratio);
    if (r) return r;
    if (settings.ratio === 'original' && uploadedFiles.length) {
      return uploadedFiles[0].w / uploadedFiles[0].h;
    }
    // 'custom' or no images loaded — no forced AR
    return null;
  }

  function syncDimensionsFromRatio() {
    const r = ratioToNumber(settings.ratio);
    if (!r) return;
    settings.width = Math.round(settings.height * r);
    widthInput.value = settings.width;
  }

  function updateDimNote() {
    if (settings.ratio === 'custom') {
      dimNote.textContent = 'Enter custom width and height';
    } else if (settings.ratio === 'original') {
      dimNote.textContent = 'Aspect ratio will be locked to original';
    } else {
      dimNote.textContent = `Aspect ratio will be locked to ${settings.ratio}`;
    }
  }

  // --- Format ---
  formatBtns.addEventListener('click', e => {
    const btn = e.target.closest('.fmt-btn');
    if (!btn) return;

    const newFormat = btn.dataset.format;

    // AVIF check
    if (newFormat === 'avif' && !avifSupported) {
      showToast('AVIF is not supported in this browser. Output may fail or fall back.', 'warning', 5000);
    }

    formatBtns.querySelectorAll('.fmt-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    settings.format = newFormat;

    // Hide quality for PNG (lossless)
    qualityControl.style.display = settings.format === 'png' ? 'none' : 'flex';

    // Warn if transparent bg + non-transparent format
    checkTransparencyCompat();

    clearTransformed();
    renderPreviewRows();
  });

  // --- Quality slider ---
  qualitySlider.addEventListener('input', () => {
    settings.quality = parseInt(qualitySlider.value);
    qualityValue.textContent = settings.quality + '%';
    const pct = settings.quality;
    qualitySlider.style.background = `linear-gradient(to right,var(--indigo-500) ${pct}%,var(--border) ${pct}%)`;
    clearTransformed();
    renderPreviewRows();
  });

  // --- Background ---
  bgBtns.addEventListener('click', e => {
    const btn = e.target.closest('.bg-btn');
    if (!btn) return;
    bgBtns.querySelectorAll('.bg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    settings.background = btn.dataset.bg;
    if (settings.background === 'custom') bgColorPicker.click();

    checkTransparencyCompat();
    clearTransformed();
    renderPreviewRows();
  });

  bgColorPicker.addEventListener('input', () => {
    settings.bgCustomColor = bgColorPicker.value;
    bgCustomSwatch.style.background = settings.bgCustomColor;
    clearTransformed();
    renderPreviewRows();
  });

  /**
   * If user picks transparent bg + a format that doesn't support it,
   * show a one-time warning. The engine will silently output as PNG.
   */
  function checkTransparencyCompat() {
    if (settings.background === 'transparent' && !TRANSPARENCY_FORMATS.includes(settings.format)) {
      showToast(`Transparent background requires PNG or WebP. Output will be saved as PNG instead of ${getFormatLabel()}.`, 'warning', 5000);
    }
  }

  // --- Toggle options ---
  optMaintainAR.addEventListener('change', () => { settings.maintainAR = optMaintainAR.checked; clearTransformed(); renderPreviewRows(); });
  optNoEnlarge.addEventListener('change', () => { settings.noEnlarge = optNoEnlarge.checked; clearTransformed(); renderPreviewRows(); });
  optAutoOrient.addEventListener('change', () => { settings.autoOrient = optAutoOrient.checked; clearTransformed(); renderPreviewRows(); });
  optRemoveMeta.addEventListener('change', () => {
    settings.removeMeta = optRemoveMeta.checked;
    // Canvas export always strips most metadata. This toggle is informational.
    if (optRemoveMeta.checked) {
      showToast('Canvas-based export already strips EXIF and most metadata by default.', 'info', 3000);
    }
    clearTransformed();
    renderPreviewRows();
  });

  /* ============================================================
     COMPUTE OUTPUT DIMENSIONS
     ============================================================
     Clear order of operations:
     1. Determine base target size (from dimensions or percentage)
     2. Apply aspect ratio constraint (if maintainAR && dimensions mode)
     3. Apply noEnlarge cap (scale down proportionally if target > original)
     4. Clamp to MAX_CANVAS_DIM
  */
  function computeOutputDims(origW, origH) {
    let w, h;

    // Step 1: Base target size
    if (settings.dimMode === 'percentage') {
      w = Math.round(origW * settings.scale / 100);
      h = Math.round(origH * settings.scale / 100);
    } else {
      w = settings.width;
      h = settings.height;
    }

    // Step 2: Aspect ratio constraint (only in dimensions mode + maintainAR on)
    if (settings.maintainAR && settings.dimMode === 'dimensions') {
      let targetAR;
      if (settings.ratio === 'original') {
        targetAR = origW / origH;
      } else if (settings.ratio === 'custom') {
        // Custom: user explicitly controls both dimensions, no AR enforcement
        targetAR = null;
      } else {
        targetAR = ratioToNumber(settings.ratio);
      }

      if (targetAR !== null) {
        // Fit within the specified w×h box while locking the target AR
        const boxAR = w / h;
        if (boxAR > targetAR) {
          // box is wider than target AR → shrink width
          w = Math.round(h * targetAR);
        } else {
          // box is taller than target AR → shrink height
          h = Math.round(w / targetAR);
        }
      }
    }

    // Defensive guard: ensure dimensions never reach 0 after aspect ratio math
    w = Math.max(1, w);
    h = Math.max(1, h);

    // Step 3: Do not enlarge — scale down proportionally if target exceeds original
    if (settings.noEnlarge) {
      const scaleX = origW / w;
      const scaleY = origH / h;
      if (scaleX < 1 || scaleY < 1) {
        const s = Math.min(scaleX, scaleY, 1);
        w = Math.round(w * s);
        h = Math.round(h * s);
      }
    }

    // Step 4: Hard clamp to browser canvas limits
    w = Math.min(Math.max(1, w), MAX_CANVAS_DIM);
    h = Math.min(Math.max(1, h), MAX_CANVAS_DIM);

    return { w, h };
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

    // --- Auto-orient handling ---
    // Browsers auto-orient <img> elements by default (CSS image-orientation: from-image).
    // When autoOrient is disabled, use createImageBitmap with 'none' to bypass EXIF rotation.
    let drawSource = item.img;
    let srcW = item.w, srcH = item.h;
    if (!settings.autoOrient && typeof createImageBitmap === 'function') {
      try {
        const bmp = await createImageBitmap(item.file, { imageOrientation: 'none' });
        drawSource = bmp;
        srcW = bmp.width;
        srcH = bmp.height;
      } catch (e) {
        // Browser doesn't support imageOrientation option; fall back silently
      }
    }

    const dims = computeOutputDims(srcW, srcH);

    // Determine the effective output format (respects transparency constraints)
    const effFormat = getEffectiveFormat();
    const effMime = getEffectiveMime();
    const quality = effFormat === 'png' ? undefined : settings.quality / 100;

    const canvas = document.createElement('canvas');
    canvas.width = dims.w;
    canvas.height = dims.h;
    const ctx = canvas.getContext('2d');

    // --- Background handling ---
    if (settings.background === 'transparent') {
      // Transparent: clear the canvas (alpha = 0 everywhere)
      // The effective format is guaranteed to support transparency (PNG/WebP)
      ctx.clearRect(0, 0, dims.w, dims.h);
    } else if (settings.background === 'white') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, dims.w, dims.h);
    } else if (settings.background === 'black') {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, dims.w, dims.h);
    } else if (settings.background === 'custom') {
      ctx.fillStyle = settings.bgCustomColor;
      ctx.fillRect(0, 0, dims.w, dims.h);
    } else {
      // 'original' — for JPG output, fill white first to avoid black areas
      // where transparency was in the original image
      if (effFormat === 'jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, dims.w, dims.h);
      }
    }

    // --- Draw image with "contain" fitting — scale to fit, NO cropping ---
    let dx = 0, dy = 0, dw = dims.w, dh = dims.h;
    const srcAR = srcW / srcH;
    const dstAR = dims.w / dims.h;

    if (Math.abs(srcAR - dstAR) > 0.01) {
      if (srcAR > dstAR) {
        // Source wider → fit to width, letterbox top/bottom
        dw = dims.w;
        dh = Math.round(dims.w / srcAR);
        dy = Math.round((dims.h - dh) / 2);
      } else {
        // Source taller → fit to height, pillarbox left/right
        dh = dims.h;
        dw = Math.round(dims.h * srcAR);
        dx = Math.round((dims.w - dw) / 2);
      }
    }

    ctx.drawImage(drawSource, 0, 0, srcW, srcH, dx, dy, dw, dh);

    // Clean up ImageBitmap if one was created for auto-orient bypass
    if (drawSource !== item.img && typeof drawSource.close === 'function') drawSource.close();

    // --- Export ---
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob(blob => {
          if (!blob) {
            // toBlob can return null if format is unsupported (e.g., AVIF on some browsers)
            showToast(`Failed to encode "${item.file.name}" as ${getEffectiveLabel()}. Try a different format.`, 'error', 5000);
            resolve(); // don't reject — continue with other images
            return;
          }
          if (transformedURLs[index]) URL.revokeObjectURL(transformedURLs[index]);
          transformedBlobs[index] = blob;
          transformedURLs[index] = URL.createObjectURL(blob);
          resolve();
        }, effMime, quality);
      } catch (err) {
        showToast(`Error processing "${item.file.name}": ${err.message}`, 'error', 6000);
        resolve(); // continue with remaining images
      }
    });
  }

  async function transformAll() {
    if (isTransforming) return;
    isTransforming = true;

    transformBtn.disabled = true;
    previewAllBtn.disabled = true;
    transformBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Transforming...';

    // Check AVIF support before batch
    if (settings.format === 'avif' && !avifSupported) {
      showToast('AVIF encoding may not work in this browser. Consider using WebP or JPG.', 'warning', 5000);
    }

    let successCount = 0;
    for (let i = 0; i < uploadedFiles.length; i++) {
      setRowLoading(i, true);
      await transformImage(i);
      if (transformedBlobs[i]) successCount++;
      // Yield to the browser to keep UI responsive
      await new Promise(r => setTimeout(r, 10));
    }

    renderPreviewRows();
    updateStatus();

    transformBtn.disabled = false;
    previewAllBtn.disabled = false;
    transformBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Transform Images';
    isTransforming = false;

    if (successCount === uploadedFiles.length) {
      showToast(`All ${successCount} images transformed successfully!`, 'success', 3000);
    } else if (successCount > 0) {
      showToast(`${successCount} of ${uploadedFiles.length} images transformed. Some failed.`, 'warning', 4000);
    } else {
      showToast('All transformations failed. Try a different format.', 'error', 5000);
    }
  }

  transformBtn.addEventListener('click', () => {
    if (uploadedFiles.length === 0) {
      showToast('Upload at least one image first.', 'info');
      return;
    }
    transformAll();
  });

  previewAllBtn.addEventListener('click', () => {
    if (uploadedFiles.length === 0) {
      showToast('Upload at least one image first.', 'info');
      return;
    }
    transformAll();
  });

  /* ============================================================
     DOWNLOAD
     ============================================================ */
  function getOutputFilename(originalName) {
    const baseName = originalName.replace(/\.[^.]+$/, '');
    return `${baseName}_transformed.${getEffectiveExt()}`;
  }

  /**
   * Trigger a direct file download from a Blob.
   * NOTE: Does NOT revoke the objectURL — the caller manages lifecycle.
   */
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke after a brief delay so the browser has time to start the download
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /**
   * Download all transformed images.
   * - 1 image  → direct download
   * - 2+ images → zipped via JSZip (single file, no popup-blocker issues)
   */
  downloadAllBtn.addEventListener('click', async () => {
    const available = transformedBlobs
      .map((blob, i) => ({ blob, i }))
      .filter(({ blob }) => blob !== null);

    if (available.length === 0) {
      showToast('Transform images first before downloading.', 'info');
      return;
    }

    // Single file — just download directly
    if (available.length === 1) {
      const { blob, i } = available[0];
      downloadBlob(blob, getOutputFilename(uploadedFiles[i].file.name));
      showToast('Downloading 1 image…', 'success', 2000);
      return;
    }

    // Multiple files — bundle into a ZIP
    downloadAllBtn.disabled = true;
    const originalBtnHTML = downloadAllBtn.innerHTML;
    downloadAllBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating ZIP…';

    try {
      if (typeof JSZip === 'undefined') {
        throw new Error('JSZip not loaded. Check your internet connection.');
      }

      const zip = new JSZip();
      const folder = zip.folder('transformed_images');

      available.forEach(({ blob, i }) => {
        folder.file(getOutputFilename(uploadedFiles[i].file.name), blob);
      });

      const zipBlob = await zip.generateAsync(
        { type: 'blob', compression: 'STORE' }, // STORE = no extra compression (images already compressed)
        metadata => {
          // Live progress in the button
          const pct = Math.round(metadata.percent);
          downloadAllBtn.innerHTML = `<i class="fa-solid fa-file-zipper"></i> Zipping… ${pct}%`;
        }
      );

      downloadBlob(zipBlob, 'transformed_images.zip');
      showToast(`ZIP ready — ${available.length} images bundled.`, 'success', 3000);
      // Windows SmartScreen tip — shown once per session
      if (!sessionStorage.getItem('zipTipShown')) {
        sessionStorage.setItem('zipTipShown', '1');
        setTimeout(() => {
          showToast('Windows tip: If extraction shows a security warning, right-click the ZIP → Properties → Unblock → OK.', 'info', 8000);
        }, 1500);
      }
    } catch (err) {
      showToast(`Download failed: ${err.message}`, 'error', 6000);
    } finally {
      downloadAllBtn.disabled = false;
      downloadAllBtn.innerHTML = originalBtnHTML;
    }
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
      const label = pct >= 0 ? `${pct}% smaller` : `${Math.abs(pct)}% larger`;
      statusEstSize.textContent = `${formatBytes(transSize)} (${label})`;
      statusEstSize.style.color = pct >= 0 ? 'var(--green-500)' : 'var(--red-500)';
    } else {
      statusEstSize.textContent = '—';
      statusEstSize.style.color = '';
    }
  }

  /* ============================================================
     RESET ALL
     ============================================================ */
  resetAllBtn.addEventListener('click', () => {
    clearAll();
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

    showToast('All settings reset to defaults.', 'info', 2000);
  });

  // Init quality slider track
  qualitySlider.style.background = `linear-gradient(to right,var(--indigo-500) 85%,var(--border) 85%)`;

})();
