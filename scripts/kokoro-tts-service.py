from __future__ import annotations

import argparse
from array import array
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.metadata
import json
import math
import ipaddress
import os
from pathlib import Path
from threading import BoundedSemaphore, Lock


MODEL_ID = "hexgrad/Kokoro-82M-v1.1-zh"
MODEL_REVISION = "01e7505bd6a7a2ac4975463114c3a7650a9f7218"
MODEL_FILENAME = "kokoro-v1_1-zh.pth"
MAX_REQUEST_BYTES = 4_096
MAX_TEXT_CHARACTERS = 220
MAX_AUDIO_SECONDS = 30
SAMPLE_RATE = 24_000


class QueueFullError(RuntimeError):
    pass


class KokoroService:
    def __init__(self, device: str) -> None:
        import numpy as np
        import torch
        from huggingface_hub import snapshot_download
        from kokoro import KModel, KPipeline

        if device not in {"cpu", "cuda"} or (device == "cuda" and not torch.cuda.is_available()):
            raise ValueError("requested Kokoro device is unavailable")
        snapshot = Path(snapshot_download(
            repo_id=MODEL_ID,
            revision=MODEL_REVISION,
            allow_patterns=["config.json", MODEL_FILENAME, "voices/af_maple.pt", "voices/zf_001.pt"],
        ))
        self.model = KModel(
            repo_id=MODEL_ID,
            config=str(snapshot / "config.json"),
            model=str(snapshot / MODEL_FILENAME),
        ).to(device).eval()
        english_g2p = KPipeline(lang_code="a", repo_id=MODEL_ID, model=False, device=device)

        def english_phonemes(text: str) -> str:
            return next(english_g2p(text)).phonemes

        self.chinese = KPipeline(
            lang_code="z", repo_id=MODEL_ID, model=self.model, device=device, en_callable=english_phonemes,
        )
        self.english = KPipeline(lang_code="a", repo_id=MODEL_ID, model=self.model, device=device)
        self.voices = {
            # Kokoro 0.9.4 recognizes torch.FloatTensor (CPU) explicitly before
            # moving the voice pack to the model device. Loading a CUDA tensor
            # here makes it fall through to the string-voice branch.
            "Ryan": torch.load(snapshot / "voices" / "af_maple.pt", map_location="cpu", weights_only=True),
            "Vivian": torch.load(snapshot / "voices" / "zf_001.pt", map_location="cpu", weights_only=True),
        }
        self.np = np
        self.device = device
        self.kokoro_version = importlib.metadata.version("kokoro")
        self.misaki_version = importlib.metadata.version("misaki")
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
                raise QueueFullError("TTS queue is full")
            self.waiting += 1
        try:
            pipeline = self.chinese if language == "Chinese" else self.english
            with self.inference:
                chunks = [result.audio.detach().cpu().numpy() for result in pipeline(text, voice=self.voices[speaker])]
        finally:
            with self.waiting_lock:
                self.waiting -= 1
        if not chunks:
            raise ValueError("model returned empty audio")
        waveform = self.np.concatenate(chunks).astype("float32", copy=False)
        samples = array("f", (max(-1.0, min(1.0, float(value))) for value in waveform))
        if not samples or len(samples) > SAMPLE_RATE * MAX_AUDIO_SECONDS:
            raise ValueError("model returned an invalid audio envelope")
        if any(not math.isfinite(value) for value in samples):
            raise ValueError("model returned non-finite audio")
        if os.sys.byteorder != "little":
            samples.byteswap()
        return samples.tobytes(), SAMPLE_RATE


def make_handler(service: KokoroService):
    class Handler(BaseHTTPRequestHandler):
        server_version = "LiveAgentKokoroTTS/1"

        def do_GET(self) -> None:
            if self.path != "/health":
                self.send_error(404)
                return
            payload = json.dumps({
                "status": "ok", "model": MODEL_ID, "revision": MODEL_REVISION, "device": service.device,
                "kokoroVersion": service.kokoro_version, "misakiVersion": service.misaki_version,
                "torchVersion": service.torch_version,
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
            except QueueFullError:
                self.send_error(429, "TTS queue full")
            except (ValueError, TypeError, json.JSONDecodeError) as exc:
                print(f"[Kokoro TTS] invalid synthesis request: {type(exc).__name__}: {exc}", flush=True)
                self.send_error(400, "invalid synthesis request")
            except Exception as exc:
                print(f"[Kokoro TTS] synthesis error: {type(exc).__name__}: {exc}", flush=True)
                self.send_error(500, "synthesis failed")

        def log_message(self, format: str, *args) -> None:
            print(f"[Kokoro TTS] {self.address_string()} {format % args}")

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8771)
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    parser.add_argument("--allow-wsl-host-interface", action="store_true")
    args = parser.parse_args()
    try:
        host_address = ipaddress.ip_address(args.host)
    except ValueError as exc:
        raise SystemExit("Kokoro TTS host must be an explicit IPv4 address") from exc
    if host_address.version != 4 or (not host_address.is_loopback and not (args.allow_wsl_host_interface and host_address.is_private)):
        raise SystemExit("Kokoro TTS host must be loopback or an explicitly approved private WSL host interface")
    service = KokoroService(args.device)
    server = ThreadingHTTPServer((args.host, args.port), make_handler(service))
    print(f"[Kokoro TTS] ready on http://{args.host}:{args.port} at revision {MODEL_REVISION}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
