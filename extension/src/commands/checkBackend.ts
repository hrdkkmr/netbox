import * as vscode from "vscode";
import { BackendService } from "../services/backendService";

export function registerCheckBackendCommand(): vscode.Disposable {
  return vscode.commands.registerCommand("netbox.checkBackend", async () => {
    const backend = BackendService.getInstance();
    const report = await backend.getComponentReadiness();

    if (!report.backendConfigured) {
      vscode.window.showErrorMessage(`NetBox Backend URL is invalid: ${report.errorDetail}`);
      return;
    }

    if (!report.backendReachable) {
      const choice = await vscode.window.showWarningMessage(
        `NetBox backend is unreachable at ${report.backendUrl} (${report.errorDetail || "connection refused"}).`,
        "Configure Backend",
        "Open Setup Guide"
      );
      if (choice === "Configure Backend") {
        vscode.commands.executeCommand("netbox.configureBackend");
      } else if (choice === "Open Setup Guide") {
        vscode.commands.executeCommand("netbox.openDashboard");
      }
      return;
    }

    if (!report.authenticated) {
      const choice = await vscode.window.showWarningMessage(
        `NetBox backend at ${report.backendUrl} requires a valid LAN pairing token (${report.errorDetail || "401 Unauthorized"}).`,
        "Configure Access Token"
      );
      if (choice === "Configure Access Token") {
        vscode.commands.executeCommand("netbox.configureBackend");
      }
      return;
    }

    const summary = [
      `Backend v${report.backendVersion || "0.8.0"} (${report.mode || "localhost"})`,
      `Sockets: ${report.socketInstrumentation.status}`,
      `Packets: ${report.packetCapture.status}`,
      `AI: ${report.ollama.status === "running" && report.aiModel.status === "running" ? "ready" : report.ollama.status}`,
    ].join(" | ");
    vscode.window.showInformationMessage(`NetBox Connected: ${summary}`);
  });
}
