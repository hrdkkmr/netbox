#define _DEFAULT_SOURCE
#define _POSIX_C_SOURCE 200809L

#include "packet_decoder.h"

#include <arpa/inet.h>
#include <pcap/pcap.h>
#include <string.h>

static uint16_t read_be16(const uint8_t *p) {
    return (uint16_t)(((uint16_t)p[0] << 8) | (uint16_t)p[1]);
}

static uint32_t read_be32(const uint8_t *p) {
    return ((uint32_t)p[0] << 24) |
           ((uint32_t)p[1] << 16) |
           ((uint32_t)p[2] << 8) |
           (uint32_t)p[3];
}

const char *netbox_dlt_name(int dlt) {
    switch (dlt) {
        case DLT_EN10MB:
            return "DLT_EN10MB";
        case DLT_NULL:
            return "DLT_NULL";
        case DLT_LOOP:
            return "DLT_LOOP";
        case DLT_LINUX_SLL:
            return "DLT_LINUX_SLL";
#ifdef DLT_LINUX_SLL2
        case DLT_LINUX_SLL2:
            return "DLT_LINUX_SLL2";
#endif
        case DLT_RAW:
            return "DLT_RAW";
        default:
            return NULL;
    }
}

static void format_mac(const uint8_t *m, char *buf, size_t len) {
    snprintf(buf, len, "%02x:%02x:%02x:%02x:%02x:%02x",
             m[0], m[1], m[2], m[3], m[4], m[5]);
}

static int is_zero_mac(const uint8_t *m) {
    return (m[0] | m[1] | m[2] | m[3] | m[4] | m[5]) == 0;
}

static void decode_tcp_options(
    const uint8_t *opts,
    size_t opts_len,
    netbox_decoded_packet_t *out
) {
    size_t i = 0;
    out->tcp_option_count = 0;

    while (i < opts_len && out->tcp_option_count < NETBOX_MAX_TCP_OPTIONS) {
        uint8_t kind = opts[i];
        if (kind == 0) {
            /* End of Option List */
            break;
        }
        if (kind == 1) {
            /* NOP */
            i += 1;
            continue;
        }
        if (i + 1 >= opts_len) {
            break;
        }
        uint8_t len = opts[i + 1];
        if (len < 2 || i + len > opts_len) {
            break;
        }

        netbox_tcp_option_t *entry = &out->tcp_options[out->tcp_option_count];
        memset(entry, 0, sizeof(*entry));

        if (kind == 2 && len == 4) {
            uint16_t mss = read_be16(opts + i + 2);
            snprintf(entry->name, sizeof(entry->name), "MSS");
            snprintf(entry->value, sizeof(entry->value), "%u", mss);
            out->tcp_option_count++;
        } else if (kind == 3 && len == 3) {
            snprintf(entry->name, sizeof(entry->name), "WScale");
            snprintf(entry->value, sizeof(entry->value), "%u", opts[i + 2]);
            out->tcp_option_count++;
        } else if (kind == 4 && len == 2) {
            snprintf(entry->name, sizeof(entry->name), "SACK_Permitted");
            snprintf(entry->value, sizeof(entry->value), "true");
            out->tcp_option_count++;
        } else if (kind == 8 && len == 10) {
            uint32_t tsval = read_be32(opts + i + 2);
            uint32_t tsecr = read_be32(opts + i + 6);
            snprintf(entry->name, sizeof(entry->name), "Timestamp");
            snprintf(entry->value, sizeof(entry->value), "TSval=%u, TSecr=%u", tsval, tsecr);
            out->tcp_option_count++;
        } else {
            snprintf(entry->name, sizeof(entry->name), "Option_%u", kind);
            snprintf(entry->value, sizeof(entry->value), "len=%u", len);
            out->tcp_option_count++;
        }

        i += len;
    }
}

