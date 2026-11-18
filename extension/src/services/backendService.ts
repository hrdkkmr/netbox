import * as vscode from "vscode";
import * as http from "http";
import * as https from "https";
import {
  AIAssistantResponse,
  BackendHealth,
  BackendStatusState,
  ComponentReadinessReport,
  DemoSequence,
  ExampleMetadata,
  LLMStatusResponse,
  PacketRecord,
  ProjectMetadata,
  RunCorrelationsResponse,
  RunEventsResponse,
  RunFlowsResponse,
  RunListItem,
  RunPacketsResponse,
  RunResponse,
} from "./types";
import {
  classifyConnectionError,
  sanitizeSecretFromText,
  validateBackendUrl,
} from "./connectionValidator";

const SECRET_TOKEN_KEY = "netbox.lanAccessToken";

export class BackendService {
  private static instance: BackendService;
  private _secrets: vscode.SecretStorage | undefined;

  private constructor() {}

  public static getInstance(): BackendService {
    if (!BackendService.instance) {
      BackendService.instance = new BackendService();
    }
    return BackendService.instance;
  }

  /**
   * Initializes secure token storage using VS Code SecretStorage.
   * Migrates any legacy plain-text netbox.accessToken setting cleanly into SecretStorage.
   */
  public async initialize(secrets: vscode.SecretStorage): Promise<void> {
    this._secrets = secrets;
    const config = vscode.workspace.getConfiguration("netbox");
    const legacyToken = (config.get<string>("accessToken", "") || "").trim();
    if (legacyToken) {
      await this._secrets.store(SECRET_TOKEN_KEY, legacyToken);
      try {
        await config.update("accessToken", undefined, vscode.ConfigurationTarget.Global);
      } catch {
        // Ignore if setting key is no longer registered
      }
    }
  }

  public getBackendUrl(): string {
    const config = vscode.workspace.getConfiguration("netbox");
    const configuredUrl = config.get<string>("backendUrl", "http://127.0.0.1:8000");
    const validated = validateBackendUrl(configuredUrl);
    if (validated.valid && validated.normalized) {
      return validated.normalized;
    }
    return configuredUrl.trim().replace(/\/+$/, "") || "http://127.0.0.1:8000";
  }

  public async getAccessToken(): Promise<string> {
    if (this._secrets) {
      const stored = await this._secrets.get(SECRET_TOKEN_KEY);
      if (stored && stored.trim()) {
        return stored.trim();
      }
    }
    return "";
  }

  public async hasStoredAccessToken(): Promise<boolean> {
    const token = await this.getAccessToken();
    return token.length > 0;
  }

  public getDefaultTimeoutMs(): number {
    const config = vscode.workspace.getConfiguration("netbox");
    const val = config.get<number>("connectionTimeoutMs", 5000);
    return Number.isFinite(val) && val >= 1000 ? val : 5000;
  }

  public async updateConnectionSettings(backendUrl?: string, accessToken?: string): Promise<void> {
    const config = vscode.workspace.getConfiguration("netbox");
    if (backendUrl !== undefined) {
      const check = validateBackendUrl(backendUrl);
      if (!check.valid || !check.normalized) {
        throw new Error(check.error || "Invalid NetBox backend URL.");
      }
      await config.update("backendUrl", check.normalized, vscode.ConfigurationTarget.Global);
    }
    if (accessToken !== undefined && this._secrets) {
      const cleaned = accessToken.trim();
      if (cleaned) {
        await this._secrets.store(SECRET_TOKEN_KEY, cleaned);
      } else {
        await this._secrets.delete(SECRET_TOKEN_KEY);
      }
    }
  }

