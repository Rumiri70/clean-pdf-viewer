document.addEventListener('DOMContentLoaded', function() {
    // Set PDF.js worker
    if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    class CleanPDFViewer {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.pdfDoc = null;
            this.pageNum = 1;
            this.pageRendering = false;
            this.pageNumPending = null;
            this.scale = 1.2;
            this.pdfUrl = canvas.dataset.pdfUrl;
            this.viewerId = canvas.id;
            this.container = canvas.closest('.clean-pdf-viewer-container');
            this.isFullscreen = false;
            this.retryCount = 0;
            this.maxRetries = 3;
            this.eventListeners = [];
            
            // Check if required elements exist
            if (!this.canvas || !this.container || !this.pdfUrl) {
                console.error('PDF Viewer: Missing required elements or PDF URL');
                return;
            }
            
            this.init();
        }

        async init() {
            try {
                this.showLoading();
                
                // Check if PDF.js is available
                if (typeof pdfjsLib === 'undefined') {
                    throw new Error('PDF.js library not loaded. Please check your internet connection.');
                }
                
                // Validate PDF URL
                if (!this.isValidUrl(this.pdfUrl)) {
                    throw new Error('Invalid PDF URL provided');
                }
                
                console.log('Loading PDF from:', this.pdfUrl);
                
                const loadingTask = pdfjsLib.getDocument({
                    url: this.pdfUrl,
                    withCredentials: false,
                    verbosity: 0,
                    cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
                    cMapPacked: true
                });
                
                // Handle loading progress
                loadingTask.onProgress = (progress) => {
                    if (progress.total) {
                        const percent = Math.round((progress.loaded / progress.total) * 100);
                        this.updateLoadingProgress(percent);
                    }
                };
                
                this.pdfDoc = await loadingTask.promise;
                console.log('PDF loaded successfully. Pages:', this.pdfDoc.numPages);
                
                this.hideLoading();
                this.updatePageInfo();
                await this.renderPage(this.pageNum);
                this.bindEvents();
                
                // Mark container as loaded
                this.container.classList.add('pdf-loaded');
                
            } catch (error) {
                console.error('Error loading PDF:', error);
                this.handleLoadError(error);
            }
        }

        isValidUrl(string) {
            try {
                new URL(string);
                return true;
            } catch (_) {
                return false;
            }
        }

        updateLoadingProgress(percent) {
            const loadingEl = this.container.querySelector('.pdf-loading');
            if (loadingEl) {
                loadingEl.innerHTML = `Loading PDF... ${percent}%`;
            }
        }

        handleLoadError(error) {
            if (this.retryCount < this.maxRetries && error.name !== 'InvalidPDFException') {
                this.retryCount++;
                console.log(`Retrying PDF load (attempt ${this.retryCount}/${this.maxRetries})`);
                
                // Exponential backoff
                setTimeout(() => {
                    this.init();
                }, 1000 * this.retryCount);
                
                return;
            }
            
            // Show specific error messages
            let errorMessage = 'Error loading PDF. Please try again.';
            
            if (error.name === 'InvalidPDFException') {
                errorMessage = 'The file is not a valid PDF or may be corrupted.';
            } else if (error.name === 'MissingPDFException') {
                errorMessage = 'PDF file not found. Please check if the file exists.';
            } else if (error.name === 'UnexpectedResponseException') {
                errorMessage = 'Network error. Please check your internet connection.';
            } else if (error.message && error.message.includes('PDF.js')) {
                errorMessage = 'PDF.js library failed to load. Please refresh the page.';
            } else if (error.message && error.message.includes('Invalid PDF URL')) {
                errorMessage = 'Invalid PDF URL provided.';
            }
            
            this.showError(errorMessage);
        }

        bindEvents() {
            // Clear existing event listeners
            this.clearEventListeners();
            
            // Previous page
            const prevBtn = this.container.querySelector(`[data-viewer="${this.viewerId}"].pdf-prev`);
            if (prevBtn) {
                const handler = () => this.prevPage();
                prevBtn.addEventListener('click', handler);
                this.eventListeners.push({ element: prevBtn, event: 'click', handler });
            }

            // Next page
            const nextBtn = this.container.querySelector(`[data-viewer="${this.viewerId}"].pdf-next`);
            if (nextBtn) {
                const handler = () => this.nextPage();
                nextBtn.addEventListener('click', handler);
                this.eventListeners.push({ element: nextBtn, event: 'click', handler });
            }

            // Zoom in
            const zoomInBtn = this.container.querySelector(`[data-viewer="${this.viewerId}"].pdf-zoom-in`);
            if (zoomInBtn) {
                const handler = () => this.zoomIn();
                zoomInBtn.addEventListener('click', handler);
                this.eventListeners.push({ element: zoomInBtn, event: 'click', handler });
            }

            // Zoom out
            const zoomOutBtn = this.container.querySelector(`[data-viewer="${this.viewerId}"].pdf-zoom-out`);
            if (zoomOutBtn) {
                const handler = () => this.zoomOut();
                zoomOutBtn.addEventListener('click', handler);
                this.eventListeners.push({ element: zoomOutBtn, event: 'click', handler });
            }

            // Fullscreen toggle
            const fullscreenBtn = this.container.querySelector(`[data-viewer="${this.viewerId}"].pdf-fullscreen`);
            if (fullscreenBtn) {
                const handler = () => this.toggleFullscreen();
                fullscreenBtn.addEventListener('click', handler);
                this.eventListeners.push({ element: fullscreenBtn, event: 'click', handler });
            }

            // Touch support for mobile
            this.addTouchSupport();
            
            // Keyboard navigation
            this.addKeyboardSupport();
        }

        addTouchSupport() {
            let startX = 0;
            let startY = 0;
            const minSwipeDistance = 50;

            const touchStartHandler = (e) => {
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
            };

            const touchEndHandler = (e) => {
                if (!startX || !startY) return;

                const endX = e.changedTouches[0].clientX;
                const endY = e.changedTouches[0].clientY;
                const diffX = startX - endX;
                const diffY = startY - endY;

                if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > minSwipeDistance) {
                    if (diffX > 0) {
                        this.nextPage();
                    } else {
                        this.prevPage();
                    }
                }

                startX = 0;
                startY = 0;
            };

            this.canvas.addEventListener('touchstart', touchStartHandler, { passive: true });
            this.canvas.addEventListener('touchend', touchEndHandler, { passive: true });
            
            this.eventListeners.push(
                { element: this.canvas, event: 'touchstart', handler: touchStartHandler },
                { element: this.canvas, event: 'touchend', handler: touchEndHandler }
            );
        }

        addKeyboardSupport() {
            const keyHandler = (e) => {
                // Only handle keys when this viewer is in focus
                if (!this.container.contains(document.activeElement) && !this.isFullscreen) {
                    return;
                }
                
                switch(e.key) {
                    case 'ArrowLeft':
                    case 'PageUp':
                        e.preventDefault();
                        this.prevPage();
                        break;
                    case 'ArrowRight':
                    case 'PageDown':
                        e.preventDefault();
                        this.nextPage();
                        break;
                    case 'Escape':
                        e.preventDefault();
                        if (this.isFullscreen) {
                            this.toggleFullscreen();
                        }
                        break;
                    case '+':
                    case '=':
                        e.preventDefault();
                        this.zoomIn();
                        break;
                    case '-':
                        e.preventDefault();
                        this.zoomOut();
                        break;
                    case 'Home':
                        e.preventDefault();
                        this.goToPage(1);
                        break;
                    case 'End':
                        e.preventDefault();
                        this.goToPage(this.pdfDoc.numPages);
                        break;
                }
            };

            document.addEventListener('keydown', keyHandler);
            this.eventListeners.push({ element: document, event: 'keydown', handler: keyHandler });
        }

        clearEventListeners() {
            this.eventListeners.forEach(({ element, event, handler }) => {
                element.removeEventListener(event, handler);
            });
            this.eventListeners = [];
        }

        async renderPage(num) {
            if (this.pageRendering) {
                this.pageNumPending = num;
                return;
            }

            if (!this.pdfDoc) {
                console.error('PDF document not loaded');
                return;
            }

            this.pageRendering = true;
            
            try {
                console.log(`Rendering page ${num}`);
                
                const page = await this.pdfDoc.getPage(num);
                const viewport = page.getViewport({ scale: this.scale });
                
                // Handle high DPI displays
                const devicePixelRatio = window.devicePixelRatio || 1;
                const scaledViewport = page.getViewport({ scale: this.scale * devicePixelRatio });
                
                // Set canvas dimensions
                this.canvas.width = scaledViewport.width;
                this.canvas.height = scaledViewport.height;
                this.canvas.style.width = viewport.width + 'px';
                this.canvas.style.height = viewport.height + 'px';
                
                // Clear previous content
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                
                // Scale context for high DPI
                this.ctx.scale(devicePixelRatio, devicePixelRatio);

                const renderContext = {
                    canvasContext: this.ctx,
                    viewport: viewport
                };

                // Cancel any ongoing render task
                if (this.renderTask) {
                    this.renderTask.cancel();
                }

                this.renderTask = page.render(renderContext);
                await this.renderTask.promise;
                
                console.log(`Page ${num} rendered successfully`);
                
                this.pageRendering = false;

                // Handle pending page render
                if (this.pageNumPending !== null) {
                    const pending = this.pageNumPending;
                    this.pageNumPending = null;
                    this.renderPage(pending);
                }

                this.updateControls();
                this.updateZoomLevel();
                this.announcePageChange();
                
            } catch (error) {
                console.error('Error rendering page:', error);
                this.pageRendering = false;
                
                if (error.name !== 'RenderingCancelledException') {
                    this.showError('Error rendering page. Please try again.');
                }
            }
        }

        announcePageChange() {
            const announcement = `Page ${this.pageNum} of ${this.pdfDoc.numPages}`;
            const ariaLive = this.container.querySelector('[aria-live]');
            if (ariaLive) {
                ariaLive.textContent = announcement;
            }
        }

        prevPage() {
            if (!this.pdfDoc || this.pageNum <= 1) return;
            this.pageNum--;
            this.renderPage(this.pageNum);
        }

        nextPage() {
            if (!this.pdfDoc || this.pageNum >= this.pdfDoc.numPages) return;
            this.pageNum++;
            this.renderPage(this.pageNum);
        }

        goToPage(num) {
            if (!this.pdfDoc || num < 1 || num > this.pdfDoc.numPages || num === this.pageNum) return;
            this.pageNum = num;
            this.renderPage(this.pageNum);
        }

        zoomIn() {
            if (this.scale >= 3.0) return;
            this.scale += 0.25;
            this.renderPage(this.pageNum);
        }

        zoomOut() {
            if (this.scale <= 0.5) return;
            this.scale -= 0.25;
            this.renderPage(this.pageNum);
        }

        toggleFullscreen() {
            if (!this.isFullscreen) {
                this.enterFullscreen();
            } else {
                this.exitFullscreen();
            }
        }

        enterFullscreen() {
            this.isFullscreen = true;
            this.container.classList.add('fullscreen');
            
            // Try browser fullscreen
            if (this.container.requestFullscreen) {
                this.container.requestFullscreen().catch(console.error);
            } else if (this.container.webkitRequestFullscreen) {
                this.container.webkitRequestFullscreen();
            }
            
            this.updateFullscreenButton();
            
            // Re-render for new dimensions
            setTimeout(() => this.renderPage(this.pageNum), 100);
        }

        exitFullscreen() {
            this.isFullscreen = false;
            this.container.classList.remove('fullscreen');
            
            if (document.exitFullscreen) {
                document.exitFullscreen().catch(console.error);
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }
            
            this.updateFullscreenButton();
            
            // Re-render for original dimensions
            setTimeout(() => this.renderPage(this.pageNum), 100);
        }

        updateFullscreenButton() {
            const fullscreenBtn = this.container.querySelector('.pdf-fullscreen');
            if (fullscreenBtn) {
                const strings = (typeof cleanPdfAjax !== 'undefined' && cleanPdfAjax.strings) || {};
                fullscreenBtn.textContent = this.isFullscreen 
                    ? (strings.exit_fullscreen || 'Exit Fullscreen')
                    : (strings.fullscreen || 'Fullscreen');
            }
        }

        updateControls() {
            if (!this.pdfDoc) return;
            
            const prevBtn = this.container.querySelector('.pdf-prev');
            const nextBtn = this.container.querySelector('.pdf-next');
            const currentPageSpan = this.container.querySelector('.pdf-current-page');
            const zoomInBtn = this.container.querySelector('.pdf-zoom-in');
            const zoomOutBtn = this.container.querySelector('.pdf-zoom-out');

            if (prevBtn) {
                prevBtn.disabled = (this.pageNum <= 1);
                prevBtn.setAttribute('aria-label', `Previous page (currently on page ${this.pageNum})`);
            }
            
            if (nextBtn) {
                nextBtn.disabled = (this.pageNum >= this.pdfDoc.numPages);
                nextBtn.setAttribute('aria-label', `Next page (currently on page ${this.pageNum})`);
            }
            
            if (currentPageSpan) {
                currentPageSpan.textContent = this.pageNum;
            }
            
            if (zoomOutBtn) {
                zoomOutBtn.disabled = (this.scale <= 0.5);
            }
            
            if (zoomInBtn) {
                zoomInBtn.disabled = (this.scale >= 3.0);
            }
        }

        updatePageInfo() {
            if (!this.pdfDoc) return;
            
            const totalPagesSpan = this.container.querySelector('.pdf-total-pages');
            if (totalPagesSpan) {
                totalPagesSpan.textContent = this.pdfDoc.numPages;
            }
        }

        updateZoomLevel() {
            const zoomLevelSpan = this.container.querySelector('.pdf-zoom-level');
            if (zoomLevelSpan) {
                const zoomPercent = Math.round(this.scale * 100);
                zoomLevelSpan.textContent = zoomPercent + '%';
            }
        }

        showLoading() {
            const loadingEl = this.container.querySelector('.pdf-loading');
            const errorEl = this.container.querySelector('.pdf-error');
            
            if (loadingEl) {
                loadingEl.style.display = 'block';
                loadingEl.textContent = 'Loading PDF...';
            }
            if (errorEl) {
                errorEl.style.display = 'none';
            }
        }

        hideLoading() {
            const loadingEl = this.container.querySelector('.pdf-loading');
            if (loadingEl) {
                loadingEl.style.display = 'none';
            }
        }

        showError(message = 'Error loading PDF. Please try again.') {
            console.error('PDF Viewer Error:', message);
            
            const loadingEl = this.container.querySelector('.pdf-loading');
            const errorEl = this.container.querySelector('.pdf-error');
            
            if (loadingEl) {
                loadingEl.style.display = 'none';
            }
            
            if (errorEl) {
                errorEl.style.display = 'block';
                errorEl.textContent = message;
            }
        }

        // Cleanup method
        cleanup() {
            this.clearEventListeners();
            
            if (this.renderTask) {
                this.renderTask.cancel();
            }
            
            if (this.ctx) {
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            }
        }
    }

    // Enhanced Book Selector
    class PDFBookSelector {
        constructor() {
            this.currentViewer = null;
            this.initializeBookSelector();
        }

        initializeBookSelector() {
            const readButtons = document.querySelectorAll('.read-book-btn');
            const viewerContainer = document.getElementById('pdf-viewer-container');
            
            if (!viewerContainer) return;

            // Auto-load first book if specified
            const firstButton = readButtons[0];
            if (firstButton && firstButton.dataset.autoLoad === 'true') {
                setTimeout(() => {
                    this.loadBookViewer(firstButton, viewerContainer, true);
                }, 100);
            }

            // Bind click events
            readButtons.forEach(button => {
                button.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.loadBookViewer(e.target, viewerContainer);
                });
            });
        }

        loadBookViewer(button, container, isAutoLoad = false) {
            const bookId = button.dataset.bookId;
            if (!bookId) {
                console.error('No book ID found');
                return;
            }
            
            // Update button states
            this.updateButtonStates(button);
            
            try {
                // Show loading state
                if (!isAutoLoad) {
                    const originalText = button.textContent;
                    button.innerHTML = '<span style="display: inline-block; width: 12px; height: 12px; border: 2px solid rgba(255,255,255,0.3); border-top: 2px solid #fff; border-radius: 50%; animation: spin 1s linear infinite; margin-right: 8px;"></span>Loading...';
                    button.disabled = true;
                    
                    setTimeout(() => {
                        button.innerHTML = originalText;
                        button.disabled = false;
                    }, 3000);
                }
                
                container.innerHTML = '<div class="pdf-viewer-loading"><div class="book-loading"></div><p>Loading PDF Viewer...</p></div>';
                
                // Create secure PDF URL
                const pdfUrl = this.createSecurePDFUrl(bookId);
                
                // Generate viewer HTML
                const viewerId = 'pdf-viewer-' + bookId + '-' + Date.now();
                const viewerHTML = this.createPDFViewerHTML(viewerId, pdfUrl);
                
                container.innerHTML = viewerHTML;
                container.classList.add('loaded');
                
                // Initialize new PDF viewer
                setTimeout(() => {
                    const newCanvas = container.querySelector('.pdf-canvas');
                    if (newCanvas) {
                        // Clean up previous viewer
                        if (this.currentViewer) {
                            this.currentViewer.cleanup();
                        }
                        
                        this.currentViewer = new CleanPDFViewer(newCanvas);
                    }
                }, 100);
                
                // Smooth scroll to viewer (only if not auto-loading)
                if (!isAutoLoad) {
                    this.smoothScrollTo(container);
                }
                
            } catch (error) {
                console.error('Error loading PDF viewer:', error);
                container.innerHTML = `
                    <div class="pdf-viewer-error">
                        <h4>Error Loading PDF</h4>
                        <p>Unable to load the PDF viewer: ${error.message}</p>
                        <button class="retry-btn" onclick="location.reload()">Retry</button>
                    </div>
                `;
            }
        }

        createSecurePDFUrl(bookId) {
            const baseUrl = (typeof cleanPdfAjax !== 'undefined' && cleanPdfAjax.ajax_url) 
                ? cleanPdfAjax.ajax_url 
                : '/wp-admin/admin-ajax.php';
                
            const nonce = this.generateNonce('serve_pdf_' + bookId);
            
            return `${baseUrl}?action=serve_protected_pdf&book_id=${bookId}&nonce=${nonce}`;
        }

        generateNonce(action) {
            // Simple client-side nonce generation
            return btoa(action + Date.now()).replace(/[^a-zA-Z0-9]/g, '').substr(0, 10);
        }

        createPDFViewerHTML(viewerId, pdfUrl) {
            return `
                <div class="clean-pdf-viewer-container" style="width: 100%; height: 600px;">
                    <div class="pdf-controls">
                        <div class="pdf-controls-left">
                            <button class="pdf-btn pdf-prev" data-viewer="${viewerId}">← Previous</button>
                            <span class="pdf-page-info">Page <span class="pdf-current-page">1</span> of <span class="pdf-total-pages">-</span></span>
                            <button class="pdf-btn pdf-next" data-viewer="${viewerId}">Next →</button>
                        </div>
                        <div class="pdf-controls-right">
                            <button class="pdf-btn pdf-zoom-out" data-viewer="${viewerId}">Zoom Out</button>
                            <span class="pdf-zoom-level">100%</span>
                            <button class="pdf-btn pdf-zoom-in" data-viewer="${viewerId}">Zoom In</button>
                            <button class="pdf-btn pdf-fullscreen" data-viewer="${viewerId}">Fullscreen</button>
                        </div>
                    </div>
                    <div class="pdf-viewer-wrapper">
                        <canvas id="${viewerId}" class="pdf-canvas" data-pdf-url="${pdfUrl}"></canvas>
                    </div>
                    <div class="pdf-loading">Loading PDF...</div>
                    <div class="pdf-error" style="display: none;">Error loading PDF. Please try again.</div>
                    <div aria-live="polite" class="sr-only"></div>
                </div>
            `;
        }

        updateButtonStates(activeButton) {
            // Remove active state from all buttons
            document.querySelectorAll('.read-book-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            
            // Add active state to clicked button
            activeButton.classList.add('active');
        }

        smoothScrollTo(element) {
            const offsetTop = element.getBoundingClientRect().top + window.pageYOffset - 100;
            
            window.scrollTo({
                top: offsetTop,
                behavior: 'smooth'
            });
        }
    }

    // Initialize PDF viewers for existing canvases
    document.querySelectorAll('.pdf-canvas').forEach(canvas => {
        try {
            new CleanPDFViewer(canvas);
        } catch (error) {
            console.error('Error initializing PDF viewer:', error);
        }
    });

    // Initialize book selector if it exists
    if (document.querySelector('.pdf-book-selector')) {
        try {
            new PDFBookSelector();
        } catch (error) {
            console.error('Error initializing book selector:', error);
        }
    }

    // Handle fullscreen changes
    document.addEventListener('fullscreenchange', function() {
        // Update fullscreen states for all viewers
        document.querySelectorAll('.clean-pdf-viewer-container.fullscreen').forEach(container => {
            if (!document.fullscreenElement) {
                container.classList.remove('fullscreen');
            }
        });
    });

    // Performance optimization: Intersection Observer for lazy loading
    if ('IntersectionObserver' in window) {
        const pdfObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const canvas = entry.target;
                    if (canvas.classList.contains('pdf-canvas') && !canvas.dataset.initialized) {
                        canvas.dataset.initialized = 'true';
                        try {
                            new CleanPDFViewer(canvas);
                        } catch (error) {
                            console.error('Error initializing lazy-loaded PDF viewer:', error);
                        }
                        pdfObserver.unobserve(canvas);
                    }
                }
            });
        }, {
            rootMargin: '50px'
        });

        // Observe canvases that aren't immediately visible
        document.querySelectorAll('.pdf-canvas:not([data-initialized])').forEach(canvas => {
            const rect = canvas.getBoundingClientRect();
            if (rect.top > window.innerHeight || rect.bottom < 0) {
                pdfObserver.observe(canvas);
            }
        });
    }

    // Global error handler for PDF.js
    window.addEventListener('error', function(e) {
        if (e.error && e.error.name && e.error.name.includes('PDF')) {
            console.error('Global PDF.js error:', e.error);
        }
    });

    // Add CSS animations for loading spinner
    if (!document.querySelector('#pdf-viewer-animations')) {
        const style = document.createElement('style');
        style.id = 'pdf-viewer-animations';
        style.textContent = `
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            .book-loading {
                width: 40px;
                height: 40px;
                margin: 0 auto 20px;
                border: 4px solid #e9ecef;
                border-top: 4px solid #3498db;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            }
            .pdf-viewer-error {
                text-align: center;
                padding: 60px 20px;
                background: linear-gradient(135deg, #fff5f5, #fed7d7);
                border: 1px solid #feb2b2;
                border-radius: 12px;
                color: #c53030;
            }
            .retry-btn {
                background: #e53e3e;
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 6px;
                cursor: pointer;
                font-weight: 600;
                transition: background 0.3s ease;
            }
            .retry-btn:hover {
                background: #c53030;
            }
        `;
        document.head.appendChild(style);
    }
});