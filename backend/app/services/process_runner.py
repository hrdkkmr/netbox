import os
import signal
import subprocess
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from ..models.runs import ProcessExecutionSummary

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
EXAMPLES_DIR = REPO_ROOT / "examples"
INSTRUMENTATION_DIR = REPO_ROOT / "instrumentation"
TRACE_SO = INSTRUMENTATION_DIR / "libnetbox_trace.so"

ALLOWED_EXAMPLES = {"tcp-echo"}


class ProcessRunnerError(Exception):
    pass


class ProcessRunner:
    @staticmethod
    def ensure_binaries() -> None:
        """Verifies or builds libnetbox_trace.so and TCP example binaries."""
        server_bin = EXAMPLES_DIR / "tcp" / "server"
        client_bin = EXAMPLES_DIR / "tcp" / "client"

        if not TRACE_SO.is_file() or not server_bin.is_file() or not client_bin.is_file():
            build = subprocess.run(
                ["make", "all"],
                cwd=str(REPO_ROOT),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=30,
            )
            if build.returncode != 0:
                raise ProcessRunnerError(f"Build failed: {build.stderr}")

    @staticmethod
    def run_tcp_echo(
        run_id: str,
        run_dir: Path,
        client_args: Optional[List[str]] = None,
        timeout_seconds: float = 8.0,
    ) -> Tuple[List[ProcessExecutionSummary], List[Path]]:
        """
        Coordinates execution of TCP server and client under libnetbox_trace.so.
        Returns:
            (List of process summaries, List of generated event file paths)
        """
        ProcessRunner.ensure_binaries()

        server_bin = EXAMPLES_DIR / "tcp" / "server"
        client_bin = EXAMPLES_DIR / "tcp" / "client"
        server_events = run_dir / "events_server.jsonl"
        client_events = run_dir / "events_client.jsonl"

        base_env = os.environ.copy()

        # 1. Start Server
        env_server = base_env.copy()
        env_server["LD_PRELOAD"] = str(TRACE_SO)
        env_server["NETBOX_RUN_ID"] = run_id
        env_server["NETBOX_PROCESS_NAME"] = "server"
        env_server["NETBOX_EVENT_FILE"] = str(server_events)

        server_proc = subprocess.Popen(
            [str(server_bin)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env_server,
            text=True,
        )

        server_summary = ProcessExecutionSummary(pid=server_proc.pid, name="server")
        client_summary = ProcessExecutionSummary(name="client")

        # 2. Wait for server readiness (read first line from server stdout)
        start_wait = time.time()
        server_ready = False
        while time.time() - start_wait < 3.0:
            if server_proc.poll() is not None:
                # Server exited unexpectedly
                stdout, stderr = server_proc.communicate()
                server_summary.stdout = stdout
                server_summary.stderr = stderr
                server_summary.exit_code = server_proc.returncode
                raise ProcessRunnerError(f"Server exited prematurely ({server_proc.returncode}): {stderr}")

            # Read line non-blockingly or with short poll
            line = server_proc.stdout.readline()
            if line:
                server_summary.stdout += line
                if "Listening on" in line:
                    server_ready = True
                    break
            time.sleep(0.05)

        if not server_ready:
            server_proc.kill()
            stdout, stderr = server_proc.communicate()
            server_summary.stdout += stdout
            server_summary.stderr += stderr
            raise ProcessRunnerError("Server failed to reach listening state within timeout.")

        # 3. Start Client
        env_client = base_env.copy()
        env_client["LD_PRELOAD"] = str(TRACE_SO)
        env_client["NETBOX_RUN_ID"] = run_id
        env_client["NETBOX_PROCESS_NAME"] = "client"
        env_client["NETBOX_EVENT_FILE"] = str(client_events)

        client_cmd = [str(client_bin)]
        if client_args:
            client_cmd.extend(client_args)

        client_proc = subprocess.Popen(
            client_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env_client,
            text=True,
        )
        client_summary.pid = client_proc.pid

        try:
            c_stdout, c_stderr = client_proc.communicate(timeout=timeout_seconds)
            client_summary.stdout = c_stdout
            client_summary.stderr = c_stderr
            client_summary.exit_code = client_proc.returncode
        except subprocess.TimeoutExpired:
            client_proc.kill()
            c_stdout, c_stderr = client_proc.communicate()
            client_summary.stdout = c_stdout
            client_summary.stderr = c_stderr + "\n[Process timed out and was killed]"
            client_summary.exit_code = -1

        # 4. Gracefully terminate server (SIGINT sends clean close in server.c)
        try:
            server_proc.send_signal(signal.SIGINT)
            s_stdout, s_stderr = server_proc.communicate(timeout=2.0)
            server_summary.stdout += s_stdout
            server_summary.stderr += s_stderr
            server_summary.exit_code = server_proc.returncode
        except subprocess.TimeoutExpired:
            server_proc.kill()
            s_stdout, s_stderr = server_proc.communicate()
            server_summary.stdout += s_stdout
            server_summary.stderr += s_stderr
            server_summary.exit_code = server_proc.returncode

        event_files = []
        if server_events.is_file():
            event_files.append(server_events)
        if client_events.is_file():
            event_files.append(client_events)

        return [server_summary, client_summary], event_files
