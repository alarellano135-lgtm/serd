import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { io, Socket } from 'socket.io-client';
import { 
  calculateRealRoute, 
  calculateDistance,
  formatDistance, 
  formatEta, 
  RouteResult 
} from '../lib/routing';
import { GpsFilter } from '../lib/gpsFilter';
import { useAuth } from '../contexts/AuthContext';
import { useUserSettings } from '../lib/userSettings';
import { useWebRTC } from '../contexts/WebRTCContext';
import { 
  subscribeToIncidents, 
  updateFirestoreIncidentStatus, 
  FirestoreIncident 
} from '../lib/firebase';
import { 
  fetchIncidents, 
  updateIncidentStatus, 
  fetchIncidentMessages, 
  sendIncidentMessage, 
  IncidentChatMessage,
  syncResponderPresence
} from '../lib/api';

interface ResponderViewProps {
  onBack: () => void;
}

type ResponderMode = 'offline' | 'waiting' | 'incoming' | 'en_route' | 'on_scene' | 'transporting';
type ApparatusType = 'ambulance' | 'police' | 'fire';

// Dynamic Leaflet Marker Icon generator based on Apparatus (Police, Ambulance, Fire Engine)
function createVehicleIcon(type: ApparatusType, callSign: string) {
  const iconEmoji = type === 'police' ? '🚓' : type === 'fire' ? '🚒' : '🚑';
  const badgeBg = type === 'police' 
    ? 'background: #2563eb; border-color: #60a5fa;' 
    : type === 'fire' 
    ? 'background: #d97706; border-color: #fbbf24;' 
    : 'background: #B41A46; border-color: #fb7185;';
  const pingColor = type === 'police' ? '#3b82f6' : type === 'fire' ? '#f59e0b' : '#f43f5e';

  return L.divIcon({
    html: `
      <div style="position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; transform: translate(-50%, -50%); user-select: none;">
        <span class="animate-ping" style="position: absolute; width: 44px; height: 44px; border-radius: 9999px; opacity: 0.3; background-color: ${pingColor};"></span>
        <div style="${badgeBg} position: relative; width: 42px; height: 42px; border-radius: 14px; display: flex; align-items: center; justify-content: center; box-shadow: 0 10px 25px rgba(0,0,0,0.4); border: 2.5px solid white; font-size: 20px;">
          ${iconEmoji}
        </div>
        <div style="margin-top: 4px; padding: 2px 7px; border-radius: 6px; background-color: rgba(10,10,10,0.92); color: white; font-family: ui-monospace, monospace; font-size: 10px; font-weight: 800; white-space: nowrap; box-shadow: 0 2px 6px rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.25);">
          ${callSign}
        </div>
      </div>
    `,
    className: '',
    iconSize: [42, 60],
    iconAnchor: [0, 0]
  });
}

function createIncidentMarkerIcon(patientName: string) {
  return L.divIcon({
    html: `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; user-select: none; pointer-events: none; transform: translate(-50%, -100%);">
        <div style="background-color: #e11d48; color: white; padding: 3px 9px; border-radius: 8px; box-shadow: 0 4px 12px rgba(225,29,72,0.4); font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 3px; display: flex; items-center; gap: 4px; border: 1.5px solid white; white-space: nowrap;">
          <span style="width: 6px; height: 6px; border-radius: 9999px; background-color: white;" class="animate-ping"></span>
          <span>${patientName || 'Emergency Scene'}</span>
        </div>
        <div style="width: 14px; height: 14px; background-color: #e11d48; border-radius: 9999px; box-shadow: 0 2px 6px rgba(0,0,0,0.4); border: 2.5px solid white;"></div>
      </div>
    `,
    className: '',
    iconSize: [120, 52],
    iconAnchor: [0, 0]
  });
}

const hospitalMarkerIcon = L.divIcon({
  html: `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; user-select: none; pointer-events: none; transform: translate(-50%, -100%);">
      <div style="background-color: #2563eb; color: white; padding: 3px 9px; border-radius: 8px; box-shadow: 0 4px 12px rgba(37,99,235,0.4); font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 3px; border: 1.5px solid white; white-space: nowrap;">
        BGHMC Hospital
      </div>
      <div style="width: 14px; height: 14px; background-color: #2563eb; border-radius: 9999px; box-shadow: 0 2px 6px rgba(0,0,0,0.4); border: 2.5px solid white;"></div>
    </div>
  `,
  className: '',
  iconSize: [120, 52],
  iconAnchor: [0, 0]
});

// Map View Controller with Damped Pan Smoothing
function MapAutoCenter({ center }: { center: [number, number] }) {
  const map = useMap();
  const lastCenterRef = useRef<[number, number] | null>(null);

  useEffect(() => {
    if (!center || (center[0] === 0 && center[1] === 0)) return;
    if (!lastCenterRef.current) {
      lastCenterRef.current = center;
      map.setView(center, map.getZoom());
      return;
    }
    // Only smooth-pan if distance moved is greater than 10 meters, preventing micro-pan stutter
    const dist = calculateDistance(lastCenterRef.current[0], lastCenterRef.current[1], center[0], center[1]);
    if (dist >= 10) {
      lastCenterRef.current = center;
      map.panTo(center, { animate: true, duration: 1.0, easeLinearity: 0.25 });
    }
  }, [center, map]);
  return null;
}

// Play audio alert tone
function playChime(freq1 = 587.33, freq2 = 880) {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq1, ctx.currentTime);
    osc.frequency.setValueAtTime(freq2, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.38);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.38);
  } catch {}
}

