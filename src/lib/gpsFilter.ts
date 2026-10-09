import { calculateDistance } from './routing';

export interface FilteredGpsPosition {
  coords: [number, number]; // [latitude, longitude]
  accuracy: number;         // in meters
  speedMps: number | null;  // speed in meters/second
  heading: number | null;   // bearing in degrees
  timestamp: number;        // timestamp in ms
  isReliable: boolean;      // true if accepted by filter
  jumpDetected: boolean;    // true if an outlier was suppressed
}

export interface GpsFilterOptions {
  maxAcceptableAccuracy?: number; // Reject readings with accuracy worse than this (default: 65m)
  maxPlausibleSpeedMps?: number;  // Max emergency vehicle speed, e.g. 45 m/s (~160 km/h)
  stationaryThresholdMeters?: number; // Ignore micro-jitters under this distance (default: 3m)
  smoothingFactor?: number;       // EMA alpha factor between 0.1 (very smooth) and 1.0 (raw)
}

/**
 * Military/CAD Grade GPS Kalman & Outlier Suppression Filter.
 * Eliminates cell-tower ±500m triangulation jumps, multipath bouncing, and stationary jitter.
 */
export class GpsFilter {
  private lastPosition: FilteredGpsPosition | null = null;
  private candidateOutlier: { coords: [number, number]; timestamp: number; accuracy: number } | null = null;
  private readonly maxAcceptableAccuracy: number;
  private readonly maxPlausibleSpeedMps: number;
  private readonly stationaryThresholdMeters: number;
  private readonly smoothingFactor: number;

  constructor(options: GpsFilterOptions = {}) {
    this.maxAcceptableAccuracy = options.maxAcceptableAccuracy ?? 35; // Strictly reject cell tower jumps > 35m
    this.maxPlausibleSpeedMps = options.maxPlausibleSpeedMps ?? 45;   // ~162 km/h vehicle speed ceiling
    this.stationaryThresholdMeters = options.stationaryThresholdMeters ?? 2.5; // 2.5m deadband for jitter
    this.smoothingFactor = options.smoothingFactor ?? 0.35;
  }

  /**
   * Resets the filter state (e.g. on new trip or clear GPS session)
   */
  public reset(initialCoords?: [number, number]): void {
    this.candidateOutlier = null;
    if (initialCoords && (initialCoords[0] !== 0 || initialCoords[1] !== 0)) {
      this.lastPosition = {
        coords: initialCoords,
        accuracy: 999, // Seeded as unconfirmed so first real satellite fix instantly overrides it
        speedMps: 0,
        heading: null,
        timestamp: Date.now(),
        isReliable: false,
        jumpDetected: false
      };
    } else {
      this.lastPosition = null;
    }
  }

