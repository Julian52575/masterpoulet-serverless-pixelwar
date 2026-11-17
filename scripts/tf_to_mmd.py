#!/usr/bin/env python3
"""Render the Terraform under infra/ as a Mermaid flowchart (stdlib only).

Each infra/<stack> directory becomes a subgraph; edges are references between
resources/data sources/modules (including through `locals`).

    python3 scripts/tf_to_mmd.py > infra.mmd
    python3 scripts/tf_to_mmd.py --show-noise -o infra.mmd
"""
import argparse
import re
import sys
from pathlib import Path

HEADER = re.compile(r'^\s*(resource|data|module|locals)\b((?:\s+"[^"]*")*)\s*\{', re.M)
REF = re.compile(r'(?<![\w."])(data\.)?([a-z][a-z0-9]*_[a-z0-9_]+)\.([A-Za-z_]\w*)')
MODULE_REF = re.compile(r'(?<![\w.])module\.(\w+)')
LOCAL_REF = re.compile(r'(?<![\w.])local\.(\w+)')
LOCAL_KEY = re.compile(r'^\s{0,4}(\w+)\s*=', re.M)

# Noise for readability: every resource depends on these
DEFAULT_HIDDEN = {"google_project_service", "google_project_iam_member"}


def strip_comments(text):
    return re.sub(r'(?m)^\s*(#|//).*$|\s#.*$', '', text)


def body_at(text, start):
    """Return the text between the braces opened at text[start - 1]."""
    depth = 1
    i = start
    while i < len(text) and depth:
        depth += {"{": 1, "}": -1}.get(text[i], 0)
        i += 1
    return text[start:i - 1], i


def split_locals(body):
    """Map each local name to its expression text (top-level keys only)."""
    out, depth, cur, buf = {}, 0, None, []
    for line in body.splitlines():
        m = LOCAL_KEY.match(line) if depth == 0 else None
        if m:
            if cur:
                out[cur] = "\n".join(buf)
            cur, buf = m.group(1), []
        buf.append(line)
        depth += sum(line.count(c) for c in "{[(") - sum(line.count(c) for c in "}])")
    if cur:
        out[cur] = "\n".join(buf)
    return out


def parse_stack(path):
    """Return (nodes {id: label}, refs {id: expression text}, locals)."""
    nodes, bodies, local_exprs = {}, {}, {}
    for f in sorted(path.glob("*.tf")):
        text = strip_comments(f.read_text())
        for m in HEADER.finditer(text):
            kind, labels = m.group(1), re.findall(r'"([^"]*)"', m.group(2))
            body, _ = body_at(text, m.end())
            if kind == "locals":
                local_exprs.update(split_locals(body))
                continue
            if kind == "resource":
                nid = f"{labels[0]}.{labels[1]}"
            elif kind == "data":
                nid = f"data.{labels[0]}.{labels[1]}"
            else:
                nid = f"module.{labels[0]}"
            nodes[nid] = nid
            bodies[nid] = body
    return nodes, bodies, local_exprs


def expand_locals(expr, local_exprs, seen=None):
    """Append the expressions of every local reachable from expr."""
    seen = seen if seen is not None else set()
    extra = []
    for name in LOCAL_REF.findall(expr):
        if name in local_exprs and name not in seen:
            seen.add(name)
            sub = local_exprs[name]
            extra.append(sub + expand_locals(sub, local_exprs, seen))
    return "\n".join(extra)


def mermaid_id(stack, nid):
    return re.sub(r"\W", "_", f"{stack}_{nid}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    root = Path(__file__).resolve().parent.parent / "infra"
    ap.add_argument("infra", nargs="?", type=Path, default=root, help="infra directory")
    ap.add_argument("-o", "--output", type=Path, help="write here instead of stdout")
    ap.add_argument("--show-noise", action="store_true",
                    help="keep project_service / project_iam_member nodes")
    ap.add_argument("--direction", default="LR", choices=["LR", "TB", "RL", "BT"])
    args = ap.parse_args()

    hidden = set() if args.show_noise else DEFAULT_HIDDEN
    stacks = sorted(p for p in args.infra.iterdir()
                    if p.is_dir() and any(p.glob("*.tf")))
    if not stacks and any(args.infra.glob("*.tf")):
        stacks = [args.infra]

    lines = [f"flowchart {args.direction}"]
    edges = []
    for stack in stacks:
        nodes, bodies, local_exprs = parse_stack(stack)
        visible = {n for n in nodes
                   if n.removeprefix("data.").split(".")[0] not in hidden}
        lines.append(f'  subgraph {stack.name}["{stack.name}"]')
        for n in sorted(visible):
            shape = ('(["{}"])' if n.startswith("data.") else '["{}"]').format(n)
            lines.append(f"    {mermaid_id(stack.name, n)}{shape}")
        lines.append("  end")

        for nid, body in bodies.items():
            if nid not in visible:
                continue
            # for_each over a local is only a dependency when each.value reads it
            fe = re.search(r'(?m)^\s*for_each\s*=\s*(.*)$', body)
            body = re.sub(r'(?m)^\s*for_each\s*=.*$', '', body)
            if fe and "each.value" in body:
                body += "\n" + fe.group(1)
            text = body + "\n" + expand_locals(body, local_exprs)
            targets = set()
            for data, typ, name in REF.findall(text):
                targets.add(f"{'data.' if data else ''}{typ}.{name}")
            targets |= {f"module.{m}" for m in MODULE_REF.findall(text)}
            for t in sorted(targets & visible - {nid}):
                edges.append(f"  {mermaid_id(stack.name, nid)} --> {mermaid_id(stack.name, t)}")

    lines += edges
    out = "\n".join(lines) + "\n"
    if args.output:
        args.output.write_text(out)
    else:
        sys.stdout.write(out)


if __name__ == "__main__":
    main()
