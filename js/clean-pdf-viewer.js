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
            
            this.init();
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
                    withCredentials: false,
                    verbosity: 0 // Reduce console output
                });
                
                this.pdfDoc = await loadingTask.promise;
                this.hideLoading();
                this.updatePageInfo();
                await this.renderPage(this.pageNum);
                this.bindEvents();
                
                // Mark container as loaded for animations
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
                }, 1000 * this.retryCount); // Exponential backoff
            } else {
                this.showError(error);
            }
        }

        bindEvents() {
            // Previous page
            this.container.querySelector(`[data-viewer="${this.viewerId}"].pdf-prev`).addEventListener('click', () => {
                this.prevPage();
            });

            // Next page
            this.container.querySelector(`[data-viewer="${this.viewerId}"].pdf-next`).addEventListener('click', () => {
                this.nextPage();
            });

            // Zoom in
            this.container.querySelector(`[data-viewer="${this.viewerId}"].pdf-zoom-in`).addEventListener('click', () => {
                this.zoomIn();
            });

            // Zoom out
            this.container.querySelector(`[data-viewer="${this.viewerId}"].pdf-zoom-out`).addEventListener('click', () => {
                this.zoomOut();
            });

            // Fullscreen toggle
            this.container.querySelector(`[data-viewer="${this.viewerId}"].pdf-fullscreen`).addEventListener('click', () => {
                this.toggleFullscreen();
            });

            // Touch/swipe support for mobile
            this.addTouchSupport();

            // Keyboard navigation
            document.addEventListener('keydown', (e) => {
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
            });

            // Handle browser fullscreen change
            document.addEventListener('fullscreenchange', () => {
                if (!document.fullscreenElement && this.isFullscreen) {
                    this.exitFullscreen();
                }
            });

            // Focus management for accessibility
            this.container.addEventListener('focusin', () => {
                this.container.classList.add('keyboard-focus');
            });

            this.container.addEventListener('focusout', (e) => {
                if (!this.container.contains(e.relatedTarget)) {
                    this.container.classList.remove('keyboard-focus');
                }
            });
        }

        addTouchSupport() {
            let startX = 0;
            let startY = 0;
            const minSwipeDistance = 50;

            this.canvas.addEventListener('touchstart', (e) => {
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
            }, { passive: true });

            this.canvas.addEventListener('touchend', (e) => {
                if (!startX || !startY) return;

                const endX = e.changedTouches[0].clientX;
                const endY = e.changedTouches[0].clientY;
                const diffX = startX - endX;
                const diffY = startY - endY;

                // Only process horizontal swipes
                if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > minSwipeDistance) {
                    if (diffX > 0) {
                        // Swipe left - next page
                        this.nextPage();
                    } else {
                        // Swipe right - previous page
                        this.prevPage();
                    }
                }

                startX = 0;
                startY = 0;
            }, { passive: true });
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
                
                // Handle high DPI displays
                const devicePixelRatio = window.devicePixelRatio || 1;
                const scaledViewport = page.getViewport({ scale: this.scale * devicePixelRatio });
                
                this.canvas.width = scaledViewport.width;
                this.canvas.height = scaledViewport.height;
                this.canvas.style.width = viewport.width + 'px';
                this.canvas.style.height = viewport.height + 'px';
                
                // Scale context for high DPI
                this.ctx.scale(devicePixelRatio, devicePixelRatio);

                const renderContext = {
                    canvasContext: this.ctx,
                    viewport: viewport
                };

                const renderTask = page.render(renderContext);
                await renderTask.promise;
                
                this.pageRendering = false;

                if (this.pageNumPending !== null) {
                    const pending = this.pageNumPending;
                    this.pageNumPending = null;
                    this.renderPage(pending);
                }

                this.updateControls();
                this.updateZoomLevel();
                
                // Announce page change to screen readers
                this.announcePageChange();
                
            } catch (error) {
                console.error('Error rendering page:', error);
                this.pageRendering = false;
                this.showError(error);
            }
        }

        announcePageChange() {
            const announcement = `Page ${this.pageNum} of ${this.pdfDoc.numPages}`;
            const ariaLive = this.container.querySelector('[aria-live]');
            if (ariaLive) {
                ariaLive.textContent = announcement;
            }
        }

        queueRenderPage(num) {
            if (num < 1 || num > this.pdfDoc.numPages) return;
            
            if (this.pageRendering) {
                this.pageNumPending = num;
            } else {
                this.renderPage(num);
            }
        }

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

        goToPage(num) {
            if (num < 1 || num > this.pdfDoc.numPages || num === this.pageNum) return;
            this.pageNum = num;
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
            
            // Try to enter browser fullscreen
            if (this.container.requestFullscreen) {
                this.container.requestFullscreen().catch(err => {
                    console.log('Fullscreen request failed:', err);
                });
            } else if (this.container.webkitRequestFullscreen) {
                this.container.webkitRequestFullscreen();
            } else if (this.container.msRequestFullscreen) {
                this.container.msRequestFullscreen();
            }
            
            // Update button text
            const fullscreenBtn = this.container.querySelector('.pdf-fullscreen');
            fullscreenBtn.textContent = cleanPdfAjax.strings.exit_fullscreen || 'Exit Fullscreen';
            fullscreenBtn.setAttribute('aria-label', 'Exit fullscreen mode');
            
            // Re-render to fit new dimensions
            setTimeout(() => {
                this.renderPage(this.pageNum);
            }, 100);
        }

        exitFullscreen() {
            this.isFullscreen = false;
            this.container.classList.remove('fullscreen');
            
            // Exit browser fullscreen
            if (document.exitFullscreen) {
                document.exitFullscreen().catch(err => {
                    console.log('Exit fullscreen failed:', err);
                });
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.msExitFullscreen) {
                document.msExitFullscreen();
            }
            
            // Update button text
            const fullscreenBtn = this.container.querySelector('.pdf-fullscreen');
            fullscreenBtn.textContent = cleanPdfAjax.strings.fullscreen || 'Fullscreen';
            fullscreenBtn.setAttribute('aria-label', 'Enter fullscreen mode');
            
            // Re-render to fit original dimensions
            setTimeout(() => {
                this.renderPage(this.pageNum);
            }, 100);
        }

        updateControls() {
            const prevBtn = this.container.querySelector('.pdf-prev');
            const nextBtn = this.container.querySelector('.pdf-next');
            const currentPageSpan = this.container.querySelector('.pdf-current-page');

            prevBtn.disabled = (this.pageNum <= 1);
            nextBtn.disabled = (this.pageNum >= this.pdfDoc.numPages);
            currentPageSpan.textContent = this.pageNum;
            
            // Update ARIA labels
            prevBtn.setAttribute('aria-label', `Previous page (currently on page ${this.pageNum})`);
            nextBtn.setAttribute('aria-label', `Next page (currently on page ${this.pageNum})`);
        }

        updatePageInfo() {
            const totalPagesSpan = this.container.querySelector('.pdf-total-pages');
            totalPagesSpan.textContent = this.pdfDoc.numPages;
        }

        updateZoomLevel() {
            const zoomLevelSpan = this.container.querySelector('.pdf-zoom-level');
            const zoomPercent = Math.round(this.scale * 100);
            zoomLevelSpan.textContent = zoomPercent + '%';
            
            // Update zoom button states
            const zoomInBtn = this.container.querySelector('.pdf-zoom-in');
            const zoomOutBtn = this.container.querySelector('.pdf-zoom-out');
            
            zoomOutBtn.disabled = (this.scale <= 0.5);
            zoomInBtn.disabled = (this.scale >= 3.0);
            
            // Update ARIA labels
            zoomInBtn.setAttribute('aria-label', `Zoom in (currently ${zoomPercent}%)`);
            zoomOutBtn.setAttribute('aria-label', `Zoom out (currently ${zoomPercent}%)`);
        }

        showLoading() {
            this.container.querySelector('.pdf-loading').style.display = 'block';
            this.container.querySelector('.pdf-error').style.display = 'none';
        }

        hideLoading() {
            this.container.querySelector('.pdf-loading').style.display = 'none';
        }

        showError(error) {
            this.container.querySelector('.pdf-loading').style.display = 'none';
            const errorDiv = this.container.querySelector('.pdf-error');
            errorDiv.style.display = 'block';
            
            // Provide more specific error messages
            let errorMessage = 'Error loading PDF. Please try again.';
            if (error.name === 'InvalidPDFException') {
                errorMessage = 'Invalid PDF file. Please check the file format.';
            } else if (error.name === 'MissingPDFException') {
                errorMessage = 'PDF file not found. Please check the URL.';
            } else if (error.name === 'UnexpectedResponseException') {
                errorMessage = 'Network error. Please check your connection.';
            }
            
            errorDiv.textContent = errorMessage;
        }

        downloadPdf(url) {
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
        }
    }

    // Book Selector functionality
    // Enhanced Book Selector functionality
