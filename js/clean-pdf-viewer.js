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
            
            this.init();
        }

        async init() {
            try {
                this.showLoading();
                
                // Check if PDF.js is loaded
                if (typeof pdfjsLib === 'undefined') {
                    throw new Error('PDF.js library not loaded');
                }
                
                const loadingTask = pdfjsLib.getDocument(this.pdfUrl);
                this.pdfDoc = await loadingTask.promise;
                this.hideLoading();
                this.updatePageInfo();
                this.renderPage(this.pageNum);
                this.bindEvents();
            } catch (error) {
                console.error('Error loading PDF:', error);
                this.showError();
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

            // Download
            this.container.querySelector(`[data-viewer="${this.viewerId}"].pdf-download`).addEventListener('click', (e) => {
                this.downloadPdf(e.target.dataset.url);
            });

            // Keyboard navigation
            document.addEventListener('keydown', (e) => {
                if (!this.isFullscreen) return;
                
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
                }
            });

            // Handle browser fullscreen change
            document.addEventListener('fullscreenchange', () => {
                if (!document.fullscreenElement && this.isFullscreen) {
                    this.exitFullscreen();
                }
            });
        }

        async renderPage(num) {
            this.pageRendering = true;
            
            try {
                const page = await this.pdfDoc.getPage(num);
                const viewport = page.getViewport({ scale: this.scale });
                
                this.canvas.height = viewport.height;
                this.canvas.width = viewport.width;

                const renderContext = {
                    canvasContext: this.ctx,
                    viewport: viewport
                };

                await page.render(renderContext).promise;
                this.pageRendering = false;

                if (this.pageNumPending !== null) {
                    this.renderPage(this.pageNumPending);
                    this.pageNumPending = null;
                }

                this.updateControls();
                this.updateZoomLevel();
            } catch (error) {
                console.error('Error rendering page:', error);
                this.pageRendering = false;
            }
        }

        queueRenderPage(num) {
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

        zoomIn() {
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

        showError() {
            this.container.querySelector('.pdf-loading').style.display = 'none';
            this.container.querySelector('.pdf-error').style.display = 'block';
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

    // Initialize all PDF viewers on the page
    document.querySelectorAll('.pdf-canvas').forEach(canvas => {
        new CleanPDFViewer(canvas);
    });
});