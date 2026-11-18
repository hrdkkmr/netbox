import asyncio
import json
import unittest
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urlsplit

from backend.app.ai.models import LLMStatusResponse
from backend.app.ai.providers.base import BaseLLMProvider, LLMConfig, LLMGenerationResult
from backend.app.ai.services.ai_assistant_service import AIAssistantService
from backend.app.core.config import NetBoxCoreConfig, get_core_config, set_core_config
from backend.app.main import app
from backend.app.services.network_discovery import build_network_overview, parse_windows_ipconfig
from backend.app.services.qr_svg import generate_qr_svg


class _ASGIResponse:
    def __init__(self, status_code: int, headers: Dict[str, str], body: bytes):
        self.status_code = status_code
        self.headers = headers
        self.body = body

    @property
    def text(self) -> str:
        return self.body.decode("utf-8", errors="replace")

    def json(self) -> Any:
        return json.loads(self.text)


class _ASGIClient:
    """Zero-dependency ASGI test client supporting arbitrary client IPv4 addresses."""

    def __init__(self, asgi_app, client: Tuple[str, int] = ("127.0.0.1", 50000)):
        self.app = asgi_app
        self.client = client

    def request(
        self,
        method: str,
        path: str,
        headers: Optional[Dict[str, str]] = None,
        json_body: Any = None,
    ) -> _ASGIResponse:
        body_bytes = b""
        req_headers = {"host": "127.0.0.1:8000"}
        if headers:
            req_headers.update({k.lower(): v for k, v in headers.items()})
        if json_body is not None:
            body_bytes = json.dumps(json_body).encode("utf-8")
            req_headers.setdefault("content-type", "application/json")
            req_headers["content-length"] = str(len(body_bytes))

        parsed = urlsplit(path)
        scope = {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": method.upper(),
            "scheme": "http",
            "path": parsed.path,
            "raw_path": parsed.path.encode("utf-8"),
            "query_string": parsed.query.encode("utf-8"),
            "headers": [(k.encode("latin-1"), v.encode("latin-1")) for k, v in req_headers.items()],
            "client": self.client,
            "server": ("127.0.0.1", 8000),
        }

        sent = False
        status_code = 500
        resp_headers: Dict[str, str] = {}
        chunks = []

        done_event = asyncio.Event()

        async def receive():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": body_bytes, "more_body": False}
            await done_event.wait()
            return {"type": "http.disconnect"}

        async def send(message):
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                for k, v in message.get("headers", []):
                    resp_headers[k.decode("latin-1").lower()] = v.decode("latin-1")
            elif message["type"] == "http.response.body":
                chunks.append(message.get("body", b""))
                if not message.get("more_body", False):
                    done_event.set()

        asyncio.run(self.app(scope, receive, send))
        return _ASGIResponse(status_code, resp_headers, b"".join(chunks))

    def get(self, path: str, headers: Optional[Dict[str, str]] = None) -> _ASGIResponse:
        return self.request("GET", path, headers=headers)

    def post(self, path: str, headers: Optional[Dict[str, str]] = None, json: Any = None) -> _ASGIResponse:
        return self.request("POST", path, headers=headers, json_body=json)


class _StubLocalProvider(BaseLLMProvider):
    provider_name = "ollama-stub"

    def __init__(self, reachable: bool = True, model_present: bool = True):
        super().__init__(LLMConfig(base_url="http://127.0.0.1:11434", model="qwen2.5-coder:1.5b"))
        self._reachable = reachable
        self._model_present = model_present

    def get_status(self) -> LLMStatusResponse:
        return LLMStatusResponse(
            available=self._reachable and self._model_present,
            runtime_reachable=self._reachable,
            model_available=self._model_present,
            provider=self.provider_name,
            base_url=self.config.base_url,
            configured_model=self.config.model,
            installed_models=[self.config.model] if self._model_present else [],
            error=None if self._reachable else "Ollama stopped on host.",
        )

    def list_models(self):
        return [self.config.model] if self._model_present else []

    def generate(self, messages, temperature=None, max_tokens=None) -> LLMGenerationResult:
        return LLMGenerationResult(
            text="Host-side grounded answer generated locally on Device A.",
            model=self.config.model,
            provider=self.provider_name,
            latency_ms=12.5,
        )


