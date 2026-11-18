#define _DEFAULT_SOURCE
#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <pcap/pcap.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "packet_decoder.h"

/* Exit codes for structured error classification in backend */
#define EXIT_ERR_ARGS        2
#define EXIT_ERR_PERM        13
#define EXIT_ERR_NO_IFACE    19
#define EXIT_ERR_FILTER      22
#define EXIT_ERR_DLT         23
#define EXIT_ERR_IO          24
#define EXIT_ERR_PCAP        25

typedef struct {
    const char *run_id;
    const char *iface;
    FILE *output;
    int dlt;
    int capture_payload;
    uint32_t max_payload_bytes;
    uint64_t sequence;
} capture_ctx_t;

static pcap_t *g_handle = NULL;
static volatile sig_atomic_t g_stop_requested = 0;

static uint64_t now_monotonic_ns(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000000000ULL + (uint64_t)ts.tv_nsec;
}

static void handle_stop_signal(int sig) {
    (void)sig;
    g_stop_requested = 1;
    if (g_handle) {
        pcap_breakloop(g_handle);
    }
}

static void on_packet(
    u_char *user,
    const struct pcap_pkthdr *hdr,
    const u_char *bytes
) {
    /* Record CLOCK_MONOTONIC immediately upon callback invocation */
    uint64_t mono_ns = now_monotonic_ns();
    capture_ctx_t *ctx = (capture_ctx_t *)user;
    if (!ctx || !hdr || !bytes) {
        return;
    }

    uint64_t pcap_ns =
        (uint64_t)hdr->ts.tv_sec * 1000000000ULL +
        (uint64_t)hdr->ts.tv_usec * 1000ULL;

    ctx->sequence += 1;

    netbox_decoded_packet_t decoded;
    if (netbox_decode_packet(
            bytes,
            hdr->caplen,
            hdr->len,
            ctx->dlt,
            ctx->sequence,
            pcap_ns,
            mono_ns,
            ctx->capture_payload,
            ctx->max_payload_bytes,
            &decoded) == 0) {
        netbox_write_packet_jsonl(ctx->output, ctx->run_id, ctx->iface, &decoded);
        fflush(ctx->output);
    }
}

static void print_usage(const char *prog) {
    fprintf(stderr,
            "Usage: %s --interface <iface> --output <file.jsonl> --run-id <id> "
            "[--filter <bpf>] [--capture-payload 0|1] [--max-payload-bytes <n>]\n",
            prog);
}

