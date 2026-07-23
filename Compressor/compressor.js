/**
 * Image Compressor — compressor.js
 *
 * Features:
 *  - Drag & drop or click-to-browse (up to 10 images, any common format)
 *  - Per-image preview thumbnail, file name, dimensions, original size
 *  - Quality slider (1–100%) + three compression modes
 *  - Estimated compressed size using Canvas + quality coefficient
 *  - In-browser compression via HTMLCanvasElement.toBlob()
 *  - Per-row download + "Download All" (JSZip-free, sequential)
 *  - Live compression summary (total original, estimated, savings %)
 *  - Toast notifications
 */

(function () {
    'use strict';

    /* ========================================================
       Constants & State
    ======================================================== */
    const MAX_FILES = 10;
    const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
    const ACCEPT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/avif',
        'image/gif', 'image/bmp', 'image/tiff'];

    // Mode quality presets — only these three keys are valid values for currentMode.
    const MODE_QUALITY = {
        'balanced': 0.80,
        'max-savings': 0.50,
        'max-quality': 0.95,
    };

    let images = [];   // Array of image entry objects
    let currentMode = 'balanced'; // always one of the MODE_QUALITY keys
    let currentQ = 0.80;          // source of truth for actual compression quality (0–1)

    /* ========================================================
       DOM helper — fails loudly if a required element is absent
       so developers catch mismatches immediately on load instead
       of encountering a cryptic null-access later.
    ======================================================== */
    function getEl(id) {
        const el = document.getElementById(id);
        if (!el) throw new Error(`[Compressor] Required DOM element #${id} not found. Check your HTML.`);
        return el;
    }

    /* ========================================================
       DOM Refs — all via getEl() so a missing element throws
       a clear error at startup rather than a null crash later.
    ======================================================== */
    const dropzone      = getEl('dropzone');
    const fileInput     = getEl('fileInput');
    const listSection   = getEl('listSection');
    const imageTableBody = getEl('imageTableBody');
    const imageCountHead = getEl('imageCountHeading');
    const clearAllBtn   = getEl('clearAllBtn');
    const compressBtn   = getEl('compressBtn');
    const downloadAllBtn = getEl('downloadAllBtn');
    const qualitySlider = getEl('qualitySlider');
    const qualityDisplay = getEl('qualityDisplay');
    const modeCards     = document.querySelectorAll('.mode-card'); // NodeList, not nullable
    const sumOriginal   = getEl('sumOriginal');
    const sumEstimated  = getEl('sumEstimated');
    const sumSavings    = getEl('sumSavings');

    // How It Works modal
    const howItWorksBtn = getEl('howItWorksBtn');
    const hiwBackdrop   = getEl('hiwBackdrop');
    const hiwClose      = getEl('hiwClose');
    const hiwGotIt      = getEl('hiwGotIt');

    /* ========================================================
       How It Works — Modal Logic
    ======================================================== */
    function openHiw() {
        hiwBackdrop.removeAttribute('hidden');
        document.body.style.overflow = 'hidden';
        hiwClose.focus();
    }
    function closeHiw() {
        hiwBackdrop.setAttribute('hidden', '');
        document.body.style.overflow = '';
        howItWorksBtn.focus();
    }

    howItWorksBtn.addEventListener('click', openHiw);
    hiwClose.addEventListener('click', closeHiw);
    hiwGotIt.addEventListener('click', closeHiw);

    // Close on backdrop click (outside modal card)
    hiwBackdrop.addEventListener('click', e => {
        if (e.target === hiwBackdrop) closeHiw();
    });

    // Close on Escape
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !hiwBackdrop.hasAttribute('hidden')) closeHiw();
    });

    /* ========================================================
       Slider — quality
    ======================================================== */
    qualitySlider.addEventListener('input', () => {
        const val = parseInt(qualitySlider.value, 10);
        currentQ = val / 100; // currentQ is always the authoritative quality value
        qualityDisplay.textContent = val + '%';
        updateSliderTrack();

        // Sync the active-card highlight to whichever preset matches the slider value
        // (if any). currentMode keeps its last explicitly-chosen value and is only
        // updated here when the slider happens to land on a preset — this avoids ever
        // setting currentMode to an undefined key like 'custom'.
        let matched = false;
        modeCards.forEach(c => {
            const presetVal = Math.round((MODE_QUALITY[c.dataset.mode] ?? NaN) * 100);
            if (presetVal === val) {
                c.classList.add('active');
                currentMode = c.dataset.mode; // slider landed exactly on a known preset
                matched = true;
            } else {
                c.classList.remove('active');
            }
        });
        // If no preset matched, leave currentMode unchanged (it still reflects the
        // last explicitly selected mode) and simply show no card as active.
        void matched; // suppress unused-variable lints

        recomputeEstimates();
    });

    function updateSliderTrack() {
        const val = parseFloat(qualitySlider.value);
        const min = parseFloat(qualitySlider.min) || 1;
        const max = parseFloat(qualitySlider.max) || 100;
        const pct = ((val - min) / (max - min)) * 100;
        qualitySlider.style.background =
            `linear-gradient(to right, var(--indigo-500) ${pct}%, var(--border) ${pct}%)`;
    }
    updateSliderTrack(); // init

    // Position slider labels correctly based on their actual value on the track
    function positionSliderLabels() {
        const labelsWrap = document.querySelector('.slider-labels');
        if (!labelsWrap) return;
        const labels = labelsWrap.querySelectorAll('span[data-value]');
        const min = parseFloat(qualitySlider.min) || 1;
        const max = parseFloat(qualitySlider.max) || 100;
        labels.forEach(lbl => {
            const v = parseFloat(lbl.dataset.value);
            const pct = ((v - min) / (max - min)) * 100;
            lbl.style.left = `${pct}%`;
        });
    }
    positionSliderLabels();

    /* ========================================================
       Mode Cards
    ======================================================== */
    modeCards.forEach(card => {
        card.addEventListener('click', () => {
            modeCards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            currentMode = card.dataset.mode;

            // Sync slider to mode preset
            const preset = Math.round(MODE_QUALITY[currentMode] * 100);
            qualitySlider.value = preset;
            currentQ = MODE_QUALITY[currentMode];
            qualityDisplay.textContent = preset + '%';
            updateSliderTrack();
            recomputeEstimates();
        });
    });

    /* ========================================================
       Drag & Drop
    ======================================================== */
    dropzone.addEventListener('dragover', e => {
        e.preventDefault();
        dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('dragover');
    });
    dropzone.addEventListener('drop', e => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        addFiles(Array.from(e.dataTransfer.files));
    });
    dropzone.addEventListener('click', e => {
        // Don't trigger if clicking the label (it already opens the input)
        if (e.target.tagName !== 'LABEL') {
            fileInput.click();
        }
    });
    dropzone.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInput.click();
        }
    });
    fileInput.addEventListener('change', () => {
        addFiles(Array.from(fileInput.files));
        fileInput.value = ''; // reset so same file can be added again after removal
    });

    /* ========================================================
       File Ingestion
    ======================================================== */
    function addFiles(files) {
        const remaining = MAX_FILES - images.length;
        if (remaining <= 0) {
            showToast(`Maximum ${MAX_FILES} images allowed.`, 'error');
            return;
        }

        let added = 0;
        let skipped = 0;

        const toProcess = files.slice(0, remaining);

        toProcess.forEach(file => {
            if (!ACCEPT_TYPES.includes(file.type)) {
                skipped++;
                return;
            }
            if (file.size > MAX_SIZE_BYTES) {
                showToast(`"${file.name}" exceeds 10 MB limit and was skipped.`, 'error');
                skipped++;
                return;
            }
            // FIX (Bug 6): name + size + lastModified is a much stronger duplicate signal.
            // name+size alone causes false positives (different files, same name/size)
            // and false negatives (same file renamed to something else).
            const isDupe = images.some(img =>
                img.file.name === file.name &&
                img.file.size === file.size &&
                img.file.lastModified === file.lastModified
            );
            if (isDupe) {
                skipped++;
                return;
            }

            const entry = {
                id: generateId(),
                file: file,
                objectURL: URL.createObjectURL(file),
                width: 0,
                height: 0,
                originalSize: file.size,
                estimatedSize: 0,
                status: 'ready',      // ready | compressing | done | error
                compressedBlob: null,
                compressedURL: null,
            };

            images.push(entry);
            added++;

            // Load dimensions asynchronously, then render
            loadImageDimensions(entry).then(() => {
                entry.estimatedSize = computeEstimatedSize(entry);
                renderTable();
                updateSummary();
            });
        });

        if (added > 0 || images.length > 0) {
            renderTable();
            updateSummary();
            listSection.removeAttribute('hidden');
        }

        if (skipped > 0 && added === 0) {
            showToast('Some files were invalid or already added.', 'info');
        }
        if (files.length > remaining) {
            showToast(`Only ${remaining} more image(s) can be added (max ${MAX_FILES}).`, 'info');
        }
    }

    // FIX (Bug 7): onerror now logs a warning instead of silently resolving.
    // width/height remain 0 and the dimension string is safely omitted from display.
    function loadImageDimensions(entry) {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                entry.width  = img.naturalWidth;
                entry.height = img.naturalHeight;
                resolve();
            };
            img.onerror = () => {
                console.warn(`Could not load image dimensions for "${entry.file.name}". Width/height will be omitted.`);
                resolve(); // don't block the pipeline; width/height stay 0
            };
            img.src = entry.objectURL;
        });
    }

    /* ========================================================
       Output MIME resolution
       FIX (Bug 2): AVIF, GIF, BMP, TIFF fall back to WebP, not JPEG.
       WebP is smaller than JPEG and supports transparency, making it
       a strictly better fallback for unsupported input formats.
    ======================================================== */
    function resolveOutputMime(inputType) {
        switch (inputType) {
            case 'image/png':  return 'image/png';   // lossless + transparency preserved
            case 'image/jpeg': return 'image/jpeg';
            case 'image/webp': return 'image/webp';
            default:           return 'image/webp';  // AVIF, GIF, BMP, TIFF → WebP
        }
    }

    /* ========================================================
       Estimated size computation (heuristic)

       Important notes on accuracy:
       - JPEG / WebP: the quality param has a real, roughly linear effect
         on output size, so a formula based on currentQ is reasonable.
       - PNG: the Canvas API completely ignores the quality parameter for
         PNG output (it is always lossless). Using a quality-dependent
         formula here would produce nonsense numbers, so PNG gets a fixed
         ratio that reflects typical canvas re-encode overhead (~92% of
         the source). Results for already-optimised PNGs may still be
         higher than the actual toBlob output; that is unavoidable without
         running a speculative encode.
    ======================================================== */
    function computeEstimatedSize(entry) {
        const originalSize = entry.originalSize;
        const mimeOut = resolveOutputMime(entry.file.type);
        const q = currentQ; // 0–1; authoritative quality used by compressOne()

        let ratio;
        if (mimeOut === 'image/png') {
            // PNG output is always lossless — quality param is ignored by toBlob().
            // Canvas typically re-encodes at ~90–95% of a well-optimised source;
            // use a fixed constant rather than a misleading quality-dependent formula.
            ratio = 0.92;
        } else if (mimeOut === 'image/jpeg') {
            // Empirically: size ≈ 8% overhead floor + 82% quality-proportional body.
            ratio = 0.08 + q * 0.82;
        } else if (mimeOut === 'image/webp') {
            if (entry.file.type === 'image/png') {
                // Lossless PNG → lossy WebP: large savings are typical.
                ratio = 0.04 + q * 0.50;
            } else {
                // WebP → WebP or other lossy → WebP re-encode.
                ratio = 0.04 + q * 0.72;
            }
        } else {
            ratio = 0.05 + q * 0.75;
        }

        // Cap at 0.99: we never claim the output will be larger than the original.
        ratio = Math.min(ratio, 0.99);
        return Math.max(Math.round(originalSize * ratio), 512); // floor at 512 B
    }

    function recomputeEstimates() {
        images.forEach(entry => {
            if (entry.status !== 'done') {
                entry.estimatedSize = computeEstimatedSize(entry);
            }
        });
        renderTable();
        updateSummary();
    }

    /* ========================================================
       Render Table
    ======================================================== */
    function renderTable() {
        imageCountHead.textContent = `Added Images (${images.length})`;

        if (images.length === 0) {
            listSection.setAttribute('hidden', '');
            return;
        }

        imageTableBody.innerHTML = '';

        images.forEach(entry => {
            const isDone = entry.status === 'done' && entry.compressedBlob;
            const displaySize = isDone ? entry.compressedBlob.size : entry.estimatedSize;
            const savingBytes = entry.originalSize - displaySize;
            const savingPct   = entry.originalSize > 0
                ? Math.round((savingBytes / entry.originalSize) * 100)
                : 0;

            const tr = document.createElement('tr');

            // Preview
            const tdPrev = document.createElement('td');
            tdPrev.className = 'col-preview';
            const img = document.createElement('img');
            img.src = entry.objectURL;
            img.className = 'img-thumb';
            img.alt = entry.file.name;
            img.loading = 'lazy';
            tdPrev.appendChild(img);
            tr.appendChild(tdPrev);

            // File name
            const tdName = document.createElement('td');
            tdName.className = 'col-name';
            const nameWrap = document.createElement('div');
            nameWrap.className = 'file-name-cell';
            const nameStrong = document.createElement('strong');
            nameStrong.textContent = entry.file.name;
            const nameSub = document.createElement('span');
            const typeName = entry.file.type.replace('image/', '').toUpperCase();
            nameSub.textContent = `${typeName}${entry.width ? ' • ' + entry.width + ' × ' + entry.height : ''}`;
            nameWrap.appendChild(nameStrong);
            nameWrap.appendChild(nameSub);
            tdName.appendChild(nameWrap);
            tr.appendChild(tdName);

            // Original Size
            const tdOrig = document.createElement('td');
            tdOrig.className = 'col-orig';
            tdOrig.textContent = formatSize(entry.originalSize);
            tr.appendChild(tdOrig);

            // Estimated / Actual Size
            const tdEst = document.createElement('td');
            tdEst.className = 'col-est';
            tdEst.textContent = formatSize(displaySize);
            tr.appendChild(tdEst);

            // Savings — handle edge case where compressed > original
            const tdSave = document.createElement('td');
            tdSave.className = 'col-save';
            const savingSpan = document.createElement('span');
            savingSpan.className = 'savings-badge';
            if (savingPct < 0) {
                // Output is larger than input (can happen with already-optimised PNGs)
                savingSpan.textContent = `+${formatSize(-savingBytes)} (larger)`;
                savingSpan.style.opacity = '0.55';
            } else {
                savingSpan.textContent = `${formatSize(savingBytes)} (${savingPct}%)`;
            }
            tdSave.appendChild(savingSpan);
            tr.appendChild(tdSave);

            // Status
            const tdStatus = document.createElement('td');
            tdStatus.className = 'col-status';
            const statusCell = document.createElement('div');
            statusCell.className = 'status-cell';
            const dot = document.createElement('span');
            dot.className = `status-dot ${entry.status}`;
            const label = document.createElement('span');
            label.className = `status-label ${entry.status}`;
            label.textContent = capitalise(entry.status);
            statusCell.appendChild(dot);
            statusCell.appendChild(label);
            tdStatus.appendChild(statusCell);
            tr.appendChild(tdStatus);

            // Actions
            const tdAct = document.createElement('td');
            tdAct.className = 'col-actions';
            const actionsWrap = document.createElement('div');
            actionsWrap.className = 'actions-cell';

            if (entry.status === 'done' && entry.compressedURL) {
                const dlBtn = document.createElement('button');
                dlBtn.className = 'dl-row-btn';
                dlBtn.title = 'Download compressed image';
                dlBtn.innerHTML = '<i class="fa-solid fa-download"></i>';
                dlBtn.addEventListener('click', () => downloadSingle(entry));
                actionsWrap.appendChild(dlBtn);
            }

            const delBtn = document.createElement('button');
            delBtn.className = 'del-btn';
            delBtn.title = 'Remove image';
            delBtn.innerHTML = '<i class="fa-regular fa-trash-can"></i>';
            delBtn.addEventListener('click', () => removeEntry(entry.id));
            actionsWrap.appendChild(delBtn);

            tdAct.appendChild(actionsWrap);
            tr.appendChild(tdAct);

            imageTableBody.appendChild(tr);
        });

        // Enable/disable buttons
        const anyDone = images.some(img => img.status === 'done');
        const anyReady = images.some(img => img.status === 'ready' || img.status === 'error');
        compressBtn.disabled = images.length === 0 || !anyReady;
        downloadAllBtn.disabled = !anyDone;
    }

    /* ========================================================
       Summary Panel
    ======================================================== */
    // FIX (Bug 8): Label switches from "Estimated" to "Actual" once every image
    // is compressed, so the user always knows whether the figure is a prediction
    // or a measured result.
    function updateSummary() {
        if (images.length === 0) { return; }

        const allDone = images.every(e => e.status === 'done');

        const totalOrig = images.reduce((acc, e) => acc + e.originalSize, 0);
        const totalEst  = images.reduce((acc, e) => {
            if (e.status === 'done' && e.compressedBlob) return acc + e.compressedBlob.size;
            return acc + e.estimatedSize;
        }, 0);
        const savings    = totalOrig - totalEst;
        const savingsPct = totalOrig > 0 ? Math.round((savings / totalOrig) * 100) : 0;

        sumOriginal.textContent  = formatSize(totalOrig);
        sumEstimated.textContent = formatSize(totalEst);
        sumSavings.textContent   = `${formatSize(savings)} (${savingsPct}%)`;

        // Flip the label when all results are real measurements, not estimates
        const estLabel = sumEstimated.previousElementSibling;
        if (estLabel) {
            estLabel.textContent = allDone ? 'Actual Total Size' : 'Estimated Total Size';
        }
    }

    /* ========================================================
       Remove / Clear
    ======================================================== */
    function removeEntry(id) {
        const idx = images.findIndex(e => e.id === id);
        if (idx === -1) return;
        const entry = images[idx];
        URL.revokeObjectURL(entry.objectURL);
        if (entry.compressedURL) URL.revokeObjectURL(entry.compressedURL);
        images.splice(idx, 1);
        renderTable();
        updateSummary();
        if (images.length === 0) {
            listSection.setAttribute('hidden', '');
        }
    }

    clearAllBtn.addEventListener('click', () => {
        images.forEach(e => {
            URL.revokeObjectURL(e.objectURL);
            if (e.compressedURL) URL.revokeObjectURL(e.compressedURL);
        });
        images = [];
        renderTable();
        listSection.setAttribute('hidden', '');
    });

    /* ========================================================
       Compression
    ======================================================== */
    compressBtn.addEventListener('click', compressAll);

    async function compressAll() {
        const toCompress = images.filter(e => e.status === 'ready' || e.status === 'error');
        if (toCompress.length === 0) return;

        compressBtn.disabled = true;
        compressBtn.classList.add('compressing');
        compressBtn.innerHTML = '<i class="fa-solid fa-spinner"></i> Compressing…';

        let hadError = false;

        for (const entry of toCompress) {
            entry.status = 'compressing';
            renderTable();
            try {
                await compressOne(entry);
                entry.status = 'done';
            } catch (err) {
                console.error('Compression failed for', entry.file.name, err);
                entry.status = 'error';
                hadError = true;
                // FIX (Bug 4): Surface per-file failures with a descriptive toast
                showToast(`Could not compress "${entry.file.name}". ${err.message || ''}`, 'error');
            }
            renderTable();
            updateSummary();
        }

        compressBtn.classList.remove('compressing');
        compressBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> Compress Images';

        // FIX (Bug 5): renderTable() is the single source of truth for button state.
        // No need to duplicate anyReady/anyDone checks here.
        renderTable();

        if (!hadError) showToast('Compression complete!', 'success');
    }

    function compressOne(entry) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width  = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d');

                // FIX (Bug 2): Use resolveOutputMime so AVIF/GIF/BMP/TIFF → WebP, not JPEG
                const mimeOut = resolveOutputMime(entry.file.type);

                // FIX (Bug 2): Pre-fill with white only when converting to JPEG.
                // JPEG has no alpha channel; unfilled pixels would render as black.
                // WebP and PNG both handle transparency natively.
                if (mimeOut === 'image/jpeg') {
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                }

                ctx.drawImage(img, 0, 0);

                // FIX (Bug 3): Use currentQ directly — no extra mode multiplier.
                // The mode card click already updated the slider and currentQ to the
                // mode preset, so applying another multiplier here would double-adjust.
                const q = currentQ;

                canvas.toBlob(blob => {
                    if (!blob) { reject(new Error('toBlob returned null')); return; }
                    entry.compressedBlob = blob;
                    if (entry.compressedURL) URL.revokeObjectURL(entry.compressedURL);
                    entry.compressedURL = URL.createObjectURL(blob);
                    resolve();
                }, mimeOut, mimeOut === 'image/png' ? undefined : q);
            };
            // FIX (Bug 4): Provide a meaningful rejection message for the per-file error toast
            img.onerror = () => reject(new Error('Image could not be loaded for compression.'));
            img.src = entry.objectURL;
        });
    }

    /* ========================================================
       Download
    ======================================================== */
    function downloadSingle(entry) {
        if (!entry.compressedURL) return;
        const a = document.createElement('a');
        a.href = entry.compressedURL;
        // FIX (Bug 2): Use the actual output MIME type so the file extension is correct
        // (e.g. photo.avif compressed to WebP downloads as photo-compressed.webp)
        const outMime = entry.compressedBlob ? entry.compressedBlob.type : null;
        a.download = compressedFilename(entry.file.name, outMime);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    downloadAllBtn.addEventListener('click', async () => {
        const done = images.filter(e => e.status === 'done' && e.compressedURL);
        if (done.length === 0) return;

        if (done.length === 1) {
            downloadSingle(done[0]);
            return;
        }

        // Sequential download (no external dependency)
        downloadAllBtn.disabled = true;
        for (const entry of done) {
            downloadSingle(entry);
            await sleep(200); // slight delay so browser doesn't block multiple downloads
        }
        downloadAllBtn.disabled = false;
        showToast(`${done.length} images downloaded!`, 'success');
    });

    // FIX (Bug 2): Accept actual output MIME to set the correct file extension
    function compressedFilename(original, mimeOut) {
        const extMap = {
            'image/jpeg': '.jpg',
            'image/png':  '.png',
            'image/webp': '.webp',
        };
        const lastDot = original.lastIndexOf('.');
        const base    = lastDot > 0 ? original.slice(0, lastDot) : original;
        // Fall back to original extension if mimeOut is unknown/null
        const newExt  = extMap[mimeOut] || (lastDot > 0 ? original.slice(lastDot) : '');
        return `${base}-compressed${newExt}`;
    }

    /* ========================================================
       Utilities
    ======================================================== */
    function formatSize(bytes) {
        if (bytes === 0) return '0 B';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }

    function capitalise(str) {
        if (!str) return '';
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    function generateId() {
        return '_' + Math.random().toString(36).slice(2, 11);
    }

    function sleep(ms) {
        return new Promise(res => setTimeout(res, ms));
    }

    /* ========================================================
       Toast
    ======================================================== */
    let toastTimer = null;

    function showToast(message, type = 'info') {
        // Remove existing toast
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();
        if (toastTimer) clearTimeout(toastTimer);

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const icon = {
            success: 'fa-solid fa-circle-check',
            error: 'fa-solid fa-circle-xmark',
            info: 'fa-solid fa-circle-info',
        }[type] || 'fa-solid fa-circle-info';

        toast.innerHTML = `<i class="${icon}"></i> ${message}`;
        document.body.appendChild(toast);

        toastTimer = setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(8px)';
            toast.style.transition = 'opacity .25s ease, transform .25s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3200);
    }

})();
