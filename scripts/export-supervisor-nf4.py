from __future__ import annotations

import argparse
import json
from pathlib import Path

from runtime.supervisor import MODEL_ID, MODEL_REVISION, QwenSupervisorAdapter


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if output.exists() and any(output.iterdir()):
        raise SystemExit(f"refusing to overwrite non-empty output: {output}")
    output.mkdir(parents=True, exist_ok=True)

    adapter = QwenSupervisorAdapter(quantization="nf4", device="cpu")
    adapter.load()
    adapter._model.save_pretrained(output, safe_serialization=True)
    adapter._tokenizer.save_pretrained(output)
    (output / "source-manifest.json").write_text(
        json.dumps(
            {
                "sourceModel": MODEL_ID,
                "sourceRevision": MODEL_REVISION,
                "quantization": "bitsandbytes-nf4",
                "computeDtype": "bfloat16",
                "doubleQuantization": True,
            },
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
