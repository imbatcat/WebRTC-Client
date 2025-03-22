import "./style.css";
import * as signalR from "@microsoft/signalr";

// SignalR hub URL
const url =
  "https://29f9-2405-4803-c69b-4270-21fd-5310-3fd4-5916.ngrok-free.app";
const hubUrl = url + "/hub/webrtc";

// Debug mode - set to true for additional logging
const DEBUG = true;

// Debug logger - only logs when DEBUG is true
function debug(...args) {
  if (DEBUG) {
    console.log(...args);
  }
}

// WebRTC configuration
const servers = {
  iceServers: [
    {
      urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"],
    },
    {
      // Add TURN server as fallback for difficult NAT situations
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
  iceCandidatePoolSize: 10,
};

// Global State
let peerConnections = {}; // Store multiple peer connections by connection ID
let localStream = null;
let remoteStreams = {}; // Store multiple remote streams by connection ID
let currentRoomId = "room_123"; // Default room ID
let username = "Anonymous"; // Default username
let webcamActive = false;
let callInProgress = false;

// HTML elements
const webcamVideo = document.getElementById("webcamVideo");
const remoteVideo = document.getElementById("remoteVideo");
const roomInput = document.getElementById("roomInput");
const joinRoomButton = document.getElementById("joinRoomButton");
const hangupButton = document.getElementById("hangupButton");
const refreshButton = document.getElementById("refreshButton");
const connectionStatusElement = document.getElementById("connectionStatus");
const currentRoomDisplay = document.getElementById("currentRoomDisplay");
const localStatusElement = document.getElementById("localStatus");
const remoteStatusElement = document.getElementById("remoteStatus");
const connectionInfoElement = document.getElementById("connectionInfo");

// Update connection info display
function updateConnectionInfo() {
  const connectionIds = Object.keys(peerConnections);
  let infoText = `Active connections: ${connectionIds.length}\n`;

  if (connectionIds.length > 0) {
    infoText += "Connection details:\n";
    connectionIds.forEach((id) => {
      const pc = peerConnections[id];
      infoText += `- ${id}: ${pc.connectionState || "unknown"}\n`;

      // Add ice connection state
      if (pc.iceConnectionState) {
        infoText += `  ICE: ${pc.iceConnectionState}\n`;
      }

      // Add signaling state
      if (pc.signalingState) {
        infoText += `  Signaling: ${pc.signalingState}\n`;
      }

      // Add ICE gathering state
      if (pc.iceGatheringState) {
        infoText += `  ICE Gathering: ${pc.iceGatheringState}\n`;
      }
    });
  } else {
    infoText += "No active connections\n";
  }

  // Add local stream info
  if (localStream) {
    const videoTracks = localStream.getVideoTracks();
    const audioTracks = localStream.getAudioTracks();
    infoText += `\nLocal stream: ${videoTracks.length} video, ${audioTracks.length} audio\n`;

    if (videoTracks.length > 0) {
      const settings = videoTracks[0].getSettings();
      infoText += `Video: ${settings.width}x${settings.height}\n`;
    }
  } else {
    infoText += "\nLocal stream: not active\n";
  }

  // Add SignalR connection info
  infoText += `\nSignalR: ${connection.state}\n`;
  infoText += `Connection ID: ${connection.connectionId || "unknown"}\n`;
  infoText += `Current Room: ${currentRoomId}\n`;

  connectionInfoElement.textContent = infoText;
}

// Set up SignalR connection
const connection = new signalR.HubConnectionBuilder()
  .withUrl(hubUrl)
  .configureLogging(signalR.LogLevel.Information)
  .withAutomaticReconnect()
  .build();

// Connection state change handlers
connection.onreconnecting((error) => {
  connectionStatusElement.className = "connection-status disconnected";
  connectionStatusElement.textContent = `Connection lost. Reconnecting...`;
  updateConnectionInfo();
});

connection.onreconnected((connectionId) => {
  connectionStatusElement.className = "connection-status connected";
  connectionStatusElement.textContent = `Connected to server. Connection ID: ${connectionId}`;

  // Rejoin the room after reconnection
  joinRoom(currentRoomId);
  updateConnectionInfo();
});

connection.onclose((error) => {
  connectionStatusElement.className = "connection-status disconnected";
  connectionStatusElement.textContent = `Disconnected from server. Try refreshing the page.`;
  hangupButton.disabled = true;
  joinRoomButton.disabled = true;
  refreshButton.disabled = true;
  localStatusElement.textContent = "Disconnected";
  remoteStatusElement.textContent = "Disconnected";
  updateConnectionInfo();
});

// Setup SignalR hub methods implementation
connection.on("ReceiveOffer", async (offer, fromConnectionId) => {
  console.log(`Received offer from ${fromConnectionId}`);

  // Create a new peer connection for this offer if it doesn't exist
  if (!peerConnections[fromConnectionId]) {
    createPeerConnection(fromConnectionId);
  }

  const pc = peerConnections[fromConnectionId];

  try {
    // Set the remote description
    const parsedOffer = JSON.parse(offer);
    console.log("Parsed offer:", parsedOffer);
    await pc.setRemoteDescription(new RTCSessionDescription(parsedOffer));

    // Create answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // Send the answer back
    await connection.invoke(
      "SendAnswer",
      fromConnectionId,
      JSON.stringify(pc.localDescription)
    );

    console.log("Answer sent to", fromConnectionId);
    remoteStatusElement.textContent = "Connecting...";
    updateConnectionInfo();
  } catch (error) {
    console.error("Error handling offer:", error);
    remoteStatusElement.textContent = `Error: ${error.message}`;
    updateConnectionInfo();
  }
});

connection.on("ReceiveAnswer", async (answer, fromConnectionId) => {
  console.log(`Received answer from ${fromConnectionId}`);

  const pc = peerConnections[fromConnectionId];
  if (pc) {
    try {
      const answerDescription = new RTCSessionDescription(JSON.parse(answer));
      await pc.setRemoteDescription(answerDescription);
      remoteStatusElement.textContent = "Connecting...";
      updateConnectionInfo();
    } catch (error) {
      console.error("Error handling answer:", error);
      remoteStatusElement.textContent = `Error: ${error.message}`;
      updateConnectionInfo();
    }
  }
});

// Use ReceiveIceCandidate to match interface (instead of ReceiveICECandidate)
connection.on("ReceiveIceCandidate", async (iceCandidate, fromConnectionId) => {
  console.log(`Received ICE candidate from ${fromConnectionId}`);

  const pc = peerConnections[fromConnectionId];
  if (pc) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(JSON.parse(iceCandidate)));
      updateConnectionInfo();
    } catch (error) {
      console.error("Error adding received ice candidate", error);
      updateConnectionInfo();
    }
  }
});

