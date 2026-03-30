# 3D Weather Balloon Flight Visualization 🎈

A dynamic, interactive, and 3D web visualization of the flight and descent of weather balloons based on real telemetry data.

## Overview

This project renders the entire trajectory of a weather balloon using the **CesiumJS** engine. With dark-mode satellite textures and a native 3D relief system from *Esri ArcGIS*, the user can visually explore the altitude variation between the terrain and the continuous position of the balloon.

### Features

- 🌍 **3D Globe with Real Relief**: Real topographic elevation that perfectly demonstrates the hills and depressions of the Earth's terrain.
- 🪂 **Balloon to Parachute Transition**: The system automatically calculates the apex (maximum altitude) in the data. Upon reaching the burst altitude during the simulation, a marker icon is generated in the air, and the tracking object transforms into a parachute during its entire descent.
- 📂 **Dynamic Multi-Flight Loading**: Place SondeHub CSV files in the `flight_data/` folder, and a selection window at startup will allow you to freely switch between the registered simulations.
- 🎛️ **Advanced Controls**: Accelerate the time up to 120x, freely drag and rotate the camera using the right mouse button, or monitor the real-time numbers via the telemetry panel using a "Glassmorphism" design.
- 🕰️ **Automatic Timezone Correction**: All telemetry times are automatically adjusted from their origins (UTC) to Brasília Time (BRT).

## Data Note

> [!IMPORTANT]
> All latitude, longitude, and altitude data fed into the simulation comes from calculations projected from advanced atmospheric wind predictions obtained directly by **[SondeHub Predict](https://predict.sondehub.org/)**. All credit for these exceptionally useful and vital meteorological data grids goes to the developers and partners of the initiative.

## How to Run (Locally)

With the addition of the **Range Estimation (Heatmap)** mode, the project now features an intelligent Python backend capable of processing multiple simulations.

1. **Install Dependencies:** (If this is your first time running)
   ```bash
   pip install flask flask-cors pandas scipy numpy
   ```

2. **Start the Python Server:**
   Inside the main project folder, run:
   ```bash
   python server.py
   ```

3. **Access via the Browser:**
   [http://localhost:8000](http://localhost:8000)

> Running standard web development plugins like "Live Server" or basic web servers will no longer provide full functionality due to analytical tools that heavily depend on this specific Python backend server.

## Technologies Used
- **HTML5 / CSS3**: Modern Interface Design and Floating Elements
- **Vanilla JavaScript**: Fast Animation Time Loop Without Heavy Frameworks
- **[CesiumJS](https://cesium.com/)**: WebGL Engine Used for the Globe and 3D Objects
- **[ArcGIS MapServer](https://www.arcgis.com/)**: Global Texture Server (Esri Dark Gray Base) and Terrain Elevation Mesh (WorldElevation3D)
