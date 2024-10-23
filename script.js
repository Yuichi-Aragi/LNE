"use strict";

// Configuration Object
const config = {
    proxyUrl: "https://sh.dafeyan784.workers.dev/?target=",
    targetUrl: "https://jnovels.com/top-light-novels-to-read/",
    batchSize: 40,
    maxRetries: 3,
    retryDelay: 1000, // in milliseconds
    searchDebounceTime: 300, // in milliseconds
    intersectionObserverThreshold: 0.2,
    intersectionObserverRootMargin: "250px",
    errorMessageDisplayTime: 5000, // in milliseconds
    fetchTimeout: 10000, // in milliseconds
    fallbackImage: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" ' +
        'width="200" height="300" viewBox="0 0 200 300"%3E%3Crect width="100%" ' +
        'height="100%" fill="%23f0f0f0"/%3E%3Ctext x="50%" y="50%" dominant-baseline=' +
        '"middle" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" ' +
        'fill="%23999"%3EImage not available%3C/text%3E%3C/svg%3E'
};

// Utility Functions
const Utils = {
    /**
     * Fetches a resource with a timeout.
     * @param {string} url - The URL to fetch.
     * @param {object} options - Fetch options.
     * @param {number} timeout - Timeout in milliseconds.
     * @returns {Promise<string>} - Resolves with the fetched text.
     */
    async fetchWithTimeout(url, options = {}, timeout = config.fetchTimeout) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(id);
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            return await response.text();
        } catch (error) {
            clearTimeout(id);
            console.error("Fetch error:", error);
            throw error;
        }
    },

    /**
     * Debounces a function by the specified delay.
     * @param {Function} func - The function to debounce.
     * @param {number} delay - Delay in milliseconds.
     * @returns {Function} - Debounced function.
     */
    debounce(func, delay) {
        let timeoutId;
        return (...args) => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => func.apply(this, args), delay);
        };
    },

    /**
     * Sanitizes input to prevent XSS attacks.
     * @param {string} input - The user input string.
     * @returns {string} - Sanitized string.
     */
    sanitizeInput(input) {
        if (typeof input !== "string") return "";
        const div = document.createElement("div");
        div.textContent = input;
        return div.innerHTML;
    },

    /**
     * Creates a DOM element with specified attributes and children.
     * @param {string} tag - HTML tag name.
     * @param {object} attributes - Attributes as key-value pairs.
     * @param  {...any} children - Child nodes or text.
     * @returns {HTMLElement} - The created element.
     */
    createElement(tag, attributes = {}, ...children) {
        const element = document.createElement(tag);
        Object.entries(attributes).forEach(([key, value]) => {
            if (key.startsWith('aria-') || key.startsWith('data-')) {
                // Set as property for ARIA and data attributes
                element.setAttribute(key, value);
            } else if (key === 'class') {
                element.className = value;
            } else if (key === 'style') {
                element.style.cssText = value;
            } else {
                element.setAttribute(key, value);
            }
        });
        children.forEach(child => {
            if (typeof child === "string") {
                element.textContent = child;
            } else if (child instanceof Node) {
                element.appendChild(child);
            }
        });
        return element;
    },

    /**
     * Validates if a string is a valid URL.
     * @param {string} url - The URL string to validate.
     * @returns {boolean} - True if valid, else false.
     */
    isValidUrl(url) {
        if (typeof url !== "string") return false;
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }
};

// Database Class using Dexie.js for IndexedDB operations
class Database {
    constructor() {
        if (typeof Dexie === 'undefined') {
            console.error("Dexie.js is required for Database operations.");
            return;
        }
        this.db = new Dexie("NovelDatabase");
        this.db.version(1).stores({
            htmlContent: "++id, content"
        });
    }

    /**
     * Retrieves HTML content by ID.
     * @param {number} id - The ID of the content.
     * @returns {Promise<object|null>} - The content object or null.
     */
    async getHtmlContent(id) {
        try {
            return await this.db.htmlContent.get(id) || null;
        } catch (error) {
            console.error("Database read error:", error);
            return null;
        }
    }

    /**
     * Stores HTML content with a specific ID.
     * @param {number} id - The ID to store the content.
     * @param {string} content - The HTML content.
     * @returns {Promise<void>}
     */
    async putHtmlContent(id, content) {
        try {
            await this.db.htmlContent.put({ id, content });
        } catch (error) {
            console.error("Database write error:", error);
        }
    }