  private async httpRequest<T>(
    endpoint: string,
    timeoutMs?: number,
    method: "GET" | "POST" = "GET",
    postBody?: any
  ): Promise<T> {
    const rawBase = this.getBackendUrl();
    const check = validateBackendUrl(rawBase);
    if (!check.valid || !check.normalized) {
      throw new Error(check.error || "Invalid NetBox backend URL.");
    }

    const effectiveTimeout = timeoutMs ?? this.getDefaultTimeoutMs();
    const token = await this.getAccessToken();
    const target = new URL(`${check.normalized}${endpoint}`);
    const transport = target.protocol === "https:" ? https : http;
    const postData = postBody !== undefined ? JSON.stringify(postBody) : undefined;

    return new Promise((resolve, reject) => {
      const options: http.RequestOptions = {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port ? parseInt(target.port, 10) : target.protocol === "https:" ? 443 : 80,
        path: `${target.pathname}${target.search}`,
        method,
        headers: {
          Accept: "application/json",
          "User-Agent": "NetBox-VSCode-Extension/0.8.0",
          ...(token ? { "X-NetBox-Token": token } : {}),
          ...(postData
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(postData),
              }
            : {}),
        },
        timeout: effectiveTimeout,
      };

      const req = transport.request(options, (res) => {
        let rawData = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          rawData += chunk;
        });
        res.on("end", () => {
          const code = res.statusCode || 0;
          if (code >= 200 && code < 300) {
            try {
              resolve(JSON.parse(rawData) as T);
            } catch (err) {
              reject(new Error(`Failed to parse backend JSON response: ${sanitizeSecretFromText(String(err), token)}`));
            }
          } else {
            let detail = res.statusMessage || "Error";
            try {
              const parsedErr = JSON.parse(rawData);
              if (parsedErr && parsedErr.detail) {
                detail = String(parsedErr.detail);
              }
            } catch {
              // keep statusMessage
            }
            const safeMsg = sanitizeSecretFromText(`HTTP ${code}: ${detail}`, token);
            const err: any = new Error(safeMsg);
            err.statusCode = code;
            err.category = classifyConnectionError(code, safeMsg);
            reject(err);
          }
        });
      });

      req.on("timeout", () => {
        req.destroy();
        const err: any = new Error(`Backend request timed out after ${effectiveTimeout}ms`);
        err.category = "connectivity_error";
        reject(err);
      });

      req.on("error", (err: any) => {
        const safeMsg = sanitizeSecretFromText(err?.message || "Connection failed", token);
        const wrapped: any = new Error(safeMsg);
        wrapped.category = classifyConnectionError(undefined, safeMsg);
        reject(wrapped);
      });

