from __future__ import annotations

from dataclasses import dataclass, replace
import json
import math
from pathlib import Path
import re
from typing import Any, Mapping, Protocol

from runtime.policy import CommandRecognizer, RiskClass, normalize_utterance


MODEL_ID = "Qwen/Qwen3-1.7B"
MODEL_REVISION = "70d244cc86ccca08cf5af4e1e306ecf908b1ad5e"
ROUTES = frozenset({"command", "research", "coding", "browser", "filesystem_read", "hermes", "blocked"})
COST_BANDS = frozenset({"LOCAL_LOW", "LOCAL_MEDIUM", "CLOUD_BOUNDED", "NONE"})


@dataclass(frozen=True, slots=True)
class RouteDecision:
    route: str
    reason_code: str
    confidence: float
    risk_class: RiskClass
    cost_band: str
    deadline_ms: int
    worker_role: str

    def validate(self, allowed_roles: frozenset[str] | None = None) -> None:
        if self.route not in ROUTES:
            raise ValueError(f"unsupported route: {self.route}")
        if not re.fullmatch(r"[A-Z][A-Z0-9_]{1,63}", self.reason_code):
            raise ValueError("reasonCode must be an uppercase stable code")
        if not math.isfinite(self.confidence) or not 0 <= self.confidence <= 1:
            raise ValueError("confidence must be finite and between 0 and 1")
        if self.cost_band not in COST_BANDS:
            raise ValueError(f"unsupported costBand: {self.cost_band}")
        if not 100 <= self.deadline_ms <= 30_000:
            raise ValueError("deadlineMs must be between 100 and 30000")
        if not self.worker_role:
            raise ValueError("workerRole is required")
        if allowed_roles is not None and self.worker_role not in allowed_roles:
            raise ValueError(f"unknown workerRole: {self.worker_role}")

    def as_wire(self) -> dict[str, Any]:
        return {
            "route": self.route,
            "reasonCode": self.reason_code,
            "confidence": self.confidence,
            "riskClass": self.risk_class.value,
            "costBand": self.cost_band,
            "deadlineMs": self.deadline_ms,
            "workerRole": self.worker_role,
        }

    @classmethod
    def from_wire(cls, payload: Mapping[str, Any], allowed_roles: frozenset[str] | None = None) -> "RouteDecision":
        expected = {"route", "reasonCode", "confidence", "riskClass", "costBand", "deadlineMs", "workerRole"}
        if set(payload) != expected:
            raise ValueError(f"route decision fields do not match the strict schema: {sorted(payload)}")
        try:
            decision = cls(
                route=str(payload["route"]),
                reason_code=str(payload["reasonCode"]),
                confidence=float(payload["confidence"]),
                risk_class=RiskClass(str(payload["riskClass"])),
                cost_band=str(payload["costBand"]),
                deadline_ms=int(payload["deadlineMs"]),
                worker_role=str(payload["workerRole"]),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError("invalid route decision values") from exc
        decision.validate(allowed_roles)
        return decision

    @classmethod
    def from_model_wire(cls, payload: Mapping[str, Any], allowed_roles: frozenset[str]) -> "RouteDecision":
        if set(payload) != {"route", "confidence"}:
            raise ValueError(f"model route fields do not match the strict schema: {sorted(payload)}")
        route = str(payload["route"])
        defaults = {
            "command": (RiskClass.READ_ONLY, "NONE", 500, "local-supervisor"),
            "research": (RiskClass.READ_ONLY, "LOCAL_MEDIUM", 15_000, "research"),
            "coding": (RiskClass.LOCAL_REVERSIBLE, "LOCAL_MEDIUM", 15_000, "coding"),
            "browser": (RiskClass.LOCAL_REVERSIBLE, "LOCAL_LOW", 10_000, "browser"),
            "filesystem_read": (RiskClass.READ_ONLY, "LOCAL_LOW", 5_000, "filesystem-read"),
            "hermes": (RiskClass.UNKNOWN, "CLOUD_BOUNDED", 30_000, "hermes"),
            "blocked": (RiskClass.UNKNOWN, "NONE", 500, "local-supervisor"),
        }
        if route not in defaults:
            raise ValueError(f"unsupported model route: {route}")
        risk, cost, deadline, role = defaults[route]
        decision = cls(route, f"MODEL_{route.upper()}", float(payload["confidence"]), risk, cost, deadline, role)
        decision.validate(allowed_roles)
        return decision


class ConfidenceCalibrator:
    def __init__(self, bins: tuple[tuple[float, float], ...] = ((0.0, 0.35), (0.55, 0.60), (0.75, 0.80), (0.9, 0.93))) -> None:
        if not bins or any(not 0 <= boundary <= 1 or not 0 <= calibrated <= 1 for boundary, calibrated in bins):
            raise ValueError("invalid calibration bins")
        self.bins = tuple(sorted(bins))

    def calibrate(self, raw: float) -> float:
        if not math.isfinite(raw):
            return 0.0
        selected = self.bins[0][1]
        for boundary, calibrated in self.bins:
            if raw >= boundary:
                selected = calibrated
        return selected


class SupervisorAdapter(Protocol):
    async def route(self, text: str, *, target_agent_id: str | None = None) -> RouteDecision: ...


class DeterministicSupervisor:
    def __init__(self, roles: frozenset[str] | None = None, calibrator: ConfidenceCalibrator | None = None) -> None:
        self.roles = roles or frozenset({"local-supervisor", "research", "coding", "browser", "filesystem-read", "hermes"})
        self.calibrator = calibrator or ConfidenceCalibrator()
        self.commands = CommandRecognizer()

    async def route(self, text: str, *, target_agent_id: str | None = None) -> RouteDecision:
        if self.commands.recognize(text):
            return self._decision("command", "DETERMINISTIC_COMMAND", 1.0, "local-supervisor", RiskClass.READ_ONLY, "NONE", 500)
        if target_agent_id:
            if target_agent_id not in self.roles or target_agent_id == "local-supervisor":
                return self._decision("blocked", "INVALID_DIRECT_TARGET", 1.0, "local-supervisor", RiskClass.UNKNOWN, "NONE", 500)
            route = "filesystem_read" if target_agent_id == "filesystem-read" else target_agent_id
            return self._decision(route, "VALID_DIRECT_TARGET", 0.95, target_agent_id, RiskClass.UNKNOWN, "LOCAL_LOW", 10_000)

        value = normalize_utterance(text)
        if any(item in value for item in ("typescript", " code", "代码", "修复", "refactor", "function", "bug")):
            return self._decision("coding", "CODE_TASK", 0.91, "coding", RiskClass.LOCAL_REVERSIBLE, "LOCAL_MEDIUM", 15_000)
        if any(item in value for item in ("localhost", "dashboard", "网页", "browser", "open ", "打开")):
            return self._decision("browser", "LOCAL_BROWSER_TASK", 0.86, "browser", RiskClass.LOCAL_REVERSIBLE, "LOCAL_LOW", 10_000)
        if any(item in value for item in ("list files", "列出文件", "不要修改", "without changing")):
            return self._decision("filesystem_read", "FILESYSTEM_READ", 0.96, "filesystem-read", RiskClass.READ_ONLY, "LOCAL_LOW", 5_000)
        if any(item in value for item in ("docs", "文档", "research", "总结", "summarize", "report", "benchmark")):
            return self._decision("research", "RESEARCH_TASK", 0.87, "research", RiskClass.READ_ONLY, "LOCAL_MEDIUM", 15_000)
        return self._decision("hermes", "LOW_LOCAL_CONFIDENCE", 0.35, "hermes", RiskClass.UNKNOWN, "CLOUD_BOUNDED", 30_000)

    def _decision(self, route: str, code: str, raw: float, role: str, risk: RiskClass, cost: str, deadline: int) -> RouteDecision:
        confidence = raw if raw == 1.0 else self.calibrator.calibrate(raw)
        decision = RouteDecision(route, code, confidence, risk, cost, deadline, role)
        decision.validate(self.roles)
        return decision


class QwenSupervisorAdapter:
    def __init__(self, *, quantization: str = "nf4", device: str = "cuda", model_path: str | None = None, allowed_roles: frozenset[str] | None = None, max_new_tokens: int = 160, calibrator: ConfidenceCalibrator | None = None) -> None:
        if quantization not in {"bf16", "nf4"}:
            raise ValueError("quantization must be bf16 or nf4")
        if device not in {"cuda", "cpu"}:
            raise ValueError("device must be cuda or cpu")
        self.quantization = quantization
        self.device = device
        self.model_path = model_path
        self.allowed_roles = allowed_roles or frozenset({"local-supervisor", "research", "coding", "browser", "filesystem-read", "hermes"})
        self.max_new_tokens = max_new_tokens
        self.calibrator = calibrator or ConfidenceCalibrator()
        self._model = None
        self._tokenizer = None

    def load(self) -> None:
        if self._model is not None:
            return
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
        from transformers import modeling_utils

        device_target: Any = 0 if self.device == "cuda" else "cpu"
        source = self.model_path or MODEL_ID
        kwargs: dict[str, Any] = {"device_map": {"": device_target}, "dtype": torch.bfloat16}
        if self.model_path:
            manifest_path = Path(self.model_path) / "source-manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if manifest.get("sourceModel") != MODEL_ID or manifest.get("sourceRevision") != MODEL_REVISION:
                raise ValueError("local Supervisor artifact provenance does not match the pinned official revision")
        else:
            kwargs["revision"] = MODEL_REVISION
        if self.quantization == "nf4" and not self.model_path:
            kwargs["quantization_config"] = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=torch.bfloat16,
                bnb_4bit_use_double_quant=True,
            )
        tokenizer_kwargs = {"fix_mistral_regex": True} if self.model_path else {"revision": MODEL_REVISION}
        self._tokenizer = AutoTokenizer.from_pretrained(source, **tokenizer_kwargs)
        original_warmup = modeling_utils.caching_allocator_warmup
        if self.quantization == "nf4":
            # Transformers 4.57's one-shot allocator warmup misreads free CUDA
            # memory when a vLLM EngineCore owns the same WSL GPU. Incremental
            # parameter allocation avoids that optimization-only 1.6 GiB spike.
            modeling_utils.caching_allocator_warmup = lambda *args, **values: None
        try:
            self._model = AutoModelForCausalLM.from_pretrained(source, **kwargs).eval()
        finally:
            modeling_utils.caching_allocator_warmup = original_warmup

    async def route(self, text: str, *, target_agent_id: str | None = None) -> RouteDecision:
        import asyncio
        if target_agent_id:
            return await DeterministicSupervisor(self.allowed_roles).route(text, target_agent_id=target_agent_id)
        return await asyncio.to_thread(self._route_sync, text, target_agent_id)

    def _route_sync(self, text: str, target_agent_id: str | None) -> RouteDecision:
        self.load()
        import torch
        schema = (
            "Return exactly one JSON object and nothing else, with exactly two keys: route and confidence. "
            "route must be command|research|coding|browser|filesystem_read|hermes|blocked. "
            "Use command only for exact stop/cancel/continue/status/repeat commands; filesystem_read for listing "
            "files without changes; coding for code changes; browser for opening localhost pages; research for "
            "reading/summarizing documents; hermes only when local classification is genuinely uncertain. Browser "
            "is only for an actual web page or localhost UI; words meaning view/read do not imply browser. Map routes "
            "Examples: 查看项目文档->research; Review the architecture docs->research; "
            "检查这段代码->coding; Open the local dashboard->browser; 列出文件但不要修改->filesystem_read. "
            "Use confidence 0..1."
        )
        prompt = f"{schema}\nRequested target: {target_agent_id or 'none'}\nUser utterance: {text}"
        messages = [{"role": "system", "content": "You are a narrow bilingual routing classifier. Never execute the request."}, {"role": "user", "content": prompt}]
        rendered = self._tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False) + "{"
        inputs = self._tokenizer(rendered, return_tensors="pt").to(self._model.device)
        with torch.inference_mode():
            output = self._model.generate(
                **inputs,
                max_new_tokens=self.max_new_tokens,
                do_sample=False,
                stop_strings=["}"],
                tokenizer=self._tokenizer,
            )
        decoded = ("{" + self._tokenizer.decode(output[0][inputs.input_ids.shape[1]:], skip_special_tokens=True)).strip()
        if not decoded.startswith("{") or not decoded.endswith("}"):
            raise ValueError(f"Supervisor returned content outside the JSON object: {decoded[:512]!r}")
        payload = json.loads(decoded)
        decision = RouteDecision.from_model_wire(payload, self.allowed_roles)
        calibrated = replace(decision, confidence=self.calibrator.calibrate(decision.confidence))
        calibrated.validate(self.allowed_roles)
        return calibrated
