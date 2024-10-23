javascript:(function(){
    try {
        // Configuration
        const MAX_IMAGES = 100; // Maximum number of images to extract
        const CORS_PROXY = 'https://corsproxy.io/?'; // Reliable public CORS proxy

        // Function to sanitize URLs
        function sanitizeURL(url) {
            try {
                return (new URL(url, window.location.href)).href;
            } catch(e) {
                return '';
            }
        }

        // Prevent multiple instances by checking if viewer is already open
        if (window.ultimateHighslideViewer) {
            window.ultimateHighslideViewer.focus();
            return;
        }

        // Extract all img elements with class "highslide-image" up to MAX_IMAGES
        var images = Array.from(document.querySelectorAll('img.highslide-image'))
            .map(img => sanitizeURL(img.getAttribute('src') || img.getAttribute('data-src')))
            .filter(src => src)
            .slice(0, MAX_IMAGES);

        if(images.length === 0){
            alert('No images found with class "highslide-image".');
            return;
        }

        // Open a new window for the image viewer
        var viewer = window.open('', '_blank', 'width=1200,height=800,scrollbars=no,resizable=yes');

        if(!viewer){
            alert('Popup blocked! Please allow popups for this website.');
            return;
        }

        // Assign the viewer window to a global variable to prevent multiple instances
        window.ultimateHighslideViewer = viewer;

        // HTML content for the viewer
        var htmlContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <title>Ultimate Robust Highslide Image Viewer</title>
            <style>
                body {
                    margin: 0;
                    background-color: #000;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    overflow: hidden;
                    position: relative;
                    font-family: Arial, sans-serif;
                    user-select: none;
                }
                #controls-top {
                    position: absolute;
                    top: 10px;
                    right: 10px;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    z-index: 100;
                }
                #controls-top label {
                    color: #fff;
                    font-size: 14px;
                }
                #proxyToggle {
                    width: 40px;
                    height: 20px;
                    position: relative;
                    display: inline-block;
                }
                #proxyToggle input {
                    opacity: 0;
                    width: 0;
                    height: 0;
                }
                .slider {
                    position: absolute;
                    cursor: pointer;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background-color: #ccc;
                    transition: .4s;
                    border-radius: 34px;
                }
                .slider:before {
                    position: absolute;
                    content: "";
                    height: 14px;
                    width: 14px;
                    left: 3px;
                    bottom: 3px;
                    background-color: white;
                    transition: .4s;
                    border-radius: 50%;
                }
                input:checked + .slider {
                    background-color: #2196F3;
                }
                input:checked + .slider:before {
                    transform: translateX(20px);
                }
                #download-button {
                    position: absolute;
                    top: 10px;
                    left: 10px;
                    background-color: rgba(0,0,0,0.5);
                    color: white;
                    border: none;
                    padding: 10px;
                    cursor: pointer;
                    font-size: 16px;
                    border-radius: 5px;
                    z-index: 100;
                }
                #download-button:hover {
                    background-color: rgba(0,0,0,0.8);
                }
                #loading {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    border: 8px solid #f3f3f3;
                    border-top: 8px solid #555;
                    border-radius: 50%;
                    width: 60px;
                    height: 60px;
                    animation: spin 1s linear infinite;
                    z-index: 20;
                }
                @keyframes spin {
                    0% { transform: translate(-50%, -50%) rotate(0deg); }
                    100% { transform: translate(-50%, -50%) rotate(360deg); }
                }
                #error-message {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    color: #fff;
                    background-color: rgba(0,0,0,0.7);
                    padding: 20px;
                    border-radius: 10px;
                    display: none;
                    z-index: 20;
                    text-align: center;
                }
                .nav-button {
                    position: absolute;
                    top: 50%;
                    transform: translateY(-50%);
                    background-color: rgba(0,0,0,0.5);
                    color: white;
                    border: none;
                    padding: 15px;
                    cursor: pointer;
                    font-size: 24px;
                    user-select: none;
                    border-radius: 50%;
                    z-index: 10;
                }
                #prev {
                    left: 20px;
                }
                #next {
                    right: 20px;
                }
                .nav-button:hover {
                    background-color: rgba(0,0,0,0.8);
                }
                #controls-bottom {
                    position: absolute;
                    bottom: 10px;
                    left: 50%;
                    transform: translateX(-50%);
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    z-index: 100;
                }
                #controls-bottom button {
                    background-color: rgba(0,0,0,0.5);
                    color: white;
                    border: none;
                    padding: 10px 15px;
                    cursor: pointer;
                    font-size: 16px;
                    border-radius: 5px;
                }
                #controls-bottom button:hover {
                    background-color: rgba(0,0,0,0.8);
                }
                #controls-bottom input {
                    width: 60px;
                    padding: 5px;
                    border: none;
                    border-radius: 5px;
                    font-size: 14px;
                }
                #thumbnails {
                    position: absolute;
                    bottom: 60px;
                    left: 50%;
                    transform: translateX(-50%);
                    display: flex;
                    overflow-x: auto;
                    gap: 5px;
                    max-width: 90%;
                    padding: 5px;
                    background-color: rgba(0,0,0,0.5);
                    border-radius: 5px;
                    z-index: 100;
                }
                #thumbnails img {
                    height: 60px;
                    cursor: pointer;
                    border: 2px solid transparent;
                    transition: border 0.3s;
                }
                #thumbnails img.active {
                    border: 2px solid #fff;
                }
                #image-container {
                    position: relative;
                    max-width: 100%;
                    max-height: 100%;
                    overflow: hidden;
                    cursor: grab;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-grow: 1;
                }
                #image {
                    max-width: 100%;
                    max-height: 100%;
                    transition: transform 0.3s ease;
                }
                /* Thumbnails Scrollbar Styling */
                #thumbnails::-webkit-scrollbar {
                    height: 8px;
                }
                #thumbnails::-webkit-scrollbar-track {
                    background: rgba(255,255,255,0.1);
                    border-radius: 4px;
                }
                #thumbnails::-webkit-scrollbar-thumb {
                    background: rgba(255,255,255,0.3);
                    border-radius: 4px;
                }
                /* Responsive Adjustments */
                @media (max-width: 600px) {
                    .nav-button {
                        padding: 10px;
                        font-size: 20px;
                    }
                    #thumbnails img {
                        height: 40px;
                    }
                    #controls-top, #controls-bottom {
                        flex-direction: column;
                        gap: 5px;
                    }
                    #controls-top label {
                        font-size: 12px;
                    }
                    #controls-bottom button {
                        padding: 8px 12px;
                        font-size: 14px;
                    }
                    #controls-bottom input {
                        width: 50px;
                        padding: 4px;
                        font-size: 12px;
                    }
                }
            </style>
        </head>
        <body>
            <div id="controls-top">
                <label for="proxyToggle">Use Proxy</label>
                <label id="proxyToggle">
                    <input type="checkbox" id="useProxy">
                    <span class="slider"></span>
                </label>
            </div>
            <button id="download-button">Download</button>
            <div id="loading"></div>
            <div id="error-message">Failed to load image.</div>
            <button id="prev" class="nav-button">&#10094;</button>
            <div id="image-container">
                <img id="image" src="" alt="Image Viewer">
            </div>
            <button id="next" class="nav-button">&#10095;</button>
            <div id="controls-bottom">
                <button id="slideshow-button">Start Slideshow</button>
                <label for="slideshow-interval">Interval (s):</label>
                <input type="number" id="slideshow-interval" value="3" min="1" max="60">
            </div>
            <div id="thumbnails"></div>

            <script>
                (function(){
                    const images = ${JSON.stringify(images)};
                    let currentIndex = 0;
                    let useProxy = false;
                    const PROXY_PREFIX = '${CORS_PROXY}';
                    const imgElement = document.getElementById('image');
                    const prevButton = document.getElementById('prev');
                    const nextButton = document.getElementById('next');
                    const downloadButton = document.getElementById('download-button');
                    const loading = document.getElementById('loading');
                    const errorMessage = document.getElementById('error-message');
                    const imageContainer = document.getElementById('image-container');
                    const proxyToggle = document.getElementById('useProxy');
                    const thumbnailsContainer = document.getElementById('thumbnails');
                    const slideshowButton = document.getElementById('slideshow-button');
                    const slideshowIntervalInput = document.getElementById('slideshow-interval');

                    let slideshowInterval = null;

                    // Preload adjacent images only
                    function preloadImage(index){
                        if(index >= 0 && index < images.length){
                            const img = new Image();
                            img.src = getImageURL(index);
                        }
                    }

                    // Initialize Thumbnails with Lazy-Loading
                    images.forEach((src, index) => {
                        const thumb = document.createElement('img');
                        thumb.dataset.src = src; // Use data-src for lazy loading
                        thumb.alt = \`Thumbnail \${index + 1}\`;
                        // Add active class if it's the first image
                        if(index === 0){
                            thumb.classList.add('active');
                        }
                        // Placeholder for thumbnails before they load
                        thumb.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='; // 1x1 transparent gif
                        thumb.addEventListener('click', () => {
                            showImage(index);
                        });
                        thumbnailsContainer.appendChild(thumb);
                    });

                    // Intersection Observer for Lazy-Loading Thumbnails
                    if('IntersectionObserver' in window){
                        const thumbnailObserver = new IntersectionObserver((entries, observer) => {
                            entries.forEach(entry => {
                                if(entry.isIntersecting){
                                    const img = entry.target;
                                    img.src = img.dataset.src;
                                    observer.unobserve(img);
                                }
                            });
                        }, {
                            root: thumbnailsContainer,
                            rootMargin: '0px',
                            threshold: 0.1
                        });

                        // Observe all thumbnails
                        Array.from(thumbnailsContainer.children).forEach(thumb => {
                            thumbnailObserver.observe(thumb);
                        });
                    } else {
                        // Fallback: Load all thumbnails immediately if IntersectionObserver is not supported
                        Array.from(thumbnailsContainer.children).forEach(thumb => {
                            thumb.src = thumb.dataset.src;
                        });
                    }

                    // Highlight active thumbnail
                    function updateActiveThumbnail() {
                        Array.from(thumbnailsContainer.children).forEach((thumb, idx) => {
                            if(idx === currentIndex){
                                thumb.classList.add('active');
                                thumb.scrollIntoView({ behavior: 'smooth', inline: 'center' });
                            } else {
                                thumb.classList.remove('active');
                            }
                        });
                    }

                    // Function to get proxied URL
                    function getImageURL(index) {
                        if(useProxy){
                            return PROXY_PREFIX + encodeURIComponent(images[index]);
                        }
                        return images[index];
                    }

                    // Function to show image based on index
                    function showImage(index) {
                        if(index < 0 || index >= images.length){
                            return;
                        }
                        loading.style.display = 'block';
                        errorMessage.style.display = 'none';
                        imgElement.style.transform = 'translate(0px, 0px) scale(1)';
                        translateX = 0;
                        translateY = 0;
                        scale = 1;
                        imgElement.src = getImageURL(index);
                        currentIndex = index;
                        updateActiveThumbnail();
                        preloadAdjacentImages();
                    }

                    // Preload adjacent images
                    function preloadAdjacentImages(){
                        const nextIndex = (currentIndex + 1) % images.length;
                        const prevIndex = (currentIndex - 1 + images.length) % images.length;
                        preloadImage(nextIndex);
                        preloadImage(prevIndex);
                    }

                    // Event listeners for navigation buttons
                    prevButton.addEventListener('click', function(){
                        showImage((currentIndex - 1 + images.length) % images.length);
                    });

                    nextButton.addEventListener('click', function(){
                        showImage((currentIndex + 1) % images.length);
                    });

                    // Proxy toggle listener
                    proxyToggle.addEventListener('change', function(){
                        useProxy = proxyToggle.checked;
                        showImage(currentIndex);
                    });

                    // Keyboard navigation
                    document.addEventListener('keydown', function(e){
                        switch(e.key){
                            case 'ArrowLeft':
                                prevButton.click();
                                break;
                            case 'ArrowRight':
                                nextButton.click();
                                break;
                            case 'ArrowUp':
                                zoomImage(1.2);
                                break;
                            case 'ArrowDown':
                                zoomImage(0.8);
                                break;
                            case 'Escape':
                                window.close();
                                break;
                        }
                    });

                    // Image load handler
                    imgElement.addEventListener('load', function(){
                        loading.style.display = 'none';
                        translateX = 0;
                        translateY = 0;
                        scale = 1;
                        imgElement.style.transform = 'translate(0px, 0px) scale(1)';
                    });

                    imgElement.addEventListener('error', function(){
                        loading.style.display = 'none';
                        errorMessage.style.display = 'block';
                        // Suggest using proxy if not already
                        if(!useProxy){
                            if(confirm('Failed to load image. Would you like to try loading it via a proxy to bypass CORS restrictions?')){
                                proxyToggle.checked = true;
                                useProxy = true;
                                showImage(currentIndex);
                            }
                        }
                    });

                    // Download functionality
                    downloadButton.addEventListener('click', function(){
                        const link = document.createElement('a');
                        link.href = imgElement.src;
                        link.download = \`image_\${currentIndex + 1}\`;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                    });

                    // Slideshow functionality
                    slideshowButton.addEventListener('click', function(){
                        if(slideshowInterval){
                            clearInterval(slideshowInterval);
                            slideshowInterval = null;
                            slideshowButton.textContent = 'Start Slideshow';
                        } else {
                            const intervalSeconds = parseInt(slideshowIntervalInput.value, 10);
                            if(isNaN(intervalSeconds) || intervalSeconds < 1){
                                alert('Please enter a valid interval in seconds.');
                                return;
                            }
                            slideshowInterval = setInterval(() => {
                                showImage((currentIndex + 1) % images.length);
                            }, intervalSeconds * 1000);
                            slideshowButton.textContent = 'Pause Slideshow';
                        }
                    });

                    // Zoom functionality
                    let isPanning = false;
                    let startX, startY;
                    let translateX = 0, translateY = 0;
                    let scale = 1;

                    function zoomImage(factor){
                        scale *= factor;
                        scale = Math.min(Math.max(scale, 1), 5); // Limit zoom between 1x and 5x
                        imgElement.style.transform = \`translate(\${translateX}px, \${translateY}px) scale(\${scale})\`;
                    }

                    // Pan functionality
                    imageContainer.addEventListener('mousedown', function(e){
                        if(scale > 1){
                            isPanning = true;
                            startX = e.clientX - translateX;
                            startY = e.clientY - translateY;
                            imageContainer.style.cursor = 'grabbing';
                        }
                    });

                    document.addEventListener('mousemove', function(e){
                        if(isPanning){
                            translateX = e.clientX - startX;
                            translateY = e.clientY - startY;
                            imgElement.style.transform = \`translate(\${translateX}px, \${translateY}px) scale(\${scale})\`;
                        }
                    });

                    document.addEventListener('mouseup', function(){
                        if(isPanning){
                            isPanning = false;
                            imageContainer.style.cursor = 'grab';
                        }
                    });

                    // Reset panning variables on image change
                    imgElement.addEventListener('load', function(){
                        translateX = 0;
                        translateY = 0;
                        scale = 1;
                        imgElement.style.transform = 'translate(0px, 0px) scale(1)';
                    });

                    // Wheel zoom
                    imageContainer.addEventListener('wheel', function(e){
                        e.preventDefault();
                        if(e.deltaY < 0){
                            zoomImage(1.1);
                        } else {
                            zoomImage(0.9);
                        }
                    });

                    // Touch gestures for mobile
                    let touchStartDist = 0;
                    let initialScale = 1;

                    imageContainer.addEventListener('touchstart', function(e){
                        if(e.touches.length === 2){
                            touchStartDist = Math.hypot(
                                e.touches[0].clientX - e.touches[1].clientX,
                                e.touches[0].clientY - e.touches[1].clientY
                            );
                            initialScale = scale;
                        }
                    });

                    imageContainer.addEventListener('touchmove', function(e){
                        if(e.touches.length === 2){
                            const currentDist = Math.hypot(
                                e.touches[0].clientX - e.touches[1].clientX,
                                e.touches[0].clientY - e.touches[1].clientY
                            );
                            const factor = currentDist / touchStartDist;
                            scale = initialScale * factor;
                            scale = Math.min(Math.max(scale, 1), 5);
                            imgElement.style.transform = \`translate(\${translateX}px, \${translateY}px) scale(\${scale})\`;
                        }
                    }, { passive: false });

                    // Handle viewer window close to clean up
                    window.addEventListener('beforeunload', function(){
                        clearInterval(slideshowInterval);
                        window.ultimateHighslideViewer = null;
                    });

                    // Initialize viewer with the first image
                    showImage(0);
                    updateActiveThumbnail();
                })();
            </script>
        </body>
        </html>
        `;

        // Write the HTML content to the new window
        viewer.document.open();
        viewer.document.write(htmlContent);
        viewer.document.close();
    } catch (error) {
        console.error('Ultimate Ultra-Robust Highslide Image Viewer Error:', error);
        alert('An error occurred while launching the image viewer.');
    }
})();
