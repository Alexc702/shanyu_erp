#!/usr/bin/env python3
"""JSON plumbing for Ubuntu hosts; no credentials printed."""
import json
import re
import sys

try:
    command = sys.argv[1]
    if command == "input":
        with open(sys.argv[2]) as source:
            value = {"baseline": json.load(source)}
        if len(sys.argv) > 3:
            with open(sys.argv[3]) as source:
                value["applied"] = json.load(source)
        print(json.dumps(value))
    elif command == "plan":
        with open(sys.argv[2]) as source:
            value = json.load(source)
        assert value["targetCatalogId"] == sys.argv[3] and value["targetCatalogHash"] == sys.argv[4]
        assert re.fullmatch(r"[0-9a-f]{64}", value["planHash"])
        assert value["policy"] == "zero-impact-v1" and isinstance(value["entries"], list)
        print(value["planHash"])
    elif command == "volumes":
        config = json.load(sys.stdin)
        assert config["name"] == "shanyu-erp"
        for service, target, expected in [("postgres", "/var/lib/postgresql", sys.argv[2]),
                                          ("api", "/app/export-files", sys.argv[3]),
                                          ("export-storage-init", "/app/export-files", sys.argv[3]),
                                          ("export-worker", "/app/export-files", sys.argv[3])]:
            mounts = [mount for mount in config["services"][service]["volumes"] if mount["target"] == target]
            assert len(mounts) == 1 and mounts[0]["type"] == "volume"
            assert config["volumes"][mounts[0]["source"]]["name"] == expected
        for service in ("api", "web", "postgres", "export-worker"):
            assert not config["services"][service].get("ports"), "Internal port exposed"
    else:
        raise ValueError("Unknown command")
except (ValueError, KeyError, TypeError, OSError, IndexError, AssertionError):
    sys.exit("Release evidence validation failed")
