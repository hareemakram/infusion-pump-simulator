#!/usr/bin/env python3
"""Requirements traceability: links SRS requirements to tests and test results.

Sources of links (no separate mapping file to drift out of date):
  C++        `// @req SRS-xxx, SRS-yyy` on the line(s) above a TEST(Suite, Name)
  Python     `@pytest.mark.req("SRS-xxx", ...)` above a `def test_...`
  Jest, PW   requirement IDs in the test title, e.g. it('... (SRS-080)')

Results are read from JUnit XML files in reports/ when present.

Usage: python tools/trace.py [--reports reports] [--out docs/generated] [--strict]
  --strict  exit 1 if a requirement has no test, a linked test failed, or
            (with reports present) a linked test did not run.
"""

from __future__ import annotations

import argparse
import re
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRS = ROOT / "docs" / "02-software-requirements-specification.md"
REQ_RE = re.compile(r"SRS-\d{3}")


@dataclass
class TestRef:
    framework: str     # gtest | pytest | jest | playwright
    key: str           # matching key into the JUnit results
    label: str         # human readable
    file: str
    reqs: set[str] = field(default_factory=set)


def load_requirements() -> dict[str, str]:
    reqs: dict[str, str] = {}
    for line in SRS.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\|\s*(SRS-\d{3})\s*\|\s*(.+?)\s*\|", line)
        if m:
            reqs[m.group(1)] = m.group(2)
    return reqs


def scan_gtest() -> list[TestRef]:
    refs = []
    for path in sorted((ROOT / "firmware" / "tests").glob("*.cpp")):
        pending: set[str] = set()
        for line in path.read_text(encoding="utf-8").splitlines():
            if "@req" in line:
                pending |= set(REQ_RE.findall(line))
                continue
            m = re.match(r"^TEST(?:_F)?\((\w+),\s*(\w+)\)", line)
            if m:
                if pending:
                    key = f"{m.group(1)}.{m.group(2)}"
                    refs.append(TestRef("gtest", key, key, path.name, pending))
                pending = set()
    return refs


def scan_pytest() -> list[TestRef]:
    refs = []
    for path in sorted((ROOT / "simulator" / "tests").glob("test_*.py")):
        pending: set[str] = set()
        for line in path.read_text(encoding="utf-8").splitlines():
            s = line.strip()
            if s.startswith("@pytest.mark.req("):
                pending |= set(REQ_RE.findall(s))
                continue
            m = re.match(r"^def (test_\w+)\(", s)
            if m:
                if pending:
                    key = f"{path.stem}::{m.group(1)}"
                    refs.append(TestRef("pytest", key, key, path.name, pending))
                pending = set()
    return refs


def scan_titles(folder: Path, pattern: str, framework: str) -> list[TestRef]:
    refs = []
    title_re = re.compile(r"""\b(?:it|test)\(\s*(['"`])(.+?)\1""")
    for path in sorted(folder.glob(pattern)):
        for m in title_re.finditer(path.read_text(encoding="utf-8")):
            title = m.group(2)
            ids = set(REQ_RE.findall(title))
            if ids:
                refs.append(TestRef(framework, title, title, path.name, ids))
    return refs


RAW: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0])  # executed cases: pass, fail, skip


def load_results(reports: Path) -> dict[str, dict[str, str]]:
    """framework -> {testcase identifier -> 'pass'|'fail'|'skip'}"""
    results: dict[str, dict[str, str]] = defaultdict(dict)
    files = {"gtest": "gtest.xml", "pytest": "pytest.xml", "jest": "jest-junit.xml", "playwright": "playwright-junit.xml"}
    for fw, name in files.items():
        path = reports / name
        if not path.exists():
            continue
        for case in ET.parse(path).getroot().iter("testcase"):
            outcome = "pass"
            if case.find("failure") is not None or case.find("error") is not None:
                outcome = "fail"
            elif case.find("skipped") is not None or case.get("status") == "notrun":
                outcome = "skip"
            RAW[fw][("pass", "fail", "skip").index(outcome)] += 1
            name = case.get("name", "")
            cls = case.get("classname", "")
            if fw == "gtest":
                ident = f"{cls}.{name}"
            elif fw == "pytest":
                base = re.sub(r"\[.*\]$", "", name)
                ident = f"{cls.rsplit('.', 1)[-1]}::{base}"
            else:
                ident = name
            prev = results[fw].get(ident)
            if prev != "fail":
                results[fw][ident] = outcome if prev in (None, "pass", "skip") else prev
                if prev == "pass" and outcome == "skip":
                    results[fw][ident] = "pass"
    return results


def outcome_for(ref: TestRef, results: dict[str, dict[str, str]]) -> str | None:
    table = results.get(ref.framework)
    if not table:
        return None
    if ref.key in table:
        return table[ref.key]
    # Playwright and Jest prefix describe blocks / project names: match on the title suffix.
    hits = [v for k, v in table.items() if k.endswith(ref.key)]
    if not hits:
        return "missing"
    return "fail" if "fail" in hits else ("pass" if "pass" in hits else "skip")


