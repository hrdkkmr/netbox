CC      := gcc
CFLAGS  := -std=c11 -Wall -Wextra -Wpedantic -g

TCP_DIR     := examples/tcp
SERVER_SRC  := $(TCP_DIR)/server.c
CLIENT_SRC  := $(TCP_DIR)/client.c
SERVER_BIN  := $(TCP_DIR)/server
CLIENT_BIN  := $(TCP_DIR)/client
UDP_DIR     := examples/udp
UDP_SRV_SRC := $(UDP_DIR)/udp_server.c
UDP_CLI_SRC := $(UDP_DIR)/udp_client.c
UDP_SRV_BIN := $(UDP_DIR)/udp_server
UDP_CLI_BIN := $(UDP_DIR)/udp_client
TRACE_SO    := instrumentation/libnetbox_trace.so
PCAP_BIN    := packet_capture/netbox_pcap

.PHONY: all server client udp instrumentation packet_capture clean

all: server client udp instrumentation

server: $(SERVER_BIN)

client: $(CLIENT_BIN)

udp: $(UDP_SRV_BIN) $(UDP_CLI_BIN)

instrumentation: $(TRACE_SO)

packet_capture:
	$(MAKE) -C packet_capture

$(TRACE_SO):
	$(MAKE) -C instrumentation

$(SERVER_BIN): $(SERVER_SRC)
	$(CC) $(CFLAGS) $< -o $@

$(CLIENT_BIN): $(CLIENT_SRC)
	$(CC) $(CFLAGS) $< -o $@

$(UDP_SRV_BIN): $(UDP_SRV_SRC)
	$(CC) $(CFLAGS) $< -o $@

$(UDP_CLI_BIN): $(UDP_CLI_SRC)
	$(CC) $(CFLAGS) $< -o $@

clean:
	rm -f $(SERVER_BIN) $(CLIENT_BIN) $(UDP_SRV_BIN) $(UDP_CLI_BIN)
	$(MAKE) -C instrumentation clean
	$(MAKE) -C packet_capture clean
