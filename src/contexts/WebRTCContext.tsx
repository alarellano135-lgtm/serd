import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import Peer, { MediaConnection } from 'peerjs';

export interface IncomingCallData {
  callId: string;
  citizenSocketId: string;
  callerName: string;
  callerLocation: string;
  coords?: [number, number];
  citizenPeerId?: string;
  targetResponderId?: string;
}

interface WebRTCContextType {
  socket: Socket | null;
  peerId: string;
  isCalling: boolean;
  isConnected: boolean;
  incomingCall: IncomingCallData | null;
  callDurationSec: number;
  isMuted: boolean;
  remoteStream: MediaStream | null;
  localStream: MediaStream | null;
  micError: string | null;
  startCallToResponder: (params: {
    targetResponderId: string;
    targetApparatus: string;
    callerName: string;
    callerLocation: string;
    coords: [number, number];
  }) => Promise<void>;
  acceptIncomingCall: () => Promise<void>;
  declineIncomingCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
}

const WebRTCContext = createContext<WebRTCContextType | null>(null);

export function WebRTCProvider({ children }: { children: React.ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [peer, setPeer] = useState<Peer | null>(null);
  const [peerId, setPeerId] = useState<string>('');
  
  const [isCalling, setIsCalling] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [incomingCall, setIncomingCall] = useState<IncomingCallData | null>(null);
  const [callDurationSec, setCallDurationSec] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);

  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const currentCallRef = useRef<MediaConnection | null>(null);
  const peerIdRef = useRef<string>('');
  const incomingCallRef = useRef<IncomingCallData | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  // Initialize Socket and PeerJS
  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    // Initialize WebRTC Peer with auto fallback
    const newPeer = new Peer();
    newPeer.on('open', (id) => {
      setPeerId(id);
      peerIdRef.current = id;
      console.log('[WebRTC] Peer initialized with ID:', id);
    });

    newPeer.on('error', (err) => {
      console.warn('[WebRTC Peer Error]:', err.type, err.message);
    });

    setPeer(newPeer);

    return () => {
      newSocket.disconnect();
      newPeer.destroy();
    };
  }, []);

  // Listen to incoming Peer calls
  useEffect(() => {
    if (!peer) return;

    peer.on('call', async (call) => {
      console.log('[WebRTC] Received incoming Peer call from:', call.peer);
      currentCallRef.current = call;

      try {
        let stream = localStreamRef.current;
        if (!stream) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            localStreamRef.current = stream;
            setLocalStream(stream);
          } catch (e) {
            console.warn('[WebRTC] Answering without local mic:', e);
          }
        }

        if (stream) {
          call.answer(stream);
        } else {
          // Answer without local audio track if mic permission denied
          call.answer();
        }

        setIsConnected(true);
        setIsCalling(false);

        call.on('stream', (remote) => {
          console.log('[WebRTC] Remote audio stream received');
          setRemoteStream(remote);
          if (audioElRef.current) {
            audioElRef.current.srcObject = remote;
            audioElRef.current.play().catch(() => {});
          }
        });

        call.on('close', () => {
          endCall();
        });
      } catch (err: any) {
        console.warn('[WebRTC] Failed to answer peer call:', err);
      }
    });

    return () => {
      peer.off('call');
    };
  }, [peer]);

  // Listen to Socket.io signaling events
  useEffect(() => {
    if (!socket) return;

    // Direct call incoming on Responder Mobile
    socket.on('incoming-responder-call', (data: IncomingCallData) => {
      console.log('[Signaling] Incoming direct call from citizen:', data);
      incomingCallRef.current = data;
      setIncomingCall(data);
    });

    // Call connected confirmation
    socket.on('responder-call-connected', (data: any) => {
      console.log('[Signaling] Responder accepted call, establishing WebRTC connection:', data);
      setIsConnected(true);
      setIsCalling(false);

      // If responder provided peerId, initiate call from citizen if not already connected
      if (data.responderPeerId && peer && localStreamRef.current && !currentCallRef.current) {
        try {
          const call = peer.call(data.responderPeerId, localStreamRef.current);
          currentCallRef.current = call;

          call.on('stream', (remote) => {
            setRemoteStream(remote);
            if (audioElRef.current) {
              audioElRef.current.srcObject = remote;
              audioElRef.current.play().catch(() => {});
            }
          });

          call.on('close', () => {
            endCall();
          });
        } catch (e) {
          console.warn('[WebRTC] Failed to connect to responder peer:', e);
        }
      }
    });

    // Call declined notification
    socket.on('responder-call-declined', () => {
      endCall();
    });

    // Call ended by other party
    socket.on('call-ended', () => {
      endCall();
    });

    return () => {
      socket.off('incoming-responder-call');
      socket.off('responder-call-connected');
      socket.off('responder-call-declined');
      socket.off('call-ended');
    };
  }, [socket, peer]);

  // Call duration counter
  useEffect(() => {
    if (!isConnected) return;
    const interval = setInterval(() => {
      setCallDurationSec(s => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isConnected]);

  // 1. Citizen initiates direct call to Responder Mobile
  const startCallToResponder = async (params: {
    targetResponderId: string;
    targetApparatus: string;
    callerName: string;
    callerLocation: string;
    coords: [number, number];
  }) => {
    setMicError(null);
    setIsCalling(true);
    setCallDurationSec(0);

    let stream: MediaStream | null = null;
    try {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        localStreamRef.current = stream;
        setLocalStream(stream);
      }
    } catch (err: any) {
      console.warn('[WebRTC] Mic capture permission denied or unavailable:', err.message);
      setMicError('Microphone permission not granted. Emergency channel connected in dispatch radio mode.');
    }

    if (socket) {
      socket.emit('call-responder', {
        ...params,
        citizenPeerId: peerIdRef.current
      });
    }
  };

  // 2. Responder accepts incoming direct call
  const acceptIncomingCall = async () => {
    const callData = incomingCallRef.current || incomingCall;
    if (!callData) return;

    setIncomingCall(null);
    setIsConnected(true);
    setCallDurationSec(0);

    let stream: MediaStream | null = null;
    try {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        localStreamRef.current = stream;
        setLocalStream(stream);
      }
    } catch (err: any) {
      console.warn('[WebRTC] Responder mic permission notice:', err.message);
    }

    // Connect to citizen's peer if available
    if (callData.citizenPeerId && peer && stream) {
      try {
        const mediaCall = peer.call(callData.citizenPeerId, stream);
        currentCallRef.current = mediaCall;

        mediaCall.on('stream', (remote) => {
          setRemoteStream(remote);
          if (audioElRef.current) {
            audioElRef.current.srcObject = remote;
            audioElRef.current.play().catch(() => {});
          }
        });

        mediaCall.on('close', () => {
          endCall();
        });
      } catch (e) {
        console.warn('[WebRTC] Peer call setup notice:', e);
      }
    }

    if (socket) {
      socket.emit('responder-accept-call', {
        citizenSocketId: callData.citizenSocketId,
        responderId: callData.targetResponderId || 'unit',
        responderPeerId: peerIdRef.current
      });
    }
  };

  // 3. Responder declines incoming call
  const declineIncomingCall = () => {
    const callData = incomingCallRef.current || incomingCall;
    if (socket && callData) {
      socket.emit('responder-decline-call', {
        citizenSocketId: callData.citizenSocketId,
        reason: 'Unit busy'
      });
    }
    setIncomingCall(null);
    setIsCalling(false);
  };

  // 4. End active call
  const endCall = () => {
    if (currentCallRef.current) {
      try { currentCallRef.current.close(); } catch {}
      currentCallRef.current = null;
    }

    if (localStreamRef.current) {
      try {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      } catch {}
      localStreamRef.current = null;
      setLocalStream(null);
    }

    if (audioElRef.current) {
      audioElRef.current.srcObject = null;
    }

    if (socket) {
      socket.emit('call-ended', {});
    }

    setIsCalling(false);
    setIsConnected(false);
    setIncomingCall(null);
    setRemoteStream(null);
    setCallDurationSec(0);
    setIsMuted(false);
  };

  // 5. Toggle microphone mute
  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      const nextMuted = !isMuted;
      audioTracks.forEach(track => {
        track.enabled = !nextMuted;
      });
      setIsMuted(nextMuted);
    } else {
      setIsMuted(!isMuted);
    }
  };

  return (
    <WebRTCContext.Provider
      value={{
        socket,
        peerId,
        isCalling,
        isConnected,
        incomingCall,
        callDurationSec,
        isMuted,
        remoteStream,
        localStream,
        micError,
        startCallToResponder,
        acceptIncomingCall,
        declineIncomingCall,
        endCall,
        toggleMute
      }}
    >
      {children}
      {/* Hidden audio element for real-time live speaker audio playback */}
      <audio 
        ref={audioElRef} 
        autoPlay 
        playsInline 
        style={{ display: 'none' }} 
      />
    </WebRTCContext.Provider>
  );
}

export function useWebRTC() {
  const context = useContext(WebRTCContext);
  if (!context) {
    throw new Error('useWebRTC must be used within a WebRTCProvider');
  }
  return context;
}
