'use strict';

const config = {
    proxyUrl: 'https://sh.dafeyan784.workers.dev/?target=',
    targetUrl: 'https://jnovels.com/top-light-novels-to-read/',
    batchSize: 40,
    maxRetries: 3,
    retryDelay: 1000,
    searchDebounceTime: 300,
    intersectionObserverThreshold: 0.2,
    intersectionObserverRootMargin: '250px',
    errorMessageDisplayTime: 5000,
    fetchTimeout: 10000,
    fallbackImage: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="300" viewBox="0 0 200 300"%3E%3Crect width="100%" height="100%" fill="%23f0f0f0"/%3E%3Ctext x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" fill="%23999"%3EImage not available%3C/text%3E%3C/svg%3E'
};

class NovelWebsite {
    constructor() {
        this.db = new Database();
        this.elements = this.getElements();
        this.state = {
            currentBatch: 0,
            images: [],
            loadedImages: new Set(),
            isLoading: false,
            isPanelOpen: false,
            pdfUrlToTextMap: new Map(),
        };
        this.setupEventListeners();
    }

    getElements() {
        return {
            bookGrid: document.querySelector('#book-grid'),
            searchInput: document.querySelector('#search-input'),
            searchButton: document.querySelector('#search-button'),
            loadingSpinner: document.querySelector('.loading-spinner'),
            menuBtn: document.querySelector('.menu-btn'),
            menuPanel: document.querySelector('#menu-panel'),
            libraryPanel: document.querySelector('#library-panel'),
            settingsPanel: document.querySelector('#settings-panel'),
            themeToggle: document.querySelector('#theme-toggle'),
            errorMessage: document.querySelector('#error-message'),
            libraryLink: document.querySelector('#library-link'),
            settingsLink: document.querySelector('#settings-link')
        };
    }

    setupEventListeners() {
        this.elements.searchInput?.addEventListener('keydown', this.handleSearchKeydown.bind(this));
        this.elements.searchButton?.addEventListener('click', this.performSearch.bind(this));
        this.elements.menuBtn?.addEventListener('click', () => this.togglePanel(this.elements.menuPanel));
        this.elements.libraryLink?.addEventListener('click', this.handleLibraryLink.bind(this));
        this.elements.settingsLink?.addEventListener('click', this.handleSettingsLink.bind(this));
        document.addEventListener('click', this.handleDocumentClick.bind(this));
        this.elements.themeToggle?.addEventListener('change', this.handleThemeToggle.bind(this));
        window.addEventListener('beforeunload', this.handleBeforeUnload.bind(this));
    }

    async init() {
        this.loadSavedTheme();
        if (typeof AOS !== 'undefined') {
            AOS.init();
        }
        await this.fetchAndLoadImages();
    }

    loadSavedTheme() {
        const savedTheme = localStorage.getItem('darkTheme');
        if (savedTheme === 'true') {
            document.body.classList.add('dark-theme');
            if (this.elements.themeToggle) {
                this.elements.themeToggle.checked = true;
            }
        }
    }

    async fetchAndLoadImages() {
        if (this.state.isLoading || this.state.isPanelOpen) return;
        this.state.isLoading = true;
        this.toggleLoadingSpinner(true);

        try {
            const storedHtml = await this.db.getHtmlContent(1);
            const html = storedHtml ? storedHtml.content : await this.fetchWithTimeout(`${config.proxyUrl}${encodeURIComponent(config.targetUrl)}`);

            if (!html) {
                this.showErrorMessage('No content fetched. Please try again later.');
                return;
            }

            if (!storedHtml) {
                await this.db.putHtmlContent(1, html);
            }
            this.extractImagesAndPdfLinks(html);
            if (this.state.images.length > 0) {
                await this.loadImages();
                this.setupIntersectionObserver();
            } else {
                this.showErrorMessage('No images found. Please check the source.');
            }
        } catch (err) {
            console.error('Error during fetching or parsing:', err);
            this.showErrorMessage('Failed to fetch books. Please try again later.');
        } finally {
            this.state.isLoading = false;
            this.toggleLoadingSpinner(false);
        }
    }

