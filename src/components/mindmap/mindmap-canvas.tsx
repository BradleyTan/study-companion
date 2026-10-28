"use client";
import {
  Background, BackgroundVariant, Controls, Handle, Position, ReactFlow, ReactFlowProvider, useNodesInitialized, useNodesState, useReactFlow,
  type Edge, type Node, type NodeProps, type NodeTypes,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import type { MindmapGraph } from "@/lib/ai/types";
import { positionsFor, treeOrder } from "@/lib/mindmap/layout";
import { edgeSides, entranceOrder, nodeLabel, nudge, type Side } from "@/lib/mindmap/view";
import { usePhone } from "../ui/use-media";

type Data = { label: string; detail: string | null; depth: number; hasPassage: boolean; emoji: string; order: number; animate: boolean };
type MmNode = Node<Data, "mm">;

const SIDES: Record<Side, Position> = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left };

function QuoteIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" className="ml-1 inline-block shrink-0 align-[-2px]" fill="currentColor">
      <path d="M7 6h4v6H8c0 2 1 3 3 3v3c-4 0-6-2-6-6V6zm9 0h4v6h-3c0 2 1 3 3 3v3c-4 0-6-2-6-6V6z" />
    </svg>
  );
}

function MindmapNodeView({ data }: NodeProps<MmNode>) {
  const cls = `${data.depth === 0 ? "mm-node mm-root" : data.depth === 1 ? "mm-node mm-1" : "mm-node"}${data.detail ? " mm-has-detail" : ""}`;
  return (
    <>
      {(Object.keys(SIDES) as Side[]).map((s) => (
        <Handle key={`t-${s}`} id={`t-${s}`} type="target" position={SIDES[s]} isConnectable={false} />
      ))}
      <div
        className={`${cls} ${data.animate ? "mm-in" : ""}`}
        style={data.animate ? { animationDelay: `${data.order * 30}ms` } : undefined}
      >
        {data.depth === 0 && <span aria-hidden="true">{data.emoji} </span>}
        {data.label}
        {data.hasPassage && <QuoteIcon />}
        {data.detail && <span className="mm-detail">{data.detail}</span>}
      </div>
      {(Object.keys(SIDES) as Side[]).map((s) => (
        <Handle key={`s-${s}`} id={`s-${s}`} type="source" position={SIDES[s]} isConnectable={false} />
      ))}
    </>
  );
}

const nodeTypes: NodeTypes = { mm: MindmapNodeView };

const FIT = { padding: "24px" } as const;
/** Phones: never smaller than 0.7, so the root and level-1 topics stay readable (polish.md P2-9). */
const FIT_PHONE = { padding: "24px", minZoom: 0.7 } as const;

function buildNodes(graph: MindmapGraph, emoji: string, animate: boolean, details: boolean): MmNode[] {
  const pos = positionsFor(graph, details);
  const order = entranceOrder(graph);
  return treeOrder(graph).map(({ node, depth, childCount }) => ({
    id: node.id,
    type: "mm",
    position: pos.get(node.id) ?? { x: 0, y: 0 },
    ariaLabel: nodeLabel(node.label, depth, childCount, !!node.chunkId, details ? node.detail : null),
    data: { label: node.label, detail: details ? node.detail ?? null : null, depth, hasPassage: !!node.chunkId, emoji, order: order.get(node.id) ?? 0, animate },
  }));
}

export type CanvasProps = {
  graph: MindmapGraph;
  subjectName: string;
  emoji: string;
  /** Play the "grow from the root" entrance (a map that just arrived). */
  animate: boolean;
  /** Bumped by "Reset layout" so every node jumps back to the auto layout. */
  layoutKey: number;
  /** Show each topic's detail on the map (mindmap.md "Details"); the outline always shows them. */
  details: boolean;
  onOpen: (nodeId: string) => void;
  /** All current positions after a drag or keyboard move. */
  onMoved: (positions: { id: string; x: number; y: number }[]) => void;
};