connection.on("UserJoined", (connectionId, username) => {
  console.log(`${username} (${connectionId}) joined the room`);
  remoteStatusElement.textContent = `${username} joined the room`;

  // Create a new peer connection for this user
  createPeerConnection(connectionId);

  // Add a short delay before initiating the call to allow both peers to set up
  if (webcamActive) {
    // Wait a bit before initiating call to give the other side time to set up
    setTimeout(() => {
      // The user with the "smaller" connection ID initiates the call to avoid both
      // sides trying to call each other simultaneously
      if (connection.connectionId < connectionId) {
        console.log(
          `I (${connection.connectionId}) will initiate the call to ${connectionId}`
        );
        initiateCallToUser(connectionId);
      } else {
        console.log(
          `Waiting for ${connectionId} to call me (${connection.connectionId})`
        );
      }
    }, 1000);
  }

  updateConnectionInfo();
});

connection.on("UserLeft", (connectionId, username) => {
  console.log(`${username} (${connectionId}) left the room`);
  remoteStatusElement.textContent = `${username} left the room`;

  // Clean up the peer connection
  if (peerConnections[connectionId]) {
    peerConnections[connectionId].close();
    delete peerConnections[connectionId];
  }

  // Clean up the remote stream
  if (remoteStreams[connectionId]) {
    delete remoteStreams[connectionId];
  }

  // Update the remote video display if needed
  updateRemoteVideoDisplay();
  updateConnectionInfo();
});

