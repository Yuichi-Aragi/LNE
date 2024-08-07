document.addEventListener('DOMContentLoaded', async () => {
    const settings = {
        proxyEndpoint: 'https://api.allorigins.win/raw?url=',
        targetEndpoint: 'https://jnovels.com/top-light-novels-to-read/',
        itemsPerBatch: 20,
        maxRetryAttempts: 3,
        retryInterval: 1000,
        searchDebounceDuration: 300,
        observerThreshold: 0.1,
        observerRootMargin: '200px',
        errorMessageDuration: 5000,
        requestTimeout: 10000,
        maxCacheSize: 80 * 1024 * 1024, // 80 MB
        localStorageKeys: {
            darkTheme: 'darkTheme',
            gridSize: 'gridSize'
        }
    };

    const domElements = {
        bookGrid: document.getElementById('book-grid'),
        searchInput: document.getElementById('search-input'),
        searchButton: document.getElementById('search-button'),
        loadingIndicator: document.querySelector('.loading-spinner'),
        menuButton: document.querySelector('.menu-btn'),
        menuPanel: document.getElementById('menu-panel'),
        libraryPanel: document.getElementById('library-panel'),
        settingsPanel: document.getElementById('settings-panel'),
        themeSwitcher: document.getElementById('theme-toggle'),
        errorDisplay: document.getElementById('error-message'),
        gridViewSizeSlider: document.getElementById('grid-view-size')
    };

    const appState = {
        currentBatchIndex: 0,
        imageList: [],
        loadedImageSet: new Set(),
        dataLoading: false,
        panelActive: false,
        pdfTextMap: new Map(),
        searchOngoing: false,
        observerInstance: null
    };

    let db;

    const initIndexedDB = async () => {
        try {
            db = await new Promise((resolve, reject) => {
                const request = indexedDB.open('CacheDB', 1);
                request.onerror = () => reject(new Error('Error opening IndexedDB'));
                request.onsuccess = () => resolve(request.result);
                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    db.createObjectStore('cachedData', { keyPath: 'url' });
                };
            });
        } catch (error) {
            console.error('IndexedDB initialization failed:', error);
            displayErrorMessage('Failed to initialize cache. Some features may not work properly.');
        }
    };

    const addToCache = async (url, data) => {
        if (!db) return;
        const transaction = db.transaction('cachedData', 'readwrite');
        const store = transaction.objectStore('cachedData');
        await store.put({ url, data, timestamp: Date.now() });
        await manageCacheSize(store);
    };

    const manageCacheSize = async (store) => {
        const allData = await getAllCachedData();
        let totalSize = allData.reduce((sum, item) => sum + item.data.length, 0);

        if (totalSize > settings.maxCacheSize) {
            allData.sort((a, b) => a.timestamp - b.timestamp);
            while (totalSize > settings.maxCacheSize && allData.length) {
                const itemToRemove = allData.shift();
                await store.delete(itemToRemove.url);
                totalSize -= itemToRemove.data.length;
            }
        }
    };

    const getCachedData = async (url) => {
        if (!db) return null;
        const transaction = db.transaction('cachedData', 'readonly');
        const store = transaction.objectStore('cachedData');
        const request = store.get(url);
        return new Promise((resolve) => {
            request.onsuccess = () => resolve(request.result ? request.result.data : null);
            request.onerror = () => resolve(null);
        });
    };

    const getAllCachedData = () => {
        if (!db) return [];
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('cachedData', 'readonly');
            const store = transaction.objectStore('cachedData');
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(new Error('Error fetching all cached data'));
        });
    };

    const clearCacheOnRefresh = async () => {
        if (!db) return;
        const transaction = db.transaction('cachedData', 'readwrite');
        const store = transaction.objectStore('cachedData');
        await store.clear();
    };

    const fetchWithTimeout = async (url, options = {}, timeout = settings.requestTimeout) => {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch(url, { ...options, signal: controller.signal });
            if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
            const data = await response.text();
            await addToCache(url, data);
            return data;
        } finally {
            clearTimeout(id);
        }
    };

    const fetchAndDisplayImages = async (retryCount = 0) => {
        if (appState.dataLoading || appState.panelActive) return;
        appState.dataLoading = true;
        toggleLoadingIndicator(true);
        const url = `${settings.proxyEndpoint}${encodeURIComponent(settings.targetEndpoint)}`;
        try {
            let htmlContent = await getCachedData(url) || await fetchWithTimeout(url);
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlContent, 'text/html');
            extractImagesAndPdfLinks(doc);
            if (appState.imageList.length > 0) {
                await displayImages();
                initializeIntersectionObserver();
            }
        } catch (error) {
            await manageFetchError(error, retryCount);
        } finally {
            appState.dataLoading = false;
            toggleLoadingIndicator(false);
        }
    };

    const toggleLoadingIndicator = (show) => {
        domElements.loadingIndicator?.classList.toggle('active', show);
    };

    const displayErrorMessage = (message) => {
        if (domElements.errorDisplay) {
            domElements.errorDisplay.textContent = message;
            domElements.errorDisplay.classList.add('active');
            setTimeout(() => domElements.errorDisplay.classList.remove('active'), settings.errorMessageDuration);
        }
    };

    const extractImagesAndPdfLinks = (doc) => {
        const newImages = Array.from(doc.querySelectorAll('img[loading="lazy"][decoding="async"]'));
        const pdfLinks = Array.from(doc.querySelectorAll('a[href]')).filter(a => a.closest('h3'));

        pdfLinks.forEach(link => {
            const pdfUrl = link.href.trim();
            const textSpan = link.querySelector('span[style="color: #ff6600;"]');
            const text = textSpan ? textSpan.textContent.trim() : link.textContent.trim();

            if (pdfUrl && text) {
                appState.pdfTextMap.set(pdfUrl, (appState.pdfTextMap.get(pdfUrl) || []).concat(text));
            }
        });

        appState.imageList.push(...newImages.filter(img => !appState.loadedImageSet.has(img.src)));
        newImages.forEach(img => appState.loadedImageSet.add(img.src));
    };

    const displayImages = async () => {
        const startIndex = appState.currentBatchIndex * settings.itemsPerBatch;
        const endIndex = Math.min(startIndex + settings.itemsPerBatch, appState.imageList.length);
        const imageBatch = appState.imageList.slice(startIndex, endIndex);
        const fragment = document.createDocumentFragment();

        const gridItems = await Promise.all(imageBatch.map(img => createGridItem(img)));
        gridItems.forEach(item => fragment.appendChild(item));

        domElements.bookGrid.appendChild(fragment);
        appState.currentBatchIndex++;
    };

    const createGridItem = async (img) => {
        const gridItem = createElement('div', { class: 'grid-item', 'data-aos': 'fade-up' });
        const imgElement = new Image();
        imgElement.src = img.src;
        imgElement.className = 'lazyload';
        imgElement.alt = 'Book Cover';
        imgElement.onload = () => imgElement.style.display = 'block';
        gridItem.appendChild(imgElement);

        const anchorElement = img.closest('a');
        if (anchorElement?.href) {
            imgElement.addEventListener('click', () => window.open(anchorElement.href, '_blank'));
            const texts = appState.pdfTextMap.get(anchorElement.href);
            if (texts?.length) {
                const textElement = createElement('p', { class: 'textElement' }, texts.join(', '));
                gridItem.appendChild(textElement);
            }
        }
        return gridItem;
    };

    const initializeIntersectionObserver = () => {
        if (!domElements.bookGrid || appState.observerInstance) return;

        appState.observerInstance = new IntersectionObserver((entries) => {
            const lastEntry = entries[entries.length - 1];
            if (lastEntry.isIntersecting && !appState.panelActive && appState.currentBatchIndex * settings.itemsPerBatch < appState.imageList.length) {
                displayImages().then(() => {
                    const lastGridItem = domElements.bookGrid.lastElementChild;
                    if (lastGridItem) {
                        appState.observerInstance.unobserve(lastEntry.target);
                        appState.observerInstance.observe(lastGridItem);
                    }
                });
            }
        }, {
            root: null,
            rootMargin: settings.observerRootMargin,
            threshold: settings.observerThreshold
        });

        const lastGridItem = domElements.bookGrid.lastElementChild;
        if (lastGridItem) {
            appState.observerInstance.observe(lastGridItem);
        }
    };

    const manageFetchError = async (error, retryCount) => {
        console.error('Fetch or parsing error:', error);
        displayErrorMessage('Failed to load books. Please try again later.');
        if (retryCount < settings.maxRetryAttempts) {
            console.log(`Retrying fetch (${retryCount + 1}/${settings.maxRetryAttempts})...`);
            await new Promise(resolve => setTimeout(resolve, settings.retryInterval * (retryCount + 1)));
            return fetchAndDisplayImages(retryCount + 1);
        }
    };

    const fetchAndShowResults = async (query) => {
        if (!query.trim()) {
            displayErrorMessage('Please enter a valid search query.');
            return;
        }
        if (appState.searchOngoing) return;
        appState.searchOngoing = true;
        const searchUrl = `https://jnovels.com/?s=${encodeURIComponent(query)}`;
        const searchProxyUrl = `${settings.proxyEndpoint}${encodeURIComponent(searchUrl)}`;
        domElements.bookGrid.innerHTML = ''; // Clear previous results
        toggleLoadingIndicator(true);
        try {
            const htmlContent = await fetchWithTimeout(searchProxyUrl);
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlContent, 'text/html');
            const items = Array.from(doc.querySelectorAll('a[rel="bookmark"]'));
            const fragment = document.createDocumentFragment();

            if (items.length === 0) {
                domElements.bookGrid.innerHTML = 'No results found.';
            } else {
                items.forEach(item => {
                    const gridItem = createSearchResultItem(item);
                    if (gridItem) {
                        fragment.appendChild(gridItem);
                    }
                });
                domElements.bookGrid.appendChild(fragment);
            }
        } catch (error) {
            console.error('Fetch or parsing error:', error);
            displayErrorMessage('Error fetching results. Please try again later.');
        } finally {
            toggleLoadingIndicator(false);
            appState.searchOngoing = false;
        }
    };

    const createSearchResultItem = (item) => {
        const img = item.querySelector('img');
        const title = item.title;
        const href = item.href;
        if (img && title && href) {
            const div = createElement('div', { class: 'grid-item' });
            const a = createElement('a', { href, target: '_blank', class: 'grid-item-link' });
            const imgElement = createElement('img', { src: img.src, alt: title });
            imgElement.onload = () => imgElement.style.display = 'block';
            const titleElement = createElement('div', { class: 'textElement' }, title);
            a.append(imgElement, titleElement);
            div.appendChild(a);
            return div;
        }
        return null;
    };

    const performSearch = debounce((query) => {
        if (query.trim()) {
            fetchAndShowResults(query);
        }
    }, settings.searchDebounceDuration);

    const togglePanel = (panel) => {
        if (panel) {
            panel.classList.toggle('active');
            appState.panelActive = panel.classList.contains('active');
        }
    };

    // Event Listeners
    domElements.searchInput.addEventListener('input', (event) => performSearch(event.target.value));
    domElements.searchButton.addEventListener('click', () => performSearch(domElements.searchInput.value));
    domElements.menuButton.addEventListener('click', () => togglePanel(domElements.menuPanel));

    document.addEventListener('click', (event) => {
        const target = event.target.closest('a');
        if (target) {
            if (target.id === 'library-link') {
                domElements.menuPanel.classList.remove('active');
                togglePanel(domElements.libraryPanel);
            } else if (target.id === 'settings-link') {
                domElements.menuPanel.classList.remove('active');
                togglePanel(domElements.settingsPanel);
            }
        }

        // Close panels if clicking outside
        if (!event.target.closest('.panel') && !event.target.closest('.menu-btn')) {
            [domElements.menuPanel, domElements.libraryPanel, domElements.settingsPanel].forEach(panel => panel.classList.remove('active'));
            appState.panelActive = false;
        }
    });

    domElements.themeSwitcher.addEventListener('change', () => {
        document.body.classList.toggle('dark-theme');
        localStorage.setItem(settings.localStorageKeys.darkTheme, document.body.classList.contains('dark-theme'));
    });

    domElements.gridViewSizeSlider.addEventListener('input', (event) => {
        const size = event.target.value;
        document.body.classList.remove(...Array.from(document.body.classList).filter(cls => cls.startsWith('grid-size-')));
        document.body.classList.add(`grid-size-${size}`);
        localStorage.setItem(settings.localStorageKeys.gridSize, size);
    });

    const initializeApp = async () => {
        await initIndexedDB();
        await clearCacheOnRefresh();

        const savedTheme = localStorage.getItem(settings.localStorageKeys.darkTheme);
        if (savedTheme === 'true') {
            document.body.classList.add('dark-theme');
            domElements.themeSwitcher.checked = true;
        }

        const savedGridSize = localStorage.getItem(settings.localStorageKeys.gridSize);
        if (savedGridSize) {
            document.body.classList.add(`grid-size-${savedGridSize}`);
            domElements.gridViewSizeSlider.value = savedGridSize;
        }

        if (typeof AOS !== 'undefined') {
            AOS.init();
        }

        await fetchAndDisplayImages();
    };

    initializeApp();
});

// Utility functions
function createElement(tag, attributes = {}, textContent = '') {
    const element = document.createElement(tag);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    if (textContent) element.textContent = textContent;
    return element;
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}