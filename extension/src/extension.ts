import * as vscode from "vscode";
import { registerDashboardCommand } from "./commands/dashboard";
import { registerVisualizerCommand } from "./commands/visualizer";
import { registerCheckBackendCommand } from "./commands/checkBackend";
import { registerProjectInfoCommand } from "./commands/projectInfo";
import { registerConfigureBackendCommand } from "./commands/configureBackend";
import { NetBoxSidebarProvider } from "./providers/sidebarProvider";
import { DashboardPanel } from "./providers/dashboardPanel";
import { VisualizerPanel } from "./providers/visualizerPanel";
import { BackendService } from "./services/backendService";

export async function activate(context: vscode.ExtensionContext) {
  console.log("[NetBox] Activating NetBox v0.8.0...");

  // Initialize secure SecretStorage token management (never logs secrets)
  await BackendService.getInstance().initialize(context.secrets);

  // Register core & Phase 8 onboarding/configuration commands
  context.subscriptions.push(registerDashboardCommand(context));
  context.subscriptions.push(registerVisualizerCommand(context));
  context.subscriptions.push(registerCheckBackendCommand());
  context.subscriptions.push(registerProjectInfoCommand());
  context.subscriptions.push(registerConfigureBackendCommand());

  context.subscriptions.push(
    vscode.commands.registerCommand("netbox.startGuidedTour", () => {
      VisualizerPanel.createOrShow(context.extensionUri, undefined, {
        startTour: true,
        globalState: context.globalState,
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("netbox.startPresentationMode", () => {
      VisualizerPanel.createOrShow(context.extensionUri, undefined, {
        presentationMode: true,
        globalState: context.globalState,
      });
    })
  );

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
  statusBarItem.text = "$(radio-tower) NetBox";
  statusBarItem.tooltip = "NetBox: Computer Networks Learning Environment (Click to open Welcome & Setup)";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // First-launch onboarding experience ONLY (never forces completed/returning users repeatedly)
  const welcomeShown = context.globalState.get<boolean>("netbox.welcomeShown", false);
  const onboardingCompleted = context.globalState.get<boolean>("netbox.onboardingCompleted", false);
  if (!welcomeShown && !onboardingCompleted) {
    await context.globalState.update("netbox.welcomeShown", true);
    DashboardPanel.createOrShow(context.extensionUri);
  }
}

export function deactivate() {
  console.log("[NetBox] Deactivating NetBox extension.");
}
