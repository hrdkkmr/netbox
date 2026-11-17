# CN Lab Material Index (`cn_lab/`)

This document indexes the Computer Networks lab assignment PDFs located in [`cn_lab/`](../cn_lab/).  
All original PDFs are preserved unmodified.

> **Source Integrity Note:** Each entry below strictly separates **facts extracted directly from the PDFs** from **NetBox technical recommendations** (how the experiment may connect to future NetBox phases). No lab solutions have been generated or assumed.

---

## Summary Table

| File | Assignment Title | Primary Language / Tools Mentioned | Core Layer(s) |
| :--- | :--- | :--- | :--- |
| [`lab1.pdf`](../cn_lab/lab1.pdf) | CN Lab (MA3105) Assignment 1: Socket Programming | Language-agnostic (notes mention Python `threading`, Java `Thread`, C `fork()`), `ifconfig`/`ipconfig` | Transport / Application (TCP Sockets) |
| [`lab2.pdf`](../cn_lab/lab2.pdf) | Computer Networks Lab Assignment 2 | Python | Application (HTTP, SMTP, FTP, DNS; LDAP in objective) |
| [`lab3.pdf`](../cn_lab/lab3.pdf) | CN Lab Assignment 3: HTTP Caching and Cookie Management in Python | Python (`http.server`, `socketserver`, raw TCP sockets) | Application (HTTP/1.x) |
| [`lab4.pdf`](../cn_lab/lab4.pdf) | Computer Networks Lab Assignment 4: Video Streaming using UDP Socket Programming in Python | Python 3.x, OpenCV (`cv2`), NumPy | Transport / Application (UDP Sockets) |
| [`lab5.pdf`](../cn_lab/lab5.pdf) | Stop-and-Wait ARQ, Go-Back-N ARQ, and Congestion Control Simulation | Python (`.py`) or C (`.c`) for ARQ tasks; Python + Matplotlib for congestion control | Data Link / Transport (ARQ, TCP Congestion Control) |
| [`lab6.pdf`](../cn_lab/lab6.pdf) | Network Traffic Capture and Protocol Analysis using Wireshark | Wireshark, `tshark`, `ping` | Link / Network / Transport / Application (Packet Capture) |
| [`lab7.pdf`](../cn_lab/lab7.pdf) | Lab Assignment 7: Routing Protocols Simulation in Python | Python (optionally `networkx`; no pre-built routing libraries) | Network (Routing Control Plane) |
| [`lab8.pdf`](../cn_lab/lab8.pdf) | Lab Question: Link-State Routing using Dijkstra's Algorithm | Python | Network (OSPF / Link-State Routing) |
| [`lab9.pdf`](../cn_lab/lab9.pdf) | Assignment 9: Data Link Layer | Python | Data Link (Framing/Error Control, MAC, ARQ) |

---

## Detailed Experiment Breakdown

### 1. [`lab1.pdf`](../cn_lab/lab1.pdf) — CN Lab (MA3105) Assignment 1: Socket Programming

- **Extracted from PDF:**
  - **Objective:** Implement a TCP-based client-server application where the client sends its name and an integer (`1`–`100`) to the server, and the server responds with its own name and another integer (`1`–`100`). Both sides display received values and compute their sum.
  - **Concepts Covered:**
    - TCP client-server communication and connection-oriented sockets.
    - Port selection (`> 5000`) and socket cleanup to avoid port binding errors (`Address already in use`).
    - Same-machine vs. cross-machine interoperability (testing with classmates).
    - Input-triggered connection termination (server closes all sockets and terminates if received number is outside `1`–`100`).
    - Optional concurrent server handling (`fork()` in C, `threading` in Python, `Thread` in Java).
  - **Protocols & Commands:** TCP; `ifconfig` (Linux/Mac), `ipconfig` (Windows).
  - **Expected Deliverables:** Client and server source code, output logs/screenshots (including interoperability test with a classmate), submitted via GitHub or Google Drive.