// Helper function to create a peer connection for a specific remote peer
function createPeerConnection(connectionId) {
  console.log(`Creating peer connection for ${connectionId}`);

  // Close any existing connection first
  if (peerConnections[connectionId]) {
    console.log(`Closing existing connection to ${connectionId}`);
    peerConnections[connectionId].close();
  }

  const pc = new RTCPeerConnection(servers);
  peerConnections[connectionId] = pc;

  // Create a remote stream for this connection
  remoteStreams[connectionId] = new MediaStream();

  // Add local tracks to the peer connection
  if (localStream) {
    localStream.getTracks().forEach((track) => {
      try {
        console.log(
          `Adding ${track.kind} track to connection with ${connectionId}`
        );
        pc.addTrack(track, localStream);
      } catch (err) {
        console.error(`Failed to add ${track.kind} track to connection:`, err);
      }
    });
  } else {
    console.warn(
      `No local stream available when creating connection to ${connectionId}`
    );
  }

  // Listen for remote tracks
  pc.ontrack = (event) => {
    console.log(`Received remote track from ${connectionId}`, event.streams);
    console.log(
      `Track kind: ${event.track.kind}, enabled: ${event.track.enabled}, readyState: ${event.track.readyState}`
    );

    // Use the event's streams directly
    if (event.streams && event.streams[0]) {
      remoteStreams[connectionId] = event.streams[0];

      // Update the remote video display immediately
      updateRemoteVideoDisplay();

      // Ensure audio is enabled and unmuted
      const audioTracks = remoteStreams[connectionId].getAudioTracks();
      if (audioTracks.length > 0) {
        console.log(
          `Remote audio tracks: ${audioTracks.length}, enabled: ${audioTracks[0].enabled}`
        );
        audioTracks.forEach((track) => {
          track.enabled = true;
          console.log(`Ensured audio track is enabled: ${track.enabled}`);
        });
      } else {
        console.warn(`No audio tracks received from ${connectionId}`);
      }

      remoteStatusElement.textContent = "Connected";
    } else {
      console.warn(`Received track event without streams from ${connectionId}`);
    }
  };

  // Listen for negotiation needed events
  pc.onnegotiationneeded = async (event) => {
    console.log(`Negotiation needed for ${connectionId}`);

    // Only the side with the smaller connection ID should initiate on negotiation needed
    // to avoid both sides trying to negotiate simultaneously
    if (connection.connectionId < connectionId) {
      try {
        console.log(`Initiating negotiation with ${connectionId}`);
        await initiateCallToUser(connectionId);
      } catch (error) {
        console.error(`Error during negotiation with ${connectionId}:`, error);
      }
    } else {
      console.log(`Waiting for ${connectionId} to initiate negotiation`);
    }
  };

  // Listen for ICE candidates and send them to the remote peer
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      console.log(`Sending ICE candidate to ${connectionId}`, event.candidate);
      connection
        .invoke(
          "SendIceCandidate",
          connectionId,
          JSON.stringify(event.candidate)
        )
        .catch((err) => {
          console.error(`Error sending ICE candidate to ${connectionId}:`, err);
        });
    } else {
      console.log(`All ICE candidates gathered for ${connectionId}`);
    }
  };

  // Handle connection state changes
  pc.onconnectionstatechange = () => {
    console.log(
      `Connection state changed for ${connectionId}: ${pc.connectionState}`
    );
    updateConnectionInfo();

    if (pc.connectionState === "connected") {
      console.log(`Successfully connected to ${connectionId}`);
      remoteStatusElement.textContent = "Connected";
    } else if (pc.connectionState === "failed") {
      console.log(`Connection to ${connectionId} failed`);
      remoteStatusElement.textContent = "Connection failed";

      // Try to restart ICE
      if (pc.restartIce) {
        console.log(`Attempting to restart ICE for ${connectionId}`);
        try {
          pc.restartIce();
        } catch (err) {
          console.error(`Error restarting ICE:`, err);
        }
      }
    } else if (pc.connectionState === "disconnected") {
      console.log(`Connection to ${connectionId} was disconnected`);
      remoteStatusElement.textContent = "Disconnected";

      // Try to recover from disconnection after a short delay
      setTimeout(() => {
        if (pc.connectionState === "disconnected") {
          console.log(
            `Attempting to recover disconnected connection with ${connectionId}`
          );
          // Try to restart ICE if available
          if (pc.restartIce) {
            try {
              pc.restartIce();
            } catch (err) {
              console.error(`Error restarting ICE:`, err);
            }
          }
        }
      }, 2000);
    } else if (pc.connectionState === "closed") {
      console.log(`Connection to ${connectionId} was closed`);
      remoteStatusElement.textContent = "Call ended";
    }
  };

  // Handle ICE connection state changes
  pc.oniceconnectionstatechange = () => {
    console.log(
      `ICE connection state changed for ${connectionId}: ${pc.iceConnectionState}`
    );
    updateConnectionInfo();

    // If ICE fails, try to reconnect
    if (pc.iceConnectionState === "failed") {
      console.log(
        `ICE connection failed for ${connectionId}, attempting to restart`
      );

      // Try to restart ICE
      if (pc.restartIce) {
        try {
          pc.restartIce();
          console.log(`ICE restart initiated for ${connectionId}`);
        } catch (err) {
          console.error(`Error restarting ICE:`, err);
        }
      } else {
        console.log(`restartIce() not available, attempting to renegotiate`);
        // If restartIce is not available, try to renegotiate
        setTimeout(() => initiateCallToUser(connectionId), 1000);
      }
    }
  };

  // Handle ICE gathering state changes
  pc.onicegatheringstatechange = () => {
    console.log(
      `ICE gathering state for ${connectionId}: ${pc.iceGatheringState}`
    );
  };

  return pc;
}

