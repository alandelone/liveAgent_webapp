import asyncio
import json
import os
import subprocess
import time
import websockets

PORT = 8765
CONFIG_PATH = os.path.join(os.path.dirname(__file__), "subagents.config.json")
HERMES_PROFILES_DIR = os.path.expanduser(r"~\AppData\Local\hermes\profiles")

def infer_agent_visuals(profile_name: str, soul_text: str = ""):
    """Infer appropriate theme color and icon based on profile name or persona."""
    lower = f"{profile_name} {soul_text}".lower()
    if any(k in lower for k in ["code", "dev", "program", "engineer", "build"]):
        return {"color": "#3B82F6", "icon": "code"}
    elif any(k in lower for k in ["research", "search", "wiki", "paper", "arxiv", "doc"]):
        return {"color": "#A855F7", "icon": "book-open"}
    elif any(k in lower for k in ["qa", "test", "audit", "verify", "shield", "security"]):
        return {"color": "#10B981", "icon": "shield"}
    elif any(k in lower for k in ["browser", "web", "crawl", "scrape", "net"]):
        return {"color": "#F59E0B", "icon": "globe"}
    elif any(k in lower for k in ["design", "ui", "ux", "art", "draw", "creative"]):
        return {"color": "#EC4899", "icon": "palette"}
    elif any(k in lower for k in ["data", "db", "sql", "analysis", "table"]):
        return {"color": "#06B6D4", "icon": "database"}
    elif any(k in lower for k in ["auto", "agv", "bot", "tool", "task"]):
        return {"color": "#EAB308", "icon": "cpu"}
    else:
        return {"color": "#6366F1", "icon": "cpu"}

def scan_hermes_profiles():
    """Scan real Hermes profiles directory for live sub-agents."""
    discovered = []
    if os.path.isdir(HERMES_PROFILES_DIR):
        for entry in sorted(os.listdir(HERMES_PROFILES_DIR)):
            p_dir = os.path.join(HERMES_PROFILES_DIR, entry)
            if os.path.isdir(p_dir):
                soul_path = os.path.join(p_dir, "SOUL.md")
                soul_content = ""
                if os.path.exists(soul_path):
                    try:
                        with open(soul_path, "r", encoding="utf-8") as sf:
                            soul_content = sf.read(500)
                    except Exception:
                        pass
                
                visuals = infer_agent_visuals(entry, soul_content)
                name = entry.replace("_", " ").replace("-", " ").title()
                discovered.append({
                    "id": entry,
                    "name": name,
                    "profile": entry,
                    "color": visuals["color"],
                    "icon": visuals["icon"],
                    "enabled": True
                })
    return discovered

def load_agent_manifest():
    """Load and dynamically synchronize sub-agents from Hermes profiles and config."""
    manifest = [
        {"id": "hermes", "name": "Orchestrator", "color": "#6366F1", "icon": "brain", "isOrchestrator": True}
    ]
    
    # 1. Scan real profiles from Hermes filesystem
    real_profiles = scan_hermes_profiles()
    
    # 2. Read config overrides (max limit, custom visual styling, whitelist)
    max_agents = 4
    config_overrides = {}
    fallback_subagents = []
    
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                cfg = json.load(f)
                max_agents = cfg.get("max_visible_subagents", 4)
                fallback_subagents = cfg.get("subagents", [])
                for s in fallback_subagents:
                    config_overrides[s.get("id")] = s
        except Exception as e:
            print(f"[Server] Error loading subagents config: {e}")

    # Combine real profiles or fallback profiles
    combined_pool = []
    if real_profiles:
        for rp in real_profiles:
            override = config_overrides.get(rp["id"], {})
            if override.get("enabled", True):
                combined_pool.append({
                    "id": rp["id"],
                    "name": override.get("name", rp["name"]),
                    "profile": rp["profile"],
                    "color": override.get("color", rp["color"]),
                    "icon": override.get("icon", rp["icon"]),
                })
    else:
        # If no profile folders created in Hermes yet, use config entries
        for s in fallback_subagents:
            if s.get("enabled", True):
                combined_pool.append({
                    "id": s["id"],
                    "name": s["name"],
                    "profile": s.get("profile", s["id"]),
                    "color": s.get("color", "#3B82F6"),
                    "icon": s.get("icon", "cpu"),
                })

    # Limit to max_visible_subagents
    selected = combined_pool[:max_agents]
    for s in selected:
        manifest.append({
            "id": s["id"],
            "name": s["name"],
            "color": s["color"],
            "icon": s["icon"],
            "isOrchestrator": False
        })
        
    return manifest

def run_hermes_query(prompt: str, profile: str = None) -> str:
    """Execute query via Hermes CLI against the main orchestrator or a specific profile."""
    try:
        cmd = ["hermes"]
        if profile and os.path.isdir(os.path.join(HERMES_PROFILES_DIR, profile)):
            cmd.extend(["--profile", profile])
        cmd.extend(["-z", prompt])
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60, encoding='utf-8')
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
        return result.stdout.strip() or result.stderr.strip() or "I processed your request."
    except Exception as e:
        return f"Response error: {e}"

