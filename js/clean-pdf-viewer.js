document.addEventListener('DOMContentLoaded', function() {
    // Set PDF.js worker first
    if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    } else {
        console.error('PDF.js library not loaded');
        return;
    }

    // Add required CSS if not loaded
    if (!document.querySelector('#clean-pdf-viewer-styles')) {
        const cssLink = document.createElement('link');
        cssLink.id = 'clean-pdf-viewer-styles';
        cssLink.rel = 'stylesheet';
        cssLink.type = 'text/css';
        cssLink.href = 'data:text/css;base64,' + btoa(`
            .pdf-book-selector{max-width:1200px;margin:0 auto;padding:20px}
            .pdf-book-selector h3{text-align:center;color:#2c3e50;margin-bottom:30px;font-size:24px;font-weight:600}
            .book-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:25px;margin:20px 0}
            .book-item{border:1px solid #e1e8ed;border-radius:12px;padding:25px;text-align:center;transition:all 0.3s ease;background:white;box-shadow:0 2px 8px rgba(0,0,0,0.1);position:relative;overflow:hidden}
            .book-item:hover{transform:translateY(-8px);box-shadow:0 8px 25px rgba(0,0,0,0.15);border-color:#3498db}
            .book-cover{font-size:56px;margin-bottom:20px;opacity:0.8;transition:opacity 0.3s ease}
            .book-icon{display:inline-block;color:#3498db}
            .book-item h4{margin:15px 0;color:#2c3e50;font-size:18px;font-weight:600;line-height:1.4}
            .book-description{color:#7f8c8d;font-size:14px;margin:15px 0;line-height:1.5}
            .book-meta{margin:15px 0}
            .book-size{color:#95a5a6;font-size:12px;font-weight:500}
            .read-book-btn{background:linear-gradient(135deg,#3498db,#2980b9);color:white;border:none;padding:12px 24px;border-radius:25px;cursor:pointer;font-weight:600;font-size:14px;transition:all 0.3s ease;text-transform:uppercase;letter-spacing:0.5px;position:relative;overflow:hidden;min-width:140px}
            .read-book-btn.active{background:linear-gradient(135deg,#27ae60,#219a52);box-shadow:0 4px 15px rgba(39,174,96,0.4);transform:translateY(-2px)}
            .read-book-btn:hover:not(.active){background:linear-gradient(135deg,#2980b9,#1f639a);transform:translateY(-2px);box-shadow:0 4px 12px rgba(52,152,219,0.3)}
            .read-book-btn:disabled{opacity:0.7;cursor:not-allowed;transform:none}
            #pdf-viewer-container{margin-top:40px;opacity:0;transform:translateY(20px);transition:all 0.5s ease;border-radius:12px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.1)}
            #pdf-viewer-container.loaded{opacity:1;transform:translateY(0)}
            .pdf-viewer-loading{text-align:center;padding:60px 20px;background:linear-gradient(135deg,#f8f9fa,#e9ecef);border-radius:12px;color:#6c757d}
            .book-loading{width:40px;height:40px;margin:0 auto 20px;border:4px solid #e9ecef;border-top:4px solid #3498db;border-radius:50%;animation:spin 1s linear infinite}
            .clean-pdf-viewer-container{border:1px solid #ddd;border-radius:12px;overflow:hidden;background:#f9f9f9;position:relative;box-shadow:0 5px 15px rgba(0,0,0,0.08)}
            .pdf-controls{background:linear-gradient(135deg,#2c3e50,#34495e);padding:15px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}
            .pdf-controls-left,.pdf-controls-right{display:flex;align-items:center;gap:15px;flex-wrap:wrap}
            .pdf-btn{background:#3498db;color:white;border:none;padding:12px 20px;font-size:16px;font-weight:bold;border-radius:6px;cursor:pointer;transition:all 0.3s ease;min-width:120px}
            .pdf-btn:hover:not(:disabled){background:#2980b9;transform:translateY(-2px)}
            .pdf-btn:disabled{background:#7f8c8d;cursor:not-allowed;transform:none}
            .pdf-fullscreen{background:#9b59b6!important}
            .pdf-page-info,.pdf-zoom-level{color:white;font-weight:bold;font-size:14px;background:rgba(255,255,255,0.1);padding:8px 12px;border-radius:4px}
            .pdf-viewer-wrapper{background:white;overflow:auto;height:calc(100% - 70px);display:flex;justify-content:center;align-items:flex-start;padding:20px}
            .pdf-canvas{max-width:100%;height:auto;box-shadow:0 4px 8px rgba(0,0,0,0.1);border-radius:4px;display:block}
            .pdf-loading,.pdf-error{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);padding:20px 30px;border-radius:8px;color:white;font-weight:bold;z-index:10}
            .pdf-loading{background:rgba(0,0,0,0.8)}
            .pdf-error{background:#e74c3c}
            @keyframes spin{to{transform:rotate(360deg)}}
            @media (max-width:768px){.pdf-controls{flex-direction:column}.book-grid{grid-template-columns:1fr}}
        `);
        document.head.appendChild(cssLink);
    }

    // Define CleanPDFViewer class
    window.CleanPDFViewer = class CleanPDFViewer {
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
            
            if (!this.canvas || !this.container || !this.pdfUrl) {
                console.error('PDF Viewer: Missing required elements or PDF URL');
                return;
            }
            
            this.init();
        }

        async init() {
            try {
                this.showLoading();
                
                if (typeof pdfjsLib === 'undefined') {
                    throw new Error('PDF.js library not loaded. Please check your internet connection.');
                }
                
                if (!this.isValidUrl(this.pdfUrl)) {
                    throw new Error('Invalid PDF URL provided');
                }
                
                console.log('Loading PDF from:', this.pdfUrl);
                
                const loadingTask = pdfjsLib.getDocument({
                    url: this.pdfUrl,
                    withCredentials: false,
                    verbosity: 0
                });
                
                this.pdfDoc = await loadingTask.promise;
                console.log('PDF loaded successfully. Pages:', this.pdfDoc.numPages);
                
                this.hideLoading();
                this.updatePageInfo();
                await this.renderPage(this.pageNum);
                this.bindEvents();
                
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

        handleLoadError(error) {
            if (this.retryCount < this.maxRetries && error.name !== 'InvalidPDFException') {
                this.retryCount++;
                console.log(`Retrying PDF load (attempt ${this.retryCount}/${this.maxRetries})`);
                
                setTimeout(() => {
                    this.init();
                }, 1000 * this.retryCount);
                
                return;
            }
            
            let errorMessage = 'Error loading PDF. Please try again.';
            
            if (error.name === 'InvalidPDFException') {
                errorMessage = 'The file is not a valid PDF or may be corrupted.';
            } else if (error.name === 'MissingPDFException') {
                errorMessage = 'PDF file not found. Please check if the file exists.';
            } else if (error.name === 'UnexpectedResponseException') {
                errorMessage = 'Network error. Please check your internet connection.';
            }
            
            this.showError(errorMessage);
        }

        bindEvents() {
            this.clearEventListeners();
            
            const prevBtn = this.container.querySelector(`[data-viewer="${this.viewerId}"].pdf-prev`);
            if (prevBtn) {
                const handler = () => this.prevPage();
                prevBtn.addEventListener('click', handler);
                this.eventListeners.push({ element: prevBtn, event: 'click', handler });
            }

            const nextBtn = this.container.querySelector(`[data-viewer="${this.viewerId}"].pdf-next`);
            if (nextBtn) {
                const handler = () => this.nextPage();
                nextBtn.addEventListener('click', handler);
                this.eventListeners.push({ element: nextBtn, event: 'click', handler });
            }

            const zoomInBtn = this.container.querySelector(`[data-viewer="${this.viewerId}"].pdf-zoom-in`);
            if (zoomInBtn) {
                const handler = () => this.zoomIn();
                zoomInBtn.addEventListener('click', handler);
                this.eventListeners.push({ element: zoomInBtn, event: 'click', handler });
            }

            const zoomOutBtn = this.container.querySelector(`[data-viewer="${this.viewerId}"].pdf-zoom-out`);
            if (zoomOutBtn) {
                const handler = () => this.zoomOut();
                zoomOutBtn.addEventListener('click', handler);
                this.eventListeners.push({ element: zoomOutBtn, event: 'click', handler });
            }

            const fullscreenBtn = this.container.querySelector(`[data-viewer="${this.viewerId}"].pdf-fullscreen`);
            if (fullscreenBtn) {
                const handler = () => this.toggleFullscreen();
                fullscreenBtn.addEventListener('click', handler);
                this.eventListeners.push({ element: fullscreenBtn, event: 'click', handler });
            }
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
                
                this.canvas.width = viewport.width;
                this.canvas.height = viewport.height;
                
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

                const renderContext = {
                    canvasContext: this.ctx,
                    viewport: viewport
                };

                if (this.renderTask) {
                    this.renderTask.cancel();
                }

                this.renderTask = page.render(renderContext);
                await this.renderTask.promise;
                
                console.log(`Page ${num} rendered successfully`);
                
                this.pageRendering = false;

                if (this.pageNumPending !== null) {
                    const pending = this.pageNumPending;
                    this.pageNumPending = null;
                    this.renderPage(pending);
                }

                this.updateControls();
                this.updateZoomLevel();
                
            } catch (error) {
                console.error('Error rendering page:', error);
                this.pageRendering = false;
                
                if (error.name !== 'RenderingCancelledException') {
                    this.showError('Error rendering page. Please try again.');
                }
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
            
            if (this.container.requestFullscreen) {
                this.container.requestFullscreen().catch(console.error);
            }
            
            this.updateFullscreenButton();
            setTimeout(() => this.renderPage(this.pageNum), 100);
        }

        exitFullscreen() {
            this.isFullscreen = false;
            this.container.classList.remove('fullscreen');
            
            if (document.exitFullscreen) {
                document.exitFullscreen().catch(console.error);
            }
            
            this.updateFullscreenButton();
            setTimeout(() => this.renderPage(this.pageNum), 100);
        }

        updateFullscreenButton() {
            const fullscreenBtn = this.container.querySelector('.pdf-fullscreen');
            if (fullscreenBtn) {
                fullscreenBtn.textContent = this.isFullscreen ? 'Exit Fullscreen' : 'Fullscreen';
            }
        }

        updateControls() {
            if (!this.pdfDoc) return;
            
            const prevBtn = this.container.querySelector('.pdf-prev');
            const nextBtn = this.container.querySelector('.pdf-next');
            const currentPageSpan = this.container.querySelector('.pdf-current-page');

            if (prevBtn) prevBtn.disabled = (this.pageNum <= 1);
            if (nextBtn) nextBtn.disabled = (this.pageNum >= this.pdfDoc.numPages);
            if (currentPageSpan) currentPageSpan.textContent = this.pageNum;
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
            
            if (loadingEl) loadingEl.style.display = 'none';
            if (errorEl) {
                errorEl.style.display = 'block';
                errorEl.textContent = message;
            }
        }

        cleanup() {
            this.clearEventListeners();
            if (this.renderTask) {
                this.renderTask.cancel();
            }
            if (this.ctx) {
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            }
        }
    };

    // Define PDFBookSelector class
    window.PDFBookSelector = class PDFBookSelector {
        constructor() {
            this.currentViewer = null;
            this.initializeBookSelector();
        }

        initializeBookSelector() {
            const readButtons = document.querySelectorAll('.read-book-btn');
            const viewerContainer = document.getElementById('pdf-viewer-container');
            
            if (!viewerContainer) return;

            const firstButton = readButtons[0];
            if (firstButton && firstButton.dataset.autoLoad === 'true') {
                setTimeout(() => {
                    this.loadBookViewer(firstButton, viewerContainer, true);
                }, 500);
            }

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
            
            this.updateButtonStates(button);
            
            try {
                if (!isAutoLoad) {
                    const originalText = button.textContent;
                    button.innerHTML = 'Loading...';
                    button.disabled = true;
                    
                    setTimeout(() => {
                        button.innerHTML = originalText;
                        button.disabled = false;
                    }, 3000);
                }
                
                container.innerHTML = '<div class="pdf-viewer-loading"><div class="book-loading"></div><p>Loading PDF Viewer...</p></div>';
                
                const pdfUrl = this.createSecurePDFUrl(bookId);
                const viewerId = 'pdf-viewer-' + bookId + '-' + Date.now();
                const viewerHTML = this.createPDFViewerHTML(viewerId, pdfUrl);
                
                container.innerHTML = viewerHTML;
                container.classList.add('loaded');
                
                setTimeout(() => {
                    const newCanvas = container.querySelector('.pdf-canvas');
                    if (newCanvas) {
                        if (this.currentViewer) {
                            this.currentViewer.cleanup();
                        }
                        this.currentViewer = new CleanPDFViewer(newCanvas);
                    }
                }, 200);
                
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
            document.querySelectorAll('.read-book-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            activeButton.classList.add('active');
        }

        smoothScrollTo(element) {
            const offsetTop = element.getBoundingClientRect().top + window.pageYOffset - 100;
            window.scrollTo({
                top: offsetTop,
                behavior: 'smooth'
            });
        }
    };

    // Initialize after classes are defined
    setTimeout(() => {
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
    }, 100);
});