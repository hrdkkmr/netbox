import * as vscode from "vscode";
import { BackendService } from "../services/backendService";

export function registerCheckBackendCommand(): vscode.Disposable {
  return vscode.commands.registerCommand("netbox.checkBackend", async () => {
    const backend = BackendService.getInstance();
    const status = await backend.checkHealth();

    if (status.connected) {
      vscode.window.showInformationMessage(
        `NetBox backend is healthy at ${status.url} (Service: ${status.service}, v${status.version})`
      );
    } else {
      vscode.window.showWarningMessage(
        `NetBox backend is offline at ${status.url}. (${status.error}) Run ./scripts/run_backend.sh to start it.`
      );
    }
  });
}
