/**
 * Header Component
 * 
 * Usage: Add this to any page to load the header:
 *   <div id="header-placeholder"></div>
 *   <script src="Header/header.js"></script>
 * 
 * For pages in subdirectories, adjust paths accordingly:
 *   <div id="header-placeholder"></div>
 *   <script src="../Header/header.js"></script>
 */
(function () {
  // Determine the base path of this script (the Header/ folder)
  var scripts = document.getElementsByTagName('script');
  var currentScript = scripts[scripts.length - 1];
  var scriptSrc = currentScript.getAttribute('src');
  var basePath = scriptSrc.substring(0, scriptSrc.lastIndexOf('/') + 1);
  var rootFromPage = basePath.replace(/Header\/?$/i, '');

  // Build proper link paths
  var homePath = rootFromPage + 'index.html';
  var aboutPath = rootFromPage + 'about/about.html';
  var imageTransformerPath = rootFromPage + 'Image_transformer/image_transformer.html';
  var compressorPath = rootFromPage + 'Compressor/compressor.html';

  // Detect current page to set active nav link
  var currentPage = window.location.pathname.toLowerCase();
  var isAboutPage = currentPage.indexOf('about') !== -1;
  var isImageTransformerPage = currentPage.indexOf('image_transformer') !== -1;
  var isHomePage = !isAboutPage && !isImageTransformerPage;

  var homeActiveClass = isHomePage ? 'nav-link active' : 'nav-link';
  var aboutActiveClass = isAboutPage ? 'nav-link active' : 'nav-link';
  var imageToolsActiveClass = isImageTransformerPage ? 'nav-link active' : 'nav-link';

  // The header HTML template (embedded to avoid CORS issues with file:// protocol)
  var headerHTML = [
    '<!-- ============ HEADER ============ -->',
    '<header class="site-header">',
    '  <div class="container header-inner">',
    '    <a href="' + homePath + '" class="logo">',
    '      <span class="logo-mark"><i class="fa-solid fa-images"></i></span>',
    '      ImageToolKit',
    '    </a>',
    '    <nav class="main-nav">',
    '      <a href="' + homePath + '" class="' + homeActiveClass + '">Home</a>',

    // Image Tools dropdown
    '      <div class="nav-item" id="navItemImageTools">',
    '        <a href="#" class="' + imageToolsActiveClass + '" id="navDropImageTools" aria-haspopup="true" aria-expanded="false">Image Tools <i class="fa-solid fa-chevron-down"></i></a>',
    '        <div class="dropdown-menu" role="menu">',
    '          <a href="' + imageTransformerPath + '" class="dropdown-item" role="menuitem"><i class="fa-solid fa-sliders"></i> Image Transformer</a>',
    '          <a href="' + compressorPath + '" class="dropdown-item" role="menuitem"><i class="fa-solid fa-file-zipper"></i> Compress Images</a>',
    '          <a href="#" class="dropdown-item" role="menuitem"><i class="fa-solid fa-circle-info"></i> Metadata Viewer</a>',
    '        </div>',
    '      </div>',

    '      <a href="#" class="nav-link">SVG Tools <i class="fa-solid fa-chevron-down"></i></a>',
    '      <a href="#" class="nav-link">PDF Tools <i class="fa-solid fa-chevron-down"></i></a>',
    '      <a href="#" class="nav-link">Developer Tools <i class="fa-solid fa-chevron-down"></i></a>',
    '      <a href="' + aboutPath + '" class="' + aboutActiveClass + '">About</a>',
    '    </nav>',
    '    <div class="header-actions">',
    '      <button class="icon-btn" aria-label="Toggle theme"><i class="fa-solid fa-sun"></i></button>',
    '      <a href="#" class="btn-github"><i class="fa-brands fa-github"></i> <span class="btn-github-text">GitHub</span></a>',
    '      <button class="icon-btn menu-toggle" id="menuToggle" aria-label="Toggle menu"><i class="fa-solid fa-bars"></i></button>',
    '    </div>',
    '  </div>',
    '</header>'
  ].join('\n');

  // Inject header CSS dynamically
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = basePath + 'header.css';
  document.head.appendChild(link);

  // Inject header HTML into placeholder
  var placeholder = document.getElementById('header-placeholder');
  if (!placeholder) {
    console.warn('Header component: #header-placeholder element not found.');
    return;
  }
  placeholder.innerHTML = headerHTML;

  // Initialize mobile menu toggle
  var menuToggle = document.getElementById('menuToggle');
  var mainNav = placeholder.querySelector('.main-nav');
  if (menuToggle && mainNav) {
    menuToggle.addEventListener('click', function () {
      mainNav.classList.toggle('nav-open');
      var open = mainNav.classList.contains('nav-open');
      menuToggle.querySelector('i').className = open ? 'fa-solid fa-xmark' : 'fa-solid fa-bars';
    });
  }

  // Click-to-open dropdown for both desktop and mobile
  var navItemImageTools = document.getElementById('navItemImageTools');
  var navDropImageTools = document.getElementById('navDropImageTools');
  if (navItemImageTools && navDropImageTools) {
    navDropImageTools.addEventListener('click', function (e) {
      e.preventDefault();
      navItemImageTools.classList.toggle('open');
      navDropImageTools.setAttribute('aria-expanded', navItemImageTools.classList.contains('open'));
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', function (e) {
      if (!navItemImageTools.contains(e.target)) {
        navItemImageTools.classList.remove('open');
        navDropImageTools.setAttribute('aria-expanded', 'false');
      }
    });
  }
})();
