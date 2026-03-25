// Initialize Cesium Viewer
const viewer = new Cesium.Viewer('cesiumContainer', {
    imageryProvider: false, // Disables the default Ion imagery securely
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    navigationHelpButton: false,
    sceneModePicker: false,
    timeline: false,
    animation: false,
    fullscreenButton: false,
    selectionIndicator: false,
    requestRenderMode: false // Keep continuous render for animation
});

// Load Map Tiles asynchronously - Using Esri Dark Gray Base + Reference Labels (Highly Reliable)
const baseMapPromise = Cesium.ArcGisMapServerImageryProvider.fromUrl('https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer');
const labelMapPromise = Cesium.ArcGisMapServerImageryProvider.fromUrl('https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer');

Promise.all([baseMapPromise, labelMapPromise]).then(providers => {
    viewer.scene.imageryLayers.addImageryProvider(providers[0]); // Ground
    viewer.scene.imageryLayers.addImageryProvider(providers[1]); // City Names
}).catch(err => {
    console.error("Esri maps failed, falling back to Standard OSM", err);
    viewer.scene.imageryLayers.addImageryProvider(new Cesium.OpenStreetMapImageryProvider({
        url: 'https://a.tile.openstreetmap.org/'
    }));
});

// Configure camera controls for right-click rotation
viewer.scene.screenSpaceCameraController.tiltEventTypes = [
    Cesium.CameraEventType.RIGHT_DRAG, Cesium.CameraEventType.MIDDLE_DRAG,
    Cesium.CameraEventType.PINCH,
    {eventType: Cesium.CameraEventType.LEFT_DRAG, modifier: Cesium.KeyboardEventModifier.CTRL}
];
// Move zoom to wheel only (since right drag is now using tilt)
viewer.scene.screenSpaceCameraController.zoomEventTypes = [
    Cesium.CameraEventType.WHEEL, Cesium.CameraEventType.PINCH
];

// CRITICAL FIX: Prevent the default browser Right-Click menu from opening over the map.
// If the menu opens, the browser "steals" the mouse-up event, making Cesium think
// the right button is permanently held down, freezing all future camera movements!
viewer.canvas.addEventListener('contextmenu', function (e) {
    e.preventDefault();
}, false);

// Load Default 3D World Terrain to show Relief visually (Using Esri 3D Elevation to avoid token issues)
Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(
    'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer'
).then(tp => {
    viewer.terrainProvider = tp;
    // Let altitude values compute perfectly above the bumpy terrain
    viewer.scene.globe.depthTestAgainstTerrain = true; 
}).catch(e => {
    console.warn("Failed to load 3D terrain, falling back to flat earth.", e);
});

// Remove shadows for simpler rendering
viewer.scene.globe.enableLighting = false;

let flightData = [];
let flownPathEntity = null;
let balloonEntity = null;
let fullPathEntity = null;
let burstEntity = null;
let burstIndex = 0;

let isPlaying = false;
let simulationTime = 0; // index in data array (can be fractional)
let lastTimestamp = 0;
let animationFrameId = null;

// UI Elements
const valTime = document.getElementById('val-time');
const valAlt = document.getElementById('val-alt');
const valLat = document.getElementById('val-lat');
const valLng = document.getElementById('val-lng');
const valSpeed = document.getElementById('val-speed');
const speedMultiplier = document.getElementById('speed-multiplier');
const progressSlider = document.getElementById('progress-slider');
const progressText = document.getElementById('progress-text');
const btnPlayPause = document.getElementById('btn-play-pause');
const btnReset = document.getElementById('btn-reset');

// Modal Elements
const modal = document.getElementById('file-modal');
const fileListContainer = document.getElementById('file-list');
const btnChangeFlight = document.getElementById('btn-change-flight');
const manualFileInput = document.getElementById('manual-file-input');

// Scan server directory for flights
async function scanFlights() {
    fileListContainer.innerHTML = '<div class="loading-text">Scanning flight_data/ folder...</div>';
    
    try {
        const response = await fetch('flight_data/');
        if (!response.ok) throw new Error("Directory fetching not supported");
        
        const html = await response.text();
        
        // Simple regex to find .csv files in href attributes outputted by Python or Live Server
        const regex = /href="([^"]+\.csv)"/g;
        let files = [];
        let match;
        while ((match = regex.exec(html)) !== null) {
            // Check if it's not a full URL to avoid external links
            if (!match[1].startsWith('http')) {
                files.push(decodeURIComponent(match[1])); // Remove %20 etc
            }
        }
        
        if (files.length === 0) {
            fileListContainer.innerHTML = '<div class="loading-text">No .csv files found in flight_data/ folder.</div>';
            return;
        }

        fileListContainer.innerHTML = '';
        files.forEach(f => {
            const btn = document.createElement('button');
            btn.className = 'file-btn';
            
            // Clean up the filename displayed (strip paths if any got matched)
            const rawFilename = f.split('/').pop();
            btn.textContent = rawFilename;
            
            btn.onclick = () => loadDataFromUrl(`flight_data/${rawFilename}`);
            fileListContainer.appendChild(btn);
        });

    } catch (e) {
        // Fallback or silently fail since we have manual upload input
        fileListContainer.innerHTML = '<div class="loading-text">Live directory scanning failed. Use manual upload below.</div>';
        console.warn("Could not scan directory automatically.", e);
    }
}

