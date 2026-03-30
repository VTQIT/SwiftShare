import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import Peer from 'simple-peer';
import { 
  Send, 
  Download, 
  Monitor, 
  Smartphone, 
  File, 
  FileText, 
  Image as ImageIcon, 
  Video, 
  Music, 
  X, 
  Check, 
  Loader2,
  Wifi,
  WifiOff,
  Settings,
  ChevronRight,
  Share2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import { cn, formatBytes } from './lib/utils';
import { User, FileInfo, TransferProgress, IncomingRequest } from './types';

const CHUNK_SIZE = 16384; // 16KB chunks for WebRTC

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [deviceName, setDeviceName] = useState(() => {
    const saved = localStorage.getItem('swiftshare_device_name');
    if (saved) return saved;
    const adjectives = ['Swift', 'Quick', 'Fast', 'Nimble', 'Bright'];
    const nouns = ['Fox', 'Eagle', 'Lion', 'Wolf', 'Deer'];
    return `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`;
  });
  const [users, setUsers] = useState<User[]>([]);
  const [mode, setMode] = useState<'idle' | 'send' | 'receive'>('idle');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [incomingRequest, setIncomingRequest] = useState<IncomingRequest | null>(null);
  const [transfers, setTransfers] = useState<TransferProgress[]>([]);
  const [connected, setConnected] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const peerRef = useRef<Peer.Instance | null>(null);
  const fileReaderRef = useRef<FileReader | null>(null);

  // Initialize Socket.io
  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('connect', () => {
      setConnected(true);
      newSocket.emit('join', deviceName);
    });

    newSocket.on('disconnect', () => setConnected(false));

    newSocket.on('users-update', (updatedUsers: User[]) => {
      setUsers(updatedUsers.filter(u => u.id !== newSocket.id));
    });

    newSocket.on('receive-request', (request: IncomingRequest) => {
      setIncomingRequest(request);
    });

    newSocket.on('request-accepted', ({ from }) => {
      startWebRTCSender(from);
    });

    newSocket.on('request-rejected', () => {
      alert('Transfer request was rejected.');
      setMode('idle');
    });

    newSocket.on('signal', ({ from, signal }) => {
      if (peerRef.current) {
        peerRef.current.signal(signal);
      } else {
        // This handles the receiver side initialization when signal arrives
        startWebRTCReceiver(from, signal);
      }
    });

    return () => {
      newSocket.close();
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('swiftshare_device_name', deviceName);
    if (socket && connected) {
      socket.emit('update-name', deviceName);
    }
  }, [deviceName, socket, connected]);

  const startWebRTCSender = (targetId: string) => {
    const peer = new Peer({ initiator: true, trickle: false });
    peerRef.current = peer;

    peer.on('signal', (data) => {
      socket?.emit('signal', { to: targetId, signal: data });
    });

    peer.on('connect', () => {
      console.log('WebRTC Connected as Sender');
      sendFiles(peer);
    });

    peer.on('error', (err) => console.error('Peer error:', err));
  };

  const startWebRTCReceiver = (targetId: string, incomingSignal: any) => {
    const peer = new Peer({ initiator: false, trickle: false });
    peerRef.current = peer;

    peer.on('signal', (data) => {
      socket?.emit('signal', { to: targetId, signal: data });
    });

    peer.signal(incomingSignal);

    peer.on('connect', () => {
      console.log('WebRTC Connected as Receiver');
    });

    let receivedChunks: any[] = [];
    let currentFile: FileInfo | null = null;
    let bytesReceived = 0;
    let startTime = Date.now();

    peer.on('data', (data) => {
      const message = data.toString();
      
      if (message.startsWith('METADATA:')) {
        currentFile = JSON.parse(message.replace('METADATA:', ''));
        receivedChunks = [];
        bytesReceived = 0;
        startTime = Date.now();
        
        setTransfers(prev => [...prev, {
          fileId: currentFile!.name + currentFile!.lastModified,
          fileName: currentFile!.name,
          progress: 0,
          speed: 0,
          status: 'transferring',
          totalSize: currentFile!.size,
          transferredSize: 0
        }]);
      } else if (message === 'EOF') {
        if (currentFile) {
          const blob = new Blob(receivedChunks);
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = currentFile.name;
          a.click();
          
          setTransfers(prev => prev.map(t => 
            t.fileName === currentFile?.name ? { ...t, status: 'completed', progress: 100 } : t
          ));
        }
      } else {
        receivedChunks.push(data);
        bytesReceived += data.length;
        
        const now = Date.now();
        const duration = (now - startTime) / 1000;
        const speed = duration > 0 ? bytesReceived / duration : 0;
        const progress = (bytesReceived / (currentFile?.size || 1)) * 100;

        setTransfers(prev => prev.map(t => 
          t.fileName === currentFile?.name ? { 
            ...t, 
            progress, 
            transferredSize: bytesReceived,
            speed 
          } : t
        ));
      }
    });
  };

  const sendFiles = async (peer: Peer.Instance) => {
    for (const file of selectedFiles) {
      const fileInfo: FileInfo = {
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified
      };

      peer.send(`METADATA:${JSON.stringify(fileInfo)}`);

      const fileId = file.name + file.lastModified;
      setTransfers(prev => [...prev, {
        fileId,
        fileName: file.name,
        progress: 0,
        speed: 0,
        status: 'transferring',
        totalSize: file.size,
        transferredSize: 0
      }]);

      let offset = 0;
      const startTime = Date.now();

      while (offset < file.size) {
        const chunk = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
        peer.send(Buffer.from(chunk));
        offset += chunk.byteLength;

        const now = Date.now();
        const duration = (now - startTime) / 1000;
        const speed = duration > 0 ? offset / duration : 0;
        const progress = (offset / file.size) * 100;

        setTransfers(prev => prev.map(t => 
          t.fileId === fileId ? { 
            ...t, 
            progress, 
            transferredSize: offset,
            speed 
          } : t
        ));

        // Small delay to prevent buffer overflow
        if (offset % (CHUNK_SIZE * 10) === 0) {
          await new Promise(r => setTimeout(r, 0));
        }
      }

      peer.send('EOF');
      setTransfers(prev => prev.map(t => 
        t.fileId === fileId ? { ...t, status: 'completed', progress: 100 } : t
      ));
    }
    
    // Reset after all files sent
    setTimeout(() => {
      setMode('idle');
      setSelectedFiles([]);
    }, 2000);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setSelectedFiles(Array.from(e.target.files));
    }
  };

  const initiateTransfer = (targetUser: User) => {
    if (selectedFiles.length === 0) return;
    
    socket?.emit('send-request', {
      to: targetUser.id,
      fromName: deviceName,
      files: selectedFiles.map(f => ({
        name: f.name,
        size: f.size,
        type: f.type,
        lastModified: f.lastModified
      }))
    });
    
    setMode('send');
  };

  const acceptRequest = () => {
    if (!incomingRequest) return;
    socket?.emit('accept-request', { to: incomingRequest.from });
    setIncomingRequest(null);
    setMode('receive');
  };

  const rejectRequest = () => {
    if (!incomingRequest) return;
    socket?.emit('reject-request', { to: incomingRequest.from });
    setIncomingRequest(null);
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) return <ImageIcon className="w-6 h-6 text-blue-500" />;
    if (type.startsWith('video/')) return <Video className="w-6 h-6 text-purple-500" />;
    if (type.startsWith('audio/')) return <Music className="w-6 h-6 text-pink-500" />;
    if (type.includes('pdf') || type.includes('word') || type.includes('text')) return <FileText className="w-6 h-6 text-orange-500" />;
    return <File className="w-6 h-6 text-gray-500" />;
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans selection:bg-blue-100">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 bg-white/80 backdrop-blur-md border-b border-gray-100 z-50">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-200">
              <Share2 className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">SwiftShare</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-full border border-gray-100">
              {connected ? (
                <Wifi className="w-4 h-4 text-green-500" />
              ) : (
                <WifiOff className="w-4 h-4 text-red-500" />
              )}
              <span className="text-sm font-medium text-gray-600">{deviceName}</span>
            </div>
            <button 
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              <Settings className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 pt-24 pb-12">
        <AnimatePresence mode="wait">
          {mode === 'idle' && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              {/* Hero Section */}
              <div className="text-center space-y-4 py-8">
                <h2 className="text-4xl font-extrabold text-gray-900 tracking-tight sm:text-5xl">
                  Share files <span className="text-blue-600">instantly.</span>
                </h2>
                <p className="text-lg text-gray-500 max-w-xl mx-auto">
                  No cables, no cloud, no limits. High-speed peer-to-peer file transfer directly in your browser.
                </p>
              </div>

              {/* Action Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm hover:shadow-xl transition-all group relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                    <Send className="w-32 h-32" />
                  </div>
                  <div className="relative z-10 space-y-6">
                    <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600">
                      <Send className="w-8 h-8" />
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-gray-900">Send Files</h3>
                      <p className="text-gray-500 mt-2">Pick files and find nearby devices to start sharing.</p>
                    </div>
                    <label className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-xl font-semibold hover:bg-blue-700 transition-colors cursor-pointer shadow-lg shadow-blue-200">
                      <input type="file" multiple className="hidden" onChange={handleFileSelect} />
                      Select Files
                    </label>
                    
                    {selectedFiles.length > 0 && (
                      <div className="mt-4 p-4 bg-blue-50/50 rounded-2xl border border-blue-100">
                        <p className="text-sm font-bold text-blue-800 mb-2">{selectedFiles.length} files selected</p>
                        <div className="max-h-32 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                          {selectedFiles.map((f, i) => (
                            <div key={i} className="flex items-center justify-between text-xs text-blue-700">
                              <span className="truncate max-w-[150px]">{f.name}</span>
                              <span>{formatBytes(f.size)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm hover:shadow-xl transition-all group relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                    <Download className="w-32 h-32" />
                  </div>
                  <div className="relative z-10 space-y-6">
                    <div className="w-14 h-14 bg-green-50 rounded-2xl flex items-center justify-center text-green-600">
                      <Download className="w-8 h-8" />
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-gray-900">Receive Files</h3>
                      <p className="text-gray-500 mt-2">Wait for others to send you files. Keep this page open.</p>
                    </div>
                    <div className="flex items-center gap-3 text-green-600 font-medium bg-green-50 px-4 py-2 rounded-lg w-fit">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Discoverable as "{deviceName}"
                    </div>
                    <div className="pt-4">
                      <QRCodeSVG value={window.location.href} size={80} className="rounded-lg border border-gray-100 p-1" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Nearby Devices */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-gray-900">Nearby Devices</h3>
                  <span className="text-sm text-gray-500">{users.length} available</span>
                </div>
                
                {users.length === 0 ? (
                  <div className="bg-white border border-dashed border-gray-200 rounded-2xl p-12 text-center space-y-3">
                    <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mx-auto text-gray-400">
                      <Monitor className="w-6 h-6" />
                    </div>
                    <p className="text-gray-500">No devices found nearby yet.</p>
                    <p className="text-xs text-gray-400">Make sure other devices are on this page.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {users.map((user) => (
                      <button
                        key={user.id}
                        onClick={() => initiateTransfer(user)}
                        disabled={selectedFiles.length === 0}
                        className={cn(
                          "flex items-center justify-between p-4 bg-white rounded-2xl border border-gray-100 transition-all text-left",
                          selectedFiles.length > 0 ? "hover:border-blue-500 hover:shadow-md cursor-pointer" : "opacity-60 cursor-not-allowed"
                        )}
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center text-gray-500 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
                            <Smartphone className="w-6 h-6" />
                          </div>
                          <div>
                            <p className="font-bold text-gray-900">{user.name}</p>
                            <p className="text-xs text-gray-400 uppercase tracking-wider">Ready to connect</p>
                          </div>
                        </div>
                        <ChevronRight className="w-5 h-5 text-gray-300" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {(mode === 'send' || mode === 'receive') && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white rounded-3xl border border-gray-100 shadow-xl p-8 space-y-8"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">
                    {mode === 'send' ? 'Sending Files' : 'Receiving Files'}
                  </h2>
                  <p className="text-gray-500">Peer-to-peer transfer in progress</p>
                </div>
                <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              </div>

              <div className="space-y-6">
                {transfers.map((transfer) => (
                  <div key={transfer.fileId} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {getFileIcon(transfer.fileName.split('.').pop() || '')}
                        <div>
                          <p className="font-semibold text-gray-900 truncate max-w-[200px] sm:max-w-md">
                            {transfer.fileName}
                          </p>
                          <p className="text-xs text-gray-400">
                            {formatBytes(transfer.transferredSize)} of {formatBytes(transfer.totalSize)}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-blue-600">{Math.round(transfer.progress)}%</p>
                        <p className="text-xs text-gray-400">{formatBytes(transfer.speed)}/s</p>
                      </div>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <motion.div 
                        className="h-full bg-blue-600"
                        initial={{ width: 0 }}
                        animate={{ width: `${transfer.progress}%` }}
                        transition={{ type: 'spring', bounce: 0, duration: 0.5 }}
                      />
                    </div>
                    {transfer.status === 'completed' && (
                      <div className="flex items-center gap-1 text-xs text-green-600 font-medium">
                        <Check className="w-3 h-3" />
                        Transfer complete
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {transfers.every(t => t.status === 'completed') && (
                <button
                  onClick={() => {
                    setMode('idle');
                    setTransfers([]);
                    setSelectedFiles([]);
                  }}
                  className="w-full py-3 bg-gray-900 text-white rounded-xl font-bold hover:bg-black transition-colors"
                >
                  Done
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Incoming Request Modal */}
      <AnimatePresence>
        {incomingRequest && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-8 space-y-6">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600">
                    <Download className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-gray-900">Incoming Files</h3>
                    <p className="text-gray-500">From {incomingRequest.fromName}</p>
                  </div>
                </div>

                <div className="bg-gray-50 rounded-2xl p-4 space-y-3 max-h-48 overflow-y-auto custom-scrollbar">
                  {incomingRequest.files.map((file, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {getFileIcon(file.type)}
                        <span className="text-sm font-medium text-gray-700 truncate max-w-[180px]">{file.name}</span>
                      </div>
                      <span className="text-xs text-gray-400">{formatBytes(file.size)}</span>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={rejectRequest}
                    className="py-3 px-6 bg-gray-100 text-gray-600 rounded-xl font-bold hover:bg-gray-200 transition-colors flex items-center justify-center gap-2"
                  >
                    <X className="w-5 h-5" />
                    Decline
                  </button>
                  <button
                    onClick={acceptRequest}
                    className="py-3 px-6 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200 flex items-center justify-center gap-2"
                  >
                    <Check className="w-5 h-5" />
                    Accept
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden"
            >
              <div className="p-8 space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold text-gray-900">Settings</h3>
                  <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-gray-100 rounded-full">
                    <X className="w-5 h-5 text-gray-400" />
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-gray-700">Device Name</label>
                    <input
                      type="text"
                      value={deviceName}
                      onChange={(e) => setDeviceName(e.target.value)}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                      placeholder="Enter device name"
                    />
                  </div>
                </div>

                <button
                  onClick={() => setShowSettings(false)}
                  className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200"
                >
                  Save Changes
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #E5E7EB;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #D1D5DB;
        }
      `}</style>
    </div>
  );
}
