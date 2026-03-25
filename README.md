# 3D Weather Balloon Flight Simulator 🎈

A dynamic, interactive, and 3D web simulator for visualizing the flight and descent of weather balloons based on real telemetry data.

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

Because the simulation fetches data from security-enabled WebGL map servers and reads directory files via code (`Fetch HTTP`), the HTML file should not just be "double-clicked" directly from the OS to your web browser. Instead, it must be served and routed by a **Local Server**.

You can use:
1. The **Live Server** extension in VS Code (usually on port `5500`).
2. Or by opening the terminal directly inside this folder and running Python's `http.server`:
   ```bash
   python -m http.server 8000
   ```
> Ensure that the server starts exactly in the root folder of this repository (where the main `index.html` file is located) so the script can correctly fetch the autonomous flight subfolder via `flight_data/`.

## Technologies Used
- **HTML5 / CSS3**: Modern Interface Design and Floating Elements
- **Vanilla JavaScript**: Fast Animation Time Loop Without Heavy Frameworks
- **[CesiumJS](https://cesium.com/)**: WebGL Engine Used for the Globe and 3D Objects
- **[ArcGIS MapServer](https://www.arcgis.com/)**: Global Texture Server (Esri Dark Gray Base) and Terrain Elevation Mesh (WorldElevation3D)
