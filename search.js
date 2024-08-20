document.addEventListener('DOMContentLoaded', () => {
    const config = {
        proxyUrl: 'https://api.allorigins.win/raw?url=',
        searchDebounceTime: 300,
        maxRetries: 3,
        retryDelay: 1000,
        errorMessageDisplayTime: 5000,
        fetchTimeout: 10000
    };

    const elements = {
        resultsGrid: document.getElementById('results-grid'),
        searchInput: document.getElementById('search-input'),
        searchButton: document.getElementById('search-button'),
        loadingSpinner: document.getElementById('loading-spinner'),
        errorMessage: document.getElementById('error-message')
    };
    
    const state = {
        searchInProgress: false
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

    const showLoadingSpinner = () => elements.loadingSpinner?.classList.add('active');
    const hideLoadingSpinner = () => elements.loadingSpinner?.classList.remove('active');

    const showErrorMessage = (message) => {
        if (elements.errorMessage) {
            elements.errorMessage.textContent = message;
            elements.errorMessage.classList.add('active');
            setTimeout(() => elements.errorMessage.classList.remove('active'), config.errorMessageDisplayTime);
        }
    };

    const getQueryParam = (name) => {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get(name);
    };

    const fetchAndDisplayResults = async (query, retryCount = 0) => {
        if (!query.trim()) {
            showErrorMessage('Please enter a valid search query.');
            return;
        }
        if (state.searchInProgress) return;
        state.searchInProgress = true;
        const searchUrl = `https://jnovels.com/?s=${encodeURIComponent(query)}`;
        const searchProxyUrl = `${config.proxyUrl}${encodeURIComponent(searchUrl)}`;
        elements.resultsGrid.innerHTML = '';
        showLoadingSpinner();
        try {
            const html = await fetchWithTimeout(searchProxyUrl);
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const items = doc.querySelectorAll('a[rel="bookmark"]');
            if (items.length === 0) {
                elements.resultsGrid.innerHTML = '<p>No results found.</p>';
            } else {
                const fragment = document.createDocumentFragment();
                items.forEach(item => {
                    const gridItem = createSearchResultItem(item);
                    if (gridItem) {
                        fragment.appendChild(gridItem);
                    }
                });
                elements.resultsGrid?.appendChild(fragment);
            }
        } catch (error) {
            console.error('Error during fetching or parsing:', error);
            if (retryCount < config.maxRetries) {
                console.log(`Retrying fetch (${retryCount + 1}/${config.maxRetries})...`);
                setTimeout(() => fetchAndDisplayResults(query, retryCount + 1), config.retryDelay);
            } else {
                showErrorMessage('There was an error fetching the results. Please try again later.');
            }
        } finally {
            hideLoadingSpinner();
            state.searchInProgress = false;
        }
    };

    const createSearchResultItem = (item, retryCount = 0) => {
        const img = item.querySelector('img');
        const title = item.getAttribute('title');
        const href = item.getAttribute('href');
        if (img && title && href) {
            const div = createElement('div', { class: 'grid-item' });
            const a = createElement('a', { href, target: '_blank', class: 'grid-item-link' });
            const imgElement = createElement('img', { src: img.src, alt: title });
            imgElement.onload = () => imgElement.style.display = 'block';
            imgElement.onerror = async () => {
                if (retryCount < config.maxRetries) {
                    setTimeout(() => createSearchResultItem(item, retryCount + 1), config.retryDelay);
                } else {
                    console.error(`Failed to load image after ${config.maxRetries} retries:`, img.src);
                }
            };
            const titleElement = createElement('div', { class: 'textElement' }, title);
            a.append(imgElement, titleElement);
            div.appendChild(a);
            return div;
        }
        return null;
    };

    const performSearch = (event) => {
        event.preventDefault();
        const query = elements.searchInput?.value.trim();
        if (query) {
            fetchAndDisplayResults(query);
        }
    };

    const init = async () => {
        const query = getQueryParam('query');
        if (query) {
            elements.searchInput.value = query;
            await fetchAndDisplayResults(query);
        }

        elements.searchInput?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                performSearch(event);
            }
        });
        elements.searchButton?.addEventListener('click', performSearch);
    };

    init();
});