- **NetBox Visualizer Connection (Technical Recommendation):**
  - Directly aligns with NetBox's Phase 0 TCP foundation and Phase 2–4 C socket instrumentation + packet capture.
  - NetBox can visualize the `socket()` → `bind()` → `listen()` → `accept()` / `connect()` → `send()`/`recv()` → `close()` sequence alongside the TCP 3-way handshake and data/FIN packets, as well as cross-student LAN connections (Phase 6).

---

### 2. [`lab2.pdf`](../cn_lab/lab2.pdf) — Computer Networks Lab Assignment 2 (Date: 29-08-2025)

- **Extracted from PDF:**
  - **Objective:** Understand and implement the functionality of Application Layer protocols — HTTP, SMTP, FTP, DNS, and LDAP — using Python programming.
  - **Concepts & Tasks Covered:**
    - **Task A (HTTP):** Send `GET` and `POST` requests to a test API/website; display status code, headers, and body; log errors on failure.
    - **Task B (SMTP):** Connect to an SMTP server, send a test email, and log the communication process.
    - **Task C (FTP):** Connect to an FTP server, upload a file and confirm upload, download a file and verify content, list directory contents.
    - **Task D (DNS):** Resolve IP address of a domain name, retrieve `A`, `MX`, and `CNAME` records, and log query results to a text file.
  - **Protocols & Commands:** HTTP (`GET`, `POST`), SMTP, FTP, DNS (`A`, `MX`, `CNAME`). (LDAP is mentioned in Section 1 Objective.)
  - **Expected Deliverables:** Python scripts for each protocol and output screenshots.
- **Unclear / Missing Information in PDF:**
  - **LDAP** is listed in Section 1 (*Objective*), but there is no Task E or requirement for LDAP in Section 2 (*Tasks*).
  - No specific SMTP/FTP server endpoints or credentials are specified in the PDF.
- **NetBox Visualizer Connection (Technical Recommendation):**
  - When NetBox later adds Python or packet-level support (Phases 4–6), NetBox Core could provide local/offline test services (local HTTP server, DNS responder, or mock SMTP/FTP endpoints) so students can observe request-response flows without needing external internet access.

---

### 3. [`lab3.pdf`](../cn_lab/lab3.pdf) — CN Lab Assignment 3: Implementation of HTTP Caching and Cookie Management in Python

- **Extracted from PDF:**
  - **Objective:**
    - **Part 1:** Implement an HTTP server in Python (`http.server` and `socketserver`) serving `index.html` with caching via `ETag` (MD5 hash of content) and `Last-Modified` headers, handling conditional requests (`If-None-Match`, `If-Modified-Since`) and returning `304 Not Modified` vs. `200 OK`.
    - **Part 2:** Implement an HTTP server using raw TCP sockets in Python that manages client sessions via `Set-Cookie` (e.g., `"User123"`) and `Cookie` request headers to distinguish first-time vs. returning visitors.
  - **Concepts Covered:** Strong (`ETag`) vs. weak (`Last-Modified`) cache validators, conditional HTTP requests, `304 Not Modified`, statelessness of HTTP, session tracking via HTTP cookies, raw HTTP header parsing over TCP sockets.
  - **Protocols & Modules:** HTTP, TCP; Python `http.server`, `socketserver`, raw `socket`.
- **Unclear / Missing Information in PDF:**
  - Exact submission format/deliverables section is omitted (only Part 1, Part 2, and Conclusion are present).
- **NetBox Visualizer Connection (Technical Recommendation):**
  - The raw-socket HTTP server in Part 2 maps cleanly to NetBox's socket event timeline (`accept` → `recv` HTTP request → `send` `200 OK` / `304 Not Modified` with `ETag` or `Set-Cookie` → `close`), helping students inspect HTTP headers carried inside TCP byte streams.

---

