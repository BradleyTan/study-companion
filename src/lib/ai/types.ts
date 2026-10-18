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

/** A quiz question that passed validation, linked to the student's own passage. */
export type GeneratedQuestion = {
  type: "mcq" | "fill";
  prompt: string;
  /** Multiple choice: exactly 4, in the model's order (the server shuffles them when saving). */
  options: string[] | null;
  /** Multiple choice: index of the right option in `options`. */
  correctIndex: number | null;
  /** The right option's text, or the fill-in answer. */
  answer: string;
  /** Fill in the blank: up to 3 other answers that count as right. */
  accepted: string[];
  explanation: string;
  topic: string;
  chunkId: string;
  quote: string;
};