  /**
   * Ingests a raw GeolocationPosition from navigator.geolocation.watchPosition
   * and returns a smoothed, jitter-free and outlier-filtered coordinate.
   */
  public update(rawPosition: GeolocationPosition): FilteredGpsPosition {
    const rawLat = rawPosition.coords.latitude;
    const rawLng = rawPosition.coords.longitude;
    const rawAccuracy = Math.round(rawPosition.coords.accuracy || 15);
    const now = rawPosition.timestamp || Date.now();

    // 1. Coarse accuracy check: Reject coarse cell-tower and Wi-Fi triangulation bounce (> 35m)
    // Cell towers routinely produce ±500m triangulation jumps. Suppress immediately.
    if (rawAccuracy > this.maxAcceptableAccuracy) {
      if (this.lastPosition && this.lastPosition.isReliable) {
        return {
          ...this.lastPosition,
          accuracy: rawAccuracy,
          timestamp: now,
          isReliable: true,
          jumpDetected: true
        };
      }
      return {
        coords: [Number(rawLat.toFixed(6)), Number(rawLng.toFixed(6))],
        accuracy: rawAccuracy,
        speedMps: 0,
        heading: null,
        timestamp: now,
        isReliable: false,
        jumpDetected: true
      };
    }

    // 2. Initial fix or override of unconfirmed seeded cache:
    if (!this.lastPosition || !this.lastPosition.isReliable || this.lastPosition.accuracy > 100) {
      const initialPos: FilteredGpsPosition = {
        coords: [Number(rawLat.toFixed(6)), Number(rawLng.toFixed(6))],
        accuracy: rawAccuracy,
        speedMps: rawPosition.coords.speed ?? 0,
        heading: rawPosition.coords.heading ?? null,
        timestamp: now,
        isReliable: true,
        jumpDetected: false
      };
      this.lastPosition = initialPos;
      return initialPos;
    }

    const prevLat = this.lastPosition.coords[0];
    const prevLng = this.lastPosition.coords[1];
    const dtSeconds = Math.max(0.5, (now - this.lastPosition.timestamp) / 1000);
    const distanceMeters = calculateDistance(prevLat, prevLng, rawLat, rawLng);

    // 3. Calibration override: If previous fix had worse accuracy (> 20m) and incoming reading
    // has high-precision satellite accuracy (<= 15m), or if previous fix is stale (> 8s), immediately calibrate
    if ((this.lastPosition.accuracy > 20 && rawAccuracy <= 15) || dtSeconds > 8) {
      this.candidateOutlier = null;
      const calibrated: FilteredGpsPosition = {
        coords: [Number(rawLat.toFixed(6)), Number(rawLng.toFixed(6))],
        accuracy: rawAccuracy,
        speedMps: rawPosition.coords.speed ?? 0,
        heading: rawPosition.coords.heading ?? this.lastPosition.heading,
        timestamp: now,
        isReliable: true,
        jumpDetected: false
      };
      this.lastPosition = calibrated;
      return calibrated;
    }

    // 4. Outlier Rejection: Teleportation jump check (> 160km/h or sudden 200m+ jump)
    const maxAllowedDistance = Math.max(35, (this.maxPlausibleSpeedMps * dtSeconds) + (rawAccuracy * 0.3));
    if (distanceMeters > maxAllowedDistance) {
      // Check if this is a confirmed persistent move: if a second fix confirms the new location within 45m
      if (this.candidateOutlier) {
        const candidateDist = calculateDistance(this.candidateOutlier.coords[0], this.candidateOutlier.coords[1], rawLat, rawLng);
        if (candidateDist < 45) {
          // Confirmed true relocation - adopt new coordinates
          this.candidateOutlier = null;
          const adopted: FilteredGpsPosition = {
            coords: [Number(rawLat.toFixed(6)), Number(rawLng.toFixed(6))],
            accuracy: rawAccuracy,
            speedMps: rawPosition.coords.speed ?? 0,
            heading: rawPosition.coords.heading ?? null,
            timestamp: now,
            isReliable: true,
            jumpDetected: false
          };
          this.lastPosition = adopted;
          return adopted;
        }
      }

      // Record candidate and suppress this sudden spike
      this.candidateOutlier = { coords: [rawLat, rawLng], timestamp: now, accuracy: rawAccuracy };
      return {
        ...this.lastPosition,
        accuracy: rawAccuracy,
        timestamp: now,
        isReliable: true,
        jumpDetected: true
      };
    }

    // If reading is within plausible distance, clear candidate outlier
    this.candidateOutlier = null;

    // 5. Deadband / Stationary Noise Suppression
    // When parked or stationary, GPS signals wander by 1 - 2.5 meters. Hold steady.
    if (distanceMeters < this.stationaryThresholdMeters && (rawPosition.coords.speed === null || rawPosition.coords.speed < 1.0)) {
      return {
        ...this.lastPosition,
        accuracy: rawAccuracy,
        speedMps: 0,
        timestamp: now,
        isReliable: true,
        jumpDetected: false
      };
    }

    // 6. Adaptive Exponential Moving Average (EMA) Smoothing
    const confidenceWeight = Math.min(0.9, Math.max(0.3, 1 - (rawAccuracy / 45)));
    const dynamicAlpha = this.smoothingFactor * confidenceWeight + 0.15;

    const smoothedLat = prevLat + dynamicAlpha * (rawLat - prevLat);
    const smoothedLng = prevLng + dynamicAlpha * (rawLng - prevLng);
    const calculatedSpeedMps = distanceMeters / dtSeconds;

    const result: FilteredGpsPosition = {
      coords: [Number(smoothedLat.toFixed(6)), Number(smoothedLng.toFixed(6))],
      accuracy: rawAccuracy,
      speedMps: rawPosition.coords.speed ?? Number(calculatedSpeedMps.toFixed(1)),
      heading: rawPosition.coords.heading ?? this.lastPosition.heading,
      timestamp: now,
      isReliable: true,
      jumpDetected: false
    };

    this.lastPosition = result;
    return result;
  }

  public getCurrent(): FilteredGpsPosition | null {
    return this.lastPosition;
  }
}
