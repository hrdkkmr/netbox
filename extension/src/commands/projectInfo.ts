import * as vscode from "vscode";
import { BackendService } from "../services/backendService";

export function registerProjectInfoCommand(): vscode.Disposable {
  return vscode.commands.registerCommand("netbox.showProjectInfo", async () => {
    const backend = BackendService.getInstance();
    const health = await backend.checkHealth();

    if (health.connected) {
      try {
        const info = await backend.getProjectInfo();
        vscode.window.showInformationMessage(
          `${info.name}: ${info.tagline} | ${info.current_phase} (${info.phase_status})`
        );
        return;
      } catch (err: any) {
        // Fall back to static info
      }
    }

    vscode.window.showInformationMessage(
      "NetBox — Computer Networks Assistant | Phase 1: VS Code Extension Foundation (Offline)"
    );
  });
}