### 4. [`lab4.pdf`](../cn_lab/lab4.pdf) — Computer Networks Lab Assignment 4: Video Streaming using UDP Socket Programming in Python

- **Extracted from PDF:**
  - **Objective:** Implement a real-time UDP video streaming application in Python where the server reads video frames, JPEG-compresses and splits them into fixed-size chunks with a marker bit header (indicating last packet of frame), and sends them over UDP; the client reassembles chunks until `marker = 1`, decodes, and displays frames via OpenCV until the user presses `"q"`.
  - **Concepts Covered:** Connectionless UDP sockets, unreliable delivery vs. low latency, frame chunking/reassembly, application-level framing header (marker bit), frame-rate pacing (`sleep` for FPS).
  - **Requirements & Libraries:** Python 3.x, OpenCV (`cv2`), NumPy, UDP sockets.
- **Unclear / Missing Information in PDF:**
  - Exact chunk size, header byte layout, port number, and behavior on lost/out-of-order UDP chunks are left to the student's implementation.
- **NetBox Visualizer Connection (Technical Recommendation):**
  - Demonstrates `SOCK_DGRAM` (`sendto` / `recvfrom`) behavior in contrast to TCP `SOCK_STREAM` (`connect` / `send` / `recv`). NetBox's packet and socket views can highlight unidirectional datagram bursts without a handshake or retransmission.

---

### 5. [`lab5.pdf`](../cn_lab/lab5.pdf) — Computer Networks Assignment: Stop-and-Wait ARQ, Go-Back-N ARQ, and Congestion Control Simulation (Date: October 10, 2025)

- **Extracted from PDF:**
  - **Objective:** Implement and analyze Transport Layer reliability and congestion control mechanisms through coding simulations:
    - **Task 1 — Stop-and-Wait ARQ:** Single-frame transmission + ACK wait, random frame loss probability, timeout and retransmission (`stop_and_wait.py` or `.c`).
    - **Task 2 — Go-Back-N ARQ:** Sliding window of size `N`, cumulative ACKs, retransmission from lost frame onward, configurable total frames/window size/loss probability (`go_back_n.py` or `.c`).
    - **Task 3 — TCP Congestion Control:** Slow Start, Congestion Avoidance, and Timeout phases; ACK increases `cwnd`; packet loss triggers multiplicative decrease; plot `cwnd` vs. transmission rounds with Matplotlib (`congestion_control.py` → `cwnd_plot.png`).
    - **Task 4 — Selective Repeat ARQ:** Configurable sliding window `N`, individual ACKs, receiver buffering of out-of-order frames, selective retransmission of only lost/timed-out frames (`selective_repeat.py` or `.c`).
  - **Concepts Covered:** Reliable data transfer, ARQ protocols (Stop-and-Wait, Go-Back-N, Selective Repeat), cumulative vs. individual ACKs, out-of-order buffering, TCP congestion window (`cwnd`), Slow Start, Congestion Avoidance, Multiplicative Decrease.
  - **Expected Deliverables:** `.py` or `.c` source files (`.py` + Matplotlib plot for Task 3) and output screenshots.
- **NetBox Visualizer Connection (Technical Recommendation):**
  - Tasks 1, 2, and 4 explicitly allow `.c` implementations, making them prime candidates for C execution in NetBox.
  - If students implement ARQ over real UDP/TCP sockets instead of purely in-memory prints, NetBox can trace frame/ACK exchanges, timeouts, and retransmissions on a sequence diagram.

---

### 6. [`lab6.pdf`](../cn_lab/lab6.pdf) — Network Traffic Capture and Protocol Analysis using Wireshark (Date: September 17, 2026)

