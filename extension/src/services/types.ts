/**
 * Type definitions for NetBox VS Code Extension and Webview communication.
 * Strictly adheres to docs/event_schema.md v1.0.
 */

export interface ProcessInfo {
  pid: number;
  name: string;
  ppid?: number;
  tid?: number;
}

export interface ConnectionInfo {
  local_ip: string | null;
  local_port: number | null;
  remote_ip: string | null;
  remote_port: number | null;
}

export interface PayloadInfo {
  bytes: number;
  preview_utf8?: string;
  truncated?: boolean;
}

export interface NetworkEvent {
  schema_version: string;
  run_id: string;
  sequence: number;
  timestamp_ns: number;
  source: "socket_api" | "packet_capture";
  event_type: string;
  process: ProcessInfo;
  connection?: ConnectionInfo | null;
  socket_fd?: number | null;
  socket_domain?: string | null;
  socket_type?: string | null;
  payload?: PayloadInfo | null;
  result: number;
  error_code: number | null;
  error_name?: string | null;
  error_message?: string | null;
  // Phase 1 simulation metadata
  is_simulated?: boolean;
  simulation_label?: string;
}

export interface ExampleMetadata {
  id: string;
  title: string;
  protocol: string;
  directory: string;
  files: string[];
  description: string;
  build_command: string;
  run_instructions: Record<string, string>;
}

export interface ProjectMetadata {
  name: string;
  tagline: string;
  current_phase: string;
  phase_status: string;
  description: string;
  supported_languages: string[];
  examples_count: number;
  examples: string[];
}

export interface BackendHealth {
  status: string;
  service: string;
  version: string;
}

export interface BackendStatusState {
  connected: boolean;
  url: string;
  service?: string;
  version?: string;
  error?: string;
}

export interface DemoSequence {
  demo_id: string;
  title: string;
  description: string;
  is_simulated: boolean;
  simulation_label: string;
  event_count: number;
  events: NetworkEvent[];
}

export interface ProcessSummary {
  pid?: number;
  name: string;
  exit_code?: number;
  stdout: string;
  stderr: string;
}

export interface RunResponse {
  run_id: string;
  example_id: string;
  status: string;
  created_at: string;
  start_time?: string;
  end_time?: string;
  duration_ms?: number;
  exit_code?: number;
  processes: ProcessSummary[];
  event_count: number;
  error?: string;
}

export interface RunEventsResponse {
  run_id: string;
  schema_version: string;
  is_simulated: boolean;
  simulation_label: string;
  event_count: number;
  events: NetworkEvent[];
}

export interface RunListItem {
  run_id: string;
  example_id: string;
  status: string;
  created_at: string;
  event_count: number;
  exit_code?: number;
}

// Extension <-> Webview Message Protocol
export type WebviewToExtensionMessage =
  | { type: "checkBackend" }
  | { type: "getProject" }
  | { type: "getExamples" }
  | { type: "getDemoEvents" }
  | { type: "getLiveEvents"; payload?: { runId?: string } }
  | { type: "executeLiveRun"; payload?: { exampleId?: string; clientArgs?: string[] } }
  | { type: "listRuns" }
  | { type: "openVisualizer"; payload?: { runId?: string } }
  | { type: "openFile"; payload: { filePath: string } };

export type ExtensionToWebviewMessage =
  | { type: "backendStatus"; payload: BackendStatusState }
  | { type: "projectInfo"; payload: ProjectMetadata }
  | { type: "examplesList"; payload: ExampleMetadata[] }
  | { type: "eventsLoaded"; payload: { runId?: string; isSimulated: boolean; label: string; events: NetworkEvent[] } }
  | { type: "runsList"; payload: RunListItem[] }
  | { type: "runCompleted"; payload: RunResponse }
  | { type: "errorMessage"; payload: { message: string } };