class PDFBookSelector {
    constructor() {
        this.currentViewer = null;
        this.initializeBookSelector();
    }

    initializeBookSelector() {
        const readButtons = document.querySelectorAll('.read-book-btn');
        const viewerContainer = document.getElementById('pdf-viewer-container');
        
        if (!viewerContainer) return;

        // Auto-load first book by default
        const firstButton = readButtons[0];
        if (firstButton && !viewerContainer.classList.contains('loaded')) {
            this.loadBookViewer(firstButton, viewerContainer, true);
        }

        // Bind click events for all book buttons
        readButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                this.loadBookViewer(e.target, viewerContainer);
            });
        });
    }

    async loadBookViewer(button, container, isAutoLoad = false) {
        const bookId = button.dataset.bookId;
        const originalText = button.textContent;
        
        // Update button states - highlight selected
        this.updateButtonStates(button);
        
        try {
            // Show loading state
            if (!isAutoLoad) {
                button.innerHTML = '<span class="book-loading"></span> Loading...';
                button.disabled = true;
            }
            
            container.innerHTML = '<div class="pdf-viewer-loading"><div class="book-loading"></div><p>Loading PDF Viewer...</p></div>';
            
            // Create secure PDF URL for the book
            const pdfUrl = this.createSecurePDFUrl(bookId);
            
            // Generate unique viewer ID
            const viewerId = 'pdf-viewer-' + bookId + '-' + Date.now();
            
            // Create PDF viewer HTML
            const viewerHTML = this.createPDFViewerHTML(viewerId, pdfUrl);
            
            container.innerHTML = viewerHTML;
            container.classList.add('loaded');
            
            // Initialize new PDF viewer
            const newCanvas = container.querySelector('.pdf-canvas');
            if (newCanvas) {
                // Clean up previous viewer if exists
                if (this.currentViewer) {
                    this.currentViewer.cleanup();
                }
                
                this.currentViewer = new CleanPDFViewer(newCanvas);
            }
            
            // Smooth scroll to viewer (only if not auto-loading)
            if (!isAutoLoad) {
                this.smoothScrollTo(container);
            }
            
        } catch (error) {
            console.error('Error loading PDF viewer:', error);
            container.innerHTML = `
                <div class="pdf-viewer-error">
                    <h4>Error Loading PDF</h4>
                    <p>Unable to load the PDF viewer. Please try again later.</p>
                    <button class="retry-btn" onclick="location.reload()">Retry</button>
                </div>
            `;
        } finally {
            // Reset button state
            if (!isAutoLoad) {
                button.textContent = originalText;
                button.disabled = false;
            }
        }
    }

    createSecurePDFUrl(bookId) {
        // Create URL with nonce for security
        const url = new URL(cleanPdfAjax.ajax_url);
        url.searchParams.append('action', 'serve_protected_pdf');
        url.searchParams.append('book_id', bookId);
        url.searchParams.append('nonce', this.createNonce('serve_pdf_' + bookId));
        return url.toString();
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

    createNonce(action) {
        // Simple nonce generation for client-side
        return btoa(action + Date.now()).replace(/[^a-zA-Z0-9]/g, '').substr(0, 10);
    }

    getNonce() {
        // Try to get nonce from various sources
        if (typeof cleanPdfAjax !== 'undefined' && cleanPdfAjax.nonce) {
            return cleanPdfAjax.nonce;
        }
        
        // Fallback: look for nonce in meta tags or hidden inputs
        const nonceMeta = document.querySelector('meta[name="pdf-viewer-nonce"]');
        if (nonceMeta) {
            return nonceMeta.content;
        }
        
        // Generate a basic nonce as last resort
        return Date.now().toString(36);
    }

    smoothScrollTo(element) {
        const offsetTop = element.getBoundingClientRect().top + window.pageYOffset - 100;
        
        window.scrollTo({
            top: offsetTop,
            behavior: 'smooth'
        });
    }
}

