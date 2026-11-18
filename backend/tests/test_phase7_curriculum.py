import json
import tempfile
import unittest
from pathlib import Path

from backend.app.ai.models import LLMStatusResponse
from backend.app.ai.providers.base import BaseLLMProvider, LLMConfig, LLMGenerationResult, LLMUnavailableError
from backend.app.ai.services.ai_assistant_service import AIAssistantService
from backend.app.core.config import NetBoxCoreConfig, get_core_config, set_core_config
from backend.app.curriculum.loader import CurriculumLoader
from backend.app.curriculum.progress_store import ProgressStore
from backend.app.curriculum.service import CurriculumService
from backend.app.curriculum.subnet_calc import calculate_subnet
from backend.app.main import app
from backend.app.services.process_runner import REPO_ROOT
from backend.tests.test_phase6_lan import _ASGIClient


class _TutorStubProvider(BaseLLMProvider):
    provider_name = "ollama-tutor-stub"

    def __init__(self, fail_unavailable: bool = False):
        super().__init__(LLMConfig(base_url="http://127.0.0.1:11434", model="qwen2.5-coder:1.5b"))
        self.fail_unavailable = fail_unavailable
        self.last_messages = []

    def get_status(self) -> LLMStatusResponse:
        return LLMStatusResponse(
            available=not self.fail_unavailable,
            runtime_reachable=not self.fail_unavailable,
            model_available=not self.fail_unavailable,
            provider=self.provider_name,
            base_url=self.config.base_url,
            configured_model=self.config.model,
            installed_models=[self.config.model] if not self.fail_unavailable else [],
        )

    def list_models(self):
        return [] if self.fail_unavailable else [self.config.model]

    def generate(self, messages, temperature=None, max_tokens=None) -> LLMGenerationResult:
        self.last_messages = messages
        if self.fail_unavailable:
            raise LLMUnavailableError("Ollama runtime unavailable on host.")
        return LLMGenerationResult(
            text=(
                "1. Textbook Knowledge: TCP establishes state via SYN, SYN+ACK, ACK.\n"
                "2. Directly Captured Observation: Observed handshake [PACKET: pkt_1] and socket call [SOCKET: sock_1].\n"
                "3. Deterministic Analysis: Flow handshake verified.\n"
                "4. AI Interpretation: Connection proceeded cleanly."
            ),
            model=self.config.model,
            provider=self.provider_name,
            latency_ms=15.0,
        )