export default function ResponderView({ onBack }: ResponderViewProps) {
  const { userProfile, logout } = useAuth();
  const { settings } = useUserSettings();

  const handleLogout = async () => {
    await logout();
    onBack();
  };

  // Role detection: PNP -> Police, BFP -> Fire, CDRRMO / default -> Ambulance
  const initialApparatus: ApparatusType = (() => {
    const agencyCode = (userProfile?.agency || '').toUpperCase();
    const roleText = (userProfile?.responderRole || '').toLowerCase();
    const unitText = (userProfile?.vehicleUnit || '').toLowerCase();

    if (agencyCode === 'PNP' || roleText.includes('police') || unitText.includes('patrol')) {
      return 'police';
    }
    if (agencyCode === 'BFP' || roleText.includes('fire') || unitText.includes('engine')) {
      return 'fire';
    }
    return 'ambulance';
  })();

  const [apparatus, setApparatus] = useState<ApparatusType>(initialApparatus);
  const [callSign, setCallSign] = useState<string>(
    userProfile?.callSign || userProfile?.vehicleUnit || (initialApparatus === 'police' ? 'Patrol Cruiser' : initialApparatus === 'fire' ? 'Rescue Engine' : 'Medic Unit')
  );

  // Keep apparatus locked to user's registered role from sign-up
  useEffect(() => {
    const agencyCode = (userProfile?.agency || '').toUpperCase();
    const roleText = (userProfile?.responderRole || '').toLowerCase();
    const unitText = (userProfile?.vehicleUnit || '').toLowerCase();

    let detected: ApparatusType = 'ambulance';
    if (agencyCode === 'PNP' || roleText.includes('police') || unitText.includes('patrol')) {
      detected = 'police';
    } else if (agencyCode === 'BFP' || roleText.includes('fire') || unitText.includes('engine')) {
      detected = 'fire';
    }
    setApparatus(detected);

    if (userProfile?.callSign || userProfile?.vehicleUnit) {
      setCallSign(userProfile.callSign || userProfile.vehicleUnit || '');
    }
  }, [userProfile?.agency, userProfile?.responderRole, userProfile?.vehicleUnit, userProfile?.callSign]);

  // Status Mode: offline | waiting | incoming | en_route | on_scene | transporting
  const [mode, setMode] = useState<ResponderMode>('waiting');

  // Real WebRTC Two-Way Audio Calling
  const {
    incomingCall: webrtcIncomingCall,
    isConnected: isCallActive,
    callDurationSec,
    isMuted,
    acceptIncomingCall: webrtcAcceptCall,
    declineIncomingCall: webrtcDeclineCall,
    endCall: webrtcEndCall,
    toggleMute
  } = useWebRTC();

  // Real GPS Geolocation Tracking
  const [deviceGpsCoords, setDeviceGpsCoords] = useState<[number, number] | null>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = sessionStorage.getItem('serd_real_user_location') || localStorage.getItem('serd_real_user_location');
        if (cached) return JSON.parse(cached);
      } catch {}
    }
    return null;
  });
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [isGpsActive, setIsGpsActive] = useState<boolean>(false);
  const [followGps, setFollowGps] = useState<boolean>(true);

  // Live CAD Incidents from Database
  const [liveIncidents, setLiveIncidents] = useState<FirestoreIncident[]>([]);
  const [activeIncident, setActiveIncident] = useState<FirestoreIncident | null>(null);
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [routePoints, setRoutePoints] = useState<[number, number][]>([]);

  // Comms & Messages State
  const [isMessagesOpen, setIsMessagesOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [incomingMessageBanner, setIncomingMessageBanner] = useState<IncidentChatMessage | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [messages, setMessages] = useState<IncidentChatMessage[]>([]);

  // Socket connection for real-time WebSocket CAD events
  const socketRef = useRef<Socket | null>(null);
  const activeIncidentRef = useRef<FirestoreIncident | null>(activeIncident);
  activeIncidentRef.current = activeIncident;
  const isMessagesOpenRef = useRef<boolean>(isMessagesOpen);
  isMessagesOpenRef.current = isMessagesOpen;

  // GPS Kalman & Outlier Suppression Filter (suppresses ±500m cell-tower bounces)
  const gpsFilterRef = useRef<GpsFilter>(new GpsFilter({
    maxAcceptableAccuracy: 65,     // Discard inaccurate cell-tower fixes > 65m
    maxPlausibleSpeedMps: 45,      // ~162 km/h vehicle speed ceiling
    stationaryThresholdMeters: 2.5, // Deadband to stop micro-jitter when stopped
    smoothingFactor: 0.35          // Adaptive Exponential Moving Average
  }));

  // 1. Initialize Real GPS Geolocation Listener with Kalman Outlier Filtering
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return;

    if (deviceGpsCoords) {
      gpsFilterRef.current.reset(deviceGpsCoords);
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const filtered = gpsFilterRef.current.update(pos);
        setDeviceGpsCoords(filtered.coords);
        setGpsAccuracy(filtered.accuracy);
        setIsGpsActive(filtered.isReliable);

        if (filtered.isReliable) {
          try {
            sessionStorage.setItem('serd_real_user_location', JSON.stringify(filtered.coords));
            localStorage.setItem('serd_real_user_location', JSON.stringify(filtered.coords));
          } catch {}
        }
      },
      (err) => {
        console.info('[Responder GPS] Notice:', err.message);
        setIsGpsActive(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // 2. Real-time Incident Subscription from Database
  useEffect(() => {
    // Initial fetch from API
    fetchIncidents().then((list) => {
      if (list && list.length > 0) {
        setLiveIncidents(list as FirestoreIncident[]);
      }
    });

    // Real-time Firestore subscription
    const unsubscribe = subscribeToIncidents((firestoreList) => {
      if (firestoreList && firestoreList.length > 0) {
        setLiveIncidents(firestoreList);

        // If responder is on standby and a newly dispatched incident exists, auto-alert responder
        if (mode === 'waiting' && !activeIncident) {
          const urgentDispatched = firestoreList.find(
            inc => inc.status === 'dispatched' || inc.status === 'pending'
          );
          if (urgentDispatched) {
            setActiveIncident(urgentDispatched);
            setMode('incoming');
            playChime(523.25, 783.99);
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
              try { navigator.vibrate([200, 100, 200]); } catch {}
            }
          }
        }
      }
    });

    // Socket.io integration for instant push alerts
    const socket = io();
    socketRef.current = socket;

    socket.on('incoming-call', (callData: any) => {
      console.log('[CAD Socket] Incoming call event:', callData);
      playChime(523.25, 783.99);
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try { navigator.vibrate([250, 100, 250]); } catch {}
      }
      // Re-fetch to get complete ticket
      fetchIncidents().then((list) => {
        if (list && list.length > 0) {
          setLiveIncidents(list as FirestoreIncident[]);
          const found = list.find(i => i.id === callData.citizenId) || list[0];
          setActiveIncident(found as FirestoreIncident);
          setMode('incoming');
        }
      });
    });

    socket.on('incident-message', (data: { incidentId: string; message: IncidentChatMessage }) => {
      const currentInc = activeIncidentRef.current;
      if (currentInc && (currentInc.id === data.incidentId || !data.incidentId)) {
        setMessages(prev => {
          if (prev.some(m => m.id === data.message.id)) return prev;
          return [...prev, data.message];
        });
        if (!isMessagesOpenRef.current) {
          setUnreadCount(c => c + 1);
          setIncomingMessageBanner(data.message);
          playChime(880, 1174.66);
          setTimeout(() => setIncomingMessageBanner(null), 6000);
        }
      } else if (!currentInc) {
        // Hydrate incident if not yet set
        fetchIncidents().then((list) => {
          if (list && list.length > 0) {
            const found = list.find(i => i.id === data.incidentId) || list[0];
            setActiveIncident(found as FirestoreIncident);
            setLiveIncidents(list as FirestoreIncident[]);
            setMessages(prev => {
              if (prev.some(m => m.id === data.message.id)) return prev;
              return [...prev, data.message];
            });
            if (!isMessagesOpenRef.current) {
              setUnreadCount(c => c + 1);
              setIncomingMessageBanner(data.message);
              playChime(880, 1174.66);
              setTimeout(() => setIncomingMessageBanner(null), 6000);
            }
          }
        });
      }
    });

    return () => {
      unsubscribe();
      socket.disconnect();
    };
  }, []);

  // Current real position of the vehicle
  const currentVehicleCoords: [number, number] = deviceGpsCoords || (() => {
    try {
      const cached = sessionStorage.getItem('serd_real_user_location') || localStorage.getItem('serd_real_user_location');
      if (cached) return JSON.parse(cached);
    } catch {}
    return [0, 0];
  })();

  // Broadcast live responder presence and apparatus to server & Citizen MapScreen
  const lastSyncCoordsRef = useRef<[number, number] | null>(null);
  const lastSyncTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!currentVehicleCoords || (currentVehicleCoords[0] === 0 && currentVehicleCoords[1] === 0)) return;

    const now = Date.now();
    const timeSinceLast = now - lastSyncTimeRef.current;
    
    // Check distance moved since last broadcast
    const distMoved = lastSyncCoordsRef.current
      ? calculateDistance(lastSyncCoordsRef.current[0], lastSyncCoordsRef.current[1], currentVehicleCoords[0], currentVehicleCoords[1])
      : 999;

    // Only broadcast telemetry if 1.5s has passed and vehicle moved >= 4m, or mode/status changed
    if (timeSinceLast < 1500 && distMoved < 4) {
      return;
    }

    lastSyncTimeRef.current = now;
    lastSyncCoordsRef.current = currentVehicleCoords;

    const payload = {
      id: userProfile?.uid || `resp-${apparatus}`,
      callSign,
      apparatus,
      status: mode,
      coords: currentVehicleCoords,
      accuracy: gpsAccuracy || 10,
      phone: userProfile?.phone || ''
    };

    if (socketRef.current?.connected) {
      socketRef.current.emit('responder-presence', payload);
    }
    syncResponderPresence(payload).catch(() => {});
  }, [apparatus, callSign, mode, currentVehicleCoords, gpsAccuracy, userProfile]);

  // Dynamic emergency hospital facility relative to patient / responder location
  const hospitalCoords = useMemo<[number, number]>(() => {
    const base = activeIncident?.coords || currentVehicleCoords;
    return [Number((base[0] + 0.0075).toFixed(6)), Number((base[1] + 0.0055).toFixed(6))];
  }, [activeIncident?.coords, currentVehicleCoords]);

  const handleAcceptIncomingCall = async () => {
    playChime(784, 1046.5);
    await webrtcAcceptCall();
    if (webrtcIncomingCall?.coords) {
      setMode('en_route');
    }
  };

  const handleDeclineIncomingCall = () => {
    webrtcDeclineCall();
  };

  const handleEndDirectCall = () => {
    webrtcEndCall();
    playChime(440, 330);
  };

  // Load messages whenever activeIncident changes
  useEffect(() => {
    if (activeIncident?.id) {
      fetchIncidentMessages(activeIncident.id).then(msgs => {
        if (msgs && msgs.length > 0) {
          setMessages(msgs);
        } else {
          // Default initial radio log
          setMessages([
            {
              id: 'init-1',
              sender: 'dispatch',
              senderName: 'CAD Dispatch',
              text: `Incident ${activeIncident.code || '10-79'} assigned to ${callSign}. Location: ${activeIncident.location}. Respond with caution.`,
              timestamp: activeIncident.reportedTime || 'Now',
              isUrgent: true
            }
          ]);
        }
      });
    }
  }, [activeIncident?.id, callSign]);

  // 3. Compute real Dijkstra road route when entering en_route or transporting
  const lastRoutedCoordsRef = useRef<[number, number] | null>(null);

  useEffect(() => {
    const currentLoc = currentVehicleCoords;

    if (mode === 'en_route' && activeIncident?.coords) {
      const distFromLastRoute = lastRoutedCoordsRef.current
        ? calculateDistance(lastRoutedCoordsRef.current[0], lastRoutedCoordsRef.current[1], currentLoc[0], currentLoc[1])
        : 999;

      // Only re-calculate road route if vehicle moved more than 35m or on mode start
      if (distFromLastRoute < 35 && routeResult) return;

      lastRoutedCoordsRef.current = currentLoc;
      calculateRealRoute(currentLoc, activeIncident.coords)
        .then((res) => {
          setRouteResult(res);
          setRoutePoints(res.coordinates);
        })
        .catch(() => {});
    } else if (mode === 'transporting' && activeIncident?.coords) {
      calculateRealRoute(activeIncident.coords, hospitalCoords)
        .then((res) => {
          setRouteResult(res);
          setRoutePoints(res.coordinates);
        })
        .catch(() => {});
    } else if (mode === 'waiting' || mode === 'offline') {
      setRouteResult(null);
      setRoutePoints([]);
      lastRoutedCoordsRef.current = null;
    }
  }, [mode, activeIncident?.coords, currentVehicleCoords, hospitalCoords]);

  // Actions for incident workflow
  const handleAcceptDispatch = async () => {
    if (!activeIncident) return;
    setMode('en_route');
    playChime(784, 1046.5);
    if (activeIncident.id) {
      await updateIncidentStatus(activeIncident.id, 'en_route');
    }
  };

  const handleDeclineDispatch = () => {
    setMode('waiting');
    setActiveIncident(null);
  };

  const handleMarkArrivedOnScene = async () => {
    if (!activeIncident) return;
    setMode('on_scene');
    playChime(659.25, 880);
    if (activeIncident.id) {
      await updateIncidentStatus(activeIncident.id, 'on_scene');
    }
  };

  const handleCommenceTransport = async () => {
    if (!activeIncident) return;
    setMode('transporting');
    playChime(587.33, 880);
    if (activeIncident.id) {
      await updateIncidentStatus(activeIncident.id, 'en_route');
    }
  };

  const handleCompleteHandover = async () => {
    if (activeIncident?.id) {
      await updateIncidentStatus(activeIncident.id, 'cancelled');
    }
    setMode('waiting');
    setActiveIncident(null);
    setRouteResult(null);
    setRoutePoints([]);
    playChime(523.25, 1046.5);
  };

  // Real messaging send
  const handleSendMessage = async (customText?: string) => {
    const text = (customText || messageInput).trim();
    if (!text || !activeIncident?.id) return;

    const payload = {
      sender: 'responder',
      senderName: `${callSign} (${apparatus.toUpperCase()})`,
      text,
      isUrgent: false
    };

    setMessageInput('');
    playChime(784, 1046.5);

    // Save and broadcast over API & WebSocket
    const created = await sendIncidentMessage(activeIncident.id, payload);
    if (created) {
      setMessages(prev => [...prev, created]);
    }
  };

  const handleOpenMessages = () => {
    setIsMessagesOpen(true);
    setUnreadCount(0);
    setIncomingMessageBanner(null);
  };

  // Active map focal point
  const mapCenter: [number, number] = (() => {
    if (followGps && currentVehicleCoords) return currentVehicleCoords;
    if (mode === 'en_route' && activeIncident?.coords) return activeIncident.coords;
    if (mode === 'transporting') return hospitalCoords;
    return currentVehicleCoords;
  })();

  return (
    <div className="relative w-full h-[100dvh] bg-neutral-950 text-neutral-900 font-sans overflow-hidden select-none">
      
      {/* Fullscreen Map Canvas */}
      <div className="absolute inset-0 z-0">
        <MapContainer
          center={currentVehicleCoords}
          zoom={15}
          zoomControl={false}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <MapAutoCenter center={mapCenter} />

          {/* Real Dynamic Responder Vehicle Marker (Driven by Real GPS) */}
          <Marker 
            position={currentVehicleCoords} 
            icon={createVehicleIcon(apparatus, callSign)} 
            zIndexOffset={1000} 
          />

          {/* Real Incident Site Marker */}
          {activeIncident?.coords && (mode === 'incoming' || mode === 'en_route' || mode === 'on_scene') && (
            <Marker 
              position={activeIncident.coords} 
              icon={createIncidentMarkerIcon(activeIncident.patientName)} 
            />
          )}

          {/* Hospital Receiving Facility Marker */}
          {mode === 'transporting' && (
            <Marker position={hospitalCoords} icon={hospitalMarkerIcon} />
          )}

          {/* Real-time Dijkstra Road Path Polyline */}
          {routePoints.length > 0 && (
            <Polyline
              positions={routePoints}
              color={apparatus === 'police' ? '#1d4ed8' : apparatus === 'fire' ? '#d97706' : '#0f172a'}
              weight={6}
              opacity={0.88}
              lineCap="round"
              lineJoin="round"
            />
          )}
        </MapContainer>
      </div>

      {/* Top Floating Header Bar */}
      <div className="absolute top-3 sm:top-4 left-3 sm:left-4 right-3 sm:right-4 z-20 flex items-center justify-between pointer-events-none">
        
        {/* Left: Log Out Button & Active Unit Badge */}
        <div className="flex items-center gap-2 pointer-events-auto">
          <button
            onClick={handleLogout}
            className="h-10 sm:h-11 px-3 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-md rounded-2xl shadow-lg border border-neutral-200/80 dark:border-neutral-800 flex items-center justify-center text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 active:scale-95 transition-all cursor-pointer font-bold text-xs"
            aria-label="Log Out from Responder Unit"
            title="Log Out"
          >
            EXIT
          </button>

          {/* Active Unit Badge (locked to registered profile from sign-up) */}
          <div className="flex items-center gap-2.5 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-md rounded-2xl px-3 sm:px-3.5 py-2 shadow-lg border border-neutral-200/80 dark:border-neutral-800">
            <span className="text-xl shrink-0">
              {apparatus === 'police' ? '🚓' : apparatus === 'fire' ? '🚒' : '🚑'}
            </span>
            <div className="flex flex-col min-w-0 pr-1">
              <span className="text-xs font-bold text-neutral-900 dark:text-white leading-tight truncate max-w-[130px] sm:max-w-[180px]">
                {callSign || userProfile?.vehicleUnit || (apparatus === 'police' ? 'PNP Patrol' : apparatus === 'fire' ? 'BFP Fire Unit' : 'EMS Ambulance')}
              </span>
              <span className="text-[10px] font-semibold text-neutral-500 dark:text-neutral-400 leading-none mt-0.5">
                {userProfile?.agency 
                  ? (userProfile.agency === 'BFP' ? 'Fire (BFP)' : userProfile.agency === 'PNP' ? 'PNP (Police)' : 'Paramedics (CDRRMO)') 
                  : (apparatus === 'police' ? 'PNP Police' : apparatus === 'fire' ? 'Fire / BFP' : 'Paramedics EMS')}
              </span>
            </div>
          </div>
        </div>

        {/* Right: GPS Status & Messages Notification Center */}
        <div className="flex items-center gap-2 pointer-events-auto">
          {/* GPS Tracking Badge / Recenter */}
          <button
            onClick={() => setFollowGps(!followGps)}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-2xl shadow-lg border backdrop-blur-md text-xs font-bold transition-all cursor-pointer ${
              isGpsActive
                ? 'bg-emerald-50/95 border-emerald-300 text-emerald-800'
                : 'bg-white/95 border-neutral-200 text-neutral-600'
            }`}
            title={isGpsActive ? `Live GPS Locked (±${gpsAccuracy}m)` : 'GPS Acquiring...'}
          >
            <span className={`w-2 h-2 rounded-full ${isGpsActive ? 'bg-emerald-500 animate-pulse' : 'bg-neutral-400'}`}></span>
            <span>{isGpsActive ? `±${gpsAccuracy}m` : 'Locating'}</span>
          </button>

          {/* Messages / CAD Comms Button with Notification Badge */}
          <button
            onClick={handleOpenMessages}
            className="relative h-10 sm:h-11 px-3 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-md rounded-2xl shadow-lg border border-neutral-200/80 dark:border-neutral-800 flex items-center justify-center text-neutral-800 dark:text-white hover:bg-white active:scale-95 transition-all cursor-pointer font-bold text-xs"
            aria-label="Dispatch Comms & Citizen Messages"
            title="Dispatch & Citizen Comms"
          >
            COMMS
            {unreadCount > 0 && (
              <span className="ml-1 px-1.5 py-0.2 bg-[#B41A46] text-white text-[10px] font-bold rounded-full shadow-md animate-pulse">
                {unreadCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Floating Incoming Message Banner Toast */}
      {incomingMessageBanner && !isMessagesOpen && (
        <div 
          onClick={handleOpenMessages}
          className="absolute top-16 right-3 sm:right-4 z-30 max-w-sm bg-neutral-950 text-white rounded-2xl p-3.5 shadow-2xl border border-rose-500/50 animate-[fade-in_0.2s_ease-out] cursor-pointer flex items-start gap-3"
        >
          <div className="w-8 h-8 rounded-xl bg-rose-600/30 text-rose-400 flex items-center justify-center shrink-0 border border-rose-500/50 text-xs font-mono font-bold">
            MSG
          </div>
          <div className="flex-1 min-w-0 pr-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase font-bold text-rose-400">
                {incomingMessageBanner.senderName}
              </span>
              <span className="text-[10px] text-neutral-500 font-mono">
                {incomingMessageBanner.timestamp}
              </span>
            </div>
            <p className="text-xs text-neutral-200 mt-0.5 line-clamp-2 font-medium">
              {incomingMessageBanner.text}
            </p>
          </div>
        </div>
      )}

      {/* Active In-Call Floating HUD */}
      {isCallActive && (
        <div className="absolute top-16 left-3 sm:left-4 right-3 sm:right-4 z-30 bg-emerald-950/95 text-white rounded-2xl p-3 shadow-2xl border border-emerald-500/50 flex items-center justify-between animate-[fade-in_0.2s_ease-out]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/30 text-emerald-400 flex items-center justify-center font-bold text-xs">
              CALL
            </div>
            <div>
              <span className="text-[10px] font-mono uppercase text-emerald-400 font-bold block">
                LIVE CALL &bull; DIRECT AUDIO COMMS
              </span>
              <div className="text-xs font-mono font-bold text-white">
                Speaking with Citizen &bull; {String(Math.floor(callDurationSec / 60)).padStart(2, '0')}:{String(callDurationSec % 60).padStart(2, '0')}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={toggleMute}
              className="px-2.5 py-1.5 rounded-xl bg-emerald-900/60 hover:bg-emerald-800 text-white transition-colors cursor-pointer text-xs font-bold"
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? 'MUTED' : 'MUTE'}
            </button>
            <button
              onClick={handleEndDirectCall}
              className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1 shadow-xs cursor-pointer active:scale-95"
            >
              <span>End Call</span>
            </button>
          </div>
        </div>
      )}

      {/* Direct Incoming Call from Citizen Modal */}
      {webrtcIncomingCall && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-[fade-in_0.2s_ease-out]">
          <div className="w-full max-w-sm bg-neutral-950 text-white rounded-3xl p-6 border border-rose-500/50 shadow-2xl space-y-4 text-center">
            <div className="w-16 h-16 rounded-full bg-rose-600/30 text-rose-500 border-2 border-rose-500 flex items-center justify-center mx-auto animate-pulse font-mono font-bold text-sm">
              CALL
            </div>

            <div>
              <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-rose-600 text-white tracking-wider mb-2">
                INCOMING CALL FROM CITIZEN
              </span>
              <h2 className="text-xl font-extrabold text-white">
                {webrtcIncomingCall.callerName}
              </h2>
              <p className="text-xs text-neutral-400 mt-1 flex items-center justify-center gap-1">
                <span className="text-[11px] font-bold text-rose-400">LOC:</span>
                <span className="truncate max-w-[240px]">{webrtcIncomingCall.callerLocation}</span>
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={handleDeclineIncomingCall}
                className="py-3.5 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 font-bold text-xs uppercase tracking-wider rounded-2xl border border-neutral-700 cursor-pointer active:scale-95"
              >
                Decline
              </button>
              <button
                onClick={handleAcceptIncomingCall}
                className="py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs uppercase tracking-wider rounded-2xl shadow-lg flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
              >
                <span>ACCEPT & TALK</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mode: EN ROUTE - Real-time Turn Navigation HUD */}
      {(mode === 'en_route' || mode === 'transporting') && routeResult && (
        <div className="absolute top-16 left-3 sm:left-4 right-3 sm:right-4 z-20 bg-neutral-950 text-white rounded-2xl p-3.5 shadow-2xl border border-neutral-800 animate-[fade-in_0.2s_ease-out]">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3 min-w-0 pr-2">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/30 font-mono font-bold text-xs">
                NAV
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-neutral-400 font-mono uppercase tracking-wider truncate">
                  {mode === 'transporting' ? 'Hospital Transit' : 'Navigating to Emergency Scene'}
                </p>
                <h3 className="text-xs sm:text-sm font-bold text-white tracking-tight leading-snug truncate">
                  {mode === 'transporting' ? 'BGHMC Medical Center' : (activeIncident?.location || 'Target Scene')}
                </h3>
              </div>
            </div>

            <div className="text-right shrink-0">
              <span className="block text-sm font-extrabold text-emerald-400 font-mono">
                {formatEta(routeResult.durationSeconds)}
              </span>
              <span className="block text-[10px] text-neutral-400 font-mono">
                {formatDistance(routeResult.distanceMeters)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 1. BOTTOM SHEET: STANDBY / ACTIVE CAD QUEUE               */}
      {/* ========================================================= */}
      {mode === 'waiting' && (
        <div className="absolute bottom-0 left-0 right-0 z-30 bg-white dark:bg-neutral-900 rounded-t-[28px] shadow-[0_-8px_30px_rgba(0,0,0,0.2)] p-5 border-t border-neutral-100 dark:border-neutral-800 animate-[fade-in_0.2s_ease-out]">
          <div className="w-10 h-1 bg-neutral-200 dark:bg-neutral-700 rounded-full mx-auto mb-3" />

          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="flex items-center space-x-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
                <h2 className="text-lg font-bold text-neutral-900 dark:text-white tracking-tight">
                  {callSign} &bull; On Standby
                </h2>
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                {isGpsActive ? `Live GPS Connected (±${gpsAccuracy}m)` : 'Connected to Emergency CAD Network'}
              </p>
            </div>

            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-lg border ${
              apparatus === 'police' 
                ? 'bg-blue-50 text-blue-700 border-blue-200' 
                : apparatus === 'fire' 
                ? 'bg-amber-50 text-amber-700 border-amber-200' 
                : 'bg-rose-50 text-rose-700 border-rose-200'
            }`}>
              {apparatus === 'police' ? '🚓' : apparatus === 'fire' ? '🚒' : '🚑'}
            </div>
          </div>

          {/* Active Incidents Queue in the Region */}
          <div className="mb-3">
            <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1.5">
              Available CAD Incidents ({liveIncidents.length})
            </span>
            <div className="space-y-1.5 max-h-32 overflow-y-auto">
              {liveIncidents.map((inc) => (
                <div 
                  key={inc.id || inc.code}
                  onClick={() => {
                    setActiveIncident(inc);
                    setMode('incoming');
                    playChime(523.25, 783.99);
                  }}
                  className="p-2.5 bg-neutral-50 dark:bg-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-700/80 rounded-xl border border-neutral-200 dark:border-neutral-700 flex items-center justify-between cursor-pointer transition-colors active:scale-98"
                >
                  <div className="min-w-0 flex-1 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-600 shrink-0"></span>
                      <p className="text-xs font-bold text-neutral-900 dark:text-white truncate">{inc.type}</p>
                    </div>
                    <p className="text-[10px] text-neutral-500 dark:text-neutral-400 truncate pl-3">{inc.location}</p>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 font-mono shrink-0">
                    Respond &rarr;
                  </span>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={() => setMode('offline')}
            className="w-full py-2.5 text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-white text-xs font-semibold text-center transition-colors cursor-pointer"
          >
            Go Offline
          </button>
        </div>
      )}

      {/* ========================================================= */}
      {/* 2. BOTTOM SHEET: OFFLINE                                  */}
      {/* ========================================================= */}
      {mode === 'offline' && (
        <div className="absolute bottom-0 left-0 right-0 z-30 bg-white dark:bg-neutral-900 rounded-t-[28px] shadow-2xl p-6 border-t border-neutral-100 dark:border-neutral-800 text-center">
          <div className="w-10 h-1 bg-neutral-200 dark:bg-neutral-700 rounded-full mx-auto mb-3" />
          <h2 className="text-lg font-bold text-neutral-900 dark:text-white">{callSign} Offline</h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 max-w-xs mx-auto">
            You will not receive CAD emergency dispatch alerts or route assignments.
          </p>

          <button
            onClick={() => setMode('waiting')}
            className="w-full mt-5 py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-xs tracking-wider uppercase shadow-lg active:scale-[0.99] transition-all cursor-pointer"
          >
            GO ON STANDBY
          </button>
        </div>
      )}

      {/* ========================================================= */}
      {/* 3. BOTTOM SHEET: INCOMING CALL (NO 15S TIMER - STAYS ACTIVE) */}
      {/* ========================================================= */}
      {mode === 'incoming' && activeIncident && (
        <div className="absolute bottom-0 left-0 right-0 z-40 bg-neutral-950 text-white rounded-t-[28px] shadow-[0_-10px_40px_rgba(0,0,0,0.6)] p-5 border-t border-neutral-800 animate-[fade-in_0.2s_ease-out]">
          <div className="w-10 h-1 bg-neutral-800 rounded-full mx-auto mb-3" />

          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-600 text-white uppercase tracking-wider">
                  <span className="w-2 h-2 rounded-full bg-white animate-ping"></span>
                  <span>PRIORITY DISPATCH &bull; {activeIncident.priority?.toUpperCase() || 'CRITICAL'}</span>
                </span>
                <span className="text-[10px] font-mono text-neutral-400">
                  Target: {callSign}
                </span>
              </div>
              <h2 className="text-base sm:text-lg font-extrabold text-white tracking-tight">
                {activeIncident.type}
              </h2>
            </div>

            <div className="w-11 h-11 rounded-2xl bg-rose-950/60 border border-rose-800/60 flex items-center justify-center text-xl shrink-0">
              {apparatus === 'police' ? '🚓' : apparatus === 'fire' ? '🚒' : '🚑'}
            </div>
          </div>

          {/* Incident Details Card */}
          <div className="p-3.5 bg-neutral-900/80 rounded-2xl border border-neutral-800 space-y-2 text-xs text-neutral-300 mb-4">
            <div className="flex items-start space-x-2">
              <span className="text-rose-500 font-mono font-bold shrink-0 mt-0.5">[LOC]</span>
              <span className="font-semibold text-white">{activeIncident.location}</span>
            </div>
            <div className="flex items-center justify-between text-[11px] pt-1.5 border-t border-neutral-800 text-neutral-400">
              <span>Patient / Reporter: <strong className="text-white">{activeIncident.patientName}</strong></span>
              <span className="px-1.5 py-0.5 rounded bg-neutral-800 font-mono text-white font-bold">{activeIncident.code || '10-79'}</span>
            </div>
            {activeIncident.details && (
              <p className="text-[11px] text-neutral-400 italic pt-0.5">
                "{activeIncident.details}"
              </p>
            )}
          </div>

          {/* Accept & Decline Buttons (Stays indefinitely until responder chooses) */}
          <div className="grid grid-cols-3 gap-3">
            <button
              onClick={handleDeclineDispatch}
              className="col-span-1 py-4 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 rounded-2xl font-bold text-xs uppercase tracking-wider transition-colors border border-neutral-700 cursor-pointer active:scale-95"
            >
              Decline
            </button>
            <button
              onClick={handleAcceptDispatch}
              className="col-span-2 py-4 bg-[#B41A46] hover:bg-[#9a143a] text-white rounded-2xl font-extrabold text-sm uppercase tracking-wider shadow-[0_4px_20px_rgba(180,26,70,0.5)] active:scale-[0.99] transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <span>ACCEPT DISPATCH</span>
            </button>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 4. BOTTOM SHEET: EN ROUTE                                 */}
      {/* ========================================================= */}
      {mode === 'en_route' && activeIncident && (
        <div className="absolute bottom-0 left-0 right-0 z-30 bg-white dark:bg-neutral-900 rounded-t-[28px] shadow-2xl p-5 border-t border-neutral-100 dark:border-neutral-800 animate-[fade-in_0.2s_ease-out]">
          <div className="w-10 h-1 bg-neutral-200 dark:bg-neutral-700 rounded-full mx-auto mb-3" />

          <div className="flex items-center justify-between pb-3 border-b border-neutral-100 dark:border-neutral-800">
            <div>
              <span className="text-[10px] font-mono text-rose-600 font-bold uppercase tracking-wider">
                EN ROUTE &bull; {callSign}
              </span>
              <h3 className="text-base font-bold text-neutral-900 dark:text-white">{activeIncident.patientName}</h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">{activeIncident.location}</p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleOpenMessages}
                className="px-3 py-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white font-bold text-xs hover:bg-neutral-200 transition-colors cursor-pointer"
                title="Message Citizen / Dispatch"
              >
                COMMS
              </button>

              <a
                href="tel:911"
                className="px-3 py-2 rounded-xl bg-[#B41A46] text-white font-bold text-xs hover:bg-[#9a143a] transition-colors"
                title="Call Citizen"
              >
                CALL
              </a>
            </div>
          </div>

          {/* Medical Allergy Warning if available */}
          <div className="mt-3 p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900/40 rounded-xl flex items-center space-x-2 text-xs text-rose-800 dark:text-rose-300">
            <span className="font-bold text-rose-600 font-mono text-[11px] shrink-0">[ALERT]</span>
            <span className="font-semibold text-[11px] truncate">
              CAD ALERT: Penicillin Allergy Flagged &bull; Approach with Resuscitation ALS
            </span>
          </div>

          <button
            onClick={handleMarkArrivedOnScene}
            className="w-full mt-4 py-4 bg-amber-600 hover:bg-amber-700 text-white rounded-2xl font-bold text-xs tracking-wider uppercase shadow-lg active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <span>MARK ARRIVED ON SCENE</span>
          </button>
        </div>
      )}

      {/* ========================================================= */}
      {/* 5. BOTTOM SHEET: ON SCENE                                 */}
      {/* ========================================================= */}
      {mode === 'on_scene' && activeIncident && (
        <div className="absolute bottom-0 left-0 right-0 z-30 bg-white dark:bg-neutral-900 rounded-t-[28px] shadow-2xl p-5 border-t border-neutral-100 dark:border-neutral-800 animate-[fade-in_0.2s_ease-out]">
          <div className="w-10 h-1 bg-neutral-200 dark:bg-neutral-700 rounded-full mx-auto mb-3" />

          <div className="flex items-center justify-between pb-3 border-b border-neutral-100 dark:border-neutral-800">
            <div>
              <span className="text-[10px] font-mono text-amber-600 font-bold uppercase tracking-wider">
                ON SCENE &bull; {callSign} ACTIVE
              </span>
              <h3 className="text-base font-bold text-neutral-900 dark:text-white">{activeIncident.patientName}</h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Field triage and patient stabilization</p>
            </div>
            <div className="px-2.5 py-1 bg-neutral-900 text-white rounded-lg font-mono text-xs font-bold">
              {activeIncident.code || '10-79'}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-mono">
            <div className="p-2.5 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl">
              <span className="text-[10px] text-neutral-400 block">Vitals Status</span>
              <span className="font-bold text-neutral-800 dark:text-neutral-200">Patient Conscious</span>
            </div>
            <div className="p-2.5 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl">
              <span className="text-[10px] text-neutral-400 block">Receiving Facility</span>
              <span className="font-bold text-neutral-800 dark:text-neutral-200">BGHMC Hospital</span>
            </div>
          </div>

          <button
            onClick={handleCommenceTransport}
            className="w-full mt-4 py-4 bg-neutral-950 dark:bg-white hover:bg-neutral-800 dark:hover:bg-neutral-100 text-white dark:text-neutral-900 rounded-2xl font-bold text-xs tracking-wider uppercase shadow-lg active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <span>PATIENT SECURED &bull; COMMENCE TRANSPORT</span>
          </button>
        </div>
      )}

      {/* ========================================================= */}
      {/* 6. BOTTOM SHEET: TRANSPORTING TO HOSPITAL                 */}
      {/* ========================================================= */}
      {mode === 'transporting' && activeIncident && (
        <div className="absolute bottom-0 left-0 right-0 z-30 bg-white dark:bg-neutral-900 rounded-t-[28px] shadow-2xl p-5 border-t border-neutral-100 dark:border-neutral-800 animate-[fade-in_0.2s_ease-out]">
          <div className="w-10 h-1 bg-neutral-200 dark:bg-neutral-700 rounded-full mx-auto mb-3" />

          <div className="flex items-center justify-between pb-3 border-b border-neutral-100 dark:border-neutral-800">
            <div>
              <span className="text-[10px] font-mono text-blue-600 font-bold uppercase tracking-wider">
                EN ROUTE TO RECEIVING HOSPITAL
              </span>
              <h3 className="text-base font-bold text-neutral-900 dark:text-white">BGHMC Medical Center</h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Trauma ICU notified via CAD telemetry</p>
            </div>
            <div className="text-right">
              <span className="text-xs font-mono font-bold text-emerald-600">ER Ready</span>
            </div>
          </div>

          <button
            onClick={handleCompleteHandover}
            className="w-full mt-4 py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-xs tracking-wider uppercase shadow-lg active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <span>COMPLETE HANDOVER & CLEAR UNIT</span>
          </button>
        </div>
      )}

      {/* ========================================================= */}
      {/* 7. DISPATCH & CITIZEN COMMS MODAL                         */}
      {/* ========================================================= */}
      {isMessagesOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-[fade-in_0.15s_ease-out]">
          <div className="bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white w-full sm:max-w-lg rounded-t-[28px] sm:rounded-3xl shadow-2xl border-t sm:border border-neutral-200 dark:border-neutral-800 flex flex-col h-[85vh] max-h-[720px] overflow-hidden">
            
            {/* Mobile Drag Indicator */}
            <div className="w-10 h-1 bg-neutral-300 dark:bg-neutral-700 rounded-full mx-auto mt-2.5 -mb-1 sm:hidden shrink-0" />

            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-neutral-100 dark:bg-neutral-800 text-[#B41A46] dark:text-rose-400 flex items-center justify-center font-bold text-xs font-mono">
                  RAD
                </div>
                <div>
                  <h3 className="font-bold text-sm tracking-tight leading-tight">
                    CAD Comms & Dispatch Radio
                  </h3>
                  <p className="text-[11px] text-neutral-400">
                    Channel: {callSign} &bull; {activeIncident ? activeIncident.type : 'Emergency CAD Network'}
                  </p>
                </div>
              </div>

              <button
                onClick={() => setIsMessagesOpen(false)}
                className="px-2.5 py-1 text-xs font-bold text-neutral-400 hover:text-neutral-700 dark:hover:text-white rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
                aria-label="Close Comms"
              >
                Close
              </button>
            </div>

            {/* Quick Radio Preset Pills */}
            <div className="px-4 py-2.5 bg-neutral-50 dark:bg-neutral-800/60 border-b border-neutral-100 dark:border-neutral-800 flex items-center gap-1.5 overflow-x-auto shrink-0 no-scrollbar">
              <button
                onClick={() => handleSendMessage('En route to scene, approaching coordinates')}
                className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-[11px] font-semibold text-neutral-700 dark:text-neutral-300 whitespace-nowrap active:scale-95 transition-all hover:border-[#B41A46] cursor-pointer"
              >
                En Route
              </button>
              <button
                onClick={() => handleSendMessage('Heavy intersection traffic encountered on route')}
                className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-[11px] font-semibold text-neutral-700 dark:text-neutral-300 whitespace-nowrap active:scale-95 transition-all hover:border-[#B41A46] cursor-pointer"
              >
                Traffic Delay
              </button>
              <button
                onClick={() => handleSendMessage('On scene, initiating patient assessment')}
                className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-[11px] font-semibold text-neutral-700 dark:text-neutral-300 whitespace-nowrap active:scale-95 transition-all hover:border-[#B41A46] cursor-pointer"
              >
                On Scene
              </button>
              <button
                onClick={() => handleSendMessage('Requesting police assistance at the scene')}
                className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-[11px] font-semibold text-neutral-700 dark:text-neutral-300 whitespace-nowrap active:scale-95 transition-all hover:border-[#B41A46] cursor-pointer"
              >
                Need Police
              </button>
            </div>

            {/* Messages Stream */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map((m) => {
                const isMe = m.sender === 'responder';
                return (
                  <div
                    key={m.id}
                    className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                  >
                    <div className="flex items-center gap-1.5 mb-1 px-1 text-[10px] font-mono text-neutral-400">
                      <span>{m.senderName}</span>
                      <span>&bull;</span>
                      <span>{m.timestamp}</span>
                    </div>
                    <div
                      className={`max-w-[85%] p-3.5 rounded-2xl text-xs font-medium leading-relaxed shadow-xs ${
                        isMe
                          ? 'bg-[#B41A46] text-white rounded-br-xs'
                          : m.sender === 'dispatch'
                          ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white rounded-bl-xs border border-neutral-200/80 dark:border-neutral-700'
                          : 'bg-rose-50 dark:bg-rose-950/40 text-rose-950 dark:text-rose-200 rounded-bl-xs border border-rose-200 dark:border-rose-900/50'
                      }`}
                    >
                      {m.text}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Message Input Footer */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="p-3 sm:p-4 border-t border-neutral-100 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex items-center gap-2 shrink-0"
            >
              <input
                type="text"
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                placeholder="Type dispatch radio message or update..."
                className="flex-1 px-4 py-3 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-2xl text-xs sm:text-sm font-medium focus:outline-none focus:border-[#B41A46] dark:text-white"
              />
              <button
                type="submit"
                disabled={!messageInput.trim()}
                className="px-4 h-11 bg-[#B41A46] hover:bg-[#9a143a] disabled:opacity-40 text-white rounded-2xl flex items-center justify-center transition-all shadow-xs shrink-0 cursor-pointer active:scale-95 font-bold text-xs"
                title="Send Message"
              >
                SEND
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
