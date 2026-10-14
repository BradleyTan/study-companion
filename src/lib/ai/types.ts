/** A passage of the student's own text, sent to the model as data. */
export type Passage = {
  chunkId: string;
  text: string;
  page: number | null;
  /** Short local id ("p1") the model refers to; mapped back to chunkId on the server. */
  ref: string;
};

export type GeneratedCard = { front: string; back: string; chunkId: string; quote: string };

export type MindmapNode = {
  id: string;
  label: string;
  parentId: string | null;
  chunkId: string | null;
  position?: { x: number; y: number };
};
export type MindmapGraph = { version: 1; nodes: MindmapNode[] };

export type ChatMessage = { role: "system" | "user"; content: string };