    /**
     * Clears all HTML content from the database.
     * @returns {Promise<void>}
     */
    async clearHtmlContent() {
        try {
            await this.db.htmlContent.clear();
        } catch (error) {
            console.error("Database clear error:", error);
        }
    }
}

// Main Application Class
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
            intersectionObserver: null
        };
        this.setupEventListeners();
    }

    /**
     * Caches all necessary DOM elements.
     * @returns {object} - An object containing references to DOM elements.
     */
    getElements() {
        return {
            bookGrid: document.querySelector("#book-grid"),
            searchInput: document.querySelector("#search-input"),
            searchButton: document.querySelector("#search-button"),
            loadingSpinner: document.querySelector(".loading-spinner"),
            menuBtn: document.querySelector(".menu-btn"),
            menuPanel: document.querySelector("#menu-panel"),
            libraryPanel: document.querySelector("#library-panel"),
            settingsPanel: document.querySelector("#settings-panel"),
            themeToggle: document.querySelector("#theme-toggle"),
            errorMessage: document.querySelector("#error-message"),
            libraryLink: document.querySelector("#library-link"),
            settingsLink: document.querySelector("#settings-link")
        };
    }

    /**
     * Sets up all necessary event listeners.
     */
    setupEventListeners() {
        if (this.elements.searchInput) {
            this.elements.searchInput.addEventListener("keydown", this.handleSearchKeydown.bind(this));
        }

        if (this.elements.searchButton) {
            this.elements.searchButton.addEventListener("click", this.performSearch);
        }

        if (this.elements.menuBtn) {
            this.elements.menuBtn.addEventListener("click", () => {
                this.togglePanel(this.elements.menuPanel);
            });
        }

        if (this.elements.libraryLink) {
            this.elements.libraryLink.addEventListener("click", this.handleLibraryLink.bind(this));
        }

        if (this.elements.settingsLink) {
            this.elements.settingsLink.addEventListener("click", this.handleSettingsLink.bind(this));
        }

        document.addEventListener("click", this.handleDocumentClick.bind(this));

        if (this.elements.themeToggle) {
            this.elements.themeToggle.addEventListener("change", this.handleThemeToggle.bind(this));
        }

        window.addEventListener("beforeunload", this.handleBeforeUnload.bind(this));
    }

    /**
     * Initializes the application.
     */
    async init() {
        this.loadSavedTheme();

        // Initialize AOS (Animate On Scroll)
        if (typeof AOS !== 'undefined') {
            AOS.init({
                duration: 800,
                easing: 'slide',
                once: true
            });
        } else {
            console.warn("AOS library is not loaded.");
        }
        
        // Fetch and load initial images
        await this.fetchAndLoadImages();
    }

    /**
     * Loads the saved theme from localStorage.
     */
    loadSavedTheme() {
        if (localStorage.getItem("darkTheme") === "true") {
            document.body.classList.add("dark-theme");
            if (this.elements.themeToggle) {
                this.elements.themeToggle.checked = true;
            }
        } else {
            document.body.classList.remove("dark-theme");
            if (this.elements.themeToggle) {
                this.elements.themeToggle.checked = false;
            }
        }
    }

    /**
     * Fetches HTML content and loads images.
     */
    async fetchAndLoadImages() {
        if (this.state.isLoading || this.state.isPanelOpen) return;

        this.state.isLoading = true;
        this.toggleLoadingSpinner(true);

        try {
            let htmlContent = await this.db.getHtmlContent(1);
            if (!htmlContent) {
                const fetchedContent = await Utils.fetchWithTimeout(config.proxyUrl + encodeURIComponent(config.targetUrl));
                if (fetchedContent) {
                    htmlContent = { id: 1, content: fetchedContent };
                    await this.db.putHtmlContent(1, fetchedContent);
                }
            }

            if (htmlContent) {
                this.extractImagesAndPdfLinks(htmlContent.content || htmlContent);
                if (this.state.images.length > 0) {
                    await this.loadImages();
                    this.setupIntersectionObserver();
                } else {
                    this.showErrorMessage("No images found. Please check the source.");
                }
            } else {
                this.showErrorMessage("No content fetched. Please try again later.");
            }
        } catch (error) {
            console.error("Error during fetching or parsing:", error);
            this.showErrorMessage("Failed to fetch books. Please try again later.");
        } finally {
            this.state.isLoading = false;
            this.toggleLoadingSpinner(false);
        }
    }

    /**
     * Extracts images and PDF links from HTML content.
     * @param {string} html - The HTML content as a string.
     */
    extractImagesAndPdfLinks(html) {
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");

            // Extract lazy-loaded images with specific classes
            const imgElements = Array.from(doc.querySelectorAll('img[loading="lazy"][decoding="async"].alignnone'));

            // Extract PDF links with associated texts
            const linkElements = Array.from(doc.querySelectorAll("a[href]"));
            linkElements.forEach(link => {
                const href = link.href?.trim();
                if (href && Utils.isValidUrl(href)) {
                    const textSpan = link.querySelector('span[style="color: #ff6600;"]') || link;
                    const text = textSpan.textContent?.trim();
                    if (text) {
                        if (!this.state.pdfUrlToTextMap.has(href)) {
                            this.state.pdfUrlToTextMap.set(href, []);
                        }
                        this.state.pdfUrlToTextMap.get(href).push(text);
                    }
                }
            });

            // Filter images that are not yet loaded
            this.state.images = imgElements
                .filter(img => img.src && !this.state.loadedImages.has(img.src))
                .map(img => img.src);

            // Add images to the loaded set to prevent re-fetching
            imgElements.forEach(img => {
                if (img.src) {
                    this.state.loadedImages.add(img.src);
                }
            });

            if (this.state.images.length === 0) {
                console.warn("No new images to load.");
            }
        } catch (error) {
            console.error("Failed to parse HTML content:", error);
            this.showErrorMessage("Failed to parse HTML content.");
        }
    }

    /**
     * Loads a batch of images and appends them to the book grid.
     */
    async loadImages() {
        const start = this.state.currentBatch * config.batchSize;
        const end = Math.min(start + config.batchSize, this.state.images.length);
        const batchImages = this.state.images.slice(start, end);

        if (batchImages.length === 0) {
            this.showErrorMessage("No more images to load.");
            return;
        }

        const fragment = document.createDocumentFragment();

        try {
            const imageElements = await Promise.all(batchImages.map(src => this.createGridItem(src)));
            imageElements.forEach(item => {
                if (item) {
                    fragment.appendChild(item);
                }
            });

            if (this.elements.bookGrid) {
                this.elements.bookGrid.appendChild(fragment);
            }

            this.state.currentBatch += 1;
        } catch (error) {
            console.error("Error loading images:", error);
            this.showErrorMessage("Error loading images.");
        }
    }

    /**
     * Creates a grid item element for a given image source.
     * @param {string} src - The source URL of the image.
     * @param {number} retryCount - Current retry attempt.
     * @returns {Promise<HTMLElement|null>} - The grid item element or null on failure.
     */
    async createGridItem(src, retryCount = 0) {
        if (!src) {
            console.error("Invalid image source:", src);
            return null;
        }

        const gridItem = Utils.createElement("div", { class: "grid-item", "data-aos": "fade-up" });
        const img = new Image();
        img.src = src;
        img.className = "lazyload";
        img.alt = "Book Cover";
        img.loading = "lazy";
        img.decoding = "async";
        img.style.display = "none";

        return new Promise((resolve) => {
            img.onload = () => {
                img.style.display = "block";
                resolve(gridItem);
            };

            img.onerror = async () => {
                if (retryCount < config.maxRetries) {
                    console.warn(`Retrying to load image (${retryCount + 1}/${config.maxRetries}): ${src}`);
                    setTimeout(async () => {
                        const retryItem = await this.createGridItem(src, retryCount + 1);
                        resolve(retryItem);
                    }, config.retryDelay * Math.pow(2, retryCount)); // Exponential backoff
                } else {
                    console.error(`Failed to load image after ${config.maxRetries} retries:`, src);
                    img.src = config.fallbackImage;
                    img.onload = () => resolve(gridItem);
                    img.onerror = () => {
                        this.showErrorMessage(`Failed to load image: ${src}`);
                        resolve(null);
                    };
                }
            };

            gridItem.appendChild(img);

            // Handle click event if the image has an associated link
            // Since only the image source is available, additional logic could be implemented here if links are mapped
        });
    }

    /**
     * Sets up the Intersection Observer for infinite scrolling.
     */
    setupIntersectionObserver() {
        if (!('IntersectionObserver' in window)) {
            console.warn("IntersectionObserver is not supported in this browser.");
            return;
        }

        if (this.state.intersectionObserver) {
            this.state.intersectionObserver.disconnect();
        }

        this.state.intersectionObserver = new IntersectionObserver(
            (entries) => {
                if (entries.some(entry => entry.isIntersecting)) {
                    if (this.state.currentBatch * config.batchSize < this.state.images.length && !this.state.isLoading) {
                        this.loadImages();
                    }
                }
            },
            {
                rootMargin: config.intersectionObserverRootMargin,
                threshold: config.intersectionObserverThreshold
            }
        );

        const lastElement = this.elements.bookGrid?.lastElementChild;
        if (lastElement) {
            this.state.intersectionObserver.observe(lastElement);
        }
    }

    /**
     * Toggles the visibility of a panel.
     * @param {HTMLElement} panel - The panel element to toggle.
     */
    togglePanel(panel) {
        if (!panel) return;
        const isActive = panel.classList.toggle("active");
        this.state.isPanelOpen = isActive;

        // Update ARIA attributes for accessibility
        if (panel.id === "menu-panel") {
            this.elements.menuBtn.setAttribute("aria-expanded", isActive);
        }
    }

    /**
     * Handles clicks outside of panels to close them.
     * @param {Event} event - The click event.
     */
    handleDocumentClick(event) {
        if (
            !event.target.closest(".panel") &&
            !event.target.closest(".menu-btn")
        ) {
            [this.elements.menuPanel, this.elements.libraryPanel, this.elements.settingsPanel].forEach(panel => {
                panel?.classList.remove("active");
            });
            this.state.isPanelOpen = false;

            // Update ARIA attributes for accessibility
            this.elements.menuBtn.setAttribute("aria-expanded", "false");
        }
    }

    /**
     * Handles theme toggle changes.
     */
    handleThemeToggle() {
        document.body.classList.toggle("dark-theme");
        const isDark = document.body.classList.contains("dark-theme");
        localStorage.setItem("darkTheme", isDark);
    }

    /**
     * Handles the search input keydown event.
     * @param {KeyboardEvent} event - The keydown event.
     */
    handleSearchKeydown(event) {
        if (event.key === "Enter") {
            this.performSearch(event);
        }
    }

    /**
     * Handles clicks on the library link.
     */
    handleLibraryLink() {
        this.elements.menuPanel?.classList.remove("active");
        this.state.isPanelOpen = false;
        this.elements.menuBtn.setAttribute("aria-expanded", "false");
        this.togglePanel(this.elements.libraryPanel);
    }

    /**
     * Handles clicks on the settings link.
     */
    handleSettingsLink() {
        this.elements.menuPanel?.classList.remove("active");
        this.state.isPanelOpen = false;
        this.elements.menuBtn.setAttribute("aria-expanded", "false");
        this.togglePanel(this.elements.settingsPanel);
    }

    /**
     * Handles the beforeunload event to clear the database.
     */
    async handleBeforeUnload() {
        try {
            await this.db.clearHtmlContent();
        } catch (error) {
            console.error("Error clearing database on unload:", error);
        }
    }

    /**
     * Toggles the visibility of the loading spinner.
     * @param {boolean} show - Whether to show or hide the spinner.
     */
    toggleLoadingSpinner(show) {
        if (this.elements.loadingSpinner) {
            this.elements.loadingSpinner.classList.toggle("active", show);
            this.elements.loadingSpinner.setAttribute("aria-hidden", !show);
        }
    }

    /**
     * Displays an error message to the user.
     * @param {string} message - The error message to display.
     */
    showErrorMessage(message) {
        if (this.elements.errorMessage) {
            this.elements.errorMessage.textContent = message;
            this.elements.errorMessage.classList.add("active");
            setTimeout(() => {
                this.elements.errorMessage.classList.remove("active");
            }, config.errorMessageDisplayTime);
        }
    }

    /**
     * Redirects to the search results page with the given query.
     * @param {string} query - The search query.
     */
    redirectSearchResults(query) {
        const sanitizedQuery = Utils.sanitizeInput(query);
        if (sanitizedQuery) {
            const searchUrl = `search-results.html?query=${encodeURIComponent(sanitizedQuery)}`;
            window.open(searchUrl, "_blank", "noopener,noreferrer");
        } else {
            this.showErrorMessage("Invalid search query.");
        }
    }

    /**
     * Performs a search based on the input value.
     */
    performSearch = Utils.debounce((event) => {
        event.preventDefault();
        const query = this.elements.searchInput?.value.trim();

        if (!query || query.length < 3) {
            this.showErrorMessage("Search term must be at least 3 characters long.");
            return;
        }

        if (query.length > 100) {
            this.showErrorMessage("Search term must be less than 100 characters.");
            return;
        }

        this.redirectSearchResults(query);
    }, config.searchDebounceTime);
}

// Initialize the application once the DOM is fully loaded
document.addEventListener("DOMContentLoaded", () => {
    const app = new NovelWebsite();
    app.init();
});
