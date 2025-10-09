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
            
            this.pageCache = new Map(); // Cache for rendered pages
            this.preloadedPages = new Set(); // Track preloaded pages
            this.maxCacheSize = 10; // Maximum number of pages to keep in cache
            this.isProgressive = true; // Enable progressive loading
            this.renderQuality = 1.5; // Initial render quality (can be adjusted)
            
            // Add loading progress elements
            this.progressContainer = document.createElement('div');
            this.progressContainer.className = 'pdf-loading-progress';
            this.container.appendChild(this.progressContainer);
            
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
                
                if (typeof pdfjsLib === 'undefined') {
                    throw new Error('PDF.js library not loaded');
                }

                const loadingTask = pdfjsLib.getDocument({
                    url: this.pdfUrl,
                    withCredentials: true,
                    rangeChunkSize: 65536,
                    maxImageSize: 1024 * 1024,
                    cMapPacked: true,
                    disableAutoFetch: false,
                    disableStream: false
                });

                loadingTask.onProgress = (progress) => {
                    const percent = (progress.loaded / progress.total * 100).toFixed(1);
                    this.updateLoadingProgress(percent);
                };

                this.pdfDoc = await loadingTask.promise;
                this.hideLoading();
                
                // Update total pages immediately after loading
                this.updatePageInfo();

                await this.renderPageProgressive(this.pageNum, 0.8);
                this.preloadNextPages(this.pageNum);
                this.bindEvents();
                
                // Hide progress container after loading
                if (this.progressContainer) {
                    this.progressContainer.style.display = 'none';
                }
                
                this.container.classList.add('loaded');

            } catch (error) {
                console.error('Error loading PDF:', error);
                this.handleLoadError(error);
            }
        }

        updateLoadingProgress(percent) {
            this.progressContainer.innerHTML = `
                <div class="progress-bar">
                    <div class="progress" style="width: ${percent}%"></div>
                </div>
                <div class="progress-text">Loading PDF: ${percent}%</div>
            `;
        }

        async renderPageProgressive(num, initialQuality = 0.8) {
            if (this.pageRendering) {
                this.pageNumPending = num;
                return;
            }

            this.pageRendering = true;

            try {
                const page = await this.pdfDoc.getPage(num);
                
                // First render at lower quality for quick display
                if (this.isProgressive) {
                    await this.renderPageAtQuality(page, initialQuality);
                    
                    // Then render at full quality
                    if (!this.pageNumPending) {
                        await this.renderPageAtQuality(page, this.renderQuality);
                    }
                } else {
                    await this.renderPageAtQuality(page, this.renderQuality);
                }

                this.pageRendering = false;

                if (this.pageNumPending !== null) {
                    const pending = this.pageNumPending;
                    this.pageNumPending = null;
                    this.renderPageProgressive(pending);
                }

                this.updateControls();
                this.updateZoomLevel();
                this.announcePageChange();

                // Cache the rendered page
                this.cachePageRendering(num, page);

            } catch (error) {
                console.error('Error rendering page:', error);
                this.pageRendering = false;
                this.showError(error);
            }
        }

        async renderPageAtQuality(page, quality) {
            const viewport = page.getViewport({ scale: this.scale * quality });
            
            // Adjust canvas size for device pixel ratio
            const pixelRatio = window.devicePixelRatio || 1;
            const scaledViewport = page.getViewport({ scale: this.scale * quality * pixelRatio });
            
            this.canvas.width = scaledViewport.width;
            this.canvas.height = scaledViewport.height;
            this.canvas.style.width = viewport.width + 'px';
            this.canvas.style.height = viewport.height + 'px';
            
            this.ctx.scale(pixelRatio, pixelRatio);

            const renderContext = {
                canvasContext: this.ctx,
                viewport: viewport,
                renderInteractiveForms: false, // Disable for better performance
                enableWebGL: true, // Enable WebGL rendering if available
            };

            const renderTask = page.render(renderContext);
            return renderTask.promise;
        }

        async preloadNextPages(currentPage) {
            const pagesToPreload = 2; // Number of pages to preload
            
            for (let i = 1; i <= pagesToPreload; i++) {
                const pageNum = currentPage + i;
                if (pageNum <= this.pdfDoc.numPages && !this.preloadedPages.has(pageNum)) {
                    try {
                        const page = await this.pdfDoc.getPage(pageNum);
                        this.preloadedPages.add(pageNum);
                        // Store in cache
                        this.cachePageRendering(pageNum, page);
                    } catch (error) {
                        console.warn(`Failed to preload page ${pageNum}:`, error);
                    }
                }
            }
        }

        cachePageRendering(pageNum, page) {
            // Implement LRU cache
            if (this.pageCache.size >= this.maxCacheSize) {
                const firstKey = this.pageCache.keys().next().value;
                this.pageCache.delete(firstKey);
            }
            this.pageCache.set(pageNum, page);
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

        async queueRenderPage(num) {
            if (num < 1 || num > this.pdfDoc.numPages) return;
            
            if (this.pageRendering) {
                this.pageNumPending = num;
            } else {
                // Update page number before rendering
                this.pageNum = num;
                
                // Check cache first
                if (this.pageCache.has(num)) {
                    const page = this.pageCache.get(num);
                    await this.renderPageAtQuality(page, this.renderQuality);
                } else {
                    await this.renderPageProgressive(num);
                }
                
                // Update UI after page change
                this.updateControls();
                this.updatePageInfo();
                this.announcePageChange();
                
                // Preload next pages
                this.preloadNextPages(num);
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
            const totalPagesSpan = this.container.querySelector('.pdf-total-pages');

            if (prevBtn) prevBtn.disabled = (this.pageNum <= 1);
            if (nextBtn) nextBtn.disabled = (this.pageNum >= this.pdfDoc.numPages);
            if (currentPageSpan) currentPageSpan.textContent = this.pageNum;
            if (totalPagesSpan) totalPagesSpan.textContent = this.pdfDoc.numPages;
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
            
            // Also hide the progress container
            if (this.progressContainer) {
                this.progressContainer.style.display = 'none';
            }
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

        bindEvents() {
            // Navigation buttons
            this.addEventListenerWithCleanup(
                this.container.querySelector('.pdf-prev'),
                'click',
                () => this.prevPage()
            );
            
            this.addEventListenerWithCleanup(
                this.container.querySelector('.pdf-next'),
                'click',
                () => this.nextPage()
            );

            // Zoom buttons
            this.addEventListenerWithCleanup(
                this.container.querySelector('.pdf-zoom-in'),
                'click',
                () => this.zoomIn()
            );
            
            this.addEventListenerWithCleanup(
                this.container.querySelector('.pdf-zoom-out'),
                'click',
                () => this.zoomOut()
            );

            // Fullscreen button
            this.addEventListenerWithCleanup(
                this.container.querySelector('.pdf-fullscreen'),
                'click',
                () => this.toggleFullscreen()
            );

            // Add download button handler
            this.addEventListenerWithCleanup(
                this.container.querySelector('.pdf-download-btn'),
                'click',
                (e) => {
                    e.preventDefault();
                    const bookId = e.target.dataset.bookId;
                    
                    // Find or create modal
                    let modal = document.getElementById('mpesa-payment-modal');
                    if (!modal) {
                        // Create modal if it doesn't exist
                        modal = document.createElement('div');
                        modal.id = 'mpesa-payment-modal';
                        modal.className = 'mpesa-modal';
                        document.body.appendChild(modal);
                    }

                    // Update modal data and show it
                    modal.setAttribute('data-book-id', bookId);
                    modal.style.display = 'block';

                    // Trigger custom event for M-Pesa integration
                    const event = new CustomEvent('mpesa-download-initiated', {
                        detail: { bookId: bookId }
                    });
                    document.dispatchEvent(event);

                    console.log('Download modal triggered for book:', bookId);
                }
            );

            // Keyboard navigation
            this.addEventListenerWithCleanup(
                document,
                'keydown',
                (e) => {
                    if (!this.container.contains(document.activeElement)) return;
                    
                    switch(e.key) {
                        case 'ArrowLeft':
                            this.prevPage();
                            break;
                        case 'ArrowRight':
                            this.nextPage();
                            break;
                        case '+':
                            this.zoomIn();
                            break;
                        case '-':
                            this.zoomOut();
                            break;
                    }
                }
            );

            // Fullscreen change event
            this.addEventListenerWithCleanup(
                document,
                'fullscreenchange',
                () => {
                    if (!document.fullscreenElement) {
                        this.exitFullscreen();
                    }
                }
            );
        }

        handleLoadError(error) {
            if (this.retryCount < this.maxRetries) {
                this.retryCount++;
                console.log(`Retrying PDF load (attempt ${this.retryCount} of ${this.maxRetries})...`);
                setTimeout(() => this.init(), 1000 * this.retryCount);
            } else {
                this.showError(error);
                console.error('Max retries reached. PDF load failed:', error);
                
                // Create retry button
                const retryButton = document.createElement('button');
                retryButton.className = 'retry-btn';
                retryButton.textContent = 'Try Again';
                retryButton.onclick = () => {
                    this.retryCount = 0;
                    this.init();
                };
                
                // Add retry button to error display
                const errorDiv = this.container.querySelector('.pdf-error');
                if (errorDiv) {
                    errorDiv.appendChild(retryButton);
                }
            }
        }
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

            // Listen for M-Pesa modal triggers
            document.addEventListener('mpesa-download-initiated', (e) => {
                const bookId = e.detail.bookId;
                const modal = document.getElementById('mpesa-payment-modal');
                if (modal) {
                    modal.style.display = 'block';
                    modal.setAttribute('data-book-id', bookId);
                } else {
                    console.error('M-Pesa modal not found');
                }
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

    // Add CSS for progress bar
    const style = document.createElement('style');
    style.textContent = `
        .pdf-loading-progress {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 80%;
            max-width: 300px;
            text-align: center;
        }
        .progress-bar {
            background: rgba(255,255,255,0.1);
            height: 4px;
            border-radius: 2px;
            margin: 10px 0;
        }
        .progress {
            background: #3498db;
            height: 100%;
            border-radius: 2px;
            transition: width 0.3s ease;
        }
        .progress-text {
            color: white;
            font-size: 14px;
        }
    `;
    document.head.appendChild(style);
});