function Canvas({ graph, subjectName, emoji, animate, layoutKey, details, onOpen, onMoved }: CanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<MmNode>(buildNodes(graph, emoji, animate, details));
  const flow = useReactFlow<MmNode>();
  const firstLayout = useRef(layoutKey);
  const phone = usePhone();
  const measured = useNodesInitialized();

  // Fit the whole map; on a phone, fit at 0.7 or more and then centre on the root, so the student pans to explore.
  const fit = useCallback(() => {
    if (!window.matchMedia("(max-width: 639px)").matches) { void flow.fitView(FIT); return; }
    void flow.fitView(FIT_PHONE).then(() => {
      const root = flow.getNodes().find((n) => n.data.depth === 0);
      if (root) void flow.setCenter(root.position.x, root.position.y, { zoom: flow.getZoom() });
    });
  }, [flow]);

  // A new map (or a reset layout) replaces every node.
  useEffect(() => {
    setNodes(buildNodes(graph, emoji, animate && firstLayout.current === layoutKey, details));
    requestAnimationFrame(fit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, layoutKey, details]);
  // Once the nodes have their sizes (the first fit can run before they do).
  useEffect(() => { if (measured) fit(); }, [measured, fit]);

  const parentOf = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n.parentId])), [graph]);
  const edges: Edge[] = useMemo(() => {
    const at = new Map(nodes.map((n) => [n.id, n.position]));
    return nodes.flatMap((n) => {
      const p = parentOf.get(n.id);
      if (!p || !at.has(p)) return [];
      const sides = edgeSides(at.get(p)!, n.position);
      return [{ id: `${p}-${n.id}`, source: p, target: n.id, sourceHandle: `s-${sides.source}`, targetHandle: `t-${sides.target}`, focusable: false, selectable: false }];
    });
  }, [nodes, parentOf]);

  const report = useCallback((list: MmNode[]) => onMoved(list.map((n) => ({ id: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y) }))), [onMoved]);

  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const nodeEl = target.closest<HTMLElement>(".react-flow__node");
    const id = nodeEl?.dataset.id;
    if (id && e.key === "Enter") { e.preventDefault(); e.stopPropagation(); onOpen(id); return; }
    if (id) {
      const current = nodes.find((n) => n.id === id);
      const next = current ? nudge(current.position, e.key, e.shiftKey) : null;
      if (current && next) {
        e.preventDefault();
        e.stopPropagation();
        const list = nodes.map((n) => (n.id === id ? { ...n, position: next, selected: true } : n));
        setNodes(list);
        report(list);
        return;
      }
    }
    if (e.key === "+" || e.key === "=") { e.preventDefault(); void flow.zoomIn(); }
    else if (e.key === "-" || e.key === "_") { e.preventDefault(); void flow.zoomOut(); }
    else if (e.key === "0") { e.preventDefault(); fit(); }
  };

  return (
    <div
      className="h-full w-full"
      role="region"
      aria-label={`Mindmap of ${subjectName}. Use Tab to move between topics, Enter to open a topic, arrow keys to move a selected topic.`}
      onKeyDownCapture={onKeyDownCapture}
    >
      <ReactFlow<MmNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        nodeOrigin={[0.5, 0.5]}
        nodesFocusable
        edgesFocusable={false}
        nodesConnectable={false}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        nodeDragThreshold={4}
        minZoom={0.3}
        maxZoom={2}
        fitView
        fitViewOptions={phone ? FIT_PHONE : FIT}
        preventScrolling
        onNodeClick={(_, n) => onOpen(n.id)}
        onNodeDragStop={() => report(flow.getNodes())}
        ariaLabelConfig={{
          "node.a11yDescription.default": "Press Enter to open this topic's passage. Arrow keys move the selected topic.",
          "node.a11yDescription.keyboardDisabled": "Press Enter to open this topic's passage.",
          "node.a11yDescription.ariaLiveMessage": ({ direction }) => `Moved topic ${direction}.`,
          "controls.ariaLabel": "Map controls",
          "controls.zoomIn.ariaLabel": "Zoom in",
          "controls.zoomOut.ariaLabel": "Zoom out",
          "controls.fitView.ariaLabel": "Fit map to screen",
        }}
      >
        <Background variant={BackgroundVariant.Lines} gap={24} color="var(--grid)" bgColor="var(--paper)" />
        <Controls showInteractive={false} position="bottom-right" style={{ marginBottom: "calc(12px + env(safe-area-inset-bottom, 0px))", marginRight: 12 }} />
      </ReactFlow>
    </div>
  );
}

export function MindmapCanvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