- **Extracted from PDF:**
  - **Objective:** Capture and analyze live network traffic using Wireshark, identify protocols, and interpret headers, fields, and communication patterns.
  - **Tasks Covered:**
    - **Task 1:** Capture live traffic while visiting websites (`https://example.com`, `https://wikipedia.org`) and running `ping 8.8.8.8`; save as `capture_lab1.pcap`.
    - **Task 2:** Apply Wireshark display filters: `icmp`, `http`, `dns`.
    - **Task 3:** Expand Frame, Ethernet, IP, and protocol layers to record Source IP, Destination IP, TTL, Packet Length, and Flags for ICMP, HTTP, and DNS packets.
    - **Task 4:** Custom display filter: `ip.src == <your_IP> && (tcp.port == 80 || tcp.port == 443)`.
    - **Task 5:** Export `filtered_packets.pcap` and write a 1–2 page report (`report.pdf`).
    - **Bonus Task:** Extract HTTP request URLs via `tshark`:
      `tshark -r capture_lab1.pcap -Y http.request -T fields -e http.host -e http.request.uri`
  - **Protocols & Commands:** ICMP, HTTP, DNS, TCP (ports 80/443), Ethernet, IP; `ping`, Wireshark display filters, `tshark`.
- **NetBox Visualizer Connection (Technical Recommendation):**
  - Directly motivates **Phase 4 (Packet Capture)** in NetBox: using `tcpdump` / `libpcap` to capture real Ethernet/IP/TCP/ICMP/DNS packets and displaying packet-level headers (TTL, flags like SYN/ACK/FIN, lengths, ports) alongside socket API calls.

---

### 7. [`lab7.pdf`](../cn_lab/lab7.pdf) — Lab Assignment 7: Routing Protocols Simulation in Python (Date: October 8, 2026)

- **Extracted from PDF:**
  - **Objective:** Simulate four routing protocols in Python without pre-built routing libraries (`networkx` allowed for graph representation):
    - **Part 1 — RIP:** Distance-vector routing using Bellman–Ford algorithm; hop count metric; periodic routing table exchanges until convergence.
    - **Part 2 — OSPF:** Link-state routing using Dijkstra's algorithm; link-state database (LSDB) and LSA exchange; bandwidth/latency link costs; shortest path tree (SPT) and routing table per router.
    - **Part 3 — BGP:** Simplified path-vector routing across an AS-level topology; shortest AS path selection; `UPDATE` message exchange; loop prevention by discarding routes containing the local AS number.
    - **Part 4 — IS-IS:** Link-state flooding, database synchronization, and Dijkstra shortest-path computation; comparison with OSPF.
  - **Expected Deliverables:** Separate Python file per protocol, 2–3 page report (topology diagram, routing table snapshots, convergence/overhead comparison), output screenshots, submitted as a single ZIP. Bonus marks noted for visualizing convergence or message propagation.
- **NetBox Visualizer Connection (Technical Recommendation):**
  - Connects conceptually to NetBox's topology graph view (Phase 3), where nodes and weighted edges represent hosts/routers and links. Note that in Phase 0–4 NetBox focuses on socket/packet execution of C programs rather than routing-table simulators, though NetBox's topology visualizer could later render graph convergence if extended to Python simulations.

---

### 8. [`lab8.pdf`](../cn_lab/lab8.pdf) — Lab Question: Link-State Routing using Dijkstra's Algorithm

- **Extracted from PDF:**
  - **Objective:** Implement a Link-State Routing Protocol in Python using Dijkstra's Shortest Path Algorithm for a specific 5-node weighted topology:
    - Nodes: `A`, `B`, `C`, `D`, `E`
    - Edges and link costs (verified visually from the embedded diagram on page 1):
      - `A — B`: cost `2`
      - `A — C`: cost `4`
      - `B — D`: cost `1`
      - `B — E`: cost `3`
      - `C — D`: cost `2`
      - `D — E`: cost `2`
  - **Tasks:** Represent as weighted graph, implement LSA flooding so every router obtains the full topology, run Dijkstra at each router, output routing tables (`Destination`, `Next Hop`, `Shortest Path`, `Total Cost`) and Shortest Path Tree (SPT) per router, and capture output screenshots.
  - **Note in PDF:** States *"This is based on the assignment's OSPF/link-state requirements for LSAs, Dijkstra's algorithm, shortest-path trees, and routing tables"* (directly builds on `lab7.pdf` Part 2).