// Helper function to update the remote video display
function updateRemoteVideoDisplay() {
  const streamKeys = Object.keys(remoteStreams);
  console.log(`Updating remote display with ${streamKeys.length} streams`);

  if (streamKeys.length > 0) {
    // Just use the first remote stream for simplicity
    // In a real app, you might want to show all streams in separate elements
    const firstStreamId = streamKeys[0];
    console.log(
      `Using remote stream from ${firstStreamId}`,
      remoteStreams[firstStreamId]
    );

    // Check if there are audio tracks and log their status
    const stream = remoteStreams[firstStreamId];
    const audioTracks = stream.getAudioTracks();
    console.log(`Remote stream audio tracks: ${audioTracks.length}`);

    if (audioTracks.length > 0) {
      console.log(`Audio track info:`, {
        enabled: audioTracks[0].enabled,
        muted: audioTracks[0].muted,
        readyState: audioTracks[0].readyState,
        id: audioTracks[0].id,
      });
    }

    // Ensure remoteVideo has proper audio settings
    remoteVideo.srcObject = remoteStreams[firstStreamId];
    remoteVideo.muted = false;
    remoteVideo.volume = 1.0; // Ensure volume is set to maximum

    // Force audio playback
    remoteVideo.onloadedmetadata = () => {
      console.log("Remote video metadata loaded, attempting to play");

      // Try to play the video element to initiate audio
      const playPromise = remoteVideo.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            console.log("Remote stream playing successfully");
          })
          .catch((err) => {
            console.error("Error playing remote stream:", err);
            // Often this is due to user interaction being required
            // Add a button to manually enable audio if needed
            if (!document.getElementById("enableAudioButton")) {
              const enableAudioButton = document.createElement("button");
              enableAudioButton.id = "enableAudioButton";
              enableAudioButton.innerText = "Enable Audio";
              enableAudioButton.className = "enable-audio-button";
              enableAudioButton.style.marginTop = "10px";

              enableAudioButton.onclick = () => {
                remoteVideo.muted = false;
                remoteVideo
                  .play()
                  .catch((e) => console.error("Still can't play:", e));
                enableAudioButton.style.display = "none";
              };

              const remoteContainer = document.querySelector(
                ".remote-video-container"
              );
              if (remoteContainer) {
                remoteContainer.appendChild(enableAudioButton);
              }
            }
          });
      }
    };

    // Check if the stream has active tracks
    if (
      stream.getVideoTracks().length === 0 &&
      stream.getAudioTracks().length === 0
    ) {
      remoteStatusElement.textContent = "No media tracks received";
    } else if (stream.getVideoTracks().length === 0) {
      remoteStatusElement.textContent = "Audio only (no video)";
    } else if (stream.getAudioTracks().length === 0) {
      remoteStatusElement.textContent = "Video only (no audio)";
    } else {
      remoteStatusElement.textContent = "Connected";
    }
  } else {
    console.log("No remote streams available");
    remoteVideo.srcObject = null;
    remoteStatusElement.textContent = "Waiting for peer...";
  }

  updateConnectionInfo();
}

// Add a function to update status indicators with appropriate styling
function updateStatusIndicator(element, text) {
  if (!element) return;

  // Set the text content
  element.textContent = text;

  // Remove existing status classes
  element.classList.remove(
    "status-green",
    "status-orange",
    "status-red",
    "status-pulsing"
  );

  // Add appropriate color class based on the status text
  const lowerText = text.toLowerCase();

  if (lowerText.includes("active") || lowerText.includes("connected")) {
    element.classList.add("status-green");
  } else if (
    lowerText.includes("error") ||
    lowerText.includes("failed") ||
    lowerText.includes("disconnected")
  ) {
    element.classList.add("status-red");
  } else {
    element.classList.add("status-orange");

    // Add pulsing animation for waiting/connecting states
    if (
      lowerText.includes("waiting") ||
      lowerText.includes("connecting") ||
      lowerText.includes("calling") ||
      lowerText.includes("joining")
    ) {
      element.classList.add("status-pulsing");
    }
  }
}

