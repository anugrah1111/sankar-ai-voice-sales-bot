let pendingStream: MediaStream | null = null;

export function setPendingStream(stream: MediaStream | null): void {
  pendingStream = stream;
}

export function takePendingStream(): MediaStream | null {
  const stream = pendingStream;
  pendingStream = null;
  return stream;
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}
