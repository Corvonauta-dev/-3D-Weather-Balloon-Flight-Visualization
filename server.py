import os
import glob
import pandas as pd
import numpy as np
from flask import Flask, jsonify, send_from_directory, request
from flask_cors import CORS

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

# Serve the main index.html file
@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

# Serve static files (.js, .css, .json, images, etc.)
@app.route('/<path:path>')
def send_static(path):
    return send_from_directory('.', path)

# Endpoint for the front-end to discover single flights
@app.route('/api/explore_flight_data')
def list_flights():
    base_dir = os.path.join(os.path.dirname(__file__), 'flight_data')
    if not os.path.exists(base_dir):
        return jsonify([])
    # Retrieve only csv files
    files = [f.name for f in os.scandir(base_dir) if f.is_file() and f.name.lower().endswith('.csv')]
    return jsonify(files)

# Endpoint for the front-end to discover existing test folders
@app.route('/api/explore_range_folders')
def list_folders():
    base_dir = os.path.join(os.path.dirname(__file__), 'range_estimations')
    if not os.path.exists(base_dir):
        return jsonify([])
    # Retrieve only directories
    folders = [f.name for f in os.scandir(base_dir) if f.is_dir()]
    return jsonify(folders)

# Endpoint that performs extensive Python computations on the simulation folder
@app.route('/api/estimate_range/<folder_name>')
def estimate_range(folder_name):
    # Path to the test directory
    dir_path = os.path.join(os.path.dirname(__file__), 'range_estimations', folder_name)
    if not os.path.exists(dir_path):
        return jsonify({"error": "Folder not found"}), 404

    csv_files = glob.glob(os.path.join(dir_path, '*.csv'))
    if not csv_files:
        return jsonify({"error": "No CSV files found in folder"}), 404
    
    landing_points = []
    interpolated_trajectories = [] # All trajectories to calculate the median

    for file in csv_files:
        try:
            # Assuming format: Datetime, Lat, Lng, Alt
            df = pd.read_csv(file, parse_dates=[0])
            if df.empty or len(df.columns) < 4:
                continue
            
            # Explicitly convert the first column to DATETIME
            col_time = df.columns[0]
            df[col_time] = pd.to_datetime(df[col_time], format='mixed', errors='coerce')
            df.dropna(subset=[col_time], inplace=True)
            
            col_lat = df.columns[1]
            col_lng = df.columns[2]
            col_alt = df.columns[3]
            
            # Ensure chronological order
            df = df.sort_values(by=col_time)
            
            # Initial and Final Points
            first_row = df.iloc[0]
            last_row = df.iloc[-1]
            
            start_time = df[col_time].min()
            end_time = df[col_time].max()
            duration_secs = (end_time - start_time).total_seconds()
            
            # Add to landing points collection
            landing_points.append({
                "flight_name": os.path.basename(file),
                "start_time": str(start_time),
                "end_time": str(end_time),
                "duration_secs": duration_secs,
                "start_lat": float(first_row[col_lat]),
                "start_lng": float(first_row[col_lng]),
                "lat": float(last_row[col_lat]),
                "lng": float(last_row[col_lng]),
                "alt": float(last_row[col_alt])
            })
            
            # Logic to interpolate the Primary Route Tendency:
            start_time = df[col_time].min()
            end_time = df[col_time].max()
            duration = (end_time - start_time).total_seconds()
            
            # Calculate the flight progress percentage at each measurement (from 0 to 1)
            if duration > 0:
                df['percent'] = (df[col_time] - start_time).dt.total_seconds() / duration
            else:
                df['percent'] = 0.0
                
            interpolated_trajectories.append(df[[col_lat, col_lng, col_alt, 'percent']])

        except Exception as e:
            print(f"Error parsing {file}: {e}")

    # Calculate median trajectory from interpolated dataframes
    median_trajectory = []
    all_lat = []
    all_lng = []
    
    if interpolated_trajectories:
        # Merge all
        all_trj = pd.concat(interpolated_trajectories, ignore_index=True)
        # Group by every 1% of flight progress from takeoff to landing
        all_trj['percent_bin'] = (all_trj['percent'] // 0.02) * 0.02 
        
        # Calculate median (more robust to outliers than simple mean)
        col_lat = all_trj.columns[0]
        col_lng = all_trj.columns[1]
        col_alt = all_trj.columns[2]
        
        grouped = all_trj.groupby('percent_bin').agg({col_lat: 'median', col_lng: 'median', col_alt: 'median'}).reset_index()
        
        for _, row in grouped.iterrows():
            median_trajectory.append({
                "lat": float(row[col_lat]),
                "lng": float(row[col_lng]),
                "alt": float(row[col_alt])
            })
            
        all_lat = [p["lat"] for p in landing_points]
        all_lng = [p["lng"] for p in landing_points]

    # Calculate the center of the landing area to position the camera
    center_point = {
        "lat": np.mean(all_lat) if all_lat else 0,
        "lng": np.mean(all_lng) if all_lng else 0,
    }

    from scipy.stats import gaussian_kde
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import base64
    import io
    
    heatmap_data = None
    if len(landing_points) >= 3:
        try:
            # Flattening the points
            lats = np.array([p["lat"] for p in landing_points])
            lngs = np.array([p["lng"] for p in landing_points])
            
            # Margin to let heat spread perfectly at the edges
            lat_margin = (lats.max() - lats.min()) * 0.5
            lng_margin = (lngs.max() - lngs.min()) * 0.5
            if lat_margin < 0.05: lat_margin = 0.05
            if lng_margin < 0.05: lng_margin = 0.05
            
            min_lat, max_lat = lats.min() - lat_margin, lats.max() + lat_margin
            min_lng, max_lng = lngs.min() - lng_margin, lngs.max() + lng_margin
            
            # Create the spatial resolution mesh
            grid_size = 150j
            X, Y = np.mgrid[min_lng:max_lng:grid_size, min_lat:max_lat:grid_size]
            positions = np.vstack([X.ravel(), Y.ravel()])
            values = np.vstack([lngs, lats])
            
            # Evaluate point density using Gaussian Kernel Density Estimation
            kernel = gaussian_kde(values)
            Z = np.reshape(kernel(positions).T, X.shape)
            
            # Normalize from 0 to 1
            Z_norm = (Z - Z.min()) / (Z.max() - Z.min() + 1e-10)
            
            # Draw with Matplotlib (Jet = classic heatmap from blue to red)
            cmap = plt.cm.jet
            rgba_img = cmap(Z_norm)
            
            # Mix Alpha channel: Where density tends to zero, transparency obscures the image to prevent a "blue square"
            rgba_img[:, :, 3] = np.power(Z_norm, 0.4)
            
            # Fix NumPy mgrid orientation for Matplotlib Imshow (Matrix Transposition)
            rgba_img = np.swapaxes(rgba_img, 0, 1)
            rgba_img = np.flipud(rgba_img)
            
            fig = plt.figure(frameon=False)
            fig.set_size_inches(5, 5)
            ax = plt.Axes(fig, [0., 0., 1., 1.])
            ax.set_axis_off()
            fig.add_axes(ax)
            
            ax.imshow(rgba_img, aspect='auto', interpolation='bicubic')
            
            buffer = io.BytesIO()
            fig.savefig(buffer, format='png', transparent=True, pad_inches=0, dpi=120)
            plt.close(fig)
            
            # Pack it in Base64 for instant Front-End rendering
            b64_str = base64.b64encode(buffer.getvalue()).decode('utf-8')
            heatmap_data = {
                "image": "data:image/png;base64," + b64_str,
                "bounds": {
                    "west": float(min_lng),
                    "south": float(min_lat),
                    "east": float(max_lng),
                    "north": float(max_lat)
                }
            }
        except Exception as e:
            print("Error calculating Real Heatmap:", e)

    return jsonify({
        "landing_points": landing_points,
        "median_trajectory": median_trajectory,
        "center_point": center_point,
        "heatmap": heatmap_data
    })

if __name__ == '__main__':
    app.run(debug=True, port=8000)
