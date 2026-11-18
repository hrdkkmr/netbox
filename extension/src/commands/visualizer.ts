import * as vscode from "vscode";
import { VisualizerPanel } from "../providers/visualizerPanel";

export function registerVisualizerCommand(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand("netbox.openVisualizer", (runId?: string) => {
    VisualizerPanel.createOrShow(context.extensionUri, runId, {
      globalState: context.globalState,
    });
  });
}
