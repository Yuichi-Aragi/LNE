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
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('CacheDB', 1);
      request.onerror = () => reject(new Error('Error opening IndexedDB'));
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        db.createObjectStore('cachedData', { keyPath: 'url' });
      };
    }).then(result => db = result)
      .catch(error => handleError(error, 'Failed to initialize cache. Some features may not work properly.'));
  };

  const addToCache = async (url, data) => {
    if (!db) return;
    const transaction = db.transaction('cachedData', 'readwrite');
    const store = transaction.objectStore('cachedData');
    store.put({ url, data, timestamp: Date.now() });
    await transaction.complete;
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
  } catch (error) {
    handleError(error, 'Failed to fetch data.');
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
    let htmlContent = await getCachedData(url);
    if (!htmlContent) {
      htmlContent = await fetchWithTimeout(url);
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlContent, 'text/html');
      await addToCache(settings.targetEndpoint, doc.documentElement.outerHTML);
    }
    const cachedHtml = await getCachedData(settings.targetEndpoint);
    const parser = new DOMParser();
    const doc = parser.parseFromString(cachedHtml, 'text/html');
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

const handleError = (error, userMessage) => {
  console.error('Error:', error);
  displayErrorMessage(`${userMessage} Details: ${error.message}`);
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

    let retries = 0;
    const maxRetries = 2;

    const loadImage = () => new Promise((resolve, reject) => {
      imgElement.onload = resolve;
      imgElement.onerror = reject;
    });

    const attemptLoad = async () => {
      try {
        await loadImage();
        imgElement.style.display = 'block';
      } catch {
        if (retries < maxRetries) {
          retries += 1;
          imgElement.src = img.src;
          await attemptLoad();
        } else {
          const errorMessage = createElement('div', { class: 'image-error' }, 'Image not available');
          errorMessage.style.display = 'block';
          gridItem.appendChild(errorMessage);
        }
      }
    };

    await attemptLoad();

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

// Initialize Intersection Observer for lazy loading
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
  }, { root: null, rootMargin: settings.observerRootMargin, threshold: settings.observerThreshold });
  const lastGridItem = domElements.bookGrid.lastElementChild;
  if (lastGridItem) {
    appState.observerInstance.observe(lastGridItem);
  }
};

// Manage fetch errors with retries
const manageFetchError = async (error, retryCount) => {
  handleError(error, 'Failed to load books. Please try again later.');
  if (retryCount < settings.maxRetryAttempts) {
    console.log(`Retrying fetch (${retryCount + 1}/${settings.maxRetryAttempts})...`);
    await new Promise(resolve => setTimeout(resolve, settings.retryInterval * (retryCount + 1)));
    return fetchAndDisplayImages(retryCount + 1);
  }
};

// Fetch and show search results
const fetchAndShowResults = async (query) => {
  const sanitizedQuery = sanitizeInput(query);
  if (!sanitizedQuery) {
    displayErrorMessage('Please enter a valid search query.');
    return;
  }
  if (appState.searchOngoing) return;
  appState.searchOngoing = true;
  const searchUrl = `https://jnovels.com/?s=${encodeURIComponent(sanitizedQuery)}`;
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
    handleError(error, 'Error fetching results. Please try again later.');
  } finally {
    toggleLoadingIndicator(false);
    appState.searchOngoing = false;
  }
};

// Create a search result item
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

// Perform search with debounce
const performSearch = debounce((query) => {
  if (query.trim()) {
    fetchAndShowResults(query);
  }
}, settings.searchDebounceDuration);

// Toggle panel visibility
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
}, { passive: true });

// Check for fresh PDF, image, and text links
const checkFreshness = async () => {
  // Check PDF links
  for (const [pdfUrl, texts] of appState.pdfTextMap.entries()) {
    try {
      const response = await fetch(pdfUrl, { method: 'HEAD' });
      if (!response.ok) {
        appState.pdfTextMap.delete(pdfUrl); // Remove stale links
        console.log(`Removed stale PDF link: ${pdfUrl}`);
      }
    } catch (error) {
      console.error('Error checking PDF link:', error);
    }
  }

  // Check image and text elements
  for (const img of appState.imageList) {
    try {
      const response = await fetch(img.src, { method: 'HEAD' });
      if (!response.ok) {
        appState.imageList = appState.imageList.filter(image => image.src !== img.src);
        appState.loadedImageSet.delete(img.src); // Remove stale images
        console.log(`Removed stale image: ${img.src}`);
      }
    } catch (error) {
      console.error('Error checking image link:', error);
    }
  }
};

// Initialize the application
const initializeApp = async () => {
  await initIndexedDB();
  await clearCacheOnRefresh();
  await checkFreshness(); // Check freshness of PDFs, images, and text elements during initialization
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