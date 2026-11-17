import * as vscode from "vscode";
import { VisualizerPanel } from "../providers/visualizerPanel";

export function registerVisualizerCommand(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand("netbox.openVisualizer", () => {
    VisualizerPanel.createOrShow(context.extensionUri);
  });
}
