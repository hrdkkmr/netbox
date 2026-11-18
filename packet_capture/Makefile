CC = gcc
CFLAGS = -std=c11 -Wall -Wextra -Wpedantic -O2 -g
LDFLAGS = -lpcap

TARGET = netbox_pcap
SRCS = src/netbox_pcap.c src/packet_decoder.c
OBJS = $(SRCS:.c=.o)

.PHONY: all clean check-libpcap

all: $(TARGET)

$(TARGET): $(OBJS)
	$(CC) $(CFLAGS) -o $@ $(OBJS) $(LDFLAGS)

src/%.o: src/%.c src/packet_decoder.h
	$(CC) $(CFLAGS) -c $< -o $@

clean:
	rm -f $(OBJS) $(TARGET)
