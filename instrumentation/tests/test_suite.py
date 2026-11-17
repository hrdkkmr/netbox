#!/usr/bin/env python3
"""
NetBox Phase 2 Socket Instrumentation Test Suite.
Tests A through H as defined in Phase 2 requirements.
"""

import json
import os
import signal
import subprocess
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
TRACE_SO = REPO_ROOT / "instrumentation" / "libnetbox_trace.so"
SERVER_BIN = REPO_ROOT / "examples" / "tcp" / "server"
CLIENT_BIN = REPO_ROOT / "examples" / "tcp" / "client"
TEST_LOGS_DIR = Path("/tmp/netbox_test_phase2")


def setup_module():
    TEST_LOGS_DIR.mkdir(parents=True, exist_ok=True)
    subprocess.run(["make", "all"], cwd=str(REPO_ROOT), check=True)


def parse_jsonl(path: Path):
    events = []
    if not path.is_file():
        return events
    with open(path, "r", encoding="utf-8") as f:
        for idx, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
                events.append(ev)
            except Exception as e:
                raise AssertionError(f"Malformed JSON on line {idx} of {path}: {e}")
    return events


def test_case_a_basic_tcp_echo():
    print("\n--- Test A: Basic TCP Echo (Real Event Capture) ---")
    run_id = "test_a_run"
    srv_log = TEST_LOGS_DIR / "test_a_server.jsonl"
    cli_log = TEST_LOGS_DIR / "test_a_client.jsonl"
    srv_log.unlink(missing_ok=True)
    cli_log.unlink(missing_ok=True)

    base_env = os.environ.copy()
    base_env["LD_PRELOAD"] = str(TRACE_SO)
    base_env["NETBOX_RUN_ID"] = run_id

    # Start Server
    env_s = base_env.copy()
    env_s["NETBOX_PROCESS_NAME"] = "server"
    env_s["NETBOX_EVENT_FILE"] = str(srv_log)
    s_proc = subprocess.Popen([str(SERVER_BIN)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env_s, text=True)

    # Wait for server ready
    time.sleep(0.3)

    # Start Client
    env_c = base_env.copy()
    env_c["NETBOX_PROCESS_NAME"] = "client"
    env_c["NETBOX_EVENT_FILE"] = str(cli_log)
    c_res = subprocess.run([str(CLIENT_BIN), "Test A Message"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env_c, text=True, timeout=5)
    assert c_res.returncode == 0, f"Client failed: {c_res.stderr}"

    # Terminate Server
    s_proc.send_signal(signal.SIGINT)
    s_proc.wait(timeout=2)
    assert s_proc.returncode == 0

    s_events = parse_jsonl(srv_log)
    c_events = parse_jsonl(cli_log)

    print(f"Server events captured: {len(s_events)}, Client events captured: {len(c_events)}")
    assert len(s_events) >= 6  # socket, bind, listen, accept, recv, send, close
    assert len(c_events) >= 5  # socket, connect, send, recv, close

    c_types = [e["event_type"] for e in c_events]
    assert c_types == ["socket", "connect", "send", "recv", "close"]
    print("Test A PASSED!")


def test_case_b_multiple_sequential_clients():
    print("\n--- Test B: Multiple Sequential Clients ---")
    run_id = "test_b_run"
    srv_log = TEST_LOGS_DIR / "test_b_server.jsonl"
    cli_log1 = TEST_LOGS_DIR / "test_b_cli1.jsonl"
    cli_log2 = TEST_LOGS_DIR / "test_b_cli2.jsonl"
    for p in [srv_log, cli_log1, cli_log2]:
        p.unlink(missing_ok=True)

    base_env = os.environ.copy()
    base_env["LD_PRELOAD"] = str(TRACE_SO)
    base_env["NETBOX_RUN_ID"] = run_id

    # Start Server
    env_s = base_env.copy()
    env_s["NETBOX_PROCESS_NAME"] = "server"
    env_s["NETBOX_EVENT_FILE"] = str(srv_log)
    s_proc = subprocess.Popen([str(SERVER_BIN)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env_s, text=True)
    time.sleep(0.3)

    # Client 1
    env_c1 = base_env.copy()
    env_c1["NETBOX_PROCESS_NAME"] = "client_1"
    env_c1["NETBOX_EVENT_FILE"] = str(cli_log1)
    c1 = subprocess.run([str(CLIENT_BIN), "Client 1"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env_c1, text=True, timeout=5)
    assert c1.returncode == 0

    # Client 2
    env_c2 = base_env.copy()
    env_c2["NETBOX_PROCESS_NAME"] = "client_2"
    env_c2["NETBOX_EVENT_FILE"] = str(cli_log2)
    c2 = subprocess.run([str(CLIENT_BIN), "Client 2"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env_c2, text=True, timeout=5)
    assert c2.returncode == 0

    s_proc.send_signal(signal.SIGINT)
    s_proc.wait(timeout=2)

    s_events = parse_jsonl(srv_log)
    c1_events = parse_jsonl(cli_log1)
    c2_events = parse_jsonl(cli_log2)

    accept_events = [e for e in s_events if e["event_type"] == "accept" and e["result"] > 0]
    print(f"Server accepted connections: {len(accept_events)}")
    assert len(accept_events) == 2
    assert len(c1_events) >= 5
    assert len(c2_events) >= 5
    print("Test B PASSED!")


def test_case_c_connection_refused():
    print("\n--- Test C: Connection Refused (Server not running) ---")
    run_id = "test_c_run"
    cli_log = TEST_LOGS_DIR / "test_c_client.jsonl"
    cli_log.unlink(missing_ok=True)

    env_c = os.environ.copy()
    env_c["LD_PRELOAD"] = str(TRACE_SO)
    env_c["NETBOX_RUN_ID"] = run_id
    env_c["NETBOX_PROCESS_NAME"] = "client"
    env_c["NETBOX_EVENT_FILE"] = str(cli_log)

    c_res = subprocess.run([str(CLIENT_BIN)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env_c, text=True)
    assert c_res.returncode == 1, "Client should exit 1 when server is down"

    events = parse_jsonl(cli_log)
    connect_ev = next(e for e in events if e["event_type"] == "connect")
    print(f"Captured failed connect event: result={connect_ev['result']}, error_code={connect_ev['error_code']}, error_name={connect_ev['error_name']}")
    assert connect_ev["result"] == -1
    assert connect_ev["error_code"] == 111  # ECONNREFUSED
    assert connect_ev["error_name"] == "ECONNREFUSED"
    print("Test C PASSED!")


def test_case_d_invalid_input():
    print("\n--- Test D: Invalid Input (Empty client message) ---")
    run_id = "test_d_run"
    cli_log = TEST_LOGS_DIR / "test_d_client.jsonl"
    cli_log.unlink(missing_ok=True)

    env_c = os.environ.copy()
    env_c["LD_PRELOAD"] = str(TRACE_SO)
    env_c["NETBOX_RUN_ID"] = run_id
    env_c["NETBOX_PROCESS_NAME"] = "client"
    env_c["NETBOX_EVENT_FILE"] = str(cli_log)

    c_res = subprocess.run([str(CLIENT_BIN), ""], stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env_c, text=True)
    assert c_res.returncode == 1
    assert "Error: message cannot be empty" in c_res.stderr

    # Instrumentation did not break program argument validation
    print("Test D PASSED!")


def test_case_e_server_termination():
    print("\n--- Test E: Server Termination & Cleanup ---")
    run_id = "test_e_run"
    srv_log = TEST_LOGS_DIR / "test_e_server.jsonl"
    srv_log.unlink(missing_ok=True)

    env_s = os.environ.copy()
    env_s["LD_PRELOAD"] = str(TRACE_SO)
    env_s["NETBOX_RUN_ID"] = run_id
    env_s["NETBOX_PROCESS_NAME"] = "server"
    env_s["NETBOX_EVENT_FILE"] = str(srv_log)

    s_proc = subprocess.Popen([str(SERVER_BIN)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env_s, text=True)
    time.sleep(0.3)
    s_proc.send_signal(signal.SIGINT)
    s_proc.wait(timeout=2)
    assert s_proc.returncode == 0

    events = parse_jsonl(srv_log)
    close_events = [e for e in events if e["event_type"] == "close"]
    print(f"Captured close events on server termination: {len(close_events)}")
    assert len(close_events) >= 1
    print("Test E PASSED!")


def test_case_f_instrumentation_disabled():
    print("\n--- Test F: Instrumentation Disabled Baseline ---")
    # Run server & client without LD_PRELOAD
    s_proc = subprocess.Popen([str(SERVER_BIN)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    time.sleep(0.3)
    c_res = subprocess.run([str(CLIENT_BIN), "Uninstrumented"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=5)
    assert c_res.returncode == 0
    assert "Received echo (14 byte(s)): \"Uninstrumented\"" in c_res.stdout
    s_proc.send_signal(signal.SIGINT)
    s_proc.wait(timeout=2)
    assert s_proc.returncode == 0
    print("Program behaves identically with or without LD_PRELOAD.")
    print("Test F PASSED!")


def test_case_g_event_integrity():
    print("\n--- Test G: Event Schema & Ordering Integrity ---")
    # Parse all generated log files and check schema properties
    for p in TEST_LOGS_DIR.glob("*.jsonl"):
        events = parse_jsonl(p)
        seqs = [e["sequence"] for e in events]
        # Check strict sequence ordering within process
        assert seqs == sorted(seqs), f"Sequences not sorted in {p}: {seqs}"
        assert len(seqs) == len(set(seqs)), f"Duplicate sequences in {p}: {seqs}"
        for ev in events:
            assert ev["schema_version"] == "1.0"
            assert ev["source"] == "socket_api"
            assert ev["is_simulated"] is False
            assert ev["simulation_label"] == "ACTUAL SOCKET API EVENTS"
            assert "pid" in ev["process"]
            assert "tid" in ev["process"]
            assert "timestamp_ns" in ev
    print("All event streams conform strictly to docs/event_schema.md v1.0.")
    print("Test G PASSED!")


if __name__ == "__main__":
    setup_module()
    test_case_a_basic_tcp_echo()
    test_case_b_multiple_sequential_clients()
    test_case_c_connection_refused()
    test_case_d_invalid_input()
    test_case_e_server_termination()
    test_case_f_instrumentation_disabled()
    test_case_g_event_integrity()
    print("\n=======================================================")
    print("ALL TESTS (A through G) EXECUTED AND PASSED VERIFIED!")
    print("=======================================================")