int main(int argc, char **argv) {
    const char *iface = "lo";
    const char *filter_expr = "tcp";
    const char *output_path = NULL;
    const char *run_id = "run_unknown";
    int capture_payload = 0;
    uint32_t max_payload_bytes = 64;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--interface") == 0 && i + 1 < argc) {
            iface = argv[++i];
        } else if (strcmp(argv[i], "--filter") == 0 && i + 1 < argc) {
            filter_expr = argv[++i];
        } else if (strcmp(argv[i], "--output") == 0 && i + 1 < argc) {
            output_path = argv[++i];
        } else if (strcmp(argv[i], "--run-id") == 0 && i + 1 < argc) {
            run_id = argv[++i];
        } else if (strcmp(argv[i], "--capture-payload") == 0 && i + 1 < argc) {
            capture_payload = atoi(argv[++i]) != 0 ? 1 : 0;
        } else if (strcmp(argv[i], "--max-payload-bytes") == 0 && i + 1 < argc) {
            int parsed = atoi(argv[++i]);
            if (parsed > 0 && parsed <= NETBOX_MAX_PAYLOAD_PREVIEW) {
                max_payload_bytes = (uint32_t)parsed;
            }
        } else {
            print_usage(argv[0]);
            return EXIT_ERR_ARGS;
        }
    }

    if (!output_path) {
        fprintf(stderr, "ERROR: --output is required\n");
        print_usage(argv[0]);
        return EXIT_ERR_ARGS;
    }

    FILE *out = fopen(output_path, "w");
    if (!out) {
        fprintf(stderr, "ERROR: Failed to open output file '%s': %s\n",
                output_path, strerror(errno));
        return EXIT_ERR_IO;
    }

    char errbuf[PCAP_ERRBUF_SIZE];
    memset(errbuf, 0, sizeof(errbuf));

    pcap_t *handle = pcap_create(iface, errbuf);
    if (!handle) {
        fprintf(stderr, "ERROR: pcap_create(%s) failed: %s\n", iface, errbuf);
        fclose(out);
        return EXIT_ERR_PCAP;
    }

    /* Privacy by default: header-only snaplen (160B) unless opt-in payload preview enabled */
    int snaplen = capture_payload ? (160 + (int)max_payload_bytes) : 160;
    pcap_set_snaplen(handle, snaplen);
    pcap_set_promisc(handle, 0);
    pcap_set_timeout(handle, 50);
    pcap_set_immediate_mode(handle, 1);

    int act_res = pcap_activate(handle);
    if (act_res < 0) {
        const char *msg = pcap_geterr(handle);
        fprintf(stderr, "ERROR: pcap_activate(%s) failed (%d): %s\n", iface, act_res, msg);
        pcap_close(handle);
        fclose(out);
        if (act_res == PCAP_ERROR_PERM_DENIED || act_res == PCAP_ERROR_PROMISC_PERM_DENIED) {
            return EXIT_ERR_PERM;
        }
        if (act_res == PCAP_ERROR_NO_SUCH_DEVICE || act_res == PCAP_ERROR_IFACE_NOT_UP) {
            return EXIT_ERR_NO_IFACE;
        }
        return EXIT_ERR_PCAP;
    }

    int dlt = pcap_datalink(handle);
    const char *dlt_name = netbox_dlt_name(dlt);
    if (!dlt_name) {
        fprintf(stderr, "ERROR: Unsupported link-layer type DLT=%d on interface '%s'\n", dlt, iface);
        pcap_close(handle);
        fclose(out);
        return EXIT_ERR_DLT;
    }

    struct bpf_program fp;
    int has_filter = 0;
    if (filter_expr && filter_expr[0] != '\0') {
        if (pcap_compile(handle, &fp, filter_expr, 1, PCAP_NETMASK_UNKNOWN) != 0) {
            fprintf(stderr, "ERROR: Invalid BPF capture filter '%s': %s\n",
                    filter_expr, pcap_geterr(handle));
            pcap_close(handle);
            fclose(out);
            return EXIT_ERR_FILTER;
        }
        if (pcap_setfilter(handle, &fp) != 0) {
            fprintf(stderr, "ERROR: pcap_setfilter('%s') failed: %s\n",
                    filter_expr, pcap_geterr(handle));
            pcap_freecode(&fp);
            pcap_close(handle);
            fclose(out);
            return EXIT_ERR_FILTER;
        }
        has_filter = 1;
    }

    g_handle = handle;

    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sa.sa_handler = handle_stop_signal;
    sigemptyset(&sa.sa_mask);
    sigaction(SIGINT, &sa, NULL);
    sigaction(SIGTERM, &sa, NULL);

    capture_ctx_t ctx;
    memset(&ctx, 0, sizeof(ctx));
    ctx.run_id = run_id;
    ctx.iface = iface;
    ctx.output = out;
    ctx.dlt = dlt;
    ctx.capture_payload = capture_payload;
    ctx.max_payload_bytes = max_payload_bytes;
    ctx.sequence = 0;

    /* Signal readiness to parent process BEFORE target client/server launch */
    printf("NETBOX_PCAP_READY interface=%s dlt=%s snaplen=%d payload_capture=%d\n",
           iface, dlt_name, snaplen, capture_payload);
    fflush(stdout);

    int loop_rc = pcap_loop(handle, -1, on_packet, (u_char *)&ctx);

    g_handle = NULL;
    if (has_filter) {
        pcap_freecode(&fp);
    }
    pcap_close(handle);
    fflush(out);
    fclose(out);

    printf("NETBOX_PCAP_STOPPED captured=%llu\n", (unsigned long long)ctx.sequence);
    fflush(stdout);

    if (loop_rc == PCAP_ERROR && !g_stop_requested) {
        return EXIT_ERR_PCAP;
    }
    return 0;
}
