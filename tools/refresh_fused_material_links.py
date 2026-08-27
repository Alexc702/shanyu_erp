#!/usr/bin/env python3
"""Refresh the PPT material-library link rules from the current half-package associations.

The script intentionally updates only relation rows. It does not rewrite the main
material SKU CSV/XLSX or invent product prices.
"""

from __future__ import annotations

import csv
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "主材库一期第一批 - 半包关联初始化清单.csv"
CURRENT = ROOT / "主材库完整版_半包关联规则.csv"
PACKAGE_DIR = ROOT / "主材库完整版_静悦府融合导入包"
PACKAGE_CSV = PACKAGE_DIR / "主材库完整版_半包关联规则.csv"
PACKAGE_ZIP = ROOT / "主材库完整版_静悦府融合导入包.zip"


def read_rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_rows(path: Path, rows: list[dict[str, str]], fieldnames: list[str]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    source_rows = read_rows(SOURCE)
    current_rows = read_rows(CURRENT)
    mapping: dict[tuple[str, str], tuple[str, str]] = {}
    for row in current_rows:
        key = (row["material_demand_category"], row["source_item_name"])
        mapping.setdefault(key, (row.get("matched_material_ids", ""), row.get("fusion_note", "")))

    output: list[dict[str, str]] = []
    missing: list[str] = []
    for row in source_rows:
        key = (row["material_demand_category"], row["source_item_name"])
        matched_ids, old_note = mapping.get(key, ("", ""))
        if not matched_ids:
            missing.append(" / ".join(key))
        merged = dict(row)
        merged["matched_material_ids"] = matched_ids
        merged["fusion_note"] = (
            "由静悦府物料手册匹配；半包来源已更新为《半包报价单_v2.xlsx》；"
            "最终项目选型仍需按空间、规格和启用状态筛选"
            if matched_ids
            else old_note
        )
        output.append(merged)

    if missing:
        raise SystemExit("Missing existing material mapping: " + "; ".join(missing))

    fields = list(source_rows[0]) + ["matched_material_ids", "fusion_note"]
    write_rows(CURRENT, output, fields)
    write_rows(PACKAGE_CSV, output, fields)

    # Rebuild the existing import archive from its directory so the packaged CSV
    # cannot silently remain on the old 32-row baseline.
    with zipfile.ZipFile(PACKAGE_ZIP, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(PACKAGE_DIR.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(PACKAGE_DIR.parent))

    print(f"refreshed {len(output)} relation rows")


if __name__ == "__main__":
    main()
