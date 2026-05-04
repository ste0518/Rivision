/**
 * Builds a nested heading tree from page-aware candidates (numeric depth + labelled blocks).
 */

import type { HeadingCandidate } from "@/lib/heading-detection";

export type HeadingTreeNode = {
  id: string;
  candidate: HeadingCandidate;
  children: HeadingTreeNode[];
  parentId: string | null;
  /** Nearest formal result this proof may belong to (preceding node id), when applicable. */
  nearestFormalPredecessorId?: string;
};

export type HeadingTree = {
  roots: HeadingTreeNode[];
  /** Pre-order flattened nodes for diagnostics. */
  flat: HeadingTreeNode[];
};

let idSeq = 0;
function nextId() {
  idSeq += 1;
  return `h-${idSeq}`;
}

function isFormalResult(h: HeadingCandidate): boolean {
  return ["theorem", "proposition", "lemma", "corollary", "example"].includes(h.headingType);
}

/**
 * Order-preserving tree: lower {@link HeadingCandidate.level} / shallower numeric labels become parents.
 */
export function buildHeadingHierarchy(candidates: HeadingCandidate[]): HeadingTree {
  idSeq = 0;
  const sorted = [...candidates].sort(
    (a, b) => a.pageNumber - b.pageNumber || a.lineIndex - b.lineIndex || a.text.localeCompare(b.text),
  );

  const roots: HeadingTreeNode[] = [];
  const stack: HeadingTreeNode[] = [];
  const flat: HeadingTreeNode[] = [];

  let lastFormalId: string | undefined;

  for (const c of sorted) {
    const level = c.level;

    while (stack.length > 0 && stack[stack.length - 1]!.candidate.level >= level) {
      stack.pop();
    }

    const node: HeadingTreeNode = {
      id: nextId(),
      candidate: c,
      children: [],
      parentId: stack.length ? stack[stack.length - 1]!.id : null,
      nearestFormalPredecessorId: c.headingType === "proof" ? lastFormalId : undefined,
    };

    if (isFormalResult(c)) lastFormalId = node.id;

    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1]!.children.push(node);
    }
    stack.push(node);
    flat.push(node);
  }

  return { roots, flat };
}

export function summarizeHeadingHierarchy(tree: HeadingTree): {
  rootCount: number;
  totalNodes: number;
  maxDepth: number;
  proofWithFormalAnchor: number;
  samplePath: string[];
} {
  let maxDepth = 0;
  let proofWithFormalAnchor = 0;

  const walk = (nodes: HeadingTreeNode[], depth: number) => {
    for (const n of nodes) {
      maxDepth = Math.max(maxDepth, depth);
      if (n.candidate.headingType === "proof" && n.nearestFormalPredecessorId) proofWithFormalAnchor += 1;
      walk(n.children, depth + 1);
    }
  };
  walk(tree.roots, 1);

  const samplePath: string[] = [];
  let cur: HeadingTreeNode | undefined = tree.roots[0];
  while (cur && samplePath.length < 6) {
    samplePath.push(cur.candidate.text.replace(/\s+/g, " ").slice(0, 72));
    cur = cur.children[0];
  }

  return {
    rootCount: tree.roots.length,
    totalNodes: tree.flat.length,
    maxDepth,
    proofWithFormalAnchor,
    samplePath,
  };
}
