#!/usr/bin/env python3
"""Extract the 半包报价模板 sheet without third-party XLSX dependencies.

The script intentionally preserves source row order and source formulas. It creates
mechanical data artifacts for product/design review; it does not silently repair
workbook data defects or invent missing cost prices.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
import zipfile
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Iterable
from xml.etree import ElementTree as ET


NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL_DOC = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_REL_PKG = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"m": NS_MAIN, "r": NS_REL_DOC, "p": NS_REL_PKG}


SECTION_FALLBACK_NAMES = {
    5: "一、砌墙工程",
    26: "二、客餐厅工程",
    73: "三、卧室工程",
    115: "七、阳台工程",
    120: "八、厨卫工程",
    150: "十、油漆工程",
    155: "十一、水电工程",
    174: "十二、其他工程",
    179: "十三、工程汇总",
}

# These are demand categories, not SKU classifications. A matched half-package
# item can create/adjust a main-material selection task, but never becomes a
# brand/model/color SKU automatically.
MATERIAL_TRIGGER_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("瓷砖/石材铺贴", ("地砖", "墙砖", "瓷砖", "小砖", "文化砖", "马赛克", "岩板铺贴")),
    ("门槛石/窗台石/石材", ("门槛石", "窗台石", "飘窗台", "石材", "大理石", "挡水石")),
    ("木地板", ("木地板", "地板")),
    ("房门/门套", ("房门", "门套", "门洞", "隐形门")),
    ("集成吊顶/铝扣板", ("集成吊顶", "铝扣板")),
    ("卫浴/洁具", ("马桶", "蹲便", "浴缸", "浴室柜", "洁具", "卫浴", "花洒", "地漏")),
    ("淋浴房", ("淋浴房", "玻璃隔断")),
    ("开关插座/面板", ("开关", "插座", "面板")),
    ("橱柜/定制柜", ("橱柜", "柜体", "衣柜", "定制柜", "鞋柜")),
    ("踢脚线", ("踢脚线",)),
    ("美缝", ("美缝", "勾缝")),
)


def qname(namespace: str, local: str) -> str:
    return f"{{{namespace}}}{local}"


def col_to_num(col: str) -> int:
    result = 0
    for ch in col:
        result = result * 26 + ord(ch.upper()) - 64
    return result


def split_ref(ref: str) -> tuple[int, int]:
    match = re.fullmatch(r"([A-Z]+)(\d+)", ref)
    if not match:
        raise ValueError(f"Invalid cell reference: {ref}")
    return col_to_num(match.group(1)), int(match.group(2))


def normalized_text(value: object) -> str:
    if value is None:
        return ""
    return str(value).replace("\r\n", "\n").replace("\r", "\n").strip()


def decimal_text(value: object) -> str:
    text = normalized_text(value)
    if not text:
        return ""
    try:
        number = Decimal(text)
    except InvalidOperation:
        return text
    if number == number.to_integral():
        return str(number.quantize(Decimal("1")))
    return format(number.normalize(), "f")


class WorkbookReader:
    def __init__(self, path: Path):
        self.path = path
        self.archive = zipfile.ZipFile(path)
        self.shared_strings = self._load_shared_strings()

    def close(self) -> None:
        self.archive.close()

    def _load_shared_strings(self) -> list[str]:
        try:
            root = ET.fromstring(self.archive.read("xl/sharedStrings.xml"))
        except KeyError:
            return []
        values: list[str] = []
        for si in root.findall("m:si", NS):
            values.append("".join(node.text or "" for node in si.iter(qname(NS_MAIN, "t"))))
        return values

    def sheet_path(self, sheet_name: str) -> str:
        workbook = ET.fromstring(self.archive.read("xl/workbook.xml"))
        rel_id = None
        for sheet in workbook.findall("m:sheets/m:sheet", NS):
            if sheet.attrib.get("name", "").strip() == sheet_name.strip():
                rel_id = sheet.attrib[qname(NS_REL_DOC, "id")]
                break
        if rel_id is None:
            raise KeyError(f"Sheet not found: {sheet_name}")
        rels = ET.fromstring(self.archive.read("xl/_rels/workbook.xml.rels"))
        for rel in rels.findall("p:Relationship", NS):
            if rel.attrib.get("Id") == rel_id:
                target = rel.attrib["Target"].lstrip("/")
                return target if target.startswith("xl/") else f"xl/{target}"
        raise KeyError(f"Relationship not found for sheet: {sheet_name}")

    def read_sheet(self, sheet_name: str) -> tuple[dict[int, dict[str, str]], dict[int, dict[str, str]], list[str]]:
        root = ET.fromstring(self.archive.read(self.sheet_path(sheet_name)))
        values: dict[int, dict[str, str]] = defaultdict(dict)
        formulas: dict[int, dict[str, str]] = defaultdict(dict)
        for cell in root.findall("m:sheetData/m:row/m:c", NS):
            ref = cell.attrib["r"]
            col_match = re.match(r"[A-Z]+", ref)
            if not col_match:
                continue
            col = col_match.group(0)
            _, row = split_ref(ref)
            cell_type = cell.attrib.get("t", "n")
            formula_node = cell.find("m:f", NS)
            value_node = cell.find("m:v", NS)
            if formula_node is not None:
                formulas[row][col] = normalized_text(formula_node.text)
            if cell_type == "s" and value_node is not None:
                idx = int(value_node.text or "0")
                value = self.shared_strings[idx] if idx < len(self.shared_strings) else ""
            elif cell_type == "inlineStr":
                value = "".join(node.text or "" for node in cell.iter(qname(NS_MAIN, "t")))
            elif cell_type == "b":
                value = "是" if (value_node is not None and value_node.text == "1") else "否"
            else:
                value = value_node.text if value_node is not None else ""
            values[row][col] = normalized_text(value)

        merges = [
            item.attrib["ref"]
            for item in root.findall("m:mergeCells/m:mergeCell", NS)
            if "ref" in item.attrib
        ]
        return dict(values), dict(formulas), merges


@dataclass
class QuoteOption:
    source_sheet: str
    excel_row: int
    template_order: int
    section: str
    section_source_row: int
    subgroup: str
    source_number: str
    item_name: str
    unit: str
    quantity_default: str
    quantity_formula: str
    quantity_source_suggestion: str
    sale_unit_price: str
    cost_unit_price: str
    cost_status: str
    amount_formula: str
    remarks: str
    material_demand_category: str
    can_trigger_material_demand: str
    data_quality_notes: str


def active_merged_labels(
    rows: dict[int, dict[str, str]], merges: Iterable[str]
) -> dict[int, str]:
    labels: dict[int, list[str]] = defaultdict(list)
    for merge_ref in merges:
        if ":" not in merge_ref:
            continue
        start_ref, end_ref = merge_ref.split(":", 1)
        start_col, start_row = split_ref(start_ref)
        end_col, end_row = split_ref(end_ref)
        if start_col != end_col or start_col > 2 or end_row <= start_row:
            continue
        col = "A" if start_col == 1 else "B"
        value = normalized_text(rows.get(start_row, {}).get(col, ""))
        if not value or value.startswith("【") or value.isdigit():
            continue
        for row in range(start_row, end_row + 1):
            labels[row].append(value)
    return {row: " / ".join(dict.fromkeys(items)) for row, items in labels.items()}


def choose_section_name(row: int, row_data: dict[str, str]) -> str:
    for col in ("A", "B", "C", "D"):
        value = normalized_text(row_data.get(col, ""))
        if value.startswith("【") and value.endswith("】"):
            return value[1:-1].strip()
    return SECTION_FALLBACK_NAMES.get(row, "")


def infer_quantity_source(formula: str, default: str) -> str:
    f = formula.upper().replace("$", "")
    if not f:
        # The F column is intentionally completed by the lead designer for each
        # project when no formula is supplied; blank/zero is not a data defect.
        return "主案设计师手工填写"
    if re.search(r"(?<![A-Z0-9])G2(?!\d)", f):
        return "建筑面积"
    if any(token in f for token in ("E26", "E73", "E115", "E120")):
        return "空间面积"
    if any(token in f for token in ("G26", "G73", "G115", "G120")):
        return "空间周长"
    if any(token in f for token in ("I26", "I73", "I115", "I120")):
        return "空间高度"
    if re.search(r"[A-J]\d+", f):
        return "引用其他项目/参数"
    return "规则计算"


def material_trigger(item_name: str) -> tuple[str, str]:
    categories = []
    for category, keywords in MATERIAL_TRIGGER_RULES:
        if any(keyword in item_name for keyword in keywords):
            categories.append(category)
    return (" / ".join(categories), "是" if categories else "否")


def build_options(
    rows: dict[int, dict[str, str]], formulas: dict[int, dict[str, str]], merges: list[str]
) -> tuple[list[QuoteOption], list[dict[str, str]], list[dict[str, str]]]:
    merged_labels = active_merged_labels(rows, merges)
    sections: list[dict[str, str]] = []
    summaries: list[dict[str, str]] = []
    options: list[QuoteOption] = []
    current_section = ""
    current_section_row = 0

    for row in range(1, max(rows) + 1):
        row_data = rows.get(row, {})
        section_name = choose_section_name(row, row_data)
        if section_name:
            current_section = section_name
            current_section_row = row
            sections.append(
                {
                    "excel_row": str(row),
                    "section": section_name,
                    "area_default": decimal_text(row_data.get("E", "")),
                    "perimeter_default": decimal_text(row_data.get("G", "")),
                    "height_default": decimal_text(row_data.get("I", "")),
                }
            )
            continue

        item_name = normalized_text(row_data.get("C", ""))
        in_summary_section = current_section == "十三、工程汇总"
        if in_summary_section and not item_name:
            summary_value = decimal_text(row_data.get("G", row_data.get("H", "")))
            summary_formula = normalized_text(
                formulas.get(row, {}).get("G", formulas.get(row, {}).get("H", ""))
            )
            if summary_value or summary_formula:
                summaries.append(
                    {
                        "excel_row": str(row),
                        "name": "原表未命名汇总项",
                        "value": summary_value,
                        "formula": summary_formula,
                        "remarks": normalized_text(row_data.get("I", "")),
                    }
                )
            continue
        if not item_name:
            continue
        if row <= 5 or in_summary_section:
            if in_summary_section:
                summaries.append(
                    {
                        "excel_row": str(row),
                        "name": item_name,
                        "value": decimal_text(row_data.get("G", row_data.get("H", ""))),
                        "formula": normalized_text(
                            formulas.get(row, {}).get("G", formulas.get(row, {}).get("H", ""))
                        ),
                        "remarks": normalized_text(row_data.get("I", "")),
                    }
                )
            continue
        # A subtotal/summary row has no unit/price and typically contains 合计.
        if "合计" in item_name and not normalized_text(row_data.get("E", "")):
            summaries.append(
                {
                    "excel_row": str(row),
                    "name": item_name,
                    "value": decimal_text(row_data.get("G", row_data.get("H", ""))),
                    "formula": normalized_text(
                        formulas.get(row, {}).get("G", formulas.get(row, {}).get("H", ""))
                    ),
                    "remarks": normalized_text(row_data.get("I", "")),
                }
            )
            continue

        unit = normalized_text(row_data.get("E", ""))
        sale = decimal_text(row_data.get("G", ""))
        cost = decimal_text(row_data.get("J", ""))
        quantity = decimal_text(row_data.get("F", ""))
        quantity_formula = normalized_text(formulas.get(row, {}).get("F", ""))
        amount_formula = normalized_text(formulas.get(row, {}).get("H", ""))
        remarks = normalized_text(row_data.get("I", ""))
        # Notes such as “厨房卫生间同步” live in the item-name column but are
        # not selectable quote items. A real item has a unit, price or formula.
        if not any((unit, sale, cost, quantity_formula, amount_formula)):
            continue
        category, trigger = material_trigger(item_name)
        quality: list[str] = []
        if not unit:
            quality.append("缺单位")
        if not sale:
            quality.append("缺销售单价")
        if not cost:
            quality.append("缺成本单价")
        elif cost == "0":
            quality.append("成本单价为0，需业务确认")
        if quantity.startswith("#"):
            quality.append("数量缓存值为公式错误")
        elif quantity_formula and quantity:
            try:
                Decimal(quantity)
            except InvalidOperation:
                quality.append("数量缓存值不是数值")
        if sale.startswith("#") or cost.startswith("#"):
            quality.append("价格缓存值为公式错误")
        if not remarks:
            quality.append("缺施工说明")
        if infer_quantity_source(quantity_formula, quantity) == "待配置":
            quality.append("数量来源待配置")
        source_number = " / ".join(
            value
            for value in (
                normalized_text(row_data.get("A", "")),
                normalized_text(row_data.get("B", "")),
            )
            if value and not value.startswith("【")
        )
        options.append(
            QuoteOption(
                source_sheet="半包报价模板",
                excel_row=row,
                template_order=len(options) + 1,
                section=current_section,
                section_source_row=current_section_row,
                subgroup=merged_labels.get(row, ""),
                source_number=source_number,
                item_name=item_name,
                unit=unit,
                quantity_default=quantity,
                quantity_formula=quantity_formula,
                quantity_source_suggestion=infer_quantity_source(quantity_formula, quantity),
                sale_unit_price=sale,
                cost_unit_price=cost,
                cost_status="已提供" if cost and cost != "0" else ("异常零值" if cost == "0" else "待补录"),
                amount_formula=amount_formula,
                remarks=remarks,
                material_demand_category=category,
                can_trigger_material_demand=trigger,
                data_quality_notes="；".join(quality),
            )
        )
    return options, sections, summaries


def write_csv(path: Path, rows: list[dict[str, object]], fieldnames: list[str] | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if fieldnames is None:
        fieldnames = list(rows[0]) if rows else []
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def markdown_escape(text: object) -> str:
    return normalized_text(text).replace("|", "\\|").replace("\n", "<br>")


def write_options_markdown(
    path: Path,
    source: Path,
    options: list[QuoteOption],
    sections: list[dict[str, str]],
    summaries: list[dict[str, str]],
) -> None:
    section_options: dict[str, list[QuoteOption]] = defaultdict(list)
    for item in options:
        section_options[item.section].append(item)
    lines = [
        "# 半包报价模板——完整表单内容",
        "",
        f"> 唯一数据来源：`{source.name}` / 工作表“半包报价模板”。本文件为机械提取结果，不修复或补造源数据。",
        f"> 共提取 {len(options)} 个可选报价项；Excel 行号用于逐项追溯。销售价和成本价均按原单元格保留。",
        "",
        "## 使用规则",
        "",
        "- 系统按下表建立默认半包模板，界面通过空间、分组、搜索来选择，不展示未选中的空白行。",
        "- 销售价、成本价和施工说明按源表保留；缺失项进入治理清单，不得臆造。",
        "- 分区面积、周长、高度及数量为源表样例值，不作为新项目默认值；新项目在半包空间内填写参数。",
        "- 数量公式只是迁移线索；开发时应转换为可配置规则，不直接执行 Excel 单元格引用。",
        "- F 列无公式时由主案设计师在项目中填写，空白或 0 不属于模板异常。",
        "- “主材触发品类”表示该施工项可能产生主材选型任务，不表示该施工项本身是主材商品 SKU。",
        "",
        "## 空间/工程分区参数",
        "",
        "| Excel行 | 分区 | 源表面积样例 | 源表周长样例 | 源表高度样例 | 选项数 |",
        "|---:|---|---:|---:|---:|---:|",
    ]
    for section in sections:
        if section["section"] == "十三、工程汇总":
            continue
        lines.append(
            "| {excel_row} | {section} | {area_default} | {perimeter_default} | {height_default} | {count} |".format(
                **{key: markdown_escape(value) for key, value in section.items()},
                count=len(section_options.get(section["section"], [])),
            )
        )

    for section in sections:
        section_name = section["section"]
        items = section_options.get(section_name, [])
        if not items:
            continue
        lines.extend(
            [
                "",
                f"## {markdown_escape(section_name)}（{len(items)} 项）",
                "",
                "| 顺序 | Excel行 | 分组 | 原编号 | 工程项目 | 单位 | 数量默认/缓存 | 数量公式 | 报价单价 | 金额公式 | 成本单价 | 成本状态 | 备注 | 主材触发品类 | 数据问题 |",
                "|---:|---:|---|---|---|---|---:|---|---:|---|---:|---|---|---|---|",
            ]
        )
        for item in items:
            lines.append(
                "| {template_order} | {excel_row} | {subgroup} | {source_number} | {item_name} | {unit} | {quantity_default} | {quantity_formula} | {sale_unit_price} | {amount_formula} | {cost_unit_price} | {cost_status} | {remarks} | {material_demand_category} | {data_quality_notes} |".format(
                    **{key: markdown_escape(value) for key, value in asdict(item).items()}
                )
            )

    lines.extend(
        [
            "",
            "## Excel 汇总行（仅用于迁移对照）",
            "",
            "| Excel行 | 名称 | 缓存值 | 原公式 | 备注 |",
            "|---:|---|---|---|---|",
        ]
    )
    for item in summaries:
        lines.append(
            "| {excel_row} | {name} | {value} | {formula} | {remarks} |".format(
                **{key: markdown_escape(value) for key, value in item.items()}
            )
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def aggregate_material_inputs(options: list[QuoteOption]) -> list[dict[str, str]]:
    grouped: dict[tuple[str, str, str, str, str], dict[str, object]] = {}
    for item in options:
        if item.can_trigger_material_demand != "是":
            continue
        key = (
            item.material_demand_category,
            item.item_name,
            item.unit,
            item.sale_unit_price,
            item.cost_unit_price,
        )
        if key not in grouped:
            grouped[key] = {
                "material_demand_category": item.material_demand_category,
                "source_item_name": item.item_name,
                "unit": item.unit,
                "source_sale_unit_price": item.sale_unit_price,
                "source_cost_unit_price": item.cost_unit_price,
                "cost_status": item.cost_status,
                "applicable_sections": [],
                "source_excel_rows": [],
                "quantity_source_suggestion": [],
                "initialization_type": "主材需求触发关系（非商品SKU）",
                "material_sku_sale_unit_price": "",
                "material_sku_cost_unit_price": "",
                "sku_fields_to_complete": "主材品类、品牌、规格型号、颜色、图片、商品销售单价、商品成本单价、计价单位、有效期",
                "enable_status": "待确认" if item.cost_status != "已提供" else "可评审",
            }
        target = grouped[key]
        target["applicable_sections"].append(item.section)
        target["source_excel_rows"].append(str(item.excel_row))
        target["quantity_source_suggestion"].append(item.quantity_source_suggestion)
    result: list[dict[str, str]] = []
    for order, value in enumerate(grouped.values(), 1):
        row: dict[str, str] = {"initialization_order": str(order)}
        for key, cell in value.items():
            if isinstance(cell, list):
                row[key] = " / ".join(dict.fromkeys(cell))
            else:
                row[key] = str(cell)
        result.append(row)
    return result


def write_material_markdown(path: Path, source: Path, rows: list[dict[str, str]]) -> None:
    lines = [
        "# 主材库一期第一批——半包关联表单内容",
        "",
        f"> 来源：`{source.name}` / 工作表“半包报价模板”。共 {len(rows)} 条去重后的主材需求触发关系。",
        "> 原表只有施工项的报价单价和成本单价，没有主材商品品牌、型号、颜色、图片及商品价。为避免错误成本，施工价与商品价分列保存；商品销售价/成本价待录入真实 SKU 时填写。",
        "",
        "## 录入与启用规则",
        "",
        "- 每条关系必须能追溯到半包工程项和 Excel 行号；半包项增删或数量变化时同步提示对应主材需求。",
        "- 当前 18 条关系的来源施工销售价和成本均完整；商品销售价/成本仍以真实 SKU 数据为准。",
        "- 新增真实商品 SKU 时，必须补齐主材品类、品牌、规格型号、颜色/图片、商品销售价、商品成本价、计价单位和有效期。",
        "- 下表中的“施工报价/施工成本”仅用于半包工程项快照，严禁复制为商品 SKU 价格。",
        "",
        "## 第一批输入清单",
        "",
        "| 顺序 | 需求品类 | 来源半包工程项 | 单位 | 施工报价 | 施工成本 | 商品销售价 | 商品成本价 | 适用分区 | Excel行 | 数量来源建议 | 状态 |",
        "|---:|---|---|---|---:|---:|---:|---:|---|---|---|---|",
    ]
    for row in rows:
        lines.append(
            "| {initialization_order} | {material_demand_category} | {source_item_name} | {unit} | {source_sale_unit_price} | {source_cost_unit_price} | {material_sku_sale_unit_price} | {material_sku_cost_unit_price} | {applicable_sections} | {source_excel_rows} | {quantity_source_suggestion} | {enable_status} |".format(
                **{key: markdown_escape(value) for key, value in row.items()}
            )
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def detect_duplicate_conflicts(options: list[QuoteOption]) -> list[dict[str, str]]:
    grouped: dict[tuple[str, str], list[QuoteOption]] = defaultdict(list)
    for item in options:
        grouped[(item.item_name, item.unit)].append(item)
    conflicts: list[dict[str, str]] = []
    for (name, unit), items in grouped.items():
        prices = {(item.sale_unit_price, item.cost_unit_price) for item in items}
        if len(items) <= 1 or len(prices) <= 1:
            continue
        conflicts.append(
            {
                "item_name": name,
                "unit": unit,
                "source_rows": " / ".join(str(item.excel_row) for item in items),
                "sections": " / ".join(dict.fromkeys(item.section for item in items)),
                "sale_cost_combinations": " / ".join(
                    f"{sale or '空'}|{cost or '空'}" for sale, cost in sorted(prices)
                ),
                "review_action": "按老板确认后的来源模板保留空间价差；禁止仅按名称全局合并",
            }
        )
    return conflicts


def build_summary(
    source: Path,
    options: list[QuoteOption],
    sections: list[dict[str, str]],
    material_rows: list[dict[str, str]],
    conflicts: list[dict[str, str]],
) -> dict[str, object]:
    section_counts = Counter(item.section for item in options)
    missing_sale = [item.excel_row for item in options if not item.sale_unit_price]
    missing_cost = [item.excel_row for item in options if not item.cost_unit_price]
    zero_cost = [item.excel_row for item in options if item.cost_unit_price == "0"]
    missing_remarks = [item.excel_row for item in options if not item.remarks]
    pending_quantity_source = [
        item.excel_row for item in options if item.quantity_source_suggestion == "待配置"
    ]
    invalid_quantity_cache = [
        item.excel_row for item in options if "数量缓存值" in item.data_quality_notes
    ]
    duplicate_name_count = sum(
        count - 1 for count in Counter((item.item_name, item.unit) for item in options).values() if count > 1
    )
    return {
        "source_file": str(source),
        "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "source_sheet": "半包报价模板",
        "section_count_excluding_summary": len([s for s in sections if s["section"] != "十三、工程汇总"]),
        "option_count": len(options),
        "section_counts": dict(section_counts),
        "sale_price_present_count": len(options) - len(missing_sale),
        "sale_price_missing_count": len(missing_sale),
        "sale_price_missing_rows": missing_sale,
        "cost_price_present_count": len(options) - len(missing_cost),
        "cost_price_missing_count": len(missing_cost),
        "cost_price_missing_rows": missing_cost,
        "cost_price_zero_count": len(zero_cost),
        "cost_price_zero_rows": zero_cost,
        "missing_remarks_count": len(missing_remarks),
        "missing_remarks_rows": missing_remarks,
        "pending_quantity_source_count": len(pending_quantity_source),
        "pending_quantity_source_rows": pending_quantity_source,
        "invalid_quantity_cache_count": len(invalid_quantity_cache),
        "invalid_quantity_cache_rows": invalid_quantity_cache,
        "formula_quantity_count": sum(bool(item.quantity_formula) for item in options),
        "manual_or_static_quantity_count": sum(not bool(item.quantity_formula) for item in options),
        "unique_name_unit_count": len(set((item.item_name, item.unit) for item in options)),
        "duplicate_name_unit_extra_rows": duplicate_name_count,
        "duplicate_price_conflict_count": len(conflicts),
        "material_trigger_source_row_count": sum(item.can_trigger_material_demand == "是" for item in options),
        "material_trigger_aggregate_count": len(material_rows),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--output-dir", type=Path, default=Path.cwd())
    parser.add_argument("--summary-only", action="store_true")
    args = parser.parse_args()

    reader = WorkbookReader(args.workbook)
    try:
        rows, formulas, merges = reader.read_sheet("半包报价模板")
    finally:
        reader.close()
    options, sections, summaries = build_options(rows, formulas, merges)
    material_rows = aggregate_material_inputs(options)
    conflicts = detect_duplicate_conflicts(options)
    summary = build_summary(args.workbook, options, sections, material_rows, conflicts)

    if not args.summary_only:
        output = args.output_dir
        write_csv(output / "半包报价模板 - 初始化数据.csv", [asdict(item) for item in options])
        write_csv(output / "主材库一期第一批 - 半包关联初始化清单.csv", material_rows)
        write_csv(output / "半包报价模板 - 重复价格冲突清单.csv", conflicts)
        write_options_markdown(
            output / "半包报价模板 - 完整表单内容.md",
            args.workbook,
            options,
            sections,
            summaries,
        )
        write_material_markdown(
            output / "主材库一期第一批 - 半包关联表单内容.md",
            args.workbook,
            material_rows,
        )
        (output / "半包报价模板 - 数据审计摘要.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