// Start webcam
async function startWebcam() {
  if (webcamActive) return true;

  try {
    console.log("Requesting camera and microphone access...");
    updateStatusIndicator(localStatusElement, "Requesting camera access...");

    // Get local stream with constraints
    localStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "user",
      },
      audio: true,
    });

    console.log("Got local media stream:", localStream);
    updateStatusIndicator(localStatusElement, "Camera active");

    // Display local stream
    webcamVideo.srcObject = localStream;
    webcamActive = true;

    // Create peer connections for existing users in the room and start calls
    const connectionIds = Object.keys(peerConnections);
    console.log(
      `Adding tracks to ${connectionIds.length} existing peer connections`
    );

    for (const connectionId of connectionIds) {
      // Add local tracks to the peer connection
      localStream.getTracks().forEach((track) => {
        try {
          peerConnections[connectionId].addTrack(track, localStream);
        } catch (err) {
          console.error(
            `Error adding track to connection ${connectionId}:`,
            err
          );
        }
      });

      // Initiate call to this user
      initiateCallToUser(connectionId);
    }

    updateConnectionInfo();
    return true;
  } catch (error) {
    console.error("Error accessing media devices:", error);
    connectionStatusElement.textContent = `Error accessing camera/microphone: ${error.message}`;
    connectionStatusElement.className = "connection-status disconnected";
    updateStatusIndicator(localStatusElement, `Error: ${error.message}`);
    updateConnectionInfo();
    return false;
  }
}

// Initiate call to a specific user
async function initiateCallToUser(connectionId) {
  try {
    console.log(`Initiating call to ${connectionId}`);
    const pc = peerConnections[connectionId];
    if (!pc) {
      console.warn(`No peer connection for ${connectionId}`);
      return;
    }

    // Check if we already have a local description (in case this was called twice)
    if (pc.localDescription && pc.localDescription.type) {
      console.log(
        `Already have local description for ${connectionId}, skipping offer creation`
      );
      return;
    }

    remoteStatusElement.textContent = "Setting up call...";

    // Create and set local description
    try {
      const offerDescription = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });

      console.log(`Created offer for ${connectionId}:`, offerDescription);
      await pc.setLocalDescription(offerDescription);

      // Ensure local description is set before sending
      await new Promise((resolve) => {
        if (pc.localDescription && pc.localDescription.type) {
          resolve();
        } else {
          // Wait for the local description to be set
          const checkInterval = setInterval(() => {
            if (pc.localDescription && pc.localDescription.type) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 100);

          // Timeout after 5 seconds
          setTimeout(() => {
            clearInterval(checkInterval);
            console.warn(
              `Timeout waiting for local description for ${connectionId}`
            );
            resolve();
          }, 5000);
        }
      });

      // Send the offer through SignalR
      if (pc.localDescription && pc.localDescription.type) {
        console.log(`Sending offer to ${connectionId}:`, pc.localDescription);
        await connection.invoke(
          "SendOffer",
          currentRoomId,
          JSON.stringify(pc.localDescription)
        );

        console.log(`Sent offer to ${connectionId}`);
        remoteStatusElement.textContent = "Calling...";
      } else {
        console.error(`Failed to set local description for ${connectionId}`);
        remoteStatusElement.textContent = "Call setup failed";
      }
    } catch (err) {
      console.error(`Error creating/setting offer for ${connectionId}:`, err);
      remoteStatusElement.textContent = `Error setting up call: ${err.message}`;
    }

    updateConnectionInfo();
  } catch (error) {
    console.error(`Error initiating call to ${connectionId}:`, error);
    remoteStatusElement.textContent = `Error: ${error.message}`;
    updateConnectionInfo();
  }
}

// Join a room
async function joinRoom(roomId) {
  try {
    // Reset any existing connections first
    for (const connectionId in peerConnections) {
      peerConnections[connectionId].close();
    }
    peerConnections = {};
    remoteStreams = {};
    remoteVideo.srcObject = null;

    // Update room display
    currentRoomId = roomId;
    currentRoomDisplay.textContent = currentRoomId;
    remoteStatusElement.textContent = "Joining room...";

    // Join the room in SignalR
    await connection.invoke("JoinRoom", roomId);
    console.log(`Joined room: ${roomId}`);

    // Start webcam if not already started
    if (!webcamActive) {
      const webcamStarted = await startWebcam();
      if (!webcamStarted) {
        console.error("Failed to start webcam when joining room");
      }
    }

    // Enable buttons
    hangupButton.disabled = false;
    refreshButton.disabled = false;

    updateConnectionInfo();
    return true;
  } catch (error) {
    console.error(`Error joining room ${roomId}:`, error);
    connectionStatusElement.textContent = `Error joining room: ${error.message}`;
    connectionStatusElement.className = "connection-status disconnected";
    updateConnectionInfo();
    return false;
  }
}

