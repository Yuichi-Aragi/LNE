'use strict';

const config = {
    proxyUrl: 'https://api.allorigins.win/raw?url=',
    targetUrl: 'https://jnovels.com/top-light-novels-to-read/',
    batchSize: 40,
    maxRetries: 3,
    retryDelay: 1000,
    searchDebounceTime: 300,
    intersectionObserverThreshold: 0.1,
    intersectionObserverRootMargin: '250px',
    errorMessageDisplayTime: 5000,
    fetchTimeout: 10000
};

const state = {
    currentBatch: 0,
    images: [],
    loadedImages: new Set(),
    isLoading: false,
    isPanelOpen: false,
    pdfUrlToTextMap: new Map(),
};

class NovelWebsite {
    constructor() {
        this.db = new Dexie("NovelDatabase");
        this.db.version(1).stores({
            htmlContent: "++id, content"
        });
        this.elements = this.getElements();
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
        if (state.isLoading || state.isPanelOpen) return;
        state.isLoading = true;
        this.toggleLoadingSpinner(true);

        try {
            const storedHtml = await this.db.htmlContent.get(1);
            const html = storedHtml ? storedHtml.content : await this.fetchWithTimeout(`${config.proxyUrl}${encodeURIComponent(config.targetUrl)}`);
            
            if (!storedHtml) {
                await this.db.htmlContent.put({ id: 1, content: html });
            }
            this.extractImagesAndPdfLinks(html);
            if (state.images.length > 0) {
                await this.loadImages();
                this.setupIntersectionObserver();
            }
        } catch (err) {
            console.error('Error during fetching or parsing:', err);
            this.showErrorMessage('Failed to fetch books. Please try again later.');
        } finally {
            state.isLoading = false;
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
            throw new Error(`Fetch failed: ${error.message}`);
        }
    }

    extractImagesAndPdfLinks(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const newImages = Array.from(doc.querySelectorAll('img[loading="lazy"][decoding="async"].alignnone'));
        const pdfLinks = doc.querySelectorAll('a[href]');

        pdfLinks.forEach(link => {
            const pdfUrl = link.href.trim();
            const textSpan = link.querySelector('span[style="color: #ff6600;"]');
            const text = textSpan ? textSpan.textContent.trim() : link.textContent.trim();

            if (pdfUrl && text) {
                state.pdfUrlToTextMap.set(pdfUrl, (state.pdfUrlToTextMap.get(pdfUrl) || []).concat(text));
            }
        });

        state.images = newImages.filter(img => !state.loadedImages.has(img.src));
        newImages.forEach(img => state.loadedImages.add(img.src));
    }

    async loadImages() {
        const start = state.currentBatch * config.batchSize;
        const end = Math.min(start + config.batchSize, state.images.length);
        const batch = state.images.slice(start, end);
        const fragment = document.createDocumentFragment();

        await Promise.all(batch.map(img => this.createGridItem(img).then(gridItem => fragment.appendChild(gridItem))));
        this.elements.bookGrid?.appendChild(fragment);
        state.currentBatch++;
    }

    async createGridItem(img, retryCount = 0) {
        const gridItem = this.createElement('div', { class: 'grid-item', 'data-aos': 'fade-up' });
        const imgElement = new Image();
        imgElement.src = img.src;
        imgElement.className = 'lazyload';
        imgElement.alt = 'Book Cover';

        return new Promise((resolve, reject) => {
            imgElement.onload = () => {
                imgElement.style.display = 'block';
                resolve(gridItem);
            };
            imgElement.onerror = async () => {
                if (retryCount < config.maxRetries) {
                    setTimeout(() => this.createGridItem(img, retryCount + 1).then(resolve, reject), config.retryDelay);
                } else {
                    console.error(`Failed to load image after ${config.maxRetries} retries:`, img.src);
                    reject(new Error(`Failed to load image: ${img.src}`));
                }
            };
            gridItem.appendChild(imgElement);

            const aElement = img.closest('a');
            if (aElement?.href) {
                imgElement.addEventListener('click', () => window.open(aElement.href, '_blank'));
                const texts = state.pdfUrlToTextMap.get(aElement.href);
                if (texts?.length) {
                    const textElement = this.createElement('p', { class: 'textElement' }, texts.join(', '));
                    gridItem.appendChild(textElement);
                }
            }
        });
    }

    setupIntersectionObserver() {
        if (!this.elements.bookGrid) return;
        const observer = new IntersectionObserver((entries) => {
            if (!state.isPanelOpen && entries.some(entry => entry.isIntersecting) && state.currentBatch * config.batchSize < state.images.length) {
                this.loadImages();
            }
        }, { rootMargin: config.intersectionObserverRootMargin, threshold: config.intersectionObserverThreshold });

        const lastGridItem = this.elements.bookGrid.lastElementChild;
        if (lastGridItem) {
            observer.observe(lastGridItem);
        }
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
        this.elements.loadingSpinner?.classList.toggle('active', isVisible);
    }

    showErrorMessage(message) {
        if (this.elements.errorMessage) {
            this.elements.errorMessage.textContent = message;
            this.elements.errorMessage.classList.add('active');
            setTimeout(() => this.elements.errorMessage.classList.remove('active'), config.errorMessageDisplayTime);
        }
    }

    redirectSearchResults(query) {
        const searchUrl = `search-results.html?query=${encodeURIComponent(query)}`;
        window.open(searchUrl, '_blank');
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
        if (query) {
            this.redirectSearchResults(query);
        }
    }, config.searchDebounceTime);

    togglePanel(panel) {
        if (panel) {
            panel.classList.toggle('active');
            state.isPanelOpen = panel.classList.contains('active');
        }
    }

    handleDocumentClick(event) {
        if (!event.target.closest('.panel') && !event.target.closest('.menu-btn')) {
            [this.elements.menuPanel, this.elements.libraryPanel, this.elements.settingsPanel].forEach(panel => panel?.classList.remove('active'));
            state.isPanelOpen = false;
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
        await this.db.htmlContent.clear();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const novelWebsite = new NovelWebsite();
    novelWebsite.init();
});