class TestPhase7CurriculumAndScenarios(unittest.TestCase):
    def setUp(self):
        self._orig_cfg = get_core_config()
        set_core_config(NetBoxCoreConfig(mode="localhost", bind_host="127.0.0.1", port=8000, require_auth=False))
        self._tmp_dir = tempfile.TemporaryDirectory()
        self._progress_file = Path(self._tmp_dir.name) / "progress.json"

        self._svc = CurriculumService.get_instance()
        self._orig_progress = self._svc.progress
        self._svc.progress = ProgressStore(file_path=self._progress_file)

        self._ai_svc = AIAssistantService.get_instance()
        self._orig_provider = self._ai_svc.provider
        self._stub_provider = _TutorStubProvider()
        self._ai_svc.provider = self._stub_provider
        self.client = _ASGIClient(app)

    def tearDown(self):
        set_core_config(self._orig_cfg)
        self._svc.progress = self._orig_progress
        self._ai_svc.provider = self._orig_provider
        self._tmp_dir.cleanup()

    def test_01_all_9_modules_loaded_and_cn_lab_untouched(self):
        resp = self.client.get("/api/curriculum/labs")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["total_labs"], 9)
        mod_nums = [l["module_number"] for l in data["labs"]]
        self.assertEqual(mod_nums, [1, 2, 3, 4, 5, 6, 7, 8, 9])

        # Verify all 9 original college CN lab PDFs in cn_lab/ are untouched
        cn_lab_pdfs = list((REPO_ROOT / "cn_lab").glob("*.pdf"))
        self.assertEqual(len(cn_lab_pdfs), 9)

    def test_02_deterministic_subnet_calculator(self):
        # /26 standard subnet + same-subnet check
        r1 = calculate_subnet("192.168.10.70/26", "192.168.10.100")
        self.assertEqual(r1.network_address, "192.168.10.64")
        self.assertEqual(r1.broadcast_address, "192.168.10.127")
        self.assertEqual(r1.subnet_mask, "255.255.255.192")
        self.assertEqual(r1.usable_host_count, 62)
        self.assertTrue(r1.same_subnet)

        # /22 cross-octet check
        r2 = calculate_subnet("10.0.4.25/22", "10.0.7.10")
        self.assertEqual(r2.network_address, "10.0.4.0")
        self.assertEqual(r2.broadcast_address, "10.0.7.255")
        self.assertTrue(r2.same_subnet)

        # Off-subnet check via API
        api_res = self.client.post(
            "/api/curriculum/tools/subnet",
            json={"cidr": "192.168.1.10/24", "compare_ip": "8.8.8.8"},
        )
        self.assertEqual(api_res.status_code, 200)
        self.assertFalse(api_res.json()["same_subnet"])

        # Invalid CIDR rejected with 400
        bad_res = self.client.post("/api/curriculum/tools/subnet", json={"cidr": "999.1.1.1/24"})
        self.assertEqual(bad_res.status_code, 400)

    def test_03_tcp_scenarios_complete_refused_multi_rst_multiflow_and_monitor(self):
        # 1. Complete TCP echo
        r_echo = self.client.post("/api/curriculum/labs/mod4-tcp/run", json={"scenario_id": "tcp-echo"})
        self.assertEqual(r_echo.status_code, 200)
        d_echo = r_echo.json()
        self.assertGreater(d_echo["socket_event_count"], 0)
        self.assertGreater(d_echo["packet_count"], 0)

        # 2. Connection refused (ECONNREFUSED + RST)
        r_ref = self.client.post("/api/curriculum/labs/mod4-tcp/run", json={"scenario_id": "tcp-conn-refused"})
        self.assertEqual(r_ref.status_code, 200)
        self.assertGreaterEqual(r_ref.json()["measured_metrics"].get("rst_packets", 0), 1)

        # 3. Multiple sequential transfers
        r_multi = self.client.post("/api/curriculum/labs/mod4-tcp/run", json={"scenario_id": "tcp-multi-transfer"})
        self.assertEqual(r_multi.status_code, 200)
        self.assertGreater(r_multi.json()["packet_count"], 6)

        # 4. Abrupt RST via SO_LINGER
        r_rst = self.client.post("/api/curriculum/labs/mod4-tcp/run", json={"scenario_id": "tcp-abrupt-rst"})
        self.assertEqual(r_rst.status_code, 200)
        self.assertGreaterEqual(r_rst.json()["measured_metrics"].get("rst_packets", 0), 1)

        # 5. Multiple simultaneous flows
        r_flows = self.client.post("/api/curriculum/labs/mod4-tcp/run", json={"scenario_id": "tcp-multi-flow"})
        self.assertEqual(r_flows.status_code, 200)
        self.assertGreaterEqual(r_flows.json()["measured_metrics"].get("flow_count", 0), 2)

        # 6. Bulk measured monitoring transfer (Module 9)
        r_mon = self.client.post("/api/curriculum/labs/mod9-monitoring/run", json={"scenario_id": "net-monitor-transfer"})
        self.assertEqual(r_mon.status_code, 200)
        m = r_mon.json()["measured_metrics"]
        self.assertGreater(m["wire_bytes"], m["payload_bytes"])
        self.assertGreater(m["payload_bytes"], 32000)
        self.assertGreater(m["application_goodput_kbps"], 0)

    def test_04_udp_scenarios_single_multi_and_unavailable(self):
        # 1. Single UDP echo
        r_single = self.client.post("/api/curriculum/labs/mod5-udp/run", json={"scenario_id": "udp-echo"})
        self.assertEqual(r_single.status_code, 200)
        d1 = r_single.json()
        self.assertEqual(d1["protocol"], "UDP")
        self.assertGreaterEqual(d1["measured_metrics"]["sendto_calls"], 2)
        self.assertGreaterEqual(d1["measured_metrics"]["udp_packets_captured"], 2)

        # 2. Multiple datagrams with varied sizes
        r_multi = self.client.post("/api/curriculum/labs/mod5-udp/run", json={"scenario_id": "udp-multi-datagram"})
        self.assertEqual(r_multi.status_code, 200)
        d2 = r_multi.json()
        self.assertEqual(d2["measured_metrics"]["datagrams_sent"], 4)
        self.assertEqual(len(set(d2["measured_metrics"]["datagram_sizes"])), 4)
        self.assertGreaterEqual(d2["measured_metrics"]["udp_packets_captured"], 8)

        # 3. UDP unavailable (no listener)
        r_unavail = self.client.post("/api/curriculum/labs/mod5-udp/run", json={"scenario_id": "udp-unavailable"})
        self.assertEqual(r_unavail.status_code, 200)
        self.assertGreaterEqual(r_unavail.json()["measured_metrics"]["sendto_calls"], 1)

    def test_05_dns_http_l2_and_routing_labs(self):
        # Offline RFC 1035 DNS
        r_dns = self.client.post("/api/curriculum/labs/mod6-dns/run", json={"scenario_id": "dns-local"})
        self.assertEqual(r_dns.status_code, 200)
        dm = r_dns.json()["measured_metrics"]
        self.assertEqual(dm["resolved_ip"], "192.0.2.42")
        self.assertGreater(dm["uncached_ms"], dm["cached_ms"])
        self.assertGreaterEqual(dm["udp_packets_captured"], 4)

        # Local HTTP 200 + POST
        r_http = self.client.post("/api/curriculum/labs/mod7-http/run", json={"scenario_id": "http-local"})
        self.assertEqual(r_http.status_code, 200)
        self.assertEqual(r_http.json()["measured_metrics"]["status_codes"], [200, 200])
        self.assertGreater(r_http.json()["packet_count"], 0)

        # Local HTTP 404 (application error over healthy TCP)
        r_404 = self.client.post("/api/curriculum/labs/mod7-http/run", json={"scenario_id": "http-404"})
        self.assertEqual(r_404.status_code, 200)
        self.assertEqual(r_404.json()["measured_metrics"]["status_codes"], [404])
        self.assertGreater(r_404.json()["packet_count"], 0)

        # Read-only L2 interface & ARP inspection
        r_l2 = self.client.post("/api/curriculum/labs/mod2-ethernet-arp/run", json={"scenario_id": "net-inspect-l2"})
        self.assertEqual(r_l2.status_code, 200)
        self.assertGreaterEqual(r_l2.json()["measured_metrics"]["interface_count"], 1)

        # Read-only L3 routing + loopback ICMP reachability
        r_l3 = self.client.post("/api/curriculum/labs/mod8-routing/run", json={"scenario_id": "routing-inspect"})
        self.assertEqual(r_l3.status_code, 200)
        self.assertGreaterEqual(r_l3.json()["measured_metrics"]["route_count"], 1)

    def test_06_assessment_grading_and_persistent_progress_across_restarts(self):
        # Run Module 1 experiment first
        run_res = self.client.post("/api/curriculum/labs/mod1-foundations/run", json={"scenario_id": "tcp-echo"})
        self.assertEqual(run_res.status_code, 200)

        # Submit correct answers (MCQ + packet_interpretation + short_answer)
        assess_res = self.client.post(
            "/api/curriculum/labs/mod1-foundations/assess",
            json={
                "answers": {
                    "m1-q1": 1,
                    "m1-q2": 2,
                    "m1-q3": "The kernel TCP stack generates handshake SYN, ACK, and FIN packets automatically without separate send calls.",
                }
            },
        )
        self.assertEqual(assess_res.status_code, 200)
        body = assess_res.json()
        self.assertEqual(body["score_pct"], 100)
        self.assertTrue(body["passed"])
        self.assertEqual(body["progress"]["completed_count"], 1)

        # Simulate backend restart by loading a brand-new ProgressStore from the same JSON file
        reloaded = ProgressStore(file_path=self._progress_file)
        rec = reloaded.get_lab_record("mod1-foundations")
        self.assertIsNotNone(rec)
        self.assertTrue(rec.completed)
        self.assertEqual(rec.best_score_pct, 100)

        # Ensure persisted progress file stores ZERO raw packet payloads
        saved_text = self._progress_file.read_text(encoding="utf-8")
        self.assertNotIn("preview_hex", saved_text)
        self.assertNotIn("preview_utf8", saved_text)

    def test_07_curriculum_ai_tutor_all_5_modes_and_offline_handling(self):
        run_res = self.client.post("/api/curriculum/labs/mod4-tcp/run", json={"scenario_id": "tcp-echo"})
        run_id = run_res.json()["run_id"]

        for mode in ("explain", "hint", "quiz_me", "review_understanding", "connect_theory"):
            res = self.client.post(
                "/api/ai/curriculum/interact",
                json={
                    "lab_id": "mod4-tcp",
                    "mode": mode,
                    "run_id": run_id,
                    "packet_id": 1,
                    "hint_level": 2,
                    "student_explanation": "TCP starts with SYN, SYN+ACK, ACK.",
                    "learning_mode": True,
                },
            )
            self.assertEqual(res.status_code, 200, f"Mode {mode} failed: {res.text}")
            body = res.json()
            self.assertEqual(body["mode"], f"curriculum_{mode}")
            # Verified references resolved against the real run!
            verified_ids = {r["id"] for r in body["verified_references"]}
            self.assertIn("pkt_1", verified_ids)
            self.assertIn("sock_1", verified_ids)

        # Graceful 503 when local Ollama is offline
        self._stub_provider.fail_unavailable = True
        off = self.client.post(
            "/api/ai/curriculum/interact",
            json={"lab_id": "mod4-tcp", "mode": "explain", "run_id": run_id},
        )
        self.assertEqual(off.status_code, 503)

    def test_08_disallowed_scenario_rejected(self):
        res = self.client.post(
            "/api/curriculum/labs/mod1-foundations/run",
            json={"scenario_id": "rm-rf-arbitrary"},
        )
        self.assertEqual(res.status_code, 400)


if __name__ == "__main__":
    unittest.main()