ICON = {"pass": "PASS", "fail": "FAIL", "skip": "skipped", "missing": "not run", None: "not run"}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reports", default=str(ROOT / "reports"))
    ap.add_argument("--out", default=str(ROOT / "docs" / "generated"))
    ap.add_argument("--strict", action="store_true")
    args = ap.parse_args(argv)

    reqs = load_requirements()
    refs = (scan_gtest() + scan_pytest()
            + scan_titles(ROOT / "ui" / "src" / "__tests__", "*.test.ts*", "jest")
            + scan_titles(ROOT / "ui" / "e2e", "*.spec.ts", "playwright"))
    results = load_results(Path(args.reports))
    have_results = any(results.values())

    by_req: dict[str, list[TestRef]] = defaultdict(list)
    unknown: set[str] = set()
    for r in refs:
        for q in r.reqs:
            (by_req[q] if q in reqs else by_req.setdefault("_unknown", [])).append(r)
            if q not in reqs:
                unknown.add(q)

    problems: list[str] = []
    rows = []
    for rid, text in reqs.items():
        tests = by_req.get(rid, [])
        fws = sorted({t.framework for t in tests})
        outcomes = [outcome_for(t, results) for t in tests] if have_results else []
        if not tests:
            status = "NO TEST"
            problems.append(f"{rid} has no linked test")
        elif not have_results:
            status = "linked"
        elif "fail" in outcomes:
            status = "FAIL"
            problems.append(f"{rid} has a failing test")
        elif all(o == "pass" for o in outcomes):
            status = "PASS"
        elif any(o == "pass" for o in outcomes):
            status = "PASS (partial run)"
        else:
            status = "not run"
            problems.append(f"{rid}: no linked test ran")
        rows.append((rid, text, tests, fws, outcomes, status))
    for q in sorted(unknown):
        problems.append(f"tests reference unknown requirement {q}")

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    covered = sum(1 for r in rows if r[2])
    passed = sum(1 for r in rows if r[5].startswith("PASS"))

    md = [
        "# Requirements traceability matrix",
        "",
        f"Generated by `tools/trace.py` on {stamp}. Do not edit by hand.",
        "",
        f"- Requirements: **{len(rows)}**",
        f"- With at least one linked test: **{covered}/{len(rows)}**",
        f"- Verified by passing tests: **{passed}/{len(rows)}**" if have_results else "- Test results: not available (run the suites first)",
        f"- Linked tests: **{len(refs)}** (GoogleTest {sum(r.framework=='gtest' for r in refs)}, pytest {sum(r.framework=='pytest' for r in refs)}, "
        f"Jest {sum(r.framework=='jest' for r in refs)}, Playwright {sum(r.framework=='playwright' for r in refs)})",
        "",
        "## Summary",
        "",
        "| Requirement | Unit | System | UI | Result |",
        "|---|:---:|:---:|:---:|---|",
    ]
    for rid, _, tests, fws, _, status in rows:
        unit = "x" if {"gtest", "jest"} & set(fws) else ""
        system = "x" if "pytest" in fws else ""
        ui = "x" if "playwright" in fws else ""
        md.append(f"| [{rid}](#{rid.lower()}) | {unit} | {system} | {ui} | {status} |")
    md += ["", "## Detail", ""]
    for rid, text, tests, _, outcomes, status in rows:
        md.append(f"### {rid}")
        md.append("")
        md.append(f"{text}")
        md.append("")
        md.append(f"Result: **{status}**")
        md.append("")
        if tests:
            md.append("| Framework | Test | File | Result |")
            md.append("|---|---|---|---|")
            for i, t in enumerate(tests):
                res = ICON[outcomes[i]] if have_results else "-"
                md.append(f"| {t.framework} | `{t.label}` | {t.file} | {res} |")
            md.append("")
    (out / "traceability-matrix.md").write_text("\n".join(md) + "\n", encoding="utf-8")

    # Test report: totals per framework.
    rep = ["# Test report", "", f"Generated by `tools/trace.py` on {stamp} from the JUnit files in `reports/`.", ""]
    if have_results:
        rep += ["| Suite | Tests | Passed | Failed | Skipped |", "|---|---:|---:|---:|---:|"]
        names = {"gtest": "GoogleTest (C++ unit)", "pytest": "pytest (simulator + closed-loop system)",
                 "jest": "Jest (UI unit/component)", "playwright": "Playwright (end-to-end)"}
        tot = [0, 0, 0, 0]
        for fw in ("gtest", "pytest", "jest", "playwright"):
            if fw not in RAW:
                continue
            p, f, s = RAW[fw]
            n = p + f + s
            tot = [tot[0] + n, tot[1] + p, tot[2] + f, tot[3] + s]
            rep.append(f"| {names[fw]} | {n} | {p} | {f} | {s} |")
        rep.append(f"| **Total** | **{tot[0]}** | **{tot[1]}** | **{tot[2]}** | **{tot[3]}** |")
        rep += ["", "Counts are executed test cases (each parametrisation counts). The Playwright skip is the "
                "opt-in screenshot generator. Requirement coverage is in the "
                "[traceability matrix](traceability-matrix.md)."]
    else:
        rep.append("No results found. Run the test suites first (see README).")
    if problems:
        rep += ["", "## Open items", ""] + [f"- {p}" for p in problems]
    (out / "test-report.md").write_text("\n".join(rep) + "\n", encoding="utf-8")

    print(f"{len(rows)} requirements, {covered} linked, {passed} verified, {len(refs)} linked tests")
    for p in problems:
        print("  -", p)
    if args.strict and problems:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