class TestPhase6LANIntegration(unittest.TestCase):
    def setUp(self):
        self._orig_cfg = get_core_config()
        self._ai_svc = AIAssistantService.get_instance()
        self._orig_provider = self._ai_svc.provider
        self._ai_svc.provider = _StubLocalProvider(reachable=True, model_present=True)
        set_core_config(NetBoxCoreConfig(mode="localhost", bind_host="127.0.0.1", port=8000, require_auth=False))

    def tearDown(self):
        set_core_config(self._orig_cfg)
        self._ai_svc.provider = self._orig_provider

    def test_01_system_health_component_independence(self):
        # Backend running while Ollama offline -> overall_status MUST be degraded, NOT running
        self._ai_svc.provider = _StubLocalProvider(reachable=False, model_present=False)
        client = _ASGIClient(app)
        resp = client.get("/api/system/health")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["components"]["backend"]["status"], "running")
        self.assertEqual(data["components"]["ollama"]["status"], "unavailable")
        self.assertEqual(data["components"]["ai_model"]["status"], "unavailable")
        self.assertEqual(data["overall_status"], "degraded")

    def test_02_windows_ipconfig_parser_and_hotspot_priority(self):
        sample = """
Windows IP Configuration

Wireless LAN adapter Local Area Connection* 10:
   IPv4 Address. . . . . . . . . . . : 192.168.137.1
   Subnet Mask . . . . . . . . . . . : 255.255.255.0

Wireless LAN adapter Wi-Fi:
   IPv4 Address. . . . . . . . . . . : 192.170.2.209
   Subnet Mask . . . . . . . . . . . : 255.255.240.0

Ethernet adapter vEthernet (WSL (Hyper-V firewall)):
   IPv4 Address. . . . . . . . . . . : 172.28.48.1
   Subnet Mask . . . . . . . . . . . : 255.255.240.0
"""
        parsed = parse_windows_ipconfig(sample)
        by_name = {r.name: r for r in parsed}
        self.assertTrue(by_name["Wireless LAN adapter Local Area Connection* 10"].is_lan_candidate)
        self.assertEqual(by_name["Wireless LAN adapter Local Area Connection* 10"].adapter_hint, "Windows Mobile Hotspot")
        self.assertTrue(by_name["Wireless LAN adapter Wi-Fi"].is_lan_candidate)
        self.assertFalse(by_name["Ethernet adapter vEthernet (WSL (Hyper-V firewall))"].is_lan_candidate)

    def test_03_offline_qr_svg_generator(self):
        svg = generate_qr_svg("http://192.168.137.1:8000/")
        self.assertIsNotNone(svg)
        self.assertTrue(svg.startswith("<svg "))
        self.assertTrue(svg.endswith("</svg>"))
        self.assertNotIn("http://cdn", svg)
        self.assertNotIn("<script", svg)

    def test_04_lan_access_control_and_host_only_token_visibility(self):
        set_core_config(
            NetBoxCoreConfig(
                mode="lan",
                bind_host="0.0.0.0",
                port=8000,
                require_auth=True,
                access_token="nbx-secret99",
                allow_remote_execution=False,
            )
        )

        host_client = _ASGIClient(app, client=("127.0.0.1", 51000))
        lan_client = _ASGIClient(app, client=("192.168.137.42", 52000))

        # 1. Host loopback sees pairing token without needing header
        host_conn = host_client.get("/api/system/connection")
        self.assertEqual(host_conn.status_code, 200)
        self.assertEqual(host_conn.json()["pairing_token"], "nbx-secret99")

        # 2. Remote LAN client blocked without token
        self.assertEqual(lan_client.get("/api/runs").status_code, 401)
        self.assertEqual(lan_client.get("/api/system/network").status_code, 401)
        self.assertEqual(lan_client.post("/api/ai/ask", json={"question": "What is TCP?"}).status_code, 401)

        # 3. Remote LAN client blocked with wrong token
        self.assertEqual(
            lan_client.get("/api/runs", headers={"X-NetBox-Token": "wrong"}).status_code,
            401,
        )

        # 4. Remote LAN client succeeds with valid token (Bearer & X-NetBox-Token)
        headers = {"Authorization": "Bearer nbx-secret99"}
        self.assertEqual(lan_client.get("/api/runs", headers=headers).status_code, 200)
        lan_conn = lan_client.get("/api/system/connection", headers=headers)
        self.assertEqual(lan_conn.status_code, 200)
        # Raw pairing token MUST NEVER be leaked back to remote LAN clients
        self.assertIsNone(lan_conn.json()["pairing_token"])

        # 5. Remote LAN client can ask Host Local AI (inferred on Device A)
        ai_res = lan_client.post(
            "/api/ai/ask",
            headers=headers,
            json={"question": "What is a TCP three-way handshake?", "learning_mode": True},
        )
        self.assertEqual(ai_res.status_code, 200)
        self.assertIn("Host-side grounded answer", ai_res.json()["answer"])

        # 6. Host disabled remote execution -> remote client gets 403 on POST /api/runs
        run_attempt = lan_client.post(
            "/api/runs",
            headers=headers,
            json={"example_id": "tcp-echo"},
        )
        self.assertEqual(run_attempt.status_code, 403)

        # 7. Remote client cannot rotate host pairing token (host-only)
        self.assertEqual(
            lan_client.post("/api/system/access-control", headers=headers, json={"rotate_token": True}).status_code,
            403,
        )

        # 8. Host CAN rotate pairing token; old token immediately invalidated
        rot = host_client.post("/api/system/access-control", json={"rotate_token": True})
        self.assertEqual(rot.status_code, 200)
        new_token = rot.json()["pairing_token"]
        self.assertNotEqual(new_token, "nbx-secret99")
        self.assertEqual(lan_client.get("/api/runs", headers=headers).status_code, 401)
        self.assertEqual(lan_client.get("/api/runs", headers={"X-NetBox-Token": new_token}).status_code, 200)

    def test_05_web_ui_serving_and_path_traversal_protection(self):
        client = _ASGIClient(app)
        root_res = client.get("/")
        self.assertEqual(root_res.status_code, 200)
        self.assertIn("NetBox Networking Platform", root_res.text)
        self.assertIn("systemDashboard.js", root_res.text)

        js_res = client.get("/media/visualizer/systemDashboard.js")
        self.assertEqual(js_res.status_code, 200)
        self.assertIn("renderSystemDashboard", js_res.text)

        # Path traversal & disallowed extension must be rejected
        trav = client.get("/media/../../backend/app/main.py")
        self.assertIn(trav.status_code, (403, 404))

    def test_06_client_heartbeat_and_system_endpoints(self):
        client = _ASGIClient(app, client=("192.168.137.55", 53000))
        hb = client.post(
            "/api/system/clients/heartbeat",
            json={"client_id": "laptop-b-01", "label": "Student Laptop B", "client_type": "browser"},
        )
        self.assertEqual(hb.status_code, 200)
        self.assertEqual(hb.json()["remote_ip"], "192.168.137.55")

        conn = client.get("/api/system/connection").json()
        client_ids = [c["client_id"] for c in conn["connected_clients"]]
        self.assertIn("laptop-b-01", client_ids)

        info = client.get("/api/system/info").json()
        self.assertEqual(info["ai_inference_location"], "host_local_only")
        self.assertFalse(info["internet_required"])

        services = client.get("/api/system/services").json()
        ollama_svc = next(s for s in services["services"] if s["id"] == "ollama")
        self.assertFalse(ollama_svc["lan_exposed"])

    def test_07_network_overview_reports_real_interfaces_and_wsl_guidance(self):
        net = build_network_overview(
            NetBoxCoreConfig(mode="lan", bind_host="0.0.0.0", port=8000, require_auth=True)
        )
        self.assertGreater(len(net.interfaces), 0)
        self.assertEqual(net.local_url, "http://127.0.0.1:8000")
        if net.is_wsl2 and net.wsl_network_mode == "wsl2_nat":
            self.assertIsNotNone(net.wsl_portproxy_command)
            self.assertIn("netsh interface portproxy", net.wsl_portproxy_command)


if __name__ == "__main__":
    unittest.main()