// Load and Parse CSV from URL
async function loadDataFromUrl(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("HTTP error " + response.status);
        const text = await response.text();
        parseCSV(text);
        initializeSimulation();
        hideModal();
    } catch (e) {
        console.error("Failed to load CSV", e);
        alert("Failed to load flight data from " + url + ".\nPlease ensure the file exists and you are running a local server correctly.");
    }
}

// Load from manual file upload
manualFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
        parseCSV(evt.target.result);
        initializeSimulation();
        hideModal();
    };
    reader.readAsText(file);
});

function parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    flightData = [];
    
    // Skip header line (index 0)
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const parts = line.split(',');
        if (parts.length < 4) continue; // Skip HTML parsing errors if 404
        
        const [datetimeStr, latStr, lngStr, altStr] = parts;
        
        const lat = parseFloat(latStr);
        const lng = parseFloat(lngStr);
        const alt = parseFloat(altStr);
        
        if (isNaN(lat) || isNaN(lng)) continue; // Extra safety check

        flightData.push({
            timeStr: datetimeStr,
            timeMs: new Date(datetimeStr).getTime(),
            lat: lat,
            lng: lng,
            alt: alt
        });
    }

    if (flightData.length === 0) {
        throw new Error("No valid data points found in file.");
    }

    flightData.sort((a, b) => a.timeMs - b.timeMs);
    
    // Find Burst Index (maximum altitude)
    let maxAlt = -Infinity;
    burstIndex = 0;
    for(let i=0; i<flightData.length; i++) {
        if(flightData[i].alt > maxAlt) {
            maxAlt = flightData[i].alt;
            burstIndex = i;
        }
    }
    
    console.log(`Loaded ${flightData.length} data points. Burst mapped at index ${burstIndex}.`);
}

function initializeSimulation() {
    if (flightData.length === 0) return;

    // Clean up old entities if swapping flights
    if (fullPathEntity) viewer.entities.remove(fullPathEntity);
    if (flownPathEntity) viewer.entities.remove(flownPathEntity);
    if (balloonEntity) viewer.entities.remove(balloonEntity);
    if (burstEntity) viewer.entities.remove(burstEntity);
    
    // Reset simulation variables
    simulationTime = 0;
    pauseSimulation();

    // Draw full trajectory line (dimmed)
    const positions = flightData.map(d => Cesium.Cartesian3.fromDegrees(d.lng, d.lat, d.alt));
    
    fullPathEntity = viewer.entities.add({
        polyline: {
            positions: positions,
            width: 2,
            material: new Cesium.PolylineOutlineMaterialProperty({
                color: Cesium.Color.SLATEGRAY.withAlpha(0.5),
                outlineWidth: 0
            })
        }
    });

    flownPathEntity = viewer.entities.add({
        polyline: {
            positions: [],
            width: 4,
            material: Cesium.Color.DODGERBLUE
        }
    });

    balloonEntity = viewer.entities.add({
        position: positions[0],
        billboard: {
            image: 'balloon.svg',
            scale: 0.6,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -10),
            // Important for deep zooming with terrain
            disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
    });

    burstEntity = viewer.entities.add({
        position: positions[burstIndex],
        billboard: {
            image: 'burst.svg',
            scale: 0.4,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            show: false // hidden until burst
        }
    });

    // Camera view point
    viewer.camera.flyToBoundingSphere(
        Cesium.BoundingSphere.fromPoints(positions),
        {
            duration: 1.5,
            offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-30), 100000)
        }
    );

    updateSimulationUI(0);
}

