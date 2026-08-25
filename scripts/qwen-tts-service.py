from __future__ import annotations

import argparse
from array import array
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.metadata
import json
import math
import os
from threading import BoundedSemaphore, Lock


MODEL_ID = "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice"
MODEL_REVISION = "85e237c12c027371202489a0ec509ded67b5e4b5"
MAX_REQUEST_BYTES = 4_096
MAX_TEXT_CHARACTERS = 220
MAX_AUDIO_SECONDS = 30


class QwenService:
    def __init__(self, device: str) -> None:
        import torch
        from huggingface_hub import snapshot_download
        from qwen_tts import Qwen3TTSModel

        dtype = torch.bfloat16 if device.startswith("cuda") else torch.float32
        snapshot_path = snapshot_download(repo_id=MODEL_ID, revision=MODEL_REVISION)
        self.model = Qwen3TTSModel.from_pretrained(
            snapshot_path,
            device_map=device,
            dtype=dtype,
            attn_implementation="sdpa",
        )
        self.device = device
        self.qwen_tts_version = importlib.metadata.version("qwen-tts")
        self.torch_version = importlib.metadata.version("torch")
        self.inference = BoundedSemaphore(1)
        self.waiting = 0
        self.waiting_lock = Lock()

    def synthesize(self, text: str, language: str, speaker: str) -> tuple[bytes, int]:
        if not text or len(text) > MAX_TEXT_CHARACTERS:
            raise ValueError("text is empty or exceeds the clause limit")
        if (language, speaker) not in {("Chinese", "Vivian"), ("English", "Ryan")}:
            raise ValueError("language/speaker is outside the fixed profile")
        with self.waiting_lock:
            if self.waiting >= 2:
                raise RuntimeError("TTS queue is full")
            self.waiting += 1
        try:
            with self.inference:
                wavs, sample_rate = self.model.generate_custom_voice(
                    text=text,
                    language=language,
                    speaker=speaker,
                    non_streaming_mode=True,
                    max_new_tokens=min(2_048, max(96, len(text) * 14)),
                )
        finally:
            with self.waiting_lock:
                self.waiting -= 1
        samples = array("f", (max(-1.0, min(1.0, float(value))) for value in wavs[0]))
        if sample_rate != 24_000 or not samples or len(samples) > sample_rate * MAX_AUDIO_SECONDS:
            raise ValueError("model returned an invalid audio envelope")
        if any(not math.isfinite(value) for value in samples):
            raise ValueError("model returned non-finite audio")
        if os.sys.byteorder != "little":
            samples.byteswap()
        return samples.tobytes(), sample_rate


def make_handler(service: QwenService):
    class Handler(BaseHTTPRequestHandler):
        server_version = "LiveAgentQwenTTS/1"

        def do_GET(self) -> None:
            if self.path != "/health":
                self.send_error(404)
                return
            payload = json.dumps({
                "status": "ok", "model": MODEL_ID, "revision": MODEL_REVISION, "device": service.device,
                "qwenTtsVersion": service.qwen_tts_version, "torchVersion": service.torch_version,
            }).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_POST(self) -> None:
            if self.path != "/synthesize":
                self.send_error(404)
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 1 <= length <= MAX_REQUEST_BYTES:
                    raise ValueError("invalid request size")
                data = json.loads(self.rfile.read(length).decode("utf-8"))
                if set(data) != {"text", "language", "speaker"}:
                    raise ValueError("request fields do not match the strict schema")
                payload, sample_rate = service.synthesize(str(data["text"]), str(data["language"]), str(data["speaker"]))
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("X-Audio-Encoding", "pcm_f32le")
                self.send_header("X-Sample-Rate-Hz", str(sample_rate))
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            except RuntimeError:
                self.send_error(429, "TTS queue full")
            except (ValueError, TypeError, json.JSONDecodeError):
                self.send_error(400, "invalid synthesis request")
            except Exception:
                self.send_error(500, "synthesis failed")

        def log_message(self, format: str, *args) -> None:
            # Never log request content or audio. Status/path metadata is sufficient.
            print(f"[Qwen TTS] {self.address_string()} {format % args}")

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8770)
    parser.add_argument("--device", default="cuda:0")
    args = parser.parse_args()
    if args.host != "127.0.0.1":
        raise SystemExit("Qwen TTS service is localhost-only")
    service = QwenService(args.device)
    server = ThreadingHTTPServer((args.host, args.port), make_handler(service))
    print(f"[Qwen TTS] ready on http://{args.host}:{args.port} at revision {MODEL_REVISION}")
    server.serve_forever()


if __name__ == "__main__":
    main()
