import * as vscode from "vscode";
import { BackendService } from "../services/backendService";
import { validateBackendUrl } from "../services/connectionValidator";

export function registerConfigureBackendCommand(): vscode.Disposable {
  return vscode.commands.registerCommand("netbox.configureBackend", async () => {
    const backend = BackendService.getInstance();
    const currentUrl = backend.getBackendUrl();

    const urlInput = await vscode.window.showInputBox({
      title: "NetBox: Configure Backend URL (Step 1 of 2)",
      prompt: "Enter your local (http://127.0.0.1:8000) or LAN host (http://<HOST_IP>:8000) NetBox Backend URL",
      value: currentUrl,
      ignoreFocusOut: true,
      validateInput: (val) => {
        const res = validateBackendUrl(val);
        return res.valid ? null : res.error || "Invalid URL";
      },
    });

    if (urlInput === undefined) {
      return;
    }

    const validated = validateBackendUrl(urlInput);
    if (!validated.valid || !validated.normalized) {
      vscode.window.showErrorMessage(validated.error || "Invalid backend URL.");
      return;
    }

    const hasExistingToken = await backend.hasStoredAccessToken();
    const tokenChoice = await vscode.window.showQuickPick(
      [
        {
          label: validated.isLocalhost ? "$(home) No token needed (Localhost)" : "$(key) Enter LAN Access / Pairing Token",
          value: validated.isLocalhost ? "none" : "enter",
          description: validated.isLocalhost
            ? "Local loopback host typically requires no token"
            : "Stored securely in VS Code SecretStorage (never plain settings)",
        },
        {
          label: "$(key) Set / Update Access Token (SecretStorage)",
          value: "enter",
          description: hasExistingToken ? "Replace currently stored secret token" : "Store a LAN pairing token securely",
        },
        ...(hasExistingToken
          ? [
              {
                label: "$(shield) Keep Existing Stored Token",
                value: "keep",
                description: "Keep the token currently saved in VS Code SecretStorage",
              },
              {
                label: "$(trash) Clear Stored Token",
                value: "clear",
                description: "Remove token from VS Code SecretStorage",
              },
            ]
          : []),
      ],
      {
        title: "NetBox: Configure Authentication Token (Step 2 of 2)",
        placeHolder: "Choose how to handle the LAN pairing token (stored securely in VS Code SecretStorage)",
        ignoreFocusOut: true,
      }
    );

    if (!tokenChoice) {
      return;
    }

    let nextToken: string | undefined;
    if (tokenChoice.value === "enter") {
      const entered = await vscode.window.showInputBox({
        title: "NetBox: Enter LAN Pairing Token",
        prompt: "Enter the pairing token shown on the NetBox host System & LAN tab (stored in VS Code SecretStorage)",
        password: true,
        ignoreFocusOut: true,
      });
      if (entered === undefined) {
        return;
      }
      nextToken = entered.trim();
    } else if (tokenChoice.value === "clear" || tokenChoice.value === "none") {
      nextToken = "";
    }

    try {
      await backend.updateConnectionSettings(validated.normalized, nextToken);
      const report = await backend.getComponentReadiness();

      if (!report.backendReachable) {
        vscode.window.showWarningMessage(
          `Saved NetBox URL (${validated.normalized}), but the backend is currently unreachable (${report.errorDetail || "connection refused"}). Start the backend via ./scripts/start_netbox.sh.`
        );
      } else if (!report.authenticated) {
        vscode.window.showWarningMessage(
          `Connected to ${validated.normalized}, but authentication failed (401 Unauthorized). Check the host's pairing token and re-run 'NetBox: Configure Backend & Access Token'.`
        );
      } else {
        vscode.window.showInformationMessage(
          `NetBox connected and authenticated at ${validated.normalized} (v${report.backendVersion || "0.8.0"}).`
        );
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to save NetBox connection configuration: ${err?.message}`);
    }
  });
}