// Start SignalR connection and join default room
async function start() {
  try {
    await connection.start();
    console.log("Connected to SignalR hub");

    connectionStatusElement.className = "connection-status connected";
    connectionStatusElement.textContent = `Connected to server. Connection ID: ${connection.connectionId}`;

    // Join the default room
    await joinRoom(currentRoomId);

    // Enable UI elements
    joinRoomButton.disabled = false;
    updateConnectionInfo();
  } catch (err) {
    console.error(err);
    connectionStatusElement.className = "connection-status disconnected";
    connectionStatusElement.textContent = `Failed to connect. Retrying in 5 seconds...`;
    localStatusElement.textContent = "Connection failed";
    remoteStatusElement.textContent = "Connection failed";
    // Retry connection after delay
    setTimeout(start, 5000);
    updateConnectionInfo();
  }
}

// Join a different room
joinRoomButton.onclick = async () => {
  const newRoomId = roomInput.value.trim();
  if (!newRoomId) {
    alert("Please enter a room ID");
    return;
  }

  // Leave current room
  await leaveRoom();

  // Join new room
  await joinRoom(newRoomId);

  // Clear input
  roomInput.value = "";
};

// Refresh the connection
refreshButton.onclick = async () => {
  // Close existing peer connections but stay in the same room
  for (const connectionId in peerConnections) {
    peerConnections[connectionId].close();
  }

  // Reset state
  peerConnections = {};
  remoteStreams = {};

  // Update UI
  remoteVideo.srcObject = null;
  remoteStatusElement.textContent = "Refreshing connection...";

  // If webcam is active, stop it and restart
  if (webcamActive && localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
    webcamActive = false;
    webcamVideo.srcObject = null;
  }

  // Rejoin the same room
  await joinRoom(currentRoomId);

  updateConnectionInfo();
};

// Leave the current room
async function leaveRoom() {
  try {
    // Close all peer connections
    for (const connectionId in peerConnections) {
      peerConnections[connectionId].close();
    }

    // Reset state
    peerConnections = {};
    remoteStreams = {};

    // Update UI
    remoteVideo.srcObject = null;
    remoteStatusElement.textContent = "Left room";

    // Leave the room in SignalR
    await connection.invoke("LeaveRoom", currentRoomId, username);
    console.log(`Left room: ${currentRoomId}`);

    updateConnectionInfo();
    return true;
  } catch (error) {
    console.error(`Error leaving room ${currentRoomId}:`, error);
    updateConnectionInfo();
    return false;
  }
}

// Hangup/leave the call
hangupButton.onclick = async () => {
  await leaveRoom();
  hangupButton.disabled = true;
  refreshButton.disabled = true;

  // Rejoin the default room
  await joinRoom("room_123");
};

// Start SignalR connection when DOM is loaded
document.addEventListener("DOMContentLoaded", function () {
  start();
  updateConnectionInfo();
});

// Cleanup on page unload
window.addEventListener("beforeunload", async () => {
  // Stop local stream tracks
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
  }

  // Leave the room
  if (connection.state === signalR.HubConnectionState.Connected) {
    await connection.invoke("LeaveRoom", currentRoomId, username);
  }

  // Close the connection
  await connection.stop();

  // Close all peer connections
  for (const connectionId in peerConnections) {
    peerConnections[connectionId].close();
  }
});

// Listen for media errors
webcamVideo.onerror = (event) => {
  console.error("Video element error:", event);
  localStatusElement.textContent = "Video error";
};

remoteVideo.onerror = (event) => {
  console.error("Remote video element error:", event);
  remoteStatusElement.textContent = "Video error";
};

// Add diagnostic button to index.html
document.addEventListener("DOMContentLoaded", () => {
  // Create diagnostic button
  const diagnosticButton = document.createElement("button");
  diagnosticButton.id = "diagnosticButton";
  diagnosticButton.innerText = "Run Diagnostics";
  diagnosticButton.className = "diagnostic-button";

  // Add to actions div
  const actionsDiv = document.querySelector(".actions");
  if (actionsDiv) {
    actionsDiv.appendChild(diagnosticButton);

    // Add event listener
    diagnosticButton.addEventListener("click", runDiagnostics);
  }
});

