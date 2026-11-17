import * as vscode from "vscode";
import { registerDashboardCommand } from "./commands/dashboard";
import { registerVisualizerCommand } from "./commands/visualizer";
import { registerCheckBackendCommand } from "./commands/checkBackend";
import { registerProjectInfoCommand } from "./commands/projectInfo";
import { NetBoxSidebarProvider } from "./providers/sidebarProvider";
import { BackendService } from "./services/backendService";

export function activate(context: vscode.ExtensionContext) {
  console.log("[NetBox] Activating NetBox — Computer Networks Assistant...");

  // Register commands
  context.subscriptions.push(registerDashboardCommand(context));
  context.subscriptions.push(registerVisualizerCommand(context));
  context.subscriptions.push(registerCheckBackendCommand());
  context.subscriptions.push(registerProjectInfoCommand());

  // Register sidebar tree view
  const sidebarProvider = new NetBoxSidebarProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("netbox.quickActions", sidebarProvider)
  );

  // Status bar item for 1-click access
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.command = "netbox.openDashboard";
  statusBarItem.text = "$(network) NetBox";
  statusBarItem.tooltip = "NetBox: Computer Networks Assistant (Click to open Dashboard)";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Show welcome notification on initial activation
  vscode.window.showInformationMessage(
    "NetBox Computer Networks Assistant is ready. Run 'NetBox: Open Dashboard' to get started."
  );

  // Proactively check backend status in the background
  BackendService.getInstance()
    .checkHealth()
    .then((status) => {
      if (status.connected) {
        console.log(`[NetBox] Connected to backend at ${status.url} (v${status.version})`);
      } else {
        console.log(`[NetBox] Backend offline at ${status.url}`);
      }
    })
    .catch((err) => {
      console.warn(`[NetBox] Backend check error: ${err}`);
    });
}

export function deactivate() {
  console.log("[NetBox] Deactivating NetBox extension.");
}
