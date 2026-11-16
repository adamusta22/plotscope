import type { Feature, Geometry } from 'geojson';

/** Things the assistant can ask the map UI to do. */
export type AgentAction =
  | { type: 'fly_to'; lng: number; lat: number; zoom?: number }
  | { type: 'open_location'; lng: number; lat: number }
  | { type: 'show_sites'; features: Feature[]; label?: string }
  | { type: 'enable_layers'; layers: string[] }
  | { type: 'save_site'; name: string; geometry: Geometry; notes?: string };

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool'; id: string; label: string }
  | { type: 'tool_done'; id: string; ok: boolean }
  | { type: 'action'; action: AgentAction }
  | { type: 'step'; messages: unknown[]; done: boolean }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface AgentContext {
  view?: { west: number; south: number; east: number; north: number; zoom: number };
  selection?: { kind: 'point'; lng: number; lat: number } | { kind: 'area'; geometry: Geometry; areaHa: number };
  site?: { name: string; stage: string; areaHa: number; district?: string; score?: number; constraints?: string[]; notes?: string; askingPrice?: number };
  layersOn?: string[];
  pipeline?: { count: number; names: string[] };
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}