    async fetchWithTimeout(url, options = {}, timeout = config.fetchTimeout) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeoutId);
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
            return await response.text();
        } catch (error) {
            clearTimeout(timeoutId);
            console.error('Fetch error:', error);
            this.showErrorMessage('Network error. Please check your connection and try again.');
            throw new Error(`Fetch failed: ${error.message}`);
        }
    }

    extractImagesAndPdfLinks(html) {
        if (!html) {
            this.showErrorMessage('Failed to parse HTML content.');
            return;
        }

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const newImages = Array.from(doc.querySelectorAll('img[loading="lazy"][decoding="async"].alignnone'));
        const pdfLinks = doc.querySelectorAll('a[href]');

        pdfLinks.forEach(link => {
            if (!link.href || typeof link.href !== 'string') return;

            const pdfUrl = link.href.trim();
            const textSpan = link.querySelector('span[style="color: #ff6600;"]');
            const text = textSpan ? textSpan.textContent?.trim() : link.textContent?.trim();

            if (pdfUrl && text) {
                this.state.pdfUrlToTextMap.set(pdfUrl, (this.state.pdfUrlToTextMap.get(pdfUrl) || []).concat(text));
            }
        });

        this.state.images = newImages.filter(img => img.src && !this.state.loadedImages.has(img.src));
        newImages.forEach(img => this.state.loadedImages.add(img.src));
    }

    async loadImages() {
        const start = this.state.currentBatch * config.batchSize;
        const end = Math.min(start + config.batchSize, this.state.images.length);
        const batch = this.state.images.slice(start, end);
        const fragment = document.createDocumentFragment();

        if (batch.length === 0) {
            this.showErrorMessage('No more images to load.');
            return;
        }

        await Promise.all(batch.map(img => this.createGridItem(img).then(gridItem => {
            if (gridItem) fragment.appendChild(gridItem);
        })));
        this.elements.bookGrid?.appendChild(fragment);
        this.state.currentBatch++;
    }

    async createGridItem(img, retryCount = 0) {
        if (!img || !img.src) {
            console.error('Invalid image element:', img);
            return null;
        }

        const gridItem = this.createElement('div', { class: 'grid-item', 'data-aos': 'fade-up' });
        const imgElement = new Image();
        imgElement.src = img.src;
        imgElement.className = 'lazyload';
        imgElement.alt = 'Book Cover';

        return new Promise((resolve) => {
            imgElement.onload = () => {
                imgElement.style.display = 'block';
                resolve(gridItem);
            };
            imgElement.onerror = async () => {
                if (retryCount < config.maxRetries) {
                    setTimeout(() => this.createGridItem(img, retryCount + 1).then(resolve), config.retryDelay);
                } else {
                    console.error(`Failed to load image after ${config.maxRetries} retries:`, img.src);
                    imgElement.src = config.fallbackImage;
                    imgElement.onload = () => resolve(gridItem);
                    imgElement.onerror = () => {
                        this.showErrorMessage(`Failed to load image: ${img.src}`);
                        resolve(null);
                    };
                }
            };
            gridItem.appendChild(imgElement);

            const aElement = img.closest('a');
            if (aElement?.href) {
                imgElement.addEventListener('click', (e) => {
                    e.preventDefault();
                    if (this.isValidUrl(aElement.href)) {
                        window.open(aElement.href, '_blank', 'noopener,noreferrer');
                    } else {
                        this.showErrorMessage('Invalid link detected.');
                    }
                });
                const texts = this.state.pdfUrlToTextMap.get(aElement.href);
                if (texts?.length) {
                    const textElement = this.createElement('p', { class: 'textElement' }, texts.join(', '));
                    gridItem.appendChild(textElement);
                }
            }
        });
    }

    isValidUrl(url) {
        if (typeof url !== 'string') return false;
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }

    setupIntersectionObserver() {
        if (!this.elements.bookGrid) return;

        const observer = new IntersectionObserver((entries) => {
            const isVisible = entries.some(entry => entry.isIntersecting);
            if (isVisible && this.state.currentBatch * config.batchSize < this.state.images.length && !this.state.isLoading) {
                this.loadImages();
            }
        }, { rootMargin: config.intersectionObserverRootMargin, threshold: config.intersectionObserverThreshold });

        const observeLastGridItem = () => {
            const lastGridItem = this.elements.bookGrid.lastElementChild;
            if (lastGridItem) {
                observer.observe(lastGridItem);
            } else {
                observer.disconnect();
            }
        };

        observeLastGridItem();
    }

    createElement(type, attributes = {}, ...children) {
        const element = document.createElement(type);
        Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
        children.forEach(child => {
            if (typeof child === 'string') {
                element.textContent = child;
            } else if (child instanceof Node) {
                element.appendChild(child);
            }
        });
        return element;
    }

    toggleLoadingSpinner(isVisible) {
        if (this.elements.loadingSpinner) {
            this.elements.loadingSpinner.classList.toggle('active', isVisible);
        }
    }

    showErrorMessage(message) {
        if (this.elements.errorMessage) {
            this.elements.errorMessage.textContent = message;
            this.elements.errorMessage.classList.add('active');
            setTimeout(() => this.elements.errorMessage.classList.remove('active'), config.errorMessageDisplayTime);
        }
    }

    redirectSearchResults(query) {
        const sanitizedQuery = this.sanitizeInput(query);
        if (!sanitizedQuery) {
            this.showErrorMessage('Invalid search query.');
            return;
        }
        const searchUrl = `search-results.html?query=${encodeURIComponent(sanitizedQuery)}`;
        window.open(searchUrl, '_blank', 'noopener,noreferrer');
    }

    sanitizeInput(input) {
        if (typeof input !== 'string') return '';
        const tempDiv = document.createElement('div');
        tempDiv.textContent = input;
        return tempDiv.innerHTML;
    }

    debounce(func, wait) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    performSearch = this.debounce((event) => {
        event.preventDefault();
        const query = this.elements.searchInput?.value.trim();
        if (!query || query.length < 3) {
            this.showErrorMessage('Search term must be at least 3 characters long.');
            return;
        }
        if (query.length > 100) {
            this.showErrorMessage('Search term must be less than 100 characters.');
            return;
        }
        this.redirectSearchResults(query);
    }, config.searchDebounceTime);

    togglePanel(panel) {
        if (panel) {
            panel.classList.toggle('active');
            this.state.isPanelOpen = panel.classList.contains('active');
        }
    }

    handleDocumentClick(event) {
        if (!event.target.closest('.panel') && !event.target.closest('.menu-btn')) {
            [this.elements.menuPanel, this.elements.libraryPanel, this.elements.settingsPanel].forEach(panel => panel?.classList.remove('active'));
            this.state.isPanelOpen = false;
        }
    }

    handleThemeToggle() {
        document.body.classList.toggle('dark-theme');
        localStorage.setItem('darkTheme', document.body.classList.contains('dark-theme'));
    }

    handleSearchKeydown(event) {
        if (event.key === 'Enter') {
            this.performSearch(event);
        }
    }

    handleLibraryLink() {
        this.elements.menuPanel?.classList.remove('active');
        this.togglePanel(this.elements.libraryPanel);
    }

    handleSettingsLink() {
        this.elements.menuPanel?.classList.remove('active');
        this.togglePanel(this.elements.settingsPanel);
    }

    async handleBeforeUnload() {
        try {
            await this.db.clearHtmlContent();
        } catch (error) {
            console.error('Error clearing database on unload:', error);
        }
    }
}

class Database {
    constructor() {
        this.db = new Dexie("NovelDatabase");
        this.db.version(1).stores({
            htmlContent: "++id, content"
        });
    }

    async getHtmlContent(id) {
        try {
            return await this.db.htmlContent.get(id) || null;
        } catch (error) {
            console.error('Database read error:', error);
            return null;
        }
    }

    async putHtmlContent(id, content) {
        try {
            await this.db.htmlContent.put({ id, content });
        } catch (error) {
            console.error('Database write error:', error);
        }
    }

    async clearHtmlContent() {
        try {
            await this.db.htmlContent.clear();
        } catch (error) {
            console.error('Database clear error:', error);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const novelWebsite = new NovelWebsite();
    novelWebsite.init();
});
