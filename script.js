document.addEventListener('DOMContentLoaded', () => {
    const config = {
        proxyUrl: 'https://api.allorigins.win/raw?url=',
        targetUrl: 'https://jnovels.com/top-light-novels-to-read/',
        batchSize: 60,
        maxRetries: 3,
        retryDelay: 1000,
        searchDebounceTime: 300,
        intersectionObserverThreshold: 0.1,
        intersectionObserverRootMargin: '200px',
        errorMessageDisplayTime: 5000,
        fetchTimeout: 10000,
    };

    const elements = {
        bookGrid: document.getElementById('book-grid'),
        searchInput: document.getElementById('search-input'),
        searchButton: document.getElementById('search-button'),
        loadingSpinner: document.getElementById('loading-spinner'),
        menuBtn: document.querySelector('.menu-btn'),
        menuPanel: document.getElementById('menu-panel'),
        libraryPanel: document.getElementById('library-panel'),
        settingsPanel: document.getElementById('settings-panel'),
        themeToggle: document.getElementById('theme-toggle'),
        errorMessage: document.getElementById('error-message'),
    };

    const state = {
        currentBatch: 0,
        images: [],
        loadedImages: new Set(),
        isLoading: false,
        isPanelOpen: false,
        pdfUrlToTextMap: new Map(),
    };

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
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
            return await response.text();
        } catch (error) {
            throw new Error(`Fetch failed: ${error.message}`);
        } finally {
            clearTimeout(id);
        }
    };

    const toggleLoadingSpinner = (isLoading) => {
        if (elements.loadingSpinner) {
            elements.loadingSpinner.classList.toggle('active', isLoading);
            elements.loadingSpinner.setAttribute('aria-hidden', !isLoading);
        }
    };

    const showErrorMessage = (message) => {
        if (elements.errorMessage) {
            elements.errorMessage.textContent = message;
            elements.errorMessage.classList.add('active');
            elements.errorMessage.setAttribute('aria-hidden', 'false');
            setTimeout(() => {
                elements.errorMessage.classList.remove('active');
                elements.errorMessage.setAttribute('aria-hidden', 'true');
            }, config.errorMessageDisplayTime);
        }
    };

    const fetchAndLoadImages = async () => {
        if (state.isLoading || state.isPanelOpen) return;
        state.isLoading = true;
        toggleLoadingSpinner(true);
        try {
            const html = await fetchWithTimeout(`${config.proxyUrl}${encodeURIComponent(config.targetUrl)}`);
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
            toggleLoadingSpinner(false);
        }
    };

    const extractImagesAndPdfLinks = (doc) => {
        const newImages = Array.from(doc.querySelectorAll('img[loading="lazy"][decoding="async"].alignnone'));
        const pdfLinks = doc.querySelectorAll('h3 > a');

        const mapUpdates = new Map();
        pdfLinks.forEach(link => {
            const pdfUrl = link.href.trim();
            const textSpan = link.querySelector('span[style="color: #ff6600;"]');
            const text = textSpan ? textSpan.textContent.trim() : link.textContent.trim();

            if (pdfUrl && text) {
                if (!mapUpdates.has(pdfUrl)) {
                    mapUpdates.set(pdfUrl, new Set());
                }
                mapUpdates.get(pdfUrl).add(text);
            }
        });

        mapUpdates.forEach((texts, pdfUrl) => {
            const currentTexts = state.pdfUrlToTextMap.get(pdfUrl) || new Set();
            texts.forEach(text => currentTexts.add(text));
            state.pdfUrlToTextMap.set(pdfUrl, Array.from(currentTexts));
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
        elements.bookGrid.appendChild(fragment);
        state.currentBatch++;
    };

    const createGridItem = async (img, retryCount = 0) => {
        const gridItem = createElement('div', { class: 'grid-item', 'data-aos': 'fade-up' });
        const imgElement = createElement('img', { class: 'lazyload', alt: 'Book Cover', 'data-src': img.src });

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
                const textElement = createElement('p', { class: 'textElement', 'data-src': texts.join(', ') });
                gridItem.appendChild(textElement);

                const linkElement = createElement('a', { 'data-pdf-url': aElement.href, href: '#', class: 'hidden-link' });
                gridItem.appendChild(linkElement);
            }
        }
        return gridItem;
    };

    const setupIntersectionObserver = () => {
        if (!elements.bookGrid) return;
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const imgElement = entry.target.querySelector('img.lazyload');
                    if (imgElement) {
                        imgElement.src = imgElement.dataset.src; // Set the src attribute to start loading the image
                    }

                    const textElement = entry.target.querySelector('.textElement[data-src]');
                    if (textElement) {
                        textElement.textContent = textElement.dataset.src; // Set the text content to load the PDF text
                    }

                    const linkElement = entry.target.querySelector('a[data-pdf-url]');
                    if (linkElement) {
                        linkElement.href = linkElement.dataset.pdfUrl; // Set the href attribute to load the PDF URL
                    }

                    observer.unobserve(entry.target); // Stop observing after loading
                }
            });
        }, { rootMargin: config.intersectionObserverRootMargin, threshold: config.intersectionObserverThreshold });

        const gridItems = elements.bookGrid.querySelectorAll('.grid-item');
        gridItems.forEach(item => observer.observe(item));
    };

    const redirectSearchResults = (query) => {
        const searchUrl = `search-results.html?query=${encodeURIComponent(query)}`;
        window.open(searchUrl, '_blank');
    };

    const performSearch = (event) => {
        event.preventDefault();
        const query = elements.searchInput.value.trim();
        if (query) {
            redirectSearchResults(query);
        }
    };

    const debounce = (func, wait) => {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    };

    const handleSearchInput = debounce((event) => {
        if (event.key === 'Enter') {
            performSearch(event);
        }
    }, config.searchDebounceTime);

    elements.searchInput.addEventListener('keydown', handleSearchInput);
    elements.searchButton.addEventListener('click', performSearch);
    elements.menuBtn.addEventListener('click', () => togglePanel(elements.menuPanel));

    document.getElementById('library-link')?.addEventListener('click', () => {
        elements.menuPanel.classList.remove('active');
        togglePanel(elements.libraryPanel);
    });

    document.getElementById('settings-link')?.addEventListener('click', () => {
        elements.menuPanel.classList.remove('active');
        togglePanel(elements.settingsPanel);
    });

    document.addEventListener('click', (event) => {
        if (!event.target.closest('.panel') && !event.target.closest('.menu-btn')) {
            [elements.menuPanel, elements.libraryPanel, elements.settingsPanel].forEach(panel => panel.classList.remove('active'));
            state.isPanelOpen = false;
        }
    });

    elements.themeToggle?.addEventListener('change', () => {
        document.body.classList.toggle('dark-theme');
        localStorage.setItem('darkTheme', document.body.classList.contains('dark-theme'));
    });

    const togglePanel = (panel) => {
        if (panel) {
            panel.classList.toggle('active');
            panel.setAttribute('aria-hidden', !panel.classList.contains('active'));
            state.isPanelOpen = panel.classList.contains('active');
        }
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

    init();
});
