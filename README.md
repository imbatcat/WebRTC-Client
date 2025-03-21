# WebRTC Client for SignalR Hub

This is a WebRTC client implementation that uses SignalR for signaling. The client connects to a SignalR hub to establish WebRTC peer connections with other clients in the same room.

## Features

- Video and audio communication using WebRTC
- SignalR-based signaling
- Room-based communication
- Multiple peer connections support
- Connection status indication
- Simple and intuitive UI

## Prerequisites

- A modern web browser with WebRTC support (Chrome, Firefox, Safari, Edge)
- Node.js and npm/pnpm installed

## Setup and Installation

1. Clone this repository
2. Install dependencies: `npm install` or `pnpm install`
3. Start the development server: `npm run dev` or `pnpm dev`
4. Open the application in your browser (usually at http://localhost:5173)

## Usage

1. **Start Webcam**: Click the "Start webcam" button to enable your camera and microphone
2. **Join a Room**: By default, you join the room "room_123". To join a different room, enter the room ID in the input field and click "Join Room"
3. **Start a Call**: Click "Start Call" to initiate WebRTC connections with other users in the same room
4. **End the Call**: Click "Hangup" to end all connections and leave the room

## How It Works

1. The client connects to the SignalR hub at the specified URL
2. When a user joins a room, the hub notifies other users in the room
3. When "Start Call" is clicked, the client creates WebRTC offers for all other users in the room
4. Signaling (offers, answers, ICE candidates) is handled through the SignalR hub
5. When connections are established, video and audio streams are exchanged directly between peers using WebRTC

## Configuration

The application uses a SignalR hub at:

```
https://b8b6-2405-4803-c86d-5b0-7012-7191-fe88-1d9b.ngrok-free.app/hub/webrtc
```

If you need to use a different hub, modify the `url` constant in `main.js`.

## License

MIT
