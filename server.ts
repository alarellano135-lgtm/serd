import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { createServer as createHttpServer } from "http";
import { Server } from "socket.io";
import { GoogleGenAI } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;
  
  const httpServer = createHttpServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // Initialize Gemini AI Client on the server side
  const ai = process.env.GEMINI_API_KEY
    ? new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      })
    : null;

  // Active Online Responders Registry
  interface OnlineResponder {
    id: string;
    socketId: string;
    callSign: string;
    apparatus: "ambulance" | "police" | "fire";
    status: "waiting" | "en_route" | "on_scene" | "transporting" | "offline";
    coords: [number, number];
    accuracy?: number;
    peerId?: string;
    phone?: string;
    lastSeen: number;
    isStationStandby?: boolean;
  }

  const onlineResponders: Map<string, OnlineResponder> = new Map();

  function getActiveRespondersList(): OnlineResponder[] {
    return Array.from(onlineResponders.values());
  }

  // Socket.io WebRTC signaling and call queue
  io.on("connection", (socket) => {
    // Send immediate fleet sync upon connection
    socket.emit("responders-sync", getActiveRespondersList());

    // Responder registers presence & live GPS coordinates
    socket.on("responder-presence", (data) => {
      const respId = data.id || `resp-${data.apparatus || 'unit'}`;
      const responder: OnlineResponder = {
        id: respId,
        socketId: socket.id,
        callSign: data.callSign || (data.apparatus === 'police' ? 'Patrol Cruiser' : data.apparatus === 'fire' ? 'Rescue Engine' : 'Medic Squad'),
        apparatus: data.apparatus || "ambulance",
        status: data.status || "waiting",
        coords: data.coords || [0, 0],
        accuracy: data.accuracy,
        peerId: data.peerId,
        phone: data.phone || "",
        lastSeen: Date.now()
      };
      onlineResponders.set(respId, responder);
      io.emit("responders-sync", getActiveRespondersList());
    });

    // Direct call from Citizen to Responder Mobile
    socket.on("call-responder", (data) => {
      io.emit("incoming-responder-call", {
        callId: `CALL-${Date.now()}`,
        citizenSocketId: socket.id,
        callerName: data.callerName || "Citizen Caller",
        callerLocation: data.callerLocation || "Current GPS Location",
        coords: data.coords,
        targetResponderId: data.targetResponderId,
        targetApparatus: data.targetApparatus,
        citizenPeerId: data.citizenPeerId
      });
    });

    // Responder accepts call from Citizen
    socket.on("responder-accept-call", (data) => {
      io.emit("responder-call-connected", {
        citizenSocketId: data.citizenSocketId,
        responderId: data.responderId,
        responderCallSign: data.responderCallSign,
        responderPeerId: data.responderPeerId
      });
    });

    // Responder declines call from Citizen
    socket.on("responder-decline-call", (data) => {
      io.emit("responder-call-declined", {
        citizenSocketId: data.citizenSocketId,
        responderId: data.responderId,
        reason: data.reason || "Unit currently dispatched to critical incident"
      });
    });

    // End call
    socket.on("call-ended", (data) => {
      io.emit("call-ended", data);
    });

    // Real-time two-way tactical incident messaging
    socket.on("send-incident-message", (data) => {
      if (data && data.incidentId) {
        if (!incidentMessages[data.incidentId]) incidentMessages[data.incidentId] = [];
        const msg = {
          id: data.message?.id || "msg-" + Date.now(),
          sender: data.message?.sender || "citizen",
          senderName: data.message?.senderName || "User",
          text: data.message?.text || "",
          timestamp: data.message?.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isUrgent: Boolean(data.message?.isUrgent)
        };
        incidentMessages[data.incidentId].push(msg);
        io.emit("incident-message", { incidentId: data.incidentId, message: msg });
      }
    });

    // Citizen initiates an emergency call request
    socket.on("request-call", (data) => {
      socket.broadcast.emit("incoming-call", {
        citizenId: data.citizenId,
        callerName: data.callerName || "Citizen Caller",
        location: data.location || "Unknown Location",
      });
    });

    // Responder accepts the call
    socket.on("accept-call", (data) => {
      io.emit("call-accepted", {
        citizenId: data.citizenId,
        peerId: data.responderPeerId || data.dispatcherPeerId || data.peerId,
      });
      socket.broadcast.emit("call-handled", { citizenId: data.citizenId });
    });

    socket.on("disconnect", () => {
      for (const [id, resp] of onlineResponders.entries()) {
        if (resp.socketId === socket.id) {
          onlineResponders.delete(id);
        }
      }
      io.emit("responders-sync", getActiveRespondersList());
    });
  });

  // Middlewares
  app.use(express.json());
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // Active Incidents Store
  interface Incident {
    id: string;
    code: string;
    type: string;
    priority: "critical" | "urgent" | "standard";
    location: string;
    reportedTime: string;
    patientName: string;
    recommendedUnit: string;
    distanceKm: number;
    etaMins: number;
    routeAlgorithm: string;
    status: "pending" | "dispatched" | "en_route" | "on_scene" | "cancelled";
    coords: [number, number];
    details?: string;
    createdAt: string;
  }

  const liveIncidents: Incident[] = [];

  // Incident Comms / Chat Messages Store
  const incidentMessages: Record<string, Array<{ id: string; sender: string; senderName: string; text: string; timestamp: string; isUrgent?: boolean }>> = {};

  // 1. Health Endpoint
  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      backend: "express",
      platform: "Node.js Express / Vite",
      timestamp: new Date().toISOString(),
      activeIncidents: liveIncidents.length,
      serverUptimeSec: Math.floor(process.uptime()),
      cadStatus: "ONLINE",
      geminiAiActive: Boolean(ai)
    });
  });

  // 2. Incident Management Endpoints
  app.get("/api/incidents", (req, res) => {
    res.json({
      success: true,
      count: liveIncidents.length,
      data: liveIncidents
    });
  });

  app.post("/api/incidents", (req, res) => {
    const { type, location, priority, patientName, coords, details } = req.body;
    const newId = `CAD-${Math.floor(1000 + Math.random() * 9000)}`;
    const newIncident: Incident = {
      id: newId,
      code: "10-79",
      type: type || "Emergency Dispatch Alert",
      priority: priority || "critical",
      location: location || "GPS Location Reported",
      reportedTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      patientName: patientName || "Citizen Caller",
      recommendedUnit: "Ambulance Unit",
      distanceKm: 0.8,
      etaMins: 3.0,
      routeAlgorithm: "OSRM Road Network / Dijkstra",
      status: "dispatched",
      coords: coords || [0, 0],
      details: details || "",
      createdAt: new Date().toISOString()
    };

    liveIncidents.unshift(newIncident);

    // Broadcast to active responders via WebSockets
    io.emit("incoming-call", {
      citizenId: newId,
      callerName: newIncident.patientName,
      location: newIncident.location,
      type: newIncident.type
    });

    res.status(201).json({
      success: true,
      message: "Emergency incident dispatched successfully",
      data: newIncident
    });
  });

  app.get("/api/incidents/:id", (req, res) => {
    const item = liveIncidents.find(i => i.id === req.params.id);
    if (!item) {
      res.status(404).json({ success: false, message: "Incident not found" });
      return;
    }
    res.json({ success: true, data: item });
  });

  app.patch("/api/incidents/:id/status", (req, res) => {
    const { status } = req.body;
    const item = liveIncidents.find(i => i.id === req.params.id);
    if (!item) {
      res.status(404).json({ success: false, message: "Incident not found" });
      return;
    }
    if (status) {
      item.status = status;
      io.emit("incident-updated", item);
    }
    res.json({ success: true, data: item });
  });

  // Incident Comms / Chat Messages Store
  app.get("/api/incidents/:id/messages", (req, res) => {
    const list = incidentMessages[req.params.id] || [];
    res.json({ success: true, data: list });
  });

  app.post("/api/incidents/:id/messages", (req, res) => {
    const { sender, senderName, text, isUrgent } = req.body;
    if (!incidentMessages[req.params.id]) {
      incidentMessages[req.params.id] = [];
    }
    const newMsg = {
      id: "msg-" + Date.now(),
      sender: sender || "responder",
      senderName: senderName || "Responder",
      text: text || "",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isUrgent: Boolean(isUrgent)
    };
    incidentMessages[req.params.id].push(newMsg);
    io.emit("incident-message", { incidentId: req.params.id, message: newMsg });
    res.status(201).json({ success: true, data: newMsg });
  });

  // 3. Real Server-Side Gemini AI Chat & Emergency Triage Assistant
  app.post("/api/chat", async (req, res) => {
    const { messages, context } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ success: false, error: "Messages array is required." });
      return;
    }

    if (!ai) {
      res.status(503).json({
        success: false,
        error: "Gemini AI service is initializing or API key is not configured.",
        text: "I am ready to assist you. If you are experiencing a life-threatening medical emergency, active fire, or violent crime, please immediately trigger the red Emergency SOS button on the home screen."
      });
      return;
    }

    try {
      const userContextSnippet = context ? `
User Context:
- Caller Name: ${context.callerName || "Unknown"}
- Address / Location: ${context.location || "Not specified"}
- Blood Type: ${context.bloodType || "Unknown"}
- Allergies: ${Array.isArray(context.allergies) ? context.allergies.join(", ") : "None reported"}
` : "";

      const systemInstruction = `You are SERD AI, the Smart Emergency Response Dispatch Assistant.
Your core mission is to rapidly triage emergencies, assist citizens in distress, give life-saving first-aid guidelines, and determine if an emergency dispatch is needed.

Guidelines:
1. Prioritize immediate safety and life preservation.
2. If there are signs of severe danger (chest pain, airway obstruction, severe bleeding, unconsciousness, active fire, violent intruder), urge immediate dispatch and provide step-by-step first-aid while help is on the way.
3. Keep responses concise, calm, actionable, and clear. Avoid fluff.
4. When you assess that dispatch is necessary, append a structured dispatch tag at the very end of your response on its own line:
   - [ACTION: Dispatch Ambulance] for medical crises
   - [ACTION: Dispatch Police] for crime, violence, or security threats
   - [ACTION: Dispatch Fire & Rescue] for smoke, fire, entrapment, or hazmat
   - [ACTION: Call 911 Hotlines] for general emergency contact
${userContextSnippet}`;

      // Convert message history to format expected by @google/genai
      const contents = messages.map((m: any) => ({
        role: m.role === 'bot' || m.role === 'model' || m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.text }]
      }));

      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents,
        config: {
          systemInstruction,
          temperature: 0.4,
          maxOutputTokens: 800
        }
      });

      const replyText = response.text || "I have received your situation details. Please remain safe and confirm if you require emergency units dispatched.";

      res.json({
        success: true,
        text: replyText
      });
    } catch (err: any) {
      console.error("[Gemini API] Chat triage error:", err);
      res.status(500).json({
        success: false,
        error: err.message || "Failed to generate AI triage response.",
        text: "I am experiencing high network load. If you are in immediate danger, please press the emergency SOS button on the home screen immediately."
      });
    }
  });



  // 5. Real-time Emergency Units Telemetry & Online Responders
  app.get("/api/responders/online", (_req, res) => {
    const list = getActiveRespondersList();
    res.json({
      success: true,
      count: list.length,
      data: list
    });
  });

  app.post("/api/responders/presence", (req, res) => {
    const data = req.body;
    const respId = data.id || `resp-${data.apparatus || 'unit'}`;
    const responder: OnlineResponder = {
      id: respId,
      socketId: data.socketId || 'http-client',
      callSign: data.callSign || (data.apparatus === 'police' ? 'Patrol Cruiser' : data.apparatus === 'fire' ? 'Rescue Engine' : 'Medic Squad'),
      apparatus: data.apparatus || 'ambulance',
      status: data.status || 'waiting',
      coords: data.coords || [0, 0],
      accuracy: data.accuracy,
      peerId: data.peerId,
      phone: data.phone || '',
      lastSeen: Date.now()
    };
    onlineResponders.set(respId, responder);
    io.emit("responders-sync", getActiveRespondersList());
    res.json({ success: true, data: responder });
  });

  app.get("/api/telemetry/units", (req, res) => {
    const units = getActiveRespondersList().map(r => ({
      id: r.id,
      name: r.callSign,
      type: r.apparatus,
      status: r.status,
      coords: r.coords,
      isStandby: Boolean(r.isStationStandby)
    }));
    res.json({
      success: true,
      units
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
