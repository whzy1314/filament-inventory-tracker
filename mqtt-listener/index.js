const mqtt = require('mqtt');
const axios = require('axios');
const http = require('http');

// ==================== Configuration ====================
const config = {
  printer: {
    ip: process.env.PRINTER_IP || '192.168.10.115',
    serial: process.env.PRINTER_SERIAL || '01P09C532200119',
    accessCode: process.env.PRINTER_ACCESS_CODE || '',
  },
  cloud: {
    enabled: process.env.CLOUD_MQTT_ENABLED === 'true',
    server: process.env.CLOUD_MQTT_SERVER || 'us.mqtt.bambulab.com',
    uid: process.env.CLOUD_MQTT_UID || '',
    token: process.env.CLOUD_MQTT_TOKEN || '',
  },
  tracker: {
    apiUrl: process.env.TRACKER_API_URL || 'https://filament-tracker.yzcloud.xyz',
    apiKey: process.env.TRACKER_API_KEY || '',
  },
  healthPort: parseInt(process.env.HEALTH_PORT, 10) || 3001,
};

const MQTT_TOPIC = `device/${config.printer.serial}/report`;
const BAMBU_API_BASE = 'https://api.bambulab.com';

// ==================== Bambu → Inventory Mapping ====================
// Bambu reports brand as the filament sub-type (e.g., "PLA Matte", "PLA Basic")
// Your inventory uses "Bambu Lab" as brand and the sub-type as the type field
// This mapping converts Bambu's naming to your inventory's naming

// Map Bambu "tray_sub_brands" + "tray_type" → inventory brand + type
function mapFilamentType(bambuBrand, bambuType) {
  // Bambu brand field contains sub-brand like "PLA Matte", "PLA Basic", "PETG HF"
  // Your inventory: brand is always "Bambu Lab", type is the sub-brand or filament type

  const brand = 'Bambu Lab'; // All Bambu filaments → "Bambu Lab" in your inventory

  // If bambuBrand contains meaningful sub-type info, use it as the type
  // e.g., "PLA Matte" → type "PLA Matte", "PLA Basic" → type "PLA", "PETG HF" → type "PETG"
  let type = bambuBrand || bambuType || 'Unknown';

  // Normalize: "PLA Basic" → "PLA" (your inventory uses "PLA" for basic PLA)
  if (type === 'PLA Basic') type = 'PLA';

  return { brand, type };
}

// Bambu hex color codes → your inventory color names
const BAMBU_COLOR_MAP = {
  // PLA Matte colors
  '000000FF': 'Charcoal',
  'FFFFFFFF': 'Ivory White',
  '9B9EA0FF': 'Ash Gray',
  'F5A623FF': 'Mandarin Orange',
  'D4A373FF': 'Desert Tan',
  'C74C3CFF': 'Scarlet Red',
  'E74C3CFF': 'Scarlet Red',
  '2E86C1FF': 'Marine Blue',
  '27AE60FF': 'Grass Green',
  'F1C40FFF': 'Lemon Yellow',
  '8E44ADFF': 'Lilac Purple',
  'FFB7C5FF': 'Sakura Pink',
  'C0392BFF': 'Terracotta',
  '7FB069FF': 'Apple Green',
  // PLA Basic colors
  '00FF00FF': 'Green',
  'FF0000FF': 'Red',
  '0000FFFF': 'Blue',
  'FFFF00FF': 'Yellow',
  '808080FF': 'Gray',
  'FFA500FF': 'Orange',
  '800080FF': 'Purple',
  '00FFFFFF': 'Cyan',
  'A52A2AFF': 'Brown',
  'F5F5DCFF': 'Beige',
};

function mapColor(hexColor, type) {
  if (!hexColor || hexColor === 'Unknown') return 'Unknown';

  // Direct lookup
  const upperHex = hexColor.toUpperCase();
  if (BAMBU_COLOR_MAP[upperHex]) {
    return BAMBU_COLOR_MAP[upperHex];
  }

  // For white: different types use different names
  if (upperHex === 'FFFFFFFF') {
    if (type === 'PLA Matte') return 'Ivory White';
    if (type === 'PLA') return 'White';
    return 'White';
  }

  // For black
  if (upperHex === '000000FF') {
    if (type === 'PLA Matte') return 'Charcoal';
    return 'Black';
  }

  // Fallback: return hex as-is (won't match but will log clearly)
  return hexColor;
}

