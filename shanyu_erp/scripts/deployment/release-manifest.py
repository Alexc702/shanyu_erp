#!/usr/bin/env python3
"""Validate the reviewed release manifest. Never reads secrets or runs shell text."""
import json
import re
import sys


def validate(value):
    def match(text, pattern):
        if not isinstance(text, str) or not re.fullmatch(pattern, text):
            raise ValueError("Invalid manifest field")
        return text

    if value["schema"] != 1 or value["environment"] not in ("test", "production"):
        raise ValueError("Unsupported schema/environment")
    environment = value["environment"]
    origin = {"test": "http://115.159.50.166", "production": "https://shanyuerp.art"}[environment]
    if value["origin"] != origin:
        raise ValueError("Origin does not match environment")
    tag = r"[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}"
    release = match(value["release"], tag)
    output = [environment, origin, release, match(value["commit"], r"[0-9a-f]{40}"),
              match(value["machineId"], r"[0-9a-f]{32}"), match(value["previousRelease"], tag)]
    for service in ("api", "web"):
        image = value[service]
        if image["ref"] != f"shanyu-erp-{service}:{release}":
            raise ValueError("Image ref must match release")
        output += [image["ref"], match(image["id"], r"sha256:[0-9a-f]{64}")]
    output += [match(value["catalog"]["id"], r"[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}"),
               match(value["catalog"]["sha256"], r"[0-9a-f]{64}")]
    for field in ("postgresVolume", "exportsVolume"):
        output.append(match(value[field], r"[a-zA-Z0-9][a-zA-Z0-9_.-]*"))
    correction = value.get("imageCorrection", "none")
    if correction not in ("none", "035_shower_34a_image"):
        raise ValueError("Unknown image correction authorization")
    output.append(correction)
    return output


if __name__ == "__main__":
    try:
        with open(sys.argv[1], encoding="utf-8") as source:
            fields = validate(json.load(source))
        print("\n".join(fields))
    except (ValueError, KeyError, TypeError, OSError, IndexError):
        sys.exit("Invalid release manifest; deployment refused")
