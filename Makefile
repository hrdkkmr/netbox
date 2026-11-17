CC      := gcc
CFLAGS  := -std=c11 -Wall -Wextra -Wpedantic -g

TCP_DIR     := examples/tcp
SERVER_SRC  := $(TCP_DIR)/server.c
CLIENT_SRC  := $(TCP_DIR)/client.c
SERVER_BIN  := $(TCP_DIR)/server
CLIENT_BIN  := $(TCP_DIR)/client
TRACE_SO    := instrumentation/libnetbox_trace.so

.PHONY: all server client instrumentation clean

all: server client instrumentation

server: $(SERVER_BIN)

client: $(CLIENT_BIN)

instrumentation: $(TRACE_SO)

$(TRACE_SO):
	$(MAKE) -C instrumentation

$(SERVER_BIN): $(SERVER_SRC)
	$(CC) $(CFLAGS) $< -o $@

$(CLIENT_BIN): $(CLIENT_SRC)
	$(CC) $(CFLAGS) $< -o $@

clean:
	rm -f $(SERVER_BIN) $(CLIENT_BIN)
	$(MAKE) -C instrumentation clean