// Haversine formula for distance in km
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function updateSimulationUI(simIndex) {
    if (!flightData || flightData.length === 0) return;
    
    let idx = Math.min(flightData.length - 1, Math.max(0, simIndex));
    const floorIdx = Math.floor(idx);
    const ceilIdx = Math.ceil(idx);
    const frac = idx - floorIdx;
    
    const d1 = flightData[floorIdx];
    const d2 = flightData[ceilIdx] || d1;

    // Interpolate values
    const lat = d1.lat + (d2.lat - d1.lat) * frac;
    const lng = d1.lng + (d2.lng - d1.lng) * frac;
    const alt = d1.alt + (d2.alt - d1.alt) * frac;
    
    // Estimate Time
    const timeMs = d1.timeMs + (d2.timeMs - d1.timeMs) * frac;
    const dateObj = new Date(timeMs);
    const timeStrFormat = dateObj.toLocaleTimeString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    
    // Estimate Speed
    let speed = 0;
    if (ceilIdx > floorIdx) {
        const distKm = calculateDistance(d1.lat, d1.lng, d2.lat, d2.lng);
        const timeHours = (d2.timeMs - d1.timeMs) / (1000 * 60 * 60);
        if (timeHours > 0) speed = distKm / timeHours;
    }

    // Update 3D balloon position
    const currentPosition = Cesium.Cartesian3.fromDegrees(lng, lat, alt);
    balloonEntity.position = currentPosition;
    
    // Burst visual check
    if (idx >= burstIndex) {
        balloonEntity.billboard.image = 'parachute.svg';
        burstEntity.billboard.show = true;
    } else {
        balloonEntity.billboard.image = 'balloon.svg';
        burstEntity.billboard.show = false;
    }
    
    // Update flown path
    const pathSoFar = flightData.slice(0, floorIdx + 1).map(d => Cesium.Cartesian3.fromDegrees(d.lng, d.lat, d.alt));
    if (frac > 0) {
        pathSoFar.push(currentPosition);
    }
    flownPathEntity.polyline.positions = pathSoFar;

    // Update Telemetry Panel
    valTime.textContent = timeStrFormat;
    valAlt.textContent = Math.round(alt).toLocaleString() + ' m';
    valLat.textContent = lat.toFixed(4) + '°';
    valLng.textContent = lng.toFixed(4) + '°';
    valSpeed.textContent = Math.round(speed) + ' km/h';

    // Update slider
    const pct = (idx / (flightData.length - 1)) * 100;
    progressSlider.value = pct;
    progressText.textContent = pct.toFixed(1) + '%';
}

function simulationLoop(timestamp) {
    if (!lastTimestamp) lastTimestamp = timestamp;
    const deltaTimeMs = timestamp - lastTimestamp;
    lastTimestamp = timestamp;

    if (isPlaying) {
        const speedMult = parseFloat(speedMultiplier.value);
        const elapsedSimulationMs = deltaTimeMs * speedMult;
        
        const floorIdx = Math.floor(simulationTime);
        const ceilIdx = Math.min(flightData.length - 1, floorIdx + 1);
        
        let newTimeMs;
        if (floorIdx === ceilIdx) {
            newTimeMs = flightData[floorIdx].timeMs + elapsedSimulationMs;
        } else {
            const frac = simulationTime - floorIdx;
            const currentTimeMs = flightData[floorIdx].timeMs + (flightData[ceilIdx].timeMs - flightData[floorIdx].timeMs) * frac;
            newTimeMs = currentTimeMs + elapsedSimulationMs;
        }
        
        let newIdx = simulationTime;
        for (let i = 0; i < flightData.length - 1; i++) {
            if (newTimeMs >= flightData[i].timeMs && newTimeMs <= flightData[i+1].timeMs) {
                const range = flightData[i+1].timeMs - flightData[i].timeMs;
                if (range === 0) newIdx = i;
                else newIdx = i + (newTimeMs - flightData[i].timeMs) / range;
                break;
            } else if (newTimeMs > flightData[flightData.length-1].timeMs) {
                newIdx = flightData.length - 1;
            }
        }
        
        simulationTime = newIdx;

        if (simulationTime >= flightData.length - 1) {
            simulationTime = flightData.length - 1;
            pauseSimulation();
        }
        
        updateSimulationUI(simulationTime);
    }

    animationFrameId = requestAnimationFrame(simulationLoop);
}

function togglePlay() {
    isPlaying ? pauseSimulation() : playSimulation();
}

function playSimulation() {
    if (simulationTime >= flightData.length - 1) {
        simulationTime = 0; // restart if at end
    }
    isPlaying = true;
    lastTimestamp = performance.now();
    btnPlayPause.textContent = 'Pause';
    btnPlayPause.classList.remove('primary');
}

function pauseSimulation() {
    isPlaying = false;
    btnPlayPause.textContent = 'Play';
    btnPlayPause.classList.add('primary');
}

function showModal() {
    modal.classList.remove('hidden');
    scanFlights();
}

function hideModal() {
    modal.classList.add('hidden');
}

// Event Listeners
btnPlayPause.addEventListener('click', togglePlay);

btnReset.addEventListener('click', () => {
    pauseSimulation();
    simulationTime = 0;
    updateSimulationUI(simulationTime);
    
    if (flightData.length > 0) {
        const positions = flightData.map(d => Cesium.Cartesian3.fromDegrees(d.lng, d.lat, d.alt));
        viewer.camera.flyToBoundingSphere(
            Cesium.BoundingSphere.fromPoints(positions),
            {
                duration: 1.0,
                offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-30), 100000)
            }
        );
    }
});

progressSlider.addEventListener('input', (e) => {
    pauseSimulation();
    const pct = parseFloat(e.target.value);
    simulationTime = (pct / 100) * (flightData.length - 1);
    updateSimulationUI(simulationTime);
});

btnChangeFlight.addEventListener('click', showModal);

// Start app by showing modal
showModal();
animationFrameId = requestAnimationFrame(simulationLoop);
