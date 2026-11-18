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
        "Welcome & Setup",
        "netbox.openDashboard",
        "home",
        "Open NetBox Welcome, Component Readiness & Backend Setup"
      ),
      new NetBoxSidebarItem(
        "Open NetBox Workspace",
        "netbox.openVisualizer",
        "graph",
        "Open Visualizer, Packet Inspector, Curriculum Labs & Local AI Tutor"
      ),
      new NetBoxSidebarItem(
        "Start Guided Tour",
        "netbox.startGuidedTour",
        "compass",
        "Launch the 10-step interactive NetBox walkthrough and first TCP experiment"
      ),
      new NetBoxSidebarItem(
        "Presentation / Demo Mode",
        "netbox.startPresentationMode",
        "device-camera-video",
        "Launch uncluttered step-by-step presenter mode for live demonstrations"
      ),
      new NetBoxSidebarItem(
        "Configure Backend & Token",
        "netbox.configureBackend",
        "key",
        "Set local or LAN NetBox Host URL and store access token in SecretStorage"
      ),
      new NetBoxSidebarItem(
        "Check Backend Status",
        "netbox.checkBackend",
        "pulse",
        "Verify backend connectivity, authentication, capture, and AI readiness"
      ),
    ]);
  }
}