static void encode_payload_preview(
    const uint8_t *payload,
    uint32_t len,
    netbox_decoded_packet_t *out
) {
    static const char HEX[] = "0123456789abcdef";
    uint32_t n = len > NETBOX_MAX_PAYLOAD_PREVIEW ? NETBOX_MAX_PAYLOAD_PREVIEW : len;
    size_t u = 0;

    for (uint32_t i = 0; i < n; i++) {
        uint8_t b = payload[i];
        out->preview_hex[i * 2] = HEX[(b >> 4) & 0x0F];
        out->preview_hex[i * 2 + 1] = HEX[b & 0x0F];

        if (u + 2 < sizeof(out->preview_utf8)) {
            if (b >= 32 && b <= 126) {
                out->preview_utf8[u++] = (char)b;
            } else {
                out->preview_utf8[u++] = '.';
            }
        }
    }
    out->preview_hex[n * 2] = '\0';
    out->preview_utf8[u] = '\0';
    out->has_payload_preview = 1;
}

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
) {
    const char *dlt_str = netbox_dlt_name(dlt);
    if (!dlt_str || !bytes || !out) {
        return -1;
    }

    memset(out, 0, sizeof(*out));
    out->sequence = sequence;
    out->pcap_timestamp_ns = pcap_ts_ns;
    out->capture_monotonic_ns = mono_ts_ns;
    out->link_layer_dlt = dlt;
    snprintf(out->link_layer_type, sizeof(out->link_layer_type), "%s", dlt_str);
    out->captured_length = caplen;
    out->original_length = origlen;
    out->capture_truncated = (caplen < origlen) ? 1 : 0;
    snprintf(out->protocol, sizeof(out->protocol), "UNKNOWN");

    size_t l3_offset = 0;
    uint16_t ethertype = 0;

    if (dlt == DLT_EN10MB) {
        if (caplen < 14) {
            out->header_truncated = 1;
            return 0;
        }
        if (!is_zero_mac(bytes + 6) || !is_zero_mac(bytes)) {
            out->has_mac = 1;
            format_mac(bytes + 6, out->source_mac, sizeof(out->source_mac));
            format_mac(bytes, out->destination_mac, sizeof(out->destination_mac));
        }
        ethertype = read_be16(bytes + 12);
        l3_offset = 14;
        /* Handle single 802.1Q VLAN tag if present */
        if (ethertype == 0x8100 && caplen >= 18) {
            ethertype = read_be16(bytes + 16);
            l3_offset = 18;
        }
        if (ethertype != 0x0800) {
            snprintf(out->protocol, sizeof(out->protocol),
                     ethertype == 0x86DD ? "IPv6" : (ethertype == 0x0806 ? "ARP" : "OTHER"));
            return 0;
        }
    } else if (dlt == DLT_NULL || dlt == DLT_LOOP) {
        if (caplen < 4) {
            out->header_truncated = 1;
            return 0;
        }
        uint32_t family = 0;
        memcpy(&family, bytes, 4);
        if (dlt == DLT_LOOP) {
            family = ntohl(family);
        }
        l3_offset = 4;
        if (family != 2) { /* AF_INET == 2 */
            snprintf(out->protocol, sizeof(out->protocol), "OTHER");
            return 0;
        }
    } else if (dlt == DLT_LINUX_SLL) {
        if (caplen < 16) {
            out->header_truncated = 1;
            return 0;
        }
        ethertype = read_be16(bytes + 14);
        l3_offset = 16;
        if (ethertype != 0x0800) {
            snprintf(out->protocol, sizeof(out->protocol), ethertype == 0x86DD ? "IPv6" : "OTHER");
            return 0;
        }
#ifdef DLT_LINUX_SLL2
    } else if (dlt == DLT_LINUX_SLL2) {
        if (caplen < 20) {
            out->header_truncated = 1;
            return 0;
        }
        ethertype = read_be16(bytes);
        l3_offset = 20;
        if (ethertype != 0x0800) {
            snprintf(out->protocol, sizeof(out->protocol), ethertype == 0x86DD ? "IPv6" : "OTHER");
            return 0;
        }
#endif
    } else if (dlt == DLT_RAW) {
        l3_offset = 0;
    }

    /* Decode IPv4 Header */
    if (l3_offset + 20 > caplen) {
        out->header_truncated = 1;
        return 0;
    }

    const uint8_t *ip = bytes + l3_offset;
    uint8_t ver = (ip[0] >> 4) & 0x0F;
    uint16_t ihl_bytes = (uint16_t)((ip[0] & 0x0F) * 4);
    if (ver != 4) {
        snprintf(out->protocol, sizeof(out->protocol), ver == 6 ? "IPv6" : "OTHER");
        return 0;
    }
    if (ihl_bytes < 20 || l3_offset + ihl_bytes > caplen) {
        out->header_truncated = 1;
        return 0;
    }

    out->has_ipv4 = 1;
    out->ip_version = ver;
    out->ip_header_length = ihl_bytes;
    out->ip_total_length = read_be16(ip + 2);
    out->ip_identification = read_be16(ip + 4);
    out->ttl = ip[8];
    out->ip_protocol = ip[9];

    struct in_addr src_addr, dst_addr;
    memcpy(&src_addr, ip + 12, 4);
    memcpy(&dst_addr, ip + 16, 4);
    inet_ntop(AF_INET, &src_addr, out->source_ip, sizeof(out->source_ip));
    inet_ntop(AF_INET, &dst_addr, out->destination_ip, sizeof(out->destination_ip));

    if (out->ip_protocol == 6) {
        snprintf(out->protocol, sizeof(out->protocol), "TCP");
    } else if (out->ip_protocol == 17) {
        snprintf(out->protocol, sizeof(out->protocol), "UDP");
        return 0;
    } else if (out->ip_protocol == 1) {
        snprintf(out->protocol, sizeof(out->protocol), "ICMP");
        return 0;
    } else {
        snprintf(out->protocol, sizeof(out->protocol), "IP_%u", out->ip_protocol);
        return 0;
    }

    /* Decode TCP Header */
    size_t l4_offset = l3_offset + ihl_bytes;
    if (l4_offset + 20 > caplen) {
        out->header_truncated = 1;
        return 0;
    }

    const uint8_t *tcp = bytes + l4_offset;
    uint16_t tcp_hlen = (uint16_t)(((tcp[12] >> 4) & 0x0F) * 4);
    if (tcp_hlen < 20) {
        out->header_truncated = 1;
        return 0;
    }

    out->has_tcp = 1;
    out->source_port = read_be16(tcp);
    out->destination_port = read_be16(tcp + 2);
    out->tcp_seq = read_be32(tcp + 4);
    out->tcp_ack = read_be32(tcp + 8);
    out->tcp_header_length = tcp_hlen;
    out->tcp_flags_raw = tcp[13];
    out->tcp_window_size = read_be16(tcp + 14);

    out->flag_fin = (out->tcp_flags_raw & 0x01) ? 1 : 0;
    out->flag_syn = (out->tcp_flags_raw & 0x02) ? 1 : 0;
    out->flag_rst = (out->tcp_flags_raw & 0x04) ? 1 : 0;
    out->flag_psh = (out->tcp_flags_raw & 0x08) ? 1 : 0;
    out->flag_ack = (out->tcp_flags_raw & 0x10) ? 1 : 0;
    out->flag_urg = (out->tcp_flags_raw & 0x20) ? 1 : 0;
    out->flag_ece = (out->tcp_flags_raw & 0x40) ? 1 : 0;
    out->flag_cwr = (out->tcp_flags_raw & 0x80) ? 1 : 0;

    if (tcp_hlen > 20) {
        size_t avail_opts = (l4_offset + tcp_hlen <= caplen)
                                ? (size_t)(tcp_hlen - 20)
                                : (caplen > l4_offset + 20 ? caplen - (l4_offset + 20) : 0);
        if (l4_offset + tcp_hlen > caplen) {
            out->header_truncated = 1;
        }
        if (avail_opts > 0) {
            decode_tcp_options(tcp + 20, avail_opts, out);
        }
    }

    /* Payload Length Calculation */
    uint32_t total_headers = (uint32_t)ihl_bytes + (uint32_t)tcp_hlen;
    if (out->ip_total_length >= total_headers) {
        out->payload_length = (uint32_t)out->ip_total_length - total_headers;
    } else {
        out->payload_length = 0;
    }

    size_t payload_offset = l4_offset + tcp_hlen;
    uint32_t avail_payload = 0;
    if (caplen > payload_offset && out->payload_length > 0) {
        uint32_t rem = caplen - (uint32_t)payload_offset;
        avail_payload = rem < out->payload_length ? rem : out->payload_length;
    }

    if (capture_payload && avail_payload > 0) {
        uint32_t limit = max_payload_bytes;
        if (limit == 0 || limit > NETBOX_MAX_PAYLOAD_PREVIEW) {
            limit = NETBOX_MAX_PAYLOAD_PREVIEW;
        }
        uint32_t take = avail_payload < limit ? avail_payload : limit;
        out->captured_payload_bytes = take;
        out->payload_truncated = (take < out->payload_length) ? 1 : 0;
        encode_payload_preview(bytes + payload_offset, take, out);
    } else {
        /* Privacy by default: do NOT store raw payload bytes */
        out->captured_payload_bytes = 0;
        out->payload_truncated = (out->payload_length > 0) ? 1 : 0;
        out->has_payload_preview = 0;
    }

    return 0;
}

