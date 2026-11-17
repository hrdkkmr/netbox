#define _GNU_SOURCE
#include "socket_metadata.h"
#include <stdio.h>
#include <string.h>
#include <pthread.h>
#include <unistd.h>

static socket_info_t g_socket_table[MAX_TRACKED_FDS];
static pthread_mutex_t g_table_mutex = PTHREAD_MUTEX_INITIALIZER;
static int g_initialized = 0;

static void parse_sockaddr(const struct sockaddr *addr, socklen_t addrlen, char *ip_out, int *port_out) {
    if (!ip_out || !port_out) return;
    ip_out[0] = '\0';
    *port_out = -1;

    if (!addr || addrlen < (socklen_t)sizeof(sa_family_t)) {
        return;
    }

    if (addr->sa_family == AF_INET && addrlen >= (socklen_t)sizeof(struct sockaddr_in)) {
        const struct sockaddr_in *sin = (const struct sockaddr_in *)addr;
        if (inet_ntop(AF_INET, &sin->sin_addr, ip_out, IP_STR_MAX_LEN) != NULL) {
            *port_out = ntohs(sin->sin_port);
        }
    } else if (addr->sa_family == AF_INET6 && addrlen >= (socklen_t)sizeof(struct sockaddr_in6)) {
        const struct sockaddr_in6 *sin6 = (const struct sockaddr_in6 *)addr;
        if (inet_ntop(AF_INET6, &sin6->sin6_addr, ip_out, IP_STR_MAX_LEN) != NULL) {
            *port_out = ntohs(sin6->sin6_port);
        }
    }
}

void socket_metadata_init(void) {
    pthread_mutex_lock(&g_table_mutex);
    if (!g_initialized) {
        memset(g_socket_table, 0, sizeof(g_socket_table));
        for (int i = 0; i < MAX_TRACKED_FDS; i++) {
            g_socket_table[i].fd = -1;
            g_socket_table[i].local_port = -1;
            g_socket_table[i].remote_port = -1;
        }
        g_initialized = 1;
    }
    pthread_mutex_unlock(&g_table_mutex);
}

void socket_metadata_cleanup(void) {
    pthread_mutex_lock(&g_table_mutex);
    memset(g_socket_table, 0, sizeof(g_socket_table));
    g_initialized = 0;
    pthread_mutex_unlock(&g_table_mutex);
}

void socket_metadata_track_socket(int fd, int domain, int type, int protocol) {
    if (fd < 0 || fd >= MAX_TRACKED_FDS) return;
    pthread_mutex_lock(&g_table_mutex);
    g_socket_table[fd].in_use = 1;
    g_socket_table[fd].fd = fd;
    g_socket_table[fd].domain = domain;
    g_socket_table[fd].type = type;
    g_socket_table[fd].protocol = protocol;
    g_socket_table[fd].is_listening = 0;
    g_socket_table[fd].local_ip[0] = '\0';
    g_socket_table[fd].local_port = -1;
    g_socket_table[fd].remote_ip[0] = '\0';
    g_socket_table[fd].remote_port = -1;
    pthread_mutex_unlock(&g_table_mutex);
}

void socket_metadata_set_local(int fd, const struct sockaddr *addr, socklen_t addrlen) {
    if (fd < 0 || fd >= MAX_TRACKED_FDS) return;
    char ip[IP_STR_MAX_LEN];
    int port = -1;
    parse_sockaddr(addr, addrlen, ip, &port);

    pthread_mutex_lock(&g_table_mutex);
    if (g_socket_table[fd].in_use) {
        if (ip[0] != '\0') {
            snprintf(g_socket_table[fd].local_ip, sizeof(g_socket_table[fd].local_ip), "%s", ip);
        }
        if (port >= 0) {
            g_socket_table[fd].local_port = port;
        }
    }
    pthread_mutex_unlock(&g_table_mutex);
}

void socket_metadata_set_remote(int fd, const struct sockaddr *addr, socklen_t addrlen) {
    if (fd < 0 || fd >= MAX_TRACKED_FDS) return;
    char ip[IP_STR_MAX_LEN];
    int port = -1;
    parse_sockaddr(addr, addrlen, ip, &port);

    pthread_mutex_lock(&g_table_mutex);
    if (g_socket_table[fd].in_use) {
        if (ip[0] != '\0') {
            snprintf(g_socket_table[fd].remote_ip, sizeof(g_socket_table[fd].remote_ip), "%s", ip);
        }
        if (port >= 0) {
            g_socket_table[fd].remote_port = port;
        }
    }
    pthread_mutex_unlock(&g_table_mutex);
}

void socket_metadata_set_listening(int fd, int is_listening) {
    if (fd < 0 || fd >= MAX_TRACKED_FDS) return;
    pthread_mutex_lock(&g_table_mutex);
    if (g_socket_table[fd].in_use) {
        g_socket_table[fd].is_listening = is_listening;
    }
    pthread_mutex_unlock(&g_table_mutex);
}

int socket_metadata_get(int fd, socket_info_t *out_info) {
    if (!out_info || fd < 0 || fd >= MAX_TRACKED_FDS) return 0;
    pthread_mutex_lock(&g_table_mutex);
    int found = g_socket_table[fd].in_use;
    if (found) {
        *out_info = g_socket_table[fd];
    }
    pthread_mutex_unlock(&g_table_mutex);
    return found;
}

void socket_metadata_untrack(int fd) {
    if (fd < 0 || fd >= MAX_TRACKED_FDS) return;
    pthread_mutex_lock(&g_table_mutex);
    g_socket_table[fd].in_use = 0;
    g_socket_table[fd].fd = -1;
    g_socket_table[fd].local_ip[0] = '\0';
    g_socket_table[fd].local_port = -1;
    g_socket_table[fd].remote_ip[0] = '\0';
    g_socket_table[fd].remote_port = -1;
    g_socket_table[fd].is_listening = 0;
    pthread_mutex_unlock(&g_table_mutex);
}

int socket_metadata_is_tracked(int fd) {
    if (fd < 0 || fd >= MAX_TRACKED_FDS) return 0;
    pthread_mutex_lock(&g_table_mutex);
    int tracked = g_socket_table[fd].in_use;
    pthread_mutex_unlock(&g_table_mutex);
    return tracked;
}

void socket_metadata_refresh_endpoints(int fd) {
    if (fd < 0 || fd >= MAX_TRACKED_FDS) return;

    struct sockaddr_storage ss;
    socklen_t len = sizeof(ss);
    if (getsockname(fd, (struct sockaddr *)&ss, &len) == 0) {
        socket_metadata_set_local(fd, (struct sockaddr *)&ss, len);
    }

    len = sizeof(ss);
    if (getpeername(fd, (struct sockaddr *)&ss, &len) == 0) {
        socket_metadata_set_remote(fd, (struct sockaddr *)&ss, len);
    }
}

const char *socket_domain_to_str(int domain) {
    switch (domain) {
        case AF_INET:   return "AF_INET";
        case AF_INET6:  return "AF_INET6";
        case AF_UNIX:   return "AF_UNIX";
        default:        return "UNKNOWN";
    }
}

const char *socket_type_to_str(int type) {
    int base_type = type & ~(SOCK_NONBLOCK | SOCK_CLOEXEC);
    switch (base_type) {
        case SOCK_STREAM:    return "SOCK_STREAM";
        case SOCK_DGRAM:     return "SOCK_DGRAM";
        case SOCK_RAW:       return "SOCK_RAW";
        case SOCK_SEQPACKET: return "SOCK_SEQPACKET";
        default:             return "UNKNOWN";
    }
}
