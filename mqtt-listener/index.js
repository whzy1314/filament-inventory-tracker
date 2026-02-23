const mqtt = require('mqtt');
const axios = require('axios');
const http = require('http');

// ==================== Configuration ====================
const config = {
  printer: {
    ip: process.env.PRINTER_IP || '192.168.20.70',
    serial: process.env.PRINTER_SERIAL || '01P09C532200119',
    accessCode: process.env.PRINTER_ACCESS_CODE || '27410960',
  },
  tracker: {
    apiUrl: process.env.TRACKER_API_URL || 'https://filament-tracker.yzcloud.xyz',
    apiKey: process.env.TRACKER_API_KEY || '',
  },
  healthPort: parseInt(process.env.HEALTH_PORT, 10) || 3001,
};

const MQTT_TOPIC = `device/${config.printer.serial}/report`;

// ==================== Print State Tracker ====================
const printState = {
  gcodeState: 'IDLE',
  previousGcodeState: 'IDLE',
  printRunning: false,
  // Track per-tray usage during a print
  traysAtStart: {},   // { trayIndex: { remain, tray_weight, brand, type, color } }
  activeTraysDuringPrint: new Set(),
  currentTrayIndex: null,
  printStartTime: null,
};

// ==================== Logging ====================
function log(level, msg, data) {
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level.toUpperCase()}]`;
  if (data !== undefined) {
    console.log(`${prefix} ${msg}`, typeof data === 'object' ? JSON.stringify(data) : data);
  } else {
    console.log(`${prefix} ${msg}`);
  }
}

// ==================== AMS Tray Helpers ====================
function parseTrayInfo(tray, trayIndex) {
  if (!tray) return null;
  return {
    trayIndex,
    type: tray.tray_type || 'Unknown',
    brand: tray.tray_sub_brands || 'Unknown',
    color: tray.tray_color || 'Unknown',
    weight: typeof tray.tray_weight === 'number' ? tray.tray_weight : null,
    remain: typeof tray.remain === 'number' ? tray.remain : null,
  };
}

function snapshotTrays(amsData) {
  const snapshot = {};
  if (amsData && Array.isArray(amsData.ams) && amsData.ams[0] && Array.isArray(amsData.ams[0].tray)) {
    amsData.ams[0].tray.forEach((tray, i) => {
      const info = parseTrayInfo(tray, i);
      if (info) {
        snapshot[i] = info;
      }
    });
  }
  return snapshot;
}

// Map hex color code to a human-readable color name
function hexToColorName(hex) {
  if (!hex || hex === 'Unknown') return 'Unknown';
  // Return the hex code as-is — the tracker can match on it
  return hex;
}

// ==================== Filament Usage Calculation ====================
function calculateUsage(startTrays, endTrays, activeTrays) {
  const usageList = [];

  for (const trayIdx of activeTrays) {
    const start = startTrays[trayIdx];
    const end = endTrays[trayIdx];

    if (!start || !end) {
      log('warn', `Missing tray data for tray ${trayIdx}, skipping`);
      continue;
    }

    let gramsUsed = 0;
    let method = 'unknown';

    // Method A: Weight delta from AMS RFID data
    if (start.weight !== null && end.weight !== null && start.weight > end.weight) {
      gramsUsed = start.weight - end.weight;
      method = 'weight_delta';
    }
    // Method B: Percentage-based estimation (assume standard 1000g spool)
    else if (start.remain !== null && end.remain !== null && start.remain > end.remain) {
      const spoolWeight = start.weight || 1000;
      const percentUsed = start.remain - end.remain;
      gramsUsed = Math.round((percentUsed / 100) * spoolWeight);
      method = 'percent_delta';
    }

    if (gramsUsed > 0) {
      usageList.push({
        trayIndex: trayIdx,
        brand: start.brand,
        type: start.type,
        color: hexToColorName(start.color),
        grams_used: gramsUsed,
        method,
      });
      log('info', `Tray ${trayIdx}: ${gramsUsed}g used (${method}) - ${start.brand} ${start.type} ${start.color}`);
    } else {
      log('info', `Tray ${trayIdx}: No measurable usage detected`);
    }
  }

  return usageList;
}

// ==================== API Calls ====================
async function deductFilament(usage) {
  const url = `${config.tracker.apiUrl}/api/filaments/deduct`;

  try {
    const response = await axios.post(url, {
      brand: usage.brand,
      type: usage.type,
      color: usage.color,
      grams_used: usage.grams_used,
    }, {
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.tracker.apiKey,
      },
      timeout: 10000,
    });

    log('info', `Deduction successful for tray ${usage.trayIndex}:`, response.data);
    return { success: true, data: response.data };
  } catch (err) {
    const status = err.response ? err.response.status : 'network_error';
    const detail = err.response ? err.response.data : err.message;
    log('error', `Deduction failed for tray ${usage.trayIndex} (HTTP ${status}):`, detail);
    return { success: false, error: detail };
  }
}

// ==================== Print Completion Handler ====================
async function handlePrintEnd(finalState, amsData) {
  log('info', `Print ${finalState === 'FINISH' ? 'completed' : 'failed/cancelled'} — processing filament usage`);

  const endTrays = snapshotTrays(amsData);
  const usageList = calculateUsage(printState.traysAtStart, endTrays, printState.activeTraysDuringPrint);

  if (usageList.length === 0) {
    log('warn', 'No filament usage detected for this print');
    return;
  }

  log('info', `Processing ${usageList.length} filament deduction(s)`);

  for (const usage of usageList) {
    await deductFilament(usage);
  }

  log('info', 'Print filament deductions complete');
}

// ==================== MQTT Message Handler ====================
function handleMessage(topic, messageBuffer) {
  let data;
  try {
    data = JSON.parse(messageBuffer.toString());
  } catch (e) {
    return; // Ignore non-JSON messages
  }

  if (!data.print) return;

  const print = data.print;
  const gcodeState = print.gcode_state;
  const progress = print.mc_percent;

  // Track active tray
  if (print.ams && typeof print.ams.tray_now !== 'undefined') {
    const trayNow = parseInt(print.ams.tray_now, 10);
    if (trayNow >= 0 && trayNow <= 3) {
      if (printState.currentTrayIndex !== trayNow) {
        log('info', `Active tray changed: ${printState.currentTrayIndex} -> ${trayNow}`);
        printState.currentTrayIndex = trayNow;
      }
      if (printState.printRunning) {
        printState.activeTraysDuringPrint.add(trayNow);
      }
    }
  }

  // State transitions
  if (gcodeState && gcodeState !== printState.gcodeState) {
    log('info', `Print state: ${printState.gcodeState} -> ${gcodeState}`);
    printState.previousGcodeState = printState.gcodeState;
    printState.gcodeState = gcodeState;

    // Print started
    if ((gcodeState === 'RUNNING' || gcodeState === 'PREPARE') && !printState.printRunning) {
      printState.printRunning = true;
      printState.printStartTime = new Date();
      printState.activeTraysDuringPrint = new Set();

      // Snapshot tray state at print start
      if (print.ams) {
        printState.traysAtStart = snapshotTrays(print.ams);
        log('info', 'Print started — captured AMS tray snapshot:', printState.traysAtStart);

        // Record current active tray
        const trayNow = parseInt(print.ams.tray_now, 10);
        if (trayNow >= 0 && trayNow <= 3) {
          printState.activeTraysDuringPrint.add(trayNow);
          printState.currentTrayIndex = trayNow;
        }
      } else {
        printState.traysAtStart = {};
        log('info', 'Print started — no AMS data available');
      }
    }

    // Print finished or failed
    if ((gcodeState === 'FINISH' || gcodeState === 'FAILED') && printState.printRunning) {
      printState.printRunning = false;
      const duration = printState.printStartTime
        ? Math.round((Date.now() - printState.printStartTime.getTime()) / 1000 / 60)
        : 0;
      log('info', `Print ${gcodeState.toLowerCase()} after ~${duration} minutes`);

      handlePrintEnd(gcodeState, print.ams).catch(err => {
        log('error', 'Error handling print end:', err.message);
      });
    }
  }

  // Progress milestones (log every 25%)
  if (typeof progress === 'number' && printState.printRunning) {
    if (progress > 0 && progress % 25 === 0) {
      // Only log once per milestone by checking if we haven't already
      const milestoneKey = `_milestone_${progress}`;
      if (!printState[milestoneKey]) {
        printState[milestoneKey] = true;
        log('info', `Print progress: ${progress}%`);
      }
    }
    // Reset milestones on new print
    if (progress === 0) {
      for (const key of Object.keys(printState)) {
        if (key.startsWith('_milestone_')) delete printState[key];
      }
    }
  }
}

// ==================== MQTT Connection ====================
function connectMqtt() {
  const brokerUrl = `mqtts://${config.printer.ip}:8883`;

  log('info', `Connecting to MQTT broker at ${brokerUrl}`);

  const client = mqtt.connect(brokerUrl, {
    username: 'bblp',
    password: config.printer.accessCode,
    rejectUnauthorized: false,
    reconnectPeriod: 5000,
    connectTimeout: 30000,
  });

  let reconnectAttempts = 0;
  const MAX_RECONNECT_DELAY = 60000;

  client.on('connect', () => {
    reconnectAttempts = 0;
    log('info', 'Connected to MQTT broker');

    client.subscribe(MQTT_TOPIC, { qos: 0 }, (err) => {
      if (err) {
        log('error', 'Failed to subscribe to topic:', err.message);
      } else {
        log('info', `Subscribed to topic: ${MQTT_TOPIC}`);
      }
    });
  });

  client.on('message', (topic, message) => {
    try {
      handleMessage(topic, message);
    } catch (err) {
      log('error', 'Error processing MQTT message:', err.message);
    }
  });

  client.on('error', (err) => {
    log('error', 'MQTT error:', err.message);
  });

  client.on('close', () => {
    log('warn', 'MQTT connection closed');
  });

  client.on('reconnect', () => {
    reconnectAttempts++;
    const delay = Math.min(5000 * Math.pow(2, reconnectAttempts - 1), MAX_RECONNECT_DELAY);
    log('info', `Reconnecting to MQTT (attempt ${reconnectAttempts}, next delay ~${Math.round(delay / 1000)}s)`);
  });

  client.on('offline', () => {
    log('warn', 'MQTT client offline');
  });

  return client;
}

// ==================== Health Check Server ====================
function startHealthServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        printState: printState.gcodeState,
        printRunning: printState.printRunning,
        timestamp: new Date().toISOString(),
      }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(config.healthPort, () => {
    log('info', `Health check server running on port ${config.healthPort}`);
  });

  return server;
}

// ==================== Main ====================
function main() {
  log('info', '=== Bambu Lab P1S MQTT Listener Starting ===');
  log('info', `Printer: ${config.printer.ip} (serial: ${config.printer.serial})`);
  log('info', `Tracker API: ${config.tracker.apiUrl}`);
  log('info', `API Key configured: ${config.tracker.apiKey ? 'yes' : 'NO — deductions will fail!'}`);

  startHealthServer();
  const client = connectMqtt();

  // Graceful shutdown
  const shutdown = (signal) => {
    log('info', `Received ${signal}, shutting down...`);
    client.end(true, () => {
      log('info', 'MQTT disconnected');
      process.exit(0);
    });
    // Force exit after 5s
    setTimeout(() => process.exit(0), 5000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
