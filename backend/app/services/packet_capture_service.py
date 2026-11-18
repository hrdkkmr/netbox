import json
import logging
import os
import signal
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger("netbox.packet_capture")

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
PCAP_DIR = REPO_ROOT / "packet_capture"
PCAP_HELPER_BIN = PCAP_DIR / "netbox_pcap"


@dataclass
class InterfaceInfo:
    name: str
    is_up: bool
    is_loopback: bool
    ipv4_addrs: List[str]


@dataclass
class CaptureAvailability:
    available: bool
    status: str  # "READY" | "UNAVAILABLE"
    reason: Optional[str] = None
    binary_exists: bool = False
    has_libpcap: bool = False
    capabilities: Optional[str] = None


class PacketCaptureService:
    @staticmethod
    def discover_interfaces() -> List[InterfaceInfo]:
        """
        Discovers active Linux network interfaces without hardcoding 'eth0' or 'lo'.
        Uses `ip -j addr` via subprocess arg array, falling back to /sys/class/net.
        """
        interfaces: List[InterfaceInfo] = []
        try:
            proc = subprocess.run(
                ["ip", "-j", "addr"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=3.0,
            )
            if proc.returncode == 0 and proc.stdout.strip():
                data = json.loads(proc.stdout)
                for item in data:
                    name = item.get("ifname", "")
                    flags = item.get("flags", [])
                    is_up = "UP" in flags
                    is_lo = "LOOPBACK" in flags
                    addrs = [
                        a.get("local")
                        for a in item.get("addr_info", [])
                        if a.get("family") == "inet" and a.get("local")
                    ]
                    if name:
                        interfaces.append(
                            InterfaceInfo(
                                name=name,
                                is_up=is_up,
                                is_loopback=is_lo,
                                ipv4_addrs=addrs,
                            )
                        )
                return interfaces
        except Exception as err:
            logger.debug("ip -j addr discovery fallback triggered: %s", err)

        sys_net = Path("/sys/class/net")
        if sys_net.is_dir():
            for entry in sorted(sys_net.iterdir()):
                name = entry.name
                is_lo = name == "lo"
                operstate_file = entry / "operstate"
                oper = operstate_file.read_text().strip() if operstate_file.is_file() else "unknown"
                interfaces.append(
                    InterfaceInfo(
                        name=name,
                        is_up=(oper == "up" or is_lo),
                        is_loopback=is_lo,
                        ipv4_addrs=["127.0.0.1"] if is_lo else [],
                    )
                )
        return interfaces

    @staticmethod
    def select_loopback_interface(requested: Optional[str] = None) -> Tuple[Optional[str], Optional[str]]:
        """
        Verifies and returns the capture interface name (defaults to loopback 'lo'
        verified to exist and carry 127.0.0.1). Returns (iface_name, error_reason).
        """
        interfaces = PacketCaptureService.discover_interfaces()
        if not interfaces:
            return None, "No network interfaces could be discovered on this host."

        if requested:
            for iface in interfaces:
                if iface.name == requested:
                    if not iface.is_up:
                        return None, f"Requested interface '{requested}' exists but is DOWN."
                    return iface.name, None
            available_names = ", ".join(i.name for i in interfaces)
            return None, f"Requested interface '{requested}' not found. Available: {available_names}"

        # Prefer loopback interface with 127.0.0.1 for local TCP example
        for iface in interfaces:
            if iface.is_loopback and iface.is_up:
                return iface.name, None

        return None, "No active loopback interface found for localhost TCP capture."

    @staticmethod
    def check_availability(helper_bin: Path = PCAP_HELPER_BIN) -> CaptureAvailability:
        """
        Checks whether the native libpcap capture helper exists, links cleanly
        against libpcap, and has capture capabilities or root privileges.
        """
        if not helper_bin.is_file():
            # Check if libpcap header exists to give an exact diagnostic
            has_header = Path("/usr/include/pcap/pcap.h").is_file() or Path("/usr/include/pcap.h").is_file()
            if not has_header:
                return CaptureAvailability(
                    available=False,
                    status="UNAVAILABLE",
                    reason=(
                        "libpcap development headers (libpcap-dev) are not installed and "
                        "packet_capture/netbox_pcap is not built. Install libpcap-dev, run "
                        "'make packet_capture', and grant cap_net_raw,cap_net_admin=eip."
                    ),
                    binary_exists=False,
                    has_libpcap=False,
                )
            return CaptureAvailability(
                available=False,
                status="UNAVAILABLE",
                reason="Capture helper binary 'packet_capture/netbox_pcap' is not built. Run 'make packet_capture'.",
                binary_exists=False,
                has_libpcap=True,
            )

        # Verify shared library dependency resolves cleanly
        has_libpcap = True
        try:
            ldd = subprocess.run(
                ["ldd", str(helper_bin)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=3.0,
            )
            if "libpcap" in ldd.stdout and "not found" in ldd.stdout:
                has_libpcap = False
                return CaptureAvailability(
                    available=False,
                    status="UNAVAILABLE",
                    reason="libpcap shared library is missing at runtime (ldd reports libpcap not found).",
                    binary_exists=True,
                    has_libpcap=False,
                )
        except Exception:
            pass

        # Check least-privilege file capabilities via getcap (or effective uid 0)
        caps_output: Optional[str] = None
        has_caps = os.geteuid() == 0
        if not has_caps:
            try:
                getcap = subprocess.run(
                    ["getcap", str(helper_bin)],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    timeout=3.0,
                )
                caps_output = getcap.stdout.strip()
                if "cap_net_raw" in caps_output:
                    has_caps = True
            except FileNotFoundError:
                pass
            except Exception as err:
                logger.debug("getcap check error: %s", err)

        if not has_caps:
            return CaptureAvailability(
                available=False,
                status="UNAVAILABLE",
                reason=(
                    "Permission denied: packet_capture/netbox_pcap lacks cap_net_raw capability. "
                    "Grant least-privilege capability via: "
                    "sudo setcap cap_net_raw,cap_net_admin=eip packet_capture/netbox_pcap"
                ),
                binary_exists=True,
                has_libpcap=has_libpcap,
                capabilities=caps_output or "none",
            )

        return CaptureAvailability(
            available=True,
            status="READY",
            reason=None,
            binary_exists=True,
            has_libpcap=has_libpcap,
            capabilities=caps_output or ("euid=0" if os.geteuid() == 0 else None),
        )


class PacketCaptureSession:
    """
    Manages the subprocess lifecycle of packet_capture/netbox_pcap for a single run.
    Always uses subprocess argument arrays (never shell concatenation) and guarantees
    clean signal termination with zero orphaned processes.
    """

    def __init__(
        self,
        run_id: str,
        interface: str,
        output_file: Path,
        bpf_filter: str = "tcp and port 8080",
        capture_payload: bool = False,
        max_payload_bytes: int = 64,
        helper_bin: Path = PCAP_HELPER_BIN,
    ):
        self.run_id = run_id
        self.interface = interface
        self.output_file = output_file
        self.bpf_filter = bpf_filter
        self.capture_payload = capture_payload
        self.max_payload_bytes = max_payload_bytes
        self.helper_bin = helper_bin

        self.proc: Optional[subprocess.Popen] = None
        self.status: str = "NOT_REQUESTED"
        self.error: Optional[str] = None
        self.dlt_name: Optional[str] = None

    def start(self, ready_timeout: float = 3.0) -> Tuple[bool, Optional[str]]:
        """
        Starts netbox_pcap and waits for NETBOX_PCAP_READY before returning
        so capture is strictly active before target processes launch.
        """
        self.status = "STARTING"
        cmd = [
            str(self.helper_bin),
            "--interface",
            self.interface,
            "--filter",
            self.bpf_filter,
            "--output",
            str(self.output_file),
            "--run-id",
            self.run_id,
            "--capture-payload",
            "1" if self.capture_payload else "0",
            "--max-payload-bytes",
            str(self.max_payload_bytes),
        ]

        try:
            self.proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                start_new_session=True,
            )
        except FileNotFoundError:
            self.status = "UNAVAILABLE"
            self.error = f"Capture helper not found at '{self.helper_bin}'."
            return False, self.error
        except PermissionError as err:
            self.status = "UNAVAILABLE"
            self.error = f"Permission denied executing capture helper: {err}"
            return False, self.error
        except Exception as err:
            self.status = "FAILED"
            self.error = f"Failed to launch capture helper: {err}"
            return False, self.error

        # Wait for explicit NETBOX_PCAP_READY signal on stdout
        deadline = time.monotonic() + ready_timeout
        while time.monotonic() < deadline:
            if self.proc.poll() is not None:
                _out, err = self.proc.communicate()
                rc = self.proc.returncode
                if rc == 13:
                    self.status = "UNAVAILABLE"
                    self.error = f"Capture permission denied on '{self.interface}': {err.strip()}"
                elif rc == 19:
                    self.status = "FAILED"
                    self.error = f"Capture interface unavailable ('{self.interface}'): {err.strip()}"
                elif rc == 22:
                    self.status = "FAILED"
                    self.error = f"Invalid BPF capture filter '{self.bpf_filter}': {err.strip()}"
                elif rc == 23:
                    self.status = "FAILED"
                    self.error = f"Unsupported link-layer type on '{self.interface}': {err.strip()}"
                else:
                    self.status = "FAILED"
                    self.error = f"Capture helper exited prematurely (code {rc}): {err.strip()}"
                self.proc = None
                return False, self.error

            if self.proc.stdout is not None:
                # Non-blocking check using select on Linux
                import select

                ready_fds, _, _ = select.select([self.proc.stdout], [], [], 0.05)
                if ready_fds:
                    line = self.proc.stdout.readline()
                    if line and line.startswith("NETBOX_PCAP_READY"):
                        for token in line.strip().split():
                            if token.startswith("dlt="):
                                self.dlt_name = token.split("=", 1)[1]
                        self.status = "CAPTURING"
                        return True, None
            else:
                time.sleep(0.05)

        # Timed out waiting for readiness — clean up so no orphan remains
        self.stop(graceful_timeout=1.0)
        self.status = "FAILED"
        self.error = f"Timed out after {ready_timeout:.1f}s waiting for packet capture readiness."
        return False, self.error

    def stop(self, graceful_timeout: float = 2.0) -> Tuple[bool, Optional[str]]:
        """
        Cleanly stops capture via SIGINT so libpcap flushes and closes output JSONL.
        Falls back to SIGTERM and SIGKILL to prevent orphaned capture processes.
        """
        if self.proc is None:
            return True, self.error

        proc = self.proc
        self.proc = None

        try:
            if proc.poll() is None:
                proc.send_signal(signal.SIGINT)
                try:
                    _out, err = proc.communicate(timeout=graceful_timeout)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(proc.pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                    try:
                        _out, err = proc.communicate(timeout=0.5)
                    except subprocess.TimeoutExpired:
                        try:
                            os.killpg(proc.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            proc.kill()
                        _out, err = proc.communicate(timeout=1.0)
                        self.status = "FAILED"
                        self.error = "Packet capture helper did not exit cleanly and was killed."
                        return False, self.error
            else:
                _out, err = proc.communicate()

            if proc.returncode != 0 and self.status == "CAPTURING":
                self.status = "FAILED"
                self.error = f"Packet capture exited with code {proc.returncode}: {err.strip()}"
                return False, self.error
            return True, None
        except Exception as err:
            try:
                proc.kill()
            except Exception:
                pass
            self.status = "FAILED"
            self.error = f"Error stopping packet capture: {err}"
            return False, self.error