      if (postData) {
        req.write(postData);
      }
      req.end();
    });
  }

  public async checkHealth(): Promise<BackendStatusState> {
    const backendUrl = this.getBackendUrl();
    const urlCheck = validateBackendUrl(backendUrl);
    if (!urlCheck.valid) {
      return {
        connected: false,
        url: backendUrl,
        errorCategory: "invalid_url",
        error: urlCheck.error,
      };
    }

    try {
      const health = await this.httpRequest<BackendHealth>("/health", 3000);
      return {
        connected: health.status === "healthy",
        url: backendUrl,
        service: health.service,
        version: health.version,
        errorCategory: "none",
      };
    } catch (err: any) {
      return {
        connected: false,
        url: backendUrl,
        errorCategory: err?.category || classifyConnectionError(err?.statusCode, err?.message),
        error: err?.message || "Connection refused or unreachable",
      };
    }
  }

  /**
   * Honest multi-component readiness check distinguishing:
   * Extension Installed -> Backend Configured -> Backend Reachable -> Authenticated ->
   * Socket Instrumentation -> Packet Capture -> Ollama -> AI Model Ready.
   */
  public async getComponentReadiness(): Promise<ComponentReadinessReport> {
    const backendUrl = this.getBackendUrl();
    const urlCheck = validateBackendUrl(backendUrl);
    const hasToken = await this.hasStoredAccessToken();

    const base: ComponentReadinessReport = {
      extensionInstalled: true,
      backendConfigured: urlCheck.valid,
      backendUrl,
      hasStoredToken: hasToken,
      backendReachable: false,
      authenticated: false,
      errorCategory: urlCheck.valid ? "none" : "invalid_url",
      errorDetail: urlCheck.valid ? null : urlCheck.error || "Invalid URL",
      backendVersion: null,
      mode: null,
      socketInstrumentation: { status: "unavailable", detail: "Backend unreachable." },
      packetCapture: { status: "unavailable", detail: "Backend unreachable." },
      ollama: { status: "unavailable", detail: "Backend unreachable." },
      aiModel: { status: "unavailable", detail: "Backend unreachable." },
      lan: { status: "unavailable", detail: "Backend unreachable." },
    };

    if (!urlCheck.valid) {
      return base;
    }

    try {
      const sysHealth = await this.httpRequest<any>("/api/system/health", 3500);
      base.backendReachable = true;
      base.backendVersion = sysHealth.backend_version || null;
      base.mode = sysHealth.mode || "localhost";
      const comps = sysHealth.components || {};
      if (comps.socket_instrumentation) base.socketInstrumentation = comps.socket_instrumentation;
      if (comps.packet_capture) base.packetCapture = comps.packet_capture;
      if (comps.ollama) base.ollama = comps.ollama;
      if (comps.ai_model) base.aiModel = comps.ai_model;
      if (comps.lan) base.lan = comps.lan;
    } catch (err: any) {
      base.errorCategory = err?.category || "connectivity_error";
      base.errorDetail = err?.message || "Cannot reach NetBox backend.";
      return base;
    }

    // Verify authentication explicitly (distinguishes connectivity vs auth failures)
    try {
      const authRes = await this.httpRequest<any>("/api/system/auth/verify", 3000, "POST", {});
      base.authenticated = Boolean(authRes && authRes.authenticated);
      if (!base.authenticated) {
        base.errorCategory = "auth_error";
        base.errorDetail = authRes?.detail || "LAN pairing token required or invalid.";
      }
    } catch (err: any) {
      base.authenticated = false;
      base.errorCategory = err?.category || "auth_error";
      base.errorDetail = err?.message || "Authentication check failed.";
    }

    return base;
  }

  public async getProjectInfo(): Promise<ProjectMetadata> {
    return this.httpRequest<ProjectMetadata>("/api/project");
  }

  public async getExamples(): Promise<ExampleMetadata[]> {
    return this.httpRequest<ExampleMetadata[]>("/api/examples");
  }

  public async getTcpDemo(): Promise<DemoSequence> {
    return this.httpRequest<DemoSequence>("/api/demo/tcp");
  }

  public async createRun(exampleId: string = "tcp-echo", clientArgs?: string[]): Promise<RunResponse> {
    return this.httpRequest<RunResponse>("/api/runs", 12000, "POST", {
      example_id: exampleId,
      client_args: clientArgs,
    });
  }

  public async getRun(runId: string): Promise<RunResponse> {
    return this.httpRequest<RunResponse>(`/api/runs/${encodeURIComponent(runId)}`);
  }

  public async getRunEvents(runId: string): Promise<RunEventsResponse> {
    return this.httpRequest<RunEventsResponse>(`/api/runs/${encodeURIComponent(runId)}/events`);
  }

  public async listRuns(): Promise<RunListItem[]> {
    return this.httpRequest<RunListItem[]>("/api/runs");
  }

  public async getRunPackets(runId: string): Promise<RunPacketsResponse> {
    return this.httpRequest<RunPacketsResponse>(`/api/runs/${encodeURIComponent(runId)}/packets`);
  }

  public async getRunPacketDetail(runId: string, packetId: number): Promise<PacketRecord> {
    return this.httpRequest<PacketRecord>(
      `/api/runs/${encodeURIComponent(runId)}/packets/${encodeURIComponent(String(packetId))}`
    );
  }

  public async getRunFlows(runId: string): Promise<RunFlowsResponse> {
    return this.httpRequest<RunFlowsResponse>(`/api/runs/${encodeURIComponent(runId)}/flows`);
  }

  public async getRunCorrelations(runId: string): Promise<RunCorrelationsResponse> {
    return this.httpRequest<RunCorrelationsResponse>(
      `/api/runs/${encodeURIComponent(runId)}/correlations`
    );
  }

  public async getAIStatus(): Promise<LLMStatusResponse> {
    return this.httpRequest<LLMStatusResponse>("/api/ai/status", 5000);
  }

  public async updateAIConfig(payload: { model?: string; temperature?: number }): Promise<LLMStatusResponse> {
    return this.httpRequest<LLMStatusResponse>("/api/ai/config", 5000, "POST", payload);
  }

  public async explainExecution(
    runId: string,
    learningMode: boolean = false,
    focus: "execution" | "timeline" = "execution",
    flowId?: string | null
  ): Promise<AIAssistantResponse> {
    return this.httpRequest<AIAssistantResponse>(
      `/api/ai/runs/${encodeURIComponent(runId)}/explain`,
      90000,
      "POST",
      { learning_mode: learningMode, focus, flow_id: flowId || null }
    );
  }

  public async askAboutRun(
    runId: string,
    question: string,
    learningMode: boolean = false,
    flowId?: string | null,
    packetId?: number | null
  ): Promise<AIAssistantResponse> {
    return this.httpRequest<AIAssistantResponse>(
      `/api/ai/runs/${encodeURIComponent(runId)}/ask`,
      90000,
      "POST",
      {
        question,
        learning_mode: learningMode,
        flow_id: flowId || null,
        packet_id: packetId || null,
        include_history: true,
      }
    );
  }

  public async explainPacket(
    runId: string,
    packetId: number,
    learningMode: boolean = true,
    question?: string
  ): Promise<AIAssistantResponse> {
    return this.httpRequest<AIAssistantResponse>(
      `/api/ai/runs/${encodeURIComponent(runId)}/packets/${encodeURIComponent(String(packetId))}/explain`,
      90000,
      "POST",
      { learning_mode: learningMode, question: question || null }
    );
  }

  public async askGeneral(question: string, learningMode: boolean = true): Promise<AIAssistantResponse> {
    return this.httpRequest<AIAssistantResponse>("/api/ai/ask", 90000, "POST", {
      question,
      learning_mode: learningMode,
    });
  }

  public async clearAIConversation(runId: string): Promise<{ run_id: string; cleared_turns: number }> {
    return this.httpRequest(`/api/ai/runs/${encodeURIComponent(runId)}/conversation/clear`, 5000, "POST");
  }

  public async getSystemHealth(): Promise<any> {
    return this.httpRequest("/api/system/health", 4000);
  }

  public async getSystemInfo(): Promise<any> {
    return this.httpRequest("/api/system/info", 4000);
  }

  public async getSystemNetwork(): Promise<any> {
    return this.httpRequest("/api/system/network", 5000);
  }

  public async getSystemConnection(): Promise<any> {
    return this.httpRequest("/api/system/connection", 5000);
  }

  public async sendClientHeartbeat(clientId: string, label: string): Promise<any> {
    return this.httpRequest("/api/system/clients/heartbeat", 4000, "POST", {
      client_id: clientId,
      label,
      client_type: "vscode",
    });
  }

  public async rotatePairingToken(): Promise<any> {
    return this.httpRequest("/api/system/access-control", 5000, "POST", { rotate_token: true });
  }

  public async listCurriculumLabs(): Promise<any> {
    return this.httpRequest("/api/curriculum/labs", 5000);
  }

  public async getCurriculumLab(labId: string): Promise<any> {
    return this.httpRequest(`/api/curriculum/labs/${encodeURIComponent(labId)}`, 5000);
  }

  public async runCurriculumLab(labId: string, scenarioId?: string, params?: Record<string, any>): Promise<any> {
    return this.httpRequest(
      `/api/curriculum/labs/${encodeURIComponent(labId)}/run`,
      15000,
      "POST",
      { scenario_id: scenarioId || null, params: params || {} }
    );
  }

  public async submitCurriculumAssessment(labId: string, answers: Record<string, any>): Promise<any> {
    return this.httpRequest(
      `/api/curriculum/labs/${encodeURIComponent(labId)}/assess`,
      8000,
      "POST",
      { answers }
    );
  }

  public async calculateSubnet(cidr: string, compareIp?: string): Promise<any> {
    return this.httpRequest("/api/curriculum/tools/subnet", 4000, "POST", {
      cidr,
      compare_ip: compareIp || null,
    });
  }

  public async curriculumAIInteract(payload: Record<string, any>): Promise<AIAssistantResponse> {
    return this.httpRequest<AIAssistantResponse>("/api/ai/curriculum/interact", 90000, "POST", payload);
  }
}