// Run connection diagnostics
async function runDiagnostics() {
  debug("Running WebRTC diagnostics...");

  const diagnosticsOutput = document.createElement("div");
  diagnosticsOutput.className = "diagnostics-output";
  diagnosticsOutput.innerHTML = "<h3>Connection Diagnostics</h3>";

  // Check SignalR connection
  const signalRStatus = document.createElement("div");
  signalRStatus.innerHTML = `<p><b>SignalR:</b> ${connection.state}</p>`;
  diagnosticsOutput.appendChild(signalRStatus);

  // Check local stream
  const localStreamStatus = document.createElement("div");
  if (localStream) {
    const videoTracks = localStream.getVideoTracks();
    const audioTracks = localStream.getAudioTracks();
    localStreamStatus.innerHTML = `<p><b>Local Media:</b> Video: ${
      videoTracks.length > 0 ? "OK" : "No video"
    }, 
      Audio: ${audioTracks.length > 0 ? "OK" : "No audio"}</p>`;

    // Add audio track details
    if (audioTracks.length > 0) {
      localStreamStatus.innerHTML += `<p><small>Audio Track: enabled=${audioTracks[0].enabled}, 
        muted=${audioTracks[0].muted}, readyState=${audioTracks[0].readyState}</small></p>`;
    }
  } else {
    localStreamStatus.innerHTML = "<p><b>Local Media:</b> Not available</p>";
  }
  diagnosticsOutput.appendChild(localStreamStatus);

  // Check remote stream
  const remoteStreamStatus = document.createElement("div");
  const streamKeys = Object.keys(remoteStreams);
  if (streamKeys.length > 0) {
    const firstStream = remoteStreams[streamKeys[0]];
    const videoTracks = firstStream.getVideoTracks();
    const audioTracks = firstStream.getAudioTracks();

    remoteStreamStatus.innerHTML = `<p><b>Remote Media:</b> Video: ${
      videoTracks.length > 0 ? "OK" : "No video"
    }, Audio: ${audioTracks.length > 0 ? "OK" : "No audio"}</p>`;

    // Add audio element status
    remoteStreamStatus.innerHTML += `<p><small>Audio Element: muted=${remoteVideo.muted}, 
      volume=${remoteVideo.volume}, paused=${remoteVideo.paused}</small></p>`;

    // Add audio track details
    if (audioTracks.length > 0) {
      remoteStreamStatus.innerHTML += `<p><small>Remote Audio Track: enabled=${audioTracks[0].enabled}, 
        muted=${audioTracks[0].muted}, readyState=${audioTracks[0].readyState}</small></p>`;
    }

    // Add audio troubleshooting button
    const fixAudioButton = document.createElement("button");
    fixAudioButton.innerHTML = "Fix Audio";
    fixAudioButton.style.marginTop = "5px";
    fixAudioButton.onclick = () => {
      // Attempt to fix common audio issues
      if (remoteVideo) {
        remoteVideo.muted = false;
        remoteVideo.volume = 1.0;
        remoteVideo
          .play()
          .catch((e) => console.warn("Could not force play:", e));
      }

      // Ensure all audio tracks are enabled
      if (firstStream) {
        const audioTracks = firstStream.getAudioTracks();
        audioTracks.forEach((track) => {
          track.enabled = true;
        });
      }

      runDiagnostics(); // Refresh diagnostics
    };
    remoteStreamStatus.appendChild(fixAudioButton);
  } else {
    remoteStreamStatus.innerHTML = "<p><b>Remote Media:</b> Not available</p>";
  }
  diagnosticsOutput.appendChild(remoteStreamStatus);

  // Check peer connections
  const peerStatus = document.createElement("div");
  const connectionIds = Object.keys(peerConnections);
  if (connectionIds.length > 0) {
    let peerHtml = "<p><b>Peer Connections:</b></p><ul>";
    connectionIds.forEach((id) => {
      const pc = peerConnections[id];
      peerHtml += `<li>${id}: ${pc.connectionState || "unknown"} 
        (ICE: ${pc.iceConnectionState}, Signaling: ${pc.signalingState})</li>`;
    });
    peerHtml += "</ul>";
    peerStatus.innerHTML = peerHtml;
  } else {
    peerStatus.innerHTML = "<p><b>Peer Connections:</b> None</p>";
  }
  diagnosticsOutput.appendChild(peerStatus);

  // Append the diagnostics to the page
  const connectionInfo = document.querySelector(".connection-info");

  // Remove any existing diagnostics
  const existingDiagnostics = document.querySelector(".diagnostics-output");
  if (existingDiagnostics) {
    existingDiagnostics.remove();
  }

  if (connectionInfo) {
    connectionInfo.appendChild(diagnosticsOutput);
  }

  // Try to detect and suggest fixes for common issues
  const suggestions = document.createElement("div");
  suggestions.innerHTML = "<p><b>Suggestions:</b></p><ul>";

  // No peer connections
  if (connectionIds.length === 0) {
    suggestions.innerHTML +=
      "<li>No peer connections found. Try refreshing the connection or check that another user has joined the room.</li>";
  }

  // Check for audio issues
  if (streamKeys.length > 0) {
    const firstStream = remoteStreams[streamKeys[0]];
    const audioTracks = firstStream.getAudioTracks();

    if (audioTracks.length === 0) {
      suggestions.innerHTML +=
        "<li>No audio tracks detected in the remote stream. This may be because the sender disabled their microphone.</li>";
    } else if (remoteVideo.muted) {
      suggestions.innerHTML +=
        "<li>Remote video element is muted. Click 'Fix Audio' to unmute.</li>";
    } else if (remoteVideo.volume === 0) {
      suggestions.innerHTML +=
        "<li>Remote video volume is set to 0. Click 'Fix Audio' to restore volume.</li>";
    }
  }

  // Failed ICE connections
  let hasFailed = false;
  connectionIds.forEach((id) => {
    const pc = peerConnections[id];
    if (pc.iceConnectionState === "failed" || pc.connectionState === "failed") {
      hasFailed = true;
    }
  });

  if (hasFailed) {
    suggestions.innerHTML += `
      <li>ICE connection failed. This might be due to:
        <ul>
          <li>Firewall or network restrictions</li>
          <li>Incompatible NAT configurations</li>
          <li>One peer may be behind a symmetric NAT</li>
        </ul>
        Try using a different network or adding additional TURN servers.
      </li>`;
  }

  suggestions.innerHTML += "</ul>";
  diagnosticsOutput.appendChild(suggestions);

  // Try to auto-recover from common issues
  if (hasFailed && connectionIds.length > 0) {
    // Attempt recovery
    const recoveryMessage = document.createElement("div");
    recoveryMessage.innerHTML =
      "<p><b>Attempting automatic recovery...</b></p>";
    diagnosticsOutput.appendChild(recoveryMessage);

    // Wait a bit and then try refreshing the connection
    setTimeout(() => {
      refreshConnection();
    }, 1000);
  }
}

