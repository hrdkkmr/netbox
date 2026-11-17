CC      := gcc
CFLAGS  := -std=c11 -Wall -Wextra -Wpedantic -fPIC -pthread -O2 -g
LDFLAGS := -shared -ldl -pthread

SRC_DIR := src
SRCS    := $(SRC_DIR)/netbox_trace.c $(SRC_DIR)/event_writer.c $(SRC_DIR)/socket_metadata.c
OBJS    := $(SRCS:.c=.o)
TARGET  := libnetbox_trace.so

.PHONY: all clean

all: $(TARGET)

$(TARGET): $(OBJS)
	$(CC) $(LDFLAGS) -o $@ $^

$(SRC_DIR)/%.o: $(SRC_DIR)/%.c
	$(CC) $(CFLAGS) -c $< -o $@

clean:
	rm -f $(OBJS) $(TARGET)
