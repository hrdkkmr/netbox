#ifndef NETBOX_PACKET_DECODER_H
#define NETBOX_PACKET_DECODER_H

#include <stdint.h>
#include <stddef.h>
#include <stdio.h>

#define NETBOX_MAX_TCP_OPTIONS 16
#define NETBOX_MAX_PAYLOAD_PREVIEW 64

typedef struct {
    char name[32];
    char value[64];
} netbox_tcp_option_t;

typedef struct {
    uint64_t sequence;
    uint64_t pcap_timestamp_ns;
    uint64_t capture_monotonic_ns;
    char link_layer_type[32];
    int link_layer_dlt;
    uint32_t captured_length;
    uint32_t original_length;
    int capture_truncated;

    /* Link layer MACs (available for DLT_EN10MB when non-zero) */
    int has_mac;
    char source_mac[24];
    char destination_mac[24];

    /* Network layer (IPv4) */
    int has_ipv4;
    uint8_t ip_version;
    char source_ip[46];
    char destination_ip[46];
    uint8_t ttl;
    uint16_t ip_header_length;
    uint16_t ip_total_length;
    uint16_t ip_identification;
    uint8_t ip_protocol;

    /* Transport layer (TCP) */
    int has_tcp;
    uint16_t source_port;
    uint16_t destination_port;
    uint32_t tcp_seq;
    uint32_t tcp_ack;
    uint16_t tcp_header_length;
    uint16_t tcp_window_size;
    uint8_t tcp_flags_raw;
    int flag_syn;
    int flag_ack;
    int flag_fin;
    int flag_rst;
    int flag_psh;
    int flag_urg;
    int flag_ece;
    int flag_cwr;
    int tcp_option_count;
    netbox_tcp_option_t tcp_options[NETBOX_MAX_TCP_OPTIONS];

    /* Payload metadata (raw previews disabled by default) */
    uint32_t payload_length;
    uint32_t captured_payload_bytes;
    int payload_truncated;
    int has_payload_preview;
    char preview_hex[NETBOX_MAX_PAYLOAD_PREVIEW * 2 + 1];
    char preview_utf8[NETBOX_MAX_PAYLOAD_PREVIEW * 4 + 1];

    /* Protocol label */
    char protocol[16];
    int header_truncated;
} netbox_decoded_packet_t;

/**
 * Returns human-readable DLT name for supported link-layer types, or NULL if unsupported.
 */
const char *netbox_dlt_name(int dlt);

/**
 * Decodes a raw captured frame into netbox_decoded_packet_t.
 * Returns 0 on success (including gracefully marked truncated/non-TCP frames),
 * or -1 if the link-layer type itself is unsupported.
 */
int netbox_decode_packet(
    const uint8_t *bytes,
    uint32_t caplen,
    uint32_t origlen,
    int dlt,
    uint64_t sequence,
    uint64_t pcap_ts_ns,
    uint64_t mono_ts_ns,
    int capture_payload,
    uint32_t max_payload_bytes,
    netbox_decoded_packet_t *out
);

/**
 * Writes a single decoded packet as one JSONL line to the output stream.
 */
int netbox_write_packet_jsonl(
    FILE *out,
    const char *run_id,
    const char *iface,
    const netbox_decoded_packet_t *pkt
);

#endif /* NETBOX_PACKET_DECODER_H */
