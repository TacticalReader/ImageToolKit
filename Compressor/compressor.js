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

    // Mode quality presets
    const MODE_QUALITY = {
        'balanced': 0.80,
        'max-savings': 0.50,
        'max-quality': 0.95,
    };

    let images = [];   // Array of image entry objects
    let currentMode = 'balanced';
    let currentQ = 0.80; // from slider (0–1)

    /* ========================================================
       DOM Refs
    ======================================================== */
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');
    const listSection = document.getElementById('listSection');
    const imageTableBody = document.getElementById('imageTableBody');
    const imageCountHead = document.getElementById('imageCountHeading');
    const clearAllBtn = document.getElementById('clearAllBtn');
    const compressBtn = document.getElementById('compressBtn');
    const downloadAllBtn = document.getElementById('downloadAllBtn');
    const qualitySlider = document.getElementById('qualitySlider');
    const qualityDisplay = document.getElementById('qualityDisplay');
    const modeCards = document.querySelectorAll('.mode-card');
    const sumOriginal = document.getElementById('sumOriginal');
    const sumEstimated = document.getElementById('sumEstimated');
    const sumSavings = document.getElementById('sumSavings');

    // How It Works modal
    const howItWorksBtn = document.getElementById('howItWorksBtn');
    const hiwBackdrop = document.getElementById('hiwBackdrop');
    const hiwClose = document.getElementById('hiwClose');
    const hiwGotIt = document.getElementById('hiwGotIt');

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
        currentQ = val / 100;
        qualityDisplay.textContent = val + '%';
        updateSliderTrack();
        recomputeEstimates();
    });

    function updateSliderTrack() {
        const val = qualitySlider.value;
        const min = qualitySlider.min || 1;
        const max = qualitySlider.max || 100;
        const pct = ((val - min) / (max - min)) * 100;
        qualitySlider.style.background =
            `linear-gradient(to right, var(--indigo-500) ${pct}%, var(--border) ${pct}%)`;
    }
    updateSliderTrack(); // init

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
            // Duplicate check by name+size
            const isDupe = images.some(img => img.file.name === file.name && img.file.size === file.size);
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

    function loadImageDimensions(entry) {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                entry.width = img.naturalWidth;
                entry.height = img.naturalHeight;
                resolve();
            };
            img.onerror = resolve;
            img.src = entry.objectURL;
        });
    }

    /* ========================================================
       Estimated size computation (fast heuristic using Canvas)
    ======================================================== */
    function computeEstimatedSize(entry) {
        // Very rough: for JPEG/WebP quality compression, size scales roughly with quality^2
        // For PNG (lossless), savings come from color reduction, approximated here
        const originalSize = entry.originalSize;
        const type = entry.file.type;
        let ratio;

        if (type === 'image/jpeg' || type === 'image/jpg') {
            // JPEG re-encode: if current quality = q, estimated savings
            ratio = currentQ * 0.85 + 0.05;
        } else if (type === 'image/webp') {
            ratio = currentQ * 0.80 + 0.04;
        } else if (type === 'image/png') {
            // PNG compressed to WebP or JPEG, significant savings
            ratio = currentQ * 0.55 + 0.05;
        } else if (type === 'image/avif') {
            ratio = currentQ * 0.70 + 0.05;
        } else {
            ratio = currentQ * 0.75 + 0.05;
        }

        // Also use mode modifier
        const modeMultiplier = {
            'balanced': 1.00,
            'max-savings': 0.70,
            'max-quality': 1.30,
        }[currentMode] || 1.0;

        ratio = Math.min(ratio * modeMultiplier, 0.98);
        return Math.max(Math.round(originalSize * ratio), 512); // at least 512 bytes
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
            const savingBytes = entry.originalSize - entry.estimatedSize;
            const savingPct = entry.originalSize > 0
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

            // Estimated Size
            const tdEst = document.createElement('td');
            tdEst.className = 'col-est';
            tdEst.textContent = entry.status === 'done'
                ? formatSize(entry.compressedBlob.size)
                : formatSize(entry.estimatedSize);
            tr.appendChild(tdEst);

            // Savings
            const tdSave = document.createElement('td');
            tdSave.className = 'col-save';
            const actualBytes = entry.status === 'done'
                ? entry.originalSize - entry.compressedBlob.size
                : savingBytes;
            const actualPct = entry.status === 'done'
                ? Math.round((actualBytes / entry.originalSize) * 100)
                : savingPct;
            const savingSpan = document.createElement('span');
            savingSpan.className = 'savings-badge';
            savingSpan.textContent = `${formatSize(actualBytes)} (${actualPct}%)`;
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
    function updateSummary() {
        if (images.length === 0) { return; }

        const totalOrig = images.reduce((acc, e) => acc + e.originalSize, 0);
        const totalEst = images.reduce((acc, e) => {
            if (e.status === 'done' && e.compressedBlob) return acc + e.compressedBlob.size;
            return acc + e.estimatedSize;
        }, 0);
        const savings = totalOrig - totalEst;
        const savingsPct = totalOrig > 0 ? Math.round((savings / totalOrig) * 100) : 0;

        sumOriginal.textContent = formatSize(totalOrig);
        sumEstimated.textContent = formatSize(totalEst);
        sumSavings.textContent = `${formatSize(savings)} (${savingsPct}%)`;
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

        for (const entry of toCompress) {
            entry.status = 'compressing';
            renderTable();
            try {
                await compressOne(entry);
                entry.status = 'done';
            } catch (err) {
                console.error('Compression failed for', entry.file.name, err);
                entry.status = 'error';
            }
            renderTable();
            updateSummary();
        }

        compressBtn.classList.remove('compressing');
        compressBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> Compress Images';

        const anyDone = images.some(e => e.status === 'done');
        const anyReady = images.some(e => e.status === 'ready' || e.status === 'error');
        compressBtn.disabled = !anyReady || images.length === 0;
        downloadAllBtn.disabled = !anyDone;

        showToast('Compression complete!', 'success');
    }

    function compressOne(entry) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);

                // Determine output MIME type
                let mimeOut = 'image/jpeg';
                if (entry.file.type === 'image/png') {
                    mimeOut = 'image/png';
                } else if (entry.file.type === 'image/webp') {
                    mimeOut = 'image/webp';
                }

                // Use mode-aware quality
                let q = currentQ;
                if (currentMode === 'max-savings') q = Math.max(0.40, q * 0.80);
                if (currentMode === 'max-quality') q = Math.min(0.98, q * 1.10);

                canvas.toBlob(blob => {
                    if (!blob) { reject(new Error('toBlob returned null')); return; }
                    entry.compressedBlob = blob;
                    if (entry.compressedURL) URL.revokeObjectURL(entry.compressedURL);
                    entry.compressedURL = URL.createObjectURL(blob);
                    resolve();
                }, mimeOut, mimeOut === 'image/png' ? undefined : q);
            };
            img.onerror = reject;
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
        a.download = compressedFilename(entry.file.name);
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

    function compressedFilename(original) {
        const lastDot = original.lastIndexOf('.');
        const base = lastDot > 0 ? original.slice(0, lastDot) : original;
        const ext = lastDot > 0 ? original.slice(lastDot) : '';
        return `${base}-compressed${ext}`;
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
