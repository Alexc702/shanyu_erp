#!/usr/bin/env python3
"""Validate the reviewed release manifest. Never reads secrets or runs shell text."""
import json
import ipaddress
import re
import sys
from urllib.parse import urlsplit


def validate(value):
    def match(text, pattern):
        if not isinstance(text, str) or not re.fullmatch(pattern, text):
            raise ValueError("Invalid manifest field")
        return text

    if value["schema"] != 1 or value["environment"] not in ("test", "production"):
        raise ValueError("Unsupported schema/environment")
    environment = value["environment"]
    origin = value["origin"]
    if not isinstance(origin, str):
        raise ValueError("Invalid origin")
    parsed = urlsplit(origin)
    if (parsed.scheme not in ("http", "https") or not parsed.netloc or
            parsed.username is not None or parsed.password is not None or
            parsed.path or parsed.query or parsed.fragment or
            origin != f"{parsed.scheme}://{parsed.netloc}" or
            parsed.port == 0 or (environment == "production" and parsed.scheme != "https")):
        raise ValueError("Invalid origin")
    host = parsed.hostname
    if not host:
        raise ValueError("Invalid origin host")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        if not all(re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", label)
                   for label in host.split(".")):
            raise ValueError("Invalid origin host")
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
