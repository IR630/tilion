import { useEffect, useRef, useState } from "react";

export function CanvasRecorder({ onStart, onStop }: { onStart: () => void; onStop?: () => void }) {
  const recorder = useRef<MediaRecorder | null>(null);
  const captured = useRef<HTMLCanvasElement | null>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    const r = recorder.current;
    if (!r) return;
    r.onstop = null;
    if (r.state !== "inactive") r.stop();
    r.stream.getTracks().forEach((track) => track.stop());
    captured.current?.removeAttribute("data-recording");
  }, []);

  if (new URLSearchParams(window.location.search).get("rec") !== "1") return null;

  const start = () => {
    setError(null);
    const canvas = document.querySelector<HTMLCanvasElement>(
      '.globe canvas[data-ready="1"], .terrain3d canvas[data-ready="1"]',
    );
    if (!canvas) {
      setError("Open Globe or 3D terrain and wait for it to load.");
      return;
    }
    let stream: MediaStream | undefined;
    try {
      if (typeof MediaRecorder === "undefined" || !canvas.captureStream) {
        throw new Error("Canvas recording is not supported in this browser.");
      }
      const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8"].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error("WebM recording is not supported in this browser.");
      stream = canvas.captureStream(60);
      const r = new MediaRecorder(stream, { mimeType });
      const chunks: Blob[] = [];
      const utc = new Date().toISOString().slice(0, 19).replaceAll(":", "-") + "Z";
      let failed = false;
      r.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      r.onerror = () => {
        failed = true;
        setError("Recording failed. Try again or use another browser.");
      };
      r.onstop = () => {
        r.stream.getTracks().forEach((track) => track.stop());
        canvas.removeAttribute("data-recording");
        recorder.current = null;
        setRecording(false);
        onStop?.();
        if (failed || !chunks.length) return;
        const url = URL.createObjectURL(new Blob(chunks, { type: r.mimeType }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `tilion-${utc}.webm`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      };
      r.start();
      captured.current = canvas;
      canvas.dataset.recording = "1";
      recorder.current = r;
      setRecording(true);
      onStart();
    } catch (e) {
      stream?.getTracks().forEach((track) => track.stop());
      canvas.removeAttribute("data-recording");
      setError(String(e));
    }
  };

  return (
    <>
      <button type="button" aria-pressed={recording} onClick={() => recording ? recorder.current?.stop() : start()}>
        {recording ? "Stop recording" : "Rec"}
      </button>
      {error && <span role="alert">{error}</span>}
    </>
  );
}
