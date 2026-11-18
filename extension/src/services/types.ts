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
  errorCategory?: "none" | "auth_error" | "forbidden" | "connectivity_error" | "invalid_url" | "server_error";
  error?: string;
}

export interface ComponentStatusEntry {
  status: string;
  detail: string;
}

export interface ComponentReadinessReport {
  extensionInstalled: boolean;
  backendConfigured: boolean;
  backendUrl: string;
  hasStoredToken: boolean;
  backendReachable: boolean;
  authenticated: boolean;
  errorCategory: "none" | "auth_error" | "forbidden" | "connectivity_error" | "invalid_url" | "server_error";
  errorDetail: string | null;
  backendVersion: string | null;
  mode: string | null;
  socketInstrumentation: ComponentStatusEntry;
  packetCapture: ComponentStatusEntry;
  ollama: ComponentStatusEntry;
  aiModel: ComponentStatusEntry;
  lan: ComponentStatusEntry;
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
  socket_capture_status?: string;
  packet_capture_status?: string;
  packet_capture_interface?: string | null;
  packet_capture_error?: string | null;
  packet_count?: number;
  payload_capture_enabled?: boolean;
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
  socket_capture_status?: string;
  packet_capture_status?: string;
  packet_count?: number;
}

export interface PacketRecord {
  schema_version: string;
  run_id: string;
  sequence: number;
  source: "packet_capture";
  timestamp: {
    pcap_timestamp_ns: number;
    capture_monotonic_ns: number;
  };
  interface: string;
  link_layer: {
    type: string;
    dlt: number;
    source_mac: string | null;
    destination_mac: string | null;
  };
  protocol: string;
  network?: {
    ip_version: number;
    source_ip: string;
    destination_ip: string;
    ttl: number;
    header_length: number;
    total_length: number;
    identification: number;
    protocol_number: number;
  } | null;
  transport?: {
    source_port?: number | null;
    destination_port?: number | null;
    tcp?: {
      source_port: number;
      destination_port: number;
      sequence_number: number;
      acknowledgement_number: number;
      header_length: number;
      window_size: number;
      flags_raw: number;
      flags: Record<string, boolean>;
      options: Array<{ name: string; value: string }>;
    } | null;
  } | null;
  payload: {
    captured_bytes: number;
    payload_length: number;
    preview_hex?: string | null;
    preview_utf8?: string | null;
    truncated: boolean;
  };
  capture: {
    captured_length: number;
    original_length: number;
    truncated: boolean;
    header_truncated?: boolean;
  };
  is_simulated: boolean;
  analysis?: any;
}

export interface RunPacketsResponse {
  run_id: string;
  schema_version: string;
  is_simulated: boolean;
  packet_capture_status: string;
  interface?: string | null;
  capture_error?: string | null;
  payload_capture_enabled: boolean;
  packet_count: number;
  packets: PacketRecord[];
}

export interface RunFlowsResponse {
  run_id: string;
  packet_capture_status: string;
  interface?: string | null;
  flow_count: number;
  flows: any[];
}

export interface RunCorrelationsResponse {
  run_id: string;
  packet_capture_status: string;
  correlation_count: number;
  resolved_count: number;
  unresolved_count: number;
  correlations: any[];
}

export interface EvidenceReference {
  tag: string;
  kind: "packet" | "socket" | "flow" | "analysis";
  id: string;
  target_sequence?: number | null;
  target_flow_id?: string | null;
  verified: boolean;
  label: string;
}

export interface LLMStatusResponse {
  available: boolean;
  runtime_reachable: boolean;
  model_available: boolean;
  provider: string;
  base_url: string;
  configured_model: string;
  installed_models: string[];
  temperature: number;
  max_tokens: number;
  timeout_seconds: number;
  error?: string | null;
  setup_hint?: string | null;
}

export interface AIAssistantResponse {
  run_id?: string | null;
  mode: string;
  learning_mode: boolean;
  provider: string;
  model: string;
  answer: string;
  verified_references: EvidenceReference[];
  unverified_references: string[];
  grounding_warnings: string[];
  evidence_summary: any;
  is_general_knowledge: boolean;
  latency_ms: number;
  created_at: string;
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
  | { type: "openFile"; payload: { filePath: string } }
  | { type: "aiGetStatus" }
  | { type: "aiUpdateConfig"; payload: { model?: string; temperature?: number } }
  | { type: "aiExplainExecution"; payload: { runId: string; learningMode?: boolean; focus?: "execution" | "timeline"; flowId?: string | null } }
  | { type: "aiAskRun"; payload: { runId: string; question: string; learningMode?: boolean; flowId?: string | null; packetId?: number | null } }
  | { type: "aiExplainPacket"; payload: { runId: string; packetId: number; learningMode?: boolean; question?: string } }
  | { type: "aiAskGeneral"; payload: { question: string; learningMode?: boolean } }
  | { type: "aiClearConversation"; payload: { runId: string } }
  | { type: "systemGetOverview" }
  | { type: "systemRotateToken" }
  | { type: "systemUpdateClientConfig"; payload: { backendUrl?: string; accessToken?: string } }
  | { type: "curriculumListLabs" }
  | { type: "curriculumGetLab"; payload: { labId: string } }
  | { type: "curriculumRunLab"; payload: { labId: string; scenarioId?: string; params?: Record<string, any> } }
  | { type: "curriculumSubmitAssessment"; payload: { labId: string; answers: Record<string, any> } }
  | { type: "curriculumSubnetCalc"; payload: { cidr: string; compareIp?: string } }
  | { type: "curriculumAIInteract"; payload: Record<string, any> }
  | { type: "onboardingSetState"; payload: { completed?: boolean; skipped?: boolean; currentStep?: number } }
  | { type: "onboardingGetState" }
  | { type: "startGuidedTour" }
  | { type: "startPresentationMode" }
  | { type: "configureBackend" }
  | { type: "openDocs"; payload?: { url?: string } };

export type ExtensionToWebviewMessage =
  | { type: "backendStatus"; payload: BackendStatusState }
  | { type: "projectInfo"; payload: ProjectMetadata }
  | { type: "examplesList"; payload: ExampleMetadata[] }
  | {
      type: "eventsLoaded";
      payload: {
        runId?: string;
        runStatus?: string;
        runMeta?: RunResponse;
        isSimulated: boolean;
        label: string;
        events: NetworkEvent[];
        packetData?: RunPacketsResponse | null;
        flowsData?: RunFlowsResponse | null;
        correlationsData?: RunCorrelationsResponse | null;
      };
    }
  | { type: "runsList"; payload: RunListItem[] }
  | { type: "runCompleted"; payload: RunResponse }
  | { type: "aiStatus"; payload: LLMStatusResponse }
  | { type: "aiResponse"; payload: AIAssistantResponse }
  | { type: "aiError"; payload: { message: string } }
  | { type: "aiConversationCleared"; payload: { runId: string } }
  | { type: "errorMessage"; payload: { message: string } };
