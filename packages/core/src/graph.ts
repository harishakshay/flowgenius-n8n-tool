// A read-only view of a workflow as a graph, built once per scan and shared by all rules.

import { isStickyNote } from "./node-types.js";
import type { ParseIssue, Workflow, WorkflowNode } from "./types.js";

export interface WorkflowGraph {
  workflow: Workflow;
  /** Problems the parser found in the JSON itself (dangling connections, duplicate names). */
  parseIssues: ParseIssue[];
  byName: Map<string, WorkflowNode>;
  /** Nodes that run: not sticky notes, not disabled. */
  active: WorkflowNode[];
  /** Main-flow edges only (data moving between steps). */
  next(name: string): string[];
  prev(name: string): string[];
  /** Main-flow targets of one output slot, for example an error output. */
  outputTargets(name: string, slot: number): string[];
  /** Number of main output slots present in the connections, including empty ones. */
  outputSlots(name: string): number;
  /** True if this node plugs into an AI node (model, memory, tool, parser) instead of the main flow. */
  isAiSubNode(name: string): boolean;
  /** Every node reachable downstream through the main flow, excluding the start node. */
  downstream(name: string): WorkflowNode[];
  /** Groups of nodes that form a cycle in the main flow (each group has at least one edge back). */
  cycles(): WorkflowNode[][];
  /** True if the node has any connection at all, in or out, of any type. */
  isLinked(name: string): boolean;
}

export function buildGraph(workflow: Workflow, parseIssues: ParseIssue[] = []): WorkflowGraph {
  // With duplicate names (reported by data/broken-connections) keep the first node, as n8n's editor does on import.
  const byName = new Map<string, WorkflowNode>();
  for (const n of workflow.nodes) if (!byName.has(n.name)) byName.set(n.name, n);
  const nextMap = new Map<string, string[]>();
  const prevMap = new Map<string, string[]>();
  const aiSources = new Set<string>();
  const linked = new Set<string>();

  for (const [source, outputs] of Object.entries(workflow.connections)) {
    for (const [type, slots] of Object.entries(outputs)) {
      for (const slot of slots) {
        for (const target of slot ?? []) {
          linked.add(source);
          linked.add(target.node);
          if (type === "main") {
            push(nextMap, source, target.node);
            push(prevMap, target.node, source);
          } else if (type.startsWith("ai_")) {
            aiSources.add(source);
          }
        }
      }
    }
  }

  const next = (name: string): string[] => nextMap.get(name) ?? [];
  const prev = (name: string): string[] => prevMap.get(name) ?? [];
  const mainSlots = (name: string) => workflow.connections[name]?.main ?? [];

  return {
    workflow,
    parseIssues,
    byName,
    isLinked: (name) => linked.has(name),
    active: workflow.nodes.filter((n) => !isStickyNote(n) && !n.disabled),
    next,
    prev,
    outputTargets: (name, slot) => (mainSlots(name)[slot] ?? []).map((t) => t.node),
    outputSlots: (name) => mainSlots(name).length,
    // A sub-node feeds an AI node and has no main-flow edges of its own.
    isAiSubNode: (name) => aiSources.has(name) && next(name).length === 0 && prev(name).length === 0,
    downstream(name) {
      const seen = new Set<string>();
      const stack = [...next(name)];
      while (stack.length) {
        const current = stack.pop()!;
        if (seen.has(current) || current === name) continue;
        seen.add(current);
        stack.push(...next(current));
      }
      return [...seen].map((n) => byName.get(n)).filter((n): n is WorkflowNode => n !== undefined);
    },
    cycles: () => stronglyConnected([...byName.keys()], next)
      .filter((group) => group.length > 1 || next(group[0]!).includes(group[0]!))
      .map((group) => group.map((n) => byName.get(n)!)),
  };
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) {
    if (!list.includes(value)) list.push(value);
  } else map.set(key, [value]);
}

/** Tarjan's algorithm, iterative so deep workflows cannot overflow the stack. */
function stronglyConnected(names: string[], next: (n: string) => string[]): string[][] {
  let index = 0;
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const groups: string[][] = [];

  for (const root of names) {
    if (indices.has(root)) continue;
    const work: { node: string; edge: number }[] = [{ node: root, edge: 0 }];
    indices.set(root, index);
    low.set(root, index++);
    stack.push(root);
    onStack.add(root);

    while (work.length) {
      const frame = work[work.length - 1]!;
      const edges = next(frame.node);
      if (frame.edge < edges.length) {
        const target = edges[frame.edge++]!;
        if (!indices.has(target)) {
          indices.set(target, index);
          low.set(target, index++);
          stack.push(target);
          onStack.add(target);
          work.push({ node: target, edge: 0 });
        } else if (onStack.has(target)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, indices.get(target)!));
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.node, Math.min(low.get(parent.node)!, low.get(frame.node)!));
      if (low.get(frame.node) === indices.get(frame.node)) {
        const group: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          group.push(member);
        } while (member !== frame.node);
        groups.push(group);
      }
    }
  }
  return groups;
}
