document.addEventListener('DOMContentLoaded', () => {
    const config = {
        proxyUrl: 'https://api.allorigins.win/raw?url=',
        targetUrl: 'https://jnovels.com/top-light-novels-to-read/',
        batchSize: 40,
        maxRetries: 3,
        retryDelay: 1000,
        searchDebounceTime: 300,
        intersectionObserverThreshold: 0.1,
        intersectionObserverRootMargin: '200px',
        errorMessageDisplayTime: 5000,
        fetchTimeout: 10000
    };

    const elements = {
        bookGrid: document.getElementById('book-grid'),
        searchInput: document.getElementById('search-input'),
        searchButton: document.getElementById('search-button'),
        loadingSpinner: document.querySelector('.loading-spinner'),
        menuBtn: document.querySelector('.menu-btn'),
        menuPanel: document.getElementById('menu-panel'),
        libraryPanel: document.getElementById('library-panel'),
        settingsPanel: document.getElementById('settings-panel'),
        themeToggle: document.getElementById('theme-toggle'),
        errorMessage: document.getElementById('error-message')
    };

    const state = {
        currentBatch: 0,
        images: [],
        loadedImages: new Set(),
        isLoading: false,
        isPanelOpen: false,
        pdfUrlToTextMap: new Map(),
    };

    const db = new Dexie("NovelDatabase");
    db.version(1).stores({
        htmlContent: "++id, content"
    });

    const createElement = (type, attributes = {}, ...children) => {
        const element = document.createElement(type);
        Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
        children.forEach(child => typeof child === 'string' ? element.textContent = child : element.appendChild(child));
        return element;
    };

    const fetchWithTimeout = async (url, options = {}, timeout = config.fetchTimeout) => {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(id);
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
            return await response.text();
        } catch (error) {
            clearTimeout(id);
            throw new Error(`Fetch failed: ${error.message}`);
        }
    };

    const showLoadingSpinner = () => elements.loadingSpinner?.classList.add('active');
    const hideLoadingSpinner = () => elements.loadingSpinner?.classList.remove('active');

    const showErrorMessage = (message) => {
        if (elements.errorMessage) {
            elements.errorMessage.textContent = message;
            elements.errorMessage.classList.add('active');
            setTimeout(() => elements.errorMessage?.classList.remove('active'), config.errorMessageDisplayTime);
        }
    };

    const fetchAndLoadImages = async () => {
        if (state.isLoading || state.isPanelOpen) return;
        state.isLoading = true;
        showLoadingSpinner();
        try {
            const storedHtml = await db.htmlContent.get(1);
            let html;
            if (storedHtml) {
                html = storedHtml.content;
            } else {
                html = await fetchWithTimeout(`${config.proxyUrl}${encodeURIComponent(config.targetUrl)}`);
                await db.htmlContent.put({ id: 1, content: html });
            }
            const doc = new DOMParser().parseFromString(html, 'text/html');
            extractImagesAndPdfLinks(doc);
            if (state.images.length > 0) {
                await loadImages();
                setupIntersectionObserver();
            }
        } catch (err) {
            console.error('Error during fetching or parsing:', err);
            showErrorMessage('Failed to fetch books. Please try again later.');
        } finally {
            state.isLoading = false;
            hideLoadingSpinner();
        }
    };

    const extractImagesAndPdfLinks = (doc) => {
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
    };

    const loadImages = async () => {
        const start = state.currentBatch * config.batchSize;
        const end = Math.min(start + config.batchSize, state.images.length);
        const batch = state.images.slice(start, end);
        const fragment = document.createDocumentFragment();
        await Promise.all(batch.map(img => createGridItem(img).then(gridItem => fragment.appendChild(gridItem))));
        elements.bookGrid?.appendChild(fragment);
        state.currentBatch++;
    };

    const createGridItem = async (img, retryCount = 0) => {
        const gridItem = createElement('div', { class: 'grid-item', 'data-aos': 'fade-up' });
        const imgElement = new Image();
        imgElement.src = img.src;
        imgElement.className = 'lazyload';
        imgElement.alt = 'Book Cover';
        imgElement.onload = () => imgElement.style.display = 'block';
        imgElement.onerror = async () => {
            if (retryCount < config.maxRetries) {
                setTimeout(() => createGridItem(img, retryCount + 1), config.retryDelay);
            } else {
                console.error(`Failed to load image after ${config.maxRetries} retries:`, img.src);
            }
        };
        gridItem.appendChild(imgElement);

        const aElement = img.closest('a');
        if (aElement?.href) {
            imgElement.addEventListener('click', () => window.open(aElement.href, '_blank'));
            const texts = state.pdfUrlToTextMap.get(aElement.href);
            if (texts?.length) {
                const textElement = createElement('p', { class: 'textElement' }, texts.join(', '));
                gridItem.appendChild(textElement);
            }
        }
        return gridItem;
    };

    const setupIntersectionObserver = () => {
        if (!elements.bookGrid) return;
        const observer = new IntersectionObserver((entries) => {
            if (!state.isPanelOpen && entries.some(entry => entry.isIntersecting) && state.currentBatch * config.batchSize < state.images.length) {
                loadImages();
            }
        }, { rootMargin: config.intersectionObserverRootMargin, threshold: config.intersectionObserverThreshold });

        const lastGridItem = elements.bookGrid.lastElementChild;
        if (lastGridItem) {
            observer.observe(lastGridItem);
        }
    };

    const redirectSearchResults = (query) => {
        const searchUrl = `search-results.html?query=${encodeURIComponent(query)}`;
        window.open(searchUrl, '_blank');
    };

    const debounce = (func, wait) => {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    };

    const performSearch = debounce((event) => {
        event.preventDefault();
        const query = elements.searchInput?.value.trim();
        if (query) {
            redirectSearchResults(query);
        }
    }, config.searchDebounceTime);

    const togglePanel = (panel) => {
        if (panel) {
            panel.classList.toggle('active');
            state.isPanelOpen = panel.classList.contains('active');
        }
    };

    const handleDocumentClick = (event) => {
        if (!event.target.closest('.panel') && !event.target.closest('.menu-btn')) {
            [elements.menuPanel, elements.libraryPanel, elements.settingsPanel].forEach(panel => panel?.classList.remove('active'));
            state.isPanelOpen = false;
        }
    };

    const handleThemeToggle = () => {
        document.body.classList.toggle('dark-theme');
        localStorage.setItem('darkTheme', document.body.classList.contains('dark-theme'));
    };

    const init = async () => {
        const savedTheme = localStorage.getItem('darkTheme');
        if (savedTheme === 'true') {
            document.body.classList.add('dark-theme');
            if (elements.themeToggle) {
                elements.themeToggle.checked = true;
            }
        }

        if (typeof AOS !== 'undefined') {
            AOS.init();
        }

        await fetchAndLoadImages();
    };

    elements.searchInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            performSearch(event);
        }
    });
    elements.searchButton?.addEventListener('click', performSearch);
    elements.menuBtn?.addEventListener('click', () => togglePanel(elements.menuPanel));

    document.getElementById('library-link')?.addEventListener('click', () => {
        elements.menuPanel?.classList.remove('active');
        togglePanel(elements.libraryPanel);
    });

    document.getElementById('settings-link')?.addEventListener('click', () => {
        elements.menuPanel?.classList.remove('active');
        togglePanel(elements.settingsPanel);
    });

    document.addEventListener('click', handleDocumentClick);
    elements.themeToggle?.addEventListener('change', handleThemeToggle);

    window.addEventListener('beforeunload', async () => {
        await db.htmlContent.clear();
    });

    init();
});
