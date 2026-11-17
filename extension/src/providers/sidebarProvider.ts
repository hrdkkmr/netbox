import * as vscode from "vscode";

export class NetBoxSidebarItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly commandId: string,
    public readonly icon: string,
    public readonly tooltipText: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.tooltip = tooltipText;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.command = {
      command: commandId,
      title: label,
    };
  }
}

export class NetBoxSidebarProvider implements vscode.TreeDataProvider<NetBoxSidebarItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<NetBoxSidebarItem | undefined | null | void> =
    new vscode.EventEmitter<NetBoxSidebarItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<NetBoxSidebarItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: NetBoxSidebarItem): vscode.TreeItem {
    return element;
  }

  getChildren(): Thenable<NetBoxSidebarItem[]> {
    return Promise.resolve([
      new NetBoxSidebarItem(
        "Open Dashboard",
        "netbox.openDashboard",
        "dashboard",
        "Open the NetBox Project Overview & Controls Dashboard"
      ),
      new NetBoxSidebarItem(
        "Open Visualizer",
        "netbox.openVisualizer",
        "graph",
        "Open the NetBox Event & Topology Visualizer"
      ),
      new NetBoxSidebarItem(
        "Check Backend Connection",
        "netbox.checkBackend",
        "pulse",
        "Ping the local NetBox FastAPI backend"
      ),
      new NetBoxSidebarItem(
        "Show Project Information",
        "netbox.showProjectInfo",
        "info",
        "Display current phase and metadata"
      ),
    ]);
  }
}
