"""经真实 HTTP 代理测量答案增量与首段正文延迟，不把状态或标题算作正文。"""

import argparse
import json
import os
import re
import time
from pathlib import Path

import httpx


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://frontend/api/v1")
    parser.add_argument("--dataset", type=Path, default=Path("/app/data/samples/qa_100_from_raw.json"))
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--output", type=Path, default=Path("/app/data/processed/stream_benchmark.json"))
    args = parser.parse_args()
    if args.limit < 1:
        parser.error("limit 必须为正数")
    cases = json.loads(args.dataset.read_text(encoding="utf-8"))[:args.limit]
    rows = []
    with httpx.Client(timeout=65) as client:
        login = client.post(args.base_url.rstrip("/") + "/auth/login", json={
            "username": os.getenv("ADMIN_BOOTSTRAP_USERNAME", "admin"),
            "password": os.getenv("ADMIN_BOOTSTRAP_PASSWORD") or "finrag2026",
        })
        login.raise_for_status()
        headers = {"Authorization": "Bearer " + login.json()["access_token"]}
        for case in cases:
            start = time.perf_counter()
            row = {"id": case["id"], "first_delta_seconds": None, "first_body_seconds": None,
                   "delta_count": 0, "completed": False}
            answer = ""
            event = None
            try:
                with client.stream("POST", args.base_url.rstrip("/") + "/qa/answer/stream",
                                   headers=headers, json={"question": case["question"]}) as response:
                    response.raise_for_status()
                    for line in response.iter_lines():
                        if line.startswith("event:"):
                            event = line[6:].strip()
                        if not line.startswith("data:"):
                            continue
                        data = json.loads(line[5:])
                        elapsed = round(time.perf_counter() - start, 3)
                        if event == "delta":
                            row["delta_count"] += 1
                            answer += data["text"]
                            if row["first_delta_seconds"] is None and data["text"].strip():
                                row["first_delta_seconds"] = elapsed
                            body = re.sub(r"^\s*#{1,6}[^\n]*(?:\n|$)", "", answer).strip()
                            if row["first_body_seconds"] is None and body:
                                row["first_body_seconds"] = elapsed
                        elif event == "done":
                            row["completed"] = True
                        elif event == "error":
                            row["error_code"] = data["error_code"]
            except httpx.HTTPError as exc:
                row["error_code"] = type(exc).__name__
            row["total_seconds"] = round(time.perf_counter() - start, 3)
            rows.append(row)
            print(json.dumps(row, ensure_ascii=False), flush=True)
    summary = {"total": len(rows), "completed": sum(row["completed"] for row in rows),
               "body_within_two_seconds": sum(row["completed"] and row["first_body_seconds"] is not None and row["first_body_seconds"] <= 2 for row in rows)}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"summary": summary, "results": rows}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
