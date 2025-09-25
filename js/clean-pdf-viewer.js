document.addEventListener('DOMContentLoaded', function() {
    // Set PDF.js worker with fallback
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
            
            this.init();
        }

        // Add event listener with cleanup tracking
        addEventListenerWithCleanup(element, event, handler, options = false) {
            if (element) {
                element.addEventListener(event, handler, options);
                this.eventListeners.push({
                    element,
                    event,
                    handler,
                    options
                });
            }
        }

        // Cleanup method to remove all event listeners
        cleanup() {
            this.eventListeners.forEach(({ element, event, handler, options }) => {
                if (element) {
                    element.removeEventListener(event, handler, options);
                }
            });
            this.eventListeners = [];
            
            // Cancel any ongoing render tasks
            if (this.renderTask) {
                this.renderTask.cancel();
            }
            
            // Clear canvas
            if (this.ctx) {
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            }
        }

        async init() {
            try {
                this.showLoading();
                
                // Check if PDF.js is loaded
                if (typeof pdfjsLib === 'undefined') {
                    throw new Error('PDF.js library not loaded');
                }
                
                const loadingTask = pdfjsLib.getDocument({
                    url: this.pdfUrl,
                    withCredentials: true, // Changed to true for protected PDFs
                    verbosity: 0
                });
                
                this.pdfDoc = await loadingTask.promise;
                this.hideLoading();
                this.updatePageInfo();
                await this.renderPage(this.pageNum);
                this.bindEvents();
                
                // Mark container as loaded
                this.container.classList.add('loaded');
                
            } catch (error) {
                console.error('Error loading PDF:', error);
                this.handleLoadError(error);
            }
        }

        handleLoadError(error) {
            if (this.retryCount < this.maxRetries) {
                this.retryCount++;
                console.log(`Retrying PDF load (attempt ${this.retryCount}/${this.maxRetries})`);
                setTimeout(() => {
                    this.init();
                }, 1000 * this.retryCount);
            } else {
                this.showError(error);
            }
        }

        bindEvents() {
            // Previous page
            const prevBtn = this.container.querySelector(`[data-viewer="${this.viewerId}"].pdf-prev`);
            if (prevBtn) {
                this.addEventListenerWithCleanup(prevBtn, 'click', () => this.prevPage());
            }

            // Next page  
            const nextBtn = this.container.querySelector(`[data-viewer="${this.viewerId}"].pdf-next`);
            if (nextBtn) {
                this.addEventListenerWithCleanup(nextBtn, 'click', () => this.nextPage());
            }

            // Zoom in
            const zoomInBtn = this.container.querySelector(`[data-viewer="${this.viewerId}"].pdf-zoom-in`);
            if (zoomInBtn) {
                this.addEventListenerWithCleanup(zoomInBtn, 'click', () => this.zoomIn());
            }

            // Zoom out
            const zoomOutBtn = this.container.querySelector(`[data-viewer="${this.viewerId}"].pdf-zoom-out`);
            if (zoomOutBtn) {
                this.addEventListenerWithCleanup(zoomOutBtn, 'click', () => this.zoomOut());
            }

            // Fullscreen toggle
            const fullscreenBtn = this.container.querySelector(`[data-viewer="${this.viewerId}"].pdf-fullscreen`);
            if (fullscreenBtn) {
                this.addEventListenerWithCleanup(fullscreenBtn, 'click', () => this.toggleFullscreen());
            }

             // Download
            //this.container.querySelector(`[data-viewer="${this.viewerId}"].pdf//-download`).addEventListener('click', (e) => {
               // this.downloadPdf(e.target.dataset.url);
           // });

            // Touch/swipe support
            this.addTouchSupport();
            
            // Keyboard navigation
            this.addKeyboardSupport();
        }

        addKeyboardSupport() {
            const keyHandler = (e) => {
                if (!this.isFullscreen && !this.container.classList.contains('keyboard-focus')) return;
                
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
                }
            };
            
            this.addEventListenerWithCleanup(document, 'keydown', keyHandler);
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

            this.addEventListenerWithCleanup(this.canvas, 'touchstart', touchStartHandler, { passive: true });
            this.addEventListenerWithCleanup(this.canvas, 'touchend', touchEndHandler, { passive: true });
        }

        async renderPage(num) {
            if (this.pageRendering) {
                this.pageNumPending = num;
                return;
            }

            this.pageRendering = true;
            
            try {
                const page = await this.pdfDoc.getPage(num);
                const viewport = page.getViewport({ scale: this.scale });
                
                const devicePixelRatio = window.devicePixelRatio || 1;
                const scaledViewport = page.getViewport({ scale: this.scale * devicePixelRatio });
                
                this.canvas.width = scaledViewport.width;
                this.canvas.height = scaledViewport.height;
                this.canvas.style.width = viewport.width + 'px';
                this.canvas.style.height = viewport.height + 'px';
                
                this.ctx.scale(devicePixelRatio, devicePixelRatio);

                const renderContext = {
                    canvasContext: this.ctx,
                    viewport: viewport
                };

                this.renderTask = page.render(renderContext);
                await this.renderTask.promise;
                
                this.pageRendering = false;

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
                this.showError(error);
            }
        }

        // Navigation methods
        prevPage() {
            if (this.pageNum <= 1) return;
            this.pageNum--;
            this.queueRenderPage(this.pageNum);
        }

        nextPage() {
            if (this.pageNum >= this.pdfDoc.numPages) return;
            this.pageNum++;
            this.queueRenderPage(this.pageNum);
        }

        zoomIn() {
            if (this.scale >= 3.0) return;
            this.scale += 0.25;
            this.queueRenderPage(this.pageNum);
        }

        zoomOut() {
            if (this.scale <= 0.5) return;
            this.scale -= 0.25;
            this.queueRenderPage(this.pageNum);
        }

        queueRenderPage(num) {
            if (num < 1 || num > this.pdfDoc.numPages) return;
            
            if (this.pageRendering) {
                this.pageNumPending = num;
            } else {
                this.renderPage(num);
            }
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
                this.container.requestFullscreen().catch(err => {
                    console.log('Fullscreen request failed:', err);
                });
            }
            
            const fullscreenBtn = this.container.querySelector('.pdf-fullscreen');
            if (fullscreenBtn) {
                fullscreenBtn.textContent = 'Exit Fullscreen';
            }
            
            setTimeout(() => {
                this.renderPage(this.pageNum);
            }, 100);
        }

        exitFullscreen() {
            this.isFullscreen = false;
            this.container.classList.remove('fullscreen');
            
            if (document.exitFullscreen) {
                document.exitFullscreen().catch(err => {
                    console.log('Exit fullscreen failed:', err);
                });
            }
            
            const fullscreenBtn = this.container.querySelector('.pdf-fullscreen');
            if (fullscreenBtn) {
                fullscreenBtn.textContent = 'Fullscreen';
            }
            
            setTimeout(() => {
                this.renderPage(this.pageNum);
            }, 100);
        }

        // UI Update methods
        updateControls() {
            const prevBtn = this.container.querySelector('.pdf-prev');
            const nextBtn = this.container.querySelector('.pdf-next');
            const currentPageSpan = this.container.querySelector('.pdf-current-page');

            if (prevBtn) prevBtn.disabled = (this.pageNum <= 1);
            if (nextBtn) nextBtn.disabled = (this.pageNum >= this.pdfDoc.numPages);
            if (currentPageSpan) currentPageSpan.textContent = this.pageNum;
        }

        updatePageInfo() {
            const totalPagesSpan = this.container.querySelector('.pdf-total-pages');
            if (totalPagesSpan) {
                totalPagesSpan.textContent = this.pdfDoc.numPages;
            }
        }

        updateZoomLevel() {
            const zoomLevelSpan = this.container.querySelector('.pdf-zoom-level');
            const zoomPercent = Math.round(this.scale * 100);
            if (zoomLevelSpan) {
                zoomLevelSpan.textContent = zoomPercent + '%';
            }
            
            const zoomInBtn = this.container.querySelector('.pdf-zoom-in');
            const zoomOutBtn = this.container.querySelector('.pdf-zoom-out');
            
            if (zoomOutBtn) zoomOutBtn.disabled = (this.scale <= 0.5);
            if (zoomInBtn) zoomInBtn.disabled = (this.scale >= 3.0);
        }

        announcePageChange() {
            const announcement = `Page ${this.pageNum} of ${this.pdfDoc.numPages}`;
            const ariaLive = this.container.querySelector('[aria-live]');
            if (ariaLive) {
                ariaLive.textContent = announcement;
            }
        }

        showLoading() {
            const loadingEl = this.container.querySelector('.pdf-loading');
            if (loadingEl) loadingEl.style.display = 'block';
            
            const errorEl = this.container.querySelector('.pdf-error');
            if (errorEl) errorEl.style.display = 'none';
        }

        hideLoading() {
            const loadingEl = this.container.querySelector('.pdf-loading');
            if (loadingEl) loadingEl.style.display = 'none';
        }

        showError(error) {
            this.hideLoading();
            const errorDiv = this.container.querySelector('.pdf-error');
            if (!errorDiv) return;
            
            errorDiv.style.display = 'block';
            
            let errorMessage = 'Error loading PDF. Please try again.';
            if (error.name === 'InvalidPDFException') {
                errorMessage = 'Invalid PDF file.';
            } else if (error.name === 'MissingPDFException') {
                errorMessage = 'PDF file not found.';
            } else if (error.name === 'UnexpectedResponseException') {
                errorMessage = 'Network error. Please check your connection.';
            }
            
            errorDiv.textContent = errorMessage;
        }



       /*     downloadPdf(url) {
        try {
            // Create a temporary link element
            const link = document.createElement('a');
            link.href = url;
            link.download = url.split('/').pop() || 'document.pdf';
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            
            // Add to DOM, click, then remove
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (error) {
            console.error('Download failed:', error);
            // Fallback: open in new tab
            window.open(url, '_blank', 'noopener,noreferrer');
        }
        } */

    }    
    // Fixed Book Selector functionality
    class PDFBookSelector {
        constructor() {
            this.currentViewer = null;
            this.initializeBookSelector();
        }

        initializeBookSelector() {
            const readButtons = document.querySelectorAll('.read-book-btn');
            const viewerContainer = document.getElementById('pdf-viewer-container');
            
            if (!viewerContainer || readButtons.length === 0) {
                console.log('No viewer container or read buttons found');
                return;
            }

            // Auto-load first book if specified
            const firstButton = Array.from(readButtons).find(btn => btn.dataset.autoLoad === 'true');
            if (firstButton && !viewerContainer.classList.contains('loaded')) {
                this.loadBookViewer(firstButton, viewerContainer, true);
            }

            // Bind click events for all book buttons
            readButtons.forEach(button => {
                button.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.loadBookViewer(e.target, viewerContainer);
                });
            });
        }

        async loadBookViewer(button, container, isAutoLoad = false) {
            const bookId = button.dataset.bookId;
            
            if (!bookId) {
                console.error('No book ID found');
                return;
            }

            const originalText = button.textContent;
            
            // Update button states
            this.updateButtonStates(button);
            
            try {
                // Show loading state
                if (!isAutoLoad) {
                    button.innerHTML = '<span class="book-loading"></span> Loading...';
                    button.disabled = true;
                }
                
                // Show loading in container
                container.innerHTML = `
                    <div class="pdf-viewer-loading">
                        <div class="book-loading-spinner"></div>
                        <p>Loading PDF Viewer...</p>
                    </div>
                `;
                
                // Use AJAX to load the PDF viewer (more reliable than direct URL generation)
                const response = await this.fetchPDFViewer(bookId);
                
                if (response.success) {
                    container.innerHTML = response.data.html;
                    container.classList.add('loaded');
                    
                    // Initialize the new PDF viewer
                    const newCanvas = container.querySelector('.pdf-canvas');
                    if (newCanvas) {
                        // Clean up previous viewer
                        if (this.currentViewer) {
                            this.currentViewer.cleanup();
                        }
                        
                        // Create new viewer
                        this.currentViewer = new CleanPDFViewer(newCanvas);
                    }
                    
                    // Smooth scroll to viewer (only if not auto-loading)
                    if (!isAutoLoad) {
                        this.smoothScrollTo(container);
                    }
                    
                } else {
                    throw new Error(response.data ? response.data.message : 'Failed to load PDF viewer');
                }
                
            } catch (error) {
                console.error('Error loading PDF viewer:', error);
                container.innerHTML = `
                    <div class="pdf-viewer-error">
                        <h4>Error Loading PDF</h4>
                        <p>${error.message || 'Unable to load the PDF viewer. Please try again later.'}</p>
                        <button class="retry-btn" onclick="location.reload()">Retry</button>
                    </div>
                `;
            } finally {
                // Reset button state
                if (!isAutoLoad) {
                    button.textContent = 'Currently Reading';
                    button.disabled = false;
                }
            }
        }

        async fetchPDFViewer(bookId) {
            // Check if we have the necessary AJAX data
            if (typeof cleanPdfAjax === 'undefined') {
                throw new Error('AJAX configuration not found');
            }

            const formData = new FormData();
            formData.append('action', 'load_pdf_viewer');
            formData.append('book_id', bookId);
            formData.append('nonce', cleanPdfAjax.load_pdf_nonce || cleanPdfAjax.nonce);

            const response = await fetch(cleanPdfAjax.ajax_url, {
                method: 'POST',
                body: formData,
                credentials: 'same-origin'
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            return data;
        }

        updateButtonStates(activeButton) {
            // Remove active state from all buttons
            document.querySelectorAll('.read-book-btn').forEach(btn => {
                btn.classList.remove('active');
                if (btn !== activeButton) {
                    btn.textContent = 'Read Book';
                }
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

    // Initialize PDF viewers for direct shortcodes (existing canvases)
    document.querySelectorAll('.pdf-canvas').forEach(canvas => {
        // Only initialize if not already initialized
        if (!canvas.dataset.initialized) {
            canvas.dataset.initialized = 'true';
            new CleanPDFViewer(canvas);
        }
    });

    // Initialize book selector if it exists
    const bookSelector = document.querySelector('.pdf-book-selector');
    if (bookSelector) {
        console.log('Initializing PDF Book Selector');
        new PDFBookSelector();
    }

    // Add CSS for loading animations
    if (!document.querySelector('#pdf-viewer-loading-styles')) {
        const style = document.createElement('style');
        style.id = 'pdf-viewer-loading-styles';
        style.textContent = `
            .pdf-viewer-loading {
                text-align: center;
                padding: 40px 20px;
                color: #666;
            }
            
            .book-loading-spinner {
                width: 40px;
                height: 40px;
                border: 4px solid #f3f3f3;
                border-top: 4px solid #3498db;
                border-radius: 50%;
                animation: spin 1s linear infinite;
                margin: 0 auto 20px;
            }
            
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            
            .pdf-viewer-error {
                text-align: center;
                padding: 40px 20px;
                color: #e74c3c;
                border: 1px solid #e74c3c;
                border-radius: 8px;
                margin: 20px 0;
            }
            
            .retry-btn {
                background: #3498db;
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 5px;
                cursor: pointer;
                margin-top: 15px;
            }
            
            .retry-btn:hover {
                background: #2980b9;
            }
        `;
        document.head.appendChild(style);
    }


    
});