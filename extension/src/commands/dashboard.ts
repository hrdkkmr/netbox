import * as vscode from "vscode";
import { DashboardPanel } from "../providers/dashboardPanel";

export function registerDashboardCommand(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand("netbox.openDashboard", () => {
    DashboardPanel.createOrShow(context.extensionUri);
  });
}
