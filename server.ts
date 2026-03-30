import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  // Track connected users
  const users = new Map();

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("join", (deviceName) => {
      users.set(socket.id, { id: socket.id, name: deviceName });
      io.emit("users-update", Array.from(users.values()));
    });

    socket.on("update-name", (deviceName) => {
      if (users.has(socket.id)) {
        users.set(socket.id, { ...users.get(socket.id), name: deviceName });
        io.emit("users-update", Array.from(users.values()));
      }
    });

    socket.on("send-request", ({ to, fromName, files }) => {
      io.to(to).emit("receive-request", { from: socket.id, fromName, files });
    });

    socket.on("accept-request", ({ to }) => {
      io.to(to).emit("request-accepted", { from: socket.id });
    });

    socket.on("reject-request", ({ to }) => {
      io.to(to).emit("request-rejected", { from: socket.id });
    });

    socket.on("signal", ({ to, signal }) => {
      io.to(to).emit("signal", { from: socket.id, signal });
    });

    socket.on("disconnect", () => {
      users.delete(socket.id);
      io.emit("users-update", Array.from(users.values()));
      console.log("User disconnected:", socket.id);
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