static void write_json_escaped(FILE *out, const char *s) {
    fputc('"', out);
    for (const char *p = s; *p; p++) {
        if (*p == '"' || *p == '\\') {
            fputc('\\', out);
            fputc(*p, out);
        } else if ((unsigned char)*p < 0x20) {
            fprintf(out, "\\u%04x", (unsigned char)*p);
        } else {
            fputc(*p, out);
        }
    }
    fputc('"', out);
}

int netbox_write_packet_jsonl(
    FILE *out,
    const char *run_id,
    const char *iface,
    const netbox_decoded_packet_t *pkt
) {
    if (!out || !run_id || !iface || !pkt) {
        return -1;
    }

    fprintf(out, "{\"schema_version\":\"1.0\",\"run_id\":");
    write_json_escaped(out, run_id);
    fprintf(out, ",\"sequence\":%llu,\"source\":\"packet_capture\",",
            (unsigned long long)pkt->sequence);
    fprintf(out, "\"timestamp\":{\"pcap_timestamp_ns\":%llu,\"capture_monotonic_ns\":%llu},",
            (unsigned long long)pkt->pcap_timestamp_ns,
            (unsigned long long)pkt->capture_monotonic_ns);
    fprintf(out, "\"interface\":");
    write_json_escaped(out, iface);
    fprintf(out, ",\"link_layer\":{\"type\":");
    write_json_escaped(out, pkt->link_layer_type);
    fprintf(out, ",\"dlt\":%d,\"source_mac\":", pkt->link_layer_dlt);
    if (pkt->has_mac) {
        write_json_escaped(out, pkt->source_mac);
    } else {
        fprintf(out, "null");
    }
    fprintf(out, ",\"destination_mac\":");
    if (pkt->has_mac) {
        write_json_escaped(out, pkt->destination_mac);
    } else {
        fprintf(out, "null");
    }
    fprintf(out, "},\"protocol\":");
    write_json_escaped(out, pkt->protocol);

    /* Network header */
    if (pkt->has_ipv4) {
        fprintf(out,
                ",\"network\":{\"ip_version\":%u,\"source_ip\":\"%s\",\"destination_ip\":\"%s\","
                "\"ttl\":%u,\"header_length\":%u,\"total_length\":%u,\"identification\":%u,"
                "\"protocol_number\":%u}",
                pkt->ip_version, pkt->source_ip, pkt->destination_ip,
                pkt->ttl, pkt->ip_header_length, pkt->ip_total_length,
                pkt->ip_identification, pkt->ip_protocol);
    } else {
        fprintf(out, ",\"network\":null");
    }

    /* Transport / TCP header */
    if (pkt->has_tcp) {
        fprintf(out,
                ",\"transport\":{\"source_port\":%u,\"destination_port\":%u,\"tcp\":{"
                "\"source_port\":%u,\"destination_port\":%u,"
                "\"sequence_number\":%u,\"acknowledgement_number\":%u,"
                "\"header_length\":%u,\"window_size\":%u,\"flags_raw\":%u,"
                "\"flags\":{\"syn\":%s,\"ack\":%s,\"fin\":%s,\"rst\":%s,"
                "\"psh\":%s,\"urg\":%s,\"ece\":%s,\"cwr\":%s},\"options\":[",
                pkt->source_port, pkt->destination_port,
                pkt->source_port, pkt->destination_port,
                pkt->tcp_seq, pkt->tcp_ack,
                pkt->tcp_header_length, pkt->tcp_window_size, pkt->tcp_flags_raw,
                pkt->flag_syn ? "true" : "false",
                pkt->flag_ack ? "true" : "false",
                pkt->flag_fin ? "true" : "false",
                pkt->flag_rst ? "true" : "false",
                pkt->flag_psh ? "true" : "false",
                pkt->flag_urg ? "true" : "false",
                pkt->flag_ece ? "true" : "false",
                pkt->flag_cwr ? "true" : "false");

        for (int i = 0; i < pkt->tcp_option_count; i++) {
            if (i > 0) {
                fputc(',', out);
            }
            fprintf(out, "{\"name\":");
            write_json_escaped(out, pkt->tcp_options[i].name);
            fprintf(out, ",\"value\":");
            write_json_escaped(out, pkt->tcp_options[i].value);
            fputc('}', out);
        }
        fprintf(out, "]}}");
    } else {
        fprintf(out, ",\"transport\":null");
    }

    /* Payload metadata */
    fprintf(out, ",\"payload\":{\"captured_bytes\":%u,\"payload_length\":%u,\"preview_hex\":",
            pkt->captured_payload_bytes, pkt->payload_length);
    if (pkt->has_payload_preview) {
        write_json_escaped(out, pkt->preview_hex);
    } else {
        fprintf(out, "null");
    }
    fprintf(out, ",\"preview_utf8\":");
    if (pkt->has_payload_preview) {
        write_json_escaped(out, pkt->preview_utf8);
    } else {
        fprintf(out, "null");
    }
    fprintf(out, ",\"truncated\":%s}", pkt->payload_truncated ? "true" : "false");

    /* Capture lengths */
    fprintf(out,
            ",\"capture\":{\"captured_length\":%u,\"original_length\":%u,"
            "\"truncated\":%s,\"header_truncated\":%s},\"is_simulated\":false}\n",
            pkt->captured_length, pkt->original_length,
            pkt->capture_truncated ? "true" : "false",
            pkt->header_truncated ? "true" : "false");

    return ferror(out) ? -1 : 0;
}