// Refresh connection function (extracted from button click handler for reuse)
async function refreshConnection() {
  // Close existing peer connections but stay in the same room
  for (const connectionId in peerConnections) {
    peerConnections[connectionId].close();
  }

  // Reset state
  peerConnections = {};
  remoteStreams = {};

  // Update UI
  remoteVideo.srcObject = null;
  remoteStatusElement.textContent = "Refreshing connection...";

  // If webcam is active, stop it and restart
  if (webcamActive && localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
    webcamActive = false;
    webcamVideo.srcObject = null;
  }

  // Rejoin the same room
  await joinRoom(currentRoomId);

  updateConnectionInfo();
}

// Hook up the refresh button to use the extracted function
refreshButton.onclick = refreshConnection;

// Let's also create a MutationObserver to watch for changes to the status elements
document.addEventListener("DOMContentLoaded", () => {
  // Set up observer for remote status
  if (remoteStatusElement) {
    const remoteObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === "characterData" ||
          mutation.type === "childList"
        ) {
          updateStatusIndicator(
            remoteStatusElement,
            remoteStatusElement.textContent
          );
        }
      });
    });

    remoteObserver.observe(remoteStatusElement, {
      characterData: true,
      childList: true,
      subtree: true,
    });

    // Initial update
    updateStatusIndicator(remoteStatusElement, remoteStatusElement.textContent);
  }

  // Set up observer for local status
  if (localStatusElement) {
    const localObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === "characterData" ||
          mutation.type === "childList"
        ) {
          updateStatusIndicator(
            localStatusElement,
            localStatusElement.textContent
          );
        }
      });
    });

    localObserver.observe(localStatusElement, {
      characterData: true,
      childList: true,
      subtree: true,
    });

    // Initial update
    updateStatusIndicator(localStatusElement, localStatusElement.textContent);
  }
});
