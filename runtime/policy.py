from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
import re
import unicodedata


class CommandType(StrEnum):
    STOP_SPEAKING = "STOP_SPEAKING"
    CANCEL_TASK = "CANCEL_TASK"
    CONTINUE = "CONTINUE"
    STATUS = "STATUS"
    REPEAT = "REPEAT"


class PolicyDecision(StrEnum):
    ALLOW_READ_ONLY = "ALLOW_READ_ONLY"
    ALLOW_LOCAL_REVERSIBLE = "ALLOW_LOCAL_REVERSIBLE"
    BLOCKED_POLICY = "BLOCKED_POLICY"


class RiskClass(StrEnum):
    READ_ONLY = "READ_ONLY"
    LOCAL_REVERSIBLE = "LOCAL_REVERSIBLE"
    EXTERNAL = "EXTERNAL"
    PAID = "PAID"
    IRREVERSIBLE = "IRREVERSIBLE"
    HIGH_IMPACT = "HIGH_IMPACT"
    UNKNOWN = "UNKNOWN"


def normalize_utterance(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text).strip().casefold()
    normalized = re.sub(r"[.!?。！？,，;；:：]+$", "", normalized)
    return re.sub(r"\s+", " ", normalized).strip()


_COMMAND_PHRASES: dict[str, CommandType] = {
    "stop speaking": CommandType.STOP_SPEAKING,
    "stop talking": CommandType.STOP_SPEAKING,
    "听我说": CommandType.STOP_SPEAKING,
    "先别说话": CommandType.STOP_SPEAKING,
    "stop speaking 先别说话": CommandType.STOP_SPEAKING,
    "cancel task": CommandType.CANCEL_TASK,
    "cancel the task": CommandType.CANCEL_TASK,
    "取消任务": CommandType.CANCEL_TASK,
    "继续": CommandType.CONTINUE,
    "continue": CommandType.CONTINUE,
    "resume": CommandType.CONTINUE,
    "status": CommandType.STATUS,
    "current status": CommandType.STATUS,
    "tell me the current status": CommandType.STATUS,
    "告诉我当前状态": CommandType.STATUS,
    "告诉我 current status": CommandType.STATUS,
    "repeat": CommandType.REPEAT,
    "repeat that": CommandType.REPEAT,
    "再说一遍": CommandType.REPEAT,
}


class CommandRecognizer:
    def recognize(self, text: str) -> CommandType | None:
        return _COMMAND_PHRASES.get(normalize_utterance(text))


@dataclass(frozen=True, slots=True)
class ActionRequest:
    capability: str
    text: str = ""
    declared_risk: RiskClass = RiskClass.UNKNOWN


@dataclass(frozen=True, slots=True)
class PolicyResult:
    decision: PolicyDecision
    risk_class: RiskClass
    reason_code: str

    @property
    def allowed(self) -> bool:
        return self.decision is not PolicyDecision.BLOCKED_POLICY


READ_ONLY_CAPABILITIES = frozenset(
    {"read_file", "list_files", "search_local", "read_docs", "inspect_status", "research_read"}
)
LOCAL_REVERSIBLE_CAPABILITIES = frozenset(
    {"format_workspace", "run_tests", "build_local", "edit_workspace", "open_local_url"}
)
BLOCKED_RISKS = frozenset(
    {RiskClass.EXTERNAL, RiskClass.PAID, RiskClass.IRREVERSIBLE, RiskClass.HIGH_IMPACT}
)

_TEXT_RISKS: tuple[tuple[RiskClass, tuple[str, ...]], ...] = (
    (RiskClass.PAID, ("buy ", "purchase", "transfer money", "付款", "购买", "转账")),
    (RiskClass.HIGH_IMPACT, ("disable the firewall", "change security", "credential", "permission", "禁用防火墙", "修改权限")),
    (RiskClass.IRREVERSIBLE, ("delete ", "erase ", "remove permanently", "删除", "清空")),
    (RiskClass.EXTERNAL, ("send email", "publish", "post publicly", "deploy publicly", "external action", "发送邮件", "公开发布", "部署到公网")),
)


class ExecutionPolicy:
    def classify_text(self, text: str) -> RiskClass:
        normalized = normalize_utterance(text)
        for risk, markers in _TEXT_RISKS:
            if any(marker in normalized for marker in markers):
                return risk
        if any(marker in normalized for marker in ("read ", "list ", "查看", "列出", "summarize", "总结")):
            return RiskClass.READ_ONLY
        if any(marker in normalized for marker in ("format ", "run deterministic tests", "运行测试", "build local")):
            return RiskClass.LOCAL_REVERSIBLE
        return RiskClass.UNKNOWN

    def evaluate(self, request: ActionRequest) -> PolicyResult:
        inferred = self.classify_text(request.text) if request.text else RiskClass.UNKNOWN
        risk = request.declared_risk if request.declared_risk is not RiskClass.UNKNOWN else inferred
        if risk in BLOCKED_RISKS:
            return PolicyResult(PolicyDecision.BLOCKED_POLICY, risk, f"BLOCKED_{risk.value}")
        if request.capability in READ_ONLY_CAPABILITIES and risk in {RiskClass.READ_ONLY, RiskClass.UNKNOWN}:
            return PolicyResult(PolicyDecision.ALLOW_READ_ONLY, RiskClass.READ_ONLY, "ALLOWLIST_READ_ONLY")
        if request.capability in LOCAL_REVERSIBLE_CAPABILITIES and risk in {RiskClass.LOCAL_REVERSIBLE, RiskClass.UNKNOWN}:
            return PolicyResult(PolicyDecision.ALLOW_LOCAL_REVERSIBLE, RiskClass.LOCAL_REVERSIBLE, "ALLOWLIST_LOCAL_REVERSIBLE")
        return PolicyResult(PolicyDecision.BLOCKED_POLICY, risk, "CAPABILITY_NOT_ALLOWLISTED")

    def classify_fixture(self, text: str) -> PolicyResult:
        risk = self.classify_text(text)
        capability = {
            RiskClass.READ_ONLY: "read_docs",
            RiskClass.LOCAL_REVERSIBLE: "run_tests" if "test" in normalize_utterance(text) else "format_workspace",
        }.get(risk, "unknown")
        return self.evaluate(ActionRequest(capability=capability, text=text, declared_risk=risk))
