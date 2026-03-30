export interface User {
  id: string;
  name: string;
}

export interface FileInfo {
  name: string;
  size: number;
  type: string;
  lastModified: number;
}

export interface TransferProgress {
  fileId: string;
  fileName: string;
  progress: number;
  speed: number;
  status: 'pending' | 'transferring' | 'completed' | 'failed';
  totalSize: number;
  transferredSize: number;
}

export interface IncomingRequest {
  from: string;
  fromName: string;
  files: FileInfo[];
}