// ==================== Print State Tracker ====================
const printState = {
  gcodeState: 'IDLE',
  previousGcodeState: 'IDLE',
  printRunning: false,
  activeTraysDuringPrint: new Set(),
  currentTrayIndex: null,
  printStartTime: null,
  // AMS tray info (for filament identification fallback)
  traysAtStart: {},
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

// ==================== Bambu Cloud API ====================
async function fetchLatestTask() {
  if (!config.cloud.token) {
    log('warn', 'No cloud token configured — cannot fetch task data from Bambu API');
    return null;
  }

  try {
    const url = `${BAMBU_API_BASE}/v1/user-service/my/tasks?deviceId=${config.printer.serial}&limit=1`;
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${config.cloud.token}`,
      },
      timeout: 15000,
    });

    const tasks = response.data;
    if (tasks && tasks.hits && tasks.hits.length > 0) {
      return tasks.hits[0];
    }

    log('warn', 'No tasks found in Bambu Cloud API');
    return null;
  } catch (err) {
    const status = err.response ? err.response.status : 'network_error';
    log('error', `Failed to fetch task from Bambu Cloud API (HTTP ${status}):`, err.message);
    return null;
  }
}

// ==================== Tracker API Calls ====================
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

    log('info', `✅ Deduction successful: ${usage.grams_used}g of ${usage.brand} ${usage.type} (${usage.color})`, response.data);
    return { success: true, data: response.data };
  } catch (err) {
    const status = err.response ? err.response.status : 'network_error';
    const detail = err.response ? err.response.data : err.message;
    log('error', `❌ Deduction failed (HTTP ${status}):`, detail);
    return { success: false, error: detail };
  }
}

// ==================== Print Completion Handler ====================
async function handlePrintEnd(finalState) {
  log('info', `Print ${finalState === 'FINISH' ? 'completed' : 'failed/cancelled'} — fetching usage from Bambu Cloud API`);

  // Wait a few seconds for Bambu cloud to register the completed task
  await new Promise(resolve => setTimeout(resolve, 5000));

  const task = await fetchLatestTask();

  if (!task) {
    log('error', 'Could not fetch task data — skipping deduction');
    return;
  }

  log('info', `Task: "${task.designTitle || task.title}" — status: ${task.status}, total weight: ${task.weight}g`);

  // Status: 2 = completed, 3 = failed
  if (finalState === 'FAILED' && task.status !== 3) {
    log('warn', 'Print failed but task status does not match — using slicer estimate scaled by progress');
  }

  // Parse amsDetailMapping for per-tray filament usage
  const amsMapping = task.amsDetailMapping;
  if (!amsMapping || amsMapping.length === 0) {
    log('warn', 'No AMS detail mapping in task — attempting single deduction with total weight');

    // Fallback: use total weight with tray info from MQTT
    if (task.weight > 0 && printState.activeTraysDuringPrint.size > 0) {
      const trayIdx = [...printState.activeTraysDuringPrint][0];
      const tray = printState.traysAtStart[trayIdx];
      if (tray) {
        let gramsUsed = task.weight;
        if (finalState === 'FAILED' && task.status === 3) {
          const progress = printState.lastProgress || 0;
          gramsUsed = Math.round(task.weight * (progress / 100) * 100) / 100;
          log('info', `Failed print — scaling weight by ${progress}%: ${gramsUsed}g`);
        }
        const { brand, type } = mapFilamentType(tray.brand, tray.type);
        const color = mapColor(tray.color, type);
        await deductFilament({
          brand,
          type,
          color,
          grams_used: gramsUsed,
          trayIndex: trayIdx,
        });
      }
    }
    return;
  }

  // Process each filament used in the print (supports multi-color)
  log('info', `Processing ${amsMapping.length} filament(s) from slicer data`);

  for (const mapping of amsMapping) {
    let gramsUsed = mapping.weight;

    // For failed prints, scale by last known progress
    if (finalState === 'FAILED') {
      const progress = printState.lastProgress || 0;
      gramsUsed = Math.round(mapping.weight * (progress / 100) * 100) / 100;
      log('info', `Failed print — scaling ${mapping.filamentType} weight by ${progress}%: ${gramsUsed}g`);
    }

    if (gramsUsed <= 0) {
      log('info', `Skipping ${mapping.filamentType} — 0g used`);
      continue;
    }

    // Get filament info from AMS tray data (MQTT) for brand matching
    // amsMapping.ams is 1-indexed tray number, our traysAtStart is 0-indexed
    const trayIdx = (mapping.ams || 1) - 1;
    const tray = printState.traysAtStart[trayIdx];

    // Map Bambu naming → your inventory naming
    const bambuBrand = tray ? tray.brand : mapping.filamentType;
    const bambuType = mapping.filamentType || (tray ? tray.type : 'Unknown');
    const bambuColor = mapping.sourceColor || (tray ? tray.color : 'Unknown');

    const { brand, type } = mapFilamentType(bambuBrand, bambuType);
    const color = mapColor(bambuColor, type);

    const usage = {
      brand,
      type,
      color,
      grams_used: gramsUsed,
      trayIndex: trayIdx,
    };

    log('info', `Tray ${trayIdx} (A${trayIdx + 1}): ${gramsUsed}g ${usage.type} (${usage.brand}) — source: slicer estimate`);
    await deductFilament(usage);
  }

  log('info', 'Print filament deductions complete ✅');
}

// ==================== MQTT Message Handler ====================
function handleMessage(topic, messageBuffer) {
  let data;
  try {
    data = JSON.parse(messageBuffer.toString());
  } catch (e) {
    return;
  }

  if (!data.print) return;

  const print = data.print;
  const gcodeState = print.gcode_state;
  const progress = print.mc_percent;

  // Track progress for failed print scaling
  if (typeof progress === 'number') {
    printState.lastProgress = progress;
  }

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

  // Capture/update AMS tray info whenever available during a print
  if (printState.printRunning && print.ams) {
    const snapshot = snapshotTrays(print.ams);
    if (Object.keys(snapshot).length > 0 && Object.keys(printState.traysAtStart).length === 0) {
      printState.traysAtStart = snapshot;
      log('info', 'AMS tray snapshot captured:', snapshot);

      if (print.ams.tray_now !== undefined) {
        const trayNow = parseInt(print.ams.tray_now, 10);
        if (trayNow >= 0 && trayNow <= 3) {
          printState.activeTraysDuringPrint.add(trayNow);
        }
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
      printState.lastProgress = 0;

      if (print.ams) {
        printState.traysAtStart = snapshotTrays(print.ams);
        log('info', 'Print started — captured AMS tray snapshot:', printState.traysAtStart);

        const trayNow = parseInt(print.ams.tray_now, 10);
        if (trayNow >= 0 && trayNow <= 3) {
          printState.activeTraysDuringPrint.add(trayNow);
          printState.currentTrayIndex = trayNow;
        }
      } else {
        printState.traysAtStart = {};
        log('info', 'Print started — AMS data will be captured from next message');
      }
    }

    // Print finished or failed
    if ((gcodeState === 'FINISH' || gcodeState === 'FAILED') && printState.printRunning) {
      printState.printRunning = false;
      const duration = printState.printStartTime
        ? Math.round((Date.now() - printState.printStartTime.getTime()) / 1000 / 60)
        : 0;
      log('info', `Print ${gcodeState.toLowerCase()} after ~${duration} minutes`);

      handlePrintEnd(gcodeState).catch(err => {
        log('error', 'Error handling print end:', err.message);
      });
    }
  }

  // Progress milestones (log every 25%)
  if (typeof progress === 'number' && printState.printRunning) {
    if (progress > 0 && progress % 25 === 0) {
      const milestoneKey = `_milestone_${progress}`;
      if (!printState[milestoneKey]) {
        printState[milestoneKey] = true;
        log('info', `Print progress: ${progress}%`);
      }
    }
    if (progress === 0) {
      for (const key of Object.keys(printState)) {
        if (key.startsWith('_milestone_')) delete printState[key];
      }
    }
  }
}

// ==================== MQTT Connection ====================
function connectMqtt() {
  let brokerUrl, mqttUsername, mqttPassword;

  if (config.cloud.enabled && config.cloud.uid && config.cloud.token) {
    brokerUrl = `mqtts://${config.cloud.server}:8883`;
    mqttUsername = `u_${config.cloud.uid}`;
    mqttPassword = config.cloud.token;
    log('info', `Connecting to CLOUD MQTT broker at ${brokerUrl} (user: ${mqttUsername})`);
  } else {
    brokerUrl = `mqtts://${config.printer.ip}:8883`;
    mqttUsername = 'bblp';
    mqttPassword = config.printer.accessCode;
    log('info', `Connecting to LOCAL MQTT broker at ${brokerUrl}`);
  }

  const client = mqtt.connect(brokerUrl, {
    username: mqttUsername,
    password: mqttPassword,
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
  log('info', `Printer serial: ${config.printer.serial}`);
  log('info', `MQTT mode: ${config.cloud.enabled ? 'CLOUD' : 'LOCAL'} (${config.cloud.enabled ? config.cloud.server : config.printer.ip})`);
  log('info', `Tracker API: ${config.tracker.apiUrl}`);
  log('info', `API Key configured: ${config.tracker.apiKey ? 'yes' : 'NO — deductions will fail!'}`);
  log('info', `Cloud API: ${config.cloud.token ? 'configured (slicer weight lookup enabled)' : 'NOT configured — will fall back to percentage estimates'}`);

  startHealthServer();
  const client = connectMqtt();

  const shutdown = (signal) => {
    log('info', `Received ${signal}, shutting down...`);
    client.end(true, () => {
      log('info', 'MQTT disconnected');
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
