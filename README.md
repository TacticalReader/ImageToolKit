<div align="center">

# 🖼️ OpenKit

**All-in-one toolkit for images, SVGs and more — 100% client-side, zero uploads, total privacy.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Made with HTML](https://img.shields.io/badge/HTML-5-E34F26?logo=html5&logoColor=white)](#)
[![Made with CSS](https://img.shields.io/badge/CSS-3-1572B6?logo=css3&logoColor=white)](#)
[![Made with JavaScript](https://img.shields.io/badge/JavaScript-Vanilla-F7DF1E?logo=javascript&logoColor=black)](#)
[![GitHub Pages](https://img.shields.io/badge/Deployed-GitHub%20Pages-222?logo=githubpages&logoColor=white)](https://tacticalreader.github.io/OpenKit/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-contributing)
[![Open Source](https://img.shields.io/badge/Open%20Source-%E2%9D%A4-red.svg)](#)

[**Live Demo**](https://tacticalreader.github.io/OpenKit/) · [Report Bug](https://github.com/TacticalReader/OpenKit/issues) · [Request Feature](https://github.com/TacticalReader/Open/issues)

</div>

---

## 📖 About

**OpenKit** solves a simple problem: preparing and optimizing images for the web is usually slow, ad-riddled, and requires uploading your files to some third-party server.

This toolkit does it all **entirely in your browser**. No backend, no file uploads, no accounts, no limits — just fast, private image processing powered by the Canvas API.

> 🔒 Your files never leave your device. Everything runs client-side.

---

## ✨ Features

| | |
|---|---|
| 🖼️ **Resize & Scale** | Resize by exact dimensions or percentage, with aspect-ratio locking |
| 🔄 **Format Conversion** | Convert between JPG, PNG, WebP, and AVIF |
| 🎚️ **Quality Control** | Adjustable compression quality with live output size estimate |
| 📐 **Aspect Ratio Presets** | Original, 1:1, 4:3, 16:9, 9:16, or fully custom |
| 🎨 **Background Handling** | Original, white, black, transparent, or custom color fills |
| 📦 **Batch Processing** | Process up to 7 images at once |
| 🗜️ **Bulk Download** | Single image downloads directly; multiple images bundle into a ZIP |
| 🔍 **Lightbox Preview** | Full-screen preview with keyboard navigation across results |
| 🧭 **Smart Format Fallback** | Transparent backgrounds auto-upgrade JPG/AVIF output to PNG |
| 🔔 **Toast Notifications** | Clear, non-intrusive feedback for every action |
| ⚡ **Fast & Offline-Friendly** | No network round-trips — processing happens instantly in-browser |
| 🛡️ **Total Privacy** | No uploads, no tracking, no server-side processing |

---

## 🧰 Tools

- **Image Resize** — precise dimension or scale-based resizing
- **Converter** — format conversion across JPG / PNG / WebP / AVIF
- **Compress** — quality-based compression with size preview
- **Background Pad** — fill or pad with solid or transparent backgrounds
- **Bulk Process** — handle multiple images in one pass
- *More tools planned — see [Roadmap](#-roadmap)*

---

## 🚀 Getting Started

OpenKit is a static site — no build step, no dependencies to install.

### Option 1: Try it live

👉 **[Open the live demo](https://tacticalreader.github.io/OpenKit/)**

### Option 2: Run it locally

```bash
# Clone the repository
git clone https://github.com/TacticalReader/OpenKit.git

# Move into the project directory
cd OpenKit

# Serve it locally (pick one)
python3 -m http.server 8000
# or
npx serve .
```

Then open `http://localhost:8000` in your browser.

You can also just open `index.html` directly in a browser — no server required for basic use.

---

## 📁 Project Structure

```
OpenKit/
├── index.html                  # Landing page
├── style.css                   # Global styles
├── script.js                   # Landing page preview logic
├── Header/
│   ├── header.js                # Shared header component
│   └── header.css
├── Image_transformer/
│   ├── image_transformer.html   # Main tool UI
│   ├── image_transformer.js     # Upload, transform & export logic
│   └── image_transformer.css
├── about/
│   ├── about.html                # About page
│   └── about.css
└── .github/workflows/
    └── jekyll-gh-pages.yml       # GitHub Pages deployment
```

---

## 🛠️ Built With

- **HTML5 / CSS3** — semantic structure and layout
- **Vanilla JavaScript** — no frameworks, no build tools
- **Canvas API** — image resizing, format conversion, and rendering
- **[JSZip](https://stuk.github.io/jszip/)** — bundling multiple exports into a single ZIP
- **[Font Awesome](https://fontawesome.com/)** — iconography
- **Google Fonts (Inter)** — typography

---

## 🗺️ Roadmap

- [ ] SVG editing & optimization tools
- [ ] Image-to-PDF, merge & split tools
- [ ] Crop tool
- [ ] Developer utilities (base64 encode/decode, EXIF viewer, etc.)
- [ ] Drag-to-reorder for batch queue
- [ ] PWA / offline support

Have an idea? [Open an issue](https://github.com/TacticalReader/OpenKit/issues) and let us know!

---

## 🤝 Contributing

Contributions are what make open source great. Any contribution is **greatly appreciated**.

1. Fork the repository
2. Create your feature branch
   ```bash
   git checkout -b feature/AmazingFeature
   ```
3. Commit your changes
   ```bash
   git commit -m "Add: AmazingFeature"
   ```
4. Push to the branch
   ```bash
   git push origin feature/AmazingFeature
   ```
5. Open a Pull Request

Please keep changes focused and consistent with the existing vanilla HTML/CSS/JS style — no new frameworks or build tooling without discussion first.

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for more information.

---

## 🙏 Acknowledgments

- [Font Awesome](https://fontawesome.com/) for icons
- [JSZip](https://stuk.github.io/jszip/) for ZIP bundling
- [Google Fonts](https://fonts.google.com/) for Inter typeface

---

<div align="center">

**Built as a front-end UI recreation — © 2026 OpenKit**

If this project helped you, consider giving it a ⭐!

</div>
