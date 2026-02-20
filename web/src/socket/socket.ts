import { io, Socket } from "socket.io-client";
import { getAuthToken, getOrCreateGuestId, getOrCreateGuestName } from "../auth/auth";

export const socket: Socket = io("http://localhost:4000", {
  transports: ["websocket"],
  auth: {
    token: getAuthToken(),
    guestId: getOrCreateGuestId(),
    name: getOrCreateGuestName(),
  },
});

export function identifySocket() {
  const token = getAuthToken();
  socket.emit("user:identify", {
    token,
    guestId: getOrCreateGuestId(),
    
    ...(token ? {} : { name: getOrCreateGuestName() }),
  });
} 


socket.on("connect", () => {
  try {
    identifySocket();
  } catch {
    console.error("Failed to identify socket");
  }
});
