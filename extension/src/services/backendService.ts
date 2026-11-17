import * as vscode from "vscode";
import * as http from "http";
import * as url from "url";
import {
  BackendHealth,
  BackendStatusState,
  DemoSequence,
  ExampleMetadata,
  ProjectMetadata,
  RunEventsResponse,
  RunListItem,
  RunResponse,
} from "./types";

export class BackendService {
  private static instance: BackendService;

  private constructor() {}

  public static getInstance(): BackendService {
    if (!BackendService.instance) {
      BackendService.instance = new BackendService();
    }
    return BackendService.instance;
  }

  public getBackendUrl(): string {
    const config = vscode.workspace.getConfiguration("netbox");
    const configuredUrl = config.get<string>("backendUrl", "http://127.0.0.1:8000");
    return configuredUrl.replace(/\/+$/, "");
  }

  private httpRequest<T>(
    endpoint: string,
    timeoutMs: number = 5000,
    method: "GET" | "POST" = "GET",
    postBody?: any
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const fullUrl = `${this.getBackendUrl()}${endpoint}`;
      const parsed = url.parse(fullUrl);

      const postData = postBody ? JSON.stringify(postBody) : undefined;

      const options: http.RequestOptions = {
        hostname: parsed.hostname || "127.0.0.1",
        port: parsed.port ? parseInt(parsed.port, 10) : 8000,
        path: parsed.path || "/",
        method: method,
        headers: {
          Accept: "application/json",
          "User-Agent": "NetBox-VSCode-Extension/0.2.0",
          ...(postData
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(postData),
              }
            : {}),
        },
        timeout: timeoutMs,
      };

      const req = http.request(options, (res) => {
        let rawData = "";

        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          rawData += chunk;
        });

        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsedData = JSON.parse(rawData);
              resolve(parsedData as T);
            } catch (err) {
              reject(new Error(`Failed to parse backend JSON response: ${err}`));
            }
          } else {
            reject(
              new Error(
                `Backend returned HTTP ${res.statusCode}: ${res.statusMessage || "Error"}`
              )
            );
          }
        });
      });

      req.on("timeout", () => {
        req.destroy();
        reject(new Error(`Backend request timed out after ${timeoutMs}ms`));
      });

      req.on("error", (err) => {
        reject(err);
      });

      if (postData) {
        req.write(postData);
      }
      req.end();
    });
  }

  public async checkHealth(): Promise<BackendStatusState> {
    const backendUrl = this.getBackendUrl();
    try {
      const health = await this.httpRequest<BackendHealth>("/health", 2500);
      return {
        connected: health.status === "healthy",
        url: backendUrl,
        service: health.service,
        version: health.version,
      };
    } catch (err: any) {
      return {
        connected: false,
        url: backendUrl,
        error: err?.message || "Connection refused or unreachable",
      };
    }
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
    return this.httpRequest<RunResponse>("/api/runs", 10000, "POST", {
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
}