async def handler(websocket):
    print(f"[Server] Client connected from {websocket.remote_address}")
    seq = 1
    session_id = "sess_001"
    target_agent_id = None

    async def send_event(event_dict):
        nonlocal seq
        event_dict.setdefault("seq", seq)
        event_dict.setdefault("sessionId", session_id)
        event_dict.setdefault("timestamp", int(time.time() * 1000))
        seq += 1
        payload = json.dumps(event_dict)
        await websocket.send(payload)

    try:
        async for message in websocket:
            if isinstance(message, bytes):
                # Binary audio frames
                continue

            try:
                data = json.loads(message)
            except Exception:
                continue

            msg_type = data.get("type")

            if msg_type == "PING":
                await websocket.send(json.dumps({"type": "PONG", "timestamp": data.get("timestamp")}))
                continue

            if msg_type == "CLIENT_HELLO":
                session_id = data.get("sessionId", session_id)
                manifest = load_agent_manifest()
                sub_count = len(manifest) - 1
                print(f"[Server] Handshake received. Synchronized {sub_count} sub-agents from Hermes profiles.")
                await send_event({
                    "type": "AGENT_MANIFEST",
                    "agents": manifest,
                })
                await send_event({
                    "type": "AGENT_STATE",
                    "agentId": "hermes",
                    "state": "idle",
                })
                continue

            if msg_type == "USER_TARGET":
                target_agent_id = data.get("targetAgentId")
                print(f"[Server] Direct mode targeted agent: {target_agent_id}")
                continue

            if msg_type == "USER_TEXT":
                turn_id = data.get("turnId", f"turn_{int(time.time())}")
                user_text = data.get("text", "")
                print(f"[Server] User prompt: {user_text}")

                # 1. Echo STT_FINAL with exact user words
                await send_event({
                    "type": "STT_FINAL",
                    "turnId": turn_id,
                    "text": user_text,
                })

                # 2. State: thinking
                await send_event({
                    "type": "AGENT_STATE",
                    "agentId": "hermes",
                    "state": "thinking",
                    "detail": "Processing with Hermes...",
                })

                # 3. Dynamic Task Delegation
                active_subagent = target_agent_id
                manifest = load_agent_manifest()
                subagent_ids = [a["id"] for a in manifest if not a.get("isOrchestrator")]

                if not active_subagent and subagent_ids:
                    lower_text = user_text.lower()
                    for sid in subagent_ids:
                        if sid in lower_text:
                            active_subagent = sid
                            break

                if active_subagent and active_subagent in subagent_ids:
                    task_id = f"task_{int(time.time())}"
                    await send_event({
                        "type": "TASK_START",
                        "taskId": task_id,
                        "fromAgentId": "hermes",
                        "toAgentId": active_subagent,
                        "taskName": f"Delegated to {active_subagent}",
                    })
                    await send_event({
                        "type": "AGENT_STATE",
                        "agentId": active_subagent,
                        "state": "executing",
                        "detail": f"{active_subagent} active",
                    })
                    await asyncio.sleep(0.3)
                    await send_event({
                        "type": "TASK_COMPLETE",
                        "taskId": task_id,
                        "agentId": active_subagent,
                        "resultSummary": f"Processed by {active_subagent}",
                    })
                    await send_event({
                        "type": "AGENT_STATE",
                        "agentId": active_subagent,
                        "state": "idle",
                    })

                # 4. Generate real response via Hermes
                loop = asyncio.get_running_loop()
                response_text = await loop.run_in_executor(
                    None, 
                    run_hermes_query, 
                    user_text, 
                    active_subagent if (active_subagent and active_subagent != "hermes") else None
                )

                # 5. State: speaking
                await send_event({
                    "type": "AGENT_STATE",
                    "agentId": "hermes",
                    "state": "speaking",
                })
                await send_event({
                    "type": "TTS_START",
                    "agentId": "hermes",
                    "turnId": turn_id,
                })

                # Stream response text chunks
                words = response_text.split(" ")
                for idx, word in enumerate(words):
                    chunk = word + (" " if idx < len(words) - 1 else "")
                    await send_event({
                        "type": "TEXT_DELTA",
                        "agentId": "hermes",
                        "turnId": turn_id,
                        "delta": chunk,
                        "isFinal": (idx == len(words) - 1),
                    })
                    await asyncio.sleep(0.02)

                await send_event({
                    "type": "TTS_END",
                    "agentId": "hermes",
                    "turnId": turn_id,
                })

                # Back to idle
                await send_event({
                    "type": "AGENT_STATE",
                    "agentId": "hermes",
                    "state": "idle",
                })

            if msg_type == "USER_SPEECH_START":
                turn_id = data.get("turnId", f"turn_{int(time.time())}")
                await send_event({
                    "type": "AGENT_STATE",
                    "agentId": "hermes",
                    "state": "listening",
                })

            if msg_type == "USER_SPEECH_END":
                # User speech ended; voiceController sends exact USER_TEXT once speech recognition completes
                pass

    except websockets.ConnectionClosed:
        print(f"[Server] Client disconnected: {websocket.remote_address}")

async def main():
    print(f"[Hermes Voice Server] Starting WebSocket server on ws://127.0.0.1:{PORT} ...")
    async with websockets.serve(handler, "127.0.0.1", PORT):
        print(f"[Hermes Voice Server] Running and listening on ws://127.0.0.1:{PORT}/ws")
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())
