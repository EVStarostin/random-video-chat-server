const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');

const isDevelopment = process.env.NODE_ENV === 'development';
const CERT_PATH = '/etc/letsencrypt/live/evstar.ru/fullchain.pem';
const KEY_PATH = '/etc/letsencrypt/live/evstar.ru/privkey.pem';
const server = isDevelopment
  ? http.createServer()
  : https.createServer({ cert: fs.readFileSync(CERT_PATH), key: fs.readFileSync(KEY_PATH) })
server.listen(7000);

const WEB_RTC_TYPES = {
  NEW_ICE_CANDIDATE: '[webrtc]: new_ice_candidate',
  VIDEO_OFFER: '[webrtc]: video_offer',
  VIDEO_ANSWER: '[webrtc]: video_answer',
}

const CLIENT_TYPES = {
  READY: '[client]: ready',
  NOT_READY: '[client]: not_ready',
  CONNECTED: '[client]: connected',
  NOT_CONNECTED: '[client]: not_connected',
}

const SERVER_TYPES = {
  INFO: '[server]: info',
  CALL: '[server]: call',
  HANG_UP: '[server]: hang_up',
}

const wss = new WebSocket.Server({ server });
let users = {};

wss.on('connection', ws => {
  const uuid = uuidv4();

  users[uuid] = { ws, isReady: false, isConnected: false, peer: null };
  sendInfo();

  ws.on('message', message => {
    const parsedData = JSON.parse(message);
    const peerUUID = users[uuid].peer;

    switch (parsedData.type) {
      case CLIENT_TYPES.READY:
        users[uuid].isReady = true;
        joinPeers(uuid);
        sendInfo();
        break;

      case CLIENT_TYPES.NOT_READY:
        users[uuid].isReady = false;
        sendInfo();
        break;

      case CLIENT_TYPES.CONNECTED:
        users[uuid].isConnected = true;
        sendInfo();
        break;

      case CLIENT_TYPES.NOT_CONNECTED:
        sendToWSC(users[peerUUID].ws, { type: SERVER_TYPES.HANG_UP });
        users[uuid].isConnected = false;
        joinPeers(uuid);
        users[peerUUID].isConnected = false;
        sendInfo();
        break;

      case WEB_RTC_TYPES.VIDEO_OFFER:
      case WEB_RTC_TYPES.VIDEO_ANSWER:
      case WEB_RTC_TYPES.NEW_ICE_CANDIDATE:
        users[peerUUID].ws.send(message);
        break;
    }
  });

  ws.on('close', () => {
    delete users[uuid];
    sendInfo();
  });
});

function broadcast(msg) {
  wss.clients.forEach(function each(client) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(msg));
    }
  });
}

function sendToWSC(ws, msg) {
  ws.send(JSON.stringify(msg));
}

function getReadyUsers() {
  const readyUsers = [];

  for (const key in users) {
    if (users.hasOwnProperty(key)) {
      const user = users[key];

      if (user.isReady && !user.isConnected) readyUsers.push(key);
    }
  }

  return readyUsers;
}

function getConnectedUsers() {
  const connectedUsers = [];

  for (const key in users) {
    if (users.hasOwnProperty(key)) {
      const user = users[key];

      if (user.isConnected) connectedUsers.push(key);
    }
  }

  return connectedUsers;
}

function sendInfo() {
  const readyUsers = getReadyUsers();
  const connectedUsers = getConnectedUsers();

  broadcast({
    type: SERVER_TYPES.INFO,
    payload: { users: Object.keys(users).length, readyUsers: readyUsers.length, connectedUsers: connectedUsers.length },
  });
}

function joinPeers(uuid) {
  const readyUsers = getReadyUsers();

  if (readyUsers.length >= 2) {
    const randomUser = getRandomReadyUser(uuid);
    users[uuid].peer = randomUser;
    users[randomUser].peer = uuid;
    sendToWSC(users[uuid].ws, { type: SERVER_TYPES.CALL });
  }
}

function getRandomReadyUser(uuid) {
  const readyUsers = getReadyUsers();
  const peers = readyUsers.filter(user => user !== uuid);
  const randomNumber = randomInteger(0, peers.length - 1);
  const randomUser = readyUsers.length > 1 ? peers[randomNumber] : null;

  return randomUser;
}

function randomInteger(min, max) {
  let rand = min + Math.random() * (max + 1 - min);

  return Math.floor(rand);
}