// Enhanced PDF Viewer with cleanup method
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
        element.addEventListener(event, handler, options);
        this.eventListeners.push({
            element,
            event,
            handler,
            options
        });
    }

    // Cleanup method to remove all event listeners
    cleanup() {
        this.eventListeners.forEach(({ element, event, handler, options }) => {
            element.removeEventListener(event, handler, options);
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
                withCredentials: false,
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

        // Touch/swipe support
        this.addTouchSupport();

        // Keyboard navigation (only when focused)
        this.addKeyboardSupport();
    }

    // Rest of the CleanPDFViewer methods remain the same...
    // (keeping the existing methods for brevity)
}

// Initialize enhanced functionality when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    // Set PDF.js worker
    if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    // Initialize PDF viewers for direct shortcodes
    document.querySelectorAll('.pdf-canvas').forEach(canvas => {
        new CleanPDFViewer(canvas);
    });

    // Initialize enhanced book selector
    if (document.querySelector('.pdf-book-selector')) {
        new PDFBookSelector();
    }
});

    // Initialize PDF viewers on page load
    document.querySelectorAll('.pdf-canvas').forEach(canvas => {
        new CleanPDFViewer(canvas);
    });

    // Initialize book selector if it exists
    if (document.querySelector('.pdf-book-selector')) {
        new PDFBookSelector();
    }

    // Handle mpesa modal integration
    document.addEventListener('click', function(e) {
        if (e.target && e.target.id === 'open-mpesa-modal') {
            const modal = document.getElementById('mpesa-payment-modal');
            if (modal) {
                modal.style.display = 'block';
            }
        }
        
        if (e.target && (e.target.classList.contains('mpesa-close') || e.target.classList.contains('mpesa-cancel'))) {
            const modal = document.getElementById('mpesa-payment-modal');
            if (modal) {
                modal.style.display = 'none';
            }
        }
    });

    // Close modal when clicking outside
    window.addEventListener('click', function(e) {
        const modal = document.getElementById('mpesa-payment-modal');
        if (modal && e.target === modal) {
            modal.style.display = 'none';
        }
    });

    // Performance optimization: Intersection Observer for lazy loading
    if ('IntersectionObserver' in window) {
        const pdfObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const canvas = entry.target;
                    if (canvas.classList.contains('pdf-canvas') && !canvas.dataset.initialized) {
                        canvas.dataset.initialized = 'true';
                        new CleanPDFViewer(canvas);
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
});