- **NetBox Visualizer Connection (Technical Recommendation):**
  - Provides a concrete reference topology (`A`–`E`) for future graph/topology visualization testing.

---

### 9. [`lab9.pdf`](../cn_lab/lab9.pdf) — Assignment 9: Data Link Layer

- **Extracted from PDF:**
  - **Objective:** Implement core Data Link Layer mechanisms in a single Python file with comments and sample input/output:
    - **Part 1 — Error Detection:**
      - **Task 1A (Parity Bit):** Compute even parity bit for a binary string and append it.
      - **Task 1B (Checksum):** 16-bit checksum (split into 16-bit blocks, binary addition with carry wrap-around, one's complement).
      - **Task 1C (CRC):** CRC remainder generation for an input dataword using a generator polynomial (e.g., $x^3 + x + 1$).
    - **Part 2 — Error Correction:**
      - **Task 2 (Hamming Code (7,4)):** Encode a 4-bit dataword into a 7-bit codeword with parity bits at power-of-2 positions.
    - **Part 3 — MAC Address Processing:**
      - **Task 3 (MAC Address to Binary):** Convert a hexadecimal MAC address into its 48-bit binary representation.
    - **Part 4 — ARQ Protocols:**
      - **Task 4 (Stop-and-Wait ARQ Simulation):** Send frames one at a time, simulate random loss of ACK or frame, retransmit when ACK is not received.
- **Unclear / Missing / Notable Details in PDF:**
  - Task 4 overlaps with Task 1 of `lab5.pdf`, but specifies random loss of either **ACK or frame** and mandates Python in a single combined file.
  - Page 2 contains a stray red pen/annotation mark near Tasks 3 and 4 (does not obscure any text).
- **NetBox Visualizer Connection (Technical Recommendation):**
  - Reinforces link-layer concepts (MAC addresses, checksums, CRC, Stop-and-Wait ARQ) that NetBox's local AI assistant (Phase 5) should understand from course context when explaining Ethernet frames, IP/TCP checksums, or retransmissions captured in Wireshark/`tcpdump`.

---

## Cross-Cutting Observations for NetBox

1. **Languages in the Course:**
   - The course uses **Python** heavily (Labs 2, 3, 4, 7, 8, 9, and Task 3 of Lab 5) and allows **C** in socket programming (Lab 1) and ARQ simulations (Lab 5 Tasks 1, 2, 4).
   - NetBox's decision to support **C first** (via POSIX socket instrumentation) is well-aligned with Lab 1 and low-level socket/packet inspection, while keeping a clean path open for Python in later phases.
2. **Protocol Coverage Across Labs:**
   - **Link Layer:** Parity, 16-bit Checksum, CRC, Hamming(7,4), MAC addressing, Stop-and-Wait/Go-Back-N/Selective Repeat ARQ.
   - **Network Layer:** IP headers, ICMP (`ping`), RIP (Bellman–Ford), OSPF (Dijkstra/LSAs), BGP (path-vector), IS-IS.
   - **Transport Layer:** TCP sockets, UDP sockets, TCP congestion control (`cwnd`), flow/reliability mechanisms.
   - **Application Layer:** HTTP (`GET`/`POST`, `ETag`, `Last-Modified`, `304`, Cookies), DNS (`A`/`MX`/`CNAME`), SMTP, FTP.
3. **Inspection Tooling Note:**
   - All 9 PDFs were inspected completely (both OCR text and page images). In `cn_lab/`, Windows NTFS metadata sidecar streams (`*:Zone.Identifier`) appear alongside the PDFs; these are harmless Windows download markers and were left untouched.
